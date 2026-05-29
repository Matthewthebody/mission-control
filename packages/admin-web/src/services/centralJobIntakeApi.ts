import { ApiClientError, apiFetch } from "../api";
import type {
  CentralJobDraftResponse,
  CentralJobDraftListItem,
  CentralJobFormErrors,
  CentralJobImportColumnMapping,
  CentralJobImportCommitMode,
  CentralJobImportCommitResult,
  CentralJobImportSessionResponse,
  CentralJobIntakeInput,
  CentralJobIntakeResponse,
  CentralJobDuplicateResult,
  CentralJobOrganizationDefaults,
  CentralJobPublishResult,
  CentralJobSmartPasteParseResult
} from "../jobIntakeTypes";

const CENTRAL_JOB_INTAKE_BASE = "/api/shoots/intake";

export async function createCentralJobDraft(token: string, input: CentralJobIntakeInput) {
  return apiFetch<CentralJobDraftResponse>(`${CENTRAL_JOB_INTAKE_BASE}/drafts`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function parseCentralJobIntakeText(
  token: string,
  input: { raw_text: string; department_hint?: "schools" | "sports" | null }
) {
  return apiFetch<CentralJobSmartPasteParseResult>(`${CENTRAL_JOB_INTAKE_BASE}/parse`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getCentralJobDraft(token: string, draftId: string) {
  return apiFetch<CentralJobDraftResponse>(`${CENTRAL_JOB_INTAKE_BASE}/drafts/${draftId}`, token);
}

export async function listCentralJobDrafts(
  token: string,
  options: { department?: "schools" | "sports" | null } = {}
) {
  const params = new URLSearchParams();
  if (options.department) {
    params.set("department", options.department);
  }
  const query = params.toString();
  return apiFetch<{ drafts: CentralJobDraftListItem[] }>(
    `${CENTRAL_JOB_INTAKE_BASE}/drafts${query ? `?${query}` : ""}`,
    token
  );
}

export async function updateCentralJobDraft(token: string, draftId: string, input: CentralJobIntakeInput) {
  return apiFetch<CentralJobDraftResponse>(`${CENTRAL_JOB_INTAKE_BASE}/drafts/${draftId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function previewCentralJobDuplicates(token: string, draftId: string) {
  return apiFetch<CentralJobDuplicateResult>(`${CENTRAL_JOB_INTAKE_BASE}/drafts/${draftId}/duplicate-check`, token, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function getCentralJobReadinessPreview(token: string, draftId: string) {
  return apiFetch<CentralJobDraftResponse["readiness"]>(`${CENTRAL_JOB_INTAKE_BASE}/drafts/${draftId}/readiness`, token);
}

export async function publishCentralJobDraft(token: string, draftId: string, input: { duplicate_override_note?: string | null } = {}) {
  return apiFetch<CentralJobPublishResult>(`${CENTRAL_JOB_INTAKE_BASE}/drafts/${draftId}/publish`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getCentralJob(token: string, jobId: string) {
  return apiFetch<CentralJobIntakeResponse>(`${CENTRAL_JOB_INTAKE_BASE}/jobs/${jobId}`, token);
}

export async function updateCentralPublishedJob(token: string, jobId: string, input: CentralJobIntakeInput) {
  return apiFetch<CentralJobIntakeResponse>(`${CENTRAL_JOB_INTAKE_BASE}/jobs/${jobId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function getCentralJobOrganizationDefaults(token: string, organizationId: string, department: "schools" | "sports") {
  return apiFetch<CentralJobOrganizationDefaults>(
    `${CENTRAL_JOB_INTAKE_BASE}/organizations/${organizationId}/defaults?department=${department}`,
    token
  );
}

export async function createCentralJobImportSession(
  token: string,
  input: { department: "schools" | "sports"; source_filename: string; csv_text: string }
) {
  return apiFetch<CentralJobImportSessionResponse>(`${CENTRAL_JOB_INTAKE_BASE}/import-sessions`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getCentralJobImportSession(token: string, sessionId: string) {
  return apiFetch<CentralJobImportSessionResponse>(`${CENTRAL_JOB_INTAKE_BASE}/import-sessions/${sessionId}`, token);
}

export async function updateCentralJobImportMapping(
  token: string,
  sessionId: string,
  input: { mapping: CentralJobImportColumnMapping }
) {
  return apiFetch<CentralJobImportSessionResponse>(`${CENTRAL_JOB_INTAKE_BASE}/import-sessions/${sessionId}/mapping`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function commitCentralJobImportSession(
  token: string,
  sessionId: string,
  input: {
    mode?: CentralJobImportCommitMode;
    acknowledge_soft_duplicates?: boolean;
    override_hard_duplicates?: boolean;
    duplicate_override_note?: string | null;
  }
) {
  return apiFetch<CentralJobImportCommitResult>(`${CENTRAL_JOB_INTAKE_BASE}/import-sessions/${sessionId}/commit`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function extractCentralJobFormErrors(error: unknown): CentralJobFormErrors {
  if (!(error instanceof ApiClientError) || !error.details || typeof error.details !== "object") {
    return {
      fieldErrors: {},
      formErrors: [error instanceof Error ? error.message : "We couldn't save the job intake right now."],
      duplicateResult: null
    };
  }

  const details = error.details as {
    field_errors?: Record<string, string[]>;
    form_errors?: string[];
    duplicate_result?: CentralJobDuplicateResult;
  };

  return {
    fieldErrors: details.field_errors ?? {},
    formErrors: details.form_errors ?? [error.message],
    duplicateResult: details.duplicate_result ?? null
  };
}
