import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireOperatingSystemModuleManage, requireOperatingSystemModuleView } from "../middleware/operatingSystemAccess.js";
import { requireAction } from "../middleware/rbac.js";
import { validateBody } from "../middleware/validate.js";
import { withClientTransaction } from "../db/tx.js";
import type { AuthenticatedRequest } from "../types/http.js";
import {
  createBackgroundPack,
  createBackgroundVariant,
  createPresetVersion,
  createProductionPreset,
  createToolLicense,
  loadProductionAssetWorkspace,
  updateBackgroundPack,
  updateBackgroundVariant,
  updatePresetVersion,
  updateProductionPreset,
  updateToolLicense
} from "../services/productionAssets.js";

const router = Router();

const jobTypeSchema = z.enum([
  "standard_school_production",
  "sports_production",
  "specialty_graphics",
  "banner_specialty_product",
  "gallery_prep_upload",
  "qa_final_review",
  "correction_rework"
]);

const validationStatusSchema = z.enum(["unvalidated", "validated", "deprecated"]);
const licenseStatusSchema = z.enum(["active", "inactive", "expiring", "expired"]);
const licenseTypeSchema = z.enum(["subscription", "perpetual", "floating", "device", "seat", "other"]);

const createPresetSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).nullable().optional(),
  active_status: z.boolean().optional(),
  validation_status: validationStatusSchema.optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  job_types: z.array(jobTypeSchema).optional(),
  glasses_handling: z.string().trim().max(2000).nullable().optional(),
  known_issues: z.string().trim().max(2000).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional()
});

const updatePresetSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    active_status: z.boolean().optional(),
    validation_status: validationStatusSchema.optional(),
    owner_user_id: z.string().uuid().nullable().optional(),
    job_types: z.array(jobTypeSchema).optional(),
    glasses_handling: z.string().trim().max(2000).nullable().optional(),
    known_issues: z.string().trim().max(2000).nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required.");

const createVersionSchema = z.object({
  version_label: z.string().trim().min(1).max(120),
  active_status: z.boolean().optional(),
  validation_status: validationStatusSchema.optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional()
});

const updateVersionSchema = z
  .object({
    version_label: z.string().trim().min(1).max(120).optional(),
    active_status: z.boolean().optional(),
    validation_status: validationStatusSchema.optional(),
    owner_user_id: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required.");

const createBackgroundPackSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).nullable().optional(),
  active_status: z.boolean().optional(),
  validation_status: validationStatusSchema.optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  job_types: z.array(jobTypeSchema).optional(),
  notes: z.string().trim().max(4000).nullable().optional()
});

const updateBackgroundPackSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    active_status: z.boolean().optional(),
    validation_status: validationStatusSchema.optional(),
    owner_user_id: z.string().uuid().nullable().optional(),
    job_types: z.array(jobTypeSchema).optional(),
    notes: z.string().trim().max(4000).nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required.");

const createVariantSchema = z.object({
  name: z.string().trim().min(1).max(160),
  active_status: z.boolean().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  storage_key: z.string().trim().max(500).nullable().optional(),
  file_url: z.string().trim().max(2000).nullable().optional()
});

const updateVariantSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    active_status: z.boolean().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    storage_key: z.string().trim().max(500).nullable().optional(),
    file_url: z.string().trim().max(2000).nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required.");

const createLicenseSchema = z.object({
  tool_name: z.string().trim().min(1).max(160),
  license_type: licenseTypeSchema,
  seat_count: z.number().int().min(0).nullable().optional(),
  status: licenseStatusSchema.optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  renewal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  restrictions: z.string().trim().max(4000).nullable().optional()
});

const updateLicenseSchema = z
  .object({
    tool_name: z.string().trim().min(1).max(160).optional(),
    license_type: licenseTypeSchema.optional(),
    seat_count: z.number().int().min(0).nullable().optional(),
    status: licenseStatusSchema.optional(),
    owner_user_id: z.string().uuid().nullable().optional(),
    renewal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    restrictions: z.string().trim().max(4000).nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required.");

router.get(
  "/workspace",
  requireAuth,
  requireOperatingSystemModuleView("production"),
  requireAction("schedule.read"),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => loadProductionAssetWorkspace(client, auth));
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/presets",
  requireAuth,
  requireOperatingSystemModuleManage("production"),
  requireAction("schedule.manage"),
  validateBody(createPresetSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createProductionPreset(client, auth, {
          name: req.body.name,
          description: req.body.description ?? null,
          activeStatus: req.body.active_status,
          validationStatus: req.body.validation_status,
          ownerUserId: req.body.owner_user_id ?? null,
          jobTypes: req.body.job_types ?? [],
          glassesHandling: req.body.glasses_handling ?? null,
          knownIssues: req.body.known_issues ?? null,
          notes: req.body.notes ?? null
        })
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/presets/:id",
  requireAuth,
  requireOperatingSystemModuleManage("production"),
  requireAction("schedule.manage"),
  validateBody(updatePresetSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateProductionPreset(client, auth, String(req.params.id), {
          name: req.body.name,
          description: Object.prototype.hasOwnProperty.call(req.body, "description") ? req.body.description : undefined,
          activeStatus: req.body.active_status,
          validationStatus: req.body.validation_status,
          ownerUserId: Object.prototype.hasOwnProperty.call(req.body, "owner_user_id") ? req.body.owner_user_id : undefined,
          jobTypes: req.body.job_types,
          glassesHandling: Object.prototype.hasOwnProperty.call(req.body, "glasses_handling") ? req.body.glasses_handling : undefined,
          knownIssues: Object.prototype.hasOwnProperty.call(req.body, "known_issues") ? req.body.known_issues : undefined,
          notes: Object.prototype.hasOwnProperty.call(req.body, "notes") ? req.body.notes : undefined
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/presets/:id/versions",
  requireAuth,
  requireOperatingSystemModuleManage("production"),
  requireAction("schedule.manage"),
  validateBody(createVersionSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createPresetVersion(client, auth, String(req.params.id), {
          versionLabel: req.body.version_label,
          activeStatus: req.body.active_status,
          validationStatus: req.body.validation_status,
          ownerUserId: req.body.owner_user_id ?? null,
          notes: req.body.notes ?? null
        })
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/preset-versions/:id",
  requireAuth,
  requireOperatingSystemModuleManage("production"),
  requireAction("schedule.manage"),
  validateBody(updateVersionSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updatePresetVersion(client, auth, String(req.params.id), {
          versionLabel: req.body.version_label,
          activeStatus: req.body.active_status,
          validationStatus: req.body.validation_status,
          ownerUserId: Object.prototype.hasOwnProperty.call(req.body, "owner_user_id") ? req.body.owner_user_id : undefined,
          notes: Object.prototype.hasOwnProperty.call(req.body, "notes") ? req.body.notes : undefined
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/background-packs",
  requireAuth,
  requireOperatingSystemModuleManage("production"),
  requireAction("schedule.manage"),
  validateBody(createBackgroundPackSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createBackgroundPack(client, auth, {
          name: req.body.name,
          description: req.body.description ?? null,
          activeStatus: req.body.active_status,
          validationStatus: req.body.validation_status,
          ownerUserId: req.body.owner_user_id ?? null,
          jobTypes: req.body.job_types ?? [],
          notes: req.body.notes ?? null
        })
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/background-packs/:id",
  requireAuth,
  requireOperatingSystemModuleManage("production"),
  requireAction("schedule.manage"),
  validateBody(updateBackgroundPackSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateBackgroundPack(client, auth, String(req.params.id), {
          name: req.body.name,
          description: Object.prototype.hasOwnProperty.call(req.body, "description") ? req.body.description : undefined,
          activeStatus: req.body.active_status,
          validationStatus: req.body.validation_status,
          ownerUserId: Object.prototype.hasOwnProperty.call(req.body, "owner_user_id") ? req.body.owner_user_id : undefined,
          jobTypes: req.body.job_types,
          notes: Object.prototype.hasOwnProperty.call(req.body, "notes") ? req.body.notes : undefined
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/background-packs/:id/variants",
  requireAuth,
  requireOperatingSystemModuleManage("production"),
  requireAction("schedule.manage"),
  validateBody(createVariantSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createBackgroundVariant(client, auth, String(req.params.id), {
          name: req.body.name,
          activeStatus: req.body.active_status,
          notes: req.body.notes ?? null,
          storageKey: req.body.storage_key ?? null,
          fileUrl: req.body.file_url ?? null
        })
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/background-variants/:id",
  requireAuth,
  requireOperatingSystemModuleManage("production"),
  requireAction("schedule.manage"),
  validateBody(updateVariantSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateBackgroundVariant(client, auth, String(req.params.id), {
          name: req.body.name,
          activeStatus: req.body.active_status,
          notes: Object.prototype.hasOwnProperty.call(req.body, "notes") ? req.body.notes : undefined,
          storageKey: Object.prototype.hasOwnProperty.call(req.body, "storage_key") ? req.body.storage_key : undefined,
          fileUrl: Object.prototype.hasOwnProperty.call(req.body, "file_url") ? req.body.file_url : undefined
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/licenses",
  requireAuth,
  requireOperatingSystemModuleManage("production"),
  requireAction("schedule.manage"),
  validateBody(createLicenseSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createToolLicense(client, auth, {
          toolName: req.body.tool_name,
          licenseType: req.body.license_type,
          seatCount: req.body.seat_count ?? null,
          status: req.body.status,
          ownerUserId: req.body.owner_user_id ?? null,
          renewalDate: req.body.renewal_date ?? null,
          notes: req.body.notes ?? null,
          restrictions: req.body.restrictions ?? null
        })
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/licenses/:id",
  requireAuth,
  requireOperatingSystemModuleManage("production"),
  requireAction("schedule.manage"),
  validateBody(updateLicenseSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateToolLicense(client, auth, String(req.params.id), {
          toolName: req.body.tool_name,
          licenseType: req.body.license_type,
          seatCount: Object.prototype.hasOwnProperty.call(req.body, "seat_count") ? req.body.seat_count : undefined,
          status: req.body.status,
          ownerUserId: Object.prototype.hasOwnProperty.call(req.body, "owner_user_id") ? req.body.owner_user_id : undefined,
          renewalDate: Object.prototype.hasOwnProperty.call(req.body, "renewal_date") ? req.body.renewal_date : undefined,
          notes: Object.prototype.hasOwnProperty.call(req.body, "notes") ? req.body.notes : undefined,
          restrictions: Object.prototype.hasOwnProperty.call(req.body, "restrictions") ? req.body.restrictions : undefined
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
