import { Router } from "express";
import { z } from "zod";
import { hasAuthorityTier } from "../authz/authority.js";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import {
  CHECKLIST_ASSIGNMENT_ROLE_KEYS,
  CHECKLIST_BLOCKING_LEVELS,
  CHECKLIST_COMMENT_VISIBILITIES,
  CHECKLIST_CONDITION_EFFECTS,
  CHECKLIST_CONDITION_LOGICS,
  CHECKLIST_ITEM_TYPES,
  CHECKLIST_SCOPE_TYPES,
  CHECKLIST_TRIGGER_TYPES,
  WORKFLOW_BLOCK_RESOURCE_TYPES
} from "../domain/jobTruth/index.js";
import { pool } from "../db/pool.js";
import { withClientTransaction } from "../db/tx.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { canSharedPolicy } from "../services/policy/index.js";
import {
  addChecklistAttachment,
  addChecklistComment,
  approveChecklistInstance,
  createChecklistInstanceManual,
  getChecklistInstanceDetail,
  getChecklistTemplateDetail,
  listChecklistInstancesForScope,
  listChecklistTemplates,
  publishChecklistTemplateVersion,
  rejectChecklistInstance,
  saveChecklistResponses,
  saveChecklistTemplateDraft,
  submitChecklistInstance,
  sweepChecklistReminders,
  type ChecklistReminderSweepResult,
  type ChecklistTemplateVersionInput,
  type CreateChecklistInstanceInput,
  type ChecklistAttachmentInput,
  type ChecklistCommentInput,
  type ChecklistResponseInput,
  type ChecklistTransitionValidationInput,
  validateChecklistTargetTransition,
  waiveChecklistInstance
} from "../services/jobTruth/checklistService.js";
import { seedChecklistDefaults } from "../services/jobTruth/checklistSeedService.js";
import type { AuthenticatedRequest } from "../types/http.js";

const router = Router();

const nullableString = (max: number) => z.string().trim().max(max).nullable().optional();
const nullableUuid = z.string().uuid().nullable().optional();

const conditionSchema = z
  .object({
    condition_group_key: nullableString(120),
    logic_operator: z.enum(CHECKLIST_CONDITION_LOGICS).optional(),
    source_item_key: z.string().trim().min(1).max(120),
    comparison_operator: nullableString(64),
    expected_value_json: z.unknown().optional(),
    effect: z.enum(CHECKLIST_CONDITION_EFFECTS),
    sort_order: z.number().int().nullable().optional()
  })
  .strict();

const itemSchema = z
  .object({
    item_key: nullableString(120),
    label: z.string().trim().min(1).max(240),
    help_text: nullableString(2000),
    item_type: z.enum(CHECKLIST_ITEM_TYPES),
    required: z.boolean().optional(),
    proof_required: z.boolean().optional(),
    validation_json: z.record(z.string(), z.unknown()).nullable().optional(),
    options_json: z.array(z.unknown()).nullable().optional(),
    sort_order: z.number().int().nullable().optional(),
    conditions: z.array(conditionSchema).nullable().optional()
  })
  .strict();

const sectionSchema = z
  .object({
    section_key: nullableString(120),
    title: z.string().trim().min(1).max(240),
    description: nullableString(2000),
    sort_order: z.number().int().nullable().optional(),
    items: z.array(itemSchema).default([])
  })
  .strict();

const templateDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(240),
    description: nullableString(2000),
    code: z.string().trim().min(1).max(120),
    department_type: z.enum(["schools", "sports", "corporate", "headshots", "other"]).nullable().optional(),
    scope_type: z.enum(CHECKLIST_SCOPE_TYPES),
    trigger_type: z.enum(CHECKLIST_TRIGGER_TYPES).optional(),
    due_rule_json: z.record(z.string(), z.unknown()).nullable().optional(),
    approval_required: z.boolean().optional(),
    blocking_level: z.enum(CHECKLIST_BLOCKING_LEVELS).optional(),
    assignment_defaults_json: z
      .object({
        owner_assignment_role: z.enum(CHECKLIST_ASSIGNMENT_ROLE_KEYS).nullable().optional(),
        reviewer_assignment_role: z.enum(CHECKLIST_ASSIGNMENT_ROLE_KEYS).nullable().optional(),
        approver_assignment_role: z.enum(CHECKLIST_ASSIGNMENT_ROLE_KEYS).nullable().optional()
      })
      .strict()
      .nullable()
      .optional(),
    summary: nullableString(2000),
    sections: z.array(sectionSchema).default([])
  })
  .strict();

const templateQuerySchema = z
  .object({
    department_type: z.enum(["schools", "sports", "corporate", "headshots", "other", "all"]).optional(),
    scope_type: z.enum(CHECKLIST_SCOPE_TYPES).optional(),
    include_archived: z.enum(["yes", "no"]).optional()
  })
  .strict();

const createInstanceSchema = z
  .object({
    template_id: nullableUuid,
    template_code: nullableString(120),
    template_version_id: nullableUuid,
    scope_type: z.enum(CHECKLIST_SCOPE_TYPES),
    scope_id: z.string().uuid(),
    title: nullableString(240),
    owner_user_id: nullableUuid,
    reviewer_user_id: nullableUuid,
    approver_user_id: nullableUuid,
    due_at: nullableString(64),
    created_from_trigger_key: nullableString(160),
    trigger_type: z.enum(CHECKLIST_TRIGGER_TYPES).optional(),
    source_metadata_json: z.record(z.string(), z.unknown()).nullable().optional()
  })
  .strict();

const listInstancesQuerySchema = z
  .object({
    scope_type: z.enum(CHECKLIST_SCOPE_TYPES),
    scope_id: z.string().uuid()
  })
  .strict();

const responseSaveSchema = z
  .object({
    responses: z
      .array(
        z
          .object({
            checklist_item_id: z.string().uuid(),
            response_json: z.unknown()
          })
          .strict()
      )
      .min(1)
  })
  .strict();

const attachmentSchema = z
  .object({
    checklist_response_id: nullableUuid,
    attachment_type: z.string().trim().min(1).max(120),
    file_name: z.string().trim().min(1).max(240),
    content_type: z.string().trim().min(1).max(160),
    storage_key: z.string().trim().min(1).max(400),
    object_url: z.string().trim().url()
  })
  .strict();

const commentSchema = z
  .object({
    checklist_response_id: nullableUuid,
    checklist_item_id: nullableUuid,
    body: z.string().trim().min(1).max(4000),
    visibility: z.enum(CHECKLIST_COMMENT_VISIBILITIES).optional()
  })
  .strict();

const approveDecisionSchema = z
  .object({
    note: z.string().trim().max(4000).optional()
  })
  .strict();

const requiredDecisionSchema = z
  .object({
    note: z.string().trim().min(1).max(4000)
  })
  .strict();

const transitionValidationSchema = z
  .object({
    resource_type: z.enum(WORKFLOW_BLOCK_RESOURCE_TYPES),
    from_stage: nullableString(120),
    to_stage: z.string().trim().min(1).max(120),
    department_type: z.enum(["schools", "sports", "corporate", "headshots", "other"]).nullable().optional(),
    job_id: nullableUuid,
    shoot_id: nullableUuid,
    production_item_id: nullableUuid,
    location_id: nullableUuid,
    allow_soft_override: z.boolean().optional(),
    override_reason: nullableString(2000)
  })
  .strict();

const reminderSweepSchema = z
  .object({
    limit: z.number().int().min(1).max(500).optional()
  })
  .strict();

const internalReminderSweepSchema = z
  .object({
    limit: z.number().int().min(1).max(500).optional(),
    tenant_id: z.string().uuid().optional()
  })
  .strict();

function assertChecklistAdminAccess(auth: AuthenticatedRequest["auth"]) {
  if (
    hasAuthorityTier(auth, ["leadership", "super_admin"]) ||
    canSharedPolicy(auth, "checklist.template.manage") ||
    canSharedPolicy(auth, "settings.update") ||
    canSharedPolicy(auth, "settings.permissions.manage")
  ) {
    return;
  }
  throw new ApiError(403, "Forbidden");
}

function assertInternalChecklistSweepAccess(secret: string | undefined) {
  if (secret !== config.INTERNAL_SOCKET_SECRET) {
    throw new ApiError(403, "Forbidden");
  }
}

router.get("/templates", requireAuth, validateQuery(templateQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const templates = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      listChecklistTemplates(client, auth, {
        department_type: typeof req.query.department_type === "string" ? (req.query.department_type as ChecklistTemplateVersionInput["department_type"] | "all") : null,
        scope_type: typeof req.query.scope_type === "string" ? (req.query.scope_type as CreateChecklistInstanceInput["scope_type"]) : null,
        include_archived: req.query.include_archived === "yes"
      })
    );
    return res.json({ templates });
  } catch (error) {
    return next(error);
  }
});

router.get("/templates/:templateId", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const template = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      getChecklistTemplateDetail(client, auth, String(req.params.templateId))
    );
    return res.json({ template });
  } catch (error) {
    return next(error);
  }
});

router.post("/templates", requireAuth, validateBody(templateDraftSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const template = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      saveChecklistTemplateDraft(client, auth, null, req.body)
    );
    return res.status(201).json({ template });
  } catch (error) {
    return next(error);
  }
});

router.patch("/templates/:templateId", requireAuth, validateBody(templateDraftSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const template = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      saveChecklistTemplateDraft(client, auth, String(req.params.templateId), req.body)
    );
    return res.json({ template });
  } catch (error) {
    return next(error);
  }
});

router.post("/templates/:templateId/versions/:versionId/publish", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const template = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      publishChecklistTemplateVersion(client, auth, String(req.params.templateId), String(req.params.versionId))
    );
    return res.json({ template });
  } catch (error) {
    return next(error);
  }
});

router.post("/templates/seed-defaults", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    assertChecklistAdminAccess(auth);
    const seeded = await withClientTransaction(auth.tenantId, auth.id, async (client) => seedChecklistDefaults(client, auth));
    return res.json({ seeded });
  } catch (error) {
    return next(error);
  }
});

router.get("/instances", requireAuth, validateQuery(listInstancesQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const instances = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      listChecklistInstancesForScope(client, auth, req.query.scope_type as CreateChecklistInstanceInput["scope_type"], String(req.query.scope_id))
    );
    return res.json({ instances });
  } catch (error) {
    return next(error);
  }
});

router.post("/instances", requireAuth, validateBody(createInstanceSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const { created_from_trigger_key: _createdFromTriggerKey, ...manualInput } = req.body;
    const instance = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      createChecklistInstanceManual(client, auth, manualInput)
    );
    return res.status(201).json({ instance });
  } catch (error) {
    return next(error);
  }
});

router.get("/instances/:instanceId", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const instance = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      getChecklistInstanceDetail(client, auth, String(req.params.instanceId))
    );
    return res.json({ instance });
  } catch (error) {
    return next(error);
  }
});

router.post("/instances/:instanceId/responses", requireAuth, validateBody(responseSaveSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const instance = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      saveChecklistResponses(client, auth, String(req.params.instanceId), req.body.responses as ChecklistResponseInput[])
    );
    return res.json({ instance });
  } catch (error) {
    return next(error);
  }
});

router.post("/instances/:instanceId/attachments", requireAuth, validateBody(attachmentSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const instance = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      addChecklistAttachment(client, auth, String(req.params.instanceId), req.body as ChecklistAttachmentInput)
    );
    return res.json({ instance });
  } catch (error) {
    return next(error);
  }
});

router.post("/instances/:instanceId/comments", requireAuth, validateBody(commentSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const instance = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      addChecklistComment(client, auth, String(req.params.instanceId), req.body as ChecklistCommentInput)
    );
    return res.json({ instance });
  } catch (error) {
    return next(error);
  }
});

router.post("/instances/:instanceId/submit", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const instance = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      submitChecklistInstance(client, auth, String(req.params.instanceId))
    );
    return res.json({ instance });
  } catch (error) {
    return next(error);
  }
});

router.post("/instances/:instanceId/approve", requireAuth, validateBody(approveDecisionSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const instance = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      approveChecklistInstance(client, auth, String(req.params.instanceId), req.body.note)
    );
    return res.json({ instance });
  } catch (error) {
    return next(error);
  }
});

router.post("/instances/:instanceId/reject", requireAuth, validateBody(requiredDecisionSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const instance = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      rejectChecklistInstance(client, auth, String(req.params.instanceId), req.body.note)
    );
    return res.json({ instance });
  } catch (error) {
    return next(error);
  }
});

router.post("/instances/:instanceId/waive", requireAuth, validateBody(requiredDecisionSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const instance = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      waiveChecklistInstance(client, auth, String(req.params.instanceId), req.body.note)
    );
    return res.json({ instance });
  } catch (error) {
    return next(error);
  }
});

router.post("/transitions/validate", requireAuth, validateBody(transitionValidationSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const validation = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      validateChecklistTargetTransition(client, auth, req.body as ChecklistTransitionValidationInput)
    );
    return res.json({ validation });
  } catch (error) {
    return next(error);
  }
});

router.post("/reminders/sweep", requireAuth, validateBody(reminderSweepSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    assertChecklistAdminAccess(auth);
    const result = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      sweepChecklistReminders(client, auth, { limit: req.body.limit })
    );
    return res.json({ result });
  } catch (error) {
    return next(error);
  }
});

router.post("/internal/reminders/sweep", validateBody(internalReminderSweepSchema), async (req, res, next) => {
  try {
    assertInternalChecklistSweepAccess(req.header("X-PMC-Internal-Secret") ?? undefined);
    const tenantIds =
      typeof req.body.tenant_id === "string"
        ? [req.body.tenant_id]
        : (
            await pool.query<{ id: string }>(
              `
                SELECT id::text AS id
                FROM tenant
                ORDER BY created_at ASC
              `
            )
          ).rows.map((row) => row.id);

    const results: Array<{ tenant_id: string; result: ChecklistReminderSweepResult }> = [];
    for (const tenantId of tenantIds) {
      const result = await withClientTransaction(tenantId, null, async (client) =>
        sweepChecklistReminders(client, { tenantId, id: null }, { limit: req.body.limit })
      );
      results.push({ tenant_id: tenantId, result });
    }

    return res.json({
      tenant_count: tenantIds.length,
      scanned_instance_count: results.reduce((sum, entry) => sum + entry.result.scanned_instance_count, 0),
      alert_count: results.reduce((sum, entry) => sum + entry.result.alert_count, 0),
      watch_flag_count: results.reduce((sum, entry) => sum + entry.result.watch_flag_count, 0),
      results
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
