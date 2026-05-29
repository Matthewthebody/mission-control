import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { pool } from "../src/db/pool.js";
import { devLogin, elevateSession, getTenantId } from "./helpers.js";

const app = createApp();
const originalAuthConfig = {
  ALLOW_PASSWORD_LOGIN: config.ALLOW_PASSWORD_LOGIN,
  ALLOW_PASSWORD_LOGIN_BREAK_GLASS_ONLY: config.ALLOW_PASSWORD_LOGIN_BREAK_GLASS_ONLY
};

let leadershipToken = "";
let demoTenantId = "";

beforeAll(async () => {
  await applyMigration("120_teams_messaging_service_phase2.sql");
  await applyMigration("132_microsoft_phase1_auth_hardening_and_portal_diagnostics.sql");
  await applyMigration("133_phase1_security_overlays_and_communication_moderation.sql");
  leadershipToken = String((await devLogin(app, "leadership@example.com")).body.token);
  await elevateSession(app, leadershipToken);
  demoTenantId = String(await getTenantId("Demo Studio"));
});

afterAll(() => {
  Object.assign(config, originalAuthConfig);
});

describe("Microsoft Security Truth workspace", () => {
  it("returns the re-audit workspace and allows elevated security evidence updates", async () => {
    const workspace = await request(app)
      .get("/api/admin/security/microsoft-truth")
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(workspace.status).toBe(200);
    expect(workspace.body.summary).toEqual(
      expect.objectContaining({
        healthy: expect.any(Number),
        at_risk: expect.any(Number),
        blocked: expect.any(Number)
      })
    );
    expect(workspace.body.controls.some((control: { control_key: string }) => control.control_key === "mfa_authentication_strength")).toBe(true);
    expect(workspace.body.re_audit_checklist.some((item: { control_key: string }) => item.control_key === "conditional_access")).toBe(true);

    const update = await request(app)
      .put("/api/admin/security/microsoft-truth/mfa_authentication_strength")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        status: "healthy",
        what: "Admin MFA and authentication strength policy validated in tenant.",
        why: "Privileged access now requires strong sign-in.",
        fix: "Keep the policy assigned to all privileged admin groups.",
        owner: "Security admin",
        retest: "Re-run the tenant MFA validation checklist after any Entra policy change.",
        evidence_items: [
          {
            kind: "link",
            label: "Conditional Access export",
            href: "https://example.test/entra/mfa-export"
          }
        ]
      });

    expect(update.status).toBe(200);
    const updatedControl = update.body.controls.find((control: { control_key: string }) => control.control_key === "mfa_authentication_strength");
    expect(updatedControl).toEqual(
      expect.objectContaining({
        status: "healthy",
        owner: "Security admin"
      })
    );
    expect(updatedControl.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "link",
          label: "Conditional Access export"
        })
      ])
    );

    const storedEvidence = await pool.query<{ status: string; owner: string }>(
      `
        SELECT status, owner
        FROM microsoft_security_evidence
        WHERE tenant_id = $1
          AND control_key = 'mfa_authentication_strength'
        LIMIT 1
      `,
      [demoTenantId]
    );
    expect(storedEvidence.rows[0]?.status).toBe("healthy");
    expect(storedEvidence.rows[0]?.owner).toBe("Security admin");
  });
});

async function applyMigration(filename: string) {
  const sql = await readFile(resolve(process.cwd(), `../../db/migrations/${filename}`), "utf8");
  try {
    await pool.query(sql);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      (!error.message.includes("already exists") &&
        !error.message.includes('duplicate key value violates unique constraint "pg_type_typname_nsp_index"'))
    ) {
      throw error;
    }
  }
}
