import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { config } from "../config.js";
import type {
  Microsoft365OperatingSystemArtifact,
  Microsoft365OperatingSystemBaseline,
  Microsoft365OperatingSystemCurrentStateFinding,
  Microsoft365OperatingSystemDepartmentKey,
  Microsoft365OperatingSystemDiagnosticsResponse,
  Microsoft365OperatingSystemDocReference,
  Microsoft365OperatingSystemEnvironment,
  Microsoft365OperatingSystemGoNoGo,
  Microsoft365OperatingSystemRefactorItem,
  Microsoft365OperatingSystemValidationIssue
} from "../types/microsoft365OperatingSystem.js";
import { resolveApiRepoPath } from "../utils/repoPaths.js";
import { getMicrosoft365GovernanceValidationIssues } from "./microsoft365Governance.js";
import { getMicrosoftIntegrationFeatureFlags } from "./microsoftIntegrationObservability.js";

const operatingSystemEnvironmentSchema = z.enum(["development", "staging", "production"]);
const departmentKeySchema = z.enum([
  "schools",
  "sports",
  "production",
  "customer_service",
  "sales",
  "leadership",
  "it_systems"
]);
const channelKeySchema = z.enum([
  "general",
  "active_projects",
  "escalations",
  "templates_sops",
  "automation_alerts",
  "approvals"
]);

const baselineSchema = z.object({
  phase: z.literal("phase2_internal_microsoft_operating_system"),
  baseline_version: z.string().trim().min(1),
  environment: operatingSystemEnvironmentSchema,
  tenant_tier: z.enum(["sandbox", "preproduction", "production"]),
  supported_departments: z.array(departmentKeySchema).min(1),
  workspace_settings: z.object({
    workspace_name_prefix: z.string().trim().min(1),
    team_name_pattern: z.string().trim().min(1),
    sharepoint_site_path_pattern: z.string().trim().min(1),
    planner_plan_name_pattern: z.string().trim().min(1),
    default_team_visibility: z.literal("private"),
    dashboard_source_of_truth_rule: z.string().trim().min(1),
    read_only_mirror_fields_rule: z.string().trim().min(1)
  }),
  department_workspaces: z.array(
    z.object({
      department_key: departmentKeySchema,
      department_label: z.string().trim().min(1),
      team_name: z.string().trim().min(1),
      mail_nickname: z.string().trim().min(1),
      sharepoint_site_path: z.string().trim().min(1),
      planner_plan_name: z.string().trim().min(1),
      owner_groups: z.array(z.string().trim().min(1)).min(1),
      member_groups: z.array(z.string().trim().min(1)).min(1),
      channels: z.array(
        z.object({
          key: channelKeySchema,
          name: z.string().trim().min(1),
          membership_type: z.literal("standard"),
          purpose: z.string().trim().min(1)
        })
      ).min(1)
    })
  ).min(1),
  sharepoint_architecture: z.object({
    site_strategy: z.string().trim().min(1),
    hub_site_url: z.string().trim().url(),
    libraries: z.array(
      z.object({
        key: z.string().trim().min(1),
        name: z.string().trim().min(1),
        purpose: z.string().trim().min(1),
        default_folder_pattern: z.string().trim().min(1),
        metadata_columns: z.array(
          z.object({
            internal_name: z.string().trim().min(1),
            display_name: z.string().trim().min(1),
            field_type: z.string().trim().min(1),
            required: z.boolean(),
            dashboard_source_field: z.string().trim().min(1),
            notes: z.string().trim().min(1)
          })
        ).min(1)
      })
    ).min(1)
  }),
  lists: z.array(
    z.object({
      key: z.string().trim().min(1),
      name: z.string().trim().min(1),
      purpose: z.string().trim().min(1),
      read_only_mirror: z.boolean(),
      fields: z.array(
        z.object({
          internal_name: z.string().trim().min(1),
          display_name: z.string().trim().min(1),
          field_type: z.string().trim().min(1),
          required: z.boolean(),
          dashboard_source_field: z.string().trim().min(1),
          read_only_mirror: z.boolean(),
          notes: z.string().trim().min(1)
        })
      ).min(1)
    })
  ).min(1),
  planner: z.object({
    plan_strategy: z.string().trim().min(1),
    task_source_rule: z.string().trim().min(1),
    ownership_rule: z.string().trim().min(1),
    completion_rule: z.string().trim().min(1),
    buckets: z.array(
      z.object({
        key: z.string().trim().min(1),
        name: z.string().trim().min(1),
        purpose: z.string().trim().min(1)
      })
    ).min(1)
  }),
  teams_tabs: z.object({
    channel_defaults: z.array(
      z.object({
        channel_key: channelKeySchema,
        channel_name: z.string().trim().min(1),
        tabs: z.array(
          z.object({
            title: z.string().trim().min(1),
            tab_type: z.enum(["website", "document_library", "list", "planner", "files"]),
            target: z.string().trim().min(1),
            dashboard_deep_link: z.string().trim().min(1).nullable().optional(),
            notes: z.string().trim().min(1)
          })
        ).min(1)
      })
    ).min(1),
    dashboard_deep_links: z.array(
      z.object({
        label: z.string().trim().min(1),
        route_hash: z.string().trim().min(1),
        usage: z.string().trim().min(1)
      })
    ).min(1)
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

const DOCS: Microsoft365OperatingSystemDocReference[] = [
  {
    key: "phase_summary",
    title: "Phase 2 Internal Microsoft Operating System",
    path: "docs/microsoft365/phase2-internal-microsoft-operating-system.md",
    summary: "Primary phase audit, reusable workspace topology, rollout order, and recommendation for the next phase."
  },
  {
    key: "teams_information_architecture",
    title: "Teams Information Architecture",
    path: "docs/microsoft365/teams-information-architecture.md",
    summary: "Department team model, standard channels, tabs, and dashboard deep-link posture."
  },
  {
    key: "sharepoint_information_architecture",
    title: "SharePoint Information Architecture",
    path: "docs/microsoft365/sharepoint-information-architecture.md",
    summary: "Team-connected site model, library patterns, metadata columns, and document rules."
  },
  {
    key: "lists_schema",
    title: "Microsoft Lists Schema",
    path: "docs/microsoft365/microsoft-lists-schema.md",
    summary: "Read-only mirror lists for projects, required items, contacts, approvals, and communication events."
  },
  {
    key: "planner_structure",
    title: "Planner Structure and Ownership Model",
    path: "docs/microsoft365/planner-structure.md",
    summary: "Department plan buckets, ownership rules, and dashboard-first task handling."
  }
];

const ARTIFACTS: Microsoft365OperatingSystemArtifact[] = [
  {
    kind: "baseline",
    path: "ops/microsoft365/phase2/operating-system-baseline.development.json",
    summary: "Development department workspace baseline for sandbox Microsoft operating system rollout.",
    tenant_admin_action: false
  },
  {
    kind: "baseline",
    path: "ops/microsoft365/phase2/operating-system-baseline.staging.json",
    summary: "Staging workspace baseline for pilot provisioning and structure validation.",
    tenant_admin_action: false
  },
  {
    kind: "baseline",
    path: "ops/microsoft365/phase2/operating-system-baseline.production.json",
    summary: "Production workspace baseline with final department naming and site topology.",
    tenant_admin_action: false
  },
  {
    kind: "script",
    path: "ops/microsoft365/phase2/Test-M365OperatingSystemBaseline.ps1",
    summary: "Non-destructive validation script for Phase 2 workspace topology and environment configuration.",
    tenant_admin_action: true
  },
  {
    kind: "script",
    path: "ops/microsoft365/phase2/Get-M365DepartmentWorkspacePlan.ps1",
    summary: "Reusable department workspace planning script that renders the exact team, site, list, planner, and tab plan for a department.",
    tenant_admin_action: false
  },
  {
    kind: "api",
    path: "GET /api/admin/system/microsoft-operating-system",
    summary: "Admin diagnostics payload for the Phase 2 internal Microsoft operating system baseline.",
    tenant_admin_action: false
  }
];

function resolveEnvironment(): Microsoft365OperatingSystemEnvironment {
  if (config.MICROSOFT_365_OPERATING_SYSTEM_ENV) {
    return config.MICROSOFT_365_OPERATING_SYSTEM_ENV;
  }
  if (config.NODE_ENV === "production") {
    return "production";
  }
  return "development";
}

function getBaselinePath(environment: Microsoft365OperatingSystemEnvironment) {
  return resolveApiRepoPath("ops", "microsoft365", "phase2", `operating-system-baseline.${environment}.json`);
}

function loadBaseline(environment = resolveEnvironment()): Microsoft365OperatingSystemBaseline {
  const raw = readFileSync(getBaselinePath(environment), "utf8");
  const parsed = baselineSchema.parse(JSON.parse(raw));
  if (parsed.environment !== environment) {
    throw new Error(`Microsoft 365 operating system baseline environment mismatch: expected ${environment}, found ${parsed.environment}.`);
  }
  return parsed;
}

function addIssue(
  issues: Microsoft365OperatingSystemValidationIssue[],
  input: Microsoft365OperatingSystemValidationIssue
) {
  issues.push(input);
}

function safeParseHost(value: string) {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

function buildCurrentStateFindings(): Microsoft365OperatingSystemCurrentStateFinding[] {
  return [
    {
      key: "dashboard_source_of_truth",
      state: "existing",
      summary: "The dashboard already owns jobs, tasks, approvals, workflow state, and operational communications, which is the correct source-of-truth posture for Microsoft workspace mirrors.",
      evidence: [
        "packages/api/src/services/jobTruth/jobService.ts",
        "packages/api/src/services/jobTruth/workTaskService.ts",
        "packages/api/src/services/operationalApprovals.ts"
      ]
    },
    {
      key: "teams_runtime_foundation",
      state: "existing",
      summary: "Teams messaging, meetings, deep links, and the Teams app package already exist, so Phase 2 can reuse real Teams seams instead of inventing them.",
      evidence: [
        "packages/api/src/services/teamsMessaging.ts",
        "packages/api/src/services/teamsMeetings.ts",
        "packages/api/src/services/microsoftTeamsLinks.ts",
        "teams/appPackage/manifest.json"
      ]
    },
    {
      key: "document_link_provider_alignment",
      state: "partial",
      summary: "Record resources already classify SharePoint and OneDrive links, which is useful alignment, but there is not yet a governed workspace/site/list architecture behind those links.",
      evidence: [
        "packages/api/src/routes/recordResources.ts",
        "packages/api/src/services/recordResources.ts"
      ],
      recommended_refactor: "Keep Phase 2 workspace sites and libraries aligned to the existing record-resources provider model instead of introducing a second document abstraction."
    },
    {
      key: "sharepoint_lists_planner_topology",
      state: "missing",
      summary: "There was no version-controlled Teams department topology, SharePoint site/library plan, Microsoft Lists schema, or Planner bucket template before this phase.",
      evidence: [
        "packages/api/src/services/microsoft365Governance.ts",
        "packages/api/src/services/microsoftIntegrationObservability.ts"
      ],
      recommended_refactor: "Provision through reusable workspace templates only; do not let individual departments improvise sites, lists, or plan structures."
    },
    {
      key: "personal_app_only_teams_surface",
      state: "conflict",
      summary: "The current Teams app package is personal-app focused. That works for discovery and communication entry points, but department collaboration channels and tabs need a formal workspace information architecture.",
      evidence: [
        "teams/appPackage/manifest.json"
      ],
      recommended_refactor: "Treat the personal app as an entry point and standardize department channel tabs separately through the workspace baseline."
    }
  ];
}

function buildRefactorFirst(): Microsoft365OperatingSystemRefactorItem[] {
  return [
    {
      key: "mirror_boundary_enforcement",
      severity: "high",
      summary: "Keep Microsoft Lists and Planner as dashboard-linked mirrors and coordination surfaces only.",
      consequence: "If Lists or Planner gain independent lifecycle truth, project state will drift and operators will not know which system to trust."
    },
    {
      key: "resource_library_alignment",
      severity: "medium",
      summary: "Align SharePoint and OneDrive workspace links with the existing record-resources service rather than adding another file-link system.",
      consequence: "A second document-link abstraction would duplicate permissions, confuse users, and fragment audit history."
    },
    {
      key: "department_workspace_standardization",
      severity: "high",
      summary: "Provision department workspaces from one reusable baseline instead of department-by-department manual patterns.",
      consequence: "One-off team/site/list setups will create governance drift, broken automation assumptions, and inconsistent navigation."
    },
    {
      key: "read_only_lifecycle_mirrors",
      severity: "high",
      summary: "Only mirror lifecycle/status/due-date fields into Lists or Planner when they are explicitly read-only and sourced from the dashboard.",
      consequence: "Editable duplicate lifecycle columns will create hidden conflicts with the dashboard’s workflow engine."
    }
  ];
}

export function getMicrosoft365OperatingSystemValidationIssues(): Microsoft365OperatingSystemValidationIssue[] {
  const issues: Microsoft365OperatingSystemValidationIssue[] = [];
  const environment = resolveEnvironment();
  let baseline: Microsoft365OperatingSystemBaseline | null = null;

  try {
    baseline = loadBaseline(environment);
  } catch (error) {
    addIssue(issues, {
      area: "baseline",
      severity: "error",
      code: "baseline.file_invalid",
      summary: "The Phase 2 Microsoft operating system baseline file is missing or invalid for the active environment.",
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
      summary: "Phase 1 Microsoft security and governance validation still has blocking issues. Phase 2 workspace rollout should not proceed until Phase 1 is clean.",
      details: {
        issue_codes: governanceErrors.map((issue) => issue.code)
      }
    });
  }

  if (!config.MICROSOFT_365_TENANT_PRIMARY_DOMAIN) {
    addIssue(issues, {
      area: "tenant",
      severity: "error",
      code: "tenant.primary_domain.missing",
      summary: "MICROSOFT_365_TENANT_PRIMARY_DOMAIN is required for Phase 2 naming, site ownership, and list/planner provisioning consistency."
    });
  }

  if (!config.MICROSOFT_365_SHAREPOINT_ROOT_URL) {
    addIssue(issues, {
      area: "sharepoint",
      severity: "error",
      code: "sharepoint.root_url.missing",
      summary: "MICROSOFT_365_SHAREPOINT_ROOT_URL is required to validate the Phase 2 SharePoint site and library topology."
    });
  }

  if (!config.MICROSOFT_365_SHAREPOINT_HUB_SITE_URL) {
    addIssue(issues, {
      area: "sharepoint",
      severity: "error",
      code: "sharepoint.hub_site_url.missing",
      summary: "MICROSOFT_365_SHAREPOINT_HUB_SITE_URL is required to anchor the department workspace sites under one governed hub."
    });
  }

  if (!config.MICROSOFT_365_WORKSPACE_NAME_PREFIX) {
    addIssue(issues, {
      area: "workspace_naming",
      severity: "error",
      code: "workspace_naming.prefix.missing",
      summary: "MICROSOFT_365_WORKSPACE_NAME_PREFIX is required so team, site, and Planner names stay environment-aware and consistent."
    });
  } else if (config.MICROSOFT_365_WORKSPACE_NAME_PREFIX !== baseline.workspace_settings.workspace_name_prefix) {
    addIssue(issues, {
      area: "workspace_naming",
      severity: "warning",
      code: "workspace_naming.prefix.mismatch",
      summary: "Configured workspace prefix does not match the version-controlled Phase 2 baseline for this environment.",
      details: {
        configured_prefix: config.MICROSOFT_365_WORKSPACE_NAME_PREFIX,
        baseline_prefix: baseline.workspace_settings.workspace_name_prefix
      }
    });
  }

  const rootHost = safeParseHost(config.MICROSOFT_365_SHAREPOINT_ROOT_URL);
  const hubHost = safeParseHost(config.MICROSOFT_365_SHAREPOINT_HUB_SITE_URL);
  if (rootHost && hubHost && rootHost !== hubHost) {
    addIssue(issues, {
      area: "sharepoint",
      severity: "error",
      code: "sharepoint.hub_host.mismatch",
      summary: "The SharePoint hub site URL does not belong to the configured SharePoint root host.",
      details: {
        sharepoint_root_host: rootHost,
        sharepoint_hub_host: hubHost
      }
    });
  }

  if (!config.ADMIN_WEB_URL) {
    addIssue(issues, {
      area: "teams_tabs",
      severity: "error",
      code: "teams_tabs.admin_web_url.missing",
      summary: "ADMIN_WEB_URL is required for the Phase 2 Teams tabs and dashboard deep-link design."
    });
  }

  const microsoftFlags = getMicrosoftIntegrationFeatureFlags();
  if (!microsoftFlags.auth_enabled) {
    addIssue(issues, {
      area: "identity",
      severity: environment === "production" ? "error" : "warning",
      code: "identity.entra_auth.disabled",
      summary: "Microsoft Entra auth is not enabled. Phase 2 workspace rollout expects Microsoft identity-backed access."
    });
  }

  if (!microsoftFlags.teams_personal_app_enabled) {
    addIssue(issues, {
      area: "teams_app",
      severity: "warning",
      code: "teams_app.personal_app.disabled",
      summary: "Teams personal app embedding is disabled. Department channel tabs can still work, but dashboard quick-open patterns will be reduced."
    });
  }

  if (config.MICROSOFT_365_OPERATING_SYSTEM_ENV && config.NODE_ENV === "production" && config.MICROSOFT_365_OPERATING_SYSTEM_ENV !== "production") {
    addIssue(issues, {
      area: "baseline",
      severity: "error",
      code: "baseline.environment_mismatch",
      summary: "Production runtime must not point at a non-production Phase 2 workspace baseline.",
      details: {
        configured_environment: config.MICROSOFT_365_OPERATING_SYSTEM_ENV
      }
    });
  }

  return issues;
}

export function assertMicrosoft365OperatingSystemStartupConfig() {
  const issues = getMicrosoft365OperatingSystemValidationIssues();
  const errors = issues.filter((issue) => issue.severity === "error");
  if ((config.MICROSOFT_365_OPERATING_SYSTEM_STRICT_VALIDATION || config.NODE_ENV === "production") && errors.length > 0) {
    throw new Error(
      `Microsoft 365 operating system startup validation failed: ${errors.map((issue) => `${issue.area}:${issue.code}`).join(", ")}`
    );
  }
}

export function getPublicMicrosoft365OperatingSystemHealthSummary() {
  const issues = getMicrosoft365OperatingSystemValidationIssues();
  const baselineEnvironment = resolveEnvironment();
  const recommendation = issues.some((issue) => issue.severity === "error")
    ? "no_go"
    : issues.length > 0
      ? "conditional_go"
      : "go";

  let departments: Microsoft365OperatingSystemDepartmentKey[] = [];
  try {
    departments = loadBaseline(baselineEnvironment).supported_departments;
  } catch {
    departments = [];
  }

  return {
    baseline_environment: baselineEnvironment,
    startup_valid: issues.every((issue) => issue.severity !== "error"),
    issue_count: issues.length,
    supported_departments: departments,
    recommendation
  };
}

function determineRecommendation(issues: Microsoft365OperatingSystemValidationIssue[]): Microsoft365OperatingSystemGoNoGo {
  if (issues.some((issue) => issue.severity === "error")) {
    return "no_go";
  }
  if (issues.length > 0) {
    return "conditional_go";
  }
  return "go";
}

export function getMicrosoft365OperatingSystemDiagnostics(): Microsoft365OperatingSystemDiagnosticsResponse {
  const baselineEnvironment = resolveEnvironment();
  const baseline = loadBaseline(baselineEnvironment);
  const issues = getMicrosoft365OperatingSystemValidationIssues();
  const recommendation = determineRecommendation(issues);

  return {
    generated_at: new Date().toISOString(),
    baseline_environment: baselineEnvironment,
    startup_validation: {
      valid: issues.every((issue) => issue.severity !== "error"),
      issues
    },
    phase_audit_summary: {
      implementation_status: "implemented_as_version_controlled_workspace_baseline",
      current_state:
        "Teams runtime and document-link seams already existed, but department workspace topology, SharePoint site architecture, Microsoft Lists mirrors, and Planner templates were not version-controlled before this phase.",
      recommendation
    },
    current_state_findings: buildCurrentStateFindings(),
    refactor_first: buildRefactorFirst(),
    teams_information_architecture: {
      supported_departments: baseline.department_workspaces,
      standard_channel_layout: baseline.department_workspaces[0]?.channels ?? []
    },
    sharepoint_information_architecture: baseline.sharepoint_architecture,
    lists_schema: baseline.lists,
    planner_structure: baseline.planner,
    teams_tabs_and_navigation: baseline.teams_tabs,
    naming_conventions: baseline.workspace_settings,
    execution_order: baseline.execution_order,
    configuration_artifacts: ARTIFACTS,
    governance_docs: DOCS,
    manual_admin_checklist: baseline.manual_admin_checklist,
    validation_checklist: baseline.validation_checklist,
    rollback_principles: baseline.rollback_principles
  };
}
