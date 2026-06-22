import { useEffect, useState } from "react";
import { ApiClientError } from "../api";
import { getCentralJob } from "../services/centralJobIntakeApi";
import { OperationalDetailSection } from "./OperationalDetailSection";
import { HistoricalContextPanel } from "./HistoricalContextPanel";
import { ResourceLibraryPanel } from "./ResourceLibraryPanel";
import { ChecklistRuntimePanel } from "./checklists/ChecklistRuntimePanel";
import { ChecklistStatusSummary, buildChecklistRecordSummary } from "./checklists/ChecklistStatusSummary";
import { ShootBriefingBody } from "./ShootBriefing";
import { CentralJobDetailPanel } from "./jobIntake/CentralJobDetailPanel";
import { DateChangeRequestPanel } from "./schedule/DateChangeRequestPanel";
import { canApproveOperationalExceptions } from "../permissions";
import { buildShootBriefing } from "../services/shootHotSheet";
import { confirmShootReadyToShoot } from "../services/shootApi";
import { getShootPostProductionSubstageLabel, getShootStatusHomeTone, getShootStatusLabel, normalizeShootStatus } from "../shootLifecycle";
import type { AlertRecord, SessionUser, ShootDetail, ShootSummary, ShootShiftRecord, ShootStatusEventRecord } from "../types";
import type { ChecklistInstanceDetail } from "../checklistTypes";
import type { CentralJobIntakeResponse } from "../jobIntakeTypes";

type Props = {
  token: string;
  currentUser?: SessionUser | null;
  shootSummary: ShootSummary | null;
  shoot: ShootDetail | null;
  loading?: boolean;
  error?: string;
  queueLabel?: string | null;
  nextAction?: string | null;
  onUpdated?: (shoot: ShootDetail) => Promise<void> | void;
  onClose: () => void;
};

export function ShootDetailDrawer({
  token,
  currentUser = null,
  shootSummary,
  shoot,
  loading = false,
  error = "",
  queueLabel,
  nextAction,
  onUpdated,
  onClose
}: Props) {
  const summary = shoot ?? shootSummary;
  const [readyExceptionReason, setReadyExceptionReason] = useState("");
  const [readyNote, setReadyNote] = useState("");
  const [readySubmitting, setReadySubmitting] = useState(false);
  const [readyError, setReadyError] = useState("");
  const [centralJob, setCentralJob] = useState<CentralJobIntakeResponse | null>(null);
  const [centralJobError, setCentralJobError] = useState("");
  const [checklistInstances, setChecklistInstances] = useState<ChecklistInstanceDetail[]>([]);
  const [preferredChecklistInstanceId, setPreferredChecklistInstanceId] = useState<string | null>(null);
  const [checklistSectionOpen, setChecklistSectionOpen] = useState(false);
  const readyToShootState = shoot?.ready_to_shoot ?? null;
  const checklistSummary = buildChecklistRecordSummary(checklistInstances);

  useEffect(() => {
    setReadyExceptionReason("");
    setReadyNote("");
    setReadyError("");
    setReadySubmitting(false);
    setChecklistInstances([]);
    setPreferredChecklistInstanceId(null);
    setChecklistSectionOpen(false);
  }, [summary?.id, readyToShootState?.already_confirmed]);

  useEffect(() => {
    if (!summary?.id) {
      setCentralJob(null);
      setCentralJobError("");
      return;
    }
    let cancelled = false;
    setCentralJob(null);
    setCentralJobError("");
    void getCentralJob(token, summary.id)
      .then((response) => {
        if (!cancelled) {
          setCentralJob(response);
        }
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        if (loadError instanceof ApiClientError && loadError.status === 404) {
          setCentralJob(null);
          return;
        }
        setCentralJobError(loadError instanceof Error ? loadError.message : "We couldn't load central job detail right now.");
      });
    return () => {
      cancelled = true;
    };
  }, [summary?.id, token]);

  if (!summary) {
    return null;
  }

  const briefing = buildShootBriefing(summary, shoot);
  const openAlerts = (shoot?.alerts ?? []).filter((alert: AlertRecord) => alert.status !== "resolved");
  const attendanceExceptions = shoot?.attendance_exceptions ?? [];
  const statusEvents = shoot?.status_events ?? [];
  const publishedShifts = shoot?.shifts ?? [];
  const primaryContact = briefing.contacts[0]?.name ?? summary.primary_contact_name ?? "Contact pending";
  const additionalContactRecords = summary.additional_contacts ?? [];
  const additionalContacts = additionalContactRecords.map((contact) => contact.full_name).join(", ") || summary.secondary_contact_name || "";
  const syncLabel = getSyncLabel(summary);
  const staffingLabel = buildStaffingLabel(summary);
  const normalizedStatus = summary.normalized_status ?? normalizeShootStatus(summary.status);
  const statusDisplay = summary.status_display ?? getShootStatusLabel(normalizedStatus ?? summary.status);
  const readinessSummary = summary.readiness_summary ?? buildReadinessLabel(summary.ready_eligible, briefing.alertIndicators.length, openAlerts.length, attendanceExceptions.length, summary.agreement_warning_summary);
  const operationalFlags = summary.operational_flags ?? [];

  async function handleReadyToShootConfirm(useException: boolean) {
    if (!shoot) {
      return;
    }
    if (useException && !readyExceptionReason.trim()) {
      setReadyError("Add an exception reason before confirming Ready to Shoot with an exception.");
      return;
    }
    setReadySubmitting(true);
    setReadyError("");
    try {
      const location = await getBrowserLocation();
      const updatedShoot = await confirmShootReadyToShoot(token, shoot.id, {
        exception_reason: useException ? readyExceptionReason.trim() : null,
        note: readyNote.trim() || null,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        accuracy_meters: location?.accuracy ?? null,
        device_context: {
          client: "admin_web",
          surface: "shoot_detail_drawer"
        }
      });
      setReadyExceptionReason("");
      setReadyNote("");
      if (onUpdated) {
        await onUpdated(updatedShoot);
      }
    } catch (readyToShootError) {
      setReadyError(readyToShootError instanceof Error ? readyToShootError.message : "We couldn't save Ready to Shoot right now.");
    } finally {
      setReadySubmitting(false);
    }
  }

  return (
    <div className="drawer-overlay home-detail-overlay home-detail-overlay--workspace" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="panel home-detail-overlay__content home-detail-overlay__content--workspace" onClick={(event) => event.stopPropagation()}>
        <div className="home-shoot-workspace__header">
          <div>
            <div className="eyebrow">Shoot Workspace</div>
            <h3>{briefing.title}</h3>
            <p className="section-subtitle">
              {briefing.shootCode} | {briefing.locationLine} | {briefing.timeRange}
            </p>
          </div>
          <button className="secondary-button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="home-shoot-workspace__chips">
          <span className={`shoot-type-chip shoot-type-chip--${briefing.category}`}>{briefing.categoryLabel}</span>
          {queueLabel ? <span className="home-tone-chip home-tone-chip--info">{queueLabel}</span> : null}
          {statusDisplay ? <span className={`home-tone-chip home-tone-chip--${getShootStatusHomeTone(normalizedStatus ?? summary.status)}`}>{statusDisplay}</span> : null}
          {summary.post_production_substage ? <span className="meta-pill">{getShootPostProductionSubstageLabel(summary.post_production_substage)}</span> : null}
          {briefing.priorityLabel ? <span className={`home-tone-chip home-tone-chip--${mapPriorityTone(summary.priority_label ?? summary.importance_tier ?? null)}`}>{briefing.priorityLabel}</span> : null}
          {summary.importance_override_applied && summary.importance_override_reason ? (
            <span className="meta-pill" title={summary.importance_override_reason}>
              Override active
            </span>
          ) : null}
          {briefing.profitabilityDisplay ? <span className="meta-pill">{briefing.profitabilityDisplay}</span> : null}
          <span className="meta-pill">{syncLabel}</span>
        </div>

        {error ? <div className="error-banner">{error}</div> : null}
        {centralJobError ? <div className="error-banner">{centralJobError}</div> : null}
        {loading ? <div className="live-banner">Loading the latest shoot detail...</div> : null}

        <div className="home-detail-overlay__scroll">
          <div className="home-detail-content home-shoot-workspace">
            <div className="home-stat-strip home-stat-strip--workspace">
              <div>
                <span>Status</span>
                <strong>{statusDisplay || queueLabel || "In progress"}</strong>
              </div>
              <div>
                <span>Staffing</span>
                <strong>{staffingLabel}</strong>
              </div>
              <div>
                <span>Readiness</span>
                <strong>{readinessSummary}</strong>
              </div>
              <div>
                <span>Primary Contact</span>
                <strong>{primaryContact}</strong>
              </div>
              <div>
                <span>Sync State</span>
                <strong>{syncLabel}</strong>
              </div>
              <div>
                <span>Next Action</span>
                <strong>{buildNextActionLabel(nextAction, queueLabel, briefing.statusNote, summary)}</strong>
              </div>
              <div>
                <span>Checklists</span>
                <strong>{checklistSummary.total_count ? `${checklistSummary.open_count} open | ${checklistSummary.overdue_count} overdue` : "None active"}</strong>
              </div>
            </div>

            <div className="home-detail-callout home-shoot-workspace__callout">
              <strong>{buildWorkspaceHeadline(summary, queueLabel)}</strong>
              <div className="muted">{nextAction ?? briefing.statusNote}</div>
            </div>

            {currentUser ? (
              <ChecklistStatusSummary
                instances={checklistInstances}
                title="Shoot Checklist Status"
                summary="Checklist blocks, overdue proof, and approvals tied directly to this shoot."
                onOpenBlockingChecklist={(instanceId) => {
                  setPreferredChecklistInstanceId(instanceId);
                  setChecklistSectionOpen(true);
                }}
              />
            ) : null}

            {centralJob ? <CentralJobDetailPanel intake={centralJob} /> : null}

            {summary?.id && summary?.shoot_date ? (
              <DateChangeRequestPanel
                token={token}
                shootId={summary.id}
                originalDate={summary.shoot_date}
                canApprove={currentUser ? canApproveOperationalExceptions(currentUser, null) : false}
              />
            ) : null}

            <OperationalDetailSection
              title="Shoot Summary"
              summary="The Shoot record is the operational hub for linked client, contact, location, timing, and future follow-through context."
              defaultOpen
            >
              <div className="detail-two-column">
                <div className="dashboard-summary-list">
                  <div className="dashboard-summary-row">
                    <span className="muted">Shoot</span>
                    <strong>{briefing.title}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Shoot Code</span>
                    <strong>{briefing.shootCode}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Shoot Type</span>
                    <strong>{briefing.categoryLabel}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Subtype</span>
                    <strong>{summary.shoot_subtype ?? "No subtype"}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Status</span>
                    <strong>{statusDisplay || queueLabel || "In progress"}</strong>
                  </div>
                </div>
                <div className="dashboard-summary-list">
                  <div className="dashboard-summary-row">
                    <span className="muted">Organization</span>
                    <strong>{summary.organization_display_name ?? "Organization pending"}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Location</span>
                    <strong>{summary.location_name ?? "Location pending"}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Primary Contact</span>
                    <strong>{primaryContact}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Staffing</span>
                    <strong>{staffingLabel}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Sync state</span>
                    <strong>{syncLabel}</strong>
                  </div>
                </div>
              </div>
            </OperationalDetailSection>

            <OperationalDetailSection
              title="Organization"
              summary="The canonical client/account record stays attached to the Shoot instead of being retyped in each workflow."
            >
              <div className="request-card">
                <strong>{summary.organization_display_name ?? "Organization pending"}</strong>
                <div className="muted">
                  {summary.organization_account_type ? humanizeLabel(summary.organization_account_type) : "Organization type pending"}
                </div>
                <div className="muted">
                  Contracts, resources, and future account history all hang off this linked Organization record.
                </div>
              </div>
            </OperationalDetailSection>

            <OperationalDetailSection
              title="Location"
              summary="The linked Location record carries the map-ready address and recurring operational place context."
            >
              <div className="request-card">
                <strong>{summary.location_name ?? "Location pending"}</strong>
                <div className="muted">{briefing.fullAddress ?? summary.location_address ?? "Address pending"}</div>
                <div className="request-card__actions">
                  {briefing.mapsUrl ? (
                    <a className="secondary-button" href={briefing.mapsUrl} target="_blank" rel="noreferrer">
                      Open in Maps
                    </a>
                  ) : (
                    <span className="meta-pill">Maps link pending</span>
                  )}
                </div>
              </div>
            </OperationalDetailSection>

            <OperationalDetailSection
              title="Historical Context"
              summary="Last-time-here context, repeat pattern signals, setup visuals, and open carry-forward items stay visible at the decision point."
              defaultOpen={Boolean(shoot?.location_intelligence?.historical_context)}
            >
              <HistoricalContextPanel context={shoot?.location_intelligence?.historical_context ?? null} defaultExpanded />
            </OperationalDetailSection>

            <OperationalDetailSection
              title="Primary Contact"
              summary="Exactly one primary Contact stays attached to the Shoot for day-of communication."
              defaultOpen
            >
              <div className="request-card">
                <strong>{primaryContact}</strong>
                <div className="muted">
                  {[summary.primary_contact_title, summary.primary_contact_phone, summary.primary_contact_email].filter(Boolean).join(" | ") ||
                    "No additional contact details are saved on this Shoot yet."}
                </div>
              </div>
            </OperationalDetailSection>

            <OperationalDetailSection
              title="Additional Contacts"
              summary="Secondary Contacts support backup coordination, office escalation, and venue access without muddying the primary owner."
              defaultOpen={false}
            >
              {additionalContactRecords.length ? (
                <div className="dashboard-stack">
                  {additionalContactRecords.map((contact) => (
                    <div key={contact.id} className="request-card">
                      <strong>{contact.full_name}</strong>
                      <div className="muted">{[contact.title, contact.phone, contact.email].filter(Boolean).join(" | ") || "Linked Contact record"}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state empty-state--panel">No additional Contacts are linked to this Shoot right now.</div>
              )}
            </OperationalDetailSection>

            <OperationalDetailSection
              title="Timing"
              summary="The Shoot timeline stays explicit so staffing, labor, and later automations can attach to the same record."
            >
              <div className="detail-two-column">
                <div className="dashboard-summary-list">
                  <div className="dashboard-summary-row">
                    <span className="muted">Date</span>
                    <strong>{summary.shoot_date ?? "Date pending"}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Show Time</span>
                    <strong>{briefing.arrivalLabel}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Shoot Start</span>
                    <strong>{briefing.shootLabel}</strong>
                  </div>
                </div>
                <div className="dashboard-summary-list">
                  <div className="dashboard-summary-row">
                    <span className="muted">Estimated End</span>
                    <strong>{formatTimeValue(summary.end_time_est)}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Time Window</span>
                    <strong>{briefing.timeRange}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Lead</span>
                    <strong>{briefing.leadName ?? "Lead pending"}</strong>
                  </div>
                </div>
              </div>
            </OperationalDetailSection>

            {currentUser ? (
              <OperationalDetailSection
              title="Workflow Checklists"
              summary="Readiness, handoff proof, approvals, and hard blocks live here on the same Shoot record."
              defaultOpen={checklistSectionOpen || checklistSummary.blocked_count > 0 || checklistSummary.overdue_count > 0}
              badge={checklistSummary.total_count ? `${checklistSummary.open_count} open` : null}
            >
                <ChecklistRuntimePanel
                  token={token}
                  currentUser={currentUser}
                  scopeType="shoot"
                  scopeId={summary.id}
                  departmentType={summary.shoot_category === "sports" ? "sports" : summary.shoot_category === "schools" ? "schools" : null}
                  allowEdit
                  preferredInstanceId={preferredChecklistInstanceId}
                  onInstancesChange={setChecklistInstances}
                />
              </OperationalDetailSection>
            ) : null}

            <OperationalDetailSection
              title="Operational Lifecycle"
              summary="One primary status carries the lifecycle, while readiness checks and operational flags carry the issues that still need follow-through."
              defaultOpen
            >
              <div className="detail-two-column">
                <div className="dashboard-summary-list">
                  <div className="dashboard-summary-row">
                    <span className="muted">Primary Status</span>
                    <strong>{statusDisplay}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Ready Eligible</span>
                    <strong>{summary.ready_eligible ? "Yes" : "No"}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Readiness</span>
                    <strong>{readinessSummary}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Post-Production Stage</span>
                    <strong>
                      {summary.post_production_substage
                        ? getShootPostProductionSubstageLabel(summary.post_production_substage)
                        : "Not in post-production"}
                    </strong>
                  </div>
                  {summary.status_reason ? (
                    <div className="dashboard-summary-row">
                      <span className="muted">Status Reason</span>
                      <strong>{summary.status_reason}</strong>
                    </div>
                  ) : null}
                </div>
                <div className="dashboard-summary-list">
                  <div className="dashboard-summary-row">
                    <span className="muted">Flags</span>
                    <strong>{operationalFlags.length ? `${operationalFlags.length} active` : "No active flags"}</strong>
                  </div>
                  <div className="leadership-shoot-workspace__flag-strip">
                    {operationalFlags.length ? (
                      operationalFlags.map((flag) => (
                        <span
                          key={flag.code}
                          className={`ops-preview-flag ops-preview-flag--${
                            flag.tone === "critical" ? "critical" : flag.tone === "warning" ? "warning" : "neutral"
                          }`}
                        >
                          {flag.label}
                        </span>
                      ))
                    ) : (
                      <span className="ops-preview-flag ops-preview-flag--neutral">No operational flags on this shoot</span>
                    )}
                  </div>
                </div>
              </div>

              {summary.readiness_requirements?.length ? (
                <div className="dashboard-stack">
                  {summary.readiness_requirements.map((requirement) => (
                    <div key={requirement.key} className="request-card">
                      <strong>{requirement.label}</strong>
                      <div className="muted">{requirement.detail ?? (requirement.complete ? "Complete" : "Still needs attention")}</div>
                      <div className="request-card__actions">
                        <span className={`meta-pill${requirement.complete ? "" : " meta-pill--warning"}`}>
                          {requirement.complete ? "Complete" : "Open"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state empty-state--panel">Readiness requirements will appear here once the shoot lifecycle check has been evaluated.</div>
              )}
            </OperationalDetailSection>

            <OperationalDetailSection
              title="Ready to Shoot"
              summary="Secondary lead confirmation for on-site readiness. This does not change the primary shoot status."
              defaultOpen={Boolean(readyToShootState)}
            >
              {readyToShootState ? (
                <div className="dashboard-stack">
                  <div className="detail-two-column">
                    <div className="dashboard-summary-list">
                      <div className="dashboard-summary-row">
                        <span className="muted">State</span>
                        <strong>{getReadyToShootHeadline(readyToShootState)}</strong>
                      </div>
                      <div className="dashboard-summary-row">
                        <span className="muted">Confirmed By</span>
                        <strong>
                          {readyToShootState.latest_confirmation?.confirmed_by_name ??
                            readyToShootState.lead_confirmed_ready_by_name ??
                            "Not confirmed yet"}
                        </strong>
                      </div>
                      <div className="dashboard-summary-row">
                        <span className="muted">Confirmed At</span>
                        <strong>{formatDetailTimestamp(readyToShootState.latest_confirmation?.confirmed_at ?? readyToShootState.lead_confirmed_ready_at)}</strong>
                      </div>
                    </div>
                    <div className="dashboard-summary-list">
                      <div className="dashboard-summary-row">
                        <span className="muted">Window</span>
                        <strong>{readyToShootState.window.opens_at ? `${formatDetailTimestamp(readyToShootState.window.opens_at)} to ${formatTimeValue(readyToShootState.window.closes_at)}` : "Waiting for today's setup window"}</strong>
                      </div>
                      <div className="dashboard-summary-row">
                        <span className="muted">Photographers Present</span>
                        <strong>
                          {readyToShootState.latest_confirmation?.all_assigned_photographers_present
                            ? "All accounted for"
                            : readyToShootState.participants.filter((participant) => participant.is_photographer_role && participant.accounted_for).length +
                              "/" +
                              Math.max(
                                readyToShootState.participants.filter((participant) => participant.is_photographer_role).length,
                                readyToShootState.participants.filter((participant) => participant.is_photographer_role && participant.accounted_for).length
                              )}
                        </strong>
                      </div>
                      <div className="dashboard-summary-row">
                        <span className="muted">Exception</span>
                        <strong>{readyToShootState.lead_confirmed_ready_exception_flag ? "Confirmed with exception" : "Clean or pending"}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="leadership-shoot-workspace__flag-strip">
                    <span className={`ops-preview-flag ops-preview-flag--${mapReadyToShootFlagTone(readyToShootState.ready_to_shoot_tone)}`}>
                      {getReadyToShootHeadline(readyToShootState)}
                    </span>
                    {readyToShootState.ready_to_shoot_label &&
                    readyToShootState.ready_to_shoot_label !== getReadyToShootHeadline(readyToShootState) ? (
                      <span className={`ops-preview-flag ops-preview-flag--${mapReadyToShootFlagTone(readyToShootState.ready_to_shoot_tone)}`}>
                        {readyToShootState.ready_to_shoot_label}
                      </span>
                    ) : null}
                    {!readyToShootState.actor_is_authorized ? (
                      <span className="ops-preview-flag ops-preview-flag--neutral">Assigned lead only</span>
                    ) : null}
                    {readyToShootState.actor_is_authorized && !readyToShootState.actor_on_site ? (
                      <span className="ops-preview-flag ops-preview-flag--warning">Lead must be on site</span>
                    ) : null}
                  </div>

                  {readyToShootState.latest_confirmation?.exception_reason ? (
                    <div className="request-card">
                      <strong>Exception reason</strong>
                      <div className="muted">{readyToShootState.latest_confirmation.exception_reason}</div>
                      {readyToShootState.latest_confirmation.note ? <div className="muted">{readyToShootState.latest_confirmation.note}</div> : null}
                    </div>
                  ) : null}

                  <div className="dashboard-stack">
                    {readyToShootState.checks.map((check) => (
                      <div key={check.key} className="request-card">
                        <strong>{check.label}</strong>
                        <div className="muted">{check.detail}</div>
                        <div className="request-card__actions">
                          <span className={`meta-pill${check.passed ? "" : " meta-pill--warning"}`}>{check.passed ? "Ready" : "Needs attention"}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="dashboard-stack">
                    {readyToShootState.participants.map((participant) => (
                      <div key={participant.shift_id} className="request-card">
                        <strong>{participant.name}</strong>
                        <div className="muted">
                          {participant.role_label}
                          {participant.is_lead_assignment ? " | Lead assignment" : ""}
                        </div>
                        <div className="request-card__actions">
                          <span className={`meta-pill${participant.accounted_for ? "" : " meta-pill--warning"}`}>{participant.accounted_label}</span>
                          {participant.latest_punch_at ? <span className="meta-pill">{formatTimeValue(participant.latest_punch_at)}</span> : null}
                        </div>
                      </div>
                    ))}
                    {!readyToShootState.participants.length ? (
                      <div className="empty-state empty-state--panel">Assignment presence will appear here once staffing is attached to this shoot.</div>
                    ) : null}
                  </div>

                  {!readyToShootState.already_confirmed && readyToShootState.show_action ? (
                    <div className="dashboard-stack">
                      {readyError ? <div className="error-banner">{readyError}</div> : null}
                      <div className="request-card">
                        <strong>Lead confirmation action</strong>
                        <div className="muted">
                          {readyToShootState.can_confirm_clean
                            ? "All clean checks passed. The lead can confirm that the shoot is ready to begin."
                            : readyToShootState.can_confirm_with_exception
                              ? "Clean confirmation is blocked. A designated manager-level lead can confirm with exception and leave the staffing issues visible."
                              : "Fix the open issues below before this shoot can be cleanly confirmed on site."}
                        </div>
                        <div className="dashboard-stack">
                          <label className="filter-field filter-field--wide">
                            <span>Optional note</span>
                            <textarea value={readyNote} onChange={(event) => setReadyNote(event.target.value)} rows={3} placeholder="Add day-of setup context if it helps the manager view." />
                          </label>
                          {readyToShootState.can_confirm_with_exception ? (
                            <label className="filter-field filter-field--wide">
                              <span>Exception reason</span>
                              <textarea
                                value={readyExceptionReason}
                                onChange={(event) => setReadyExceptionReason(event.target.value)}
                                rows={3}
                                placeholder="Explain what is still missing and why the team is starting anyway."
                              />
                            </label>
                          ) : null}
                        </div>
                        <div className="request-card__actions">
                          {readyToShootState.can_confirm_clean ? (
                            <button className="primary-button" disabled={readySubmitting} onClick={() => void handleReadyToShootConfirm(false)}>
                              {readySubmitting ? "Saving..." : "Ready to Shoot"}
                            </button>
                          ) : null}
                          {readyToShootState.can_confirm_with_exception ? (
                            <button className="secondary-button" disabled={readySubmitting} onClick={() => void handleReadyToShootConfirm(true)}>
                              {readySubmitting ? "Saving..." : "Confirm With Exception"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : readyToShootState.already_confirmed ? null : (
                    <div className="request-card">
                      <strong>Lead confirmation is not available yet</strong>
                      <div className="muted">{buildReadyToShootUnavailableMessage(readyToShootState)}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-state empty-state--panel">Ready to Shoot will appear here once this shoot has the on-site confirmation workflow available.</div>
              )}
            </OperationalDetailSection>

            <OperationalDetailSection
              title="Readiness Watch"
              summary="Operational blockers, warnings, and review work that still need attention."
              defaultOpen={Boolean(briefing.alertIndicators.length || openAlerts.length || attendanceExceptions.length)}
            >
              <div className="dashboard-stack">
                {briefing.alertIndicators.map((indicator) => (
                  <div key={`${indicator.kind}-${indicator.label}`} className="request-card">
                    <strong>{indicator.label}</strong>
                    <div className="muted">{indicator.detail}</div>
                  </div>
                ))}
                {summary.agreement_warning_summary ? (
                  <div className="request-card">
                    <strong>Agreement Coverage</strong>
                    <div className="muted">{summary.agreement_warning_summary}</div>
                  </div>
                ) : null}
                {openAlerts.map((alert) => (
                  <div key={alert.id} className="request-card">
                    <strong>{humanizeLabel(alert.alert_type)}</strong>
                    <div className="muted">{alert.message}</div>
                  </div>
                ))}
                {attendanceExceptions.map((exception) => (
                  <div key={exception.id} className="request-card">
                    <strong>{humanizeLabel(exception.exception_type)}</strong>
                    <div className="muted">{exception.notes || exception.reason_code || "Attendance exception submitted."}</div>
                  </div>
                ))}
                {!briefing.alertIndicators.length && !openAlerts.length && !attendanceExceptions.length ? (
                  <div className="empty-state empty-state--panel">No open readiness issues are attached to this shoot right now.</div>
                ) : null}
              </div>
            </OperationalDetailSection>

            <OperationalDetailSection
              title="Briefing & Travel"
              summary="Travel notes, weather watch, and day-of briefing detail stay nearby without crowding the top of the workspace."
            >
              <ShootBriefingBody briefing={briefing} />
            </OperationalDetailSection>

            <OperationalDetailSection
              title="Operational Notes"
              summary="Structured notes stay attached to the Shoot record instead of getting buried in side channels."
              defaultOpen={false}
            >
              <div className="dashboard-summary-list">
                {summary.special_instructions ? (
                  <div className="dashboard-summary-row">
                    <span className="muted">Special Instructions</span>
                    <strong>{summary.special_instructions}</strong>
                  </div>
                ) : null}
                {summary.access_notes ? (
                  <div className="dashboard-summary-row">
                    <span className="muted">Access / Parking</span>
                    <strong>{summary.access_notes}</strong>
                  </div>
                ) : null}
                {summary.internal_notes ? (
                  <div className="dashboard-summary-row">
                    <span className="muted">Internal Notes</span>
                    <strong>{summary.internal_notes}</strong>
                  </div>
                ) : null}
                {!summary.special_instructions && !summary.access_notes && !summary.internal_notes ? (
                  <div className="empty-state empty-state--panel">No operational notes are attached to this Shoot yet.</div>
                ) : null}
              </div>
            </OperationalDetailSection>

            <OperationalDetailSection
              title="Agreement Warning"
              summary="Agreement coverage warnings stay visible on the Shoot without blocking the booking itself."
              defaultOpen={Boolean(summary.agreement_warning_summary)}
            >
              <div className="request-card">
                <strong>
                  {summary.agreement_warning_summary
                    ? humanizeAgreementSeverity(summary.agreement_warning_severity)
                    : "No active agreement warning"}
                </strong>
                <div className="muted">
                  {summary.agreement_warning_summary ??
                    "Agreement coverage is clear right now. Future Agreement lifecycle detail will continue to hang off this same Shoot workspace."}
                </div>
              </div>
            </OperationalDetailSection>

            <OperationalDetailSection
              title="Resource Library"
              summary="Prep materials, documents, historical references, and post-shoot learnings stay attached to this Shoot workspace."
              defaultOpen={false}
            >
              <ResourceLibraryPanel library={shoot?.resource_library ?? null} scopeLabel="Shoot" />
            </OperationalDetailSection>

            <OperationalDetailSection
              title="Post-Shoot Evaluation"
              summary="The submitted evaluation and closeout follow-through will live here without changing the Shoot layout again."
              defaultOpen={false}
            >
              <div className="request-card">
                <strong>Evaluation slot is reserved on this Shoot</strong>
                <div className="muted">
                  Later phases attach the submitted Post-Shoot Evaluation, reminders, and follow-up signals directly to this Shoot record.
                </div>
              </div>
            </OperationalDetailSection>

            <OperationalDetailSection
              title="Gear"
              summary="Special equipment and future Asset / Kit linkage stay attached to the Shoot instead of drifting into side notes."
              defaultOpen={false}
            >
              <div className="request-card">
                <strong>{summary.special_equipment_flag || summary.special_equipment ? "Special equipment flagged" : "No gear issues flagged"}</strong>
                <div className="muted">
                  {summary.special_equipment?.trim() ||
                    "Future Asset, Kit, Pre-Shoot Verification, and custody detail will attach here when Gear workflows are linked directly to the Shoot."}
                </div>
              </div>
            </OperationalDetailSection>

            <OperationalDetailSection
              title="Labor"
              summary="Published shifts, attendance exceptions, and later Time Session / Time Segment rollups connect here."
              defaultOpen={false}
            >
              <div className="dashboard-summary-list">
                <div className="dashboard-summary-row">
                  <span className="muted">Staffing</span>
                  <strong>{staffingLabel}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Published Shifts</span>
                  <strong>{publishedShifts.length}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Attendance Exceptions</span>
                  <strong>{attendanceExceptions.length}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Clocked In</span>
                  <strong>{Number(summary.clocked_in_employee_count ?? 0)}</strong>
                </div>
              </div>
              <div className="detail-two-column">
                <div>
                  <div className="eyebrow">Status Timeline</div>
                  <div className="timeline-list">
                    {statusEvents.map((event: ShootStatusEventRecord) => (
                      <div key={event.id} className="timeline-item">
                        <div className="timeline-dot" />
                        <div>
                          <div className="timeline-title">
                            <span className="timeline-type">{humanizeLabel(event.type)}</span>
                            <span className="muted">{new Date(event.captured_at).toLocaleTimeString()}</span>
                          </div>
                          <div className="muted">Geofence: {event.geofence_status ?? "No geofence note"}</div>
                        </div>
                      </div>
                    ))}
                    {!statusEvents.length ? <div className="empty-state">No status events have been logged yet.</div> : null}
                  </div>
                </div>
                <div>
                  <div className="eyebrow">Published Shifts</div>
                  <div className="timeline-list">
                    {publishedShifts.map((shift: ShootShiftRecord) => (
                      <div key={shift.id} className="timeline-item timeline-item--shift">
                        <div className="timeline-dot" />
                        <div>
                          <div className="timeline-title">
                            <span className="timeline-type">{shift.assigned_user_name}</span>
                            <span className="muted">
                              {new Date(shift.starts_at).toLocaleTimeString()} - {new Date(shift.ends_at).toLocaleTimeString()}
                            </span>
                          </div>
                          <div className="muted">
                            {humanizeLabel(shift.shift_kind)} | {humanizeLabel(shift.status)} |{" "}
                            {shift.segments?.map((segment) => segment.label).join(", ") || "No saved segments"}
                          </div>
                        </div>
                      </div>
                    ))}
                    {!publishedShifts.length ? <div className="empty-state">No published shifts are attached to this shoot yet.</div> : null}
                  </div>
                </div>
              </div>
            </OperationalDetailSection>

            <div className="home-detail-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  window.location.hash = "#operations/schedule";
                }}
              >
                Open Scheduling
              </button>
              {briefing.mapsUrl ? (
                <a className="secondary-button" href={briefing.mapsUrl} target="_blank" rel="noreferrer">
                  Open in Maps
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getReadyToShootHeadline(readyToShoot: NonNullable<ShootDetail["ready_to_shoot"]>) {
  if (readyToShoot.lead_confirmed_ready_exception_flag) {
    return "Ready with exception";
  }
  if (readyToShoot.already_confirmed) {
    return "Lead Confirmed Ready";
  }
  return readyToShoot.ready_to_shoot_label ?? "Awaiting lead confirmation";
}

function buildReadyToShootUnavailableMessage(readyToShoot: NonNullable<ShootDetail["ready_to_shoot"]>) {
  if (!readyToShoot.actor_is_authorized) {
    return "Only the assigned shoot lead or designated lead coverage can confirm Ready to Shoot.";
  }
  if (!readyToShoot.actor_on_site) {
    return "The confirming lead must be clocked in or otherwise marked on site before this action appears.";
  }
  if (!readyToShoot.window.shoot_is_today) {
    return "This action appears only on the active shoot day.";
  }
  if (!readyToShoot.ready_to_shoot_setup_window_active) {
    return "The setup window is not active yet.";
  }
  return readyToShoot.missing_items[0] ?? "This shoot still has open blockers before it can be confirmed.";
}

function formatDetailTimestamp(value?: string | null) {
  if (!value) {
    return "Not confirmed yet";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function mapReadyToShootFlagTone(tone?: "neutral" | "info" | "good" | "heads_up" | "action_needed" | null) {
  if (tone === "action_needed") {
    return "critical";
  }
  if (tone === "heads_up") {
    return "warning";
  }
  return "neutral";
}

async function getBrowserLocation() {
  if (!("geolocation" in navigator)) {
    return null;
  }

  return await new Promise<{ latitude: number; longitude: number; accuracy: number | null } | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy ?? null
        }),
      () => resolve(null),
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  });
}

function buildWorkspaceHeadline(shoot: ShootSummary, queueLabel?: string | null) {
  const normalizedStatus = shoot.normalized_status ?? normalizeShootStatus(shoot.status);
  if (queueLabel === "Needs Staffing") {
    return shoot.missing_lead ? "Lead coverage is still missing on this shoot." : "Staffing is still below the planned headcount.";
  }
  if (queueLabel === "Needs Review") {
    return "This shoot still has open review work before it feels clean.";
  }
  if (queueLabel === "Unscheduled") {
    return "Core timing or location detail is still incomplete here.";
  }
  if (queueLabel === "Completed / Archived") {
    return "This shoot is historical now. Use the workspace for follow-through and context.";
  }
  if (normalizedStatus === "ON_HOLD") {
    return "This shoot is on hold right now. Resume it only when the blocking issue is actually resolved.";
  }
  if (normalizedStatus === "POST_PRODUCTION") {
    return "On-site capture is done. The remaining work now lives in post-production follow-through.";
  }
  if (normalizedStatus === "COMPLETE") {
    return "All required operational and production work is marked complete on this shoot.";
  }
  return "This shoot is scheduled and ready for operational follow-through.";
}

function buildStaffingLabel(shoot: ShootSummary) {
  const assigned = Number(shoot.scheduled_employee_count ?? 0);
  const planned = Number(shoot.planned_staff_count ?? assigned);
  const leadCount = Number(shoot.lead_coverage_count ?? 0);
  const requiredLeadCount = Math.max(Number(shoot.required_lead_count ?? 0), shoot.missing_lead ? 1 : 0);
  const leadLabel = requiredLeadCount ? ` | Lead ${leadCount}/${requiredLeadCount}` : "";
  if (!planned) {
    return `${assigned} assigned${leadLabel}`;
  }
  return `${assigned}/${planned} assigned${leadLabel}`;
}

function buildReadinessLabel(
  readyEligible: boolean | undefined,
  briefingIndicatorCount: number,
  openAlertCount: number,
  attendanceExceptionCount: number,
  agreementWarningSummary?: string | null
) {
  if (readyEligible) {
    return "Ready Eligible";
  }
  if (briefingIndicatorCount || openAlertCount || attendanceExceptionCount || agreementWarningSummary) {
    return "Needs review";
  }
  return "Ready";
}

function buildNextActionLabel(nextAction?: string | null, queueLabel?: string | null, fallback?: string | null, shoot?: ShootSummary | null) {
  const normalizedStatus = shoot?.normalized_status ?? normalizeShootStatus(shoot?.status);
  if (nextAction?.trim()) {
    return nextAction;
  }
  if (queueLabel === "Needs Staffing") {
    return "Close staffing gap";
  }
  if (queueLabel === "Needs Review") {
    return "Review blockers";
  }
  if (queueLabel === "Unscheduled") {
    return "Set timing";
  }
  if (normalizedStatus === "POST_PRODUCTION") {
    return "Advance post-production follow-through";
  }
  if (normalizedStatus === "ON_HOLD") {
    return "Resolve the hold reason";
  }
  if (normalizedStatus === "COMPLETE") {
    return "Review final follow-through";
  }
  return fallback ?? "Stay on track";
}

function getSyncLabel(shoot: ShootSummary) {
  if (shoot.integration?.manual_review_required) {
    return "Manual sync review";
  }
  if (shoot.integration?.last_sync_error) {
    return "Sync error";
  }
  if (shoot.schedule_sync_required || shoot.integration?.sync_required) {
    return "Sync pending";
  }
  if (shoot.integration?.link_state === "linked") {
    return "Linked to Outlook";
  }
  return "Mission Control only";
}

function humanizeLabel(value?: string | null) {
  if (!value) {
    return "Unknown";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function mapPriorityTone(value?: ShootSummary["priority_label"] | ShootSummary["importance_tier"] | null) {
  if (value === "critical_shoot") {
    return "action_needed";
  }
  if (value === "big_shoot") {
    return "info";
  }
  if (value === "elevated" || value === "high_priority") {
    return "heads_up";
  }
  return "neutral";
}

function humanizeAgreementSeverity(value?: "clear" | "warning" | "major") {
  switch (value) {
    case "major":
      return "Major Warning";
    case "warning":
      return "Warning";
    default:
      return "Covered";
  }
}

function formatTimeValue(value?: string | null) {
  if (!value) {
    return "End pending";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
