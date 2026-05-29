import type { PoolClient } from "pg";
import { getGeofenceStatus } from "./geo.js";
import { createAppEvent } from "./outbox.js";
import type { StatusEventType } from "../types/domain.js";
import type { AuthUser } from "../types/auth.js";
import { assertShootAccess } from "./shootAccess.js";

export interface StatusEventInput {
  type: StatusEventType;
  captured_at: string;
  location_lat?: number | null;
  location_lng?: number | null;
  client_event_id?: string | null;
  metadata?: Record<string, unknown>;
}

export async function createStatusEvent(
  client: PoolClient,
  args: {
    auth: AuthUser;
    tenantId: string;
    userId: string;
    shootId: string;
    idempotencyKey?: string | null;
    skipShootAccess?: boolean;
    input: StatusEventInput;
  }
) {
  if (!args.skipShootAccess) {
    await assertShootAccess(client, args.auth, args.shootId);
  }

  if (args.idempotencyKey) {
    const existingByHeader = await client.query(
      "SELECT * FROM status_event WHERE tenant_id = $1 AND idempotency_key = $2 ORDER BY created_at DESC LIMIT 1",
      [args.tenantId, args.idempotencyKey]
    );
    if (existingByHeader.rows[0]) {
      return existingByHeader.rows[0];
    }
  }
  if (args.input.client_event_id) {
    const existingByClientEvent = await client.query(
      "SELECT * FROM status_event WHERE tenant_id = $1 AND client_event_id = $2",
      [args.tenantId, args.input.client_event_id]
    );
    if (existingByClientEvent.rows[0]) {
      return existingByClientEvent.rows[0];
    }
  }

  const shootResult = await client.query(
    "SELECT id, shoot_code, location_lat, location_lng, geofence_radius_meters FROM shoot WHERE id = $1",
    [args.shootId]
  );
  const shoot = shootResult.rows[0];
  if (!shoot) {
    throw new Error("Shoot not found");
  }

  const geofenceStatus = getGeofenceStatus(
    Number(shoot.location_lat),
    Number(shoot.location_lng),
    Number(shoot.geofence_radius_meters),
    args.input.location_lat,
    args.input.location_lng
  );

  try {
    const { rows } = await client.query(
      `
        INSERT INTO status_event (
          tenant_id, shoot_id, user_id, type, captured_at, location_lat, location_lng,
          geofence_status, client_event_id, idempotency_key, metadata
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
        RETURNING *
      `,
      [
        args.tenantId,
        args.shootId,
        args.userId,
        args.input.type,
        args.input.captured_at,
        args.input.location_lat ?? null,
        args.input.location_lng ?? null,
        geofenceStatus,
        args.input.client_event_id ?? null,
        args.idempotencyKey ?? null,
        JSON.stringify(args.input.metadata ?? {})
      ]
    );
    const event = rows[0];
    await createAppEvent(client, {
      tenantId: args.tenantId,
      eventType: "status_event.created",
      aggregateType: "status_event",
      aggregateId: event.id,
      dedupeKey: `status-event:${event.id}`,
      payload: {
        id: event.id,
        shoot_id: args.shootId,
        shoot_code: shoot.shoot_code,
        type: event.type,
        captured_at: event.captured_at,
        geofence_status: event.geofence_status
      }
    });
    return event;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      if (args.input.client_event_id) {
        const existing = await client.query("SELECT * FROM status_event WHERE tenant_id = $1 AND client_event_id = $2", [
          args.tenantId,
          args.input.client_event_id
        ]);
        if (existing.rows[0]) {
          return existing.rows[0];
        }
      }
      if (args.idempotencyKey) {
        const existing = await client.query(
          "SELECT * FROM status_event WHERE tenant_id = $1 AND idempotency_key = $2 ORDER BY created_at DESC LIMIT 1",
          [args.tenantId, args.idempotencyKey]
        );
        if (existing.rows[0]) {
          return existing.rows[0];
        }
      }
    }
    throw error;
  }
}
