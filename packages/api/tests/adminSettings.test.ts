import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { elevateSession, passwordLogin } from "./helpers.js";

const app = createApp();

let ownerToken = "";
let leadershipToken = "";
let officeToken = "";
let tenantId = "";

beforeAll(async () => {
  ownerToken = (await passwordLogin(app, "matthew@example.com")).body.token;
  leadershipToken = (await passwordLogin(app, "leadership@example.com")).body.token;
  officeToken = (await passwordLogin(app, "office@example.com")).body.token;

  await elevateSession(app, ownerToken, "LocalDemo123!");
  await elevateSession(app, leadershipToken, "LocalDemo123!");

  tenantId = String(
    (
      await pool.query("SELECT tenant_id FROM app_user WHERE lower(email) = lower($1) ORDER BY created_at ASC LIMIT 1", [
        "matthew@example.com"
      ])
    ).rows[0]?.tenant_id ?? ""
  );
});

describe("admin settings workspace", () => {
  it("allows privileged users to read the workspace overview and blocks standard office access", async () => {
    const ownerOverview = await request(app).get("/api/admin/settings/overview").set("Authorization", `Bearer ${ownerToken}`);
    const leadershipOverview = await request(app)
      .get("/api/admin/settings/overview")
      .set("Authorization", `Bearer ${leadershipToken}`);
    const officeOverview = await request(app).get("/api/admin/settings/overview").set("Authorization", `Bearer ${officeToken}`);

    expect(ownerOverview.status).toBe(200);
    expect(Array.isArray(ownerOverview.body.summary_strip)).toBe(true);
    expect(Array.isArray(ownerOverview.body.settings)).toBe(true);
    expect(ownerOverview.body.settings.length).toBeGreaterThan(0);

    expect(leadershipOverview.status).toBe(200);
    expect(Array.isArray(leadershipOverview.body.pending_approvals)).toBe(true);

    expect(officeOverview.status).toBe(403);
  });

  it("lets a super admin preview and directly approve a non-protected change", async () => {
    const preview = await request(app)
      .post("/api/admin/settings/preview")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        setting_key: "attendance_time.early_clock_in_window_minutes",
        scope_type: "department",
        scope_id: "schools",
        scope_label: "Schools Department",
        value: 35
      });

    expect(preview.status).toBe(200);
    expect(preview.body.setting_key).toBe("attendance_time.early_clock_in_window_minutes");
    expect(preview.body.impact_summary).toContain("Early Clock-In Window");
    expect(preview.body.counts.active_users).toBeGreaterThan(0);

    const create = await request(app)
      .post("/api/admin/settings/values")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        setting_key: "attendance_time.early_clock_in_window_minutes",
        scope_type: "department",
        scope_id: "schools",
        scope_label: "Schools Department",
        value: 35,
        reason: "Tighten schools early-arrival allowance for phase 1 testing."
      });

    expect(create.status).toBe(201);
    expect(create.body.change.status).toBe("approved");
    expect(create.body.change.scope_type).toBe("department");
    expect(create.body.change.scope_id).toBe("schools");

    const persisted = await pool.query(
      `
        SELECT status, requires_approval, scope_type, scope_id, approved_by_user_id
        FROM admin_setting_value
        WHERE tenant_id = $1
          AND id = $2
      `,
      [tenantId, create.body.change.id]
    );

    expect(persisted.rows[0]?.status).toBe("approved");
    expect(persisted.rows[0]?.requires_approval).toBe(false);
    expect(persisted.rows[0]?.scope_type).toBe("department");
    expect(persisted.rows[0]?.scope_id).toBe("schools");
    expect(persisted.rows[0]?.approved_by_user_id).toBeTruthy();
  });

  it("routes protected changes into pending approval and lets a super admin approve them", async () => {
    const requested = await request(app)
      .post("/api/admin/settings/values")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        setting_key: "schedule_staffing.critical_window_hours",
        scope_type: "shoot_type",
        scope_id: "schools_underclass_portraits",
        scope_label: "Schools Underclass",
        value: 18,
        reason: "Need a tighter protected staffing-change window for school portrait work."
      });

    expect(requested.status).toBe(201);
    expect(requested.body.change.status).toBe("pending_approval");
    expect(requested.body.change.requires_approval).toBe(true);

    const approve = await request(app)
      .post(`/api/admin/settings/${requested.body.change.id}/approve`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ note: "Approved for phase 1 admin settings coverage." });

    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe("approved");
    expect(approve.body.approved_by_user_id).toBeTruthy();

    const auditRows = await pool.query(
      `
        SELECT action
        FROM audit_log
        WHERE tenant_id = $1
          AND entity_type = 'admin_setting_value'
          AND entity_id = $2
        ORDER BY created_at ASC
      `,
      [tenantId, requested.body.change.id]
    );

    const actions = auditRows.rows.map((row) => row.action);
    expect(actions).toContain("admin_setting.change_requested");
    expect(actions).toContain("admin_setting.change_approved");
  });

  it("validates structured config values and saves approved json settings for phase 7 admin controls", async () => {
    const invalid = await request(app)
      .post("/api/admin/settings/values")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        setting_key: "roles_access.operating_system_visibility_overrides",
        scope_type: "role",
        scope_id: "schools",
        scope_label: "Schools",
        value: {
          hidden_modules: ["not_a_real_module"]
        },
        reason: "This should fail validation."
      });

    expect(invalid.status).toBe(400);
    expect(String(invalid.body.error ?? invalid.body.message ?? "")).toContain("Invalid");

    const create = await request(app)
      .post("/api/admin/settings/values")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        setting_key: "roles_access.operating_system_visibility_overrides",
        scope_type: "role",
        scope_id: "schools",
        scope_label: "Schools",
        value: {
          hidden_modules: ["reports"],
          hidden_home_widgets: ["reports_overview"]
        },
        reason: "Keep the schools role shell focused during phase 7 testing."
      });

    expect(create.status).toBe(201);
    expect(create.body.change.status).toBe("approved");
    expect(create.body.change.value.hidden_modules).toEqual(["reports"]);
    expect(create.body.change.value.hidden_home_widgets).toEqual(["reports_overview"]);
  });

  it("validates proactive communication routing defaults for high-signal communication triggers", async () => {
    const invalid = await request(app)
      .post("/api/admin/settings/values")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        setting_key: "notifications.proactive_communication_defaults",
        scope_type: "global",
        value: {
          default_fallback_route: "not_a_real_route",
          default_throttle_window_minutes: 120,
          max_direct_message_recipients: 3,
          trigger_overrides: {}
        },
        reason: "This should fail validation."
      });

    expect(invalid.status).toBe(400);

    const create = await request(app)
      .post("/api/admin/settings/values")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        setting_key: "notifications.proactive_communication_defaults",
        scope_type: "role",
        scope_id: "sports",
        scope_label: "Sports",
        value: {
          default_fallback_route: "open_teams_recommendation",
          default_throttle_window_minutes: 180,
          max_direct_message_recipients: 2,
          trigger_overrides: {
            assignment_changed: {
              preferred_route: "direct_teams_message",
              throttle_window_minutes: 60
            }
          }
        },
        reason: "Keep sports proactive communication rules tighter during rollout."
      });

    expect(create.status).toBe(201);
    expect(create.body.change.status).toBe("approved");
    expect(create.body.change.value.default_fallback_route).toBe("open_teams_recommendation");
    expect(create.body.change.value.trigger_overrides.assignment_changed.preferred_route).toBe("direct_teams_message");
  });
});
