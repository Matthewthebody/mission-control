import { useEffect, useMemo, useState } from "react";
import { ApiClientError } from "../../api";
import {
  getTeamsCommunicationRecordView,
  queueTeamsCommunicationMessage
} from "../../services/teamsCommunicationApi";
import {
  getTeamsMeetingRecordView,
  upsertTeamsMeeting
} from "../../services/teamsMeetingsApi";
import { buildImmediateMeetingWindow, copyTextToClipboard } from "../../services/communicationActionHelpers";
import type { SharedJobStaffAssignment } from "../../jobTruthTypes";
import type { TeamsCommunicationRecordView } from "../../teamsCommunicationTypes";
import type { TeamsMeetingRecordView } from "../../teamsMeetingTypes";
import type { SessionUser } from "../../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  jobId: string;
  assignment: SharedJobStaffAssignment;
};

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "Not available";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function StaffAssignmentCommunicationActions({ token, currentUser, jobId, assignment }: Props) {
  const [communicationView, setCommunicationView] = useState<TeamsCommunicationRecordView | null>(null);
  const [meetingView, setMeetingView] = useState<TeamsMeetingRecordView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const [startingMeeting, setStartingMeeting] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [messageText, setMessageText] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getTeamsCommunicationRecordView(token, "job", jobId),
      getTeamsMeetingRecordView(token, "job", jobId)
    ])
      .then(([nextCommunicationView, nextMeetingView]) => {
        if (cancelled) {
          return;
        }
        setCommunicationView(nextCommunicationView);
        setMeetingView(nextMeetingView);
        setError("");
      })
      .catch((loadError) => {
        if (!cancelled) {
          if (loadError instanceof ApiClientError && loadError.status === 403) {
            setCommunicationView(null);
            setMeetingView(null);
            setError("");
            return;
          }
          setCommunicationView(null);
          setMeetingView(null);
          setError(loadError instanceof ApiClientError ? loadError.message : "We couldn't load the Teams actions for this assignment.");
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
  }, [jobId, token]);

  const primaryReference = useMemo(
    () => communicationView?.references.find((reference) => reference.is_primary) ?? communicationView?.references[0] ?? null,
    [communicationView?.references]
  );
  const latestDelivery = communicationView?.recent_deliveries[0] ?? null;
  const joinUrl = meetingView?.meeting?.meeting_join_url ?? null;

  async function reload() {
    const [nextCommunicationView, nextMeetingView] = await Promise.all([
      getTeamsCommunicationRecordView(token, "job", jobId),
      getTeamsMeetingRecordView(token, "job", jobId)
    ]);
    setCommunicationView(nextCommunicationView);
    setMeetingView(nextMeetingView);
  }

  async function handleSend() {
    if (!primaryReference || !messageText.trim()) {
      return;
    }
    setSending(true);
    setError("");
    setNotice("");
    try {
      await queueTeamsCommunicationMessage(token, {
        reference_id: primaryReference.id,
        object_type: "job",
        object_id: jobId,
        message_text: `[Assignment: ${assignment.user_name ?? assignment.user_id}] ${messageText.trim()}`,
        app_deep_link: window.location.hash || null
      });
      setNotice("Assignment update queued to Teams.");
      setMessageText("");
      setComposerOpen(false);
      await reload();
    } catch (sendError) {
      setError(sendError instanceof ApiClientError ? sendError.message : "We couldn't queue that assignment update.");
    } finally {
      setSending(false);
    }
  }

  async function handleStartMeeting() {
    if (!(meetingView?.permissions.can_create ?? meetingView?.permissions.can_manage)) {
      return;
    }
    const immediateWindow = buildImmediateMeetingWindow();
    setStartingMeeting(true);
    setError("");
    setNotice("");
    try {
      await upsertTeamsMeeting(token, {
        object_type: "job",
        object_id: jobId,
        lifecycle_type: "ad_hoc_call",
        meeting_mode: "standalone_online_meeting",
        title: meetingView.defaults.suggested_title,
        description: meetingView.defaults.suggested_description,
        scheduled_start_at: immediateWindow.scheduled_start_at,
        scheduled_end_at: immediateWindow.scheduled_end_at
      });
      setNotice("Teams meeting creation queued for this job.");
      await reload();
    } catch (meetingError) {
      setError(meetingError instanceof ApiClientError ? meetingError.message : "We couldn't queue that Teams meeting.");
    } finally {
      setStartingMeeting(false);
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

  if (!loading && !communicationView && !meetingView && !error) {
    return null;
  }

  const canUse = Boolean(communicationView?.permissions.can_use || meetingView?.permissions.can_use);
  const canSend = Boolean(communicationView?.permissions.can_send);
  const canManageMeeting = Boolean(meetingView?.permissions.can_manage);
  const canCreateMeeting = Boolean(meetingView?.permissions.can_create ?? meetingView?.permissions.can_manage);
  const canConfigure = Boolean(communicationView?.permissions.can_configure);

  return (
    <div className="shared-job-ops__assignment-communication">
      <div className="shared-job-ops__assignment-communication-summary">
        <strong>Teams context</strong>
        {loading ? <span>Loading Teams actions...</span> : null}
        {!loading ? (
          <>
            <span>{primaryReference ? `Destination: ${primaryReference.label}` : "No Teams destination linked to this job yet."}</span>
            <span>
              {latestDelivery
                ? `Latest send ${latestDelivery.status} · ${formatTimestamp(
                    latestDelivery.sent_at ?? latestDelivery.last_attempted_at ?? latestDelivery.created_at
                  )}`
                : "No recent Teams sends on this job."}
            </span>
            <span>
              {meetingView?.meeting
                ? `Meeting ${meetingView.meeting.status_summary ?? meetingView.meeting.meeting_status} · ${formatTimestamp(meetingView.meeting.scheduled_start_at)}`
                : "No Teams meeting linked to this job."}
            </span>
          </>
        ) : null}
        <small>Assignment actions intentionally use the parent job's Teams destination and meeting context.</small>
      </div>

      {error ? <div className="shared-job-list__error" role="alert">{error}</div> : null}
      {notice ? <div className="shared-job-list__notice" role="status">{notice}</div> : null}

      {!loading ? (
        <div className="shared-job-ops__assignment-communication-actions">
          {canUse && primaryReference ? (
            <a className="secondary-button" href={primaryReference.teams_web_url} target="_blank" rel="noreferrer">
              Open Related Channel
            </a>
          ) : null}
          {canSend && communicationView?.permissions.can_message_assigned_staff && primaryReference ? (
            <button type="button" className="secondary-button" onClick={() => setComposerOpen((current) => !current)}>
              Message Assigned Staff
            </button>
          ) : null}
          {canUse && joinUrl ? (
            <a className="secondary-button" href={joinUrl} target="_blank" rel="noreferrer">
              Join Linked Meeting
            </a>
          ) : null}
          {canUse && joinUrl ? (
            <button type="button" className="secondary-button" onClick={() => void handleCopyMeetingLink()}>
              Copy / Share Meeting Link
            </button>
          ) : null}
          {canCreateMeeting && !meetingView?.meeting ? (
            <button type="button" className="secondary-button" disabled={startingMeeting} onClick={() => void handleStartMeeting()}>
              {startingMeeting ? "Starting..." : "Start Internal Call"}
            </button>
          ) : null}
        </div>
      ) : null}

      {!loading && composerOpen && canSend && communicationView?.permissions.can_message_assigned_staff && primaryReference ? (
        <div className="shared-job-ops__assignment-communication-composer">
          <label className="filter-field filter-field--wide">
            <span>Internal update</span>
            <textarea
              rows={3}
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
              placeholder={`Share a short Teams update for ${assignment.user_name ?? "this assignment"}.`}
            />
          </label>
          <div className="shared-job-ops__assignment-communication-actions">
            <button type="button" className="secondary-button" disabled={sending || !messageText.trim()} onClick={() => void handleSend()}>
              {sending ? "Sending..." : "Send Internal Update"}
            </button>
          </div>
        </div>
      ) : null}

      {!loading && !primaryReference && canConfigure ? (
        <div className="shared-job-sidebar__muted">Link a Teams destination from the job summary to enable assignment messaging.</div>
      ) : null}
    </div>
  );
}
