export type JobCalendarReadinessTone = "neutral" | "info" | "success" | "warning" | "danger";

export type JobCalendarReadinessStatus =
  | "needs_date"
  | "date_requested"
  | "date_conflict"
  | "ready_for_calendar"
  | "calendar_confirmed"
  | "staffing_needed"
  | "shoot_manager_needed"
  | "shoot_manager_assigned";

export type JobCalendarReadinessInput = {
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  dateOnly?: boolean | null;
  locationId?: string | null;
  contactId?: string | null;
  primaryLocationName?: string | null;
  primaryContactName?: string | null;
  staffingStatus?: string | null;
  readinessStatus?: string | null;
  riskStatus?: string | null;
  jobStatus?: string | null;
  blockerCount?: number | null;
  openWatchFlagCount?: number | null;
  leadOwnerName?: string | null;
  accountOwnerName?: string | null;
  estimatedStaffCount?: number | string | null;
};

export type JobCalendarReadiness = {
  status: JobCalendarReadinessStatus;
  label: string;
  tone: JobCalendarReadinessTone;
  summary: string;
  nextAction: string;
  ownerLabel: string;
  scheduleLabel: string;
  staffingLabel: string;
};

function hasValue(value: string | null | undefined) {
  return Boolean(value && value.trim());
}

function hasStaffEstimate(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return value > 0;
  }
  return hasValue(value);
}

function isConfirmedStatus(value: string | null | undefined) {
  return [
    "confirmed",
    "ready_to_staff",
    "staffed",
    "ready_to_execute",
    "in_progress",
    "execution_complete"
  ].includes(value ?? "");
}

function needsStaffing(value: string | null | undefined) {
  return ["gap_flagged", "unassigned", "partially_staffed"].includes(value ?? "");
}

export function buildJobCalendarReadiness(input: JobCalendarReadinessInput): JobCalendarReadiness {
  const hasDate = hasValue(input.date);
  const hasLocation = hasValue(input.locationId) || hasValue(input.primaryLocationName);
  const hasContact = hasValue(input.contactId) || hasValue(input.primaryContactName);
  const hasOwner = hasValue(input.leadOwnerName) || hasValue(input.accountOwnerName);
  const hasConflictSignal =
    (input.blockerCount ?? 0) > 0 ||
    (input.openWatchFlagCount ?? 0) > 0 ||
    input.readinessStatus === "off_track" ||
    input.readinessStatus === "at_risk" ||
    input.riskStatus === "high" ||
    input.riskStatus === "critical";

  const ownerLabel = hasOwner
    ? input.leadOwnerName ?? input.accountOwnerName ?? "Shoot manager assigned"
    : "Shoot manager needed";
  const scheduleLabel = hasDate
    ? input.dateOnly || !hasValue(input.startTime)
      ? "Date requested"
      : [input.startTime, input.endTime].filter(Boolean).join(" - ")
    : "Needs date";
  const staffingLabel = hasOwner
    ? "Shoot manager assigned"
    : hasStaffEstimate(input.estimatedStaffCount) || needsStaffing(input.staffingStatus)
      ? "Staffing needed"
      : "Shoot manager needed";

  if (!hasDate) {
    return {
      status: "needs_date",
      label: "Needs date",
      tone: "warning",
      summary: "Choose the shoot date before this job can be placed on the calendar.",
      nextAction: "Set the requested shoot date.",
      ownerLabel,
      scheduleLabel,
      staffingLabel
    };
  }

  if (hasConflictSignal) {
    return {
      status: "date_conflict",
      label: "Date conflict",
      tone: "danger",
      summary: "Scheduling needs review before calendar confirmation.",
      nextAction: "Resolve the schedule, readiness, or blocker signal.",
      ownerLabel,
      scheduleLabel,
      staffingLabel
    };
  }

  if (needsStaffing(input.staffingStatus) && !hasOwner) {
    return {
      status: "shoot_manager_needed",
      label: "Shoot manager needed",
      tone: "warning",
      summary: "The date is known, but the job still needs a lead before calendar confidence is high.",
      nextAction: "Assign the shoot manager.",
      ownerLabel,
      scheduleLabel,
      staffingLabel
    };
  }

  if (needsStaffing(input.staffingStatus)) {
    return {
      status: "staffing_needed",
      label: "Staffing needed",
      tone: "warning",
      summary: "The job has a date and owner, but staffing still needs confirmation.",
      nextAction: "Confirm staffing for the shoot.",
      ownerLabel,
      scheduleLabel,
      staffingLabel
    };
  }

  if (input.dateOnly || !hasValue(input.startTime)) {
    return {
      status: "date_requested",
      label: "Date requested",
      tone: "info",
      summary: "The date is captured, but call time is not final yet.",
      nextAction: "Confirm the start time and expected end time.",
      ownerLabel,
      scheduleLabel,
      staffingLabel
    };
  }

  if (isConfirmedStatus(input.jobStatus) && hasLocation && hasContact) {
    return {
      status: "calendar_confirmed",
      label: "Calendar confirmed",
      tone: "success",
      summary: "Calendar date, time, location, contact, and owner are ready for operations.",
      nextAction: "Keep staffing and prep details current.",
      ownerLabel,
      scheduleLabel,
      staffingLabel
    };
  }

  if (hasLocation && hasContact) {
    return {
      status: "ready_for_calendar",
      label: "Ready for calendar",
      tone: "success",
      summary: "Enough schedule detail exists for calendar review.",
      nextAction: "Review and confirm the calendar placement.",
      ownerLabel,
      scheduleLabel,
      staffingLabel
    };
  }

  return {
    status: "ready_for_calendar",
    label: "Ready for calendar",
    tone: "info",
    summary: "The date and time are present, but location or contact details still need a final check.",
    nextAction: "Confirm location and client contact before final calendar confidence.",
    ownerLabel,
    scheduleLabel,
    staffingLabel
  };
}
