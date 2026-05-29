// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductionProjects } from "../pages/ProductionProjects";
import type {
  ProductionProjectBoardResponse,
  ProductionProjectDetail,
  ProductionProjectEventRecord,
  ProductionProjectHealthSignal,
  ProductionProjectIntakeIssue,
  ProductionProjectJobType,
  ProductionProjectOwnershipState,
  ProductionProjectQaState,
  ProductionProjectQueueId,
  ProductionProjectReferenceData,
  ProductionProjectReleaseState,
  ProductionProjectReviewRecord,
  ProductionProjectStage,
  ProductionProjectSummaryRecord,
  ProductionProjectTaskEventRecord,
  ProductionProjectTaskHandoffRecord,
  ProductionProjectTaskRecord,
  ProductionProjectTeamOwner,
  ProductionProjectTemplateRecord,
  ProductionProjectWorkflowSummary,
  SessionUser
} from "../types";

const apiFetchMock = vi.fn();
const getProjectWorkflowCommandCenterMock = vi.fn();

vi.mock("../api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  apiUrl: "http://localhost:4000"
}));

vi.mock("../services/projectTracking", () => ({
  getProjectWorkflowCommandCenter: (...args: unknown[]) => getProjectWorkflowCommandCenterMock(...args)
}));

const leadershipUser: SessionUser = {
  id: "user-leadership",
  tenantId: "tenant-demo",
  accountId: "account-leadership",
  sessionId: "session-demo",
  email: "leadership@example.com",
  fullName: "Demo Leadership",
  status: "active",
  department: "operations",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["leadership"],
  permissions: ["dashboard.read", "shoot.read", "schedule.read", "schedule.manage"],
  authorityTier: "leadership",
  primaryJobFunctionProfile: "leadership_team_member",
  jobFunctionProfiles: ["leadership_team_member"],
  permissionGrants: [],
  effectiveScopes: ["organization_wide_scope"],
  sessionTrust: {
    identityProvider: "local_password",
    sessionAssurance: "standard",
    requestTransport: "bearer",
    elevatedUntil: null,
    privilegedModeUntil: null,
    breakGlassStartedAt: null,
    breakGlassUntil: null,
    breakGlassReason: null,
    breakGlassScopeType: null,
    breakGlassScopeId: null,
    elevatedSessionActive: false,
    privilegedModeActive: false,
    breakGlassModeActive: false
  }
};

const productionStaffUser: SessionUser = {
  ...leadershipUser,
  id: "user-production-staff",
  accountId: "account-production-staff",
  sessionId: "session-production-staff",
  email: "production.staff@example.com",
  fullName: "Demo Production Artist",
  department: "production",
  roles: ["production_staff"],
  permissions: ["project.read", "projects.read", "production.view", "production_projects.view"],
  authorityTier: "standard_employee",
  primaryJobFunctionProfile: "graphic_artist",
  jobFunctionProfiles: ["graphic_artist"]
};

function labelForJobType(jobType: ProductionProjectJobType) {
  switch (jobType) {
    case "sports_production":
      return "Sports Production";
    case "specialty_graphics":
      return "Specialty / Graphics";
    case "banner_specialty_product":
      return "Banner / Specialty Product";
    case "gallery_prep_upload":
      return "Gallery Prep / Upload";
    case "qa_final_review":
      return "QA / Final Review";
    case "correction_rework":
      return "Correction / Rework";
    default:
      return "Standard School Production";
  }
}

function labelForStage(stage: ProductionProjectStage) {
  switch (stage) {
    case "ready_for_production":
      return "Ready for Production";
    case "in_production":
      return "In Production";
    case "blocked":
      return "Blocked";
    case "ready_for_qa":
      return "Ready for QA";
    case "in_qa_review":
      return "In QA Review";
    case "correction_needed":
      return "Correction Needed";
    case "ready_to_release":
      return "Ready to Release";
    case "released_complete":
      return "Released / Complete";
    case "on_hold":
      return "On Hold";
    case "cancelled":
      return "Cancelled";
    default:
      return "Intake Pending";
  }
}

function deriveQaState(stage: ProductionProjectStage): ProductionProjectQaState {
  switch (stage) {
    case "ready_for_qa":
      return "ready_for_qa";
    case "in_qa_review":
      return "in_qa_review";
    case "correction_needed":
      return "correction_needed";
    case "ready_to_release":
    case "released_complete":
      return "passed";
    default:
      return "not_started";
  }
}

function labelForQaState(state: ProductionProjectQaState) {
  switch (state) {
    case "ready_for_qa":
      return "Ready for QA";
    case "in_qa_review":
      return "In QA Review";
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "correction_needed":
      return "Correction Needed";
    case "peer_review_required":
      return "Peer Review Required";
    case "final_review_required":
      return "Final Review Required";
    default:
      return "Not Started";
  }
}

function deriveReleaseState(stage: ProductionProjectStage): ProductionProjectReleaseState {
  switch (stage) {
    case "ready_to_release":
      return "ready_to_release";
    case "released_complete":
      return "released";
    default:
      return "not_ready";
  }
}

function labelForReleaseState(state: ProductionProjectReleaseState) {
  switch (state) {
    case "ready_to_release":
      return "Ready to Release";
    case "released":
      return "Released";
    default:
      return "Not Ready";
  }
}

function deriveTeamOwner(stage: ProductionProjectStage): ProductionProjectTeamOwner {
  switch (stage) {
    case "ready_for_qa":
    case "in_qa_review":
    case "correction_needed":
      return "qa";
    case "ready_to_release":
    case "released_complete":
      return "release";
    default:
      return "production";
  }
}

function labelForTeamOwner(teamOwner: ProductionProjectTeamOwner) {
  switch (teamOwner) {
    case "graphics":
      return "Graphics";
    case "upload":
      return "Upload";
    case "qa":
      return "QA";
    case "release":
      return "Release";
    case "corrections":
      return "Corrections";
    default:
      return "Production";
  }
}

function prioritySortWeight(priority: ProductionProjectSummaryRecord["priority"]) {
  switch (priority) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "normal":
      return 2;
    default:
      return 3;
  }
}

function compareNullableNumber(left: number | null, right: number | null) {
  return (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER);
}

function leadBoardAttentionWeight(project: ProductionProjectSummaryRecord) {
  if (project.overdue || project.overdue_task_count > 0) {
    return 0;
  }
  if (project.stage === "blocked" || project.blocker_count > 0 || project.blocked_task_count > 0) {
    return 1;
  }
  if (project.corrections_needed) {
    return 2;
  }
  if (project.stale_active) {
    return 3;
  }
  if (project.due_within_24_hours) {
    return 4;
  }
  if (project.ready_to_send) {
    return 5;
  }
  if (project.waiting_to_send) {
    return 6;
  }
  return 7 + prioritySortWeight(project.priority);
}

function deriveOwnershipState(
  status: ProductionProjectSummaryRecord["status"],
  ownerUserId: string | null,
  stage: ProductionProjectStage
): ProductionProjectOwnershipState {
  if (status === "completed" || stage === "released_complete") {
    return "complete";
  }
  if (!ownerUserId) {
    return "unassigned";
  }
  if (stage === "ready_for_qa" || stage === "in_qa_review") {
    return "waiting_review";
  }
  if (stage === "correction_needed") {
    return "returned_for_correction";
  }
  return "in_progress";
}

function labelForOwnershipState(state: ProductionProjectOwnershipState) {
  switch (state) {
    case "assigned":
      return "Assigned";
    case "in_progress":
      return "In Progress";
    case "waiting_review":
      return "Waiting Review";
    case "returned_for_correction":
      return "Returned for Correction";
    case "complete":
      return "Complete";
    default:
      return "Unassigned";
  }
}

function labelForHealthSignal(signal: ProductionProjectHealthSignal) {
  switch (signal) {
    case "due_soon":
      return "Due Soon";
    case "overdue":
      return "Overdue";
    case "blocked":
      return "Blocked";
    case "release_risk":
      return "Release Risk";
    case "fragile":
      return "Fragile";
    case "escalated":
      return "Escalated";
    default:
      return "Healthy";
  }
}

function labelForWorkflowFamily(value: ProductionProjectTemplateRecord["workflow_family"]) {
  switch (value) {
    case "schools":
      return "Schools";
    case "sports":
      return "Sports";
    default:
      return "General";
  }
}

function labelForWorkflowMode(value: ProductionProjectTemplateRecord["workflow_mode"]) {
  switch (value) {
    case "manual_follow_up":
      return "Manual Follow-Up";
    case "post_shoot_wrap":
      return "Post-Shoot Wrap";
    case "digital_delivery":
      return "Digital Delivery";
    case "issue_remediation":
      return "Issue Remediation";
    case "resource_follow_up":
      return "Resource Follow-Up";
    default:
      return value;
  }
}

function labelForSeason(value: ProductionProjectTemplateRecord["season_key"]) {
  switch (value) {
    case "spring":
      return "Spring";
    case "fall":
      return "Fall";
    default:
      return "All Year";
  }
}

function labelForTaskType(taskType: ProductionProjectTaskRecord["task_type"]) {
  switch (taskType) {
    case "peer_review":
      return "Peer Review";
    case "final_qc":
      return "Final QC";
    case "release":
      return "Release";
    case "handoff":
      return "Handoff";
    case "rework":
      return "Rework";
    default:
      return "Production";
  }
}

function createProjectRecord(
  overrides: Partial<ProductionProjectSummaryRecord> & Pick<ProductionProjectSummaryRecord, "id" | "title">
): ProductionProjectSummaryRecord {
  const stage = overrides.stage ?? "intake_pending";
  const status = overrides.status ?? "new";
  const jobType = overrides.job_type ?? "standard_school_production";
  const qaState = overrides.qa_state ?? deriveQaState(stage);
  const releaseState = overrides.release_state ?? deriveReleaseState(stage);
  const teamOwner = overrides.team_owner ?? deriveTeamOwner(stage);
  const ownerUserId = overrides.owner_user_id ?? null;
  const overdue = overrides.overdue ?? (overrides.overdue_task_count ?? 0) > 0;
  const dueWithin24Hours = overrides.due_within_24_hours ?? (!overdue && overrides.due_date === "2026-03-29");
  const ownershipState = overrides.ownership_state ?? deriveOwnershipState(status, ownerUserId, stage);
  const healthSignal =
    overrides.health_signal ??
    (stage === "blocked"
      ? "blocked"
      : stage === "ready_to_release"
        ? "release_risk"
        : overdue
          ? "overdue"
          : dueWithin24Hours
            ? "due_soon"
          : !ownerUserId
            ? "fragile"
            : "healthy");
  const latestNote = overrides.latest_note ?? null;
  const linkedShootDate = overrides.linked_shoot_date ?? null;
  const linkedShootDateLabel = overrides.linked_shoot_date_label ?? (linkedShootDate ? "Mar 28" : null);
  const linkedShootTypeLabel = overrides.linked_shoot_type_label ?? null;
  const correctionsNeeded = overrides.corrections_needed ?? stage === "correction_needed";
  const waitingToSend = overrides.waiting_to_send ?? stage === "ready_to_release";
  const readyToSend = overrides.ready_to_send ?? (stage === "ready_to_release" && !correctionsNeeded && !(overrides.current_blocker ?? null));
  const workflowFamily = overrides.workflow_family ?? "general";
  const workflowMode = overrides.workflow_mode ?? "manual_follow_up";
  const seasonKey = overrides.season_key ?? "all_year";
  const currentStepLabel = overrides.current_step_label ?? labelForStage(stage);
  const currentStepTaskType = overrides.current_step_task_type ?? null;
  const productionCanTouch =
    overrides.production_can_touch ??
    (stage === "in_production" || stage === "ready_for_qa" || stage === "in_qa_review" || stage === "correction_needed" || stage === "ready_to_release");
  const productionTouchReasons =
    overrides.production_touch_reasons ??
    (productionCanTouch
      ? ["Workflow gates are clear enough for production to act."]
      : stage === "intake_pending"
        ? ["Waiting for intake handoff before production starts."]
        : stage === "blocked"
          ? ["Blocked work needs outside resolution before production can continue."]
          : ["This job is waiting on the current workflow condition to change."]);
  const staleActive = overrides.stale_active ?? false;
  const linkedOrganizationName = overrides.linked_organization_name ?? null;
  const contextLabel =
    overrides.context_label ??
    [linkedOrganizationName, linkedShootTypeLabel ?? labelForJobType(jobType)].filter(Boolean).join(" | ");

  const base = {
    id: overrides.id,
    title: overrides.title,
    template_id: null,
    template_key: null,
    template_name: null,
    workflow_family: workflowFamily,
    workflow_family_label: labelForWorkflowFamily(workflowFamily),
    workflow_mode: workflowMode,
    workflow_mode_label: labelForWorkflowMode(workflowMode),
    season_key: seasonKey,
    season_label: labelForSeason(seasonKey),
    summary: null,
    status,
    job_type: jobType,
    job_type_label: labelForJobType(jobType),
    category: "digital_production",
        category_label: "Post-Shoot Production",
    stage,
    stage_label: labelForStage(stage),
    current_step_key: null,
    current_step_label: currentStepLabel,
    current_step_task_type: currentStepTaskType,
    current_step_task_type_label: currentStepTaskType ? labelForTaskType(currentStepTaskType) : null,
    current_step_order: null,
    qa_state: qaState,
    qa_state_label: labelForQaState(qaState),
    release_state: releaseState,
    release_state_label: labelForReleaseState(releaseState),
    health_signal: healthSignal,
    health_signal_label: labelForHealthSignal(healthSignal),
    ownership_state: ownershipState,
    ownership_state_label: labelForOwnershipState(ownershipState),
    team_owner: teamOwner,
    team_owner_label: labelForTeamOwner(teamOwner),
    priority: "normal",
    owner_user_id: ownerUserId,
    owner_label: ownerUserId === leadershipUser.id ? leadershipUser.fullName : ownerUserId ? "Assigned Owner" : "Owner unassigned",
    peer_review_required: false,
    final_qc_required: false,
    peer_reviewer_user_id: null,
    peer_reviewer_label: null,
    final_qc_reviewer_user_id: null,
    final_qc_reviewer_label: null,
    due_date: null,
    due_label: null,
    follow_up_date: null,
    follow_up_label: null,
    snoozed_until: null,
    latest_note: null,
    source_type: "manual",
    source_trigger_key: null,
    source_trigger_label: null,
    created_reason: "Created directly in Production.",
    linked_organization_id: null,
    linked_organization_name: null,
    linked_location_id: null,
    linked_location_name: null,
    linked_shoot_id: null,
    linked_shoot_date: null,
    linked_shoot_date_label: null,
    linked_shoot_code: null,
    linked_shoot_title: null,
    linked_shoot_type_label: null,
    linked_shoot_importance_tier: null,
    linked_shoot_importance_label: null,
    shoot_photographer_count: 0,
    shoot_camera_station_count: 0,
    context_label: null,
    open_task_count: 0,
    completed_task_count: 0,
    overdue_task_count: 0,
    blocker_count: 0,
    current_blocker: null,
    due_within_24_hours: dueWithin24Hours,
    overdue,
    next_action: "Assign an owner and confirm the kickoff path.",
    status_tone: "info",
    flags: [],
    stale_active: false,
    stale_label: null,
    last_touched_label: "Touched Mar 28",
    has_latest_note: false,
    corrections_needed: false,
    waiting_to_send: false,
    ready_to_send: false,
    production_can_touch: false,
    production_touch_label: "Waiting on workflow",
    production_touch_reasons: [],
    created_at: "2026-03-28T12:00:00.000Z",
    updated_at: "2026-03-28T12:00:00.000Z",
    completed_at: null
  };

  return {
    ...base,
    ...overrides,
    workflow_family: workflowFamily,
    workflow_family_label: overrides.workflow_family_label ?? labelForWorkflowFamily(workflowFamily),
    workflow_mode: workflowMode,
    workflow_mode_label: overrides.workflow_mode_label ?? labelForWorkflowMode(workflowMode),
    season_key: seasonKey,
    season_label: overrides.season_label ?? labelForSeason(seasonKey),
    stage,
    stage_label: overrides.stage_label ?? labelForStage(stage),
    current_step_label: currentStepLabel,
    current_step_task_type: currentStepTaskType,
    current_step_task_type_label:
      overrides.current_step_task_type_label ?? (currentStepTaskType ? labelForTaskType(currentStepTaskType) : null),
    job_type: jobType,
    job_type_label: overrides.job_type_label ?? labelForJobType(jobType),
    qa_state: qaState,
    qa_state_label: overrides.qa_state_label ?? labelForQaState(qaState),
    release_state: releaseState,
    release_state_label: overrides.release_state_label ?? labelForReleaseState(releaseState),
    health_signal: healthSignal,
    health_signal_label: overrides.health_signal_label ?? labelForHealthSignal(healthSignal),
    ownership_state: ownershipState,
    ownership_state_label: overrides.ownership_state_label ?? labelForOwnershipState(ownershipState),
    team_owner: teamOwner,
    team_owner_label: overrides.team_owner_label ?? labelForTeamOwner(teamOwner),
    owner_user_id: ownerUserId,
    owner_label:
      overrides.owner_label ??
      (ownerUserId === leadershipUser.id ? leadershipUser.fullName : ownerUserId ? "Assigned Owner" : "Owner unassigned"),
    latest_note: latestNote,
    linked_shoot_date: linkedShootDate,
    linked_shoot_date_label: linkedShootDateLabel,
    linked_shoot_type_label: linkedShootTypeLabel,
    shoot_photographer_count: overrides.shoot_photographer_count ?? 0,
    shoot_camera_station_count: overrides.shoot_camera_station_count ?? 0,
    context_label: contextLabel || null,
    due_within_24_hours: dueWithin24Hours,
    overdue,
    blocker_count: overrides.blocker_count ?? (overrides.current_blocker ? 1 : 0),
    stale_active: staleActive,
    stale_label: overrides.stale_label ?? (staleActive ? "Stale 4 days" : null),
    last_touched_label: overrides.last_touched_label ?? "Touched Mar 28",
    has_latest_note: overrides.has_latest_note ?? Boolean(latestNote),
    corrections_needed: correctionsNeeded,
    waiting_to_send: waitingToSend,
    ready_to_send: readyToSend,
    production_can_touch: productionCanTouch,
    production_touch_label: overrides.production_touch_label ?? (productionCanTouch ? "Production can work this now" : "Waiting on workflow"),
    production_touch_reasons: productionTouchReasons
  } as ProductionProjectSummaryRecord;
}

function createProjectHarness() {
  const templates: ProductionProjectTemplateRecord[] = [
    {
      id: "template-1",
      template_key: "manual_production_follow_up",
      name: "Manual Production Follow-Up",
      description: "One-off follow-up work with a simple checklist.",
      workflow_family: "general",
      workflow_family_label: "General",
      workflow_mode: "manual_follow_up",
      workflow_mode_label: "Manual Follow-Up",
      season_key: "all_year",
      season_label: "All Year",
      default_priority: "normal",
      job_type: "standard_school_production",
      job_type_label: "Standard School Production",
      category: "production_follow_up",
      category_label: "Production Follow-Up",
      default_stage: "intake_pending",
      default_stage_label: "Intake Pending",
      peer_review_required: false,
      final_qc_required: false,
      task_count: 2,
      tasks: [
        {
          id: "template-task-1",
          task_key: "confirm_scope",
          title: "Confirm production scope",
          summary: "Make sure the production handoff is complete.",
          due_offset_days: 0,
          required: true,
          sort_order: 0,
          task_type: "production",
          task_type_label: "Production",
          handoff_required: false,
          blocks_release: false,
          dependency_task_keys: []
        },
        {
          id: "template-task-2",
          task_key: "close_loop",
          title: "Close the follow-up loop",
          summary: "Capture the result and next step.",
          due_offset_days: 2,
          required: false,
          sort_order: 1,
          task_type: "handoff",
          task_type_label: "Handoff",
          handoff_required: true,
          blocks_release: false,
          dependency_task_keys: ["confirm_scope"]
        }
      ]
    }
  ];

  const referenceData: ProductionProjectReferenceData = {
    generated_at: "2026-03-28T12:00:00.000Z",
    owners: [{ id: leadershipUser.id, label: leadershipUser.fullName, detail: "Leadership owner" }],
    organizations: [
      { id: "org-1", label: "White Bear Lake High School", detail: "School account" },
      { id: "org-2", label: "North Metro Athletics", detail: "Athletics account" }
    ],
    locations: [
      {
        id: "location-1",
        organization_id: "org-1",
        organization_label: "White Bear Lake High School",
        label: "South Gym",
        detail: "White Bear Lake High School"
      },
      {
        id: "location-2",
        organization_id: "org-2",
        organization_label: "North Metro Athletics",
        label: "North Metro Stadium",
        detail: "North Metro Athletics"
      }
    ],
    shoots: [
      {
        id: "shoot-1",
        organization_id: "org-1",
        organization_label: "White Bear Lake High School",
        location_id: "location-1",
        location_label: "South Gym",
        label: "DEMO-001 · Spring Portrait Day",
        shoot_code: "DEMO-001",
        detail: "South Gym"
      },
      {
        id: "shoot-2",
        organization_id: "org-2",
        organization_label: "North Metro Athletics",
        location_id: "location-2",
        location_label: "North Metro Stadium",
        label: "DEMO-002 · Friday Night Lights Media Day",
        shoot_code: "DEMO-002",
        detail: "North Metro Stadium"
      }
    ],
    source_triggers: [
      { key: "shoot_completed_post_production", label: "Shoot completed trigger" },
      { key: "post_shoot_issue_flagged", label: "Post-shoot issue trigger" }
    ]
  };

  let projects: ProductionProjectSummaryRecord[] = [
    createProjectRecord({
      id: "project-1",
      template_id: "template-1",
      template_key: "post_shoot_production_wrap",
      template_name: "Post-Shoot Production Wrap",
      workflow_family: "schools",
      workflow_family_label: "Schools",
      workflow_mode: "post_shoot_wrap",
      workflow_mode_label: "Post-Shoot Wrap",
      season_key: "spring",
      season_label: "Spring",
      title: "Post-Shoot Production Wrap",
      summary: "Shoot just completed and production kickoff is waiting.",
      status: "new",
      job_type: "standard_school_production",
      category: "photography_production",
      category_label: "Photography Production",
      stage: "intake_pending",
      priority: "high",
      owner_user_id: null,
      peer_review_required: true,
      final_qc_required: true,
      peer_reviewer_user_id: null,
      peer_reviewer_label: null,
      final_qc_reviewer_user_id: null,
      final_qc_reviewer_label: null,
      due_date: "2026-03-28",
      due_label: "Overdue since Mar 28",
      follow_up_date: null,
      follow_up_label: null,
      snoozed_until: null,
      latest_note: null,
      source_type: "trigger",
      source_trigger_key: "shoot_completed_post_production",
      source_trigger_label: "Shoot completed trigger",
      created_reason: "Created when the shoot moved into complete status.",
      linked_organization_id: "org-1",
      linked_organization_name: "White Bear Lake High School",
      linked_location_id: "location-1",
      linked_location_name: "South Gym",
      linked_shoot_id: "shoot-1",
      linked_shoot_date: "2026-03-27",
      linked_shoot_date_label: "Mar 27",
      linked_shoot_code: "DEMO-001",
      linked_shoot_title: "Spring Portrait Day",
      linked_shoot_type_label: "School portrait",
      linked_shoot_importance_tier: "elevated",
      linked_shoot_importance_label: "Elevated",
      shoot_photographer_count: 3,
      shoot_camera_station_count: 2,
      context_label: "White Bear Lake High School | School portrait",
      current_step_key: "review_uploads",
      current_step_label: "Review upload package",
      current_step_task_type: "production",
      current_step_task_type_label: "Production",
      current_step_order: 0,
      open_task_count: 1,
      completed_task_count: 0,
      overdue_task_count: 1,
      overdue: true,
      due_within_24_hours: false,
      next_action: "Assign owner and confirm the production kickoff.",
      status_tone: "warning",
      stale_active: true,
      stale_label: "Stale 4 days",
      last_touched_label: "Last touched 4 days ago",
      production_can_touch: false,
      production_touch_label: "Waiting on intake",
      production_touch_reasons: ["Cards have not been handed off into production yet."],
      flags: [
        { label: "Owner missing", tone: "warning" },
        { label: "Triggered from shoot completion", tone: "info" }
      ],
      created_at: "2026-03-28T09:00:00.000Z",
      updated_at: "2026-03-24T09:00:00.000Z",
      completed_at: null
    }),
    createProjectRecord({
      id: "project-2",
      template_id: "template-1",
      template_key: "post_shoot_issue_remediation",
      template_name: "Issue Remediation Review",
      workflow_family: "general",
      workflow_family_label: "General",
      workflow_mode: "issue_remediation",
      workflow_mode_label: "Issue Remediation",
      season_key: "all_year",
      season_label: "All Year",
      title: "Issue Remediation Review",
      summary: "A post-shoot issue still needs production follow-up.",
      status: "active",
      job_type: "correction_rework",
      category: "remediation",
      category_label: "Remediation",
      stage: "correction_needed",
      priority: "high",
      owner_user_id: "user-leadership",
      peer_review_required: false,
      final_qc_required: false,
      peer_reviewer_user_id: null,
      peer_reviewer_label: null,
      final_qc_reviewer_user_id: null,
      final_qc_reviewer_label: null,
      due_date: "2026-03-30",
      due_label: "Due Mar 30",
      follow_up_date: "2026-03-29",
      follow_up_label: "Due Mar 29",
      snoozed_until: null,
      latest_note: "Waiting for a confirmation from production.",
      source_type: "trigger",
      source_trigger_key: "post_shoot_issue_flagged",
      source_trigger_label: "Post-shoot issue trigger",
      created_reason: "Created because the post-shoot evaluation flagged remediation work.",
      linked_organization_id: "org-2",
      linked_organization_name: "North Metro Athletics",
      linked_location_id: "location-2",
      linked_location_name: "North Metro Stadium",
      linked_shoot_id: "shoot-2",
      linked_shoot_date: "2026-03-29",
      linked_shoot_date_label: "Mar 29",
      linked_shoot_code: "DEMO-002",
      linked_shoot_title: "Friday Night Lights Media Day",
      linked_shoot_type_label: "Sports media day",
      linked_shoot_importance_tier: "big_shoot",
      linked_shoot_importance_label: "Big Shoot",
      shoot_photographer_count: 4,
      shoot_camera_station_count: 3,
      context_label: "North Metro Athletics | Sports media day",
      current_step_key: "review_issue",
      current_step_label: "Confirm issue resolution",
      current_step_task_type: "rework",
      current_step_task_type_label: "Rework",
      current_step_order: 0,
      open_task_count: 1,
      completed_task_count: 1,
      overdue_task_count: 0,
      due_within_24_hours: false,
      overdue: false,
      next_action: "Clear corrections and move the job back through QA.",
      status_tone: "info",
      corrections_needed: true,
      has_latest_note: true,
      production_can_touch: true,
      production_touch_label: "Production can work this now",
      production_touch_reasons: ["Corrections are back with production and ready to be addressed."],
      flags: [{ label: "Follow-up due", tone: "warning" }],
      created_at: "2026-03-28T08:00:00.000Z",
      updated_at: "2026-03-28T10:00:00.000Z",
      completed_at: null
    })
  ];

  let tasksByProject: Record<string, ProductionProjectTaskRecord[]> = {
    "project-1": [
      createTaskRecord({
        id: "task-1",
        template_task_id: "template-task-1",
        task_key: "confirm_scope",
        title: "Review upload package",
        summary: "Check completeness before production starts.",
        status: "todo",
        task_type: "production",
        task_type_label: "Production",
        owner_user_id: null,
        owner_label: null,
        due_date: "2026-03-29",
        due_label: "Due Mar 29",
        latest_note: null,
        required: true,
        sort_order: 0,
        handoff_required: false,
        blocks_release: false,
        dependency_state: "ready",
        completed_at: null
      })
    ],
    "project-2": [
      createTaskRecord({
        id: "task-2",
        template_task_id: "template-task-2",
        task_key: "review_issue",
        title: "Confirm issue resolution",
        summary: "Make sure the remediation steps were completed.",
        status: "in_progress",
        task_type: "rework",
        task_type_label: "Rework",
        owner_user_id: "user-leadership",
        owner_label: "Demo Leadership",
        due_date: "2026-03-30",
        due_label: "Due Mar 30",
        latest_note: "Waiting on confirmation from production.",
        required: true,
        sort_order: 0,
        handoff_required: false,
        blocks_release: false,
        dependency_state: "ready",
        completed_at: null
      }),
      createTaskRecord({
        id: "task-3",
        template_task_id: "template-task-3",
        task_key: "close_loop",
        title: "Share final note",
        summary: "Close the loop with the account team.",
        status: "done",
        task_type: "handoff",
        task_type_label: "Handoff",
        owner_user_id: "user-leadership",
        owner_label: "Demo Leadership",
        due_date: "2026-03-28",
        due_label: "Due Mar 28",
        latest_note: "Closed with the account team.",
        required: false,
        sort_order: 1,
        handoff_required: true,
        blocks_release: false,
        dependency_state: "complete",
        completed_at: "2026-03-28T10:15:00.000Z"
      })
    ]
  };

  let eventsByProject: Record<string, ProductionProjectEventRecord[]> = {
    "project-1": [
      {
        id: "event-1",
        event_type: "project.created",
        summary: "Production item created from shoot completion",
        note: null,
        actor_user_id: null,
        actor_name: null,
        created_at: "2026-03-28T09:00:00.000Z",
        metadata: {}
      }
    ],
    "project-2": [
      {
        id: "event-2",
        event_type: "project.updated",
        summary: "Project claimed by leadership",
        note: "Waiting for a confirmation from production.",
        actor_user_id: "user-leadership",
        actor_name: "Demo Leadership",
        created_at: "2026-03-28T10:00:00.000Z",
        metadata: {}
      }
    ]
  };

  let reviewsByProject: Record<string, ProductionProjectReviewRecord[]> = {
    "project-1": [],
    "project-2": []
  };
  const intakeIssues: ProductionProjectIntakeIssue[] = [
    {
      id: "intake-issue-1",
      issue_kind: "sync_stale",
      issue_kind_label: "Sync stale",
      tone: "warning",
      tone_label: "Warning",
      title: "Gallery release item is relying on a stale upstream sync",
      summary: "This Monday-owned intake source has not refreshed recently enough to trust without checking the owning workspace.",
      source_label: "Gallery release",
      source_system_label: "Monday coexistence",
      source_reference: "monday:item:12345",
      context_label: "White Bear Lake High School | Gallery release | Shoot Mar 28",
      linked_project_id: "project-1",
      linked_project_title: "Post-Shoot Production Wrap",
      action_hash: "#admin/integrations?entity_type=school_work_item&entity_id=stale-1",
      last_seen_at: "2026-03-24T09:00:00.000Z"
    },
    {
      id: "intake-issue-2",
      issue_kind: "duplicate_source",
      issue_kind_label: "Duplicate source",
      tone: "warning",
      tone_label: "Warning",
      title: "Josh tracker gallery intake has duplicate upstream records",
      summary: "Multiple upstream records look like the same production job. The funnel will only auto-promote one until the duplicate is cleaned up.",
      source_label: "Gallery release",
      source_system_label: "Manual import / tracker compatibility",
      source_reference: "josh-master:gallery-1",
      context_label: "White Bear Lake High School | Gallery release | Shoot Mar 28",
      linked_project_id: "project-1",
      linked_project_title: "Post-Shoot Production Wrap",
      action_hash: "#schools?item=duplicate-1",
      last_seen_at: "2026-03-28T10:00:00.000Z"
    }
  ];

  let taskHandoffsByProject: Record<string, ProductionProjectTaskHandoffRecord[]> = {
    "project-1": [],
    "project-2": []
  };

  let taskEventsByProject: Record<string, ProductionProjectTaskEventRecord[]> = {
    "project-1": [],
    "project-2": []
  };

  function toneForProject(project: ProductionProjectSummaryRecord) {
    if (project.status === "completed") {
      return "success" as const;
    }
    if (project.stage === "blocked" || project.stage === "correction_needed" || project.overdue) {
      return "critical" as const;
    }
    if (!project.owner_user_id || project.due_within_24_hours || project.stage === "ready_for_qa" || project.stage === "in_qa_review") {
      return "warning" as const;
    }
    return "info" as const;
  }

  function assignQueue(project: ProductionProjectSummaryRecord): ProductionProjectQueueId {
    if (project.stage === "blocked") {
      return "blocked_queue";
    }
    if (project.stage === "ready_for_qa" || project.stage === "in_qa_review" || project.stage === "correction_needed") {
      return "qa_queue";
    }
    if (project.stage === "ready_to_release") {
      return "ready_to_release_queue";
    }
    if (project.overdue || project.due_within_24_hours || !project.owner_user_id || project.stage === "intake_pending") {
      return "at_risk_queue";
    }
    if (project.owner_user_id === leadershipUser.id) {
      return "my_queue";
    }
    return "team_queue";
  }

  function refreshProjectCounts(projectId: string) {
    const tasks = tasksByProject[projectId] ?? [];
    projects = projects.map((project) =>
      project.id === projectId
        ? createProjectRecord({
            ...project,
            open_task_count: tasks.filter((task) => task.status !== "done" && task.status !== "skipped").length,
            completed_task_count: tasks.filter((task) => task.status === "done").length,
            overdue_task_count: tasks.filter((task) => task.status !== "done" && task.due_date && task.due_date <= "2026-03-28").length,
            status_tone: toneForProject(project)
          })
        : project
    );
  }

  function buildDetail(projectId: string): ProductionProjectDetail {
    const project = projects.find((entry) => entry.id === projectId);
    if (!project) {
      throw new Error(`Missing project detail for ${projectId}`);
    }
    return {
      project,
      tasks: tasksByProject[projectId] ?? [],
      reviews: reviewsByProject[projectId] ?? [],
      events: eventsByProject[projectId] ?? [],
      task_handoffs: taskHandoffsByProject[projectId] ?? [],
      task_events: taskEventsByProject[projectId] ?? [],
      workflow_summary: buildWorkflowSummary(tasksByProject[projectId] ?? []),
      approval_summary: {
        source_module: "production",
        source_entity_type: "production_project",
        source_entity_id: projectId,
        open_count: 0,
        blocking_open_count: 0,
        overdue_count: 0,
        escalated_count: 0,
        items: []
      },
      buddy_workflow: null,
      virtual_team_workflow: null,
      exceptions: []
    };
  }

function createTaskRecord(
  overrides: Partial<ProductionProjectTaskRecord> & Pick<ProductionProjectTaskRecord, "id" | "title">
): ProductionProjectTaskRecord {
  const status = overrides.status ?? "todo";
  const dueDate = overrides.due_date ?? null;
  const overdue = overrides.overdue ?? Boolean(dueDate && dueDate < "2026-03-30" && status !== "done" && status !== "skipped");
  const dependencyState = overrides.dependency_state ?? "ready";
  return {
    id: overrides.id,
    template_task_id: overrides.template_task_id ?? null,
    task_key: overrides.task_key ?? null,
    title: overrides.title,
    summary: overrides.summary ?? null,
    status,
    task_type: overrides.task_type ?? "production",
    task_type_label: overrides.task_type_label ?? "Production",
    owner_user_id: overrides.owner_user_id ?? null,
    owner_label: overrides.owner_label ?? null,
    due_date: dueDate,
    due_label: overrides.due_label ?? (dueDate ? "Due Mar 30" : null),
    latest_note: overrides.latest_note ?? null,
    required: overrides.required ?? true,
    sort_order: overrides.sort_order ?? 0,
    handoff_required: overrides.handoff_required ?? false,
    blocks_release: overrides.blocks_release ?? false,
    started_at: overrides.started_at ?? null,
    completed_at: overrides.completed_at ?? null,
    overdue,
    at_risk: overrides.at_risk ?? (overdue || status === "blocked" || dependencyState === "blocked"),
    dependency_state: dependencyState,
    dependency_state_label:
      overrides.dependency_state_label ??
      (dependencyState === "blocked" ? "Waiting on Dependency" : dependencyState === "complete" ? "Complete" : "Ready"),
    blocking_dependencies: overrides.blocking_dependencies ?? [],
    dependent_task_count: overrides.dependent_task_count ?? 0,
    last_handoff_at: overrides.last_handoff_at ?? null,
    last_handoff_to_user_id: overrides.last_handoff_to_user_id ?? null,
    last_handoff_to_label: overrides.last_handoff_to_label ?? null
  };
}

function buildWorkflowSummary(tasks: ProductionProjectTaskRecord[]): ProductionProjectWorkflowSummary {
  const blockedReasons: string[] = [];
  const openRequiredTasks = tasks.filter((task) => task.required && task.status !== "done" && task.status !== "skipped");
  const blockedTaskCount = tasks.filter((task) => task.status === "blocked" || task.dependency_state === "blocked").length;
  const overdueTaskCount = tasks.filter((task) => task.overdue).length;
  const pendingPeerReview = tasks.some((task) => task.task_type === "peer_review" && task.status !== "done" && task.status !== "skipped");
  const pendingFinalQc = tasks.some((task) => task.task_type === "final_qc" && task.status !== "done" && task.status !== "skipped");
  const pendingReleaseTasks = tasks.filter((task) => task.task_type === "release" && task.status !== "done" && task.status !== "skipped").length;
  const openNonReleaseRequiredTasks = openRequiredTasks.filter((task) => task.task_type !== "release");
  if (openNonReleaseRequiredTasks.length) {
    blockedReasons.push(`${openNonReleaseRequiredTasks.length} required task(s) still open`);
  }
  if (blockedTaskCount) {
    blockedReasons.push(`${blockedTaskCount} blocked task(s)`);
  }
  if (overdueTaskCount) {
    blockedReasons.push(`${overdueTaskCount} overdue deadline(s)`);
  }
  if (pendingPeerReview) {
    blockedReasons.push("peer review gate incomplete");
  }
  if (pendingFinalQc) {
    blockedReasons.push("final QC gate incomplete");
  }
  return {
    release_blocked: blockedReasons.length > 0,
    can_move_to_ready_to_release: blockedReasons.length === 0,
    can_release: blockedReasons.length === 0,
    blocked_reasons: blockedReasons,
    open_required_tasks: openRequiredTasks.length,
    blocked_task_count: blockedTaskCount,
    overdue_task_count: overdueTaskCount,
    pending_peer_review: pendingPeerReview,
    pending_final_qc: pendingFinalQc,
    pending_release_tasks: pendingReleaseTasks,
    deadline_ladder: [...tasks]
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((task) => ({
        task_id: task.id,
        title: task.title,
        due_date: task.due_date,
        due_label: task.due_label,
        status: task.status,
        status_label: task.status.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase()),
        owner_label: task.owner_label,
        task_type: task.task_type,
        task_type_label: task.task_type_label,
        dependency_state: task.dependency_state,
        dependency_state_label: task.dependency_state_label
      }))
  };
}

  function buildBoard(path: string): ProductionProjectBoardResponse {
    const query = new URLSearchParams(path.split("?")[1] ?? "");
    const queueFilter = (query.get("queue") as ProductionProjectQueueId | "all" | null) ?? "all";
    const statusFilter = (query.get("status") as "open" | "completed" | "all" | null) ?? "open";
    const search = (query.get("search") ?? "").trim().toLowerCase();

    let visible = [...projects];
    if (statusFilter === "open") {
      visible = visible.filter((project) => project.status !== "completed" && project.status !== "canceled");
    } else if (statusFilter === "completed") {
      visible = visible.filter((project) => project.status === "completed");
    }
    if (search) {
      visible = visible.filter((project) =>
        [
          project.title,
          project.summary ?? "",
          project.linked_organization_name ?? "",
          project.linked_location_name ?? "",
          project.linked_shoot_code ?? "",
          project.linked_shoot_title ?? ""
        ]
          .join(" ")
          .toLowerCase()
          .includes(search)
      );
    }
    const categoryFilter = query.get("category");
    if (categoryFilter && categoryFilter !== "all") {
      visible = visible.filter((project) => project.category === categoryFilter);
    }
    const stageFilter = query.get("stage");
    if (stageFilter && stageFilter !== "all") {
      visible = visible.filter((project) => project.stage === stageFilter);
    }
    const jobTypeFilter = query.get("job_type");
    if (jobTypeFilter && jobTypeFilter !== "all") {
      visible = visible.filter((project) => project.job_type === jobTypeFilter);
    }
    const teamOwnerFilter = query.get("team_owner");
    if (teamOwnerFilter && teamOwnerFilter !== "all") {
      visible = visible.filter((project) => project.team_owner === teamOwnerFilter);
    }
    const ownerFilter = query.get("owner_user_id");
    if (ownerFilter === "unassigned") {
      visible = visible.filter((project) => !project.owner_user_id);
    } else if (ownerFilter) {
      visible = visible.filter((project) => project.owner_user_id === ownerFilter);
    }
    const dueStateFilter = query.get("due_state");
    if (dueStateFilter === "overdue") {
      visible = visible.filter((project) => project.overdue);
    } else if (dueStateFilter === "due_today") {
      visible = visible.filter((project) => project.due_date === "2026-03-28");
    } else if (dueStateFilter === "unscheduled") {
      visible = visible.filter((project) => !project.due_date);
    } else if (dueStateFilter === "upcoming") {
      visible = visible.filter((project) => !project.overdue);
    }

    const queueOrder: ProductionProjectQueueId[] = [
      "my_queue",
      "team_queue",
      "blocked_queue",
      "qa_queue",
      "ready_to_release_queue",
      "at_risk_queue"
    ];

    const workspaceView = (query.get("workspace_view") as ProductionProjectBoardResponse["filters"]["workspace_view"]) ?? "lead_board";
    const sections = queueOrder
      .filter((queueId) => queueFilter === "all" || queueFilter === queueId)
      .map((queueId) => {
        const items = visible.filter((project) => assignQueue(project) === queueId);
        return {
          id: queueId,
          label: humanizeQueue(queueId),
          summary: queueSummary(queueId),
          count: items.length,
          items: workspaceView === "lead_board" ? [] : items
        };
      });

    const unfinishedItems = visible.filter((project) => project.status !== "completed" && project.status !== "canceled");
    const leadBoardFocus = (query.get("lead_board_focus") as ProductionProjectBoardResponse["filters"]["lead_board_focus"]) ?? "all";
    const leadBoardSort = (query.get("lead_board_sort") as ProductionProjectBoardResponse["filters"]["lead_board_sort"]) ?? "overdue_severity";
    const leadBoardItems = unfinishedItems
      .filter((project) => {
        switch (leadBoardFocus) {
          case "blocked":
            return project.stage === "blocked" || project.blocker_count > 0 || project.blocked_task_count > 0;
          case "overdue":
            return project.overdue || project.overdue_task_count > 0;
          case "waiting":
            return project.status === "waiting" || project.pending_peer_review || project.pending_final_qc || project.waiting_to_send;
          default:
            return true;
        }
      })
      .sort((left, right) => {
        switch (leadBoardSort) {
          case "due_date":
            return (left.follow_up_date ?? left.due_date ?? "9999-12-31").localeCompare(right.follow_up_date ?? right.due_date ?? "9999-12-31");
          case "priority":
            return prioritySortWeight(left.priority) - prioritySortWeight(right.priority) || left.title.localeCompare(right.title);
          case "last_touched":
            return right.updated_at.localeCompare(left.updated_at);
          case "owner":
            return left.owner_label.localeCompare(right.owner_label) || left.title.localeCompare(right.title);
          case "current_step":
            return compareNullableNumber(left.current_step_order, right.current_step_order) || left.current_step_label.localeCompare(right.current_step_label);
          default:
            return leadBoardAttentionWeight(left) - leadBoardAttentionWeight(right) || (left.follow_up_date ?? left.due_date ?? "9999-12-31").localeCompare(right.follow_up_date ?? right.due_date ?? "9999-12-31");
        }
      });

    return {
        generated_at: "2026-03-28T12:00:00.000Z",
        anchor_date: query.get("anchor_date") ?? "2026-03-28",
        default_workspace_view: "lead_board",
        filters: {
          workspace_view: workspaceView,
          status: statusFilter,
          queue: queueFilter,
          search: query.get("search") ?? "",
          owner_user_id: query.get("owner_user_id"),
          priority: (query.get("priority") as ProductionProjectBoardResponse["filters"]["priority"]) ?? "all",
          template_id: query.get("template_id"),
          source_type: (query.get("source_type") as ProductionProjectBoardResponse["filters"]["source_type"]) ?? "all",
          source_trigger_key: query.get("source_trigger_key"),
          category: (query.get("category") as ProductionProjectBoardResponse["filters"]["category"]) ?? "all",
          job_type: (query.get("job_type") as ProductionProjectBoardResponse["filters"]["job_type"]) ?? "all",
          stage: (query.get("stage") as ProductionProjectBoardResponse["filters"]["stage"]) ?? "all",
          team_owner: (query.get("team_owner") as ProductionProjectBoardResponse["filters"]["team_owner"]) ?? "all",
          linked_organization_id: query.get("linked_organization_id"),
          linked_location_id: query.get("linked_location_id"),
          linked_shoot_id: query.get("linked_shoot_id"),
          due_state: (query.get("due_state") as ProductionProjectBoardResponse["filters"]["due_state"]) ?? "all",
          big_critical_only: query.get("big_critical_only") === "true",
          lead_board_sort: leadBoardSort,
          lead_board_focus: leadBoardFocus
        },
        summary: {
          total_visible: visible.length,
          open_projects: visible.filter((project) => project.status !== "completed" && project.status !== "canceled").length,
          all_unfinished: unfinishedItems.length,
          my_queue: visible.filter((project) => assignQueue(project) === "my_queue").length,
          team_queue: visible.filter((project) => assignQueue(project) === "team_queue").length,
          blocked_queue: visible.filter((project) => assignQueue(project) === "blocked_queue").length,
          qa_queue: visible.filter((project) => assignQueue(project) === "qa_queue").length,
          ready_to_release_queue: visible.filter((project) => assignQueue(project) === "ready_to_release_queue").length,
          at_risk_queue: visible.filter((project) => assignQueue(project) === "at_risk_queue").length,
          unassigned_jobs: visible.filter((project) => project.status !== "completed" && project.status !== "canceled" && !project.owner_user_id).length,
          active_jobs: visible.filter((project) => project.status !== "completed" && project.status !== "canceled").length,
          on_time: visible.filter((project) => project.status !== "completed" && project.status !== "canceled" && !project.overdue).length,
          blocked: visible.filter((project) => project.stage === "blocked").length,
          due_within_24_hours: visible.filter((project) => project.due_within_24_hours).length,
          overdue: visible.filter((project) => project.overdue).length,
          jobs_in_qa: visible.filter((project) => project.stage === "ready_for_qa" || project.stage === "in_qa_review" || project.stage === "correction_needed").length,
          ready_to_release: visible.filter((project) => project.stage === "ready_to_release").length,
          stale_active: visible.filter((project) => project.status !== "completed" && project.status !== "canceled" && project.stale_active).length,
          corrections_needed: visible.filter((project) => project.status !== "completed" && project.status !== "canceled" && project.corrections_needed).length,
          waiting_to_send: visible.filter((project) => project.status !== "completed" && project.status !== "canceled" && project.waiting_to_send).length,
          ready_to_send: visible.filter((project) => project.status !== "completed" && project.status !== "canceled" && project.ready_to_send).length,
          trigger_intake_waiting: visible.filter(
            (project) =>
              project.status !== "completed" &&
              project.status !== "canceled" &&
              project.source_type === "trigger" &&
              (project.stage === "intake_pending" || project.stage === "ready_for_production")
          ).length,
          needs_setup: 0,
          needs_follow_up: 0,
          overdue_tasks: 0,
          completed_recently: 0,
          in_production: visible.filter((project) => project.stage === "in_production").length,
          blocked_or_corrections: visible.filter((project) => project.stage === "blocked" || project.stage === "correction_needed").length,
          blocked_or_changes_requested: visible.filter((project) => project.stage === "blocked" || project.stage === "correction_needed").length,
          awaiting_peer_review: visible.filter((project) => project.stage === "ready_for_qa" || project.stage === "in_qa_review").length,
          awaiting_final_qc: visible.filter((project) => project.stage === "ready_to_release").length
        },
        lead_board: {
          summary_line:
            leadBoardItems.length > 0
              ? leadBoardFocus === "all"
                ? `${leadBoardItems.length} unfinished production job${leadBoardItems.length === 1 ? "" : "s"} are still active.`
                : `Showing ${leadBoardItems.length} ${leadBoardFocus} production job${leadBoardItems.length === 1 ? "" : "s"} out of ${unfinishedItems.length} unfinished jobs.`
              : "No unfinished production jobs are open right now.",
          items: leadBoardItems
        },
        intake: {
          generated_at: "2026-03-28T12:00:00.000Z",
          summary_line: "2 intake issues need review across duplicates, conflicts, or stale upstream syncs before production leadership can trust the board fully.",
          counts: {
            sources_considered: 6,
            created: 1,
            linked: 1,
            duplicates: 1,
            conflicts: 0,
            sync_failures: 0,
            stale_syncs: 1
          },
          issues: intakeIssues
        },
        sections
      };
  }

  apiFetchMock.mockImplementation(async (path: string, _token?: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;

    if (path === "/api/projects/templates" && method === "GET") {
      return { templates };
    }

    if (path.startsWith("/api/projects/reference-data") && method === "GET") {
      return referenceData;
    }

    if (path.startsWith("/api/projects?") && method === "GET") {
      return buildBoard(path);
    }

    if (path.startsWith("/api/projects/") && method === "GET") {
      const projectId = path.split("/").at(-1);
      return buildDetail(projectId as string);
    }

    if (path === "/api/projects" && method === "POST") {
      const template = templates.find((entry) => entry.id === body.template_id) ?? null;
      const newProject = createProjectRecord({
        id: `project-${projects.length + 1}`,
        template_id: template?.id ?? null,
        template_key: template?.template_key ?? null,
        template_name: template?.name ?? null,
        title: body.title,
        summary: body.summary ?? null,
        status: "new",
        job_type: body.job_type ?? template?.job_type ?? "standard_school_production",
        category: body.category ?? template?.category ?? "production_follow_up",
        category_label:
          template?.category_label ??
          (body.category === "photography_production"
            ? "Photography Production"
            : body.category === "digital_production"
                ? "Post-Shoot Production"
              : body.category === "qa_peer_review"
                ? "QA / Peer Review"
                : body.category === "remediation"
                  ? "Remediation"
                  : "Production Follow-Up"),
        stage: template?.default_stage ?? "intake_pending",
        priority: body.priority ?? template?.default_priority ?? "normal",
        owner_user_id: body.owner_user_id ?? null,
        peer_review_required: template?.peer_review_required ?? false,
        final_qc_required: template?.final_qc_required ?? false,
        peer_reviewer_user_id: null,
        peer_reviewer_label: null,
        final_qc_reviewer_user_id: null,
        final_qc_reviewer_label: null,
        due_date: body.due_date ?? null,
        due_label: body.due_date ? "Due Mar 28" : null,
        follow_up_date: body.follow_up_date ?? null,
        follow_up_label: body.follow_up_date ? "Due Mar 29" : null,
        snoozed_until: null,
        latest_note: body.latest_note ?? null,
        source_type: "manual",
        source_trigger_key: null,
        source_trigger_label: null,
        created_reason: "Created directly in Production.",
        linked_organization_id: body.linked_organization_id ?? null,
        linked_organization_name:
          referenceData.organizations.find((organization) => organization.id === body.linked_organization_id)?.label ?? null,
        linked_location_id: body.linked_location_id ?? null,
        linked_location_name: referenceData.locations.find((location) => location.id === body.linked_location_id)?.label ?? null,
        linked_shoot_id: body.linked_shoot_id ?? null,
        linked_shoot_code: referenceData.shoots.find((shoot) => shoot.id === body.linked_shoot_id)?.shoot_code ?? null,
        linked_shoot_title: referenceData.shoots.find((shoot) => shoot.id === body.linked_shoot_id)?.label ?? null,
        open_task_count: template?.tasks?.length ?? 0,
        completed_task_count: 0,
        overdue_task_count: 0,
        next_action: "Assign an owner and confirm the kickoff path.",
        status_tone: "warning",
        flags: [{ label: "Manual item", tone: "info" }],
        created_at: "2026-03-28T12:15:00.000Z",
        updated_at: "2026-03-28T12:15:00.000Z",
        completed_at: null
      });
      projects = [newProject, ...projects];
      tasksByProject[newProject.id] = (template?.tasks ?? []).map((task) =>
        createTaskRecord({
          id: `${newProject.id}-${task.task_key}`,
          template_task_id: task.id,
          task_key: task.task_key,
          title: task.title,
          summary: task.summary,
          status: "todo",
          task_type: task.task_type,
          task_type_label: task.task_type_label,
          owner_user_id: null,
          owner_label: null,
          due_date: null,
          due_label: null,
          latest_note: null,
          required: task.required,
          sort_order: task.sort_order,
          handoff_required: task.handoff_required,
          blocks_release: task.blocks_release,
          dependency_state: task.dependency_task_keys.length ? "blocked" : "ready",
          blocking_dependencies: []
        })
      );
      eventsByProject[newProject.id] = [
        {
          id: `${newProject.id}-event-1`,
          event_type: "project.created",
          summary: "Production item created manually",
          note: body.latest_note ?? null,
          actor_user_id: "user-leadership",
          actor_name: "Demo Leadership",
          created_at: "2026-03-28T12:15:00.000Z",
          metadata: {}
        }
      ];
      reviewsByProject[newProject.id] = [];
      taskHandoffsByProject[newProject.id] = [];
      taskEventsByProject[newProject.id] = [];
      refreshProjectCounts(newProject.id);
      return buildDetail(newProject.id);
    }

    if (path.startsWith("/api/projects/") && !path.includes("/tasks/") && method === "PATCH") {
      const projectId = path.split("/").at(-1) as string;
      projects = projects.map((project) =>
        project.id === projectId
          ? createProjectRecord({
              ...project,
              status: body.status ?? project.status,
              job_type: body.job_type ?? project.job_type,
              stage: body.stage ?? project.stage,
              owner_user_id: body.owner_user_id ?? project.owner_user_id,
              peer_reviewer_user_id: body.peer_reviewer_user_id === undefined ? project.peer_reviewer_user_id : body.peer_reviewer_user_id,
              final_qc_reviewer_user_id:
                body.final_qc_reviewer_user_id === undefined ? project.final_qc_reviewer_user_id : body.final_qc_reviewer_user_id,
              due_date: body.due_date === undefined ? project.due_date : body.due_date,
              due_label: body.due_date ? "Due Mar 28" : body.due_date === null ? null : project.due_label,
              follow_up_date: body.follow_up_date === undefined ? project.follow_up_date : body.follow_up_date,
              follow_up_label:
                body.follow_up_date !== undefined
                  ? body.follow_up_date
                    ? "Due Mar 28"
                    : null
                  : project.follow_up_label,
              snoozed_until: body.snoozed_until ?? project.snoozed_until,
              latest_note: body.latest_note ?? project.latest_note,
              current_blocker:
                body.clear_blocker || body.stage !== "blocked"
                  ? null
                  : body.blocker_type
                    ? {
                        id: `${projectId}-blocker-1`,
                        blocker_type: body.blocker_type,
                        blocker_type_label: String(body.blocker_type),
                        blocker_owner_user_id: body.blocker_owner_user_id ?? null,
                        blocker_owner_label: body.blocker_owner_user_id === leadershipUser.id ? leadershipUser.fullName : null,
                        reason: body.blocker_reason ?? "Blocked",
                        dependency: body.blocker_dependency ?? null,
                        expected_resolution_date: body.blocker_expected_resolution_date ?? null,
                        expected_resolution_label: body.blocker_expected_resolution_date ?? null,
                        notes: body.blocker_notes ?? null,
                        blocked_at: "2026-03-28T12:20:00.000Z"
                      }
                    : project.current_blocker,
              updated_at: "2026-03-28T12:20:00.000Z",
              completed_at: body.status === "completed" ? "2026-03-28T12:20:00.000Z" : project.completed_at
            })
          : project
      );
      if (body.stage === "correction_needed" || body.stage === "in_qa_review" || body.stage === "ready_to_release" || body.stage === "released_complete") {
        reviewsByProject[projectId] = [
          {
            id: `${projectId}-review-${(reviewsByProject[projectId] ?? []).length + 1}`,
            review_stage: body.stage,
            review_stage_label: labelForStage(body.stage),
            reviewer_user_id: leadershipUser.id,
            reviewer_label: leadershipUser.fullName,
            result:
              body.stage === "correction_needed"
                ? "correction_needed"
                : body.stage === "released_complete"
                  ? "released"
                  : "passed",
            result_label:
              body.stage === "correction_needed"
                ? "Correction Needed"
                : body.stage === "released_complete"
                  ? "Released"
                  : "Passed",
            correction_reason: body.correction_reason ?? null,
            note: body.latest_note ?? null,
            qa_checks: null,
            qa_checklist_complete: false,
            reassigned_owner_user_id: body.owner_user_id ?? null,
            reassigned_owner_label: body.owner_user_id === leadershipUser.id ? leadershipUser.fullName : null,
            created_at: "2026-03-28T12:20:00.000Z"
          },
          ...(reviewsByProject[projectId] ?? [])
        ];
      }
      refreshProjectCounts(projectId);
      eventsByProject[projectId] = [
        {
          id: `${projectId}-event-update-${(eventsByProject[projectId] ?? []).length + 1}`,
          event_type: "project.updated",
          summary: "Production item updated from the operations workspace",
          note: body.latest_note ?? null,
          actor_user_id: "user-leadership",
          actor_name: "Demo Leadership",
          created_at: "2026-03-28T12:20:00.000Z",
          metadata: body
        },
        ...(eventsByProject[projectId] ?? [])
      ];
      return buildDetail(projectId);
    }

    if (path.includes("/tasks/") && method === "PATCH") {
      const [, , , projectId, , taskId] = path.split("/");
      tasksByProject[projectId] = (tasksByProject[projectId] ?? []).map((task) =>
        task.id === taskId
          ? createTaskRecord({
              ...task,
              status: body.status ?? task.status,
              owner_user_id:
                body.handoff_to_user_id === undefined
                  ? body.owner_user_id === undefined
                    ? task.owner_user_id
                    : body.owner_user_id
                  : body.handoff_to_user_id,
              owner_label:
                (body.handoff_to_user_id ?? body.owner_user_id) === leadershipUser.id
                  ? leadershipUser.fullName
                  : (body.handoff_to_user_id ?? body.owner_user_id) === null
                    ? null
                    : task.owner_label,
              due_date: body.due_date === undefined ? task.due_date : body.due_date,
              due_label:
                body.due_date === undefined ? task.due_label : body.due_date ? "Due Mar 29" : null,
              latest_note: body.latest_note === undefined ? task.latest_note : body.latest_note,
              completed_at: body.status === "done" ? "2026-03-28T12:25:00.000Z" : body.status === "todo" ? null : task.completed_at,
              last_handoff_at: body.handoff_to_user_id ? "2026-03-28T12:25:00.000Z" : task.last_handoff_at,
              last_handoff_to_user_id: body.handoff_to_user_id ?? task.last_handoff_to_user_id,
              last_handoff_to_label: body.handoff_to_user_id === leadershipUser.id ? leadershipUser.fullName : task.last_handoff_to_label
            })
          : task
      );
      if (body.handoff_to_user_id) {
        const handoffTask = tasksByProject[projectId].find((task) => task.id === taskId);
        taskHandoffsByProject[projectId] = [
          {
            id: `${projectId}-handoff-${taskId}-${(taskHandoffsByProject[projectId] ?? []).length + 1}`,
            task_id: taskId,
            task_title: handoffTask?.title ?? "Task",
            from_user_id: leadershipUser.id,
            from_user_label: leadershipUser.fullName,
            to_user_id: body.handoff_to_user_id,
            to_user_label: body.handoff_to_user_id === leadershipUser.id ? leadershipUser.fullName : "Assigned Owner",
            note: body.handoff_note ?? null,
            created_by_user_id: leadershipUser.id,
            created_by_label: leadershipUser.fullName,
            created_at: "2026-03-28T12:25:00.000Z"
          },
          ...(taskHandoffsByProject[projectId] ?? [])
        ];
      }
      taskEventsByProject[projectId] = [
        {
          id: `${projectId}-task-event-${taskId}-${(taskEventsByProject[projectId] ?? []).length + 1}`,
          task_id: taskId,
          task_title: tasksByProject[projectId].find((task) => task.id === taskId)?.title ?? "Task",
          event_type: body.handoff_to_user_id ? "task.handoff" : "task.updated",
          summary: body.handoff_to_user_id ? "Task handed off" : "Checklist item updated",
          note: body.handoff_note ?? body.latest_note ?? `Task moved to ${body.status}.`,
          actor_user_id: "user-leadership",
          actor_name: "Demo Leadership",
          created_at: "2026-03-28T12:25:00.000Z",
          metadata: { taskId, status: body.status }
        },
        ...(taskEventsByProject[projectId] ?? [])
      ];
      refreshProjectCounts(projectId);
      eventsByProject[projectId] = [
        {
          id: `${projectId}-task-${taskId}`,
          event_type: "project.task_updated",
          summary: "Checklist item updated",
          note: `Task moved to ${body.status}.`,
          actor_user_id: "user-leadership",
          actor_name: "Demo Leadership",
          created_at: "2026-03-28T12:25:00.000Z",
          metadata: { taskId, status: body.status }
        },
        ...(eventsByProject[projectId] ?? [])
      ];
      return buildDetail(projectId);
    }

    throw new Error(`Unexpected call: ${method} ${path}`);
  });
}

describe("ProductionProjects", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    getProjectWorkflowCommandCenterMock.mockReset();
    getProjectWorkflowCommandCenterMock.mockResolvedValue({
      generated_at: "2026-04-04T12:00:00.000Z",
      view: "department",
      summary: {},
      alerts: [],
      steps: [],
      job_rows: []
    });
    window.history.replaceState(null, "", "#graphics");
  });

  afterEach(() => {
    cleanup();
  });

  it("honors filtered project hashes and keeps filter state in the workspace url", async () => {
    createProjectHarness();
    window.history.replaceState(null, "", "#graphics?queue=at_risk_queue&owner_user_id=unassigned");

    render(<ProductionProjects token="token" currentUser={leadershipUser} />);

    expect((await screen.findAllByText("Post-Shoot Production Wrap")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Issue Remediation Review")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Due State"), { target: { value: "overdue" } });

    await waitFor(() => {
      expect(window.location.hash).toContain("queue=at_risk_queue");
      expect(window.location.hash).toContain("owner_user_id=unassigned");
      expect(window.location.hash).toContain("due_state=overdue");
    });

    fireEvent.click(screen.getByRole("button", { name: /^Blocked Jobs/i }));

    await waitFor(() => {
      expect(window.location.hash).toContain("queue=blocked_queue");
      expect(window.location.hash).toContain("stage=blocked");
    });
  });

  it("renders the board, opens detail, and applies owner and checklist updates", async () => {
    createProjectHarness();

    render(<ProductionProjects token="token" currentUser={leadershipUser} />);

    expect((await screen.findAllByText("Graphics command board")).length).toBeGreaterThan(0);
    expect(screen.getByText("All Unfinished Graphics Work (2)")).toBeInTheDocument();
    expect(screen.getByLabelText("Lead Board Owner")).toBeInTheDocument();
    expect(screen.getByLabelText("Lead Board Step")).toBeInTheDocument();
    expect(screen.getByLabelText("Lead Board Source")).toBeInTheDocument();
    expect(screen.getByLabelText("Season / Workflow")).toBeInTheDocument();
    expect(screen.getByText("Graphics Intake Funnel")).toBeInTheDocument();
    expect(screen.getByText("Quick SOP / operator guidance")).toBeInTheDocument();
    expect(screen.getByText("Manager Scan Rules")).toBeInTheDocument();
    expect(screen.getByText("Peer Review Standards")).toBeInTheDocument();
    expect(screen.getByText("2 upstream intake issues")).toBeInTheDocument();
    expect(screen.getByText("Feed / Source Issues")).toBeInTheDocument();
    expect(screen.getByText("Gallery release item is relying on a stale upstream sync")).toBeInTheDocument();
    expect(await screen.findByText("Post-Shoot Production Wrap")).toBeInTheDocument();
    expect((await screen.findAllByText("Spring Portrait Day")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Friday Night Lights Media Day")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/3 photographers/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/4 photographers/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Comment: Waiting for a confirmation from production.")).toBeInTheDocument();
    expect(screen.getAllByText("Review upload package").length).toBeGreaterThan(0);
    expect(screen.getByText(/Waiting on intake/i)).toBeInTheDocument();
    expect(screen.getByText("Last touched 4 days ago")).toBeInTheDocument();
    expect(screen.getByText("Corrections needed")).toBeInTheDocument();
    expect(apiFetchMock).toHaveBeenCalledWith(expect.stringContaining("workspace_view=lead_board"), "token");
    fireEvent.click(screen.getByRole("button", { name: /Gallery release item is relying on a stale upstream sync/i }));
    await waitFor(() => {
      expect(window.location.hash).toBe("#admin/integrations?entity_type=school_work_item&entity_id=stale-1");
    });
    window.history.replaceState(null, "", "#graphics?view=lead_board");

    fireEvent.change(screen.getByLabelText("Lead Board Owner"), { target: { value: "unassigned" } });

    await waitFor(() => {
      expect(window.location.hash).toContain("owner_user_id=unassigned");
      expect(screen.queryByText("Issue Remediation Review")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Overdue" }));

    await waitFor(() => {
      expect(window.location.hash).toContain("lead_board_focus=overdue");
      expect(screen.queryByText("Issue Remediation Review")).not.toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "priority" } });

    await waitFor(() => {
      expect(window.location.hash).toContain("lead_board_sort=priority");
      expect(apiFetchMock).toHaveBeenCalledWith(expect.stringContaining("lead_board_sort=priority"), "token");
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear Board Filters" }));

    await waitFor(() => {
      expect(window.location.hash).not.toContain("owner_user_id=unassigned");
      expect(window.location.hash).not.toContain("lead_board_focus=overdue");
    });
    expect((await screen.findAllByText("Post-Shoot Production Wrap")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByText("Post-Shoot Production Wrap")[0]);

    expect(await screen.findByText("Graphics Source And Linked Shoot")).toBeInTheDocument();
    expect(screen.getByText("Current Step Guidance")).toBeInTheDocument();
    expect(screen.getByText("Do not move this job into active graphics work until intake is clear.")).toBeInTheDocument();
    expect(screen.getByText("Created when the shoot moved into complete status.")).toBeInTheDocument();
    expect(screen.getByText("DEMO-001 | Shoot Mar 27 | 3 photographers | Elevated")).toBeInTheDocument();
    expect(screen.getByText("Deadline Ladder")).toBeInTheDocument();
    expect(screen.getByText("Task Handoffs (0)")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Assign To Demo" })[0]);

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/projects/project-1",
        "token",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            owner_user_id: leadershipUser.id,
            latest_note: "Claimed from the Graphics workspace."
          })
        })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Request Correction" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/projects/project-1",
        "token",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            status: "blocked",
            stage: "correction_needed",
            correction_reason: "Claimed from the Graphics workspace.",
            latest_note: "Claimed from the Graphics workspace."
          })
        })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/projects/project-1/tasks/task-1",
        "token",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            status: "done",
            owner_user_id: null,
            due_date: "2026-03-29",
            latest_note: null
          })
        })
      );
    });
    expect(await screen.findByRole("button", { name: "Reopen" })).toBeInTheDocument();
  });

  it("reconciles the selected detail item when filters remove it from the visible workspace", async () => {
    createProjectHarness();

    render(<ProductionProjects token="token" currentUser={leadershipUser} />);

    expect((await screen.findAllByText("Graphics command board")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByText("Post-Shoot Production Wrap")[0]);
    expect(await screen.findByText("Graphics Source And Linked Shoot")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Lead Board Owner"), { target: { value: leadershipUser.id } });

    await waitFor(() => {
      expect(window.location.hash).toContain(`owner_user_id=${leadershipUser.id}`);
      expect(window.location.hash).toContain("project=project-2");
    });

    expect((await screen.findAllByText("Issue Remediation Review")).length).toBeGreaterThan(0);
  });

  it("keeps production staff in the focused workflow workspace instead of the lead board", async () => {
    createProjectHarness();

    render(<ProductionProjects token="token" currentUser={productionStaffUser} />);

    expect(await screen.findByText("My Graphics Workflow")).toBeInTheDocument();
    expect(screen.queryByText("Graphics command board")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Lead Board" })).not.toBeInTheDocument();
    expect(screen.getByText("My Workflow Discipline")).toBeInTheDocument();
    expect(screen.getAllByText("My Queue").length).toBeGreaterThan(0);
    expect(screen.getByText("At Risk Queue (1)")).toBeInTheDocument();
    expect(screen.getByText("Qa Queue (1)")).toBeInTheDocument();
    expect(screen.getByText("Ready To Release Queue (0)")).toBeInTheDocument();
  });

  it("creates a manual project with linked context from the drawer and routes into the new detail", async () => {
    createProjectHarness();

    render(<ProductionProjects token="token" currentUser={leadershipUser} />);

    expect((await screen.findAllByText("Graphics command board")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Add Manual Item" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Organization")).not.toBeDisabled();
    });
    const createDrawer = screen.getByRole("heading", { name: "Create Manual Graphics Item" }).closest(".drawer-shell") as HTMLElement;
    const drawerScope = within(createDrawer);

    fireEvent.change(drawerScope.getByLabelText("Template"), { target: { value: "template-1" } });
    fireEvent.change(drawerScope.getByLabelText("Graphics Title"), {
      target: { value: "Manual Banner Delivery Follow-Up" }
    });
    fireEvent.change(drawerScope.getByLabelText("Summary"), {
      target: { value: "Confirm the production handoff for the banner delivery package." }
    });
    fireEvent.change(drawerScope.getByLabelText("Category"), {
      target: { value: "digital_production" }
    });
    fireEvent.change(drawerScope.getByLabelText("Owner"), {
      target: { value: leadershipUser.id }
    });
    fireEvent.change(drawerScope.getByLabelText("Organization"), {
      target: { value: "org-1" }
    });
    fireEvent.change(drawerScope.getByLabelText("Location"), {
      target: { value: "location-1" }
    });
    fireEvent.change(drawerScope.getByLabelText("Shoot"), {
      target: { value: "shoot-1" }
    });
    fireEvent.change(drawerScope.getByLabelText("Kickoff Note"), {
      target: { value: "Created manually from the overnight operations pass." }
    });

    fireEvent.click(drawerScope.getByRole("button", { name: "Create Manual Item" }));

    await waitFor(() => {
      const createCall = apiFetchMock.mock.calls.find(
        ([path, _token, init]) => path === "/api/projects" && (init as RequestInit | undefined)?.method === "POST"
      );
      expect(createCall).toBeDefined();
      const [, token, init] = createCall as [string, string, RequestInit];
      expect(token).toBe("token");
      expect(JSON.parse(String(init.body))).toMatchObject({
        template_id: "template-1",
        title: "Manual Banner Delivery Follow-Up",
        category: "digital_production",
        owner_user_id: leadershipUser.id,
        linked_organization_id: "org-1",
        linked_location_id: "location-1",
        linked_shoot_id: "shoot-1",
        latest_note: "Created manually from the overnight operations pass."
      });
    });
    await waitFor(() => {
      expect(screen.getAllByText("Manual Banner Delivery Follow-Up").length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(window.location.hash).toContain("project=project-3");
    });
    expect(await screen.findByText("White Bear Lake High School")).toBeInTheDocument();
  });
});

function humanizeQueue(value: ProductionProjectQueueId) {
  return value
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function queueSummary(value: ProductionProjectQueueId) {
  if (value === "at_risk_queue") {
    return "Production work that is overdue, due soon, or still missing clean ownership.";
  }
  if (value === "ready_to_release_queue") {
    return "Production work that cleared QA and is waiting on release follow-through.";
  }
  if (value === "qa_queue") {
    return "Production work sitting in QA review or corrections.";
  }
  if (value === "blocked_queue") {
    return "Production work blocked on missing inputs, corrections, or release risk.";
  }
  return "Active production work already in motion.";
}
