import { apiFetch } from "../api";
import type { AccessPolicyPreview, AccessPolicyPreviewInput } from "../accessPolicyTypes";
import type {
  AuditEventListItem,
  CommunicationDiagnosticsResponse,
  CoreFoundationDiagnosticsResponse,
  DiagnosticFindingListItem,
  DiagnosticFindingUpdateInput,
  DiagnosticRuleRunSummary,
  DiagnosticsWorkspaceResponse,
  EntityTraceResponse,
  ExportAuditListItem,
  ImportAuditListItem,
  PolicyDecisionTraceListItem,
  RepairActionListItem,
  RepairActionRequest,
  RepairPreviewResponse,
  SyncHealthRecord,
  SystemHealthCheckRecord
} from "../systemDiagnosticsTypes";

const ADMIN_SYSTEM_BASE = "/api/admin/system";

export async function getSystemDiagnosticsWorkspace(token: string) {
  return apiFetch<DiagnosticsWorkspaceResponse>(`${ADMIN_SYSTEM_BASE}/workspace`, token);
}

export async function getSystemFoundationDiagnostics(token: string) {
  return apiFetch<CoreFoundationDiagnosticsResponse>(`${ADMIN_SYSTEM_BASE}/foundation`, token);
}

export async function getSystemCommunicationDiagnostics(token: string) {
  return apiFetch<CommunicationDiagnosticsResponse>(`${ADMIN_SYSTEM_BASE}/communications`, token);
}

export async function listSystemDiagnosticFindings(
  token: string,
  query: Record<string, string | number | boolean | undefined> = {}
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") {
      continue;
    }
    search.set(key, String(value));
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return apiFetch<DiagnosticFindingListItem[]>(`${ADMIN_SYSTEM_BASE}/diagnostics/findings${suffix}`, token);
}

export async function updateSystemDiagnosticFinding(
  token: string,
  findingId: string,
  input: DiagnosticFindingUpdateInput
) {
  return apiFetch<{ finding: DiagnosticFindingListItem | null }>(`${ADMIN_SYSTEM_BASE}/diagnostics/findings/${findingId}`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function runSystemDiagnosticRules(
  token: string,
  input: {
    rule_key?: string | null;
    resource_type?: string | null;
    resource_id?: string | null;
    department_type?: string | null;
    trigger_type?: string;
  }
) {
  return apiFetch<{ runs: DiagnosticRuleRunSummary[] }>(`${ADMIN_SYSTEM_BASE}/diagnostics/run`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function listSystemAuditEvents(
  token: string,
  query: Record<string, string | number | undefined> = {}
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") {
      continue;
    }
    search.set(key, String(value));
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return apiFetch<AuditEventListItem[]>(`${ADMIN_SYSTEM_BASE}/audit${suffix}`, token);
}

export async function getSystemEntityTrace(token: string, resourceType: string, resourceId: string) {
  return apiFetch<EntityTraceResponse>(`${ADMIN_SYSTEM_BASE}/trace/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}`, token);
}

export async function getSystemSyncHealth(token: string) {
  return apiFetch<{ sync_health: SyncHealthRecord[]; health_checks: SystemHealthCheckRecord[] }>(`${ADMIN_SYSTEM_BASE}/sync`, token);
}

export async function listSystemRepairActions(token: string, limit = 100) {
  return apiFetch<RepairActionListItem[]>(`${ADMIN_SYSTEM_BASE}/repairs?limit=${limit}`, token);
}

export async function previewSystemRepairAction(token: string, input: RepairActionRequest) {
  return apiFetch<RepairPreviewResponse>(`${ADMIN_SYSTEM_BASE}/repairs/preview`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function executeSystemRepairAction(token: string, input: RepairActionRequest) {
  return apiFetch<{ repair_action: RepairActionListItem }>(`${ADMIN_SYSTEM_BASE}/repairs/execute`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function listSystemPolicyTraces(
  token: string,
  query: Record<string, string | number | undefined> = {}
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") {
      continue;
    }
    search.set(key, String(value));
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return apiFetch<PolicyDecisionTraceListItem[]>(`${ADMIN_SYSTEM_BASE}/access-debug/traces${suffix}`, token);
}

export async function previewSystemAccessDecision(token: string, input: AccessPolicyPreviewInput) {
  return apiFetch<AccessPolicyPreview>(`${ADMIN_SYSTEM_BASE}/access-debug/preview`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function listSystemImportAudits(token: string, limit = 100) {
  return apiFetch<ImportAuditListItem[]>(`${ADMIN_SYSTEM_BASE}/imports?limit=${limit}`, token);
}

export async function listSystemExportAudits(token: string, limit = 100) {
  return apiFetch<ExportAuditListItem[]>(`${ADMIN_SYSTEM_BASE}/exports?limit=${limit}`, token);
}
