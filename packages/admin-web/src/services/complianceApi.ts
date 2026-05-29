import { apiFetch } from "../api";
import type {
  ComplianceWorkspaceDetailPayload,
  ComplianceWorkspaceIssueType,
  ComplianceWorkspaceListPayload,
  ComplianceWorkspaceStatusBucket,
  ComplianceWorkspaceWindow
} from "../complianceTypes";

type ListComplianceWorkspaceInput = {
  date?: string;
  window?: ComplianceWorkspaceWindow;
  status?: ComplianceWorkspaceStatusBucket | "all";
  employeeId?: string;
  organizationId?: string;
  shootId?: string;
  issueType?: ComplianceWorkspaceIssueType;
};

export async function listComplianceWorkspace(token: string, input: ListComplianceWorkspaceInput) {
  const params = new URLSearchParams();
  if (input.date) {
    params.set("date", input.date);
  }
  if (input.window) {
    params.set("window", input.window);
  }
  if (input.status) {
    params.set("status", input.status);
  }
  if (input.employeeId) {
    params.set("employee_id", input.employeeId);
  }
  if (input.organizationId) {
    params.set("organization_id", input.organizationId);
  }
  if (input.shootId) {
    params.set("shoot_id", input.shootId);
  }
  if (input.issueType) {
    params.set("issue_type", input.issueType);
  }
  return apiFetch<ComplianceWorkspaceListPayload>(`/api/compliance/workspace?${params.toString()}`, token);
}

export async function getComplianceWorkspaceDetail(token: string, sourceKind: string, sourceId: string) {
  return apiFetch<ComplianceWorkspaceDetailPayload>(`/api/compliance/workspace/${sourceKind}/${sourceId}`, token);
}

export async function reviewComplianceAttendanceException(
  token: string,
  exceptionId: string,
  input: { status: "approved" | "rejected" | "resolved"; notes?: string | null; classification?: string | null }
) {
  return apiFetch(`/api/attendance/exceptions/${exceptionId}/review`, token, {
    method: "POST",
    body: JSON.stringify({
      status: input.status,
      notes: input.notes ?? null,
      classification: input.classification ?? null
    })
  });
}

export async function reviewComplianceMissedClockIn(
  token: string,
  exceptionId: string,
  input: { status: "approved" | "rejected" | "resolved"; correctedTime?: string | null; notes?: string | null }
) {
  return apiFetch(`/api/attendance/missed-punches/${exceptionId}/review`, token, {
    method: "POST",
    body: JSON.stringify({
      status: input.status,
      corrected_time: input.correctedTime ?? null,
      notes: input.notes ?? null
    })
  });
}
