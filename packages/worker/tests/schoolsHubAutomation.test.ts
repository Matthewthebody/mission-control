import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db.ts";
import {
  handleSchoolsHubDeliverableTrigger,
  handleSchoolsHubUploadTrigger,
  handleSchoolsHubYearbookTrigger,
  runSchoolsHubAutomationForTenant
} from "../src/jobs/schoolsHubAutomation.ts";

let tenantId = "";
let organizationId = "";
let locationId = "";
let ownerUserId = "";
let client: PoolClient;

function dateBucket(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, delta: number) {
  const next = new Date(`${value}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + delta);
  return next.toISOString().slice(0, 10);
}

async function insertSchoolRule(input: {
  ruleType:
    | "additional_shoot_rules"
    | "delivery_preferences"
    | "subject_directory_requirements"
    | "subject_directory_counts"
    | "yearbook_participation";
  title: string;
  structuredValue: Record<string, unknown>;
}) {
  await client.query(
    `
      INSERT INTO school_rule (
        tenant_id,
        organization_id,
        rule_type,
        title,
        summary,
        structured_value
      )
      VALUES ($1,$2,$3::school_rule_type,$4,$5,$6::jsonb)
    `,
    [tenantId, organizationId, input.ruleType, input.title, `${input.title} test rule`, JSON.stringify(input.structuredValue)]
  );
}

async function seedAutomationRules() {
  await client.query(
    `
      DELETE FROM school_rule
      WHERE tenant_id = $1
        AND organization_id = $2
        AND rule_type = ANY($3::school_rule_type[])
    `,
    [
      tenantId,
      organizationId,
      [
        "additional_shoot_rules",
        "delivery_preferences",
        "subject_directory_requirements",
        "subject_directory_counts",
        "yearbook_participation"
      ]
    ]
  );

  await insertSchoolRule({
    ruleType: "additional_shoot_rules",
    title: "Automation timing",
    structuredValue: {
      pre_shoot_coordination_days: 21,
      confirmation_escalation_days: 14,
      follow_up_interval_days: 3
    }
  });
  await insertSchoolRule({
    ruleType: "delivery_preferences",
    title: "Bundle deliveries",
    structuredValue: {
      bundle_pending_deliveries: true,
      bundle_threshold: 2
    }
  });
  await insertSchoolRule({
    ruleType: "subject_directory_requirements",
    title: "Subject directory required",
    structuredValue: {
      required: true
    }
  });
  await insertSchoolRule({
    ruleType: "subject_directory_counts",
    title: "Subject directory count",
    structuredValue: {
      count: 120
    }
  });
  await insertSchoolRule({
    ruleType: "yearbook_participation",
    title: "Yearbook enabled",
    structuredValue: {
      enabled: true
    }
  });
}

beforeAll(async () => {
  const tenant = await pool.query("SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
  tenantId = String(tenant.rows[0]?.id ?? "");

  const school = await pool.query(
    `
      SELECT
        sp.organization_id::text AS organization_id,
        sp.primary_location_id::text AS location_id,
        COALESCE(sp.primary_internal_owner_user_id::text, sp.backup_internal_owner_user_id::text) AS owner_user_id
      FROM school_profile sp
      JOIN organization o
        ON o.tenant_id = sp.tenant_id
       AND o.id = sp.organization_id
      WHERE sp.tenant_id = $1
        AND COALESCE(o.display_name, o.canonical_name) = 'White Bear Lake High School'
      LIMIT 1
    `,
    [tenantId]
  );

  organizationId = String(school.rows[0]?.organization_id ?? "");
  locationId = String(school.rows[0]?.location_id ?? "");
  ownerUserId = String(school.rows[0]?.owner_user_id ?? "");
});

beforeEach(async () => {
  client = await pool.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE pmc_app");
  await client.query("SELECT app.set_context($1::uuid, NULL::uuid)", [tenantId]);
  await seedAutomationRules();
});

afterEach(async () => {
  await client.query("ROLLBACK");
  client.release();
});

describe("schools hub automation", () => {
  it("generates pre-shoot, escalation, follow-up, gallery, and bundled-delivery work from live records", async () => {
    const today = dateBucket(new Date());

    const coordinationJob = await client.query<{ id: string }>(
      `
        INSERT INTO school_job (
          tenant_id,
          organization_id,
          linked_location_id,
          job_type,
          event_date,
          due_date,
          owner_user_id,
          source_system,
          status,
          title
        )
        VALUES ($1,$2,$3,'fall_portraits',$4,$5,$6,'mission_control','active',$7)
        RETURNING id::text
      `,
      [tenantId, organizationId, locationId, addDays(today, 21), addDays(today, 21), ownerUserId || null, `Coordination ${randomUUID()}`]
    );
    const coordinationJobId = coordinationJob.rows[0].id;

    const escalationJob = await client.query<{ id: string }>(
      `
        INSERT INTO school_job (
          tenant_id,
          organization_id,
          linked_location_id,
          job_type,
          event_date,
          due_date,
          owner_user_id,
          source_system,
          status,
          title
        )
        VALUES ($1,$2,$3,'retakes',$4,$5,$6,'mission_control','active',$7)
        RETURNING id::text
      `,
      [tenantId, organizationId, locationId, addDays(today, 14), addDays(today, 14), ownerUserId || null, `Escalation ${randomUUID()}`]
    );
    const escalationJobId = escalationJob.rows[0].id;

    const followUpJob = await client.query<{ id: string }>(
      `
        INSERT INTO school_job (
          tenant_id,
          organization_id,
          linked_location_id,
          job_type,
          event_date,
          due_date,
          owner_user_id,
          source_system,
          status,
          title
        )
        VALUES ($1,$2,$3,'spring_portraits',$4,$5,$6,'mission_control','active',$7)
        RETURNING id::text
      `,
      [tenantId, organizationId, locationId, addDays(today, 9), addDays(today, 9), ownerUserId || null, `Follow Up ${randomUUID()}`]
    );
    const followUpJobId = followUpJob.rows[0].id;

    const touchpointPlan = await client.query<{ id: string }>(
      `
        INSERT INTO directory_touchpoint_plan (
          tenant_id,
          organization_id,
          location_id,
          category,
          status,
          title,
          summary,
          owner_user_id,
          due_at
        )
        VALUES ($1,$2,$3,'pre_shoot_confirmation','planned',$4,$5,$6,$7::timestamptz)
        RETURNING id::text
      `,
      [
        tenantId,
        organizationId,
        locationId,
        `Pre-shoot confirmation ${randomUUID()}`,
        "Still waiting on the school to confirm roster and arrival details.",
        ownerUserId || null,
        `${addDays(today, -4)}T15:00:00.000Z`
      ]
    );
    const touchpointPlanId = touchpointPlan.rows[0].id;

    const project = await client.query<{ id: string }>(
      `
        INSERT INTO production_project (
          tenant_id,
          source_type,
          source_event_key,
          created_reason,
          title,
          summary,
          status,
          priority,
          owner_user_id,
          due_date,
          linked_organization_id,
          linked_location_id,
          created_by_user_id,
          updated_by_user_id,
          job_type,
          qa_state,
          release_state,
          stage
        )
        VALUES (
          $1,
          'manual',
          $2,
          'Schools Hub automation test',
          $3,
          'Keep gallery release visible for school follow-through.',
          'active',
          'high',
          $4,
          $5,
          $6,
          $7,
          $4,
          $4,
          'gallery_prep_upload',
          'not_started',
          'not_ready',
          'ready_for_production'
        )
        RETURNING id::text
      `,
      [tenantId, `schools-hub-gallery-${randomUUID()}`, `Gallery ${randomUUID()}`, ownerUserId || null, addDays(today, 1), organizationId, locationId]
    );
    const projectId = project.rows[0].id;

    await client.query(
      `
        DELETE FROM school_work_item
        WHERE tenant_id = $1
          AND automation_key = $2
      `,
      [tenantId, `schools_hub:delivery_bundle:${organizationId}`]
    );

    await client.query(
      `
        INSERT INTO school_work_item (
          tenant_id,
          organization_id,
          linked_location_id,
          work_type,
          title,
          owner_user_id,
          status,
          stage,
          priority,
          due_date,
          waiting_on,
          source_system
        )
        VALUES
          ($1,$2,$3,'delivery',$4,$5,'open','ready_for_delivery','high',$6,'none','mission_control'),
          ($1,$2,$3,'delivery',$7,$5,'waiting','waiting_on_internal','normal',$8,'internal_ops','mission_control')
      `,
      [
        tenantId,
        organizationId,
        locationId,
        `Yearbook delivery ${randomUUID()}`,
        ownerUserId || null,
        addDays(today, 2),
        `Admin packet ${randomUUID()}`,
        addDays(today, 3)
      ]
    );

    await runSchoolsHubAutomationForTenant(client, tenantId, new Date(`${today}T12:00:00.000Z`));

    const automationWork = await client.query<{
      automation_key: string;
      work_type: string;
      status: string;
      stage: string;
      waiting_on: string;
      priority: string;
    }>(
      `
        SELECT
          automation_key,
          work_type::text,
          status::text,
          stage::text,
          waiting_on::text,
          priority::text
        FROM school_work_item
        WHERE tenant_id = $1
          AND automation_key = ANY($2::text[])
      `,
      [
        tenantId,
        [
          `schools_hub:pre_shoot:${coordinationJobId}`,
          `schools_hub:pre_shoot_escalation:${escalationJobId}`,
          `schools_hub:no_response_follow_up:${touchpointPlanId}`,
          `schools_hub:gallery_due:${projectId}`,
          `schools_hub:delivery_bundle:${organizationId}`
        ]
      ]
    );

    expect(automationWork.rowCount).toBe(5);
    const byKey = new Map(automationWork.rows.map((row) => [row.automation_key, row]));

    expect(byKey.get(`schools_hub:pre_shoot:${coordinationJobId}`)).toMatchObject({
      work_type: "pre_shoot_coordination",
      status: "open",
      stage: "planning",
      waiting_on: "none"
    });
    expect(byKey.get(`schools_hub:pre_shoot_escalation:${escalationJobId}`)).toMatchObject({
      work_type: "exception_handling",
      status: "blocked",
      stage: "waiting_on_school",
      waiting_on: "school",
      priority: "critical"
    });
    expect(byKey.get(`schools_hub:no_response_follow_up:${touchpointPlanId}`)).toMatchObject({
      work_type: "follow_up",
      status: "waiting",
      stage: "waiting_on_school",
      waiting_on: "school"
    });
    expect(byKey.get(`schools_hub:gallery_due:${projectId}`)).toMatchObject({
      work_type: "gallery_release",
      status: "waiting",
      stage: "waiting_on_internal",
      waiting_on: "internal_production"
    });
    expect(byKey.get(`schools_hub:delivery_bundle:${organizationId}`)).toMatchObject({
      work_type: "delivery",
      status: "open",
      stage: "planning",
      waiting_on: "none"
    });
  });

  it("creates ID and subject-directory work from upload triggers", async () => {
    const sourceReference = `upload-${randomUUID()}`;

    await handleSchoolsHubUploadTrigger(client, tenantId, {
      organization_id: organizationId,
      linked_location_id: locationId,
      trigger_type: "id_upload_received",
      deadline_date: addDays(dateBucket(new Date()), 2),
      source_system: "manual_import",
      source_reference: `${sourceReference}-id`,
      note: "Plick upload finished."
    });

    await handleSchoolsHubUploadTrigger(client, tenantId, {
      organization_id: organizationId,
      linked_location_id: locationId,
      trigger_type: "final_retake_upload_completed",
      deadline_date: addDays(dateBucket(new Date()), 1),
      source_system: "manual_import",
      source_reference: `${sourceReference}-retake`,
      note: "Retake upload finished."
    });

    const work = await client.query<{ automation_key: string; work_type: string; title: string }>(
      `
        SELECT automation_key, work_type::text, title
        FROM school_work_item
        WHERE tenant_id = $1
          AND automation_key = ANY($2::text[])
        ORDER BY automation_key
      `,
      [
        tenantId,
        [
          `schools_hub:upload:id:${sourceReference}-id`,
          `schools_hub:upload:subject_directory:${sourceReference}-retake`
        ]
      ]
    );

    expect(work.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          automation_key: `schools_hub:upload:id:${sourceReference}-id`,
          work_type: "id_production"
        }),
        expect.objectContaining({
          automation_key: `schools_hub:upload:subject_directory:${sourceReference}-retake`,
          work_type: "admin_item"
        })
      ])
    );
  });

  it("creates yearbook and deliverable work from explicit triggers", async () => {
    const triggerKey = randomUUID();

    await handleSchoolsHubYearbookTrigger(client, tenantId, {
      organization_id: organizationId,
      linked_location_id: locationId,
      request_type: "yearbook_request_received",
      deadline_date: addDays(dateBucket(new Date()), 10),
      source_system: "manual_import",
      source_reference: `yearbook-${triggerKey}`,
      note: "School requested yearbook setup."
    });

    await handleSchoolsHubDeliverableTrigger(client, tenantId, {
      organization_id: organizationId,
      linked_location_id: locationId,
      deliverable_type: "yearbooks_arrived",
      arrived_on: dateBucket(new Date()),
      ready_date: addDays(dateBucket(new Date()), 1),
      source_system: "manual_import",
      source_reference: `deliverable-${triggerKey}`,
      note: "Yearbooks arrived at the office."
    });

    const work = await client.query<{ automation_key: string; work_type: string; stage: string }>(
      `
        SELECT automation_key, work_type::text, stage::text
        FROM school_work_item
        WHERE tenant_id = $1
          AND automation_key = ANY($2::text[])
        ORDER BY automation_key
      `,
      [
        tenantId,
        [
          `schools_hub:yearbook:yearbook_request_received:yearbook-${triggerKey}`,
          `schools_hub:deliverable:yearbooks_arrived:deliverable-${triggerKey}`
        ]
      ]
    );

    expect(work.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          automation_key: `schools_hub:yearbook:yearbook_request_received:yearbook-${triggerKey}`,
          work_type: "yearbook",
          stage: "planning"
        }),
        expect.objectContaining({
          automation_key: `schools_hub:deliverable:yearbooks_arrived:deliverable-${triggerKey}`,
          work_type: "delivery",
          stage: "ready_for_delivery"
        })
      ])
    );
  });
});
