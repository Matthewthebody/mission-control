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
  rejectKnowledgeVersion,
  requireKnowledgeReviewer,
  resolveKnowledgeConflict,
  resolveUnresolvedQuestion,
  retireKnowledgeVersion,
  reviewAnswerReport,
  submitKnowledgeVersionForReview
} from "../services/knowledge/knowledgeGovernance.js";
import { processQueuedIngestionJobs, queueIngestionJob, retryIngestionJob } from "../services/knowledge/knowledgeIngestion.js";
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
      const results: Array<{ tenant_id: string; processed: number; completed: number; failed: number; not_configured: number }> = [];
      for (const tenantId of tenantIds) {
        const outcome = await withClientTransaction(tenantId, null, (client) =>
          processQueuedIngestionJobs(client, tenantId, { limit: req.body.limit ?? 10 })
        );
        results.push({ tenant_id: tenantId, ...outcome });
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
