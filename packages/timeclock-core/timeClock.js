export const TIME_CLOCK_SOFT_WARNING_RADIUS_METERS = 1000;
const MAX_SOFT_WARNING_ACCURACY_SLACK_METERS = 25;

export function isWithinTimeClockSoftWarningRadius(input) {
  const parsedAccuracyMeters = Number(input.accuracyMeters ?? 0);
  const accuracySlackMeters = Math.max(
    0,
    Math.min(Number.isFinite(parsedAccuracyMeters) ? parsedAccuracyMeters : 0, MAX_SOFT_WARNING_ACCURACY_SLACK_METERS)
  );
  return input.distanceMiles <= (TIME_CLOCK_SOFT_WARNING_RADIUS_METERS + accuracySlackMeters) / 1609.344;
}

export function buildOffClockTimeClockSummary() {
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

function presenceStateFromTimeClockSummary(summary) {
  if (summary.needs_end_of_day_confirmation || summary.session_status === "needs_end_of_day_confirmation") {
    return "needs_end_of_day_confirmation";
  }
  if (summary.current_state === "off_clock") {
    return "off_clock";
  }
  return summary.current_state;
}

async function getOpenTimeSegment(client, sessionId) {
  const { rows } = await client.query(
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

async function endTimeSegment(client, segmentId, endTime) {
  const { rows } = await client.query(
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

async function insertClockEvent(client, input) {
  await client.query(
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
      input.actorType
    ]
  );
}

async function setTimeSessionStatus(client, sessionId, status) {
  const { rows } = await client.query(
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

async function getTimeClockStateSummary(client, input) {
  const { rows } = await client.query(
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

  const row = rows[0] ?? null;
  if (!row) {
    return buildOffClockTimeClockSummary();
  }

  return {
    session_id: row.active_session_id,
    session_status: row.session_status ?? "off_clock",
    current_state: row.current_work_state ?? "off_clock",
    current_segment_id: row.current_segment_id,
    current_segment_review_status: row.current_segment_review_status,
    current_linked_shoot_id: row.current_linked_shoot_id,
    current_linked_location_id: row.current_linked_location_id,
    current_segment_started_at: row.current_segment_started_at,
    needs_end_of_day_confirmation: row.session_status === "needs_end_of_day_confirmation",
    last_clock_event_at: row.last_clock_event_at
  };
}

async function upsertTimeClockPresenceObservation(client, input) {
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

async function persistPresenceObservationForEmployee(client, input) {
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

export async function autoCloseTimeClockSessionForShift(client, input) {
  const { rows } = await client.query(
    `
      SELECT ts.*
      FROM time_session ts
      LEFT JOIN time_segment seg
        ON seg.session_id = ts.id
       AND seg.end_time IS NULL
      WHERE ts.tenant_id = $1
        AND ts.employee_id = $2
        AND ts.status IN ('open', 'needs_end_of_day_confirmation')
        AND (
          ts.source_shift_id = $3
          OR seg.linked_shift_id = $3
        )
      ORDER BY
        CASE WHEN ts.status = 'open' THEN 0 ELSE 1 END,
        ts.work_date DESC,
        ts.created_at DESC
      LIMIT 1
      FOR UPDATE OF ts
    `,
    [input.tenantId, input.employeeId, input.shiftId]
  );
  const session = rows[0] ?? null;
  if (!session) {
    return null;
  }

  const openSegment = await getOpenTimeSegment(client, session.id);
  if (openSegment) {
    const endedSegment = await endTimeSegment(client, openSegment.id, input.capturedAt);
    if (endedSegment) {
      await insertClockEvent(client, {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        sessionId: session.id,
        segmentId: endedSegment.id,
        shootId: endedSegment.linked_shoot_id,
        locationId: endedSegment.linked_location_id,
        eventType: "work_state_ended",
        eventTimestamp: input.capturedAt,
        metadata: {
          source: "system_auto_close",
          ended_work_state: endedSegment.work_state
        },
        actorType: "system"
      });
    }
  }

  await insertClockEvent(client, {
    tenantId: input.tenantId,
    employeeId: input.employeeId,
    sessionId: session.id,
    shootId: openSegment?.linked_shoot_id ?? input.shootId ?? null,
    locationId: openSegment?.linked_location_id ?? input.locationId ?? null,
    eventType: "clock_out",
    eventTimestamp: input.capturedAt,
    metadata: {
      source: "system_auto_close"
    },
    actorType: "system"
  });
  await setTimeSessionStatus(client, session.id, "closed");
  await insertClockEvent(client, {
    tenantId: input.tenantId,
    employeeId: input.employeeId,
    sessionId: session.id,
    eventType: "session_closed",
    eventTimestamp: input.capturedAt,
    metadata: {
      source: "system_auto_close",
      closed_from: openSegment?.work_state ?? null
    },
    actorType: "system"
  });

  const summary = await getTimeClockStateSummary(client, {
    tenantId: input.tenantId,
    employeeId: input.employeeId
  });
  await persistPresenceObservationForEmployee(client, {
    tenantId: input.tenantId,
    employeeId: input.employeeId,
    summary,
    capturedAt: input.capturedAt,
    sourceType: "system_transition",
    linkedShiftId: input.shiftId,
    linkedShootId: input.shootId ?? null,
    linkedLocationId: input.locationId ?? null
  });

  return {
    sessionId: session.id,
    segmentId: openSegment?.id ?? null,
    timeClockState: summary
  };
}
