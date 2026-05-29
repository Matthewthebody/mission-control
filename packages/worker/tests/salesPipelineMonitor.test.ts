import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db.js";
import { monitorSalesPipeline } from "../src/jobs/salesPipelineMonitor.js";

let tenantId = "";
let leadershipId = "";

const seed = {
  organizationId: "",
  contactId: "",
  opportunityId: "",
  agreementId: "",
  signerId: ""
};

beforeAll(async () => {
  const tenantResult = await pool.query<{ id: string }>("SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
  tenantId = tenantResult.rows[0]?.id ?? "";

  const leadershipResult = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM app_user
      WHERE tenant_id = $1
        AND email = 'leadership@example.com'
      LIMIT 1
    `,
    [tenantId]
  );
  leadershipId = leadershipResult.rows[0]?.id ?? "";

  expect(tenantId).toBeTruthy();
  expect(leadershipId).toBeTruthy();
});

beforeEach(async () => {
  await cleanupSeed();
  await seedAutomationRecords();
});

afterAll(async () => {
  await cleanupSeed();
});

describe("sales pipeline monitor worker", () => {
  it("creates deduped CRM alerts and reminder rows for overdue follow-up pressure", async () => {
    await monitorSalesPipeline();

    const alertRows = await pool.query<{ alert_type: string; status: string }>(
      `
        SELECT alert_type::text AS alert_type, status::text AS status
        FROM sales_pipeline_alert
        WHERE tenant_id = $1
          AND opportunity_id = $2
        ORDER BY alert_type ASC
      `,
      [tenantId, seed.opportunityId]
    );

    expect(alertRows.rows).toEqual([
      { alert_type: "inactive_opportunity", status: "open" },
      { alert_type: "meeting_scheduled", status: "open" },
      { alert_type: "missing_next_action", status: "open" }
    ]);

    const reminderRows = await pool.query<{ reminder_type: string; status: string }>(
      `
        SELECT reminder_type::text AS reminder_type, status::text AS status
        FROM agreement_reminder
        WHERE tenant_id = $1
          AND agreement_id = $2
        ORDER BY reminder_type ASC
      `,
      [tenantId, seed.agreementId]
    );

    expect(reminderRows.rows).toEqual([
      { reminder_type: "expiration_30_day", status: "queued" },
      { reminder_type: "unsigned_30_day", status: "queued" }
    ]);

    const appEventCounts = await pool.query<{ event_type: string; count: string }>(
      `
        SELECT event_type, count(*)::text AS count
        FROM app_event
        WHERE tenant_id = $1
          AND (
            (aggregate_type = 'sales_pipeline_alert' AND aggregate_id IN (
              SELECT id
              FROM sales_pipeline_alert
              WHERE tenant_id = $1
                AND opportunity_id = $2
            ))
            OR (aggregate_type = 'agreement_reminder' AND aggregate_id IN (
              SELECT id
              FROM agreement_reminder
              WHERE tenant_id = $1
                AND agreement_id = $3
            ))
          )
        GROUP BY event_type
      `,
      [tenantId, seed.opportunityId, seed.agreementId]
    );

    expect(appEventCounts.rows).toEqual(
      expect.arrayContaining([
        { event_type: "agreement.reminder_requested", count: "2" },
        { event_type: "notification.dispatch", count: expect.any(String) as never }
      ])
    );

    await monitorSalesPipeline();

    const alertCountAfterSecondRun = await pool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM sales_pipeline_alert
        WHERE tenant_id = $1
          AND opportunity_id = $2
          AND status = 'open'
      `,
      [tenantId, seed.opportunityId]
    );
    expect(Number(alertCountAfterSecondRun.rows[0]?.count ?? "0")).toBe(3);

    const reminderCountAfterSecondRun = await pool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM agreement_reminder
        WHERE tenant_id = $1
          AND agreement_id = $2
      `,
      [tenantId, seed.agreementId]
    );
    expect(Number(reminderCountAfterSecondRun.rows[0]?.count ?? "0")).toBe(2);
  }, 20000);
});

async function seedAutomationRecords() {
  const suffix = randomUUID().slice(0, 8);
  const organizationName = `CRM Automation School ${suffix}`;
  const normalizedOrganizationName = normalizeText(organizationName);

  const organizationInsert = await pool.query<{ id: string }>(
    `
      INSERT INTO organization (
        tenant_id,
        canonical_name,
        normalized_canonical_name,
        display_name,
        account_type,
        active_status,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$2,'schools_underclass_portraits','active','CRM automation test organization',$4,$4)
      RETURNING id
    `,
    [tenantId, organizationName, normalizedOrganizationName, leadershipId]
  );
  seed.organizationId = organizationInsert.rows[0]?.id ?? "";

  const contactFirstName = "Barb";
  const contactLastName = `Byzee ${suffix}`;
  const contactInsert = await pool.query<{ id: string }>(
    `
      INSERT INTO organization_contact (
        tenant_id,
        organization_id,
        first_name,
        last_name,
        full_name,
        normalized_full_name,
        title,
        phone,
        email,
        active_status,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,'Activities Director','555-0112',$7,'active','CRM automation contact',$8,$8)
      RETURNING id
    `,
    [
      tenantId,
      seed.organizationId,
      contactFirstName,
      contactLastName,
      `${contactFirstName} ${contactLastName}`,
      normalizeText(`${contactFirstName} ${contactLastName}`),
      `crm.automation.${suffix}@example.com`,
      leadershipId
    ]
  );
  seed.contactId = contactInsert.rows[0]?.id ?? "";

  const opportunityInsert = await pool.query<{ id: string }>(
    `
      INSERT INTO sales_opportunity (
        tenant_id,
        organization_id,
        primary_contact_id,
        owner_id,
        opportunity_type,
        pipeline_type,
        stage,
        estimated_value,
        next_action_date,
        last_touch_date,
        last_verified_contact_date,
        notes,
        status,
        follow_up_date,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        'renewal',
        'schools',
        'meeting_scheduled',
        24000,
        NULL,
        current_date - 21,
        current_date - 30,
        'CRM automation worker seed.',
        'active',
        NULL,
        $4,
        $4
      )
      RETURNING id
    `,
    [tenantId, seed.organizationId, seed.contactId, leadershipId]
  );
  seed.opportunityId = opportunityInsert.rows[0]?.id ?? "";

  const agreementInsert = await pool.query<{ id: string }>(
    `
      INSERT INTO agreement (
        tenant_id,
        agreement_title,
        agreement_type,
        status,
        organization_id,
        client_account_id,
        primary_contact_id,
        description,
        contract_value,
        revenue_share_terms,
        effective_date,
        expiration_date,
        renewal_date,
        notice_deadline,
        auto_renew,
        sent_at,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES (
        $1,
        $2,
        'schools',
        'sent',
        $3,
        $3,
        $4,
        'Unsigned agreement for CRM automation reminders.',
        24000,
        'Standard terms',
        current_date - 30,
        current_date + 20,
        current_date + 20,
        current_date + 5,
        false,
        now() - interval '31 days',
        $5,
        $5
      )
      RETURNING id
    `,
    [tenantId, `CRM Automation Agreement ${suffix}`, seed.organizationId, seed.contactId, leadershipId]
  );
  seed.agreementId = agreementInsert.rows[0]?.id ?? "";

  const signerInsert = await pool.query<{ id: string }>(
    `
      INSERT INTO agreement_signer (
        tenant_id,
        agreement_id,
        contact_id,
        signer_name,
        signer_email,
        signer_role,
        signer_order,
        signer_type,
        status,
        created_by_user_id
      )
      VALUES (
        $1,
        $2,
        $3,
        'Barb Byzee',
        $4,
        'Activities Director',
        1,
        'external',
        'pending',
        $5
      )
      RETURNING id
    `,
    [tenantId, seed.agreementId, seed.contactId, `crm.signer.${suffix}@example.com`, leadershipId]
  );
  seed.signerId = signerInsert.rows[0]?.id ?? "";
}

async function cleanupSeed() {
  if (seed.agreementId) {
    await pool.query(
      `
        DELETE FROM app_event
        WHERE tenant_id = $1
          AND (
            aggregate_type = 'agreement_reminder'
            OR aggregate_type = 'sales_pipeline_alert'
          )
          AND (
            aggregate_id IN (
              SELECT id
              FROM agreement_reminder
              WHERE agreement_id = $2
            )
            OR aggregate_id IN (
              SELECT id
              FROM sales_pipeline_alert
              WHERE opportunity_id = $3
            )
          )
      `,
      [tenantId, seed.agreementId, seed.opportunityId || null]
    );
  }

  if (seed.opportunityId) {
    await pool.query("DELETE FROM sales_pipeline_alert WHERE tenant_id = $1 AND opportunity_id = $2", [tenantId, seed.opportunityId]);
    await pool.query("DELETE FROM sales_opportunity WHERE tenant_id = $1 AND id = $2", [tenantId, seed.opportunityId]);
  }

  if (seed.agreementId) {
    await pool.query("DELETE FROM agreement_reminder WHERE tenant_id = $1 AND agreement_id = $2", [tenantId, seed.agreementId]);
    await pool.query("DELETE FROM agreement_activity_log WHERE tenant_id = $1 AND agreement_id = $2", [tenantId, seed.agreementId]);
    await pool.query("DELETE FROM agreement_signer WHERE tenant_id = $1 AND agreement_id = $2", [tenantId, seed.agreementId]);
    await pool.query("DELETE FROM agreement WHERE tenant_id = $1 AND id = $2", [tenantId, seed.agreementId]);
  }

  if (seed.contactId) {
    await pool.query("DELETE FROM organization_contact WHERE tenant_id = $1 AND id = $2", [tenantId, seed.contactId]);
  }

  if (seed.organizationId) {
    await pool.query("DELETE FROM organization WHERE tenant_id = $1 AND id = $2", [tenantId, seed.organizationId]);
  }

  seed.organizationId = "";
  seed.contactId = "";
  seed.opportunityId = "";
  seed.agreementId = "";
  seed.signerId = "";
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
