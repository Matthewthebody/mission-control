import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

const app = createApp();

let leadershipToken = "";
let tenantId = "";
let photographerUserId = "";
let demoShootId = "";

const createdExceptionIds: string[] = [];

beforeAll(async () => {
  leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;

  const context = await pool.query(
    `
      SELECT
        photographer.id AS photographer_user_id,
        leadership.tenant_id,
        shoot.id AS shoot_id
      FROM app_user leadership
      JOIN app_user photographer
        ON photographer.tenant_id = leadership.tenant_id
       AND lower(photographer.email) = lower('photo@example.com')
      JOIN shoot
        ON shoot.tenant_id = leadership.tenant_id
       AND shoot.shoot_code = 'DEMO-001'
      WHERE lower(leadership.email) = lower('leadership@example.com')
      LIMIT 1
    `
  );

  tenantId = context.rows[0].tenant_id;
  photographerUserId = context.rows[0].photographer_user_id;
  demoShootId = context.rows[0].shoot_id;
});

beforeEach(async () => {
  await cleanupCreatedRecords();
});

afterAll(async () => {
  await cleanupCreatedRecords();
});

describe("phase G8 operational intelligence report", () => {
  it("surfaces repeated missed clock-in patterns through the leadership reports route", async () => {
    const firstException = await pool.query(
      `
        INSERT INTO attendance_exception (
          tenant_id, shift_id, shoot_id, user_id, exception_type, severity, status, classification, notes
        )
        VALUES ($1,NULL,$2,$3,'MISSED_CLOCK_IN','high','open','missed clock-in','First repeated missed clock-in signal.')
        RETURNING id
      `,
      [tenantId, demoShootId, photographerUserId]
    );
    createdExceptionIds.push(firstException.rows[0].id);

    const secondException = await pool.query(
      `
        INSERT INTO attendance_exception (
          tenant_id, shift_id, shoot_id, user_id, exception_type, severity, status, classification, notes
        )
        VALUES ($1,NULL,$2,$3,'MISSED_CLOCK_IN','high','open','missed clock-in','Second repeated missed clock-in signal.')
        RETURNING id
      `,
      [tenantId, demoShootId, photographerUserId]
    );
    createdExceptionIds.push(secondException.rows[0].id);

    const anchorDate = new Date().toISOString().slice(0, 10);
    const response = await request(app)
      .get(`/api/dashboard/reports/operational_intelligence_report?date=${anchorDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe("operational_intelligence_report");
    expect(response.body.sections.map((section: { id: string }) => section.id)).toEqual(
      expect.arrayContaining([
        "compliance_patterns",
        "location_patterns",
        "gear_patterns",
        "account_health",
        "shoot_readiness"
      ])
    );

    const complianceSection = response.body.sections.find(
      (section: { id: string; rows?: Array<{ values?: Array<{ label: string; value: number }> }> }) =>
        section.id === "compliance_patterns"
    );
    expect(complianceSection).toBeTruthy();
    expect(
      complianceSection.rows?.some((row) =>
        row.values?.some((value) => value.label === "Missed Clock-Ins" && Number(value.value) >= 2)
      )
    ).toBe(true);
  });
});

async function cleanupCreatedRecords() {
  if (createdExceptionIds.length) {
    await pool.query("DELETE FROM attendance_exception WHERE id = ANY($1::uuid[])", [createdExceptionIds]);
    createdExceptionIds.length = 0;
  }
}
