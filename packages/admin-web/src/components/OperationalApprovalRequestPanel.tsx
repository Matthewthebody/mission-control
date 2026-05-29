import { useEffect, useState } from "react";
import type {
  OperationalApprovalCreateInput,
  OperationalApprovalRequestType,
  OperationalApprovalSourceSummary
} from "../types";
import {
  createOperationalApprovalRequest,
  getOperationalApprovalSourceSummary
} from "../services/operationalApprovals";

type ApprovalRequestOption = {
  requestType: OperationalApprovalRequestType;
  label: string;
  description: string;
  requestedActionCode: string;
  defaultSeverity?: "low" | "normal" | "high" | "critical";
  defaultBlocking?: boolean;
};

type Props = {
  token: string;
  sourceModule: string;
  sourceEntityType: "job" | "production_item";
  sourceEntityId: string;
  sourceEntityLabel: string;
  title?: string;
  summary?: string;
  canCreate: boolean;
  requestOptions: ApprovalRequestOption[];
};

type FormState = {
  requestType: OperationalApprovalRequestType;
  requestedActionCode: string;
  requestTitle: string;
  requestSummary: string;
  reason: string;
  severity: "low" | "normal" | "high" | "critical";
  blocking: boolean;
};

export const JOB_OPERATIONAL_APPROVAL_OPTIONS: ApprovalRequestOption[] = [
  {
    requestType: "schedule_change_approval",
    label: "Reschedule Approval",
    description: "Use when schedule changes need formal approval before the job can move forward.",
    requestedActionCode: "job.reschedule",
    defaultSeverity: "high",
    defaultBlocking: true
  },
  {
    requestType: "staffing_exception_approval",
    label: "Staffing Override Approval",
    description: "Use when staffing coverage, role requirements, or protected-window changes need an exception.",
    requestedActionCode: "job.staffing_override",
    defaultSeverity: "high",
    defaultBlocking: true
  },
  {
    requestType: "policy_exception_approval",
    label: "Exception Approval",
    description: "Use for operational exceptions that fall outside standard workflow or policy expectations.",
    requestedActionCode: "job.exception",
    defaultSeverity: "high",
    defaultBlocking: true
  },
  {
    requestType: "fee_refund_approval",
    label: "Fee / Refund Approval",
    description: "Use for job-level fee exceptions, credits, or refund decisions that need formal sign-off.",
    requestedActionCode: "job.fee_refund",
    defaultSeverity: "high",
    defaultBlocking: true
  }
];

export const PRODUCTION_OPERATIONAL_APPROVAL_OPTIONS: ApprovalRequestOption[] = [
  {
    requestType: "rush_order_approval",
    label: "Rush Order Approval",
    description: "Use when downstream work needs a rush path and leadership or production approval should be explicit.",
    requestedActionCode: "production.rush_order",
    defaultSeverity: "high",
    defaultBlocking: true
  },
  {
    requestType: "release_override_approval",
    label: "Release / Sign-Off Approval",
    description: "Use when a release, sign-off, or final handoff needs formal approval before it can complete.",
    requestedActionCode: "production.release_signoff",
    defaultSeverity: "critical",
    defaultBlocking: true
  },
  {
    requestType: "policy_exception_approval",
    label: "Exception Approval",
    description: "Use for production exceptions that need an explicit override instead of a silent workaround.",
    requestedActionCode: "production.exception",
    defaultSeverity: "high",
    defaultBlocking: true
  }
];

function buildDefaultForm(option: ApprovalRequestOption, sourceEntityLabel: string): FormState {
  return {
    requestType: option.requestType,
    requestedActionCode: option.requestedActionCode,
    requestTitle: `${option.label} for ${sourceEntityLabel}`,
    requestSummary: option.description,
    reason: "",
    severity: option.defaultSeverity ?? "high",
    blocking: option.defaultBlocking ?? true
  };
}

export function OperationalApprovalRequestPanel({
  token,
  sourceModule,
  sourceEntityType,
  sourceEntityId,
  sourceEntityLabel,
  title = "Operational Approvals",
  summary = "Request gated approvals here when work needs an exception, override, or formal sign-off.",
  canCreate,
  requestOptions
}: Props) {
  const [data, setData] = useState<OperationalApprovalSourceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createMode, setCreateMode] = useState(false);
  const [form, setForm] = useState<FormState>(() => buildDefaultForm(requestOptions[0], sourceEntityLabel));

  useEffect(() => {
    setForm(buildDefaultForm(requestOptions[0], sourceEntityLabel));
  }, [requestOptions, sourceEntityLabel]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getOperationalApprovalSourceSummary(token, {
      source_module: sourceModule,
      source_entity_type: sourceEntityType,
      source_entity_id: sourceEntityId
    })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setData(response);
        setError("");
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setData(null);
        setError(loadError instanceof Error ? loadError.message : "We couldn't load approval history right now.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sourceEntityId, sourceEntityType, sourceModule, token]);

  async function refresh() {
    const response = await getOperationalApprovalSourceSummary(token, {
      source_module: sourceModule,
      source_entity_type: sourceEntityType,
      source_entity_id: sourceEntityId
    });
    setData(response);
    setError("");
    return response;
  }

  function applyOption(requestType: OperationalApprovalRequestType) {
    const option = requestOptions.find((item) => item.requestType === requestType) ?? requestOptions[0];
    setForm(buildDefaultForm(option, sourceEntityLabel));
  }

  async function handleCreate() {
    if (!form.requestTitle.trim() || !form.reason.trim()) {
      setError("Add a short title and decision reason before sending this approval request.");
      return;
    }
    const payload: OperationalApprovalCreateInput = {
      request_type: form.requestType,
      source_module: sourceModule,
      source_entity_type: sourceEntityType,
      source_entity_id: sourceEntityId,
      requested_action_code: form.requestedActionCode,
      request_title: form.requestTitle.trim(),
      request_summary: form.requestSummary.trim() || null,
      reason: form.reason.trim(),
      severity: form.severity,
      blocking: form.blocking,
      metadata: {
        requested_via: "record_panel"
      }
    };

    setSaving(true);
    try {
      const created = await createOperationalApprovalRequest(token, payload);
      await refresh();
      setNotice(`${created.request_type_label} submitted.`);
      setCreateMode(false);
      applyOption(form.requestType);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "We couldn't submit that approval request.");
    } finally {
      setSaving(false);
    }
  }

  const visibleItems = data?.items ?? [];

  return (
    <section className="request-card operational-approval-panel">
      <div className="directory-card__header">
        <div>
          <strong>{title}</strong>
          <div className="muted">{summary}</div>
        </div>
        <div className="page-intro-actions page-intro-actions--compact">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              window.location.hash = "#approvals?tab=operational";
            }}
          >
            Open Inbox
          </button>
          {canCreate ? (
            <button
              type="button"
              onClick={() => {
                setCreateMode((current) => !current);
                setNotice("");
                setError("");
              }}
            >
              {createMode ? "Close Request" : "Request Approval"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="operational-approval-panel__summary">
        <span className="meta-pill">{visibleItems.length} tracked</span>
        <span className="meta-pill">{data?.blocking_open_count ?? 0} blocking</span>
        <span className="meta-pill">{data?.overdue_count ?? 0} overdue</span>
        <span className="meta-pill">{data?.escalated_count ?? 0} escalated</span>
      </div>

      {notice ? (
        <div className="feedback-strip feedback-strip--success">
          <div className="feedback-strip__content">{notice}</div>
        </div>
      ) : null}

      {error ? (
        <div className="feedback-strip feedback-strip--warning">
          <div className="feedback-strip__content">{error}</div>
        </div>
      ) : null}

      {createMode ? (
        <div className="operational-approval-panel__form">
          <div className="field-grid">
            <label className="filter-field">
              <span>Approval type</span>
              <select
                aria-label="Approval type"
                value={form.requestType}
                onChange={(event) => applyOption(event.target.value as OperationalApprovalRequestType)}
              >
                {requestOptions.map((option) => (
                  <option key={option.requestType} value={option.requestType}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Severity</span>
              <select
                aria-label="Approval severity"
                value={form.severity}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    severity: event.target.value as FormState["severity"]
                  }))
                }
              >
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label className="filter-field">
              <span>Request title</span>
              <input
                aria-label="Approval title"
                value={form.requestTitle}
                onChange={(event) => setForm((current) => ({ ...current, requestTitle: event.target.value }))}
              />
            </label>
            <label className="filter-field">
              <span>Short summary</span>
              <input
                aria-label="Approval summary"
                value={form.requestSummary}
                onChange={(event) => setForm((current) => ({ ...current, requestSummary: event.target.value }))}
              />
            </label>
            <label className="filter-field">
              <span>Decision reason</span>
              <textarea
                aria-label="Approval reason"
                rows={4}
                value={form.reason}
                onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
              />
            </label>
            <label className="operational-approval-panel__toggle">
              <input
                type="checkbox"
                checked={form.blocking}
                onChange={(event) => setForm((current) => ({ ...current, blocking: event.target.checked }))}
              />
              <span>Treat as blocking until approved</span>
            </label>
          </div>
          <div className="muted operational-approval-panel__help">
            {requestOptions.find((option) => option.requestType === form.requestType)?.description ?? "Explain what needs approval and why it cannot proceed normally."}
          </div>
          <div className="page-intro-actions page-intro-actions--compact">
            <button type="button" onClick={() => void handleCreate()} disabled={saving}>
              {saving ? "Submitting..." : "Submit Approval"}
            </button>
            <button type="button" className="secondary-button" onClick={() => setCreateMode(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="empty-state empty-state--panel">Loading approval activity...</div>
      ) : visibleItems.length ? (
        <div className="operational-approval-panel__list">
          {visibleItems.map((item) => (
            <article key={item.id} className="operational-approval-panel__item">
              <div className="operational-approval-panel__item-header">
                <div>
                  <strong>{item.request_title}</strong>
                  <div className="muted">
                    {item.request_type_label} | {item.status_label}
                  </div>
                </div>
                <div className="page-intro-actions page-intro-actions--compact">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      window.location.hash = `#approvals?tab=operational&request=${item.id}`;
                    }}
                  >
                    Open
                  </button>
                </div>
              </div>
              <div className="operational-approval-panel__meta">
                <span className="meta-pill">{item.severity}</span>
                <span className="meta-pill">{item.blocking ? "Blocking" : "Advisory"}</span>
                <span className="meta-pill">Requested by {item.requested_by_name ?? "Unknown"}</span>
                {item.current_approver_name ? <span className="meta-pill">With {item.current_approver_name}</span> : null}
              </div>
              {item.request_summary ? <p className="muted">{item.request_summary}</p> : null}
              <p className="muted operational-approval-panel__reason">{item.reason}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state empty-state--panel">
          No approval requests are linked to this record yet.
        </div>
      )}
    </section>
  );
}

export type { ApprovalRequestOption };
