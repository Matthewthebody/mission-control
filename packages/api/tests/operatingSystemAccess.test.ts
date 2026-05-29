import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin, passwordLogin } from "./helpers.js";

const app = createApp();
const localDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

let leadershipToken = "";
let schoolsOfficeToken = "";
let photographerToken = "";
let tenantId = "";
let ownerUserId = "";

beforeAll(async () => {
  leadershipToken = (await passwordLogin(app, "leadership@example.com")).body.token;
  schoolsOfficeToken = (await passwordLogin(app, "schools-office@example.com")).body.token;
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;

  const identityRow = await pool.query<{ tenant_id: string; id: string }>(
    `
      SELECT tenant_id::text, id::text
      FROM app_user
      WHERE lower(email) = lower($1)
      LIMIT 1
    `,
    ["leadership@example.com"]
  );
  tenantId = identityRow.rows[0]?.tenant_id ?? "";
  ownerUserId = identityRow.rows[0]?.id ?? "";
});

beforeEach(async () => {
  await pool.query(
    `
      DELETE FROM admin_setting_value
      WHERE tenant_id = $1
        AND setting_key IN (
          'roles_access.operating_system_visibility_overrides',
          'roles_access.default_operating_system_route'
        )
    `,
    [tenantId]
  );
});

describe("operating system access profile", () => {
  it("returns organization-wide leadership access with full reporting visibility", async () => {
    const response = await request(app)
      .get("/api/access/operating-system")
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body.role_template).toBe("leadership");
    expect(response.body.default_route_path).toBe("/home");
    expect(response.body.module_access.home.scope).toBe("all");
    expect(response.body.module_access.operations.can_view).toBe(true);
    expect(response.body.module_access.exceptions.can_view).toBe(true);
    expect(response.body.module_access.urgent_watch.can_view).toBe(true);
    expect(response.body.module_access.reports.can_view).toBe(true);
    expect(response.body.visibility_matrix.map((entry: { module: string }) => entry.module)).toEqual([
      "home",
      "operations",
      "exceptions",
      "urgent_watch",
      "scheduling",
      "schedule",
      "production",
      "approvals",
      "reports"
    ]);
    expect(response.body.query_scopes.reports.level).toBe("all");
    expect(response.body.home_widget_visibility.reports_overview).toBe(true);
  });

  it("returns department-scoped planning access for the schools scheduling lead", async () => {
    const response = await request(app)
      .get("/api/access/operating-system")
      .set("Authorization", `Bearer ${schoolsOfficeToken}`);

    expect(response.status).toBe(200);
    expect(response.body.role_template).toBe("scheduling_lead");
    expect(response.body.module_access.home.scope).toBe("department");
    expect(response.body.module_access.scheduling.scope).toBe("department");
    expect(response.body.module_access.schedule.scope).toBe("department");
    expect(response.body.module_access.operations.can_view).toBe(true);
    expect(response.body.module_access.reports.can_view).toBe(false);
    expect(response.body.query_scopes.scheduling.department).toBe("schools");
    expect(response.body.home_widget_visibility.scheduling_overview).toBe(true);
  });

  it("keeps standard field employees on own-scope home and schedule access", async () => {
    const response = await request(app)
      .get("/api/access/operating-system")
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.role_template).toBe("standard_employee");
    expect(response.body.module_access.home.scope).toBe("own");
    expect(response.body.module_access.schedule.scope).toBe("own");
    expect(response.body.module_access.operations.can_view).toBe(false);
    expect(response.body.module_access.urgent_watch.can_view).toBe(false);
    expect(response.body.module_access.reports.can_view).toBe(false);
    expect(response.body.query_scopes.schedule.actor_user_id).toBeTruthy();
    expect(response.body.home_widget_visibility.personal_schedule).toBe(true);
  });

  it("applies role-scoped operating-system visibility overrides and default routes from admin settings", async () => {
    await pool.query(
      `
        INSERT INTO admin_setting_value (
          tenant_id,
          setting_key,
          setting_category,
          scope_type,
          scope_id,
          scope_label,
          value,
          value_type,
          status,
          requires_approval,
          is_override,
          effective_at,
          requested_by_user_id,
          approved_by_user_id,
          approved_at,
          reason,
          impact_snapshot,
          metadata
        )
        VALUES
          (
            $1,
            'roles_access.operating_system_visibility_overrides',
            'roles_access_rules'::admin_setting_category,
            'role'::admin_setting_scope_type,
            'schools',
            'Schools',
            $2::jsonb,
            'json',
            'approved'::admin_setting_status,
            false,
            true,
            now(),
            $3,
            $3,
            now(),
            'Phase 7 operating-system visibility test.',
            '{}'::jsonb,
            '{}'::jsonb
          ),
          (
            $1,
            'roles_access.default_operating_system_route',
            'roles_access_rules'::admin_setting_category,
            'role'::admin_setting_scope_type,
            'schools',
            'Schools',
            '\"scheduling\"'::jsonb,
            'enum',
            'approved'::admin_setting_status,
            false,
            true,
            now(),
            $3,
            $3,
            now(),
            'Phase 7 operating-system route test.',
            '{}'::jsonb,
            '{}'::jsonb
          )
      `,
      [
        tenantId,
        JSON.stringify({
          hidden_modules: ["operations", "reports"],
          hidden_home_widgets: ["operations_overview"]
        }),
        ownerUserId
      ]
    );

    const response = await request(app)
      .get("/api/access/operating-system")
      .set("Authorization", `Bearer ${schoolsOfficeToken}`);

    expect(response.status).toBe(200);
    expect(response.body.default_route_path).toBe("/scheduling");
    expect(response.body.module_access.operations.can_view).toBe(false);
    expect(response.body.module_access.operations.scope).toBe("none");
    expect(response.body.module_access.reports.can_view).toBe(false);
    expect(response.body.home_widget_visibility.operations_overview).toBe(false);
  });

  it("enforces operating-system module boundaries on canonical route-owner APIs", async () => {
    const watchDenied = await request(app)
      .get(`/api/watch?date=${localDate}`)
      .set("Authorization", `Bearer ${photographerToken}`);

    const reportsDenied = await request(app)
      .get(`/api/dashboard/reports?date=${localDate}`)
      .set("Authorization", `Bearer ${photographerToken}`);

    const productionDenied = await request(app)
      .get(`/api/projects?anchor_date=${localDate}`)
      .set("Authorization", `Bearer ${schoolsOfficeToken}`);

    const watchAllowed = await request(app)
      .get(`/api/watch?date=${localDate}`)
      .set("Authorization", `Bearer ${schoolsOfficeToken}`);

    expect(watchDenied.status).toBe(403);
    expect(watchDenied.body.action).toBe("exceptions.view");
    expect(reportsDenied.status).toBe(403);
    expect(reportsDenied.body.action).toBe("reports.view");
    expect(productionDenied.status).toBe(403);
    expect(productionDenied.body.action).toBe("production.view");
    expect(watchAllowed.status).toBe(200);
  }, 10_000);
});
