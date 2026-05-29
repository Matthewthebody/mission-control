import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAction } from "../middleware/rbac.js";
import { createUploadPresign } from "../services/s3.js";
import type { AuthenticatedRequest } from "../types/http.js";

const router = Router();

router.post(
  "/presign",
  requireAuth,
  requireAction("upload.presign"),
  validateBody(
    z.object({
      content_type: z.string().min(1),
      resource_type: z.string().max(80).optional(),
      resource_id: z.string().max(120).optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const presign = await createUploadPresign({
        tenantId: auth.tenantId,
        userId: auth.id,
        contentType: req.body.content_type,
        resourceType: req.body.resource_type ?? null,
        resourceId: req.body.resource_id ?? null
      });
      return res.json(presign);
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
