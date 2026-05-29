import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { withClientTransaction } from "../db/tx.js";
import { previewMileage, submitMileage } from "../services/mileage.js";
import type { AuthenticatedRequest } from "../types/http.js";

const router = Router();

router.post("/:id/mileage/preview", requireAuth, requirePermission("mileage.create"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const preview = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      previewMileage(client, auth, String(req.params.id), auth.id)
    );
    return res.json(preview);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/mileage/submit", requireAuth, requirePermission("mileage.create"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const claim = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      submitMileage(client, auth, String(req.params.id), auth.id)
    );
    return res.status(201).json(claim);
  } catch (error) {
    return next(error);
  }
});

export default router;
