import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAction } from "../middleware/rbac.js";
import { withClientTransaction } from "../db/tx.js";
import { attachMediaAsset } from "../services/uploads.js";
import type { AuthenticatedRequest } from "../types/http.js";

const router = Router();
const resourceCategorySchema = z.enum([
  "setup_photo",
  "location_reference",
  "prior_successful_example",
  "product_example",
  "issue_concern",
  "equipment_setup_need",
  "qr_code_job_document",
  "misc_internal_reference"
]);
const approvalStatusSchema = z.enum(["pending_review", "approved", "leadership_only"]);
const visibilityScopeSchema = z.enum(["leadership_only", "photographer_prep"]);

router.post(
  "/:id/media",
  requireAuth,
  requireAction("media.attach"),
  validateBody(
    z.object({
      storage_key: z.string().min(1),
      kind: z.string().default("setup_photo"),
      category: resourceCategorySchema.optional(),
      note: z.string().trim().max(2000).optional().nullable(),
      issue_type: z.string().trim().max(120).optional().nullable(),
      file_name: z.string().trim().max(240).optional().nullable(),
      content_type: z.string().trim().max(120).optional().nullable(),
      file_size_bytes: z.number().int().positive().max(25_000_000).optional().nullable(),
      captured_at: z.string().datetime().optional().nullable(),
      approval_status: approvalStatusSchema.optional(),
      visibility_scope: visibilityScopeSchema.optional(),
      is_best_reference: z.boolean().optional(),
      url: z.string().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const media = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
        attachMediaAsset(client, {
          auth,
          tenantId: auth.tenantId,
          userId: auth.id,
          shootId: String(req.params.id),
          storageKey: req.body.storage_key,
          kind: req.body.kind,
          category: req.body.category ?? null,
          note: req.body.note ?? null,
          issueType: req.body.issue_type ?? null,
          fileName: req.body.file_name ?? null,
          contentType: req.body.content_type ?? null,
          fileSizeBytes: req.body.file_size_bytes ?? null,
          capturedAt: req.body.captured_at ?? null,
          approvalStatus: req.body.approval_status ?? null,
          visibilityScope: req.body.visibility_scope ?? null,
          isBestReference: req.body.is_best_reference ?? null,
          url: req.body.url
        })
      );
      return res.status(201).json(media);
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
