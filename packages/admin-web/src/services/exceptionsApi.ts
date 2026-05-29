import { apiFetch } from "../api";
import type {
  OperationalExceptionActionPayload,
  OperationalExceptionDetail,
  OperationalExceptionWorkspace
} from "../exceptionTypes";

// Canonical frontend API wrapper for the operator-facing exception center.
// Legacy urgent-watch wrappers should delegate here instead of owning routes.

export async function getExceptionWorkspace(token: string, input?: { date?: string | null }) {
  const params = new URLSearchParams();
  if (input?.date) {
    params.set("date", input.date);
  }
  const suffix = params.size ? `?${params.toString()}` : "";
  return apiFetch<OperationalExceptionWorkspace>(`/api/exceptions${suffix}`, token);
}

export async function getExceptionDetail(token: string, itemId: string) {
  return apiFetch<OperationalExceptionDetail>(`/api/exceptions/${itemId}`, token);
}

export async function applyExceptionAction(token: string, itemId: string, input: OperationalExceptionActionPayload) {
  return apiFetch<OperationalExceptionDetail>(`/api/exceptions/${itemId}/actions`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}
