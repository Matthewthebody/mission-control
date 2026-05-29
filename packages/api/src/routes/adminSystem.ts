import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { hasAuthorityTier } from "../authz/authority.js";
import { withClientTransaction } from "../db/tx.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireElevatedSession } from "../middleware/security.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { getCommunicationDiagnostics } from "../services/communicationObservability.js";
import type { AuthenticatedRequest } from "../types/http.js";
import {
  executeRepairAction,
  getDiagnosticsWorkspace,
  getEntityTrace,
  listAuditEvents,
  listDiagnosticFindings,
  listExportAuditRecords,
  listImportAuditRecords,
  listPolicyDecisionTraces,
  listRepairActions,
  listSyncHealthRecords,
  listSystemHealthChecks,
  previewRepairAction,
  runDiagnosticRules,
  updateDiagnosticFinding
} from "../services/diagnostics/index.js";
import { getCoreFoundationDiagnostics as getCoreFoundationDiagnosticsPayload } from "../services/coreFoundationObservability.js";
import { getMicrosoft365ClientIntakeDiagnostics } from "../services/microsoft365ClientIntake.js";
import { getMicrosoft365ClientIntakeOperationalControlDiagnostics } from "../services/microsoft365ClientIntakeOperations.js";
import { getMicrosoft365ClientPortalDiagnostics } from "../services/microsoft365ClientPortal.js";
import { getMicrosoft365SmsOptimizationDiagnostics } from "../services/microsoft365SmsOptimization.js";
import { getMicrosoft365GovernanceDiagnostics } from "../services/microsoft365Governance.js";
import { getMicrosoft365MailAutomationDiagnostics } from "../services/microsoft365MailAutomation.js";
import { getMicrosoft365OperatingSystemDiagnostics } from "../services/microsoft365OperatingSystem.js";
import { getMicrosoft365ProvisioningDiagnostics } from "../services/microsoft365Provisioning.js";
import { previewAccessPolicy } from "../services/policy/index.js";

const router = Router();
const diagnosticSeverityEnum = z.enum(["info", "low", "medium", "high", "critical"]);
const diagnosticStatusEnum = z.enum(["open", "acknowledged", "in_review", "resolved", "dismissed"]);
const repairActionEnum = z.enum([
  "job.regenerate_default_production_item",
  "job.recompute_derived_status",
  "diagnostics.rescan_record"
]);
const departmentEnum = z.enum(["schools", "sports", "corporate", "headshots", "other"]);

const findingsQuerySchema = z.object({
  severity: diagnosticSeverityEnum.optional(),
  finding_type: z.string().trim().max(120).optional(),
  rule_key: z.string().trim().max(160).optional(),
  resource_type: z.string().trim().max(120).optional(),
  department_type: departmentEnum.optional(),
  status: diagnosticStatusEnum.optional(),
  owner_user_id: z.string().uuid().optional(),
  repairable: z.enum(["true", "false"]).optional(),
  open_only: z.enum(["true", "false"]).optional(),
  critical_only: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const findingUpdateSchema = z.object({
  status: z.enum(["acknowledged", "resolved", "dismissed"]).nullable().optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  resolution_note: z.string().trim().max(4000).nullable().optional()
});

const auditQuerySchema = z.object({
  actor_user_id: z.string().uuid().optional(),
  event_type: z.string().trim().max(160).optional(),
  resource_type: z.string().trim().max(120).optional(),
  department_type: departmentEnum.optional(),
  result: z.string().trim().max(120).optional(),
  target_user_id: z.string().uuid().optional(),
  request_id: z.string().trim().max(200).optional(),
  date_from: z.string().trim().max(80).optional(),
  date_to: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const diagnosticRunSchema = z.object({
  rule_key: z.string().trim().max(160).nullable().optional(),
  resource_type: z.string().trim().max(120).nullable().optional(),
  resource_id: z.string().trim().max(120).nullable().optional(),
  department_type: departmentEnum.nullable().optional(),
  trigger_type: z.string().trim().max(80).optional()
});

const repairActionSchema = z.object({
  action_key: repairActionEnum,
  resource_type: z.string().trim().min(1).max(120),
  resource_id: z.string().trim().max(120).nullable().optional(),
  reason: z.string().trim().max(2000).nullable().optional(),
  input: z.record(z.string(), z.unknown()).nullable().optional()
});

const previewAccessSchema = z.object({
  target_user_id: z.string().uuid(),
  route_id: z.string().trim().max(120).nullable().optional(),
  resource_type: z.string().trim().max(120).nullable().optional(),
  resource_id: z.string().trim().max(120).nullable().optional(),
  permission_keys: z.array(z.string().trim().min(1).max(160)).optional(),
  context: z
    .object({
      departmentType: z.string().trim().max(40).nullable().optional(),
      organizationId: z.string().uuid().nullable().optional(),
      locationId: z.string().uuid().nullable().optional(),
      ownerUserIds: z.array(z.string().uuid()).optional(),
      assignedUserIds: z.array(z.string().uuid()).optional(),
      targetUserId: z.string().uuid().nullable().optional(),
      customScopeValues: z.array(z.string().trim().max(120)).optional()
    })
    .optional()
});

const policyTraceQuerySchema = z.object({
  actor_user_id: z.string().uuid().optional(),
  permission_key: z.string().trim().max(160).optional(),
  resource_type: z.string().trim().max(120).optional(),
  resource_id: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const auditLimitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional()
});

function requireAdminSystemAccess(req: Request, res: Response, next: NextFunction) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!hasAuthorityTier(auth, ["super_admin", "director_admin"])) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
}

router.use(requireAuth, requireAdminSystemAccess);

router.get("/workspace", requirePermission("system.diagnostics.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const workspace = await withClientTransaction(auth.tenantId, auth.id, (client) => getDiagnosticsWorkspace(client, auth.tenantId));
    return res.json(workspace);
  } catch (error) {
    return next(error);
  }
});

router.get("/foundation", requirePermission("system.diagnostics.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getCoreFoundationDiagnosticsPayload(client, auth)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/communications", requirePermission("system.diagnostics.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => getCommunicationDiagnostics(client, auth));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/microsoft-governance", requirePermission("system.diagnostics.read"), async (_req, res, next) => {
  try {
    return res.json(getMicrosoft365GovernanceDiagnostics());
  } catch (error) {
    return next(error);
  }
});

router.get("/microsoft-client-intake", requirePermission("system.diagnostics.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getMicrosoft365ClientIntakeDiagnostics(client, auth)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/microsoft-client-intake-operations", requirePermission("system.diagnostics.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getMicrosoft365ClientIntakeOperationalControlDiagnostics(client, auth)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/microsoft-client-portal", requirePermission("system.diagnostics.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getMicrosoft365ClientPortalDiagnostics(client, auth)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/microsoft-sms-optimization", requirePermission("system.diagnostics.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getMicrosoft365SmsOptimizationDiagnostics(client, auth)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/microsoft-operating-system", requirePermission("system.diagnostics.read"), async (_req, res, next) => {
  try {
    return res.json(getMicrosoft365OperatingSystemDiagnostics());
  } catch (error) {
    return next(error);
  }
});

router.get("/microsoft-provisioning", requirePermission("system.diagnostics.read"), async (_req, res, next) => {
  try {
    return res.json(getMicrosoft365ProvisioningDiagnostics());
  } catch (error) {
    return next(error);
  }
});

router.get("/microsoft-email-automation", requirePermission("system.diagnostics.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getMicrosoft365MailAutomationDiagnostics(client, auth)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/diagnostics/findings",
  requirePermission("system.diagnostics.read"),
  validateQuery(findingsQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const findings = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listDiagnosticFindings(client, auth.tenantId, {
          severity: req.query.severity ? String(req.query.severity) : null,
          findingType: req.query.finding_type ? String(req.query.finding_type) : null,
          ruleKey: req.query.rule_key ? String(req.query.rule_key) : null,
          resourceType: req.query.resource_type ? String(req.query.resource_type) : null,
          departmentType: req.query.department_type ? String(req.query.department_type) : null,
          status: req.query.status ? String(req.query.status) : null,
          ownerUserId: req.query.owner_user_id ? String(req.query.owner_user_id) : null,
          repairable: req.query.repairable ? String(req.query.repairable) === "true" : null,
          openOnly: String(req.query.open_only) === "true",
          criticalOnly: String(req.query.critical_only) === "true",
          limit: req.query.limit ? Number(req.query.limit) : undefined
        })
      );
      return res.json(findings);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/diagnostics/findings/:findingId",
  requirePermission("system.diagnostics.read"),
  validateBody(findingUpdateSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const finding = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateDiagnosticFinding(client, auth, String(req.params.findingId), {
          status: req.body.status ?? null,
          ownerUserId: req.body.owner_user_id ?? null,
          resolutionNote: req.body.resolution_note ?? null
        })
      );
      return res.json({ finding });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/diagnostics/run",
  requirePermission("system.diagnostics.read"),
  requireElevatedSession,
  validateBody(diagnosticRunSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const runs = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        runDiagnosticRules(client, auth, {
          ruleKey: req.body.rule_key ?? null,
          resourceType: req.body.resource_type ?? null,
          resourceId: req.body.resource_id ?? null,
          departmentType: req.body.department_type ?? null,
          triggerType: req.body.trigger_type ?? "manual"
        })
      );
      return res.status(201).json({ runs });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/audit",
  requirePermission("system.audit.read"),
  validateQuery(auditQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const auditEvents = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listAuditEvents(client, auth.tenantId, {
          actorUserId: req.query.actor_user_id ? String(req.query.actor_user_id) : null,
          eventType: req.query.event_type ? String(req.query.event_type) : null,
          resourceType: req.query.resource_type ? String(req.query.resource_type) : null,
          departmentType: req.query.department_type ? String(req.query.department_type) : null,
          result: req.query.result ? String(req.query.result) : null,
          targetUserId: req.query.target_user_id ? String(req.query.target_user_id) : null,
          requestId: req.query.request_id ? String(req.query.request_id) : null,
          dateFrom: req.query.date_from ? String(req.query.date_from) : null,
          dateTo: req.query.date_to ? String(req.query.date_to) : null,
          limit: req.query.limit ? Number(req.query.limit) : undefined
        })
      );
      return res.json(auditEvents);
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/trace/:resourceType/:resourceId", requirePermission("system.trace.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const trace = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getEntityTrace(client, auth.tenantId, String(req.params.resourceType), String(req.params.resourceId))
    );
    return res.json(trace);
  } catch (error) {
    return next(error);
  }
});

router.get("/sync", requirePermission("system.sync.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, async (client) => ({
      sync_health: await listSyncHealthRecords(client, auth.tenantId),
      health_checks: await listSystemHealthChecks(client, auth.tenantId)
    }));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/repairs",
  requirePermission("system.repairs.manage"),
  validateQuery(auditLimitQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const repairs = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listRepairActions(client, auth.tenantId, req.query.limit ? Number(req.query.limit) : 100)
      );
      return res.json(repairs);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/repairs/preview",
  requirePermission("system.repairs.manage"),
  validateBody(repairActionSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const preview = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        previewRepairAction(client, auth, {
          actionKey: req.body.action_key,
          resourceType: req.body.resource_type,
          resourceId: req.body.resource_id ?? null,
          reason: req.body.reason ?? null,
          input: req.body.input ?? null
        })
      );
      return res.status(201).json(preview);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/repairs/execute",
  requirePermission("system.repairs.manage"),
  requireElevatedSession,
  validateBody(repairActionSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const repair = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        executeRepairAction(client, auth, {
          actionKey: req.body.action_key,
          resourceType: req.body.resource_type,
          resourceId: req.body.resource_id ?? null,
          reason: req.body.reason ?? null,
          input: req.body.input ?? null
        })
      );
      return res.status(201).json({ repair_action: repair });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/access-debug/traces",
  requirePermission("system.policy_trace.read"),
  validateQuery(policyTraceQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const traces = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listPolicyDecisionTraces(client, auth.tenantId, {
          actorUserId: req.query.actor_user_id ? String(req.query.actor_user_id) : null,
          permissionKey: req.query.permission_key ? String(req.query.permission_key) : null,
          resourceType: req.query.resource_type ? String(req.query.resource_type) : null,
          resourceId: req.query.resource_id ? String(req.query.resource_id) : null,
          limit: req.query.limit ? Number(req.query.limit) : undefined
        })
      );
      return res.json(traces);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/access-debug/preview",
  requirePermission("system.policy_trace.read"),
  validateBody(previewAccessSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const preview = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        previewAccessPolicy(client, auth, {
          targetUserId: req.body.target_user_id,
          routeId: req.body.route_id ?? null,
          resourceType: req.body.resource_type ?? null,
          resourceId: req.body.resource_id ?? null,
          permissionKeys: req.body.permission_keys,
          context: req.body.context
        })
      );
      return res.json(preview);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/imports",
  requirePermission("system.import_audit.read"),
  validateQuery(auditLimitQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const imports = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listImportAuditRecords(client, auth.tenantId, req.query.limit ? Number(req.query.limit) : 100)
      );
      return res.json(imports);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/exports",
  requirePermission("system.export_audit.read"),
  validateQuery(auditLimitQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const exports = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listExportAuditRecords(client, auth.tenantId, req.query.limit ? Number(req.query.limit) : 100)
      );
      return res.json(exports);
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
