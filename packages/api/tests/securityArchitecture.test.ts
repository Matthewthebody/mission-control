import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { getMembershipId, elevateSession, passwordLogin } from "./helpers.js";

const app = createApp();

describe("enterprise security architecture", () => {
  it("enforces csrf for cookie-backed state-changing requests", async () => {
    const agent = request.agent(app);
    const login = await agent.post("/auth/login").send({
      email: "admin@example.com",
      password: "LocalDemo123!"
    });

    expect(login.status).toBe(200);
    const csrfToken = extractCookie(login.headers["set-cookie"], "pmc_csrf");
    expect(csrfToken).toBeTruthy();

    const missingCsrf = await agent.post("/auth/elevate").send({
      current_password: "LocalDemo123!",
      reason: "Cookie csrf regression"
    });
    expect(missingCsrf.status).toBe(403);
    expect(missingCsrf.body.code).toBe("csrf_required");

    const elevated = await agent.post("/auth/elevate").set("X-PMC-CSRF", csrfToken).send({
      current_password: "LocalDemo123!",
      reason: "Cookie csrf regression"
    });
    expect(elevated.status).toBe(200);
    expect(elevated.body.user.sessionTrust.elevatedSessionActive).toBe(true);
  });

  it("requires dual approval before a privileged role grant executes", async () => {
    const ownerLogin = await passwordLogin(app, "matthew@example.com");
    const ownerToken = String(ownerLogin.body.token);
    await elevateSession(app, ownerToken, "LocalDemo123!");

    const reviewerLogin = await passwordLogin(app, "leadership@example.com");
    const reviewerToken = String(reviewerLogin.body.token);
    await elevateSession(app, reviewerToken, "LocalDemo123!");

    const email = `security-approval-${Date.now()}@example.com`;
    const invite = await request(app)
      .post("/api/access/invites")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        email,
        full_name: "Security Approval Candidate",
        authority_tier: "standard_employee",
        primary_profile: "customer_service_rep",
        job_function_profiles: ["customer_service_rep"],
        department: "office"
      });

    expect(invite.status).toBe(201);

    await request(app).post("/auth/invites/accept").send({
      token: invite.body.invite_token,
      full_name: "Security Approval Candidate",
      password: "ApprovedLater123!"
    });

    const membershipId = String(await getMembershipId(email));
    const approveMembership = await request(app)
      .post(`/api/access/memberships/${membershipId}/approve`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        authority_tier: "standard_employee",
        primary_profile: "customer_service_rep",
        job_function_profiles: ["customer_service_rep"],
        department: "office"
      });

    expect(approveMembership.status).toBe(200);

    const requestGrant = await request(app)
      .patch(`/api/access/memberships/${membershipId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        authority_tier: "leadership",
        primary_profile: "leadership_team_member",
        job_function_profiles: ["leadership_team_member"],
        reason: "Needs temporary executive review coverage"
      });

    expect(requestGrant.status).toBe(202);
    expect(requestGrant.body.status).toBe("pending_approval");

    const approvals = await request(app)
      .get("/api/admin/security/approvals?status=pending")
      .set("Authorization", `Bearer ${reviewerToken}`);
    expect(approvals.status).toBe(200);
    expect(approvals.body.some((row: { id: string }) => row.id === requestGrant.body.approval_request_id)).toBe(true);

    const executeGrant = await request(app)
      .post(`/api/admin/security/${requestGrant.body.approval_request_id}/approve`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({
        note: "Approved by secondary reviewer"
      });

    expect(executeGrant.status).toBe(200);
    expect(executeGrant.body.status).toBe("executed");

    const targetLogin = await request(app).post("/auth/login").send({
      email,
      password: "ApprovedLater123!"
    });
    expect(targetLogin.status).toBe(200);

    const targetSession = await request(app)
      .get("/auth/session")
      .set("Authorization", `Bearer ${targetLogin.body.token}`);
    expect(targetSession.status).toBe(200);
    expect(targetSession.body.user.authorityTier).toBe("leadership");
  });
});

function extractCookie(setCookieHeader: string[] | undefined, name: string) {
  return (
    setCookieHeader
      ?.flatMap((value) => value.split(";"))
      .map((value) => value.trim())
      .find((value) => value.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? ""
  );
}
