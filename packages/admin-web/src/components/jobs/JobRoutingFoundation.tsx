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

export type JobRoutingPreview = {
  jobTypeLabel: string;
  workflowRouteLabel: string;
  workflowRouteHint: string;
  currentDepartment: string;
  currentOwner: string;
  waitingOn: string;
  nextDepartment: string;
  dueDateLabel: string;
  blockerStatus: "clear" | "watch" | "blocked";
  blockerLabel: string;
  firstNextAction: string;
  currentStage: RoutingStageKey;
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
    routeLabel: "School Picture Day workflow",
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
    routeLabel: "Retake Day workflow",
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
    routeLabel: "Sports League workflow",
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
    routeLabel: "Team Photos workflow",
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
    routeLabel: "Graduation workflow",
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
    routeLabel: "Event workflow",
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
    routeLabel: "Specialty workflow",
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

export function getJobIntakeTypeOption(id: JobIntakeTypeId) {
  return JOB_INTAKE_TYPE_OPTIONS.find((option) => option.id === id) ?? JOB_INTAKE_TYPE_OPTIONS[0];
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
    school_profile: { ...formState.school_profile, ...option.schoolDefaults },
    sports_profile: { ...formState.sports_profile, ...option.sportsDefaults }
  };
}

export function buildWorkflowRouteHint(typeId: JobIntakeTypeId) {
  const option = getJobIntakeTypeOption(typeId);
  return `${option.routeLabel} attaches when the draft is saved. Open Project Tracking from the job record after submit.`;
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

  return {
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
    firstNextAction: missing > 0 ? "Complete the missing intake fields before publish." : option.defaultNextAction,
    currentStage: "intake"
  };
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

export function buildRoutingPreviewFromDetail(detail: SharedJobDetailResponse): JobRoutingPreview {
  const stage = stageFromSharedJobStatus(detail);
  const blocked = detail.status.blocker_count > 0 || detail.watch_flags.some((flag) => flag.severity === "critical" || flag.severity === "high");
  const watch = detail.job.risk_status === "high" || detail.job.risk_status === "medium" || detail.status.open_watch_flag_count > 0;
  const status: JobRoutingPreview["blockerStatus"] = blocked ? "blocked" : watch ? "watch" : "clear";
  const dueDate = firstPresent(
    [detail.job.production_deadline_at?.slice(0, 10), detail.job.client_deadline_at?.slice(0, 10), detail.summary.primary_day_date],
    "Due date not set"
  );
  return {
    jobTypeLabel: humanizeToken(detail.job.job_category),
    workflowRouteLabel: `${departmentFromJobType(detail.job.department_type, "Job")} workflow`,
    workflowRouteHint: "Open Project Tracking to review the connected workflow route and next owner.",
    currentDepartment: stage === "intake" ? "Intake" : nextDepartmentFromStage(stage, detail) === "Closed" ? "Closed" : departmentFromJobType(detail.job.department_type, "Operations"),
    currentOwner: detail.summary.lead_owner_name ?? detail.summary.account_owner_name ?? "Owner not assigned",
    waitingOn: blocked ? `${detail.status.blocker_count || detail.status.open_watch_flag_count} attention item${(detail.status.blocker_count || detail.status.open_watch_flag_count) === 1 ? "" : "s"}` : "No blocker",
    nextDepartment: nextDepartmentFromStage(stage, detail),
    dueDateLabel: dueDate === "Due date not set" ? dueDate : formatDate(dueDate),
    blockerStatus: status,
    blockerLabel: blockerLabel(status),
    firstNextAction: firstNextActionFromDetail(detail),
    currentStage: stage
  };
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

export function buildRoutingPreviewFromProjectRow(row: ProjectWorkflowJobRow): JobRoutingPreview {
  const stage = projectStage(row);
  const blocked = row.health === "blocked" || row.queue_intelligence.operational_status === "blocked";
  const watch = ["due_soon", "running_late", "at_risk", "no_workflow", "unknown"].includes(row.health);
  const status: JobRoutingPreview["blockerStatus"] = blocked ? "blocked" : watch ? "watch" : "clear";
  return {
    jobTypeLabel: row.workflow_template_name ?? "Job workflow",
    workflowRouteLabel: row.workflow_run_id ? "Connected workflow route" : "Workflow route pending",
    workflowRouteHint: row.workflow_run_id
      ? `#project-tracking/workflows/${row.workflow_run_id}`
      : "Create or attach a workflow route before this can move through Project Tracking.",
    currentDepartment: row.current_step?.department ? `${humanizeToken(row.current_step.department)} team` : departmentFromJobType(row.job_title, "Operations"),
    currentOwner: row.owner_display || "Owner not assigned",
    waitingOn: row.waiting_on_party && row.waiting_on_party !== "none" ? humanizeToken(row.waiting_on_party) : "No blocker",
    nextDepartment: row.queue_intelligence.owner_lane ? humanizeToken(row.queue_intelligence.owner_lane) : "Next owner",
    dueDateLabel: row.next_deadline_at ? formatDate(row.next_deadline_at) : "Due date not set",
    blockerStatus: status,
    blockerLabel: blockerLabel(status),
    firstNextAction: row.queue_intelligence.next_action || "Open the workflow route and choose the next action.",
    currentStage: stage
  };
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

export function JobHandoffCard({ preview, compact = false }: { preview: JobRoutingPreview; compact?: boolean }) {
  return (
    <section className={`job-routing-card${compact ? " job-routing-card--compact" : ""}`}>
      <div className="job-routing-card__header">
        <div>
          <strong>Handoff Card</strong>
          <span>{preview.workflowRouteLabel}</span>
        </div>
        <span className={`job-routing-card__status job-routing-card__status--${preview.blockerStatus}`}>{preview.blockerLabel}</span>
      </div>
      <div className="job-routing-card__grid">
        <div>
          <span>Current department</span>
          <strong>{preview.currentDepartment}</strong>
        </div>
        <div>
          <span>Current owner</span>
          <strong>{preview.currentOwner}</strong>
        </div>
        <div>
          <span>Waiting on</span>
          <strong>{preview.waitingOn}</strong>
        </div>
        <div>
          <span>Next department</span>
          <strong>{preview.nextDepartment}</strong>
        </div>
        <div>
          <span>Due date</span>
          <strong>{preview.dueDateLabel}</strong>
        </div>
        <div>
          <span>Next action</span>
          <strong>{preview.firstNextAction}</strong>
        </div>
      </div>
      {!compact ? <p>{preview.workflowRouteHint}</p> : null}
    </section>
  );
}
