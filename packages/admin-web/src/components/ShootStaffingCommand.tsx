import { useEffect, useMemo, useState } from "react";
import { OperationalDetailSection } from "./OperationalDetailSection";
import {
  assignShootStaffingSlot,
  getShootStaffingSnapshot,
  publishShootStaffing,
  removeShootStaffingAssignment,
  type StaffingMutationResponse
} from "../services/scheduleStaffing";
import type { ShootStaffingSlot, ShootStaffingSnapshot, StaffingCandidateOption } from "../types";

type PendingOverride =
  | {
      type: "assign";
      slotKey: string;
      assignedUserId: string;
      label: string;
      reason: string;
    }
  | {
      type: "publish";
      warnings: string[];
    }
  | {
      type: "remove";
      slotKey: string;
      label: string;
      reason: string;
    };

type Props = {
  token: string;
  shootId: string | null;
  canPublish: boolean;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onUpdated?: (snapshot: ShootStaffingSnapshot) => void;
  onClose?: () => void;
  className?: string;
  emptyStateLabel?: string;
  emptyStateSummary?: string;
};

export function ShootStaffingCommand({
  token,
  shootId,
  canPublish,
  onNotice,
  onError,
  onUpdated,
  onClose,
  className,
  emptyStateLabel = "Staffing Planner",
  emptyStateSummary = "Save or open a shoot to assign staffing slots."
}: Props) {
  const [snapshot, setSnapshot] = useState<ShootStaffingSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingSlotKey, setSavingSlotKey] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [pendingOverride, setPendingOverride] = useState<PendingOverride | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  useEffect(() => {
    if (!shootId) {
      setSnapshot(null);
      setPendingOverride(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getShootStaffingSnapshot(token, shootId)
      .then((payload) => {
        if (!cancelled) {
          setSnapshot(payload);
          setOverrideReason("");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : "We couldn't load the staffing controls.");
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
  }, [onError, shootId, token]);

  const summaryPills = useMemo(() => {
    if (!snapshot) {
      return [];
    }
    return [
      `${snapshot.shoot.assigned_staff_count}/${Math.max(snapshot.shoot.planned_staff_count, snapshot.shoot.assigned_staff_count)} ideal assigned`,
      `${snapshot.shoot.minimum_staff_count} minimum`,
      `${snapshot.shoot.lead_coverage_count}/${snapshot.shoot.required_lead_count} lead coverage`,
      `Health: ${snapshot.shoot.staffing_state_display}`,
      ...(snapshot.shoot.priority_label_display ? [snapshot.shoot.priority_label_display] : []),
      ...(snapshot.shoot.future_profitability_display ? [`Profitability: ${snapshot.shoot.future_profitability_display}`] : []),
      `Publish state: ${humanizeLabel(snapshot.shoot.publish_state)}`,
      `Sync: ${humanizeLabel(snapshot.shoot.schedule_sync_state)}`
    ];
  }, [snapshot]);

  function applyStaffingMutationResult(result: StaffingMutationResponse, successNotice: string, approvalNotice: string) {
    const nextSnapshot = "approval_required" in result ? result.snapshot : result;
    setSnapshot(nextSnapshot);
    setOverrideReason("");
    onUpdated?.(nextSnapshot);
    onNotice("approval_required" in result ? approvalNotice : successNotice);
  }

  async function handleAssign(slot: ShootStaffingSlot, option: StaffingCandidateOption, overrideConflict = false) {
    if (!shootId || !snapshot) {
      return;
    }
    setSavingSlotKey(slot.slot_key);
    setPendingOverride(null);
    try {
      const next = await assignShootStaffingSlot(token, shootId, {
        slot_key: slot.slot_key,
        assigned_user_id: option.user_id,
        override_conflict: overrideConflict,
        approval_reason: overrideConflict ? overrideReason.trim() || undefined : undefined
      });
      const nextShootCode = "approval_required" in next ? next.snapshot.shoot.shoot_code : next.shoot.shoot_code;
      applyStaffingMutationResult(
        next,
        overrideConflict
          ? `${option.name} was assigned with an override on ${nextShootCode}.`
          : `${option.name} was assigned to ${nextShootCode}.`,
        `${option.name} now needs approval before the staffing change can be applied on ${nextShootCode}.`
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "We couldn't update the staffing slot.");
    } finally {
      setSavingSlotKey("");
    }
  }

  async function handlePublish(overrideWarnings = false) {
    if (!shootId) {
      return;
    }
    setPublishing(true);
    setPendingOverride(null);
    try {
      const next = await publishShootStaffing(token, shootId, {
        override_warnings: overrideWarnings,
        approval_reason: overrideWarnings ? overrideReason.trim() || undefined : undefined
      });
      const nextShootCode = "approval_required" in next ? next.snapshot.shoot.shoot_code : next.shoot.shoot_code;
      applyStaffingMutationResult(
        next,
        overrideWarnings
          ? `${nextShootCode} was published with staffing warnings.`
          : `${nextShootCode} staffing was published.`,
        `${nextShootCode} publish is waiting on approval before staffing is released.`
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "We couldn't publish this staffing plan.");
    } finally {
      setPublishing(false);
    }
  }

  async function handleRemove(slot: ShootStaffingSlot, approvalReason?: string) {
    if (!shootId || !snapshot || !slot.assigned_shift_id) {
      return;
    }
    setSavingSlotKey(slot.slot_key);
    setPendingOverride(null);
    try {
      const next = await removeShootStaffingAssignment(token, shootId, {
        slot_key: slot.slot_key,
        approval_reason: approvalReason?.trim() || undefined
      });
      const nextShootCode = "approval_required" in next ? next.snapshot.shoot.shoot_code : next.shoot.shoot_code;
      applyStaffingMutationResult(
        next,
        `${slot.label} was removed from ${nextShootCode}.`,
        `${slot.label} now needs approval before it can be removed from ${nextShootCode}.`
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "We couldn't remove this staffing assignment.");
    } finally {
      setSavingSlotKey("");
    }
  }

  if (!shootId) {
    return (
      <section className={className}>
        <div className="drawer-empty shoot-staffing-command__empty">
          <div>
            <div className="eyebrow">{emptyStateLabel}</div>
            <h3 className="section-title">No Shoot Selected</h3>
            <p className="section-subtitle">{emptyStateSummary}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={className}>
      <div className="drawer-header">
        <div>
          <div className="eyebrow">Staffing Control</div>
          <h3>{snapshot?.shoot.shoot_code ?? "Loading"}</h3>
          <p className="section-subtitle">
            {snapshot ? `${snapshot.shoot.title} | ${formatCompactDate(snapshot.shoot.shoot_date)}` : "Loading staffing posture, lead coverage, and availability."}
          </p>
        </div>
        {onClose ? (
          <button className="secondary-button drawer-close" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>

      <div className="drawer-meta">
        {summaryPills.map((pill) => (
          <span key={pill} className="drawer-pill">
            {pill}
          </span>
        ))}
      </div>

      {loading ? <div className="empty-state empty-state--panel">Loading staffing controls.</div> : null}
      {!loading && !snapshot ? <div className="empty-state empty-state--panel">We couldn't load this staffing plan.</div> : null}
      {!loading && snapshot ? (
        <>
          {snapshot.warnings.length ? (
            <div className="staffing-warning-strip">
              {snapshot.warnings.map((warning) => (
                <span key={warning} className="ops-preview-flag ops-preview-flag--warning">
                  {warning}
                </span>
              ))}
            </div>
          ) : (
            <div className="staffing-health-strip">
              <strong>{snapshot.shoot.staffing_state_display}</strong>
              <span>{snapshot.shoot.staffing_clean_for_ready ? "Ready staffing posture is clean right now." : "Resolve blockers before treating this as clean readiness."}</span>
            </div>
          )}

          {snapshot.approval_summary.open_count > 0 ? (
            <div className="staffing-approval-banner">
              <strong>{snapshot.approval_summary.blocking_open_count > 0 ? "Protected staffing action waiting on approval." : "Open staffing approval activity."}</strong>
              <span>
                {snapshot.approval_summary.blocking_open_count} blocking open, {snapshot.approval_summary.overdue_count} overdue, {snapshot.approval_summary.escalated_count} escalated.
              </span>
              <a className="secondary-button" href="#approvals?tab=operational">
                Open Approvals
              </a>
            </div>
          ) : null}

          {pendingOverride ? (
            <div className="staffing-override-card">
              <div>
                <div className="eyebrow">Approval Required</div>
                <strong>
                  {pendingOverride.type === "assign"
                    ? `Assign ${pendingOverride.label}?`
                    : pendingOverride.type === "remove"
                      ? `Remove ${pendingOverride.label}?`
                      : `Publish ${snapshot.shoot.shoot_code} with warnings?`}
                </strong>
                <div className="muted">
                  {pendingOverride.type === "assign"
                    ? `${pendingOverride.reason} Manager-level authority and a reason are required for this override.`
                    : pendingOverride.type === "remove"
                      ? `${pendingOverride.reason} Manager-level authority and a reason are required before leaving this slot open.`
                      : `${pendingOverride.warnings.join(" ")} Manager-level authority and a reason are required before publishing with warnings.`}
                </div>
                <label className="filter-field filter-field--wide">
                  <span>Approval Reason</span>
                  <textarea
                    rows={2}
                    value={overrideReason}
                    onChange={(event) => setOverrideReason(event.target.value)}
                    placeholder="Why is this override justified?"
                  />
                </label>
              </div>
              <div className="preview-detail-panel__actions">
                <button
                  className="secondary-button"
                  onClick={() => {
                    setPendingOverride(null);
                    setOverrideReason("");
                  }}
                >
                  Cancel
                </button>
                {pendingOverride.type === "assign" ? (
                  <button
                    className="primary-button"
                    disabled={savingSlotKey === pendingOverride.slotKey || !overrideReason.trim()}
                    onClick={() => {
                      const slot = snapshot.slots.find((candidate) => candidate.slot_key === pendingOverride.slotKey);
                      const option = slot?.option_groups.flatMap((group) => group.options).find((candidate) => candidate.user_id === pendingOverride.assignedUserId);
                      if (slot && option) {
                        void handleAssign(slot, option, true);
                      }
                    }}
                  >
                    {savingSlotKey === pendingOverride.slotKey ? "Assigning..." : "Assign with Override"}
                  </button>
                ) : pendingOverride.type === "remove" ? (
                  <button
                    className="primary-button"
                    disabled={savingSlotKey === pendingOverride.slotKey || !overrideReason.trim()}
                    onClick={() => {
                      const slot = snapshot.slots.find((candidate) => candidate.slot_key === pendingOverride.slotKey);
                      if (slot) {
                        void handleRemove(slot, overrideReason);
                      }
                    }}
                  >
                    {savingSlotKey === pendingOverride.slotKey ? "Removing..." : "Remove Assignment"}
                  </button>
                ) : (
                  <button className="primary-button" disabled={publishing || !overrideReason.trim()} onClick={() => void handlePublish(true)}>
                    {publishing ? "Publishing..." : "Publish with Warning"}
                  </button>
                )}
              </div>
            </div>
          ) : null}

          {snapshot.requirements.length ? (
            <section className="drawer-section">
              <div className="section-title">Staffing Requirements</div>
              <div className="staffing-requirement-list">
                {snapshot.requirements.map((requirement) => (
                  <article key={requirement.requirement_id} className="staffing-requirement-card">
                    <div className="staffing-slot-card__head">
                      <div>
                        <strong>{requirement.label}</strong>
                        <div className="muted">
                          {requirement.source_of_creation_display} | {humanizeLabel(requirement.staffing_role)}
                        </div>
                      </div>
                      <div className="staffing-slot-card__meta">
                        <span className="ops-preview-chip ops-preview-chip--neutral">
                          Min {requirement.minimum_count}
                        </span>
                        <span className="ops-preview-chip ops-preview-chip--neutral">
                          Ideal {requirement.ideal_count}
                        </span>
                        <span className={`ops-preview-chip ops-preview-chip--${requirement.open_count > 0 ? "warning" : "success"}`}>
                          {requirement.assigned_count}/{Math.max(requirement.ideal_count, requirement.assigned_count)} filled
                        </span>
                      </div>
                    </div>
                    <div className="staffing-slot-card__meta">
                      {requirement.required_for_ready ? (
                        <span className="ops-preview-flag ops-preview-flag--critical">Required for Ready</span>
                      ) : null}
                      {requirement.lead_required ? (
                        <span className="ops-preview-flag ops-preview-flag--critical">Lead Required</span>
                      ) : requirement.lead_eligible ? (
                        <span className="ops-preview-flag ops-preview-flag--neutral">Lead Eligible</span>
                      ) : null}
                      {requirement.required_qualification_tags.map((tag) => (
                        <span key={tag} className="ops-preview-flag ops-preview-flag--neutral">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="staffing-slot-card__timing">
                      <div className="muted">
                        Timing offsets: call {formatOffset(requirement.call_offset_minutes)}, start {formatOffset(requirement.start_offset_minutes)}, end {formatOffset(requirement.end_offset_minutes)}
                      </div>
                      {requirement.location_name_override || requirement.location_address_override ? (
                        <div className="muted">
                          Override location: {requirement.location_name_override ?? requirement.location_address_override}
                        </div>
                      ) : null}
                      {requirement.notes ? <div className="muted">{requirement.notes}</div> : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className="drawer-section">
            <div className="section-title">Slot Assignments</div>
            <div className="staffing-slot-list">
              {snapshot.slots.map((slot) => {
                const currentOption =
                  slot.assigned_user_id != null
                    ? slot.option_groups.flatMap((group) => group.options).find((option) => option.user_id === slot.assigned_user_id) ?? null
                    : null;
                return (
                  <article key={slot.slot_key} className="staffing-slot-card">
                    <div className="staffing-slot-card__head">
                      <div>
                        <strong>{slot.label}</strong>
                        <div className="muted">
                          {slot.assigned_user_name
                            ? `${slot.assigned_user_name}${slot.assigned_title ? ` | ${slot.assigned_title}` : ""}`
                            : "Open slot"}
                        </div>
                      </div>
                      <div className="staffing-slot-card__meta">
                        {slot.lead_required ? (
                          <span className="ops-preview-chip ops-preview-chip--critical">Lead Required</span>
                        ) : slot.satisfies_lead_coverage ? (
                          <span className="ops-preview-chip ops-preview-chip--neutral">Lead Eligible</span>
                        ) : null}
                        <span className="ops-preview-chip ops-preview-chip--neutral">{humanizeLabel(slot.staffing_role)}</span>
                        <span className="ops-preview-chip ops-preview-chip--neutral">{humanizeLabel(slot.assignment_status)}</span>
                      </div>
                    </div>

                    <div className="staffing-slot-card__timing">
                      <div className="muted">
                        {formatTimeRange(slot.call_time ?? slot.start_time, slot.end_time)}
                        {slot.location_name ? ` | ${slot.location_name}` : ""}
                      </div>
                      <div className="muted">
                        {slot.required_for_ready ? "Counts toward readiness" : "Optional coverage"}
                        {slot.is_required_slot ? " | Minimum slot" : " | Ideal coverage"}
                        {slot.assignment_source ? ` | ${humanizeLabel(slot.assignment_source)}` : ""}
                      </div>
                    </div>

                    <label className="filter-field filter-field--wide">
                      <span>{slot.label}</span>
                      <select
                        value={slot.assigned_user_id ?? ""}
                        disabled={Boolean(savingSlotKey)}
                        onChange={(event) => {
                          const nextUserId = event.target.value;
                          if (!nextUserId || nextUserId === slot.assigned_user_id) {
                            return;
                          }
                          const option = slot.option_groups.flatMap((group) => group.options).find((candidate) => candidate.user_id === nextUserId);
                          if (!option) {
                            return;
                          }
                          if (option.requires_override) {
                            setOverrideReason("");
                            setPendingOverride({
                              type: "assign",
                              slotKey: slot.slot_key,
                              assignedUserId: option.user_id,
                              label: option.name,
                              reason: buildOverrideReason(option)
                            });
                            return;
                          }
                          void handleAssign(slot, option);
                        }}
                      >
                        <option value="">{slot.assigned_user_id ? "Reassign this slot" : "Select staff"}</option>
                        {slot.option_groups.map((group) => (
                          <optgroup key={group.key} label={group.label}>
                            {group.options.map((option) => (
                              <option key={`${group.key}-${option.user_id}`} value={option.user_id} disabled={option.disabled}>
                                {formatOptionLabel(option)}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                    </label>

                    <div className="staffing-slot-card__meta">
                      {slot.required_qualification_tags.map((tag) => (
                        <span key={tag} className="ops-preview-flag ops-preview-flag--neutral">
                          {tag}
                        </span>
                      ))}
                      {slot.warnings.map((warning) => (
                        <span key={warning} className="ops-preview-flag ops-preview-flag--warning">
                          {warning}
                        </span>
                      ))}
                      {currentOption?.short_reason && currentOption.short_reason !== "assigned" && currentOption.short_reason !== "published" ? (
                        <span className={`ops-preview-flag ops-preview-flag--${currentOption.requires_override ? "critical" : "warning"}`}>
                          {currentOption.short_reason}
                        </span>
                      ) : null}
                      {currentOption?.calendar_conflict_status && currentOption.calendar_conflict_status !== "clear" ? (
                        <span
                          className={`ops-preview-flag ops-preview-flag--${currentOption.calendar_conflict_status === "blocking" ? "critical" : "warning"}`}
                        >
                          {currentOption.calendar_conflict_status === "blocking" ? "Outlook conflict" : "Outlook warning"}
                        </span>
                      ) : null}
                    </div>

                    {currentOption ? (
                      <div className="staffing-slot-card__timing">
                        {currentOption.before_label ? <div className="muted">Before: {currentOption.before_label}</div> : null}
                        {currentOption.during_label ? <div className="muted">During: {currentOption.during_label}</div> : null}
                        {currentOption.after_label ? <div className="muted">After: {currentOption.after_label}</div> : null}
                        {currentOption.calendar_conflict_status !== "clear" ? (
                          <div className="muted">Outlook: {formatCalendarConflictHint(currentOption)}</div>
                        ) : null}
                        {slot.notes ? <div className="muted">Notes: {slot.notes}</div> : null}
                        {slot.reassignment_history?.length ? (
                          <div className="muted">
                            Last change: {humanizeLabel(slot.reassignment_history[slot.reassignment_history.length - 1]?.action ?? "updated")}{" "}
                            {formatRelativeTimestamp(slot.reassignment_history[slot.reassignment_history.length - 1]?.changed_at)}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {slot.assigned_user_id ? (
                      <div className="preview-detail-panel__actions">
                        <button
                          className="secondary-button"
                          disabled={Boolean(savingSlotKey)}
                          onClick={() => {
                            const needsReason =
                              slot.lead_required ||
                              slot.is_required_slot ||
                              slot.assignment_status === "active" ||
                              snapshot.shoot.publish_state === "published";
                            if (needsReason) {
                              setOverrideReason("");
                              setPendingOverride({
                                type: "remove",
                                slotKey: slot.slot_key,
                                label: slot.label,
                                reason: "Removing this assignment affects live coverage, minimum staffing, or a published staffing plan."
                              });
                              return;
                            }
                            void handleRemove(slot);
                          }}
                        >
                          {savingSlotKey === slot.slot_key ? "Removing..." : "Remove Assignment"}
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>

          <OperationalDetailSection
            title="Warnings and Publish State"
            summary={`${snapshot.shoot.staffing_state_display} | ${humanizeLabel(snapshot.shoot.publish_state)} | ${snapshot.warnings.length ? `${snapshot.warnings.length} issue${snapshot.warnings.length === 1 ? "" : "s"}` : "No active warnings"}`}
            defaultOpen
          >
            <div className="dashboard-summary-list">
              <div className="dashboard-summary-row">
                <span className="muted">Staffing health</span>
                <strong>{snapshot.shoot.staffing_state_display}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Missing lead</span>
                <strong>{snapshot.shoot.missing_lead ? "Yes" : "No"}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Understaffed</span>
                <strong>{snapshot.shoot.under_staffed ? "Yes" : "No"}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Open required slots</span>
                <strong>{snapshot.shoot.open_required_slot_count}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Override required</span>
                <strong>{snapshot.shoot.conflict_warning_count}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Draft shifts</span>
                <strong>{snapshot.shoot.draft_shift_count}</strong>
              </div>
              {snapshot.shoot.priority_label_display ? (
                <div className="dashboard-summary-row">
                  <span className="muted">Priority</span>
                  <strong>{snapshot.shoot.priority_label_display}</strong>
                </div>
              ) : null}
              {snapshot.shoot.future_profitability_display ? (
                <div className="dashboard-summary-row">
                  <span className="muted">Profitability</span>
                  <strong>{snapshot.shoot.future_profitability_display}</strong>
                </div>
              ) : null}
            </div>
            {snapshot.shoot.staffing_hard_blockers.length ? (
              <div className="staffing-warning-strip">
                {snapshot.shoot.staffing_hard_blockers.map((warning) => (
                  <span key={warning} className="ops-preview-flag ops-preview-flag--critical">
                    {warning}
                  </span>
                ))}
              </div>
            ) : null}
            {snapshot.shoot.priority_reasons?.length ? (
              <div className="staffing-warning-strip">
                {snapshot.shoot.priority_reasons.map((reason) => (
                  <span key={reason.label} className="ops-preview-flag ops-preview-flag--neutral" title={reason.detail}>
                    {reason.label}
                  </span>
                ))}
              </div>
            ) : null}
          </OperationalDetailSection>

          <OperationalDetailSection
            title="Timing and Sync"
            summary={`${formatTimeRange(snapshot.shoot.arrival_time ?? snapshot.shoot.start_time, snapshot.shoot.end_time_est)} | ${snapshot.shoot.location_name ?? snapshot.shoot.location_address ?? "Location pending"}`}
          >
            <div className="dashboard-summary-list">
              <div className="dashboard-summary-row">
                <span className="muted">Arrival</span>
                <strong>{formatTime(snapshot.shoot.arrival_time)}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Shoot</span>
                <strong>{formatTime(snapshot.shoot.start_time)}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Teardown</span>
                <strong>{formatTime(snapshot.shoot.end_time_est)}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Sync state</span>
                <strong>{humanizeLabel(snapshot.shoot.schedule_sync_state)}</strong>
              </div>
            </div>
          </OperationalDetailSection>

          {snapshot.shoot.draft_shift_count > 0 ? (
            <div className="staffing-draft-banner" role="status">
              {!snapshot.shoot.missing_lead && !snapshot.shoot.under_staffed
                ? "Draft staffing complete — publish to notify staff and clear the active staffing alert."
                : "Assigned in draft — publish to notify staff. Published staffing is required before this issue is considered operationally resolved."}
            </div>
          ) : null}

          {canPublish || onClose ? (
            <div className="preview-detail-panel__actions">
              {onClose ? (
                <button className="secondary-button" onClick={onClose}>
                  Done
                </button>
              ) : null}
              {canPublish ? (
                <button
                  className="primary-button"
                  disabled={publishing}
                  onClick={() => {
                    if (
                      snapshot.shoot.staffing_hard_blockers.length > 0 ||
                      snapshot.shoot.staffing_warnings.length > 0 ||
                      snapshot.shoot.over_staffed ||
                      snapshot.shoot.conflict_warning_count > 0
                    ) {
                      setOverrideReason("");
                      setPendingOverride({ type: "publish", warnings: snapshot.warnings });
                      return;
                    }
                    void handlePublish(false);
                  }}
                >
                  {publishing ? "Publishing..." : snapshot.shoot.publish_state === "published" ? "Republish Staffing" : "Publish Staffing"}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function formatOptionLabel(option: StaffingCandidateOption) {
  const parts = [option.name, option.title, option.status];
  if (option.short_reason) {
    parts.push(option.short_reason);
  }
  if (option.calendar_conflict_status === "blocking") {
    parts.push("Outlook conflict");
  } else if (option.calendar_conflict_status === "warning") {
    parts.push("Outlook warning");
  }
  return parts.filter(Boolean).join(" | ");
}

function buildOverrideReason(option: StaffingCandidateOption) {
  const conflictHint = formatCalendarConflictHint(option);
  if (option.short_reason && conflictHint) {
    return `${option.name} carries a warning: ${option.short_reason}. ${conflictHint}`;
  }
  if (option.short_reason) {
    return `${option.name} carries a warning: ${option.short_reason}.`;
  }
  if (conflictHint) {
    return `${option.name} needs an override. ${conflictHint}`;
  }
  return `${option.name} needs an override.`;
}

function formatCalendarConflictHint(option: StaffingCandidateOption) {
  if (option.calendar_conflict_status === "clear") {
    return "";
  }
  const detail = option.calendar_conflict_detail ?? {};
  const title =
    typeof detail.busy_title === "string" && detail.busy_title.trim()
      ? detail.busy_title.trim()
      : typeof detail.title === "string" && detail.title.trim()
        ? detail.title.trim()
        : null;
  const kind =
    typeof detail.source === "string" && detail.source.trim()
      ? detail.source.trim().replace(/_/g, " ")
      : typeof detail.kind === "string" && detail.kind.trim()
        ? detail.kind.trim().replace(/_/g, " ")
        : null;
  const parts = [
    option.calendar_conflict_status === "blocking"
      ? "This overlaps Outlook busy time or a required travel buffer."
      : "This is close to Outlook busy time or a travel buffer.",
    title ? `Event: ${title}.` : null,
    kind ? `Reason: ${kind}.` : null
  ];
  return parts.filter(Boolean).join(" ");
}

function humanizeLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatOffset(minutes: number) {
  if (minutes === 0) {
    return "on time";
  }
  const absoluteMinutes = Math.abs(minutes);
  return minutes > 0 ? `+${absoluteMinutes}m` : `-${absoluteMinutes}m`;
}

function formatTimeRange(start?: string | null, end?: string | null) {
  const startLabel = formatTime(start);
  const endLabel = formatTime(end);
  return startLabel && endLabel ? `${startLabel} - ${endLabel}` : startLabel || endLabel || "Time pending";
}

function formatTime(value?: string | null) {
  if (!value) {
    return "Pending";
  }
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatCompactDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function formatRelativeTimestamp(value?: string | null) {
  if (!value) {
    return "recently";
  }
  const diffMinutes = Math.max(Math.round((Date.now() - new Date(value).getTime()) / 60000), 0);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}
