import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { elevateSession, getMembershipId, getTenantId, passwordLogin } from "./helpers.js";

const app = createApp();

let adminToken = "";
let leadershipToken = "";
let adminUserId = "";
let leadershipUserId = "";
let associateUserId = "";
let demoTenantId = "";

beforeAll(async () => {
  const migrationSql = await readFile(
    resolve(process.cwd(), "../../db/migrations/119_communication_identity_linking_phase1.sql"),
    "utf8"
  );
  try {
    await pool.query(migrationSql);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("already exists")) {
      throw error;
    }
  }
  adminToken = (await passwordLogin(app, "admin@example.com")).body.token;
  leadershipToken = (await passwordLogin(app, "leadership@example.com")).body.token;
  await elevateSession(app, adminToken, "LocalDemo123!");
  await elevateSession(app, leadershipToken, "LocalDemo123!");
  adminUserId = String(await getMembershipId("admin@example.com"));
  leadershipUserId = String(await getMembershipId("leadership@example.com"));
  associateUserId = String(await getMembershipId("associate@example.com"));
  demoTenantId = String(await getTenantId("Demo Studio"));
});

describe("shared access policy workspace", () => {
  it("allows admin access and blocks leadership from the admin-only workspace", async () => {
    const adminResponse = await request(app)
      .get("/api/access/policy/workspace")
      .set("Authorization", `Bearer ${adminToken}`);
    const leadershipResponse = await request(app)
      .get("/api/access/policy/workspace")
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(adminResponse.status).toBe(200);
    expect(adminResponse.body.roles.length).toBeGreaterThan(0);
    expect(adminResponse.body.permissions.length).toBeGreaterThan(0);
    expect(adminResponse.body.field_rules.length).toBeGreaterThan(0);
    expect(adminResponse.body.users.some((user: { communication_identity_status?: string }) => user.communication_identity_status)).toBe(true);
    expect(leadershipResponse.status).toBe(403);
  });

  it("creates and expires user role assignments with policy audit coverage", async () => {
    const reason = `Access policy assignment ${Date.now()}`;
    const createResponse = await request(app)
      .post("/api/access/policy/assignments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        user_id: associateUserId,
        role_code: "department_observer",
        scope_type: "department",
        scope_value: "sports",
        reason
      });

    expect(createResponse.status).toBe(201);

    const assignmentRow = await pool.query<{ id: string }>(
      `
        SELECT id::text
        FROM user_role_assignment
        WHERE tenant_id = $1
          AND user_id = $2
          AND reason = $3
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [demoTenantId, associateUserId, reason]
    );

    expect(assignmentRow.rows[0]?.id).toBeTruthy();

    const expireResponse = await request(app)
      .post(`/api/access/policy/assignments/${assignmentRow.rows[0].id}/expire`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Coverage window closed." });

    expect(expireResponse.status).toBe(200);

    const auditRows = await pool.query<{ policy_event_type: string }>(
      `
        SELECT policy_event_type
        FROM policy_audit_event
        WHERE tenant_id = $1
          AND target_user_id = $2
          AND policy_event_type IN ('role_assignment_created', 'role_assignment_expired')
        ORDER BY created_at DESC
      `,
      [demoTenantId, associateUserId]
    );

    const events = auditRows.rows.map((row) => row.policy_event_type);
    expect(events).toContain("role_assignment_created");
    expect(events).toContain("role_assignment_expired");
  });

  it("creates overrides and delegations and records both in the policy audit log", async () => {
    const overrideReason = `Access policy override ${Date.now()}`;
    const overrideResponse = await request(app)
      .post("/api/access/policy/overrides")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        user_id: associateUserId,
        permission_code: "job.read",
        scope_type: "department",
        scope_value: "sports",
        effect: "allow",
        reason: overrideReason
      });

    expect(overrideResponse.status).toBe(201);

    const overrideRow = await pool.query<{ id: string }>(
      `
        SELECT id::text
        FROM permission_override
        WHERE tenant_id = $1
          AND user_id = $2
          AND reason = $3
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [demoTenantId, associateUserId, overrideReason]
    );

    expect(overrideRow.rows[0]?.id).toBeTruthy();

    const expireOverrideResponse = await request(app)
      .post(`/api/access/policy/overrides/${overrideRow.rows[0].id}/expire`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "No longer needed." });

    expect(expireOverrideResponse.status).toBe(200);

    const delegationReason = `Coverage delegation ${Date.now()}`;
    const createDelegationResponse = await request(app)
      .post("/api/access/policy/delegations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        from_user_id: adminUserId,
        to_user_id: leadershipUserId,
        role_code: "department_observer",
        scope_type: "department",
        scope_value: "sports",
        starts_at: new Date(Date.now() - 60_000).toISOString(),
        ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        reason: delegationReason
      });

    expect(createDelegationResponse.status).toBe(201);

    const delegationRow = await pool.query<{ id: string }>(
      `
        SELECT id::text
        FROM delegation_assignment
        WHERE tenant_id = $1
          AND reason = $2
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [demoTenantId, delegationReason]
    );

    expect(delegationRow.rows[0]?.id).toBeTruthy();

    const revokeDelegationResponse = await request(app)
      .post(`/api/access/policy/delegations/${delegationRow.rows[0].id}/revoke`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Coverage ended." });

    expect(revokeDelegationResponse.status).toBe(200);

    const auditRows = await pool.query<{ policy_event_type: string }>(
      `
        SELECT policy_event_type
        FROM policy_audit_event
        WHERE tenant_id = $1
          AND policy_event_type IN (
            'permission_override_created',
            'permission_override_expired',
            'delegation_created',
            'delegation_revoked'
          )
        ORDER BY created_at DESC
      `,
      [demoTenantId]
    );

    const events = auditRows.rows.map((row) => row.policy_event_type);
    expect(events).toContain("permission_override_created");
    expect(events).toContain("permission_override_expired");
    expect(events).toContain("delegation_created");
    expect(events).toContain("delegation_revoked");
  });

  it("returns access previews for admins and blocks leadership from previewing another user", async () => {
    const adminPreview = await request(app)
      .post("/api/access/policy/preview")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        target_user_id: associateUserId,
        route_id: "dashboard",
        resource_type: "shared_job",
        permission_keys: ["job.read", "job.update"],
        context: {
          departmentType: "sports",
          targetUserId: associateUserId
        }
      });

    const leadershipPreview = await request(app)
      .post("/api/access/policy/preview")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        target_user_id: associateUserId,
        route_id: "dashboard",
        resource_type: "shared_job",
        permission_keys: ["job.read"]
      });

    expect(adminPreview.status).toBe(200);
    expect(adminPreview.body.permissions).toEqual(["job.read", "job.update"]);
    expect(Array.isArray(adminPreview.body.explanation)).toBe(true);
    expect(leadershipPreview.status).toBe(403);
  });
});
