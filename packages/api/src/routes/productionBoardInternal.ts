import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { withClientTransaction } from "../db/tx.js";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import { validateBody } from "../middleware/validate.js";
import { sweepProductionBoardAutomation } from "../services/jobTruth/index.js";

const router = Router();

// Internal worker sweep for production-board automation (secret-gated, same
// pattern as /api/labor/internal/sweep). The sweep used to piggyback on GET
// list reads (audit F5 — a read that mutates); after the opt-in change it had
// NO invoker at all. The worker now owns the cadence.
router.post(
  "/internal/sweep",
  validateBody(z.object({ tenant_id: z.string().uuid().optional(), limit: z.number().int().min(1).max(400).optional() })),
  async (req, res, next) => {
    try {
      if (req.header("X-PMC-Internal-Secret") !== config.INTERNAL_SOCKET_SECRET) {
        throw new ApiError(403, "Forbidden");
      }
      const tenantIds =
        typeof req.body.tenant_id === "string"
          ? [req.body.tenant_id]
          : (
              await pool.query<{ id: string }>(`SELECT id::text AS id FROM tenant ORDER BY created_at ASC`)
            ).rows.map((row) => row.id);

      const results: Array<{ tenant_id: string; scanned_job_count: number }> = [];
      for (const tenantId of tenantIds) {
        const outcome = await withClientTransaction(tenantId, null, (client) =>
          sweepProductionBoardAutomation(client, tenantId, null, { limit: req.body.limit ?? 400 })
        );
        results.push({ tenant_id: tenantId, scanned_job_count: outcome.scanned_job_count });
      }

      return res.json({
        tenant_count: tenantIds.length,
        scanned_job_count: results.reduce((sum, entry) => sum + entry.scanned_job_count, 0),
        results
      });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
