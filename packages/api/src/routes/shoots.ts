import { Router } from "express";
import { z } from "zod";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { withClientTransaction } from "../db/tx.js";
import { loadLiveShootQueue } from "../application/shoots/load-live-shoot-queue.action.js";
import { createShoot, deleteShoot, getShootById, listShootReferenceData, listShoots, updateShoot } from "../services/shoots.js";
import { confirmShootReadyToShoot } from "../services/readyToShoot.js";
import { getDefaultShootGeofenceMeters } from "../services/maps.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { getRequestMeta } from "../utils/requestMeta.js";

const router = Router();

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const shootTypeSchema = z.enum([
  "schools_underclass_portraits",
  "schools_events",
  "sports",
  "events",
  "studio",
  "headshots",
  "commercial",
  "internal"
]);
const shootStructureSchema = z.enum(["standard", "open_house"]);
const shootImportanceTierSchema = z.enum(["standard", "elevated", "big_shoot", "critical_shoot"]);
const shootStatusSchema = z.enum([
  "DRAFT",
  "TENTATIVE",
  "CONFIRMED",
  "READY",
  "LIVE",
  "SHOOT_COMPLETE",
  "POST_PRODUCTION",
  "COMPLETE",
  "ON_HOLD",
  "CANCELLED"
]);
const shootPostProductionSubstageSchema = z.enum([
  "INTAKE_PENDING",
  "ASSETS_RECEIVED",
  "EDITING_PROCESSING",
  "GRAPHICS_PACKAGING",
  "UPLOAD_DELIVERY_PREP",
  "QA_REVIEW",
  "CORRECTION_NEEDED",
  "READY_TO_RELEASE"
]);

const shootSchema = z.object({
  studio_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  location_id: z.string().uuid(),
  primary_contact_id: z.string().uuid(),
  additional_contact_ids: z.array(z.string().uuid()).max(8).optional(),
  shoot_type: shootTypeSchema,
  shoot_subtype: z.string().trim().max(120).nullable().optional(),
  shoot_code: z.string().min(1),
  title: z.string().min(1),
  shoot_date: z.string().min(1),
  geofence_radius_meters: z.number().int().positive().default(getDefaultShootGeofenceMeters()),
  showtime: z.string().min(1).nullable().optional(),
  arrival_time: z.string().min(1),
  start_time: z.string().min(1),
  end_time_est: z.string().min(1),
  projected_students: z.number().int().nonnegative().optional(),
  planned_staff_count: z.number().int().nonnegative().optional(),
  required_lead_count: z.number().int().positive().optional(),
  staffing_template_id: z.string().uuid().nullable().optional(),
  status: shootStatusSchema.optional(),
  status_reason: z.string().trim().max(500).nullable().optional(),
  post_production_substage: shootPostProductionSubstageSchema.nullable().optional(),
  operations_priority: z.enum(["standard", "elevated", "high_priority"]).optional(),
  big_shoot_manual_override: z.boolean().optional(),
  camera_station_count: z.number().int().nonnegative().optional(),
  shoot_structure: shootStructureSchema.optional(),
  first_year_customer_flag: z.boolean().optional(),
  flagship_priority_account_flag: z.boolean().optional(),
  weather_travel_risk_flag: z.boolean().optional(),
  manual_leadership_boost: z.number().int().min(0).max(15).optional(),
  importance_override_tier: shootImportanceTierSchema.nullable().optional(),
  importance_override_reason: z.string().trim().max(500).nullable().optional(),
  special_instructions: z.string().trim().max(4000).nullable().optional(),
  access_notes: z.string().trim().max(2000).nullable().optional(),
  additional_products: z.string().trim().max(1000).nullable().optional(),
  additional_products_flag: z.boolean().optional(),
  special_equipment: z.string().trim().max(1000).nullable().optional(),
  special_equipment_flag: z.boolean().optional(),
  setup_notes: z.string().trim().max(2000).nullable().optional(),
  day_of_notes: z.string().trim().max(2000).nullable().optional(),
  internal_notes: z.string().trim().max(4000).nullable().optional(),
  pre_service_notes_complete: z.boolean().optional(),
  special_deliverables_ready: z.boolean().optional(),
  gear_requirements_ready: z.boolean().optional(),
  roster_data_required: z.boolean().optional(),
  roster_data_ready: z.boolean().optional(),
  revenue_potential_score: z.number().int().min(0).max(100).nullable().optional(),
  strategic_district_importance: z.boolean().optional(),
  account_growth_importance_score: z.number().int().min(0).max(100).nullable().optional(),
  complexity_score: z.number().int().min(0).max(100).nullable().optional(),
  customer_history_risk_score: z.number().int().min(0).max(100).nullable().optional(),
  multi_team_coordination: z.boolean().optional(),
  readiness_owner_user_id: z.string().uuid().nullable().optional(),
  future_profitability_manual: z.enum(["favorable", "neutral", "watch", "needs_review"]).nullable().optional(),
  future_profitability_reason: z.string().max(500).nullable().optional(),
  allow_checklist_override: z.boolean().nullable().optional(),
  checklist_override_reason: z.string().trim().max(2000).nullable().optional()
});

const shootListQuerySchema = z
  .object({
    date: isoDateSchema.optional(),
    date_from: isoDateSchema.optional(),
    date_to: isoDateSchema.optional()
  })
  .superRefine((value, ctx) => {
    const hasSingleDate = Boolean(value.date);
    const hasRange = Boolean(value.date_from || value.date_to);

    if (!hasSingleDate && !hasRange) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide date or date_from/date_to"
      });
      return;
    }

    if (hasRange && (!value.date_from || !value.date_to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "date_from and date_to must both be provided"
      });
    }
  });

const readyToShootSchema = z.object({
  exception_reason: z.string().trim().max(500).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  accuracy_meters: z.number().nonnegative().max(100000).nullable().optional(),
  device_context: z.record(z.string(), z.unknown()).nullable().optional()
});

router.post("/", requireAuth, requirePermission("shoot.create"), validateBody(shootSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const shoot = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      createShoot(client, auth, req.body)
    );
    return res.status(201).json(shoot);
  } catch (error) {
    return next(error);
  }
});

router.get("/reference-data", requireAuth, requirePermission("shoot.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      listShootReferenceData(client, auth)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/live-queue",
  requireAuth,
  requirePermission("shoot.read"),
  validateQuery(shootListQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const projection = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
        loadLiveShootQueue(
          client,
          {
            date: typeof req.query.date === "string" ? req.query.date : undefined,
            dateFrom: typeof req.query.date_from === "string" ? req.query.date_from : undefined,
            dateTo: typeof req.query.date_to === "string" ? req.query.date_to : undefined
          },
          auth
        )
      );
      return res.json(projection);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/",
  requireAuth,
  requirePermission("shoot.read"),
  validateQuery(shootListQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const shoots = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
        listShoots(
          client,
          {
            date: typeof req.query.date === "string" ? req.query.date : undefined,
            dateFrom: typeof req.query.date_from === "string" ? req.query.date_from : undefined,
            dateTo: typeof req.query.date_to === "string" ? req.query.date_to : undefined
          },
          auth
        )
      );
      return res.json(shoots);
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/:id", requireAuth, requirePermission("shoot.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const shoot = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      getShootById(client, String(req.params.id), auth)
    );
    if (!shoot) {
      return res.status(404).json({ error: "Shoot not found" });
    }
    return res.json(shoot);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:id", requireAuth, requirePermission("shoot.update"), validateBody(shootSchema.partial()), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const shoot = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      updateShoot(client, auth, String(req.params.id), req.body)
    );
    return res.json(shoot);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/ready-to-shoot", requireAuth, validateBody(readyToShootSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const shoot = await withClientTransaction(auth.tenantId, auth.id, async (client) => {
      await confirmShootReadyToShoot(client, auth, String(req.params.id), req.body, getRequestMeta(req));
      return getShootById(client, String(req.params.id), auth);
    });
    if (!shoot) {
      return res.status(404).json({ error: "Shoot not found" });
    }
    return res.json(shoot);
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id", requireAuth, requirePermission("shoot.delete"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const removed = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      deleteShoot(client, auth, String(req.params.id), getRequestMeta(req))
    );
    return res.json({ deleted: removed });
  } catch (error) {
    return next(error);
  }
});

export default router;
