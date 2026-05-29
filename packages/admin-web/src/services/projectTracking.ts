import { apiFetch } from "../api";
import type {
  ProjectWorkflowCommandCenter,
  ProjectWorkflowProductionQueue,
  ProjectWorkflowInstance,
  ProjectWorkflowStepStatus,
  ProjectWorkflowWaitingOnParty,
  ProjectWorkflowTemplateSummary,
  WorkflowTemplateBuilderDependencyMode,
  WorkflowTemplateBuilderDetail,
  WorkflowTemplateBuilderOwnerType,
  WorkflowTemplateBuilderSummary
} from "../projectTrackingTypes";

export type ProjectWorkflowTemplatePayload = {
  template_key: string;
  name: string;
  description?: string | null;
  departments_involved: string[];
  milestones: Array<{
    milestone_key: string;
    name: string;
    description?: string | null;
    steps: Array<{
      step_key: string;
      name: string;
      description?: string | null;
      department: string;
      role_key?: string | null;
      assigned_user_id?: string | null;
      required?: boolean | null;
      skippable?: boolean | null;
      blocking?: boolean | null;
      expected_duration_minutes?: number | null;
      depends_on_step_keys?: string[] | null;
    }>;
  }>;
};

export function listProjectWorkflowTemplates(token: string) {
  return apiFetch<{ templates: ProjectWorkflowTemplateSummary[] }>("/api/workflows/templates", token);
}

export function createProjectWorkflowTemplate(token: string, payload: ProjectWorkflowTemplatePayload) {
  return apiFetch<{ template: { id: string }; version: { id: string; version_number: number } }>(
    "/api/workflows/templates",
    token,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function instantiateProjectWorkflow(
  token: string,
  payload: { job_id: string; template_key?: string | null; template_version_id?: string | null; idempotency_key?: string | null }
) {
  return apiFetch<ProjectWorkflowInstance>("/api/workflows/instances", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getProjectWorkflowInstance(token: string, workflowRunId: string) {
  return apiFetch<ProjectWorkflowInstance>(`/api/workflows/instances/${workflowRunId}`, token);
}

export function transitionProjectWorkflowStep(
  token: string,
  stepId: string,
  payload: {
    status: ProjectWorkflowStepStatus;
    reason?: string | null;
    notes?: string | null;
    assigned_user_id?: string | null;
    assigned_queue?: string | null;
    expected_duration_minutes?: number | null;
    last_seen_updated_at?: string | null;
    idempotency_key?: string | null;
  }
) {
  return apiFetch<ProjectWorkflowInstance>(`/api/workflows/steps/${stepId}/transition`, token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function sendProjectWorkflowStepBack(
  token: string,
  stepId: string,
  payload: {
    target_step_id: string;
    reason: string;
    assigned_user_id: string;
    expected_duration_minutes: number;
    expectations?: string | null;
  }
) {
  return apiFetch<ProjectWorkflowInstance>(`/api/workflows/steps/${stepId}/send-back`, token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getProjectWorkflowCommandCenter(
  token: string,
  query: { view?: "personal" | "department" | "global"; department?: string; limit?: number } = {}
) {
  const params = new URLSearchParams();
  if (query.view) {
    params.set("view", query.view);
  }
  if (query.department) {
    params.set("department", query.department);
  }
  if (query.limit) {
    params.set("limit", String(query.limit));
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<ProjectWorkflowCommandCenter>(`/api/workflows/command-center${suffix}`, token);
}

export function getProjectWorkflowProductionQueue(token: string, query: { limit?: number } = {}) {
  const params = new URLSearchParams();
  if (query.limit) {
    params.set("limit", String(query.limit));
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<ProjectWorkflowProductionQueue>(`/api/workflows/production-queue${suffix}`, token);
}

export function sendProjectWorkflowToProduction(
  token: string,
  workflowRunId: string,
  payload: {
    step_id: string;
    notes?: string | null;
    readiness: {
      files_confirmed: boolean;
      data_confirmed: boolean;
      job_type_confirmed: boolean;
      due_date_confirmed: boolean;
    };
  }
) {
  return apiFetch<ProjectWorkflowInstance>(`/api/workflows/instances/${workflowRunId}/send-to-production`, token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function acceptProjectWorkflowHandoff(token: string, handoffId: string) {
  return apiFetch<ProjectWorkflowInstance>(`/api/workflows/handoffs/${handoffId}/accept`, token, {
    method: "POST"
  });
}

export function claimProjectWorkflowHandoff(
  token: string,
  handoffId: string,
  payload: { assigned_queue?: string | null; assigned_user_id?: string | null; notes?: string | null } = {}
) {
  return apiFetch<ProjectWorkflowInstance>(`/api/workflows/handoffs/${handoffId}/claim`, token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function markProjectWorkflowHandoffWaiting(
  token: string,
  handoffId: string,
  payload: { waiting_on_party: ProjectWorkflowWaitingOnParty; waiting_detail: string }
) {
  return apiFetch<ProjectWorkflowInstance>(`/api/workflows/handoffs/${handoffId}/mark-waiting`, token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function markProjectWorkflowHandoffProductionComplete(token: string, handoffId: string) {
  return apiFetch<ProjectWorkflowInstance>(`/api/workflows/handoffs/${handoffId}/production-complete`, token, {
    method: "POST"
  });
}

export function returnProjectWorkflowHandoffToSchools(
  token: string,
  handoffId: string,
  payload: { return_reason: string; issue_flag?: boolean | null }
) {
  return apiFetch<ProjectWorkflowInstance>(`/api/workflows/handoffs/${handoffId}/return-to-schools`, token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export type WorkflowTemplateBuilderDraftPayload = {
  template_key: string;
  name: string;
  description?: string | null;
  job_type?: string | null;
  category?: string | null;
  departments_involved: string[];
};

export type WorkflowTemplateBuilderMilestonePayload = {
  milestone_key: string;
  name: string;
  description?: string | null;
  sort_order?: number | null;
  default_owner_type?: WorkflowTemplateBuilderOwnerType | null;
  default_owner_value?: string | null;
};

export type WorkflowTemplateBuilderStepPayload = {
  milestone_template_id: string;
  step_key: string;
  name: string;
  description?: string | null;
  sort_order?: number | null;
  department: string;
  role_key?: string | null;
  assigned_user_id?: string | null;
  owner_type: WorkflowTemplateBuilderOwnerType;
  owner_value?: string | null;
  required?: boolean | null;
  skippable?: boolean | null;
  blocking?: boolean | null;
  expected_duration_minutes?: number | null;
  due_offset_minutes?: number | null;
  dependency_mode?: WorkflowTemplateBuilderDependencyMode | null;
  blocked_behavior?: string | null;
  checklist_template_id?: string | null;
  depends_on_step_keys?: string[] | null;
};

export function listWorkflowTemplateBuilderTemplates(token: string) {
  return apiFetch<{ templates: WorkflowTemplateBuilderSummary[] }>("/api/workflows/template-builder/templates", token);
}

export function createWorkflowTemplateBuilderDraft(token: string, payload: WorkflowTemplateBuilderDraftPayload) {
  return apiFetch<WorkflowTemplateBuilderDetail>("/api/workflows/template-builder/templates", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getWorkflowTemplateBuilderDetail(token: string, templateId: string) {
  return apiFetch<WorkflowTemplateBuilderDetail>(`/api/workflows/template-builder/templates/${templateId}`, token);
}

export function addWorkflowTemplateBuilderMilestone(token: string, templateVersionId: string, payload: WorkflowTemplateBuilderMilestonePayload) {
  return apiFetch<WorkflowTemplateBuilderDetail>(`/api/workflows/template-builder/versions/${templateVersionId}/milestones`, token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function addWorkflowTemplateBuilderStep(token: string, templateVersionId: string, payload: WorkflowTemplateBuilderStepPayload) {
  return apiFetch<WorkflowTemplateBuilderDetail>(`/api/workflows/template-builder/versions/${templateVersionId}/steps`, token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateWorkflowTemplateBuilderStep(
  token: string,
  templateVersionId: string,
  stepId: string,
  payload: WorkflowTemplateBuilderStepPayload
) {
  return apiFetch<WorkflowTemplateBuilderDetail>(`/api/workflows/template-builder/versions/${templateVersionId}/steps/${stepId}`, token, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export type WorkflowAssignableUser = {
  user_id: string;
  full_name: string;
  email?: string | null;
  department?: string | null;
  membership_status?: string | null;
};

export function listWorkflowAssignableUsers(token: string) {
  return apiFetch<WorkflowAssignableUser[]>("/api/workflows/assignable-users", token);
}

export function moveWorkflowTemplateBuilderStep(token: string, templateVersionId: string, stepId: string, direction: "up" | "down") {
  return apiFetch<WorkflowTemplateBuilderDetail>(`/api/workflows/template-builder/versions/${templateVersionId}/steps/${stepId}/move`, token, {
    method: "POST",
    body: JSON.stringify({ direction })
  });
}

export function removeWorkflowTemplateBuilderStep(token: string, templateVersionId: string, stepId: string) {
  return apiFetch<WorkflowTemplateBuilderDetail>(`/api/workflows/template-builder/versions/${templateVersionId}/steps/${stepId}`, token, {
    method: "DELETE"
  });
}

export function publishWorkflowTemplateBuilderVersion(token: string, templateVersionId: string) {
  return apiFetch<WorkflowTemplateBuilderDetail>(`/api/workflows/template-builder/versions/${templateVersionId}/publish`, token, {
    method: "POST"
  });
}

export function archiveWorkflowTemplateBuilderVersion(token: string, templateVersionId: string) {
  return apiFetch<WorkflowTemplateBuilderDetail>(`/api/workflows/template-builder/versions/${templateVersionId}/archive`, token, {
    method: "POST"
  });
}
