import { apiFetch } from "../api";
import type { SharedTaskCreateInput, SharedTaskDetailResponse, SharedTaskListQuery, SharedTaskListResponse, SharedTaskUpdateInput } from "../workModelTypes";

const TASKS_BASE = "/api/tasks";

export async function listSharedTasks(token: string, filters: SharedTaskListQuery = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    params.set(key, typeof value === "boolean" ? String(value) : String(value));
  }
  const query = params.toString();
  return apiFetch<SharedTaskListResponse>(query ? `${TASKS_BASE}?${query}` : TASKS_BASE, token);
}

export async function createSharedTask(token: string, input: SharedTaskCreateInput) {
  return apiFetch<SharedTaskDetailResponse>(TASKS_BASE, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getSharedTaskDetail(token: string, taskId: string) {
  return apiFetch<SharedTaskDetailResponse>(`${TASKS_BASE}/${taskId}`, token);
}

export async function updateSharedTask(token: string, taskId: string, input: SharedTaskUpdateInput) {
  return apiFetch<SharedTaskDetailResponse>(`${TASKS_BASE}/${taskId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}
