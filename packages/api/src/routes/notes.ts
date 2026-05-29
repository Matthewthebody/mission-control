import { Router } from "express";
import { z } from "zod";
import { withClientTransaction } from "../db/tx.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import type { AuthenticatedRequest } from "../types/http.js";
import {
  archiveOperationalNote,
  createOperationalNote,
  listOperationalNotes,
  promoteOperationalNoteToLocationMemory,
  publishLocationMemoryNote,
  updateOperationalNote
} from "../services/operationalNotes.js";
import { getRequestMeta } from "../utils/requestMeta.js";

const router = Router();

const objectTypeSchema = z.enum(["shoot", "shift", "location", "alert"]);
const noteTypeSchema = z.enum([
  "operational_update",
  "temporary_note",
  "permanent_note",
  "location_memory",
  "post_shoot_follow_up"
]);
const visibilityScopeSchema = z.enum([
  "object_viewers",
  "assigned_staff_and_managers",
  "managers_and_leadership",
  "leadership_only"
]);

router.use(requireAuth);

router.get(
  "/",
  validateQuery(
    z.object({
      object_type: objectTypeSchema,
      object_id: z.string().uuid(),
      filter: z.enum(["all", "important", "temporary", "permanent", "location_memory", "post_shoot_follow_up"]).optional(),
      search: z.string().optional(),
      include_archived: z.union([z.literal("true"), z.literal("false")]).optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listOperationalNotes(client, auth, {
          objectType: req.query.object_type as "shoot" | "shift" | "location" | "alert",
          objectId: String(req.query.object_id),
          filter: (req.query.filter as any) ?? null,
          search: req.query.search ? String(req.query.search) : null,
          includeArchived: req.query.include_archived === "true"
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/",
  validateBody(
    z.object({
      object_type: objectTypeSchema,
      object_id: z.string().uuid(),
      note_type: noteTypeSchema,
      body: z.string().min(1),
      pinned: z.boolean().optional(),
      visibility_scope: visibilityScopeSchema.nullable().optional(),
      source_context: z.string().nullable().optional(),
      mention_metadata: z.unknown().optional(),
      attachment_refs: z.unknown().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createOperationalNote(
          client,
          auth,
          {
            objectType: req.body.object_type,
            objectId: req.body.object_id,
            noteType: req.body.note_type,
            body: req.body.body,
            pinned: req.body.pinned,
            visibilityScope: req.body.visibility_scope ?? null,
            sourceContext: req.body.source_context ?? null,
            mentionMetadata: req.body.mention_metadata,
            attachmentRefs: req.body.attachment_refs
          },
          getRequestMeta(req)
        )
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/:id",
  validateBody(
    z.object({
      body: z.string().min(1).optional(),
      pinned: z.boolean().optional(),
      visibility_scope: visibilityScopeSchema.nullable().optional(),
      source_context: z.string().nullable().optional(),
      reason: z.string().nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateOperationalNote(
          client,
          auth,
          String(req.params.id),
          {
            body: req.body.body,
            pinned: req.body.pinned,
            visibilityScope: req.body.visibility_scope ?? null,
            sourceContext: req.body.source_context ?? null,
            reason: req.body.reason ?? null
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

router.post(
  "/:id/archive",
  validateBody(
    z.object({
      reason: z.string().nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        archiveOperationalNote(
          client,
          auth,
          String(req.params.id),
          {
            reason: req.body.reason ?? null
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

router.post(
  "/:id/promote-location-memory",
  validateBody(
    z.object({
      target_location_id: z.string().uuid().nullable().optional(),
      body: z.string().nullable().optional(),
      pinned: z.boolean().optional(),
      source_context: z.string().nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        promoteOperationalNoteToLocationMemory(
          client,
          auth,
          String(req.params.id),
          {
            targetLocationId: req.body.target_location_id ?? null,
            body: req.body.body ?? null,
            pinned: req.body.pinned,
            sourceContext: req.body.source_context ?? null
          },
          getRequestMeta(req)
        )
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/:id/publish-location-memory",
  validateBody(
    z.object({
      pinned: z.boolean().optional(),
      visibility_scope: visibilityScopeSchema.nullable().optional(),
      reason: z.string().nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        publishLocationMemoryNote(
          client,
          auth,
          String(req.params.id),
          {
            pinned: req.body.pinned,
            visibilityScope: req.body.visibility_scope ?? null,
            reason: req.body.reason ?? null
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
