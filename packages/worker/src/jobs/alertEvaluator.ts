import type { PoolClient } from "pg";
import { pool } from "../db.js";

type EvaluatedShoot = {
  id: string;
  shoot_code: string;
  arrival_time: string;
  start_time: string;
  end_time_est: string;
};

type ShootStatusEvent = {
  shoot_id: string;
  type: string;
  geofence_status: string;
  captured_at: string | Date;
  created_at: string | Date;
};

type ShootMediaAsset = {
  shoot_id: string;
  kind: string;
};

type SetupPhotoUpload = {
  shoot_id: string;
};

const alertChecks = [
  {
    code: "LATE_CLOCK_IN",
    eventType: "CLOCK_IN",
    threshold: (shoot: EvaluatedShoot, minutesAfter: number) => new Date(shoot.arrival_time).getTime() + minutesAfter * 60000,
    message: (shootCode: string) => `Late clock-in for shoot ${shootCode}`
  },
  {
    code: "MISSING_SETUP_COMPLETE",
    eventType: "SETUP_COMPLETE",
    threshold: (shoot: EvaluatedShoot, minutesAfter: number) => new Date(shoot.arrival_time).getTime() + minutesAfter * 60000,
    message: (shootCode: string) => `Setup not completed for shoot ${shootCode}`
  },
  {
    code: "MISSING_SHOOTING_STARTED",
    eventType: "SHOOTING_STARTED",
    threshold: (shoot: EvaluatedShoot, minutesAfter: number) => new Date(shoot.start_time).getTime() + minutesAfter * 60000,
    message: (shootCode: string) => `Shooting not started for shoot ${shootCode}`
  },
  {
    code: "MISSING_SETUP_PHOTO",
    eventType: "MEDIA_SETUP_PHOTO",
    threshold: (shoot: EvaluatedShoot, minutesAfter: number) => new Date(shoot.end_time_est).getTime() + minutesAfter * 60000,
    message: (shootCode: string) => `Setup photo missing for shoot ${shootCode}`
  }
];

function groupRowsByShootId<T extends { shoot_id: string }>(rows: T[]) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const existing = grouped.get(row.shoot_id) ?? [];
    existing.push(row);
    grouped.set(row.shoot_id, existing);
  }
  return grouped;
}

function buildLatestOutsideClockInByShoot(events: ShootStatusEvent[]) {
  const latest = new Map<string, ShootStatusEvent>();
  for (const event of events) {
    if (event.type !== "CLOCK_IN" || event.geofence_status !== "outside") {
      continue;
    }
    const current = latest.get(event.shoot_id);
    if (!current) {
      latest.set(event.shoot_id, event);
      continue;
    }
    const eventCapturedAt = new Date(event.captured_at).getTime();
    const currentCapturedAt = new Date(current.captured_at).getTime();
    const eventCreatedAt = new Date(event.created_at).getTime();
    const currentCreatedAt = new Date(current.created_at).getTime();
    if (eventCapturedAt > currentCapturedAt || (eventCapturedAt === currentCapturedAt && eventCreatedAt > currentCreatedAt)) {
      latest.set(event.shoot_id, event);
    }
  }
  return latest;
}

async function createAlert(
  client: PoolClient,
  tenantId: string,
  shoot: EvaluatedShoot,
  alertType: string,
  message: string,
  signalAt: Date
) {
  const existingOpen = await client.query(
    "SELECT * FROM alert WHERE tenant_id = $1 AND shoot_id = $2 AND alert_type = $3 AND status = 'open' ORDER BY created_at DESC LIMIT 1",
    [tenantId, shoot.id, alertType]
  );
  if (existingOpen.rows[0]) {
    return existingOpen.rows[0];
  }

  const existingResolved = await client.query(
    "SELECT resolved_at FROM alert WHERE tenant_id = $1 AND shoot_id = $2 AND alert_type = $3 AND status = 'resolved' ORDER BY resolved_at DESC NULLS LAST LIMIT 1",
    [tenantId, shoot.id, alertType]
  );
  if (existingResolved.rows[0]?.resolved_at) {
    const resolvedAt = new Date(existingResolved.rows[0].resolved_at);
    if (resolvedAt >= signalAt) {
      return existingResolved.rows[0];
    }
  }

  const insert = await client.query(
    `
      INSERT INTO alert (tenant_id, shoot_id, alert_type, message)
      SELECT $1, s.id, $3, $4
      FROM shoot s
      WHERE s.id = $2
        AND s.tenant_id = $1
      ON CONFLICT (tenant_id, shoot_id, alert_type)
        WHERE status = 'open'
        DO NOTHING
      RETURNING *
    `,
    [tenantId, shoot.id, alertType, message]
  );
  let alert = insert.rows[0] ?? null;
  if (!alert) {
    const racedOpen = await client.query(
      "SELECT * FROM alert WHERE tenant_id = $1 AND shoot_id = $2 AND alert_type = $3 AND status = 'open' ORDER BY created_at DESC LIMIT 1",
      [tenantId, shoot.id, alertType]
    );
    alert = racedOpen.rows[0] ?? null;
  }
  if (!alert) {
    return null;
  }
  try {
    await client.query(
      `
        INSERT INTO app_event (tenant_id, event_type, aggregate_type, aggregate_id, payload, dedupe_key)
        VALUES ($1, 'alert.created', 'alert', $2, $3::jsonb, $4)
      `,
      [
        tenantId,
        alert.id,
        JSON.stringify({
          id: alert.id,
          shoot_id: shoot.id,
          shoot_code: shoot.shoot_code,
          alert_type: alertType,
          message
        }),
        `alert:${alert.id}`
      ]
    );
  } catch (error) {
    if ((error as { code?: string }).code !== "23505") {
      throw error;
    }
  }
  return alert;
}

export async function evaluateAlerts() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE pmc_app");
    const tenants = await client.query("SELECT id FROM tenant");
    for (const tenant of tenants.rows) {
      await client.query("SELECT app.set_context($1::uuid, NULL::uuid)", [tenant.id]);
      const rules = await client.query("SELECT code, minutes_after FROM alert_rule WHERE enabled = true");
      const rulesMap = new Map(rules.rows.map((row) => [row.code, Number(row.minutes_after)]));
      const shoots = await client.query<EvaluatedShoot>(
        "SELECT id, shoot_code, arrival_time::text, start_time::text, end_time_est::text FROM shoot WHERE tenant_id = $1 AND deleted_at IS NULL",
        [tenant.id]
      );
      const shootIds = shoots.rows.map((shoot) => shoot.id);
      const events =
        shootIds.length > 0
          ? await client.query<ShootStatusEvent>(
              `
                SELECT shoot_id::text, type::text, geofence_status::text, captured_at, created_at
                FROM status_event
                WHERE tenant_id = $1
                  AND shoot_id = ANY($2::uuid[])
              `,
              [tenant.id, shootIds]
            )
          : { rows: [] };
      const media =
        shootIds.length > 0
          ? await client.query<ShootMediaAsset>(
              `
                SELECT shoot_id::text, kind
                FROM media_asset
                WHERE tenant_id = $1
                  AND shoot_id = ANY($2::uuid[])
              `,
              [tenant.id, shootIds]
            )
          : { rows: [] };
      const setupUploads =
        shootIds.length > 0
          ? await client.query<SetupPhotoUpload>(
              `
                SELECT DISTINCT shoot_id::text
                FROM setup_photo_upload
                WHERE tenant_id = $1
                  AND shoot_id = ANY($2::uuid[])
              `,
              [tenant.id, shootIds]
            )
          : { rows: [] };
      const eventsByShoot = groupRowsByShootId(events.rows);
      const mediaByShoot = groupRowsByShootId(media.rows);
      const setupUploadsByShoot = new Set(setupUploads.rows.map((row) => row.shoot_id));
      const latestOutsideClockInByShoot = buildLatestOutsideClockInByShoot(events.rows);
      for (const shoot of shoots.rows) {
        const shootEvents = eventsByShoot.get(shoot.id) ?? [];
        const shootMedia = mediaByShoot.get(shoot.id) ?? [];
        const eventTypes = new Set(shootEvents.map((row) => row.type));
        const latestOutsideClockIn = latestOutsideClockInByShoot.get(shoot.id);
        for (const check of alertChecks) {
          const minutesAfter = rulesMap.get(check.code);
          if (minutesAfter === undefined) {
            continue;
          }
          const dueAt = check.threshold(shoot, minutesAfter);
          if (Date.now() < dueAt) {
            continue;
          }
          const isSatisfied =
            check.code === "MISSING_SETUP_PHOTO"
              ? shootMedia.some((row) => row.kind === "setup_photo") || setupUploadsByShoot.has(shoot.id)
              : eventTypes.has(check.eventType);
          if (!isSatisfied) {
            await createAlert(client, tenant.id, shoot, check.code, check.message(shoot.shoot_code), new Date(dueAt));
          }
        }
        if (latestOutsideClockIn && rulesMap.has("OUTSIDE_GEOFENCE")) {
          await createAlert(
            client,
            tenant.id,
            shoot,
            "OUTSIDE_GEOFENCE",
            `Outside geofence clock-in for shoot ${shoot.shoot_code}`,
            new Date(latestOutsideClockIn.captured_at)
          );
        }
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
