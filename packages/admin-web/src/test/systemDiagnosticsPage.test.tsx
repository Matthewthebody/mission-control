// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemDiagnosticsPage } from "../pages/SystemDiagnosticsPage";
import type { AccessPolicyPreview, AccessPolicyWorkspace } from "../accessPolicyTypes";
import type {
  CommunicationDiagnosticsResponse,
  CoreFoundationDiagnosticsResponse,
  DiagnosticFindingListItem,
  DiagnosticsWorkspaceResponse,
  EntityTraceResponse,
  PolicyDecisionTraceListItem,
  RepairPreviewResponse
} from "../systemDiagnosticsTypes";
import type { SessionUser } from "../types";

const getSystemDiagnosticsWorkspaceMock = vi.fn();
const getSystemFoundationDiagnosticsMock = vi.fn();
const getSystemCommunicationDiagnosticsMock = vi.fn();
const listSystemDiagnosticFindingsMock = vi.fn();
const updateSystemDiagnosticFindingMock = vi.fn();
const runSystemDiagnosticRulesMock = vi.fn();
const previewSystemRepairActionMock = vi.fn();
const executeSystemRepairActionMock = vi.fn();
const listSystemAuditEventsMock = vi.fn();
const getSystemEntityTraceMock = vi.fn();
const getSystemSyncHealthMock = vi.fn();
const listSystemRepairActionsMock = vi.fn();
const listSystemPolicyTracesMock = vi.fn();
const previewSystemAccessDecisionMock = vi.fn();
const listSystemImportAuditsMock = vi.fn();
const listSystemExportAuditsMock = vi.fn();
const getAccessPolicyWorkspaceMock = vi.fn();

vi.mock("../services/systemDiagnosticsApi", () => ({
  getSystemDiagnosticsWorkspace: (...args: unknown[]) => getSystemDiagnosticsWorkspaceMock(...args),
  getSystemFoundationDiagnostics: (...args: unknown[]) => getSystemFoundationDiagnosticsMock(...args),
  getSystemCommunicationDiagnostics: (...args: unknown[]) => getSystemCommunicationDiagnosticsMock(...args),
  listSystemDiagnosticFindings: (...args: unknown[]) => listSystemDiagnosticFindingsMock(...args),
  updateSystemDiagnosticFinding: (...args: unknown[]) => updateSystemDiagnosticFindingMock(...args),
  runSystemDiagnosticRules: (...args: unknown[]) => runSystemDiagnosticRulesMock(...args),
  previewSystemRepairAction: (...args: unknown[]) => previewSystemRepairActionMock(...args),
  executeSystemRepairAction: (...args: unknown[]) => executeSystemRepairActionMock(...args),
  listSystemAuditEvents: (...args: unknown[]) => listSystemAuditEventsMock(...args),
  getSystemEntityTrace: (...args: unknown[]) => getSystemEntityTraceMock(...args),
  getSystemSyncHealth: (...args: unknown[]) => getSystemSyncHealthMock(...args),
  listSystemRepairActions: (...args: unknown[]) => listSystemRepairActionsMock(...args),
  listSystemPolicyTraces: (...args: unknown[]) => listSystemPolicyTracesMock(...args),
  previewSystemAccessDecision: (...args: unknown[]) => previewSystemAccessDecisionMock(...args),
  listSystemImportAudits: (...args: unknown[]) => listSystemImportAuditsMock(...args),
  listSystemExportAudits: (...args: unknown[]) => listSystemExportAuditsMock(...args)
}));

vi.mock("../services/accessPolicyApi", () => ({
  getAccessPolicyWorkspace: (...args: unknown[]) => getAccessPolicyWorkspaceMock(...args)
}));

const sessionTrust = {
  identityProvider: "local_password" as const,
  sessionAssurance: "standard" as const,
  requestTransport: "bearer" as const,
  elevatedUntil: null,
  privilegedModeUntil: null,
  breakGlassStartedAt: null,
  breakGlassUntil: null,
  breakGlassReason: null,
  breakGlassScopeType: null,
  breakGlassScopeId: null,
  elevatedSessionActive: false,
  privilegedModeActive: false,
  breakGlassModeActive: false
};

const adminUser: SessionUser = {
  id: "user-admin",
  tenantId: "tenant-demo",
  accountId: "account-demo",
  sessionId: "session-admin",
  email: "admin@example.com",
  fullName: "Admin User",
  status: "active",
  department: "operations",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["admin"],
  permissions: [
    "system.diagnostics.read",
    "system.audit.read",
    "system.sync.read",
    "system.repairs.manage",
    "system.trace.read",
    "system.policy_trace.read",
    "system.import_audit.read",
    "system.export_audit.read"
  ],
  authorityTier: "super_admin",
  primaryJobFunctionProfile: "leadership_team_member",
  jobFunctionProfiles: ["leadership_team_member"],
  permissionGrants: [],
  effectiveScopes: ["organization_wide_scope"],
  sessionTrust
};

const workspace: DiagnosticsWorkspaceResponse = {
  summary: {
    active_critical_findings: 1,
    open_repairs: 1,
    sync_failures: 1,
    recent_import_failures: 1,
    recent_export_count: 2,
    last_scan_at: "2026-04-02T15:00:00.000Z"
  },
  finding_counts: {
    open_count: 3,
    repairable_count: 1,
    critical_count: 1
  },
  health_checks: [
    {
      id: "health-1",
      tenant_id: "tenant-demo",
      check_key: "job_integrity",
      scope_type: "tenant",
      scope_value: null,
      status: "critical",
      summary: "Published jobs are missing required downstream records.",
      details_json: { missing_production: 1 },
      checked_at: "2026-04-02T15:00:00.000Z",
      created_at: "2026-04-02T15:00:00.000Z"
    }
  ],
  sync_health: [
    {
      id: "sync-1",
      tenant_id: "tenant-demo",
      sync_key: "alerts_delivery",
      resource_type: null,
      resource_id: null,
      status: "error",
      last_success_at: "2026-04-01T10:00:00.000Z",
      last_failure_at: "2026-04-02T09:00:00.000Z",
      failure_count: 3,
      last_error_code: "SMTP_FAIL",
      last_error_message: "Alert delivery queue is backing up.",
      metadata_json: null,
      created_at: "2026-04-02T09:00:00.000Z",
      updated_at: "2026-04-02T09:00:00.000Z"
    }
  ],
  recent_findings: [],
  recent_repairs: [],
  recent_audit_events: [],
  recent_policy_traces: [],
  recent_imports: [],
  recent_exports: []
};

const foundationDiagnostics: CoreFoundationDiagnosticsResponse = {
  generated_at: "2026-04-03T12:00:00.000Z",
  feature_flags: {
    diagnostics_enabled: true,
    workflow_engine_enabled: true,
    operational_events_enabled: true,
    global_search_enabled: true,
    activity_timeline_enabled: true,
    admin_configuration_enabled: true,
    approval_framework_enabled: true,
    reporting_enabled: true
  },
  startup_validation: {
    valid: false,
    issues: [
      {
        area: "config",
        severity: "warning",
        code: "config.allow_password_login_enabled",
        summary: "Password login remains enabled in production. Keep this limited to approved break-glass use."
      }
    ]
  },
  health_checks: [
    {
      area: "search",
      status: "warning",
      summary: "1 search domain has partial index coverage.",
      detail_count: 1,
      last_event_at: "2026-04-03T11:55:00.000Z",
      details: {
        coverage: [
          {
            entity_type: "task",
            base_count: 10,
            index_count: 9
          }
        ]
      }
    },
    {
      area: "approvals",
      status: "healthy",
      summary: "Approval routing and SLAs look healthy.",
      detail_count: 0,
      last_event_at: "2026-04-03T11:40:00.000Z",
      details: {}
    }
  ],
  recent_events: [
    {
      id: "audit-foundation-1",
      tenant_id: "tenant-demo",
      actor_user_id: "user-admin",
      actor_name: "Admin User",
      event_category: "reporting_foundation",
      event_type: "reporting_foundation.generated",
      resource_type: "reporting_foundation_query",
      resource_id: null,
      target_user_id: null,
      target_name: null,
      department_type: null,
      request_id: "req-foundation",
      trace_id: null,
      old_values_json: null,
      new_values_json: null,
      context_json: null,
      result: "results",
      created_at: "2026-04-03T11:56:00.000Z",
      message: "reporting_foundation / reporting_foundation.generated"
    }
  ]
};

const communicationDiagnostics: CommunicationDiagnosticsResponse = {
  generated_at: "2026-04-03T12:05:00.000Z",
  feature_flags: {
    diagnostics_enabled: true,
    identity_linking_enabled: true,
    teams_messaging_enabled: true,
    teams_meetings_enabled: true,
    in_app_actions_enabled: true,
    teams_embedded_entry_points_enabled: true
  },
  admin_controls: {
    default_meeting_mode: "calendar_event",
    embedded_defaults: {
      max_assigned_jobs: 4,
      max_assigned_tasks: 4,
      max_entries: 8
    }
  },
  startup_validation: {
    valid: false,
    issues: [
      {
        area: "teams_embedded_entry_points",
        severity: "warning",
        code: "teams_embedded_entry_points.manifest_domain_missing",
        summary: "Teams app validDomains is missing app.example.com."
      }
    ]
  },
  health_checks: [
    {
      area: "identity_linking",
      status: "warning",
      summary: "Some employee communication identities still need review or enablement.",
      detail_count: 2,
      last_event_at: "2026-04-03T11:30:00.000Z",
      details: {
        permissioned_user_count: 5,
        linked_ready_count: 3
      }
    },
    {
      area: "teams_messaging",
      status: "healthy",
      summary: "Teams messaging delivery looks healthy.",
      detail_count: 0,
      last_event_at: "2026-04-03T11:45:00.000Z",
      details: {}
    }
  ],
  recent_events: [
    {
      id: "audit-communication-1",
      tenant_id: "tenant-demo",
      actor_user_id: "user-admin",
      actor_name: "Admin User",
      event_category: "communication",
      event_type: "communication.teams_message.failed",
      resource_type: "teams_communication_delivery",
      resource_id: "delivery-1",
      target_user_id: null,
      target_name: null,
      department_type: null,
      request_id: "req-communication",
      trace_id: null,
      old_values_json: null,
      new_values_json: null,
      context_json: null,
      result: "failed",
      created_at: "2026-04-03T11:50:00.000Z",
      message: "communication / communication.teams_message.failed"
    }
  ]
};

const finding: DiagnosticFindingListItem = {
  id: "finding-1",
  tenant_id: "tenant-demo",
  finding_type: "workflow_gap",
  severity: "critical",
  status: "open",
  resource_type: "job",
  resource_id: "job-1",
  related_resource_type: null,
  related_resource_id: null,
  department_type: "sports",
  title: "Published job is missing its default production item",
  description: "The job needs a production item before downstream work can begin.",
  rule_key: "workflow_gap.missing_production_item",
  detected_at: "2026-04-02T15:05:00.000Z",
  owner_user_id: null,
  owner_name: null,
  recommended_action: "Generate the shared default production item.",
  repairable: true,
  resolved_at: null,
  resolved_by_user_id: null,
  resolved_by_name: null,
  resolution_note: null,
  created_at: "2026-04-02T15:05:00.000Z",
  updated_at: "2026-04-02T15:05:00.000Z",
  department_label: "Sports"
};

const repairPreview: RepairPreviewResponse = {
  repair_action: {
    id: "repair-1",
    tenant_id: "tenant-demo",
    action_key: "job.regenerate_default_production_item",
    resource_type: "job",
    resource_id: "job-1",
    requested_by_user_id: "user-admin",
    approved_by_user_id: null,
    executed_by_user_id: null,
    status: "dry_run_complete",
    dry_run: true,
    input_json: null,
    before_snapshot_json: { production_item_count: 0 },
    after_snapshot_json: { production_item_count: 1 },
    result_summary_json: null,
    created_at: "2026-04-02T15:10:00.000Z",
    executed_at: null,
    rolled_back_at: null,
    requested_by_name: "Admin User",
    approved_by_name: null,
    executed_by_name: null
  },
  preview_summary: {
    risk_level: "low",
    reversible: false,
    changes: ['Create shared production item "Proof Packet".']
  }
};

const accessWorkspace: AccessPolicyWorkspace = {
  summary: {
    role_count: 1,
    assignment_count: 1,
    delegation_count: 0,
    override_count: 0,
    audit_event_count: 1
  },
  roles: [],
  permissions: [],
  role_grants: [],
  users: [
    {
      user_id: "user-admin",
      full_name: "Admin User",
      email: "admin@example.com",
      department: "operations",
      membership_status: "active",
      authority_tier: "super_admin",
      primary_job_function_profile: "leadership_team_member",
      active_role_codes: ["admin"],
      microsoft_user_id: "ms-admin",
      microsoft_tenant_id: "tenant-demo",
      auth_provider: "microsoft_entra",
      communication_enabled: true,
      communication_posting_disabled_at: null,
      communication_posting_disabled_reason: null,
      teams_chat_default_target: null,
      linked_at: "2026-04-01T08:00:00.000Z",
      last_verified_at: "2026-04-02T08:00:00.000Z",
      communication_identity_status: "linked_ready"
    }
  ],
  assignments: [],
  delegations: [],
  overrides: [],
  field_rules: [],
  section_rules: [],
  audit_events: []
};

const accessPreview: AccessPolicyPreview = {
  user_id: "user-admin",
  route_id: "dashboard",
  resource_type: "shared_job",
  resource_id: null,
  allowed: true,
  permissions: ["job.read"],
  fields: {
    "shared_job.title": "editable"
  },
  sections: {
    summary: "editable"
  },
  actions: {
    update: true
  },
  explanation: ["Allowed by the admin global role."],
  trace_id: "trace-policy-1"
};

const policyTrace: PolicyDecisionTraceListItem = {
  id: "trace-policy-1",
  tenant_id: "tenant-demo",
  actor_user_id: "user-admin",
  actor_name: "Admin User",
  permission_key: "job.read",
  resource_type: "shared_job",
  resource_id: "job-1",
  scope_context_json: { departmentType: "sports" },
  decision: "allowed",
  decision_reason: "Allowed by the admin global role.",
  matched_rules_json: null,
  created_at: "2026-04-02T15:15:00.000Z"
};

const traceResponse: EntityTraceResponse = {
  resource_type: "job",
  resource_id: "job-1",
  resource_label: "Trace / SPT-2026-0012",
  timeline: [
    {
      id: "timeline-1",
      kind: "activity",
      created_at: "2026-04-02T15:00:00.000Z",
      title: "Job published",
      message: "Shared job published.",
      actor_name: "Admin User",
      severity: null,
      status: "completed",
      resource_type: "job",
      resource_id: "job-1",
      old_values_json: null,
      new_values_json: null,
      metadata_json: null
    },
    {
      id: "timeline-2",
      kind: "audit",
      created_at: "2026-04-02T15:10:00.000Z",
      title: "Repair completed",
      message: "Default production item generated.",
      actor_name: "Admin User",
      severity: null,
      status: "completed",
      resource_type: "job",
      resource_id: "job-1",
      old_values_json: { production_item_count: 0 },
      new_values_json: { production_item_count: 1 },
      metadata_json: null
    }
  ]
};

beforeEach(() => {
  window.location.hash = "#admin/system";

  getSystemDiagnosticsWorkspaceMock.mockReset();
  getSystemFoundationDiagnosticsMock.mockReset();
  getSystemCommunicationDiagnosticsMock.mockReset();
  listSystemDiagnosticFindingsMock.mockReset();
  updateSystemDiagnosticFindingMock.mockReset();
  runSystemDiagnosticRulesMock.mockReset();
  previewSystemRepairActionMock.mockReset();
  executeSystemRepairActionMock.mockReset();
  listSystemAuditEventsMock.mockReset();
  getSystemEntityTraceMock.mockReset();
  getSystemSyncHealthMock.mockReset();
  listSystemRepairActionsMock.mockReset();
  listSystemPolicyTracesMock.mockReset();
  previewSystemAccessDecisionMock.mockReset();
  listSystemImportAuditsMock.mockReset();
  listSystemExportAuditsMock.mockReset();
  getAccessPolicyWorkspaceMock.mockReset();

  getSystemDiagnosticsWorkspaceMock.mockResolvedValue(workspace);
  getSystemFoundationDiagnosticsMock.mockResolvedValue(foundationDiagnostics);
  getSystemCommunicationDiagnosticsMock.mockResolvedValue(communicationDiagnostics);
  listSystemDiagnosticFindingsMock.mockResolvedValue([finding]);
  updateSystemDiagnosticFindingMock.mockResolvedValue({ finding: { ...finding, status: "acknowledged" } });
  runSystemDiagnosticRulesMock.mockResolvedValue({
    runs: [
      {
        run: {
          id: "run-1",
          tenant_id: "tenant-demo",
          rule_key: "workflow_gap.missing_production_item",
          scope_type: "tenant",
          scope_value: null,
          status: "completed",
          started_at: "2026-04-02T15:20:00.000Z",
          completed_at: "2026-04-02T15:20:30.000Z",
          result_summary_json: null,
          trigger_type: "manual",
          triggered_by_user_id: "user-admin",
          created_at: "2026-04-02T15:20:00.000Z"
        },
        findings_created: 1,
        findings_updated: 0,
        findings_resolved: 0
      }
    ]
  });
  previewSystemRepairActionMock.mockResolvedValue(repairPreview);
  executeSystemRepairActionMock.mockResolvedValue({ repair_action: { ...repairPreview.repair_action, status: "completed" } });
  listSystemAuditEventsMock.mockResolvedValue([]);
  getSystemEntityTraceMock.mockResolvedValue(traceResponse);
  getSystemSyncHealthMock.mockResolvedValue({ sync_health: workspace.sync_health, health_checks: workspace.health_checks });
  listSystemRepairActionsMock.mockResolvedValue([]);
  listSystemPolicyTracesMock.mockResolvedValue([policyTrace]);
  previewSystemAccessDecisionMock.mockResolvedValue(accessPreview);
  listSystemImportAuditsMock.mockResolvedValue([]);
  listSystemExportAuditsMock.mockResolvedValue([]);
  getAccessPolicyWorkspaceMock.mockResolvedValue(accessWorkspace);
});

afterEach(() => {
  cleanup();
});

describe("SystemDiagnosticsPage", () => {
  it("renders the shared diagnostics overview, runs scans, and previews repair actions", async () => {
    render(<SystemDiagnosticsPage token="token-demo" currentUser={adminUser} view="overview" />);

    expect(await screen.findByText("Admin / System")).toBeInTheDocument();
    expect((await screen.findAllByText("Published job is missing its default production item")).length).toBeGreaterThan(0);
    expect(screen.getByRole("status")).toHaveTextContent("critical issue");
    expect(await screen.findByText("Core Foundation")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Run Diagnostics Scan" }));
    await waitFor(() => expect(runSystemDiagnosticRulesMock).toHaveBeenCalledWith("token-demo", { trigger_type: "manual" }));
    expect(await screen.findByText(/Created 1, updated 0, resolved 0./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Preview Repair" }));
    await waitFor(() =>
      expect(previewSystemRepairActionMock).toHaveBeenCalledWith("token-demo", {
        action_key: "job.regenerate_default_production_item",
        resource_type: "job",
        resource_id: "job-1"
      })
    );
    expect(await screen.findByText("Repair Preview: Published job is missing its default production item")).toBeInTheDocument();
    expect(screen.getByText('Create shared production item "Proof Packet".')).toBeInTheDocument();
  });

  it("renders the foundation diagnostics view with feature flags, validation issues, and recent events", async () => {
    render(<SystemDiagnosticsPage token="token-demo" currentUser={adminUser} view="foundation" />);

    expect(await screen.findByText("Admin / System / Foundation")).toBeInTheDocument();
    expect(screen.getByText("Feature Flags")).toBeInTheDocument();
    expect(screen.getByText("Startup Validation")).toBeInTheDocument();
    expect(screen.getByText("Health Checks")).toBeInTheDocument();
    expect(screen.getByText("Recent Foundation Events")).toBeInTheDocument();
    expect(
      screen.getByText("Password login remains enabled in production. Keep this limited to approved break-glass use.")
    ).toBeInTheDocument();
    expect(screen.getByText("reporting_foundation / reporting_foundation.generated")).toBeInTheDocument();
  });

  it("renders the communications diagnostics view with feature flags, admin controls, and recent communication events", async () => {
    render(<SystemDiagnosticsPage token="token-demo" currentUser={adminUser} view="communications" />);

    expect(await screen.findByText("Admin / System / Communications")).toBeInTheDocument();
    expect(screen.getByText("Feature Flags")).toBeInTheDocument();
    expect(screen.getByText("Admin Controls")).toBeInTheDocument();
    expect(screen.getByText("Default Meeting Mode")).toBeInTheDocument();
    expect(screen.getByText("Calendar Event")).toBeInTheDocument();
    expect(screen.getByText("Some employee communication identities still need review or enablement.")).toBeInTheDocument();
    expect(screen.getByText("communication / communication.teams_message.failed")).toBeInTheDocument();
  });

  it("renders access debug previews and recent policy traces through the shared admin surface", async () => {
    render(<SystemDiagnosticsPage token="token-demo" currentUser={adminUser} view="access-debug" />);

    expect(await screen.findByText("Access Preview")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview Access" }));

    await waitFor(() =>
      expect(previewSystemAccessDecisionMock).toHaveBeenCalledWith(
        "token-demo",
        expect.objectContaining({
          target_user_id: "user-admin",
          permission_keys: ["job.read"]
        })
      )
    );

    expect(await screen.findByText("Trace trace-policy-1")).toBeInTheDocument();
    expect(screen.getByText("Trace trace-policy-1")).toBeInTheDocument();
    expect(screen.getAllByText("Allowed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Allowed by the admin global role.").length).toBeGreaterThan(0);
  });

  it("renders the shared trace timeline and highlights changed values in the diff viewer", async () => {
    window.location.hash = "#admin/trace/job/job-1";

    render(<SystemDiagnosticsPage token="token-demo" currentUser={adminUser} view="trace" />);

    expect(await screen.findByText("Trace / SPT-2026-0012")).toBeInTheDocument();
    expect(screen.getByText("Job published")).toBeInTheDocument();
    expect(screen.getByText("Repair completed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Repair completed/i }));

    await waitFor(() => {
      expect(screen.getByText("production_item_count")).toBeInTheDocument();
      expect(screen.getByText("Repair completed")).toBeInTheDocument();
      expect(screen.getByText("Default production item generated.")).toBeInTheDocument();
    });
  });
});
