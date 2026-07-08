import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import { canPerformAction, isFieldRole } from "../authz/policy.js";
import { canEditHours, hasJobFunctionProfile } from "../authz/authority.js";
import type { AuthUser } from "../types/auth.js";
import { evaluatePunchLocation } from "./geo.js";
import { createStatusEvent } from "./statusEvents.js";
import { createAuditLog } from "./audit.js";
import { findNotificationRecipients, queueNotificationDispatch } from "./opsNotifications.js";
import { createTimeClockExceptionRequest, getTimeClockStateSummary, syncTimeClockForPunch, type TimeClockStateSummary } from "./timeClockRuntime.js";
import { resolveTimeClockPresenceIncidents } from "./timeClockPresence.js";
import { resolveTimeClockComplianceFlags } from "./timeClockCompliance.js";
import { getStudioLocation } from "./maps.js";
import { assertShiftAccess, assertShiftManagementScope, shouldRestrictShiftList } from "./shiftAccess.js";
import { assertShootAccess } from "./shootAccess.js";
import { getShiftById } from "./scheduling.js";
import { handleClockOutCloseoutCompliance, type ShiftCloseoutCompliance } from "./postShootEvaluations.js";
import { beginDangerousAction, completeDangerousAction, failDangerousAction } from "./dangerousActions.js";
import {
  getApprovalLevelLabel,
  resolveAttendanceApprovalLevel,
  resolvePhase1RoleGroup
} from "./approvalRights.js";
import {
  assertLunchChallengeReviewer,
  isNoLunchChallengeException,
  syncTimeSessionPayrollSummary
} from "./timeClockPayroll.js";
import { getLocalDateString, getLocalDayBounds } from "../utils/localDate.js";
import { createAppEvent } from "./outbox.js";
import {
  ATTENDANCE_POLICY,
  calculateDurationMinutes,
  getAttendanceStateForPunch,
  getAutoBreakDeductionMinutes,
  getClockInAllowanceMinutes,
  getLateMinutes,
  getPunchTimingStatus
} from "./attendanceRules.js";
import {
  ATTENDANCE_AWARENESS_POLICY,
  classifyOperationalPunchTiming,
  humanizeOperationalLocation
} from "./attendanceAwareness.js";
import { deriveTimeReviewSummary, isFinalizedTimeSessionStatus } from "./timeClockReview.js";
import { guardSessionMutationForPayroll } from "./payrollPeriods.js";
import type { AttendanceState, PunchTimingStatus } from "../types/domain.js";
import type { TimeSegmentReviewStatus, TimeSegmentSourceType, TimeSessionStatus, TimeWorkState } from "../types/timeClock.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

const MAX_BACKDATED_PUNCH_EDIT_DAYS = 10;

export type PunchInput = {
  shiftId?: string | null;
  shootId?: string | null;
  direction: "in" | "out";
  clientTimestamp: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  clientEventId?: string | null;
  idempotencyKey?: string | null;
  attestedApproved?: boolean;
  approverUserId?: string | null;
  reasonCode?: string | null;
  notes?: string | null;
  source?: string | null;
  enforcementMode?: "standard" | "legacy_compat";
  workState?: "office_drive" | "photography" | null;
  confirmedOutsideContext?: boolean;
  confirmedPermission?: boolean;
};

export type AttendanceExceptionRequestInput = {
  shift_id?: string | null;
  punch_id?: string | null;
  exception_type: string;
  reason_code: string;
  notes?: string | null;
  requested_value?: Record<string, unknown>;
  original_value?: Record<string, unknown>;
  requested_approver_user_id?: string | null;
};

export type MissedPunchRequestInput = {
  shift_id: string;
  missing_direction: "in" | "out";
  employee_submitted_explanation: string;
  requested_approver_user_id?: string | null;
  corrected_time?: string | null;
  requested_work_state?: TimeWorkState | null;
  requested_start_time?: string | null;
  requested_end_time?: string | null;
  location_context?: Record<string, unknown> | null;
  notes?: string | null;
};

export type LeadershipTimeAdjustmentInput = {
  employee_id: string;
  shift_id?: string | null;
  segment_id?: string | null;
  requested_work_state: TimeWorkState;
  requested_start_time: string;
  requested_end_time?: string | null;
  note: string;
};

type ShiftContext = {
  id: string;
  tenant_id: string;
  shoot_id: string | null;
  shoot_date?: string | null;
  assigned_user_id: string;
  manager_user_id: string | null;
  title: string;
  department: string;
  shift_kind: string;
  starts_at: string;
  ends_at: string;
  status: string;
  location_name: string;
  location_address: string;
  location_lat: number | null;
  location_lng: number | null;
  geofence_radius_meters: number;
  staffing_role: string | null;
  satisfies_lead_coverage: boolean;
};

type ShiftPunchRow = {
  id: string;
  tenant_id: string;
  shift_id: string | null;
  shoot_id: string | null;
  user_id: string;
  direction: "in" | "out";
  status_event_id: string | null;
  client_timestamp: string;
  geofence_status: string;
  gps_confidence: string;
  approval_state: string;
  source?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracy_meters?: number | null;
  distance_from_expected_meters?: number | null;
  expected_geofence_radius_meters?: number | null;
  timing_status?: string | null;
  early_minutes?: number | null;
  late_minutes?: number | null;
  missed_punch_required?: boolean | null;
  unscheduled?: boolean | null;
  requires_approval?: boolean | null;
  attested_approved?: boolean | null;
  approver_user_id?: string | null;
  reason_code?: string | null;
  notes?: string | null;
  high_priority?: boolean | null;
  created_at: string;
};

type ClockStatusEventRow = {
  id: string;
  shoot_id: string;
  type: string;
  captured_at: string;
  geofence_status: string;
  created_at: string;
};

type TimeEntryRow = {
  id: string;
  shift_id: string | null;
  shoot_id: string | null;
  user_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  minutes_worked: number | null;
  scheduled_minutes: number | null;
  gross_minutes: number | null;
  break_deduction_minutes: number;
  break_deduction_applied: boolean;
  break_deduction_source: string;
  break_deduction_overridden: boolean;
  break_deduction_override_reason: string | null;
  break_deduction_overridden_by_user_id: string | null;
  payable_minutes: number | null;
  approved_payable_minutes: number | null;
  attendance_state: AttendanceState;
  payroll_state: string;
  created_at: string;
};

type TimeSessionRow = {
  id: string;
  tenant_id: string;
  employee_id: string;
  work_date: string;
  source_shift_id: string | null;
  status: "open" | "closed" | "needs_end_of_day_confirmation" | "approved" | "payroll_exported";
  created_at: string;
  updated_at: string;
};

type TimeSegmentRow = {
  id: string;
  tenant_id: string;
  session_id: string;
  employee_id: string;
  linked_shift_id: string | null;
  work_state: TimeWorkState;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  supersedes_segment_id: string | null;
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
  source_type: TimeSegmentSourceType;
  geofence_supported: boolean;
  review_status: TimeSegmentReviewStatus;
  reporting_flags: string[];
  created_at: string;
  updated_at: string;
};

type TimeClockExceptionRequestRow = {
  id: string;
  tenant_id: string;
  employee_id: string;
  request_type: string;
  linked_shift_id: string | null;
  linked_shoot_id: string | null;
  linked_session_id: string | null;
  linked_segment_id: string | null;
  requested_approver_id: string | null;
  related_attendance_exception_id: string | null;
  requested_state: TimeWorkState | null;
  requested_start_time: string | null;
  requested_end_time: string | null;
  location_context: Record<string, unknown>;
  original_values: Record<string, unknown>;
  resolved_values: Record<string, unknown>;
  reporting_flags: string[];
  note: string;
  status: "submitted" | "under_review" | "approved" | "rejected" | "cancelled";
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

type ApprovalRecordRow = {
  id: string;
  tenant_id: string;
  request_id: string;
  approver_id: string;
  approver_role: string;
  decision: "approved" | "rejected" | "returned";
  comment: string | null;
  decided_at: string;
};

type AttendanceExceptionRow = {
  id: string;
  shift_id: string | null;
  punch_id: string | null;
  shoot_id: string | null;
  user_id: string;
  exception_type: string;
  severity: string | null;
  status: string | null;
  classification: string | null;
  workflow_kind: string;
  missing_direction: "in" | "out" | null;
  corrected_time: string | null;
  created_at: string;
  updated_at: string | null;
};

type LocationTarget = {
  targetLat: number;
  targetLng: number;
  radiusMeters: number;
};

type PunchResult = {
  punch: ShiftPunchRow;
  event: ClockStatusEventRow | null;
  timeEntry: TimeEntryRow | null;
  exceptions: AttendanceExceptionRow[];
  raw_clock_event?: {
    id: string;
    employee_id: string;
    linked_assignment_id: string | null;
    shoot_id: string | null;
    timestamp: string;
    action_type: "clock_in" | "clock_out";
    detected_location_state: string | null;
    gps_geofence_result: string | null;
    source_device: string | null;
    sync_state: "synced";
    manager_override_used: boolean;
    employee_reason: string | null;
    created_at: string;
  } | null;
  interpreted_time_record?: {
    linked_assignment_id: string | null;
    scheduled_start_at: string | null;
    scheduled_end_at: string | null;
    actual_clock_in_at: string | null;
    actual_clock_out_at: string | null;
    worked_minutes: number | null;
    attendance_classification: string | null;
    exception_flags: string[];
    time_record_state: string;
    time_record_state_label: string;
    correction_state: string;
    correction_state_label: string;
    finalization_state: string;
    finalization_state_label: string;
    location_state: string | null;
    location_state_label: string | null;
  } | null;
  closeout_compliance?: (ShiftCloseoutCompliance & { warning_message?: string | null }) | null;
  time_clock_state?: TimeClockStateSummary | null;
  time_clock_warnings?: string[];
};

type ShootLocationRow = {
  location_lat: number | null;
  location_lng: number | null;
  geofence_radius_meters: number | null;
};

async function logAutomaticAttendanceException(
  client: PoolClient,
  auth: AuthUser,
  exception: {
    id: string;
    user_id: string;
    exception_type: string;
    shift_id?: string | null;
    shoot_id?: string | null;
    punch_id?: string | null;
    severity?: string | null;
  },
  meta: RequestMeta
) {
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: String(exception.user_id),
    action: "attendance.exception.auto_created",
    entityType: "attendance_exception",
    entityId: exception.id,
    metadata: {
      exception_type: exception.exception_type,
      shift_id: exception.shift_id ?? null,
      shoot_id: exception.shoot_id ?? null,
      punch_id: exception.punch_id ?? null,
      severity: exception.severity ?? null
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });
}

async function findShiftById(client: PoolClient, shiftId: string) {
  const { rows } = await client.query(
    `
      SELECT ws.*, s.shoot_date::text AS shoot_date
      FROM work_shift ws
      LEFT JOIN shoot s
        ON s.id = ws.shoot_id
       AND s.tenant_id = ws.tenant_id
      WHERE ws.id = $1
      LIMIT 1
    `,
    [shiftId]
  );
  return (rows[0] ?? null) as ShiftContext | null;
}

async function findShiftForShoot(client: PoolClient, auth: AuthUser, shootId: string, clientTimestamp: string) {
  const { rows } = await client.query(
    `
      SELECT ws.*, s.shoot_date::text AS shoot_date
      FROM work_shift ws
      LEFT JOIN shoot s
        ON s.id = ws.shoot_id
       AND s.tenant_id = ws.tenant_id
      WHERE ws.assigned_user_id = $1
        AND ws.shoot_id = $2
        AND ws.status IN ('published', 'completed')
        AND ws.starts_at::date <= $3::date
        AND ws.ends_at::date >= $3::date
      ORDER BY
        CASE WHEN ws.starts_at <= $3::timestamptz AND ws.ends_at >= $3::timestamptz THEN 0 ELSE 1 END,
        ABS(EXTRACT(EPOCH FROM (ws.starts_at - $3::timestamptz))) ASC,
        ws.starts_at ASC
      LIMIT 1
    `,
    [auth.id, shootId, clientTimestamp]
  );
  return (rows[0] ?? null) as ShiftContext | null;
}

async function acquirePunchTransactionLock(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    shiftId?: string | null;
    shootId?: string | null;
  }
) {
  const scope =
    input.shiftId != null
      ? `shift:${input.shiftId}`
      : input.shootId != null
        ? `shoot:${input.shootId}`
        : `employee:${input.employeeId}`;
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [input.tenantId, `${input.employeeId}:${scope}`]);
}

function toLocationTarget(location: ShootLocationRow | null | undefined): LocationTarget | null {
  if (!location) {
    return null;
  }
  if (typeof location.location_lat !== "number" || typeof location.location_lng !== "number") {
    return null;
  }
  return {
    targetLat: Number(location.location_lat),
    targetLng: Number(location.location_lng),
    radiusMeters: Number(location.geofence_radius_meters ?? 0)
  };
}

async function ensurePunchIdempotency(client: PoolClient, tenantId: string, clientEventId?: string | null, idempotencyKey?: string | null) {
  if (clientEventId) {
    const existing = await client.query("SELECT * FROM shift_punch WHERE tenant_id = $1 AND client_event_id = $2 LIMIT 1", [
      tenantId,
      clientEventId
    ]);
    if (existing.rows[0]) {
      return existing.rows[0] as ShiftPunchRow;
    }
  }
  if (idempotencyKey) {
    const existing = await client.query(
      "SELECT * FROM shift_punch WHERE tenant_id = $1 AND idempotency_key = $2 ORDER BY created_at DESC LIMIT 1",
      [tenantId, idempotencyKey]
    );
    if (existing.rows[0]) {
      return existing.rows[0] as ShiftPunchRow;
    }
  }
  return null;
}

function toLocationClassification(
  punch: Pick<ShiftPunchRow, "geofence_status" | "approval_state">,
  classification?: string | null
) {
  if (classification) {
    return classification;
  }
  if (punch.approval_state === "approved" && punch.geofence_status === "outside") {
    return "manual_override";
  }
  if (punch.geofence_status === "inside") {
    return "valid_on_site";
  }
  if (punch.geofence_status === "outside") {
    return "outside_allowed_zone";
  }
  if (punch.geofence_status === "unknown") {
    return "clock_in_pending_location_review";
  }
  return null;
}

function buildInterpretedTimeRecord(input: {
  punch: ShiftPunchRow;
  timeEntry: TimeEntryRow | null;
  timeSessionStatus: TimeSessionStatus | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  exceptionClassification?: string | null;
  exceptionStatus?: string | null;
}) {
  const summary = deriveTimeReviewSummary({
    shiftEndsAt: input.scheduledEndAt,
    exceptionStatus: input.exceptionStatus ?? null,
    exceptionClassification: input.exceptionClassification ?? null,
    timeEntryAttendanceState: input.timeEntry?.attendance_state ?? null,
    clockInAt: input.timeEntry?.clock_in_at ?? null,
    clockOutAt: input.timeEntry?.clock_out_at ?? null,
    latestPunchDirection: input.punch.direction,
    latestPunchApprovalState: input.punch.approval_state ?? null,
    latestPunchGeofenceStatus: input.punch.geofence_status ?? null,
    timeSessionStatus: input.timeSessionStatus
  });

  return {
    linked_assignment_id: input.punch.shift_id ?? null,
    scheduled_start_at: input.scheduledStartAt,
    scheduled_end_at: input.scheduledEndAt,
    actual_clock_in_at: input.timeEntry?.clock_in_at ?? null,
    actual_clock_out_at: input.timeEntry?.clock_out_at ?? null,
    worked_minutes: input.timeEntry?.minutes_worked ?? null,
    attendance_classification: input.timeEntry?.attendance_state ?? null,
    exception_flags: [
      ...(input.punch.missed_punch_required ? ["missing_punch_workflow"] : []),
      ...(input.punch.requires_approval ? ["requires_review"] : []),
      ...(input.punch.unscheduled ? ["unscheduled"] : [])
    ],
    time_record_state: summary.timeRecordState,
    time_record_state_label: summary.timeRecordStateLabel,
    correction_state: summary.correctionState,
    correction_state_label: summary.correctionStateLabel,
    finalization_state: summary.finalizationState,
    finalization_state_label: summary.finalizationStateLabel,
    location_state: summary.locationState,
    location_state_label: summary.locationStateLabel
  };
}

async function buildPunchResult(client: PoolClient, punch: ShiftPunchRow): Promise<PunchResult> {
  const event = punch.status_event_id
    ? (((await client.query("SELECT * FROM status_event WHERE id = $1 LIMIT 1", [punch.status_event_id])).rows[0] ??
        null) as ClockStatusEventRow | null)
    : null;
  const timeEntry = punch.status_event_id
    ? (
        await client.query(
          `
            SELECT *
            FROM time_entry
            WHERE clock_in_event_id = $1 OR clock_out_event_id = $1
            ORDER BY created_at DESC
            LIMIT 1
          `,
          [punch.status_event_id]
        )
      ).rows[0] ?? null
    : null;
  const exceptions = (
    await client.query(
      `
        SELECT *
        FROM attendance_exception
        WHERE punch_id = $1
        ORDER BY created_at ASC
      `,
      [punch.id]
    )
  ).rows as AttendanceExceptionRow[];
  const shiftSchedule =
    punch.shift_id
      ? (
          await client.query<{ starts_at: string; ends_at: string }>(
            `
              SELECT starts_at, ends_at
              FROM work_shift
              WHERE id = $1
              LIMIT 1
            `,
            [punch.shift_id]
          )
        ).rows[0] ?? null
      : null;
  const timeSession =
    punch.shift_id
      ? (
          await client.query<Pick<TimeSessionRow, "status">>(
            `
              SELECT status
              FROM time_session
              WHERE tenant_id = $1
                AND employee_id = $2
                AND source_shift_id = $3
              ORDER BY updated_at DESC
              LIMIT 1
            `,
            [punch.tenant_id, punch.user_id, punch.shift_id]
          )
        ).rows[0] ?? null
      : null;
  const locationClassification = toLocationClassification(
    punch,
    exceptions.find((item) => item.classification)?.classification ?? null
  );
  const interpretedTimeRecord = buildInterpretedTimeRecord({
    punch,
    timeEntry: timeEntry as TimeEntryRow | null,
    timeSessionStatus: timeSession?.status ?? null,
    scheduledStartAt: shiftSchedule?.starts_at ?? null,
    scheduledEndAt: shiftSchedule?.ends_at ?? null,
    exceptionClassification: locationClassification,
    exceptionStatus: exceptions.find((item) => item.status)?.status ?? null
  });
  const timeClockState = await getTimeClockStateSummary(client, {
    tenantId: punch.tenant_id,
    employeeId: punch.user_id
  });
  return {
    punch,
    event,
    timeEntry: timeEntry as TimeEntryRow | null,
    exceptions,
    raw_clock_event: {
      id: punch.id,
      employee_id: punch.user_id,
      linked_assignment_id: punch.shift_id ?? null,
      shoot_id: punch.shoot_id ?? null,
      timestamp: punch.client_timestamp,
      action_type: punch.direction === "in" ? "clock_in" : "clock_out",
      detected_location_state: interpretedTimeRecord.location_state,
      gps_geofence_result: punch.geofence_status ?? null,
      source_device: punch.source ?? null,
      sync_state: "synced",
      manager_override_used: Boolean(punch.approver_user_id || punch.attested_approved || punch.approval_state === "approved"),
      employee_reason: punch.reason_code ?? punch.notes ?? null,
      created_at: punch.created_at
    },
    interpreted_time_record: interpretedTimeRecord,
    closeout_compliance: null,
    time_clock_state: timeClockState,
    time_clock_warnings: []
  };
}

async function emitAttendanceRealtimeChange(
  client: PoolClient,
  input: {
    tenantId: string;
    changeType: "punch_created" | "exception_created" | "exception_reviewed";
    shiftId?: string | null;
    shootId?: string | null;
    punchId?: string | null;
    exceptionId?: string | null;
    status?: string | null;
    classification?: string | null;
    versionToken: string;
  }
) {
  await createAppEvent(client, {
    tenantId: input.tenantId,
    eventType: "attendance.realtime.changed",
    aggregateType: input.exceptionId ? "attendance_exception" : "shift_punch",
    aggregateId: input.exceptionId ?? input.punchId ?? input.shiftId ?? null,
    dedupeKey: `attendance-realtime:${input.changeType}:${input.exceptionId ?? input.punchId ?? input.shiftId ?? "none"}:${input.versionToken}`,
    payload: {
      change_type: input.changeType,
      shift_id: input.shiftId ?? null,
      shoot_id: input.shootId ?? null,
      punch_id: input.punchId ?? null,
      attendance_exception_id: input.exceptionId ?? null,
      status: input.status ?? null,
      classification: input.classification ?? null
    }
  });
}

async function updateShiftAttendanceState(
  client: PoolClient,
  input: {
    shiftId?: string | null;
    state: AttendanceState;
    note?: string | null;
    resolvedByUserId?: string | null;
    resolvedAt?: string | null;
  }
) {
  if (!input.shiftId) {
    return;
  }

  await client.query(
    `
      UPDATE work_shift
      SET attendance_state = $2::attendance_state,
          attendance_state_note = COALESCE($3, attendance_state_note),
          attendance_state_updated_at = now(),
          attendance_resolved_by_user_id = CASE WHEN $4::uuid IS NULL THEN attendance_resolved_by_user_id ELSE $4::uuid END,
          attendance_resolved_at = CASE WHEN $5::timestamptz IS NULL THEN attendance_resolved_at ELSE $5::timestamptz END
      WHERE id = $1
    `,
    [input.shiftId, input.state, input.note ?? null, input.resolvedByUserId ?? null, input.resolvedAt ?? null]
  );
}

function getScheduledMinutes(shift: ShiftContext | null | undefined) {
  if (!shift) {
    return null;
  }
  return calculateDurationMinutes(shift.starts_at, shift.ends_at);
}

async function recalculateTimeEntryPayroll(
  client: PoolClient,
  timeEntryId: string,
  shift: ShiftContext | null | undefined
) {
  const result = await client.query("SELECT * FROM time_entry WHERE id = $1 LIMIT 1", [timeEntryId]);
  const entry = result.rows[0] as TimeEntryRow | undefined;
  if (!entry) {
    return null;
  }

  const grossMinutes =
    entry.clock_out_at && entry.clock_in_at
      ? calculateDurationMinutes(entry.clock_in_at, entry.clock_out_at)
      : entry.gross_minutes ?? entry.minutes_worked ?? null;
  const scheduledMinutes = entry.scheduled_minutes ?? getScheduledMinutes(shift);
  const autoDeduction = grossMinutes !== null ? getAutoBreakDeductionMinutes(grossMinutes) : 0;
  const deductionMinutes = entry.break_deduction_overridden ? Number(entry.break_deduction_minutes ?? 0) : autoDeduction;
  const payableMinutes = grossMinutes === null ? null : Math.max(grossMinutes - deductionMinutes, 0);
  const attendanceState =
    entry.clock_out_at !== null ? ("clocked_out" as const) : entry.clock_in_at ? ("clocked_in" as const) : entry.attendance_state;

  const { rows } = await client.query(
    `
      UPDATE time_entry
      SET shift_id = COALESCE($2, shift_id),
          scheduled_minutes = $3,
          gross_minutes = $4,
          minutes_worked = $4,
          break_deduction_minutes = $5,
          break_deduction_applied = $6,
          break_deduction_source = $7,
          payable_minutes = $8,
          approved_payable_minutes = COALESCE(approved_payable_minutes, $8),
          attendance_state = $9::attendance_state,
          payroll_state = CASE
            WHEN EXISTS (
              SELECT 1
              FROM attendance_exception ae
              WHERE ae.shift_id = COALESCE($2, shift_id)
                AND ae.status = 'open'
            ) THEN 'exception_review'
            ELSE 'ready'
          END,
          updated_at = now()
      WHERE id = $1
      RETURNING *
    `,
    [
      timeEntryId,
      shift?.id ?? entry.shift_id,
      scheduledMinutes,
      grossMinutes,
      deductionMinutes,
      deductionMinutes > 0,
      entry.break_deduction_overridden ? "manual_override" : deductionMinutes > 0 ? "auto_30_after_5h" : "none",
      payableMinutes,
      attendanceState
    ]
  );
  return (rows[0] ?? null) as TimeEntryRow | null;
}

async function syncTimeEntryWithClockEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    shiftId?: string | null;
    shootId: string;
    userId: string;
    type: "CLOCK_IN" | "CLOCK_OUT";
    event: ClockStatusEventRow;
    shift?: ShiftContext | null;
  }
) {
  if (input.type === "CLOCK_IN") {
    const openEntry = await client.query(
      `
        SELECT *
        FROM time_entry
        WHERE user_id = $2
          AND clock_out_at IS NULL
          AND (
            ($1::uuid IS NOT NULL AND shift_id = $1::uuid)
            OR ($1::uuid IS NULL AND shoot_id = $3 AND shift_id IS NULL)
          )
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [input.shiftId ?? null, input.userId, input.shootId]
    );
    if (openEntry.rows[0]) {
      return openEntry.rows[0] as TimeEntryRow;
    }
    const { rows } = await client.query(
      `
        INSERT INTO time_entry (
          tenant_id, shift_id, shoot_id, user_id, clock_in_event_id, clock_in_at,
          scheduled_minutes, gross_minutes, break_deduction_minutes, break_deduction_applied,
          break_deduction_source, payable_minutes, approved_payable_minutes, attendance_state
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,0,false,'none',NULL,NULL,'clocked_in')
        RETURNING *
      `,
      [
        input.tenantId,
        input.shiftId ?? null,
        input.shootId,
        input.userId,
        input.event.id,
        input.event.captured_at,
        getScheduledMinutes(input.shift)
      ]
    );
    return (rows[0] ?? null) as TimeEntryRow | null;
  }

  const openEntry = await client.query(
    `
      SELECT *
      FROM time_entry
      WHERE user_id = $2
        AND clock_out_at IS NULL
        AND (
          ($1::uuid IS NOT NULL AND shift_id = $1::uuid)
          OR ($1::uuid IS NULL AND shoot_id = $3 AND shift_id IS NULL)
        )
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [input.shiftId ?? null, input.userId, input.shootId]
  );
  if (!openEntry.rows[0]) {
    return null;
  }

  const entry = openEntry.rows[0] as TimeEntryRow;
  const { rows } = await client.query(
    `
      UPDATE time_entry
      SET shift_id = COALESCE($1, shift_id),
          clock_out_event_id = $2,
          clock_out_at = $3,
          attendance_state = 'clocked_out',
          updated_at = now()
      WHERE id = $4
      RETURNING *
    `,
    [input.shiftId ?? null, input.event.id, input.event.captured_at, entry.id]
  );
  const updated = (rows[0] ?? null) as TimeEntryRow | null;
  if (!updated) {
    return null;
  }
  return recalculateTimeEntryPayroll(client, updated.id, input.shift);
}

async function createAttendanceException(
  client: PoolClient,
  input: {
    tenantId: string;
    shiftId?: string | null;
    shootId?: string | null;
    punchId?: string | null;
    userId: string;
    exceptionType: string;
    severity: "normal" | "high" | "critical";
    classification?: string | null;
    reasonCode?: string | null;
    notes?: string | null;
    requestedApproverUserId?: string | null;
    requestedValue?: Record<string, unknown>;
    originalValue?: Record<string, unknown>;
    workflowKind?: "exception" | "missed_punch";
    missingDirection?: "in" | "out" | null;
    correctedTime?: string | null;
    overrideFlag?: boolean;
  }
) {
  const { rows } = await client.query(
    `
      INSERT INTO attendance_exception (
        tenant_id, shift_id, punch_id, shoot_id, user_id, exception_type, severity,
        classification, reason_code, notes, requested_approver_user_id, requested_value, original_value,
        workflow_kind, missing_direction, corrected_time, override_flag
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17)
      RETURNING *
    `,
    [
      input.tenantId,
      input.shiftId ?? null,
      input.punchId ?? null,
      input.shootId ?? null,
      input.userId,
      input.exceptionType,
      input.severity,
      input.classification ?? null,
      input.reasonCode ?? null,
      input.notes ?? null,
      input.requestedApproverUserId ?? null,
      JSON.stringify(input.requestedValue ?? {}),
      JSON.stringify(input.originalValue ?? {}),
      input.workflowKind ?? "exception",
      input.missingDirection ?? null,
      input.correctedTime ?? null,
      Boolean(input.overrideFlag)
    ]
  );
  return rows[0] as AttendanceExceptionRow;
}

function getEarlyMinutes(startsAt: string, clientTimestamp: string) {
  const diffMs = new Date(startsAt).getTime() - new Date(clientTimestamp).getTime();
  if (diffMs <= 0) {
    return 0;
  }
  return Math.ceil(diffMs / 60000);
}

function assertBackdatedPunchCorrectionWindow(correctedTime: string) {
  const correctedAt = new Date(correctedTime);
  if (Number.isNaN(correctedAt.getTime())) {
    throw new ApiError(400, "Corrected time must be a valid timestamp");
  }
  const maxAgeMs = MAX_BACKDATED_PUNCH_EDIT_DAYS * 24 * 60 * 60 * 1000;
  if (Date.now() - correctedAt.getTime() > maxAgeMs) {
    throw new ApiError(400, `Backdated punch changes cannot be older than ${MAX_BACKDATED_PUNCH_EDIT_DAYS} days`);
  }
}

function getWorkDateForTimestamp(timestamp: string, businessDate?: string | null) {
  return businessDate?.trim() || getLocalDateString(timestamp);
}

function getTimeClockRequestTypeForAttendanceException(input: {
  exceptionType: string;
  workflowKind?: string | null;
  missingDirection?: "in" | "out" | null;
}) {
  if (input.workflowKind === "missed_punch" || input.exceptionType === "FORGOT_TO_CLOCK_IN" || input.missingDirection === "in") {
    return "missing_clock_in" as const;
  }
  if (input.exceptionType === "FORGOT_TO_CLOCK_OUT" || input.missingDirection === "out") {
    return "missing_clock_out" as const;
  }
  if (input.exceptionType === "BREAK_DEDUCTION_OVERRIDE") {
    return "lunch_deduction_challenge" as const;
  }
  if (input.exceptionType === "NO_LUNCH_CHALLENGE") {
    return "lunch_deduction_challenge" as const;
  }
  if (["WRONG_SEGMENT", "WRONG_RATE", "WRONG_LOCATION"].includes(input.exceptionType)) {
    return "time_segment_correction" as const;
  }
  return null;
}

function getApprovalActorRole(auth: AuthUser) {
  if (auth.authorityTier === "super_admin") {
    return "super_admin";
  }
  if (auth.authorityTier === "leadership" || auth.authorityTier === "director_admin") {
    return "leadership";
  }
  if (hasJobFunctionProfile(auth, ["director_of_photography", "director_of_school_photography", "director_of_sports_photography"])) {
    return "director_of_photography";
  }
  if (hasJobFunctionProfile(auth, "senior_photographer")) {
    return "senior_photographer";
  }
  return "manager";
}

function canFinalizeTimeClockCorrection(auth: AuthUser) {
  return (
    canEditHours(auth) ||
    hasJobFunctionProfile(auth, ["director_of_photography", "director_of_school_photography", "director_of_sports_photography", "senior_photographer"])
  );
}

function getDefaultRequestedWorkState(shift: ShiftContext | null | undefined) {
  if (!shift) {
    return "office_drive" as const;
  }
  if (shift.shift_kind === "office" || shift.shift_kind === "studio" || shift.shift_kind === "training") {
    return "office_drive" as const;
  }
  return "photography" as const;
}

async function getShootLocationId(client: PoolClient, tenantId: string, shootId?: string | null) {
  if (!shootId) {
    return null;
  }
  const { rows } = await client.query<{ location_id: string | null }>(
    `
      SELECT location_id
      FROM shoot
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, shootId]
  );
  return rows[0]?.location_id ?? null;
}

function buildTimeClockLocationContext(shift: ShiftContext | null | undefined, provided?: Record<string, unknown> | null) {
  return {
    shift_title: shift?.title ?? null,
    location_name: shift?.location_name ?? null,
    location_address: shift?.location_address ?? null,
    location_lat: shift?.location_lat ?? null,
    location_lng: shift?.location_lng ?? null,
    ...(provided ?? {})
  };
}

async function getLatestTimeSessionForEmployeeDate(client: PoolClient, tenantId: string, employeeId: string, workDate: string) {
  const { rows } = await client.query<TimeSessionRow>(
    `
      SELECT *
      FROM time_session
      WHERE tenant_id = $1
        AND employee_id = $2
        AND work_date = $3::date
      ORDER BY
        CASE WHEN status = 'open' THEN 0 ELSE 1 END,
        created_at DESC
      LIMIT 1
    `,
    [tenantId, employeeId, workDate]
  );
  return rows[0] ?? null;
}

async function getOrCreateTimeSessionForEmployeeDate(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    workDate: string;
    sourceShiftId?: string | null;
    status?: TimeSessionRow["status"];
  }
) {
  if (input.sourceShiftId) {
    const existingShiftSession = await getLatestTimeSessionForShift(
      client,
      input.tenantId,
      input.employeeId,
      input.sourceShiftId
    );
    if (existingShiftSession) {
      return existingShiftSession;
    }
  }

  if (!input.sourceShiftId) {
  const existing = await getLatestTimeSessionForEmployeeDate(client, input.tenantId, input.employeeId, input.workDate);
  if (existing) {
    return existing;
  }
  }

  const { rows } = await client.query<TimeSessionRow>(
    `
      INSERT INTO time_session (
        tenant_id,
        employee_id,
        work_date,
        source_shift_id,
        status
      )
      VALUES ($1,$2,$3::date,$4,$5)
      RETURNING *
    `,
    [input.tenantId, input.employeeId, input.workDate, input.sourceShiftId ?? null, input.status ?? "closed"]
  );
  return rows[0] ?? null;
}

async function getOpenTimeSegmentForContext(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    sessionId?: string | null;
    shiftId?: string | null;
    shootId?: string | null;
  }
) {
  const values: unknown[] = [input.tenantId, input.employeeId];
  const where = ["tenant_id = $1", "employee_id = $2", "end_time IS NULL"];
  if (input.sessionId) {
    values.push(input.sessionId);
    where.push(`session_id = $${values.length}`);
  }
  if (input.shiftId) {
    values.push(input.shiftId);
    where.push(`linked_shift_id = $${values.length}`);
  } else if (input.shootId) {
    values.push(input.shootId);
    where.push(`linked_shoot_id = $${values.length}`);
  }

  const { rows } = await client.query<TimeSegmentRow>(
    `
      SELECT *
      FROM time_segment
      WHERE ${where.join(" AND ")}
      ORDER BY start_time DESC
      LIMIT 1
    `,
    values
  );
  return rows[0] ?? null;
}

async function insertTimeClockApprovalRecord(
  client: PoolClient,
  input: {
    tenantId: string;
    requestId: string;
    approverId: string;
    approverRole: string;
    decision: ApprovalRecordRow["decision"];
    comment?: string | null;
  }
) {
  const { rows } = await client.query<ApprovalRecordRow>(
    `
      INSERT INTO approval_record (
        tenant_id,
        request_id,
        approver_id,
        approver_role,
        decision,
        comment
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
    `,
    [input.tenantId, input.requestId, input.approverId, input.approverRole, input.decision, input.comment ?? null]
  );
  return rows[0] ?? null;
}

async function getTimeClockExceptionRequestByAttendanceExceptionId(client: PoolClient, tenantId: string, attendanceExceptionId: string) {
  const { rows } = await client.query<TimeClockExceptionRequestRow>(
    `
      SELECT *
      FROM exception_request
      WHERE tenant_id = $1
        AND related_attendance_exception_id = $2
      ORDER BY submitted_at DESC
      LIMIT 1
    `,
    [tenantId, attendanceExceptionId]
  );
  return rows[0] ?? null;
}

async function getTimeSessionById(client: PoolClient, tenantId: string, sessionId: string) {
  const { rows } = await client.query<TimeSessionRow>(
    `
      SELECT *
      FROM time_session
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, sessionId]
  );
  return rows[0] ?? null;
}

async function getLatestTimeSessionForShift(client: PoolClient, tenantId: string, employeeId: string, shiftId: string) {
  const { rows } = await client.query<TimeSessionRow>(
    `
      SELECT *
      FROM time_session
      WHERE tenant_id = $1
        AND employee_id = $2
        AND source_shift_id = $3
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [tenantId, employeeId, shiftId]
  );
  return rows[0] ?? null;
}

async function resolveRelatedTimeSessionForAttendanceException(
  client: PoolClient,
  tenantId: string,
  exception: Pick<AttendanceExceptionRow, "id" | "user_id" | "shift_id" | "corrected_time">,
  timeClockRequest?: TimeClockExceptionRequestRow | null
) {
  const candidateSessions: TimeSessionRow[] = [];

  if (timeClockRequest?.linked_session_id) {
    const linkedSession = await getTimeSessionById(client, tenantId, timeClockRequest.linked_session_id);
    if (linkedSession) {
      candidateSessions.push(linkedSession);
    }
  }
  if (exception.shift_id) {
    const shiftSession = await getLatestTimeSessionForShift(client, tenantId, String(exception.user_id), exception.shift_id);
    if (shiftSession) {
      candidateSessions.push(shiftSession);
    }
  }
  if (exception.corrected_time) {
    const workDateSession = await getLatestTimeSessionForEmployeeDate(
      client,
      tenantId,
      String(exception.user_id),
      getWorkDateForTimestamp(exception.corrected_time)
    );
    if (workDateSession) {
      candidateSessions.push(workDateSession);
    }
  }

  if (!candidateSessions.length) {
    return null;
  }

  const finalizedSession = candidateSessions.find((session) => isFinalizedTimeSessionStatus(session.status));
  if (finalizedSession) {
    return finalizedSession;
  }

  return candidateSessions.sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())[0] ?? null;
}

async function resolveRelatedTimeSessionForTimeEntry(
  client: PoolClient,
  tenantId: string,
  entry: Pick<TimeEntryRow, "user_id" | "shift_id" | "clock_in_at">
) {
  if (entry.shift_id) {
    return getLatestTimeSessionForShift(client, tenantId, entry.user_id, entry.shift_id);
  }
  return getLatestTimeSessionForEmployeeDate(client, tenantId, entry.user_id, getWorkDateForTimestamp(entry.clock_in_at));
}

function assertMutableTimeSession(
  session: Pick<TimeSessionRow, "status"> | null,
  lockedMessage = "This time record is locked because the linked Time Session has already been finalized."
) {
  if (session && isFinalizedTimeSessionStatus(session.status)) {
    throw new ApiError(409, lockedMessage);
  }
}

async function resolveTimeClockRequestSessionId(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    shift: ShiftContext | null;
    requestedStartTime?: string | null;
    requestedEndTime?: string | null;
  }
) {
  const anchorTimestamp =
    input.requestedStartTime ??
    input.requestedEndTime ??
    input.shift?.starts_at ??
    input.shift?.ends_at ??
    null;
  if (!anchorTimestamp) {
    return null;
  }

  const workDate = getWorkDateForTimestamp(anchorTimestamp, input.shift?.shoot_date ?? null);
  const session = await getOrCreateTimeSessionForEmployeeDate(client, {
    tenantId: input.tenantId,
    employeeId: input.employeeId,
    workDate,
    sourceShiftId: input.shift?.id ?? null,
    status: "closed"
  });
  return session?.id ?? null;
}

async function createCanonicalTimeClockRequestForAttendanceException(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    attendanceExceptionId: string;
    exceptionType: string;
    workflowKind?: string | null;
    missingDirection?: "in" | "out" | null;
    shift: ShiftContext | null;
    requestedApproverUserId?: string | null;
    requestedWorkState?: TimeWorkState | null;
    requestedStartTime?: string | null;
    requestedEndTime?: string | null;
    locationContext?: Record<string, unknown> | null;
    originalValues?: Record<string, unknown>;
    requestedValues?: Record<string, unknown>;
    note: string;
    reportingFlags?: string[];
  }
) {
  const existing = await getTimeClockExceptionRequestByAttendanceExceptionId(client, input.tenantId, input.attendanceExceptionId);
  if (existing) {
    return existing.id;
  }

  const requestType = getTimeClockRequestTypeForAttendanceException({
    exceptionType: input.exceptionType,
    workflowKind: input.workflowKind ?? null,
    missingDirection: input.missingDirection ?? null
  });
  if (!requestType) {
    return null;
  }

  const sessionId = await resolveTimeClockRequestSessionId(client, {
    tenantId: input.tenantId,
    employeeId: input.employeeId,
    shift: input.shift,
    requestedStartTime: input.requestedStartTime ?? null,
    requestedEndTime: input.requestedEndTime ?? null
  });

  return createTimeClockExceptionRequest(client, {
    tenantId: input.tenantId,
    employeeId: input.employeeId,
    requestType,
    shiftId: input.shift?.id ?? null,
    shootId: input.shift?.shoot_id ?? null,
    sessionId,
    requestedApproverId: input.requestedApproverUserId ?? input.shift?.manager_user_id ?? null,
    relatedAttendanceExceptionId: input.attendanceExceptionId,
    requestedState: input.requestedWorkState ?? getDefaultRequestedWorkState(input.shift),
    requestedStartTime: input.requestedStartTime ?? null,
    requestedEndTime: input.requestedEndTime ?? null,
    locationContext: buildTimeClockLocationContext(input.shift, input.locationContext),
    originalValues: input.originalValues ?? {},
    resolvedValues: {},
    reportingFlags: input.reportingFlags ?? ["manual_adjustment"],
    note: input.note
  });
}

async function updateTimeClockExceptionRequestReview(
  client: PoolClient,
  input: {
    requestId: string;
    status: TimeClockExceptionRequestRow["status"];
    reviewedBy: string;
    resolvedValues?: Record<string, unknown>;
    note?: string | null;
    appendFlags?: string[];
  }
) {
  const { rows } = await client.query<TimeClockExceptionRequestRow>(
    `
      UPDATE exception_request
      SET status = $2::exception_request_status,
          reviewed_at = now(),
          reviewed_by = $3,
          note = COALESCE($4, note),
          resolved_values = CASE
            WHEN $5::jsonb IS NULL THEN resolved_values
            ELSE jsonb_strip_nulls(COALESCE(resolved_values, '{}'::jsonb) || $5::jsonb)
          END,
          reporting_flags = CASE
            WHEN COALESCE(array_length($6::text[], 1), 0) = 0 THEN reporting_flags
            ELSE (
              SELECT ARRAY(
                SELECT DISTINCT flag
                FROM unnest(COALESCE(exception_request.reporting_flags, '{}'::text[]) || $6::text[]) AS flag
              )
            )
          END
      WHERE id = $1
      RETURNING *
    `,
    [
      input.requestId,
      input.status,
      input.reviewedBy,
      input.note ?? null,
      input.resolvedValues ? JSON.stringify(input.resolvedValues) : null,
      input.appendFlags ?? []
    ]
  );
  return rows[0] ?? null;
}

async function insertTimeSegmentCorrection(
  client: PoolClient,
  input: {
    tenantId: string;
    sessionId: string;
    employeeId: string;
    shiftId?: string | null;
    shootId?: string | null;
    locationId?: string | null;
    workState: TimeWorkState;
    startTime: string;
    endTime?: string | null;
    sourceType: TimeSegmentSourceType;
    reviewStatus: TimeSegmentReviewStatus;
    supersedesSegmentId?: string | null;
    reportingFlags?: string[];
    actorUserId?: string | null;
  }
) {
  // Single choke point for correction segments: refuse writes into locked payroll
  // periods and flag (edited_after_payroll_review) writes into reviewed periods.
  await guardSessionMutationForPayroll(client, input.tenantId, {
    sessionId: input.sessionId,
    actorUserId: input.actorUserId ?? null,
    reason: `time_segment_correction:${input.sourceType}`
  });
  const { rows } = await client.query<TimeSegmentRow>(
    `
      INSERT INTO time_segment (
        tenant_id,
        session_id,
        employee_id,
        linked_shift_id,
        work_state,
        linked_shoot_id,
        linked_location_id,
        supersedes_segment_id,
        start_time,
        end_time,
        source_type,
        geofence_supported,
        review_status,
        reporting_flags
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$13)
      RETURNING *
    `,
    [
      input.tenantId,
      input.sessionId,
      input.employeeId,
      input.shiftId ?? null,
      input.workState,
      input.shootId ?? null,
      input.locationId ?? null,
      input.supersedesSegmentId ?? null,
      input.startTime,
      input.endTime ?? null,
      input.sourceType,
      input.reviewStatus,
      input.reportingFlags ?? []
    ]
  );
  return rows[0] ?? null;
}

async function updateTimeSegmentEndTime(
  client: PoolClient,
  input: {
    segmentId: string;
    endTime: string;
    reviewStatus?: TimeSegmentReviewStatus;
    appendFlags?: string[];
  }
) {
  const existing = (
    await client.query<TimeSegmentRow>(
      `
        SELECT *
        FROM time_segment
        WHERE id = $1
        LIMIT 1
      `,
      [input.segmentId]
    )
  ).rows[0];
  if (!existing) {
    throw new ApiError(404, "Time Segment not found");
  }

  const { rows } = await client.query<TimeSegmentRow>(
    `
      UPDATE time_segment
      SET end_time = CASE
            WHEN $2::timestamptz <= start_time THEN start_time + interval '1 second'
            ELSE $2::timestamptz
          END,
          review_status = COALESCE($3::time_segment_review_status, review_status),
          reporting_flags = CASE
            WHEN COALESCE(array_length($4::text[], 1), 0) = 0 THEN reporting_flags
            ELSE (
              SELECT ARRAY(
                SELECT DISTINCT flag
                FROM unnest(COALESCE(time_segment.reporting_flags, '{}'::text[]) || $4::text[]) AS flag
              )
            )
          END,
          updated_at = now()
      WHERE id = $1
      RETURNING *
    `,
    [input.segmentId, input.endTime, input.reviewStatus ?? null, input.appendFlags ?? []]
  );
  return {
    previous: existing,
    updated: rows[0] ?? null
  };
}

async function insertTimeClockCorrectionEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    sessionId?: string | null;
    segmentId?: string | null;
    shootId?: string | null;
    locationId?: string | null;
    eventType: "manual_correction" | "admin_override" | "exception_requested" | "approval_recorded";
    eventTimestamp: string;
    actor: "employee" | "manager" | "leadership" | "admin";
    metadata?: Record<string, unknown>;
  }
) {
  const { rows } = await client.query(
    `
      INSERT INTO clock_event (
        tenant_id,
        employee_id,
        linked_session_id,
        linked_segment_id,
        linked_shoot_id,
        linked_location_id,
        event_type,
        event_timestamp,
        metadata,
        created_by_actor
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
      RETURNING id
    `,
    [
      input.tenantId,
      input.employeeId,
      input.sessionId ?? null,
      input.segmentId ?? null,
      input.shootId ?? null,
      input.locationId ?? null,
      input.eventType,
      input.eventTimestamp,
      JSON.stringify(input.metadata ?? {}),
      input.actor
    ]
  );
  return rows[0]?.id ?? null;
}

function channelsForSeverity(severity: "normal" | "high" | "critical") {
  if (severity === "critical") {
    return ["in_app", "push", "sms", "email"] as const;
  }
  if (severity === "high") {
    return ["in_app", "push", "email"] as const;
  }
  return ["in_app"] as const;
}

async function routePunchExceptionNotifications(
  client: PoolClient,
  auth: AuthUser,
  input: {
    shiftId?: string | null;
    shootId?: string | null;
    relatedUserId?: string | null;
    attendanceExceptionId: string;
    notificationType: string;
    title: string;
    body: string;
    severity: "normal" | "high" | "critical";
    directUserIds?: string[];
  }
) {
  const recipients = await findNotificationRecipients(client, {
    tenantId: auth.tenantId,
    eventCode: input.notificationType,
    shiftId: input.shiftId ?? null,
    shootId: input.shootId ?? null,
    directUserIds: input.directUserIds ?? [],
    excludeUserIds: [auth.id]
  });
  await queueNotificationDispatch(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    recipientUserIds: recipients,
    notificationType: input.notificationType,
    title: input.title,
    body: input.body,
    priority: input.severity,
    deepLink: input.shiftId ? `/attendance/shifts/${input.shiftId}` : "/attendance",
    shiftId: input.shiftId ?? null,
    shootId: input.shootId ?? null,
    attendanceExceptionId: input.attendanceExceptionId,
    relatedUserId: input.relatedUserId ?? auth.id,
    channels: [...channelsForSeverity(input.severity)],
    metadata: { dedupe: input.attendanceExceptionId }
  });
}

function getExceptionWorkflowKind(exceptionType: string) {
  if (exceptionType === "FORGOT_TO_CLOCK_IN" || exceptionType === "FORGOT_TO_CLOCK_OUT") {
    return "missed_punch" as const;
  }
  return "exception" as const;
}

function getMissingDirectionForException(exceptionType: string): "in" | "out" | null {
  if (exceptionType === "FORGOT_TO_CLOCK_IN") {
    return "in";
  }
  if (exceptionType === "FORGOT_TO_CLOCK_OUT") {
    return "out";
  }
  return null;
}

async function applyApprovedMissedPunch(
  client: PoolClient,
  auth: AuthUser,
  exception: AttendanceExceptionRow,
  correctedTime: string,
  meta: RequestMeta
) {
  if (!exception.shift_id) {
    throw new ApiError(400, "Missed punch approval requires a shift");
  }

  const shift = await findShiftById(client, exception.shift_id);
  if (!shift) {
    throw new ApiError(404, "Shift not found");
  }

  const direction = exception.missing_direction;
  if (!direction) {
    throw new ApiError(400, "Missed punch direction is required");
  }

  assertBackdatedPunchCorrectionWindow(correctedTime);

  const existingPunch = await client.query(
    `
      SELECT id
      FROM shift_punch
      WHERE shift_id = $1
        AND user_id = $2
        AND direction = $3::punch_direction
      ORDER BY client_timestamp DESC
      LIMIT 1
    `,
    [shift.id, exception.user_id, direction]
  );
  if (existingPunch.rows[0]) {
    return null;
  }

  const timeClockRequest = await getTimeClockExceptionRequestByAttendanceExceptionId(client, auth.tenantId, exception.id);
  const workState = timeClockRequest?.requested_state ?? getDefaultRequestedWorkState(shift);
  const locationId = await getShootLocationId(client, auth.tenantId, shift.shoot_id ?? null);

  let statusEvent: ClockStatusEventRow | null = null;
  if (shift.shoot_id) {
    statusEvent = (await createStatusEvent(client, {
      auth,
      tenantId: auth.tenantId,
      userId: String(exception.user_id),
      shootId: shift.shoot_id,
      idempotencyKey: `missed-punch:${exception.id}`,
      skipShootAccess: true,
      input: {
        type: direction === "in" ? "CLOCK_IN" : "CLOCK_OUT",
        captured_at: correctedTime,
        metadata: {
          shift_id: shift.id,
          source: "missed_punch_approval",
          attendance_exception_id: exception.id
        }
      }
    })) as ClockStatusEventRow;
  }

  const timingStatus = getPunchTimingStatus({
    direction,
    earlyMinutes: direction === "in" ? getEarlyMinutes(shift.starts_at, correctedTime) : 0,
    lateMinutes: direction === "in" ? getLateMinutes(shift.starts_at, correctedTime) : 0,
    requiresMissedPunchWorkflow: false
  });

  const insertedPunch = (
    await client.query(
      `
        INSERT INTO shift_punch (
          tenant_id, shift_id, shoot_id, user_id, direction, source, status_event_id, client_timestamp,
          geofence_status, gps_confidence, approval_state, requires_approval, approver_user_id, notes,
          timing_status, early_minutes, late_minutes, missed_punch_required
        )
        VALUES ($1,$2,$3,$4,$5,'correction',$6,$7,'unknown','outside','approved',true,$8,$9,$10,$11,$12,false)
        RETURNING *
      `,
      [
        auth.tenantId,
        shift.id,
        shift.shoot_id ?? null,
        exception.user_id,
        direction,
        statusEvent?.id ?? null,
        correctedTime,
        auth.id,
        `Approved missed ${direction === "in" ? "clock-in" : "clock-out"} correction`,
        timingStatus,
        direction === "in" ? getEarlyMinutes(shift.starts_at, correctedTime) || null : null,
        direction === "in" ? getLateMinutes(shift.starts_at, correctedTime) || null : null
      ]
    )
  ).rows[0] as ShiftPunchRow;

  if (statusEvent && shift.shoot_id) {
    await syncTimeEntryWithClockEvent(client, {
      tenantId: auth.tenantId,
      shiftId: shift.id,
      shootId: shift.shoot_id,
      userId: String(exception.user_id),
      type: direction === "in" ? "CLOCK_IN" : "CLOCK_OUT",
      event: statusEvent,
      shift
    });
  }

  const reportingFlags = [
    "manual_adjustment",
    direction === "in" ? "missed_clock_in_approval" : "missed_clock_out_approval"
  ];
  const workDate = getWorkDateForTimestamp(correctedTime, shift.shoot_date ?? null);
  const session = await getOrCreateTimeSessionForEmployeeDate(client, {
    tenantId: auth.tenantId,
    employeeId: String(exception.user_id),
    workDate,
    sourceShiftId: shift.id,
    status: direction === "in" ? "open" : "closed"
  });

  if (direction === "in") {
    const correctionSegment = await insertTimeSegmentCorrection(client, {
      tenantId: auth.tenantId,
      sessionId: session.id,
      employeeId: String(exception.user_id),
      shiftId: shift.id,
      shootId: shift.shoot_id ?? null,
      locationId,
      workState,
      startTime: timeClockRequest?.requested_start_time ?? correctedTime,
      endTime: timeClockRequest?.requested_end_time ?? null,
      sourceType: "manual_correction",
      reviewStatus: "approved",
      reportingFlags,
      actorUserId: auth.id
    });

    if (correctionSegment) {
      await insertTimeClockCorrectionEvent(client, {
        tenantId: auth.tenantId,
        employeeId: String(exception.user_id),
        sessionId: session.id,
        segmentId: correctionSegment.id,
        shootId: shift.shoot_id ?? null,
        locationId,
        eventType: "manual_correction",
        eventTimestamp: correctedTime,
        actor: getApprovalActorRole(auth) === "senior_photographer" ? "manager" : canEditHours(auth) ? "leadership" : "manager",
        metadata: {
          linked_shift_id: shift.id,
          attendance_exception_id: exception.id,
          exception_request_id: timeClockRequest?.id ?? null,
          correction_kind: "missing_clock_in"
        }
      });

      await createAuditLog(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        targetUserId: String(exception.user_id),
        action: "time_clock.time_segment.manual_correction",
        entityType: "time_segment",
        entityId: correctionSegment.id,
        previousValues: {},
        newValues: {
          linked_shift_id: correctionSegment.linked_shift_id,
          work_state: correctionSegment.work_state,
          start_time: correctionSegment.start_time,
          end_time: correctionSegment.end_time,
          source_type: correctionSegment.source_type,
          reporting_flags: correctionSegment.reporting_flags
        },
        reasonComment: `Approved missed ${direction === "in" ? "clock-in" : "clock-out"} correction`,
        metadata: {
          attendance_exception_id: exception.id,
          exception_request_id: timeClockRequest?.id ?? null
        },
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null
      });
    }
  } else {
    const openSegment = await getOpenTimeSegmentForContext(client, {
      tenantId: auth.tenantId,
      employeeId: String(exception.user_id),
      sessionId: session.id,
      shiftId: shift.id,
      shootId: shift.shoot_id ?? null
    });

    if (openSegment) {
      const segmentUpdate = await updateTimeSegmentEndTime(client, {
        segmentId: openSegment.id,
        endTime: timeClockRequest?.requested_end_time ?? correctedTime,
        reviewStatus: "approved",
        appendFlags: reportingFlags
      });
      if (segmentUpdate.updated) {
        await insertTimeClockCorrectionEvent(client, {
          tenantId: auth.tenantId,
          employeeId: String(exception.user_id),
          sessionId: session.id,
          segmentId: segmentUpdate.updated.id,
          shootId: shift.shoot_id ?? null,
          locationId,
          eventType: "manual_correction",
          eventTimestamp: correctedTime,
          actor: getApprovalActorRole(auth) === "senior_photographer" ? "manager" : canEditHours(auth) ? "leadership" : "manager",
          metadata: {
            linked_shift_id: shift.id,
            attendance_exception_id: exception.id,
            exception_request_id: timeClockRequest?.id ?? null,
            correction_kind: "missing_clock_out"
          }
        });

        await createAuditLog(client, {
          tenantId: auth.tenantId,
          actorUserId: auth.id,
          targetUserId: String(exception.user_id),
          action: "time_clock.time_segment.manual_correction",
          entityType: "time_segment",
          entityId: segmentUpdate.updated.id,
          previousValues: {
            end_time: segmentUpdate.previous.end_time,
            review_status: segmentUpdate.previous.review_status,
            reporting_flags: segmentUpdate.previous.reporting_flags
          },
          newValues: {
            end_time: segmentUpdate.updated.end_time,
            review_status: segmentUpdate.updated.review_status,
            reporting_flags: segmentUpdate.updated.reporting_flags
          },
          reasonComment: "Approved missed clock-out correction",
          metadata: {
            attendance_exception_id: exception.id,
            exception_request_id: timeClockRequest?.id ?? null
          },
          ipAddress: meta.ipAddress ?? null,
          userAgent: meta.userAgent ?? null
        });
      }
    } else {
      const correctionSegment = await insertTimeSegmentCorrection(client, {
        tenantId: auth.tenantId,
        sessionId: session.id,
        employeeId: String(exception.user_id),
        shiftId: shift.id,
        shootId: shift.shoot_id ?? null,
        locationId,
        workState,
        startTime: timeClockRequest?.requested_start_time ?? shift.starts_at,
        endTime: timeClockRequest?.requested_end_time ?? correctedTime,
        sourceType: "manual_correction",
        reviewStatus: "approved",
        reportingFlags,
        actorUserId: auth.id
      });

      if (correctionSegment) {
        await insertTimeClockCorrectionEvent(client, {
          tenantId: auth.tenantId,
          employeeId: String(exception.user_id),
          sessionId: session.id,
          segmentId: correctionSegment.id,
          shootId: shift.shoot_id ?? null,
          locationId,
          eventType: "manual_correction",
          eventTimestamp: correctedTime,
          actor: getApprovalActorRole(auth) === "senior_photographer" ? "manager" : canEditHours(auth) ? "leadership" : "manager",
          metadata: {
            linked_shift_id: shift.id,
            attendance_exception_id: exception.id,
            exception_request_id: timeClockRequest?.id ?? null,
            correction_kind: "missing_clock_out"
          }
        });

        await createAuditLog(client, {
          tenantId: auth.tenantId,
          actorUserId: auth.id,
          targetUserId: String(exception.user_id),
          action: "time_clock.time_segment.manual_correction",
          entityType: "time_segment",
          entityId: correctionSegment.id,
          previousValues: {},
          newValues: {
            linked_shift_id: correctionSegment.linked_shift_id,
            work_state: correctionSegment.work_state,
            start_time: correctionSegment.start_time,
            end_time: correctionSegment.end_time,
            source_type: correctionSegment.source_type,
            reporting_flags: correctionSegment.reporting_flags
          },
          reasonComment: "Approved missed clock-out correction",
          metadata: {
            attendance_exception_id: exception.id,
            exception_request_id: timeClockRequest?.id ?? null
          },
          ipAddress: meta.ipAddress ?? null,
          userAgent: meta.userAgent ?? null
        });
      }
    }
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: String(exception.user_id),
    action: "attendance.missed_punch.applied",
    entityType: "shift_punch",
    entityId: insertedPunch.id,
    metadata: {
      shift_id: shift.id,
      attendance_exception_id: exception.id,
      corrected_time: correctedTime,
      direction
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  await updateShiftAttendanceState(client, {
    shiftId: shift.id,
    state: "corrected",
    note: `Missed ${direction === "in" ? "clock-in" : "clock-out"} approved and applied.`,
    resolvedByUserId: auth.id,
    resolvedAt: new Date().toISOString()
  });

  return insertedPunch;
}

export async function createPunch(client: PoolClient, auth: AuthUser, input: PunchInput, meta: RequestMeta) {
  const existing = await ensurePunchIdempotency(client, auth.tenantId, input.clientEventId ?? null, input.idempotencyKey ?? null);
  if (existing) {
    const result = await buildPunchResult(client, existing);
    if (input.direction === "out") {
      result.closeout_compliance = await handleClockOutCloseoutCompliance(client, auth, {
        shiftId: existing.shift_id ?? null,
        shootId: existing.shoot_id ?? null,
        targetUserId: auth.id
      }, meta);
    }
    return result;
  }

  let shift = input.shiftId ? await findShiftById(client, input.shiftId) : null;
  if (!shift && input.shootId) {
    shift = await findShiftForShoot(client, auth, input.shootId, input.clientTimestamp);
  }

  if (shift) {
    await assertShiftAccess(client, auth, shift.id);
  } else if (input.shootId) {
    if (isFieldRole(auth)) {
      const shoot = await client.query(
        `
          SELECT id
          FROM shoot
          WHERE tenant_id = $1
            AND id = $2
            AND deleted_at IS NULL
          LIMIT 1
        `,
        [auth.tenantId, input.shootId]
      );
      if (!shoot.rows[0]) {
        throw new ApiError(404, "Shoot not found");
      }
    } else {
      await assertShootAccess(client, auth, input.shootId);
    }
  }

  await acquirePunchTransactionLock(client, {
    tenantId: auth.tenantId,
    employeeId: auth.id,
    shiftId: shift?.id ?? null,
    shootId: input.shootId ?? shift?.shoot_id ?? null
  });

  const lockedExisting = await ensurePunchIdempotency(client, auth.tenantId, input.clientEventId ?? null, input.idempotencyKey ?? null);
  if (lockedExisting) {
    const result = await buildPunchResult(client, lockedExisting);
    if (input.direction === "out") {
      result.closeout_compliance = await handleClockOutCloseoutCompliance(client, auth, {
        shiftId: lockedExisting.shift_id ?? null,
        shootId: lockedExisting.shoot_id ?? null,
        targetUserId: auth.id
      }, meta);
    }
    return result;
  }

  if (input.direction === "out") {
    const timeClockState = await getTimeClockStateSummary(client, {
      tenantId: auth.tenantId,
      employeeId: auth.id
    });
    if (!timeClockState.session_id || timeClockState.session_status === "off_clock") {
      throw new ApiError(409, "You cannot clock out without an active Time Session.");
    }
  }

  const shootId = input.shootId ?? shift?.shoot_id ?? null;
  const latestPunch = shift?.id
    ? (
        await client.query(
          `
            SELECT *
            FROM shift_punch
            WHERE shift_id = $1
              AND user_id = $2
            ORDER BY client_timestamp DESC, created_at DESC
            LIMIT 1
          `,
          [shift.id, auth.id]
        )
      ).rows[0] ?? null
    : shootId
      ? (
          await client.query(
            `
              SELECT *
              FROM shift_punch
              WHERE shift_id IS NULL
                AND shoot_id = $1
                AND user_id = $2
              ORDER BY client_timestamp DESC, created_at DESC
              LIMIT 1
            `,
            [shootId, auth.id]
          )
        ).rows[0] ?? null
      : null;

  const normalizedLatestPunch = latestPunch as ShiftPunchRow | null;

  if (normalizedLatestPunch && normalizedLatestPunch.direction === input.direction) {
    const result = await buildPunchResult(client, normalizedLatestPunch);
    if (input.direction === "out") {
      result.closeout_compliance = await handleClockOutCloseoutCompliance(client, auth, {
        shiftId: normalizedLatestPunch.shift_id ?? null,
        shootId: normalizedLatestPunch.shoot_id ?? null,
        targetUserId: auth.id
      }, meta);
    }
    return result;
  }

  const approverUserId = input.approverUserId ?? shift?.manager_user_id ?? null;
  const isClockIn = input.direction === "in";
  const earlyMinutes = shift && isClockIn ? getEarlyMinutes(shift.starts_at, input.clientTimestamp) : 0;
  const lateMinutes = shift && isClockIn ? getLateMinutes(shift.starts_at, input.clientTimestamp) : 0;
  const unscheduled = !shift;
  const relaxedValidation = input.enforcementMode === "legacy_compat";
  const allowedEarlyClockInMinutes =
    shift && isClockIn
      ? getClockInAllowanceMinutes({
          staffingRole: shift.staffing_role,
          satisfiesLeadCoverage: shift.satisfies_lead_coverage
        })
      : ATTENDANCE_POLICY.earlyGraceMinutes;
  const excessiveEarlyClockIn = Boolean(shift) && isClockIn && earlyMinutes > allowedEarlyClockInMinutes;
  const manualLocationOverride = Boolean(input.confirmedOutsideContext && input.reasonCode);
  const requiresMissedPunchWorkflow =
    Boolean(shift) && isClockIn && lateMinutes >= ATTENDANCE_POLICY.missedClockInMinutes && !relaxedValidation;

  if (requiresMissedPunchWorkflow) {
    throw new ApiError(409, "This shift is past the missed-punch threshold. Submit a missed punch request instead of a normal clock-in.");
  }

  if (!relaxedValidation && (unscheduled || excessiveEarlyClockIn) && (!input.reasonCode || !approverUserId)) {
    throw new ApiError(400, "This punch requires a reason and selected approver");
  }

  const locationTarget =
    shift && typeof shift.location_lat === "number" && typeof shift.location_lng === "number"
      ? {
          targetLat: Number(shift.location_lat),
          targetLng: Number(shift.location_lng),
          radiusMeters: Number(shift.geofence_radius_meters)
        }
      : shootId
        ? toLocationTarget(
            ((await client.query("SELECT location_lat, location_lng, geofence_radius_meters FROM shoot WHERE id = $1", [shootId])).rows[0] ??
              null) as ShootLocationRow | null
          )
        : null;

  const locationEvaluation = locationTarget
    ? evaluatePunchLocation({
        targetLat: locationTarget.targetLat,
        targetLng: locationTarget.targetLng,
        radiusMeters: locationTarget.radiusMeters,
        eventLat: input.latitude ?? null,
        eventLng: input.longitude ?? null,
        accuracyMeters: input.accuracyMeters ?? null,
        isAssignedContext: Boolean(shift),
        manualOverride: manualLocationOverride
      })
    : {
        geofenceStatus: "unknown" as const,
        gpsConfidence: "outside" as const,
        distanceMeters: null,
        distanceFeet: null,
        isInside: false,
        isLowConfidenceInside: false,
        locationClassification: "clock_in_pending_location_review" as const
      };
  const locationCaptured = typeof input.latitude === "number" && typeof input.longitude === "number";
  const locationUnavailable = Boolean(locationTarget) && !locationCaptured;
  const studio = getStudioLocation();
  const studioEvaluation = evaluatePunchLocation({
    targetLat: studio.latitude,
    targetLng: studio.longitude,
    radiusMeters: studio.geofenceRadiusMeters,
    eventLat: input.latitude ?? null,
    eventLng: input.longitude ?? null,
    accuracyMeters: input.accuracyMeters ?? null
  });
  const officeDriveClockIn = isClockIn && input.workState === "office_drive";
  const officeDriveWithinStudioContext = isClockIn && input.workState === "office_drive" && studioEvaluation.isInside;
  const pendingLocationReview =
    locationEvaluation.locationClassification === "near_site" ||
    locationEvaluation.locationClassification === "clock_in_pending_location_review" ||
    locationEvaluation.locationClassification === "manual_override" ||
    locationUnavailable;
  const outsideShiftContextForReview =
    (locationEvaluation.locationClassification === "wrong_location" ||
      locationEvaluation.locationClassification === "outside_allowed_zone") &&
    !officeDriveWithinStudioContext &&
    !officeDriveClockIn;

  if (
    !relaxedValidation &&
    outsideShiftContextForReview &&
    !input.reasonCode
  ) {
    throw new ApiError(400, "Outside-geofence punches require a reason");
  }

  const timingStatus: PunchTimingStatus = excessiveEarlyClockIn
    ? "early_exception"
    : getPunchTimingStatus({
        direction: input.direction,
        earlyMinutes,
        lateMinutes,
        requiresMissedPunchWorkflow
      });
  const operationalTimingState = classifyOperationalPunchTiming({
    direction: input.direction,
    earlyMinutes,
    lateMinutes
  });

  let statusEvent: ClockStatusEventRow | null = null;
  if (shootId) {
    statusEvent = (await createStatusEvent(client, {
      auth,
      tenantId: auth.tenantId,
      userId: auth.id,
      shootId,
      idempotencyKey: input.idempotencyKey ?? null,
      // Shift-based punches already passed assignment-aware access checks above.
      // Do not reapply the older shoot-assignment gate when generating the linked status event.
      skipShootAccess: Boolean(shift) || unscheduled,
      input: {
        type: input.direction === "in" ? "CLOCK_IN" : "CLOCK_OUT",
        captured_at: input.clientTimestamp,
        location_lat: input.latitude ?? null,
        location_lng: input.longitude ?? null,
        client_event_id: input.clientEventId ?? null,
        metadata: {
          accuracy_meters: input.accuracyMeters ?? null,
          shift_id: shift?.id ?? null,
          source: input.source ?? "mobile"
        }
      }
    })) as ClockStatusEventRow;
  }

  const approvalState =
    unscheduled || excessiveEarlyClockIn || outsideShiftContextForReview || pendingLocationReview
      ? ("pending" as const)
      : ("not_required" as const);

  const { rows } = await client.query(
    `
      INSERT INTO shift_punch (
        tenant_id, shift_id, shoot_id, user_id, direction, source, status_event_id, client_event_id, idempotency_key,
        client_timestamp, latitude, longitude, accuracy_meters, distance_from_expected_meters, expected_geofence_radius_meters,
        geofence_status, gps_confidence, early_minutes, late_minutes, timing_status, missed_punch_required, unscheduled,
        requires_approval, attested_approved, approver_user_id, approval_state, reason_code, notes, high_priority
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
      RETURNING *
    `,
    [
      auth.tenantId,
      shift?.id ?? null,
      shootId,
      auth.id,
      input.direction,
      input.source ?? "mobile",
      statusEvent?.id ?? null,
      input.clientEventId ?? null,
      input.idempotencyKey ?? null,
      input.clientTimestamp,
      input.latitude ?? null,
      input.longitude ?? null,
      input.accuracyMeters ?? null,
      locationEvaluation.distanceMeters ?? null,
      locationTarget ? locationTarget.radiusMeters : null,
      locationEvaluation.geofenceStatus,
      locationEvaluation.gpsConfidence,
      earlyMinutes || null,
      lateMinutes || null,
      timingStatus,
      requiresMissedPunchWorkflow,
      unscheduled,
      unscheduled || excessiveEarlyClockIn || outsideShiftContextForReview || pendingLocationReview,
      Boolean(input.attestedApproved),
      approverUserId,
      approvalState,
      input.reasonCode ?? null,
      input.notes ?? null,
      unscheduled ||
        excessiveEarlyClockIn ||
        timingStatus === "critically_late" ||
        outsideShiftContextForReview ||
        pendingLocationReview
    ]
  );
  const punch = rows[0] as ShiftPunchRow;

  const exceptions: AttendanceExceptionRow[] = [];
  if (isClockIn && excessiveEarlyClockIn && earlyMinutes <= allowedEarlyClockInMinutes + 15) {
    const exception = await createAttendanceException(client, {
      tenantId: auth.tenantId,
      shiftId: shift?.id ?? null,
      shootId,
      punchId: punch.id,
      userId: auth.id,
      exceptionType: "EARLY_CLOCK_IN_APPROVAL",
      severity: "high",
      reasonCode: input.reasonCode ?? "excessive_early_clock_in",
      notes:
        input.notes ??
        `Clock-in captured ${earlyMinutes} minutes early. The allowed early window for this role is ${allowedEarlyClockInMinutes} minutes.`,
      requestedApproverUserId: approverUserId,
      requestedValue: {
        early_minutes: earlyMinutes,
        allowed_early_minutes: allowedEarlyClockInMinutes
      }
    });
    exceptions.push(exception);
    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: auth.id,
      action: "attendance.early_clock_in.exception_requested",
      entityType: "shift_punch",
      entityId: punch.id,
      metadata: {
        shift_id: shift?.id ?? null,
        early_minutes: earlyMinutes,
        allowed_early_minutes: allowedEarlyClockInMinutes,
        approver_user_id: approverUserId
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });
    await logAutomaticAttendanceException(client, auth, exception, meta);
    await routePunchExceptionNotifications(client, auth, {
      shiftId: shift?.id ?? null,
      shootId,
      attendanceExceptionId: exception.id,
      notificationType: "attendance.early_clock_in",
      title: "Early clock-in needs review",
      body: `${auth.fullName} clocked in ${earlyMinutes} minutes early, beyond the allowed ${allowedEarlyClockInMinutes}-minute window.`,
      severity: "high",
      directUserIds: approverUserId ? [approverUserId] : []
    });
  }

  if (isClockIn && excessiveEarlyClockIn && earlyMinutes > allowedEarlyClockInMinutes + 15) {
    const exception = await createAttendanceException(client, {
      tenantId: auth.tenantId,
      shiftId: shift?.id ?? null,
      shootId,
      punchId: punch.id,
      userId: auth.id,
      exceptionType: "EARLY_CLOCK_IN_HIGH_PRIORITY",
      severity: "critical",
      reasonCode: input.reasonCode ?? "excessive_early_clock_in_high_priority",
      notes:
        input.notes ??
        `Clock-in captured ${earlyMinutes} minutes early. The allowed early window for this role is ${allowedEarlyClockInMinutes} minutes.`,
      requestedApproverUserId: approverUserId,
      requestedValue: {
        early_minutes: earlyMinutes,
        allowed_early_minutes: allowedEarlyClockInMinutes
      }
    });
    exceptions.push(exception);
    await logAutomaticAttendanceException(client, auth, exception, meta);
    await routePunchExceptionNotifications(client, auth, {
      shiftId: shift?.id ?? null,
      shootId,
      attendanceExceptionId: exception.id,
      notificationType: "attendance.early_clock_in_critical",
      title: "High-priority early punch",
      body: `${auth.fullName} clocked in ${earlyMinutes} minutes early, well beyond the allowed ${allowedEarlyClockInMinutes}-minute window.`,
      severity: "critical",
      directUserIds: approverUserId ? [approverUserId] : []
    });
  }

  if (isClockIn && lateMinutes >= ATTENDANCE_AWARENESS_POLICY.lateThresholdMinutes) {
    const isCriticalLate = lateMinutes >= ATTENDANCE_AWARENESS_POLICY.criticalLateThresholdMinutes;
    const exception = await createAttendanceException(client, {
      tenantId: auth.tenantId,
      shiftId: shift?.id ?? null,
      shootId,
      punchId: punch.id,
      userId: auth.id,
      exceptionType: isCriticalLate ? "LATE_CLOCK_IN" : "LATE_CLOCK_IN_WARNING",
      severity: isCriticalLate ? "critical" : "high",
      classification: isCriticalLate ? "critically_late" : "late",
      reasonCode: input.reasonCode ?? (isCriticalLate ? "critically_late_clock_in" : "late_clock_in"),
      notes:
        input.notes ??
        (isCriticalLate
          ? `Clock-in captured ${lateMinutes} minutes after the scheduled start and is now critically late.`
          : `Clock-in captured ${lateMinutes} minutes after the scheduled start.`),
      requestedApproverUserId: approverUserId,
      requestedValue: { late_minutes: lateMinutes }
    });
    exceptions.push(exception);
    await logAutomaticAttendanceException(client, auth, exception, meta);
    await routePunchExceptionNotifications(client, auth, {
      shiftId: shift?.id ?? null,
      shootId,
      attendanceExceptionId: exception.id,
      notificationType: isCriticalLate ? "attendance.late_clock_in" : "attendance.late_clock_in_warning",
      title: isCriticalLate ? "Critically late clock-in recorded" : "Late arrival recorded",
      body: `${auth.fullName} clocked in ${lateMinutes} minutes after the scheduled start.`,
      severity: isCriticalLate ? "critical" : "high",
      directUserIds: approverUserId ? [approverUserId] : []
    });
  }

  if (unscheduled && isClockIn) {
    const exception = await createAttendanceException(client, {
      tenantId: auth.tenantId,
      shiftId: null,
      shootId,
      punchId: punch.id,
      userId: auth.id,
      exceptionType: "UNSCHEDULED_PUNCH",
      severity: "critical",
      reasonCode: input.reasonCode ?? "unscheduled_punch",
      notes: input.notes ?? null,
      requestedApproverUserId: approverUserId
    });
    exceptions.push(exception);
    await logAutomaticAttendanceException(client, auth, exception, meta);
    await routePunchExceptionNotifications(client, auth, {
      shiftId: null,
      shootId,
      attendanceExceptionId: exception.id,
      notificationType: "attendance.unscheduled_punch",
      title: "Unscheduled punch needs review",
      body: `${auth.fullName} clocked in without a published shift.`,
      severity: "critical",
      directUserIds: approverUserId ? [approverUserId] : []
    });
  }

  if (locationEvaluation.gpsConfidence === "low_confidence") {
    const exception = await createAttendanceException(client, {
      tenantId: auth.tenantId,
      shiftId: shift?.id ?? null,
      shootId,
      punchId: punch.id,
      userId: auth.id,
      exceptionType: "LOW_CONFIDENCE_GPS",
      severity: "normal",
      reasonCode: input.reasonCode ?? "gps_accuracy",
      classification: locationEvaluation.locationClassification,
      notes:
        input.notes ??
        `Location was accepted near the edge of the allowed zone and is tagged ${humanizeOperationalLocation(locationEvaluation.locationClassification)}.`,
      requestedApproverUserId: approverUserId
    });
    exceptions.push(exception);
    await logAutomaticAttendanceException(client, auth, exception, meta);
  }

  if (locationUnavailable) {
    const exception = await createAttendanceException(client, {
      tenantId: auth.tenantId,
      shiftId: shift?.id ?? null,
      shootId,
      punchId: punch.id,
      userId: auth.id,
      exceptionType: "LOCATION_NOT_CAPTURED_PUNCH",
      severity: "high",
      reasonCode: input.reasonCode ?? "location_unavailable",
      classification: "clock_in_pending_location_review",
      notes: input.notes ?? "Location could not be captured when the punch was recorded and now needs review.",
      requestedApproverUserId: approverUserId
    });
    exceptions.push(exception);
    await logAutomaticAttendanceException(client, auth, exception, meta);
    await routePunchExceptionNotifications(client, auth, {
      shiftId: shift?.id ?? null,
      shootId,
      attendanceExceptionId: exception.id,
      notificationType: "attendance.location_unavailable",
      title: "Punch recorded without location",
      body: `${auth.fullName} punched ${input.direction === "in" ? "in" : "out"} without location data.`,
      severity: "high",
      directUserIds: approverUserId ? [approverUserId] : []
    });
  }

  if (outsideShiftContextForReview || locationEvaluation.locationClassification === "manual_override") {
    const exception = await createAttendanceException(client, {
      tenantId: auth.tenantId,
      shiftId: shift?.id ?? null,
      shootId,
      punchId: punch.id,
      userId: auth.id,
      exceptionType: "OUTSIDE_GEOFENCE_PUNCH",
      severity: "critical",
      reasonCode: input.reasonCode ?? "outside_geofence",
      classification: locationEvaluation.locationClassification,
      notes:
        input.notes ??
        `${humanizeOperationalLocation(locationEvaluation.locationClassification)} was recorded for this punch.`,
      requestedApproverUserId: approverUserId
    });
    exceptions.push(exception);
    await logAutomaticAttendanceException(client, auth, exception, meta);
    await routePunchExceptionNotifications(client, auth, {
      shiftId: shift?.id ?? null,
      shootId,
      attendanceExceptionId: exception.id,
      notificationType: "attendance.outside_geofence",
      title:
        locationEvaluation.locationClassification === "wrong_location"
          ? "Wrong-location punch flagged"
          : "Location override punch flagged",
      body: `${auth.fullName} punched ${input.direction === "in" ? "in" : "out"} with ${humanizeOperationalLocation(locationEvaluation.locationClassification)}.`,
      severity: "critical",
      directUserIds: approverUserId ? [approverUserId] : []
    });
  }

  let timeEntry = null;
  if (statusEvent && shootId) {
    timeEntry = await syncTimeEntryWithClockEvent(client, {
      tenantId: auth.tenantId,
      shiftId: shift?.id ?? null,
      shootId,
      userId: auth.id,
      type: input.direction === "in" ? "CLOCK_IN" : "CLOCK_OUT",
      event: statusEvent,
      shift
    });
  }

  const timeClockSync = await syncTimeClockForPunch(client, auth, {
    direction: input.direction,
    clientTimestamp: input.clientTimestamp,
    shiftId: shift?.id ?? input.shiftId ?? null,
    shootId,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    accuracyMeters: input.accuracyMeters ?? null,
    workState: input.workState ?? null,
    confirmedOutsideContext: Boolean(input.confirmedOutsideContext),
    confirmedPermission: Boolean(input.confirmedPermission),
    reasonCode: input.reasonCode ?? null,
    notes: input.notes ?? null,
    relaxedValidation: input.enforcementMode === "legacy_compat"
  });

  if (input.direction === "in") {
    await resolveTimeClockPresenceIncidents(client, {
      tenantId: auth.tenantId,
      employeeId: auth.id,
      shiftId: shift?.id ?? input.shiftId ?? null,
      shootId,
      resolvedAt: input.clientTimestamp,
      resolutionReason: "clock_in_recorded",
      actorUserId: auth.id
    });
  }

  await updateShiftAttendanceState(client, {
    shiftId: shift?.id ?? null,
    state: getAttendanceStateForPunch({
      direction: input.direction,
      timingStatus
    }),
    note:
      timingStatus === "critically_late"
        ? `Clock-in captured ${lateMinutes} minutes critically late.`
        : timingStatus === "late"
          ? `Clock-in captured ${lateMinutes} minutes late.`
          : timingStatus === "grace_window"
            ? `Clock-in captured ${lateMinutes} minutes into the grace window.`
            : timingStatus === "early"
              ? `Clock-in captured ${earlyMinutes} minutes early.`
          : input.direction === "out"
            ? "Clock-out captured."
            : "Clock-in captured."
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: auth.id,
    action: input.direction === "in" ? "attendance.punch_in" : "attendance.punch_out",
    entityType: "shift_punch",
    entityId: punch.id,
    metadata: {
      shift_id: shift?.id ?? null,
      unscheduled,
      timing_status: timingStatus,
      operational_timing_state: operationalTimingState,
      early_minutes: earlyMinutes || null,
      allowed_early_minutes: allowedEarlyClockInMinutes,
      excessive_early_clock_in: excessiveEarlyClockIn,
      late_minutes: lateMinutes || null,
      missed_punch_required: requiresMissedPunchWorkflow,
      gps_confidence: locationEvaluation.gpsConfidence,
      geofence_status: locationEvaluation.geofenceStatus,
      location_classification: locationEvaluation.locationClassification
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  await emitAttendanceRealtimeChange(client, {
    tenantId: auth.tenantId,
    changeType: "punch_created",
    shiftId: shift?.id ?? null,
    shootId,
    punchId: punch.id,
    versionToken: String(punch.created_at ?? punch.id)
  });

  const closeoutCompliance =
    input.direction === "out"
      ? await handleClockOutCloseoutCompliance(client, auth, {
          shiftId: shift?.id ?? null,
          shootId,
          targetUserId: auth.id
        }, meta)
      : null;
  const timeSession =
    shift?.id
      ? (
          await client.query<Pick<TimeSessionRow, "status">>(
            `
              SELECT status
              FROM time_session
              WHERE tenant_id = $1
                AND employee_id = $2
                AND source_shift_id = $3
              ORDER BY updated_at DESC
              LIMIT 1
            `,
            [auth.tenantId, auth.id, shift.id]
          )
        ).rows[0] ?? null
      : null;
  const locationClassification = toLocationClassification(
    punch,
    exceptions.find((item) => item.classification)?.classification ?? null
  );
  const interpretedTimeRecord = buildInterpretedTimeRecord({
    punch,
    timeEntry,
    timeSessionStatus: timeSession?.status ?? null,
    scheduledStartAt: shift?.starts_at ?? null,
    scheduledEndAt: shift?.ends_at ?? null,
    exceptionClassification: locationClassification,
    exceptionStatus: exceptions.find((item) => item.status)?.status ?? null
  });

  return {
    punch,
    event: statusEvent,
    timeEntry,
    exceptions,
    raw_clock_event: {
      id: punch.id,
      employee_id: punch.user_id,
      linked_assignment_id: punch.shift_id ?? null,
      shoot_id: punch.shoot_id ?? null,
      timestamp: punch.client_timestamp,
      action_type: punch.direction === "in" ? "clock_in" : "clock_out",
      detected_location_state: interpretedTimeRecord.location_state,
      gps_geofence_result: punch.geofence_status ?? null,
      source_device: punch.source ?? null,
      sync_state: "synced",
      manager_override_used: Boolean(punch.approver_user_id || punch.attested_approved || punch.approval_state === "approved"),
      employee_reason: punch.reason_code ?? punch.notes ?? null,
      created_at: punch.created_at
    },
    interpreted_time_record: interpretedTimeRecord,
    closeout_compliance: closeoutCompliance,
    time_clock_state: timeClockSync.timeClockState,
    time_clock_warnings: timeClockSync.warnings
  };
}

function mapAttendanceExceptionReviewRow<T extends Record<string, unknown>>(row: T) {
  const summary = deriveTimeReviewSummary({
    shiftEndsAt: typeof row.scheduled_end_at === "string" ? row.scheduled_end_at : null,
    exceptionStatus: typeof row.status === "string" ? row.status : null,
    exceptionSeverity: typeof row.severity === "string" ? row.severity : null,
    exceptionType: typeof row.exception_type === "string" ? row.exception_type : null,
    exceptionClassification: typeof row.classification === "string" ? row.classification : null,
    shiftAttendanceState: typeof row.shift_attendance_state === "string" ? (row.shift_attendance_state as AttendanceState) : null,
    timeEntryAttendanceState: typeof row.time_entry_attendance_state === "string" ? (row.time_entry_attendance_state as AttendanceState) : null,
    clockInAt: typeof row.time_record_clock_in_at === "string" ? row.time_record_clock_in_at : null,
    clockOutAt: typeof row.time_record_clock_out_at === "string" ? row.time_record_clock_out_at : null,
    latestPunchDirection:
      row.latest_punch_direction === "in" || row.latest_punch_direction === "out" ? row.latest_punch_direction : null,
    latestPunchApprovalState:
      typeof row.latest_punch_approval_state === "string" ? row.latest_punch_approval_state : null,
    latestPunchGeofenceStatus:
      typeof row.latest_punch_geofence_status === "string" ? row.latest_punch_geofence_status : null,
    timeClockRequestStatus:
      typeof row.time_clock_request_status === "string" ? row.time_clock_request_status : null,
    timeSessionStatus:
      typeof row.time_session_status === "string" ? (row.time_session_status as TimeSessionStatus) : null
  });

  return {
    ...row,
    time_record_state: summary.timeRecordState,
    time_record_state_label: summary.timeRecordStateLabel,
    time_record_correction_state: summary.correctionState,
    time_record_correction_label: summary.correctionStateLabel,
    time_record_finalization_state: summary.finalizationState,
    time_record_finalization_label: summary.finalizationStateLabel,
    time_record_nearing_finalization: summary.nearingFinalization,
    time_record_locked: summary.finalizationState === "finalized",
    time_record_location_state: summary.locationState,
    time_record_location_label: summary.locationStateLabel,
    time_review_priority: summary.reviewPriority,
    time_review_priority_label: summary.reviewPriorityLabel
  };
}

export async function listAttendanceExceptions(
  client: PoolClient,
  auth: AuthUser,
  filters: { status?: string; userId?: string; shiftId?: string; shootId?: string; date?: string } = {}
) {
  const values: unknown[] = [auth.tenantId];
  const where = ["ae.tenant_id = $1"];

  if (filters.status) {
    values.push(filters.status);
    where.push(`ae.status = $${values.length}::attendance_exception_status`);
  }
  if (filters.userId) {
    values.push(filters.userId);
    where.push(`ae.user_id = $${values.length}`);
  }
  if (filters.shiftId) {
    values.push(filters.shiftId);
    where.push(`ae.shift_id = $${values.length}`);
  }
  if (filters.shootId) {
    values.push(filters.shootId);
    where.push(`COALESCE(ae.shoot_id, ws.shoot_id) = $${values.length}::uuid`);
  }
  if (filters.date) {
    const { start, endExclusive } = getLocalDayBounds(filters.date);
    values.push(start.toISOString());
    where.push(`ae.created_at >= $${values.length}::timestamptz`);
    values.push(endExclusive.toISOString());
    where.push(`ae.created_at < $${values.length}::timestamptz`);
  }
  if (shouldRestrictShiftList(auth)) {
    values.push(auth.id);
    const authParam = `$${values.length}`;
    if (hasJobFunctionProfile(auth, "senior_photographer")) {
      values.push(auth.tenantId);
      const tenantParam = `$${values.length}`;
      const { start, endExclusive } = getLocalDayBounds(getLocalDateString());
      values.push(start.toISOString());
      const todayStartParam = `$${values.length}::timestamptz`;
      values.push(endExclusive.toISOString());
      const todayEndParam = `$${values.length}::timestamptz`;
      where.push(`(
        ae.user_id = ${authParam}
        OR ws.manager_user_id = ${authParam}
        OR (
          ws.shoot_id IS NOT NULL
          AND ws.starts_at < ${todayEndParam}
          AND ws.ends_at >= ${todayStartParam}
          AND EXISTS (
            SELECT 1
            FROM work_shift scope_ws
            JOIN user_job_function_profile ujp
              ON ujp.user_id = scope_ws.assigned_user_id
             AND ujp.tenant_id = scope_ws.tenant_id
            WHERE scope_ws.tenant_id = ${tenantParam}
              AND scope_ws.shoot_id = ws.shoot_id
              AND scope_ws.assigned_user_id = ${authParam}
              AND scope_ws.status = 'published'
              AND scope_ws.cancelled_at IS NULL
              AND ujp.job_function_profile = 'senior_photographer'
          )
        )
      )`);
    } else {
      where.push(`ae.user_id = ${authParam}`);
    }
  }

  const { rows } = await client.query(
    `
      SELECT
        ae.*,
        ws.title AS shift_title,
        ws.department,
        ws.starts_at::text AS scheduled_start_at,
        ws.ends_at::text AS scheduled_end_at,
        ws.attendance_state::text AS shift_attendance_state,
        ws.attendance_state_note,
        s.shoot_code,
        au.full_name AS user_name,
        manager.full_name AS manager_name,
        requested_approver.full_name AS requested_approver_name,
        approved_by.full_name AS approved_by_name,
        er.id AS time_clock_exception_request_id,
        er.status::text AS time_clock_request_status,
        er.request_type::text AS time_clock_request_type,
        er.requested_state::text AS time_clock_requested_state,
        er.requested_start_time::text AS time_clock_requested_start_time,
        er.requested_end_time::text AS time_clock_requested_end_time,
        er.reporting_flags AS time_clock_reporting_flags,
        er.original_values AS time_clock_original_values,
        er.resolved_values AS time_clock_resolved_values,
        latest_punch.id AS latest_punch_id,
        latest_punch.direction AS latest_punch_direction,
        latest_punch.client_timestamp::text AS latest_punch_at,
        latest_punch.geofence_status AS latest_punch_geofence_status,
        latest_punch.approval_state AS latest_punch_approval_state,
        latest_punch.reason_code AS latest_punch_reason_code,
        latest_punch.requires_approval AS latest_punch_requires_approval,
        latest_punch.source AS latest_punch_source,
        latest_punch.notes AS latest_punch_notes,
        time_entry.clock_in_at::text AS time_record_clock_in_at,
        time_entry.clock_out_at::text AS time_record_clock_out_at,
        time_entry.minutes_worked AS time_record_worked_minutes,
        time_entry.attendance_state::text AS time_entry_attendance_state,
        time_entry.break_deduction_overridden AS time_record_break_override,
        session_row.status::text AS time_session_status,
        session_row.work_date::text AS time_session_work_date,
        COALESCE(approval_records.records, '[]'::json) AS time_clock_approval_records
      FROM attendance_exception ae
      LEFT JOIN work_shift ws ON ws.id = ae.shift_id
      LEFT JOIN shoot s ON s.id = ae.shoot_id
      LEFT JOIN exception_request er ON er.related_attendance_exception_id = ae.id
      JOIN app_user au ON au.id = ae.user_id
      LEFT JOIN app_user manager ON manager.id = ws.manager_user_id
      LEFT JOIN app_user requested_approver ON requested_approver.id = ae.requested_approver_user_id
      LEFT JOIN app_user approved_by ON approved_by.id = ae.approved_by_user_id
      LEFT JOIN LATERAL (
        SELECT
          sp.id,
          sp.direction,
          sp.client_timestamp,
          sp.geofence_status,
          sp.approval_state,
          sp.reason_code,
          sp.requires_approval,
          sp.source,
          sp.notes
        FROM shift_punch sp
        WHERE sp.tenant_id = ae.tenant_id
          AND sp.user_id = ae.user_id
          AND (
            (ae.punch_id IS NOT NULL AND sp.id = ae.punch_id)
            OR (ae.shift_id IS NOT NULL AND sp.shift_id = ae.shift_id)
            OR (ae.shift_id IS NULL AND ae.shoot_id IS NOT NULL AND sp.shoot_id = ae.shoot_id)
          )
        ORDER BY CASE WHEN sp.id = ae.punch_id THEN 0 ELSE 1 END, sp.client_timestamp DESC, sp.created_at DESC
        LIMIT 1
      ) latest_punch ON true
      LEFT JOIN LATERAL (
        SELECT
          te.clock_in_at,
          te.clock_out_at,
          te.minutes_worked,
          te.attendance_state,
          te.break_deduction_overridden,
          te.created_at
        FROM time_entry te
        WHERE te.user_id = ae.user_id
          AND (
            (ae.shift_id IS NOT NULL AND te.shift_id = ae.shift_id)
            OR (ae.shift_id IS NULL AND ae.shoot_id IS NOT NULL AND te.shoot_id = ae.shoot_id)
          )
        ORDER BY COALESCE(te.clock_out_at, te.clock_in_at) DESC, te.created_at DESC
        LIMIT 1
      ) time_entry ON true
      LEFT JOIN LATERAL (
        SELECT ts.status, ts.work_date, ts.updated_at
        FROM time_session ts
        WHERE ts.tenant_id = ae.tenant_id
          AND ts.employee_id = ae.user_id
          AND ae.shift_id IS NOT NULL
          AND ts.source_shift_id = ae.shift_id
        ORDER BY ts.updated_at DESC
        LIMIT 1
      ) session_row ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object(
            'id', ar.id,
            'approver_id', ar.approver_id,
            'approver_role', ar.approver_role,
            'decision', ar.decision::text,
            'comment', ar.comment,
            'decided_at', ar.decided_at
          )
          ORDER BY ar.decided_at ASC
        ) AS records
        FROM approval_record ar
        WHERE er.id IS NOT NULL
          AND ar.request_id = er.id
      ) approval_records ON true
      WHERE ${where.join(" AND ")}
      ORDER BY ae.created_at DESC
    `,
    values
  );
  return rows.map((row) => mapAttendanceExceptionReviewRow(row as Record<string, unknown>));
}

export async function submitAttendanceExceptionRequest(
  client: PoolClient,
  auth: AuthUser,
  input: AttendanceExceptionRequestInput,
  meta: RequestMeta
) {
  const shift = input.shift_id ? await findShiftById(client, input.shift_id) : null;
  if (input.shift_id) {
    await assertShiftAccess(client, auth, input.shift_id);
  }

  const exception = await createAttendanceException(client, {
    tenantId: auth.tenantId,
    shiftId: input.shift_id ?? null,
    punchId: input.punch_id ?? null,
    shootId: shift?.shoot_id ?? null,
    userId: auth.id,
    exceptionType: input.exception_type,
    severity: "high",
    reasonCode: input.reason_code,
    notes: input.notes ?? null,
    requestedApproverUserId: input.requested_approver_user_id ?? null,
    requestedValue: {
      ...(input.requested_value ?? {}),
      ...(shift
        ? {
            scheduled_start: shift.starts_at,
            scheduled_end: shift.ends_at,
            shift_title: shift.title
          }
        : {})
    },
    originalValue: input.original_value ?? {},
    workflowKind: getExceptionWorkflowKind(input.exception_type),
    missingDirection: getMissingDirectionForException(input.exception_type)
  });

  const canonicalRequestId = await createCanonicalTimeClockRequestForAttendanceException(client, {
    tenantId: auth.tenantId,
    employeeId: auth.id,
    attendanceExceptionId: exception.id,
    exceptionType: input.exception_type,
    workflowKind: getExceptionWorkflowKind(input.exception_type),
    missingDirection: getMissingDirectionForException(input.exception_type),
    shift,
    requestedApproverUserId: input.requested_approver_user_id ?? null,
    requestedWorkState:
      input.requested_value && typeof input.requested_value.work_state === "string" &&
      (input.requested_value.work_state === "office_drive" || input.requested_value.work_state === "photography")
        ? input.requested_value.work_state
        : null,
    requestedStartTime:
      input.requested_value && typeof input.requested_value.requested_start_time === "string"
        ? input.requested_value.requested_start_time
        : input.requested_value && typeof input.requested_value.start_time === "string"
          ? input.requested_value.start_time
          : null,
    requestedEndTime:
      input.requested_value && typeof input.requested_value.requested_end_time === "string"
        ? input.requested_value.requested_end_time
        : input.requested_value && typeof input.requested_value.end_time === "string"
          ? input.requested_value.end_time
          : null,
    originalValues: input.original_value ?? {},
    requestedValues: input.requested_value ?? {},
    note: input.notes ?? `${input.exception_type} requested from Mission Control.`,
    reportingFlags: ["manual_adjustment"]
  });

  if (canonicalRequestId) {
    await insertTimeClockCorrectionEvent(client, {
      tenantId: auth.tenantId,
      employeeId: auth.id,
      shootId: shift?.shoot_id ?? null,
      locationId: await getShootLocationId(client, auth.tenantId, shift?.shoot_id ?? null),
      eventType: "exception_requested",
      eventTimestamp: new Date().toISOString(),
      actor: "employee",
      metadata: {
        attendance_exception_id: exception.id,
        exception_request_id: canonicalRequestId,
        linked_shift_id: shift?.id ?? null
      }
    });
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: auth.id,
    action: "attendance.exception.requested",
    entityType: "attendance_exception",
    entityId: exception.id,
    metadata: { exception_type: input.exception_type },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  await emitAttendanceRealtimeChange(client, {
    tenantId: auth.tenantId,
    changeType: "exception_created",
    shiftId: input.shift_id ?? null,
    punchId: input.punch_id ?? null,
    exceptionId: exception.id,
    status: exception.status ?? null,
    classification: exception.classification ?? null,
    versionToken: String(exception.created_at ?? exception.id)
  });

  await routePunchExceptionNotifications(client, auth, {
    shiftId: input.shift_id ?? null,
    attendanceExceptionId: exception.id,
    notificationType: "attendance.exception_requested",
    title: "Attendance correction requested",
    body: `${auth.fullName} submitted a ${input.exception_type} request.`,
    severity: "high",
    directUserIds: input.requested_approver_user_id ? [input.requested_approver_user_id] : []
  });

  return exception;
}

export async function submitMissedPunchRequest(
  client: PoolClient,
  auth: AuthUser,
  input: MissedPunchRequestInput,
  meta: RequestMeta
) {
  await assertShiftAccess(client, auth, input.shift_id);
  const shift = await findShiftById(client, input.shift_id);
  if (!shift) {
    throw new ApiError(404, "Shift not found");
  }
  assertMutableTimeSession(
    await getLatestTimeSessionForShift(client, auth.tenantId, auth.id, shift.id),
    "This shift is locked because its Time Session has already been approved or exported to payroll."
  );

  const exceptionType = input.missing_direction === "in" ? "FORGOT_TO_CLOCK_IN" : "FORGOT_TO_CLOCK_OUT";
  const exception = await createAttendanceException(client, {
    tenantId: auth.tenantId,
    shiftId: shift.id,
    shootId: shift.shoot_id ?? null,
    userId: auth.id,
    exceptionType,
    severity: "high",
    reasonCode: "missed_punch",
    notes: input.notes ?? input.employee_submitted_explanation,
    requestedApproverUserId: input.requested_approver_user_id ?? shift.manager_user_id ?? null,
    requestedValue: {
      scheduled_start: shift.starts_at,
      scheduled_end: shift.ends_at,
      corrected_time: input.corrected_time ?? null,
      employee_explanation: input.employee_submitted_explanation
    },
    originalValue: {},
    workflowKind: "missed_punch",
    missingDirection: input.missing_direction,
    correctedTime: input.corrected_time ?? null
  });

  const canonicalRequestId = await createCanonicalTimeClockRequestForAttendanceException(client, {
    tenantId: auth.tenantId,
    employeeId: auth.id,
    attendanceExceptionId: exception.id,
    exceptionType,
    workflowKind: "missed_punch",
    missingDirection: input.missing_direction,
    shift,
    requestedApproverUserId: input.requested_approver_user_id ?? shift.manager_user_id ?? null,
    requestedWorkState: input.requested_work_state ?? getDefaultRequestedWorkState(shift),
    requestedStartTime:
      input.requested_start_time ??
      (input.missing_direction === "in" ? input.corrected_time ?? shift.starts_at : null),
    requestedEndTime:
      input.requested_end_time ??
      (input.missing_direction === "out" ? input.corrected_time ?? shift.ends_at : null),
    locationContext: input.location_context ?? null,
    originalValues: {},
    requestedValues: {
      scheduled_start: shift.starts_at,
      scheduled_end: shift.ends_at,
      corrected_time: input.corrected_time ?? null,
      employee_explanation: input.employee_submitted_explanation,
      requested_work_state: input.requested_work_state ?? getDefaultRequestedWorkState(shift)
    },
    note: input.notes ?? input.employee_submitted_explanation,
    reportingFlags: [
      "manual_adjustment",
      input.missing_direction === "in" ? "missed_clock_in_approval" : "missed_clock_out_approval"
    ]
  });

  if (canonicalRequestId) {
    await insertTimeClockCorrectionEvent(client, {
      tenantId: auth.tenantId,
      employeeId: auth.id,
      shootId: shift.shoot_id ?? null,
      locationId: await getShootLocationId(client, auth.tenantId, shift.shoot_id ?? null),
      eventType: "exception_requested",
      eventTimestamp: new Date().toISOString(),
      actor: "employee",
      metadata: {
        attendance_exception_id: exception.id,
        exception_request_id: canonicalRequestId,
        linked_shift_id: shift.id,
        missing_direction: input.missing_direction
      }
    });
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: auth.id,
    action: "attendance.missed_punch.requested",
    entityType: "attendance_exception",
    entityId: exception.id,
    metadata: {
      shift_id: shift.id,
      missing_direction: input.missing_direction,
      corrected_time: input.corrected_time ?? null
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  await updateShiftAttendanceState(client, {
    shiftId: shift.id,
    state: input.missing_direction === "in" ? "missed_clock_in" : "missed_clock_out",
    note: `Missed ${input.missing_direction === "in" ? "clock-in" : "clock-out"} request submitted.`
  });

  await emitAttendanceRealtimeChange(client, {
    tenantId: auth.tenantId,
    changeType: "exception_created",
    shiftId: shift.id,
    shootId: shift.shoot_id ?? null,
    exceptionId: exception.id,
    status: exception.status ?? null,
    classification: exception.classification ?? null,
    versionToken: String(exception.created_at ?? exception.id)
  });

  await routePunchExceptionNotifications(client, auth, {
    shiftId: shift.id,
    shootId: shift.shoot_id ?? null,
    attendanceExceptionId: exception.id,
    notificationType: "attendance.missed_punch_requested",
    title: `Missed ${input.missing_direction === "in" ? "clock-in" : "clock-out"} submitted`,
    body: `${auth.fullName} submitted a missed ${input.missing_direction === "in" ? "clock-in" : "clock-out"} request for ${shift.title}.`,
    severity: "high",
    directUserIds: input.requested_approver_user_id ? [input.requested_approver_user_id] : shift.manager_user_id ? [String(shift.manager_user_id)] : []
  });

  return exception;
}

export async function listMissedPunchRequests(
  client: PoolClient,
  auth: AuthUser,
  filters: { status?: string; date?: string; shootId?: string } = {}
) {
  const values: unknown[] = [auth.tenantId];
  const where = ["ae.tenant_id = $1", "ae.workflow_kind = 'missed_punch'"];

  if (filters.status) {
    values.push(filters.status);
    where.push(`ae.status = $${values.length}::attendance_exception_status`);
  }
  if (filters.date) {
    const { start, endExclusive } = getLocalDayBounds(filters.date);
    values.push(start.toISOString());
    where.push(`ae.created_at >= $${values.length}::timestamptz`);
    values.push(endExclusive.toISOString());
    where.push(`ae.created_at < $${values.length}::timestamptz`);
  }
  if (filters.shootId) {
    values.push(filters.shootId);
    where.push(`COALESCE(ae.shoot_id, ws.shoot_id) = $${values.length}::uuid`);
  }
  if (shouldRestrictShiftList(auth)) {
    values.push(auth.id);
    where.push(`(ae.user_id = $${values.length} OR ws.manager_user_id = $${values.length})`);
  }

  const { rows } = await client.query(
    `
      SELECT
        ae.*,
        ws.title AS shift_title,
        ws.department,
        requester.full_name AS user_name,
        manager.full_name AS manager_name,
        req_approver.full_name AS requested_approver_name,
        approver.full_name AS approved_by_name,
        s.shoot_code,
        er.id AS time_clock_exception_request_id,
        er.status::text AS time_clock_request_status,
        er.request_type::text AS time_clock_request_type,
        er.requested_state::text AS time_clock_requested_state,
        er.requested_start_time::text AS time_clock_requested_start_time,
        er.requested_end_time::text AS time_clock_requested_end_time,
        er.reporting_flags AS time_clock_reporting_flags,
        er.original_values AS time_clock_original_values,
        er.resolved_values AS time_clock_resolved_values,
        COALESCE(approval_records.records, '[]'::json) AS time_clock_approval_records
      FROM attendance_exception ae
      LEFT JOIN work_shift ws ON ws.id = ae.shift_id
      LEFT JOIN shoot s ON s.id = COALESCE(ae.shoot_id, ws.shoot_id)
      LEFT JOIN exception_request er ON er.related_attendance_exception_id = ae.id
      JOIN app_user requester ON requester.id = ae.user_id
      LEFT JOIN app_user manager ON manager.id = ws.manager_user_id
      LEFT JOIN app_user req_approver ON req_approver.id = ae.requested_approver_user_id
      LEFT JOIN app_user approver ON approver.id = ae.approved_by_user_id
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object(
            'id', ar.id,
            'approver_id', ar.approver_id,
            'approver_role', ar.approver_role,
            'decision', ar.decision::text,
            'comment', ar.comment,
            'decided_at', ar.decided_at
          )
          ORDER BY ar.decided_at ASC
        ) AS records
        FROM approval_record ar
        WHERE er.id IS NOT NULL
          AND ar.request_id = er.id
      ) approval_records ON true
      WHERE ${where.join(" AND ")}
      ORDER BY ae.created_at DESC
    `,
    values
  );
  return rows;
}

export async function reviewMissedPunchRequest(
  client: PoolClient,
  auth: AuthUser,
  exceptionId: string,
  input: { status: "approved" | "rejected" | "resolved"; corrected_time?: string | null; notes?: string | null },
  meta: RequestMeta
) {
  const { rows } = await client.query(
    "SELECT * FROM attendance_exception WHERE id = $1 AND workflow_kind = 'missed_punch' LIMIT 1",
    [exceptionId]
  );
  const exception = rows[0] as AttendanceExceptionRow | undefined;
  if (!exception) {
    throw new ApiError(404, "Missed punch request not found");
  }

  if (exception.shift_id) {
    await assertShiftManagementScope(client, auth, exception.shift_id);
  } else if (!canPerformAction(auth, "attendance.manage")) {
    throw new ApiError(403, "Forbidden");
  }
  if (!canFinalizeTimeClockCorrection(auth)) {
    throw new ApiError(403, "This approval path requires a senior photographer, director, or leadership reviewer.");
  }

  const correctedTime = input.corrected_time ?? exception.corrected_time ?? null;
  const timeClockRequest = await getTimeClockExceptionRequestByAttendanceExceptionId(client, auth.tenantId, exceptionId);
  assertMutableTimeSession(
    await resolveRelatedTimeSessionForAttendanceException(client, auth.tenantId, exception, timeClockRequest),
    "This missed-punch request is locked because the linked Time Session has already been approved or exported to payroll."
  );
  if (input.status === "approved" && !correctedTime) {
    throw new ApiError(400, "Approving a missed punch requires a corrected time");
  }

  if (input.status === "approved" && correctedTime) {
    assertBackdatedPunchCorrectionWindow(correctedTime);
    await applyApprovedMissedPunch(client, auth, exception, correctedTime, meta);
  }

  const { rows: updatedRows } = await client.query(
    `
      UPDATE attendance_exception
      SET status = $2::attendance_exception_status,
          notes = COALESCE($3, notes),
          corrected_time = COALESCE($4, corrected_time),
          resolved_value = jsonb_strip_nulls(COALESCE(resolved_value, '{}'::jsonb) || jsonb_build_object('corrected_time', $4)),
          approved_by_user_id = $5,
          approved_at = now(),
          updated_at = now(),
          classification = CASE
            WHEN $2::attendance_exception_status = 'approved' THEN 'corrected'
            WHEN $2::attendance_exception_status = 'resolved' THEN 'resolved'
            ELSE classification
          END
      WHERE id = $1
      RETURNING *
    `,
    [exceptionId, input.status, input.notes ?? null, correctedTime, auth.id]
  );
  const updated = updatedRows[0];

  if (timeClockRequest) {
    const approvalRecord = await insertTimeClockApprovalRecord(client, {
      tenantId: auth.tenantId,
      requestId: timeClockRequest.id,
      approverId: auth.id,
      approverRole: getApprovalActorRole(auth),
      decision: input.status === "approved" ? "approved" : input.status === "rejected" ? "rejected" : "returned",
      comment: input.notes ?? null
    });

    const reviewedRequest = await updateTimeClockExceptionRequestReview(client, {
      requestId: timeClockRequest.id,
      status: input.status === "approved" ? "approved" : input.status === "rejected" ? "rejected" : "cancelled",
      reviewedBy: auth.id,
      resolvedValues: correctedTime ? { corrected_time: correctedTime } : {},
      note: input.notes ?? null,
      appendFlags:
        input.status === "approved"
          ? ["manual_adjustment", "missed_clock_in_approval"]
          : input.status === "rejected"
            ? ["manual_adjustment"]
            : ["manual_adjustment"]
    });

    await insertTimeClockCorrectionEvent(client, {
      tenantId: auth.tenantId,
      employeeId: String(exception.user_id),
      sessionId: reviewedRequest?.linked_session_id ?? null,
      segmentId: reviewedRequest?.linked_segment_id ?? null,
      shootId: reviewedRequest?.linked_shoot_id ?? exception.shoot_id ?? null,
      locationId: null,
      eventType: "approval_recorded",
      eventTimestamp: new Date().toISOString(),
      actor: getApprovalActorRole(auth) === "senior_photographer" ? "manager" : canEditHours(auth) ? "leadership" : "manager",
      metadata: {
        attendance_exception_id: exception.id,
        exception_request_id: timeClockRequest.id,
        approval_record_id: approvalRecord?.id ?? null,
        decision: input.status,
        corrected_time: correctedTime
      }
    });

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: String(exception.user_id),
      action: `time_clock.exception_request.${input.status}`,
      entityType: "exception_request",
      entityId: timeClockRequest.id,
      previousValues: {
        status: timeClockRequest.status,
        resolved_values: timeClockRequest.resolved_values
      },
      newValues: {
        status: reviewedRequest?.status ?? null,
        resolved_values: reviewedRequest?.resolved_values ?? {}
      },
      reasonComment: input.notes ?? null,
      metadata: {
        attendance_exception_id: exception.id,
        approval_record_id: approvalRecord?.id ?? null,
        approval_level: getApprovalLevelLabel(
          resolveAttendanceApprovalLevel({
            protectedHistoryEdit: false,
            exceptionReview: true
          })
        ),
        approval_role_group: resolvePhase1RoleGroup(auth)
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });

    if (timeClockRequest.linked_session_id) {
      await syncTimeSessionPayrollSummary(client, {
        tenantId: auth.tenantId,
        sessionId: timeClockRequest.linked_session_id,
        actorUserId: auth.id,
        auth,
        reasonComment: input.notes ?? "Time correction review updated payroll summary."
      });
    }
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: String(exception.user_id),
    action: `attendance.missed_punch.${input.status}`,
    entityType: "attendance_exception",
    entityId: exceptionId,
    metadata: {
      shift_id: exception.shift_id ?? null,
      missing_direction: exception.missing_direction ?? null,
      corrected_time: correctedTime
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  await updateShiftAttendanceState(client, {
    shiftId: updated.shift_id ?? null,
    state: input.status === "approved" ? "corrected" : input.status === "resolved" ? "resolved" : exception.missing_direction === "in" ? "missed_clock_in" : "missed_clock_out",
    note:
      input.status === "approved"
        ? "Missed punch approved."
        : input.status === "resolved"
          ? "Missed punch resolved."
          : "Missed punch sent back.",
    resolvedByUserId: input.status === "approved" || input.status === "resolved" ? auth.id : null,
    resolvedAt: input.status === "approved" || input.status === "resolved" ? new Date().toISOString() : null
  });

  if (input.status === "approved" || input.status === "resolved") {
    await resolveTimeClockPresenceIncidents(client, {
      tenantId: auth.tenantId,
      employeeId: String(exception.user_id),
      shiftId: updated.shift_id ?? null,
      shootId: updated.shoot_id ?? null,
      resolvedAt: new Date().toISOString(),
      resolutionReason: "attendance_correction_approved",
      actorUserId: auth.id
    });
    await resolveTimeClockComplianceFlags(client, {
      tenantId: auth.tenantId,
      employeeId: String(exception.user_id),
      shiftId: updated.shift_id ?? null,
      shootId: updated.shoot_id ?? null,
      itemTypes: ["upload_while_off_clock"],
      linkedExceptionRequestId: timeClockRequest?.id ?? null,
      resolutionNote: "Approved missed punch correction resolved the Off Clock upload mismatch.",
      actorUserId: auth.id
    });
  }

  await queueNotificationDispatch(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    recipientUserIds: [String(exception.user_id)],
    notificationType: `attendance.missed_punch_${input.status}`,
    title: `Missed punch ${input.status}`,
    body: `Your missed ${exception.missing_direction === "in" ? "clock-in" : "clock-out"} request is now ${input.status}.`,
    priority: "high",
    deepLink: exception.shift_id ? `/attendance/shifts/${exception.shift_id}` : "/attendance",
    shiftId: exception.shift_id ?? null,
    shootId: exception.shoot_id ?? null,
    attendanceExceptionId: exception.id,
    relatedUserId: String(exception.user_id),
    channels: ["in_app", "push"],
    metadata: { dedupe: exception.id }
  });

  await emitAttendanceRealtimeChange(client, {
    tenantId: auth.tenantId,
    changeType: "exception_reviewed",
    shiftId: updated.shift_id ?? null,
    shootId: updated.shoot_id ?? null,
    exceptionId: updated.id,
    status: updated.status ?? null,
    classification: updated.classification ?? null,
    versionToken: String(updated.updated_at ?? updated.id)
  });

  return updated;
}

export async function createLeadershipTimeAdjustment(
  client: PoolClient,
  auth: AuthUser,
  input: LeadershipTimeAdjustmentInput,
  meta: RequestMeta
) {
  if (!canEditHours(auth)) {
    throw new ApiError(403, "Only leadership can create manual Time Segment adjustments.");
  }

  const shift = input.shift_id ? await findShiftById(client, input.shift_id) : null;
  const originalSegment = input.segment_id
    ? (
        await client.query<TimeSegmentRow>(
          `
            SELECT *
            FROM time_segment
            WHERE tenant_id = $1
              AND id = $2
            LIMIT 1
          `,
          [auth.tenantId, input.segment_id]
        )
      ).rows[0] ?? null
    : null;

  if (input.segment_id && !originalSegment) {
    throw new ApiError(404, "Original Time Segment not found");
  }
  if (originalSegment && !originalSegment.end_time) {
    throw new ApiError(409, "Use the live time-clock controls before editing an open Time Segment.");
  }

  const locationId = await getShootLocationId(client, auth.tenantId, shift?.shoot_id ?? originalSegment?.linked_shoot_id ?? null);
  const session =
    originalSegment
      ? (
          await client.query<TimeSessionRow>(
            `
              SELECT *
              FROM time_session
              WHERE tenant_id = $1
                AND id = $2
              LIMIT 1
            `,
            [auth.tenantId, originalSegment.session_id]
          )
        ).rows[0] ?? null
      : await getOrCreateTimeSessionForEmployeeDate(client, {
          tenantId: auth.tenantId,
          employeeId: input.employee_id,
          workDate: getWorkDateForTimestamp(input.requested_start_time, shift?.shoot_date ?? null),
          sourceShiftId: shift?.id ?? null,
          status: "closed"
        });

  if (!session) {
    throw new ApiError(404, "Time Session context could not be resolved.");
  }
  assertMutableTimeSession(
    session,
    "Leadership edits are locked because the linked Time Session has already been approved or exported to payroll."
  );

  const originalValues = originalSegment
    ? {
        linked_shift_id: originalSegment.linked_shift_id,
        work_state: originalSegment.work_state,
        start_time: originalSegment.start_time,
        end_time: originalSegment.end_time,
        reporting_flags: originalSegment.reporting_flags
      }
    : {};

  const dangerousAction = await beginDangerousAction(client, auth, {
    actionCode: "edit_historical_record",
    entityType: "time_segment",
    entityId: input.segment_id ?? input.shift_id ?? input.employee_id,
    sourceModule: "attendance",
    reason: input.note,
    beforeValue: {
      employee_id: input.employee_id,
      shift_id: shift?.id ?? originalSegment?.linked_shift_id ?? null,
      segment_id: originalSegment?.id ?? null,
      ...originalValues
    },
    metadata: {
      requested_work_state: input.requested_work_state,
      requested_start_time: input.requested_start_time,
      requested_end_time: input.requested_end_time ?? null
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  try {
    const exception = await createAttendanceException(client, {
      tenantId: auth.tenantId,
      shiftId: shift?.id ?? originalSegment?.linked_shift_id ?? null,
      shootId: shift?.shoot_id ?? originalSegment?.linked_shoot_id ?? null,
      userId: input.employee_id,
      exceptionType: "LEADERSHIP_TIME_EDIT",
      severity: "high",
      reasonCode: "leadership_time_edit",
      notes: input.note,
      requestedValue: {
        requested_work_state: input.requested_work_state,
        requested_start_time: input.requested_start_time,
        requested_end_time: input.requested_end_time ?? null
      },
      originalValue: originalValues,
      workflowKind: "exception",
      overrideFlag: true
    });

    const requestId = await createTimeClockExceptionRequest(client, {
      tenantId: auth.tenantId,
      employeeId: input.employee_id,
      requestType: "time_segment_correction",
      shiftId: shift?.id ?? originalSegment?.linked_shift_id ?? null,
      shootId: shift?.shoot_id ?? originalSegment?.linked_shoot_id ?? null,
      sessionId: session.id,
      segmentId: originalSegment?.id ?? null,
      requestedState: input.requested_work_state,
      requestedStartTime: input.requested_start_time,
      requestedEndTime: input.requested_end_time ?? null,
      relatedAttendanceExceptionId: exception.id,
      locationContext: buildTimeClockLocationContext(shift, null),
      originalValues,
      resolvedValues: {
        requested_work_state: input.requested_work_state,
        requested_start_time: input.requested_start_time,
        requested_end_time: input.requested_end_time ?? null
      },
      requestedApproverId: auth.id,
      reportingFlags: ["manual_adjustment", "admin_override", "edited_by_leadership"],
      note: input.note
    });
    if (!requestId) {
      throw new ApiError(500, "Mission Control could not create the canonical Exception Request for this leadership edit.");
    }

    const adjustmentSegment = await insertTimeSegmentCorrection(client, {
      tenantId: auth.tenantId,
      sessionId: session.id,
      employeeId: input.employee_id,
      shiftId: shift?.id ?? originalSegment?.linked_shift_id ?? null,
      shootId: shift?.shoot_id ?? originalSegment?.linked_shoot_id ?? null,
      locationId,
      workState: input.requested_work_state,
      startTime: input.requested_start_time,
      endTime: input.requested_end_time ?? null,
      sourceType: "admin_override",
      reviewStatus: "approved",
      supersedesSegmentId: originalSegment?.id ?? null,
      reportingFlags: ["manual_adjustment", "admin_override", "edited_by_leadership"],
      actorUserId: auth.id
    });

    const approvalRecord = await insertTimeClockApprovalRecord(client, {
      tenantId: auth.tenantId,
      requestId,
      approverId: auth.id,
      approverRole: getApprovalActorRole(auth),
      decision: "approved",
      comment: input.note
    });

    await updateTimeClockExceptionRequestReview(client, {
      requestId,
      status: "approved",
      reviewedBy: auth.id,
      resolvedValues: {
        approved_segment_id: adjustmentSegment?.id ?? null,
        requested_work_state: input.requested_work_state,
        requested_start_time: input.requested_start_time,
        requested_end_time: input.requested_end_time ?? null
      },
      note: input.note,
      appendFlags: ["manual_adjustment", "admin_override", "edited_by_leadership"]
    });

    await client.query(
      `
        UPDATE attendance_exception
        SET status = 'approved',
            classification = 'manager-approved exception',
            resolved_value = $2::jsonb,
            approved_by_user_id = $3,
            approved_at = now(),
            updated_at = now()
        WHERE id = $1
      `,
      [
        exception.id,
        JSON.stringify({
          approved_segment_id: adjustmentSegment?.id ?? null,
          requested_work_state: input.requested_work_state,
          requested_start_time: input.requested_start_time,
          requested_end_time: input.requested_end_time ?? null
        }),
        auth.id
      ]
    );

    await insertTimeClockCorrectionEvent(client, {
      tenantId: auth.tenantId,
      employeeId: input.employee_id,
      sessionId: session.id,
      segmentId: adjustmentSegment?.id ?? null,
      shootId: shift?.shoot_id ?? originalSegment?.linked_shoot_id ?? null,
      locationId,
      eventType: "admin_override",
      eventTimestamp: new Date().toISOString(),
      actor: "leadership",
      metadata: {
        attendance_exception_id: exception.id,
        exception_request_id: requestId,
        approval_record_id: approvalRecord?.id ?? null,
        supersedes_segment_id: originalSegment?.id ?? null
      }
    });

    await insertTimeClockCorrectionEvent(client, {
      tenantId: auth.tenantId,
      employeeId: input.employee_id,
      sessionId: session.id,
      segmentId: adjustmentSegment?.id ?? null,
      shootId: shift?.shoot_id ?? originalSegment?.linked_shoot_id ?? null,
      locationId,
      eventType: "approval_recorded",
      eventTimestamp: new Date().toISOString(),
      actor: "leadership",
      metadata: {
        attendance_exception_id: exception.id,
        exception_request_id: requestId,
        approval_record_id: approvalRecord?.id ?? null,
        decision: "approved"
      }
    });

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: input.employee_id,
      action: "time_clock.time_segment.admin_override",
      entityType: "time_segment",
      entityId: adjustmentSegment?.id ?? null,
      previousValues: originalValues,
      newValues: {
        linked_shift_id: shift?.id ?? originalSegment?.linked_shift_id ?? null,
        work_state: input.requested_work_state,
        start_time: input.requested_start_time,
        end_time: input.requested_end_time ?? null,
        supersedes_segment_id: originalSegment?.id ?? null,
        reporting_flags: ["manual_adjustment", "admin_override", "edited_by_leadership"]
      },
      reasonComment: input.note,
      metadata: {
        attendance_exception_id: exception.id,
        exception_request_id: requestId,
        approval_record_id: approvalRecord?.id ?? null
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: input.employee_id,
      action: "time_clock.exception_request.approved",
      entityType: "exception_request",
      entityId: requestId ?? null,
      previousValues: {
        status: "submitted"
      },
      newValues: {
        status: "approved",
        approved_segment_id: adjustmentSegment?.id ?? null
      },
      reasonComment: input.note,
      metadata: {
        attendance_exception_id: exception.id,
        approval_record_id: approvalRecord?.id ?? null,
        approval_level: getApprovalLevelLabel(
          resolveAttendanceApprovalLevel({
            protectedHistoryEdit: true,
            exceptionReview: false
          })
        ),
        approval_role_group: resolvePhase1RoleGroup(auth)
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });

    await syncTimeSessionPayrollSummary(client, {
      tenantId: auth.tenantId,
      sessionId: session.id,
      actorUserId: auth.id,
      auth,
      reasonComment: input.note
    });

    await completeDangerousAction(client, auth, {
      executionId: dangerousAction.executionId,
      actionCode: "edit_historical_record",
      entityType: "time_segment",
      entityId: adjustmentSegment?.id ?? input.segment_id ?? input.shift_id ?? input.employee_id,
      reason: input.note,
      afterValue: {
        approved_segment_id: adjustmentSegment?.id ?? null,
        requested_work_state: input.requested_work_state,
        requested_start_time: input.requested_start_time,
        requested_end_time: input.requested_end_time ?? null
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });

    return {
      attendance_exception_id: exception.id,
      exception_request_id: requestId,
      approval_record_id: approvalRecord?.id ?? null,
      time_segment_id: adjustmentSegment?.id ?? null
    };
  } catch (error) {
    await failDangerousAction(client, auth, {
      executionId: dangerousAction.executionId,
      actionCode: "edit_historical_record",
      entityType: "time_segment",
      entityId: input.segment_id ?? input.shift_id ?? input.employee_id,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });
    throw error;
  }
}

export async function overrideTimeEntryBreakDeduction(
  client: PoolClient,
  auth: AuthUser,
  timeEntryId: string,
  input: { break_deduction_minutes: number; reason: string },
  meta: RequestMeta
) {
  if (!canEditHours(auth)) {
    throw new ApiError(403, "Only leadership can override automatic break deductions");
  }

  const { rows } = await client.query("SELECT * FROM time_entry WHERE id = $1 LIMIT 1", [timeEntryId]);
  const entry = rows[0] as TimeEntryRow | undefined;
  if (!entry) {
    throw new ApiError(404, "Time entry not found");
  }
  const shift = entry.shift_id ? await findShiftById(client, entry.shift_id) : null;
  assertMutableTimeSession(
    await resolveRelatedTimeSessionForTimeEntry(client, auth.tenantId, entry),
    "Break deductions are locked because the linked Time Session has already been approved or exported to payroll."
  );

  const grossMinutes = Number(entry.gross_minutes ?? entry.minutes_worked ?? 0);
  const deductionMinutes = Math.max(0, Math.round(Number(input.break_deduction_minutes ?? 0)));
  const payableMinutes = Math.max(grossMinutes - deductionMinutes, 0);
  const dangerousAction = await beginDangerousAction(client, auth, {
    actionCode: "edit_historical_record",
    entityType: "time_entry",
    entityId: timeEntryId,
    sourceModule: "attendance",
    reason: input.reason,
    beforeValue: {
      break_deduction_minutes: entry.break_deduction_minutes,
      approved_payable_minutes: entry.approved_payable_minutes ?? entry.payable_minutes,
      payroll_state: entry.payroll_state
    },
    metadata: {
      new_break_deduction_minutes: deductionMinutes,
      approved_payable_minutes: payableMinutes
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  try {
    const { rows: updatedRows } = await client.query(
      `
        UPDATE time_entry
        SET break_deduction_minutes = $2,
            break_deduction_applied = $2 > 0,
            break_deduction_source = 'manual_override',
            break_deduction_overridden = true,
            break_deduction_override_reason = $3,
            break_deduction_overridden_by_user_id = $4,
            payable_minutes = $5,
            approved_payable_minutes = $5,
            payroll_state = 'ready',
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [timeEntryId, deductionMinutes, input.reason, auth.id, payableMinutes]
    );
    const updated = updatedRows[0] as TimeEntryRow;

    if (entry.shift_id) {
      const exception = await createAttendanceException(client, {
        tenantId: auth.tenantId,
        shiftId: entry.shift_id,
        userId: String((await client.query("SELECT assigned_user_id FROM work_shift WHERE id = $1", [entry.shift_id])).rows[0]?.assigned_user_id ?? auth.id),
        exceptionType: "BREAK_DEDUCTION_OVERRIDE",
        severity: "high",
        reasonCode: "break_override",
        notes: input.reason,
        workflowKind: "exception",
        overrideFlag: true,
        requestedValue: {
          previous_break_deduction_minutes: entry.break_deduction_minutes,
          new_break_deduction_minutes: deductionMinutes
        },
        correctedTime: null
      });
      await client.query(
        `
          UPDATE attendance_exception
          SET status = 'approved',
              approved_by_user_id = $2,
              approved_at = now(),
              classification = 'manager-approved exception',
              updated_at = now()
          WHERE id = $1
        `,
        [exception.id, auth.id]
      );

      const canonicalRequestId = await createCanonicalTimeClockRequestForAttendanceException(client, {
        tenantId: auth.tenantId,
        employeeId: entry.user_id,
        attendanceExceptionId: exception.id,
        exceptionType: "BREAK_DEDUCTION_OVERRIDE",
        shift,
        requestedApproverUserId: auth.id,
        requestedWorkState: getDefaultRequestedWorkState(shift),
        requestedStartTime: entry.clock_in_at,
        requestedEndTime: entry.clock_out_at,
        originalValues: {
          previous_break_deduction_minutes: entry.break_deduction_minutes,
          previous_payable_minutes: entry.approved_payable_minutes ?? entry.payable_minutes
        },
        requestedValues: {
          new_break_deduction_minutes: deductionMinutes,
          approved_payable_minutes: payableMinutes
        },
        note: input.reason,
        reportingFlags: ["manual_adjustment", "break_override"]
      });

      if (canonicalRequestId) {
        const approvalRecord = await insertTimeClockApprovalRecord(client, {
          tenantId: auth.tenantId,
          requestId: canonicalRequestId,
          approverId: auth.id,
          approverRole: getApprovalActorRole(auth),
          decision: "approved",
          comment: input.reason
        });

        const reviewedRequest = await updateTimeClockExceptionRequestReview(client, {
          requestId: canonicalRequestId,
          status: "approved",
          reviewedBy: auth.id,
          resolvedValues: {
            break_deduction_minutes: deductionMinutes,
            approved_payable_minutes: payableMinutes
          },
          note: input.reason,
          appendFlags: ["manual_adjustment", "break_override"]
        });

      await insertTimeClockCorrectionEvent(client, {
        tenantId: auth.tenantId,
        employeeId: entry.user_id,
        sessionId: reviewedRequest?.linked_session_id ?? null,
        segmentId: reviewedRequest?.linked_segment_id ?? null,
        shootId: reviewedRequest?.linked_shoot_id ?? entry.shoot_id ?? null,
        locationId: null,
        eventType: "approval_recorded",
        eventTimestamp: new Date().toISOString(),
        actor: canEditHours(auth) ? "leadership" : "manager",
        metadata: {
          attendance_exception_id: exception.id,
          exception_request_id: canonicalRequestId,
          approval_record_id: approvalRecord?.id ?? null,
          decision: "approved",
          break_deduction_minutes: deductionMinutes,
          approved_payable_minutes: payableMinutes
        }
      });

      await createAuditLog(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        targetUserId: entry.user_id,
        action: "time_clock.exception_request.approved",
        entityType: "exception_request",
        entityId: canonicalRequestId,
        previousValues: {
          status: "submitted",
          resolved_values: {}
        },
        newValues: {
          status: reviewedRequest?.status ?? "approved",
          resolved_values: reviewedRequest?.resolved_values ?? {
            break_deduction_minutes: deductionMinutes,
            approved_payable_minutes: payableMinutes
          }
        },
      reasonComment: input.reason,
      metadata: {
        attendance_exception_id: exception.id,
        approval_record_id: approvalRecord?.id ?? null,
        approval_level: getApprovalLevelLabel(
          resolveAttendanceApprovalLevel({
            protectedHistoryEdit: true,
            exceptionReview: false
          })
        ),
        approval_role_group: resolvePhase1RoleGroup(auth)
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });

        if (reviewedRequest?.linked_session_id) {
          await syncTimeSessionPayrollSummary(client, {
            tenantId: auth.tenantId,
            sessionId: reviewedRequest.linked_session_id,
            actorUserId: auth.id,
            auth,
            emitTransitionEvents: true,
            reasonComment: input.reason
          });
        }
      }
    }

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: null,
      action: "attendance.break_deduction.override",
      entityType: "time_entry",
      entityId: timeEntryId,
      metadata: {
        shift_id: entry.shift_id,
        previous_break_deduction_minutes: entry.break_deduction_minutes,
        new_break_deduction_minutes: deductionMinutes,
        payable_minutes: payableMinutes,
        reason: input.reason,
        approval_level: getApprovalLevelLabel(
          resolveAttendanceApprovalLevel({
            protectedHistoryEdit: true,
            exceptionReview: false
          })
        ),
        approval_role_group: resolvePhase1RoleGroup(auth)
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });

    await completeDangerousAction(client, auth, {
      executionId: dangerousAction.executionId,
      actionCode: "edit_historical_record",
      entityType: "time_entry",
      entityId: timeEntryId,
      reason: input.reason,
      afterValue: {
        break_deduction_minutes: deductionMinutes,
        approved_payable_minutes: payableMinutes,
        payroll_state: updated.payroll_state
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });

    return updated;
  } catch (error) {
    await failDangerousAction(client, auth, {
      executionId: dangerousAction.executionId,
      actionCode: "edit_historical_record",
      entityType: "time_entry",
      entityId: timeEntryId,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });
    throw error;
  }
}

export async function getPayrollSummary(
  client: PoolClient,
  auth: AuthUser,
  filters: { date?: string; dateFrom?: string; dateTo?: string; department?: string; userId?: string } = {}
) {
  const effectiveUserId = shouldRestrictShiftList(auth) ? auth.id : filters.userId ?? null;
  const bounds = filters.date
    ? getLocalDayBounds(filters.date)
    : {
        start: filters.dateFrom ? getLocalDayBounds(filters.dateFrom).start : null,
        endExclusive: filters.dateTo ? getLocalDayBounds(filters.dateTo).endExclusive : null
      };
  const values: unknown[] = [auth.tenantId, bounds.start?.toISOString() ?? null, bounds.endExclusive?.toISOString() ?? null, filters.department ?? null, effectiveUserId];
  const { rows } = await client.query(
    `
      SELECT
        te.*,
        ws.title AS shift_title,
        ws.department,
        ws.location_name,
        au.full_name AS user_name,
        s.shoot_code,
        (
          SELECT ARRAY_REMOVE(array_agg(DISTINCT ae.exception_type), NULL)
          FROM attendance_exception ae
          WHERE ae.shift_id = te.shift_id
        ) AS exception_flags
      FROM time_entry te
      LEFT JOIN work_shift ws ON ws.id = te.shift_id
      LEFT JOIN shoot s ON s.id = te.shoot_id
      JOIN app_user au ON au.id = te.user_id
      WHERE te.tenant_id = $1
        AND ($2::timestamptz IS NULL OR te.clock_in_at >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR te.clock_in_at < $3::timestamptz)
        AND ($4::department_code IS NULL OR ws.department = $4::department_code)
        AND ($5::uuid IS NULL OR te.user_id = $5::uuid)
      ORDER BY te.clock_in_at DESC
    `,
    values
  );

  return {
    summary: {
      gross_hours: Number((rows.reduce((sum, row) => sum + Number(row.gross_minutes ?? 0), 0) / 60).toFixed(2)),
      break_deduction_hours: Number((rows.reduce((sum, row) => sum + Number(row.break_deduction_minutes ?? 0), 0) / 60).toFixed(2)),
      payable_hours: Number((rows.reduce((sum, row) => sum + Number(row.approved_payable_minutes ?? row.payable_minutes ?? 0), 0) / 60).toFixed(2)),
      break_override_count: rows.filter((row) => Boolean(row.break_deduction_overridden)).length,
      exception_entry_count: rows.filter((row) => Array.isArray(row.exception_flags) && row.exception_flags.length).length
    },
    rows
  };
}

export async function reviewAttendanceException(
  client: PoolClient,
  auth: AuthUser,
  exceptionId: string,
  input: { status: "approved" | "rejected" | "resolved"; notes?: string | null; classification?: string | null; resolved_value?: Record<string, unknown> },
  meta: RequestMeta
) {
  const { rows } = await client.query("SELECT * FROM attendance_exception WHERE id = $1 LIMIT 1", [exceptionId]);
  const exception = rows[0] as (AttendanceExceptionRow & {
    user_id: string;
    requested_value?: Record<string, unknown> | null;
  }) | undefined;
  if (!exception) {
    throw new ApiError(404, "Attendance exception not found");
  }

  if (exception.workflow_kind === "missed_punch") {
    const fallbackCorrectedTime =
      input.resolved_value && typeof input.resolved_value.corrected_time === "string"
        ? input.resolved_value.corrected_time
        : exception.corrected_time ??
          (typeof exception.requested_value?.corrected_time === "string"
            ? exception.requested_value.corrected_time
            : exception.missing_direction === "out"
              ? typeof exception.requested_value?.scheduled_end === "string"
                ? exception.requested_value.scheduled_end
                : null
              : typeof exception.requested_value?.scheduled_start === "string"
                ? exception.requested_value.scheduled_start
                : null);
    return reviewMissedPunchRequest(
      client,
      auth,
      exceptionId,
      {
        status: input.status,
        notes: input.notes ?? null,
        corrected_time: fallbackCorrectedTime
      },
      meta
    );
  }

  if (input.status === "approved" && input.resolved_value && typeof input.resolved_value.corrected_time === "string") {
    assertBackdatedPunchCorrectionWindow(input.resolved_value.corrected_time);
  }

  if (exception.shift_id) {
    await assertShiftManagementScope(client, auth, exception.shift_id);
  } else if (!canPerformAction(auth, "attendance.manage")) {
    throw new ApiError(403, "Forbidden");
  }
  if (isNoLunchChallengeException(exception.exception_type)) {
    assertLunchChallengeReviewer(auth);
  }

  const timeClockRequest = await getTimeClockExceptionRequestByAttendanceExceptionId(client, auth.tenantId, exceptionId);
  assertMutableTimeSession(
    await resolveRelatedTimeSessionForAttendanceException(client, auth.tenantId, exception, timeClockRequest),
    "This attendance exception is locked because the linked Time Session has already been approved or exported to payroll."
  );

  const { rows: updatedRows } = await client.query(
    `
      UPDATE attendance_exception
      SET status = $2::attendance_exception_status,
          notes = COALESCE($3, notes),
          classification = COALESCE($4, classification),
          resolved_value = CASE WHEN $5::jsonb IS NULL THEN resolved_value ELSE $5::jsonb END,
          approved_by_user_id = $6,
          approved_at = now(),
          updated_at = now()
      WHERE id = $1
      RETURNING *
    `,
    [exceptionId, input.status, input.notes ?? null, input.classification ?? null, input.resolved_value ? JSON.stringify(input.resolved_value) : null, auth.id]
  );
  const updated = updatedRows[0];

  if (timeClockRequest) {
    const approvalRecord = await insertTimeClockApprovalRecord(client, {
      tenantId: auth.tenantId,
      requestId: timeClockRequest.id,
      approverId: auth.id,
      approverRole: getApprovalActorRole(auth),
      decision: input.status === "approved" ? "approved" : input.status === "rejected" ? "rejected" : "returned",
      comment: input.notes ?? null
    });

    const reviewedRequest = await updateTimeClockExceptionRequestReview(client, {
      requestId: timeClockRequest.id,
      status: input.status === "approved" ? "approved" : input.status === "rejected" ? "rejected" : "cancelled",
      reviewedBy: auth.id,
      resolvedValues: input.resolved_value ?? {},
      note: input.notes ?? null,
      appendFlags: input.status === "approved" ? ["manual_adjustment"] : []
    });

    await insertTimeClockCorrectionEvent(client, {
      tenantId: auth.tenantId,
      employeeId: exception.user_id,
      sessionId: reviewedRequest?.linked_session_id ?? null,
      segmentId: reviewedRequest?.linked_segment_id ?? null,
      shootId: reviewedRequest?.linked_shoot_id ?? updated.shoot_id ?? null,
      locationId: null,
      eventType: "approval_recorded",
      eventTimestamp: new Date().toISOString(),
      actor: getApprovalActorRole(auth) === "senior_photographer" ? "manager" : canEditHours(auth) ? "leadership" : "manager",
      metadata: {
        attendance_exception_id: exception.id,
        exception_request_id: timeClockRequest.id,
        approval_record_id: approvalRecord?.id ?? null,
        decision: input.status
      }
    });

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: exception.user_id,
      action: `time_clock.exception_request.${input.status}`,
      entityType: "exception_request",
      entityId: timeClockRequest.id,
      previousValues: {
        status: timeClockRequest.status,
        resolved_values: timeClockRequest.resolved_values
      },
      newValues: {
        status: reviewedRequest?.status ?? null,
        resolved_values: reviewedRequest?.resolved_values ?? {}
      },
      reasonComment: input.notes ?? null,
      metadata: {
        attendance_exception_id: exception.id,
        approval_record_id: approvalRecord?.id ?? null,
        approval_level: getApprovalLevelLabel(
          resolveAttendanceApprovalLevel({
            protectedHistoryEdit: false,
            exceptionReview: true
          })
        ),
        approval_role_group: resolvePhase1RoleGroup(auth)
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });

    if (
      isNoLunchChallengeException(exception.exception_type) &&
      reviewedRequest?.linked_session_id
    ) {
      await syncTimeSessionPayrollSummary(client, {
        tenantId: auth.tenantId,
        sessionId: reviewedRequest.linked_session_id,
        actorUserId: auth.id,
        auth,
        emitTransitionEvents: true,
        reasonComment:
          input.notes ??
          (input.status === "approved"
            ? "No-lunch challenge approved."
            : input.status === "rejected"
              ? "No-lunch challenge rejected."
              : "No-lunch challenge returned.")
      });
    }
  }

  await updateShiftAttendanceState(client, {
    shiftId: updated.shift_id ?? null,
    state: input.status === "approved" ? "corrected" : input.status === "resolved" ? "resolved" : "pending",
    note:
      input.status === "approved"
        ? "Attendance exception approved."
        : input.status === "resolved"
          ? "Attendance exception resolved."
          : "Attendance exception returned for follow-up.",
    resolvedByUserId: input.status === "approved" || input.status === "resolved" ? auth.id : null,
    resolvedAt: input.status === "approved" || input.status === "resolved" ? new Date().toISOString() : null
  });

  if (input.status === "approved" || input.status === "resolved") {
    await resolveTimeClockPresenceIncidents(client, {
      tenantId: auth.tenantId,
      employeeId: exception.user_id,
      shiftId: updated.shift_id ?? null,
      shootId: updated.shoot_id ?? null,
      resolvedAt: new Date().toISOString(),
      resolutionReason: "attendance_correction_approved",
      actorUserId: auth.id
    });
    await resolveTimeClockComplianceFlags(client, {
      tenantId: auth.tenantId,
      employeeId: exception.user_id,
      shiftId: updated.shift_id ?? null,
      shootId: updated.shoot_id ?? null,
      itemTypes: ["upload_while_off_clock"],
      linkedExceptionRequestId: timeClockRequest?.id ?? null,
      resolutionNote: "Approved attendance correction resolved the Off Clock upload mismatch.",
      actorUserId: auth.id
    });
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: exception.user_id,
    action: `attendance.exception.${input.status}`,
    entityType: "attendance_exception",
    entityId: exceptionId,
    metadata: { classification: input.classification ?? null },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  await queueNotificationDispatch(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    recipientUserIds: [String(exception.user_id)],
    notificationType: `attendance.exception_${input.status}`,
    title: `Attendance request ${input.status}`,
    body: `Your ${exception.exception_type} request is now ${input.status}.`,
    priority: "high",
    deepLink: exception.shift_id ? `/attendance/shifts/${exception.shift_id}` : "/attendance",
    shiftId: exception.shift_id ?? null,
    shootId: exception.shoot_id ?? null,
    attendanceExceptionId: exception.id,
    relatedUserId: exception.user_id,
    channels: ["in_app", "push"],
    metadata: { dedupe: exception.id }
  });

  await emitAttendanceRealtimeChange(client, {
    tenantId: auth.tenantId,
    changeType: "exception_reviewed",
    shiftId: updated.shift_id ?? null,
    shootId: updated.shoot_id ?? null,
    punchId: updated.punch_id ?? null,
    exceptionId: updated.id,
    status: updated.status ?? null,
    classification: updated.classification ?? null,
    versionToken: String(updated.updated_at ?? updated.id)
  });

  return updated;
}

export async function transitionShiftSegment(
  client: PoolClient,
  auth: AuthUser,
  shiftId: string,
  segmentId: string,
  input: { captured_at: string },
  meta: RequestMeta
) {
  await assertShiftAccess(client, auth, shiftId);
  const shift = await getShiftById(client, auth, shiftId);
  if (String(shift.assigned_user_id) !== auth.id && !canPerformAction(auth, "attendance.manage")) {
    throw new ApiError(403, "Forbidden");
  }

  const segments = await client.query("SELECT * FROM shift_segment WHERE shift_id = $1 ORDER BY sort_order ASC", [shiftId]);
  const target = segments.rows.find((row) => String(row.id) === segmentId);
  if (!target) {
    throw new ApiError(404, "Shift segment not found");
  }

  const active = segments.rows.find((row) => row.actual_start_at && !row.actual_end_at);
  if (active && String(active.id) !== segmentId) {
    await client.query("UPDATE shift_segment SET actual_end_at = $2 WHERE id = $1", [active.id, input.captured_at]);
  }

  await client.query(
    `
      UPDATE shift_segment
      SET actual_start_at = COALESCE(actual_start_at, $2),
          actual_end_at = NULL
      WHERE id = $1
    `,
    [segmentId, input.captured_at]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: shift.assigned_user_id,
    action: "attendance.segment.transitioned",
    entityType: "shift_segment",
    entityId: segmentId,
    metadata: { shift_id: shiftId, segment_kind: target.segment_kind },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return getShiftById(client, auth, shiftId);
}
