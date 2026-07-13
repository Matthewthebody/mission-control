import type { PoolClient } from "pg";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import { hasAuthorityTier } from "../authz/authority.js";
import type { AuthUser } from "../types/auth.js";
import { assertShiftAccess } from "./shiftAccess.js";
import { createAuditLog } from "./audit.js";
import { findNotificationRecipients, queueNotificationDispatch } from "./opsNotifications.js";
import { emitEvaluationFlaggedEvent } from "./operationalEvents.js";
import { queueRedFlagPostShootEvalAlert } from "./operationalAlerting.js";
import { createOperationalNote, promoteOperationalNoteToLocationMemory } from "./operationalNotes.js";
import {
  assertMileageVehicleTypeForSubmission,
  getMileageReimbursementForEmployeeDate,
  recalculateMileageForEmployeeDate,
  syncMileageReviewForShiftCloseout,
  type MileageReimbursementSummary
} from "./timeClockMileage.js";
import {
  listShiftTimeClockComplianceFlags,
  syncShiftCloseoutComplianceFlags
} from "./timeClockCompliance.js";
import type { MileageVehicleType } from "../types/timeClock.js";
import {
  canCreatePostShootEvaluations,
  canUpdatePostShootEvaluations,
  canViewSensitivePostShootEvaluations,
  withDepartmentContext
} from "./policy/index.js";
import { triggerProductionProjectFromPostShootIssue } from "./productionProjects.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type PostShootOverallStatus = "successful" | "completed_with_issues" | "significant_issue";
export type ShiftCloseoutItemCode = "setup_photo" | "post_shoot_evaluation";
export type PostShootEvalStatus = "draft" | "submitted" | "reviewed" | "closed";
export type PostShootEvalOutcome = "smooth" | "minor_issues" | "major_issues" | "needs_leadership_review";
export type PostShootEvalStaffingFit = "understaffed" | "right_sized" | "overstaffed";
export type PostShootEvalSetupDifficulty = "low" | "medium" | "high";
export type PostShootEvalReadinessState = "ready" | "minor_friction" | "major_friction";
export type PostShootEvalIssueState = "none" | "minor" | "major";
export type PostShootIssueCategory =
  | "staffing"
  | "attendance_no_show"
  | "setup_room_problem"
  | "parking_load_in"
  | "school_readiness"
  | "data_roster"
  | "equipment_technical"
  | "lighting_environment"
  | "line_flow_traffic"
  | "student_parent_flow"
  | "communication_contact_issue"
  | "special_product_deliverable_issue"
  | "other";
export type SetupPhotoCategory =
  | "arrival_entrance"
  | "parking_load_in"
  | "check_in_flow_area"
  | "room_wide_shot"
  | "final_camera_background_setup"
  | "power_staging_storage"
  | "special_constraint_watch_out";
export type SetupPhotoMemoryState = "submitted" | "reviewed" | "added_to_memory";

export type SubmitPostShootEvaluationInput = {
  eval_status?: Extract<PostShootEvalStatus, "draft" | "submitted">;
  overall_outcome?: PostShootEvalOutcome | null;
  overall_shoot_status?: PostShootOverallStatus | null;
  staffing_fit?: PostShootEvalStaffingFit | null;
  setup_difficulty?: PostShootEvalSetupDifficulty | null;
  customer_school_readiness?: PostShootEvalReadinessState | null;
  data_roster_readiness?: PostShootEvalReadinessState | null;
  equipment_workflow_issue?: PostShootEvalIssueState | null;
  started_on_time?: boolean | null;
  short_summary_note?: string | null;
  next_time_recommendation?: string | null;
  follow_up_required?: boolean;
  major_issue_flag?: boolean;
  location_memory_update_suggested?: boolean;
  leadership_review_needed?: boolean;
  issue_category?: PostShootIssueCategory | null;
  understaffed_role?: string | null;
  staffing_change_recommendation?: string | null;
  customer_follow_up_needed?: boolean;
  follow_up_owner_user_id?: string | null;
  recommended_staffing_next_time?: number | null;
  recommended_arrival_buffer_minutes?: number | null;
  recommended_room_setup_change?: string | null;
  special_gear_needed_next_time?: string | null;
  top_watch_out?: string | null;
  location_memory_promotion_text?: string | null;
  went_well?: string | null;
  remember_next_time?: string | null;
  issue_flag?: boolean;
  open_comment?: string | null;
  submit_for_mileage?: boolean;
  vehicle_type?: MileageVehicleType | null;
};

export type ShiftCloseoutCompliance = {
  shift_id: string;
  shoot_id: string | null;
  organization_id: string | null;
  location_id: string | null;
  reminder_threshold_minutes: number;
  setup_photo_required: boolean;
  setup_photo_uploaded: boolean;
  setup_photo_reminder_due: boolean;
  setup_photo_state: "not_required" | "required" | "submitted" | "reviewed" | "added_to_memory";
  post_shoot_evaluation_required: boolean;
  post_shoot_evaluation_submitted: boolean;
  post_shoot_evaluation_state: Exclude<PostShootEvalStatus, "closed"> | "not_started" | "closed";
  missing_required_items: ShiftCloseoutItemCode[];
  last_post_shoot_evaluation: {
    id: string;
    eval_status: PostShootEvalStatus;
    submitted_at: string | null;
    reviewed_at: string | null;
    closed_at: string | null;
    overall_outcome: PostShootEvalOutcome | null;
    overall_shoot_status: PostShootOverallStatus | null;
    staffing_fit: PostShootEvalStaffingFit | null;
    setup_difficulty: PostShootEvalSetupDifficulty | null;
    customer_school_readiness: PostShootEvalReadinessState | null;
    data_roster_readiness: PostShootEvalReadinessState | null;
    equipment_workflow_issue: PostShootEvalIssueState | null;
    started_on_time: boolean | null;
    short_summary_note: string | null;
    next_time_recommendation: string | null;
    follow_up_required: boolean;
    major_issue_flag: boolean;
    location_memory_update_suggested: boolean;
    leadership_review_needed: boolean;
    issue_category: PostShootIssueCategory | null;
    understaffed_role: string | null;
    staffing_change_recommendation: string | null;
    customer_follow_up_needed: boolean;
    recommended_staffing_next_time: number | null;
    recommended_arrival_buffer_minutes: number | null;
    recommended_room_setup_change: string | null;
    special_gear_needed_next_time: string | null;
    top_watch_out: string | null;
    location_memory_promotion_text: string | null;
    went_well: string | null;
    remember_next_time: string | null;
    issue_flag: boolean;
    open_comment: string | null;
    submit_for_mileage: boolean;
    vehicle_type: MileageVehicleType | null;
  } | null;
  mileage_reimbursement: MileageReimbursementSummary | null;
  compliance_flags: Array<{
    id: string;
    item_type: string;
    item_label: string;
    severity: "warning" | "high";
    message: string;
    last_detected_at: string;
  }>;
};

type CloseoutShiftContext = {
  id: string;
  tenant_id: string;
  assigned_user_id: string;
  assigned_user_name: string;
  manager_user_id: string | null;
  shift_kind: string;
  staffing_role: string | null;
  satisfies_lead_coverage: boolean;
  starts_at: string;
  ends_at: string;
  attendance_state: string | null;
  title: string;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  shoot_date: string | null;
  shoot_type: string | null;
  organization_id: string | null;
  organization_display_name: string | null;
  location_id: string | null;
  location_name: string | null;
};

type PostShootEvaluationRow = {
  id: string;
  shift_id: string | null;
  shoot_id: string | null;
  photographer_user_id: string | null;
  eval_status: PostShootEvalStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  closed_at: string | null;
  overall_outcome: PostShootEvalOutcome | null;
  overall_shoot_status: PostShootOverallStatus | null;
  staffing_fit: PostShootEvalStaffingFit | null;
  setup_difficulty: PostShootEvalSetupDifficulty | null;
  customer_school_readiness: PostShootEvalReadinessState | null;
  data_roster_readiness: PostShootEvalReadinessState | null;
  equipment_workflow_issue: PostShootEvalIssueState | null;
  started_on_time: boolean | null;
  short_summary_note: string | null;
  next_time_recommendation: string | null;
  follow_up_required: boolean;
  major_issue_flag: boolean;
  location_memory_update_suggested: boolean;
  leadership_review_needed: boolean;
  issue_category: PostShootIssueCategory | null;
  understaffed_role: string | null;
  staffing_change_recommendation: string | null;
  customer_follow_up_needed: boolean;
  recommended_staffing_next_time: number | null;
  recommended_arrival_buffer_minutes: number | null;
  recommended_room_setup_change: string | null;
  special_gear_needed_next_time: string | null;
  top_watch_out: string | null;
  location_memory_promotion_text: string | null;
  went_well: string | null;
  remember_next_time: string | null;
  issue_flag: boolean;
  open_comment: string | null;
  submit_for_mileage: boolean;
  vehicle_type: MileageVehicleType | null;
};

const SETUP_PHOTO_REMINDER_THRESHOLD_MINUTES = 30;

function requiresLeadCloseout(shift: Pick<CloseoutShiftContext, "shift_kind" | "staffing_role" | "satisfies_lead_coverage" | "shoot_id">) {
  if (shift.shift_kind !== "shoot" || !shift.shoot_id) {
    return false;
  }
  return Boolean(shift.satisfies_lead_coverage) || shift.staffing_role === "senior_photographer";
}

function overallStatusToLegacyRating(status: PostShootOverallStatus) {
  switch (status) {
    case "successful":
      return 5;
    case "completed_with_issues":
      return 3;
    default:
      return 2;
  }
}

function outcomeToLegacyStatus(outcome: PostShootEvalOutcome | null | undefined): PostShootOverallStatus {
  switch (outcome) {
    case "smooth":
      return "successful";
    case "minor_issues":
      return "completed_with_issues";
    case "major_issues":
    case "needs_leadership_review":
      return "significant_issue";
    default:
      return "completed_with_issues";
  }
}

function legacyStatusToOutcome(status: PostShootOverallStatus | null | undefined): PostShootEvalOutcome {
  switch (status) {
    case "successful":
      return "smooth";
    case "completed_with_issues":
      return "minor_issues";
    case "significant_issue":
      return "major_issues";
    default:
      return "minor_issues";
  }
}

function normalizeOptionalText(value: string | null | undefined) {
  return value?.trim() ? value.trim() : null;
}

function normalizeOptionalInteger(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

function deriveDefaultFollowUpOwnerId(input: SubmitPostShootEvaluationInput, shift: Pick<CloseoutShiftContext, "manager_user_id">) {
  return input.follow_up_owner_user_id ?? shift.manager_user_id ?? null;
}

function deriveEvalStatus(input: SubmitPostShootEvaluationInput): Extract<PostShootEvalStatus, "draft" | "submitted"> {
  return input.eval_status === "draft" ? "draft" : "submitted";
}

function deriveOutcome(input: SubmitPostShootEvaluationInput): PostShootEvalOutcome {
  return input.overall_outcome ?? legacyStatusToOutcome(input.overall_shoot_status ?? null);
}

function deriveLeadershipReviewNeeded(input: SubmitPostShootEvaluationInput, outcome: PostShootEvalOutcome) {
  return Boolean(input.leadership_review_needed) || outcome === "needs_leadership_review";
}

function deriveMajorIssueFlag(input: SubmitPostShootEvaluationInput, outcome: PostShootEvalOutcome) {
  return Boolean(input.major_issue_flag) || outcome === "major_issues" || outcome === "needs_leadership_review";
}

function deriveFollowUpRequired(input: SubmitPostShootEvaluationInput, outcome: PostShootEvalOutcome) {
  return Boolean(input.follow_up_required) || Boolean(input.issue_flag) || outcome !== "smooth";
}

function deriveLocationMemorySuggested(input: SubmitPostShootEvaluationInput) {
  return Boolean(input.location_memory_update_suggested) || Boolean(normalizeOptionalText(input.location_memory_promotion_text));
}

function deriveIssueCategory(input: SubmitPostShootEvaluationInput, outcome: PostShootEvalOutcome) {
  if (input.issue_category) {
    return input.issue_category;
  }
  if (outcome === "smooth") {
    return null;
  }
  if (input.staffing_fit === "understaffed") {
    return "staffing" as const;
  }
  if (input.data_roster_readiness === "major_friction") {
    return "data_roster" as const;
  }
  if (input.equipment_workflow_issue === "major") {
    return "equipment_technical" as const;
  }
  if (input.setup_difficulty === "high") {
    return "setup_room_problem" as const;
  }
  return "other" as const;
}

function validatePostShootEvaluationInput(
  evalStatus: Extract<PostShootEvalStatus, "draft" | "submitted">,
  input: SubmitPostShootEvaluationInput,
  outcome: PostShootEvalOutcome
) {
  if (evalStatus === "draft") {
    return;
  }

  const summaryNote = normalizeOptionalText(input.short_summary_note ?? input.open_comment ?? input.went_well ?? null);
  const nextTimeNote = normalizeOptionalText(input.next_time_recommendation ?? input.remember_next_time ?? null);
  const hasStructuredSignals = Boolean(
    input.staffing_fit ||
      input.setup_difficulty ||
      input.customer_school_readiness ||
      input.data_roster_readiness ||
      input.equipment_workflow_issue ||
      typeof input.started_on_time === "boolean"
  );

  if (!summaryNote) {
    throw new ApiError(400, "Add a short summary note before submitting the Post-Shoot Eval.");
  }
  if (!nextTimeNote && !hasStructuredSignals) {
    throw new ApiError(
      400,
      "Add a next-time recommendation or capture the structured readiness details before submitting the Post-Shoot Eval."
    );
  }
  if ((input.staffing_fit === "understaffed") && !normalizeOptionalText(input.understaffed_role) && !normalizeOptionalText(input.staffing_change_recommendation)) {
    throw new ApiError(400, "If the crew was understaffed, capture the missing role or what should change next time.");
  }
  if ((outcome === "major_issues" || outcome === "needs_leadership_review" || Boolean(input.issue_flag)) && !deriveIssueCategory(input, outcome)) {
    throw new ApiError(400, "Choose an issue category for major or follow-up issues before submitting.");
  }
  if (deriveLocationMemorySuggested(input) && !normalizeOptionalText(input.location_memory_promotion_text) && !normalizeOptionalText(input.top_watch_out)) {
    throw new ApiError(400, "Add the reusable guidance that should become location memory before submitting.");
  }
}

function buildSetupPhotoState(input: { required: boolean; uploaded: boolean; reviewed: boolean; addedToMemory: boolean }) {
  if (!input.required) {
    return "not_required" as const;
  }
  if (input.addedToMemory) {
    return "added_to_memory" as const;
  }
  if (input.reviewed) {
    return "reviewed" as const;
  }
  return input.uploaded ? ("submitted" as const) : ("required" as const);
}

function buildPostShootEvaluationState(row: PostShootEvaluationRow | null) {
  if (!row) {
    return "not_started" as const;
  }
  return row.eval_status;
}

function buildFollowUpNoteBody(
  shift: Pick<CloseoutShiftContext, "shoot_code" | "shoot_title" | "title" | "location_name">,
  input: {
    outcome: PostShootEvalOutcome;
    issueCategory: PostShootIssueCategory | null;
    summary: string | null;
    nextTime: string | null;
    topWatchOut: string | null;
    staffingChange: string | null;
  }
) {
  const lines = [
    `${shift.shoot_code ?? shift.shoot_title ?? shift.title}: ${input.summary ?? "Post-shoot follow-up was flagged."}`,
    input.issueCategory ? `Issue category: ${input.issueCategory.replace(/_/g, " ")}` : null,
    shift.location_name ? `Location: ${shift.location_name}` : null,
    input.nextTime ? `Next time: ${input.nextTime}` : null,
    input.staffingChange ? `Staffing adjustment: ${input.staffingChange}` : null,
    input.topWatchOut ? `Watch-out: ${input.topWatchOut}` : null
  ].filter(Boolean);
  return lines.join("\n");
}

function attendanceStateToLegacyOnTime(attendanceState: string | null) {
  if (!attendanceState) {
    return "Yes";
  }
  return ["late_warning", "late", "missed_clock_in", "missed_clock_out", "no_show_suspected"].includes(attendanceState) ? "No" : "Yes";
}

function buildMissingCloseoutMessage(
  missingItems: ShiftCloseoutItemCode[],
  mileageReimbursement?: MileageReimbursementSummary | null
) {
  if (!missingItems.length) {
    return null;
  }

  const labels = missingItems.map((item) => (item === "setup_photo" ? "setup photo" : "Post-Shoot Evaluation"));
  const baseMessage =
    labels.length === 1
      ? `${labels[0]} is still missing. Clock-out is allowed, but leadership will be notified.`
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]} are still missing. Clock-out is allowed, but leadership will be notified.`;

  const mileageBlockedByMissingEvaluation =
    mileageReimbursement?.status === "review_required" &&
    mileageReimbursement?.review_reason_code === "missing_post_shoot_evaluation";

  return missingItems.includes("post_shoot_evaluation") && mileageBlockedByMissingEvaluation
    ? `${baseMessage} Mileage reimbursement stays blocked until the Post-Shoot Evaluation is submitted.`
    : baseMessage;
}

async function loadShiftCloseoutContext(client: PoolClient, tenantId: string, shiftId: string) {
  const { rows } = await client.query<CloseoutShiftContext>(
    `
      SELECT
        ws.id,
        ws.tenant_id,
        ws.assigned_user_id,
        assigned.full_name AS assigned_user_name,
        ws.manager_user_id,
        ws.shift_kind::text,
        ws.staffing_role::text,
        ws.satisfies_lead_coverage,
        ws.starts_at::text,
        ws.ends_at::text,
        ws.attendance_state::text,
        ws.title,
        s.id AS shoot_id,
        s.shoot_code,
        s.title AS shoot_title,
        s.shoot_date::text,
        s.shoot_type::text,
        s.organization_id,
        org.display_name AS organization_display_name,
        s.location_id,
        sl.name AS location_name
      FROM work_shift ws
      JOIN app_user assigned
        ON assigned.id = ws.assigned_user_id
      LEFT JOIN shoot s
        ON s.tenant_id = ws.tenant_id
       AND s.id = ws.shoot_id
      LEFT JOIN organization org
        ON org.tenant_id = ws.tenant_id
       AND org.id = s.organization_id
      LEFT JOIN shoot_location sl
        ON sl.tenant_id = ws.tenant_id
       AND sl.id = s.location_id
      WHERE ws.tenant_id = $1
        AND ws.id = $2
        AND ws.cancelled_at IS NULL
      LIMIT 1
    `,
    [tenantId, shiftId]
  );
  return rows[0] ?? null;
}

async function hasSetupPhotoForShoot(client: PoolClient, tenantId: string, shootId: string) {
  const { rows } = await client.query<{ reviewed_at?: string | null; added_to_memory_at?: string | null }>(
    `
      SELECT reviewed_at, added_to_memory_at
      FROM (
        SELECT
          spu.reviewed_at::text,
          spu.added_to_memory_at::text
        FROM resource_library_item
        LEFT JOIN setup_photo_upload spu
          ON spu.tenant_id = resource_library_item.tenant_id
         AND spu.id = resource_library_item.source_record_id
         AND resource_library_item.source_record_type = 'setup_photo_upload'
        WHERE resource_library_item.tenant_id = $1
          AND resource_library_item.shoot_id = $2
          AND resource_library_item.category = 'setup_photo'
        UNION ALL
        SELECT
          reviewed_at::text,
          added_to_memory_at::text
        FROM setup_photo_upload
        WHERE tenant_id = $1
          AND shoot_id = $2
      ) items
      LIMIT 1
    `,
    [tenantId, shootId]
  );
  return rows[0]
    ? {
        uploaded: true,
        reviewed: Boolean(rows[0].reviewed_at),
        addedToMemory: Boolean(rows[0].added_to_memory_at)
      }
    : {
        uploaded: false,
        reviewed: false,
        addedToMemory: false
      };
}

async function loadLatestPostShootEvaluation(
  client: PoolClient,
  tenantId: string,
  shiftId: string,
  photographerUserId: string
) {
  const { rows } = await client.query<PostShootEvaluationRow>(
    `
      SELECT
        id,
        shift_id,
        shoot_id,
        photographer_user_id,
        eval_status::text AS eval_status,
        submitted_at::text,
        reviewed_at::text,
        closed_at::text,
        overall_outcome::text AS overall_outcome,
        overall_shoot_status::text,
        staffing_fit::text AS staffing_fit,
        setup_difficulty::text AS setup_difficulty,
        customer_school_readiness::text AS customer_school_readiness,
        data_roster_readiness::text AS data_roster_readiness,
        equipment_workflow_issue::text AS equipment_workflow_issue,
        started_on_time,
        short_summary_note,
        next_time_recommendation,
        follow_up_required,
        major_issue_flag,
        location_memory_update_suggested,
        leadership_review_needed,
        issue_category::text AS issue_category,
        understaffed_role,
        staffing_change_recommendation,
        customer_follow_up_needed,
        recommended_staffing_next_time,
        recommended_arrival_buffer_minutes,
        recommended_room_setup_change,
        special_gear_needed_next_time,
        top_watch_out,
        location_memory_promotion_text,
        went_well,
        remember_next_time,
        issue_flag,
        open_comment,
        submit_for_mileage,
        vehicle_type::text AS vehicle_type
      FROM post_shoot_evaluation
      WHERE tenant_id = $1
        AND shift_id = $2
        AND photographer_user_id = $3
      ORDER BY submitted_at DESC, created_at DESC
      LIMIT 1
    `,
    [tenantId, shiftId, photographerUserId]
  );
  return rows[0] ?? null;
}

async function loadLatestClockState(client: PoolClient, shiftId: string, userId: string) {
  const latestPunchResult = await client.query<{ direction: "in" | "out"; client_timestamp: string }>(
    `
      SELECT direction, client_timestamp::text
      FROM shift_punch
      WHERE shift_id = $1
        AND user_id = $2
      ORDER BY client_timestamp DESC, created_at DESC
      LIMIT 1
    `,
    [shiftId, userId]
  );
  return latestPunchResult.rows[0] ?? null;
}

async function loadOpenCloseoutAlert(client: PoolClient, shootId: string, alertType: string) {
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT id
      FROM alert
      WHERE shoot_id = $1
        AND alert_type = $2
        AND status = 'open'
      LIMIT 1
    `,
    [shootId, alertType]
  );
  return rows[0] ?? null;
}

async function ensureCloseoutAlert(
  client: PoolClient,
  input: {
    tenantId: string;
    shootId: string;
    shootCode: string | null;
    alertType: "MISSING_SETUP_PHOTO" | "MISSING_POST_SHOOT_EVALUATION";
    actorUserId: string | null;
    message: string;
    note: string;
  }
) {
  const existing = await loadOpenCloseoutAlert(client, input.shootId, input.alertType);
  if (existing) {
    return { id: existing.id, created: false };
  }

  const created = await client.query<{ id: string }>(
    `
      INSERT INTO alert (tenant_id, shoot_id, alert_type, message, metadata)
      VALUES ($1,$2,$3,$4,$5::jsonb)
      RETURNING id
    `,
    [
      input.tenantId,
      input.shootId,
      input.alertType,
      input.message,
      JSON.stringify({
        source: "post_shoot_closeout",
        note: input.note
      })
    ]
  );

  await createAuditLog(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    action:
      input.alertType === "MISSING_SETUP_PHOTO"
        ? "shoot.closeout.missing_setup_photo_alert.created"
        : "shoot.closeout.missing_post_shoot_evaluation_alert.created",
    entityType: "alert",
    entityId: created.rows[0].id,
    metadata: {
      shoot_id: input.shootId,
      shoot_code: input.shootCode,
      note: input.note
    }
  });

  return { id: created.rows[0].id, created: true };
}

async function resolveCloseoutAlert(
  client: PoolClient,
  input: {
    shootId: string;
    alertType: "MISSING_SETUP_PHOTO" | "MISSING_POST_SHOOT_EVALUATION";
    resolvedByUserId: string | null;
    resolutionNote: string;
  }
) {
  const { rows } = await client.query<{ id: string }>(
    `
      UPDATE alert
      SET
        status = 'resolved',
        resolved_at = now(),
        resolved_by = $3,
        resolution_note = $4,
        metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb
      WHERE shoot_id = $1
        AND alert_type = $2
        AND status = 'open'
      RETURNING id
    `,
    [
      input.shootId,
      input.alertType,
      input.resolvedByUserId,
      input.resolutionNote,
      JSON.stringify({
        resolved_from: "post_shoot_closeout"
      })
    ]
  );
  return rows[0] ?? null;
}

async function queueLeadershipCloseoutNotification(
  client: PoolClient,
  auth: AuthUser,
  input: {
    shiftId: string;
    shootId: string;
    managerUserId?: string | null;
    item: ShiftCloseoutItemCode;
    dedupeKey: string;
    submitterName: string;
    shootCode: string | null;
    shootTitle: string;
  }
) {
  const notificationType =
    input.item === "setup_photo" ? "shoot.closeout_missing_setup_photo" : "shoot.closeout_missing_post_shoot_evaluation";
  const recipients = await findNotificationRecipients(client, {
    tenantId: auth.tenantId,
    eventCode: notificationType,
    shiftId: input.shiftId,
    shootId: input.shootId,
    directUserIds: input.managerUserId ? [input.managerUserId] : [],
    excludeUserIds: [auth.id]
  });

  if (!recipients.length) {
    return;
  }

  await queueNotificationDispatch(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    recipientUserIds: recipients,
    notificationType,
    title:
      input.item === "setup_photo"
        ? "Shoot closed out without setup photo"
        : "Shoot closed out without Post-Shoot Evaluation",
    body:
      input.item === "setup_photo"
        ? `${input.submitterName} clocked out of ${input.shootCode ?? input.shootTitle} without a required setup photo upload.`
        : `${input.submitterName} clocked out of ${input.shootCode ?? input.shootTitle} without a required Post-Shoot Evaluation.`,
    priority: "high",
    deepLink: "/alerts",
    shiftId: input.shiftId,
    shootId: input.shootId,
    channels: ["in_app", "push", "email"],
    metadata: { dedupe: input.dedupeKey }
  });
}

async function queuePostShootIssueNotification(
  client: PoolClient,
  auth: AuthUser,
  input: {
    shiftId: string;
    shootId: string;
    managerUserId?: string | null;
    evaluationId: string;
    outcome: PostShootEvalOutcome;
    leadershipReviewNeeded: boolean;
    summary: string | null;
    shootCode: string | null;
    shootTitle: string;
  }
) {
  const recipients = await findNotificationRecipients(client, {
    tenantId: auth.tenantId,
    eventCode: input.leadershipReviewNeeded ? "shoot.closeout_eval_leadership_review" : "shoot.closeout_eval_follow_up",
    shiftId: input.shiftId,
    shootId: input.shootId,
    directUserIds: input.managerUserId ? [input.managerUserId] : [],
    excludeUserIds: [auth.id]
  });

  if (!recipients.length) {
    return;
  }

  const title = input.leadershipReviewNeeded
    ? `Leadership review flagged for ${input.shootCode ?? input.shootTitle}`
    : `Post-shoot follow-up flagged for ${input.shootCode ?? input.shootTitle}`;
  const body = input.summary
    ? input.summary
    : input.leadershipReviewNeeded
      ? "A submitted Post-Shoot Eval needs leadership review."
      : "A submitted Post-Shoot Eval needs manager follow-up.";

  await emitEvaluationFlaggedEvent(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    shiftId: input.shiftId,
    shootId: input.shootId,
    evaluationId: input.evaluationId,
    shootCode: input.shootCode ?? null,
    shootTitle: input.shootTitle,
    summary: body,
    recipientUserIds: recipients,
    leadershipReviewNeeded: input.leadershipReviewNeeded || input.outcome === "needs_leadership_review",
    channels: input.leadershipReviewNeeded ? ["in_app", "push", "email"] : ["in_app", "push"]
  });

  await queueRedFlagPostShootEvalAlert(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    shootId: input.shootId,
    evaluationId: input.evaluationId,
    shootCode: input.shootCode,
    shootTitle: input.shootTitle,
    summary: input.summary,
    outcome: input.outcome,
    leadershipReviewNeeded: input.leadershipReviewNeeded
  });
}

async function createPostShootArtifacts(
  client: PoolClient,
  auth: AuthUser,
  input: {
    shift: CloseoutShiftContext;
    evaluationId: string;
    outcome: PostShootEvalOutcome;
    followUpRequired: boolean;
    locationMemoryUpdateSuggested: boolean;
    leadershipReviewNeeded: boolean;
    issueCategory: PostShootIssueCategory | null;
    summary: string | null;
    nextTime: string | null;
    topWatchOut: string | null;
    staffingChange: string | null;
    locationMemoryPromotionText: string | null;
  },
  meta: RequestMeta
) {
  let sourceNoteId: string | null = null;

  if (input.followUpRequired && input.shift.shoot_id) {
    const followUpNote = await createOperationalNote(
      client,
      auth,
      {
        objectType: "shoot",
        objectId: input.shift.shoot_id,
        noteType: "post_shoot_follow_up",
        body: buildFollowUpNoteBody(input.shift, {
          outcome: input.outcome,
          issueCategory: input.issueCategory,
          summary: input.summary,
          nextTime: input.nextTime,
          topWatchOut: input.topWatchOut,
          staffingChange: input.staffingChange
        }),
        pinned: Boolean(input.leadershipReviewNeeded),
        visibilityScope: input.leadershipReviewNeeded ? "managers_and_leadership" : "assigned_staff_and_managers",
        sourceContext: "post_shoot_eval",
        mentionMetadata: [],
        attachmentRefs: [
          {
            kind: "post_shoot_evaluation",
            id: input.evaluationId
          }
        ]
      },
      meta
    );
    sourceNoteId = followUpNote.id;
  }

  if (input.locationMemoryUpdateSuggested && input.shift.location_id && input.shift.shoot_id) {
    const memorySourceNoteId = sourceNoteId
      ? sourceNoteId
      : (
          await createOperationalNote(
            client,
            auth,
            {
              objectType: "shoot",
              objectId: input.shift.shoot_id,
              noteType: "post_shoot_follow_up",
              body:
                input.locationMemoryPromotionText ??
                input.topWatchOut ??
                input.nextTime ??
                input.summary ??
                "Promote this reusable location guidance into memory for future crews.",
              pinned: false,
              visibilityScope: "assigned_staff_and_managers",
              sourceContext: "post_shoot_eval_memory_seed",
              mentionMetadata: [],
              attachmentRefs: [
                {
                  kind: "post_shoot_evaluation",
                  id: input.evaluationId
                }
              ]
            },
            meta
          )
        ).id;

    await promoteOperationalNoteToLocationMemory(
      client,
      auth,
      memorySourceNoteId,
      {
        targetLocationId: input.shift.location_id,
        body:
          input.locationMemoryPromotionText ??
          input.topWatchOut ??
          input.nextTime ??
          input.summary ??
          "Reusable location guidance was suggested from the latest shoot closeout.",
        pinned: Boolean(input.topWatchOut),
        sourceContext: "post_shoot_eval"
      },
      meta
    );
  }
}

export async function resolveSetupPhotoCloseoutArtifacts(
  client: PoolClient,
  input: { shootId: string | null; resolvedByUserId: string | null; resolutionNote: string }
) {
  if (!input.shootId) {
    return null;
  }
  return resolveCloseoutAlert(client, {
    shootId: input.shootId,
    alertType: "MISSING_SETUP_PHOTO",
    resolvedByUserId: input.resolvedByUserId,
    resolutionNote: input.resolutionNote
  });
}

export async function getShiftCloseoutCompliance(
  client: PoolClient,
  input: { tenantId: string; shiftId: string; submitterUserId: string }
): Promise<ShiftCloseoutCompliance | null> {
  const shift = await loadShiftCloseoutContext(client, input.tenantId, input.shiftId);
  if (!shift || !shift.shoot_id) {
    return null;
  }

  const setupPhotoRequired = requiresLeadCloseout(shift);
  // Owner rule #1 (ratified 2026-07-13): every worker on a shoot owes an eval,
  // not just leads/seniors. The flag existed but never reached this gate — the
  // obligations read model already counted associates as owing; the enforcement
  // gate and the read model now agree. Setup photos stay a lead duty.
  const postShootEvaluationRequired =
    requiresLeadCloseout(shift) ||
    (shift.shift_kind === "shoot" && Boolean(shift.shoot_id) && config.JOB_CLOSEOUT_REQUIRE_ASSOCIATE_EVALUATION);
  const setupPhotoRecord = await hasSetupPhotoForShoot(client, input.tenantId, shift.shoot_id);
  const latestEvaluation = await loadLatestPostShootEvaluation(client, input.tenantId, shift.id, input.submitterUserId);
  const latestPunch = await loadLatestClockState(client, shift.id, input.submitterUserId);
  const setupPhotoUploaded = setupPhotoRecord.uploaded;

  const reminderAnchor = latestPunch?.direction === "in" ? latestPunch.client_timestamp : shift.starts_at;
  const reminderDue =
    setupPhotoRequired &&
    !setupPhotoUploaded &&
    latestPunch?.direction === "in" &&
    Date.now() - new Date(reminderAnchor).getTime() >= SETUP_PHOTO_REMINDER_THRESHOLD_MINUTES * 60 * 1000;

  const missingRequiredItems: ShiftCloseoutItemCode[] = [];
  if (setupPhotoRequired && !setupPhotoUploaded) {
    missingRequiredItems.push("setup_photo");
  }
  if (postShootEvaluationRequired && (!latestEvaluation || latestEvaluation.eval_status === "draft")) {
    missingRequiredItems.push("post_shoot_evaluation");
  }

  const workDate = shift.shoot_date ?? shift.starts_at.slice(0, 10);
  const mileageReimbursement = await getMileageReimbursementForEmployeeDate(client, {
    tenantId: input.tenantId,
    employeeId: input.submitterUserId,
    workDate
  });
  const complianceFlags = await listShiftTimeClockComplianceFlags(client, {
    tenantId: input.tenantId,
    employeeId: input.submitterUserId,
    shiftId: shift.id,
    shootId: shift.shoot_id
  });

  return {
    shift_id: shift.id,
    shoot_id: shift.shoot_id,
    organization_id: shift.organization_id,
    location_id: shift.location_id,
    reminder_threshold_minutes: SETUP_PHOTO_REMINDER_THRESHOLD_MINUTES,
    setup_photo_required: setupPhotoRequired,
    setup_photo_uploaded: setupPhotoUploaded,
    setup_photo_reminder_due: reminderDue,
    setup_photo_state: buildSetupPhotoState({
      required: setupPhotoRequired,
      uploaded: setupPhotoRecord.uploaded,
      reviewed: setupPhotoRecord.reviewed,
      addedToMemory: setupPhotoRecord.addedToMemory
    }),
    post_shoot_evaluation_required: postShootEvaluationRequired,
    post_shoot_evaluation_submitted: Boolean(latestEvaluation?.eval_status && latestEvaluation.eval_status !== "draft"),
    post_shoot_evaluation_state: buildPostShootEvaluationState(latestEvaluation),
    missing_required_items: missingRequiredItems,
    last_post_shoot_evaluation: latestEvaluation
      ? {
          id: latestEvaluation.id,
          eval_status: latestEvaluation.eval_status,
          submitted_at: latestEvaluation.submitted_at,
          reviewed_at: latestEvaluation.reviewed_at,
          closed_at: latestEvaluation.closed_at,
          overall_outcome: latestEvaluation.overall_outcome,
          overall_shoot_status: latestEvaluation.overall_shoot_status,
          staffing_fit: latestEvaluation.staffing_fit,
          setup_difficulty: latestEvaluation.setup_difficulty,
          customer_school_readiness: latestEvaluation.customer_school_readiness,
          data_roster_readiness: latestEvaluation.data_roster_readiness,
          equipment_workflow_issue: latestEvaluation.equipment_workflow_issue,
          started_on_time: latestEvaluation.started_on_time,
          short_summary_note: latestEvaluation.short_summary_note ?? null,
          next_time_recommendation: latestEvaluation.next_time_recommendation ?? null,
          follow_up_required: Boolean(latestEvaluation.follow_up_required),
          major_issue_flag: Boolean(latestEvaluation.major_issue_flag),
          location_memory_update_suggested: Boolean(latestEvaluation.location_memory_update_suggested),
          leadership_review_needed: Boolean(latestEvaluation.leadership_review_needed),
          issue_category: latestEvaluation.issue_category ?? null,
          understaffed_role: latestEvaluation.understaffed_role ?? null,
          staffing_change_recommendation: latestEvaluation.staffing_change_recommendation ?? null,
          customer_follow_up_needed: Boolean(latestEvaluation.customer_follow_up_needed),
          recommended_staffing_next_time:
            latestEvaluation.recommended_staffing_next_time === null ? null : Number(latestEvaluation.recommended_staffing_next_time),
          recommended_arrival_buffer_minutes:
            latestEvaluation.recommended_arrival_buffer_minutes === null ? null : Number(latestEvaluation.recommended_arrival_buffer_minutes),
          recommended_room_setup_change: latestEvaluation.recommended_room_setup_change ?? null,
          special_gear_needed_next_time: latestEvaluation.special_gear_needed_next_time ?? null,
          top_watch_out: latestEvaluation.top_watch_out ?? null,
          location_memory_promotion_text: latestEvaluation.location_memory_promotion_text ?? null,
          went_well: latestEvaluation.went_well ?? null,
          remember_next_time: latestEvaluation.remember_next_time ?? null,
          issue_flag: Boolean(latestEvaluation.issue_flag),
          open_comment: latestEvaluation.open_comment ?? null,
          submit_for_mileage: Boolean(latestEvaluation.submit_for_mileage),
          vehicle_type: latestEvaluation.vehicle_type ?? null
        }
      : null,
    mileage_reimbursement: mileageReimbursement,
    compliance_flags: complianceFlags.map((flag) => ({
      id: flag.id,
      item_type: flag.item_type,
      item_label: flag.item_label,
      severity: flag.severity,
      message: flag.message,
      last_detected_at: flag.last_detected_at
    }))
  };
}

export async function submitPostShootEvaluationForShift(
  client: PoolClient,
  auth: AuthUser,
  shiftId: string,
  input: SubmitPostShootEvaluationInput,
  meta: RequestMeta = {}
) {
  await assertShiftAccess(client, auth, shiftId);

  const shift = await loadShiftCloseoutContext(client, auth.tenantId, shiftId);
  if (!shift) {
    throw new ApiError(404, "Shift not found");
  }
  if (shift.shift_kind !== "shoot" || !shift.shoot_id) {
    throw new ApiError(409, "Post-Shoot Evaluation is only available for shoot shifts");
  }
  const permissionContext = withDepartmentContext("photography", {
    organizationId: shift.organization_id,
    locationId: shift.location_id,
    ownerUserIds: [shift.manager_user_id],
    assignedUserIds: [shift.assigned_user_id],
    targetUserId: shift.assigned_user_id,
    customScopeValues: shift.staffing_role ? [shift.staffing_role] : []
  });
  if (!shift.organization_id || !shift.location_id) {
    throw new ApiError(409, "This Shoot must be linked to an Organization and Location before submitting a Post-Shoot Evaluation");
  }
  if (!canCreatePostShootEvaluations(auth, permissionContext)) {
    throw new ApiError(403, "Forbidden");
  }
  if (String(shift.assigned_user_id) !== auth.id && !hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Only the assigned staff member or leadership can submit this Post-Shoot Evaluation");
  }

  const targetEmployeeId = String(shift.assigned_user_id);
  const targetPhotographerName = shift.assigned_user_name?.trim() || auth.fullName;
  const evalStatus = deriveEvalStatus(input);
  const existing = await loadLatestPostShootEvaluation(client, auth.tenantId, shift.id, targetEmployeeId);
  if (existing && existing.eval_status !== "draft" && !hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(409, "Post-Shoot Evaluation already submitted. Standard users cannot edit it after submission.");
  }
  if (existing && existing.eval_status !== "draft" && !canUpdatePostShootEvaluations(auth, permissionContext)) {
    throw new ApiError(403, "Forbidden");
  }
  if (existing?.eval_status === "closed" && !hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(409, "This Post-Shoot Eval is already closed. Ask a manager or leadership user to reopen it.");
  }
  const outcome = deriveOutcome(input);
  validatePostShootEvaluationInput(evalStatus, input, outcome);
  const legacyStatus = input.overall_shoot_status ?? outcomeToLegacyStatus(outcome);
  const followUpRequired = deriveFollowUpRequired(input, outcome);
  const majorIssueFlag = deriveMajorIssueFlag(input, outcome);
  const locationMemoryUpdateSuggested = deriveLocationMemorySuggested(input);
  const leadershipReviewNeeded = deriveLeadershipReviewNeeded(input, outcome);
  if (leadershipReviewNeeded && !canViewSensitivePostShootEvaluations(auth, permissionContext)) {
    throw new ApiError(403, "Only approved reviewers can flag leadership-sensitive Post-Shoot Evaluation items.");
  }
  const issueCategory = deriveIssueCategory(input, outcome);
  const followUpOwnerUserId = deriveDefaultFollowUpOwnerId(input, shift);
  const shortSummaryNote = normalizeOptionalText(input.short_summary_note ?? input.open_comment ?? null);
  const nextTimeRecommendation = normalizeOptionalText(input.next_time_recommendation ?? input.remember_next_time ?? null);
  const topWatchOut = normalizeOptionalText(input.top_watch_out);
  const locationMemoryPromotionText = normalizeOptionalText(input.location_memory_promotion_text);
  const staffingChangeRecommendation = normalizeOptionalText(input.staffing_change_recommendation);
  const submitForMileage = Boolean(input.submit_for_mileage);
  const vehicleType = input.vehicle_type ?? null;
  assertMileageVehicleTypeForSubmission(submitForMileage, vehicleType);

  const compliance = await getShiftCloseoutCompliance(client, {
    tenantId: auth.tenantId,
    shiftId,
    submitterUserId: targetEmployeeId
  });
  const setupPhotoUploaded = compliance?.setup_photo_uploaded ?? false;
  const shootDate = shift.shoot_date ?? shift.starts_at.slice(0, 10);
  const legacyRating = overallStatusToLegacyRating(legacyStatus);
  const onTime =
    typeof input.started_on_time === "boolean"
      ? input.started_on_time
        ? "Yes"
        : "No"
      : attendanceStateToLegacyOnTime(shift.attendance_state);
  const easyAccess =
    input.setup_difficulty === "high" || input.customer_school_readiness === "major_friction" || majorIssueFlag ? "No" : "Yes";
  const rememberedWhatWentWell = normalizeOptionalText(input.went_well);
  const rememberedRememberNextTime = normalizeOptionalText(input.remember_next_time);
  const openComment = normalizeOptionalText(input.open_comment);
  const understaffedRole = normalizeOptionalText(input.understaffed_role);
  const roomSetupChange = normalizeOptionalText(input.recommended_room_setup_change);
  const specialGearNeededNextTime = normalizeOptionalText(input.special_gear_needed_next_time);
  const recommendedStaffingNextTime = normalizeOptionalInteger(input.recommended_staffing_next_time);
  const recommendedArrivalBufferMinutes = normalizeOptionalInteger(input.recommended_arrival_buffer_minutes);
  const submittedAtValue = evalStatus === "submitted" ? new Date().toISOString() : existing?.submitted_at ?? null;
  const reviewStateReset =
    evalStatus === "draft"
      ? {
          reviewed_at: null,
          reviewed_by_user_id: null,
          review_note: null,
          closed_at: null,
          closed_by_user_id: null,
          close_note: null
        }
      : null;

  const persisted = await client.query<{
    id: string;
    submitted_at: string | null;
    eval_status: PostShootEvalStatus;
  }>(
    `
      INSERT INTO post_shoot_evaluation (
        tenant_id,
        organization_id,
        location_id,
        shift_id,
        shoot_id,
        shoot_name,
        shoot_date,
        photographer_user_id,
        photographer_name,
        shoot_type,
        on_time,
        easy_access,
        overall_rating,
        photos_uploaded,
        notes,
        outreach_notes,
        recommendations,
        submitted_by_user_id,
        source,
        raw_payload,
        evaluation_year,
        eval_status,
        overall_outcome,
        eval_owner_user_id,
        staffing_fit,
        setup_difficulty,
        customer_school_readiness,
        data_roster_readiness,
        equipment_workflow_issue,
        started_on_time,
        short_summary_note,
        next_time_recommendation,
        follow_up_required,
        major_issue_flag,
        location_memory_update_suggested,
        leadership_review_needed,
        issue_category,
        understaffed_role,
        staffing_change_recommendation,
        customer_follow_up_needed,
        follow_up_owner_user_id,
        recommended_staffing_next_time,
        recommended_arrival_buffer_minutes,
        recommended_room_setup_change,
        special_gear_needed_next_time,
        top_watch_out,
        location_memory_promotion_text,
        overall_shoot_status,
        went_well,
        remember_next_time,
        issue_flag,
        open_comment,
        submit_for_mileage,
        vehicle_type,
        submitted_at,
        submitter_locked
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'mission_control',$19::jsonb,
        $20,$21::post_shoot_eval_status,$22::post_shoot_eval_outcome,$23,$24::post_shoot_eval_staffing_fit,
        $25::post_shoot_eval_setup_difficulty,$26::post_shoot_eval_readiness_state,$27::post_shoot_eval_readiness_state,
        $28::post_shoot_eval_issue_state,$29,$30,$31,$32,$33,$34,$35,$36::post_shoot_issue_category,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,
        $47::post_shoot_overall_status,$48,$49,$50,$51,$52,$53::mileage_vehicle_type,$54,$55
      )
      ON CONFLICT (tenant_id, shift_id, photographer_user_id)
      WHERE shift_id IS NOT NULL AND photographer_user_id IS NOT NULL
      DO UPDATE SET
        on_time = EXCLUDED.on_time,
        easy_access = EXCLUDED.easy_access,
        overall_rating = EXCLUDED.overall_rating,
        photos_uploaded = EXCLUDED.photos_uploaded,
        notes = EXCLUDED.notes,
        outreach_notes = EXCLUDED.outreach_notes,
        recommendations = EXCLUDED.recommendations,
        raw_payload = EXCLUDED.raw_payload,
        evaluation_year = EXCLUDED.evaluation_year,
        eval_status = EXCLUDED.eval_status,
        overall_outcome = EXCLUDED.overall_outcome,
        eval_owner_user_id = EXCLUDED.eval_owner_user_id,
        staffing_fit = EXCLUDED.staffing_fit,
        setup_difficulty = EXCLUDED.setup_difficulty,
        customer_school_readiness = EXCLUDED.customer_school_readiness,
        data_roster_readiness = EXCLUDED.data_roster_readiness,
        equipment_workflow_issue = EXCLUDED.equipment_workflow_issue,
        started_on_time = EXCLUDED.started_on_time,
        short_summary_note = EXCLUDED.short_summary_note,
        next_time_recommendation = EXCLUDED.next_time_recommendation,
        follow_up_required = EXCLUDED.follow_up_required,
        major_issue_flag = EXCLUDED.major_issue_flag,
        location_memory_update_suggested = EXCLUDED.location_memory_update_suggested,
        leadership_review_needed = EXCLUDED.leadership_review_needed,
        issue_category = EXCLUDED.issue_category,
        understaffed_role = EXCLUDED.understaffed_role,
        staffing_change_recommendation = EXCLUDED.staffing_change_recommendation,
        customer_follow_up_needed = EXCLUDED.customer_follow_up_needed,
        follow_up_owner_user_id = EXCLUDED.follow_up_owner_user_id,
        recommended_staffing_next_time = EXCLUDED.recommended_staffing_next_time,
        recommended_arrival_buffer_minutes = EXCLUDED.recommended_arrival_buffer_minutes,
        recommended_room_setup_change = EXCLUDED.recommended_room_setup_change,
        special_gear_needed_next_time = EXCLUDED.special_gear_needed_next_time,
        top_watch_out = EXCLUDED.top_watch_out,
        location_memory_promotion_text = EXCLUDED.location_memory_promotion_text,
        overall_shoot_status = EXCLUDED.overall_shoot_status,
        went_well = EXCLUDED.went_well,
        remember_next_time = EXCLUDED.remember_next_time,
        issue_flag = EXCLUDED.issue_flag,
        open_comment = EXCLUDED.open_comment,
        submit_for_mileage = EXCLUDED.submit_for_mileage,
        vehicle_type = EXCLUDED.vehicle_type,
        submitted_at = EXCLUDED.submitted_at,
        submitter_locked = EXCLUDED.submitter_locked,
        reviewed_at = ${reviewStateReset ? "NULL" : "post_shoot_evaluation.reviewed_at"},
        reviewed_by_user_id = ${reviewStateReset ? "NULL" : "post_shoot_evaluation.reviewed_by_user_id"},
        review_note = ${reviewStateReset ? "NULL" : "post_shoot_evaluation.review_note"},
        closed_at = ${reviewStateReset ? "NULL" : "post_shoot_evaluation.closed_at"},
        closed_by_user_id = ${reviewStateReset ? "NULL" : "post_shoot_evaluation.closed_by_user_id"},
        close_note = ${reviewStateReset ? "NULL" : "post_shoot_evaluation.close_note"},
        updated_at = now()
      RETURNING id, submitted_at::text, eval_status::text AS eval_status
    `,
    [
      auth.tenantId,
      shift.organization_id,
      shift.location_id,
      shift.id,
      shift.shoot_id,
      shift.shoot_title ?? shift.title,
      shootDate,
      targetEmployeeId,
      targetPhotographerName,
      shift.shoot_type ?? "Unspecified",
      onTime,
      easyAccess,
      legacyRating,
      setupPhotoUploaded ? "Yes" : "No",
      input.open_comment?.trim() || null,
      input.went_well?.trim() || null,
      input.remember_next_time?.trim() || null,
      auth.id,
      JSON.stringify({
        form_version: "post_shoot_evaluation_v2",
        eval_status: evalStatus,
        overall_outcome: outcome,
        overall_shoot_status: legacyStatus,
        staffing_fit: input.staffing_fit ?? null,
        setup_difficulty: input.setup_difficulty ?? null,
        customer_school_readiness: input.customer_school_readiness ?? null,
        data_roster_readiness: input.data_roster_readiness ?? null,
        equipment_workflow_issue: input.equipment_workflow_issue ?? null,
        started_on_time: input.started_on_time ?? null,
        short_summary_note: shortSummaryNote,
        next_time_recommendation: nextTimeRecommendation,
        follow_up_required: followUpRequired,
        major_issue_flag: majorIssueFlag,
        location_memory_update_suggested: locationMemoryUpdateSuggested,
        leadership_review_needed: leadershipReviewNeeded,
        issue_category: issueCategory,
        understaffed_role: understaffedRole,
        staffing_change_recommendation: staffingChangeRecommendation,
        customer_follow_up_needed: Boolean(input.customer_follow_up_needed),
        follow_up_owner_user_id: followUpOwnerUserId,
        recommended_staffing_next_time: recommendedStaffingNextTime,
        recommended_arrival_buffer_minutes: recommendedArrivalBufferMinutes,
        recommended_room_setup_change: roomSetupChange,
        special_gear_needed_next_time: specialGearNeededNextTime,
        top_watch_out: topWatchOut,
        location_memory_promotion_text: locationMemoryPromotionText,
        went_well: rememberedWhatWentWell,
        remember_next_time: rememberedRememberNextTime,
        issue_flag: Boolean(input.issue_flag),
        open_comment: openComment,
        setup_photo_uploaded: setupPhotoUploaded,
        submit_for_mileage: submitForMileage,
        vehicle_type: vehicleType
      }),
      new Date(`${shootDate}T12:00:00`).getFullYear(),
      evalStatus,
      outcome,
      targetEmployeeId,
      input.staffing_fit ?? null,
      input.setup_difficulty ?? null,
      input.customer_school_readiness ?? null,
      input.data_roster_readiness ?? null,
      input.equipment_workflow_issue ?? null,
      typeof input.started_on_time === "boolean" ? input.started_on_time : null,
      shortSummaryNote,
      nextTimeRecommendation,
      followUpRequired,
      majorIssueFlag,
      locationMemoryUpdateSuggested,
      leadershipReviewNeeded,
      issueCategory,
      understaffedRole,
      staffingChangeRecommendation,
      Boolean(input.customer_follow_up_needed),
      followUpOwnerUserId,
      recommendedStaffingNextTime,
      recommendedArrivalBufferMinutes,
      roomSetupChange,
      specialGearNeededNextTime,
      topWatchOut,
      locationMemoryPromotionText,
      legacyStatus,
      rememberedWhatWentWell,
      rememberedRememberNextTime,
      Boolean(input.issue_flag),
      openComment,
      submitForMileage,
      vehicleType,
      submittedAtValue,
      evalStatus === "submitted"
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: targetEmployeeId,
    action: evalStatus === "draft" ? "shoot.post_shoot_evaluation.draft_saved" : "shoot.post_shoot_evaluation.submitted",
    entityType: "post_shoot_evaluation",
    entityId: persisted.rows[0].id,
    metadata: {
      shift_id: shift.id,
      shoot_id: shift.shoot_id,
      organization_id: shift.organization_id,
      location_id: shift.location_id,
      eval_status: evalStatus,
      overall_outcome: outcome,
      overall_shoot_status: legacyStatus,
      follow_up_required: followUpRequired,
      major_issue_flag: majorIssueFlag,
      location_memory_update_suggested: locationMemoryUpdateSuggested,
      leadership_review_needed: leadershipReviewNeeded,
      submit_for_mileage: submitForMileage,
      vehicle_type: vehicleType
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  if (evalStatus === "submitted") {
    await recalculateMileageForEmployeeDate(client, {
      tenantId: auth.tenantId,
      employeeId: targetEmployeeId,
      workDate: shootDate,
      actorUserId: auth.id,
      reason: "Post-Shoot Evaluation updated mileage reimbursement state"
    });

    await resolveCloseoutAlert(client, {
      shootId: shift.shoot_id,
      alertType: "MISSING_POST_SHOOT_EVALUATION",
      resolvedByUserId: auth.id,
      resolutionNote: "Post-Shoot Evaluation submitted from Mission Control closeout."
    });

    await createPostShootArtifacts(
      client,
      auth,
      {
        shift,
        evaluationId: persisted.rows[0].id,
        outcome,
        followUpRequired,
        locationMemoryUpdateSuggested,
        leadershipReviewNeeded,
        issueCategory,
        summary: shortSummaryNote ?? openComment,
        nextTime: nextTimeRecommendation,
        topWatchOut,
        staffingChange: staffingChangeRecommendation,
        locationMemoryPromotionText
      },
      meta
    );

    if (followUpRequired || leadershipReviewNeeded) {
      await queuePostShootIssueNotification(client, auth, {
        shiftId: shift.id,
        shootId: shift.shoot_id,
        managerUserId: shift.manager_user_id ?? null,
        evaluationId: persisted.rows[0].id,
        outcome,
        leadershipReviewNeeded,
        summary: shortSummaryNote ?? openComment,
        shootCode: shift.shoot_code ?? null,
        shootTitle: shift.shoot_title ?? shift.title
      });
    }
  }

  const mileageReimbursement = await getMileageReimbursementForEmployeeDate(client, {
    tenantId: auth.tenantId,
    employeeId: targetEmployeeId,
    workDate: shootDate
  });

  const updatedCompliance = await getShiftCloseoutCompliance(client, {
    tenantId: auth.tenantId,
    shiftId,
    submitterUserId: targetEmployeeId
  });
  if (updatedCompliance) {
    await syncShiftCloseoutComplianceFlags(client, {
      tenantId: auth.tenantId,
      employeeId: targetEmployeeId,
      shiftId: shift.id,
      shootId: shift.shoot_id,
      organizationId: shift.organization_id,
      locationId: shift.location_id,
      shootCode: shift.shoot_code,
      shootTitle: shift.shoot_title ?? shift.title,
      reminderThresholdMinutes: updatedCompliance.reminder_threshold_minutes,
      setupPhotoRequired: updatedCompliance.setup_photo_required,
      setupPhotoUploaded: updatedCompliance.setup_photo_uploaded,
      postShootEvaluationRequired: updatedCompliance.post_shoot_evaluation_required,
      postShootEvaluationSubmitted: updatedCompliance.post_shoot_evaluation_submitted,
      mileageReimbursement: updatedCompliance.mileage_reimbursement,
      actorUserId: auth.id,
      source: "evaluation_submitted"
    });
  }
  const finalCompliance = await getShiftCloseoutCompliance(client, {
    tenantId: auth.tenantId,
    shiftId,
    submitterUserId: targetEmployeeId
  });

  if (evalStatus === "submitted" && (followUpRequired || legacyStatus !== "successful")) {
    const issueSummary =
      shortSummaryNote ||
      openComment ||
      nextTimeRecommendation ||
      rememberedWhatWentWell ||
      "Post-shoot evaluation flagged follow-up work for production.";
    await triggerProductionProjectFromPostShootIssue(client, auth, {
      evaluationId: persisted.rows[0].id,
      shootId: shift.shoot_id,
      shootCode: shift.shoot_code ?? null,
      shootTitle: shift.shoot_title ?? shift.title,
      shootDate,
      organizationId: shift.organization_id,
      locationId: shift.location_id,
      ownerUserId: shift.manager_user_id ?? null,
      issueSummary
    });
  }

  return {
    evaluation: {
      id: persisted.rows[0].id,
      shift_id: shift.id,
      shoot_id: shift.shoot_id,
      organization_id: shift.organization_id,
      organization_display_name: shift.organization_display_name,
      location_id: shift.location_id,
      location_name: shift.location_name,
      eval_status: persisted.rows[0].eval_status,
      submitted_at: persisted.rows[0].submitted_at,
      overall_outcome: outcome,
      overall_shoot_status: legacyStatus,
      staffing_fit: input.staffing_fit ?? null,
      setup_difficulty: input.setup_difficulty ?? null,
      customer_school_readiness: input.customer_school_readiness ?? null,
      data_roster_readiness: input.data_roster_readiness ?? null,
      equipment_workflow_issue: input.equipment_workflow_issue ?? null,
      started_on_time: typeof input.started_on_time === "boolean" ? input.started_on_time : null,
      short_summary_note: shortSummaryNote,
      next_time_recommendation: nextTimeRecommendation,
      follow_up_required: followUpRequired,
      major_issue_flag: majorIssueFlag,
      location_memory_update_suggested: locationMemoryUpdateSuggested,
      leadership_review_needed: leadershipReviewNeeded,
      issue_category: issueCategory,
      understaffed_role: understaffedRole,
      staffing_change_recommendation: staffingChangeRecommendation,
      customer_follow_up_needed: Boolean(input.customer_follow_up_needed),
      recommended_staffing_next_time: recommendedStaffingNextTime,
      recommended_arrival_buffer_minutes: recommendedArrivalBufferMinutes,
      recommended_room_setup_change: roomSetupChange,
      special_gear_needed_next_time: specialGearNeededNextTime,
      top_watch_out: topWatchOut,
      location_memory_promotion_text: locationMemoryPromotionText,
      went_well: rememberedWhatWentWell,
      remember_next_time: rememberedRememberNextTime,
      issue_flag: Boolean(input.issue_flag),
      open_comment: openComment,
      submit_for_mileage: submitForMileage,
      vehicle_type: vehicleType
    },
    closeout_compliance: finalCompliance,
    mileage_reimbursement: mileageReimbursement
  };
}

export async function handleClockOutCloseoutCompliance(
  client: PoolClient,
  auth: AuthUser,
  input: { shiftId?: string | null; shootId?: string | null; targetUserId: string },
  meta: RequestMeta = {}
) {
  if (!input.shiftId || !input.shootId) {
    return null;
  }

  const shift = await loadShiftCloseoutContext(client, auth.tenantId, input.shiftId);
  if (!shift || !shift.shoot_id) {
    return null;
  }

  const compliance = await getShiftCloseoutCompliance(client, {
    tenantId: auth.tenantId,
    shiftId: input.shiftId,
    submitterUserId: input.targetUserId
  });

  if (!compliance || !compliance.missing_required_items.length) {
    return compliance;
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: input.targetUserId,
    action: "shoot.closeout.incomplete_at_clock_out",
    entityType: "work_shift",
    entityId: shift.id,
    metadata: {
      shoot_id: shift.shoot_id,
      missing_required_items: compliance.missing_required_items
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  for (const item of compliance.missing_required_items) {
    const alertType = item === "setup_photo" ? "MISSING_SETUP_PHOTO" : "MISSING_POST_SHOOT_EVALUATION";
    const message =
      item === "setup_photo"
        ? `Setup photo missing for shoot ${shift.shoot_code ?? shift.shoot_title ?? shift.title}`
        : `Post-Shoot Evaluation missing for shoot ${shift.shoot_code ?? shift.shoot_title ?? shift.title}`;
    const alert = await ensureCloseoutAlert(client, {
      tenantId: auth.tenantId,
      shootId: shift.shoot_id,
      shootCode: shift.shoot_code,
      alertType,
      actorUserId: auth.id,
      message,
      note: `Clock-out captured while ${item === "setup_photo" ? "setup photo upload" : "Post-Shoot Evaluation"} was still missing.`
    });
    if (alert.created) {
      await queueLeadershipCloseoutNotification(client, auth, {
        shiftId: shift.id,
        shootId: shift.shoot_id,
        managerUserId: shift.manager_user_id ?? null,
        item,
        dedupeKey: `closeout:${shift.id}:${item}`,
        submitterName: auth.fullName,
        shootCode: shift.shoot_code,
        shootTitle: shift.shoot_title ?? shift.title
      });
    }
  }

  const workDate = shift.shoot_date ?? shift.starts_at.slice(0, 10);
  await syncMileageReviewForShiftCloseout(client, {
    tenantId: auth.tenantId,
    employeeId: input.targetUserId,
    workDate,
    actorUserId: auth.id
  });
  const updatedCompliance = await getShiftCloseoutCompliance(client, {
    tenantId: auth.tenantId,
    shiftId: input.shiftId,
    submitterUserId: input.targetUserId
  });
  if (updatedCompliance) {
    await syncShiftCloseoutComplianceFlags(client, {
      tenantId: auth.tenantId,
      employeeId: input.targetUserId,
      shiftId: shift.id,
      shootId: shift.shoot_id,
      organizationId: shift.organization_id,
      locationId: shift.location_id,
      shootCode: shift.shoot_code,
      shootTitle: shift.shoot_title ?? shift.title,
      reminderThresholdMinutes: updatedCompliance.reminder_threshold_minutes,
      setupPhotoRequired: updatedCompliance.setup_photo_required,
      setupPhotoUploaded: updatedCompliance.setup_photo_uploaded,
      postShootEvaluationRequired: updatedCompliance.post_shoot_evaluation_required,
      postShootEvaluationSubmitted: updatedCompliance.post_shoot_evaluation_submitted,
      mileageReimbursement: updatedCompliance.mileage_reimbursement,
      actorUserId: auth.id,
      source: "clock_out"
    });
  }
  const finalCompliance = await getShiftCloseoutCompliance(client, {
    tenantId: auth.tenantId,
    shiftId: input.shiftId,
    submitterUserId: input.targetUserId
  });

  return {
    ...(finalCompliance ?? compliance),
    warning_message: buildMissingCloseoutMessage(
      (finalCompliance ?? compliance).missing_required_items,
      (finalCompliance ?? compliance).mileage_reimbursement
    )
  };
}
