import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { pool } from "../src/db/pool.js";
import type { ZendeskCategoryRule, ZendeskProviderTicket } from "../src/types/zendesk.js";
import { buildMockZendeskFixtureTickets } from "../src/services/zendeskFixtures.js";
import { classifyZendeskTicket } from "../src/services/zendesk.js";
import { passwordLogin } from "./helpers.js";

const app = createApp();

let leadershipToken = "";
let officeToken = "";
let photoToken = "";
let tenantId = "";

const originalZendeskConfig = {
  enabled: config.ZENDESK_ENABLED,
  subdomain: config.ZENDESK_SUBDOMAIN,
  authMode: config.ZENDESK_AUTH_MODE,
  email: config.ZENDESK_EMAIL,
  apiToken: config.ZENDESK_API_TOKEN,
  accessToken: config.ZENDESK_ACCESS_TOKEN
};

beforeAll(async () => {
  leadershipToken = (await passwordLogin(app, "leadership@example.com")).body.token;
  officeToken = (await passwordLogin(app, "office@example.com")).body.token;
  photoToken = (await passwordLogin(app, "photo@example.com")).body.token;
  const result = await pool.query("SELECT tenant_id FROM app_user WHERE lower(email) = lower($1) LIMIT 1", ["leadership@example.com"]);
  tenantId = result.rows[0].tenant_id as string;
});

beforeEach(async () => {
  await pool.query("DELETE FROM zendesk_daily_metric WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM zendesk_ticket_cache WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM zendesk_sync_run WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM zendesk_connection WHERE tenant_id = $1", [tenantId]);
  restoreZendeskConfig();
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreZendeskConfig();
});

describe("zendesk leadership reporting", () => {
  it("classifies categories using configured rules before fallback heuristics", () => {
    const rule: ZendeskCategoryRule = {
      id: "rule-1",
      category: "schools",
      rule_type: "group",
      field_key: null,
      match_value: "schools support",
      priority: 10,
      enabled: true
    };
    const sportsFallbackTicket: ZendeskProviderTicket = {
      zendesk_ticket_id: "ticket-1",
      subject: "Coach requested an athletics reorder",
      requester_name: null,
      requester_email: null,
      assignee_name: null,
      assignee_id: null,
      organization_name: null,
      group_name: "Sports Support",
      form_name: null,
      status: "open",
      priority: null,
      ticket_created_at: new Date().toISOString(),
      ticket_updated_at: new Date().toISOString(),
      ticket_solved_at: null,
      first_reply_minutes: null,
      resolution_minutes: null,
      tags: ["billing"],
      external_url: null,
      is_deleted: false,
      custom_fields: {},
      raw_payload: {}
    };

    expect(classifyZendeskTicket({ ...sportsFallbackTicket, group_name: "Schools Support" }, [rule])).toBe("schools");
    expect(classifyZendeskTicket(sportsFallbackTicket, [])).toBe("sports");
  });

  it("serves demo-mode leadership metrics, trends, and ticket visibility from the local cache", async () => {
    config.ZENDESK_ENABLED = false;
    const fixtureTickets = buildMockZendeskFixtureTickets();
    const expectedOpenCount = fixtureTickets.filter((ticket) => !["solved", "closed"].includes(ticket.status)).length;

    const [status, summary, trends, ticketList] = await Promise.all([
      request(app).get("/api/integrations/zendesk/status").set("Authorization", `Bearer ${leadershipToken}`),
      request(app).get("/api/zendesk/leadership-summary").set("Authorization", `Bearer ${leadershipToken}`),
      request(app).get("/api/zendesk/leadership-trends?range=7d").set("Authorization", `Bearer ${leadershipToken}`),
      request(app).get("/api/zendesk/leadership-ticket-list?status=open&limit=5").set("Authorization", `Bearer ${leadershipToken}`)
    ]);

    expect(status.status).toBe(200);
    expect(status.body.connection.provider_mode).toBe("mock");
    expect(status.body.connection.demo_mode).toBe(true);
    expect(status.body.sync_runs.length).toBeGreaterThan(0);

    expect(summary.status).toBe(200);
    expect(summary.body.kpis.open_tickets).toBe(expectedOpenCount);
    expect(summary.body.category_breakdown.map((row: { category: string }) => row.category)).toEqual(["schools", "sports", "other"]);
    expect(summary.body.queue_health.aging_buckets).toHaveLength(4);

    expect(trends.status).toBe(200);
    expect(trends.body.points.length).toBe(7);

    expect(ticketList.status).toBe(200);
    expect(ticketList.body.tickets.length).toBeLessThanOrEqual(5);
    expect(ticketList.body.tickets.every((ticket: { status: string }) => !["solved", "closed"].includes(ticket.status))).toBe(true);
  });

  it("keeps Zendesk reporting reads pure when the integration is disconnected", async () => {
    config.ZENDESK_ENABLED = false;

    const countsBefore = await pool.query<{
      connection_count: string;
      sync_run_count: string;
      cache_count: string;
    }>(
      `
        SELECT
          (SELECT count(*)::text FROM zendesk_connection WHERE tenant_id = $1) AS connection_count,
          (SELECT count(*)::text FROM zendesk_sync_run WHERE tenant_id = $1) AS sync_run_count,
          (SELECT count(*)::text FROM zendesk_ticket_cache WHERE tenant_id = $1) AS cache_count
      `,
      [tenantId]
    );

    const [status, summary, trends, ticketList] = await Promise.all([
      request(app).get("/api/integrations/zendesk/status").set("Authorization", `Bearer ${leadershipToken}`),
      request(app).get("/api/zendesk/leadership-summary").set("Authorization", `Bearer ${leadershipToken}`),
      request(app).get("/api/zendesk/leadership-trends?range=7d").set("Authorization", `Bearer ${leadershipToken}`),
      request(app).get("/api/zendesk/leadership-ticket-list?status=open&limit=5").set("Authorization", `Bearer ${leadershipToken}`)
    ]);

    expect(status.status).toBe(200);
    expect(summary.status).toBe(200);
    expect(trends.status).toBe(200);
    expect(ticketList.status).toBe(200);

    const countsAfter = await pool.query<{
      connection_count: string;
      sync_run_count: string;
      cache_count: string;
    }>(
      `
        SELECT
          (SELECT count(*)::text FROM zendesk_connection WHERE tenant_id = $1) AS connection_count,
          (SELECT count(*)::text FROM zendesk_sync_run WHERE tenant_id = $1) AS sync_run_count,
          (SELECT count(*)::text FROM zendesk_ticket_cache WHERE tenant_id = $1) AS cache_count
      `,
      [tenantId]
    );

    expect(countsAfter.rows[0]).toEqual(countsBefore.rows[0]);
  });

  it("allows customer service visibility while keeping field photographers out of the reporting module", async () => {
    const officeResponse = await request(app)
      .get("/api/zendesk/leadership-summary")
      .set("Authorization", `Bearer ${officeToken}`);

    expect(officeResponse.status).toBe(200);

    const photoResponse = await request(app)
      .get("/api/zendesk/leadership-summary")
      .set("Authorization", `Bearer ${photoToken}`);

    expect(photoResponse.status).toBe(403);
  });

  it("tests and syncs live zendesk data through the reporting cache when credentials are configured", async () => {
    config.ZENDESK_ENABLED = true;
    config.ZENDESK_SUBDOMAIN = "kemmetmueller-demo";
    config.ZENDESK_AUTH_MODE = "api_token";
    config.ZENDESK_EMAIL = "leader@example.com";
    config.ZENDESK_API_TOKEN = "demo-token";
    const openCreatedAt = new Date();
    openCreatedAt.setDate(openCreatedAt.getDate() - 2);
    openCreatedAt.setHours(14, 0, 0, 0);
    const openUpdatedAt = new Date(openCreatedAt.getTime());
    openUpdatedAt.setDate(openUpdatedAt.getDate() + 1);
    openUpdatedAt.setHours(8, 0, 0, 0);
    const solvedCreatedAt = new Date();
    solvedCreatedAt.setDate(solvedCreatedAt.getDate() - 5);
    solvedCreatedAt.setHours(12, 0, 0, 0);
    const solvedUpdatedAt = new Date(solvedCreatedAt.getTime());
    solvedUpdatedAt.setDate(solvedUpdatedAt.getDate() + 1);
    solvedUpdatedAt.setHours(9, 0, 0, 0);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/users/me.json")) {
        return buildJsonResponse({ user: { id: 1, email: "leader@example.com" } });
      }
      if (url.includes("/incremental/tickets/cursor.json")) {
        return buildJsonResponse({
          tickets: [
            {
              id: 901,
              subject: "School ordering question",
              requester_id: 4001,
              assignee_id: 5001,
              organization_id: 6001,
              group_id: 7001,
              ticket_form_id: 8001,
              status: "open",
              priority: "high",
              created_at: openCreatedAt.toISOString(),
              updated_at: openUpdatedAt.toISOString(),
              solved_at: null,
              tags: ["schools", "ordering"],
              custom_fields: []
            },
            {
              id: 902,
              subject: "Sports gallery access request",
              requester_id: 4002,
              assignee_id: 5002,
              organization_id: 6002,
              group_id: 7002,
              ticket_form_id: 8002,
              status: "solved",
              priority: "normal",
              created_at: solvedCreatedAt.toISOString(),
              updated_at: solvedUpdatedAt.toISOString(),
              solved_at: solvedUpdatedAt.toISOString(),
              tags: ["gallery"],
              custom_fields: []
            }
          ],
          users: [
            { id: 4001, name: "Northview School", email: "office@northview.example.com" },
            { id: 4002, name: "Metro Hoops", email: "coach@metrohoops.example.com" },
            { id: 5001, name: "Casey Support", email: "casey@example.com" },
            { id: 5002, name: "Jordan Support", email: "jordan@example.com" }
          ],
          organizations: [
            { id: 6001, name: "Northview Elementary" },
            { id: 6002, name: "Metro Hoops Academy" }
          ],
          groups: [
            { id: 7001, name: "Schools Support" },
            { id: 7002, name: "Sports Support" }
          ],
          ticket_forms: [
            { id: 8001, name: "Schools Request" },
            { id: 8002, name: "Sports Request" }
          ],
          metric_sets: [
            { ticket_id: 901, reply_time_in_minutes: { calendar: 18 }, full_resolution_time_in_minutes: null },
            { ticket_id: 902, reply_time_in_minutes: { calendar: 25 }, full_resolution_time_in_minutes: { calendar: 900 } }
          ],
          end_of_stream: true,
          after_cursor: "cursor-2",
          meta: {
            after_cursor: "cursor-2",
            has_more: false
          }
        });
      }
      throw new Error(`Unexpected Zendesk fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const testResponse = await request(app)
      .post("/api/integrations/zendesk/test")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(testResponse.status).toBe(200);
    expect(testResponse.body.ok).toBe(true);
    expect(testResponse.body.mode).toBe("zendesk_live");

    const syncResponse = await request(app)
      .post("/api/zendesk/sync")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(syncResponse.status).toBe(200);
    expect(syncResponse.body.connection.provider_mode).toBe("zendesk_live");
    expect(syncResponse.body.sync_run.records_synced).toBe(2);

    const summary = await request(app)
      .get("/api/zendesk/leadership-summary")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(summary.status).toBe(200);
    expect(summary.body.connection.provider_mode).toBe("zendesk_live");
    expect(summary.body.kpis.open_tickets).toBe(1);
    expect(summary.body.category_breakdown.find((row: { category: string }) => row.category === "schools")?.total_count).toBeGreaterThan(0);
    expect(summary.body.category_breakdown.find((row: { category: string }) => row.category === "sports")?.resolved_count).toBeGreaterThan(0);
  });
});

function restoreZendeskConfig() {
  config.ZENDESK_ENABLED = originalZendeskConfig.enabled;
  config.ZENDESK_SUBDOMAIN = originalZendeskConfig.subdomain;
  config.ZENDESK_AUTH_MODE = originalZendeskConfig.authMode;
  config.ZENDESK_EMAIL = originalZendeskConfig.email;
  config.ZENDESK_API_TOKEN = originalZendeskConfig.apiToken;
  config.ZENDESK_ACCESS_TOKEN = originalZendeskConfig.accessToken;
}

function buildJsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    }
  } as Response;
}
