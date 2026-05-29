import { useEffect, useMemo, useState } from "react";
import type { AccessPolicyPreview, AccessPolicyPreviewInput, AccessPolicyWorkspace } from "../accessPolicyTypes";
import {
  CommunicationAdminControlsPanel,
  CommunicationFeatureFlagsPanel,
  CommunicationHealthGrid,
  CommunicationRecentEvents,
  CommunicationSummaryHeader,
  CommunicationValidationPanel,
  CoreFoundationFeatureFlagsPanel,
  CoreFoundationHealthGrid,
  CoreFoundationRecentEvents,
  CoreFoundationSummaryHeader,
  CoreFoundationValidationPanel,
  DashboardSection,
  DebugFilterBar,
  DiagnosticFindingsTable,
  DiagnosticRuleRunPanel,
  DiagnosticsDashboard,
  EntityAuditPanel,
  ExportAuditTable,
  ImportAuditTable,
  PermissionDecisionViewer,
  PolicyTracePanel,
  RepairActionModal,
  RepairActionPanel,
  SafeAdminBanner,
  SyncHealthBoard,
  SystemAuditShell,
  SystemHealthHeader,
  CriticalIssuesBanner
} from "../components/system/SystemDiagnosticsWorkspace";
import { getAccessPolicyWorkspace } from "../services/accessPolicyApi";
import {
  getSystemCommunicationDiagnostics,
  executeSystemRepairAction,
  getSystemFoundationDiagnostics,
  getSystemDiagnosticsWorkspace,
  getSystemEntityTrace,
  getSystemSyncHealth,
  listSystemAuditEvents,
  listSystemDiagnosticFindings,
  listSystemExportAudits,
  listSystemImportAudits,
  listSystemPolicyTraces,
  listSystemRepairActions,
  previewSystemAccessDecision,
  previewSystemRepairAction,
  runSystemDiagnosticRules,
  updateSystemDiagnosticFinding
} from "../services/systemDiagnosticsApi";
import type {
  AuditEventListItem,
  CommunicationDiagnosticsResponse,
  CoreFoundationDiagnosticsResponse,
  DiagnosticFindingListItem,
  DiagnosticRuleRunSummary,
  DiagnosticsWorkspaceResponse,
  EntityTraceResponse,
  ExportAuditListItem,
  ImportAuditListItem,
  PolicyDecisionTraceListItem,
  RepairActionListItem,
  RepairActionRequest,
  RepairPreviewResponse,
  SyncHealthRecord,
  SystemHealthCheckRecord,
  SystemDiagnosticsView
} from "../systemDiagnosticsTypes";
import { hasPermission } from "../permissions";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  view: SystemDiagnosticsView;
};

type RepairModalState = {
  title: string;
  request: RepairActionRequest;
  preview: RepairPreviewResponse;
} | null;

function parseTraceHash() {
  const hash = window.location.hash.replace(/^#/, "").split("?")[0] ?? "";
  const match = hash.match(/^admin\/trace\/([^/]+)\/([^/]+)$/i);
  return {
    resourceType: match?.[1] ?? "",
    resourceId: match?.[2] ?? ""
  };
}

function viewTitle(view: SystemDiagnosticsView) {
  switch (view) {
    case "overview":
      return "Admin / System";
    case "diagnostics":
      return "Admin / System / Diagnostics";
    case "foundation":
      return "Admin / System / Foundation";
    case "communications":
      return "Admin / System / Communications";
    case "audit":
      return "Admin / System / Audit";
    case "sync":
      return "Admin / System / Sync";
    case "repairs":
      return "Admin / System / Repairs";
    case "access-debug":
      return "Admin / System / Access Debug";
    case "imports":
      return "Admin / System / Imports";
    case "exports":
      return "Admin / System / Exports";
    case "trace":
      return "Admin / Trace";
    default:
      return "Admin / System";
  }
}

function viewSubtitle(view: SystemDiagnosticsView) {
  switch (view) {
    case "overview":
      return "Shared reliability, integrity, sync, and investigation command center for admins and tightly scoped technical maintainers.";
    case "diagnostics":
      return "Prioritized queue of integrity issues, workflow drift, missing links, and repairable failures.";
    case "foundation":
      return "Feature flags, startup validation, health checks, and recent reliability signals for the shared product foundation.";
    case "communications":
      return "Identity linking, Teams delivery health, deep-link validity, embedded entry points, and rollout controls for internal communications.";
    case "audit":
      return "Formal mutation and access history for cross-system investigation.";
    case "sync":
      return "Pipeline health, queue drift, and module integrity state.";
    case "repairs":
      return "Dry-run-first administrative repair actions with full audit coverage.";
    case "access-debug":
      return "Explain why a route, field, or action is allowed, denied, masked, or hidden.";
    case "imports":
      return "Import outcomes, rejected rows, and failure traces.";
    case "exports":
      return "Export scope, selected columns, and download audit safety.";
    case "trace":
      return "Unified entity timeline across activity, audit, findings, alerts, repairs, and policy traces.";
    default:
      return "";
  }
}

function tabHref(view: Exclude<SystemDiagnosticsView, "trace">) {
  if (view === "overview") {
    return "#admin/system";
  }
  if (view === "foundation") {
    return "#admin/system/foundation";
  }
  if (view === "communications") {
    return "#admin/system/communications";
  }
  return `#admin/system/${view}`;
}

function inferRepairRequest(finding: DiagnosticFindingListItem): RepairActionRequest {
  if (finding.rule_key === "workflow_gap.missing_production_item") {
    return {
      action_key: "job.regenerate_default_production_item",
      resource_type: "job",
      resource_id: finding.resource_id
    };
  }
  if (finding.rule_key.startsWith("status_drift.") || finding.rule_key === "core_data.missing_job_day") {
    return {
      action_key: "job.recompute_derived_status",
      resource_type: finding.resource_type === "job_day" ? "job" : finding.resource_type ?? "job",
      resource_id: finding.related_resource_id ?? finding.resource_id
    };
  }
  return {
    action_key: "diagnostics.rescan_record",
    resource_type: finding.resource_type ?? "job",
    resource_id: finding.resource_id
  };
}

export function SystemDiagnosticsPage({ token, currentUser, view }: Props) {
  const [workspace, setWorkspace] = useState<DiagnosticsWorkspaceResponse | null>(null);
  const [foundationDiagnostics, setFoundationDiagnostics] = useState<CoreFoundationDiagnosticsResponse | null>(null);
  const [communicationDiagnostics, setCommunicationDiagnostics] = useState<CommunicationDiagnosticsResponse | null>(null);
  const [findings, setFindings] = useState<DiagnosticFindingListItem[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventListItem[]>([]);
  const [syncPayload, setSyncPayload] = useState<{ sync_health: SyncHealthRecord[]; health_checks: SystemHealthCheckRecord[] } | null>(null);
  const [repairs, setRepairs] = useState<RepairActionListItem[]>([]);
  const [policyTraces, setPolicyTraces] = useState<PolicyDecisionTraceListItem[]>([]);
  const [imports, setImports] = useState<ImportAuditListItem[]>([]);
  const [exports, setExports] = useState<ExportAuditListItem[]>([]);
  const [trace, setTrace] = useState<EntityTraceResponse | null>(null);
  const [selectedTraceItemId, setSelectedTraceItemId] = useState<string | null>(null);
  const [runResults, setRunResults] = useState<DiagnosticRuleRunSummary[]>([]);
  const [repairModal, setRepairModal] = useState<RepairModalState>(null);
  const [repairBusy, setRepairBusy] = useState(false);
  const [workspaceUsers, setWorkspaceUsers] = useState<AccessPolicyWorkspace | null>(null);
  const [accessPreview, setAccessPreview] = useState<AccessPolicyPreview | null>(null);
  const [accessPreviewDraft, setAccessPreviewDraft] = useState<AccessPolicyPreviewInput & { permissionText: string }>({
    target_user_id: currentUser.id,
    route_id: "dashboard",
    resource_type: "shared_job",
    resource_id: null,
    permission_keys: ["job.read"],
    permissionText: "job.read",
    context: {
      departmentType: currentUser.department
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [traceHash, setTraceHash] = useState(() => window.location.hash);

  const traceContext = useMemo(() => parseTraceHash(), [traceHash]);
  const canReadDiagnostics = hasPermission(currentUser, "system.diagnostics.read");
  const canReadAudit = hasPermission(currentUser, "system.audit.read");
  const canReadSync = hasPermission(currentUser, "system.sync.read");
  const canManageRepairs = hasPermission(currentUser, "system.repairs.manage");
  const canReadPolicyTrace = hasPermission(currentUser, "system.policy_trace.read");
  const canReadImports = hasPermission(currentUser, "system.import_audit.read");
  const canReadExports = hasPermission(currentUser, "system.export_audit.read");

  useEffect(() => {
    const handleHashChange = () => setTraceHash(window.location.hash);
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  async function loadViewData() {
    setLoading(true);
    setError("");
    try {
      if (view === "overview") {
        const [workspaceResponse, findingsResponse, foundationResponse] = await Promise.all([
          getSystemDiagnosticsWorkspace(token),
          listSystemDiagnosticFindings(token, { open_only: true, limit: 50 }),
          getSystemFoundationDiagnostics(token)
        ]);
        setWorkspace(workspaceResponse);
        setFindings(findingsResponse);
        setFoundationDiagnostics(foundationResponse);
      } else if (view === "foundation") {
        setFoundationDiagnostics(await getSystemFoundationDiagnostics(token));
      } else if (view === "communications") {
        setCommunicationDiagnostics(await getSystemCommunicationDiagnostics(token));
      } else if (view === "diagnostics") {
        const [workspaceResponse, findingsResponse] = await Promise.all([
          getSystemDiagnosticsWorkspace(token),
          listSystemDiagnosticFindings(token, { limit: 200 })
        ]);
        setWorkspace(workspaceResponse);
        setFindings(findingsResponse);
      } else if (view === "audit") {
        setAuditEvents(await listSystemAuditEvents(token, { limit: 200 }));
      } else if (view === "sync") {
        const [workspaceResponse, syncResponse] = await Promise.all([getSystemDiagnosticsWorkspace(token), getSystemSyncHealth(token)]);
        setWorkspace(workspaceResponse);
        setSyncPayload(syncResponse);
      } else if (view === "repairs") {
        setRepairs(await listSystemRepairActions(token, 200));
      } else if (view === "access-debug") {
        const [traceRows, accessWorkspace] = await Promise.all([
          listSystemPolicyTraces(token, { limit: 100 }),
          getAccessPolicyWorkspace(token)
        ]);
        setPolicyTraces(traceRows);
        setWorkspaceUsers(accessWorkspace);
        if (accessWorkspace.users[0] && !accessPreviewDraft.target_user_id) {
          setAccessPreviewDraft((current) => ({
            ...current,
            target_user_id: accessWorkspace.users[0].user_id
          }));
        }
      } else if (view === "imports") {
        setImports(await listSystemImportAudits(token, 200));
      } else if (view === "exports") {
        setExports(await listSystemExportAudits(token, 200));
      } else if (view === "trace") {
        if (!traceContext.resourceType || !traceContext.resourceId) {
          setTrace(null);
        } else {
          const traceResponse = await getSystemEntityTrace(token, traceContext.resourceType, traceContext.resourceId);
          setTrace(traceResponse);
          setSelectedTraceItemId(traceResponse.timeline[0]?.id ?? null);
        }
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load admin diagnostics.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadViewData();
  }, [traceContext.resourceId, traceContext.resourceType, token, view]);

  async function refreshAfterAction() {
    await loadViewData();
  }

  async function handleFindingUpdate(finding: DiagnosticFindingListItem, status: "acknowledged" | "resolved") {
    await updateSystemDiagnosticFinding(token, finding.id, { status });
    setMessage(status === "resolved" ? "Finding resolved." : "Finding acknowledged.");
    await refreshAfterAction();
  }

  async function handleRunDiagnostics() {
    const response = await runSystemDiagnosticRules(token, { trigger_type: "manual" });
    setRunResults(response.runs);
    setMessage("Diagnostics scan completed.");
    await refreshAfterAction();
  }

  async function handlePreviewRepair(finding: DiagnosticFindingListItem) {
    const request = inferRepairRequest(finding);
    const preview = await previewSystemRepairAction(token, request);
    setRepairModal({
      title: `Repair Preview: ${finding.title}`,
      request,
      preview
    });
  }

  async function handleExecuteRepair() {
    if (!repairModal) {
      return;
    }
    setRepairBusy(true);
    try {
      await executeSystemRepairAction(token, repairModal.request);
      setMessage("Repair action completed.");
      setRepairModal(null);
      await refreshAfterAction();
    } catch (executeError) {
      setError(executeError instanceof Error ? executeError.message : "Repair action failed.");
    } finally {
      setRepairBusy(false);
    }
  }

  async function handleAccessPreview() {
    const preview = await previewSystemAccessDecision(token, {
      ...accessPreviewDraft,
      permission_keys: accessPreviewDraft.permissionText
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    });
    setAccessPreview(preview);
    setMessage("Access decision preview updated.");
    const traces = await listSystemPolicyTraces(token, { limit: 100 });
    setPolicyTraces(traces);
  }

  const availableTabs = [
    { key: "overview" as const, label: "Overview", enabled: canReadDiagnostics },
    { key: "foundation" as const, label: "Foundation", enabled: canReadDiagnostics },
    { key: "communications" as const, label: "Communications", enabled: canReadDiagnostics },
    { key: "diagnostics" as const, label: "Diagnostics", enabled: canReadDiagnostics },
    { key: "audit" as const, label: "Audit", enabled: canReadAudit },
    { key: "sync" as const, label: "Sync", enabled: canReadSync },
    { key: "repairs" as const, label: "Repairs", enabled: canManageRepairs },
    { key: "access-debug" as const, label: "Access Debug", enabled: canReadPolicyTrace },
    { key: "imports" as const, label: "Imports", enabled: canReadImports },
    { key: "exports" as const, label: "Exports", enabled: canReadExports }
  ];

  return (
    <section className="workspace-shell">
      <SafeAdminBanner
        title={viewTitle(view)}
        body={viewSubtitle(view)}
      />

      {view !== "trace" ? (
        <nav className="segmented-control" aria-label="Admin system tabs">
          {availableTabs
            .filter((tab) => tab.enabled)
            .map((tab) => (
              <a
                key={tab.key}
                href={tabHref(tab.key)}
                className={`segmented-control__item${view === tab.key ? " segmented-control__item--active" : ""}`}
              >
                {tab.label}
              </a>
            ))}
        </nav>
      ) : null}

      {error ? <div className="panel error-state">{error}</div> : null}
      {message ? <div className="panel success-state">{message}</div> : null}

      {loading ? (
        <div className="panel loading-panel">
          <div className="section-title">Loading diagnostics</div>
          <p className="section-subtitle">Pulling the latest audit, integrity, sync, and repair state.</p>
        </div>
      ) : null}

      {!loading && view === "overview" && workspace ? (
        <>
          <SystemHealthHeader workspace={workspace} />
          <CriticalIssuesBanner findings={findings} />
          <DiagnosticsDashboard workspace={workspace} findings={findings} />
          <DashboardSection
            title="Recent Findings"
            subtitle="Open integrity and workflow issues that currently shape system health."
            actions={canReadDiagnostics ? <button onClick={handleRunDiagnostics}>Run Diagnostics Scan</button> : null}
          >
            <DiagnosticRuleRunPanel runs={runResults} />
            <DiagnosticFindingsTable
              findings={findings.slice(0, 12)}
              onAcknowledge={(finding) => void handleFindingUpdate(finding, "acknowledged")}
              onResolve={(finding) => void handleFindingUpdate(finding, "resolved")}
              onPreviewRepair={canManageRepairs ? (finding) => void handlePreviewRepair(finding) : undefined}
              onOpenTrace={(finding) => {
                const resourceType = finding.resource_type ?? finding.related_resource_type;
                const resourceId = finding.resource_id ?? finding.related_resource_id;
                if (resourceType && resourceId) {
                  window.location.hash = `#admin/trace/${resourceType}/${resourceId}`;
                }
              }}
            />
          </DashboardSection>
          <DashboardSection title="Recent Repairs" subtitle="Dry runs and executed repairs with before/after state.">
            <RepairActionPanel repairs={workspace.recent_repairs} />
          </DashboardSection>
          {foundationDiagnostics ? (
            <DashboardSection
              title="Core Foundation"
              subtitle="Runtime health, startup validation, and the most recent reliability signals across search, workflow, approvals, reporting, and config."
              actions={<a className="secondary-button" href="#admin/system/foundation">Open Foundation Diagnostics</a>}
            >
              <CoreFoundationSummaryHeader diagnostics={foundationDiagnostics} />
              <CoreFoundationHealthGrid diagnostics={foundationDiagnostics} />
            </DashboardSection>
          ) : null}
        </>
      ) : null}

      {!loading && view === "foundation" && foundationDiagnostics ? (
        <>
          <CoreFoundationSummaryHeader diagnostics={foundationDiagnostics} />
          <DashboardSection title="Feature Flags" subtitle="Rollout controls for the core product foundation.">
            <CoreFoundationFeatureFlagsPanel diagnostics={foundationDiagnostics} />
          </DashboardSection>
          <DashboardSection title="Startup Validation" subtitle="Safe-start checks that help catch broken deploys and contradictory runtime controls.">
            <CoreFoundationValidationPanel diagnostics={foundationDiagnostics} />
          </DashboardSection>
          <DashboardSection title="Health Checks" subtitle="Live status across data integrity, permissions, workflow, events, search, activity, config, approvals, and reporting.">
            <CoreFoundationHealthGrid diagnostics={foundationDiagnostics} />
          </DashboardSection>
          <DashboardSection title="Recent Foundation Events" subtitle="Recent audit and telemetry signals for the hardened foundation surfaces.">
            <CoreFoundationRecentEvents events={foundationDiagnostics.recent_events} />
          </DashboardSection>
        </>
      ) : null}

      {!loading && view === "communications" && communicationDiagnostics ? (
        <>
          <CommunicationSummaryHeader diagnostics={communicationDiagnostics} />
          <DashboardSection title="Feature Flags" subtitle="Rollout controls for internal communication capabilities.">
            <CommunicationFeatureFlagsPanel diagnostics={communicationDiagnostics} />
          </DashboardSection>
          <DashboardSection title="Admin Controls" subtitle="Current runtime defaults for meeting orchestration and the Teams embedded communications hub.">
            <CommunicationAdminControlsPanel diagnostics={communicationDiagnostics} />
          </DashboardSection>
          <DashboardSection title="Startup Validation" subtitle="Safe-start checks for identity linking, Teams delivery, deep links, and embedded entry-point readiness.">
            <CommunicationValidationPanel diagnostics={communicationDiagnostics} />
          </DashboardSection>
          <DashboardSection title="Health Checks" subtitle="Live status across identity linking, Teams messaging, Teams meetings, in-app actions, embedded entry points, and configuration.">
            <CommunicationHealthGrid diagnostics={communicationDiagnostics} />
          </DashboardSection>
          <DashboardSection title="Recent Communication Events" subtitle="Recent audit and telemetry signals for communication identity, message delivery, and meeting sync flows.">
            <CommunicationRecentEvents events={communicationDiagnostics.recent_events} />
          </DashboardSection>
        </>
      ) : null}

      {!loading && view === "diagnostics" ? (
        <DashboardSection
          title="Diagnostics Findings"
          subtitle="Searchable integrity and workflow drift queue."
          actions={<button onClick={handleRunDiagnostics}>Run Diagnostics Scan</button>}
        >
          <DebugFilterBar>
            <span>{findings.length} finding(s)</span>
          </DebugFilterBar>
          <DiagnosticRuleRunPanel runs={runResults} />
          <DiagnosticFindingsTable
            findings={findings}
            onAcknowledge={(finding) => void handleFindingUpdate(finding, "acknowledged")}
            onResolve={(finding) => void handleFindingUpdate(finding, "resolved")}
            onPreviewRepair={canManageRepairs ? (finding) => void handlePreviewRepair(finding) : undefined}
            onOpenTrace={(finding) => {
              const resourceType = finding.resource_type ?? finding.related_resource_type;
              const resourceId = finding.resource_id ?? finding.related_resource_id;
              if (resourceType && resourceId) {
                window.location.hash = `#admin/trace/${resourceType}/${resourceId}`;
              }
            }}
          />
        </DashboardSection>
      ) : null}

      {!loading && view === "audit" ? (
        <DashboardSection title="Audit Events" subtitle="Formal mutation and access history across the platform.">
          <SystemAuditShell events={auditEvents} />
        </DashboardSection>
      ) : null}

      {!loading && view === "sync" ? (
        <>
          {workspace ? <SystemHealthHeader workspace={workspace} /> : null}
          <DashboardSection title="Sync Health" subtitle="Pipeline health, failure counts, and last-known errors.">
            <SyncHealthBoard records={syncPayload?.sync_health ?? []} />
          </DashboardSection>
        </>
      ) : null}

      {!loading && view === "repairs" ? (
        <DashboardSection title="Repair Actions" subtitle="Safe dry-run-first repair history and recent executions.">
          <RepairActionPanel repairs={repairs} />
        </DashboardSection>
      ) : null}

      {!loading && view === "access-debug" ? (
        <>
          <DashboardSection title="Access Preview" subtitle="Explain why a route, field, or action is visible or denied.">
            <div className="admin-settings__form-grid">
              <label>
                <span>Target User</span>
                <select
                  value={accessPreviewDraft.target_user_id}
                  onChange={(event) =>
                    setAccessPreviewDraft((current) => ({
                      ...current,
                      target_user_id: event.target.value
                    }))
                  }
                >
                  {(workspaceUsers?.users ?? [{ user_id: currentUser.id, full_name: currentUser.fullName, email: currentUser.email, department: currentUser.department, authority_tier: currentUser.authorityTier, primary_job_function_profile: currentUser.primaryJobFunctionProfile, active_role_codes: currentUser.roles }]).map((user) => (
                    <option key={user.user_id} value={user.user_id}>
                      {user.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Route</span>
                <input
                  value={accessPreviewDraft.route_id ?? ""}
                  onChange={(event) =>
                    setAccessPreviewDraft((current) => ({
                      ...current,
                      route_id: event.target.value || null
                    }))
                  }
                />
              </label>
              <label>
                <span>Resource Type</span>
                <input
                  value={accessPreviewDraft.resource_type ?? ""}
                  onChange={(event) =>
                    setAccessPreviewDraft((current) => ({
                      ...current,
                      resource_type: event.target.value || null
                    }))
                  }
                />
              </label>
              <label>
                <span>Resource Id</span>
                <input
                  value={accessPreviewDraft.resource_id ?? ""}
                  onChange={(event) =>
                    setAccessPreviewDraft((current) => ({
                      ...current,
                      resource_id: event.target.value || null
                    }))
                  }
                />
              </label>
              <label className="admin-settings__form-grid admin-settings__form-grid--full">
                <span>Permissions</span>
                <input
                  aria-label="Permissions"
                  value={accessPreviewDraft.permissionText}
                  onChange={(event) =>
                    setAccessPreviewDraft((current) => ({
                      ...current,
                      permissionText: event.target.value
                    }))
                  }
                />
              </label>
            </div>
            <div className="access-actions">
              <button onClick={() => void handleAccessPreview()}>Preview Access</button>
            </div>
            <PermissionDecisionViewer preview={accessPreview} />
          </DashboardSection>
          <DashboardSection title="Recent Policy Traces" subtitle="Matched rules and decisions captured for recent access previews.">
            <PolicyTracePanel traces={policyTraces} />
          </DashboardSection>
        </>
      ) : null}

      {!loading && view === "imports" ? (
        <DashboardSection title="Import Audit" subtitle="Import counts, failures, and rejected rows.">
          <ImportAuditTable records={imports} />
        </DashboardSection>
      ) : null}

      {!loading && view === "exports" ? (
        <DashboardSection title="Export Audit" subtitle="Export scope, selected columns, and row counts.">
          <ExportAuditTable records={exports} />
        </DashboardSection>
      ) : null}

      {!loading && view === "trace" ? (
        <DashboardSection title={trace?.resource_label ?? "Trace View"} subtitle="Unified resource timeline across activity, audit, findings, alerts, repairs, and policy traces.">
          {trace ? (
            <EntityAuditPanel trace={trace} selectedItemId={selectedTraceItemId} onSelectItem={setSelectedTraceItemId} />
          ) : (
            <div className="empty-state">No trace data for this resource.</div>
          )}
        </DashboardSection>
      ) : null}

      <RepairActionModal
        title={repairModal?.title ?? "Repair Preview"}
        preview={repairModal?.preview ?? null}
        onClose={() => setRepairModal(null)}
        onConfirm={() => void handleExecuteRepair()}
        busy={repairBusy}
      />
    </section>
  );
}
