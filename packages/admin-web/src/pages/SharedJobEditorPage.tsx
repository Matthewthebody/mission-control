import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ApiClientError } from "../api";
import { usePermission } from "../components/PermissionGate";
import { SharedJobFormShell } from "../components/jobs/SharedJobFormShell";
import {
  buildFieldErrorMap,
  createBlankSharedJobFormState,
  getDepartmentJobAdapterUI,
  getJobSectionIssueCount,
  getSharedDeliveryTypeOptions,
  getSharedGalleryTypeOptions,
  getSharedJobCategoryOptions,
  getSharedJobPriorityOptions,
  type SharedJobFormSectionSlot,
  type SharedJobFieldErrors,
  type SharedJobFormState,
  type SharedJobFormValidationIssue
} from "../components/jobs/DepartmentJobAdapterUIRegistry";
import { JobDayManager } from "../components/jobs/JobDayManager";
import {
  JOB_INTAKE_TYPE_OPTIONS,
  JobDepartmentTaskPlan,
  JobIntakeReadinessPanel,
  JobRoutingOutcome,
  applyJobIntakeType,
  buildJobIntakeManagementSummary,
  buildRoutingPreviewFromForm,
  inferJobIntakeTypeId,
  type JobIntakeTypeId
} from "../components/jobs/JobRoutingFoundation";
import { SharedContactPicker, SharedLocationPicker, SharedOrganizationPicker, SharedStaffPicker } from "../components/jobs/SharedJobPickers";
import { buildSharedJobHash, navigateToSharedJobHash, parseSharedJobIdFromPath } from "../components/jobs/sharedJobRouting";
import { StatusPill, humanizeToken, statusTone, useHashRouteSnapshot } from "../components/sports/SportsPrimitives";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import type { WorkspaceHeaderMeta, WorkspaceHeaderMetaTone } from "../components/workspace/WorkspacePageHeader";
import type { SharedJobDetailResponse, SharedWorkflowTransitionValidation } from "../jobTruthTypes";
import { buildJobCalendarReadiness } from "../jobCalendarReadiness";
import { createSharedJobDraft, getSharedJobDetail, publishSharedJob, updateSharedJobDraft, updateSharedPublishedJob } from "../services/jobsApi";
import { listDirectoryContacts, listDirectoryLocations, listDirectoryOwnerOptions, listOrganizations } from "../services/organizationApi";
import type { DirectoryOwnerOption, OrganizationContact, OrganizationLocation, OrganizationSummary, SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  departmentType: "schools" | "sports" | null;
  routeBase: string;
  mode: "create" | "edit";
};

function placeholderOrganization(id: string, label: string, departmentType: "schools" | "sports") {
  return {
    id,
    canonical_name: label,
    logo_url: null,
    display_name: label,
    account_type: departmentType === "sports" ? "sports" : "schools_underclass_portraits",
    active_status: "active",
    aliases: [],
    notes: null,
    contact_count: 0,
    location_count: 0,
    created_at: "",
    updated_at: ""
  } as OrganizationSummary;
}

function collectServerIssues(error: unknown): SharedJobFormValidationIssue[] {
  if (!(error instanceof ApiClientError) || typeof error.details !== "object" || !error.details) {
    return [];
  }
  const details = error.details as {
    field_errors?: Record<string, string[]>;
    workflow_validation?: SharedWorkflowTransitionValidation;
  };
  const fieldErrors = details.field_errors ?? {};
  const workflowIssues =
    details.workflow_validation?.issues.map((issue) => ({
      field: issue.field ?? "workflow",
      message: issue.message
    })) ?? [];
  return [...Object.entries(fieldErrors).flatMap(([field, messages]) => messages.map((message) => ({ field, message }))), ...workflowIssues];
}

function mapHeaderTone(status: string | null | undefined): WorkspaceHeaderMetaTone {
  const tone = statusTone(status);
  return tone === "danger" ? "critical" : tone;
}

function groupSections(
  sharedSections: Array<{ key: string; slot: SharedJobFormSectionSlot; title: string; summary: string; fields: string[]; body: ReactNode }>,
  adapterSections: ReturnType<ReturnType<typeof getDepartmentJobAdapterUI>["getSectionDefinitions"]>,
  issues: SharedJobFormValidationIssue[]
) {
  const orderedSlots: SharedJobFormSectionSlot[] = ["identity.after", "schedule.after", "contacts.after", "production.after", "notes.after"];
  const result: Array<{ key: string; title: string; summary: string; issueCount?: number; body: ReactNode }> = [];
  const insertedSlots = new Set<SharedJobFormSectionSlot>();
  for (const shared of sharedSections) {
    result.push({
      key: shared.key,
      title: shared.title,
      summary: shared.summary,
      issueCount: getJobSectionIssueCount(shared, issues),
      body: shared.body
    });
    if (!insertedSlots.has(shared.slot)) {
      const adapterForSlot = adapterSections.filter((section) => section.slot === shared.slot);
      for (const adapterSection of adapterForSlot) {
        result.push({
          key: adapterSection.key,
          title: adapterSection.title,
          summary: adapterSection.summary,
          issueCount: getJobSectionIssueCount(adapterSection, issues),
          body: adapterSection.body
        });
      }
      insertedSlots.add(shared.slot);
    }
  }
  for (const slot of orderedSlots) {
    if (insertedSlots.has(slot) || sharedSections.some((section) => section.slot === slot)) {
      continue;
    }
    for (const adapterSection of adapterSections.filter((section) => section.slot === slot)) {
      result.push({
        key: adapterSection.key,
        title: adapterSection.title,
        summary: adapterSection.summary,
        issueCount: getJobSectionIssueCount(adapterSection, issues),
        body: adapterSection.body
      });
    }
  }
  return result;
}

export function SharedJobEditorPage({ token, currentUser, departmentType, routeBase, mode }: Props) {
  const { path, params } = useHashRouteSnapshot();
  const jobId = mode === "edit" ? parseSharedJobIdFromPath(path) : null;
  const initialDepartment = departmentType ?? (params.get("department") === "schools" ? "schools" : "sports");
  const [formState, setFormState] = useState<SharedJobFormState>(() => ({ ...createBlankSharedJobFormState(initialDepartment), ...getDepartmentJobAdapterUI(initialDepartment).getDefaultValues() }));
  const [detail, setDetail] = useState<SharedJobDetailResponse | null>(null);
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [validationIssues, setValidationIssues] = useState<SharedJobFormValidationIssue[]>([]);
  const [ownerOptions, setOwnerOptions] = useState<DirectoryOwnerOption[]>([]);
  const [organizationResults, setOrganizationResults] = useState<OrganizationSummary[]>([]);
  const [selectedOrganization, setSelectedOrganization] = useState<OrganizationSummary | null>(null);
  const [locationOptions, setLocationOptions] = useState<OrganizationLocation[]>([]);
  const [contactOptions, setContactOptions] = useState<OrganizationContact[]>([]);
  const [organizationSearch, setOrganizationSearch] = useState("");
  const [locationSearch, setLocationSearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [dirty, setDirty] = useState(false);
  const [selectedIntakeType, setSelectedIntakeType] = useState<JobIntakeTypeId | null>(null);
  const ignoreDirtyRef = useRef(false);

  const adapter = getDepartmentJobAdapterUI((formState.department_type === "schools" ? "schools" : "sports"));
  const isGlobalJobIntake = departmentType == null && mode === "create";
  const permissionContext = { departmentType: formState.department_type };
  const canCreateJob = usePermission(currentUser, "job.create", permissionContext);
  const canUpdateJob = usePermission(currentUser, "job.update", permissionContext);
  const canPublishJob = usePermission(currentUser, "job.publish", permissionContext);
  const hasFinancePermission = usePermission(currentUser, "finance.view_summary", permissionContext);
  const canViewFinance = formState.department_type === "sports" && hasFinancePermission;
  const readOnly = mode === "create" ? !canCreateJob : !canUpdateJob;
  const fieldErrors: SharedJobFieldErrors = useMemo(() => buildFieldErrorMap(validationIssues), [validationIssues]);
  const selectedOwnerName = useMemo(
    () => ownerOptions.find((owner) => owner.user_id === formState.account_owner_user_id)?.full_name ?? null,
    [formState.account_owner_user_id, ownerOptions]
  );
  const routingPreview = useMemo(
    () => buildRoutingPreviewFromForm(formState, selectedOwnerName, isGlobalJobIntake ? selectedIntakeType ?? inferJobIntakeTypeId(formState) : undefined),
    [formState, isGlobalJobIntake, selectedIntakeType, selectedOwnerName]
  );
  const intakeManagementSummary = useMemo(() => buildJobIntakeManagementSummary(formState), [formState]);
  const calendarReadiness = useMemo(
    () =>
      buildJobCalendarReadiness({
        date: formState.scheduled_start_date,
        startTime: formState.scheduled_start_time,
        endTime: formState.scheduled_end_time,
        dateOnly: !formState.scheduled_start_time,
        locationId: formState.primary_location_id,
        contactId: formState.primary_contact_id,
        accountOwnerName: selectedOwnerName,
        estimatedStaffCount: formState.estimated_staff_count
      }),
    [formState, selectedOwnerName]
  );

  useEffect(() => {
    if (!jobId || mode !== "edit") {
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getSharedJobDetail(token, jobId)
      .then((response) => {
        if (cancelled) {
          return;
        }
        const mapped = getDepartmentJobAdapterUI(response.job.department_type === "schools" ? "schools" : "sports").mapApiToForm(response);
        setDetail(response);
        setFormState(mapped);
        setSelectedOrganization(response.job.organization_id && response.summary.organization_name ? placeholderOrganization(response.job.organization_id, response.summary.organization_name, response.job.department_type === "schools" ? "schools" : "sports") : null);
        setDirty(false);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof ApiClientError ? loadError.message : "We couldn't load this job for editing.");
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
  }, [jobId, mode, token]);

  useEffect(() => {
    void listDirectoryOwnerOptions(token).then((response) => setOwnerOptions(response.owners)).catch(() => setOwnerOptions([]));
  }, [token]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void listOrganizations(token, { search: organizationSearch, accountType: "all" }).then((response) => setOrganizationResults(response.organizations)).catch(() => setOrganizationResults([]));
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [organizationSearch, token]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void listDirectoryLocations(token, { search: locationSearch, accountType: "all" }).then((response) => setLocationOptions(response.locations)).catch(() => setLocationOptions([]));
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [locationSearch, token]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void listDirectoryContacts(token, { search: contactSearch, accountType: "all", organizationId: formState.organization_id || null }).then((response) => setContactOptions(response.contacts)).catch(() => setContactOptions([]));
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [contactSearch, formState.organization_id, token]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty || ignoreDirtyRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };
    const handleHashChange = () => {
      if (!dirty || ignoreDirtyRef.current) {
        return;
      }
      const next = window.confirm("You have unsaved changes. Leave this job editor?");
      if (!next) {
        ignoreDirtyRef.current = true;
        window.location.hash = buildSharedJobHash(routeBase, mode === "edit" && jobId ? `${jobId}/edit` : "new", departmentType ? {} : { department: formState.department_type });
        window.setTimeout(() => {
          ignoreDirtyRef.current = false;
        }, 0);
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, [departmentType, dirty, formState.department_type, jobId, mode, routeBase]);

  function updateState(updater: (current: SharedJobFormState) => SharedJobFormState) {
    if (readOnly) {
      return;
    }
    setDirty(true);
    setFormState((current) => updater(current));
  }

  function applyIntakeType(value: JobIntakeTypeId) {
    setSelectedIntakeType(value);
    updateState((current) => applyJobIntakeType(current, value));
  }

  async function persist(target: "draft" | "publish") {
    if ((target === "draft" && readOnly) || (target === "publish" && (!canPublishJob || readOnly))) {
      setError(target === "publish" ? "You do not have permission to publish this job." : "You do not have permission to edit this job.");
      return;
    }
    const issues = target === "publish" ? adapter.validatePublish(formState) : adapter.validateDraft(formState);
    if (issues.length) {
      setValidationIssues(issues);
      return;
    }
    setValidationIssues([]);
    setError("");
    const payload = adapter.mapFormToApiPayload(formState);
    try {
      if (target === "draft") {
        setSaving(true);
        const response = mode === "edit" && jobId ? detail?.job.published_at ? await updateSharedPublishedJob(token, jobId, payload) : await updateSharedJobDraft(token, jobId, payload) : await createSharedJobDraft(token, payload);
        ignoreDirtyRef.current = true;
        setDirty(false);
        navigateToSharedJobHash(routeBase, response.job.id);
      } else {
        setPublishing(true);
        const response = mode === "edit" && jobId ? (detail?.job.published_at ? await updateSharedPublishedJob(token, jobId, payload) : await updateSharedJobDraft(token, jobId, payload)) : await createSharedJobDraft(token, payload);
        const published = await publishSharedJob(token, response.job.id);
        ignoreDirtyRef.current = true;
        setDirty(false);
        navigateToSharedJobHash(routeBase, published.job.id);
      }
    } catch (persistError) {
      const serverIssues = collectServerIssues(persistError);
      if (serverIssues.length) {
        setValidationIssues(serverIssues);
      }
      setError(persistError instanceof ApiClientError ? persistError.message : `We couldn't ${target === "draft" ? "save" : "publish"} this job right now.`);
    } finally {
      setSaving(false);
      setPublishing(false);
    }
  }

  if (loading) {
    return <WorkspaceLoadingBlock title="Loading job editor" summary="Opening the shared job editor and department adapter fields." />;
  }

  const adapterSections = adapter.getSectionDefinitions({ state: formState, setState: updateState, errors: fieldErrors, currentUser, canViewFinance });
  const visibleAdapterSections = isGlobalJobIntake ? [] : adapterSections;
  const sidebarCards = [
    ...(readOnly
      ? [
          {
            key: "access-mode",
            title: "Access mode",
            body: <div className="shared-job-sidebar__muted">This job is visible in read-only mode for your current role and scope.</div>
          }
        ]
      : []),
    ...visibleAdapterSections.filter((section) => section.slot === "sidebar.top").map((section) => ({ key: section.key, title: section.title, body: section.body })),
    {
      key: "publish-blockers",
      title: isGlobalJobIntake ? "Missing Info" : "Publish blockers",
      body: validationIssues.length ? <div className="shared-job-sidebar__kv">{validationIssues.map((issue) => <span key={`${issue.field}-${issue.message}`}>{issue.message}</span>)}</div> : <div className="shared-job-sidebar__muted">{isGlobalJobIntake ? "No required issue has been flagged yet." : "No current blockers."}</div>
    },
    ...(isGlobalJobIntake
      ? [
          {
            key: "review-state",
            title: "Review State",
            body: (
              <div className="shared-job-sidebar__kv">
                <span>{intakeManagementSummary.reviewState}</span>
                <span>{intakeManagementSummary.reviewAction}</span>
                <span>{intakeManagementSummary.launchAction}</span>
              </div>
            )
          },
          {
            key: "assignment-rules",
            title: "Assignment Rules",
            body: (
              <div className="shared-job-sidebar__kv">
                <span>Department lead owns department-level work.</span>
                <span>Specific people can be assigned when known.</span>
                <span>Manual assignment stays visible when no person is selected.</span>
              </div>
            )
          },
          {
            key: "canonical-first",
            title: "Canonical First",
            body: (
              <div className="shared-job-sidebar__kv">
                <span>Use Organization, Contact, and Location records when they exist.</span>
                <span>Draft text is only for unresolved client details.</span>
              </div>
            )
          }
        ]
      : []),
    {
      key: "live-summary",
      title: "Live summary",
      body: <div className="shared-job-sidebar__kv"><span>{formState.organization_id ? "Organization linked" : "Organization unresolved"}</span><span>{formState.days.filter((day) => day.date).length} job day(s)</span><span>{formState.production_required ? "Production required" : "No downstream production"}</span></div>
    },
    ...(!isGlobalJobIntake ? adapter.getSidebarCards({ state: formState, setState: updateState, errors: fieldErrors, currentUser, canViewFinance }) : []),
    ...visibleAdapterSections.filter((section) => section.slot === "sidebar.bottom").map((section) => ({ key: section.key, title: section.title, body: section.body }))
  ];

  const sharedSections = [
    {
      key: "core-identity",
      slot: "identity.after" as const,
      title: isGlobalJobIntake ? "Start Job Package" : "Core Identity",
      summary: isGlobalJobIntake
        ? "Choose the job type, client, name, owner, and priority. Mission Control will show the next handoff above."
        : "Shared identity fields render once here, with department-specific sections injected after them.",
      fields: ["department_type", "organization_id", "title", "event_name", "job_category", "description_internal"],
      body: (
        <div className="field-grid shared-job-form__grid">
          <label className="filter-field">
            <span>{isGlobalJobIntake ? "Starting team" : "Department"}</span>
            {departmentType ? (
              <div className="job-intake__static-field">{humanizeToken(formState.department_type)}</div>
            ) : (
              <select value={formState.department_type} onChange={(event) => updateState((current) => ({ ...current, department_type: event.target.value as "schools" | "sports" }))}>
                <option value="schools">Schools</option>
                <option value="sports">Sports</option>
              </select>
            )}
          </label>
          <label className="filter-field">
            <span>{isGlobalJobIntake ? "Job type" : "Job category"}</span>
            <select
              value={isGlobalJobIntake ? selectedIntakeType ?? inferJobIntakeTypeId(formState) : formState.job_category}
              onChange={(event) =>
                isGlobalJobIntake
                  ? applyIntakeType(event.target.value as JobIntakeTypeId)
                  : updateState((current) => ({ ...current, job_category: event.target.value as SharedJobFormState["job_category"] }))
              }
            >
              {isGlobalJobIntake
                ? JOB_INTAKE_TYPE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)
                : getSharedJobCategoryOptions().map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <div className="filter-field filter-field--wide">
            <SharedOrganizationPicker
              departmentType={formState.department_type === "schools" ? "schools" : "sports"}
              searchValue={organizationSearch}
              onSearchChange={setOrganizationSearch}
              unresolvedValue=""
              onUnresolvedChange={() => {}}
              loading={false}
              results={organizationResults}
              selectedOrganization={selectedOrganization}
              onSelectOrganization={(organization) => {
                setSelectedOrganization(organization);
                updateState((current) => ({
                  ...current,
                  organization_id: organization.id
                }));
              }}
              required
              errors={fieldErrors.organization_id}
              helperText={isGlobalJobIntake ? "Pick the client record this job belongs to." : "Schools and Sports both resolve through the same shared organization record."}
            />
          </div>
          <label className="filter-field filter-field--wide">
            <span>{isGlobalJobIntake ? "Job name" : adapter.labels.titleLabel}</span>
            <input value={formState.title} onChange={(event) => updateState((current) => ({ ...current, title: event.target.value }))} />
            {fieldErrors.title ? <div className="shared-job-form__field-errors" role="alert">{fieldErrors.title.map((message) => <div key={message}>{message}</div>)}</div> : null}
          </label>
          <label className="filter-field filter-field--wide">
            <span>{adapter.labels.eventNameLabel}</span>
            <input value={formState.event_name} onChange={(event) => updateState((current) => ({ ...current, event_name: event.target.value }))} />
          </label>
          {!isGlobalJobIntake ? (
            <label className="filter-field filter-field--wide">
              <span>Internal description</span>
              <textarea rows={3} value={formState.description_internal} onChange={(event) => updateState((current) => ({ ...current, description_internal: event.target.value }))} />
            </label>
          ) : null}
        </div>
      )
    },
    ...(isGlobalJobIntake
      ? [
          {
            key: "intake-review",
            slot: "identity.after" as const,
            title: "Review Before Launch",
            summary: "The intake creates a draft package first. Reviewers can approve intake details before workflow launch.",
            fields: ["intake_review"],
            body: (
              <div className="shared-job-form__stack">
                <JobIntakeReadinessPanel summary={intakeManagementSummary} />
                <JobDepartmentTaskPlan preview={routingPreview} compact />
              </div>
            )
          }
        ]
      : []),
    {
      key: "schedule-location",
      slot: "schedule.after" as const,
      title: isGlobalJobIntake ? "Shoot Date and Location" : "Schedule and Location",
      summary: isGlobalJobIntake
        ? "Capture the first known shoot date and where the team should go. Details can be refined later."
        : "Shared summary schedule, timezone, location, and day manager entry point.",
      fields: ["scheduled_start_at", "scheduled_end_at", "timezone", "primary_location_id"],
      body: (
        <div className="shared-job-form__stack">
          <div className="shared-job-calendar-readiness" aria-label="Calendar readiness">
            <div>
              <span className="eyebrow">Calendar Readiness</span>
              <strong>{calendarReadiness.label}</strong>
              <p>{calendarReadiness.summary}</p>
            </div>
            <StatusPill label={calendarReadiness.label} tone={calendarReadiness.tone} />
            <div className="shared-job-detail__kv">
              <span>Schedule: {calendarReadiness.scheduleLabel}</span>
              <span>Owner: {calendarReadiness.ownerLabel}</span>
              <span>Staffing: {calendarReadiness.staffingLabel}</span>
              <span>Next: {calendarReadiness.nextAction}</span>
            </div>
          </div>
          <div className="field-grid shared-job-form__grid">
            <label className="filter-field"><span>Start date</span><input type="date" value={formState.scheduled_start_date} onChange={(event) => updateState((current) => ({ ...current, scheduled_start_date: event.target.value }))} /></label>
            <label className="filter-field"><span>Start time</span><input type="time" value={formState.scheduled_start_time} onChange={(event) => updateState((current) => ({ ...current, scheduled_start_time: event.target.value }))} /></label>
            {isGlobalJobIntake ? (
              <>
                <label className="filter-field"><span>Alternate date</span><input type="date" value={formState.scheduled_end_date} onChange={(event) => updateState((current) => ({ ...current, scheduled_end_date: event.target.value }))} /></label>
                <label className="filter-field"><span>Expected end time</span><input type="time" value={formState.scheduled_end_time} onChange={(event) => updateState((current) => ({ ...current, scheduled_end_time: event.target.value }))} /></label>
              </>
            ) : null}
            {!isGlobalJobIntake ? (
              <>
                <label className="filter-field"><span>End date</span><input type="date" value={formState.scheduled_end_date} onChange={(event) => updateState((current) => ({ ...current, scheduled_end_date: event.target.value }))} /></label>
                <label className="filter-field"><span>End time</span><input type="time" value={formState.scheduled_end_time} onChange={(event) => updateState((current) => ({ ...current, scheduled_end_time: event.target.value }))} /></label>
                <label className="filter-field"><span>Timezone</span><input value={formState.timezone} onChange={(event) => updateState((current) => ({ ...current, timezone: event.target.value }))} /></label>
              </>
            ) : null}
            <SharedLocationPicker label="Primary location" searchValue={locationSearch} onSearchChange={setLocationSearch} unresolvedValue={formState.location_override_note} onUnresolvedChange={(value) => updateState((current) => ({ ...current, location_override_note: value }))} options={locationOptions} selectedLocationId={formState.primary_location_id} onSelectLocation={(value) => updateState((current) => ({ ...current, primary_location_id: value }))} errors={fieldErrors.primary_location_id} helperText="The shared job uses one primary location while job days can still vary." />
          </div>
        </div>
      )
    },
    {
      key: "contacts-ownership",
      slot: "contacts.after" as const,
      title: isGlobalJobIntake ? "Client, Contact, and Owner" : "Contacts and Ownership",
      summary: isGlobalJobIntake
        ? "Connect the client, primary contact, and first owner so the package has a clear starting point."
        : "Primary contact and owner fields stay shared even when the adapter changes labels and extra context.",
      fields: ["primary_contact_id", "account_owner_user_id"],
      body: (
        <div className="shared-job-form__stack">
          <SharedContactPicker label="Primary contact" searchValue={contactSearch} onSearchChange={setContactSearch} unresolvedValue={formState.contact_override_note} onUnresolvedChange={(value) => updateState((current) => ({ ...current, contact_override_note: value }))} options={contactOptions} selectedContactId={formState.primary_contact_id} onSelectContact={(value) => updateState((current) => ({ ...current, primary_contact_id: value }))} errors={fieldErrors.primary_contact_id} />
          <div className="field-grid shared-job-form__grid">
            <SharedStaffPicker label={isGlobalJobIntake ? "Current owner" : "Account owner"} value={formState.account_owner_user_id} onChange={(value) => updateState((current) => ({ ...current, account_owner_user_id: value }))} options={ownerOptions} required errors={fieldErrors.account_owner_user_id} />
            <label className="filter-field"><span>Priority</span><select value={formState.priority_level} onChange={(event) => updateState((current) => ({ ...current, priority_level: event.target.value as SharedJobFormState["priority_level"] }))}>{getSharedJobPriorityOptions().map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          </div>
        </div>
      )
    },
    {
      key: "shared-production",
      slot: "production.after" as const,
      title: isGlobalJobIntake ? "Volume and Deliverables" : "Shared Delivery and Production Basics",
      summary: isGlobalJobIntake
        ? "Record the rough size of the job, what the client needs, and the dates Production or Client Success should watch."
        : "Delivery, gallery, deadlines, and downstream production remain a shared operational language across departments.",
      fields: ["delivery_type", "gallery_type", "client_deadline_at", "production_deadline_at", "estimated_subject_count"],
      body: (
        <div className="field-grid shared-job-form__grid">
          <label className="filter-field"><span>Expected volume</span><input value={formState.estimated_subject_count} onChange={(event) => updateState((current) => ({ ...current, estimated_subject_count: event.target.value }))} inputMode="numeric" /></label>
          <label className="filter-field"><span>{isGlobalJobIntake ? "Products and services" : "Delivery type"}</span><select value={formState.delivery_type} onChange={(event) => updateState((current) => ({ ...current, delivery_type: event.target.value }))}>{getSharedDeliveryTypeOptions().map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="filter-field"><span>Gallery or output</span><select value={formState.gallery_type} onChange={(event) => updateState((current) => ({ ...current, gallery_type: event.target.value }))}>{getSharedGalleryTypeOptions().map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="filter-field"><span>Client deadline</span><input type="date" value={formState.client_deadline_at} onChange={(event) => updateState((current) => ({ ...current, client_deadline_at: event.target.value }))} /></label>
          <label className="filter-field"><span>Production deadline</span><input type="date" value={formState.production_deadline_at} onChange={(event) => updateState((current) => ({ ...current, production_deadline_at: event.target.value }))} /></label>
          <label className="shared-job-form__toggle"><input type="checkbox" checked={formState.production_required} onChange={(event) => updateState((current) => ({ ...current, production_required: event.target.checked }))} /><span>{isGlobalJobIntake ? "Production needed" : "Downstream production required"}</span></label>
          {!isGlobalJobIntake ? <label className="filter-field"><span>Estimated staff count</span><input value={formState.estimated_staff_count} onChange={(event) => updateState((current) => ({ ...current, estimated_staff_count: event.target.value }))} /></label> : null}
        </div>
      )
    },
    ...(isGlobalJobIntake
      ? [
          {
            key: "operational-requirements",
            slot: "production.after" as const,
            title: "Operational Requirements",
            summary: "Capture setup, roster/data, equipment, and approval assumptions that determine the first handoff.",
            fields: ["estimated_staff_count", "school_profile.roster_source", "school_profile.yearbook_required", "sports_profile.estimated_team_count"],
            body: (
              <div className="field-grid shared-job-form__grid">
                <label className="filter-field"><span>Photographers estimated</span><input value={formState.estimated_staff_count} onChange={(event) => updateState((current) => ({ ...current, estimated_staff_count: event.target.value }))} inputMode="numeric" /></label>
                <label className="filter-field"><span>Roster or team list source</span><input value={formState.department_type === "schools" ? formState.school_profile.roster_source : formState.sports_profile.league_name} onChange={(event) => updateState((current) => current.department_type === "schools" ? { ...current, school_profile: { ...current.school_profile, roster_source: event.target.value } } : { ...current, sports_profile: { ...current.sports_profile, league_name: event.target.value } })} /></label>
                <label className="filter-field"><span>Teams, classes, or groups</span><input value={formState.department_type === "sports" ? formState.sports_profile.estimated_team_count : formState.school_profile.grade_scope} onChange={(event) => updateState((current) => current.department_type === "sports" ? { ...current, sports_profile: { ...current.sports_profile, estimated_team_count: event.target.value } } : { ...current, school_profile: { ...current.school_profile, grade_scope: event.target.value } })} /></label>
                <label className="shared-job-form__toggle"><input type="checkbox" checked={formState.school_profile.yearbook_required} onChange={(event) => updateState((current) => ({ ...current, school_profile: { ...current.school_profile, yearbook_required: event.target.checked } }))} /><span>Yearbook export needed</span></label>
                <label className="shared-job-form__toggle"><input type="checkbox" checked={formState.school_profile.id_cards_required} onChange={(event) => updateState((current) => ({ ...current, school_profile: { ...current.school_profile, id_cards_required: event.target.checked } }))} /><span>ID cards needed</span></label>
                <label className="shared-job-form__toggle"><input type="checkbox" checked={formState.sports_profile.proof_required} onChange={(event) => updateState((current) => ({ ...current, sports_profile: { ...current.sports_profile, proof_required: event.target.checked } }))} /><span>Proof approval needed</span></label>
                <label className="filter-field filter-field--wide"><span>Setup and equipment notes</span><textarea rows={3} value={formState.department_type === "schools" ? formState.school_profile.special_instructions : formState.sports_profile.client_expectations_notes} onChange={(event) => updateState((current) => current.department_type === "schools" ? { ...current, school_profile: { ...current.school_profile, special_instructions: event.target.value } } : { ...current, sports_profile: { ...current.sports_profile, client_expectations_notes: event.target.value } })} /></label>
              </div>
            )
          }
        ]
      : []),
    {
      key: "shared-notes",
      slot: "notes.after" as const,
      title: isGlobalJobIntake ? "Important Notes" : "Shared Operational Notes",
      summary: isGlobalJobIntake
        ? "Add the details the next owner needs before planning, shooting, producing, or delivering the job."
        : "Shared notes stay centralized even when adapters layer in their own operational context.",
      fields: ["description_internal"],
      body: (
        <label className="filter-field filter-field--wide">
          <span>{isGlobalJobIntake ? "Important notes" : "Internal notes"}</span>
          <textarea rows={4} value={formState.description_internal} onChange={(event) => updateState((current) => ({ ...current, description_internal: event.target.value }))} />
        </label>
      )
    },
    {
      key: "job-days",
      slot: "notes.after" as const,
      title: "Day-Level Management",
      summary: "Manage one or more execution days through the shared day manager.",
      fields: ["days"],
      body: <JobDayManager days={formState.days} onChange={(days) => updateState((current) => ({ ...current, days }))} ownerOptions={ownerOptions} errors={fieldErrors.days} />
    }
  ];

  const visibleSharedSections = isGlobalJobIntake ? sharedSections.filter((section) => section.key !== "job-days") : sharedSections;
  const sections = groupSections(visibleSharedSections, visibleAdapterSections, validationIssues);
  const headerMeta: WorkspaceHeaderMeta[] = detail
    ? [
        { label: detail.job.job_number ?? "Draft", tone: "info" },
        { label: humanizeToken(detail.job.job_status), tone: mapHeaderTone(detail.job.job_status) }
      ]
    : [{ label: humanizeToken(formState.department_type), tone: "info" }];

  return (
    <SharedJobFormShell
      eyebrow={isGlobalJobIntake ? "Job Intake" : adapter.labels.departmentBadge}
      title={isGlobalJobIntake ? "New Job Intake" : mode === "edit" ? adapter.editTitle : adapter.createTitle}
      summary={
        isGlobalJobIntake
          ? "Start a clean job package, set the first owner, and show where the work goes next."
          : "One shared create and edit shell, with department sections injected through the adapter registry instead of forked pages."
      }
      meta={headerMeta}
      actions={
        <WorkspaceActionBar align="end">
          {detail?.job.published_at ? <StatusPill label={humanizeToken(detail.job.job_status)} tone={statusTone(detail.job.job_status)} /> : null}
          <button type="button" className="secondary-button" onClick={() => navigateToSharedJobHash(routeBase)}>
            Back
          </button>
        </WorkspaceActionBar>
      }
      formIntro={isGlobalJobIntake ? <JobRoutingOutcome preview={routingPreview} /> : null}
      sections={sections}
      sidebarCards={sidebarCards}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={() => navigateToSharedJobHash(routeBase)}>
            Cancel
          </button>
          {!readOnly && isGlobalJobIntake ? (
            <>
              <button type="button" className="secondary-button" onClick={() => void persist("draft")} disabled={saving || publishing}>
                Save Draft
              </button>
              <button type="button" onClick={() => void persist("draft")} disabled={saving || publishing}>
                Start Job Package
              </button>
            </>
          ) : null}
          {!readOnly && !isGlobalJobIntake ? (
            <button type="button" className="secondary-button" onClick={() => void persist("draft")} disabled={saving || publishing}>
              Save Draft
            </button>
          ) : null}
          {!readOnly && !isGlobalJobIntake && canPublishJob ? (
            <button type="button" onClick={() => void persist("publish")} disabled={saving || publishing}>
              {detail?.job.published_at ? "Update" : "Publish"}
            </button>
          ) : null}
          {readOnly ? <span className="shared-job-sidebar__muted">Read-only access</span> : null}
          {error ? <span className="shared-job-form__error" role="alert">{error}</span> : null}
        </>
      }
    />
  );
}
