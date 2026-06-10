import type { SharedJobDetailResponse, SharedJobListItem } from "./jobTruthTypes";
import type { UnifiedScheduleShootItem } from "./types";

export type DetailsConfirmationState = "needs_details" | "partial" | "confirmation_due" | "confirmed" | "reconfirm";
export type DetailsConfirmationTone = "neutral" | "info" | "success" | "warning" | "danger";

export type DetailsConfirmationRecord = {
  confirmedAt: string;
  confirmedByName: string;
  note?: string | null;
};

export type DetailsConfirmationCue = {
  state: DetailsConfirmationState;
  label: "Needs details" | "Partial" | "Confirm" | "Confirmed" | "Reconfirm";
  marker: "open" | "partial" | "due" | "confirmed" | "reconfirm";
  tone: DetailsConfirmationTone;
  summary: string;
  ownerLabel: string;
  nextAction: string;
  missingLabels: string[];
  missingCount: number;
  confirmationDueDate: string | null;
  finalDueDate: string | null;
  confirmedAt: string | null;
  confirmedByName: string | null;
};

type DetailsConfirmationInput = {
  shootDate: string | null | undefined;
  startTime?: string | null;
  endTime?: string | null;
  organizationName?: string | null;
  locationName?: string | null;
  contactName?: string | null;
  ownerName?: string | null;
  departmentType?: string | null;
  jobCategory?: string | null;
  estimatedStaffCount?: number | null;
  assignedStaffCount?: number | null;
  missingFields?: string[];
  readinessStatus?: string | null;
  staffingStatus?: string | null;
  jobStatus?: string | null;
  riskStatus?: string | null;
  notesPresent?: boolean;
  sportsSetupPresent?: boolean;
  confirmed?: DetailsConfirmationRecord | null;
  updatedAt?: string | null;
  referenceDate?: Date;
};

const DAY_MS = 86_400_000;

export function detailsConfirmationChipLabel(cue: DetailsConfirmationCue) {
  return cue.label;
}

export function buildDetailsConfirmationFromJobDetail(
  detail: SharedJobDetailResponse,
  confirmed?: DetailsConfirmationRecord | null,
  referenceDate = new Date()
): DetailsConfirmationCue {
  const primaryDay = detail.days[0] ?? null;
  return buildDetailsConfirmationCue({
    shootDate: detail.summary.primary_day_date ?? detail.job.scheduled_start_at?.slice(0, 10) ?? primaryDay?.date ?? null,
    startTime: detail.summary.primary_day_start_time ?? detail.job.scheduled_start_at?.slice(11, 16) ?? primaryDay?.start_time ?? null,
    endTime: detail.summary.primary_day_end_time ?? detail.job.scheduled_end_at?.slice(11, 16) ?? primaryDay?.end_time ?? null,
    organizationName: detail.summary.organization_name,
    locationName: detail.summary.primary_location_name ?? primaryDay?.location_name,
    contactName: detail.summary.primary_contact_name ?? primaryDay?.onsite_contact_name,
    ownerName: detail.summary.account_owner_name ?? detail.summary.lead_owner_name ?? primaryDay?.lead_user_name,
    departmentType: detail.job.department_type,
    jobCategory: detail.job.job_category,
    estimatedStaffCount: detail.job.estimated_staff_count,
    assignedStaffCount: detail.staff_assignments.length,
    missingFields: [
      ...detail.readiness_items.filter((item) => item.is_required && !item.is_complete).map((item) => item.label),
      ...detail.days
        .flatMap((day) => [day.access_notes ? null : "Access notes", day.parking_notes ? null : "Parking notes"])
        .filter((value): value is string => Boolean(value))
    ],
    readinessStatus: detail.status.readiness_status,
    staffingStatus: detail.status.staffing_status,
    jobStatus: detail.status.job_status,
    riskStatus: detail.status.risk_status,
    notesPresent: Boolean(detail.job.description_internal || detail.school_profile?.special_instructions || detail.sports_profile?.client_expectations_notes),
    sportsSetupPresent: Boolean(primaryDay?.indoor_outdoor || detail.sports_profile?.team_structure || detail.sports_profile?.sport_type),
    confirmed,
    updatedAt: detail.job.updated_at,
    referenceDate
  });
}

export function buildDetailsConfirmationFromJobListItem(item: SharedJobListItem, referenceDate = new Date()): DetailsConfirmationCue {
  return buildDetailsConfirmationCue({
    shootDate: item.primary_day_date ?? item.scheduled_start_at?.slice(0, 10),
    startTime: item.primary_day_start_time ?? item.scheduled_start_at?.slice(11, 16),
    endTime: item.primary_day_end_time ?? item.scheduled_end_at?.slice(11, 16),
    organizationName: item.organization_name,
    locationName: item.primary_location_name,
    contactName: item.primary_contact_name,
    ownerName: item.account_owner_name ?? item.lead_owner_name,
    departmentType: item.department_type,
    jobCategory: item.job_category,
    estimatedStaffCount: item.estimated_staff_count,
    assignedStaffCount: item.assigned_staff_count,
    missingFields: item.blocker_count > 0 || item.open_watch_flag_count > 0 ? ["Open blocker or watch flag"] : [],
    readinessStatus: item.readiness_status,
    staffingStatus: item.staffing_status,
    jobStatus: item.job_status,
    riskStatus: item.risk_status,
    notesPresent: Boolean(item.description_internal || item.school_profile?.special_instructions || item.sports_profile?.client_expectations_notes),
    sportsSetupPresent: Boolean(item.sports_profile?.team_structure || item.sports_profile?.sport_type),
    updatedAt: item.updated_at,
    referenceDate
  });
}

export function buildDetailsConfirmationFromScheduleShoot(item: UnifiedScheduleShootItem, referenceDate = new Date()): DetailsConfirmationCue {
  return buildDetailsConfirmationCue({
    shootDate: item.date_key,
    startTime: item.starts_at ?? item.start_time,
    endTime: item.ends_at ?? item.end_time_est,
    organizationName: item.title,
    locationName: item.location_name ?? item.location_address,
    contactName: item.lead_name,
    ownerName: item.lead_name,
    departmentType: item.department,
    jobCategory: item.shoot_category ?? item.department,
    estimatedStaffCount: item.planned_staff_count,
    assignedStaffCount: item.assigned_staff_count,
    missingFields: [
      ...item.missing_fields,
      item.missing_lead ? "Lead photographer" : null,
      item.under_staffed ? "Staffing coverage" : null
    ].filter((value): value is string => Boolean(value)),
    readinessStatus: item.staffing_health_state,
    staffingStatus: item.staffing_state,
    jobStatus: item.status,
    riskStatus: item.operations_priority,
    notesPresent: Boolean(item.special_equipment),
    sportsSetupPresent: item.shoot_category === "sports",
    referenceDate
  });
}

export function buildDetailsConfirmationFromProjectWork(
  item: {
    shootDate?: string | null;
    organizationName?: string | null;
    ownerName?: string | null;
    departmentType?: string | null;
    jobCategory?: string | null;
    missingFields?: string[];
    readinessStatus?: string | null;
    jobStatus?: string | null;
    riskStatus?: string | null;
    updatedAt?: string | null;
    confirmed?: DetailsConfirmationRecord | null;
  },
  referenceDate = new Date()
): DetailsConfirmationCue {
  return buildDetailsConfirmationCue({
    shootDate: item.shootDate,
    startTime: item.shootDate ? "09:00" : null,
    endTime: item.shootDate ? "17:00" : null,
    organizationName: item.organizationName,
    locationName: item.organizationName,
    contactName: item.ownerName ?? item.organizationName,
    ownerName: item.ownerName,
    departmentType: item.departmentType,
    jobCategory: item.jobCategory,
    estimatedStaffCount: 1,
    assignedStaffCount: 1,
    missingFields: item.missingFields,
    readinessStatus: item.readinessStatus,
    jobStatus: item.jobStatus,
    riskStatus: item.riskStatus,
    notesPresent: true,
    confirmed: item.confirmed,
    updatedAt: item.updatedAt,
    referenceDate
  });
}

function buildDetailsConfirmationCue(input: DetailsConfirmationInput): DetailsConfirmationCue {
  const referenceDate = input.referenceDate ?? new Date();
  const ownerLabel = confirmationOwnerLabel(input);
  const confirmationDueDate = offsetDate(input.shootDate, -21);
  const finalDueDate = offsetDate(input.shootDate, -7);
  const requiredMissing = collectMissingLabels(input);
  const uniqueMissing = Array.from(new Set(requiredMissing.concat(input.missingFields ?? []).filter(Boolean)));
  const confirmedAt = input.confirmed?.confirmedAt ?? null;
  const confirmedByName = input.confirmed?.confirmedByName ?? null;

  if (confirmedAt) {
    if (changedAfterConfirmation(input.updatedAt, confirmedAt)) {
      return {
        state: "reconfirm",
        label: "Reconfirm",
        marker: "reconfirm",
        tone: "warning",
        summary: "Details changed after confirmation. Please reconfirm before the shoot.",
        ownerLabel,
        nextAction: `Reconfirm details with ${ownerLabel}.`,
        missingLabels: uniqueMissing,
        missingCount: uniqueMissing.length,
        confirmationDueDate,
        finalDueDate,
        confirmedAt,
        confirmedByName
      };
    }
    return {
      state: "confirmed",
      label: "Confirmed",
      marker: "confirmed",
      tone: "success",
      summary: `Details confirmed by ${confirmedByName ?? ownerLabel} on ${formatDateTimeLabel(confirmedAt)}.`,
      ownerLabel,
      nextAction: "Use these details for staffing, prep, and production handoff.",
      missingLabels: uniqueMissing,
      missingCount: uniqueMissing.length,
      confirmationDueDate,
      finalDueDate,
      confirmedAt,
      confirmedByName
    };
  }

  if (isOperationallyConfirmed(input, uniqueMissing)) {
    return {
      state: "confirmed",
      label: "Confirmed",
      marker: "confirmed",
      tone: "success",
      summary: "Current job data is clean enough to treat the details as confirmed.",
      ownerLabel,
      nextAction: "Keep watching for date, time, location, or contact changes.",
      missingLabels: uniqueMissing,
      missingCount: uniqueMissing.length,
      confirmationDueDate,
      finalDueDate,
      confirmedAt: null,
      confirmedByName: null
    };
  }

  if (isInsideConfirmationWindow(input.shootDate, referenceDate) && uniqueMissing.length <= 1) {
    return {
      state: "confirmation_due",
      label: "Confirm",
      marker: "due",
      tone: "info",
      summary: `Details are ready for confirmation${confirmationDueDate ? ` by ${formatDateLabel(confirmationDueDate)}` : ""}.`,
      ownerLabel,
      nextAction: `Confirm details with ${ownerLabel}.`,
      missingLabels: uniqueMissing,
      missingCount: uniqueMissing.length,
      confirmationDueDate,
      finalDueDate,
      confirmedAt: null,
      confirmedByName: null
    };
  }

  if (uniqueMissing.length >= 3 || !input.shootDate) {
    return {
      state: "needs_details",
      label: "Needs details",
      marker: "open",
      tone: "neutral",
      summary: "Job is booked, but important shoot details are not trustworthy yet.",
      ownerLabel,
      nextAction: `Collect ${uniqueMissing[0] ?? "shoot details"} before confirmation.`,
      missingLabels: uniqueMissing,
      missingCount: uniqueMissing.length,
      confirmationDueDate,
      finalDueDate,
      confirmedAt: null,
      confirmedByName: null
    };
  }

  return {
    state: "partial",
    label: "Partial",
    marker: "partial",
    tone: "warning",
    summary: uniqueMissing.length
      ? "Some details are entered, but at least one important detail still needs review."
      : "Details are entered, but final confirmation is not due yet.",
    ownerLabel,
    nextAction: uniqueMissing.length ? `Resolve ${uniqueMissing[0]} before confirmation.` : `Confirm details with ${ownerLabel} when the shoot enters the confirmation window.`,
    missingLabels: uniqueMissing,
    missingCount: uniqueMissing.length,
    confirmationDueDate,
    finalDueDate,
    confirmedAt: null,
    confirmedByName: null
  };
}

function collectMissingLabels(input: DetailsConfirmationInput) {
  const missing: string[] = [];
  if (!input.shootDate) missing.push("Shoot date");
  if (!input.startTime) missing.push("Photography start time");
  if (!input.endTime) missing.push("Expected end time");
  if (!input.organizationName) missing.push(isSports(input) ? "Association / Organization" : isSchool(input) ? "District" : "Organization");
  if (!input.locationName) missing.push(isSchool(input) ? "School / location" : "Location");
  if (!input.contactName) missing.push("Main contact");
  if (!input.ownerName) missing.push(confirmationOwnerLabel(input));
  if ((input.estimatedStaffCount ?? 0) <= 0) missing.push("Photographers needed");
  if (isSports(input) && !input.sportsSetupPresent) missing.push("Sports setup details");
  if (!input.notesPresent) missing.push("Important notes, access, or parking");
  if ((input.assignedStaffCount ?? 0) < Math.max(0, input.estimatedStaffCount ?? 0) && isInsideConfirmationWindow(input.shootDate, input.referenceDate ?? new Date())) {
    missing.push("Staffing coverage");
  }
  return missing;
}

function confirmationOwnerLabel(input: DetailsConfirmationInput) {
  if (input.ownerName) return input.ownerName;
  if (isSchool(input)) return "Schools Director";
  if (isSports(input)) return "Sports Director";
  if (String(input.jobCategory ?? "").toLowerCase().includes("graduation")) return "Schools Director";
  return "Department Director";
}

function isSchool(input: DetailsConfirmationInput) {
  const category = String(input.jobCategory ?? "").toLowerCase();
  const department = String(input.departmentType ?? "").toLowerCase();
  return department === "schools" || ["school", "retake", "yearbook", "cap", "gown"].some((token) => category.includes(token));
}

function isSports(input: DetailsConfirmationInput) {
  const category = String(input.jobCategory ?? "").toLowerCase();
  const department = String(input.departmentType ?? "").toLowerCase();
  return department === "sports" || category.includes("sport") || category.includes("team");
}

function isOperationallyConfirmed(input: DetailsConfirmationInput, missingLabels: string[]) {
  if (missingLabels.length > 0) return false;
  return (
    input.readinessStatus === "ready" ||
    input.staffingStatus === "ready_confirmed" ||
    input.jobStatus === "ready_to_execute" ||
    input.jobStatus === "complete" ||
    input.jobStatus === "closed"
  );
}

function isInsideConfirmationWindow(dateValue: string | null | undefined, referenceDate: Date) {
  if (!dateValue) return false;
  const shootTime = new Date(`${dateValue}T12:00:00`).getTime();
  if (Number.isNaN(shootTime)) return false;
  const reference = new Date(referenceDate);
  reference.setHours(12, 0, 0, 0);
  const daysUntil = Math.ceil((shootTime - reference.getTime()) / DAY_MS);
  return daysUntil <= 21 && daysUntil >= 0;
}

function offsetDate(dateValue: string | null | undefined, days: number) {
  if (!dateValue) return null;
  const date = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function changedAfterConfirmation(updatedAt: string | null | undefined, confirmedAt: string) {
  if (!updatedAt) return false;
  const updated = new Date(updatedAt).getTime();
  const confirmed = new Date(confirmedAt).getTime();
  if (Number.isNaN(updated) || Number.isNaN(confirmed)) return false;
  return updated > confirmed + 60_000;
}

function formatDateLabel(dateValue: string) {
  const date = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateValue;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDateTimeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
