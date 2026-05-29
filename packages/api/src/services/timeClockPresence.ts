import type { PoolClient } from "pg";
import { createAuditLog } from "./audit.js";
import { evaluatePunchLocation, haversineMiles } from "./geo.js";
import { getStudioLocation } from "./maps.js";
import type { TimeSessionStatus, TimeWorkState } from "../types/timeClock.js";
import type { TimeClockStateSummary } from "./timeClockRuntime.js";
import { getLocalDayBounds } from "../utils/localDate.js";
import {
  classifyMissingClockInState,
  classifyOperationalSeverity,
  humanizeOperationalAttendanceState,
  humanizeOperationalLocation,
  isOperationalAttendanceState,
  isLeadOrSetupRole,
  normalizeStaffingRole,
  operationalSeverityLabel,
  type OperationalAttendanceSeverity,
  type OperationalAttendanceState,
  type OperationalLocationClassification
} from "./attendanceAwareness.js";

type PresenceState = "off_clock" | TimeWorkState | "needs_end_of_day_confirmation";
type PresenceObservationSource = "location_check" | "clock_punch" | "end_of_day_confirmation" | "system_transition";
type PresenceAlertType = "assigned_but_missing" | "likely_present_missing_clock_in";

type ActivePresenceRow = {
  employee_id: string;
  employee_name: string;
  session_id: string;
  session_status: TimeSessionStatus;
  source_shift_id: string | null;
  segment_id: string | null;
  work_state: TimeWorkState | null;
  segment_start_time: string | null;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  observation_shift_id: string | null;
  observation_shoot_id: string | null;
  observation_location_id: string | null;
  observation_state: PresenceState | null;
  observation_captured_at: string | null;
  observation_latitude: number | null;
  observation_longitude: number | null;
  shoot_title: string | null;
  shoot_location_name: string | null;
  shoot_location_lat: number | null;
  shoot_location_lng: number | null;
  shoot_geofence_radius_meters: number | null;
  staffing_role: string | null;
  satisfies_lead_coverage: boolean;
  shoot_importance_tier: string | null;
  shoot_importance_override_tier: string | null;
  latest_punch_direction: "in" | "out" | null;
  latest_punch_timing_status: string | null;
  latest_punch_late_minutes: number | null;
  latest_punch_client_timestamp: string | null;
};

type OpenPresenceIncidentRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  shift_id: string | null;
  shoot_id: string | null;
  alert_type: PresenceAlertType;
  shoot_title: string | null;
  shift_title: string | null;
  location_name: string | null;
  starts_at: string | null;
  staffing_role: string | null;
  satisfies_lead_coverage: boolean;
  shoot_importance_tier: string | null;
  shoot_importance_override_tier: string | null;
  current_state: PresenceState;
  geofence_classification: string;
  created_at: string;
  last_observed_at: string;
  repeat_count: number;
};

type ScheduledPresenceRow = {
  shift_id: string;
  employee_id: string;
  employee_name: string;
  shoot_id: string | null;
  shoot_title: string | null;
  shift_title: string | null;
  location_name: string | null;
  starts_at: string;
  ends_at: string;
  staffing_role: string | null;
  satisfies_lead_coverage: boolean;
  shoot_importance_tier: string | null;
  shoot_importance_override_tier: string | null;
};

type AttendanceExceptionRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  shift_id: string | null;
  shoot_id: string | null;
  shoot_title: string | null;
  shift_title: string | null;
  location_name: string | null;
  starts_at: string | null;
  staffing_role: string | null;
  satisfies_lead_coverage: boolean;
  shoot_importance_tier: string | null;
  shoot_importance_override_tier: string | null;
  current_state: PresenceState;
  exception_type: string;
  classification: string | null;
  created_at: string;
};

type AttendanceContext = {
  staffing_role?: string | null;
  satisfies_lead_coverage?: boolean | null;
  shoot_importance_tier?: string | null;
  shoot_importance_override_tier?: string | null;
};

type ResolvedPresenceIncidentRow = {
  id: string;
  employee_id: string;
  shift_id: string | null;
  shoot_id: string | null;
  alert_type: PresenceAlertType;
};

export type HomeAttendanceAwarenessEntry = {
  id: string;
  employee_id: string;
  employee_name: string;
  shift_id: string | null;
  shoot_id: string | null;
  primary_label: string;
  secondary_label: string | null;
  supporting_label: string | null;
  current_state: PresenceState;
  captured_at: string | null;
  operational_state: OperationalAttendanceState;
  severity: OperationalAttendanceSeverity;
  severity_label: string;
  location_classification: OperationalLocationClassification | null;
  location_label: string | null;
  staffing_risk: boolean;
  minutes_from_start: number | null;
};

export type HomeAttendanceAwarenessWidget = {
  visible: boolean;
  summary: {
    clocked_in_count: number;
    grace_window_count: number;
    not_clocked_in_count: number;
    late_count: number;
    critically_late_count: number;
    missing_clock_in_count: number;
    probable_no_show_count: number;
    missing_count: number;
    wrong_location_count: number;
    staffing_risk_count: number;
  };
  clocked_in: {
    count: number;
    items: HomeAttendanceAwarenessEntry[];
  };
  grace_window: {
    count: number;
    items: HomeAttendanceAwarenessEntry[];
  };
  not_clocked_in: {
    count: number;
    items: HomeAttendanceAwarenessEntry[];
  };
  late: {
    count: number;
    items: HomeAttendanceAwarenessEntry[];
  };
  critically_late: {
    count: number;
    items: HomeAttendanceAwarenessEntry[];
  };
  missing_clock_in: {
    count: number;
    items: HomeAttendanceAwarenessEntry[];
  };
  probable_no_show: {
    count: number;
    items: HomeAttendanceAwarenessEntry[];
  };
  missing: {
    count: number;
    items: HomeAttendanceAwarenessEntry[];
  };
  wrong_location: {
    count: number;
    items: HomeAttendanceAwarenessEntry[];
  };
  in_office: {
    count: number;
    items: HomeAttendanceAwarenessEntry[];
  };
  in_field: {
    count: number;
    items: HomeAttendanceAwarenessEntry[];
  };
  assigned_but_missing: {
    count: number;
    items: HomeAttendanceAwarenessEntry[];
  };
};

export function presenceStateFromTimeClockSummary(summary: TimeClockStateSummary): PresenceState {
  if (summary.needs_end_of_day_confirmation || summary.session_status === "needs_end_of_day_confirmation") {
    return "needs_end_of_day_confirmation";
  }
  if (summary.current_state === "off_clock") {
    return "off_clock";
  }
  return summary.current_state;
}

export async function upsertTimeClockPresenceObservation(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    sessionId?: string | null;
    sessionStatus?: TimeSessionStatus | "off_clock" | null;
    segmentId?: string | null;
    linkedShiftId?: string | null;
    linkedShootId?: string | null;
    linkedLocationId?: string | null;
    currentState: PresenceState;
    capturedAt: string;
    latitude?: number | null;
    longitude?: number | null;
    accuracyMeters?: number | null;
    sourceType: PresenceObservationSource;
  }
) {
  await client.query(
    `
      INSERT INTO time_clock_presence_observation (
        tenant_id,
        employee_id,
        session_id,
        segment_id,
        linked_shift_id,
        linked_shoot_id,
        linked_location_id,
        current_state,
        session_status,
        latitude,
        longitude,
        accuracy_meters,
        captured_at,
        source_type
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (tenant_id, employee_id)
      DO UPDATE SET
        session_id = EXCLUDED.session_id,
        segment_id = EXCLUDED.segment_id,
        linked_shift_id = COALESCE(EXCLUDED.linked_shift_id, time_clock_presence_observation.linked_shift_id),
        linked_shoot_id = COALESCE(EXCLUDED.linked_shoot_id, time_clock_presence_observation.linked_shoot_id),
        linked_location_id = COALESCE(EXCLUDED.linked_location_id, time_clock_presence_observation.linked_location_id),
        current_state = EXCLUDED.current_state,
        session_status = EXCLUDED.session_status,
        latitude = COALESCE(EXCLUDED.latitude, time_clock_presence_observation.latitude),
        longitude = COALESCE(EXCLUDED.longitude, time_clock_presence_observation.longitude),
        accuracy_meters = COALESCE(EXCLUDED.accuracy_meters, time_clock_presence_observation.accuracy_meters),
        captured_at = EXCLUDED.captured_at,
        source_type = EXCLUDED.source_type,
        updated_at = now()
    `,
    [
      input.tenantId,
      input.employeeId,
      input.sessionId ?? null,
      input.segmentId ?? null,
      input.linkedShiftId ?? null,
      input.linkedShootId ?? null,
      input.linkedLocationId ?? null,
      input.currentState,
      input.sessionStatus && input.sessionStatus !== "off_clock" ? input.sessionStatus : null,
      input.latitude ?? null,
      input.longitude ?? null,
      input.accuracyMeters ?? null,
      input.capturedAt,
      input.sourceType
    ]
  );
}

export async function resolveTimeClockPresenceIncidents(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    shiftId?: string | null;
    shootId?: string | null;
    resolvedAt: string;
    resolutionReason: string;
    actorUserId?: string | null;
    linkedCorrectionRequestId?: string | null;
  }
) {
  if (!input.shiftId && !input.shootId) {
    return [] as ResolvedPresenceIncidentRow[];
  }

  const { rows } = await client.query<ResolvedPresenceIncidentRow>(
    `
      UPDATE time_clock_presence_incident
      SET resolution_status = 'resolved',
          linked_correction_request_id = COALESCE($6::uuid, linked_correction_request_id),
          resolved_at = $4::timestamptz,
          resolution_reason = $5,
          updated_at = now()
      WHERE tenant_id = $1
        AND employee_id = $2
        AND resolution_status = 'open'
        AND ($3::uuid IS NULL OR shift_id = $3::uuid)
        AND ($7::uuid IS NULL OR shoot_id = $7::uuid)
      RETURNING id, employee_id, shift_id, shoot_id, alert_type::text
    `,
    [
      input.tenantId,
      input.employeeId,
      input.shiftId ?? null,
      input.resolvedAt,
      input.resolutionReason,
      input.linkedCorrectionRequestId ?? null,
      input.shootId ?? null
    ]
  );

  for (const incident of rows) {
    await createAuditLog(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      targetUserId: input.employeeId,
      action: "time_clock.presence_incident.resolved",
      entityType: "time_clock_presence_incident",
      entityId: incident.id,
      metadata: {
        shift_id: incident.shift_id,
        shoot_id: incident.shoot_id,
        alert_type: incident.alert_type,
        resolution_reason: input.resolutionReason,
        linked_correction_request_id: input.linkedCorrectionRequestId ?? null
      }
    });
  }

  return rows;
}

export async function getHomeAttendanceAwarenessWidget(
  client: PoolClient,
  input: { tenantId: string; anchorDate: string; shootId?: string | null }
): Promise<HomeAttendanceAwarenessWidget> {
  const dayBounds = getLocalDayBounds(input.anchorDate);
  const scopedShootId = input.shootId ?? null;
  const activeRows = await client.query<ActivePresenceRow>(
      `
        WITH active_session AS (
          SELECT
            ts.id AS session_id,
            ts.employee_id,
            ts.status::text AS session_status,
            ts.source_shift_id,
            au.full_name AS employee_name
          FROM time_session ts
          JOIN app_user au
            ON au.id = ts.employee_id
           AND au.tenant_id = ts.tenant_id
          WHERE ts.tenant_id = $1
            AND ts.work_date = $2::date
            AND ts.status IN ('open', 'needs_end_of_day_confirmation')
            AND au.status = 'active'
        )
        SELECT
          active.employee_id,
          active.employee_name,
          active.session_id,
          active.session_status::text AS session_status,
          active.source_shift_id,
          segment.id AS segment_id,
          segment.work_state::text AS work_state,
          segment.start_time::text AS segment_start_time,
          segment.linked_shoot_id,
          segment.linked_location_id,
          observation.linked_shift_id AS observation_shift_id,
          observation.linked_shoot_id AS observation_shoot_id,
          observation.linked_location_id AS observation_location_id,
          observation.current_state::text AS observation_state,
          observation.captured_at::text AS observation_captured_at,
          observation.latitude AS observation_latitude,
          observation.longitude AS observation_longitude,
          shoot.title AS shoot_title,
          shoot.location_name AS shoot_location_name,
          shoot.location_lat AS shoot_location_lat,
          shoot.location_lng AS shoot_location_lng,
          shoot.geofence_radius_meters AS shoot_geofence_radius_meters,
          shift.staffing_role::text,
          COALESCE(shift.satisfies_lead_coverage, false) AS satisfies_lead_coverage,
          NULL::text AS shoot_importance_tier,
          shoot.importance_override_tier::text AS shoot_importance_override_tier,
          latest_punch.direction::text AS latest_punch_direction,
          latest_punch.timing_status::text AS latest_punch_timing_status,
          latest_punch.late_minutes AS latest_punch_late_minutes,
          latest_punch.client_timestamp::text AS latest_punch_client_timestamp
        FROM active_session active
        LEFT JOIN LATERAL (
          SELECT seg.*
          FROM time_segment seg
          WHERE seg.session_id = active.session_id
            AND seg.end_time IS NULL
          ORDER BY seg.start_time DESC
          LIMIT 1
        ) segment ON true
        LEFT JOIN time_clock_presence_observation observation
          ON observation.tenant_id = $1
         AND observation.employee_id = active.employee_id
        LEFT JOIN work_shift shift
          ON shift.id = COALESCE(observation.linked_shift_id, active.source_shift_id)
        LEFT JOIN LATERAL (
          SELECT sp.direction, sp.timing_status, sp.late_minutes, sp.client_timestamp
          FROM shift_punch sp
          WHERE sp.tenant_id = $1
            AND sp.user_id = active.employee_id
            AND sp.client_timestamp >= $3::timestamptz
            AND sp.client_timestamp < $4::timestamptz
          ORDER BY sp.client_timestamp DESC
          LIMIT 1
        ) latest_punch ON true
        LEFT JOIN shoot
          ON shoot.id = COALESCE(segment.linked_shoot_id, observation.linked_shoot_id, shift.shoot_id)
        WHERE ($5::uuid IS NULL OR COALESCE(segment.linked_shoot_id, observation.linked_shoot_id, shift.shoot_id) = $5::uuid)
        ORDER BY active.employee_name ASC
      `,
      [input.tenantId, input.anchorDate, dayBounds.start.toISOString(), dayBounds.endExclusive.toISOString(), scopedShootId]
    );
  const missingRows = await client.query<OpenPresenceIncidentRow>(
      `
        SELECT
          incident.id,
          incident.employee_id,
          au.full_name AS employee_name,
          incident.shift_id,
          incident.shoot_id,
          incident.alert_type::text AS alert_type,
          shoot.title AS shoot_title,
          shift.title AS shift_title,
          COALESCE(shift.location_name, shoot.location_name) AS location_name,
          shift.starts_at::text,
          shift.staffing_role::text,
          COALESCE(shift.satisfies_lead_coverage, false) AS satisfies_lead_coverage,
          NULL::text AS shoot_importance_tier,
          shoot.importance_override_tier::text AS shoot_importance_override_tier,
          incident.current_state::text AS current_state,
          incident.geofence_classification::text AS geofence_classification,
          incident.created_at::text,
          incident.last_observed_at::text,
          incident.repeat_count
        FROM time_clock_presence_incident incident
        JOIN app_user au
          ON au.id = incident.employee_id
         AND au.tenant_id = incident.tenant_id
        LEFT JOIN work_shift shift
          ON shift.id = incident.shift_id
        LEFT JOIN shoot
          ON shoot.id = incident.shoot_id
        WHERE incident.tenant_id = $1
          AND incident.resolution_status = 'open'
          AND incident.created_at >= $2::date
          AND ($3::uuid IS NULL OR COALESCE(incident.shoot_id, shift.shoot_id) = $3::uuid)
        ORDER BY incident.last_observed_at DESC, incident.created_at DESC
      `,
      [input.tenantId, input.anchorDate, scopedShootId]
    );
  const scheduledRows = await client.query<ScheduledPresenceRow>(
      `
        SELECT
          ws.id AS shift_id,
          ws.assigned_user_id AS employee_id,
          au.full_name AS employee_name,
          ws.shoot_id,
          shoot.title AS shoot_title,
          ws.title AS shift_title,
          COALESCE(ws.location_name, shoot.location_name) AS location_name,
          ws.starts_at::text,
          ws.ends_at::text,
          ws.staffing_role::text,
          COALESCE(ws.satisfies_lead_coverage, false) AS satisfies_lead_coverage,
          NULL::text AS shoot_importance_tier,
          shoot.importance_override_tier::text AS shoot_importance_override_tier
        FROM work_shift ws
        JOIN app_user au
          ON au.id = ws.assigned_user_id
         AND au.tenant_id = ws.tenant_id
        LEFT JOIN shoot
          ON shoot.id = ws.shoot_id
        WHERE ws.tenant_id = $1
          AND ws.cancelled_at IS NULL
          AND ws.status = 'published'
          AND ws.starts_at < $3::timestamptz
          AND ws.ends_at >= $2::timestamptz
          AND au.status = 'active'
          AND ($4::uuid IS NULL OR ws.shoot_id = $4::uuid)
        ORDER BY ws.starts_at ASC, au.full_name ASC
      `,
      [input.tenantId, dayBounds.start.toISOString(), dayBounds.endExclusive.toISOString(), scopedShootId]
    );
  const exceptionRows = await client.query<AttendanceExceptionRow>(
      `
        SELECT
          ae.id,
          ae.user_id AS employee_id,
          au.full_name AS employee_name,
          ae.shift_id,
          COALESCE(ae.shoot_id, ws.shoot_id) AS shoot_id,
          shoot.title AS shoot_title,
          ws.title AS shift_title,
          COALESCE(ws.location_name, shoot.location_name) AS location_name,
          ws.starts_at::text,
          ws.staffing_role::text,
          COALESCE(ws.satisfies_lead_coverage, false) AS satisfies_lead_coverage,
          NULL::text AS shoot_importance_tier,
          shoot.importance_override_tier::text AS shoot_importance_override_tier,
          COALESCE(incident.current_state::text, 'off_clock') AS current_state,
          ae.exception_type::text AS exception_type,
          ae.classification,
          ae.created_at::text
        FROM attendance_exception ae
        JOIN app_user au
          ON au.id = ae.user_id
         AND au.tenant_id = ae.tenant_id
        LEFT JOIN work_shift ws
          ON ws.id = ae.shift_id
        LEFT JOIN shoot
          ON shoot.id = COALESCE(ae.shoot_id, ws.shoot_id)
        LEFT JOIN time_clock_presence_incident incident
          ON incident.tenant_id = ae.tenant_id
         AND incident.employee_id = ae.user_id
         AND (incident.shift_id = ae.shift_id OR incident.shoot_id = COALESCE(ae.shoot_id, ws.shoot_id))
         AND incident.resolution_status = 'open'
        WHERE ae.tenant_id = $1
          AND ae.status = 'open'
          AND ae.created_at >= $2::timestamptz
          AND ae.created_at < $3::timestamptz
          AND ($4::uuid IS NULL OR COALESCE(ae.shoot_id, ws.shoot_id) = $4::uuid)
        ORDER BY ae.created_at DESC
      `,
      [input.tenantId, dayBounds.start.toISOString(), dayBounds.endExclusive.toISOString(), scopedShootId]
    );

  const studio = getStudioLocation();
  const now = new Date();
  const scheduledByShiftId = new Map<string, ScheduledPresenceRow>();
  for (const row of scheduledRows.rows) {
    scheduledByShiftId.set(row.shift_id, row);
  }

  const inOffice: HomeAttendanceAwarenessEntry[] = [];
  const inField: HomeAttendanceAwarenessEntry[] = [];
  const clockedIn = new Map<string, HomeAttendanceAwarenessEntry>();
  const graceWindow = new Map<string, HomeAttendanceAwarenessEntry>();
  const notClockedIn = new Map<string, HomeAttendanceAwarenessEntry>();
  const late = new Map<string, HomeAttendanceAwarenessEntry>();
  const criticallyLate = new Map<string, HomeAttendanceAwarenessEntry>();
  const missingClockIn = new Map<string, HomeAttendanceAwarenessEntry>();
  const probableNoShow = new Map<string, HomeAttendanceAwarenessEntry>();
  const missing = new Map<string, HomeAttendanceAwarenessEntry>();
  const wrongLocation = new Map<string, HomeAttendanceAwarenessEntry>();
  const activeEmployeeIds = new Set<string>();

  for (const row of activeRows.rows) {
    activeEmployeeIds.add(row.employee_id);
    const shiftId = row.observation_shift_id ?? row.source_shift_id ?? null;
    const shootId = row.linked_shoot_id ?? row.observation_shoot_id ?? null;
    const locationClassification = resolveActiveLocationClassification(row);
    const operationalState = resolveOperationalStateFromPunch(row.latest_punch_timing_status, row.latest_punch_direction);
    const entry = createAttendanceEntry({
      id: `clocked-${row.employee_id}`,
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      shiftId,
      shootId,
      secondaryLabel: row.shoot_title ?? (row.work_state === "office_drive" ? "Office / Drive active" : "Clocked in"),
      currentState: row.observation_state ?? row.work_state ?? "off_clock",
      capturedAt: row.observation_captured_at ?? row.latest_punch_client_timestamp,
      operationalState,
      locationClassification,
      locationName: row.shoot_location_name,
      minutesFromStart: getMinutesFromStart(row.latest_punch_client_timestamp, now),
      startedLabel: formatStartedLabel(row.segment_start_time),
      staffingRole: row.staffing_role,
      satisfiesLeadCoverage: row.satisfies_lead_coverage,
      shootImportanceTier: row.shoot_importance_tier,
      shootImportanceOverrideTier: row.shoot_importance_override_tier
    });

    pushAttendanceEntry(clockedIn, entry);

    if (row.work_state === "office_drive" && row.observation_state === "office_drive") {
      const studioLabel =
        typeof row.observation_latitude === "number" && typeof row.observation_longitude === "number"
          ? haversineMiles(studio.latitude, studio.longitude, row.observation_latitude, row.observation_longitude) <= 0.5
            ? "Studio geofence"
            : "Office / Drive active"
          : "Office / Drive active";
      inOffice.push({
        ...entry,
        id: `office-${row.employee_id}`,
        secondary_label: row.shoot_title ?? studioLabel
      });
    } else if (row.work_state === "photography" && row.observation_state === "photography") {
      if (locationClassification === "valid_on_site" || locationClassification === "near_site") {
        inField.push(entry);
      } else if (locationClassification === "wrong_location" || locationClassification === "outside_allowed_zone") {
        pushAttendanceEntry(
          wrongLocation,
          createAttendanceEntry({
            id: `wrong-location-${row.employee_id}`,
            employeeId: row.employee_id,
            employeeName: row.employee_name,
            shiftId,
            shootId,
            secondaryLabel: row.shoot_title ?? "Assigned field work",
            currentState: row.observation_state ?? row.work_state ?? "off_clock",
            capturedAt: row.observation_captured_at ?? row.latest_punch_client_timestamp,
            operationalState: "wrong_location",
            locationClassification,
            locationName: row.shoot_location_name,
            minutesFromStart: getMinutesFromStart(row.latest_punch_client_timestamp, now),
            startedLabel: formatStartedLabel(row.segment_start_time),
            staffingRole: row.staffing_role,
            satisfiesLeadCoverage: row.satisfies_lead_coverage,
            shootImportanceTier: row.shoot_importance_tier,
            shootImportanceOverrideTier: row.shoot_importance_override_tier,
            staffingRisk: true
          })
        );
      }
    }

    if (operationalState === "grace_window") {
      pushAttendanceEntry(graceWindow, entry);
    } else if (operationalState === "late") {
      pushAttendanceEntry(late, entry);
    } else if (operationalState === "critically_late") {
      pushAttendanceEntry(criticallyLate, entry);
    }
  }

  const assignedButMissing: HomeAttendanceAwarenessEntry[] = [];
  for (const row of missingRows.rows) {
    if (activeEmployeeIds.has(row.employee_id)) {
      continue;
    }
    const scheduled = row.shift_id ? scheduledByShiftId.get(row.shift_id) ?? null : null;
    const minutesFromStart = getMinutesFromStart(row.starts_at ?? scheduled?.starts_at ?? null, now);
    const operationalState = classifyMissingClockInState(Math.max(minutesFromStart ?? 0, 0));
    const locationClassification = mapPresenceGeofenceClassification(row.geofence_classification);
    const entry = createAttendanceEntry({
      id: `incident-${row.id}`,
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      shiftId: row.shift_id,
      shootId: row.shoot_id,
      secondaryLabel: row.shoot_title ?? row.shift_title ?? "Assigned work",
      currentState: row.current_state,
      capturedAt: row.last_observed_at ?? row.created_at,
      operationalState,
      locationClassification,
      locationName: row.location_name,
      minutesFromStart,
      staffingRole: row.staffing_role,
      satisfiesLeadCoverage: row.satisfies_lead_coverage,
      shootImportanceTier: row.shoot_importance_tier,
      shootImportanceOverrideTier: row.shoot_importance_override_tier,
      staffingRisk: true
    });

    if (row.alert_type === "assigned_but_missing") {
      assignedButMissing.push(entry);
    }

    if (operationalState === "missing_clock_in") {
      pushAttendanceEntry(missingClockIn, entry);
      pushAttendanceEntry(notClockedIn, entry);
    } else if (operationalState === "late") {
      pushAttendanceEntry(late, entry);
      pushAttendanceEntry(notClockedIn, entry);
    } else if (operationalState === "critically_late") {
      pushAttendanceEntry(criticallyLate, entry);
      pushAttendanceEntry(notClockedIn, entry);
    } else if (operationalState === "probable_no_show") {
      pushAttendanceEntry(probableNoShow, entry);
      pushAttendanceEntry(notClockedIn, entry);
      pushAttendanceEntry(missing, entry);
    }

    if (locationClassification === "wrong_location" || locationClassification === "outside_allowed_zone") {
      pushAttendanceEntry(
        wrongLocation,
        createAttendanceEntry({
          id: `wrong-location-incident-${row.id}`,
          employeeId: row.employee_id,
          employeeName: row.employee_name,
          shiftId: row.shift_id,
          shootId: row.shoot_id,
          secondaryLabel: row.shoot_title ?? row.shift_title ?? "Assigned work",
          currentState: row.current_state,
          capturedAt: row.last_observed_at ?? row.created_at,
          operationalState: "wrong_location",
          locationClassification,
          locationName: row.location_name,
          minutesFromStart,
          staffingRole: row.staffing_role,
          satisfiesLeadCoverage: row.satisfies_lead_coverage,
          shootImportanceTier: row.shoot_importance_tier,
          shootImportanceOverrideTier: row.shoot_importance_override_tier,
          staffingRisk: true
        })
      );
    }
  }

  for (const row of exceptionRows.rows) {
    const operationalState = resolveOperationalStateFromException(row);
    const locationClassification = mapExceptionLocationClassification(row.classification, row.exception_type);
    if (!operationalState && !locationClassification) {
      continue;
    }

    const entry = createAttendanceEntry({
      id: `exception-${row.id}`,
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      shiftId: row.shift_id,
      shootId: row.shoot_id,
      secondaryLabel: row.shoot_title ?? row.shift_title ?? "Attendance review",
      currentState: row.current_state,
      capturedAt: row.created_at,
      operationalState: operationalState ?? "wrong_location",
      locationClassification,
      locationName: row.location_name,
      minutesFromStart: getMinutesFromStart(row.starts_at, now),
      staffingRole: row.staffing_role,
      satisfiesLeadCoverage: row.satisfies_lead_coverage,
      shootImportanceTier: row.shoot_importance_tier,
      shootImportanceOverrideTier: row.shoot_importance_override_tier,
      staffingRisk: operationalState !== "grace_window" && operationalState !== "early"
    });

    if (operationalState === "grace_window") {
      pushAttendanceEntry(graceWindow, entry);
    } else if (operationalState === "late") {
      pushAttendanceEntry(late, entry);
      if (row.current_state === "off_clock") {
        pushAttendanceEntry(notClockedIn, entry);
      }
    } else if (operationalState === "critically_late") {
      pushAttendanceEntry(criticallyLate, entry);
      if (row.current_state === "off_clock") {
        pushAttendanceEntry(notClockedIn, entry);
      }
    } else if (operationalState === "missing_clock_in") {
      pushAttendanceEntry(missingClockIn, entry);
      pushAttendanceEntry(notClockedIn, entry);
    } else if (operationalState === "probable_no_show") {
      pushAttendanceEntry(probableNoShow, entry);
      pushAttendanceEntry(notClockedIn, entry);
      pushAttendanceEntry(missing, entry);
    }

    if (locationClassification === "wrong_location" || locationClassification === "outside_allowed_zone") {
      pushAttendanceEntry(
        wrongLocation,
        createAttendanceEntry({
          id: `wrong-location-exception-${row.id}`,
          employeeId: row.employee_id,
          employeeName: row.employee_name,
          shiftId: row.shift_id,
          shootId: row.shoot_id,
          secondaryLabel: row.shoot_title ?? row.shift_title ?? "Attendance review",
          currentState: row.current_state,
          capturedAt: row.created_at,
          operationalState: "wrong_location",
          locationClassification,
          locationName: row.location_name,
          minutesFromStart: getMinutesFromStart(row.starts_at, now),
          staffingRole: row.staffing_role,
          satisfiesLeadCoverage: row.satisfies_lead_coverage,
          shootImportanceTier: row.shoot_importance_tier,
          shootImportanceOverrideTier: row.shoot_importance_override_tier,
          staffingRisk: true
        })
      );
    }
  }

  for (const row of scheduledRows.rows) {
    const startsAt = new Date(row.starts_at);
    const endsAt = new Date(row.ends_at);
    if (startsAt > now || endsAt < now) {
      continue;
    }
    if (
      activeEmployeeIds.has(row.employee_id) ||
      notClockedIn.has(row.employee_id) ||
      late.has(row.employee_id) ||
      criticallyLate.has(row.employee_id) ||
      missingClockIn.has(row.employee_id) ||
      probableNoShow.has(row.employee_id)
    ) {
      continue;
    }

    const minutesFromStart = getMinutesFromStart(row.starts_at, now);
    const operationalState = classifyMissingClockInState(Math.max(minutesFromStart ?? 0, 0));
    const entry = createAttendanceEntry({
      id: `scheduled-${row.shift_id}`,
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      shiftId: row.shift_id,
      shootId: row.shoot_id,
      secondaryLabel: row.shoot_title ?? row.shift_title ?? "Expected today",
      currentState: "off_clock",
      capturedAt: null,
      operationalState,
      locationClassification: null,
      locationName: row.location_name,
      minutesFromStart,
      staffingRole: row.staffing_role,
      satisfiesLeadCoverage: row.satisfies_lead_coverage,
      shootImportanceTier: row.shoot_importance_tier,
      shootImportanceOverrideTier: row.shoot_importance_override_tier
    });
    pushAttendanceEntry(notClockedIn, entry);
    if (operationalState === "missing_clock_in") {
      pushAttendanceEntry(missingClockIn, entry);
    } else if (operationalState === "late") {
      pushAttendanceEntry(late, entry);
    } else if (operationalState === "critically_late") {
      pushAttendanceEntry(criticallyLate, entry);
    } else if (operationalState === "probable_no_show") {
      pushAttendanceEntry(probableNoShow, entry);
      pushAttendanceEntry(missing, entry);
    }
  }

  const sortedClockedIn = sortAttendanceEntries([...clockedIn.values()]);
  const sortedGraceWindow = sortAttendanceEntries([...graceWindow.values()]);
  const sortedNotClockedIn = sortAttendanceEntries([...notClockedIn.values()]);
  const sortedLate = sortAttendanceEntries([...late.values()]);
  const sortedCriticallyLate = sortAttendanceEntries([...criticallyLate.values()]);
  const sortedMissingClockIn = sortAttendanceEntries([...missingClockIn.values()]);
  const sortedProbableNoShow = sortAttendanceEntries([...probableNoShow.values()]);
  const sortedMissing = sortAttendanceEntries([...missing.values()]);
  const sortedWrongLocation = sortAttendanceEntries([...wrongLocation.values()]);
  const sortedAssignedButMissing = sortAttendanceEntries(assignedButMissing);

  return {
    visible: true,
    summary: {
      clocked_in_count: clockedIn.size,
      grace_window_count: graceWindow.size,
      not_clocked_in_count: notClockedIn.size,
      late_count: late.size,
      critically_late_count: criticallyLate.size,
      missing_clock_in_count: missingClockIn.size,
      probable_no_show_count: probableNoShow.size,
      missing_count: sortedMissing.length,
      wrong_location_count: wrongLocation.size,
      staffing_risk_count: countStaffingRiskEntries([
        ...sortedGraceWindow,
        ...sortedNotClockedIn,
        ...sortedLate,
        ...sortedCriticallyLate,
        ...sortedMissingClockIn,
        ...sortedProbableNoShow,
        ...sortedWrongLocation
      ])
    },
    clocked_in: {
      count: clockedIn.size,
      items: sortedClockedIn.slice(0, 5)
    },
    grace_window: {
      count: graceWindow.size,
      items: sortedGraceWindow.slice(0, 5)
    },
    not_clocked_in: {
      count: notClockedIn.size,
      items: sortedNotClockedIn.slice(0, 5)
    },
    late: {
      count: late.size,
      items: sortedLate.slice(0, 5)
    },
    critically_late: {
      count: criticallyLate.size,
      items: sortedCriticallyLate.slice(0, 5)
    },
    missing_clock_in: {
      count: missingClockIn.size,
      items: sortedMissingClockIn.slice(0, 5)
    },
    probable_no_show: {
      count: probableNoShow.size,
      items: sortedProbableNoShow.slice(0, 5)
    },
    missing: {
      count: sortedMissing.length,
      items: sortedMissing.slice(0, 5)
    },
    wrong_location: {
      count: wrongLocation.size,
      items: sortedWrongLocation.slice(0, 5)
    },
    in_office: {
      count: inOffice.length,
      items: sortAttendanceEntries(inOffice).slice(0, 5)
    },
    in_field: {
      count: inField.length,
      items: sortAttendanceEntries(inField).slice(0, 5)
    },
    assigned_but_missing: {
      count: sortedAssignedButMissing.length,
      items: sortedAssignedButMissing.slice(0, 5)
    }
  };
}

function formatStartedLabel(value: string | null) {
  if (!value) {
    return null;
  }
  return `Since ${new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function resolveOperationalStateFromPunch(
  timingStatus: string | null,
  direction: "in" | "out" | null
): OperationalAttendanceState {
  if (direction === "out") {
    return "on_time";
  }
  const normalized = String(timingStatus ?? "").trim().toLowerCase();
  switch (normalized) {
    case "early":
    case "early_grace":
    case "early_exception":
      return "early";
    case "grace_window":
      return "grace_window";
    case "late":
    case "late_warning":
      return "late";
    case "critically_late":
      return "critically_late";
    default:
      return "on_time";
  }
}

function resolveOperationalStateFromException(row: AttendanceExceptionRow): OperationalAttendanceState | null {
  if (isOperationalAttendanceState(row.classification)) {
    return row.classification;
  }
  const normalized = String(row.classification ?? "").trim().toLowerCase();
  if (normalized === "late_warning") {
    return "late";
  }
  switch (row.exception_type) {
    case "LATE_CLOCK_IN_WARNING":
      return "late";
    case "LATE_CLOCK_IN":
      return "critically_late";
    case "MISSING_CLOCK_IN":
    case "MISSED_CLOCK_IN":
      return "missing_clock_in";
    case "NO_SHOW_SUSPECTED":
      return "probable_no_show";
    case "OUTSIDE_GEOFENCE_PUNCH":
      return "wrong_location";
    default:
      return null;
  }
}

function resolveActiveLocationClassification(row: ActivePresenceRow): OperationalLocationClassification | null {
  if (
    row.work_state !== "photography" ||
    row.observation_state !== "photography" ||
    typeof row.shoot_location_lat !== "number" ||
    typeof row.shoot_location_lng !== "number"
  ) {
    return row.work_state === "office_drive" ? "valid_on_site" : null;
  }
  const evaluation = evaluatePunchLocation({
    targetLat: row.shoot_location_lat,
    targetLng: row.shoot_location_lng,
    radiusMeters: Number(row.shoot_geofence_radius_meters ?? 804),
    eventLat: row.observation_latitude ?? null,
    eventLng: row.observation_longitude ?? null,
    accuracyMeters: null,
    isAssignedContext: true
  });
  return evaluation.locationClassification;
}

function mapPresenceGeofenceClassification(value: string | null | undefined): OperationalLocationClassification | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  switch (normalized) {
    case "valid_on_site":
    case "near_site":
    case "wrong_location":
    case "outside_allowed_zone":
    case "manual_override":
    case "clock_in_pending_location_review":
      return normalized;
    case "inside_shoot_radius":
    case "inside_studio_radius":
      return "valid_on_site";
    case "inside_soft_radius":
      return "near_site";
    case "outside_soft_radius":
    case "outside_studio_radius":
      return "wrong_location";
    default:
      return null;
  }
}

function mapExceptionLocationClassification(
  classification: string | null,
  exceptionType: string
): OperationalLocationClassification | null {
  const mapped = mapPresenceGeofenceClassification(classification);
  if (mapped) {
    return mapped;
  }
  if (exceptionType === "OUTSIDE_GEOFENCE_PUNCH") {
    return "wrong_location";
  }
  if (exceptionType === "LOCATION_NOT_CAPTURED_PUNCH") {
    return "clock_in_pending_location_review";
  }
  return null;
}

function resolveShootImportanceContext(input: AttendanceContext) {
  const tier = String(input.shoot_importance_override_tier ?? input.shoot_importance_tier ?? "").trim().toLowerCase();
  return {
    bigShoot: tier === "big_shoot" || tier === "critical_shoot",
    criticalShoot: tier === "critical_shoot"
  };
}

function isRoleWeightedAttendanceContext(input: AttendanceContext) {
  const staffingRole = normalizeStaffingRole(input.staffing_role);
  return Boolean(
    isLeadOrSetupRole({
      staffingRole,
      satisfiesLeadCoverage: Boolean(input.satisfies_lead_coverage)
    }) || ["check_in", "producer"].includes(staffingRole)
  );
}

function isStaffingRiskAttendanceIssue(input: {
  state: OperationalAttendanceState;
  roleWeighted: boolean;
  bigShoot: boolean;
  criticalShoot: boolean;
}) {
  if (input.state === "probable_no_show") {
    return true;
  }
  if (input.state === "wrong_location" || input.state === "critically_late") {
    return input.roleWeighted || input.bigShoot || input.criticalShoot;
  }
  if (input.state === "late" || input.state === "missing_clock_in") {
    return input.roleWeighted || input.criticalShoot;
  }
  if (input.state === "grace_window") {
    return input.roleWeighted && (input.bigShoot || input.criticalShoot);
  }
  return false;
}

function getMinutesFromStart(value: string | null, now: Date) {
  if (!value) {
    return null;
  }
  return Math.max(0, Math.floor((now.getTime() - new Date(value).getTime()) / 60_000));
}

function createAttendanceEntry(input: {
  id: string;
  employeeId: string;
  employeeName: string;
  shiftId: string | null;
  shootId: string | null;
  secondaryLabel: string | null;
  currentState: PresenceState;
  capturedAt: string | null;
  operationalState: OperationalAttendanceState;
  locationClassification: OperationalLocationClassification | null;
  locationName?: string | null;
  minutesFromStart?: number | null;
  startedLabel?: string | null;
  staffingRole?: string | null;
  satisfiesLeadCoverage?: boolean | null;
  shootImportanceTier?: string | null;
  shootImportanceOverrideTier?: string | null;
  staffingRisk?: boolean;
}): HomeAttendanceAwarenessEntry {
  const importance = resolveShootImportanceContext({
    shoot_importance_tier: input.shootImportanceTier,
    shoot_importance_override_tier: input.shootImportanceOverrideTier
  });
  const roleWeighted = isRoleWeightedAttendanceContext({
    staffing_role: input.staffingRole,
    satisfies_lead_coverage: input.satisfiesLeadCoverage
  });
  const staffingRisk =
    input.staffingRisk ??
    isStaffingRiskAttendanceIssue({
      state: input.operationalState,
      roleWeighted,
      bigShoot: importance.bigShoot,
      criticalShoot: importance.criticalShoot
    });
  const severity = classifyOperationalSeverity({
    state: input.operationalState,
    locationClassification: input.locationClassification,
    roleWeighted,
    staffingRisk,
    bigShoot: importance.bigShoot,
    criticalShoot: importance.criticalShoot
  });
  const locationLabel =
    input.locationClassification && input.locationClassification !== "valid_on_site"
      ? humanizeOperationalLocation(input.locationClassification)
      : null;
  return {
    id: input.id,
    employee_id: input.employeeId,
    employee_name: input.employeeName,
    shift_id: input.shiftId,
    shoot_id: input.shootId,
    primary_label: input.employeeName,
    secondary_label: input.secondaryLabel,
    supporting_label: buildAttendanceSupportingLabel({
      state: input.operationalState,
      minutesFromStart: input.minutesFromStart ?? null,
      startedLabel: input.startedLabel ?? null,
      locationName: input.locationName ?? null,
      locationLabel,
      staffingRisk
    }),
    current_state: input.currentState,
    captured_at: input.capturedAt,
    operational_state: input.operationalState,
    severity,
    severity_label: operationalSeverityLabel(severity),
    location_classification: input.locationClassification,
    location_label: locationLabel,
    staffing_risk: staffingRisk,
    minutes_from_start: input.minutesFromStart ?? null
  };
}

function buildAttendanceSupportingLabel(input: {
  state: OperationalAttendanceState;
  minutesFromStart: number | null;
  startedLabel: string | null;
  locationName: string | null;
  locationLabel: string | null;
  staffingRisk: boolean;
}) {
  const parts: string[] = [];
  if (input.state !== "on_time") {
    parts.push(humanizeOperationalAttendanceState(input.state));
  }
  if (typeof input.minutesFromStart === "number" && ["late", "critically_late", "missing_clock_in", "probable_no_show"].includes(input.state)) {
    if (input.minutesFromStart > 0) {
      parts.push(`${input.minutesFromStart}m past start`);
    } else if (input.state === "missing_clock_in") {
      parts.push("Start time reached");
    }
  }
  if (input.locationLabel) {
    parts.push(input.locationLabel);
  } else if (input.locationName && input.state !== "on_time" && input.state !== "early" && input.state !== "grace_window") {
    parts.push(input.locationName);
  }
  if (input.startedLabel && parts.length < 2) {
    parts.push(input.startedLabel);
  }
  if (input.staffingRisk) {
    parts.push("Staffing risk");
  }
  return parts.filter(Boolean).slice(0, 3).join(" | ") || null;
}

function pushAttendanceEntry(map: Map<string, HomeAttendanceAwarenessEntry>, entry: HomeAttendanceAwarenessEntry) {
  const current = map.get(entry.employee_id);
  if (!current || compareAttendancePriority(entry, current) < 0) {
    map.set(entry.employee_id, entry);
  }
}

function compareAttendancePriority(left: HomeAttendanceAwarenessEntry, right: HomeAttendanceAwarenessEntry) {
  const severityDelta = severityRank(right.severity) - severityRank(left.severity);
  if (severityDelta !== 0) {
    return severityDelta;
  }
  const staffingRiskDelta = Number(right.staffing_risk) - Number(left.staffing_risk);
  if (staffingRiskDelta !== 0) {
    return staffingRiskDelta;
  }
  const minuteDelta = (right.minutes_from_start ?? -1) - (left.minutes_from_start ?? -1);
  if (minuteDelta !== 0) {
    return minuteDelta;
  }
  const timeDelta = new Date(right.captured_at ?? 0).getTime() - new Date(left.captured_at ?? 0).getTime();
  if (timeDelta !== 0) {
    return timeDelta;
  }
  return left.employee_name.localeCompare(right.employee_name);
}

function sortAttendanceEntries(items: HomeAttendanceAwarenessEntry[]) {
  return [...items].sort(compareAttendancePriority);
}

function severityRank(value: OperationalAttendanceSeverity) {
  switch (value) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

function countStaffingRiskEntries(items: HomeAttendanceAwarenessEntry[]) {
  return new Set(items.filter((item) => item.staffing_risk).map((item) => item.employee_id)).size;
}
