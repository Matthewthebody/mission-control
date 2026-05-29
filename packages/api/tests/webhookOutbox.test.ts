import request from "supertest";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { pool } from "../src/db/pool.js";

const app = createApp();
let tenantId = "";
const originalWebhookSecret = config.WEBHOOK_SHARED_SECRET;
const originalMicrosoftGraphWebhookClientState = config.MICROSOFT_GRAPH_WEBHOOK_CLIENT_STATE;
const originalTenantRouting = config.INTEGRATION_WEBHOOK_ALLOW_QUERY_TENANT_ROUTING;

beforeAll(async () => {
  const tenant = await pool.query("SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
  tenantId = tenant.rows[0].id;
});

afterEach(() => {
  config.WEBHOOK_SHARED_SECRET = originalWebhookSecret;
  config.MICROSOFT_GRAPH_WEBHOOK_CLIENT_STATE = originalMicrosoftGraphWebhookClientState;
  config.INTEGRATION_WEBHOOK_ALLOW_QUERY_TENANT_ROUTING = originalTenantRouting;
});

describe("integration webhook outbox dedupe", () => {
  it("echoes webhook challenges", async () => {
    const response = await request(app)
      .post(`/api/integrations/monday/webhook?tenant_id=${tenantId}`)
      .send({ challenge: "phase-one-challenge" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ challenge: "phase-one-challenge" });
  });

  it("echoes Microsoft Graph validation tokens without persisting webhook events", async () => {
    config.WEBHOOK_SHARED_SECRET = "phase-two-secret";

    const before = await pool.query(
      "SELECT count(*)::int AS count FROM app_event WHERE tenant_id = $1 AND event_type = 'microsoft_graph.webhook.received'",
      [tenantId]
    );

    const response = await request(app)
      .post(
        `/api/integrations/microsoft_graph/webhook?tenant_id=${tenantId}&validationToken=graph-phase-one-token`
      )
      .send({});

    const after = await pool.query(
      "SELECT count(*)::int AS count FROM app_event WHERE tenant_id = $1 AND event_type = 'microsoft_graph.webhook.received'",
      [tenantId]
    );

    expect(response.status).toBe(200);
    expect(response.text).toBe("graph-phase-one-token");
    expect(response.headers["content-type"]).toMatch(/text\/plain/i);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("accepts direct Microsoft Graph notifications when the configured client state matches and records the verification mode", async () => {
    config.WEBHOOK_SHARED_SECRET = "phase-two-secret";
    config.MICROSOFT_GRAPH_WEBHOOK_CLIENT_STATE = "graph-phase-one-client-state";

    const idempotencyKey = `microsoft-graph-client-state-${Date.now()}`;
    const response = await request(app)
      .post(`/api/integrations/microsoft_graph/webhook?tenant_id=${tenantId}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({
        value: [
          {
            subscriptionId: "subscription-direct-graph-1",
            clientState: "graph-phase-one-client-state",
            resource: "/users/leadership@example.com/events",
            resourceData: { id: "graph-event-1" }
          }
        ]
      });

    expect(response.status).toBe(202);

    const stored = await pool.query("SELECT payload FROM app_event WHERE tenant_id = $1 AND dedupe_key = $2 LIMIT 1", [
      tenantId,
      `microsoft_graph:${idempotencyKey}`
    ]);
    expect(stored.rows[0].payload.verification_mode).toBe("graph_client_state");
    expect(stored.rows[0].payload.body.value).toHaveLength(1);
  });

  it("rejects Microsoft Graph notifications when the client state does not match the configured value", async () => {
    config.WEBHOOK_SHARED_SECRET = "phase-two-secret";
    config.MICROSOFT_GRAPH_WEBHOOK_CLIENT_STATE = "graph-phase-one-client-state";

    const before = await pool.query(
      "SELECT count(*)::int AS count FROM app_event WHERE tenant_id = $1 AND event_type = 'microsoft_graph.webhook.received'",
      [tenantId]
    );

    const response = await request(app)
      .post(`/api/integrations/microsoft_graph/webhook?tenant_id=${tenantId}`)
      .send({
        value: [
          {
            subscriptionId: "subscription-direct-graph-2",
            clientState: "wrong-client-state",
            resource: "/users/leadership@example.com/events",
            resourceData: { id: "graph-event-2" }
          }
        ]
      });

    const after = await pool.query(
      "SELECT count(*)::int AS count FROM app_event WHERE tenant_id = $1 AND event_type = 'microsoft_graph.webhook.received'",
      [tenantId]
    );

    expect(response.status).toBe(401);
    expect(response.body.error).toMatch(/client state/i);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("dedupes duplicate webhook deliveries into a single app_event row", async () => {
    const idempotencyKey = "webhook-dedupe-key";
    const dedupeKey = `monday:${idempotencyKey}`;

    await pool.query("DELETE FROM app_event WHERE tenant_id = $1 AND dedupe_key = $2", [tenantId, dedupeKey]);

    const first = await request(app)
      .post(`/api/integrations/monday/webhook?tenant_id=${tenantId}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({ event: { type: "item_changed", id: "evt-1" } });

    const second = await request(app)
      .post(`/api/integrations/monday/webhook?tenant_id=${tenantId}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({ event: { type: "item_changed", id: "evt-1" } });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(first.body.id).toBe(second.body.id);

    const count = await pool.query("SELECT count(*)::int AS count FROM app_event WHERE tenant_id = $1 AND dedupe_key = $2", [
      tenantId,
      dedupeKey
    ]);
    expect(count.rows[0].count).toBe(1);
  });

  it("rejects unknown providers and malformed tenant routing before writing app events", async () => {
    const unknownProvider = await request(app)
      .post(`/api/integrations/not-a-provider/webhook?tenant_id=${tenantId}`)
      .send({ event: { type: "ignored" } });
    const invalidTenant = await request(app)
      .post("/api/integrations/monday/webhook?tenant_id=not-a-uuid")
      .send({ event: { type: "ignored" } });

    expect(unknownProvider.status).toBe(404);
    expect(invalidTenant.status).toBe(400);
  });

  it("requires configured webhook secrets and does not persist those secrets into webhook payload rows", async () => {
    config.WEBHOOK_SHARED_SECRET = "phase-two-secret";

    const rejected = await request(app)
      .post(`/api/integrations/monday/webhook?tenant_id=${tenantId}`)
      .send({ event: { type: "item_changed", id: "evt-secret-rejected" } });
    expect(rejected.status).toBe(401);

    const idempotencyKey = `webhook-secret-${Date.now()}`;
    const accepted = await request(app)
      .post(`/api/integrations/monday/webhook?tenant_id=${tenantId}`)
      .set("X-PMC-Webhook-Secret", "phase-two-secret")
      .set("Idempotency-Key", idempotencyKey)
      .send({ event: { type: "item_changed", id: "evt-secret-accepted" } });

    expect(accepted.status).toBe(202);

    const stored = await pool.query("SELECT payload FROM app_event WHERE tenant_id = $1 AND dedupe_key = $2 LIMIT 1", [
      tenantId,
      `monday:${idempotencyKey}`
    ]);
    expect(stored.rows[0].payload.headers["idempotency-key"]).toBe(idempotencyKey);
    expect(stored.rows[0].payload.headers["x-pmc-webhook-secret"]).toBeUndefined();
  });

  it("disables query-string tenant routing when the environment does not explicitly allow it", async () => {
    config.INTEGRATION_WEBHOOK_ALLOW_QUERY_TENANT_ROUTING = false;

    const response = await request(app)
      .post(`/api/integrations/monday/webhook?tenant_id=${tenantId}`)
      .send({ event: { type: "item_changed", id: "evt-routing-disabled" } });

    expect(response.status).toBe(503);
  });
});
