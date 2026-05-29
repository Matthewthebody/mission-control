import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devLogin, elevateSession, getMembershipId, getTenantId, passwordLogin } from "./helpers.js";

let app: Express;
let dbPool: Pool;
let adminToken = "";
let leadershipToken = "";
let sportsToken = "";
let associateToken = "";
let adminUserId = "";
let associateUserId = "";
let demoTenantId = "";
let sportsOrganizationId = "";
let sportsLocationId = "";
let sportsContactId = "";
const diagnosticsRunId = Date.now().toString();

function plusDaysWithHours(days: number, hours: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

async function createDraft(token: string, payload: Record<string, unknown>) {
  return request(app).post("/api/jobs/drafts").set("Authorization", `Bearer ${token}`).send(payload);
}

async function publishJob(token: string, jobId: string) {
  return request(app).post(`/api/jobs/${jobId}/publish`).set("Authorization", `Bearer ${token}`).send({});
}

async function createPublishedSportsJob(overrides: Record<string, unknown> = {}) {
  const title = `Diagnostics Sports Job ${diagnosticsRunId}-${Math.floor(Math.random() * 10_000)}`;
  const draft = await createDraft(sportsToken, {
    department_type: "sports",
    job_category: "photo_day",
    organization_id: sportsOrganizationId,
    primary_location_id: sportsLocationId,
    primary_contact_id: sportsContactId,
    title,
    scheduled_start_at: plusDaysWithHours(3, 18),
    scheduled_end_at: plusDaysWithHours(3, 20),
    timezone: "America/Chicago",
    estimated_staff_count: 2,
    production_required: true,
    sports_profile: {
      sport_type: "football",
      season: "fall",
      team_structure: "scheduled_slots",
      proof_required: true,
      approval_contact_id: sportsContactId
    },
    ...overrides
  });

  expect(draft.status).toBe(201);

  const published = await publishJob(sportsToken, draft.body.job.id);
  expect(published.status).toBe(200);
  return published.body;
}

async function cleanupDiagnosticsSportsJobs() {
  if (!demoTenantId) {
    return;
  }

  const jobIds = (
    await dbPool.query<{ id: string }>(
      `
        SELECT id::text
        FROM jobs
        WHERE tenant_id = $1
          AND title LIKE $2
      `,
      [demoTenantId, `Diagnostics Sports Job ${diagnosticsRunId}-%`]
    )
  ).rows.map((row) => row.id);

  if (!jobIds.length) {
    return;
  }

  const runIds = (
    await dbPool.query<{ id: string }>(
      `
        SELECT id::text
        FROM workflow_run
        WHERE tenant_id = $1
          AND job_id = ANY($2::uuid[])
      `,
      [demoTenantId, jobIds]
    )
  ).rows.map((row) => row.id);

  await dbPool.query(
    `
      DELETE FROM app_event
      WHERE tenant_id = $1
        AND (
          aggregate_id = ANY($2::uuid[])
          OR aggregate_id = ANY($3::uuid[])
        )
    `,
    [demoTenantId, jobIds, runIds]
  );
  await dbPool.query("DELETE FROM work_task WHERE tenant_id = $1 AND related_job_id = ANY($2::uuid[])", [demoTenantId, jobIds]);
  await dbPool.query("DELETE FROM workflow_handoff WHERE tenant_id = $1 AND workflow_run_id = ANY($2::uuid[])", [demoTenantId, runIds]);
  await dbPool.query("DELETE FROM workflow_step_audit_log WHERE tenant_id = $1 AND workflow_run_id = ANY($2::uuid[])", [demoTenantId, runIds]);
  await dbPool.query("DELETE FROM workflow_step_dependency WHERE tenant_id = $1 AND workflow_run_id = ANY($2::uuid[])", [demoTenantId, runIds]);
  await dbPool.query("DELETE FROM workflow_step WHERE tenant_id = $1 AND workflow_run_id = ANY($2::uuid[])", [demoTenantId, runIds]);
  await dbPool.query("DELETE FROM workflow_run_milestone WHERE tenant_id = $1 AND workflow_run_id = ANY($2::uuid[])", [demoTenantId, runIds]);
  await dbPool.query("DELETE FROM workflow_run WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [demoTenantId, runIds]);
  await dbPool.query("DELETE FROM jobs WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [demoTenantId, jobIds]);
}

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { pool } = await import("../src/db/pool.js");
  app = createApp();
  dbPool = pool;

  adminToken = (await passwordLogin(app, "admin@example.com")).body.token;
  leadershipToken = (await passwordLogin(app, "leadership@example.com")).body.token;
  sportsToken = (await devLogin(app, "sports-office@example.com")).body.token;
  associateToken = (await devLogin(app, "associate@example.com")).body.token;
  await elevateSession(app, adminToken, "LocalDemo123!");
  await elevateSession(app, leadershipToken, "LocalDemo123!");

  adminUserId = String(await getMembershipId("admin@example.com"));
  associateUserId = String(await getMembershipId("associate@example.com"));
  demoTenantId = String(await getTenantId("Demo Studio"));

  const fixtureRows = await dbPool.query<{
    department: string;
    organization_id: string;
    location_id: string;
    primary_contact_id: string;
  }>(
    `
      SELECT
        s.department::text AS department,
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

  const sportsFixture = fixtureRows.rows[0];
  if (!sportsFixture) {
    throw new Error("Expected seeded sports shoot for diagnostics tests.");
  }

  sportsOrganizationId = sportsFixture.organization_id;
  sportsLocationId = sportsFixture.location_id;
  sportsContactId = sportsFixture.primary_contact_id;
});

afterAll(async () => {
  await cleanupDiagnosticsSportsJobs();
});

describe("shared audit and diagnostics layer", () => {
  it("keeps admin system routes admin-only and returns the diagnostics workspace", async () => {
    const adminResponse = await request(app)
      .get("/api/admin/system/workspace")
      .set("Authorization", `Bearer ${adminToken}`);
    const adminFoundationResponse = await request(app)
      .get("/api/admin/system/foundation")
      .set("Authorization", `Bearer ${adminToken}`);
    const adminCommunicationsResponse = await request(app)
      .get("/api/admin/system/communications")
      .set("Authorization", `Bearer ${adminToken}`);
    const adminMicrosoftGovernanceResponse = await request(app)
      .get("/api/admin/system/microsoft-governance")
      .set("Authorization", `Bearer ${adminToken}`);
    const adminMicrosoftOperatingSystemResponse = await request(app)
      .get("/api/admin/system/microsoft-operating-system")
      .set("Authorization", `Bearer ${adminToken}`);
    const adminMicrosoftProvisioningResponse = await request(app)
      .get("/api/admin/system/microsoft-provisioning")
      .set("Authorization", `Bearer ${adminToken}`);
    const adminMicrosoftEmailAutomationResponse = await request(app)
      .get("/api/admin/system/microsoft-email-automation")
      .set("Authorization", `Bearer ${adminToken}`);
    const adminMicrosoftSmsOptimizationResponse = await request(app)
      .get("/api/admin/system/microsoft-sms-optimization")
      .set("Authorization", `Bearer ${adminToken}`);
    const adminMicrosoftClientIntakeResponse = await request(app)
      .get("/api/admin/system/microsoft-client-intake")
      .set("Authorization", `Bearer ${adminToken}`);
    const adminMicrosoftClientIntakeOperationsResponse = await request(app)
      .get("/api/admin/system/microsoft-client-intake-operations")
      .set("Authorization", `Bearer ${adminToken}`);
    const adminMicrosoftClientPortalResponse = await request(app)
      .get("/api/admin/system/microsoft-client-portal")
      .set("Authorization", `Bearer ${adminToken}`);
    const leadershipResponse = await request(app)
      .get("/api/admin/system/workspace")
      .set("Authorization", `Bearer ${leadershipToken}`);
    const leadershipFoundationResponse = await request(app)
      .get("/api/admin/system/foundation")
      .set("Authorization", `Bearer ${leadershipToken}`);
    const leadershipCommunicationsResponse = await request(app)
      .get("/api/admin/system/communications")
      .set("Authorization", `Bearer ${leadershipToken}`);
    const leadershipMicrosoftGovernanceResponse = await request(app)
      .get("/api/admin/system/microsoft-governance")
      .set("Authorization", `Bearer ${leadershipToken}`);
    const leadershipMicrosoftOperatingSystemResponse = await request(app)
      .get("/api/admin/system/microsoft-operating-system")
      .set("Authorization", `Bearer ${leadershipToken}`);
    const leadershipMicrosoftProvisioningResponse = await request(app)
      .get("/api/admin/system/microsoft-provisioning")
      .set("Authorization", `Bearer ${leadershipToken}`);
    const leadershipMicrosoftEmailAutomationResponse = await request(app)
      .get("/api/admin/system/microsoft-email-automation")
      .set("Authorization", `Bearer ${leadershipToken}`);
    const leadershipMicrosoftSmsOptimizationResponse = await request(app)
      .get("/api/admin/system/microsoft-sms-optimization")
      .set("Authorization", `Bearer ${leadershipToken}`);
    const leadershipMicrosoftClientIntakeResponse = await request(app)
      .get("/api/admin/system/microsoft-client-intake")
      .set("Authorization", `Bearer ${leadershipToken}`);
    const leadershipMicrosoftClientIntakeOperationsResponse = await request(app)
      .get("/api/admin/system/microsoft-client-intake-operations")
      .set("Authorization", `Bearer ${leadershipToken}`);
    const leadershipMicrosoftClientPortalResponse = await request(app)
      .get("/api/admin/system/microsoft-client-portal")
      .set("Authorization", `Bearer ${leadershipToken}`);
    const deniedRepairs = await request(app)
      .get("/api/admin/system/repairs")
      .set("Authorization", `Bearer ${leadershipToken}`);
    const healthResponse = await request(app).get("/health");

    expect(adminResponse.status).toBe(200);
    expect(adminResponse.body.summary).toBeTruthy();
    expect(Array.isArray(adminResponse.body.health_checks)).toBe(true);
    expect(adminFoundationResponse.status).toBe(200);
    expect(adminFoundationResponse.body).toEqual(
      expect.objectContaining({
        generated_at: expect.any(String),
        feature_flags: expect.any(Object),
        startup_validation: expect.objectContaining({
          valid: expect.any(Boolean),
          issues: expect.any(Array)
        }),
        health_checks: expect.any(Array),
        recent_events: expect.any(Array)
      })
    );
    expect(adminCommunicationsResponse.status).toBe(200);
    expect(adminCommunicationsResponse.body).toEqual(
      expect.objectContaining({
        generated_at: expect.any(String),
        feature_flags: expect.any(Object),
        admin_controls: expect.objectContaining({
          default_meeting_mode: expect.any(String),
          strict_startup_validation: expect.any(Boolean),
          diagnostics_lookback_days: expect.any(Number),
          embedded_defaults: expect.any(Object),
          rollout_controls: expect.objectContaining({
            communication_history_enabled: expect.any(Boolean),
            proactive_messaging_rules_enabled: expect.any(Boolean),
            post_call_follow_up_enabled: expect.any(Boolean),
            pre_call_context_enabled: expect.any(Boolean)
          })
        }),
        startup_validation: expect.objectContaining({
          valid: expect.any(Boolean),
          issues: expect.any(Array)
        }),
        health_checks: expect.any(Array),
        support_workspace: expect.objectContaining({
          failed_launches: expect.objectContaining({
            count: expect.any(Number),
            summary: expect.any(String),
            examples: expect.any(Array)
          }),
          failed_sends: expect.any(Object),
          broken_meeting_references: expect.any(Object),
          routing_rule_problems: expect.any(Object),
          permission_failures: expect.any(Object)
        }),
        recent_events: expect.any(Array)
      })
    );
    expect(adminMicrosoftGovernanceResponse.status).toBe(200);
    expect(adminMicrosoftGovernanceResponse.body).toEqual(
      expect.objectContaining({
        generated_at: expect.any(String),
        baseline_environment: expect.any(String),
        startup_validation: expect.objectContaining({
          valid: expect.any(Boolean),
          issues: expect.any(Array)
        }),
        phase_audit_summary: expect.objectContaining({
          implementation_status: expect.any(String),
          current_state: expect.any(String),
          recommendation: expect.any(String)
        }),
        current_state_findings: expect.any(Array),
        security_gaps: expect.any(Array),
        execution_order: expect.any(Array),
        permissions_matrix: expect.any(Array),
        manual_admin_checklist: expect.any(Array),
        validation_checklist: expect.any(Array),
        rollback_principles: expect.any(Array)
      })
    );
    expect(adminMicrosoftOperatingSystemResponse.status).toBe(200);
    expect(adminMicrosoftOperatingSystemResponse.body).toEqual(
      expect.objectContaining({
        generated_at: expect.any(String),
        baseline_environment: expect.any(String),
        startup_validation: expect.objectContaining({
          valid: expect.any(Boolean),
          issues: expect.any(Array)
        }),
        phase_audit_summary: expect.objectContaining({
          implementation_status: expect.any(String),
          current_state: expect.any(String),
          recommendation: expect.any(String)
        }),
        current_state_findings: expect.any(Array),
        refactor_first: expect.any(Array),
        teams_information_architecture: expect.objectContaining({
          supported_departments: expect.any(Array),
          standard_channel_layout: expect.any(Array)
        }),
        sharepoint_information_architecture: expect.objectContaining({
          site_strategy: expect.any(String),
          hub_site_url: expect.any(String),
          libraries: expect.any(Array)
        }),
        lists_schema: expect.any(Array),
        planner_structure: expect.objectContaining({
          plan_strategy: expect.any(String),
          buckets: expect.any(Array)
        }),
        teams_tabs_and_navigation: expect.objectContaining({
          channel_defaults: expect.any(Array),
          dashboard_deep_links: expect.any(Array)
        }),
        execution_order: expect.any(Array),
        manual_admin_checklist: expect.any(Array),
        validation_checklist: expect.any(Array)
      })
    );
    expect(adminMicrosoftProvisioningResponse.status).toBe(200);
    expect(adminMicrosoftProvisioningResponse.body).toEqual(
      expect.objectContaining({
        generated_at: expect.any(String),
        baseline_environment: expect.any(String),
        startup_validation: expect.objectContaining({
          valid: expect.any(Boolean),
          issues: expect.any(Array)
        }),
        phase_audit_summary: expect.objectContaining({
          implementation_status: expect.any(String),
          current_state: expect.any(String),
          recommendation: expect.any(String)
        }),
        current_state_findings: expect.any(Array),
        refactor_first: expect.any(Array),
        canonical_entity_contract: expect.any(Array),
        sync_architecture: expect.any(Object),
        data_ownership: expect.any(Array),
        provisioning_flows: expect.any(Array),
        retry_and_reconciliation: expect.any(Object),
        execution_order: expect.any(Array),
        manual_admin_checklist: expect.any(Array),
        validation_checklist: expect.any(Array)
      })
    );
    expect(adminMicrosoftEmailAutomationResponse.status).toBe(200);
    expect(adminMicrosoftEmailAutomationResponse.body).toEqual(
      expect.objectContaining({
        generated_at: expect.any(String),
        baseline_environment: expect.any(String),
        startup_validation: expect.objectContaining({
          valid: expect.any(Boolean),
          issues: expect.any(Array)
        }),
        phase_audit_summary: expect.objectContaining({
          implementation_status: expect.any(String),
          current_state: expect.any(String),
          recommendation: expect.any(String)
        }),
        current_state_findings: expect.any(Array),
        refactor_first: expect.any(Array),
        shared_mailbox_model: expect.any(Array),
        sender_alias_rules: expect.any(Array),
        template_library: expect.any(Object),
        template_schema: expect.any(Array),
        flow_inventory: expect.any(Array),
        logging_and_monitoring: expect.any(Object),
        execution_order: expect.any(Array),
        manual_admin_checklist: expect.any(Array),
        validation_checklist: expect.any(Array),
        recent_deliveries: expect.any(Array)
      })
    );
    expect(adminMicrosoftSmsOptimizationResponse.status).toBe(200);
    expect(adminMicrosoftSmsOptimizationResponse.body).toEqual(
      expect.objectContaining({
        generated_at: expect.any(String),
        baseline_environment: expect.any(String),
        startup_validation: expect.objectContaining({
          valid: expect.any(Boolean),
          issues: expect.any(Array)
        }),
        phase_audit_summary: expect.objectContaining({
          implementation_status: expect.any(String),
          current_state: expect.any(String),
          recommendation: expect.any(String)
        }),
        current_state_findings: expect.any(Array),
        refactor_first: expect.any(Array),
        sms_policy: expect.any(Object),
        sender_profiles: expect.any(Array),
        template_schema: expect.any(Array),
        flow_inventory: expect.any(Array),
        kpi_definitions: expect.any(Array),
        sla_definitions: expect.any(Array),
        manual_admin_checklist: expect.any(Array),
        validation_checklist: expect.any(Array),
        rollback_principles: expect.any(Array),
        recent_deliveries: expect.any(Array)
      })
    );
    expect(adminMicrosoftClientIntakeResponse.status).toBe(200);
    expect(adminMicrosoftClientIntakeResponse.body).toEqual(
      expect.objectContaining({
        generated_at: expect.any(String),
        baseline_environment: expect.any(String),
        startup_validation: expect.objectContaining({
          valid: expect.any(Boolean),
          issues: expect.any(Array)
        }),
        phase_audit_summary: expect.objectContaining({
          implementation_status: expect.any(String),
          current_state: expect.any(String),
          recommendation: expect.any(String)
        }),
        current_state_findings: expect.any(Array),
        refactor_first: expect.any(Array),
        upload_architecture: expect.any(Object),
        mapping_defaults: expect.any(Object),
        matching_rules: expect.any(Array),
        notification_flows: expect.any(Object),
        exception_handling: expect.any(Object),
        active_mapping_count: expect.any(Number),
        unmatched_submission_count: expect.any(Number),
        recent_submissions: expect.any(Array)
      })
    );
    expect(adminMicrosoftClientIntakeOperationsResponse.status).toBe(200);
    expect(adminMicrosoftClientIntakeOperationsResponse.body).toEqual(
      expect.objectContaining({
        generated_at: expect.any(String),
        baseline_environment: expect.any(String),
        startup_validation: expect.objectContaining({
          valid: expect.any(Boolean),
          issues: expect.any(Array)
        }),
        phase_audit_summary: expect.objectContaining({
          implementation_status: expect.any(String),
          current_state: expect.any(String),
          recommendation: expect.any(String)
        }),
        current_state_findings: expect.any(Array),
        refactor_first: expect.any(Array),
        approval_workflow: expect.any(Object),
        escalation_rules: expect.any(Object),
        alerting_and_digests: expect.any(Object),
        exception_state_model: expect.any(Object),
        workspace: expect.objectContaining({
          summary: expect.any(Object),
          review_queue: expect.any(Array),
          overdue_items: expect.any(Array),
          escalated_items: expect.any(Array),
          backlog: expect.any(Array),
          exception_items: expect.any(Array)
        })
      })
    );
    expect(adminMicrosoftClientPortalResponse.status).toBe(200);
    expect(adminMicrosoftClientPortalResponse.body).toEqual(
      expect.objectContaining({
        generated_at: expect.any(String),
        baseline_environment: expect.any(String),
        startup_validation: expect.objectContaining({
          valid: expect.any(Boolean),
          issues: expect.any(Array)
        }),
        phase_audit_summary: expect.objectContaining({
          implementation_status: expect.any(String),
          current_state: expect.any(String),
          recommendation: expect.any(String)
        }),
        current_state_findings: expect.any(Array),
        refactor_first: expect.any(Array),
        portal_information_architecture: expect.objectContaining({
          site_strategy: expect.any(String),
          home_route: expect.any(String),
          page_map: expect.any(Array)
        }),
        authentication_model: expect.objectContaining({
          provider: expect.any(String),
          invitation_rule: expect.any(String)
        }),
        scoping_rules: expect.any(Object),
        ui_specification: expect.any(Object),
        data_integration: expect.any(Object),
        support_model: expect.any(Object),
        execution_order: expect.any(Array),
        manual_admin_checklist: expect.any(Array),
        validation_checklist: expect.any(Array),
        workspace: expect.objectContaining({
          summary: expect.any(Object),
          access_grants: expect.any(Array),
          project_links: expect.any(Array),
          project_views: expect.any(Array)
        })
      })
    );
    expect(leadershipResponse.status).toBe(403);
    expect(leadershipFoundationResponse.status).toBe(403);
    expect(leadershipCommunicationsResponse.status).toBe(403);
    expect(leadershipMicrosoftGovernanceResponse.status).toBe(403);
    expect(leadershipMicrosoftOperatingSystemResponse.status).toBe(403);
    expect(leadershipMicrosoftProvisioningResponse.status).toBe(403);
    expect(leadershipMicrosoftEmailAutomationResponse.status).toBe(403);
    expect(leadershipMicrosoftSmsOptimizationResponse.status).toBe(403);
    expect(leadershipMicrosoftClientIntakeResponse.status).toBe(403);
    expect(leadershipMicrosoftClientIntakeOperationsResponse.status).toBe(403);
    expect(leadershipMicrosoftClientPortalResponse.status).toBe(403);
    expect(deniedRepairs.status).toBe(403);
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body).toEqual(
      expect.objectContaining({
        communications: expect.objectContaining({
          enabled_features: expect.any(Array),
          startup_valid: expect.any(Boolean),
          issue_count: expect.any(Number)
        }),
        microsoft365_governance: expect.objectContaining({
          baseline_environment: expect.any(String),
          startup_valid: expect.any(Boolean),
          issue_count: expect.any(Number),
          recommendation: expect.any(String)
        }),
        microsoft365_operating_system: expect.objectContaining({
          baseline_environment: expect.any(String),
          startup_valid: expect.any(Boolean),
          issue_count: expect.any(Number),
          supported_departments: expect.any(Array),
          recommendation: expect.any(String)
        }),
        microsoft365_provisioning: expect.objectContaining({
          baseline_environment: expect.any(String),
          startup_valid: expect.any(Boolean),
          issue_count: expect.any(Number),
          supported_dashboard_entities: expect.any(Array),
          recommendation: expect.any(String)
        }),
        microsoft365_mail_automation: expect.objectContaining({
          baseline_environment: expect.any(String),
          startup_valid: expect.any(Boolean),
          issue_count: expect.any(Number),
          shared_mailbox_count: expect.any(Number),
          template_count: expect.any(Number),
          flow_count: expect.any(Number),
          recommendation: expect.any(String)
        }),
        microsoft365_sms_optimization: expect.objectContaining({
          baseline_environment: expect.any(String),
          enabled: expect.any(Boolean),
          provider: expect.any(String),
          startup_valid: expect.any(Boolean),
          issue_count: expect.any(Number),
          sender_profile_count: expect.any(Number),
          template_count: expect.any(Number),
          kpi_count: expect.any(Number),
          recommendation: expect.any(String)
        }),
        microsoft365_client_intake: expect.objectContaining({
          baseline_environment: expect.any(String),
          enabled: expect.any(Boolean),
          startup_valid: expect.any(Boolean),
          issue_count: expect.any(Number),
          matching_rule_count: expect.any(Number),
          reminder_cadence_hours: expect.anything(),
          recommendation: expect.any(String)
        }),
        microsoft365_client_intake_operations: expect.objectContaining({
          baseline_environment: expect.any(String),
          enabled: expect.any(Boolean),
          startup_valid: expect.any(Boolean),
          issue_count: expect.any(Number),
          default_review_due_hours: expect.anything(),
          daily_digest_enabled: expect.any(Boolean),
          recommendation: expect.any(String)
        }),
        microsoft365_client_portal: expect.objectContaining({
          baseline_environment: expect.any(String),
          enabled: expect.any(Boolean),
          site_url_configured: expect.any(Boolean),
          startup_valid: expect.any(Boolean),
          issue_count: expect.any(Number),
          recommendation: expect.any(String)
        })
      })
    );
  });

  it("keeps denied communication history reads pure instead of recording diagnostics side effects", async () => {
    const published = await createPublishedSportsJob();
    const jobId = published.job.id as string;

    const diagnosticsBefore = await request(app)
      .get("/api/admin/system/communications")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(diagnosticsBefore.status).toBe(200);

    const deniedHistory = await request(app)
      .get(`/api/communications/records/job/${jobId}/history`)
      .set("Authorization", `Bearer ${associateToken}`);

    expect(deniedHistory.status).toBe(403);

    const diagnosticsResponse = await request(app)
      .get("/api/admin/system/communications")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(diagnosticsResponse.status).toBe(200);
    expect(diagnosticsResponse.body.support_workspace.failed_launches.count).toBe(
      diagnosticsBefore.body.support_workspace.failed_launches.count
    );
    expect(diagnosticsResponse.body.support_workspace.permission_failures.count).toBe(
      diagnosticsBefore.body.support_workspace.permission_failures.count
    );
  });

  it("detects missing production items, previews repairs without mutating, and executes repairs with audit coverage", async () => {
    const published = await createPublishedSportsJob();
    const jobId = published.job.id as string;

    await dbPool.query(`DELETE FROM production_items WHERE tenant_id = $1 AND job_id = $2::uuid`, [demoTenantId, jobId]);

    const runResponse = await request(app)
      .post("/api/admin/system/diagnostics/run")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        rule_key: "workflow_gap.missing_production_item",
        resource_type: "job",
        resource_id: jobId,
        trigger_type: "manual"
      });

    expect(runResponse.status).toBe(201);
    expect(runResponse.body.runs[0].run.rule_key).toBe("workflow_gap.missing_production_item");

    const findingsResponse = await request(app)
      .get("/api/admin/system/diagnostics/findings")
      .query({
        rule_key: "workflow_gap.missing_production_item",
        resource_type: "job"
      })
      .set("Authorization", `Bearer ${adminToken}`);

    expect(findingsResponse.status).toBe(200);
    expect(findingsResponse.body.some((finding: { resource_id: string; title: string }) => finding.resource_id === jobId && finding.title.includes("missing"))).toBe(true);

    const previewResponse = await request(app)
      .post("/api/admin/system/repairs/preview")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        action_key: "job.regenerate_default_production_item",
        resource_type: "job",
        resource_id: jobId,
        reason: "Repair preview for diagnostics coverage"
      });

    expect(previewResponse.status).toBe(201);
    expect(previewResponse.body.repair_action.status).toBe("dry_run_complete");
    expect(previewResponse.body.preview_summary.changes.length).toBeGreaterThan(0);

    const countAfterPreview = await dbPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM production_items WHERE tenant_id = $1 AND job_id = $2::uuid`,
      [demoTenantId, jobId]
    );
    expect(Number(countAfterPreview.rows[0]?.count ?? "0")).toBe(0);

    const executeResponse = await request(app)
      .post("/api/admin/system/repairs/execute")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        action_key: "job.regenerate_default_production_item",
        resource_type: "job",
        resource_id: jobId,
        reason: "Repair execution for diagnostics coverage"
      });

    expect(executeResponse.status).toBe(201);
    expect(executeResponse.body.repair_action.status).toBe("completed");
    expect(executeResponse.body.repair_action.after_snapshot_json).toBeTruthy();

    const countAfterExecute = await dbPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM production_items WHERE tenant_id = $1 AND job_id = $2::uuid`,
      [demoTenantId, jobId]
    );
    expect(Number(countAfterExecute.rows[0]?.count ?? "0")).toBe(1);

    const productionRow = await dbPool.query<{
      production_template_key: string | null;
      completion_rule_key: string | null;
      created_from_source: string;
      linked_shoot_count: string;
      expected_linked_shoot_count: string;
      deliverable_count: string;
    }>(
      `
        SELECT
          item.production_template_key,
          item.completion_rule_key,
          item.created_from_source,
          (
            SELECT count(*)::text
            FROM production_item_shoot_links link
            WHERE link.tenant_id = item.tenant_id
              AND link.production_item_id = item.id
          ) AS linked_shoot_count,
          (
            SELECT CASE
              WHEN count(*) > 0 THEN count(*)::text
              WHEN job.legacy_shoot_id IS NOT NULL THEN '1'
              ELSE '0'
            END
            FROM job_shoot_links job_link
            WHERE job_link.tenant_id = item.tenant_id
              AND job_link.job_id = item.job_id
          ) AS expected_linked_shoot_count,
          (
            SELECT count(*)::text
            FROM deliverable_items deliverable
            WHERE deliverable.tenant_id = item.tenant_id
              AND deliverable.production_item_id = item.id
          ) AS deliverable_count
        FROM production_items item
        JOIN jobs job
          ON job.id = item.job_id
         AND job.tenant_id = item.tenant_id
        WHERE item.tenant_id = $1
          AND item.job_id = $2::uuid
        LIMIT 1
      `,
      [demoTenantId, jobId]
    );
    expect(productionRow.rows[0]?.production_template_key).toBeTruthy();
    expect(productionRow.rows[0]?.completion_rule_key).toBeTruthy();
    expect(productionRow.rows[0]?.created_from_source).toBe("repair");
    expect(Number(productionRow.rows[0]?.linked_shoot_count ?? "0")).toBe(
      Number(productionRow.rows[0]?.expected_linked_shoot_count ?? "0")
    );
    expect(Number(productionRow.rows[0]?.deliverable_count ?? "0")).toBeGreaterThan(0);

    const repairAuditRows = await dbPool.query<{ event_type: string }>(
      `
        SELECT event_type
        FROM audit_events
        WHERE tenant_id = $1
          AND resource_type = 'job'
          AND resource_id = $2
          AND event_type IN ('repair_preview_created', 'repair_action_completed')
        ORDER BY created_at DESC
      `,
      [demoTenantId, jobId]
    );
    const auditEvents = repairAuditRows.rows.map((row) => row.event_type);
    expect(auditEvents).toContain("repair_preview_created");
    expect(auditEvents).toContain("repair_action_completed");
  });

  it("detects status drift and orphaned watch flags, then exposes both through the shared findings queue and trace view", async () => {
    const published = await createPublishedSportsJob();
    const jobId = published.job.id as string;

    const readinessItemRow = await dbPool.query<{ id: string }>(
      `
        SELECT id::text
        FROM job_readiness_items
        WHERE tenant_id = $1
          AND job_id = $2::uuid
        ORDER BY sort_order ASC, created_at ASC
        LIMIT 1
      `,
      [demoTenantId, jobId]
    );
    expect(readinessItemRow.rows[0]?.id).toBeTruthy();

    await dbPool.query(
      `
        UPDATE job_readiness_items
        SET
          is_required = true,
          is_blocker = true,
          is_complete = false,
          completed_at = NULL,
          completed_by_user_id = NULL,
          notes = 'Diagnostics test blocker'
        WHERE tenant_id = $1
          AND id = $2::uuid
      `,
      [demoTenantId, readinessItemRow.rows[0].id]
    );
    await dbPool.query(
      `
        UPDATE jobs
        SET readiness_status = 'ready'::job_readiness_status_type
        WHERE tenant_id = $1
          AND id = $2::uuid
      `,
      [demoTenantId, jobId]
    );

    const fakeSourceId = randomUUID();
    const watchFlagInsert = await dbPool.query<{ id: string }>(
      `
        INSERT INTO job_watch_flags (
          tenant_id,
          job_id,
          severity,
          flag_type,
          title,
          description,
          status,
          owner_user_id,
          source_entity_type,
          source_entity_id,
          created_by_user_id,
          updated_at
        )
        VALUES (
          $1,
          $2::uuid,
          'medium'::job_watch_flag_severity_type,
          'sync_error',
          'Broken source reference',
          'Diagnostics test flag referencing a missing production item.',
          'open'::job_watch_flag_status_type,
          $3::uuid,
          'production_item',
          $4::uuid,
          $3::uuid,
          now()
        )
        RETURNING id::text
      `,
      [demoTenantId, jobId, adminUserId, fakeSourceId]
    );
    const watchFlagId = watchFlagInsert.rows[0]?.id;
    expect(watchFlagId).toBeTruthy();

    const driftRun = await request(app)
      .post("/api/admin/system/diagnostics/run")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        rule_key: "status_drift.ready_with_open_blockers",
        resource_type: "job",
        resource_id: jobId
      });
    expect(driftRun.status).toBe(201);

    const orphanRun = await request(app)
      .post("/api/admin/system/diagnostics/run")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        rule_key: "data_integrity.watch_flag_missing_source",
        resource_type: "job",
        resource_id: jobId
      });
    expect(orphanRun.status).toBe(201);

    const findingsResponse = await request(app)
      .get("/api/admin/system/diagnostics/findings")
      .query({ resource_type: "job", limit: 200 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(findingsResponse.status).toBe(200);
    expect(findingsResponse.body.some((finding: { rule_key: string; resource_id: string }) => finding.rule_key === "status_drift.ready_with_open_blockers" && finding.resource_id === jobId)).toBe(true);

    const orphanFindingResponse = await request(app)
      .get("/api/admin/system/diagnostics/findings")
      .query({ rule_key: "data_integrity.watch_flag_missing_source", resource_type: "job_watch_flag" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(orphanFindingResponse.status).toBe(200);
    expect(orphanFindingResponse.body.some((finding: { resource_id: string }) => finding.resource_id === watchFlagId)).toBe(true);

    const traceResponse = await request(app)
      .get(`/api/admin/system/trace/job/${jobId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(traceResponse.status).toBe(200);
    const timelineKinds = traceResponse.body.timeline.map((item: { kind: string }) => item.kind);
    expect(timelineKinds).toContain("activity");
    expect(timelineKinds).toContain("audit");
    expect(timelineKinds).toContain("finding");
  });

  it("captures policy traces and exposes sync, import, and export audit records through shared admin routes", async () => {
    const accessPreview = await request(app)
      .post("/api/admin/system/access-debug/preview")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        target_user_id: associateUserId,
        route_id: "dashboard",
        resource_type: "shared_job",
        permission_keys: ["job.read", "watchlist.read"],
        context: {
          departmentType: "sports",
          targetUserId: associateUserId
        }
      });

    expect(accessPreview.status).toBe(200);
    expect(accessPreview.body.trace_id).toBeTruthy();
    expect(Array.isArray(accessPreview.body.explanation)).toBe(true);

    const traceList = await request(app)
      .get("/api/admin/system/access-debug/traces")
      .query({ actor_user_id: adminUserId, limit: 20 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(traceList.status).toBe(200);
    expect(traceList.body.some((trace: { id: string }) => trace.id === accessPreview.body.trace_id)).toBe(true);

    await dbPool.query(
      `
        INSERT INTO sync_health_records (
          tenant_id,
          sync_key,
          status,
          last_success_at,
          last_failure_at,
          failure_count,
          last_error_code,
          last_error_message,
          metadata_json
        )
        VALUES ($1,'alerts_delivery','error',now() - interval '2 days',now(),3,'SMTP_FAIL','Alert delivery queue is backing up.',$2::jsonb)
        ON CONFLICT DO NOTHING
      `,
      [demoTenantId, JSON.stringify({ subsystem: "alerts" })]
    );

    await dbPool.query(
      `
        INSERT INTO system_health_checks (
          tenant_id,
          check_key,
          scope_type,
          scope_value,
          status,
          summary,
          details_json,
          checked_at
        )
        VALUES ($1,'job_integrity','tenant',NULL,'critical','Published jobs are missing required downstream records.',$2::jsonb,now())
      `,
      [demoTenantId, JSON.stringify({ critical_jobs: 1 })]
    );

    await dbPool.query(
      `
        INSERT INTO import_audit_records (
          tenant_id,
          import_type,
          started_by_user_id,
          status,
          source_reference,
          row_count_total,
          row_count_created,
          row_count_updated,
          row_count_rejected,
          errors_json,
          completed_at
        )
        VALUES ($1,'roster_csv',$2::uuid,'completed','diag-import.csv',120,100,15,5,$3::jsonb,now())
      `,
      [demoTenantId, adminUserId, JSON.stringify([{ row: 19, error: "Missing grade" }])]
    );

    await dbPool.query(
      `
        INSERT INTO export_audit_records (
          tenant_id,
          export_type,
          requested_by_user_id,
          status,
          scope_summary_json,
          row_count,
          column_keys_json,
          file_reference,
          completed_at
        )
        VALUES ($1,'jobs_csv',$2::uuid,'completed',$3::jsonb,42,$4::jsonb,'exports/jobs-diagnostics.csv',now())
      `,
      [demoTenantId, adminUserId, JSON.stringify({ department: "sports" }), JSON.stringify(["job_number", "organization_name", "job_status"])]
    );

    const syncResponse = await request(app)
      .get("/api/admin/system/sync")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(syncResponse.status).toBe(200);
    expect(syncResponse.body.sync_health.some((record: { sync_key: string; status: string }) => record.sync_key === "alerts_delivery" && record.status === "error")).toBe(true);
    expect(syncResponse.body.health_checks.some((check: { check_key: string; status: string }) => check.check_key === "job_integrity" && check.status === "critical")).toBe(true);

    const importResponse = await request(app)
      .get("/api/admin/system/imports")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(importResponse.status).toBe(200);
    expect(importResponse.body.some((record: { import_type: string; row_count_rejected: number }) => record.import_type === "roster_csv" && record.row_count_rejected === 5)).toBe(true);

    const exportResponse = await request(app)
      .get("/api/admin/system/exports")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.body.some((record: { export_type: string; row_count: number; column_keys_json: string[] }) => record.export_type === "jobs_csv" && record.row_count === 42 && record.column_keys_json.includes("job_number"))).toBe(true);
  });
});
