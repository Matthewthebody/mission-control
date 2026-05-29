import type { PoolClient } from "pg";
import { canCreateOrEditCalendarDepartment, hasAuthorityTier } from "../authz/authority.js";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser, DepartmentCode } from "../types/auth.js";
import { createAuditLog } from "./audit.js";
import { beginDangerousAction, completeDangerousAction, failDangerousAction } from "./dangerousActions.js";
import { listScheduleAvailabilityItems } from "./availabilityRequests.js";
import { buildGoogleMapsLink } from "./maps.js";
import { createAppEvent } from "./outbox.js";
import { queueWorkShiftOutlookSync } from "./outlookCalendarSync.js";
import { getScheduleSyncWriteState, queueScheduleSync } from "./scheduleSync.js";
import { shouldDepartmentScopeShiftList, shouldRestrictShiftList } from "./shiftAccess.js";
import { reconcileSubmittedPTOConflictsForUser } from "./scheduling.js";
import { previewOutlookEvents } from "./outlook.js";
import { getPublicObjectNoteSignals } from "./operationalNotes.js";
import { loadOutlookTenantState, resolveOutlookAccount } from "./outlookStore.js";
import {
  evaluateShootPriority,
  humanizePriorityLabel,
  humanizeProfitabilityFlag,
  isBigShootLabel
} from "./shootPriority.js";
import { canViewStrategicShootSignals } from "../authz/authority.js";

export type ScheduleWindow = "today" | "3day" | "week" | "30day";
export type ScheduleBoardGroupBy = "status" | "department" | "lead_photographer" | "day_part";

export type UnifiedScheduleFilters = {
  anchorDate: string;
  window: ScheduleWindow;
  department?: string;
  leadUserId?: string;
  employeeId?: string;
  locationQuery?: string;
  status?: string;
};

/**
 * Standalone schedule event input for admin/operations calendar items.
 *
 * This is not the canonical operational Event record for the Job -> Event -> StaffAssignment -> Task spine.
 * Job-backed operational events should continue to originate from the job-truth layer and render into schedule
 * views as projections.
 */
export type ScheduleEventInput = {
  studio_id?: string | null;
  department: DepartmentCode;
  event_kind: "meeting" | "operations" | "travel" | "other";
  status?: "scheduled" | "tentative" | "cancelled" | "completed";
  title: string;
  starts_at: string;
  ends_at: string;
  location_name?: string | null;
  location_address?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  lead_user_id?: string | null;
  notes?: string | null;
  linked_shoot_id?: string | null;
};

export type StaffingTemplateInput = {
  department: DepartmentCode;
  name: string;
  description?: string | null;
  planned_staff_count: number;
  minimum_staff_count?: number;
  required_lead_count: number;
  roles: Array<{
    staffing_role: "lead_photographer" | "senior_photographer" | "photographer" | "support" | "check_in" | "assistant" | "producer" | "custom";
    label: string;
    headcount: number;
    satisfies_lead_coverage?: boolean;
    minimum_count?: number;
    ideal_count?: number;
    required_for_ready?: boolean;
    lead_eligible?: boolean;
    lead_required?: boolean;
    call_offset_minutes?: number;
    start_offset_minutes?: number;
    end_offset_minutes?: number;
    location_name_override?: string | null;
    location_address_override?: string | null;
    required_qualification_tags?: string[];
    role_notes?: string | null;
  }>;
};

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type ScheduleWindowRange = {
  startDate: string;
  endDate: string;
  start: Date;
  endExclusive: Date;
};

// `shoot` and `event` are schedule-facing projection targets. They do not replace the canonical job/event model.
type ScheduleItemKind = "shoot" | "event";

type ScheduleIntegrationState = {
  provider: "outlook";
  link_state: "linked" | "not_linked";
  sync_state: "not_linked" | "pending_sync" | "in_sync" | "sync_warning" | "sync_error";
  sync_required: boolean;
  sync_health: "neutral" | "pending" | "healthy" | "warning" | "error";
  last_synced_at: string | null;
  last_sync_direction: "none" | "inbound" | "outbound";
  last_sync_error: string | null;
  manual_review_required: boolean;
  review_reason: string | null;
  changed_fields: string[];
  changed_field_labels: string[];
  external_last_modified_at: string | null;
  external_record_id: string | null;
  external_calendar_id: string | null;
  source_system: string | null;
  source_of_truth: string;
  pending_external_changes: boolean;
  stale_data_warning: boolean;
  recommended_next_action: string | null;
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

function getScheduleWindowRange(anchorDate: string, window: ScheduleWindow): ScheduleWindowRange {
  const anchor = parseDateOnly(anchorDate);
  let startDate = anchorDate;
  let endDate = anchorDate;

  if (window === "3day") {
    endDate = formatDateOnly(addDays(anchor, 2));
  } else if (window === "week") {
    const weekday = anchor.getDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    const monday = addDays(anchor, mondayOffset);
    startDate = formatDateOnly(monday);
    endDate = formatDateOnly(addDays(monday, 6));
  } else if (window === "30day") {
    const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12, 0, 0, 0);
    const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 12, 0, 0, 0);
    startDate = formatDateOnly(monthStart);
    endDate = formatDateOnly(monthEnd);
  }

  const start = new Date(`${startDate}T00:00:00`);
  const endExclusive = new Date(`${endDate}T00:00:00`);
  endExclusive.setDate(endExclusive.getDate() + 1);

  return {
    startDate,
    endDate,
    start,
    endExclusive
  };
}

function getDayPart(value?: string | null) {
  if (!value) {
    return "Unscheduled";
  }
  const hour = new Date(value).getHours();
  if (hour < 11) {
    return "Morning";
  }
  if (hour < 16) {
    return "Afternoon";
  }
  return "Evening";
}

function scaleLabel(projectedStudents: number, plannedStaffCount: number) {
  if (plannedStaffCount <= 1 || projectedStudents <= 24) {
    return "1-camera";
  }
  if (plannedStaffCount >= 4 || projectedStudents >= 120) {
    return "Large volume";
  }
  return "Multi-camera";
}

function buildShootMissingFields(shoot: Record<string, unknown>) {
  const missing: string[] = [];
  if (!shoot.arrival_time) {
    missing.push("arrival time");
  }
  if (!shoot.start_time) {
    missing.push("shoot time");
  }
  if (!shoot.location_name && !shoot.location_address) {
    missing.push("location");
  }
  if (!Number(shoot.planned_staff_count ?? 0)) {
    missing.push("staffing plan");
  }
  if (!Number(shoot.estimated_drive_minutes ?? 0)) {
    missing.push("drive time");
  }
  return missing;
}

function buildShootPrioritySignals(row: Record<string, unknown>, auth: AuthUser) {
  const assignedStaffCount = Math.max(
    Number(row.assigned_staff_count ?? 0),
    Number(row.scheduled_employee_count ?? 0),
    Number(row.scheduled_staff_count ?? 0)
  );
  const plannedStaffCount = Number(row.planned_staff_count ?? 0);
  const priority = evaluateShootPriority({
    projectedHeadcount: Number(row.projected_students ?? 0),
    photographerHeadcount: Number(row.template_photographer_count ?? 0),
    assignedStaffCount,
    plannedStaffCount,
    estimatedDriveMinutes: row.estimated_drive_minutes == null ? null : Number(row.estimated_drive_minutes),
    cameraStationCount:
      row.camera_station_count == null ? Math.max(Number(row.template_photographer_count ?? 0), 1) : Number(row.camera_station_count),
    shootStructure: (row.shoot_structure as "standard" | "open_house" | null | undefined) ?? "standard",
    hasSpecialtyRequirements:
      Boolean(row.additional_products_flag) ||
      Boolean(row.special_equipment_flag) ||
      Boolean(row.additional_products) ||
      Boolean(row.special_equipment) ||
      Boolean(row.multi_team_coordination),
    firstYearCustomerFlag: Boolean(row.first_year_customer_flag),
    flagshipPriorityAccountFlag: Boolean(row.flagship_priority_account_flag),
    strategicDistrictImportance: Boolean(row.strategic_district_importance),
    revenuePotentialScore: row.revenue_potential_score == null ? null : Number(row.revenue_potential_score),
    accountGrowthImportanceScore:
      row.account_growth_importance_score == null ? null : Number(row.account_growth_importance_score),
    complexityScore: row.complexity_score == null ? null : Number(row.complexity_score),
    customerHistoryRiskScore:
      row.customer_history_risk_score == null ? null : Number(row.customer_history_risk_score),
    priorMajorIssueExists: Boolean(row.prior_major_issue_exists),
    multiTeamCoordination: Boolean(row.multi_team_coordination),
    missingStaffingCoverageCount: Math.max(plannedStaffCount - assignedStaffCount, 0),
    missingRequiredPrepCount: [
      !row.arrival_time,
      !row.start_time,
      !row.end_time_est,
      !(row.location_name || row.location_address),
      !(row.primary_contact_name || row.primary_contact_id),
      (Boolean(row.additional_products_flag) || Boolean(row.special_equipment_flag)) && !(row.setup_notes || row.day_of_notes)
    ].filter(Boolean).length,
    weatherTravelRiskFlag: Boolean(row.weather_travel_risk_flag),
    manualLeadershipBoost: row.manual_leadership_boost == null ? null : Number(row.manual_leadership_boost),
    futureProfitabilityManual: (row.future_profitability_manual as any) ?? null,
    operationsPriority: (row.operations_priority as any) ?? null,
    manualBigShootOverride: Boolean(row.big_shoot_manual_override),
    importanceOverrideTier: (row.importance_override_tier as any) ?? null,
    importanceOverrideReason: typeof row.importance_override_reason === "string" ? row.importance_override_reason : null
  });

  return {
    priority_label: priority.priorityLabel,
    priority_label_display: humanizePriorityLabel(priority.priorityLabel),
    priority_weighted_score: priority.weightedScore,
    priority_reasons: priority.reasons.map((reason) => ({
      key: reason.key,
      label: reason.label,
      detail: reason.detail
    })),
    big_shoot: isBigShootLabel(priority.priorityLabel),
    ...(canViewStrategicShootSignals(auth)
      ? {
          future_profitability_flag: priority.profitability.finalFlag,
          future_profitability_display: humanizeProfitabilityFlag(priority.profitability.finalFlag),
          future_profitability_system_flag: priority.profitability.systemFlag,
          future_profitability_explanation: priority.profitability.explanation
        }
      : {
          future_profitability_flag: null,
          future_profitability_display: null,
          future_profitability_system_flag: null,
          future_profitability_explanation: null
        })
  };
}

async function getOutlookScheduleSummary(client: PoolClient, tenantId: string) {
  const tenantState = await loadOutlookTenantState(client, tenantId);
  const account = resolveOutlookAccount(tenantId, tenantState);
  const pending = await client.query(
    `
      SELECT
        (
          SELECT COUNT(*)
          FROM shoot
          WHERE tenant_id = $1
            AND schedule_sync_required = true
            AND deleted_at IS NULL
        ) +
        (
          SELECT COUNT(*)
          FROM schedule_event
          WHERE tenant_id = $1
            AND sync_required = true
            AND deleted_at IS NULL
        ) AS pending_count
    `,
    [tenantId]
  );

  return {
    source_of_truth: "mission_control",
    outlook_connected: account.connection_status === "connected",
    outlook_health_state: account.health_state,
    last_sync_at: account.last_sync_at ?? null,
    last_failed_sync_at: account.last_failed_sync_at ?? null,
    pending_sync_count: config.OUTLOOK_APP_PERMISSION_FEATURES_ENABLED ? Number(pending.rows[0]?.pending_count ?? 0) : 0
  };
}

const OUTLOOK_CHANGED_FIELD_LABELS: Record<string, string> = {
  title: "Title changed in Outlook",
  subject: "Title changed in Outlook",
  starts_at: "Time changed in Outlook",
  ends_at: "Time changed in Outlook",
  timezone: "Timezone changed in Outlook",
  location: "Location changed in Outlook",
  location_name: "Location changed in Outlook",
  organizer: "Organizer changed in Outlook",
  attendees: "Attendees changed in Outlook",
  recurrence: "Recurrence changed in Outlook",
  recurrence_master_id: "Recurrence changed in Outlook",
  recurrence_occurrence_id: "Recurrence changed in Outlook",
  cancellation: "Cancellation changed in Outlook",
  cancellation_state: "Cancellation changed in Outlook",
  all_day: "All-day status changed in Outlook",
  body_preview: "Description changed in Outlook"
};

function normalizeChangedFields(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map((item) => String(item)).filter(Boolean);
  }
  return [];
}

function humanizeIntegrationField(field: string) {
  return OUTLOOK_CHANGED_FIELD_LABELS[field] ?? field.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function mapSyncHealth(syncState: ScheduleIntegrationState["sync_state"]) {
  if (syncState === "pending_sync") {
    return "pending";
  }
  if (syncState === "in_sync") {
    return "healthy";
  }
  if (syncState === "sync_warning") {
    return "warning";
  }
  if (syncState === "sync_error") {
    return "error";
  }
  return "neutral";
}

function buildScheduleIntegrationState(input: {
  linked: boolean;
  syncState?: string | null;
  syncRequired?: boolean;
  lastSyncedAt?: unknown;
  lastSyncDirection?: unknown;
  lastSyncError?: unknown;
  reviewRequired?: unknown;
  reviewReason?: unknown;
  changedFields?: unknown;
  externalLastModifiedAt?: unknown;
  externalRecordId?: unknown;
  externalCalendarId?: unknown;
  sourceSystem?: unknown;
}): ScheduleIntegrationState {
  const syncState = (input.syncState as ScheduleIntegrationState["sync_state"] | null | undefined) ?? "not_linked";
  const changedFields = normalizeChangedFields(input.changedFields);
  const manualReviewRequired = Boolean(input.reviewRequired) || syncState === "sync_warning";
  const linkState = input.linked ? "linked" : "not_linked";
  const sourceSystem = input.sourceSystem ? String(input.sourceSystem) : null;
  return {
    provider: "outlook",
    link_state: linkState,
    sync_state: syncState,
    sync_required: Boolean(input.syncRequired),
    sync_health: mapSyncHealth(syncState),
    last_synced_at: input.lastSyncedAt ? String(input.lastSyncedAt) : null,
    last_sync_direction:
      input.lastSyncDirection === "inbound" || input.lastSyncDirection === "outbound"
        ? input.lastSyncDirection
        : "none",
    last_sync_error: input.lastSyncError ? String(input.lastSyncError) : null,
    manual_review_required: manualReviewRequired,
    review_reason: input.reviewReason ? String(input.reviewReason) : null,
    changed_fields: changedFields,
    changed_field_labels: changedFields.map(humanizeIntegrationField),
    external_last_modified_at: input.externalLastModifiedAt ? String(input.externalLastModifiedAt) : null,
    external_record_id: input.externalRecordId ? String(input.externalRecordId) : null,
    external_calendar_id: input.externalCalendarId ? String(input.externalCalendarId) : null,
    source_system: sourceSystem,
    source_of_truth:
      linkState === "linked"
        ? "Outlook owns calendar timing and attendee context. Mission Control keeps staffing, readiness, notes, and internal operations."
        : "Mission Control owns this record until a leader explicitly links or pushes it to Outlook.",
    pending_external_changes: manualReviewRequired || changedFields.length > 0,
    stale_data_warning: manualReviewRequired || Boolean(input.lastSyncError),
    recommended_next_action: manualReviewRequired
      ? "Review the Outlook diff and decide whether Mission Control should be updated internally or explicitly pushed back out."
      : syncState === "pending_sync"
        ? "Push changes to Outlook when you are ready."
        : input.lastSyncError
          ? "Retry the sync or resync the linked Outlook event."
          : null
  };
}

function pushValue(values: unknown[], value: unknown) {
  values.push(value);
  return `$${values.length}`;
}

function buildShootScopeSql(auth: AuthUser, values: unknown[], alias: string) {
  const where: string[] = [];
  if (shouldRestrictShiftList(auth)) {
    const userPlaceholder = pushValue(values, auth.id);
    where.push(
      `EXISTS (
        SELECT 1
        FROM work_shift scoped_ws
        WHERE scoped_ws.tenant_id = ${alias}.tenant_id
          AND scoped_ws.shoot_id = ${alias}.id
          AND scoped_ws.assigned_user_id = ${userPlaceholder}
          AND scoped_ws.status = 'published'
          AND scoped_ws.cancelled_at IS NULL
      )`
    );
  } else if (shouldDepartmentScopeShiftList(auth)) {
    const departmentPlaceholder = pushValue(values, auth.department);
    where.push(`${alias}.department = ${departmentPlaceholder}::department_code`);
  }
  return where;
}

function buildEventScopeSql(auth: AuthUser, values: unknown[], alias: string) {
  const where: string[] = [];
  if (shouldRestrictShiftList(auth)) {
    const userPlaceholder = pushValue(values, auth.id);
    where.push(
      `(
        ${alias}.lead_user_id = ${userPlaceholder}
        OR EXISTS (
          SELECT 1
          FROM work_shift scoped_ws
          WHERE scoped_ws.tenant_id = ${alias}.tenant_id
            AND scoped_ws.shoot_id = ${alias}.linked_shoot_id
            AND scoped_ws.assigned_user_id = ${userPlaceholder}
            AND scoped_ws.status = 'published'
            AND scoped_ws.cancelled_at IS NULL
        )
      )`
    );
  } else if (shouldDepartmentScopeShiftList(auth)) {
    const departmentPlaceholder = pushValue(values, auth.department);
    where.push(`${alias}.department = ${departmentPlaceholder}::department_code`);
  }
  return where;
}

function applySharedFilters(
  filters: UnifiedScheduleFilters,
  values: unknown[],
  options: { alias: string; isEvent: boolean }
) {
  const where: string[] = [];
  if (filters.department) {
    const placeholder = pushValue(values, filters.department);
    where.push(`${options.alias}.department = ${placeholder}::department_code`);
  }
  if (filters.locationQuery) {
    const placeholder = pushValue(values, `%${filters.locationQuery.trim()}%`);
    where.push(`(${options.alias}.location_name ILIKE ${placeholder} OR ${options.alias}.location_address ILIKE ${placeholder})`);
  }
  if (filters.status) {
    const placeholder = pushValue(values, filters.status.toLowerCase());
    where.push(`LOWER(${options.alias}.status::text) = ${placeholder}`);
  }
  if (filters.employeeId) {
    const placeholder = pushValue(values, filters.employeeId);
    if (options.isEvent) {
      where.push(
        `(
          ${options.alias}.lead_user_id = ${placeholder}
          OR EXISTS (
            SELECT 1
            FROM work_shift ws
            WHERE ws.shoot_id = ${options.alias}.linked_shoot_id
              AND ws.assigned_user_id = ${placeholder}
              AND ws.cancelled_at IS NULL
          )
        )`
      );
    } else {
      where.push(
        `EXISTS (
          SELECT 1
          FROM work_shift ws
          WHERE ws.shoot_id = ${options.alias}.id
            AND ws.assigned_user_id = ${placeholder}
            AND ws.cancelled_at IS NULL
        )`
      );
    }
  }
  if (filters.leadUserId) {
    const placeholder = pushValue(values, filters.leadUserId);
    if (options.isEvent) {
      where.push(`${options.alias}.lead_user_id = ${placeholder}`);
    } else {
      where.push(
        `EXISTS (
          SELECT 1
          FROM work_shift ws
          WHERE ws.shoot_id = ${options.alias}.id
            AND ws.assigned_user_id = ${placeholder}
            AND ws.satisfies_lead_coverage = true
            AND ws.cancelled_at IS NULL
        )`
      );
    }
  }
  return where;
}

async function listScheduleShootRows(client: PoolClient, auth: AuthUser, filters: UnifiedScheduleFilters, range: ScheduleWindowRange) {
  const fullStaffingDetailVisibility = !shouldRestrictShiftList(auth);
  const values: unknown[] = [range.startDate, range.endDate];
  const where: string[] = ["s.deleted_at IS NULL", "s.shoot_date BETWEEN $1::date AND $2::date"];
  where.push(...buildShootScopeSql(auth, values, "s"));
  where.push(...applySharedFilters(filters, values, { alias: "s", isEvent: false }));

  const { rows } = await client.query(
    `
      WITH target_shoots AS (
        SELECT s.*
        FROM shoot s
        WHERE ${where.join(" AND ")}
      ),
      target_templates AS (
        SELECT DISTINCT staffing_template_id
        FROM target_shoots
        WHERE staffing_template_id IS NOT NULL
      ),
      template_staffing AS (
        SELECT
          str.staffing_template_id,
          SUM(str.headcount)::int AS template_photographer_count
        FROM staffing_template_role str
        JOIN target_templates template
          ON template.staffing_template_id = str.staffing_template_id
        WHERE str.staffing_role IN ('lead_photographer', 'senior_photographer', 'photographer')
        GROUP BY str.staffing_template_id
      ),
      prior_major_issues AS (
        SELECT sl.shoot_id, true AS prior_major_issue_exists
        FROM target_shoots shoot
        JOIN shoot_location_link sl
          ON sl.tenant_id = shoot.tenant_id
         AND sl.shoot_id = shoot.id
        JOIN post_shoot_evaluation pse
          ON pse.location_id = sl.location_id
         AND pse.tenant_id = sl.tenant_id
        WHERE
          pse.overall_rating <= 2
          OR pse.on_time = 'No'
          OR pse.easy_access = 'No'
          OR COALESCE(NULLIF(trim(pse.late_details), ''), NULLIF(trim(pse.access_details), ''), NULLIF(trim(pse.notes), '')) IS NOT NULL
        GROUP BY sl.shoot_id
      ),
      shift_metrics AS (
        SELECT
          ws.shoot_id,
          COUNT(DISTINCT ws.assigned_user_id)::int AS assigned_staff_count,
          COUNT(*) FILTER (WHERE ws.satisfies_lead_coverage = true)::int AS lead_coverage_count,
          COALESCE(
            string_agg(au.full_name, ', ' ORDER BY au.full_name ASC) FILTER (WHERE ws.satisfies_lead_coverage = true),
            ''
          ) AS lead_names,
          COUNT(*) FILTER (WHERE ws.status = 'draft')::int AS draft_shift_count,
          COUNT(*) FILTER (WHERE ws.status IN ('published', 'completed'))::int AS published_shift_count
        FROM work_shift ws
        JOIN target_shoots shoot
          ON shoot.id = ws.shoot_id
        LEFT JOIN app_user au
          ON au.id = ws.assigned_user_id
        WHERE ws.cancelled_at IS NULL
          AND ws.status IN ('draft', 'published', 'completed')
        GROUP BY ws.shoot_id
      ),
      shift_conflicts AS (
        SELECT
          ws.shoot_id,
          COUNT(*)::int AS conflict_warning_count
        FROM work_shift ws
        JOIN target_shoots shoot
          ON shoot.id = ws.shoot_id
        WHERE ws.cancelled_at IS NULL
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
        GROUP BY ws.shoot_id
      ),
      attendance_open_counts AS (
        SELECT
          ae.shoot_id,
          COUNT(*)::int AS open_attendance_exception_count
        FROM attendance_exception ae
        JOIN target_shoots shoot
          ON shoot.id = ae.shoot_id
        WHERE ae.status = 'open'
        GROUP BY ae.shoot_id
      ),
      alert_open_counts AS (
        SELECT
          a.shoot_id,
          COUNT(*)::int AS open_alert_count
        FROM alert a
        JOIN target_shoots shoot
          ON shoot.id = a.shoot_id
        WHERE a.status = 'open'
        GROUP BY a.shoot_id
      ),
      schedule_event_base AS (
        SELECT ev.*
        FROM schedule_event ev
        JOIN target_shoots shoot
          ON shoot.id = ev.linked_shoot_id
        WHERE ev.deleted_at IS NULL
      ),
      schedule_event_metrics AS (
        SELECT
          ev.linked_shoot_id AS shoot_id,
          COUNT(*) FILTER (WHERE ev.outlook_event_id IS NOT NULL)::int AS linked_outlook_event_count,
          COALESCE(bool_or(ev.sync_review_required), false) AS linked_sync_review_required,
          string_agg(DISTINCT ev.sync_review_reason, '; ') FILTER (WHERE ev.sync_review_reason IS NOT NULL) AS linked_sync_review_reason,
          MAX(ev.last_synced_at) AS linked_last_synced_at,
          MAX(ev.external_last_modified_at) AS linked_external_last_modified_at,
          (array_agg(ev.last_sync_direction ORDER BY COALESCE(ev.external_last_modified_at, ev.last_synced_at, ev.updated_at) DESC NULLS LAST)
            FILTER (WHERE ev.last_sync_direction IS NOT NULL))[1] AS linked_last_sync_direction,
          (array_agg(ev.last_sync_error ORDER BY ev.updated_at DESC NULLS LAST)
            FILTER (WHERE ev.last_sync_error IS NOT NULL))[1] AS linked_last_sync_error,
          (array_agg(ev.outlook_event_id ORDER BY ev.starts_at ASC NULLS LAST)
            FILTER (WHERE ev.outlook_event_id IS NOT NULL))[1] AS linked_outlook_event_id,
          (array_agg(ev.outlook_calendar_id ORDER BY ev.starts_at ASC NULLS LAST)
            FILTER (WHERE ev.outlook_calendar_id IS NOT NULL))[1] AS linked_outlook_calendar_id,
          (array_agg(ev.source_system ORDER BY ev.starts_at ASC NULLS LAST))[1] AS linked_source_system
        FROM schedule_event_base ev
        GROUP BY ev.linked_shoot_id
      ),
      schedule_event_changed_fields AS (
        SELECT
          ev.linked_shoot_id AS shoot_id,
          COALESCE(json_agg(DISTINCT field_value ORDER BY field_value), '[]'::json) AS linked_changed_fields
        FROM schedule_event_base ev
        CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(ev.external_changed_fields, '[]'::jsonb)) AS field_value
        GROUP BY ev.linked_shoot_id
      )
      SELECT
        s.*,
        COALESCE(template_staffing.template_photographer_count, 0) AS template_photographer_count,
        COALESCE(prior_major_issues.prior_major_issue_exists, false) AS prior_major_issue_exists,
        COALESCE(shift_metrics.assigned_staff_count, 0) AS assigned_staff_count,
        COALESCE(shift_metrics.lead_coverage_count, 0) AS lead_coverage_count,
        COALESCE(shift_metrics.lead_names, '') AS lead_names,
        COALESCE(attendance_open_counts.open_attendance_exception_count, 0) AS open_attendance_exception_count,
        COALESCE(alert_open_counts.open_alert_count, 0) AS open_alert_count,
        COALESCE(shift_metrics.draft_shift_count, 0) AS draft_shift_count,
        COALESCE(shift_metrics.published_shift_count, 0) AS published_shift_count,
        COALESCE(shift_conflicts.conflict_warning_count, 0) AS conflict_warning_count,
        COALESCE(schedule_event_metrics.linked_outlook_event_count, 0) AS linked_outlook_event_count,
        COALESCE(schedule_event_metrics.linked_sync_review_required, false) AS linked_sync_review_required,
        schedule_event_metrics.linked_sync_review_reason,
        COALESCE(schedule_event_changed_fields.linked_changed_fields, '[]'::json) AS linked_changed_fields,
        schedule_event_metrics.linked_last_synced_at,
        schedule_event_metrics.linked_external_last_modified_at,
        schedule_event_metrics.linked_last_sync_direction,
        schedule_event_metrics.linked_last_sync_error,
        schedule_event_metrics.linked_outlook_event_id,
        schedule_event_metrics.linked_outlook_calendar_id,
        schedule_event_metrics.linked_source_system
      FROM target_shoots s
      LEFT JOIN template_staffing
        ON template_staffing.staffing_template_id = s.staffing_template_id
      LEFT JOIN prior_major_issues
        ON prior_major_issues.shoot_id = s.id
      LEFT JOIN shift_metrics
        ON shift_metrics.shoot_id = s.id
      LEFT JOIN shift_conflicts
        ON shift_conflicts.shoot_id = s.id
      LEFT JOIN attendance_open_counts
        ON attendance_open_counts.shoot_id = s.id
      LEFT JOIN alert_open_counts
        ON alert_open_counts.shoot_id = s.id
      LEFT JOIN schedule_event_metrics
        ON schedule_event_metrics.shoot_id = s.id
      LEFT JOIN schedule_event_changed_fields
        ON schedule_event_changed_fields.shoot_id = s.id
      ORDER BY s.shoot_date ASC, s.arrival_time ASC, s.start_time ASC
    `,
    values
  );

  const noteSignals = await getPublicObjectNoteSignals(
    client,
    auth.tenantId,
    "shoot",
    rows.map((row) => String(row.id))
  );

  return rows.map((row) => {
    const plannedStaffCount = Number(row.planned_staff_count ?? 0);
    const assignedStaffCount = Number(row.assigned_staff_count ?? 0);
    const requiredLeadCount = Number(row.required_lead_count ?? 1);
    const leadCoverageCount = Number(row.lead_coverage_count ?? 0);
    const conflictWarningCount = Number(row.conflict_warning_count ?? 0);
    const draftShiftCount = Number(row.draft_shift_count ?? 0);
    const publishedShiftCount = Number(row.published_shift_count ?? 0);
    const noteSignal = noteSignals.get(String(row.id));
    const underStaffed = plannedStaffCount > assignedStaffCount;
    const overStaffed = plannedStaffCount > 0 && assignedStaffCount > plannedStaffCount;
    const missingLead = leadCoverageCount < requiredLeadCount;
    const missingFields = buildShootMissingFields(row);
    const staffingGapCount = Math.max(plannedStaffCount - assignedStaffCount, 0);
    const unconfirmedStaffCount = draftShiftCount;
    const staffingHealthState = missingLead || underStaffed
      ? "coverage_gap"
      : conflictWarningCount > 0
        ? "conflict"
        : unconfirmedStaffCount > 0
          ? "unconfirmed_labor"
          : overStaffed
            ? "overstaffed"
            : "healthy";
    const staffingHealthLabel =
      staffingHealthState === "coverage_gap"
        ? "Coverage Gap"
        : staffingHealthState === "conflict"
          ? "Conflict"
          : staffingHealthState === "unconfirmed_labor"
            ? "Unconfirmed Labor"
            : staffingHealthState === "overstaffed"
              ? "Overstaffed"
              : "Healthy";
    return {
      item_kind: "shoot",
      id: row.id,
      shoot_id: row.id,
      date_key: String(row.shoot_date).slice(0, 10),
      title: row.title,
      shoot_code: row.shoot_code,
      department: row.department,
      shoot_category: row.shoot_category ?? null,
      status: row.status,
      starts_at: row.arrival_time ?? row.start_time,
      ends_at: row.end_time_est,
      showtime: row.showtime,
      arrival_time: row.arrival_time,
      start_time: row.start_time,
      end_time_est: row.end_time_est,
      location_name: row.location_name,
      location_address: row.location_address,
      navigation_url: row.navigation_url,
      estimated_drive_minutes: row.estimated_drive_minutes,
      projected_students: row.projected_students,
      planned_staff_count: fullStaffingDetailVisibility ? plannedStaffCount : null,
      assigned_staff_count: fullStaffingDetailVisibility ? assignedStaffCount : null,
      required_lead_count: fullStaffingDetailVisibility ? requiredLeadCount : null,
      lead_coverage_count: fullStaffingDetailVisibility ? leadCoverageCount : null,
      lead_name: fullStaffingDetailVisibility ? row.lead_names || null : null,
      operations_priority: row.operations_priority ?? "standard",
      big_shoot_manual_override: Boolean(row.big_shoot_manual_override),
      special_equipment: row.special_equipment ?? null,
      missing_fields: missingFields,
      open_alert_count: fullStaffingDetailVisibility ? Number(row.open_alert_count ?? 0) : null,
      open_attendance_exception_count: fullStaffingDetailVisibility ? Number(row.open_attendance_exception_count ?? 0) : null,
      note_count: noteSignal?.note_count ?? 0,
      pinned_note_count: noteSignal?.pinned_note_count ?? 0,
      post_shoot_follow_up_count: noteSignal?.post_shoot_follow_up_count ?? 0,
      latest_note_preview: noteSignal?.latest_note_preview ?? null,
      schedule_sync_state: row.schedule_sync_state,
      schedule_sync_required: Boolean(row.schedule_sync_required),
      integration: buildScheduleIntegrationState({
        linked: Number(row.linked_outlook_event_count ?? 0) > 0,
        syncState: row.schedule_sync_state,
        syncRequired: Boolean(row.schedule_sync_required),
        lastSyncedAt: row.linked_last_synced_at ?? row.schedule_last_synced_at ?? null,
        lastSyncDirection: row.linked_last_sync_direction ?? null,
        lastSyncError: row.linked_last_sync_error ?? row.schedule_last_error ?? null,
        reviewRequired: row.linked_sync_review_required,
        reviewReason: row.linked_sync_review_reason ?? row.schedule_last_error ?? null,
        changedFields: row.linked_changed_fields,
        externalLastModifiedAt: row.linked_external_last_modified_at ?? null,
        externalRecordId: row.linked_outlook_event_id ?? null,
        externalCalendarId: row.linked_outlook_calendar_id ?? null,
        sourceSystem: row.linked_source_system ?? "mission_control"
      }),
      staffing_state: missingLead ? "missing_lead" : underStaffed ? "understaffed" : overStaffed ? "overstaffed" : conflictWarningCount ? "staffing_conflict" : "staffed",
      staffing_health_state: fullStaffingDetailVisibility ? staffingHealthState : "personal_view",
      staffing_health_label: fullStaffingDetailVisibility ? staffingHealthLabel : "Assignment View",
      staffing_detail_visibility: fullStaffingDetailVisibility ? "full" : "limited",
      staffing_gap_count: fullStaffingDetailVisibility ? staffingGapCount : null,
      unconfirmed_staff_count: fullStaffingDetailVisibility ? unconfirmedStaffCount : null,
      scale_label: scaleLabel(Number(row.projected_students ?? 0), Math.max(plannedStaffCount, assignedStaffCount)),
      board_day_part: getDayPart(row.start_time ?? row.arrival_time),
      under_staffed: underStaffed,
      missing_lead: missingLead,
      over_staffed: overStaffed,
      conflict_warning_count: fullStaffingDetailVisibility ? conflictWarningCount : null,
      draft_shift_count: fullStaffingDetailVisibility ? draftShiftCount : null,
      published_shift_count: fullStaffingDetailVisibility ? publishedShiftCount : null,
      ...buildShootPrioritySignals(row, auth),
      publish_state: fullStaffingDetailVisibility
        ? assignedStaffCount > 0 && draftShiftCount === 0 && !underStaffed && !missingLead
          ? "published"
          : assignedStaffCount > 0 && !underStaffed && !missingLead
            ? "ready_to_publish"
            : "draft"
        : null
    };
  });
}

async function listScheduleEventRows(client: PoolClient, auth: AuthUser, filters: UnifiedScheduleFilters, range: ScheduleWindowRange) {
  const values: unknown[] = [range.start.toISOString(), range.endExclusive.toISOString()];
  const where: string[] = ["ev.deleted_at IS NULL", "ev.ends_at >= $1::timestamptz", "ev.starts_at < $2::timestamptz"];
  where.push(...buildEventScopeSql(auth, values, "ev"));
  where.push(...applySharedFilters(filters, values, { alias: "ev", isEvent: true }));

  const { rows } = await client.query(
    `
      SELECT
        ev.*,
        lead.full_name AS lead_name
      FROM schedule_event ev
      LEFT JOIN app_user lead ON lead.id = ev.lead_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY ev.starts_at ASC, ev.created_at ASC
    `,
    values
  );

  return rows.map((row) => ({
    item_kind: "event",
    id: row.id,
    date_key: formatDateOnly(new Date(row.starts_at)),
    title: row.title,
    department: row.department,
    event_kind: row.event_kind,
    status: row.status,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    location_name: row.location_name,
    location_address: row.location_address,
    navigation_url: row.navigation_url,
    lead_user_id: row.lead_user_id,
    lead_name: row.lead_name,
    notes: row.notes,
    linked_shoot_id: row.linked_shoot_id,
    schedule_sync_state: row.sync_state,
    schedule_sync_required: Boolean(row.sync_required),
    integration: buildScheduleIntegrationState({
      linked: Boolean(row.outlook_event_id),
      syncState: row.sync_state,
      syncRequired: Boolean(row.sync_required),
      lastSyncedAt: row.last_synced_at,
      lastSyncDirection: row.last_sync_direction,
      lastSyncError: row.last_sync_error,
      reviewRequired: row.sync_review_required,
      reviewReason: row.sync_review_reason,
      changedFields: row.external_changed_fields,
      externalLastModifiedAt: row.external_last_modified_at,
      externalRecordId: row.outlook_event_id,
      externalCalendarId: row.outlook_calendar_id,
      sourceSystem: row.source_system
    })
  }));
}

export async function listUnifiedScheduleCalendar(client: PoolClient, auth: AuthUser, filters: UnifiedScheduleFilters) {
  const range = getScheduleWindowRange(filters.anchorDate, filters.window);
  const [shoots, events, availability, sync] = await Promise.all([
    listScheduleShootRows(client, auth, filters, range),
    listScheduleEventRows(client, auth, filters, range),
    listScheduleAvailabilityItems(client, auth, {
      startDate: range.startDate,
      endDate: range.endDate
    }),
    getOutlookScheduleSummary(client, auth.tenantId)
  ]);

  const items = [...shoots, ...events, ...availability].sort((left, right) => {
    const leftTime = new Date(String(left.starts_at ?? left.date_key)).getTime();
    const rightTime = new Date(String(right.starts_at ?? right.date_key)).getTime();
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return String(left.title ?? "").localeCompare(String(right.title ?? ""));
  });

  return {
    anchor_date: filters.anchorDate,
    window: filters.window,
    model: {
      schedule_role: "projection" as const,
      source_of_truth: "mission_control" as const,
      canonical_spine: ["job", "event", "staff_assignment", "task"] as const
    },
    range: {
      start_date: range.startDate,
      end_date: range.endDate
    },
    sync,
    items
  };
}

export async function listUnifiedScheduleBoard(
  client: PoolClient,
  auth: AuthUser,
  filters: UnifiedScheduleFilters,
  groupBy: ScheduleBoardGroupBy
) {
  const range = getScheduleWindowRange(filters.anchorDate, filters.window);
  const shoots = await listScheduleShootRows(client, auth, filters, range);
  const groups = new Map<string, typeof shoots>();
  for (const shoot of shoots) {
    const key =
      groupBy === "department"
        ? String(shoot.department)
        : groupBy === "lead_photographer"
          ? String(shoot.lead_name ?? "Unassigned lead")
          : groupBy === "day_part"
            ? String(shoot.board_day_part)
            : String(shoot.status);
    const list = groups.get(key);
    if (list) {
      list.push(shoot);
    } else {
      groups.set(key, [shoot]);
    }
  }

  return {
    anchor_date: filters.anchorDate,
    window: filters.window,
    model: {
      schedule_role: "projection" as const,
      source_of_truth: "mission_control" as const,
      canonical_spine: ["job", "event", "staff_assignment", "task"] as const
    },
    group_by: groupBy,
    groups: [...groups.entries()].map(([key, groupShoots]) => ({
      key,
      label: key.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase()),
      shoots: groupShoots.sort((left, right) => {
        const leftTime = new Date(String(left.starts_at)).getTime();
        const rightTime = new Date(String(right.starts_at)).getTime();
        if (leftTime !== rightTime) {
          return leftTime - rightTime;
        }
        return String(left.title).localeCompare(String(right.title));
      })
    }))
  };
}

function assertScheduleEventDepartmentAccess(auth: AuthUser, department: DepartmentCode) {
  if (!canCreateOrEditCalendarDepartment(auth, department)) {
    throw new ApiError(403, "Forbidden");
  }
}

export async function createScheduleEvent(client: PoolClient, auth: AuthUser, input: ScheduleEventInput, meta: RequestMeta) {
  assertScheduleEventDepartmentAccess(auth, input.department);
  const syncState = await getScheduleSyncWriteState(client, auth.tenantId);
  const navigationUrl = buildGoogleMapsLink({
    latitude: input.location_lat ?? null,
    longitude: input.location_lng ?? null,
    address: input.location_address ?? null,
    label: input.location_name ?? input.title
  });

  const { rows } = await client.query(
    `
      INSERT INTO schedule_event (
        tenant_id, studio_id, department, event_kind, status, title, starts_at, ends_at,
        location_name, location_address, location_lat, location_lng, navigation_url, lead_user_id, notes,
        linked_shoot_id, sync_required, sync_state, created_by_user_id, updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)
      RETURNING *
    `,
    [
      auth.tenantId,
      input.studio_id ?? null,
      input.department,
      input.event_kind,
      input.status ?? "scheduled",
      input.title,
      input.starts_at,
      input.ends_at,
      input.location_name ?? "",
      input.location_address ?? "",
      input.location_lat ?? null,
      input.location_lng ?? null,
      navigationUrl,
      input.lead_user_id ?? null,
      input.notes ?? null,
      input.linked_shoot_id ?? null,
      syncState.syncRequired,
      syncState.syncState,
      auth.id
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: input.lead_user_id ?? null,
    action: "schedule.event.created",
    entityType: "schedule_event",
    entityId: rows[0].id,
    metadata: {
      department: input.department,
      event_kind: input.event_kind,
      linked_shoot_id: input.linked_shoot_id ?? null
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return rows[0];
}

export async function updateScheduleEvent(
  client: PoolClient,
  auth: AuthUser,
  eventId: string,
  patch: Partial<ScheduleEventInput>,
  meta: RequestMeta
) {
  const existingResult = await client.query("SELECT * FROM schedule_event WHERE id = $1 AND deleted_at IS NULL LIMIT 1", [eventId]);
  const existing = existingResult.rows[0];
  if (!existing) {
    throw new ApiError(404, "Schedule event not found");
  }

  const nextDepartment = (patch.department ?? existing.department) as DepartmentCode;
  assertScheduleEventDepartmentAccess(auth, nextDepartment);
  const syncState = await getScheduleSyncWriteState(client, auth.tenantId);

  const nextLocationLat = patch.location_lat ?? existing.location_lat;
  const nextLocationLng = patch.location_lng ?? existing.location_lng;
  const nextLocationAddress = patch.location_address ?? existing.location_address;
  const nextLocationName = patch.location_name ?? existing.location_name;

  const hydratedPatch = {
    ...patch,
    navigation_url: buildGoogleMapsLink({
      latitude: nextLocationLat ?? null,
      longitude: nextLocationLng ?? null,
      address: nextLocationAddress ?? null,
      label: nextLocationName ?? existing.title
    }),
    sync_required: syncState.syncRequired,
    sync_state: syncState.syncState,
    updated_by_user_id: auth.id
  };

  const keys = Object.keys(hydratedPatch);
  if (!keys.length) {
    return existing;
  }

  const values = keys.map((key) => (hydratedPatch as Record<string, unknown>)[key]);
  const setClause = keys.map((key, index) => `${key} = $${index + 2}`).join(", ");
  const { rows } = await client.query(`UPDATE schedule_event SET ${setClause}, updated_at = now() WHERE id = $1 RETURNING *`, [
    eventId,
    ...values
  ]);

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: rows[0].lead_user_id ?? null,
    action: "schedule.event.updated",
    entityType: "schedule_event",
    entityId: eventId,
    metadata: {
      previous_status: existing.status,
      next_status: rows[0].status
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return rows[0];
}

export async function getScheduleEventById(client: PoolClient, auth: AuthUser, eventId: string) {
  const scopeValues: unknown[] = [eventId];
  const scopeWhere = ["ev.id = $1", "ev.deleted_at IS NULL"];
  scopeWhere.push(...buildEventScopeSql(auth, scopeValues, "ev"));
  const { rows } = await client.query(
    `
      SELECT ev.*, lead.full_name AS lead_name
      FROM schedule_event ev
      LEFT JOIN app_user lead ON lead.id = ev.lead_user_id
      WHERE ${scopeWhere.join(" AND ")}
      LIMIT 1
    `,
    scopeValues
  );
  if (!rows[0]) {
    throw new ApiError(404, "Schedule event not found");
  }
  return {
    ...rows[0],
    integration: buildScheduleIntegrationState({
      linked: Boolean(rows[0].outlook_event_id),
      syncState: rows[0].sync_state,
      syncRequired: Boolean(rows[0].sync_required),
      lastSyncedAt: rows[0].last_synced_at,
      lastSyncDirection: rows[0].last_sync_direction,
      lastSyncError: rows[0].last_sync_error,
      reviewRequired: rows[0].sync_review_required,
      reviewReason: rows[0].sync_review_reason,
      changedFields: rows[0].external_changed_fields,
      externalLastModifiedAt: rows[0].external_last_modified_at,
      externalRecordId: rows[0].outlook_event_id,
      externalCalendarId: rows[0].outlook_calendar_id,
      sourceSystem: rows[0].source_system
    })
  };
}

export async function listStaffingTemplates(client: PoolClient, auth: AuthUser, department?: DepartmentCode | null) {
  const values: unknown[] = [auth.tenantId];
  const where = ["st.tenant_id = $1"];
  if (department) {
    values.push(department);
    where.push(`st.department = $${values.length}::department_code`);
  } else if (shouldDepartmentScopeShiftList(auth)) {
    values.push(auth.department);
    where.push(`st.department = $${values.length}::department_code`);
  }

  const { rows } = await client.query(
    `
      SELECT
        st.*,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', str.id,
                'staffing_role', str.staffing_role,
                'label', str.label,
                'headcount', str.headcount,
                'satisfies_lead_coverage', str.satisfies_lead_coverage,
                'minimum_count', str.minimum_count,
                'ideal_count', str.ideal_count,
                'required_for_ready', str.required_for_ready,
                'lead_eligible', str.lead_eligible,
                'lead_required', str.lead_required,
                'call_offset_minutes', str.call_offset_minutes,
                'start_offset_minutes', str.start_offset_minutes,
                'end_offset_minutes', str.end_offset_minutes,
                'location_name_override', str.location_name_override,
                'location_address_override', str.location_address_override,
                'required_qualification_tags', str.required_qualification_tags,
                'role_notes', str.role_notes,
                'sort_order', str.sort_order
              )
              ORDER BY str.sort_order ASC
            )
            FROM staffing_template_role str
            WHERE str.staffing_template_id = st.id
          ),
          '[]'::json
        ) AS roles
      FROM staffing_template st
      WHERE ${where.join(" AND ")}
      ORDER BY st.department ASC, st.name ASC
    `,
    values
  );
  return rows;
}

export async function createStaffingTemplate(client: PoolClient, auth: AuthUser, input: StaffingTemplateInput, meta: RequestMeta) {
  assertScheduleEventDepartmentAccess(auth, input.department);
  const { rows } = await client.query(
    `
      INSERT INTO staffing_template (
        tenant_id, department, name, description, planned_staff_count, minimum_staff_count, required_lead_count, created_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `,
    [
      auth.tenantId,
      input.department,
      input.name,
      input.description ?? null,
      input.planned_staff_count,
      input.minimum_staff_count ?? input.planned_staff_count,
      input.required_lead_count,
      auth.id
    ]
  );
  const template = rows[0];
  for (const [index, role] of input.roles.entries()) {
    await client.query(
      `
        INSERT INTO staffing_template_role (
          tenant_id, staffing_template_id, staffing_role, label, headcount, satisfies_lead_coverage,
          minimum_count, ideal_count, required_for_ready, lead_eligible, lead_required,
          call_offset_minutes, start_offset_minutes, end_offset_minutes,
          location_name_override, location_address_override, required_qualification_tags, role_notes, sort_order
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      `,
      [
        auth.tenantId,
        template.id,
        role.staffing_role,
        role.label,
        role.headcount,
        Boolean(role.satisfies_lead_coverage),
        role.minimum_count ?? role.headcount,
        role.ideal_count ?? role.headcount,
        role.required_for_ready ?? true,
        role.lead_eligible ?? Boolean(role.satisfies_lead_coverage),
        role.lead_required ?? Boolean(role.satisfies_lead_coverage),
        role.call_offset_minutes ?? 0,
        role.start_offset_minutes ?? 0,
        role.end_offset_minutes ?? 0,
        role.location_name_override ?? null,
        role.location_address_override ?? null,
        role.required_qualification_tags ?? [],
        role.role_notes ?? null,
        index
      ]
    );
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "schedule.staffing_template.created",
    entityType: "staffing_template",
    entityId: template.id,
    metadata: {
      department: input.department,
      planned_staff_count: input.planned_staff_count,
      minimum_staff_count: input.minimum_staff_count ?? input.planned_staff_count,
      required_lead_count: input.required_lead_count
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return listStaffingTemplates(client, auth, input.department).then((templates) => templates.find((item) => item.id === template.id) ?? template);
}

export async function applyStaffingTemplateToShoot(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  templateId: string,
  meta: RequestMeta
) {
  const shootRows = await client.query("SELECT * FROM shoot WHERE id = $1 AND deleted_at IS NULL LIMIT 1", [shootId]);
  const shoot = shootRows.rows[0];
  if (!shoot) {
    throw new ApiError(404, "Shoot not found");
  }
  if (!canCreateOrEditCalendarDepartment(auth, shoot.department)) {
    throw new ApiError(403, "Forbidden");
  }
  const templateRows = await client.query("SELECT * FROM staffing_template WHERE id = $1 LIMIT 1", [templateId]);
  const template = templateRows.rows[0];
  if (!template) {
    throw new ApiError(404, "Staffing template not found");
  }
  if (template.department !== shoot.department && !hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Template department does not match the shoot");
  }

  const templateRoleRows = (
    await client.query<{
      id: string;
      staffing_role: StaffingTemplateInput["roles"][number]["staffing_role"];
      label: string;
      headcount: number;
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
    }>(
      `
        SELECT
          id,
          staffing_role,
          label,
          headcount,
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
      [auth.tenantId, templateId]
    )
  ).rows;

  const syncState = await getScheduleSyncWriteState(client, auth.tenantId);
  const { rows } = await client.query(
    `
      UPDATE shoot
      SET staffing_template_id = $2,
          planned_staff_count = $3,
          minimum_staff_count = $4,
          required_lead_count = $5,
          schedule_sync_required = $6,
          schedule_sync_state = $7::schedule_sync_state,
          updated_at = now()
      WHERE id = $1
      RETURNING *
    `,
    [
      shootId,
      templateId,
      template.planned_staff_count,
      template.minimum_staff_count ?? template.planned_staff_count,
      template.required_lead_count,
      syncState.syncRequired,
      syncState.syncState
    ]
  );

  await client.query(
    `
      DELETE FROM shoot_staffing_requirement
      WHERE tenant_id = $1
        AND shoot_id = $2
    `,
    [auth.tenantId, shootId]
  );

  for (const role of templateRoleRows) {
    await client.query(
      `
        INSERT INTO shoot_staffing_requirement (
          tenant_id, shoot_id, source_of_creation, source_template_role_id, staffing_role, label,
          minimum_count, ideal_count, required_for_ready, lead_eligible, lead_required,
          call_offset_minutes, start_offset_minutes, end_offset_minutes,
          location_name_override, location_address_override, required_qualification_tags, role_notes, sort_order, created_by_user_id
        )
        VALUES ($1,$2,'template_from_shoot_type',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      `,
      [
        auth.tenantId,
        shootId,
        role.id,
        role.staffing_role,
        role.label,
        Number(role.minimum_count ?? role.headcount ?? 0),
        Number(role.ideal_count ?? role.headcount ?? 0),
        Boolean(role.required_for_ready),
        Boolean(role.lead_eligible),
        Boolean(role.lead_required),
        Number(role.call_offset_minutes ?? 0),
        Number(role.start_offset_minutes ?? 0),
        Number(role.end_offset_minutes ?? 0),
        role.location_name_override ?? null,
        role.location_address_override ?? null,
        role.required_qualification_tags ?? [],
        role.role_notes ?? null,
        Number(role.sort_order ?? 0),
        auth.id
      ]
    );
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "schedule.staffing_template.applied",
    entityType: "shoot",
    entityId: shootId,
    metadata: {
      template_id: templateId,
      template_name: template.name,
      planned_staff_count: template.planned_staff_count,
      minimum_staff_count: template.minimum_staff_count ?? template.planned_staff_count,
      required_lead_count: template.required_lead_count
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return rows[0];
}

function combineDateWithLocalTime(targetDate: string, existingIso: string | null | undefined) {
  if (!existingIso) {
    return null;
  }
  const existing = new Date(existingIso);
  const target = new Date(`${targetDate}T00:00:00`);
  target.setHours(existing.getHours(), existing.getMinutes(), existing.getSeconds(), existing.getMilliseconds());
  return target.toISOString();
}

async function buildShootMoveWarnings(client: PoolClient, shootId: string) {
  const warnings: string[] = [];
  const overlap = await client.query(
    `
      SELECT DISTINCT au.full_name
      FROM work_shift ws
      JOIN work_shift other
        ON other.assigned_user_id = ws.assigned_user_id
       AND other.id <> ws.id
       AND other.cancelled_at IS NULL
       AND other.status IN ('draft', 'published', 'completed')
       AND tstzrange(other.starts_at, other.ends_at, '[)') && tstzrange(ws.starts_at, ws.ends_at, '[)')
      JOIN app_user au ON au.id = ws.assigned_user_id
      WHERE ws.shoot_id = $1
        AND ws.cancelled_at IS NULL
    `,
    [shootId]
  );
  if (overlap.rows.length) {
    warnings.push(`Overlap detected for ${overlap.rows.map((row) => row.full_name).join(", ")}`);
  }

  const staffing = await client.query(
    `
      SELECT
        planned_staff_count,
        required_lead_count,
        (
          SELECT COUNT(DISTINCT ws.assigned_user_id)
          FROM work_shift ws
          WHERE ws.shoot_id = s.id
            AND ws.cancelled_at IS NULL
            AND ws.status IN ('draft', 'published', 'completed')
        ) AS assigned_staff_count,
        (
          SELECT COUNT(*)
          FROM work_shift ws
          WHERE ws.shoot_id = s.id
            AND ws.cancelled_at IS NULL
            AND ws.status IN ('draft', 'published', 'completed')
            AND ws.satisfies_lead_coverage = true
        ) AS lead_coverage_count
      FROM shoot s
      WHERE s.id = $1
      LIMIT 1
    `,
    [shootId]
  );
  const snapshot = staffing.rows[0];
  if (snapshot) {
    if (Number(snapshot.assigned_staff_count ?? 0) < Number(snapshot.planned_staff_count ?? 0)) {
      warnings.push("Shoot is still under-staffed after the move.");
    }
    if (Number(snapshot.lead_coverage_count ?? 0) < Number(snapshot.required_lead_count ?? 1)) {
      warnings.push("Required lead coverage is missing after the move.");
    }
  }

  return warnings;
}

export async function moveScheduleItem(
  client: PoolClient,
  auth: AuthUser,
  input: { itemKind: "shoot" | "event"; id: string; targetDate: string },
  meta: RequestMeta
) {
  if (input.itemKind === "shoot") {
    const shootResult = await client.query("SELECT * FROM shoot WHERE id = $1 AND deleted_at IS NULL LIMIT 1", [input.id]);
    const shoot = shootResult.rows[0];
    if (!shoot) {
      throw new ApiError(404, "Shoot not found");
    }
    if (!canCreateOrEditCalendarDepartment(auth, shoot.department)) {
      throw new ApiError(403, "Forbidden");
    }
    if (new Date(shoot.start_time).getTime() <= Date.now() && !hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
      throw new ApiError(403, "Only directors and leadership can move a live shoot");
    }

    const nextArrival = combineDateWithLocalTime(input.targetDate, shoot.arrival_time);
    const nextStart = combineDateWithLocalTime(input.targetDate, shoot.start_time);
    const nextEnd = combineDateWithLocalTime(input.targetDate, shoot.end_time_est);
    if (!nextArrival || !nextStart || !nextEnd) {
      throw new ApiError(400, "Shoot timing is incomplete and cannot be moved yet");
    }
    const deltaMs = new Date(nextStart).getTime() - new Date(shoot.start_time).getTime();
    const syncState = await getScheduleSyncWriteState(client, auth.tenantId);

    const updatedShoot = (
      await client.query(
        `
          UPDATE shoot
          SET shoot_date = $2::date,
              arrival_time = $3::timestamptz,
              start_time = $4::timestamptz,
              end_time_est = $5::timestamptz,
              schedule_sync_required = $6,
              schedule_sync_state = $7::schedule_sync_state,
              updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [input.id, input.targetDate, nextArrival, nextStart, nextEnd, syncState.syncRequired, syncState.syncState]
      )
    ).rows[0];

    const movedShiftRows = await client.query<{ id: string }>(
      `
        UPDATE work_shift
        SET starts_at = starts_at + ($2 || ' milliseconds')::interval,
            ends_at = ends_at + ($2 || ' milliseconds')::interval,
            calendar_sync_required = CASE WHEN status = 'published' THEN true ELSE calendar_sync_required END,
            updated_at = now()
        WHERE shoot_id = $1
          AND cancelled_at IS NULL
        RETURNING id
      `,
      [input.id, String(deltaMs)]
    );
    for (const row of movedShiftRows.rows) {
      await queueWorkShiftOutlookSync(client, {
        tenantId: auth.tenantId,
        shiftId: row.id,
        triggeredByUserId: auth.id,
        dedupeSuffix: `shoot-move:${updatedShoot.updated_at ?? new Date().toISOString()}`
      });
    }

    await client.query(
      `
        UPDATE schedule_event
        SET starts_at = starts_at + ($2 || ' milliseconds')::interval,
            ends_at = ends_at + ($2 || ' milliseconds')::interval,
            sync_required = CASE WHEN source_system = 'mission_control' THEN $3 ELSE sync_required END,
            sync_state = CASE WHEN source_system = 'mission_control' THEN $4::schedule_sync_state ELSE sync_state END,
            updated_at = now(),
            updated_by_user_id = $5
        WHERE linked_shoot_id = $1
          AND deleted_at IS NULL
      `,
      [input.id, String(deltaMs), syncState.syncRequired, syncState.syncState, auth.id]
    );

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action: "schedule.shoot.moved",
      entityType: "shoot",
      entityId: input.id,
      metadata: {
        previous_date: String(shoot.shoot_date).slice(0, 10),
        target_date: input.targetDate
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });

    const affectedShiftUsers = await client.query<{ assigned_user_id: string }>(
      `
        SELECT DISTINCT assigned_user_id
        FROM work_shift
        WHERE shoot_id = $1
          AND cancelled_at IS NULL
      `,
      [input.id]
    );
    for (const row of affectedShiftUsers.rows) {
      await reconcileSubmittedPTOConflictsForUser(client, {
        tenantId: auth.tenantId,
        userId: row.assigned_user_id
      });
    }

    const warnings = await buildShootMoveWarnings(client, input.id);
    return { item_kind: "shoot", id: input.id, warnings };
  }

  const eventResult = await client.query("SELECT * FROM schedule_event WHERE id = $1 AND deleted_at IS NULL LIMIT 1", [input.id]);
  const event = eventResult.rows[0];
  if (!event) {
    throw new ApiError(404, "Schedule event not found");
  }
  assertScheduleEventDepartmentAccess(auth, event.department);
  const nextStart = combineDateWithLocalTime(input.targetDate, event.starts_at);
  const nextEnd = combineDateWithLocalTime(input.targetDate, event.ends_at);
  if (!nextStart || !nextEnd) {
    throw new ApiError(400, "Schedule event timing is incomplete and cannot be moved yet");
  }
  const syncState = await getScheduleSyncWriteState(client, auth.tenantId);
  await client.query(
    `
      UPDATE schedule_event
      SET starts_at = $2::timestamptz,
          ends_at = $3::timestamptz,
          sync_required = $4,
          sync_state = $5::schedule_sync_state,
          updated_at = now(),
          updated_by_user_id = $6
      WHERE id = $1
    `,
    [input.id, nextStart, nextEnd, syncState.syncRequired, syncState.syncState, auth.id]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: event.lead_user_id ?? null,
    action: "schedule.event.moved",
    entityType: "schedule_event",
    entityId: input.id,
    metadata: {
      previous_start: event.starts_at,
      previous_end: event.ends_at,
      target_date: input.targetDate
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return { item_kind: "event", id: input.id, warnings: [] };
}

async function loadShootSyncTarget(client: PoolClient, auth: AuthUser, shootId: string) {
  const values: unknown[] = [shootId];
  const where = ["s.id = $1", "s.deleted_at IS NULL"];
  where.push(...buildShootScopeSql(auth, values, "s"));
  const { rows } = await client.query(
    `
      SELECT
        s.id,
        s.shoot_code,
        s.title,
        s.schedule_sync_required,
        s.schedule_sync_state,
        s.schedule_last_synced_at,
        s.schedule_last_error,
        linked.id AS linked_event_id,
        linked.title AS linked_event_title,
        linked.starts_at AS linked_event_starts_at,
        linked.outlook_event_id,
        linked.outlook_calendar_id,
        linked.outlook_recurrence_master_id,
        linked.outlook_recurrence_occurrence_id,
        linked.sync_review_required,
        linked.sync_review_reason,
        linked.sync_state AS linked_sync_state,
        linked.sync_required AS linked_sync_required,
        linked.last_synced_at AS linked_last_synced_at,
        linked.last_sync_direction AS linked_last_sync_direction,
        linked.last_sync_error AS linked_last_sync_error,
        linked.external_changed_fields,
        linked.external_last_modified_at,
        linked.source_system
      FROM shoot s
      LEFT JOIN LATERAL (
        SELECT *
        FROM schedule_event ev
        WHERE ev.linked_shoot_id = s.id
          AND ev.deleted_at IS NULL
        ORDER BY CASE WHEN ev.outlook_event_id IS NOT NULL THEN 0 ELSE 1 END, ev.starts_at ASC
        LIMIT 1
      ) linked ON TRUE
      WHERE ${where.join(" AND ")}
      LIMIT 1
    `,
    values
  );
  return rows[0] ?? null;
}

async function loadEventSyncTarget(client: PoolClient, auth: AuthUser, eventId: string) {
  const scopeValues: unknown[] = [eventId];
  const scopeWhere = ["ev.id = $1", "ev.deleted_at IS NULL"];
  scopeWhere.push(...buildEventScopeSql(auth, scopeValues, "ev"));
  const { rows } = await client.query(
    `
      SELECT ev.*
      FROM schedule_event ev
      WHERE ${scopeWhere.join(" AND ")}
      LIMIT 1
    `,
    scopeValues
  );
  return rows[0] ?? null;
}

async function loadScheduleSyncTarget(client: PoolClient, auth: AuthUser, itemKind: ScheduleItemKind, id: string) {
  if (itemKind === "shoot") {
    const shoot = await loadShootSyncTarget(client, auth, id);
    if (!shoot) {
      throw new ApiError(404, "Shoot not found");
    }
    return {
      itemKind,
      entityType: "shoot" as const,
      title: String(shoot.title),
      row: shoot,
      outlookEventId: shoot.outlook_event_id ? String(shoot.outlook_event_id) : null,
      outlookCalendarId: shoot.outlook_calendar_id ? String(shoot.outlook_calendar_id) : null,
      startsAt: shoot.linked_event_starts_at ? String(shoot.linked_event_starts_at) : null
    };
  }

  const event = await loadEventSyncTarget(client, auth, id);
  if (!event) {
    throw new ApiError(404, "Schedule event not found");
  }
  return {
    itemKind,
    entityType: "schedule_event" as const,
    title: String(event.title),
    row: event,
    outlookEventId: event.outlook_event_id ? String(event.outlook_event_id) : null,
    outlookCalendarId: event.outlook_calendar_id ? String(event.outlook_calendar_id) : null,
    startsAt: event.starts_at ? String(event.starts_at) : null
  };
}

function buildOutlookPushPayload(target: Awaited<ReturnType<typeof loadScheduleSyncTarget>>) {
  const basePayload = {
    source_object: {
      type: target.entityType,
      id: String(target.row.id)
    },
    target_object: {
      type: "outlook_calendar_event",
      id: target.outlookEventId,
      calendar_id: target.outlookCalendarId
    },
    sync_state: {
      last_attempted_sync_at: null,
      last_successful_sync_at: null,
      last_failed_sync_at: null,
      retry_state: "pending_dispatch"
    },
    write_intent: {
      source_of_truth: "mission_control",
      delivery_layer: "outlook_calendar",
      explicit_user_action: true,
      operation_type: "upsert"
    }
  };
  if (target.itemKind === "shoot") {
    return {
      ...basePayload,
      shoot_id: String(target.row.id),
      shoot_code: String(target.row.shoot_code),
      title: String(target.title),
      explicit_user_push: true
    };
  }
  return {
    ...basePayload,
    schedule_event_id: String(target.row.id),
    title: String(target.title),
    explicit_user_push: true
  };
}

async function markScheduleItemPendingExplicitPush(
  client: PoolClient,
  auth: AuthUser,
  target: Awaited<ReturnType<typeof loadScheduleSyncTarget>>
) {
  if (target.itemKind === "shoot") {
    await client.query(
      `
        UPDATE shoot
        SET schedule_sync_required = true,
            schedule_sync_state = 'pending_sync'::schedule_sync_state,
            schedule_last_error = NULL,
            updated_at = now()
        WHERE id = $1
      `,
      [target.row.id]
    );
    await client.query(
      `
        UPDATE schedule_event
        SET sync_required = true,
            sync_state = 'pending_sync'::schedule_sync_state,
            last_sync_error = NULL,
            last_sync_direction = 'outbound',
            sync_review_required = false,
            sync_review_reason = NULL,
            sync_review_acknowledged_at = now(),
            sync_review_acknowledged_by = $2,
            external_changed_fields = '[]'::jsonb,
            external_change_snapshot = '{}'::jsonb,
            updated_at = now(),
            updated_by_user_id = $2
        WHERE linked_shoot_id = $1
          AND deleted_at IS NULL
      `,
      [target.row.id, auth.id]
    );
    return;
  }

  await client.query(
    `
      UPDATE schedule_event
      SET sync_required = true,
          sync_state = 'pending_sync'::schedule_sync_state,
          last_sync_error = NULL,
          last_sync_direction = 'outbound',
          sync_review_required = false,
          sync_review_reason = NULL,
          sync_review_acknowledged_at = now(),
          sync_review_acknowledged_by = $2,
          external_changed_fields = '[]'::jsonb,
          external_change_snapshot = '{}'::jsonb,
          updated_at = now(),
          updated_by_user_id = $2
      WHERE id = $1
    `,
    [target.row.id, auth.id]
  );
}

export async function pushScheduleItemToOutlook(
  client: PoolClient,
  auth: AuthUser,
  input: { itemKind: ScheduleItemKind; id: string },
  meta: RequestMeta
) {
  const syncState = await getScheduleSyncWriteState(client, auth.tenantId);
  if (!syncState.syncRequired) {
    throw new ApiError(409, "Connect Outlook before pushing Mission Control changes outward.");
  }

  const target = await loadScheduleSyncTarget(client, auth, input.itemKind, input.id);
  if (
    target.itemKind === "event" &&
    (target.row.outlook_recurrence_master_id || target.row.outlook_recurrence_occurrence_id)
  ) {
    throw new ApiError(409, "Recurring Outlook events stay read-only in phase 1. Review them in Outlook instead.");
  }

  const dangerousAction = await beginDangerousAction(client, auth, {
    actionCode: "push_external_updates",
    entityType: target.entityType,
    entityId: String(target.row.id),
    sourceModule: "schedule",
    reason: "Explicit Outlook sync push requested",
    beforeValue: {
      title: target.title,
      outlook_event_id: target.outlookEventId,
      outlook_calendar_id: target.outlookCalendarId
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  try {
    await markScheduleItemPendingExplicitPush(client, auth, target);
    const operation = await queueScheduleSync(client, {
      tenantId: auth.tenantId,
      aggregateType: target.entityType,
      aggregateId: String(target.row.id),
      dedupeSuffix: `manual-push:${Date.now()}`,
      triggeredByUserId: auth.id,
      payload: buildOutlookPushPayload(target)
    });

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action: "schedule.outlook_push.requested",
      entityType: target.entityType,
      entityId: String(target.row.id),
      metadata: {
        integration_sync_operation_id: operation?.id ?? null,
        provider: "outlook",
        entity_kind: target.itemKind,
        explicit_user_action: true
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });

    await completeDangerousAction(client, auth, {
      executionId: dangerousAction.executionId,
      actionCode: "push_external_updates",
      entityType: target.entityType,
      entityId: String(target.row.id),
      afterValue: {
        sync_state: "pending_sync",
        integration_sync_operation_id: operation?.id ?? null
      },
      reason: "Explicit Outlook sync push requested",
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });

    return {
      queued: true,
      integration_sync_operation_id: operation?.id ?? null
    };
  } catch (error) {
    await failDangerousAction(client, auth, {
      executionId: dangerousAction.executionId,
      actionCode: "push_external_updates",
      entityType: target.entityType,
      entityId: String(target.row.id),
      errorMessage: error instanceof Error ? error.message : "Unknown Outlook push error",
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });
    throw error;
  }
}

export async function triggerScheduleItemOutlookResync(
  client: PoolClient,
  auth: AuthUser,
  input: { itemKind: ScheduleItemKind; id: string },
  meta: RequestMeta
) {
  const target = await loadScheduleSyncTarget(client, auth, input.itemKind, input.id);
  if (!target.outlookEventId || !target.outlookCalendarId || !target.startsAt) {
    throw new ApiError(409, "Manual resync is only available after this record is linked to an Outlook event.");
  }

  const previewDate = formatDateOnly(new Date(target.startsAt));
  const previewEvents = await previewOutlookEvents(client, auth, {
    date: previewDate,
    calendarId: target.outlookCalendarId,
    window: "3day",
    enabledOnly: false
  });
  const preview = previewEvents.find((event) => event.id === target.outlookEventId);
  if (!preview) {
    const errorMessage = "Mission Control could not read the linked Outlook event. Check whether the event still exists or whether calendar access has expired.";
    if (target.itemKind === "shoot") {
      await client.query(
        `
          UPDATE shoot
          SET schedule_sync_state = 'sync_error'::schedule_sync_state,
              schedule_last_error = $2,
              updated_at = now()
          WHERE id = $1
        `,
        [target.row.id, errorMessage]
      );
    } else {
      await client.query(
        `
          UPDATE schedule_event
          SET sync_state = 'sync_error'::schedule_sync_state,
              last_sync_error = $2,
              sync_review_required = true,
              sync_review_reason = $2,
              updated_at = now(),
              updated_by_user_id = $3
          WHERE id = $1
        `,
        [target.row.id, errorMessage, auth.id]
      );
    }
    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action: "schedule.outlook_resync.failed",
      entityType: target.entityType,
      entityId: String(target.row.id),
      metadata: {
        provider: "outlook",
        reason: errorMessage,
        manual_resync: true
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });
    throw new ApiError(404, errorMessage);
  }

  await createAppEvent(client, {
    tenantId: auth.tenantId,
    eventType: "microsoft_graph.webhook.received",
    aggregateType: "integration_webhook",
    aggregateId: String(target.row.id),
    dedupeKey: `outlook-manual-resync:${target.entityType}:${target.row.id}:${Date.now()}`,
    payload: {
      provider: "microsoft_graph",
      received_at: new Date().toISOString(),
      source_ip: meta.ipAddress ?? null,
      headers: {
        "x-sync-source": "manual-resync"
      },
      body: {
        event_id: preview.id,
        calendar_id: preview.calendar_id,
        subject: preview.subject,
        starts_at: preview.starts_at,
        ends_at: preview.ends_at,
        organizer: preview.organizer,
        location: preview.location,
        all_day: false,
        attendees: [],
        body_preview: preview.preview_note ?? null,
        cancelled: false,
        last_modified_at: new Date().toISOString(),
        source: "manual_resync"
      }
    }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "schedule.outlook_resync.requested",
    entityType: target.entityType,
    entityId: String(target.row.id),
    metadata: {
      provider: "outlook",
      external_id: target.outlookEventId,
      manual_resync: true
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return { queued: true };
}

export async function acknowledgeScheduleIntegrationReview(
  client: PoolClient,
  auth: AuthUser,
  input: { itemKind: ScheduleItemKind; id: string },
  meta: RequestMeta
) {
  const target = await loadScheduleSyncTarget(client, auth, input.itemKind, input.id);

  if (target.itemKind === "shoot") {
    await client.query(
      `
        UPDATE shoot
        SET schedule_sync_state = CASE WHEN schedule_sync_required THEN 'pending_sync'::schedule_sync_state ELSE 'in_sync'::schedule_sync_state END,
            schedule_last_error = NULL,
            updated_at = now()
        WHERE id = $1
      `,
      [target.row.id]
    );
    await client.query(
      `
        UPDATE schedule_event
        SET sync_review_required = false,
            sync_review_reason = NULL,
            sync_review_acknowledged_at = now(),
            sync_review_acknowledged_by = $2,
            external_changed_fields = '[]'::jsonb,
            updated_at = now(),
            updated_by_user_id = $2
        WHERE linked_shoot_id = $1
          AND deleted_at IS NULL
      `,
      [target.row.id, auth.id]
    );
  } else {
    await client.query(
      `
        UPDATE schedule_event
        SET sync_review_required = false,
            sync_review_reason = NULL,
            sync_review_acknowledged_at = now(),
            sync_review_acknowledged_by = $2,
            external_changed_fields = '[]'::jsonb,
            sync_state = CASE WHEN sync_required THEN 'pending_sync'::schedule_sync_state ELSE 'in_sync'::schedule_sync_state END,
            updated_at = now(),
            updated_by_user_id = $2
        WHERE id = $1
      `,
      [target.row.id, auth.id]
    );
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "schedule.outlook_review.acknowledged",
    entityType: target.entityType,
    entityId: String(target.row.id),
    metadata: {
      provider: "outlook",
      manual_review_cleared: true
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return { acknowledged: true };
}
