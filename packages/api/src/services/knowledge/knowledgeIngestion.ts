import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "../../errors/apiError.js";
import type { AuthUser } from "../../types/auth.js";
import { createAuditLog } from "../audit.js";
import { requireKnowledgeReviewer } from "./knowledgeGovernance.js";
import { resolveTranscriptionProvider } from "../ai/providers/transcription.js";
import type { TranscriptSegmentDraft } from "../ai/providers/types.js";

// Ask Bailey — ingestion foundation (Phase C).
// Background jobs turn a knowledge source version's stored content into
// retrievable segments. Idempotent by construction: a job is unique per
// (version, kind, content-fingerprint), and processing REPLACES the version's
// segments of that kind in one transaction — retries can never duplicate.
//
// V1 extraction reads the version's stored text (inline body, or the linked
// Resource Library item's note for annotated assets). Binary parsing
// (PDF/DOCX) and hosted transcription are provider seams: when the stored
// content cannot be processed, the job reports an honest failed /
// not_configured state — it never fakes success.

const MAX_SEGMENT_CHARS = 900;

export type DocumentSegmentDraft = {
  ordinal: number;
  heading: string | null;
  locatorLabel: string;
  content: string;
};

/**
 * Deterministic document segmenter: markdown-style headings open sections;
 * paragraphs within a section are packed into ~900-char segments. Stable
 * ordinals and locators across re-runs on identical input.
 */
export function segmentDocumentText(text: string): DocumentSegmentDraft[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  type Section = { heading: string | null; paragraphs: string[] };
  const sections: Section[] = [{ heading: null, paragraphs: [] }];
  let buffer: string[] = [];

  const flushParagraph = () => {
    const paragraph = buffer.join(" ").trim();
    if (paragraph.length > 0) {
      sections[sections.length - 1].paragraphs.push(paragraph);
    }
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const headingMatch = /^#{1,4}\s+(.+)$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      sections.push({ heading: headingMatch[1].trim(), paragraphs: [] });
      continue;
    }
    if (line.length === 0) {
      flushParagraph();
      continue;
    }
    buffer.push(line);
  }
  flushParagraph();

  const segments: DocumentSegmentDraft[] = [];
  for (const section of sections) {
    let chunk = "";
    let chunkIndex = 0;
    const emit = () => {
      const content = chunk.trim();
      if (content.length === 0) return;
      chunkIndex += 1;
      segments.push({
        ordinal: segments.length,
        heading: section.heading,
        locatorLabel: section.heading
          ? chunkIndex === 1
            ? `Section: ${section.heading}`
            : `Section: ${section.heading} (part ${chunkIndex})`
          : `Paragraph ${segments.length + 1}`,
        content
      });
      chunk = "";
    };
    for (const paragraph of section.paragraphs) {
      // An oversized paragraph is split on sentence boundaries first so no
      // single segment can exceed the bound.
      for (const piece of splitOversizedParagraph(paragraph)) {
        if (chunk.length > 0 && chunk.length + piece.length + 2 > MAX_SEGMENT_CHARS) {
          emit();
        }
        chunk = chunk.length > 0 ? `${chunk}\n\n${piece}` : piece;
        if (chunk.length >= MAX_SEGMENT_CHARS) {
          emit();
        }
      }
    }
    emit();
  }
  return segments;
}

function splitOversizedParagraph(paragraph: string): string[] {
  if (paragraph.length <= MAX_SEGMENT_CHARS) {
    return [paragraph];
  }
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  const pieces: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current.length > 0 && current.length + sentence.length + 1 > MAX_SEGMENT_CHARS) {
      pieces.push(current);
      current = "";
    }
    current = current.length > 0 ? `${current} ${sentence}` : sentence;
    // A single sentence longer than the bound is hard-cut — better an awkward
    // break than an unbounded segment.
    while (current.length > MAX_SEGMENT_CHARS) {
      pieces.push(current.slice(0, MAX_SEGMENT_CHARS));
      current = current.slice(MAX_SEGMENT_CHARS);
    }
  }
  if (current.length > 0) {
    pieces.push(current);
  }
  return pieces;
}

function fingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

type VersionContentRow = {
  id: string;
  source_id: string;
  inline_body: string | null;
  asset_note: string | null;
  asset_file_name: string | null;
  asset_content_type: string | null;
};

async function loadVersionContent(client: PoolClient, tenantId: string, versionId: string): Promise<VersionContentRow> {
  const { rows } = await client.query<VersionContentRow>(
    `SELECT v.id::text, v.source_id::text, v.inline_body,
            item.note AS asset_note, item.file_name AS asset_file_name, item.content_type AS asset_content_type
     FROM knowledge_source_version v
     JOIN knowledge_source s ON s.id = v.source_id AND s.tenant_id = v.tenant_id
     LEFT JOIN resource_library_item item ON item.id = s.resource_library_item_id
     WHERE v.tenant_id = $1 AND v.id = $2
     LIMIT 1`,
    [tenantId, versionId]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Knowledge source version not found");
  }
  return rows[0];
}

function resolveStoredText(version: VersionContentRow): string | null {
  const body = version.inline_body?.trim();
  if (body) return body;
  const note = version.asset_note?.trim();
  if (note) return note;
  return null;
}

export async function queueIngestionJob(
  client: PoolClient,
  tenantId: string,
  versionId: string,
  jobKind: "document_extract" | "media_transcribe",
  requestedByUserId: string | null
): Promise<{ job_id: string; created: boolean }> {
  const version = await loadVersionContent(client, tenantId, versionId);
  const storedText = resolveStoredText(version);
  const jobFingerprint = fingerprint(`${jobKind}:${storedText ?? "(no stored text)"}`);
  const { rows } = await client.query<{ id: string; created: boolean }>(
    `INSERT INTO knowledge_ingestion_job
       (tenant_id, source_version_id, job_kind, idempotency_fingerprint, requested_by_user_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, source_version_id, job_kind, idempotency_fingerprint)
     DO UPDATE SET updated_at = now()
     RETURNING id::text, (xmax = 0) AS created`,
    [tenantId, versionId, jobKind, jobFingerprint, requestedByUserId]
  );
  if (rows[0].created) {
    await client.query(
      `UPDATE knowledge_source_version SET extraction_status = 'queued', updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, versionId]
    );
  }
  return { job_id: rows[0].id, created: rows[0].created };
}

export async function retryIngestionJob(client: PoolClient, auth: AuthUser, jobId: string) {
  requireKnowledgeReviewer(auth);
  const { rows } = await client.query(
    `UPDATE knowledge_ingestion_job
     SET status = 'queued', error_message = NULL, updated_at = now()
     WHERE tenant_id = $1 AND id = $2 AND status IN ('failed', 'not_configured', 'needs_review')
     RETURNING id::text, source_version_id::text`,
    [auth.tenantId, jobId]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Retryable ingestion job not found");
  }
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "knowledge.ingestion_retried",
    entityType: "knowledge_ingestion_job",
    entityId: jobId,
    metadata: {}
  });
  return rows[0];
}

async function replaceSegments(
  client: PoolClient,
  tenantId: string,
  versionId: string,
  segmentKind: "extracted_text" | "transcript",
  drafts: Array<{
    ordinal: number;
    heading?: string | null;
    locatorLabel: string;
    content: string;
    startSeconds?: number | null;
    endSeconds?: number | null;
    speakerLabel?: string | null;
  }>
) {
  await client.query(
    `DELETE FROM knowledge_segment WHERE tenant_id = $1 AND source_version_id = $2 AND segment_kind = $3`,
    [tenantId, versionId, segmentKind]
  );
  for (const draft of drafts) {
    await client.query(
      `INSERT INTO knowledge_segment
         (tenant_id, source_version_id, ordinal, segment_kind, heading, locator_label, content, start_seconds, end_seconds, speaker_label)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        tenantId,
        versionId,
        draft.ordinal,
        segmentKind,
        draft.heading ?? null,
        draft.locatorLabel,
        draft.content,
        draft.startSeconds ?? null,
        draft.endSeconds ?? null,
        draft.speakerLabel ?? null
      ]
    );
  }
}

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function transcriptLocator(segment: TranscriptSegmentDraft): string {
  return `${formatClock(segment.startSeconds)}–${formatClock(segment.endSeconds)}`;
}

async function completeJob(
  client: PoolClient,
  tenantId: string,
  jobId: string,
  versionId: string,
  outcome: { status: "completed" | "failed" | "not_configured"; provider?: string | null; error?: string | null }
) {
  await client.query(
    `UPDATE knowledge_ingestion_job
     SET status = $3, provider = COALESCE($4, provider), error_message = $5,
         completed_at = CASE WHEN $3 = 'completed' THEN now() ELSE completed_at END, updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, jobId, outcome.status, outcome.provider ?? null, outcome.error ?? null]
  );
  await client.query(
    `UPDATE knowledge_source_version
     SET extraction_status = $3, last_indexed_at = CASE WHEN $3 = 'completed' THEN now() ELSE last_indexed_at END, updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, versionId, outcome.status]
  );
}

/**
 * Process queued ingestion jobs for one tenant. Called by the worker's
 * internal sweep (never inline in a web request). Each job runs in the
 * caller's transaction; segment replacement keeps retries duplicate-free.
 */
export async function processQueuedIngestionJobs(
  client: PoolClient,
  tenantId: string,
  options: { limit?: number } = {}
): Promise<{ processed: number; completed: number; failed: number; not_configured: number }> {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const { rows: jobs } = await client.query<{ id: string; source_version_id: string; job_kind: string; attempts: number }>(
    `SELECT id::text, source_version_id::text, job_kind, attempts
     FROM knowledge_ingestion_job
     WHERE tenant_id = $1 AND status = 'queued'
     ORDER BY created_at ASC
     LIMIT $2`,
    [tenantId, limit]
  );
  const outcome = { processed: 0, completed: 0, failed: 0, not_configured: 0 };
  for (const job of jobs) {
    outcome.processed += 1;
    await client.query(
      `UPDATE knowledge_ingestion_job SET status = 'processing', attempts = attempts + 1, started_at = COALESCE(started_at, now()), updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, job.id]
    );
    const version = await loadVersionContent(client, tenantId, job.source_version_id);
    const storedText = resolveStoredText(version);

    if (job.job_kind === "document_extract") {
      if (!storedText) {
        await completeJob(client, tenantId, job.id, job.source_version_id, {
          status: "failed",
          error:
            "No extractable stored text: the version has no inline body and the linked asset has no text note. Binary document parsing (PDF/DOCX) requires an extraction provider — not configured."
        });
        outcome.failed += 1;
        continue;
      }
      const drafts = segmentDocumentText(storedText);
      await replaceSegments(client, tenantId, job.source_version_id, "extracted_text", drafts);
      await completeJob(client, tenantId, job.id, job.source_version_id, { status: "completed", provider: "deterministic" });
      outcome.completed += 1;
      continue;
    }

    // media_transcribe
    const provider = resolveTranscriptionProvider();
    const result = await provider.transcribe({
      tenantId,
      sourceVersionId: job.source_version_id,
      scriptText: storedText,
      fileName: version.asset_file_name,
      contentType: version.asset_content_type
    });
    if (result.status === "completed") {
      await replaceSegments(
        client,
        tenantId,
        job.source_version_id,
        "transcript",
        result.segments.map((segment) => ({
          ordinal: segment.ordinal,
          locatorLabel: transcriptLocator(segment),
          content: segment.content,
          startSeconds: segment.startSeconds,
          endSeconds: segment.endSeconds,
          speakerLabel: segment.speakerLabel ?? null
        }))
      );
      await completeJob(client, tenantId, job.id, job.source_version_id, { status: "completed", provider: result.provider });
      outcome.completed += 1;
    } else if (result.status === "not_configured") {
      await completeJob(client, tenantId, job.id, job.source_version_id, {
        status: "not_configured",
        provider: result.provider,
        error: result.reason
      });
      outcome.not_configured += 1;
    } else {
      await completeJob(client, tenantId, job.id, job.source_version_id, {
        status: "failed",
        provider: result.provider,
        error: result.reason
      });
      outcome.failed += 1;
    }
  }
  return outcome;
}
