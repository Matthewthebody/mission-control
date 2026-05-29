import { apiFetch } from "../api";
import type { BreakGlassEventRecord, MicrosoftSecurityTruthWorkspace, SecurityApprovalRequestRecord, SecurityOverview, SessionUser } from "../types";

export function elevateSession(token: string, input: { current_password?: string; reason?: string; action_key?: string; return_hash?: string }) {
  return apiFetch<{ user: SessionUser }>("/auth/elevate", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function endSessionElevation(token: string) {
  return apiFetch<{ user: SessionUser }>("/auth/elevation/end", token, {
    method: "POST"
  });
}

export function startBreakGlass(
  token: string,
  input: { reason: string; scope_type?: string; scope_id?: string; duration_minutes?: number }
) {
  return apiFetch<{ user: SessionUser; break_glass_event_id: string }>("/auth/break-glass", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function endBreakGlass(token: string, input: { reason?: string }) {
  return apiFetch<{ user: SessionUser }>("/auth/break-glass/end", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getSecurityOverview(token: string) {
  return apiFetch<SecurityOverview>("/api/admin/security/overview", token);
}

export function getMicrosoftSecurityTruth(token: string) {
  return apiFetch<MicrosoftSecurityTruthWorkspace>("/api/admin/security/microsoft-truth", token);
}

export function updateMicrosoftSecurityTruth(
  token: string,
  controlKey: string,
  input: {
    status: "healthy" | "at_risk" | "blocked";
    what?: string;
    why?: string;
    fix?: string;
    owner?: string;
    retest?: string;
    expires_at?: string | null;
    evidence_items?: Array<{
      kind: "screenshot" | "file" | "link" | "note";
      label: string;
      href?: string | null;
      note?: string | null;
    }>;
  }
) {
  return apiFetch<MicrosoftSecurityTruthWorkspace>(`/api/admin/security/microsoft-truth/${encodeURIComponent(controlKey)}`, token, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function listSecurityApprovals(token: string, status?: string) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch<SecurityApprovalRequestRecord[]>(`/api/admin/security/approvals${query}`, token);
}

export function approveSecurityApproval(token: string, id: string, note?: string) {
  return apiFetch<{ ok: true; status: "executed" }>(`/api/admin/security/${id}/approve`, token, {
    method: "POST",
    body: JSON.stringify({ note })
  });
}

export function rejectSecurityApproval(token: string, id: string, note?: string) {
  return apiFetch<{ ok: true; status: "rejected" }>(`/api/admin/security/${id}/reject`, token, {
    method: "POST",
    body: JSON.stringify({ note })
  });
}

export function cancelSecurityApproval(token: string, id: string, note?: string) {
  return apiFetch<{ ok: true; status: "canceled" }>(`/api/admin/security/${id}/cancel`, token, {
    method: "POST",
    body: JSON.stringify({ note })
  });
}

export function listBreakGlassEvents(token: string) {
  return apiFetch<BreakGlassEventRecord[]>("/api/admin/security/break-glass-events", token);
}

export function reviewBreakGlassEvent(token: string, id: string, note?: string) {
  return apiFetch<{ ok: true }>(`/api/admin/security/break-glass-events/${id}/review`, token, {
    method: "POST",
    body: JSON.stringify({ note })
  });
}
