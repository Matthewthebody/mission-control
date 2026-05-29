import type { UrgentWatchActionPayload, UrgentWatchDetail, UrgentWatchWorkspace } from "../urgentWatchTypes";
import { applyExceptionAction, getExceptionDetail, getExceptionWorkspace } from "./exceptionsApi";

// Legacy urgent-watch service names remain as a compatibility alias while
// Exceptions owns the canonical frontend API contract.
export async function getUrgentWatchWorkspace(token: string, input?: { date?: string | null }) {
  return getExceptionWorkspace(token, input) as Promise<UrgentWatchWorkspace>;
}

export async function getUrgentWatchDetail(token: string, itemId: string) {
  return getExceptionDetail(token, itemId) as Promise<UrgentWatchDetail>;
}

export async function applyUrgentWatchAction(token: string, itemId: string, input: UrgentWatchActionPayload) {
  return applyExceptionAction(token, itemId, input) as Promise<UrgentWatchDetail>;
}
