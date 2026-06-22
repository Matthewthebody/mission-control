import { Router } from "express";
import { z } from "zod";
import { withClientTransaction } from "../db/tx.js";
import { validateBody } from "../middleware/validate.js";
import {
  createDateChangeRequest,
  decideDateChange,
  getDateChangeRequest,
  listDateChangeRequestsForShoot,
  recordDateChangeAlternative,
  runDateChangeFeasibility,
  transitionDateChange,
  type DateChangeStatus
} from "../services/shootDateChangeRequest.js";
import type { AuthenticatedRequest } from "../types/http.js";

// June 18 feedback — auditable Shoot date-change workflow routes. Creation/read are open to any
// authed user; approval/decline are leadership-gated inside the service.
const router = Router();

const dateSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);
const createSchema = z.object({
  shoot_id: z.string().uuid(),
  requested_shoot_date: dateSchema,
  request_reason: z.string().trim().max(2000).optional().nullable(),
  request_source: z.enum(["manual", "email", "phone", "client_portal", "import"]).optional(),
  requested_by_contact_id: z.string().uuid().optional().nullable(),
  client_communication_reference: z.string().trim().max(500).optional().nullable(),
  idempotency_key: z.string().trim().max(200).optional().nullable()
});
const transitionSchema = z.object({
  to_status: z.enum(["feasibility_review", "alternatives_required", "awaiting_client", "approved", "declined", "canceled", "completed"]),
  reason: z.string().trim().max(2000).optional().nullable(),
  communication_reference: z.string().trim().max(500).optional().nullable()
});
const decideSchema = z.object({
  decision: z.enum(["approved", "declined", "canceled"]),
  final_shoot_date: dateSchema.optional().nullable(),
  reason: z.string().trim().max(2000).optional().nullable()
});
const alternativeSchema = z.object({ alternative: z.record(z.unknown()) });

const tx = (req: any) => {
  const auth = (req as AuthenticatedRequest).auth;
  return { auth };
};

router.post("/", validateBody(createSchema), async (req, res, next) => {
  try {
    const { auth } = tx(req);
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) => createDateChangeRequest(client, auth, req.body));
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
});

router.get("/shoot/:shootId", async (req, res, next) => {
  try {
    const { auth } = tx(req);
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) => listDateChangeRequestsForShoot(client, auth, String(req.params.shootId)));
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const { auth } = tx(req);
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) => getDateChangeRequest(client, auth, String(req.params.id)));
    if (!result) return res.status(404).json({ error: "Not found" });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/feasibility", async (req, res, next) => {
  try {
    const { auth } = tx(req);
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) => runDateChangeFeasibility(client, auth, String(req.params.id)));
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/alternatives", validateBody(alternativeSchema), async (req, res, next) => {
  try {
    const { auth } = tx(req);
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) => recordDateChangeAlternative(client, auth, String(req.params.id), req.body.alternative));
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/transition", validateBody(transitionSchema), async (req, res, next) => {
  try {
    const { auth } = tx(req);
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) => transitionDateChange(client, auth, String(req.params.id), req.body.to_status as DateChangeStatus, { reason: req.body.reason, communication_reference: req.body.communication_reference }));
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/decision", validateBody(decideSchema), async (req, res, next) => {
  try {
    const { auth } = tx(req);
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) => decideDateChange(client, auth, String(req.params.id), req.body.decision, { final_shoot_date: req.body.final_shoot_date, reason: req.body.reason }));
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
