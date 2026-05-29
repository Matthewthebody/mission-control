import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

const app = createApp();
const testStamp = Date.now();
const localDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function addLocalDays(isoDate: string, days: number) {
  const next = new Date(`${isoDate}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

let tenantId = "";
let adminToken = "";
let leadershipToken = "";
let photographerToken = "";
let seniorToken = "";
let adminUserId = "";
let leadershipUserId = "";
let seniorUserId = "";
let studioId = "";
let organizationId = "";
let locationId = "";
let primaryContactId = "";
let seededShootId = "";
let manualTemplateId = "";

const createdProjectIds = new Set<string>();
const createdShootIds: string[] = [];
const createdShiftIds: string[] = [];
const createdUploadIds: string[] = [];
const createdSchoolWorkItemIds: string[] = [];
const createdIntegrationSyncOperationIds: string[] = [];
const createdExternalObjectMapExternalIds: string[] = [];

async function ensureProductionProjectReferenceData(tenantId: string) {
  await pool.query(
    `
      INSERT INTO production_project_template (
        tenant_id,
        template_key,
        name,
        description,
        default_priority,
        category,
        default_stage,
        peer_review_required,
        final_qc_required,
        job_type,
        workflow_family,
        workflow_mode,
        season_key
      )
      SELECT
        $1::uuid,
        seeded.template_key,
        seeded.name,
        seeded.description,
        seeded.default_priority::production_project_priority,
        seeded.category::production_project_category,
        seeded.default_stage::production_project_stage,
        seeded.peer_review_required,
        seeded.final_qc_required,
        seeded.job_type::production_project_job_type,
        seeded.workflow_family,
        seeded.workflow_mode,
        seeded.season_key
      FROM (
        VALUES
          ('manual_production_follow_up', 'Manual Production Follow-Up', 'Track a production follow-up manually without falling back to ad hoc notes.', 'normal', 'production_follow_up', 'intake_pending', false, false, 'specialty_graphics', 'general', 'manual_follow_up', 'all_year'),
          ('post_shoot_production_wrap', 'Post-Shoot Production Wrap', 'Make sure production wrap work starts cleanly once a shoot moves into the post-shoot stage.', 'high', 'photography_production', 'in_production', true, true, 'standard_school_production', 'general', 'post_shoot_wrap', 'all_year'),
          ('post_shoot_issue_remediation', 'Post-Shoot Issue Remediation', 'Coordinate production remediation when a post-shoot evaluation flags quality or delivery issues.', 'critical', 'remediation', 'correction_needed', false, false, 'correction_rework', 'general', 'issue_remediation', 'all_year'),
          ('resource_issue_follow_up', 'Resource Issue Follow-Up', 'Turn uploaded issue/reference evidence into a tracked production follow-up item.', 'high', 'qa_peer_review', 'blocked', true, true, 'correction_rework', 'general', 'resource_follow_up', 'all_year'),
          ('digital_production_delivery', 'Digital Production Delivery', 'Track the digital edit, peer review, final QC, and release path for a delivery package.', 'high', 'digital_production', 'ready_for_production', true, true, 'gallery_prep_upload', 'schools', 'digital_delivery', 'all_year'),
          ('school_spring_production_wrap', 'School Spring Production Wrap', 'Season-aware spring production wrap for school work entering post-production.', 'high', 'photography_production', 'in_production', true, true, 'standard_school_production', 'schools', 'post_shoot_wrap', 'spring'),
          ('school_fall_production_wrap', 'School Fall Production Wrap', 'Season-aware fall production wrap for school work entering post-production.', 'high', 'photography_production', 'in_production', true, true, 'standard_school_production', 'schools', 'post_shoot_wrap', 'fall'),
          ('sports_post_production_wrap', 'Sports Production Wrap', 'Sports-specific production wrap for event work entering post-production.', 'high', 'photography_production', 'in_production', true, true, 'sports_production', 'sports', 'post_shoot_wrap', 'all_year')
      ) AS seeded(
        template_key,
        name,
        description,
        default_priority,
        category,
        default_stage,
        peer_review_required,
        final_qc_required,
        job_type,
        workflow_family,
        workflow_mode,
        season_key
      )
      ON CONFLICT (tenant_id, template_key)
      DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        default_priority = EXCLUDED.default_priority,
        category = EXCLUDED.category,
        default_stage = EXCLUDED.default_stage,
        peer_review_required = EXCLUDED.peer_review_required,
        final_qc_required = EXCLUDED.final_qc_required,
        job_type = EXCLUDED.job_type,
        workflow_family = EXCLUDED.workflow_family,
        workflow_mode = EXCLUDED.workflow_mode,
        season_key = EXCLUDED.season_key,
        active_status = true,
        updated_at = now()
    `,
    [tenantId]
  );

  await pool.query(
    `
      INSERT INTO production_project_template_task (
        tenant_id,
        template_id,
        task_key,
        title,
        summary,
        due_offset_days,
        required,
        sort_order,
        task_type,
        handoff_required,
        blocks_release
      )
      SELECT
        template.tenant_id,
        template.id,
        seeded.task_key,
        seeded.title,
        seeded.summary,
        seeded.due_offset_days,
        seeded.required,
        seeded.sort_order,
        seeded.task_type::production_project_task_type,
        seeded.handoff_required,
        seeded.blocks_release
      FROM production_project_template template
      JOIN (
        VALUES
          ('manual_production_follow_up', 'scope', 'Define scope', 'Capture the production ask in plain language before work starts.', 0, true, 0, 'production', false, false),
          ('manual_production_follow_up', 'owner_due', 'Assign owner and due date', 'Make sure the project has a real owner and a due date.', 0, true, 1, 'production', false, false),
          ('manual_production_follow_up', 'close_loop', 'Close the loop', 'Record the final note or outcome before marking the project complete.', 1, true, 2, 'production', false, false),
          ('post_shoot_production_wrap', 'review_uploads', 'Review uploads and asset coverage', 'Confirm the production team has the expected upload set and reference context.', 0, true, 0, 'production', false, false),
          ('post_shoot_production_wrap', 'confirm_delivery', 'Confirm delivery or handoff path', 'Make sure production knows what happens next for selects, edits, or output delivery.', 1, true, 1, 'handoff', true, false),
          ('post_shoot_production_wrap', 'prepare_delivery', 'Prepare delivery package', 'Build the production package and confirm the handoff scope before review.', 1, true, 2, 'production', false, false),
          ('post_shoot_production_wrap', 'peer_review', 'Peer review the package', 'Assign a peer review pass before final QC or release.', 2, true, 3, 'peer_review', true, true),
          ('post_shoot_production_wrap', 'final_qc', 'Final QC before release', 'Confirm final QC signoff before the package is released.', 3, true, 4, 'final_qc', true, true),
          ('post_shoot_production_wrap', 'close_notes', 'Capture closeout notes', 'Document what production should remember before the project is closed.', 2, true, 5, 'production', false, false),
          ('post_shoot_issue_remediation', 'review_issue', 'Review the issue context', 'Inspect the evaluation notes, open comment, and linked shoot context.', 0, true, 0, 'rework', false, false),
          ('post_shoot_issue_remediation', 'assign_recovery', 'Assign remediation owner', 'Make sure one production owner is responsible for the recovery path.', 0, true, 1, 'handoff', true, false),
          ('post_shoot_issue_remediation', 'confirm_resolution', 'Confirm resolution and follow-up', 'Capture the recovery outcome before closing the remediation project.', 1, true, 2, 'rework', false, false),
          ('resource_issue_follow_up', 'inspect_upload', 'Inspect uploaded concern', 'Review the uploaded evidence and confirm whether it needs production action.', 0, true, 0, 'production', false, false),
          ('resource_issue_follow_up', 'route_response', 'Route the response', 'Assign ownership and set the production response path.', 1, true, 1, 'handoff', true, false),
          ('resource_issue_follow_up', 'peer_review_issue', 'Peer review the concern', 'Have another production teammate review the issue evidence and recommendation.', 0, true, 2, 'peer_review', true, true),
          ('resource_issue_follow_up', 'final_qc_issue', 'Final QC decision', 'Capture the final QC decision before closing the issue follow-up.', 1, true, 3, 'final_qc', true, true),
          ('resource_issue_follow_up', 'close_with_note', 'Close with a note', 'Capture what happened so the next operator does not start blind.', 2, true, 4, 'production', false, false),
          ('digital_production_delivery', 'confirm_scope', 'Confirm edit scope and delivery spec', 'Make sure the requested output, turnaround, and deliverable are locked before editing starts.', 0, true, 0, 'production', false, false),
          ('digital_production_delivery', 'build_package', 'Build the digital production package', 'Complete the retouching, export prep, and package assembly work.', 1, true, 1, 'production', false, false),
          ('digital_production_delivery', 'peer_review_pass', 'Peer review the package', 'Send the package through a peer review pass before final QC.', 2, true, 2, 'peer_review', true, true),
          ('digital_production_delivery', 'final_qc_signoff', 'Final QC signoff', 'Clear the package through final QC before release.', 3, true, 3, 'final_qc', true, true),
          ('digital_production_delivery', 'release_assets', 'Release the final assets', 'Deliver the approved package and record the release note.', 4, true, 4, 'release', true, false),
          ('school_spring_production_wrap', 'confirm_spring_scope', 'Confirm spring volume scope and comments', 'Carry forward shoot comments, account context, and spring delivery expectations before production starts.', 0, true, 0, 'production', false, false),
          ('school_spring_production_wrap', 'prepare_spring_package', 'Build spring package and correction path', 'Finish the spring production package, check correction needs, and prepare the handoff for review.', 1, true, 1, 'production', false, false),
          ('school_spring_production_wrap', 'peer_review_pass', 'Peer review the spring package', 'Run the spring package through peer review before final QC.', 2, true, 2, 'peer_review', true, true),
          ('school_spring_production_wrap', 'final_qc_signoff', 'Final QC signoff', 'Clear final QC before the spring package is marked ready to send.', 3, true, 3, 'final_qc', true, true),
          ('school_spring_production_wrap', 'release_assets', 'Release spring assets', 'Send the approved spring package and capture the release note.', 4, true, 4, 'release', true, false),
          ('school_fall_production_wrap', 'confirm_fall_scope', 'Confirm fall volume scope and comments', 'Carry forward fall shoot comments, photographer notes, and account context before production starts.', 0, true, 0, 'production', false, false),
          ('school_fall_production_wrap', 'prepare_fall_package', 'Build fall package and correction path', 'Complete the fall package, confirm any corrections, and stage it for peer review.', 1, true, 1, 'production', false, false),
          ('school_fall_production_wrap', 'peer_review_pass', 'Peer review the fall package', 'Run the fall package through peer review before final QC.', 2, true, 2, 'peer_review', true, true),
          ('school_fall_production_wrap', 'final_qc_signoff', 'Final QC signoff', 'Clear final QC before the fall package is marked ready to send.', 3, true, 3, 'final_qc', true, true),
          ('school_fall_production_wrap', 'release_assets', 'Release fall assets', 'Send the approved fall package and record the release note.', 4, true, 4, 'release', true, false),
          ('sports_post_production_wrap', 'confirm_event_scope', 'Confirm event scope and comments', 'Carry forward sports-event notes, account context, and output expectations before production starts.', 0, true, 0, 'production', false, false),
          ('sports_post_production_wrap', 'build_sports_package', 'Build sports package and select path', 'Prepare the sports package, capture any corrections, and get it ready for review.', 1, true, 1, 'production', false, false),
          ('sports_post_production_wrap', 'peer_review_pass', 'Peer review the sports package', 'Run the sports package through peer review before final QC.', 2, true, 2, 'peer_review', true, true),
          ('sports_post_production_wrap', 'final_qc_signoff', 'Final QC signoff', 'Clear final QC before the sports package is marked ready to send.', 3, true, 3, 'final_qc', true, true),
          ('sports_post_production_wrap', 'release_assets', 'Release sports assets', 'Send the approved sports package and record the release note.', 4, true, 4, 'release', true, false)
      ) AS seeded(
        template_key,
        task_key,
        title,
        summary,
        due_offset_days,
        required,
        sort_order,
        task_type,
        handoff_required,
        blocks_release
      )
        ON seeded.template_key = template.template_key
      WHERE template.tenant_id = $1::uuid
      ON CONFLICT (tenant_id, template_id, task_key)
      DO UPDATE SET
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        due_offset_days = EXCLUDED.due_offset_days,
        required = EXCLUDED.required,
        sort_order = EXCLUDED.sort_order,
        task_type = EXCLUDED.task_type,
        handoff_required = EXCLUDED.handoff_required,
        blocks_release = EXCLUDED.blocks_release,
        updated_at = now()
    `,
    [tenantId]
  );

  await pool.query(
    `
      INSERT INTO production_project_template_task_dependency (
        tenant_id,
        template_id,
        task_template_id,
        depends_on_template_task_id
      )
      SELECT
        template.tenant_id,
        template.id,
        child.id,
        parent.id
      FROM production_project_template template
      JOIN (
        VALUES
          ('manual_production_follow_up', 'owner_due', 'scope'),
          ('manual_production_follow_up', 'close_loop', 'owner_due'),
          ('post_shoot_production_wrap', 'confirm_delivery', 'review_uploads'),
          ('post_shoot_production_wrap', 'prepare_delivery', 'confirm_delivery'),
          ('post_shoot_production_wrap', 'peer_review', 'prepare_delivery'),
          ('post_shoot_production_wrap', 'final_qc', 'peer_review'),
          ('post_shoot_production_wrap', 'close_notes', 'final_qc'),
          ('post_shoot_issue_remediation', 'assign_recovery', 'review_issue'),
          ('post_shoot_issue_remediation', 'confirm_resolution', 'assign_recovery'),
          ('resource_issue_follow_up', 'route_response', 'inspect_upload'),
          ('resource_issue_follow_up', 'peer_review_issue', 'route_response'),
          ('resource_issue_follow_up', 'final_qc_issue', 'peer_review_issue'),
          ('resource_issue_follow_up', 'close_with_note', 'final_qc_issue'),
          ('digital_production_delivery', 'build_package', 'confirm_scope'),
          ('digital_production_delivery', 'peer_review_pass', 'build_package'),
          ('digital_production_delivery', 'final_qc_signoff', 'peer_review_pass'),
          ('digital_production_delivery', 'release_assets', 'final_qc_signoff'),
          ('school_spring_production_wrap', 'prepare_spring_package', 'confirm_spring_scope'),
          ('school_spring_production_wrap', 'peer_review_pass', 'prepare_spring_package'),
          ('school_spring_production_wrap', 'final_qc_signoff', 'peer_review_pass'),
          ('school_spring_production_wrap', 'release_assets', 'final_qc_signoff'),
          ('school_fall_production_wrap', 'prepare_fall_package', 'confirm_fall_scope'),
          ('school_fall_production_wrap', 'peer_review_pass', 'prepare_fall_package'),
          ('school_fall_production_wrap', 'final_qc_signoff', 'peer_review_pass'),
          ('school_fall_production_wrap', 'release_assets', 'final_qc_signoff'),
          ('sports_post_production_wrap', 'build_sports_package', 'confirm_event_scope'),
          ('sports_post_production_wrap', 'peer_review_pass', 'build_sports_package'),
          ('sports_post_production_wrap', 'final_qc_signoff', 'peer_review_pass'),
          ('sports_post_production_wrap', 'release_assets', 'final_qc_signoff')
      ) AS dep(template_key, child_task_key, parent_task_key)
        ON dep.template_key = template.template_key
      JOIN production_project_template_task child
        ON child.tenant_id = template.tenant_id
       AND child.template_id = template.id
       AND child.task_key = dep.child_task_key
      JOIN production_project_template_task parent
        ON parent.tenant_id = template.tenant_id
       AND parent.template_id = template.id
       AND parent.task_key = dep.parent_task_key
      WHERE template.tenant_id = $1::uuid
      ON CONFLICT (tenant_id, task_template_id, depends_on_template_task_id)
      DO NOTHING
    `,
    [tenantId]
  );

  await pool.query(
    `
      INSERT INTO production_project_trigger_rule (
        tenant_id,
        trigger_key,
        template_id,
        name,
        description,
        default_due_offset_days,
        default_follow_up_offset_days
      )
      SELECT
        template.tenant_id,
        seeded.trigger_key,
        template.id,
        seeded.name,
        seeded.description,
        seeded.default_due_offset_days,
        seeded.default_follow_up_offset_days
      FROM production_project_template template
      JOIN (
        VALUES
          ('post_shoot_production_wrap', 'shoot_completed_post_production', 'Shoot completed and needs production wrap', 'Create a production wrap project when a shoot moves into COMPLETE.', 2, 1),
          ('post_shoot_issue_remediation', 'post_shoot_issue_flagged', 'Post-shoot issue flagged', 'Create a remediation project when the post-shoot evaluation flags an issue.', 1, 0),
          ('resource_issue_follow_up', 'resource_issue_follow_up', 'Resource issue follow-up', 'Create a production follow-up when issue/reference media indicates operational production work.', 2, 1),
          ('digital_production_delivery', 'school_gallery_release_intake', 'School gallery release intake', 'Create a canonical production job when gallery-release work is active in the school operations engine.', 0, 1),
          ('digital_production_delivery', 'school_id_production_intake', 'School ID production intake', 'Create a canonical production job when school ID work is active in the school operations engine.', 0, 1),
          ('digital_production_delivery', 'school_yearbook_intake', 'School yearbook intake', 'Create a canonical production job when yearbook work is active in the school operations engine.', 0, 1),
          ('school_spring_production_wrap', 'shoot_completed_post_production_schools_spring', 'School spring post-production intake', 'Create a spring school production job when a school shoot moves into post-production.', 2, 1),
          ('school_fall_production_wrap', 'shoot_completed_post_production_schools_fall', 'School fall post-production intake', 'Create a fall school production job when a school shoot moves into post-production.', 2, 1),
          ('sports_post_production_wrap', 'shoot_completed_post_production_sports', 'Sports post-production intake', 'Create a sports production job when a sports shoot moves into post-production.', 2, 1)
      ) AS seeded(template_key, trigger_key, name, description, default_due_offset_days, default_follow_up_offset_days)
        ON seeded.template_key = template.template_key
      WHERE template.tenant_id = $1::uuid
      ON CONFLICT (tenant_id, trigger_key)
      DO UPDATE SET
        template_id = EXCLUDED.template_id,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        default_due_offset_days = EXCLUDED.default_due_offset_days,
        default_follow_up_offset_days = EXCLUDED.default_follow_up_offset_days,
        active_status = true,
        updated_at = now()
    `,
    [tenantId]
  );
}

beforeAll(async () => {
  adminToken = (await devLogin(app, "admin@example.com")).body.token;
  leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;
  seniorToken = (await devLogin(app, "senior@example.com")).body.token;

  const context = await pool.query(
    `
      SELECT
        tenant.id AS tenant_id,
        admin.id AS admin_user_id,
        leadership.id AS leadership_user_id,
        senior.id AS senior_user_id,
        studio.id AS studio_id,
        org.id AS organization_id,
        loc.id AS location_id,
        contact.id AS primary_contact_id,
        shoot.id AS seeded_shoot_id
      FROM tenant
      JOIN app_user admin
        ON admin.tenant_id = tenant.id
       AND lower(admin.email) = lower('admin@example.com')
      JOIN app_user leadership
        ON leadership.tenant_id = tenant.id
       AND lower(leadership.email) = lower('leadership@example.com')
      JOIN app_user senior
        ON senior.tenant_id = tenant.id
       AND lower(senior.email) = lower('senior@example.com')
      JOIN studio
        ON studio.tenant_id = tenant.id
       AND studio.name = 'Main Studio'
      JOIN organization org
        ON org.tenant_id = tenant.id
       AND org.display_name = 'White Bear Lake High School'
      JOIN shoot_location loc
        ON loc.tenant_id = tenant.id
       AND loc.organization_id = org.id
       AND loc.name = 'Downtown Demo Park'
      JOIN organization_contact contact
        ON contact.tenant_id = tenant.id
       AND contact.organization_id = org.id
       AND contact.full_name = 'Jamie Carlson'
      JOIN shoot
        ON shoot.tenant_id = tenant.id
       AND shoot.shoot_code = 'DEMO-001'
      WHERE tenant.name = 'Demo Studio'
      LIMIT 1
    `
  );

  tenantId = context.rows[0].tenant_id;
  adminUserId = context.rows[0].admin_user_id;
  leadershipUserId = context.rows[0].leadership_user_id;
  seniorUserId = context.rows[0].senior_user_id;
  studioId = context.rows[0].studio_id;
  organizationId = context.rows[0].organization_id;
  locationId = context.rows[0].location_id;
  primaryContactId = context.rows[0].primary_contact_id;
  seededShootId = context.rows[0].seeded_shoot_id;

  await ensureProductionProjectReferenceData(tenantId);

  const templateLookup = await pool.query(
    `
      SELECT id
      FROM production_project_template
      WHERE tenant_id = $1
        AND template_key = 'manual_production_follow_up'
      LIMIT 1
    `,
    [tenantId]
  );
  manualTemplateId = templateLookup.rows[0]?.id ?? "";
});

afterAll(async () => {
  if (createdIntegrationSyncOperationIds.length) {
    await pool.query("DELETE FROM integration_sync_operation WHERE id = ANY($1::uuid[])", [createdIntegrationSyncOperationIds]);
  }

  if (createdExternalObjectMapExternalIds.length) {
    await pool.query(
      "DELETE FROM external_object_map WHERE tenant_id = $1 AND provider = 'monday' AND object_type = 'school_work_item' AND external_id = ANY($2::text[])",
      [tenantId, createdExternalObjectMapExternalIds]
    );
  }

  if (createdSchoolWorkItemIds.length) {
    await pool.query("DELETE FROM school_deliverable WHERE school_work_item_id = ANY($1::uuid[])", [createdSchoolWorkItemIds]);
    await pool.query("DELETE FROM school_work_item WHERE id = ANY($1::uuid[])", [createdSchoolWorkItemIds]);
  }

  if (createdProjectIds.size) {
    const ids = [...createdProjectIds];
    await pool.query("DELETE FROM production_project_event WHERE project_id = ANY($1::uuid[])", [ids]);
    await pool.query("DELETE FROM production_project_task WHERE project_id = ANY($1::uuid[])", [ids]);
    await pool.query("DELETE FROM production_project WHERE id = ANY($1::uuid[])", [ids]);
  }

  if (createdUploadIds.length) {
    await pool.query(
      `
        DELETE FROM resource_library_item
        WHERE tenant_id = $1
          AND source_record_type = 'resource_library_upload'
          AND source_record_id = ANY($2::uuid[])
      `,
      [tenantId, createdUploadIds]
    );
  }

  if (createdShiftIds.length) {
    await pool.query("DELETE FROM time_clock_compliance_flag WHERE shift_id = ANY($1::uuid[])", [createdShiftIds]);
    await pool.query("DELETE FROM post_shoot_evaluation WHERE shift_id = ANY($1::uuid[])", [createdShiftIds]);
    await pool.query("DELETE FROM time_entry WHERE shift_id = ANY($1::uuid[])", [createdShiftIds]);
    await pool.query("DELETE FROM shift_punch WHERE shift_id = ANY($1::uuid[])", [createdShiftIds]);
    await pool.query("DELETE FROM shift_segment WHERE shift_id = ANY($1::uuid[])", [createdShiftIds]);
    await pool.query("DELETE FROM work_shift WHERE id = ANY($1::uuid[])", [createdShiftIds]);
  }

  if (createdShootIds.length) {
    await pool.query("DELETE FROM alert WHERE shoot_id = ANY($1::uuid[])", [createdShootIds]);
    await pool.query("DELETE FROM status_event WHERE shoot_id = ANY($1::uuid[])", [createdShootIds]);
    await pool.query("DELETE FROM shoot_contact_link WHERE shoot_id = ANY($1::uuid[])", [createdShootIds]);
    await pool.query("DELETE FROM shoot WHERE id = ANY($1::uuid[])", [createdShootIds]);
  }
});

describe("production projects workflow", () => {
  it("requires auth before reading the operations projects board", async () => {
    const response = await request(app).get("/api/projects");
    expect(response.status).toBe(401);
  });

  it("supports manual project creation, detail updates, and task completion", async () => {
    const templateResponse = await request(app)
      .get("/api/projects/templates")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(templateResponse.status).toBe(200);
    const template = templateResponse.body.templates.find(
      (entry: { template_key: string }) => entry.template_key === "manual_production_follow_up"
    );
    const digitalTemplate = templateResponse.body.templates.find(
      (entry: { template_key: string }) => entry.template_key === "digital_production_delivery"
    );
    const springTemplate = templateResponse.body.templates.find(
      (entry: { template_key: string }) => entry.template_key === "school_spring_production_wrap"
    );
    const fallTemplate = templateResponse.body.templates.find(
      (entry: { template_key: string }) => entry.template_key === "school_fall_production_wrap"
    );
    const sportsTemplate = templateResponse.body.templates.find(
      (entry: { template_key: string }) => entry.template_key === "sports_post_production_wrap"
    );
    expect(template).toBeTruthy();
    expect(template.category).toBe("production_follow_up");
    expect(template.default_stage).toBe("intake_pending");
    expect(template.workflow_family).toBe("general");
    expect(template.workflow_mode).toBe("manual_follow_up");
    expect(template.season_key).toBe("all_year");
    expect(digitalTemplate).toBeTruthy();
    expect(digitalTemplate.category).toBe("digital_production");
    expect(digitalTemplate.peer_review_required).toBe(true);
    expect(digitalTemplate.final_qc_required).toBe(true);
    expect(digitalTemplate.workflow_family).toBe("schools");
    expect(digitalTemplate.workflow_mode).toBe("digital_delivery");
    expect(digitalTemplate.season_key).toBe("all_year");
    expect(springTemplate).toBeTruthy();
    expect(springTemplate.workflow_family).toBe("schools");
    expect(springTemplate.season_key).toBe("spring");
    expect(fallTemplate).toBeTruthy();
    expect(fallTemplate.workflow_family).toBe("schools");
    expect(fallTemplate.season_key).toBe("fall");
    expect(sportsTemplate).toBeTruthy();
    expect(sportsTemplate.workflow_family).toBe("sports");
    expect(sportsTemplate.workflow_mode).toBe("post_shoot_wrap");
    manualTemplateId = template.id;

    const referenceResponse = await request(app)
      .get(`/api/projects/reference-data?linked_organization_id=${organizationId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(referenceResponse.status).toBe(200);
    expect(referenceResponse.body.organizations.some((entry: { id: string }) => entry.id === organizationId)).toBe(true);
    expect(referenceResponse.body.locations.some((entry: { id: string }) => entry.id === locationId)).toBe(true);
    expect(Array.isArray(referenceResponse.body.shoots)).toBe(true);
    expect(
      referenceResponse.body.shoots.every(
        (entry: { id: string; label: string; organization_id: string | null }) =>
          typeof entry.id === "string" &&
          typeof entry.label === "string" &&
          (entry.organization_id === null || entry.organization_id === organizationId)
      )
    ).toBe(true);

    const createResponse = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        template_id: manualTemplateId,
        title: `Phase 07 Manual Project ${testStamp}`,
        summary: "Manual follow-up for a production department handoff.",
        priority: "high",
        linked_organization_id: organizationId,
        linked_location_id: locationId,
        linked_shoot_id: seededShootId,
        due_date: localDate
      });

    expect(createResponse.status).toBe(201);
    createdProjectIds.add(createResponse.body.project.id);
    expect(createResponse.body.project.source_type).toBe("manual");
    expect(createResponse.body.project.next_action).toMatch(/assign|owner/i);
    expect(createResponse.body.tasks.length).toBeGreaterThan(0);

    const listResponse = await request(app)
      .get(`/api/projects?queue=all&status=open&search=${encodeURIComponent(`Phase 07 Manual Project ${testStamp}`)}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.default_workspace_view).toBe("lead_board");
    expect(listResponse.body.summary.all_unfinished).toBeGreaterThan(0);
    expect(listResponse.body.lead_board.summary_line).toMatch(/unfinished production job/i);
    expect(listResponse.body.filters).toEqual(
      expect.objectContaining({
        workspace_view: "lead_board",
        lead_board_sort: "overdue_severity",
        lead_board_focus: "all"
      })
    );
    expect(listResponse.body.sections.every((section: { items: unknown[] }) => section.items.length === 0)).toBe(true);
    const leadBoardItem = listResponse.body.lead_board.items.find((item: { id: string }) => item.id === createResponse.body.project.id);
    expect(leadBoardItem).toEqual(
      expect.objectContaining({
        title: `Phase 07 Manual Project ${testStamp}`,
        linked_shoot_code: expect.any(String),
        current_step_label: "Define scope",
        stage_label: expect.any(String),
        context_label: expect.any(String),
        production_touch_label: expect.any(String),
        production_touch_reasons: expect.any(Array)
      })
    );

    const updateResponse = await request(app)
      .patch(`/api/projects/${createResponse.body.project.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        owner_user_id: leadershipUserId,
        follow_up_date: localDate,
        latest_note: "Leadership claimed the project from the cockpit.",
        status: "active"
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.project.owner_user_id).toBe(leadershipUserId);
    expect(updateResponse.body.project.status).toBe("new");
    expect(updateResponse.body.project.follow_up_date).toBe(localDate);

    const filteredResponse = await request(app)
      .get(
        `/api/projects?queue=all&status=open&owner_user_id=${leadershipUserId}&source_type=manual&linked_organization_id=${organizationId}&due_state=due_today&workspace_view=staff_workspace`
      )
      .set("Authorization", `Bearer ${adminToken}`);

    expect(filteredResponse.status).toBe(200);
    expect(filteredResponse.body.filters).toEqual(
      expect.objectContaining({
        owner_user_id: leadershipUserId,
        source_type: "manual",
        linked_organization_id: organizationId,
        due_state: "due_today",
        workspace_view: "staff_workspace"
      })
    );
    expect(
      filteredResponse.body.sections.some((section: { items: Array<{ id: string }> }) =>
        section.items.some((item) => item.id === createResponse.body.project.id)
      )
    ).toBe(true);

    const leadBoardFocusResponse = await request(app)
      .get(`/api/projects?queue=all&status=open&workspace_view=lead_board&lead_board_focus=overdue&lead_board_sort=owner`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(leadBoardFocusResponse.status).toBe(200);
    expect(leadBoardFocusResponse.body.filters).toEqual(
      expect.objectContaining({
        workspace_view: "lead_board",
        lead_board_focus: "overdue",
        lead_board_sort: "owner"
      })
    );
    expect(
      leadBoardFocusResponse.body.lead_board.items.every(
        (item: { overdue: boolean; overdue_task_count: number }) => item.overdue || item.overdue_task_count > 0
      )
    ).toBe(true);
    expect(leadBoardFocusResponse.body.sections.every((section: { items: unknown[] }) => section.items.length === 0)).toBe(true);

    const firstTask = updateResponse.body.tasks[0];
    const taskResponse = await request(app)
      .patch(`/api/projects/${createResponse.body.project.id}/tasks/${firstTask.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "done",
        owner_user_id: seniorUserId,
        due_date: localDate,
        latest_note: "Checklist cleared and handed back to production."
      });

    expect(taskResponse.status).toBe(200);
    expect(taskResponse.body.tasks.find((task: { id: string }) => task.id === firstTask.id)).toEqual(
      expect.objectContaining({
        status: "done",
        owner_user_id: seniorUserId,
        due_date: localDate,
        latest_note: "Checklist cleared and handed back to production."
      })
    );
    expect(taskResponse.body.events.some((event: { event_type: string }) => event.event_type === "project.task_updated")).toBe(true);
  });

  it("supports production QA stages and exposes the project snapshot on home", async () => {
    const createResponse = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: `Phase 12 Digital Delivery ${testStamp}`,
        summary: "Digital delivery project that should move through QA and release readiness.",
        category: "digital_production",
        stage: "in_production",
        owner_user_id: leadershipUserId,
        peer_reviewer_user_id: leadershipUserId,
        final_qc_reviewer_user_id: seniorUserId,
        due_date: localDate,
        latest_note: "Production started."
      });

    expect(createResponse.status).toBe(201);
    createdProjectIds.add(createResponse.body.project.id);
    expect(createResponse.body.project.category).toBe("digital_production");
    expect(createResponse.body.project.stage).toBe("in_production");
    expect(createResponse.body.project.peer_review_required).toBe(true);
    expect(createResponse.body.project.final_qc_required).toBe(true);

    const peerReviewResponse = await request(app)
      .patch(`/api/projects/${createResponse.body.project.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "waiting",
        stage: "ready_for_qa",
        latest_note: "Ready for QA review."
      });

    expect(peerReviewResponse.status).toBe(200);
    expect(peerReviewResponse.body.project.stage).toBe("ready_for_qa");
    expect(peerReviewResponse.body.project.qa_state).toBe("peer_review_required");

    const qaReviewResponse = await request(app)
      .patch(`/api/projects/${createResponse.body.project.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "active",
        stage: "in_qa_review",
        latest_note: "QA review started."
      });

    expect(qaReviewResponse.status).toBe(200);
    expect(qaReviewResponse.body.project.stage).toBe("in_qa_review");
    expect(qaReviewResponse.body.project.qa_state).toBe("in_qa_review");

    const finalQcResponse = await request(app)
      .patch(`/api/projects/${createResponse.body.project.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "active",
        stage: "ready_to_release",
        latest_note: "QA passed and release is pending."
      });

    expect(finalQcResponse.status).toBe(200);
    expect(finalQcResponse.body.project.stage).toBe("ready_to_release");
    expect(finalQcResponse.body.project.qa_state).toBe("final_review_required");
    expect(finalQcResponse.body.project.release_state).toBe("ready_to_release");

    const filteredResponse = await request(app)
      .get("/api/projects?queue=all&status=open&category=digital_production&stage=ready_to_release")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(filteredResponse.status).toBe(200);
    expect(filteredResponse.body.filters.category).toBe("digital_production");
    expect(filteredResponse.body.filters.stage).toBe("ready_to_release");
    expect(filteredResponse.body.summary.ready_to_release).toBeGreaterThan(0);

    const homeResponse = await request(app)
      .get(`/api/dashboard/home?mode=app&date=${localDate}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(homeResponse.status).toBe(200);
    expect(homeResponse.body.widgets.today_strip).toEqual(
      expect.objectContaining({
        shoot_count: expect.any(Number),
        urgent_issue_count: expect.any(Number),
        approvals_waiting_count: expect.any(Number),
        late_arrival_count: expect.any(Number),
        production_at_risk_count: expect.any(Number)
      })
    );
    expect(homeResponse.body.widgets.production_projects).toEqual(
      expect.objectContaining({
        visible: true,
        summary_line: expect.any(String),
        counts: expect.objectContaining({
          active_jobs: expect.any(Number),
          blocked: expect.any(Number),
          due_within_24_hours: expect.any(Number),
          jobs_in_qa: expect.any(Number),
          ready_to_release: expect.any(Number)
        }),
        assessment_cards: expect.any(Array),
        focus_items: expect.any(Array),
        urgent_items: expect.any(Array)
      })
    );
    expect(Array.isArray(homeResponse.body.widgets.production_projects.owners)).toBe(true);
    expect(
      homeResponse.body.widgets.production_projects.assessment_cards.some(
        (card: { id: string; action_hash: string }) =>
          card.id === "jobs_in_qa" && card.action_hash === "#production/qa?queue=qa_queue&stage=ready_for_qa"
      )
    ).toBe(true);
    expect(
      homeResponse.body.widgets.production_projects.assessment_cards.some(
        (card: { id: string; action_hash: string }) =>
          card.id === "ready_to_release" &&
          card.action_hash === "#production/release?queue=ready_to_release_queue&stage=ready_to_release"
      )
    ).toBe(true);
    expect(
      homeResponse.body.widgets.production_projects.focus_items.every(
        (item: { title: string; action_hash: string; next_action: string }) =>
          typeof item.title === "string" &&
          item.title.length > 0 &&
          typeof item.next_action === "string" &&
          item.action_hash.startsWith("#production")
      )
    ).toBe(true);
    expect(
      homeResponse.body.widgets.production_projects.owners.every(
        (owner: { pressure_label: string; action_hash: string }) =>
          typeof owner.pressure_label === "string" && owner.action_hash.startsWith("#production")
      )
    ).toBe(true);
    expect(homeResponse.body.widgets.urgent_watch).toEqual(
      expect.objectContaining({
        visible: expect.any(Boolean),
        summary_line: expect.any(String),
        items: expect.any(Array)
      })
    );
    expect(
      homeResponse.body.widgets.urgent_watch.items.every(
        (item: { urgency_label: string; action_hash: string }) =>
          typeof item.urgency_label === "string" &&
          item.urgency_label.length > 0 &&
          item.action_hash.startsWith("#")
      )
    ).toBe(true);
  }, 20000);

  it("creates blocking operational approvals for protected production overrides and exposes them in the approvals inbox", async () => {
    const createResponse = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        template_id: manualTemplateId,
        title: `Approval Routed Production ${testStamp}`,
        summary: "Used to verify operational approval routing from production.",
        priority: "high",
        linked_organization_id: organizationId,
        linked_location_id: locationId,
        linked_shoot_id: seededShootId,
        due_date: localDate
      });

    expect(createResponse.status).toBe(201);
    createdProjectIds.add(createResponse.body.project.id);

    const dueDateApproval = await request(app)
      .patch(`/api/projects/${createResponse.body.project.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        due_date: addLocalDays(localDate, 14),
        latest_note: "Need more production time because the source files arrived late."
      });

    expect(dueDateApproval.status).toBe(202);
    expect(dueDateApproval.body.approval_required).toBe(true);
    expect(dueDateApproval.body.approval_request.request_type).toBe("due_date_extension_approval");
    expect(dueDateApproval.body.detail.approval_summary.blocking_open_count).toBeGreaterThanOrEqual(1);

    const workspaceResponse = await request(app)
      .get("/api/approvals/operational")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(workspaceResponse.status).toBe(200);
    expect(
      workspaceResponse.body.submitted_by_me.some((item: { id: string }) => item.id === dueDateApproval.body.approval_request.id)
    ).toBe(true);

    const detailResponse = await request(app)
      .get(`/api/approvals/operational/${dueDateApproval.body.approval_request.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.request.requested_action_code).toBe("production.extend_due_date");
    expect(detailResponse.body.events.some((event: { event_type: string }) => event.event_type === "approval.requested")).toBe(true);
  });

  it("expands workflow templates into dependent tasks, records task handoffs, and blocks release until gates are complete", async () => {
    const templateResponse = await request(app)
      .get("/api/projects/templates")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(templateResponse.status).toBe(200);
    const digitalTemplate = templateResponse.body.templates.find(
      (entry: { template_key: string }) => entry.template_key === "digital_production_delivery"
    );
    expect(digitalTemplate).toBeTruthy();

    const createResponse = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        template_id: digitalTemplate.id,
        title: `Phase 18 Workflow Expansion ${testStamp}`,
        summary: "Template-driven workflow with explicit review and release gates.",
        owner_user_id: leadershipUserId,
        peer_reviewer_user_id: leadershipUserId,
        final_qc_reviewer_user_id: seniorUserId,
        due_date: localDate,
        linked_organization_id: organizationId,
        linked_location_id: locationId,
        linked_shoot_id: seededShootId
      });

    expect(createResponse.status).toBe(201);
    createdProjectIds.add(createResponse.body.project.id);
    expect(createResponse.body.tasks.length).toBeGreaterThanOrEqual(5);
    expect(createResponse.body.workflow_summary.release_blocked).toBe(true);

    const peerReviewTask = createResponse.body.tasks.find((task: { task_type: string }) => task.task_type === "peer_review");
    expect(peerReviewTask).toBeTruthy();
    expect(peerReviewTask.dependency_state).toBe("blocked");

    const skippedPeerReview = await request(app)
      .patch(`/api/projects/${createResponse.body.project.id}/tasks/${peerReviewTask.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "skipped",
        latest_note: "Trying to waive peer review without an approved exception."
      });

    expect(skippedPeerReview.status).toBe(400);

    const prematurePeerReview = await request(app)
      .patch(`/api/projects/${createResponse.body.project.id}/tasks/${peerReviewTask.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "done",
        latest_note: "Trying to skip ahead to peer review."
      });

    expect(prematurePeerReview.status).toBe(400);

    for (const task of createResponse.body.tasks) {
      const response = await request(app)
        .patch(`/api/projects/${createResponse.body.project.id}/tasks/${task.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: task.task_type === "release" ? "todo" : "done",
          latest_note: `Completed ${task.title}.`
        });

      if (task.task_type === "release") {
        expect(response.status).toBe(200);
      } else {
        expect(response.status).toBe(200);
      }
    }

    const detailBeforeRelease = await request(app)
      .get(`/api/projects/${createResponse.body.project.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(detailBeforeRelease.status).toBe(200);
    const buildPackageTask = detailBeforeRelease.body.tasks.find((task: { task_key: string }) => task.task_key === "build_package");
    expect(buildPackageTask).toBeTruthy();

    const handoffResponse = await request(app)
      .patch(`/api/projects/${createResponse.body.project.id}/tasks/${buildPackageTask.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        handoff_to_user_id: seniorUserId,
        handoff_note: "Handing the build package to QC."
      });

    expect(handoffResponse.status).toBe(200);
    expect(handoffResponse.body.task_handoffs.some((handoff: { task_id: string }) => handoff.task_id === buildPackageTask.id)).toBe(true);
    expect(handoffResponse.body.task_events.some((event: { task_id: string; event_type: string }) => event.task_id === buildPackageTask.id && event.event_type === "task.handoff")).toBe(true);

    const releaseReadyResponse = await request(app)
      .patch(`/api/projects/${createResponse.body.project.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        stage: "ready_to_release",
        latest_note: "All quality gates are complete."
      });

    expect(releaseReadyResponse.status).toBe(200);
    expect(releaseReadyResponse.body.project.stage).toBe("ready_to_release");
    expect(releaseReadyResponse.body.workflow_summary.can_release).toBe(true);

    const releaseResponse = await request(app)
      .patch(`/api/projects/${createResponse.body.project.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        stage: "released_complete",
        latest_note: "Released from the production tracker."
      });

    expect(releaseResponse.status).toBe(200);
    expect(releaseResponse.body.project.stage).toBe("released_complete");
    expect(
      releaseResponse.body.tasks
        .filter((task: { task_type: string }) => task.task_type === "release")
        .every((task: { status: string }) => task.status === "done")
    ).toBe(true);
  });

  it("treats skipped quality gates as incomplete and keeps release behind approval boundaries", async () => {
    const templateResponse = await request(app)
      .get("/api/projects/templates")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(templateResponse.status).toBe(200);
    const digitalTemplate = templateResponse.body.templates.find(
      (entry: { template_key: string }) => entry.template_key === "digital_production_delivery"
    );
    expect(digitalTemplate).toBeTruthy();

    const createResponse = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        template_id: digitalTemplate.id,
        title: `Phase 19 Gate Integrity ${testStamp}`,
        summary: "Regression coverage for skipped peer review and final QC gates.",
        owner_user_id: leadershipUserId,
        peer_reviewer_user_id: leadershipUserId,
        final_qc_reviewer_user_id: seniorUserId,
        due_date: localDate,
        linked_organization_id: organizationId,
        linked_location_id: locationId,
        linked_shoot_id: seededShootId
      });

    expect(createResponse.status).toBe(201);
    createdProjectIds.add(createResponse.body.project.id);

    await pool.query(
      `
        UPDATE production_project_task
        SET
          status = CASE
            WHEN task_type IN ('peer_review', 'final_qc') THEN 'skipped'::production_project_task_status
            WHEN task_type = 'release' THEN 'todo'::production_project_task_status
            ELSE 'done'::production_project_task_status
          END,
          completed_at = CASE
            WHEN task_type = 'release' THEN NULL
            ELSE now()
          END,
          completed_by_user_id = CASE
            WHEN task_type = 'release' THEN NULL
            ELSE $3::uuid
          END,
          updated_by_user_id = $3::uuid,
          updated_at = now()
        WHERE tenant_id = $1
          AND project_id = $2
      `,
      [tenantId, createResponse.body.project.id, adminUserId]
    );

    const detailResponse = await request(app)
      .get(`/api/projects/${createResponse.body.project.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.workflow_summary.pending_peer_review).toBe(true);
    expect(detailResponse.body.workflow_summary.pending_final_qc).toBe(true);
    expect(detailResponse.body.workflow_summary.release_blocked).toBe(true);
    expect(detailResponse.body.workflow_summary.blocked_reasons).toContain("peer review gate incomplete");
    expect(detailResponse.body.workflow_summary.blocked_reasons).toContain("final QC gate incomplete");

    const readyToReleaseAttempt = await request(app)
      .patch(`/api/projects/${createResponse.body.project.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        stage: "ready_to_release",
        latest_note: "Attempting to override skipped quality gates."
      });

    expect(readyToReleaseAttempt.status).toBe(202);
    expect(readyToReleaseAttempt.body.approval_required).toBe(true);
    expect(readyToReleaseAttempt.body.approval_request.request_type).toBe("peer_review_exception_approval");
  });

  it("creates an idempotent project when a shoot moves into post-production", async () => {
    const shootCode = `PROJ-SHOOT-${testStamp}`;
    const createShootResponse = await request(app)
      .post("/api/shoots")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        studio_id: studioId,
        organization_id: organizationId,
        location_id: locationId,
        primary_contact_id: primaryContactId,
        shoot_type: "schools_underclass_portraits",
        shoot_code: shootCode,
        title: "Production Trigger Shoot",
        shoot_date: localDate,
        geofence_radius_meters: 200,
        showtime: `${localDate}T09:00:00.000Z`,
        arrival_time: `${localDate}T09:15:00.000Z`,
        start_time: `${localDate}T09:30:00.000Z`,
        end_time_est: `${localDate}T10:30:00.000Z`,
        planned_staff_count: 2,
        required_lead_count: 1,
        status: "SHOOT_COMPLETE"
      });

    expect(createShootResponse.status).toBe(201);
    const shootId = createShootResponse.body.id as string;
    createdShootIds.push(shootId);

    const completeResponse = await request(app)
      .patch(`/api/shoots/${shootId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "POST_PRODUCTION", post_production_substage: "INTAKE_PENDING" });

    expect(completeResponse.status).toBe(200);

    const firstProject = await pool.query(
      `
        SELECT id
        FROM production_project
        WHERE tenant_id = $1
          AND source_event_key = $2
        LIMIT 1
      `,
      [tenantId, `shoot_completed_post_production:${shootId}`]
    );

    expect(firstProject.rows[0]?.id).toBeTruthy();
    createdProjectIds.add(firstProject.rows[0].id);

    const repeatResponse = await request(app)
      .patch(`/api/shoots/${shootId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ day_of_notes: "Keep the north hallway clear for carts." });

    expect(repeatResponse.status).toBe(200);

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM production_project
        WHERE tenant_id = $1
          AND source_event_key = $2
      `,
      [tenantId, `shoot_completed_post_production:${shootId}`]
    );

    expect(countResult.rows[0].count).toBe(1);
  });

  it("maps sports shoots into sports production jobs during intake", async () => {
    await expectProductionTriggerRule("shoot_completed_post_production_sports");
    const shootCode = `PROJ-SPORTS-${testStamp}`;
    const createShootResponse = await request(app)
      .post("/api/shoots")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        studio_id: studioId,
        organization_id: organizationId,
        location_id: locationId,
        primary_contact_id: primaryContactId,
        shoot_type: "sports",
        shoot_code: shootCode,
        title: "Sports Production Trigger Shoot",
        shoot_date: localDate,
        geofence_radius_meters: 220,
        showtime: `${localDate}T11:00:00.000Z`,
        arrival_time: `${localDate}T11:15:00.000Z`,
        start_time: `${localDate}T11:30:00.000Z`,
        end_time_est: `${localDate}T12:30:00.000Z`,
        planned_staff_count: 3,
        required_lead_count: 1,
        status: "SHOOT_COMPLETE"
      });

    expect(createShootResponse.status).toBe(201);
    const shootId = createShootResponse.body.id as string;
    createdShootIds.push(shootId);

    const completeResponse = await request(app)
      .patch(`/api/shoots/${shootId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "POST_PRODUCTION", post_production_substage: "INTAKE_PENDING" });

    expect(completeResponse.status).toBe(200);

    const projectResult = await pool.query(
      `
        SELECT id::text, job_type::text AS job_type, source_trigger_key
        FROM production_project
        WHERE tenant_id = $1
          AND source_event_key = $2
        LIMIT 1
      `,
      [tenantId, `shoot_completed_post_production:${shootId}`]
    );

    expect(projectResult.rows[0]).toMatchObject({
      job_type: "sports_production",
      source_trigger_key: "shoot_completed_post_production_sports"
    });
    createdProjectIds.add(projectResult.rows[0].id);
  });

  it("routes school shoots into spring and fall workflow templates based on the shoot date", async () => {
    await expectProductionTriggerRule("shoot_completed_post_production_schools_spring");
    await expectProductionTriggerRule("shoot_completed_post_production_schools_fall");

    const createSpringShootResponse = await request(app)
      .post("/api/shoots")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        studio_id: studioId,
        organization_id: organizationId,
        location_id: locationId,
        primary_contact_id: primaryContactId,
        shoot_type: "schools_underclass_portraits",
        shoot_code: `PROJ-SPRING-${testStamp}`,
        title: "Spring Production Trigger Shoot",
        shoot_date: "2026-03-15",
        geofence_radius_meters: 220,
        showtime: "2026-03-15T11:00:00.000Z",
        arrival_time: "2026-03-15T11:15:00.000Z",
        start_time: "2026-03-15T11:30:00.000Z",
        end_time_est: "2026-03-15T12:30:00.000Z",
        planned_staff_count: 3,
        required_lead_count: 1,
        status: "SHOOT_COMPLETE"
      });

    expect(createSpringShootResponse.status).toBe(201);
    const springShootId = createSpringShootResponse.body.id as string;
    createdShootIds.push(springShootId);

    const springTransitionResponse = await request(app)
      .patch(`/api/shoots/${springShootId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "POST_PRODUCTION", post_production_substage: "INTAKE_PENDING" });

    expect(springTransitionResponse.status).toBe(200);

    const springProjectResult = await pool.query(
      `
        SELECT id::text, source_trigger_key
        FROM production_project
        WHERE tenant_id = $1
          AND source_event_key = $2
        LIMIT 1
      `,
      [tenantId, `shoot_completed_post_production:${springShootId}`]
    );

    expect(springProjectResult.rows[0]?.source_trigger_key).toBe("shoot_completed_post_production_schools_spring");
    if (springProjectResult.rows[0]?.id) {
      createdProjectIds.add(springProjectResult.rows[0].id);
    }

    const createFallShootResponse = await request(app)
      .post("/api/shoots")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        studio_id: studioId,
        organization_id: organizationId,
        location_id: locationId,
        primary_contact_id: primaryContactId,
        shoot_type: "schools_underclass_portraits",
        shoot_code: `PROJ-FALL-${testStamp}`,
        title: "Fall Production Trigger Shoot",
        shoot_date: "2026-09-15",
        geofence_radius_meters: 220,
        showtime: "2026-09-15T11:00:00.000Z",
        arrival_time: "2026-09-15T11:15:00.000Z",
        start_time: "2026-09-15T11:30:00.000Z",
        end_time_est: "2026-09-15T12:30:00.000Z",
        planned_staff_count: 3,
        required_lead_count: 1,
        status: "SHOOT_COMPLETE"
      });

    expect(createFallShootResponse.status).toBe(201);
    const fallShootId = createFallShootResponse.body.id as string;
    createdShootIds.push(fallShootId);

    const fallTransitionResponse = await request(app)
      .patch(`/api/shoots/${fallShootId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "POST_PRODUCTION", post_production_substage: "INTAKE_PENDING" });

    expect(fallTransitionResponse.status).toBe(200);

    const fallProjectResult = await pool.query(
      `
        SELECT id::text, source_trigger_key
        FROM production_project
        WHERE tenant_id = $1
          AND source_event_key = $2
        LIMIT 1
      `,
      [tenantId, `shoot_completed_post_production:${fallShootId}`]
    );

    expect(fallProjectResult.rows[0]?.source_trigger_key).toBe("shoot_completed_post_production_schools_fall");
    if (fallProjectResult.rows[0]?.id) {
      createdProjectIds.add(fallProjectResult.rows[0].id);
    }
  });

  it("promotes school work into the canonical production intake funnel and links the upstream record", async () => {
    await expectProductionTriggerRule("school_gallery_release_intake");
    const workTitle = `Josh Tracker Gallery Intake ${testStamp}`;
    const workItemId = await insertSchoolWorkItemFixture({
      title: workTitle,
      description: "Gallery release work imported from the compatibility seam.",
      workType: "gallery_release",
      sourceSystem: "manual_import",
      sourceReference: `josh-master:${testStamp}:gallery`,
      linkedShootId: seededShootId,
      linkedLocationId: locationId,
      ownerUserId: leadershipUserId,
      priority: "high",
      status: "waiting",
      stage: "waiting_on_internal",
      waitingOn: "internal_production",
      dueDate: localDate,
      notes: "Imported from Josh's master tracker compatibility seam."
    });

    const reconcileResponse = await reconcileProductionIntake();

    expect(reconcileResponse.status).toBe(200);
    expect(reconcileResponse.body.counts.created).toBeGreaterThanOrEqual(1);
    expect(reconcileResponse.body.counts.linked).toBeGreaterThanOrEqual(1);

    const response = await request(app)
      .get(`/api/projects?queue=all&status=open&search=${encodeURIComponent(workTitle)}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.intake.counts.created).toBe(0);
    expect(response.body.intake.counts.linked).toBe(0);

    const linkedProjectResult = await pool.query(
      `
        SELECT linked_production_project_id::text AS linked_production_project_id
        FROM school_work_item
        WHERE tenant_id = $1
          AND id = $2::uuid
      `,
      [tenantId, workItemId]
    );

    const linkedProjectId = linkedProjectResult.rows[0]?.linked_production_project_id as string | null;
    expect(linkedProjectId).toBeTruthy();
    if (linkedProjectId) {
      createdProjectIds.add(linkedProjectId);
    }

    const projectResult = await pool.query(
      `
        SELECT
          source_type::text AS source_type,
          source_event_key,
          source_trigger_key,
          job_type::text AS job_type,
          category::text AS category,
          linked_organization_id::text AS linked_organization_id,
          linked_shoot_id::text AS linked_shoot_id
        FROM production_project
        WHERE tenant_id = $1
          AND id = $2::uuid
      `,
      [tenantId, linkedProjectId]
    );

    expect(projectResult.rows[0]).toMatchObject({
      source_type: "trigger",
      source_event_key: `school_work_item:${workItemId}`,
      source_trigger_key: "school_gallery_release_intake",
      job_type: "gallery_prep_upload",
      category: "digital_production",
      linked_organization_id: organizationId,
      linked_shoot_id: seededShootId
    });
    expect(
      response.body.lead_board.items.some((item: { id: string; title: string }) => item.id === linkedProjectId && item.title === workTitle)
    ).toBe(true);
  });

  it("detects duplicate upstream school intake records before they silently create duplicate production jobs", async () => {
    await expectProductionTriggerRule("school_gallery_release_intake");
    const duplicateTitle = `Duplicate Gallery Intake ${testStamp}`;
    const duplicateSourceReference = `josh-master:${testStamp}:duplicate`;

    await insertSchoolWorkItemFixture({
      title: duplicateTitle,
      workType: "gallery_release",
      sourceSystem: "manual_import",
      sourceReference: duplicateSourceReference,
      linkedShootId: seededShootId,
      linkedLocationId: locationId,
      priority: "normal",
      status: "open",
      stage: "intake",
      waitingOn: "none",
      dueDate: localDate
    });
    await insertSchoolWorkItemFixture({
      title: duplicateTitle,
      workType: "gallery_release",
      sourceSystem: "manual_import",
      sourceReference: duplicateSourceReference,
      linkedShootId: seededShootId,
      linkedLocationId: locationId,
      priority: "high",
      status: "open",
      stage: "planning",
      waitingOn: "none",
      dueDate: localDate
    });

    const reconcileResponse = await reconcileProductionIntake();

    expect(reconcileResponse.status).toBe(200);
    expect(reconcileResponse.body.counts.duplicates).toBeGreaterThanOrEqual(1);
    expect(
      reconcileResponse.body.issues.some(
        (issue: { issue_kind: string; title: string }) =>
          issue.issue_kind === "duplicate_source" && issue.title.includes("duplicate upstream intake records")
      )
    ).toBe(true);

    const response = await request(app)
      .get(`/api/projects?queue=all&status=open&search=${encodeURIComponent(duplicateTitle)}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.intake.counts.duplicates).toBeGreaterThanOrEqual(1);
    expect(
      response.body.intake.issues.some(
        (issue: { issue_kind: string; title: string }) =>
          issue.issue_kind === "duplicate_source" && issue.title.includes("duplicate upstream intake records")
      )
    ).toBe(true);

    const projectRows = await pool.query(
      `
        SELECT id::text
        FROM production_project
        WHERE tenant_id = $1
          AND title = $2
          AND source_trigger_key = 'school_gallery_release_intake'
      `,
      [tenantId, duplicateTitle]
    );

    expect(projectRows.rows).toHaveLength(1);
    createdProjectIds.add(projectRows.rows[0].id);
  });

  it("surfaces stale Monday-owned intake sources so the production board can call out upstream drift", async () => {
    await expectProductionTriggerRule("school_gallery_release_intake");
    const externalId = `prod-intake-monday-${testStamp}`;
    const workItemId = await insertSchoolWorkItemFixture({
      title: `Monday Gallery Intake ${testStamp}`,
      workType: "gallery_release",
      sourceSystem: "monday",
      sourceReference: `monday:item:${externalId}`,
      linkedShootId: seededShootId,
      linkedLocationId: locationId,
      priority: "normal",
      status: "waiting",
      stage: "waiting_on_internal",
      waitingOn: "internal_production",
      dueDate: localDate
    });
    await insertMondaySyncFixture(workItemId, externalId, {
      status: "succeeded",
      updatedAt: "2026-03-20T09:00:00.000Z"
    });

    const response = await request(app)
      .get(`/api/projects?queue=all&status=open&search=${encodeURIComponent(`Monday Gallery Intake ${testStamp}`)}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.intake.counts.stale_syncs).toBeGreaterThanOrEqual(1);
    expect(
      response.body.intake.issues.some(
        (issue: { issue_kind: string; action_hash: string; title: string }) =>
          issue.issue_kind === "sync_stale" &&
          issue.title.includes("stale upstream sync") &&
          issue.action_hash === `#admin/integrations?entity_type=school_work_item&entity_id=${workItemId}`
      )
    ).toBe(true);

    const linkedProjectResult = await pool.query(
      `
        SELECT linked_production_project_id::text AS linked_production_project_id
        FROM school_work_item
        WHERE tenant_id = $1
          AND id = $2::uuid
      `,
      [tenantId, workItemId]
    );

    if (linkedProjectResult.rows[0]?.linked_production_project_id) {
      createdProjectIds.add(linkedProjectResult.rows[0].linked_production_project_id);
    }
  });

  it("supports buddy photo and virtual team workflow tracking with exceptions", async () => {
    const createResponse = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        template_id: manualTemplateId,
        title: `Phase 05 Buddy VT ${testStamp}`,
        summary: "Buddy photo sorting and virtual team validation are required.",
        priority: "normal",
        linked_organization_id: organizationId,
        linked_location_id: locationId,
        linked_shoot_id: seededShootId,
        due_date: localDate
      });

    expect(createResponse.status).toBe(201);
    createdProjectIds.add(createResponse.body.project.id);

    const buddyResponse = await request(app)
      .patch(`/api/projects/${createResponse.body.project.id}/buddy-workflow`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "in_progress",
        owner_user_id: adminUserId,
        duplicate_handling_required: true,
        cleanup_completed: false,
        unresolved_group_count: 2,
        notes: "Two buddy groups need review."
      });

    expect(buddyResponse.status).toBe(200);
    expect(buddyResponse.body.buddy_workflow).toEqual(
      expect.objectContaining({
        status: "in_progress",
        owner_user_id: adminUserId,
        duplicate_handling_required: true,
        unresolved_group_count: 2,
        notes: "Two buddy groups need review."
      })
    );

    const virtualTeamResponse = await request(app)
      .patch(`/api/projects/${createResponse.body.project.id}/virtual-team-workflow`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "in_progress",
        owner_user_id: leadershipUserId,
        attributes_validated: false,
        coach_tags_validated: false,
        split_by_group_validated: false,
        ambiguous_match_required: true,
        ambiguous_match_resolved: false,
        notes: "Ambiguous coach tag match needs review."
      });

    expect(virtualTeamResponse.status).toBe(200);
    expect(virtualTeamResponse.body.virtual_team_workflow).toEqual(
      expect.objectContaining({
        status: "in_progress",
        owner_user_id: leadershipUserId,
        attributes_validated: false,
        coach_tags_validated: false,
        split_by_group_validated: false,
        ambiguous_match_required: true,
        notes: "Ambiguous coach tag match needs review."
      })
    );

    const exceptionResponse = await request(app)
      .post(`/api/projects/${createResponse.body.project.id}/exceptions`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        lane_type: "buddy_photos",
        exception_type: "buddy_unresolved_group",
        severity: "high",
        blocking: true,
        assignee_user_id: adminUserId,
        notes: "Buddy group unresolved in folder A."
      });

    expect(exceptionResponse.status).toBe(201);
    expect(exceptionResponse.body.exceptions.length).toBeGreaterThan(0);
    const createdException = exceptionResponse.body.exceptions.find(
      (entry: { exception_type: string }) => entry.exception_type === "buddy_unresolved_group"
    );
    expect(createdException).toBeTruthy();

    const exceptionUpdate = await request(app)
      .patch(`/api/projects/exceptions/${createdException.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "resolved",
        resolution_notes: "Grouped manually and confirmed."
      });

    expect(exceptionUpdate.status).toBe(200);
    expect(exceptionUpdate.body.exceptions.find((entry: { id: string }) => entry.id === createdException.id)).toEqual(
      expect.objectContaining({
        status: "resolved"
      })
    );
  });

  it("creates an issue-remediation project from a post-shoot evaluation with issues", async () => {
    const fixture = await createCloseoutFixture("PSE");

    const response = await request(app)
      .post(`/api/employee/shifts/${fixture.shiftId}/post-shoot-evaluation`)
      .set("Authorization", `Bearer ${seniorToken}`)
      .send({
        overall_shoot_status: "completed_with_issues",
        issue_flag: true,
        open_comment: "Packaging follow-up is needed before delivery.",
        remember_next_time: "Verify print envelopes before loading the van."
      });

    expect(response.status).toBe(201);

    const projectResult = await pool.query(
      `
        SELECT id, linked_shoot_id, source_trigger_key
        FROM production_project
        WHERE tenant_id = $1
          AND source_event_key = $2
        LIMIT 1
      `,
      [tenantId, `post_shoot_issue_flagged:${response.body.evaluation.id}`]
    );

    expect(projectResult.rows[0]).toMatchObject({
      linked_shoot_id: fixture.shootId,
      source_trigger_key: "post_shoot_issue_flagged"
    });
    createdProjectIds.add(projectResult.rows[0].id);
  });

  it("creates a production follow-up project from issue media uploaded to the resource library", async () => {
    const presign = await request(app)
      .post("/api/uploads/presign")
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        content_type: "image/jpeg",
        resource_type: "resource-library-shoot",
        resource_id: seededShootId
      });

    expect(presign.status).toBe(200);

    const uploadResponse = await request(app)
      .post("/api/resource-library/items")
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        target_type: "shoot",
        target_id: seededShootId,
        storage_key: presign.body.storage_key,
        file_name: `mobile-upload-test-project-${testStamp}.jpg`,
        content_type: "image/jpeg",
        file_size_bytes: 120400,
        category: "issue_concern",
        note: "Color correction issue needs production follow-up.",
        upload_source: "mobile_camera",
        url: presign.body.object_url
      });

    expect(uploadResponse.status).toBe(201);
    createdUploadIds.push(uploadResponse.body.id);

    const projectResult = await pool.query(
      `
        SELECT id, source_trigger_key, linked_shoot_id
        FROM production_project
        WHERE tenant_id = $1
          AND source_event_key = $2
        LIMIT 1
      `,
      [tenantId, `resource_issue_follow_up:${uploadResponse.body.id}`]
    );

    expect(projectResult.rows[0]).toMatchObject({
      source_trigger_key: "resource_issue_follow_up",
      linked_shoot_id: seededShootId
    });
    createdProjectIds.add(projectResult.rows[0].id);
  });

  it("records QA reviews and enforces the QA checklist before release", async () => {
    const createResponse = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        template_id: manualTemplateId,
        title: `Phase 20 QA Gate ${testStamp}`,
        summary: "QA review should enforce checklist completeness.",
        job_type: "standard_school_production",
        stage: "intake_pending",
        linked_organization_id: organizationId,
        linked_location_id: locationId,
        linked_shoot_id: seededShootId
      });

    expect(createResponse.status).toBe(201);
    const projectId = createResponse.body.project.id as string;
    createdProjectIds.add(projectId);

    await request(app)
      .patch(`/api/projects/${projectId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active", stage: "ready_for_production", latest_note: "Ready for production." });

    await request(app)
      .patch(`/api/projects/${projectId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active", stage: "in_production", latest_note: "Production started." });

    await request(app)
      .patch(`/api/projects/${projectId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "waiting", stage: "ready_for_qa", latest_note: "QA handoff." });

    await request(app)
      .patch(`/api/projects/${projectId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "waiting", stage: "in_qa_review", latest_note: "QA review in progress." });

    const detailBeforeQaResponse = await request(app)
      .get(`/api/projects/${projectId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(detailBeforeQaResponse.status).toBe(200);

    const requiredTasks = [...detailBeforeQaResponse.body.tasks]
      .filter((task: { id: string; required: boolean; sort_order: number }) => task.required)
      .sort(
        (
          left: { sort_order: number },
          right: { sort_order: number }
        ) => left.sort_order - right.sort_order
      );

    for (const task of requiredTasks) {
      const taskResponse = await request(app)
        .patch(`/api/projects/${projectId}/tasks/${task.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "done", latest_note: "Workflow task completed before QA release gate." });

      expect(taskResponse.status).toBe(200);
    }

    const incompleteQaResponse = await request(app)
      .post(`/api/projects/${projectId}/qa-review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        result: "passed",
        note: "QA attempted with incomplete checklist.",
        qa_checks: [
          { key: "count_reconciliation", status: "pass" },
          { key: "blocking_exceptions", status: "needs_review" }
        ]
      });

    expect(incompleteQaResponse.status).toBe(400);

    const qaResponse = await request(app)
      .post(`/api/projects/${projectId}/qa-review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        result: "passed",
        note: "QA passed with all checks complete.",
        qa_checks: [
          { key: "count_reconciliation", status: "pass" },
          { key: "blocking_exceptions", status: "pass" },
          { key: "buddy_workflow", status: "not_applicable" },
          { key: "virtual_team", status: "not_applicable" },
          { key: "asset_validation", status: "pass" },
          { key: "final_review_notes", status: "pass" }
        ]
      });

    expect(qaResponse.status).toBe(200);
    expect(qaResponse.body.project.stage).toBe("ready_to_release");
    expect(qaResponse.body.reviews[0].qa_checklist_complete).toBe(true);

    const workspaceResponse = await request(app)
      .get("/api/projects/qa-workspace")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(workspaceResponse.status).toBe(200);
    expect(Array.isArray(workspaceResponse.body.ready_for_release)).toBe(true);
  });

  it("exposes production analytics based on workflow data", async () => {
    const response = await request(app)
      .get("/api/projects/analytics?window_days=90")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.window_start).toBeTruthy();
    expect(response.body.qa_issues_by_job_type).toBeInstanceOf(Array);
    expect(response.body.exception_type_frequency).toBeInstanceOf(Array);
  });
});

async function createCloseoutFixture(label: string) {
  const shootCode = `PROJ-${label}-${testStamp}-${Math.floor(Math.random() * 1000)}`;
  const createShootResponse = await request(app)
    .post("/api/shoots")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      studio_id: studioId,
      organization_id: organizationId,
      location_id: locationId,
      primary_contact_id: primaryContactId,
      shoot_type: "schools_underclass_portraits",
      shoot_code: shootCode,
      title: `Project Trigger ${label} Shoot`,
      shoot_date: localDate,
      geofence_radius_meters: 180,
      showtime: `${localDate}T13:45:00.000Z`,
      arrival_time: `${localDate}T14:00:00.000Z`,
      start_time: `${localDate}T14:15:00.000Z`,
      end_time_est: `${localDate}T15:15:00.000Z`,
      planned_staff_count: 1,
      required_lead_count: 1
    });

  expect(createShootResponse.status).toBe(201);
  const shootId = createShootResponse.body.id as string;
  createdShootIds.push(shootId);

  const shiftInsert = await pool.query(
    `
      INSERT INTO work_shift (
        tenant_id, shoot_id, studio_id, assigned_user_id, manager_user_id, created_by_user_id, published_by_user_id,
        shift_kind, status, department, staffing_role, satisfies_lead_coverage, title, starts_at, ends_at,
        location_name, location_address, geofence_radius_meters, navigation_url, notes, published_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$6,
        'shoot','published','schools','senior_photographer',true,$7,$8,$9,
        'Downtown Demo Park','123 School Street, White Bear Lake, MN',180,'https://maps.example/project-trigger','Production project trigger fixture',now()
      )
      RETURNING id
    `,
    [
      tenantId,
      shootId,
      studioId,
      seniorUserId,
      leadershipUserId,
      adminUserId,
      `${shootCode} Senior Coverage`,
      `${localDate}T14:00:00.000Z`,
      `${localDate}T16:00:00.000Z`
    ]
  );

  const shiftId = shiftInsert.rows[0].id as string;
  createdShiftIds.push(shiftId);
  return { shootId, shiftId };
}

async function expectProductionTriggerRule(triggerKey: string) {
  const result = await pool.query(
    `
      SELECT id::text
      FROM production_project_trigger_rule
      WHERE tenant_id = $1
        AND trigger_key = $2
      LIMIT 1
    `,
    [tenantId, triggerKey]
  );

  expect(
    result.rows[0]?.id,
    `Expected production intake trigger rule ${triggerKey} to exist. Run the latest DB migrations before exercising the intake funnel.`
  ).toBeTruthy();
}

async function reconcileProductionIntake() {
  return request(app)
    .post("/api/projects/intake/reconcile")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ anchor_date: localDate });
}

async function insertSchoolWorkItemFixture(input: {
  title: string;
  description?: string | null;
  workType: "gallery_release" | "id_production" | "yearbook";
  sourceSystem: "mission_control" | "manual_import" | "monday";
  sourceReference?: string | null;
  linkedShootId?: string | null;
  linkedLocationId?: string | null;
  ownerUserId?: string | null;
  priority?: "low" | "normal" | "high" | "critical";
  status?: "open" | "in_progress" | "waiting" | "blocked";
  stage?: "intake" | "planning" | "active" | "waiting_on_school" | "waiting_on_internal" | "ready_for_delivery";
  waitingOn?: "none" | "school" | "internal_production";
  dueDate?: string | null;
  slaDate?: string | null;
  blockerReason?: string | null;
  notes?: string | null;
  updatedAt?: string | null;
}) {
  const workItemId = crypto.randomUUID();
  createdSchoolWorkItemIds.push(workItemId);

  await pool.query(
    `
      INSERT INTO school_work_item (
        id,
        tenant_id,
        organization_id,
        school_job_id,
        linked_shoot_id,
        linked_location_id,
        linked_contact_id,
        linked_follow_up_id,
        linked_production_project_id,
        work_type,
        title,
        description,
        owner_user_id,
        status,
        stage,
        priority,
        due_date,
        sla_date,
        blocker_reason,
        waiting_on,
        source_system,
        source_reference,
        generated_by_rule,
        completed_at,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        NULL,
        $4::uuid,
        $5::uuid,
        NULL,
        NULL,
        NULL,
        $6::school_work_type,
        $7,
        $8,
        $9::uuid,
        $10::school_work_status,
        $11::school_work_stage,
        $12::school_work_priority,
        $13::date,
        $14::date,
        $15,
        $16::school_work_waiting_on,
        $17::school_work_source_system,
        $18,
        false,
        NULL,
        $19,
        $20::uuid,
        $20::uuid
      )
    `,
    [
      workItemId,
      tenantId,
      organizationId,
      input.linkedShootId ?? null,
      input.linkedLocationId ?? null,
      input.workType,
      input.title,
      input.description ?? null,
      input.ownerUserId ?? null,
      input.status ?? "open",
      input.stage ?? "intake",
      input.priority ?? "normal",
      input.dueDate ?? null,
      input.slaDate ?? null,
      input.blockerReason ?? null,
      input.waitingOn ?? "none",
      input.sourceSystem,
      input.sourceReference ?? null,
      input.notes ?? null,
      adminUserId
    ]
  );

  if (input.updatedAt) {
    await pool.query(
      `
        UPDATE school_work_item
        SET updated_at = $3::timestamptz
        WHERE tenant_id = $1
          AND id = $2::uuid
      `,
      [tenantId, workItemId, input.updatedAt]
    );
  }

  return workItemId;
}

async function insertMondaySyncFixture(
  workItemId: string,
  externalId: string,
  input: {
    status: "pending" | "processing" | "succeeded" | "failed" | "conflict";
    updatedAt: string;
    lastError?: string | null;
    conflictSummary?: string | null;
  }
) {
  const operationId = crypto.randomUUID();
  createdIntegrationSyncOperationIds.push(operationId);
  createdExternalObjectMapExternalIds.push(externalId);

  await pool.query(
    `
      INSERT INTO integration_sync_operation (
        id,
        tenant_id,
        provider,
        direction,
        entity_type,
        entity_id,
        external_object_type,
        external_id,
        operation_type,
        source_system,
        source_change_key,
        status,
        payload,
        result_payload,
        last_error,
        conflict_summary,
        created_at,
        updated_at
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        'monday',
        'inbound',
        'school_work_item',
        $3::uuid,
        'monday_item',
        $4,
        'schools_hub_monday_import',
        'monday',
        $5,
        $6,
        $7::jsonb,
        '{}'::jsonb,
        $8,
        $9,
        $10::timestamptz,
        $10::timestamptz
      )
    `,
    [
      operationId,
      tenantId,
      workItemId,
      externalId,
      `school_work_item:${externalId}`,
      input.status,
      JSON.stringify({ provider: "monday", external_record_id: externalId }),
      input.lastError ?? null,
      input.conflictSummary ?? null,
      input.updatedAt
    ]
  );

  await pool.query(
    `
      INSERT INTO external_object_map (
        tenant_id,
        provider,
        external_id,
        object_type,
        object_id,
        payload
      )
      VALUES ($1::uuid, 'monday', $2, 'school_work_item', $3::uuid, $4::jsonb)
      ON CONFLICT (tenant_id, provider, external_id, object_type)
      DO UPDATE SET object_id = EXCLUDED.object_id, payload = EXCLUDED.payload
    `,
    [
      tenantId,
      externalId,
      workItemId,
      JSON.stringify({ provider: "monday", external_record_id: externalId })
    ]
  );
}
