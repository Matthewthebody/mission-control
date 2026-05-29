import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { WORK_DEPARTMENT_TYPES } from "../domain/jobTruth/index.js";
import { PROJECT_WORKFLOW_STEP_STATUSES } from "../domain/projectTracking/index.js";
import { withClientTransaction, withSystemTransaction } from "../db/tx.js";
import { featureFlags } from "../featureFlags.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { hasOperationalPermission } from "../services/policy/operationalAuthorization.js";
import type { AuthenticatedRequest } from "../types/http.js";
import type { AuthorityTier } from "../types/auth.js";
import {
  addWorkflowTemplateBuilderMilestone,
  addWorkflowTemplateBuilderStep,
  archiveWorkflowTemplateBuilderVersion,
  acceptWorkflowHandoff,
  claimWorkflowHandoff,
  createProjectWorkflowTemplate,
  createWorkflowTemplateBuilderDraft,
  instantiateProjectWorkflow,
  listProjectWorkflowCommandCenter,
  listProjectWorkflowProductionQueue,
  listProjectWorkflowTemplates,
  listWorkflowAssignableUsers,
  listWorkflowTemplateBuilderTemplates,
  loadProjectWorkflowInstance,
  loadWorkflowTemplateBuilderDetail,
  markWorkflowHandoffProductionComplete,
  markWorkflowHandoffWaiting,
  moveWorkflowTemplateBuilderStep,
  publishWorkflowTemplateBuilderVersion,
  removeWorkflowTemplateBuilderStep,
  returnWorkflowHandoffToSchools,
  sendWorkflowToProduction,
  sendWorkflowStepBackward,
  transitionWorkflowStep,
  updateWorkflowTemplateBuilderStep
} from "../services/projectTracking/workflowEngine.js";
import { scanProjectTrackingSlaAlerts } from "../services/projectTracking/slaMonitor.js";

const router = Router();
const nullableString = (max: number) => z.string().trim().max(max).nullable().optional();
const nullableUuid = z.string().uuid().nullable().optional();

function requireWorkflowPermission(permission: string, authorityTiers: AuthorityTier[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = (req as AuthenticatedRequest).auth;
    if (!auth) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (hasOperationalPermission(auth, permission) || authorityTiers.includes(auth.authorityTier)) {
      return next();
    }
    return res.status(403).json({ error: "Forbidden", permission });
  };
}

function requireWorkflowTemplateBuilderFlag(req: Request, res: Response, next: NextFunction) {
  if (!featureFlags.workflowTemplateBuilderV1) {
    return res.status(404).json({ error: "Workflow Template Builder is disabled in this environment." });
  }
  return next();
}

const templateStepSchema = z
  .object({
    step_key: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(240),
    description: nullableString(4000),
    department: z.enum(WORK_DEPARTMENT_TYPES),
    role_key: nullableString(160),
    assigned_user_id: nullableUuid,
    required: z.boolean().nullable().optional(),
    skippable: z.boolean().nullable().optional(),
    blocking: z.boolean().nullable().optional(),
    expected_duration_minutes: z.number().int().positive().max(525600).nullable().optional(),
    depends_on_step_keys: z.array(z.string().trim().min(1).max(120)).max(50).nullable().optional()
  })
  .strict();

const templateMilestoneSchema = z
  .object({
    milestone_key: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(240),
    description: nullableString(4000),
    steps: z.array(templateStepSchema).min(1).max(100)
  })
  .strict();

const templateCreateSchema = z
  .object({
    template_key: z.string().trim().min(1).max(160),
    name: z.string().trim().min(1).max(240),
    description: nullableString(4000),
    departments_involved: z.array(z.enum(WORK_DEPARTMENT_TYPES)).min(1).max(12),
    milestones: z.array(templateMilestoneSchema).min(1).max(50)
  })
  .strict();

const workflowTemplateBuilderOwnerTypes = [
  "department",
  "role",
  "user",
  "account_owner",
  "job_owner",
  "qa_reviewer",
  "production_lead"
] as const;

const workflowTemplateBuilderDependencyModes = [
  "can_start_immediately",
  "waits_for_prior_step",
  "waits_for_dependencies",
  "waits_for_milestone_completion"
] as const;

const workflowTemplateBuilderDraftSchema = z
  .object({
    template_key: z.string().trim().min(1).max(160),
    name: z.string().trim().min(1).max(240),
    description: nullableString(4000),
    job_type: nullableString(120),
    category: nullableString(120),
    departments_involved: z.array(z.enum(WORK_DEPARTMENT_TYPES)).min(1).max(12)
  })
  .strict();

const workflowTemplateBuilderMilestoneSchema = z
  .object({
    milestone_key: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(240),
    description: nullableString(4000),
    sort_order: z.number().int().min(0).max(100000).nullable().optional(),
    default_owner_type: z.enum(workflowTemplateBuilderOwnerTypes).nullable().optional(),
    default_owner_value: nullableString(200)
  })
  .strict();

const workflowTemplateBuilderStepSchema = z
  .object({
    milestone_template_id: z.string().uuid(),
    step_key: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(240),
    description: nullableString(4000),
    sort_order: z.number().int().min(0).max(100000).nullable().optional(),
    department: z.enum(WORK_DEPARTMENT_TYPES),
    role_key: nullableString(160),
    assigned_user_id: nullableUuid,
    owner_type: z.enum(workflowTemplateBuilderOwnerTypes),
    owner_value: nullableString(200),
    required: z.boolean().nullable().optional(),
    skippable: z.boolean().nullable().optional(),
    blocking: z.boolean().nullable().optional(),
    expected_duration_minutes: z.number().int().positive().max(525600).nullable().optional(),
    due_offset_minutes: z.number().int().min(0).max(525600).nullable().optional(),
    dependency_mode: z.enum(workflowTemplateBuilderDependencyModes).nullable().optional(),
    blocked_behavior: nullableString(1000),
    checklist_template_id: nullableUuid,
    depends_on_step_keys: z.array(z.string().trim().min(1).max(120)).max(50).nullable().optional()
  })
  .strict();

const workflowTemplateBuilderMoveStepSchema = z
  .object({
    direction: z.enum(["up", "down"])
  })
  .strict();

const instanceCreateSchema = z
  .object({
    job_id: z.string().uuid(),
    template_version_id: nullableUuid,
    template_key: nullableString(160),
    idempotency_key: nullableString(200)
  })
  .strict()
  .refine((value) => Boolean(value.template_version_id || value.template_key), {
    message: "template_version_id or template_key is required.",
    path: ["template_key"]
  });

const transitionSchema = z
  .object({
    status: z.enum(PROJECT_WORKFLOW_STEP_STATUSES),
    reason: nullableString(2000),
    notes: nullableString(4000),
    assigned_user_id: nullableUuid,
    assigned_queue: z.enum(WORK_DEPARTMENT_TYPES).nullable().optional(),
    expected_duration_minutes: z.number().int().positive().max(525600).nullable().optional(),
    last_seen_updated_at: nullableString(80),
    idempotency_key: nullableString(200)
  })
  .strict();

const sendBackSchema = z
  .object({
    target_step_id: z.string().uuid(),
    reason: z.string().trim().min(1).max(2000),
    assigned_user_id: z.string().uuid(),
    expected_duration_minutes: z.number().int().positive().max(525600),
    expectations: nullableString(4000)
  })
  .strict();

const commandCenterQuerySchema = z
  .object({
    view: z.enum(["personal", "department", "global"]).optional(),
    department: z.enum(WORK_DEPARTMENT_TYPES).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional()
  })
  .strict();

const productionQueueQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional()
  })
  .strict();

const waitingOnPartySchema = z.enum(["school", "kp", "production", "graphics", "customer_service", "vendor", "family", "other", "none", "unknown"]);

const sendToProductionSchema = z
  .object({
    step_id: z.string().uuid(),
    notes: nullableString(4000),
    readiness: z
      .object({
        files_confirmed: z.boolean(),
        data_confirmed: z.boolean(),
        job_type_confirmed: z.boolean(),
        due_date_confirmed: z.boolean()
      })
      .strict()
  })
  .strict();

const claimHandoffSchema = z
  .object({
    assigned_queue: z.enum(WORK_DEPARTMENT_TYPES).nullable().optional(),
    assigned_user_id: nullableUuid,
    notes: nullableString(4000)
  })
  .strict();

const markWaitingSchema = z
  .object({
    waiting_on_party: waitingOnPartySchema,
    waiting_detail: z.string().trim().min(1).max(4000)
  })
  .strict();

const returnToSchoolsSchema = z
  .object({
    return_reason: z.string().trim().min(1).max(4000),
    issue_flag: z.boolean().nullable().optional()
  })
  .strict();

const internalSlaSweepSchema = z
  .object({
    tenant_id: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(1000).optional()
  })
  .strict();

function assertInternalWorkflowSweepAccess(secret: string | undefined) {
  if (secret !== config.INTERNAL_SOCKET_SECRET) {
    throw new Error("Forbidden");
  }
}

router.get(
  "/template-builder/templates",
  requireAuth,
  requireWorkflowTemplateBuilderFlag,
  requireWorkflowPermission("workflow.template.manage", ["super_admin", "leadership", "director_admin"]),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listWorkflowTemplateBuilderTemplates(client, auth)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/assignable-users",
  requireAuth,
  requireWorkflowPermission("workflow.step.override", ["super_admin", "leadership", "director_admin", "supervisor"]),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listWorkflowAssignableUsers(client, auth)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/template-builder/templates",
  requireAuth,
  requireWorkflowTemplateBuilderFlag,
  requireWorkflowPermission("workflow.template.manage", ["super_admin", "leadership", "director_admin"]),
  validateBody(workflowTemplateBuilderDraftSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createWorkflowTemplateBuilderDraft(client, auth, req.body)
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/template-builder/templates/:templateId",
  requireAuth,
  requireWorkflowTemplateBuilderFlag,
  requireWorkflowPermission("workflow.template.manage", ["super_admin", "leadership", "director_admin"]),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        loadWorkflowTemplateBuilderDetail(client, auth, { template_id: String(req.params.templateId) })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/template-builder/versions/:templateVersionId/milestones",
  requireAuth,
  requireWorkflowTemplateBuilderFlag,
  requireWorkflowPermission("workflow.template.manage", ["super_admin", "leadership", "director_admin"]),
  validateBody(workflowTemplateBuilderMilestoneSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        addWorkflowTemplateBuilderMilestone(client, auth, String(req.params.templateVersionId), req.body)
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/template-builder/versions/:templateVersionId/steps",
  requireAuth,
  requireWorkflowTemplateBuilderFlag,
  requireWorkflowPermission("workflow.template.manage", ["super_admin", "leadership", "director_admin"]),
  validateBody(workflowTemplateBuilderStepSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        addWorkflowTemplateBuilderStep(client, auth, String(req.params.templateVersionId), req.body)
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/template-builder/versions/:templateVersionId/preview",
  requireAuth,
  requireWorkflowTemplateBuilderFlag,
  requireWorkflowPermission("workflow.template.manage", ["super_admin", "leadership", "director_admin"]),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        loadWorkflowTemplateBuilderDetail(client, auth, { template_version_id: String(req.params.templateVersionId) })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/template-builder/versions/:templateVersionId/publish",
  requireAuth,
  requireWorkflowTemplateBuilderFlag,
  requireWorkflowPermission("workflow.template.manage", ["super_admin", "leadership", "director_admin"]),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        publishWorkflowTemplateBuilderVersion(client, auth, String(req.params.templateVersionId))
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/template-builder/versions/:templateVersionId/archive",
  requireAuth,
  requireWorkflowTemplateBuilderFlag,
  requireWorkflowPermission("workflow.template.manage", ["super_admin", "leadership", "director_admin"]),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        archiveWorkflowTemplateBuilderVersion(client, auth, String(req.params.templateVersionId))
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/templates",
  requireAuth,
  requireWorkflowPermission("workflow.read", ["super_admin", "leadership", "director_admin", "supervisor"]),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => listProjectWorkflowTemplates(client, auth));
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/templates",
  requireAuth,
  requireWorkflowPermission("workflow.template.manage", ["super_admin", "leadership", "director_admin"]),
  validateBody(templateCreateSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createProjectWorkflowTemplate(client, auth, req.body)
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/instances",
  requireAuth,
  requireWorkflowPermission("workflow.instance.manage", ["super_admin", "leadership", "director_admin", "supervisor"]),
  validateBody(instanceCreateSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        instantiateProjectWorkflow(client, auth, req.body)
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/instances/:workflowRunId",
  requireAuth,
  requireWorkflowPermission("workflow.read", ["super_admin", "leadership", "director_admin", "supervisor"]),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        loadProjectWorkflowInstance(client, auth, String(req.params.workflowRunId))
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/command-center",
  requireAuth,
  requireWorkflowPermission("workflow.read", ["super_admin", "leadership", "director_admin", "supervisor"]),
  validateQuery(commandCenterQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listProjectWorkflowCommandCenter(client, auth, req.query)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/template-builder/versions/:templateVersionId/steps/:stepId",
  requireAuth,
  requireWorkflowTemplateBuilderFlag,
  requireWorkflowPermission("workflow.template.manage", ["super_admin", "leadership", "director_admin"]),
  validateBody(workflowTemplateBuilderStepSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateWorkflowTemplateBuilderStep(client, auth, String(req.params.templateVersionId), String(req.params.stepId), req.body)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/template-builder/versions/:templateVersionId/steps/:stepId/move",
  requireAuth,
  requireWorkflowTemplateBuilderFlag,
  requireWorkflowPermission("workflow.template.manage", ["super_admin", "leadership", "director_admin"]),
  validateBody(workflowTemplateBuilderMoveStepSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        moveWorkflowTemplateBuilderStep(
          client,
          auth,
          String(req.params.templateVersionId),
          String(req.params.stepId),
          req.body.direction
        )
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.delete(
  "/template-builder/versions/:templateVersionId/steps/:stepId",
  requireAuth,
  requireWorkflowTemplateBuilderFlag,
  requireWorkflowPermission("workflow.template.manage", ["super_admin", "leadership", "director_admin"]),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        removeWorkflowTemplateBuilderStep(client, auth, String(req.params.templateVersionId), String(req.params.stepId))
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/production-queue",
  requireAuth,
  requireWorkflowPermission("workflow.read", ["super_admin", "leadership", "director_admin", "supervisor", "standard_employee"]),
  validateQuery(productionQueueQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listProjectWorkflowProductionQueue(client, auth, req.query)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/instances/:workflowRunId/send-to-production",
  requireAuth,
  requireWorkflowPermission("workflow.step.execute", ["super_admin", "leadership", "director_admin", "supervisor", "standard_employee"]),
  validateBody(sendToProductionSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        sendWorkflowToProduction(client, auth, String(req.params.workflowRunId), req.body)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/handoffs/:handoffId/accept",
  requireAuth,
  requireWorkflowPermission("workflow.step.execute", ["super_admin", "leadership", "director_admin", "supervisor", "standard_employee"]),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        acceptWorkflowHandoff(client, auth, String(req.params.handoffId))
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/handoffs/:handoffId/claim",
  requireAuth,
  requireWorkflowPermission("workflow.step.execute", ["super_admin", "leadership", "director_admin", "supervisor", "standard_employee"]),
  validateBody(claimHandoffSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        claimWorkflowHandoff(client, auth, String(req.params.handoffId), req.body)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/handoffs/:handoffId/mark-waiting",
  requireAuth,
  requireWorkflowPermission("workflow.step.execute", ["super_admin", "leadership", "director_admin", "supervisor", "standard_employee"]),
  validateBody(markWaitingSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        markWorkflowHandoffWaiting(client, auth, String(req.params.handoffId), req.body)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/handoffs/:handoffId/production-complete",
  requireAuth,
  requireWorkflowPermission("workflow.step.execute", ["super_admin", "leadership", "director_admin", "supervisor", "standard_employee"]),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        markWorkflowHandoffProductionComplete(client, auth, String(req.params.handoffId))
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/handoffs/:handoffId/return-to-schools",
  requireAuth,
  requireWorkflowPermission("workflow.step.execute", ["super_admin", "leadership", "director_admin", "supervisor", "standard_employee"]),
  validateBody(returnToSchoolsSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        returnWorkflowHandoffToSchools(client, auth, String(req.params.handoffId), req.body)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/steps/:stepId/transition",
  requireAuth,
  requireWorkflowPermission("workflow.step.execute", ["super_admin", "leadership", "director_admin", "supervisor", "standard_employee"]),
  validateBody(transitionSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        transitionWorkflowStep(client, auth, String(req.params.stepId), req.body)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/steps/:stepId/send-back",
  requireAuth,
  requireWorkflowPermission("workflow.step.override", ["super_admin", "leadership", "director_admin", "supervisor"]),
  validateBody(sendBackSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        sendWorkflowStepBackward(client, auth, String(req.params.stepId), req.body)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/internal/sla/sweep", validateBody(internalSlaSweepSchema), async (req, res, next) => {
  try {
    assertInternalWorkflowSweepAccess(req.header("X-PMC-Internal-Secret") ?? undefined);
    const payload = await withSystemTransaction((client) =>
      scanProjectTrackingSlaAlerts(client, { tenantId: req.body.tenant_id, limit: req.body.limit })
    );
    return res.json(payload);
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next(error);
  }
});

export default router;
