import { useEffect, useMemo, useState } from "react";
import { OperationalPreviewCard } from "../components/OperationalPreviewCard";
import { canManageOperatingSystemModule } from "../permissions";
import {
  applyExceptionAction,
  getExceptionDetail,
  getExceptionWorkspace
} from "../services/exceptionsApi";
import type { SessionUser } from "../types";
import type { OperationalExceptionDetail, OperationalExceptionListItem, OperationalExceptionWorkspace } from "../exceptionTypes";

type Props = {
  token: string;
  currentUser: SessionUser;
};

export function OperationsExceptions({ token, currentUser }: Props) {
  const [date, setDate] = useState(() => getInitialExceptionDate());
  const [workspace, setWorkspace] = useState<OperationalExceptionWorkspace | null>(null);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [detail, setDetail] = useState<OperationalExceptionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [assignOwnerId, setAssignOwnerId] = useState("");
  const [assignNote, setAssignNote] = useState("");
  const [snoozeReason, setSnoozeReason] = useState("");
  const [snoozeDuration, setSnoozeDuration] = useState("60");
  const [actionNote, setActionNote] = useState("");

  const canManage = canManageOperatingSystemModule(currentUser, "exceptions");

  async function load(preferredItemId?: string) {
    setLoading(true);
    try {
      const payload = await getExceptionWorkspace(token, { date });
      setWorkspace(payload);
      const nextSelectedId =
        preferredItemId && payload.items.some((item) => item.id === preferredItemId)
          ? preferredItemId
          : payload.items[0]?.id ?? "";
      setSelectedItemId(nextSelectedId);
      setError("");
      syncHash(date);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load exceptions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(selectedItemId || undefined);
  }, [date, token]);

  useEffect(() => {
    if (!selectedItemId) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    void getExceptionDetail(token, selectedItemId)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setDetail(payload);
        setAssignOwnerId(payload.item.owner_user_id ?? "");
        setAssignNote("");
        setActionNote("");
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "We couldn't load that exception.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedItemId, token]);

  const items = workspace?.items ?? [];
  const selectedItem = useMemo(
    () => detail?.item ?? items.find((item) => item.id === selectedItemId) ?? null,
    [detail?.item, items, selectedItemId]
  );

  async function runAction(
    action:
      | { action: "assign_owner"; owner_user_id: string | null; note?: string | null }
      | { action: "snooze"; reason: string; duration_minutes: number; note?: string | null }
      | { action: "mark_handled"; note?: string | null },
    successNotice: string
  ) {
    if (!selectedItemId) {
      return;
    }
    setActing(true);
    setNotice("");
    setError("");
    try {
      const payload = await applyExceptionAction(token, selectedItemId, action);
      setDetail(payload);
      setNotice(successNotice);
      await load(payload.item.id);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "We couldn't update that exception.");
    } finally {
      setActing(false);
    }
  }

  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">Operations</div>
          <h2>Exceptions</h2>
          <p>One ranked queue of operational exceptions from scheduling, attendance, production, approvals, and workflow acknowledgements. Blocking means it needs action now.</p>
        </div>
        <div className="page-intro-actions">
          <div className="metric-pill">Open: {workspace?.summary.open_count ?? 0}</div>
          <div className="metric-pill metric-pill--warning">Blocking: {workspace?.summary.blocking_count ?? 0}</div>
          <div className="metric-pill">At Risk: {workspace?.summary.at_risk_count ?? 0}</div>
          <button className="secondary-button" onClick={() => void load(selectedItemId || undefined)} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </section>

      <section className="panel dashboard-stack">
        <div className="alerts-toolbar">
          <div>
            <div className="section-title">Ranked Exceptions</div>
            <p className="section-subtitle">
              Sorted by most overdue first, then highest severity, then operational impact. Snoozed items stay visible but fall behind open blocking work.
            </p>
          </div>
          <div className="inline-action-group">
            <label className="filter-field">
              <span>Anchor Date</span>
              <input
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  syncHash(event.target.value);
                }}
              />
            </label>
            <div className="metric-pill">Scope: {workspace?.scope ?? "department"}</div>
          </div>
        </div>

        {error ? <div className="error-banner">{error}</div> : null}
        {notice ? <div className="success-banner">{notice}</div> : null}

        <div className="preview-detail-layout">
          <div className="ops-preview-list">
            {items.map((item) => (
              <OperationalPreviewCard
                key={item.id}
                eyebrow={item.source_module_label}
                title={item.title}
                summary={item.summary}
                owner={item.owner_label ?? "Needs owner"}
                statusLabel={`${item.severity_label} ${humanizeValue(item.category)}`}
                statusTone={item.severity === "blocking" ? "critical" : "warning"}
                meta={[
                  { label: item.timing_label, tone: item.timing_state === "overdue" ? "critical" : "warning" },
                  ...(item.source_entity_label ? [{ label: item.source_entity_label, tone: "info" as const }] : [])
                ]}
                flags={[
                  ...(item.status !== "open" ? [{ label: item.status === "snoozed" ? "Snoozed" : "Handled", tone: "warning" as const }] : []),
                  ...(item.scope_department ? [{ label: item.scope_department, tone: "neutral" as const }] : [])
                ]}
                nextAction={item.next_action_label}
                density="compact"
                selected={selectedItem?.id === item.id}
                onClick={() => setSelectedItemId(item.id)}
              />
            ))}
            {!loading && !items.length ? (
              <div className="empty-state">No open exceptions need action for this date and scope.</div>
            ) : null}
          </div>

          <aside className="preview-detail-panel">
            {selectedItem ? (
              <>
                <div className="preview-detail-panel__header">
                  <div>
                    <div className="eyebrow">{selectedItem.source_module_label}</div>
                    <strong>{selectedItem.title}</strong>
                  </div>
                  <span className={`ops-preview-chip ops-preview-chip--${selectedItem.severity === "blocking" ? "critical" : "warning"}`}>
                    {selectedItem.severity_label}
                  </span>
                </div>
                <div className="preview-detail-panel__meta">
                  <span className="meta-pill">{humanizeValue(selectedItem.type)}</span>
                  <span className="meta-pill">{humanizeValue(selectedItem.category)}</span>
                  <span className="meta-pill">{selectedItem.timing_label}</span>
                  {selectedItem.source_entity_label ? <span className="meta-pill">{selectedItem.source_entity_label}</span> : null}
                </div>
                <div className="muted">{selectedItem.summary}</div>

                <div className="dashboard-summary-list urgent-watch-detail-grid">
                  <div className="dashboard-summary-row">
                    <span className="muted">Owner</span>
                    <strong>{selectedItem.owner_label ?? "Needs owner"}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Due</span>
                    <strong>{selectedItem.due_label ?? "No due time"}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Source</span>
                    <strong>{selectedItem.source_module_label}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Next action</span>
                    <strong>{selectedItem.next_action_label}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Impact score</span>
                    <strong>{selectedItem.operational_impact_score}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Status</span>
                    <strong>{selectedItem.status_detail ?? humanizeValue(selectedItem.status)}</strong>
                  </div>
                </div>

                <div className="preview-detail-panel__actions">
                  <button type="button" className="secondary-button" onClick={() => (window.location.hash = selectedItem.action_hash)}>
                    Open Owning Workspace
                  </button>
                </div>

                {canManage && detail ? (
                  <div className="urgent-watch-action-stack">
                    <div className="section-title">Quick Actions</div>
                    <div className="form-grid">
                      <label className="filter-field">
                        <span>Assign owner</span>
                        <select value={assignOwnerId} onChange={(event) => setAssignOwnerId(event.target.value)}>
                          <option value="">Unassigned</option>
                          {detail.owner_options.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="filter-field filter-field--wide">
                        <span>Assignment note</span>
                        <input value={assignNote} onChange={(event) => setAssignNote(event.target.value)} placeholder="Optional assignment context" />
                      </label>
                    </div>
                    <div className="preview-detail-panel__actions">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={acting}
                        onClick={() =>
                          void runAction(
                            {
                              action: "assign_owner",
                              owner_user_id: assignOwnerId || null,
                              note: assignNote.trim() || null
                            },
                            assignOwnerId ? "Exception owner updated." : "Exception owner cleared."
                          )
                        }
                      >
                        {acting ? "Saving..." : assignOwnerId ? "Assign Owner" : "Clear Owner"}
                      </button>
                    </div>

                    <div className="form-grid">
                      <label className="filter-field filter-field--wide">
                        <span>Snooze reason</span>
                        <input value={snoozeReason} onChange={(event) => setSnoozeReason(event.target.value)} placeholder="Why is it safe to snooze?" />
                      </label>
                      <label className="filter-field">
                        <span>Duration</span>
                        <select value={snoozeDuration} onChange={(event) => setSnoozeDuration(event.target.value)}>
                          <option value="15">15 minutes</option>
                          <option value="30">30 minutes</option>
                          <option value="60">1 hour</option>
                          <option value="240">4 hours</option>
                          <option value="1440">24 hours</option>
                        </select>
                      </label>
                    </div>
                    <div className="preview-detail-panel__actions">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={acting || !snoozeReason.trim()}
                        onClick={() =>
                          void runAction(
                            {
                              action: "snooze",
                              reason: snoozeReason.trim(),
                              duration_minutes: Number(snoozeDuration),
                              note: actionNote.trim() || null
                            },
                            "Exception snoozed."
                          )
                        }
                      >
                        {acting ? "Saving..." : "Snooze"}
                      </button>
                    </div>

                    <label className="filter-field filter-field--wide">
                      <span>Handled note</span>
                      <textarea rows={3} value={actionNote} onChange={(event) => setActionNote(event.target.value)} placeholder="What did you do, or why is this now safe?" />
                    </label>
                    <div className="preview-detail-panel__actions">
                      <button
                        type="button"
                        className="primary-button"
                        disabled={acting}
                        onClick={() =>
                          void runAction(
                            {
                              action: "mark_handled",
                              note: actionNote.trim() || null
                            },
                            "Exception marked handled."
                          )
                        }
                      >
                        {acting ? "Saving..." : "Mark Handled"}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="section-title">Event History</div>
                {detailLoading ? (
                  <div className="empty-state">Loading detail...</div>
                ) : detail?.history.length ? (
                  <div className="urgent-watch-history">
                    {detail.history.map((event) => (
                      <article key={event.id} className="urgent-watch-history__item">
                        <div className="urgent-watch-history__meta">
                          <strong>{event.summary}</strong>
                          <span>{formatDateTime(event.created_at)}</span>
                        </div>
                        {event.note ? <p>{event.note}</p> : null}
                        <div className="muted">{event.actor_name ?? "System"}</div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">No exception history has been recorded for this item yet.</div>
                )}
              </>
            ) : (
              <div className="empty-state">Choose an exception to see the owner, reason, next action, and history.</div>
            )}
          </aside>
        </div>
      </section>
    </>
  );
}

function getInitialExceptionDate() {
  const currentHash = typeof window === "undefined" ? "" : window.location.hash;
  const queryIndex = currentHash.indexOf("?");
  if (queryIndex >= 0) {
    const params = new URLSearchParams(currentHash.slice(queryIndex + 1));
    const value = params.get("date");
    if (value) {
      return value;
    }
  }
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function syncHash(date: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.history.replaceState(null, "", `#operations/exceptions?date=${encodeURIComponent(date)}`);
}

function humanizeValue(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not scheduled";
  }
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

/** @deprecated Use `OperationsExceptions`. */
export const OperationsWatch = OperationsExceptions;
