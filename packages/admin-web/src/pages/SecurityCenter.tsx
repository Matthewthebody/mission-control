import { useEffect, useMemo, useState } from "react";
import {
  approveSecurityApproval,
  cancelSecurityApproval,
  getMicrosoftSecurityTruth,
  getSecurityOverview,
  listBreakGlassEvents,
  listSecurityApprovals,
  rejectSecurityApproval,
  reviewBreakGlassEvent
} from "../services/securityApi";
import type { BreakGlassEventRecord, MicrosoftSecurityTruthWorkspace, SecurityApprovalRequestRecord, SecurityOverview, SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

export function SecurityCenter({ token, currentUser }: Props) {
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [microsoftTruth, setMicrosoftTruth] = useState<MicrosoftSecurityTruthWorkspace | null>(null);
  const [approvals, setApprovals] = useState<SecurityApprovalRequestRecord[]>([]);
  const [breakGlassEvents, setBreakGlassEvents] = useState<BreakGlassEventRecord[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const canManage = useMemo(
    () => currentUser.permissions.includes("security.manage") || ["super_admin", "leadership"].includes(currentUser.authorityTier),
    [currentUser]
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [overviewPayload, microsoftTruthPayload, approvalsPayload, breakGlassPayload] = await Promise.all([
        getSecurityOverview(token),
        getMicrosoftSecurityTruth(token),
        listSecurityApprovals(token, "pending"),
        listBreakGlassEvents(token)
      ]);
      setOverview(overviewPayload);
      setMicrosoftTruth(microsoftTruthPayload);
      setApprovals(approvalsPayload);
      setBreakGlassEvents(breakGlassPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't load the security review surface.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  async function runAction(key: string, action: () => Promise<unknown>, message: string) {
    setBusyKey(key);
    setError("");
    setSuccess("");
    try {
      await action();
      setSuccess(message);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The security action did not complete.");
    } finally {
      setBusyKey("");
    }
  }

  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">Privileged Surface</div>
          <h2>Security Center</h2>
          <p>High-trust approvals, break-glass review, and dangerous-action visibility stay isolated here instead of leaking into routine ops screens.</p>
        </div>
        <div className="page-intro-actions">
          <div className={`metric-pill metric-pill--${currentUser.sessionTrust.elevatedSessionActive ? "success" : "neutral"}`}>
            Elevation: {currentUser.sessionTrust.elevatedSessionActive ? "Active" : "Standard"}
          </div>
          <div className={`metric-pill metric-pill--${currentUser.sessionTrust.breakGlassModeActive ? "danger" : "neutral"}`}>
            Break Glass: {currentUser.sessionTrust.breakGlassModeActive ? "Active" : "Off"}
          </div>
        </div>
      </section>

      {success ? <section className="panel feedback-strip feedback-strip--success">{success}</section> : null}
      {error ? <section className="panel feedback-strip feedback-strip--danger">{error}</section> : null}

      <section className="metrics-grid">
        <article className="stat-card panel">
          <div className="eyebrow">Pending Approvals</div>
          <strong>{overview?.pending_approval_count ?? 0}</strong>
          <span className="muted">High-trust actions waiting on a second reviewer.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Active Break Glass</div>
          <strong>{overview?.active_break_glass_count ?? 0}</strong>
          <span className="muted">Emergency sessions currently open.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Pending Review</div>
          <strong>{overview?.pending_break_glass_review_count ?? 0}</strong>
          <span className="muted">Break-glass events still waiting for after-action review.</span>
        </article>
      </section>

      <section className="access-layout">
        <div className="access-column">
          <section className="panel access-panel">
            <div className="section-title">Current Session Trust</div>
            <div className="account-card">
              <div className="account-card__row">
                <span className="muted">Identity Provider</span>
                <strong>{humanize(overview?.current_session.identity_provider ?? "unknown")}</strong>
              </div>
              <div className="account-card__row">
                <span className="muted">Assurance</span>
                <strong>{humanize(overview?.current_session.session_assurance ?? "standard")}</strong>
              </div>
              <div className="account-card__row">
                <span className="muted">Authenticated</span>
                <strong>{formatDateTime(overview?.current_session.authenticated_at)}</strong>
              </div>
              <div className="account-card__row">
                <span className="muted">Last Reauth</span>
                <strong>{formatDateTime(overview?.current_session.last_reauthenticated_at)}</strong>
              </div>
              <div className="account-card__row">
                <span className="muted">Auth Contexts</span>
                <strong>{overview?.current_session.active_auth_context_ids.length ? overview.current_session.active_auth_context_ids.join(", ") : "None"}</strong>
              </div>
            </div>
            {overview?.microsoft_auth_diagnostics ? (
              <details className="audit-card">
                <summary>
                  Entra Resolution
                  {overview.microsoft_auth_diagnostics.issues.length
                    ? ` (${overview.microsoft_auth_diagnostics.issues.length} issue${overview.microsoft_auth_diagnostics.issues.length === 1 ? "" : "s"})`
                    : " (healthy)"}
                </summary>
                <div className="audit-card__line">
                  Raw app roles: {overview.microsoft_auth_diagnostics.raw_inputs?.appRoleValues?.join(", ") || "None"}
                </div>
                <div className="audit-card__line">
                  Raw group IDs: {overview.microsoft_auth_diagnostics.raw_inputs?.groupIds?.join(", ") || "None"}
                </div>
                <div className="audit-card__line">
                  Resolved authority: {overview.microsoft_auth_diagnostics.resolved_access?.authorityTier ?? "None"}
                </div>
                <div className="audit-card__line">
                  Base role: {overview.microsoft_auth_diagnostics.resolved_access?.baseRole ?? "None"}
                </div>
                <div className="audit-card__line">
                  Overlays: {overview.microsoft_auth_diagnostics.resolved_access?.capabilityOverlays?.join(", ") || "None"}
                </div>
                <div className="audit-card__line">
                  Policy roles: {overview.microsoft_auth_diagnostics.resolved_access?.policyRoles?.join(", ") || "None"}
                </div>
                <div className="audit-card__line">
                  Final permissions: {overview.microsoft_auth_diagnostics.resolved_access?.permissionKeys?.join(", ") || "None"}
                </div>
                <div className="audit-card__line">
                  Flags:
                  {" "}
                  {[
                    overview.microsoft_auth_diagnostics.resolved_access?.financeSensitiveAccess ? "Finance" : null,
                    overview.microsoft_auth_diagnostics.resolved_access?.communicationsModeration ? "CommunicationsModerator" : null,
                    overview.microsoft_auth_diagnostics.resolved_access?.userAccessAdministration ? "UserAccessAdmin" : null,
                    overview.microsoft_auth_diagnostics.resolved_access?.securityAdministration ? "SecurityAdmin" : null
                  ]
                    .filter(Boolean)
                    .join(", ") || "None"}
                </div>
                {(overview.microsoft_auth_diagnostics.issues ?? []).map((issue) => (
                  <div key={issue.code} className="audit-card__line">
                    {issue.severity === "error" ? "Blocked" : "At Risk"}: {issue.message}
                  </div>
                ))}
              </details>
            ) : null}
          </section>

          <section className="panel access-panel">
            <div className="section-title">Microsoft Security Truth</div>
            <div className="member-card__meta">
              <span className={`badge-pill status-chip status-chip--${getTruthTone(microsoftTruth?.overall_status ?? "at_risk")}`}>
                {humanize(microsoftTruth?.overall_status ?? "at_risk")}
              </span>
              <span className="meta-pill">Healthy {microsoftTruth?.summary.healthy ?? 0}</span>
              <span className="meta-pill">At Risk {microsoftTruth?.summary.at_risk ?? 0}</span>
              <span className="meta-pill">Blocked {microsoftTruth?.summary.blocked ?? 0}</span>
            </div>
            <div className="audit-list">
              {(microsoftTruth?.controls ?? []).map((control) => (
                <details key={control.control_key} className="audit-card">
                  <summary>
                    {control.title} | {humanize(control.status)}
                  </summary>
                  <div className="audit-card__line"><strong>What:</strong> {control.what}</div>
                  <div className="audit-card__line"><strong>Why:</strong> {control.why}</div>
                  <div className="audit-card__line"><strong>Fix:</strong> {control.fix}</div>
                  <div className="audit-card__line"><strong>Owner:</strong> {control.owner}</div>
                  <div className="audit-card__line"><strong>Evidence:</strong> {control.evidence.length ? control.evidence.map((item) => item.label).join(", ") : "No evidence attached yet."}</div>
                  <div className="audit-card__line"><strong>Retest:</strong> {control.retest}</div>
                  <div className="audit-card__line"><strong>Checked:</strong> {formatDateTime(control.checked_at)}</div>
                  {(control.live_issues ?? []).map((issue) => (
                    <div key={issue.code} className="audit-card__line">
                      {issue.severity === "error" ? "Blocked" : "At Risk"}: {issue.summary}
                    </div>
                  ))}
                </details>
              ))}
            </div>
          </section>
        </div>

        <aside className="access-column access-column--narrow">
          <section className="panel access-panel">
            <div className="section-title">Production Posture</div>
            <div className="audit-list">
              <article className="audit-card">
                <div className="audit-card__line">Dev login: {overview?.risky_fallbacks.allow_dev_login ? "Blocked" : "Off"}</div>
                <div className="audit-card__line">Password login: {overview?.risky_fallbacks.allow_password_login ? "Enabled" : "Off"}</div>
                <div className="audit-card__line">
                  Break-glass only: {overview?.risky_fallbacks.allow_password_login_break_glass_only ? "Yes" : "No"}
                </div>
                <div className="audit-card__line">Teams dev bypass: {overview?.risky_fallbacks.teams_dev_bypass_auth ? "Blocked" : "Off"}</div>
              </article>
            </div>
          </section>

          <section className="panel access-panel">
            <div className="section-title">Re-Audit Checklist</div>
            <div className="audit-list">
              {(microsoftTruth?.re_audit_checklist ?? []).map((item) => (
                <article key={item.control_key} className="audit-card">
                  <div className="audit-card__head">
                    <strong>{item.title}</strong>
                    <span className={`badge-pill status-chip status-chip--${getTruthTone(item.status)}`}>{humanize(item.status)}</span>
                  </div>
                  <div className="audit-card__line">{item.pass_criteria}</div>
                  <div className="audit-card__line">Retest: {item.retest_action}</div>
                </article>
              ))}
            </div>
          </section>
        </aside>
      </section>

      <section className="access-layout">
        <div className="access-column">
          <section className="panel access-panel">
            <div className="section-title">Pending Security Approvals</div>
            {loading ? <div className="empty-state">Loading security approvals...</div> : null}
            {!loading && !approvals.length ? <div className="empty-state">No privileged approvals are waiting right now.</div> : null}
            <div className="access-card-list">
              {approvals.map((approval) => (
                <article key={approval.id} className="member-card">
                  <div className="member-card__header">
                    <div>
                      <strong>{humanize(approval.request_type)}</strong>
                      <div className="muted">
                        Requested by {approval.requester_name ?? approval.requester_email ?? "Unknown"} for {approval.target_name ?? approval.target_email ?? "Unknown"}
                      </div>
                    </div>
                    <div className="badge-pill status-chip status-chip--warning">{humanize(approval.required_approver_tier)} review</div>
                  </div>
                  <div className="member-card__meta">
                    <span className="meta-pill">Action: {humanize(approval.action_code)}</span>
                    <span className="meta-pill">Created: {formatDateTime(approval.created_at)}</span>
                  </div>
                  <div className="muted">{approval.reason}</div>
                  <div className="member-card__controls member-card__controls--stacked">
                    <div className="security-diff">
                      <div className="security-diff__label">Current</div>
                      <code>{JSON.stringify(approval.current_state)}</code>
                    </div>
                    <div className="security-diff">
                      <div className="security-diff__label">Requested</div>
                      <code>{JSON.stringify(approval.requested_state)}</code>
                    </div>
                  </div>
                  <div className="access-actions">
                    {canManage ? (
                      <>
                        <button
                          type="button"
                          disabled={busyKey === `approve:${approval.id}`}
                          onClick={() =>
                            void runAction(
                              `approve:${approval.id}`,
                              () => approveSecurityApproval(token, approval.id),
                              "Privileged approval executed."
                            )
                          }
                        >
                          {busyKey === `approve:${approval.id}` ? "Approving..." : "Approve & Execute"}
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={busyKey === `reject:${approval.id}`}
                          onClick={() =>
                            void runAction(
                              `reject:${approval.id}`,
                              () => rejectSecurityApproval(token, approval.id),
                              "Privileged approval rejected."
                            )
                          }
                        >
                          {busyKey === `reject:${approval.id}` ? "Rejecting..." : "Reject"}
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busyKey === `cancel:${approval.id}`}
                      onClick={() =>
                        void runAction(
                          `cancel:${approval.id}`,
                          () => cancelSecurityApproval(token, approval.id),
                          "Pending approval canceled."
                        )
                      }
                    >
                      {busyKey === `cancel:${approval.id}` ? "Canceling..." : "Cancel"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <aside className="access-column access-column--narrow">
          <section className="panel access-panel">
            <div className="section-title">Break-Glass Review</div>
            {!breakGlassEvents.length && !loading ? <div className="empty-state">No emergency override events are recorded yet.</div> : null}
            <div className="audit-list">
              {breakGlassEvents.map((event) => (
                <article key={event.id} className="audit-card">
                  <div className="audit-card__head">
                    <strong>{event.actor_name ?? "Unknown actor"}</strong>
                    <span className="muted">{formatDateTime(event.started_at)}</span>
                  </div>
                  <div className="audit-card__line">{event.reason}</div>
                  <div className="audit-card__line">Scope: {event.scope_type ? `${event.scope_type}${event.scope_id ? ` / ${event.scope_id}` : ""}` : "session-wide"}</div>
                  <div className="audit-card__line">Status: {humanize(event.review_status)}</div>
                  {event.review_status !== "reviewed" && canManage ? (
                    <div className="access-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busyKey === `review:${event.id}`}
                        onClick={() =>
                          void runAction(
                            `review:${event.id}`,
                            () => reviewBreakGlassEvent(token, event.id),
                            "Break-glass event marked reviewed."
                          )
                        }
                      >
                        {busyKey === `review:${event.id}` ? "Reviewing..." : "Mark Reviewed"}
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section className="panel access-panel">
            <div className="section-title">Recent Dangerous Actions</div>
            {!overview?.recent_dangerous_actions.length && !loading ? <div className="empty-state">No dangerous actions recorded recently.</div> : null}
            <div className="audit-list">
              {(overview?.recent_dangerous_actions ?? []).map((event) => (
                <article key={event.id} className="audit-card">
                  <div className="audit-card__head">
                    <strong>{humanize(event.action_code)}</strong>
                    <span className={`badge-pill status-chip status-chip--${event.status === "failed" ? "danger" : event.status === "denied" ? "warning" : "success"}`}>
                      {humanize(event.status)}
                    </span>
                  </div>
                  <div className="audit-card__line">{event.actor_name ?? "Unknown actor"} via {event.source_module}</div>
                  <div className="audit-card__line">{formatDateTime(event.created_at)}</div>
                </article>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </>
  );
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not available";
}

function getTruthTone(status: "healthy" | "at_risk" | "blocked") {
  switch (status) {
    case "healthy":
      return "success";
    case "blocked":
      return "danger";
    default:
      return "warning";
  }
}
