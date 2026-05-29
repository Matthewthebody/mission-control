import type { PoolClient } from "pg";
import { hasAuthorityTier, hasPermissionCode } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { getLocalDateString } from "../utils/localDate.js";
import { listUsers } from "./access.js";
import { getAdminSettingsWorkspace } from "./adminSettings.js";
import { getIntegrationGovernance } from "./integrationGovernance.js";
import { listIntegrationSyncOperations } from "./integrationSync.js";
import { getPayrollReview } from "./payrollReview.js";
import { getSecurityOverview } from "./securityApprovals.js";
import { getMileageZoneCatalog, listMileageReimbursements } from "./timeClockMileage.js";

type AdminWorkspaceTone = "neutral" | "info" | "success" | "warning" | "critical";

type AccessUsersResponse = Awaited<ReturnType<typeof listUsers>>;
type AdminSettingsWorkspaceResponse = Awaited<ReturnType<typeof getAdminSettingsWorkspace>>;
type IntegrationGovernanceResponse = Awaited<ReturnType<typeof getIntegrationGovernance>>;
type IntegrationSyncRows = Awaited<ReturnType<typeof listIntegrationSyncOperations>>;
type SecurityOverviewResponse = Awaited<ReturnType<typeof getSecurityOverview>>;
type PayrollReviewResponse = Awaited<ReturnType<typeof getPayrollReview>>;
type MileageReimbursementResponse = Awaited<ReturnType<typeof listMileageReimbursements>>;
type MileageZoneCatalogResponse = Awaited<ReturnType<typeof getMileageZoneCatalog>>;

type AdminWorkspaceSummaryCard = {
  id: string;
  label: string;
  count: number;
  detail: string;
  tone: AdminWorkspaceTone;
  action_hash: string;
};

type AdminWorkspaceItem = {
  id: string;
  title: string;
  summary: string;
  status_label: string;
  tone: AdminWorkspaceTone;
  action_hash: string;
};

type AdminWorkspaceSection = {
  visible: boolean;
  headline: string;
  summary_line: string;
  action_hash: string;
  action_label: string;
  helper_text: string | null;
  cards: AdminWorkspaceSummaryCard[];
  items: AdminWorkspaceItem[];
};

export type AdminWorkspaceResponse = {
  generated_at: string;
  anchor_date: string;
  refresh_interval_seconds: number;
  role_mode: "manage" | "read_only";
  summary_strip: AdminWorkspaceSummaryCard[];
  roles_access: AdminWorkspaceSection;
  integrations: AdminWorkspaceSection;
  automations: AdminWorkspaceSection;
  settings_reference: AdminWorkspaceSection;
  audit_security: AdminWorkspaceSection;
  review_tools: AdminWorkspaceSection;
};

export async function getAdminWorkspace(
  client: PoolClient,
  auth: AuthUser,
  options: { date?: string | null }
): Promise<AdminWorkspaceResponse> {
  if (!canReadAdminWorkspace(auth)) {
    throw new ApiError(403, "Admin workspace access is restricted.");
  }

  const anchorDate = options.date?.trim() || getLocalDateString();
  const generatedAt = new Date().toISOString();
  const canViewRolesSection = canViewRolesAccess(auth);
  const canViewIntegrationsSection = canViewIntegrations(auth);
  const canViewSettingsSection = canViewSettingsAndReference(auth);
  const canViewSecuritySection = canViewAuditSecurity(auth);
  const canViewReviewSection = canViewAdminReviewTools(auth);
  const canManage = canManageAdminWorkspace(auth);

  const [users, settings, integrations, syncOperations, security, payrollReview, mileageReview, mileageZones] =
    await Promise.all([
      canViewRolesSection ? listUsers(client, auth.tenantId, {}) : Promise.resolve([] as AccessUsersResponse),
      canViewSettingsSection ? getAdminSettingsWorkspace(client, auth) : Promise.resolve(null as AdminSettingsWorkspaceResponse | null),
      canViewIntegrationsSection ? getIntegrationGovernance(client, auth) : Promise.resolve(null as IntegrationGovernanceResponse | null),
      canViewIntegrationsSection ? listIntegrationSyncOperations(client, auth) : Promise.resolve([] as IntegrationSyncRows),
      canViewSecuritySection ? getSecurityOverview(client, auth) : Promise.resolve(null as SecurityOverviewResponse | null),
      canViewReviewSection ? getPayrollReview(client, auth, { date: anchorDate }) : Promise.resolve(null as PayrollReviewResponse | null),
      canViewReviewSection
        ? listMileageReimbursements(client, auth, { date: anchorDate, status: "review_required" })
        : Promise.resolve(null as MileageReimbursementResponse | null),
      canViewReviewSection ? getMileageZoneCatalog(client, auth.tenantId, anchorDate) : Promise.resolve([] as MileageZoneCatalogResponse)
    ]);

  const rolesAccess = buildRolesAccessSection(users);
  const integrationSection = buildIntegrationSection(integrations);
  const automationSection = buildAutomationSection(syncOperations, integrations, settings);
  const settingsSection = buildSettingsReferenceSection(settings);
  const auditSecurity = buildAuditSecuritySection(security);
  const reviewTools = buildReviewToolsSection(payrollReview, mileageReview, mileageZones);

  return {
    generated_at: generatedAt,
    anchor_date: anchorDate,
    refresh_interval_seconds: 90,
    role_mode: canManage ? "manage" : "read_only",
    summary_strip: buildSummaryStrip({
      roles: rolesAccess,
      integrations: integrationSection,
      automations: automationSection,
      settings: settingsSection,
      security: auditSecurity,
      review: reviewTools
    }),
    roles_access: rolesAccess,
    integrations: integrationSection,
    automations: automationSection,
    settings_reference: settingsSection,
    audit_security: auditSecurity,
    review_tools: reviewTools
  };
}

function canReadAdminWorkspace(auth: AuthUser) {
  return (
    canViewRolesAccess(auth) ||
    canViewIntegrations(auth) ||
    canViewSettingsAndReference(auth) ||
    canViewAuditSecurity(auth) ||
    canViewAdminReviewTools(auth)
  );
}

function canManageAdminWorkspace(auth: AuthUser) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    hasPermissionCode(auth, "system_settings_permissions.edit") ||
    hasPermissionCode(auth, "system_settings_permissions.override") ||
    hasPermissionCode(auth, "roles_permissions.configure") ||
    hasPermissionCode(auth, "audit_controls.configure")
  );
}

function canViewRolesAccess(auth: AuthUser) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    hasPermissionCode(auth, "roles_permissions.view")
  );
}

function canViewIntegrations(auth: AuthUser) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"]) ||
    hasPermissionCode(auth, "integrations.view") ||
    hasPermissionCode(auth, "integrations.manage")
  );
}

function canViewSettingsAndReference(auth: AuthUser) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"]) ||
    hasPermissionCode(auth, "system_settings_permissions.view")
  );
}

function canViewAuditSecurity(auth: AuthUser) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    hasPermissionCode(auth, "audit_controls.view")
  );
}

function canViewAdminReviewTools(auth: AuthUser) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]);
}

function buildSummaryStrip(input: {
  roles: AdminWorkspaceSection;
  integrations: AdminWorkspaceSection;
  automations: AdminWorkspaceSection;
  settings: AdminWorkspaceSection;
  security: AdminWorkspaceSection;
  review: AdminWorkspaceSection;
}): AdminWorkspaceSummaryCard[] {
  return [
    summarizeSection("roles_access", "Roles / Access", input.roles, "#admin/roles"),
    summarizeSection("integration_health", "Integrations", input.integrations, "#admin/integrations"),
    summarizeSection("automation_health", "Automations", input.automations, "#admin/automations"),
    summarizeSection("settings_reference", "Settings / Reference", input.settings, "#admin/system"),
    summarizeSection("audit_security", "Audit / Security", input.security, "#admin/audit"),
    summarizeSection("review_tools", "Review Tools", input.review, "#admin/review-tools")
  ];
}

function summarizeSection(
  id: string,
  label: string,
  section: AdminWorkspaceSection,
  actionHash: string
): AdminWorkspaceSummaryCard {
  const firstCard = section.cards[0];
  const tone = firstCard?.tone ?? (section.visible ? "info" : "neutral");
  const count = section.cards.reduce((total, card) => total + card.count, 0);
  return {
    id,
    label,
    count,
    detail: section.summary_line,
    tone,
    action_hash: actionHash
  };
}

function buildRolesAccessSection(users: AccessUsersResponse): AdminWorkspaceSection {
  if (!users.length) {
    return emptySection({
      headline: "Roles and Access",
      summaryLine: "No membership data is available in this view yet.",
      actionHash: "#admin/roles",
      actionLabel: "Open Roles & Access"
    });
  }

  const activeCount = users.filter((user) => user.status === "active").length;
  const pendingCount = users.filter((user) => user.status === "invited" || user.status === "pending_approval").length;
  const suspendedCount = users.filter((user) => user.status === "suspended").length;
  const privilegedCount = users.filter((user) =>
    ["super_admin", "leadership", "director_admin"].includes(String(user.authority_tier ?? ""))
  ).length;
  const followUpUsers: AdminWorkspaceItem[] = users
    .filter((user) => user.status === "pending_approval" || user.status === "suspended" || user.status === "invited")
    .slice(0, 4)
    .map((user) => ({
      id: user.id,
      title: user.full_name ?? user.email,
      summary: `${humanizeLabel(user.authority_tier)} · ${humanizeLabel(user.department)} · ${user.email}`,
      status_label: humanizeLabel(user.status),
      tone: user.status === "pending_approval" ? "critical" : user.status === "suspended" ? "warning" : "info",
      action_hash: "#admin/roles"
    }));

  return {
    visible: true,
    headline: "Roles and Access",
    summary_line:
      pendingCount > 0
        ? `${pendingCount} membership change${pendingCount === 1 ? "" : "s"} still need follow-through before access posture feels clean.`
        : "Role posture looks stable. Use the dedicated access workspace for membership changes and scoped review.",
    action_hash: "#admin/roles",
    action_label: "Open Roles & Access",
    helper_text: "Admin should be the control plane for access posture, not a vague list of dangerous toggles.",
    cards: [
      metricCard("active_users", "Active", activeCount, "Current active memberships.", "success", "#admin/roles"),
      metricCard("pending_users", "Pending", pendingCount, "Invites and approvals still waiting.", pendingCount ? "critical" : "success", "#admin/roles"),
      metricCard("suspended_users", "Suspended", suspendedCount, "Disabled accounts still visible in the directory.", suspendedCount ? "warning" : "success", "#admin/roles"),
      metricCard("privileged_users", "Privileged", privilegedCount, "Higher-trust memberships carrying admin or leadership authority.", privilegedCount ? "info" : "neutral", "#admin/roles")
    ],
    items: followUpUsers
  };
}

function buildIntegrationSection(
  governance: IntegrationGovernanceResponse | null
): AdminWorkspaceSection {
  if (!governance) {
    return emptySection({
      headline: "Integrations",
      summaryLine: "Integration governance is not available for this viewer.",
      actionHash: "#admin/integrations",
      actionLabel: "Open Integrations"
    });
  }

  const providerItems: AdminWorkspaceItem[] = governance.providers.slice(0, 4).map((provider) => ({
    id: provider.provider,
    title: provider.display_name,
    summary: provider.source_of_truth_summary,
    status_label: provider.health_label,
    tone: mapIntegrationHealthTone(provider.health_state),
    action_hash: "#admin/integrations"
  }));

  return {
    visible: true,
    headline: "Integrations",
    summary_line:
      governance.summary.failing_count || governance.summary.unresolved_conflict_count
        ? `${governance.summary.failing_count} connector${governance.summary.failing_count === 1 ? "" : "s"} are failing and ${governance.summary.unresolved_conflict_count} conflict${governance.summary.unresolved_conflict_count === 1 ? "" : "s"} still need review.`
        : "Integration ownership is readable and current. Admin owns retries, replay, and coexistence controls.",
    action_hash: "#admin/integrations",
    action_label: "Open Integrations",
    helper_text: "Operational pages can show source attribution, but sync control and replay belong here.",
    cards: [
      metricCard("connected_systems", "Connected", governance.summary.connected_count, "Connectors currently active for this tenant.", "success", "#admin/integrations"),
      metricCard("integration_warnings", "Warnings", governance.summary.warning_count, "Stale or degraded connectors that need admin attention.", governance.summary.warning_count ? "warning" : "success", "#admin/integrations"),
      metricCard("integration_failures", "Failing", governance.summary.failing_count, "Broken connector paths or failed provider health.", governance.summary.failing_count ? "critical" : "success", "#admin/integrations"),
      metricCard("integration_conflicts", "Conflicts", governance.summary.unresolved_conflict_count, "Explicit coexistence conflicts still waiting on a source-of-truth decision.", governance.summary.unresolved_conflict_count ? "warning" : "success", "#admin/integrations")
    ],
    items: providerItems
  };
}

function buildAutomationSection(
  syncOperations: IntegrationSyncRows,
  governance: IntegrationGovernanceResponse | null,
  settings: AdminSettingsWorkspaceResponse | null
): AdminWorkspaceSection {
  const pendingCount = syncOperations.filter((operation) => operation.status === "pending" || operation.status === "processing").length;
  const failedCount = syncOperations.filter((operation) => operation.status === "failed").length;
  const conflictCount = syncOperations.filter((operation) => operation.status === "conflict").length;
  const replayItems: AdminWorkspaceItem[] = syncOperations
    .filter((operation) => operation.status === "failed" || operation.status === "conflict" || operation.status === "pending")
    .slice(0, 5)
    .map((operation) => ({
      id: operation.id,
      title: `${humanizeLabel(operation.provider)} ${humanizeLabel(operation.operation_type)}`,
      summary: `${humanizeLabel(operation.entity_type)} · ${humanizeLabel(operation.status)} · ${operation.message ?? "Retry or replay may be required."}`,
      status_label: humanizeLabel(operation.status),
      tone: operation.status === "failed" ? "critical" : operation.status === "conflict" ? "warning" : "info",
      action_hash: "#admin/integrations"
    }));

  const fallbackItems: AdminWorkspaceItem[] =
    settings?.integration_health_issues.slice(0, 4).map((issue) => ({
      id: issue.id,
      title: issue.title,
      summary: issue.detail,
      status_label: humanizeLabel(issue.tone),
      tone: mapLegacyTone(issue.tone),
      action_hash: issue.action_hash ?? "#admin/integrations"
    })) ?? [];

  return {
    visible: syncOperations.length > 0 || Boolean(governance) || Boolean(settings),
    headline: "Automations",
    summary_line:
      failedCount || conflictCount || pendingCount
        ? `${failedCount} failed sync${failedCount === 1 ? "" : "s"}, ${conflictCount} conflict${conflictCount === 1 ? "" : "s"}, and ${pendingCount} queued or processing job${pendingCount === 1 ? "" : "s"} are visible right now.`
        : "Background automation still needs better product coverage, but the retry and failure signals that do exist are centralized here.",
    action_hash: "#admin/automations",
    action_label: "Open Automations",
    helper_text: "This is intentionally honest automation observability, not a fake job-control page pretending every workflow is centrally orchestrated.",
    cards: [
      metricCard("automation_pending", "Queued", pendingCount, "Background sync or replay work waiting to finish.", pendingCount ? "warning" : "success", "#admin/automations"),
      metricCard("automation_failed", "Failed", failedCount, "Operations that will not self-heal without review.", failedCount ? "critical" : "success", "#admin/automations"),
      metricCard("automation_conflicts", "Conflicts", conflictCount, "Manual coexistence decisions still blocking clean automation.", conflictCount ? "warning" : "success", "#admin/automations"),
      metricCard(
        "automation_retry_pressure",
        "Retry Pressure",
        governance?.summary.pending_sync_count ?? 0,
        "Provider backlog that still needs retry or replay visibility.",
        (governance?.summary.pending_sync_count ?? 0) > 0 ? "warning" : "success",
        "#admin/integrations"
      )
    ],
    items: replayItems.length ? replayItems : fallbackItems
  };
}

function buildSettingsReferenceSection(
  settings: AdminSettingsWorkspaceResponse | null
): AdminWorkspaceSection {
  if (!settings) {
    return emptySection({
      headline: "Settings and Reference Data",
      summaryLine: "System configuration is not available in this view.",
      actionHash: "#admin/system",
      actionLabel: "Open System Configuration"
    });
  }

  const items: AdminWorkspaceItem[] = [
    ...settings.pending_approvals.slice(0, 2).map((record) => ({
      id: `pending:${record.id}`,
      title: humanizeSettingKey(record.setting_key),
      summary: `${humanizeLabel(record.scope_type)}${record.scope_label ? ` · ${record.scope_label}` : ""} · ${record.reason}`,
      status_label: "Pending Approval",
      tone: "critical" as const,
      action_hash: "#admin/system"
    })),
    ...settings.data_health_warnings.slice(0, 2).map((warning) => ({
      id: `warning:${warning.id}`,
      title: warning.title,
      summary: warning.detail,
      status_label: humanizeLabel(warning.tone),
      tone: mapLegacyTone(warning.tone),
      action_hash: warning.action_hash ?? "#admin/system"
    }))
  ].slice(0, 4);

  return {
    visible: true,
    headline: "Settings and Reference Data",
    summary_line:
      settings.pending_approvals.length || settings.stale_overrides.length || settings.data_health_warnings.length
        ? `${settings.pending_approvals.length} pending change${settings.pending_approvals.length === 1 ? "" : "s"}, ${settings.stale_overrides.length} stale override${settings.stale_overrides.length === 1 ? "" : "s"}, and ${settings.data_health_warnings.length} data warning${settings.data_health_warnings.length === 1 ? "" : "s"} still need admin attention.`
        : "Stable system configuration and reference controls are centralized here with versioning and audit history.",
    action_hash: "#admin/system",
    action_label: "Open System Configuration",
    helper_text: "System settings should be versioned, explainable, and boring. They should never hide inside daily work pages.",
    cards: [
      metricCard("settings_count", "Tracked Settings", settings.settings.length, "Versioned system settings currently available.", "info", "#admin/system"),
      metricCard("settings_pending", "Pending Changes", settings.pending_approvals.length, "Configuration changes still waiting for approval.", settings.pending_approvals.length ? "warning" : "success", "#admin/system"),
      metricCard("settings_stale", "Stale Overrides", settings.stale_overrides.length, "Expired or drift-prone overrides that need cleanup.", settings.stale_overrides.length ? "warning" : "success", "#admin/system"),
      metricCard("settings_warnings", "Data Warnings", settings.data_health_warnings.length, "Health warnings that directly reduce trust.", settings.data_health_warnings.length ? "critical" : "success", "#admin/system")
    ],
    items
  };
}

function buildAuditSecuritySection(
  security: SecurityOverviewResponse | null
): AdminWorkspaceSection {
  if (!security) {
    return emptySection({
      headline: "Audit and Security",
      summaryLine: "Security posture is not available in this view.",
      actionHash: "#admin/audit",
      actionLabel: "Open Audit & Security"
    });
  }

  return {
    visible: true,
    headline: "Audit and Security",
    summary_line:
      security.pending_approval_count || security.pending_break_glass_review_count || security.active_break_glass_count
        ? `${security.pending_approval_count} privileged approval${security.pending_approval_count === 1 ? "" : "s"}, ${security.pending_break_glass_review_count} break-glass review${security.pending_break_glass_review_count === 1 ? "" : "s"}, and ${security.active_break_glass_count} active emergency session${security.active_break_glass_count === 1 ? "" : "s"} are visible right now.`
        : "Dangerous-action visibility looks calm. Use Audit for detailed review and privileged control history.",
    action_hash: "#admin/audit",
    action_label: "Open Audit & Security",
    helper_text: "High-trust actions and break-glass review belong in one explicit place, not scattered across operational workspaces.",
    cards: [
      metricCard("security_pending", "Pending Approvals", security.pending_approval_count, "Privileged actions waiting on a second reviewer.", security.pending_approval_count ? "critical" : "success", "#admin/audit"),
      metricCard("security_break_glass", "Active Break Glass", security.active_break_glass_count, "Emergency sessions still open.", security.active_break_glass_count ? "critical" : "success", "#admin/audit"),
      metricCard("security_review", "Pending Review", security.pending_break_glass_review_count, "Break-glass events still waiting for after-action review.", security.pending_break_glass_review_count ? "warning" : "success", "#admin/audit"),
      metricCard("security_dangerous", "Dangerous Actions", security.recent_dangerous_actions.length, "Recent high-risk executions visible in the audit feed.", security.recent_dangerous_actions.length ? "info" : "neutral", "#admin/audit")
    ],
    items: security.recent_dangerous_actions.slice(0, 4).map((action): AdminWorkspaceItem => ({
      id: action.id,
      title: humanizeLabel(action.action_code),
      summary: `${action.actor_name ?? "Unknown actor"} · ${humanizeLabel(action.source_module)} · ${action.reason}`,
      status_label: humanizeLabel(action.status),
      tone: action.status === "executed" ? "warning" : "critical",
      action_hash: "#admin/audit"
    }))
  };
}

function buildReviewToolsSection(
  payrollReview: PayrollReviewResponse | null,
  mileageReview: MileageReimbursementResponse | null,
  mileageZones: MileageZoneCatalogResponse
): AdminWorkspaceSection {
  if (!payrollReview && !mileageReview) {
    return emptySection({
      headline: "Admin Review Tools",
      summaryLine: "Admin-only payroll and reconciliation tooling is not available in this view.",
      actionHash: "#admin/review-tools",
      actionLabel: "Open Review Tools"
    });
  }

  const payrollBlocked = payrollReview?.rows.filter((row) => row.export_readiness === "blocked").slice(0, 3) ?? [];
  const mileageNeedsReview = mileageReview?.rows.slice(0, 2) ?? [];
  const items: AdminWorkspaceItem[] = [
    ...payrollBlocked.map((row): AdminWorkspaceItem => ({
      id: `payroll:${row.employee_id}`,
      title: row.employee_name ?? "Unknown employee",
      summary: `${humanizeLabel(row.department)} · ${row.unresolved_issue_count} unresolved review issue${row.unresolved_issue_count === 1 ? "" : "s"} are still blocking export.`,
      status_label: "Export Blocked",
      tone: "critical" as const,
      action_hash: "#admin/review-tools"
    })),
    ...mileageNeedsReview.map((row): AdminWorkspaceItem => ({
      id: `mileage:${row.id}`,
      title: row.employee_name ?? "Unknown employee",
      summary: `${row.review_reason_label ?? "Mileage review required"} · ${row.work_date}`,
      status_label: humanizeLabel(row.status),
      tone: row.status === "review_required" ? "warning" : "info",
      action_hash: "#admin/review-tools"
    }))
  ];

  return {
    visible: true,
    headline: "Admin Review Tools",
    summary_line:
      (payrollReview?.summary.blocked_count ?? 0) || (mileageReview?.summary.review_required_count ?? 0)
        ? `${payrollReview?.summary.blocked_count ?? 0} payroll export block${(payrollReview?.summary.blocked_count ?? 0) === 1 ? "" : "s"} and ${mileageReview?.summary.review_required_count ?? 0} mileage review item${(mileageReview?.summary.review_required_count ?? 0) === 1 ? "" : "s"} are still open.`
        : "Payroll export, mileage review, and admin reconciliation are calm right now.",
    action_hash: "#admin/review-tools",
    action_label: "Open Review Tools",
    helper_text: "Payroll review, export, mileage review, and reconciliation are admin review tools. They do not belong in daily operational tabs.",
    cards: [
      metricCard("payroll_blocked", "Export Blocked", payrollReview?.summary.blocked_count ?? 0, "Pay-period rows that cannot export yet.", (payrollReview?.summary.blocked_count ?? 0) ? "critical" : "success", "#admin/review-tools"),
      metricCard("payroll_ready", "Ready To Export", payrollReview?.summary.ready_count ?? 0, "Rows ready for payroll export writer output.", (payrollReview?.summary.ready_count ?? 0) ? "success" : "neutral", "#admin/review-tools"),
      metricCard("mileage_review", "Mileage Review", mileageReview?.summary.review_required_count ?? 0, "Mileage reimbursements still waiting on admin review.", (mileageReview?.summary.review_required_count ?? 0) ? "warning" : "success", "#admin/review-tools"),
      metricCard("mileage_zones", "Mileage Zones", mileageZones.length, "Configured active mileage reimbursement zones.", mileageZones.length ? "info" : "warning", "#admin/reference-data")
    ],
    items
  };
}

function emptySection(input: {
  headline: string;
  summaryLine: string;
  actionHash: string;
  actionLabel: string;
}): AdminWorkspaceSection {
  return {
    visible: false,
    headline: input.headline,
    summary_line: input.summaryLine,
    action_hash: input.actionHash,
    action_label: input.actionLabel,
    helper_text: null,
    cards: [],
    items: []
  };
}

function metricCard(
  id: string,
  label: string,
  count: number,
  detail: string,
  tone: AdminWorkspaceTone,
  actionHash: string
): AdminWorkspaceSummaryCard {
  return {
    id,
    label,
    count,
    detail,
    tone,
    action_hash: actionHash
  };
}

function humanizeLabel(value: string | null | undefined) {
  if (!value) {
    return "Unknown";
  }
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function humanizeSettingKey(value: string) {
  const [group, key] = value.split(".");
  const readableKey = humanizeLabel(key ?? value);
  if (!group) {
    return readableKey;
  }
  return `${humanizeLabel(group)} / ${readableKey}`;
}

function mapIntegrationHealthTone(value: IntegrationGovernanceResponse["providers"][number]["health_state"]): AdminWorkspaceTone {
  switch (value) {
    case "healthy":
      return "success";
    case "warning":
    case "degraded":
      return "warning";
    case "failing":
      return "critical";
    default:
      return "neutral";
  }
}

function mapLegacyTone(value: "neutral" | "warning" | "danger"): AdminWorkspaceTone {
  switch (value) {
    case "danger":
      return "critical";
    case "warning":
      return "warning";
    default:
      return "neutral";
  }
}
