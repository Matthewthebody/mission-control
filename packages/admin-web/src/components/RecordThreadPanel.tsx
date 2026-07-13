import { useEffect, useState } from "react";
import {
  getRecordThread,
  postRecordThreadMessage,
  type RecordThreadObjectType,
  type RecordThreadView
} from "../services/recordThreadsApi";

// SSA-5 Record Threads V1: the record's own conversation — user messages plus
// system events (e.g. a Teams meeting launched from the record). Mirrors the
// RecordResourcesPanel conventions: record-scoped props, load on mount, hide
// entirely when the viewer lacks record access (403).

type Props = {
  token: string;
  objectType: RecordThreadObjectType;
  objectId: string;
  title?: string;
};

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function systemEventLabel(message: { event_type: string | null; metadata: Record<string, unknown> }) {
  if (message.event_type === "meeting_created") {
    const joinUrl = typeof message.metadata.join_url === "string" ? message.metadata.join_url : null;
    return { label: "Teams meeting created", joinUrl };
  }
  return { label: message.event_type ?? "System event", joinUrl: null };
}

export function RecordThreadPanel({ token, objectType, objectId, title = "Record Thread" }: Props) {
  const [view, setView] = useState<RecordThreadView | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setHidden(false);
    getRecordThread(token, objectType, objectId)
      .then((response) => {
        if (!cancelled) {
          setView(response);
          setError("");
        }
      })
      .catch((loadError) => {
        if (cancelled) return;
        // No record access → no panel (the thread is record-gated, not secret).
        if (loadError instanceof Error && /403|forbidden/i.test(loadError.message)) {
          setHidden(true);
        } else {
          setError(loadError instanceof Error ? loadError.message : "We couldn't load this record's thread.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, objectType, objectId]);

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    try {
      const response = await postRecordThreadMessage(token, objectType, objectId, { body });
      setView(response);
      setDraft("");
      setError("");
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : "We couldn't post that message.");
    } finally {
      setPosting(false);
    }
  }

  if (hidden) {
    return null;
  }

  return (
    <section className="panel record-thread-panel" aria-label="Record thread">
      <div className="workflow-change-notice-panel__header">
        <div>
          <div className="eyebrow">Conversation</div>
          <h3>{title}</h3>
          <p>Notes and system events attached to this record — one thread, kept with the work.</p>
        </div>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      {loading ? (
        <p className="muted">Loading thread…</p>
      ) : !view || view.messages.length === 0 ? (
        <p className="muted">No messages yet. Start the record's thread below.</p>
      ) : (
        <ul className="record-thread-panel__list">
          {view.messages.map((message) => {
            if (message.message_kind === "system_event") {
              const event = systemEventLabel(message);
              return (
                <li key={message.id} className="record-thread-panel__event">
                  <span className="meta-pill meta-pill--muted">{event.label}</span>
                  {event.joinUrl ? (
                    <a href={event.joinUrl} target="_blank" rel="noreferrer">
                      Join meeting
                    </a>
                  ) : null}
                  <span className="muted"> {formatTimestamp(message.created_at)}</span>
                </li>
              );
            }
            return (
              <li key={message.id} className="record-thread-panel__message">
                <div className="record-thread-panel__message-head">
                  <strong>{message.author_name ?? "Unknown"}</strong>
                  <span className="muted">{formatTimestamp(message.created_at)}</span>
                </div>
                <p>{message.body}</p>
              </li>
            );
          })}
        </ul>
      )}
      <div className="record-thread-panel__composer">
        <textarea
          aria-label="New thread message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a note for everyone working this record…"
          rows={2}
          disabled={posting}
        />
        <button type="button" className="secondary-button" onClick={() => void submit()} disabled={posting || !draft.trim()}>
          {posting ? "Posting…" : "Post"}
        </button>
      </div>
    </section>
  );
}
