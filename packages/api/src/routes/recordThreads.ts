import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { withClientTransaction } from "../db/tx.js";
import { connectGuardedClient } from "../db/pool.js";
import {
  getRecordThreadView,
  launchRecordThreadMeeting,
  postRecordThreadMessage,
  type RecordThreadObjectType
} from "../services/recordThreads.js";
import type { AuthenticatedRequest } from "../types/http.js";

const router = Router();
router.use(requireAuth);

const objectTypeSchema = z.enum(["job", "organization"]);
const objectIdSchema = z.string().uuid();

const postMessageSchema = z.object({
  body: z.string().min(1).max(8000),
  mention_user_ids: z.array(z.string().uuid()).max(20).optional(),
  attachment_refs: z.array(z.unknown()).max(10).optional()
});

const launchMeetingSchema = z.object({
  title: z.string().max(240).optional()
});

function parseEntity(req: { params: Record<string, string | string[] | undefined> }): {
  entityType: RecordThreadObjectType;
  entityId: string;
} {
  const entityType = objectTypeSchema.parse(req.params.objectType);
  const entityId = objectIdSchema.parse(req.params.objectId);
  return { entityType, entityId };
}

router.get("/:objectType/:objectId", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const { entityType, entityId } = parseEntity(req);
    const client = await connectGuardedClient();
    try {
      return res.json(await getRecordThreadView(client, auth, entityType, entityId));
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.post("/:objectType/:objectId/messages", validateBody(postMessageSchema), async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const { entityType, entityId } = parseEntity(req);
    const thread = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      postRecordThreadMessage(client, auth, {
        entityType,
        entityId,
        body: String(req.body.body),
        mentionUserIds: req.body.mention_user_ids ?? [],
        attachmentRefs: req.body.attachment_refs ?? []
      })
    );
    return res.status(201).json(thread);
  } catch (error) {
    return next(error);
  }
});

router.post("/:objectType/:objectId/meeting", validateBody(launchMeetingSchema), async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const { entityType, entityId } = parseEntity(req);
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      launchRecordThreadMeeting(client, auth, { entityType, entityId, title: req.body.title ?? null })
    );
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
