import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { pool } from "../src/db/pool.js";
import { withClientTransaction } from "../src/db/tx.js";
import { queueOperationalAlert } from "../src/services/operationalAlerting.js";
import { elevateSession, passwordLogin } from "./helpers.js";

const app = createApp();
const originalTeamsAlertsEnabled = config.TEAMS_OPERATIONAL_ALERTS_ENABLED;

let leadershipToken = "";
let leadershipUserId = "";
let leadershipTenantId = "";

beforeAll(async () => {
  const schemaCheck = await pool.query<{ relation: string | null }>(
    "SELECT to_regclass('public.operational_alert_delivery')::text AS relation"
  );
  if (!schemaCheck.rows[0]?.relation) {
    const migrationSql = await readFile(
      resolve(process.cwd(), "../../db/migrations/110_teams_operational_alerts_phase3.sql"),
      "utf8"
    );
    await pool.query(migrationSql);
  }

  leadershipToken = (await passwordLogin(app, "leadership@example.com")).body.token;

  const membership = await pool.query(
    "SELECT id, tenant_id FROM app_user WHERE lower(email) = lower($1) LIMIT 1",
    ["leadership@example.com"]
  );
  leadershipUserId = membership.rows[0].id as string;
  leadershipTenantId = membership.rows[0].tenant_id as string;
});

beforeEach(async () => {
  config.TEAMS_OPERATIONAL_ALERTS_ENABLED = true;
  await pool.query("DELETE FROM operational_alert_delivery WHERE tenant_id = $1", [leadershipTenantId]);
  await pool.query("DELETE FROM operational_alert_route WHERE tenant_id = $1", [leadershipTenantId]);
  await pool.query("DELETE FROM app_event WHERE tenant_id = $1 AND event_type = 'operational_alert.dispatch'", [leadershipTenantId]);
  await elevateSession(app, leadershipToken, "LocalDemo123!");
});

afterEach(() => {
  config.TEAMS_OPERATIONAL_ALERTS_ENABLED = originalTeamsAlertsEnabled;
});

async function createTeamsRoute(overrides: Partial<{
  alert_type: string;
  route_name: string;
  destination_label: string;
  webhook_url: string;
  channel_name: string;
  severity_threshold: string;
  throttle_window_minutes: number;
  enabled: boolean;
}> = {}) {
  return request(app)
    .post("/api/integrations/teams/operational-alerts/routes")
    .set("Authorization", `Bearer ${leadershipToken}`)
    .send({
      alert_type: overrides.alert_type ?? "approval_needed",
      delivery_channel: "teams_webhook",
      route_name: overrides.route_name ?? "Ops approvals",
      destination_label: overrides.destination_label ?? "Operations leadership",
      destination_config: {
        webhook_url: overrides.webhook_url ?? "https://example.com/webhook/teams/ops-approvals",
        channel_name: overrides.channel_name ?? "Ops Alerts"
      },
      severity_threshold: overrides.severity_threshold ?? "medium",
      throttle_window_minutes: overrides.throttle_window_minutes ?? 90,
      enabled: overrides.enabled ?? true
    });
}

describe("Teams operational alerts", () => {
  it("creates Teams alert routes through integration governance and exposes masked routing details", async () => {
    const beforeAuditCount = Number(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM audit_log WHERE tenant_id = $1 AND action = 'integration.teams_alert_route.created'",
          [leadershipTenantId]
        )
      ).rows[0].count
    );

    const createResponse = await createTeamsRoute({
      alert_type: "staff_assignment_conflict_detected",
      route_name: "Staffing conflicts",
      destination_label: "Scheduling war room",
      webhook_url: "https://example.com/webhook/teams/staffing-conflicts",
      channel_name: "Staffing Conflicts",
      severity_threshold: "high",
      throttle_window_minutes: 120
    });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.alert_type).toBe("staff_assignment_conflict_detected");
    expect(createResponse.body.delivery_channel).toBe("teams_webhook");
    expect(createResponse.body.route_name).toBe("Staffing conflicts");
    expect(createResponse.body.destination_label).toBe("Scheduling war room");

    const listResponse = await request(app)
      .get("/api/integrations/teams/operational-alerts")
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.teams_enabled).toBe(true);
    expect(Array.isArray(listResponse.body.definitions)).toBe(true);
    expect(listResponse.body.definitions.some((definition: { type: string }) => definition.type === "staff_assignment_conflict_detected")).toBe(true);

    const route = listResponse.body.routes.find((entry: { route_name: string }) => entry.route_name === "Staffing conflicts");
    expect(route).toBeTruthy();
    expect(route.masked_destination).toContain("example.com");
    expect(route.failure_count_14d).toBe(0);
    expect(route.last_delivery_status).toBeNull();

    const afterAuditCount = Number(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM audit_log WHERE tenant_id = $1 AND action = 'integration.teams_alert_route.created'",
          [leadershipTenantId]
        )
      ).rows[0].count
    );

    expect(afterAuditCount).toBeGreaterThanOrEqual(beforeAuditCount + 1);
  });

  it("queues alert deliveries, throttles duplicates, and logs only one outbound app event inside the throttle window", async () => {
    const createResponse = await createTeamsRoute({
      alert_type: "approval_needed",
      route_name: "Approvals escalation",
      destination_label: "Approvals channel",
      webhook_url: "https://example.com/webhook/teams/approvals",
      channel_name: "Approvals",
      severity_threshold: "medium",
      throttle_window_minutes: 180
    });
    expect(createResponse.status).toBe(201);

    const firstResult = await withClientTransaction(leadershipTenantId, leadershipUserId, (client) =>
      queueOperationalAlert(client, {
        tenantId: leadershipTenantId,
        actorUserId: leadershipUserId,
        alertType: "approval_needed",
        title: "Approval needed for checklist handoff",
        summary: "A published checklist handoff is waiting on review.",
        severity: "high",
        deepLink: "#approvals?item=checklist-handoff",
        sourceEventType: "approval.requested",
        sourceEntityType: "checklist_submission",
        sourceEntityId: "checklist-handoff",
        dedupeKey: "approval-needed:test-checklist-handoff",
        metadata: {
          department: "production"
        },
        facts: [
          { label: "Department", value: "production" },
          { label: "Priority", value: "high" }
        ]
      })
    );

    const secondResult = await withClientTransaction(leadershipTenantId, leadershipUserId, (client) =>
      queueOperationalAlert(client, {
        tenantId: leadershipTenantId,
        actorUserId: leadershipUserId,
        alertType: "approval_needed",
        title: "Approval needed for checklist handoff",
        summary: "A published checklist handoff is waiting on review.",
        severity: "high",
        deepLink: "#approvals?item=checklist-handoff",
        sourceEventType: "approval.requested",
        sourceEntityType: "checklist_submission",
        sourceEntityId: "checklist-handoff",
        dedupeKey: "approval-needed:test-checklist-handoff",
        metadata: {
          department: "production"
        }
      })
    );

    expect(firstResult.queued_count).toBe(1);
    expect(firstResult.throttled_count).toBe(0);
    expect(firstResult.deliveries[0]?.status).toBe("queued");
    expect(firstResult.deliveries[0]?.app_event_id).toBeTruthy();

    expect(secondResult.queued_count).toBe(0);
    expect(secondResult.throttled_count).toBe(1);
    expect(secondResult.deliveries[0]?.status).toBe("throttled");
    expect(secondResult.deliveries[0]?.app_event_id).toBeNull();

    const deliveryRows = await pool.query(
      `
        SELECT status::text AS status, deep_link, request_payload, app_event_id
        FROM operational_alert_delivery
        WHERE tenant_id = $1
        ORDER BY created_at ASC
      `,
      [leadershipTenantId]
    );

    expect(deliveryRows.rows).toHaveLength(2);
    expect(deliveryRows.rows[0].status).toBe("queued");
    expect(deliveryRows.rows[0].deep_link).toBe(`${config.ADMIN_WEB_URL}/?teams=1#approvals?item=checklist-handoff`);
    expect(deliveryRows.rows[0].request_payload.alert.deep_link).toBe(`${config.ADMIN_WEB_URL}/?teams=1#approvals?item=checklist-handoff`);
    expect(deliveryRows.rows[0].app_event_id).toBeTruthy();
    expect(deliveryRows.rows[1].status).toBe("throttled");
    expect(deliveryRows.rows[1].app_event_id).toBeNull();

    const appEvents = await pool.query(
      "SELECT id FROM app_event WHERE tenant_id = $1 AND event_type = 'operational_alert.dispatch'",
      [leadershipTenantId]
    );
    expect(appEvents.rows).toHaveLength(1);

    const deliveriesResponse = await request(app)
      .get("/api/integrations/teams/operational-alerts/deliveries?limit=10")
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(deliveriesResponse.status).toBe(200);
    expect(deliveriesResponse.body).toHaveLength(2);
    expect(deliveriesResponse.body[0].title).toBe("Approval needed for checklist handoff");
    expect(deliveriesResponse.body.some((delivery: { status: string }) => delivery.status === "queued")).toBe(true);
    expect(deliveriesResponse.body.some((delivery: { status: string }) => delivery.status === "throttled")).toBe(true);
  });
});
