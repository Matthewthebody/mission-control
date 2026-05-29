import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { hasAuthorityTier, hasPermissionCode } from "../authz/authority.js";
import { withClientTransaction } from "../db/tx.js";
import { featureFlags } from "../featureFlags.js";
import { requireAuth } from "../middleware/auth.js";
import { requireFeatureFlag } from "../middleware/featureFlag.js";
import { validateBody } from "../middleware/validate.js";
import type { AuthenticatedRequest } from "../types/http.js";
import {
  ADMIN_SETTING_SCOPE_TYPES,
  approveAdminSettingChange,
  createAdminSettingChange,
  getAdminSettingsWorkspace,
  type AdminSettingPreviewInput,
  previewAdminSettingChange,
  rejectAdminSettingChange
} from "../services/adminSettings.js";

const router = Router();
router.use(requireFeatureFlag(featureFlags.coreAdminConfiguration, { message: "Admin configuration is currently disabled." }));

const scopeTypeEnum = z.enum(ADMIN_SETTING_SCOPE_TYPES);
const previewSchema = z.object({
  setting_key: z.string().min(2),
  scope_type: scopeTypeEnum,
  scope_id: z.string().trim().max(120).nullable().optional(),
  scope_label: z.string().trim().max(160).nullable().optional(),
  value: z.any()
});

const changeSchema = previewSchema.extend({
  effective_at: z.string().datetime().nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
  reason: z.string().trim().min(4).max(500)
});

const decisionSchema = z.object({
  note: z.string().trim().max(500).nullable().optional()
});

router.use(requireAuth, requireAdminSettingsReadAccess);

router.get("/overview", async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => getAdminSettingsWorkspace(client, auth));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/preview", requireAdminSettingsManageAccess, validateBody(previewSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const input: AdminSettingPreviewInput = {
      setting_key: req.body.setting_key,
      scope_type: req.body.scope_type,
      scope_id: req.body.scope_id ?? null,
      scope_label: req.body.scope_label ?? null,
      value: req.body.value
    };
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      previewAdminSettingChange(client, auth, input)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/values", requireAdminSettingsManageAccess, validateBody(changeSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createAdminSettingChange(client, auth, {
        setting_key: req.body.setting_key,
        scope_type: req.body.scope_type,
        scope_id: req.body.scope_id ?? null,
        scope_label: req.body.scope_label ?? null,
        value: req.body.value,
        effective_at: req.body.effective_at ?? null,
        expires_at: req.body.expires_at ?? null,
        reason: req.body.reason
      })
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/approve", requireAdminSettingsApproveAccess, validateBody(decisionSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      approveAdminSettingChange(client, auth, String(req.params.id), req.body.note ?? null)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/reject", requireAdminSettingsApproveAccess, validateBody(decisionSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      rejectAdminSettingChange(client, auth, String(req.params.id), req.body.note ?? null)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;

function requireAdminSettingsReadAccess(req: Request, res: Response, next: NextFunction) {
  const auth = (req as AuthenticatedRequest).auth;
  if (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"]) ||
    hasPermissionCode(auth, "system_settings_permissions.view")
  ) {
    return next();
  }
  return res.status(403).json({ error: "Forbidden" });
}

function requireAdminSettingsManageAccess(req: Request, res: Response, next: NextFunction) {
  const auth = (req as AuthenticatedRequest).auth;
  if (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    hasPermissionCode(auth, "system_settings_permissions.edit") ||
    hasPermissionCode(auth, "system_settings_permissions.override")
  ) {
    return next();
  }
  return res.status(403).json({ error: "Forbidden" });
}

function requireAdminSettingsApproveAccess(req: Request, res: Response, next: NextFunction) {
  const auth = (req as AuthenticatedRequest).auth;
  if (
    hasAuthorityTier(auth, ["super_admin", "leadership"]) ||
    hasPermissionCode(auth, "system_settings_permissions.approve") ||
    hasPermissionCode(auth, "system_settings_permissions.override")
  ) {
    return next();
  }
  return res.status(403).json({ error: "Forbidden" });
}
