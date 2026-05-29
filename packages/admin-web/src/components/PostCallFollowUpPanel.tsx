import { useEffect, useState, type FormEvent } from "react";
import { ApiClientError } from "../api";
import { createPostCallOutcome, getPostCallFollowUpView } from "../services/postCallFollowUpApi";
import type { CreatePostCallOutcomeInput, PostCallFollowUpView } from "../postCallFollowUpTypes";
import type { TeamsMeetingLinkedObjectType } from "../teamsMeetingTypes";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  objectType: TeamsMeetingLinkedObjectType;
  objectId: string;
  title?: string;
  summary?: string;
  onSaved?: () => void;
};

type FormState = {
  summary: string;
  reason_for_call: string;
  notes: string;
  outcome_status: "follow_up_open" | "handled";
  create_follow_up_task: boolean;
  follow_up_task_title: string;
  follow_up_task_assignee_user_id: string;
  follow_up_task_due_at: string;
  flag_issue: boolean;
  issue_severity: "low" | "medium" | "high" | "critical";
  issue_title: string;
  issue_description: string;
};

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "Not recorded";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function buildFormState(payload: PostCallFollowUpView | null): FormState {
  return {
    summary: "",
    reason_for_call: payload?.defaults.suggested_reason ?? "",
    notes: "",
    outcome_status: "handled",
    create_follow_up_task: false,
    follow_up_task_title: payload?.defaults.suggested_task_title ?? "",
    follow_up_task_assignee_user_id: payload?.defaults.default_assignee_user_id ?? "",
    follow_up_task_due_at: "",
    flag_issue: false,
    issue_severity: "medium",
    issue_title: "",
    issue_description: ""
  };
}

export function PostCallFollowUpPanel({
  token,
  objectType,
  objectId,
  title = "Post-Call Follow Up",
  summary = "Capture the outcome fast, then turn it into the next operational step without building a separate meeting-minutes workflow.",
  onSaved
}: Props) {
  const [payload, setPayload] = useState<PostCallFollowUpView | null>(null);
  const [form, setForm] = useState<FormState>(buildFormState(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getPostCallFollowUpView(token, objectType, objectId)
      .then((next) => {
        if (!cancelled) {
          setPayload(next);
          setForm(buildFormState(next));
          setError("");
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          if (loadError instanceof ApiClientError && loadError.status === 403) {
            setPayload(null);
            setError("");
            return;
          }
          setPayload(null);
          setError(getErrorMessage(loadError, "We couldn't load the post-call follow-up flow."));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [objectId, objectType, token]);

  if (!loading && !payload && !error) {
    return null;
  }

  async function reload() {
    const next = await getPostCallFollowUpView(token, objectType, objectId);
    setPayload(next);
    setForm(buildFormState(next));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payload?.permissions.can_log_outcome || !form.summary.trim()) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");

    const request: CreatePostCallOutcomeInput = {
      meeting_id: payload.meeting?.id ?? null,
      summary: form.summary.trim(),
      reason_for_call: form.reason_for_call.trim() || null,
      notes: form.notes.trim() || null,
      outcome_status: form.outcome_status,
      create_follow_up_task: payload.permissions.can_create_follow_up_task ? form.create_follow_up_task : false,
      follow_up_task_title: form.create_follow_up_task ? form.follow_up_task_title.trim() || null : null,
      follow_up_task_assignee_user_id: form.create_follow_up_task ? form.follow_up_task_assignee_user_id || null : null,
      follow_up_task_due_at: form.create_follow_up_task && form.follow_up_task_due_at ? new Date(form.follow_up_task_due_at).toISOString() : null,
      flag_issue: payload.permissions.can_flag_issue ? form.flag_issue : false,
      issue_severity: form.flag_issue ? form.issue_severity : null,
      issue_title: form.flag_issue ? form.issue_title.trim() || null : null,
      issue_description: form.flag_issue ? form.issue_description.trim() || null : null
    };

    try {
      const response = await createPostCallOutcome(token, objectType, objectId, request);
      setPayload(response.view);
      setForm(buildFormState(response.view));
      setNotice("Post-call follow-up saved.");
      onSaved?.();
    } catch (saveError) {
      setError(getErrorMessage(saveError, "We couldn't save the post-call follow-up."));
    } finally {
      setSaving(false);
    }
  }

  const showPanel = Boolean(payload?.meeting || payload?.recent_outcomes.length);
  if (!loading && payload && !showPanel) {
    return null;
  }

  return (
    <section className="shared-job-detail__list-card post-call-follow-up-panel">
      <div className="post-call-follow-up-panel__header">
        <div>
          <h3>{title}</h3>
          <p>{summary}</p>
        </div>
      </div>

      {loading ? <div className="shared-job-sidebar__muted">Loading post-call follow-up...</div> : null}
      {error ? <div className="shared-job-list__error" role="alert">{error}</div> : null}
      {notice ? <div className="shared-job-list__notice" role="status">{notice}</div> : null}

      {!loading && payload && !payload.feature_enabled ? (
        <div className="post-call-follow-up-panel__meeting-context">
          Post-call follow-up is disabled in this environment. Existing outcomes stay visible, but new follow-up logging is blocked.
        </div>
      ) : null}

      {!loading && payload ? (
        <div className="post-call-follow-up-panel__summary">
          <article className="post-call-follow-up-panel__summary-card">
            <span>Latest Outcome</span>
            <strong>{payload.summary.latest_outcome?.summary ?? "Nothing logged yet"}</strong>
            <small>
              {payload.summary.latest_outcome
                ? `${payload.summary.latest_outcome.actor_name ?? "System"} - ${formatTimestamp(payload.summary.latest_outcome.created_at)}`
                : "Log the next action after the call so the record keeps the follow-through."}
            </small>
          </article>
          <article className="post-call-follow-up-panel__summary-card">
            <span>Open Follow-Ups</span>
            <strong>{payload.summary.open_follow_up_count}</strong>
            <small>Outcomes still marked as needing follow-through.</small>
          </article>
          <article className="post-call-follow-up-panel__summary-card">
            <span>Handled Outcomes</span>
            <strong>{payload.summary.handled_count}</strong>
            <small>Calls that were closed out without leaving the record ambiguous.</small>
          </article>
        </div>
      ) : null}

      {!loading && payload && payload.meeting ? (
        <div className="post-call-follow-up-panel__meeting-context">
          <strong>{payload.meeting.title}</strong>
          <span>Status: {payload.meeting.meeting_status.replace(/_/g, " ")}</span>
          <small>
            {formatTimestamp(payload.meeting.scheduled_start_at)} - {formatTimestamp(payload.meeting.scheduled_end_at)}
          </small>
          {payload.meeting.meeting_join_url ? (
            <a className="secondary-button" href={payload.meeting.meeting_join_url} target="_blank" rel="noreferrer">
              Reopen Meeting Link
            </a>
          ) : null}
        </div>
      ) : null}

      {!loading && payload && payload.permissions.can_log_outcome ? (
        <form className="post-call-follow-up-panel__form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="post-call-follow-up-panel__grid">
            <label className="filter-field filter-field--wide">
              <span>Outcome summary</span>
              <input
                value={form.summary}
                onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))}
                placeholder="What happened and what needs to happen next?"
              />
            </label>
            <label className="filter-field">
              <span>Reason for the call</span>
              <input
                value={form.reason_for_call}
                onChange={(event) => setForm((current) => ({ ...current, reason_for_call: event.target.value }))}
                placeholder="Escalation, scheduling, day-of issue..."
              />
            </label>
            <label className="filter-field">
              <span>Communication status</span>
              <select
                value={form.outcome_status}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    outcome_status: event.target.value as FormState["outcome_status"]
                  }))
                }
              >
                <option value="handled">Handled / completed</option>
                <option value="follow_up_open">Follow-up still open</option>
              </select>
            </label>
            <label className="filter-field filter-field--wide">
              <span>Notes</span>
              <textarea
                rows={4}
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Keep it short and operational. Capture the decision, blocker, or next step."
              />
            </label>
            {payload.permissions.can_create_follow_up_task ? (
              <>
                <label className="post-call-follow-up-panel__toggle">
                  <input
                    type="checkbox"
                    checked={form.create_follow_up_task}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        create_follow_up_task: event.target.checked,
                        outcome_status: event.target.checked ? "follow_up_open" : current.outcome_status
                      }))
                    }
                  />
                  <span>Create follow-up task / assign action item</span>
                </label>
                {form.create_follow_up_task ? (
                  <>
                    <label className="filter-field">
                      <span>Task title</span>
                      <input
                        value={form.follow_up_task_title}
                        onChange={(event) => setForm((current) => ({ ...current, follow_up_task_title: event.target.value }))}
                      />
                    </label>
                    <label className="filter-field">
                      <span>Assign to</span>
                      <select
                        value={form.follow_up_task_assignee_user_id}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            follow_up_task_assignee_user_id: event.target.value
                          }))
                        }
                      >
                        <option value="">Leave unassigned</option>
                        {payload.defaults.assignee_options.map((option) => (
                          <option key={option.user_id} value={option.user_id}>
                            {option.full_name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="filter-field">
                      <span>Due</span>
                      <input
                        type="datetime-local"
                        value={form.follow_up_task_due_at}
                        onChange={(event) => setForm((current) => ({ ...current, follow_up_task_due_at: event.target.value }))}
                      />
                    </label>
                  </>
                ) : null}
              </>
            ) : null}
            {payload.permissions.can_flag_issue ? (
              <>
                <label className="post-call-follow-up-panel__toggle">
                  <input
                    type="checkbox"
                    checked={form.flag_issue}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        flag_issue: event.target.checked,
                        outcome_status: event.target.checked ? "follow_up_open" : current.outcome_status
                      }))
                    }
                  />
                  <span>Flag an issue on the linked job context</span>
                </label>
                {form.flag_issue ? (
                  <>
                    <label className="filter-field">
                      <span>Issue severity</span>
                      <select
                        value={form.issue_severity}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            issue_severity: event.target.value as FormState["issue_severity"]
                          }))
                        }
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                    </label>
                    <label className="filter-field">
                      <span>Issue title</span>
                      <input
                        value={form.issue_title}
                        onChange={(event) => setForm((current) => ({ ...current, issue_title: event.target.value }))}
                        placeholder="Visible issue headline"
                      />
                    </label>
                    <label className="filter-field filter-field--wide">
                      <span>Issue detail</span>
                      <textarea
                        rows={3}
                        value={form.issue_description}
                        onChange={(event) => setForm((current) => ({ ...current, issue_description: event.target.value }))}
                        placeholder="What needs attention after this call?"
                      />
                    </label>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
          <div className="post-call-follow-up-panel__actions">
            <button type="submit" className="secondary-button" disabled={saving || !form.summary.trim()}>
              {saving ? "Saving..." : "Save Post-Call Outcome"}
            </button>
            <button type="button" className="secondary-button" onClick={() => void reload()} disabled={saving}>
              Reset
            </button>
          </div>
        </form>
      ) : null}

      {!loading && payload?.recent_outcomes.length ? (
        <div className="post-call-follow-up-panel__history">
          <div className="section-title with-divider">Recent Outcomes</div>
          {payload.recent_outcomes.map((outcome) => (
            <article key={outcome.id} className="post-call-follow-up-panel__history-item">
              <div>
                <strong>{outcome.summary}</strong>
                <span>
                  {outcome.outcome_status === "handled" ? "Handled" : "Follow-up open"}
                  {outcome.reason_for_call ? ` - ${outcome.reason_for_call}` : ""}
                </span>
                <small>
                  {outcome.actor_name ?? "System"} - {formatTimestamp(outcome.created_at)}
                </small>
                {outcome.notes ? <small>{outcome.notes}</small> : null}
                {outcome.follow_up_task ? (
                  <small>
                    Task: {outcome.follow_up_task.task_number} - {outcome.follow_up_task.title}
                    {outcome.follow_up_task.assigned_to_name ? ` - ${outcome.follow_up_task.assigned_to_name}` : ""}
                  </small>
                ) : null}
                {outcome.follow_up_issue ? (
                  <small>
                    Issue: {outcome.follow_up_issue.title} - {outcome.follow_up_issue.severity}
                  </small>
                ) : null}
              </div>
              <div className="post-call-follow-up-panel__history-actions">
                {outcome.meeting_join_url ? (
                  <a className="secondary-button" href={outcome.meeting_join_url} target="_blank" rel="noreferrer">
                    Reopen
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
