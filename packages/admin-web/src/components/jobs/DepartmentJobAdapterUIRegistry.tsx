import type { ReactNode } from "react";
import type {
  JobCategory,
  JobDepartmentType,
  JobPriorityLevel,
  SharedJobDetailResponse,
  SharedJobDraftInput,
  SharedJobListItem
} from "../../jobTruthTypes";
import { RiskBadge, StatusPill, formatDate, formatDateTime, formatTimeRange, humanizeToken, statusTone } from "../sports/SportsPrimitives";
import type { SessionUser } from "../../types";

export type SharedJobFormDayState = {
  day_label: string;
  date: string;
  start_time: string;
  end_time: string;
  timezone: string;
  location_id: string;
  onsite_contact_id: string;
  lead_user_id: string;
  weather_sensitive: boolean;
  indoor_outdoor: string;
  access_notes: string;
  parking_notes: string;
  setup_notes: string;
  travel_notes: string;
};

export type SharedJobFormState = {
  department_type: JobDepartmentType;
  job_category: JobCategory;
  organization_id: string;
  primary_location_id: string;
  primary_contact_id: string;
  account_owner_user_id: string;
  title: string;
  event_name: string;
  description_internal: string;
  priority_level: JobPriorityLevel;
  delivery_type: string;
  gallery_type: string;
  scheduled_start_date: string;
  scheduled_start_time: string;
  scheduled_end_date: string;
  scheduled_end_time: string;
  timezone: string;
  estimated_subject_count: string;
  estimated_staff_count: string;
  client_deadline_at: string;
  production_deadline_at: string;
  production_required: boolean;
  location_override_note: string;
  contact_override_note: string;
  school_profile: {
    district_id: string;
    school_type: string;
    school_year: string;
    grade_scope: string;
    roster_source: string;
    id_cards_required: boolean;
    yearbook_required: boolean;
    composite_required: boolean;
    admin_portal_required: boolean;
    submission_deadline: string;
    advisor_sorting_required: boolean;
    homeroom_sorting_required: boolean;
    data_import_mode: string;
    special_instructions: string;
  };
  sports_profile: {
    sport_type: string;
    season: string;
    league_name: string;
    division: string;
    team_structure: string;
    estimated_team_count: string;
    proof_required: boolean;
    approval_contact_id: string;
    billing_contact_id: string;
    revenue_share_enabled: boolean;
    revenue_share_terms_summary: string;
    banner_work_required: boolean;
    specialty_products_required: boolean;
    buddy_photos_required: boolean;
    sponsor_graphics_required: boolean;
    client_expectations_notes: string;
  };
  days: SharedJobFormDayState[];
};

export type SharedJobFieldErrors = Record<string, string[]>;

export type SharedJobFormValidationIssue = {
  field: string;
  message: string;
  sectionId?: string;
};

export type SharedJobFormSectionSlot =
  | "identity.after"
  | "schedule.after"
  | "contacts.after"
  | "production.after"
  | "notes.after"
  | "sidebar.top"
  | "sidebar.bottom";

export type SharedJobListColumnDefinition = {
  key: string;
  label: string;
  render: (item: SharedJobListItem) => ReactNode;
};

export type SharedJobFilterDefinition = {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
};

export type SharedJobSavedViewPreset = {
  key: string;
  label: string;
  description: string;
  filters: Partial<SharedJobListFilterState>;
};

export type SharedJobSidebarCardDefinition = {
  key: string;
  title: string;
  body: ReactNode;
};

export type SharedJobOperationalCardDefinition = SharedJobSidebarCardDefinition & {
  placement: "readiness" | "staffing" | "day-of" | "today";
};

export type SharedJobDownstreamCardDefinition = SharedJobSidebarCardDefinition & {
  placement: "production" | "approvals" | "qa" | "deliverables" | "overview";
};

export type SharedJobDownstreamPresetOption = {
  value: string;
  label: string;
};

export type SharedJobDownstreamConfig = {
  productionTypes: SharedJobDownstreamPresetOption[];
  approvalTypes: SharedJobDownstreamPresetOption[];
  qaTemplates: SharedJobDownstreamPresetOption[];
  deliverableTypes: SharedJobDownstreamPresetOption[];
  summaryCards: SharedJobDownstreamCardDefinition[];
};

export type SharedJobDetailTabDefinition = {
  key: string;
  label: string;
  body: ReactNode;
};

export type SharedJobFormSectionDefinition = {
  key: string;
  slot: SharedJobFormSectionSlot;
  title: string;
  summary: string;
  fields: string[];
  body: ReactNode;
};

export type SharedJobListFilterState = {
  search: string;
  dateRange: string;
  organizationId: string;
  jobCategory: string;
  primaryContactId: string;
  locationId: string;
  accountOwnerUserId: string;
  leadOwnerUserId: string;
  jobStatus: string;
  productionStatus: string;
  releaseStatus: string;
  staffingStatus: string;
  readinessStatus: string;
  riskStatus: string;
  archived: string;
  departmentType: string;
  schoolYear: string;
  districtId: string;
  yearbookRequired: string;
  idCardsRequired: string;
  rosterMode: string;
  sportType: string;
  season: string;
  proofRequired: string;
  bannerRequired: string;
  revenueShareEnabled: string;
};

type FormRenderContext = {
  state: SharedJobFormState;
  setState: (updater: (current: SharedJobFormState) => SharedJobFormState) => void;
  errors: SharedJobFieldErrors;
  currentUser: SessionUser;
  canViewFinance: boolean;
};

type DetailRenderContext = {
  detail: SharedJobDetailResponse;
  currentUser: SessionUser;
  canViewFinance: boolean;
  selectedDay?: SharedJobDetailResponse["days"][number] | null;
};

export type DepartmentJobAdapterUI = {
  departmentType: Extract<JobDepartmentType, "schools" | "sports">;
  labels: {
    departmentBadge: string;
    listScope: string;
    objectLabel: string;
    pluralLabel: string;
    titleLabel: string;
    eventNameLabel: string;
    leadOwnerLabel: string;
  };
  createTitle: string;
  editTitle: string;
  detailTitle: string;
  listTitle: string;
  getDefaultValues(): Partial<SharedJobFormState>;
  getSharedFieldOverrides(): Partial<DepartmentJobAdapterUI["labels"]>;
  getSectionDefinitions(context: FormRenderContext): SharedJobFormSectionDefinition[];
  getSidebarCards(context: FormRenderContext): SharedJobSidebarCardDefinition[];
  getOperationalCopy(): {
    readinessLabel: string;
    staffingLabel: string;
    dayOfLabel: string;
    readyActionLabel: string;
    issuesLabel: string;
  };
  getOperationalCards(context: DetailRenderContext): SharedJobOperationalCardDefinition[];
  getListColumns(): SharedJobListColumnDefinition[];
  getFilterDefinitions(): SharedJobFilterDefinition[];
  getSavedViewPresets(): SharedJobSavedViewPreset[];
  getDetailTabs(context: DetailRenderContext): SharedJobDetailTabDefinition[];
  validateDraft(formState: SharedJobFormState): SharedJobFormValidationIssue[];
  validatePublish(formState: SharedJobFormState): SharedJobFormValidationIssue[];
  mapFormToApiPayload(formState: SharedJobFormState): SharedJobDraftInput;
  mapApiToForm(apiRecord: SharedJobDetailResponse): SharedJobFormState;
};

export const BASELINE_FILTER_STATE: SharedJobListFilterState = {
  search: "",
  dateRange: "all",
  organizationId: "",
  jobCategory: "",
  primaryContactId: "",
  locationId: "",
  accountOwnerUserId: "",
  leadOwnerUserId: "",
  jobStatus: "",
  productionStatus: "",
  releaseStatus: "",
  staffingStatus: "",
  readinessStatus: "",
  riskStatus: "",
  archived: "active",
  departmentType: "",
  schoolYear: "",
  districtId: "",
  yearbookRequired: "",
  idCardsRequired: "",
  rosterMode: "",
  sportType: "",
  season: "",
  proofRequired: "",
  bannerRequired: "",
  revenueShareEnabled: ""
};

const JOB_STATUS_OPTIONS = [
  "",
  "draft",
  "pending_confirmation",
  "confirmed",
  "ready_to_staff",
  "staffed",
  "ready_to_execute",
  "in_progress",
  "execution_complete",
  "postponed",
  "weather_hold",
  "cancelled",
  "archived"
];

const PRODUCTION_STATUS_OPTIONS = [
  "",
  "queued",
  "awaiting_ingest",
  "editing",
  "proof_build",
  "proof_sent",
  "awaiting_approval",
  "revisions_requested",
  "approved_for_production",
  "ordered_or_printed",
  "packaged",
  "delivered",
  "complete",
  "blocked"
];

const STAFFING_STATUS_OPTIONS = ["", "unassigned", "partially_staffed", "staffed", "checked_in", "ready_confirmed", "gap_flagged"];
const READINESS_STATUS_OPTIONS = ["", "off_track", "at_risk", "on_track", "ready"];
const RISK_STATUS_OPTIONS = ["", "none", "low", "medium", "high", "critical"];

const DATE_RANGE_OPTIONS = [
  { value: "all", label: "All dates" },
  { value: "next-7", label: "Next 7 days" },
  { value: "next-14", label: "Next 14 days" },
  { value: "overdue", label: "Past due" }
];

const PRIORITY_OPTIONS: Array<{ value: JobPriorityLevel; label: string }> = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" }
];

const JOB_CATEGORY_OPTIONS: Array<{ value: JobCategory; label: string }> = [
  { value: "photo_day", label: "Photo Day" },
  { value: "makeup_day", label: "Makeup Day" },
  { value: "reshoot", label: "Reshoot" },
  { value: "media_day", label: "Media Day" },
  { value: "event", label: "Event" },
  { value: "banner_day", label: "Banner Day" },
  { value: "specialty", label: "Specialty" },
  { value: "delivery_only", label: "Delivery Only" },
  { value: "other", label: "Other" }
];

const SHARED_DELIVERY_OPTIONS = [
  { value: "", label: "Select delivery type" },
  { value: "gallery_only", label: "Gallery Only" },
  { value: "proofs_and_order", label: "Proofs and Order" },
  { value: "banners_only", label: "Banners Only" },
  { value: "specialty_only", label: "Specialty Only" },
  { value: "mixed", label: "Mixed" }
];

const SHARED_GALLERY_OPTIONS = [
  { value: "", label: "Select gallery type" },
  { value: "none", label: "None" },
  { value: "individual", label: "Individual" },
  { value: "team", label: "Team" },
  { value: "team_and_individual", label: "Team and Individual" }
];

function blankFormDay(timezone = "America/Chicago"): SharedJobFormDayState {
  return {
    day_label: "",
    date: "",
    start_time: "",
    end_time: "",
    timezone,
    location_id: "",
    onsite_contact_id: "",
    lead_user_id: "",
    weather_sensitive: false,
    indoor_outdoor: "",
    access_notes: "",
    parking_notes: "",
    setup_notes: "",
    travel_notes: ""
  };
}

export function createBlankSharedJobFormState(departmentType: Extract<JobDepartmentType, "schools" | "sports">): SharedJobFormState {
  return {
    department_type: departmentType,
    job_category: "photo_day",
    organization_id: "",
    primary_location_id: "",
    primary_contact_id: "",
    account_owner_user_id: "",
    title: "",
    event_name: "",
    description_internal: "",
    priority_level: "normal",
    delivery_type: "",
    gallery_type: "",
    scheduled_start_date: "",
    scheduled_start_time: "",
    scheduled_end_date: "",
    scheduled_end_time: "",
    timezone: "America/Chicago",
    estimated_subject_count: "",
    estimated_staff_count: "",
    client_deadline_at: "",
    production_deadline_at: "",
    production_required: true,
    location_override_note: "",
    contact_override_note: "",
    school_profile: {
      district_id: "",
      school_type: "",
      school_year: "",
      grade_scope: "",
      roster_source: "",
      id_cards_required: false,
      yearbook_required: false,
      composite_required: false,
      admin_portal_required: false,
      submission_deadline: "",
      advisor_sorting_required: false,
      homeroom_sorting_required: false,
      data_import_mode: "",
      special_instructions: ""
    },
    sports_profile: {
      sport_type: "",
      season: "",
      league_name: "",
      division: "",
      team_structure: "",
      estimated_team_count: "",
      proof_required: false,
      approval_contact_id: "",
      billing_contact_id: "",
      revenue_share_enabled: false,
      revenue_share_terms_summary: "",
      banner_work_required: false,
      specialty_products_required: false,
      buddy_photos_required: false,
      sponsor_graphics_required: false,
      client_expectations_notes: ""
    },
    days: [blankFormDay()]
  };
}

function asNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function splitTimestamp(value: string | null) {
  if (!value) {
    return { date: "", time: "" };
  }
  const normalized = value.includes("T") ? value : `${value}T00:00:00`;
  return {
    date: normalized.slice(0, 10),
    time: normalized.length >= 16 ? normalized.slice(11, 16) : ""
  };
}

function composeTimestamp(date: string, time: string) {
  if (!date) {
    return null;
  }
  return `${date}T${time || "00:00"}:00`;
}

function mapDaysToInput(days: SharedJobFormDayState[]) {
  return days
    .filter((day) => day.date)
    .map((day) => ({
      day_label: day.day_label || null,
      date: day.date,
      start_time: day.start_time || null,
      end_time: day.end_time || null,
      timezone: day.timezone || null,
      location_id: day.location_id || null,
      onsite_contact_id: day.onsite_contact_id || null,
      lead_user_id: day.lead_user_id || null,
      weather_sensitive: day.weather_sensitive,
      indoor_outdoor: day.indoor_outdoor || null,
      access_notes: day.access_notes || null,
      parking_notes: day.parking_notes || null,
      setup_notes: day.setup_notes || null,
      travel_notes: day.travel_notes || null
    }));
}

function mapApiToDays(detail: SharedJobDetailResponse): SharedJobFormDayState[] {
  if (detail.days.length) {
    return detail.days.map((day) => ({
      day_label: day.day_label ?? "",
      date: day.date ?? "",
      start_time: day.start_time ?? "",
      end_time: day.end_time ?? "",
      timezone: day.timezone ?? detail.job.timezone,
      location_id: day.location_id ?? "",
      onsite_contact_id: day.onsite_contact_id ?? "",
      lead_user_id: day.lead_user_id ?? "",
      weather_sensitive: day.weather_sensitive,
      indoor_outdoor: day.indoor_outdoor ?? "",
      access_notes: day.access_notes ?? "",
      parking_notes: day.parking_notes ?? "",
      setup_notes: day.setup_notes ?? "",
      travel_notes: day.travel_notes ?? ""
    }));
  }

  const start = splitTimestamp(detail.job.scheduled_start_at);
  const end = splitTimestamp(detail.job.scheduled_end_at);
  if (start.date) {
    return [
      {
        ...blankFormDay(detail.job.timezone),
        date: start.date,
        start_time: start.time,
        end_time: end.time,
        location_id: detail.job.primary_location_id ?? ""
      }
    ];
  }

  return [blankFormDay(detail.job.timezone)];
}

function mapSharedFormToApiPayload(formState: SharedJobFormState): SharedJobDraftInput {
  return {
    department_type: formState.department_type,
    job_category: formState.job_category,
    organization_id: formState.organization_id || null,
    primary_location_id: formState.primary_location_id || null,
    primary_contact_id: formState.primary_contact_id || null,
    account_owner_user_id: formState.account_owner_user_id || null,
    title: formState.title || null,
    event_name: formState.event_name || null,
    description_internal: formState.description_internal || null,
    priority_level: formState.priority_level,
    delivery_type: formState.delivery_type || null,
    gallery_type: formState.gallery_type || null,
    scheduled_start_at: composeTimestamp(formState.scheduled_start_date, formState.scheduled_start_time),
    scheduled_end_at: composeTimestamp(formState.scheduled_end_date || formState.scheduled_start_date, formState.scheduled_end_time),
    timezone: formState.timezone || null,
    estimated_subject_count: asNumber(formState.estimated_subject_count),
    estimated_staff_count: asNumber(formState.estimated_staff_count),
    client_deadline_at: formState.client_deadline_at || null,
    production_deadline_at: formState.production_deadline_at || null,
    production_required: formState.production_required,
    location_override_note: formState.location_override_note || null,
    contact_override_note: formState.contact_override_note || null,
    days: mapDaysToInput(formState.days)
  };
}

function mapApiToSharedForm(apiRecord: SharedJobDetailResponse): SharedJobFormState {
  const start = splitTimestamp(apiRecord.job.scheduled_start_at);
  const end = splitTimestamp(apiRecord.job.scheduled_end_at);
  return {
    ...createBlankSharedJobFormState(apiRecord.job.department_type as Extract<JobDepartmentType, "schools" | "sports">),
    department_type: apiRecord.job.department_type,
    job_category: apiRecord.job.job_category,
    organization_id: apiRecord.job.organization_id ?? "",
    primary_location_id: apiRecord.job.primary_location_id ?? "",
    primary_contact_id: apiRecord.job.primary_contact_id ?? "",
    account_owner_user_id: apiRecord.job.account_owner_user_id ?? "",
    title: apiRecord.job.title ?? "",
    event_name: apiRecord.job.event_name ?? "",
    description_internal: apiRecord.job.description_internal ?? "",
    priority_level: apiRecord.job.priority_level,
    delivery_type: apiRecord.job.delivery_type ?? "",
    gallery_type: apiRecord.job.gallery_type ?? "",
    scheduled_start_date: start.date,
    scheduled_start_time: start.time,
    scheduled_end_date: end.date,
    scheduled_end_time: end.time,
    timezone: apiRecord.job.timezone,
    estimated_subject_count: apiRecord.job.estimated_subject_count != null ? String(apiRecord.job.estimated_subject_count) : "",
    estimated_staff_count: apiRecord.job.estimated_staff_count != null ? String(apiRecord.job.estimated_staff_count) : "",
    client_deadline_at: apiRecord.job.client_deadline_at ? apiRecord.job.client_deadline_at.slice(0, 10) : "",
    production_deadline_at: apiRecord.job.production_deadline_at ? apiRecord.job.production_deadline_at.slice(0, 10) : "",
    production_required: apiRecord.job.production_required,
    location_override_note: apiRecord.job.location_override_note ?? "",
    contact_override_note: apiRecord.job.contact_override_note ?? "",
    school_profile: {
      district_id: apiRecord.school_profile?.district_id ?? "",
      school_type: apiRecord.school_profile?.school_type ?? "",
      school_year: apiRecord.school_profile?.school_year ?? "",
      grade_scope: apiRecord.school_profile?.grade_scope ?? "",
      roster_source: apiRecord.school_profile?.roster_source ?? "",
      id_cards_required: apiRecord.school_profile?.id_cards_required ?? false,
      yearbook_required: apiRecord.school_profile?.yearbook_required ?? false,
      composite_required: apiRecord.school_profile?.composite_required ?? false,
      admin_portal_required: apiRecord.school_profile?.admin_portal_required ?? false,
      submission_deadline: apiRecord.school_profile?.submission_deadline ?? "",
      advisor_sorting_required: apiRecord.school_profile?.advisor_sorting_required ?? false,
      homeroom_sorting_required: apiRecord.school_profile?.homeroom_sorting_required ?? false,
      data_import_mode: apiRecord.school_profile?.data_import_mode ?? "",
      special_instructions: apiRecord.school_profile?.special_instructions ?? ""
    },
    sports_profile: {
      sport_type: apiRecord.sports_profile?.sport_type ?? "",
      season: apiRecord.sports_profile?.season ?? "",
      league_name: apiRecord.sports_profile?.league_name ?? "",
      division: apiRecord.sports_profile?.division ?? "",
      team_structure: apiRecord.sports_profile?.team_structure ?? "",
      estimated_team_count: apiRecord.sports_profile?.estimated_team_count != null ? String(apiRecord.sports_profile.estimated_team_count) : "",
      proof_required: apiRecord.sports_profile?.proof_required ?? false,
      approval_contact_id: apiRecord.sports_profile?.approval_contact_id ?? "",
      billing_contact_id: apiRecord.sports_profile?.billing_contact_id ?? "",
      revenue_share_enabled: apiRecord.sports_profile?.revenue_share_enabled ?? false,
      revenue_share_terms_summary: apiRecord.sports_profile?.revenue_share_terms_summary ?? "",
      banner_work_required: apiRecord.sports_profile?.banner_work_required ?? false,
      specialty_products_required: apiRecord.sports_profile?.specialty_products_required ?? false,
      buddy_photos_required: apiRecord.sports_profile?.buddy_photos_required ?? false,
      sponsor_graphics_required: apiRecord.sports_profile?.sponsor_graphics_required ?? false,
      client_expectations_notes: apiRecord.sports_profile?.client_expectations_notes ?? ""
    },
    days: mapApiToDays(apiRecord)
  };
}

function buildSharedIssues(formState: SharedJobFormState): SharedJobFormValidationIssue[] {
  const issues: SharedJobFormValidationIssue[] = [];
  if (!formState.organization_id) {
    issues.push({ field: "organization_id", message: "Choose an organization.", sectionId: "core-identity" });
  }
  if (!formState.title.trim() && !formState.event_name.trim()) {
    issues.push({ field: "title", message: "Add a title or event name.", sectionId: "core-identity" });
  }
  if (!formState.timezone.trim()) {
    issues.push({ field: "timezone", message: "Timezone is required.", sectionId: "schedule-location" });
  }
  return issues;
}

function buildSharedPublishIssues(formState: SharedJobFormState): SharedJobFormValidationIssue[] {
  const issues = buildSharedIssues(formState);
  if (!formState.primary_location_id && !formState.location_override_note.trim()) {
    issues.push({ field: "primary_location_id", message: "Choose a primary location or add an override note.", sectionId: "schedule-location" });
  }
  if (!formState.primary_contact_id && !formState.contact_override_note.trim()) {
    issues.push({ field: "primary_contact_id", message: "Choose a primary contact or add an override note.", sectionId: "contacts-ownership" });
  }
  if (!formState.account_owner_user_id) {
    issues.push({ field: "account_owner_user_id", message: "Assign an owner before publish.", sectionId: "contacts-ownership" });
  }
  if (!(formState.days.some((day) => day.date) || formState.scheduled_start_date)) {
    issues.push({ field: "days", message: "Add at least one job day or summary schedule.", sectionId: "job-days" });
  }
  return issues;
}

function renderFieldError(errors: SharedJobFieldErrors, key: string) {
  const messages = errors[key] ?? [];
  if (!messages.length) {
    return null;
  }
  return <div className="shared-job-form__field-errors" role="alert">{messages.map((message) => <div key={`${key}-${message}`}>{message}</div>)}</div>;
}

function boolOption(label: string, value: boolean, onChange: (next: boolean) => void) {
  return (
    <label className="shared-job-form__toggle">
      <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function sharedColumns(): SharedJobListColumnDefinition[] {
  return [
    { key: "risk", label: "Risk", render: (item) => <RiskBadge level={item.risk_status} /> },
    { key: "job_number", label: "Job #", render: (item) => item.job_number ?? "Draft" },
    { key: "organization", label: "Organization", render: (item) => item.organization_name ?? "Unassigned" },
    { key: "title", label: "Title", render: (item) => item.title || item.event_name || "Untitled job" },
    {
      key: "primary_date",
      label: "Primary Date",
      render: (item) =>
        item.primary_day_date
          ? `${formatDate(item.primary_day_date)}${item.primary_day_start_time ? ` | ${formatTimeRange(item.primary_day_start_time, item.primary_day_end_time)}` : ""}`
          : "TBD"
    },
    { key: "primary_location", label: "Location", render: (item) => item.primary_location_name ?? "TBD" },
    { key: "primary_contact", label: "Primary Contact", render: (item) => item.primary_contact_name ?? "TBD" },
    { key: "account_owner", label: "Owner", render: (item) => item.account_owner_name ?? "Unassigned" },
    { key: "job_status", label: "Job", render: (item) => <StatusPill label={humanizeToken(item.job_status)} tone={statusTone(item.job_status)} /> },
    { key: "production_status", label: "Production", render: (item) => <StatusPill label={humanizeToken(item.production_status)} tone={statusTone(item.production_status)} /> },
    { key: "staffing_status", label: "Staffing", render: (item) => <StatusPill label={humanizeToken(item.staffing_status)} tone={statusTone(item.staffing_status)} /> },
    { key: "readiness_status", label: "Readiness", render: (item) => <StatusPill label={humanizeToken(item.readiness_status)} tone={statusTone(item.readiness_status)} /> },
    { key: "last_updated", label: "Last Updated", render: (item) => formatDateTime(item.updated_at) }
  ];
}

function sharedFilters(): SharedJobFilterDefinition[] {
  return [
    { key: "dateRange", label: "Date range", options: DATE_RANGE_OPTIONS },
    { key: "jobStatus", label: "Job status", options: JOB_STATUS_OPTIONS.map((value) => ({ value, label: value ? humanizeToken(value) : "All job statuses" })) },
    { key: "productionStatus", label: "Production", options: PRODUCTION_STATUS_OPTIONS.map((value) => ({ value, label: value ? humanizeToken(value) : "All production" })) },
    { key: "staffingStatus", label: "Staffing", options: STAFFING_STATUS_OPTIONS.map((value) => ({ value, label: value ? humanizeToken(value) : "All staffing" })) },
    { key: "readinessStatus", label: "Readiness", options: READINESS_STATUS_OPTIONS.map((value) => ({ value, label: value ? humanizeToken(value) : "All readiness" })) },
    { key: "riskStatus", label: "Risk", options: RISK_STATUS_OPTIONS.map((value) => ({ value, label: value ? humanizeToken(value) : "All risk" })) },
    {
      key: "archived",
      label: "Archive",
      options: [
        { value: "active", label: "Active only" },
        { value: "archived", label: "Archived only" },
        { value: "all", label: "All" }
      ]
    }
  ];
}

const schoolsAdapter: DepartmentJobAdapterUI = {
  departmentType: "schools",
  labels: {
    departmentBadge: "Schools",
    listScope: "School jobs",
    objectLabel: "School Job",
    pluralLabel: "School Jobs",
    titleLabel: "Job title",
    eventNameLabel: "Picture day label",
    leadOwnerLabel: "Lead owner"
  },
  createTitle: "New School Job",
  editTitle: "Edit School Job",
  detailTitle: "School Job Detail",
  listTitle: "School Jobs",
  getDefaultValues() {
    return {
      school_profile: {
        ...createBlankSharedJobFormState("schools").school_profile,
        school_year: `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`
      }
    };
  },
  getSharedFieldOverrides() {
    return {
      titleLabel: "Job title",
      eventNameLabel: "Picture day label"
    };
  },
  getSectionDefinitions({ state, setState, errors }) {
    return [
      {
        key: "schools-data",
        slot: "identity.after",
        title: "School Data",
        summary: "District and roster context that keeps the school workflow grounded in the shared job engine.",
        fields: ["school_profile.school_type", "school_profile.district_id", "school_profile.school_year", "school_profile.grade_scope"],
        body: (
          <div className="field-grid shared-job-form__grid">
            <label className="filter-field">
              <span>School type</span>
              <input value={state.school_profile.school_type} onChange={(event) => setState((current) => ({ ...current, school_profile: { ...current.school_profile, school_type: event.target.value } }))} />
              {renderFieldError(errors, "school_profile.school_type")}
            </label>
            <label className="filter-field">
              <span>District ID</span>
              <input value={state.school_profile.district_id} onChange={(event) => setState((current) => ({ ...current, school_profile: { ...current.school_profile, district_id: event.target.value } }))} />
              {renderFieldError(errors, "school_profile.district_id")}
            </label>
            <label className="filter-field">
              <span>School year</span>
              <input value={state.school_profile.school_year} onChange={(event) => setState((current) => ({ ...current, school_profile: { ...current.school_profile, school_year: event.target.value } }))} />
            </label>
            <label className="filter-field">
              <span>Grade scope</span>
              <input value={state.school_profile.grade_scope} onChange={(event) => setState((current) => ({ ...current, school_profile: { ...current.school_profile, grade_scope: event.target.value } }))} />
            </label>
            <label className="filter-field">
              <span>Roster source</span>
              <input value={state.school_profile.roster_source} onChange={(event) => setState((current) => ({ ...current, school_profile: { ...current.school_profile, roster_source: event.target.value } }))} />
            </label>
            <label className="filter-field">
              <span>Data import mode</span>
              <input value={state.school_profile.data_import_mode} onChange={(event) => setState((current) => ({ ...current, school_profile: { ...current.school_profile, data_import_mode: event.target.value } }))} />
            </label>
          </div>
        )
      },
      {
        key: "schools-deliverables",
        slot: "production.after",
        title: "Deliverables",
        summary: "School-specific deliverables and sorting logic layered on the shared readiness and production model.",
        fields: [
          "school_profile.id_cards_required",
          "school_profile.yearbook_required",
          "school_profile.submission_deadline",
          "school_profile.advisor_sorting_required",
          "school_profile.homeroom_sorting_required"
        ],
        body: (
          <div className="shared-job-form__stack">
            <div className="shared-job-form__toggle-grid">
              {boolOption("ID cards required", state.school_profile.id_cards_required, (next) => setState((current) => ({ ...current, school_profile: { ...current.school_profile, id_cards_required: next } })))}
              {boolOption("Yearbook required", state.school_profile.yearbook_required, (next) => setState((current) => ({ ...current, school_profile: { ...current.school_profile, yearbook_required: next } })))}
              {boolOption("Composite required", state.school_profile.composite_required, (next) => setState((current) => ({ ...current, school_profile: { ...current.school_profile, composite_required: next } })))}
              {boolOption("Admin portal required", state.school_profile.admin_portal_required, (next) => setState((current) => ({ ...current, school_profile: { ...current.school_profile, admin_portal_required: next } })))}
              {boolOption("Advisor sorting required", state.school_profile.advisor_sorting_required, (next) => setState((current) => ({ ...current, school_profile: { ...current.school_profile, advisor_sorting_required: next } })))}
              {boolOption("Homeroom sorting required", state.school_profile.homeroom_sorting_required, (next) => setState((current) => ({ ...current, school_profile: { ...current.school_profile, homeroom_sorting_required: next } })))}
            </div>
            <label className="filter-field">
              <span>Submission deadline</span>
              <input type="date" value={state.school_profile.submission_deadline} onChange={(event) => setState((current) => ({ ...current, school_profile: { ...current.school_profile, submission_deadline: event.target.value } }))} />
            </label>
          </div>
        )
      },
      {
        key: "schools-operations",
        slot: "notes.after",
        title: "School Operations",
        summary: "Operational context that should travel with the school-specific adapter, not a forked form flow.",
        fields: ["school_profile.special_instructions"],
        body: (
          <label className="filter-field filter-field--wide">
            <span>Special instructions</span>
            <textarea rows={4} value={state.school_profile.special_instructions} onChange={(event) => setState((current) => ({ ...current, school_profile: { ...current.school_profile, special_instructions: event.target.value } }))} />
          </label>
        )
      }
    ];
  },
  getSidebarCards({ state }) {
    return [
      {
        key: "schools-deliverables-summary",
        title: "Deliverables Summary",
        body: (
          <div className="shared-job-sidebar__kv">
            <span>{state.school_profile.yearbook_required ? "Yearbook required" : "Yearbook not required"}</span>
            <span>{state.school_profile.id_cards_required ? "ID cards required" : "No ID cards"}</span>
            <span>{state.school_profile.submission_deadline ? `Deadline ${formatDate(state.school_profile.submission_deadline)}` : "No submission deadline yet"}</span>
          </div>
        )
      }
    ];
  },
  getOperationalCopy() {
    return {
      readinessLabel: "Picture Day readiness",
      staffingLabel: "Picture Day staffing",
      dayOfLabel: "Picture Day execution",
      readyActionLabel: "Ready to Start Picture Day",
      issuesLabel: "Picture Day issues"
    };
  },
  getOperationalCards({ detail, selectedDay }) {
    return [
      {
        key: "schools-data-readiness",
        placement: "readiness",
        title: "School Data Readiness",
        body: (
          <div className="shared-job-sidebar__kv">
            <span>Roster source: {detail.school_profile?.roster_source ?? "Not set"}</span>
            <span>School year: {detail.school_profile?.school_year ?? "Not set"}</span>
            <span>Grade scope: {detail.school_profile?.grade_scope ?? "Not set"}</span>
          </div>
        )
      },
      {
        key: "schools-deliverables-operational",
        placement: "readiness",
        title: "Deliverables Readiness",
        body: (
          <div className="shared-job-sidebar__kv">
            <span>{detail.school_profile?.id_cards_required ? "ID cards confirmed" : "No ID-card workflow"}</span>
            <span>{detail.school_profile?.yearbook_required ? "Yearbook workflow active" : "No yearbook workflow"}</span>
            <span>{detail.school_profile?.submission_deadline ? `Due ${formatDate(detail.school_profile.submission_deadline)}` : "No submission deadline"}</span>
          </div>
        )
      },
      {
        key: "schools-staffing-context",
        placement: "staffing",
        title: "School Day Context",
        body: (
          <div className="shared-job-sidebar__kv">
            <span>District: {detail.school_profile?.district_name ?? "Not linked"}</span>
            <span>School type: {detail.school_profile?.school_type ? humanizeToken(detail.school_profile.school_type) : "Not set"}</span>
            <span>Expected subjects: {detail.job.estimated_subject_count ?? "TBD"}</span>
          </div>
        )
      },
      {
        key: "schools-day-context",
        placement: "day-of",
        title: "Building And Setup",
        body: (
          <div className="shared-job-sidebar__kv">
            <span>Onsite contact: {selectedDay?.onsite_contact_name ?? detail.summary.primary_contact_name ?? "Unassigned"}</span>
            <span>Access: {selectedDay?.access_notes ?? "No access notes"}</span>
            <span>Setup: {selectedDay?.setup_notes ?? "No setup notes"}</span>
          </div>
        )
      },
      {
        key: "schools-today-context",
        placement: "today",
        title: "Picture Day Context",
        body: (
          <div className="shared-job-sidebar__kv">
            <span>{detail.school_profile?.yearbook_required ? "Yearbook workflow active" : "Yearbook not required"}</span>
            <span>{detail.school_profile?.id_cards_required ? "ID-card flow required" : "No ID-card flow"}</span>
            <span>{selectedDay?.location_name ?? detail.summary.primary_location_name ?? "Location TBD"}</span>
          </div>
        )
      }
    ];
  },
  getListColumns() {
    return [
      ...sharedColumns().slice(0, 4),
      { key: "school_year", label: "School Year", render: (item) => item.school_profile?.school_year ?? "TBD" },
      { key: "district", label: "District", render: (item) => item.school_profile?.district_name ?? "None" },
      { key: "id_cards", label: "ID Cards", render: (item) => <StatusPill label={item.school_profile?.id_cards_required ? "Required" : "No"} tone={item.school_profile?.id_cards_required ? "info" : "neutral"} /> },
      { key: "yearbook", label: "Yearbook", render: (item) => <StatusPill label={item.school_profile?.yearbook_required ? "Required" : "No"} tone={item.school_profile?.yearbook_required ? "info" : "neutral"} /> },
      ...sharedColumns().slice(4)
    ];
  },
  getFilterDefinitions() {
    return [
      ...sharedFilters(),
      { key: "schoolYear", label: "School year", options: [{ value: "", label: "All school years" }, { value: "current", label: "Current year" }, { value: "next", label: "Next year" }] },
      { key: "districtId", label: "District", options: [{ value: "", label: "All districts" }, { value: "assigned", label: "With district" }, { value: "missing", label: "Missing district" }] },
      { key: "yearbookRequired", label: "Yearbook", options: [{ value: "", label: "All" }, { value: "yes", label: "Required" }, { value: "no", label: "Not required" }] },
      { key: "idCardsRequired", label: "ID cards", options: [{ value: "", label: "All" }, { value: "yes", label: "Required" }, { value: "no", label: "Not required" }] }
    ];
  },
  getSavedViewPresets() {
    return [
      { key: "schools-all", label: "All School Jobs", description: "Every school job in the shared engine.", filters: {} },
      { key: "schools-yearbook", label: "Yearbook", description: "School jobs with yearbook deliverables.", filters: { yearbookRequired: "yes" } },
      { key: "schools-id-cards", label: "ID Cards", description: "School jobs that still carry ID card work.", filters: { idCardsRequired: "yes" } }
    ];
  },
  getDetailTabs({ detail }) {
    return [
      {
        key: "school-deliverables",
        label: "School Deliverables",
        body: <div className="shared-job-detail__card-grid"><div className="panel shared-job-detail__mini-card"><strong>Deliverables</strong><span>{detail.school_profile?.yearbook_required ? "Yearbook required" : "Yearbook not required"}</span><span>{detail.school_profile?.id_cards_required ? "ID cards required" : "No ID cards"}</span><span>{detail.school_profile?.submission_deadline ? `Due ${formatDate(detail.school_profile.submission_deadline)}` : "No submission deadline"}</span></div></div>
      },
      {
        key: "data",
        label: "Data",
        body: <div className="shared-job-detail__card-grid"><div className="panel shared-job-detail__mini-card"><strong>Roster and Data</strong><span>District: {detail.school_profile?.district_name ?? "None"}</span><span>Roster source: {detail.school_profile?.roster_source ?? "Not set"}</span><span>Data import mode: {detail.school_profile?.data_import_mode ?? "Not set"}</span></div></div>
      }
    ];
  },
  validateDraft(formState) {
    return buildSharedIssues(formState);
  },
  validatePublish(formState) {
    const issues = buildSharedPublishIssues(formState);
    if (!formState.school_profile.school_type.trim() && !formState.school_profile.grade_scope.trim()) {
      issues.push({ field: "school_profile.school_type", message: "Add school context before publish.", sectionId: "schools-data" });
    }
    if (formState.school_profile.id_cards_required && !formState.school_profile.advisor_sorting_required && !formState.school_profile.homeroom_sorting_required) {
      issues.push({ field: "school_profile.advisor_sorting_required", message: "ID-card workflows need advisor or homeroom sorting.", sectionId: "schools-deliverables" });
    }
    return issues;
  },
  mapFormToApiPayload(formState) {
    return {
      ...mapSharedFormToApiPayload(formState),
      school_profile: {
        district_id: formState.school_profile.district_id || null,
        school_type: formState.school_profile.school_type || null,
        school_year: formState.school_profile.school_year || null,
        grade_scope: formState.school_profile.grade_scope || null,
        roster_source: formState.school_profile.roster_source || null,
        id_cards_required: formState.school_profile.id_cards_required,
        yearbook_required: formState.school_profile.yearbook_required,
        composite_required: formState.school_profile.composite_required,
        admin_portal_required: formState.school_profile.admin_portal_required,
        submission_deadline: formState.school_profile.submission_deadline || null,
        advisor_sorting_required: formState.school_profile.advisor_sorting_required,
        homeroom_sorting_required: formState.school_profile.homeroom_sorting_required,
        data_import_mode: formState.school_profile.data_import_mode || null,
        special_instructions: formState.school_profile.special_instructions || null
      },
      sports_profile: null
    };
  },
  mapApiToForm(apiRecord) {
    return mapApiToSharedForm(apiRecord);
  }
};

const sportsAdapter: DepartmentJobAdapterUI = {
  departmentType: "sports",
  labels: {
    departmentBadge: "Sports",
    listScope: "Sports shoots",
    objectLabel: "Sports Job",
    pluralLabel: "Sports Jobs",
    titleLabel: "Job title",
    eventNameLabel: "Event name",
    leadOwnerLabel: "Lead photographer"
  },
  createTitle: "New Sports Job",
  editTitle: "Edit Sports Job",
  detailTitle: "Sports Shoot Detail",
  listTitle: "Sports Shoots",
  getDefaultValues() {
    return {
      sports_profile: {
        ...createBlankSharedJobFormState("sports").sports_profile,
        proof_required: true
      }
    };
  },
  getSharedFieldOverrides() {
    return {
      eventNameLabel: "Event name",
      leadOwnerLabel: "Lead photographer"
    };
  },
  getSectionDefinitions({ state, setState, errors, canViewFinance }) {
    return [
      {
        key: "sports-event-structure",
        slot: "identity.after",
        title: "Sports Event Structure",
        summary: "Seasonal and team structure details injected into the shared shell without forking it.",
        fields: ["sports_profile.sport_type", "sports_profile.season", "sports_profile.team_structure", "sports_profile.estimated_team_count", "estimated_subject_count"],
        body: (
          <div className="field-grid shared-job-form__grid">
            <label className="filter-field"><span>Sport type</span><input value={state.sports_profile.sport_type} onChange={(event) => setState((current) => ({ ...current, sports_profile: { ...current.sports_profile, sport_type: event.target.value } }))} />{renderFieldError(errors, "sports_profile.sport_type")}</label>
            <label className="filter-field"><span>Season</span><input value={state.sports_profile.season} onChange={(event) => setState((current) => ({ ...current, sports_profile: { ...current.sports_profile, season: event.target.value } }))} />{renderFieldError(errors, "sports_profile.season")}</label>
            <label className="filter-field"><span>League name</span><input value={state.sports_profile.league_name} onChange={(event) => setState((current) => ({ ...current, sports_profile: { ...current.sports_profile, league_name: event.target.value } }))} /></label>
            <label className="filter-field"><span>Division</span><input value={state.sports_profile.division} onChange={(event) => setState((current) => ({ ...current, sports_profile: { ...current.sports_profile, division: event.target.value } }))} /></label>
            <label className="filter-field"><span>Team structure</span><input value={state.sports_profile.team_structure} onChange={(event) => setState((current) => ({ ...current, sports_profile: { ...current.sports_profile, team_structure: event.target.value } }))} />{renderFieldError(errors, "sports_profile.team_structure")}</label>
            <label className="filter-field"><span>Estimated teams</span><input value={state.sports_profile.estimated_team_count} onChange={(event) => setState((current) => ({ ...current, sports_profile: { ...current.sports_profile, estimated_team_count: event.target.value } }))} /></label>
            <label className="filter-field"><span>Estimated subjects</span><input value={state.estimated_subject_count} onChange={(event) => setState((current) => ({ ...current, estimated_subject_count: event.target.value }))} /></label>
          </div>
        )
      },
      {
        key: "sports-approval-production",
        slot: "production.after",
        title: "Sports Approval and Production",
        summary: "Proof, approval, and specialty product flags living inside the same shared production framework.",
        fields: ["sports_profile.proof_required", "sports_profile.approval_contact_id", "sports_profile.banner_work_required", "sports_profile.specialty_products_required"],
        body: (
          <div className="shared-job-form__stack">
            <div className="shared-job-form__toggle-grid">
              {boolOption("Proof required", state.sports_profile.proof_required, (next) => setState((current) => ({ ...current, sports_profile: { ...current.sports_profile, proof_required: next } })))}
              {boolOption("Banner work required", state.sports_profile.banner_work_required, (next) => setState((current) => ({ ...current, sports_profile: { ...current.sports_profile, banner_work_required: next } })))}
              {boolOption("Specialty products required", state.sports_profile.specialty_products_required, (next) => setState((current) => ({ ...current, sports_profile: { ...current.sports_profile, specialty_products_required: next } })))}
              {boolOption("Buddy photos required", state.sports_profile.buddy_photos_required, (next) => setState((current) => ({ ...current, sports_profile: { ...current.sports_profile, buddy_photos_required: next } })))}
              {boolOption("Sponsor graphics required", state.sports_profile.sponsor_graphics_required, (next) => setState((current) => ({ ...current, sports_profile: { ...current.sports_profile, sponsor_graphics_required: next } })))}
            </div>
            <div className="field-grid shared-job-form__grid">
              <label className="filter-field"><span>Approval contact ID</span><input value={state.sports_profile.approval_contact_id} onChange={(event) => setState((current) => ({ ...current, sports_profile: { ...current.sports_profile, approval_contact_id: event.target.value } }))} />{renderFieldError(errors, "sports_profile.approval_contact_id")}</label>
              <label className="filter-field"><span>Billing contact ID</span><input value={state.sports_profile.billing_contact_id} onChange={(event) => setState((current) => ({ ...current, sports_profile: { ...current.sports_profile, billing_contact_id: event.target.value } }))} /></label>
            </div>
          </div>
        )
      },
      {
        key: "sports-financial-summary",
        slot: "sidebar.top",
        title: "Sports Account / Financial Summary",
        summary: "Permissioned revenue-share context stays in the adapter and only renders when allowed.",
        fields: ["sports_profile.revenue_share_enabled", "sports_profile.revenue_share_terms_summary"],
        body: canViewFinance ? (
          <div className="field-grid shared-job-form__grid">
            {boolOption("Revenue share enabled", state.sports_profile.revenue_share_enabled, (next) => setState((current) => ({ ...current, sports_profile: { ...current.sports_profile, revenue_share_enabled: next } })))}
            <label className="filter-field filter-field--wide"><span>Revenue share terms summary</span><textarea rows={3} value={state.sports_profile.revenue_share_terms_summary} onChange={(event) => setState((current) => ({ ...current, sports_profile: { ...current.sports_profile, revenue_share_terms_summary: event.target.value } }))} /></label>
          </div>
        ) : (
          <div className="shared-job-sidebar__muted">Financial fields stay hidden for your role.</div>
        )
      },
      {
        key: "sports-expectations",
        slot: "notes.after",
        title: "Sports Expectations",
        summary: "Client-facing expectations and workflow notes layered on the shared notes section.",
        fields: ["sports_profile.client_expectations_notes"],
        body: <label className="filter-field filter-field--wide"><span>Client expectations notes</span><textarea rows={4} value={state.sports_profile.client_expectations_notes} onChange={(event) => setState((current) => ({ ...current, sports_profile: { ...current.sports_profile, client_expectations_notes: event.target.value } }))} /></label>
      }
    ];
  },
  getSidebarCards({ state, canViewFinance }) {
    return [
      {
        key: "sports-proof-summary",
        title: "Proof and Specialty Summary",
        body: <div className="shared-job-sidebar__kv"><span>{state.sports_profile.proof_required ? "Proof required" : "No proof required"}</span><span>{state.sports_profile.banner_work_required ? "Banner work flagged" : "No banner work"}</span><span>{state.sports_profile.specialty_products_required ? "Specialty products enabled" : "No specialty products"}</span></div>
      },
      {
        key: "sports-revenue-summary",
        title: "Revenue Share",
        body: canViewFinance ? <div className="shared-job-sidebar__kv"><span>{state.sports_profile.revenue_share_enabled ? "Enabled" : "Not enabled"}</span><span>{state.sports_profile.revenue_share_terms_summary || "No terms summary"}</span></div> : <div className="shared-job-sidebar__muted">Financial summaries are hidden for your role.</div>
      }
    ];
  },
  getOperationalCopy() {
    return {
      readinessLabel: "Shoot readiness",
      staffingLabel: "Shoot staffing",
      dayOfLabel: "Shoot execution",
      readyActionLabel: "Ready to Work",
      issuesLabel: "Shoot issues"
    };
  },
  getOperationalCards({ detail, canViewFinance, selectedDay }) {
    const cards: SharedJobOperationalCardDefinition[] = [
      {
        key: "sports-event-structure-card",
        placement: "readiness",
        title: "Event Structure",
        body: (
          <div className="shared-job-sidebar__kv">
            <span>Sport: {detail.sports_profile?.sport_type ? humanizeToken(detail.sports_profile.sport_type) : "TBD"}</span>
            <span>Season: {detail.sports_profile?.season ? humanizeToken(detail.sports_profile.season) : "TBD"}</span>
            <span>Teams: {detail.sports_profile?.estimated_team_count ?? "TBD"}</span>
          </div>
        )
      },
      {
        key: "sports-proof-approval-card",
        placement: "readiness",
        title: "Proof And Approval",
        body: (
          <div className="shared-job-sidebar__kv">
            <span>{detail.sports_profile?.proof_required ? "Proof required" : "Proof not required"}</span>
            <span>Approval owner: {detail.sports_profile?.approval_contact_name ?? "Unassigned"}</span>
            <span>Billing contact: {detail.sports_profile?.billing_contact_name ?? "Unassigned"}</span>
          </div>
        )
      },
      {
        key: "sports-staffing-context",
        placement: "staffing",
        title: "Coverage Context",
        body: (
          <div className="shared-job-sidebar__kv">
            <span>Lead photographer: {detail.summary.lead_owner_name ?? "Unassigned"}</span>
            <span>Expected staff: {detail.job.estimated_staff_count ?? "TBD"}</span>
            <span>Expected subjects: {detail.job.estimated_subject_count ?? "TBD"}</span>
          </div>
        )
      },
      {
        key: "sports-specialty-products-card",
        placement: "day-of",
        title: "Specialty Products Watch",
        body: (
          <div className="shared-job-sidebar__kv">
            <span>{detail.sports_profile?.banner_work_required ? "Banner work in scope" : "No banner work"}</span>
            <span>{detail.sports_profile?.specialty_products_required ? "Specialty products active" : "No specialty products"}</span>
            <span>{selectedDay?.lead_user_name ?? detail.summary.lead_owner_name ?? "Lead not assigned"}</span>
          </div>
        )
      },
      {
        key: "sports-today-context",
        placement: "today",
        title: "Sports Day Context",
        body: (
          <div className="shared-job-sidebar__kv">
            <span>{detail.sports_profile?.team_structure ? humanizeToken(detail.sports_profile.team_structure) : "Team structure TBD"}</span>
            <span>Approval owner: {detail.sports_profile?.approval_contact_name ?? "Unassigned"}</span>
            <span>{selectedDay?.location_name ?? detail.summary.primary_location_name ?? "Location TBD"}</span>
          </div>
        )
      }
    ];
    if (canViewFinance) {
      cards.push({
        key: "sports-revenue-share-card",
        placement: "today",
        title: "Revenue Share Summary",
        body: (
          <div className="shared-job-sidebar__kv">
            <span>{detail.sports_profile?.revenue_share_enabled ? "Revenue share enabled" : "Revenue share off"}</span>
            <span>{detail.sports_profile?.revenue_share_terms_summary ?? "No revenue-share summary"}</span>
          </div>
        )
      });
    }
    return cards;
  },
  getListColumns() {
    return [
      ...sharedColumns().slice(0, 4),
      { key: "sport_type", label: "Sport", render: (item) => item.sports_profile?.sport_type ? humanizeToken(item.sports_profile.sport_type) : "TBD" },
      { key: "season", label: "Season", render: (item) => item.sports_profile?.season ? humanizeToken(item.sports_profile.season) : "TBD" },
      { key: "proof_status", label: "Proof", render: (item) => <StatusPill label={humanizeToken(item.proof_status ?? "not_required")} tone={statusTone(item.proof_status)} /> },
      { key: "estimated_teams", label: "Teams", render: (item) => item.sports_profile?.estimated_team_count ?? "TBD" },
      { key: "lead_owner", label: "Lead", render: (item) => item.lead_owner_name ?? "Unassigned" },
      ...sharedColumns().slice(4)
    ];
  },
  getFilterDefinitions() {
    return [
      ...sharedFilters(),
      { key: "sportType", label: "Sport", options: [{ value: "", label: "All sports" }, { value: "baseball", label: "Baseball" }, { value: "basketball", label: "Basketball" }, { value: "football", label: "Football" }, { value: "hockey", label: "Hockey" }, { value: "soccer", label: "Soccer" }, { value: "other", label: "Other" }] },
      { key: "season", label: "Season", options: [{ value: "", label: "All seasons" }, { value: "spring", label: "Spring" }, { value: "summer", label: "Summer" }, { value: "fall", label: "Fall" }, { value: "winter", label: "Winter" }, { value: "annual", label: "Annual" }] },
      { key: "proofRequired", label: "Proof required", options: [{ value: "", label: "All" }, { value: "yes", label: "Required" }, { value: "no", label: "Not required" }] },
      { key: "bannerRequired", label: "Banner work", options: [{ value: "", label: "All" }, { value: "yes", label: "Required" }, { value: "no", label: "Not required" }] },
      { key: "revenueShareEnabled", label: "Revenue share", options: [{ value: "", label: "All" }, { value: "yes", label: "Enabled" }, { value: "no", label: "Not enabled" }] }
    ];
  },
  getSavedViewPresets() {
    return [
      { key: "sports-next-14", label: "Next 14 Days", description: "Upcoming sports jobs that need active execution focus.", filters: { dateRange: "next-14" } },
      { key: "sports-proofs", label: "Waiting on Approval", description: "Sports jobs with proof work in flight.", filters: { proofRequired: "yes", productionStatus: "awaiting_approval" } },
      { key: "sports-banners", label: "Banners / Specialty", description: "Banner or specialty-heavy sports work.", filters: { bannerRequired: "yes" } }
    ];
  },
  getDetailTabs({ detail, canViewFinance }) {
    const tabs: SharedJobDetailTabDefinition[] = [
      {
        key: "event",
        label: "Event",
        body: <div className="shared-job-detail__card-grid"><div className="panel shared-job-detail__mini-card"><strong>Event Structure</strong><span>Sport: {detail.sports_profile?.sport_type ? humanizeToken(detail.sports_profile.sport_type) : "TBD"}</span><span>Season: {detail.sports_profile?.season ? humanizeToken(detail.sports_profile.season) : "TBD"}</span><span>Team structure: {detail.sports_profile?.team_structure ? humanizeToken(detail.sports_profile.team_structure) : "TBD"}</span><span>Estimated teams: {detail.sports_profile?.estimated_team_count ?? "TBD"}</span></div></div>
      },
      {
        key: "proofs",
        label: "Proofs",
        body: <div className="shared-job-detail__card-grid"><div className="panel shared-job-detail__mini-card"><strong>Proof and Approval</strong><span>{detail.sports_profile?.proof_required ? "Proof required" : "Proof not required"}</span><span>Approval owner: {detail.sports_profile?.approval_contact_name ?? "Unassigned"}</span><span>Proof status: {humanizeToken(detail.summary.proof_status ?? "not_required")}</span></div></div>
      },
      {
        key: "products",
        label: "Products",
        body: <div className="shared-job-detail__card-grid"><div className="panel shared-job-detail__mini-card"><strong>Specialty Products</strong><span>{detail.sports_profile?.banner_work_required ? "Banner work required" : "No banner work"}</span><span>{detail.sports_profile?.specialty_products_required ? "Specialty products enabled" : "No specialty products"}</span><span>{detail.sports_profile?.buddy_photos_required ? "Buddy photos enabled" : "No buddy photos"}</span></div></div>
      }
    ];
    if (canViewFinance) {
      tabs.push({
        key: "financial",
        label: "Financial",
        body: <div className="shared-job-detail__card-grid"><div className="panel shared-job-detail__mini-card"><strong>Revenue Share</strong><span>{detail.sports_profile?.revenue_share_enabled ? "Enabled" : "Not enabled"}</span><span>{detail.sports_profile?.revenue_share_terms_summary ?? "No revenue-share summary"}</span></div></div>
      });
    }
    return tabs;
  },
  validateDraft(formState) {
    return buildSharedIssues(formState);
  },
  validatePublish(formState) {
    const issues = buildSharedPublishIssues(formState);
    if (!formState.sports_profile.sport_type.trim()) {
      issues.push({ field: "sports_profile.sport_type", message: "Sport type is required.", sectionId: "sports-event-structure" });
    }
    if (!formState.sports_profile.season.trim()) {
      issues.push({ field: "sports_profile.season", message: "Season is required.", sectionId: "sports-event-structure" });
    }
    if (!formState.sports_profile.team_structure.trim()) {
      issues.push({ field: "sports_profile.team_structure", message: "Team structure is required.", sectionId: "sports-event-structure" });
    }
    if (formState.sports_profile.proof_required && !formState.sports_profile.approval_contact_id.trim()) {
      issues.push({ field: "sports_profile.approval_contact_id", message: "Proof-required sports jobs need an approval owner.", sectionId: "sports-approval-production" });
    }
    return issues;
  },
  mapFormToApiPayload(formState) {
    return {
      ...mapSharedFormToApiPayload(formState),
      school_profile: null,
      sports_profile: {
        sport_type: formState.sports_profile.sport_type || null,
        season: formState.sports_profile.season || null,
        league_name: formState.sports_profile.league_name || null,
        division: formState.sports_profile.division || null,
        team_structure: formState.sports_profile.team_structure || null,
        estimated_team_count: asNumber(formState.sports_profile.estimated_team_count),
        proof_required: formState.sports_profile.proof_required,
        approval_contact_id: formState.sports_profile.approval_contact_id || null,
        billing_contact_id: formState.sports_profile.billing_contact_id || null,
        revenue_share_enabled: formState.sports_profile.revenue_share_enabled,
        revenue_share_terms_summary: formState.sports_profile.revenue_share_terms_summary || null,
        banner_work_required: formState.sports_profile.banner_work_required,
        specialty_products_required: formState.sports_profile.specialty_products_required,
        buddy_photos_required: formState.sports_profile.buddy_photos_required,
        sponsor_graphics_required: formState.sports_profile.sponsor_graphics_required,
        client_expectations_notes: formState.sports_profile.client_expectations_notes || null
      }
    };
  },
  mapApiToForm(apiRecord) {
    return mapApiToSharedForm(apiRecord);
  }
};

const registry = new Map<DepartmentJobAdapterUI["departmentType"], DepartmentJobAdapterUI>([
  ["schools", schoolsAdapter],
  ["sports", sportsAdapter]
]);

export function getDepartmentJobAdapterUI(departmentType: Extract<JobDepartmentType, "schools" | "sports">) {
  return registry.get(departmentType) ?? sportsAdapter;
}

export function getAllDepartmentJobAdapters() {
  return [...registry.values()];
}

export function buildFieldErrorMap(issues: SharedJobFormValidationIssue[]): SharedJobFieldErrors {
  return issues.reduce<SharedJobFieldErrors>((accumulator, issue) => {
    const current = accumulator[issue.field] ?? [];
    return { ...accumulator, [issue.field]: [...current, issue.message] };
  }, {});
}

export function getJobSectionIssueCount(section: SharedJobFormSectionDefinition, issues: SharedJobFormValidationIssue[]) {
  return issues.filter((issue) => issue.sectionId === section.key || section.fields.some((field) => issue.field.startsWith(field))).length;
}

export function getSharedJobBaselineColumns() {
  return sharedColumns();
}

export function getSharedJobBaselineFilters() {
  return sharedFilters();
}

export function getSharedJobCategoryOptions() {
  return JOB_CATEGORY_OPTIONS;
}

export function getSharedJobPriorityOptions() {
  return PRIORITY_OPTIONS;
}

export function getSharedDeliveryTypeOptions() {
  return SHARED_DELIVERY_OPTIONS;
}

export function getSharedGalleryTypeOptions() {
  return SHARED_GALLERY_OPTIONS;
}

const schoolsDownstreamPresets: Omit<SharedJobDownstreamConfig, "summaryCards"> = {
  productionTypes: [
    { value: "portraits_ingest", label: "Portraits Ingest" },
    { value: "id_cards", label: "ID Cards" },
    { value: "composites", label: "Composites" },
    { value: "yearbook_export", label: "Yearbook Export" },
    { value: "admin_portal_prep", label: "Admin Portal Prep" },
    { value: "gallery_release", label: "Gallery Release" }
  ],
  approvalTypes: [
    { value: "internal_yearbook_export_approval", label: "Internal Yearbook Export Approval" },
    { value: "school_admin_signoff", label: "School Admin Signoff" },
    { value: "composite_approval", label: "Composite Approval" }
  ],
  qaTemplates: [
    { value: "color_density_check", label: "Color / Density Check" },
    { value: "renaming_correctness", label: "Renaming Correctness" },
    { value: "sorting_correctness", label: "Sorting Correctness" },
    { value: "upload_completeness", label: "Upload Completeness" },
    { value: "portal_gallery_setup", label: "Portal / Gallery Setup" }
  ],
  deliverableTypes: [
    { value: "gallery_live", label: "Gallery Live" },
    { value: "gallery_email_sent", label: "Gallery Email Sent" },
    { value: "id_cards_delivered", label: "ID Cards Delivered" },
    { value: "id_package_delivered", label: "ID Package Delivered" },
    { value: "composite_delivered", label: "Composite Delivered" },
    { value: "yearbook_export_sent", label: "Yearbook Export Sent" },
    { value: "admin_portal_ready", label: "Admin Portal Ready" }
  ]
};

const sportsDownstreamPresets: Omit<SharedJobDownstreamConfig, "summaryCards"> = {
  productionTypes: [
    { value: "portraits_ingest", label: "Portraits Ingest" },
    { value: "proof_build", label: "Proof Build" },
    { value: "banners", label: "Banners" },
    { value: "posters", label: "Posters" },
    { value: "memory_mates", label: "Memory Mates" },
    { value: "trader_cards", label: "Trader Cards" },
    { value: "specialty_graphics", label: "Specialty Graphics" },
    { value: "gallery_release", label: "Gallery Release" }
  ],
  approvalTypes: [
    { value: "coach_proof_approval", label: "Coach Proof Approval" },
    { value: "banner_approval", label: "Banner Approval" },
    { value: "specialty_graphics_approval", label: "Specialty Graphics Approval" },
    { value: "final_client_signoff", label: "Final Client Signoff" }
  ],
  qaTemplates: [
    { value: "color_density_check", label: "Color / Density Check" },
    { value: "renaming_correctness", label: "Renaming Correctness" },
    { value: "team_grouping_correctness", label: "Team Grouping Correctness" },
    { value: "product_setup_correctness", label: "Product Setup Correctness" },
    { value: "category_sorting_accuracy", label: "Category / Sorting Accuracy" },
    { value: "gallery_release_check", label: "Gallery Release Check" }
  ],
  deliverableTypes: [
    { value: "gallery_live", label: "Gallery Live" },
    { value: "proof_packet_delivered", label: "Proof Packet Delivered" },
    { value: "banner_delivered", label: "Banner Delivered" },
    { value: "poster_delivered", label: "Poster Delivered" },
    { value: "specialty_products_delivered", label: "Specialty Products Delivered" },
    { value: "vendor_output_sent", label: "Vendor Output Sent" },
    { value: "vendor_print_batch_sent", label: "Vendor Print Batch Sent" }
  ]
};

export function getDepartmentJobDownstreamConfig({
  departmentType,
  detail,
  canViewFinance
}: {
  departmentType: Extract<JobDepartmentType, "schools" | "sports">;
  detail?: SharedJobDetailResponse | null;
  canViewFinance: boolean;
}): SharedJobDownstreamConfig {
  if (departmentType === "schools") {
    return {
      ...schoolsDownstreamPresets,
      summaryCards: detail
        ? [
            {
              key: "schools-production-summary",
              placement: "production",
              title: "Yearbook / ID Summary",
              body: (
                <div className="shared-job-sidebar__kv">
                  <span>{detail.school_profile?.yearbook_required ? "Yearbook work in scope" : "No yearbook work"}</span>
                  <span>{detail.school_profile?.id_cards_required ? "ID cards required" : "No ID cards"}</span>
                  <span>{detail.school_profile?.composite_required ? "Composites required" : "No composites"}</span>
                </div>
              )
            },
            {
              key: "schools-approvals-summary",
              placement: "approvals",
              title: "School Approval Context",
              body: (
                <div className="shared-job-sidebar__kv">
                  <span>{detail.school_profile?.school_year ? `School year: ${detail.school_profile.school_year}` : "School year TBD"}</span>
                  <span>{detail.school_profile?.submission_deadline ? `Submission deadline: ${formatDate(detail.school_profile.submission_deadline)}` : "No submission deadline"}</span>
                  <span>{detail.summary.primary_contact_name ?? "Primary contact pending"}</span>
                </div>
              )
            },
            {
              key: "schools-qa-summary",
              placement: "qa",
              title: "Data QA Focus",
              body: (
                <div className="shared-job-sidebar__kv">
                  <span>{detail.school_profile?.roster_source ? `Roster: ${humanizeToken(detail.school_profile.roster_source)}` : "Roster source TBD"}</span>
                  <span>{detail.school_profile?.homeroom_sorting_required ? "Homeroom sorting required" : "Homeroom sorting not required"}</span>
                  <span>{detail.school_profile?.advisor_sorting_required ? "Advisor sorting required" : "Advisor sorting not required"}</span>
                </div>
              )
            },
            {
              key: "schools-deliverable-summary",
              placement: "deliverables",
              title: "School Deliverables",
              body: (
                <div className="shared-job-sidebar__kv">
                  <span>{detail.school_profile?.admin_portal_required ? "Admin portal required" : "No admin portal"}</span>
                  <span>{detail.school_profile?.submission_deadline ? `School deadline: ${formatDate(detail.school_profile.submission_deadline)}` : "No school deadline"}</span>
                  <span>{detail.summary.organization_name ?? "School context pending"}</span>
                </div>
              )
            }
          ]
        : []
    };
  }

  const sportsCards: SharedJobDownstreamCardDefinition[] = detail
    ? [
        {
          key: "sports-production-summary",
          placement: "production",
          title: "Sports Product Mix",
          body: (
            <div className="shared-job-sidebar__kv">
              <span>{detail.sports_profile?.proof_required ? "Proof required" : "No proof required"}</span>
              <span>{detail.sports_profile?.banner_work_required ? "Banner work active" : "No banner work"}</span>
              <span>{detail.sports_profile?.specialty_products_required ? "Specialty products enabled" : "No specialty products"}</span>
            </div>
          )
        },
        {
          key: "sports-approval-summary",
          placement: "approvals",
          title: "Approval Owners",
          body: (
            <div className="shared-job-sidebar__kv">
              <span>Approval owner: {detail.sports_profile?.approval_contact_name ?? "Unassigned"}</span>
              <span>Billing contact: {detail.sports_profile?.billing_contact_name ?? "Unassigned"}</span>
              <span>{detail.summary.proof_status ? `Proof status: ${humanizeToken(detail.summary.proof_status)}` : "Proof status pending"}</span>
            </div>
          )
        },
        {
          key: "sports-qa-summary",
          placement: "qa",
          title: "Sports QA Focus",
          body: (
            <div className="shared-job-sidebar__kv">
              <span>{detail.sports_profile?.team_structure ? humanizeToken(detail.sports_profile.team_structure) : "Team structure TBD"}</span>
              <span>{detail.sports_profile?.estimated_team_count != null ? `${detail.sports_profile.estimated_team_count} teams` : "Teams TBD"}</span>
              <span>{detail.sports_profile?.sponsor_graphics_required ? "Sponsor graphics in scope" : "No sponsor graphics"}</span>
            </div>
          )
        },
        {
          key: "sports-deliverable-summary",
          placement: "deliverables",
          title: "Sports Delivery Context",
          body: (
            <div className="shared-job-sidebar__kv">
              <span>{detail.sports_profile?.banner_work_required ? "Banner delivery path active" : "No banner delivery"}</span>
              <span>{detail.sports_profile?.specialty_products_required ? "Specialty outputs active" : "No specialty outputs"}</span>
              <span>{detail.summary.organization_name ?? "Organization pending"}</span>
            </div>
          )
        }
      ]
    : [];

  if (detail && canViewFinance) {
    sportsCards.push({
      key: "sports-financial-context",
      placement: "overview",
      title: "Revenue Share Context",
      body: (
        <div className="shared-job-sidebar__kv">
          <span>{detail.sports_profile?.revenue_share_enabled ? "Revenue share enabled" : "Revenue share off"}</span>
          <span>{detail.sports_profile?.revenue_share_terms_summary ?? "No revenue-share summary"}</span>
        </div>
      )
    });
  }

  return {
    ...sportsDownstreamPresets,
    summaryCards: sportsCards
  };
}
