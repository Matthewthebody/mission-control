import { apiFetch } from "../api";

// Knowledge review API service — the knowledge-owner workflow over
// /api/knowledge/*: pending versions, conflicts, unresolved questions,
// answer reports, and ingestion attention. All actions are reviewer-gated
// server-side and audited.

export type PendingVersion = {
  id: string;
  source_id: string;
  title: string;
  version_number: number;
  source_type: string;
  authority_class: string;
  publication_status: string;
  knowledge_mode: string;
  extraction_status: string;
  created_at: string;
  submitted_by_name: string | null;
};

export type OpenConflict = {
  id: string;
  status: string;
  note: string | null;
  created_at: string;
  source_a_title: string;
  source_b_title: string;
  version_a_id: string;
  version_b_id: string;
};

export type UnresolvedQuestion = {
  id: string;
  normalized_question: string;
  example_question: string;
  occurrence_count: number;
  departments_asking: string[];
  roles_asking: string[];
  status: string;
  last_asked_at: string;
};

export type AnswerReport = {
  id: string;
  feedback_kind: string;
  note: string | null;
  created_at: string;
  question: string;
  reporter_name: string | null;
};

export type IngestionAttention = {
  id: string;
  job_kind: string;
  status: string;
  attempts: number;
  error_message: string | null;
  created_at: string;
  source_title: string;
  source_version_id: string;
};

export type ReviewQueue = {
  pending_versions: PendingVersion[];
  open_conflicts: OpenConflict[];
  unresolved_questions: UnresolvedQuestion[];
  open_reports: AnswerReport[];
  ingestion_attention: IngestionAttention[];
};

export function getReviewQueue(token: string) {
  return apiFetch<ReviewQueue>("/api/knowledge/review-queue", token);
}

export function approveVersion(token: string, versionId: string, note?: string) {
  return apiFetch<{ version: unknown }>(`/api/knowledge/versions/${versionId}/approve`, token, {
    method: "POST",
    body: JSON.stringify(note ? { note } : {})
  });
}

export function rejectVersion(token: string, versionId: string, note: string) {
  return apiFetch<{ version: unknown }>(`/api/knowledge/versions/${versionId}/reject`, token, {
    method: "POST",
    body: JSON.stringify({ note })
  });
}

export function retireVersion(token: string, versionId: string, note?: string) {
  return apiFetch<{ version: unknown }>(`/api/knowledge/versions/${versionId}/retire`, token, {
    method: "POST",
    body: JSON.stringify(note ? { note } : {})
  });
}

export function resolveConflict(token: string, conflictId: string, resolution: "resolved" | "dismissed", note: string) {
  return apiFetch<{ conflict: unknown }>(`/api/knowledge/conflicts/${conflictId}/resolve`, token, {
    method: "POST",
    body: JSON.stringify({ resolution, note })
  });
}

export function retryIngestion(token: string, jobId: string) {
  return apiFetch<{ job: unknown }>(`/api/knowledge/ingestion-jobs/${jobId}/retry`, token, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function reviewReport(token: string, feedbackId: string, resolution: "reviewed" | "dismissed") {
  return apiFetch<{ report: unknown }>(`/api/knowledge/reports/${feedbackId}/review`, token, {
    method: "POST",
    body: JSON.stringify({ resolution })
  });
}

export function resolveQuestion(
  token: string,
  questionId: string,
  resolution: "answered" | "dismissed",
  note?: string
) {
  return apiFetch<{ question: unknown }>(`/api/knowledge/unresolved-questions/${questionId}/resolve`, token, {
    method: "POST",
    body: JSON.stringify(note ? { resolution, note } : { resolution })
  });
}

// ---------------------------------------------------------------------------
// Transcript & segment review (H3-E).
// ---------------------------------------------------------------------------

export const SEGMENT_CLASSIFICATIONS = [
  "approved_instruction",
  "approved_training",
  "current_workflow_observation",
  "pain_point",
  "future_design_idea",
  "raw_discussion",
  "evidence_only",
  "historical_reference",
  "restricted"
] as const;

export type SegmentClassification = (typeof SEGMENT_CLASSIFICATIONS)[number];

export const CLASSIFICATION_LABELS: Record<SegmentClassification, string> = {
  approved_instruction: "Approved instruction",
  approved_training: "Approved training",
  current_workflow_observation: "Verified current workflow",
  pain_point: "Pain point / workaround",
  future_design_idea: "Future-design idea",
  raw_discussion: "Raw discussion",
  evidence_only: "Evidence only",
  historical_reference: "Historical",
  restricted: "Restricted"
};

export type ReviewSegment = {
  id: string;
  ordinal: number;
  segment_kind: string;
  heading: string | null;
  locator_label: string | null;
  content: string;
  original_content: string | null;
  start_seconds: number | null;
  end_seconds: number | null;
  speaker_label: string | null;
  reviewer_classification: SegmentClassification | null;
  review_notes: string | null;
  updated_at: string;
};

export type VersionTranscript = {
  version: {
    id: string;
    publication_status: string;
    knowledge_mode: string;
    authority_class: string;
    extraction_status: string;
    media_duration_seconds: number | null;
    title: string;
    source_id: string;
    resource_library_item_id: string | null;
  };
  segments: ReviewSegment[];
  jobs: Array<{
    id: string;
    job_kind: string;
    status: string;
    attempts: number;
    error_message: string | null;
    provider: string | null;
    provider_request_id: string | null;
    created_at: string;
  }>;
};

export function getVersionTranscript(token: string, versionId: string) {
  return apiFetch<VersionTranscript>(`/api/knowledge/versions/${versionId}/segments`, token);
}

export function correctSegment(
  token: string,
  segmentId: string,
  patch: {
    content?: string;
    start_seconds?: number | null;
    end_seconds?: number | null;
    reviewer_classification?: SegmentClassification | null;
    speaker_label?: string | null;
    review_notes?: string | null;
    note?: string;
  }
) {
  return apiFetch<{ segment: ReviewSegment }>(`/api/knowledge/segments/${segmentId}`, token, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function cancelIngestion(token: string, jobId: string) {
  return apiFetch<{ job: unknown }>(`/api/knowledge/ingestion-jobs/${jobId}/cancel`, token, {
    method: "POST",
    body: JSON.stringify({})
  });
}
