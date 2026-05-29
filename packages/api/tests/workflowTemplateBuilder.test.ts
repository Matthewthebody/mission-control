import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let app: Express;
let pool: Pool;
let leadershipToken = "";
let associateToken = "";
const createdTemplateIds: string[] = [];

async function devLogin(email: string) {
  const response = await request(app).post("/auth/dev-login").send({ email });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.token as string;
}

beforeAll(async () => {
  const appModule = await import("../src/app.js");
  const poolModule = await import("../src/db/pool.js");
  app = appModule.createApp();
  pool = poolModule.pool;
  leadershipToken = await devLogin("leadership@example.com");
  associateToken = await devLogin("associate@example.com");
});

afterAll(async () => {
  if (!createdTemplateIds.length) {
    return;
  }
  const versions = await pool.query<{ id: string }>(
    `SELECT id::text FROM workflow_template_version WHERE template_id = ANY($1::uuid[])`,
    [createdTemplateIds]
  );
  const versionIds = versions.rows.map((row) => row.id);
  if (versionIds.length) {
    await pool.query("DELETE FROM workflow_template_step_dependency WHERE template_version_id = ANY($1::uuid[])", [versionIds]);
    await pool.query("DELETE FROM workflow_template_step WHERE template_version_id = ANY($1::uuid[])", [versionIds]);
    await pool.query("DELETE FROM workflow_template_milestone WHERE template_version_id = ANY($1::uuid[])", [versionIds]);
    await pool.query("DELETE FROM app_event WHERE aggregate_id = ANY($1::uuid[])", [versionIds]);
    await pool.query("DELETE FROM workflow_template_version WHERE id = ANY($1::uuid[])", [versionIds]);
  }
  await pool.query("DELETE FROM workflow_template WHERE id = ANY($1::uuid[])", [createdTemplateIds]);
});

describe("workflow template builder v1", () => {
  it("lets leadership build, preview, publish, and lock a linear workflow template version", async () => {
    const suffix = Date.now();
    const draft = await request(app)
      .post("/api/workflows/template-builder/templates")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        template_key: `builder_v1_${suffix}`,
        name: "Builder V1 Test Workflow",
        description: "Workflow builder smoke coverage.",
        job_type: "photo_day",
        category: "schools",
        departments_involved: ["schools", "production"]
      });

    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    createdTemplateIds.push(draft.body.template.id);
    expect(draft.body.version.status).toBe("draft");

    const withMilestone = await request(app)
      .post(`/api/workflows/template-builder/versions/${draft.body.version.id}/milestones`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        milestone_key: "intake",
        name: "Intake",
        description: "Confirm the work before downstream teams start.",
        default_owner_type: "account_owner",
        default_owner_value: "account_owner"
      });

    expect(withMilestone.status, JSON.stringify(withMilestone.body)).toBe(201);
    const milestoneId = withMilestone.body.milestones[0].id;

    const withFirstStep = await request(app)
      .post(`/api/workflows/template-builder/versions/${draft.body.version.id}/steps`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        milestone_template_id: milestoneId,
        step_key: "confirm_scope",
        name: "Confirm scope",
        description: "Make sure account scope is complete.",
        department: "schools",
        role_key: "account_owner",
        owner_type: "account_owner",
        owner_value: "account_owner",
        expected_duration_minutes: 1440,
        dependency_mode: "can_start_immediately"
      });

    expect(withFirstStep.status, JSON.stringify(withFirstStep.body)).toBe(201);

    const withSecondStep = await request(app)
      .post(`/api/workflows/template-builder/versions/${draft.body.version.id}/steps`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        milestone_template_id: milestoneId,
        step_key: "qa_review",
        name: "QA review",
        description: "Check work before release.",
        department: "production",
        role_key: "qa_reviewer",
        owner_type: "role",
        owner_value: "qa_reviewer",
        expected_duration_minutes: 720,
        dependency_mode: "waits_for_dependencies",
        depends_on_step_keys: ["confirm_scope"]
      });

    expect(withSecondStep.status, JSON.stringify(withSecondStep.body)).toBe(201);
    expect(withSecondStep.body.milestones[0].steps.map((step: any) => step.step_key)).toEqual(["confirm_scope", "qa_review"]);
    expect(withSecondStep.body.milestones[0].steps[1].depends_on_step_keys).toEqual(["confirm_scope"]);
    const qaStepId = withSecondStep.body.milestones[0].steps[1].id;

    const editedStep = await request(app)
      .patch(`/api/workflows/template-builder/versions/${draft.body.version.id}/steps/${qaStepId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        milestone_template_id: milestoneId,
        step_key: "production_qa_review",
        name: "Production QA review",
        description: "Check production work before release.",
        department: "production",
        role_key: "production_lead",
        owner_type: "department",
        owner_value: "production",
        expected_duration_minutes: 240,
        due_offset_minutes: 0,
        dependency_mode: "waits_for_dependencies",
        depends_on_step_keys: ["confirm_scope"],
        required: true,
        skippable: false,
        blocking: true,
        sort_order: 15
      });
    expect(editedStep.status, JSON.stringify(editedStep.body)).toBe(200);
    const updatedStep = editedStep.body.milestones[0].steps.find((step: any) => step.id === qaStepId);
    expect(updatedStep.name).toBe("Production QA review");
    expect(updatedStep.department).toBe("production");
    expect(updatedStep.owner_type).toBe("department");
    expect(updatedStep.owner_value).toBe("production");
    expect(updatedStep.expected_duration_minutes).toBe(240);
    expect(updatedStep.depends_on_step_keys).toEqual(["confirm_scope"]);

    const preview = await request(app)
      .get(`/api/workflows/template-builder/versions/${draft.body.version.id}/preview`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.template.name).toBe("Builder V1 Test Workflow");
    expect(preview.body.milestones[0].steps[1].owner_value).toBe("production");

    const published = await request(app)
      .post(`/api/workflows/template-builder/versions/${draft.body.version.id}/publish`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect(published.body.version.status).toBe("published");
    expect(published.body.version.default_for_new_jobs).toBe(true);

    const lockedEdit = await request(app)
      .post(`/api/workflows/template-builder/versions/${draft.body.version.id}/milestones`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ milestone_key: "release", name: "Release" });
    expect(lockedEdit.status).toBe(400);

    const lockedStepEdit = await request(app)
      .patch(`/api/workflows/template-builder/versions/${draft.body.version.id}/steps/${qaStepId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        milestone_template_id: milestoneId,
        step_key: "locked_change",
        name: "Locked change",
        description: "Should not edit a published version.",
        department: "production",
        owner_type: "department",
        owner_value: "production",
        expected_duration_minutes: 240
      });
    expect(lockedStepEdit.status).toBe(400);
  });

  it("supports draft-only move and safe remove controls for template steps", async () => {
    const suffix = Date.now();
    const draft = await request(app)
      .post("/api/workflows/template-builder/templates")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        template_key: `builder_move_remove_${suffix}`,
        name: "Builder Move Remove Test Workflow",
        description: "Workflow builder move/remove coverage.",
        job_type: "photo_day",
        category: "schools",
        departments_involved: ["schools", "production"]
      });

    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    createdTemplateIds.push(draft.body.template.id);

    const withMilestone = await request(app)
      .post(`/api/workflows/template-builder/versions/${draft.body.version.id}/milestones`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        milestone_key: "intake",
        name: "Intake",
        description: "Confirm the work before downstream teams start.",
        default_owner_type: "account_owner",
        default_owner_value: "account_owner"
      });
    expect(withMilestone.status, JSON.stringify(withMilestone.body)).toBe(201);
    const milestoneId = withMilestone.body.milestones[0].id;

    const createStep = (step_key: string, name: string, depends_on_step_keys: string[] = []) =>
      request(app)
        .post(`/api/workflows/template-builder/versions/${draft.body.version.id}/steps`)
        .set("Authorization", `Bearer ${leadershipToken}`)
        .send({
          milestone_template_id: milestoneId,
          step_key,
          name,
          description: `${name} coverage.`,
          department: step_key === "production_qa" ? "production" : "schools",
          role_key: step_key === "production_qa" ? "production_lead" : "account_owner",
          owner_type: step_key === "production_qa" ? "department" : "account_owner",
          owner_value: step_key === "production_qa" ? "production" : "account_owner",
          expected_duration_minutes: 1440,
          dependency_mode: depends_on_step_keys.length ? "waits_for_dependencies" : "can_start_immediately",
          depends_on_step_keys
        });

    const withFirst = await createStep("confirm_scope", "Confirm scope");
    expect(withFirst.status, JSON.stringify(withFirst.body)).toBe(201);
    const withSecond = await createStep("production_qa", "Production QA");
    expect(withSecond.status, JSON.stringify(withSecond.body)).toBe(201);
    const withThird = await createStep("release_ready", "Release ready", ["production_qa"]);
    expect(withThird.status, JSON.stringify(withThird.body)).toBe(201);

    const steps = withThird.body.milestones[0].steps as Array<{ id: string; step_key: string; sort_order: number }>;
    expect(steps.map((step) => step.step_key)).toEqual(["confirm_scope", "production_qa", "release_ready"]);
    const confirmStep = steps.find((step) => step.step_key === "confirm_scope");
    const productionStep = steps.find((step) => step.step_key === "production_qa");
    const releaseStep = steps.find((step) => step.step_key === "release_ready");
    expect(confirmStep?.id).toBeTruthy();
    expect(productionStep?.id).toBeTruthy();
    expect(releaseStep?.id).toBeTruthy();

    const firstCannotMoveUp = await request(app)
      .post(`/api/workflows/template-builder/versions/${draft.body.version.id}/steps/${confirmStep?.id}/move`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ direction: "up" });
    expect(firstCannotMoveUp.status).toBe(400);

    const movedUp = await request(app)
      .post(`/api/workflows/template-builder/versions/${draft.body.version.id}/steps/${productionStep?.id}/move`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ direction: "up" });
    expect(movedUp.status, JSON.stringify(movedUp.body)).toBe(200);
    expect(movedUp.body.milestones[0].steps.map((step: any) => step.step_key)).toEqual(["production_qa", "confirm_scope", "release_ready"]);
    expect(movedUp.body.milestones[0].steps.map((step: any) => step.sort_order)).toEqual([10, 20, 30]);

    const movedDown = await request(app)
      .post(`/api/workflows/template-builder/versions/${draft.body.version.id}/steps/${productionStep?.id}/move`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ direction: "down" });
    expect(movedDown.status, JSON.stringify(movedDown.body)).toBe(200);
    expect(movedDown.body.milestones[0].steps.map((step: any) => step.step_key)).toEqual(["confirm_scope", "production_qa", "release_ready"]);

    const removeDependencyTarget = await request(app)
      .delete(`/api/workflows/template-builder/versions/${draft.body.version.id}/steps/${productionStep?.id}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(removeDependencyTarget.status).toBe(409);

    const removedRelease = await request(app)
      .delete(`/api/workflows/template-builder/versions/${draft.body.version.id}/steps/${releaseStep?.id}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(removedRelease.status, JSON.stringify(removedRelease.body)).toBe(200);
    expect(removedRelease.body.milestones[0].steps.map((step: any) => step.step_key)).toEqual(["confirm_scope", "production_qa"]);
    expect(removedRelease.body.milestones[0].steps.map((step: any) => step.sort_order)).toEqual([10, 20]);

    const published = await request(app)
      .post(`/api/workflows/template-builder/versions/${draft.body.version.id}/publish`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(published.status, JSON.stringify(published.body)).toBe(200);

    const lockedMove = await request(app)
      .post(`/api/workflows/template-builder/versions/${draft.body.version.id}/steps/${productionStep?.id}/move`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ direction: "up" });
    expect(lockedMove.status).toBe(400);

    const lockedRemove = await request(app)
      .delete(`/api/workflows/template-builder/versions/${draft.body.version.id}/steps/${productionStep?.id}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(lockedRemove.status).toBe(400);
  });

  it("keeps workflow template management leadership-only", async () => {
    const response = await request(app)
      .post("/api/workflows/template-builder/templates")
      .set("Authorization", `Bearer ${associateToken}`)
      .send({
        template_key: `builder_denied_${Date.now()}`,
        name: "Denied Workflow",
        departments_involved: ["schools"]
      });

    expect(response.status).toBe(403);
  });
});
