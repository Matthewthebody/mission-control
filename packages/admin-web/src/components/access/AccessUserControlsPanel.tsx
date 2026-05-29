import { useEffect, useMemo, useState } from "react";
import type { AccessPolicyUserSummary } from "../../accessPolicyTypes";
import {
  reactivateMembershipAccess,
  revokeMembershipAccess,
  suspendMembershipAccess
} from "../../services/accessPolicyApi";
import {
  updateCommunicationAccessState,
  updateCommunicationPostingState
} from "../../services/communicationModerationApi";

type Props = {
  token: string;
  users: AccessPolicyUserSummary[];
  canModerateCommunications: boolean;
  canManageMembership: boolean;
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

function humanize(value: string | null | undefined) {
  return (value ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .trim();
}

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not set";
}

function statusTone(status: AccessPolicyUserSummary["membership_status"] | AccessPolicyUserSummary["communication_identity_status"]) {
  if (status === "active" || status === "linked_ready") {
    return "success";
  }
  if (status === "suspended" || status === "pending_approval" || status === "incomplete") {
    return "warning";
  }
  if (status === "revoked" || status === "disabled") {
    return "danger";
  }
  return "neutral";
}

export function AccessUserControlsPanel({
  token,
  users,
  canModerateCommunications,
  canManageMembership,
  onChanged,
  onNotice,
  onError
}: Props) {
  const [selectedUserId, setSelectedUserId] = useState(users[0]?.user_id ?? "");
  const [communicationReason, setCommunicationReason] = useState("");
  const [busyKey, setBusyKey] = useState("");

  useEffect(() => {
    if (!users.length) {
      setSelectedUserId("");
      return;
    }
    if (!users.some((user) => user.user_id === selectedUserId)) {
      setSelectedUserId(users[0]?.user_id ?? "");
    }
  }, [selectedUserId, users]);

  const selectedUser = useMemo(
    () => users.find((user) => user.user_id === selectedUserId) ?? null,
    [selectedUserId, users]
  );

  async function runAction(key: string, action: () => Promise<unknown>, notice: string) {
    setBusyKey(key);
    onError("");
    try {
      await action();
      await onChanged();
      onNotice(notice);
      if (key.startsWith("disable-") || key.startsWith("revoke-")) {
        setCommunicationReason("");
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "We couldn't complete that access control change.");
    } finally {
      setBusyKey("");
    }
  }

  if (!selectedUser) {
    return (
      <section className="panel access-panel">
        <div className="section-title">Access Controls</div>
        <div className="empty-state">No users are available in this workspace.</div>
      </section>
    );
  }

  return (
    <section className="panel access-panel">
      <div className="section-title">Access Controls</div>
      <p className="section-subtitle">
        Use this panel for immediate communication moderation and emergency access restriction without losing auditability.
      </p>

      <div className="access-form__row">
        <label>
          <span className="field-label">Selected User</span>
          <select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
            {users.map((user) => (
              <option key={user.user_id} value={user.user_id}>
                {user.full_name} ({user.department})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="access-policy-grid">
        <article className="access-policy-card">
          <div className="access-policy-card__head">
            <strong>{selectedUser.full_name}</strong>
            <span className={`badge-pill status-chip status-chip--${statusTone(selectedUser.membership_status)}`}>
              {humanize(selectedUser.membership_status)}
            </span>
          </div>
          <div className="access-policy-kv">
            <span>Email: {selectedUser.email}</span>
            <span>Authority tier: {humanize(selectedUser.authority_tier ?? "not set")}</span>
            <span>Primary profile: {humanize(selectedUser.primary_job_function_profile ?? "not set")}</span>
          </div>
        </article>

        <article className="access-policy-card">
          <div className="access-policy-card__head">
            <strong>Communications</strong>
            <span className={`badge-pill status-chip status-chip--${statusTone(selectedUser.communication_identity_status)}`}>
              {humanize(selectedUser.communication_identity_status)}
            </span>
          </div>
          <div className="access-policy-kv">
            <span>Communication access: {selectedUser.communication_enabled ? "Enabled" : "Disabled"}</span>
            <span>
              Posting: {selectedUser.communication_posting_disabled_at ? "Restricted" : "Allowed"}
            </span>
            <span>Linked at: {formatDateTime(selectedUser.linked_at)}</span>
            <span>Last verified: {formatDateTime(selectedUser.last_verified_at)}</span>
          </div>
          {selectedUser.communication_posting_disabled_reason ? (
            <div className="muted">Posting restriction: {selectedUser.communication_posting_disabled_reason}</div>
          ) : null}
        </article>
      </div>

      {canModerateCommunications ? (
        <>
          <label>
            <span className="field-label">Moderation Reason</span>
            <textarea
              rows={3}
              value={communicationReason}
              onChange={(event) => setCommunicationReason(event.target.value)}
              placeholder="Required when restricting posting or revoking communication access."
            />
          </label>
          <div className="access-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={
                busyKey === "posting" ||
                (selectedUser.communication_posting_disabled_at === null && !communicationReason.trim())
              }
              onClick={() =>
                void runAction(
                  "posting",
                  () =>
                    updateCommunicationPostingState(
                      token,
                      selectedUser.user_id,
                      !selectedUser.communication_posting_disabled_at,
                      !selectedUser.communication_posting_disabled_at ? communicationReason : undefined
                    ),
                  selectedUser.communication_posting_disabled_at ? "Posting restored." : "Posting restricted."
                )
              }
            >
              {busyKey === "posting"
                ? "Saving..."
                : selectedUser.communication_posting_disabled_at
                  ? "Restore Posting"
                  : "Restrict Posting"}
            </button>

            <button
              type="button"
              className="secondary-button"
              disabled={busyKey === "communication-access" || (selectedUser.communication_enabled && !communicationReason.trim())}
              onClick={() =>
                void runAction(
                  "communication-access",
                  () =>
                    updateCommunicationAccessState(
                      token,
                      selectedUser.user_id,
                      !selectedUser.communication_enabled,
                      selectedUser.communication_enabled ? communicationReason : undefined
                    ),
                  selectedUser.communication_enabled ? "Communication access revoked." : "Communication access restored."
                )
              }
            >
              {busyKey === "communication-access"
                ? "Saving..."
                : selectedUser.communication_enabled
                  ? "Revoke Communication Access"
                  : "Restore Communication Access"}
            </button>
          </div>
        </>
      ) : (
        <div className="empty-state">Communication moderation is read-only for your access level.</div>
      )}

      {canManageMembership ? (
        <div className="access-actions">
          {selectedUser.membership_status === "active" ? (
            <button
              type="button"
              className="secondary-button"
              disabled={busyKey === "membership-suspend"}
              onClick={() =>
                void runAction(
                  "membership-suspend",
                  () => suspendMembershipAccess(token, selectedUser.user_id),
                  "App access suspended and active sessions invalidated."
                )
              }
            >
              {busyKey === "membership-suspend" ? "Suspending..." : "Suspend App Access"}
            </button>
          ) : null}

          {selectedUser.membership_status === "suspended" ? (
            <button
              type="button"
              className="secondary-button"
              disabled={busyKey === "membership-reactivate"}
              onClick={() =>
                void runAction(
                  "membership-reactivate",
                  () => reactivateMembershipAccess(token, selectedUser.user_id),
                  "App access restored and prior sessions revoked."
                )
              }
            >
              {busyKey === "membership-reactivate" ? "Restoring..." : "Restore App Access"}
            </button>
          ) : null}

          {selectedUser.membership_status !== "revoked" ? (
            <button
              type="button"
              className="secondary-button"
              disabled={busyKey === "membership-revoke"}
              onClick={() => {
                if (!window.confirm(`Revoke all app access for ${selectedUser.full_name}? This immediately invalidates active sessions.`)) {
                  return;
                }
                void runAction(
                  "membership-revoke",
                  () => revokeMembershipAccess(token, selectedUser.user_id),
                  "App access revoked and active sessions invalidated."
                );
              }}
            >
              {busyKey === "membership-revoke" ? "Revoking..." : "Revoke App Access"}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
