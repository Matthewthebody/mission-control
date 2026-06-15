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
  applyJobIntakeType,
  buildRoutingPreviewFromForm,
  getJobIntakeTypeOption,
  inferJobIntakeTypeId,
  type JobIntakeTypeId
} from "../components/jobs/JobRoutingFoundation";
import { SharedContactPicker, SharedLocationPicker, SharedOrganizationPicker, SharedStaffPicker } from "../components/jobs/SharedJobPickers";
import { LocationHistorySurface } from "../components/location/LocationHistorySurface";
import { buildSharedJobHash, navigateToSharedJobHash, parseSharedJobIdFromPath } from "../components/jobs/sharedJobRouting";
import { StatusPill, humanizeToken, statusTone, useHashRouteSnapshot } from "../components/sports/SportsPrimitives";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import type { WorkspaceHeaderMeta, WorkspaceHeaderMetaTone } from "../components/workspace/WorkspacePageHeader";
import type { SharedJobDetailResponse, SharedWorkflowTransitionValidation } from "../jobTruthTypes";
import { buildJobCalendarReadiness } from "../jobCalendarReadiness";
import { canManageSharedJobsShell } from "../permissions";
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

const JOB_CREATE_RESTRICTED_MESSAGE =
  "You do not have permission to create new jobs. Ask a department director or Mission Control admin to start a job package.";

const SCHOOL_HIERARCHY_INTAKE_TYPES: JobIntakeTypeId[] = ["school_picture_day", "retake_day", "yearbook", "cap_and_gown"];
type IntakeWorkAreaId = "school_pictures" | "sports_pictures" | "event_pictures" | "studio_work" | "other";
type IntakeShootTypeId =
  | "open_house_day"
  | "picture_day"
  | "retake_day"
  | "yearbook"
  | "cap_and_gown"
  | "sports_picture_day"
  | "media_day"
  | "team_individual"
  | "tournament_event"
  | "other_sports"
  | "graduation"
  | "commencement"
  | "ceremony"
  | "school_event"
  | "other_event"
  | "studio_portraits"
  | "staff_headshots"
  | "product_specialty"
  | "other_studio"
  | "other";

type IntakeShootTypeOption = {
  id: IntakeShootTypeId;
  label: string;
  internalType: JobIntakeTypeId;
  workflowLabel?: string;
};

const INTAKE_WORK_AREA_OPTIONS: Array<{ id: IntakeWorkAreaId; label: string }> = [
  { id: "school_pictures", label: "School Pictures" },
  { id: "sports_pictures", label: "Sports Pictures" },
  { id: "event_pictures", label: "Event Pictures" },
  { id: "studio_work", label: "In-Studio Work" },
  { id: "other", label: "Other" }
];

const INTAKE_SHOOT_TYPE_OPTIONS: Record<IntakeWorkAreaId, IntakeShootTypeOption[]> = {
  school_pictures: [
    { id: "open_house_day", label: "Open House Day", internalType: "school_picture_day", workflowLabel: "Open House Day" },
    { id: "picture_day", label: "Picture Day", internalType: "school_picture_day", workflowLabel: "School Picture Day" },
    { id: "retake_day", label: "Retake Day", internalType: "retake_day" },
    { id: "yearbook", label: "Yearbook", internalType: "yearbook" },
    { id: "cap_and_gown", label: "Cap & Gown", internalType: "cap_and_gown" }
  ],
  sports_pictures: [
    { id: "sports_picture_day", label: "Sports Picture Day", internalType: "sports_picture_day" },
    { id: "media_day", label: "Media Day", internalType: "sports_picture_day", workflowLabel: "Sports Picture Day" },
    { id: "team_individual", label: "Team & Individual Photos", internalType: "team_photos", workflowLabel: "Team Photos" },
    { id: "tournament_event", label: "Tournament / Event Coverage", internalType: "sports_league", workflowLabel: "Sports League" },
    { id: "other_sports", label: "Other Sports Work", internalType: "sports_picture_day", workflowLabel: "Sports Picture Day" }
  ],
  event_pictures: [
    { id: "graduation", label: "Graduation", internalType: "graduation" },
    { id: "commencement", label: "Commencement", internalType: "graduation", workflowLabel: "Graduation" },
    { id: "ceremony", label: "Ceremony", internalType: "event", workflowLabel: "Event" },
    { id: "school_event", label: "School Event", internalType: "event", workflowLabel: "Event" },
    { id: "other_event", label: "Other Event", internalType: "event", workflowLabel: "Event" }
  ],
  studio_work: [
    { id: "studio_portraits", label: "Studio Portraits", internalType: "specialty", workflowLabel: "In-Studio Work" },
    { id: "staff_headshots", label: "Staff / Headshots", internalType: "specialty", workflowLabel: "In-Studio Work" },
    { id: "product_specialty", label: "Product / Specialty", internalType: "specialty", workflowLabel: "In-Studio Work" },
    { id: "other_studio", label: "Other In-Studio Work", internalType: "specialty", workflowLabel: "In-Studio Work" }
  ],
  other: [{ id: "other", label: "Other", internalType: "other" }]
};

function defaultShootTypeForWorkArea(workArea: IntakeWorkAreaId) {
  return INTAKE_SHOOT_TYPE_OPTIONS[workArea][0];
}

function getShootTypeOption(workArea: IntakeWorkAreaId, shootTypeId: IntakeShootTypeId) {
  return INTAKE_SHOOT_TYPE_OPTIONS[workArea].find((option) => option.id === shootTypeId) ?? defaultShootTypeForWorkArea(workArea);
}

function workAreaForIntakeType(typeId: JobIntakeTypeId): IntakeWorkAreaId {
  if (["sports_picture_day", "sports_league", "team_photos"].includes(typeId)) {
    return "sports_pictures";
  }
  if (["graduation", "event"].includes(typeId)) {
    return "event_pictures";
  }
  if (typeId === "specialty") {
    return "studio_work";
  }
  if (typeId === "other") {
    return "other";
  }
  return "school_pictures";
}

function shootTypeForIntakeType(typeId: JobIntakeTypeId): IntakeShootTypeId {
  if (typeId === "school_picture_day") return "picture_day";
  if (typeId === "retake_day") return "retake_day";
  if (typeId === "yearbook") return "yearbook";
  if (typeId === "cap_and_gown") return "cap_and_gown";
  if (typeId === "sports_picture_day") return "sports_picture_day";
  if (typeId === "sports_league") return "tournament_event";
  if (typeId === "team_photos") return "team_individual";
  if (typeId === "graduation") return "graduation";
  if (typeId === "event") return "school_event";
  if (typeId === "specialty") return "studio_portraits";
  return "other";
}

function formatSuggestedDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "";
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isSchoolDistrictOrganization(organization: OrganizationSummary) {
  return organization.account_type === "schools_underclass_portraits" || organization.account_type === "schools_events";
}

function workflowReviewDirectorFor(typeId: JobIntakeTypeId) {
  if (["school_picture_day", "retake_day", "yearbook", "cap_and_gown", "graduation"].includes(typeId)) {
    return "Schools Director";
  }
  if (["sports_picture_day", "sports_league", "team_photos"].includes(typeId)) {
    return "Sports Director";
  }
  const ownerDepartment = getJobIntakeTypeOption(typeId).firstOwnerDepartment;
  if (ownerDepartment === "Client Success") {
    return "Client Success Lead";
  }
  if (ownerDepartment === "Leadership") {
    return "Leadership";
  }
  return `${ownerDepartment} Director`;
}

function buildWorkflowReviewQuery(typeId: JobIntakeTypeId, workflowName: string) {
  return {
    notice: "workflow_review",
    workflowName,
    jobType: getJobIntakeTypeOption(typeId).label,
    director: workflowReviewDirectorFor(typeId)
  };
}

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
  const initialGlobalIntakeType: JobIntakeTypeId | null =
    departmentType == null && mode === "create" ? (params.get("department") === "sports" ? "sports_picture_day" : "school_picture_day") : null;
  const initialDepartment = departmentType ?? (initialGlobalIntakeType === "sports_picture_day" ? "sports" : "schools");
  const [formState, setFormState] = useState<SharedJobFormState>(() => {
    const initialForm = { ...createBlankSharedJobFormState(initialDepartment), ...getDepartmentJobAdapterUI(initialDepartment).getDefaultValues() };
    return initialGlobalIntakeType ? applyJobIntakeType(initialForm, initialGlobalIntakeType) : initialForm;
  });
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
  const [selectedIntakeType, setSelectedIntakeType] = useState<JobIntakeTypeId | null>(initialGlobalIntakeType);
  const [selectedWorkArea, setSelectedWorkArea] = useState<IntakeWorkAreaId>(() => workAreaForIntakeType(initialGlobalIntakeType ?? "school_picture_day"));
  const [selectedShootType, setSelectedShootType] = useState<IntakeShootTypeId>(() => shootTypeForIntakeType(initialGlobalIntakeType ?? "school_picture_day"));
  const [jobNameManuallyEdited, setJobNameManuallyEdited] = useState(false);
  const ignoreDirtyRef = useRef(false);
  const lastSuggestedJobNameRef = useRef("");

  const adapter = getDepartmentJobAdapterUI((formState.department_type === "schools" ? "schools" : "sports"));
  const isGlobalJobIntake = departmentType == null && mode === "create";
  const permissionContext = { departmentType: formState.department_type };
  const scopedPermissionContext = isGlobalJobIntake ? undefined : permissionContext;
  const canCreateJob = usePermission(currentUser, "job.create", scopedPermissionContext);
  const canCreateGlobalJob = isGlobalJobIntake ? canCreateJob || canManageSharedJobsShell(currentUser) : canCreateJob;
  const canUpdateJob = usePermission(currentUser, "job.update", scopedPermissionContext);
  const canPublishJob = usePermission(currentUser, "job.publish", scopedPermissionContext);
  const hasFinancePermission = usePermission(currentUser, "finance.view_summary", permissionContext);
  const canViewFinance = formState.department_type === "sports" && hasFinancePermission;
  const readOnly = mode === "create" ? !canCreateGlobalJob : !canUpdateJob;
  const fieldErrors: SharedJobFieldErrors = useMemo(() => buildFieldErrorMap(validationIssues), [validationIssues]);
  const selectedOwnerName = useMemo(
    () => ownerOptions.find((owner) => owner.user_id === formState.account_owner_user_id)?.full_name ?? null,
    [formState.account_owner_user_id, ownerOptions]
  );
  const routingPreview = useMemo(
    () => buildRoutingPreviewFromForm(formState, selectedOwnerName, isGlobalJobIntake ? selectedIntakeType ?? inferJobIntakeTypeId(formState) : undefined),
    [formState, isGlobalJobIntake, selectedIntakeType, selectedOwnerName]
  );
  const activeIntakeType = selectedIntakeType ?? inferJobIntakeTypeId(formState);
  const activeShootTypeOption = getShootTypeOption(selectedWorkArea, selectedShootType);
  const workflowPreviewLabel = activeShootTypeOption.workflowLabel ?? getJobIntakeTypeOption(activeIntakeType).label;
  const usesSchoolHierarchy = isGlobalJobIntake && SCHOOL_HIERARCHY_INTAKE_TYPES.includes(activeIntakeType);
  const usesSportsWorkArea = isGlobalJobIntake && selectedWorkArea === "sports_pictures";
  const organizationFieldLabel = usesSchoolHierarchy ? "District" : usesSportsWorkArea ? "Association / Organization" : "Organization";
  const locationFieldLabel = usesSchoolHierarchy ? "School" : "Location";
  const organizationHelperText = usesSchoolHierarchy
    ? "Search for the district account. If the job is district-level, choose the district and use the no-single-school option below."
    : usesSportsWorkArea
      ? "Search for the sports association, club, or organization already saved in Directory."
      : "Choose an existing organization for this job.";
  const locationHelperText = usesSchoolHierarchy
    ? "Choose a saved school for the selected district, or use district-level job if no single school applies."
    : usesSportsWorkArea
      ? "Search the shoot location or site. This is separate from the sports association."
      : "Search and select an existing location. Known locations for the selected organization appear first.";
  const selectedSavedDistrict = usesSchoolHierarchy && selectedOrganization && isSchoolDistrictOrganization(selectedOrganization) ? selectedOrganization : null;
  const locationContextOrganizationId = usesSchoolHierarchy ? selectedSavedDistrict?.id ?? "" : formState.organization_id;
  const shouldShowLocationSection = !isGlobalJobIntake || !usesSchoolHierarchy;
  const visibleContactOptions = isGlobalJobIntake && !contactSearch.trim() ? [] : contactOptions;
  const prioritizedLocationOptions = useMemo(
    () => {
      const scopedOptions =
        usesSchoolHierarchy && locationContextOrganizationId
          ? locationOptions.filter((location) => location.organization_id === locationContextOrganizationId)
          : locationOptions;
      return [...scopedOptions].sort((left, right) => {
        const leftMatches = left.organization_id === locationContextOrganizationId ? 0 : 1;
        const rightMatches = right.organization_id === locationContextOrganizationId ? 0 : 1;
        return leftMatches - rightMatches || left.location_name.localeCompare(right.location_name);
      });
    },
    [locationContextOrganizationId, locationOptions, usesSchoolHierarchy]
  );
  const schoolLocationHelperText =
    selectedSavedDistrict && prioritizedLocationOptions.length === 0
      ? "No saved schools found for this district. Choose district-level job or add the school to Directory first."
      : locationHelperText;
  const selectedLocation = prioritizedLocationOptions.find((location) => location.id === formState.primary_location_id) ?? null;
  const suggestedJobName = useMemo(() => {
    if (!isGlobalJobIntake) return "";
    const dateLabel = formatSuggestedDate(formState.scheduled_start_date);
    const districtLevel = usesSchoolHierarchy && formState.location_override_note === "District-level job / no single school";
    const subject = usesSchoolHierarchy
      ? selectedLocation?.location_name ?? selectedOrganization?.display_name
      : selectedOrganization?.display_name;
    if (!subject) return "";
    const shootLabel = districtLevel ? `District-level ${activeShootTypeOption.label}` : activeShootTypeOption.label;
    return [subject, shootLabel, dateLabel].filter(Boolean).join(" - ");
  }, [activeShootTypeOption.label, formState.location_override_note, formState.scheduled_start_date, isGlobalJobIntake, selectedLocation?.location_name, selectedOrganization?.display_name, usesSchoolHierarchy]);
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
    if (!isGlobalJobIntake || jobNameManuallyEdited || !suggestedJobName || suggestedJobName === lastSuggestedJobNameRef.current) {
      return;
    }
    lastSuggestedJobNameRef.current = suggestedJobName;
    updateState((current) => {
      if (current.title && current.title !== lastSuggestedJobNameRef.current && current.title !== current.event_name) {
        return current;
      }
      return {
        ...current,
        title: suggestedJobName,
        event_name: suggestedJobName
      };
    });
  }, [isGlobalJobIntake, jobNameManuallyEdited, suggestedJobName]);

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

  function applyIntakeType(value: JobIntakeTypeId, options: { clearLocation?: boolean } = {}) {
    setSelectedIntakeType(value);
    updateState((current) => {
      const next = applyJobIntakeType(current, value);
      if (next.department_type !== current.department_type) {
        setSelectedOrganization(null);
        setOrganizationSearch("");
        setLocationSearch("");
        return {
          ...next,
          organization_id: "",
          primary_location_id: "",
          location_override_note: "",
          primary_contact_id: "",
          contact_override_note: ""
        };
      }
      if (options.clearLocation) {
        setLocationSearch("");
        return {
          ...next,
          primary_location_id: "",
          location_override_note: ""
        };
      }
      return next;
    });
  }

  function applyWorkArea(value: IntakeWorkAreaId) {
    const nextShootType = defaultShootTypeForWorkArea(value);
    const wasSchoolHierarchy = usesSchoolHierarchy;
    const willUseSchoolHierarchy = SCHOOL_HIERARCHY_INTAKE_TYPES.includes(nextShootType.internalType);
    setSelectedWorkArea(value);
    setSelectedShootType(nextShootType.id);
    applyIntakeType(nextShootType.internalType, { clearLocation: wasSchoolHierarchy !== willUseSchoolHierarchy });
  }

  function applyShootType(value: IntakeShootTypeId) {
    const option = getShootTypeOption(selectedWorkArea, value);
    const wasSchoolHierarchy = usesSchoolHierarchy;
    const willUseSchoolHierarchy = SCHOOL_HIERARCHY_INTAKE_TYPES.includes(option.internalType);
    setSelectedShootType(option.id);
    applyIntakeType(option.internalType, { clearLocation: wasSchoolHierarchy !== willUseSchoolHierarchy });
  }

  function updateOrganizationSearch(value: string) {
    setOrganizationSearch(value);
    if (!selectedOrganization) {
      return;
    }
    const selectedLabels = [selectedOrganization.display_name, selectedOrganization.canonical_name, ...selectedOrganization.aliases].map((label) =>
      label.trim().toLowerCase()
    );
    if (!selectedLabels.includes(value.trim().toLowerCase())) {
      setSelectedOrganization(null);
      updateState((current) => ({
        ...current,
        organization_id: "",
        primary_location_id: "",
        location_override_note: "",
        primary_contact_id: "",
        contact_override_note: ""
      }));
      setLocationSearch("");
      setContactSearch("");
    }
  }

  function updateLocationSearch(value: string) {
    setLocationSearch(value);
    const selectedLocation = locationOptions.find((option) => option.id === formState.primary_location_id) ?? null;
    const selectedName = selectedLocation?.location_name.trim().toLowerCase();
    updateState((current) => {
      if (selectedName && selectedName === value.trim().toLowerCase()) {
        return current;
      }
      return {
        ...current,
        primary_location_id: "",
        location_override_note: usesSchoolHierarchy ? "" : value.trim()
      };
    });
  }

  function selectContact(value: string) {
    const contact = contactOptions.find((option) => option.id === value) ?? null;
    if (contact) {
      setContactSearch(contact.full_name);
    }
    updateState((current) => ({
      ...current,
      primary_contact_id: value,
      contact_override_note: contact ? "" : current.contact_override_note
    }));
  }

  function selectLocation(value: string) {
    const locationPool = usesSchoolHierarchy ? prioritizedLocationOptions : locationOptions;
    const location = locationPool.find((option) => option.id === value) ?? null;
    if (usesSchoolHierarchy && !location) {
      return;
    }
    if (location) {
      setLocationSearch(location.location_name);
    }
    updateState((current) => ({
      ...current,
      primary_location_id: value,
      location_override_note: location ? "" : current.location_override_note
    }));
  }

  function markDistrictLevelJob() {
    setLocationSearch("District-level job / no single school");
    updateState((current) => ({
      ...current,
      primary_location_id: "",
      location_override_note: "District-level job / no single school"
    }));
  }

  async function persist(target: "draft" | "publish") {
    if ((target === "draft" && readOnly) || (target === "publish" && (!canPublishJob || readOnly))) {
      setError(target === "publish" ? "You do not have permission to publish this job." : isGlobalJobIntake ? JOB_CREATE_RESTRICTED_MESSAGE : "You do not have permission to edit this job.");
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
        navigateToSharedJobHash(routeBase, response.job.id, isGlobalJobIntake && mode === "create" ? buildWorkflowReviewQuery(activeIntakeType, routingPreview.workflowRouteLabel) : {});
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

  if (isGlobalJobIntake && !canCreateGlobalJob) {
    return (
      <div className="shared-job-shell shared-job-shell--form shared-job-shell--clean-intake">
        <div className="shared-job-shell__form-layout shared-job-shell__form-layout--single">
          <div className="shared-job-shell__form-main">
            <section className="panel shared-job-shell__section">
              <div className="shared-job-shell__section-body">
                <section className="feedback-strip feedback-strip--warning" role="alert">
                  <div className="feedback-strip__content">
                    <strong>Restricted Access</strong>
                    <span>{JOB_CREATE_RESTRICTED_MESSAGE}</span>
                  </div>
                </section>
              </div>
            </section>
          </div>
        </div>
      </div>
    );
  }

  const adapterSections = adapter.getSectionDefinitions({ state: formState, setState: updateState, errors: fieldErrors, currentUser, canViewFinance });
  const visibleAdapterSections = isGlobalJobIntake ? [] : adapterSections;
  const sidebarCards = isGlobalJobIntake ? [] : [
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
      title: isGlobalJobIntake ? "Job Basics" : "Core Identity",
      summary: isGlobalJobIntake
        ? "Choose the work area, shoot type, account, school or location, and job name."
        : "Shared identity fields render once here, with department-specific sections injected after them.",
      fields: ["department_type", "organization_id", "title", "event_name", "job_category", "description_internal"],
      body: (
        <div className="shared-job-form__stack">
          <div className="field-grid shared-job-form__grid">
            {!isGlobalJobIntake ? (
              <label className="filter-field">
                <span>Department</span>
                {departmentType ? (
                  <div className="job-intake__static-field">{humanizeToken(formState.department_type)}</div>
                ) : (
                  <select value={formState.department_type} onChange={(event) => updateState((current) => ({ ...current, department_type: event.target.value as "schools" | "sports" }))}>
                    <option value="schools">Schools</option>
                    <option value="sports">Sports</option>
                  </select>
                )}
              </label>
            ) : null}
            {isGlobalJobIntake ? (
              <>
                <label className="filter-field">
                  <span>Work Area</span>
                  <select value={selectedWorkArea} onChange={(event) => applyWorkArea(event.target.value as IntakeWorkAreaId)}>
                    {INTAKE_WORK_AREA_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
                <label className="filter-field">
                  <span>Shoot Type</span>
                  <select value={selectedShootType} onChange={(event) => applyShootType(event.target.value as IntakeShootTypeId)}>
                    {INTAKE_SHOOT_TYPE_OPTIONS[selectedWorkArea].map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
              </>
            ) : (
              <label className="filter-field">
                <span>Job category</span>
                <select value={formState.job_category} onChange={(event) => updateState((current) => ({ ...current, job_category: event.target.value as SharedJobFormState["job_category"] }))}>
                  {getSharedJobCategoryOptions().map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            )}
            <div className="filter-field filter-field--wide">
              <SharedOrganizationPicker
                departmentType={formState.department_type === "schools" ? "schools" : "sports"}
                label={isGlobalJobIntake ? organizationFieldLabel : "Organization"}
                placeholder={isGlobalJobIntake ? (usesSchoolHierarchy ? "Search districts" : usesSportsWorkArea ? "Search associations or clubs" : "Search organizations") : undefined}
                searchValue={organizationSearch}
                onSearchChange={isGlobalJobIntake ? updateOrganizationSearch : setOrganizationSearch}
                unresolvedValue=""
                onUnresolvedChange={() => {}}
                loading={false}
                results={organizationResults}
                selectedOrganization={selectedOrganization}
                onSelectOrganization={(organization) => {
                  setSelectedOrganization(organization);
                  setOrganizationSearch(organization.display_name);
                  setLocationSearch("");
                  setContactSearch("");
                  updateState((current) => ({
                    ...current,
                    organization_id: organization.id,
                    primary_location_id: "",
                    location_override_note: "",
                    primary_contact_id: "",
                    contact_override_note: "",
                    school_profile: usesSchoolHierarchy ? { ...current.school_profile, district_id: organization.id } : current.school_profile
                  }));
                }}
                required
                errors={fieldErrors.organization_id}
                helperText={isGlobalJobIntake ? organizationHelperText : "Schools and Sports both resolve through the same shared organization record."}
                noMatchText={
                  isGlobalJobIntake
                    ? usesSchoolHierarchy
                      ? "No matching district found. Choose a saved district, or ask a director/admin to add this to Directory."
                      : usesSportsWorkArea
                        ? "No matching association found. Choose a saved organization, or ask a director/admin to add this to Directory."
                        : "No matching organization found. Choose a saved record, or ask a director/admin to add this to Directory."
                    : undefined
                }
                collapseResults={isGlobalJobIntake}
                showUnresolvedField={!isGlobalJobIntake}
                typeaheadOnly={isGlobalJobIntake}
              />
              {usesSchoolHierarchy && !selectedSavedDistrict ? <div className="job-intake__helper">Select a saved district to see its schools.</div> : null}
            </div>
            {usesSchoolHierarchy && selectedSavedDistrict ? (
              <SharedLocationPicker
                label="School"
                placeholder="Search schools or sites"
                searchValue={locationSearch}
                onSearchChange={updateLocationSearch}
                unresolvedValue={formState.location_override_note}
                onUnresolvedChange={(value) => updateState((current) => ({ ...current, location_override_note: value }))}
                options={prioritizedLocationOptions}
                selectedLocationId={formState.primary_location_id}
                onSelectLocation={selectLocation}
                errors={fieldErrors.primary_location_id}
                helperText={schoolLocationHelperText}
                noMatchText="Choose a saved school, choose district-level job, or add the school to Directory first."
                showUnresolvedField={false}
                emptyOptionsText="No saved schools found for this district. Choose district-level job or add the school to Directory first."
                idleHelperText="Search saved schools for the selected district."
                requireSavedOption
                noSingleLocationLabel="District-level job / no single school"
                onNoSingleLocation={markDistrictLevelJob}
              />
            ) : null}
            {usesSchoolHierarchy && selectedLocation ? (
              <>
                <label className="filter-field filter-field--wide">
                  <span>Specific area (optional)</span>
                  <input
                    value={formState.school_profile.specific_area}
                    onChange={(event) =>
                      updateState((current) => ({
                        ...current,
                        school_profile: { ...current.school_profile, specific_area: event.target.value }
                      }))
                    }
                    placeholder="e.g. Gym, Auditorium, West entrance, Field 3"
                  />
                </label>
                <div className="job-intake__helper">Optional spot within the approved school. Location Intelligence still keys off the school itself.</div>
              </>
            ) : null}
            {usesSchoolHierarchy && selectedSavedDistrict ? (
              <LocationHistorySurface
                variant="preview"
                token={token}
                locationName={selectedLocation?.location_name ?? (locationSearch.trim() ? locationSearch.trim() : null)}
                locationAddress={selectedLocation?.address_display ?? null}
              />
            ) : null}
            <label className="filter-field filter-field--wide">
              <span>{isGlobalJobIntake ? "Job Name" : adapter.labels.titleLabel}</span>
              <input
                value={formState.title}
                onChange={(event) => {
                  if (isGlobalJobIntake) {
                    setJobNameManuallyEdited(true);
                  }
                  updateState((current) => ({
                    ...current,
                    title: event.target.value,
                    event_name: isGlobalJobIntake ? event.target.value : current.event_name
                  }));
                }}
              />
              {isGlobalJobIntake && suggestedJobName ? (
                <div className="job-intake__helper">
                  Suggested name: {suggestedJobName}
                  {formState.title !== suggestedJobName ? (
                    <button
                      type="button"
                      className="secondary-button job-intake__lookup-inline-action"
                      onClick={() => {
                        setJobNameManuallyEdited(false);
                        lastSuggestedJobNameRef.current = suggestedJobName;
                        updateState((current) => ({ ...current, title: suggestedJobName, event_name: suggestedJobName }));
                      }}
                    >
                      Use suggested name
                    </button>
                  ) : null}
                </div>
              ) : null}
              {fieldErrors.title ? <div className="shared-job-form__field-errors" role="alert">{fieldErrors.title.map((message) => <div key={message}>{message}</div>)}</div> : null}
            </label>
            {isGlobalJobIntake ? (
              <SharedContactPicker label="Primary contact" searchValue={contactSearch} onSearchChange={setContactSearch} unresolvedValue={formState.contact_override_note} onUnresolvedChange={(value) => updateState((current) => ({ ...current, contact_override_note: value }))} options={visibleContactOptions} selectedContactId={formState.primary_contact_id} onSelectContact={selectContact} errors={fieldErrors.primary_contact_id} helperText="Choose the main contact if they are already in the directory." />
            ) : null}
          </div>
          {!isGlobalJobIntake ? (
            <label className="filter-field filter-field--wide">
              <span>{adapter.labels.eventNameLabel}</span>
              <input value={formState.event_name} onChange={(event) => updateState((current) => ({ ...current, event_name: event.target.value }))} />
            </label>
          ) : null}
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
            key: "workflow-preparation",
            slot: "identity.after" as const,
            title: "Workflow",
            summary: "Mission Control automatically selects the workflow from Work Area and Shoot Type.",
            fields: ["workflow_preparation"],
            body: (
              <div className="shared-job-form__stack">
                <div className="job-intake-workflow-preview">
                  <strong>Workflow: {workflowPreviewLabel}</strong>
                  <p>Selected automatically from Work Area and Shoot Type.</p>
                  <p>A workflow review notice will be sent to the department director after the job package is created.</p>
                  <p>{routingPreview.workflowRouteHint}</p>
                  <div className="shared-job-detail__kv">
                    <span>Calendar readiness: {calendarReadiness.label}</span>
                    <span>Photography checklist</span>
                    <span>Production tasks</span>
                    <span>Client follow-up tasks</span>
                  </div>
                </div>
              </div>
            )
          }
        ]
      : []),
    {
      key: "schedule-location",
      slot: "schedule.after" as const,
      title: isGlobalJobIntake ? "Schedule" : "Schedule and Location",
      summary: isGlobalJobIntake
        ? "Capture the date and time details the team needs before planning the job."
        : "Shared summary schedule, timezone, location, and day manager entry point.",
      fields: ["scheduled_start_at", "scheduled_end_at", "timezone"],
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
            <label className="filter-field"><span>{isGlobalJobIntake ? "Date" : "Start date"}</span><input type="date" value={formState.scheduled_start_date} onChange={(event) => updateState((current) => ({ ...current, scheduled_start_date: event.target.value }))} /></label>
            {isGlobalJobIntake ? (
              <>
                <label className="filter-field"><span>Alternate date</span><input type="date" value={formState.scheduled_end_date} onChange={(event) => updateState((current) => ({ ...current, scheduled_end_date: event.target.value }))} /></label>
                <label className="filter-field"><span>Setup time</span><input type="time" value={formState.setup_time} onChange={(event) => updateState((current) => ({ ...current, setup_time: event.target.value }))} /></label>
                <label className="filter-field"><span>Photography start time</span><input type="time" value={formState.scheduled_start_time} onChange={(event) => updateState((current) => ({ ...current, scheduled_start_time: event.target.value }))} /></label>
                <label className="filter-field"><span>Expected end time</span><input type="time" value={formState.scheduled_end_time} onChange={(event) => updateState((current) => ({ ...current, scheduled_end_time: event.target.value }))} /></label>
                <label className="filter-field"><span>Photographers</span><input type="number" min="0" step="1" value={formState.estimated_staff_count} onChange={(event) => updateState((current) => ({ ...current, estimated_staff_count: event.target.value }))} inputMode="numeric" /></label>
                <label className="filter-field"><span>Photo assistants</span><input type="number" min="0" step="1" value={formState.assistant_staff_count} onChange={(event) => updateState((current) => ({ ...current, assistant_staff_count: event.target.value }))} inputMode="numeric" /></label>
                <label className="shared-job-form__toggle"><input type="checkbox" checked={formState.organization_assistance_provided} onChange={(event) => updateState((current) => ({ ...current, organization_assistance_provided: event.target.checked, organization_assistance_details: event.target.checked ? current.organization_assistance_details : "" }))} /><span>Organization-provided assistance?</span></label>
                {formState.organization_assistance_provided ? <label className="filter-field filter-field--wide"><span>What help will the organization provide?</span><textarea rows={2} value={formState.organization_assistance_details} onChange={(event) => updateState((current) => ({ ...current, organization_assistance_details: event.target.value }))} placeholder="Office staff, coaches, volunteers, line management, student runners, check-in table..." /></label> : null}
              </>
            ) : null}
            {!isGlobalJobIntake ? (
              <>
                <label className="filter-field"><span>Start time</span><input type="time" value={formState.scheduled_start_time} onChange={(event) => updateState((current) => ({ ...current, scheduled_start_time: event.target.value }))} /></label>
                <label className="filter-field"><span>End date</span><input type="date" value={formState.scheduled_end_date} onChange={(event) => updateState((current) => ({ ...current, scheduled_end_date: event.target.value }))} /></label>
                <label className="filter-field"><span>End time</span><input type="time" value={formState.scheduled_end_time} onChange={(event) => updateState((current) => ({ ...current, scheduled_end_time: event.target.value }))} /></label>
                <label className="filter-field"><span>Timezone</span><input value={formState.timezone} onChange={(event) => updateState((current) => ({ ...current, timezone: event.target.value }))} /></label>
              </>
            ) : null}
          </div>
        </div>
      )
    },
    {
      key: "location",
      slot: "schedule.after" as const,
      title: "Location & Shoot Details",
      summary: "Choose where the team should go, then add shoot details that affect setup.",
      fields: ["primary_location_id"],
      body: (
        <>
        <SharedLocationPicker
          label={isGlobalJobIntake ? locationFieldLabel : "Primary location"}
          placeholder={isGlobalJobIntake ? (usesSchoolHierarchy ? "Search schools or sites" : "Search locations or sites") : undefined}
          searchValue={locationSearch}
          onSearchChange={isGlobalJobIntake ? updateLocationSearch : setLocationSearch}
          unresolvedValue={formState.location_override_note}
          onUnresolvedChange={(value) => updateState((current) => ({ ...current, location_override_note: value }))}
          options={prioritizedLocationOptions}
          selectedLocationId={formState.primary_location_id}
          onSelectLocation={selectLocation}
          errors={fieldErrors.primary_location_id}
          helperText={isGlobalJobIntake ? locationHelperText : "Search and select an existing location. Known locations for the selected organization appear first."}
          noMatchText={
            usesSchoolHierarchy
              ? "This school or site does not match a saved record yet. Mission Control can still save the job, but Directory review may be needed."
              : "This location does not match a saved record yet. Mission Control can still save the job, but Directory review may be needed."
          }
          showUnresolvedField={!isGlobalJobIntake}
          unresolvedLabel={isGlobalJobIntake ? (usesSchoolHierarchy ? "School needs Directory review" : "Location needs Directory review") : undefined}
          unresolvedPlaceholder={isGlobalJobIntake ? (usesSchoolHierarchy ? "School/site name to review later" : "Location or site name to review later") : undefined}
          noSingleLocationLabel={usesSchoolHierarchy ? "District-level job / no single school" : undefined}
          onNoSingleLocation={usesSchoolHierarchy ? markDistrictLevelJob : undefined}
        />
        <LocationHistorySurface
          variant="preview"
          token={token}
          locationName={selectedLocation?.location_name ?? (locationSearch.trim() ? locationSearch.trim() : null)}
          locationAddress={selectedLocation?.address_display ?? null}
        />
        </>
      )
    },
    {
      key: "contacts-ownership",
      slot: "contacts.after" as const,
      title: isGlobalJobIntake ? "Organization and Contact" : "Contacts and Ownership",
      summary: isGlobalJobIntake
        ? "Connect the client, primary contact, and first owner so the job has a clear starting point."
        : "Primary contact and owner fields stay shared even when the adapter changes labels and extra context.",
      fields: ["primary_contact_id", "account_owner_user_id"],
      body: (
        <div className="shared-job-form__stack">
          <SharedContactPicker label="Primary contact" searchValue={contactSearch} onSearchChange={setContactSearch} unresolvedValue={formState.contact_override_note} onUnresolvedChange={(value) => updateState((current) => ({ ...current, contact_override_note: value }))} options={contactOptions} selectedContactId={formState.primary_contact_id} onSelectContact={selectContact} errors={fieldErrors.primary_contact_id} />
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
      title: isGlobalJobIntake ? "Job Needs" : "Shared Delivery and Production Basics",
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
            title: "Prep Details",
            summary: "Capture roster, team, setup, and sports-specific notes before the job moves into planning.",
            fields: ["school_profile.roster_source", "sports_profile.estimated_team_count"],
            body: (
              <div className="field-grid shared-job-form__grid">
                <label className="filter-field"><span>Roster or team list source</span><input value={formState.department_type === "schools" ? formState.school_profile.roster_source : formState.sports_profile.league_name} onChange={(event) => updateState((current) => current.department_type === "schools" ? { ...current, school_profile: { ...current.school_profile, roster_source: event.target.value } } : { ...current, sports_profile: { ...current.sports_profile, league_name: event.target.value } })} /></label>
                <label className="filter-field"><span>Teams, classes, or groups</span><input value={formState.department_type === "sports" ? formState.sports_profile.estimated_team_count : formState.school_profile.grade_scope} onChange={(event) => updateState((current) => current.department_type === "sports" ? { ...current, sports_profile: { ...current.sports_profile, estimated_team_count: event.target.value } } : { ...current, school_profile: { ...current.school_profile, grade_scope: event.target.value } })} /></label>
                {usesSportsWorkArea ? (
                  <>
                    <label className="filter-field"><span>Indoor / Outdoor</span><select value={formState.sports_setup.indoor_outdoor} onChange={(event) => updateState((current) => ({ ...current, sports_setup: { ...current.sports_setup, indoor_outdoor: event.target.value } }))}><option value="">Choose setting</option><option value="indoor">Indoor</option><option value="outdoor">Outdoor</option><option value="mixed">Mixed</option></select></label>
                    <label className="filter-field"><span>Tethered / Untethered</span><select value={formState.sports_setup.tethering} onChange={(event) => updateState((current) => ({ ...current, sports_setup: { ...current.sports_setup, tethering: event.target.value } }))}><option value="">Choose capture setup</option><option value="tethered">Tethered</option><option value="untethered">Untethered</option><option value="mixed">Mixed</option></select></label>
                    <label className="shared-job-form__toggle"><input type="checkbox" checked={formState.sports_setup.rain_location_required} onChange={(event) => updateState((current) => ({ ...current, sports_setup: { ...current.sports_setup, rain_location_required: event.target.checked } }))} /><span>Rain location?</span></label>
                    {formState.sports_setup.rain_location_required ? <label className="filter-field filter-field--wide"><span>Rain location details</span><input value={formState.sports_setup.rain_location_details} onChange={(event) => updateState((current) => ({ ...current, sports_setup: { ...current.sports_setup, rain_location_details: event.target.value } }))} /></label> : null}
                  </>
                ) : null}
                <label className="filter-field filter-field--wide"><span>Setup and equipment notes</span><textarea rows={3} value={formState.department_type === "schools" ? formState.school_profile.special_instructions : formState.sports_profile.client_expectations_notes} onChange={(event) => updateState((current) => current.department_type === "schools" ? { ...current, school_profile: { ...current.school_profile, special_instructions: event.target.value } } : { ...current, sports_profile: { ...current.sports_profile, client_expectations_notes: event.target.value } })} /></label>
                <div className="filter-field filter-field--wide">
                  <span>Prep files</span>
                  <div className="job-intake__helper">File attachments are not available here yet. For now, note any schedule, QR, or reference materials in the setup and equipment notes above so Photography and Production can find them on the job.</div>
                </div>
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

  const visibleSharedSections = isGlobalJobIntake
    ? sharedSections.filter((section) => !["contacts-ownership", "job-days"].includes(section.key) && (section.key !== "location" || shouldShowLocationSection))
    : sharedSections;
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
          ? "Start with the basics. Choose the work area and shoot type, then Mission Control will help identify missing info and next steps."
          : "One shared create and edit shell, with department sections injected through the adapter registry instead of forked pages."
      }
      meta={headerMeta}
      actions={
        isGlobalJobIntake ? null : <WorkspaceActionBar align="end">
          {detail?.job.published_at ? <StatusPill label={humanizeToken(detail.job.job_status)} tone={statusTone(detail.job.job_status)} /> : null}
          <button type="button" className="secondary-button" onClick={() => navigateToSharedJobHash(routeBase)}>
            Back
          </button>
        </WorkspaceActionBar>
      }
      sections={sections}
      sidebarCards={sidebarCards}
      footer={
        <>
          {!isGlobalJobIntake ? <button type="button" className="secondary-button" onClick={() => navigateToSharedJobHash(routeBase)}>
            Cancel
          </button> : null}
          {!readOnly && isGlobalJobIntake ? (
            <>
              <button type="button" className="secondary-button" onClick={() => void persist("draft")} disabled={saving || publishing}>
                Save Draft
              </button>
              <button type="button" onClick={() => void persist("draft")} disabled={saving || publishing}>
                Create Job Package
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
      hideHeader={isGlobalJobIntake}
      shellClassName={isGlobalJobIntake ? "shared-job-shell--clean-intake" : ""}
    />
  );
}
