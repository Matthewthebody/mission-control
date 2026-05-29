import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { withClientTransaction } from "../db/tx.js";
import { createStatusEvent } from "../services/statusEvents.js";
import type { AuthenticatedRequest } from "../types/http.js";

const router = Router();

const bodySchema = z.object({
  type: z.enum(["ARRIVED", "SETUP_COMPLETE", "SHOOTING_STARTED", "WRAPPED", "CLOCK_IN", "CLOCK_OUT"]),
  captured_at: z.string().min(1),
  location_lat: z.number().optional().nullable(),
  location_lng: z.number().optional().nullable(),
  client_event_id: z.string().uuid().optional().nullable(),
  metadata: z.record(z.unknown()).optional()
});

router.post("/:id/status-events", requireAuth, requirePermission("status_event.create"), validateBody(bodySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const event = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
        createStatusEvent(client, {
          auth,
          tenantId: auth.tenantId,
          userId: auth.id,
          shootId: String(req.params.id),
        idempotencyKey: req.header("Idempotency-Key") ?? null,
        input: req.body
      })
    );
    return res.status(201).json(event);
  } catch (error) {
    return next(error);
  }
});

export default router;
