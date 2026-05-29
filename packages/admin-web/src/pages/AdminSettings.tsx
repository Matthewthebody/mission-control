import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { AdminSettingChangeInput, AdminSettingPreview, AdminSettingScopeType, AdminSettingsWorkspace } from "../adminSettingsTypes";
import { hasAnyCapability, hasAuthorityTier, hasPermission } from "../permissions";
import type { SessionUser } from "../types";
import {
  approveAdminSettingChange,
  createAdminSettingChange,
  getAdminSettingsWorkspace,
  previewAdminSettingChange,
  rejectAdminSettingChange
} from "../services/adminSettingsApi";

type Props = {
  token: string;
  currentUser: SessionUser;
  routeId?: string;
};

type GroupKey =
  | "operational"
  | "templates"
  | "notifications"
  | "reporting"
  | "directory"
  | "integrations"
  | "roles"
  | "branding"
  | "audit"
  | "health";

type DraftState = {
  scopeType: AdminSettingScopeType;
  scopeId: string;
  scopeLabel: string;
  valueText: string;
  jsonText: string;
  booleanValue: boolean;
  rangeStart: string;
  rangeEnd: string;
  effectiveAt: string;
  expiresAt: string;
  reason: string;
};

const GROUP_DEFINITIONS: Array<{
  id: GroupKey;
  label: string;
  categories?: string[];
  description: string;
}> = [
  {
    id: "operational",
    label: "Operational Rules",
    categories: ["attendance_time_rules", "schedule_staffing_rules", "readiness_workflow_rules", "production_qa_rules"],
    description: "Attendance, staffing, readiness, and production rules that change system behavior."
  },
  {
    id: "templates",
    label: "Templates",
    description: "Reusable defaults owned by the modules that seed staffing, production, continuity, and packets."
  },
  {
    id: "notifications",
    label: "Notifications and Delivery",
    categories: ["notification_summary_rules"],
    description: "Quiet hours, escalation windows, and summary delivery defaults."
  },
  {
    id: "reporting",
    label: "Reporting and Packets",
    categories: ["reporting_packet_rules"],
    description: "Reports windows, packet defaults, and recurring summary behavior."
  },
  {
    id: "directory",
    label: "Directory and Relationship Rules",
    categories: ["relationship_directory_rules"],
    description: "Freshness, ownership, and continuity guardrails."
  },
  {
    id: "integrations",
    label: "Integrations",
    categories: ["integration_sync_rules"],
    description: "Sync cadence and failure-routing controls."
  },
  {
    id: "roles",
    label: "Roles and Access",
    categories: ["roles_access_rules"],
    description: "Admin sharing defaults and protected configuration controls."
  },
  {
    id: "branding",
    label: "Branding",
    categories: ["branding_foundation"],
    description: "Safe white-label basics, not a theme playground."
  },
  {
    id: "audit",
    label: "Audit and Change History",
    description: "Recent changes, pending approvals, and future-dated rules."
  },
  {
    id: "health",
    label: "System Health / Data Health",
    description: "Integration issues, data warnings, and stale overrides that reduce trust."
  }
];

export function AdminSettings({ token, currentUser, routeId = "admin-system" }: Props) {
  const [workspace, setWorkspace] = useState<AdminSettingsWorkspace | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [activeGroup, setActiveGroup] = useState<GroupKey>(() => getInitialGroup(routeId));
  const [draft, setDraft] = useState<DraftState>(createEmptyDraft());
  const [preview, setPreview] = useState<AdminSettingPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const canManage = useMemo(
    () =>
      hasAuthorityTier(currentUser, ["super_admin", "leadership", "director_admin"]) ||
      hasAnyCapability(currentUser, [
        "admin.configure",
        "audit_controls.configure",
        "roles_permissions.configure",
        "integrations.manage"
      ]),
    [currentUser]
  );
  const canApprove = useMemo(
    () =>
      hasAuthorityTier(currentUser, ["super_admin", "leadership"]) ||
      hasAnyCapability(currentUser, ["admin.configure", "audit_controls.configure"]) ||
      hasPermission(currentUser, "security.manage"),
    [currentUser]
  );
  const readOnlyMode = !canManage;

  async function load() {
    setLoading(true);
    setError("");
    try {
      const payload = await getAdminSettingsWorkspace(token);
      setWorkspace(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load admin settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  useEffect(() => {
    setActiveGroup(getInitialGroup(routeId));
  }, [routeId]);

  const filteredSettings = useMemo(() => {
    if (!workspace) {
      return [];
    }
    const group = GROUP_DEFINITIONS.find((item) => item.id === activeGroup);
    if (!group?.categories?.length) {
      return workspace.settings;
    }
    return workspace.settings.filter((setting) => group.categories?.includes(setting.definition.category));
  }, [activeGroup, workspace]);

  useEffect(() => {
    if (!filteredSettings.length) {
      setSelectedKey("");
      return;
    }
    if (!filteredSettings.some((setting) => setting.definition.key === selectedKey)) {
      setSelectedKey(filteredSettings[0].definition.key);
    }
  }, [filteredSettings, selectedKey]);

  const selectedSetting = useMemo(
    () =>
      filteredSettings.find((setting) => setting.definition.key === selectedKey) ??
      workspace?.settings.find((setting) => setting.definition.key === selectedKey) ??
      null,
    [filteredSettings, selectedKey, workspace]
  );

  useEffect(() => {
    if (!selectedSetting) {
      return;
    }
    setDraft(buildDraftFromSetting(selectedSetting));
    setPreview(null);
  }, [selectedSetting]);

  async function handlePreview() {
    if (!selectedSetting) {
      return;
    }
    setBusyAction("preview");
    setError("");
    setNotice("");
    try {
      const input = buildInputFromDraft(selectedSetting, draft);
      const payload = await previewAdminSettingChange(token, {
        setting_key: input.setting_key,
        scope_type: input.scope_type,
        scope_id: input.scope_id,
        scope_label: input.scope_label,
        value: input.value
      });
      setPreview(payload);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "We couldn't preview that change.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleSubmit() {
    if (!selectedSetting) {
      return;
    }
    setBusyAction("submit");
    setError("");
    setNotice("");
    try {
      const input = buildInputFromDraft(selectedSetting, draft);
      const payload = await createAdminSettingChange(token, input);
      setNotice(payload.change.status === "pending_approval" ? "Change submitted for approval." : "Setting updated and versioned successfully.");
      setPreview(payload.preview);
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "We couldn't save that setting change.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleDecision(id: string, decision: "approve" | "reject") {
    setBusyAction(`${decision}:${id}`);
    setError("");
    setNotice("");
    try {
      if (decision === "approve") {
        await approveAdminSettingChange(token, id);
        setNotice("Pending setting change approved.");
      } else {
        await rejectAdminSettingChange(token, id);
        setNotice("Pending setting change rejected.");
      }
      await load();
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "We couldn't complete that approval action.");
    } finally {
      setBusyAction("");
    }
  }

  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">Admin Configuration</div>
          <h2>System Configuration</h2>
          <p>Controlled policy settings, scoped overrides, effective dating, and high-trust change history in one admin workspace.</p>
        </div>
        <div className="page-intro-actions">
          <div className="metric-pill">Scope order: Company to Role</div>
          <div className="metric-pill">Viewer: {currentUser.fullName}</div>
          <div className={`metric-pill metric-pill--${readOnlyMode ? "warning" : "success"}`}>Mode: {readOnlyMode ? "Review Only" : "Change Allowed"}</div>
        </div>
      </section>

      {notice ? <section className="panel feedback-strip feedback-strip--success">{notice}</section> : null}
      {error ? <section className="panel feedback-strip feedback-strip--danger">{error}</section> : null}

      <section className="metrics-grid">
        {(workspace?.summary_strip ?? []).map((metric) => (
          <article key={metric.id} className="stat-card panel">
            <div className="eyebrow">{metric.label}</div>
            <strong>{metric.value}</strong>
            <span className="muted">{metric.detail}</span>
          </article>
        ))}
      </section>

      <section className="panel access-panel">
        <div className="section-title">Admin Configuration Areas</div>
        <div className="admin-settings-group-grid">
          {GROUP_DEFINITIONS.map((group) => (
            <button
              key={group.id}
              type="button"
              className={`admin-settings-group-card ${activeGroup === group.id ? "is-active" : ""}`}
              onClick={() => setActiveGroup(group.id)}
            >
              <strong>{group.label}</strong>
              <span>{group.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="access-layout">
        <div className="access-column">
          {activeGroup === "templates" ? (
            <section className="panel access-panel">
              <div className="section-title">Templates</div>
              <div className="admin-settings-card-list">
                {(workspace?.template_summaries ?? []).map((template) => (
                  <article key={template.id} className="admin-settings-card">
                    <div className="admin-settings-card__head">
                      <div>
                        <strong>{template.label}</strong>
                        <div className="muted">{template.owner_module}</div>
                      </div>
                      <span className="badge-pill">{template.count}</span>
                    </div>
                    <p className="muted">{template.summary}</p>
                    <div className="access-actions">
                      <button type="button" className="secondary-button" onClick={() => (window.location.hash = template.route_hash)}>
                        Open Owner Workspace
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : activeGroup === "audit" ? (
            <>
              <section className="panel access-panel">
                <div className="section-title">Pending Protected Changes</div>
                {!workspace?.pending_approvals.length ? (
                  <div className="empty-state">No protected changes are waiting for approval.</div>
                ) : (
                  <div className="admin-settings-card-list">
                    {workspace.pending_approvals.map((change) => (
                      <ChangeCard
                        key={change.id}
                        change={change}
                        busyAction={busyAction}
                        canApprove={canApprove}
                        onApprove={() => void handleDecision(change.id, "approve")}
                        onReject={() => void handleDecision(change.id, "reject")}
                      />
                    ))}
                  </div>
                )}
              </section>
              <section className="panel access-panel">
                <div className="section-title">Scheduled Future Changes</div>
                {!workspace?.scheduled_future_changes.length ? (
                  <div className="empty-state">No approved changes are scheduled for later.</div>
                ) : (
                  <div className="admin-settings-card-list">
                    {workspace.scheduled_future_changes.map((change) => (
                      <ChangeCard key={change.id} change={change} busyAction={busyAction} canApprove={false} onApprove={() => undefined} onReject={() => undefined} />
                    ))}
                  </div>
                )}
              </section>
              <section className="panel access-panel">
                <div className="section-title">Recent Changes</div>
                {!workspace?.recent_changes.length ? (
                  <div className="empty-state">No recent config changes were recorded yet.</div>
                ) : (
                  <div className="admin-settings-card-list">
                    {workspace.recent_changes.map((change) => (
                      <ChangeCard key={change.id} change={change} busyAction={busyAction} canApprove={false} onApprove={() => undefined} onReject={() => undefined} />
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : activeGroup === "health" ? (
            <>
              <section className="panel access-panel">
                <div className="section-title">Integration Health</div>
                {!workspace?.integration_health_issues.length ? (
                  <div className="empty-state">No integration health issues are open right now.</div>
                ) : (
                  <HealthList items={workspace.integration_health_issues} />
                )}
              </section>
              <section className="panel access-panel">
                <div className="section-title">System and Data Warnings</div>
                {!workspace?.data_health_warnings.length ? (
                  <div className="empty-state">No data-health warnings are open right now.</div>
                ) : (
                  <HealthList items={workspace.data_health_warnings} />
                )}
              </section>
              <section className="panel access-panel">
                <div className="section-title">Stale Overrides</div>
                {!workspace?.stale_overrides.length ? (
                  <div className="empty-state">No stale overrides need review right now.</div>
                ) : (
                  <div className="admin-settings-card-list">
                    {workspace.stale_overrides.map((change) => (
                      <ChangeCard key={change.id} change={change} busyAction={busyAction} canApprove={false} onApprove={() => undefined} onReject={() => undefined} />
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : (
            <section className="panel access-panel">
              <div className="section-title">{GROUP_DEFINITIONS.find((group) => group.id === activeGroup)?.label ?? "Settings"}</div>
              {loading ? <div className="empty-state">Loading settings...</div> : null}
              {!loading && !filteredSettings.length ? <div className="empty-state">No settings are configured for this admin area yet.</div> : null}
              <div className="admin-settings-card-list">
                {filteredSettings.map((setting) => {
                  const lastChange = setting.history[0] ?? setting.global_value;
                  return (
                    <article
                      key={setting.definition.key}
                      className={`admin-settings-card ${selectedSetting?.definition.key === setting.definition.key ? "is-selected" : ""}`}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selectedSetting?.definition.key === setting.definition.key}
                      onClick={() => setSelectedKey(setting.definition.key)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedKey(setting.definition.key);
                        }
                      }}
                    >
                      <div className="admin-settings-card__head">
                        <div>
                          <strong>{setting.definition.label}</strong>
                          <div className="muted">{setting.definition.description}</div>
                        </div>
                        {setting.definition.protected_change ? <span className="badge-pill status-chip status-chip--warning">Protected</span> : null}
                      </div>
                      <div className="admin-settings-card__meta">
                        <span className="meta-pill">Current: {formatSettingValue(setting.global_value?.value ?? setting.definition.default_value)}</span>
                        <span className="meta-pill">Overrides: {setting.active_overrides.length}</span>
                        <span className="meta-pill">Pending: {setting.pending_changes.length}</span>
                      </div>
                      <div className="muted">{setting.definition.why_it_matters}</div>
                      <div className="admin-settings-card__foot">
                        <span>Allowed scopes: {setting.definition.allowed_scopes.join(", ")}</span>
                        <span>{lastChange ? `Last changed ${formatDateTime(lastChange.created_at)}` : "No change history yet"}</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        <aside className="access-column access-column--narrow">
          <section className="panel access-panel">
            <div className="section-title">Setting Editor</div>
            {!selectedSetting ? (
              <div className="empty-state">Select a setting to review its current value, preview impact, and create a new versioned change.</div>
            ) : (
              <>
                <div className="admin-settings-editor__summary">
                  <strong>{selectedSetting.definition.label}</strong>
                  <p className="muted">{selectedSetting.definition.why_it_matters}</p>
                  <div className="admin-settings-card__meta">
                    <span className="meta-pill">Who can edit: {selectedSetting.definition.who_can_edit}</span>
                    <span className="meta-pill">Current scope: Global / Company</span>
                  </div>
                  {selectedSetting.definition.help_text ? <p className="muted">{selectedSetting.definition.help_text}</p> : null}
                </div>
                <div className="access-form">
                  <label>
                    <span className="field-label">Scope</span>
                    <select value={draft.scopeType} onChange={(event) => setDraft((current) => ({ ...current, scopeType: event.target.value as AdminSettingScopeType }))}>
                      {selectedSetting.definition.allowed_scopes.map((scope) => (
                        <option key={scope} value={scope}>
                          {scope}
                        </option>
                      ))}
                    </select>
                  </label>
                  {draft.scopeType !== "global" ? (
                    <>
                      <label>
                        <span className="field-label">Scope ID</span>
                        <input value={draft.scopeId} onChange={(event) => setDraft((current) => ({ ...current, scopeId: event.target.value }))} placeholder="department code, location id, or account id" />
                      </label>
                      <label>
                        <span className="field-label">Scope Label</span>
                        <input value={draft.scopeLabel} onChange={(event) => setDraft((current) => ({ ...current, scopeLabel: event.target.value }))} placeholder="Human-readable override label" />
                      </label>
                    </>
                  ) : null}
                  <ValueEditor draft={draft} setDraft={setDraft} setting={selectedSetting} />
                  <label>
                    <span className="field-label">Effective Date / Time</span>
                    <input type="datetime-local" value={draft.effectiveAt} onChange={(event) => setDraft((current) => ({ ...current, effectiveAt: event.target.value }))} />
                  </label>
                  <label>
                    <span className="field-label">Expiration Date / Time</span>
                    <input type="datetime-local" value={draft.expiresAt} onChange={(event) => setDraft((current) => ({ ...current, expiresAt: event.target.value }))} />
                  </label>
                  <label>
                    <span className="field-label">Reason</span>
                    <textarea value={draft.reason} onChange={(event) => setDraft((current) => ({ ...current, reason: event.target.value }))} rows={4} placeholder="Why is this change needed, and what business behavior will it affect?" />
                  </label>
                  <div className="access-actions">
                    <button type="button" className="secondary-button" disabled={!canManage || busyAction === "preview"} onClick={() => void handlePreview()}>
                      {busyAction === "preview" ? "Previewing..." : "Preview Impact"}
                    </button>
                    <button type="button" disabled={!canManage || busyAction === "submit"} onClick={() => void handleSubmit()}>
                      {busyAction === "submit" ? "Saving..." : selectedSetting.definition.protected_change ? "Submit Change" : "Apply Change"}
                    </button>
                  </div>
                </div>
                {preview ? (
                  <div className="admin-settings-preview">
                    <strong>Impact Preview</strong>
                    <p>{preview.impact_summary}</p>
                    <div className="admin-settings-card__meta">
                      {Object.entries(preview.counts).map(([key, value]) => (
                        <span key={key} className="meta-pill">
                          {humanize(key)}: {value}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </section>

          <section className="panel access-panel">
            <div className="section-title">Pending Approvals</div>
            {!workspace?.pending_approvals.length ? (
              <div className="empty-state">No protected changes are waiting right now.</div>
            ) : (
              <div className="admin-settings-card-list">
                {workspace.pending_approvals.slice(0, 4).map((change) => (
                  <ChangeCard
                    key={change.id}
                    change={change}
                    busyAction={busyAction}
                    canApprove={canApprove}
                    onApprove={() => void handleDecision(change.id, "approve")}
                    onReject={() => void handleDecision(change.id, "reject")}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="panel access-panel">
            <div className="section-title">Health Watch</div>
            <HealthList items={[...(workspace?.integration_health_issues ?? []).slice(0, 3), ...(workspace?.data_health_warnings ?? []).slice(0, 3)]} />
          </section>
        </aside>
      </section>
    </>
  );
}

function ValueEditor({
  draft,
  setDraft,
  setting
}: {
  draft: DraftState;
  setDraft: Dispatch<SetStateAction<DraftState>>;
  setting: NonNullable<AdminSettingsWorkspace["settings"][number]>;
}) {
  switch (setting.definition.value_type) {
    case "boolean":
      return (
        <label>
          <span className="field-label">Value</span>
          <select value={draft.booleanValue ? "true" : "false"} onChange={(event) => setDraft((current) => ({ ...current, booleanValue: event.target.value === "true" }))}>
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        </label>
      );
    case "enum":
      return (
        <label>
          <span className="field-label">Value</span>
          <select value={draft.valueText} onChange={(event) => setDraft((current) => ({ ...current, valueText: event.target.value }))}>
            {setting.definition.enum_values.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      );
    case "time_range":
      return (
        <div className="access-form__row">
          <label>
            <span className="field-label">Quiet Hours Start</span>
            <input type="time" value={draft.rangeStart} onChange={(event) => setDraft((current) => ({ ...current, rangeStart: event.target.value }))} />
          </label>
          <label>
            <span className="field-label">Quiet Hours End</span>
            <input type="time" value={draft.rangeEnd} onChange={(event) => setDraft((current) => ({ ...current, rangeEnd: event.target.value }))} />
          </label>
        </div>
      );
    case "json":
      return (
        <label>
          <span className="field-label">Structured Value (JSON)</span>
          <textarea
            value={draft.jsonText}
            onChange={(event) => setDraft((current) => ({ ...current, jsonText: event.target.value }))}
            rows={10}
            spellCheck={false}
          />
        </label>
      );
    default:
      return (
        <label>
          <span className="field-label">Value</span>
          <input
            type={setting.definition.value_type === "number" ? "number" : "text"}
            value={draft.valueText}
            onChange={(event) => setDraft((current) => ({ ...current, valueText: event.target.value }))}
          />
        </label>
      );
  }
}

function ChangeCard({
  change,
  busyAction,
  canApprove,
  onApprove,
  onReject
}: {
  change: AdminSettingsWorkspace["pending_approvals"][number];
  busyAction: string;
  canApprove: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <article className="admin-settings-card">
      <div className="admin-settings-card__head">
        <div>
          <strong>{change.setting_key}</strong>
          <div className="muted">
            {humanize(change.scope_type)}
            {change.scope_label ? ` / ${change.scope_label}` : ""}
          </div>
        </div>
        <span className={`badge-pill status-chip status-chip--${change.status === "approved" ? "success" : change.status === "pending_approval" ? "warning" : "neutral"}`}>
          {humanize(change.status)}
        </span>
      </div>
      <div className="admin-settings-card__meta">
        <span className="meta-pill">Effective: {formatDateTime(change.effective_at)}</span>
        <span className="meta-pill">Requested by: {change.requested_by_name ?? "Unknown"}</span>
      </div>
      <div className="muted">{change.reason}</div>
      {canApprove && change.status === "pending_approval" ? (
        <div className="access-actions">
          <button type="button" disabled={busyAction === `approve:${change.id}`} onClick={onApprove}>
            {busyAction === `approve:${change.id}` ? "Approving..." : "Approve"}
          </button>
          <button type="button" className="secondary-button" disabled={busyAction === `reject:${change.id}`} onClick={onReject}>
            {busyAction === `reject:${change.id}` ? "Rejecting..." : "Reject"}
          </button>
        </div>
      ) : null}
    </article>
  );
}

function HealthList({
  items
}: {
  items: Array<{
    id: string;
    title: string;
    detail: string;
    tone: "neutral" | "warning" | "danger";
    action_hash: string | null;
  }>;
}) {
  if (!items.length) {
    return <div className="empty-state">No active warnings are open right now.</div>;
  }
  return (
    <div className="audit-list">
      {items.map((item) => (
        <article key={item.id} className="audit-card">
          <div className="audit-card__head">
            <strong>{item.title}</strong>
            <span className={`badge-pill status-chip status-chip--${item.tone === "danger" ? "danger" : item.tone === "warning" ? "warning" : "neutral"}`}>
              {humanize(item.tone)}
            </span>
          </div>
          <div className="audit-card__line">{item.detail}</div>
          {item.action_hash ? (
            <div className="access-actions">
              <button type="button" className="secondary-button" onClick={() => (window.location.hash = item.action_hash ?? "#admin/system")}>
                Open Owner Workspace
              </button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function getInitialGroup(routeId: string): GroupKey {
  if (routeId === "admin-reference-data") {
    return "templates";
  }
  return "operational";
}

function createEmptyDraft(): DraftState {
  const now = new Date();
  return {
    scopeType: "global",
    scopeId: "",
    scopeLabel: "",
    valueText: "",
    jsonText: "",
    booleanValue: true,
    rangeStart: "22:00",
    rangeEnd: "06:00",
    effectiveAt: toDateTimeInputValue(now),
    expiresAt: "",
    reason: ""
  };
}

function buildDraftFromSetting(setting: NonNullable<AdminSettingsWorkspace["settings"][number]>): DraftState {
  const base = createEmptyDraft();
  const sourceValue = setting.global_value?.value ?? setting.definition.default_value;
  switch (setting.definition.value_type) {
    case "boolean":
      base.booleanValue = Boolean(sourceValue);
      break;
    case "number":
      base.valueText = typeof sourceValue === "number" ? String(sourceValue) : "";
      break;
    case "enum":
    case "text":
    case "color":
      base.valueText = typeof sourceValue === "string" ? sourceValue : "";
      break;
    case "time_range":
      if (sourceValue && typeof sourceValue === "object") {
        base.rangeStart = typeof sourceValue.start === "string" ? sourceValue.start : base.rangeStart;
        base.rangeEnd = typeof sourceValue.end === "string" ? sourceValue.end : base.rangeEnd;
      }
      break;
    case "json":
      base.jsonText = sourceValue && typeof sourceValue === "object" ? JSON.stringify(sourceValue, null, 2) : "{\n}";
      break;
  }
  return base;
}

function buildInputFromDraft(setting: NonNullable<AdminSettingsWorkspace["settings"][number]>, draft: DraftState): AdminSettingChangeInput {
  let value: unknown = draft.valueText;
  switch (setting.definition.value_type) {
    case "number":
      value = Number(draft.valueText);
      break;
    case "boolean":
      value = draft.booleanValue;
      break;
    case "time_range":
      value = { start: draft.rangeStart, end: draft.rangeEnd };
      break;
    case "json":
      value = parseJsonDraftValue(draft.jsonText);
      break;
    default:
      value = draft.valueText;
      break;
  }
  return {
    setting_key: setting.definition.key,
    scope_type: draft.scopeType,
    scope_id: draft.scopeType === "global" ? null : draft.scopeId.trim() || null,
    scope_label: draft.scopeType === "global" ? null : draft.scopeLabel.trim() || null,
    value,
    effective_at: draft.effectiveAt ? new Date(draft.effectiveAt).toISOString() : null,
    expires_at: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null,
    reason: draft.reason.trim()
  };
}

function toDateTimeInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatSettingValue(value: unknown) {
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "start" in (value as Record<string, unknown>) && "end" in (value as Record<string, unknown>)) {
    const range = value as { start?: string; end?: string };
    return `${range.start ?? "--:--"} to ${range.end ?? "--:--"}`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return keys.length ? `JSON: ${keys.join(", ")}` : "JSON object";
  }
  return "Not set";
}

function parseJsonDraftValue(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Structured settings must use a JSON object.");
    }
    return parsed;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Structured settings must use valid JSON.");
  }
}

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not scheduled";
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}
