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
  conversation_id: z.string().uuid().optional(),
  context: z
    .object({
      job_id: z.string().uuid().optional(),
      shoot_id: z.string().uuid().optional(),
      organization_id: z.string().uuid().optional()
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
