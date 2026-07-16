import { apiFetch } from "../api";

// Knowledge authoring API service (H5) — the operational desk endpoints:
// source workspace, dual-mode detail, governed revisions, draft editing,
// question conversion, segment split/merge, health, and synonym preview.

export type SourceListRow = {
  id: string;
  title: string;
  department_owner: string | null;
  owner_name: string | null;
  version_id: string | null;
  version_number: number | null;
  source_type: string | null;
  authority_class: string | null;
  publication_status: string | null;
  knowledge_mode: string | null;
  confidential: boolean | null;
  extraction_status: string | null;
  effective_until: string | null;
  review_due_at: string | null;
  updated_at: string;
};

export type SourceListResult = { total: number; sources: SourceListRow[]; limit: number; offset: number };

export function listSources(
  token: string,
  filters: { query?: string; status?: string; authority?: string; mode?: string; limit?: number; offset?: number } = {}
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<SourceListResult>(`/api/knowledge/sources${suffix}`, token);
}

export type SourceVersionRow = {
  id: string;
  version_number: number;
  source_type: string;
  authority_class: string;
  publication_status: string;
  knowledge_mode: string;
  confidential: boolean;
  department_scope: string[];
  role_scope: string[];
  effective_from: string | null;
  effective_until: string | null;
  review_due_at: string | null;
  supersedes_version_id: string | null;
  superseded_by_version_id: string | null;
  extraction_status: string;
  media_duration_seconds: number | null;
  inline_body: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
  review_notes: string | null;
  created_at: string;
};

export type ReviewerSourceDetail = {
  mode: "reviewer";
  source: {
    id: string;
    title: string;
    description: string | null;
    department_owner: string | null;
    resource_library_item_id: string | null;
    current_version_id: string | null;
    owner_name: string | null;
    created_by_name: string | null;
    created_at: string;
    updated_at: string;
    asset_file_name: string | null;
    asset_content_type: string | null;
  };
  versions: SourceVersionRow[];
  embedding_health: Array<{ status: string; n: number }>;
  jobs: Array<{
    id: string;
    source_version_id: string;
    job_kind: string;
    status: string;
    attempts: number;
    error_message: string | null;
    provider: string | null;
    created_at: string;
  }>;
  conflicts: Array<{
    id: string;
    status: string;
    note: string | null;
    resolution_note: string | null;
    created_at: string;
    version_a_id: string;
    version_b_id: string;
  }>;
  usage: { citations: number };
  reports: Array<{ id: string; feedback_kind: string; note: string | null; review_status: string; created_at: string }>;
  audit: Array<{ action: string; created_at: string; actor_name: string | null; metadata: Record<string, unknown> }>;
};

export type EmployeeSourceDetail = {
  mode: "employee";
  source: {
    id: string;
    title: string;
    description: string | null;
    resource_library_item_id: string | null;
    source_type: string;
    authority_class: string;
    knowledge_mode: string;
    approved_at: string | null;
    media_duration_seconds: number | null;
    version_id: string;
  };
  segments: Array<{
    id: string;
    ordinal: number;
    segment_kind: string;
    heading: string | null;
    locator_label: string | null;
    start_seconds: number | null;
    end_seconds: number | null;
  }>;
};

export type SourceDetail = ReviewerSourceDetail | EmployeeSourceDetail;

export function getSourceDetail(token: string, sourceId: string) {
  return apiFetch<SourceDetail>(`/api/knowledge/sources/${sourceId}`, token);
}

export function createRevision(token: string, sourceId: string, input: { inline_body?: string | null; note?: string }) {
  return apiFetch<{ version_id: string; version_number: number }>(`/api/knowledge/sources/${sourceId}/versions`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateDraft(
  token: string,
  versionId: string,
  input: { inline_body?: string | null; note?: string }
) {
  return apiFetch<{ version: unknown }>(`/api/knowledge/versions/${versionId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function createSource(
  token: string,
  input: {
    title: string;
    source_type: string;
    authority_class: string;
    knowledge_mode?: string;
    inline_body?: string;
    confidential?: boolean;
    description?: string;
  }
) {
  return apiFetch<{ source_id: string; version_id: string }>(`/api/knowledge/sources`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function submitVersion(token: string, versionId: string) {
  return apiFetch<{ version: unknown }>(`/api/knowledge/versions/${versionId}/submit`, token, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function ingestVersion(token: string, versionId: string, jobKind: "document_extract" | "media_transcribe") {
  return apiFetch<{ job_id: string }>(`/api/knowledge/versions/${versionId}/ingest`, token, {
    method: "POST",
    body: JSON.stringify({ job_kind: jobKind })
  });
}

export function convertQuestion(
  token: string,
  questionId: string,
  input: { title: string; body: string }
) {
  return apiFetch<{ source_id: string; version_id: string }>(
    `/api/knowledge/unresolved-questions/${questionId}/convert`,
    token,
    { method: "POST", body: JSON.stringify(input) }
  );
}

export function splitSegmentApi(
  token: string,
  segmentId: string,
  input: { offset_chars?: number; split_seconds?: number; note?: string }
) {
  return apiFetch<{ segment_ids: string[] }>(`/api/knowledge/segments/${segmentId}/split`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function mergeSegmentApi(token: string, segmentId: string, note?: string) {
  return apiFetch<{ segment_id: string }>(`/api/knowledge/segments/${segmentId}/merge-next`, token, {
    method: "POST",
    body: JSON.stringify(note ? { note } : {})
  });
}

export type KnowledgeHealth = {
  counts: {
    active_approved: number;
    pending_review: number;
    overdue_review: number;
    expiring_soon: number;
    open_conflicts: number;
    failed_ingestion: number;
    failed_embeddings: number;
    open_questions: number;
    open_reports: number;
  };
  top_unanswered: Array<{ example_question: string; occurrence_count: number; last_asked_at: string }>;
  most_cited: Array<{ id: string; title: string; citations: number }>;
  most_reported: Array<{ id: string; title: string; reports: number }>;
};

export function getKnowledgeHealthApi(token: string) {
  return apiFetch<KnowledgeHealth>(`/api/knowledge/health`, token);
}

export function previewSynonyms(token: string, question: string) {
  return apiFetch<{ terms: string[]; concepts: Array<{ term: string; variants: string[]; from_synonym: boolean }> }>(
    `/api/knowledge/synonyms/preview?q=${encodeURIComponent(question)}`,
    token
  );
}

export type SynonymRow = { id: string; term: string; expansion: string[]; note: string | null; created_at: string; created_by_name: string | null };

export function listSynonymsApi(token: string) {
  return apiFetch<{ synonyms: SynonymRow[] }>(`/api/knowledge/synonyms`, token);
}

export function upsertSynonymApi(token: string, input: { term: string; expansion: string[]; note?: string }) {
  return apiFetch<{ synonym: unknown }>(`/api/knowledge/synonyms`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function deleteSynonymApi(token: string, term: string) {
  return apiFetch<{ deleted: boolean }>(`/api/knowledge/synonyms/${encodeURIComponent(term)}`, token, {
    method: "DELETE"
  });
}
