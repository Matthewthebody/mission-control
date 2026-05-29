import type { AttendanceState } from "../types/domain.js";
import type { TimeSessionStatus } from "../types/timeClock.js";

export type TimeRecordState =
  | "not_started"
  | "clocked_in"
  | "clocked_out"
  | "missing_clock_in"
  | "missing_clock_out"
  | "pending_review"
  | "corrected"
  | "excused_exception"
  | "finalized";

export type TimeRecordCorrectionState =
  | "none"
  | "requested"
  | "corrected"
  | "excused_exception"
  | "rejected"
  | "finalized";

export type TimeRecordFinalizationState = "open_for_review" | "nearing_finalization" | "finalized";

export type TimeRecordLocationState =
  | "valid_on_site"
  | "near_site"
  | "wrong_location"
  | "outside_allowed_zone"
  | "pending_location_review"
  | "manager_override_accepted";

export type TimeReviewPriority = "critical" | "high" | "medium" | "low";

export type TimeReviewSummary = {
  timeRecordState: TimeRecordState;
  timeRecordStateLabel: string;
  correctionState: TimeRecordCorrectionState;
  correctionStateLabel: string;
  finalizationState: TimeRecordFinalizationState;
  finalizationStateLabel: string;
  locationState: TimeRecordLocationState | null;
  locationStateLabel: string | null;
  reviewPriority: TimeReviewPriority;
  reviewPriorityLabel: string;
  nearingFinalization: boolean;
};

export type TimeReviewSummaryInput = {
  shiftEndsAt?: string | null;
  exceptionStatus?: string | null;
  exceptionSeverity?: string | null;
  exceptionType?: string | null;
  exceptionClassification?: string | null;
  shiftAttendanceState?: AttendanceState | null;
  timeEntryAttendanceState?: AttendanceState | null;
  clockInAt?: string | null;
  clockOutAt?: string | null;
  latestPunchDirection?: "in" | "out" | null;
  latestPunchApprovalState?: string | null;
  latestPunchGeofenceStatus?: string | null;
  timeClockRequestStatus?: string | null;
  timeSessionStatus?: TimeSessionStatus | null;
};

const TIME_RECORD_STATE_LABELS: Record<TimeRecordState, string> = {
  not_started: "Not Started",
  clocked_in: "Clocked In",
  clocked_out: "Clocked Out",
  missing_clock_in: "Missing Clock-In",
  missing_clock_out: "Missing Clock-Out",
  pending_review: "Pending Review",
  corrected: "Corrected",
  excused_exception: "Excused Exception",
  finalized: "Finalized"
};

const CORRECTION_STATE_LABELS: Record<TimeRecordCorrectionState, string> = {
  none: "No Correction",
  requested: "Correction Requested",
  corrected: "Corrected",
  excused_exception: "Excused Exception",
  rejected: "Rejected",
  finalized: "Finalized"
};

const FINALIZATION_STATE_LABELS: Record<TimeRecordFinalizationState, string> = {
  open_for_review: "Open For Review",
  nearing_finalization: "Nearing Finalization",
  finalized: "Finalized"
};

const LOCATION_STATE_LABELS: Record<TimeRecordLocationState, string> = {
  valid_on_site: "Valid On-Site",
  near_site: "Near Site",
  wrong_location: "Wrong Location",
  outside_allowed_zone: "Outside Allowed Zone",
  pending_location_review: "Pending Location Review",
  manager_override_accepted: "Manager Override Accepted"
};

const REVIEW_PRIORITY_LABELS: Record<TimeReviewPriority, string> = {
  critical: "Critical Review",
  high: "High Review",
  medium: "Manager Review",
  low: "Low Review"
};

function isApprovedOrFinalizedStatus(status: string | null | undefined) {
  return status === "approved" || status === "resolved";
}

export function isFinalizedTimeSessionStatus(status: TimeSessionStatus | null | undefined) {
  return status === "approved" || status === "payroll_exported";
}

function deriveLocationState(input: TimeReviewSummaryInput): TimeRecordLocationState | null {
  const classification = input.exceptionClassification ?? null;

  if (classification === "manual_override") {
    return "manager_override_accepted";
  }
  if (classification === "wrong_location") {
    return "wrong_location";
  }
  if (classification === "outside_allowed_zone") {
    return "outside_allowed_zone";
  }
  if (classification === "near_site") {
    return "near_site";
  }
  if (classification === "clock_in_pending_location_review") {
    return "pending_location_review";
  }
  if (input.latestPunchApprovalState === "approved" && input.latestPunchGeofenceStatus === "outside") {
    return "manager_override_accepted";
  }
  if (input.latestPunchGeofenceStatus === "inside") {
    return "valid_on_site";
  }
  if (input.latestPunchGeofenceStatus === "outside") {
    return "outside_allowed_zone";
  }
  if (input.latestPunchGeofenceStatus === "unknown") {
    return "pending_location_review";
  }
  return null;
}

function deriveFinalizationState(input: TimeReviewSummaryInput): TimeRecordFinalizationState {
  if (isFinalizedTimeSessionStatus(input.timeSessionStatus)) {
    return "finalized";
  }

  if (input.shiftEndsAt && input.exceptionStatus === "open") {
    const shiftEnd = new Date(input.shiftEndsAt).getTime();
    if (Number.isFinite(shiftEnd) && Date.now() - shiftEnd >= 12 * 60 * 60 * 1000) {
      return "nearing_finalization";
    }
  }

  return "open_for_review";
}

function deriveCorrectionState(
  input: TimeReviewSummaryInput,
  finalizationState: TimeRecordFinalizationState
): TimeRecordCorrectionState {
  if (finalizationState === "finalized") {
    return "finalized";
  }

  if (input.exceptionStatus === "rejected" || input.timeClockRequestStatus === "rejected") {
    return "rejected";
  }

  if (input.exceptionClassification === "excused_exception") {
    return "excused_exception";
  }

  if (
    isApprovedOrFinalizedStatus(input.exceptionStatus) ||
    input.shiftAttendanceState === "corrected" ||
    input.timeEntryAttendanceState === "corrected"
  ) {
    return "corrected";
  }

  if (
    input.exceptionStatus === "open" ||
    input.timeClockRequestStatus === "submitted" ||
    input.timeClockRequestStatus === "under_review"
  ) {
    return "requested";
  }

  return "none";
}

function deriveTimeRecordState(
  input: TimeReviewSummaryInput,
  finalizationState: TimeRecordFinalizationState,
  correctionState: TimeRecordCorrectionState
): TimeRecordState {
  if (finalizationState === "finalized") {
    return "finalized";
  }

  if (correctionState === "excused_exception") {
    return "excused_exception";
  }

  if (correctionState === "corrected") {
    return "corrected";
  }

  if (input.timeEntryAttendanceState === "missed_clock_out" || input.shiftAttendanceState === "missed_clock_out") {
    return "missing_clock_out";
  }

  if (
    input.timeEntryAttendanceState === "missed_clock_in" ||
    input.shiftAttendanceState === "missed_clock_in" ||
    input.shiftAttendanceState === "no_show_suspected"
  ) {
    return "missing_clock_in";
  }

  if (input.clockOutAt || input.latestPunchDirection === "out") {
    return "clocked_out";
  }

  if (input.clockInAt || input.latestPunchDirection === "in") {
    return "clocked_in";
  }

  if (
    input.exceptionStatus === "open" ||
    input.timeClockRequestStatus === "submitted" ||
    input.timeClockRequestStatus === "under_review" ||
    input.latestPunchApprovalState === "pending_review" ||
    input.timeSessionStatus === "needs_end_of_day_confirmation"
  ) {
    return "pending_review";
  }

  return "not_started";
}

function deriveReviewPriority(
  input: TimeReviewSummaryInput,
  timeRecordState: TimeRecordState,
  finalizationState: TimeRecordFinalizationState,
  locationState: TimeRecordLocationState | null
): TimeReviewPriority {
  const severity = input.exceptionSeverity ?? null;
  const isProbableNoShow = input.shiftAttendanceState === "no_show_suspected";
  const isWrongLocation = locationState === "wrong_location";

  if (isProbableNoShow || severity === "critical") {
    return "critical";
  }

  if (
    timeRecordState === "missing_clock_in" ||
    timeRecordState === "missing_clock_out" ||
    finalizationState === "nearing_finalization" ||
    isWrongLocation ||
    severity === "high"
  ) {
    return "high";
  }

  if (timeRecordState === "pending_review" || locationState === "pending_location_review") {
    return "medium";
  }

  return "low";
}

export function deriveTimeReviewSummary(input: TimeReviewSummaryInput): TimeReviewSummary {
  const finalizationState = deriveFinalizationState(input);
  const correctionState = deriveCorrectionState(input, finalizationState);
  const timeRecordState = deriveTimeRecordState(input, finalizationState, correctionState);
  const locationState = deriveLocationState(input);
  const reviewPriority = deriveReviewPriority(input, timeRecordState, finalizationState, locationState);

  return {
    timeRecordState,
    timeRecordStateLabel: TIME_RECORD_STATE_LABELS[timeRecordState],
    correctionState,
    correctionStateLabel: CORRECTION_STATE_LABELS[correctionState],
    finalizationState,
    finalizationStateLabel: FINALIZATION_STATE_LABELS[finalizationState],
    locationState,
    locationStateLabel: locationState ? LOCATION_STATE_LABELS[locationState] : null,
    reviewPriority,
    reviewPriorityLabel: REVIEW_PRIORITY_LABELS[reviewPriority],
    nearingFinalization: finalizationState === "nearing_finalization"
  };
}
