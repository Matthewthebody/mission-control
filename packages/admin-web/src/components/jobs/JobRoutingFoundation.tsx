import type { SharedJobDetailResponse } from "../../jobTruthTypes";
import type { ProjectWorkflowJobRow } from "../../projectTrackingTypes";
import { formatDate, humanizeToken } from "../sports/SportsPrimitives";
import type { SharedJobFormState } from "./DepartmentJobAdapterUIRegistry";

export type JobIntakeTypeId =
  | "school_picture_day"
  | "retake_day"
  | "sports_picture_day"
  | "sports_league"
  | "team_photos"
  | "graduation"
  | "cap_and_gown"
  | "yearbook"
  | "event"
  | "specialty"
  | "other";

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
type IntakeReadinessTone = "success" | "warning" | "critical" | "neutral";
type IntakeReviewState = "Draft Intake" | "Intake Review" | "Missing Info" | "Ready To Launch";
type ChangeNoticeLevel = "FYI" | "Important" | "Urgent";
export type JobWorkflowAssignmentRuleType = "department_lead" | "direct_owner" | "needs_owner" | "role_fallback";

export type JobOperationalWorkPackage = {
  id: string;
  phase: OperationalPackagePhase;
  name: string;
  summary: string;
  ownerDepartment: string;
  assignmentRule: "Department Lead" | "Direct Owner" | "Needs Owner" | "Role Fallback";
  assignmentRuleType: JobWorkflowAssignmentRuleType;
  assignedPerson: string;
  dueDateLabel: string;
  status: OperationalPackageStatus;
  readinessChecks: string[];
  commonBlockers: string[];
  completionCriteria: string;
  handoffToDepartment: string;
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

export type JobIntakeReadinessItem = {
  id: string;
  label: string;
  status: "Ready" | "Missing" | "Review";
  summary: string;
};

export type JobIntakeManagementSummary = {
  reviewState: IntakeReviewState;
  readinessTone: IntakeReadinessTone;
  missingInfo: JobIntakeReadinessItem[];
  readyInfo: JobIntakeReadinessItem[];
  reviewAction: string;
  launchAction: string;
};

export type JobChangeNotice = {
  id: string;
  level: ChangeNoticeLevel;
  title: string;
  summary: string;
};

type JobWorkflowTemplateTask = Omit<
  JobOperationalWorkPackage,
  "id" | "assignmentRule" | "assignedPerson" | "dueDateLabel" | "status" | "handoffToDepartment"
> & {
  assignmentRuleType: JobWorkflowAssignmentRuleType;
  directOwner?: string;
  fallbackDepartment?: string;
  dueDateLogic: string;
};

type JobWorkflowTemplateTaskSeed = Omit<
  JobWorkflowTemplateTask,
  "assignmentRuleType" | "readinessChecks" | "commonBlockers" | "completionCriteria" | "dueDateLogic"
> & {
  assignmentRule?: "Department Lead" | "Direct Owner" | "Manual Assignment";
  assignmentRuleType?: JobWorkflowAssignmentRuleType;
  readinessChecks?: string[];
  commonBlockers?: string[];
  completionCriteria?: string;
  dueDateLogic?: string;
};

export type JobWorkflowTemplateDefinition = {
  typeId: JobIntakeTypeId;
  jobType: string;
  departmentsInvolved: string[];
  handoffSequence: string[];
  defaultTasks: JobWorkflowTemplateTask[];
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
    label: "Retake / Makeup Day",
    department: "schools",
    category: "makeup_day",
    routeLabel: "Retake Day route",
    firstOwnerDepartment: "Schools",
    nextDepartment: "Photography",
    defaultNextAction: "Confirm retake date, eligible students, and release expectations.",
    defaults: { production_required: true, delivery_type: "proofs_and_order", gallery_type: "individual" }
  },
  {
    id: "sports_picture_day",
    label: "Sports Picture Day",
    department: "sports",
    category: "media_day",
    routeLabel: "Sports Picture Day route",
    firstOwnerDepartment: "Sports",
    nextDepartment: "Photography",
    defaultNextAction: "Confirm team list, photo flow, QR process, and photography prep.",
    defaults: { production_required: true, delivery_type: "mixed", gallery_type: "team_and_individual" },
    sportsDefaults: { proof_required: true, team_structure: "scheduled_slots", specialty_products_required: true }
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
    id: "cap_and_gown",
    label: "Cap & Gown",
    department: "schools",
    category: "event",
    routeLabel: "Cap & Gown route",
    firstOwnerDepartment: "Schools",
    nextDepartment: "Photography",
    defaultNextAction: "Confirm cap-and-gown schedule, portrait station, access, and delivery deadline.",
    defaults: { production_required: true, delivery_type: "digital_gallery", gallery_type: "individual" },
    schoolDefaults: { school_type: "graduation", special_instructions: "Cap-and-gown workflow; confirm portrait station and ceremony timing." }
  },
  {
    id: "yearbook",
    label: "Yearbook",
    department: "schools",
    category: "photo_day",
    routeLabel: "Yearbook route",
    firstOwnerDepartment: "Schools",
    nextDepartment: "Production",
    defaultNextAction: "Confirm yearbook export requirements, roster source, and school submission deadline.",
    defaults: { production_required: true, delivery_type: "school_deliverables", gallery_type: "individual" },
    schoolDefaults: { yearbook_required: true, roster_source: "school_roster" }
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
    label: "In-Studio Work",
    department: "sports",
    category: "specialty",
    routeLabel: "In-Studio Work route",
    firstOwnerDepartment: "Client Success",
    nextDepartment: "Production",
    defaultNextAction: "Confirm the studio request, due date, reference files, and approval owner.",
    defaults: { production_required: true, delivery_type: "specialty_only", gallery_type: "none" },
    sportsDefaults: { specialty_products_required: true, banner_work_required: true }
  },
  {
    id: "other",
    label: "Other",
    department: "schools",
    category: "event",
    routeLabel: "Custom Event route",
    firstOwnerDepartment: "Client Success",
    nextDepartment: "Leadership",
    defaultNextAction: "Confirm custom scope, owner, requested date, and which department should lead.",
    defaults: { production_required: true, delivery_type: "digital_gallery", gallery_type: "individual" }
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

const WORK_PACKAGE_TEMPLATE_SEEDS: Record<JobIntakeTypeId, JobWorkflowTemplateTaskSeed[]> = {
  school_picture_day: [
    { phase: "Planning", name: "Roster Collection", summary: "Request or verify roster, grade range, and ID-matching needs.", ownerDepartment: "Schools", assignmentRule: "Department Lead" },
    { phase: "Scheduling", name: "Photographer Assignment", summary: "Confirm date, arrival window, lead photographer, and coverage level.", ownerDepartment: "Photography", assignmentRuleType: "needs_owner" },
    { phase: "Photography", name: "Picture Day Capture", summary: "Execute picture day with setup, access, and day-of roster notes.", ownerDepartment: "Photography", assignmentRuleType: "role_fallback", fallbackDepartment: "Photography" },
    { phase: "Production", name: "Image QA", summary: "Ingest, verify data match, crop, QA, and prepare required outputs.", ownerDepartment: "Production", assignmentRule: "Department Lead" },
    { phase: "Delivery", name: "Gallery Release", summary: "Release gallery, school deliverables, and client follow-up.", ownerDepartment: "Client Success", assignmentRule: "Department Lead" }
  ],
  retake_day: [
    { phase: "Planning", name: "Retake List Collection", summary: "Confirm eligible students, missing-image list, and makeup rules.", ownerDepartment: "Schools", assignmentRule: "Department Lead" },
    { phase: "Scheduling", name: "Retake Photographer Assignment", summary: "Confirm makeup date, arrival window, and staffing needs.", ownerDepartment: "Photography", assignmentRuleType: "needs_owner" },
    { phase: "Photography", name: "Retake Capture", summary: "Capture makeup images and flag record-matching exceptions.", ownerDepartment: "Photography", assignmentRuleType: "role_fallback", fallbackDepartment: "Photography" },
    { phase: "Production", name: "Retake Image QA", summary: "Match retake files, verify replacement rules, and update outputs.", ownerDepartment: "Production", assignmentRule: "Department Lead" },
    { phase: "Delivery", name: "Retake Gallery Release", summary: "Release retakes and notify school or families as needed.", ownerDepartment: "Client Success", assignmentRule: "Department Lead" }
  ],
  sports_picture_day: [
    { phase: "Planning", name: "Team List and QR Readiness", summary: "Collect team list, coach contact, QR/barcode plan, and late-arrival rules.", ownerDepartment: "Sports", assignmentRule: "Department Lead" },
    { phase: "Scheduling", name: "Sports Photo Flow", summary: "Set order of teams, individual flow, team photo flow, and staffing coverage.", ownerDepartment: "Sports", assignmentRule: "Department Lead" },
    { phase: "Photography", name: "Sports Capture", summary: "Execute team and individual photos with coach/team exceptions captured.", ownerDepartment: "Photography", assignmentRuleType: "role_fallback", fallbackDepartment: "Photography" },
    { phase: "Production", name: "Sports Sorting and QA", summary: "Sort by team, verify graphics/product needs, and QA release readiness.", ownerDepartment: "Production", assignmentRule: "Department Lead" },
    { phase: "Delivery", name: "Sports Gallery Release", summary: "Release proof/gallery and handle coach or league follow-up.", ownerDepartment: "Client Success", assignmentRule: "Department Lead" }
  ],
  sports_league: [
    { phase: "Planning", name: "Team and Roster Collection", summary: "Confirm league structure, teams, coaches, rosters, and proof owner.", ownerDepartment: "Sports", assignmentRule: "Department Lead" },
    { phase: "Scheduling", name: "Game and Media Day Schedule", summary: "Confirm date grid, location flow, and staffing by team block.", ownerDepartment: "Sports", assignmentRule: "Department Lead" },
    { phase: "Photography", name: "Media Day Capture", summary: "Capture teams and individuals with late-arrival and coach exceptions.", ownerDepartment: "Photography", assignmentRuleType: "role_fallback", fallbackDepartment: "Photography" },
    { phase: "Production", name: "Sports Image QA", summary: "Sort, QA, verify specialty products, and prepare release.", ownerDepartment: "Production", assignmentRule: "Department Lead" },
    { phase: "Delivery", name: "Sports Release", summary: "Release proofs, final galleries, and league follow-up.", ownerDepartment: "Client Success", assignmentRule: "Department Lead" }
  ],
  team_photos: [
    { phase: "Planning", name: "Team List Confirmation", summary: "Confirm teams, coaches, counts, and proof requirements.", ownerDepartment: "Sports", assignmentRule: "Department Lead" },
    { phase: "Scheduling", name: "Team Photo Schedule", summary: "Set team time slots, location notes, and staffing expectations.", ownerDepartment: "Sports", assignmentRule: "Department Lead" },
    { phase: "Photography", name: "Team Photo Capture", summary: "Capture team and individual images with notes for production.", ownerDepartment: "Photography", assignmentRuleType: "role_fallback", fallbackDepartment: "Photography" },
    { phase: "Production", name: "Product and Proof Prep", summary: "Prepare proofing, products, banners, or specialty outputs.", ownerDepartment: "Production", assignmentRule: "Department Lead" },
    { phase: "Delivery", name: "Team Gallery Release", summary: "Release gallery and client/team communication.", ownerDepartment: "Client Success", assignmentRule: "Department Lead" }
  ],
  graduation: [
    { phase: "Planning", name: "Ceremony Details", summary: "Confirm ceremony schedule, stage positions, access, and deliverables.", ownerDepartment: "Schools", assignmentRule: "Department Lead" },
    { phase: "Scheduling", name: "Graduation Photographer Assignment", summary: "Assign ceremony coverage, portrait station, and timing notes.", ownerDepartment: "Photography", assignmentRuleType: "needs_owner" },
    { phase: "Photography", name: "Graduation Capture", summary: "Capture ceremony, portraits, and key coverage notes.", ownerDepartment: "Photography", assignmentRuleType: "role_fallback", fallbackDepartment: "Photography" },
    { phase: "Production", name: "Graduation Gallery QA", summary: "QA ceremony images and prepare family gallery delivery.", ownerDepartment: "Production", assignmentRule: "Department Lead" },
    { phase: "Delivery", name: "Family Gallery Delivery", summary: "Release gallery and manage family/client follow-up.", ownerDepartment: "Client Success", assignmentRule: "Department Lead" }
  ],
  cap_and_gown: [
    { phase: "Planning", name: "Cap & Gown Scope", summary: "Confirm portrait station, school expectations, and student flow.", ownerDepartment: "Schools", assignmentRule: "Department Lead" },
    { phase: "Scheduling", name: "Portrait Station Schedule", summary: "Confirm room, arrival, setup, and staffing coverage.", ownerDepartment: "Photography", assignmentRuleType: "needs_owner" },
    { phase: "Photography", name: "Cap & Gown Capture", summary: "Capture portraits and note exceptions or retake needs.", ownerDepartment: "Photography", assignmentRuleType: "role_fallback", fallbackDepartment: "Photography" },
    { phase: "Production", name: "Portrait QA", summary: "QA portraits, crop, match records, and prepare gallery.", ownerDepartment: "Production", assignmentRule: "Department Lead" },
    { phase: "Delivery", name: "Cap & Gown Delivery", summary: "Release gallery and follow up with school contact.", ownerDepartment: "Client Success", assignmentRule: "Department Lead" }
  ],
  yearbook: [
    { phase: "Planning", name: "Yearbook Requirements", summary: "Confirm export specs, roster source, deadline, and advisor contact.", ownerDepartment: "Schools", assignmentRule: "Department Lead" },
    { phase: "Scheduling", name: "Yearbook Data Readiness", summary: "Verify required fields, ID matching, and submission timing.", ownerDepartment: "Schools", assignmentRule: "Department Lead" },
    { phase: "Photography", name: "Reference Capture Check", summary: "Confirm any needed image replacement or reference work.", ownerDepartment: "Photography", assignmentRuleType: "role_fallback", fallbackDepartment: "Photography" },
    { phase: "Production", name: "Yearbook Export", summary: "Prepare PSPA/yearbook export and validate file requirements.", ownerDepartment: "Production", assignmentRule: "Department Lead" },
    { phase: "Delivery", name: "Advisor Delivery", summary: "Send export and confirm advisor acceptance.", ownerDepartment: "Client Success", assignmentRule: "Department Lead" }
  ],
  event: [
    { phase: "Planning", name: "Event Details", summary: "Confirm event owner, scope, audience, restrictions, and deliverables.", ownerDepartment: "Client Success", assignmentRule: "Department Lead" },
    { phase: "Scheduling", name: "Coverage Scheduling", summary: "Assign photographer and confirm arrival, coverage, and teardown.", ownerDepartment: "Photography", assignmentRuleType: "needs_owner" },
    { phase: "Photography", name: "Event Capture", summary: "Capture event with client-facing notes and coverage exceptions.", ownerDepartment: "Photography", assignmentRuleType: "role_fallback", fallbackDepartment: "Photography" },
    { phase: "Production", name: "Event Image QA", summary: "Cull, QA, and prepare client-ready delivery.", ownerDepartment: "Production", assignmentRule: "Department Lead" },
    { phase: "Delivery", name: "Client Delivery", summary: "Deliver gallery/files and complete follow-up.", ownerDepartment: "Client Success", assignmentRule: "Department Lead" }
  ],
  specialty: [
    { phase: "Planning", name: "Studio Scope", summary: "Confirm studio request, reference files, approval owner, and due date.", ownerDepartment: "Client Success", assignmentRule: "Department Lead" },
    { phase: "Scheduling", name: "Due Date Scheduling", summary: "Confirm priority, production window, and leadership approval if needed.", ownerDepartment: "Leadership", assignmentRule: "Direct Owner", directOwner: "Brandon" },
    { phase: "Photography", name: "Reference Capture", summary: "Capture or collect needed reference images and usage notes.", ownerDepartment: "Photography", assignmentRuleType: "role_fallback", fallbackDepartment: "Photography" },
    { phase: "Production", name: "Studio Production", summary: "Build, QA, and prepare the final output.", ownerDepartment: "Production", assignmentRule: "Department Lead" },
    { phase: "Delivery", name: "Client Delivery", summary: "Deliver final product and confirm acceptance.", ownerDepartment: "Client Success", assignmentRule: "Department Lead" }
  ],
  other: [
    { phase: "Planning", name: "Custom Scope Review", summary: "Clarify what the client needs and which department owns the package.", ownerDepartment: "Client Success", assignmentRule: "Department Lead" },
    { phase: "Scheduling", name: "Calendar Readiness", summary: "Confirm date, location, access, and staffing assumptions.", ownerDepartment: "Operations", assignmentRule: "Department Lead" },
    { phase: "Photography", name: "Coverage Plan", summary: "Confirm whether photography is needed and who should handle it.", ownerDepartment: "Photography", assignmentRuleType: "role_fallback", fallbackDepartment: "Photography" },
    { phase: "Production", name: "Output Plan", summary: "Confirm production, graphics, or file delivery requirements.", ownerDepartment: "Production", assignmentRule: "Department Lead" },
    { phase: "Delivery", name: "Client Closeout", summary: "Confirm final delivery and any follow-up owner.", ownerDepartment: "Client Success", assignmentRule: "Department Lead" }
  ]
};

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function assignmentRuleLabel(ruleType: JobWorkflowAssignmentRuleType): JobOperationalWorkPackage["assignmentRule"] {
  if (ruleType === "direct_owner") {
    return "Direct Owner";
  }
  if (ruleType === "needs_owner") {
    return "Needs Owner";
  }
  if (ruleType === "role_fallback") {
    return "Role Fallback";
  }
  return "Department Lead";
}

function assignmentRuleTypeForTask(task: JobWorkflowTemplateTaskSeed): JobWorkflowAssignmentRuleType {
  if (task.assignmentRuleType) {
    return task.assignmentRuleType;
  }
  if (task.assignmentRule === "Direct Owner") {
    return "direct_owner";
  }
  if (task.assignmentRule === "Manual Assignment") {
    return "needs_owner";
  }
  return "department_lead";
}

function defaultReadinessChecks(task: JobWorkflowTemplateTaskSeed) {
  if (task.readinessChecks?.length) {
    return task.readinessChecks;
  }
  if (task.phase === "Planning") {
    return ["Client, scope, contact, and missing-info list reviewed."];
  }
  if (task.phase === "Scheduling") {
    return ["Shoot date, time window, location, and owner assignment confirmed."];
  }
  if (task.phase === "Photography") {
    return ["Prep notes, call time, equipment needs, and day-of owner confirmed."];
  }
  if (task.phase === "Production") {
    return ["Files, data, production deadline, and QA expectations confirmed."];
  }
  return ["Delivery destination, communication owner, and closeout expectation confirmed."];
}

function defaultCommonBlockers(task: JobWorkflowTemplateTaskSeed) {
  if (task.commonBlockers?.length) {
    return task.commonBlockers;
  }
  const name = `${task.name} ${task.summary}`.toLowerCase();
  if (name.includes("roster") || name.includes("student")) {
    return ["Missing roster", "Waiting on client", "Missing price sheet"];
  }
  if (name.includes("team") || name.includes("qr") || name.includes("barcode")) {
    return ["Missing team list", "Missing QR or barcode workflow", "Waiting on client"];
  }
  if (name.includes("photographer") || name.includes("capture") || name.includes("coverage")) {
    return ["Missing photographer assignment", "Missing call time", "Calendar conflict"];
  }
  if (task.phase === "Production") {
    return ["Missing production deadline", "Waiting on internal team", "Missing gallery or platform setup"];
  }
  if (task.phase === "Delivery") {
    return ["Client approval needed", "Waiting on client", "Gallery or delivery destination not confirmed"];
  }
  return ["Missing contact", "Missing location details", "Waiting on internal team"];
}

function defaultDueDateLogic(task: JobWorkflowTemplateTaskSeed) {
  if (task.dueDateLogic) {
    return task.dueDateLogic;
  }
  if (task.phase === "Planning") {
    return "Due before calendar confirmation.";
  }
  if (task.phase === "Scheduling") {
    return "Due before staffing can be treated as ready.";
  }
  if (task.phase === "Photography") {
    return "Due before shoot day or at day-of closeout.";
  }
  if (task.phase === "Production") {
    return "Due before client or gallery release deadline.";
  }
  return "Due before client follow-up can close the job.";
}

function enrichWorkflowTemplateTask(task: JobWorkflowTemplateTaskSeed, nextDepartment: string): JobWorkflowTemplateTask {
  const assignmentRuleType = assignmentRuleTypeForTask(task);
  return {
    ...task,
    assignmentRuleType,
    readinessChecks: defaultReadinessChecks(task),
    commonBlockers: defaultCommonBlockers(task),
    completionCriteria: task.completionCriteria ?? `${task.name} complete and ready for ${nextDepartment}.`,
    dueDateLogic: defaultDueDateLogic(task)
  };
}

function buildWorkflowTemplateDefinition(typeId: JobIntakeTypeId): JobWorkflowTemplateDefinition {
  const option = getJobIntakeTypeOption(typeId);
  const seeds = WORK_PACKAGE_TEMPLATE_SEEDS[typeId] ?? WORK_PACKAGE_TEMPLATE_SEEDS.school_picture_day;
  const defaultTasks = seeds.map((task, index) => enrichWorkflowTemplateTask(task, seeds[index + 1]?.ownerDepartment ?? "Closed"));
  const departmentsInvolved = uniqueValues(defaultTasks.map((task) => task.ownerDepartment));
  return {
    typeId,
    jobType: option.label,
    departmentsInvolved,
    handoffSequence: uniqueValues(["Intake", ...departmentsInvolved, "Closed"]),
    defaultTasks
  };
}

export const JOB_WORKFLOW_TEMPLATES: Record<JobIntakeTypeId, JobWorkflowTemplateDefinition> = JOB_INTAKE_TYPE_OPTIONS.reduce(
  (templates, option) => ({
    ...templates,
    [option.id]: buildWorkflowTemplateDefinition(option.id)
  }),
  {} as Record<JobIntakeTypeId, JobWorkflowTemplateDefinition>
);

export function getJobWorkflowTemplate(typeId: JobIntakeTypeId) {
  return JOB_WORKFLOW_TEMPLATES[typeId] ?? JOB_WORKFLOW_TEMPLATES.school_picture_day;
}

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
  return getJobWorkflowTemplate(typeId).defaultTasks;
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

function assignedPersonForPackage(
  index: number,
  currentIndex: number,
  workPackage: JobWorkflowTemplateTask,
  preview: JobRoutingPreviewSeed & { assignedPerson: string }
) {
  if (index < currentIndex) {
    return departmentLeadFor(workPackage.ownerDepartment);
  }
  if (workPackage.assignmentRuleType === "direct_owner") {
    return workPackage.directOwner ?? departmentLeadFor(workPackage.ownerDepartment);
  }
  if (workPackage.assignmentRuleType === "department_lead") {
    return departmentLeadFor(workPackage.ownerDepartment);
  }
  if (workPackage.assignmentRuleType === "role_fallback") {
    return departmentLeadFor(workPackage.fallbackDepartment ?? workPackage.ownerDepartment);
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
  const template = templateForRouting(typeId);
  return template.map((workPackage, index) => {
    const assignedPerson = assignedPersonForPackage(index, currentIndex, workPackage, preview);
    const assignmentState = assignedPerson === "Unassigned" ? "waiting_assignment" : "assigned";
    return {
      ...workPackage,
      id: `${typeId}:${workPackage.phase}`,
      assignmentRule: assignmentRuleLabel(workPackage.assignmentRuleType),
      assignedPerson,
      dueDateLabel: dueDateForPackage(index, currentIndex, preview),
      status: statusForPackage(index, currentIndex, {
        ...preview,
        assignedPerson,
        assignmentState
      }),
      handoffToDepartment: template[index + 1]?.ownerDepartment ?? "Closed"
    };
  });
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
  if (formState.department_type === "schools" && formState.school_profile.yearbook_required) {
    return "yearbook";
  }
  if (
    formState.department_type === "schools" &&
    formState.job_category === "event" &&
    formState.school_profile.special_instructions.toLowerCase().includes("cap-and-gown")
  ) {
    return "cap_and_gown";
  }
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
    if (formState.sports_profile.team_structure === "league_schedule") {
      return "sports_league";
    }
    return formState.sports_profile.specialty_products_required ? "sports_picture_day" : "team_photos";
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
  return `${option.routeLabel} starts as a draft intake. Review it, then launch the workflow when the package is ready.`;
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
  ownerName: string | null = null,
  intakeTypeOverride?: JobIntakeTypeId
): JobRoutingPreview {
  const typeId = intakeTypeOverride ?? inferJobIntakeTypeId(formState);
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

export function buildJobIntakeManagementSummary(formState: SharedJobFormState): JobIntakeManagementSummary {
  const items: JobIntakeReadinessItem[] = [
    {
      id: "organization",
      label: "Client organization",
      status: formState.organization_id ? "Ready" : "Missing",
      summary: formState.organization_id ? "Canonical organization selected." : "Choose an existing organization or capture draft client info."
    },
    {
      id: "contact",
      label: "Primary contact",
      status: formState.primary_contact_id || formState.contact_override_note.trim() ? "Ready" : "Missing",
      summary: formState.primary_contact_id ? "Canonical contact linked." : formState.contact_override_note.trim() ? "Draft contact note captured." : "Add the person who can answer job questions."
    },
    {
      id: "location",
      label: "Location",
      status: formState.primary_location_id || formState.location_override_note.trim() ? "Ready" : "Missing",
      summary: formState.primary_location_id ? "Canonical location linked." : formState.location_override_note.trim() ? "Draft location note captured." : "Add where the team should go."
    },
    {
      id: "schedule",
      label: "Shoot date",
      status: formState.scheduled_start_date ? "Ready" : "Review",
      summary: formState.scheduled_start_date ? `Requested for ${formatDate(formState.scheduled_start_date)}.` : "Requested date can be reviewed before calendar confirmation."
    },
    {
      id: "owner",
      label: "Current owner",
      status: formState.account_owner_user_id ? "Ready" : "Review",
      summary: formState.account_owner_user_id ? "Person owner selected." : "Department lead can assign a person during review."
    }
  ];
  const missingInfo = items.filter((item) => item.status !== "Ready");
  const readyInfo = items.filter((item) => item.status === "Ready");
  const hasHardMissing = missingInfo.some((item) => item.status === "Missing");
  return {
    reviewState: hasHardMissing ? "Missing Info" : missingInfo.length ? "Intake Review" : "Ready To Launch",
    readinessTone: hasHardMissing ? "critical" : missingInfo.length ? "warning" : "success",
    missingInfo,
    readyInfo,
    reviewAction: hasHardMissing ? "Request missing info" : "Approve intake",
    launchAction: hasHardMissing ? "Launch blocked until required info is captured" : "Launch workflow"
  };
}

export function buildJobIntakeManagementSummaryFromDetail(detail: SharedJobDetailResponse): JobIntakeManagementSummary {
  return buildJobIntakeManagementSummary({
    department_type: detail.job.department_type === "schools" ? "schools" : "sports",
    job_category: detail.job.job_category,
    organization_id: detail.job.organization_id ?? "",
    primary_location_id: detail.job.primary_location_id ?? "",
    primary_contact_id: detail.job.primary_contact_id ?? "",
    account_owner_user_id: detail.job.account_owner_user_id ?? "",
    title: detail.job.title ?? "",
    event_name: detail.job.event_name ?? "",
    description_internal: detail.job.description_internal ?? "",
    priority_level: detail.job.priority_level,
    delivery_type: detail.job.delivery_type ?? "",
    gallery_type: detail.job.gallery_type ?? "",
    scheduled_start_date: detail.summary.primary_day_date ?? detail.job.scheduled_start_at?.slice(0, 10) ?? "",
    setup_time: "",
    scheduled_start_time: "",
    scheduled_end_date: "",
    scheduled_end_time: "",
    timezone: detail.job.timezone,
    estimated_subject_count: detail.job.estimated_subject_count != null ? String(detail.job.estimated_subject_count) : "",
    estimated_staff_count: detail.job.estimated_staff_count != null ? String(detail.job.estimated_staff_count) : "",
    assistant_staff_count: "",
    client_deadline_at: detail.job.client_deadline_at?.slice(0, 10) ?? "",
    production_deadline_at: detail.job.production_deadline_at?.slice(0, 10) ?? "",
    production_required: detail.job.production_required,
    location_override_note: detail.job.location_override_note ?? "",
    contact_override_note: detail.job.contact_override_note ?? "",
    school_profile: {
      district_id: detail.school_profile?.district_id ?? "",
      school_type: detail.school_profile?.school_type ?? "",
      school_year: detail.school_profile?.school_year ?? "",
      grade_scope: detail.school_profile?.grade_scope ?? "",
      roster_source: detail.school_profile?.roster_source ?? "",
      id_cards_required: detail.school_profile?.id_cards_required ?? false,
      yearbook_required: detail.school_profile?.yearbook_required ?? false,
      composite_required: detail.school_profile?.composite_required ?? false,
      admin_portal_required: detail.school_profile?.admin_portal_required ?? false,
      submission_deadline: detail.school_profile?.submission_deadline ?? "",
      advisor_sorting_required: detail.school_profile?.advisor_sorting_required ?? false,
      homeroom_sorting_required: detail.school_profile?.homeroom_sorting_required ?? false,
      data_import_mode: detail.school_profile?.data_import_mode ?? "",
      special_instructions: detail.school_profile?.special_instructions ?? ""
    },
    sports_profile: {
      sport_type: detail.sports_profile?.sport_type ?? "",
      season: detail.sports_profile?.season ?? "",
      league_name: detail.sports_profile?.league_name ?? "",
      division: detail.sports_profile?.division ?? "",
      team_structure: detail.sports_profile?.team_structure ?? "",
      estimated_team_count: detail.sports_profile?.estimated_team_count != null ? String(detail.sports_profile.estimated_team_count) : "",
      proof_required: detail.sports_profile?.proof_required ?? false,
      approval_contact_id: detail.sports_profile?.approval_contact_id ?? "",
      billing_contact_id: detail.sports_profile?.billing_contact_id ?? "",
      revenue_share_enabled: detail.sports_profile?.revenue_share_enabled ?? false,
      revenue_share_terms_summary: detail.sports_profile?.revenue_share_terms_summary ?? "",
      banner_work_required: detail.sports_profile?.banner_work_required ?? false,
      specialty_products_required: detail.sports_profile?.specialty_products_required ?? false,
      buddy_photos_required: detail.sports_profile?.buddy_photos_required ?? false,
      sponsor_graphics_required: detail.sports_profile?.sponsor_graphics_required ?? false,
      client_expectations_notes: detail.sports_profile?.client_expectations_notes ?? ""
    },
    sports_setup: {
      indoor_outdoor: "",
      tethering: "",
      rain_location_required: false,
      rain_location_details: ""
    },
    days: []
  });
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
  if (detail.job.department_type === "schools" && detail.school_profile?.yearbook_required) {
    return "yearbook";
  }
  if (
    detail.job.department_type === "schools" &&
    detail.job.job_category === "event" &&
    detail.school_profile?.special_instructions?.toLowerCase().includes("cap-and-gown")
  ) {
    return "cap_and_gown";
  }
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
    if (detail.sports_profile?.specialty_products_required) {
      return "sports_picture_day";
    }
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
  if (text.includes("cap") && text.includes("gown")) {
    return "cap_and_gown";
  }
  if (text.includes("yearbook")) {
    return "yearbook";
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
  if (text.includes("sports picture") || text.includes("media day")) {
    return "sports_picture_day";
  }
  if (text.includes("sport") || text.includes("team")) {
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
    firstNextAction: row.queue_intelligence.next_action || "Open the job and choose the next action.",
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

function readinessToneClass(tone: IntakeReadinessTone) {
  return `job-intake-readiness--${tone}`;
}

function noticeToneClass(level: ChangeNoticeLevel) {
  return `job-change-notice--${level.toLowerCase()}`;
}

export function buildJobChangeNotices(detail: SharedJobDetailResponse): JobChangeNotice[] {
  const notices: JobChangeNotice[] = [];

  function addNotice(notice: JobChangeNotice) {
    if (!notices.some((existing) => existing.id === notice.id)) {
      notices.push(notice);
    }
  }

  const openFlags = detail.watch_flags.filter((flag) => !["resolved", "dismissed"].includes(flag.status));
  const resolvedFlags = detail.watch_flags.filter((flag) => flag.status === "resolved");
  const rosterItems = detail.readiness_items.filter((item) => {
    const text = `${item.label} ${item.section_key} ${item.source_template_key ?? ""}`.toLowerCase();
    return text.includes("roster") || text.includes("team list");
  });
  const openRosterItems = rosterItems.filter((item) => item.is_required && !item.is_complete);
  const resolvedRosterItems = rosterItems.filter((item) => item.is_complete);
  const leadAssignments = detail.staff_assignments.filter((assignment) => {
    const role = assignment.assignment_role.toLowerCase();
    return role.includes("lead") || role.includes("manager");
  });
  const activityText = detail.activity.map((entry) => `${entry.event_type} ${entry.action_label} ${entry.summary} ${entry.detail ?? ""}`.toLowerCase()).join(" ");

  if (detail.status.blocker_count > 0 || openFlags.length > 0) {
    addNotice({
      id: "blocker-added",
      level: "Urgent",
      title: "Blocker added",
      summary: `${detail.status.blocker_count || openFlags.length} active blocker or attention item${(detail.status.blocker_count || openFlags.length) === 1 ? "" : "s"} must be cleared before the next handoff.`
    });
  }
  if (resolvedFlags.length > 0 || activityText.includes("resolved")) {
    addNotice({
      id: "blocker-resolved",
      level: "Important",
      title: "Blocker resolved",
      summary: resolvedFlags[0]?.title ? `${resolvedFlags[0].title} was resolved. Confirm the next team can continue.` : "A blocker was resolved. Confirm the next team can continue."
    });
  }
  if (openRosterItems.length > 0) {
    addNotice({
      id: "roster-still-missing",
      level: "Urgent",
      title: openRosterItems[0]?.label.toLowerCase().includes("team") ? "Team list still missing" : "Roster still missing",
      summary: `${openRosterItems[0]?.label ?? "Roster"} is still open. The job should not move cleanly until this is cleared.`
    });
  } else if (resolvedRosterItems.length > 0) {
    addNotice({
      id: "roster-received",
      level: "FYI",
      title: resolvedRosterItems[0]?.label.toLowerCase().includes("team") ? "Team list received" : "Roster received",
      summary: `${resolvedRosterItems[0]?.label ?? "Roster"} is complete. Verify quality before the next department relies on it.`
    });
  }
  if (detail.job.scheduled_start_at || detail.summary.primary_day_date) {
    const date = detail.summary.primary_day_date ?? detail.job.scheduled_start_at?.slice(0, 10);
    addNotice({
      id: activityText.includes("date") || activityText.includes("schedule") ? "shoot-date-changed" : "date-confirmed",
      level: activityText.includes("date") || activityText.includes("schedule") ? "Important" : "FYI",
      title: activityText.includes("date") || activityText.includes("schedule") ? "Shoot date changed" : "Shoot date recorded",
      summary: date ? `Calendar is tracking ${formatDate(date)}. Confirm staffing and downstream deadlines still line up.` : "Calendar is tracking this job."
    });
  }
  if (detail.days.some((day) => day.start_time || day.end_time) || activityText.includes("call time")) {
    addNotice({
      id: "call-time-changed",
      level: activityText.includes("call time") ? "Important" : "FYI",
      title: activityText.includes("call time") ? "Call time changed" : "Call time recorded",
      summary: "Review day timing before confirming staffing, travel, or client communication."
    });
  }
  if (detail.job.primary_location_id || detail.summary.primary_location_name) {
    addNotice({
      id: activityText.includes("location") ? "location-changed" : "location-linked",
      level: activityText.includes("location") ? "Important" : "FYI",
      title: activityText.includes("location") ? "Location changed" : "Location linked",
      summary: detail.summary.primary_location_name ? `${detail.summary.primary_location_name} is connected to this job. Confirm travel and setup notes still match.` : "A canonical location is connected to this job."
    });
  }
  if (detail.job.primary_contact_id || detail.summary.primary_contact_name || activityText.includes("contact")) {
    addNotice({
      id: "contact-changed",
      level: activityText.includes("contact") ? "Important" : "FYI",
      title: activityText.includes("contact") ? "Primary contact changed" : "Primary contact recorded",
      summary: detail.summary.primary_contact_name ? `${detail.summary.primary_contact_name} is the current contact. Use this before sending confirmations.` : "A primary contact is connected to this job."
    });
  }
  if (detail.job.priority_level === "urgent" || detail.job.priority_level === "high" || activityText.includes("priority")) {
    addNotice({
      id: "priority-changed",
      level: detail.job.priority_level === "urgent" ? "Urgent" : "Important",
      title: activityText.includes("priority") ? "Priority changed" : "Priority needs attention",
      summary: `${humanizeToken(detail.job.priority_level)} priority is active. Confirm owner and next action today.`
    });
  }
  if (detail.job.client_deadline_at || detail.job.production_deadline_at || activityText.includes("deadline")) {
    const deadline = detail.job.client_deadline_at?.slice(0, 10) ?? detail.job.production_deadline_at?.slice(0, 10);
    addNotice({
      id: "gallery-deadline-changed",
      level: "Important",
      title: activityText.includes("deadline") ? "Gallery deadline changed" : "Gallery deadline recorded",
      summary: deadline ? `Delivery timing is tracking ${formatDate(deadline)}. Confirm Production and Client Success can still meet it.` : "Delivery timing is attached to this job."
    });
  }
  if (leadAssignments.length > 0 || detail.summary.lead_owner_name) {
    addNotice({
      id: "shoot-manager-assigned",
      level: "FYI",
      title: "Shoot manager assigned",
      summary: `${leadAssignments[0]?.user_name ?? detail.summary.lead_owner_name ?? "A shoot manager"} is attached to the job. Use that person as the day-of escalation point.`
    });
  } else {
    addNotice({
      id: "shoot-manager-needed",
      level: "Important",
      title: "Shoot manager still needed",
      summary: "Assign the day-of owner before calling the job ready."
    });
  }
  for (const entry of detail.activity.slice(0, 3)) {
    const entryText = `${entry.event_type} ${entry.action_label} ${entry.summary}`.toLowerCase();
    if (entryText.includes("publish") || entryText.includes("launch")) {
      addNotice({
        id: `job-launched-${entry.id}`,
        level: "FYI",
        title: "Job launched",
        summary: `${entry.summary} The route is ready for department follow-through.`
      });
      continue;
    }
    if (entryText.includes("assignment") || entryText.includes("reassign")) {
      addNotice({
        id: `task-reassigned-${entry.id}`,
        level: entry.tone === "danger" ? "Urgent" : "Important",
        title: "Task reassigned",
        summary: `${entry.summary} Confirm the new owner knows the next action.`
      });
      continue;
    }
    addNotice({
      id: `activity-${entry.id}`,
      level: entry.tone === "danger" ? "Urgent" : entry.tone === "warning" ? "Important" : "FYI",
      title: entry.action_label || "Latest change",
      summary: entry.summary
    });
  }
  if (!notices.length) {
    notices.push({
      id: "intake-created",
      level: "FYI",
      title: "Intake package created",
      summary: "No urgent changes are attached to this job yet."
    });
  }
  const levelRank: Record<ChangeNoticeLevel, number> = { Urgent: 0, Important: 1, FYI: 2 };
  return notices.sort((a, b) => levelRank[a.level] - levelRank[b.level]).slice(0, 6);
}

export function JobIntakeReadinessPanel({ summary }: { summary: JobIntakeManagementSummary }) {
  const missingCount = summary.missingInfo.length;
  return (
    <section className={`job-intake-readiness ${readinessToneClass(summary.readinessTone)}`} aria-label="Intake readiness">
      <div className="job-intake-readiness__header">
        <div>
          <strong>Intake Readiness</strong>
          <span>Review the job setup before preparing department work.</span>
        </div>
        <span>{summary.reviewState}</span>
      </div>
      <div className="job-intake-readiness__actions">
        <span>{missingCount ? `${missingCount} missing or review item${missingCount === 1 ? "" : "s"}` : "Ready for review"}</span>
        <strong>{summary.reviewAction}</strong>
      </div>
      <div className="job-intake-readiness__list">
        {[...summary.missingInfo, ...summary.readyInfo].slice(0, 5).map((item) => (
          <article key={item.id}>
            <span className={`job-intake-readiness__dot job-intake-readiness__dot--${item.status.toLowerCase()}`} />
            <div>
              <strong>{item.label}</strong>
              <small>{item.summary}</small>
            </div>
            <em>{item.status}</em>
          </article>
        ))}
      </div>
    </section>
  );
}

export function JobDepartmentTaskPlan({ preview, compact = false }: { preview: JobRoutingPreview; compact?: boolean }) {
  const packages = compact ? preview.workPackages.slice(0, 4) : preview.workPackages;
  return (
    <section className={`job-department-task-plan${compact ? " job-department-task-plan--compact" : ""}`} aria-label="Department task plan">
      <div className="job-work-packages__header">
        <div>
          <strong>Department Handoff Plan</strong>
          <span>Prepared from the job type. Assignments stay clear until the job is launched.</span>
        </div>
        <span>{preview.workflowRouteLabel}</span>
      </div>
      <div className="job-department-task-plan__list">
        {packages.map((workPackage) => (
          <article key={`task-plan:${workPackage.id}`}>
            <div>
              <span>{workPackage.phase}</span>
              <strong>{workPackage.name}</strong>
              <small>{workPackage.summary}</small>
              <small>Complete when: {workPackage.completionCriteria}</small>
            </div>
            <div>
              <span>{workPackage.ownerDepartment}</span>
              <strong>{workPackage.assignedPerson}</strong>
              <small>{workPackage.assignmentRule}</small>
              <small>Checks: {workPackage.readinessChecks.slice(0, 2).join(" ")}</small>
            </div>
            <span className={`job-work-package__status job-work-package__status--${packageStatusClass(workPackage.status)}`}>{workPackage.status}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

export function JobChangeNoticesPanel({ notices }: { notices: JobChangeNotice[] }) {
  return (
    <section className="job-change-notices" aria-label="Job change notices">
      <div className="job-work-packages__header">
        <div>
          <strong>Changes and Notices</strong>
          <span>Important movement since the last handoff.</span>
        </div>
        <span>{notices.length} notice{notices.length === 1 ? "" : "s"}</span>
      </div>
      <div className="job-change-notices__list">
        {notices.map((notice) => (
          <article key={notice.id} className={`job-change-notice ${noticeToneClass(notice.level)}`}>
            <span>{notice.level}</span>
            <div>
              <strong>{notice.title}</strong>
              <small>{notice.summary}</small>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
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
              <small>{workPackage.summary}</small>
            </div>
            <div className="job-work-package__meta">
              <span>{workPackage.ownerDepartment}</span>
              <span>{workPackage.assignedPerson}</span>
              <span>{workPackage.dueDateLabel}</span>
              <span>{workPackage.assignmentRule}</span>
            </div>
            <span className={`job-work-package__status job-work-package__status--${packageStatusClass(workPackage.status)}`}>
              {workPackage.status}
            </span>
            <div className="job-work-package__details">
              <span>Readiness: {workPackage.readinessChecks.slice(0, 2).join(" ")}</span>
              <span>Common blockers: {workPackage.commonBlockers.slice(0, 3).join(", ")}</span>
              <span>Complete when: {workPackage.completionCriteria}</span>
            </div>
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
      <JobDepartmentTaskPlan preview={preview} compact />
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
