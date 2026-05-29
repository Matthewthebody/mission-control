import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type { UrgentWatchCandidate } from "../types/urgentWatch.js";
import { getLocalDateString, getLocalDayBounds } from "../utils/localDate.js";
import { createAuditLog } from "./audit.js";
import { findNotificationRecipients, queueNotificationDispatch } from "./opsNotifications.js";
import { createAppEvent } from "./outbox.js";
import { assertShiftAccess, assertShiftManagementScope, shouldDepartmentScopeShiftList, shouldRestrictShiftList } from "./shiftAccess.js";

export type AttendanceLiveState =
  | "scheduled"
  | "upcoming"
  | "grace_window"
  | "checked_in"
  | "on_time"
  | "late"
  | "late_acknowledged"
  | "unresolved_no_check_in"
  | "called_out"
  | "replacement_needed"
  | "no_show"
  | "manager_excused"
  | "completed"
  | "canceled";

export type AttendanceSignalSource =
  | "system_schedule"
  | "employee_check_in"
  | "manager_mark_present"
  | "time_clock_start"
  | "manager_acknowledge_late"
  | "manager_mark_called_out"
  | "manager_request_replacement"
  | "manager_mark_no_show"
  | "manager_excuse"
  | "system_complete"
  | "system_cancel";

export type AttendanceOperationsAction =
  | "mark_present"
  | "acknowledge_late"
  | "mark_called_out"
  | "request_replacement"
  | "mark_no_show"
  | "excuse";

type AttendanceTimingPolicy = {
  awarenessWindowMinutes: number;
  graceWindowMinutes: number;
  unresolvedThresholdMinutes: number;
  noShowThresholdMinutes: number;
};

type AttendanceShiftRow = {
  shift_id: string;
  tenant_id: string;
  shoot_id: string | null;
  employee_id: string;
  employee_name: string;
  employee_email: string | null;
  manager_user_id: string | null;
  manager_name: string | null;
  department: string;
  shift_title: string;
  starts_at: string;
  ends_at: string | null;
  shift_status: string;
  cancelled_at: string | null;
  location_name: string | null;
  location_address: string | null;
  staffing_role: string | null;
  satisfies_lead_coverage: boolean;
  shoot_code: string | null;
  shoot_title: string | null;
  shoot_date: string | null;
  school_name: string | null;
  minimum_staff_count: number;
  planned_staff_count: number;
  required_lead_count: number;
};

type AttendanceRuntimeRow = {
  shift_id: string;
  tenant_id: string;
  shoot_id: string | null;
  employee_id: string;
  current_state: AttendanceLiveState;
  current_state_reason: string | null;
  signal_source: AttendanceSignalSource;
  last_signal_at: string | null;
  first_present_at: string | null;
  first_present_source: AttendanceSignalSource | null;
  latest_check_in_at: string | null;
  latest_time_clock_start_at: string | null;
  manager_mark_present_at: string | null;
  manager_mark_present_by_user_id: string | null;
  late_acknowledged_at: string | null;
  late_acknowledged_by_user_id: string | null;
  called_out_at: string | null;
  called_out_by_user_id: string | null;
  replacement_needed_at: string | null;
  replacement_needed_by_user_id: string | null;
  no_show_marked_at: string | null;
  no_show_marked_by_user_id: string | null;
  manager_excused_at: string | null;
  manager_excused_by_user_id: string | null;
  escalation_level: number;
  last_escalated_at: string | null;
  open_alert_types: string[] | null;
  coverage_impact: boolean;
  critical_role_missing: boolean;
  understaffed_due_to_attendance: boolean;
  minimum_staff_count: number;
  planned_staff_count: number;
  required_lead_count: number;
  active_present_count: number;
  present_lead_count: number;
  last_evaluated_at: string | null;
  last_state_changed_at: string;
};

type ShiftPunchSignalRow = {
  shift_id: string;
  first_check_in_at: string | null;
  latest_check_in_at: string | null;
};

type TimeClockSignalRow = {
  shift_id: string;
  latest_time_clock_start_at: string | null;
};

type AttendanceHistoryRow = {
  id: string;
  event_type: string;
  from_state: AttendanceLiveState | null;
  to_state: AttendanceLiveState | null;
  signal_source: AttendanceSignalSource | null;
  escalation_level: number | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  actor_user_id: string | null;
  actor_user_name: string | null;
};

type EvaluatedAttendanceItem = {
  shiftId: string;
  tenantId: string;
  shootId: string | null;
  employeeId: string;
  employeeName: string;
  employeeEmail: string | null;
  managerUserId: string | null;
  managerName: string | null;
  department: string;
  shiftTitle: string;
  startsAt: string;
  endsAt: string | null;
  shiftStatus: string;
  cancelledAt: string | null;
  locationName: string | null;
  locationAddress: string | null;
  staffingRole: string | null;
  satisfiesLeadCoverage: boolean;
  shootCode: string | null;
  shootTitle: string | null;
  shootDate: string | null;
  schoolName: string | null;
  minimumStaffCount: number;
  plannedStaffCount: number;
  requiredLeadCount: number;
  currentState: AttendanceLiveState;
  currentStateReason: string;
  signalSource: AttendanceSignalSource;
  lastSignalAt: string | null;
  firstPresentAt: string | null;
  firstPresentSource: AttendanceSignalSource | null;
  latestCheckInAt: string | null;
  latestTimeClockStartAt: string | null;
  managerMarkPresentAt: string | null;
  managerMarkPresentByUserId: string | null;
  lateAcknowledgedAt: string | null;
  lateAcknowledgedByUserId: string | null;
  calledOutAt: string | null;
  calledOutByUserId: string | null;
  replacementNeededAt: string | null;
  replacementNeededByUserId: string | null;
  noShowMarkedAt: string | null;
  noShowMarkedByUserId: string | null;
  managerExcusedAt: string | null;
  managerExcusedByUserId: string | null;
  escalationLevel: number;
  lastEscalatedAt: string | null;
  openAlertTypes: string[];
  coverageImpact: boolean;
  criticalRoleMissing: boolean;
  understaffedDueToAttendance: boolean;
  activePresentCount: number;
  presentLeadCount: number;
  lastEvaluatedAt: string | null;
  lastStateChangedAt: string;
  minutesFromStart: number | null;
  minutesUntilStart: number | null;
  timingPolicy: AttendanceTimingPolicy;
  schedulingHash: string | null;
};

export type AttendanceOperationsItemRecord = {
  shift_id: string;
  shoot_id: string | null;
  employee_id: string;
  employee_name: string;
  employee_email: string | null;
  manager_user_id: string | null;
  manager_name: string | null;
  department: string;
  shift_title: string;
  starts_at: string;
  ends_at: string | null;
  location_name: string | null;
  location_address: string | null;
  staffing_role: string | null;
  satisfies_lead_coverage: boolean;
  shoot_code: string | null;
  shoot_title: string | null;
  shoot_date: string | null;
  school_name: string | null;
  current_state: AttendanceLiveState;
  current_state_reason: string;
  signal_source: AttendanceSignalSource;
  escalation_level: number;
  last_signal_at: string | null;
  first_present_at: string | null;
  latest_check_in_at: string | null;
  latest_time_clock_start_at: string | null;
  manager_mark_present_at: string | null;
  late_acknowledged_at: string | null;
  called_out_at: string | null;
  replacement_needed_at: string | null;
  no_show_marked_at: string | null;
  manager_excused_at: string | null;
  open_alert_types: string[];
  coverage_impact: boolean;
  critical_role_missing: boolean;
  understaffed_due_to_attendance: boolean;
  minimum_staff_count: number;
  planned_staff_count: number;
  required_lead_count: number;
  active_present_count: number;
  present_lead_count: number;
  minutes_from_start: number | null;
  minutes_until_start: number | null;
  health_tone: "neutral" | "warning" | "critical" | "success";
  state_label: string;
  alert_labels: string[];
  scheduling_hash: string | null;
};

export type AttendanceOperationsWorkspaceRecord = {
  generated_at: string;
  date: string;
  scope: "all" | "department" | "own";
  timing_rules: AttendanceTimingPolicy;
  summary: {
    tracked_shift_count: number;
    on_time_count: number;
    checked_in_count: number;
    late_count: number;
    unresolved_count: number;
    called_out_count: number;
    replacement_needed_count: number;
    no_show_count: number;
    coverage_impact_count: number;
    critical_role_missing_count: number;
    understaffed_due_to_attendance_count: number;
  };
  sections: Array<{
    key: "critical_risk" | "late_watch" | "coverage_replacement" | "checked_in" | "resolved";
    label: string;
    description: string;
    count: number;
    items: AttendanceOperationsItemRecord[];
  }>;
  home_ready_summary: {
    visible: boolean;
    summary_line: string;
    urgent_count: number;
    staffing_risk_count: number;
    items: Array<{
      shift_id: string;
      title: string;
      summary: string;
      urgency_label: string;
      state: AttendanceLiveState;
      scheduling_hash: string | null;
    }>;
  };
};

export type AttendanceOperationDetailRecord = {
  generated_at: string;
  item: AttendanceOperationsItemRecord;
  available_actions: AttendanceOperationsAction[];
  staffing_impact: {
    coverage_impact: boolean;
    critical_role_missing: boolean;
    understaffed_due_to_attendance: boolean;
    minimum_staff_count: number;
    planned_staff_count: number;
    required_lead_count: number;
    active_present_count: number;
    present_lead_count: number;
    scheduling_hash: string | null;
  };
  history: AttendanceHistoryRow[];
};

const DEFAULT_POLICY: AttendanceTimingPolicy = {
  awarenessWindowMinutes: 30,
  graceWindowMinutes: 5,
  unresolvedThresholdMinutes: 12,
  noShowThresholdMinutes: 20
};

const CRITICAL_STAFFING_ROLES = new Set(["lead_photographer", "senior_photographer", "check_in", "producer"]);
const PRESENT_STATES = new Set<AttendanceLiveState>(["checked_in", "on_time", "late", "late_acknowledged", "completed"]);
const CAPTURED_ATTENDANCE_SIGNAL_SOURCES = new Set<AttendanceSignalSource>([
  "employee_check_in",
  "manager_mark_present",
  "time_clock_start",
  "manager_acknowledge_late",
  "manager_mark_called_out",
  "manager_request_replacement",
  "manager_mark_no_show",
  "manager_excuse"
]);

function safeDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function minutesBetween(from: Date, to: Date) {
  return Math.floor((to.getTime() - from.getTime()) / 60_000);
}

function normalizeStateLabel(state: AttendanceLiveState) {
  return state.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeAlertLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeSignalLabel(value: AttendanceSignalSource) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function buildAlertChangeNote(openedAlerts: string[], clearedAlerts: string[]) {
  const parts: string[] = [];
  if (openedAlerts.length) {
    parts.push(`Opened: ${openedAlerts.map(normalizeAlertLabel).join(", ")}`);
  }
  if (clearedAlerts.length) {
    parts.push(`Cleared: ${clearedAlerts.map(normalizeAlertLabel).join(", ")}`);
  }
  return parts.join(" | ") || "Attendance alerts were refreshed.";
}

function isCriticalRole(item: Pick<EvaluatedAttendanceItem, "staffingRole" | "satisfiesLeadCoverage">) {
  const staffingRole = String(item.staffingRole ?? "").trim().toLowerCase();
  return item.satisfiesLeadCoverage || CRITICAL_STAFFING_ROLES.has(staffingRole);
}

function isRiskState(state: AttendanceLiveState) {
  return (
    state === "late" ||
    state === "late_acknowledged" ||
    state === "unresolved_no_check_in" ||
    state === "called_out" ||
    state === "replacement_needed" ||
    state === "no_show"
  );
}

function buildSchedulingHash(item: Pick<EvaluatedAttendanceItem, "shootId" | "shiftId" | "startsAt">) {
  const params = new URLSearchParams();
  params.set("area", "staffing");
  params.set("date", getLocalDateString(item.startsAt));
  if (item.shootId) {
    params.set("shoot", item.shootId);
  }
  params.set("shift", item.shiftId);
  return `#scheduling?${params.toString()}`;
}

function toneForItem(item: Pick<AttendanceOperationsItemRecord, "current_state" | "coverage_impact" | "critical_role_missing">) {
  if (item.coverage_impact || item.current_state === "no_show" || item.current_state === "replacement_needed") {
    return "critical" as const;
  }
  if (
    item.current_state === "unresolved_no_check_in" ||
    item.current_state === "called_out" ||
    item.current_state === "late" ||
    item.current_state === "late_acknowledged" ||
    item.critical_role_missing
  ) {
    return "warning" as const;
  }
  if (item.current_state === "checked_in" || item.current_state === "on_time" || item.current_state === "completed") {
    return "success" as const;
  }
  return "neutral" as const;
}

function buildAlertTypes(input: {
  state: AttendanceLiveState;
  coverageImpact: boolean;
  criticalRoleMissing: boolean;
  understaffedDueToAttendance: boolean;
}) {
  const values: string[] = [];
  switch (input.state) {
    case "late":
      values.push("late");
      break;
    case "late_acknowledged":
      values.push("late_acknowledged");
      break;
    case "unresolved_no_check_in":
      values.push("unresolved_no_check_in");
      break;
    case "called_out":
      values.push("called_out");
      break;
    case "replacement_needed":
      values.push("replacement_needed");
      break;
    case "no_show":
      values.push("no_show");
      break;
    default:
      break;
  }
  if (input.criticalRoleMissing) {
    values.push("critical_role_missing");
  }
  if (input.understaffedDueToAttendance) {
    values.push("understaffed_due_to_attendance");
  }
  if (input.coverageImpact) {
    values.push("coverage_impact");
  }
  return values;
}

function escalationForState(input: {
  state: AttendanceLiveState;
  coverageImpact: boolean;
  criticalRoleMissing: boolean;
  minutesFromStart: number | null;
}) {
  if (input.state === "no_show") {
    return 3;
  }
  if (input.state === "replacement_needed") {
    return input.coverageImpact || input.criticalRoleMissing ? 3 : 2;
  }
  if (input.state === "unresolved_no_check_in" || input.state === "called_out") {
    return input.coverageImpact || input.criticalRoleMissing ? 3 : 2;
  }
  if (input.state === "late" || input.state === "late_acknowledged") {
    if ((input.minutesFromStart ?? 0) >= 15 || input.coverageImpact || input.criticalRoleMissing) {
      return 2;
    }
    return 1;
  }
  return 0;
}

function actionEventType(action: AttendanceOperationsAction) {
  switch (action) {
    case "mark_present":
      return "manager_mark_present";
    case "acknowledge_late":
      return "late_acknowledged";
    case "mark_called_out":
      return "called_out";
    case "request_replacement":
      return "replacement_requested";
    case "mark_no_show":
      return "no_show_marked";
    case "excuse":
      return "manager_excused";
  }
}

function actionSignalSource(action: AttendanceOperationsAction): AttendanceSignalSource {
  switch (action) {
    case "mark_present":
      return "manager_mark_present";
    case "acknowledge_late":
      return "manager_acknowledge_late";
    case "mark_called_out":
      return "manager_mark_called_out";
    case "request_replacement":
      return "manager_request_replacement";
    case "mark_no_show":
      return "manager_mark_no_show";
    case "excuse":
      return "manager_excuse";
  }
}

async function resolveNumericSetting(
  client: PoolClient,
  tenantId: string,
  settingKey: string,
  defaultValue: number,
  department?: string | null
) {
  const { rows } = await client.query<{ value: unknown }>(
    `
      SELECT asv.value
      FROM admin_setting_value asv
      WHERE asv.tenant_id = $1
        AND asv.setting_key = $2
        AND asv.status = 'approved'
        AND asv.effective_at <= now()
        AND (asv.expires_at IS NULL OR asv.expires_at > now())
        AND (
          asv.scope_type = 'global'
          OR ($3::text IS NOT NULL AND asv.scope_type = 'department' AND asv.scope_id = $3)
        )
      ORDER BY
        CASE asv.scope_type
          WHEN 'department' THEN 2
          ELSE 1
        END DESC,
        asv.effective_at DESC,
        asv.created_at DESC
      LIMIT 1
    `,
    [tenantId, settingKey, department ?? null]
  );

  const value = rows[0]?.value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return defaultValue;
}

async function resolveTimingPoliciesForDepartments(client: PoolClient, tenantId: string, departments: string[]) {
  const policies = new Map<string, AttendanceTimingPolicy>();
  for (const department of departments) {
    const awarenessWindowMinutes = await resolveNumericSetting(
      client,
      tenantId,
      "attendance_time.awareness_window_minutes",
      DEFAULT_POLICY.awarenessWindowMinutes,
      department
    );
    const graceWindowMinutes = await resolveNumericSetting(
      client,
      tenantId,
      "attendance_time.grace_window_minutes",
      DEFAULT_POLICY.graceWindowMinutes,
      department
    );
    const unresolvedThresholdMinutes = await resolveNumericSetting(
      client,
      tenantId,
      "attendance_time.unresolved_threshold_minutes",
      DEFAULT_POLICY.unresolvedThresholdMinutes,
      department
    );
    const noShowThresholdMinutes = await resolveNumericSetting(
      client,
      tenantId,
      "attendance_time.probable_no_show_threshold_minutes",
      DEFAULT_POLICY.noShowThresholdMinutes,
      department
    );
    policies.set(department, {
      awarenessWindowMinutes,
      graceWindowMinutes,
      unresolvedThresholdMinutes,
      noShowThresholdMinutes
    });
  }
  return policies;
}

function buildScopeFilter(auth: AuthUser, values: unknown[], alias = "ws") {
  const clauses: string[] = [];
  if (shouldRestrictShiftList(auth)) {
    values.push(auth.id);
    clauses.push(`${alias}.assigned_user_id = $${values.length}`);
    return { scope: "own" as const, clauses };
  }
  if (shouldDepartmentScopeShiftList(auth)) {
    values.push(auth.department);
    clauses.push(`${alias}.department = $${values.length}::department_code`);
    return { scope: "department" as const, clauses };
  }
  return { scope: "all" as const, clauses };
}

async function listRelevantShifts(
  client: PoolClient,
  auth: AuthUser,
  options: { date: string; shiftId?: string | null }
) {
  const bounds = getLocalDayBounds(options.date);
  const values: unknown[] = [auth.tenantId, bounds.start.toISOString(), bounds.endExclusive.toISOString()];
  const where = [
    "ws.tenant_id = $1",
    "ws.starts_at < $3::timestamptz",
    "COALESCE(ws.ends_at, ws.starts_at) >= $2::timestamptz",
    "(ws.status IN ('published', 'completed', 'cancelled') OR ws.cancelled_at IS NOT NULL)"
  ];
  const scopeFilter = buildScopeFilter(auth, values, "ws");
  where.push(...scopeFilter.clauses);

  if (options.shiftId) {
    values.push(options.shiftId);
    where.push(`ws.id = $${values.length}::uuid`);
  }

  const { rows } = await client.query<AttendanceShiftRow>(
    `
      SELECT
        ws.id AS shift_id,
        ws.tenant_id,
        ws.shoot_id,
        ws.assigned_user_id AS employee_id,
        employee.full_name AS employee_name,
        employee.email AS employee_email,
        ws.manager_user_id,
        manager.full_name AS manager_name,
        ws.department::text AS department,
        ws.title AS shift_title,
        ws.starts_at::text AS starts_at,
        ws.ends_at::text AS ends_at,
        ws.status::text AS shift_status,
        ws.cancelled_at::text AS cancelled_at,
        ws.location_name,
        ws.location_address,
        ws.staffing_role::text AS staffing_role,
        COALESCE(ws.satisfies_lead_coverage, false) AS satisfies_lead_coverage,
        s.shoot_code,
        s.title AS shoot_title,
        s.shoot_date::text AS shoot_date,
        org.display_name AS school_name,
        COALESCE(s.minimum_staff_count, 0)::int AS minimum_staff_count,
        COALESCE(s.planned_staff_count, 0)::int AS planned_staff_count,
        COALESCE(s.required_lead_count, 0)::int AS required_lead_count
      FROM work_shift ws
      JOIN app_user employee
        ON employee.tenant_id = ws.tenant_id
       AND employee.id = ws.assigned_user_id
      LEFT JOIN app_user manager
        ON manager.tenant_id = ws.tenant_id
       AND manager.id = ws.manager_user_id
      LEFT JOIN shoot s
        ON s.tenant_id = ws.tenant_id
       AND s.id = ws.shoot_id
      LEFT JOIN organization org
        ON org.tenant_id = s.tenant_id
       AND org.id = s.organization_id
      WHERE ${where.join(" AND ")}
      ORDER BY ws.starts_at ASC, employee.full_name ASC
    `,
    values
  );

  return { rows, scope: scopeFilter.scope };
}

async function listRelevantShiftsForTenant(client: PoolClient, tenantId: string, options: { date: string; shiftId?: string | null }) {
  const bounds = getLocalDayBounds(options.date);
  const values: unknown[] = [tenantId, bounds.start.toISOString(), bounds.endExclusive.toISOString()];
  const where = [
    "ws.tenant_id = $1",
    "ws.starts_at < $3::timestamptz",
    "COALESCE(ws.ends_at, ws.starts_at) >= $2::timestamptz",
    "(ws.status IN ('published', 'completed', 'cancelled') OR ws.cancelled_at IS NOT NULL)"
  ];

  if (options.shiftId) {
    values.push(options.shiftId);
    where.push(`ws.id = $${values.length}::uuid`);
  }

  const { rows } = await client.query<AttendanceShiftRow>(
    `
      SELECT
        ws.id AS shift_id,
        ws.tenant_id,
        ws.shoot_id,
        ws.assigned_user_id AS employee_id,
        employee.full_name AS employee_name,
        employee.email AS employee_email,
        ws.manager_user_id,
        manager.full_name AS manager_name,
        ws.department::text AS department,
        ws.title AS shift_title,
        ws.starts_at::text AS starts_at,
        ws.ends_at::text AS ends_at,
        ws.status::text AS shift_status,
        ws.cancelled_at::text AS cancelled_at,
        ws.location_name,
        ws.location_address,
        ws.staffing_role::text AS staffing_role,
        COALESCE(ws.satisfies_lead_coverage, false) AS satisfies_lead_coverage,
        s.shoot_code,
        s.title AS shoot_title,
        s.shoot_date::text AS shoot_date,
        org.display_name AS school_name,
        COALESCE(s.minimum_staff_count, 0)::int AS minimum_staff_count,
        COALESCE(s.planned_staff_count, 0)::int AS planned_staff_count,
        COALESCE(s.required_lead_count, 0)::int AS required_lead_count
      FROM work_shift ws
      JOIN app_user employee
        ON employee.tenant_id = ws.tenant_id
       AND employee.id = ws.assigned_user_id
      LEFT JOIN app_user manager
        ON manager.tenant_id = ws.tenant_id
       AND manager.id = ws.manager_user_id
      LEFT JOIN shoot s
        ON s.tenant_id = ws.tenant_id
       AND s.id = ws.shoot_id
      LEFT JOIN organization org
        ON org.tenant_id = s.tenant_id
       AND org.id = s.organization_id
      WHERE ${where.join(" AND ")}
      ORDER BY ws.starts_at ASC, employee.full_name ASC
    `,
    values
  );

  return rows;
}

async function ensureRuntimeRows(client: PoolClient, rows: AttendanceShiftRow[]) {
  for (const row of rows) {
    await client.query(
      `
        INSERT INTO shift_attendance_runtime (
          shift_id,
          tenant_id,
          shoot_id,
          employee_id,
          current_state,
          current_state_reason,
          signal_source,
          minimum_staff_count,
          planned_staff_count,
          required_lead_count,
          last_state_changed_at
        )
        VALUES (
          $1,$2,$3,$4,
          CASE
            WHEN $5::text = 'cancelled' OR $6::timestamptz IS NOT NULL THEN 'canceled'::attendance_live_state
            WHEN $5::text = 'completed' THEN 'completed'::attendance_live_state
            ELSE 'scheduled'::attendance_live_state
          END,
          CASE
            WHEN $5::text = 'cancelled' OR $6::timestamptz IS NOT NULL THEN 'Shift was canceled.'
            WHEN $5::text = 'completed' THEN 'Shift is already complete.'
            ELSE 'Shift is scheduled and waiting for live attendance evaluation.'
          END,
          CASE
            WHEN $5::text = 'cancelled' OR $6::timestamptz IS NOT NULL THEN 'system_cancel'::attendance_live_signal_source
            WHEN $5::text = 'completed' THEN 'system_complete'::attendance_live_signal_source
            ELSE 'system_schedule'::attendance_live_signal_source
          END,
          $7,$8,$9,now()
        )
        ON CONFLICT (shift_id) DO NOTHING
      `,
      [
        row.shift_id,
        row.tenant_id,
        row.shoot_id,
        row.employee_id,
        row.shift_status,
        row.cancelled_at,
        row.minimum_staff_count,
        row.planned_staff_count,
        row.required_lead_count
      ]
    );
  }
}

async function getRuntimeMap(client: PoolClient, tenantId: string, shiftIds: string[]) {
  if (!shiftIds.length) {
    return new Map<string, AttendanceRuntimeRow>();
  }
  const { rows } = await client.query<AttendanceRuntimeRow>(
    `
      SELECT
        shift_id,
        tenant_id,
        shoot_id,
        employee_id,
        current_state,
        current_state_reason,
        signal_source,
        last_signal_at::text,
        first_present_at::text,
        first_present_source,
        latest_check_in_at::text,
        latest_time_clock_start_at::text,
        manager_mark_present_at::text,
        manager_mark_present_by_user_id::text,
        late_acknowledged_at::text,
        late_acknowledged_by_user_id::text,
        called_out_at::text,
        called_out_by_user_id::text,
        replacement_needed_at::text,
        replacement_needed_by_user_id::text,
        no_show_marked_at::text,
        no_show_marked_by_user_id::text,
        manager_excused_at::text,
        manager_excused_by_user_id::text,
        escalation_level,
        last_escalated_at::text,
        open_alert_types,
        coverage_impact,
        critical_role_missing,
        understaffed_due_to_attendance,
        minimum_staff_count,
        planned_staff_count,
        required_lead_count,
        active_present_count,
        present_lead_count,
        last_evaluated_at::text,
        last_state_changed_at::text
      FROM shift_attendance_runtime
      WHERE tenant_id = $1
        AND shift_id = ANY($2::uuid[])
    `,
    [tenantId, shiftIds]
  );
  return new Map(rows.map((row) => [row.shift_id, row]));
}

async function getPunchSignalMap(client: PoolClient, tenantId: string, shiftIds: string[]) {
  if (!shiftIds.length) {
    return new Map<string, ShiftPunchSignalRow>();
  }
  // Legacy punch rows remain as a compatibility fallback while Attendance finishes
  // cutting over to canonical Time Session / Time Segment state.
  const { rows } = await client.query<ShiftPunchSignalRow>(
    `
      SELECT
        sp.shift_id::text AS shift_id,
        (MIN(sp.client_timestamp) FILTER (WHERE sp.direction = 'in'))::text AS first_check_in_at,
        (MAX(sp.client_timestamp) FILTER (WHERE sp.direction = 'in'))::text AS latest_check_in_at
      FROM shift_punch sp
      WHERE sp.tenant_id = $1
        AND sp.shift_id = ANY($2::uuid[])
      GROUP BY sp.shift_id
    `,
    [tenantId, shiftIds]
  );
  return new Map(rows.map((row) => [row.shift_id, row]));
}

async function getTimeClockSignalMap(client: PoolClient, tenantId: string, shiftIds: string[]) {
  if (!shiftIds.length) {
    return new Map<string, TimeClockSignalRow>();
  }
  const { rows } = await client.query<TimeClockSignalRow>(
    `
      SELECT
        target.shift_id::text AS shift_id,
        MAX(target.start_time)::text AS latest_time_clock_start_at
      FROM (
        SELECT
          COALESCE(seg.linked_shift_id, session.source_shift_id) AS shift_id,
          seg.start_time
        FROM time_session session
        LEFT JOIN time_segment seg
          ON seg.session_id = session.id
        WHERE session.tenant_id = $1
          AND (
            session.source_shift_id = ANY($2::uuid[])
            OR seg.linked_shift_id = ANY($2::uuid[])
          )
          AND seg.start_time IS NOT NULL
      ) target
      WHERE target.shift_id IS NOT NULL
      GROUP BY target.shift_id
    `,
    [tenantId, shiftIds]
  );
  return new Map(rows.map((row) => [row.shift_id, row]));
}

function deriveAttendanceState(input: {
  shift: AttendanceShiftRow;
  runtime: AttendanceRuntimeRow | null;
  firstCheckInAt: string | null;
  latestCheckInAt: string | null;
  latestTimeClockStartAt: string | null;
  policy: AttendanceTimingPolicy;
  now: Date;
}) {
  const startAt = new Date(input.shift.starts_at);
  const endAt = safeDate(input.shift.ends_at) ?? new Date(startAt.getTime());
  const runtime = input.runtime;
  const managerMarkPresentAt = safeDate(runtime?.manager_mark_present_at);
  const lateAcknowledgedAt = safeDate(runtime?.late_acknowledged_at);
  const calledOutAt = safeDate(runtime?.called_out_at);
  const replacementNeededAt = safeDate(runtime?.replacement_needed_at);
  const noShowMarkedAt = safeDate(runtime?.no_show_marked_at);
  const managerExcusedAt = safeDate(runtime?.manager_excused_at);
  const firstCheckInAt = safeDate(input.firstCheckInAt);
  const latestCheckInAt = safeDate(input.latestCheckInAt);
  const latestTimeClockStartAt = safeDate(input.latestTimeClockStartAt);
  const derivedSignalSource =
    managerMarkPresentAt != null
      ? ("manager_mark_present" as const)
      : latestTimeClockStartAt != null
        ? ("time_clock_start" as const)
        : ("employee_check_in" as const);

  const presentSignals = [managerMarkPresentAt, firstCheckInAt, latestTimeClockStartAt].filter(
    (value): value is Date => Boolean(value)
  );
  const presentAt = presentSignals.length
    ? new Date(Math.min(...presentSignals.map((value) => value.getTime())))
    : null;
  const lastSignalAt = [...presentSignals, calledOutAt, replacementNeededAt, noShowMarkedAt, managerExcusedAt, lateAcknowledgedAt]
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;

  const minutesFromStart = input.now >= startAt ? minutesBetween(startAt, input.now) : null;
  const minutesUntilStart = input.now < startAt ? minutesBetween(input.now, startAt) : null;

  if (input.shift.cancelled_at || input.shift.shift_status === "cancelled") {
    return {
      state: "canceled" as const,
      reason: "Shift was canceled.",
      signalSource: "system_cancel" as const,
      presentAt,
      lastSignalAt,
      latestCheckInAt,
      latestTimeClockStartAt,
      minutesFromStart,
      minutesUntilStart
    };
  }

  if (input.shift.shift_status === "completed" || input.now >= endAt) {
    if (!presentAt && !calledOutAt && !managerExcusedAt && !noShowMarkedAt) {
      return {
        state: "completed" as const,
        reason: "Shift time window has closed.",
        signalSource: "system_complete" as const,
        presentAt,
        lastSignalAt,
        latestCheckInAt,
        latestTimeClockStartAt,
        minutesFromStart,
        minutesUntilStart
      };
    }
  }

  if (managerExcusedAt) {
    return {
      state: "manager_excused" as const,
      reason: "Manager marked this attendance issue as excused.",
      signalSource: "manager_excuse" as const,
      presentAt,
      lastSignalAt: managerExcusedAt,
      latestCheckInAt,
      latestTimeClockStartAt,
      minutesFromStart,
      minutesUntilStart
    };
  }

  if (noShowMarkedAt) {
    return {
      state: "no_show" as const,
      reason: "Manager confirmed this employee is a no-show.",
      signalSource: "manager_mark_no_show" as const,
      presentAt,
      lastSignalAt: noShowMarkedAt,
      latestCheckInAt,
      latestTimeClockStartAt,
      minutesFromStart,
      minutesUntilStart
    };
  }

  if (replacementNeededAt) {
    return {
      state: "replacement_needed" as const,
      reason: calledOutAt
        ? "A callout was recorded and replacement coverage is still needed."
        : "Replacement coverage was requested.",
      signalSource: "manager_request_replacement" as const,
      presentAt,
      lastSignalAt: replacementNeededAt,
      latestCheckInAt,
      latestTimeClockStartAt,
      minutesFromStart,
      minutesUntilStart
    };
  }

  if (calledOutAt) {
    return {
      state: "called_out" as const,
      reason: "Manager recorded a callout for this shift.",
      signalSource: "manager_mark_called_out" as const,
      presentAt,
      lastSignalAt: calledOutAt,
      latestCheckInAt,
      latestTimeClockStartAt,
      minutesFromStart,
      minutesUntilStart
    };
  }

  if (presentAt) {
    const graceCutoff = new Date(startAt.getTime() + input.policy.graceWindowMinutes * 60_000);
    if (input.now < startAt) {
      return {
        state: "checked_in" as const,
        reason: "Attendance was captured before the scheduled start.",
        signalSource: derivedSignalSource,
        presentAt,
        lastSignalAt: lastSignalAt ?? presentAt,
        latestCheckInAt,
        latestTimeClockStartAt,
        minutesFromStart,
        minutesUntilStart
      };
    }
    if (presentAt <= graceCutoff) {
      return {
        state: "on_time" as const,
        reason: "Attendance was captured within the grace window.",
        signalSource: derivedSignalSource,
        presentAt,
        lastSignalAt: lastSignalAt ?? presentAt,
        latestCheckInAt,
        latestTimeClockStartAt,
        minutesFromStart,
        minutesUntilStart
      };
    }
    return {
      state: lateAcknowledgedAt ? ("late_acknowledged" as const) : ("late" as const),
      reason: lateAcknowledgedAt
        ? "The arrival was late and a manager acknowledged it."
        : "Attendance was captured after the grace window.",
      signalSource: lateAcknowledgedAt
        ? ("manager_acknowledge_late" as const)
        : derivedSignalSource,
      presentAt,
      lastSignalAt: lastSignalAt ?? presentAt,
      latestCheckInAt,
      latestTimeClockStartAt,
      minutesFromStart,
      minutesUntilStart
    };
  }

  const awarenessBoundary = new Date(startAt.getTime() - input.policy.awarenessWindowMinutes * 60_000);
  const graceBoundary = new Date(startAt.getTime() + input.policy.graceWindowMinutes * 60_000);
  const unresolvedBoundary = new Date(startAt.getTime() + input.policy.unresolvedThresholdMinutes * 60_000);
  const noShowBoundary = new Date(startAt.getTime() + input.policy.noShowThresholdMinutes * 60_000);

  if (input.now < awarenessBoundary) {
    return {
      state: "scheduled" as const,
      reason: "The assignment is scheduled outside the attendance awareness window.",
      signalSource: "system_schedule" as const,
      presentAt,
      lastSignalAt,
      latestCheckInAt,
      latestTimeClockStartAt,
      minutesFromStart,
      minutesUntilStart
    };
  }

  if (input.now < startAt) {
    return {
      state: "upcoming" as const,
      reason: "The assignment is inside the awareness window and waiting for arrival.",
      signalSource: "system_schedule" as const,
      presentAt,
      lastSignalAt,
      latestCheckInAt,
      latestTimeClockStartAt,
      minutesFromStart,
      minutesUntilStart
    };
  }

  if (input.now <= graceBoundary) {
    return {
      state: "grace_window" as const,
      reason: "The scheduled start has passed, but the grace window is still open.",
      signalSource: "system_schedule" as const,
      presentAt,
      lastSignalAt,
      latestCheckInAt,
      latestTimeClockStartAt,
      minutesFromStart,
      minutesUntilStart
    };
  }

  if (lateAcknowledgedAt) {
    return {
      state: "late_acknowledged" as const,
      reason: "The employee is still missing, but the late arrival has been acknowledged.",
      signalSource: "manager_acknowledge_late" as const,
      presentAt,
      lastSignalAt: lateAcknowledgedAt,
      latestCheckInAt,
      latestTimeClockStartAt,
      minutesFromStart,
      minutesUntilStart
    };
  }

  if (input.now < unresolvedBoundary) {
    return {
      state: "late" as const,
      reason: "The grace window has passed and the employee is late.",
      signalSource: "system_schedule" as const,
      presentAt,
      lastSignalAt,
      latestCheckInAt,
      latestTimeClockStartAt,
      minutesFromStart,
      minutesUntilStart
    };
  }

  if (input.now < noShowBoundary) {
    return {
      state: "unresolved_no_check_in" as const,
      reason: "The employee is still missing beyond the unresolved threshold.",
      signalSource: "system_schedule" as const,
      presentAt,
      lastSignalAt,
      latestCheckInAt,
      latestTimeClockStartAt,
      minutesFromStart,
      minutesUntilStart
    };
  }

  return {
    state: "no_show" as const,
    reason: "No attendance signal arrived before the no-show threshold.",
    signalSource: "system_schedule" as const,
    presentAt,
    lastSignalAt,
    latestCheckInAt,
    latestTimeClockStartAt,
    minutesFromStart,
    minutesUntilStart
  };
}

function applyStaffingRisk(evaluatedItems: EvaluatedAttendanceItem[]) {
  const byShoot = new Map<string, EvaluatedAttendanceItem[]>();
  for (const item of evaluatedItems) {
    if (!item.shootId) {
      continue;
    }
    const current = byShoot.get(item.shootId) ?? [];
    current.push(item);
    byShoot.set(item.shootId, current);
  }

  for (const item of evaluatedItems) {
    const shootItems = item.shootId ? byShoot.get(item.shootId) ?? [item] : [item];
    const activePresentCount = shootItems.filter((candidate) => PRESENT_STATES.has(candidate.currentState)).length;
    const presentLeadCount = shootItems.filter(
      (candidate) => PRESENT_STATES.has(candidate.currentState) && isCriticalRole(candidate)
    ).length;
    const minimumStaffCount =
      item.minimumStaffCount > 0
        ? item.minimumStaffCount
        : Math.max(
            shootItems.reduce((sum, candidate) => Math.max(sum, candidate.minimumStaffCount), 0),
            0
          );
    const requiredLeadCount =
      item.requiredLeadCount > 0
        ? item.requiredLeadCount
        : Math.max(
            shootItems.reduce((sum, candidate) => Math.max(sum, candidate.requiredLeadCount), 0),
            0
          );
    const missingShiftState = isRiskState(item.currentState) || item.currentState === "manager_excused";
    const criticalRoleMissing = isCriticalRole(item) && missingShiftState && presentLeadCount < Math.max(requiredLeadCount, 1);
    const understaffedDueToAttendance = missingShiftState && activePresentCount < Math.max(minimumStaffCount, 1);
    item.activePresentCount = activePresentCount;
    item.presentLeadCount = presentLeadCount;
    item.minimumStaffCount = minimumStaffCount;
    item.requiredLeadCount = requiredLeadCount;
    item.criticalRoleMissing = criticalRoleMissing;
    item.understaffedDueToAttendance = understaffedDueToAttendance;
    item.coverageImpact = criticalRoleMissing || understaffedDueToAttendance;
    item.openAlertTypes = buildAlertTypes({
      state: item.currentState,
      coverageImpact: item.coverageImpact,
      criticalRoleMissing,
      understaffedDueToAttendance
    });
    item.escalationLevel = escalationForState({
      state: item.currentState,
      coverageImpact: item.coverageImpact,
      criticalRoleMissing,
      minutesFromStart: item.minutesFromStart
    });
  }
}

async function insertHistoryEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    shiftId: string;
    shootId?: string | null;
    employeeId: string;
    actorUserId?: string | null;
    eventType: string;
    fromState?: AttendanceLiveState | null;
    toState?: AttendanceLiveState | null;
    signalSource?: AttendanceSignalSource | null;
    escalationLevel?: number | null;
    note?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      INSERT INTO shift_attendance_history (
        tenant_id,
        shift_id,
        shoot_id,
        employee_id,
        actor_user_id,
        event_type,
        from_state,
        to_state,
        signal_source,
        escalation_level,
        note,
        metadata
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::attendance_live_state,$8::attendance_live_state,$9::attendance_live_signal_source,$10,$11,$12::jsonb)
    `,
    [
      input.tenantId,
      input.shiftId,
      input.shootId ?? null,
      input.employeeId,
      input.actorUserId ?? null,
      input.eventType,
      input.fromState ?? null,
      input.toState ?? null,
      input.signalSource ?? null,
      input.escalationLevel ?? null,
      input.note ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
}

async function queueAttendanceNotification(
  client: PoolClient,
  input: {
    tenantId: string;
    shiftId: string;
    shootId?: string | null;
    eventCode: string;
    notificationType: string;
    title: string;
    body: string;
    priority: "normal" | "high" | "critical";
    deepLink?: string | null;
    dedupeKey: string;
    actorUserId?: string | null;
    metadata?: Record<string, unknown>;
    excludeUserIds?: string[];
  }
) {
  const recipients = await findNotificationRecipients(client, {
    tenantId: input.tenantId,
    eventCode: input.eventCode,
    shiftId: input.shiftId,
    shootId: input.shootId ?? null,
    excludeUserIds: input.excludeUserIds ?? []
  });
  if (!recipients.length) {
    return;
  }
  await queueNotificationDispatch(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    recipientUserIds: recipients,
    shiftId: input.shiftId,
    shootId: input.shootId ?? null,
    notificationType: input.notificationType,
    title: input.title,
    body: input.body,
    priority: input.priority,
    deepLink: input.deepLink ?? null,
    actionRequired: true,
    metadata: {
      ...(input.metadata ?? {}),
      dedupe: input.dedupeKey
    },
    sourceEvent: input.notificationType,
    groupKey: `attendance-live:${input.shiftId}:${input.dedupeKey}`
  });
}

async function publishRealtimeChange(client: PoolClient, item: EvaluatedAttendanceItem, changeType: string) {
  await createAppEvent(client, {
    tenantId: item.tenantId,
    eventType: "attendance.realtime.changed",
    aggregateType: "shift_attendance_runtime",
    aggregateId: item.shiftId,
    dedupeKey: `attendance-realtime:${item.shiftId}:${changeType}:${item.currentState}:${item.escalationLevel}`,
    payload: {
      change_type: changeType,
      shift_id: item.shiftId,
      shoot_id: item.shootId,
      employee_id: item.employeeId,
      current_state: item.currentState,
      escalation_level: item.escalationLevel,
      coverage_impact: item.coverageImpact
    }
  });
}

async function persistEvaluatedItem(
  client: PoolClient,
  existing: AttendanceRuntimeRow | null,
  item: EvaluatedAttendanceItem,
  actorUserId?: string | null
) {
  const stateChanged = existing?.current_state !== item.currentState;
  const escalationChanged = Number(existing?.escalation_level ?? 0) !== item.escalationLevel;
  const coverageChanged =
    Boolean(existing?.coverage_impact) !== item.coverageImpact ||
    Boolean(existing?.critical_role_missing) !== item.criticalRoleMissing ||
    Boolean(existing?.understaffed_due_to_attendance) !== item.understaffedDueToAttendance;
  const previousAlertTypes = [...(existing?.open_alert_types ?? [])];
  const nextAlertTypes = [...item.openAlertTypes];
  const previousAlertSet = new Set(previousAlertTypes);
  const nextAlertSet = new Set(nextAlertTypes);
  const openedAlerts = nextAlertTypes.filter((value) => !previousAlertSet.has(value));
  const clearedAlerts = previousAlertTypes.filter((value) => !nextAlertSet.has(value));
  const alertsChanged = JSON.stringify([...previousAlertTypes].sort()) !== JSON.stringify([...nextAlertTypes].sort());
  const reasonChanged = String(existing?.current_state_reason ?? "") !== item.currentStateReason;
  const signalChanged = String(existing?.signal_source ?? "") !== item.signalSource;

  const lastEscalatedAt =
    item.escalationLevel > Number(existing?.escalation_level ?? 0)
      ? new Date().toISOString()
      : existing?.last_escalated_at ?? null;

  await client.query(
    `
      UPDATE shift_attendance_runtime
      SET current_state = $2::attendance_live_state,
          current_state_reason = $3,
          signal_source = $4::attendance_live_signal_source,
          last_signal_at = $5::timestamptz,
          first_present_at = $6::timestamptz,
          first_present_source = $7::attendance_live_signal_source,
          latest_check_in_at = $8::timestamptz,
          latest_time_clock_start_at = $9::timestamptz,
          escalation_level = $10,
          last_escalated_at = $11::timestamptz,
          open_alert_types = $12::text[],
          coverage_impact = $13,
          critical_role_missing = $14,
          understaffed_due_to_attendance = $15,
          minimum_staff_count = $16,
          planned_staff_count = $17,
          required_lead_count = $18,
          active_present_count = $19,
          present_lead_count = $20,
          last_evaluated_at = now(),
          last_state_changed_at = CASE WHEN $21 THEN now() ELSE last_state_changed_at END,
          updated_at = now()
      WHERE shift_id = $1
    `,
    [
      item.shiftId,
      item.currentState,
      item.currentStateReason,
      item.signalSource,
      item.lastSignalAt,
      item.firstPresentAt,
      item.firstPresentSource,
      item.latestCheckInAt,
      item.latestTimeClockStartAt,
      item.escalationLevel,
      lastEscalatedAt,
      item.openAlertTypes,
      item.coverageImpact,
      item.criticalRoleMissing,
      item.understaffedDueToAttendance,
      item.minimumStaffCount,
      item.plannedStaffCount,
      item.requiredLeadCount,
      item.activePresentCount,
      item.presentLeadCount,
      stateChanged
    ]
  );

  if (stateChanged) {
    await insertHistoryEvent(client, {
      tenantId: item.tenantId,
      shiftId: item.shiftId,
      shootId: item.shootId,
      employeeId: item.employeeId,
      actorUserId: actorUserId ?? null,
      eventType: "state_changed",
      fromState: existing?.current_state ?? null,
      toState: item.currentState,
      signalSource: item.signalSource,
      escalationLevel: item.escalationLevel,
      note: item.currentStateReason
    });
  }

  if (escalationChanged) {
    await insertHistoryEvent(client, {
      tenantId: item.tenantId,
      shiftId: item.shiftId,
      shootId: item.shootId,
      employeeId: item.employeeId,
      actorUserId: actorUserId ?? null,
      eventType: "escalation_changed",
      fromState: existing?.current_state ?? item.currentState,
      toState: item.currentState,
      signalSource: item.signalSource,
      escalationLevel: item.escalationLevel,
      note: `Escalation level moved to ${item.escalationLevel}.`,
      metadata: { previous_escalation_level: existing?.escalation_level ?? 0 }
    });
  }

  if (coverageChanged) {
    await insertHistoryEvent(client, {
      tenantId: item.tenantId,
      shiftId: item.shiftId,
      shootId: item.shootId,
      employeeId: item.employeeId,
      actorUserId: actorUserId ?? null,
      eventType: "staffing_impact_changed",
      fromState: item.currentState,
      toState: item.currentState,
      signalSource: item.signalSource,
      escalationLevel: item.escalationLevel,
      note: item.coverageImpact ? "Attendance is now impacting coverage." : "Attendance coverage risk was cleared.",
      metadata: {
        coverage_impact: item.coverageImpact,
        critical_role_missing: item.criticalRoleMissing,
        understaffed_due_to_attendance: item.understaffedDueToAttendance,
        active_present_count: item.activePresentCount,
        present_lead_count: item.presentLeadCount
      }
    });
  }

  if (alertsChanged && (openedAlerts.length || clearedAlerts.length)) {
    await insertHistoryEvent(client, {
      tenantId: item.tenantId,
      shiftId: item.shiftId,
      shootId: item.shootId,
      employeeId: item.employeeId,
      actorUserId: actorUserId ?? null,
      eventType: "alerts_changed",
      fromState: item.currentState,
      toState: item.currentState,
      signalSource: item.signalSource,
      escalationLevel: item.escalationLevel,
      note: buildAlertChangeNote(openedAlerts, clearedAlerts),
      metadata: {
        previous_alert_types: previousAlertTypes,
        open_alert_types: nextAlertTypes,
        opened_alert_types: openedAlerts,
        cleared_alert_types: clearedAlerts
      }
    });
  }

  if (signalChanged && CAPTURED_ATTENDANCE_SIGNAL_SOURCES.has(item.signalSource)) {
    await insertHistoryEvent(client, {
      tenantId: item.tenantId,
      shiftId: item.shiftId,
      shootId: item.shootId,
      employeeId: item.employeeId,
      actorUserId: actorUserId ?? null,
      eventType: "signal_received",
      fromState: item.currentState,
      toState: item.currentState,
      signalSource: item.signalSource,
      escalationLevel: item.escalationLevel,
      note: `${normalizeSignalLabel(item.signalSource)} updated this attendance item.`,
      metadata: {
        previous_signal_source: existing?.signal_source ?? null,
        signal_source: item.signalSource,
        last_signal_at: item.lastSignalAt,
        latest_check_in_at: item.latestCheckInAt,
        latest_time_clock_start_at: item.latestTimeClockStartAt
      }
    });
  }

  if (alertsChanged || reasonChanged || signalChanged || stateChanged || escalationChanged || coverageChanged) {
    await publishRealtimeChange(client, item, stateChanged ? "state_changed" : escalationChanged ? "escalated" : "refreshed");
  }

  if (stateChanged || escalationChanged || coverageChanged) {
    const priority =
      item.currentState === "no_show" || item.currentState === "replacement_needed" || item.coverageImpact
        ? "critical"
        : item.currentState === "unresolved_no_check_in" || item.currentState === "called_out" || item.currentState === "late"
          ? "high"
          : "normal";
    const eventCode = `attendance.live.${item.currentState}`;
    const title =
      item.currentState === "no_show"
        ? `No-show confirmed: ${item.employeeName}`
        : item.currentState === "replacement_needed"
          ? `Replacement needed: ${item.shiftTitle}`
          : item.currentState === "called_out"
            ? `${item.employeeName} called out`
            : item.currentState === "unresolved_no_check_in"
              ? `Unresolved attendance: ${item.employeeName}`
              : item.currentState === "late" || item.currentState === "late_acknowledged"
                ? `Late arrival risk: ${item.employeeName}`
                : item.coverageImpact
                  ? `Coverage risk: ${item.shiftTitle}`
                  : "";
    if (title) {
      const bodyParts = [item.currentStateReason];
      if (item.coverageImpact) {
        bodyParts.push(`${item.activePresentCount}/${Math.max(item.minimumStaffCount, 1)} present`);
        if (item.criticalRoleMissing) {
          bodyParts.push("Critical role missing");
        }
      }
      await queueAttendanceNotification(client, {
        tenantId: item.tenantId,
        shiftId: item.shiftId,
        shootId: item.shootId,
        eventCode,
        notificationType: eventCode,
        title,
        body: bodyParts.filter(Boolean).join(" | "),
        priority,
        deepLink: item.coverageImpact ? item.schedulingHash : `#operations/attendance?date=${getLocalDateString(item.startsAt)}&shift=${item.shiftId}`,
        dedupeKey: `${item.currentState}:${item.escalationLevel}:${item.coverageImpact ? "coverage" : "state"}`,
        actorUserId: actorUserId ?? null,
        excludeUserIds: [item.employeeId],
        metadata: {
          current_state: item.currentState,
          escalation_level: item.escalationLevel,
          coverage_impact: item.coverageImpact,
          critical_role_missing: item.criticalRoleMissing
        }
      });
    }
  }
}

function mapItemRecord(item: EvaluatedAttendanceItem): AttendanceOperationsItemRecord {
  return {
    shift_id: item.shiftId,
    shoot_id: item.shootId,
    employee_id: item.employeeId,
    employee_name: item.employeeName,
    employee_email: item.employeeEmail,
    manager_user_id: item.managerUserId,
    manager_name: item.managerName,
    department: item.department,
    shift_title: item.shiftTitle,
    starts_at: item.startsAt,
    ends_at: item.endsAt,
    location_name: item.locationName,
    location_address: item.locationAddress,
    staffing_role: item.staffingRole,
    satisfies_lead_coverage: item.satisfiesLeadCoverage,
    shoot_code: item.shootCode,
    shoot_title: item.shootTitle,
    shoot_date: item.shootDate,
    school_name: item.schoolName,
    current_state: item.currentState,
    current_state_reason: item.currentStateReason,
    signal_source: item.signalSource,
    escalation_level: item.escalationLevel,
    last_signal_at: item.lastSignalAt,
    first_present_at: item.firstPresentAt,
    latest_check_in_at: item.latestCheckInAt,
    latest_time_clock_start_at: item.latestTimeClockStartAt,
    manager_mark_present_at: item.managerMarkPresentAt,
    late_acknowledged_at: item.lateAcknowledgedAt,
    called_out_at: item.calledOutAt,
    replacement_needed_at: item.replacementNeededAt,
    no_show_marked_at: item.noShowMarkedAt,
    manager_excused_at: item.managerExcusedAt,
    open_alert_types: item.openAlertTypes,
    coverage_impact: item.coverageImpact,
    critical_role_missing: item.criticalRoleMissing,
    understaffed_due_to_attendance: item.understaffedDueToAttendance,
    minimum_staff_count: item.minimumStaffCount,
    planned_staff_count: item.plannedStaffCount,
    required_lead_count: item.requiredLeadCount,
    active_present_count: item.activePresentCount,
    present_lead_count: item.presentLeadCount,
    minutes_from_start: item.minutesFromStart,
    minutes_until_start: item.minutesUntilStart,
    health_tone: toneForItem({
      current_state: item.currentState,
      coverage_impact: item.coverageImpact,
      critical_role_missing: item.criticalRoleMissing
    }),
    state_label: normalizeStateLabel(item.currentState),
    alert_labels: item.openAlertTypes.map(normalizeAlertLabel),
    scheduling_hash: item.schedulingHash
  };
}

async function refreshAttendanceRuntime(
  client: PoolClient,
  auth: AuthUser,
  options: { date: string; shiftId?: string | null; actorUserId?: string | null; allowMutation?: boolean }
) {
  const relevant = await listRelevantShifts(client, auth, options);
  if (options.allowMutation) {
    await ensureRuntimeRows(client, relevant.rows);
  }

  const departments = [...new Set(relevant.rows.map((row) => row.department || "schools"))];
  const policies = await resolveTimingPoliciesForDepartments(client, auth.tenantId, departments);
  const shiftIds = relevant.rows.map((row) => row.shift_id);
  const runtimeMap = await getRuntimeMap(client, auth.tenantId, shiftIds);
  const punchMap = await getPunchSignalMap(client, auth.tenantId, shiftIds);
  const timeClockMap = await getTimeClockSignalMap(client, auth.tenantId, shiftIds);
  const now = new Date();

  const evaluated: EvaluatedAttendanceItem[] = relevant.rows.map((shift) => {
    const runtime = runtimeMap.get(shift.shift_id) ?? null;
    const policy = policies.get(shift.department || "schools") ?? DEFAULT_POLICY;
    const punchSignals = punchMap.get(shift.shift_id);
    const timeClockSignal = timeClockMap.get(shift.shift_id);
    const canonicalCheckInAt = timeClockSignal?.latest_time_clock_start_at ?? runtime?.latest_time_clock_start_at ?? null;
    const derived = deriveAttendanceState({
      shift,
      runtime,
      firstCheckInAt: canonicalCheckInAt ? runtime?.first_present_at ?? canonicalCheckInAt : punchSignals?.first_check_in_at ?? runtime?.first_present_at ?? null,
      latestCheckInAt: canonicalCheckInAt ? canonicalCheckInAt : punchSignals?.latest_check_in_at ?? runtime?.latest_check_in_at ?? null,
      latestTimeClockStartAt: canonicalCheckInAt,
      policy,
      now
    });

    return {
      shiftId: shift.shift_id,
      tenantId: shift.tenant_id,
      shootId: shift.shoot_id,
      employeeId: shift.employee_id,
      employeeName: shift.employee_name,
      employeeEmail: shift.employee_email,
      managerUserId: shift.manager_user_id,
      managerName: shift.manager_name,
      department: shift.department,
      shiftTitle: shift.shift_title,
      startsAt: shift.starts_at,
      endsAt: shift.ends_at,
      shiftStatus: shift.shift_status,
      cancelledAt: shift.cancelled_at,
      locationName: shift.location_name,
      locationAddress: shift.location_address,
      staffingRole: shift.staffing_role,
      satisfiesLeadCoverage: shift.satisfies_lead_coverage,
      shootCode: shift.shoot_code,
      shootTitle: shift.shoot_title,
      shootDate: shift.shoot_date,
      schoolName: shift.school_name,
      minimumStaffCount: shift.minimum_staff_count,
      plannedStaffCount: shift.planned_staff_count,
      requiredLeadCount: shift.required_lead_count,
      currentState: derived.state,
      currentStateReason: derived.reason,
      signalSource: derived.signalSource,
      lastSignalAt: derived.lastSignalAt?.toISOString() ?? null,
      firstPresentAt: (runtime?.first_present_at ?? derived.presentAt?.toISOString()) ?? null,
      firstPresentSource:
        runtime?.first_present_source ??
        (derived.presentAt
          ? derived.signalSource === "manager_mark_present" || derived.signalSource === "manager_acknowledge_late"
            ? "manager_mark_present"
            : derived.signalSource === "time_clock_start"
              ? "time_clock_start"
              : "employee_check_in"
          : null),
      latestCheckInAt: derived.latestCheckInAt?.toISOString() ?? null,
      latestTimeClockStartAt: derived.latestTimeClockStartAt?.toISOString() ?? null,
      managerMarkPresentAt: runtime?.manager_mark_present_at ?? null,
      managerMarkPresentByUserId: runtime?.manager_mark_present_by_user_id ?? null,
      lateAcknowledgedAt: runtime?.late_acknowledged_at ?? null,
      lateAcknowledgedByUserId: runtime?.late_acknowledged_by_user_id ?? null,
      calledOutAt: runtime?.called_out_at ?? null,
      calledOutByUserId: runtime?.called_out_by_user_id ?? null,
      replacementNeededAt: runtime?.replacement_needed_at ?? null,
      replacementNeededByUserId: runtime?.replacement_needed_by_user_id ?? null,
      noShowMarkedAt: runtime?.no_show_marked_at ?? null,
      noShowMarkedByUserId: runtime?.no_show_marked_by_user_id ?? null,
      managerExcusedAt: runtime?.manager_excused_at ?? null,
      managerExcusedByUserId: runtime?.manager_excused_by_user_id ?? null,
      escalationLevel: runtime?.escalation_level ?? 0,
      lastEscalatedAt: runtime?.last_escalated_at ?? null,
      openAlertTypes: runtime?.open_alert_types ?? [],
      coverageImpact: runtime?.coverage_impact ?? false,
      criticalRoleMissing: runtime?.critical_role_missing ?? false,
      understaffedDueToAttendance: runtime?.understaffed_due_to_attendance ?? false,
      activePresentCount: runtime?.active_present_count ?? 0,
      presentLeadCount: runtime?.present_lead_count ?? 0,
      lastEvaluatedAt: runtime?.last_evaluated_at ?? null,
      lastStateChangedAt: runtime?.last_state_changed_at ?? new Date().toISOString(),
      minutesFromStart: derived.minutesFromStart,
      minutesUntilStart: derived.minutesUntilStart,
      timingPolicy: policy,
      schedulingHash: buildSchedulingHash({
        shiftId: shift.shift_id,
        shootId: shift.shoot_id,
        startsAt: shift.starts_at
      })
    };
  });

  applyStaffingRisk(evaluated);

  if (options.allowMutation) {
    for (const item of evaluated) {
      await persistEvaluatedItem(client, runtimeMap.get(item.shiftId) ?? null, item, options.actorUserId ?? null);
    }
  }

  return {
    items: evaluated.sort((left, right) => {
      return (
        Number(right.coverageImpact) - Number(left.coverageImpact) ||
        right.escalationLevel - left.escalationLevel ||
        new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
      );
    }),
    scope: relevant.scope
  };
}

async function refreshAttendanceRuntimeForTenant(
  client: PoolClient,
  tenantId: string,
  options: { date: string; shiftId?: string | null; actorUserId?: string | null; allowMutation?: boolean }
) {
  const rows = await listRelevantShiftsForTenant(client, tenantId, options);
  if (options.allowMutation) {
    await ensureRuntimeRows(client, rows);
  }

  const departments = [...new Set(rows.map((row) => row.department || "schools"))];
  const policies = await resolveTimingPoliciesForDepartments(client, tenantId, departments);
  const shiftIds = rows.map((row) => row.shift_id);
  const runtimeMap = await getRuntimeMap(client, tenantId, shiftIds);
  const punchMap = await getPunchSignalMap(client, tenantId, shiftIds);
  const timeClockMap = await getTimeClockSignalMap(client, tenantId, shiftIds);
  const now = new Date();

  const evaluated: EvaluatedAttendanceItem[] = rows.map((shift) => {
    const runtime = runtimeMap.get(shift.shift_id) ?? null;
    const policy = policies.get(shift.department || "schools") ?? DEFAULT_POLICY;
    const punchSignals = punchMap.get(shift.shift_id);
    const timeClockSignal = timeClockMap.get(shift.shift_id);
    const canonicalCheckInAt = timeClockSignal?.latest_time_clock_start_at ?? runtime?.latest_time_clock_start_at ?? null;
    const derived = deriveAttendanceState({
      shift,
      runtime,
      firstCheckInAt: canonicalCheckInAt ? runtime?.first_present_at ?? canonicalCheckInAt : punchSignals?.first_check_in_at ?? runtime?.first_present_at ?? null,
      latestCheckInAt: canonicalCheckInAt ? canonicalCheckInAt : punchSignals?.latest_check_in_at ?? runtime?.latest_check_in_at ?? null,
      latestTimeClockStartAt: canonicalCheckInAt,
      policy,
      now
    });

    return {
      shiftId: shift.shift_id,
      tenantId: shift.tenant_id,
      shootId: shift.shoot_id,
      employeeId: shift.employee_id,
      employeeName: shift.employee_name,
      employeeEmail: shift.employee_email,
      managerUserId: shift.manager_user_id,
      managerName: shift.manager_name,
      department: shift.department,
      shiftTitle: shift.shift_title,
      startsAt: shift.starts_at,
      endsAt: shift.ends_at,
      shiftStatus: shift.shift_status,
      cancelledAt: shift.cancelled_at,
      locationName: shift.location_name,
      locationAddress: shift.location_address,
      staffingRole: shift.staffing_role,
      satisfiesLeadCoverage: Boolean(shift.satisfies_lead_coverage),
      shootCode: shift.shoot_code,
      shootTitle: shift.shoot_title,
      shootDate: shift.shoot_date,
      schoolName: shift.school_name,
      minimumStaffCount: shift.minimum_staff_count,
      plannedStaffCount: shift.planned_staff_count,
      requiredLeadCount: shift.required_lead_count,
      currentState: derived.state,
      currentStateReason: derived.reason,
      signalSource: derived.signalSource,
      lastSignalAt: derived.lastSignalAt?.toISOString() ?? null,
      firstPresentAt: (runtime?.first_present_at ?? derived.presentAt?.toISOString()) ?? null,
      firstPresentSource:
        runtime?.first_present_source ??
        (derived.presentAt
          ? derived.signalSource === "manager_mark_present" || derived.signalSource === "manager_acknowledge_late"
            ? "manager_mark_present"
            : derived.signalSource === "time_clock_start"
              ? "time_clock_start"
              : "employee_check_in"
          : null),
      latestCheckInAt: derived.latestCheckInAt?.toISOString() ?? null,
      latestTimeClockStartAt: derived.latestTimeClockStartAt?.toISOString() ?? null,
      managerMarkPresentAt: runtime?.manager_mark_present_at ?? null,
      managerMarkPresentByUserId: runtime?.manager_mark_present_by_user_id ?? null,
      lateAcknowledgedAt: runtime?.late_acknowledged_at ?? null,
      lateAcknowledgedByUserId: runtime?.late_acknowledged_by_user_id ?? null,
      calledOutAt: runtime?.called_out_at ?? null,
      calledOutByUserId: runtime?.called_out_by_user_id ?? null,
      replacementNeededAt: runtime?.replacement_needed_at ?? null,
      replacementNeededByUserId: runtime?.replacement_needed_by_user_id ?? null,
      noShowMarkedAt: runtime?.no_show_marked_at ?? null,
      noShowMarkedByUserId: runtime?.no_show_marked_by_user_id ?? null,
      managerExcusedAt: runtime?.manager_excused_at ?? null,
      managerExcusedByUserId: runtime?.manager_excused_by_user_id ?? null,
      escalationLevel: runtime?.escalation_level ?? 0,
      lastEscalatedAt: runtime?.last_escalated_at ?? null,
      openAlertTypes: runtime?.open_alert_types ?? [],
      coverageImpact: runtime?.coverage_impact ?? false,
      criticalRoleMissing: runtime?.critical_role_missing ?? false,
      understaffedDueToAttendance: runtime?.understaffed_due_to_attendance ?? false,
      activePresentCount: runtime?.active_present_count ?? 0,
      presentLeadCount: runtime?.present_lead_count ?? 0,
      lastEvaluatedAt: runtime?.last_evaluated_at ?? null,
      lastStateChangedAt: runtime?.last_state_changed_at ?? new Date().toISOString(),
      minutesFromStart: derived.minutesFromStart,
      minutesUntilStart: derived.minutesUntilStart,
      timingPolicy: policy,
      schedulingHash: buildSchedulingHash({
        shiftId: shift.shift_id,
        shootId: shift.shoot_id,
        startsAt: shift.starts_at
      })
    };
  });

  applyStaffingRisk(evaluated);

  if (options.allowMutation) {
    for (const item of evaluated) {
      await persistEvaluatedItem(client, runtimeMap.get(item.shiftId) ?? null, item, options.actorUserId ?? null);
    }
  }

  return evaluated.sort((left, right) => {
    return (
      Number(right.coverageImpact) - Number(left.coverageImpact) ||
      right.escalationLevel - left.escalationLevel ||
      new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
    );
  });
}

function buildWorkspaceSections(items: AttendanceOperationsItemRecord[]) {
  const criticalRisk = items.filter((item) => item.coverage_impact || item.current_state === "no_show");
  const lateWatch = items.filter((item) =>
    ["late", "late_acknowledged", "unresolved_no_check_in"].includes(item.current_state)
  );
  const coverageReplacement = items.filter((item) =>
    ["called_out", "replacement_needed"].includes(item.current_state)
  );
  const checkedIn = items.filter((item) => ["checked_in", "on_time"].includes(item.current_state));
  const resolved = items.filter((item) => ["manager_excused", "completed", "canceled"].includes(item.current_state));

  return [
    {
      key: "critical_risk" as const,
      label: "Critical Coverage Risk",
      description: "Attendance problems already impacting lead coverage or minimum staffing.",
      count: criticalRisk.length,
      items: criticalRisk
    },
    {
      key: "late_watch" as const,
      label: "Late And Unresolved",
      description: "People who are late, acknowledged late, or still unresolved after the start window.",
      count: lateWatch.length,
      items: lateWatch
    },
    {
      key: "coverage_replacement" as const,
      label: "Callouts And Replacement",
      description: "Callouts, replacement-needed shifts, and same-day coverage handoffs.",
      count: coverageReplacement.length,
      items: coverageReplacement
    },
    {
      key: "checked_in" as const,
      label: "Checked In And On Time",
      description: "Assignments that have confirmed attendance and are operationally on track.",
      count: checkedIn.length,
      items: checkedIn
    },
    {
      key: "resolved" as const,
      label: "Resolved / Closed",
      description: "Excused, completed, or canceled assignments for the selected day.",
      count: resolved.length,
      items: resolved
    }
  ];
}

function buildHomeReadySummary(items: AttendanceOperationsItemRecord[]) {
  const urgentItems = items
    .filter((item) => item.coverage_impact || ["unresolved_no_check_in", "replacement_needed", "no_show"].includes(item.current_state))
    .slice(0, 5)
    .map((item) => ({
      shift_id: item.shift_id,
      title: item.school_name ?? item.shoot_title ?? item.shift_title,
      summary: `${item.employee_name} | ${item.state_label}${item.coverage_impact ? " | Coverage risk" : ""}`,
      urgency_label: item.coverage_impact ? "Coverage risk" : normalizeStateLabel(item.current_state),
      state: item.current_state,
      scheduling_hash: item.scheduling_hash
    }));

  const urgentCount = items.filter((item) =>
    ["late", "unresolved_no_check_in", "replacement_needed", "no_show", "called_out"].includes(item.current_state)
  ).length;
  const staffingRiskCount = items.filter((item) => item.coverage_impact).length;
  return {
    visible: urgentCount > 0 || staffingRiskCount > 0,
    summary_line:
      staffingRiskCount > 0
        ? `${staffingRiskCount} attendance issue${staffingRiskCount === 1 ? "" : "s"} are now impacting coverage.`
        : urgentCount > 0
          ? `${urgentCount} live attendance issue${urgentCount === 1 ? "" : "s"} need review.`
          : "Attendance is on track.",
    urgent_count: urgentCount,
    staffing_risk_count: staffingRiskCount,
    items: urgentItems
  };
}

function availableActionsForItem(item: AttendanceOperationsItemRecord): AttendanceOperationsAction[] {
  if (item.current_state === "completed" || item.current_state === "canceled") {
    return [];
  }
  const actions: AttendanceOperationsAction[] = ["mark_present", "mark_called_out", "request_replacement", "mark_no_show", "excuse"];
  if (item.current_state === "late" || item.current_state === "unresolved_no_check_in") {
    actions.unshift("acknowledge_late");
  }
  return [...new Set(actions)];
}

export async function getAttendanceOperationsWorkspace(
  client: PoolClient,
  auth: AuthUser,
  options: { date?: string | null }
): Promise<AttendanceOperationsWorkspaceRecord> {
  const date = options.date?.trim() || getLocalDateString();
  const refreshed = await refreshAttendanceRuntime(client, auth, { date });
  const items = refreshed.items.map(mapItemRecord);
  const timingRules = refreshed.items[0]?.timingPolicy ?? DEFAULT_POLICY;
  return {
    generated_at: new Date().toISOString(),
    date,
    scope: refreshed.scope,
    timing_rules: timingRules,
    summary: {
      tracked_shift_count: items.length,
      on_time_count: items.filter((item) => item.current_state === "on_time").length,
      checked_in_count: items.filter((item) => item.current_state === "checked_in").length,
      late_count: items.filter((item) => item.current_state === "late" || item.current_state === "late_acknowledged").length,
      unresolved_count: items.filter((item) => item.current_state === "unresolved_no_check_in").length,
      called_out_count: items.filter((item) => item.current_state === "called_out").length,
      replacement_needed_count: items.filter((item) => item.current_state === "replacement_needed").length,
      no_show_count: items.filter((item) => item.current_state === "no_show").length,
      coverage_impact_count: items.filter((item) => item.coverage_impact).length,
      critical_role_missing_count: items.filter((item) => item.critical_role_missing).length,
      understaffed_due_to_attendance_count: items.filter((item) => item.understaffed_due_to_attendance).length
    },
    sections: buildWorkspaceSections(items),
    home_ready_summary: buildHomeReadySummary(items)
  };
}

export async function listAttendanceUrgentWatchCandidates(
  client: PoolClient,
  tenantId: string,
  date: string
): Promise<UrgentWatchCandidate[]> {
  const items = await refreshAttendanceRuntimeForTenant(client, tenantId, { date });
  const now = Date.now();
  const candidates: UrgentWatchCandidate[] = [];

  for (const item of items) {
    const dueAt = item.startsAt;
    const dueMs = new Date(dueAt).getTime();
    const severity = dueMs <= now + 24 * 60 * 60 * 1000 || item.escalationLevel >= 2 ? "red" : "yellow";
    const actionHash =
      item.coverageImpact && item.schedulingHash
        ? item.schedulingHash
        : `#operations/attendance?date=${getLocalDateString(item.startsAt)}&shift=${item.shiftId}`;
    const sourceSnapshot = {
      shift_id: item.shiftId,
      shoot_id: item.shootId,
      employee_id: item.employeeId,
      current_state: item.currentState,
      escalation_level: item.escalationLevel,
      coverage_impact: item.coverageImpact,
      critical_role_missing: item.criticalRoleMissing,
      understaffed_due_to_attendance: item.understaffedDueToAttendance,
      scheduling_hash: item.schedulingHash
    };

    if (item.currentState === "replacement_needed" || (item.currentState === "called_out" && item.coverageImpact)) {
      candidates.push({
        source_module: "attendance",
        source_entity_type: "shift_attendance_runtime",
        source_entity_id: item.shiftId,
        source_entity_label: item.shootCode ?? item.shiftTitle,
        scope_department: item.department,
        watch_type: "replacement_needed",
        severity,
        title: `${item.employeeName} needs replacement coverage`,
        summary: `${item.schoolName ?? item.shootTitle ?? item.shiftTitle} is short coverage because ${item.employeeName} is marked ${normalizeStateLabel(item.currentState).toLowerCase()}.`,
        owner_user_id: item.managerUserId,
        owner_label: item.managerName ?? null,
        due_at: dueAt,
        next_action_label: item.coverageImpact ? "Open Scheduling" : "Open attendance detail",
        action_hash: actionHash,
        operational_impact_score: 110 + item.escalationLevel * 10 + (item.coverageImpact ? 30 : 0),
        source_snapshot: sourceSnapshot
      });
      continue;
    }

    if (
      item.coverageImpact ||
      item.criticalRoleMissing ||
      item.understaffedDueToAttendance ||
      ["late", "late_acknowledged", "unresolved_no_check_in", "no_show"].includes(item.currentState)
    ) {
      candidates.push({
        source_module: "attendance",
        source_entity_type: "shift_attendance_runtime",
        source_entity_id: item.shiftId,
        source_entity_label: item.shootCode ?? item.shiftTitle,
        scope_department: item.department,
        watch_type: "attendance_failure_staffing_risk",
        severity,
        title: `${item.employeeName} attendance is putting coverage at risk`,
        summary: `${item.schoolName ?? item.shootTitle ?? item.shiftTitle} is tracking ${normalizeStateLabel(item.currentState).toLowerCase()}${item.coverageImpact ? " with live coverage impact" : ""}.`,
        owner_user_id: item.managerUserId,
        owner_label: item.managerName ?? null,
        due_at: dueAt,
        next_action_label: item.coverageImpact ? "Open Scheduling" : "Open attendance detail",
        action_hash: actionHash,
        operational_impact_score:
          95 +
          item.escalationLevel * 10 +
          (item.coverageImpact ? 20 : 0) +
          (item.criticalRoleMissing ? 15 : 0) +
          (item.understaffedDueToAttendance ? 10 : 0),
        source_snapshot: sourceSnapshot
      });
    }
  }

  return candidates;
}

export async function getAttendanceOperationDetail(
  client: PoolClient,
  auth: AuthUser,
  shiftId: string
): Promise<AttendanceOperationDetailRecord> {
  await assertShiftAccess(client, auth, shiftId);
  const dateRow = await client.query<{ starts_at: string }>(
    `SELECT starts_at::text FROM work_shift WHERE tenant_id = $1 AND id = $2`,
    [auth.tenantId, shiftId]
  );
  if (!dateRow.rows[0]) {
    throw new ApiError(404, "Shift not found.");
  }
  const date = getLocalDateString(dateRow.rows[0].starts_at);
  const refreshed = await refreshAttendanceRuntime(client, auth, { date, shiftId });
  const item = refreshed.items.find((row) => row.shiftId === shiftId);
  if (!item) {
    throw new ApiError(404, "Attendance item not found.");
  }

  const { rows } = await client.query<AttendanceHistoryRow>(
    `
      SELECT
        history.id,
        history.event_type,
        history.from_state,
        history.to_state,
        history.signal_source,
        history.escalation_level,
        history.note,
        history.metadata,
        history.created_at::text,
        history.actor_user_id::text,
        actor.full_name AS actor_user_name
      FROM shift_attendance_history history
      LEFT JOIN app_user actor
        ON actor.tenant_id = history.tenant_id
       AND actor.id = history.actor_user_id
      WHERE history.tenant_id = $1
        AND history.shift_id = $2
      ORDER BY history.created_at DESC
      LIMIT 40
    `,
    [auth.tenantId, shiftId]
  );

  const record = mapItemRecord(item);
  return {
    generated_at: new Date().toISOString(),
    item: record,
    available_actions: availableActionsForItem(record),
    staffing_impact: {
      coverage_impact: record.coverage_impact,
      critical_role_missing: record.critical_role_missing,
      understaffed_due_to_attendance: record.understaffed_due_to_attendance,
      minimum_staff_count: record.minimum_staff_count,
      planned_staff_count: record.planned_staff_count,
      required_lead_count: record.required_lead_count,
      active_present_count: record.active_present_count,
      present_lead_count: record.present_lead_count,
      scheduling_hash: record.scheduling_hash
    },
    history: rows
  };
}

async function applyAttendanceActionFlags(
  client: PoolClient,
  auth: AuthUser,
  shiftId: string,
  action: AttendanceOperationsAction
) {
  const now = new Date().toISOString();
  switch (action) {
    case "mark_present":
      await client.query(
        `
          UPDATE shift_attendance_runtime
          SET manager_mark_present_at = $3::timestamptz,
              manager_mark_present_by_user_id = $4,
              called_out_at = NULL,
              called_out_by_user_id = NULL,
              replacement_needed_at = NULL,
              replacement_needed_by_user_id = NULL,
              no_show_marked_at = NULL,
              no_show_marked_by_user_id = NULL,
              manager_excused_at = NULL,
              manager_excused_by_user_id = NULL,
              updated_at = now()
          WHERE tenant_id = $1
            AND shift_id = $2
        `,
        [auth.tenantId, shiftId, now, auth.id]
      );
      return now;
    case "acknowledge_late":
      await client.query(
        `
          UPDATE shift_attendance_runtime
          SET late_acknowledged_at = $3::timestamptz,
              late_acknowledged_by_user_id = $4,
              updated_at = now()
          WHERE tenant_id = $1
            AND shift_id = $2
        `,
        [auth.tenantId, shiftId, now, auth.id]
      );
      return now;
    case "mark_called_out":
      await client.query(
        `
          UPDATE shift_attendance_runtime
          SET called_out_at = $3::timestamptz,
              called_out_by_user_id = $4,
              manager_excused_at = NULL,
              manager_excused_by_user_id = NULL,
              updated_at = now()
          WHERE tenant_id = $1
            AND shift_id = $2
        `,
        [auth.tenantId, shiftId, now, auth.id]
      );
      return now;
    case "request_replacement":
      await client.query(
        `
          UPDATE shift_attendance_runtime
          SET replacement_needed_at = $3::timestamptz,
              replacement_needed_by_user_id = $4,
              updated_at = now()
          WHERE tenant_id = $1
            AND shift_id = $2
        `,
        [auth.tenantId, shiftId, now, auth.id]
      );
      return now;
    case "mark_no_show":
      await client.query(
        `
          UPDATE shift_attendance_runtime
          SET no_show_marked_at = $3::timestamptz,
              no_show_marked_by_user_id = $4,
              updated_at = now()
          WHERE tenant_id = $1
            AND shift_id = $2
        `,
        [auth.tenantId, shiftId, now, auth.id]
      );
      return now;
    case "excuse":
      await client.query(
        `
          UPDATE shift_attendance_runtime
          SET manager_excused_at = $3::timestamptz,
              manager_excused_by_user_id = $4,
              called_out_at = NULL,
              called_out_by_user_id = NULL,
              replacement_needed_at = NULL,
              replacement_needed_by_user_id = NULL,
              no_show_marked_at = NULL,
              no_show_marked_by_user_id = NULL,
              updated_at = now()
          WHERE tenant_id = $1
            AND shift_id = $2
        `,
        [auth.tenantId, shiftId, now, auth.id]
      );
      return now;
  }
}

export async function applyAttendanceOperationAction(
  client: PoolClient,
  auth: AuthUser,
  input: {
    shiftId: string;
    action: AttendanceOperationsAction;
    note?: string | null;
  }
): Promise<AttendanceOperationDetailRecord> {
  await assertShiftManagementScope(client, auth, input.shiftId);
  const shift = await client.query<{
    id: string;
    shoot_id: string | null;
    assigned_user_id: string;
    starts_at: string;
  }>(
    `
      SELECT id, shoot_id, assigned_user_id, starts_at::text
      FROM work_shift
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, input.shiftId]
  );
  const row = shift.rows[0];
  if (!row) {
    throw new ApiError(404, "Shift not found.");
  }

  await refreshAttendanceRuntime(client, auth, {
    date: getLocalDateString(row.starts_at),
    shiftId: input.shiftId,
    allowMutation: true
  });
  const actedAt = await applyAttendanceActionFlags(client, auth, input.shiftId, input.action);
  await insertHistoryEvent(client, {
    tenantId: auth.tenantId,
    shiftId: input.shiftId,
    shootId: row.shoot_id ?? null,
    employeeId: row.assigned_user_id,
    actorUserId: auth.id,
    eventType: actionEventType(input.action),
    signalSource: actionSignalSource(input.action),
    note: input.note?.trim() || null,
    metadata: {
      acted_at: actedAt,
      action: input.action
    }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: row.assigned_user_id,
    action: `attendance_operation.${input.action}`,
    entityType: "shift_attendance_runtime",
    entityId: input.shiftId,
    reasonComment: input.note?.trim() || null,
    metadata: {
      shift_id: input.shiftId,
      shoot_id: row.shoot_id,
      action: input.action
    }
  });

  const detail = await getAttendanceOperationDetail(client, auth, input.shiftId);
  const item = detail.item;
  if (["mark_called_out", "request_replacement", "mark_no_show"].includes(input.action)) {
    await queueAttendanceNotification(client, {
      tenantId: auth.tenantId,
      shiftId: input.shiftId,
      shootId: row.shoot_id ?? null,
      eventCode: `attendance.live.${item.current_state}`,
      notificationType: `attendance.live.${item.current_state}`,
      title:
        input.action === "mark_called_out"
          ? `${item.employee_name} called out`
          : input.action === "request_replacement"
            ? `Replacement needed for ${item.shift_title}`
            : `No-show marked for ${item.employee_name}`,
      body: input.note?.trim() || item.current_state_reason,
      priority: input.action === "mark_called_out" ? "high" : "critical",
      deepLink: item.coverage_impact ? item.scheduling_hash : `#operations/attendance?date=${getLocalDateString(item.starts_at)}&shift=${item.shift_id}`,
      dedupeKey: `manual-${input.action}:${item.current_state}:${getLocalDateString()}`,
      actorUserId: auth.id,
      excludeUserIds: [item.employee_id],
      metadata: {
        manual_action: input.action,
        coverage_impact: item.coverage_impact
      }
    });
  }

  return detail;
}
