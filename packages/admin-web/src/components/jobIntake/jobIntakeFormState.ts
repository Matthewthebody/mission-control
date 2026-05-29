import type {
  CentralJobDepartment,
  CentralJobDraftResponse,
  CentralJobIntakeInput,
  CentralJobPriority,
  CentralJobProductionGroupingRule,
  CentralJobRequestSource
} from "../../jobIntakeTypes";

export type JobIntakeSharedFormState = {
  department: CentralJobDepartment;
  job_type: string;
  job_title: string;
  organization_id: string;
  unresolved_organization_name: string;
  location_id: string;
  unresolved_location_name: string;
  primary_contact_id: string;
  unresolved_primary_contact_name: string;
  account_owner_user_id: string;
  job_owner_user_id: string;
  start_date: string;
  start_time: string;
  end_time: string;
  timezone: string;
  date_only: boolean;
  delivery_due_date: string;
  production_required: boolean;
  staffing_required: boolean;
  staffing_estimate: string;
  priority: CentralJobPriority;
  delivery_type: string;
  production_grouping_rule: CentralJobProductionGroupingRule;
  internal_notes: string;
  client_notes: string;
  special_instructions: string;
  raw_source_text: string;
  duplicate_override_note: string;
  school_detail: {
    school_job_type: string;
    school_type: string;
    roster_status: string;
    roster_due_date: string;
    id_required: boolean;
    id_sort_method: string;
    yearbook_required: boolean;
    yearbook_due_date: string;
    student_count_estimate: string;
    staff_count_estimate: string;
    grade_range: string;
    camera_count_estimate: string;
    school_day_notes: string;
  };
  sports_detail: {
    sports_job_type: string;
    sport_name: string;
    season: string;
    level_or_age_group: string;
    team_count_estimate: string;
    athlete_count_estimate: string;
    coach_count_estimate: string;
    specialty_products_required: boolean;
    specialty_product_types_text: string;
    gallery_required: boolean;
    delivery_deadline_type: string;
    event_notes: string;
  };
};

export function humanizeToken(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function buildDescriptor(form: JobIntakeSharedFormState) {
  if (form.department === "schools") {
    return humanizeToken(form.school_detail.school_job_type || form.job_type || "school job");
  }
  const base = humanizeToken(form.sports_detail.sports_job_type || "sports job");
  return form.sports_detail.sport_name ? `${form.sports_detail.sport_name} ${base}` : base;
}

export function buildLocalAutoTitle(
  form: JobIntakeSharedFormState,
  organizationName: string | null,
  options: { respectExplicit?: boolean } = {}
) {
  const explicitTitle = form.job_title.trim();
  if (options.respectExplicit !== false && explicitTitle) {
    return explicitTitle;
  }
  const accountLabel = organizationName?.trim() || form.unresolved_organization_name.trim() || "Unresolved Account";
  const dateLabel = form.start_date || form.delivery_due_date || "Draft";
  return `${accountLabel} - ${buildDescriptor(form)} - ${dateLabel}`;
}

export function toNullableNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toStringArray(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function countFieldErrors(fieldErrors: Record<string, string[]>, keys: string[]) {
  return keys.reduce((count, key) => count + (fieldErrors[key]?.length ?? 0), 0);
}

export function createInitialFormState(defaultDepartment: CentralJobDepartment, userId: string): JobIntakeSharedFormState {
  return {
    department: defaultDepartment,
    job_type: defaultDepartment === "sports" ? "sports" : "",
    job_title: "",
    organization_id: "",
    unresolved_organization_name: "",
    location_id: "",
    unresolved_location_name: "",
    primary_contact_id: "",
    unresolved_primary_contact_name: "",
    account_owner_user_id: "",
    job_owner_user_id: userId,
    start_date: "",
    start_time: "",
    end_time: "",
    timezone: "America/Chicago",
    date_only: false,
    delivery_due_date: "",
    production_required: true,
    staffing_required: true,
    staffing_estimate: "",
    priority: "normal",
    delivery_type: "",
    production_grouping_rule: "one_per_job",
    internal_notes: "",
    client_notes: "",
    special_instructions: "",
    raw_source_text: "",
    duplicate_override_note: "",
    school_detail: {
      school_job_type: "",
      school_type: "",
      roster_status: "",
      roster_due_date: "",
      id_required: false,
      id_sort_method: "",
      yearbook_required: false,
      yearbook_due_date: "",
      student_count_estimate: "",
      staff_count_estimate: "",
      grade_range: "",
      camera_count_estimate: "",
      school_day_notes: ""
    },
    sports_detail: {
      sports_job_type: "",
      sport_name: "",
      season: "",
      level_or_age_group: "",
      team_count_estimate: "",
      athlete_count_estimate: "",
      coach_count_estimate: "",
      specialty_products_required: false,
      specialty_product_types_text: "",
      gallery_required: false,
      delivery_deadline_type: "",
      event_notes: ""
    }
  };
}

export function buildIntakePayload(
  form: JobIntakeSharedFormState,
  requestSource: CentralJobRequestSource
): CentralJobIntakeInput {
  return {
    department: form.department,
    job_type: (form.job_type || null) as CentralJobIntakeInput["job_type"],
    job_title: form.job_title.trim() || null,
    request_source: requestSource,
    organization_id: form.organization_id || null,
    unresolved_organization_name: form.unresolved_organization_name.trim() || null,
    location_id: form.location_id || null,
    unresolved_location_name: form.unresolved_location_name.trim() || null,
    primary_contact_id: form.primary_contact_id || null,
    unresolved_primary_contact_name: form.unresolved_primary_contact_name.trim() || null,
    account_owner_user_id: form.account_owner_user_id || null,
    job_owner_user_id: form.job_owner_user_id || null,
    start_date: form.start_date || null,
    start_time: form.date_only ? null : form.start_time || null,
    end_time: form.date_only ? null : form.end_time || null,
    timezone: form.timezone || null,
    date_only: form.date_only,
    is_multi_day: false,
    delivery_due_date: form.delivery_due_date || null,
    production_required: form.production_required,
    staffing_required: form.staffing_required,
    staffing_estimate: toNullableNumber(form.staffing_estimate),
    priority: form.priority,
    delivery_type: form.delivery_type ? (form.delivery_type as CentralJobIntakeInput["delivery_type"]) : null,
    production_grouping_rule: form.production_grouping_rule,
    internal_notes: form.internal_notes.trim() || null,
    client_notes: form.client_notes.trim() || null,
    special_instructions: form.special_instructions.trim() || null,
    raw_source_text: form.raw_source_text.trim() || null,
    duplicate_override_note: form.duplicate_override_note.trim() || null,
    days: form.start_date
      ? [
          {
            day_index: 0,
            shoot_date: form.start_date,
            start_time: form.date_only ? null : form.start_time || null,
            end_time: form.date_only ? null : form.end_time || null,
            timezone: form.timezone || null,
            location_id: form.location_id || null,
            date_only: form.date_only,
            start_time_confirmed: form.date_only ? false : Boolean(form.start_time)
          }
        ]
      : null,
    school_detail:
      form.department === "schools"
        ? {
            school_job_type: form.school_detail.school_job_type || null,
            school_type: form.school_detail.school_type.trim() || null,
            roster_status: form.school_detail.roster_status.trim() || null,
            roster_due_date: form.school_detail.roster_due_date || null,
            id_required: form.school_detail.id_required,
            id_sort_method: form.school_detail.id_sort_method.trim() || null,
            yearbook_required: form.school_detail.yearbook_required,
            yearbook_due_date: form.school_detail.yearbook_due_date || null,
            student_count_estimate: toNullableNumber(form.school_detail.student_count_estimate),
            staff_count_estimate: toNullableNumber(form.school_detail.staff_count_estimate),
            grade_range: form.school_detail.grade_range.trim() || null,
            camera_count_estimate: toNullableNumber(form.school_detail.camera_count_estimate),
            school_day_notes: form.school_detail.school_day_notes.trim() || null
          }
        : null,
    sports_detail:
      form.department === "sports"
        ? {
            sports_job_type: form.sports_detail.sports_job_type || null,
            sport_name: form.sports_detail.sport_name.trim() || null,
            season: form.sports_detail.season.trim() || null,
            level_or_age_group: form.sports_detail.level_or_age_group.trim() || null,
            team_count_estimate: toNullableNumber(form.sports_detail.team_count_estimate),
            athlete_count_estimate: toNullableNumber(form.sports_detail.athlete_count_estimate),
            coach_count_estimate: toNullableNumber(form.sports_detail.coach_count_estimate),
            specialty_products_required: form.sports_detail.specialty_products_required,
            specialty_product_types: form.sports_detail.specialty_products_required
              ? toStringArray(form.sports_detail.specialty_product_types_text)
              : null,
            gallery_required: form.sports_detail.gallery_required,
            delivery_deadline_type: form.sports_detail.delivery_deadline_type.trim() || null,
            event_notes: form.sports_detail.event_notes.trim() || null
          }
        : null
  };
}

export function buildFormStateFromDraftResponse(
  response: CentralJobDraftResponse,
  fallbackDepartment: CentralJobDepartment,
  fallbackUserId: string
): JobIntakeSharedFormState {
  const job = response.job;
  const firstDay = response.job_days[0] ?? null;
  const schoolDetail = response.school_detail;
  const sportsDetail = response.sports_detail;

  return {
    department: job.department ?? fallbackDepartment,
    job_type: job.job_type ?? "",
    job_title: job.title ?? "",
    organization_id: job.organization_id ?? "",
    unresolved_organization_name: job.unresolved_organization_name ?? "",
    location_id: job.location_id ?? firstDay?.location_id ?? "",
    unresolved_location_name: job.unresolved_location_name ?? "",
    primary_contact_id: job.primary_contact_id ?? "",
    unresolved_primary_contact_name: job.unresolved_primary_contact_name ?? "",
    account_owner_user_id: job.account_owner_user_id ?? "",
    job_owner_user_id: job.job_owner_user_id ?? fallbackUserId,
    start_date: firstDay?.shoot_date ?? job.start_date ?? "",
    start_time: firstDay?.start_time ?? job.start_time ?? "",
    end_time: firstDay?.end_time ?? job.end_time ?? "",
    timezone: firstDay?.timezone ?? job.timezone ?? "America/Chicago",
    date_only: firstDay?.date_only ?? job.date_only ?? false,
    delivery_due_date: job.delivery_due_date ?? "",
    production_required: job.production_required,
    staffing_required: job.staffing_required,
    staffing_estimate: job.staffing_estimate === null ? "" : String(job.staffing_estimate),
    priority: job.priority,
    delivery_type: job.delivery_type ?? "",
    production_grouping_rule: job.production_grouping_rule,
    internal_notes: job.internal_notes ?? "",
    client_notes: job.client_notes ?? "",
    special_instructions: job.special_instructions ?? "",
    raw_source_text: job.raw_source_text ?? "",
    duplicate_override_note: job.duplicate_override_note ?? "",
    school_detail: {
      school_job_type: schoolDetail?.school_job_type ?? "",
      school_type: schoolDetail?.school_type ?? "",
      roster_status: schoolDetail?.roster_status ?? "",
      roster_due_date: schoolDetail?.roster_due_date ?? "",
      id_required: schoolDetail?.id_required ?? false,
      id_sort_method: schoolDetail?.id_sort_method ?? "",
      yearbook_required: schoolDetail?.yearbook_required ?? false,
      yearbook_due_date: schoolDetail?.yearbook_due_date ?? "",
      student_count_estimate: schoolDetail?.student_count_estimate === null || schoolDetail?.student_count_estimate === undefined ? "" : String(schoolDetail.student_count_estimate),
      staff_count_estimate: schoolDetail?.staff_count_estimate === null || schoolDetail?.staff_count_estimate === undefined ? "" : String(schoolDetail.staff_count_estimate),
      grade_range: schoolDetail?.grade_range ?? "",
      camera_count_estimate: schoolDetail?.camera_count_estimate === null || schoolDetail?.camera_count_estimate === undefined ? "" : String(schoolDetail.camera_count_estimate),
      school_day_notes: schoolDetail?.school_day_notes ?? ""
    },
    sports_detail: {
      sports_job_type: sportsDetail?.sports_job_type ?? "",
      sport_name: sportsDetail?.sport_name ?? "",
      season: sportsDetail?.season ?? "",
      level_or_age_group: sportsDetail?.level_or_age_group ?? "",
      team_count_estimate: sportsDetail?.team_count_estimate === null || sportsDetail?.team_count_estimate === undefined ? "" : String(sportsDetail.team_count_estimate),
      athlete_count_estimate: sportsDetail?.athlete_count_estimate === null || sportsDetail?.athlete_count_estimate === undefined ? "" : String(sportsDetail.athlete_count_estimate),
      coach_count_estimate: sportsDetail?.coach_count_estimate === null || sportsDetail?.coach_count_estimate === undefined ? "" : String(sportsDetail.coach_count_estimate),
      specialty_products_required: sportsDetail?.specialty_products_required ?? false,
      specialty_product_types_text: sportsDetail?.specialty_product_types?.join(", ") ?? "",
      gallery_required: sportsDetail?.gallery_required ?? false,
      delivery_deadline_type: sportsDetail?.delivery_deadline_type ?? "",
      event_notes: sportsDetail?.event_notes ?? ""
    }
  };
}

export function applyParsedPayloadToForm(
  current: JobIntakeSharedFormState,
  parsedInput: CentralJobIntakeInput,
  lockedDepartment: CentralJobDepartment
): JobIntakeSharedFormState {
  return {
    ...current,
    department: lockedDepartment,
    job_type: parsedInput.job_type ?? current.job_type,
    unresolved_organization_name: parsedInput.unresolved_organization_name ?? current.unresolved_organization_name,
    unresolved_location_name: parsedInput.unresolved_location_name ?? current.unresolved_location_name,
    unresolved_primary_contact_name:
      parsedInput.unresolved_primary_contact_name ?? current.unresolved_primary_contact_name,
    start_date: parsedInput.start_date ?? current.start_date,
    start_time: parsedInput.start_time ?? current.start_time,
    end_time: parsedInput.end_time ?? current.end_time,
    timezone: parsedInput.timezone ?? current.timezone,
    date_only: typeof parsedInput.date_only === "boolean" ? parsedInput.date_only : current.date_only,
    delivery_due_date: parsedInput.delivery_due_date ?? current.delivery_due_date,
    production_required:
      typeof parsedInput.production_required === "boolean" ? parsedInput.production_required : current.production_required,
    staffing_required:
      typeof parsedInput.staffing_required === "boolean" ? parsedInput.staffing_required : current.staffing_required,
    staffing_estimate:
      parsedInput.staffing_estimate == null ? current.staffing_estimate : String(parsedInput.staffing_estimate),
    internal_notes: parsedInput.internal_notes ?? current.internal_notes,
    client_notes: parsedInput.client_notes ?? current.client_notes,
    special_instructions: parsedInput.special_instructions ?? current.special_instructions,
    raw_source_text: parsedInput.raw_source_text ?? current.raw_source_text,
    school_detail:
      lockedDepartment === "schools"
        ? {
            ...current.school_detail,
            school_job_type: parsedInput.school_detail?.school_job_type ?? current.school_detail.school_job_type,
            roster_status: parsedInput.school_detail?.roster_status ?? current.school_detail.roster_status,
            roster_due_date: parsedInput.school_detail?.roster_due_date ?? current.school_detail.roster_due_date,
            id_required:
              typeof parsedInput.school_detail?.id_required === "boolean"
                ? parsedInput.school_detail.id_required
                : current.school_detail.id_required,
            id_sort_method: parsedInput.school_detail?.id_sort_method ?? current.school_detail.id_sort_method,
            yearbook_required:
              typeof parsedInput.school_detail?.yearbook_required === "boolean"
                ? parsedInput.school_detail.yearbook_required
                : current.school_detail.yearbook_required,
            yearbook_due_date: parsedInput.school_detail?.yearbook_due_date ?? current.school_detail.yearbook_due_date
          }
        : current.school_detail,
    sports_detail:
      lockedDepartment === "sports"
        ? {
            ...current.sports_detail,
            sports_job_type: parsedInput.sports_detail?.sports_job_type ?? current.sports_detail.sports_job_type,
            sport_name: parsedInput.sports_detail?.sport_name ?? current.sports_detail.sport_name,
            specialty_products_required:
              typeof parsedInput.sports_detail?.specialty_products_required === "boolean"
                ? parsedInput.sports_detail.specialty_products_required
                : current.sports_detail.specialty_products_required,
            specialty_product_types_text:
              parsedInput.sports_detail?.specialty_product_types?.join(", ") ??
              current.sports_detail.specialty_product_types_text,
            gallery_required:
              typeof parsedInput.sports_detail?.gallery_required === "boolean"
                ? parsedInput.sports_detail.gallery_required
                : current.sports_detail.gallery_required
          }
        : current.sports_detail
  };
}
