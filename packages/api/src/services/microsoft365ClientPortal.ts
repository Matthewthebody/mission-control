import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { z } from "zod";
import { hasAuthorityTier } from "../authz/authority.js";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  Microsoft365ClientPortalAccessGrantRecord,
  Microsoft365ClientPortalAccessScope,
  Microsoft365ClientPortalAccessStatus,
  Microsoft365ClientPortalArtifact,
  Microsoft365ClientPortalAuthProvider,
  Microsoft365ClientPortalBaseline,
  Microsoft365ClientPortalCurrentStateFinding,
  Microsoft365ClientPortalDiagnosticsResponse,
  Microsoft365ClientPortalDocReference,
  Microsoft365ClientPortalEnvironment,
  Microsoft365ClientPortalGoNoGo,
  Microsoft365ClientPortalLinkStatus,
  Microsoft365ClientPortalPhaseOneMvpDefinition,
  Microsoft365ClientPortalProjectLinkRecord,
  Microsoft365ClientPortalProjectSummary,
  Microsoft365ClientPortalProjectView,
  Microsoft365ClientPortalRefactorItem,
  Microsoft365ClientPortalRequiredItemView,
  Microsoft365ClientPortalSubmissionHistoryItem,
  Microsoft365ClientPortalValidationIssue,
  Microsoft365ClientPortalWorkspace,
  UpsertMicrosoft365ClientPortalAccessGrantInput,
  UpsertMicrosoft365ClientPortalProjectLinkInput
} from "../types/microsoft365ClientPortal.js";
import { resolveApiRepoPath } from "../utils/repoPaths.js";
import { createAuditLog } from "./audit.js";
import { getMicrosoft365ClientIntakeValidationIssues } from "./microsoft365ClientIntake.js";
import { getMicrosoft365ClientIntakeOperationalControlValidationIssues } from "./microsoft365ClientIntakeOperations.js";
import { getMicrosoft365GovernanceValidationIssues } from "./microsoft365Governance.js";
import { getMicrosoft365MailAutomationValidationIssues } from "./microsoft365MailAutomation.js";
import { getMicrosoft365OperatingSystemValidationIssues } from "./microsoft365OperatingSystem.js";
import { buildMicrosoft365CanonicalDashboardId } from "./microsoft365Provisioning.js";

const environmentSchema = z.enum(["development", "staging", "production"]);
const authProviderSchema = z.enum(["entra_external_id"]);
const accessScopeSchema = z.enum(["organization", "job"]);
const accessStatusSchema = z.enum(["invited", "active", "disabled", "revoked"]);
const linkStatusSchema = z.enum(["planned", "linked", "drifted", "archived"]);
const pageKeySchema = z.enum(["project_overview", "required_items", "upload", "submission_history", "help"]);

const baselineSchema = z.object({
  phase: z.literal("phase7_power_pages_client_portal"),
  baseline_version: z.string().trim().min(1),
  environment: environmentSchema,
  tenant_tier: z.enum(["sandbox", "preproduction", "production"]),
  portal_information_architecture: z.object({
    site_strategy: z.string().trim().min(1),
    home_route: z.string().trim().min(1),
    page_map: z.array(
      z.object({
        key: pageKeySchema,
        title: z.string().trim().min(1),
        route: z.string().trim().min(1),
        purpose: z.string().trim().min(1),
        security_rule: z.string().trim().min(1),
        components: z.array(z.string().trim().min(1)).min(1)
      })
    ).min(1)
  }),
  authentication_model: z.object({
    provider: authProviderSchema,
    invitation_rule: z.string().trim().min(1),
    identity_binding_rule: z.string().trim().min(1),
    mfa_rule: z.string().trim().min(1),
    session_rule: z.string().trim().min(1),
    least_privilege_rule: z.string().trim().min(1)
  }),
  scoping_rules: z.object({
    organization_scope_rule: z.string().trim().min(1),
    project_scope_rule: z.string().trim().min(1),
    upload_scope_rule: z.string().trim().min(1),
    hidden_internal_data_rule: z.string().trim().min(1),
    shareable_content_rule: z.string().trim().min(1),
    revocation_rule: z.string().trim().min(1)
  }),
  ui_specification: z.object({
    project_overview_cards: z.array(z.string().trim().min(1)).min(1),
    required_item_status_fields: z.array(z.string().trim().min(1)).min(1),
    upload_page_fields: z.array(z.string().trim().min(1)).min(1),
    submission_history_fields: z.array(z.string().trim().min(1)).min(1),
    help_page_sections: z.array(z.string().trim().min(1)).min(1)
  }),
  data_integration: z.object({
    dashboard_source_of_truth_rule: z.string().trim().min(1),
    portal_mirror_rule: z.string().trim().min(1),
    upload_handling_rule: z.string().trim().min(1),
    dashboard_id_traceability_rule: z.string().trim().min(1),
    approval_status_rule: z.string().trim().min(1)
  }),
  support_model: z.object({
    support_mailbox_key: z.string().trim().min(1),
    help_page_rule: z.string().trim().min(1),
    escalation_rule: z.string().trim().min(1),
    maintenance_rule: z.string().trim().min(1),
    audit_rule: z.string().trim().min(1)
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

const DOCS: Microsoft365ClientPortalDocReference[] = [
  {
    key: "phase_one_contract",
    title: "Phase-One Operating Contract",
    path: "docs/architecture/phase-one-operating-contract.md",
    summary: "Canonical product boundary for communications, portal scope, core objects, and route ownership."
  },
  {
    key: "phase_one_portal_runtime_plan",
    title: "Phase-One Account Portal MVP Runtime Plan",
    path: "docs/architecture/phase-one-account-portal-mvp-runtime-plan.md",
    summary: "Defines the runtime owner, exact MVP routes, and deferred scope for the bounded account-facing portal."
  },
  {
    key: "phase_one_acceptance",
    title: "Phase-One Acceptance Criteria",
    path: "docs/architecture/phase-one-acceptance-criteria.md",
    summary: "Acceptance criteria that keep the portal narrow and stop it from drifting into CRM or inbox behavior."
  }
];

const ARTIFACTS: Microsoft365ClientPortalArtifact[] = [
  {
    kind: "doc",
    path: "docs/architecture/phase-one-account-portal-mvp-runtime-plan.md",
    summary: "Repo-owned runtime owner and route plan for the bounded phase-one account-facing portal MVP.",
    tenant_admin_action: false
  },
  {
    kind: "baseline",
    path: "ops/microsoft365/phase7/client-portal-baseline.development.json",
    summary: "Development Power Pages client portal baseline.",
    tenant_admin_action: false
  },
  {
    kind: "baseline",
    path: "ops/microsoft365/phase7/client-portal-baseline.staging.json",
    summary: "Staging and pilot Power Pages client portal baseline.",
    tenant_admin_action: false
  },
  {
    kind: "baseline",
    path: "ops/microsoft365/phase7/client-portal-baseline.production.json",
    summary: "Production Power Pages client portal baseline.",
    tenant_admin_action: false
  },
  {
    kind: "script",
    path: "ops/microsoft365/phase7/Test-M365ClientPortalBaseline.ps1",
    summary: "Non-destructive validation script for the Phase 7 portal baseline and environment prerequisites.",
    tenant_admin_action: true
  },
  {
    kind: "script",
    path: "ops/microsoft365/phase7/Get-M365ClientPortalPlan.ps1",
    summary: "Renders the exact page and scoping plan for a portal-linked project.",
    tenant_admin_action: false
  },
  {
    kind: "api",
    path: "GET /api/admin/system/microsoft-client-portal",
    summary: "Admin diagnostics payload for Power Pages client portal readiness, access grants, links, and portal-safe project views.",
    tenant_admin_action: false
  }
];

type Baseline = z.infer<typeof baselineSchema>;

type AccessGrantRow = {
  id: string;
  tenant_id: string;
  organization_id: string;
  organization_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  job_id: string | null;
  job_number: string | null;
  job_title: string | null;
  access_scope: Microsoft365ClientPortalAccessScope;
  access_status: Microsoft365ClientPortalAccessStatus;
  external_email: string;
  external_identity_provider: Microsoft365ClientPortalAuthProvider;
  external_identity_subject: string | null;
  power_pages_contact_id: string | null;
  power_pages_web_role_keys: string[] | null;
  invited_by_user_id: string | null;
  last_sign_in_at: string | null;
  last_notified_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type ProjectLinkRow = {
  id: string;
  tenant_id: string;
  organization_id: string;
  organization_name: string | null;
  job_id: string;
  job_number: string | null;
  job_title: string | null;
  canonical_dashboard_id: string;
  power_pages_site_key: string;
  portal_project_key: string;
  overview_page_url: string | null;
  required_items_page_url: string | null;
  upload_page_url: string | null;
  submission_history_page_url: string | null;
  help_page_url: string | null;
  link_status: Microsoft365ClientPortalLinkStatus;
  metadata: Record<string, unknown> | null;
  last_synced_at: string | null;
  last_sync_error: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectSummaryRow = {
  job_id: string;
  organization_id: string | null;
  organization_name: string | null;
  job_number: string | null;
  title: string | null;
  job_status: string | null;
  client_deadline_at: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  owner_name: string | null;
};

type RequiredItemRow = {
  id: string;
  label: string;
  is_complete: boolean;
  is_blocker: boolean;
  due_at: string | null;
  request_link_url: string | null;
  latest_submission_at: string | null;
  latest_submission_status: string | null;
};

type SubmissionHistoryRow = {
  id: string;
  mapping_id: string | null;
  required_item_id: string | null;
  required_item_label: string | null;
  file_name: string;
  file_url: string | null;
  submitted_at: string;
  matching_status: string;
  uploader_name: string | null;
};

type WorkspaceSummaryRow = {
  active_grant_count: string;
  invited_grant_count: string;
  active_project_count: string;
  drifted_project_count: string;
};

function resolveEnvironment(): Microsoft365ClientPortalEnvironment {
  if (config.MICROSOFT_365_CLIENT_PORTAL_ENV) {
    return config.MICROSOFT_365_CLIENT_PORTAL_ENV;
  }
  if (config.NODE_ENV === "production") {
    return "production";
  }
  return "development";
}

function getBaselinePath(environment: Microsoft365ClientPortalEnvironment) {
  return resolveApiRepoPath("ops", "microsoft365", "phase7", `client-portal-baseline.${environment}.json`);
}

function loadBaseline(environment = resolveEnvironment()): Microsoft365ClientPortalBaseline {
  const raw = readFileSync(getBaselinePath(environment), "utf8");
  const parsed = baselineSchema.parse(JSON.parse(raw));
  if (parsed.environment !== environment) {
    throw new Error(`Microsoft 365 client portal baseline environment mismatch: expected ${environment}, found ${parsed.environment}.`);
  }
  return parsed;
}

function determineRecommendation(issues: Microsoft365ClientPortalValidationIssue[]): Microsoft365ClientPortalGoNoGo {
  if (issues.some((issue) => issue.severity === "error")) {
    return "no_go";
  }
  if (issues.length > 0) {
    return "conditional_go";
  }
  return "go";
}

function addIssue(issues: Microsoft365ClientPortalValidationIssue[], issue: Microsoft365ClientPortalValidationIssue) {
  issues.push(issue);
}

function normalizeStringArray(values: string[] | null | undefined) {
  return Array.isArray(values)
    ? values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))
    : [];
}

function normalizeRecord(value: Record<string, unknown> | null | undefined) {
  return value && typeof value === "object" ? value : {};
}

function buildDashboardUrl(jobId: string) {
  if (!config.ADMIN_WEB_URL) {
    return null;
  }
  const base = config.ADMIN_WEB_URL.replace(/\/$/, "");
  return `${base}/#jobs/${jobId}`;
}

function buildPortalUrlTemplate(path: string) {
  const base = config.MICROSOFT_365_CLIENT_PORTAL_SITE_URL?.trim().replace(/\/$/, "") || "";
  if (!base) {
    return null;
  }
  return `${base}${path}`;
}

export function getMicrosoft365ClientPortalPhaseOneMvpDefinition(): Microsoft365ClientPortalPhaseOneMvpDefinition {
  const routeBase = "/projects";
  const statusRoute = "/projects/{portal_project_key}/status";
  return {
    runtime_owner: {
      owner_key: "microsoft365_client_portal",
      owner_service_path: "packages/api/src/services/microsoft365ClientPortal.ts",
      access_grant_record: "microsoft_client_portal_access_grant",
      project_link_record: "microsoft_client_portal_project_link",
      diagnostics_route: "/api/admin/system/microsoft-client-portal",
      project_links_route: "/api/integrations/microsoft/client-portal/projects",
      access_grants_route: "/api/integrations/microsoft/client-portal/access-grants",
      source_of_truth_rule:
        "The phase-one portal is a controlled projection of canonical Mission Control account, job, event, file, approval, and activity records.",
      internal_workspace_rule:
        "The portal is not a top-level internal workspace; internal control stays in diagnostics and integration-governance routes."
    },
    auth_boundary: {
      provider: "entra_external_id",
      account_access_rule:
        "External access starts only from explicit microsoft_client_portal_access_grant records tied to the invited account contact.",
      project_access_rule:
        "Job-linked portal visibility starts only from explicit microsoft_client_portal_project_link records for the granted job.",
      revocation_rule:
        "Disabled, revoked, or unlinked grants remove portal visibility without moving Mission Control ownership out of the app."
    },
    shell_boundary: {
      admin_shell_rule:
        "The account-facing portal lives outside the internal admin-web hash shell and must not appear as a top-level operator workspace.",
      internal_projects_route_rule:
        "The admin-web projects route remains the internal Graphics workspace and must not be repurposed as the external /projects portal entry."
    },
    required_runtime_modules: {
      backend: [
        "packages/api/src/services/microsoft365ClientPortal.ts",
        "packages/api/src/types/microsoft365ClientPortal.ts",
        "/api/admin/system/microsoft-client-portal",
        "/api/integrations/microsoft/client-portal/access-grants",
        "/api/integrations/microsoft/client-portal/projects"
      ],
      frontend: [
        "packages/admin-web/src/navigation.ts",
        "packages/admin-web/src/app.tsx"
      ]
    },
    route_base: routeBase,
    default_entry_route: statusRoute,
    routes: [
      {
        key: "projects",
        scope: "account",
        route: routeBase,
        full_url_template: buildPortalUrlTemplate(routeBase),
        purpose: "Account-scoped entry route that lists only the linked projects the signed-in external contact is allowed to open.",
        source_records: ["Account", "Job", "Sync Object"]
      },
      {
        key: "status",
        scope: "job",
        route: statusRoute,
        full_url_template: buildPortalUrlTemplate(statusRoute),
        purpose: "Default project route for portal-safe status, next milestone, exceptions that are safe to share, and approval-state visibility.",
        source_records: ["Job", "Workflow Run", "Approval", "Exception", "Acknowledgement"]
      },
      {
        key: "schedule",
        scope: "job",
        route: "/projects/{portal_project_key}/schedule",
        full_url_template: buildPortalUrlTemplate("/projects/{portal_project_key}/schedule"),
        purpose: "Portal-safe schedule projection for client-visible event timing and schedule changes tied to the linked job.",
        source_records: ["Event", "Staff Assignment", "Schedule Projection"]
      },
      {
        key: "files",
        scope: "job",
        route: "/projects/{portal_project_key}/files",
        full_url_template: buildPortalUrlTemplate("/projects/{portal_project_key}/files"),
        purpose: "Curated file list for client-safe deliverables, requested uploads, and linked file history tied to the linked job.",
        source_records: ["File", "Record Resource", "Sync Object"]
      },
      {
        key: "history",
        scope: "job",
        route: "/projects/{portal_project_key}/history",
        full_url_template: buildPortalUrlTemplate("/projects/{portal_project_key}/history"),
        purpose: "Client-safe change history for meaningful updates, submissions, and visible state transitions on the linked job.",
        source_records: ["Activity Log", "Submission History", "Approval"]
      }
    ],
    compatibility_aliases: [
      {
        route: "/projects/{portal_project_key}",
        resolves_to: statusRoute,
        purpose: "Keeps the older overview-style project entry URL stable while phase one makes status the explicit default route."
      }
    ],
    phase_one_now: [
      "account-scoped project entry",
      "job-linked status route",
      "job-linked schedule route",
      "job-linked files route",
      "job-linked change-history route",
      "app-owned access grants",
      "app-owned job project links"
    ],
    deferred: [
      "general CRM behavior",
      "free-form inbox or messaging center",
      "workflow editing from the portal",
      "broad self-service scheduling changes",
      "billing and finance workspaces",
      "later-phase required-items, upload, and help expansions beyond the bounded MVP"
    ]
  };
}

function assertReadAccess(auth: Pick<AuthUser, "authorityTier">) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    throw new ApiError(403, "Integration governance access is required.");
  }
}

function assertManageAccess(auth: Pick<AuthUser, "authorityTier">) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Integration governance management access is required.");
  }
}

function buildCurrentStateFindings(): Microsoft365ClientPortalCurrentStateFinding[] {
  return [
    {
      key: "secure_intake_foundation_exists",
      state: "existing",
      summary:
        "Phase 5 and Phase 6 already created durable intake mappings, submission history, reviewer decisions, and reminder suppression, which gives the portal a reliable upload and status foundation without moving workflow state into Power Pages.",
      evidence: [
        "packages/api/src/services/microsoft365ClientIntake.ts",
        "packages/api/src/services/microsoft365ClientIntakeOperations.ts"
      ]
    },
    {
      key: "microsoft_workspace_contract_exists",
      state: "existing",
      summary:
        "The Microsoft workspace and provisioning phases already established dashboard ids, backlinks, and governed SharePoint/Teams topology, which is the right base for a Power Pages portal that mirrors but does not own client project data.",
      evidence: [
        "packages/api/src/services/microsoft365Provisioning.ts",
        "packages/api/src/services/microsoft365OperatingSystem.ts"
      ]
    },
    {
      key: "portal_access_contract_was_missing",
      state: "missing",
      summary:
        "Before Phase 7 there was no durable app-owned grant model describing which external contacts could see which organizations or projects, so Power Pages would have had to infer access from ad hoc links or folder structure.",
      evidence: [
        "packages/api/src/services/microsoft365ClientIntake.ts",
        "packages/api/src/services/organizations.ts"
      ],
      recommended_refactor: "Keep external visibility tied to explicit app-owned access grants rather than request-file links or mailbox history."
    },
    {
      key: "relationship_portal_messages_exist_but_are_not_a_portal_model",
      state: "partial",
      summary:
        "Relationship continuity already knows about portal-related communication touchpoints, but that is a communication memory model, not a secure external access and scoping layer.",
      evidence: [
        "packages/api/src/services/relationshipContinuity.ts",
        "packages/api/src/types/organizations.ts"
      ],
      recommended_refactor: "Continue treating relationship touchpoints as history only; do not let them become access-control truth."
    }
  ];
}

function buildRefactorFirst(): Microsoft365ClientPortalRefactorItem[] {
  return [
    {
      key: "keep_external_access_app_owned",
      severity: "high",
      summary: "External organization and project access must be controlled by durable app-owned grants instead of Power Pages page visibility alone.",
      consequence: "If Power Pages web roles become the only access model, organization and project scoping will drift away from dashboard truth."
    },
    {
      key: "never_surface_internal_notes_by_default",
      severity: "high",
      summary: "Portal projections should expose only purpose-built client-safe fields; internal notes and reviewer commentary stay hidden unless a future shareable-content layer explicitly allows them.",
      consequence: "If portal data is assembled from broad record detail payloads, confidential operational notes can leak to clients."
    },
    {
      key: "reuse_existing_upload_and_submission_history",
      severity: "high",
      summary: "The portal upload experience should continue using the Phase 5 intake mappings and submission logging rather than creating a separate portal upload subsystem.",
      consequence: "A second upload path would break traceability, duplicate reminders, and confuse required-item completion logic."
    }
  ];
}

async function hasPhase7Schema(client: PoolClient) {
  const { rows } = await client.query<{
    has_access_grants: boolean;
    has_project_links: boolean;
  }>(
    `
      SELECT
        EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'microsoft_client_portal_access_grant'
        ) AS has_access_grants,
        EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'microsoft_client_portal_project_link'
        ) AS has_project_links
    `
  );
  return Boolean(rows[0]?.has_access_grants && rows[0]?.has_project_links);
}

function parseAccessGrantRow(row: AccessGrantRow): Microsoft365ClientPortalAccessGrantRecord {
  return {
    ...row,
    power_pages_web_role_keys: normalizeStringArray(row.power_pages_web_role_keys),
    metadata: normalizeRecord(row.metadata)
  };
}

function parseProjectLinkRow(row: ProjectLinkRow): Microsoft365ClientPortalProjectLinkRecord {
  return {
    ...row,
    metadata: normalizeRecord(row.metadata)
  };
}

async function listPortalAccessGrantRows(
  client: PoolClient,
  tenantId: string,
  input: {
    organizationId?: string | null;
    jobId?: string | null;
    accessStatus?: Microsoft365ClientPortalAccessStatus | null;
    limit?: number;
  } = {}
) {
  const { rows } = await client.query<AccessGrantRow>(
    `
      SELECT
        grant_row.id::text,
        grant_row.tenant_id::text,
        grant_row.organization_id::text,
        org.display_name AS organization_name,
        grant_row.contact_id::text,
        contact.full_name AS contact_name,
        grant_row.job_id::text,
        job.job_number,
        job.title AS job_title,
        grant_row.access_scope::text,
        grant_row.access_status::text,
        grant_row.external_email,
        grant_row.external_identity_provider::text,
        grant_row.external_identity_subject,
        grant_row.power_pages_contact_id,
        grant_row.power_pages_web_role_keys,
        grant_row.invited_by_user_id::text,
        grant_row.last_sign_in_at::text,
        grant_row.last_notified_at::text,
        grant_row.metadata,
        grant_row.created_at::text,
        grant_row.updated_at::text
      FROM microsoft_client_portal_access_grant grant_row
      JOIN organization org
        ON org.id = grant_row.organization_id
      LEFT JOIN organization_contact contact
        ON contact.id = grant_row.contact_id
      LEFT JOIN jobs job
        ON job.id = grant_row.job_id
       AND job.tenant_id = grant_row.tenant_id
      WHERE grant_row.tenant_id = $1
        AND ($2::uuid IS NULL OR grant_row.organization_id = $2::uuid)
        AND ($3::uuid IS NULL OR grant_row.job_id = $3::uuid)
        AND ($4::microsoft_client_portal_access_status IS NULL OR grant_row.access_status = $4::microsoft_client_portal_access_status)
      ORDER BY grant_row.updated_at DESC, grant_row.created_at DESC
      LIMIT $5
    `,
    [tenantId, input.organizationId ?? null, input.jobId ?? null, input.accessStatus ?? null, Math.min(Math.max(input.limit ?? 100, 1), 250)]
  );
  return rows.map(parseAccessGrantRow);
}

async function listPortalProjectLinkRows(
  client: PoolClient,
  tenantId: string,
  input: {
    organizationId?: string | null;
    jobId?: string | null;
    linkStatus?: Microsoft365ClientPortalLinkStatus | null;
    limit?: number;
  } = {}
) {
  const { rows } = await client.query<ProjectLinkRow>(
    `
      SELECT
        link.id::text,
        link.tenant_id::text,
        link.organization_id::text,
        org.display_name AS organization_name,
        link.job_id::text,
        job.job_number,
        job.title AS job_title,
        link.canonical_dashboard_id,
        link.power_pages_site_key,
        link.portal_project_key,
        link.overview_page_url,
        link.required_items_page_url,
        link.upload_page_url,
        link.submission_history_page_url,
        link.help_page_url,
        link.link_status::text,
        link.metadata,
        link.last_synced_at::text,
        link.last_sync_error,
        link.created_by_user_id::text,
        link.created_at::text,
        link.updated_at::text
      FROM microsoft_client_portal_project_link link
      JOIN organization org
        ON org.id = link.organization_id
      JOIN jobs job
        ON job.id = link.job_id
       AND job.tenant_id = link.tenant_id
      WHERE link.tenant_id = $1
        AND ($2::uuid IS NULL OR link.organization_id = $2::uuid)
        AND ($3::uuid IS NULL OR link.job_id = $3::uuid)
        AND ($4::microsoft_client_portal_link_status IS NULL OR link.link_status = $4::microsoft_client_portal_link_status)
      ORDER BY link.updated_at DESC, link.created_at DESC
      LIMIT $5
    `,
    [tenantId, input.organizationId ?? null, input.jobId ?? null, input.linkStatus ?? null, Math.min(Math.max(input.limit ?? 100, 1), 250)]
  );
  return rows.map(parseProjectLinkRow);
}

async function loadProjectSummary(client: PoolClient, tenantId: string, jobId: string): Promise<ProjectSummaryRow | null> {
  const { rows } = await client.query<ProjectSummaryRow>(
    `
      SELECT
        j.id::text AS job_id,
        j.organization_id::text,
        org.display_name AS organization_name,
        j.job_number,
        j.title,
        j.job_status::text,
        j.client_deadline_at::text,
        contact.full_name AS primary_contact_name,
        contact.email AS primary_contact_email,
        owner.full_name AS owner_name
      FROM jobs j
      LEFT JOIN organization org
        ON org.id = j.organization_id
      LEFT JOIN organization_contact contact
        ON contact.id = j.primary_contact_id
      LEFT JOIN app_user owner
        ON owner.id = j.account_owner_user_id
      WHERE j.tenant_id = $1
        AND j.id = $2::uuid
      LIMIT 1
    `,
    [tenantId, jobId]
  );
  return rows[0] ?? null;
}

async function loadRequiredItems(client: PoolClient, tenantId: string, jobId: string) {
  const { rows } = await client.query<RequiredItemRow>(
    `
      SELECT
        item.id::text,
        item.label,
        item.is_complete,
        item.is_blocker,
        item.due_at::text,
        mapping.request_link_url,
        latest.submitted_at::text AS latest_submission_at,
        latest.matching_status::text AS latest_submission_status
      FROM job_readiness_items item
      LEFT JOIN microsoft_client_intake_mapping mapping
        ON mapping.tenant_id = item.tenant_id
       AND mapping.required_item_id = item.id
       AND mapping.status <> 'archived'::microsoft_client_intake_mapping_status
      LEFT JOIN LATERAL (
        SELECT
          submission.submitted_at,
          submission.matching_status
        FROM microsoft_client_intake_submission submission
        WHERE submission.tenant_id = item.tenant_id
          AND submission.required_item_id = item.id
        ORDER BY submission.submitted_at DESC, submission.created_at DESC
        LIMIT 1
      ) latest ON true
      WHERE item.tenant_id = $1
        AND item.job_id = $2::uuid
      ORDER BY item.is_complete ASC, item.due_at NULLS LAST, item.created_at ASC
    `,
    [tenantId, jobId]
  );

  return rows.map<Microsoft365ClientPortalRequiredItemView>((row) => ({
    id: row.id,
    label: row.label,
    is_complete: row.is_complete,
    is_blocker: row.is_blocker,
    due_at: row.due_at,
    upload_url: row.request_link_url,
    latest_submission_at: row.latest_submission_at,
    latest_submission_status: row.latest_submission_status
  }));
}

async function loadSubmissionHistory(client: PoolClient, tenantId: string, jobId: string) {
  const { rows } = await client.query<SubmissionHistoryRow>(
    `
      SELECT
        submission.id::text,
        submission.mapping_id::text,
        submission.required_item_id::text,
        COALESCE(item.label, mapping.related_record_label) AS required_item_label,
        submission.file_name,
        submission.file_url,
        submission.submitted_at::text,
        submission.matching_status::text,
        submission.uploader_name
      FROM microsoft_client_intake_submission submission
      LEFT JOIN job_readiness_items item
        ON item.id = submission.required_item_id
      LEFT JOIN microsoft_client_intake_mapping mapping
        ON mapping.id = submission.mapping_id
       AND mapping.tenant_id = submission.tenant_id
      WHERE submission.tenant_id = $1
        AND submission.job_id = $2::uuid
      ORDER BY submission.submitted_at DESC, submission.created_at DESC
      LIMIT 25
    `,
    [tenantId, jobId]
  );

  return rows.map<Microsoft365ClientPortalSubmissionHistoryItem>((row) => ({
    id: row.id,
    mapping_id: row.mapping_id,
    required_item_id: row.required_item_id,
    required_item_label: row.required_item_label,
    file_name: row.file_name,
    file_url: row.file_url,
    submitted_at: row.submitted_at,
    matching_status: row.matching_status,
    uploader_name: row.uploader_name
  }));
}

async function buildProjectView(
  client: PoolClient,
  tenantId: string,
  link: Microsoft365ClientPortalProjectLinkRecord,
  accessGrants: Microsoft365ClientPortalAccessGrantRecord[],
  baseline: Microsoft365ClientPortalBaseline
): Promise<Microsoft365ClientPortalProjectView | null> {
  const summaryRow = await loadProjectSummary(client, tenantId, link.job_id);
  const requiredItems = await loadRequiredItems(client, tenantId, link.job_id);
  const submissionHistory = await loadSubmissionHistory(client, tenantId, link.job_id);

  if (!summaryRow) {
    return null;
  }

  const summary: Microsoft365ClientPortalProjectSummary = {
    job_id: summaryRow.job_id,
    organization_id: summaryRow.organization_id,
    organization_name: summaryRow.organization_name,
    job_number: summaryRow.job_number,
    title: summaryRow.title,
    job_status: summaryRow.job_status,
    client_deadline_at: summaryRow.client_deadline_at,
    primary_contact_name: summaryRow.primary_contact_name,
    primary_contact_email: summaryRow.primary_contact_email,
    owner_name: summaryRow.owner_name,
    dashboard_url: buildDashboardUrl(summaryRow.job_id),
    portal_links: {
      overview_page_url: link.overview_page_url,
      required_items_page_url: link.required_items_page_url,
      upload_page_url: link.upload_page_url,
      submission_history_page_url: link.submission_history_page_url,
      help_page_url: link.help_page_url
    },
    required_item_summary: {
      total_count: requiredItems.length,
      complete_count: requiredItems.filter((item) => item.is_complete).length,
      open_count: requiredItems.filter((item) => !item.is_complete).length,
      overdue_count: requiredItems.filter((item) => !item.is_complete && item.due_at && Date.parse(item.due_at) < Date.now()).length
    },
    submission_summary: {
      total_count: submissionHistory.length,
      latest_submitted_at: submissionHistory[0]?.submitted_at ?? null,
      approved_count: submissionHistory.filter((item) => item.matching_status === "approved").length,
      under_review_count: submissionHistory.filter((item) => item.matching_status === "under_review").length,
      revision_requested_count: submissionHistory.filter((item) => item.matching_status === "revision_requested").length
    }
  };

  return {
    project: summary,
    required_items: requiredItems,
    submission_history: submissionHistory,
    access_grants: accessGrants.filter(
      (grant) =>
        grant.organization_id === link.organization_id && (grant.access_scope === "organization" || grant.job_id === link.job_id)
    ),
    help_contact: {
      support_mailbox_key: baseline.support_model.support_mailbox_key,
      help_page_url: link.help_page_url,
      guidance: baseline.support_model.help_page_rule
    }
  };
}

async function buildWorkspace(client: PoolClient, tenantId: string): Promise<Microsoft365ClientPortalWorkspace> {
  const baseline = loadBaseline(resolveEnvironment());
  const summaryRows = await client.query<WorkspaceSummaryRow>(
    `
      SELECT
        count(*) FILTER (WHERE access_status = 'active'::microsoft_client_portal_access_status)::text AS active_grant_count,
        count(*) FILTER (WHERE access_status = 'invited'::microsoft_client_portal_access_status)::text AS invited_grant_count,
        '0'::text AS active_project_count,
        '0'::text AS drifted_project_count
      FROM microsoft_client_portal_access_grant
      WHERE tenant_id = $1
    `,
    [tenantId]
  );
  const grants = await listPortalAccessGrantRows(client, tenantId, { limit: 100 });
  const links = await listPortalProjectLinkRows(client, tenantId, { limit: 60 });
  const missingLinksResult = await client.query<{ missing_count: string }>(
    `
      SELECT
        count(DISTINCT mapping.job_id)::text AS missing_count
      FROM microsoft_client_intake_mapping mapping
      LEFT JOIN microsoft_client_portal_project_link link
        ON link.tenant_id = mapping.tenant_id
       AND link.job_id = mapping.job_id
       AND link.link_status <> 'archived'::microsoft_client_portal_link_status
      WHERE mapping.tenant_id = $1
        AND mapping.job_id IS NOT NULL
        AND mapping.status = 'active'::microsoft_client_intake_mapping_status
        AND link.id IS NULL
    `,
    [tenantId]
  );

  const projectViews: Microsoft365ClientPortalProjectView[] = [];
  for (const link of links.slice(0, 20)) {
    const view = await buildProjectView(client, tenantId, link, grants, baseline);
    if (view) {
      projectViews.push(view);
    }
  }

  const summaryRow = summaryRows.rows[0] ?? {
    active_grant_count: "0",
    invited_grant_count: "0",
    active_project_count: "0",
    drifted_project_count: "0"
  };

  return {
    generated_at: new Date().toISOString(),
    summary: {
      active_grant_count: Number(summaryRow.active_grant_count ?? "0"),
      invited_grant_count: Number(summaryRow.invited_grant_count ?? "0"),
      active_project_count: links.filter((link) => link.link_status === "linked" || link.link_status === "planned").length,
      drifted_project_count: links.filter((link) => link.link_status === "drifted").length,
      projects_missing_portal_links_count: Number(missingLinksResult.rows[0]?.missing_count ?? "0")
    },
    access_grants: grants,
    project_links: links,
    project_views: projectViews
  };
}

export function getMicrosoft365ClientPortalValidationIssues(): Microsoft365ClientPortalValidationIssue[] {
  const issues: Microsoft365ClientPortalValidationIssue[] = [];
  const environment = resolveEnvironment();

  try {
    loadBaseline(environment);
  } catch (error) {
    addIssue(issues, {
      area: "baseline",
      severity: "error",
      code: "phase7.baseline.unreadable",
      summary: "The Phase 7 Power Pages portal baseline could not be loaded.",
      details: {
        environment,
        message: error instanceof Error ? error.message : "Unknown baseline failure."
      }
    });
    return issues;
  }

  if (!config.MICROSOFT_365_CLIENT_PORTAL_ENABLED) {
    addIssue(issues, {
      area: "feature_flag",
      severity: environment === "production" ? "error" : "warning",
      code: "phase7.feature_disabled",
      summary: "The Power Pages client portal is disabled for this environment."
    });
  }

  if (!config.MICROSOFT_365_CLIENT_PORTAL_SITE_URL) {
    addIssue(issues, {
      area: "config",
      severity: "error",
      code: "phase7.portal_site_url.missing",
      summary: "Power Pages client portal requires MICROSOFT_365_CLIENT_PORTAL_SITE_URL."
    });
  }

  if (!config.MICROSOFT_365_CLIENT_PORTAL_AUTH_PROVIDER) {
    addIssue(issues, {
      area: "config",
      severity: "error",
      code: "phase7.auth_provider.missing",
      summary: "Power Pages client portal requires MICROSOFT_365_CLIENT_PORTAL_AUTH_PROVIDER."
    });
  } else if (config.MICROSOFT_365_CLIENT_PORTAL_AUTH_PROVIDER !== "entra_external_id") {
    addIssue(issues, {
      area: "authentication",
      severity: "error",
      code: "phase7.auth_provider.unsupported",
      summary: "Phase 7 only supports an Entra External ID invitation-based authentication model."
    });
  }

  if (!config.MICROSOFT_365_CLIENT_INTAKE_ENABLED) {
    addIssue(issues, {
      area: "client_intake",
      severity: "error",
      code: "phase7.client_intake.disabled",
      summary: "Power Pages client portal requires Phase 5 secure client intake to stay enabled."
    });
  }

  if (!config.MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED) {
    addIssue(issues, {
      area: "client_intake_operations",
      severity: environment === "production" ? "error" : "warning",
      code: "phase7.client_intake_operations.disabled",
      summary: "Power Pages client portal should run with Phase 6 operational control enabled so submission status and revision handling stay reliable."
    });
  }

  if (!config.MICROSOFT_365_MAIL_AUTOMATION_ENABLED) {
    addIssue(issues, {
      area: "mail_automation",
      severity: "error",
      code: "phase7.mail_automation.disabled",
      summary: "Power Pages client portal requires shared-mailbox mail automation for confirmations and help routing."
    });
  }

  if (!config.MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID) {
    addIssue(issues, {
      area: "config",
      severity: "error",
      code: "phase7.power_platform_environment_id.missing",
      summary: "Power Pages client portal requires MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID."
    });
  }

  if (!config.MICROSOFT_365_SHAREPOINT_ROOT_URL) {
    addIssue(issues, {
      area: "config",
      severity: "error",
      code: "phase7.sharepoint_root_url.missing",
      summary: "Power Pages client portal requires MICROSOFT_365_SHAREPOINT_ROOT_URL."
    });
  }

  if (!config.API_PUBLIC_URL || !config.ADMIN_WEB_URL) {
    addIssue(issues, {
      area: "config",
      severity: "error",
      code: "phase7.dashboard_urls.missing",
      summary: "Power Pages client portal requires both API_PUBLIC_URL and ADMIN_WEB_URL for backlink and support flows."
    });
  }

  if (!config.MICROSOFT_365_CLIENT_PORTAL_DEFAULT_HELP_MAILBOX_KEY) {
    addIssue(issues, {
      area: "support",
      severity: "error",
      code: "phase7.default_help_mailbox_key.missing",
      summary: "Power Pages client portal requires MICROSOFT_365_CLIENT_PORTAL_DEFAULT_HELP_MAILBOX_KEY."
    });
  }

  const prerequisiteErrors = [
    ...getMicrosoft365GovernanceValidationIssues(),
    ...getMicrosoft365OperatingSystemValidationIssues(),
    ...getMicrosoft365MailAutomationValidationIssues(),
    ...getMicrosoft365ClientIntakeValidationIssues(),
    ...getMicrosoft365ClientIntakeOperationalControlValidationIssues()
  ].filter((issue) => issue.severity === "error");

  if (prerequisiteErrors.length > 0) {
    addIssue(issues, {
      area: "prerequisites",
      severity: "error",
      code: "phase7.prerequisites.not_ready",
      summary: "One or more earlier Microsoft 365 phases still has blocking validation issues.",
      details: {
        blocking_issue_count: prerequisiteErrors.length
      }
    });
  }

  return issues;
}

export function assertMicrosoft365ClientPortalStartupConfig() {
  const issues = getMicrosoft365ClientPortalValidationIssues().filter((issue) => issue.severity === "error");
  if ((config.MICROSOFT_365_CLIENT_PORTAL_STRICT_VALIDATION || config.NODE_ENV === "production") && issues.length > 0) {
    throw new Error(
      `Microsoft 365 client portal startup validation failed: ${issues.map((issue) => `${issue.area}:${issue.code}`).join(", ")}`
    );
  }
}

export function getPublicMicrosoft365ClientPortalHealthSummary() {
  const issues = getMicrosoft365ClientPortalValidationIssues();
  return {
    baseline_environment: resolveEnvironment(),
    enabled: Boolean(config.MICROSOFT_365_CLIENT_PORTAL_ENABLED),
    site_url_configured: Boolean(config.MICROSOFT_365_CLIENT_PORTAL_SITE_URL),
    auth_provider: config.MICROSOFT_365_CLIENT_PORTAL_AUTH_PROVIDER || null,
    startup_valid: issues.every((issue) => issue.severity !== "error"),
    issue_count: issues.length,
    recommendation: determineRecommendation(issues)
  };
}

async function resolvePortalContext(
  client: PoolClient,
  tenantId: string,
  input: { organizationId?: string | null; contactId?: string | null; jobId?: string | null; externalEmail: string }
): Promise<{ organization_id: string; contact_id: string | null; job_id: string | null }> {
  if (input.jobId) {
    const { rows } = await client.query<{
      job_id: string;
      organization_id: string;
      contact_id: string | null;
    }>(
      `
        SELECT
          j.id::text AS job_id,
          j.organization_id::text AS organization_id,
          COALESCE($3::uuid, j.primary_contact_id)::text AS contact_id
        FROM jobs j
        WHERE j.tenant_id = $1
          AND j.id = $2::uuid
        LIMIT 1
      `,
      [tenantId, input.jobId, input.contactId ?? null]
    );
    if (!rows[0]) {
      throw new ApiError(404, "Job not found.");
    }
    return {
      organization_id: rows[0].organization_id,
      contact_id: rows[0].contact_id,
      job_id: rows[0].job_id
    };
  }

  if (!input.organizationId) {
    throw new ApiError(400, "Organization access grants require organization_id.");
  }

  const { rows } = await client.query<{ organization_id: string; contact_id: string | null }>(
    `
      SELECT
        org.id::text AS organization_id,
        contact.id::text AS contact_id
      FROM organization org
      LEFT JOIN organization_contact contact
        ON contact.tenant_id = org.tenant_id
       AND contact.organization_id = org.id
       AND lower(contact.email) = lower($3)
      WHERE org.tenant_id = $1
        AND org.id = $2::uuid
      LIMIT 1
    `,
    [tenantId, input.organizationId, input.externalEmail]
  );

  if (!rows[0]) {
    throw new ApiError(404, "Organization not found.");
  }
  return {
    organization_id: rows[0].organization_id,
    contact_id: rows[0].contact_id,
    job_id: null
  };
}

export async function listMicrosoft365ClientPortalAccessGrants(
  client: PoolClient,
  auth: AuthUser,
  input: {
    organizationId?: string | null;
    jobId?: string | null;
    accessStatus?: Microsoft365ClientPortalAccessStatus | null;
    limit?: number;
  } = {}
) {
  assertReadAccess(auth);
  if (!(await hasPhase7Schema(client))) {
    return { generated_at: new Date().toISOString(), grants: [] as Microsoft365ClientPortalAccessGrantRecord[] };
  }
  const grants = await listPortalAccessGrantRows(client, auth.tenantId, input);
  return { generated_at: new Date().toISOString(), grants };
}

export async function listMicrosoft365ClientPortalProjectLinks(
  client: PoolClient,
  auth: AuthUser,
  input: {
    organizationId?: string | null;
    jobId?: string | null;
    linkStatus?: Microsoft365ClientPortalLinkStatus | null;
    limit?: number;
  } = {}
) {
  assertReadAccess(auth);
  if (!(await hasPhase7Schema(client))) {
    return { generated_at: new Date().toISOString(), project_links: [] as Microsoft365ClientPortalProjectLinkRecord[] };
  }
  const project_links = await listPortalProjectLinkRows(client, auth.tenantId, input);
  return { generated_at: new Date().toISOString(), project_links };
}

export async function upsertMicrosoft365ClientPortalAccessGrant(
  client: PoolClient,
  auth: AuthUser,
  input: UpsertMicrosoft365ClientPortalAccessGrantInput
) {
  assertManageAccess(auth);
  if (!config.MICROSOFT_365_CLIENT_PORTAL_ENABLED) {
    throw new ApiError(503, "Microsoft 365 client portal is disabled in this environment.");
  }
  if (!(await hasPhase7Schema(client))) {
    throw new ApiError(503, "Phase 7 client portal schema is not available in this environment.");
  }

  const accessScope = accessScopeSchema.parse(input.access_scope);
  const accessStatus = accessStatusSchema.parse(input.access_status ?? "invited");
  const authProvider = authProviderSchema.parse(input.external_identity_provider ?? "entra_external_id");
  const externalEmail = input.external_email.trim().toLowerCase();
  const context = await resolvePortalContext(client, auth.tenantId, {
    organizationId: input.organization_id ?? null,
    contactId: input.contact_id ?? null,
    jobId: accessScope === "job" ? (input.job_id ?? null) : null,
    externalEmail
  });

  const { rows: existingRows } = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM microsoft_client_portal_access_grant
      WHERE tenant_id = $1
        AND access_scope = $2::microsoft_client_portal_access_scope
        AND organization_id = $3::uuid
        AND lower(external_email) = lower($4)
        AND (
          ($2::microsoft_client_portal_access_scope = 'organization'::microsoft_client_portal_access_scope AND job_id IS NULL)
          OR ($2::microsoft_client_portal_access_scope = 'job'::microsoft_client_portal_access_scope AND job_id = $5::uuid)
        )
      LIMIT 1
    `,
    [auth.tenantId, accessScope, context.organization_id, externalEmail, context.job_id ?? null]
  );

  const metadata = input.metadata ?? {};
  const roleKeys = normalizeStringArray(input.power_pages_web_role_keys);
  const externalIdentitySubject = input.external_identity_subject?.trim() || null;
  const powerPagesContactId = input.power_pages_contact_id?.trim() || null;
  let grantId = existingRows[0]?.id ?? null;

  if (grantId) {
    await client.query(
      `
        UPDATE microsoft_client_portal_access_grant
        SET
          contact_id = $3::uuid,
          job_id = $4::uuid,
          access_status = $5::microsoft_client_portal_access_status,
          external_identity_provider = $6::microsoft_client_portal_auth_provider,
          external_identity_subject = $7,
          power_pages_contact_id = $8,
          power_pages_web_role_keys = $9::text[],
          metadata = $10::jsonb,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2::uuid
      `,
      [
        auth.tenantId,
        grantId,
        input.contact_id ?? context.contact_id ?? null,
        accessScope === "job" ? context.job_id : null,
        accessStatus,
        authProvider,
        externalIdentitySubject,
        powerPagesContactId,
        roleKeys,
        JSON.stringify(metadata)
      ]
    );
  } else {
    const { rows } = await client.query<{ id: string }>(
      `
        INSERT INTO microsoft_client_portal_access_grant (
          tenant_id,
          organization_id,
          contact_id,
          job_id,
          access_scope,
          access_status,
          external_email,
          external_identity_provider,
          external_identity_subject,
          power_pages_contact_id,
          power_pages_web_role_keys,
          invited_by_user_id,
          metadata
        )
        VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5::microsoft_client_portal_access_scope,$6::microsoft_client_portal_access_status,$7,$8::microsoft_client_portal_auth_provider,$9,$10,$11::text[],$12::uuid,$13::jsonb)
        RETURNING id::text
      `,
      [
        auth.tenantId,
        context.organization_id,
        input.contact_id ?? context.contact_id ?? null,
        accessScope === "job" ? context.job_id : null,
        accessScope,
        accessStatus,
        externalEmail,
        authProvider,
        externalIdentitySubject,
        powerPagesContactId,
        roleKeys,
        auth.id,
        JSON.stringify(metadata)
      ]
    );
    grantId = rows[0]?.id ?? null;
  }

  if (!grantId) {
    throw new ApiError(500, "Unable to create or update the client portal access grant.");
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "integration.microsoft365_client_portal.access_grant.upserted",
    entityType: "microsoft_client_portal_access_grant",
    entityId: grantId,
    metadata: {
      organization_id: context.organization_id,
      job_id: accessScope === "job" ? context.job_id : null,
      access_scope: accessScope,
      access_status: accessStatus,
      external_email: externalEmail
    }
  });

  const grants = await listPortalAccessGrantRows(client, auth.tenantId, {
    organizationId: context.organization_id,
    jobId: accessScope === "job" ? context.job_id : null,
    limit: 20
  });
  const grant = grants.find((entry) => entry.id === grantId);
  return {
    access_grant_id: grantId,
    grant: grant ?? null
  };
}

export async function upsertMicrosoft365ClientPortalProjectLink(
  client: PoolClient,
  auth: AuthUser,
  input: UpsertMicrosoft365ClientPortalProjectLinkInput
) {
  assertManageAccess(auth);
  if (!config.MICROSOFT_365_CLIENT_PORTAL_ENABLED) {
    throw new ApiError(503, "Microsoft 365 client portal is disabled in this environment.");
  }
  if (!(await hasPhase7Schema(client))) {
    throw new ApiError(503, "Phase 7 client portal schema is not available in this environment.");
  }

  const { rows: jobRows } = await client.query<{
    job_id: string;
    organization_id: string | null;
  }>(
    `
      SELECT
        id::text AS job_id,
        organization_id::text
      FROM jobs
      WHERE tenant_id = $1
        AND id = $2::uuid
      LIMIT 1
    `,
    [auth.tenantId, input.job_id]
  );
  const job = jobRows[0];
  if (!job || !job.organization_id) {
    throw new ApiError(404, "Job not found or missing organization context.");
  }

  const linkStatus = linkStatusSchema.parse(input.link_status ?? "planned");
  const siteKey = input.power_pages_site_key?.trim() || "client-portal";
  const metadata = input.metadata ?? {};
  const canonicalDashboardId = buildMicrosoft365CanonicalDashboardId("job", job.job_id);

  await client.query(
    `
      INSERT INTO microsoft_client_portal_project_link (
        tenant_id,
        organization_id,
        job_id,
        canonical_dashboard_id,
        power_pages_site_key,
        portal_project_key,
        overview_page_url,
        required_items_page_url,
        upload_page_url,
        submission_history_page_url,
        help_page_url,
        link_status,
        metadata,
        created_by_user_id,
        last_synced_at,
        last_sync_error
      )
      VALUES ($1,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12::microsoft_client_portal_link_status,$13::jsonb,$14::uuid,CASE WHEN $12::microsoft_client_portal_link_status = 'linked'::microsoft_client_portal_link_status THEN now() ELSE NULL END,NULL)
      ON CONFLICT (tenant_id, job_id)
      DO UPDATE SET
        canonical_dashboard_id = EXCLUDED.canonical_dashboard_id,
        power_pages_site_key = EXCLUDED.power_pages_site_key,
        portal_project_key = EXCLUDED.portal_project_key,
        overview_page_url = EXCLUDED.overview_page_url,
        required_items_page_url = EXCLUDED.required_items_page_url,
        upload_page_url = EXCLUDED.upload_page_url,
        submission_history_page_url = EXCLUDED.submission_history_page_url,
        help_page_url = EXCLUDED.help_page_url,
        link_status = EXCLUDED.link_status,
        metadata = EXCLUDED.metadata,
        created_by_user_id = EXCLUDED.created_by_user_id,
        last_synced_at = CASE WHEN EXCLUDED.link_status = 'linked'::microsoft_client_portal_link_status THEN now() ELSE microsoft_client_portal_project_link.last_synced_at END,
        last_sync_error = NULL,
        updated_at = now()
    `,
    [
      auth.tenantId,
      job.organization_id,
      job.job_id,
      canonicalDashboardId,
      siteKey,
      input.portal_project_key.trim(),
      input.overview_page_url ?? null,
      input.required_items_page_url ?? null,
      input.upload_page_url ?? null,
      input.submission_history_page_url ?? null,
      input.help_page_url ?? null,
      linkStatus,
      JSON.stringify(metadata),
      auth.id
    ]
  );

  const link = (await listPortalProjectLinkRows(client, auth.tenantId, { jobId: job.job_id, limit: 1 }))[0] ?? null;

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "integration.microsoft365_client_portal.project_link.upserted",
    entityType: "microsoft_client_portal_project_link",
    entityId: link?.id ?? job.job_id,
    metadata: {
      job_id: job.job_id,
      organization_id: job.organization_id,
      link_status: linkStatus,
      power_pages_site_key: siteKey
    }
  });

  return {
    project_link_id: link?.id ?? null,
    link
  };
}

export async function getMicrosoft365ClientPortalWorkspace(
  client: PoolClient,
  auth: AuthUser
): Promise<Microsoft365ClientPortalWorkspace> {
  assertReadAccess(auth);
  if (!(await hasPhase7Schema(client))) {
    return {
      generated_at: new Date().toISOString(),
      summary: {
        active_grant_count: 0,
        invited_grant_count: 0,
        active_project_count: 0,
        drifted_project_count: 0,
        projects_missing_portal_links_count: 0
      },
      access_grants: [],
      project_links: [],
      project_views: []
    };
  }
  return buildWorkspace(client, auth.tenantId);
}

export async function getMicrosoft365ClientPortalDiagnostics(
  client: PoolClient,
  auth: AuthUser
): Promise<Microsoft365ClientPortalDiagnosticsResponse> {
  assertReadAccess(auth);
  const baselineEnvironment = resolveEnvironment();
  const baseline = loadBaseline(baselineEnvironment);
  const issues = getMicrosoft365ClientPortalValidationIssues();
  const schemaReady = await hasPhase7Schema(client);
  const workspace = schemaReady
    ? await buildWorkspace(client, auth.tenantId)
    : {
        generated_at: new Date().toISOString(),
        summary: {
          active_grant_count: 0,
          invited_grant_count: 0,
          active_project_count: 0,
          drifted_project_count: 0,
          projects_missing_portal_links_count: 0
        },
        access_grants: [],
        project_links: [],
        project_views: []
      };

  const diagnosticsIssues = schemaReady
    ? issues
    : [
        ...issues,
        {
          area: "schema",
          severity: "error",
          code: "phase7.schema.missing",
          summary: "Phase 7 client portal schema is not available in this environment."
        } satisfies Microsoft365ClientPortalValidationIssue
      ];

  return {
    generated_at: new Date().toISOString(),
    baseline_environment: baselineEnvironment,
    phase_one_portal_mvp: getMicrosoft365ClientPortalPhaseOneMvpDefinition(),
    startup_validation: {
      valid: diagnosticsIssues.every((issue) => issue.severity !== "error"),
      issues: diagnosticsIssues
    },
    phase_audit_summary: {
      implementation_status: "implemented_as_dashboard_first_power_pages_contract",
      current_state:
        "Phases 5 and 6 already handled secure uploads, submission history, reviewer decisions, and escalation. Phase 7 adds portal information architecture, external access grants, project scoping, portal-safe data projections, and Power Pages supportability without moving workflow truth out of the dashboard.",
      recommendation: determineRecommendation(diagnosticsIssues)
    },
    current_state_findings: buildCurrentStateFindings(),
    refactor_first: buildRefactorFirst(),
    portal_information_architecture: baseline.portal_information_architecture,
    authentication_model: baseline.authentication_model,
    scoping_rules: baseline.scoping_rules,
    ui_specification: baseline.ui_specification,
    data_integration: baseline.data_integration,
    support_model: baseline.support_model,
    execution_order: baseline.execution_order,
    configuration_artifacts: ARTIFACTS,
    governance_docs: DOCS,
    manual_admin_checklist: baseline.manual_admin_checklist,
    validation_checklist: baseline.validation_checklist,
    rollback_principles: baseline.rollback_principles,
    workspace
  };
}
