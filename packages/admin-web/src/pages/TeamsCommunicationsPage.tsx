import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiClientError } from "../api";
import { buildShellRouteHash } from "../navigation";
import {
  canModerateCommunications,
  canAccessTeamsCommunicationSurface,
  canManageCommunicationMeetings,
  canSendCommunicationMessages,
  canUseCommunicationActions
} from "../permissions";
import { hideCommunicationDelivery, restoreCommunicationDelivery } from "../services/communicationModerationApi";
import { getTeamsEmbeddedCommunicationHub } from "../services/teamsEmbeddedCommunicationsApi";
import { upsertTeamsMeeting } from "../services/teamsMeetingsApi";
import { queueTeamsCommunicationMessage } from "../services/teamsCommunicationApi";
import type { TeamsEmbeddedCommunicationEntry, TeamsEmbeddedCommunicationHub } from "../teamsEmbeddedCommunicationTypes";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

type LoadState =
  | { status: "loading"; data: null; error: string }
  | { status: "ready"; data: TeamsEmbeddedCommunicationHub; error: string }
  | { status: "error"; data: null; error: string };

type UrgentAlert = {
  id: string;
  title: string;
  summary: string;
  tone: "warning" | "critical";
  route_hash: string;
};

function createLoadingState(): LoadState {
  return {
    status: "loading",
    data: null,
    error: ""
  };
}

function navigateToHash(hash: string) {
  window.location.hash = hash.startsWith("#") ? hash : `#${hash}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatTimestamp(value: string | null | undefined) {
  return formatDateTime(value) ?? "Not attempted yet";
}

function ModuleShell({
  title,
  subtitle,
  tone = "neutral",
  actionLabel,
  actionHash,
  children
}: {
  title: string;
  subtitle: string;
  tone?: "neutral" | "info" | "warning" | "critical";
  actionLabel?: string;
  actionHash?: string | null;
  children: ReactNode;
}) {
  return (
    <section className={`panel teams-home__module teams-home__module--${tone}`}>
      <div className="teams-home__module-header">
        <div>
          <div className="eyebrow">Record-Linked Communication Actions</div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {actionLabel && actionHash ? (
          <button type="button" className="secondary-button" onClick={() => navigateToHash(actionHash)}>
            {actionLabel}
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function MetricList({
  items
}: {
  items: Array<{ label: string; value: string | number; tone?: "neutral" | "info" | "warning" | "critical" }>;
}) {
  return (
    <div className="teams-home__metrics">
      {items.map((item) => (
        <div key={item.label} className={`teams-home__metric${item.tone ? ` teams-home__metric--${item.tone}` : ""}`}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function ModuleState({ message, error = false }: { message: string; error?: boolean }) {
  return <div className={`teams-home__state${error ? " teams-home__state--error" : ""}`}>{message}</div>;
}

function getPrimaryReference(entry: TeamsEmbeddedCommunicationEntry) {
  return entry.communication.references.find((reference) => reference.is_primary) ?? entry.communication.references[0] ?? null;
}

function buildEntryMeta(entry: TeamsEmbeddedCommunicationEntry) {
  return [entry.record_kind_label, entry.organization_label, entry.location_label, formatDateTime(entry.scheduled_start_at ?? entry.due_at)]
    .filter(Boolean)
    .join(" | ");
}

function buildUrgentAlerts(entries: TeamsEmbeddedCommunicationEntry[]): UrgentAlert[] {
  return entries.flatMap((entry) => {
    const alerts: UrgentAlert[] = [];
    const latestDelivery = entry.communication.recent_deliveries[0] ?? null;
    const primaryReference = getPrimaryReference(entry);
    if (entry.meeting.meeting?.sync_error) {
      alerts.push({
        id: `${entry.object_type}:${entry.object_id}:meeting-sync`,
        title: `${entry.object_label} meeting sync needs attention`,
        summary: entry.meeting.meeting.sync_error,
        tone: "critical",
        route_hash: entry.route_hash
      });
    }
    if (latestDelivery?.status === "failed") {
      alerts.push({
        id: `${entry.object_type}:${entry.object_id}:delivery-failed`,
        title: `${entry.object_label} message send failed`,
        summary: latestDelivery.last_error || "The latest Teams send attempt failed.",
        tone: "critical",
        route_hash: entry.route_hash
      });
    }
    if (!primaryReference && (entry.communication.permissions.can_send || entry.communication.permissions.can_configure)) {
      alerts.push({
        id: `${entry.object_type}:${entry.object_id}:missing-destination`,
        title: `${entry.object_label} is missing a Teams destination`,
        summary: "Link a chat or channel before sending record updates from Teams.",
        tone: "warning",
        route_hash: entry.route_hash
      });
    }
    return alerts;
  });
}

function EntryCard({
  entry,
  canUse,
  canSend,
  canManageMeetings,
  canModerate,
  draft,
  sending,
  startingMeeting,
  moderating,
  composerOpen,
  notice,
  error,
  onToggleComposer,
  onDraftChange,
  onSend,
  onStartMeeting,
  onModerate
}: {
  entry: TeamsEmbeddedCommunicationEntry;
  canUse: boolean;
  canSend: boolean;
  canManageMeetings: boolean;
  canModerate: boolean;
  draft: string;
  sending: boolean;
  startingMeeting: boolean;
  moderating: boolean;
  composerOpen: boolean;
  notice: string;
  error: string;
  onToggleComposer: () => void;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onStartMeeting: () => void;
  onModerate: () => void;
}) {
  const primaryReference = getPrimaryReference(entry);
  const latestDelivery = entry.communication.recent_deliveries[0] ?? null;
  const joinUrl = entry.meeting.meeting?.meeting_join_url ?? null;

  return (
    <article className="teams-communications__entry">
      <div className="teams-communications__entry-copy">
        <div className="teams-communications__entry-meta">{buildEntryMeta(entry)}</div>
        <h3>{entry.object_label}</h3>
        <p>
          {primaryReference
            ? `Teams destination: ${primaryReference.label}`
            : "No Teams destination is linked yet for this record."}
        </p>
        <small>
          {latestDelivery
            ? `Latest send ${latestDelivery.status} | ${formatTimestamp(
                latestDelivery.sent_at ?? latestDelivery.last_attempted_at ?? latestDelivery.created_at
              )}`
            : "No recent Teams sends logged for this record."}
        </small>
        <small>
          {entry.meeting.meeting
            ? `Meeting ${entry.meeting.meeting.meeting_status} | ${formatTimestamp(entry.meeting.meeting.scheduled_start_at)}`
            : "No linked Teams meeting yet."}
        </small>
      </div>

      <div className="teams-communications__entry-actions">
        <button type="button" className="secondary-button" onClick={() => navigateToHash(entry.route_hash)}>
          Open Record
        </button>
        {canUse && primaryReference ? (
          <a className="secondary-button" href={primaryReference.teams_web_url} target="_blank" rel="noreferrer">
            Open Linked Teams Destination
          </a>
        ) : null}
        {canSend && entry.communication.permissions.can_send && primaryReference ? (
          <button type="button" className="secondary-button" onClick={onToggleComposer}>
            Send Record-Linked Update
          </button>
        ) : null}
        {canUse && joinUrl ? (
          <a className="secondary-button" href={joinUrl} target="_blank" rel="noreferrer">
            Join Linked Meeting
          </a>
        ) : null}
        {canManageMeetings && entry.meeting.permissions.can_manage && !entry.meeting.meeting ? (
          <button type="button" className="secondary-button" disabled={startingMeeting} onClick={onStartMeeting}>
            {startingMeeting ? "Starting..." : "Start Teams Meeting"}
          </button>
        ) : null}
        {canModerate && latestDelivery ? (
          <button type="button" className="secondary-button" disabled={moderating} onClick={onModerate}>
            {moderating
              ? "Saving..."
              : latestDelivery.visibility_status === "moderated_hidden"
                ? "Restore Message"
                : "Hide Latest Message"}
          </button>
        ) : null}
      </div>

      {composerOpen ? (
        <div className="teams-communications__composer">
          <label className="filter-field filter-field--wide">
            <span>Internal update</span>
            <textarea
              rows={3}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder={`Share a short operational update for ${entry.object_label}.`}
            />
          </label>
          <div className="teams-communications__entry-actions">
            <button type="button" className="secondary-button" disabled={sending || !draft.trim()} onClick={onSend}>
              {sending ? "Sending..." : "Send Teams Message"}
            </button>
          </div>
        </div>
      ) : null}

      {notice ? <div className="shared-job-list__notice">{notice}</div> : null}
      {error ? <div className="shared-job-list__error">{error}</div> : null}
      {canModerate && latestDelivery?.visibility_status === "moderated_hidden" ? (
        <div className="shared-job-list__notice">
          This message is hidden from normal users{latestDelivery.moderation_reason ? `: ${latestDelivery.moderation_reason}` : "."}
        </div>
      ) : null}
    </article>
  );
}

export function TeamsCommunicationsPage({ token, currentUser }: Props) {
  const [hubState, setHubState] = useState<LoadState>(createLoadingState);
  const [composerEntryId, setComposerEntryId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sendingEntryId, setSendingEntryId] = useState<string | null>(null);
  const [startingMeetingEntryId, setStartingMeetingEntryId] = useState<string | null>(null);
  const [moderatingDeliveryId, setModeratingDeliveryId] = useState<string | null>(null);
  const [entryNotice, setEntryNotice] = useState<Record<string, string>>({});
  const [entryError, setEntryError] = useState<Record<string, string>>({});

  const canUse = canUseCommunicationActions(currentUser);
  const canSend = canSendCommunicationMessages(currentUser);
  const canManageMeetings = canManageCommunicationMeetings(currentUser);
  const canModerate = canModerateCommunications(currentUser);
  const canAccessSurface = canAccessTeamsCommunicationSurface(currentUser);

  useEffect(() => {
    let cancelled = false;
    setHubState(createLoadingState());
    void getTeamsEmbeddedCommunicationHub(token)
      .then((payload) => {
        if (!cancelled) {
          setHubState({
            status: "ready",
            data: payload,
            error: ""
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setHubState({
            status: "error",
            data: null,
          error: error instanceof ApiClientError ? error.message : "We couldn't load record-linked communication actions."
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canAccessSurface, token]);

  const hub = hubState.status === "ready" ? hubState.data : null;
  const entries = hub?.entries ?? [];
  const urgentAlerts = useMemo(() => buildUrgentAlerts(entries), [entries]);
  const meetingEntries = useMemo(() => entries.filter((entry) => Boolean(entry.meeting.meeting)), [entries]);

  async function reload() {
    const payload = await getTeamsEmbeddedCommunicationHub(token);
    setHubState({
      status: "ready",
      data: payload,
      error: ""
    });
  }

  async function handleSend(entry: TeamsEmbeddedCommunicationEntry) {
    const draft = drafts[entry.object_id] ?? "";
    const primaryReference = getPrimaryReference(entry);
    if (!primaryReference || !draft.trim()) {
      return;
    }
    setSendingEntryId(entry.object_id);
    setEntryNotice((current) => ({ ...current, [entry.object_id]: "" }));
    setEntryError((current) => ({ ...current, [entry.object_id]: "" }));
    try {
      const delivery = await queueTeamsCommunicationMessage(token, {
        reference_id: primaryReference.id,
        object_type: entry.object_type,
        object_id: entry.object_id,
        message_text: draft.trim(),
        app_deep_link: entry.route_hash
      });
      setEntryNotice((current) => ({
        ...current,
        [entry.object_id]:
          delivery.status === "throttled" ? "Message was throttled to avoid duplicate Teams noise." : "Teams message queued."
      }));
      setDrafts((current) => ({ ...current, [entry.object_id]: "" }));
      setComposerEntryId(null);
      await reload();
    } catch (error) {
      setEntryError((current) => ({
        ...current,
        [entry.object_id]: error instanceof ApiClientError ? error.message : "We couldn't queue that Teams message."
      }));
    } finally {
      setSendingEntryId(null);
    }
  }

  async function handleStartMeeting(entry: TeamsEmbeddedCommunicationEntry) {
    setStartingMeetingEntryId(entry.object_id);
    setEntryNotice((current) => ({ ...current, [entry.object_id]: "" }));
    setEntryError((current) => ({ ...current, [entry.object_id]: "" }));
    try {
      await upsertTeamsMeeting(token, {
        object_type: entry.object_type,
        object_id: entry.object_id,
        meeting_mode:
          entry.meeting.defaults.scheduled_start_at && entry.meeting.defaults.scheduled_end_at
            ? "calendar_event"
            : "standalone_online_meeting",
        title: entry.meeting.defaults.suggested_title,
        description: entry.meeting.defaults.suggested_description,
        scheduled_start_at: entry.meeting.defaults.scheduled_start_at,
        scheduled_end_at: entry.meeting.defaults.scheduled_end_at
      });
      setEntryNotice((current) => ({
        ...current,
        [entry.object_id]: "Teams meeting creation queued."
      }));
      await reload();
    } catch (error) {
      setEntryError((current) => ({
        ...current,
        [entry.object_id]: error instanceof ApiClientError ? error.message : "We couldn't queue that Teams meeting."
      }));
    } finally {
      setStartingMeetingEntryId(null);
    }
  }

  async function handleModeration(entry: TeamsEmbeddedCommunicationEntry) {
    const latestDelivery = entry.communication.recent_deliveries[0] ?? null;
    if (!latestDelivery) {
      return;
    }
    const reason =
      window.prompt(
        latestDelivery.visibility_status === "moderated_hidden"
          ? "Optional restore note"
          : "Moderation reason"
      ) ?? "";
    if (latestDelivery.visibility_status !== "moderated_hidden" && !reason.trim()) {
      setEntryError((current) => ({
        ...current,
        [entry.object_id]: "A moderation reason is required to hide a message."
      }));
      return;
    }
    setModeratingDeliveryId(latestDelivery.id);
    setEntryNotice((current) => ({ ...current, [entry.object_id]: "" }));
    setEntryError((current) => ({ ...current, [entry.object_id]: "" }));
    try {
      if (latestDelivery.visibility_status === "moderated_hidden") {
        await restoreCommunicationDelivery(token, latestDelivery.id, reason.trim() || null);
        setEntryNotice((current) => ({
          ...current,
          [entry.object_id]: "The moderated message is visible to users again."
        }));
      } else {
        await hideCommunicationDelivery(token, latestDelivery.id, reason.trim());
        setEntryNotice((current) => ({
          ...current,
          [entry.object_id]: "The latest message was removed from normal user-facing view and kept in the audit trail."
        }));
      }
      await reload();
    } catch (error) {
      setEntryError((current) => ({
        ...current,
        [entry.object_id]: error instanceof ApiClientError ? error.message : "We couldn't update moderation state."
      }));
    } finally {
      setModeratingDeliveryId(null);
    }
  }

  return (
    <div className="teams-communications">
      <section className="panel teams-home__hero">
        <div className="teams-home__hero-copy">
          <div className="eyebrow">Teams Personal App</div>
          <h1>Human-facing Teams actions for record-linked work.</h1>
          <p>
            Keep Teams focused on fast follow-through: linked updates, reviewed destinations, urgent delivery issues,
            and quick jumps back into the Mission Control record that still owns the work.
          </p>
        </div>
        <MetricList
          items={[
            { label: "Actions", value: hub?.summary.action_records ?? 0, tone: "info" },
            { label: "Meetings", value: hub?.summary.active_meetings ?? 0, tone: "neutral" },
            {
              label: "Urgent Alerts",
              value: hub?.summary.urgent_alerts ?? 0,
              tone: (hub?.summary.urgent_alerts ?? 0) > 0 ? "critical" : "neutral"
            }
          ]}
        />
      </section>

      {hubState.status === "loading" ? <ModuleState message="Loading your record-linked communication actions..." /> : null}
      {hubState.status === "error" ? <ModuleState message={hubState.error} error /> : null}

      {hub ? (
        <>
          {hub.availability.state !== "ready" ? (
            <ModuleShell
              title={hub.availability.title}
              subtitle={hub.availability.detail}
              tone={hub.availability.state === "revoked" ? "critical" : hub.availability.state === "limited" ? "info" : "warning"}
              actionLabel="Back To Teams Home"
              actionHash={buildShellRouteHash("teams-home")}
            >
              <ModuleState message={hub.availability.fix_hint ?? "Record links still work, and communication actions will unlock when the underlying requirement is satisfied."} />
            </ModuleShell>
          ) : null}

          {!hub.feature_flags.personal_app_enabled ? (
            <ModuleShell
              title="Teams Communications Tab"
              subtitle="This communication surface is feature-flagged off in the current environment."
              tone="warning"
            >
              <ModuleState message="The Teams personal communications surface is disabled here. Enable the Teams personal app feature flag to use this tab." />
            </ModuleShell>
          ) : null}

          <div className="teams-home__grid">
            <ModuleShell
              title="My Teams Actions"
              subtitle="Assigned jobs and tasks with reviewed Teams destinations, fast open links, and tightly scoped follow-through."
              actionLabel="Back To Teams Home"
              actionHash={buildShellRouteHash("teams-home")}
            >
              {entries.length ? (
                <div className="teams-communications__entries">
                  {entries.map((entry) => (
                    <EntryCard
                      key={`${entry.object_type}:${entry.object_id}`}
                      entry={entry}
                      canUse={canUse}
                      canSend={canSend}
                      canManageMeetings={canManageMeetings}
                      draft={drafts[entry.object_id] ?? ""}
                      sending={sendingEntryId === entry.object_id}
                      startingMeeting={startingMeetingEntryId === entry.object_id}
                      composerOpen={composerEntryId === entry.object_id}
                      notice={entryNotice[entry.object_id] ?? ""}
                      error={entryError[entry.object_id] ?? ""}
                      onToggleComposer={() =>
                        setComposerEntryId((current) => (current === entry.object_id ? null : entry.object_id))
                      }
                      onDraftChange={(value) => setDrafts((current) => ({ ...current, [entry.object_id]: value }))}
                      onSend={() => void handleSend(entry)}
                      onStartMeeting={() => void handleStartMeeting(entry)}
                      canModerate={canModerate}
                      moderating={moderatingDeliveryId === (entry.communication.recent_deliveries[0]?.id ?? null)}
                      onModerate={() => void handleModeration(entry)}
                    />
                  ))}
                </div>
              ) : (
                <ModuleState message="No assigned job or task records are communication-ready in your current view." />
              )}
            </ModuleShell>

            <ModuleShell
              title="My Meetings"
              subtitle="Join linked Teams meetings when they are enabled, or jump straight back into the underlying Mission Control work."
              tone="info"
            >
              {meetingEntries.length ? (
                <div className="teams-home__list">
                  {meetingEntries.map((entry) => (
                    <div key={`meeting:${entry.object_type}:${entry.object_id}`} className="teams-home__list-item teams-communications__meeting-item">
                      <strong>{entry.object_label}</strong>
                      <span>{buildEntryMeta(entry)}</span>
                      <small>
                        {entry.meeting.meeting
                          ? `${entry.meeting.meeting.meeting_status} | ${formatTimestamp(entry.meeting.meeting.scheduled_start_at)}`
                          : "No meeting linked"}
                      </small>
                      <div className="teams-communications__meeting-actions">
                        <button type="button" className="secondary-button" onClick={() => navigateToHash(entry.route_hash)}>
                          Open Record
                        </button>
                        {canUse && entry.meeting.meeting?.meeting_join_url ? (
                          <a className="secondary-button" href={entry.meeting.meeting.meeting_join_url} target="_blank" rel="noreferrer">
                            Join Meeting
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <ModuleState message="No linked Teams meetings are active across your assigned communication records." />
              )}
            </ModuleShell>

            <ModuleShell
              title="Urgent Communication Alerts"
              subtitle="Failures, sync issues, and missing Teams destinations that need human follow-through."
              tone={urgentAlerts.length ? "critical" : "neutral"}
            >
              {urgentAlerts.length ? (
                <div className="teams-home__list">
                  {urgentAlerts.map((alert) => (
                    <button
                      key={alert.id}
                      type="button"
                      className={`teams-home__list-item teams-communications__alert teams-communications__alert--${alert.tone}`}
                      onClick={() => navigateToHash(alert.route_hash)}
                    >
                      <strong>{alert.title}</strong>
                      <span>{alert.summary}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <ModuleState message="No urgent communication-related alerts are open right now." />
              )}
            </ModuleShell>

            <ModuleShell
              title="Quick Open"
              subtitle="Jump straight into the assigned record screens behind the Teams action."
              tone="info"
            >
              {entries.length ? (
                <div className="teams-home__quick-actions">
                  {entries.map((entry) => (
                    <button key={`open:${entry.object_type}:${entry.object_id}`} type="button" onClick={() => navigateToHash(entry.route_hash)}>
                      {entry.object_label}
                    </button>
                  ))}
                </div>
              ) : (
                <ModuleState message="No quick-open communication records are available right now." />
              )}
            </ModuleShell>
          </div>
        </>
      ) : null}
    </div>
  );
}
