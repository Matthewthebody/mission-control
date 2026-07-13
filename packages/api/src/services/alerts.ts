import type { PoolClient } from "pg";
import type { AuthUser } from "../types/auth.js";
import { beginDangerousAction, completeDangerousAction, failDangerousAction } from "./dangerousActions.js";

// Bounded by contract (audit §11): the alert table grows append-only (5,500+
// open rows in the dev DB) and this endpoint shipped every row (~1MB+) per
// poll. Callers now get the newest page.
export const ALERTS_DEFAULT_LIMIT = 200;
export const ALERTS_MAX_LIMIT = 500;

export async function listAlerts(
  client: PoolClient,
  tenantId: string,
  status: "open" | "all" = "open",
  limit: number = ALERTS_DEFAULT_LIMIT
) {
  const boundedLimit = Math.min(Math.max(1, Math.trunc(limit) || ALERTS_DEFAULT_LIMIT), ALERTS_MAX_LIMIT);
  const values: (string | number)[] = [tenantId];
  let filter = "WHERE a.tenant_id = $1";
  if (status === "open") {
    values.push("open");
    filter += " AND a.status = $2";
  }
  values.push(boundedLimit);
  const { rows } = await client.query(
    `
      SELECT a.*, s.shoot_code, s.title
      FROM alert a
      LEFT JOIN shoot s ON s.id = a.shoot_id AND s.tenant_id = a.tenant_id
      ${filter}
      ORDER BY a.created_at DESC
      LIMIT $${values.length}
    `,
    values
  );
  return rows;
}

export async function resolveAlert(
  client: PoolClient,
  auth: AuthUser,
  alertId: string,
  meta: { ipAddress?: string | null; userAgent?: string | null }
) {
  const alertResult = await client.query("SELECT * FROM alert WHERE id = $1 AND tenant_id = $2 LIMIT 1", [alertId, auth.tenantId]);
  const existing = alertResult.rows[0];
  if (!existing) {
    return null;
  }

  const dangerousAction = await beginDangerousAction(client, auth, {
    actionCode: "hide_alert",
    entityType: "alert",
    entityId: alertId,
    sourceModule: "alerts",
    reason: "User resolved or hid an operational alert",
    beforeValue: {
      status: existing.status,
      alert_type: existing.alert_type
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  try {
    const { rows } = await client.query(
      `
        UPDATE alert
        SET status = 'resolved', resolved_at = now(), resolved_by = $2
        WHERE id = $1 AND tenant_id = $3
        RETURNING *
      `,
      [alertId, auth.id, auth.tenantId]
    );
    const updated = rows[0] ?? null;
    if (!updated) {
      return null;
    }

    await completeDangerousAction(client, auth, {
      executionId: dangerousAction.executionId,
      actionCode: "hide_alert",
      entityType: "alert",
      entityId: alertId,
      afterValue: {
        status: updated.status,
        resolved_at: updated.resolved_at
      },
      reason: "User resolved or hid an operational alert",
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });

    return updated;
  } catch (error) {
    await failDangerousAction(client, auth, {
      executionId: dangerousAction.executionId,
      actionCode: "hide_alert",
      entityType: "alert",
      entityId: alertId,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });
    throw error;
  }
}
