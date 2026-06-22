import { Router } from "express";
import { withClientTransaction } from "../db/tx.js";
import { getProductionOperations } from "../services/productionOperations.js";
import type { AuthenticatedRequest } from "../types/http.js";

// June 18 feedback — canonical Production / Graphics operating read model. Scope (all/own) is derived
// inside the service from the auth; any authed user sees at least their own production work.
const router = Router();

router.get("/operations", async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    if (!auth) return res.status(401).json({ error: "Unauthorized" });
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getProductionOperations(client, auth, {
        stage: typeof req.query.stage === "string" ? req.query.stage : null,
        risk: typeof req.query.risk === "string" ? req.query.risk : null,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;
