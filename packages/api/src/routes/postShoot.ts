import { Router } from "express";
import { z } from "zod";
import { withClientTransaction } from "../db/tx.js";
import { requireAuth } from "../middleware/auth.js";
import { validateQuery } from "../middleware/validate.js";
import { getPostShootEvaluationObligations } from "../services/postShootEvaluationObligations.js";
import type { AuthenticatedRequest } from "../types/http.js";

// SSA-2 — post-shoot evaluation obligations (read model only). Team-review scope is enforced
// in the service (canReviewTeamTime → 403); auth itself comes from the app-level requireAuth.
const router = Router();
router.use(requireAuth);

const obligationsQuerySchema = z
  .object({
    shoot_id: z.string().uuid().optional(),
    window_days: z.coerce.number().int().min(1).max(60).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional()
  })
  .strict();

router.get("/evaluation-obligations", validateQuery(obligationsQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const query = req.query as z.infer<typeof obligationsQuerySchema>;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getPostShootEvaluationObligations(client, auth, {
        shootId: query.shoot_id ?? null,
        windowDays: query.window_days,
        limit: query.limit
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;
