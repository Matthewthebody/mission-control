import { Router } from "express";
import { z } from "zod";
import { withClientTransaction } from "../db/tx.js";
import { requireAuth } from "../middleware/auth.js";
import { requireFeatureFlag } from "../middleware/featureFlag.js";
import { validateQuery } from "../middleware/validate.js";
import { featureFlags } from "../featureFlags.js";
import { listGlobalSearchTelemetry, searchGlobalSearch } from "../services/search/globalSearchService.js";
import type { AuthenticatedRequest } from "../types/http.js";
import type { GlobalSearchDomain } from "../types/globalSearch.js";

const router = Router();
router.use(requireFeatureFlag(featureFlags.coreGlobalSearch, { message: "Global search is currently disabled." }));

const domainSchema = z.enum([
  "jobs",
  "organizations",
  "locations",
  "contacts",
  "staffing_assignments",
  "tasks",
  "production",
  "resources"
]);

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

const searchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(180),
    limit: z.coerce.number().int().min(1).max(32).optional(),
    domain: csvArraySchema(domainSchema)
  })
  .strict()
  .transform((value) => ({
    q: value.q,
    limit: value.limit,
    domains: value.domain as GlobalSearchDomain[] | undefined
  }));

const telemetryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional()
  })
  .strict();

router.get("/", requireAuth, validateQuery(searchQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => searchGlobalSearch(client, auth, req.query as any));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/telemetry", requireAuth, validateQuery(telemetryQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listGlobalSearchTelemetry(client, auth, req.query.limit ? Number(req.query.limit) : 50)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;
