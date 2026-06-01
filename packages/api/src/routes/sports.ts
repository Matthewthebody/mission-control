import { Router } from "express";
import { z } from "zod";
import { withClientTransaction } from "../db/tx.js";
import { ApiError } from "../errors/apiError.js";
import {
  requireSportsFinanceAccess,
  requireSportsManageAccess,
  requireSportsReadAccess,
  requireSportsSettingsAccess
} from "../middleware/sportsAccess.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import {
  SPORTS_PRODUCTION_STATUSES,
  SPORTS_PEER_QA_STATUSES,
  SPORTS_PROOF_STATUSES,
  SPORTS_READINESS_STATUSES,
  SPORTS_RISK_STATUSES,
  SPORTS_SHOOT_STATUSES,
  SPORTS_STAFFING_STATUSES,
  SPORTS_WATCH_FLAG_STATUSES
} from "../types/sports.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { getRequestMeta } from "../utils/requestMeta.js";
import {
  approveSportsPeerQaReview,
  deleteSportsTeamUnit,
  getSportsAccountDetail,
  getSportsOverview,
  listSportsPeerQaBoard,
  getSportsReports,
  getSportsSettings,
  getSportsShootDetail,
  listSportsAccounts,
  listSportsContacts,
  listSportsProduction,
  listSportsShoots,
  listSportsWatchlist,
  updateSportsReadinessItem,
  updateSportsPeerQaChecklistItem,
  updateSportsPeerQaReview,
  upsertSportsFinancialSummary,
  upsertSportsProofCycle,
  upsertSportsSpecialtyProduct,
  upsertSportsTeamUnit,
  upsertSportsWatchFlag
} from "../services/sports.js";

const router = Router();

const uuidSchema = z.string().uuid();
const dateSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);
const dateTimeSchema = z.string().trim().datetime({ offset: true });

const shootListQuerySchema = z.object({
  search: z.string().trim().max(160).optional(),
  view: z.enum(["list", "calendar", "kanban", "timeline"]).optional(),
  date_from: dateSchema.optional(),
  date_to: dateSchema.optional(),
  organization_id: uuidSchema.optional(),
  sport_type: z.string().trim().max(80).optional(),
  season: z.string().trim().max(40).optional(),
  shoot_status: z.enum(SPORTS_SHOOT_STATUSES).optional(),
  production_status: z.enum(SPORTS_PRODUCTION_STATUSES).optional(),
  proof_status: z.enum(SPORTS_PROOF_STATUSES).optional(),
  staffing_status: z.enum(SPORTS_STAFFING_STATUSES).optional(),
  readiness_status: z.enum(SPORTS_READINESS_STATUSES).optional(),
  risk_status: z.enum(SPORTS_RISK_STATUSES).optional(),
  lead_photographer_user_id: uuidSchema.optional(),
  account_owner_user_id: uuidSchema.optional(),
  location_id: uuidSchema.optional(),
  proof_required: z.coerce.boolean().optional(),
  revenue_share_enabled: z.coerce.boolean().optional(),
  banner_work_required: z.coerce.boolean().optional(),
  saved_view: z.string().trim().max(80).optional()
});

const overviewQuerySchema = z.object({
  saved_view: z.string().trim().max(80).optional()
});

const updateReadinessSchema = z
  .object({
    is_complete: z.boolean().optional(),
    notes: z.string().trim().max(4000).nullable().optional()
  })
  .refine((value) => value.is_complete !== undefined || value.notes !== undefined, "Provide at least one readiness update.");

const teamUnitSchema = z.object({
  team_name: z.string().trim().min(1).max(180),
  display_order: z.number().int().min(0).nullable().optional(),
  age_group: z.string().trim().max(120).nullable().optional(),
  division: z.string().trim().max(120).nullable().optional(),
  coach_contact_id: uuidSchema.nullable().optional(),
  proof_owner_contact_id: uuidSchema.nullable().optional(),
  scheduled_slot_start: dateTimeSchema.nullable().optional(),
  scheduled_slot_end: dateTimeSchema.nullable().optional(),
  estimated_subject_count: z.number().int().min(0).nullable().optional(),
  actual_subject_count: z.number().int().min(0).nullable().optional(),
  banner_required: z.boolean().nullable().optional(),
  specialty_notes: z.string().trim().max(2000).nullable().optional(),
  status: z.string().trim().max(80).nullable().optional()
});

const watchFlagSchema = z.object({
  severity: z.string().trim().max(40).nullable().optional(),
  flag_type: z.string().trim().max(80).nullable().optional(),
  title: z.string().trim().max(180).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  status: z.enum(SPORTS_WATCH_FLAG_STATUSES).nullable().optional(),
  owner_user_id: uuidSchema.nullable().optional(),
  due_at: dateTimeSchema.nullable().optional()
});

const proofCycleSchema = z.object({
  production_item_id: uuidSchema.nullable().optional(),
  team_unit_id: uuidSchema.nullable().optional(),
  approver_contact_id: uuidSchema.nullable().optional(),
  status: z.string().trim().max(80).nullable().optional(),
  sent_at: dateTimeSchema.nullable().optional(),
  viewed_at: dateTimeSchema.nullable().optional(),
  approved_at: dateTimeSchema.nullable().optional(),
  revision_count: z.number().int().min(0).nullable().optional(),
  due_date: dateSchema.nullable().optional(),
  last_follow_up_at: dateTimeSchema.nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional()
});

const productItemSchema = z.object({
  production_item_id: uuidSchema.nullable().optional(),
  team_unit_id: uuidSchema.nullable().optional(),
  product_type: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(180),
  quantity: z.number().int().min(0).nullable().optional(),
  status: z.string().trim().max(80).nullable().optional(),
  approval_required: z.boolean().nullable().optional(),
  approved_at: dateTimeSchema.nullable().optional(),
  assigned_to_user_id: uuidSchema.nullable().optional(),
  vendor_name: z.string().trim().max(180).nullable().optional(),
  due_date: dateSchema.nullable().optional(),
  delivered_at: dateTimeSchema.nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional()
});

const financialSummarySchema = z.object({
  pricing_profile_name: z.string().trim().max(180).nullable().optional(),
  invoice_number: z.string().trim().max(120).nullable().optional(),
  invoice_status: z.string().trim().max(80).nullable().optional(),
  invoice_due_date: dateSchema.nullable().optional(),
  revenue_share_enabled: z.boolean().nullable().optional(),
  revenue_share_terms_summary: z.string().trim().max(2000).nullable().optional(),
  estimated_revenue: z.number().nullable().optional(),
  actual_revenue: z.number().nullable().optional(),
  estimated_cost: z.number().nullable().optional(),
  actual_cost: z.number().nullable().optional(),
  payout_amount: z.number().nullable().optional(),
  payment_status: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional()
});

const peerQaReviewUpdateSchema = z
  .object({
    qa_status: z.enum(SPORTS_PEER_QA_STATUSES).optional(),
    correction_category: z.string().trim().max(120).nullable().optional(),
    correction_notes: z.string().trim().max(4000).nullable().optional(),
    blocker_reason: z.string().trim().max(180).nullable().optional(),
    blocker_owner: z.string().trim().max(120).nullable().optional(),
    blocker_notes: z.string().trim().max(4000).nullable().optional()
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    "Provide at least one Sports peer QA update."
  );

const peerQaChecklistUpdateSchema = z.object({
  section: z.enum(["owner", "peer", "conditional"]),
  label: z.string().trim().min(1).max(240),
  complete: z.boolean()
});

const peerQaApprovalSchema = z.object({
  approved_by: z.string().trim().max(160).nullable().optional()
});

function getAuth(req: AuthenticatedRequest) {
  return req.auth;
}

function getUuidParam(value: string, label: string) {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, `Invalid ${label}.`);
  }
  return parsed.data;
}

router.get("/", requireSportsReadAccess, validateQuery(overviewQuerySchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as AuthenticatedRequest);
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getSportsOverview(client, auth, { saved_view: req.query.saved_view ? String(req.query.saved_view) : null })
    );
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.get("/shoots", requireSportsReadAccess, validateQuery(shootListQuerySchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as AuthenticatedRequest);
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listSportsShoots(client, auth, req.query)
    );
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.get("/shoots/:shootId", requireSportsReadAccess, async (req, res, next) => {
  try {
    const shootId = getUuidParam(String(req.params.shootId), "sports shoot id");
    const auth = getAuth(req as AuthenticatedRequest);
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) => getSportsShootDetail(client, auth, shootId));
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.patch(
  "/shoots/:shootId/readiness/:itemId",
  requireSportsManageAccess,
  validateBody(updateReadinessSchema),
  async (req, res, next) => {
    try {
      const shootId = getUuidParam(String(req.params.shootId), "sports shoot id");
      const itemId = getUuidParam(String(req.params.itemId), "readiness item id");
      const auth = getAuth(req as AuthenticatedRequest);
      const response = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateSportsReadinessItem(client, auth, shootId, itemId, req.body, getRequestMeta(req))
      );
      return res.json(response);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/shoots/:shootId/teams", requireSportsManageAccess, validateBody(teamUnitSchema), async (req, res, next) => {
  try {
    const shootId = getUuidParam(String(req.params.shootId), "sports shoot id");
    const auth = getAuth(req as AuthenticatedRequest);
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      upsertSportsTeamUnit(client, auth, shootId, req.body, {}, getRequestMeta(req))
    );
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.patch("/shoots/:shootId/teams/:teamUnitId", requireSportsManageAccess, validateBody(teamUnitSchema), async (req, res, next) => {
  try {
    const shootId = getUuidParam(String(req.params.shootId), "sports shoot id");
    const teamUnitId = getUuidParam(String(req.params.teamUnitId), "team unit id");
    const auth = getAuth(req as AuthenticatedRequest);
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      upsertSportsTeamUnit(client, auth, shootId, req.body, { teamUnitId }, getRequestMeta(req))
    );
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.delete("/shoots/:shootId/teams/:teamUnitId", requireSportsManageAccess, async (req, res, next) => {
  try {
    const shootId = getUuidParam(String(req.params.shootId), "sports shoot id");
    const teamUnitId = getUuidParam(String(req.params.teamUnitId), "team unit id");
    const auth = getAuth(req as AuthenticatedRequest);
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      deleteSportsTeamUnit(client, auth, shootId, teamUnitId, getRequestMeta(req))
    );
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.post("/shoots/:shootId/watch-flags", requireSportsManageAccess, validateBody(watchFlagSchema), async (req, res, next) => {
  try {
    const shootId = getUuidParam(String(req.params.shootId), "sports shoot id");
    const auth = getAuth(req as AuthenticatedRequest);
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      upsertSportsWatchFlag(client, auth, shootId, req.body, {}, getRequestMeta(req))
    );
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.patch(
  "/shoots/:shootId/watch-flags/:flagId",
  requireSportsManageAccess,
  validateBody(watchFlagSchema),
  async (req, res, next) => {
    try {
      const shootId = getUuidParam(String(req.params.shootId), "sports shoot id");
      const flagId = getUuidParam(String(req.params.flagId), "watch flag id");
      const auth = getAuth(req as AuthenticatedRequest);
      const response = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        upsertSportsWatchFlag(client, auth, shootId, req.body, { flagId }, getRequestMeta(req))
      );
      return res.json(response);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/shoots/:shootId/proof-cycles", requireSportsManageAccess, validateBody(proofCycleSchema), async (req, res, next) => {
  try {
    const shootId = getUuidParam(String(req.params.shootId), "sports shoot id");
    const auth = getAuth(req as AuthenticatedRequest);
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      upsertSportsProofCycle(client, auth, shootId, req.body, {}, getRequestMeta(req))
    );
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.patch(
  "/shoots/:shootId/proof-cycles/:proofCycleId",
  requireSportsManageAccess,
  validateBody(proofCycleSchema),
  async (req, res, next) => {
    try {
      const shootId = getUuidParam(String(req.params.shootId), "sports shoot id");
      const proofCycleId = getUuidParam(String(req.params.proofCycleId), "proof cycle id");
      const auth = getAuth(req as AuthenticatedRequest);
      const response = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        upsertSportsProofCycle(client, auth, shootId, req.body, { proofCycleId }, getRequestMeta(req))
      );
      return res.json(response);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/shoots/:shootId/products", requireSportsManageAccess, validateBody(productItemSchema), async (req, res, next) => {
  try {
    const shootId = getUuidParam(String(req.params.shootId), "sports shoot id");
    const auth = getAuth(req as AuthenticatedRequest);
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      upsertSportsSpecialtyProduct(client, auth, shootId, req.body, {}, getRequestMeta(req))
    );
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.patch(
  "/shoots/:shootId/products/:productItemId",
  requireSportsManageAccess,
  validateBody(productItemSchema),
  async (req, res, next) => {
    try {
      const shootId = getUuidParam(String(req.params.shootId), "sports shoot id");
      const productItemId = getUuidParam(String(req.params.productItemId), "product item id");
      const auth = getAuth(req as AuthenticatedRequest);
      const response = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        upsertSportsSpecialtyProduct(client, auth, shootId, req.body, { productItemId }, getRequestMeta(req))
      );
      return res.json(response);
    } catch (error) {
      return next(error);
    }
  }
);

router.put("/shoots/:shootId/financial-summary", requireSportsFinanceAccess, validateBody(financialSummarySchema), async (req, res, next) => {
  try {
    const shootId = getUuidParam(String(req.params.shootId), "sports shoot id");
    const auth = getAuth(req as AuthenticatedRequest);
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      upsertSportsFinancialSummary(client, auth, shootId, req.body, getRequestMeta(req))
    );
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.get("/accounts", requireSportsReadAccess, async (req, res, next) => {
  try {
    const auth = getAuth(req as AuthenticatedRequest);
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) => listSportsAccounts(client, auth));
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.get("/accounts/:organizationId", requireSportsReadAccess, async (req, res, next) => {
  try {
    const organizationId = getUuidParam(String(req.params.organizationId), "organization id");
    const auth = getAuth(req as AuthenticatedRequest);
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getSportsAccountDetail(client, auth, organizationId)
    );
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.get("/contacts", requireSportsReadAccess, async (req, res, next) => {
  try {
    const auth = getAuth(req as AuthenticatedRequest);
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) => listSportsContacts(client, auth));
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.get("/production", requireSportsReadAccess, async (req, res, next) => {
  try {
    const auth = getAuth(req as AuthenticatedRequest);
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) => listSportsProduction(client, auth));
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.get("/peer-qa", requireSportsReadAccess, async (req, res, next) => {
  try {
    const auth = getAuth(req as AuthenticatedRequest);
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) => listSportsPeerQaBoard(client, auth));
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.patch("/peer-qa/:reviewId", requireSportsManageAccess, validateBody(peerQaReviewUpdateSchema), async (req, res, next) => {
  try {
    const reviewId = getUuidParam(String(req.params.reviewId), "Sports peer QA review id");
    const auth = getAuth(req as AuthenticatedRequest);
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) => updateSportsPeerQaReview(client, auth, reviewId, req.body));
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.patch("/peer-qa/:reviewId/checklist", requireSportsManageAccess, validateBody(peerQaChecklistUpdateSchema), async (req, res, next) => {
  try {
    const reviewId = getUuidParam(String(req.params.reviewId), "Sports peer QA review id");
    const auth = getAuth(req as AuthenticatedRequest);
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) => updateSportsPeerQaChecklistItem(client, auth, reviewId, req.body));
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.post("/peer-qa/:reviewId/approve", requireSportsManageAccess, validateBody(peerQaApprovalSchema), async (req, res, next) => {
  try {
    const reviewId = getUuidParam(String(req.params.reviewId), "Sports peer QA review id");
    const auth = getAuth(req as AuthenticatedRequest);
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) => approveSportsPeerQaReview(client, auth, reviewId, req.body));
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.get("/watchlist", requireSportsReadAccess, async (req, res, next) => {
  try {
    const auth = getAuth(req as AuthenticatedRequest);
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) => listSportsWatchlist(client, auth));
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.get("/reports", requireSportsReadAccess, async (req, res, next) => {
  try {
    const auth = getAuth(req as AuthenticatedRequest);
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) => getSportsReports(client, auth));
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.get("/settings", requireSportsSettingsAccess, async (req, res, next) => {
  try {
    const auth = getAuth(req as AuthenticatedRequest);
    const response = await getSportsSettings(auth);
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

export default router;
