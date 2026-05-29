import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

const app = createApp();

let tenantId = "";
let adminToken = "";
let leadershipToken = "";
let photographerToken = "";
let leadershipUserId = "";
let studioId = "";
let organizationId = "";
let locationId = "";
let primaryContactId = "";

const createdShootIds: string[] = [];

function localDateString(offsetDays = 0) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function isoAt(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}

async function reconcileExceptions(date: string) {
  const response = await request(app)
    .post("/api/exceptions/reconcile")
    .set("Authorization", `Bearer ${leadershipToken}`)
    .send({ date });

  if (response.status !== 204) {
    throw new Error(`Reconcile failed with ${response.status}: ${JSON.stringify(response.body)}`);
  }
}

async function createShoot(code: string, title: string, date: string, startTime: string) {
  const response = await request(app)
    .post("/api/shoots")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      studio_id: studioId,
      organization_id: organizationId,
      location_id: locationId,
      primary_contact_id: primaryContactId,
      shoot_type: "schools_underclass_portraits",
      shoot_code: code,
      title,
      shoot_date: date,
      geofence_radius_meters: 1609,
      arrival_time: isoAt(date, startTime),
      start_time: isoAt(date, startTime),
      end_time_est: isoAt(date, "23:59"),
      projected_students: 55,
      planned_staff_count: 2,
      required_lead_count: 1
    });

  expect(response.status).toBe(201);
  createdShootIds.push(response.body.id);
  return response.body;
}

beforeAll(async () => {
  adminToken = (await devLogin(app, "admin@example.com")).body.token;
  leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;

  const context = await pool.query(
    `
      SELECT
        tenant.id AS tenant_id,
        leadership.id AS leadership_user_id,
        studio.id AS studio_id,
        org.id AS organization_id,
        loc.id AS location_id,
        contact.id AS primary_contact_id
      FROM tenant
      JOIN app_user leadership
        ON leadership.tenant_id = tenant.id
       AND lower(leadership.email) = lower('leadership@example.com')
      JOIN studio
        ON studio.tenant_id = tenant.id
       AND studio.name = 'Main Studio'
      JOIN organization org
        ON org.tenant_id = tenant.id
       AND org.display_name = 'White Bear Lake High School'
      JOIN shoot_location loc
        ON loc.tenant_id = tenant.id
       AND loc.organization_id = org.id
      JOIN organization_contact contact
        ON contact.tenant_id = tenant.id
       AND contact.organization_id = org.id
      WHERE tenant.name = 'Demo Studio'
      ORDER BY loc.created_at ASC, contact.created_at ASC
      LIMIT 1
    `
  );

  tenantId = context.rows[0].tenant_id;
  leadershipUserId = context.rows[0].leadership_user_id;
  studioId = context.rows[0].studio_id;
  organizationId = context.rows[0].organization_id;
  locationId = context.rows[0].location_id;
  primaryContactId = context.rows[0].primary_contact_id;
}, 20_000);

afterAll(async () => {
  if (createdShootIds.length) {
    await pool.query(
      `
        DELETE FROM urgent_watch_event
        WHERE tenant_id = $1
          AND urgent_watch_item_id IN (
            SELECT id
            FROM urgent_watch_item
            WHERE tenant_id = $1
              AND source_module = 'scheduling'
              AND source_entity_id = ANY($2::text[])
          )
      `,
      [tenantId, createdShootIds.map(String)]
    );
    await pool.query(
      `
        DELETE FROM urgent_watch_item
        WHERE tenant_id = $1
          AND source_module = 'scheduling'
          AND source_entity_id = ANY($2::text[])
      `,
      [tenantId, createdShootIds.map(String)]
    );
    await pool.query("DELETE FROM alert WHERE shoot_id = ANY($1::uuid[])", [createdShootIds]);
    await pool.query("DELETE FROM status_event WHERE shoot_id = ANY($1::uuid[])", [createdShootIds]);
    await pool.query("DELETE FROM shoot_contact_link WHERE shoot_id = ANY($1::uuid[])", [createdShootIds]);
    await pool.query("DELETE FROM shoot WHERE id = ANY($1::uuid[])", [createdShootIds]);
  }
});

describe("exception routes and watch compatibility aliases", () => {
  it("blocks standard employees from the watch compatibility route", async () => {
    const response = await request(app)
      .get(`/api/watch?date=${localDateString()}`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(response.status).toBe(403);
  });

  it("keeps exception reads pure until an explicit reconcile is requested", async () => {
    const today = localDateString();
    const shoot = await createShoot(`UW-${crypto.randomUUID().slice(0, 8)}`, "Read-only Exceptions Proof", today, "00:30");

    const before = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM urgent_watch_item
        WHERE tenant_id = $1
          AND source_module = 'scheduling'
          AND source_entity_id = $2
      `,
      [tenantId, shoot.id]
    );
    expect(before.rows[0].count).toBe(0);

    const readResponse = await request(app)
      .get(`/api/exceptions?date=${today}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(readResponse.status).toBe(200);

    const afterRead = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM urgent_watch_item
        WHERE tenant_id = $1
          AND source_module = 'scheduling'
          AND source_entity_id = $2
      `,
      [tenantId, shoot.id]
    );
    expect(afterRead.rows[0].count).toBe(0);

    await reconcileExceptions(today);

    const afterReconcile = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM urgent_watch_item
        WHERE tenant_id = $1
          AND source_module = 'scheduling'
          AND source_entity_id = $2
      `,
      [tenantId, shoot.id]
    );
    expect(afterReconcile.rows[0].count).toBeGreaterThan(0);
  }, 30_000);

  it("keeps the watch compatibility route working while the canonical queue lives at exceptions", async () => {
    const today = localDateString();
    const futureDate = localDateString(3);
    const overdueShoot = await createShoot(`UW-${crypto.randomUUID().slice(0, 8)}`, "Urgent Watch Overdue Shoot", today, "00:15");
    const futureShoot = await createShoot(`UW-${crypto.randomUUID().slice(0, 8)}`, "Urgent Watch Future Shoot", futureDate, "10:00");
    await reconcileExceptions(today);

    const workspaceResponse = await request(app)
      .get(`/api/watch?date=${today}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(workspaceResponse.status).toBe(200);
    expect(workspaceResponse.headers.deprecation).toBe("true");
    expect(workspaceResponse.headers["x-mission-control-compatibility-alias"]).toBe("/api/watch");
    expect(workspaceResponse.headers["x-mission-control-canonical-route"]).toBe("/api/exceptions");
    const relevantItems = workspaceResponse.body.items.filter((item: { source_entity_id: string }) =>
      [overdueShoot.id, futureShoot.id].includes(item.source_entity_id)
    );
    expect(relevantItems.length).toBeGreaterThanOrEqual(2);

    const overdueIndex = workspaceResponse.body.items.findIndex(
      (item: { source_entity_id: string; watch_type: string }) =>
        item.source_entity_id === overdueShoot.id && item.watch_type === "critical_role_gap"
    );
    const futureIndex = workspaceResponse.body.items.findIndex(
      (item: { source_entity_id: string; watch_type: string }) =>
        item.source_entity_id === futureShoot.id && item.watch_type === "critical_role_gap"
    );
    expect(overdueIndex).toBeGreaterThanOrEqual(0);
    expect(futureIndex).toBeGreaterThanOrEqual(0);
    expect(overdueIndex).toBeLessThan(futureIndex);

    const actionableItem = workspaceResponse.body.items.find(
      (item: { source_entity_id: string; watch_type: string }) =>
        item.source_entity_id === overdueShoot.id && item.watch_type === "critical_role_gap"
    );
    expect(actionableItem.action_hash).toContain("#scheduling");
    expect(actionableItem.action_hash).toContain(overdueShoot.id);

    const assignResponse = await request(app)
      .post(`/api/watch/${actionableItem.id}/actions`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        action: "assign_owner",
        owner_user_id: leadershipUserId,
        note: "Leadership is taking first response."
      });

    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body.item.owner_user_id).toBe(leadershipUserId);

    const snoozeResponse = await request(app)
      .post(`/api/watch/${actionableItem.id}/actions`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        action: "snooze",
        reason: "Waiting on a staffing callback.",
        duration_minutes: 30
      });

    expect(snoozeResponse.status).toBe(200);
    expect(snoozeResponse.body.item.status).toBe("snoozed");

    const workspaceAfterSnooze = await request(app)
      .get(`/api/watch?date=${today}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(workspaceAfterSnooze.status).toBe(200);
    expect(workspaceAfterSnooze.body.summary.red_count).toBe(
      workspaceAfterSnooze.body.items.filter((item: { status: string; severity: string }) => item.status === "active" && item.severity === "red").length
    );
    expect(workspaceAfterSnooze.body.summary.yellow_count).toBe(
      workspaceAfterSnooze.body.items.filter((item: { status: string; severity: string }) => item.status === "active" && item.severity === "yellow").length
    );
    expect(workspaceAfterSnooze.body.summary.overdue_count).toBe(
      workspaceAfterSnooze.body.items.filter((item: { status: string; timing_state: string }) => item.status === "active" && item.timing_state === "overdue").length
    );
    expect(workspaceAfterSnooze.body.summary.snoozed_count).toBe(
      workspaceAfterSnooze.body.items.filter((item: { status: string }) => item.status === "snoozed").length
    );

    const handledResponse = await request(app)
      .post(`/api/watch/${actionableItem.id}/actions`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        action: "mark_handled",
        note: "Coverage owner assigned and escalation handoff complete."
      });

    expect(handledResponse.status).toBe(200);
    expect(handledResponse.body.item.status).toBe("handled");
    expect(handledResponse.body.history.some((event: { event_type: string }) => event.event_type === "watch.generated")).toBe(true);
    expect(handledResponse.body.history.some((event: { event_type: string }) => event.event_type === "watch.owner_assigned")).toBe(true);
    expect(handledResponse.body.history.some((event: { event_type: string }) => event.event_type === "watch.snoozed")).toBe(true);
    expect(handledResponse.body.history.some((event: { event_type: string }) => event.event_type === "watch.handled")).toBe(true);
  }, 35_000);

  it("records watch.updated when a live item changes without closing", async () => {
    const today = localDateString();
    const shoot = await createShoot(`UW-${crypto.randomUUID().slice(0, 8)}`, "Urgent Watch Update Source", today, "01:00");
    await reconcileExceptions(today);

    const initialWorkspace = await request(app)
      .get(`/api/watch?date=${today}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(initialWorkspace.status).toBe(200);
    const watchItem = initialWorkspace.body.items.find(
      (item: { source_entity_id: string; watch_type: string }) =>
        item.source_entity_id === shoot.id && item.watch_type === "critical_role_gap"
    );
    expect(watchItem).toBeTruthy();

    await pool.query(
      `
        UPDATE shoot
        SET title = $3,
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [tenantId, shoot.id, "Urgent Watch Update Source (Edited)"]
    );
    await reconcileExceptions(today);

    const refreshedWorkspace = await request(app)
      .get(`/api/watch?date=${today}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(refreshedWorkspace.status).toBe(200);

    const detailResponse = await request(app)
      .get(`/api/watch/${watchItem.id}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.item.summary).toContain("Edited");
    expect(detailResponse.body.history.some((event: { event_type: string }) => event.event_type === "watch.updated")).toBe(true);
    expect(detailResponse.body.history.some((event: { event_type: string }) => event.event_type === "watch.reopened")).toBe(false);
  }, 35_000);

  it("serves canonical exception detail and actions from /api/exceptions", async () => {
    const today = localDateString();
    const shoot = await createShoot(`EX-${crypto.randomUUID().slice(0, 8)}`, "Canonical Exceptions Shoot", today, "00:30");
    await reconcileExceptions(today);

    const response = await request(app)
      .get(`/api/exceptions?date=${today}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    const item = response.body.items.find(
      (candidate: { entity_id: string; type: string }) => candidate.entity_id === shoot.id && candidate.type === "critical_role_gap"
    );

    expect(item).toBeTruthy();
    expect(item.category).toBe("staffing");
    expect(item.status).toBe("open");
    expect(item.severity).toBe("blocking");
    expect(item.blocking).toBe(true);
    expect(item.source_module).toBe("scheduling");
    expect(item.workflow_run_id).toBeNull();

    expect(response.body.summary.open_count).toBe(
      response.body.items.filter((candidate: { status: string }) => candidate.status === "open").length
    );
    expect(response.body.summary.blocking_count).toBe(
      response.body.items.filter((candidate: { severity: string; status: string }) => candidate.status === "open" && candidate.severity === "blocking")
        .length
    );

    const detailResponse = await request(app)
      .get(`/api/exceptions/${item.id}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.item.id).toBe(item.id);
    expect(detailResponse.body.item.type).toBe("critical_role_gap");

    const actionResponse = await request(app)
      .post(`/api/exceptions/${item.id}/actions`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        action: "assign_owner",
        owner_user_id: leadershipUserId,
        note: "Canonical exceptions route owns the assignment."
      });

    expect(actionResponse.status).toBe(200);
    expect(actionResponse.body.item.owner_user_id).toBe(leadershipUserId);
    expect(actionResponse.body.history.some((event: { event_type: string }) => event.event_type === "watch.owner_assigned")).toBe(true);
  }, 30_000);
});
