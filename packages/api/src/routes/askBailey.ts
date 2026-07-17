import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { connectGuardedClient } from "../db/pool.js";
import { withClientTransaction } from "../db/tx.js";
import { requireAuth } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { validateBody } from "../middleware/validate.js";
import {
  askBailey,
  getConversation,
  listConversations,
  submitMessageFeedback
} from "../services/ai/askBailey.js";
import { getPlayableMedia } from "../services/knowledge/knowledgeMedia.js";
import { getObservabilitySummary, getReleaseGate } from "../services/ai/askBaileyObservability.js";
import {
  cancelAssistiveAction,
  confirmAssistiveAction,
  generateProposalsFromGaps,
  getKnowledgeGaps,
  getMyLearningMemory,
  listProposals,
  previewPreShootHuddle,
  reviewProposal
} from "../services/ai/knowledgeLearning.js";
import type { AuthenticatedRequest } from "../types/http.js";

// Ask Bailey — read-only Q&A endpoints. All answer assembly, authorization,
// and citation validation live in services/ai/askBailey.ts; nothing here
// touches knowledge content directly.

const router = Router();

router.use(requireAuth);

const askRateLimiter = createRateLimiter({
  bucket: "ask-bailey-ask",
  windowMs: 60_000,
  max: config.ASK_BAILEY_ASK_RATE_MAX_PER_MINUTE,
  key: (req) => (req as unknown as AuthenticatedRequest).auth?.id ?? req.ip ?? "anonymous"
});

const askSchema = z.object({
  question: z.string().min(1).max(2000),
  mode: z.enum(["operational", "training", "planning", "historical"]).optional(),
  // Reviewer-only retrieval diagnostics; silently ignored for other users.
  trace: z.boolean().optional(),
  conversation_id: z.string().uuid().optional(),
  // Candidate context ids only — the server validates kind, record, and
  // access, and builds the envelope. Unknown fields are stripped by zod, so
  // no raw client object can ride into retrieval or the provider request.
  context: z
    .object({
      job_id: z.string().uuid().optional(),
      shoot_id: z.string().uuid().optional(),
      organization_id: z.string().uuid().optional(),
      location_id: z.string().uuid().optional(),
      task_id: z.string().uuid().optional(),
      source_id: z.string().uuid().optional()
    })
    .optional()
});

router.post("/ask", askRateLimiter, validateBody(askSchema), async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const answer = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      askBailey(client, auth, {
        question: req.body.question,
        mode: req.body.mode,
        trace: req.body.trace,
        conversationId: req.body.conversation_id ?? null,
        context: req.body.context
      })
    );
    return res.json(answer);
  } catch (error) {
    return next(error);
  }
});

router.get("/conversations", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const client = await connectGuardedClient();
    try {
      return res.json({ conversations: await listConversations(client, auth) });
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.get("/conversations/:conversationId", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const client = await connectGuardedClient();
    try {
      return res.json(await getConversation(client, auth, String(req.params.conversationId)));
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

// Protected media playback (H3-A/F): same eligibility predicate as
// retrieval, bytes served through the server, Range supported for seeking.
// Session-cookie auth lets <video>/<audio> elements stream directly.
router.get("/sources/:sourceId/media", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const client = await connectGuardedClient();
    let media;
    try {
      media = await getPlayableMedia(client, auth, String(req.params.sourceId));
    } finally {
      client.release();
    }
    if (media.read.status === "not_configured") {
      return res.status(503).json({ error: "MEDIA_STORAGE_NOT_CONFIGURED", message: media.read.reason });
    }
    if (media.read.status === "not_found") {
      return res.status(404).json({ error: "MEDIA_NOT_FOUND", message: "Source media not found." });
    }
    if (media.read.status === "failed") {
      return res.status(502).json({ error: "MEDIA_READ_FAILED", message: media.read.reason });
    }
    const body = media.read.body;
    const contentType = media.read.contentType ?? media.contentType ?? "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, no-store");
    const range = req.headers.range;
    const match = typeof range === "string" ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (match && (match[1] || match[2])) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
      if (Number.isNaN(start) || start > end || start >= body.length) {
        res.setHeader("Content-Range", `bytes */${body.length}`);
        return res.status(416).end();
      }
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${body.length}`);
      res.setHeader("Content-Length", end - start + 1);
      return res.end(body.subarray(start, end + 1));
    }
    res.setHeader("Content-Length", body.length);
    return res.end(body);
  } catch (error) {
    return next(error);
  }
});

// H7 — reviewer-gated observability + release readiness (service enforces the
// reviewer gate; opaque 403 otherwise).
router.get("/observability", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const windowDays = typeof req.query.window_days === "string" ? Number(req.query.window_days) : 30;
    const summary = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getObservabilitySummary(client, auth, Number.isFinite(windowDays) ? windowDays : 30)
    );
    return res.json(summary);
  } catch (error) {
    return next(error);
  }
});

router.get("/release-gate", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const report = await withClientTransaction(auth.tenantId, auth.id, (client) => getReleaseGate(client, auth));
    return res.json(report);
  } catch (error) {
    return next(error);
  }
});

// H9 — governed learning (reviewer-gated in the service) + bounded assistive
// actions (self, permission-checked at the typed write).
router.get("/knowledge-gaps", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const gaps = await withClientTransaction(auth.tenantId, auth.id, (client) => getKnowledgeGaps(client, auth));
    return res.json({ gaps });
  } catch (error) {
    return next(error);
  }
});

router.post("/proposals/generate", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) => generateProposalsFromGaps(client, auth));
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

router.get("/proposals", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) => listProposals(client, auth, status));
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/proposals/:proposalId/review",
  validateBody(z.object({ decision: z.enum(["accepted", "dismissed"]), note: z.string().max(2000).optional() })),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        reviewProposal(client, auth, String(req.params.proposalId), { decision: req.body.decision, note: req.body.note ?? null })
      );
      return res.json(result);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/actions/pre-shoot-huddle",
  validateBody(z.object({ job_id: z.string().uuid() })),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const preview = await withClientTransaction(auth.tenantId, auth.id, (client) => previewPreShootHuddle(client, auth, req.body.job_id));
      return res.status(201).json(preview);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/actions/:actionId/confirm", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) => confirmAssistiveAction(client, auth, String(req.params.actionId)));
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/actions/:actionId/cancel", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) => cancelAssistiveAction(client, auth, String(req.params.actionId)));
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.get("/my-learning-memory", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const memory = await withClientTransaction(auth.tenantId, auth.id, (client) => getMyLearningMemory(client, auth));
    return res.json(memory);
  } catch (error) {
    return next(error);
  }
});

const feedbackSchema = z.object({
  kind: z.enum(["helpful", "not_helpful", "report_incorrect", "missing_information", "source_outdated"]),
  note: z.string().max(2000).optional()
});

router.post("/messages/:messageId/feedback", validateBody(feedbackSchema), async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      submitMessageFeedback(client, auth, String(req.params.messageId), {
        kind: req.body.kind,
        note: req.body.note ?? null
      })
    );
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
