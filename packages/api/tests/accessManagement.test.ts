import crypto from "node:crypto";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { hashPassword } from "../src/services/auth.js";
import { elevateSession, getMembershipId, getTenantId, passwordLogin } from "./helpers.js";

const app = createApp();

let ownerToken = "";
let adminToken = "";
let leadershipToken = "";
let associateToken = "";
let matthewId = "";
let demoTenantId = "";

beforeAll(async () => {
  ownerToken = (await passwordLogin(app, "matthew@example.com")).body.token;
  adminToken = (await passwordLogin(app, "admin@example.com")).body.token;
  leadershipToken = (await passwordLogin(app, "leadership@example.com")).body.token;
  associateToken = (await passwordLogin(app, "associate@example.com")).body.token;
  await elevateSession(app, ownerToken, "LocalDemo123!");
  await elevateSession(app, adminToken, "LocalDemo123!");
  await elevateSession(app, leadershipToken, "LocalDemo123!");
  matthewId = String(await getMembershipId("matthew@example.com"));
  demoTenantId = String(await getTenantId("Demo Studio"));
});

describe("access management flows", () => {
  it("lets owner_admin invite, accept, and approve a pending user", async () => {
    const email = `invite-${Date.now()}@example.com`;
    const invite = await request(app)
      .post("/api/access/invites")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        email,
        full_name: "Invited Office User",
        authority_tier: "standard_employee",
        primary_profile: "customer_service_rep",
        job_function_profiles: ["customer_service_rep"],
        department: "office"
      });

    expect(invite.status).toBe(201);
    expect(invite.body.invite_token).toBeTruthy();

    const accept = await request(app).post("/auth/invites/accept").send({
      token: invite.body.invite_token,
      full_name: "Invited Office User",
      password: "AcceptedDemo123!"
    });

    expect(accept.status).toBe(201);
    expect(accept.body.status).toBe("pending_approval");

    const loginBeforeApproval = await request(app).post("/auth/login").send({
      email,
      password: "AcceptedDemo123!"
    });
    expect(loginBeforeApproval.status).toBe(403);

    const membershipId = await getMembershipId(email);
    const approve = await request(app)
      .post(`/api/access/memberships/${membershipId}/approve`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        authority_tier: "standard_employee",
        primary_profile: "customer_service_rep",
        job_function_profiles: ["customer_service_rep"],
        department: "office"
      });

    expect(approve.status).toBe(200);

    const loginAfterApproval = await request(app).post("/auth/login").send({
      email,
      password: "AcceptedDemo123!"
    });
    expect(loginAfterApproval.status).toBe(200);

    const auditRows = await pool.query(
      `
        SELECT action
        FROM audit_log
        WHERE tenant_id = $1
          AND target_user_id = $2
        ORDER BY created_at ASC
      `,
      [demoTenantId, membershipId]
    );

    const actions = auditRows.rows.map((row) => row.action);
    expect(actions).toContain("user.invited");
    expect(actions).toContain("user.invite_accepted");
    expect(actions).toContain("user.approved");
  });

  it("blocks directors from access-management mutations even when they have broad operational access", async () => {
    const lowerEmail = `field-${Date.now()}@example.com`;
    const lowerInvite = await request(app)
      .post("/api/access/invites")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        email: lowerEmail,
        full_name: "Field User",
        authority_tier: "standard_employee",
        primary_profile: "associate_photographer",
        job_function_profiles: ["associate_photographer"],
        department: "schools"
      });

    expect(lowerInvite.status).toBe(403);
  });

  it("allows leadership to read directory data but blocks non-super-admin mutations", async () => {
    const leadershipList = await request(app).get("/api/access/users").set("Authorization", `Bearer ${leadershipToken}`);
    const leadershipInvite = await request(app)
      .post("/api/access/invites")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        email: `leadership-blocked-${Date.now()}@example.com`,
        full_name: "Leadership Blocked",
        authority_tier: "standard_employee",
        primary_profile: "customer_service_rep",
        job_function_profiles: ["customer_service_rep"],
        department: "office"
      });
    const associateList = await request(app).get("/api/access/users").set("Authorization", `Bearer ${associateToken}`);

    expect(leadershipList.status).toBe(200);
    expect(leadershipInvite.status).toBe(403);
    expect(associateList.status).toBe(403);
  });

  it("keeps audit-log visibility limited to privileged users", async () => {
    const ownerAuditLogs = await request(app).get("/api/access/audit-logs").set("Authorization", `Bearer ${ownerToken}`);
    const associateAuditLogs = await request(app).get("/api/access/audit-logs").set("Authorization", `Bearer ${associateToken}`);

    expect(ownerAuditLogs.status).toBe(200);
    expect(Array.isArray(ownerAuditLogs.body)).toBe(true);
    expect(associateAuditLogs.status).toBe(403);
  });

  it("prevents demotion, suspension, or revocation of the last active owner_admin", async () => {
    const demote = await request(app)
      .patch(`/api/access/memberships/${matthewId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        authority_tier: "director_admin",
        primary_profile: "director_of_photography",
        job_function_profiles: ["director_of_photography"],
        reason: "Owner role safety regression"
      });

    const suspend = await request(app)
      .post(`/api/access/memberships/${matthewId}/suspend`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const revoke = await request(app)
      .post(`/api/access/memberships/${matthewId}/revoke`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(demote.status).toBe(400);
    expect(suspend.status).toBe(400);
    expect(revoke.status).toBe(400);
  });

  it("invalidates an existing session after suspension", async () => {
    const email = `suspend-${Date.now()}@example.com`;
    const invite = await request(app)
      .post("/api/access/invites")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        email,
        full_name: "Suspend Me",
        authority_tier: "standard_employee",
        primary_profile: "customer_service_rep",
        job_function_profiles: ["customer_service_rep"],
        department: "office"
      });
    const inviteToken = invite.body.invite_token as string;
    await request(app).post("/auth/invites/accept").send({
      token: inviteToken,
      full_name: "Suspend Me",
      password: "SuspendDemo123!"
    });
    const membershipId = String(await getMembershipId(email));
    await request(app)
      .post(`/api/access/memberships/${membershipId}/approve`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        authority_tier: "standard_employee",
        primary_profile: "customer_service_rep",
        job_function_profiles: ["customer_service_rep"],
        department: "office"
      });

    const officeLogin = await request(app).post("/auth/login").send({
      email,
      password: "SuspendDemo123!"
    });
    const token = officeLogin.body.token as string;

    const suspend = await request(app)
      .post(`/api/access/memberships/${membershipId}/suspend`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(suspend.status).toBe(200);

    const meAfterSuspend = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(meAfterSuspend.status).toBe(401);

    const reactivate = await request(app)
      .post(`/api/access/memberships/${membershipId}/reactivate`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(reactivate.status).toBe(200);
  });

  it("invalidates existing sessions on role change and applies lower permissions on next login", async () => {
    const email = `demote-${Date.now()}@example.com`;
    const invite = await request(app)
      .post("/api/access/invites")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        email,
        full_name: "Temporary Director",
        authority_tier: "director_admin",
        primary_profile: "director_of_photography",
        job_function_profiles: ["director_of_photography"],
        department: "schools"
      });
    const inviteToken = invite.body.invite_token as string;
    await request(app).post("/auth/invites/accept").send({
      token: inviteToken,
      full_name: "Temporary Director",
      password: "DirectorDemo123!"
    });
    const membershipId = String(await getMembershipId(email));
    await request(app)
      .post(`/api/access/memberships/${membershipId}/approve`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        authority_tier: "director_admin",
        primary_profile: "director_of_photography",
        job_function_profiles: ["director_of_photography"],
        department: "schools"
      });

    const directorLogin = await request(app).post("/auth/login").send({
      email,
      password: "DirectorDemo123!"
    });
    const directorToken = directorLogin.body.token as string;

    const beforeDemotion = await request(app).get("/api/alerts").set("Authorization", `Bearer ${directorToken}`);
    expect(beforeDemotion.status).toBe(200);

    const demote = await request(app)
      .patch(`/api/access/memberships/${membershipId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        authority_tier: "standard_employee",
        primary_profile: "associate_photographer",
        job_function_profiles: ["associate_photographer"],
        department: "schools",
        reason: "Demotion regression path"
      });

    expect(demote.status).toBe(200);

    const oldTokenResponse = await request(app).get("/api/alerts").set("Authorization", `Bearer ${directorToken}`);
    expect(oldTokenResponse.status).toBe(401);

    const relogin = await request(app).post("/auth/login").send({
      email,
      password: "DirectorDemo123!"
    });
    expect(relogin.status).toBe(200);

    const postDemotionAlerts = await request(app).get("/api/alerts").set("Authorization", `Bearer ${relogin.body.token}`);
    expect(postDemotionAlerts.status).toBe(403);
  });

  it("blocks revoked users from future access", async () => {
    const email = `revoked-${Date.now()}@example.com`;
    const invite = await request(app)
      .post("/api/access/invites")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        email,
        full_name: "Revoke Me",
        authority_tier: "standard_employee",
        primary_profile: "customer_service_rep",
        job_function_profiles: ["customer_service_rep"],
        department: "office"
      });
    await request(app).post("/auth/invites/accept").send({
      token: invite.body.invite_token,
      full_name: "Revoke Me",
      password: "RevokedDemo123!"
    });
    const membershipId = String(await getMembershipId(email));
    await request(app)
      .post(`/api/access/memberships/${membershipId}/approve`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        authority_tier: "standard_employee",
        primary_profile: "customer_service_rep",
        job_function_profiles: ["customer_service_rep"],
        department: "office"
      });

    const login = await request(app).post("/auth/login").send({
      email,
      password: "RevokedDemo123!"
    });
    const token = login.body.token as string;

    const revoke = await request(app)
      .post(`/api/access/memberships/${membershipId}/revoke`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(revoke.status).toBe(200);

    const meAfterRevoke = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    const loginAfterRevoke = await request(app).post("/auth/login").send({
      email,
      password: "RevokedDemo123!"
    });

    expect(meAfterRevoke.status).toBe(401);
    expect(loginAfterRevoke.status).toBe(403);
  });

  it("scopes access-management user lists to the active tenant", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const tenant = (
        await client.query(
          `
            INSERT INTO tenant (name)
            VALUES ($1)
            ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
            RETURNING id
          `,
          [`Isolation Access ${Date.now()}`]
        )
      ).rows[0];
      const account = (
        await client.query(
          `
            INSERT INTO user_account (email, full_name, password_hash, is_email_verified)
            VALUES ($1,$2,$3,true)
            ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, password_hash = EXCLUDED.password_hash
            RETURNING id
          `,
          ["isolation-access-owner@example.com", "Isolation Access Owner", await hashPassword("LocalDemo123!")]
        )
      ).rows[0];
      const membership = (
        await client.query(
          `
            INSERT INTO app_user (
              tenant_id, account_id, email, full_name, department, status, approved_at, is_active
            )
            VALUES ($1,$2,$3,$4,'operations','active',now(),true)
            ON CONFLICT (tenant_id, email) DO UPDATE SET account_id = EXCLUDED.account_id, status = 'active', is_active = true
            RETURNING id
          `,
          [tenant.id, account.id, "isolation-access-owner@example.com", "Isolation Access Owner"]
        )
      ).rows[0];
      const role = (await client.query("SELECT id FROM role WHERE code = 'owner_admin' LIMIT 1")).rows[0];
      await client.query("DELETE FROM user_role WHERE tenant_id = $1 AND user_id = $2", [tenant.id, membership.id]);
      await client.query("INSERT INTO user_role (tenant_id, user_id, role_id) VALUES ($1,$2,$3)", [tenant.id, membership.id, role.id]);
      await client.query(
        `
          INSERT INTO user_authority_assignment (tenant_id, user_id, authority_tier, primary_job_function_profile, scope_department)
          VALUES ($1, $2, 'super_admin', 'leadership_team_member', 'executive')
          ON CONFLICT (tenant_id, user_id) DO UPDATE
          SET authority_tier = 'super_admin',
              primary_job_function_profile = 'leadership_team_member',
              scope_department = 'executive',
              updated_at = now()
        `,
        [tenant.id, membership.id]
      );
      await client.query(
        `
          INSERT INTO user_job_function_profile (tenant_id, user_id, job_function_profile)
          VALUES ($1, $2, 'leadership_team_member')
          ON CONFLICT (tenant_id, user_id, job_function_profile) DO NOTHING
        `,
        [tenant.id, membership.id]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const isolationLogin = await passwordLogin(app, "isolation-access-owner@example.com");
    await elevateSession(app, isolationLogin.body.token as string, "LocalDemo123!");
    const response = await request(app).get("/api/access/users").set("Authorization", `Bearer ${isolationLogin.body.token}`);

    expect(response.status).toBe(200);
    expect(response.body.some((user: { email: string }) => user.email === "admin@example.com")).toBe(false);
    expect(response.body.some((user: { email: string }) => user.email === "isolation-access-owner@example.com")).toBe(true);
  });
});
