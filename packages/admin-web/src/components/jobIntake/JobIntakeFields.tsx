import type { ReactNode } from "react";
import { WorkspaceActionBar } from "../workspace/WorkspaceActionBar";
import { WorkspaceSectionHeader } from "../workspace/WorkspaceSectionHeader";
import type {
  CentralJobDeliveryType,
  CentralJobDepartment,
  CentralJobDuplicateResult,
  CentralJobPriority,
  CentralJobProductionGroupingRule,
  CentralJobReadinessEvaluation,
  CentralJobValidationResult
} from "../../jobIntakeTypes";
import type { DirectoryOwnerOption, OrganizationContact, OrganizationLocation, OrganizationSummary } from "../../types";

type FieldErrors = Record<string, string[]>;

type SectionCardProps = {
  title: string;
  summary: string;
  issueCount?: number;
  children: ReactNode;
};

type SharedLookupProps = {
  label: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  unresolvedValue: string;
  onUnresolvedChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  helperText?: string;
  errors?: string[];
};

type LookupOptionButtonProps = {
  selected: boolean;
  primary: string;
  secondary?: string | null;
  tertiary?: string | null;
  onClick: () => void;
};

type JobRoutingSectionProps = {
  department: CentralJobDepartment;
  departmentLocked?: boolean;
  jobType: string;
  onJobTypeChange: (value: string) => void;
  jobTitle: string;
  onJobTitleChange: (value: string) => void;
  onResetAutoTitle?: () => void;
  canResetAutoTitle?: boolean;
  jobOwnerUserId: string;
  onJobOwnerChange: (value: string) => void;
  ownerOptions: DirectoryOwnerOption[];
  priority: CentralJobPriority;
  onPriorityChange: (value: CentralJobPriority) => void;
  fieldErrors: FieldErrors;
  issueCount?: number;
};

type OrganizationLookupFieldProps = SharedLookupProps & {
  department: CentralJobDepartment;
  loading: boolean;
  results: OrganizationSummary[];
  selectedOrganization: OrganizationSummary | null;
  onSelectOrganization: (organization: OrganizationSummary) => void;
  collapseResults?: boolean;
  showUnresolvedField?: boolean;
  typeaheadOnly?: boolean;
};

type LocationLookupFieldProps = SharedLookupProps & {
  options: OrganizationLocation[];
  selectedLocationId: string;
  onSelectLocation: (value: string) => void;
};

type ContactLookupFieldProps = SharedLookupProps & {
  options: OrganizationContact[];
  selectedContactId: string;
  onSelectContact: (value: string) => void;
};

type ScheduleSectionProps = {
  startDate: string;
  onStartDateChange: (value: string) => void;
  startTime: string;
  onStartTimeChange: (value: string) => void;
  endTime: string;
  onEndTimeChange: (value: string) => void;
  timezone: string;
  onTimezoneChange: (value: string) => void;
  dateOnly: boolean;
  onDateOnlyChange: (value: boolean) => void;
  deliveryDueDate: string;
  onDeliveryDueDateChange: (value: string) => void;
  fieldErrors: FieldErrors;
  issueCount?: number;
};

type SchoolsDetailSectionProps = {
  values: {
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
  onChange: (field: keyof SchoolsDetailSectionProps["values"], value: string | boolean) => void;
  fieldErrors: FieldErrors;
  issueCount?: number;
};

type SportsDetailSectionProps = {
  values: {
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
  onChange: (field: keyof SportsDetailSectionProps["values"], value: string | boolean) => void;
  fieldErrors: FieldErrors;
  issueCount?: number;
};

type ProductionStaffingSectionProps = {
  productionRequired: boolean;
  onProductionRequiredChange: (value: boolean) => void;
  staffingRequired: boolean;
  onStaffingRequiredChange: (value: boolean) => void;
  staffingEstimate: string;
  onStaffingEstimateChange: (value: string) => void;
  deliveryType: string;
  onDeliveryTypeChange: (value: string) => void;
  groupingRule: CentralJobProductionGroupingRule;
  onGroupingRuleChange: (value: CentralJobProductionGroupingRule) => void;
  fieldErrors: FieldErrors;
  issueCount?: number;
};

type NotesSectionProps = {
  internalNotes: string;
  onInternalNotesChange: (value: string) => void;
  clientNotes: string;
  onClientNotesChange: (value: string) => void;
  specialInstructions: string;
  onSpecialInstructionsChange: (value: string) => void;
  rawSourceText: string;
  onRawSourceTextChange: (value: string) => void;
  fieldErrors: FieldErrors;
  issueCount?: number;
  showRawSourceText?: boolean;
  helperText?: string;
};

type DuplicateWarningPanelProps = {
  duplicateResult: CentralJobDuplicateResult | null;
  softWarningAcknowledged: boolean;
  onSoftWarningAcknowledgedChange: (value: boolean) => void;
  duplicateOverrideNote: string;
  onDuplicateOverrideNoteChange: (value: string) => void;
  canUseHardDuplicateOverride: boolean;
};

type ReadinessPreviewPanelProps = {
  readiness: CentralJobReadinessEvaluation | null;
  publishValidation: CentralJobValidationResult | null;
};

type IntakeActionBarProps = {
  hasDraft: boolean;
  saving: boolean;
  publishing: boolean;
  publishDisabled?: boolean;
  publishDisabledMessage?: string | null;
  onSaveDraft: () => void;
  onPublish: () => void;
  onClose: () => void;
};

const PRIORITY_OPTIONS: Array<{ value: CentralJobPriority; label: string }> = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" }
];

const DELIVERY_OPTIONS: Array<{ value: CentralJobDeliveryType; label: string }> = [
  { value: "ship_to_home", label: "Ship To Home" },
  { value: "school_delivery", label: "School Delivery" },
  { value: "digital_gallery", label: "Digital Gallery" },
  { value: "specialty_products", label: "Specialty Products" },
  { value: "mixed", label: "Mixed Delivery" }
];

const GROUPING_OPTIONS: Array<{ value: CentralJobProductionGroupingRule; label: string }> = [
  { value: "one_per_job", label: "One Per Job" },
  { value: "one_per_day", label: "One Per Day" },
  { value: "one_per_delivery", label: "One Per Delivery" },
  { value: "one_per_gallery", label: "One Per Gallery" },
  { value: "manual", label: "Manual Grouping" }
];

const SCHOOL_JOB_TYPE_OPTIONS = [
  { value: "fall_portraits", label: "Fall Portraits" },
  { value: "retakes", label: "Retakes" },
  { value: "spring_portraits", label: "Spring Portraits" },
  { value: "sports", label: "School Sports" },
  { value: "graduation", label: "Graduation" },
  { value: "yearbook", label: "Yearbook" },
  { value: "ids", label: "IDs" },
  { value: "admin_fulfillment", label: "Admin Fulfillment" },
  { value: "delivery", label: "Delivery" },
  { value: "other", label: "Other" }
] as const;

const SPORTS_JOB_TYPE_OPTIONS = [
  { value: "media_day", label: "Media Day" },
  { value: "league_day", label: "League Day" },
  { value: "tournament", label: "Tournament" },
  { value: "individual_portraits", label: "Individual Portraits" },
  { value: "team_banners", label: "Team Banners" },
  { value: "other", label: "Other" }
] as const;

function RequiredMark() {
  return (
    <span className="job-intake__required" aria-hidden="true">
      *
    </span>
  );
}

function SectionCard({ title, summary, issueCount = 0, children }: SectionCardProps) {
  return (
    <section className={`panel job-intake__section${issueCount > 0 ? " job-intake__section--attention" : ""}`}>
      <WorkspaceSectionHeader
        title={title}
        summary={summary}
        badge={issueCount > 0 ? <span className="job-intake__issue-badge">{issueCount} issue{issueCount === 1 ? "" : "s"}</span> : null}
      />
      <div className="job-intake__section-body">{children}</div>
    </section>
  );
}

function LookupOptionButton({ selected, primary, secondary, tertiary, onClick }: LookupOptionButtonProps) {
  return (
    <button type="button" className={`job-intake__lookup-option${selected ? " is-selected" : ""}`} onClick={onClick}>
      <strong>{primary}</strong>
      {secondary ? <span>{secondary}</span> : null}
      {tertiary ? <span className="muted">{tertiary}</span> : null}
    </button>
  );
}

function renderFieldErrorList(fieldErrors: FieldErrors, key: string) {
  const messages = fieldErrors[key] ?? [];
  if (!messages.length) {
    return null;
  }
  return (
    <div className="job-intake__field-errors" role="alert">
      {messages.map((message) => (
        <div key={`${key}-${message}`}>{message}</div>
      ))}
    </div>
  );
}

export function OrganizationLookupField({
  department,
  label,
  searchValue,
  onSearchChange,
  unresolvedValue,
  onUnresolvedChange,
  loading,
  results,
  selectedOrganization,
  onSelectOrganization,
  disabled = false,
  required = false,
  helperText,
  errors = [],
  collapseResults = false,
  showUnresolvedField = true,
  typeaheadOnly = false
}: OrganizationLookupFieldProps) {
  const query = searchValue.trim().toLowerCase();
  const departmentResults = results.filter((organization) =>
    department === "sports"
      ? organization.account_type === "sports"
      : organization.account_type === "schools_underclass_portraits" || organization.account_type === "schools_events"
  );
  const filteredResults =
    typeaheadOnly && query
      ? departmentResults.filter((organization) =>
          [organization.display_name, organization.canonical_name, ...organization.aliases]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query)
        )
      : typeaheadOnly
        ? []
        : departmentResults;
  const shouldShowTypeaheadResults = typeaheadOnly && query.length > 0 && filteredResults.length > 0;
  const shouldShowNoMatch = typeaheadOnly && query.length > 0 && !loading && filteredResults.length === 0 && !selectedOrganization;

  return (
    <div className="job-intake__lookup">
      <label className="filter-field filter-field--wide">
        <span>
          {label}
          {required ? <RequiredMark /> : null}
        </span>
        <input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search canonical organizations"
          disabled={disabled}
        />
      </label>
      {helperText ? <div className="job-intake__helper">{helperText}</div> : null}
      {errors.length ? (
        <div className="job-intake__field-errors" role="alert">
          {errors.map((message) => (
            <div key={message}>{message}</div>
          ))}
        </div>
      ) : null}
      {selectedOrganization ? (
        <div className="job-intake__selected-record">
          <strong>{selectedOrganization.display_name}</strong>
          <span>{selectedOrganization.account_type.replace(/_/g, " ")}</span>
        </div>
      ) : null}
      {loading ? <div className="job-intake__helper">Searching organizations…</div> : null}
      {shouldShowTypeaheadResults ? (
        <div className="job-intake__lookup-results" role="list">
          {filteredResults.slice(0, 6).map((organization) => (
            <LookupOptionButton
              key={organization.id}
              selected={selectedOrganization?.id === organization.id}
              primary={organization.display_name}
              secondary={`${organization.contact_count} contacts | ${organization.location_count} locations`}
              tertiary={organization.aliases.length ? `Also known as: ${organization.aliases.slice(0, 2).join(", ")}` : null}
              onClick={() => onSelectOrganization(organization)}
            />
          ))}
        </div>
      ) : null}
      {shouldShowNoMatch ? <div className="job-intake__helper">No matching organization found. Choose an existing organization for now.</div> : null}
      {!typeaheadOnly && !loading && filteredResults.length && collapseResults ? (
        <details className="job-intake__lookup-results-disclosure">
          <summary>{filteredResults.length} matching organization{filteredResults.length === 1 ? "" : "s"}</summary>
          <div className="job-intake__lookup-results" role="list">
            {filteredResults.slice(0, 6).map((organization) => (
              <LookupOptionButton
                key={organization.id}
                selected={selectedOrganization?.id === organization.id}
                primary={organization.display_name}
                secondary={`${organization.contact_count} contacts | ${organization.location_count} locations`}
                tertiary={organization.aliases.length ? `Aliases: ${organization.aliases.slice(0, 2).join(", ")}` : null}
                onClick={() => onSelectOrganization(organization)}
              />
            ))}
          </div>
        </details>
      ) : null}
      {!typeaheadOnly && !loading && filteredResults.length && !collapseResults ? (
        <div className="job-intake__lookup-results" role="list">
          {filteredResults.slice(0, 6).map((organization) => (
            <LookupOptionButton
              key={organization.id}
              selected={selectedOrganization?.id === organization.id}
              primary={organization.display_name}
              secondary={`${organization.contact_count} contacts | ${organization.location_count} locations`}
              tertiary={organization.aliases.length ? `Aliases: ${organization.aliases.slice(0, 2).join(", ")}` : null}
              onClick={() => onSelectOrganization(organization)}
            />
          ))}
        </div>
      ) : null}
      {showUnresolvedField ? (
        <label className="filter-field filter-field--wide">
          <span>Organization not selected yet</span>
          <input
            value={unresolvedValue}
            onChange={(event) => onUnresolvedChange(event.target.value)}
            placeholder="New organization details can be reviewed later"
            disabled={disabled}
          />
        </label>
      ) : null}
    </div>
  );
}

export function LocationLookupField({
  label,
  searchValue,
  onSearchChange,
  unresolvedValue,
  onUnresolvedChange,
  options,
  selectedLocationId,
  onSelectLocation,
  disabled = false,
  required = false,
  helperText,
  errors = []
}: LocationLookupFieldProps) {
  const query = searchValue.trim().toLowerCase();
  const filteredOptions = query
    ? options.filter((location) =>
        [location.location_name, location.address_display, location.notes].filter(Boolean).join(" ").toLowerCase().includes(query)
      )
    : options;

  return (
    <div className="job-intake__lookup">
      <label className="filter-field filter-field--wide">
        <span>
          {label}
          {required ? <RequiredMark /> : null}
        </span>
        <input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search organization locations"
          disabled={disabled}
        />
      </label>
      {helperText ? <div className="job-intake__helper">{helperText}</div> : null}
      {errors.length ? (
        <div className="job-intake__field-errors" role="alert">
          {errors.map((message) => (
            <div key={message}>{message}</div>
          ))}
        </div>
      ) : null}
      {filteredOptions.length ? (
        <div className="job-intake__lookup-results" role="list">
          {filteredOptions.slice(0, 6).map((location) => (
            <LookupOptionButton
              key={location.id}
              selected={selectedLocationId === location.id}
              primary={location.location_name}
              secondary={location.address_display ?? "Address pending"}
              tertiary={location.notes}
              onClick={() => onSelectLocation(location.id)}
            />
          ))}
        </div>
      ) : (
        <div className="job-intake__helper">Select an organization to load locations, or keep a draft placeholder.</div>
      )}
      <label className="filter-field filter-field--wide">
        <span>Unresolved location placeholder</span>
        <input
          value={unresolvedValue}
          onChange={(event) => onUnresolvedChange(event.target.value)}
          placeholder="Gym, stadium, TBD venue, or on-site placeholder"
          disabled={disabled}
        />
      </label>
    </div>
  );
}

export function ContactLookupField({
  label,
  searchValue,
  onSearchChange,
  unresolvedValue,
  onUnresolvedChange,
  options,
  selectedContactId,
  onSelectContact,
  disabled = false,
  required = false,
  helperText,
  errors = []
}: ContactLookupFieldProps) {
  const query = searchValue.trim().toLowerCase();
  const filteredOptions = query
    ? options.filter((contact) =>
        [contact.full_name, contact.title, contact.phone, contact.email].filter(Boolean).join(" ").toLowerCase().includes(query)
      )
    : options;

  return (
    <div className="job-intake__lookup">
      <label className="filter-field filter-field--wide">
        <span>
          {label}
          {required ? <RequiredMark /> : null}
        </span>
        <input value={searchValue} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search linked contacts" disabled={disabled} />
      </label>
      {helperText ? <div className="job-intake__helper">{helperText}</div> : null}
      {errors.length ? (
        <div className="job-intake__field-errors" role="alert">
          {errors.map((message) => (
            <div key={message}>{message}</div>
          ))}
        </div>
      ) : null}
      {filteredOptions.length ? (
        <div className="job-intake__lookup-results" role="list">
          {filteredOptions.slice(0, 6).map((contact) => (
            <LookupOptionButton
              key={contact.id}
              selected={selectedContactId === contact.id}
              primary={contact.full_name}
              secondary={[contact.title, contact.phone, contact.email].filter(Boolean).join(" | ") || "Linked contact"}
              tertiary={contact.notes}
              onClick={() => onSelectContact(contact.id)}
            />
          ))}
        </div>
      ) : (
        <div className="job-intake__helper">Select an organization to load contacts, or keep a draft placeholder.</div>
      )}
      <label className="filter-field filter-field--wide">
        <span>Unresolved primary contact placeholder</span>
        <input
          value={unresolvedValue}
          onChange={(event) => onUnresolvedChange(event.target.value)}
          placeholder="Use only until the real contact is resolved"
          disabled={disabled}
        />
      </label>
    </div>
  );
}

export function JobRoutingSection({
  department,
  departmentLocked = true,
  jobType,
  onJobTypeChange,
  jobTitle,
  onJobTitleChange,
  onResetAutoTitle,
  canResetAutoTitle = false,
  jobOwnerUserId,
  onJobOwnerChange,
  ownerOptions,
  priority,
  onPriorityChange,
  fieldErrors,
  issueCount = 0
}: JobRoutingSectionProps) {
  const jobTypeOptions =
    department === "sports"
      ? [{ value: "sports", label: "Sports" }]
      : [
          { value: "", label: "Choose job type" },
          { value: "schools_underclass_portraits", label: "Schools - Underclass Portraits" },
          { value: "schools_events", label: "Schools - Events" }
        ];

  return (
    <SectionCard
      title="Job Type and Routing"
      summary="Set the canonical department, job type, ownership, and priority before the draft fans out anywhere else."
      issueCount={issueCount}
    >
      <div className="field-grid job-intake__grid">
        <label className="filter-field">
          <span>
            Department
            <RequiredMark />
          </span>
          {departmentLocked ? (
            <div className="job-intake__static-field">{department === "schools" ? "Schools" : "Sports"}</div>
          ) : (
            <select value={department} disabled>
              <option value={department}>{department}</option>
            </select>
          )}
        </label>
        <label className="filter-field">
          <span>
            Job Type
            <RequiredMark />
          </span>
          <select value={jobType} onChange={(event) => onJobTypeChange(event.target.value)}>
            {jobTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {renderFieldErrorList(fieldErrors, "job_type")}
        </label>
        <label className="filter-field">
          <span>
            Job Owner
            <RequiredMark />
          </span>
          <select value={jobOwnerUserId} onChange={(event) => onJobOwnerChange(event.target.value)}>
            <option value="">Choose owner</option>
            {ownerOptions.map((owner) => (
              <option key={owner.user_id} value={owner.user_id}>
                {owner.full_name}
                {owner.department ? ` | ${owner.department}` : ""}
              </option>
            ))}
          </select>
          {renderFieldErrorList(fieldErrors, "job_owner_user_id")}
        </label>
        <label className="filter-field">
          <span>Priority</span>
          <select value={priority} onChange={(event) => onPriorityChange(event.target.value as CentralJobPriority)}>
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field filter-field--wide">
          <span>Job Title</span>
          <input value={jobTitle} onChange={(event) => onJobTitleChange(event.target.value)} />
          {renderFieldErrorList(fieldErrors, "job_title")}
        </label>
      </div>
      {canResetAutoTitle && onResetAutoTitle ? (
        <WorkspaceActionBar align="start" compact>
          <button type="button" className="secondary-button" onClick={onResetAutoTitle}>
            Reset Auto Title
          </button>
        </WorkspaceActionBar>
      ) : null}
    </SectionCard>
  );
}

export function ScheduleSection({
  startDate,
  onStartDateChange,
  startTime,
  onStartTimeChange,
  endTime,
  onEndTimeChange,
  timezone,
  onTimezoneChange,
  dateOnly,
  onDateOnlyChange,
  deliveryDueDate,
  onDeliveryDueDateChange,
  fieldErrors,
  issueCount = 0
}: ScheduleSectionProps) {
  return (
    <SectionCard
      title="Schedule"
      summary="Drafts can start incomplete, but the schedule should still explain when the job is expected to happen."
      issueCount={issueCount}
    >
      <div className="field-grid job-intake__grid">
        <label className="filter-field">
          <span>Start Date</span>
          <input type="date" value={startDate} onChange={(event) => onStartDateChange(event.target.value)} />
          {renderFieldErrorList(fieldErrors, "start_date")}
        </label>
        <label className="filter-field">
          <span>Start Time</span>
          <input type="time" value={startTime} onChange={(event) => onStartTimeChange(event.target.value)} disabled={dateOnly} />
          {renderFieldErrorList(fieldErrors, "start_time")}
        </label>
        <label className="filter-field">
          <span>End Time</span>
          <input type="time" value={endTime} onChange={(event) => onEndTimeChange(event.target.value)} disabled={dateOnly} />
          {renderFieldErrorList(fieldErrors, "end_time")}
        </label>
        <label className="filter-field">
          <span>
            Timezone
            <RequiredMark />
          </span>
          <input value={timezone} onChange={(event) => onTimezoneChange(event.target.value)} placeholder="America/Chicago" />
          {renderFieldErrorList(fieldErrors, "timezone")}
        </label>
        <label className="filter-field">
          <span>Delivery Due Date</span>
          <input type="date" value={deliveryDueDate} onChange={(event) => onDeliveryDueDateChange(event.target.value)} />
          {renderFieldErrorList(fieldErrors, "delivery_due_date")}
        </label>
        <label className="job-intake__checkbox-field">
          <input type="checkbox" checked={dateOnly} onChange={(event) => onDateOnlyChange(event.target.checked)} />
          <span>Date only, no start time yet</span>
        </label>
      </div>
    </SectionCard>
  );
}

export function SchoolsDetailSection({ values, onChange, fieldErrors, issueCount = 0 }: SchoolsDetailSectionProps) {
  return (
    <SectionCard
      title="Department Details"
      summary="School-specific details should travel with the draft so publish does not rely on side notes or memory."
      issueCount={issueCount}
    >
      <div className="field-grid job-intake__grid">
        <label className="filter-field">
          <span>
            School Job Type
            <RequiredMark />
          </span>
          <select value={values.school_job_type} onChange={(event) => onChange("school_job_type", event.target.value)}>
            <option value="">Choose school job type</option>
            {SCHOOL_JOB_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {renderFieldErrorList(fieldErrors, "school_detail.school_job_type")}
        </label>
        <label className="filter-field">
          <span>
            Roster Status
            <RequiredMark />
          </span>
          <input value={values.roster_status} onChange={(event) => onChange("roster_status", event.target.value)} placeholder="Requested, received, approved…" />
          {renderFieldErrorList(fieldErrors, "school_detail.roster_status")}
        </label>
        <label className="filter-field">
          <span>School Type</span>
          <input value={values.school_type} onChange={(event) => onChange("school_type", event.target.value)} />
        </label>
        <label className="filter-field">
          <span>Roster Due Date</span>
          <input type="date" value={values.roster_due_date} onChange={(event) => onChange("roster_due_date", event.target.value)} />
        </label>
        <label className="filter-field">
          <span>Student Count Estimate</span>
          <input value={values.student_count_estimate} onChange={(event) => onChange("student_count_estimate", event.target.value)} inputMode="numeric" />
        </label>
        <label className="filter-field">
          <span>Staff Count Estimate</span>
          <input value={values.staff_count_estimate} onChange={(event) => onChange("staff_count_estimate", event.target.value)} inputMode="numeric" />
        </label>
        <label className="filter-field">
          <span>Grade Range</span>
          <input value={values.grade_range} onChange={(event) => onChange("grade_range", event.target.value)} placeholder="K-5, 9-12…" />
        </label>
        <label className="filter-field">
          <span>Camera Count Estimate</span>
          <input value={values.camera_count_estimate} onChange={(event) => onChange("camera_count_estimate", event.target.value)} inputMode="numeric" />
        </label>
        <label className="job-intake__checkbox-field">
          <input type="checkbox" checked={values.id_required} onChange={(event) => onChange("id_required", event.target.checked)} />
          <span>ID workflow required</span>
        </label>
        <label className="filter-field">
          <span>ID Sort Method</span>
          <input value={values.id_sort_method} onChange={(event) => onChange("id_sort_method", event.target.value)} disabled={!values.id_required} />
          {renderFieldErrorList(fieldErrors, "school_detail.id_sort_method")}
        </label>
        <label className="job-intake__checkbox-field">
          <input type="checkbox" checked={values.yearbook_required} onChange={(event) => onChange("yearbook_required", event.target.checked)} />
          <span>Yearbook workflow required</span>
        </label>
        <label className="filter-field">
          <span>Yearbook Due Date</span>
          <input type="date" value={values.yearbook_due_date} onChange={(event) => onChange("yearbook_due_date", event.target.value)} disabled={!values.yearbook_required} />
          {renderFieldErrorList(fieldErrors, "school_detail.yearbook_due_date")}
        </label>
        <label className="filter-field filter-field--wide">
          <span>School Day Notes</span>
          <textarea rows={3} value={values.school_day_notes} onChange={(event) => onChange("school_day_notes", event.target.value)} />
        </label>
      </div>
    </SectionCard>
  );
}

export function SportsDetailSection({ values, onChange, fieldErrors, issueCount = 0 }: SportsDetailSectionProps) {
  return (
    <SectionCard
      title="Department Details"
      summary="Sports-specific detail should be explicit before the draft feeds staffing, production, or same-day readiness."
      issueCount={issueCount}
    >
      <div className="field-grid job-intake__grid">
        <label className="filter-field">
          <span>
            Sports Job Type
            <RequiredMark />
          </span>
          <select value={values.sports_job_type} onChange={(event) => onChange("sports_job_type", event.target.value)}>
            <option value="">Choose sports job type</option>
            {SPORTS_JOB_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {renderFieldErrorList(fieldErrors, "sports_detail.sports_job_type")}
        </label>
        <label className="filter-field">
          <span>
            Sport Name
            <RequiredMark />
          </span>
          <input value={values.sport_name} onChange={(event) => onChange("sport_name", event.target.value)} placeholder="Football, volleyball, hockey…" />
          {renderFieldErrorList(fieldErrors, "sports_detail.sport_name")}
        </label>
        <label className="filter-field">
          <span>Season</span>
          <input value={values.season} onChange={(event) => onChange("season", event.target.value)} placeholder="Spring, summer, fall…" />
        </label>
        <label className="filter-field">
          <span>Level / Age Group</span>
          <input value={values.level_or_age_group} onChange={(event) => onChange("level_or_age_group", event.target.value)} placeholder="Varsity, JV, 12U…" />
        </label>
        <label className="filter-field">
          <span>Team Count Estimate</span>
          <input value={values.team_count_estimate} onChange={(event) => onChange("team_count_estimate", event.target.value)} inputMode="numeric" />
        </label>
        <label className="filter-field">
          <span>Athlete Count Estimate</span>
          <input value={values.athlete_count_estimate} onChange={(event) => onChange("athlete_count_estimate", event.target.value)} inputMode="numeric" />
        </label>
        <label className="filter-field">
          <span>Coach Count Estimate</span>
          <input value={values.coach_count_estimate} onChange={(event) => onChange("coach_count_estimate", event.target.value)} inputMode="numeric" />
        </label>
        <label className="filter-field">
          <span>Delivery Deadline Type</span>
          <input value={values.delivery_deadline_type} onChange={(event) => onChange("delivery_deadline_type", event.target.value)} placeholder="Game day, tournament weekend…" />
        </label>
        <label className="job-intake__checkbox-field">
          <input type="checkbox" checked={values.specialty_products_required} onChange={(event) => onChange("specialty_products_required", event.target.checked)} />
          <span>Specialty products required</span>
        </label>
        <label className="filter-field filter-field--wide">
          <span>Specialty Product Types</span>
          <input
            value={values.specialty_product_types_text}
            onChange={(event) => onChange("specialty_product_types_text", event.target.value)}
            disabled={!values.specialty_products_required}
            placeholder="Banners, buttons, trader cards…"
          />
          {renderFieldErrorList(fieldErrors, "sports_detail.specialty_product_types")}
        </label>
        <label className="job-intake__checkbox-field">
          <input type="checkbox" checked={values.gallery_required} onChange={(event) => onChange("gallery_required", event.target.checked)} />
          <span>Gallery required</span>
        </label>
        <label className="filter-field filter-field--wide">
          <span>Event Notes</span>
          <textarea rows={3} value={values.event_notes} onChange={(event) => onChange("event_notes", event.target.value)} />
        </label>
      </div>
    </SectionCard>
  );
}

export function ProductionStaffingSection({
  productionRequired,
  onProductionRequiredChange,
  staffingRequired,
  onStaffingRequiredChange,
  staffingEstimate,
  onStaffingEstimateChange,
  deliveryType,
  onDeliveryTypeChange,
  groupingRule,
  onGroupingRuleChange,
  fieldErrors,
  issueCount = 0
}: ProductionStaffingSectionProps) {
  return (
    <SectionCard
      title="Production and Staffing"
      summary="Set whether downstream production and staffing shells should exist once the draft is published."
      issueCount={issueCount}
    >
      <div className="field-grid job-intake__grid">
        <label className="job-intake__checkbox-field">
          <input type="checkbox" checked={productionRequired} onChange={(event) => onProductionRequiredChange(event.target.checked)} />
          <span>
            Production required
            <RequiredMark />
          </span>
        </label>
        <label className="job-intake__checkbox-field">
          <input type="checkbox" checked={staffingRequired} onChange={(event) => onStaffingRequiredChange(event.target.checked)} />
          <span>
            Staffing required
            <RequiredMark />
          </span>
        </label>
        <label className="filter-field">
          <span>Staffing Estimate</span>
          <input value={staffingEstimate} onChange={(event) => onStaffingEstimateChange(event.target.value)} inputMode="numeric" />
          {renderFieldErrorList(fieldErrors, "staffing_estimate")}
        </label>
        <label className="filter-field">
          <span>Delivery Type</span>
          <select value={deliveryType} onChange={(event) => onDeliveryTypeChange(event.target.value)}>
            <option value="">No delivery type yet</option>
            {DELIVERY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Production Grouping</span>
          <select value={groupingRule} onChange={(event) => onGroupingRuleChange(event.target.value as CentralJobProductionGroupingRule)}>
            {GROUPING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </SectionCard>
  );
}

export function NotesSection({
  internalNotes,
  onInternalNotesChange,
  clientNotes,
  onClientNotesChange,
  specialInstructions,
  onSpecialInstructionsChange,
  rawSourceText,
  onRawSourceTextChange,
  fieldErrors,
  issueCount = 0,
  showRawSourceText = true,
  helperText = "Attachments stay visible as a later-phase seam. Smart Paste and Quick Create both persist raw source text when provided."
}: NotesSectionProps) {
  return (
    <SectionCard
      title="Notes and Attachments"
      summary="Capture operator notes now. Attachment handling stays visible as a later-phase seam instead of becoming hidden ad hoc work."
      issueCount={issueCount}
    >
      <div className="field-grid job-intake__grid">
        <label className="filter-field filter-field--wide">
          <span>Internal Notes</span>
          <textarea rows={3} value={internalNotes} onChange={(event) => onInternalNotesChange(event.target.value)} />
          {renderFieldErrorList(fieldErrors, "internal_notes")}
        </label>
        <label className="filter-field filter-field--wide">
          <span>Client Notes</span>
          <textarea rows={3} value={clientNotes} onChange={(event) => onClientNotesChange(event.target.value)} />
        </label>
        <label className="filter-field filter-field--wide">
          <span>Special Instructions</span>
          <textarea rows={3} value={specialInstructions} onChange={(event) => onSpecialInstructionsChange(event.target.value)} />
        </label>
        {showRawSourceText ? (
          <label className="filter-field filter-field--wide">
            <span>Raw Source Text</span>
            <textarea
              rows={4}
              value={rawSourceText}
              onChange={(event) => onRawSourceTextChange(event.target.value)}
              placeholder="Paste source notes, copied request text, or import snippets here."
            />
          </label>
        ) : null}
      </div>
      <div className="job-intake__helper">{helperText}</div>
    </SectionCard>
  );
}

export function DuplicateWarningPanel({
  duplicateResult,
  softWarningAcknowledged,
  onSoftWarningAcknowledgedChange,
  duplicateOverrideNote,
  onDuplicateOverrideNoteChange,
  canUseHardDuplicateOverride
}: DuplicateWarningPanelProps) {
  const tone =
    duplicateResult?.hard_block ? "critical" : duplicateResult?.soft_warning ? "warning" : duplicateResult ? "success" : "neutral";

  return (
    <section className={`panel job-intake__section job-intake__section--${tone}`}>
      <WorkspaceSectionHeader
        title="Duplicate Warnings"
        summary={
          duplicateResult
            ? duplicateResult.hard_block
              ? "A hard duplicate exists and publish is blocked unless a lead or admin overrides it."
              : duplicateResult.soft_warning
                ? "A likely duplicate exists. Acknowledge it before publishing."
                : "No duplicate conflicts were found in the canonical job list."
            : "Save the draft to run a duplicate preview before publish."
        }
      />
      <div className="job-intake__section-body">
        {duplicateResult?.matching_records.length ? (
          <div className="job-intake__match-list">
            {duplicateResult.matching_records.map((match) => (
              <article key={match.id} className="job-intake__match-card">
                <div className="job-intake__match-head">
                  <strong>{match.title}</strong>
                  <span className={`job-intake__match-tone job-intake__match-tone--${match.hard_block ? "critical" : "warning"}`}>
                    {match.hard_block ? "Hard duplicate" : "Soft warning"}
                  </span>
                </div>
                <div className="muted">
                  {match.organization_name ?? "Unresolved account"} | {match.start_date ?? "No date"} | {match.location_name ?? match.unresolved_location_name ?? "No location"}
                </div>
                <div className="job-intake__match-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      window.location.hash = `#operations/shoots?shoot=${match.id}`;
                    }}
                  >
                    Open Owning Job
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
        {duplicateResult?.soft_warning ? (
          <label className="job-intake__checkbox-field">
            <input
              type="checkbox"
              checked={softWarningAcknowledged}
              onChange={(event) => onSoftWarningAcknowledgedChange(event.target.checked)}
            />
            <span>I reviewed the likely duplicate warning and still want to publish this job.</span>
          </label>
        ) : null}
        {duplicateResult?.hard_block ? (
          <>
            <label className="filter-field filter-field--wide">
              <span>Duplicate Override Note</span>
              <textarea
                rows={3}
                value={duplicateOverrideNote}
                onChange={(event) => onDuplicateOverrideNoteChange(event.target.value)}
                disabled={!canUseHardDuplicateOverride}
                placeholder={
                  canUseHardDuplicateOverride
                    ? "Explain why this hard duplicate should still publish."
                    : "A lead or admin must provide this override."
                }
              />
            </label>
            {!canUseHardDuplicateOverride ? (
              <div className="job-intake__helper">Your current role can review this duplicate, but only a lead or admin can override it.</div>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

export function ReadinessPreviewPanel({ readiness, publishValidation }: ReadinessPreviewPanelProps) {
  const publishErrors = publishValidation?.errors ?? [];
  const publishWarnings = publishValidation?.warnings ?? [];

  return (
    <section className="panel job-intake__section">
      <WorkspaceSectionHeader
        title="Readiness Preview"
        summary={
          readiness
            ? `Current readiness is ${readiness.readiness_status.replace(/_/g, " ")}. Publish validation and readiness stay separate so missing information shows up clearly.`
            : "Save the draft to compute readiness blockers and publish validation."
        }
      />
      <div className="job-intake__section-body">
        {readiness ? (
          <div className="job-intake__readiness-grid">
            <div className="job-intake__readiness-column">
              <strong>Blocking readiness items</strong>
              {readiness.blockers.length ? (
                <ul>
                  {readiness.blockers.map((issue) => (
                    <li key={issue.code}>
                      {issue.label}: {issue.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No blocking readiness issues are currently open.</p>
              )}
            </div>
            <div className="job-intake__readiness-column">
              <strong>Warnings</strong>
              {readiness.warnings.length ? (
                <ul>
                  {readiness.warnings.map((issue) => (
                    <li key={issue.code}>
                      {issue.label}: {issue.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No non-blocking readiness warnings are currently open.</p>
              )}
            </div>
          </div>
        ) : null}
        {publishErrors.length ? (
          <div className="job-intake__validation-strip job-intake__validation-strip--critical" role="alert">
            <strong>Publish requirements still missing</strong>
            <ul>
              {publishErrors.map((issue) => (
                <li key={`${issue.field}-${issue.code}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {publishWarnings.length ? (
          <div className="job-intake__validation-strip job-intake__validation-strip--warning">
            <strong>Publish warnings</strong>
            <ul>
              {publishWarnings.map((issue) => (
                <li key={`${issue.field}-${issue.code}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function IntakeActionBar({
  hasDraft,
  saving,
  publishing,
  publishDisabled = false,
  publishDisabledMessage = null,
  onSaveDraft,
  onPublish,
  onClose
}: IntakeActionBarProps) {
  return (
    <div className="job-intake__sticky-actions">
      {publishDisabled && publishDisabledMessage ? (
        <div className="job-intake__sticky-helper" role="status">
          {publishDisabledMessage}
        </div>
      ) : null}
      <WorkspaceActionBar align="end" className="job-intake__sticky-actions-bar">
        <button type="button" className="secondary-button" onClick={onClose} disabled={saving || publishing}>
          Close
        </button>
        <button type="button" className="secondary-button" onClick={onSaveDraft} disabled={saving || publishing}>
          {saving ? "Saving…" : hasDraft ? "Update Draft" : "Save Draft"}
        </button>
        <button type="button" onClick={onPublish} disabled={publishDisabled || saving || publishing}>
          {publishing ? "Publishing…" : "Publish"}
        </button>
      </WorkspaceActionBar>
    </div>
  );
}
