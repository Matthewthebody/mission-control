export type OperationalAttendanceState =
  | "on_time"
  | "early"
  | "grace_window"
  | "late"
  | "critically_late"
  | "missing_clock_in"
  | "wrong_location"
  | "probable_no_show"
  | "excused_exception"
  | "corrected_after_review";

export type OperationalAttendanceSeverity = "low" | "medium" | "high" | "critical";

export type OperationalLocationClassification =
  | "valid_on_site"
  | "near_site"
  | "wrong_location"
  | "outside_allowed_zone"
  | "manual_override"
  | "clock_in_pending_location_review";

export const ATTENDANCE_AWARENESS_POLICY = {
  standardEarlyClockInMinutes: 30,
  leadSetupEarlyClockInMinutes: 45,
  graceWindowMinutes: 5,
  lateThresholdMinutes: 6,
  criticalLateThresholdMinutes: 16,
  probableNoShowMinutes: 20,
  validOnSiteFeet: 500,
  nearSiteFeet: 1000
} as const;

export function feetToMeters(value: number) {
  return value * 0.3048;
}

export function metersToFeet(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value / 0.3048;
}

export function getValidOnSiteMeters() {
  return feetToMeters(ATTENDANCE_AWARENESS_POLICY.validOnSiteFeet);
}

export function getNearSiteMeters() {
  return feetToMeters(ATTENDANCE_AWARENESS_POLICY.nearSiteFeet);
}

export function normalizeStaffingRole(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export function isLeadOrSetupRole(input: {
  staffingRole?: string | null;
  satisfiesLeadCoverage?: boolean | null;
}) {
  const staffingRole = normalizeStaffingRole(input.staffingRole);
  if (input.satisfiesLeadCoverage) {
    return true;
  }
  return ["lead_photographer", "senior_photographer", "check_in", "producer"].includes(staffingRole);
}

export function getAllowedEarlyClockInMinutes(input: {
  staffingRole?: string | null;
  satisfiesLeadCoverage?: boolean | null;
}) {
  return isLeadOrSetupRole(input)
    ? ATTENDANCE_AWARENESS_POLICY.leadSetupEarlyClockInMinutes
    : ATTENDANCE_AWARENESS_POLICY.standardEarlyClockInMinutes;
}

export function classifyOperationalPunchTiming(input: {
  direction: "in" | "out";
  earlyMinutes: number;
  lateMinutes: number;
}) {
  if (input.direction === "out") {
    return "on_time" as const;
  }
  if (input.earlyMinutes > 0) {
    return "early" as const;
  }
  if (input.lateMinutes >= ATTENDANCE_AWARENESS_POLICY.criticalLateThresholdMinutes) {
    return "critically_late" as const;
  }
  if (input.lateMinutes >= ATTENDANCE_AWARENESS_POLICY.lateThresholdMinutes) {
    return "late" as const;
  }
  if (input.lateMinutes > 0) {
    return "grace_window" as const;
  }
  return "on_time" as const;
}

export function classifyMissingClockInState(minutesPastStart: number) {
  if (minutesPastStart >= ATTENDANCE_AWARENESS_POLICY.probableNoShowMinutes) {
    return "probable_no_show" as const;
  }
  if (minutesPastStart >= ATTENDANCE_AWARENESS_POLICY.criticalLateThresholdMinutes) {
    return "critically_late" as const;
  }
  if (minutesPastStart >= ATTENDANCE_AWARENESS_POLICY.lateThresholdMinutes) {
    return "late" as const;
  }
  return "missing_clock_in" as const;
}

export function classifyOperationalLocation(input: {
  distanceMeters: number | null;
  hasCapturedLocation: boolean;
  isAssignedContext?: boolean;
  manualOverride?: boolean;
  lowConfidenceInside?: boolean;
}) {
  if (input.manualOverride) {
    return "manual_override" as const;
  }
  if (!input.hasCapturedLocation || input.distanceMeters == null) {
    return "clock_in_pending_location_review" as const;
  }
  if (input.distanceMeters <= getValidOnSiteMeters()) {
    return "valid_on_site" as const;
  }
  if (input.lowConfidenceInside || input.distanceMeters <= getNearSiteMeters()) {
    return "near_site" as const;
  }
  if (input.isAssignedContext) {
    return "wrong_location" as const;
  }
  return "outside_allowed_zone" as const;
}

export function isOperationalAttendanceState(value: string | null | undefined): value is OperationalAttendanceState {
  return [
    "on_time",
    "early",
    "grace_window",
    "late",
    "critically_late",
    "missing_clock_in",
    "wrong_location",
    "probable_no_show",
    "excused_exception",
    "corrected_after_review"
  ].includes(String(value ?? ""));
}

export function isRoleWeightedAttendanceIssue(input: {
  staffingRole?: string | null;
  satisfiesLeadCoverage?: boolean | null;
  onlyPhotographerAtLocation?: boolean | null;
  minimumStaffingRole?: boolean | null;
}) {
  return Boolean(
    isLeadOrSetupRole(input) ||
      input.onlyPhotographerAtLocation ||
      input.minimumStaffingRole
  );
}

function severityWeight(value: OperationalAttendanceSeverity) {
  if (value === "critical") {
    return 4;
  }
  if (value === "high") {
    return 3;
  }
  if (value === "medium") {
    return 2;
  }
  return 1;
}

function severityFromWeight(value: number): OperationalAttendanceSeverity {
  if (value >= 4) {
    return "critical";
  }
  if (value === 3) {
    return "high";
  }
  if (value === 2) {
    return "medium";
  }
  return "low";
}

export function classifyOperationalSeverity(input: {
  state: OperationalAttendanceState;
  locationClassification?: OperationalLocationClassification | null;
  roleWeighted?: boolean;
  staffingRisk?: boolean;
  bigShoot?: boolean;
  criticalShoot?: boolean;
}) {
  let base: OperationalAttendanceSeverity;
  switch (input.state) {
    case "grace_window":
    case "early":
      base = "low";
      break;
    case "late":
    case "missing_clock_in":
      base = "medium";
      break;
    case "critically_late":
    case "wrong_location":
      base = "high";
      break;
    case "probable_no_show":
      base = "critical";
      break;
    case "excused_exception":
    case "corrected_after_review":
    case "on_time":
    default:
      base = "low";
      break;
  }

  if (input.locationClassification === "near_site" || input.locationClassification === "clock_in_pending_location_review") {
    base = base === "low" ? "low" : "medium";
  }
  if (input.locationClassification === "wrong_location" || input.locationClassification === "outside_allowed_zone") {
    base = base === "critical" ? "critical" : "high";
  }

  let weight = severityWeight(base);
  if (input.roleWeighted || input.staffingRisk) {
    weight += 1;
  }
  if (input.bigShoot && weight < 3) {
    weight += 1;
  }
  if (input.criticalShoot) {
    weight += 1;
  }
  return severityFromWeight(Math.min(weight, 4));
}

export function humanizeOperationalAttendanceState(value: OperationalAttendanceState) {
  switch (value) {
    case "on_time":
      return "On Time";
    case "early":
      return "Early";
    case "grace_window":
      return "Grace Window";
    case "late":
      return "Late";
    case "critically_late":
      return "Critically Late";
    case "missing_clock_in":
      return "Missing Clock-In";
    case "wrong_location":
      return "Wrong Location";
    case "probable_no_show":
      return "Probable No-Show";
    case "excused_exception":
      return "Excused Exception";
    case "corrected_after_review":
      return "Corrected After Review";
    default:
      return "Attendance Issue";
  }
}

export function humanizeOperationalLocation(value: OperationalLocationClassification) {
  switch (value) {
    case "valid_on_site":
      return "Valid On-Site";
    case "near_site":
      return "Near Site";
    case "wrong_location":
      return "Wrong Location";
    case "outside_allowed_zone":
      return "Outside Allowed Zone";
    case "manual_override":
      return "Manual Override";
    case "clock_in_pending_location_review":
      return "Clock-In Pending Location Review";
    default:
      return "Location Review Needed";
  }
}

export function operationalSeverityLabel(value: OperationalAttendanceSeverity) {
  switch (value) {
    case "critical":
      return "Critical";
    case "high":
      return "High";
    case "medium":
      return "Medium";
    default:
      return "Low";
  }
}
