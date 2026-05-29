import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { withClientTransaction } from "../src/db/tx.js";
import { emitOperationalEvent } from "../src/services/operationalEvents.js";

let tenantId = "";
let actorUserId = "";
let recipientUserId = "";

const testSourceObjectIds = ["job-123", "approval-1", "approval-2"];
const testDedupeKeys = ["job.assigned:test-job-123", "approval.requested:test-approval-1"];

beforeAll(async () => {
  const migrationSql = await readFile(
    resolve(process.cwd(), "../../db/migrations/115_notification_event_engine_phase4.sql"),
    "utf8"
  );
  try {
    await pool.query(migrationSql);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("already exists")) {
      throw error;
    }
  }

  const users = await pool.query<{
    tenant_id: string;
    actor_user_id: string;
    recipient_user_id: string;
  }>(
    `
      SELECT
        actor.tenant_id::text AS tenant_id,
        actor.id::text AS actor_user_id,
        recipient.id::text AS recipient_user_id
      FROM app_user actor
      JOIN app_user recipient
        ON recipient.tenant_id = actor.tenant_id
      WHERE lower(actor.email) = lower($1)
        AND lower(recipient.email) = lower($2)
      LIMIT 1
    `,
    ["matthew@example.com", "leadership@example.com"]
  );

  tenantId = users.rows[0]?.tenant_id ?? "";
  actorUserId = users.rows[0]?.actor_user_id ?? "";
  recipientUserId = users.rows[0]?.recipient_user_id ?? "";
});

async function cleanupOperationalEventFixtures() {
  await pool.query(
    `
      DELETE FROM ops_notification_event
      WHERE notification_id IN (
        SELECT delivery.notification_id
        FROM operational_event_delivery delivery
        JOIN operational_event event
          ON event.id = delivery.operational_event_id
        WHERE delivery.tenant_id = $1
          AND delivery.notification_id IS NOT NULL
          AND (
            event.source_object_id = ANY($2::text[])
            OR event.dedupe_key = ANY($3::text[])
          )
      )
    `,
    [tenantId, testSourceObjectIds, testDedupeKeys]
  );
  await pool.query(
    `
      DELETE FROM ops_notification
      WHERE id IN (
        SELECT delivery.notification_id
        FROM operational_event_delivery delivery
        JOIN operational_event event
          ON event.id = delivery.operational_event_id
        WHERE delivery.tenant_id = $1
          AND delivery.notification_id IS NOT NULL
          AND (
            event.source_object_id = ANY($2::text[])
            OR event.dedupe_key = ANY($3::text[])
          )
      )
    `,
    [tenantId, testSourceObjectIds, testDedupeKeys]
  );
  await pool.query(
    `
      DELETE FROM app_event
      WHERE tenant_id = $1
        AND event_type = 'notification.dispatch'
        AND id IN (
          SELECT delivery.notification_app_event_id
          FROM operational_event_delivery delivery
          JOIN operational_event event
            ON event.id = delivery.operational_event_id
          WHERE event.tenant_id = $1
            AND delivery.notification_app_event_id IS NOT NULL
            AND (
              event.source_object_id = ANY($2::text[])
              OR event.dedupe_key = ANY($3::text[])
            )
        )
    `,
    [tenantId, testSourceObjectIds, testDedupeKeys]
  );
  await pool.query(
    `
      DELETE FROM operational_event_delivery
      WHERE operational_event_id IN (
        SELECT id
        FROM operational_event
        WHERE tenant_id = $1
          AND (
            source_object_id = ANY($2::text[])
            OR dedupe_key = ANY($3::text[])
          )
      )
    `,
    [tenantId, testSourceObjectIds, testDedupeKeys]
  );
  await pool.query(
    `
      DELETE FROM operational_event
      WHERE tenant_id = $1
        AND (
          source_object_id = ANY($2::text[])
          OR dedupe_key = ANY($3::text[])
        )
    `,
    [tenantId, testSourceObjectIds, testDedupeKeys]
  );
  await pool.query(
    `
      DELETE FROM admin_setting_value
      WHERE tenant_id = $1
        AND setting_key = 'notifications.operational_event_defaults'
    `,
    [tenantId]
  );
}

beforeEach(async () => {
  await cleanupOperationalEventFixtures();
});

afterAll(async () => {
  await cleanupOperationalEventFixtures();
});

describe("operational event engine", () => {
  it("persists structured events and queues in-app notification dispatches separately from event creation", async () => {
    const result = await withClientTransaction(tenantId, actorUserId, (client) =>
      emitOperationalEvent(client, {
        tenantId,
        actorUserId,
        eventType: "job.assigned",
        sourceModule: "jobs",
        sourceObjectType: "job",
        sourceObjectId: "job-123",
        sourceObjectLabel: "DEMO-123",
        title: "Assigned to DEMO-123",
        summary: "You were assigned to a demo job.",
        recipientUserIds: [recipientUserId],
        deliveryChannels: ["in_app"],
        category: "assignment_update",
        severity: "medium",
        actionRequired: true,
        deepLink: "#jobs/job-123",
        dedupeKey: "job.assigned:test-job-123"
      })
    );

    expect(result.event.event_type).toBe("job.assigned");
    expect(result.event.recipient_user_ids).toEqual([recipientUserId]);
    expect(result.queued_count).toBe(1);
    expect(result.throttled_count).toBe(0);
    expect(result.deliveries[0]?.dispatch_status).toBe("queued");
    expect(result.deliveries[0]?.notification_app_event_id).toBeTruthy();

    const eventRows = await pool.query<{
      event_type: string;
      source_object_type: string;
      source_object_id: string;
      recipient_user_ids: string[];
    }>(
      `
        SELECT
          event_type,
          source_object_type,
          source_object_id,
          recipient_user_ids::text[]
        FROM operational_event
        WHERE tenant_id = $1
          AND source_object_id = $2
      `,
      [tenantId, "job-123"]
    );

    expect(eventRows.rows).toHaveLength(1);
    expect(eventRows.rows[0]?.event_type).toBe("job.assigned");
    expect(eventRows.rows[0]?.source_object_type).toBe("job");
    expect(eventRows.rows[0]?.source_object_id).toBe("job-123");
    expect(eventRows.rows[0]?.recipient_user_ids).toEqual([recipientUserId]);

    const appEventRows = await pool.query<{
      event_type: string;
      metadata_delivery_id: string | null;
    }>(
      `
        SELECT
          event_type,
          payload->'metadata'->>'operational_event_delivery_id' AS metadata_delivery_id
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'notification.dispatch'
          AND id = $2::uuid
      `,
      [tenantId, result.deliveries[0]?.notification_app_event_id ?? "00000000-0000-0000-0000-000000000000"]
    );

    expect(appEventRows.rows).toHaveLength(1);
    expect(appEventRows.rows[0]?.metadata_delivery_id).toBe(result.deliveries[0]?.id ?? null);
  });

  it("throttles duplicate deliveries inside the configured window without blocking event persistence", async () => {
    await withClientTransaction(tenantId, actorUserId, (client) =>
      emitOperationalEvent(client, {
        tenantId,
        actorUserId,
        eventType: "approval.requested",
        sourceModule: "approvals",
        sourceObjectType: "operational_approval_request",
        sourceObjectId: "approval-1",
        sourceObjectLabel: "Approval 1",
        title: "Approval requested",
        summary: "A high-signal approval needs attention.",
        recipientUserIds: [recipientUserId],
        deliveryChannels: ["in_app"],
        category: "approval_needed",
        severity: "high",
        actionRequired: true,
        deepLink: "#approvals?tab=operational&request=approval-1",
        dedupeKey: "approval.requested:test-approval-1",
        throttleWindowMinutes: 120
      })
    );

    const secondResult = await withClientTransaction(tenantId, actorUserId, (client) =>
      emitOperationalEvent(client, {
        tenantId,
        actorUserId,
        eventType: "approval.requested",
        sourceModule: "approvals",
        sourceObjectType: "operational_approval_request",
        sourceObjectId: "approval-1",
        sourceObjectLabel: "Approval 1",
        title: "Approval requested",
        summary: "A high-signal approval needs attention.",
        recipientUserIds: [recipientUserId],
        deliveryChannels: ["in_app"],
        category: "approval_needed",
        severity: "high",
        actionRequired: true,
        deepLink: "#approvals?tab=operational&request=approval-1",
        dedupeKey: "approval.requested:test-approval-1",
        throttleWindowMinutes: 120
      })
    );

    expect(secondResult.queued_count).toBe(0);
    expect(secondResult.throttled_count).toBe(1);
    expect(secondResult.deliveries[0]?.dispatch_status).toBe("throttled");
    expect(secondResult.deliveries[0]?.notification_app_event_id).toBeNull();
    expect(secondResult.deliveries[0]?.throttled_by_delivery_id).toBeTruthy();

    const testEventCount = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM operational_event WHERE tenant_id = $1 AND source_object_id = $2",
      [tenantId, "approval-1"]
    );
    expect(Number(testEventCount.rows[0]?.count ?? 0)).toBe(2);

    const appEventCount = await pool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'notification.dispatch'
          AND id IN (
            SELECT delivery.notification_app_event_id
            FROM operational_event_delivery delivery
            JOIN operational_event event
              ON event.id = delivery.operational_event_id
            WHERE event.tenant_id = $1
              AND event.source_object_id = $2
              AND delivery.notification_app_event_id IS NOT NULL
          )
      `,
      [tenantId, "approval-1"]
    );
    expect(Number(appEventCount.rows[0]?.count ?? 0)).toBe(1);
  });

  it("applies configured operational event defaults without changing business emitters", async () => {
    await pool.query(
      `
        INSERT INTO admin_setting_value (
          tenant_id,
          setting_key,
          setting_category,
          scope_type,
          scope_id,
          scope_label,
          value,
          value_type,
          status,
          requires_approval,
          is_override,
          effective_at,
          requested_by_user_id,
          approved_by_user_id,
          approved_at,
          reason,
          impact_snapshot,
          metadata
        )
        VALUES (
          $1,
          'notifications.operational_event_defaults',
          'notification_summary_rules'::admin_setting_category,
          'global'::admin_setting_scope_type,
          NULL,
          'Company Default',
          $2::jsonb,
          'json',
          'approved'::admin_setting_status,
          false,
          false,
          now() - interval '1 second',
          $3,
          $3,
          now(),
          'Phase 7 routing defaults test.',
          '{}'::jsonb,
          '{}'::jsonb
        )
      `,
      [
        tenantId,
        JSON.stringify({
          default_channels: ["in_app"],
          event_overrides: {
            "approval.requested": {
              severity: "critical",
              channels: ["in_app", "email"],
              throttle_window_minutes: 5,
              action_required: true,
              digest_eligible: false
            }
          }
        }),
        actorUserId
      ]
    );

    const result = await withClientTransaction(tenantId, actorUserId, (client) =>
      emitOperationalEvent(client, {
        tenantId,
        actorUserId,
        eventType: "approval.requested",
        sourceModule: "approvals",
        sourceObjectType: "operational_approval_request",
        sourceObjectId: "approval-2",
        title: "Approval requested",
        summary: "An approval needs attention.",
        recipientUserIds: [recipientUserId]
      })
    );

    expect(result.event.severity).toBe("critical");
    expect(result.event.delivery_channels).toEqual(["in_app", "email"]);
    expect(result.event.throttle_window_minutes).toBe(5);
    expect(result.deliveries[0]?.delivery_channels).toEqual(["in_app", "email"]);
  });
});
