import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

const app = createApp();
// Keep this contract test isolated from whatever operational test data exists "today".
const localDate = "2035-01-15";

let leadershipToken = "";
let photographerToken = "";
let tenantId = "";
let ownerUserId = "";

beforeAll(async () => {
  leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;
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
        AND setting_key = 'roles_access.home_dashboard_defaults'
    `,
    [tenantId]
  );
});

afterEach(async () => {
  await pool.query(
    `
      DELETE FROM admin_setting_value
      WHERE tenant_id = $1
        AND setting_key = 'roles_access.home_dashboard_defaults'
    `,
    [tenantId]
  );
});

describe("home dashboard command surface", () => {
  it("returns a manager-oriented home surface for leadership users", async () => {
    const response = await request(app)
      .get(`/api/dashboard/home?mode=app&date=${localDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body.home_surface).toEqual(
      expect.objectContaining({
        role_template: "leadership",
        layout: "manager",
        staffing_band: expect.objectContaining({
          headline: "Staffing Login Tracker",
          action_hash: "#operations/attendance",
          metrics: expect.any(Array)
        }),
        today_strip: expect.objectContaining({
          headline: "Today Strip",
          items: expect.any(Array)
        }),
        urgent_attention: expect.objectContaining({
          headline: "What Needs Attention Right Now"
        }),
        today_and_next_up: expect.objectContaining({
          headline: "Today and Next Up"
        })
      })
    );
    expect(response.body.home_surface.visibility_matrix.my_day).toBe(false);
    expect(response.body.home_surface.visibility_matrix.staffing_tracker).toBe(true);
    expect(response.body.home_surface.visibility_matrix.schools_risk).toBe(true);
    expect(response.body.home_surface.compact_widgets.some((item: { id: string }) => item.id === "attendance_awareness")).toBe(false);
    expect(response.body.home_surface.compact_widgets.some((item: { id: string; action_hash: string }) => item.id === "schools_risk" && item.action_hash === "#schools")).toBe(true);
    expect(response.body.home_surface.today_strip.items.every((item: { action_hash: string }) => item.action_hash.startsWith("#"))).toBe(
      true
    );

    // A readable department with no open tasks returns 0; null is reserved for unavailable or permission-hidden counts.
    const expectedTaskCounts = {
      schools: 0 as number | null,
      sports: 0 as number | null,
      production: 0 as number | null
    };
    const taskCountRows = await pool.query<{ department_type: "schools" | "sports" | "production"; open_count: string }>(
      `
        SELECT
          task.department_type::text AS department_type,
          COUNT(*)::text AS open_count
        FROM work_task task
        WHERE task.tenant_id = $1
          AND task.department_type = ANY($2::work_department_type[])
          AND task.status NOT IN ('completed'::work_task_status_type, 'cancelled'::work_task_status_type)
        GROUP BY task.department_type
      `,
      [tenantId, ["schools", "sports", "production"]]
    );

    for (const row of taskCountRows.rows) {
      expectedTaskCounts[row.department_type] = Number(row.open_count);
    }

    expect(response.body.widgets.department_task_counts).toEqual(expectedTaskCounts);
  }, 10_000);

  it(
    "returns a personal-day home surface for standard employees",
    async () => {
      const response = await request(app)
        .get(`/api/dashboard/home?mode=app&date=${localDate}`)
        .set("Authorization", `Bearer ${photographerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.home_surface).toEqual(
        expect.objectContaining({
          role_template: "standard_employee",
          layout: "employee",
          my_day: expect.objectContaining({
            headline: "My Day",
            items: expect.any(Array)
          })
        })
      );
      expect(response.body.home_surface.visibility_matrix.urgent_watch).toBe(false);
      expect(response.body.home_surface.visibility_matrix.today_and_next_up).toBe(false);
      expect(response.body.home_surface.visibility_matrix.my_day).toBe(true);
      expect(response.body.home_surface.visibility_matrix.staffing_tracker).toBe(false);
      expect(response.body.home_surface.visibility_matrix.time_band).toBe(true);
      expect(response.body.home_surface.visibility_matrix.schools_risk).toBe(false);
      expect(response.body.home_surface.time_band).toEqual(
        expect.objectContaining({
          headline: "Time Clock Status",
          action_hash: "#dashboard/my-day",
          schedule_hash: "#schedule"
        })
      );
      expect(response.body.home_surface.time_band.summary_line).toMatch(/clock|time record|review/i);
      expect(response.body.home_surface.today_strip.items[0].action_hash).toBe("#schedule");
      expect(response.body.widgets.urgent_watch.visible).toBe(false);
      expect(response.body.widgets.attendance_awareness.visible).toBe(false);
      expect(response.body.widgets.production_projects.visible).toBe(false);
      expect(response.body.widgets.today_shoots.total).toBe(0);
      expect(response.body.widgets.weather_travel_watch.items).toEqual([]);
      expect(response.body.critical_banner).toBeNull();
    },
    30_000
  );

  it(
    "honors role-scoped home dashboard defaults for hidden sections and compact widgets",
    async () => {
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
        VALUES (
          $1,
          'roles_access.home_dashboard_defaults',
          'roles_access_rules'::admin_setting_category,
          'role'::admin_setting_scope_type,
          'leadership',
          'Leadership',
          $2::jsonb,
          'json',
          'approved'::admin_setting_status,
          false,
          true,
          now(),
          $3,
          $3,
          now(),
          'Phase 7 dashboard defaults test.',
          '{}'::jsonb,
          '{}'::jsonb
        )
      `,
      [
        tenantId,
        JSON.stringify({
          hidden_sections: ["urgent_watch", "schools_risk"],
          hidden_compact_widgets: ["my_follow_ups", "schools_risk"]
        }),
        ownerUserId
      ]
    );

    const response = await request(app)
      .get(`/api/dashboard/home?mode=app&date=${localDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body.home_surface.visibility_matrix.urgent_watch).toBe(false);
    expect(response.body.home_surface.visibility_matrix.schools_risk).toBe(false);
    expect(response.body.home_surface.compact_widgets.some((item: { id: string }) => item.id === "my_follow_ups")).toBe(false);
    expect(response.body.home_surface.compact_widgets.some((item: { id: string }) => item.id === "schools_risk")).toBe(false);
    },
    15_000
  );
});
