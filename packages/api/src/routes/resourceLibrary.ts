import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireAction } from "../middleware/rbac.js";
import { validateBody } from "../middleware/validate.js";
import { withClientTransaction } from "../db/tx.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { createResourceLibraryUpload } from "../services/resourceLibraryUploads.js";
import { reviewResourceLibraryItem } from "../services/resourceLibrary.js";
import { getRequestMeta } from "../utils/requestMeta.js";

const router = Router();

const uploadSourceSchema = z.enum(["mobile_camera", "mobile_library", "mobile_document"]);
const targetTypeSchema = z.enum(["shoot", "location", "organization"]);
const categorySchema = z.enum([
  "setup_photo",
  "location_reference",
  "prior_successful_example",
  "product_example",
  "issue_concern",
  "equipment_setup_need",
  "qr_code_job_document",
  "sop_reference",
  "contract_document",
  "proof_document",
  "support_document",
  "misc_internal_reference"
]);
const approvalStatusSchema = z.enum(["pending_review", "approved", "leadership_only", "rejected_not_useful"]);
const visibilityScopeSchema = z.enum(["leadership_only", "photographer_prep"]);
const bestReferenceCategorySchema = z.enum([
  "best_setup_example",
  "best_team_photo_example",
  "best_entrance_location_example",
  "best_product_poster_example",
  "best_logistics_example"
]);

router.post(
  "/items",
  requireAuth,
  requireAction("media.attach"),
  validateBody(
    z.object({
      target_type: targetTypeSchema,
      target_id: z.string().uuid(),
      shift_id: z.string().uuid().optional().nullable(),
      linked_shoot_id: z.string().uuid().optional().nullable(),
      storage_key: z.string().min(1),
      file_name: z.string().trim().min(1).max(240),
      content_type: z.string().trim().min(1).max(120).optional().nullable(),
      file_size_bytes: z.number().int().positive().max(25_000_000).optional().nullable(),
      captured_at: z.string().datetime().optional().nullable(),
      category: categorySchema,
      note: z.string().trim().max(2000).optional().nullable(),
      issue_type: z.string().trim().max(120).optional().nullable(),
      important_for_next_year: z.boolean().optional(),
      upload_source: uploadSourceSchema,
      gps_lat: z.number().min(-90).max(90).optional().nullable(),
      gps_lng: z.number().min(-180).max(180).optional().nullable(),
      url: z.string().trim().url().max(2000).optional().nullable()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createResourceLibraryUpload(client, auth, {
          targetType: req.body.target_type,
          targetId: req.body.target_id,
          shiftId: req.body.shift_id ?? null,
          linkedShootId: req.body.linked_shoot_id ?? null,
          storageKey: req.body.storage_key,
          fileName: req.body.file_name,
          contentType: req.body.content_type ?? null,
          fileSizeBytes: req.body.file_size_bytes ?? null,
          capturedAt: req.body.captured_at ?? null,
          category: req.body.category,
          note: req.body.note ?? null,
          issueType: req.body.issue_type ?? null,
          importantForNextYear: Boolean(req.body.important_for_next_year),
          uploadSource: req.body.upload_source,
          gpsLat: req.body.gps_lat ?? null,
          gpsLng: req.body.gps_lng ?? null,
          url: req.body.url ?? null
        })
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/items/:id/review",
  requireAuth,
  validateBody(
    z.object({
      approval_status: approvalStatusSchema.optional(),
      visibility_scope: visibilityScopeSchema.optional(),
      category: categorySchema.optional(),
      issue_type: z.string().trim().max(120).optional().nullable(),
      note: z.string().trim().max(2000).optional().nullable(),
      best_reference_candidate: z.boolean().optional(),
      is_best_reference: z.boolean().optional(),
      best_reference_category: bestReferenceCategorySchema.optional().nullable(),
      review_note: z.string().trim().max(2000).optional().nullable()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        reviewResourceLibraryItem(
          client,
          auth,
          String(req.params.id),
          {
            approvalStatus: req.body.approval_status,
            visibilityScope: req.body.visibility_scope,
            category: req.body.category,
            issueType: req.body.issue_type ?? undefined,
            note: req.body.note ?? undefined,
            bestReferenceCandidate: req.body.best_reference_candidate,
            isBestReference: req.body.is_best_reference,
            bestReferenceCategory: req.body.best_reference_category ?? undefined,
            reviewNote: req.body.review_note ?? undefined
          },
          getRequestMeta(req)
        )
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
