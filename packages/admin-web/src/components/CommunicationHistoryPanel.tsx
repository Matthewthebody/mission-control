import { useEffect, useState } from "react";
import { ApiClientError } from "../api";
import { copyTextToClipboard } from "../services/communicationActionHelpers";
import { getCommunicationHistoryRecordView } from "../services/communicationHistoryApi";
import type { CommunicationHistoryEntry, CommunicationHistoryLatestSummary, CommunicationHistoryRecordView } from "../communicationHistoryTypes";
import type { TeamsCommunicationLinkedObjectType } from "../teamsCommunicationTypes";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  objectType: TeamsCommunicationLinkedObjectType;
  objectId: string;
  title?: string;
  summary?: string;
};

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "Not recorded";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function humanizeStatus(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ") : "unknown";
}

function LatestStateCard({
  label,
  value
}: {
  label: string;
  value: CommunicationHistoryLatestSummary | null;
}) {
  return (
    <article className="communication-history-panel__summary-card">
      <span>{label}</span>
      <strong>{value?.summary ?? "Nothing recent"}</strong>
      <small>
        {value
          ? `${value.actor_name ?? "System"} - ${formatTimestamp(value.occurred_at)}`
          : "No recent communication metadata has been recorded."}
      </small>
      {value?.failure_reason ? <small>Issue: {value.failure_reason}</small> : null}
    </article>
  );
}

function EntryActions({
  entry,
  canUseActions,
  onCopy,
  onOpenTarget
}: {
  entry: CommunicationHistoryEntry;
  canUseActions: boolean;
  onCopy: (url: string) => void;
  onOpenTarget: (url: string) => void;
}) {
  if (!canUseActions) {
    return null;
  }
  return (
    <div className="communication-history-panel__entry-actions">
      {entry.target_url ? (
        <button type="button" className="secondary-button" onClick={() => onOpenTarget(entry.target_url as string)}>
          {entry.target_type === "meeting" ? "Open Meeting" : "Open Target"}
        </button>
      ) : null}
      {entry.join_url ? (
        <>
          <a className="secondary-button" href={entry.join_url} target="_blank" rel="noreferrer">
            Join
          </a>
          <button type="button" className="secondary-button" onClick={() => onCopy(entry.join_url as string)}>
            Copy Link
          </button>
        </>
      ) : null}
    </div>
  );
}

export function CommunicationHistoryPanel({
  token,
  objectType,
  objectId,
  title = "Communication History",
  summary = "Keep message and meeting metadata tied to the record so staff can see what communication happened, when it happened, and whether anything failed."
}: Props) {
  const [payload, setPayload] = useState<CommunicationHistoryRecordView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getCommunicationHistoryRecordView(token, objectType, objectId)
      .then((next) => {
        if (!cancelled) {
          setPayload(next);
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
          setError(loadError instanceof ApiClientError ? loadError.message : "We couldn't load the communication history for this record.");
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

  async function handleCopy(url: string) {
    setError("");
    try {
      await copyTextToClipboard(url);
      setNotice("Communication link copied.");
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : "We couldn't copy that communication link.");
    }
  }

  function handleOpenTarget(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="shared-job-detail__list-card communication-history-panel">
      <div className="communication-history-panel__header">
        <div>
          <h3>{title}</h3>
          <p>{summary}</p>
        </div>
      </div>

      {loading ? <div className="shared-job-sidebar__muted">Loading communication history...</div> : null}
      {error ? <div className="shared-job-list__error" role="alert">{error}</div> : null}
      {notice ? <div className="shared-job-list__notice" role="status">{notice}</div> : null}

      {!loading && payload ? (
        <div className="communication-history-panel__summary">
          <LatestStateCard label="Latest Message" value={payload.summary.latest_message} />
          <LatestStateCard label="Latest Meeting" value={payload.summary.latest_meeting} />
          <LatestStateCard label="Latest Follow-Up" value={payload.summary.latest_follow_up} />
          <LatestStateCard label="Current Issue" value={payload.summary.latest_failure} />
        </div>
      ) : null}

      {!loading && payload && !payload.feature_enabled && !payload.entries.length ? (
        <div className="communication-history-panel__state">
          Communication actions are disabled in this environment. Existing durable history will appear here when available.
        </div>
      ) : null}

      {!loading && payload && payload.entries.length ? (
        <div className="communication-history-panel__history">
          <div className="section-title with-divider">Recent Communication</div>
          {payload.entries.map((entry) => (
            <article key={entry.id} className="communication-history-panel__entry">
              <div className="communication-history-panel__entry-copy">
                <strong>{entry.summary}</strong>
                <span>
                  {entry.target_label ? `${entry.target_type}: ${entry.target_label}` : humanizeStatus(entry.status)}
                </span>
                <small>{entry.actor_name ?? "System"} - {formatTimestamp(entry.occurred_at)}</small>
                {entry.failure_reason ? <small>Failure: {entry.failure_reason}</small> : null}
              </div>
              <EntryActions
                entry={entry}
                canUseActions={Boolean(payload.permissions.can_use_actions)}
                onCopy={handleCopy}
                onOpenTarget={handleOpenTarget}
              />
            </article>
          ))}
        </div>
      ) : null}

      {!loading && payload && !payload.entries.length ? (
        <div className="communication-history-panel__state">
          No communication history has been recorded for this record yet.
        </div>
      ) : null}
    </section>
  );
}
