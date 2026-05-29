import { Router } from "express";
import { z } from "zod";
import { withClientTransaction } from "../db/tx.js";
import { requireAuth } from "../middleware/auth.js";
import { requireFeatureFlag } from "../middleware/featureFlag.js";
import { requireOperatingSystemModuleView } from "../middleware/operatingSystemAccess.js";
import { requireAction } from "../middleware/rbac.js";
import { validateQuery } from "../middleware/validate.js";
import { featureFlags } from "../featureFlags.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { OPERATIONAL_REPORTING_PERIODS, type OperationalReportingPeriod } from "../types/operationalReporting.js";
import { getReportingFoundation } from "../services/reportingFoundation.js";
import { getLocalDateString } from "../utils/localDate.js";

const router = Router();
router.use(requireFeatureFlag(featureFlags.coreReporting, { message: "Reporting foundation is currently disabled." }));

const reportingFoundationQuerySchema = z.object({
  date: z.string().optional(),
  department: z.string().optional(),
  period: z.enum(OPERATIONAL_REPORTING_PERIODS).optional(),
  workload_limit: z.coerce.number().int().min(3).max(20).optional()
});

router.get(
  "/foundation",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  validateQuery(reportingFoundationQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getReportingFoundation(client, auth, {
          anchorDate: req.query.date ? String(req.query.date) : getLocalDateString(),
          department: req.query.department ? String(req.query.department) : null,
          period: req.query.period ? (String(req.query.period) as OperationalReportingPeriod) : "monthly",
          workloadLimit: req.query.workload_limit ? Number(req.query.workload_limit) : null
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
