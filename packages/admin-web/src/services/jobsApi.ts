import { apiFetch } from "../api";
import type {
  SharedAlertCenterQuery,
  SharedAlertCenterResponse,
  SharedApprovalRequestInput,
  SharedDashboardResponse,
  SharedDashboardWidgetPreference,
  SharedDashboardWidgetPreferenceInput,
  SharedDeliverableItemInput,
  SharedJobDay,
  SharedJobDayInput,
  SharedJobDayNoteInput,
  SharedJobDayStatusUpdateInput,
  SharedJobDetailResponse,
  SharedJobDraftInput,
  SharedJobLifecycleReasonInput,
  SharedJobListItem,
  SharedJobListQuery,
  SharedJobPrepReadinessQueueIssue,
  SharedJobPrepReadinessQueueResponse,
  SharedJobPrepReadinessStatus,
  SharedJobStaffAssignmentCreateInput,
  SharedJobReadinessItem,
  SharedJobReadinessUpdateInput,
  SharedJobReadyConfirmationInput,
  SharedJobStaffAssignmentUpdateInput,
  SharedJobWatchFlagInput,
  SharedProductionIssueInput,
  SharedProductionItemInput,
  SharedProductionHandoffInput,
  SharedProductionQueueQuery,
  SharedProductionQueueResponse,
  SharedProductionReportingQuery,
  SharedProductionReportingResponse,
  SharedQaFindingInput,
  SharedQaReviewInput,
  SharedWatchlistQuery,
  SharedWatchlistResponse,
  SharedWatchlistSavedView,
  SharedWatchlistSavedViewInput
} from "../jobTruthTypes";

const JOBS_BASE = "/api/jobs";

function buildSharedProductionSearchParams(
  query: SharedProductionQueueQuery | SharedProductionReportingQuery = {}
): URLSearchParams {
  const params = new URLSearchParams();
  if (query.department_type && query.department_type !== "all") {
    params.set("department_type", query.department_type);
  }
  if (query.status) {
    params.set("status", query.status);
  }
  if (query.workflow_status) {
    params.set("workflow_status", query.workflow_status);
  }
  if (query.health_state) {
    params.set("health_state", query.health_state);
  }
  if (query.approval_status) {
    params.set("approval_status", query.approval_status);
  }
  if (query.qa_status) {
    params.set("qa_status", query.qa_status);
  }
  if (query.assigned_to_user_id) {
    params.set("assigned_to_user_id", query.assigned_to_user_id);
  }
  if (query.blocked) {
    params.set("blocked", query.blocked);
  }
  if (query.priority) {
    params.set("priority", query.priority);
  }
  if (query.due_bucket) {
    params.set("due_bucket", query.due_bucket);
  }
  if ("due_window" in query && query.due_window && query.due_window !== "all") {
    params.set("due_window", query.due_window);
  }
  if (query.search?.trim()) {
    params.set("search", query.search.trim());
  }
  if (query.deliverable_type?.trim()) {
    params.set("deliverable_type", query.deliverable_type.trim());
  }
  if (query.organization_id) {
    params.set("organization_id", query.organization_id);
  }
  if (query.release_status) {
    params.set("release_status", query.release_status);
  }
  if (query.checklist_state) {
    params.set("checklist_state", query.checklist_state);
  }
  return params;
}

export async function listSharedJobs(token: string, query: SharedJobListQuery = {}) {
  const params = new URLSearchParams();
  if (query.department_type && query.department_type !== "all") {
    params.set("department_type", query.department_type);
  }
  if (query.search?.trim()) {
    params.set("search", query.search.trim());
  }
  if (query.day_date?.trim()) {
    params.set("day_date", query.day_date.trim());
  }
  if (query.production_status?.trim()) {
    params.set("production_status", query.production_status.trim());
  }
  if (query.readiness_status?.trim()) {
    params.set("readiness_status", query.readiness_status.trim());
  }
  const search = params.toString();
  return apiFetch<{ jobs: SharedJobListItem[] }>(`${JOBS_BASE}${search ? `?${search}` : ""}`, token);
}

export async function getSharedJobDetail(token: string, jobId: string) {
  return apiFetch<SharedJobDetailResponse>(`${JOBS_BASE}/${jobId}`, token);
}

// ── Canonical Jobs index (Phase 3B/3C) ───────────────────────────────────────
export type JobIndexMetricSummary = { key: string; label: string; available: boolean; reason?: string; count: number | null };
export type JobIndexRow = {
  id: string;
  job_number: string | null;
  title: string;
  event_name: string | null;
  organization_id: string | null;
  organization_name: string | null;
  department_type: string;
  job_category: string | null;
  job_date: string | null;
  account_owner_user_id: string | null;
  owner_name: string | null;
  job_status: string;
  production_status: string;
  readiness_status: string;
  risk_status: string;
  staffing_status: string;
  client_deadline_at: string | null;
  production_deadline_at: string | null;
  blocker_count: number;
  open_watch_flag_count: number;
  incomplete_required_count: number;
  workflow_run_count: number;
  production_item_count: number;
  linked_shoot_count: number;
  shoot_data_available: boolean;
  staffing_data_available: boolean;
  schedule_data_available: boolean;
  workflow_data_available: boolean;
  production_data_available: boolean;
  shoot_link_status: "linked" | "unlinked";
  attention_reasons: string[];
  linked_shoot_ids: string[];
  link_sources: string[];
  single_linked_shoot_id: string | null;
  operational_data_available: boolean;
  operational_link_explanation: string | null;
};
export type JobsIndexResponse = {
  rows: JobIndexRow[];
  summary: { total: number; metrics: JobIndexMetricSummary[] };
  page: { limit: number; offset: number; total: number; returned: number; has_more: boolean };
  attention_reason_availability: { job_native: string[]; unavailable: Array<{ reason: string; explanation: string }> };
  applied_metric: string | null;
  tenant_is_demo: boolean;
};

export async function getJobsIndex(token: string, query: Record<string, string | number | undefined | null> = {}): Promise<JobsIndexResponse> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && `${v}` !== "") params.set(k, String(v));
  }
  const search = params.toString();
  return apiFetch<JobsIndexResponse>(`${JOBS_BASE}/index${search ? `?${search}` : ""}`, token);
}

// Single-Job quick view by jobs.id, for an off-page deep-linked ?selected=<id>. Same
// row shape as the index. A non-Job id (e.g. a Shoot id), cross-tenant, or unauthorized
// department resolves to a 404 (apiFetch throws with status 404).
export async function getJobQuickView(token: string, jobId: string): Promise<{ row: JobIndexRow }> {
  return apiFetch<{ row: JobIndexRow }>(`${JOBS_BASE}/quick-view/${encodeURIComponent(jobId)}`, token);
}

export type SharedJobStatusCounts = {
  total_active: number;
  behind: number;
  at_risk: number;
  blocked_production: number;
  high_risk: number;
  staffing_gap: number;
};

// Accurate, uncapped canonical job-status counts behind the Company Command
// headline cards. Each count maps to a single Jobs-index filter so the card's
// number and its #jobs?<filter> drilldown stay coherent.
export async function getSharedJobStatusCounts(
  token: string,
  department_type?: SharedJobListQuery["department_type"]
) {
  const params = new URLSearchParams();
  if (department_type && department_type !== "all") {
    params.set("department_type", department_type);
  }
  const search = params.toString();
  return apiFetch<{ counts: SharedJobStatusCounts }>(
    `${JOBS_BASE}/status-counts${search ? `?${search}` : ""}`,
    token
  );
}

export async function listSharedPrepReadinessQueue(
  token: string,
  query: {
    status?: SharedJobPrepReadinessStatus | "all";
    issue?: SharedJobPrepReadinessQueueIssue | "all";
    department_type?: SharedJobListQuery["department_type"] | "all";
    limit?: number;
  } = {}
) {
  const params = new URLSearchParams();
  if (query.status && query.status !== "all") {
    params.set("status", query.status);
  }
  if (query.issue && query.issue !== "all") {
    params.set("issue", query.issue);
  }
  if (query.department_type && query.department_type !== "all") {
    params.set("department_type", query.department_type);
  }
  if (query.limit) {
    params.set("limit", String(query.limit));
  }
  const search = params.toString();
  return apiFetch<SharedJobPrepReadinessQueueResponse>(`${JOBS_BASE}/prep-readiness-queue${search ? `?${search}` : ""}`, token);
}

export async function listSharedProductionQueue(token: string, query: SharedProductionQueueQuery = {}) {
  const params = buildSharedProductionSearchParams(query);
  const search = params.toString();
  return apiFetch<SharedProductionQueueResponse>(`${JOBS_BASE}/production-items${search ? `?${search}` : ""}`, token);
}

export async function getSharedProductionReporting(token: string, query: SharedProductionReportingQuery = {}) {
  const params = buildSharedProductionSearchParams(query);
  const search = params.toString();
  return apiFetch<SharedProductionReportingResponse>(`${JOBS_BASE}/production-items/reporting${search ? `?${search}` : ""}`, token);
}

export async function listSharedWatchlist(token: string, query: SharedWatchlistQuery = {}) {
  const params = new URLSearchParams();
  if (query.department_type && query.department_type !== "all") {
    params.set("department_type", query.department_type);
  }
  if (query.severity) {
    params.set("severity", query.severity);
  }
  if (query.flag_type?.trim()) {
    params.set("flag_type", query.flag_type.trim());
  }
  if (query.owner_user_id) {
    params.set("owner_user_id", query.owner_user_id);
  }
  if (query.status) {
    params.set("status", query.status);
  }
  if (query.source_entity_type?.trim()) {
    params.set("source_entity_type", query.source_entity_type.trim());
  }
  if (query.only_mine) {
    params.set("only_mine", "yes");
  }
  if (query.next_24_hours) {
    params.set("next_24_hours", "yes");
  }
  if (query.critical_high_only) {
    params.set("critical_high_only", "yes");
  }
  if (query.only_snoozed) {
    params.set("only_snoozed", "yes");
  }
  if (query.only_escalated) {
    params.set("only_escalated", "yes");
  }
  if (query.view_id) {
    params.set("view_id", query.view_id);
  }
  if (query.limit) {
    params.set("limit", String(query.limit));
  }
  const search = params.toString();
  return apiFetch<SharedWatchlistResponse>(`${JOBS_BASE}/watchlist${search ? `?${search}` : ""}`, token);
}

export async function listSharedExceptions(token: string, query: SharedWatchlistQuery = {}) {
  const params = new URLSearchParams();
  if (query.department_type && query.department_type !== "all") {
    params.set("department_type", query.department_type);
  }
  if (query.severity) {
    params.set("severity", query.severity);
  }
  if (query.flag_type?.trim()) {
    params.set("flag_type", query.flag_type.trim());
  }
  if (query.owner_user_id) {
    params.set("owner_user_id", query.owner_user_id);
  }
  if (query.status) {
    params.set("status", query.status);
  }
  if (query.source_entity_type?.trim()) {
    params.set("source_entity_type", query.source_entity_type.trim());
  }
  if (query.only_mine) {
    params.set("only_mine", "yes");
  }
  if (query.next_24_hours) {
    params.set("next_24_hours", "yes");
  }
  if (query.critical_high_only) {
    params.set("critical_high_only", "yes");
  }
  if (query.only_snoozed) {
    params.set("only_snoozed", "yes");
  }
  if (query.only_escalated) {
    params.set("only_escalated", "yes");
  }
  if (query.view_id) {
    params.set("view_id", query.view_id);
  }
  if (query.limit) {
    params.set("limit", String(query.limit));
  }
  const search = params.toString();
  return apiFetch<SharedWatchlistResponse>(`${JOBS_BASE}/exceptions${search ? `?${search}` : ""}`, token);
}

export async function listSharedWatchlistSavedViews(token: string, departmentType?: SharedWatchlistQuery["department_type"]) {
  const params = new URLSearchParams();
  if (departmentType && departmentType !== "all") {
    params.set("department_type", departmentType);
  }
  const search = params.toString();
  return apiFetch<{ views: SharedWatchlistSavedView[] }>(`${JOBS_BASE}/watchlist/saved-views${search ? `?${search}` : ""}`, token);
}

export async function listSharedExceptionSavedViews(token: string, departmentType?: SharedWatchlistQuery["department_type"]) {
  const params = new URLSearchParams();
  if (departmentType && departmentType !== "all") {
    params.set("department_type", departmentType);
  }
  const search = params.toString();
  return apiFetch<{ views: SharedWatchlistSavedView[] }>(`${JOBS_BASE}/exceptions/saved-views${search ? `?${search}` : ""}`, token);
}

export async function createSharedWatchlistSavedView(token: string, input: SharedWatchlistSavedViewInput) {
  return apiFetch<{ view: SharedWatchlistSavedView }>(`${JOBS_BASE}/watchlist/saved-views`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateSharedWatchlistSavedView(token: string, viewId: string, input: Partial<SharedWatchlistSavedViewInput>) {
  return apiFetch<{ view: SharedWatchlistSavedView }>(`${JOBS_BASE}/watchlist/saved-views/${viewId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function deleteSharedWatchlistSavedView(token: string, viewId: string) {
  return apiFetch<void>(`${JOBS_BASE}/watchlist/saved-views/${viewId}`, token, {
    method: "DELETE"
  });
}

export async function acknowledgeSharedWatchFlag(token: string, flagId: string) {
  return apiFetch<void>(`${JOBS_BASE}/watch-flags/${flagId}/acknowledge`, token, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function snoozeSharedWatchFlag(token: string, flagId: string, snooze_until: string, note?: string | null) {
  return apiFetch<void>(`${JOBS_BASE}/watch-flags/${flagId}/snooze`, token, {
    method: "POST",
    body: JSON.stringify({ snooze_until, note: note ?? null })
  });
}

export async function resolveSharedWatchFlag(
  token: string,
  flagId: string,
  input: { note?: string | null; resolution_note?: string | null; root_cause?: string | null; follow_up_required?: boolean | null }
) {
  return apiFetch<void>(`${JOBS_BASE}/watch-flags/${flagId}/resolve`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function dismissSharedWatchFlag(token: string, flagId: string, reason: string) {
  return apiFetch<void>(`${JOBS_BASE}/watch-flags/${flagId}/dismiss`, token, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

export async function escalateSharedWatchFlag(
  token: string,
  flagId: string,
  input: { severity?: SharedJobWatchFlagInput["severity"]; owner_user_id?: string | null; escalated_to_role?: string | null; due_at?: string | null; note?: string | null }
) {
  return apiFetch<void>(`${JOBS_BASE}/watch-flags/${flagId}/escalate`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function listSharedAlerts(token: string, query: SharedAlertCenterQuery = {}) {
  const params = new URLSearchParams();
  if (query.unread_only) {
    params.set("unread_only", "yes");
  }
  if (query.limit) {
    params.set("limit", String(query.limit));
  }
  const search = params.toString();
  return apiFetch<SharedAlertCenterResponse>(`${JOBS_BASE}/alerts${search ? `?${search}` : ""}`, token);
}

export async function markSharedAlertRead(token: string, deliveryId: string) {
  return apiFetch<{ delivery: { id: string; alert_event_id: string; read_at: string | null } }>(`${JOBS_BASE}/alerts/${deliveryId}/read`, token, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function markSharedAlertActed(token: string, deliveryId: string, action_type: string) {
  return apiFetch<{ delivery: { id: string; alert_event_id: string; acted_at: string | null; action_type: string | null } }>(
    `${JOBS_BASE}/alerts/${deliveryId}/acted`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ action_type })
    }
  );
}

export async function getSharedDashboard(token: string, scope: "home" | "executive" | "today", department_type?: SharedJobListQuery["department_type"]) {
  const params = new URLSearchParams();
  if (department_type && department_type !== "all") {
    params.set("department_type", department_type);
  }
  const search = params.toString();
  return apiFetch<SharedDashboardResponse>(`${JOBS_BASE}/dashboard/${scope}${search ? `?${search}` : ""}`, token);
}

export async function listSharedDashboardWidgetPreferences(token: string, dashboard_scope = "home") {
  const params = new URLSearchParams();
  params.set("dashboard_scope", dashboard_scope);
  return apiFetch<{ preferences: SharedDashboardWidgetPreference[] }>(`${JOBS_BASE}/dashboard/widget-preferences?${params.toString()}`, token);
}

export async function saveSharedDashboardWidgetPreferences(token: string, input: SharedDashboardWidgetPreferenceInput) {
  return apiFetch<{ preferences: SharedDashboardWidgetPreference[] }>(`${JOBS_BASE}/dashboard/widget-preferences`, token, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function createSharedJobDraft(token: string, input: SharedJobDraftInput) {
  return apiFetch<SharedJobDetailResponse>(`${JOBS_BASE}/drafts`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateSharedJobDraft(token: string, jobId: string, input: SharedJobDraftInput) {
  return apiFetch<SharedJobDetailResponse>(`${JOBS_BASE}/drafts/${jobId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function updateSharedPublishedJob(token: string, jobId: string, input: SharedJobDraftInput) {
  return apiFetch<SharedJobDetailResponse>(`${JOBS_BASE}/${jobId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function publishSharedJob(token: string, jobId: string) {
  return apiFetch<SharedJobDetailResponse>(`${JOBS_BASE}/${jobId}/publish`, token, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function addSharedJobDay(token: string, jobId: string, input: SharedJobDayInput) {
  return apiFetch<SharedJobDetailResponse>(`${JOBS_BASE}/${jobId}/days`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function addSharedJobStaffAssignment(token: string, jobId: string, input: SharedJobStaffAssignmentCreateInput) {
  return apiFetch<SharedJobDetailResponse>(`${JOBS_BASE}/${jobId}/staff-assignments`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function checkInSharedJobStaff(token: string, jobId: string, assignmentId: string) {
  return apiFetch<SharedJobDetailResponse>(`${JOBS_BASE}/${jobId}/staff-assignments/${assignmentId}/check-in`, token, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function markSharedJobDayReady(
  token: string,
  jobId: string,
  dayId: string,
  input: SharedJobReadyConfirmationInput | string | null = null
) {
  return apiFetch<SharedJobDetailResponse>(`${JOBS_BASE}/${jobId}/days/${dayId}/ready`, token, {
    method: "POST",
    body: JSON.stringify(typeof input === "string" || input == null ? { note: input } : input)
  });
}

export async function completeSharedReadinessItem(
  token: string,
  jobId: string,
  itemId: string,
  input: SharedJobReadinessUpdateInput | string | null = null
) {
  return apiFetch<SharedJobDetailResponse>(`${JOBS_BASE}/${jobId}/readiness-items/${itemId}/complete`, token, {
    method: "POST",
    body: JSON.stringify(typeof input === "string" || input == null ? { note: input } : input)
  });
}

export async function updateSharedReadinessItem(token: string, jobId: string, itemId: string, input: SharedJobReadinessUpdateInput) {
  return apiFetch<SharedJobDetailResponse>(`${JOBS_BASE}/${jobId}/readiness-items/${itemId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function updateSharedJobStaffAssignment(
  token: string,
  jobId: string,
  assignmentId: string,
  input: SharedJobStaffAssignmentUpdateInput
) {
  return apiFetch<SharedJobDetailResponse>(`${JOBS_BASE}/${jobId}/staff-assignments/${assignmentId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function updateSharedJobDay(token: string, jobId: string, dayId: string, input: SharedJobDayStatusUpdateInput) {
  return apiFetch<SharedJobDetailResponse>(`${JOBS_BASE}/${jobId}/days/${dayId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function addSharedJobDayNote(token: string, jobId: string, dayId: string, input: SharedJobDayNoteInput) {
  return apiFetch<SharedJobDetailResponse>(`${JOBS_BASE}/${jobId}/days/${dayId}/notes`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function createOrResolveSharedJobWatchFlag(token: string, jobId: string, input: SharedJobWatchFlagInput) {
  return apiFetch<SharedJobDetailResponse>(`${JOBS_BASE}/${jobId}/watch-flags`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function cancelSharedJob(token: string, jobId: string, input: SharedJobLifecycleReasonInput) {
  return apiFetch<SharedJobDetailResponse>(`${JOBS_BASE}/${jobId}/cancel`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function postponeSharedJob(token: string, jobId: string, input: SharedJobLifecycleReasonInput) {
  return apiFetch<SharedJobDetailResponse>(`${JOBS_BASE}/${jobId}/postpone`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function archiveSharedJob(token: string, jobId: string, reason?: string) {
  return apiFetch<SharedJobDetailResponse>(`${JOBS_BASE}/${jobId}/archive`, token, {
    method: "POST",
    body: JSON.stringify(reason ? { reason } : {})
  });
}

export async function restoreSharedJob(token: string, jobId: string) {
  return apiFetch<SharedJobDetailResponse>(`${JOBS_BASE}/${jobId}/restore`, token, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function createOrUpdateSharedProductionItem(
  token: string,
  jobId: string,
  input: SharedProductionItemInput,
  productionItemId?: string
) {
  const isUpdate = Boolean(productionItemId || input.id);
  const targetId = productionItemId ?? input.id;
  return apiFetch<SharedJobDetailResponse>(
    isUpdate ? `${JOBS_BASE}/${jobId}/production-items/${targetId}` : `${JOBS_BASE}/${jobId}/production-items`,
    token,
    {
      method: isUpdate ? "PATCH" : "POST",
      body: JSON.stringify(input)
    }
  );
}

export async function createOrUpdateSharedProductionHandoff(
  token: string,
  jobId: string,
  productionItemId: string,
  input: SharedProductionHandoffInput,
  handoffId?: string
) {
  const isUpdate = Boolean(handoffId || input.id);
  const targetId = handoffId ?? input.id;
  return apiFetch<SharedJobDetailResponse>(
    isUpdate
      ? `${JOBS_BASE}/${jobId}/production-items/${productionItemId}/handoffs/${targetId}`
      : `${JOBS_BASE}/${jobId}/production-items/${productionItemId}/handoffs`,
    token,
    {
      method: isUpdate ? "PATCH" : "POST",
      body: JSON.stringify(input)
    }
  );
}

export async function createOrUpdateSharedApprovalRequest(
  token: string,
  jobId: string,
  productionItemId: string,
  input: SharedApprovalRequestInput,
  approvalId?: string
) {
  const isUpdate = Boolean(approvalId || input.id);
  const targetId = approvalId ?? input.id;
  return apiFetch<SharedJobDetailResponse>(
    isUpdate
      ? `${JOBS_BASE}/${jobId}/production-items/${productionItemId}/approvals/${targetId}`
      : `${JOBS_BASE}/${jobId}/production-items/${productionItemId}/approvals`,
    token,
    {
      method: isUpdate ? "PATCH" : "POST",
      body: JSON.stringify(input)
    }
  );
}

export async function createOrUpdateSharedQaReview(
  token: string,
  jobId: string,
  productionItemId: string,
  input: SharedQaReviewInput,
  qaReviewId?: string
) {
  const isUpdate = Boolean(qaReviewId || input.id);
  const targetId = qaReviewId ?? input.id;
  return apiFetch<SharedJobDetailResponse>(
    isUpdate
      ? `${JOBS_BASE}/${jobId}/production-items/${productionItemId}/qa-reviews/${targetId}`
      : `${JOBS_BASE}/${jobId}/production-items/${productionItemId}/qa-reviews`,
    token,
    {
      method: isUpdate ? "PATCH" : "POST",
      body: JSON.stringify(input)
    }
  );
}

export async function createOrUpdateSharedQaFinding(
  token: string,
  jobId: string,
  productionItemId: string,
  qaReviewId: string,
  input: SharedQaFindingInput,
  findingId?: string
) {
  const isUpdate = Boolean(findingId || input.id);
  const targetId = findingId ?? input.id;
  return apiFetch<SharedJobDetailResponse>(
    isUpdate
      ? `${JOBS_BASE}/${jobId}/production-items/${productionItemId}/qa-reviews/${qaReviewId}/findings/${targetId}`
      : `${JOBS_BASE}/${jobId}/production-items/${productionItemId}/qa-reviews/${qaReviewId}/findings`,
    token,
    {
      method: isUpdate ? "PATCH" : "POST",
      body: JSON.stringify(input)
    }
  );
}

export async function createOrUpdateSharedDeliverableItem(
  token: string,
  jobId: string,
  productionItemId: string,
  input: SharedDeliverableItemInput,
  deliverableId?: string
) {
  const isUpdate = Boolean(deliverableId || input.id);
  const targetId = deliverableId ?? input.id;
  return apiFetch<SharedJobDetailResponse>(
    isUpdate
      ? `${JOBS_BASE}/${jobId}/production-items/${productionItemId}/deliverables/${targetId}`
      : `${JOBS_BASE}/${jobId}/production-items/${productionItemId}/deliverables`,
    token,
    {
      method: isUpdate ? "PATCH" : "POST",
      body: JSON.stringify(input)
    }
  );
}

export async function createOrUpdateSharedProductionIssue(
  token: string,
  jobId: string,
  productionItemId: string,
  input: SharedProductionIssueInput,
  issueId?: string
) {
  const isUpdate = Boolean(issueId || input.id);
  const targetId = issueId ?? input.id;
  return apiFetch<SharedJobDetailResponse>(
    isUpdate
      ? `${JOBS_BASE}/${jobId}/production-items/${productionItemId}/issues/${targetId}`
      : `${JOBS_BASE}/${jobId}/production-items/${productionItemId}/issues`,
    token,
    {
      method: isUpdate ? "PATCH" : "POST",
      body: JSON.stringify(input)
    }
  );
}

export function derivePrimaryDay(days: SharedJobDay[]) {
  return days[0] ?? null;
}

export function deriveOpenReadinessItems(items: SharedJobReadinessItem[]) {
  return items.filter((item) => !item.is_complete);
}
