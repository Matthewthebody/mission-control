import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { withClientTransaction } from "../db/tx.js";
import type { AuthenticatedRequest } from "../types/http.js";
import {
  activateGearCheckout,
  assignPermanentKit,
  createGearCheckout,
  listActiveGearCheckouts,
  returnGearCheckout
} from "../services/gear.js";
import {
  createGearIssueReport,
  createGearTemporarySubstitution,
  endGearTemporarySubstitution,
  updateGearIssueReport
} from "../services/gearIssues.js";
import {
  getGearAssetDetail,
  getGearDashboard,
  getGearKitDetail,
  listGearAssets,
  listGearKits
} from "../services/gearInventory.js";
import { getGearMonthlyReport, resolveGearAlert } from "../services/gearReporting.js";
import {
  checkOutGearByQr,
  completePreShootVerification,
  confirmPreShootVerificationItem,
  listGearScanHistory,
  markPreShootVerificationItemMissing,
  recordPreShootVerificationItemScan,
  resolveGearByQrCode,
  returnGearByQr,
  startPreShootVerification
} from "../services/gearScan.js";
import { getRequestMeta } from "../utils/requestMeta.js";

const router = Router();

const gearIssueTypeSchema = z.enum([
  "broken",
  "damage",
  "missing",
  "missing_part",
  "not_working",
  "tile_inactive",
  "needs_repair",
  "tracker_issue",
  "battery_issue",
  "routine_service",
  "cleaning",
  "other"
]);

const serviceRecordStatusSchema = z.enum(["open", "under_review", "in_service", "resolved", "closed"]);

const gearStatusSchema = z.enum([
  "available",
  "assigned",
  "checked_out",
  "in_transit",
  "in_office",
  "needs_repair",
  "under_repair",
  "missing",
  "retired"
]);

const latLngSchema = z.object({
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional()
});

router.get(
  "/dashboard",
  requireAuth,
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => getGearDashboard(client, auth));
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/reports/monthly",
  requireAuth,
  validateQuery(
    z.object({
      month: z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}$/)
        .optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getGearMonthlyReport(client, auth, (req.query.month as string | undefined) ?? null)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/alerts/:alertId/resolve",
  requireAuth,
  validateBody(
    z.object({
      resolution_note: z.string().max(500).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        resolveGearAlert(
          client,
          auth,
          {
            alertId: String(req.params.alertId),
            resolutionNote: req.body.resolution_note ?? null
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

router.get(
  "/assets",
  requireAuth,
  validateQuery(
    z.object({
      search: z.string().trim().max(120).optional(),
      category: z.string().trim().max(120).optional(),
      status: gearStatusSchema.optional(),
      current_custodian_id: z.string().uuid().optional(),
      home_location_id: z.string().uuid().optional(),
      kit_id: z.string().uuid().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listGearAssets(client, auth, {
          search: (req.query.search as string | undefined) ?? null,
          category: (req.query.category as string | undefined) ?? null,
          status: (req.query.status as z.infer<typeof gearStatusSchema> | undefined) ?? null,
          currentCustodianId: (req.query.current_custodian_id as string | undefined) ?? null,
          homeLocationId: (req.query.home_location_id as string | undefined) ?? null,
          kitId: (req.query.kit_id as string | undefined) ?? null
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/assets/:assetId",
  requireAuth,
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getGearAssetDetail(client, auth, String(req.params.assetId))
      );
      if (!payload) {
        return res.status(404).json({ error: "Asset not found" });
      }
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/kits",
  requireAuth,
  validateQuery(
    z.object({
      search: z.string().trim().max(120).optional(),
      kit_type: z.string().trim().max(120).optional(),
      status: gearStatusSchema.optional(),
      assigned_user_id: z.string().uuid().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listGearKits(client, auth, {
          search: (req.query.search as string | undefined) ?? null,
          kitType: (req.query.kit_type as string | undefined) ?? null,
          status: (req.query.status as z.infer<typeof gearStatusSchema> | undefined) ?? null,
          assignedUserId: (req.query.assigned_user_id as string | undefined) ?? null
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/kits/:kitId",
  requireAuth,
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getGearKitDetail(client, auth, String(req.params.kitId))
      );
      if (!payload) {
        return res.status(404).json({ error: "Kit not found" });
      }
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/checkouts/active",
  requireAuth,
  requirePermission("gear_custody.view"),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const rows = await withClientTransaction(auth.tenantId, auth.id, (client) => listActiveGearCheckouts(client, auth));
      return res.json(rows);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/service-records",
  requireAuth,
  requirePermission("gear_service_records.create"),
  validateBody(
    z.object({
      target_type: z.enum(["asset", "kit"]),
      target_id: z.string().uuid(),
      issue_type: gearIssueTypeSchema,
      status: serviceRecordStatusSchema.optional(),
      linked_shoot_id: z.string().uuid().nullable().optional(),
      linked_location_id: z.string().uuid().nullable().optional(),
      source_checkout_id: z.string().uuid().nullable().optional(),
      note: z.string().max(500).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createGearIssueReport(
          client,
          auth,
          {
            targetType: req.body.target_type,
            targetId: req.body.target_id,
            issueType: req.body.issue_type,
            status: req.body.status,
            linkedShootId: req.body.linked_shoot_id ?? null,
            linkedLocationId: req.body.linked_location_id ?? null,
            sourceCheckoutId: req.body.source_checkout_id ?? null,
            note: req.body.note ?? null
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
  "/service-records/:serviceRecordId",
  requireAuth,
  requirePermission("gear_custody.edit"),
  validateBody(
    z.object({
      status: serviceRecordStatusSchema.optional(),
      note: z.string().max(500).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateGearIssueReport(
          client,
          auth,
          {
            serviceRecordId: String(req.params.serviceRecordId),
            status: req.body.status,
            note: req.body.note
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
  "/temporary-substitutions",
  requireAuth,
  requirePermission("gear_custody.edit"),
  validateBody(
    z.object({
      original_asset_id: z.string().uuid(),
      substitute_asset_id: z.string().uuid(),
      assigned_user_id: z.string().uuid().nullable().optional(),
      linked_shoot_id: z.string().uuid().nullable().optional(),
      linked_location_id: z.string().uuid().nullable().optional(),
      note: z.string().max(500).nullable().optional(),
      override_conflict: z.boolean().optional(),
      override_reason: z.string().max(500).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createGearTemporarySubstitution(
          client,
          auth,
          {
            originalAssetId: req.body.original_asset_id,
            substituteAssetId: req.body.substitute_asset_id,
            assignedUserId: req.body.assigned_user_id ?? null,
            linkedShootId: req.body.linked_shoot_id ?? null,
            linkedLocationId: req.body.linked_location_id ?? null,
            note: req.body.note ?? null,
            overrideConflict: req.body.override_conflict ?? false,
            overrideReason: req.body.override_reason ?? null
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
  "/temporary-substitutions/:substitutionId/end",
  requireAuth,
  requirePermission("gear_custody.edit"),
  validateBody(
    z.object({
      note: z.string().max(500).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        endGearTemporarySubstitution(
          client,
          auth,
          {
            substitutionId: String(req.params.substitutionId),
            note: req.body.note ?? null
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
  "/scan/resolve",
  requireAuth,
  requirePermission("gear_custody.view"),
  validateBody(
    latLngSchema.extend({
      qr_code_id: z.string().trim().min(1),
      linked_shoot_id: z.string().uuid().nullable().optional(),
      linked_location_id: z.string().uuid().nullable().optional(),
      note: z.string().max(500).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        resolveGearByQrCode(
          client,
          auth,
          {
            qrCodeId: req.body.qr_code_id,
            linkedShootId: req.body.linked_shoot_id ?? null,
            linkedLocationId: req.body.linked_location_id ?? null,
            note: req.body.note ?? null,
            latitude: req.body.latitude ?? null,
            longitude: req.body.longitude ?? null
          },
          getRequestMeta(req)
        )
      );
      return res.status(payload.status === "not_found" ? 404 : 200).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/scan-history",
  requireAuth,
  requirePermission("gear_custody.view"),
  validateQuery(
    z.object({
      linked_shoot_id: z.string().uuid().optional(),
      target_type: z.enum(["asset", "kit"]).optional(),
      target_id: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listGearScanHistory(client, auth, {
          linkedShootId: req.query.linked_shoot_id ? String(req.query.linked_shoot_id) : null,
          targetType: req.query.target_type ? (String(req.query.target_type) as "asset" | "kit") : null,
          targetId: req.query.target_id ? String(req.query.target_id) : null,
          limit: req.query.limit ? Number(req.query.limit) : undefined
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/kits/:kitId/permanent-assignment",
  requireAuth,
  requirePermission("gear_custody.edit"),
  validateBody(
    z.object({
      assigned_user_id: z.string().uuid().nullable(),
      assignment_started_at: z.string().datetime().nullable().optional(),
      assignment_note: z.string().max(500).nullable().optional(),
      current_custodian_user_id: z.string().uuid().nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const kit = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        assignPermanentKit(
          client,
          auth,
          {
            kitId: String(req.params.kitId),
            assignedUserId: req.body.assigned_user_id ?? null,
            assignmentStartedAt: req.body.assignment_started_at ?? null,
            assignmentNote: req.body.assignment_note ?? null,
            currentCustodianUserId: req.body.current_custodian_user_id
          },
          getRequestMeta(req)
        )
      );
      return res.status(201).json(kit);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/kits/:kitId/pre-shoot-verifications",
  requireAuth,
  requirePermission("gear_custody.edit"),
  validateBody(
    latLngSchema.extend({
      linked_shoot_id: z.string().uuid().nullable().optional(),
      linked_location_id: z.string().uuid().nullable().optional(),
      note: z.string().max(500).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        startPreShootVerification(
          client,
          auth,
          {
            kitId: String(req.params.kitId),
            linkedShootId: req.body.linked_shoot_id ?? null,
            linkedLocationId: req.body.linked_location_id ?? null,
            note: req.body.note ?? null,
            latitude: req.body.latitude ?? null,
            longitude: req.body.longitude ?? null
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
  "/pre-shoot-verifications/:verificationId/confirm-item",
  requireAuth,
  requirePermission("gear_custody.edit"),
  validateBody(
    latLngSchema.extend({
      expected_asset_id: z.string().uuid(),
      note: z.string().max(500).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        confirmPreShootVerificationItem(
          client,
          auth,
          {
            verificationId: String(req.params.verificationId),
            expectedAssetId: req.body.expected_asset_id,
            note: req.body.note ?? null,
            latitude: req.body.latitude ?? null,
            longitude: req.body.longitude ?? null
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
  "/pre-shoot-verifications/:verificationId/scan-item",
  requireAuth,
  requirePermission("gear_custody.edit"),
  validateBody(
    latLngSchema.extend({
      qr_code_id: z.string().trim().min(1),
      note: z.string().max(500).nullable().optional(),
      override_mismatch: z.boolean().optional(),
      override_reason: z.string().max(500).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        recordPreShootVerificationItemScan(
          client,
          auth,
          {
            verificationId: String(req.params.verificationId),
            qrCodeId: req.body.qr_code_id,
            note: req.body.note ?? null,
            overrideMismatch: req.body.override_mismatch ?? false,
            overrideReason: req.body.override_reason ?? null,
            latitude: req.body.latitude ?? null,
            longitude: req.body.longitude ?? null
          },
          getRequestMeta(req)
        )
      );
      return res.status(payload.status === "mismatch" ? 409 : 200).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/pre-shoot-verifications/:verificationId/missing-item",
  requireAuth,
  requirePermission("gear_custody.edit"),
  validateBody(
    latLngSchema.extend({
      expected_asset_id: z.string().uuid(),
      note: z.string().max(500).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        markPreShootVerificationItemMissing(
          client,
          auth,
          {
            verificationId: String(req.params.verificationId),
            expectedAssetId: req.body.expected_asset_id,
            note: req.body.note ?? null,
            latitude: req.body.latitude ?? null,
            longitude: req.body.longitude ?? null
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
  "/pre-shoot-verifications/:verificationId/complete",
  requireAuth,
  requirePermission("gear_custody.edit"),
  validateBody(
    latLngSchema.extend({
      note: z.string().max(500).nullable().optional(),
      override_reason: z.string().max(500).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        completePreShootVerification(
          client,
          auth,
          {
            verificationId: String(req.params.verificationId),
            note: req.body.note ?? null,
            overrideReason: req.body.override_reason ?? null,
            latitude: req.body.latitude ?? null,
            longitude: req.body.longitude ?? null
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
  "/checkouts",
  requireAuth,
  requirePermission("gear_custody.create"),
  validateBody(
    z.object({
      target_type: z.enum(["asset", "kit"]),
      target_id: z.string().uuid(),
      checked_out_to_user_id: z.string().uuid(),
      initial_status: z.enum(["assigned", "checked_out"]).default("checked_out"),
      linked_shoot_id: z.string().uuid().nullable().optional(),
      linked_location_id: z.string().uuid().nullable().optional(),
      expected_return_at: z.string().datetime().nullable().optional(),
      note: z.string().max(500).nullable().optional(),
      override_conflict: z.boolean().optional(),
      override_reason: z.string().max(500).nullable().optional(),
      pickup_working_order_confirmed: z.boolean().nullable().optional(),
      pickup_issue_type: gearIssueTypeSchema.nullable().optional(),
      pickup_issue_note: z.string().max(500).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createGearCheckout(
          client,
          auth,
          {
            targetType: req.body.target_type,
            targetId: req.body.target_id,
            checkedOutToUserId: req.body.checked_out_to_user_id,
            initialStatus: req.body.initial_status,
            linkedShootId: req.body.linked_shoot_id ?? null,
            linkedLocationId: req.body.linked_location_id ?? null,
            expectedReturnAt: req.body.expected_return_at ?? null,
            note: req.body.note ?? null,
            overrideConflict: req.body.override_conflict ?? false,
            overrideReason: req.body.override_reason ?? null,
            pickupWorkingOrderConfirmed: req.body.pickup_working_order_confirmed ?? null,
            pickupIssueType: req.body.pickup_issue_type ?? null,
            pickupIssueNote: req.body.pickup_issue_note ?? null
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
  "/scan/check-out",
  requireAuth,
  requirePermission("gear_custody.create"),
  validateBody(
    latLngSchema.extend({
      qr_code_id: z.string().trim().min(1),
      checked_out_to_user_id: z.string().uuid(),
      linked_shoot_id: z.string().uuid().nullable().optional(),
      linked_location_id: z.string().uuid().nullable().optional(),
      expected_return_at: z.string().datetime().nullable().optional(),
      note: z.string().max(500).nullable().optional(),
      override_conflict: z.boolean().optional(),
      override_reason: z.string().max(500).nullable().optional(),
      verification_id: z.string().uuid().nullable().optional(),
      pickup_working_order_confirmed: z.boolean().nullable().optional(),
      pickup_issue_type: gearIssueTypeSchema.nullable().optional(),
      pickup_issue_note: z.string().max(500).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        checkOutGearByQr(
          client,
          auth,
          {
            qrCodeId: req.body.qr_code_id,
            checkedOutToUserId: req.body.checked_out_to_user_id,
            linkedShootId: req.body.linked_shoot_id ?? null,
            linkedLocationId: req.body.linked_location_id ?? null,
            expectedReturnAt: req.body.expected_return_at ?? null,
            note: req.body.note ?? null,
            overrideConflict: req.body.override_conflict ?? false,
            overrideReason: req.body.override_reason ?? null,
            verificationId: req.body.verification_id ?? null,
            pickupWorkingOrderConfirmed: req.body.pickup_working_order_confirmed ?? null,
            pickupIssueType: req.body.pickup_issue_type ?? null,
            pickupIssueNote: req.body.pickup_issue_note ?? null,
            latitude: req.body.latitude ?? null,
            longitude: req.body.longitude ?? null
          },
          getRequestMeta(req)
        )
      );

      const status =
        payload.status === "checked_out"
          ? 201
          : payload.status === "conflict" || payload.status === "verification_required"
            ? 409
            : 404;
      return res.status(status).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/checkouts/:checkoutId/check-out",
  requireAuth,
  requirePermission("gear_custody.edit"),
  validateBody(
    z.object({
      checked_out_at: z.string().datetime().nullable().optional(),
      note: z.string().max(500).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        activateGearCheckout(
          client,
          auth,
          {
            checkoutId: String(req.params.checkoutId),
            checkedOutAt: req.body.checked_out_at ?? null,
            note: req.body.note ?? null
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
  "/checkouts/:checkoutId/return",
  requireAuth,
  requirePermission("gear_custody.edit"),
  validateBody(
    z.object({
      returned_at: z.string().datetime().nullable().optional(),
      working_order_confirmed: z.boolean(),
      issue_type: gearIssueTypeSchema.nullable().optional(),
      note: z.string().max(500).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        returnGearCheckout(
          client,
          auth,
          {
            checkoutId: String(req.params.checkoutId),
            returnedAt: req.body.returned_at ?? null,
            workingOrderConfirmed: req.body.working_order_confirmed,
            issueType: req.body.issue_type ?? null,
            note: req.body.note ?? null
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
  "/scan/return",
  requireAuth,
  requirePermission("gear_custody.edit"),
  validateBody(
    latLngSchema.extend({
      qr_code_id: z.string().trim().min(1),
      working_order_confirmed: z.boolean(),
      issue_type: gearIssueTypeSchema.nullable().optional(),
      note: z.string().max(500).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        returnGearByQr(
          client,
          auth,
          {
            qrCodeId: req.body.qr_code_id,
            workingOrderConfirmed: req.body.working_order_confirmed,
            issueType: req.body.issue_type ?? null,
            note: req.body.note ?? null,
            latitude: req.body.latitude ?? null,
            longitude: req.body.longitude ?? null
          },
          getRequestMeta(req)
        )
      );

      const status =
        payload.status === "returned"
          ? 200
          : payload.status === "not_checked_out"
            ? 409
            : 404;
      return res.status(status).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
