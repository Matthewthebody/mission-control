import type { ReactNode } from "react";
import type { AccessPolicyPreview } from "../../accessPolicyTypes";
import type {
  AuditEventListItem,
  CommunicationDiagnosticsResponse,
  CoreFoundationDiagnosticsResponse,
  CoreFoundationHealthCheck,
  DiagnosticFindingListItem,
  DiagnosticRuleRunSummary,
  DiagnosticsWorkspaceResponse,
  EntityTraceResponse,
  ExportAuditListItem,
  ImportAuditListItem,
  PolicyDecisionTraceListItem,
  RepairActionListItem,
  RepairPreviewResponse,
  SyncHealthRecord,
  SystemHealthCheckRecord
} from "../../systemDiagnosticsTypes";

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not set";
}

function humanize(value: string | null | undefined) {
  return (value ?? "Unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function severityTone(value: string | null | undefined) {
  if (value === "critical") {
    return "danger";
  }
  if (value === "high") {
    return "warning";
  }
  if (value === "medium") {
    return "info";
  }
  return "neutral";
}

function healthTone(value: string | null | undefined) {
  if (value === "critical") {
    return "danger";
  }
  if (value === "at_risk") {
    return "warning";
  }
  if (value === "watch") {
    return "info";
  }
  return "success";
}

function foundationHealthTone(value: string | null | undefined) {
  if (value === "failing") {
    return "danger";
  }
  if (value === "warning") {
    return "warning";
  }
  if (value === "disabled") {
    return "neutral";
  }
  return "success";
}

export function SafeAdminBanner({ title, body }: { title: string; body: string }) {
  return (
    <section className="panel system-admin-banner">
      <div className="section-title">{title}</div>
      <p className="section-subtitle">{body}</p>
    </section>
  );
}

export function DashboardSection({
  title,
  subtitle,
  actions,
  children
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel system-dashboard-section">
      <div className="system-dashboard-section__header">
        <div>
          <div className="section-title">{title}</div>
          {subtitle ? <p className="section-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="system-dashboard-section__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function DashboardWidgetFrame({ children }: { children: ReactNode }) {
  return <article className="system-widget-frame">{children}</article>;
}

export function DiagnosticSummaryCard({
  label,
  value,
  tone = "neutral",
  detail
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
  detail?: string;
}) {
  return (
    <DashboardWidgetFrame>
      <div className={`system-summary-card system-summary-card--${tone}`}>
        <div className="system-summary-card__label">{label}</div>
        <div className="system-summary-card__value">{value}</div>
        {detail ? <div className="system-summary-card__detail">{detail}</div> : null}
      </div>
    </DashboardWidgetFrame>
  );
}

export function OpsKpiCard(props: { label: string; value: string | number; tone?: "neutral" | "info" | "success" | "warning" | "danger"; detail?: string }) {
  return <DiagnosticSummaryCard {...props} />;
}

export function SystemHealthHeader({ workspace }: { workspace: DiagnosticsWorkspaceResponse }) {
  return (
    <div className="system-health-header">
      <DiagnosticSummaryCard
        label="Critical Findings"
        value={workspace.summary.active_critical_findings}
        tone={workspace.summary.active_critical_findings > 0 ? "danger" : "success"}
        detail="Open critical integrity or workflow failures"
      />
      <DiagnosticSummaryCard
        label="Open Repairs"
        value={workspace.summary.open_repairs}
        tone={workspace.summary.open_repairs > 0 ? "warning" : "neutral"}
        detail="Dry runs or executions still in motion"
      />
      <DiagnosticSummaryCard
        label="Sync Failures"
        value={workspace.summary.sync_failures}
        tone={workspace.summary.sync_failures > 0 ? "danger" : "success"}
        detail="Pipelines with warning or error health"
      />
      <DiagnosticSummaryCard
        label="Last Scan"
        value={workspace.summary.last_scan_at ? new Date(workspace.summary.last_scan_at).toLocaleTimeString() : "Not run"}
        tone="info"
        detail={workspace.summary.last_scan_at ? new Date(workspace.summary.last_scan_at).toLocaleDateString() : "Diagnostics scan pending"}
      />
    </div>
  );
}

export function CriticalIssuesBanner({ findings }: { findings: DiagnosticFindingListItem[] }) {
  const critical = findings.filter((finding) => finding.severity === "critical");
  if (critical.length === 0) {
    return null;
  }
  return (
    <div className="system-critical-banner" role="status">
      <strong>{critical.length} critical issue{critical.length === 1 ? "" : "s"} need immediate review.</strong>
      <span>{critical[0].title}</span>
    </div>
  );
}

export function HealthCheckCard({ check }: { check: SystemHealthCheckRecord }) {
  return (
    <DashboardWidgetFrame>
      <article className={`system-health-card system-health-card--${healthTone(check.status)}`}>
        <div className="system-health-card__header">
          <strong>{humanize(check.check_key)}</strong>
          <span className={`badge-pill status-chip status-chip--${healthTone(check.status)}`}>{humanize(check.status)}</span>
        </div>
        <p>{check.summary}</p>
        <small>Checked {formatDateTime(check.checked_at)}</small>
      </article>
    </DashboardWidgetFrame>
  );
}

export function SyncHealthCard({ record }: { record: SyncHealthRecord }) {
  return (
    <article className={`system-sync-card system-sync-card--${healthTone(record.status)}`}>
      <div className="system-sync-card__header">
        <strong>{humanize(record.sync_key)}</strong>
        <span className={`badge-pill status-chip status-chip--${healthTone(record.status)}`}>{humanize(record.status)}</span>
      </div>
      <dl className="system-definition-list">
        <div>
          <dt>Last success</dt>
          <dd>{formatDateTime(record.last_success_at)}</dd>
        </div>
        <div>
          <dt>Last failure</dt>
          <dd>{formatDateTime(record.last_failure_at)}</dd>
        </div>
        <div>
          <dt>Failures</dt>
          <dd>{record.failure_count}</dd>
        </div>
      </dl>
      {record.last_error_message ? <p className="system-sync-card__error">{record.last_error_message}</p> : null}
    </article>
  );
}

export function SyncHealthBoard({ records }: { records: SyncHealthRecord[] }) {
  if (records.length === 0) {
    return <div className="empty-state">No sync failures or tracked pipelines in this scope.</div>;
  }
  return <div className="system-sync-grid">{records.map((record) => <SyncHealthCard key={record.id} record={record} />)}</div>;
}

export function DiagnosticFindingCard({
  finding,
  actions
}: {
  finding: DiagnosticFindingListItem;
  actions?: ReactNode;
}) {
  return (
    <article className={`system-finding-card system-finding-card--${severityTone(finding.severity)}`}>
      <div className="system-finding-card__header">
        <strong>{finding.title}</strong>
        <span className={`badge-pill status-chip status-chip--${severityTone(finding.severity)}`}>{humanize(finding.severity)}</span>
      </div>
      <p>{finding.description}</p>
      <dl className="system-definition-list">
        <div>
          <dt>Rule</dt>
          <dd>{finding.rule_key}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{humanize(finding.status)}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{finding.owner_name ?? "Unassigned"}</dd>
        </div>
      </dl>
      {actions ? <div className="system-finding-card__actions">{actions}</div> : null}
    </article>
  );
}

export function DiagnosticFindingsTable({
  findings,
  onAcknowledge,
  onResolve,
  onPreviewRepair,
  onOpenTrace
}: {
  findings: DiagnosticFindingListItem[];
  onAcknowledge?: (finding: DiagnosticFindingListItem) => void;
  onResolve?: (finding: DiagnosticFindingListItem) => void;
  onPreviewRepair?: (finding: DiagnosticFindingListItem) => void;
  onOpenTrace?: (finding: DiagnosticFindingListItem) => void;
}) {
  if (findings.length === 0) {
    return <div className="empty-state">No diagnostic findings match the current filters.</div>;
  }
  return (
    <div className="table-scroll">
      <table className="data-table system-data-table">
        <thead>
          <tr>
            <th>Severity</th>
            <th>Title</th>
            <th>Rule</th>
            <th>Resource</th>
            <th>Status</th>
            <th>Owner</th>
            <th>Detected</th>
            <th>Repair</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((finding) => (
            <tr key={finding.id}>
              <td>
                <span className={`badge-pill status-chip status-chip--${severityTone(finding.severity)}`}>{humanize(finding.severity)}</span>
              </td>
              <td>
                <strong>{finding.title}</strong>
                <div className="table-subtle">{finding.finding_type}</div>
              </td>
              <td>{finding.rule_key}</td>
              <td>{finding.resource_type && finding.resource_id ? `${finding.resource_type}:${finding.resource_id}` : "Global"}</td>
              <td>{humanize(finding.status)}</td>
              <td>{finding.owner_name ?? "Unassigned"}</td>
              <td>{formatDateTime(finding.detected_at)}</td>
              <td>{finding.repairable ? "Repairable" : "Review only"}</td>
              <td>
                <div className="system-inline-actions">
                  {onOpenTrace ? <button onClick={() => onOpenTrace(finding)}>Trace</button> : null}
                  {onAcknowledge && finding.status === "open" ? <button onClick={() => onAcknowledge(finding)}>Acknowledge</button> : null}
                  {onResolve && finding.status !== "resolved" ? <button onClick={() => onResolve(finding)}>Resolve</button> : null}
                  {onPreviewRepair && finding.repairable ? (
                    <button className="secondary-button" onClick={() => onPreviewRepair(finding)}>
                      Preview Repair
                    </button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AuditDiffViewer({
  oldValues,
  newValues
}: {
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}) {
  const keys = [...new Set([...Object.keys(oldValues ?? {}), ...Object.keys(newValues ?? {})])];
  if (keys.length === 0) {
    return <div className="empty-state">No field-level diff is attached to this event.</div>;
  }
  return (
    <div className="table-scroll">
      <table className="data-table system-data-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Before</th>
            <th>After</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const before = oldValues?.[key] ?? null;
            const after = newValues?.[key] ?? null;
            const changed = JSON.stringify(before) !== JSON.stringify(after);
            return (
              <tr key={key} className={changed ? "system-diff-row system-diff-row--changed" : undefined}>
                <td>{key}</td>
                <td><code>{JSON.stringify(before)}</code></td>
                <td><code>{JSON.stringify(after)}</code></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TraceTimelineView({
  trace,
  selectedItemId,
  onSelectItem
}: {
  trace: EntityTraceResponse;
  selectedItemId: string | null;
  onSelectItem?: (itemId: string) => void;
}) {
  if (trace.timeline.length === 0) {
    return <div className="empty-state">No trace data exists for this resource yet.</div>;
  }
  return (
    <div className="system-trace-list">
      {trace.timeline.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`system-trace-item${selectedItemId === item.id ? " system-trace-item--active" : ""}`}
          onClick={() => onSelectItem?.(item.id)}
        >
          <div className="system-trace-item__header">
            <strong>{item.title}</strong>
            <span>{formatDateTime(item.created_at)}</span>
          </div>
          <div className="system-trace-item__meta">
            <span>{humanize(item.kind)}</span>
            {item.status ? <span>{humanize(item.status)}</span> : null}
            {item.severity ? <span>{humanize(item.severity)}</span> : null}
            {item.actor_name ? <span>{item.actor_name}</span> : null}
          </div>
          <p>{item.message}</p>
        </button>
      ))}
    </div>
  );
}

export function EntityAuditPanel({
  trace,
  selectedItemId,
  onSelectItem
}: {
  trace: EntityTraceResponse;
  selectedItemId: string | null;
  onSelectItem?: (itemId: string) => void;
}) {
  const selected = trace.timeline.find((item) => item.id === selectedItemId) ?? trace.timeline[0] ?? null;
  return (
    <div className="system-entity-audit">
      <div>
        <div className="section-title">Trace Timeline</div>
        <TraceTimelineView trace={trace} selectedItemId={selected?.id ?? null} onSelectItem={onSelectItem} />
      </div>
      <div>
        <div className="section-title">Diff Viewer</div>
        {selected ? (
          <AuditDiffViewer oldValues={selected.old_values_json} newValues={selected.new_values_json} />
        ) : (
          <div className="empty-state">Select a trace event to inspect its diff.</div>
        )}
      </div>
    </div>
  );
}

export function SystemAuditShell({ events }: { events: AuditEventListItem[] }) {
  if (events.length === 0) {
    return <div className="empty-state">No audit events match the current filters.</div>;
  }
  return (
    <div className="table-scroll">
      <table className="data-table system-data-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Actor</th>
            <th>Event</th>
            <th>Resource</th>
            <th>Result</th>
            <th>Request</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td>{formatDateTime(event.created_at)}</td>
              <td>{event.actor_name ?? "System"}</td>
              <td>
                <strong>{event.message}</strong>
                <div className="table-subtle">{event.event_type}</div>
              </td>
              <td>{event.resource_type}:{event.resource_id ?? "global"}</td>
              <td>{humanize(event.result)}</td>
              <td>{event.request_id ?? "Not captured"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DiagnosticRuleRunPanel({ runs }: { runs: DiagnosticRuleRunSummary[] }) {
  if (runs.length === 0) {
    return null;
  }
  return (
    <div className="system-inline-stack">
      {runs.map((run) => (
        <article key={run.run.id} className="system-mini-card">
          <strong>{run.run.rule_key}</strong>
          <p>
            Created {run.findings_created}, updated {run.findings_updated}, resolved {run.findings_resolved}.
          </p>
        </article>
      ))}
    </div>
  );
}

export function RepairDryRunSummary({ preview }: { preview: RepairPreviewResponse }) {
  return (
    <div className="system-inline-stack">
      <div className="system-mini-card">
        <strong>Risk level</strong>
        <p>{humanize(preview.preview_summary.risk_level)}</p>
      </div>
      <div className="system-mini-card">
        <strong>Reversible</strong>
        <p>{preview.preview_summary.reversible ? "Yes" : "No"}</p>
      </div>
      <div className="system-mini-card">
        <strong>Expected changes</strong>
        <ul className="system-list">
          {preview.preview_summary.changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function RepairActionModal({
  title,
  preview,
  onClose,
  onConfirm,
  busy
}: {
  title: string;
  preview: RepairPreviewResponse | null;
  onClose: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  if (!preview) {
    return null;
  }
  return (
    <div className="system-modal-backdrop" role="presentation">
      <div className="system-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="system-modal__header">
          <strong>{title}</strong>
          <button className="secondary-button" onClick={onClose}>Close</button>
        </div>
        <RepairDryRunSummary preview={preview} />
        <div className="system-modal__actions">
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          <button onClick={onConfirm} disabled={busy}>{busy ? "Running..." : "Run Repair"}</button>
        </div>
      </div>
    </div>
  );
}

export function RepairActionPanel({ repairs }: { repairs: RepairActionListItem[] }) {
  if (repairs.length === 0) {
    return <div className="empty-state">No repair actions have been run in this scope.</div>;
  }
  return (
    <div className="table-scroll">
      <table className="data-table system-data-table">
        <thead>
          <tr>
            <th>Action</th>
            <th>Resource</th>
            <th>Status</th>
            <th>Requested By</th>
            <th>Created</th>
            <th>Executed</th>
          </tr>
        </thead>
        <tbody>
          {repairs.map((repair) => (
            <tr key={repair.id}>
              <td>{repair.action_key}</td>
              <td>{repair.resource_type}:{repair.resource_id ?? "global"}</td>
              <td>{humanize(repair.status)}</td>
              <td>{repair.requested_by_name ?? "Unknown"}</td>
              <td>{formatDateTime(repair.created_at)}</td>
              <td>{formatDateTime(repair.executed_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PermissionDecisionViewer({ preview }: { preview: AccessPolicyPreview | null }) {
  if (!preview) {
    return <div className="empty-state">Run an access preview to inspect the matched decision.</div>;
  }
  return (
    <div className="system-inline-stack">
      <div className="system-mini-card">
        <strong>Decision</strong>
        <p>{preview.allowed ? "Allowed" : "Denied"}</p>
        <small>Trace {preview.trace_id}</small>
      </div>
      <div className="system-mini-card">
        <strong>Permissions</strong>
        <ul className="system-list">
          {preview.permissions.map((permission) => (
            <li key={permission}>{permission}</li>
          ))}
        </ul>
      </div>
      <div className="system-mini-card">
        <strong>Explanation</strong>
        <ul className="system-list">
          {preview.explanation.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function PolicyTracePanel({ traces }: { traces: PolicyDecisionTraceListItem[] }) {
  if (traces.length === 0) {
    return <div className="empty-state">No policy decision traces match the current filters.</div>;
  }
  return (
    <div className="table-scroll">
      <table className="data-table system-data-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Actor</th>
            <th>Permission</th>
            <th>Decision</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {traces.map((trace) => (
            <tr key={trace.id}>
              <td>{formatDateTime(trace.created_at)}</td>
              <td>{trace.actor_name ?? trace.actor_user_id}</td>
              <td>{trace.permission_key}</td>
              <td>{humanize(trace.decision)}</td>
              <td>{trace.decision_reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ImportAuditTable({ records }: { records: ImportAuditListItem[] }) {
  if (records.length === 0) {
    return <div className="empty-state">No imports found in this scope.</div>;
  }
  return (
    <div className="table-scroll">
      <table className="data-table system-data-table">
        <thead>
          <tr>
            <th>Import</th>
            <th>Status</th>
            <th>Started By</th>
            <th>Counts</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <td>{record.import_type}</td>
              <td>{humanize(record.status)}</td>
              <td>{record.started_by_name ?? record.started_by_user_id}</td>
              <td>
                {record.row_count_created ?? 0} created / {record.row_count_updated ?? 0} updated / {record.row_count_rejected ?? 0} rejected
              </td>
              <td>{formatDateTime(record.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExportAuditTable({ records }: { records: ExportAuditListItem[] }) {
  if (records.length === 0) {
    return <div className="empty-state">No exports found in this scope.</div>;
  }
  return (
    <div className="table-scroll">
      <table className="data-table system-data-table">
        <thead>
          <tr>
            <th>Export</th>
            <th>Status</th>
            <th>Requested By</th>
            <th>Rows</th>
            <th>Columns</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <td>{record.export_type}</td>
              <td>{humanize(record.status)}</td>
              <td>{record.requested_by_name ?? record.requested_by_user_id}</td>
              <td>{record.row_count ?? 0}</td>
              <td>{record.column_keys_json?.join(", ") ?? "Not captured"}</td>
              <td>{formatDateTime(record.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DebugFilterBar({ children }: { children: ReactNode }) {
  return <div className="system-filter-bar">{children}</div>;
}

export function OrphanedRecordsCard({ findings }: { findings: DiagnosticFindingListItem[] }) {
  const count = findings.filter((finding) => finding.finding_type === "data_integrity").length;
  return <DiagnosticSummaryCard label="Orphaned Records" value={count} tone={count > 0 ? "warning" : "success"} detail="Flags or records pointing at missing parents" />;
}

export function StatusDriftCard({ findings }: { findings: DiagnosticFindingListItem[] }) {
  const count = findings.filter((finding) => finding.finding_type === "status_drift").length;
  return <DiagnosticSummaryCard label="Status Drift" value={count} tone={count > 0 ? "warning" : "success"} detail="Derived state disagreeing with source data" />;
}

export function QueueIntegrityCard({ findings }: { findings: DiagnosticFindingListItem[] }) {
  const count = findings.filter((finding) => finding.finding_type === "workflow_gap").length;
  return <DiagnosticSummaryCard label="Queue Gaps" value={count} tone={count > 0 ? "danger" : "success"} detail="Missing downstream or required workflow records" />;
}

export function DiagnosticsDashboard({
  workspace,
  findings
}: {
  workspace: DiagnosticsWorkspaceResponse;
  findings: DiagnosticFindingListItem[];
}) {
  return (
    <div className="system-dashboard-grid">
      <OrphanedRecordsCard findings={findings} />
      <StatusDriftCard findings={findings} />
      <QueueIntegrityCard findings={findings} />
      {workspace.health_checks.map((check) => (
        <HealthCheckCard key={check.id} check={check} />
      ))}
    </div>
  );
}

export function CoreFoundationSummaryHeader({
  diagnostics
}: {
  diagnostics: CoreFoundationDiagnosticsResponse;
}) {
  const failingChecks = diagnostics.health_checks.filter((check) => check.status === "failing").length;
  const warningChecks = diagnostics.health_checks.filter((check) => check.status === "warning").length;
  const disabledChecks = diagnostics.health_checks.filter((check) => check.status === "disabled").length;
  const enabledFlags = Object.values(diagnostics.feature_flags).filter(Boolean).length;

  return (
    <div className="system-health-header">
      <DiagnosticSummaryCard
        label="Failing Areas"
        value={failingChecks}
        tone={failingChecks > 0 ? "danger" : "success"}
        detail="Core systems currently in a failing state"
      />
      <DiagnosticSummaryCard
        label="Warning Areas"
        value={warningChecks}
        tone={warningChecks > 0 ? "warning" : "success"}
        detail="Core systems that need review soon"
      />
      <DiagnosticSummaryCard
        label="Startup Issues"
        value={diagnostics.startup_validation.issues.length}
        tone={diagnostics.startup_validation.valid ? "success" : "danger"}
        detail={diagnostics.startup_validation.valid ? "Startup validation is passing" : "Validation issues need operator review"}
      />
      <DiagnosticSummaryCard
        label="Enabled Flags"
        value={`${enabledFlags}/${Object.keys(diagnostics.feature_flags).length}`}
        tone={disabledChecks > 0 ? "info" : "success"}
        detail={disabledChecks > 0 ? `${disabledChecks} foundation areas are disabled` : "All foundation areas are enabled"}
      />
    </div>
  );
}

export function CoreFoundationFeatureFlagsPanel({
  diagnostics
}: {
  diagnostics: CoreFoundationDiagnosticsResponse;
}) {
  const labels: Record<keyof CoreFoundationDiagnosticsResponse["feature_flags"], string> = {
    diagnostics_enabled: "Diagnostics",
    workflow_engine_enabled: "Workflow Engine",
    operational_events_enabled: "Operational Events",
    global_search_enabled: "Global Search",
    activity_timeline_enabled: "Activity Timeline",
    admin_configuration_enabled: "Admin Configuration",
    approval_framework_enabled: "Approval Framework",
    reporting_enabled: "Reporting"
  };

  return (
    <div className="system-inline-stack">
      {Object.entries(diagnostics.feature_flags).map(([key, enabled]) => (
        <div key={key} className="system-mini-card">
          <strong>{labels[key as keyof typeof labels] ?? humanize(key)}</strong>
          <p>
            <span className={`badge-pill status-chip status-chip--${enabled ? "success" : "neutral"}`}>
              {enabled ? "Enabled" : "Disabled"}
            </span>
          </p>
        </div>
      ))}
    </div>
  );
}

export function CoreFoundationValidationPanel({
  diagnostics
}: {
  diagnostics: CoreFoundationDiagnosticsResponse;
}) {
  if (diagnostics.startup_validation.issues.length === 0) {
    return <div className="empty-state">No startup validation issues are active for the core foundation layer.</div>;
  }

  return (
    <div className="system-inline-stack">
      {diagnostics.startup_validation.issues.map((issue) => (
        <article key={issue.code} className={`system-mini-card system-mini-card--${issue.severity === "error" ? "danger" : "warning"}`}>
          <strong>{humanize(issue.area)}</strong>
          <p>{issue.summary}</p>
          <small>{issue.code}</small>
        </article>
      ))}
    </div>
  );
}

function FoundationHealthCard({ check }: { check: CoreFoundationHealthCheck }) {
  return (
    <DashboardWidgetFrame>
      <article className={`system-health-card system-health-card--${foundationHealthTone(check.status)}`}>
        <div className="system-health-card__header">
          <strong>{humanize(check.area)}</strong>
          <span className={`badge-pill status-chip status-chip--${foundationHealthTone(check.status)}`}>
            {humanize(check.status)}
          </span>
        </div>
        <p>{check.summary}</p>
        <small>
          {check.detail_count} detail{check.detail_count === 1 ? "" : "s"}
          {check.last_event_at ? ` - last signal ${formatDateTime(check.last_event_at)}` : ""}
        </small>
      </article>
    </DashboardWidgetFrame>
  );
}

export function CoreFoundationHealthGrid({
  diagnostics
}: {
  diagnostics: CoreFoundationDiagnosticsResponse;
}) {
  return (
    <div className="system-dashboard-grid">
      {diagnostics.health_checks.map((check) => (
        <FoundationHealthCard key={check.area} check={check} />
      ))}
    </div>
  );
}

export function CoreFoundationRecentEvents({
  events
}: {
  events: AuditEventListItem[];
}) {
  if (events.length === 0) {
    return <div className="empty-state">No recent foundation audit events have been captured yet.</div>;
  }

  return (
    <div className="table-scroll">
      <table className="data-table system-data-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Area</th>
            <th>Event</th>
            <th>Resource</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td>{formatDateTime(event.created_at)}</td>
              <td>{humanize(event.event_category)}</td>
              <td>
                <strong>{event.message}</strong>
                <div className="table-subtle">{event.actor_name ?? "System"}</div>
              </td>
              <td>{event.resource_type}:{event.resource_id ?? "global"}</td>
              <td>{humanize(event.result)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CommunicationSummaryHeader({
  diagnostics
}: {
  diagnostics: CommunicationDiagnosticsResponse;
}) {
  const failingChecks = diagnostics.health_checks.filter((check) => check.status === "failing").length;
  const warningChecks = diagnostics.health_checks.filter((check) => check.status === "warning").length;
  const disabledChecks = diagnostics.health_checks.filter((check) => check.status === "disabled").length;
  const enabledFlags = Object.values(diagnostics.feature_flags).filter(Boolean).length;

  return (
    <div className="system-health-header">
      <DiagnosticSummaryCard
        label="Failing Areas"
        value={failingChecks}
        tone={failingChecks > 0 ? "danger" : "success"}
        detail="Communication areas currently failing"
      />
      <DiagnosticSummaryCard
        label="Warning Areas"
        value={warningChecks}
        tone={warningChecks > 0 ? "warning" : "success"}
        detail="Communication areas needing operator review"
      />
      <DiagnosticSummaryCard
        label="Startup Issues"
        value={diagnostics.startup_validation.issues.length}
        tone={diagnostics.startup_validation.valid ? "success" : "danger"}
        detail={diagnostics.startup_validation.valid ? "Startup validation is passing" : "Validation issues need review"}
      />
      <DiagnosticSummaryCard
        label="Enabled Flags"
        value={`${enabledFlags}/${Object.keys(diagnostics.feature_flags).length}`}
        tone={disabledChecks > 0 ? "info" : "success"}
        detail={disabledChecks > 0 ? `${disabledChecks} communication areas are disabled` : "All communication areas are enabled"}
      />
    </div>
  );
}

export function CommunicationFeatureFlagsPanel({
  diagnostics
}: {
  diagnostics: CommunicationDiagnosticsResponse;
}) {
  const labels: Record<keyof CommunicationDiagnosticsResponse["feature_flags"], string> = {
    diagnostics_enabled: "Diagnostics",
    identity_linking_enabled: "Identity Linking",
    teams_messaging_enabled: "Teams Messaging",
    teams_meetings_enabled: "Teams Meetings",
    in_app_actions_enabled: "In-App Actions",
    teams_embedded_entry_points_enabled: "Teams Embedded Entry Points"
  };

  return (
    <div className="system-inline-stack">
      {Object.entries(diagnostics.feature_flags).map(([key, enabled]) => (
        <div key={key} className="system-mini-card">
          <strong>{labels[key as keyof typeof labels] ?? humanize(key)}</strong>
          <p>
            <span className={`badge-pill status-chip status-chip--${enabled ? "success" : "neutral"}`}>
              {enabled ? "Enabled" : "Disabled"}
            </span>
          </p>
        </div>
      ))}
    </div>
  );
}

export function CommunicationAdminControlsPanel({
  diagnostics
}: {
  diagnostics: CommunicationDiagnosticsResponse;
}) {
  return (
    <div className="system-inline-stack">
      <div className="system-mini-card">
        <strong>Default Meeting Mode</strong>
        <p>{humanize(diagnostics.admin_controls.default_meeting_mode)}</p>
      </div>
      <div className="system-mini-card">
        <strong>Embedded Job Limit</strong>
        <p>{diagnostics.admin_controls.embedded_defaults.max_assigned_jobs}</p>
      </div>
      <div className="system-mini-card">
        <strong>Embedded Task Limit</strong>
        <p>{diagnostics.admin_controls.embedded_defaults.max_assigned_tasks}</p>
      </div>
      <div className="system-mini-card">
        <strong>Embedded Entry Cap</strong>
        <p>{diagnostics.admin_controls.embedded_defaults.max_entries}</p>
      </div>
    </div>
  );
}

export function CommunicationValidationPanel({
  diagnostics
}: {
  diagnostics: CommunicationDiagnosticsResponse;
}) {
  if (diagnostics.startup_validation.issues.length === 0) {
    return <div className="empty-state">No communication startup validation issues are active.</div>;
  }

  return (
    <div className="system-inline-stack">
      {diagnostics.startup_validation.issues.map((issue) => (
        <article key={issue.code} className={`system-mini-card system-mini-card--${issue.severity === "error" ? "danger" : "warning"}`}>
          <strong>{humanize(issue.area)}</strong>
          <p>{issue.summary}</p>
          <small>{issue.code}</small>
        </article>
      ))}
    </div>
  );
}

function CommunicationHealthCard({ check }: { check: CommunicationDiagnosticsResponse["health_checks"][number] }) {
  return (
    <DashboardWidgetFrame>
      <article className={`system-health-card system-health-card--${foundationHealthTone(check.status)}`}>
        <div className="system-health-card__header">
          <strong>{humanize(check.area)}</strong>
          <span className={`badge-pill status-chip status-chip--${foundationHealthTone(check.status)}`}>
            {humanize(check.status)}
          </span>
        </div>
        <p>{check.summary}</p>
        <small>
          {check.detail_count} detail{check.detail_count === 1 ? "" : "s"}
          {check.last_event_at ? ` - last signal ${formatDateTime(check.last_event_at)}` : ""}
        </small>
      </article>
    </DashboardWidgetFrame>
  );
}

export function CommunicationHealthGrid({
  diagnostics
}: {
  diagnostics: CommunicationDiagnosticsResponse;
}) {
  return (
    <div className="system-dashboard-grid">
      {diagnostics.health_checks.map((check) => (
        <CommunicationHealthCard key={check.area} check={check} />
      ))}
    </div>
  );
}

export function CommunicationRecentEvents({
  events
}: {
  events: AuditEventListItem[];
}) {
  if (events.length === 0) {
    return <div className="empty-state">No recent communication audit events have been captured yet.</div>;
  }

  return (
    <div className="table-scroll">
      <table className="data-table system-data-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Event</th>
            <th>Resource</th>
            <th>Result</th>
            <th>Request</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td>{formatDateTime(event.created_at)}</td>
              <td>
                <strong>{event.message}</strong>
                <div className="table-subtle">{event.actor_name ?? "System"}</div>
              </td>
              <td>{event.resource_type}:{event.resource_id ?? "global"}</td>
              <td>{humanize(event.result)}</td>
              <td>{event.request_id ?? "Not captured"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
