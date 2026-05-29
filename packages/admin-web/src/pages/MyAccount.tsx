import { useState, type FormEvent } from "react";
import { ApiClientError, apiFetch } from "../api";
import { canAccessSecurityCenter } from "../permissions";
import { elevateSession, endSessionElevation, startBreakGlass, endBreakGlass } from "../services/securityApi";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  user: SessionUser;
  onSessionUpdated?: (user: SessionUser) => void;
  onLoggedOut: (notice?: string) => void;
};

export function MyAccount({ token, user, onSessionUpdated, onLoggedOut }: Props) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [elevationPassword, setElevationPassword] = useState("");
  const [elevationReason, setElevationReason] = useState("");
  const [breakGlassReason, setBreakGlassReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [elevating, setElevating] = useState(false);
  const [endingElevation, setEndingElevation] = useState(false);
  const [togglingBreakGlass, setTogglingBreakGlass] = useState(false);

  function handleSecurityChallenge(err: unknown, fallbackMessage: string) {
    if (err instanceof ApiClientError && err.status === 428 && isMicrosoftStepUpChallenge(err.details)) {
      window.location.assign(err.details.start_url);
      return true;
    }
    setError(err instanceof Error ? err.message : fallbackMessage);
    return false;
  }

  async function submitPasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await apiFetch("/auth/change-password", token, {
        method: "POST",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword
        })
      });
      onLoggedOut("Password changed successfully. Sign in again with your new password.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't change your password.");
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    setLoggingOut(true);
    setError("");
    try {
      const response = await apiFetch<{ federated_logout_url?: string | null }>("/auth/logout", token, { method: "POST" });
      onLoggedOut("Signed out.");
      if (user.sessionTrust.identityProvider === "microsoft_entra" && response.federated_logout_url) {
        window.location.assign(response.federated_logout_url);
        return;
      }
    } catch {
      // Always clear local access if the user chose to sign out.
      onLoggedOut("Signed out.");
    } finally {
      setLoggingOut(false);
    }
  }

  async function activateElevation() {
    setElevating(true);
    setError("");
    try {
      const response = await elevateSession(token, {
        current_password: elevationPassword || undefined,
        reason: elevationReason || undefined,
        action_key: "session.elevate",
        return_hash: "#account"
      });
      setElevationPassword("");
      onSessionUpdated?.(response.user);
    } catch (err) {
      handleSecurityChallenge(err, "We couldn't elevate this session.");
    } finally {
      setElevating(false);
    }
  }

  async function deactivateElevation() {
    setEndingElevation(true);
    setError("");
    try {
      const response = await endSessionElevation(token);
      onSessionUpdated?.(response.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't end the elevated session.");
    } finally {
      setEndingElevation(false);
    }
  }

  async function toggleBreakGlass() {
    setTogglingBreakGlass(true);
    setError("");
    try {
      if (user.sessionTrust.breakGlassModeActive) {
        const response = await endBreakGlass(token, {});
        onSessionUpdated?.(response.user);
      } else {
        const response = await startBreakGlass(token, {
          reason: breakGlassReason || "Emergency privileged access",
          scope_type: "session"
        });
        onSessionUpdated?.(response.user);
      }
      setBreakGlassReason("");
    } catch (err) {
      handleSecurityChallenge(err, "We couldn't update break-glass state.");
    } finally {
      setTogglingBreakGlass(false);
    }
  }

  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">My Account</div>
          <h2>Account &amp; Session</h2>
          <p>Check your current access, update your password, and sign out cleanly when you are done.</p>
        </div>
        <div className="page-intro-actions">
          <div className="metric-pill">Role: {user.roles.map(humanizeLabel).join(", ")}</div>
          <div className="metric-pill">Department: {humanizeLabel(user.department)}</div>
          <div className={`metric-pill metric-pill--${user.sessionTrust.breakGlassModeActive ? "danger" : user.sessionTrust.elevatedSessionActive ? "success" : "neutral"}`}>
            {user.sessionTrust.breakGlassModeActive ? "Break Glass Active" : user.sessionTrust.elevatedSessionActive ? "Elevated Session Active" : "Standard Session"}
          </div>
        </div>
      </section>

      <section className="account-layout">
        <article className="panel access-panel">
          <div className="section-title">Current Membership</div>
          <p className="section-subtitle">This page reflects your current membership and role in real time.</p>
          <div className="account-card">
            <div className="account-card__row">
              <span className="muted">Name</span>
              <strong>{user.fullName}</strong>
            </div>
            <div className="account-card__row">
              <span className="muted">Email</span>
              <strong>{user.email}</strong>
            </div>
            <div className="account-card__row">
              <span className="muted">Status</span>
              <div className={`badge-pill member-status member-status--${user.status}`}>{humanizeLabel(user.status)}</div>
            </div>
            <div className="account-card__row">
              <span className="muted">Department</span>
              <strong>{humanizeLabel(user.department)}</strong>
            </div>
            <div className="account-card__row">
              <span className="muted">Email Verified</span>
              <strong>{user.isEmailVerified ? "Yes" : "No"}</strong>
            </div>
            <div className="account-card__row">
              <span className="muted">Identity Provider</span>
              <strong>{humanizeLabel(user.sessionTrust.identityProvider)}</strong>
            </div>
            <div className="account-card__row">
              <span className="muted">Session Assurance</span>
              <strong>{humanizeLabel(user.sessionTrust.sessionAssurance)}</strong>
            </div>
            <div className="account-card__row">
              <span className="muted">Request Transport</span>
              <strong>{humanizeLabel(user.sessionTrust.requestTransport)}</strong>
            </div>
            <div className="account-card__row">
              <span className="muted">Last Reauthentication</span>
              <strong>{formatDateTime(user.sessionTrust.lastReauthenticatedAt)}</strong>
            </div>
            <div className="account-card__row">
              <span className="muted">Auth Context IDs</span>
              <strong>{user.sessionTrust.activeAuthContextIds?.length ? user.sessionTrust.activeAuthContextIds.join(", ") : "None"}</strong>
            </div>
            <div className="account-card__row">
              <span className="muted">Elevation Expires</span>
              <strong>{formatDateTime(user.sessionTrust.elevatedUntil)}</strong>
            </div>
            <div className="account-card__row">
              <span className="muted">Break Glass Expires</span>
              <strong>{formatDateTime(user.sessionTrust.breakGlassUntil)}</strong>
            </div>
          </div>
        </article>

        <article className="panel access-panel">
          <div className="section-title">Privileged Session Controls</div>
          <p className="section-subtitle">Privileged and dangerous actions require a short-lived elevated session. Break-glass is reserved for emergency override workflows.</p>
          <div className="access-form">
            <label>
              <span className="field-label">Elevation Reason</span>
              <input value={elevationReason} onChange={(event) => setElevationReason(event.target.value)} placeholder="Optional context for review" />
            </label>
            <label>
              <span className="field-label">Current Password</span>
              <input
                type="password"
                value={elevationPassword}
                onChange={(event) => setElevationPassword(event.target.value)}
                placeholder="Required for password-backed sessions"
              />
            </label>
            <div className="access-actions">
              <button type="button" disabled={elevating || user.sessionTrust.elevatedSessionActive} onClick={() => void activateElevation()}>
                {elevating ? "Elevating..." : user.sessionTrust.elevatedSessionActive ? "Elevation Active" : "Elevate Session"}
              </button>
              <button type="button" className="secondary-button" disabled={endingElevation || !user.sessionTrust.elevatedSessionActive} onClick={() => void deactivateElevation()}>
                {endingElevation ? "Ending..." : "End Elevation"}
              </button>
            </div>
            {canAccessSecurityCenter(user) ? (
              <>
                <label>
                  <span className="field-label">Break-Glass Reason</span>
                  <input value={breakGlassReason} onChange={(event) => setBreakGlassReason(event.target.value)} placeholder="Required for emergency override" />
                </label>
                <div className="access-actions">
                  <button
                    type="button"
                    className={user.sessionTrust.breakGlassModeActive ? "secondary-button" : ""}
                    disabled={togglingBreakGlass}
                    onClick={() => void toggleBreakGlass()}
                  >
                    {togglingBreakGlass ? "Updating..." : user.sessionTrust.breakGlassModeActive ? "End Break Glass" : "Start Break Glass"}
                  </button>
                </div>
              </>
            ) : null}
          </div>
          {user.sessionTrust.breakGlassModeActive ? (
            <div className="error-banner">
              Break-glass mode is active for this session. Every privileged action is under heightened audit until it ends.
            </div>
          ) : null}
          {user.microsoftEntraAuthorization ? (
            <div className="section-subtitle">
              Entra authorization resolves to {user.microsoftEntraAuthorization.resolved.authorityTier ?? "no authority tier"}.
              {user.microsoftEntraAuthorization.issues.length
                ? ` ${user.microsoftEntraAuthorization.issues.length} mapping issue(s) are attached to this session.`
                : " No mapping issues are attached to this session."}
            </div>
          ) : null}
        </article>

        <article className="panel access-panel">
          <div className="section-title">Change Password</div>
          <p className="section-subtitle">Changing your password signs out this device right away. Use the new password the next time you sign in.</p>
          <form className="access-form" onSubmit={(event) => void submitPasswordChange(event)}>
            <label>
              <span className="field-label">Current Password</span>
              <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
            </label>
            <label>
              <span className="field-label">New Password</span>
              <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} required />
            </label>
            <div className="access-actions">
              <button type="submit" disabled={saving}>
                {saving ? "Updating Password..." : "Save New Password"}
              </button>
              <button type="button" className="secondary-button" disabled={loggingOut} onClick={() => void logout()}>
                {loggingOut ? "Signing Out..." : "Sign Out"}
              </button>
            </div>
          </form>
          {error ? <div className="error-banner">{error}</div> : null}
        </article>
      </section>
    </>
  );
}

function humanizeLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not active";
}

function isMicrosoftStepUpChallenge(
  value: unknown
): value is {
  start_url: string;
  challenge_type: "microsoft_entra_step_up";
} {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.challenge_type === "microsoft_entra_step_up" && typeof record.start_url === "string" && record.start_url.length > 0;
}
