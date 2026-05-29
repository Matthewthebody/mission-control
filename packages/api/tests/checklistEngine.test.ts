import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../src/config.js";

let app: Express;
let dbPool: Pool;
let leadershipToken = "";
let leadershipUserId = "";
let sportsToken = "";
let photographerToken = "";
let photographerUserId = "";
let sportsManagerUserId = "";
let tenantId = "";
let sportsOrganizationId = "";
let sportsLocationId = "";
let sportsContactId = "";
let studioId = "";
let seededDefaults: {
  template_count: number;
  version_count: number;
  workflow_rule_count: number;
  reminder_rule_count: number;
} | null = null;
const createdWorkflowBlockRuleIds: string[] = [];

function plusDays(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function plusDaysWithHours(days: number, hours: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

function plusHours(hours: number) {
  const date = new Date();
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

function uniqueCode(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10_000)}`.toLowerCase();
}

async function login(email: string) {
  const response = await request(app).post("/auth/dev-login").send({ email });
  expect(response.status).toBe(200);
  return response.body.token as string;
}

async function createDraft(token: string, payload: Record<string, unknown>) {
  return request(app).post("/api/jobs/drafts").set("Authorization", `Bearer ${token}`).send(payload);
}

async function publishJob(token: string, jobId: string) {
  return request(app).post(`/api/jobs/${jobId}/publish`).set("Authorization", `Bearer ${token}`).send({});
}

async function createPublishedSportsJob() {
  const draft = await createDraft(sportsToken, {
    department_type: "sports",
    job_category: "photo_day",
    organization_id: sportsOrganizationId,
    primary_location_id: sportsLocationId,
    primary_contact_id: sportsContactId,
    title: `Checklist Engine Job ${Date.now()} ${Math.floor(Math.random() * 10_000)}`,
    scheduled_start_at: plusDaysWithHours(5, 18),
    scheduled_end_at: plusDaysWithHours(5, 20),
    timezone: "America/Chicago",
    estimated_staff_count: 1,
    production_required: true,
    sports_profile: {
      sport_type: "basketball",
      season: "winter",
      team_structure: "multi_team",
      proof_required: true,
      approval_contact_id: sportsContactId
    }
  });

  expect(draft.status).toBe(201);
  const publish = await publishJob(sportsToken, draft.body.job.id);
  expect(publish.status).toBe(200);
  return publish.body as {
    job: { id: string };
    production_items: Array<{ id: string }>;
  };
}

async function createSportsShoot(token: string, overrides: Partial<Record<string, unknown>> = {}) {
  const startAt = plusDaysWithHours(2, 18);
  const endAt = plusDaysWithHours(2, 20);
  const response = await request(app)
    .post("/api/shoots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      studio_id: studioId,
      organization_id: sportsOrganizationId,
      location_id: sportsLocationId,
      primary_contact_id: sportsContactId,
      shoot_type: "sports",
      shoot_code: uniqueCode("checklist_shoot"),
      title: `Checklist Shoot ${Date.now()} ${Math.floor(Math.random() * 10_000)}`,
      shoot_date: startAt.slice(0, 10),
      geofence_radius_meters: 200,
      showtime: startAt,
      arrival_time: startAt,
      start_time: startAt,
      end_time_est: endAt,
      projected_students: 25,
      planned_staff_count: 1,
      required_lead_count: 1,
      ...overrides
    });

  expect(response.status).toBe(201);
  const shoot = response.body?.shoot ?? response.body;
  return { shoot } as { shoot: { id: string; start_time: string; showtime: string; end_time_est: string } };
}

async function assignProductionOwner(jobId: string, productionItemId: string, ownerUserId: string) {
  return updateProductionItem(jobId, productionItemId, {
    assigned_to_user_id: ownerUserId
  });
}

async function updateProductionItem(jobId: string, productionItemId: string, payload: Record<string, unknown>) {
  const response = await request(app)
    .patch(`/api/jobs/${jobId}/production-items/${productionItemId}`)
    .set("Authorization", `Bearer ${leadershipToken}`)
    .send(payload);

  expect(response.status).toBe(200);
  return response.body.production_items.find((item: { id: string }) => item.id === productionItemId);
}

async function createTemplateAndPublish(token: string, payload: Record<string, unknown>) {
  const createResponse = await request(app).post("/api/checklists/templates").set("Authorization", `Bearer ${token}`).send(payload);
  expect(createResponse.status).toBe(201);
  const draftVersionId = createResponse.body.template.versions[0].id as string;
  const publishResponse = await request(app)
    .post(`/api/checklists/templates/${createResponse.body.template.id}/versions/${draftVersionId}/publish`)
    .set("Authorization", `Bearer ${token}`)
    .send({});

  expect(publishResponse.status).toBe(200);
  return publishResponse.body.template as {
    id: string;
    code: string;
    active_version_id: string;
  };
}

async function createChecklistInstance(token: string, payload: Record<string, unknown>) {
  const response = await request(app).post("/api/checklists/instances").set("Authorization", `Bearer ${token}`).send(payload);
  expect(response.status).toBe(201);
  return response.body.instance;
}

async function getChecklistInstance(token: string, instanceId: string) {
  const response = await request(app).get(`/api/checklists/instances/${instanceId}`).set("Authorization", `Bearer ${token}`);
  expect(response.status).toBe(200);
  return response.body.instance;
}

async function setChecklistDueAt(instanceId: string, dueAt: string) {
  await dbPool.query(
    `
      UPDATE checklist_instances
      SET due_at = $3,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [tenantId, instanceId, dueAt]
  );
}

function findItem(instance: any, itemKey: string) {
  for (const section of instance.sections ?? []) {
    for (const item of section.items ?? []) {
      if (item.item_key === itemKey) {
        return item;
      }
    }
  }
  throw new Error(`Checklist item ${itemKey} not found.`);
}

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { pool } = await import("../src/db/pool.js");
  app = createApp();
  dbPool = pool;

  leadershipToken = await login("leadership@example.com");
  sportsToken = await login("sports-office@example.com");
  photographerToken = await login("photo@example.com");

  const sportsFixture = await dbPool.query<{
    tenant_id: string;
    organization_id: string;
    location_id: string;
    primary_contact_id: string;
  }>(
    `
      SELECT
        s.tenant_id::text AS tenant_id,
        s.organization_id::text AS organization_id,
        s.location_id::text AS location_id,
        s.primary_contact_id::text AS primary_contact_id
      FROM shoot s
      WHERE s.deleted_at IS NULL
        AND s.record_state = 'published'::shoot_record_state
        AND s.organization_id IS NOT NULL
        AND s.location_id IS NOT NULL
        AND s.primary_contact_id IS NOT NULL
        AND s.department = 'sports'::department_code
      ORDER BY s.created_at ASC
      LIMIT 1
    `
  );

  if (!sportsFixture.rows[0]) {
    throw new Error("Expected a seeded sports shoot fixture for checklist tests.");
  }

  tenantId = sportsFixture.rows[0].tenant_id;
  sportsOrganizationId = sportsFixture.rows[0].organization_id;
  sportsLocationId = sportsFixture.rows[0].location_id;
  sportsContactId = sportsFixture.rows[0].primary_contact_id;

  const studioRow = await dbPool.query<{ id: string }>(`SELECT id::text FROM studio WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`, [tenantId]);
  studioId = studioRow.rows[0]?.id ?? "";

  const photographerRow = await dbPool.query<{ id: string }>(`SELECT id::text FROM app_user WHERE lower(email) = lower('photo@example.com') LIMIT 1`);
  photographerUserId = photographerRow.rows[0]?.id ?? "";

  const sportsManagerRow = await dbPool.query<{ id: string }>(`SELECT id::text FROM app_user WHERE lower(email) = lower('sports-office@example.com') LIMIT 1`);
  sportsManagerUserId = sportsManagerRow.rows[0]?.id ?? "";

  const leadershipRow = await dbPool.query<{ id: string }>(`SELECT id::text FROM app_user WHERE lower(email) = lower('leadership@example.com') LIMIT 1`);
  leadershipUserId = leadershipRow.rows[0]?.id ?? "";

  const seedResponse = await request(app).post("/api/checklists/templates/seed-defaults").set("Authorization", `Bearer ${leadershipToken}`).send({});
  expect(seedResponse.status).toBe(200);
  seededDefaults = seedResponse.body.seeded ?? null;
}, 30000);

afterAll(async () => {
  if (createdWorkflowBlockRuleIds.length) {
    await dbPool.query("DELETE FROM workflow_block_rules WHERE id = ANY($1::uuid[])", [createdWorkflowBlockRuleIds]);
  }
});

describe("workflow checklist engine foundation", () => {
  it("seeds the production-ready checklist library with counts, anchors, assignment defaults, and workflow rules", async () => {
    expect(seededDefaults).toBeTruthy();
    expect(seededDefaults?.template_count).toBe(10);
    expect(seededDefaults?.version_count).toBe(10);
    expect(seededDefaults?.workflow_rule_count).toBe(8);
    expect(seededDefaults?.reminder_rule_count).toBeGreaterThanOrEqual(10);

    const templateRows = await dbPool.query<{
      code: string;
      due_rule_json: Record<string, unknown>;
      assignment_defaults_json: {
        owner_assignment_role?: string | null;
        reviewer_assignment_role?: string | null;
        approver_assignment_role?: string | null;
      };
      blocking_level: string;
      approval_required: boolean;
    }>(
      `
        SELECT
          template.code,
          version.due_rule_json,
          version.assignment_defaults_json,
          version.blocking_level::text AS blocking_level,
          version.approval_required
        FROM checklist_templates template
        JOIN checklist_template_versions version ON version.id = template.active_version_id
        WHERE template.tenant_id = $1
          AND template.code = ANY($2::text[])
        ORDER BY template.code ASC
      `,
      [
        tenantId,
        [
          "shoot_readiness",
          "pre_service_meeting",
          "on_site_setup_verification",
          "end_of_shoot_wrap",
          "production_intake_file_receipt",
          "artist_self_qa",
          "peer_review_sign_off",
          "captura_upload_qa",
          "final_release_checklist",
          "incident_escalation_report"
        ]
      ]
    );

    expect(templateRows.rows).toHaveLength(10);

    const readiness = templateRows.rows.find((row) => row.code === "shoot_readiness");
    expect(readiness?.due_rule_json.anchor_key).toBe("shoot_showtime");
    expect(readiness?.due_rule_json.offset_hours).toBe(-24);
    expect(readiness?.assignment_defaults_json.owner_assignment_role).toBe("readiness_owner");

    const peerReview = templateRows.rows.find((row) => row.code === "peer_review_sign_off");
    expect(peerReview?.approval_required).toBe(true);
    expect(peerReview?.assignment_defaults_json.reviewer_assignment_role).toBe("peer_reviewer");
    expect(peerReview?.assignment_defaults_json.approver_assignment_role).toBe("peer_reviewer");

    const incident = templateRows.rows.find((row) => row.code === "incident_escalation_report");
    expect(incident?.blocking_level).toBe("soft_block");
    expect(incident?.assignment_defaults_json.approver_assignment_role).toBe("department_manager");

    const workflowRules = await dbPool.query<{ required_template_code: string; to_stage: string }>(
      `
        SELECT required_template_code, to_stage
        FROM workflow_block_rules
        WHERE tenant_id = $1
          AND required_template_code = ANY($2::text[])
          AND active_status = true
      `,
      [
        tenantId,
        [
          "shoot_readiness",
          "pre_service_meeting",
          "end_of_shoot_wrap",
          "production_intake_file_receipt",
          "artist_self_qa",
          "peer_review_sign_off",
          "captura_upload_qa",
          "final_release_checklist"
        ]
      ]
    );

    expect(workflowRules.rows).toHaveLength(8);
  });

  it("publishes template versions, instantiates checklists, and evaluates conditional required logic", async () => {
    const publish = await createPublishedSportsJob();
    const productionItemId = publish.production_items[0].id;
    await assignProductionOwner(publish.job.id, productionItemId, sportsManagerUserId);

    const template = await createTemplateAndPublish(leadershipToken, {
      name: "Conditional QA Gate",
      code: uniqueCode("conditional_qa_gate"),
      department_type: "sports",
      scope_type: "production_item",
      trigger_type: "manual",
      approval_required: false,
      blocking_level: "soft_block",
      summary: "Test conditional required behavior.",
      sections: [
        {
          section_key: "core",
          title: "Core",
          items: [
            {
              item_key: "needs_follow_up",
              label: "Needs follow-up?",
              item_type: "yes_no",
              required: true
            },
            {
              item_key: "follow_up_reason",
              label: "Follow-up reason",
              item_type: "textarea",
              required: false,
              conditions: [
                {
                  source_item_key: "needs_follow_up",
                  comparison_operator: "equals",
                  expected_value_json: true,
                  effect: "require"
                }
              ]
            }
          ]
        }
      ]
    });

    const instance = await createChecklistInstance(leadershipToken, {
      template_id: template.id,
      scope_type: "production_item",
      scope_id: productionItemId,
      owner_user_id: sportsManagerUserId
    });

    const needsFollowUpItem = findItem(instance, "needs_follow_up");
    const followUpReasonItem = findItem(instance, "follow_up_reason");

    const initialSave = await request(app)
      .post(`/api/checklists/instances/${instance.id}/responses`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({
        responses: [
          {
            checklist_item_id: needsFollowUpItem.id,
            response_json: false
          }
        ]
      });

    expect(initialSave.status).toBe(200);
    expect(initialSave.body.instance.progress.missing_item_ids).toEqual([]);

    const requiredSave = await request(app)
      .post(`/api/checklists/instances/${instance.id}/responses`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({
        responses: [
          {
            checklist_item_id: needsFollowUpItem.id,
            response_json: true
          }
        ]
      });

    expect(requiredSave.status).toBe(200);
    expect(requiredSave.body.instance.progress.missing_item_ids).toContain(followUpReasonItem.id);
  });

  it("denies checklist creation outside the caller's allowed scope and audits the attempt", async () => {
    const publish = await createPublishedSportsJob();
    const productionItemId = publish.production_items[0].id;
    await assignProductionOwner(publish.job.id, productionItemId, sportsManagerUserId);

    const createResponse = await request(app)
      .post("/api/checklists/instances")
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        template_code: "artist_self_qa",
        scope_type: "production_item",
        scope_id: productionItemId
      });

    expect(createResponse.status).toBe(403);

    const deniedAudit = await dbPool.query<{ action: string }>(
      `
        SELECT action
        FROM audit_log
        WHERE tenant_id = $1
          AND entity_type = 'production_item'
          AND entity_id = $2
          AND action = 'checklist.instance_create_denied'
      `,
      [tenantId, productionItemId]
    );

    expect(deniedAudit.rows).toHaveLength(1);
  });

  it("allows multiple manual checklist instances for the same template and record", async () => {
    const publish = await createPublishedSportsJob();
    const productionItemId = publish.production_items[0].id;
    await assignProductionOwner(publish.job.id, productionItemId, sportsManagerUserId);

    const first = await createChecklistInstance(leadershipToken, {
      template_code: "artist_self_qa",
      scope_type: "production_item",
      scope_id: productionItemId,
      title: "First QA pass"
    });

    const second = await createChecklistInstance(leadershipToken, {
      template_code: "artist_self_qa",
      scope_type: "production_item",
      scope_id: productionItemId,
      title: "Second QA pass"
    });

    expect(second.id).not.toBe(first.id);

    const instanceRows = await dbPool.query<{ id: string }>(
      `
        SELECT instance.id::text AS id
        FROM checklist_instances instance
        JOIN checklist_templates template ON template.id = instance.template_id
        WHERE instance.tenant_id = $1
          AND instance.production_item_id = $2
          AND template.code = 'artist_self_qa'
          AND instance.status NOT IN ('approved'::checklist_instance_status_type, 'waived'::checklist_instance_status_type)
      `,
      [tenantId, productionItemId]
    );

    expect(instanceRows.rows.map((row) => row.id)).toEqual(expect.arrayContaining([first.id, second.id]));
  });

  it("enforces proof uploads before submit and records approval decisions in audit history", async () => {
    const publish = await createPublishedSportsJob();
    const productionItemId = publish.production_items[0].id;
    await assignProductionOwner(publish.job.id, productionItemId, sportsManagerUserId);

    const template = await createTemplateAndPublish(leadershipToken, {
      name: "Proof Approval Gate",
      code: uniqueCode("proof_approval_gate"),
      department_type: "sports",
      scope_type: "production_item",
      trigger_type: "manual",
      approval_required: true,
      blocking_level: "hard_block",
      summary: "Test proof-required approvals.",
      sections: [
        {
          section_key: "proofs",
          title: "Proofs",
          items: [
            {
              item_key: "proof_asset",
              label: "Upload proof asset",
              item_type: "file_upload",
              required: true,
              proof_required: true
            }
          ]
        }
      ]
    });

    const instance = await createChecklistInstance(leadershipToken, {
      template_id: template.id,
      scope_type: "production_item",
      scope_id: productionItemId,
      owner_user_id: sportsManagerUserId,
      approver_user_id: leadershipUserId
    });
    const proofItem = findItem(instance, "proof_asset");

    const responseSave = await request(app)
      .post(`/api/checklists/instances/${instance.id}/responses`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({
        responses: [
          {
            checklist_item_id: proofItem.id,
            response_json: ["proof-upload.pdf"]
          }
        ]
      });

    expect(responseSave.status).toBe(200);

    const missingProofSubmit = await request(app)
      .post(`/api/checklists/instances/${instance.id}/submit`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({});

    expect(missingProofSubmit.status).toBe(400);
    const missingProofItemIds = missingProofSubmit.body.details?.missing_proof_item_ids ?? missingProofSubmit.body.error?.details?.missing_proof_item_ids ?? [];
    expect(missingProofItemIds).toContain(proofItem.id);

    const refreshed = await getChecklistInstance(sportsToken, instance.id);
    const proofResponse = findItem(refreshed, "proof_asset").response;

    const attachmentResponse = await request(app)
      .post(`/api/checklists/instances/${instance.id}/attachments`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({
        checklist_response_id: proofResponse.id,
        attachment_type: "proof",
        file_name: "proof-upload.pdf",
        content_type: "application/pdf",
        storage_key: `tenants/${tenantId}/checklists/${instance.id}/proof-upload.pdf`,
        object_url: `https://example.test/tenants/${tenantId}/checklists/${instance.id}/proof-upload.pdf`
      });

    expect(attachmentResponse.status).toBe(200);

    const submitResponse = await request(app)
      .post(`/api/checklists/instances/${instance.id}/submit`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({});

    expect(submitResponse.status).toBe(200);
    expect(submitResponse.body.instance.status).toBe("submitted");

    const rejectResponse = await request(app)
      .post(`/api/checklists/instances/${instance.id}/reject`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ note: "Need a cleaner proof packet." });

    expect(rejectResponse.status).toBe(200);
    expect(rejectResponse.body.instance.status).toBe("in_progress");

    const resubmitResponse = await request(app)
      .post(`/api/checklists/instances/${instance.id}/submit`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({});

    expect(resubmitResponse.status).toBe(200);

    const approveResponse = await request(app)
      .post(`/api/checklists/instances/${instance.id}/approve`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ note: "Approved for the next stage." });

    expect(approveResponse.status).toBe(200);
    expect(approveResponse.body.instance.status).toBe("approved");

    const auditRows = await dbPool.query<{ action: string }>(
      `
        SELECT action
        FROM audit_log
        WHERE tenant_id = $1
          AND entity_type = 'checklist_instance'
          AND entity_id = $2
          AND action = ANY($3::text[])
      `,
      [tenantId, instance.id, ["checklist.submitted", "checklist.rejected", "checklist.approved"]]
    );

    const auditActions = auditRows.rows.map((row) => row.action);
    expect(auditActions.filter((action) => action === "checklist.submitted")).toHaveLength(2);
    expect(auditActions).toContain("checklist.rejected");
    expect(auditActions).toContain("checklist.approved");

    const notificationRows = await dbPool.query<{ notification_type: string }>(
      `
        SELECT payload ->> 'notification_type' AS notification_type
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'notification.dispatch'
          AND payload #>> '{metadata,checklist_instance_id}' = $2
      `,
      [tenantId, instance.id]
    );

    expect(notificationRows.rows.some((row) => row.notification_type === "workflow.checklist.approval_requested")).toBe(true);
    expect(notificationRows.rows.some((row) => row.notification_type === "workflow.checklist.rejected")).toBe(true);
    expect(notificationRows.rows.some((row) => row.notification_type === "workflow.checklist.approved")).toBe(true);
  });

  it("does not allow rejection before a checklist has been submitted", async () => {
    const publish = await createPublishedSportsJob();
    const productionItemId = publish.production_items[0].id;
    await assignProductionOwner(publish.job.id, productionItemId, sportsManagerUserId);

    const instance = await createChecklistInstance(leadershipToken, {
      template_code: "artist_self_qa",
      scope_type: "production_item",
      scope_id: productionItemId,
      owner_user_id: sportsManagerUserId,
      reviewer_user_id: leadershipUserId
    });

    const rejectResponse = await request(app)
      .post(`/api/checklists/instances/${instance.id}/reject`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ note: "Cannot reject before submission." });

    expect(rejectResponse.status).toBe(409);
  });

  it("rejects approval attempts from staff who are not assigned reviewers or approvers and audits the denial", async () => {
    const publish = await createPublishedSportsJob();
    const productionItemId = publish.production_items[0].id;
    await assignProductionOwner(publish.job.id, productionItemId, photographerUserId);

    const template = await createTemplateAndPublish(leadershipToken, {
      name: "Restricted Approval Gate",
      code: uniqueCode("restricted_approval_gate"),
      department_type: "sports",
      scope_type: "production_item",
      trigger_type: "manual",
      approval_required: true,
      blocking_level: "hard_block",
      sections: [
        {
          section_key: "core",
          title: "Core",
          items: [
            {
              item_key: "ready_for_review",
              label: "Ready for review",
              item_type: "checkbox",
              required: true
            }
          ]
        }
      ]
    });

    const instance = await createChecklistInstance(leadershipToken, {
      template_id: template.id,
      scope_type: "production_item",
      scope_id: productionItemId,
      owner_user_id: photographerUserId,
      reviewer_user_id: sportsManagerUserId,
      approver_user_id: sportsManagerUserId
    });
    const readyItem = findItem(instance, "ready_for_review");

    const saveResponse = await request(app)
      .post(`/api/checklists/instances/${instance.id}/responses`)
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        responses: [
          {
            checklist_item_id: readyItem.id,
            response_json: true
          }
        ]
      });

    expect(saveResponse.status).toBe(200);

    const submitResponse = await request(app)
      .post(`/api/checklists/instances/${instance.id}/submit`)
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({});

    expect(submitResponse.status).toBe(200);

    const approveResponse = await request(app)
      .post(`/api/checklists/instances/${instance.id}/approve`)
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({});

    expect(approveResponse.status).toBe(403);

    const deniedAudit = await dbPool.query<{ action: string }>(
      `
        SELECT action
        FROM audit_log
        WHERE tenant_id = $1
          AND entity_type = 'checklist_instance'
          AND entity_id = $2
          AND action = 'checklist.approve_denied'
      `,
      [tenantId, instance.id]
    );

    expect(deniedAudit.rows).toHaveLength(1);
  });

  it("hides manager-only item comments from non-manager readers", async () => {
    const publish = await createPublishedSportsJob();
    const productionItemId = publish.production_items[0].id;
    await assignProductionOwner(publish.job.id, productionItemId, sportsManagerUserId);

    const template = await createTemplateAndPublish(leadershipToken, {
      name: "Comment Visibility Gate",
      code: uniqueCode("comment_visibility_gate"),
      department_type: "sports",
      scope_type: "production_item",
      trigger_type: "manual",
      approval_required: false,
      blocking_level: "none",
      sections: [
        {
          section_key: "notes",
          title: "Notes",
          items: [
            {
              item_key: "notes_item",
              label: "Notes item",
              item_type: "textarea",
              required: false
            }
          ]
        }
      ]
    });

    const instance = await createChecklistInstance(leadershipToken, {
      template_id: template.id,
      scope_type: "production_item",
      scope_id: productionItemId,
      owner_user_id: photographerUserId
    });
    const notesItem = findItem(instance, "notes_item");

    const commentResponse = await request(app)
      .post(`/api/checklists/instances/${instance.id}/comments`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        checklist_item_id: notesItem.id,
        body: "Managers only note.",
        visibility: "manager_only"
      });

    expect(commentResponse.status).toBe(200);

    const photographerView = await getChecklistInstance(photographerToken, instance.id);
    expect(findItem(photographerView, "notes_item").comments).toEqual([]);

    const leadershipView = await getChecklistInstance(leadershipToken, instance.id);
    expect(findItem(leadershipView, "notes_item").comments).toHaveLength(1);
  });

  it("applies role-specific item comment visibility for peer reviewers, managers, and leadership", async () => {
    const publish = await createPublishedSportsJob();
    const productionItemId = publish.production_items[0].id;
    await dbPool.query(
      `
        INSERT INTO user_role_assignment (
          tenant_id,
          user_id,
          role_id,
          scope_type,
          scope_value,
          assigned_by_user_id,
          reason
        )
        SELECT
          $1,
          $2,
          role.id,
          'department'::policy_scope_type,
          'sports',
          $3,
          'Checklist visibility manager coverage'
        FROM role
        WHERE role.code = 'sports_manager'
          AND NOT EXISTS (
            SELECT 1
            FROM user_role_assignment existing
            WHERE existing.tenant_id = $1
              AND existing.user_id = $2
              AND existing.role_id = role.id
              AND existing.scope_type = 'department'::policy_scope_type
              AND existing.scope_value = 'sports'
          )
      `,
      [tenantId, sportsManagerUserId, leadershipUserId]
    );
    await updateProductionItem(publish.job.id, productionItemId, {
      assigned_to_user_id: sportsManagerUserId,
      assigned_peer_reviewer_user_id: photographerUserId
    });

    const template = await createTemplateAndPublish(leadershipToken, {
      name: "Role Visibility Gate",
      code: uniqueCode("role_visibility_gate"),
      department_type: "sports",
      scope_type: "production_item",
      trigger_type: "manual",
      approval_required: false,
      blocking_level: "none",
      sections: [
        {
          section_key: "notes",
          title: "Notes",
          items: [
            {
              item_key: "visibility_notes",
              label: "Visibility notes",
              item_type: "textarea",
              required: false
            }
          ]
        }
      ]
    });

    const instance = await createChecklistInstance(leadershipToken, {
      template_id: template.id,
      scope_type: "production_item",
      scope_id: productionItemId,
      owner_user_id: sportsManagerUserId,
      reviewer_user_id: photographerUserId,
      approver_user_id: leadershipUserId
    });
    const notesItem = findItem(instance, "visibility_notes");

    const managerCommentResponse = await request(app)
      .post(`/api/checklists/instances/${instance.id}/comments`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        checklist_item_id: notesItem.id,
        body: "Peer-review follow-up note.",
        visibility: "manager_only"
      });

    expect(managerCommentResponse.status).toBe(200);

    const leadershipCommentResponse = await request(app)
      .post(`/api/checklists/instances/${instance.id}/comments`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        checklist_item_id: notesItem.id,
        body: "Leadership-only escalation note.",
        visibility: "leadership_only"
      });

    expect(leadershipCommentResponse.status).toBe(200);

    const reviewerCommentResponse = await request(app)
      .post(`/api/checklists/instances/${instance.id}/comments`)
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        checklist_item_id: notesItem.id,
        body: "Reviewer follow-up note.",
        visibility: "manager_only"
      });

    expect(reviewerCommentResponse.status).toBe(200);

    const reviewerView = await getChecklistInstance(photographerToken, instance.id);
    const reviewerComments = findItem(reviewerView, "visibility_notes").comments.map((comment: { body: string }) => comment.body);
    expect(reviewerComments).toContain("Peer-review follow-up note.");
    expect(reviewerComments).toContain("Reviewer follow-up note.");
    expect(reviewerComments).not.toContain("Leadership-only escalation note.");

    const managerView = await getChecklistInstance(sportsToken, instance.id);
    const managerComments = findItem(managerView, "visibility_notes").comments.map((comment: { body: string }) => comment.body);
    expect(managerComments).toContain("Peer-review follow-up note.");
    expect(managerComments).toContain("Reviewer follow-up note.");
    expect(managerComments).not.toContain("Leadership-only escalation note.");

    const leadershipView = await getChecklistInstance(leadershipToken, instance.id);
    const leadershipComments = findItem(leadershipView, "visibility_notes").comments.map((comment: { body: string }) => comment.body);
    expect(leadershipComments).toContain("Peer-review follow-up note.");
    expect(leadershipComments).toContain("Reviewer follow-up note.");
    expect(leadershipComments).toContain("Leadership-only escalation note.");
  });

  it("blocks production transitions until the seeded intake checklist is completed", async () => {
    const publish = await createPublishedSportsJob();
    const productionItemId = publish.production_items[0].id;
    await assignProductionOwner(publish.job.id, productionItemId, sportsManagerUserId);

    const blockedValidation = await request(app)
      .post("/api/checklists/transitions/validate")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        resource_type: "production_item",
        to_stage: "IN_PRODUCTION",
        department_type: "sports",
        job_id: publish.job.id,
        production_item_id: productionItemId
      });

    expect(blockedValidation.status).toBe(200);
    expect(blockedValidation.body.validation.hard_blocked).toBe(true);
    expect(blockedValidation.body.validation.issues[0].template_code).toBe("production_intake_file_receipt");

    const instance = await createChecklistInstance(leadershipToken, {
      template_code: "production_intake_file_receipt",
      scope_type: "production_item",
      scope_id: productionItemId,
      owner_user_id: sportsManagerUserId
    });

    const responses = [
      { itemKey: "expected_files_present", value: true },
      { itemKey: "folder_structure_correct", value: true },
      { itemKey: "naming_correct", value: true },
      { itemKey: "source_files_correct_place", value: true },
      { itemKey: "roster_or_data_present", value: true },
      { itemKey: "expected_file_count", value: 120 },
      { itemKey: "actual_file_count", value: 120 },
      { itemKey: "file_count_match", value: true },
      { itemKey: "deliverable_paths_confirmed", value: ["gallery"] },
      { itemKey: "intake_proof", value: ["receipt.pdf"] }
    ].map(({ itemKey, value }) => ({
      checklist_item_id: findItem(instance, itemKey).id,
      response_json: value
    }));

    const saveResponse = await request(app)
      .post(`/api/checklists/instances/${instance.id}/responses`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({ responses });

    expect(saveResponse.status).toBe(200);
    const refreshed = await getChecklistInstance(sportsToken, instance.id);
    const proofResponse = findItem(refreshed, "intake_proof").response;

    const attachmentResponse = await request(app)
      .post(`/api/checklists/instances/${instance.id}/attachments`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({
        checklist_response_id: proofResponse.id,
        attachment_type: "receipt",
        file_name: "receipt.pdf",
        content_type: "application/pdf",
        storage_key: `tenants/${tenantId}/checklists/${instance.id}/receipt.pdf`,
        object_url: `https://example.test/tenants/${tenantId}/checklists/${instance.id}/receipt.pdf`
      });

    expect(attachmentResponse.status).toBe(200);

    const submitResponse = await request(app)
      .post(`/api/checklists/instances/${instance.id}/submit`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({});

    expect(submitResponse.status).toBe(200);

    const allowedValidation = await request(app)
      .post("/api/checklists/transitions/validate")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        resource_type: "production_item",
        to_stage: "IN_PRODUCTION",
        department_type: "sports",
        job_id: publish.job.id,
        production_item_id: productionItemId
      });

    expect(allowedValidation.status).toBe(200);
    expect(allowedValidation.body.validation.allowed).toBe(true);
  });

  it("fails closed when a workflow block rule points at a missing checklist template", async () => {
    const publish = await createPublishedSportsJob();
    const productionItemId = publish.production_items[0].id;
    const brokenTemplateGateStage = uniqueCode("broken_template_gate").toUpperCase();

    const workflowRule = await dbPool.query<{ id: string }>(
      `
        INSERT INTO workflow_block_rules (
          tenant_id,
          name,
          department_type,
          resource_type,
          from_stage,
          to_stage,
          required_template_code,
          required_instance_status,
          approval_required,
          blocking_level,
          allow_override,
          active_status
        )
        VALUES ($1,$2,'sports'::job_department_type,'production_item'::workflow_block_resource_type,NULL,$3,$4,'submitted'::checklist_instance_status_type,false,'hard_block'::checklist_blocking_level_type,false,true)
        RETURNING id::text AS id
      `,
      [tenantId, `Broken Template Rule ${Date.now()}`, brokenTemplateGateStage, "missing_template_gate"]
    );
    createdWorkflowBlockRuleIds.push(workflowRule.rows[0].id);

    const validationResponse = await request(app)
      .post("/api/checklists/transitions/validate")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        resource_type: "production_item",
        to_stage: brokenTemplateGateStage,
        department_type: "sports",
        job_id: publish.job.id,
        production_item_id: productionItemId
      });

    expect(validationResponse.status).toBe(200);
    expect(validationResponse.body.validation.allowed).toBe(false);
    expect(validationResponse.body.validation.hard_blocked).toBe(true);
    expect(validationResponse.body.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          template_code: "missing_template_gate",
          instance_id: null
        })
      ])
    );
    expect(JSON.stringify(validationResponse.body.validation.issues)).toContain("must be repaired before this transition can continue");
  });

  it("blocks hard transitions when required checklist proof is still missing", async () => {
    const publish = await createPublishedSportsJob();
    const productionItemId = publish.production_items[0].id;
    await assignProductionOwner(publish.job.id, productionItemId, sportsManagerUserId);

    const instance = await createChecklistInstance(leadershipToken, {
      template_code: "production_intake_file_receipt",
      scope_type: "production_item",
      scope_id: productionItemId,
      owner_user_id: sportsManagerUserId
    });

    const responses = [
      { itemKey: "expected_files_present", value: true },
      { itemKey: "folder_structure_correct", value: true },
      { itemKey: "naming_correct", value: true },
      { itemKey: "source_files_correct_place", value: true },
      { itemKey: "roster_or_data_present", value: true },
      { itemKey: "expected_file_count", value: 50 },
      { itemKey: "actual_file_count", value: 50 },
      { itemKey: "file_count_match", value: true },
      { itemKey: "deliverable_paths_confirmed", value: ["gallery"] },
      { itemKey: "intake_proof", value: ["intake-proof.pdf"] }
    ].map(({ itemKey, value }) => ({
      checklist_item_id: findItem(instance, itemKey).id,
      response_json: value
    }));

    const saveResponse = await request(app)
      .post(`/api/checklists/instances/${instance.id}/responses`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({ responses });

    expect(saveResponse.status).toBe(200);

    const validationResponse = await request(app)
      .post("/api/checklists/transitions/validate")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        resource_type: "production_item",
        to_stage: "IN_PRODUCTION",
        department_type: "sports",
        job_id: publish.job.id,
        production_item_id: productionItemId
      });

    expect(validationResponse.status).toBe(200);
    expect(validationResponse.body.validation.hard_blocked).toBe(true);
    const issue = validationResponse.body.validation.issues.find(
      (row: { template_code: string }) => row.template_code === "production_intake_file_receipt"
    );
    expect(issue?.missing_proof_item_ids).toContain(findItem(instance, "intake_proof").id);
    expect(issue?.missing_proof_item_labels).toContain(findItem(instance, "intake_proof").label);
  });

  it("denies unauthorized soft-block overrides and records the attempt", async () => {
    const publish = await createPublishedSportsJob();
    const productionItemId = publish.production_items[0].id;
    await assignProductionOwner(publish.job.id, productionItemId, photographerUserId);
    const customSoftGateStage = uniqueCode("custom_soft_gate").toUpperCase();

    const template = await createTemplateAndPublish(leadershipToken, {
      name: "Soft Override Gate",
      code: uniqueCode("soft_override_gate"),
      department_type: "sports",
      scope_type: "production_item",
      trigger_type: "manual",
      approval_required: false,
      blocking_level: "soft_block",
      sections: [
        {
          section_key: "gate",
          title: "Gate",
          items: [
            {
              item_key: "manager_confirmation",
              label: "Manager confirmed exception path",
              item_type: "checkbox",
              required: true
            }
          ]
        }
      ]
    });

    const workflowRule = await dbPool.query<{ id: string }>(
      `
        INSERT INTO workflow_block_rules (
          tenant_id,
          name,
          department_type,
          resource_type,
          from_stage,
          to_stage,
          required_template_code,
          required_instance_status,
          approval_required,
          blocking_level,
          allow_override,
          active_status
        )
        VALUES ($1,$2,'sports'::job_department_type,'production_item'::workflow_block_resource_type,NULL,$3,$4,'submitted'::checklist_instance_status_type,false,'soft_block'::checklist_blocking_level_type,true,true)
        RETURNING id::text AS id
      `,
      [tenantId, `Soft Override ${Date.now()}`, customSoftGateStage, template.code]
    );
    createdWorkflowBlockRuleIds.push(workflowRule.rows[0].id);

    const instance = await createChecklistInstance(leadershipToken, {
      template_id: template.id,
      scope_type: "production_item",
      scope_id: productionItemId,
      owner_user_id: photographerUserId
    });

    expect(instance.id).toBeTruthy();

    const validationResponse = await request(app)
      .post("/api/checklists/transitions/validate")
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        resource_type: "production_item",
        from_stage: "READY_FOR_QA",
        to_stage: customSoftGateStage,
        department_type: "sports",
        job_id: publish.job.id,
        production_item_id: productionItemId,
        allow_soft_override: true,
        override_reason: "Need to move this forward before the manager is back."
      });

    expect(validationResponse.status).toBe(403);

    const deniedAudit = await dbPool.query<{ action: string }>(
      `
        SELECT action
        FROM audit_log
        WHERE tenant_id = $1
          AND entity_type = 'production_item'
          AND entity_id = $2
          AND action = 'checklist.soft_block_override_denied'
      `,
      [tenantId, productionItemId]
    );

    expect(deniedAudit.rows).toHaveLength(1);
  }, 15_000);

  it("anchors seeded shoot checklist due dates to the shoot timeline and creates them proactively", async () => {
    const createdShoot = await createSportsShoot(sportsToken);

    const instanceRows = await dbPool.query<{
      template_code: string;
      due_at: string | null;
    }>(
      `
        SELECT
          template.code AS template_code,
          instance.due_at::text AS due_at
        FROM checklist_instances instance
        JOIN checklist_templates template ON template.id = instance.template_id
        WHERE instance.tenant_id = $1
          AND instance.shoot_id = $2
          AND template.code = ANY($3::text[])
        ORDER BY template.code ASC
      `,
      [tenantId, createdShoot.shoot.id, ["shoot_readiness", "pre_service_meeting"]]
    );

    expect(instanceRows.rows).toHaveLength(2);

    const readinessDueAt = instanceRows.rows.find((row) => row.template_code === "shoot_readiness")?.due_at ?? null;
    const preServiceDueAt = instanceRows.rows.find((row) => row.template_code === "pre_service_meeting")?.due_at ?? null;

    expect(readinessDueAt).toBeTruthy();
    expect(preServiceDueAt).toBeTruthy();

    const expectedReadinessDueMs = new Date(createdShoot.shoot.showtime).getTime() - 24 * 60 * 60_000;
    const expectedPreServiceDueMs = new Date(createdShoot.shoot.showtime).getTime() - 45 * 60_000;

    expect(Math.abs(new Date(readinessDueAt ?? "").getTime() - expectedReadinessDueMs)).toBeLessThan(60_000);
    expect(Math.abs(new Date(preServiceDueAt ?? "").getTime() - expectedPreServiceDueMs)).toBeLessThan(60_000);
  });

  it("creates the default production intake checklist when a published job creates its default production item", async () => {
    const publish = await createPublishedSportsJob();

    const checklistRows = await dbPool.query<{ template_code: string }>(
      `
        SELECT template.code AS template_code
        FROM checklist_instances instance
        JOIN checklist_templates template ON template.id = instance.template_id
        WHERE instance.tenant_id = $1
          AND instance.production_item_id = $2
          AND template.code = 'production_intake_file_receipt'
      `,
      [tenantId, publish.production_items[0].id]
    );

    expect(checklistRows.rows).toHaveLength(1);
  });

  it("applies seeded assignment defaults when production QA checklists are created without explicit assignees", async () => {
    const publish = await createPublishedSportsJob();
    const productionItemId = publish.production_items[0].id;

    const updatedItem = await updateProductionItem(publish.job.id, productionItemId, {
      assigned_to_user_id: sportsManagerUserId,
      assigned_peer_reviewer_user_id: photographerUserId,
      assigned_release_reviewer_user_id: leadershipUserId
    });

    expect(updatedItem?.assigned_to_user_id).toBe(sportsManagerUserId);

    const peerReview = await createChecklistInstance(leadershipToken, {
      template_code: "peer_review_sign_off",
      scope_type: "production_item",
      scope_id: productionItemId
    });

    expect(peerReview.owner_user_id).toBe(sportsManagerUserId);
    expect(peerReview.reviewer_user_id).toBe(photographerUserId);
    expect(peerReview.approver_user_id).toBe(photographerUserId);

    const finalRelease = await createChecklistInstance(leadershipToken, {
      template_code: "final_release_checklist",
      scope_type: "production_item",
      scope_id: productionItemId
    });

    expect(finalRelease.owner_user_id).toBe(sportsManagerUserId);
    expect(finalRelease.reviewer_user_id).toBe(leadershipUserId);
    expect(finalRelease.approver_user_id).toBe(leadershipUserId);
  });

  it("enforces seeded validation rules for sample-based QA templates", async () => {
    const publish = await createPublishedSportsJob();
    const productionItemId = publish.production_items[0].id;
    await assignProductionOwner(publish.job.id, productionItemId, sportsManagerUserId);

    const instance = await createChecklistInstance(leadershipToken, {
      template_code: "artist_self_qa",
      scope_type: "production_item",
      scope_id: productionItemId
    });

    const samplePercentItem = findItem(instance, "sample_percent");
    const invalidResponse = await request(app)
      .post(`/api/checklists/instances/${instance.id}/responses`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({
        responses: [
          {
            checklist_item_id: samplePercentItem.id,
            response_json: 20
          }
        ]
      });

    expect(invalidResponse.status).toBe(400);
    expect(JSON.stringify(invalidResponse.body)).toContain("at least 30");
  });

  it("uses the published template trigger type when transition validation auto-creates a required checklist", async () => {
    const publish = await createPublishedSportsJob();

    const validationResponse = await request(app)
      .post("/api/checklists/transitions/validate")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        resource_type: "production_item",
        to_stage: "RELEASED",
        department_type: "sports",
        job_id: publish.job.id,
        production_item_id: publish.production_items[0].id
      });

    expect(validationResponse.status).toBe(200);

    const checklistRow = await dbPool.query<{ trigger_type: string }>(
      `
        SELECT instance.trigger_type::text AS trigger_type
        FROM checklist_instances instance
        JOIN checklist_templates template ON template.id = instance.template_id
        WHERE instance.tenant_id = $1
          AND instance.production_item_id = $2
          AND template.code = 'final_release_checklist'
        ORDER BY instance.created_at DESC
        LIMIT 1
      `,
      [tenantId, publish.production_items[0].id]
    );

    expect(checklistRow.rows[0]?.trigger_type).toBe("release_review");
  });

  it("creates deduped reminder notifications and checklist watch flags for overdue instances", async () => {
    const publish = await createPublishedSportsJob();
    const productionItemId = publish.production_items[0].id;
    await assignProductionOwner(publish.job.id, productionItemId, sportsManagerUserId);

    const instance = await createChecklistInstance(leadershipToken, {
      template_code: "production_intake_file_receipt",
      scope_type: "production_item",
      scope_id: productionItemId,
      owner_user_id: sportsManagerUserId
    });
    await setChecklistDueAt(instance.id, plusHours(-4));

    const firstSweep = await request(app)
      .post("/api/checklists/reminders/sweep")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ limit: 250 });

    expect(firstSweep.status).toBe(200);
    expect(firstSweep.body.result.watch_flag_count).toBeGreaterThanOrEqual(1);
    expect(firstSweep.body.result.alert_count).toBeGreaterThanOrEqual(1);

    const firstWatchFlagCount = await dbPool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM job_watch_flags
        WHERE tenant_id = $1
          AND source_entity_type = 'checklist_instance'
          AND source_entity_id = $2
      `,
      [tenantId, instance.id]
    );

    const firstNotificationCount = await dbPool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'notification.dispatch'
          AND payload #>> '{metadata,checklist_instance_id}' = $2
      `,
      [tenantId, instance.id]
    );

    const secondSweep = await request(app)
      .post("/api/checklists/reminders/sweep")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ limit: 250 });

    expect(secondSweep.status).toBe(200);

    const secondWatchFlagCount = await dbPool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM job_watch_flags
        WHERE tenant_id = $1
          AND source_entity_type = 'checklist_instance'
          AND source_entity_id = $2
      `,
      [tenantId, instance.id]
    );

    const secondNotificationCount = await dbPool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'notification.dispatch'
          AND payload #>> '{metadata,checklist_instance_id}' = $2
      `,
      [tenantId, instance.id]
    );

    expect(Number(secondWatchFlagCount.rows[0]?.count ?? "0")).toBe(Number(firstWatchFlagCount.rows[0]?.count ?? "0"));
    expect(Number(secondNotificationCount.rows[0]?.count ?? "0")).toBe(Number(firstNotificationCount.rows[0]?.count ?? "0"));

    const thirdSweep = await request(app)
      .post("/api/checklists/reminders/sweep")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ limit: 250 });

    expect(thirdSweep.status).toBe(200);

    const thirdWatchFlagCount = await dbPool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM job_watch_flags
        WHERE tenant_id = $1
          AND source_entity_type = 'checklist_instance'
          AND source_entity_id = $2
      `,
      [tenantId, instance.id]
    );

    const thirdNotificationCount = await dbPool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'notification.dispatch'
          AND payload #>> '{metadata,checklist_instance_id}' = $2
      `,
      [tenantId, instance.id]
    );

    expect(Number(thirdWatchFlagCount.rows[0]?.count ?? "0")).toBe(Number(firstWatchFlagCount.rows[0]?.count ?? "0"));
    expect(Number(thirdNotificationCount.rows[0]?.count ?? "0")).toBe(Number(firstNotificationCount.rows[0]?.count ?? "0"));

    const watchFlagRows = await dbPool.query<{ flag_type: string }>(
      `
        SELECT flag_type
        FROM job_watch_flags
        WHERE tenant_id = $1
          AND source_entity_type = 'checklist_instance'
          AND source_entity_id = $2
      `,
      [tenantId, instance.id]
    );

    expect(watchFlagRows.rows.some((row) => ["checklist_overdue", "checklist_escalation"].includes(row.flag_type))).toBe(true);

    const notificationEvents = await dbPool.query<{ notification_type: string; channels: string }>(
      `
        SELECT
          payload ->> 'notification_type' AS notification_type,
          (payload -> 'channels')::text AS channels
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'notification.dispatch'
          AND payload #>> '{metadata,checklist_instance_id}' = $2
      `,
      [tenantId, instance.id]
    );

    expect(notificationEvents.rows.some((row) => row.notification_type === "workflow.checklist.overdue" || row.notification_type === "workflow.checklist.escalation")).toBe(true);
    expect(notificationEvents.rows.some((row) => row.channels.includes("email"))).toBe(true);
  }, 30000);

  it("allows the worker-facing reminder sweep endpoint only with the internal secret", async () => {
    const publish = await createPublishedSportsJob();
    await createChecklistInstance(leadershipToken, {
      template_code: "production_intake_file_receipt",
      scope_type: "production_item",
      scope_id: publish.production_items[0].id,
      owner_user_id: sportsManagerUserId
    });
    const checklistRow = await dbPool.query<{ id: string }>(
      `
        SELECT instance.id::text AS id
        FROM checklist_instances instance
        JOIN checklist_templates template ON template.id = instance.template_id
        WHERE instance.tenant_id = $1
          AND instance.production_item_id = $2
          AND template.code = 'production_intake_file_receipt'
        ORDER BY instance.created_at DESC
        LIMIT 1
      `,
      [tenantId, publish.production_items[0].id]
    );
    expect(checklistRow.rows[0]?.id).toBeTruthy();
    await setChecklistDueAt(checklistRow.rows[0].id, plusHours(-3));

    const forbiddenResponse = await request(app).post("/api/checklists/internal/reminders/sweep").send({ limit: 25 });
    expect(forbiddenResponse.status).toBe(403);

    const internalResponse = await request(app)
      .post("/api/checklists/internal/reminders/sweep")
      .set("X-PMC-Internal-Secret", config.INTERNAL_SOCKET_SECRET)
      .send({ tenant_id: tenantId, limit: 25 });

    expect(internalResponse.status).toBe(200);
    expect(internalResponse.body.tenant_count).toBe(1);
    expect(internalResponse.body.scanned_instance_count).toBeGreaterThanOrEqual(1);
    expect(internalResponse.body.results).toHaveLength(1);
  });
});
