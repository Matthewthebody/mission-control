// Labor Command Center — owner/payroll alert fan-out.
// Owner-level payroll alerts go to the owner (owner_admin role / super_admin tier —
// Matthew) through BOTH channels: Mission Control in-app notifications and the Teams
// operational-alert pipeline (payroll_alert routes configured under the existing
// Teams webhook governance, migration 110). Teams delivery is honest: it only fires
// when a payroll_alert Teams route is configured and enabled for the tenant.
import type { PoolClient } from "pg";
import { queueNotificationDispatch } from "./opsNotifications.js";
import { queueOperationalAlert } from "./operationalAlerting.js";

export async function loadPayrollOwnerRecipients(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<{ user_id: string }>(
    `
      SELECT DISTINCT u.id AS user_id
      FROM app_user u
      LEFT JOIN user_authority_assignment uaa
        ON uaa.tenant_id = u.tenant_id AND uaa.user_id = u.id
      LEFT JOIN user_role ur ON ur.user_id = u.id
      LEFT JOIN role r ON r.id = ur.role_id
      WHERE u.tenant_id = $1
        AND u.is_active = true
        AND (uaa.authority_tier = 'super_admin' OR r.code = 'owner_admin')
    `,
    [tenantId]
  );
  return rows.map((row) => row.user_id);
}

export async function queueOwnerPayrollAlert(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId?: string | null;
    alertKind: string; // e.g. payroll_ready_for_owner_review | payroll_blockers | quickbooks_sync_failed | post_lock_correction
    title: string;
    body: string;
    severity?: "low" | "medium" | "high" | "critical";
    deepLink?: string | null;
    periodId?: string | null;
    metadata?: Record<string, unknown>;
    dedupeKey?: string | null;
  }
) {
  const owners = await loadPayrollOwnerRecipients(client, input.tenantId);
  const dedupeKey = input.dedupeKey ?? `payroll:${input.alertKind}:${input.periodId ?? "tenant"}`;

  if (owners.length) {
    await queueNotificationDispatch(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      recipientUserIds: owners,
      notificationType: "payroll_owner_alert",
      title: input.title,
      body: input.body,
      priority: input.severity === "critical" || input.severity === "high" ? "high" : "normal",
      deepLink: input.deepLink ?? "#labor/command-center",
      metadata: { ...(input.metadata ?? {}), alert_kind: input.alertKind, payroll_period_id: input.periodId ?? null },
      appEventDedupeKey: dedupeKey
    });
  }

  await queueOperationalAlert(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    alertType: "payroll_alert",
    title: input.title,
    summary: input.body,
    severity: input.severity ?? "medium",
    deepLink: input.deepLink ?? "#labor/command-center",
    sourceEventType: `payroll.${input.alertKind}`,
    sourceEntityType: "payroll_period",
    sourceEntityId: input.periodId ?? input.tenantId,
    dedupeKey,
    metadata: { ...(input.metadata ?? {}), alert_kind: input.alertKind },
    facts: [
      { label: "Alert", value: input.title },
      { label: "Kind", value: input.alertKind }
    ]
  });
}
