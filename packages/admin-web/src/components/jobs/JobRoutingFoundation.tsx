import type { SharedJobDetailResponse } from "../../jobTruthTypes";
import type { ProjectWorkflowJobRow } from "../../projectTrackingTypes";
import { formatDate, humanizeToken } from "../sports/SportsPrimitives";
import type { SharedJobFormState } from "./DepartmentJobAdapterUIRegistry";

export type JobIntakeTypeId =
  | "school_picture_day"
  | "retake_day"
  | "sports_league"
  | "team_photos"
  | "graduation"
  | "event"
  | "specialty";

type RoutingStageKey =
  | "intake"
  | "planning"
  | "scheduling"
  | "shoot_ready"
  | "capture_complete"
  | "production"
  | "delivery"
  | "closed";

type OperationalPackagePhase = "Planning" | "Scheduling" | "Photography" | "Production" | "Delivery";
type OperationalPackageStatus =
  | "Assigned"
  | "Waiting Assignment"
  | "Waiting On Others"
  | "Ready For Next Department"
  | "Not Started"
  | "Blocked"
  | "Due Soon"
  | "Complete";
type OperationalNotificationTone = "info" | "warning" | "critical" | "success";

export type JobOperationalWorkPackage = {
  id: string;
  phase: OperationalPackagePhase;
  name: string;
  ownerDepartment: string;
  assignedPerson: string;
  dueDateLabel: string;
  status: OperationalPackageStatus;
};

export type JobOperationalNotification = {
  id: string;
  label: "Assignment Needed" | "Due Soon" | "Overdue" | "Blocked" | "Ready For Next Department";
  tone: OperationalNotificationTone;
  summary: string;
};

export type JobRoutingPreview = {
  jobTypeLabel: string;
  workflowRouteLabel: string;
  workflowRouteHint: string;
  currentDepartment: string;
  departmentLead: string;
  currentOwner: string;
  assignedPerson: string;
  assignmentState: "assigned" | "unassigned" | "waiting_assignment";
  assignmentLabel: "Assigned" | "Unassigned" | "Waiting Assignment";
  waitingOn: string;
  nextDepartment: string;
  dueDateLabel: string;
  blockerStatus: "clear" | "watch" | "blocked";
  blockerLabel: string;
  firstNextAction: string;
  currentStage: RoutingStageKey;
  workPackages: JobOperationalWorkPackage[];
  notifications: JobOperationalNotification[];
};

export const JOB_INTAKE_TYPE_OPTIONS: Array<{
  id: JobIntakeTypeId;
  label: string;
  department: SharedJobFormState["department_type"];
  category: SharedJobFormState["job_category"];
  routeLabel: string;
  firstOwnerDepartment: string;
  nextDepartment: string;
  defaultNextAction: string;
  defaults?: Partial<Pick<SharedJobFormState, "production_required" | "delivery_type" | "gallery_type">>;
  sportsDefaults?: Partial<SharedJobFormState["sports_profile"]>;
  schoolDefaults?: Partial<SharedJobFormState["school_profile"]>;
}> = [
  {
    id: "school_picture_day",
    label: "School Picture Day",
    department: "schools",
    category: "photo_day",
    routeLabel: "School Picture Day route",
    firstOwnerDepartment: "Schools",
    nextDepartment: "Photography",
    defaultNextAction: "Confirm organization, date, location, and roster status.",
    defaults: { production_required: true, delivery_type: "proofs_and_order", gallery_type: "individual" }
  },
  {
    id: "retake_day",
    label: "Retake Day",
    department: "schools",
    category: "makeup_day",
    routeLabel: "Retake Day route",
    firstOwnerDepartment: "Schools",
    nextDepartment: "Photography",
    defaultNextAction: "Confirm retake date, eligible students, and release expectations.",
    defaults: { production_required: true, delivery_type: "proofs_and_order", gallery_type: "individual" }
  },
  {
    id: "sports_league",
    label: "Sports League",
    department: "sports",
    category: "media_day",
    routeLabel: "Sports League route",
    firstOwnerDepartment: "Sports",
    nextDepartment: "Photography",
    defaultNextAction: "Confirm league, teams, shoot schedule, and proof owner.",
    defaults: { production_required: true, delivery_type: "mixed", gallery_type: "team_and_individual" },
    sportsDefaults: { proof_required: true, specialty_products_required: true, team_structure: "league_schedule" }
  },
  {
    id: "team_photos",
    label: "Team Photos",
    department: "sports",
    category: "media_day",
    routeLabel: "Team Photos route",
    firstOwnerDepartment: "Sports",
    nextDepartment: "Photography",
    defaultNextAction: "Confirm teams, coach contact, photo order, and proof requirements.",
    defaults: { production_required: true, delivery_type: "mixed", gallery_type: "team_and_individual" },
    sportsDefaults: { proof_required: true, team_structure: "scheduled_slots" }
  },
  {
    id: "graduation",
    label: "Graduation",
    department: "schools",
    category: "event",
    routeLabel: "Graduation route",
    firstOwnerDepartment: "Schools",
    nextDepartment: "Photography",
    defaultNextAction: "Confirm ceremony schedule, access notes, and delivery deadline.",
    defaults: { production_required: true, delivery_type: "digital_gallery", gallery_type: "individual" },
    schoolDefaults: { school_type: "graduation" }
  },
  {
    id: "event",
    label: "Event",
    department: "schools",
    category: "event",
    routeLabel: "Event route",
    firstOwnerDepartment: "Client Success",
    nextDepartment: "Photography",
    defaultNextAction: "Confirm event owner, date, location, expected volume, and services.",
    defaults: { production_required: true, delivery_type: "digital_gallery", gallery_type: "individual" }
  },
  {
    id: "specialty",
    label: "Specialty",
    department: "sports",
    category: "specialty",
    routeLabel: "Specialty route",
    firstOwnerDepartment: "Client Success",
    nextDepartment: "Production",
    defaultNextAction: "Confirm requested specialty products, due date, and approval owner.",
    defaults: { production_required: true, delivery_type: "specialty_only", gallery_type: "none" },
    sportsDefaults: { specialty_products_required: true, banner_work_required: true }
  }
];

export const JOB_ROUTING_STAGES: Array<{ key: RoutingStageKey; label: string }> = [
  { key: "intake", label: "Intake" },
  { key: "planning", label: "Planning" },
  { key: "scheduling", label: "Scheduling" },
  { key: "shoot_ready", label: "Shoot Ready" },
  { key: "capture_complete", label: "Capture Complete" },
  { key: "production", label: "Production" },
  { key: "delivery", label: "Delivery" },
  { key: "closed", label: "Closed" }
];

const DEPARTMENT_LEADS: Record<string, string> = {
  Intake: "Paige",
  Schools: "Jessica",
  Sports: "Josh",
  Photography: "Carisa",
  Production: "Spencer",
  Delivery: "Paige",
  "Client Success": "Paige",
  Leadership: "Brandon",
  Operations: "Myra",
  Closed: "Complete"
};

const WORK_PACKAGE_TEMPLATES: Record<JobIntakeTypeId, Array<Omit<JobOperationalWorkPackage, "id" | "assignedPerson" | "dueDateLabel" | "status">>> = {
  school_picture_day: [
    { phase: "Planning", name: "Roster Collection", ownerDepartment: "Schools" },
    { phase: "Scheduling", name: "Photographer Assignment", ownerDepartment: "Photography" },
    { phase: "Photography", name: "Picture Day Capture", ownerDepartment: "Photography" },
    { phase: "Production", name: "Image QA", ownerDepartment: "Production" },
    { phase: "Delivery", name: "Gallery Release", ownerDepartment: "Client Success" }
  ],
  retake_day: [
    { phase: "Planning", name: "Retake List Collection", ownerDepartment: "Schools" },
    { phase: "Scheduling", name: "Photographer Assignment", ownerDepartment: "Photography" },
    { phase: "Photography", name: "Retake Capture", ownerDepartment: "Photography" },
    { phase: "Production", name: "Retake Image QA", ownerDepartment: "Production" },
    { phase: "Delivery", name: "Retake Gallery Release", ownerDepartment: "Client Success" }
  ],
  sports_league: [
    { phase: "Planning", name: "Team and Roster Collection", ownerDepartment: "Sports" },
    { phase: "Scheduling", name: "Game and Media Day Schedule", ownerDepartment: "Sports" },
    { phase: "Photography", name: "Media Day Capture", ownerDepartment: "Photography" },
    { phase: "Production", name: "Image QA", ownerDepartment: "Production" },
    { phase: "Delivery", name: "Sports Release", ownerDepartment: "Client Success" }
  ],
  team_photos: [
    { phase: "Planning", name: "Team List Confirmation", ownerDepartment: "Sports" },
    { phase: "Scheduling", name: "Team Photo Schedule", ownerDepartment: "Sports" },
    { phase: "Photography", name: "Team Photo Capture", ownerDepartment: "Photography" },
    { phase: "Production", name: "Product and Proof Prep", ownerDepartment: "Production" },
    { phase: "Delivery", name: "Team Gallery Release", ownerDepartment: "Client Success" }
  ],
  graduation: [
    { phase: "Planning", name: "Ceremony Details", ownerDepartment: "Schools" },
    { phase: "Scheduling", name: "Photographer Assignment", ownerDepartment: "Photography" },
    { phase: "Photography", name: "Graduation Capture", ownerDepartment: "Photography" },
    { phase: "Production", name: "Gallery QA", ownerDepartment: "Production" },
    { phase: "Delivery", name: "Family Gallery Delivery", ownerDepartment: "Client Success" }
  ],
  event: [
    { phase: "Planning", name: "Event Details", ownerDepartment: "Client Success" },
    { phase: "Scheduling", name: "Coverage Scheduling", ownerDepartment: "Photography" },
    { phase: "Photography", name: "Event Capture", ownerDepartment: "Photography" },
    { phase: "Production", name: "Image QA", ownerDepartment: "Production" },
    { phase: "Delivery", name: "Client Delivery", ownerDepartment: "Client Success" }
  ],
  specialty: [
    { phase: "Planning", name: "Product Scope", ownerDepartment: "Client Success" },
    { phase: "Scheduling", name: "Due Date Scheduling", ownerDepartment: "Leadership" },
    { phase: "Photography", name: "Reference Capture", ownerDepartment: "Photography" },
    { phase: "Production", name: "Specialty Production", ownerDepartment: "Production" },
    { phase: "Delivery", name: "Client Delivery", ownerDepartment: "Client Success" }
  ]
};

export function getJobIntakeTypeOption(id: JobIntakeTypeId) {
  return JOB_INTAKE_TYPE_OPTIONS.find((option) => option.id === id) ?? JOB_INTAKE_TYPE_OPTIONS[0];
}

type JobRoutingPreviewSeed = Omit<
  JobRoutingPreview,
  "departmentLead" | "assignedPerson" | "assignmentState" | "assignmentLabel" | "workPackages" | "notifications"
>;

function normalizeDepartmentName(value: string | null | undefined) {
  const trimmed = value?.replace(/\s+team$/i, "").replace(/\s+queue$/i, "").trim();
  if (!trimmed) {
    return "Operations";
  }
  if (trimmed.toLowerCase() === "sessions" || trimmed.toLowerCase() === "studios") {
    return "Photography";
  }
  return trimmed.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function departmentLeadFor(department: string | null | undefined) {
  return DEPARTMENT_LEADS[normalizeDepartmentName(department)] ?? "Department lead not set";
}

function assignmentForOwner(owner: string, currentDepartment: string) {
  const normalizedOwner = owner.trim();
  const department = normalizeDepartmentName(currentDepartment);
  const ownerMissing =
    !normalizedOwner ||
    normalizedOwner.toLowerCase() === "owner not assigned" ||
    normalizedOwner.toLowerCase() === "unassigned" ||
    normalizedOwner.toLowerCase() === "owner not set" ||
    normalizedOwner.toLowerCase().endsWith(" queue");

  if (department === "Closed") {
    return {
      assignedPerson: normalizedOwner || "Complete",
      assignmentState: "assigned" as const,
      assignmentLabel: "Assigned" as const
    };
  }
  if (ownerMissing) {
    return {
      assignedPerson: "Unassigned",
      assignmentState: "waiting_assignment" as const,
      assignmentLabel: "Waiting Assignment" as const
    };
  }
  return {
    assignedPerson: normalizedOwner,
    assignmentState: "assigned" as const,
    assignmentLabel: "Assigned" as const
  };
}

function templateForRouting(typeId: JobIntakeTypeId) {
  return WORK_PACKAGE_TEMPLATES[typeId] ?? WORK_PACKAGE_TEMPLATES.school_picture_day;
}

function packageIndexForStage(stage: RoutingStageKey) {
  if (stage === "intake" || stage === "planning") {
    return 0;
  }
  if (stage === "scheduling") {
    return 1;
  }
  if (stage === "shoot_ready" || stage === "capture_complete") {
    return 2;
  }
  if (stage === "production") {
    return 3;
  }
  return 4;
}

function statusForPackage(index: number, currentIndex: number, preview: JobRoutingPreviewSeed & { assignedPerson: string; assignmentState: JobRoutingPreview["assignmentState"] }): OperationalPackageStatus {
  if (index < currentIndex || preview.currentStage === "closed") {
    return "Complete";
  }
  if (index > currentIndex + 1) {
    return "Not Started";
  }
  if (index === currentIndex + 1) {
    return "Ready For Next Department";
  }
  if (preview.blockerStatus === "blocked") {
    return "Blocked";
  }
  if (preview.assignmentState !== "assigned") {
    return "Waiting Assignment";
  }
  if (preview.waitingOn !== "No blocker") {
    return "Waiting On Others";
  }
  if (preview.blockerStatus === "watch") {
    return "Due Soon";
  }
  return "Assigned";
}

function dueDateForPackage(index: number, currentIndex: number, preview: JobRoutingPreviewSeed) {
  if (index < currentIndex) {
    return "Completed";
  }
  if (index === currentIndex) {
    return preview.dueDateLabel;
  }
  if (index === currentIndex + 1) {
    return "Set at handoff";
  }
  return "Planned later";
}

function assignedPersonForPackage(index: number, currentIndex: number, templateDepartment: string, preview: JobRoutingPreviewSeed & { assignedPerson: string }) {
  if (index < currentIndex) {
    return departmentLeadFor(templateDepartment);
  }
  if (index === currentIndex) {
    return preview.assignedPerson;
  }
  return "Unassigned";
}

function buildOperationalWorkPackages(
  preview: JobRoutingPreviewSeed & {
    assignedPerson: string;
    assignmentState: JobRoutingPreview["assignmentState"];
  },
  typeId: JobIntakeTypeId
): JobOperationalWorkPackage[] {
  const currentIndex = packageIndexForStage(preview.currentStage);
  return templateForRouting(typeId).map((workPackage, index) => ({
    ...workPackage,
    id: `${typeId}:${workPackage.phase}`,
    assignedPerson: assignedPersonForPackage(index, currentIndex, workPackage.ownerDepartment, preview),
    dueDateLabel: dueDateForPackage(index, currentIndex, preview),
    status: statusForPackage(index, currentIndex, preview)
  }));
}

function buildOperationalNotifications(
  preview: JobRoutingPreviewSeed & {
    assignedPerson: string;
    assignmentState: JobRoutingPreview["assignmentState"];
  }
): JobOperationalNotification[] {
  const notifications: JobOperationalNotification[] = [];
  if (preview.assignmentState !== "assigned") {
    notifications.push({
      id: "assignment-needed",
      label: "Assignment Needed",
      tone: "warning",
      summary: `${normalizeDepartmentName(preview.currentDepartment)} needs a person assigned before the package can move cleanly.`
    });
  }
  if (preview.blockerStatus === "blocked") {
    notifications.push({
      id: "blocked",
      label: "Blocked",
      tone: "critical",
      summary: preview.waitingOn === "No blocker" ? "A blocker is attached to this package." : `Waiting on ${preview.waitingOn}.`
    });
  } else if (preview.blockerStatus === "watch") {
    notifications.push({
      id: "due-soon",
      label: "Due Soon",
      tone: "warning",
      summary: `${preview.firstNextAction} Due: ${preview.dueDateLabel}.`
    });
  }
  if (!notifications.length && preview.nextDepartment !== "Closed") {
    notifications.push({
      id: "ready-for-next-department",
      label: "Ready For Next Department",
      tone: "success",
      summary: `${normalizeDepartmentName(preview.nextDepartment)} is the next clean handoff.`
    });
  }
  return notifications;
}

function withOperationalEngine(seed: JobRoutingPreviewSeed, typeId: JobIntakeTypeId): JobRoutingPreview {
  const normalizedCurrentDepartment = normalizeDepartmentName(seed.currentDepartment);
  const assignment = assignmentForOwner(seed.currentOwner, normalizedCurrentDepartment);
  const previewBase = {
    ...seed,
    currentDepartment: normalizedCurrentDepartment,
    departmentLead: departmentLeadFor(normalizedCurrentDepartment),
    ...assignment
  };
  return {
    ...previewBase,
    workPackages: buildOperationalWorkPackages(previewBase, typeId),
    notifications: buildOperationalNotifications(previewBase)
  };
}

export function inferJobIntakeTypeId(formState: SharedJobFormState): JobIntakeTypeId {
  if (formState.department_type === "schools" && formState.job_category === "makeup_day") {
    return "retake_day";
  }
  if (formState.department_type === "schools" && formState.job_category === "event") {
    return formState.school_profile.school_type === "graduation" ? "graduation" : "event";
  }
  if (formState.department_type === "sports" && formState.job_category === "specialty") {
    return "specialty";
  }
  if (formState.department_type === "sports") {
    return formState.sports_profile.team_structure === "league_schedule" ? "sports_league" : "team_photos";
  }
  return "school_picture_day";
}

export function applyJobIntakeType(formState: SharedJobFormState, id: JobIntakeTypeId): SharedJobFormState {
  const option = getJobIntakeTypeOption(id);
  return {
    ...formState,
    department_type: option.department,
    job_category: option.category,
    production_required: option.defaults?.production_required ?? formState.production_required,
    delivery_type: option.defaults?.delivery_type ?? formState.delivery_type,
    gallery_type: option.defaults?.gallery_type ?? formState.gallery_type,
    school_profile: { ...formState.school_profile, school_type: "", ...option.schoolDefaults },
    sports_profile: { ...formState.sports_profile, team_structure: "", ...option.sportsDefaults }
  };
}

export function buildWorkflowRouteHint(typeId: JobIntakeTypeId) {
  const option = getJobIntakeTypeOption(typeId);
  return `${option.routeLabel} starts when the package is saved. Open Project Tracking from the job record to keep it moving.`;
}

function firstPresent(values: Array<string | null | undefined>, fallback: string) {
  return values.find((value) => value && value.trim())?.trim() ?? fallback;
}

function dueDateFromForm(formState: SharedJobFormState) {
  return firstPresent([formState.production_deadline_at, formState.client_deadline_at, formState.scheduled_start_date], "Due date not set");
}

function blockerStatusFromPriority(priority: string, hasMissingRequiredInfo: boolean): JobRoutingPreview["blockerStatus"] {
  if (hasMissingRequiredInfo || priority === "urgent") {
    return "blocked";
  }
  if (priority === "high") {
    return "watch";
  }
  return "clear";
}

function blockerLabel(status: JobRoutingPreview["blockerStatus"]) {
  if (status === "blocked") {
    return "Needs attention";
  }
  if (status === "watch") {
    return "Watch";
  }
  return "Clear";
}

export function buildRoutingPreviewFromForm(
  formState: SharedJobFormState,
  ownerName: string | null = null
): JobRoutingPreview {
  const typeId = inferJobIntakeTypeId(formState);
  const option = getJobIntakeTypeOption(typeId);
  const missing = [
    !formState.organization_id,
    !formState.primary_contact_id && !formState.contact_override_note.trim(),
    !formState.primary_location_id && !formState.location_override_note.trim(),
    !formState.scheduled_start_date
  ].filter(Boolean).length;
  const status = blockerStatusFromPriority(formState.priority_level, missing > 0);
  const waitingOn =
    missing > 0
      ? `${missing} intake field${missing === 1 ? "" : "s"}`
      : formState.priority_level === "urgent"
        ? "Leadership review"
        : "No blocker";

  return withOperationalEngine({
    jobTypeLabel: option.label,
    workflowRouteLabel: option.routeLabel,
    workflowRouteHint: buildWorkflowRouteHint(typeId),
    currentDepartment: "Intake",
    currentOwner: ownerName ?? "Owner not assigned",
    waitingOn,
    nextDepartment: option.firstOwnerDepartment,
    dueDateLabel: dueDateFromForm(formState),
    blockerStatus: status,
    blockerLabel: blockerLabel(status),
    firstNextAction: missing > 0 ? "Fill in the missing intake fields before starting the package." : option.defaultNextAction,
    currentStage: "intake"
  }, typeId);
}

function departmentFromJobType(value: string | null | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }
  const lower = value.toLowerCase();
  if (lower.includes("sport") || lower.includes("team") || lower.includes("media")) {
    return "Sports";
  }
  if (lower.includes("school") || lower.includes("retake") || lower.includes("graduation")) {
    return "Schools";
  }
  if (lower.includes("production") || lower.includes("qa") || lower.includes("release")) {
    return "Production";
  }
  return fallback;
}

function stageFromSharedJobStatus(detail: SharedJobDetailResponse): RoutingStageKey {
  if (detail.job.archived_at || detail.job.job_status === "archived" || detail.job.production_status === "complete") {
    return "closed";
  }
  if (["delivered", "complete"].includes(detail.job.production_status)) {
    return "delivery";
  }
  if (
    detail.job.production_required &&
    (detail.job.job_status === "execution_complete" ||
      ["queued", "awaiting_ingest", "editing", "proof_build", "proof_sent", "awaiting_approval", "approved_for_production", "blocked"].includes(
        detail.job.production_status
      ))
  ) {
    return "production";
  }
  if (detail.job.job_status === "execution_complete") {
    return "capture_complete";
  }
  if (["ready_to_execute", "in_progress"].includes(detail.job.job_status)) {
    return "shoot_ready";
  }
  if (["ready_to_staff", "staffed"].includes(detail.job.job_status)) {
    return "scheduling";
  }
  if (["pending_confirmation", "confirmed"].includes(detail.job.job_status)) {
    return "planning";
  }
  return "intake";
}

function nextDepartmentFromStage(stage: RoutingStageKey, detail: SharedJobDetailResponse) {
  if (stage === "intake") {
    return departmentFromJobType(detail.job.department_type, "Client Success");
  }
  if (stage === "planning" || stage === "scheduling") {
    return "Photography";
  }
  if (stage === "shoot_ready" || stage === "capture_complete") {
    return detail.job.production_required ? "Production" : "Delivery";
  }
  if (stage === "production") {
    return "Delivery";
  }
  if (stage === "delivery") {
    return "Client Success";
  }
  return "Closed";
}

function firstNextActionFromDetail(detail: SharedJobDetailResponse) {
  const issue = detail.workflow?.publish?.next_action ?? detail.workflow?.readiness?.next_action ?? detail.workflow?.production?.next_action;
  if (issue) {
    return issue;
  }
  if (detail.status.blocker_count > 0 || detail.watch_flags.length > 0) {
    return "Resolve the open attention item.";
  }
  if (detail.job.job_status === "draft" || detail.job.job_status === "pending_confirmation") {
    return "Confirm client, date, location, owner, and publish readiness.";
  }
  if (detail.job.job_status === "execution_complete" && detail.job.production_required) {
    return "Move the job into Production.";
  }
  if (["proof_sent", "awaiting_approval"].includes(detail.job.production_status)) {
    return "Follow up on approval or requested changes.";
  }
  return "Open the next job tab and move the package forward.";
}

function intakeTypeIdFromDetail(detail: SharedJobDetailResponse): JobIntakeTypeId {
  if (detail.job.department_type === "schools" && detail.job.job_category === "makeup_day") {
    return "retake_day";
  }
  if (detail.job.department_type === "schools" && detail.job.job_category === "event") {
    return detail.school_profile?.school_type === "graduation" ? "graduation" : "event";
  }
  if (detail.job.department_type === "sports" && detail.job.job_category === "specialty") {
    return "specialty";
  }
  if (detail.job.department_type === "sports") {
    return detail.sports_profile?.team_structure === "league_schedule" ? "sports_league" : "team_photos";
  }
  return "school_picture_day";
}

export function buildRoutingPreviewFromDetail(detail: SharedJobDetailResponse): JobRoutingPreview {
  const stage = stageFromSharedJobStatus(detail);
  const typeId = intakeTypeIdFromDetail(detail);
  const blocked = detail.status.blocker_count > 0 || detail.watch_flags.some((flag) => flag.severity === "critical" || flag.severity === "high");
  const watch = detail.job.risk_status === "high" || detail.job.risk_status === "medium" || detail.status.open_watch_flag_count > 0;
  const status: JobRoutingPreview["blockerStatus"] = blocked ? "blocked" : watch ? "watch" : "clear";
  const dueDate = firstPresent(
    [detail.job.production_deadline_at?.slice(0, 10), detail.job.client_deadline_at?.slice(0, 10), detail.summary.primary_day_date],
    "Due date not set"
  );
  return withOperationalEngine({
    jobTypeLabel: humanizeToken(detail.job.job_category),
    workflowRouteLabel: `${getJobIntakeTypeOption(typeId).label} route`,
    workflowRouteHint: "Open Project Tracking to review the connected route and next owner.",
    currentDepartment: stage === "intake" ? "Intake" : nextDepartmentFromStage(stage, detail) === "Closed" ? "Closed" : departmentFromJobType(detail.job.department_type, "Operations"),
    currentOwner: detail.summary.lead_owner_name ?? detail.summary.account_owner_name ?? "Owner not assigned",
    waitingOn: blocked ? `${detail.status.blocker_count || detail.status.open_watch_flag_count} attention item${(detail.status.blocker_count || detail.status.open_watch_flag_count) === 1 ? "" : "s"}` : "No blocker",
    nextDepartment: nextDepartmentFromStage(stage, detail),
    dueDateLabel: dueDate === "Due date not set" ? dueDate : formatDate(dueDate),
    blockerStatus: status,
    blockerLabel: blockerLabel(status),
    firstNextAction: firstNextActionFromDetail(detail),
    currentStage: stage
  }, typeId);
}

function projectStage(row: ProjectWorkflowJobRow): RoutingStageKey {
  if (row.health === "complete" || row.phase === "complete") {
    return "closed";
  }
  if (row.phase === "production" || row.phase === "qa") {
    return "production";
  }
  if (row.phase === "waiting") {
    return "planning";
  }
  if (row.current_step?.department?.toLowerCase().includes("production")) {
    return "production";
  }
  if (row.current_step?.department?.toLowerCase().includes("photo") || row.current_step?.department?.toLowerCase().includes("session")) {
    return "shoot_ready";
  }
  return row.workflow_run_id ? "planning" : "intake";
}

function intakeTypeIdFromProjectRow(row: ProjectWorkflowJobRow): JobIntakeTypeId {
  const text = [row.workflow_template_name, row.job_title, row.job_number, row.job_code, row.organization_name, row.current_step?.department, row.phase]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (text.includes("retake")) {
    return "retake_day";
  }
  if (text.includes("graduation")) {
    return "graduation";
  }
  if (text.includes("specialty") || text.includes("banner")) {
    return "specialty";
  }
  if (text.includes("league")) {
    return "sports_league";
  }
  if (text.includes("sport") || text.includes("team") || text.includes("media day")) {
    return "team_photos";
  }
  if (text.includes("event")) {
    return "event";
  }
  return "school_picture_day";
}

export function buildRoutingPreviewFromProjectRow(row: ProjectWorkflowJobRow): JobRoutingPreview {
  const stage = projectStage(row);
  const typeId = intakeTypeIdFromProjectRow(row);
  const blocked = row.health === "blocked" || row.queue_intelligence.operational_status === "blocked";
  const watch = ["due_soon", "running_late", "at_risk", "no_workflow", "unknown"].includes(row.health);
  const status: JobRoutingPreview["blockerStatus"] = blocked ? "blocked" : watch ? "watch" : "clear";
  const currentOwner =
    row.owner_type === "user"
      ? row.owner_display || "Assigned person"
      : row.current_step?.assignment_status === "needs_assignment" || row.owner_type === "department"
        ? "Unassigned"
        : row.owner_display || "Owner not assigned";
  return withOperationalEngine({
    jobTypeLabel: row.workflow_template_name ?? "Job workflow",
    workflowRouteLabel: row.workflow_run_id ? "Connected route" : "Route pending",
    workflowRouteHint: row.workflow_run_id
      ? `#project-tracking/workflows/${row.workflow_run_id}`
      : "Create or attach a route before this can move through Project Tracking.",
    currentDepartment: row.current_step?.department ? humanizeToken(row.current_step.department) : departmentFromJobType(row.job_title, "Operations"),
    currentOwner,
    waitingOn: row.waiting_on_party && row.waiting_on_party !== "none" ? humanizeToken(row.waiting_on_party) : "No blocker",
    nextDepartment: row.queue_intelligence.owner_lane ? humanizeToken(row.queue_intelligence.owner_lane) : "Next owner",
    dueDateLabel: row.next_deadline_at ? formatDate(row.next_deadline_at) : "Due date not set",
    blockerStatus: status,
    blockerLabel: blockerLabel(status),
    firstNextAction: row.queue_intelligence.next_action || "Open the workflow route and choose the next action.",
    currentStage: stage
  }, typeId);
}

export function JobProgressTimeline({ preview }: { preview: JobRoutingPreview }) {
  const currentIndex = JOB_ROUTING_STAGES.findIndex((stage) => stage.key === preview.currentStage);
  return (
    <div className="job-routing-timeline" aria-label="Job progress timeline">
      {JOB_ROUTING_STAGES.map((stage, index) => (
        <div
          key={stage.key}
          className={`job-routing-timeline__step${index < currentIndex ? " is-complete" : ""}${index === currentIndex ? " is-current" : ""}`}
        >
          <span className="job-routing-timeline__dot" aria-hidden="true" />
          <span>{stage.label}</span>
        </div>
      ))}
    </div>
  );
}

function packageStatusClass(status: OperationalPackageStatus) {
  return status.toLowerCase().replace(/\s+/g, "-");
}

function notificationToneClass(tone: OperationalNotificationTone) {
  return `job-routing-notification--${tone}`;
}

export function JobOwnershipPanel({ preview, compact = false }: { preview: JobRoutingPreview; compact?: boolean }) {
  const items = [
    { label: "Current Department", value: preview.currentDepartment },
    { label: "Department Lead", value: preview.departmentLead },
    { label: "Assigned Person", value: preview.assignedPerson },
    { label: "Assignment Status", value: preview.assignmentLabel }
  ];
  return (
    <section className={`job-ownership-card${compact ? " job-ownership-card--compact" : ""}`} aria-label="Job ownership">
      <div className="job-routing-card__header">
        <div>
          <strong>Ownership</strong>
          <span>Department ownership and person assignment stay separate.</span>
        </div>
        <span className={`job-routing-card__status job-routing-card__status--${preview.assignmentState === "assigned" ? "clear" : "watch"}`}>
          {preview.assignmentLabel}
        </span>
      </div>
      <div className="job-routing-card__grid">
        {items.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export function JobWorkPackagesPanel({
  preview,
  compact = false,
  limit
}: {
  preview: JobRoutingPreview;
  compact?: boolean;
  limit?: number;
}) {
  const packages = typeof limit === "number" ? preview.workPackages.slice(0, limit) : preview.workPackages;
  const hiddenCount = Math.max(0, preview.workPackages.length - packages.length);
  return (
    <section className={`job-work-packages${compact ? " job-work-packages--compact" : ""}`} aria-label="Work Packages">
      <div className="job-work-packages__header">
        <div>
          <strong>Work Packages</strong>
          <span>Planning, Scheduling, Photography, Production, and Delivery handoffs generated from the job type.</span>
        </div>
        <span>{preview.workPackages.length} packages</span>
      </div>
      <div className="job-work-packages__list">
        {packages.map((workPackage) => (
          <article key={workPackage.id} className="job-work-package">
            <div>
              <span>{workPackage.phase}</span>
              <strong>{workPackage.name}</strong>
            </div>
            <div className="job-work-package__meta">
              <span>{workPackage.ownerDepartment}</span>
              <span>{workPackage.assignedPerson}</span>
              <span>{workPackage.dueDateLabel}</span>
            </div>
            <span className={`job-work-package__status job-work-package__status--${packageStatusClass(workPackage.status)}`}>
              {workPackage.status}
            </span>
          </article>
        ))}
      </div>
      {hiddenCount ? <small>{hiddenCount} more package{hiddenCount === 1 ? "" : "s"} continue the route.</small> : null}
    </section>
  );
}

export function JobWorkPackageSummary({ preview }: { preview: JobRoutingPreview }) {
  const activePackage =
    preview.workPackages.find((workPackage) => !["Complete", "Not Started"].includes(workPackage.status)) ??
    preview.workPackages.find((workPackage) => workPackage.status === "Not Started") ??
    preview.workPackages[0];
  if (!activePackage) {
    return null;
  }
  return (
    <div className="job-work-package-summary" aria-label="Current work package">
      <span>Work Package</span>
      <strong>{activePackage.name}</strong>
      <small>{activePackage.ownerDepartment} - {activePackage.status}</small>
    </div>
  );
}

export function JobNotificationFoundation({ preview }: { preview: JobRoutingPreview }) {
  return (
    <section className="job-routing-notifications" aria-label="Notification Signals">
      <div>
        <strong>Notification Signals</strong>
        <span>Demo-safe signals only; no messages are sent from this panel.</span>
      </div>
      <div className="job-routing-notifications__chips">
        {preview.notifications.map((notification) => (
          <span key={notification.id} className={`job-routing-notification ${notificationToneClass(notification.tone)}`} title={notification.summary}>
            {notification.label}
          </span>
        ))}
      </div>
    </section>
  );
}

export function JobRoutingOutcome({ preview }: { preview: JobRoutingPreview }) {
  return (
    <section className="panel job-routing-outcome">
      <div className="job-routing-outcome__header">
        <div>
          <span className="eyebrow">Workflow Route</span>
          <h3>What happens after submit</h3>
          <p>{preview.workflowRouteHint}</p>
        </div>
        <span className={`job-routing-card__status job-routing-card__status--${preview.blockerStatus}`}>{preview.blockerLabel}</span>
      </div>
      <JobProgressTimeline preview={preview} />
      <JobOwnershipPanel preview={preview} />
      <JobHandoffCard preview={preview} />
      <JobWorkPackagesPanel preview={preview} compact />
      <JobNotificationFoundation preview={preview} />
    </section>
  );
}

export function JobHandoffCard({ preview, compact = false }: { preview: JobRoutingPreview; compact?: boolean }) {
  const compactItems = [
    { label: "Owner", value: preview.currentOwner },
    { label: "Waiting on", value: preview.waitingOn },
    { label: "Next", value: preview.nextDepartment },
    { label: "Due", value: preview.dueDateLabel }
  ];
  const fullItems = [
    { label: "Current Department", value: preview.currentDepartment },
    { label: "Current Owner", value: preview.assignedPerson },
    { label: "Waiting On", value: preview.waitingOn },
    { label: "Next Department", value: preview.nextDepartment },
    { label: "Due Date", value: preview.dueDateLabel },
    { label: "Blocker Status", value: preview.blockerLabel },
    { label: "Next Action", value: preview.firstNextAction }
  ];
  const items = compact ? compactItems : fullItems;

  return (
    <section className={`job-routing-card${compact ? " job-routing-card--compact" : ""}`}>
      <div className="job-routing-card__header">
        <div>
          <strong>{compact ? "Handoff" : "Handoff Plan"}</strong>
          <span>{preview.workflowRouteLabel}</span>
        </div>
        <span className={`job-routing-card__status job-routing-card__status--${preview.blockerStatus}`}>{preview.blockerLabel}</span>
      </div>
      <div className="job-routing-card__grid">
        {items.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
      {!compact ? <p>{preview.workflowRouteHint}</p> : null}
    </section>
  );
}
