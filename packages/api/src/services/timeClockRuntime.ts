import type { PoolClient } from "pg";
import {
  TIME_CLOCK_SOFT_WARNING_RADIUS_METERS,
  autoCloseTimeClockSessionForShift as autoCloseTimeClockSessionForShiftShared,
  isWithinTimeClockSoftWarningRadius
} from "@pmc/timeclock-core/timeClock";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type { ClockEventActorType, TimeSessionStatus, TimeWorkState } from "../types/timeClock.js";
import { evaluatePunchLocation, haversineMiles } from "./geo.js";
import { getStudioLocation } from "./maps.js";
import { getLocalDateString, getLocalDayBounds } from "../utils/localDate.js";
import { createAuditLog } from "./audit.js";
import { presenceStateFromTimeClockSummary, upsertTimeClockPresenceObservation } from "./timeClockPresence.js";
import { ATTENDANCE_POLICY, getClockInAllowanceMinutes } from "./attendanceRules.js";
import {
  markEndOfDayConfirmationRequired,
  resolveTimeClockComplianceFlags
} from "./timeClockCompliance.js";

const PHOTOGRAPHY_EARLY_WINDOW_MINUTES = 15;
const AUTO_TRANSITION_COOLDOWN_MINUTES = 2;

type TimeClockShiftContext = {
  id: string;
  tenant_id: string;
  assigned_user_id: string;
  shoot_id: string | null;
  work_date: string | null;
  location_id: string | null;
  shift_kind: string;
  status: string;
  title: string;
  staffing_role: string | null;
  satisfies_lead_coverage: boolean;
  starts_at: string;
  ends_at: string;
  location_name: string | null;
  location_lat: number | null;
  location_lng: number | null;
  geofence_radius_meters: number | null;
  shoot_showtime: string | null;
  shoot_start_time: string | null;
  shoot_end_time_est: string | null;
};

type TimeSessionRow = {
  id: string;
  tenant_id: string;
  employee_id: string;
  work_date: string;
  source_shift_id: string | null;
  status: TimeSessionStatus;
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
  source_type: "manual" | "automatic_transition" | "manual_correction" | "admin_override";
  geofence_supported: boolean;
  review_status: "not_required" | "pending_review" | "approved" | "rejected";
  reporting_flags: string[];
  created_at: string;
  updated_at: string;
};

type ClockEventRow = {
  id: string;
  event_type: string;
  event_timestamp: string;
  metadata: Record<string, unknown> | null;
};

type TimeClockShootContext = {
  shoot_id: string;
  shoot_date: string | null;
  location_id: string | null;
  showtime: string | null;
  start_time: string | null;
  end_time_est: string | null;
  location_lat: number | null;
  location_lng: number | null;
  geofence_radius_meters: number | null;
};

type TimeClockSummaryRow = {
  active_session_id: string | null;
  session_status: TimeSessionStatus | null;
  current_segment_id: string | null;
  current_work_state: TimeWorkState | null;
  current_linked_shoot_id: string | null;
  current_linked_location_id: string | null;
  current_segment_review_status: TimeSegmentRow["review_status"] | null;
  current_segment_started_at: string | null;
  last_clock_event_at: string | null;
};

type TimeClockLatestSessionRow = {
  session_id: string;
  session_status: TimeSessionStatus;
  work_date: string;
  last_changed_at: string;
  ended_at: string | null;
  source_shift_id: string | null;
};

type TimeClockOpenReviewSummaryRow = {
  open_request_count: number;
  latest_request_type: string | null;
  latest_status: string | null;
  latest_submitted_at: string | null;
};

export type TimeClockStateSummary = {
  session_id: string | null;
  session_status: TimeSessionStatus | "off_clock";
  current_state: "off_clock" | TimeWorkState;
  current_segment_id: string | null;
  current_segment_review_status: TimeSegmentRow["review_status"] | null;
  current_linked_shoot_id: string | null;
  current_linked_location_id: string | null;
  current_segment_started_at: string | null;
  needs_end_of_day_confirmation: boolean;
  last_clock_event_at: string | null;
};

export type TimeClockShellShiftPreview = {
  id: string;
  shoot_id: string | null;
  title: string;
  shift_kind: string;
  starts_at: string;
  ends_at: string;
  location_name: string | null;
  actionable_now: boolean;
  starts_in_minutes: number | null;
  late_by_minutes: number | null;
};

export type TimeClockShellControlState = {
  generated_at: string;
  state: "action_needed" | "active" | "ended_today" | "needs_review" | "off_shift";
  emphasis: "red" | "green" | "amber" | "neutral";
  label: string;
  helper_text: string;
  time_clock_state: TimeClockStateSummary;
  active_shift: TimeClockShellShiftPreview | null;
  next_shift: TimeClockShellShiftPreview | null;
  latest_session: {
    session_id: string;
    session_status: TimeSessionStatus;
    work_date: string;
    last_changed_at: string;
    ended_at: string | null;
  } | null;
  review: {
    has_open_review: boolean;
    open_request_count: number;
    label: string | null;
  };
  action: {
    direction: "in" | "out" | null;
    label: string | null;
    enabled: boolean;
    shift_id: string | null;
    shoot_id: string | null;
    work_state: TimeWorkState | null;
  };
};

export type SyncTimeClockForPunchInput = {
  direction: "in" | "out";
  clientTimestamp: string;
  shiftId?: string | null;
  shootId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  workState?: TimeWorkState | null;
  confirmedOutsideContext?: boolean;
  confirmedPermission?: boolean;
  reasonCode?: string | null;
  notes?: string | null;
  relaxedValidation?: boolean;
};

export type SyncTimeClockForPunchResult = {
  timeClockState: TimeClockStateSummary;
  warnings: string[];
  reviewRequired: boolean;
  exceptionRequestId: string | null;
};

export type LocationCheckResult = {
  time_clock_state: TimeClockStateSummary;
  auto_transition: {
    kind: "office_drive_to_photography" | "photography_to_office_drive";
    message: string;
    shift_id: string | null;
    shoot_id: string | null;
  } | null;
  likely_present_missing_clock_in: {
    shift_id: string;
    shoot_id: string | null;
    title: string;
    distance_miles: number;
    label: "Likely Present, Missing Clock-In";
  } | null;
  needs_end_of_day_confirmation:
    | {
        session_id: string;
        title: "Needs End-of-Day Confirmation";
        prompt: string;
      }
    | null;
};

export type EndOfDayConfirmationDecision = "returning_to_studio" | "done_for_day" | "correction_needed";

function toActorType(auth: AuthUser): ClockEventActorType {
  if (auth.authorityTier === "super_admin") {
    return "admin";
  }
  if (auth.authorityTier === "leadership" || auth.authorityTier === "director_admin") {
    return "leadership";
  }
  if (auth.authorityTier === "supervisor" || auth.roles.includes("senior_photographer")) {
    return "manager";
  }
  return "employee";
}

function subtractMinutes(value: string, minutes: number) {
  return new Date(new Date(value).getTime() - minutes * 60000);
}

function addMinutes(value: string, minutes: number) {
  return new Date(new Date(value).getTime() + minutes * 60000);
}

export { TIME_CLOCK_SOFT_WARNING_RADIUS_METERS, isWithinTimeClockSoftWarningRadius };

function resolveShowtime(context: { shoot_showtime?: string | null; shoot_start_time?: string | null; starts_at?: string | null; showtime?: string | null; start_time?: string | null }) {
  return context.starts_at ?? context.shoot_showtime ?? context.showtime ?? context.shoot_start_time ?? context.start_time ?? null;
}

function resolvePhotographyWindow(input: { showtime: string | null; endsAt?: string | null; endTimeEst?: string | null }) {
  const showtime = input.showtime ? new Date(input.showtime) : null;
  if (!showtime) {
    return {
      windowStart: null,
      windowEnd: input.endsAt ? new Date(input.endsAt) : input.endTimeEst ? new Date(input.endTimeEst) : null
    };
  }

  return {
    windowStart: new Date(showtime.getTime() - PHOTOGRAPHY_EARLY_WINDOW_MINUTES * 60000),
    windowEnd: input.endsAt ? new Date(input.endsAt) : input.endTimeEst ? new Date(input.endTimeEst) : new Date(showtime.getTime() + 12 * 60 * 60000)
  };
}

function buildOffClockSummary(): TimeClockStateSummary {
  return {
    session_id: null,
    session_status: "off_clock",
    current_state: "off_clock",
    current_segment_id: null,
    current_segment_review_status: null,
    current_linked_shoot_id: null,
    current_linked_location_id: null,
    current_segment_started_at: null,
    needs_end_of_day_confirmation: false,
    last_clock_event_at: null
  };
}

async function persistPresenceObservation(
  client: PoolClient,
  auth: AuthUser,
  input: {
    summary: TimeClockStateSummary;
    capturedAt: string;
    latitude?: number | null;
    longitude?: number | null;
    accuracyMeters?: number | null;
    sourceType: "location_check" | "clock_punch" | "end_of_day_confirmation" | "system_transition";
    linkedShiftId?: string | null;
    linkedShootId?: string | null;
    linkedLocationId?: string | null;
  }
) {
  await upsertTimeClockPresenceObservation(client, {
    tenantId: auth.tenantId,
    employeeId: auth.id,
    sessionId: input.summary.session_id ?? null,
    sessionStatus: input.summary.session_status,
    segmentId: input.summary.current_segment_id ?? null,
    linkedShiftId: input.linkedShiftId ?? null,
    linkedShootId: input.linkedShootId ?? input.summary.current_linked_shoot_id ?? null,
    linkedLocationId: input.linkedLocationId ?? input.summary.current_linked_location_id ?? null,
    currentState: presenceStateFromTimeClockSummary(input.summary),
    capturedAt: input.capturedAt,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    accuracyMeters: input.accuracyMeters ?? null,
    sourceType: input.sourceType
  });
}

async function persistPresenceObservationForEmployee(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    summary: TimeClockStateSummary;
    capturedAt: string;
    latitude?: number | null;
    longitude?: number | null;
    accuracyMeters?: number | null;
    sourceType: "location_check" | "clock_punch" | "end_of_day_confirmation" | "system_transition";
    linkedShiftId?: string | null;
    linkedShootId?: string | null;
    linkedLocationId?: string | null;
  }
) {
  await upsertTimeClockPresenceObservation(client, {
    tenantId: input.tenantId,
    employeeId: input.employeeId,
    sessionId: input.summary.session_id ?? null,
    sessionStatus: input.summary.session_status,
    segmentId: input.summary.current_segment_id ?? null,
    linkedShiftId: input.linkedShiftId ?? null,
    linkedShootId: input.linkedShootId ?? input.summary.current_linked_shoot_id ?? null,
    linkedLocationId: input.linkedLocationId ?? input.summary.current_linked_location_id ?? null,
    currentState: presenceStateFromTimeClockSummary(input.summary),
    capturedAt: input.capturedAt,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    accuracyMeters: input.accuracyMeters ?? null,
    sourceType: input.sourceType
  });
}

async function loadShiftContextById(client: PoolClient, tenantId: string, shiftId: string) {
  const { rows } = await client.query<TimeClockShiftContext>(
    `
      SELECT
        ws.id,
        ws.tenant_id,
        ws.assigned_user_id,
        ws.shoot_id,
        COALESCE(s.shoot_date::text, ws.starts_at::date::text) AS work_date,
        s.location_id,
        ws.shift_kind::text,
        ws.status::text,
        ws.title,
        ws.staffing_role::text,
        ws.satisfies_lead_coverage,
        ws.starts_at::text,
        ws.ends_at::text,
        ws.location_name,
        ws.location_lat,
        ws.location_lng,
        ws.geofence_radius_meters,
        s.showtime::text AS shoot_showtime,
        s.start_time::text AS shoot_start_time,
        s.end_time_est::text AS shoot_end_time_est
      FROM work_shift ws
      LEFT JOIN shoot s
        ON s.id = ws.shoot_id
       AND s.tenant_id = ws.tenant_id
      WHERE ws.tenant_id = $1
        AND ws.id = $2
      LIMIT 1
    `,
    [tenantId, shiftId]
  );

  return rows[0] ?? null;
}

async function loadShootContextById(client: PoolClient, tenantId: string, shootId: string) {
  const { rows } = await client.query<TimeClockShootContext>(
    `
      SELECT
        s.id AS shoot_id,
        s.shoot_date::text,
        s.location_id,
        s.showtime::text,
        s.start_time::text,
        s.end_time_est::text,
        s.location_lat,
        s.location_lng,
        s.geofence_radius_meters
      FROM shoot s
      WHERE s.tenant_id = $1
        AND s.id = $2
        AND s.deleted_at IS NULL
      LIMIT 1
    `,
    [tenantId, shootId]
  );

  return rows[0] ?? null;
}

async function listEmployeeShiftsForDate(client: PoolClient, tenantId: string, employeeId: string, workDate: string) {
  const { start, endExclusive } = getLocalDayBounds(workDate);
  const { rows } = await client.query<TimeClockShiftContext>(
    `
      SELECT
        ws.id,
        ws.tenant_id,
        ws.assigned_user_id,
        ws.shoot_id,
        COALESCE(s.shoot_date::text, ws.starts_at::date::text) AS work_date,
        s.location_id,
        ws.shift_kind::text,
        ws.status::text,
        ws.title,
        ws.staffing_role::text,
        ws.satisfies_lead_coverage,
        ws.starts_at::text,
        ws.ends_at::text,
        ws.location_name,
        ws.location_lat,
        ws.location_lng,
        ws.geofence_radius_meters,
        s.showtime::text AS shoot_showtime,
        s.start_time::text AS shoot_start_time,
        s.end_time_est::text AS shoot_end_time_est
      FROM work_shift ws
      LEFT JOIN shoot s
        ON s.id = ws.shoot_id
       AND s.tenant_id = ws.tenant_id
      WHERE ws.tenant_id = $1
        AND ws.assigned_user_id = $2
        AND ws.cancelled_at IS NULL
        AND ws.status IN ('published', 'completed')
        AND ws.starts_at < $4::timestamptz
        AND ws.ends_at >= $3::timestamptz
      ORDER BY ws.starts_at ASC
    `,
    [tenantId, employeeId, start.toISOString(), endExclusive.toISOString()]
  );

  return rows;
}

async function listEmployeeShootShiftsForDate(client: PoolClient, tenantId: string, employeeId: string, workDate: string) {
  const rows = await listEmployeeShiftsForDate(client, tenantId, employeeId, workDate);
  return rows.filter((row) => Boolean(row.shoot_id));
}

async function loadLatestTimeSessionForDate(
  client: PoolClient,
  input: { tenantId: string; employeeId: string; workDate: string }
) {
  const { rows } = await client.query<TimeClockLatestSessionRow>(
    `
      SELECT
        ts.id AS session_id,
        ts.status::text AS session_status,
        ts.work_date::text AS work_date,
        ts.updated_at::text AS last_changed_at,
        (
          SELECT MAX(seg.end_time)::text
          FROM time_segment seg
          WHERE seg.session_id = ts.id
        ) AS ended_at,
        ts.source_shift_id
      FROM time_session ts
      WHERE ts.tenant_id = $1
        AND ts.employee_id = $2
        AND ts.work_date = $3::date
      ORDER BY ts.updated_at DESC, ts.created_at DESC
      LIMIT 1
    `,
    [input.tenantId, input.employeeId, input.workDate]
  );

  return rows[0] ?? null;
}

async function loadOpenTimeClockReviewSummary(
  client: PoolClient,
  input: { tenantId: string; employeeId: string }
) {
  const { rows } = await client.query<TimeClockOpenReviewSummaryRow>(
    `
      WITH open_requests AS (
        SELECT
          request_type::text AS request_type,
          status::text AS status,
          submitted_at::text AS submitted_at
        FROM exception_request
        WHERE tenant_id = $1
          AND employee_id = $2
          AND status IN ('submitted', 'under_review')
      ),
      latest_request AS (
        SELECT *
        FROM open_requests
        ORDER BY submitted_at DESC
        LIMIT 1
      )
      SELECT
        COALESCE((SELECT COUNT(*)::int FROM open_requests), 0) AS open_request_count,
        latest_request.request_type AS latest_request_type,
        latest_request.status AS latest_status,
        latest_request.submitted_at AS latest_submitted_at
      FROM latest_request
      RIGHT JOIN (SELECT 1 AS anchor) anchor ON true
    `,
    [input.tenantId, input.employeeId]
  );

  return (
    rows[0] ?? {
      open_request_count: 0,
      latest_request_type: null,
      latest_status: null,
      latest_submitted_at: null
    }
  );
}

async function getActiveTimeSession(client: PoolClient, tenantId: string, employeeId: string) {
  const { rows } = await client.query<TimeSessionRow>(
    `
      SELECT *
      FROM time_session
      WHERE tenant_id = $1
        AND employee_id = $2
        AND status IN ('open', 'needs_end_of_day_confirmation')
      ORDER BY
        CASE WHEN status = 'open' THEN 0 ELSE 1 END,
        work_date DESC,
        created_at DESC
      LIMIT 1
    `,
    [tenantId, employeeId]
  );
  return rows[0] ?? null;
}

async function listActiveTimeSessions(client: PoolClient, tenantId: string, employeeId: string) {
  const { rows } = await client.query<TimeSessionRow>(
    `
      SELECT *
      FROM time_session
      WHERE tenant_id = $1
        AND employee_id = $2
        AND status IN ('open', 'needs_end_of_day_confirmation')
      ORDER BY
        CASE WHEN status = 'open' THEN 0 ELSE 1 END,
        work_date DESC,
        created_at DESC
    `,
    [tenantId, employeeId]
  );
  return rows;
}

async function getOpenTimeSegment(client: PoolClient, sessionId: string) {
  const { rows } = await client.query<TimeSegmentRow>(
    `
      SELECT *
      FROM time_segment
      WHERE session_id = $1
        AND end_time IS NULL
      ORDER BY start_time DESC
      LIMIT 1
    `,
    [sessionId]
  );
  return rows[0] ?? null;
}

async function insertClockEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    sessionId?: string | null;
    segmentId?: string | null;
    shootId?: string | null;
    locationId?: string | null;
    eventType:
      | "clock_in"
      | "clock_out"
      | "session_opened"
      | "session_closed"
      | "work_state_started"
      | "work_state_ended"
      | "manual_correction"
      | "admin_override"
      | "exception_requested"
      | "approval_recorded"
      | "auto_lunch_deduction_applied"
      | "auto_lunch_deduction_removed";
    eventTimestamp: string;
    latitude?: number | null;
    longitude?: number | null;
    metadata?: Record<string, unknown>;
    actorType: ClockEventActorType;
  }
) {
  const { rows } = await client.query<ClockEventRow>(
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
        latitude,
        longitude,
        metadata,
        created_by_actor
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
      RETURNING id, event_type::text, event_timestamp::text, metadata
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
      input.latitude ?? null,
      input.longitude ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.actorType
    ]
  );

  return rows[0] ?? null;
}

async function ensureOpenSession(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    workDate: string;
    sourceShiftId?: string | null;
    openedAt: string;
    actorType: ClockEventActorType;
  }
) {
  const active = await getActiveTimeSession(client, input.tenantId, input.employeeId);
  if (active) {
    if (active.status === "needs_end_of_day_confirmation") {
      throw new ApiError(409, "Confirm the prior end-of-day state before starting a new Time Session.");
    }
    return { session: active, created: false };
  }

  const { rows } = await client.query<TimeSessionRow & { inserted: boolean }>(
    `
      INSERT INTO time_session (tenant_id, employee_id, work_date, source_shift_id, status)
      VALUES ($1,$2,$3,$4,'open')
      ON CONFLICT (tenant_id, employee_id, work_date) WHERE status = 'open'
      DO UPDATE
        SET source_shift_id = COALESCE(time_session.source_shift_id, EXCLUDED.source_shift_id),
            updated_at = now()
      RETURNING *, (xmax = 0) AS inserted
    `,
    [input.tenantId, input.employeeId, input.workDate, input.sourceShiftId ?? null]
  );
  const { inserted, ...sessionRow } = rows[0];
  const session = sessionRow as TimeSessionRow;
  const created = inserted;
  if (created) {
    await insertClockEvent(client, {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      sessionId: session.id,
      eventType: "session_opened",
      eventTimestamp: input.openedAt,
      metadata: {
        source_shift_id: input.sourceShiftId ?? null
      },
      actorType: input.actorType
    });
  }
  return { session, created };
}

function resolveTimeClockWorkDate(input: {
  shift?: TimeClockShiftContext | null;
  shoot?: TimeClockShootContext | null;
  activeSession?: TimeSessionRow | null;
  clientTimestamp: string;
}) {
  return input.activeSession?.work_date ?? input.shift?.work_date ?? input.shoot?.shoot_date ?? getLocalDateString(input.clientTimestamp);
}

async function listEmployeeShootShiftsAroundTimestamp(
  client: PoolClient,
  tenantId: string,
  employeeId: string,
  capturedAt: string
) {
  const captured = new Date(capturedAt);
  const start = new Date(captured.getTime() - 12 * 60 * 60 * 1000);
  const endExclusive = new Date(captured.getTime() + 12 * 60 * 60 * 1000);
  const { rows } = await client.query<TimeClockShiftContext>(
    `
      SELECT
        ws.id,
        ws.tenant_id,
        ws.assigned_user_id,
        ws.shoot_id,
        COALESCE(s.shoot_date::text, ws.starts_at::date::text) AS work_date,
        s.location_id,
        ws.shift_kind::text,
        ws.status::text,
        ws.title,
        ws.staffing_role::text,
        ws.satisfies_lead_coverage,
        ws.starts_at::text,
        ws.ends_at::text,
        ws.location_name,
        ws.location_lat,
        ws.location_lng,
        ws.geofence_radius_meters,
        s.showtime::text AS shoot_showtime,
        s.start_time::text AS shoot_start_time,
        s.end_time_est::text AS shoot_end_time_est
      FROM work_shift ws
      LEFT JOIN shoot s
        ON s.id = ws.shoot_id
       AND s.tenant_id = ws.tenant_id
      WHERE ws.tenant_id = $1
        AND ws.assigned_user_id = $2
        AND ws.cancelled_at IS NULL
        AND ws.status IN ('published', 'completed')
        AND ws.starts_at < $4::timestamptz
        AND ws.ends_at >= $3::timestamptz
        AND ws.shoot_id IS NOT NULL
      ORDER BY ws.starts_at ASC
    `,
    [tenantId, employeeId, start.toISOString(), endExclusive.toISOString()]
  );
  return rows;
}

async function startTimeSegment(
  client: PoolClient,
  input: {
    tenantId: string;
    sessionId: string;
    employeeId: string;
    workState: TimeWorkState;
    shootId?: string | null;
    locationId?: string | null;
    startTime: string;
    sourceType: TimeSegmentRow["source_type"];
    geofenceSupported: boolean;
    reviewStatus: TimeSegmentRow["review_status"];
  }
) {
  const { rows } = await client.query<TimeSegmentRow>(
    `
      INSERT INTO time_segment (
        tenant_id,
        session_id,
        employee_id,
        work_state,
        linked_shoot_id,
        linked_location_id,
        start_time,
        source_type,
        geofence_supported,
        review_status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `,
    [
      input.tenantId,
      input.sessionId,
      input.employeeId,
      input.workState,
      input.shootId ?? null,
      input.locationId ?? null,
      input.startTime,
      input.sourceType,
      input.geofenceSupported,
      input.reviewStatus
    ]
  );
  return rows[0] ?? null;
}

async function endTimeSegment(client: PoolClient, segmentId: string, endTime: string) {
  const { rows } = await client.query<TimeSegmentRow>(
    `
      WITH target AS (
        SELECT id, start_time
        FROM time_segment
        WHERE id = $1
          AND end_time IS NULL
        FOR UPDATE
      )
      UPDATE time_segment seg
      SET end_time = CASE
            WHEN $2::timestamptz <= target.start_time THEN target.start_time + interval '1 second'
            ELSE $2::timestamptz
          END,
          updated_at = now()
      FROM target
      WHERE seg.id = target.id
      RETURNING seg.*
    `,
    [segmentId, endTime]
  );
  return rows[0] ?? null;
}

async function setTimeSessionStatus(client: PoolClient, sessionId: string, status: TimeSessionStatus) {
  const { rows } = await client.query<TimeSessionRow>(
    `
      UPDATE time_session
      SET status = $2,
          updated_at = now()
      WHERE id = $1
      RETURNING *
    `,
    [sessionId, status]
  );
  return rows[0] ?? null;
}

export async function createTimeClockExceptionRequest(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    requestType: "missing_clock_in" | "missing_clock_out" | "time_segment_correction" | "work_state_change" | "lunch_deduction_challenge" | "mileage_review" | "other";
    shiftId?: string | null;
    shootId?: string | null;
    sessionId?: string | null;
    segmentId?: string | null;
    requestedApproverId?: string | null;
    relatedAttendanceExceptionId?: string | null;
    requestedState?: TimeWorkState | null;
    requestedStartTime?: string | null;
    requestedEndTime?: string | null;
    locationContext?: Record<string, unknown>;
    originalValues?: Record<string, unknown>;
    resolvedValues?: Record<string, unknown>;
    reportingFlags?: string[];
    note: string;
  }
) {
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO exception_request (
        tenant_id,
        employee_id,
        request_type,
        linked_shift_id,
        linked_shoot_id,
        linked_session_id,
        linked_segment_id,
        requested_approver_id,
        related_attendance_exception_id,
        requested_state,
        requested_start_time,
        requested_end_time,
        location_context,
        original_values,
        resolved_values,
        reporting_flags,
        note,
        status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17,'submitted')
      RETURNING id
    `,
    [
      input.tenantId,
      input.employeeId,
      input.requestType,
      input.shiftId ?? null,
      input.shootId ?? null,
      input.sessionId ?? null,
      input.segmentId ?? null,
      input.requestedApproverId ?? null,
      input.relatedAttendanceExceptionId ?? null,
      input.requestedState ?? null,
      input.requestedStartTime ?? null,
      input.requestedEndTime ?? null,
      JSON.stringify(input.locationContext ?? {}),
      JSON.stringify(input.originalValues ?? {}),
      JSON.stringify(input.resolvedValues ?? {}),
      input.reportingFlags ?? [],
      input.note
    ]
  );
  return rows[0]?.id ?? null;
}

async function hasRecentAutomaticTransition(
  client: PoolClient,
  input: { tenantId: string; employeeId: string; transitionKind: string; capturedAt: string }
) {
  const threshold = subtractMinutes(input.capturedAt, AUTO_TRANSITION_COOLDOWN_MINUTES).toISOString();
  const { rows } = await client.query(
    `
      SELECT 1
      FROM clock_event
      WHERE tenant_id = $1
        AND employee_id = $2
        AND event_timestamp >= $3::timestamptz
        AND metadata->>'transition_kind' = $4
      LIMIT 1
    `,
    [input.tenantId, input.employeeId, threshold, input.transitionKind]
  );
  return Boolean(rows[0]);
}

export async function getTimeClockStateSummary(client: PoolClient, input: { tenantId: string; employeeId: string }) {
  const { rows } = await client.query<TimeClockSummaryRow>(
    `
      WITH active_session AS (
        SELECT ts.*
        FROM time_session ts
        WHERE ts.tenant_id = $1
          AND ts.employee_id = $2
          AND ts.status IN ('open', 'needs_end_of_day_confirmation')
        ORDER BY
          CASE WHEN ts.status = 'open' THEN 0 ELSE 1 END,
          ts.work_date DESC,
          ts.created_at DESC
        LIMIT 1
      ),
      active_segment AS (
        SELECT seg.*
        FROM time_segment seg
        JOIN active_session session ON session.id = seg.session_id
        WHERE seg.end_time IS NULL
        ORDER BY seg.start_time DESC
        LIMIT 1
      ),
      latest_clock_event AS (
        SELECT event_timestamp
        FROM clock_event ce
        JOIN active_session session ON session.id = ce.linked_session_id
        ORDER BY ce.event_timestamp DESC
        LIMIT 1
      )
      SELECT
        session.id AS active_session_id,
        session.status::text AS session_status,
        segment.id AS current_segment_id,
        segment.work_state::text AS current_work_state,
        segment.linked_shoot_id AS current_linked_shoot_id,
        segment.linked_location_id AS current_linked_location_id,
        segment.review_status::text AS current_segment_review_status,
        segment.start_time::text AS current_segment_started_at,
        latest_clock_event.event_timestamp::text AS last_clock_event_at
      FROM active_session session
      LEFT JOIN active_segment segment ON true
      LEFT JOIN latest_clock_event ON true
    `,
    [input.tenantId, input.employeeId]
  );

  const row = rows[0];
  if (!row?.active_session_id) {
    return buildOffClockSummary();
  }

  return {
    session_id: row.active_session_id,
    session_status: row.session_status ?? "off_clock",
    current_state: row.current_work_state ?? "off_clock",
    current_segment_id: row.current_segment_id ?? null,
    current_segment_review_status: row.current_segment_review_status ?? null,
    current_linked_shoot_id: row.current_linked_shoot_id ?? null,
    current_linked_location_id: row.current_linked_location_id ?? null,
    current_segment_started_at: row.current_segment_started_at ?? null,
    needs_end_of_day_confirmation: row.session_status === "needs_end_of_day_confirmation",
    last_clock_event_at: row.last_clock_event_at ?? null
  } satisfies TimeClockStateSummary;
}

function differenceInMinutes(target: string, reference: Date) {
  return Math.round((new Date(target).getTime() - reference.getTime()) / 60000);
}

function buildShellShiftPreview(
  shift: TimeClockShiftContext,
  reference: Date,
  actionableNow: boolean
): TimeClockShellShiftPreview {
  const startsInMinutes = differenceInMinutes(shift.starts_at, reference);
  return {
    id: shift.id,
    shoot_id: shift.shoot_id,
    title: shift.title,
    shift_kind: shift.shift_kind,
    starts_at: shift.starts_at,
    ends_at: shift.ends_at,
    location_name: shift.location_name ?? null,
    actionable_now: actionableNow,
    starts_in_minutes: startsInMinutes,
    late_by_minutes: startsInMinutes < 0 ? Math.abs(startsInMinutes) : null
  };
}

function formatShiftUrgencyLabel(shift: TimeClockShiftContext, reference: Date) {
  const startsInMinutes = differenceInMinutes(shift.starts_at, reference);
  if (startsInMinutes > 0) {
    return `Shift starts in ${startsInMinutes}m${shift.location_name ? ` at ${shift.location_name}` : ""}.`;
  }
  if (startsInMinutes === 0) {
    return `Shift is starting now${shift.location_name ? ` at ${shift.location_name}` : ""}.`;
  }
  return `Shift started ${Math.abs(startsInMinutes)}m ago${shift.location_name ? ` at ${shift.location_name}` : ""}.`;
}

function buildReviewLabel(input: {
  summary: TimeClockStateSummary;
  openReviewSummary: TimeClockOpenReviewSummaryRow;
  reviewShift: TimeClockShiftContext | null;
}) {
  if (input.summary.needs_end_of_day_confirmation) {
    return "End-of-day confirmation is still required before today's time is settled.";
  }
  if (input.summary.current_segment_review_status === "pending_review") {
    return "This punch needs review before the time record is fully clean.";
  }
  if (input.openReviewSummary.open_request_count > 0) {
    const requestLabel =
      input.openReviewSummary.latest_request_type === "missing_clock_in"
        ? "Missing clock-in request"
        : input.openReviewSummary.latest_request_type === "missing_clock_out"
          ? "Missing clock-out request"
          : "Time clock review request";
    if (input.reviewShift?.title) {
      return `${requestLabel} is still open for ${input.reviewShift.title}.`;
    }
    return `${requestLabel} is still open.`;
  }
  return null;
}

function resolveActionNeededShift(shift: TimeClockShiftContext[], reference: Date) {
  for (const item of shift) {
    const allowanceMinutes = getClockInAllowanceMinutes({
      staffingRole: item.staffing_role,
      satisfiesLeadCoverage: item.satisfies_lead_coverage
    });
    const startsAt = new Date(item.starts_at).getTime();
    const endsAt = new Date(item.ends_at).getTime();
    const now = reference.getTime();
    const actionWindowStart = startsAt - allowanceMinutes * 60000;
    const missedPunchCutoff = startsAt + ATTENDANCE_POLICY.missedClockInMinutes * 60000;
    if (now < actionWindowStart || now > endsAt) {
      continue;
    }
    return {
      shift: item,
      needsReview: now >= missedPunchCutoff,
      actionableNow: now < missedPunchCutoff
    };
  }
  return null;
}

function resolveNextShift(shifts: TimeClockShiftContext[], reference: Date) {
  return (
    shifts.find((item) => {
      return new Date(item.starts_at).getTime() > reference.getTime();
    }) ?? null
  );
}

export async function getTimeClockShellControlState(client: PoolClient, auth: AuthUser) {
  const now = new Date();
  const workDate = getLocalDateString(now);
  const summary = await getTimeClockStateSummary(client, { tenantId: auth.tenantId, employeeId: auth.id });
  const todayShifts = await listEmployeeShiftsForDate(client, auth.tenantId, auth.id, workDate);
  const activeSession = summary.session_id ? await getActiveTimeSession(client, auth.tenantId, auth.id) : null;
  const activeShift =
    activeSession?.source_shift_id
      ? await loadShiftContextById(client, auth.tenantId, activeSession.source_shift_id)
      : todayShifts.find((item) => item.shoot_id && item.shoot_id === summary.current_linked_shoot_id) ?? null;
  const latestSession = await loadLatestTimeSessionForDate(client, {
    tenantId: auth.tenantId,
    employeeId: auth.id,
    workDate
  });
  const openReviewSummary = await loadOpenTimeClockReviewSummary(client, {
    tenantId: auth.tenantId,
    employeeId: auth.id
  });
  const actionNeeded = resolveActionNeededShift(todayShifts, now);
  const nextShift = resolveNextShift(todayShifts, now);
  const reviewLabel = buildReviewLabel({
    summary,
    openReviewSummary,
    reviewShift: actionNeeded?.shift ?? activeShift ?? null
  });
  const latestSessionSummary =
    latestSession?.session_id
      ? {
          session_id: latestSession.session_id,
          session_status: latestSession.session_status,
          work_date: latestSession.work_date,
          last_changed_at: latestSession.last_changed_at,
          ended_at: latestSession.ended_at ?? null
        }
      : null;

  if (summary.current_state !== "off_clock") {
    return {
      generated_at: now.toISOString(),
      state: "active",
      emphasis: "green",
      label: "Punched In",
      helper_text:
        activeShift != null
          ? `${activeShift.title}${activeShift.location_name ? ` | ${activeShift.location_name}` : ""}`
          : "You are actively punched in right now.",
      time_clock_state: summary,
      active_shift: activeShift ? buildShellShiftPreview(activeShift, now, true) : null,
      next_shift: nextShift ? buildShellShiftPreview(nextShift, now, false) : null,
      latest_session: latestSessionSummary,
      review: {
        has_open_review: Boolean(reviewLabel),
        open_request_count: Number(openReviewSummary.open_request_count ?? 0),
        label: reviewLabel
      },
      action: {
        direction: "out",
        label: "Punch Out",
        enabled: true,
        shift_id: activeShift?.id ?? activeSession?.source_shift_id ?? null,
        shoot_id: activeShift?.shoot_id ?? summary.current_linked_shoot_id ?? null,
        work_state: null
      }
    } satisfies TimeClockShellControlState;
  }

  if (actionNeeded?.needsReview) {
    return {
      generated_at: now.toISOString(),
      state: "needs_review",
      emphasis: "amber",
      label: "Needs Review",
      helper_text: `Missed-punch review is needed for ${actionNeeded.shift.title}.`,
      time_clock_state: summary,
      active_shift: actionNeeded.shift ? buildShellShiftPreview(actionNeeded.shift, now, false) : null,
      next_shift: nextShift ? buildShellShiftPreview(nextShift, now, false) : null,
      latest_session: latestSessionSummary,
      review: {
        has_open_review: true,
        open_request_count: Math.max(1, Number(openReviewSummary.open_request_count ?? 0)),
        label: reviewLabel ?? `Missed-punch review is needed for ${actionNeeded.shift.title}.`
      },
      action: {
        direction: null,
        label: null,
        enabled: false,
        shift_id: null,
        shoot_id: null,
        work_state: null
      }
    } satisfies TimeClockShellControlState;
  }

  if (actionNeeded?.actionableNow) {
    return {
      generated_at: now.toISOString(),
      state: "action_needed",
      emphasis: "red",
      label: "Punch In Needed",
      helper_text: formatShiftUrgencyLabel(actionNeeded.shift, now),
      time_clock_state: summary,
      active_shift: buildShellShiftPreview(actionNeeded.shift, now, true),
      next_shift: nextShift && nextShift.id !== actionNeeded.shift.id ? buildShellShiftPreview(nextShift, now, false) : null,
      latest_session: latestSessionSummary,
      review: {
        has_open_review: Boolean(reviewLabel),
        open_request_count: Number(openReviewSummary.open_request_count ?? 0),
        label: reviewLabel
      },
      action: {
        direction: "in",
        label: "Punch In",
        enabled: true,
        shift_id: actionNeeded.shift.id,
        shoot_id: actionNeeded.shift.shoot_id ?? null,
        work_state:
          actionNeeded.shift.shift_kind === "studio" ||
          actionNeeded.shift.shift_kind === "office" ||
          actionNeeded.shift.shift_kind === "training"
            ? "office_drive"
            : "photography"
      }
    } satisfies TimeClockShellControlState;
  }

  if (reviewLabel) {
    return {
      generated_at: now.toISOString(),
      state: "needs_review",
      emphasis: "amber",
      label: "Needs Review",
      helper_text: reviewLabel,
      time_clock_state: summary,
      active_shift: null,
      next_shift: nextShift ? buildShellShiftPreview(nextShift, now, false) : null,
      latest_session: latestSessionSummary,
      review: {
        has_open_review: true,
        open_request_count: Number(openReviewSummary.open_request_count ?? 0),
        label: reviewLabel
      },
      action: {
        direction: null,
        label: null,
        enabled: false,
        shift_id: null,
        shoot_id: null,
        work_state: null
      }
    } satisfies TimeClockShellControlState;
  }

  if (latestSessionSummary) {
    return {
      generated_at: now.toISOString(),
      state: "ended_today",
      emphasis: "neutral",
      label: "Ended Today",
      helper_text: "Your latest time session for today has ended.",
      time_clock_state: summary,
      active_shift: null,
      next_shift: nextShift ? buildShellShiftPreview(nextShift, now, false) : null,
      latest_session: latestSessionSummary,
      review: {
        has_open_review: false,
        open_request_count: 0,
        label: null
      },
      action: {
        direction: null,
        label: null,
        enabled: false,
        shift_id: null,
        shoot_id: null,
        work_state: null
      }
    } satisfies TimeClockShellControlState;
  }

  return {
    generated_at: now.toISOString(),
    state: "off_shift",
    emphasis: "neutral",
    label: "Off Shift",
    helper_text: nextShift ? formatShiftUrgencyLabel(nextShift, now) : "No active punch is needed right now.",
    time_clock_state: summary,
    active_shift: null,
    next_shift: nextShift ? buildShellShiftPreview(nextShift, now, false) : null,
    latest_session: latestSessionSummary,
    review: {
      has_open_review: false,
      open_request_count: 0,
      label: null
    },
    action: {
      direction: null,
      label: null,
      enabled: false,
      shift_id: null,
      shoot_id: null,
      work_state: null
    }
  } satisfies TimeClockShellControlState;
}

function resolveRequestedWorkState(input: {
  requestedWorkState?: TimeWorkState | null;
  shift?: TimeClockShiftContext | null;
  shootId?: string | null;
}) {
  if (input.requestedWorkState) {
    return input.requestedWorkState;
  }
  if (input.shift?.shift_kind === "studio" || input.shift?.shift_kind === "office" || input.shift?.shift_kind === "training") {
    return "office_drive" satisfies TimeWorkState;
  }
  if (input.shift?.shoot_id || input.shootId) {
    return "photography" satisfies TimeWorkState;
  }
  return "office_drive" satisfies TimeWorkState;
}

function buildPhotographyContext(shift: TimeClockShiftContext | null, shoot: TimeClockShootContext | null) {
  return {
    shootId: shift?.shoot_id ?? shoot?.shoot_id ?? null,
    locationId: shift?.location_id ?? shoot?.location_id ?? null,
    showtime: resolveShowtime(shift ?? shoot ?? {}),
    endsAt: shift?.ends_at ?? null,
    endTimeEst: shift?.shoot_end_time_est ?? shoot?.end_time_est ?? null,
    locationLat: shift?.location_lat ?? shoot?.location_lat ?? null,
    locationLng: shift?.location_lng ?? shoot?.location_lng ?? null,
    geofenceRadiusMeters: shift?.geofence_radius_meters ?? shoot?.geofence_radius_meters ?? null
  };
}

function isRecoverySameContext(input: {
  session: TimeSessionRow;
  openSegment: TimeSegmentRow | null;
  requestedShiftId?: string | null;
  linkedShootId?: string | null;
  workDate: string;
}) {
  const sameShift = Boolean(input.requestedShiftId) && input.session.source_shift_id === input.requestedShiftId;
  const sameShoot = Boolean(input.linkedShootId) && input.openSegment?.linked_shoot_id === input.linkedShootId;
  return (sameShift || sameShoot) && input.session.work_date === input.workDate;
}

async function recoverActiveTimeSessionsForClockIn(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    workDate: string;
    requestedShiftId?: string | null;
    linkedShootId?: string | null;
    eventTimestamp: string;
    latitude?: number | null;
    longitude?: number | null;
  }
) {
  const activeSessions = await listActiveTimeSessions(client, input.tenantId, input.employeeId);

  for (const session of activeSessions) {
    const openSegment = await getOpenTimeSegment(client, session.id);
    if (
      session.status === "open" &&
      openSegment &&
      isRecoverySameContext({
        session,
        openSegment,
        requestedShiftId: input.requestedShiftId ?? null,
        linkedShootId: input.linkedShootId ?? null,
        workDate: input.workDate
      })
    ) {
      return {
        duplicateSessionId: session.id,
        duplicateSegment: openSegment
      };
    }

    if (openSegment) {
      await endTimeSegment(client, openSegment.id, input.eventTimestamp);
      await insertClockEvent(client, {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        sessionId: session.id,
        segmentId: openSegment.id,
        shootId: openSegment.linked_shoot_id,
        locationId: openSegment.linked_location_id,
        eventType: "work_state_ended",
        eventTimestamp: input.eventTimestamp,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        metadata: {
          recovery_reason: session.status === "needs_end_of_day_confirmation"
            ? "stale_end_of_day_confirmation_replaced_by_new_clock_in"
            : "stale_open_segment_replaced_by_new_clock_in",
          ended_work_state: openSegment.work_state
        },
        actorType: "system"
      });
    }

    await setTimeSessionStatus(client, session.id, "closed");
    await insertClockEvent(client, {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      sessionId: session.id,
      eventType: "session_closed",
      eventTimestamp: input.eventTimestamp,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      metadata: {
        recovery_reason: session.status === "needs_end_of_day_confirmation"
          ? "stale_end_of_day_confirmation_replaced_by_new_clock_in"
          : "stale_open_session_replaced_by_new_clock_in"
      },
      actorType: "system"
    });
  }

  return {
    duplicateSessionId: null,
    duplicateSegment: null
  };
}

export async function syncTimeClockForPunch(client: PoolClient, auth: AuthUser, input: SyncTimeClockForPunchInput): Promise<SyncTimeClockForPunchResult> {
  const actorType = toActorType(auth);
  const shift = input.shiftId ? await loadShiftContextById(client, auth.tenantId, input.shiftId) : null;
  const shoot = !shift && input.shootId ? await loadShootContextById(client, auth.tenantId, input.shootId) : null;
  const linkedShootId = input.shootId ?? shift?.shoot_id ?? shoot?.shoot_id ?? null;

  if (input.direction === "out") {
    const activeSession = await getActiveTimeSession(client, auth.tenantId, auth.id);
    if (!activeSession) {
      throw new ApiError(409, "You cannot clock out without an active Time Session.");
    }

    const openSegment = await getOpenTimeSegment(client, activeSession.id);
    if (openSegment) {
      const endedSegment = await endTimeSegment(client, openSegment.id, input.clientTimestamp);
      if (endedSegment) {
        await insertClockEvent(client, {
          tenantId: auth.tenantId,
          employeeId: auth.id,
          sessionId: activeSession.id,
          segmentId: endedSegment.id,
          shootId: endedSegment.linked_shoot_id,
          locationId: endedSegment.linked_location_id,
          eventType: "work_state_ended",
          eventTimestamp: input.clientTimestamp,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          metadata: {
            source: "manual_clock_out",
            ended_work_state: endedSegment.work_state
          },
          actorType
        });
      }
    }

    await insertClockEvent(client, {
      tenantId: auth.tenantId,
      employeeId: auth.id,
      sessionId: activeSession.id,
      segmentId: null,
      shootId: openSegment?.linked_shoot_id ?? linkedShootId,
      locationId: openSegment?.linked_location_id ?? shift?.location_id ?? null,
      eventType: "clock_out",
      eventTimestamp: input.clientTimestamp,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      metadata: {
        source: "manual_clock_out"
      },
      actorType
    });
    await setTimeSessionStatus(client, activeSession.id, "closed");
    await insertClockEvent(client, {
      tenantId: auth.tenantId,
      employeeId: auth.id,
      sessionId: activeSession.id,
      eventType: "session_closed",
      eventTimestamp: input.clientTimestamp,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      metadata: {
        closed_from: openSegment?.work_state ?? null
      },
      actorType
    });

    const timeClockState = await getTimeClockStateSummary(client, { tenantId: auth.tenantId, employeeId: auth.id });
    await persistPresenceObservation(client, auth, {
      summary: timeClockState,
      capturedAt: input.clientTimestamp,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      accuracyMeters: input.accuracyMeters ?? null,
      sourceType: "clock_punch",
      linkedShiftId: shift?.id ?? input.shiftId ?? null,
      linkedShootId,
      linkedLocationId: openSegment?.linked_location_id ?? shift?.location_id ?? null
    });
    return {
      timeClockState,
      warnings: [],
      reviewRequired: false,
      exceptionRequestId: null
    };
  }

  const workDate = resolveTimeClockWorkDate({
    shift,
    shoot,
    clientTimestamp: input.clientTimestamp
  });

  const requestedWorkState = resolveRequestedWorkState({
    requestedWorkState: input.workState ?? null,
    shift,
    shootId: input.shootId ?? null
  });

  const recovered = await recoverActiveTimeSessionsForClockIn(client, {
    tenantId: auth.tenantId,
    employeeId: auth.id,
    workDate,
    requestedShiftId: input.shiftId ?? null,
    linkedShootId,
    eventTimestamp: input.clientTimestamp,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null
  });
  if (recovered.duplicateSessionId && recovered.duplicateSegment) {
    const timeClockState = await getTimeClockStateSummary(client, { tenantId: auth.tenantId, employeeId: auth.id });
    await persistPresenceObservation(client, auth, {
      summary: timeClockState,
      capturedAt: input.clientTimestamp,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      accuracyMeters: input.accuracyMeters ?? null,
      sourceType: "clock_punch",
      linkedShiftId: input.shiftId ?? null,
      linkedShootId,
      linkedLocationId: recovered.duplicateSegment.linked_location_id ?? null
    });
    return {
      timeClockState,
      warnings: [],
      reviewRequired: recovered.duplicateSegment.review_status === "pending_review",
      exceptionRequestId: null
    };
  }

  const warnings: string[] = [];
  let reviewRequired = false;
  let exceptionRequestId: string | null = null;
  let linkedLocationId = shift?.location_id ?? null;
  let reviewNote = "";

  if (requestedWorkState === "office_drive") {
    const studio = getStudioLocation();
    const studioEvaluation = evaluatePunchLocation({
      targetLat: studio.latitude,
      targetLng: studio.longitude,
      radiusMeters: studio.geofenceRadiusMeters,
      eventLat: input.latitude ?? null,
      eventLng: input.longitude ?? null,
      accuracyMeters: input.accuracyMeters ?? null
    });

    const shiftLocationEvaluation =
      shift && typeof shift.location_lat === "number" && typeof shift.location_lng === "number"
        ? evaluatePunchLocation({
            targetLat: shift.location_lat,
            targetLng: shift.location_lng,
            radiusMeters: Number(shift.geofence_radius_meters ?? 0),
            eventLat: input.latitude ?? null,
            eventLng: input.longitude ?? null,
            accuracyMeters: input.accuracyMeters ?? null
          })
        : null;

    const insideExpectedContext = studioEvaluation.isInside || Boolean(shiftLocationEvaluation?.isInside);
    if (!insideExpectedContext) {
      if (!input.confirmedOutsideContext) {
        throw new ApiError(400, "Starting Office/Drive outside the studio or linked Shoot context requires confirmation.", {
          code: "office_drive_confirmation_required",
          confirmation_kind: "outside_context",
          suggested_reason_code: "gps_issue"
        });
      }
      reviewRequired = true;
      reviewNote = input.notes?.trim() || "Employee confirmed an Office/Drive start outside the normal studio or Shoot context.";
      warnings.push("Office/Drive started outside the studio or Shoot context. The Time Segment was flagged for review.");
    }
  } else {
    const shootContext = linkedShootId ? await loadShootContextById(client, auth.tenantId, linkedShootId) : null;
    const photographyContext = buildPhotographyContext(shift, shootContext);
    if (!photographyContext.shootId) {
      throw new ApiError(400, "Photography time requires a linked Shoot.");
    }

    linkedLocationId = photographyContext.locationId ?? linkedLocationId;
    const showtime = photographyContext.showtime;
    const { windowStart, windowEnd } = resolvePhotographyWindow({
      showtime,
      endsAt: photographyContext.endsAt,
      endTimeEst: photographyContext.endTimeEst
    });

    const locationEvaluation =
      typeof photographyContext.locationLat === "number" && typeof photographyContext.locationLng === "number"
        ? evaluatePunchLocation({
            targetLat: photographyContext.locationLat,
            targetLng: photographyContext.locationLng,
            radiusMeters: Number(photographyContext.geofenceRadiusMeters ?? 0),
            eventLat: input.latitude ?? null,
            eventLng: input.longitude ?? null,
            accuracyMeters: input.accuracyMeters ?? null
          })
        : {
            geofenceStatus: "unknown" as const,
            gpsConfidence: "outside" as const,
            distanceMeters: null,
            isInside: false,
            isLowConfidenceInside: false
          };

    const capturedAt = new Date(input.clientTimestamp);
    const insideTimingWindow = windowStart ? capturedAt >= windowStart : true;
    const beforeAllowedWindow = windowStart ? capturedAt < windowStart : false;
    const stillActive = windowEnd ? capturedAt <= windowEnd : true;
    const locationInsideEnough = locationEvaluation.isInside || locationEvaluation.isLowConfidenceInside;
    const locationMissing = locationEvaluation.geofenceStatus === "unknown";
    const clearOutsideGeofence =
      locationEvaluation.geofenceStatus === "outside" && locationEvaluation.gpsConfidence === "outside";
    const exceptionPathConfirmed = Boolean(input.confirmedPermission || input.reasonCode || input.relaxedValidation);
    const normalPhotographyClockIn = locationInsideEnough && insideTimingWindow && stillActive;

    if (!normalPhotographyClockIn) {
      if ((clearOutsideGeofence || beforeAllowedWindow || !stillActive) && !exceptionPathConfirmed) {
        throw new ApiError(
          400,
          "Photography clock-in outside the Shoot geofence or before the allowed pre-show window requires confirmation that you have permission.",
          {
            code: "photography_confirmation_required",
            confirmation_kind: "permission",
            suggested_reason_code: clearOutsideGeofence ? "outside_geofence" : "gps_issue"
          }
        );
      }
      reviewRequired = true;
      reviewNote =
        input.notes?.trim() ||
        "Employee confirmed permission to start Photography outside the normal geofence or pre-show window.";
      if (clearOutsideGeofence) {
        warnings.push("Photography started outside the Shoot geofence. The Time Segment was flagged for review.");
      }
      if (beforeAllowedWindow) {
        warnings.push("Photography started before the 15-minute pre-show window. The Time Segment was flagged for review.");
      }
      if (!stillActive) {
        warnings.push("Photography started after the expected active Shoot window and was flagged for review.");
      }
      if (locationEvaluation.isLowConfidenceInside) {
        warnings.push("Photography started with low-confidence GPS. The Time Segment was flagged for review.");
      }
      if (locationMissing) {
        warnings.push("Photography started without location capture. The Time Segment was flagged for review.");
      }
    }

    if ((clearOutsideGeofence || beforeAllowedWindow || !stillActive) && !input.reasonCode && !input.relaxedValidation) {
      throw new ApiError(400, "A reason is required when Photography starts outside the normal geofence or timing window.");
    }
  }

  const ensured = await ensureOpenSession(client, {
    tenantId: auth.tenantId,
    employeeId: auth.id,
    workDate,
    sourceShiftId: input.shiftId ?? null,
    openedAt: input.clientTimestamp,
    actorType
  });

  await insertClockEvent(client, {
    tenantId: auth.tenantId,
    employeeId: auth.id,
    sessionId: ensured.session.id,
    shootId: linkedShootId,
    locationId: linkedLocationId,
    eventType: "clock_in",
    eventTimestamp: input.clientTimestamp,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    metadata: {
      work_state: requestedWorkState,
      shift_id: input.shiftId ?? null,
      reason_code: input.reasonCode ?? null,
      review_required: reviewRequired
    },
    actorType
  });

  const segment = await startTimeSegment(client, {
    tenantId: auth.tenantId,
    sessionId: ensured.session.id,
    employeeId: auth.id,
    workState: requestedWorkState,
    shootId: linkedShootId,
    locationId: linkedLocationId,
    startTime: input.clientTimestamp,
    sourceType: "manual",
    geofenceSupported: true,
    reviewStatus: reviewRequired ? "pending_review" : "not_required"
  });

  if (!segment) {
    throw new ApiError(500, "Mission Control could not start the Time Segment.");
  }

  await insertClockEvent(client, {
    tenantId: auth.tenantId,
    employeeId: auth.id,
    sessionId: ensured.session.id,
    segmentId: segment.id,
    shootId: linkedShootId,
    locationId: linkedLocationId,
    eventType: "work_state_started",
    eventTimestamp: input.clientTimestamp,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    metadata: {
      work_state: requestedWorkState,
      source: "manual_clock_in"
    },
    actorType
  });

  if (reviewRequired) {
    exceptionRequestId = await createTimeClockExceptionRequest(client, {
      tenantId: auth.tenantId,
      employeeId: auth.id,
      requestType: "work_state_change",
      shootId: linkedShootId,
      sessionId: ensured.session.id,
      segmentId: segment.id,
      requestedState: requestedWorkState,
      requestedStartTime: input.clientTimestamp,
      note: reviewNote
    });

    if (exceptionRequestId) {
      await insertClockEvent(client, {
        tenantId: auth.tenantId,
        employeeId: auth.id,
        sessionId: ensured.session.id,
        segmentId: segment.id,
        shootId: linkedShootId,
        locationId: linkedLocationId,
        eventType: "exception_requested",
        eventTimestamp: input.clientTimestamp,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        metadata: {
          exception_request_id: exceptionRequestId,
          work_state: requestedWorkState
        },
        actorType
      });
    }
  }

  const timeClockState = await getTimeClockStateSummary(client, { tenantId: auth.tenantId, employeeId: auth.id });
  await persistPresenceObservation(client, auth, {
    summary: timeClockState,
    capturedAt: input.clientTimestamp,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    accuracyMeters: input.accuracyMeters ?? null,
    sourceType: "clock_punch",
    linkedShiftId: input.shiftId ?? null,
    linkedShootId,
    linkedLocationId
  });
  return {
    timeClockState,
    warnings,
    reviewRequired,
    exceptionRequestId
  };
}

function findLikelyPresentShift(
  shifts: TimeClockShiftContext[],
  latitude: number,
  longitude: number,
  capturedAt: string,
  accuracyMeters?: number | null
) {
  const captured = new Date(capturedAt);
  const candidates = shifts
    .map((shift) => {
      if (typeof shift.location_lat !== "number" || typeof shift.location_lng !== "number") {
        return null;
      }
      const distanceMiles = haversineMiles(shift.location_lat, shift.location_lng, latitude, longitude);
      const softWindowStart = resolvePhotographyWindow({
        showtime: resolveShowtime(shift),
        endsAt: shift.ends_at,
        endTimeEst: shift.shoot_end_time_est
      }).windowStart;
      if (softWindowStart && captured < softWindowStart) {
        return null;
      }
      if (captured > addMinutes(shift.ends_at, 60)) {
        return null;
      }
      if (!isWithinTimeClockSoftWarningRadius({ distanceMiles, accuracyMeters })) {
        return null;
      }
      return {
        shift,
        distanceMiles
      };
    })
    .filter((item): item is { shift: TimeClockShiftContext; distanceMiles: number } => Boolean(item))
    .sort((left, right) => left.distanceMiles - right.distanceMiles);

  return candidates[0] ?? null;
}

function findPhotographyEntryCandidate(shifts: TimeClockShiftContext[], input: { capturedAt: string; latitude: number; longitude: number; accuracyMeters?: number | null }) {
  const captured = new Date(input.capturedAt);
  const candidates = shifts
    .map((shift) => {
      if (!shift.shoot_id || typeof shift.location_lat !== "number" || typeof shift.location_lng !== "number") {
        return null;
      }
      const locationEvaluation = evaluatePunchLocation({
        targetLat: shift.location_lat,
        targetLng: shift.location_lng,
        radiusMeters: Number(shift.geofence_radius_meters ?? 0),
        eventLat: input.latitude,
        eventLng: input.longitude,
        accuracyMeters: input.accuracyMeters ?? null
      });
      const { windowStart, windowEnd } = resolvePhotographyWindow({
        showtime: resolveShowtime(shift),
        endsAt: shift.ends_at,
        endTimeEst: shift.shoot_end_time_est
      });
      const insideWindow = (windowStart ? captured >= windowStart : true) && (windowEnd ? captured <= windowEnd : true);
      if (!locationEvaluation.isInside || !insideWindow) {
        return null;
      }
      return {
        shift,
        distanceMeters: locationEvaluation.distanceMeters ?? Number.MAX_SAFE_INTEGER
      };
    })
    .filter((item): item is { shift: TimeClockShiftContext; distanceMeters: number } => Boolean(item))
    .sort((left, right) => left.distanceMeters - right.distanceMeters);

  return candidates[0]?.shift ?? null;
}

function findLaterShoot(shifts: TimeClockShiftContext[], currentShootId: string | null, capturedAt: string) {
  const captured = new Date(capturedAt).getTime();
  return (
    shifts
      .filter((shift) => shift.shoot_id && shift.shoot_id !== currentShootId && new Date(shift.starts_at).getTime() > captured)
      .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime())[0] ?? null
  );
}

export async function evaluateTimeClockLocation(
  client: PoolClient,
  auth: AuthUser,
  input: { capturedAt: string; latitude: number; longitude: number; accuracyMeters?: number | null }
): Promise<LocationCheckResult> {
  const summary = await getTimeClockStateSummary(client, { tenantId: auth.tenantId, employeeId: auth.id });
  const todayShifts = await listEmployeeShootShiftsAroundTimestamp(client, auth.tenantId, auth.id, input.capturedAt);
  const finalizeLocationCheck = async (
    payload: LocationCheckResult,
    options?: { linkedShiftId?: string | null; linkedShootId?: string | null; linkedLocationId?: string | null; sourceType?: "location_check" | "system_transition" }
  ) => {
    await persistPresenceObservation(client, auth, {
      summary: payload.time_clock_state,
      capturedAt: input.capturedAt,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters ?? null,
      sourceType: options?.sourceType ?? "location_check",
      linkedShiftId: options?.linkedShiftId ?? null,
      linkedShootId: options?.linkedShootId ?? null,
      linkedLocationId: options?.linkedLocationId ?? null
    });
    return payload;
  };

  if (!summary.session_id || summary.session_status === "off_clock") {
    const likelyPresent = findLikelyPresentShift(todayShifts, input.latitude, input.longitude, input.capturedAt, input.accuracyMeters ?? null);
    return finalizeLocationCheck({
      time_clock_state: summary,
      auto_transition: null,
      likely_present_missing_clock_in: likelyPresent
        ? {
            shift_id: likelyPresent.shift.id,
            shoot_id: likelyPresent.shift.shoot_id ?? null,
            title: likelyPresent.shift.title,
            distance_miles: Number(likelyPresent.distanceMiles.toFixed(2)),
            label: "Likely Present, Missing Clock-In"
          }
        : null,
      needs_end_of_day_confirmation: null
    }, {
      linkedShiftId: likelyPresent?.shift.id ?? null,
      linkedShootId: likelyPresent?.shift.shoot_id ?? null,
      linkedLocationId: likelyPresent?.shift.location_id ?? null
    });
  }

  if (summary.session_status === "needs_end_of_day_confirmation") {
    return finalizeLocationCheck({
      time_clock_state: summary,
      auto_transition: null,
      likely_present_missing_clock_in: null,
      needs_end_of_day_confirmation: {
        session_id: summary.session_id,
        title: "Needs End-of-Day Confirmation",
        prompt: "Mission Control ended Photography when you left the final Shoot geofence. Confirm whether you are returning to studio, done for the day, or need a correction."
      }
    });
  }

  const activeSession = await getActiveTimeSession(client, auth.tenantId, auth.id);
  const openSegment = activeSession ? await getOpenTimeSegment(client, activeSession.id) : null;
  if (!activeSession || !openSegment) {
    return finalizeLocationCheck({
      time_clock_state: summary,
      auto_transition: null,
      likely_present_missing_clock_in: null,
      needs_end_of_day_confirmation: null
    });
  }

  if (openSegment.work_state === "office_drive") {
    const candidateShift = findPhotographyEntryCandidate(todayShifts, input);
    if (
      candidateShift &&
      !(await hasRecentAutomaticTransition(client, {
        tenantId: auth.tenantId,
        employeeId: auth.id,
        transitionKind: "office_drive_to_photography",
        capturedAt: input.capturedAt
      }))
    ) {
      await endTimeSegment(client, openSegment.id, input.capturedAt);
      await insertClockEvent(client, {
        tenantId: auth.tenantId,
        employeeId: auth.id,
        sessionId: activeSession.id,
        segmentId: openSegment.id,
        shootId: openSegment.linked_shoot_id,
        locationId: openSegment.linked_location_id,
        eventType: "work_state_ended",
        eventTimestamp: input.capturedAt,
        latitude: input.latitude,
        longitude: input.longitude,
        metadata: {
          transition_kind: "office_drive_to_photography",
          next_shoot_id: candidateShift.shoot_id
        },
        actorType: "system"
      });

      const newSegment = await startTimeSegment(client, {
        tenantId: auth.tenantId,
        sessionId: activeSession.id,
        employeeId: auth.id,
        workState: "photography",
        shootId: candidateShift.shoot_id ?? null,
        locationId: candidateShift.location_id ?? null,
        startTime: input.capturedAt,
        sourceType: "automatic_transition",
        geofenceSupported: true,
        reviewStatus: "not_required"
      });
      await insertClockEvent(client, {
        tenantId: auth.tenantId,
        employeeId: auth.id,
        sessionId: activeSession.id,
        segmentId: newSegment?.id ?? null,
        shootId: candidateShift.shoot_id ?? null,
        locationId: candidateShift.location_id ?? null,
        eventType: "work_state_started",
        eventTimestamp: input.capturedAt,
        latitude: input.latitude,
        longitude: input.longitude,
        metadata: {
          transition_kind: "office_drive_to_photography",
          entered_shift_id: candidateShift.id
        },
        actorType: "system"
      });

      await createAuditLog(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        targetUserId: auth.id,
        action: "time_clock.transition.automatic",
        entityType: "time_session",
        entityId: activeSession.id,
        metadata: {
          transition_kind: "office_drive_to_photography",
          shift_id: candidateShift.id,
          shoot_id: candidateShift.shoot_id ?? null
        }
      });

      const timeClockState = await getTimeClockStateSummary(client, { tenantId: auth.tenantId, employeeId: auth.id });
      return finalizeLocationCheck({
        time_clock_state: timeClockState,
        auto_transition: {
          kind: "office_drive_to_photography",
          message: `Automatically switched to Photography at ${candidateShift.title}.`,
          shift_id: candidateShift.id,
          shoot_id: candidateShift.shoot_id ?? null
        },
        likely_present_missing_clock_in: null,
        needs_end_of_day_confirmation: null
      }, {
        linkedShiftId: candidateShift.id,
        linkedShootId: candidateShift.shoot_id ?? null,
        linkedLocationId: candidateShift.location_id ?? null,
        sourceType: "system_transition"
      });
    }
  }

  if (openSegment.work_state === "photography" && openSegment.linked_shoot_id) {
    const currentShift =
      todayShifts.find((shift) => shift.shoot_id === openSegment.linked_shoot_id) ??
      (activeSession.source_shift_id ? await loadShiftContextById(client, auth.tenantId, activeSession.source_shift_id) : null);

    if (currentShift && typeof currentShift.location_lat === "number" && typeof currentShift.location_lng === "number") {
      const locationEvaluation = evaluatePunchLocation({
        targetLat: currentShift.location_lat,
        targetLng: currentShift.location_lng,
        radiusMeters: Number(currentShift.geofence_radius_meters ?? 0),
        eventLat: input.latitude,
        eventLng: input.longitude,
        accuracyMeters: input.accuracyMeters ?? null
      });

      if (locationEvaluation.geofenceStatus === "outside" && locationEvaluation.gpsConfidence === "outside") {
        const laterShift = findLaterShoot(todayShifts, openSegment.linked_shoot_id, input.capturedAt);
        if (
          laterShift &&
          !(await hasRecentAutomaticTransition(client, {
            tenantId: auth.tenantId,
            employeeId: auth.id,
            transitionKind: "photography_to_office_drive",
            capturedAt: input.capturedAt
          }))
        ) {
          await endTimeSegment(client, openSegment.id, input.capturedAt);
          await insertClockEvent(client, {
            tenantId: auth.tenantId,
            employeeId: auth.id,
            sessionId: activeSession.id,
            segmentId: openSegment.id,
            shootId: openSegment.linked_shoot_id,
            locationId: openSegment.linked_location_id,
            eventType: "work_state_ended",
            eventTimestamp: input.capturedAt,
            latitude: input.latitude,
            longitude: input.longitude,
            metadata: {
              transition_kind: "photography_to_office_drive",
              next_shoot_id: laterShift.shoot_id
            },
            actorType: "system"
          });
          const driveSegment = await startTimeSegment(client, {
            tenantId: auth.tenantId,
            sessionId: activeSession.id,
            employeeId: auth.id,
            workState: "office_drive",
            shootId: laterShift.shoot_id ?? null,
            locationId: laterShift.location_id ?? null,
            startTime: input.capturedAt,
            sourceType: "automatic_transition",
            geofenceSupported: true,
            reviewStatus: "not_required"
          });
          await insertClockEvent(client, {
            tenantId: auth.tenantId,
            employeeId: auth.id,
            sessionId: activeSession.id,
            segmentId: driveSegment?.id ?? null,
            shootId: laterShift.shoot_id ?? null,
            locationId: laterShift.location_id ?? null,
            eventType: "work_state_started",
            eventTimestamp: input.capturedAt,
            latitude: input.latitude,
            longitude: input.longitude,
            metadata: {
              transition_kind: "photography_to_office_drive",
              next_shift_id: laterShift.id
            },
            actorType: "system"
          });

          await createAuditLog(client, {
            tenantId: auth.tenantId,
            actorUserId: auth.id,
            targetUserId: auth.id,
            action: "time_clock.transition.automatic",
            entityType: "time_session",
            entityId: activeSession.id,
            metadata: {
              transition_kind: "photography_to_office_drive",
              next_shift_id: laterShift.id,
              next_shoot_id: laterShift.shoot_id ?? null
            }
          });

          const timeClockState = await getTimeClockStateSummary(client, { tenantId: auth.tenantId, employeeId: auth.id });
          return finalizeLocationCheck({
            time_clock_state: timeClockState,
            auto_transition: {
              kind: "photography_to_office_drive",
              message: `Automatically switched to Office/Drive for the next Shoot: ${laterShift.title}.`,
              shift_id: laterShift.id,
              shoot_id: laterShift.shoot_id ?? null
            },
            likely_present_missing_clock_in: null,
            needs_end_of_day_confirmation: null
          }, {
            linkedShiftId: laterShift.id,
            linkedShootId: laterShift.shoot_id ?? null,
            linkedLocationId: laterShift.location_id ?? null,
            sourceType: "system_transition"
          });
        }

        if (
          !laterShift &&
          !(await hasRecentAutomaticTransition(client, {
            tenantId: auth.tenantId,
            employeeId: auth.id,
            transitionKind: "final_shoot_exit_confirmation_required",
            capturedAt: input.capturedAt
          }))
        ) {
          await endTimeSegment(client, openSegment.id, input.capturedAt);
          await insertClockEvent(client, {
            tenantId: auth.tenantId,
            employeeId: auth.id,
            sessionId: activeSession.id,
            segmentId: openSegment.id,
            shootId: openSegment.linked_shoot_id,
            locationId: openSegment.linked_location_id,
            eventType: "work_state_ended",
            eventTimestamp: input.capturedAt,
            latitude: input.latitude,
            longitude: input.longitude,
            metadata: {
              transition_kind: "final_shoot_exit_confirmation_required"
            },
            actorType: "system"
          });
          await setTimeSessionStatus(client, activeSession.id, "needs_end_of_day_confirmation");
          await createAuditLog(client, {
            tenantId: auth.tenantId,
            actorUserId: auth.id,
            targetUserId: auth.id,
            action: "time_clock.end_of_day_confirmation.required",
            entityType: "time_session",
            entityId: activeSession.id,
            metadata: {
              previous_state: "photography",
              shift_id: currentShift.id,
              shoot_id: currentShift.shoot_id ?? null
            }
          });
          await markEndOfDayConfirmationRequired(client, {
            tenantId: auth.tenantId,
            employeeId: auth.id,
            sessionId: activeSession.id,
            shiftId: currentShift.id,
            shootId: currentShift.shoot_id ?? null,
            locationId: currentShift.location_id ?? null,
            actorUserId: auth.id,
            detectedAt: input.capturedAt
          });

          const timeClockState = await getTimeClockStateSummary(client, { tenantId: auth.tenantId, employeeId: auth.id });
          return finalizeLocationCheck({
            time_clock_state: timeClockState,
            auto_transition: null,
            likely_present_missing_clock_in: null,
            needs_end_of_day_confirmation: {
              session_id: activeSession.id,
              title: "Needs End-of-Day Confirmation",
              prompt: "Mission Control ended Photography when you left the final Shoot geofence. Confirm whether you are returning to studio, done for the day, or need a correction."
            }
          }, {
            linkedShiftId: currentShift.id,
            linkedShootId: currentShift.shoot_id ?? null,
            linkedLocationId: currentShift.location_id ?? null,
            sourceType: "system_transition"
          });
        }
      }
    }
  }

  const timeClockState = await getTimeClockStateSummary(client, { tenantId: auth.tenantId, employeeId: auth.id });
  return finalizeLocationCheck({
    time_clock_state: timeClockState,
    auto_transition: null,
    likely_present_missing_clock_in: null,
    needs_end_of_day_confirmation: null
  }, {
    linkedShiftId: activeSession.source_shift_id ?? null,
    linkedShootId: openSegment.linked_shoot_id ?? null,
    linkedLocationId: openSegment.linked_location_id ?? null
  });
}

export async function autoCloseTimeClockSessionForShift(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    shiftId: string;
    shootId?: string | null;
    locationId?: string | null;
    capturedAt: string;
  }
) {
  return autoCloseTimeClockSessionForShiftShared(client, input);
}

export async function confirmEndOfDayState(
  client: PoolClient,
  auth: AuthUser,
  input: {
    decision: EndOfDayConfirmationDecision;
    capturedAt: string;
    note?: string | null;
    sessionId?: string | null;
  }
) {
  const actorType = toActorType(auth);
  const session =
    input.sessionId
      ? (
          await client.query<TimeSessionRow>(
            `
              SELECT *
              FROM time_session
              WHERE tenant_id = $1
                AND employee_id = $2
                AND id = $3
              LIMIT 1
            `,
            [auth.tenantId, auth.id, input.sessionId]
          )
        ).rows[0] ?? null
      : await getActiveTimeSession(client, auth.tenantId, auth.id);

  if (!session || session.status !== "needs_end_of_day_confirmation") {
    throw new ApiError(409, "There is no active Time Session waiting for end-of-day confirmation.");
  }

  let exceptionRequestId: string | null = null;
  if (input.decision === "returning_to_studio") {
    await setTimeSessionStatus(client, session.id, "open");
    const driveSegment = await startTimeSegment(client, {
      tenantId: auth.tenantId,
      sessionId: session.id,
      employeeId: auth.id,
      workState: "office_drive",
      startTime: input.capturedAt,
      sourceType: "manual",
      geofenceSupported: true,
      reviewStatus: "not_required"
    });
    await insertClockEvent(client, {
      tenantId: auth.tenantId,
      employeeId: auth.id,
      sessionId: session.id,
      segmentId: driveSegment?.id ?? null,
      eventType: "work_state_started",
      eventTimestamp: input.capturedAt,
      metadata: {
        decision: input.decision
      },
      actorType
    });
  } else {
    await insertClockEvent(client, {
      tenantId: auth.tenantId,
      employeeId: auth.id,
      sessionId: session.id,
      eventType: "clock_out",
      eventTimestamp: input.capturedAt,
      metadata: {
        decision: input.decision
      },
      actorType
    });
    if (input.decision === "correction_needed") {
      exceptionRequestId = await createTimeClockExceptionRequest(client, {
        tenantId: auth.tenantId,
        employeeId: auth.id,
        requestType: "time_segment_correction",
        sessionId: session.id,
        note:
          input.note?.trim() ||
          "Correction needed after leaving the final Shoot geofence. Leadership review is required before payroll finalization."
      });
      if (exceptionRequestId) {
        await insertClockEvent(client, {
          tenantId: auth.tenantId,
          employeeId: auth.id,
          sessionId: session.id,
          eventType: "exception_requested",
          eventTimestamp: input.capturedAt,
          metadata: {
            exception_request_id: exceptionRequestId,
            decision: input.decision
          },
          actorType
        });
      }
    }
    await setTimeSessionStatus(client, session.id, "closed");
    await insertClockEvent(client, {
      tenantId: auth.tenantId,
      employeeId: auth.id,
      sessionId: session.id,
      eventType: "session_closed",
      eventTimestamp: input.capturedAt,
      metadata: {
        decision: input.decision
      },
      actorType
    });
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: auth.id,
    action: "time_clock.end_of_day.confirmed",
    entityType: "time_session",
    entityId: session.id,
    metadata: {
      decision: input.decision,
      exception_request_id: exceptionRequestId
    },
    reasonComment: input.note?.trim() || null
  });
  await resolveTimeClockComplianceFlags(client, {
    tenantId: auth.tenantId,
    employeeId: auth.id,
    sessionId: session.id,
    itemTypes: ["unresolved_end_of_day_confirmation"],
    linkedExceptionRequestId: exceptionRequestId,
    resolutionNote:
      input.decision === "returning_to_studio"
        ? "Employee confirmed a return to studio."
        : input.decision === "done_for_day"
          ? "Employee confirmed they were done for the day."
          : "Employee submitted a correction request for the end-of-day state.",
    actorUserId: auth.id
  });

  const timeClockState = await getTimeClockStateSummary(client, { tenantId: auth.tenantId, employeeId: auth.id });
  await persistPresenceObservation(client, auth, {
    summary: timeClockState,
    capturedAt: input.capturedAt,
    sourceType: "end_of_day_confirmation",
    linkedShiftId: session.source_shift_id ?? null
  });

  return {
    time_clock_state: timeClockState,
    exception_request_id: exceptionRequestId
  };
}
