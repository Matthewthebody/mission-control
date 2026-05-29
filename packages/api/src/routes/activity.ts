import { Router } from "express";
import { z } from "zod";
import { withClientTransaction } from "../db/tx.js";
import { requireAuth } from "../middleware/auth.js";
import { requireFeatureFlag } from "../middleware/featureFlag.js";
import { validateQuery } from "../middleware/validate.js";
import { featureFlags } from "../featureFlags.js";
import { getActivityTimeline } from "../services/activityTimeline.js";
import type { AuthenticatedRequest } from "../types/http.js";
import type { ActivityTimelineObjectType } from "../types/activityTimeline.js";

const router = Router();
router.use(requireFeatureFlag(featureFlags.coreActivityTimeline, { message: "Activity timeline is currently disabled." }));

const objectTypeSchema = z.enum([
  "job",
  "staffing_assignment",
  "organization",
  "location",
  "contact",
  "production_item",
  "evaluation",
  "approval"
]);

const querySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional()
  })
  .strict();

router.get("/:objectType/:objectId", requireAuth, validateQuery(querySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const objectType = objectTypeSchema.parse(req.params.objectType) as ActivityTimelineObjectType;
    const objectId = z.string().uuid().parse(req.params.objectId);
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getActivityTimeline(client, auth, {
        objectType,
        objectId,
        limit
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;
