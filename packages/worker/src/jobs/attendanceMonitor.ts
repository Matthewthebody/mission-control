import {
  autoCloseTimeClockSessionForShift,
  isWithinTimeClockSoftWarningRadius
} from "@pmc/timeclock-core/timeClock";
import { pool } from "../db.js";

const ATTENDANCE_POLICY = {
  preShiftReminderMinutes: 15,
  missingClockInMinutes: 0,
  lateWarningMinutes: 6,
  lateThresholdMinutes: 16,
  noShowSuspectedMinutes: 20,
  staffingRiskLeadMinutes: 10,
  autoCloseMinutes: 45
} as const;

const VALID_ON_SITE_RADIUS_MILES = 500 / 5280;
const SETUP_PHOTO_REMINDER_THRESHOLD_MINUTES = 30;
const CLOSEOUT_FOLLOW_UP_THRESHOLD_HOURS = 2;
const END_OF_DAY_ESCALATION_THRESHOLD_MINUTES = 90;
const COMPLIANCE_DIGEST_MIN_OPEN_ITEMS = 3;
const READY_TO_SHOOT_REMINDER_THRESHOLD_MINUTES = 20;
const READY_TO_SHOOT_MANAGER_ESCALATION_MINUTES = 10;
const READY_TO_SHOOT_WINDOW_AFTER_START_MINUTES = 15;

function normalizeStaffingRole(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function resolveShiftImportanceTier(shift: any) {
  const override = String(shift.shoot_importance_override_tier ?? "").trim().toLowerCase();
  if (override === "critical_shoot" || override === "big_shoot" || override === "elevated" || override === "standard") {
    return override;
  }
  if (Boolean(shift.big_shoot_manual_override)) {
    return "big_shoot";
  }
  if (shift.flagship_priority_account_flag || shift.first_year_customer_flag || shift.weather_travel_risk_flag) {
    return "elevated";
  }
  return "standard";
}

function isCriticalAttendanceRole(shift: any, fieldCoverageCountByShoot: Map<string, number>) {
  const staffingRole = normalizeStaffingRole(shift.staffing_role);
  const onlyPhotographerAtLocation =
    Boolean(shift.shoot_id) &&
    ["lead_photographer", "senior_photographer", "photographer"].includes(staffingRole) &&
    Number(fieldCoverageCountByShoot.get(String(shift.shoot_id)) ?? 0) <= 1;
  return (
    Boolean(shift.satisfies_lead_coverage) ||
    onlyPhotographerAtLocation ||
    ["lead_photographer", "senior_photographer", "check_in", "producer"].includes(staffingRole)
  );
}

function buildAttendanceStateNote(input: { state: "missing_clock_in" | "late" | "critically_late" | "probable_no_show"; minutesPastStart: number }) {
  if (input.state === "missing_clock_in") {
    return "Scheduled start reached without a valid clock-in.";
  }
  if (input.state === "late") {
    return `No valid clock-in ${input.minutesPastStart} minutes after the scheduled start.`;
  }
  if (input.state === "critically_late") {
    return `No valid clock-in ${input.minutesPastStart} minutes after the scheduled start. Critically late coverage risk is rising.`;
  }
  return `No valid clock-in ${input.minutesPastStart} minutes after the scheduled start. Probable no-show risk now needs same-day intervention.`;
}

function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const lat1 = toRadians(aLat);
  const lat2 = toRadians(bLat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const angle = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return earthRadiusMiles * (2 * Math.atan2(Math.sqrt(angle), Math.sqrt(1 - angle)));
}

function getShiftShowtime(shift: any) {
  return shift.shoot_showtime ? new Date(shift.shoot_showtime) : shift.shoot_start_time ? new Date(shift.shoot_start_time) : new Date(shift.starts_at);
}

function classifyPresenceMiss(input: {
  shift: any;
  observation?: any | null;
}) {
  if (
    input.observation &&
    typeof input.observation.latitude === "number" &&
    typeof input.observation.longitude === "number" &&
    typeof input.shift.location_lat === "number" &&
    typeof input.shift.location_lng === "number"
  ) {
    const distanceMiles = haversineMiles(
      Number(input.shift.location_lat),
      Number(input.shift.location_lng),
      Number(input.observation.latitude),
      Number(input.observation.longitude)
    );
    if (distanceMiles <= VALID_ON_SITE_RADIUS_MILES) {
      return {
        alertType: "likely_present_missing_clock_in" as const,
        geofenceClassification: "inside_shoot_radius",
        distanceMiles
      };
    }
    if (
      isWithinTimeClockSoftWarningRadius({
        distanceMiles,
        accuracyMeters: typeof input.observation.accuracy_meters === "number" ? input.observation.accuracy_meters : null
      })
    ) {
      return {
        alertType: "likely_present_missing_clock_in" as const,
        geofenceClassification: "inside_soft_radius",
        distanceMiles
      };
    }
    return {
      alertType: "assigned_but_missing" as const,
      geofenceClassification: "outside_soft_radius",
      distanceMiles
    };
  }

  return {
    alertType: "assigned_but_missing" as const,
    geofenceClassification: "unknown",
    distanceMiles: null
  };
}

function requiresSetupPhotoReminder(shift: any) {
  if (String(shift.shift_kind) !== "shoot" || !shift.shoot_id) {
    return false;
  }
  return Boolean(shift.satisfies_lead_coverage) || String(shift.staffing_role ?? "") === "senior_photographer";
}

export async function queueReadyToShootPrompts(client: any, tenantId: string) {
  const { rows } = await client.query(
    `
      SELECT
        s.tenant_id,
        s.id AS shoot_id,
        s.shoot_code,
        s.title,
        s.showtime::text AS shoot_showtime,
        s.start_time::text AS shoot_start_time,
        s.importance_override_tier::text AS shoot_importance_override_tier,
        s.big_shoot_manual_override,
        s.first_year_customer_flag,
        s.flagship_priority_account_flag,
        s.weather_travel_risk_flag,
        MIN(ws.id::text) FILTER (
          WHERE ws.satisfies_lead_coverage
             OR ws.staffing_role::text IN ('lead_photographer', 'senior_photographer')
        ) AS lead_shift_id,
        MIN(ws.assigned_user_id::text) FILTER (
          WHERE ws.satisfies_lead_coverage
             OR ws.staffing_role::text IN ('lead_photographer', 'senior_photographer')
        ) AS lead_assigned_user_id,
        MIN(ws.manager_user_id::text) FILTER (
          WHERE ws.satisfies_lead_coverage
             OR ws.staffing_role::text IN ('lead_photographer', 'senior_photographer')
        ) AS lead_manager_user_id,
        MIN(ws.department::text) FILTER (
          WHERE ws.satisfies_lead_coverage
             OR ws.staffing_role::text IN ('lead_photographer', 'senior_photographer')
        ) AS lead_department,
        ARRAY_REMOVE(
          ARRAY_AGG(
            DISTINCT CASE
              WHEN ws.satisfies_lead_coverage OR ws.staffing_role::text IN ('lead_photographer', 'senior_photographer')
              THEN ws.assigned_user_id::text
              ELSE NULL
            END
          ),
          NULL
        ) AS lead_user_ids,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT ws.manager_user_id::text), NULL) AS manager_user_ids
      FROM shoot s
      JOIN work_shift ws
        ON ws.tenant_id = s.tenant_id
       AND ws.shoot_id = s.id
       AND ws.cancelled_at IS NULL
       AND ws.status = 'published'
      JOIN app_user au
        ON au.id = ws.assigned_user_id
       AND au.tenant_id = ws.tenant_id
       AND au.status = 'active'
      WHERE s.tenant_id = $1
        AND s.shoot_date = CURRENT_DATE
        AND COALESCE(s.lead_confirmed_ready, false) = false
        AND COALESCE(s.status::text, '') NOT IN ('CANCELLED', 'COMPLETE', 'SHOT_COMPLETE', 'POST_PRODUCTION')
      GROUP BY
        s.tenant_id,
        s.id,
        s.shoot_code,
        s.title,
        s.showtime,
        s.start_time,
        s.importance_override_tier,
        s.big_shoot_manual_override,
        s.first_year_customer_flag,
        s.flagship_priority_account_flag,
        s.weather_travel_risk_flag
      HAVING COUNT(*) FILTER (
        WHERE ws.satisfies_lead_coverage
           OR ws.staffing_role::text IN ('lead_photographer', 'senior_photographer')
      ) > 0
    `,
    [tenantId]
  );

  const now = new Date();
  for (const shoot of rows) {
    const startAt = shoot.shoot_start_time
      ? new Date(shoot.shoot_start_time)
      : shoot.shoot_showtime
        ? new Date(shoot.shoot_showtime)
        : null;
    if (!startAt || Number.isNaN(startAt.getTime())) {
      continue;
    }

    const minutesUntilStart = Math.round((startAt.getTime() - now.getTime()) / 60000);
    const inReminderWindow =
      minutesUntilStart <= READY_TO_SHOOT_REMINDER_THRESHOLD_MINUTES &&
      minutesUntilStart > READY_TO_SHOOT_MANAGER_ESCALATION_MINUTES;
    const inEscalationWindow =
      minutesUntilStart <= READY_TO_SHOOT_MANAGER_ESCALATION_MINUTES &&
      minutesUntilStart >= -READY_TO_SHOOT_WINDOW_AFTER_START_MINUTES;
    const priorityTier = resolveShiftImportanceTier(shoot);
    const actionHash = `#operations/shoots?shoot=${shoot.shoot_id}`;

    if (inReminderWindow && Array.isArray(shoot.lead_user_ids) && shoot.lead_user_ids.length) {
      await queueNotification(client, {
        tenantId,
        recipientUserIds: shoot.lead_user_ids,
        shiftId: shoot.lead_shift_id ?? null,
        shootId: shoot.shoot_id,
        notificationType: "shoot.ready_to_shoot_reminder",
        title: `Ready to Shoot check-in for ${shoot.title}`,
        body: "Confirm when your crew is present and setup is ready to begin.",
        priority: "high",
        dedupe: `ready-to-shoot-reminder:${shoot.shoot_id}:${dateBucket(now)}`,
        deepLink: actionHash
      });
    }

    if (inEscalationWindow && shoot.lead_assigned_user_id) {
      const recipients = new Set<string>(Array.isArray(shoot.manager_user_ids) ? shoot.manager_user_ids : []);
      const escalationRecipients = await findEscalationRecipients(client, {
        tenant_id: shoot.tenant_id,
        manager_user_id: shoot.lead_manager_user_id ?? null,
        shoot_id: shoot.shoot_id,
        assigned_user_id: shoot.lead_assigned_user_id,
        department: shoot.lead_department ?? "schools"
      }, {
        eventCode: "shoot.ready_to_shoot_missing",
        staffingRisk: true,
        priorityTier
      });
      for (const recipient of escalationRecipients) {
        recipients.add(recipient);
      }

      if (recipients.size) {
        await queueNotification(client, {
          tenantId,
          recipientUserIds: [...recipients],
          shiftId: shoot.lead_shift_id ?? null,
          shootId: shoot.shoot_id,
          notificationType: "shoot.ready_to_shoot_missing",
          title: `Lead ready confirmation missing for ${shoot.title}`,
          body: "Start time is approaching and Ready to Shoot has not been submitted.",
          priority: "critical",
          dedupe: `ready-to-shoot-missing:${shoot.shoot_id}:${dateBucket(now)}`,
          deepLink: actionHash
        });
      }
    }
  }
}

async function insertAuditLog(client: any, input: {
  tenantId: string;
  actorUserId?: string | null;
  targetUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await client.query(
    `
      INSERT INTO audit_log (tenant_id, actor_user_id, target_user_id, action, entity_type, entity_id, metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
    `,
    [
      input.tenantId,
      input.actorUserId ?? null,
      input.targetUserId ?? null,
      input.action,
      input.entityType,
      input.entityId ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
}

async function updateShiftAttendanceState(client: any, input: {
  shiftId: string;
  state: string;
  note: string;
}) {
  await client.query(
    `
      UPDATE work_shift
      SET attendance_state = $2::attendance_state,
          attendance_state_note = $3,
          attendance_state_updated_at = now()
      WHERE id = $1
    `,
    [input.shiftId, input.state, input.note]
  );
}

async function createAppEvent(client: any, input: {
  tenantId: string;
  eventType: string;
  aggregateType: string;
  aggregateId?: string | null;
  payload: Record<string, unknown>;
  dedupeKey: string;
}) {
  await client.query(
    `
      INSERT INTO app_event (tenant_id, event_type, aggregate_type, aggregate_id, payload, dedupe_key)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6)
      ON CONFLICT (tenant_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL
      DO NOTHING
    `,
    [input.tenantId, input.eventType, input.aggregateType, input.aggregateId ?? null, JSON.stringify(input.payload), input.dedupeKey]
  );
}

async function queueNotification(client: any, input: {
  tenantId: string;
  recipientUserIds: string[];
  shiftId?: string | null;
  shootId?: string | null;
  attendanceExceptionId?: string | null;
  notificationType: string;
  title: string;
  body: string;
  priority: "normal" | "high" | "critical";
  dedupe: string;
  deepLink?: string | null;
}) {
  const channels =
    input.priority === "critical"
      ? ["in_app", "push", "sms", "email"]
      : input.priority === "high"
        ? ["in_app", "push", "email"]
        : ["in_app"];

  for (const recipientUserId of input.recipientUserIds) {
    for (const channel of channels) {
      await createAppEvent(client, {
        tenantId: input.tenantId,
        eventType: "notification.dispatch",
        aggregateType: "ops_notification",
        aggregateId: input.shiftId ?? null,
        dedupeKey: `notify:${input.notificationType}:${channel}:${recipientUserId}:${input.dedupe}`,
        payload: {
          tenant_id: input.tenantId,
          recipient_user_id: recipientUserId,
          shift_id: input.shiftId ?? null,
          shoot_id: input.shootId ?? null,
          attendance_exception_id: input.attendanceExceptionId ?? null,
          notification_type: input.notificationType,
          channel,
          priority: input.priority,
          title: input.title,
          body: input.body,
          deep_link: input.deepLink ?? (input.shiftId ? `/attendance/shifts/${input.shiftId}` : "/attendance"),
          metadata: {
            dedupe: input.dedupe
          }
        }
      });
    }
  }
}

async function getActiveTimeClockStateMap(client: any, tenantId: string, employeeIds: string[]) {
  if (!employeeIds.length) {
    return new Map<string, any>();
  }

  const { rows } = await client.query(
    `
      WITH active_session AS (
        SELECT *
        FROM time_session
        WHERE tenant_id = $1
          AND employee_id = ANY($2::uuid[])
          AND status IN ('open', 'needs_end_of_day_confirmation')
      )
      SELECT
        session.employee_id,
        session.id AS session_id,
        session.status::text AS session_status,
        segment.work_state::text AS current_state,
        segment.linked_shoot_id,
        segment.start_time::text AS segment_start_time
      FROM active_session session
      LEFT JOIN LATERAL (
        SELECT seg.*
        FROM time_segment seg
        WHERE seg.session_id = session.id
          AND seg.end_time IS NULL
        ORDER BY seg.start_time DESC
        LIMIT 1
      ) segment ON true
    `,
    [tenantId, employeeIds]
  );

  return new Map(rows.map((row: any) => [String(row.employee_id), row]));
}

async function getPresenceObservationMap(client: any, tenantId: string, employeeIds: string[]) {
  if (!employeeIds.length) {
    return new Map<string, any>();
  }

  const { rows } = await client.query(
    `
      SELECT *
      FROM time_clock_presence_observation
      WHERE tenant_id = $1
        AND employee_id = ANY($2::uuid[])
    `,
    [tenantId, employeeIds]
  );

  return new Map(rows.map((row: any) => [String(row.employee_id), row]));
}

async function getJobFunctionRecipients(client: any, tenantId: string, profiles: string[]) {
  if (!profiles.length) {
    return [];
  }
  const { rows } = await client.query(
    `
      SELECT DISTINCT au.id
      FROM user_job_function_profile ujp
      JOIN app_user au
        ON au.id = ujp.user_id
       AND au.tenant_id = ujp.tenant_id
      WHERE ujp.tenant_id = $1
        AND ujp.job_function_profile::text = ANY($2::text[])
        AND au.status = 'active'
    `,
    [tenantId, profiles]
  );
  return rows.map((row: any) => String(row.id));
}

async function getLeadershipRecipients(client: any, tenantId: string) {
  const { rows } = await client.query(
    `
      SELECT DISTINCT au.id
      FROM user_authority_assignment uaa
      JOIN app_user au
        ON au.id = uaa.user_id
       AND au.tenant_id = uaa.tenant_id
      WHERE uaa.tenant_id = $1
        AND uaa.authority_tier IN ('super_admin', 'leadership', 'director_admin')
        AND au.status = 'active'
    `,
    [tenantId]
  );
  return rows.map((row: any) => String(row.id));
}

function dateBucket(value: Date) {
  return value.toISOString().slice(0, 10);
}

function sixHourBucket(value: Date) {
  return `${dateBucket(value)}-${Math.floor(value.getUTCHours() / 6)}`;
}

async function findRecipients(client: any, shift: any, eventCode: string) {
  const recipients = new Set<string>();
  if (shift.manager_user_id) {
    recipients.add(String(shift.manager_user_id));
  }

  const routing = await client.query(
    `
      SELECT DISTINCT au.id
      FROM notification_routing_rule nrr
      JOIN role r ON r.code = nrr.role_code
      JOIN user_role ur ON ur.role_id = r.id AND ur.tenant_id = nrr.tenant_id
      JOIN app_user au ON au.id = ur.user_id AND au.tenant_id = ur.tenant_id
      WHERE nrr.tenant_id = $1
        AND nrr.event_code = $2
        AND nrr.enabled = true
        AND au.status = 'active'
        AND (nrr.department IS NULL OR nrr.department = $3::department_code)
    `,
    [shift.tenant_id, eventCode, shift.department]
  );
  for (const row of routing.rows) {
    recipients.add(String(row.id));
  }

  if (shift.shoot_id) {
    const seniorRows = await client.query(
      `
        SELECT DISTINCT ws.assigned_user_id AS id
        FROM work_shift ws
        JOIN app_user au ON au.id = ws.assigned_user_id
        JOIN user_role ur ON ur.user_id = au.id AND ur.tenant_id = au.tenant_id
        JOIN role r ON r.id = ur.role_id
        WHERE ws.tenant_id = $1
          AND ws.shoot_id = $2
          AND ws.status = 'published'
          AND ws.cancelled_at IS NULL
          AND au.status = 'active'
          AND r.code = 'senior_photographer'
      `,
      [shift.tenant_id, shift.shoot_id]
    );
    for (const row of seniorRows.rows) {
      recipients.add(String(row.id));
    }
  }

  recipients.delete(String(shift.assigned_user_id));
  return [...recipients];
}

async function findShootLeaderRecipients(client: any, shift: any) {
  const recipients = new Set<string>();
  if (shift.manager_user_id) {
    recipients.add(String(shift.manager_user_id));
  }

  if (shift.shoot_id) {
    const { rows } = await client.query(
      `
        SELECT DISTINCT ws.assigned_user_id AS id
        FROM work_shift ws
        JOIN app_user au
          ON au.id = ws.assigned_user_id
         AND au.tenant_id = ws.tenant_id
        LEFT JOIN user_job_function_profile ujp
          ON ujp.user_id = ws.assigned_user_id
         AND ujp.tenant_id = ws.tenant_id
        WHERE ws.tenant_id = $1
          AND ws.shoot_id = $2
          AND ws.status = 'published'
          AND ws.cancelled_at IS NULL
          AND au.status = 'active'
          AND ujp.job_function_profile = 'senior_photographer'
      `,
      [shift.tenant_id, shift.shoot_id]
    );
    for (const row of rows) {
      recipients.add(String(row.id));
    }
  }

  recipients.delete(String(shift.assigned_user_id));
  return [...recipients];
}

async function findAssignedButMissingRecipients(client: any, shift: any) {
  const recipients = new Set<string>(await findShootLeaderRecipients(client, shift));
  for (const userId of await getJobFunctionRecipients(client, shift.tenant_id, ["director_of_photography"])) {
    recipients.add(userId);
  }
  if (shift.department === "schools") {
    for (const userId of await getJobFunctionRecipients(client, shift.tenant_id, ["director_of_school_photography"])) {
      recipients.add(userId);
    }
  }
  if (shift.department === "sports") {
    for (const userId of await getJobFunctionRecipients(client, shift.tenant_id, ["director_of_sports_photography"])) {
      recipients.add(userId);
    }
  }
  recipients.delete(String(shift.assigned_user_id));
  return [...recipients];
}

async function findEscalationRecipients(client: any, shift: any, input: {
  eventCode: string;
  staffingRisk: boolean;
  priorityTier: string;
}) {
  const recipients = new Set<string>(await findRecipients(client, shift, input.eventCode));
  if (input.staffingRisk && (input.priorityTier === "big_shoot" || input.priorityTier === "critical_shoot")) {
    for (const userId of await findAssignedButMissingRecipients(client, shift)) {
      recipients.add(userId);
    }
  }
  if (input.priorityTier === "critical_shoot") {
    for (const userId of await getLeadershipRecipients(client, shift.tenant_id)) {
      recipients.add(userId);
    }
  }
  recipients.delete(String(shift.assigned_user_id));
  return [...recipients];
}

async function resolvePresenceIncidents(client: any, input: {
  tenantId: string;
  employeeId: string;
  shiftId: string;
  resolvedAt: string;
  reason: string;
  alertType?: "assigned_but_missing" | "likely_present_missing_clock_in" | null;
}) {
  const { rows } = await client.query(
    `
      UPDATE time_clock_presence_incident
      SET resolution_status = 'resolved',
          resolved_at = $4::timestamptz,
          resolution_reason = $5,
          updated_at = now()
      WHERE tenant_id = $1
        AND employee_id = $2
        AND shift_id = $3
        AND resolution_status = 'open'
        AND ($6::time_presence_alert_type IS NULL OR alert_type = $6::time_presence_alert_type)
      RETURNING id, alert_type::text
    `,
    [input.tenantId, input.employeeId, input.shiftId, input.resolvedAt, input.reason, input.alertType ?? null]
  );

  for (const row of rows) {
    await insertAuditLog(client, {
      tenantId: input.tenantId,
      actorUserId: null,
      targetUserId: input.employeeId,
      action: "time_clock.presence_incident.resolved",
      entityType: "time_clock_presence_incident",
      entityId: row.id,
      metadata: {
        shift_id: input.shiftId,
        alert_type: row.alert_type,
        resolution_reason: input.reason
      }
    });
  }
}

async function createOrRefreshPresenceIncident(client: any, input: {
  tenantId: string;
  employeeId: string;
  shiftId: string;
  shootId?: string | null;
  alertType: "assigned_but_missing" | "likely_present_missing_clock_in";
  geofenceClassification: string;
  currentState: string;
  observedAt: string;
}) {
  const existing = await client.query(
    `
      SELECT id
      FROM time_clock_presence_incident
      WHERE tenant_id = $1
        AND employee_id = $2
        AND shift_id = $3
        AND alert_type = $4::time_presence_alert_type
        AND resolution_status = 'open'
      LIMIT 1
    `,
    [input.tenantId, input.employeeId, input.shiftId, input.alertType]
  );

  if (existing.rows[0]) {
    const { rows } = await client.query(
      `
        UPDATE time_clock_presence_incident
        SET geofence_classification = $2::time_presence_geofence_classification,
            current_state = $3::time_presence_state,
            last_observed_at = $4::timestamptz,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [existing.rows[0].id, input.geofenceClassification, input.currentState, input.observedAt]
    );
    return { incident: rows[0], created: false };
  }

  const previous = await client.query(
    `
      SELECT repeat_count
      FROM time_clock_presence_incident
      WHERE tenant_id = $1
        AND employee_id = $2
        AND shift_id = $3
        AND alert_type = $4::time_presence_alert_type
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [input.tenantId, input.employeeId, input.shiftId, input.alertType]
  );

  const repeatCount = Number(previous.rows[0]?.repeat_count ?? 0) + 1;
  const { rows } = await client.query(
    `
      INSERT INTO time_clock_presence_incident (
        tenant_id,
        employee_id,
        shift_id,
        shoot_id,
        alert_type,
        geofence_classification,
        current_state,
        resolution_status,
        repeat_count,
        last_observed_at,
        last_notified_at
      )
      VALUES ($1,$2,$3,$4,$5,$6::time_presence_geofence_classification,$7::time_presence_state,'open',$8,$9::timestamptz,$9::timestamptz)
      RETURNING *
    `,
    [
      input.tenantId,
      input.employeeId,
      input.shiftId,
      input.shootId ?? null,
      input.alertType,
      input.geofenceClassification,
      input.currentState,
      repeatCount,
      input.observedAt
    ]
  );

  await insertAuditLog(client, {
    tenantId: input.tenantId,
    actorUserId: null,
    targetUserId: input.employeeId,
    action: "time_clock.presence_incident.created",
    entityType: "time_clock_presence_incident",
    entityId: rows[0].id,
    metadata: {
      shift_id: input.shiftId,
      shoot_id: input.shootId ?? null,
      alert_type: input.alertType,
      geofence_classification: input.geofenceClassification,
      repeat_count: repeatCount
    }
  });

  return { incident: rows[0], created: true };
}

async function createAttendanceException(client: any, input: {
  tenantId: string;
  shiftId: string;
  shootId?: string | null;
  userId: string;
  exceptionType: string;
  severity: "normal" | "high" | "critical";
  classification?: string | null;
  notes: string;
}) {
  const existing = await client.query(
    `
      SELECT id, severity::text AS severity, classification, notes
      FROM attendance_exception
      WHERE tenant_id = $1
        AND shift_id = $2
        AND exception_type = $3
        AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [input.tenantId, input.shiftId, input.exceptionType]
  );
  if (existing.rows[0]) {
    const current = existing.rows[0];
    if (
      String(current.severity ?? "") !== input.severity ||
      String(current.classification ?? "") !== String(input.classification ?? "") ||
      String(current.notes ?? "") !== input.notes
    ) {
      const { rows } = await client.query(
        `
          UPDATE attendance_exception
          SET severity = $2::attendance_exception_severity,
              classification = $3,
              notes = $4,
              updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [current.id, input.severity, input.classification ?? null, input.notes]
      );
      return rows[0];
    }
    return current;
  }

  const { rows } = await client.query(
    `
      INSERT INTO attendance_exception (
        tenant_id, shift_id, shoot_id, user_id, exception_type, severity, classification, notes
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `,
    [input.tenantId, input.shiftId, input.shootId ?? null, input.userId, input.exceptionType, input.severity, input.classification ?? null, input.notes]
  );
  const exception = rows[0];
  await insertAuditLog(client, {
    tenantId: input.tenantId,
    actorUserId: null,
    targetUserId: input.userId,
    action: "attendance.exception.auto_created",
    entityType: "attendance_exception",
    entityId: exception.id,
    metadata: {
      exception_type: input.exceptionType,
      shift_id: input.shiftId,
      shoot_id: input.shootId ?? null,
      severity: input.severity,
      classification: input.classification ?? null
    }
  });
  return exception;
}

async function getShiftPunchStateMap(
  client: any,
  shiftIds: string[]
): Promise<Map<string, { hasIn: boolean; hasOut: boolean }>> {
  if (!shiftIds.length) {
    return new Map<string, { hasIn: boolean; hasOut: boolean }>();
  }

  const { rows } = await client.query(
    `
      SELECT
        shift_id::text AS shift_id,
        BOOL_OR(direction = 'in') AS has_in,
        BOOL_OR(direction = 'out') AS has_out
      FROM shift_punch
      WHERE shift_id = ANY($1::uuid[])
      GROUP BY shift_id
    `,
    [shiftIds]
  );

  return new Map<string, { hasIn: boolean; hasOut: boolean }>(
    rows.map((row: any) => [
      String(row.shift_id),
      {
        hasIn: Boolean(row.has_in),
        hasOut: Boolean(row.has_out)
      }
    ])
  );
}

async function getSetupPhotoShootIdSet(client: any, tenantId: string, shootIds: string[]) {
  if (!shootIds.length) {
    return new Set<string>();
  }

  const { rows } = await client.query(
    `
      SELECT DISTINCT shoot_id::text AS shoot_id
      FROM (
        SELECT shoot_id
        FROM resource_library_item
        WHERE tenant_id = $1
          AND shoot_id = ANY($2::uuid[])
          AND category = 'setup_photo'
        UNION
        SELECT shoot_id
        FROM setup_photo_upload
        WHERE tenant_id = $1
          AND shoot_id = ANY($2::uuid[])
      ) items
      WHERE shoot_id IS NOT NULL
    `,
    [tenantId, shootIds]
  );

  return new Set(rows.map((row: any) => String(row.shoot_id)));
}

async function upsertComplianceFlag(client: any, input: {
  tenantId: string;
  employeeId: string;
  shiftId?: string | null;
  shootId?: string | null;
  itemType: "missing_setup_photo";
  severity: "warning" | "high";
  dedupeKey: string;
  observedAt: string;
  metadata: Record<string, unknown>;
}) {
  const existing = await client.query(
    `
      SELECT id
      FROM time_clock_compliance_flag
      WHERE tenant_id = $1
        AND dedupe_key = $2
        AND status = 'open'
      LIMIT 1
    `,
    [input.tenantId, input.dedupeKey]
  );

  if (existing.rows[0]) {
    await client.query(
      `
        UPDATE time_clock_compliance_flag
        SET
          severity = $2::time_clock_compliance_severity,
          metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
          last_detected_at = $4::timestamptz,
          updated_at = now()
        WHERE id = $1
      `,
      [existing.rows[0].id, input.severity, JSON.stringify(input.metadata), input.observedAt]
    );
    return existing.rows[0].id as string;
  }

  const inserted = await client.query(
    `
      INSERT INTO time_clock_compliance_flag (
        tenant_id,
        employee_id,
        shift_id,
        shoot_id,
        item_type,
        severity,
        status,
        dedupe_key,
        metadata,
        first_detected_at,
        last_detected_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8::jsonb,$9::timestamptz,$9::timestamptz)
      RETURNING id
    `,
    [
      input.tenantId,
      input.employeeId,
      input.shiftId ?? null,
      input.shootId ?? null,
      input.itemType,
      input.severity,
      input.dedupeKey,
      JSON.stringify(input.metadata),
      input.observedAt
    ]
  );

  await insertAuditLog(client, {
    tenantId: input.tenantId,
    actorUserId: null,
    targetUserId: input.employeeId,
    action: "time_clock.compliance_flag.created",
    entityType: "time_clock_compliance_flag",
    entityId: inserted.rows[0].id,
    metadata: {
      item_type: input.itemType,
      dedupe_key: input.dedupeKey
    }
  });

  return inserted.rows[0].id as string;
}

async function resolveComplianceFlag(client: any, input: {
  tenantId: string;
  employeeId: string;
  shiftId?: string | null;
  shootId?: string | null;
  itemType: "missing_setup_photo";
  resolutionNote: string;
}) {
  await client.query(
    `
      UPDATE time_clock_compliance_flag
      SET
        status = 'resolved',
        resolved_at = now(),
        resolution_note = $5,
        updated_at = now()
      WHERE tenant_id = $1
        AND employee_id = $2
        AND status = 'open'
        AND item_type = $3::time_clock_compliance_item
        AND ($4::uuid IS NULL OR shift_id = $4::uuid OR shoot_id = $4::uuid)
    `,
    [input.tenantId, input.employeeId, input.itemType, input.shiftId ?? input.shootId ?? null, input.resolutionNote]
  );
}

async function createAutoCloseArtifacts(client: any, shift: any, now: Date) {
  const existingOut = await client.query(
    `
      SELECT 1
      FROM shift_punch
      WHERE shift_id = $1
        AND direction = 'out'
      LIMIT 1
    `,
    [shift.id]
  );
  if (existingOut.rows[0]) {
    return;
  }

  const latestIn = await client.query(
    `
      SELECT *
      FROM shift_punch
      WHERE shift_id = $1
        AND direction = 'in'
      ORDER BY client_timestamp DESC
      LIMIT 1
    `,
    [shift.id]
  );
  if (!latestIn.rows[0]) {
    return;
  }

  let statusEventId: string | null = null;
  if (shift.shoot_id) {
    const eventInsert = await client.query(
      `
        INSERT INTO status_event (
          tenant_id, shoot_id, user_id, type, captured_at, geofence_status, metadata
        )
        VALUES ($1,$2,$3,'CLOCK_OUT',$4,'unknown',$5::jsonb)
        RETURNING id, captured_at
      `,
      [shift.tenant_id, shift.shoot_id, shift.assigned_user_id, now.toISOString(), JSON.stringify({ auto_closed: true, shift_id: shift.id })]
    );
    statusEventId = eventInsert.rows[0].id;
    await client.query(
      `
        UPDATE time_entry
        SET clock_out_event_id = $2,
            clock_out_at = $3,
            minutes_worked = GREATEST(0, ROUND(EXTRACT(EPOCH FROM ($3::timestamptz - clock_in_at)) / 60.0)),
            gross_minutes = GREATEST(0, ROUND(EXTRACT(EPOCH FROM ($3::timestamptz - clock_in_at)) / 60.0)),
            break_deduction_minutes = CASE
              WHEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM ($3::timestamptz - clock_in_at)) / 60.0)) > 300 THEN 30
              ELSE 0
            END,
            break_deduction_applied = CASE
              WHEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM ($3::timestamptz - clock_in_at)) / 60.0)) > 300 THEN true
              ELSE false
            END,
            break_deduction_source = CASE
              WHEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM ($3::timestamptz - clock_in_at)) / 60.0)) > 300 THEN 'auto_30_after_5h'
              ELSE 'none'
            END,
            payable_minutes = CASE
              WHEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM ($3::timestamptz - clock_in_at)) / 60.0)) > 300
                THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM ($3::timestamptz - clock_in_at)) / 60.0)) - 30
              ELSE GREATEST(0, ROUND(EXTRACT(EPOCH FROM ($3::timestamptz - clock_in_at)) / 60.0))
            END,
            approved_payable_minutes = CASE
              WHEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM ($3::timestamptz - clock_in_at)) / 60.0)) > 300
                THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM ($3::timestamptz - clock_in_at)) / 60.0)) - 30
              ELSE GREATEST(0, ROUND(EXTRACT(EPOCH FROM ($3::timestamptz - clock_in_at)) / 60.0))
            END,
            attendance_state = 'missed_clock_out',
            payroll_state = 'exception_review',
            updated_at = now()
        WHERE shoot_id = $1
          AND user_id = $4
          AND clock_out_at IS NULL
      `,
      [shift.shoot_id, statusEventId, now.toISOString(), shift.assigned_user_id]
    );
  }

  await client.query(
    `
      INSERT INTO shift_punch (
        tenant_id, shift_id, shoot_id, user_id, direction, source, status_event_id, client_timestamp, geofence_status, gps_confidence,
        unscheduled, requires_approval, approval_state, reason_code, notes, high_priority, auto_closed
      )
      VALUES ($1,$2,$3,$4,'out','system',$5,$6,'unknown','outside',false,true,'pending','auto_close','System auto-closed shift after scheduled end + 45 minutes',true,true)
    `,
    [shift.tenant_id, shift.id, shift.shoot_id ?? null, shift.assigned_user_id, statusEventId, now.toISOString()]
  );
  await autoCloseTimeClockSessionForShift(client, {
    tenantId: shift.tenant_id,
    employeeId: shift.assigned_user_id,
    shiftId: shift.id,
    shootId: shift.shoot_id ?? null,
    locationId: shift.location_id ?? null,
    capturedAt: now.toISOString()
  });
  const autoClosedPunch = (
    await client.query(
      `
        SELECT id
        FROM shift_punch
        WHERE shift_id = $1
          AND direction = 'out'
          AND auto_closed = true
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [shift.id]
    )
  ).rows[0];
  await insertAuditLog(client, {
    tenantId: shift.tenant_id,
    actorUserId: null,
    targetUserId: shift.assigned_user_id,
    action: "attendance.punch.auto_closed",
    entityType: "shift_punch",
    entityId: autoClosedPunch?.id ?? null,
    metadata: {
      shift_id: shift.id,
      shoot_id: shift.shoot_id ?? null,
      auto_closed: true
    }
  });

  const exception = await createAttendanceException(client, {
    tenantId: shift.tenant_id,
    shiftId: shift.id,
    shootId: shift.shoot_id,
    userId: shift.assigned_user_id,
    exceptionType: "AUTO_CLOSED_SHIFT",
    severity: "high",
    notes: "Shift auto-closed because no manual punch-out was captured within 45 minutes of the scheduled end."
  });
  await updateShiftAttendanceState(client, {
    shiftId: shift.id,
    state: "missed_clock_out",
    note: "Shift auto-closed because no manual clock-out was captured."
  });

  const recipients = await findRecipients(client, shift, "attendance.auto_closed");
  await queueNotification(client, {
    tenantId: shift.tenant_id,
    recipientUserIds: recipients,
    shiftId: shift.id,
    shootId: shift.shoot_id,
    attendanceExceptionId: exception.id,
    notificationType: "attendance.auto_closed",
    title: `Auto-closed shift for ${shift.title}`,
    body: `${shift.title} was auto-closed for ${shift.assigned_user_name}. Manager review is required.`,
    priority: "high",
    dedupe: `auto-close:${shift.id}`
  });
}

// G4 slice 1: ranked reminder ladders over the SAME compliance flags this sweep
// already scans (never a parallel pipeline). Stage state lives in the flag's
// metadata jsonb (laborSweep's monotonic-stage-gate pattern, no new table); a
// stage fires at most once per flag, escalating employee → lead → leadership.
type ComplianceReminderStage = { key: string; afterMinutes: number };

const CLOSEOUT_REMINDER_LADDER: ComplianceReminderStage[] = [
  { key: "employee_follow_up", afterMinutes: CLOSEOUT_FOLLOW_UP_THRESHOLD_HOURS * 60 },
  { key: "lead_follow_up", afterMinutes: 240 },
  { key: "leadership_follow_up", afterMinutes: 480 }
];

const END_OF_DAY_REMINDER_LADDER: ComplianceReminderStage[] = [
  { key: "leadership_escalation", afterMinutes: END_OF_DAY_ESCALATION_THRESHOLD_MINUTES },
  { key: "owner_escalation", afterMinutes: 360 }
];

function resolveDueComplianceStage(
  stages: ComplianceReminderStage[],
  firstDetectedAt: string,
  lastStageKey: string | null
): { stage: ComplianceReminderStage; rank: number } | null {
  const ageMinutes = (Date.now() - new Date(firstDetectedAt).getTime()) / 60_000;
  const lastRank = lastStageKey ? stages.findIndex((stage) => stage.key === lastStageKey) + 1 : 0;
  let due: { stage: ComplianceReminderStage; rank: number } | null = null;
  stages.forEach((stage, index) => {
    if (ageMinutes >= stage.afterMinutes) {
      due = { stage, rank: index + 1 };
    }
  });
  return due && (due as { rank: number }).rank > lastRank ? due : null;
}

async function recordComplianceReminderStage(client: any, flagId: string, stageKey: string) {
  await client.query(
    `
      UPDATE time_clock_compliance_flag
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'last_reminder_stage', $2::text,
            'last_reminder_at', now()::text,
            'reminder_count', COALESCE((metadata->>'reminder_count')::int, 0) + 1
          ),
          updated_at = now()
      WHERE id = $1
    `,
    [flagId, stageKey]
  );
}

async function getOwnerRecipients(client: any, tenantId: string) {
  const { rows } = await client.query(
    `
      SELECT DISTINCT au.id
      FROM app_user au
      LEFT JOIN user_authority_assignment uaa
        ON uaa.user_id = au.id AND uaa.tenant_id = au.tenant_id
      LEFT JOIN user_role ur ON ur.user_id = au.id AND ur.tenant_id = au.tenant_id
      LEFT JOIN role r ON r.id = ur.role_id
      WHERE au.tenant_id = $1
        AND au.status = 'active'
        AND (uaa.authority_tier = 'super_admin' OR r.code = 'owner_admin')
    `,
    [tenantId]
  );
  return rows.map((row: any) => String(row.id));
}

async function queueComplianceFollowUps(client: any, tenantId: string) {
  const { rows } = await client.query(
    `
      SELECT
        flag.id,
        flag.employee_id,
        flag.shift_id,
        flag.shoot_id,
        flag.item_type::text AS item_type,
        flag.first_detected_at,
        flag.metadata->>'last_reminder_stage' AS last_reminder_stage,
        employee.full_name AS employee_name,
        shift.title AS shift_title,
        shift.manager_user_id,
        shoot.title AS shoot_title
      FROM time_clock_compliance_flag flag
      JOIN app_user employee
        ON employee.id = flag.employee_id
      LEFT JOIN work_shift shift
        ON shift.id = flag.shift_id
      LEFT JOIN shoot shoot
        ON shoot.id = flag.shoot_id
      WHERE flag.tenant_id = $1
        AND flag.status = 'open'
        AND flag.item_type IN ('missing_setup_photo', 'missing_post_shoot_evaluation', 'mileage_blocked_missing_post_shoot_evaluation')
        AND flag.first_detected_at <= now() - ($2 || ' hours')::interval
    `,
    [tenantId, CLOSEOUT_FOLLOW_UP_THRESHOLD_HOURS]
  );

  for (const row of rows) {
    const due = resolveDueComplianceStage(
      CLOSEOUT_REMINDER_LADDER,
      String(row.first_detected_at),
      row.last_reminder_stage ?? null
    );
    if (!due) {
      continue;
    }
    const subject = row.shoot_title ?? row.shift_title ?? "this shoot";
    const body =
      row.item_type === "mileage_blocked_missing_post_shoot_evaluation"
        ? `Mileage is still blocked because the Post-Shoot Evaluation for ${subject} has not been submitted yet.`
        : row.item_type === "missing_post_shoot_evaluation"
          ? `Post-Shoot Evaluation is still missing for ${subject}.`
          : `Setup Photo is still missing for ${subject}.`;
    const recipients = new Set<string>([String(row.employee_id)]);
    if (due.stage.key === "lead_follow_up") {
      for (const userId of await findShootLeaderRecipients(client, {
        tenant_id: tenantId,
        shoot_id: row.shoot_id ?? null,
        manager_user_id: row.manager_user_id ?? null,
        assigned_user_id: row.employee_id
      })) {
        recipients.add(userId);
      }
    }
    if (due.stage.key === "leadership_follow_up") {
      for (const userId of await getLeadershipRecipients(client, tenantId)) {
        recipients.add(userId);
      }
    }
    await queueNotification(client, {
      tenantId,
      recipientUserIds: [...recipients],
      shiftId: row.shift_id ?? null,
      shootId: row.shoot_id ?? null,
      notificationType: "attendance.closeout_follow_up",
      title: `Closeout follow-up for ${subject}`,
      body,
      priority:
        due.stage.key !== "employee_follow_up" || row.item_type === "mileage_blocked_missing_post_shoot_evaluation"
          ? "high"
          : "normal",
      dedupe: `closeout-ladder:${row.id}:${due.stage.key}`,
      deepLink: row.shift_id ? `/attendance/shifts/${row.shift_id}` : "/compliance"
    });
    await recordComplianceReminderStage(client, String(row.id), due.stage.key);
  }
}

async function queueEndOfDayEscalations(client: any, tenantId: string) {
  const { rows } = await client.query(
    `
      SELECT
        flag.id,
        flag.employee_id,
        flag.shift_id,
        flag.shoot_id,
        flag.session_id,
        flag.first_detected_at,
        flag.metadata->>'last_reminder_stage' AS last_reminder_stage,
        employee.full_name AS employee_name,
        shift.title AS shift_title
      FROM time_clock_compliance_flag flag
      JOIN app_user employee
        ON employee.id = flag.employee_id
      LEFT JOIN work_shift shift
        ON shift.id = flag.shift_id
      WHERE flag.tenant_id = $1
        AND flag.status = 'open'
        AND flag.item_type = 'unresolved_end_of_day_confirmation'
        AND flag.first_detected_at <= now() - ($2 || ' minutes')::interval
    `,
    [tenantId, END_OF_DAY_ESCALATION_THRESHOLD_MINUTES]
  );

  const leadershipRecipients = await getLeadershipRecipients(client, tenantId);
  for (const row of rows) {
    const due = resolveDueComplianceStage(
      END_OF_DAY_REMINDER_LADDER,
      String(row.first_detected_at),
      row.last_reminder_stage ?? null
    );
    if (!due) {
      continue;
    }
    const recipients = new Set<string>([...leadershipRecipients, String(row.employee_id)]);
    if (due.stage.key === "owner_escalation") {
      // B4 (owner-ratified): payroll-blocking alerts stay owner-only IN-APP —
      // the final rung fans out to the owner, never a Teams route.
      for (const userId of await getOwnerRecipients(client, tenantId)) {
        recipients.add(userId);
      }
    }
    await queueNotification(client, {
      tenantId,
      recipientUserIds: [...recipients],
      shiftId: row.shift_id ?? null,
      shootId: row.shoot_id ?? null,
      notificationType: "attendance.end_of_day_confirmation_escalation",
      title: `End-of-day confirmation still unresolved`,
      body: `${row.employee_name} still needs an end-of-day confirmation for ${row.shift_title ?? "the latest shift"}. Payroll confidence remains blocked until it is confirmed or corrected.`,
      priority: "high",
      dedupe: `end-of-day-ladder:${row.session_id ?? row.id}:${due.stage.key}`,
      deepLink: "/compliance"
    });
    await recordComplianceReminderStage(client, String(row.id), due.stage.key);
  }
}

async function queueComplianceDigest(client: any, tenantId: string) {
  const flagCounts = await client.query(
    `
      SELECT
        COUNT(*) FILTER (WHERE status = 'open') AS open_count,
        COUNT(*) FILTER (WHERE status = 'open' AND item_type IN ('missing_setup_photo', 'missing_post_shoot_evaluation', 'mileage_blocked_missing_post_shoot_evaluation')) AS closeout_count,
        COUNT(*) FILTER (WHERE status = 'open' AND item_type = 'unresolved_end_of_day_confirmation') AS end_of_day_count
      FROM time_clock_compliance_flag
      WHERE tenant_id = $1
    `,
    [tenantId]
  );
  const openPresence = await client.query(
    `
      SELECT COUNT(*) AS open_presence_count
      FROM time_clock_presence_incident
      WHERE tenant_id = $1
        AND resolution_status = 'open'
    `,
    [tenantId]
  );

  const openCount = Number(flagCounts.rows[0]?.open_count ?? 0) + Number(openPresence.rows[0]?.open_presence_count ?? 0);
  const closeoutCount = Number(flagCounts.rows[0]?.closeout_count ?? 0);
  const endOfDayCount = Number(flagCounts.rows[0]?.end_of_day_count ?? 0);
  if (openCount < COMPLIANCE_DIGEST_MIN_OPEN_ITEMS && closeoutCount === 0 && endOfDayCount === 0) {
    return;
  }

  const recipients = await getLeadershipRecipients(client, tenantId);
  await queueNotification(client, {
    tenantId,
    recipientUserIds: recipients,
    notificationType: "attendance.compliance_digest",
    title: "Compliance review digest",
    body: `${openCount} unresolved attendance/compliance signals are open, including ${closeoutCount} closeout item${closeoutCount === 1 ? "" : "s"} and ${endOfDayCount} unresolved end-of-day confirmation${endOfDayCount === 1 ? "" : "s"}.`,
    priority: endOfDayCount > 0 ? "high" : "normal",
    dedupe: `compliance-digest:${tenantId}:${dateBucket(new Date())}`,
    deepLink: "/compliance"
  });
}

export async function runAttendanceAutomationForTenant(client: any, tenantId: string) {
  await queueComplianceFollowUps(client, tenantId);
  await queueEndOfDayEscalations(client, tenantId);
  await queueComplianceDigest(client, tenantId);
}

async function monitorAttendanceForTenantClient(client: any, tenantId: string) {
  const shifts = await client.query(
    `
      SELECT
        ws.*,
        au.full_name AS assigned_user_name,
        s.showtime AS shoot_showtime,
        s.start_time AS shoot_start_time,
        s.importance_override_tier::text AS shoot_importance_override_tier,
        s.big_shoot_manual_override,
        s.first_year_customer_flag,
        s.flagship_priority_account_flag,
        s.weather_travel_risk_flag
      FROM work_shift ws
      JOIN app_user au
        ON au.id = ws.assigned_user_id
       AND au.tenant_id = ws.tenant_id
      LEFT JOIN shoot s
        ON s.id = ws.shoot_id
       AND s.tenant_id = ws.tenant_id
      WHERE ws.tenant_id = $1
        AND ws.status = 'published'
        AND ws.cancelled_at IS NULL
        AND ws.starts_at >= now() - interval '2 days'
        AND ws.ends_at <= now() + interval '1 day'
      ORDER BY ws.starts_at ASC
    `,
    [tenantId]
  );
  const employeeIds = Array.from(
    new Set<string>(shifts.rows.map((shift: any) => String(shift.assigned_user_id)))
  );
  const shiftIds: string[] = shifts.rows.map((shift: any) => String(shift.id));
  const shootIds = Array.from(
    new Set<string>(shifts.rows.map((shift: any) => String(shift.shoot_id ?? "")).filter(Boolean))
  );
  const fieldCoverageCountByShoot = new Map<string, number>();
  for (const shift of shifts.rows) {
    const shootId = String(shift.shoot_id ?? "");
    const staffingRole = normalizeStaffingRole(shift.staffing_role);
    if (
      shootId &&
      ["lead_photographer", "senior_photographer", "photographer"].includes(staffingRole)
    ) {
      fieldCoverageCountByShoot.set(shootId, Number(fieldCoverageCountByShoot.get(shootId) ?? 0) + 1);
    }
  }
  const activeTimeClockStateMap = await getActiveTimeClockStateMap(client, tenantId, employeeIds);
  const presenceObservationMap = await getPresenceObservationMap(client, tenantId, employeeIds);
  const shiftPunchStateMap = await getShiftPunchStateMap(client, shiftIds);
  const setupPhotoShootIds = await getSetupPhotoShootIdSet(client, tenantId, shootIds);

  for (const shift of shifts.rows) {
        const shiftPunchState = shiftPunchStateMap.get(String(shift.id)) ?? { hasIn: false, hasOut: false };
        const hasIn = shiftPunchState.hasIn;
        const hasOut = shiftPunchState.hasOut;
        const startAt = new Date(shift.starts_at);
        const endAt = new Date(shift.ends_at);
        const now = new Date();
        const shootStartAt = getShiftShowtime(shift);
        const activeTimeClock = activeTimeClockStateMap.get(String(shift.assigned_user_id)) ?? null;
        const observation = presenceObservationMap.get(String(shift.assigned_user_id)) ?? null;
        const hasAnyActiveTimeClock = Boolean(activeTimeClock?.session_id) && activeTimeClock?.session_status !== "closed";
        const currentPresenceState =
          activeTimeClock?.session_status === "needs_end_of_day_confirmation"
            ? "needs_end_of_day_confirmation"
            : activeTimeClock?.current_state ?? "off_clock";
        const hasCorrectShootCoverage =
          activeTimeClock?.current_state === "photography" && String(activeTimeClock?.linked_shoot_id ?? "") === String(shift.shoot_id ?? "");
        const priorityTier = resolveShiftImportanceTier(shift);
        const criticalAttendanceRole = isCriticalAttendanceRole(shift, fieldCoverageCountByShoot);
        const staffingRiskSensitive = criticalAttendanceRole || priorityTier === "big_shoot" || priorityTier === "critical_shoot";
        const minutesPastStart = Math.max(0, Math.floor((now.getTime() - startAt.getTime()) / 60000));

        if (!hasIn && !hasAnyActiveTimeClock && now >= new Date(startAt.getTime() - ATTENDANCE_POLICY.preShiftReminderMinutes * 60000) && now < startAt) {
          await queueNotification(client, {
            tenantId: shift.tenant_id,
            recipientUserIds: [String(shift.assigned_user_id)],
            shiftId: shift.id,
            shootId: shift.shoot_id,
            notificationType: "attendance.pre_shift_reminder",
            title: `Shift starts in ${ATTENDANCE_POLICY.preShiftReminderMinutes} minutes`,
            body: `Your shift for ${shift.title} starts in ${ATTENDANCE_POLICY.preShiftReminderMinutes} minutes. Please be ready to clock in on arrival.`,
            priority: "normal",
            dedupe: `pre-shift-reminder:${shift.id}`
          });
        }

        if (requiresSetupPhotoReminder(shift) && shift.shoot_id) {
          const setupPhotoUploaded = setupPhotoShootIds.has(String(shift.shoot_id));
          if (setupPhotoUploaded) {
            await resolveComplianceFlag(client, {
              tenantId: shift.tenant_id,
              employeeId: String(shift.assigned_user_id),
              shiftId: String(shift.id),
              shootId: String(shift.shoot_id),
              itemType: "missing_setup_photo",
              resolutionNote: "Setup Photo uploaded."
            });
          } else if (now >= new Date(shootStartAt.getTime() + SETUP_PHOTO_REMINDER_THRESHOLD_MINUTES * 60000)) {
            await upsertComplianceFlag(client, {
              tenantId: shift.tenant_id,
              employeeId: String(shift.assigned_user_id),
              shiftId: String(shift.id),
              shootId: String(shift.shoot_id),
              itemType: "missing_setup_photo",
              severity: "warning",
              dedupeKey: `missing_setup_photo:${shift.id}`,
              observedAt: now.toISOString(),
              metadata: {
                source: "during_shoot_reminder",
                reminder_threshold_minutes: SETUP_PHOTO_REMINDER_THRESHOLD_MINUTES,
                message: `Setup Photo is still missing ${SETUP_PHOTO_REMINDER_THRESHOLD_MINUTES} minutes into ${shift.title}.`
              }
            });
            await queueNotification(client, {
              tenantId: shift.tenant_id,
              recipientUserIds: [String(shift.assigned_user_id)],
              shiftId: shift.id,
              shootId: shift.shoot_id,
              notificationType: "shoot.setup_photo_reminder",
              title: `Setup Photo reminder for ${shift.title}`,
              body: `Upload the Setup Photo when you have a safe moment. Clock-out will still work later, but leadership will see the missing closeout item.`,
              priority: "normal",
              dedupe: `setup-photo-reminder:${shift.id}`
            });
          }
        }

        if (!hasCorrectShootCoverage && now >= new Date(shootStartAt.getTime() - ATTENDANCE_POLICY.staffingRiskLeadMinutes * 60000) && now < shootStartAt) {
          const recipients = await findEscalationRecipients(client, shift, {
            eventCode: "attendance.staffing_risk_prestart",
            staffingRisk: staffingRiskSensitive,
            priorityTier
          });
          await queueNotification(client, {
            tenantId: shift.tenant_id,
            recipientUserIds: recipients,
            shiftId: shift.id,
            shootId: shift.shoot_id,
            notificationType: "attendance.staffing_risk_prestart",
            title: `Staffing risk for ${shift.title}`,
            body: `${shift.assigned_user_name} is still not clocked in ${ATTENDANCE_POLICY.staffingRiskLeadMinutes} minutes before shoot start.`,
            priority: "critical",
            dedupe: `staffing-risk-prestart:${shift.id}`
          });
        }

        if (!hasCorrectShootCoverage && now >= startAt) {
          await queueNotification(client, {
            tenantId: shift.tenant_id,
            recipientUserIds: [String(shift.assigned_user_id)],
            shiftId: shift.id,
            shootId: shift.shoot_id,
            notificationType: "attendance.clock_in_reminder",
            title: `Your shift has started`,
            body: `Your shift has started and you are not clocked in. Do you need to contact your manager?`,
            priority: "normal",
            dedupe: `clock-in-reminder:${shift.id}`
          });
          await updateShiftAttendanceState(client, {
            shiftId: shift.id,
            state: "pending",
            note: "Shift started without a clock-in."
          });
        }

        if (hasCorrectShootCoverage) {
          await resolvePresenceIncidents(client, {
            tenantId: shift.tenant_id,
            employeeId: String(shift.assigned_user_id),
            shiftId: String(shift.id),
            resolvedAt: now.toISOString(),
            reason: "correct_shoot_coverage_detected"
          });
        }

        if (!hasCorrectShootCoverage && now >= startAt) {
          const classification = classifyPresenceMiss({ shift, observation });
          const presenceRecipients = classification.alertType === "likely_present_missing_clock_in"
            ? await findShootLeaderRecipients(client, shift)
            : await findEscalationRecipients(client, shift, {
                eventCode: "attendance.assigned_but_missing",
                staffingRisk: staffingRiskSensitive,
                priorityTier
              });

          if (classification.alertType === "likely_present_missing_clock_in") {
            await resolvePresenceIncidents(client, {
              tenantId: shift.tenant_id,
              employeeId: String(shift.assigned_user_id),
              shiftId: String(shift.id),
              resolvedAt: now.toISOString(),
              reason: "reclassified_to_likely_present",
              alertType: "assigned_but_missing"
            });
          } else {
            await resolvePresenceIncidents(client, {
              tenantId: shift.tenant_id,
              employeeId: String(shift.assigned_user_id),
              shiftId: String(shift.id),
              resolvedAt: now.toISOString(),
              reason: "escalated_to_assigned_but_missing",
              alertType: "likely_present_missing_clock_in"
            });
          }

          const incident = await createOrRefreshPresenceIncident(client, {
            tenantId: shift.tenant_id,
            employeeId: String(shift.assigned_user_id),
            shiftId: String(shift.id),
            shootId: shift.shoot_id ?? null,
            alertType: classification.alertType,
            geofenceClassification: classification.geofenceClassification,
            currentState: currentPresenceState,
            observedAt: now.toISOString()
          });

          await queueNotification(client, {
            tenantId: shift.tenant_id,
            recipientUserIds: [String(shift.assigned_user_id)],
            shiftId: shift.id,
            shootId: shift.shoot_id,
            notificationType: "attendance.clock_in_reminder",
            title: "Your shift has started",
            body: "Your shift has started and you are not clocked in. If you are on site, clock in or send a note now.",
            priority: "normal",
            dedupe: `clock-in-reminder:${shift.id}`
          });

          const missingClockIn = await createAttendanceException(client, {
            tenantId: shift.tenant_id,
            shiftId: shift.id,
            shootId: shift.shoot_id,
            userId: shift.assigned_user_id,
            exceptionType: "MISSING_CLOCK_IN",
            severity: staffingRiskSensitive ? "high" : "normal",
            classification: "missing_clock_in",
            notes: buildAttendanceStateNote({ state: "missing_clock_in", minutesPastStart })
          });

          if (incident.created) {
            await queueNotification(client, {
              tenantId: shift.tenant_id,
              recipientUserIds: presenceRecipients,
              shiftId: shift.id,
              shootId: shift.shoot_id,
              attendanceExceptionId: missingClockIn.id,
              notificationType:
                classification.alertType === "likely_present_missing_clock_in"
                  ? "attendance.likely_present_missing_clock_in"
                  : "attendance.assigned_but_missing",
              title:
                classification.alertType === "likely_present_missing_clock_in"
                  ? `Near site, still missing clock-in: ${shift.title}`
                  : `Missing clock-in: ${shift.title}`,
              body:
                classification.alertType === "likely_present_missing_clock_in"
                  ? `${shift.assigned_user_name} appears near ${shift.title} but still has no valid clock-in.`
                  : `${shift.assigned_user_name} has not clocked in for ${shift.title}.`,
              priority: staffingRiskSensitive ? "high" : "normal",
              dedupe:
                classification.alertType === "likely_present_missing_clock_in"
                  ? `likely-present-missing-clock-in:${shift.id}`
                  : `missing-clock-in:${shift.id}`
            });
          }

          await updateShiftAttendanceState(client, {
            shiftId: shift.id,
            state: "pending",
            note: buildAttendanceStateNote({ state: "missing_clock_in", minutesPastStart })
          });

          if (minutesPastStart >= ATTENDANCE_POLICY.lateWarningMinutes) {
            const exception = await createAttendanceException(client, {
              tenantId: shift.tenant_id,
              shiftId: shift.id,
              shootId: shift.shoot_id,
              userId: shift.assigned_user_id,
              exceptionType: "LATE_CLOCK_IN_WARNING",
              severity: staffingRiskSensitive ? "high" : "normal",
              classification: "late",
              notes: buildAttendanceStateNote({ state: "late", minutesPastStart })
            });
            const recipients = await findEscalationRecipients(client, shift, {
              eventCode: "attendance.late_clock_in_warning",
              staffingRisk: staffingRiskSensitive,
              priorityTier
            });
            await queueNotification(client, {
              tenantId: shift.tenant_id,
              recipientUserIds: recipients,
              shiftId: shift.id,
              shootId: shift.shoot_id,
              attendanceExceptionId: exception.id,
              notificationType: "attendance.late_clock_in_warning",
              title: `Late arrival warning: ${shift.title}`,
              body: `${shift.assigned_user_name} is ${minutesPastStart} minutes late and still has no valid clock-in.`,
              priority: staffingRiskSensitive ? "high" : "normal",
              dedupe: `late-warning:${shift.id}`
            });
            await updateShiftAttendanceState(client, {
              shiftId: shift.id,
              state: "late_warning",
              note: buildAttendanceStateNote({ state: "late", minutesPastStart })
            });
          }

          if (minutesPastStart >= ATTENDANCE_POLICY.lateThresholdMinutes) {
            const exception = await createAttendanceException(client, {
              tenantId: shift.tenant_id,
              shiftId: shift.id,
              shootId: shift.shoot_id,
              userId: shift.assigned_user_id,
              exceptionType: "LATE_CLOCK_IN",
              severity: "critical",
              classification: "critically_late",
              notes: buildAttendanceStateNote({ state: "critically_late", minutesPastStart })
            });
            const recipients = await findEscalationRecipients(client, shift, {
              eventCode: "attendance.late_clock_in",
              staffingRisk: true,
              priorityTier
            });
            await queueNotification(client, {
              tenantId: shift.tenant_id,
              recipientUserIds: recipients,
              shiftId: shift.id,
              shootId: shift.shoot_id,
              attendanceExceptionId: exception.id,
              notificationType: "attendance.late_clock_in",
              title: `Critically late: ${shift.title}`,
              body: `${shift.assigned_user_name} is ${minutesPastStart} minutes late and execution risk is rising.`,
              priority: "critical",
              dedupe: `critically-late:${shift.id}`
            });
            await updateShiftAttendanceState(client, {
              shiftId: shift.id,
              state: "late",
              note: buildAttendanceStateNote({ state: "critically_late", minutesPastStart })
            });
          }

          if (minutesPastStart >= ATTENDANCE_POLICY.noShowSuspectedMinutes) {
            const exception = await createAttendanceException(client, {
              tenantId: shift.tenant_id,
              shiftId: shift.id,
              shootId: shift.shoot_id,
              userId: shift.assigned_user_id,
              exceptionType: "NO_SHOW_SUSPECTED",
              severity: "critical",
              classification: "probable_no_show",
              notes: buildAttendanceStateNote({ state: "probable_no_show", minutesPastStart })
            });
            const recipients = await findEscalationRecipients(client, shift, {
              eventCode: "attendance.no_show_suspected",
              staffingRisk: true,
              priorityTier
            });
            await queueNotification(client, {
              tenantId: shift.tenant_id,
              recipientUserIds: recipients,
              shiftId: shift.id,
              shootId: shift.shoot_id,
              attendanceExceptionId: exception.id,
              notificationType: "attendance.no_show_suspected",
              title: `Probable no-show: ${shift.title}`,
              body: `${shift.assigned_user_name} still has no valid clock-in ${minutesPastStart} minutes after start and may need replacement coverage.`,
              priority: "critical",
              dedupe: `probable-no-show:${shift.id}`
            });
            await updateShiftAttendanceState(client, {
              shiftId: shift.id,
              state: "no_show_suspected",
              note: buildAttendanceStateNote({ state: "probable_no_show", minutesPastStart })
            });
          }
        }

        if (hasIn) {
          await updateShiftAttendanceState(client, {
            shiftId: shift.id,
            state: hasOut ? "clocked_out" : "clocked_in",
            note: hasOut ? "Shift has a clock-out." : "Shift is actively clocked in."
          });
        }

        if (hasIn && !hasOut && now >= new Date(endAt.getTime() + ATTENDANCE_POLICY.autoCloseMinutes * 60000)) {
          await createAutoCloseArtifacts(client, shift, now);
        }
  }

  await queueReadyToShootPrompts(client, tenantId);
  await runAttendanceAutomationForTenant(client, tenantId);
}

export async function monitorAttendanceForTenant(tenantId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE pmc_app");
    await client.query("SELECT app.set_context($1::uuid, NULL::uuid)", [tenantId]);
    await monitorAttendanceForTenantClient(client, tenantId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function monitorAttendance() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE pmc_app");
    const tenants = await client.query("SELECT id FROM tenant ORDER BY created_at ASC");

    for (const tenant of tenants.rows) {
      await client.query("SELECT app.set_context($1::uuid, NULL::uuid)", [tenant.id]);
      await monitorAttendanceForTenantClient(client, tenant.id);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
