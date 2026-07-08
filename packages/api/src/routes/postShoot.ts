import { Router } from "express";
import { z } from "zod";
import { withClientTransaction } from "../db/tx.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { getPostShootEvaluationObligations } from "../services/postShootEvaluationObligations.js";
import { recordMileageEligibilityResponse } from "../services/postShootMileageEligibility.js";
import type { AuthenticatedRequest } from "../types/http.js";

// SSA-2/SSA-3 — post-shoot evaluation obligations (read model) + the mileage-eligibility
// response recorded after eval submission. Scope rules live in the services.
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

const mileageEligibilitySchema = z
  .object({
    shoot_id: z.string().uuid(),
    eligible: z.boolean(),
    vehicle_type: z.enum(["personal_vehicle", "carpool_passenger", "company_vehicle", "other_needs_review"]).optional()
  })
  .strict();

router.post("/mileage-eligibility", validateBody(mileageEligibilitySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const body = req.body as z.infer<typeof mileageEligibilitySchema>;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      recordMileageEligibilityResponse(client, auth, {
        shootId: body.shoot_id,
        eligible: body.eligible,
        vehicleType: body.vehicle_type ?? null
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;
