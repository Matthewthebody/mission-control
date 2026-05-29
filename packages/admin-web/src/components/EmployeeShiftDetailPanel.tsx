import { useEffect, useMemo, useState } from "react";
import { OperationalDetailSection } from "./OperationalDetailSection";
import { ResourceLibraryPanel } from "./ResourceLibraryPanel";
import { fileToDataUrl, uploadShootLocationPhoto } from "../services/locationApi";
import { confirmShootReadyToShoot } from "../services/shootApi";
import { getBrowserLocation } from "../services/browserLocation";
import {
  acknowledgeEmployeeEventNotes,
  cancelEmployeeTrade,
  requestEmployeeEventTrade,
  submitEmployeeEventExceptionNote,
  submitEmployeeEventMissedPunchRequest,
  submitEmployeeEventPostShootEvaluation,
  submitEmployeeEventRunningLateNotice,
  type EmployeeEventDetailResponse,
  type EmployeeShiftDetailResponse
} from "../services/employeeExperience";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  detail: EmployeeEventDetailResponse;
  onUpdated: () => Promise<void> | void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

const EXCEPTION_REASON_OPTIONS = [
  { value: "other", label: "General note" },
  { value: "traffic", label: "Traffic" },
  { value: "equipment_issue", label: "Equipment issue" },
  { value: "gps_issue", label: "GPS issue" },
  { value: "outside_geofence", label: "Outside geofence" }
];

const CLOSEOUT_OUTCOME_OPTIONS = [
  { value: "smooth", label: "Smooth" },
  { value: "minor_issues", label: "Minor Issues" },
  { value: "major_issues", label: "Major Issues" },
  { value: "needs_leadership_review", label: "Needs Leadership Review" }
] as const;

const STAFFING_FIT_OPTIONS = [
  { value: "understaffed", label: "Understaffed" },
  { value: "right_sized", label: "Right Sized" },
  { value: "overstaffed", label: "Overstaffed" }
] as const;

const SETUP_DIFFICULTY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" }
] as const;

const READINESS_OPTIONS = [
  { value: "ready", label: "Ready" },
  { value: "minor_friction", label: "Minor Friction" },
  { value: "major_friction", label: "Major Friction" }
] as const;

const ISSUE_STATE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "minor", label: "Minor" },
  { value: "major", label: "Major" }
] as const;

const ISSUE_CATEGORY_OPTIONS = [
  { value: "staffing", label: "Staffing" },
  { value: "attendance_no_show", label: "Attendance / No-Show" },
  { value: "setup_room_problem", label: "Setup / Room Problem" },
  { value: "parking_load_in", label: "Parking / Load-In" },
  { value: "school_readiness", label: "School Readiness" },
  { value: "data_roster", label: "Data / Roster" },
  { value: "equipment_technical", label: "Equipment / Technical" },
  { value: "lighting_environment", label: "Lighting / Environment" },
  { value: "line_flow_traffic", label: "Line Flow / Traffic" },
  { value: "student_parent_flow", label: "Student or Parent Flow" },
  { value: "communication_contact_issue", label: "Communication / Contact Issue" },
  { value: "special_product_deliverable_issue", label: "Special Product / Deliverable Issue" },
  { value: "other", label: "Other" }
] as const;

const SETUP_PHOTO_CATEGORY_OPTIONS = [
  { value: "arrival_entrance", label: "Arrival / Entrance" },
  { value: "parking_load_in", label: "Parking / Load-In" },
  { value: "check_in_flow_area", label: "Check-In / Traffic Flow" },
  { value: "room_wide_shot", label: "Room Wide Shot" },
  { value: "final_camera_background_setup", label: "Final Setup View" },
  { value: "power_staging_storage", label: "Power / Staging" },
  { value: "special_constraint_watch_out", label: "Constraint / Watch-Out" }
] as const;

const MILEAGE_VEHICLE_OPTIONS = [
  { value: "personal_vehicle", label: "Personal vehicle" },
  { value: "carpool_passenger", label: "Carpool passenger" },
  { value: "company_vehicle", label: "Company vehicle" },
  { value: "other_needs_review", label: "Other / needs review" }
] as const;

type EmployeeDetailTab = "execute" | "closeout" | "exceptions";

type CloseoutDraft = {
  overall_outcome: "" | "smooth" | "minor_issues" | "major_issues" | "needs_leadership_review";
  staffing_fit: "" | "understaffed" | "right_sized" | "overstaffed";
  setup_difficulty: "" | "low" | "medium" | "high";
  customer_school_readiness: "" | "ready" | "minor_friction" | "major_friction";
  data_roster_readiness: "" | "ready" | "minor_friction" | "major_friction";
  equipment_workflow_issue: "" | "none" | "minor" | "major";
  started_on_time: boolean | null;
  short_summary_note: string;
  next_time_recommendation: string;
  follow_up_required: boolean;
  major_issue_flag: boolean;
  location_memory_update_suggested: boolean;
  leadership_review_needed: boolean;
  issue_category:
    | "staffing"
    | "attendance_no_show"
    | "setup_room_problem"
    | "parking_load_in"
    | "school_readiness"
    | "data_roster"
    | "equipment_technical"
    | "lighting_environment"
    | "line_flow_traffic"
    | "student_parent_flow"
    | "communication_contact_issue"
    | "special_product_deliverable_issue"
    | "other"
    | null;
  understaffed_role: string;
  staffing_change_recommendation: string;
  customer_follow_up_needed: boolean;
  recommended_staffing_next_time: string;
  recommended_arrival_buffer_minutes: string;
  recommended_room_setup_change: string;
  special_gear_needed_next_time: string;
  top_watch_out: string;
  location_memory_promotion_text: string;
  went_well: string;
  remember_next_time: string;
  issue_flag: boolean;
  open_comment: string;
  submit_for_mileage: boolean;
  vehicle_type: "personal_vehicle" | "carpool_passenger" | "company_vehicle" | "other_needs_review" | null;
};

export function EmployeeShiftDetailPanel({ token, currentUser, detail, onUpdated, onNotice, onError }: Props) {
  const workflow = useMemo(() => getShiftWorkflowState(detail.shift), [detail.shift]);
  const [busyAction, setBusyAction] = useState("");
  const [exceptionReason, setExceptionReason] = useState(EXCEPTION_REASON_OPTIONS[0].value);
  const [exceptionNotes, setExceptionNotes] = useState("");
  const [lateNotice, setLateNotice] = useState("");
  const [tradePartnerId, setTradePartnerId] = useState(detail.trade_candidates.find((candidate) => !candidate.has_conflict)?.id ?? "");
  const [tradeReason, setTradeReason] = useState("");
  const [readyExceptionReason, setReadyExceptionReason] = useState("");
  const [readyConfirmationNote, setReadyConfirmationNote] = useState("");
  const [missedPunchDirection, setMissedPunchDirection] = useState<"in" | "out">(workflow.primaryMissingDirection ?? "in");
  const [missedPunchCorrectedTime, setMissedPunchCorrectedTime] = useState(buildDefaultCorrectedTime(detail.shift, workflow.primaryMissingDirection ?? "in"));
  const [missedPunchExplanation, setMissedPunchExplanation] = useState("");
  const [setupPhotoFile, setSetupPhotoFile] = useState<File | null>(null);
  const [setupPhotoPreview, setSetupPhotoPreview] = useState("");
  const [setupPhotoCategory, setSetupPhotoCategory] = useState<(typeof SETUP_PHOTO_CATEGORY_OPTIONS)[number]["value"]>("final_camera_background_setup");
  const [setupPhotoCaption, setSetupPhotoCaption] = useState("");
  const [setupPhotoPromote, setSetupPhotoPromote] = useState(false);
  const [closeoutDraft, setCloseoutDraft] = useState(buildCloseoutDraft(detail));
  const [activeTab, setActiveTab] = useState<EmployeeDetailTab>(() => getDefaultDetailTab(detail));
  const readyToShoot = detail.ready_to_shoot ?? null;
  const showReadyToShootSection = Boolean(
    readyToShoot && (readyToShoot.actor_is_authorized || detail.shift.satisfies_lead_coverage)
  );

  const selectedTradeCandidate = detail.trade_candidates.find((candidate) => candidate.id === tradePartnerId) ?? null;

  useEffect(() => {
    setTradePartnerId(detail.trade_candidates.find((candidate) => !candidate.has_conflict)?.id ?? "");
  }, [detail.trade_candidates]);

  useEffect(() => {
    const nextDirection = workflow.primaryMissingDirection ?? "in";
    setMissedPunchDirection(nextDirection);
    setMissedPunchCorrectedTime(buildDefaultCorrectedTime(detail.shift, nextDirection));
  }, [detail.shift, workflow.primaryMissingDirection]);

  useEffect(() => {
    setCloseoutDraft(buildCloseoutDraft(detail));
  }, [detail]);

  useEffect(() => {
    setSetupPhotoCategory("final_camera_background_setup");
    setSetupPhotoCaption("");
    setSetupPhotoPromote(false);
    setReadyExceptionReason("");
    setReadyConfirmationNote("");
  }, [detail.event.id]);

  useEffect(() => {
    setActiveTab(getDefaultDetailTab(detail));
  }, [detail]);

  async function runAction(actionKey: string, action: () => Promise<void>) {
    if (busyAction) {
      return;
    }
    setBusyAction(actionKey);
    try {
      await action();
      await onUpdated();
    } catch (error) {
      onError(error instanceof Error ? error.message : "We couldn't finish that action.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleMissedPunchRequest() {
    await runAction("missed-punch", async () => {
      await submitEmployeeEventMissedPunchRequest(token, {
        event_id: detail.event.id,
        missing_direction: missedPunchDirection,
        employee_submitted_explanation: missedPunchExplanation.trim() || `Submitting missed clock-${missedPunchDirection} from My Work.`,
        requested_approver_user_id: detail.shift.manager_user_id ?? null,
        corrected_time: missedPunchCorrectedTime || buildDefaultCorrectedTime(detail.shift, missedPunchDirection),
        notes: missedPunchExplanation.trim() || null
      });
      setMissedPunchExplanation("");
      onNotice(`Missed clock-${missedPunchDirection} request sent for review.`);
    });
  }

  async function handleAcknowledgeNotes() {
    await runAction("acknowledge-notes", async () => {
      await acknowledgeEmployeeEventNotes(token, detail.event.id);
      onNotice("Pre-service notes marked as reviewed.");
    });
  }

  async function handleLateNotice() {
    await runAction("late-notice", async () => {
      await submitEmployeeEventRunningLateNotice(token, detail.event.id, {
        notes: lateNotice || "Running late from My Work.",
        requested_approver_user_id: detail.shift.manager_user_id ?? null
      });
      setLateNotice("");
      onNotice("Late notice sent.");
    });
  }

  async function handleReadyToShootConfirm(useException: boolean) {
    if (!detail.shift.shoot_id || !readyToShoot) {
      return;
    }
    if (useException && !readyExceptionReason.trim()) {
      onError("Add an exception reason before confirming Ready to Shoot with an exception.");
      return;
    }

    await runAction("ready-to-shoot", async () => {
      const location = await getBrowserLocation();
      await confirmShootReadyToShoot(token, detail.shift.shoot_id!, {
        exception_reason: useException ? readyExceptionReason.trim() : null,
        note: readyConfirmationNote.trim() || null,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        accuracy_meters: location?.accuracy ?? null,
        device_context: {
          client: "admin_web",
          surface: "employee_shift_detail"
        }
      });
      setReadyExceptionReason("");
      setReadyConfirmationNote("");
      onNotice(useException ? "Ready to Shoot submitted with an exception." : "Ready to Shoot confirmed.");
    });
  }

  async function handleExceptionNote() {
    await runAction("exception-note", async () => {
      await submitEmployeeEventExceptionNote(token, {
        event_id: detail.event.id,
        exception_type: "FIELD_EXCEPTION_NOTE",
        reason_code: exceptionReason,
        notes: exceptionNotes || null,
        requested_approver_user_id: detail.shift.manager_user_id ?? null
      });
      setExceptionNotes("");
      onNotice("Exception note submitted for review.");
    });
  }

  async function handleTradeRequest() {
    if (!tradePartnerId || !tradeReason.trim()) {
      onError("Choose a trade partner and add a short reason before sending the request.");
      return;
    }
    await runAction("trade-request", async () => {
      await requestEmployeeEventTrade(token, detail.event.id, {
        requested_with_user_id: tradePartnerId,
        reason: tradeReason.trim()
      });
      setTradeReason("");
      onNotice("Trade request sent.");
    });
  }

  async function handleCancelTrade(tradeRequestId: string) {
    await runAction(`cancel-trade-${tradeRequestId}`, async () => {
      await cancelEmployeeTrade(token, tradeRequestId);
      onNotice("Pending trade request withdrawn.");
    });
  }

  async function handleSetupPhotoSelection(file: File | null) {
    setSetupPhotoFile(file);
    if (!file) {
      setSetupPhotoPreview("");
      return;
    }
    try {
      setSetupPhotoPreview(await fileToDataUrl(file));
    } catch (error) {
      onError(error instanceof Error ? error.message : "We couldn't preview that setup photo.");
    }
  }

  async function handleSetupPhotoUpload() {
    const locationId = detail.location_context.matched_location_id;
    if (!locationId || !setupPhotoFile || !setupPhotoPreview) {
      onError("Choose a setup photo before uploading.");
      return;
    }
    await runAction("setup-photo", async () => {
      await uploadShootLocationPhoto(token, {
        location_id: locationId,
        shoot_id: detail.shift.shoot_id ?? null,
        file_name: setupPhotoFile.name,
        content_type: setupPhotoFile.type || "image/jpeg",
        photo_category: setupPhotoCategory,
        caption: setupPhotoCaption.trim() || null,
        promote_to_location_memory: setupPhotoPromote,
        data_url: setupPhotoPreview
      });
      setSetupPhotoFile(null);
      setSetupPhotoPreview("");
      setSetupPhotoCaption("");
      setSetupPhotoPromote(false);
      setSetupPhotoCategory("final_camera_background_setup");
      onNotice("Setup photo uploaded.");
    });
  }

  async function handleCloseoutSubmit(mode: "draft" | "submitted") {
    if (detail.closeout_compliance?.post_shoot_evaluation_state === "closed") {
      onError("This post-shoot eval is already closed.");
      return;
    }
    if (mode === "submitted" && detail.closeout_compliance?.post_shoot_evaluation_submitted) {
      onError("Shift closeout is already submitted for this assignment.");
      return;
    }
    if (closeoutDraft.submit_for_mileage && !closeoutDraft.vehicle_type) {
      onError("Choose a vehicle type before submitting mileage.");
      return;
    }
    await runAction(`closeout-${mode}`, async () => {
      await submitEmployeeEventPostShootEvaluation(token, detail.event.id, {
        eval_status: mode,
        overall_outcome: closeoutDraft.overall_outcome || null,
        overall_shoot_status: mapOutcomeToLegacyStatus(closeoutDraft.overall_outcome || null),
        staffing_fit: closeoutDraft.staffing_fit || null,
        setup_difficulty: closeoutDraft.setup_difficulty || null,
        customer_school_readiness: closeoutDraft.customer_school_readiness || null,
        data_roster_readiness: closeoutDraft.data_roster_readiness || null,
        equipment_workflow_issue: closeoutDraft.equipment_workflow_issue || null,
        started_on_time: closeoutDraft.started_on_time,
        short_summary_note: closeoutDraft.short_summary_note.trim() || null,
        next_time_recommendation: closeoutDraft.next_time_recommendation.trim() || null,
        follow_up_required: closeoutDraft.follow_up_required,
        major_issue_flag: closeoutDraft.major_issue_flag,
        location_memory_update_suggested: closeoutDraft.location_memory_update_suggested,
        leadership_review_needed: closeoutDraft.leadership_review_needed,
        issue_category: closeoutDraft.issue_category,
        understaffed_role: closeoutDraft.understaffed_role.trim() || null,
        staffing_change_recommendation: closeoutDraft.staffing_change_recommendation.trim() || null,
        customer_follow_up_needed: closeoutDraft.customer_follow_up_needed,
        recommended_staffing_next_time: parseOptionalInteger(closeoutDraft.recommended_staffing_next_time),
        recommended_arrival_buffer_minutes: parseOptionalInteger(closeoutDraft.recommended_arrival_buffer_minutes),
        recommended_room_setup_change: closeoutDraft.recommended_room_setup_change.trim() || null,
        special_gear_needed_next_time: closeoutDraft.special_gear_needed_next_time.trim() || null,
        top_watch_out: closeoutDraft.top_watch_out.trim() || null,
        location_memory_promotion_text: closeoutDraft.location_memory_promotion_text.trim() || null,
        went_well: closeoutDraft.went_well.trim() || null,
        remember_next_time: closeoutDraft.remember_next_time.trim() || null,
        issue_flag: closeoutDraft.issue_flag || closeoutDraft.follow_up_required,
        open_comment: closeoutDraft.open_comment.trim() || null,
        submit_for_mileage: closeoutDraft.submit_for_mileage,
        vehicle_type: closeoutDraft.submit_for_mileage ? closeoutDraft.vehicle_type : null
      });
      onNotice(mode === "draft" ? "Post-shoot eval draft saved." : "Post-shoot eval submitted.");
    });
  }

  const pendingTradeRequests = detail.trade_requests.filter((request) => ["pending_recipient", "pending_manager"].includes(request.status));
  const followThroughCount = detail.closeout_compliance?.missing_required_items.length ?? 0;
  const exceptionCount =
    detail.exceptions.length +
    pendingTradeRequests.length +
    (workflow.primaryActionKind === "missed_punch" || detail.shift.attendance_state === "no_show_suspected" ? 1 : 0);
  const closeoutCompliance = detail.closeout_compliance;
  const latestCloseout = detail.closeout_compliance?.last_post_shoot_evaluation ?? null;
  const locationMemorySummary = detail.location_context.location_memory_summary ?? null;
  const canEditCloseout = Boolean(
    closeoutCompliance &&
      detail.actions.can_submit_post_shoot_eval &&
      closeoutCompliance.post_shoot_evaluation_state !== "closed" &&
      !closeoutCompliance.post_shoot_evaluation_submitted
  );
  const showIssueContext =
    closeoutDraft.follow_up_required ||
    closeoutDraft.major_issue_flag ||
    closeoutDraft.leadership_review_needed ||
    closeoutDraft.overall_outcome === "major_issues" ||
    closeoutDraft.overall_outcome === "needs_leadership_review";
  const showMemoryContext = closeoutDraft.location_memory_update_suggested;

  return (
    <div className="employee-detail-shell">
      <div className="employee-primary-card">
        <div>
          <div className="eyebrow">Shift Status</div>
          <h3>{workflow.statusTitle}</h3>
          <p className="section-subtitle">{workflow.statusDetail}</p>
        </div>
        <div className="employee-primary-card__actions">
          {detail.shift.navigation_url ? (
            <a className="secondary-button" href={detail.shift.navigation_url} target="_blank" rel="noreferrer">
              Open Maps
            </a>
          ) : null}
        </div>
      </div>

      <div className="employee-info-grid">
        <div className="employee-info-card">
          <span className="eyebrow">Time And Role</span>
          <strong>{detail.shift.shoot_code ?? detail.shift.title}</strong>
          <div className="muted">{detail.shift.shoot_title && detail.shift.shoot_title !== detail.shift.title ? detail.shift.shoot_title : humanizeLabel(detail.shift.shift_kind)}</div>
          <div className="muted">{formatShiftWindow(detail.shift.starts_at, detail.shift.ends_at)}</div>
          <div className="muted">{humanizeLabel(detail.shift.staffing_role ?? detail.shift.shift_kind)}</div>
        </div>

        <div className="employee-info-card">
          <span className="eyebrow">Location And Directions</span>
          <strong>{detail.location_context.location_name ?? detail.shift.location_name ?? "Location pending"}</strong>
          <div className="muted">{detail.location_context.location_address ?? detail.shift.location_address ?? "Address pending"}</div>
          {detail.location_context.estimated_drive_minutes ? (
            <div className="muted">{detail.location_context.estimated_drive_minutes} min from office</div>
          ) : null}
        </div>

        <div className="employee-info-card">
          <span className="eyebrow">Primary Contact</span>
          <strong>{detail.primary_contact?.name ?? "Contact pending"}</strong>
          <div className="muted">{detail.primary_contact?.role_label ?? "Lead routing will update when assigned."}</div>
          <div className="employee-link-row">
            {detail.primary_contact?.call_href ? (
              <a className="secondary-button" href={detail.primary_contact.call_href}>
                Call
              </a>
            ) : null}
            {detail.primary_contact?.text_href ? (
              <a className="secondary-button" href={detail.primary_contact.text_href}>
                Text
              </a>
            ) : null}
          </div>
          {detail.site_contact ? <div className="muted">{detail.site_contact.label}: {detail.site_contact.value}</div> : null}
        </div>
      </div>

      <div className="employee-detail-tabs" role="tablist" aria-label="Shift detail sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "execute"}
          className={`employee-detail-tab${activeTab === "execute" ? " is-active" : ""}`}
          onClick={() => setActiveTab("execute")}
        >
          <span>Execute</span>
          <small>Clock, notes, setup</small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "closeout"}
          className={`employee-detail-tab${activeTab === "closeout" ? " is-active" : ""}`}
          onClick={() => setActiveTab("closeout")}
        >
          <span>Closeout</span>
          <small>{followThroughCount ? `${followThroughCount} still open` : "Wrap and handoff"}</small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "exceptions"}
          className={`employee-detail-tab${activeTab === "exceptions" ? " is-active" : ""}`}
          onClick={() => setActiveTab("exceptions")}
        >
          <span>Exceptions</span>
          <small>{exceptionCount ? `${exceptionCount} item${exceptionCount === 1 ? "" : "s"} to review` : "Late notes and trades"}</small>
        </button>
      </div>

      {activeTab === "execute" ? (
        <>
      {showReadyToShootSection ? (
        <OperationalDetailSection
          title="Ready to Shoot"
          summary={buildReadyToShootSectionSummary(readyToShoot)}
          defaultOpen={Boolean(readyToShoot && !readyToShoot.already_confirmed)}
          compact
        >
          {readyToShoot ? (
            <div className="employee-form-stack">
              <div className="employee-shift-card__flags">
                <span className={`meta-pill${readyToShoot.lead_confirmed_ready_exception_flag ? " meta-pill--warning" : ""}`}>
                  {buildReadyToShootBadgeLabel(readyToShoot)}
                </span>
                {readyToShoot.latest_confirmation?.confirmed_at ? (
                  <span className="meta-pill">
                    {formatReadyToShootConfirmedLabel(readyToShoot.latest_confirmation.confirmed_at)}
                  </span>
                ) : null}
              </div>

              <div className="employee-note-list">
                {readyToShoot.checks.map((check) => (
                  <article key={check.key} className="employee-note-card">
                    <span className="eyebrow">{check.label}</span>
                    <p>{check.detail}</p>
                    <div className="employee-shift-card__flags">
                      <span className={`meta-pill${check.passed ? "" : " meta-pill--warning"}`}>{check.passed ? "Ready" : "Needs attention"}</span>
                    </div>
                  </article>
                ))}
              </div>

              {readyToShoot.latest_confirmation?.exception_reason ? (
                <article className="employee-note-card">
                  <span className="eyebrow">Exception Reason</span>
                  <p>{readyToShoot.latest_confirmation.exception_reason}</p>
                  {readyToShoot.latest_confirmation.note ? <p>{readyToShoot.latest_confirmation.note}</p> : null}
                </article>
              ) : null}

              {!readyToShoot.already_confirmed ? (
                <>
                  <label className="filter-field filter-field--wide">
                    <span>Optional Note</span>
                    <textarea
                      rows={2}
                      value={readyConfirmationNote}
                      onChange={(event) => setReadyConfirmationNote(event.target.value)}
                      placeholder="Add a short setup note if the manager should know it."
                    />
                  </label>
                  {readyToShoot.can_confirm_with_exception ? (
                    <label className="filter-field filter-field--wide">
                      <span>Exception Reason</span>
                      <textarea
                        rows={2}
                        value={readyExceptionReason}
                        onChange={(event) => setReadyExceptionReason(event.target.value)}
                        placeholder="Explain what is still missing or why the team is starting with an exception."
                      />
                    </label>
                  ) : null}
                  <div className="employee-section-actions">
                    {readyToShoot.can_confirm_clean ? (
                      <button className="primary-button" disabled={Boolean(busyAction)} onClick={() => void handleReadyToShootConfirm(false)}>
                        {busyAction === "ready-to-shoot" ? "Saving..." : "Ready to Shoot"}
                      </button>
                    ) : null}
                    {readyToShoot.can_confirm_with_exception ? (
                      <button className="secondary-button" disabled={Boolean(busyAction)} onClick={() => void handleReadyToShootConfirm(true)}>
                        {busyAction === "ready-to-shoot" ? "Saving..." : "Confirm With Exception"}
                      </button>
                    ) : null}
                  </div>
                  {!readyToShoot.can_confirm_clean && !readyToShoot.can_confirm_with_exception ? (
                    <div className="muted">{buildReadyToShootBlockedCopy(readyToShoot)}</div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : (
            <div className="empty-state">Ready to Shoot will appear when this shift has active lead confirmation coverage.</div>
          )}
        </OperationalDetailSection>
      ) : null}

      <OperationalDetailSection
        title="Pre-Service Notes"
        summary={detail.pre_service_notes.summary_line}
        defaultOpen={!detail.pre_service_notes.acknowledged}
        compact
      >
        {detail.pre_service_notes.highlights.length ? (
          <div className="employee-note-list">
            {detail.pre_service_notes.highlights.map((highlight) => (
              <article key={`${highlight.label}-${highlight.text}`} className="employee-note-card">
                <span className="eyebrow">{highlight.label}</span>
                <p>{highlight.text}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">No extra prep notes are attached to this shift.</div>
        )}
        {detail.pre_service_notes.highlights.length ? (
          <div className="employee-section-actions">
            <button
              className="secondary-button"
              disabled={Boolean(busyAction) || detail.pre_service_notes.acknowledged}
              onClick={() => void handleAcknowledgeNotes()}
            >
              {detail.pre_service_notes.acknowledged ? "Notes Acknowledged" : busyAction === "acknowledge-notes" ? "Saving..." : "Acknowledge Notes"}
            </button>
          </div>
        ) : null}
      </OperationalDetailSection>

      <OperationalDetailSection
        title="Location Memory"
        summary={buildLocationMemorySectionSummary(detail)}
        compact
      >
        {locationMemorySummary || detail.location_context.location_memory_highlights?.length ? (
          <div className="employee-form-stack">
            {locationMemorySummary ? (
              <>
                <div className="employee-shift-card__flags">
                  <span className="meta-pill">{humanizeLabel(locationMemorySummary.status)}</span>
                  {locationMemorySummary.last_confirmed_at ? (
                    <span className="meta-pill">Last confirmed {new Date(locationMemorySummary.last_confirmed_at).toLocaleDateString()}</span>
                  ) : (
                    <span className="meta-pill">Needs confirmation</span>
                  )}
                </div>
                <div className="employee-history-list">
                  {locationMemorySummary.where_to_go ? (
                    <article className="employee-history-card">
                      <span className="eyebrow">Where To Go</span>
                      <p>{locationMemorySummary.where_to_go}</p>
                    </article>
                  ) : null}
                  {locationMemorySummary.where_to_park ? (
                    <article className="employee-history-card">
                      <span className="eyebrow">Where To Park</span>
                      <p>{locationMemorySummary.where_to_park}</p>
                    </article>
                  ) : null}
                  {locationMemorySummary.where_to_set_up ? (
                    <article className="employee-history-card">
                      <span className="eyebrow">Where To Set Up</span>
                      <p>{locationMemorySummary.where_to_set_up}</p>
                    </article>
                  ) : null}
                  {locationMemorySummary.top_watch_out ? (
                    <article className="employee-history-card">
                      <span className="eyebrow">Top Watch-Out</span>
                      <p>{locationMemorySummary.top_watch_out}</p>
                    </article>
                  ) : null}
                </div>
                {locationMemorySummary.setup_photos.length ? (
                  <div className="setup-photo-grid">
                    {locationMemorySummary.setup_photos.slice(0, 3).map((photo) => (
                      <figure key={photo.id} className="setup-photo-card">
                        <img src={photo.image_url} alt={photo.caption} />
                        <figcaption>
                          <strong>{photo.caption}</strong>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
            {detail.location_context.location_memory_highlights?.length ? (
              <div className="employee-note-list">
                {detail.location_context.location_memory_highlights.slice(0, 3).map((highlight) => (
                  <article key={highlight.id} className="employee-note-card">
                    <span className="eyebrow">Crew Note</span>
                    <p>{highlight.body}</p>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="empty-state">This location still needs stronger reusable memory. Use setup photos and the post-shoot eval to improve the next crew's day.</div>
        )}
      </OperationalDetailSection>

      <OperationalDetailSection
        title="Resource Library"
        summary="Approved prep materials, documents, and the strongest historical references for this Shoot."
        compact
      >
        <ResourceLibraryPanel library={detail.resource_library ?? null} scopeLabel="Shoot" />
      </OperationalDetailSection>

      <OperationalDetailSection title="Setup Photo Upload" summary="Snap the setup and keep the location guide current." compact>
        {detail.actions.can_upload_setup_photo ? (
          <div className="employee-form-stack">
            <div className="employee-shift-card__flags">
              <span className="meta-pill">{describeSetupPhotoState(detail.closeout_compliance?.setup_photo_state ?? "not_required")}</span>
              {detail.closeout_compliance?.setup_photo_required ? <span className="meta-pill">Required for this shoot</span> : null}
            </div>
            <div className="field-grid field-grid--compact">
              <label className="filter-field">
                <span>Photo Category</span>
                <select value={setupPhotoCategory} onChange={(event) => setSetupPhotoCategory(event.target.value as (typeof SETUP_PHOTO_CATEGORY_OPTIONS)[number]["value"])}>
                  {SETUP_PHOTO_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field filter-field--wide">
                <span>Caption</span>
                <input
                  value={setupPhotoCaption}
                  onChange={(event) => setSetupPhotoCaption(event.target.value)}
                  placeholder="What should the next crew notice from this view?"
                />
              </label>
            </div>
            <label className="filter-field filter-field--wide">
              <span>Setup Photo</span>
              <input type="file" accept="image/*" capture="environment" onChange={(event) => void handleSetupPhotoSelection(event.target.files?.[0] ?? null)} />
            </label>
            <label className="checkbox-field">
              <input type="checkbox" checked={setupPhotoPromote} onChange={(event) => setSetupPhotoPromote(event.target.checked)} />
              <span>Suggest this setup photo for reusable location memory</span>
            </label>
            {setupPhotoPreview ? (
              <div className="employee-photo-preview">
                <img src={setupPhotoPreview} alt="Setup photo preview" />
              </div>
            ) : detail.location_context.recent_photos[0] ? (
              <div className="employee-photo-preview">
                <img src={detail.location_context.recent_photos[0].image_url} alt={detail.location_context.recent_photos[0].caption || "Recent setup"} />
              </div>
            ) : null}
            <div className="employee-section-actions">
              <button className="primary-button" disabled={Boolean(busyAction) || !setupPhotoPreview} onClick={() => void handleSetupPhotoUpload()}>
                {busyAction === "setup-photo" ? "Uploading..." : "Upload Setup Photo"}
              </button>
            </div>
          </div>
        ) : (
          <div className="empty-state">Setup photo upload becomes available once this shift is linked to a location record.</div>
        )}
      </OperationalDetailSection>

      <OperationalDetailSection
        title="Time Clock Status"
        summary={
          workflow.primaryActionKind === "missed_punch"
            ? workflow.workflowHint
            : "Use the red or green shell time control at the top of the app for live punch actions. This page keeps the shift context, missed-punch workflow, and exception notes in one place."
        }
        defaultOpen
        compact
      >
        <div className="employee-action-stack">
          <div className="employee-status-card">
            <strong>{workflow.statusTitle}</strong>
            <p>{workflow.statusDetail}</p>
            {workflow.reviewNote ? <span className="meta-pill">{workflow.reviewNote}</span> : null}
            {workflow.primaryActionKind === "clock" && detail.actions.can_clock ? (
              <div className="feedback-strip feedback-strip--info">
                Use the shell time clock for live clock-ins and clock-outs so Mission Control keeps one punch surface and one source of truth.
              </div>
            ) : null}
          </div>
          {workflow.primaryActionKind === "missed_punch" && detail.actions.can_submit_missed_punch ? (
            <div className="employee-form-stack">
              <div className="field-grid field-grid--compact">
                <label className="filter-field">
                  <span>Request Type</span>
                  <select value={missedPunchDirection} onChange={(event) => setMissedPunchDirection(event.target.value as "in" | "out")}>
                    <option value="in">Missed clock-in</option>
                    <option value="out">Missed clock-out</option>
                  </select>
                </label>
                <label className="filter-field">
                  <span>Corrected Time</span>
                  <input
                    type="datetime-local"
                    value={missedPunchCorrectedTime}
                    onChange={(event) => setMissedPunchCorrectedTime(event.target.value)}
                  />
                </label>
                <label className="filter-field filter-field--wide">
                  <span>Quick Context</span>
                  <textarea
                    rows={2}
                    value={missedPunchExplanation}
                    onChange={(event) => setMissedPunchExplanation(event.target.value)}
                    placeholder="Add a short note if the timeline needs context."
                  />
                </label>
              </div>
              <div className="employee-section-actions">
                <button className="primary-button" disabled={Boolean(busyAction)} onClick={() => void handleMissedPunchRequest()}>
                  {busyAction === "missed-punch" ? "Sending..." : workflow.primaryActionLabel}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </OperationalDetailSection>
        </>
      ) : null}

      {activeTab === "closeout" ? (
        <>
      <OperationalDetailSection
        title="Post-Shoot Eval"
        summary={buildCloseoutSectionSummary(detail)}
        defaultOpen={Boolean(detail.closeout_compliance?.missing_required_items.length) || !detail.closeout_compliance?.post_shoot_evaluation_submitted}
        badge={
          latestCloseout
            ? humanizeLabel(latestCloseout.eval_status)
            : followThroughCount
              ? `${followThroughCount} open`
              : "Not started"
        }
        compact
      >
        {detail.closeout_compliance ? (
          <div className="employee-form-stack">
            <div className="employee-closeout-grid">
              <article className="employee-history-card">
                <span className="eyebrow">Setup Photo</span>
                <strong>{describeSetupPhotoState(detail.closeout_compliance.setup_photo_state)}</strong>
                <p>
                  {detail.closeout_compliance.setup_photo_required
                    ? detail.closeout_compliance.setup_photo_uploaded
                      ? "Setup coverage is attached to this shoot and ready for review."
                      : "Upload the setup before wrap so the next crew sees the real room."
                    : "This assignment does not require a setup photo."}
                </p>
              </article>
              <article className="employee-history-card">
                <span className="eyebrow">Eval State</span>
                <strong>{describeEvalState(detail.closeout_compliance.post_shoot_evaluation_state)}</strong>
                <p>
                  {detail.closeout_compliance.post_shoot_evaluation_submitted
                    ? "Operations can now review the submitted eval, follow-up, and memory suggestions."
                    : "Capture what happened, what should change next time, and what future crews need to know."}
                </p>
              </article>
              <article className="employee-history-card">
                <span className="eyebrow">Location Memory</span>
                <strong>{locationMemorySummary ? humanizeLabel(locationMemorySummary.status) : "Still thin"}</strong>
                <p>
                  {locationMemorySummary?.top_watch_out
                    ? locationMemorySummary.top_watch_out
                    : "If the location taught the crew something reusable, suggest it below instead of burying it in free text."}
                </p>
              </article>
              <article className="employee-history-card">
                <span className="eyebrow">Mileage</span>
                <strong>{buildMileageHeadline(detail.closeout_compliance)}</strong>
                <p>{detail.closeout_compliance.mileage_reimbursement?.issue_label ?? "Mileage will update after closeout is submitted when needed."}</p>
              </article>
            </div>
            {detail.closeout_compliance.missing_required_items.length ? (
              <div className="feedback-strip feedback-strip--danger">
                <div className="feedback-strip__content">
                  <strong>Closeout still needs attention</strong>
                  <span>
                    {detail.closeout_compliance.missing_required_items.map(humanizeCloseoutItem).join(" and ")} {detail.closeout_compliance.missing_required_items.length === 1 ? "is" : "are"} still missing.
                  </span>
                </div>
              </div>
            ) : null}
            {detail.closeout_compliance.compliance_flags.length ? (
              <div className="employee-history-list">
                {detail.closeout_compliance.compliance_flags.map((flag) => (
                  <article key={flag.id} className="employee-history-card">
                    <div className="employee-shift-card__top">
                      <strong>{flag.item_label}</strong>
                      <span className={`home-tone-chip home-tone-chip--${flag.severity === "high" ? "action_needed" : "heads_up"}`}>
                        {flag.severity === "high" ? "Action needed" : "Heads up"}
                      </span>
                    </div>
                    <p>{flag.message}</p>
                  </article>
                ))}
              </div>
            ) : null}
            {latestCloseout ? (
              <article className="employee-history-card">
                <span className="eyebrow">Latest Eval</span>
                <strong>{formatEvalOutcome(latestCloseout.overall_outcome, latestCloseout.overall_shoot_status)}</strong>
                <div className="muted">{buildEvalTimestampSummary(latestCloseout)}</div>
                <p>{latestCloseout.short_summary_note || latestCloseout.open_comment || latestCloseout.went_well || "No extra summary was added."}</p>
                {latestCloseout.next_time_recommendation || latestCloseout.remember_next_time ? (
                  <div className="muted">Next time: {latestCloseout.next_time_recommendation || latestCloseout.remember_next_time}</div>
                ) : null}
                <div className="employee-shift-card__flags">
                  <span className="meta-pill">{humanizeLabel(latestCloseout.eval_status)}</span>
                  {latestCloseout.staffing_fit ? <span className="meta-pill">{humanizeLabel(latestCloseout.staffing_fit)}</span> : null}
                  {latestCloseout.issue_category ? <span className="meta-pill">{humanizeLabel(latestCloseout.issue_category)}</span> : null}
                  {latestCloseout.follow_up_required || latestCloseout.issue_flag ? <span className="meta-pill">Follow-up required</span> : null}
                  {latestCloseout.location_memory_update_suggested ? <span className="meta-pill">Memory suggested</span> : null}
                  {latestCloseout.submit_for_mileage ? <span className="meta-pill">Mileage submitted</span> : null}
                </div>
                {latestCloseout.top_watch_out ? <div className="muted">Watch-out: {latestCloseout.top_watch_out}</div> : null}
              </article>
            ) : null}
            {canEditCloseout ? (
              <div className="employee-form-stack">
                <div className="field-grid field-grid--compact">
                  <label className="filter-field">
                    <span>Overall Outcome</span>
                    <select
                      value={closeoutDraft.overall_outcome}
                      onChange={(event) =>
                        setCloseoutDraft((current) => ({
                          ...current,
                          overall_outcome: event.target.value as CloseoutDraft["overall_outcome"]
                        }))
                      }
                    >
                      <option value="">Choose one</option>
                      {CLOSEOUT_OUTCOME_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="filter-field">
                    <span>Staffing Fit</span>
                    <select
                      value={closeoutDraft.staffing_fit}
                      onChange={(event) =>
                        setCloseoutDraft((current) => ({
                          ...current,
                          staffing_fit: event.target.value as CloseoutDraft["staffing_fit"]
                        }))
                      }
                    >
                      <option value="">Choose one</option>
                      {STAFFING_FIT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="filter-field">
                    <span>Setup Difficulty</span>
                    <select
                      value={closeoutDraft.setup_difficulty}
                      onChange={(event) =>
                        setCloseoutDraft((current) => ({
                          ...current,
                          setup_difficulty: event.target.value as CloseoutDraft["setup_difficulty"]
                        }))
                      }
                    >
                      <option value="">Choose one</option>
                      {SETUP_DIFFICULTY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="filter-field">
                    <span>Started On Time</span>
                    <select
                      value={closeoutDraft.started_on_time === null ? "" : closeoutDraft.started_on_time ? "yes" : "no"}
                      onChange={(event) =>
                        setCloseoutDraft((current) => ({
                          ...current,
                          started_on_time: event.target.value === "" ? null : event.target.value === "yes"
                        }))
                      }
                    >
                      <option value="">Choose one</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </label>
                  <label className="filter-field">
                    <span>Customer / School Readiness</span>
                    <select
                      value={closeoutDraft.customer_school_readiness}
                      onChange={(event) =>
                        setCloseoutDraft((current) => ({
                          ...current,
                          customer_school_readiness: event.target.value as CloseoutDraft["customer_school_readiness"]
                        }))
                      }
                    >
                      <option value="">Choose one</option>
                      {READINESS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="filter-field">
                    <span>Data / Roster Readiness</span>
                    <select
                      value={closeoutDraft.data_roster_readiness}
                      onChange={(event) =>
                        setCloseoutDraft((current) => ({
                          ...current,
                          data_roster_readiness: event.target.value as CloseoutDraft["data_roster_readiness"]
                        }))
                      }
                    >
                      <option value="">Choose one</option>
                      {READINESS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="filter-field">
                    <span>Equipment / Workflow</span>
                    <select
                      value={closeoutDraft.equipment_workflow_issue}
                      onChange={(event) =>
                        setCloseoutDraft((current) => ({
                          ...current,
                          equipment_workflow_issue: event.target.value as CloseoutDraft["equipment_workflow_issue"]
                        }))
                      }
                    >
                      <option value="">Choose one</option>
                      {ISSUE_STATE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="filter-field filter-field--wide">
                    <span>Short Summary</span>
                    <textarea
                      rows={2}
                      value={closeoutDraft.short_summary_note}
                      onChange={(event) => setCloseoutDraft((current) => ({ ...current, short_summary_note: event.target.value }))}
                      placeholder="What actually happened today?"
                    />
                  </label>
                  <label className="filter-field filter-field--wide">
                    <span>Next-Time Recommendation</span>
                    <textarea
                      rows={2}
                      value={closeoutDraft.next_time_recommendation}
                      onChange={(event) => setCloseoutDraft((current) => ({ ...current, next_time_recommendation: event.target.value }))}
                      placeholder="What should change the next time this location runs?"
                    />
                  </label>
                  <label className="filter-field filter-field--wide">
                    <span>What Worked Well</span>
                    <textarea
                      rows={2}
                      value={closeoutDraft.went_well}
                      onChange={(event) => setCloseoutDraft((current) => ({ ...current, went_well: event.target.value }))}
                      placeholder="Keep the strongest win short and useful."
                    />
                  </label>
                  <label className="filter-field filter-field--wide">
                    <span>Extra Context</span>
                    <textarea
                      rows={2}
                      value={closeoutDraft.open_comment}
                      onChange={(event) => setCloseoutDraft((current) => ({ ...current, open_comment: event.target.value }))}
                      placeholder="Anything operations or leadership should know?"
                    />
                  </label>
                </div>

                <div className="field-grid field-grid--compact">
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={closeoutDraft.follow_up_required}
                      onChange={(event) =>
                        setCloseoutDraft((current) => ({
                          ...current,
                          follow_up_required: event.target.checked,
                          issue_flag: event.target.checked || current.issue_flag
                        }))
                      }
                    />
                    <span>Follow-up is required</span>
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={closeoutDraft.major_issue_flag}
                      onChange={(event) => setCloseoutDraft((current) => ({ ...current, major_issue_flag: event.target.checked }))}
                    />
                    <span>Major issue happened on this shoot</span>
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={closeoutDraft.location_memory_update_suggested}
                      onChange={(event) =>
                        setCloseoutDraft((current) => ({ ...current, location_memory_update_suggested: event.target.checked }))
                      }
                    />
                    <span>Suggest a location memory update</span>
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={closeoutDraft.leadership_review_needed}
                      onChange={(event) => setCloseoutDraft((current) => ({ ...current, leadership_review_needed: event.target.checked }))}
                    />
                    <span>Needs leadership review</span>
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={closeoutDraft.customer_follow_up_needed}
                      onChange={(event) => setCloseoutDraft((current) => ({ ...current, customer_follow_up_needed: event.target.checked }))}
                    />
                    <span>Customer or school follow-up is needed</span>
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={closeoutDraft.submit_for_mileage}
                      onChange={(event) =>
                        setCloseoutDraft((current) => ({
                          ...current,
                          submit_for_mileage: event.target.checked,
                          vehicle_type: event.target.checked ? current.vehicle_type : null
                        }))
                      }
                    />
                    <span>Submit this shift for mileage review</span>
                  </label>
                </div>

                {closeoutDraft.staffing_fit === "understaffed" ? (
                  <div className="field-grid field-grid--compact">
                    <label className="filter-field">
                      <span>Which Role Was Short?</span>
                      <input
                        value={closeoutDraft.understaffed_role}
                        onChange={(event) => setCloseoutDraft((current) => ({ ...current, understaffed_role: event.target.value }))}
                        placeholder="Example: assistant photographer"
                      />
                    </label>
                    <label className="filter-field filter-field--wide">
                      <span>What Should Change Next Time?</span>
                      <textarea
                        rows={2}
                        value={closeoutDraft.staffing_change_recommendation}
                        onChange={(event) =>
                          setCloseoutDraft((current) => ({ ...current, staffing_change_recommendation: event.target.value }))
                        }
                        placeholder="Describe the staffing change future crews should make."
                      />
                    </label>
                  </div>
                ) : null}

                {showIssueContext ? (
                  <div className="field-grid field-grid--compact">
                    <label className="filter-field">
                      <span>Issue Category</span>
                      <select
                        value={closeoutDraft.issue_category ?? ""}
                        onChange={(event) =>
                          setCloseoutDraft((current) => ({
                            ...current,
                            issue_category: (event.target.value || null) as CloseoutDraft["issue_category"]
                          }))
                        }
                      >
                        <option value="">Choose one</option>
                        {ISSUE_CATEGORY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="filter-field filter-field--wide">
                      <span>Open Follow-Up Note</span>
                      <textarea
                        rows={2}
                        value={closeoutDraft.remember_next_time}
                        onChange={(event) => setCloseoutDraft((current) => ({ ...current, remember_next_time: event.target.value }))}
                        placeholder="What still needs action after the shoot?"
                      />
                    </label>
                  </div>
                ) : null}

                {showMemoryContext ? (
                  <div className="field-grid field-grid--compact">
                    <label className="filter-field filter-field--wide">
                      <span>What Should Become Location Memory?</span>
                      <textarea
                        rows={2}
                        value={closeoutDraft.location_memory_promotion_text}
                        onChange={(event) =>
                          setCloseoutDraft((current) => ({ ...current, location_memory_promotion_text: event.target.value }))
                        }
                        placeholder="Capture reusable guidance for the next crew."
                      />
                    </label>
                    <label className="filter-field">
                      <span>Top Watch-Out</span>
                      <input
                        value={closeoutDraft.top_watch_out}
                        onChange={(event) => setCloseoutDraft((current) => ({ ...current, top_watch_out: event.target.value }))}
                        placeholder="Shortest useful warning"
                      />
                    </label>
                    <label className="filter-field">
                      <span>Recommended Staffing Next Time</span>
                      <input
                        type="number"
                        min="0"
                        value={closeoutDraft.recommended_staffing_next_time}
                        onChange={(event) =>
                          setCloseoutDraft((current) => ({ ...current, recommended_staffing_next_time: event.target.value }))
                        }
                      />
                    </label>
                    <label className="filter-field">
                      <span>Recommended Arrival Buffer</span>
                      <input
                        type="number"
                        min="0"
                        value={closeoutDraft.recommended_arrival_buffer_minutes}
                        onChange={(event) =>
                          setCloseoutDraft((current) => ({ ...current, recommended_arrival_buffer_minutes: event.target.value }))
                        }
                        placeholder="Minutes"
                      />
                    </label>
                    <label className="filter-field filter-field--wide">
                      <span>Room / Setup Change</span>
                      <textarea
                        rows={2}
                        value={closeoutDraft.recommended_room_setup_change}
                        onChange={(event) =>
                          setCloseoutDraft((current) => ({ ...current, recommended_room_setup_change: event.target.value }))
                        }
                        placeholder="What should the next setup change?"
                      />
                    </label>
                    <label className="filter-field filter-field--wide">
                      <span>Special Gear Needed Next Time</span>
                      <textarea
                        rows={2}
                        value={closeoutDraft.special_gear_needed_next_time}
                        onChange={(event) =>
                          setCloseoutDraft((current) => ({ ...current, special_gear_needed_next_time: event.target.value }))
                        }
                        placeholder="Capture special gear, staging, or support needs."
                      />
                    </label>
                  </div>
                ) : null}

                {closeoutDraft.submit_for_mileage ? (
                  <div className="field-grid field-grid--compact">
                    <label className="filter-field">
                      <span>Vehicle Type</span>
                      <select
                        value={closeoutDraft.vehicle_type ?? ""}
                        onChange={(event) =>
                          setCloseoutDraft((current) => ({
                            ...current,
                            vehicle_type: (event.target.value || null) as CloseoutDraft["vehicle_type"]
                          }))
                        }
                      >
                        <option value="">Choose one</option>
                        {MILEAGE_VEHICLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="employee-section-actions">
              {canEditCloseout ? (
                <>
                  <button className="secondary-button" disabled={Boolean(busyAction)} onClick={() => void handleCloseoutSubmit("draft")}>
                    {busyAction === "closeout-draft" ? "Saving..." : "Save Draft"}
                  </button>
                  <button className="primary-button" disabled={Boolean(busyAction)} onClick={() => void handleCloseoutSubmit("submitted")}>
                    {busyAction === "closeout-submitted" ? "Submitting..." : "Submit Post-Shoot Eval"}
                  </button>
                </>
              ) : null}
              {detail.closeout_compliance.post_shoot_evaluation_submitted ? <span className="meta-pill">Eval submitted</span> : null}
            </div>
          </div>
        ) : (
          <div className="empty-state">Shift closeout will appear here when this assignment is tied to a shoot workflow.</div>
        )}
      </OperationalDetailSection>
        </>
      ) : null}

      {activeTab === "exceptions" ? (
        <>
      <OperationalDetailSection
        title="Exception Note"
        summary="Use requests for late arrivals, missed punches, or field issues."
        badge={detail.exceptions.length ? `${detail.exceptions.length} open` : workflow.primaryActionKind === "missed_punch" ? "Needs review" : null}
        defaultOpen
        compact
      >
        <div className="employee-form-stack">
          <label className="filter-field filter-field--wide">
            <span>Running Late Or Cannot Attend</span>
            <textarea rows={2} value={lateNotice} onChange={(event) => setLateNotice(event.target.value)} placeholder="Short note for the lead or manager." />
          </label>
          <div className="employee-section-actions">
            <button className="secondary-button" disabled={Boolean(busyAction) || !lateNotice.trim()} onClick={() => void handleLateNotice()}>
              {busyAction === "late-notice" ? "Sending..." : "Send Late Notice"}
            </button>
          </div>
          {detail.actions.can_submit_exception_note ? (
            <>
              <label className="filter-field">
                <span>Exception Type</span>
                <select value={exceptionReason} onChange={(event) => setExceptionReason(event.target.value)}>
                  {EXCEPTION_REASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field filter-field--wide">
                <span>Exception Note</span>
                <textarea rows={3} value={exceptionNotes} onChange={(event) => setExceptionNotes(event.target.value)} placeholder="Explain what happened and what needs review." />
              </label>
              <div className="employee-section-actions">
                <button className="secondary-button" disabled={Boolean(busyAction) || !exceptionNotes.trim()} onClick={() => void handleExceptionNote()}>
                  {busyAction === "exception-note" ? "Sending..." : "Submit Exception Note"}
                </button>
              </div>
            </>
          ) : null}
          {detail.exceptions.length ? (
            <div className="employee-history-list">
              {detail.exceptions.slice(0, 3).map((exception) => (
                <article key={exception.id} className="employee-history-card">
                  <strong>{humanizeLabel(exception.exception_type)}</strong>
                  <div className="muted">{humanizeLabel(exception.status)}</div>
                  <p>{exception.notes || "No note attached."}</p>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection title="Trade Request" summary="Request coverage without editing the schedule yourself." badge={pendingTradeRequests.length ? `${pendingTradeRequests.length} pending` : null} compact>
        {detail.actions.can_request_trade ? (
          <div className="employee-form-stack">
            <label className="filter-field">
              <span>Trade Partner</span>
              <select value={tradePartnerId} onChange={(event) => setTradePartnerId(event.target.value)}>
                <option value="">Choose a teammate</option>
                {detail.trade_candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.full_name} | {humanizeLabel(candidate.primary_job_function_profile ?? candidate.department)}{candidate.has_conflict ? " | Warning" : ""}
                  </option>
                ))}
              </select>
            </label>
            {selectedTradeCandidate?.conflict_summary ? <div className="feedback-strip feedback-strip--warning">{selectedTradeCandidate.conflict_summary}</div> : null}
            <label className="filter-field filter-field--wide">
              <span>Reason</span>
              <textarea rows={3} value={tradeReason} onChange={(event) => setTradeReason(event.target.value)} placeholder="Why do you need the trade?" />
            </label>
            <div className="employee-section-actions">
              <button className="secondary-button" disabled={Boolean(busyAction)} onClick={() => void handleTradeRequest()}>
                {busyAction === "trade-request" ? "Sending..." : "Request Trade"}
              </button>
            </div>
            {pendingTradeRequests.length ? (
              <div className="employee-history-list">
                {pendingTradeRequests.map((request) => (
                  <article key={request.id} className="employee-history-card">
                    <strong>{request.requested_with_name ?? "Trade request"}</strong>
                    <div className="muted">{humanizeLabel(request.status)}</div>
                    <p>{request.reason}</p>
                    {request.can_cancel ? (
                      <button className="secondary-button" disabled={Boolean(busyAction)} onClick={() => void handleCancelTrade(request.id)}>
                        {busyAction === `cancel-trade-${request.id}` ? "Canceling..." : "Withdraw Request"}
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="empty-state">Trade requests are not enabled for this shift.</div>
        )}
      </OperationalDetailSection>
        </>
      ) : null}
    </div>
  );
}

function buildReadyToShootSectionSummary(readyToShoot: EmployeeShiftDetailResponse["ready_to_shoot"]) {
  if (!readyToShoot) {
    return "Lead confirmation will appear here when this shift can confirm on-site readiness.";
  }
  if (readyToShoot.lead_confirmed_ready_exception_flag) {
    return "Ready submitted with an exception. Staffing gaps still stay visible to operations.";
  }
  if (readyToShoot.already_confirmed) {
    return "Lead readiness has already been confirmed on site.";
  }
  if (!readyToShoot.actor_on_site) {
    return "Clock in or get marked on site before confirming that the shoot is ready to begin.";
  }
  return "Confirm that the team is present, setup is workable, and the shoot is ready to start.";
}

function buildReadyToShootBadgeLabel(readyToShoot: NonNullable<EmployeeShiftDetailResponse["ready_to_shoot"]>) {
  if (readyToShoot.lead_confirmed_ready_exception_flag) {
    return "Ready with exception";
  }
  if (readyToShoot.already_confirmed) {
    return "Lead Confirmed Ready";
  }
  return readyToShoot.ready_to_shoot_label ?? "Awaiting lead confirmation";
}

function buildReadyToShootBlockedCopy(readyToShoot: NonNullable<EmployeeShiftDetailResponse["ready_to_shoot"]>) {
  if (!readyToShoot.actor_is_authorized) {
    return "Only the assigned shoot lead or designated lead coverage can submit Ready to Shoot.";
  }
  if (!readyToShoot.actor_on_site) {
    return "You need to be clocked in or otherwise marked on site before this action is available.";
  }
  return readyToShoot.missing_items[0] ?? "Clear the open issues before confirming this shoot.";
}

function formatReadyToShootConfirmedLabel(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return `Confirmed ${parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function getLatestPunch(
  punches: Array<{
    direction: "in" | "out";
    client_timestamp: string;
    geofence_status: string;
    gps_confidence: string;
    approval_state: string;
    timing_status?: string | null;
  }>
) {
  if (!punches.length) {
    return null;
  }
  return [...punches].sort((left, right) => new Date(left.client_timestamp).getTime() - new Date(right.client_timestamp).getTime())[punches.length - 1];
}

function getShiftWorkflowState(shift: EmployeeShiftDetailResponse["shift"]) {
  const latestPunch = getLatestPunch(shift.punches);
  const reviewNote = latestPunch ? getPunchReviewNote(latestPunch) : null;

  if (shift.attendance_state === "no_show_suspected") {
    return {
      primaryActionKind: "missed_punch" as const,
      primaryDirection: "in" as const,
      primaryMissingDirection: "in" as const,
      primaryActionLabel: "Request Missed Clock-In",
      statusTitle: "No-show suspected",
      statusDetail: shift.attendance_state_note ?? "This shift now needs a correction request instead of a normal clock-in.",
      workflowHint: "Use an exception note or missed-punch request so leadership can review the timeline cleanly.",
      reviewNote
    };
  }

  if (shift.attendance_state === "missed_clock_in") {
    return {
      primaryActionKind: "missed_punch" as const,
      primaryDirection: "in" as const,
      primaryMissingDirection: "in" as const,
      primaryActionLabel: "Request Missed Clock-In",
      statusTitle: "Missed clock-in workflow required",
      statusDetail: shift.attendance_state_note ?? "This shift moved past the normal late window.",
      workflowHint: "Use an exception request instead of adding a late clock-in.",
      reviewNote
    };
  }

  if (!latestPunch) {
    return {
      primaryActionKind: "clock" as const,
      primaryDirection: "in" as const,
      primaryMissingDirection: null,
      primaryActionLabel: "Clock In",
      statusTitle: "Ready to clock in",
      statusDetail: `Scheduled for ${formatShiftWindow(shift.starts_at, shift.ends_at)}.`,
      workflowHint: "Clock in when you arrive. If work already started, use an exception note instead.",
      reviewNote
    };
  }

  if (latestPunch.direction === "in") {
    return {
      primaryActionKind: "clock" as const,
      primaryDirection: "out" as const,
      primaryMissingDirection: null,
      primaryActionLabel: "Clock Out",
      statusTitle: "Currently clocked in",
      statusDetail: `Clocked in at ${new Date(latestPunch.client_timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`,
      workflowHint: "Clock out when you wrap the shift.",
      reviewNote
    };
  }

  return {
    primaryActionKind: "clock" as const,
    primaryDirection: "in" as const,
    primaryMissingDirection: null,
    primaryActionLabel: "Clock In Again",
    statusTitle: "Last punch was a clock-out",
    statusDetail: `Clocked out at ${new Date(latestPunch.client_timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`,
    workflowHint: "If that clock-out was final, leave it as-is. If not, send an exception note instead of extra punches.",
    reviewNote
  };
}

function getPunchReviewNote(punch: {
  geofence_status: string;
  gps_confidence: string;
  approval_state: string;
}) {
  if (punch.approval_state === "pending") {
    return "Waiting for review.";
  }
  if (punch.geofence_status === "outside") {
    return "Outside expected location.";
  }
  if (punch.geofence_status === "unknown") {
    return "Location could not be confirmed.";
  }
  if (punch.gps_confidence === "low_confidence") {
    return "GPS was borderline near the site edge.";
  }
  return null;
}

function formatShiftWindow(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (start.toDateString() === end.toDateString()) {
    return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} | ${start.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    })} - ${end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  return `${start.toLocaleString()} - ${end.toLocaleString()}`;
}

function humanizeLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function humanizeCloseoutItem(value: "setup_photo" | "post_shoot_evaluation") {
  return value === "setup_photo" ? "Setup photo" : "Post-Shoot Eval";
}

function mapLegacyStatusToOutcome(
  value: "successful" | "completed_with_issues" | "significant_issue" | null | undefined
): CloseoutDraft["overall_outcome"] {
  if (value === "successful") {
    return "smooth";
  }
  if (value === "completed_with_issues") {
    return "minor_issues";
  }
  if (value === "significant_issue") {
    return "major_issues";
  }
  return "";
}

function mapOutcomeToLegacyStatus(
  value: CloseoutDraft["overall_outcome"] | null
): "successful" | "completed_with_issues" | "significant_issue" | null {
  if (value === "smooth") {
    return "successful";
  }
  if (value === "minor_issues") {
    return "completed_with_issues";
  }
  if (value === "major_issues" || value === "needs_leadership_review") {
    return "significant_issue";
  }
  return null;
}

function formatEvalOutcome(
  outcome: "smooth" | "minor_issues" | "major_issues" | "needs_leadership_review" | null,
  legacyStatus: "successful" | "completed_with_issues" | "significant_issue" | null
) {
  const normalized = outcome ?? mapLegacyStatusToOutcome(legacyStatus);
  if (normalized === "smooth") {
    return "Smooth";
  }
  if (normalized === "minor_issues") {
    return "Minor Issues";
  }
  if (normalized === "needs_leadership_review") {
    return "Needs Leadership Review";
  }
  return "Major Issues";
}

function describeEvalState(
  value: "not_started" | "draft" | "submitted" | "reviewed" | "closed" | null | undefined
) {
  if (!value || value === "not_started") {
    return "Not started";
  }
  return humanizeLabel(value);
}

function describeSetupPhotoState(
  value: "not_required" | "required" | "submitted" | "reviewed" | "added_to_memory" | null | undefined
) {
  switch (value) {
    case undefined:
    case null:
    case "not_required":
      return "Not required";
    case "required":
      return "Still needed";
    case "submitted":
      return "Submitted";
    case "reviewed":
      return "Reviewed";
    default:
      return "Added to memory";
  }
}

function buildEvalTimestampSummary(
  evaluation: NonNullable<NonNullable<EmployeeShiftDetailResponse["closeout_compliance"]>["last_post_shoot_evaluation"]>
) {
  if (evaluation.closed_at) {
    return `Closed ${new Date(evaluation.closed_at).toLocaleString()}`;
  }
  if (evaluation.reviewed_at) {
    return `Reviewed ${new Date(evaluation.reviewed_at).toLocaleString()}`;
  }
  if (evaluation.submitted_at) {
    return `Submitted ${new Date(evaluation.submitted_at).toLocaleString()}`;
  }
  return "Draft in progress";
}

function parseOptionalInteger(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}

function buildCloseoutDraft(detail: EmployeeShiftDetailResponse): CloseoutDraft {
  const previous = detail.closeout_compliance?.last_post_shoot_evaluation;
  return {
    overall_outcome: previous?.overall_outcome ?? mapLegacyStatusToOutcome(previous?.overall_shoot_status),
    staffing_fit: previous?.staffing_fit ?? "",
    setup_difficulty: previous?.setup_difficulty ?? "",
    customer_school_readiness: previous?.customer_school_readiness ?? "",
    data_roster_readiness: previous?.data_roster_readiness ?? "",
    equipment_workflow_issue: previous?.equipment_workflow_issue ?? "",
    started_on_time: previous?.started_on_time ?? null,
    short_summary_note: previous?.short_summary_note ?? "",
    next_time_recommendation: previous?.next_time_recommendation ?? "",
    follow_up_required: previous?.follow_up_required ?? previous?.issue_flag ?? false,
    major_issue_flag: previous?.major_issue_flag ?? false,
    location_memory_update_suggested: previous?.location_memory_update_suggested ?? false,
    leadership_review_needed: previous?.leadership_review_needed ?? false,
    issue_category: previous?.issue_category ?? null,
    understaffed_role: previous?.understaffed_role ?? "",
    staffing_change_recommendation: previous?.staffing_change_recommendation ?? "",
    customer_follow_up_needed: previous?.customer_follow_up_needed ?? false,
    recommended_staffing_next_time: previous?.recommended_staffing_next_time ? String(previous.recommended_staffing_next_time) : "",
    recommended_arrival_buffer_minutes: previous?.recommended_arrival_buffer_minutes ? String(previous.recommended_arrival_buffer_minutes) : "",
    recommended_room_setup_change: previous?.recommended_room_setup_change ?? "",
    special_gear_needed_next_time: previous?.special_gear_needed_next_time ?? "",
    top_watch_out: previous?.top_watch_out ?? "",
    location_memory_promotion_text: previous?.location_memory_promotion_text ?? "",
    went_well: previous?.went_well ?? "",
    remember_next_time: previous?.remember_next_time ?? "",
    issue_flag: previous?.issue_flag ?? false,
    open_comment: previous?.open_comment ?? "",
    submit_for_mileage: previous?.submit_for_mileage ?? false,
    vehicle_type: previous?.vehicle_type ?? null
  };
}

function buildCloseoutSectionSummary(detail: EmployeeShiftDetailResponse) {
  const compliance = detail.closeout_compliance;
  if (!compliance) {
    return "Post-shoot eval appears here when this assignment is tied to a shoot.";
  }
  if (compliance.post_shoot_evaluation_state === "closed") {
    return "This eval is closed. Managers can still review the follow-up, location memory suggestions, and setup photo state.";
  }
  if (compliance.post_shoot_evaluation_state === "reviewed" || compliance.post_shoot_evaluation_submitted) {
    return "This shoot already has a submitted eval. Review the outcome, memory suggestions, and any open follow-up below.";
  }
  if (compliance.missing_required_items.length) {
    return "Finish the eval before the day slips into tribal knowledge. Missing items stay visible for manager review.";
  }
  return "Keep it short and operational: what happened, what should change next time, and what future crews should remember.";
}

function buildLocationMemorySectionSummary(detail: EmployeeShiftDetailResponse) {
  const summary = detail.location_context.location_memory_summary;
  if (summary?.top_watch_out) {
    return `Future crews will see ${summary.top_watch_out.toLowerCase()}`;
  }
  if (summary?.last_confirmed_at) {
    return `Reusable location guidance was last confirmed ${new Date(summary.last_confirmed_at).toLocaleDateString()}.`;
  }
  if (detail.location_context.location_memory_highlights?.length) {
    return "Crew-tested location notes are available for this assignment.";
  }
  return "Reusable location guidance is still thin here. Use setup photos and the post-shoot eval to improve the next visit.";
}

function buildMileageHeadline(compliance: NonNullable<EmployeeShiftDetailResponse["closeout_compliance"]>) {
  const reimbursement = compliance.mileage_reimbursement;
  if (!reimbursement || reimbursement.status === "not_applicable") {
    return "Not submitted";
  }
  if (reimbursement.status === "candidate") {
    return "Candidate";
  }
  if (reimbursement.status === "review_required") {
    return "Needs review";
  }
  if (reimbursement.status === "approved") {
    return "Approved";
  }
  if (reimbursement.status === "ineligible") {
    return "Not eligible";
  }
  if (reimbursement.status === "exported") {
    return "Exported";
  }
  if (reimbursement.status === "cancelled") {
    return "Cancelled";
  }
  return humanizeLabel(reimbursement.status);
}

function getDefaultDetailTab(detail: EmployeeShiftDetailResponse): EmployeeDetailTab {
  if (
    detail.shift.attendance_state === "no_show_suspected" ||
    detail.shift.attendance_state === "missed_clock_in" ||
    detail.shift.attendance_state === "missed_clock_out" ||
    detail.exceptions.length > 0
  ) {
    return "exceptions";
  }

  if (detail.closeout_compliance && (detail.closeout_compliance.missing_required_items.length || !detail.closeout_compliance.post_shoot_evaluation_submitted)) {
    return "closeout";
  }

  return "execute";
}

function buildDefaultCorrectedTime(
  shift: Pick<EmployeeShiftDetailResponse["shift"], "starts_at" | "ends_at">,
  direction: "in" | "out"
) {
  const source = direction === "in" ? shift.starts_at : shift.ends_at;
  const date = new Date(source);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}
