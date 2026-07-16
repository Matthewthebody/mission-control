import { Router } from "express";
import { z } from "zod";
import { connectGuardedClient, pool } from "../db/pool.js";
import { withClientTransaction } from "../db/tx.js";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  approveKnowledgeVersion,
  createKnowledgeSource,
  listKnowledgeReviewQueue,
  openKnowledgeConflict,
  deleteKnowledgeSynonym,
  listKnowledgeSynonyms,
  rejectKnowledgeVersion,
  requireKnowledgeReviewer,
  resolveKnowledgeConflict,
  resolveUnresolvedQuestion,
  retireKnowledgeVersion,
  reviewAnswerReport,
  submitKnowledgeVersionForReview,
  upsertKnowledgeSynonym
} from "../services/knowledge/knowledgeGovernance.js";
import { processPendingEmbeddings } from "../services/knowledge/knowledgeEmbeddings.js";
import {
  cancelIngestionJob,
  processQueuedIngestionJobs,
  queueIngestionJob,
  retryIngestionJob
} from "../services/knowledge/knowledgeIngestion.js";
import {
  correctSegment,
  listVersionSegments,
  SEGMENT_CLASSIFICATIONS
} from "../services/knowledge/knowledgeTranscriptReview.js";
import {
  convertUnresolvedQuestionToDraft,
  createKnowledgeSourceVersion,
  getKnowledgeHealth,
  getKnowledgeSourceDetail,
  listKnowledgeSources,
  mergeSegmentWithNext,
  splitSegment,
  updateDraftVersion,
  updateKnowledgeSourceMeta
} from "../services/knowledge/knowledgeAuthoring.js";
import { expandConcepts, normalizeQuestionToTerms } from "../services/ai/retrieval.js";
import type { AuthenticatedRequest } from "../types/http.js";

const router = Router();

// ---------------------------------------------------------------------------
// Internal worker sweep — ingestion runs in the background, never inline in a
// web request (secret-gated; same pattern as labor/checklists/production-board).
// ---------------------------------------------------------------------------
router.post(
  "/internal/ingestion/sweep",
  validateBody(z.object({ tenant_id: z.string().uuid().optional(), limit: z.number().int().min(1).max(50).optional() })),
  async (req, res, next) => {
    try {
      if (req.header("X-PMC-Internal-Secret") !== config.INTERNAL_SOCKET_SECRET) {
        throw new ApiError(403, "Forbidden");
      }
      const tenantIds =
        typeof req.body.tenant_id === "string"
          ? [req.body.tenant_id]
          : (
              await pool.query<{ id: string }>(`SELECT id::text AS id FROM tenant ORDER BY created_at ASC`)
            ).rows.map((row) => row.id);
      const results: Array<{
        tenant_id: string;
        processed: number;
        completed: number;
        failed: number;
        not_configured: number;
        embeddings?: unknown;
      }> = [];
      for (const tenantId of tenantIds) {
        const outcome = await withClientTransaction(tenantId, null, (client) =>
          processQueuedIngestionJobs(client, tenantId, { limit: req.body.limit ?? 10 })
        );
        // Embedding lifecycle rides the same sweep (charter H1-C): ensure
        // pending rows for approved content, then embed a bounded batch.
        const embeddings = await withClientTransaction(tenantId, null, (client) =>
          processPendingEmbeddings(client, tenantId, { limit: req.body.limit ?? 32 })
        );
        results.push({ tenant_id: tenantId, ...outcome, embeddings });
      }
      return res.json({
        tenant_count: tenantIds.length,
        processed: results.reduce((sum, entry) => sum + entry.processed, 0),
        results
      });
    } catch (error) {
      return next(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Knowledge-owner endpoints (reviewer-gated in the service layer).
// ---------------------------------------------------------------------------
router.use(requireAuth);

const createSourceSchema = z.object({
  title: z.string().min(1).max(240),
  description: z.string().max(2000).optional(),
  resource_library_item_id: z.string().uuid().optional(),
  department_owner: z.string().max(80).optional(),
  source_type: z.string().min(1).max(60),
  authority_class: z.string().min(1).max(60),
  knowledge_mode: z.string().min(1).max(30).optional(),
  inline_body: z.string().max(200000).optional(),
  effective_from: z.string().optional(),
  effective_until: z.string().optional(),
  review_due_at: z.string().optional(),
  department_scope: z.array(z.string().max(60)).max(10).optional(),
  role_scope: z.array(z.string().max(60)).max(20).optional(),
  confidential: z.boolean().optional()
});

router.post("/sources", validateBody(createSourceSchema), async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createKnowledgeSource(client, auth, {
        title: req.body.title,
        description: req.body.description ?? null,
        resourceLibraryItemId: req.body.resource_library_item_id ?? null,
        departmentOwner: req.body.department_owner ?? null,
        sourceType: req.body.source_type,
        authorityClass: req.body.authority_class,
        knowledgeMode: req.body.knowledge_mode,
        inlineBody: req.body.inline_body ?? null,
        effectiveFrom: req.body.effective_from ?? null,
        effectiveUntil: req.body.effective_until ?? null,
        reviewDueAt: req.body.review_due_at ?? null,
        departmentScope: req.body.department_scope,
        roleScope: req.body.role_scope,
        confidential: req.body.confidential
      })
    );
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

const noteSchema = z.object({ note: z.string().max(2000).optional() });
const requiredNoteSchema = z.object({ note: z.string().min(1).max(2000) });

router.post("/versions/:versionId/submit", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const version = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      submitKnowledgeVersionForReview(client, auth, String(req.params.versionId))
    );
    return res.json({ version });
  } catch (error) {
    return next(error);
  }
});

router.post("/versions/:versionId/approve", validateBody(noteSchema), async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const version = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      approveKnowledgeVersion(client, auth, String(req.params.versionId), req.body?.note ?? null)
    );
    return res.json({ version });
  } catch (error) {
    return next(error);
  }
});

router.post("/versions/:versionId/reject", validateBody(requiredNoteSchema), async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const version = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      rejectKnowledgeVersion(client, auth, String(req.params.versionId), req.body.note)
    );
    return res.json({ version });
  } catch (error) {
    return next(error);
  }
});

router.post("/versions/:versionId/retire", validateBody(noteSchema), async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const version = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      retireKnowledgeVersion(client, auth, String(req.params.versionId), req.body?.note ?? null)
    );
    return res.json({ version });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/versions/:versionId/ingest",
  validateBody(z.object({ job_kind: z.enum(["document_extract", "media_transcribe"]) })),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      // Queueing is reviewer-owned like the rest of the lifecycle.
      requireKnowledgeReviewer(auth);
      const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        queueIngestionJob(client, auth.tenantId, String(req.params.versionId), req.body.job_kind, auth.id)
      );
      return res.status(202).json(result);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/ingestion-jobs/:jobId/retry", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const job = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      retryIngestionJob(client, auth, String(req.params.jobId))
    );
    return res.json({ job });
  } catch (error) {
    return next(error);
  }
});

router.post("/ingestion-jobs/:jobId/cancel", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const job = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      cancelIngestionJob(client, auth, String(req.params.jobId))
    );
    return res.json({ job });
  } catch (error) {
    return next(error);
  }
});

// Transcript & segment review (H3-E) — reviewer-gated in the service layer.
router.get("/versions/:versionId/segments", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const client = await connectGuardedClient();
    try {
      return res.json(await listVersionSegments(client, auth, String(req.params.versionId)));
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

const correctSegmentSchema = z.object({
  content: z.string().min(1).max(8000).optional(),
  start_seconds: z.number().min(0).nullable().optional(),
  end_seconds: z.number().min(0).nullable().optional(),
  reviewer_classification: z.enum(SEGMENT_CLASSIFICATIONS).nullable().optional(),
  speaker_label: z.string().max(120).nullable().optional(),
  review_notes: z.string().max(2000).nullable().optional(),
  note: z.string().max(2000).optional()
});

router.patch("/segments/:segmentId", validateBody(correctSegmentSchema), async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const segment = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      correctSegment(client, auth, String(req.params.segmentId), {
        content: req.body.content,
        startSeconds: req.body.start_seconds,
        endSeconds: req.body.end_seconds,
        reviewerClassification: req.body.reviewer_classification,
        speakerLabel: req.body.speaker_label,
        reviewNotes: req.body.review_notes,
        note: req.body.note ?? null
      })
    );
    return res.json({ segment });
  } catch (error) {
    return next(error);
  }
});

const conflictSchema = z.object({
  version_a_id: z.string().uuid(),
  version_b_id: z.string().uuid(),
  note: z.string().max(2000).optional()
});

router.post("/conflicts", validateBody(conflictSchema), async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const conflictId = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      openKnowledgeConflict(client, auth, {
        versionAId: req.body.version_a_id,
        versionBId: req.body.version_b_id,
        note: req.body.note ?? null
      })
    );
    return res.status(201).json({ conflict_id: conflictId });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/conflicts/:conflictId/resolve",
  validateBody(z.object({ resolution: z.enum(["resolved", "dismissed"]), note: z.string().min(1).max(2000) })),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const conflict = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        resolveKnowledgeConflict(client, auth, String(req.params.conflictId), {
          resolution: req.body.resolution,
          note: req.body.note
        })
      );
      return res.json({ conflict });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/reports/:feedbackId/review",
  validateBody(z.object({ resolution: z.enum(["reviewed", "dismissed"]) })),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const report = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        reviewAnswerReport(client, auth, String(req.params.feedbackId), { resolution: req.body.resolution })
      );
      return res.json({ report });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/unresolved-questions/:questionId/resolve",
  validateBody(z.object({ resolution: z.enum(["answered", "dismissed"]), note: z.string().max(2000).optional() })),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const question = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        resolveUnresolvedQuestion(client, auth, String(req.params.questionId), {
          resolution: req.body.resolution,
          note: req.body.note ?? null
        })
      );
      return res.json({ question });
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/synonyms", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const client = await connectGuardedClient();
    try {
      return res.json({ synonyms: await listKnowledgeSynonyms(client, auth) });
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/synonyms",
  validateBody(
    z.object({
      term: z.string().min(1).max(80),
      expansion: z.array(z.string().min(1).max(80)).min(1).max(10),
      note: z.string().max(500).optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const synonym = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        upsertKnowledgeSynonym(client, auth, {
          term: req.body.term,
          expansion: req.body.expansion,
          note: req.body.note ?? null
        })
      );
      return res.status(201).json({ synonym });
    } catch (error) {
      return next(error);
    }
  }
);

router.delete("/synonyms/:term", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      deleteKnowledgeSynonym(client, auth, String(req.params.term))
    );
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// H5 — knowledge workspace, authoring, and health.
// ---------------------------------------------------------------------------
router.get("/sources", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const client = await connectGuardedClient();
    try {
      return res.json(
        await listKnowledgeSources(client, auth, {
          query: typeof req.query.query === "string" ? req.query.query : undefined,
          status: typeof req.query.status === "string" ? req.query.status : undefined,
          authority: typeof req.query.authority === "string" ? req.query.authority : undefined,
          mode: typeof req.query.mode === "string" ? req.query.mode : undefined,
          limit: req.query.limit ? Number(req.query.limit) : undefined,
          offset: req.query.offset ? Number(req.query.offset) : undefined
        })
      );
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

// Dual-mode detail: reviewers get governance; everyone else gets the
// eligibility-gated read-only view (Ask Bailey source cards land here).
router.get("/sources/:sourceId", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const client = await connectGuardedClient();
    try {
      return res.json(await getKnowledgeSourceDetail(client, auth, String(req.params.sourceId)));
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.patch(
  "/sources/:sourceId",
  validateBody(
    z.object({
      title: z.string().min(1).max(240).optional(),
      description: z.string().max(2000).nullable().optional(),
      owner_user_id: z.string().uuid().nullable().optional(),
      department_owner: z.string().max(80).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const source = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateKnowledgeSourceMeta(client, auth, String(req.params.sourceId), {
          title: req.body.title,
          description: req.body.description,
          ownerUserId: req.body.owner_user_id,
          departmentOwner: req.body.department_owner
        })
      );
      return res.json({ source });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/sources/:sourceId/versions",
  validateBody(z.object({ inline_body: z.string().max(200000).nullable().optional(), note: z.string().max(2000).optional() })),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const version = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createKnowledgeSourceVersion(client, auth, String(req.params.sourceId), {
          inlineBody: req.body.inline_body,
          note: req.body.note ?? null
        })
      );
      return res.status(201).json(version);
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/versions/:versionId",
  validateBody(
    z.object({
      inline_body: z.string().max(200000).nullable().optional(),
      authority_class: z.string().max(60).optional(),
      knowledge_mode: z.string().max(30).optional(),
      department_scope: z.array(z.string().max(60)).max(10).optional(),
      role_scope: z.array(z.string().max(60)).max(20).optional(),
      confidential: z.boolean().optional(),
      effective_from: z.string().nullable().optional(),
      effective_until: z.string().nullable().optional(),
      review_due_at: z.string().nullable().optional(),
      note: z.string().max(2000).optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const version = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateDraftVersion(client, auth, String(req.params.versionId), {
          inlineBody: req.body.inline_body,
          authorityClass: req.body.authority_class,
          knowledgeMode: req.body.knowledge_mode,
          departmentScope: req.body.department_scope,
          roleScope: req.body.role_scope,
          confidential: req.body.confidential,
          effectiveFrom: req.body.effective_from,
          effectiveUntil: req.body.effective_until,
          reviewDueAt: req.body.review_due_at,
          note: req.body.note ?? null
        })
      );
      return res.json({ version });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/unresolved-questions/:questionId/convert",
  validateBody(
    z.object({
      title: z.string().min(1).max(240),
      body: z.string().min(1).max(200000),
      department_owner: z.string().max(80).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        convertUnresolvedQuestionToDraft(client, auth, String(req.params.questionId), {
          title: req.body.title,
          body: req.body.body,
          departmentOwner: req.body.department_owner ?? null
        })
      );
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/segments/:segmentId/split",
  validateBody(
    z.object({
      offset_chars: z.number().int().min(1).optional(),
      split_seconds: z.number().min(0).optional(),
      note: z.string().max(2000).optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        splitSegment(client, auth, String(req.params.segmentId), {
          offsetChars: req.body.offset_chars,
          splitSeconds: req.body.split_seconds,
          note: req.body.note ?? null
        })
      );
      return res.json(result);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/segments/:segmentId/merge-next",
  validateBody(z.object({ note: z.string().max(2000).optional() })),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        mergeSegmentWithNext(client, auth, String(req.params.segmentId), { note: req.body.note ?? null })
      );
      return res.json(result);
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/health", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const client = await connectGuardedClient();
    try {
      return res.json(await getKnowledgeHealth(client, auth));
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

// Sample normalization preview for the synonym manager (reviewer-only).
router.get("/synonyms/preview", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    requireKnowledgeReviewer(auth);
    const question = typeof req.query.q === "string" ? req.query.q : "";
    const client = await connectGuardedClient();
    try {
      const terms = normalizeQuestionToTerms(question, null);
      const concepts = await expandConcepts(client, auth.tenantId, terms);
      return res.json({
        terms,
        concepts: concepts.map((concept) => ({ term: concept.term, variants: concept.variants, from_synonym: concept.fromSynonym }))
      });
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.get("/review-queue", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const client = await connectGuardedClient();
    try {
      return res.json(await listKnowledgeReviewQueue(client, auth));
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

export default router;
