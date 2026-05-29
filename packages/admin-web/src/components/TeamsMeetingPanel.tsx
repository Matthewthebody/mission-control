import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ApiClientError } from "../api";
import { PostCallFollowUpPanel } from "./PostCallFollowUpPanel";
import { buildImmediateMeetingWindow, copyTextToClipboard } from "../services/communicationActionHelpers";
import { cancelTeamsMeeting, getTeamsMeetingRecordView, upsertTeamsMeeting } from "../services/teamsMeetingsApi";
import type { SessionUser } from "../types";
import type {
  TeamsMeetingLifecycleType,
  TeamsMeetingLinkedObjectType,
  TeamsMeetingMode,
  TeamsMeetingRecordView
} from "../teamsMeetingTypes";

type Props = {
  token: string;
  currentUser: SessionUser;
  objectType: TeamsMeetingLinkedObjectType;
  objectId: string;
  title?: string;
  summary?: string;
  renderPreCallContext?: (view: TeamsMeetingRecordView) => ReactNode;
  onPostCallSaved?: () => void;
};

type FormState = {
  lifecycle_type: TeamsMeetingLifecycleType;
  meeting_mode: TeamsMeetingMode;
  title: string;
  description: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
};

function toLocalDateTimeInput(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function toIso(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "Not available";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function buildFormState(payload: TeamsMeetingRecordView | null): FormState {
  const meeting = payload?.meeting;
  const defaults = payload?.defaults;
  return {
    lifecycle_type: meeting?.lifecycle_type ?? defaults?.default_lifecycle_type ?? "scheduled_record_meeting",
    meeting_mode: meeting?.meeting_mode ?? "calendar_event",
    title: meeting?.title ?? defaults?.suggested_title ?? "",
    description: meeting?.description ?? defaults?.suggested_description ?? "",
    scheduled_start_at: toLocalDateTimeInput(meeting?.scheduled_start_at ?? defaults?.scheduled_start_at ?? null),
    scheduled_end_at: toLocalDateTimeInput(meeting?.scheduled_end_at ?? defaults?.scheduled_end_at ?? null)
  };
}

function formatLifecycleLabel(value: TeamsMeetingLifecycleType | null | undefined) {
  switch (value) {
    case "ad_hoc_call":
      return "Ad hoc internal call";
    case "internal_review":
      return "Internal review / escalation";
    case "scheduled_record_meeting":
    default:
      return "Scheduled record meeting";
  }
}

function formatRecordSyncLabel(value: string | null | undefined) {
  return value === "follow_record_schedule" ? "Follows linked record schedule" : "Manual schedule";
}

export function TeamsMeetingPanel({
  token,
  currentUser,
  objectType,
  objectId,
  title = "Teams Meeting",
  summary = "Create an internal Teams meeting from this record, keep the meeting link attached to the app record, and let Teams handle video and screen sharing natively.",
  renderPreCallContext,
  onPostCallSaved
}: Props) {
  const [payload, setPayload] = useState<TeamsMeetingRecordView | null>(null);
  const [form, setForm] = useState<FormState>(buildFormState(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [startingCall, setStartingCall] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getTeamsMeetingRecordView(token, objectType, objectId)
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
          setError(loadError instanceof ApiClientError ? loadError.message : "We couldn't load the Teams meeting state.");
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

  const joinUrl = payload?.meeting?.meeting_join_url ?? null;
  const calendarUrl =
    payload?.meeting?.meeting_web_url && payload.meeting.meeting_web_url !== payload.meeting.meeting_join_url
      ? payload.meeting.meeting_web_url
      : null;

  const participantsSummary = useMemo(() => {
    const participants = payload?.meeting?.participant_snapshot ?? payload?.defaults.suggested_participants ?? [];
    if (!participants.length) {
      return "No linked participants yet";
    }
    return participants.map((participant) => participant.full_name).join(", ");
  }, [payload?.defaults.suggested_participants, payload?.meeting?.participant_snapshot]);

  const lifecycleOptions = useMemo(() => {
    const allowed = payload?.defaults.allowed_lifecycle_types ?? [];
    const current = payload?.meeting?.lifecycle_type ?? form.lifecycle_type;
    return current && !allowed.includes(current) ? [...allowed, current] : allowed;
  }, [form.lifecycle_type, payload?.defaults.allowed_lifecycle_types, payload?.meeting?.lifecycle_type]);

  async function reload() {
    const next = await getTeamsMeetingRecordView(token, objectType, objectId);
    setPayload(next);
    setForm(buildFormState(next));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await upsertTeamsMeeting(token, {
        object_type: objectType,
        object_id: objectId,
        lifecycle_type: form.lifecycle_type,
        meeting_mode: form.meeting_mode,
        title: form.title.trim() || null,
        description: form.description.trim() || null,
        scheduled_start_at: toIso(form.scheduled_start_at),
        scheduled_end_at: toIso(form.scheduled_end_at)
      });
      setNotice(payload?.meeting ? "Teams meeting update queued." : "Teams meeting creation queued.");
      await reload();
    } catch (submitError) {
      setError(submitError instanceof ApiClientError ? submitError.message : "We couldn't queue that Teams meeting change.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (!payload?.meeting) {
      return;
    }
    const reason = window.prompt("Reason for cancelling this Teams meeting", "")?.trim() ?? "";
    if (!reason) {
      return;
    }
    setCanceling(true);
    setError("");
    setNotice("");
    try {
      await cancelTeamsMeeting(token, payload.meeting.id, reason);
      setNotice("Teams meeting cancel queued.");
      await reload();
    } catch (cancelError) {
      setError(cancelError instanceof ApiClientError ? cancelError.message : "We couldn't queue that Teams meeting cancel.");
    } finally {
      setCanceling(false);
    }
  }

  async function handleCopyMeetingLink() {
    if (!joinUrl) {
      return;
    }
    setError("");
    try {
      await copyTextToClipboard(joinUrl);
      setNotice("Meeting link copied.");
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : "We couldn't copy that meeting link.");
    }
  }

  async function handleStartInternalCall() {
    if (!(payload?.permissions.can_create ?? payload?.permissions.can_manage)) {
      return;
    }
    const immediateWindow = buildImmediateMeetingWindow();
    setStartingCall(true);
    setError("");
    setNotice("");
    try {
      await upsertTeamsMeeting(token, {
        object_type: objectType,
        object_id: objectId,
        lifecycle_type: "ad_hoc_call",
        meeting_mode: "standalone_online_meeting",
        title: payload.defaults.suggested_title,
        description: payload.defaults.suggested_description,
        scheduled_start_at: immediateWindow.scheduled_start_at,
        scheduled_end_at: immediateWindow.scheduled_end_at
      });
      setNotice("Internal call queued in Teams.");
      await reload();
    } catch (callError) {
      setError(callError instanceof ApiClientError ? callError.message : "We couldn't start that internal Teams call.");
    } finally {
      setStartingCall(false);
    }
  }

  if (!loading && !payload && !error) {
    return null;
  }

  const openEnabled = Boolean(payload?.permissions.can_use);
  const manageEnabled = Boolean(payload?.permissions.can_manage);
  const createEnabled = Boolean(payload?.permissions.can_create ?? payload?.permissions.can_manage);

  return (
    <section className="shared-job-detail__list-card teams-meeting-panel">
      <div className="teams-meeting-panel__header">
        <div>
          <h3>{title}</h3>
          <p>{summary}</p>
        </div>
      </div>

      {loading ? <div className="shared-job-sidebar__muted">Loading Teams meeting...</div> : null}
      {error ? <div className="shared-job-list__error" role="alert">{error}</div> : null}
      {notice ? <div className="shared-job-list__notice" role="status">{notice}</div> : null}

      {!loading && payload && !payload.feature_enabled ? (
        <div className="teams-meeting-panel__state">
          Teams meeting sync is disabled in this environment. Existing join links can still be reviewed when available.
        </div>
      ) : null}

      {!loading && payload && renderPreCallContext ? renderPreCallContext(payload) : null}

      {!loading && payload?.meeting ? (
        <div className="teams-meeting-panel__meeting">
          <div className="teams-meeting-panel__meeting-copy">
            <strong>{payload.meeting.title}</strong>
            <span>
              {payload.meeting.meeting_mode === "calendar_event" ? "Calendar-backed Teams meeting" : "Standalone Teams meeting"}
            </span>
            <small>{formatLifecycleLabel(payload.meeting.lifecycle_type)}</small>
            <small>{formatRecordSyncLabel(payload.meeting.record_sync_policy)}</small>
            <small>
              {formatTimestamp(payload.meeting.scheduled_start_at)} - {formatTimestamp(payload.meeting.scheduled_end_at)}
            </small>
            <small>Status: {payload.meeting.status_summary ?? payload.meeting.meeting_status}</small>
            <small>Participants: {participantsSummary}</small>
            {payload.meeting.record_behavior_summary ? <small>{payload.meeting.record_behavior_summary}</small> : null}
            {payload.meeting.sync_error ? <small>Last sync error: {payload.meeting.sync_error}</small> : null}
          </div>
          <div className="teams-meeting-panel__meeting-actions">
            {openEnabled && joinUrl ? (
              <a className="secondary-button" href={joinUrl} target="_blank" rel="noreferrer">
                Join / Start Teams Meeting
              </a>
            ) : null}
            {openEnabled && joinUrl ? (
              <button type="button" className="secondary-button" onClick={() => void handleCopyMeetingLink()}>
                Copy / Share Meeting Link
              </button>
            ) : null}
            {openEnabled && calendarUrl ? (
              <a className="secondary-button" href={calendarUrl} target="_blank" rel="noreferrer">
                Open Calendar Event
              </a>
            ) : null}
            {manageEnabled && payload.meeting.meeting_status !== "pending_cancel" && payload.meeting.meeting_status !== "cancelled" ? (
              <button type="button" className="secondary-button" disabled={canceling} onClick={() => void handleCancel()}>
                {canceling ? "Canceling..." : "Cancel Meeting"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!loading && payload && !payload.meeting ? (
        <div className="teams-meeting-panel__state">
          No Teams meeting is linked to this record yet. {payload.defaults.schedule_guidance ?? "Screen sharing stays native to the Teams meeting once it is created."}
        </div>
      ) : null}

      {!loading && payload && createEnabled && !payload.meeting ? (
        <div className="teams-meeting-panel__composer-actions">
          <button type="button" className="secondary-button" disabled={startingCall} onClick={() => void handleStartInternalCall()}>
            {startingCall ? "Starting..." : "Start Internal Call"}
          </button>
        </div>
      ) : null}

      {!loading && payload && manageEnabled ? (
        <form className="teams-meeting-panel__form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="section-title with-divider">{payload.meeting ? "Update Meeting" : "Create Meeting"}</div>
          <div className="teams-meeting-panel__form-grid">
            {lifecycleOptions.length ? (
              <label className="filter-field">
                <span>Purpose</span>
                <select
                  value={form.lifecycle_type}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      lifecycle_type: event.target.value as TeamsMeetingLifecycleType
                    }))
                  }
                >
                  {lifecycleOptions.map((option) => (
                    <option key={option} value={option}>
                      {formatLifecycleLabel(option)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="filter-field">
              <span>Meeting Type</span>
              <select
                value={form.meeting_mode}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    meeting_mode: event.target.value as TeamsMeetingMode
                  }))
                }
              >
                <option value="calendar_event">Calendar-backed Teams meeting</option>
                <option value="standalone_online_meeting">Standalone Teams meeting</option>
              </select>
            </label>
            <label className="filter-field">
              <span>Title</span>
              <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label className="filter-field">
              <span>Start</span>
              <input
                type="datetime-local"
                value={form.scheduled_start_at}
                onChange={(event) => setForm((current) => ({ ...current, scheduled_start_at: event.target.value }))}
              />
            </label>
            <label className="filter-field">
              <span>End</span>
              <input
                type="datetime-local"
                value={form.scheduled_end_at}
                onChange={(event) => setForm((current) => ({ ...current, scheduled_end_at: event.target.value }))}
              />
            </label>
            <label className="filter-field teams-meeting-panel__form-note">
              <span>Description</span>
              <textarea
                rows={3}
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Include the operational context and the app deep link will be embedded in the Teams meeting body."
              />
            </label>
          </div>
          {payload.defaults.schedule_guidance ? <p className="teams-meeting-panel__guidance">{payload.defaults.schedule_guidance}</p> : null}
          <div className="teams-meeting-panel__composer-actions">
            <button
              type="submit"
              className="secondary-button"
              disabled={saving || !form.title.trim() || !form.scheduled_start_at || !form.scheduled_end_at}
            >
              {saving ? "Saving..." : payload.meeting ? "Queue Meeting Update" : "Create Teams Meeting"}
            </button>
          </div>
        </form>
      ) : null}

      {!loading && payload && payload.recent_operations.length ? (
        <div className="teams-meeting-panel__history">
          <div className="section-title with-divider">Recent Meeting Sync</div>
          {payload.recent_operations.map((operation) => (
            <div key={operation.id} className="teams-meeting-panel__history-item">
              <strong>
                {operation.operation_type} - {operation.status}
              </strong>
              <span>{operation.trigger_source}</span>
              <small>
                {formatTimestamp(operation.completed_at ?? operation.failed_at ?? operation.last_attempted_at ?? operation.created_at)}
                {operation.last_error ? ` - ${operation.last_error}` : ""}
              </small>
            </div>
          ))}
        </div>
      ) : null}

      {!loading && payload?.meeting ? (
        <PostCallFollowUpPanel
          token={token}
          currentUser={currentUser}
          objectType={objectType}
          objectId={objectId}
          onSaved={onPostCallSaved}
        />
      ) : null}
    </section>
  );
}
