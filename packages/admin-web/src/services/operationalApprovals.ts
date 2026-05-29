import { apiFetch } from "../api";
import type {
  OperationalApprovalCreateInput,
  OperationalApprovalDetail,
  OperationalApprovalRequestSummary,
  OperationalApprovalSourceSummary,
  OperationalApprovalWorkspace
} from "../types";

export type OperationalApprovalDecisionPayload = {
  action: "approve" | "reject" | "send_back" | "cancel" | "resubmit" | "delegate";
  note?: string | null;
  delegate_to_user_id?: string | null;
};

export async function getOperationalApprovalWorkspace(token: string) {
  return apiFetch<OperationalApprovalWorkspace>("/api/approvals/operational", token);
}

export async function getOperationalApprovalDetail(token: string, requestId: string) {
  return apiFetch<OperationalApprovalDetail>(`/api/approvals/operational/${requestId}`, token);
}

export async function createOperationalApprovalRequest(token: string, input: OperationalApprovalCreateInput) {
  return apiFetch<OperationalApprovalRequestSummary>(`/api/approvals/operational`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function applyOperationalApprovalDecision(token: string, requestId: string, input: OperationalApprovalDecisionPayload) {
  return apiFetch<OperationalApprovalDetail>(`/api/approvals/operational/${requestId}/actions`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getOperationalApprovalSourceSummary(
  token: string,
  input: { source_module: string; source_entity_type: string; source_entity_id: string }
) {
  const params = new URLSearchParams({
    source_module: input.source_module,
    source_entity_type: input.source_entity_type,
    source_entity_id: input.source_entity_id
  });
  return apiFetch<OperationalApprovalSourceSummary>(`/api/approvals/source-summary?${params.toString()}`, token);
}
