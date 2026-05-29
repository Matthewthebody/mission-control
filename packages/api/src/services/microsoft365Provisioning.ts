import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { z } from "zod";
import { hasAuthorityTier } from "../authz/authority.js";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  Microsoft365CanonicalEntityContract,
  Microsoft365DashboardEntityType,
  Microsoft365LinkSyncStatus,
  Microsoft365ProvisioningArtifact,
  Microsoft365ProvisioningBaseline,
  Microsoft365ProvisioningCurrentStateFinding,
  Microsoft365ProvisioningDiagnosticsResponse,
  Microsoft365ProvisioningDocReference,
  Microsoft365ProvisioningEnvironment,
  Microsoft365ProvisioningFlowDefinition,
  Microsoft365ProvisioningGoNoGo,
  Microsoft365ProvisioningLinkRecord,
  Microsoft365ProvisioningPlan,
  Microsoft365ProvisioningRefactorItem,
  Microsoft365ProvisioningValidationIssue,
  QueueMicrosoft365ProvisioningInput,
  UpsertMicrosoft365ProvisioningLinkInput
} from "../types/microsoft365Provisioning.js";
import { resolveApiRepoPath } from "../utils/repoPaths.js";
import { createAuditLog } from "./audit.js";
import {
  markIntegrationSyncOperationSucceeded,
  queueIntegrationSyncOperation,
  type IntegrationProvider
} from "./integrationSync.js";
import { getMicrosoft365GovernanceValidationIssues } from "./microsoft365Governance.js";
import { getMicrosoft365OperatingSystemValidationIssues } from "./microsoft365OperatingSystem.js";
import { getMicrosoftIntegrationFeatureFlags } from "./microsoftIntegrationObservability.js";

const provisioningEnvironmentSchema = z.enum(["development", "staging", "production"]);
const dashboardEntityTypeSchema = z.enum([
  "organization",
  "job",
  "job_readiness_item",
  "post_shoot_evaluation",
  "work_task",
  "communication_event"
]);
const objectTypeSchema = z.enum([
  "team",
  "channel",
  "sharepoint_site",
  "sharepoint_library",
  "sharepoint_folder",
  "microsoft_list",
  "microsoft_list_item",
  "planner_plan",
  "planner_bucket",
  "planner_task",
  "shared_mailbox"
]);
const linkStatusSchema = z.enum(["pending", "linked", "failed", "drifted", "archived"]);

const baselineSchema = z.object({
  phase: z.literal("phase3_dashboard_integration_contract_and_provisioning"),
  baseline_version: z.string().trim().min(1),
  environment: provisioningEnvironmentSchema,
  tenant_tier: z.enum(["sandbox", "preproduction", "production"]),
  sync_architecture: z.object({
    provider: z.literal("microsoft365_workspace"),
    outbound_queue: z.string().trim().min(1),
    sync_mode: z.string().trim().min(1),
    idempotency_rule: z.string().trim().min(1),
    retry_rule: z.string().trim().min(1),
    reconciliation_rule: z.string().trim().min(1),
    failure_queue_rule: z.string().trim().min(1)
  }),
  canonical_entities: z.array(
    z.object({
      entity_family: z.enum(["client", "project", "required_item", "submission", "task", "communication_event"]),
      dashboard_entity_type: dashboardEntityTypeSchema,
      canonical_id_prefix: z.string().trim().min(1),
      canonical_id_pattern: z.string().trim().min(1),
      dashboard_route_hash: z.string().trim().min(1).nullable(),
      source_of_truth_rule: z.string().trim().min(1),
      mirror_scope_rule: z.string().trim().min(1),
      microsoft_targets: z.array(objectTypeSchema).min(1),
      notes: z.string().trim().min(1).nullable().optional()
    })
  ).min(1),
  field_mappings: z.array(
    z.object({
      entity_family: z.enum(["client", "project", "required_item", "submission", "task", "communication_event"]),
      microsoft_target: objectTypeSchema,
      container_name: z.string().trim().min(1),
      fields: z.array(
        z.object({
          dashboard_field: z.string().trim().min(1),
          microsoft_field: z.string().trim().min(1),
          owner: z.enum(["dashboard", "microsoft_read_only_mirror", "microsoft_computed"]),
          sync_behavior: z.enum(["mirror_on_change", "backlink_only", "manual_reference"]),
          notes: z.string().trim().min(1)
        })
      ).min(1)
    })
  ).min(1),
  provisioning_flows: z.array(
    z.object({
      key: z.string().trim().min(1),
      dashboard_entity_type: dashboardEntityTypeSchema,
      operation_type: z.string().trim().min(1),
      source_trigger: z.string().trim().min(1),
      target_objects: z.array(
        z.object({
          microsoft_object_type: objectTypeSchema,
          logical_name: z.string().trim().min(1),
          naming_pattern: z.string().trim().min(1),
          backlink_field: z.string().trim().min(1).nullable(),
          microsoft_url_field: z.string().trim().min(1).nullable(),
          notes: z.string().trim().min(1)
        })
      ).min(1),
      notes: z.string().trim().min(1)
    })
  ).min(1),
  retry_and_reconciliation: z.object({
    queue_of_record: z.string().trim().min(1),
    replay_entrypoint: z.string().trim().min(1),
    reconciliation_jobs: z.array(z.string().trim().min(1)).min(1),
    failure_states: z.array(z.string().trim().min(1)).min(1),
    operator_recovery: z.array(z.string().trim().min(1)).min(1)
  }),
  execution_order: z.array(
    z.object({
      order: z.number().int().positive(),
      title: z.string().trim().min(1),
      owner: z.string().trim().min(1),
      requires_tenant_admin: z.boolean(),
      rollback: z.string().trim().min(1)
    })
  ).min(1),
  manual_admin_checklist: z.array(
    z.object({
      order: z.number().int().positive(),
      step: z.string().trim().min(1),
      portal: z.string().trim().min(1).nullable(),
      requires_tenant_admin: z.boolean(),
      owner: z.string().trim().min(1)
    })
  ).min(1),
  validation_checklist: z.array(z.string().trim().min(1)).min(1),
  rollback_principles: z.array(z.string().trim().min(1)).min(1)
});

const DOCS: Microsoft365ProvisioningDocReference[] = [
  {
    key: "phase_summary",
    title: "Phase 3 Dashboard Integration Contract and Provisioning",
    path: "docs/microsoft365/phase3-dashboard-integration-contract-and-provisioning.md",
    summary: "Primary phase audit, canonical entity contract, data ownership, provisioning flows, and next-phase recommendation."
  },
  {
    key: "field_mapping_contract",
    title: "Microsoft Dashboard Field Mapping Contract",
    path: "docs/microsoft365/microsoft-dashboard-field-mapping-contract.md",
    summary: "Explicit dashboard-to-Microsoft field ownership, mirror rules, and backlink strategy."
  }
];

const ARTIFACTS: Microsoft365ProvisioningArtifact[] = [
  {
    kind: "baseline",
    path: "ops/microsoft365/phase3/integration-contract-baseline.development.json",
    summary: "Development/sandbox Phase 3 contract and provisioning baseline.",
    tenant_admin_action: false
  },
  {
    kind: "baseline",
    path: "ops/microsoft365/phase3/integration-contract-baseline.staging.json",
    summary: "Staging/pilot Phase 3 contract and provisioning baseline.",
    tenant_admin_action: false
  },
  {
    kind: "baseline",
    path: "ops/microsoft365/phase3/integration-contract-baseline.production.json",
    summary: "Production Phase 3 contract and provisioning baseline.",
    tenant_admin_action: false
  },
  {
    kind: "script",
    path: "ops/microsoft365/phase3/Test-M365DashboardIntegrationBaseline.ps1",
    summary: "Non-destructive validation script for Phase 3 contract, provisioning assumptions, and environment alignment.",
    tenant_admin_action: true
  },
  {
    kind: "script",
    path: "ops/microsoft365/phase3/Get-M365ProvisioningPlan.ps1",
    summary: "Renders the exact Phase 3 provisioning plan for a canonical dashboard entity family.",
    tenant_admin_action: false
  },
  {
    kind: "api",
    path: "GET /api/admin/system/microsoft-provisioning",
    summary: "Admin diagnostics payload for the Phase 3 integration contract and provisioning baseline.",
    tenant_admin_action: false
  }
];

type DashboardContext = {
  label: string | null;
  jobId: string | null;
};

function resolveEnvironment(): Microsoft365ProvisioningEnvironment {
  if (config.MICROSOFT_365_DASHBOARD_INTEGRATION_ENV) {
    return config.MICROSOFT_365_DASHBOARD_INTEGRATION_ENV;
  }
  if (config.NODE_ENV === "production") {
    return "production";
  }
  return "development";
}

function getBaselinePath(environment: Microsoft365ProvisioningEnvironment) {
  return resolveApiRepoPath("ops", "microsoft365", "phase3", `integration-contract-baseline.${environment}.json`);
}

function loadBaseline(environment = resolveEnvironment()): Microsoft365ProvisioningBaseline {
  const raw = readFileSync(getBaselinePath(environment), "utf8");
  const parsed = baselineSchema.parse(JSON.parse(raw));
  if (parsed.environment !== environment) {
    throw new Error(
      `Microsoft 365 dashboard integration baseline environment mismatch: expected ${environment}, found ${parsed.environment}.`
    );
  }
  return parsed;
}

function addIssue(issues: Microsoft365ProvisioningValidationIssue[], issue: Microsoft365ProvisioningValidationIssue) {
  issues.push(issue);
}

function buildCurrentStateFindings(): Microsoft365ProvisioningCurrentStateFinding[] {
  return [
    {
      key: "generic_sync_queue_exists",
      state: "existing",
      summary:
        "The repo already has a reusable integration sync queue and replay path through integration_sync_operation, so Phase 3 can reuse one retry/failure substrate instead of creating a second queue.",
      evidence: [
        "packages/api/src/services/integrationSync.ts",
        "db/migrations/019_approval_sync_controls.sql",
        "packages/worker/src/handlers/appEventHandler.ts"
      ]
    },
    {
      key: "external_object_mapping_exists",
      state: "existing",
      summary:
        "A generic external_object_map table already exists and is used in Monday integrations, which gives Phase 3 a proven traceability pattern for external ids and payload metadata.",
      evidence: [
        "db/migrations/003_phase_one_tables.sql",
        "packages/api/src/services/schoolsHubMonday.ts"
      ]
    },
    {
      key: "microsoft_runtime_foundations",
      state: "existing",
      summary:
        "Entra auth, Teams messaging/meetings, Outlook sync, and Microsoft diagnostics already exist, so Phase 3 can sit on real Microsoft seams rather than a greenfield integration stack.",
      evidence: [
        "packages/api/src/services/microsoftEntra.ts",
        "packages/api/src/services/teamsMessaging.ts",
        "packages/api/src/services/teamsMeetings.ts",
        "packages/api/src/services/microsoftIntegrationObservability.ts"
      ]
    },
    {
      key: "record_resource_provider_alignment",
      state: "partial",
      summary:
        "Record resources already recognize SharePoint and OneDrive providers, but there was no governed provisioning contract that explains how dashboard records earn, retain, and reconcile those Microsoft links.",
      evidence: [
        "packages/api/src/services/recordResources.ts",
        "packages/api/src/routes/recordResources.ts"
      ],
      recommended_refactor:
        "Keep Microsoft document links aligned to the record-resources provider model instead of inventing a competing document-link abstraction."
    },
    {
      key: "workspace_link_contract_missing",
      state: "missing",
      summary:
        "Before this phase there was no durable Microsoft workspace link table that stored canonical dashboard ids, dashboard URLs, Microsoft URLs, last sync status, and sync-operation traceability.",
      evidence: ["db/migrations/003_phase_one_tables.sql", "db/migrations/019_approval_sync_controls.sql"]
    },
    {
      key: "submission_model_is_not_yet_platform_wide",
      state: "conflict",
      summary:
        "The dashboard has concrete submission-like records, but it does not yet have one universal submission aggregate. Phase 3 therefore treats post-shoot evaluations as the initial concrete submission family.",
      evidence: [
        "packages/api/src/services/postShootEvaluations.ts",
        "packages/api/src/services/clientOperationsCoreContracts.ts"
      ],
      recommended_refactor:
        "If the business introduces broader client upload/submission workflows later, add them as a canonical submission family instead of overloading post-shoot evaluations."
    }
  ];
}

function buildRefactorFirst(): Microsoft365ProvisioningRefactorItem[] {
  return [
    {
      key: "replay_is_currently_outlook_only",
      severity: "high",
      summary: "The generic integration replay path was restricted to Outlook-backed operations before this phase.",
      consequence: "Microsoft workspace provisioning failures would be harder to recover without a provider-aware replay extension."
    },
    {
      key: "canonical_entity_ids_are_not_centralized",
      severity: "high",
      summary: "Canonical external ids for organization/job/task/readiness/submission mirrors were not centralized in one service contract.",
      consequence: "Different Microsoft surfaces would risk generating divergent ids and breaking idempotency."
    },
    {
      key: "dashboard_backlinks_were_inconsistent",
      severity: "medium",
      summary: "Some Microsoft-facing features already stored app deep links, but there was no shared backlink contract for Lists, SharePoint, Planner, and mailbox-linked artifacts.",
      consequence: "Operators would struggle to trace Microsoft artifacts back to the authoritative dashboard record."
    }
  ];
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function replaceRouteTokens(routeHash: string | null, input: { dashboardEntityId: string; jobId?: string | null }) {
  if (!routeHash) {
    return null;
  }
  return routeHash
    .replaceAll("{dashboard_entity_id}", input.dashboardEntityId)
    .replaceAll("{job_id}", input.jobId ?? "");
}

function buildDashboardUrl(routeHash: string | null, input: { dashboardEntityId: string; jobId?: string | null }) {
  if (!config.ADMIN_WEB_URL) {
    return null;
  }
  const normalizedBase = config.ADMIN_WEB_URL.replace(/\/$/, "");
  const route = replaceRouteTokens(routeHash, input);
  if (!route) {
    return null;
  }
  return `${normalizedBase}/${route.startsWith("#") ? "" : "#"}${route}`;
}

export function buildMicrosoft365CanonicalDashboardId(entityType: Microsoft365DashboardEntityType, entityId: string) {
  const baseline = loadBaseline(resolveEnvironment());
  const contract = baseline.canonical_entities.find((item) => item.dashboard_entity_type === entityType);
  if (!contract) {
    throw new Error(`Unsupported Microsoft 365 dashboard entity type: ${entityType}`);
  }
  return contract.canonical_id_pattern.replaceAll("{dashboard_entity_id}", entityId);
}

async function resolveDashboardContext(
  client: PoolClient,
  tenantId: string,
  entityType: Microsoft365DashboardEntityType,
  entityId: string
): Promise<DashboardContext> {
  if (entityType === "organization") {
    const { rows } = await client.query<{ display_name: string }>(
      `
        SELECT display_name
        FROM organization
        WHERE tenant_id = $1
          AND id = $2::uuid
        LIMIT 1
      `,
      [tenantId, entityId]
    );
    if (!rows[0]) {
      throw new ApiError(404, "Organization not found");
    }
    return { label: rows[0].display_name, jobId: null };
  }

  if (entityType === "job") {
    const { rows } = await client.query<{ title: string; job_number: string | null }>(
      `
        SELECT title, job_number
        FROM jobs
        WHERE tenant_id = $1
          AND id = $2::uuid
        LIMIT 1
      `,
      [tenantId, entityId]
    );
    if (!rows[0]) {
      throw new ApiError(404, "Job not found");
    }
    return { label: rows[0].job_number ? `${rows[0].job_number} ${rows[0].title}` : rows[0].title, jobId: entityId };
  }

  if (entityType === "job_readiness_item") {
    const { rows } = await client.query<{ label: string; job_id: string }>(
      `
        SELECT label, job_id::text AS job_id
        FROM job_readiness_items
        WHERE tenant_id = $1
          AND id = $2::uuid
        LIMIT 1
      `,
      [tenantId, entityId]
    );
    if (!rows[0]) {
      throw new ApiError(404, "Job readiness item not found");
    }
    return { label: rows[0].label, jobId: rows[0].job_id };
  }

  if (entityType === "post_shoot_evaluation") {
    const { rows } = await client.query<{ shoot_id: string | null }>(
      `
        SELECT shoot_id::text AS shoot_id
        FROM post_shoot_evaluation
        WHERE tenant_id = $1
          AND id = $2::uuid
        LIMIT 1
      `,
      [tenantId, entityId]
    );
    if (!rows[0]) {
      throw new ApiError(404, "Post-shoot evaluation not found");
    }
    return { label: "Post-shoot evaluation submission", jobId: null };
  }

  if (entityType === "work_task") {
    const { rows } = await client.query<{ title: string; related_job_id: string | null }>(
      `
        SELECT
          title,
          related_job_id::text AS related_job_id
        FROM work_task
        WHERE tenant_id = $1
          AND id = $2::uuid
        LIMIT 1
      `,
      [tenantId, entityId]
    );
    if (!rows[0]) {
      throw new ApiError(404, "Task not found");
    }
    return { label: rows[0].title, jobId: rows[0].related_job_id };
  }

  return { label: "Communication event", jobId: null };
}

function determineRecommendation(issues: Microsoft365ProvisioningValidationIssue[]): Microsoft365ProvisioningGoNoGo {
  if (issues.some((issue) => issue.severity === "error")) {
    return "no_go";
  }
  if (issues.length > 0) {
    return "conditional_go";
  }
  return "go";
}

function findCanonicalEntityContract(
  baseline: Microsoft365ProvisioningBaseline,
  entityType: Microsoft365DashboardEntityType
): Microsoft365CanonicalEntityContract {
  const contract = baseline.canonical_entities.find((item) => item.dashboard_entity_type === entityType);
  if (!contract) {
    throw new ApiError(400, `Unsupported provisioning entity type: ${entityType}`);
  }
  return contract;
}

function findProvisioningFlow(
  baseline: Microsoft365ProvisioningBaseline,
  entityType: Microsoft365DashboardEntityType
): Microsoft365ProvisioningFlowDefinition {
  const flow = baseline.provisioning_flows.find((item) => item.dashboard_entity_type === entityType);
  if (!flow) {
    throw new ApiError(400, `No provisioning flow is defined for ${entityType}`);
  }
  return flow;
}

export function getMicrosoft365ProvisioningValidationIssues(): Microsoft365ProvisioningValidationIssue[] {
  const issues: Microsoft365ProvisioningValidationIssue[] = [];
  const environment = resolveEnvironment();
  let baseline: Microsoft365ProvisioningBaseline | null = null;

  try {
    baseline = loadBaseline(environment);
  } catch (error) {
    addIssue(issues, {
      area: "baseline",
      severity: "error",
      code: "baseline.file_invalid",
      summary: "The Phase 3 Microsoft dashboard integration baseline file is missing or invalid for the active environment.",
      details: {
        environment,
        path: getBaselinePath(environment),
        error: error instanceof Error ? error.message : "Unknown baseline load failure"
      }
    });
    return issues;
  }

  const governanceErrors = getMicrosoft365GovernanceValidationIssues().filter((issue) => issue.severity === "error");
  if (governanceErrors.length > 0) {
    addIssue(issues, {
      area: "phase1_prerequisite",
      severity: environment === "production" ? "error" : "warning",
      code: "phase1_prerequisite.governance_not_ready",
      summary:
        "Phase 1 Microsoft 365 governance still has blocking issues. Provisioning and mirror contracts should not roll out on top of an ungoverned tenant baseline.",
      details: {
        issue_codes: governanceErrors.map((issue) => issue.code)
      }
    });
  }

  const operatingSystemErrors = getMicrosoft365OperatingSystemValidationIssues().filter((issue) => issue.severity === "error");
  if (operatingSystemErrors.length > 0) {
    addIssue(issues, {
      area: "phase2_prerequisite",
      severity: environment === "production" ? "error" : "warning",
      code: "phase2_prerequisite.operating_system_not_ready",
      summary:
        "Phase 2 Microsoft operating system validation still has blocking issues. Phase 3 provisioning should not proceed until the internal workspace topology is stable.",
      details: {
        issue_codes: operatingSystemErrors.map((issue) => issue.code)
      }
    });
  }

  if (!config.ADMIN_WEB_URL) {
    addIssue(issues, {
      area: "backlinks",
      severity: "error",
      code: "backlinks.admin_web_url.missing",
      summary: "ADMIN_WEB_URL is required to build durable dashboard backlinks into Microsoft mirrors."
    });
  }

  if (!config.API_PUBLIC_URL) {
    addIssue(issues, {
      area: "sync_entrypoints",
      severity: environment === "production" ? "error" : "warning",
      code: "sync_entrypoints.api_public_url.missing",
      summary: "API_PUBLIC_URL should be configured so future webhook and reconciliation entrypoints use one stable base URL."
    });
  }

  if (
    config.MICROSOFT_365_DASHBOARD_INTEGRATION_ENV &&
    config.NODE_ENV === "production" &&
    config.MICROSOFT_365_DASHBOARD_INTEGRATION_ENV !== "production"
  ) {
    addIssue(issues, {
      area: "baseline",
      severity: "error",
      code: "baseline.environment_mismatch",
      summary: "Production runtime must not point at a non-production Phase 3 dashboard integration baseline.",
      details: {
        configured_environment: config.MICROSOFT_365_DASHBOARD_INTEGRATION_ENV
      }
    });
  }

  const microsoftFlags = getMicrosoftIntegrationFeatureFlags();
  if (!microsoftFlags.auth_enabled) {
    addIssue(issues, {
      area: "identity",
      severity: environment === "production" ? "error" : "warning",
      code: "identity.entra_auth.disabled",
      summary: "Microsoft Entra auth is not enabled. Phase 3 assumes Microsoft-linked identities for governed provisioning ownership."
    });
  }

  if (baseline.sync_architecture.provider !== "microsoft365_workspace") {
    addIssue(issues, {
      area: "sync_architecture",
      severity: "error",
      code: "sync_architecture.provider.invalid",
      summary: "The version-controlled Phase 3 baseline must use microsoft365_workspace as the canonical provider key."
    });
  }

  return issues;
}

export function assertMicrosoft365ProvisioningStartupConfig() {
  const issues = getMicrosoft365ProvisioningValidationIssues();
  const errors = issues.filter((issue) => issue.severity === "error");
  if ((config.MICROSOFT_365_DASHBOARD_INTEGRATION_STRICT_VALIDATION || config.NODE_ENV === "production") && errors.length > 0) {
    throw new Error(
      `Microsoft 365 dashboard integration startup validation failed: ${errors.map((issue) => `${issue.area}:${issue.code}`).join(", ")}`
    );
  }
}

export function getPublicMicrosoft365ProvisioningHealthSummary() {
  const issues = getMicrosoft365ProvisioningValidationIssues();
  const baselineEnvironment = resolveEnvironment();
  const recommendation = determineRecommendation(issues);
  let supportedEntities: Microsoft365DashboardEntityType[] = [];

  try {
    supportedEntities = loadBaseline(baselineEnvironment).canonical_entities.map((item) => item.dashboard_entity_type);
  } catch {
    supportedEntities = [];
  }

  return {
    baseline_environment: baselineEnvironment,
    startup_valid: issues.every((issue) => issue.severity !== "error"),
    issue_count: issues.length,
    supported_dashboard_entities: supportedEntities,
    recommendation
  };
}

export function getMicrosoft365ProvisioningDiagnostics(): Microsoft365ProvisioningDiagnosticsResponse {
  const baselineEnvironment = resolveEnvironment();
  const baseline = loadBaseline(baselineEnvironment);
  const issues = getMicrosoft365ProvisioningValidationIssues();
  const recommendation = determineRecommendation(issues);

  return {
    generated_at: new Date().toISOString(),
    baseline_environment: baselineEnvironment,
    startup_validation: {
      valid: issues.every((issue) => issue.severity !== "error"),
      issues
    },
    phase_audit_summary: {
      implementation_status: "implemented_as_queue_backed_contract_and_provisioning_scaffold",
      current_state:
        "The dashboard already had generic sync queueing, external-object mapping, Microsoft diagnostics, and record-level deep links, but it did not yet have one canonical Microsoft provisioning contract, one backlink table, or one reusable provisioning scaffold for dashboard-owned mirrors.",
      recommendation
    },
    current_state_findings: buildCurrentStateFindings(),
    refactor_first: buildRefactorFirst(),
    canonical_entity_contract: baseline.canonical_entities,
    sync_architecture: baseline.sync_architecture,
    data_ownership: baseline.field_mappings,
    provisioning_flows: baseline.provisioning_flows,
    retry_and_reconciliation: baseline.retry_and_reconciliation,
    execution_order: baseline.execution_order,
    configuration_artifacts: ARTIFACTS,
    governance_docs: DOCS,
    manual_admin_checklist: baseline.manual_admin_checklist,
    validation_checklist: baseline.validation_checklist,
    rollback_principles: baseline.rollback_principles
  };
}

export async function buildMicrosoft365ProvisioningPlan(
  client: PoolClient,
  tenantId: string,
  input: QueueMicrosoft365ProvisioningInput
): Promise<Microsoft365ProvisioningPlan> {
  const baseline = loadBaseline(resolveEnvironment());
  const contract = findCanonicalEntityContract(baseline, input.dashboard_entity_type);
  const flow = findProvisioningFlow(baseline, input.dashboard_entity_type);
  const context = await resolveDashboardContext(client, tenantId, input.dashboard_entity_type, input.dashboard_entity_id);
  const dashboardUrl = buildDashboardUrl(contract.dashboard_route_hash, {
    dashboardEntityId: input.dashboard_entity_id,
    jobId: context.jobId
  });

  return {
    canonical_dashboard_id: contract.canonical_id_pattern.replaceAll("{dashboard_entity_id}", input.dashboard_entity_id),
    dashboard_entity_type: input.dashboard_entity_type,
    dashboard_entity_id: input.dashboard_entity_id,
    entity_family: contract.entity_family,
    dashboard_url: dashboardUrl,
    operation_type: flow.operation_type,
    source_trigger: flow.source_trigger,
    target_objects: flow.target_objects.map((target) => ({
      microsoft_object_type: target.microsoft_object_type,
      logical_name: target.logical_name,
      naming_pattern: target.naming_pattern,
      backlink_field: target.backlink_field,
      microsoft_url_field: target.microsoft_url_field,
      notes: context.label ? `${target.notes} Source label: ${context.label}.` : target.notes
    }))
  };
}

export async function queueMicrosoft365ProvisioningScaffold(
  client: PoolClient,
  auth: AuthUser,
  input: QueueMicrosoft365ProvisioningInput
) {
  const baseline = loadBaseline(resolveEnvironment());
  const plan = await buildMicrosoft365ProvisioningPlan(client, auth.tenantId, input);
  const sourceChangeKey =
    input.source_change_key?.trim() ||
    `${plan.canonical_dashboard_id}:${plan.operation_type}:${plan.dashboard_entity_id}:${plan.target_objects
      .map((item) => item.microsoft_object_type)
      .join(",")}`;

  const operation = await queueIntegrationSyncOperation(client, {
    tenantId: auth.tenantId,
    provider: "microsoft365_workspace" as IntegrationProvider,
    direction: "outbound",
    entityType: plan.dashboard_entity_type,
    entityId: isUuid(plan.dashboard_entity_id) ? plan.dashboard_entity_id : null,
    externalObjectType: "microsoft_workspace",
    externalId: null,
    operationType: plan.operation_type,
    sourceSystem: "mission_control",
    sourceChangeKey,
    triggeredByUserId: auth.id,
    payload: {
      contract_version: baseline.baseline_version,
      canonical_dashboard_id: plan.canonical_dashboard_id,
      dashboard_entity_type: plan.dashboard_entity_type,
      dashboard_entity_id: plan.dashboard_entity_id,
      dashboard_url: plan.dashboard_url,
      source_trigger: plan.source_trigger,
      desired_objects: plan.target_objects
    }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "integration.microsoft365_workspace.scaffold_queued",
    entityType: plan.dashboard_entity_type,
    entityId: isUuid(plan.dashboard_entity_id) ? plan.dashboard_entity_id : null,
    metadata: {
      integration_sync_operation_id: operation.id,
      canonical_dashboard_id: plan.canonical_dashboard_id,
      desired_objects: plan.target_objects.map((item) => item.microsoft_object_type),
      execution_mode: "manual"
    }
  });

  return {
    operation,
    plan
  };
}

function normalizeLinkStatus(value?: Microsoft365LinkSyncStatus | null): Microsoft365LinkSyncStatus {
  return linkStatusSchema.parse(value ?? "linked");
}

export async function upsertMicrosoft365ProvisioningLinks(
  client: PoolClient,
  auth: AuthUser,
  input: UpsertMicrosoft365ProvisioningLinkInput
) {
  if (!input.resolved_objects.length) {
    throw new ApiError(400, "At least one resolved Microsoft object is required.");
  }

  const baseline = loadBaseline(resolveEnvironment());
  const contract = findCanonicalEntityContract(baseline, input.dashboard_entity_type);
  const context = await resolveDashboardContext(client, auth.tenantId, input.dashboard_entity_type, input.dashboard_entity_id);
  const canonicalDashboardId = contract.canonical_id_pattern.replaceAll("{dashboard_entity_id}", input.dashboard_entity_id);
  const dashboardUrl =
    input.dashboard_url?.trim() ||
    buildDashboardUrl(contract.dashboard_route_hash, {
      dashboardEntityId: input.dashboard_entity_id,
      jobId: context.jobId
    });

  const upserted: Microsoft365ProvisioningLinkRecord[] = [];
  for (const resolvedObject of input.resolved_objects) {
    const syncStatus = normalizeLinkStatus(resolvedObject.sync_status ?? "linked");
    const { rows } = await client.query<Microsoft365ProvisioningLinkRecord>(
      `
        INSERT INTO microsoft_workspace_link (
          tenant_id,
          provider,
          dashboard_entity_type,
          dashboard_entity_id,
          canonical_dashboard_id,
          microsoft_object_type,
          microsoft_object_id,
          microsoft_object_label,
          microsoft_parent_object_id,
          microsoft_url,
          dashboard_url,
          mirror_scope,
          sync_status,
          last_sync_operation_id,
          last_sync_error,
          last_synced_at,
          metadata,
          created_by_user_id,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          'microsoft365_workspace',
          $2::microsoft_dashboard_entity_type,
          $3,
          $4,
          $5::microsoft_workspace_object_type,
          $6,
          $7,
          $8,
          $9,
          $10,
          'dashboard_read_only_mirror',
          $11::microsoft_workspace_link_status,
          $12::uuid,
          CASE WHEN $11 = 'failed'::microsoft_workspace_link_status THEN 'Microsoft link flagged as failed.' ELSE NULL END,
          CASE WHEN $11 = 'linked'::microsoft_workspace_link_status OR $11 = 'drifted'::microsoft_workspace_link_status THEN now() ELSE NULL END,
          $13::jsonb,
          $14::uuid,
          now(),
          now()
        )
        ON CONFLICT (tenant_id, canonical_dashboard_id, microsoft_object_type)
        DO UPDATE SET
          microsoft_object_id = EXCLUDED.microsoft_object_id,
          microsoft_object_label = EXCLUDED.microsoft_object_label,
          microsoft_parent_object_id = EXCLUDED.microsoft_parent_object_id,
          microsoft_url = EXCLUDED.microsoft_url,
          dashboard_url = EXCLUDED.dashboard_url,
          sync_status = EXCLUDED.sync_status,
          last_sync_operation_id = EXCLUDED.last_sync_operation_id,
          last_sync_error = EXCLUDED.last_sync_error,
          last_synced_at = EXCLUDED.last_synced_at,
          metadata = EXCLUDED.metadata,
          updated_at = now()
        RETURNING
          id::text,
          tenant_id::text,
          provider,
          dashboard_entity_type::text,
          dashboard_entity_id,
          canonical_dashboard_id,
          microsoft_object_type::text,
          microsoft_object_id,
          microsoft_object_label,
          microsoft_parent_object_id,
          microsoft_url,
          dashboard_url,
          mirror_scope,
          sync_status::text,
          last_sync_operation_id::text,
          last_sync_error,
          last_synced_at::text,
          metadata,
          created_by_user_id::text,
          created_at::text,
          updated_at::text
      `,
      [
        auth.tenantId,
        input.dashboard_entity_type,
        input.dashboard_entity_id,
        canonicalDashboardId,
        resolvedObject.microsoft_object_type,
        resolvedObject.microsoft_object_id,
        resolvedObject.microsoft_object_label ?? null,
        resolvedObject.microsoft_parent_object_id ?? null,
        resolvedObject.microsoft_url ?? null,
        dashboardUrl ?? null,
        syncStatus,
        input.operation_id ?? null,
        JSON.stringify({
          dashboard_entity_family: contract.entity_family,
          dashboard_label: context.label,
          ...(resolvedObject.metadata ?? {})
        }),
        auth.id
      ]
    );

    upserted.push(rows[0]);

    await client.query(
      `
        INSERT INTO external_object_map (tenant_id, provider, external_id, object_type, object_id, payload)
        VALUES ($1, 'microsoft365_workspace', $2, $3, $4::uuid, $5::jsonb)
        ON CONFLICT (tenant_id, provider, external_id, object_type)
        DO UPDATE SET
          object_id = EXCLUDED.object_id,
          payload = EXCLUDED.payload
      `,
      [
        auth.tenantId,
        resolvedObject.microsoft_object_id,
        input.dashboard_entity_type,
        isUuid(input.dashboard_entity_id) ? input.dashboard_entity_id : null,
        JSON.stringify({
          canonical_dashboard_id: canonicalDashboardId,
          microsoft_object_type: resolvedObject.microsoft_object_type,
          microsoft_url: resolvedObject.microsoft_url ?? null,
          dashboard_url: dashboardUrl ?? null,
          dashboard_entity_id: input.dashboard_entity_id,
          dashboard_entity_type: input.dashboard_entity_type
        })
      ]
    );
  }

  if (input.operation_id) {
    await markIntegrationSyncOperationSucceeded(client, {
      tenantId: auth.tenantId,
      operationId: input.operation_id,
      actorUserId: auth.id,
      externalId: input.resolved_objects[0]?.microsoft_object_id ?? null,
      resultPayload: {
        provisioning_state: "links_recorded",
        resolved_objects_count: input.resolved_objects.length,
        canonical_dashboard_id: canonicalDashboardId
      },
      metadata: {
        provider: "microsoft365_workspace"
      }
    });
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "integration.microsoft365_workspace.links_upserted",
    entityType: input.dashboard_entity_type,
    entityId: isUuid(input.dashboard_entity_id) ? input.dashboard_entity_id : null,
    metadata: {
      integration_sync_operation_id: input.operation_id ?? null,
      canonical_dashboard_id: canonicalDashboardId,
      resolved_objects: input.resolved_objects.map((item) => ({
        microsoft_object_type: item.microsoft_object_type,
        microsoft_object_id: item.microsoft_object_id
      }))
    }
  });

  return {
    canonical_dashboard_id: canonicalDashboardId,
    dashboard_url: dashboardUrl,
    links: upserted
  };
}

export async function listMicrosoft365ProvisioningLinks(
  client: PoolClient,
  auth: AuthUser,
  filters: {
    dashboardEntityType?: Microsoft365DashboardEntityType | null;
    dashboardEntityId?: string | null;
    syncStatus?: Microsoft365LinkSyncStatus | null;
  } = {}
) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    throw new ApiError(403, "Integration governance access is required");
  }

  const values: unknown[] = [auth.tenantId];
  const where: string[] = ["tenant_id = $1"];

  if (filters.dashboardEntityType) {
    values.push(filters.dashboardEntityType);
    where.push(`dashboard_entity_type = $${values.length}::microsoft_dashboard_entity_type`);
  }

  if (filters.dashboardEntityId) {
    values.push(filters.dashboardEntityId);
    where.push(`dashboard_entity_id = $${values.length}`);
  }

  if (filters.syncStatus) {
    values.push(filters.syncStatus);
    where.push(`sync_status = $${values.length}::microsoft_workspace_link_status`);
  }

  const { rows } = await client.query<Microsoft365ProvisioningLinkRecord>(
    `
      SELECT
        id::text,
        tenant_id::text,
        provider,
        dashboard_entity_type::text,
        dashboard_entity_id,
        canonical_dashboard_id,
        microsoft_object_type::text,
        microsoft_object_id,
        microsoft_object_label,
        microsoft_parent_object_id,
        microsoft_url,
        dashboard_url,
        mirror_scope,
        sync_status::text,
        last_sync_operation_id::text,
        last_sync_error,
        last_synced_at::text,
        metadata,
        created_by_user_id::text,
        created_at::text,
        updated_at::text
      FROM microsoft_workspace_link
      WHERE ${where.join(" AND ")}
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 200
    `,
    values
  );

  return rows;
}
