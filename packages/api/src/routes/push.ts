import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { withClientTransaction } from "../db/tx.js";
import { ApiError } from "../errors/apiError.js";
import { registerPushToken, unregisterPushToken } from "../services/pushStub.js";
import type { AuthenticatedRequest } from "../types/http.js";

const router = Router();

router.post(
  "/register",
  requireAuth,
  requirePermission("push.manage"),
  validateBody(
    z.object({
      platform: z.string().min(1),
      device_identifier: z.string().min(1),
      app_version: z.string().optional(),
      token: z.string().min(1)
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const result = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
        registerPushToken(client, {
          tenantId: auth.tenantId,
          userId: auth.id,
          platform: req.body.platform,
          deviceIdentifier: req.body.device_identifier,
          appVersion: req.body.app_version,
          token: req.body.token
        })
      );
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/unregister", requireAuth, requirePermission("push.manage"), validateBody(z.object({ token: z.string().min(1) })), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const result = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      unregisterPushToken(client, auth.tenantId, auth.id, req.body.token)
    );
    if (!result) {
      throw new ApiError(404, "Push token not found");
    }
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
