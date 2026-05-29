import type { PoolClient } from "pg";
import { canCreateOrEditCalendarDepartment } from "../authz/authority.js";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import {
  createStaffingLeadCoverageRequirement,
  validateStaffingCoverage,
  type StaffingAssignment,
  type StaffingRequirement
} from "../domain/staffing/index.js";
import type { AuthUser, DepartmentCode } from "../types/auth.js";
import { createStaffingConflictEvaluationResult } from "../domain/staffing/staffing-conflict.js";
import { evaluateLastMinuteStaffingChange } from "../domain/staffing/staffing-last-minute-change-evaluator.js";
import { createAuditLog } from "./audit.js";
import {
  loadAvailabilityWindowsForUsersOnDate,
  type AvailabilityWindow
} from "./availabilityRequests.js";
import {
  getApprovalLevelLabel,
  hasManagerApprovalAuthority,
  resolvePhase1RoleGroup,
  resolveStaffingApprovalLevel
} from "./approvalRights.js";
import { getScheduleStaffingConfiguration } from "./adminConfiguration.js";
import { assertShootAccess } from "./shootAccess.js";
import {
  createShift,
  listScheduleMembers,
  publishShift,
  updateShift,
  type WorkShiftInput
} from "./scheduling.js";
import { listOutlookBusyWindowsForUsers, type OutlookBusyWindow } from "./outlookCalendarGraph.js";
import {
  queueWorkShiftOutlookSync,
  type WorkShiftOutlookConflictStatus
} from "./outlookCalendarSync.js";
import { queueNotificationDispatch } from "./opsNotifications.js";
import { queueStaffAssignmentConflictDetectedAlert } from "./operationalAlerting.js";
import {
  consumeApprovedOperationalApproval,
  ensureOperationalApprovalRequest,
  listOperationalApprovalSourceSummary,
  markOperationalApprovalExecuted
} from "./operationalApprovals.js";
import {
  evaluateShootPriority,
  humanizePriorityLabel,
  humanizeProfitabilityFlag,
  importanceRank
} from "./shootPriority.js";
import { canViewStrategicShootSignals } from "../authz/authority.js";
import type {
  OperationalApprovalRequestSummary,
  OperationalApprovalSourceSummary
} from "../types/operationalApprovals.js";
import type { UrgentWatchCandidate } from "../types/urgentWatch.js";
import {
  evaluateOperationalStaffingHealth,
  humanizeStaffingCreationSource,
  humanizeStaffingOperationalHealth,
  mapShiftStatusToStaffingAssignmentLifecycle,
  type StaffingAssignmentLifecycle,
  type StaffingCreationSource
} from "./staffingFoundation.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type StaffingCandidateGroupKey = "current_assignment" | "best_available" | "warning" | "conflicted_override" | "unavailable";

type CandidateMember = Awaited<ReturnType<typeof listScheduleMembers>>[number];

type StaffingTemplateRoleRow = {
  id: string;
  staffing_role: WorkShiftInput["staffing_role"];
  label: string;
  headcount: number;
  satisfies_lead_coverage: boolean;
  minimum_count: number;
  ideal_count: number;
  required_for_ready: boolean;
  lead_eligible: boolean;
  lead_required: boolean;
  call_offset_minutes: number;
  start_offset_minutes: number;
  end_offset_minutes: number;
  location_name_override: string | null;
  location_address_override: string | null;
  required_qualification_tags: string[] | null;
  role_notes: string | null;
  sort_order: number;
};

type ShootShiftRow = {
  id: string;
  assigned_user_id: string;
  assigned_user_name: string;
  status: string;
  staffing_role: WorkShiftInput["staffing_role"];
  satisfies_lead_coverage: boolean;
  starts_at: string;
  ends_at: string;
  title: string;
  staffing_requirement_id: string | null;
  assignment_source: StaffingCreationSource | null;
  reassignment_history: Array<{
    action: string;
    actor_user_id: string | null;
    actor_name: string | null;
    changed_at: string;
    reason: string | null;
    from_user_id: string | null;
    from_user_name: string | null;
    to_user_id: string | null;
    to_user_name: string | null;
  }> | null;
};

type ScheduleCommitment = {
  id: string;
  user_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  kind: "shift" | "event" | "assignment";
};

type DesiredSlot = {
  slot_key: string;
  requirement_id: string | null;
  source_of_creation: StaffingCreationSource;
  label: string;
  staffing_role: WorkShiftInput["staffing_role"];
  satisfies_lead_coverage: boolean;
  lead_eligible: boolean;
  lead_required: boolean;
  required_for_ready: boolean;
  is_required_slot: boolean;
  minimum_count: number;
  ideal_count: number;
  call_time: string | null;
  start_time: string | null;
  end_time: string | null;
  location_name: string | null;
  location_address: string | null;
  required_qualification_tags: string[];
  notes: string | null;
  assigned_shift_id: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  assigned_title: string | null;
  shift_status: string | null;
  assignment_status: StaffingAssignmentLifecycle;
  assignment_source: StaffingCreationSource | null;
  reassignment_history: ShootShiftRow["reassignment_history"];
};

type StaffingCandidateOption = {
  user_id: string;
  name: string;
  title: string;
  status: string;
  short_reason: string | null;
  before_label: string | null;
  during_label: string | null;
  after_label: string | null;
  availability_state: StaffingCandidateGroupKey;
  requires_override: boolean;
  disabled: boolean;
  calendar_conflict_status: WorkShiftOutlookConflictStatus;
  calendar_conflict_detail: Record<string, unknown> | null;
};

type StaffingSlotResponse = DesiredSlot & {
  option_groups: Array<{
    key: StaffingCandidateGroupKey;
    label: string;
    options: StaffingCandidateOption[];
  }>;
  warnings: string[];
};

type StaffingRequirementRow = {
  id: string;
  source_of_creation: StaffingCreationSource;
  source_template_role_id: string | null;
  copied_from_requirement_id: string | null;
  staffing_role: WorkShiftInput["staffing_role"];
  label: string;
  minimum_count: number;
  ideal_count: number;
  required_for_ready: boolean;
  lead_eligible: boolean;
  lead_required: boolean;
  call_offset_minutes: number;
  start_offset_minutes: number;
  end_offset_minutes: number;
  location_name_override: string | null;
  location_address_override: string | null;
  required_qualification_tags: string[] | null;
  role_notes: string | null;
  sort_order: number;
};

type StaffingRequirementResponse = {
  requirement_id: string;
  source_of_creation: StaffingCreationSource;
  source_of_creation_display: string;
  staffing_role: WorkShiftInput["staffing_role"];
  label: string;
  minimum_count: number;
  ideal_count: number;
  required_for_ready: boolean;
  lead_eligible: boolean;
  lead_required: boolean;
  call_offset_minutes: number;
  start_offset_minutes: number;
  end_offset_minutes: number;
  location_name_override: string | null;
  location_address_override: string | null;
  required_qualification_tags: string[];
  notes: string | null;
  sort_order: number;
  assigned_count: number;
  open_count: number;
};

type StaffingSnapshot = {
  shoot: {
    id: string;
    shoot_code: string;
    title: string;
    shoot_date: string;
    department: string;
    location_name: string | null;
    location_address: string | null;
    arrival_time: string | null;
    start_time: string | null;
    end_time_est: string | null;
    planned_staff_count: number;
    minimum_staff_count: number;
    assigned_staff_count: number;
    required_lead_count: number;
    lead_coverage_count: number;
    lead_name: string | null;
    conflict_warning_count: number;
    draft_shift_count: number;
    published_shift_count: number;
    schedule_sync_state: string;
    schedule_sync_required: boolean;
    staffing_state: string;
    staffing_state_display: string;
    staffing_clean_for_ready: boolean;
    staffing_hard_blockers: string[];
    staffing_warnings: string[];
    open_slot_count: number;
    open_required_slot_count: number;
    publish_state: "draft" | "ready_to_publish" | "published";
    under_staffed: boolean;
    over_staffed: boolean;
    missing_lead: boolean;
    priority_label: "standard" | "elevated" | "big_shoot" | "critical_shoot";
    priority_label_display: string;
    priority_reasons: Array<{ key: string; label: string; detail: string }>;
    future_profitability_flag: "favorable" | "neutral" | "watch" | "needs_review" | null;
    future_profitability_display: string | null;
  };
  warnings: string[];
  requirements: StaffingRequirementResponse[];
  slots: StaffingSlotResponse[];
  approval_summary: OperationalApprovalSourceSummary;
};

export type StaffingMutationResult =
  | StaffingSnapshot
  | {
      approval_required: true;
      approval_request: OperationalApprovalRequestSummary;
      snapshot: StaffingSnapshot;
    };

type SchedulingWatchRow = {
  id: string;
  shoot_code: string;
  title: string;
  shoot_date: string;
  department: string;
  arrival_time: string | null;
  start_time: string | null;
  location_name: string | null;
  location_address: string | null;
  operations_priority: string | null;
  planned_staff_count: number | string | null;
  required_lead_count: number | string | null;
  primary_contact_id: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  assigned_staff_count: number | string | null;
  lead_coverage_count: number | string | null;
  draft_shift_count: number | string | null;
  conflict_warning_count: number | string | null;
};

type StaffingOverviewShootRow = {
  id: string;
  shoot_code: string;
  title: string;
  shoot_date: string;
  department: DepartmentCode;
  status: string;
  location_name: string | null;
  location_address: string | null;
  arrival_time: string | null;
  start_time: string | null;
  end_time_est: string | null;
  projected_students: number | string | null;
  estimated_drive_minutes: number | string | null;
  planned_staff_count: number | string | null;
  required_lead_count: number | string | null;
  assigned_staff_count: number | string | null;
  lead_coverage_count: number | string | null;
  lead_names: string | null;
  conflict_warning_count: number | string | null;
  schedule_sync_state: string;
  schedule_sync_required: boolean;
  revenue_potential_score: number | string | null;
  strategic_district_importance: boolean | null;
  account_growth_importance_score: number | string | null;
  complexity_score: number | string | null;
  customer_history_risk_score: number | string | null;
  multi_team_coordination: boolean | null;
  future_profitability_manual: "favorable" | "neutral" | "watch" | "needs_review" | null;
  camera_station_count: number | string | null;
  shoot_structure: "standard" | "open_house" | null;
  first_year_customer_flag: boolean | null;
  flagship_priority_account_flag: boolean | null;
  weather_travel_risk_flag: boolean | null;
  manual_leadership_boost: number | string | null;
  importance_override_tier: "standard" | "elevated" | "big_shoot" | "critical_shoot" | null;
  importance_override_reason: string | null;
  template_photographer_count: number | string | null;
  prior_major_issue_exists: boolean;
};

type StaffingDashboardResponse = {
  generated_at: string;
  anchor_date: string;
  summary: {
    shoots_today: number;
    shoots_tomorrow: number;
    open_staffing_slots: number;
    shoots_missing_lead: number;
    understaffed_shoots: number;
    conflict_warnings: number;
    available_staff_today: number;
    unavailable_staff_today: number;
  };
  open_coverage: Array<{
    shoot_id: string;
    shoot_code: string;
    title: string;
    shoot_date: string;
    department: string;
    location_label: string;
    time_label: string;
    assigned_staff_count: number;
    planned_staff_count: number;
    required_lead_count: number;
    lead_coverage_count: number;
    lead_present: boolean;
    lead_name: string | null;
    missing_lead: boolean;
    under_staffed: boolean;
    conflict_warning_count: number;
    sync_state: string;
    next_action: string;
    priority_label: "standard" | "elevated" | "big_shoot" | "critical_shoot";
    priority_label_display: string;
    priority_reasons: Array<{ key: string; label: string; detail: string }>;
  }>;
  missing_lead: Array<{
    shoot_id: string;
    shoot_code: string;
    title: string;
    shoot_date: string;
    department: string;
    location_label: string;
    time_label: string;
    assigned_staff_count: number;
    planned_staff_count: number;
    required_lead_count: number;
    lead_coverage_count: number;
    conflict_warning_count: number;
    priority_label: "standard" | "elevated" | "big_shoot" | "critical_shoot";
    priority_label_display: string;
  }>;
  availability_groups: Array<{
    key: string;
    label: string;
    count: number;
    staff: Array<{
      user_id: string;
      name: string;
      title: string;
      status: string;
      current_assignment: string | null;
      time_window: string | null;
      quick_note: string | null;
      lead_qualified: boolean;
    }>;
  }>;
};

function parseDateOnly(value: string) {
  return new Date(`${value}T12:00:00`);
}

function formatDateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number) {
  const next = new Date(value.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function getWeekBounds(anchorDate: string) {
  const anchor = parseDateOnly(anchorDate);
  const weekday = anchor.getDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = addDays(anchor, mondayOffset);
  return {
    startDate: formatDateOnly(monday),
    endDate: formatDateOnly(addDays(monday, 6))
  };
}

function rangesOverlap(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string) {
  return new Date(leftStart).getTime() < new Date(rightEnd).getTime() && new Date(leftEnd).getTime() > new Date(rightStart).getTime();
}

function durationHours(start: string, end: string) {
  return Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000);
}

function earliestIso(values: string[]) {
  return values.length
    ? [...values].sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0] ?? null
    : null;
}

function latestIso(values: string[]) {
  return values.length
    ? [...values].sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null
    : null;
}

function formatWindow(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return `${startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - ${endDate.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  })}`;
}

function summarizeAvailabilityWindow(window: AvailabilityWindow) {
  switch (window.availability_state) {
    case "approved_time_off":
      return { status: "Approved Time Off", reason: window.label || "approved time off", disabled: true };
    case "sick_same_day_absence":
      return { status: "Same-Day Absence", reason: window.label || "same-day absence", disabled: true };
    case "blocked_by_manager_admin":
      return { status: "Blocked", reason: window.label || "manager block", disabled: true };
    case "company_holiday_closed":
      return { status: "Holiday", reason: window.label || "company holiday", disabled: true };
    case "availability_restriction":
      return { status: "Unavailable", reason: window.label || "availability restriction", disabled: true };
    case "submitted_request_warning":
      return { status: "Heads Up", reason: window.label || "pending availability review", disabled: false };
    default:
      return { status: "Availability", reason: window.label || "availability change", disabled: false };
  }
}

function formatTimeRange(start?: string | null, end?: string | null) {
  if (!start && !end) {
    return "Time pending";
  }
  const startLabel = start
    ? new Date(start).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
      })
    : "";
  const endLabel = end
    ? new Date(end).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
      })
    : "";
  return startLabel && endLabel ? `${startLabel} - ${endLabel}` : startLabel || endLabel || "Time pending";
}

function humanizeLabel(value: string | null | undefined) {
  if (!value) {
    return "Unknown";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function displayMemberTitle(member: CandidateMember) {
  return humanizeLabel(member.primary_job_function_profile ?? member.roles?.[0] ?? member.department);
}

function resolveAssignmentStaffingRole(slot: DesiredSlot, member: CandidateMember): WorkShiftInput["staffing_role"] {
  if (!slot.satisfies_lead_coverage) {
    return slot.staffing_role ?? "photographer";
  }
  if (
    member.primary_job_function_profile === "senior_photographer" ||
    (member.job_function_profiles ?? []).includes("senior_photographer") ||
    (member.roles ?? []).includes("senior_photographer")
  ) {
    return "senior_photographer";
  }
  return "lead_photographer";
}

function canManageShootDepartment(auth: AuthUser, department: DepartmentCode) {
  return canCreateOrEditCalendarDepartment(auth, department);
}

function canOverrideStaffingConflict(auth: AuthUser) {
  return hasManagerApprovalAuthority(auth);
}

function canPublishStaffingWarnings(auth: AuthUser) {
  return hasManagerApprovalAuthority(auth);
}

function buildPriorityState(row: {
  projected_students?: number | string | null;
  planned_staff_count?: number | string | null;
  estimated_drive_minutes?: number | string | null;
  revenue_potential_score?: number | string | null;
  strategic_district_importance?: boolean | null;
  account_growth_importance_score?: number | string | null;
  complexity_score?: number | string | null;
  customer_history_risk_score?: number | string | null;
  multi_team_coordination?: boolean | null;
  future_profitability_manual?: "favorable" | "neutral" | "watch" | "needs_review" | null;
  template_photographer_count?: number | string | null;
  prior_major_issue_exists?: boolean | null;
  assigned_staff_count?: number | string | null;
  camera_station_count?: number | string | null;
  shoot_structure?: "standard" | "open_house" | null;
  first_year_customer_flag?: boolean | null;
  flagship_priority_account_flag?: boolean | null;
  weather_travel_risk_flag?: boolean | null;
  manual_leadership_boost?: number | string | null;
  importance_override_tier?: "standard" | "elevated" | "big_shoot" | "critical_shoot" | null;
  importance_override_reason?: string | null;
}, auth: AuthUser) {
  const assignedStaffCount = Number(row.assigned_staff_count ?? 0);
  const plannedStaffCount = Number(row.planned_staff_count ?? 0);
  const priority = evaluateShootPriority({
    projectedHeadcount: Number(row.projected_students ?? 0),
    photographerHeadcount: Number(row.template_photographer_count ?? 0),
    assignedStaffCount,
    plannedStaffCount,
    estimatedDriveMinutes: row.estimated_drive_minutes == null ? null : Number(row.estimated_drive_minutes),
    cameraStationCount:
      row.camera_station_count == null ? Math.max(Number(row.template_photographer_count ?? 0), 1) : Number(row.camera_station_count),
    shootStructure: row.shoot_structure ?? "standard",
    hasSpecialtyRequirements: Boolean(row.multi_team_coordination),
    firstYearCustomerFlag: Boolean(row.first_year_customer_flag),
    flagshipPriorityAccountFlag: Boolean(row.flagship_priority_account_flag),
    revenuePotentialScore: row.revenue_potential_score == null ? null : Number(row.revenue_potential_score),
    strategicDistrictImportance: Boolean(row.strategic_district_importance),
    accountGrowthImportanceScore:
      row.account_growth_importance_score == null ? null : Number(row.account_growth_importance_score),
    complexityScore: row.complexity_score == null ? null : Number(row.complexity_score),
    customerHistoryRiskScore:
      row.customer_history_risk_score == null ? null : Number(row.customer_history_risk_score),
    multiTeamCoordination: Boolean(row.multi_team_coordination),
    missingStaffingCoverageCount: Math.max(plannedStaffCount - assignedStaffCount, 0),
    missingRequiredPrepCount: 0,
    weatherTravelRiskFlag: Boolean(row.weather_travel_risk_flag),
    manualLeadershipBoost: row.manual_leadership_boost == null ? null : Number(row.manual_leadership_boost),
    futureProfitabilityManual: row.future_profitability_manual ?? null,
    priorMajorIssueExists: Boolean(row.prior_major_issue_exists),
    importanceOverrideTier: row.importance_override_tier ?? null,
    importanceOverrideReason: row.importance_override_reason ?? null
  });

  return {
    priority_label: priority.priorityLabel,
    priority_label_display: humanizePriorityLabel(priority.priorityLabel),
    priority_reasons: priority.reasons.map((reason) => ({
      key: reason.key,
      label: reason.label,
      detail: reason.detail
    })),
    future_profitability_flag: canViewStrategicShootSignals(auth) ? priority.profitability.finalFlag : null,
    future_profitability_display: canViewStrategicShootSignals(auth)
      ? humanizeProfitabilityFlag(priority.profitability.finalFlag)
      : null
  };
}

async function loadShootContext(client: PoolClient, auth: AuthUser, shootId: string) {
  await assertShootAccess(client, auth, shootId);

  const shootResult = await client.query<{
    id: string;
    shoot_code: string;
    title: string;
    shoot_date: string;
    department: DepartmentCode;
    location_name: string | null;
    location_address: string | null;
    arrival_time: string | null;
    start_time: string | null;
    end_time_est: string | null;
    planned_staff_count: number | string | null;
    minimum_staff_count: number | string | null;
    required_lead_count: number | string | null;
    staffing_template_id: string | null;
    projected_students: number | string | null;
    estimated_drive_minutes: number | string | null;
    revenue_potential_score: number | string | null;
    strategic_district_importance: boolean | null;
    account_growth_importance_score: number | string | null;
    complexity_score: number | string | null;
    customer_history_risk_score: number | string | null;
    multi_team_coordination: boolean | null;
    future_profitability_manual: "favorable" | "neutral" | "watch" | "needs_review" | null;
    camera_station_count: number | string | null;
    shoot_structure: "standard" | "open_house" | null;
    first_year_customer_flag: boolean | null;
    flagship_priority_account_flag: boolean | null;
    weather_travel_risk_flag: boolean | null;
    manual_leadership_boost: number | string | null;
    importance_override_tier: "standard" | "elevated" | "big_shoot" | "critical_shoot" | null;
    importance_override_reason: string | null;
    template_photographer_count: number | string | null;
    prior_major_issue_exists: boolean;
    schedule_sync_state: string;
    schedule_sync_required: boolean;
  }>(
    `
      SELECT
        s.id,
        s.shoot_code,
        s.title,
        s.shoot_date::text,
        s.department,
        s.location_name,
        s.location_address,
        s.arrival_time::text,
        s.start_time::text,
        s.end_time_est::text,
        s.planned_staff_count,
        s.minimum_staff_count,
        s.required_lead_count,
        s.staffing_template_id,
        s.projected_students,
        s.estimated_drive_minutes,
        s.revenue_potential_score,
        s.strategic_district_importance,
        s.account_growth_importance_score,
        s.complexity_score,
        s.customer_history_risk_score,
        s.multi_team_coordination,
        s.future_profitability_manual,
        s.camera_station_count,
        s.shoot_structure::text,
        s.first_year_customer_flag,
        s.flagship_priority_account_flag,
        s.weather_travel_risk_flag,
        s.manual_leadership_boost,
        s.importance_override_tier::text,
        s.importance_override_reason,
        COALESCE(
          (
            SELECT SUM(str.headcount)
            FROM staffing_template_role str
            WHERE str.tenant_id = s.tenant_id
              AND str.staffing_template_id = s.staffing_template_id
              AND str.staffing_role IN ('lead_photographer', 'senior_photographer', 'photographer')
          ),
          0
        ) AS template_photographer_count,
        EXISTS (
          SELECT 1
          FROM shoot_location_link sl
          JOIN post_shoot_evaluation pse
            ON pse.location_id = sl.location_id
           AND pse.tenant_id = sl.tenant_id
          WHERE sl.tenant_id = s.tenant_id
            AND sl.shoot_id = s.id
            AND (
              pse.overall_rating <= 2
              OR pse.on_time = 'No'
              OR pse.easy_access = 'No'
              OR COALESCE(NULLIF(trim(pse.late_details), ''), NULLIF(trim(pse.access_details), ''), NULLIF(trim(pse.notes), '')) IS NOT NULL
            )
        ) AS prior_major_issue_exists,
        s.schedule_sync_state::text,
        s.schedule_sync_required
      FROM shoot s
      WHERE s.tenant_id = $1
        AND s.id = $2
        AND s.deleted_at IS NULL
      LIMIT 1
    `,
    [auth.tenantId, shootId]
  );
  const shoot = shootResult.rows[0];
  if (!shoot) {
    throw new ApiError(404, "Shoot not found");
  }

  const shiftRows = await client.query<ShootShiftRow>(
    `
      SELECT
        ws.id,
        ws.assigned_user_id,
        au.full_name AS assigned_user_name,
        ws.status::text,
        ws.staffing_role,
        ws.satisfies_lead_coverage,
        ws.starts_at::text,
        ws.ends_at::text,
        ws.title,
        ws.staffing_requirement_id,
        ws.assignment_source,
        COALESCE(ws.reassignment_history, '[]'::jsonb) AS reassignment_history
      FROM work_shift ws
      JOIN app_user au ON au.id = ws.assigned_user_id
      WHERE ws.tenant_id = $1
        AND ws.shoot_id = $2
        AND ws.cancelled_at IS NULL
        AND ws.status IN ('draft', 'published', 'completed')
      ORDER BY ws.starts_at ASC, ws.created_at ASC
    `,
    [auth.tenantId, shootId]
  );

  const templateRoles = shoot.staffing_template_id
    ? (
        await client.query<StaffingTemplateRoleRow>(
          `
            SELECT
              id,
              staffing_role,
              label,
              headcount,
              satisfies_lead_coverage,
              minimum_count,
              ideal_count,
              required_for_ready,
              lead_eligible,
              lead_required,
              call_offset_minutes,
              start_offset_minutes,
              end_offset_minutes,
              location_name_override,
              location_address_override,
              required_qualification_tags,
              role_notes,
              sort_order
            FROM staffing_template_role
            WHERE tenant_id = $1
              AND staffing_template_id = $2
            ORDER BY sort_order ASC
          `,
          [auth.tenantId, shoot.staffing_template_id]
        )
      ).rows
    : [];

  const requirements = (
    await client.query<StaffingRequirementRow>(
      `
        SELECT
          ssr.id,
          ssr.source_of_creation,
          ssr.source_template_role_id,
          ssr.copied_from_requirement_id,
          ssr.staffing_role,
          ssr.label,
          ssr.minimum_count,
          ssr.ideal_count,
          ssr.required_for_ready,
          ssr.lead_eligible,
          ssr.lead_required,
          ssr.call_offset_minutes,
          ssr.start_offset_minutes,
          ssr.end_offset_minutes,
          ssr.location_name_override,
          ssr.location_address_override,
          ssr.required_qualification_tags,
          ssr.role_notes,
          ssr.sort_order
        FROM shoot_staffing_requirement ssr
        WHERE ssr.tenant_id = $1
          AND ssr.shoot_id = $2
        ORDER BY ssr.sort_order ASC, ssr.created_at ASC
      `,
      [auth.tenantId, shootId]
    )
  ).rows;

  return {
    shoot,
    shifts: shiftRows.rows,
    templateRoles,
    requirements
  };
}

async function loadCandidateContext(
  client: PoolClient,
  auth: AuthUser,
  shootDate: string,
  memberContexts: Array<{ id: string; department: string; email?: string | null }>,
  shootId: string,
  windowStart: string | null,
  windowEnd: string | null
) {
  const memberIds = memberContexts.map((member) => member.id);
  if (!memberIds.length) {
    return {
      commitmentsByUser: new Map<string, ScheduleCommitment[]>(),
      availabilityWindowsByUser: new Map<string, AvailabilityWindow[]>(),
      outlookBusyWindowsByUser: new Map<string, OutlookBusyWindow[]>()
    };
  }

  const shiftRows = await client.query<{
      id: string;
      assigned_user_id: string;
      title: string;
      starts_at: string;
      ends_at: string;
    }>(
      `
        SELECT ws.id, ws.assigned_user_id, ws.title, ws.starts_at::text, ws.ends_at::text
        FROM work_shift ws
        WHERE ws.tenant_id = $1
          AND ws.assigned_user_id = ANY($2::uuid[])
          AND ws.cancelled_at IS NULL
          AND ws.status IN ('draft', 'published', 'completed')
          AND ws.ends_at::date >= $3::date
          AND ws.starts_at::date <= $3::date
      `,
      [auth.tenantId, memberIds, shootDate]
    );
  const eventRows = await client.query<{
      id: string;
      lead_user_id: string;
      title: string;
      starts_at: string;
      ends_at: string;
    }>(
      `
        SELECT se.id, se.lead_user_id, se.title, se.starts_at::text, se.ends_at::text
        FROM schedule_event se
        WHERE se.tenant_id = $1
          AND se.lead_user_id = ANY($2::uuid[])
          AND se.deleted_at IS NULL
          AND se.status IN ('scheduled', 'tentative', 'completed')
          AND se.ends_at::date >= $3::date
          AND se.starts_at::date <= $3::date
      `,
      [auth.tenantId, memberIds, shootDate]
    );
  const assignmentRows = await client.query<{
      shoot_id: string;
      user_id: string;
      title: string;
      start_time: string;
      end_time_est: string;
    }>(
      `
        SELECT
          sa.shoot_id,
          sa.user_id,
          s.title,
          s.start_time::text,
          s.end_time_est::text
        FROM shoot_assignment sa
        JOIN shoot s
          ON s.id = sa.shoot_id
         AND s.tenant_id = sa.tenant_id
        WHERE sa.tenant_id = $1
          AND sa.user_id = ANY($2::uuid[])
          AND sa.shoot_id <> $3::uuid
          AND s.deleted_at IS NULL
          AND s.shoot_date = $4::date
      `,
      [auth.tenantId, memberIds, shootId, shootDate]
    );
  const availabilityWindowsByUser = await loadAvailabilityWindowsForUsersOnDate(client, {
      tenantId: auth.tenantId,
      userContexts: memberContexts,
      anchorDate: shootDate,
      includePendingRequests: true
    });
  const outlookBusyWindowsByUser =
    windowStart && windowEnd
      ? await listOutlookBusyWindowsForUsers({
          staff: memberContexts.map((member) => ({
            userId: member.id,
            email: member.email ?? null
          })),
          startsAt: windowStart,
          endsAt: windowEnd
        })
      : new Map<string, OutlookBusyWindow[]>();

  const commitmentsByUser = new Map<string, ScheduleCommitment[]>();
  for (const row of shiftRows.rows) {
    const current = commitmentsByUser.get(row.assigned_user_id) ?? [];
    current.push({
      id: row.id,
      user_id: row.assigned_user_id,
      title: row.title,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      kind: "shift"
    });
    commitmentsByUser.set(row.assigned_user_id, current);
  }
  for (const row of eventRows.rows) {
    const current = commitmentsByUser.get(row.lead_user_id) ?? [];
    current.push({
      id: row.id,
      user_id: row.lead_user_id,
      title: row.title,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      kind: "event"
    });
    commitmentsByUser.set(row.lead_user_id, current);
  }
  for (const row of assignmentRows.rows) {
    if (!row.start_time || !row.end_time_est) {
      continue;
    }
    const current = commitmentsByUser.get(row.user_id) ?? [];
    current.push({
      id: row.shoot_id,
      user_id: row.user_id,
      title: row.title,
      starts_at: row.start_time,
      ends_at: row.end_time_est,
      kind: "assignment"
    });
    commitmentsByUser.set(row.user_id, current);
  }

  for (const [userId, commitments] of commitmentsByUser.entries()) {
    commitmentsByUser.set(
      userId,
      commitments.sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime())
    );
  }

  return {
    commitmentsByUser,
    availabilityWindowsByUser,
    outlookBusyWindowsByUser
  };
}

function addMinutes(value: string | null | undefined, offsetMinutes: number) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setMinutes(date.getMinutes() + offsetMinutes);
  return date.toISOString();
}

function normalizeTags(values: string[] | null | undefined) {
  return (values ?? []).map((value) => String(value).trim()).filter((value) => value.length > 0);
}

function memberQualificationTokens(member: CandidateMember) {
  return new Set(
    [
      member.department,
      ...(member.roles ?? []),
      member.primary_job_function_profile,
      ...(member.job_function_profiles ?? [])
    ]
      .map((value) => String(value ?? "").trim().toLowerCase())
      .filter((value) => value.length > 0)
  );
}

function memberMatchesRequiredTags(member: CandidateMember, tags: string[]) {
  if (!tags.length) {
    return true;
  }
  const tokens = memberQualificationTokens(member);
  return tags.every((tag) => tokens.has(tag.trim().toLowerCase()));
}

function deriveRequirementTimes(
  shoot: Awaited<ReturnType<typeof loadShootContext>>["shoot"],
  requirement: Pick<
    StaffingRequirementRow,
    "call_offset_minutes" | "start_offset_minutes" | "end_offset_minutes"
  >
) {
  const callAnchor = shoot.arrival_time ?? shoot.start_time;
  const startAnchor = shoot.start_time ?? shoot.arrival_time;
  const endAnchor = shoot.end_time_est;
  return {
    call_time: addMinutes(callAnchor, Number(requirement.call_offset_minutes ?? 0)),
    start_time: addMinutes(startAnchor, Number(requirement.start_offset_minutes ?? 0)),
    end_time: addMinutes(endAnchor, Number(requirement.end_offset_minutes ?? 0))
  };
}

function buildRequirementRows(
  shoot: Awaited<ReturnType<typeof loadShootContext>>["shoot"],
  storedRequirements: StaffingRequirementRow[],
  templateRoles: StaffingTemplateRoleRow[]
) {
  if (storedRequirements.length) {
    return storedRequirements;
  }

  if (templateRoles.length) {
    return templateRoles.map((role, index) => ({
      id: `template-role:${role.id}`,
      source_of_creation: "template_from_shoot_type" as const,
      source_template_role_id: role.id,
      copied_from_requirement_id: null,
      staffing_role: role.staffing_role ?? "photographer",
      label: role.label,
      minimum_count: Math.max(Number(role.minimum_count ?? role.headcount ?? 0), role.satisfies_lead_coverage ? 1 : 0),
      ideal_count: Math.max(
        Number(role.ideal_count ?? role.headcount ?? 0),
        Number(role.minimum_count ?? role.headcount ?? 0),
        role.satisfies_lead_coverage ? 1 : 0
      ),
      required_for_ready: Boolean(role.required_for_ready ?? true),
      lead_eligible: Boolean(role.lead_eligible ?? role.satisfies_lead_coverage),
      lead_required: Boolean(role.lead_required ?? role.satisfies_lead_coverage),
      call_offset_minutes: Number(role.call_offset_minutes ?? 0),
      start_offset_minutes: Number(role.start_offset_minutes ?? 0),
      end_offset_minutes: Number(role.end_offset_minutes ?? 0),
      location_name_override: role.location_name_override ?? null,
      location_address_override: role.location_address_override ?? null,
      required_qualification_tags: normalizeTags(role.required_qualification_tags),
      role_notes: role.role_notes ?? null,
      sort_order: Number(role.sort_order ?? index)
    }));
  }

  const minimumStaffCount = Math.max(Number(shoot.minimum_staff_count ?? 0), Number(shoot.required_lead_count ?? 0), 0);
  const idealStaffCount = Math.max(Number(shoot.planned_staff_count ?? 0), minimumStaffCount);
  const requiredLeadCount = Math.max(Number(shoot.required_lead_count ?? 0), minimumStaffCount > 0 ? 1 : 0);
  const rows: StaffingRequirementRow[] = [];

  if (requiredLeadCount > 0) {
    rows.push({
      id: "legacy:lead",
      source_of_creation: "legacy_fallback",
      source_template_role_id: null,
      copied_from_requirement_id: null,
      staffing_role: "lead_photographer",
      label: requiredLeadCount > 1 ? "Lead Coverage" : "Lead Photographer",
      minimum_count: requiredLeadCount,
      ideal_count: requiredLeadCount,
      required_for_ready: true,
      lead_eligible: true,
      lead_required: true,
      call_offset_minutes: 0,
      start_offset_minutes: 0,
      end_offset_minutes: 0,
      location_name_override: null,
      location_address_override: null,
      required_qualification_tags: [],
      role_notes: null,
      sort_order: 0
    });
  }

  const remainingMinimum = Math.max(minimumStaffCount - requiredLeadCount, 0);
  const remainingIdeal = Math.max(idealStaffCount - requiredLeadCount, 0);
  if (remainingMinimum > 0 || remainingIdeal > 0) {
    rows.push({
      id: "legacy:photographer",
      source_of_creation: "legacy_fallback",
      source_template_role_id: null,
      copied_from_requirement_id: null,
      staffing_role: "photographer",
      label: "Photographer Coverage",
      minimum_count: remainingMinimum,
      ideal_count: Math.max(remainingIdeal, remainingMinimum),
      required_for_ready: remainingMinimum > 0,
      lead_eligible: false,
      lead_required: false,
      call_offset_minutes: 0,
      start_offset_minutes: 0,
      end_offset_minutes: 0,
      location_name_override: null,
      location_address_override: null,
      required_qualification_tags: [],
      role_notes: null,
      sort_order: 1
    });
  }

  return rows;
}

function buildOperationalRequirement(
  shoot: Awaited<ReturnType<typeof loadShootContext>>["shoot"],
  requirements: StaffingRequirementRow[],
  publicationState: "draft" | "ready_to_publish" | "published"
): StaffingRequirement {
  const requiredLeadCount = Math.max(Number(shoot.required_lead_count ?? 0), 0);
  const minimumStaffCount = Math.max(
    Number(shoot.minimum_staff_count ?? 0),
    requirements.reduce((total, requirement) => total + Math.max(Number(requirement.minimum_count ?? 0), 0), 0),
    requiredLeadCount
  );

  return {
    requirementId: `shoot:${shoot.id}:staffing`,
    shootId: shoot.id,
    publicationState,
    plannedStaffCount: minimumStaffCount,
    ...createStaffingLeadCoverageRequirement(requiredLeadCount),
    requiredRoles: requirements
      .filter((requirement) => Math.max(Number(requirement.minimum_count ?? 0), 0) > 0)
      .map((requirement) => ({
        assignmentRole: requirement.staffing_role ?? "photographer",
        label: requirement.label,
        requiredHeadcount: Math.max(Number(requirement.minimum_count ?? 0), 0),
        sortOrder: Number(requirement.sort_order ?? 0),
        countsTowardLeadCoverage: Boolean(requirement.lead_eligible || requirement.lead_required)
      }))
  };
}

function buildDesiredSlots(
  shoot: Awaited<ReturnType<typeof loadShootContext>>["shoot"],
  shifts: ShootShiftRow[],
  requirements: StaffingRequirementRow[],
  membersById: Map<string, CandidateMember>
) {
  const slots: DesiredSlot[] = [];

  for (const requirement of requirements) {
    const minimumCount = Math.max(Number(requirement.minimum_count ?? 0), requirement.lead_required ? 1 : 0, 0);
    const effectiveCount = Math.max(
      Number(requirement.ideal_count ?? 0),
      minimumCount,
      requirement.required_for_ready ? 1 : 0
    );
    const timing = deriveRequirementTimes(shoot, requirement);
    for (let index = 0; index < Math.max(effectiveCount, 1); index += 1) {
      const isRequiredSlot = index < Math.max(minimumCount, requirement.required_for_ready ? 1 : 0);
      slots.push({
        slot_key: `requirement:${requirement.id}:${index + 1}`,
        requirement_id: requirement.id,
        source_of_creation: requirement.source_of_creation,
        label: effectiveCount > 1 ? `${requirement.label} ${index + 1}` : requirement.label,
        staffing_role: requirement.staffing_role ?? "photographer",
        satisfies_lead_coverage: Boolean(requirement.lead_eligible || requirement.lead_required),
        lead_eligible: Boolean(requirement.lead_eligible || requirement.lead_required),
        lead_required: Boolean(requirement.lead_required && index < Math.max(minimumCount, 1)),
        required_for_ready: Boolean(requirement.required_for_ready),
        is_required_slot: isRequiredSlot,
        minimum_count: minimumCount,
        ideal_count: Math.max(effectiveCount, 1),
        call_time: timing.call_time,
        start_time: timing.start_time,
        end_time: timing.end_time,
        location_name: requirement.location_name_override ?? shoot.location_name ?? null,
        location_address: requirement.location_address_override ?? shoot.location_address ?? null,
        required_qualification_tags: normalizeTags(requirement.required_qualification_tags),
        notes: requirement.role_notes ?? null,
        assigned_shift_id: null,
        assigned_user_id: null,
        assigned_user_name: null,
        assigned_title: null,
        shift_status: null,
        assignment_status: "open",
        assignment_source: null,
        reassignment_history: []
      });
    }
  }

  for (const shift of shifts) {
    const matchingSlot =
      slots.find((slot) => !slot.assigned_shift_id && slot.requirement_id && shift.staffing_requirement_id === slot.requirement_id) ??
      slots.find(
        (slot) =>
          !slot.assigned_shift_id &&
          slot.staffing_role === shift.staffing_role &&
          slot.satisfies_lead_coverage === Boolean(shift.satisfies_lead_coverage)
      ) ??
      slots.find((slot) => !slot.assigned_shift_id);

    const slot =
      matchingSlot ??
      ({
        slot_key: `extra:${shift.id}`,
        requirement_id: shift.staffing_requirement_id ?? null,
        source_of_creation: shift.assignment_source ?? "legacy_fallback",
        label: `Extra ${slots.filter((candidate) => candidate.slot_key.startsWith("extra:")).length + 1}`,
        staffing_role: shift.staffing_role ?? "photographer",
        satisfies_lead_coverage: Boolean(shift.satisfies_lead_coverage),
        lead_eligible: Boolean(shift.satisfies_lead_coverage),
        lead_required: false,
        required_for_ready: false,
        is_required_slot: false,
        minimum_count: 0,
        ideal_count: 0,
        call_time: null,
        start_time: shift.starts_at,
        end_time: shift.ends_at,
        location_name: shoot.location_name ?? null,
        location_address: shoot.location_address ?? null,
        required_qualification_tags: [],
        notes: null,
        assigned_shift_id: null,
        assigned_user_id: null,
        assigned_user_name: null,
        assigned_title: null,
        shift_status: null,
        assignment_status: "open",
        assignment_source: shift.assignment_source ?? "legacy_fallback",
        reassignment_history: shift.reassignment_history ?? []
      } satisfies DesiredSlot);

    if (!slots.includes(slot)) {
      slots.push(slot);
    }

    const member = membersById.get(shift.assigned_user_id);
    slot.assigned_shift_id = shift.id;
    slot.assigned_user_id = shift.assigned_user_id;
    slot.assigned_user_name = shift.assigned_user_name;
    slot.assigned_title = member ? displayMemberTitle(member) : humanizeLabel(shift.staffing_role ?? "photographer");
    slot.shift_status = shift.status;
    slot.assignment_status = mapShiftStatusToStaffingAssignmentLifecycle({
      rawStatus: shift.status,
      startsAt: shift.starts_at,
      endsAt: shift.ends_at
    });
    slot.assignment_source = shift.assignment_source ?? slot.source_of_creation;
    slot.reassignment_history = shift.reassignment_history ?? [];
    slot.start_time = shift.starts_at;
    slot.end_time = shift.ends_at;
  }

  return slots;
}

function groupLabel(key: StaffingCandidateGroupKey) {
  switch (key) {
    case "current_assignment":
      return "Current Assignment";
    case "best_available":
      return "Best Available";
    case "warning":
      return "Available with Warning";
    case "conflicted_override":
      return "Conflicted, Override Available";
    default:
      return "Unavailable";
  }
}

function sortCandidateGroups(groups: Map<StaffingCandidateGroupKey, StaffingCandidateOption[]>) {
  const order: StaffingCandidateGroupKey[] = ["current_assignment", "best_available", "warning", "conflicted_override", "unavailable"];
  return order
    .map((key) => ({
      key,
      label: groupLabel(key),
      options: (groups.get(key) ?? []).sort((left, right) => left.name.localeCompare(right.name))
    }))
    .filter((group) => group.options.length > 0);
}

function buildSlotWarnings(slot: DesiredSlot, groups: Map<StaffingCandidateGroupKey, StaffingCandidateOption[]>) {
  const warnings: string[] = [];
  if (!slot.assigned_user_id) {
    warnings.push("Open slot");
  }
  if ((slot.reassignment_history?.length ?? 0) > 0) {
    warnings.push("Reassigned");
  }
  const current = (groups.get("current_assignment") ?? [])[0];
  if (current?.short_reason && current.short_reason !== "assigned" && current.short_reason !== "published") {
    warnings.push(current.short_reason);
  }
  return warnings;
}

async function buildStaffingSnapshot(client: PoolClient, auth: AuthUser, shootId: string): Promise<StaffingSnapshot> {
  const { shoot, shifts, templateRoles, requirements: storedRequirements } = await loadShootContext(client, auth, shootId);
  const requirements = buildRequirementRows(shoot, storedRequirements, templateRoles);
  const members = await listScheduleMembers(client, auth, shoot.shoot_date);
  const membersById = new Map(members.map((member) => [member.id, member]));
  const slots = buildDesiredSlots(shoot, shifts, requirements, membersById);
  const staffingConfiguration = await getScheduleStaffingConfiguration(client, auth, {
    department: shoot.department
  });

  const assignmentStart = shoot.arrival_time ?? shoot.start_time;
  const assignmentEnd = shoot.end_time_est;
  const travelBufferMinutes = staffingConfiguration.travel_buffer_warning_minutes;
  const tightTurnaroundWarningMinutes = staffingConfiguration.tight_turnaround_warning_minutes;
  const slotStartCandidates = slots.map((slot) => slot.start_time).filter((value): value is string => Boolean(value));
  const slotEndCandidates = slots.map((slot) => slot.end_time).filter((value): value is string => Boolean(value));
  const lookupWindowStart = earliestIso(slotStartCandidates.length ? slotStartCandidates : assignmentStart ? [assignmentStart] : []);
  const lookupWindowEnd = latestIso(slotEndCandidates.length ? slotEndCandidates : assignmentEnd ? [assignmentEnd] : []);
  const fieldStaff = members.filter((member) => member.field_staff_eligible);
  const candidateContext = await loadCandidateContext(
    client,
    auth,
    shoot.shoot_date,
    fieldStaff.map((member) => ({ id: member.id, department: member.department, email: member.email })),
    shootId,
    lookupWindowStart ? addMinutes(lookupWindowStart, -travelBufferMinutes) : null,
    lookupWindowEnd ? addMinutes(lookupWindowEnd, travelBufferMinutes) : null
  );
  const warnings: string[] = [];
  const hardBlockers: string[] = [];
  if (!assignmentStart || !assignmentEnd) {
    hardBlockers.push("Shoot timing is incomplete. Finish arrival, shoot, and teardown timing before staffing the shoot.");
  }

  const slotResponses: StaffingSlotResponse[] = slots.map((slot) => {
    const groups = new Map<StaffingCandidateGroupKey, StaffingCandidateOption[]>();
    const slotStart = slot.start_time ?? assignmentStart;
    const slotEnd = slot.end_time ?? assignmentEnd;
    const hoursForShoot = slotStart && slotEnd ? durationHours(slotStart, slotEnd) : 0;
    for (const member of fieldStaff) {
      const commitments = candidateContext.commitmentsByUser.get(member.id) ?? [];
      const availabilityWindows = candidateContext.availabilityWindowsByUser.get(member.id) ?? [];
      const outlookBusyWindows = candidateContext.outlookBusyWindowsByUser.get(member.id) ?? [];
      const currentAssignment = slot.assigned_user_id === member.id;
      const qualificationMatch = memberMatchesRequiredTags(member, slot.required_qualification_tags);
      const blockingAvailabilityWindow =
        slotStart && slotEnd
          ? availabilityWindows.find((window) => !window.warning_only && rangesOverlap(window.starts_at, window.ends_at, slotStart, slotEnd))
          : availabilityWindows.find((window) => !window.warning_only) ?? null;
      const warningAvailabilityWindow =
        slotStart && slotEnd
          ? availabilityWindows.find((window) => window.warning_only && rangesOverlap(window.starts_at, window.ends_at, slotStart, slotEnd))
          : availabilityWindows.find((window) => window.warning_only) ?? null;
      const overlappingCommitment =
        slotStart && slotEnd
          ? commitments.find(
              (commitment) =>
                (!slot.assigned_shift_id || commitment.id !== slot.assigned_shift_id) &&
                rangesOverlap(commitment.starts_at, commitment.ends_at, slotStart, slotEnd)
            )
          : null;
      const previousCommitment =
        slotStart && slotEnd
          ? [...commitments]
              .filter((commitment) => new Date(commitment.ends_at).getTime() <= new Date(slotStart).getTime())
              .sort((left, right) => new Date(right.ends_at).getTime() - new Date(left.ends_at).getTime())[0] ?? null
          : null;
      const nextCommitment =
        slotStart && slotEnd
          ? [...commitments]
              .filter((commitment) => new Date(commitment.starts_at).getTime() >= new Date(slotEnd).getTime())
              .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime())[0] ?? null
          : null;
      const overlappingOutlookBusyWindow =
        slotStart && slotEnd
          ? outlookBusyWindows.find((window) => rangesOverlap(window.startsAt, window.endsAt, slotStart, slotEnd)) ?? null
          : null;
      const previousOutlookBusyWindow =
        slotStart && slotEnd
          ? [...outlookBusyWindows]
              .filter((window) => new Date(window.endsAt).getTime() <= new Date(slotStart).getTime())
              .sort((left, right) => new Date(right.endsAt).getTime() - new Date(left.endsAt).getTime())[0] ?? null
          : null;
      const nextOutlookBusyWindow =
        slotStart && slotEnd
          ? [...outlookBusyWindows]
              .filter((window) => new Date(window.startsAt).getTime() >= new Date(slotEnd).getTime())
              .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime())[0] ?? null
          : null;
      const beforeGapMinutes =
        previousCommitment && slotStart
          ? Math.round((new Date(slotStart).getTime() - new Date(previousCommitment.ends_at).getTime()) / 60000)
          : null;
      const afterGapMinutes =
        nextCommitment && slotEnd
          ? Math.round((new Date(nextCommitment.starts_at).getTime() - new Date(slotEnd).getTime()) / 60000)
          : null;
      const beforeOutlookGapMinutes =
        previousOutlookBusyWindow && slotStart
          ? Math.round((new Date(slotStart).getTime() - new Date(previousOutlookBusyWindow.endsAt).getTime()) / 60000)
          : null;
      const afterOutlookGapMinutes =
        nextOutlookBusyWindow && slotEnd
          ? Math.round((new Date(nextOutlookBusyWindow.startsAt).getTime() - new Date(slotEnd).getTime()) / 60000)
          : null;
      const overtimeRisk =
        !currentAssignment &&
        (Number(member.scheduled_hours_today ?? 0) + hoursForShoot > 8 || Number(member.scheduled_hours_week ?? 0) + hoursForShoot > 40);
      const hasOutlookTravelBufferRisk =
        travelBufferMinutes > 0 &&
        ((beforeOutlookGapMinutes !== null && beforeOutlookGapMinutes < travelBufferMinutes) ||
          (afterOutlookGapMinutes !== null && afterOutlookGapMinutes < travelBufferMinutes));
      const calendarConflictStatus: WorkShiftOutlookConflictStatus =
        overlappingOutlookBusyWindow || hasOutlookTravelBufferRisk
          ? config.OUTLOOK_CONFLICT_MODE === "blocking"
            ? "blocking"
            : "warning"
          : "clear";
      const calendarConflictDetail =
        calendarConflictStatus === "clear"
          ? null
          : {
              source: overlappingOutlookBusyWindow ? "outlook_busy" : "travel_buffer",
              mode: config.OUTLOOK_CONFLICT_MODE,
              busy_title:
                overlappingOutlookBusyWindow?.title ??
                previousOutlookBusyWindow?.title ??
                nextOutlookBusyWindow?.title ??
                null,
              busy_starts_at:
                overlappingOutlookBusyWindow?.startsAt ??
                previousOutlookBusyWindow?.startsAt ??
                nextOutlookBusyWindow?.startsAt ??
                null,
              busy_ends_at:
                overlappingOutlookBusyWindow?.endsAt ??
                previousOutlookBusyWindow?.endsAt ??
                nextOutlookBusyWindow?.endsAt ??
                null,
              travel_buffer_minutes: travelBufferMinutes,
              before_gap_minutes: beforeOutlookGapMinutes,
              after_gap_minutes: afterOutlookGapMinutes
            };
      const beforeLabel =
        previousCommitment
          ? `${previousCommitment.title} ends ${formatWindow(previousCommitment.starts_at, previousCommitment.ends_at)}`
          : previousOutlookBusyWindow
            ? `Outlook busy ends ${formatWindow(previousOutlookBusyWindow.startsAt, previousOutlookBusyWindow.endsAt)}`
            : null;
      const duringLabel =
        overlappingCommitment
          ? `${humanizeLabel(overlappingCommitment.kind)} overlap with ${overlappingCommitment.title}`
          : overlappingOutlookBusyWindow
            ? `Outlook busy with ${overlappingOutlookBusyWindow.title} ${formatWindow(
                overlappingOutlookBusyWindow.startsAt,
                overlappingOutlookBusyWindow.endsAt
              )}`
            : null;
      const afterLabel =
        nextCommitment
          ? `${nextCommitment.title} starts ${formatWindow(nextCommitment.starts_at, nextCommitment.ends_at)}`
          : nextOutlookBusyWindow
            ? `Outlook busy starts ${formatWindow(nextOutlookBusyWindow.startsAt, nextOutlookBusyWindow.endsAt)}`
            : null;

      let availabilityState: StaffingCandidateGroupKey = "best_available";
      let status = "Available";
      let shortReason: string | null = null;
      let disabled = false;
      let requiresOverride = false;

      if (currentAssignment) {
        availabilityState = "current_assignment";
        if (blockingAvailabilityWindow) {
          const availabilitySummary = summarizeAvailabilityWindow(blockingAvailabilityWindow);
          status = "Conflict";
          shortReason = availabilitySummary.reason;
          requiresOverride = true;
        } else if (slot.satisfies_lead_coverage && !member.lead_qualified) {
          status = "Conflict";
          shortReason = "not lead-qualified";
          requiresOverride = true;
        } else if (!qualificationMatch) {
          status = "Conflict";
          shortReason = "qualification warning";
          requiresOverride = true;
        } else if (overlappingCommitment) {
          status = "Conflict";
          shortReason =
            overlappingCommitment.kind === "shift"
              ? "overlap"
              : overlappingCommitment.kind === "event"
                ? "calendar overlap"
                : "assigned nearby";
          requiresOverride = true;
        } else if (calendarConflictStatus === "blocking") {
          status = "Conflict";
          shortReason = overlappingOutlookBusyWindow ? "outlook busy" : "travel buffer";
          requiresOverride = true;
        } else if (calendarConflictStatus === "warning") {
          status = "Heads Up";
          shortReason = overlappingOutlookBusyWindow ? "outlook busy" : "travel buffer";
        } else {
          status = "Assigned";
          shortReason = slot.shift_status === "published" ? "published" : slot.shift_status ?? "assigned";
        }
      } else if (blockingAvailabilityWindow) {
        const availabilitySummary = summarizeAvailabilityWindow(blockingAvailabilityWindow);
        availabilityState = "unavailable";
        status = availabilitySummary.status;
        shortReason = availabilitySummary.reason;
        disabled = availabilitySummary.disabled;
      } else if (slot.satisfies_lead_coverage && !member.lead_qualified) {
        availabilityState = "unavailable";
        status = "Unavailable";
        shortReason = "not lead-qualified";
        disabled = true;
      } else if (!qualificationMatch) {
        availabilityState = "unavailable";
        status = "Unavailable";
        shortReason = "qualification warning";
        disabled = true;
      } else if (overlappingCommitment) {
        availabilityState = "conflicted_override";
        status = "Conflict";
        shortReason =
          overlappingCommitment.kind === "shift"
            ? "overlap"
            : overlappingCommitment.kind === "event"
              ? "calendar overlap"
              : "assigned nearby";
        requiresOverride = true;
      } else if (calendarConflictStatus === "blocking") {
        availabilityState = "conflicted_override";
        status = overlappingOutlookBusyWindow ? "Outlook Busy" : "Travel Buffer";
        shortReason = overlappingOutlookBusyWindow ? "outlook busy" : "travel buffer";
        requiresOverride = true;
      } else if (
        (beforeGapMinutes !== null && beforeGapMinutes < tightTurnaroundWarningMinutes) ||
        (afterGapMinutes !== null && afterGapMinutes < tightTurnaroundWarningMinutes) ||
        overtimeRisk
      ) {
        availabilityState = "warning";
        status = overtimeRisk ? "Overtime Watch" : "Heads Up";
        shortReason =
          overtimeRisk
            ? "overtime risk"
            : beforeGapMinutes !== null && beforeGapMinutes < tightTurnaroundWarningMinutes
              ? "tight turnaround"
              : "next shoot soon";
      } else if (calendarConflictStatus === "warning") {
        availabilityState = "warning";
        status = overlappingOutlookBusyWindow ? "Calendar Busy" : "Travel Buffer";
        shortReason = overlappingOutlookBusyWindow ? "outlook busy" : "travel buffer";
      } else if (warningAvailabilityWindow) {
        const availabilitySummary = summarizeAvailabilityWindow(warningAvailabilityWindow);
        availabilityState = "warning";
        status = availabilitySummary.status;
        shortReason = availabilitySummary.reason;
      }

      const option: StaffingCandidateOption = {
        user_id: member.id,
        name: member.full_name,
        title: displayMemberTitle(member),
        status,
        short_reason: shortReason,
        before_label: beforeLabel,
        during_label: duringLabel,
        after_label: afterLabel,
        availability_state: availabilityState,
        requires_override: requiresOverride,
        disabled,
        calendar_conflict_status: calendarConflictStatus,
        calendar_conflict_detail: calendarConflictDetail
      };
      const bucket = groups.get(availabilityState) ?? [];
      bucket.push(option);
      groups.set(availabilityState, bucket);
    }

    return {
      ...slot,
      option_groups: sortCandidateGroups(groups),
      warnings: buildSlotWarnings(slot, groups)
    };
  });

  const minimumStaffCount = Math.max(
    Number(shoot.minimum_staff_count ?? 0),
    requirements.reduce((total, requirement) => total + Math.max(Number(requirement.minimum_count ?? 0), 0), 0),
    Number(shoot.required_lead_count ?? 0)
  );
  const plannedStaffCount = Math.max(
    Number(shoot.planned_staff_count ?? 0),
    requirements.reduce((total, requirement) => total + Math.max(Number(requirement.ideal_count ?? 0), 0), 0),
    minimumStaffCount
  );
  const requiredLeadCount = Math.max(Number(shoot.required_lead_count ?? 0), 0);
  const operationalPublicationState =
    shifts.length > 0 && shifts.every((shift) => shift.status === "published" || shift.status === "completed")
      ? "published"
      : shifts.length > 0
        ? "ready_to_publish"
        : "draft";
  const operationalRequirement = buildOperationalRequirement(shoot, requirements, operationalPublicationState);
  const assignments: StaffingAssignment[] = slotResponses
    .filter((slot) => slot.assigned_user_id)
    .map((slot) => ({
      assignmentId: slot.assigned_shift_id ?? slot.slot_key,
      shootId: shoot.id,
      employeeId: slot.assigned_user_id ?? "",
      assignmentRole: slot.staffing_role ?? "photographer",
      assignmentStatus: slot.assignment_status,
      countsTowardLeadCoverage: Boolean(slot.satisfies_lead_coverage),
      linkedShiftId: slot.assigned_shift_id
    }));
  const validation = validateStaffingCoverage(operationalRequirement, assignments);
  const assignedStaffCount = assignments.length;
  const leadCoverageCount = validation.leadCoverage.assignedLeadCount;
  const openSlotCount = slotResponses.filter((slot) => !slot.assigned_user_id).length;
  const openRequiredSlotCount = slotResponses.filter((slot) => !slot.assigned_user_id && slot.is_required_slot).length;
  const draftShiftCount = shifts.filter((shift) => shift.status === "draft").length;
  const publishedShiftCount = shifts.filter((shift) => shift.status === "published" || shift.status === "completed").length;
  const conflictWarningCount = slotResponses.filter((slot) =>
    slot.option_groups.some((group) => group.key === "current_assignment" && group.options[0]?.requires_override)
  ).length;
  const outlookCalendarConflictCount = slotResponses.reduce(
    (total, slot) =>
      total +
      slot.option_groups.reduce(
        (slotTotal, group) => slotTotal + group.options.filter((option) => option.calendar_conflict_status !== "clear").length,
        0
      ),
    0
  );
  const unpublishedAssignedCount = slotResponses.filter(
    (slot) => Boolean(slot.assigned_user_id) && slot.shift_status === "draft"
  ).length;
  const missingLead = validation.leadCoverage.missingLeadCount > 0;
  const underStaffed = !validation.staffingValidationPassed;
  const overStaffed = assignedStaffCount > plannedStaffCount && plannedStaffCount > 0;
  const fragileCoverage =
    slotResponses.some(
      (slot) =>
        Boolean(slot.assigned_user_id) &&
        slot.warnings.some((warning) =>
          ["tight turnaround", "next shoot soon", "overtime risk", "reassigned"].includes(warning.toLowerCase())
        )
    ) || conflictWarningCount > 0;

  for (const blockingArea of validation.blockingAreas) {
    if (blockingArea === "lead_coverage") {
      hardBlockers.push("No required lead is assigned.");
    }
    if (blockingArea === "minimum_staffing_coverage") {
      hardBlockers.push("Minimum staffing is not met.");
    }
    if (blockingArea === "required_role_coverage") {
      hardBlockers.push("One or more required staffing roles are still unfilled.");
    }
  }
  if (openRequiredSlotCount > 0) {
    hardBlockers.push(
      `${openRequiredSlotCount} required staffing slot${openRequiredSlotCount === 1 ? "" : "s"} still need coverage.`
    );
  }
  if (openSlotCount > 0) {
    warnings.push(`${openSlotCount} staffing slot${openSlotCount === 1 ? "" : "s"} still open.`);
  }
  if (assignedStaffCount < plannedStaffCount && assignedStaffCount >= minimumStaffCount) {
    warnings.push(`${plannedStaffCount - assignedStaffCount} ideal staffing slot${plannedStaffCount - assignedStaffCount === 1 ? "" : "s"} still open.`);
  }
  if (overStaffed) {
    warnings.push("More staff are assigned than the current staffing plan calls for.");
  }
  if (conflictWarningCount) {
    warnings.push(`${conflictWarningCount} assigned slot${conflictWarningCount === 1 ? "" : "s"} carry conflict warnings.`);
  }
  if (outlookCalendarConflictCount) {
    warnings.push(
      `${outlookCalendarConflictCount} staffing option${outlookCalendarConflictCount === 1 ? "" : "s"} intersect Outlook busy time or travel buffers.`
    );
  }
  if (unpublishedAssignedCount > 0) {
    warnings.push("Staffing assignments are still in draft and have not been published to employees.");
  }
  if (slotResponses.some((slot) => (slot.reassignment_history?.length ?? 0) > 0)) {
    warnings.push("Recent reassignment activity is affecting coverage.");
  }

  const staffingHealth = evaluateOperationalStaffingHealth({
    requirementCount: requirements.length,
    assignedStaffCount,
    idealStaffCount: plannedStaffCount,
    minimumStaffCount,
    openSlotCount,
    conflictWarningCount,
    unpublishedAssignedCount,
    fragileCoverage,
    validation,
    hardBlockers,
    warnings
  });

  const priorityState = buildPriorityState({ ...shoot, assigned_staff_count: assignedStaffCount }, auth);
  const publishState =
    assignedStaffCount > 0 && draftShiftCount === 0 && publishedShiftCount >= assignedStaffCount
      ? "published"
      : assignedStaffCount > 0
        ? "ready_to_publish"
        : "draft";
  const approvalSummary = await listOperationalApprovalSourceSummary(client, auth, {
    sourceModule: "scheduling",
    sourceEntityType: "shoot",
    sourceEntityId: shootId
  });

  return {
    shoot: {
      id: shoot.id,
      shoot_code: shoot.shoot_code,
      title: shoot.title,
      shoot_date: shoot.shoot_date,
      department: shoot.department,
      location_name: shoot.location_name,
      location_address: shoot.location_address,
      arrival_time: shoot.arrival_time,
      start_time: shoot.start_time,
      end_time_est: shoot.end_time_est,
      planned_staff_count: plannedStaffCount,
      minimum_staff_count: minimumStaffCount,
      assigned_staff_count: assignedStaffCount,
      required_lead_count: requiredLeadCount,
      lead_coverage_count: leadCoverageCount,
      lead_name:
        slotResponses
          .filter((slot) => slot.satisfies_lead_coverage && slot.assigned_user_name)
          .map((slot) => slot.assigned_user_name)
          .join(", ") || null,
      conflict_warning_count: conflictWarningCount,
      draft_shift_count: draftShiftCount,
      published_shift_count: publishedShiftCount,
      schedule_sync_state: shoot.schedule_sync_state,
      schedule_sync_required: Boolean(shoot.schedule_sync_required),
      staffing_state: staffingHealth.state,
      staffing_state_display: staffingHealth.displayLabel,
      staffing_clean_for_ready: staffingHealth.cleanForReady,
      staffing_hard_blockers: [...new Set(staffingHealth.hardBlockers)],
      staffing_warnings: [...new Set(staffingHealth.warnings)],
      open_slot_count: openSlotCount,
      open_required_slot_count: openRequiredSlotCount,
      publish_state: publishState,
      under_staffed: underStaffed,
      over_staffed: overStaffed,
      missing_lead: missingLead,
      priority_label: priorityState.priority_label,
      priority_label_display: priorityState.priority_label_display,
      priority_reasons: priorityState.priority_reasons,
      future_profitability_flag: priorityState.future_profitability_flag,
      future_profitability_display: priorityState.future_profitability_display
    },
    warnings: [...new Set([...staffingHealth.hardBlockers, ...staffingHealth.warnings])],
    requirements: requirements.map((requirement) => {
      const requirementSlots = slotResponses.filter((slot) => slot.requirement_id === requirement.id);
      return {
        requirement_id: requirement.id,
        source_of_creation: requirement.source_of_creation,
        source_of_creation_display: humanizeStaffingCreationSource(requirement.source_of_creation),
        staffing_role: requirement.staffing_role,
        label: requirement.label,
        minimum_count: Math.max(Number(requirement.minimum_count ?? 0), 0),
        ideal_count: Math.max(Number(requirement.ideal_count ?? 0), Math.max(Number(requirement.minimum_count ?? 0), 0)),
        required_for_ready: Boolean(requirement.required_for_ready),
        lead_eligible: Boolean(requirement.lead_eligible),
        lead_required: Boolean(requirement.lead_required),
        call_offset_minutes: Number(requirement.call_offset_minutes ?? 0),
        start_offset_minutes: Number(requirement.start_offset_minutes ?? 0),
        end_offset_minutes: Number(requirement.end_offset_minutes ?? 0),
        location_name_override: requirement.location_name_override ?? null,
        location_address_override: requirement.location_address_override ?? null,
        required_qualification_tags: normalizeTags(requirement.required_qualification_tags),
        notes: requirement.role_notes ?? null,
        sort_order: Number(requirement.sort_order ?? 0),
        assigned_count: requirementSlots.filter((slot) => slot.assigned_user_id).length,
        open_count: requirementSlots.filter((slot) => !slot.assigned_user_id).length
      };
    }),
    slots: slotResponses,
    approval_summary: approvalSummary
  };
}

export async function getShootStaffingSnapshot(client: PoolClient, auth: AuthUser, shootId: string) {
  return buildStaffingSnapshot(client, auth, shootId);
}

function appendReassignmentHistory(
  slot: Pick<
    DesiredSlot,
    "reassignment_history" | "assigned_user_id" | "assigned_user_name" | "assignment_source"
  >,
  auth: AuthUser,
  input: {
    action: "assigned" | "reassigned" | "removed";
    toUserId?: string | null;
    toUserName?: string | null;
    reason?: string | null;
  }
) {
  return [
    ...(slot.reassignment_history ?? []),
    {
      action: input.action,
      actor_user_id: auth.id,
      actor_name: auth.fullName,
      changed_at: new Date().toISOString(),
      reason: input.reason?.trim() || null,
      from_user_id: slot.assigned_user_id ?? null,
      from_user_name: slot.assigned_user_name ?? null,
      to_user_id: input.toUserId ?? null,
      to_user_name: input.toUserName ?? null
    }
  ];
}

async function persistShiftStaffingMetadata(
  client: PoolClient,
  tenantId: string,
  input: {
    shiftId: string;
    requirementId?: string | null;
    assignmentSource?: StaffingCreationSource | null;
    reassignmentHistory?: ShootShiftRow["reassignment_history"];
    conflictStatus?: WorkShiftOutlookConflictStatus;
    conflictDetail?: Record<string, unknown> | null;
  }
) {
  const normalizedRequirementId =
    input.requirementId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requirementId)
      ? input.requirementId
      : null;
  await client.query(
    `
      UPDATE work_shift
      SET staffing_requirement_id = $3,
          assignment_source = COALESCE($4, assignment_source),
          reassignment_history = COALESCE($5::jsonb, reassignment_history),
          conflict_status = COALESCE($6::outlook_conflict_status, conflict_status),
          conflict_detail = COALESCE($7::jsonb, conflict_detail)
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      tenantId,
      input.shiftId,
      normalizedRequirementId,
      input.assignmentSource ?? null,
      input.reassignmentHistory ? JSON.stringify(input.reassignmentHistory) : null,
      input.conflictStatus ?? null,
      input.conflictDetail ? JSON.stringify(input.conflictDetail) : null
    ]
  );
}

async function sendStaffingNotification(
  client: PoolClient,
  auth: AuthUser,
  input: {
    recipientUserIds: string[];
    notificationType: string;
    title: string;
    body: string;
    shiftId?: string | null;
    shootId: string;
    priority?: "normal" | "high" | "critical";
    metadata?: Record<string, unknown>;
  }
) {
  const recipientUserIds = [...new Set(input.recipientUserIds.filter((value) => Boolean(value && value !== auth.id)))];
  if (!recipientUserIds.length) {
    return;
  }
  await queueNotificationDispatch(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    recipientUserIds,
    notificationType: input.notificationType,
    title: input.title,
    body: input.body,
    priority: input.priority ?? "normal",
    deepLink: "#operations/schedule",
    shiftId: input.shiftId ?? null,
    shootId: input.shootId,
    channels: input.priority === "critical" ? ["in_app", "push", "email"] : ["in_app", "push"],
    metadata: input.metadata
  });
}

async function resolveStaffingApprovalGate(
  client: PoolClient,
  auth: AuthUser,
  input: {
    requiresApproval: boolean;
    reason: string | null;
    reasonRequired?: boolean;
    reasonRequiredMessage?: string;
    dedupeKey: string;
    requestType:
      | "staffing_exception_approval"
      | "schedule_change_approval"
      | "role_override_approval"
      | "overtime_labor_exception_approval";
    severity: "normal" | "high" | "critical";
    requestedActionCode: string;
    requestTitle: string;
    requestSummary: string;
    sourceEntityId: string;
    sourceEntityLabel: string;
    currentState: Record<string, unknown>;
    requestedState: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }
): Promise<{ approvalRequestId: string | null; approvalResponse: StaffingMutationResult | null }> {
  const consumedApproval = await consumeApprovedOperationalApproval(client, auth, input.dedupeKey);
  if ("approval_required" in consumedApproval) {
    if (consumedApproval.consumed_approval_request_id) {
      return {
        approvalRequestId: consumedApproval.consumed_approval_request_id,
        approvalResponse: null
      };
    }
    if (!input.requiresApproval) {
      return {
        approvalRequestId: consumedApproval.consumed_approval_request_id ?? null,
        approvalResponse: null
      };
    }

    const reason = normalizeNullableText(input.reason);
    if (input.reasonRequired && !reason) {
      throw new ApiError(400, input.reasonRequiredMessage ?? "A reason is required before submitting this approval request.");
    }
    const approvalRequest = await ensureOperationalApprovalRequest(client, auth, {
      requestType: input.requestType,
      sourceModule: "scheduling",
      sourceEntityType: "shoot",
      sourceEntityId: input.sourceEntityId,
      sourceEntityLabel: input.sourceEntityLabel,
      requesterDepartment: auth.department,
      requestedActionCode: input.requestedActionCode,
      requestTitle: input.requestTitle,
      requestSummary: input.requestSummary,
      reason: reason ?? input.requestSummary,
      severity: input.severity,
      blocking: true,
      dedupeKey: input.dedupeKey,
      currentState: input.currentState,
      requestedState: input.requestedState,
      metadata: input.metadata
    });
    return {
      approvalRequestId: null,
      approvalResponse: {
        approval_required: true,
        approval_request: approvalRequest,
        snapshot: await buildStaffingSnapshot(client, auth, input.sourceEntityId)
      }
    };
  }

  return {
    approvalRequestId: null,
    approvalResponse: {
      approval_required: true,
      approval_request: consumedApproval,
      snapshot: await buildStaffingSnapshot(client, auth, input.sourceEntityId)
    }
  };
}

function buildStaffingApprovalDedupeKey(input: {
  shootId: string;
  action: "assign" | "remove" | "publish";
  slotKey?: string | null;
  assignedUserId?: string | null;
  flags?: string[];
}) {
  return [
    "scheduling",
    input.shootId,
    input.action,
    input.slotKey ?? "na",
    input.assignedUserId ?? "na",
    ...(input.flags ?? []).sort()
  ].join(":");
}

export async function assignShootStaffingSlot(
  client: PoolClient,
  auth: AuthUser,
  input: {
    shootId: string;
    slotKey: string;
    assignedUserId: string;
    overrideConflict?: boolean;
    approvalReason?: string | null;
  },
  meta: RequestMeta
): Promise<StaffingMutationResult> {
  const snapshot = await buildStaffingSnapshot(client, auth, input.shootId);
  const department = snapshot.shoot.department as DepartmentCode;
  if (!canManageShootDepartment(auth, department)) {
    throw new ApiError(403, "Forbidden");
  }

  const slot = snapshot.slots.find((candidate) => candidate.slot_key === input.slotKey);
  if (!slot) {
    throw new ApiError(404, "Staffing slot not found");
  }
  const option = slot.option_groups.flatMap((group) => group.options).find((candidate) => candidate.user_id === input.assignedUserId);
  if (!option) {
    throw new ApiError(404, "Selected staff member is not available in this staffing list");
  }
  if (option.disabled) {
    throw new ApiError(409, `Cannot assign ${option.name}: ${option.short_reason ?? option.status}`);
  }
  if (option.requires_override && !input.overrideConflict) {
    throw new ApiError(409, `Assigning ${option.name} requires an override because ${option.short_reason ?? "a conflict exists"}.`);
  }

  const staffingWindowEvaluation = evaluateLastMinuteStaffingChange({
    actionKind: "change_staffing_assignment",
    currentPublicationState: snapshot.shoot.publish_state,
    shootStartsAt: snapshot.shoot.arrival_time ?? snapshot.shoot.start_time,
    staffingCountWillBeReduced: false,
    leadCoverageWillBeReduced: false
  });
  if (staffingWindowEvaluation.blocked) {
    throw new ApiError(409, staffingWindowEvaluation.blockingRules[0]?.message ?? "This staffing change is blocked inside the locked window.");
  }
  const approvalReasonRequired =
    staffingWindowEvaluation.windowEvaluation.insideProtectedWindow ||
    (slot.satisfies_lead_coverage && Boolean(slot.assigned_user_id));
  if (approvalReasonRequired && !input.approvalReason?.trim()) {
    throw new ApiError(400, "This staffing change requires a reason.");
  }
  const needsApproval =
    staffingWindowEvaluation.overrideRequired || slot.satisfies_lead_coverage || Boolean(input.overrideConflict);
  const canExecuteDirectly = !needsApproval || hasManagerApprovalAuthority(auth);
  const approvalGate = await resolveStaffingApprovalGate(client, auth, {
    requiresApproval: needsApproval && !canExecuteDirectly,
    reason: input.approvalReason ?? null,
    reasonRequired: approvalReasonRequired,
    reasonRequiredMessage: "This staffing change requires a reason.",
    dedupeKey: buildStaffingApprovalDedupeKey({
      shootId: input.shootId,
      action: "assign",
      slotKey: input.slotKey,
      assignedUserId: input.assignedUserId,
      flags: [
        staffingWindowEvaluation.windowEvaluation.insideProtectedWindow ? "protected-window" : "open-window",
        slot.satisfies_lead_coverage ? "lead-slot" : "standard-slot",
        input.overrideConflict ? "conflict-override" : "standard-assignment"
      ]
    }),
    requestType: input.overrideConflict
      ? "staffing_exception_approval"
      : slot.satisfies_lead_coverage
        ? "role_override_approval"
        : "schedule_change_approval",
    severity:
      input.overrideConflict || snapshot.shoot.priority_label === "critical_shoot" || slot.satisfies_lead_coverage
        ? "critical"
        : staffingWindowEvaluation.windowEvaluation.insideProtectedWindow
          ? "high"
          : "normal",
    requestedActionCode: "schedule.staffing.assign",
    requestTitle: `Approval needed to assign ${option.name} to ${slot.label} on ${snapshot.shoot.shoot_code}`,
    requestSummary: input.overrideConflict
      ? `${option.name} has a staffing conflict override on ${snapshot.shoot.shoot_code}.`
      : slot.satisfies_lead_coverage
        ? `${option.name} is being assigned to a lead coverage slot on ${snapshot.shoot.shoot_code}.`
        : `${option.name} is being assigned to ${slot.label} on ${snapshot.shoot.shoot_code} inside the protected staffing window.`,
    sourceEntityId: input.shootId,
    sourceEntityLabel: snapshot.shoot.shoot_code,
    currentState: {
      slot_key: input.slotKey,
      assigned_user_id: slot.assigned_user_id,
      publish_state: snapshot.shoot.publish_state,
      staffing_state: snapshot.shoot.staffing_state
    },
    requestedState: {
      slot_key: input.slotKey,
      assigned_user_id: input.assignedUserId,
      override_conflict: Boolean(input.overrideConflict),
      approval_reason: input.approvalReason?.trim() || null
    },
    metadata: {
      staffing_role: slot.staffing_role,
      lead_slot: slot.satisfies_lead_coverage,
      protected_window: staffingWindowEvaluation.windowEvaluation.insideProtectedWindow,
      short_reason: option.short_reason
    }
  });
  if (approvalGate.approvalResponse) {
    return approvalGate.approvalResponse;
  }

  const members = await listScheduleMembers(client, auth, snapshot.shoot.shoot_date);
  const member = members.find((candidate) => candidate.id === input.assignedUserId);
  if (!member) {
    throw new ApiError(404, "Selected staff member could not be resolved");
  }

  const startsAt = slot.start_time ?? snapshot.shoot.start_time ?? snapshot.shoot.arrival_time;
  const endsAt = slot.end_time ?? snapshot.shoot.end_time_est;
  if (!startsAt || !endsAt) {
    throw new ApiError(409, "Finish arrival, shoot, and teardown timing before assigning staff.");
  }
  const reassignmentHistory =
    slot.assigned_user_id && slot.assigned_user_id !== input.assignedUserId
      ? appendReassignmentHistory(slot, auth, {
          action: "reassigned",
          toUserId: input.assignedUserId,
          toUserName: member.full_name,
          reason: input.approvalReason ?? option.short_reason ?? null
        })
      : slot.assigned_user_id
        ? slot.reassignment_history ?? []
        : appendReassignmentHistory(slot, auth, {
            action: "assigned",
            toUserId: input.assignedUserId,
            toUserName: member.full_name,
            reason: input.approvalReason ?? null
          });

  const payload: Partial<WorkShiftInput> = {
    shoot_id: snapshot.shoot.id,
    assigned_user_id: input.assignedUserId,
    manager_user_id: auth.id,
    shift_kind: "shoot",
    department,
    staffing_role: resolveAssignmentStaffingRole(slot, member),
    satisfies_lead_coverage: Boolean(slot.satisfies_lead_coverage),
    title: `${snapshot.shoot.shoot_code} ${slot.label}`,
    starts_at: startsAt,
    ends_at: endsAt,
    location_name: slot.location_name ?? snapshot.shoot.location_name ?? snapshot.shoot.title,
    location_address: slot.location_address ?? snapshot.shoot.location_address ?? "",
    notes: slot.notes ?? null
  };

  const result = slot.assigned_shift_id
    ? await updateShift(client, auth, slot.assigned_shift_id, payload, meta)
    : await createShift(
        client,
        auth,
        {
          shoot_id: snapshot.shoot.id,
          assigned_user_id: input.assignedUserId,
          manager_user_id: auth.id,
          shift_kind: "shoot",
          department,
          staffing_role: payload.staffing_role ?? "photographer",
          satisfies_lead_coverage: Boolean(payload.satisfies_lead_coverage),
          title: payload.title ?? `${snapshot.shoot.shoot_code} ${slot.label}`,
          starts_at: startsAt,
          ends_at: endsAt,
          location_name: payload.location_name ?? snapshot.shoot.location_name ?? snapshot.shoot.title,
          location_address: payload.location_address ?? snapshot.shoot.location_address ?? ""
        },
        meta
      );

  await persistShiftStaffingMetadata(client, auth.tenantId, {
    shiftId: result.id,
    requirementId: slot.requirement_id,
    assignmentSource: slot.assignment_source ?? slot.source_of_creation ?? "manual_from_shoot",
    reassignmentHistory,
    conflictStatus: option.calendar_conflict_status,
    conflictDetail: option.calendar_conflict_detail
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: input.assignedUserId,
    action: slot.assigned_user_id && slot.assigned_user_id !== input.assignedUserId ? "schedule.staffing.reassigned" : "schedule.staffing.assignment_created",
    entityType: "shoot",
    entityId: input.shootId,
    metadata: {
      slot_key: input.slotKey,
      requirement_id: slot.requirement_id,
      assignment_source: slot.assignment_source ?? slot.source_of_creation ?? "manual_from_shoot",
      prior_assigned_user_id: slot.assigned_user_id ?? null,
      next_assigned_user_id: input.assignedUserId,
      approval_reason: input.approvalReason?.trim() || null,
      lead_slot: slot.satisfies_lead_coverage,
      protected_window: staffingWindowEvaluation.windowEvaluation.insideProtectedWindow
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  if (input.overrideConflict) {
    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: input.assignedUserId,
      action: "schedule.staffing.override",
      entityType: "shoot",
      entityId: input.shootId,
      metadata: {
        slot_key: input.slotKey,
        assigned_shift_id: result.id,
        short_reason: option.short_reason,
        before_label: option.before_label,
        during_label: option.during_label,
        after_label: option.after_label,
        approval_level: getApprovalLevelLabel(
          resolveStaffingApprovalLevel({
            insideProtectedWindow: staffingWindowEvaluation.windowEvaluation.insideProtectedWindow,
            leadAssignmentChange: slot.satisfies_lead_coverage,
            warningOverride: false,
            conflictOverride: true
          })
        ),
        approval_role_group: resolvePhase1RoleGroup(auth),
        approval_reason: input.approvalReason?.trim() || option.short_reason || null
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });
  }
  if (slot.satisfies_lead_coverage) {
    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: input.assignedUserId,
      action: "schedule.staffing.lead_assignment.updated",
      entityType: "shoot",
      entityId: input.shootId,
      metadata: {
        slot_key: input.slotKey,
        assigned_shift_id: result.id,
        prior_assigned_user_id: slot.assigned_user_id ?? null,
        next_assigned_user_id: input.assignedUserId,
        approval_level: getApprovalLevelLabel(
          resolveStaffingApprovalLevel({
            insideProtectedWindow: staffingWindowEvaluation.windowEvaluation.insideProtectedWindow,
            leadAssignmentChange: true,
            warningOverride: false,
            conflictOverride: Boolean(input.overrideConflict)
          })
        ),
        approval_role_group: resolvePhase1RoleGroup(auth),
        window_level: staffingWindowEvaluation.windowEvaluation.windowLevel,
        approval_reason: input.approvalReason?.trim() || null
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });
  }
  if (staffingWindowEvaluation.windowEvaluation.insideProtectedWindow) {
    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: input.assignedUserId,
      action: "schedule.staffing.protected_window_change",
      entityType: "shoot",
      entityId: input.shootId,
      metadata: {
        slot_key: input.slotKey,
        assigned_shift_id: result.id,
        prior_assigned_user_id: slot.assigned_user_id ?? null,
        next_assigned_user_id: input.assignedUserId,
        window_level: staffingWindowEvaluation.windowEvaluation.windowLevel,
        hours_until_shoot_start: staffingWindowEvaluation.windowEvaluation.hoursUntilShootStart,
        approval_level: getApprovalLevelLabel(
          resolveStaffingApprovalLevel({
            insideProtectedWindow: true,
            leadAssignmentChange: slot.satisfies_lead_coverage,
            warningOverride: false,
            conflictOverride: Boolean(input.overrideConflict)
          })
        ),
        approval_role_group: resolvePhase1RoleGroup(auth),
        approval_reason: input.approvalReason?.trim() || null
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });
  }

  await sendStaffingNotification(client, auth, {
    recipientUserIds: [input.assignedUserId, ...(slot.assigned_user_id ? [slot.assigned_user_id] : [])],
    notificationType: slot.assigned_user_id && slot.assigned_user_id !== input.assignedUserId ? "schedule.staffing.reassigned" : "schedule.staffing.assigned",
    title: slot.assigned_user_id && slot.assigned_user_id !== input.assignedUserId ? "Assignment updated" : "New assignment",
    body:
      slot.assigned_user_id && slot.assigned_user_id !== input.assignedUserId
        ? `${member.full_name} is now covering ${slot.label} on ${snapshot.shoot.shoot_code}.`
        : `${member.full_name} was assigned to ${slot.label} on ${snapshot.shoot.shoot_code}.`,
    shiftId: result.id,
    shootId: input.shootId,
    priority: staffingWindowEvaluation.windowEvaluation.insideProtectedWindow ? "high" : "normal",
    metadata: {
      slot_key: input.slotKey,
      dedupe: `staffing-assignment:${result.id}:${input.assignedUserId}`
    }
  });

  if (option.calendar_conflict_status !== "clear") {
    await queueStaffAssignmentConflictDetectedAlert(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      shootId: input.shootId,
      shootCode: snapshot.shoot.shoot_code,
      shootDate: snapshot.shoot.shoot_date,
      slotLabel: slot.label,
      assignedUserName: member.full_name,
      shiftId: result.id,
      conflictStatus: option.calendar_conflict_status,
      conflictDetail: option.calendar_conflict_detail
    });
  }
  await markOperationalApprovalExecuted(
    client,
    auth,
    approvalGate.approvalRequestId,
    `Scheduling assignment executed for ${snapshot.shoot.shoot_code}.`
  );

  return buildStaffingSnapshot(client, auth, input.shootId);
}

export async function removeShootStaffingAssignment(
  client: PoolClient,
  auth: AuthUser,
  input: {
    shootId: string;
    slotKey: string;
    approvalReason?: string | null;
  },
  meta: RequestMeta
): Promise<StaffingMutationResult> {
  const snapshot = await buildStaffingSnapshot(client, auth, input.shootId);
  const department = snapshot.shoot.department as DepartmentCode;
  if (!canManageShootDepartment(auth, department)) {
    throw new ApiError(403, "Forbidden");
  }

  const slot = snapshot.slots.find((candidate) => candidate.slot_key === input.slotKey);
  if (!slot || !slot.assigned_shift_id || !slot.assigned_user_id) {
    throw new ApiError(404, "Assigned staffing slot not found");
  }

  const projectedAssignedCount = Math.max(snapshot.shoot.assigned_staff_count - 1, 0);
  const leadCoverageWillBeReduced = Boolean(slot.satisfies_lead_coverage);
  const dropsBelowMinimum =
    projectedAssignedCount < snapshot.shoot.minimum_staff_count ||
    slot.is_required_slot ||
    (leadCoverageWillBeReduced && snapshot.shoot.lead_coverage_count <= snapshot.shoot.required_lead_count);
  const staffingWindowEvaluation = evaluateLastMinuteStaffingChange({
    actionKind: "change_staffing_assignment",
    currentPublicationState: snapshot.shoot.publish_state,
    shootStartsAt: snapshot.shoot.arrival_time ?? snapshot.shoot.start_time,
    staffingCountWillBeReduced: true,
    leadCoverageWillBeReduced
  });

  if (staffingWindowEvaluation.blocked) {
    throw new ApiError(409, staffingWindowEvaluation.blockingRules[0]?.message ?? "This staffing removal is blocked inside the locked window.");
  }
  const needsApproval =
    staffingWindowEvaluation.overrideRequired || dropsBelowMinimum || leadCoverageWillBeReduced;
  if (needsApproval && !input.approvalReason?.trim()) {
    throw new ApiError(400, "Removing this assignment requires a reason.");
  }
  const canExecuteDirectly = !needsApproval || hasManagerApprovalAuthority(auth);
  const approvalGate = await resolveStaffingApprovalGate(client, auth, {
    requiresApproval: needsApproval && !canExecuteDirectly,
    reason: input.approvalReason ?? null,
    reasonRequired: needsApproval,
    reasonRequiredMessage: "Removing this assignment requires a reason.",
    dedupeKey: buildStaffingApprovalDedupeKey({
      shootId: input.shootId,
      action: "remove",
      slotKey: input.slotKey,
      assignedUserId: slot.assigned_user_id,
      flags: [
        staffingWindowEvaluation.windowEvaluation.insideProtectedWindow ? "protected-window" : "open-window",
        dropsBelowMinimum ? "drops-below-minimum" : "coverage-holds",
        leadCoverageWillBeReduced ? "lead-reduction" : "standard-reduction"
      ]
    }),
    requestType: dropsBelowMinimum || leadCoverageWillBeReduced ? "staffing_exception_approval" : "schedule_change_approval",
    severity:
      leadCoverageWillBeReduced || dropsBelowMinimum || snapshot.shoot.priority_label === "critical_shoot"
        ? "critical"
        : staffingWindowEvaluation.windowEvaluation.insideProtectedWindow
          ? "high"
          : "normal",
    requestedActionCode: "schedule.staffing.remove",
    requestTitle: `Approval needed to remove ${slot.label} from ${snapshot.shoot.shoot_code}`,
    requestSummary: `${slot.label} would be left open on ${snapshot.shoot.shoot_code}.`,
    sourceEntityId: input.shootId,
    sourceEntityLabel: snapshot.shoot.shoot_code,
    currentState: {
      slot_key: input.slotKey,
      assigned_user_id: slot.assigned_user_id,
      assigned_shift_id: slot.assigned_shift_id,
      staffing_state: snapshot.shoot.staffing_state
    },
    requestedState: {
      slot_key: input.slotKey,
      assigned_user_id: null,
      approval_reason: input.approvalReason?.trim() || null
    },
    metadata: {
      lead_slot: slot.satisfies_lead_coverage,
      protected_window: staffingWindowEvaluation.windowEvaluation.insideProtectedWindow,
      drops_below_minimum: dropsBelowMinimum
    }
  });
  if (approvalGate.approvalResponse) {
    return approvalGate.approvalResponse;
  }

  const reassignmentHistory = appendReassignmentHistory(slot, auth, {
    action: "removed",
    reason: input.approvalReason ?? null
  });

  await client.query(
    `
      UPDATE work_shift
      SET status = 'cancelled'::work_shift_status,
          cancelled_at = now(),
          updated_at = now(),
          reassignment_history = $4::jsonb
      WHERE tenant_id = $1
        AND id = $2
        AND shoot_id = $3
    `,
    [auth.tenantId, slot.assigned_shift_id, input.shootId, JSON.stringify(reassignmentHistory)]
  );

  await queueWorkShiftOutlookSync(client, {
    tenantId: auth.tenantId,
    shiftId: slot.assigned_shift_id,
    triggeredByUserId: auth.id,
    operationType: "cancel",
    previousAssignedUserId: slot.assigned_user_id,
    dedupeSuffix: `staffing-remove:${slot.assigned_shift_id}:${Date.now()}`
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: slot.assigned_user_id,
    action: "schedule.staffing.removed",
    entityType: "shoot",
    entityId: input.shootId,
    metadata: {
      slot_key: input.slotKey,
      requirement_id: slot.requirement_id,
      removed_user_id: slot.assigned_user_id,
      lead_slot: slot.satisfies_lead_coverage,
      drops_below_minimum: dropsBelowMinimum,
      protected_window: staffingWindowEvaluation.windowEvaluation.insideProtectedWindow,
      approval_level: getApprovalLevelLabel(
        resolveStaffingApprovalLevel({
          insideProtectedWindow: staffingWindowEvaluation.windowEvaluation.insideProtectedWindow,
          leadAssignmentChange: slot.satisfies_lead_coverage,
          warningOverride: dropsBelowMinimum,
          conflictOverride: false
        })
      ),
      approval_role_group: resolvePhase1RoleGroup(auth),
      approval_reason: input.approvalReason?.trim() || null
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  if (staffingWindowEvaluation.windowEvaluation.insideProtectedWindow) {
    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: slot.assigned_user_id,
      action: "schedule.staffing.protected_window_change",
      entityType: "shoot",
      entityId: input.shootId,
      metadata: {
        slot_key: input.slotKey,
        removed_user_id: slot.assigned_user_id,
        lead_slot: slot.satisfies_lead_coverage,
        drops_below_minimum: dropsBelowMinimum,
        window_level: staffingWindowEvaluation.windowEvaluation.windowLevel,
        hours_until_shoot_start: staffingWindowEvaluation.windowEvaluation.hoursUntilShootStart,
        approval_reason: input.approvalReason?.trim() || null
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });
  }

  await sendStaffingNotification(client, auth, {
    recipientUserIds: [slot.assigned_user_id],
    notificationType: "schedule.staffing.removed",
    title: "Assignment removed",
    body: `${slot.label} on ${snapshot.shoot.shoot_code} was removed from your schedule.`,
    shiftId: slot.assigned_shift_id,
    shootId: input.shootId,
    priority: staffingWindowEvaluation.windowEvaluation.insideProtectedWindow ? "high" : "normal",
    metadata: {
      slot_key: input.slotKey,
      dedupe: `staffing-removal:${slot.assigned_shift_id}`
    }
  });
  await markOperationalApprovalExecuted(
    client,
    auth,
    approvalGate.approvalRequestId,
    `Scheduling removal executed for ${snapshot.shoot.shoot_code}.`
  );

  return buildStaffingSnapshot(client, auth, input.shootId);
}

export async function publishShootStaffing(
  client: PoolClient,
  auth: AuthUser,
  input: {
    shootId: string;
    overrideWarnings?: boolean;
    approvalReason?: string | null;
  },
  meta: RequestMeta
): Promise<StaffingMutationResult> {
  const snapshot = await buildStaffingSnapshot(client, auth, input.shootId);
  const department = snapshot.shoot.department as DepartmentCode;
  if (!canManageShootDepartment(auth, department)) {
    throw new ApiError(403, "Forbidden");
  }
  if (!snapshot.slots.some((slot) => slot.assigned_shift_id)) {
    throw new ApiError(409, "Create at least one staffing assignment before publishing.");
  }
  const protectedPublishEvaluation = evaluateLastMinuteStaffingChange({
    actionKind: "publish_staffing",
    currentPublicationState: snapshot.shoot.publish_state,
    shootStartsAt: snapshot.shoot.arrival_time ?? snapshot.shoot.start_time,
    actionEvaluation:
      snapshot.shoot.staffing_hard_blockers.length > 0 ||
      snapshot.shoot.staffing_warnings.length > 0 ||
      snapshot.shoot.over_staffed ||
      snapshot.shoot.conflict_warning_count > 0
        ? {
            actionKind: "publish_staffing",
            dangerousActionTypes: [],
            overrideRequirement: {
              required: true,
              requiredCapabilities: [],
              dangerousActionTypes: [],
              reason: "Publishing still carries operational staffing risk."
            },
            directActionAllowed: false,
            actionAllowed: true,
            hardConflicts: [],
            softConflicts: [],
            warnings: [],
            conflictEvaluation: createStaffingConflictEvaluationResult([]),
            staffingValidation: null
          }
        : null
  });
  if (snapshot.shoot.staffing_hard_blockers.length > 0 && !input.overrideWarnings) {
    throw new ApiError(409, snapshot.shoot.staffing_hard_blockers[0] ?? "Publishing requires staffing blockers to be resolved or explicitly overridden.");
  }
  if ((snapshot.shoot.staffing_warnings.length > 0 || snapshot.shoot.conflict_warning_count > 0 || snapshot.shoot.over_staffed) && !input.overrideWarnings) {
    throw new ApiError(409, "Publishing this staffing plan requires an explicit warning override.");
  }
  const needsApproval = protectedPublishEvaluation.overrideRequired || Boolean(input.overrideWarnings);
  if (needsApproval && !input.approvalReason?.trim()) {
    throw new ApiError(400, "Publishing this staffing plan requires a reason.");
  }
  const canExecuteDirectly = !needsApproval || canPublishStaffingWarnings(auth);
  const approvalGate = await resolveStaffingApprovalGate(client, auth, {
    requiresApproval: needsApproval && !canExecuteDirectly,
    reason: input.approvalReason ?? null,
    reasonRequired: needsApproval,
    reasonRequiredMessage: "Publishing this staffing plan requires a reason.",
    dedupeKey: buildStaffingApprovalDedupeKey({
      shootId: input.shootId,
      action: "publish",
      flags: [
        protectedPublishEvaluation.windowEvaluation.insideProtectedWindow ? "protected-window" : "open-window",
        input.overrideWarnings ? "warning-override" : "clean-publish",
        snapshot.shoot.staffing_hard_blockers.length > 0 ? "hard-blockers" : "no-hard-blockers",
        snapshot.shoot.conflict_warning_count > 0 ? "conflicts" : "no-conflicts"
      ]
    }),
    requestType: input.overrideWarnings ? "staffing_exception_approval" : "schedule_change_approval",
    severity:
      snapshot.shoot.staffing_hard_blockers.length > 0 || snapshot.shoot.priority_label === "critical_shoot"
        ? "critical"
        : protectedPublishEvaluation.windowEvaluation.insideProtectedWindow
          ? "high"
          : "normal",
    requestedActionCode: "schedule.staffing.publish",
    requestTitle: `Approval needed to publish staffing for ${snapshot.shoot.shoot_code}`,
    requestSummary: input.overrideWarnings
      ? `${snapshot.shoot.shoot_code} is being published with staffing warnings or overrides.`
      : `${snapshot.shoot.shoot_code} is being published inside the protected staffing window.`,
    sourceEntityId: input.shootId,
    sourceEntityLabel: snapshot.shoot.shoot_code,
    currentState: {
      publish_state: snapshot.shoot.publish_state,
      staffing_state: snapshot.shoot.staffing_state,
      warnings: snapshot.warnings
    },
    requestedState: {
      publish_state: "published",
      override_warnings: Boolean(input.overrideWarnings),
      approval_reason: input.approvalReason?.trim() || null
    },
    metadata: {
      protected_window: protectedPublishEvaluation.windowEvaluation.insideProtectedWindow,
      staffing_hard_blockers: snapshot.shoot.staffing_hard_blockers,
      staffing_warnings: snapshot.shoot.staffing_warnings,
      conflict_warning_count: snapshot.shoot.conflict_warning_count
    }
  });
  if (approvalGate.approvalResponse) {
    return approvalGate.approvalResponse;
  }

  for (const slot of snapshot.slots) {
    if (slot.assigned_shift_id && slot.shift_status !== "published" && slot.shift_status !== "completed") {
      await publishShift(client, auth, slot.assigned_shift_id, meta);
    }
  }

  if (input.overrideWarnings) {
    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: null,
      action: "schedule.staffing.publish_override",
      entityType: "shoot",
      entityId: input.shootId,
      metadata: {
        warnings: snapshot.warnings,
        approval_level: getApprovalLevelLabel(
          resolveStaffingApprovalLevel({
            insideProtectedWindow: protectedPublishEvaluation.windowEvaluation.insideProtectedWindow,
            leadAssignmentChange: false,
            warningOverride: true,
            conflictOverride: false
          })
        ),
        approval_role_group: resolvePhase1RoleGroup(auth),
        approval_reason: input.approvalReason?.trim() || null
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });
  }
  if (protectedPublishEvaluation.windowEvaluation.insideProtectedWindow && snapshot.warnings.length) {
    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action: "schedule.staffing.protected_window_publish",
      entityType: "shoot",
      entityId: input.shootId,
      metadata: {
        warnings: snapshot.warnings,
        window_level: protectedPublishEvaluation.windowEvaluation.windowLevel,
        hours_until_shoot_start: protectedPublishEvaluation.windowEvaluation.hoursUntilShootStart,
        approval_level: getApprovalLevelLabel(
          resolveStaffingApprovalLevel({
            insideProtectedWindow: true,
            leadAssignmentChange: false,
            warningOverride: Boolean(input.overrideWarnings),
            conflictOverride: false
          })
        ),
        approval_role_group: resolvePhase1RoleGroup(auth),
        approval_reason: input.approvalReason?.trim() || null
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });
  }

  await sendStaffingNotification(client, auth, {
    recipientUserIds: snapshot.slots.flatMap((slot) => (slot.assigned_user_id ? [slot.assigned_user_id] : [])),
    notificationType: "schedule.staffing.published",
    title: "Assignment published",
    body: `${snapshot.shoot.shoot_code} staffing is now published on your schedule.`,
    shootId: input.shootId,
    priority: protectedPublishEvaluation.windowEvaluation.insideProtectedWindow ? "high" : "normal",
    metadata: {
      dedupe: `staffing-publish:${input.shootId}:${snapshot.shoot.published_shift_count}:${snapshot.shoot.draft_shift_count}`
    }
  });
  await markOperationalApprovalExecuted(
    client,
    auth,
    approvalGate.approvalRequestId,
    `Scheduling publish executed for ${snapshot.shoot.shoot_code}.`
  );

  return buildStaffingSnapshot(client, auth, input.shootId);
}

function availabilityGroupLabel(key: string) {
  switch (key) {
    case "available":
      return "Available";
    case "assigned_later":
      return "Assigned Later";
    case "on_shoot_now":
      return "On Shoot Now";
    case "partially_available":
      return "Partially Available";
    case "conflict":
      return "Conflict";
    case "pto":
      return "Blocked / PTO";
    case "overtime_watch":
      return "Overtime Watch";
    default:
      return "Unavailable";
  }
}

function locationLabel(row: Pick<StaffingOverviewShootRow, "location_name" | "location_address">) {
  return row.location_name?.trim() || row.location_address?.split(",").slice(0, 2).join(", ").trim() || "Location pending";
}

function normalizeNullableText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function mapCoverageRow(row: StaffingOverviewShootRow, auth: AuthUser) {
  const assignedStaffCount = Number(row.assigned_staff_count ?? 0);
  const plannedStaffCount = Number(row.planned_staff_count ?? 0);
  const requiredLeadCount = Math.max(Number(row.required_lead_count ?? 1), 1);
  const leadCoverageCount = Number(row.lead_coverage_count ?? 0);
  const conflictWarningCount = Number(row.conflict_warning_count ?? 0);
  const missingLead = leadCoverageCount < requiredLeadCount;
  const underStaffed = plannedStaffCount > assignedStaffCount;
  const priorityState = buildPriorityState(row, auth);

  return {
    shoot_id: row.id,
    shoot_code: row.shoot_code,
    title: row.title,
    shoot_date: row.shoot_date,
    department: row.department,
    location_label: locationLabel(row),
    time_label: formatTimeRange(row.arrival_time ?? row.start_time, row.end_time_est),
    assigned_staff_count: assignedStaffCount,
    planned_staff_count: plannedStaffCount,
    required_lead_count: requiredLeadCount,
    lead_coverage_count: leadCoverageCount,
    lead_present: !missingLead,
    lead_name: row.lead_names || null,
    missing_lead: missingLead,
    under_staffed: underStaffed,
    conflict_warning_count: conflictWarningCount,
    sync_state: row.schedule_sync_state,
    next_action: missingLead ? "Assign a lead-qualified photographer" : underStaffed ? "Fill open slots" : "Review warning",
    priority_label: priorityState.priority_label,
    priority_label_display: priorityState.priority_label_display,
    priority_reasons: priorityState.priority_reasons
  };
}

function compareCoverageRowPriority(
  left: StaffingDashboardResponse["open_coverage"][number],
  right: StaffingDashboardResponse["open_coverage"][number]
) {
  const leftRisk = (left.missing_lead ? 3 : 0) + (left.under_staffed ? 2 : 0) + (left.conflict_warning_count > 0 ? 1 : 0);
  const rightRisk = (right.missing_lead ? 3 : 0) + (right.under_staffed ? 2 : 0) + (right.conflict_warning_count > 0 ? 1 : 0);
  if (rightRisk !== leftRisk) {
    return rightRisk - leftRisk;
  }

  const importanceDelta = importanceRank(right.priority_label) - importanceRank(left.priority_label);
  if (importanceDelta !== 0) {
    return importanceDelta;
  }

  const leftTime = new Date(`${left.shoot_date}T12:00:00`).getTime();
  const rightTime = new Date(`${right.shoot_date}T12:00:00`).getTime();
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return left.title.localeCompare(right.title);
}

async function listCoverageRows(client: PoolClient, auth: AuthUser, startDate: string, endDate: string) {
  const { rows } = await client.query<StaffingOverviewShootRow>(
    `
      SELECT
        s.id,
        s.shoot_code,
        s.title,
        s.shoot_date::text,
        s.department,
        s.status::text,
        s.location_name,
        s.location_address,
        s.arrival_time::text,
        s.start_time::text,
        s.end_time_est::text,
        s.projected_students,
        s.estimated_drive_minutes,
        s.planned_staff_count,
        s.required_lead_count,
        s.schedule_sync_state::text,
        s.schedule_sync_required,
        s.revenue_potential_score,
        s.strategic_district_importance,
        s.account_growth_importance_score,
        s.complexity_score,
        s.customer_history_risk_score,
        s.multi_team_coordination,
        s.future_profitability_manual,
        s.camera_station_count,
        s.shoot_structure::text,
        s.first_year_customer_flag,
        s.flagship_priority_account_flag,
        s.weather_travel_risk_flag,
        s.manual_leadership_boost,
        s.importance_override_tier::text,
        s.importance_override_reason,
        COALESCE(
          (
            SELECT SUM(str.headcount)
            FROM staffing_template_role str
            WHERE str.tenant_id = s.tenant_id
              AND str.staffing_template_id = s.staffing_template_id
              AND str.staffing_role IN ('lead_photographer', 'senior_photographer', 'photographer')
          ),
          0
        ) AS template_photographer_count,
        EXISTS (
          SELECT 1
          FROM shoot_location_link sl
          JOIN post_shoot_evaluation pse
            ON pse.location_id = sl.location_id
           AND pse.tenant_id = sl.tenant_id
          WHERE sl.tenant_id = s.tenant_id
            AND sl.shoot_id = s.id
            AND (
              pse.overall_rating <= 2
              OR pse.on_time = 'No'
              OR pse.easy_access = 'No'
              OR COALESCE(NULLIF(trim(pse.late_details), ''), NULLIF(trim(pse.access_details), ''), NULLIF(trim(pse.notes), '')) IS NOT NULL
            )
        ) AS prior_major_issue_exists,
        COALESCE(
          (
            SELECT COUNT(DISTINCT ws.assigned_user_id)
            FROM work_shift ws
            WHERE ws.shoot_id = s.id
              AND ws.cancelled_at IS NULL
              AND ws.status IN ('draft', 'published', 'completed')
          ),
          0
        ) AS assigned_staff_count,
        COALESCE(
          (
            SELECT COUNT(*)
            FROM work_shift ws
            WHERE ws.shoot_id = s.id
              AND ws.cancelled_at IS NULL
              AND ws.status IN ('draft', 'published', 'completed')
              AND ws.satisfies_lead_coverage = true
          ),
          0
        ) AS lead_coverage_count,
        COALESCE(
          (
            SELECT string_agg(au.full_name, ', ' ORDER BY au.full_name ASC)
            FROM work_shift ws
            JOIN app_user au ON au.id = ws.assigned_user_id
            WHERE ws.shoot_id = s.id
              AND ws.cancelled_at IS NULL
              AND ws.status IN ('draft', 'published', 'completed')
              AND ws.satisfies_lead_coverage = true
          ),
          ''
        ) AS lead_names,
        COALESCE(
          (
            SELECT COUNT(*)
            FROM work_shift ws
            WHERE ws.shoot_id = s.id
              AND ws.cancelled_at IS NULL
              AND ws.status IN ('draft', 'published', 'completed')
              AND EXISTS (
                SELECT 1
                FROM work_shift other
                WHERE other.assigned_user_id = ws.assigned_user_id
                  AND other.id <> ws.id
                  AND other.cancelled_at IS NULL
                  AND other.status IN ('draft', 'published', 'completed')
                  AND tstzrange(other.starts_at, other.ends_at, '[)') && tstzrange(ws.starts_at, ws.ends_at, '[)')
              )
          ),
          0
        ) AS conflict_warning_count
      FROM shoot s
      WHERE s.tenant_id = $1
        AND s.deleted_at IS NULL
        AND s.record_state = 'published'::shoot_record_state
        AND s.shoot_date BETWEEN $2::date AND $3::date
      ORDER BY s.shoot_date ASC, s.arrival_time ASC, s.start_time ASC, s.created_at ASC
    `,
    [auth.tenantId, startDate, endDate]
  );

  return rows.filter((row) => canManageShootDepartment(auth, row.department));
}

export async function getStaffingDashboardOverview(client: PoolClient, auth: AuthUser, anchorDate: string): Promise<StaffingDashboardResponse> {
  const anchor = parseDateOnly(anchorDate);
  const tomorrow = formatDateOnly(addDays(anchor, 1));
  const endDate = formatDateOnly(addDays(anchor, 2));
  const coverageRows = await listCoverageRows(client, auth, anchorDate, endDate);
  const members = await listScheduleMembers(client, auth, anchorDate);

  const mappedCoverage = coverageRows.map((row) => mapCoverageRow(row, auth));
  const openCoverage = mappedCoverage
    .filter((row) => row.missing_lead || row.under_staffed || row.conflict_warning_count > 0)
    .sort(compareCoverageRowPriority);
  const missingLead = mappedCoverage.filter((row) => row.missing_lead).sort(compareCoverageRowPriority);

  const availabilityOrder = [
    "available",
    "assigned_later",
    "on_shoot_now",
    "partially_available",
    "conflict",
    "pto",
    "unavailable",
    "overtime_watch"
  ];
  const groups = new Map<string, StaffingDashboardResponse["availability_groups"][number]["staff"]>();
  for (const member of members.filter((candidate) => candidate.field_staff_eligible)) {
    const key = member.availability_status || "unavailable";
    const current = groups.get(key) ?? [];
    current.push({
      user_id: member.id,
      name: member.full_name,
      title: displayMemberTitle(member),
      status: availabilityGroupLabel(key),
      current_assignment: member.current_assignment_title ?? null,
      time_window: member.current_assignment_window ?? null,
      quick_note: member.approved_pto_today
        ? (member.availability_note ?? "Blocked")
        : member.current_assignment_kind === "shift"
          ? "Already assigned"
          : member.current_assignment_kind === "event"
            ? "Calendar commitment"
            : Number(member.scheduled_hours_today ?? 0) >= 8
              ? "Watch overtime"
              : null,
      lead_qualified: Boolean(member.lead_qualified)
    });
    groups.set(key, current);
  }

  const availabilityGroups = availabilityOrder
    .map((key) => ({
      key,
      label: availabilityGroupLabel(key),
      count: (groups.get(key) ?? []).length,
      staff: (groups.get(key) ?? []).sort((left, right) => left.name.localeCompare(right.name))
    }))
    .filter((group) => group.count > 0);

  const availableStatuses = new Set(["available", "assigned_later", "partially_available", "overtime_watch"]);
  const unavailableStatuses = new Set(["conflict", "pto", "unavailable", "on_shoot_now"]);

  return {
    generated_at: new Date().toISOString(),
    anchor_date: anchorDate,
    summary: {
      shoots_today: mappedCoverage.filter((row) => row.shoot_date === anchorDate).length,
      shoots_tomorrow: mappedCoverage.filter((row) => row.shoot_date === tomorrow).length,
      open_staffing_slots: openCoverage.reduce(
        (sum, row) => sum + Math.max(row.planned_staff_count - row.assigned_staff_count, 0),
        0
      ),
      shoots_missing_lead: missingLead.length,
      understaffed_shoots: openCoverage.filter((row) => row.under_staffed).length,
      conflict_warnings: openCoverage.reduce((sum, row) => sum + row.conflict_warning_count, 0),
      available_staff_today: members.filter((member) => availableStatuses.has(member.availability_status)).length,
      unavailable_staff_today: members.filter((member) => unavailableStatuses.has(member.availability_status)).length
    },
    open_coverage: openCoverage,
    missing_lead: missingLead,
    availability_groups: availabilityGroups
  };
}

export async function listSchedulingUrgentWatchCandidates(
  client: PoolClient,
  tenantId: string,
  anchorDate: string
): Promise<UrgentWatchCandidate[]> {
  const startDate = anchorDate;
  const endDate = formatDateOnly(addDays(parseDateOnly(anchorDate), 30));
  const now = Date.now();
  const { rows } = await client.query<SchedulingWatchRow>(
    `
      SELECT
        s.id,
        s.shoot_code,
        s.title,
        s.shoot_date::text AS shoot_date,
        s.department,
        s.arrival_time::text AS arrival_time,
        s.start_time::text AS start_time,
        s.location_name,
        s.location_address,
        s.operations_priority,
        s.planned_staff_count,
        s.required_lead_count,
        s.primary_contact_id::text AS primary_contact_id,
        s.primary_contact_name,
        s.primary_contact_email,
        s.primary_contact_phone,
        COALESCE(
          (
            SELECT COUNT(*)
            FROM work_shift ws
            WHERE ws.tenant_id = s.tenant_id
              AND ws.shoot_id = s.id
              AND ws.status IN ('published', 'completed')
          ),
          0
        ) AS assigned_staff_count,
        COALESCE(
          (
            SELECT COUNT(*)
            FROM work_shift ws
            WHERE ws.tenant_id = s.tenant_id
              AND ws.shoot_id = s.id
              AND ws.status IN ('published', 'completed')
              AND COALESCE(ws.satisfies_lead_coverage, false)
          ),
          0
        ) AS lead_coverage_count,
        COALESCE(
          (
            SELECT COUNT(*)
            FROM work_shift ws
            WHERE ws.tenant_id = s.tenant_id
              AND ws.shoot_id = s.id
              AND ws.status = 'draft'
          ),
          0
        ) AS draft_shift_count,
        COALESCE(
          (
            SELECT COUNT(*)
            FROM work_shift ws
            WHERE ws.tenant_id = s.tenant_id
              AND ws.shoot_id = s.id
              AND EXISTS (
                SELECT 1
                FROM work_shift other_ws
                WHERE other_ws.tenant_id = ws.tenant_id
                  AND other_ws.assigned_user_id = ws.assigned_user_id
                  AND other_ws.id <> ws.id
                  AND tstzrange(other_ws.starts_at, COALESCE(other_ws.ends_at, other_ws.starts_at + interval '1 hour'), '[)') &&
                      tstzrange(ws.starts_at, COALESCE(ws.ends_at, ws.starts_at + interval '1 hour'), '[)')
                  AND other_ws.status IN ('draft', 'published')
              )
          ),
          0
        ) AS conflict_warning_count
      FROM shoot s
      WHERE s.tenant_id = $1
        AND s.deleted_at IS NULL
        AND s.record_state = 'published'::shoot_record_state
        AND s.status NOT IN ('SHOOT_COMPLETE', 'POST_PRODUCTION', 'COMPLETE', 'CANCELLED')
        AND s.shoot_date BETWEEN $2::date AND $3::date
      ORDER BY s.shoot_date ASC, s.arrival_time ASC, s.start_time ASC, s.created_at ASC
    `,
    [tenantId, startDate, endDate]
  );

  const candidates: UrgentWatchCandidate[] = [];
  for (const row of rows) {
    const plannedStaffCount = Math.max(Number(row.planned_staff_count ?? 0), 0);
    const assignedStaffCount = Math.max(Number(row.assigned_staff_count ?? 0), 0);
    const requiredLeadCount = Math.max(Number(row.required_lead_count ?? 0), 1);
    const leadCoverageCount = Math.max(Number(row.lead_coverage_count ?? 0), 0);
    const draftShiftCount = Math.max(Number(row.draft_shift_count ?? 0), 0);
    const conflictWarningCount = Math.max(Number(row.conflict_warning_count ?? 0), 0);
    const staffingGapCount = Math.max(plannedStaffCount - assignedStaffCount, 0);
    const missingLead = leadCoverageCount < requiredLeadCount;
    const missingContactInfo = !row.primary_contact_name && !row.primary_contact_email && !row.primary_contact_phone;
    const dueAt = buildSchedulingUrgentWatchDueAt(row.shoot_date, row.arrival_time, row.start_time);
    const dueMs = dueAt ? new Date(dueAt).getTime() : null;
    const severity = dueMs !== null && dueMs <= now + 24 * 60 * 60 * 1000 ? "red" : "yellow";
    const locationLabel = row.location_name ?? row.location_address ?? "Location pending";
    const priorityBonus = resolveSchedulingUrgentPriorityBonus(row.operations_priority);
    const actionHash = buildSchedulingUrgentWatchHash(row.id, row.shoot_date);

    if (staffingGapCount > 0) {
      candidates.push({
        source_module: "scheduling",
        source_entity_type: "shoot",
        source_entity_id: row.id,
        source_entity_label: row.shoot_code,
        scope_department: row.department ?? null,
        watch_type: "staffing_gap",
        severity,
        title: `${row.shoot_code} still needs ${staffingGapCount} staff`,
        summary: `${row.title} is below minimum staffing coverage for ${locationLabel}. ${assignedStaffCount}/${plannedStaffCount} assigned.`,
        owner_user_id: null,
        owner_label: null,
        due_at: dueAt,
        next_action_label: "Open Scheduling",
        action_hash: actionHash,
        operational_impact_score: 90 + priorityBonus + staffingGapCount * 12 + conflictWarningCount * 4,
        source_snapshot: {
          shoot_id: row.id,
          shoot_code: row.shoot_code,
          shoot_date: row.shoot_date,
          assigned_staff_count: assignedStaffCount,
          planned_staff_count: plannedStaffCount,
          required_lead_count: requiredLeadCount,
          lead_coverage_count: leadCoverageCount,
          draft_shift_count: draftShiftCount,
          conflict_warning_count: conflictWarningCount
        }
      });
    }

    if (missingLead) {
      candidates.push({
        source_module: "scheduling",
        source_entity_type: "shoot",
        source_entity_id: row.id,
        source_entity_label: row.shoot_code,
        scope_department: row.department ?? null,
        watch_type: "critical_role_gap",
        severity,
        title: `${row.shoot_code} is missing lead coverage`,
        summary: `${row.title} still needs lead-qualified coverage before it is safe to run at ${locationLabel}.`,
        owner_user_id: null,
        owner_label: null,
        due_at: dueAt,
        next_action_label: "Open Scheduling",
        action_hash: actionHash,
        operational_impact_score: 110 + priorityBonus + staffingGapCount * 8,
        source_snapshot: {
          shoot_id: row.id,
          shoot_code: row.shoot_code,
          shoot_date: row.shoot_date,
          required_lead_count: requiredLeadCount,
          lead_coverage_count: leadCoverageCount,
          assigned_staff_count: assignedStaffCount,
          planned_staff_count: plannedStaffCount
        }
      });
    }

    if (draftShiftCount > 0) {
      candidates.push({
        source_module: "scheduling",
        source_entity_type: "shoot",
        source_entity_id: row.id,
        source_entity_label: row.shoot_code,
        scope_department: row.department ?? null,
        watch_type: "unconfirmed_shoot",
        severity,
        title: `${row.shoot_code} still has unconfirmed labor`,
        summary: `${row.title} has ${draftShiftCount} draft shift${draftShiftCount === 1 ? "" : "s"} that are not confirmed for ${locationLabel}.`,
        owner_user_id: null,
        owner_label: null,
        due_at: dueAt,
        next_action_label: "Publish staffing",
        action_hash: actionHash,
        operational_impact_score: 75 + priorityBonus + draftShiftCount * 10,
        source_snapshot: {
          shoot_id: row.id,
          shoot_code: row.shoot_code,
          shoot_date: row.shoot_date,
          draft_shift_count: draftShiftCount,
          assigned_staff_count: assignedStaffCount,
          planned_staff_count: plannedStaffCount
        }
      });
    }

    if (missingContactInfo) {
      candidates.push({
        source_module: "scheduling",
        source_entity_type: "shoot",
        source_entity_id: row.id,
        source_entity_label: row.shoot_code,
        scope_department: row.department ?? null,
        watch_type: "missing_contact_info",
        severity,
        title: `${row.shoot_code} is missing day-of contact info`,
        summary: `${row.title} does not have a primary contact name, email, or phone on file for ${locationLabel}.`,
        owner_user_id: null,
        owner_label: null,
        due_at: dueAt,
        next_action_label: "Open Scheduling",
        action_hash: actionHash,
        operational_impact_score: 85 + priorityBonus,
        source_snapshot: {
          shoot_id: row.id,
          shoot_code: row.shoot_code,
          shoot_date: row.shoot_date,
          primary_contact_name: row.primary_contact_name,
          primary_contact_email: row.primary_contact_email,
          primary_contact_phone: row.primary_contact_phone
        }
      });
    }
  }

  return candidates;
}

function buildSchedulingUrgentWatchHash(shootId: string, shootDate: string) {
  const params = new URLSearchParams();
  params.set("area", "staffing");
  params.set("date", shootDate);
  params.set("shoot", shootId);
  return `#scheduling?${params.toString()}`;
}

function buildSchedulingUrgentWatchDueAt(shootDate: string, arrivalTime: string | null, startTime: string | null) {
  const rawValue = arrivalTime ?? startTime;
  if (rawValue) {
    return new Date(rawValue).toISOString();
  }
  return new Date(`${shootDate}T12:00:00`).toISOString();
}

function resolveSchedulingUrgentPriorityBonus(priority: string | null) {
  switch (priority) {
    case "critical_shoot":
      return 40;
    case "big_shoot":
      return 25;
    case "elevated":
      return 12;
    default:
      return 0;
  }
}
