import { Router } from "express";
import { withClientTransaction } from "../db/tx.js";
import { requireSchoolsHubReadAccess } from "../middleware/schoolsHubAccess.js";
import { getSchoolsLeadershipOperations } from "../services/schoolsLeadershipOperations.js";
import type { AuthenticatedRequest } from "../types/http.js";

// Phase 6A — Schools Leadership & CSR operating read model. One server-side aggregate over canonical
// records; scope ("all" leadership / "own" CSR) is derived inside the service from the auth.
const router = Router();

router.get("/operations", requireSchoolsHubReadAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => getSchoolsLeadershipOperations(client, auth));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;
