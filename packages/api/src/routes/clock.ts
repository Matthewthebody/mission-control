import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAction } from "../middleware/rbac.js";
import { withClientTransaction } from "../db/tx.js";
import { createPunch } from "../services/attendance.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { getRequestMeta } from "../utils/requestMeta.js";

const router = Router();

function applyCompatibilityHeaders(res: { setHeader: (name: string, value: string) => void }, mode: string) {
  res.setHeader("X-PMC-Canonical-Source", "canonical_labor_state");
  res.setHeader("X-PMC-Compatibility-Mode", mode);
  res.setHeader("X-PMC-Deprecated-Route", "true");
}

const clockSchema = z.object({
  captured_at: z.string().min(1),
  location_lat: z.number().optional().nullable(),
  location_lng: z.number().optional().nullable(),
  accuracy_meters: z.number().optional().nullable(),
  client_event_id: z.string().uuid().optional().nullable()
});

router.post("/:id/clock-in", requireAuth, requireAction("time.clock"), validateBody(clockSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const result = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      createPunch(
        client,
        auth,
        {
          shootId: String(req.params.id),
          direction: "in",
          clientTimestamp: req.body.captured_at,
          latitude: req.body.location_lat,
          longitude: req.body.location_lng,
          accuracyMeters: req.body.accuracy_meters,
          clientEventId: req.body.client_event_id,
          idempotencyKey: req.header("Idempotency-Key") ?? null,
          source: "compat-shoot-route",
          enforcementMode: "legacy_compat"
        },
        getRequestMeta(req)
      )
    );
    applyCompatibilityHeaders(res, "legacy_shoot_punch_bridge");
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/clock-out", requireAuth, requireAction("time.clock"), validateBody(clockSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const result = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      createPunch(
        client,
        auth,
        {
          shootId: String(req.params.id),
          direction: "out",
          clientTimestamp: req.body.captured_at,
          latitude: req.body.location_lat,
          longitude: req.body.location_lng,
          accuracyMeters: req.body.accuracy_meters,
          clientEventId: req.body.client_event_id,
          idempotencyKey: req.header("Idempotency-Key") ?? null,
          source: "compat-shoot-route",
          enforcementMode: "legacy_compat"
        },
        getRequestMeta(req)
      )
    );
    applyCompatibilityHeaders(res, "legacy_shoot_punch_bridge");
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

// G2 (2026-07-20, owner-approved): the deprecated GET /:id/time-entries legacy
// projection is retired — it had zero product consumers. The clock-in/out
// bridges above stay; they write through the canonical punch path.

export default router;
