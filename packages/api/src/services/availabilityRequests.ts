import type { PoolClient } from "pg";
import { hasAuthorityTier } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser, DepartmentCode } from "../types/auth.js";
import type { NotificationChannel } from "../types/domain.js";
import { createAuditLog } from "./audit.js";
import { canUserApprovePTORequest, resolvePTOApproverUserIds } from "./approvalRouting.js";
import { findNotificationRecipients, queueNotificationDispatch } from "./opsNotifications.js";
import { shouldDepartmentScopeShiftList, shouldRestrictShiftList } from "./shiftAccess.js";
import { getLocalDateString } from "../utils/localDate.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export const availabilityRequestStatuses = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "cancelled_by_employee",
  "cancelled_by_manager_admin",
  "expired",
  "needs_review"
] as const;

export const availabilityRequestTypes = [
  "full_day_off",
  "partial_day_off",
  "multi_day_off",
  "sick_illness",
  "personal_appointment",
  "unavailable_for_assignment",
  "availability_restriction_update",
  "company_holiday",
  "manager_blocked_day",
  "training_meeting_hold",
  "admin_unavailable",
  "protected_blackout"
] as const;

export const recurringAvailabilityRuleTypes = [
  "unavailable_weekday",
  "available_after_time",
  "available_between_times",
  "seasonal_unavailable"
] as const;

export const blockedDateTypes = [
  "company_holiday",
  "manager_blocked_day",
  "training_meeting_hold",
  "admin_unavailable",
  "protected_blackout"
] as const;

export const liveOperationalAbsenceStates = [
  "reported_absent",
  "excused",
  "unexcused",
  "pending_coverage_review"
] as const;

export type AvailabilityRequestStatus = (typeof availabilityRequestStatuses)[number];
export type AvailabilityRequestType = (typeof availabilityRequestTypes)[number];
export type RecurringAvailabilityRuleType = (typeof recurringAvailabilityRuleTypes)[number];
export type BlockedDateType = (typeof blockedDateTypes)[number];
export type LiveOperationalAbsenceState = (typeof liveOperationalAbsenceStates)[number];
type ProtectedDateSeverity = "soft" | "hard" | null;

export type RecurringAvailabilityRuleInput = {
  rule_type: RecurringAvailabilityRuleType;
  weekdays?: number[];
  start_time?: string | null;
  end_time?: string | null;
  season_start?: string | null;
  season_end?: string | null;
  note?: string | null;
};

export type AvailabilityRequestInput = {
  requested_on?: string;
  request_unit?: "half_day" | "full_day";
  reason?: string | null;
  request_type?: AvailabilityRequestType;
  start_date?: string;
  end_date?: string | null;
  all_day?: boolean;
  start_time?: string | null;
  end_time?: string | null;
  reason_category?: string | null;
  note?: string | null;
  recurring_rule?: RecurringAvailabilityRuleInput | null;
};

export type AvailabilityRequestReviewInput = {
  status: "approved" | "rejected" | "needs_review";
  notes?: string | null;
  live_operational_absence_state?: Extract<
    LiveOperationalAbsenceState,
    "excused" | "unexcused" | "pending_coverage_review"
  > | null;
};

export type AvailabilityRuleCreateInput = {
  user_id: string;
  department?: DepartmentCode | string | null;
  rule_type: RecurringAvailabilityRuleType;
  weekdays?: number[];
  start_time?: string | null;
  end_time?: string | null;
  season_start?: string | null;
  season_end?: string | null;
  note?: string | null;
};

export type BlockedDateCreateInput = {
  target_scope: "company" | "department" | "user";
  target_department?: DepartmentCode | string | null;
  target_user_id?: string | null;
  block_type: BlockedDateType;
  block_severity?: "soft" | "hard";
  label: string;
  starts_at: string;
  ends_at: string;
  approval_required?: boolean;
  note?: string | null;
};

type AvailabilityImpactSummary = {
  affected_assignment_count: number;
  published_assignment_count: number;
  minimum_staffing_break_count: number;
  lead_coverage_break_count: number;
  protected_date_count: number;
  protected_date_severity: ProtectedDateSeverity;
  staffing_risk: "none" | "warning" | "high" | "critical";
  same_day_request: boolean;
  coverage_needed: boolean;
  escalation_required: boolean;
};

type AvailabilityRequestRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  department: string;
  starts_on: string;
  ends_on: string;
  requested_on: string;
  request_unit: string;
  requested_hours: string | number;
  request_type: AvailabilityRequestType;
  status: AvailabilityRequestStatus;
  approver_user_id: string | null;
  decided_by_user_id: string | null;
  notes: string | null;
  reason: string | null;
  reason_category: string | null;
  all_day: boolean;
  partial_day: boolean;
  start_time: string | null;
  end_time: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  impacted_assignments: unknown;
  staffing_impact_summary: unknown;
  coverage_found: boolean;
  crosses_protected_date: boolean;
  protected_date_severity: ProtectedDateSeverity;
  live_operational_absence_state: LiveOperationalAbsenceState | null;
  warning_level: "low" | "medium" | "high" | "critical";
  requested_recurring_rule: unknown;
  user_name?: string | null;
  approver_name?: string | null;
  decided_by_name?: string | null;
};

export type AvailabilityWindow = {
  user_id: string;
  source_id: string;
  source_kind: "request" | "blocked_date" | "availability_rule";
  availability_state:
    | "approved_time_off"
    | "sick_same_day_absence"
    | "blocked_by_manager_admin"
    | "company_holiday_closed"
    | "availability_restriction"
    | "submitted_request_warning";
  label: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  warning_only: boolean;
  request_status?: AvailabilityRequestStatus | null;
  request_type?: AvailabilityRequestType | null;
  severity: "low" | "medium" | "high" | "critical";
};

type ScheduleScopeUser = {
  id: string;
  department: string;
};

type ScheduleAvailabilityItem = {
  item_kind: "availability";
  id: string;
  date_key: string;
  title: string;
  department: string;
  availability_kind: "request" | "blocked_date" | "absence";
  status: AvailabilityRequestStatus | "blocked";
  starts_at: string | null;
  ends_at: string | null;
  user_id: string | null;
  user_name: string | null;
  location_name: string | null;
  request_type: string | null;
  reason_category: string | null;
  note: string | null;
  warning_level: "low" | "medium" | "high" | "critical";
  impacted_assignment_count: number;
  minimum_staffing_break_count: number;
  lead_coverage_break_count: number;
  coverage_found: boolean;
  protected_date_severity: ProtectedDateSeverity;
  live_operational_absence_state: string | null;
  badge_label: string | null;
};

function pushValue(values: unknown[], value: unknown) {
  values.push(value);
  return `$${values.length}`;
}

function channelsForPriority(priority: "normal" | "high" | "critical"): NotificationChannel[] {
  if (priority === "critical") {
    return ["in_app", "push", "sms", "email"];
  }
  if (priority === "high") {
    return ["in_app", "push", "email"];
  }
  return ["in_app"];
}

function parseDateOnly(value: string) {
  return new Date(`${value}T12:00:00`);
}

function addDays(value: Date, days: number) {
  const next = new Date(value.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function formatDateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function enumerateDateRange(startDate: string, endDate: string) {
  const dates: string[] = [];
  let cursor = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  while (cursor <= end) {
    dates.push(formatDateOnly(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function startOfDayIso(date: string) {
  return new Date(`${date}T00:00:00`).toISOString();
}

function endOfDayIso(date: string) {
  return new Date(`${date}T23:59:59`).toISOString();
}

function timeToIso(date: string, time: string | null | undefined, fallback: "start" | "end") {
  const value = time?.trim();
  if (!value) {
    return fallback === "start" ? startOfDayIso(date) : endOfDayIso(date);
  }
  const normalized = value.length === 5 ? `${value}:00` : value;
  return new Date(`${date}T${normalized}`).toISOString();
}

function normalizeWeekdays(values?: number[] | null) {
  return [...new Set((values ?? []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0 && value <= 6))];
}

function requestTypeLabel(value: string | null | undefined) {
  switch (value) {
    case "full_day_off":
      return "Full Day Off";
    case "partial_day_off":
      return "Partial Day Off";
    case "multi_day_off":
      return "Multi-Day Off";
    case "sick_illness":
      return "Sick / Illness";
    case "personal_appointment":
      return "Personal / Appointment";
    case "unavailable_for_assignment":
      return "Unavailable for Assignment";
    case "availability_restriction_update":
      return "Availability Restriction Update";
    case "company_holiday":
      return "Company Holiday";
    case "manager_blocked_day":
      return "Manager Blocked Day";
    case "training_meeting_hold":
      return "Training / Meeting Hold";
    case "admin_unavailable":
      return "Admin Unavailable";
    case "protected_blackout":
      return "Protected Blackout";
    default:
      return "Availability Request";
  }
}

function humanizeRequestStatus(value: string) {
  switch (value) {
    case "rejected":
      return "Rejected";
    case "cancelled_by_employee":
      return "Cancelled by Employee";
    case "cancelled_by_manager_admin":
      return "Cancelled by Manager/Admin";
    case "needs_review":
      return "Needs Review";
    default:
      return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }
}

function isEmployeeSubmittableRequestType(value: AvailabilityRequestType) {
  return [
    "full_day_off",
    "partial_day_off",
    "multi_day_off",
    "sick_illness",
    "personal_appointment",
    "unavailable_for_assignment",
    "availability_restriction_update"
  ].includes(value);
}

function isBlockedDateRequestType(value: AvailabilityRequestType) {
  return [
    "company_holiday",
    "manager_blocked_day",
    "training_meeting_hold",
    "admin_unavailable",
    "protected_blackout"
  ].includes(value);
}

function isSameDayAbsenceType(value: AvailabilityRequestType) {
  return value === "sick_illness";
}

function normalizedReasonNote(input: AvailabilityRequestInput) {
  return input.note?.trim() || input.reason?.trim() || null;
}

function normalizeRequestCreateInput(input: AvailabilityRequestInput) {
  const requestType = (input.request_type ??
    (input.request_unit === "half_day"
      ? "partial_day_off"
      : input.start_date && input.end_date && input.start_date !== input.end_date
        ? "multi_day_off"
        : "full_day_off")) as AvailabilityRequestType;
  const startDate = input.start_date ?? input.requested_on;
  if (!startDate) {
    throw new ApiError(400, "Choose a start date for the request.");
  }
  const endDate = input.end_date ?? startDate;
  const allDay = input.all_day ?? input.request_unit !== "half_day";
  if (!allDay && (!input.start_time || !input.end_time)) {
    throw new ApiError(400, "Partial-day requests need both start and end times.");
  }
  if (!availabilityRequestTypes.includes(requestType)) {
    throw new ApiError(400, "Unsupported request type.");
  }
  if (!isEmployeeSubmittableRequestType(requestType) && !isBlockedDateRequestType(requestType)) {
    throw new ApiError(400, "Unsupported request type.");
  }
  if (requestType === "availability_restriction_update" && input.recurring_rule) {
    if (!recurringAvailabilityRuleTypes.includes(input.recurring_rule.rule_type)) {
      throw new ApiError(400, "Unsupported recurring availability rule.");
    }
  }
  return {
    requestType,
    startDate,
    endDate,
    allDay,
    startTime: allDay ? null : input.start_time?.trim() ?? null,
    endTime: allDay ? null : input.end_time?.trim() ?? null,
    reasonCategory: input.reason_category?.trim() || null,
    employeeNote: normalizedReasonNote(input),
    recurringRule: input.recurring_rule ?? null
  };
}

function countRequestHours(startDate: string, endDate: string, allDay: boolean, startTime: string | null, endTime: string | null) {
  if (allDay) {
    return Number((enumerateDateRange(startDate, endDate).length * 7.5).toFixed(1));
  }
  if (!startTime || !endTime) {
    return 0;
  }
  const start = new Date(`${startDate}T${startTime.length === 5 ? `${startTime}:00` : startTime}`);
  const end = new Date(`${endDate}T${endTime.length === 5 ? `${endTime}:00` : endTime}`);
  if (end <= start) {
    throw new ApiError(400, "Partial-day requests need an end time after the start time.");
  }
  return Number((((end.getTime() - start.getTime()) / 1000 / 60 / 60) || 0).toFixed(1));
}

function resolveRequestUnit(allDay: boolean) {
  return allDay ? "full_day" : "half_day";
}

function requestWindowOverlapsShift(
  request: { startDate: string; endDate: string; allDay: boolean; startTime: string | null; endTime: string | null },
  shift: { starts_at: string; ends_at: string }
) {
  if (request.allDay) {
    return shift.starts_at.slice(0, 10) <= request.endDate && shift.ends_at.slice(0, 10) >= request.startDate;
  }
  const requestStart = timeToIso(request.startDate, request.startTime, "start");
  const requestEnd = timeToIso(request.endDate, request.endTime, "end");
  return new Date(shift.starts_at).getTime() < new Date(requestEnd).getTime() && new Date(shift.ends_at).getTime() > new Date(requestStart).getTime();
}

function normalizeImpactSummary(value: unknown): AvailabilityImpactSummary {
  if (!value || typeof value !== "object") {
    return {
      affected_assignment_count: 0,
      published_assignment_count: 0,
      minimum_staffing_break_count: 0,
      lead_coverage_break_count: 0,
      protected_date_count: 0,
      protected_date_severity: null,
      staffing_risk: "none",
      same_day_request: false,
      coverage_needed: false,
      escalation_required: false
    };
  }
  const record = value as Record<string, unknown>;
  return {
    affected_assignment_count: Number(record.affected_assignment_count ?? 0),
    published_assignment_count: Number(record.published_assignment_count ?? 0),
    minimum_staffing_break_count: Number(record.minimum_staffing_break_count ?? 0),
    lead_coverage_break_count: Number(record.lead_coverage_break_count ?? 0),
    protected_date_count: Number(record.protected_date_count ?? 0),
    protected_date_severity:
      record.protected_date_severity === "soft" || record.protected_date_severity === "hard"
        ? record.protected_date_severity
        : null,
    staffing_risk:
      record.staffing_risk === "warning" || record.staffing_risk === "high" || record.staffing_risk === "critical"
        ? record.staffing_risk
        : "none",
    same_day_request: Boolean(record.same_day_request),
    coverage_needed: Boolean(record.coverage_needed),
    escalation_required: Boolean(record.escalation_required)
  };
}

function normalizeAssignments(value: unknown) {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

async function loadOverlappingProtectedDates(
  client: PoolClient,
  input: { tenantId: string; userId: string; department: string; startDate: string; endDate: string }
) {
  const { rows } = await client.query<{
    id: string;
    block_type: BlockedDateType;
    block_severity: "soft" | "hard";
    label: string;
    starts_at: string;
    ends_at: string;
  }>(
    `
      SELECT id, block_type, block_severity, label, starts_at::text, ends_at::text
      FROM staffing_blocked_date
      WHERE tenant_id = $1
        AND starts_at::date <= $2::date
        AND ends_at::date >= $3::date
        AND (
          target_scope = 'company'
          OR (target_scope = 'department' AND target_department = $4::department_code)
          OR (target_scope = 'user' AND target_user_id = $5::uuid)
        )
      ORDER BY starts_at ASC
    `,
    [input.tenantId, input.endDate, input.startDate, input.department, input.userId]
  );
  return rows;
}

async function evaluateRequestImpact(
  client: PoolClient,
  input: {
    tenantId: string;
    userId: string;
    department: string;
    startDate: string;
    endDate: string;
    allDay: boolean;
    startTime: string | null;
    endTime: string | null;
  }
) {
  const shiftRows = await client.query<{
    id: string;
    shoot_id: string | null;
    title: string;
    starts_at: string;
    ends_at: string;
    status: string;
    staffing_role: string | null;
    satisfies_lead_coverage: boolean;
    location_name: string | null;
    shoot_code: string | null;
    shoot_title: string | null;
    minimum_staff_count: number | null;
    planned_staff_count: number | null;
    required_lead_count: number | null;
    assigned_staff_count: number | null;
    lead_staff_count: number | null;
  }>(
    `
      SELECT
        ws.id,
        ws.shoot_id,
        ws.title,
        ws.starts_at::text,
        ws.ends_at::text,
        ws.status::text,
        ws.staffing_role::text,
        ws.satisfies_lead_coverage,
        ws.location_name,
        s.shoot_code,
        s.title AS shoot_title,
        s.minimum_staff_count,
        s.planned_staff_count,
        s.required_lead_count,
        (
          SELECT COUNT(*)
          FROM work_shift other
          WHERE other.tenant_id = ws.tenant_id
            AND other.shoot_id = ws.shoot_id
            AND other.cancelled_at IS NULL
            AND other.status IN ('draft', 'published', 'completed')
        )::int AS assigned_staff_count,
        (
          SELECT COUNT(*)
          FROM work_shift other
          WHERE other.tenant_id = ws.tenant_id
            AND other.shoot_id = ws.shoot_id
            AND other.cancelled_at IS NULL
            AND other.status IN ('draft', 'published', 'completed')
            AND other.satisfies_lead_coverage = true
        )::int AS lead_staff_count
      FROM work_shift ws
      LEFT JOIN shoot s
        ON s.id = ws.shoot_id
       AND s.tenant_id = ws.tenant_id
      WHERE ws.tenant_id = $1
        AND ws.assigned_user_id = $2
        AND ws.cancelled_at IS NULL
        AND ws.status IN ('draft', 'published', 'completed')
        AND ws.ends_at::date >= $3::date
        AND ws.starts_at::date <= $4::date
      ORDER BY ws.starts_at ASC
    `,
    [input.tenantId, input.userId, input.startDate, input.endDate]
  );

  const affectedAssignments = shiftRows.rows
    .filter((row) =>
      requestWindowOverlapsShift(
        {
          startDate: input.startDate,
          endDate: input.endDate,
          allDay: input.allDay,
          startTime: input.startTime,
          endTime: input.endTime
        },
        row
      )
    )
    .map((row) => {
      const minimumStaffCount = Number(row.minimum_staff_count ?? 0);
      const assignedStaffCount = Number(row.assigned_staff_count ?? 0);
      const requiredLeadCount = Math.max(Number(row.required_lead_count ?? 1), 1);
      const leadStaffCount = Number(row.lead_staff_count ?? 0);
      const minimumBreak = Boolean(row.shoot_id) && minimumStaffCount > 0 && assignedStaffCount - 1 < minimumStaffCount;
      const leadBreak = Boolean(row.shoot_id) && Boolean(row.satisfies_lead_coverage) && leadStaffCount - 1 < requiredLeadCount;
      return {
        shift_id: row.id,
        shoot_id: row.shoot_id,
        shoot_code: row.shoot_code,
        shoot_title: row.shoot_title,
        title: row.title,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        status: row.status,
        staffing_role: row.staffing_role,
        location_name: row.location_name,
        lead_coverage_break: leadBreak,
        minimum_staffing_break: minimumBreak,
        published: row.status === "published"
      };
    });

  const protectedDates = await loadOverlappingProtectedDates(client, {
    tenantId: input.tenantId,
    userId: input.userId,
    department: input.department,
    startDate: input.startDate,
    endDate: input.endDate
  });

  const leadBreakCount = affectedAssignments.filter((assignment) => assignment.lead_coverage_break).length;
  const minimumBreakCount = affectedAssignments.filter((assignment) => assignment.minimum_staffing_break).length;
  const publishedCount = affectedAssignments.filter((assignment) => assignment.published).length;
  const protectedSeverity: ProtectedDateSeverity = protectedDates.some((row) => row.block_severity === "hard")
    ? "hard"
    : protectedDates.some((row) => row.block_severity === "soft")
      ? "soft"
      : null;
  const sameDayRequest = input.startDate <= getLocalDateString() && input.endDate >= getLocalDateString();
  const staffingRisk: AvailabilityImpactSummary["staffing_risk"] =
    protectedSeverity === "hard" || leadBreakCount > 0
      ? "critical"
      : minimumBreakCount > 0 || sameDayRequest || publishedCount > 0
        ? "high"
        : protectedDates.length > 0 || affectedAssignments.length > 0
          ? "warning"
          : "none";

  const summary: AvailabilityImpactSummary = {
    affected_assignment_count: affectedAssignments.length,
    published_assignment_count: publishedCount,
    minimum_staffing_break_count: minimumBreakCount,
    lead_coverage_break_count: leadBreakCount,
    protected_date_count: protectedDates.length,
    protected_date_severity: protectedSeverity,
    staffing_risk: staffingRisk,
    same_day_request: sameDayRequest,
    coverage_needed: affectedAssignments.length > 0,
    escalation_required: protectedSeverity === "hard" || leadBreakCount > 0 || minimumBreakCount > 0
  };

  const warningLevel: AvailabilityRequestRow["warning_level"] =
    staffingRisk === "critical"
      ? "critical"
      : staffingRisk === "high"
        ? "high"
        : staffingRisk === "warning"
          ? "medium"
          : "low";

  return {
    assignments: affectedAssignments,
    protectedDates,
    summary,
    warningLevel,
    crossesProtectedDate: protectedDates.length > 0,
    protectedDateSeverity: protectedSeverity
  };
}

function isLeadershipOnlyRequest(input: {
  requestType: AvailabilityRequestType;
  protectedDateSeverity: ProtectedDateSeverity;
}) {
  return input.requestType === "protected_blackout" || input.protectedDateSeverity === "hard";
}

async function upsertAvailabilityRuleFromRequest(
  client: PoolClient,
  auth: AuthUser,
  request: AvailabilityRequestRow
) {
  const rawRule = (request.requested_recurring_rule ?? {}) as Record<string, unknown>;
  const ruleType = rawRule.rule_type;
  if (request.request_type !== "availability_restriction_update" || typeof ruleType !== "string") {
    return null;
  }
  if (!recurringAvailabilityRuleTypes.includes(ruleType as RecurringAvailabilityRuleType)) {
    return null;
  }
  const weekdays = normalizeWeekdays(Array.isArray(rawRule.weekdays) ? rawRule.weekdays.map((value) => Number(value)) : []);
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO employee_availability_rule (
        tenant_id,
        user_id,
        request_id,
        department,
        rule_type,
        weekdays,
        start_time,
        end_time,
        season_start,
        season_end,
        note,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6::smallint[],$7::time,$8::time,$9::date,$10::date,$11,$12,$12)
      RETURNING id
    `,
    [
      auth.tenantId,
      request.user_id,
      request.id,
      request.department,
      ruleType,
      weekdays,
      typeof rawRule.start_time === "string" ? rawRule.start_time : null,
      typeof rawRule.end_time === "string" ? rawRule.end_time : null,
      typeof rawRule.season_start === "string" ? rawRule.season_start : null,
      typeof rawRule.season_end === "string" ? rawRule.season_end : null,
      request.reason ?? request.notes ?? null,
      auth.id
    ]
  );
  return rows[0]?.id ?? null;
}

async function mapRequestRow(client: PoolClient, row: AvailabilityRequestRow) {
  return {
    ...row,
    requested_hours: Number(row.requested_hours ?? 0),
    impacted_assignments: normalizeAssignments(row.impacted_assignments),
    staffing_impact_summary: normalizeImpactSummary(row.staffing_impact_summary),
    human_status_label: humanizeRequestStatus(row.status),
    human_request_type_label: requestTypeLabel(row.request_type)
  };
}

async function getAvailabilityRequestById(client: PoolClient, requestId: string) {
  const { rows } = await client.query<AvailabilityRequestRow>(
    `
      SELECT
        pto.*,
        au.full_name AS user_name,
        approver.full_name AS approver_name,
        decider.full_name AS decided_by_name
      FROM pto_request pto
      JOIN app_user au
        ON au.id = pto.user_id
      LEFT JOIN app_user approver
        ON approver.id = pto.approver_user_id
      LEFT JOIN app_user decider
        ON decider.id = COALESCE(pto.decided_by_user_id, pto.canceled_by_user_id)
      WHERE pto.id = $1
      LIMIT 1
    `,
    [requestId]
  );
  return rows[0] ?? null;
}

export async function syncAvailabilityImpactsForUser(
  client: PoolClient,
  input: { tenantId: string; userId: string }
) {
  const { rows } = await client.query<AvailabilityRequestRow>(
    `
      SELECT *
      FROM pto_request
      WHERE tenant_id = $1
        AND user_id = $2
        AND status IN ('submitted', 'approved', 'needs_review')
      ORDER BY created_at ASC
    `,
    [input.tenantId, input.userId]
  );

  for (const row of rows) {
    const impact = await evaluateRequestImpact(client, {
      tenantId: input.tenantId,
      userId: row.user_id,
      department: row.department,
      startDate: row.starts_on,
      endDate: row.ends_on,
      allDay: Boolean(row.all_day),
      startTime: row.start_time,
      endTime: row.end_time
    });

    await client.query(
      `
        UPDATE pto_request
        SET impacted_assignments = $2::jsonb,
            staffing_impact_summary = $3::jsonb,
            warning_level = $4,
            crosses_protected_date = $5,
            protected_date_severity = $6,
            updated_at = now()
        WHERE id = $1
      `,
      [
        row.id,
        JSON.stringify(impact.assignments),
        JSON.stringify(impact.summary),
        impact.warningLevel,
        impact.crossesProtectedDate,
        impact.protectedDateSeverity
      ]
    );
  }
}

export async function createAvailabilityRequest(
  client: PoolClient,
  auth: AuthUser,
  input: AvailabilityRequestInput,
  meta: RequestMeta
) {
  const normalized = normalizeRequestCreateInput(input);
  if (!isEmployeeSubmittableRequestType(normalized.requestType) && !hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "supervisor"])) {
    throw new ApiError(403, "Only managers or leadership can create protected or blocked-day requests directly.");
  }

  const impact = await evaluateRequestImpact(client, {
    tenantId: auth.tenantId,
    userId: auth.id,
    department: auth.department,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    allDay: normalized.allDay,
    startTime: normalized.startTime,
    endTime: normalized.endTime
  });

  const sameDayAbsence = isSameDayAbsenceType(normalized.requestType) && normalized.startDate <= getLocalDateString() && normalized.endDate >= getLocalDateString();
  const forceLeadershipOnly = isLeadershipOnlyRequest({
    requestType: normalized.requestType,
    protectedDateSeverity: impact.protectedDateSeverity
  });
  const approverResolution = await resolvePTOApproverUserIds(client, {
    tenantId: auth.tenantId,
    department: auth.department,
    forceLeadershipOnly
  });

  const submittedStatus: AvailabilityRequestStatus = sameDayAbsence ? "needs_review" : "submitted";
  const liveAbsenceState: LiveOperationalAbsenceState | null = sameDayAbsence ? "reported_absent" : null;
  const requestedHours = countRequestHours(
    normalized.startDate,
    normalized.endDate,
    normalized.allDay,
    normalized.startTime,
    normalized.endTime
  );

  const { rows } = await client.query<AvailabilityRequestRow>(
    `
      INSERT INTO pto_request (
        tenant_id,
        user_id,
        department,
        starts_on,
        ends_on,
        partial_day,
        reason,
        status,
        requested_on,
        request_unit,
        requested_hours,
        approval_routing_policy_code,
        approver_user_id,
        notes,
        request_type,
        all_day,
        start_time,
        end_time,
        reason_category,
        submitted_at,
        impacted_assignments,
        staffing_impact_summary,
        coverage_found,
        crosses_protected_date,
        protected_date_severity,
        live_operational_absence_state,
        warning_level,
        requested_recurring_rule
      )
      VALUES (
        $1,$2,$3,$4::date,$5::date,$6,$7,$8,$9::date,$10,$11,$12,$13,$14,$15,$16,$17::time,$18::time,$19,now(),
        $20::jsonb,$21::jsonb,$22,$23,$24,$25,$26,$27::jsonb
      )
      RETURNING *
    `,
    [
      auth.tenantId,
      auth.id,
      auth.department,
      normalized.startDate,
      normalized.endDate,
      !normalized.allDay,
      normalized.employeeNote,
      submittedStatus,
      normalized.startDate,
      resolveRequestUnit(normalized.allDay),
      requestedHours,
      approverResolution.policy.policy_code,
      approverResolution.primaryApproverUserId,
      null,
      normalized.requestType,
      normalized.allDay,
      normalized.startTime,
      normalized.endTime,
      normalized.reasonCategory,
      JSON.stringify(impact.assignments),
      JSON.stringify(impact.summary),
      false,
      impact.crossesProtectedDate,
      impact.protectedDateSeverity,
      liveAbsenceState,
      impact.warningLevel,
      JSON.stringify(normalized.recurringRule ?? {})
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: auth.id,
    action: sameDayAbsence ? "schedule.absence.reported" : "schedule.availability.requested",
    entityType: "pto_request",
    entityId: rows[0].id,
    metadata: {
      request_type: normalized.requestType,
      start_date: normalized.startDate,
      end_date: normalized.endDate,
      all_day: normalized.allDay,
      start_time: normalized.startTime,
      end_time: normalized.endTime,
      requested_hours: requestedHours,
      warning_level: impact.warningLevel,
      staffing_impact_summary: impact.summary,
      protected_date_severity: impact.protectedDateSeverity,
      live_operational_absence_state: liveAbsenceState
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  const recipients = await findNotificationRecipients(client, {
    tenantId: auth.tenantId,
    eventCode: sameDayAbsence ? "schedule.same_day_absence_reported" : "schedule.pto_requested",
    directUserIds: approverResolution.approverUserIds,
    excludeUserIds: [auth.id]
  });
  const priority = sameDayAbsence || impact.warningLevel === "critical" ? "critical" : impact.warningLevel === "high" ? "high" : "normal";
  await queueNotificationDispatch(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    recipientUserIds: recipients,
    notificationType: sameDayAbsence ? "schedule.same_day_absence_reported" : "schedule.pto_requested",
    title: sameDayAbsence ? "Same-day absence reported" : `${requestTypeLabel(normalized.requestType)} submitted`,
    body: sameDayAbsence
      ? `${auth.fullName} reported a same-day absence for ${normalized.startDate}. Review coverage impact now.`
      : `${auth.fullName} submitted ${requestTypeLabel(normalized.requestType).toLowerCase()} for ${normalized.startDate}${normalized.endDate !== normalized.startDate ? ` through ${normalized.endDate}` : ""}.`,
    priority,
    deepLink: "/approvals?queue=pto",
    relatedUserId: auth.id,
    channels: channelsForPriority(priority),
    metadata: {
      dedupe: rows[0].id,
      request_type: normalized.requestType,
      warning_level: impact.warningLevel
    }
  });

  return mapRequestRow(client, rows[0]);
}

export async function reviewAvailabilityRequest(
  client: PoolClient,
  auth: AuthUser,
  requestId: string,
  input: AvailabilityRequestReviewInput,
  meta: RequestMeta
) {
  const request = await getAvailabilityRequestById(client, requestId);
  if (!request) {
    throw new ApiError(404, "Availability request not found");
  }
  if (!["submitted", "needs_review"].includes(request.status)) {
    throw new ApiError(409, "This request is no longer waiting on review.");
  }
  if (
    !(await canUserApprovePTORequest(client, auth, {
      requesterUserId: request.user_id,
      department: request.department
    }))
  ) {
    throw new ApiError(403, "Manager or leadership approval is required for this request.");
  }
  if (isLeadershipOnlyRequest({ requestType: request.request_type, protectedDateSeverity: request.protected_date_severity }) && !hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Leadership or admin approval is required for protected blackout or hard-block requests.");
  }

  const nextLiveState =
    input.live_operational_absence_state ??
    (request.live_operational_absence_state
      ? input.status === "approved"
        ? "excused"
        : input.status === "rejected"
          ? "unexcused"
          : "pending_coverage_review"
      : null);

  const { rows } = await client.query<AvailabilityRequestRow>(
    `
      UPDATE pto_request
      SET status = $2,
          decided_by_user_id = $3,
          decided_at = now(),
          notes = $4,
          live_operational_absence_state = $5,
          updated_at = now()
      WHERE id = $1
      RETURNING *
    `,
    [requestId, input.status, auth.id, input.notes ?? null, nextLiveState]
  );
  const updated = rows[0];

  if (input.status === "approved") {
    await upsertAvailabilityRuleFromRequest(client, auth, updated);
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: request.user_id,
    action: input.status === "approved" ? "schedule.availability.approved" : input.status === "rejected" ? "schedule.availability.rejected" : "schedule.availability.needs_review",
    entityType: "pto_request",
    entityId: requestId,
    metadata: {
      request_type: request.request_type,
      start_date: request.starts_on,
      end_date: request.ends_on,
      approval_note: input.notes ?? null,
      live_operational_absence_state: nextLiveState
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  const recipients = await findNotificationRecipients(client, {
    tenantId: auth.tenantId,
    eventCode: input.status === "approved" ? "schedule.pto_approved" : "schedule.pto_rejected",
    directUserIds: [request.user_id],
    excludeUserIds: [auth.id]
  });
  const priority = updated.warning_level === "critical" ? "critical" : updated.warning_level === "high" ? "high" : "normal";
  await queueNotificationDispatch(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    recipientUserIds: recipients,
    notificationType: input.status === "approved" ? "schedule.pto_approved" : input.status === "rejected" ? "schedule.pto_rejected" : "schedule.pto_review_pending",
    title:
      input.status === "approved"
        ? `${requestTypeLabel(request.request_type)} approved`
        : input.status === "rejected"
          ? `${requestTypeLabel(request.request_type)} rejected`
          : `${requestTypeLabel(request.request_type)} needs review`,
    body:
      input.status === "approved"
        ? `${requestTypeLabel(request.request_type)} for ${request.starts_on} is approved.`
        : input.status === "rejected"
          ? `${requestTypeLabel(request.request_type)} for ${request.starts_on} was rejected.`
          : `${requestTypeLabel(request.request_type)} for ${request.starts_on} still needs review.`,
    priority,
    deepLink: "/approvals?queue=pto",
    relatedUserId: request.user_id,
    channels: channelsForPriority(priority),
    metadata: { dedupe: requestId }
  });

  return mapRequestRow(client, updated);
}

export async function cancelAvailabilityRequest(
  client: PoolClient,
  auth: AuthUser,
  requestId: string,
  meta: RequestMeta
) {
  const request = await getAvailabilityRequestById(client, requestId);
  if (!request) {
    throw new ApiError(404, "Availability request not found");
  }

  const requesterOwnsRequest = request.user_id === auth.id;
  const canManagerCancel =
    !requesterOwnsRequest &&
    ((await canUserApprovePTORequest(client, auth, {
      requesterUserId: request.user_id,
      department: request.department
    })) ||
      hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]));

  if (!requesterOwnsRequest && !canManagerCancel) {
    throw new ApiError(403, "Only the employee or an authorized manager can cancel this request.");
  }
  if (!["draft", "submitted", "approved", "needs_review"].includes(request.status)) {
    throw new ApiError(409, "This request can no longer be cancelled.");
  }

  const nextStatus: AvailabilityRequestStatus = requesterOwnsRequest ? "cancelled_by_employee" : "cancelled_by_manager_admin";
  const { rows } = await client.query<AvailabilityRequestRow>(
    `
      UPDATE pto_request
      SET status = $2,
          canceled_by_user_id = $3,
          canceled_at = now(),
          updated_at = now()
      WHERE id = $1
      RETURNING *
    `,
    [requestId, nextStatus, auth.id]
  );
  const updated = rows[0];

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: request.user_id,
    action: requesterOwnsRequest ? "schedule.availability.cancelled_by_employee" : "schedule.availability.cancelled_by_manager",
    entityType: "pto_request",
    entityId: requestId,
    metadata: {
      request_type: request.request_type,
      prior_status: request.status,
      next_status: nextStatus
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  const directUserIds = requesterOwnsRequest
    ? request.approver_user_id
      ? [request.approver_user_id]
      : []
    : [request.user_id];
  if (directUserIds.length) {
    await queueNotificationDispatch(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      recipientUserIds: directUserIds,
      notificationType: "schedule.pto_cancelled",
      title: `${requestTypeLabel(request.request_type)} cancelled`,
      body: requesterOwnsRequest
        ? `${auth.fullName} cancelled a submitted availability request for ${request.starts_on}.`
        : `${auth.fullName} cancelled ${requestTypeLabel(request.request_type).toLowerCase()} for ${request.starts_on}.`,
      priority: "normal",
      deepLink: "/approvals?queue=pto",
      relatedUserId: request.user_id,
      channels: channelsForPriority("normal"),
      metadata: { dedupe: requestId }
    });
  }

  return mapRequestRow(client, updated);
}

export async function listAvailabilityRequests(client: PoolClient, auth: AuthUser, status?: string | null) {
  const values: unknown[] = [auth.tenantId];
  const where = ["pto.tenant_id = $1"];

  if (status) {
    values.push(status === "canceled" || status === "cancelled" ? "cancelled_by_employee" : status);
    where.push(`pto.status = $${values.length}`);
  }
  if (shouldRestrictShiftList(auth)) {
    values.push(auth.id);
    where.push(`(pto.user_id = $${values.length} OR pto.approver_user_id = $${values.length})`);
  } else if (shouldDepartmentScopeShiftList(auth)) {
    values.push(auth.department);
    const departmentToken = `$${values.length}`;
    const approverToken = pushValue(values, auth.id);
    where.push(`(pto.department = ${departmentToken}::department_code OR pto.approver_user_id = ${approverToken})`);
  }

  const { rows } = await client.query<AvailabilityRequestRow>(
    `
      SELECT
        pto.*,
        au.full_name AS user_name,
        approver.full_name AS approver_name,
        decider.full_name AS decided_by_name
      FROM pto_request pto
      JOIN app_user au
        ON au.id = pto.user_id
      LEFT JOIN app_user approver
        ON approver.id = pto.approver_user_id
      LEFT JOIN app_user decider
        ON decider.id = COALESCE(pto.decided_by_user_id, pto.canceled_by_user_id)
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(pto.submitted_at, pto.created_at) DESC
    `,
    values
  );
  return Promise.all(rows.map((row) => mapRequestRow(client, row)));
}

export async function exportAvailabilityRequestsCsv(
  client: PoolClient,
  auth: AuthUser,
  filters: { status?: string | null; dateFrom?: string | null; dateTo?: string | null } = {}
) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Leadership or directors can export requests.");
  }
  const values: unknown[] = [auth.tenantId];
  const where = ["pto.tenant_id = $1"];
  if (filters.status) {
    values.push(filters.status === "canceled" || filters.status === "cancelled" ? "cancelled_by_employee" : filters.status);
    where.push(`pto.status = $${values.length}`);
  }
  if (filters.dateFrom) {
    values.push(filters.dateFrom);
    where.push(`pto.ends_on >= $${values.length}::date`);
  }
  if (filters.dateTo) {
    values.push(filters.dateTo);
    where.push(`pto.starts_on <= $${values.length}::date`);
  }
  const { rows } = await client.query<AvailabilityRequestRow & { user_name: string; approver_name: string | null }>(
    `
      SELECT
        pto.*,
        au.full_name AS user_name,
        approver.full_name AS approver_name
      FROM pto_request pto
      JOIN app_user au ON au.id = pto.user_id
      LEFT JOIN app_user approver ON approver.id = pto.approver_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY pto.starts_on ASC, au.full_name ASC
    `,
    values
  );
  const header = [
    "employee_name",
    "department",
    "request_type",
    "status",
    "start_date",
    "end_date",
    "all_day",
    "requested_hours",
    "warning_level",
    "approver_name",
    "lead_coverage_break_count",
    "minimum_staffing_break_count",
    "affected_assignment_count"
  ];
  const lines = rows.map((row) => {
    const summary = normalizeImpactSummary(row.staffing_impact_summary);
    return [
      row.user_name ?? "",
      row.department,
      requestTypeLabel(row.request_type),
      humanizeRequestStatus(row.status),
      row.starts_on,
      row.ends_on,
      row.all_day ? "Yes" : "No",
      Number(row.requested_hours ?? 0).toFixed(1),
      row.warning_level,
      row.approver_name ?? "",
      String(summary.lead_coverage_break_count),
      String(summary.minimum_staffing_break_count),
      String(summary.affected_assignment_count)
    ]
      .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
      .join(",");
  });
  await client.query("UPDATE pto_request SET exported_at = now() WHERE tenant_id = $1", [auth.tenantId]);
  return [header.join(","), ...lines].join("\n");
}

export async function listAvailabilityRules(client: PoolClient, auth: AuthUser, userId?: string | null) {
  const values: unknown[] = [auth.tenantId];
  const where = ["tenant_id = $1", "status = 'active'"];
  if (userId) {
    values.push(userId);
    where.push(`user_id = $${values.length}`);
  } else if (shouldRestrictShiftList(auth)) {
    values.push(auth.id);
    where.push(`user_id = $${values.length}`);
  } else if (shouldDepartmentScopeShiftList(auth)) {
    values.push(auth.department);
    where.push(`department = $${values.length}::department_code`);
  }
  const { rows } = await client.query(
    `
      SELECT *
      FROM employee_availability_rule
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
    `,
    values
  );
  return rows;
}

export async function createAvailabilityRule(
  client: PoolClient,
  auth: AuthUser,
  input: AvailabilityRuleCreateInput,
  meta: RequestMeta
) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "supervisor"])) {
    throw new ApiError(403, "Manager-level authority is required to create recurring availability rules directly.");
  }
  const weekdays = normalizeWeekdays(input.weekdays);
  const { rows } = await client.query(
    `
      INSERT INTO employee_availability_rule (
        tenant_id,
        user_id,
        department,
        rule_type,
        weekdays,
        start_time,
        end_time,
        season_start,
        season_end,
        note,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5::smallint[],$6::time,$7::time,$8::date,$9::date,$10,$11,$11)
      RETURNING *
    `,
    [
      auth.tenantId,
      input.user_id,
      input.department ?? auth.department,
      input.rule_type,
      weekdays,
      input.start_time ?? null,
      input.end_time ?? null,
      input.season_start ?? null,
      input.season_end ?? null,
      input.note ?? null,
      auth.id
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: input.user_id,
    action: "schedule.availability_rule.created",
    entityType: "employee_availability_rule",
    entityId: rows[0].id,
    metadata: {
      rule_type: input.rule_type,
      weekdays,
      start_time: input.start_time ?? null,
      end_time: input.end_time ?? null
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });
  return rows[0];
}

export async function listBlockedDates(client: PoolClient, auth: AuthUser) {
  const values: unknown[] = [auth.tenantId];
  const where = ["tenant_id = $1"];
  if (shouldRestrictShiftList(auth)) {
    const userToken = pushValue(values, auth.id);
    const departmentToken = pushValue(values, auth.department);
    where.push(`(target_scope = 'company' OR (target_scope = 'department' AND target_department = ${departmentToken}::department_code) OR (target_scope = 'user' AND target_user_id = ${userToken}::uuid))`);
  } else if (shouldDepartmentScopeShiftList(auth)) {
    values.push(auth.department);
    where.push(`(target_scope = 'company' OR (target_scope = 'department' AND target_department = $${values.length}::department_code))`);
  }
  const { rows } = await client.query(
    `
      SELECT *
      FROM staffing_blocked_date
      WHERE ${where.join(" AND ")}
      ORDER BY starts_at ASC
    `,
    values
  );
  return rows;
}

export async function createBlockedDate(
  client: PoolClient,
  auth: AuthUser,
  input: BlockedDateCreateInput,
  meta: RequestMeta
) {
  const managerLevel = hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "supervisor"]);
  if (!managerLevel) {
    throw new ApiError(403, "Manager-level authority is required to create blocked dates.");
  }
  const leadershipOnly =
    input.target_scope === "company" ||
    input.block_type === "company_holiday" ||
    input.block_type === "protected_blackout" ||
    input.block_severity === "hard";
  if (leadershipOnly && !hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Leadership or admin authority is required for company-wide or hard blackout dates.");
  }
  const { rows } = await client.query(
    `
      INSERT INTO staffing_blocked_date (
        tenant_id,
        target_scope,
        target_department,
        target_user_id,
        block_type,
        block_severity,
        label,
        starts_at,
        ends_at,
        approval_required,
        note,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10,$11,$12,$12)
      RETURNING *
    `,
    [
      auth.tenantId,
      input.target_scope,
      input.target_scope === "department" ? input.target_department ?? auth.department : null,
      input.target_scope === "user" ? input.target_user_id ?? null : null,
      input.block_type,
      input.block_severity ?? "soft",
      input.label,
      input.starts_at,
      input.ends_at,
      Boolean(input.approval_required ?? input.block_severity === "hard"),
      input.note ?? null,
      auth.id
    ]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "schedule.blocked_date.created",
    entityType: "staffing_blocked_date",
    entityId: rows[0].id,
    metadata: {
      block_type: input.block_type,
      block_severity: input.block_severity ?? "soft",
      target_scope: input.target_scope,
      target_department: input.target_department ?? null,
      target_user_id: input.target_user_id ?? null
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });
  return rows[0];
}

export async function reportSameDayAbsence(
  client: PoolClient,
  auth: AuthUser,
  input: { note?: string | null; reason_category?: string | null },
  meta: RequestMeta
) {
  return createAvailabilityRequest(
    client,
    auth,
    {
      request_type: "sick_illness",
      start_date: getLocalDateString(),
      end_date: getLocalDateString(),
      all_day: true,
      reason_category: input.reason_category ?? "same_day_absence",
      note: input.note ?? null
    },
    meta
  );
}

export async function loadAvailabilityWindowsForUsersOnDate(
  client: PoolClient,
  input: {
    tenantId: string;
    userContexts: ScheduleScopeUser[];
    anchorDate: string;
    includePendingRequests?: boolean;
  }
) {
  const userIds = input.userContexts.map((user) => user.id);
  if (!userIds.length) {
    return new Map<string, AvailabilityWindow[]>();
  }

  const requestRows = await client.query<AvailabilityRequestRow>(
      `
        SELECT *
        FROM pto_request
        WHERE tenant_id = $1
          AND user_id = ANY($2::uuid[])
          AND ends_on >= $3::date
          AND starts_on <= $3::date
          AND (
            status = 'approved'
            OR (status IN ('submitted', 'needs_review') AND live_operational_absence_state IS NOT NULL)
            OR ($4::boolean = true AND status IN ('submitted', 'needs_review'))
          )
      `,
      [input.tenantId, userIds, input.anchorDate, Boolean(input.includePendingRequests)]
    );
  const ruleRows = await client.query<{
      id: string;
      user_id: string;
      rule_type: RecurringAvailabilityRuleType;
      weekdays: number[] | null;
      start_time: string | null;
      end_time: string | null;
      season_start: string | null;
      season_end: string | null;
      note: string | null;
    }>(
      `
        SELECT id, user_id, rule_type, weekdays, start_time::text, end_time::text, season_start::text, season_end::text, note
        FROM employee_availability_rule
        WHERE tenant_id = $1
          AND user_id = ANY($2::uuid[])
          AND status = 'active'
      `,
      [input.tenantId, userIds]
    );
  const blockedRows = await client.query<{
      id: string;
      target_scope: "company" | "department" | "user";
      target_department: string | null;
      target_user_id: string | null;
      block_type: BlockedDateType;
      block_severity: "soft" | "hard";
      label: string;
      starts_at: string;
      ends_at: string;
    }>(
      `
        SELECT id, target_scope, target_department::text, target_user_id, block_type, block_severity, label, starts_at::text, ends_at::text
        FROM staffing_blocked_date
        WHERE tenant_id = $1
          AND starts_at::date <= $2::date
          AND ends_at::date >= $2::date
      `,
      [input.tenantId, input.anchorDate]
    );

  const windowsByUser = new Map<string, AvailabilityWindow[]>();
  const weekday = new Date(`${input.anchorDate}T12:00:00`).getDay();

  function pushWindow(window: AvailabilityWindow) {
    const current = windowsByUser.get(window.user_id) ?? [];
    current.push(window);
    windowsByUser.set(window.user_id, current);
  }

  for (const row of requestRows.rows) {
    if (row.request_type === "availability_restriction_update") {
      continue;
    }
    const allDay = Boolean(row.all_day);
    pushWindow({
      user_id: row.user_id,
      source_id: row.id,
      source_kind: "request",
      availability_state:
        row.live_operational_absence_state && row.live_operational_absence_state !== "excused"
          ? "sick_same_day_absence"
          : row.status === "approved"
            ? "approved_time_off"
            : "submitted_request_warning",
      label: requestTypeLabel(row.request_type),
      starts_at: allDay ? startOfDayIso(input.anchorDate) : timeToIso(input.anchorDate, row.start_time, "start"),
      ends_at: allDay ? endOfDayIso(input.anchorDate) : timeToIso(input.anchorDate, row.end_time, "end"),
      all_day: allDay,
      warning_only: row.status !== "approved" && !row.live_operational_absence_state,
      request_status: row.status,
      request_type: row.request_type,
      severity: row.warning_level
    });
  }

  for (const row of blockedRows.rows) {
    for (const user of input.userContexts) {
      const applies =
        row.target_scope === "company" ||
        (row.target_scope === "department" && row.target_department === user.department) ||
        (row.target_scope === "user" && row.target_user_id === user.id);
      if (!applies) {
        continue;
      }
      pushWindow({
        user_id: user.id,
        source_id: row.id,
        source_kind: "blocked_date",
        availability_state: row.block_type === "company_holiday" ? "company_holiday_closed" : "blocked_by_manager_admin",
        label: row.label,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        all_day: row.starts_at.slice(11, 16) === "00:00" && row.ends_at.slice(11, 16) === "23:59",
        warning_only: false,
        request_status: null,
        request_type: null,
        severity: row.block_severity === "hard" ? "high" : "medium"
      });
    }
  }

  for (const row of ruleRows.rows) {
    const weekdays = normalizeWeekdays(Array.isArray(row.weekdays) ? row.weekdays : []);
    if (row.season_start && row.season_start > input.anchorDate) {
      continue;
    }
    if (row.season_end && row.season_end < input.anchorDate) {
      continue;
    }
    if (weekdays.length && !weekdays.includes(weekday)) {
      continue;
    }

    if (row.rule_type === "unavailable_weekday" || row.rule_type === "seasonal_unavailable") {
      pushWindow({
        user_id: row.user_id,
        source_id: row.id,
        source_kind: "availability_rule",
        availability_state: "availability_restriction",
        label: row.note?.trim() || "Availability restriction",
        starts_at: startOfDayIso(input.anchorDate),
        ends_at: endOfDayIso(input.anchorDate),
        all_day: true,
        warning_only: false,
        request_status: null,
        request_type: null,
        severity: "medium"
      });
    } else if (row.rule_type === "available_after_time" && row.start_time) {
      pushWindow({
        user_id: row.user_id,
        source_id: row.id,
        source_kind: "availability_rule",
        availability_state: "availability_restriction",
        label: row.note?.trim() || `Available after ${row.start_time.slice(0, 5)}`,
        starts_at: startOfDayIso(input.anchorDate),
        ends_at: timeToIso(input.anchorDate, row.start_time, "start"),
        all_day: false,
        warning_only: false,
        request_status: null,
        request_type: null,
        severity: "medium"
      });
    } else if (row.rule_type === "available_between_times" && row.start_time && row.end_time) {
      pushWindow({
        user_id: row.user_id,
        source_id: row.id,
        source_kind: "availability_rule",
        availability_state: "availability_restriction",
        label: row.note?.trim() || "Unavailable before shift window",
        starts_at: startOfDayIso(input.anchorDate),
        ends_at: timeToIso(input.anchorDate, row.start_time, "start"),
        all_day: false,
        warning_only: false,
        request_status: null,
        request_type: null,
        severity: "medium"
      });
      pushWindow({
        user_id: row.user_id,
        source_id: `${row.id}:late`,
        source_kind: "availability_rule",
        availability_state: "availability_restriction",
        label: row.note?.trim() || "Unavailable after shift window",
        starts_at: timeToIso(input.anchorDate, row.end_time, "end"),
        ends_at: endOfDayIso(input.anchorDate),
        all_day: false,
        warning_only: false,
        request_status: null,
        request_type: null,
        severity: "medium"
      });
    }
  }

  return windowsByUser;
}

export async function listScheduleAvailabilityItems(
  client: PoolClient,
  auth: AuthUser,
  input: { startDate: string; endDate: string }
): Promise<ScheduleAvailabilityItem[]> {
  const requestValues: unknown[] = [auth.tenantId, input.startDate, input.endDate];
  const blockedValues: unknown[] = [auth.tenantId, input.startDate, input.endDate];
  const requestWhere = ["pto.tenant_id = $1", "pto.ends_on >= $2::date", "pto.starts_on <= $3::date", "pto.status IN ('submitted', 'needs_review', 'approved')"];
  const blockedWhere = ["block.tenant_id = $1", "block.ends_at::date >= $2::date", "block.starts_at::date <= $3::date"];

  if (shouldRestrictShiftList(auth)) {
    const requestUserToken = pushValue(requestValues, auth.id);
    const blockedUserToken = pushValue(blockedValues, auth.id);
    const blockedDepartmentToken = pushValue(blockedValues, auth.department);
    requestWhere.push(`pto.user_id = ${requestUserToken}`);
    blockedWhere.push(
      `(block.target_scope = 'company' OR (block.target_scope = 'department' AND block.target_department = ${blockedDepartmentToken}::department_code) OR (block.target_scope = 'user' AND block.target_user_id = ${blockedUserToken}::uuid))`
    );
  } else if (shouldDepartmentScopeShiftList(auth)) {
    const requestDepartmentToken = pushValue(requestValues, auth.department);
    const blockedDepartmentToken = pushValue(blockedValues, auth.department);
    requestWhere.push(`pto.department = ${requestDepartmentToken}::department_code`);
    blockedWhere.push(`(block.target_scope = 'company' OR (block.target_scope = 'department' AND block.target_department = ${blockedDepartmentToken}::department_code))`);
  }

  const [requestRows, blockedRows] = await Promise.all([
    client.query<AvailabilityRequestRow>(
      `
        SELECT pto.*, au.full_name AS user_name
        FROM pto_request pto
        JOIN app_user au ON au.id = pto.user_id
        WHERE ${requestWhere.join(" AND ")}
        ORDER BY pto.starts_on ASC, au.full_name ASC
      `,
      requestValues
    ),
    client.query<{
      id: string;
      target_scope: "company" | "department" | "user";
      target_department: string | null;
      block_type: BlockedDateType;
      block_severity: "soft" | "hard";
      label: string;
      starts_at: string;
      ends_at: string;
      note: string | null;
    }>(
      `
        SELECT
          block.id,
          block.target_scope,
          block.target_department::text,
          block.block_type,
          block.block_severity,
          block.label,
          block.starts_at::text,
          block.ends_at::text,
          block.note
        FROM staffing_blocked_date block
        WHERE ${blockedWhere.join(" AND ")}
        ORDER BY block.starts_at ASC
      `,
      blockedValues
    )
  ]);

  const items: ScheduleAvailabilityItem[] = [];
  for (const row of requestRows.rows) {
    const summary = normalizeImpactSummary(row.staffing_impact_summary);
    const dates = enumerateDateRange(
      row.starts_on < input.startDate ? input.startDate : row.starts_on,
      row.ends_on > input.endDate ? input.endDate : row.ends_on
    );
    for (const dateKey of dates) {
      const itemKind = row.live_operational_absence_state ? "absence" : "request";
      items.push({
        item_kind: "availability",
        id: `${row.id}:${dateKey}`,
        date_key: dateKey,
        title: itemKind === "absence" ? `${row.user_name ?? "Team member"} absent` : `${row.user_name ?? "Team member"} | ${requestTypeLabel(row.request_type)}`,
        department: row.department,
        availability_kind: itemKind,
        status: row.status,
        starts_at: row.all_day ? null : timeToIso(dateKey, row.start_time, "start"),
        ends_at: row.all_day ? null : timeToIso(dateKey, row.end_time, "end"),
        user_id: row.user_id,
        user_name: row.user_name ?? null,
        location_name: null,
        request_type: row.request_type,
        reason_category: row.reason_category,
        note: row.reason,
        warning_level: row.warning_level,
        impacted_assignment_count: summary.affected_assignment_count,
        minimum_staffing_break_count: summary.minimum_staffing_break_count,
        lead_coverage_break_count: summary.lead_coverage_break_count,
        coverage_found: row.coverage_found,
        protected_date_severity: row.protected_date_severity,
        live_operational_absence_state: row.live_operational_absence_state,
        badge_label:
          row.live_operational_absence_state === "reported_absent"
            ? "Reported Absent"
            : row.status === "approved"
              ? "Approved"
              : row.status === "needs_review"
                ? "Needs Review"
                : humanizeRequestStatus(row.status)
      });
    }
  }

  for (const row of blockedRows.rows) {
    const startDate = row.starts_at.slice(0, 10);
    const endDate = row.ends_at.slice(0, 10);
    const dates = enumerateDateRange(
      startDate < input.startDate ? input.startDate : startDate,
      endDate > input.endDate ? input.endDate : endDate
    );
    for (const dateKey of dates) {
      items.push({
        item_kind: "availability",
        id: `${row.id}:${dateKey}`,
        date_key: dateKey,
        title: row.label,
        department: row.target_department ?? auth.department,
        availability_kind: "blocked_date",
        status: "blocked",
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        user_id: null,
        user_name: null,
        location_name: null,
        request_type: row.block_type,
        reason_category: null,
        note: row.note,
        warning_level: row.block_severity === "hard" ? "high" : "medium",
        impacted_assignment_count: 0,
        minimum_staffing_break_count: 0,
        lead_coverage_break_count: 0,
        coverage_found: true,
        protected_date_severity: row.block_severity,
        live_operational_absence_state: null,
        badge_label: row.block_type === "company_holiday" ? "Holiday" : row.block_severity === "hard" ? "Hard Block" : "Blocked"
      });
    }
  }

  return items.sort((left, right) => {
    const leftTime = new Date(left.starts_at ?? `${left.date_key}T00:00:00`).getTime();
    const rightTime = new Date(right.starts_at ?? `${right.date_key}T00:00:00`).getTime();
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.title.localeCompare(right.title);
  });
}

export const createPTORequest = createAvailabilityRequest;
export const reviewPTORequest = reviewAvailabilityRequest;
export const cancelPTORequest = cancelAvailabilityRequest;
export const listPTORequests = listAvailabilityRequests;
export const exportPTORequestsCsv = exportAvailabilityRequestsCsv;
