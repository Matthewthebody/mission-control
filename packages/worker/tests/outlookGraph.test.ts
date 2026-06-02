import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { pool } from "../src/db.js";
import { processIntegrationSyncOperation, reconcileExternalCalendarChange, syncShiftToOutlook } from "../src/calendar/outlookGraph.js";

let tenantId = "";
let studioId = "";
let leadershipId = "";
const originalWorkerGraphConfig = {
  clientId: config.MICROSOFT_GRAPH_CLIENT_ID,
  clientSecret: config.MICROSOFT_GRAPH_CLIENT_SECRET,
  tenantId: config.MICROSOFT_GRAPH_TENANT_ID,
  webhookClientState: config.MICROSOFT_GRAPH_WEBHOOK_CLIENT_STATE,
  appPermissionFeaturesEnabled: config.OUTLOOK_APP_PERMISSION_FEATURES_ENABLED,
  timeoutMs: config.OUTLOOK_GRAPH_TIMEOUT_MS,
  cancelMode: config.OUTLOOK_SYNC_CANCEL_MODE
};

beforeAll(async () => {
  const context = await pool.query(
    `
      SELECT
        tenant.id AS tenant_id,
        studio.id AS studio_id,
        leadership.id AS leadership_id
      FROM tenant
      JOIN studio
        ON studio.tenant_id = tenant.id
       AND studio.name = 'Main Studio'
      JOIN app_user leadership
        ON leadership.tenant_id = tenant.id
       AND leadership.email = 'leadership@example.com'
      WHERE tenant.name = 'Demo Studio'
      LIMIT 1
    `
  );
  tenantId = context.rows[0].tenant_id;
  studioId = context.rows[0].studio_id;
  leadershipId = context.rows[0].leadership_id;
});

beforeEach(() => {
  Object.assign(config, {
    MICROSOFT_GRAPH_CLIENT_ID: "worker-calendar-client",
    MICROSOFT_GRAPH_CLIENT_SECRET: "worker-calendar-secret",
    MICROSOFT_GRAPH_TENANT_ID: "worker-calendar-tenant",
    MICROSOFT_GRAPH_WEBHOOK_CLIENT_STATE: "",
    OUTLOOK_APP_PERMISSION_FEATURES_ENABLED: true,
    OUTLOOK_GRAPH_TIMEOUT_MS: 5000,
    OUTLOOK_SYNC_CANCEL_MODE: "cancel"
  });
});

afterEach(() => {
  Object.assign(config, {
    MICROSOFT_GRAPH_CLIENT_ID: originalWorkerGraphConfig.clientId,
    MICROSOFT_GRAPH_CLIENT_SECRET: originalWorkerGraphConfig.clientSecret,
    MICROSOFT_GRAPH_TENANT_ID: originalWorkerGraphConfig.tenantId,
    MICROSOFT_GRAPH_WEBHOOK_CLIENT_STATE: originalWorkerGraphConfig.webhookClientState,
    OUTLOOK_APP_PERMISSION_FEATURES_ENABLED: originalWorkerGraphConfig.appPermissionFeaturesEnabled,
    OUTLOOK_GRAPH_TIMEOUT_MS: originalWorkerGraphConfig.timeoutMs,
    OUTLOOK_SYNC_CANCEL_MODE: originalWorkerGraphConfig.cancelMode
  });
  vi.restoreAllMocks();
});

describe("Outlook calendar sync scaffolding", () => {
  it("keeps worker-driven Outlook writeback disabled even when the legacy app-permission flag is enabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const shift = (
        await client.query(
          `
            INSERT INTO work_shift (
              tenant_id, assigned_user_id, created_by_user_id, published_by_user_id, shift_kind, status, department, title,
              starts_at, ends_at, location_name, location_address, geofence_radius_meters, calendar_sync_required, published_at
            )
            VALUES (
              $1,$2,$3,$3,'office','published','operations',$4,
              now() + interval '1 hour', now() + interval '2 hours', 'Pilot Guard', '123 Pilot Lane', 804, true, now()
            )
            RETURNING *
          `,
          [tenantId, leadershipId, leadershipId, `Pilot Guard ${randomUUID().slice(0, 8)}`]
        )
      ).rows[0];

      const outcome = await syncShiftToOutlook(client, { tenant_id: tenantId, shift_id: shift.id, title: shift.title });

      expect(outcome.code).toBe("disabled");
      expect(outcome.response).toMatchObject({
        provider: "microsoft_graph_disabled",
        reason: "delegated_read_only_pilot"
      });
      expect(fetchMock).not.toHaveBeenCalled();

      const refreshedShift = await client.query(
        `
          SELECT sync_status::text AS sync_status, sync_error
          FROM work_shift
          WHERE id = $1
        `,
        [shift.id]
      );
      expect(refreshedShift.rows[0].sync_status).toBe("failed");
      expect(String(refreshedShift.rows[0].sync_error ?? "")).toMatch(/delegated read-only pilot/i);

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("marks direct work-shift sync attempts as disabled without calling Microsoft Graph", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const shift = (
        await client.query(
          `
            INSERT INTO work_shift (
              tenant_id, assigned_user_id, created_by_user_id, published_by_user_id, shift_kind, status, department, title,
              starts_at, ends_at, location_name, location_address, geofence_radius_meters, calendar_sync_required, published_at
            )
            VALUES (
              $1,$2,$3,$3,'office','published','operations',$4,
              now() + interval '1 hour', now() + interval '2 hours', 'Sync Test', '123 Sync Lane', 804, true, now()
            )
            RETURNING *
          `,
          [tenantId, leadershipId, leadershipId, `Graph Sync ${randomUUID().slice(0, 8)}`]
        )
      ).rows[0];

      const outcome = await syncShiftToOutlook(client, { tenant_id: tenantId, shift_id: shift.id, title: shift.title });

      const refreshedShift = await client.query(
        `
          SELECT
            calendar_sync_required,
            sync_status::text AS sync_status,
            last_sync_attempt_at::text AS last_sync_attempt_at,
            sync_error
          FROM work_shift
          WHERE id = $1
        `,
        [shift.id]
      );

      expect(outcome.code).toBe("disabled");
      expect(outcome.response).toMatchObject({
        provider: "microsoft_graph_disabled",
        reason: "delegated_read_only_pilot"
      });
      expect(refreshedShift.rows[0].calendar_sync_required).toBe(true);
      expect(refreshedShift.rows[0].sync_status).toBe("failed");
      expect(refreshedShift.rows[0].last_sync_attempt_at).toBeTruthy();
      expect(String(refreshedShift.rows[0].sync_error ?? "")).toMatch(/delegated read-only pilot/i);
      expect(fetchMock).not.toHaveBeenCalled();

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("marks linked schedule events for review when Outlook changes calendar-owned fields after staffing exists", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const linkedShootId = await insertOutlookLinkedShoot(client, "Outlook linked staffing review");
      const eventId = `event-lead-standup-${randomUUID().slice(0, 8)}`;
      const scheduleEvent = await client.query(
        `
          INSERT INTO schedule_event (
            tenant_id, department, event_kind, status, title, starts_at, ends_at, location_name,
            linked_shoot_id, sync_required, sync_state, outlook_event_id, outlook_calendar_id,
            source_system, created_by_user_id, updated_by_user_id
          )
          VALUES (
            $1,'operations','meeting','scheduled','Legacy leadership standup',
            now() + interval '1 hour', now() + interval '2 hours', 'Old briefing room',
            $2,false,'in_sync',$3,'calendar-leadership','outlook',$4,$4
          )
          RETURNING id
        `,
        [tenantId, linkedShootId, eventId, leadershipId]
      );

      const reconciled = await reconcileExternalCalendarChange(client, tenantId, {
        event_id: eventId,
        calendar_id: "calendar-leadership",
        body: {
          event_id: eventId,
          calendar_id: "calendar-leadership",
          subject: "Leadership staffing standup",
          starts_at: new Date(Date.now() + 1000 * 60 * 150).toISOString(),
          ends_at: new Date(Date.now() + 1000 * 60 * 195).toISOString(),
          timezone: "America/Chicago",
          all_day: false,
          location: "Mission Control room",
          organizer: "Leadership",
          attendees: [{ email: "leadership@example.com", name: "Leadership" }],
          body_preview: "Updated by Outlook for the morning leadership pulse.",
          cancellation_state: "active",
          last_modified_at: new Date().toISOString()
        }
      });

      const refreshedEvent = await client.query(
        `
          SELECT sync_review_required, sync_review_reason, external_changed_fields, sync_state, location_name
          FROM schedule_event
          WHERE id = $1
        `,
        [scheduleEvent.rows[0].id]
      );
      const refreshedShoot = await client.query(
        `
          SELECT schedule_sync_state, schedule_last_error
          FROM shoot
          WHERE id = $1
        `,
        [linkedShootId]
      );
      const latestAudit = await client.query(
        `
          SELECT metadata->>'resolution' AS resolution
          FROM audit_log
          WHERE tenant_id = $1
            AND action = 'calendar.external_change.reconciled'
            AND entity_id = $2
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [tenantId, scheduleEvent.rows[0].id]
      );

      expect(reconciled.response.resolution).toBe("review_required");
      expect(refreshedEvent.rows[0].sync_review_required).toBe(true);
      expect(refreshedEvent.rows[0].sync_state).toBe("sync_warning");
      expect(refreshedEvent.rows[0].location_name).toBe("Mission Control room");
      expect(refreshedEvent.rows[0].external_changed_fields).toEqual(
        expect.arrayContaining(["title", "starts_at", "ends_at", "location", "organizer", "attendees", "body_preview"])
      );
      expect(String(refreshedEvent.rows[0].sync_review_reason ?? "")).toMatch(/review staffing and readiness/i);
      expect(refreshedShoot.rows[0].schedule_sync_state).toBe("sync_warning");
      expect(String(refreshedShoot.rows[0].schedule_last_error ?? "")).toMatch(/outlook changed the event timing/i);
      expect(latestAudit.rows[0]?.resolution).toBe("review_required");

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }, 60000);

  it("marks linked schedule events for review from sparse Microsoft Graph change notifications and records webhook health", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const linkedShootId = await insertOutlookLinkedShoot(client, "Outlook sparse notification review");
      const eventId = `graph-notice-${randomUUID().slice(0, 8)}`;
      const scheduleEvent = await client.query(
        `
          INSERT INTO schedule_event (
            tenant_id, department, event_kind, status, title, starts_at, ends_at, location_name,
            linked_shoot_id, sync_required, sync_state, outlook_event_id, source_system, created_by_user_id, updated_by_user_id
          )
          VALUES (
            $1,'operations','meeting','scheduled','Notification-backed event',
            now() + interval '3 hour', now() + interval '4 hour', 'Ops briefing room',
            $2,false,'in_sync',$3,'outlook',$4,$4
          )
          RETURNING id
        `,
        [tenantId, linkedShootId, eventId, leadershipId]
      );

      const reconciled = await reconcileExternalCalendarChange(client, tenantId, {
        body: {
          value: [
            {
              subscriptionId: "subscription-graph-review",
              changeType: "updated",
              resource: `/users/leadership@example.com/events/${encodeURIComponent(eventId)}`,
              resourceData: {
                id: eventId
              }
            }
          ]
        }
      });

      const refreshedEvent = await client.query(
        `
          SELECT
            sync_review_required,
            sync_review_reason,
            external_changed_fields,
            external_change_snapshot,
            sync_state
          FROM schedule_event
          WHERE id = $1
        `,
        [scheduleEvent.rows[0].id]
      );
      const refreshedShoot = await client.query(
        `
          SELECT schedule_sync_state, schedule_last_error
          FROM shoot
          WHERE id = $1
        `,
        [linkedShootId]
      );
      const webhookHealth = await client.query(
        `
          SELECT status, failure_count, metadata_json
          FROM sync_health_records
          WHERE tenant_id = $1
            AND sync_key = 'microsoft_graph_calendar_webhook'
          LIMIT 1
        `,
        [tenantId]
      );
      const inboundOperation = await client.query(
        `
          SELECT status, result_payload, conflict_summary
          FROM integration_sync_operation
          WHERE tenant_id = $1
            AND provider = 'outlook'
            AND direction = 'inbound'
            AND external_id = $2
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [tenantId, eventId]
      );

      expect(reconciled.response).toMatchObject({
        notification_count: 1,
        change_count: 1,
        lifecycle_count: 0,
        malformed_count: 0
      });
      expect(refreshedEvent.rows[0].sync_review_required).toBe(true);
      expect(refreshedEvent.rows[0].sync_state).toBe("sync_warning");
      expect(String(refreshedEvent.rows[0].sync_review_reason ?? "")).toMatch(/external calendar change/i);
      expect(refreshedEvent.rows[0].external_changed_fields).toEqual(["external_change_notice"]);
      expect(refreshedEvent.rows[0].external_change_snapshot).toMatchObject({
        external_id: eventId,
        change_type: "updated"
      });
      expect(refreshedShoot.rows[0].schedule_sync_state).toBe("sync_warning");
      expect(String(refreshedShoot.rows[0].schedule_last_error ?? "")).toMatch(/external calendar change/i);
      expect(webhookHealth.rows[0]).toMatchObject({
        status: "healthy",
        failure_count: 0
      });
      expect(webhookHealth.rows[0].metadata_json).toMatchObject({
        notification_count: 1,
        change_count: 1,
        retry_state: "idle"
      });
      expect(inboundOperation.rows[0].status).toBe("conflict");
      expect(inboundOperation.rows[0].result_payload).toMatchObject({
        resolution: "review_required",
        reason: "external_change_notice"
      });

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }, 60000);

  it("records subscription lifecycle warnings with explicit retry state", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const reconciled = await reconcileExternalCalendarChange(client, tenantId, {
        body: {
          value: [
            {
              subscriptionId: "subscription-reauth-1",
              lifecycleEvent: "reauthorizationRequired",
              resource: "/users/leadership@example.com/events"
            }
          ]
        }
      });

      const subscriptionHealth = await client.query(
        `
          SELECT status, failure_count, last_error_code, last_error_message, metadata_json
          FROM sync_health_records
          WHERE tenant_id = $1
            AND sync_key = 'microsoft_graph_calendar_subscription'
            AND resource_id = 'subscription-reauth-1'
          LIMIT 1
        `,
        [tenantId]
      );
      const integrationEvent = await client.query(
        `
          SELECT event_level, event_type, event_status, summary, detail
          FROM microsoft_integration_event
          WHERE tenant_id = $1
            AND event_type = 'outlook.calendar_subscription.lifecycle'
          ORDER BY occurred_at DESC
          LIMIT 1
        `,
        [tenantId]
      );
      const externalAudit = await client.query(
        `
          SELECT result, context_json
          FROM audit_events
          WHERE tenant_id = $1
            AND event_type = 'outlook.calendar_subscription.lifecycle'
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [tenantId]
      );

      expect(reconciled.response).toMatchObject({
        notification_count: 1,
        change_count: 0,
        lifecycle_count: 1,
        malformed_count: 0
      });
      expect(subscriptionHealth.rows[0]).toMatchObject({
        status: "warning",
        failure_count: 1,
        last_error_code: "reauthorizationRequired"
      });
      expect(String(subscriptionHealth.rows[0].last_error_message ?? "")).toMatch(/reauthorization/i);
      expect(subscriptionHealth.rows[0].metadata_json).toMatchObject({
        lifecycle_event: "reauthorizationRequired",
        retry_state: "reauthorization_required",
        exception_category: "sync",
        exception_type: "calendar_subscription_attention"
      });
      expect(integrationEvent.rows[0]).toMatchObject({
        event_level: "warning",
        event_type: "outlook.calendar_subscription.lifecycle",
        event_status: "reauthorizationRequired"
      });
      expect(externalAudit.rows[0]).toMatchObject({
        result: "reauthorization_required"
      });
      expect(externalAudit.rows[0].context_json).toMatchObject({
        lifecycle_event: "reauthorizationRequired",
        retry_state: "reauthorization_required"
      });

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("ignores Microsoft Graph notifications with an invalid configured client state and records webhook health", async () => {
    config.MICROSOFT_GRAPH_WEBHOOK_CLIENT_STATE = "expected-graph-client-state";

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existingWebhookHealth = await client.query(
        `
          SELECT failure_count
          FROM sync_health_records
          WHERE tenant_id = $1
            AND sync_key = 'microsoft_graph_calendar_webhook'
          ORDER BY updated_at DESC
          LIMIT 1
        `,
        [tenantId]
      );
      const previousFailureCount = Number(existingWebhookHealth.rows[0]?.failure_count ?? 0);

      const reconciled = await reconcileExternalCalendarChange(client, tenantId, {
        body: {
          value: [
            {
              subscriptionId: "subscription-invalid-client-state-1",
              clientState: "wrong-client-state",
              resource: "/users/leadership@example.com/events",
              resourceData: {
                id: `event-invalid-client-state-${randomUUID().slice(0, 8)}`
              }
            }
          ]
        }
      });

      const webhookHealth = await client.query(
        `
          SELECT status, failure_count, last_error_code, last_error_message, metadata_json
          FROM sync_health_records
          WHERE tenant_id = $1
            AND sync_key = 'microsoft_graph_calendar_webhook'
          ORDER BY updated_at DESC
          LIMIT 1
        `,
        [tenantId]
      );
      const integrationEvent = await client.query(
        `
          SELECT event_level, event_type, event_status, detail
          FROM microsoft_integration_event
          WHERE tenant_id = $1
            AND event_type = 'outlook.calendar_notification.invalid_client_state'
          ORDER BY occurred_at DESC
          LIMIT 1
        `,
        [tenantId]
      );

      expect(reconciled.response).toMatchObject({
        notification_count: 1,
        change_count: 0,
        lifecycle_count: 0,
        malformed_count: 0,
        invalid_client_state_count: 1
      });
      expect(webhookHealth.rows[0]).toMatchObject({
        status: "error",
        failure_count: previousFailureCount + 1,
        last_error_code: "invalid_client_state"
      });
      expect(String(webhookHealth.rows[0].last_error_message ?? "")).toMatch(/client state/i);
      expect(webhookHealth.rows[0].metadata_json).toMatchObject({
        retry_state: "inspect_subscription_client_state",
        invalid_client_state_count: 1
      });
      expect(integrationEvent.rows[0]).toMatchObject({
        event_level: "error",
        event_type: "outlook.calendar_notification.invalid_client_state",
        event_status: "ignored"
      });
      expect(integrationEvent.rows[0].detail).toMatchObject({
        reason: "invalid_client_state",
        retry_state: "inspect_subscription_client_state",
        client_state_valid: false
      });

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("stores disabled sync metadata on queued outbound Outlook operations without calling Microsoft Graph", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const shift = (
        await client.query(
          `
            INSERT INTO work_shift (
              tenant_id, assigned_user_id, created_by_user_id, published_by_user_id, shift_kind, status, department, title,
              starts_at, ends_at, location_name, location_address, geofence_radius_meters, calendar_sync_required, published_at
            )
            VALUES (
              $1,$2,$3,$3,'office','published','operations',$4,
              now() + interval '3 hour', now() + interval '4 hour', 'Failure Test', '456 Failure Lane', 804, true, now()
            )
            RETURNING *
          `,
          [tenantId, leadershipId, leadershipId, `Graph Failure ${randomUUID().slice(0, 8)}`]
        )
      ).rows[0];

      const outcome = await syncShiftToOutlook(client, { tenant_id: tenantId, shift_id: shift.id });

      const refreshedShift = await client.query(
        `
          SELECT
            sync_status::text AS sync_status,
            sync_error,
            last_sync_attempt_at::text AS last_sync_attempt_at,
            calendar_sync_required
          FROM work_shift
          WHERE id = $1
        `,
        [shift.id]
      );

      expect(outcome.code).toBe("disabled");
      expect(refreshedShift.rows[0]).toMatchObject({
        sync_status: "failed",
        calendar_sync_required: true
      });
      expect(String(refreshedShift.rows[0].sync_error ?? "")).toMatch(/delegated read-only pilot/i);
      expect(refreshedShift.rows[0].last_sync_attempt_at).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("records delegated-read-only failure metadata on queued outbound Outlook operations", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const shift = (
        await client.query(
          `
            INSERT INTO work_shift (
              tenant_id, assigned_user_id, created_by_user_id, published_by_user_id, shift_kind, status, department, title,
              starts_at, ends_at, location_name, location_address, geofence_radius_meters, calendar_sync_required, published_at
            )
            VALUES (
              $1,$2,$3,$3,'office','published','operations',$4,
              now() + interval '5 hour', now() + interval '6 hour', 'Retry Test', '789 Retry Lane', 804, true, now()
            )
            RETURNING *
          `,
          [tenantId, leadershipId, leadershipId, `Graph Retry ${randomUUID().slice(0, 8)}`]
        )
      ).rows[0];

      const operation = await client.query(
        `
          INSERT INTO integration_sync_operation (
            tenant_id, provider, direction, entity_type, entity_id, external_object_type, external_id,
            operation_type, source_system, source_change_key, status, payload
          )
          VALUES ($1,'outlook','outbound','work_shift',$2,'calendar_event',NULL,'upsert','mission_control',$3,'pending',$4::jsonb)
          RETURNING id
        `,
        [tenantId, shift.id, `worker-retry-after:${randomUUID()}`, JSON.stringify({ shift_id: shift.id, tenant_id: tenantId })]
      );

      const result = await processIntegrationSyncOperation(client, operation.rows[0].id);

      const storedOperation = await client.query(
        `
          SELECT status, result_payload, last_error
          FROM integration_sync_operation
          WHERE id = $1
        `,
        [operation.rows[0].id]
      );
      const audit = await client.query(
        `
          SELECT metadata
          FROM audit_log
          WHERE tenant_id = $1
            AND action = 'integration.sync.failed'
            AND metadata->>'provider' = 'outlook'
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [tenantId]
      );

      expect(result.code).toBe("disabled");
      expect(storedOperation.rows[0]).toMatchObject({
        status: "failed"
      });
      expect(storedOperation.rows[0].result_payload).toMatchObject({
        provider: "microsoft_graph_disabled",
        reason: "delegated_read_only_pilot"
      });
      expect(String(storedOperation.rows[0].last_error ?? "")).toMatch(/delegated read-only pilot/i);
      expect(audit.rows[0].metadata).toMatchObject({
        result: {
          provider: "microsoft_graph_disabled",
          reason: "delegated_read_only_pilot"
        }
      });
      expect(fetchMock).not.toHaveBeenCalled();

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

async function insertOutlookLinkedShoot(client: PoolClient, title: string) {
  const now = new Date();
  const startsAt = new Date(now.getTime() + 60 * 60 * 1000);
  const endsAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO shoot (
        tenant_id,
        studio_id,
        shoot_code,
        title,
        shoot_date,
        location_name,
        location_address,
        location_lat,
        location_lng,
        navigation_url,
        geofence_radius_meters,
        arrival_time,
        start_time,
        end_time_est,
        projected_students,
        created_by
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5::date,
        'Outlook Fixture Venue',
        '123 Outlook Fixture Lane',
        44.973,
        -93.227,
        NULL,
        804,
        $6,
        $6,
        $7,
        12,
        $8
      )
      RETURNING id
    `,
    [
      tenantId,
      studioId,
      `OUTLOOK-${randomUUID().slice(0, 8)}`,
      title,
      startsAt.toISOString().slice(0, 10),
      startsAt.toISOString(),
      endsAt.toISOString(),
      leadershipId
    ]
  );
  return rows[0].id;
}
