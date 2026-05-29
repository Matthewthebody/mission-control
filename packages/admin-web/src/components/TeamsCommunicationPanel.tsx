import { useEffect, useState, type FormEvent } from "react";
import { ApiClientError } from "../api";
import {
  createTeamsCommunicationReference,
  getTeamsCommunicationRecordView,
  queueTeamsCommunicationMessage
} from "../services/teamsCommunicationApi";
import type { SessionUser } from "../types";
import type {
  TeamsCommunicationLinkedObjectType,
  TeamsCommunicationRecordView,
  TeamsCommunicationReferenceType
} from "../teamsCommunicationTypes";

type Props = {
  token: string;
  currentUser: SessionUser;
  objectType: TeamsCommunicationLinkedObjectType;
  objectId: string;
  title?: string;
  summary?: string;
};

type ReferenceFormState = {
  reference_type: TeamsCommunicationReferenceType;
  label: string;
  description: string;
  teams_web_url: string;
  team_id: string;
  channel_id: string;
  chat_id: string;
  is_primary: boolean;
};

const DEFAULT_FORM: ReferenceFormState = {
  reference_type: "channel",
  label: "",
  description: "",
  teams_web_url: "",
  team_id: "",
  channel_id: "",
  chat_id: "",
  is_primary: true
};

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "Not attempted yet";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function TeamsCommunicationPanel({
  token,
  objectType,
  objectId,
  title = "Teams Messaging",
  summary = "Link known Teams chats or channels to this record, send short operational updates, or open the right destination when direct send is not appropriate."
}: Props) {
  const [payload, setPayload] = useState<TeamsCommunicationRecordView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [messageText, setMessageText] = useState("");
  const [selectedReferenceId, setSelectedReferenceId] = useState("");
  const [sending, setSending] = useState(false);
  const [savingReference, setSavingReference] = useState(false);
  const [referenceForm, setReferenceForm] = useState<ReferenceFormState>(DEFAULT_FORM);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getTeamsCommunicationRecordView(token, objectType, objectId)
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
          setError(loadError instanceof ApiClientError ? loadError.message : "We couldn't load Teams communication destinations.");
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

  useEffect(() => {
    if (!payload?.references.length) {
      setSelectedReferenceId("");
      return;
    }
    if (!selectedReferenceId || !payload.references.some((reference) => reference.id === selectedReferenceId)) {
      setSelectedReferenceId(payload.references[0].id);
    }
  }, [payload?.references, selectedReferenceId]);

  async function reload() {
    const next = await getTeamsCommunicationRecordView(token, objectType, objectId);
    setPayload(next);
  }

  async function handleSend() {
    if (!selectedReferenceId || !messageText.trim()) {
      return;
    }
    setSending(true);
    setNotice("");
    setError("");
    try {
      const delivery = await queueTeamsCommunicationMessage(token, {
        reference_id: selectedReferenceId,
        object_type: objectType,
        object_id: objectId,
        message_text: messageText.trim(),
        app_deep_link: window.location.hash || null
      });
      setNotice(delivery.status === "throttled" ? "Message was throttled to avoid duplicate Teams noise." : "Teams message queued.");
      setMessageText("");
      await reload();
    } catch (sendError) {
      setError(sendError instanceof ApiClientError ? sendError.message : "We couldn't queue that Teams message.");
    } finally {
      setSending(false);
    }
  }

  async function handleCreateReference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingReference(true);
    setNotice("");
    setError("");
    try {
      await createTeamsCommunicationReference(token, objectType, objectId, {
        reference_type: referenceForm.reference_type,
        label: referenceForm.label,
        description: referenceForm.description || null,
        teams_web_url: referenceForm.teams_web_url,
        team_id: referenceForm.reference_type === "channel" ? referenceForm.team_id || null : null,
        channel_id: referenceForm.reference_type === "channel" ? referenceForm.channel_id || null : null,
        chat_id: referenceForm.reference_type === "chat" ? referenceForm.chat_id || null : null,
        is_primary: referenceForm.is_primary
      });
      setReferenceForm(DEFAULT_FORM);
      setNotice("Teams destination saved.");
      await reload();
    } catch (saveError) {
      setError(saveError instanceof ApiClientError ? saveError.message : "We couldn't save that Teams destination.");
    } finally {
      setSavingReference(false);
    }
  }

  if (!loading && !payload && !error) {
    return null;
  }

  const selectedReference = payload?.references.find((reference) => reference.id === selectedReferenceId) ?? payload?.references[0] ?? null;
  const sendEnabled = Boolean(
    payload?.permissions.can_send &&
      payload.feature_enabled &&
      payload.references.length &&
      (selectedReference?.reference_type === "channel"
        ? payload.permissions.can_message_channels ?? payload.permissions.can_send
        : payload.permissions.can_message_chats ?? payload.permissions.can_send)
  );
  const configureEnabled = Boolean(payload?.permissions.can_configure);
  const openEnabled = Boolean(payload?.permissions.can_use);

  return (
    <section className="shared-job-detail__list-card teams-communication-panel">
      <div className="teams-communication-panel__header">
        <div>
          <h3>{title}</h3>
          <p>{summary}</p>
        </div>
      </div>

      {loading ? <div className="shared-job-sidebar__muted">Loading Teams destinations...</div> : null}
      {error ? <div className="shared-job-list__error" role="alert">{error}</div> : null}
      {notice ? <div className="shared-job-list__notice" role="status">{notice}</div> : null}

      {!loading && payload && !payload.feature_enabled ? (
        <div className="teams-communication-panel__state">
          Direct Teams sending is disabled in this environment. Linked destinations can still be reviewed and opened from the record.
        </div>
      ) : null}

      {!loading && payload && payload.references.length ? (
        <div className="teams-communication-panel__destinations">
          {payload.references.map((reference) => (
            <div key={reference.id} className="teams-communication-panel__destination">
              <div className="teams-communication-panel__destination-copy">
                <strong>{reference.label}</strong>
                <span>
                  {reference.reference_type === "channel"
                    ? `Channel${reference.is_primary ? " · Primary" : ""}`
                    : `Chat${reference.is_primary ? " · Primary" : ""}`}
                </span>
                {reference.description ? <small>{reference.description}</small> : null}
              </div>
              <div className="teams-communication-panel__destination-actions">
                {openEnabled ? (
                  <a className="secondary-button" href={reference.teams_web_url} target="_blank" rel="noreferrer">
                    {reference.reference_type === "channel" ? "Open Related Channel" : "Open Related Chat"}
                  </a>
                ) : (
                  <span className="shared-job-sidebar__muted">Open action requires a linked Teams communication identity.</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {!loading && payload && !payload.references.length ? (
        <div className="teams-communication-panel__state">No Teams destinations are linked to this record yet.</div>
      ) : null}

      {!loading && payload && sendEnabled ? (
        <div className="teams-communication-panel__composer">
          <label className="filter-field">
            <span>Destination</span>
            <select value={selectedReferenceId} onChange={(event) => setSelectedReferenceId(event.target.value)}>
              {payload.references.map((reference) => (
                <option key={reference.id} value={reference.id}>
                  {reference.label} · {reference.reference_type}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Message</span>
            <textarea
              rows={4}
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
              placeholder="Share a short operational update with a deep link back to this record."
            />
          </label>
          <div className="teams-communication-panel__composer-actions">
            <button type="button" className="secondary-button" disabled={sending || !selectedReferenceId || !messageText.trim()} onClick={() => void handleSend()}>
              {sending ? "Sending..." : "Send Teams Message"}
            </button>
          </div>
        </div>
      ) : null}

      {!loading && payload && configureEnabled ? (
        <form className="teams-communication-panel__form" onSubmit={(event) => void handleCreateReference(event)}>
          <div className="section-title with-divider">Link Teams Destination</div>
          <div className="teams-communication-panel__form-grid">
            <label className="filter-field">
              <span>Type</span>
              <select
                value={referenceForm.reference_type}
                onChange={(event) =>
                  setReferenceForm((current) => ({
                    ...current,
                    reference_type: event.target.value as TeamsCommunicationReferenceType
                  }))
                }
              >
                <option value="channel">Channel</option>
                <option value="chat">Chat</option>
              </select>
            </label>
            <label className="filter-field">
              <span>Label</span>
              <input
                value={referenceForm.label}
                onChange={(event) => setReferenceForm((current) => ({ ...current, label: event.target.value }))}
              />
            </label>
            <label className="filter-field">
              <span>Teams URL</span>
              <input
                value={referenceForm.teams_web_url}
                onChange={(event) => setReferenceForm((current) => ({ ...current, teams_web_url: event.target.value }))}
                placeholder="https://teams.microsoft.com/..."
              />
            </label>
            {referenceForm.reference_type === "channel" ? (
              <>
                <label className="filter-field">
                  <span>Team ID</span>
                  <input
                    value={referenceForm.team_id}
                    onChange={(event) => setReferenceForm((current) => ({ ...current, team_id: event.target.value }))}
                  />
                </label>
                <label className="filter-field">
                  <span>Channel ID</span>
                  <input
                    value={referenceForm.channel_id}
                    onChange={(event) => setReferenceForm((current) => ({ ...current, channel_id: event.target.value }))}
                  />
                </label>
              </>
            ) : (
              <label className="filter-field">
                <span>Chat ID</span>
                <input
                  value={referenceForm.chat_id}
                  onChange={(event) => setReferenceForm((current) => ({ ...current, chat_id: event.target.value }))}
                />
              </label>
            )}
            <label className="filter-field teams-communication-panel__checkbox">
              <input
                type="checkbox"
                checked={referenceForm.is_primary}
                onChange={(event) => setReferenceForm((current) => ({ ...current, is_primary: event.target.checked }))}
              />
              <span>Use as the primary Teams destination for this record</span>
            </label>
            <label className="filter-field teams-communication-panel__form-note">
              <span>Description</span>
              <textarea
                rows={2}
                value={referenceForm.description}
                onChange={(event) => setReferenceForm((current) => ({ ...current, description: event.target.value }))}
              />
            </label>
          </div>
          <div className="teams-communication-panel__composer-actions">
            <button type="submit" className="secondary-button" disabled={savingReference}>
              {savingReference ? "Saving..." : "Save Teams Destination"}
            </button>
          </div>
        </form>
      ) : null}

      {!loading && payload && payload.recent_deliveries.length ? (
        <div className="teams-communication-panel__history">
          <div className="section-title with-divider">Recent Teams Sends</div>
          {payload.recent_deliveries.map((delivery) => (
            <div key={delivery.id} className="teams-communication-panel__history-item">
              <strong>{delivery.reference_label}</strong>
              <span>{delivery.message_text}</span>
              <small>
                {delivery.status} · {formatTimestamp(delivery.sent_at ?? delivery.last_attempted_at ?? delivery.created_at)}
                {delivery.last_error ? ` · ${delivery.last_error}` : ""}
              </small>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
