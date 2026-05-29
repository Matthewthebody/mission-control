import { Router } from "express";
import { z } from "zod";
import { withClientTransaction } from "../db/tx.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import {
  createRecordResource,
  listRecordResources,
  unlinkRecordResource
} from "../services/recordResources.js";
import type { AuthenticatedRequest } from "../types/http.js";

const router = Router();

const objectTypeSchema = z.enum(["organization", "location", "job", "production_item"]);
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

const objectParamsSchema = z.object({
  objectType: objectTypeSchema,
  objectId: z.string().uuid()
});

const itemParamsSchema = objectParamsSchema.extend({
  resourceId: z.string().uuid()
});

const createSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    category: categorySchema,
    description: z.string().trim().max(2000).optional().nullable(),
    storage_key: z.string().trim().min(1).max(2048).optional().nullable(),
    url: z.string().trim().url().max(2000),
    content_type: z.string().trim().max(255).optional().nullable(),
    file_size_bytes: z.number().int().nonnegative().max(250_000_000).optional().nullable(),
    provider: z.enum(["direct_url", "sharepoint", "onedrive"]).optional().nullable()
  })
  .strict();

router.use(requireAuth);

router.get("/:objectType/:objectId", validateParams(objectParamsSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const objectType = req.params.objectType as "organization" | "location" | "job" | "production_item";
    const objectId = String(req.params.objectId);
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listRecordResources(client, auth, objectType, objectId)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/:objectType/:objectId/items",
  validateParams(objectParamsSchema),
  validateBody(createSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const objectType = req.params.objectType as "organization" | "location" | "job" | "production_item";
      const objectId = String(req.params.objectId);
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createRecordResource(client, auth, objectType, objectId, req.body)
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.delete(
  "/:objectType/:objectId/items/:resourceId",
  validateParams(itemParamsSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const objectType = req.params.objectType as "organization" | "location" | "job" | "production_item";
      const objectId = String(req.params.objectId);
      const resourceId = String(req.params.resourceId);
      await withClientTransaction(auth.tenantId, auth.id, (client) =>
        unlinkRecordResource(client, auth, objectType, objectId, resourceId)
      );
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
