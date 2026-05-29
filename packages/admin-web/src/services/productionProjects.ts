import { apiFetch } from "../api";
import type {
  OperationalApprovalRequestSummary,
  ProductionLeadBoardFocus,
  ProductionLeadBoardSort,
  ProductionProjectBoardResponse,
  ProductionProjectCategory,
  ProductionProjectDetail,
  ProductionProjectDueState,
  ProductionProjectJobType,
  ProductionProjectQueueId,
  ProductionProjectReferenceData,
  ProductionProjectStage,
  ProductionProjectTeamOwner,
  ProductionProjectTaskStatus,
  ProductionProjectExceptionType,
  ProductionProjectExceptionSeverity,
  ProductionProjectExceptionStatus,
  ProductionProjectFollowUpType,
  ProductionProjectFollowUpStatus,
  ProductionProjectTemplateRecord,
  ProductionProjectWorkspaceView,
  ProductionProjectQaCheckRecord,
  ProductionProjectQaWorkspace,
  ProductionProjectAnalytics
} from "../types";

export type ProductionProjectApprovalRequiredResponse = {
  approval_required: true;
  approval_request: OperationalApprovalRequestSummary;
  detail: ProductionProjectDetail;
};

export type ProductionProjectMutationResponse = ProductionProjectDetail | ProductionProjectApprovalRequiredResponse;

export type ProductionProjectBoardFilters = {
  anchorDate: string;
  workspace_view?: ProductionProjectWorkspaceView | null;
  status?: "open" | "completed" | "all";
  queue?: ProductionProjectQueueId | "all";
  search?: string;
  owner_user_id?: string | "unassigned" | null;
  priority?: "low" | "normal" | "high" | "critical" | "all";
  template_id?: string | null;
  source_type?: "manual" | "trigger" | "all";
  source_trigger_key?: string | null;
  category?: ProductionProjectCategory | "all";
  job_type?: ProductionProjectJobType | "all";
  stage?: ProductionProjectStage | "all";
  team_owner?: ProductionProjectTeamOwner | "all";
  linked_organization_id?: string | null;
  linked_location_id?: string | null;
  linked_shoot_id?: string | null;
  due_state?: ProductionProjectDueState | "all";
  big_critical_only?: boolean;
  lead_board_sort?: ProductionLeadBoardSort;
  lead_board_focus?: ProductionLeadBoardFocus;
};

export type CreateProductionProjectInput = {
  template_id?: string | null;
  title: string;
  summary?: string | null;
  job_type?: ProductionProjectJobType;
  category?: ProductionProjectCategory;
  stage?: ProductionProjectStage;
  priority?: "low" | "normal" | "high" | "critical";
  owner_user_id?: string | null;
  peer_reviewer_user_id?: string | null;
  final_qc_reviewer_user_id?: string | null;
  due_date?: string | null;
  follow_up_date?: string | null;
  linked_organization_id?: string | null;
  linked_location_id?: string | null;
  linked_shoot_id?: string | null;
  latest_note?: string | null;
};

export type UpdateProductionProjectInput = {
  status?: "new" | "active" | "blocked" | "waiting" | "completed" | "canceled";
  job_type?: ProductionProjectJobType;
  stage?: ProductionProjectStage;
  owner_user_id?: string | null;
  peer_reviewer_user_id?: string | null;
  final_qc_reviewer_user_id?: string | null;
  due_date?: string | null;
  follow_up_date?: string | null;
  snoozed_until?: string | null;
  latest_note?: string | null;
  summary?: string | null;
  blocker_type?: string | null;
  blocker_owner_user_id?: string | null;
  blocker_reason?: string | null;
  blocker_dependency?: string | null;
  blocker_expected_resolution_date?: string | null;
  blocker_notes?: string | null;
  clear_blocker?: boolean;
  correction_reason?: string | null;
};

export type UpdateProductionProjectTaskInput = {
  status?: ProductionProjectTaskStatus;
  owner_user_id?: string | null;
  due_date?: string | null;
  latest_note?: string | null;
  handoff_to_user_id?: string | null;
  handoff_note?: string | null;
};

export type UpdateBuddyWorkflowInput = {
  status?: ProductionProjectTaskStatus;
  owner_user_id?: string | null;
  duplicate_handling_required?: boolean;
  cleanup_completed?: boolean;
  unresolved_group_count?: number;
  notes?: string | null;
};

export type UpdateVirtualTeamWorkflowInput = {
  status?: ProductionProjectTaskStatus;
  owner_user_id?: string | null;
  attributes_validated?: boolean;
  coach_tags_validated?: boolean;
  split_by_group_validated?: boolean;
  ambiguous_match_required?: boolean;
  ambiguous_match_resolved?: boolean;
  notes?: string | null;
};

export type CreateProductionProjectExceptionInput = {
  lane_type: "buddy_photos" | "virtual_teams";
  exception_type: ProductionProjectExceptionType;
  severity?: ProductionProjectExceptionSeverity;
  blocking?: boolean;
  assignee_user_id?: string | null;
  notes?: string | null;
  issue_tag?: string | null;
  follow_up_type?: ProductionProjectFollowUpType | null;
  follow_up_status?: ProductionProjectFollowUpStatus | null;
  follow_up_owner_user_id?: string | null;
  follow_up_notes?: string | null;
};

export type UpdateProductionProjectExceptionInput = {
  status?: ProductionProjectExceptionStatus;
  blocking?: boolean;
  assignee_user_id?: string | null;
  notes?: string | null;
  resolution_notes?: string | null;
  issue_tag?: string | null;
  follow_up_type?: ProductionProjectFollowUpType | null;
  follow_up_status?: ProductionProjectFollowUpStatus | null;
  follow_up_owner_user_id?: string | null;
  follow_up_notes?: string | null;
};

export type SubmitProductionProjectQaReviewInput = {
  result: "passed" | "correction_needed" | "blocked";
  note?: string | null;
  correction_reason?: string | null;
  qa_checks: ProductionProjectQaCheckRecord[];
};

export type ProductionProjectHashState = {
  projectId?: string | null;
  view?: ProductionProjectWorkspaceView | null;
  status?: "open" | "completed" | "all";
  queue?: ProductionProjectQueueId | "all";
  search?: string;
  owner_user_id?: string | "unassigned" | null;
  priority?: "low" | "normal" | "high" | "critical" | "all";
  template_id?: string | null;
  source_type?: "manual" | "trigger" | "all";
  source_trigger_key?: string | null;
  category?: ProductionProjectCategory | "all";
  job_type?: ProductionProjectJobType | "all";
  stage?: ProductionProjectStage | "all";
  team_owner?: ProductionProjectTeamOwner | "all";
  linked_organization_id?: string | null;
  linked_location_id?: string | null;
  linked_shoot_id?: string | null;
  due_state?: ProductionProjectDueState | "all";
  big_critical_only?: boolean;
  lead_board_sort?: ProductionLeadBoardSort;
  lead_board_focus?: ProductionLeadBoardFocus;
};

export function buildProductionProjectsHash(state: ProductionProjectHashState = {}) {
  const params = new URLSearchParams();
  if (state.projectId) {
    params.set("project", state.projectId);
  }
  if (state.view) {
    params.set("view", state.view);
  }
  if (state.status && state.status !== "open") {
    params.set("status", state.status);
  }
  if (state.queue && state.queue !== "all") {
    params.set("queue", state.queue);
  }
  if (state.search?.trim()) {
    params.set("search", state.search.trim());
  }
  if (state.owner_user_id) {
    params.set("owner_user_id", state.owner_user_id);
  }
  if (state.priority && state.priority !== "all") {
    params.set("priority", state.priority);
  }
  if (state.template_id) {
    params.set("template_id", state.template_id);
  }
  if (state.source_type && state.source_type !== "all") {
    params.set("source_type", state.source_type);
  }
  if (state.source_trigger_key) {
    params.set("source_trigger_key", state.source_trigger_key);
  }
  if (state.category && state.category !== "all") {
    params.set("category", state.category);
  }
  if (state.job_type && state.job_type !== "all") {
    params.set("job_type", state.job_type);
  }
  if (state.stage && state.stage !== "all") {
    params.set("stage", state.stage);
  }
  if (state.team_owner && state.team_owner !== "all") {
    params.set("team_owner", state.team_owner);
  }
  if (state.linked_organization_id) {
    params.set("linked_organization_id", state.linked_organization_id);
  }
  if (state.linked_location_id) {
    params.set("linked_location_id", state.linked_location_id);
  }
  if (state.linked_shoot_id) {
    params.set("linked_shoot_id", state.linked_shoot_id);
  }
  if (state.due_state && state.due_state !== "all") {
    params.set("due_state", state.due_state);
  }
  if (state.big_critical_only) {
    params.set("big_critical_only", "true");
  }
  if (state.lead_board_sort && state.lead_board_sort !== "overdue_severity") {
    params.set("lead_board_sort", state.lead_board_sort);
  }
  if (state.lead_board_focus && state.lead_board_focus !== "all") {
    params.set("lead_board_focus", state.lead_board_focus);
  }
  const query = params.toString();
  const baseHash = getProductionRouteBase(state);
  return query ? `${baseHash}?${query}` : baseHash;
}

export async function getProductionProjectQaWorkspace(token: string) {
  return apiFetch<ProductionProjectQaWorkspace>("/api/projects/qa-workspace", token);
}

export async function getProductionProjectAnalytics(token: string, windowDays = 90) {
  return apiFetch<ProductionProjectAnalytics>(`/api/projects/analytics?window_days=${windowDays}`, token);
}

export async function submitProductionProjectQaReview(
  token: string,
  projectId: string,
  input: SubmitProductionProjectQaReviewInput
) {
  return apiFetch<ProductionProjectMutationResponse>(`/api/projects/${projectId}/qa-review`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

function getProductionRouteBase(state: ProductionProjectHashState) {
  if (
    state.stage === "blocked" ||
    state.stage === "ready_for_qa" ||
    state.stage === "in_qa_review" ||
    state.stage === "correction_needed"
  ) {
    return "#graphics/qa";
  }
  if (state.stage === "ready_to_release" || state.stage === "released_complete") {
    return "#graphics/release";
  }
  if (state.stage === "intake_pending" || state.stage === "ready_for_production") {
    return "#graphics/queue";
  }
  if (state.owner_user_id && !state.projectId) {
    return "#graphics/workload";
  }
  if (state.queue === "qa_queue" || state.queue === "blocked_queue") {
    return "#graphics/qa";
  }
  if (state.queue === "ready_to_release_queue") {
    return "#graphics/release";
  }
  if (state.queue === "team_queue" && (!state.owner_user_id || state.owner_user_id === "unassigned")) {
    return "#graphics/queue";
  }
  if (state.queue === "my_queue" || state.queue === "team_queue" || state.owner_user_id) {
    return "#graphics/workload";
  }
  return "#graphics";
}

export async function listProductionProjects(token: string, filters: ProductionProjectBoardFilters) {
  const params = new URLSearchParams();
  params.set("anchor_date", filters.anchorDate);
  params.set("workspace_view", filters.workspace_view ?? "staff_workspace");
  params.set("status", filters.status ?? "open");
  params.set("queue", filters.queue ?? "all");
  if (filters.search?.trim()) {
    params.set("search", filters.search.trim());
  }
  if (filters.owner_user_id) {
    params.set("owner_user_id", filters.owner_user_id);
  }
  if (filters.priority && filters.priority !== "all") {
    params.set("priority", filters.priority);
  }
  if (filters.template_id) {
    params.set("template_id", filters.template_id);
  }
  if (filters.source_type && filters.source_type !== "all") {
    params.set("source_type", filters.source_type);
  }
  if (filters.source_trigger_key) {
    params.set("source_trigger_key", filters.source_trigger_key);
  }
  if (filters.category && filters.category !== "all") {
    params.set("category", filters.category);
  }
  if (filters.job_type && filters.job_type !== "all") {
    params.set("job_type", filters.job_type);
  }
  if (filters.stage && filters.stage !== "all") {
    params.set("stage", filters.stage);
  }
  if (filters.team_owner && filters.team_owner !== "all") {
    params.set("team_owner", filters.team_owner);
  }
  if (filters.linked_organization_id) {
    params.set("linked_organization_id", filters.linked_organization_id);
  }
  if (filters.linked_location_id) {
    params.set("linked_location_id", filters.linked_location_id);
  }
  if (filters.linked_shoot_id) {
    params.set("linked_shoot_id", filters.linked_shoot_id);
  }
  if (filters.due_state && filters.due_state !== "all") {
    params.set("due_state", filters.due_state);
  }
  if (filters.big_critical_only) {
    params.set("big_critical_only", "true");
  }
  if (filters.lead_board_sort && filters.lead_board_sort !== "overdue_severity") {
    params.set("lead_board_sort", filters.lead_board_sort);
  }
  if (filters.lead_board_focus && filters.lead_board_focus !== "all") {
    params.set("lead_board_focus", filters.lead_board_focus);
  }
  return apiFetch<ProductionProjectBoardResponse>(`/api/projects?${params.toString()}`, token);
}

export async function listProductionProjectTemplates(token: string) {
  return apiFetch<{ templates: ProductionProjectTemplateRecord[] }>("/api/projects/templates", token);
}

export async function getProductionProjectReferenceData(
  token: string,
  filters: {
    linked_organization_id?: string | null;
    linked_location_id?: string | null;
  } = {}
) {
  const params = new URLSearchParams();
  if (filters.linked_organization_id) {
    params.set("linked_organization_id", filters.linked_organization_id);
  }
  if (filters.linked_location_id) {
    params.set("linked_location_id", filters.linked_location_id);
  }
  const query = params.toString();
  return apiFetch<ProductionProjectReferenceData>(`/api/projects/reference-data${query ? `?${query}` : ""}`, token);
}

export async function getProductionProjectDetail(token: string, projectId: string) {
  return apiFetch<ProductionProjectDetail>(`/api/projects/${projectId}`, token);
}

export async function createProductionProject(token: string, input: CreateProductionProjectInput) {
  return apiFetch<ProductionProjectDetail>("/api/projects", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateProductionProject(token: string, projectId: string, input: UpdateProductionProjectInput) {
  return apiFetch<ProductionProjectMutationResponse>(`/api/projects/${projectId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function updateProductionProjectTask(
  token: string,
  projectId: string,
  taskId: string,
  input: UpdateProductionProjectTaskInput
) {
  return apiFetch<ProductionProjectDetail>(`/api/projects/${projectId}/tasks/${taskId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function updateProductionProjectTaskStatus(
  token: string,
  projectId: string,
  taskId: string,
  status: ProductionProjectTaskStatus
) {
  return updateProductionProjectTask(token, projectId, taskId, { status });
}

export async function updateBuddyWorkflow(
  token: string,
  projectId: string,
  input: UpdateBuddyWorkflowInput
) {
  return apiFetch<ProductionProjectDetail>(`/api/projects/${projectId}/buddy-workflow`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function updateVirtualTeamWorkflow(
  token: string,
  projectId: string,
  input: UpdateVirtualTeamWorkflowInput
) {
  return apiFetch<ProductionProjectDetail>(`/api/projects/${projectId}/virtual-team-workflow`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function createProductionProjectException(
  token: string,
  projectId: string,
  input: CreateProductionProjectExceptionInput
) {
  return apiFetch<ProductionProjectDetail>(`/api/projects/${projectId}/exceptions`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateProductionProjectException(
  token: string,
  exceptionId: string,
  input: UpdateProductionProjectExceptionInput
) {
  return apiFetch<ProductionProjectDetail>(`/api/projects/exceptions/${exceptionId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}
