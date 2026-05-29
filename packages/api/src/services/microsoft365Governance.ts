import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { config } from "../config.js";
import type {
  Microsoft365GovernanceArtifact,
  Microsoft365GovernanceBaseline,
  Microsoft365GovernanceCurrentStateFinding,
  Microsoft365GovernanceDiagnosticsResponse,
  Microsoft365GovernanceDocReference,
  Microsoft365GovernanceEnvironment,
  Microsoft365GovernanceGoNoGo,
  Microsoft365GovernanceSecurityGap,
  Microsoft365GovernanceValidationIssue
} from "../types/microsoft365Governance.js";
import { resolveApiRepoPath } from "../utils/repoPaths.js";
import { getMicrosoftIntegrationFeatureFlags } from "./microsoftIntegrationObservability.js";

const governanceEnvironmentSchema = z.enum(["development", "staging", "production"]);
const governancePersonaSchema = z.enum([
  "platform_admin",
  "security_admin",
  "department_lead",
  "project_owner",
  "reviewer",
  "staff",
  "external_user"
]);

const governanceBaselineSchema = z.object({
  phase: z.literal("phase1_security_governance_foundation"),
  baseline_version: z.string().min(1),
  environment: governanceEnvironmentSchema,
  tenant_tier: z.enum(["sandbox", "preproduction", "production"]),
  principal_settings: z.object({
    group_prefix: z.string().trim().min(1),
    require_managed_devices_for_admin_portals: z.boolean(),
    require_phishing_resistant_mfa_for_admins: z.boolean(),
    sharepoint_external_sharing_mode: z.string().trim().min(1),
    onedrive_external_sharing_mode: z.string().trim().min(1),
    power_automate_managed_environment_required: z.boolean()
  }),
  current_state_targets: z.object({
    enforce_entra_auth_for_admins: z.boolean(),
    permit_local_password_for_break_glass_only: z.boolean(),
    tenant_admin_actions_required: z.boolean()
  }),
  execution_order: z.array(
    z.object({
      order: z.number().int().positive(),
      title: z.string().trim().min(1),
      owner: z.string().trim().min(1),
      requires_tenant_admin: z.boolean(),
      rollback: z.string().trim().min(1)
    })
  ),
  permissions_matrix: z.array(
    z.object({
      persona: governancePersonaSchema,
      dashboard_access: z.array(z.string().trim().min(1)),
      m365_admin_roles: z.array(z.string().trim().min(1)),
      allowed_actions: z.array(z.string().trim().min(1)),
      restrictions: z.array(z.string().trim().min(1))
    })
  ),
  governance_models: z.object({
    shared_mailboxes: z.array(z.string().trim().min(1)),
    external_sharing: z.array(z.string().trim().min(1)),
    sensitivity_labels: z.array(z.string().trim().min(1)),
    audit_and_retention: z.array(z.string().trim().min(1)),
    automation_ownership: z.array(z.string().trim().min(1))
  }),
  manual_admin_checklist: z.array(
    z.object({
      order: z.number().int().positive(),
      step: z.string().trim().min(1),
      portal: z.string().trim().min(1).nullable(),
      requires_tenant_admin: z.boolean(),
      owner: z.string().trim().min(1)
    })
  ),
  validation_checklist: z.array(z.string().trim().min(1)),
  rollback_principles: z.array(z.string().trim().min(1))
});

const GOVERNANCE_DOCS: Microsoft365GovernanceDocReference[] = [
  {
    key: "phase_summary",
    title: "Phase 1 Security and Governance Foundation",
    path: "docs/microsoft365/phase1-security-governance-foundation.md",
    summary: "Primary phase audit, execution order, permissions matrix, tenant checklist, and go/no-go guidance."
  },
  {
    key: "shared_mailboxes",
    title: "Shared Mailbox Governance",
    path: "docs/microsoft365/shared-mailbox-governance.md",
    summary: "Ownership, access, retention, and naming rules for shared mailboxes."
  },
  {
    key: "external_sharing",
    title: "External Sharing Governance",
    path: "docs/microsoft365/external-sharing-governance.md",
    summary: "SharePoint and OneDrive external sharing baseline, allowlist posture, and approval rules."
  },
  {
    key: "sensitivity_labels",
    title: "Sensitivity Label Taxonomy",
    path: "docs/microsoft365/sensitivity-label-taxonomy.md",
    summary: "Default label set, publishing rules, and minimum protection expectations."
  },
  {
    key: "audit_retention",
    title: "Audit and Retention Baseline",
    path: "docs/microsoft365/audit-retention-baseline.md",
    summary: "Audit capture, retention windows, and review ownership."
  },
  {
    key: "power_automate",
    title: "Power Automate Governance",
    path: "docs/microsoft365/power-automate-governance.md",
    summary: "Managed environment baseline, ownership, connectors, and change control."
  }
];

const GOVERNANCE_ARTIFACTS: Microsoft365GovernanceArtifact[] = [
  {
    kind: "baseline",
    path: "ops/microsoft365/phase1/governance-baseline.development.json",
    summary: "Development sandbox governance baseline.",
    tenant_admin_action: false
  },
  {
    kind: "baseline",
    path: "ops/microsoft365/phase1/governance-baseline.staging.json",
    summary: "Preproduction governance baseline for pilot rollout and enforcement dry runs.",
    tenant_admin_action: false
  },
  {
    kind: "baseline",
    path: "ops/microsoft365/phase1/governance-baseline.production.json",
    summary: "Production governance baseline with enforced least-privilege and external-sharing restrictions.",
    tenant_admin_action: false
  },
  {
    kind: "script",
    path: "ops/microsoft365/phase1/Test-M365GovernanceBaseline.ps1",
    summary: "Safe tenant-admin validation script that checks required artifacts and environment assumptions without mutating tenant state.",
    tenant_admin_action: true
  },
  {
    kind: "api",
    path: "GET /api/admin/system/microsoft-governance",
    summary: "Admin diagnostics payload for the Phase 1 Microsoft 365 governance foundation.",
    tenant_admin_action: false
  }
];

function resolveBaselineEnvironment(): Microsoft365GovernanceEnvironment {
  if (config.MICROSOFT_365_GOVERNANCE_ENV) {
    return config.MICROSOFT_365_GOVERNANCE_ENV;
  }
  if (config.NODE_ENV === "production") {
    return "production";
  }
  return "development";
}

function getGovernanceBaselinePath(environment: Microsoft365GovernanceEnvironment) {
  return resolveApiRepoPath("ops", "microsoft365", "phase1", `governance-baseline.${environment}.json`);
}

function loadGovernanceBaseline(environment = resolveBaselineEnvironment()): Microsoft365GovernanceBaseline {
  const raw = readFileSync(getGovernanceBaselinePath(environment), "utf8");
  const parsed = governanceBaselineSchema.parse(JSON.parse(raw));
  if (parsed.environment !== environment) {
    throw new Error(`Microsoft 365 governance baseline environment mismatch: expected ${environment}, found ${parsed.environment}.`);
  }
  return parsed;
}

function addIssue(
  issues: Microsoft365GovernanceValidationIssue[],
  input: Microsoft365GovernanceValidationIssue
) {
  issues.push(input);
}

export function getMicrosoft365GovernanceValidationIssues(): Microsoft365GovernanceValidationIssue[] {
  const issues: Microsoft365GovernanceValidationIssue[] = [];
  const baselineEnvironment = resolveBaselineEnvironment();
  let baseline: Microsoft365GovernanceBaseline | null = null;

  try {
    baseline = loadGovernanceBaseline(baselineEnvironment);
  } catch (error) {
    addIssue(issues, {
      area: "baseline",
      severity: "error",
      code: "baseline.file_invalid",
      summary: "The Microsoft 365 governance baseline file is missing or invalid for the active environment.",
      details: {
        environment: baselineEnvironment,
        path: getGovernanceBaselinePath(baselineEnvironment),
        error: error instanceof Error ? error.message : "Unknown baseline load failure"
      }
    });
    return issues;
  }

  if (!config.MICROSOFT_365_TENANT_PRIMARY_DOMAIN) {
    addIssue(issues, {
      area: "tenant",
      severity: "error",
      code: "tenant.primary_domain.missing",
      summary: "MICROSOFT_365_TENANT_PRIMARY_DOMAIN is required to anchor external sharing, mailbox, and label governance to the correct tenant.",
      details: {
        environment: baselineEnvironment
      }
    });
  }

  if (!config.MICROSOFT_365_SHAREPOINT_ROOT_URL) {
    addIssue(issues, {
      area: "sharepoint",
      severity: "error",
      code: "sharepoint.root_url.missing",
      summary: "MICROSOFT_365_SHAREPOINT_ROOT_URL is required for SharePoint and OneDrive governance validation.",
      details: {
        expected_mode: baseline.principal_settings.sharepoint_external_sharing_mode
      }
    });
  }

  if (baseline.principal_settings.power_automate_managed_environment_required && !config.MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID) {
    addIssue(issues, {
      area: "power_automate",
      severity: baselineEnvironment === "production" ? "error" : "warning",
      code: "power_automate.environment_id.missing",
      summary: "Power Automate managed-environment governance requires MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID.",
      details: {
        environment: baselineEnvironment
      }
    });
  }

  if (config.NODE_ENV === "production" && config.ALLOW_DEV_LOGIN) {
    addIssue(issues, {
      area: "auth",
      severity: "error",
      code: "auth.dev_login.enabled_in_production",
      summary: "ALLOW_DEV_LOGIN must be disabled in production before Microsoft 365 security controls are considered baseline-ready."
    });
  }

  if (config.NODE_ENV === "production" && !config.MICROSOFT_ENTRA_AUTH_ENABLED) {
    addIssue(issues, {
      area: "auth",
      severity: "error",
      code: "auth.microsoft_entra_required_in_production",
      summary: "Production must use Microsoft Entra as the normal sign-in path."
    });
  }

  if (config.MICROSOFT_ENTRA_AUTH_ENABLED && config.ALLOW_PASSWORD_LOGIN) {
    addIssue(issues, {
      area: "auth",
      severity: baselineEnvironment === "production" && !config.ALLOW_PASSWORD_LOGIN_BREAK_GLASS_ONLY ? "error" : "warning",
      code: "auth.local_password_enabled_with_entra",
      summary:
        baselineEnvironment === "production" && !config.ALLOW_PASSWORD_LOGIN_BREAK_GLASS_ONLY
          ? "Password login is still enabled while Microsoft Entra auth is enabled without break-glass-only enforcement."
          : "Password login is still enabled while Microsoft Entra auth is enabled. Treat local password auth as break-glass only before Phase 2.",
      details: {
        allow_password_login: config.ALLOW_PASSWORD_LOGIN,
        entra_auth_enabled: config.MICROSOFT_ENTRA_AUTH_ENABLED,
        break_glass_only: config.ALLOW_PASSWORD_LOGIN_BREAK_GLASS_ONLY
      }
    });
  }

  if (config.NODE_ENV === "production" && config.ALLOW_PASSWORD_LOGIN && !config.ALLOW_PASSWORD_LOGIN_BREAK_GLASS_ONLY) {
    addIssue(issues, {
      area: "auth",
      severity: "error",
      code: "auth.local_password_not_break_glass_only",
      summary: "Production password login must stay disabled or break-glass-only."
    });
  }

  if (config.NODE_ENV === "production" && config.MICROSOFT_TEAMS_DEV_BYPASS_AUTH) {
    addIssue(issues, {
      area: "auth",
      severity: "error",
      code: "auth.teams_dev_bypass_enabled_in_production",
      summary: "MICROSOFT_TEAMS_DEV_BYPASS_AUTH must be disabled in production before Microsoft-linked access is considered enforceable."
    });
  }

  if (config.MICROSOFT_365_GOVERNANCE_ENV && config.NODE_ENV === "production" && config.MICROSOFT_365_GOVERNANCE_ENV !== "production") {
    addIssue(issues, {
      area: "baseline",
      severity: "error",
      code: "baseline.environment_mismatch",
      summary: "Production app runtime must not point at a non-production Microsoft 365 governance baseline.",
      details: {
        configured_environment: config.MICROSOFT_365_GOVERNANCE_ENV
      }
    });
  }

  if (!config.MICROSOFT_365_SECURITY_GROUP_PREFIX) {
    addIssue(issues, {
      area: "entra_access_model",
      severity: "warning",
      code: "entra_access_model.group_prefix.missing",
      summary: "MICROSOFT_365_SECURITY_GROUP_PREFIX is not set. Group naming may drift between environments and admin teams.",
      details: {
        baseline_group_prefix: baseline.principal_settings.group_prefix
      }
    });
  } else if (config.MICROSOFT_365_SECURITY_GROUP_PREFIX !== baseline.principal_settings.group_prefix) {
    addIssue(issues, {
      area: "entra_access_model",
      severity: "warning",
      code: "entra_access_model.group_prefix.mismatch",
      summary: "Configured Microsoft 365 group prefix does not match the version-controlled baseline for this environment.",
      details: {
        configured_group_prefix: config.MICROSOFT_365_SECURITY_GROUP_PREFIX,
        baseline_group_prefix: baseline.principal_settings.group_prefix
      }
    });
  }

  return issues;
}

function mapCurrentStateFindings(): Microsoft365GovernanceCurrentStateFinding[] {
  const microsoftFlags = getMicrosoftIntegrationFeatureFlags();
  return [
    {
      key: "dashboard_source_of_truth",
      state: "existing",
      summary: "The dashboard already owns project, workflow, approval, and operational state; Microsoft 365 is an integration layer, not the workflow source of truth.",
      evidence: [
        "packages/api/src/services/jobTruth/jobService.ts",
        "packages/api/src/services/workflowStateEngine.ts",
        "packages/api/src/services/policy/policyEngine.ts"
      ]
    },
    {
      key: "entra_account_linking",
      state: config.MICROSOFT_ENTRA_AUTH_ENABLED ? "partial" : "existing",
      summary: "Microsoft Entra account linking and sign-in paths exist, but tenant-side governance, enforced MFA, and break-glass-only password policy are not yet baseline-controlled.",
      evidence: [
        "packages/api/src/services/microsoftEntra.ts",
        "packages/api/tests/microsoftEntraAuth.test.ts"
      ],
      recommended_refactor: "Make Microsoft sign-in the default admin path and reserve local passwords for auditable break-glass."
    },
    {
      key: "microsoft_integration_diagnostics",
      state: "existing",
      summary: "The codebase already has Microsoft integration startup validation and health summaries, which is the right place to anchor governance diagnostics.",
      evidence: [
        "packages/api/src/services/microsoftIntegrationObservability.ts",
        "packages/api/src/app.ts"
      ]
    },
    {
      key: "teams_outlook_feature_flags",
      state: microsoftFlags.outlook_sync_enabled || microsoftFlags.teams_alerts_enabled || microsoftFlags.teams_personal_app_enabled ? "partial" : "existing",
      summary: "Teams and Outlook features are independently flaggable, but those flags are not a substitute for tenant security controls such as Conditional Access, Intune, and DLP.",
      evidence: [
        "packages/api/src/config.ts",
        ".env.example"
      ],
      recommended_refactor: "Keep feature flags as rollout controls only. Tenant security must live in Microsoft 365 governance."
    },
    {
      key: "sharepoint_onedrive_governance",
      state: "missing",
      summary: "There was no version-controlled SharePoint or OneDrive sharing baseline before this phase.",
      evidence: [
        "No SharePoint or OneDrive governance definitions were present in repo-scoped configuration before Phase 1."
      ]
    },
    {
      key: "conditional_access_intune_governance",
      state: "missing",
      summary: "There was no documented Conditional Access or Intune baseline in the codebase or repo artifacts before this phase.",
      evidence: [
        "No Conditional Access or Intune baseline artifacts were present before Phase 1."
      ]
    },
    {
      key: "sensitivity_dlp_audit_governance",
      state: "missing",
      summary: "Sensitivity labels, DLP, and audit retention design were not codified in version-controlled governance artifacts before this phase.",
      evidence: [
        "No Microsoft 365 label, DLP, or audit retention governance baseline existed before Phase 1."
      ]
    },
    {
      key: "department_admin_separation",
      state: "partial",
      summary: "The app has authority tiers and department-aware policy scopes, but those boundaries were not mapped to Microsoft 365 role groups and ownership conventions before this phase.",
      evidence: [
        "packages/api/src/services/policy/policyEngine.ts",
        "packages/api/src/services/auth.ts"
      ],
      recommended_refactor: "Map app authority tiers to Entra security groups without making M365 the authorization source."
    }
  ];
}

function mapSecurityGaps(): Microsoft365GovernanceSecurityGap[] {
  return [
    {
      key: "auth_break_glass_boundary",
      severity: "high",
      summary: "Local password and dev login controls can still undermine Microsoft-auth-first posture if they remain broadly available.",
      consequence: "Admin MFA and Conditional Access can be bypassed operationally if fallback auth is not tightly constrained and audited.",
      refactor_first: true
    },
    {
      key: "tenant_governance_gap",
      severity: "high",
      summary: "The codebase had Microsoft integration flags and app diagnostics, but no version-controlled tenant governance baseline for Entra, Intune, SharePoint, labels, DLP, or Power Automate.",
      consequence: "Rollout would depend on tribal knowledge and ad hoc admin steps, which is not supportable or safely repeatable.",
      refactor_first: true
    },
    {
      key: "sharepoint_external_sharing_gap",
      severity: "high",
      summary: "External sharing defaults for SharePoint and OneDrive were not codified.",
      consequence: "Future client uploads and document sharing could launch on permissive tenant defaults or inconsistent site-level overrides.",
      refactor_first: true
    },
    {
      key: "label_and_dlp_gap",
      severity: "medium",
      summary: "Sensitivity labels, audit retention, and DLP baselines were not defined as deployable governance artifacts.",
      consequence: "Documents, mailboxes, and flows can spread operational or client data without a consistent protection baseline.",
      refactor_first: false
    },
    {
      key: "automation_ownership_gap",
      severity: "medium",
      summary: "Power Automate ownership and connector governance were not constrained by environment-aware rules.",
      consequence: "Flows can become orphaned, over-privileged, or silently create a second system of record outside the dashboard.",
      refactor_first: false
    }
  ];
}

function mapRefactorFirst(): string[] {
  return [
    "Reduce local-password auth to break-glass use only once Microsoft Entra sign-in is enabled for admins.",
    "Keep Microsoft 365 as the collaboration and document layer; do not let SharePoint lists, mailbox folders, or Power Automate flows become operational source-of-truth stores.",
    "Map platform admins, security admins, and department leads to explicit Entra security groups with documented ownership rather than implicit admin knowledge.",
    "Require environment-aware governance artifacts before enabling client uploads, project reminders, or external portal access."
  ];
}

function buildBaselineControls(baseline: Microsoft365GovernanceBaseline) {
  return {
    entra_access_model: [
      `Use ${baseline.principal_settings.group_prefix} prefixed Entra security groups for platform admins, security admins, department leads, project owners, reviewers, and staff.`,
      "Keep Microsoft directory role assignments separate from dashboard authorization. Entra groups scope access administration, not operational workflow state.",
      "Use role-assignable groups only for tenant admin personas that truly need Microsoft 365 admin roles."
    ],
    mfa: [
      baseline.principal_settings.require_phishing_resistant_mfa_for_admins
        ? "Require phishing-resistant MFA for platform and security admins."
        : "Require strong MFA for all admin personas.",
      "Require MFA for every internal user. Temporary Access Pass is emergency-only and security-admin controlled.",
      "Block legacy authentication for mail and Office protocols."
    ],
    conditional_access: [
      "Separate admin and worker Conditional Access policies.",
      "Require compliant or hybrid-joined devices for admin portals and Power Platform admin surfaces.",
      "Use report-only in lower environments and staged enforcement in staging before production."
    ],
    intune: [
      baseline.principal_settings.require_managed_devices_for_admin_portals
        ? "Require managed-device compliance for admin access."
        : "Managed-device enforcement is recommended before production admin rollout.",
      "Use baseline compliance for encryption, OS support, screen lock, and Defender health.",
      "Separate personally owned device access from admin-capable device access."
    ],
    external_sharing: [
      `SharePoint external sharing baseline: ${baseline.principal_settings.sharepoint_external_sharing_mode}.`,
      `OneDrive external sharing baseline: ${baseline.principal_settings.onedrive_external_sharing_mode}.`,
      "Use Specific People links, expiration, and approval-owned guest access for external collaboration."
    ],
    shared_mailboxes: baseline.governance_models.shared_mailboxes,
    sensitivity_labels: baseline.governance_models.sensitivity_labels,
    dlp: [
      "Start with Exchange, SharePoint, OneDrive, and Teams DLP coverage for client and finance-adjacent patterns.",
      "Use warn-and-block for externally shared content carrying restricted labels.",
      "Keep label publication scoped by persona and environment."
    ],
    audit_and_retention: baseline.governance_models.audit_and_retention,
    power_automate: baseline.governance_models.automation_ownership
  };
}

function determineGoNoGo(issues: Microsoft365GovernanceValidationIssue[]): Microsoft365GovernanceGoNoGo {
  if (issues.some((issue) => issue.severity === "error")) {
    return "no_go";
  }
  if (issues.length > 0) {
    return "conditional_go";
  }
  return "conditional_go";
}

export function assertMicrosoft365GovernanceStartupConfig() {
  const issues = getMicrosoft365GovernanceValidationIssues();
  const errors = issues.filter((issue) => issue.severity === "error");
  if ((config.MICROSOFT_365_GOVERNANCE_STRICT_VALIDATION || config.NODE_ENV === "production") && errors.length > 0) {
    throw new Error(`Microsoft 365 governance startup validation failed: ${errors.map((issue) => issue.code).join(", ")}`);
  }
}

export function getPublicMicrosoft365GovernanceHealthSummary() {
  const issues = getMicrosoft365GovernanceValidationIssues();
  return {
    baseline_environment: resolveBaselineEnvironment(),
    startup_valid: issues.every((issue) => issue.severity !== "error"),
    issue_count: issues.length,
    recommendation: determineGoNoGo(issues)
  };
}

export function getMicrosoft365GovernanceDiagnostics(): Microsoft365GovernanceDiagnosticsResponse {
  const baseline = loadGovernanceBaseline();
  const issues = getMicrosoft365GovernanceValidationIssues();
  const goNoGo = determineGoNoGo(issues);

  return {
    generated_at: new Date().toISOString(),
    baseline_environment: baseline.environment,
    startup_validation: {
      valid: issues.every((issue) => issue.severity !== "error"),
      issues
    },
    phase_audit_summary: {
      implementation_status: "Phase 1 governance baseline is scaffolded in code, docs, and version-controlled tenant artifacts. Tenant admin execution is still required before Phase 2.",
      current_state: "The dashboard already has Microsoft integration seams and app-owned authorization, but tenant-side Microsoft 365 security governance was previously underdefined.",
      recommendation: goNoGo
    },
    current_state_findings: mapCurrentStateFindings(),
    security_gaps: mapSecurityGaps(),
    refactor_first: mapRefactorFirst(),
    execution_order: baseline.execution_order,
    permissions_matrix: baseline.permissions_matrix,
    governance_docs: GOVERNANCE_DOCS,
    configuration_artifacts: GOVERNANCE_ARTIFACTS,
    manual_admin_checklist: baseline.manual_admin_checklist,
    validation_checklist: baseline.validation_checklist,
    rollback_principles: baseline.rollback_principles,
    baseline_controls: buildBaselineControls(baseline)
  };
}
