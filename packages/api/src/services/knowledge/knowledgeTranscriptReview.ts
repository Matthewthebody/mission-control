import type { PoolClient } from "pg";
import { ApiError } from "../../errors/apiError.js";
import type { AuthUser } from "../../types/auth.js";
import { createAuditLog } from "../audit.js";
import { requireKnowledgeReviewer } from "./knowledgeGovernance.js";

// Transcript and segment review (charter H3-E).
//
// Authorized reviewers inspect and correct extracted/transcribed segments:
// text, timestamps, speaker, classification, and notes. Every correction is
// audited with full before/after values; the provider's original text is
// preserved on first edit (provider transcript vs reviewer-corrected
// transcript stay distinguishable). Classification drives retrieval
// eligibility through SEGMENT_ELIGIBILITY_SQL, and corrected content
// re-embeds automatically because the embedding lifecycle fingerprints
// segment content (md5 mismatch → re-embed).
//
// Corrections to segments of an APPROVED version require an explicit review
// note; the audit row is the revision record. A full draft-revision workflow
// (propose → approve a corrected transcript as a new version) is H5 scope.

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

export async function listVersionSegments(client: PoolClient, auth: AuthUser, versionId: string) {
  requireKnowledgeReviewer(auth);
  const version = await client.query(
    `SELECT v.id::text, v.publication_status, v.knowledge_mode, v.authority_class, v.extraction_status,
            v.media_duration_seconds::float, s.title, s.id::text AS source_id, s.resource_library_item_id::text
     FROM knowledge_source_version v
     JOIN knowledge_source s ON s.id = v.source_id AND s.tenant_id = v.tenant_id
     WHERE v.tenant_id = $1 AND v.id = $2 LIMIT 1`,
    [auth.tenantId, versionId]
  );
  if (!version.rows[0]) {
    throw new ApiError(404, "Knowledge source version not found");
  }
  const segments = await client.query(
    `SELECT id::text, ordinal, segment_kind, heading, locator_label, content, original_content,
            start_seconds::float, end_seconds::float, speaker_label, reviewer_classification,
            review_notes, updated_at::text
     FROM knowledge_segment
     WHERE tenant_id = $1 AND source_version_id = $2
     ORDER BY ordinal`,
    [auth.tenantId, versionId]
  );
  const jobs = await client.query(
    `SELECT id::text, job_kind, status, attempts, error_message, provider, provider_request_id, created_at::text
     FROM knowledge_ingestion_job
     WHERE tenant_id = $1 AND source_version_id = $2
     ORDER BY created_at DESC
     LIMIT 10`,
    [auth.tenantId, versionId]
  );
  return { version: version.rows[0], segments: segments.rows, jobs: jobs.rows };
}

export async function correctSegment(
  client: PoolClient,
  auth: AuthUser,
  segmentId: string,
  input: {
    content?: string;
    startSeconds?: number | null;
    endSeconds?: number | null;
    reviewerClassification?: SegmentClassification | null;
    speakerLabel?: string | null;
    reviewNotes?: string | null;
    note?: string | null;
  }
) {
  requireKnowledgeReviewer(auth);
  const existing = await client.query<{
    id: string;
    source_version_id: string;
    segment_kind: string;
    content: string;
    original_content: string | null;
    start_seconds: number | null;
    end_seconds: number | null;
    speaker_label: string | null;
    reviewer_classification: string | null;
    review_notes: string | null;
    publication_status: string;
    media_duration_seconds: number | null;
  }>(
    `SELECT seg.id::text, seg.source_version_id::text, seg.segment_kind, seg.content, seg.original_content,
            seg.start_seconds::float, seg.end_seconds::float, seg.speaker_label, seg.reviewer_classification,
            seg.review_notes, v.publication_status, v.media_duration_seconds::float
     FROM knowledge_segment seg
     JOIN knowledge_source_version v ON v.id = seg.source_version_id AND v.tenant_id = seg.tenant_id
     WHERE seg.tenant_id = $1 AND seg.id = $2 LIMIT 1`,
    [auth.tenantId, segmentId]
  );
  const segment = existing.rows[0];
  if (!segment) {
    throw new ApiError(404, "Knowledge segment not found");
  }

  // Corrections to an already-approved version never happen silently: they
  // require an explicit reason, and the audit row carries before/after.
  if (segment.publication_status === "approved" && !(input.note && input.note.trim())) {
    throw new ApiError(400, "Correcting a segment of an approved version requires a note explaining the change.");
  }

  const nextContent = input.content !== undefined ? input.content.trim() : segment.content;
  if (nextContent.length === 0) {
    throw new ApiError(400, "Segment content cannot be empty.");
  }
  const nextStart = input.startSeconds !== undefined ? input.startSeconds : segment.start_seconds;
  const nextEnd = input.endSeconds !== undefined ? input.endSeconds : segment.end_seconds;
  if ((nextStart === null) !== (nextEnd === null)) {
    throw new ApiError(400, "Start and end timestamps must be set together.");
  }
  if (nextStart !== null && nextEnd !== null) {
    if (nextStart < 0 || nextEnd < nextStart) {
      throw new ApiError(400, "Timestamps must satisfy 0 <= start <= end.");
    }
    // No timestamp may exceed the known media duration (H3).
    if (segment.media_duration_seconds !== null && nextEnd > segment.media_duration_seconds + 0.01) {
      throw new ApiError(400, `End time exceeds the stored media duration (${segment.media_duration_seconds}s).`);
    }
  }
  if (input.reviewerClassification !== undefined && input.reviewerClassification !== null) {
    if (!SEGMENT_CLASSIFICATIONS.includes(input.reviewerClassification)) {
      throw new ApiError(400, "Unknown segment classification.");
    }
  }

  const nextClassification =
    input.reviewerClassification !== undefined ? input.reviewerClassification : segment.reviewer_classification;
  const nextSpeaker = input.speakerLabel !== undefined ? input.speakerLabel : segment.speaker_label;
  const nextNotes = input.reviewNotes !== undefined ? input.reviewNotes : segment.review_notes;
  // First content edit preserves the provider/extractor original for audit.
  const originalContent =
    segment.original_content ?? (input.content !== undefined && nextContent !== segment.content ? segment.content : null);

  const updated = await client.query(
    `UPDATE knowledge_segment
     SET content = $3, start_seconds = $4, end_seconds = $5, speaker_label = $6,
         reviewer_classification = $7, review_notes = $8, original_content = $9,
         locator_label = CASE
           WHEN $4::numeric IS NOT NULL AND $5::numeric IS NOT NULL AND segment_kind = 'transcript'
           THEN lpad(floor($4 / 60)::text, 2, '0') || ':' || lpad(floor($4::numeric % 60)::text, 2, '0')
                || '–' ||
                lpad(floor($5 / 60)::text, 2, '0') || ':' || lpad(floor($5::numeric % 60)::text, 2, '0')
           ELSE locator_label
         END,
         updated_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING id::text, ordinal, segment_kind, heading, locator_label, content, original_content,
               start_seconds::float, end_seconds::float, speaker_label, reviewer_classification, review_notes`,
    [
      auth.tenantId,
      segmentId,
      nextContent,
      nextStart,
      nextEnd,
      nextSpeaker,
      nextClassification,
      nextNotes,
      originalContent
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "knowledge.segment_corrected",
    entityType: "knowledge_segment",
    entityId: segmentId,
    metadata: {
      version_id: segment.source_version_id,
      version_status: segment.publication_status,
      note: input.note ?? null,
      before: {
        content: segment.content,
        start_seconds: segment.start_seconds,
        end_seconds: segment.end_seconds,
        speaker_label: segment.speaker_label,
        reviewer_classification: segment.reviewer_classification,
        review_notes: segment.review_notes
      },
      after: {
        content: nextContent,
        start_seconds: nextStart,
        end_seconds: nextEnd,
        speaker_label: nextSpeaker,
        reviewer_classification: nextClassification,
        review_notes: nextNotes
      }
    }
  });

  return updated.rows[0];
}
