import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { canCreateOrEditShootDepartment, hasAuthorityTier } from "../authz/authority.js";
import type { CentralJobDepartment } from "../domain/centralJobIntake/index.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  CentralJobActivityLogRecord,
  CentralJobCanonicalJobType,
  CentralJobDayRecord,
  CentralJobDraftResponse,
  CentralJobDraftListItem,
  CentralJobDuplicateMatch,
  CentralJobDuplicateResult,
  CentralJobIntakeResponse,
  CentralJobIntakeInput,
  CentralJobNormalizedDay,
  CentralJobNormalizedPayload,
  CentralJobOrganizationDefaults,
  CentralJobPublishResult,
  CentralJobProductionItemRecord,
  CentralJobReadinessEvaluation,
  CentralJobReadinessIssue,
  CentralJobRecord,
  CentralJobRouteField,
  CentralJobSanitizedPatchResult,
  CentralJobStaffingRequirementRecord,
  CentralJobValidationIssue,
  CentralJobValidationResult,
  CentralSchoolJobDetailRecord,
  CentralSportsJobDetailRecord
} from "../types/centralJobIntake.js";
import { createAuditLog } from "./audit.js";
export { parseJobIntakeText } from "./centralJobIntakeSmartPaste.js";
import { ensureTriggeredProductionProject } from "./productionProjects.js";

const DEFAULT_TIMEZONE = "America/Chicago";
const PLACEHOLDER_LOCATION_NAME = "TBD Location";
const PLACEHOLDER_LATITUDE = 44.9778;
const PLACEHOLDER_LONGITUDE = -93.2649;
const PLACEHOLDER_START_TIME = "12:00:00";
const PLACEHOLDER_END_TIME = "13:00:00";
const PLACEHOLDER_ARRIVAL_TIME = "11:45:00";
const LEADERSHIP_OVERRIDE_TIERS = ["super_admin", "leadership", "director_admin", "supervisor"] as const;
const JOB_NUMBER_SEQUENCE = "central_job_number_seq";
const CENTRAL_JOB_STAFFING_SOURCE = "central_job_intake_publish";
const CENTRAL_JOB_PRODUCTION_SOURCE_PREFIX = "central_job_publish";

type CentralJobSummaryRow = {
  id: string;
  tenant_id: string;
  shoot_code: string;
  title: string;
  organization_display_name: string | null;
  location_display_name: string | null;
  primary_contact_name: string | null;
  account_owner_name: string | null;
  job_owner_name: string | null;
  job_number: string | null;
  department: CentralJobDepartment;
  job_type: CentralJobCanonicalJobType | null;
  source_reference: string | null;
  record_state: CentralJobRecord["record_state"];
  job_status: CentralJobRecord["job_status"];
  readiness_status: CentralJobRecord["readiness_status"];
  sync_status: CentralJobRecord["sync_status"];
  organization_id: string | null;
  unresolved_organization_name: string | null;
  location_id: string | null;
  unresolved_location_name: string | null;
  primary_contact_id: string | null;
  unresolved_primary_contact_name: string | null;
  account_owner_user_id: string | null;
  job_owner_user_id: string | null;
  start_date: string | null;
  schedule_date_placeholder: boolean;
  start_time: string | null;
  end_time: string | null;
  timezone: string | null;
  date_only: boolean;
  start_time_confirmed: boolean;
  is_multi_day: boolean;
  delivery_due_date: string | null;
  production_required: boolean;
  staffing_required: boolean;
  staffing_estimate: number | null;
  priority: CentralJobRecord["priority"];
  delivery_type: CentralJobRecord["delivery_type"];
  production_grouping_rule: CentralJobRecord["production_grouping_rule"];
  request_source: CentralJobRecord["request_source"];
  internal_notes: string | null;
  client_notes: string | null;
  special_instructions: string | null;
  raw_source_text: string | null;
  merge_parent_job_id: string | null;
  duplicate_override_note: string | null;
  duplicate_check_completed_at: string | null;
  created_by: string | null;
  updated_by_user_id: string | null;
  published_by_user_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

type CentralJobReadinessInput = {
  department: CentralJobDepartment | null;
  organization_id: string | null;
  unresolved_organization_name: string | null;
  location_id: string | null;
  unresolved_location_name: string | null;
  primary_contact_id: string | null;
  unresolved_primary_contact_name: string | null;
  start_date: string | null;
  date_only: boolean;
  start_time: string | null;
  staffing_required: boolean;
  staffing_estimate: number | null;
  production_required: boolean;
  delivery_type: CentralJobNormalizedPayload["delivery_type"];
  delivery_due_date: string | null;
  school_detail: CentralJobNormalizedPayload["school_detail"];
  sports_detail: CentralJobNormalizedPayload["sports_detail"];
};

type CentralJobPublishOptions = {
  hooks?: {
    beforeDownstreamCreation?: () => Promise<void>;
  };
};

type CentralJobDownstreamSummary = {
  production_project_ids: string[];
  staffing_requirement_ids: string[];
};

function isValidCentralDepartment(value: string | null | undefined): value is CentralJobDepartment {
  return value === "schools" || value === "sports";
}

function normalizeText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeSearchText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeDate(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new ApiError(400, "Validation failed", {
      field_errors: {
        start_date: ["Dates must use YYYY-MM-DD."],
        delivery_due_date: ["Dates must use YYYY-MM-DD."]
      },
      form_errors: []
    });
  }
  return trimmed;
}

function normalizeTime(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const directMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (directMatch) {
    return `${directMatch[1]}:${directMatch[2]}:${directMatch[3] ?? "00"}`;
  }
  const isoMatch = /T(\d{2}:\d{2})(?::(\d{2}))?/.exec(trimmed);
  if (isoMatch) {
    return `${isoMatch[1]}:${isoMatch[2] ?? "00"}`;
  }
  throw new ApiError(400, "Validation failed", {
    field_errors: {
      start_time: ["Times must use HH:MM or HH:MM:SS."],
      end_time: ["Times must use HH:MM or HH:MM:SS."]
    },
    form_errors: []
  });
}

function normalizeBoolean(value: boolean | null | undefined, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeInteger(value: number | null | undefined) {
  if (value == null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new ApiError(400, "Validation failed", {
      field_errors: {
        form: ["Count and estimate values must be non-negative integers."]
      },
      form_errors: []
    });
  }
  return value;
}

function normalizeStringArray(values: string[] | null | undefined) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function normalizeDayInputs(
  values: CentralJobIntakeInput["days"],
  fallbackTimezone: string,
  fallbackLocationId: string | null,
  fallbackDateOnly: boolean
): CentralJobNormalizedDay[] {
  const rows = (values ?? [])
    .map((value, index) => {
      const shootDate = normalizeDate(value?.shoot_date);
      const startTime = normalizeTime(value?.start_time);
      const endTime = normalizeTime(value?.end_time);
      const dateOnly = normalizeBoolean(value?.date_only, fallbackDateOnly);
      return {
        day_index: value?.day_index ?? index,
        shoot_date: shootDate,
        start_time: startTime,
        end_time: endTime,
        timezone: normalizeText(value?.timezone) ?? fallbackTimezone,
        location_id: normalizeText(value?.location_id) ?? fallbackLocationId,
        date_only: dateOnly,
        start_time_confirmed: typeof value?.start_time_confirmed === "boolean" ? value.start_time_confirmed : Boolean(startTime)
      };
    })
    .filter((value) => value.shoot_date || value.location_id || value.start_time || value.end_time);

  const seenIndexes = new Set<number>();
  for (const row of rows) {
    if (row.day_index < 0) {
      throw new ApiError(400, "Validation failed", {
        field_errors: {
          form: ["Job day indexes must be zero or greater."]
        },
        form_errors: []
      });
    }
    if (seenIndexes.has(row.day_index)) {
      throw new ApiError(400, "Validation failed", {
        field_errors: {
          form: ["Job day indexes must be unique."]
        },
        form_errors: []
      });
    }
    seenIndexes.add(row.day_index);
  }

  return rows.sort((left, right) => left.day_index - right.day_index);
}

function buildFieldErrors(issues: CentralJobValidationIssue[]) {
  const fieldErrors: Record<string, string[]> = {};
  const formErrors: string[] = [];
  for (const issue of issues) {
    if (issue.field === "form") {
      formErrors.push(issue.message);
      continue;
    }
    fieldErrors[issue.field] ??= [];
    fieldErrors[issue.field].push(issue.message);
  }
  return {
    field_errors: fieldErrors,
    form_errors: formErrors
  };
}

function issue(
  field: CentralJobRouteField | "form",
  code: string,
  message: string,
  severity: "error" | "warning" = "error"
): CentralJobValidationIssue {
  return { field, code, message, severity };
}

function readinessIssue(
  code: string,
  label: string,
  message: string,
  field: CentralJobRouteField | "form",
  blocking: boolean
): CentralJobReadinessIssue {
  return { code, label, message, field, blocking };
}

function isLeadershipOverrideActor(actor: Pick<AuthUser, "authorityTier">) {
  return hasAuthorityTier(actor, [...LEADERSHIP_OVERRIDE_TIERS]);
}

function mapDepartmentToFallbackJobType(department: CentralJobDepartment | null): CentralJobCanonicalJobType | null {
  if (department === "schools") {
    return "schools_underclass_portraits";
  }
  if (department === "sports") {
    return "sports";
  }
  return null;
}

function humanizeEnumLabel(value: string | null) {
  if (!value) {
    return null;
  }
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildJobDescriptor(input: {
  department: CentralJobDepartment | null;
  job_type: CentralJobCanonicalJobType | null;
  school_job_type: string | null;
  sports_job_type: string | null;
  sport_name: string | null;
}) {
  if (input.department === "sports") {
    return input.sport_name ?? humanizeEnumLabel(input.sports_job_type) ?? humanizeEnumLabel(input.job_type) ?? "Sports Job";
  }
  if (input.department === "schools") {
    return humanizeEnumLabel(input.school_job_type) ?? humanizeEnumLabel(input.job_type) ?? "School Job";
  }
  return humanizeEnumLabel(input.job_type) ?? "New Job";
}

function buildSafeShootCode() {
  return `DRAFT-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

function addMinutesToTimeString(value: string, minutes: number) {
  const [hourText, minuteText, secondText = "00"] = value.split(":");
  const totalMinutes = Number(hourText) * 60 + Number(minuteText) + minutes;
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  const nextHour = Math.floor(wrapped / 60)
    .toString()
    .padStart(2, "0");
  const nextMinute = (wrapped % 60).toString().padStart(2, "0");
  return `${nextHour}:${nextMinute}:${secondText.padStart(2, "0")}`;
}

function daysBetween(left: string | null, right: string | null) {
  if (!left || !right) {
    return null;
  }
  const leftValue = new Date(`${left}T00:00:00Z`).getTime();
  const rightValue = new Date(`${right}T00:00:00Z`).getTime();
  if (Number.isNaN(leftValue) || Number.isNaN(rightValue)) {
    return null;
  }
  return Math.round((leftValue - rightValue) / 86400000);
}

function defaultDraftScheduleDate() {
  return new Date().toISOString().slice(0, 10);
}

function deriveDepartmentSubtype(input: Pick<CentralJobNormalizedPayload, "department" | "school_detail" | "sports_detail">) {
  if (input.department === "schools") {
    return input.school_detail.school_job_type;
  }
  if (input.department === "sports") {
    return input.sports_detail.sports_job_type;
  }
  return null;
}

export function buildJobAutoTitle(
  input: Pick<
    CentralJobNormalizedPayload,
    "department" | "job_type" | "job_title" | "start_date" | "delivery_due_date" | "unresolved_organization_name" | "school_detail" | "sports_detail"
  > & {
    organization_display_name?: string | null;
  }
) {
  const explicitTitle = normalizeText(input.job_title);
  if (explicitTitle) {
    return explicitTitle;
  }
  const organizationLabel =
    normalizeText(input.organization_display_name) ?? normalizeText(input.unresolved_organization_name) ?? "Unresolved Account";
  const descriptor = buildJobDescriptor({
    department: input.department,
    job_type: input.job_type,
    school_job_type: input.school_detail.school_job_type,
    sports_job_type: input.sports_detail.sports_job_type,
    sport_name: input.sports_detail.sport_name
  });
  const dateLabel = input.start_date ?? input.delivery_due_date ?? "Draft";
  return `${organizationLabel} - ${descriptor} - ${dateLabel}`;
}

export function normalizeIntakePayload(input: CentralJobIntakeInput): CentralJobNormalizedPayload {
  const department = isValidCentralDepartment(input.department ?? null) ? input.department ?? null : null;
  const timezone = normalizeText(input.timezone) ?? DEFAULT_TIMEZONE;
  const schoolDetail = {
    school_job_type: normalizeText(input.school_detail?.school_job_type),
    school_type: normalizeText(input.school_detail?.school_type),
    student_count_estimate: normalizeInteger(input.school_detail?.student_count_estimate),
    staff_count_estimate: normalizeInteger(input.school_detail?.staff_count_estimate),
    grade_range: normalizeText(input.school_detail?.grade_range),
    camera_count_estimate: normalizeInteger(input.school_detail?.camera_count_estimate),
    roster_status: normalizeText(input.school_detail?.roster_status),
    roster_due_date: normalizeDate(input.school_detail?.roster_due_date),
    id_required: normalizeBoolean(input.school_detail?.id_required),
    id_sort_method: normalizeText(input.school_detail?.id_sort_method),
    yearbook_required: normalizeBoolean(input.school_detail?.yearbook_required),
    yearbook_due_date: normalizeDate(input.school_detail?.yearbook_due_date),
    staff_packages_required: normalizeBoolean(input.school_detail?.staff_packages_required),
    parent_communication_needed: normalizeBoolean(input.school_detail?.parent_communication_needed),
    background_requirements: normalizeText(input.school_detail?.background_requirements),
    school_day_notes: normalizeText(input.school_detail?.school_day_notes),
    building_instructions: normalizeText(input.school_detail?.building_instructions),
    photo_day_special_notes: normalizeText(input.school_detail?.photo_day_special_notes)
  };
  const sportsDetail = {
    sports_job_type: normalizeText(input.sports_detail?.sports_job_type),
    sport_name: normalizeText(input.sports_detail?.sport_name),
    season: normalizeText(input.sports_detail?.season),
    level_or_age_group: normalizeText(input.sports_detail?.level_or_age_group),
    team_count_estimate: normalizeInteger(input.sports_detail?.team_count_estimate),
    athlete_count_estimate: normalizeInteger(input.sports_detail?.athlete_count_estimate),
    coach_count_estimate: normalizeInteger(input.sports_detail?.coach_count_estimate),
    coach_contact_id: normalizeText(input.sports_detail?.coach_contact_id),
    alternate_team_contact_id: normalizeText(input.sports_detail?.alternate_team_contact_id),
    specialty_products_required: normalizeBoolean(input.sports_detail?.specialty_products_required),
    specialty_product_types: normalizeStringArray(input.sports_detail?.specialty_product_types),
    gallery_required: normalizeBoolean(input.sports_detail?.gallery_required),
    delivery_deadline_type: normalizeText(input.sports_detail?.delivery_deadline_type),
    uniform_notes: normalizeText(input.sports_detail?.uniform_notes),
    sponsor_notes: normalizeText(input.sports_detail?.sponsor_notes),
    event_notes: normalizeText(input.sports_detail?.event_notes),
    on_site_sales_notes: normalizeText(input.sports_detail?.on_site_sales_notes)
  };
  const normalized: CentralJobNormalizedPayload = {
    department,
    job_type: input.job_type ?? mapDepartmentToFallbackJobType(null),
    job_title: normalizeText(input.job_title),
    request_source: input.request_source ?? "manual",
    source_reference: normalizeText(input.source_reference),
    organization_id: normalizeText(input.organization_id),
    unresolved_organization_name: normalizeText(input.unresolved_organization_name),
    location_id: normalizeText(input.location_id),
    unresolved_location_name: normalizeText(input.unresolved_location_name),
    primary_contact_id: normalizeText(input.primary_contact_id),
    unresolved_primary_contact_name: normalizeText(input.unresolved_primary_contact_name),
    account_owner_user_id: normalizeText(input.account_owner_user_id),
    job_owner_user_id: normalizeText(input.job_owner_user_id),
    start_date: normalizeDate(input.start_date),
    start_time: normalizeTime(input.start_time),
    end_time: normalizeTime(input.end_time),
    timezone,
    date_only: normalizeBoolean(input.date_only),
    is_multi_day: normalizeBoolean(input.is_multi_day),
    delivery_due_date: normalizeDate(input.delivery_due_date),
    production_required: typeof input.production_required === "boolean" ? input.production_required : department != null,
    staffing_required: typeof input.staffing_required === "boolean" ? input.staffing_required : department != null,
    staffing_estimate: normalizeInteger(input.staffing_estimate),
    priority: input.priority ?? "normal",
    delivery_type: input.delivery_type ?? null,
    production_grouping_rule: input.production_grouping_rule ?? "one_per_job",
    internal_notes: normalizeText(input.internal_notes),
    client_notes: normalizeText(input.client_notes),
    special_instructions: normalizeText(input.special_instructions),
    raw_source_text: normalizeText(input.raw_source_text),
    duplicate_override_note: normalizeText(input.duplicate_override_note),
    days: normalizeDayInputs(input.days, timezone, normalizeText(input.location_id), normalizeBoolean(input.date_only)),
    school_detail: schoolDetail,
    sports_detail: sportsDetail
  };

  if (normalized.organization_id) {
    normalized.unresolved_organization_name = null;
  }
  if (normalized.location_id) {
    normalized.unresolved_location_name = null;
  }
  if (normalized.primary_contact_id) {
    normalized.unresolved_primary_contact_name = null;
  }
  if (!normalized.job_type) {
    normalized.job_type = mapDepartmentToFallbackJobType(normalized.department);
  }
  if (!normalized.start_date && normalized.days[0]?.shoot_date) {
    normalized.start_date = normalized.days[0].shoot_date;
  }
  if (!normalized.start_time && normalized.days[0]?.start_time_confirmed) {
    normalized.start_time = normalized.days[0].start_time;
  }
  if (!normalized.end_time && normalized.days[0]?.start_time_confirmed && !normalized.days[0]?.date_only) {
    normalized.end_time = normalized.days[0].end_time;
  }
  if (!normalized.location_id && normalized.days[0]?.location_id) {
    normalized.location_id = normalized.days[0].location_id;
  }
  return normalized;
}

export function validateJobDraft(input: CentralJobNormalizedPayload): CentralJobValidationResult {
  const errors: CentralJobValidationIssue[] = [];
  const subtype = deriveDepartmentSubtype(input);

  if (!input.department) {
    errors.push(issue("department", "department_required", "Choose Schools or Sports before saving a draft."));
  }
  if (!input.job_type && !subtype) {
    errors.push(issue("job_type", "job_type_or_subtype_required", "Choose a job type or a department-specific subtype."));
  }
  if (!input.organization_id && !input.unresolved_organization_name) {
    errors.push(
      issue(
        "organization_id",
        "organization_required",
        "Resolve the organization or enter an unresolved organization name before saving a draft."
      )
    );
  }
  if (!input.start_date && !input.delivery_due_date && !input.internal_notes) {
    errors.push(
      issue(
        "form",
        "draft_anchor_required",
        "Add a start date, a delivery due date, or internal notes so the draft can be identified later."
      )
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: []
  };
}

export function validateJobPublish(
  input: CentralJobNormalizedPayload & { duplicate_check_completed_at?: string | null }
): CentralJobValidationResult {
  const errors: CentralJobValidationIssue[] = [];

  if (!input.department) {
    errors.push(issue("department", "department_required", "Department is required for publish."));
  }
  if (!input.job_type) {
    errors.push(issue("job_type", "job_type_required", "Job type is required for publish."));
  }
  if (!input.organization_id) {
    errors.push(issue("organization_id", "organization_required", "Organization must be resolved before publish."));
  }
  if (!input.job_owner_user_id) {
    errors.push(issue("job_owner_user_id", "owner_required", "Assign a job owner before publish."));
  }
  if (!input.start_date) {
    errors.push(issue("start_date", "start_date_required", "Start date is required for publish."));
  }
  if (!normalizeText(input.timezone)) {
    errors.push(issue("timezone", "timezone_required", "Timezone is required for publish."));
  }
  if (!input.request_source) {
    errors.push(issue("request_source", "request_source_required", "Request source is required for publish."));
  }
  if (!input.duplicate_check_completed_at) {
    errors.push(issue("duplicate_check_completed_at", "duplicate_check_required", "Run duplicate check before publish."));
  }
  if (input.department === "schools") {
    if (!input.school_detail.school_job_type) {
      errors.push(issue("school_detail.school_job_type", "school_job_type_required", "School job type is required for publish."));
    }
    if (!input.school_detail.roster_status) {
      errors.push(issue("school_detail.roster_status", "roster_status_required", "Roster status is required for publish."));
    }
  }
  if (input.department === "sports") {
    if (!input.sports_detail.sports_job_type) {
      errors.push(issue("sports_detail.sports_job_type", "sports_job_type_required", "Sports job type is required for publish."));
    }
    if (!input.sports_detail.sport_name) {
      errors.push(issue("sports_detail.sport_name", "sport_name_required", "Sport name is required for publish."));
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: []
  };
}

export function evaluateJobReadiness(input: CentralJobReadinessInput): CentralJobReadinessEvaluation {
  const blockers: CentralJobReadinessIssue[] = [];
  const warnings: CentralJobReadinessIssue[] = [];

  if (!input.organization_id) {
    warnings.push(
      readinessIssue(
        "MISSING_ORGANIZATION",
        "Resolve organization",
        "A ready job should be linked to a resolved organization record.",
        "organization_id",
        false
      )
    );
  }
  if (!input.location_id) {
    blockers.push(
      readinessIssue("MISSING_LOCATION", "Resolve location", "A ready job must be linked to a resolved location record.", "location_id", true)
    );
  }
  if (!input.primary_contact_id) {
    blockers.push(
      readinessIssue(
        "MISSING_PRIMARY_CONTACT",
        "Resolve primary contact",
        "A ready job must be linked to a resolved primary contact.",
        "primary_contact_id",
        true
      )
    );
  }
  if (!input.start_date) {
    warnings.push(readinessIssue("MISSING_START_DATE", "Set schedule date", "A ready job should have a real start date.", "start_date", false));
  }
  if (!input.date_only && !input.start_time) {
    blockers.push(
      readinessIssue(
        "MISSING_START_TIME",
        "Set start time",
        "A ready job needs a confirmed start time unless it is intentionally date-only.",
        "start_time",
        true
      )
    );
  }
  if (input.staffing_required && input.staffing_estimate == null) {
    blockers.push(
      readinessIssue(
        "MISSING_STAFFING_ESTIMATE",
        "Add staffing estimate",
        "Staffing-required jobs need a staffing estimate before they are ready.",
        "staffing_estimate",
        true
      )
    );
  }
  if ((input.production_required || input.delivery_type !== null) && !input.delivery_due_date) {
    blockers.push(
      readinessIssue(
        "MISSING_DELIVERY_DUE_DATE",
        "Set delivery due date",
        "Production or delivery work needs a delivery due date before the job is ready.",
        "delivery_due_date",
        true
      )
    );
  }
  if (input.department === "schools" && input.school_detail.id_required && !input.school_detail.id_sort_method) {
    blockers.push(
      readinessIssue(
        "MISSING_ID_SORT_METHOD",
        "Set ID sort method",
        "ID-required school jobs need an ID sort method before they are ready.",
        "school_detail.id_sort_method",
        true
      )
    );
  }
  if (input.department === "schools" && input.school_detail.yearbook_required && !input.school_detail.yearbook_due_date) {
    blockers.push(
      readinessIssue(
        "MISSING_YEARBOOK_DUE_DATE",
        "Set yearbook due date",
        "Yearbook-required school jobs need a yearbook due date before they are ready.",
        "school_detail.yearbook_due_date",
        true
      )
    );
  }
  if (input.department === "sports" && input.sports_detail.specialty_products_required && input.sports_detail.specialty_product_types.length === 0) {
    blockers.push(
      readinessIssue(
        "MISSING_SPECIALTY_PRODUCT_TYPES",
        "Set specialty product types",
        "Sports jobs with specialty products need at least one specialty product type before they are ready.",
        "sports_detail.specialty_product_types",
        true
      )
    );
  }

  const readiness_status = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "needs_info" : "ready";
  const items = [...blockers, ...warnings].map((entry) => ({
    code: entry.code,
    label: entry.label,
    blocking: entry.blocking,
    status: "pending" as const,
    detail: entry.message
  }));

  return {
    readiness_status,
    blockers,
    warnings,
    items
  };
}

export function sanitizeProtectedFieldUpdates(
  existingJob: Pick<CentralJobRecord, "record_state">,
  patch: CentralJobIntakeInput,
  actor: Pick<AuthUser, "authorityTier">
): CentralJobSanitizedPatchResult {
  if (existingJob.record_state === "draft" || isLeadershipOverrideActor(actor)) {
    return {
      patch,
      blocked_fields: [],
      requires_leadership: false
    };
  }

  const blockedFields: CentralJobRouteField[] = [];
  const nextPatch: CentralJobIntakeInput = { ...patch };
  const protectIfPresent = (key: keyof CentralJobIntakeInput, field: CentralJobRouteField) => {
    if (Object.prototype.hasOwnProperty.call(nextPatch, key)) {
      delete nextPatch[key];
      blockedFields.push(field);
    }
  };

  protectIfPresent("department", "department");
  protectIfPresent("job_type", "job_type");
  protectIfPresent("source_reference", "source_reference");
  protectIfPresent("organization_id", "organization_id");
  protectIfPresent("unresolved_organization_name", "unresolved_organization_name");
  protectIfPresent("location_id", "location_id");
  protectIfPresent("unresolved_location_name", "unresolved_location_name");
  protectIfPresent("primary_contact_id", "primary_contact_id");
  protectIfPresent("unresolved_primary_contact_name", "unresolved_primary_contact_name");
  protectIfPresent("account_owner_user_id", "account_owner_user_id");
  protectIfPresent("job_owner_user_id", "job_owner_user_id");
  protectIfPresent("start_date", "start_date");
  protectIfPresent("start_time", "start_time");
  protectIfPresent("end_time", "end_time");
  protectIfPresent("timezone", "timezone");
  protectIfPresent("date_only", "date_only");
  protectIfPresent("is_multi_day", "is_multi_day");
  protectIfPresent("production_required", "production_required");
  protectIfPresent("staffing_required", "staffing_required");
  protectIfPresent("delivery_type", "delivery_type");
  protectIfPresent("production_grouping_rule", "production_grouping_rule");
  protectIfPresent("request_source", "request_source");
  protectIfPresent("duplicate_override_note", "duplicate_override_note");

  if (nextPatch.school_detail) {
    const schoolDetail = { ...nextPatch.school_detail };
    if (Object.prototype.hasOwnProperty.call(schoolDetail, "school_job_type")) {
      delete schoolDetail.school_job_type;
      blockedFields.push("school_detail.school_job_type");
    }
    if (Object.prototype.hasOwnProperty.call(schoolDetail, "roster_status")) {
      delete schoolDetail.roster_status;
      blockedFields.push("school_detail.roster_status");
    }
    if (Object.prototype.hasOwnProperty.call(schoolDetail, "id_sort_method")) {
      delete schoolDetail.id_sort_method;
      blockedFields.push("school_detail.id_sort_method");
    }
    if (Object.prototype.hasOwnProperty.call(schoolDetail, "yearbook_due_date")) {
      delete schoolDetail.yearbook_due_date;
      blockedFields.push("school_detail.yearbook_due_date");
    }
    nextPatch.school_detail = schoolDetail;
  }

  if (nextPatch.sports_detail) {
    const sportsDetail = { ...nextPatch.sports_detail };
    if (Object.prototype.hasOwnProperty.call(sportsDetail, "sports_job_type")) {
      delete sportsDetail.sports_job_type;
      blockedFields.push("sports_detail.sports_job_type");
    }
    if (Object.prototype.hasOwnProperty.call(sportsDetail, "sport_name")) {
      delete sportsDetail.sport_name;
      blockedFields.push("sports_detail.sport_name");
    }
    if (Object.prototype.hasOwnProperty.call(sportsDetail, "specialty_product_types")) {
      delete sportsDetail.specialty_product_types;
      blockedFields.push("sports_detail.specialty_product_types");
    }
    nextPatch.sports_detail = sportsDetail;
  }

  return {
    patch: nextPatch,
    blocked_fields: blockedFields,
    requires_leadership: blockedFields.length > 0
  };
}

function mapSummaryRow(row: CentralJobSummaryRow): CentralJobRecord {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    shoot_code: row.shoot_code,
    title: row.title,
    organization_display_name: row.organization_display_name,
    location_display_name: row.location_display_name,
    primary_contact_name: row.primary_contact_name,
    account_owner_name: row.account_owner_name,
    job_owner_name: row.job_owner_name,
    job_number: row.job_number,
    department: row.department,
    job_type: row.job_type,
    source_reference: row.source_reference,
    record_state: row.record_state,
    job_status: row.job_status,
    readiness_status: row.readiness_status,
    sync_status: row.sync_status,
    organization_id: row.organization_id,
    unresolved_organization_name: row.unresolved_organization_name,
    location_id: row.location_id,
    unresolved_location_name: row.unresolved_location_name,
    primary_contact_id: row.primary_contact_id,
    unresolved_primary_contact_name: row.unresolved_primary_contact_name,
    account_owner_user_id: row.account_owner_user_id,
    job_owner_user_id: row.job_owner_user_id,
    start_date: row.schedule_date_placeholder ? null : row.start_date,
    schedule_date_placeholder: row.schedule_date_placeholder,
    start_time: row.start_time_confirmed ? row.start_time : null,
    end_time: row.start_time_confirmed && !row.date_only ? row.end_time : null,
    timezone: row.timezone ?? DEFAULT_TIMEZONE,
    date_only: row.date_only,
    start_time_confirmed: row.start_time_confirmed,
    is_multi_day: row.is_multi_day,
    delivery_due_date: row.delivery_due_date,
    production_required: row.production_required,
    staffing_required: row.staffing_required,
    staffing_estimate: row.staffing_estimate,
    priority: row.priority,
    delivery_type: row.delivery_type,
    production_grouping_rule: row.production_grouping_rule,
    request_source: row.request_source,
    internal_notes: row.internal_notes,
    client_notes: row.client_notes,
    special_instructions: row.special_instructions,
    raw_source_text: row.raw_source_text,
    merge_parent_job_id: row.merge_parent_job_id,
    duplicate_override_note: row.duplicate_override_note,
    duplicate_check_completed_at: row.duplicate_check_completed_at,
    created_by: row.created_by,
    updated_by_user_id: row.updated_by_user_id,
    published_by_user_id: row.published_by_user_id,
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function toReadinessInput(
  job: Pick<
    CentralJobRecord,
    | "department"
    | "organization_id"
    | "unresolved_organization_name"
    | "location_id"
    | "unresolved_location_name"
    | "primary_contact_id"
    | "unresolved_primary_contact_name"
    | "start_date"
    | "date_only"
    | "start_time"
    | "staffing_required"
    | "staffing_estimate"
    | "production_required"
    | "delivery_type"
    | "delivery_due_date"
  >,
  schoolDetail: CentralSchoolJobDetailRecord | null,
  sportsDetail: CentralSportsJobDetailRecord | null
): CentralJobReadinessInput {
  return {
    department: job.department,
    organization_id: job.organization_id,
    unresolved_organization_name: job.unresolved_organization_name,
    location_id: job.location_id,
    unresolved_location_name: job.unresolved_location_name,
    primary_contact_id: job.primary_contact_id,
    unresolved_primary_contact_name: job.unresolved_primary_contact_name,
    start_date: job.start_date,
    date_only: job.date_only,
    start_time: job.start_time,
    staffing_required: job.staffing_required,
    staffing_estimate: job.staffing_estimate,
    production_required: job.production_required,
    delivery_type: job.delivery_type,
    delivery_due_date: job.delivery_due_date,
    school_detail: {
      school_job_type: schoolDetail?.school_job_type ?? null,
      school_type: schoolDetail?.school_type ?? null,
      student_count_estimate: schoolDetail?.student_count_estimate ?? null,
      staff_count_estimate: schoolDetail?.staff_count_estimate ?? null,
      grade_range: schoolDetail?.grade_range ?? null,
      camera_count_estimate: schoolDetail?.camera_count_estimate ?? null,
      roster_status: schoolDetail?.roster_status ?? null,
      roster_due_date: schoolDetail?.roster_due_date ?? null,
      id_required: schoolDetail?.id_required ?? false,
      id_sort_method: schoolDetail?.id_sort_method ?? null,
      yearbook_required: schoolDetail?.yearbook_required ?? false,
      yearbook_due_date: schoolDetail?.yearbook_due_date ?? null,
      staff_packages_required: schoolDetail?.staff_packages_required ?? false,
      parent_communication_needed: schoolDetail?.parent_communication_needed ?? false,
      background_requirements: schoolDetail?.background_requirements ?? null,
      school_day_notes: schoolDetail?.school_day_notes ?? null,
      building_instructions: schoolDetail?.building_instructions ?? null,
      photo_day_special_notes: schoolDetail?.photo_day_special_notes ?? null
    },
    sports_detail: {
      sports_job_type: sportsDetail?.sports_job_type ?? null,
      sport_name: sportsDetail?.sport_name ?? null,
      season: sportsDetail?.season ?? null,
      level_or_age_group: sportsDetail?.level_or_age_group ?? null,
      team_count_estimate: sportsDetail?.team_count_estimate ?? null,
      athlete_count_estimate: sportsDetail?.athlete_count_estimate ?? null,
      coach_count_estimate: sportsDetail?.coach_count_estimate ?? null,
      coach_contact_id: sportsDetail?.coach_contact_id ?? null,
      alternate_team_contact_id: sportsDetail?.alternate_team_contact_id ?? null,
      specialty_products_required: sportsDetail?.specialty_products_required ?? false,
      specialty_product_types: sportsDetail?.specialty_product_types ?? [],
      gallery_required: sportsDetail?.gallery_required ?? false,
      delivery_deadline_type: sportsDetail?.delivery_deadline_type ?? null,
      uniform_notes: sportsDetail?.uniform_notes ?? null,
      sponsor_notes: sportsDetail?.sponsor_notes ?? null,
      event_notes: sportsDetail?.event_notes ?? null,
      on_site_sales_notes: sportsDetail?.on_site_sales_notes ?? null
    }
  };
}

async function assertDepartmentAccess(auth: AuthUser, department: CentralJobDepartment) {
  if (!canCreateOrEditShootDepartment(auth, department)) {
    throw new ApiError(403, "Forbidden");
  }
}

async function resolveDefaultStudioId(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT id
      FROM studio
      WHERE tenant_id = $1
      ORDER BY created_at ASC, name ASC
      LIMIT 1
    `,
    [tenantId]
  );
  if (!rows[0]) {
    throw new ApiError(400, "No studio is configured for this tenant yet.");
  }
  return rows[0].id;
}

async function loadResolvedLocation(client: PoolClient, tenantId: string, locationId: string | null) {
  if (!locationId) {
    return null;
  }
  const { rows } = await client.query<{
    id: string;
    organization_id: string | null;
    name: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  }>(
    `
      SELECT id, organization_id, name, address, latitude, longitude
      FROM shoot_location
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, locationId]
  );
  return rows[0] ?? null;
}

async function loadResolvedContact(client: PoolClient, tenantId: string, contactId: string | null) {
  if (!contactId) {
    return null;
  }
  const { rows } = await client.query<{
    id: string;
    organization_id: string | null;
    full_name: string;
  }>(
    `
      SELECT id, organization_id, full_name
      FROM organization_contact
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, contactId]
  );
  return rows[0] ?? null;
}

async function ensureResolvedLinksBelongToOrganization(
  client: PoolClient,
  tenantId: string,
  organizationId: string | null,
  locationId: string | null,
  primaryContactId: string | null
) {
  if (!organizationId) {
    return;
  }
  if (locationId) {
    const location = await loadResolvedLocation(client, tenantId, locationId);
    if (!location || location.organization_id !== organizationId) {
      throw new ApiError(400, "Validation failed", {
        field_errors: {
          location_id: ["The selected location does not belong to the selected organization."]
        },
        form_errors: []
      });
    }
  }
  if (primaryContactId) {
    const { rows } = await client.query<{ id: string }>(
      `
        SELECT oc.id
        FROM organization_contact oc
        LEFT JOIN organization_contact_relationship ocr
          ON ocr.tenant_id = oc.tenant_id
         AND ocr.contact_id = oc.id
         AND ocr.organization_id = $2
         AND ocr.is_current = true
        WHERE oc.tenant_id = $1
          AND oc.id = $3
          AND (oc.organization_id = $2 OR ocr.id IS NOT NULL)
        LIMIT 1
      `,
      [tenantId, organizationId, primaryContactId]
    );
    if (!rows[0]) {
      throw new ApiError(400, "Validation failed", {
        field_errors: {
          primary_contact_id: ["The selected contact is not linked to the selected organization."]
        },
        form_errors: []
      });
    }
  }
}

function mapLocationName(locationName: string | null, unresolvedName: string | null) {
  return normalizeText(locationName) ?? unresolvedName ?? PLACEHOLDER_LOCATION_NAME;
}

async function writeActivityLog(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  eventType: string,
  payload: Record<string, unknown>
) {
  await client.query(
    `
      INSERT INTO shoot_activity_log (tenant_id, shoot_id, event_type, actor_user_id, payload)
      VALUES ($1,$2,$3,$4,$5::jsonb)
    `,
    [auth.tenantId, shootId, eventType, auth.id, JSON.stringify(payload)]
  );
}

async function loadSchoolDetail(client: PoolClient, tenantId: string, shootId: string) {
  const { rows } = await client.query<CentralSchoolJobDetailRecord>(
    `
      SELECT
        shoot_id::text,
        tenant_id::text,
        school_job_type,
        school_type,
        student_count_estimate,
        staff_count_estimate,
        grade_range,
        camera_count_estimate,
        roster_status,
        roster_due_date::text,
        id_required,
        id_sort_method,
        yearbook_required,
        yearbook_due_date::text,
        staff_packages_required,
        parent_communication_needed,
        background_requirements,
        school_day_notes,
        building_instructions,
        photo_day_special_notes,
        created_at::text,
        updated_at::text
      FROM shoot_school_detail
      WHERE tenant_id = $1
        AND shoot_id = $2
      LIMIT 1
    `,
    [tenantId, shootId]
  );
  return rows[0] ?? null;
}

async function loadSportsDetail(client: PoolClient, tenantId: string, shootId: string) {
  const { rows } = await client.query<CentralSportsJobDetailRecord>(
    `
      SELECT
        shoot_id::text,
        tenant_id::text,
        sports_job_type,
        sport_name,
        season,
        level_or_age_group,
        team_count_estimate,
        athlete_count_estimate,
        coach_count_estimate,
        coach_contact_id::text,
        alternate_team_contact_id::text,
        specialty_products_required,
        specialty_product_types,
        gallery_required,
        delivery_deadline_type,
        uniform_notes,
        sponsor_notes,
        event_notes,
        on_site_sales_notes,
        created_at::text,
        updated_at::text
      FROM shoot_sports_detail
      WHERE tenant_id = $1
        AND shoot_id = $2
      LIMIT 1
    `,
    [tenantId, shootId]
  );
  return rows[0] ?? null;
}

async function loadDraftJobRow(client: PoolClient, tenantId: string, shootId: string) {
  const { rows } = await client.query<CentralJobSummaryRow>(
    `
      SELECT
        s.id::text,
        s.tenant_id::text,
        s.shoot_code,
        s.title,
        o.display_name AS organization_display_name,
        COALESCE(sl.name, s.location_name) AS location_display_name,
        COALESCE(oc.full_name, s.primary_contact_name, s.unresolved_primary_contact_name) AS primary_contact_name,
        account_owner.full_name AS account_owner_name,
        job_owner.full_name AS job_owner_name,
        s.job_number,
        s.department::text AS department,
        s.shoot_type::text AS job_type,
        s.source_reference,
        s.record_state::text AS record_state,
        s.job_status::text AS job_status,
        s.readiness_status::text AS readiness_status,
        s.schedule_sync_state::text AS sync_status,
        s.organization_id::text,
        s.unresolved_organization_name,
        s.location_id::text,
        s.unresolved_location_name,
        s.primary_contact_id::text,
        s.unresolved_primary_contact_name,
        s.account_owner_user_id::text,
        s.job_owner_user_id::text,
        s.shoot_date::text AS start_date,
        s.schedule_date_placeholder,
        to_char(sd.start_time, 'HH24:MI:SS') AS start_time,
        to_char(sd.end_time, 'HH24:MI:SS') AS end_time,
        s.time_zone AS timezone,
        COALESCE(sd.date_only, false) AS date_only,
        COALESCE(sd.start_time_confirmed, false) AS start_time_confirmed,
        s.is_multi_day,
        s.delivery_due_date::text,
        s.production_required,
        s.staffing_required,
        s.staffing_estimate,
        s.job_priority::text AS priority,
        s.delivery_type::text AS delivery_type,
        s.production_grouping_rule::text AS production_grouping_rule,
        s.request_source::text AS request_source,
        s.internal_notes,
        s.client_notes,
        s.special_instructions,
        s.raw_source_text,
        s.merge_parent_job_id::text,
        s.duplicate_override_note,
        s.duplicate_check_completed_at::text,
        s.created_by::text,
        s.updated_by_user_id::text,
        s.published_by_user_id::text,
        s.published_at::text,
        s.created_at::text,
        s.updated_at::text
      FROM shoot s
      LEFT JOIN organization o
        ON o.tenant_id = s.tenant_id
       AND o.id = s.organization_id
      LEFT JOIN shoot_location sl
        ON sl.tenant_id = s.tenant_id
       AND sl.id = s.location_id
      LEFT JOIN organization_contact oc
        ON oc.tenant_id = s.tenant_id
       AND oc.id = s.primary_contact_id
      LEFT JOIN app_user account_owner
        ON account_owner.id = s.account_owner_user_id
      LEFT JOIN app_user job_owner
        ON job_owner.id = s.job_owner_user_id
      LEFT JOIN shoot_day sd
        ON sd.tenant_id = s.tenant_id
       AND sd.shoot_id = s.id
       AND sd.day_index = 0
      WHERE s.tenant_id = $1
        AND s.id = $2
        AND s.deleted_at IS NULL
      LIMIT 1
    `,
    [tenantId, shootId]
  );
  return rows[0] ?? null;
}

async function loadJobDays(client: PoolClient, tenantId: string, shootId: string): Promise<CentralJobDayRecord[]> {
  const { rows } = await client.query<CentralJobDayRecord>(
    `
      SELECT
        id::text,
        tenant_id::text,
        shoot_id::text,
        day_index,
        shoot_date::text,
        to_char(start_time, 'HH24:MI:SS') AS start_time,
        to_char(end_time, 'HH24:MI:SS') AS end_time,
        time_zone AS timezone,
        location_id::text,
        date_only,
        start_time_confirmed,
        created_at::text,
        updated_at::text
      FROM shoot_day
      WHERE tenant_id = $1
        AND shoot_id = $2
      ORDER BY day_index ASC, shoot_date ASC, created_at ASC
    `,
    [tenantId, shootId]
  );
  return rows;
}

async function loadActivityLog(
  client: PoolClient,
  tenantId: string,
  shootId: string
): Promise<CentralJobActivityLogRecord[]> {
  const { rows } = await client.query<CentralJobActivityLogRecord>(
    `
      SELECT
        log.id::text,
        log.tenant_id::text,
        log.shoot_id::text,
        log.event_type,
        log.actor_user_id::text,
        actor.full_name AS actor_name,
        log.payload,
        log.created_at::text
      FROM shoot_activity_log log
      LEFT JOIN app_user actor
        ON actor.id = log.actor_user_id
      WHERE log.tenant_id = $1
        AND log.shoot_id = $2
      ORDER BY log.created_at DESC, log.id DESC
    `,
    [tenantId, shootId]
  );
  return rows;
}

async function loadProductionItems(
  client: PoolClient,
  tenantId: string,
  shootId: string
): Promise<CentralJobProductionItemRecord[]> {
  const { rows } = await client.query<CentralJobProductionItemRecord>(
    `
      SELECT
        project.id::text,
        project.tenant_id::text,
        project.linked_shoot_id::text,
        project.title,
        project.status::text AS status,
        project.stage::text AS stage,
        project.priority::text AS priority,
        project.owner_user_id::text,
        owner_user.full_name AS owner_name,
        project.due_date::text,
        project.follow_up_date::text,
        current_task.title AS current_step_label,
        project.created_reason,
        project.source_trigger_label,
        project.created_at::text,
        project.updated_at::text
      FROM production_project project
      LEFT JOIN app_user owner_user
        ON owner_user.id = project.owner_user_id
      LEFT JOIN LATERAL (
        SELECT task.title
        FROM production_project_task task
        WHERE task.tenant_id = project.tenant_id
          AND task.project_id = project.id
          AND task.status <> 'done'::production_project_task_status
        ORDER BY task.sort_order ASC, task.created_at ASC
        LIMIT 1
      ) current_task ON true
      WHERE project.tenant_id = $1
        AND project.linked_shoot_id = $2
      ORDER BY
        COALESCE(project.follow_up_date, project.due_date) ASC NULLS LAST,
        project.created_at DESC
    `,
    [tenantId, shootId]
  );
  return rows;
}

async function loadStaffingRequirements(
  client: PoolClient,
  tenantId: string,
  shootId: string
): Promise<CentralJobStaffingRequirementRecord[]> {
  const { rows } = await client.query<CentralJobStaffingRequirementRecord>(
    `
      SELECT
        requirement.id::text,
        requirement.tenant_id::text,
        requirement.shoot_id::text,
        requirement.source_of_creation,
        requirement.staffing_role::text AS staffing_role,
        requirement.label,
        requirement.minimum_count,
        requirement.ideal_count,
        requirement.required_for_ready,
        requirement.lead_required,
        requirement.role_notes,
        requirement.sort_order,
        COALESCE(assigned.assigned_count, 0)::int AS assigned_count,
        GREATEST(requirement.minimum_count - COALESCE(assigned.assigned_count, 0), 0)::int AS open_count,
        requirement.created_at::text,
        requirement.updated_at::text
      FROM shoot_staffing_requirement requirement
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS assigned_count
        FROM work_shift shift
        WHERE shift.tenant_id = requirement.tenant_id
          AND shift.staffing_requirement_id = requirement.id
          AND shift.cancelled_at IS NULL
          AND shift.status IN ('draft', 'published', 'completed')
      ) assigned ON true
      WHERE requirement.tenant_id = $1
        AND requirement.shoot_id = $2
      ORDER BY requirement.sort_order ASC, requirement.created_at ASC
    `,
    [tenantId, shootId]
  );
  return rows;
}

async function buildIntakeResponse(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  options: { requireDraft?: boolean } = {}
): Promise<CentralJobIntakeResponse> {
  const jobRow = await loadDraftJobRow(client, auth.tenantId, shootId);
  if (!jobRow) {
    throw new ApiError(404, options.requireDraft ? "Draft not found" : "Job not found");
  }
  if (options.requireDraft && jobRow.record_state !== "draft") {
    throw new ApiError(404, "Draft not found");
  }
  await assertDepartmentAccess(auth, jobRow.department);

  const job = mapSummaryRow(jobRow);
  const jobDays = await loadJobDays(client, auth.tenantId, shootId);
  const schoolDetail = await loadSchoolDetail(client, auth.tenantId, shootId);
  const sportsDetail = await loadSportsDetail(client, auth.tenantId, shootId);
  const productionItems = await loadProductionItems(client, auth.tenantId, shootId);
  const staffingRequirements = await loadStaffingRequirements(client, auth.tenantId, shootId);
  const activityLog = await loadActivityLog(client, auth.tenantId, shootId);
  const normalized = normalizeIntakePayload({
    department: job.department,
    job_type: job.job_type,
    job_title: job.title,
    request_source: job.request_source,
    source_reference: job.source_reference,
    organization_id: job.organization_id,
    unresolved_organization_name: job.unresolved_organization_name,
    location_id: job.location_id,
    unresolved_location_name: job.unresolved_location_name,
    primary_contact_id: job.primary_contact_id,
    unresolved_primary_contact_name: job.unresolved_primary_contact_name,
    account_owner_user_id: job.account_owner_user_id,
    job_owner_user_id: job.job_owner_user_id,
    start_date: job.start_date,
    start_time: job.start_time,
    end_time: job.end_time,
    timezone: job.timezone,
    date_only: job.date_only,
    is_multi_day: job.is_multi_day,
    delivery_due_date: job.delivery_due_date,
    production_required: job.production_required,
    staffing_required: job.staffing_required,
    staffing_estimate: job.staffing_estimate,
    priority: job.priority,
    delivery_type: job.delivery_type,
    production_grouping_rule: job.production_grouping_rule,
    internal_notes: job.internal_notes,
    client_notes: job.client_notes,
    special_instructions: job.special_instructions,
    raw_source_text: job.raw_source_text,
    duplicate_override_note: job.duplicate_override_note,
    days: jobDays.map((day) => ({
      day_index: day.day_index,
      shoot_date: day.shoot_date,
      start_time: day.start_time,
      end_time: day.end_time,
      timezone: day.timezone,
      location_id: day.location_id,
      date_only: day.date_only,
      start_time_confirmed: day.start_time_confirmed
    })),
    school_detail: schoolDetail
      ? {
          school_job_type: schoolDetail.school_job_type,
          school_type: schoolDetail.school_type,
          student_count_estimate: schoolDetail.student_count_estimate,
          staff_count_estimate: schoolDetail.staff_count_estimate,
          grade_range: schoolDetail.grade_range,
          camera_count_estimate: schoolDetail.camera_count_estimate,
          roster_status: schoolDetail.roster_status,
          roster_due_date: schoolDetail.roster_due_date,
          id_required: schoolDetail.id_required,
          id_sort_method: schoolDetail.id_sort_method,
          yearbook_required: schoolDetail.yearbook_required,
          yearbook_due_date: schoolDetail.yearbook_due_date,
          staff_packages_required: schoolDetail.staff_packages_required,
          parent_communication_needed: schoolDetail.parent_communication_needed,
          background_requirements: schoolDetail.background_requirements,
          school_day_notes: schoolDetail.school_day_notes,
          building_instructions: schoolDetail.building_instructions,
          photo_day_special_notes: schoolDetail.photo_day_special_notes
        }
      : null,
    sports_detail: sportsDetail
      ? {
          sports_job_type: sportsDetail.sports_job_type,
          sport_name: sportsDetail.sport_name,
          season: sportsDetail.season,
          level_or_age_group: sportsDetail.level_or_age_group,
          team_count_estimate: sportsDetail.team_count_estimate,
          athlete_count_estimate: sportsDetail.athlete_count_estimate,
          coach_count_estimate: sportsDetail.coach_count_estimate,
          coach_contact_id: sportsDetail.coach_contact_id,
          alternate_team_contact_id: sportsDetail.alternate_team_contact_id,
          specialty_products_required: sportsDetail.specialty_products_required,
          specialty_product_types: sportsDetail.specialty_product_types,
          gallery_required: sportsDetail.gallery_required,
          delivery_deadline_type: sportsDetail.delivery_deadline_type,
          uniform_notes: sportsDetail.uniform_notes,
          sponsor_notes: sportsDetail.sponsor_notes,
          event_notes: sportsDetail.event_notes,
          on_site_sales_notes: sportsDetail.on_site_sales_notes
        }
      : null
  });
  const draftValidation = validateJobDraft(normalized);
  const readiness = evaluateJobReadiness(toReadinessInput(job, schoolDetail, sportsDetail));
  const publishValidation = validateJobPublish({
    ...normalized,
    duplicate_check_completed_at: job.duplicate_check_completed_at
  });

  return {
    job,
    job_days: jobDays,
    school_detail: schoolDetail,
    sports_detail: sportsDetail,
    draft_validation: draftValidation,
    publish_validation: publishValidation,
    readiness,
    production_items: productionItems,
    staffing_requirements: staffingRequirements,
    activity_log: activityLog
  };
}

async function buildDraftResponse(client: PoolClient, auth: AuthUser, shootId: string): Promise<CentralJobDraftResponse> {
  return buildIntakeResponse(client, auth, shootId, { requireDraft: true });
}

export async function listDraftJobs(
  client: PoolClient,
  auth: AuthUser,
  options: { department?: CentralJobDepartment | null } = {}
) {
  if (options.department) {
    await assertDepartmentAccess(auth, options.department);
  }
  const values: Array<string> = [auth.tenantId, auth.id];
  let where = `
      WHERE s.tenant_id = $1
        AND s.deleted_at IS NULL
        AND s.record_state = 'draft'::shoot_record_state
    `;
  if (options.department) {
    values.push(options.department);
    where += ` AND s.department = $${values.length}::department_code`;
  }

  const { rows } = await client.query<CentralJobDraftListItem>(
    `
      SELECT
        s.id::text,
        s.title,
        s.department::text AS department,
        s.job_number,
        o.display_name AS organization_display_name,
        s.unresolved_organization_name,
        CASE WHEN s.schedule_date_placeholder THEN NULL ELSE s.shoot_date::text END AS start_date,
        s.updated_at::text,
        s.created_at::text,
        s.job_owner_user_id::text,
        job_owner.full_name AS job_owner_name,
        s.created_by::text,
        s.updated_by_user_id::text,
        CASE
          WHEN s.job_owner_user_id = $2::uuid THEN true
          WHEN s.updated_by_user_id = $2::uuid THEN true
          WHEN s.created_by = $2::uuid THEN true
          ELSE false
        END AS is_user_relevant
      FROM shoot s
      LEFT JOIN organization o
        ON o.tenant_id = s.tenant_id
       AND o.id = s.organization_id
      LEFT JOIN app_user job_owner
        ON job_owner.id = s.job_owner_user_id
      ${where}
      ORDER BY
        CASE
          WHEN s.job_owner_user_id = $2::uuid THEN 0
          WHEN s.updated_by_user_id = $2::uuid THEN 1
          WHEN s.created_by = $2::uuid THEN 2
          ELSE 3
        END ASC,
        s.updated_at DESC,
        s.created_at DESC
      LIMIT 50
    `,
    values
  );

  return {
    drafts: rows
  };
}

async function persistReadinessEvaluation(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  readiness: CentralJobReadinessEvaluation
) {
  await client.query(
    `
      UPDATE shoot
      SET readiness_status = $3::shoot_readiness_status,
          updated_by_user_id = $4,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, shootId, readiness.readiness_status, auth.id]
  );

  await client.query("DELETE FROM shoot_readiness_item WHERE tenant_id = $1 AND shoot_id = $2", [auth.tenantId, shootId]);
  for (const item of readiness.items) {
    await client.query(
      `
        INSERT INTO shoot_readiness_item (
          tenant_id, shoot_id, code, label, blocking, status, detail
        )
        VALUES ($1,$2,$3,$4,$5,$6::shoot_readiness_item_status,$7)
      `,
      [auth.tenantId, shootId, item.code, item.label, item.blocking, item.status, item.detail]
    );
  }
}

async function upsertSchoolDetail(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  normalized: CentralJobNormalizedPayload["school_detail"]
) {
  await client.query(
    `
      INSERT INTO shoot_school_detail (
        shoot_id, tenant_id, school_job_type, school_type, student_count_estimate, staff_count_estimate,
        grade_range, camera_count_estimate, roster_status, roster_due_date, id_required, id_sort_method,
        yearbook_required, yearbook_due_date, staff_packages_required, parent_communication_needed,
        background_requirements, school_day_notes, building_instructions, photo_day_special_notes
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11,$12,$13,$14::date,$15,$16,$17,$18,$19,$20
      )
      ON CONFLICT (shoot_id) DO UPDATE SET
        school_job_type = EXCLUDED.school_job_type,
        school_type = EXCLUDED.school_type,
        student_count_estimate = EXCLUDED.student_count_estimate,
        staff_count_estimate = EXCLUDED.staff_count_estimate,
        grade_range = EXCLUDED.grade_range,
        camera_count_estimate = EXCLUDED.camera_count_estimate,
        roster_status = EXCLUDED.roster_status,
        roster_due_date = EXCLUDED.roster_due_date,
        id_required = EXCLUDED.id_required,
        id_sort_method = EXCLUDED.id_sort_method,
        yearbook_required = EXCLUDED.yearbook_required,
        yearbook_due_date = EXCLUDED.yearbook_due_date,
        staff_packages_required = EXCLUDED.staff_packages_required,
        parent_communication_needed = EXCLUDED.parent_communication_needed,
        background_requirements = EXCLUDED.background_requirements,
        school_day_notes = EXCLUDED.school_day_notes,
        building_instructions = EXCLUDED.building_instructions,
        photo_day_special_notes = EXCLUDED.photo_day_special_notes,
        updated_at = now()
    `,
    [
      shootId,
      auth.tenantId,
      normalized.school_job_type,
      normalized.school_type,
      normalized.student_count_estimate,
      normalized.staff_count_estimate,
      normalized.grade_range,
      normalized.camera_count_estimate,
      normalized.roster_status ?? "unknown",
      normalized.roster_due_date,
      normalized.id_required,
      normalized.id_sort_method,
      normalized.yearbook_required,
      normalized.yearbook_due_date,
      normalized.staff_packages_required,
      normalized.parent_communication_needed,
      normalized.background_requirements,
      normalized.school_day_notes,
      normalized.building_instructions,
      normalized.photo_day_special_notes
    ]
  );
}

async function upsertSportsDetail(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  normalized: CentralJobNormalizedPayload["sports_detail"]
) {
  await client.query(
    `
      INSERT INTO shoot_sports_detail (
        shoot_id, tenant_id, sports_job_type, sport_name, season, level_or_age_group,
        team_count_estimate, athlete_count_estimate, coach_count_estimate, coach_contact_id,
        alternate_team_contact_id, specialty_products_required, specialty_product_types, gallery_required,
        delivery_deadline_type, uniform_notes, sponsor_notes, event_notes, on_site_sales_notes
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid,$11::uuid,$12,$13::text[],$14,$15,$16,$17,$18,$19
      )
      ON CONFLICT (shoot_id) DO UPDATE SET
        sports_job_type = EXCLUDED.sports_job_type,
        sport_name = EXCLUDED.sport_name,
        season = EXCLUDED.season,
        level_or_age_group = EXCLUDED.level_or_age_group,
        team_count_estimate = EXCLUDED.team_count_estimate,
        athlete_count_estimate = EXCLUDED.athlete_count_estimate,
        coach_count_estimate = EXCLUDED.coach_count_estimate,
        coach_contact_id = EXCLUDED.coach_contact_id,
        alternate_team_contact_id = EXCLUDED.alternate_team_contact_id,
        specialty_products_required = EXCLUDED.specialty_products_required,
        specialty_product_types = EXCLUDED.specialty_product_types,
        gallery_required = EXCLUDED.gallery_required,
        delivery_deadline_type = EXCLUDED.delivery_deadline_type,
        uniform_notes = EXCLUDED.uniform_notes,
        sponsor_notes = EXCLUDED.sponsor_notes,
        event_notes = EXCLUDED.event_notes,
        on_site_sales_notes = EXCLUDED.on_site_sales_notes,
        updated_at = now()
    `,
    [
      shootId,
      auth.tenantId,
      normalized.sports_job_type,
      normalized.sport_name,
      normalized.season,
      normalized.level_or_age_group,
      normalized.team_count_estimate,
      normalized.athlete_count_estimate,
      normalized.coach_count_estimate,
      normalized.coach_contact_id,
      normalized.alternate_team_contact_id,
      normalized.specialty_products_required,
      normalized.specialty_product_types,
      normalized.gallery_required,
      normalized.delivery_deadline_type,
      normalized.uniform_notes,
      normalized.sponsor_notes,
      normalized.event_notes,
      normalized.on_site_sales_notes
    ]
  );
}

async function upsertShootDay(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  normalized: CentralJobNormalizedPayload
) {
  const dayRows =
    normalized.days.length > 0
      ? normalized.days.map((day, index) => {
          const startTime = day.start_time ?? (day.date_only ? null : PLACEHOLDER_START_TIME);
          const endTime =
            day.end_time ??
            (startTime == null || day.date_only ? null : addMinutesToTimeString(startTime, 60));
          return {
            day_index: day.day_index ?? index,
            shoot_date: day.shoot_date ?? normalized.start_date ?? defaultDraftScheduleDate(),
            start_time: startTime,
            end_time: endTime,
            timezone: day.timezone ?? normalized.timezone,
            location_id: day.location_id ?? normalized.location_id,
            date_only: day.date_only,
            start_time_confirmed: day.date_only ? false : Boolean(day.start_time_confirmed && startTime)
          };
        })
      : [
          {
            day_index: 0,
            shoot_date: normalized.start_date ?? defaultDraftScheduleDate(),
            start_time: normalized.date_only ? null : normalized.start_time ?? PLACEHOLDER_START_TIME,
            end_time:
              normalized.date_only || (!normalized.start_time && !normalized.end_time)
                ? null
                : normalized.end_time ?? addMinutesToTimeString(normalized.start_time ?? PLACEHOLDER_START_TIME, 60),
            timezone: normalized.timezone,
            location_id: normalized.location_id,
            date_only: normalized.date_only,
            start_time_confirmed: normalized.date_only ? false : Boolean(normalized.start_time)
          }
        ];

  await client.query("DELETE FROM shoot_day WHERE tenant_id = $1 AND shoot_id = $2", [auth.tenantId, shootId]);
  for (const day of dayRows) {
    await client.query(
      `
        INSERT INTO shoot_day (
          tenant_id, shoot_id, day_index, shoot_date, start_time, end_time, time_zone, location_id, date_only, start_time_confirmed
        )
        VALUES ($1,$2,$3,$4::date,$5::time,$6::time,$7,$8::uuid,$9,$10)
      `,
      [
        auth.tenantId,
        shootId,
        day.day_index,
        day.shoot_date,
        day.start_time,
        day.end_time,
        day.timezone,
        day.location_id,
        day.date_only,
        day.start_time_confirmed
      ]
    );
  }
}

export async function resolveOrganizationDefaults(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  department: CentralJobDepartment
): Promise<CentralJobOrganizationDefaults> {
  const { rows } = await client.query<{
    organization_id: string;
    organization_name: string;
    account_owner_user_id: string | null;
    primary_location_id: string | null;
    primary_location_name: string | null;
  }>(
    `
      SELECT
        o.id::text AS organization_id,
        o.display_name AS organization_name,
        sp.primary_internal_owner_user_id::text AS account_owner_user_id,
        sp.primary_location_id::text AS primary_location_id,
        sl.name AS primary_location_name
      FROM organization o
      LEFT JOIN school_profile sp
        ON sp.tenant_id = o.tenant_id
       AND sp.organization_id = o.id
      LEFT JOIN shoot_location sl
        ON sl.tenant_id = o.tenant_id
       AND sl.id = sp.primary_location_id
      WHERE o.tenant_id = $1
        AND o.id = $2
      LIMIT 1
    `,
    [auth.tenantId, organizationId]
  );

  const organization = rows[0];
  if (!organization) {
    throw new ApiError(404, "Organization not found");
  }

  let defaultLocationId = organization.primary_location_id;
  let defaultLocationName = organization.primary_location_name;

  if (!defaultLocationId) {
    const locationRows = await client.query<{ id: string; name: string }>(
      `
        SELECT id::text, name
        FROM shoot_location
        WHERE tenant_id = $1
          AND organization_id = $2
          AND active_status = 'active'
        ORDER BY updated_at DESC, created_at DESC, name ASC
        LIMIT 2
      `,
      [auth.tenantId, organizationId]
    );
    if (locationRows.rows.length === 1) {
      defaultLocationId = locationRows.rows[0].id;
      defaultLocationName = locationRows.rows[0].name;
    }
  }

  const contactRows = await client.query<{ id: string; full_name: string }>(
    `
      SELECT oc.id::text, oc.full_name
      FROM organization_contact oc
      LEFT JOIN organization_contact_relationship ocr
        ON ocr.tenant_id = oc.tenant_id
       AND ocr.contact_id = oc.id
       AND ocr.organization_id = $2
       AND ocr.is_current = true
      WHERE oc.tenant_id = $1
        AND (oc.organization_id = $2 OR ocr.organization_id = $2)
        AND oc.active_status = 'active'
      ORDER BY COALESCE(ocr.is_primary, false) DESC, COALESCE(ocr.is_current, false) DESC, oc.updated_at DESC, oc.created_at DESC
      LIMIT 1
    `,
    [auth.tenantId, organizationId]
  );

  return {
    organization_id: organization.organization_id,
    organization_name: organization.organization_name,
    department,
    account_owner_user_id: organization.account_owner_user_id,
    default_location_id: defaultLocationId,
    default_location_name: defaultLocationName,
    default_primary_contact_id: contactRows.rows[0]?.id ?? null,
    default_primary_contact_name: contactRows.rows[0]?.full_name ?? null,
    timezone: DEFAULT_TIMEZONE,
    production_required: true,
    staffing_required: true
  };
}

async function createDraftRecord(
  client: PoolClient,
  auth: AuthUser,
  normalized: CentralJobNormalizedPayload,
  defaults: CentralJobOrganizationDefaults | null
) {
  if (!normalized.department) {
    throw new ApiError(400, "Validation failed", {
      field_errors: { department: ["Department is required."] },
      form_errors: []
    });
  }

  await assertDepartmentAccess(auth, normalized.department);
  await ensureResolvedLinksBelongToOrganization(
    client,
    auth.tenantId,
    normalized.organization_id,
    normalized.location_id,
    normalized.primary_contact_id
  );

  const title = buildJobAutoTitle({
    ...normalized,
    organization_display_name: defaults?.organization_name ?? null
  });
  const studioId = await resolveDefaultStudioId(client, auth.tenantId);
  const resolvedLocation = await loadResolvedLocation(client, auth.tenantId, normalized.location_id);
  const resolvedContact = await loadResolvedContact(client, auth.tenantId, normalized.primary_contact_id);
  const effectiveDate = normalized.start_date ?? defaultDraftScheduleDate();
  const effectiveStartTime = normalized.start_time ?? PLACEHOLDER_START_TIME;
  const effectiveEndTime = normalized.end_time ?? addMinutesToTimeString(effectiveStartTime, 60);
  const effectiveArrivalTime = normalized.start_time ? addMinutesToTimeString(effectiveStartTime, -15) : PLACEHOLDER_ARRIVAL_TIME;

  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO shoot (
        tenant_id,
        studio_id,
        department,
        organization_id,
        location_id,
        primary_contact_id,
        shoot_type,
        shoot_subtype,
        shoot_code,
        title,
        shoot_date,
        location_name,
        location_address,
        location_lat,
        location_lng,
        geofence_radius_meters,
        shoot_category,
        arrival_time,
        start_time,
        end_time_est,
        status,
        request_source,
        source_reference,
        record_state,
        job_status,
        readiness_status,
        unresolved_organization_name,
        unresolved_location_name,
        unresolved_primary_contact_name,
        account_owner_user_id,
        job_owner_user_id,
        time_zone,
        is_multi_day,
        delivery_due_date,
        production_required,
        staffing_required,
        staffing_estimate,
        job_priority,
        delivery_type,
        production_grouping_rule,
        internal_notes,
        client_notes,
        special_instructions,
        raw_source_text,
        duplicate_override_note,
        duplicate_check_completed_at,
        schedule_sync_required,
        schedule_sync_state,
        schedule_date_placeholder,
        created_by,
        updated_by_user_id
      )
      VALUES (
        $1,$2,$3::department_code,$4::uuid,$5::uuid,$6::uuid,$7::organization_account_type,$8,$9,$10,$11::date,
        $12,$13,$14,$15,200,$16,
        (($11::date)::timestamp + $17::time) AT TIME ZONE $18,
        (($11::date)::timestamp + $19::time) AT TIME ZONE $18,
        (($11::date)::timestamp + $20::time) AT TIME ZONE $18,
        'DRAFT'::shoot_status,$21::shoot_request_source,$22,'draft'::shoot_record_state,'new'::shoot_job_status,
        'needs_info'::shoot_readiness_status,$23,$24,$25,$26::uuid,$27::uuid,$18,$28,$29::date,$30,$31,$32,
        $33::shoot_job_priority,$34::shoot_delivery_type,$35::shoot_production_grouping_rule,$36,$37,$38,$39,$40,NULL,
        false,'not_linked'::schedule_sync_state,$41,$42::uuid,$42::uuid
      )
      RETURNING id
    `,
    [
      auth.tenantId,
      studioId,
      normalized.department,
      normalized.organization_id,
      normalized.location_id,
      normalized.primary_contact_id,
      normalized.job_type,
      deriveDepartmentSubtype(normalized),
      buildSafeShootCode(),
      title,
      effectiveDate,
      mapLocationName(resolvedLocation?.name ?? defaults?.default_location_name ?? null, normalized.unresolved_location_name),
      resolvedLocation?.address ?? "",
      resolvedLocation?.latitude ?? PLACEHOLDER_LATITUDE,
      resolvedLocation?.longitude ?? PLACEHOLDER_LONGITUDE,
      normalized.department === "schools" ? "schools" : "sports",
      effectiveArrivalTime,
      normalized.timezone,
      effectiveStartTime,
      effectiveEndTime,
      normalized.request_source,
      normalized.source_reference,
      normalized.unresolved_organization_name,
      normalized.unresolved_location_name,
      normalized.unresolved_primary_contact_name ?? resolvedContact?.full_name ?? defaults?.default_primary_contact_name ?? null,
      normalized.account_owner_user_id ?? defaults?.account_owner_user_id ?? null,
      normalized.job_owner_user_id,
      normalized.is_multi_day,
      normalized.delivery_due_date,
      normalized.production_required,
      normalized.staffing_required,
      normalized.staffing_estimate,
      normalized.priority,
      normalized.delivery_type,
      normalized.production_grouping_rule,
      normalized.internal_notes,
      normalized.client_notes,
      normalized.special_instructions,
      normalized.raw_source_text,
      normalized.duplicate_override_note,
      normalized.start_date == null,
      auth.id
    ]
  );

  const shootId = rows[0].id;
  await upsertShootDay(client, auth, shootId, normalized);
  if (normalized.department === "schools") {
    await upsertSchoolDetail(client, auth, shootId, normalized.school_detail);
    await client.query("DELETE FROM shoot_sports_detail WHERE tenant_id = $1 AND shoot_id = $2", [auth.tenantId, shootId]);
  } else {
    await upsertSportsDetail(client, auth, shootId, normalized.sports_detail);
    await client.query("DELETE FROM shoot_school_detail WHERE tenant_id = $1 AND shoot_id = $2", [auth.tenantId, shootId]);
  }

  await writeActivityLog(client, auth, shootId, "draft_created", {
    department: normalized.department,
    request_source: normalized.request_source,
    organization_id: normalized.organization_id,
    unresolved_organization_name: normalized.unresolved_organization_name
  });
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "central_job_intake.draft_created",
    entityType: "shoot",
    entityId: shootId,
    metadata: {
      department: normalized.department,
      request_source: normalized.request_source,
      organization_id: normalized.organization_id
    }
  });

  const response = await buildDraftResponse(client, auth, shootId);
  await persistReadinessEvaluation(client, auth, shootId, response.readiness);
  return buildDraftResponse(client, auth, shootId);
}

export async function createDraftJob(
  client: PoolClient,
  auth: AuthUser,
  input: CentralJobIntakeInput
): Promise<CentralJobDraftResponse> {
  const normalized = normalizeIntakePayload(input);
  const draftValidation = validateJobDraft(normalized);
  if (!draftValidation.valid) {
    throw new ApiError(400, "Validation failed", buildFieldErrors(draftValidation.errors));
  }
  const defaults =
    normalized.organization_id && normalized.department
      ? await resolveOrganizationDefaults(client, auth, normalized.organization_id, normalized.department)
      : null;
  return createDraftRecord(client, auth, normalized, defaults);
}

export async function getDraftJob(client: PoolClient, auth: AuthUser, shootId: string) {
  return buildDraftResponse(client, auth, shootId);
}

export async function updateDraftJob(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  patch: CentralJobIntakeInput
): Promise<CentralJobDraftResponse> {
  const existing = await buildDraftResponse(client, auth, shootId);
  const sanitized = sanitizeProtectedFieldUpdates(existing.job, patch, auth);
  const mergedInput: CentralJobIntakeInput = {
    department: patch.department ?? existing.job.department,
    job_type: patch.job_type ?? existing.job.job_type,
    job_title: patch.job_title ?? existing.job.title,
    request_source: patch.request_source ?? existing.job.request_source,
    source_reference: patch.source_reference ?? existing.job.source_reference,
    organization_id: Object.prototype.hasOwnProperty.call(sanitized.patch, "organization_id")
      ? sanitized.patch.organization_id ?? null
      : existing.job.organization_id,
    unresolved_organization_name: Object.prototype.hasOwnProperty.call(sanitized.patch, "unresolved_organization_name")
      ? sanitized.patch.unresolved_organization_name ?? null
      : existing.job.unresolved_organization_name,
    location_id: Object.prototype.hasOwnProperty.call(sanitized.patch, "location_id")
      ? sanitized.patch.location_id ?? null
      : existing.job.location_id,
    unresolved_location_name: Object.prototype.hasOwnProperty.call(sanitized.patch, "unresolved_location_name")
      ? sanitized.patch.unresolved_location_name ?? null
      : existing.job.unresolved_location_name,
    primary_contact_id: Object.prototype.hasOwnProperty.call(sanitized.patch, "primary_contact_id")
      ? sanitized.patch.primary_contact_id ?? null
      : existing.job.primary_contact_id,
    unresolved_primary_contact_name: Object.prototype.hasOwnProperty.call(sanitized.patch, "unresolved_primary_contact_name")
      ? sanitized.patch.unresolved_primary_contact_name ?? null
      : existing.job.unresolved_primary_contact_name,
    account_owner_user_id: patch.account_owner_user_id ?? existing.job.account_owner_user_id,
    job_owner_user_id: patch.job_owner_user_id ?? existing.job.job_owner_user_id,
    start_date: Object.prototype.hasOwnProperty.call(sanitized.patch, "start_date")
      ? sanitized.patch.start_date ?? null
      : existing.job.start_date,
    start_time: Object.prototype.hasOwnProperty.call(sanitized.patch, "start_time")
      ? sanitized.patch.start_time ?? null
      : existing.job.start_time,
    end_time: Object.prototype.hasOwnProperty.call(sanitized.patch, "end_time")
      ? sanitized.patch.end_time ?? null
      : existing.job.end_time,
    timezone: patch.timezone ?? existing.job.timezone,
    date_only: Object.prototype.hasOwnProperty.call(sanitized.patch, "date_only")
      ? sanitized.patch.date_only ?? false
      : existing.job.date_only,
    is_multi_day: patch.is_multi_day ?? existing.job.is_multi_day,
    delivery_due_date: Object.prototype.hasOwnProperty.call(sanitized.patch, "delivery_due_date")
      ? sanitized.patch.delivery_due_date ?? null
      : existing.job.delivery_due_date,
    production_required: Object.prototype.hasOwnProperty.call(sanitized.patch, "production_required")
      ? sanitized.patch.production_required ?? existing.job.production_required
      : existing.job.production_required,
    staffing_required: Object.prototype.hasOwnProperty.call(sanitized.patch, "staffing_required")
      ? sanitized.patch.staffing_required ?? existing.job.staffing_required
      : existing.job.staffing_required,
    staffing_estimate: Object.prototype.hasOwnProperty.call(sanitized.patch, "staffing_estimate")
      ? sanitized.patch.staffing_estimate ?? null
      : existing.job.staffing_estimate,
    priority: patch.priority ?? existing.job.priority,
    delivery_type: Object.prototype.hasOwnProperty.call(sanitized.patch, "delivery_type")
      ? sanitized.patch.delivery_type ?? null
      : existing.job.delivery_type,
    production_grouping_rule: patch.production_grouping_rule ?? existing.job.production_grouping_rule,
    internal_notes: Object.prototype.hasOwnProperty.call(sanitized.patch, "internal_notes")
      ? sanitized.patch.internal_notes ?? null
      : existing.job.internal_notes,
    client_notes: Object.prototype.hasOwnProperty.call(sanitized.patch, "client_notes")
      ? sanitized.patch.client_notes ?? null
      : existing.job.client_notes,
    special_instructions: Object.prototype.hasOwnProperty.call(sanitized.patch, "special_instructions")
      ? sanitized.patch.special_instructions ?? null
      : existing.job.special_instructions,
    raw_source_text: Object.prototype.hasOwnProperty.call(sanitized.patch, "raw_source_text")
      ? sanitized.patch.raw_source_text ?? null
      : existing.job.raw_source_text,
    duplicate_override_note: patch.duplicate_override_note ?? existing.job.duplicate_override_note,
    school_detail: {
      school_job_type: sanitized.patch.school_detail?.school_job_type ?? existing.school_detail?.school_job_type ?? null,
      school_type: sanitized.patch.school_detail?.school_type ?? existing.school_detail?.school_type ?? null,
      student_count_estimate:
        sanitized.patch.school_detail?.student_count_estimate ?? existing.school_detail?.student_count_estimate ?? null,
      staff_count_estimate:
        sanitized.patch.school_detail?.staff_count_estimate ?? existing.school_detail?.staff_count_estimate ?? null,
      grade_range: sanitized.patch.school_detail?.grade_range ?? existing.school_detail?.grade_range ?? null,
      camera_count_estimate:
        sanitized.patch.school_detail?.camera_count_estimate ?? existing.school_detail?.camera_count_estimate ?? null,
      roster_status: sanitized.patch.school_detail?.roster_status ?? existing.school_detail?.roster_status ?? null,
      roster_due_date: sanitized.patch.school_detail?.roster_due_date ?? existing.school_detail?.roster_due_date ?? null,
      id_required: sanitized.patch.school_detail?.id_required ?? existing.school_detail?.id_required ?? false,
      id_sort_method: sanitized.patch.school_detail?.id_sort_method ?? existing.school_detail?.id_sort_method ?? null,
      yearbook_required: sanitized.patch.school_detail?.yearbook_required ?? existing.school_detail?.yearbook_required ?? false,
      yearbook_due_date: sanitized.patch.school_detail?.yearbook_due_date ?? existing.school_detail?.yearbook_due_date ?? null,
      staff_packages_required:
        sanitized.patch.school_detail?.staff_packages_required ?? existing.school_detail?.staff_packages_required ?? false,
      parent_communication_needed:
        sanitized.patch.school_detail?.parent_communication_needed ?? existing.school_detail?.parent_communication_needed ?? false,
      background_requirements:
        sanitized.patch.school_detail?.background_requirements ?? existing.school_detail?.background_requirements ?? null,
      school_day_notes: sanitized.patch.school_detail?.school_day_notes ?? existing.school_detail?.school_day_notes ?? null,
      building_instructions:
        sanitized.patch.school_detail?.building_instructions ?? existing.school_detail?.building_instructions ?? null,
      photo_day_special_notes:
        sanitized.patch.school_detail?.photo_day_special_notes ?? existing.school_detail?.photo_day_special_notes ?? null
    },
    sports_detail: {
      sports_job_type: sanitized.patch.sports_detail?.sports_job_type ?? existing.sports_detail?.sports_job_type ?? null,
      sport_name: sanitized.patch.sports_detail?.sport_name ?? existing.sports_detail?.sport_name ?? null,
      season: sanitized.patch.sports_detail?.season ?? existing.sports_detail?.season ?? null,
      level_or_age_group:
        sanitized.patch.sports_detail?.level_or_age_group ?? existing.sports_detail?.level_or_age_group ?? null,
      team_count_estimate:
        sanitized.patch.sports_detail?.team_count_estimate ?? existing.sports_detail?.team_count_estimate ?? null,
      athlete_count_estimate:
        sanitized.patch.sports_detail?.athlete_count_estimate ?? existing.sports_detail?.athlete_count_estimate ?? null,
      coach_count_estimate:
        sanitized.patch.sports_detail?.coach_count_estimate ?? existing.sports_detail?.coach_count_estimate ?? null,
      coach_contact_id: sanitized.patch.sports_detail?.coach_contact_id ?? existing.sports_detail?.coach_contact_id ?? null,
      alternate_team_contact_id:
        sanitized.patch.sports_detail?.alternate_team_contact_id ?? existing.sports_detail?.alternate_team_contact_id ?? null,
      specialty_products_required:
        sanitized.patch.sports_detail?.specialty_products_required ?? existing.sports_detail?.specialty_products_required ?? false,
      specialty_product_types:
        sanitized.patch.sports_detail?.specialty_product_types ?? existing.sports_detail?.specialty_product_types ?? [],
      gallery_required: sanitized.patch.sports_detail?.gallery_required ?? existing.sports_detail?.gallery_required ?? false,
      delivery_deadline_type:
        sanitized.patch.sports_detail?.delivery_deadline_type ?? existing.sports_detail?.delivery_deadline_type ?? null,
      uniform_notes: sanitized.patch.sports_detail?.uniform_notes ?? existing.sports_detail?.uniform_notes ?? null,
      sponsor_notes: sanitized.patch.sports_detail?.sponsor_notes ?? existing.sports_detail?.sponsor_notes ?? null,
      event_notes: sanitized.patch.sports_detail?.event_notes ?? existing.sports_detail?.event_notes ?? null,
      on_site_sales_notes:
        sanitized.patch.sports_detail?.on_site_sales_notes ?? existing.sports_detail?.on_site_sales_notes ?? null
    }
  };

  const normalized = normalizeIntakePayload(mergedInput);
  const draftValidation = validateJobDraft(normalized);
  if (!draftValidation.valid) {
    throw new ApiError(400, "Validation failed", buildFieldErrors(draftValidation.errors));
  }
  await assertDepartmentAccess(auth, normalized.department!);
  await ensureResolvedLinksBelongToOrganization(
    client,
    auth.tenantId,
    normalized.organization_id,
    normalized.location_id,
    normalized.primary_contact_id
  );

  const defaults =
    normalized.organization_id && normalized.department
      ? await resolveOrganizationDefaults(client, auth, normalized.organization_id, normalized.department)
      : null;
  const resolvedLocation = await loadResolvedLocation(client, auth.tenantId, normalized.location_id);
  const resolvedContact = await loadResolvedContact(client, auth.tenantId, normalized.primary_contact_id);
  const effectiveDate = normalized.start_date ?? defaultDraftScheduleDate();
  const effectiveStartTime = normalized.start_time ?? PLACEHOLDER_START_TIME;
  const effectiveEndTime = normalized.end_time ?? addMinutesToTimeString(effectiveStartTime, 60);
  const effectiveArrivalTime = normalized.start_time ? addMinutesToTimeString(effectiveStartTime, -15) : PLACEHOLDER_ARRIVAL_TIME;
  const title = buildJobAutoTitle({
    ...normalized,
    organization_display_name: defaults?.organization_name ?? existing.job.organization_display_name ?? null
  });

  await client.query(
    `
      UPDATE shoot
      SET
        department = $3::department_code,
        organization_id = $4::uuid,
        location_id = $5::uuid,
        primary_contact_id = $6::uuid,
        shoot_type = $7::organization_account_type,
        shoot_subtype = $8,
        title = $9,
        shoot_date = $10::date,
        location_name = $11,
        location_address = $12,
        location_lat = $13,
        location_lng = $14,
        arrival_time = (($10::date)::timestamp + $15::time) AT TIME ZONE $16,
        start_time = (($10::date)::timestamp + $17::time) AT TIME ZONE $16,
        end_time_est = (($10::date)::timestamp + $18::time) AT TIME ZONE $16,
        request_source = $19::shoot_request_source,
        source_reference = $20,
        unresolved_organization_name = $21,
        unresolved_location_name = $22,
        unresolved_primary_contact_name = $23,
        account_owner_user_id = $24::uuid,
        job_owner_user_id = $25::uuid,
        time_zone = $16,
        is_multi_day = $26,
        delivery_due_date = $27::date,
        production_required = $28,
        staffing_required = $29,
        staffing_estimate = $30,
        job_priority = $31::shoot_job_priority,
        delivery_type = $32::shoot_delivery_type,
        production_grouping_rule = $33::shoot_production_grouping_rule,
        internal_notes = $34,
        client_notes = $35,
        special_instructions = $36,
        raw_source_text = $37,
        duplicate_override_note = $38,
        schedule_date_placeholder = $39,
        updated_by_user_id = $40::uuid,
        duplicate_check_completed_at = CASE
          WHEN $41 THEN NULL
          ELSE duplicate_check_completed_at
        END,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
        AND record_state = 'draft'::shoot_record_state
    `,
    [
      auth.tenantId,
      shootId,
      normalized.department,
      normalized.organization_id,
      normalized.location_id,
      normalized.primary_contact_id,
      normalized.job_type,
      deriveDepartmentSubtype(normalized),
      title,
      effectiveDate,
      mapLocationName(resolvedLocation?.name ?? defaults?.default_location_name ?? null, normalized.unresolved_location_name),
      resolvedLocation?.address ?? "",
      resolvedLocation?.latitude ?? PLACEHOLDER_LATITUDE,
      resolvedLocation?.longitude ?? PLACEHOLDER_LONGITUDE,
      effectiveArrivalTime,
      normalized.timezone,
      effectiveStartTime,
      effectiveEndTime,
      normalized.request_source,
      normalized.source_reference,
      normalized.unresolved_organization_name,
      normalized.unresolved_location_name,
      normalized.unresolved_primary_contact_name ?? resolvedContact?.full_name ?? defaults?.default_primary_contact_name ?? null,
      normalized.account_owner_user_id ?? defaults?.account_owner_user_id ?? null,
      normalized.job_owner_user_id,
      normalized.is_multi_day,
      normalized.delivery_due_date,
      normalized.production_required,
      normalized.staffing_required,
      normalized.staffing_estimate,
      normalized.priority,
      normalized.delivery_type,
      normalized.production_grouping_rule,
      normalized.internal_notes,
      normalized.client_notes,
      normalized.special_instructions,
      normalized.raw_source_text,
      normalized.duplicate_override_note,
      normalized.start_date == null,
      auth.id,
      normalized.organization_id !== existing.job.organization_id ||
        normalized.location_id !== existing.job.location_id ||
        normalized.primary_contact_id !== existing.job.primary_contact_id ||
        normalized.start_date !== existing.job.start_date ||
        normalized.job_type !== existing.job.job_type
    ]
  );

  await upsertShootDay(client, auth, shootId, normalized);
  if (normalized.department === "schools") {
    await upsertSchoolDetail(client, auth, shootId, normalized.school_detail);
    await client.query("DELETE FROM shoot_sports_detail WHERE tenant_id = $1 AND shoot_id = $2", [auth.tenantId, shootId]);
  } else {
    await upsertSportsDetail(client, auth, shootId, normalized.sports_detail);
    await client.query("DELETE FROM shoot_school_detail WHERE tenant_id = $1 AND shoot_id = $2", [auth.tenantId, shootId]);
  }

  await writeActivityLog(client, auth, shootId, "draft_updated", {
    blocked_fields: sanitized.blocked_fields,
    changed_department: existing.job.department !== normalized.department,
    organization_id: normalized.organization_id,
    location_id: normalized.location_id,
    primary_contact_id: normalized.primary_contact_id
  });
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "central_job_intake.draft_updated",
    entityType: "shoot",
    entityId: shootId,
    metadata: {
      blocked_fields: sanitized.blocked_fields,
      department: normalized.department
    }
  });

  const response = await buildDraftResponse(client, auth, shootId);
  await persistReadinessEvaluation(client, auth, shootId, response.readiness);
  return buildDraftResponse(client, auth, shootId);
}

export async function refreshDraftReadiness(client: PoolClient, auth: AuthUser, shootId: string) {
  return buildDraftResponse(client, auth, shootId);
}

export async function findPotentialDuplicates(
  client: PoolClient,
  auth: Pick<AuthUser, "tenantId">,
  input: CentralJobNormalizedPayload & { current_job_id?: string | null }
): Promise<CentralJobDuplicateResult> {
  const checkedAt = new Date().toISOString();
  if (!input.organization_id || !input.department || (!input.job_type && !deriveDepartmentSubtype(input))) {
    return {
      disposition: "clear",
      hard_block: false,
      soft_warning: false,
      matching_records: [],
      checked_at: checkedAt
    };
  }

  const { rows } = await client.query<CentralJobDuplicateMatch>(
    `
      SELECT
        s.id::text,
        s.shoot_code,
        s.job_number,
        s.title,
        s.department::text AS department,
        s.shoot_type::text AS job_type,
        COALESCE(ssd.school_job_type, spd.sports_job_type) AS job_subtype,
        s.organization_id::text,
        o.display_name AS organization_name,
        s.location_id::text,
        COALESCE(sl.name, s.location_name) AS location_name,
        s.unresolved_location_name,
        s.primary_contact_id::text,
        COALESCE(oc.full_name, s.primary_contact_name, s.unresolved_primary_contact_name) AS primary_contact_name,
        CASE WHEN s.schedule_date_placeholder THEN NULL ELSE s.shoot_date::text END AS start_date,
        s.delivery_due_date::text,
        s.record_state::text AS record_state,
        s.job_status::text AS job_status,
        false AS hard_block,
        false AS soft_warning,
        ARRAY[]::text[] AS matched_rules
      FROM shoot s
      LEFT JOIN organization o
        ON o.tenant_id = s.tenant_id
       AND o.id = s.organization_id
      LEFT JOIN shoot_location sl
        ON sl.tenant_id = s.tenant_id
       AND sl.id = s.location_id
      LEFT JOIN organization_contact oc
        ON oc.tenant_id = s.tenant_id
       AND oc.id = s.primary_contact_id
      LEFT JOIN shoot_school_detail ssd
        ON ssd.tenant_id = s.tenant_id
       AND ssd.shoot_id = s.id
      LEFT JOIN shoot_sports_detail spd
        ON spd.tenant_id = s.tenant_id
       AND spd.shoot_id = s.id
      WHERE s.tenant_id = $1
        AND s.deleted_at IS NULL
        AND s.record_state NOT IN ('cancelled'::shoot_record_state, 'archived'::shoot_record_state)
        AND s.organization_id = $2::uuid
        AND ($3::uuid IS NULL OR s.id <> $3::uuid)
        AND (
          ($4::date IS NOT NULL AND s.shoot_date BETWEEN ($4::date - INTERVAL '7 days') AND ($4::date + INTERVAL '7 days'))
          OR ($5::date IS NOT NULL AND s.delivery_due_date BETWEEN ($5::date - INTERVAL '7 days') AND ($5::date + INTERVAL '7 days'))
          OR ($6::uuid IS NOT NULL AND s.primary_contact_id = $6::uuid)
        )
      ORDER BY s.shoot_date ASC, s.created_at DESC
    `,
    [auth.tenantId, input.organization_id, input.current_job_id ?? null, input.start_date, input.delivery_due_date, input.primary_contact_id]
  );

  const normalizedInputLocation = normalizeSearchText(input.unresolved_location_name);
  const matchingRecords = rows
    .map((row) => {
      const matchedRules: string[] = [];
      const sameDepartment = row.department === input.department;
      const sameJobType = row.job_type === input.job_type;
      const exactStartDate = Boolean(input.start_date && row.start_date && input.start_date === row.start_date);
      const sameResolvedLocation = Boolean(input.location_id && row.location_id && input.location_id === row.location_id);
      const sameUnresolvedLocation =
        !input.location_id &&
        !row.location_id &&
        Boolean(normalizedInputLocation) &&
        normalizedInputLocation === normalizeSearchText(row.unresolved_location_name);
      const samePrimaryContact =
        Boolean(input.primary_contact_id && row.primary_contact_id && input.primary_contact_id === row.primary_contact_id);
      const dateDistance = daysBetween(input.start_date, row.start_date);
      const dueDistance = daysBetween(input.delivery_due_date, row.delivery_due_date);

      if (sameDepartment && sameJobType && exactStartDate && (sameResolvedLocation || sameUnresolvedLocation)) {
        matchedRules.push("hard_same_department_organization_type_location_start_date");
      }
      if (sameJobType && dateDistance != null && Math.abs(dateDistance) <= 7) {
        matchedRules.push("soft_same_organization_type_date_window");
      }
      if (samePrimaryContact && dueDistance != null && Math.abs(dueDistance) <= 7) {
        matchedRules.push("soft_same_organization_contact_delivery_window");
      }

      const hardBlock = matchedRules.includes("hard_same_department_organization_type_location_start_date");
      const softWarning = !hardBlock && matchedRules.some((rule) => rule.startsWith("soft_"));
      return {
        ...row,
        hard_block: hardBlock,
        soft_warning: softWarning,
        matched_rules: matchedRules
      };
    })
    .filter((row) => row.matched_rules.length > 0);

  const hardBlock = matchingRecords.some((row) => row.hard_block);
  const softWarning = !hardBlock && matchingRecords.some((row) => row.soft_warning);
  return {
    disposition: hardBlock ? "hard_block" : softWarning ? "soft_warning" : "clear",
    hard_block: hardBlock,
    soft_warning: softWarning,
    matching_records: matchingRecords,
    checked_at: checkedAt
  };
}

function buildNormalizedPayloadFromResponse(response: CentralJobIntakeResponse): CentralJobNormalizedPayload {
  return normalizeIntakePayload({
    department: response.job.department,
    job_type: response.job.job_type,
    job_title: response.job.title,
    request_source: response.job.request_source,
    source_reference: response.job.source_reference,
    organization_id: response.job.organization_id,
    unresolved_organization_name: response.job.unresolved_organization_name,
    location_id: response.job.location_id,
    unresolved_location_name: response.job.unresolved_location_name,
    primary_contact_id: response.job.primary_contact_id,
    unresolved_primary_contact_name: response.job.unresolved_primary_contact_name,
    account_owner_user_id: response.job.account_owner_user_id,
    job_owner_user_id: response.job.job_owner_user_id,
    start_date: response.job.start_date,
    start_time: response.job.start_time,
    end_time: response.job.end_time,
    timezone: response.job.timezone,
    date_only: response.job.date_only,
    is_multi_day: response.job.is_multi_day,
    delivery_due_date: response.job.delivery_due_date,
    production_required: response.job.production_required,
    staffing_required: response.job.staffing_required,
    staffing_estimate: response.job.staffing_estimate,
    priority: response.job.priority,
    delivery_type: response.job.delivery_type,
    production_grouping_rule: response.job.production_grouping_rule,
    internal_notes: response.job.internal_notes,
    client_notes: response.job.client_notes,
    special_instructions: response.job.special_instructions,
    raw_source_text: response.job.raw_source_text,
    duplicate_override_note: response.job.duplicate_override_note,
    days: response.job_days.map((day) => ({
      day_index: day.day_index,
      shoot_date: day.shoot_date,
      start_time: day.start_time,
      end_time: day.end_time,
      timezone: day.timezone,
      location_id: day.location_id,
      date_only: day.date_only,
      start_time_confirmed: day.start_time_confirmed
    })),
    school_detail: response.school_detail
      ? {
          school_job_type: response.school_detail.school_job_type,
          school_type: response.school_detail.school_type,
          student_count_estimate: response.school_detail.student_count_estimate,
          staff_count_estimate: response.school_detail.staff_count_estimate,
          grade_range: response.school_detail.grade_range,
          camera_count_estimate: response.school_detail.camera_count_estimate,
          roster_status: response.school_detail.roster_status,
          roster_due_date: response.school_detail.roster_due_date,
          id_required: response.school_detail.id_required,
          id_sort_method: response.school_detail.id_sort_method,
          yearbook_required: response.school_detail.yearbook_required,
          yearbook_due_date: response.school_detail.yearbook_due_date,
          staff_packages_required: response.school_detail.staff_packages_required,
          parent_communication_needed: response.school_detail.parent_communication_needed,
          background_requirements: response.school_detail.background_requirements,
          school_day_notes: response.school_detail.school_day_notes,
          building_instructions: response.school_detail.building_instructions,
          photo_day_special_notes: response.school_detail.photo_day_special_notes
        }
      : null,
    sports_detail: response.sports_detail
      ? {
          sports_job_type: response.sports_detail.sports_job_type,
          sport_name: response.sports_detail.sport_name,
          season: response.sports_detail.season,
          level_or_age_group: response.sports_detail.level_or_age_group,
          team_count_estimate: response.sports_detail.team_count_estimate,
          athlete_count_estimate: response.sports_detail.athlete_count_estimate,
          coach_count_estimate: response.sports_detail.coach_count_estimate,
          coach_contact_id: response.sports_detail.coach_contact_id,
          alternate_team_contact_id: response.sports_detail.alternate_team_contact_id,
          specialty_products_required: response.sports_detail.specialty_products_required,
          specialty_product_types: response.sports_detail.specialty_product_types,
          gallery_required: response.sports_detail.gallery_required,
          delivery_deadline_type: response.sports_detail.delivery_deadline_type,
          uniform_notes: response.sports_detail.uniform_notes,
          sponsor_notes: response.sports_detail.sponsor_notes,
          event_notes: response.sports_detail.event_notes,
          on_site_sales_notes: response.sports_detail.on_site_sales_notes
        }
      : null
  });
}

export async function previewDraftDuplicates(client: PoolClient, auth: AuthUser, shootId: string) {
  const draft = await buildDraftResponse(client, auth, shootId);
  const duplicates = await findPotentialDuplicates(client, auth, {
    ...buildNormalizedPayloadFromResponse(draft),
    current_job_id: shootId
  });

  await client.query(
    `
      UPDATE shoot
      SET duplicate_check_completed_at = now(),
          duplicate_check_completed_by_user_id = $3::uuid,
          updated_by_user_id = $3::uuid,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, shootId, auth.id]
  );
  await writeActivityLog(client, auth, shootId, "duplicate_check_previewed", {
    hard_block: duplicates.hard_block,
    soft_warning: duplicates.soft_warning,
    matching_record_count: duplicates.matching_records.length
  });
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "central_job_intake.duplicate_check_previewed",
    entityType: "shoot",
    entityId: shootId,
    metadata: {
      hard_block: duplicates.hard_block,
      soft_warning: duplicates.soft_warning,
      matching_record_count: duplicates.matching_records.length
    }
  });

  return duplicates;
}

function hasOwnField<T extends object>(value: T, key: keyof T) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function toDayInputRows(days: CentralJobDayRecord[]): CentralJobIntakeInput["days"] {
  return days.map((day) => ({
    day_index: day.day_index,
    shoot_date: day.shoot_date,
    start_time: day.start_time,
    end_time: day.end_time,
    timezone: day.timezone,
    location_id: day.location_id,
    date_only: day.date_only,
    start_time_confirmed: day.start_time_confirmed
  }));
}

function mergeExistingIntakeWithPatch(
  existing: CentralJobIntakeResponse,
  patch: CentralJobIntakeInput,
  sanitizedPatch: CentralJobIntakeInput
): CentralJobIntakeInput {
  const base = buildNormalizedPayloadFromResponse(existing);
  const mergedDays = hasOwnField(sanitizedPatch, "days")
    ? sanitizedPatch.days ?? []
    : toDayInputRows(existing.job_days)?.map((day) => ({
        ...day,
        location_id: hasOwnField(sanitizedPatch, "location_id") ? sanitizedPatch.location_id ?? null : day.location_id,
        timezone: sanitizedPatch.timezone ?? day.timezone,
        shoot_date: hasOwnField(sanitizedPatch, "start_date") && day.day_index === 0 ? sanitizedPatch.start_date ?? null : day.shoot_date,
        start_time: hasOwnField(sanitizedPatch, "start_time") && day.day_index === 0 ? sanitizedPatch.start_time ?? null : day.start_time,
        end_time: hasOwnField(sanitizedPatch, "end_time") && day.day_index === 0 ? sanitizedPatch.end_time ?? null : day.end_time,
        date_only: hasOwnField(sanitizedPatch, "date_only") && day.day_index === 0 ? sanitizedPatch.date_only ?? false : day.date_only,
        start_time_confirmed:
          hasOwnField(sanitizedPatch, "start_time") && day.day_index === 0 ? Boolean(sanitizedPatch.start_time) : day.start_time_confirmed
      }));
  return {
    department: sanitizedPatch.department ?? base.department,
    job_type: sanitizedPatch.job_type ?? base.job_type,
    job_title: sanitizedPatch.job_title ?? base.job_title ?? existing.job.title,
    request_source: sanitizedPatch.request_source ?? base.request_source,
    source_reference: sanitizedPatch.source_reference ?? base.source_reference,
    organization_id: hasOwnField(sanitizedPatch, "organization_id") ? sanitizedPatch.organization_id ?? null : base.organization_id,
    unresolved_organization_name: hasOwnField(sanitizedPatch, "unresolved_organization_name")
      ? sanitizedPatch.unresolved_organization_name ?? null
      : base.unresolved_organization_name,
    location_id: hasOwnField(sanitizedPatch, "location_id") ? sanitizedPatch.location_id ?? null : base.location_id,
    unresolved_location_name: hasOwnField(sanitizedPatch, "unresolved_location_name")
      ? sanitizedPatch.unresolved_location_name ?? null
      : base.unresolved_location_name,
    primary_contact_id: hasOwnField(sanitizedPatch, "primary_contact_id")
      ? sanitizedPatch.primary_contact_id ?? null
      : base.primary_contact_id,
    unresolved_primary_contact_name: hasOwnField(sanitizedPatch, "unresolved_primary_contact_name")
      ? sanitizedPatch.unresolved_primary_contact_name ?? null
      : base.unresolved_primary_contact_name,
    account_owner_user_id: sanitizedPatch.account_owner_user_id ?? base.account_owner_user_id,
    job_owner_user_id: sanitizedPatch.job_owner_user_id ?? base.job_owner_user_id,
    start_date: hasOwnField(sanitizedPatch, "start_date") ? sanitizedPatch.start_date ?? null : base.start_date,
    start_time: hasOwnField(sanitizedPatch, "start_time") ? sanitizedPatch.start_time ?? null : base.start_time,
    end_time: hasOwnField(sanitizedPatch, "end_time") ? sanitizedPatch.end_time ?? null : base.end_time,
    timezone: sanitizedPatch.timezone ?? base.timezone,
    date_only: hasOwnField(sanitizedPatch, "date_only") ? sanitizedPatch.date_only ?? false : base.date_only,
    is_multi_day: sanitizedPatch.is_multi_day ?? base.is_multi_day,
    delivery_due_date: hasOwnField(sanitizedPatch, "delivery_due_date")
      ? sanitizedPatch.delivery_due_date ?? null
      : base.delivery_due_date,
    production_required: hasOwnField(sanitizedPatch, "production_required")
      ? sanitizedPatch.production_required ?? false
      : base.production_required,
    staffing_required: hasOwnField(sanitizedPatch, "staffing_required")
      ? sanitizedPatch.staffing_required ?? false
      : base.staffing_required,
    staffing_estimate: hasOwnField(sanitizedPatch, "staffing_estimate")
      ? sanitizedPatch.staffing_estimate ?? null
      : base.staffing_estimate,
    priority: sanitizedPatch.priority ?? base.priority,
    delivery_type: hasOwnField(sanitizedPatch, "delivery_type") ? sanitizedPatch.delivery_type ?? null : base.delivery_type,
    production_grouping_rule: sanitizedPatch.production_grouping_rule ?? base.production_grouping_rule,
    internal_notes: hasOwnField(sanitizedPatch, "internal_notes") ? sanitizedPatch.internal_notes ?? null : base.internal_notes,
    client_notes: hasOwnField(sanitizedPatch, "client_notes") ? sanitizedPatch.client_notes ?? null : base.client_notes,
    special_instructions: hasOwnField(sanitizedPatch, "special_instructions")
      ? sanitizedPatch.special_instructions ?? null
      : base.special_instructions,
    raw_source_text: hasOwnField(sanitizedPatch, "raw_source_text") ? sanitizedPatch.raw_source_text ?? null : base.raw_source_text,
    duplicate_override_note: hasOwnField(sanitizedPatch, "duplicate_override_note")
      ? sanitizedPatch.duplicate_override_note ?? null
      : base.duplicate_override_note,
    days: mergedDays,
    school_detail: {
      ...base.school_detail,
      ...(sanitizedPatch.school_detail ?? {})
    },
    sports_detail: {
      ...base.sports_detail,
      ...(sanitizedPatch.sports_detail ?? {})
    }
  };
}

function mapCentralPriorityToProductionPriority(priority: CentralJobNormalizedPayload["priority"]) {
  if (priority === "urgent") {
    return "critical" as const;
  }
  if (priority === "high") {
    return "high" as const;
  }
  if (priority === "low") {
    return "low" as const;
  }
  return "normal" as const;
}

function resolveProductionTriggerKeyForPublish(normalized: CentralJobNormalizedPayload) {
  if (normalized.department === "sports") {
    return "shoot_completed_post_production_sports";
  }
  if (normalized.school_detail.yearbook_required) {
    return "school_yearbook_intake";
  }
  if (normalized.school_detail.id_required) {
    return "school_id_production_intake";
  }
  return "school_gallery_release_intake";
}

function buildProductionShellInputs(input: {
  shootId: string;
  jobNumber: string;
  jobTitle: string;
  normalized: CentralJobNormalizedPayload;
  jobDays: CentralJobDayRecord[];
}): Array<{
  sourceEventKey: string;
  triggerKey: string;
  anchorDate: string;
  title: string;
  summary: string;
  createdReason: string;
}> {
  const triggerKey = resolveProductionTriggerKeyForPublish(input.normalized);
  const anchorDate = input.normalized.start_date ?? input.jobDays[0]?.shoot_date ?? new Date().toISOString().slice(0, 10);
  const dueAnchor = input.normalized.delivery_due_date ?? anchorDate;
  const manualSummary = "Manual grouping currently maps to one job-level production shell so downstream work is visible.";
  const baseTitle = input.jobNumber || input.jobTitle;

  switch (input.normalized.production_grouping_rule) {
    case "one_per_day":
      return (input.jobDays.length ? input.jobDays : [{ day_index: 0, shoot_date: anchorDate } as CentralJobDayRecord]).map((day) => ({
        sourceEventKey: `${CENTRAL_JOB_PRODUCTION_SOURCE_PREFIX}:${input.shootId}:day:${day.day_index}`,
        triggerKey,
        anchorDate: day.shoot_date ?? anchorDate,
        title: `${baseTitle} production day ${day.day_index + 1}`,
        summary: `${input.jobTitle} published and needs production handling for day ${day.day_index + 1}.`,
        createdReason: `${input.jobTitle} was published and production work should track day ${day.day_index + 1}.`
      }));
    case "one_per_delivery":
      return [
        {
          sourceEventKey: `${CENTRAL_JOB_PRODUCTION_SOURCE_PREFIX}:${input.shootId}:delivery`,
          triggerKey,
          anchorDate: dueAnchor,
          title: `${baseTitle} delivery production`,
          summary: `${input.jobTitle} published and needs production work grouped to delivery.`,
          createdReason: `${input.jobTitle} was published and production should track the delivery milestone.`
        }
      ];
    case "one_per_gallery":
      return [
        {
          sourceEventKey: `${CENTRAL_JOB_PRODUCTION_SOURCE_PREFIX}:${input.shootId}:gallery`,
          triggerKey,
          anchorDate: dueAnchor,
          title: `${baseTitle} gallery production`,
          summary: `${input.jobTitle} published and needs gallery-focused production tracking.`,
          createdReason: `${input.jobTitle} was published and gallery output needs production follow-through.`
        }
      ];
    case "manual":
      return [
        {
          sourceEventKey: `${CENTRAL_JOB_PRODUCTION_SOURCE_PREFIX}:${input.shootId}:manual`,
          triggerKey,
          anchorDate,
          title: `${baseTitle} manual production planning`,
          summary: `${input.jobTitle} published and requires manual production grouping. ${manualSummary}`,
          createdReason: `${input.jobTitle} was published and a manual production planning shell was opened.`
        }
      ];
    case "one_per_job":
    default:
      return [
        {
          sourceEventKey: `${CENTRAL_JOB_PRODUCTION_SOURCE_PREFIX}:${input.shootId}:job`,
          triggerKey,
          anchorDate,
          title: `${baseTitle} production`,
          summary: `${input.jobTitle} published and needs production follow-through.`,
          createdReason: `${input.jobTitle} was published and production follow-through should start.`
        }
      ];
  }
}

async function generateCanonicalJobNumber(
  client: PoolClient,
  department: CentralJobDepartment,
  startDate: string
) {
  const prefix = department === "schools" ? "SCH" : "SPT";
  const year = startDate.slice(0, 4);
  const sequence = await client.query<{ value: string }>(`SELECT nextval('${JOB_NUMBER_SEQUENCE}')::text AS value`);
  return `${prefix}-${year}-${sequence.rows[0].value.padStart(6, "0")}`;
}

async function ensureDraftCreatedActivity(client: PoolClient, auth: AuthUser, shootId: string) {
  const existing = await client.query<{ id: string }>(
    `
      SELECT id
      FROM shoot_activity_log
      WHERE tenant_id = $1
        AND shoot_id = $2
        AND event_type IN ('job_draft_created', 'draft_created')
      LIMIT 1
    `,
    [auth.tenantId, shootId]
  );
  if (!existing.rows[0]) {
    await writeActivityLog(client, auth, shootId, "job_draft_created", {});
  }
}

async function rebuildStaffingShells(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  normalized: CentralJobNormalizedPayload
) {
  await client.query(
    `
      DELETE FROM shoot_staffing_requirement
      WHERE tenant_id = $1
        AND shoot_id = $2
        AND source_of_creation = $3
    `,
    [auth.tenantId, shootId, CENTRAL_JOB_STAFFING_SOURCE]
  );

  if (!normalized.staffing_required) {
    return [] as string[];
  }

  const estimate = Math.max(Number(normalized.staffing_estimate ?? 0), 0);
  const rows =
    estimate > 0
      ? [
          {
            staffing_role: "lead_photographer",
            label: "Lead coverage",
            minimum_count: 1,
            ideal_count: 1,
            required_for_ready: true,
            lead_eligible: true,
            lead_required: true,
            sort_order: 0
          },
          ...(estimate > 1
            ? [
                {
                  staffing_role: "photographer",
                  label: "Photographer coverage",
                  minimum_count: Math.max(estimate - 1, 0),
                  ideal_count: Math.max(estimate - 1, 0),
                  required_for_ready: true,
                  lead_eligible: false,
                  lead_required: false,
                  sort_order: 1
                }
              ]
            : [])
        ]
      : [
          {
            staffing_role: "photographer",
            label: "Staffing plan needed",
            minimum_count: 0,
            ideal_count: 1,
            required_for_ready: true,
            lead_eligible: false,
            lead_required: false,
            sort_order: 0
          }
        ];

  const insertedIds: string[] = [];
  for (const row of rows) {
    const result = await client.query<{ id: string }>(
      `
        INSERT INTO shoot_staffing_requirement (
          tenant_id, shoot_id, source_of_creation, staffing_role, label,
          minimum_count, ideal_count, required_for_ready, lead_eligible, lead_required,
          call_offset_minutes, start_offset_minutes, end_offset_minutes,
          required_qualification_tags, role_notes, sort_order, created_by_user_id
        )
        VALUES ($1,$2,$3,$4::staffing_role_code,$5,$6,$7,$8,$9,$10,0,0,0,$11::text[],$12,$13,$14::uuid)
        RETURNING id::text
      `,
      [
        auth.tenantId,
        shootId,
        CENTRAL_JOB_STAFFING_SOURCE,
        row.staffing_role,
        row.label,
        row.minimum_count,
        row.ideal_count,
        row.required_for_ready,
        row.lead_eligible,
        row.lead_required,
        [],
        normalized.internal_notes,
        row.sort_order,
        auth.id
      ]
    );
    insertedIds.push(result.rows[0].id);
  }

  return insertedIds;
}

async function ensureProductionShells(
  client: PoolClient,
  auth: AuthUser,
  input: {
    shootId: string;
    jobNumber: string;
    jobTitle: string;
    normalized: CentralJobNormalizedPayload;
    jobDays: CentralJobDayRecord[];
  }
) {
  if (!input.normalized.production_required) {
    return [] as string[];
  }

  const shells = buildProductionShellInputs(input);
  const createdProjectIds: string[] = [];
  for (const shell of shells) {
    const result = await ensureTriggeredProductionProject(client, auth, {
      triggerKey: shell.triggerKey,
      sourceEventKey: shell.sourceEventKey,
      title: shell.title,
      summary: shell.summary,
      createdReason: shell.createdReason,
      anchorDate: shell.anchorDate,
      ownerUserId: input.normalized.job_owner_user_id ?? null,
      priority: mapCentralPriorityToProductionPriority(input.normalized.priority),
      linkedOrganizationId: input.normalized.organization_id,
      linkedLocationId: input.normalized.location_id,
      linkedShootId: input.shootId
    });
    createdProjectIds.push(result.project.project.id);
  }

  return createdProjectIds;
}

function buildRoutingImpactSnapshot(input: {
  job: CentralJobRecord;
  school_detail: CentralSchoolJobDetailRecord | null;
  sports_detail: CentralSportsJobDetailRecord | null;
  job_days: CentralJobDayRecord[];
}) {
  return JSON.stringify({
    department: input.job.department,
    job_type: input.job.job_type,
    organization_id: input.job.organization_id,
    location_id: input.job.location_id,
    primary_contact_id: input.job.primary_contact_id,
    job_owner_user_id: input.job.job_owner_user_id,
    start_date: input.job.start_date,
    start_time: input.job.start_time,
    end_time: input.job.end_time,
    timezone: input.job.timezone,
    is_multi_day: input.job.is_multi_day,
    delivery_due_date: input.job.delivery_due_date,
    production_required: input.job.production_required,
    staffing_required: input.job.staffing_required,
    staffing_estimate: input.job.staffing_estimate,
    production_grouping_rule: input.job.production_grouping_rule,
    school_job_type: input.school_detail?.school_job_type ?? null,
    roster_status: input.school_detail?.roster_status ?? null,
    id_required: input.school_detail?.id_required ?? false,
    yearbook_required: input.school_detail?.yearbook_required ?? false,
    sports_job_type: input.sports_detail?.sports_job_type ?? null,
    sport_name: input.sports_detail?.sport_name ?? null,
    specialty_products_required: input.sports_detail?.specialty_products_required ?? false,
    gallery_required: input.sports_detail?.gallery_required ?? false,
    days: input.job_days.map((day) => ({
      day_index: day.day_index,
      shoot_date: day.shoot_date,
      start_time: day.start_time,
      end_time: day.end_time,
      timezone: day.timezone,
      location_id: day.location_id,
      date_only: day.date_only,
      start_time_confirmed: day.start_time_confirmed
    }))
  });
}

function buildPublishedFieldErrors(validation: CentralJobValidationResult) {
  return buildFieldErrors(validation.errors.filter((entry) => entry.severity === "error"));
}

export async function getIntakeJob(client: PoolClient, auth: AuthUser, shootId: string) {
  return buildIntakeResponse(client, auth, shootId);
}

// ── Dated-commitment contract (Phase 4.2 Part 2) ─────────────────────────────
// shoot.dated_commitment is a VERSIONED, NARROWLY-SCOPED, WRITE-ONCE record of the dated Job
// commitment — NOT an open JSON bag. It is captured exactly once at publish (the populate query
// is guarded by `dated_commitment IS NULL`) and is never in CentralJobIntakeInput, so no edit path
// can rewrite it. Bump DATED_COMMITMENT_SCHEMA_VERSION + add a reader migration if the shape
// changes. Live canonical references (FKs + live joins) carry current truth; this carries the
// frozen commitment.
export const DATED_COMMITMENT_SCHEMA_VERSION = 1 as const;

export type DatedCommitmentV1 = {
  schema_version: typeof DATED_COMMITMENT_SCHEMA_VERSION;
  captured_at: string;
  captured_by_user_id: string | null;
  organization: {
    organization_id: string | null;
    organization_name: string | null;
    parent_district_id: string | null;
    parent_district_name: string | null;
  };
  contact: {
    contact_identity_id: string | null;
    organization_contact_id: string | null;
    organization_id: string | null;
    contact_name: string | null;
    contextual_role_code: string | null;
    contextual_role_label: string | null;
    title: string | null;
    responsibilities: string | null;
    phone: string | null;
    email: string | null;
    preferred_contact_method: string | null;
  } | null;
  location: {
    location_id: string | null;
    location_name: string | null;
    address: string | null;
    room_area: string | null;
  };
  service_term: {
    service_term_id: string | null;
    period_type: string | null;
    period_label: string | null;
    status_at_capture: string | null;
    selected_service_values: unknown;
    confirmation_state: string | null;
  } | null;
};

export async function publishDraftJob(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  input: { duplicate_override_note?: string | null } = {},
  options: CentralJobPublishOptions = {}
): Promise<CentralJobPublishResult> {
  const draft = await buildDraftResponse(client, auth, shootId);
  const normalized = buildNormalizedPayloadFromResponse(draft);
  const publishValidation = validateJobPublish({
    ...normalized,
    duplicate_check_completed_at: draft.job.duplicate_check_completed_at
  });
  if (!publishValidation.valid) {
    throw new ApiError(400, "Validation failed", buildPublishedFieldErrors(publishValidation));
  }
  if (normalized.is_multi_day && draft.job_days.length === 0) {
    throw new ApiError(400, "Validation failed", {
      field_errors: {
        days: ["Multi-day jobs need one or more day records before publish."]
      },
      form_errors: []
    });
  }

  const duplicates = await findPotentialDuplicates(client, auth, {
    ...normalized,
    current_job_id: shootId
  });
  const overrideNote = normalizeText(input.duplicate_override_note) ?? normalizeText(normalized.duplicate_override_note);
  const overrideUsed = duplicates.hard_block;
  if (duplicates.hard_block && !isLeadershipOverrideActor(auth)) {
    throw new ApiError(403, "Duplicate override requires leadership permissions.", {
      field_errors: {},
      form_errors: ["A lead or admin must approve publish when a hard duplicate is detected."],
      duplicate_result: duplicates
    });
  }
  if (duplicates.hard_block && !overrideNote) {
    throw new ApiError(409, "Duplicate publish blocked", {
      field_errors: {
        duplicate_override_note: ["Add an override note before publishing a hard duplicate."]
      },
      form_errors: ["A hard duplicate was detected and must be overridden by a lead or admin with a note."],
      duplicate_result: duplicates
    });
  }

  const resolvedLocation = await loadResolvedLocation(client, auth.tenantId, normalized.location_id);
  const resolvedContact = await loadResolvedContact(client, auth.tenantId, normalized.primary_contact_id);
  const defaults =
    normalized.organization_id && normalized.department
      ? await resolveOrganizationDefaults(client, auth, normalized.organization_id, normalized.department)
      : null;
  await ensureResolvedLinksBelongToOrganization(
    client,
    auth.tenantId,
    normalized.organization_id,
    normalized.location_id,
    normalized.primary_contact_id
  );

  const jobNumber = await generateCanonicalJobNumber(client, normalized.department!, normalized.start_date!);
  const title = buildJobAutoTitle({
    ...normalized,
    organization_display_name: defaults?.organization_name ?? draft.job.organization_display_name ?? null
  });
  const effectiveDate = normalized.start_date!;
  const effectiveStartTime = normalized.start_time ?? PLACEHOLDER_START_TIME;
  const effectiveEndTime = normalized.end_time ?? (normalized.date_only ? null : addMinutesToTimeString(effectiveStartTime, 60));
  const effectiveArrivalTime = normalized.start_time ? addMinutesToTimeString(effectiveStartTime, -15) : PLACEHOLDER_ARRIVAL_TIME;
  const leadCount = normalized.staffing_required && (normalized.staffing_estimate ?? 0) > 0 ? 1 : 0;
  const plannedStaffCount = normalized.staffing_required ? Math.max(normalized.staffing_estimate ?? 0, leadCount) : 0;
  const minimumStaffCount = normalized.staffing_required ? Math.max(normalized.staffing_estimate ?? 0, 0) : 0;

  await ensureDraftCreatedActivity(client, auth, shootId);
  await writeActivityLog(client, auth, shootId, "job_publish_started", {
    duplicate_hard_block: duplicates.hard_block,
    duplicate_soft_warning: duplicates.soft_warning
  });

  await client.query(
    `
      UPDATE shoot
      SET
        shoot_code = $3,
        job_number = $3,
        department = $4::department_code,
        organization_id = $5::uuid,
        location_id = $6::uuid,
        primary_contact_id = $7::uuid,
        shoot_type = $8::organization_account_type,
        shoot_subtype = $9,
        title = $10,
        shoot_date = $11::date,
        location_name = $12,
        location_address = $13,
        location_lat = $14,
        location_lng = $15,
        arrival_time = (($11::date)::timestamp + $16::time) AT TIME ZONE $17,
        start_time = (($11::date)::timestamp + $18::time) AT TIME ZONE $17,
        end_time_est = CASE
          WHEN $19::time IS NULL THEN NULL
          ELSE (($11::date)::timestamp + $19::time) AT TIME ZONE $17
        END,
        request_source = $20::shoot_request_source,
        source_reference = $21,
        record_state = 'published'::shoot_record_state,
        status = 'CONFIRMED'::shoot_status,
        job_status = 'confirmed'::shoot_job_status,
        unresolved_organization_name = NULL,
        unresolved_location_name = $22,
        unresolved_primary_contact_name = $23,
        account_owner_user_id = $24::uuid,
        job_owner_user_id = $25::uuid,
        time_zone = $17,
        is_multi_day = $26,
        delivery_due_date = $27::date,
        production_required = $28,
        staffing_required = $29,
        staffing_estimate = $30,
        planned_staff_count = $31,
        minimum_staff_count = $32,
        required_lead_count = $33,
        schedule_sync_required = $29,
        schedule_sync_state = $34::schedule_sync_state,
        job_priority = $35::shoot_job_priority,
        delivery_type = $36::shoot_delivery_type,
        production_grouping_rule = $37::shoot_production_grouping_rule,
        internal_notes = $38,
        client_notes = $39,
        special_instructions = $40,
        raw_source_text = $41,
        duplicate_override_note = $42,
        duplicate_override_by_user_id = $43::uuid,
        duplicate_check_completed_at = now(),
        duplicate_check_completed_by_user_id = $43::uuid,
        schedule_date_placeholder = false,
        published_by_user_id = $43::uuid,
        published_at = now(),
        updated_by_user_id = $43::uuid,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
        AND record_state = 'draft'::shoot_record_state
    `,
    [
      auth.tenantId,
      shootId,
      jobNumber,
      normalized.department,
      normalized.organization_id,
      normalized.location_id,
      normalized.primary_contact_id,
      normalized.job_type,
      deriveDepartmentSubtype(normalized),
      title,
      effectiveDate,
      mapLocationName(resolvedLocation?.name ?? defaults?.default_location_name ?? null, normalized.unresolved_location_name),
      resolvedLocation?.address ?? "",
      resolvedLocation?.latitude ?? PLACEHOLDER_LATITUDE,
      resolvedLocation?.longitude ?? PLACEHOLDER_LONGITUDE,
      effectiveArrivalTime,
      normalized.timezone,
      effectiveStartTime,
      effectiveEndTime,
      normalized.request_source,
      normalized.source_reference,
      normalized.unresolved_location_name,
      normalized.unresolved_primary_contact_name ?? resolvedContact?.full_name ?? defaults?.default_primary_contact_name ?? null,
      normalized.account_owner_user_id ?? defaults?.account_owner_user_id ?? null,
      normalized.job_owner_user_id,
      normalized.is_multi_day,
      normalized.delivery_due_date,
      normalized.production_required,
      normalized.staffing_required,
      normalized.staffing_estimate,
      plannedStaffCount,
      minimumStaffCount,
      leadCount,
      normalized.staffing_required ? "pending_sync" : "not_linked",
      normalized.priority,
      normalized.delivery_type,
      normalized.production_grouping_rule,
      normalized.internal_notes,
      normalized.client_notes,
      normalized.special_instructions,
      normalized.raw_source_text,
      overrideNote,
      duplicates.hard_block ? auth.id : null
    ]
  );

  // Phase 4.2 Part 2 — capture the dated-commitment snapshot at publish. This preserves the dated
  // values the canonical model lets change later (contextual role, contact phone/preferred,
  // service-term id/label) alongside the room/area and the already-snapshotted location address.
  // FK references stay live (current canonical truth); this column never auto-updates.
  await client.query(
    `UPDATE shoot s SET dated_commitment = jsonb_build_object(
        'schema_version', ${DATED_COMMITMENT_SCHEMA_VERSION},
        'captured_at', now()::text,
        'captured_by_user_id', $3::text,
        'organization', jsonb_build_object(
          'organization_id', s.organization_id::text,
          'organization_name', (SELECT display_name FROM organization WHERE tenant_id = s.tenant_id AND id = s.organization_id),
          'parent_district_id', (SELECT parent_organization_id::text FROM organization WHERE tenant_id = s.tenant_id AND id = s.organization_id),
          'parent_district_name', (SELECT p.display_name FROM organization o JOIN organization p ON p.tenant_id = o.tenant_id AND p.id = o.parent_organization_id WHERE o.tenant_id = s.tenant_id AND o.id = s.organization_id)
        ),
        'contact', (
          SELECT jsonb_build_object(
            'contact_identity_id', oc.contact_id::text,
            'organization_contact_id', oc.id::text,
            'organization_id', oc.organization_id::text,
            'contact_name', oc.full_name,
            'contextual_role_code', ocr.relationship_role::text,
            'contextual_role_label', (ocr.client_roles)[1]::text,
            'title', oc.title,
            'responsibilities', oc.notes,
            'phone', COALESCE(oc.phone, c.phone),
            'email', COALESCE(oc.email, c.email),
            'preferred_contact_method', c.preferred_contact_method
          )
          FROM organization_contact oc
          LEFT JOIN contact c ON c.tenant_id = oc.tenant_id AND c.id = oc.contact_id
          LEFT JOIN organization_contact_relationship ocr ON ocr.tenant_id = oc.tenant_id AND ocr.contact_id = oc.id AND ocr.is_current = true
          WHERE oc.tenant_id = s.tenant_id AND oc.id = s.primary_contact_id
        ),
        'location', jsonb_build_object(
          'location_id', s.location_id::text,
          'location_name', s.location_name,
          'address', s.location_address,
          'room_area', s.special_instructions
        ),
        'service_term', (
          SELECT jsonb_build_object(
            'service_term_id', st.id::text,
            'period_type', st.period_type::text,
            'period_label', st.period_label,
            'status_at_capture', st.status::text,
            'selected_service_values', st.service_config,
            'confirmation_state', st.confirmation_state::text
          )
          FROM school_service_term st
          WHERE st.tenant_id = s.tenant_id AND st.organization_id = s.organization_id AND st.status = 'current'
          ORDER BY st.created_at DESC LIMIT 1
        )
      )
      WHERE s.tenant_id = $1 AND s.id = $2
        AND s.dated_commitment IS NULL`,
    [auth.tenantId, shootId, auth.id]
  );

  await upsertShootDay(client, auth, shootId, normalized);
  if (normalized.department === "schools") {
    await upsertSchoolDetail(client, auth, shootId, normalized.school_detail);
    await client.query("DELETE FROM shoot_sports_detail WHERE tenant_id = $1 AND shoot_id = $2", [auth.tenantId, shootId]);
  } else {
    await upsertSportsDetail(client, auth, shootId, normalized.sports_detail);
    await client.query("DELETE FROM shoot_school_detail WHERE tenant_id = $1 AND shoot_id = $2", [auth.tenantId, shootId]);
  }

  const published = await buildIntakeResponse(client, auth, shootId);
  await persistReadinessEvaluation(client, auth, shootId, published.readiness);
  await writeActivityLog(client, auth, shootId, "readiness_recomputed", {
    readiness_status: published.readiness.readiness_status,
    blocker_count: published.readiness.blockers.length,
    warning_count: published.readiness.warnings.length
  });

  if (overrideUsed) {
    await writeActivityLog(client, auth, shootId, "duplicate_override_used", {
      override_note: overrideNote,
      matching_record_count: duplicates.matching_records.length
    });
  }

  if (options.hooks?.beforeDownstreamCreation) {
    await options.hooks.beforeDownstreamCreation();
  }

  const refreshedAfterReadiness = await buildIntakeResponse(client, auth, shootId);
  const downstream: CentralJobDownstreamSummary = {
    production_project_ids: await ensureProductionShells(client, auth, {
      shootId,
      jobNumber,
      jobTitle: refreshedAfterReadiness.job.title,
      normalized,
      jobDays: refreshedAfterReadiness.job_days
    }),
    staffing_requirement_ids: await rebuildStaffingShells(client, auth, shootId, normalized)
  };

  if (downstream.production_project_ids.length > 0) {
    await writeActivityLog(client, auth, shootId, "production_shells_created", {
      production_project_ids: downstream.production_project_ids,
      grouping_rule: normalized.production_grouping_rule
    });
  }
  if (downstream.staffing_requirement_ids.length > 0) {
    await writeActivityLog(client, auth, shootId, "staffing_shells_created", {
      staffing_requirement_ids: downstream.staffing_requirement_ids,
      staffing_estimate: normalized.staffing_estimate
    });
  }

  await writeActivityLog(client, auth, shootId, "job_published", {
    job_number: jobNumber,
    readiness_status: refreshedAfterReadiness.readiness.readiness_status,
    duplicate_hard_block: duplicates.hard_block,
    duplicate_soft_warning: duplicates.soft_warning
  });
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "central_job_intake.job_published",
    entityType: "shoot",
    entityId: shootId,
    metadata: {
      job_number: jobNumber,
      department: normalized.department,
      duplicate_override_used: overrideUsed,
      production_project_count: downstream.production_project_ids.length,
      staffing_requirement_count: downstream.staffing_requirement_ids.length
    }
  });

  const finalState = await buildIntakeResponse(client, auth, shootId);
  return {
    intake: finalState,
    duplicates,
    redirect_target: `/api/shoots/intake/jobs/${shootId}`,
    downstream
  };
}

export async function updatePublishedJob(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  patch: CentralJobIntakeInput
) {
  const existing = await buildIntakeResponse(client, auth, shootId);
  if (existing.job.record_state !== "published") {
    throw new ApiError(404, "Published job not found");
  }

  const beforeRouting = buildRoutingImpactSnapshot(existing);
  const sanitized = sanitizeProtectedFieldUpdates(existing.job, patch, auth);
  const mergedInput = mergeExistingIntakeWithPatch(existing, patch, sanitized.patch);
  const normalized = normalizeIntakePayload(mergedInput);
  const publishValidation = validateJobPublish({
    ...normalized,
    duplicate_check_completed_at: existing.job.duplicate_check_completed_at ?? new Date().toISOString()
  });
  if (!publishValidation.valid) {
    throw new ApiError(400, "Validation failed", buildPublishedFieldErrors(publishValidation));
  }
  await assertDepartmentAccess(auth, normalized.department!);
  await ensureResolvedLinksBelongToOrganization(
    client,
    auth.tenantId,
    normalized.organization_id,
    normalized.location_id,
    normalized.primary_contact_id
  );

  const defaults =
    normalized.organization_id && normalized.department
      ? await resolveOrganizationDefaults(client, auth, normalized.organization_id, normalized.department)
      : null;
  const resolvedLocation = await loadResolvedLocation(client, auth.tenantId, normalized.location_id);
  const resolvedContact = await loadResolvedContact(client, auth.tenantId, normalized.primary_contact_id);
  const effectiveDate = normalized.start_date!;
  const effectiveStartTime = normalized.start_time ?? PLACEHOLDER_START_TIME;
  const effectiveEndTime = normalized.end_time ?? (normalized.date_only ? null : addMinutesToTimeString(effectiveStartTime, 60));
  const effectiveArrivalTime = normalized.start_time ? addMinutesToTimeString(effectiveStartTime, -15) : PLACEHOLDER_ARRIVAL_TIME;
  const leadCount = normalized.staffing_required && (normalized.staffing_estimate ?? 0) > 0 ? 1 : 0;
  const plannedStaffCount = normalized.staffing_required ? Math.max(normalized.staffing_estimate ?? 0, leadCount) : 0;
  const minimumStaffCount = normalized.staffing_required ? Math.max(normalized.staffing_estimate ?? 0, 0) : 0;
  const title = buildJobAutoTitle({
    ...normalized,
    organization_display_name: defaults?.organization_name ?? existing.job.organization_display_name ?? null
  });

  await client.query(
    `
      UPDATE shoot
      SET
        department = $3::department_code,
        organization_id = $4::uuid,
        location_id = $5::uuid,
        primary_contact_id = $6::uuid,
        shoot_type = $7::organization_account_type,
        shoot_subtype = $8,
        title = $9,
        shoot_date = $10::date,
        location_name = $11,
        location_address = $12,
        location_lat = $13,
        location_lng = $14,
        arrival_time = (($10::date)::timestamp + $15::time) AT TIME ZONE $16,
        start_time = (($10::date)::timestamp + $17::time) AT TIME ZONE $16,
        end_time_est = CASE
          WHEN $18::time IS NULL THEN NULL
          ELSE (($10::date)::timestamp + $18::time) AT TIME ZONE $16
        END,
        request_source = $19::shoot_request_source,
        source_reference = $20,
        unresolved_organization_name = NULL,
        unresolved_location_name = $21,
        unresolved_primary_contact_name = $22,
        account_owner_user_id = $23::uuid,
        job_owner_user_id = $24::uuid,
        time_zone = $16,
        is_multi_day = $25,
        delivery_due_date = $26::date,
        production_required = $27,
        staffing_required = $28,
        staffing_estimate = $29,
        planned_staff_count = $30,
        minimum_staff_count = $31,
        required_lead_count = $32,
        schedule_sync_required = $28,
        schedule_sync_state = $33::schedule_sync_state,
        job_priority = $34::shoot_job_priority,
        delivery_type = $35::shoot_delivery_type,
        production_grouping_rule = $36::shoot_production_grouping_rule,
        internal_notes = $37,
        client_notes = $38,
        special_instructions = $39,
        raw_source_text = $40,
        duplicate_override_note = $41,
        updated_by_user_id = $42::uuid,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
        AND record_state = 'published'::shoot_record_state
    `,
    [
      auth.tenantId,
      shootId,
      normalized.department,
      normalized.organization_id,
      normalized.location_id,
      normalized.primary_contact_id,
      normalized.job_type,
      deriveDepartmentSubtype(normalized),
      title,
      effectiveDate,
      mapLocationName(resolvedLocation?.name ?? defaults?.default_location_name ?? null, normalized.unresolved_location_name),
      resolvedLocation?.address ?? "",
      resolvedLocation?.latitude ?? PLACEHOLDER_LATITUDE,
      resolvedLocation?.longitude ?? PLACEHOLDER_LONGITUDE,
      effectiveArrivalTime,
      normalized.timezone,
      effectiveStartTime,
      effectiveEndTime,
      normalized.request_source,
      normalized.source_reference,
      normalized.unresolved_location_name,
      normalized.unresolved_primary_contact_name ?? resolvedContact?.full_name ?? defaults?.default_primary_contact_name ?? null,
      normalized.account_owner_user_id ?? defaults?.account_owner_user_id ?? null,
      normalized.job_owner_user_id,
      normalized.is_multi_day,
      normalized.delivery_due_date,
      normalized.production_required,
      normalized.staffing_required,
      normalized.staffing_estimate,
      plannedStaffCount,
      minimumStaffCount,
      leadCount,
      normalized.staffing_required ? "pending_sync" : "not_linked",
      normalized.priority,
      normalized.delivery_type,
      normalized.production_grouping_rule,
      normalized.internal_notes,
      normalized.client_notes,
      normalized.special_instructions,
      normalized.raw_source_text,
      normalized.duplicate_override_note,
      auth.id
    ]
  );

  await upsertShootDay(client, auth, shootId, normalized);
  if (normalized.department === "schools") {
    await upsertSchoolDetail(client, auth, shootId, normalized.school_detail);
    await client.query("DELETE FROM shoot_sports_detail WHERE tenant_id = $1 AND shoot_id = $2", [auth.tenantId, shootId]);
  } else {
    await upsertSportsDetail(client, auth, shootId, normalized.sports_detail);
    await client.query("DELETE FROM shoot_school_detail WHERE tenant_id = $1 AND shoot_id = $2", [auth.tenantId, shootId]);
  }

  const refreshed = await buildIntakeResponse(client, auth, shootId);
  await persistReadinessEvaluation(client, auth, shootId, refreshed.readiness);
  await writeActivityLog(client, auth, shootId, "readiness_recomputed", {
    readiness_status: refreshed.readiness.readiness_status,
    blocker_count: refreshed.readiness.blockers.length,
    warning_count: refreshed.readiness.warnings.length
  });

  const afterReadiness = await buildIntakeResponse(client, auth, shootId);
  const afterRouting = buildRoutingImpactSnapshot(afterReadiness);
  if (beforeRouting !== afterRouting) {
    const downstream: CentralJobDownstreamSummary = {
      production_project_ids: await ensureProductionShells(client, auth, {
        shootId,
        jobNumber: afterReadiness.job.job_number ?? afterReadiness.job.shoot_code,
        jobTitle: afterReadiness.job.title,
        normalized,
        jobDays: afterReadiness.job_days
      }),
      staffing_requirement_ids: await rebuildStaffingShells(client, auth, shootId, normalized)
    };

    if (downstream.production_project_ids.length > 0) {
      await writeActivityLog(client, auth, shootId, "production_shells_created", {
        production_project_ids: downstream.production_project_ids,
        regrouped_after_update: true
      });
    }
    if (downstream.staffing_requirement_ids.length > 0 || !normalized.staffing_required) {
      await writeActivityLog(client, auth, shootId, "staffing_shells_created", {
        staffing_requirement_ids: downstream.staffing_requirement_ids,
        regrouped_after_update: true
      });
    }
  }

  await writeActivityLog(client, auth, shootId, "published_job_updated", {
    blocked_fields: sanitized.blocked_fields,
    requires_leadership: sanitized.requires_leadership
  });
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "central_job_intake.published_job_updated",
    entityType: "shoot",
    entityId: shootId,
    metadata: {
      blocked_fields: sanitized.blocked_fields,
      requires_leadership: sanitized.requires_leadership
    }
  });

  return buildIntakeResponse(client, auth, shootId);
}
