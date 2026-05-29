import { Router } from "express";
import { z } from "zod";
import { withClientTransaction } from "../db/tx.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import {
  createSavedConciergeSearch,
  deleteSavedConciergeSearch,
  listRecentConciergeSearches,
  listSavedConciergeSearches,
  lookupConciergeResult,
  recordRecentConciergeSearch,
  searchConcierge,
  suggestConcierge,
  updateSavedConciergeSearch
} from "../services/concierge/conciergeSearchService.js";
import { searchConciergeAccess } from "../services/concierge/conciergeAccessSearchService.js";
import type { AuthenticatedRequest } from "../types/http.js";

const router = Router();

const departmentSchema = z
  .enum(["all", "schools", "sports", "production", "photography", "operations", "corporate", "headshots", "other"])
  .optional();

const dateSchema = z.enum(["today", "tomorrow", "next_24h", "next_7d", "overdue"]).optional();

const entityTypeSchema = z.enum([
  "organization",
  "contact",
  "location",
  "shoot",
  "production_item",
  "task",
  "resource_library_item",
  "note",
  "comment",
  "staffing_assignment",
  "urgent_watch_alert",
  "post_shoot_evaluation"
]);

const accessScopeSchema = z.enum([
  "jobs",
  "locations",
  "organizations",
  "contacts",
  "staffing_assignments",
  "sops_files",
  "production"
]);

const hasSchema = z.enum(["notes", "alerts", "staffing_gap"]);

function csvArraySchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (!value) {
        return undefined;
      }
      const rawValues = Array.isArray(value) ? value : value.split(",");
      const values = rawValues
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => itemSchema.parse(entry));
      return values.length ? values : undefined;
    });
}

const filtersSchema = z
  .object({
    department: departmentSchema,
    entity_types: csvArraySchema(entityTypeSchema),
    status: z.string().trim().max(80).optional(),
    owner: z.string().trim().max(120).optional(),
    assignee: z.string().trim().max(120).optional(),
    org: z.string().trim().max(120).optional(),
    date: dateSchema,
    risk: z.string().trim().max(80).optional(),
    has_any: csvArraySchema(hasSchema)
  })
  .partial()
  .strict();

const conciergeQuerySchema = z
  .object({
    q: z.string().trim().max(180).optional(),
    limit: z.coerce.number().int().min(1).max(48).optional(),
    department: departmentSchema,
    type: csvArraySchema(entityTypeSchema),
    status: z.string().trim().max(80).optional(),
    owner: z.string().trim().max(120).optional(),
    assignee: z.string().trim().max(120).optional(),
    org: z.string().trim().max(120).optional(),
    date: dateSchema,
    risk: z.string().trim().max(80).optional(),
    has: csvArraySchema(hasSchema)
  })
  .strict()
  .transform((value) => ({
    q: value.q,
    limit: value.limit,
    department: value.department,
    entity_types: value.type,
    status: value.status,
    owner: value.owner,
    assignee: value.assignee,
    org: value.org,
    date: value.date,
    risk: value.risk,
    has_any: value.has
  }));

const conciergeAccessQuerySchema = z
  .object({
    q: z.string().trim().max(180).optional(),
    limit: z.coerce.number().int().min(1).max(24).optional(),
    scope: csvArraySchema(accessScopeSchema)
  })
  .strict()
  .transform((value) => ({
    q: value.q,
    limit: value.limit,
    scopes: value.scope
  }));

const recentSearchBodySchema = z
  .object({
    query: z.string().trim().min(1).max(180),
    selected_search_index_id: z.string().uuid().nullable().optional()
  })
  .strict();

const savedSearchCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    query: z.string().trim().min(1).max(180),
    filters: filtersSchema.optional(),
    pinned: z.boolean().optional()
  })
  .strict();

const savedSearchUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional().nullable(),
    query: z.string().trim().min(1).max(180).optional().nullable(),
    filters: filtersSchema.optional().nullable(),
    pinned: z.boolean().optional().nullable(),
    touch: z.boolean().optional().nullable()
  })
  .strict();

const lookupParamsSchema = z
  .object({
    searchIndexId: z.string().uuid()
  })
  .strict();

const savedSearchParamsSchema = z
  .object({
    savedSearchId: z.string().uuid()
  })
  .strict();

router.get("/", requireAuth, validateQuery(conciergeQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => searchConcierge(client, auth, req.query));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/search", requireAuth, validateQuery(conciergeQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => searchConcierge(client, auth, req.query));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/access-search", requireAuth, validateQuery(conciergeAccessQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => searchConciergeAccess(client, auth, req.query));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/suggestions", requireAuth, validateQuery(conciergeQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => suggestConcierge(client, auth, req.query));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/recent", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => listRecentConciergeSearches(client, auth));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/recent", requireAuth, validateBody(recentSearchBodySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    await withClientTransaction(auth.tenantId, auth.id, (client) => recordRecentConciergeSearch(client, auth, req.body));
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.get("/saved", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => listSavedConciergeSearches(client, auth));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/saved", requireAuth, validateBody(savedSearchCreateSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => createSavedConciergeSearch(client, auth, req.body));
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.patch("/saved/:savedSearchId", requireAuth, validateParams(savedSearchParamsSchema), validateBody(savedSearchUpdateSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const { savedSearchId } = req.params as { savedSearchId: string };
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateSavedConciergeSearch(client, auth, savedSearchId, req.body)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.delete("/saved/:savedSearchId", requireAuth, validateParams(savedSearchParamsSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const { savedSearchId } = req.params as { savedSearchId: string };
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => deleteSavedConciergeSearch(client, auth, savedSearchId));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/result/:searchIndexId", requireAuth, validateParams(lookupParamsSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const { searchIndexId } = req.params as { searchIndexId: string };
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      lookupConciergeResult(client, auth, searchIndexId)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;
