import { createHash } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { withClientTransaction, withSystemTransaction } from "../db/tx.js";
import { requireAuth } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { requireAction } from "../middleware/rbac.js";
import { requireElevatedSession } from "../middleware/security.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import type { AuthenticatedRequest } from "../types/http.js";
import type {
  SweepMicrosoft365ClientIntakeOperationalControlResult,
  SweepMicrosoft365ClientIntakeRemindersResult
} from "../types/microsoft365ClientIntake.js";
import type { SweepMicrosoft365SmsRemindersResult } from "../types/microsoft365SmsOptimization.js";
import { hasAuthorityTier } from "../authz/authority.js";
import { authenticateTeamsMessageExtension } from "../services/microsoftTeamsAuth.js";
import {
  buildTeamsMessageExtensionResponse,
  listTeamsMessageExtensionTelemetry,
  logTeamsMessageExtensionOpen,
  resolveTeamsMessageExtensionOpen
} from "../services/microsoftTeamsMessageExtension.js";
import { buildTeamsEmbeddedAppUrl } from "../services/microsoftTeamsLinks.js";
import { listIntegrationSyncOperations, replayIntegrationSyncOperation } from "../services/integrationSync.js";
import { getIntegrationGovernance } from "../services/integrationGovernance.js";
import {
  getMicrosoftIntegrationHealth,
  listMicrosoftIntegrationEvents,
  recordMicrosoftIntegrationEvent
} from "../services/microsoftIntegrationObservability.js";
import {
  listMicrosoft365ClientIntakeMappings,
  listMicrosoft365ClientIntakeSubmissions,
  recordMicrosoft365ClientIntakeSubmission,
  reviewMicrosoft365ClientIntakeSubmission,
  sweepMicrosoft365ClientIntakeReminders,
  upsertMicrosoft365ClientIntakeMapping
} from "../services/microsoft365ClientIntake.js";
import {
  getMicrosoft365ClientIntakeOperationsWorkspace,
  sweepMicrosoft365ClientIntakeOperationalControl,
  updateMicrosoft365ClientIntakeSubmissionControl
} from "../services/microsoft365ClientIntakeOperations.js";
import {
  getMicrosoft365ClientPortalWorkspace,
  listMicrosoft365ClientPortalAccessGrants,
  listMicrosoft365ClientPortalProjectLinks,
  upsertMicrosoft365ClientPortalAccessGrant,
  upsertMicrosoft365ClientPortalProjectLink
} from "../services/microsoft365ClientPortal.js";
import {
  getMicrosoft365SmsOptimizationWorkspace,
  listMicrosoft365SmsConsents,
  listMicrosoft365SmsDeliveries,
  queueMicrosoft365SmsDelivery,
  recordMicrosoft365SmsCallback,
  replayMicrosoft365SmsDelivery,
  sweepMicrosoft365SmsReminders,
  upsertMicrosoft365SmsConsent
} from "../services/microsoft365SmsOptimization.js";
import {
  listMicrosoft365MailAutomationContracts,
  listMicrosoft365MailAutomationDeliveries,
  queueMicrosoft365MailAutomationDelivery,
  recordMicrosoft365MailAutomationCallback,
  replayMicrosoft365MailAutomationDelivery,
  syncMicrosoft365MailAutomationContracts
} from "../services/microsoft365MailAutomation.js";
import {
  listMicrosoft365ProvisioningLinks,
  queueMicrosoft365ProvisioningScaffold,
  upsertMicrosoft365ProvisioningLinks
} from "../services/microsoft365Provisioning.js";
import {
  createOperationalAlertRoute,
  getOperationalAlertAdminPayload,
  listOperationalAlertDeliveries,
  updateOperationalAlertRoute
} from "../services/operationalAlerting.js";
import { createAppEvent } from "../services/outbox.js";
import * as requestContextService from "../services/requestContext.js";

const router = Router();
const ALLOWED_WEBHOOK_PROVIDERS = new Set(["monday", "microsoft_graph", "agreement_signature"]);
const webhookQuerySchema = z.object({
  tenant_id: z.string().uuid(),
  validationToken: z.preprocess(
    (value) => (Array.isArray(value) ? value[0] : value),
    z.string().min(1).max(2048).optional()
  )
});
const operationalAlertStatusSchema = z.enum(["queued", "throttled", "sent", "failed"]);
const operationalAlertRouteBodySchema = z.object({
  alert_type: z.enum([
    "shoot_changed_within_48h",
    "job_missing_required_data",
    "staff_assignment_conflict_detected",
    "understaffed_job",
    "red_flag_post_shoot_eval",
    "overdue_production_item",
    "approval_needed",
    "gallery_job_completed"
  ]),
  delivery_channel: z.enum(["teams_webhook", "email", "sms", "push"]),
  route_name: z.string().min(1),
  destination_label: z.string().min(1),
  destination_config: z.record(z.unknown()),
  severity_threshold: z.enum(["low", "medium", "high", "critical"]),
  throttle_window_minutes: z.number().int().min(1).max(10080),
  enabled: z.boolean().optional()
});
const operationalAlertRouteUpdateBodySchema = operationalAlertRouteBodySchema.partial();
const teamsMessageExtensionQuerySchema = z
  .object({
    type: z.string().optional(),
    id: z.string().optional(),
    channelId: z.string().optional(),
    serviceUrl: z.string().url().optional(),
    from: z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
        aadObjectId: z.string().optional()
      })
      .optional(),
    conversation: z
      .object({
        id: z.string().optional(),
        conversationType: z.string().optional(),
        tenantId: z.string().optional()
      })
      .optional(),
    channelData: z
      .object({
        tenant: z
          .object({
            id: z.string().optional()
          })
          .optional()
      })
      .optional(),
    value: z
      .object({
        commandId: z.string().optional(),
        parameters: z
          .array(
            z.object({
              name: z.string().optional(),
              value: z.unknown().optional()
            })
          )
          .optional()
      })
      .optional()
  })
  .passthrough();
const teamsMessageExtensionOpenQuerySchema = z.object({
  token: z.string().min(1)
});
const teamsMessageExtensionTelemetryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional()
});
const microsoftDiagnosticsQuerySchema = z.object({
  area: z
    .enum([
      "auth",
      "account_linking",
      "outlook_calendar_sync",
      "mail_automation",
      "client_intake",
      "sms_automation",
      "teams_alerts",
      "teams_search",
      "teams_personal_app",
      "config"
    ])
    .optional(),
  level: z.enum(["info", "warning", "error"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});
const microsoftProvisioningEntityTypeSchema = z.enum([
  "organization",
  "job",
  "job_readiness_item",
  "post_shoot_evaluation",
  "work_task",
  "communication_event"
]);
const microsoftProvisioningObjectTypeSchema = z.enum([
  "team",
  "channel",
  "sharepoint_site",
  "sharepoint_library",
  "sharepoint_folder",
  "microsoft_list",
  "microsoft_list_item",
  "planner_plan",
  "planner_bucket",
  "planner_task",
  "shared_mailbox"
]);
const microsoftProvisioningLinkStatusSchema = z.enum(["pending", "linked", "failed", "drifted", "archived"]);
const microsoftProvisioningLinksQuerySchema = z.object({
  dashboard_entity_type: microsoftProvisioningEntityTypeSchema.optional(),
  dashboard_entity_id: z.string().trim().min(1).optional(),
  sync_status: microsoftProvisioningLinkStatusSchema.optional()
});
const microsoftProvisioningScaffoldBodySchema = z.object({
  dashboard_entity_type: microsoftProvisioningEntityTypeSchema,
  dashboard_entity_id: z.string().trim().min(1),
  source_change_key: z.string().trim().min(1).nullable().optional()
});
const microsoftProvisioningLinkBodySchema = z.object({
  dashboard_entity_type: microsoftProvisioningEntityTypeSchema,
  dashboard_entity_id: z.string().trim().min(1),
  operation_id: z.string().uuid().nullable().optional(),
  dashboard_url: z.string().trim().url().nullable().optional(),
  resolved_objects: z
    .array(
      z.object({
        microsoft_object_type: microsoftProvisioningObjectTypeSchema,
        microsoft_object_id: z.string().trim().min(1),
        microsoft_object_label: z.string().trim().min(1).nullable().optional(),
        microsoft_parent_object_id: z.string().trim().min(1).nullable().optional(),
        microsoft_url: z.string().trim().url().nullable().optional(),
        sync_status: microsoftProvisioningLinkStatusSchema.optional(),
        metadata: z.record(z.unknown()).optional()
      })
    )
    .min(1)
});
const microsoftMailAutomationRecordTypeSchema = z.enum([
  "organization",
  "job",
  "job_readiness_item",
  "post_shoot_evaluation",
  "work_task",
  "operational_approval_request",
  "communication_event"
]);
const microsoftMailAutomationTriggerTypeSchema = z.enum([
  "kickoff",
  "reminder",
  "overdue",
  "confirmation",
  "approval_request",
  "escalation",
  "manual"
]);
const microsoftMailAutomationStatusSchema = z.enum([
  "queued",
  "dispatching",
  "flow_accepted",
  "sent",
  "failed",
  "skipped",
  "throttled",
  "archived"
]);
const microsoftMailAutomationContractsQuerySchema = z.object({});
const microsoftMailAutomationDeliveriesQuerySchema = z.object({
  status: microsoftMailAutomationStatusSchema.optional(),
  related_record_type: microsoftMailAutomationRecordTypeSchema.optional(),
  related_record_id: z.string().trim().min(1).optional(),
  shared_mailbox_key: z.string().trim().min(1).optional(),
  trigger_type: microsoftMailAutomationTriggerTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});
const microsoftMailAutomationQueueBodySchema = z.object({
  related_record_type: microsoftMailAutomationRecordTypeSchema,
  related_record_id: z.string().trim().min(1),
  template_key: z.string().trim().min(1),
  trigger_type: microsoftMailAutomationTriggerTypeSchema,
  contact_id: z.string().uuid().nullable().optional(),
  recipient_name: z.string().trim().min(1).nullable().optional(),
  recipient_email: z.string().trim().email().nullable().optional(),
  source_change_key: z.string().trim().min(1).nullable().optional(),
  secure_link: z.string().trim().url().nullable().optional(),
  extra_merge_context: z.record(z.string(), z.string().nullable()).optional()
});
const microsoftMailAutomationReplayBodySchema = z.object({
  delivery_id: z.string().uuid()
});
const microsoftMailAutomationCallbackBodySchema = z.object({
  delivery_id: z.string().uuid(),
  status: z.enum(["sent", "failed", "skipped"]),
  provider_message_id: z.string().trim().min(1).nullable().optional(),
  provider_message_url: z.string().trim().url().nullable().optional(),
  flow_run_id: z.string().trim().min(1).nullable().optional(),
  flow_run_url: z.string().trim().url().nullable().optional(),
  error_code: z.string().trim().min(1).nullable().optional(),
  error_message: z.string().trim().min(1).nullable().optional(),
  metadata: z.record(z.unknown()).optional()
});
const microsoftClientIntakeRecordTypeSchema = z.enum(["job", "job_readiness_item"]);
const microsoftClientIntakeMappingStatusSchema = z.enum(["active", "paused", "archived"]);
const microsoftClientIntakeSubmissionStatusSchema = z.enum([
  "received_matched",
  "received_unmatched",
  "under_review",
  "revision_requested",
  "approved",
  "rejected",
  "archived"
]);
const microsoftClientIntakeExceptionStateSchema = z.enum(["none", "waiting_on_client", "paused", "manually_overridden"]);
const microsoftClientIntakeMappingsQuerySchema = z.object({
  related_record_type: microsoftClientIntakeRecordTypeSchema.optional(),
  related_record_id: z.string().trim().min(1).optional(),
  status: microsoftClientIntakeMappingStatusSchema.optional()
});
const microsoftClientIntakeMappingBodySchema = z.object({
  related_record_type: microsoftClientIntakeRecordTypeSchema,
  related_record_id: z.string().trim().min(1),
  request_link_url: z.string().trim().url(),
  request_link_external_id: z.string().trim().min(1).nullable().optional(),
  sharepoint_site_url: z.string().trim().url(),
  sharepoint_library_name: z.string().trim().min(1),
  sharepoint_folder_path: z.string().trim().min(1),
  sharepoint_folder_url: z.string().trim().url().nullable().optional(),
  forms_schema_key: z.string().trim().min(1).nullable().optional(),
  recipient_name_override: z.string().trim().min(1).nullable().optional(),
  recipient_email_override: z.string().trim().email().nullable().optional(),
  reviewer_user_ids: z.array(z.string().uuid()).optional(),
  manager_user_ids: z.array(z.string().uuid()).optional(),
  department_lead_user_ids: z.array(z.string().uuid()).optional(),
  reminder_enabled: z.boolean().optional(),
  reminder_cadence_hours: z.number().int().min(1).max(720).optional(),
  review_due_hours: z.number().int().min(1).max(720).optional(),
  first_escalation_hours: z.number().int().min(1).max(720).optional(),
  second_escalation_hours: z.number().int().min(1).max(1440).optional(),
  digest_enabled: z.boolean().optional(),
  status: microsoftClientIntakeMappingStatusSchema.optional(),
  metadata: z.record(z.unknown()).optional()
});
const microsoftClientIntakeSubmissionsQuerySchema = z.object({
  status: microsoftClientIntakeSubmissionStatusSchema.optional(),
  related_record_type: microsoftClientIntakeRecordTypeSchema.optional(),
  related_record_id: z.string().trim().min(1).optional(),
  unmatched_only: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});
const microsoftClientIntakeCallbackBodySchema = z.object({
  tenant_id: z.string().uuid().optional(),
  mapping_id: z.string().uuid().nullable().optional(),
  request_link_external_id: z.string().trim().min(1).nullable().optional(),
  request_link_url: z.string().trim().url().nullable().optional(),
  sharepoint_site_url: z.string().trim().url().nullable().optional(),
  sharepoint_library_name: z.string().trim().min(1).nullable().optional(),
  sharepoint_folder_path: z.string().trim().min(1).nullable().optional(),
  sharepoint_folder_url: z.string().trim().url().nullable().optional(),
  provider_submission_key: z.string().trim().min(1).nullable().optional(),
  microsoft_drive_id: z.string().trim().min(1).nullable().optional(),
  microsoft_drive_item_id: z.string().trim().min(1).nullable().optional(),
  file_name: z.string().trim().min(1),
  file_url: z.string().trim().url().nullable().optional(),
  content_type: z.string().trim().min(1).nullable().optional(),
  file_size_bytes: z.number().int().min(0).nullable().optional(),
  uploader_name: z.string().trim().min(1).nullable().optional(),
  uploader_email: z.string().trim().email().nullable().optional(),
  submitted_at: z.string().trim().min(1).nullable().optional(),
  dashboard_entity_type_hint: microsoftClientIntakeRecordTypeSchema.nullable().optional(),
  dashboard_entity_id_hint: z.string().trim().min(1).nullable().optional(),
  metadata: z.record(z.unknown()).optional()
});
const microsoftClientIntakeReviewBodySchema = z.object({
  decision: z.enum(["match", "approve", "reject", "request_revision"]),
  mapping_id: z.string().uuid().nullable().optional(),
  target_record_type: microsoftClientIntakeRecordTypeSchema.nullable().optional(),
  target_record_id: z.string().trim().min(1).nullable().optional(),
  create_mapping_from_submission: z.boolean().optional(),
  note: z.string().trim().max(4000).nullable().optional(),
  complete_required_item: z.boolean().optional()
});
const microsoftClientIntakeControlBodySchema = z.object({
  assigned_reviewer_user_id: z.string().uuid().nullable().optional(),
  exception_state: microsoftClientIntakeExceptionStateSchema.nullable().optional(),
  note: z.string().trim().max(4000).nullable().optional(),
  review_due_at: z.string().trim().min(1).nullable().optional()
});
const microsoftClientIntakeReminderSweepBodySchema = z.object({
  limit: z.number().int().min(1).max(500).optional()
});
const internalMicrosoftClientIntakeReminderSweepSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(500).optional()
});
const internalMicrosoftClientIntakeOperationalSweepSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(500).optional()
});
const microsoftClientPortalAccessScopeSchema = z.enum(["organization", "job"]);
const microsoftClientPortalAccessStatusSchema = z.enum(["invited", "active", "disabled", "revoked"]);
const microsoftClientPortalLinkStatusSchema = z.enum(["planned", "linked", "drifted", "archived"]);
const microsoftClientPortalAccessGrantsQuerySchema = z.object({
  organization_id: z.string().uuid().optional(),
  job_id: z.string().uuid().optional(),
  access_status: microsoftClientPortalAccessStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(250).optional()
});
const microsoftClientPortalAccessGrantBodySchema = z.object({
  organization_id: z.string().uuid().nullable().optional(),
  contact_id: z.string().uuid().nullable().optional(),
  job_id: z.string().uuid().nullable().optional(),
  access_scope: microsoftClientPortalAccessScopeSchema,
  access_status: microsoftClientPortalAccessStatusSchema.optional(),
  external_email: z.string().trim().email(),
  external_identity_provider: z.enum(["entra_external_id"]).optional(),
  external_identity_subject: z.string().trim().min(1).nullable().optional(),
  power_pages_contact_id: z.string().trim().min(1).nullable().optional(),
  power_pages_web_role_keys: z.array(z.string().trim().min(1)).optional(),
  metadata: z.record(z.unknown()).optional()
});
const microsoftClientPortalProjectsQuerySchema = z.object({
  organization_id: z.string().uuid().optional(),
  job_id: z.string().uuid().optional(),
  link_status: microsoftClientPortalLinkStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(250).optional()
});
const microsoftClientPortalProjectBodySchema = z.object({
  job_id: z.string().uuid(),
  power_pages_site_key: z.string().trim().min(1).nullable().optional(),
  portal_project_key: z.string().trim().min(1),
  overview_page_url: z.string().trim().url().nullable().optional(),
  required_items_page_url: z.string().trim().url().nullable().optional(),
  upload_page_url: z.string().trim().url().nullable().optional(),
  submission_history_page_url: z.string().trim().url().nullable().optional(),
  help_page_url: z.string().trim().url().nullable().optional(),
  link_status: microsoftClientPortalLinkStatusSchema.optional(),
  metadata: z.record(z.unknown()).optional()
});
const microsoftSmsConsentStatusSchema = z.enum(["unknown", "opted_in", "opted_out", "suppressed"]);
const microsoftSmsConsentSourceSchema = z.enum(["manual_internal", "portal_opt_in", "client_reply", "compliance_import"]);
const microsoftSmsRecordTypeSchema = z.enum(["job", "job_readiness_item"]);
const microsoftSmsTriggerTypeSchema = z.enum(["reminder", "overdue", "manual"]);
const microsoftSmsDeliveryStatusSchema = z.enum([
  "queued",
  "dispatching",
  "provider_accepted",
  "sent",
  "delivered",
  "failed",
  "skipped",
  "throttled",
  "archived"
]);
const microsoftSmsConsentsQuerySchema = z.object({
  contact_id: z.string().uuid().optional(),
  consent_status: microsoftSmsConsentStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(250).optional()
});
const microsoftSmsConsentBodySchema = z.object({
  contact_id: z.string().uuid().nullable().optional(),
  phone_number: z.string().trim().min(8),
  consent_status: microsoftSmsConsentStatusSchema,
  consent_source: microsoftSmsConsentSourceSchema,
  consent_captured_at: z.string().trim().min(1).nullable().optional(),
  consent_expires_at: z.string().trim().min(1).nullable().optional(),
  suppress_until: z.string().trim().min(1).nullable().optional(),
  opt_out_reason: z.string().trim().min(1).nullable().optional(),
  metadata: z.record(z.unknown()).optional()
});
const microsoftSmsDeliveriesQuerySchema = z.object({
  status: microsoftSmsDeliveryStatusSchema.optional(),
  related_record_type: microsoftSmsRecordTypeSchema.optional(),
  related_record_id: z.string().trim().min(1).optional(),
  template_key: z.string().trim().min(1).optional(),
  trigger_type: microsoftSmsTriggerTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(250).optional()
});
const microsoftSmsQueueBodySchema = z.object({
  related_record_type: microsoftSmsRecordTypeSchema,
  related_record_id: z.string().trim().min(1),
  template_key: z.string().trim().min(1),
  trigger_type: microsoftSmsTriggerTypeSchema,
  contact_id: z.string().uuid().nullable().optional(),
  recipient_name: z.string().trim().min(1).nullable().optional(),
  recipient_phone_number: z.string().trim().min(8).nullable().optional(),
  secure_link_url: z.string().trim().url().nullable().optional(),
  source_change_key: z.string().trim().min(1).nullable().optional(),
  extra_merge_context: z.record(z.string(), z.string().nullable()).optional()
});
const microsoftSmsReplayBodySchema = z.object({
  delivery_id: z.string().uuid()
});
const microsoftSmsCallbackBodySchema = z.object({
  delivery_id: z.string().uuid(),
  status: z.enum(["sent", "delivered", "failed", "skipped"]),
  provider_message_id: z.string().trim().min(1).nullable().optional(),
  provider_message_url: z.string().trim().url().nullable().optional(),
  flow_run_id: z.string().trim().min(1).nullable().optional(),
  flow_run_url: z.string().trim().url().nullable().optional(),
  error_code: z.string().trim().min(1).nullable().optional(),
  error_message: z.string().trim().min(1).nullable().optional(),
  opted_out: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional()
});
const microsoftSmsReminderSweepBodySchema = z.object({
  limit: z.number().int().min(1).max(500).optional()
});
const internalMicrosoftSmsReminderSweepSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(500).optional()
});
const WEBHOOK_BODY_MAX_BYTES = 256 * 1024;
const webhookRateLimit = createRateLimiter({
  bucket: "integration-webhook",
  windowMs: 60 * 1000,
  max: 60,
  key: (req) => `${req.ip}:${String(req.params.provider ?? "")}:${String(req.query?.tenant_id ?? "")}`
});

router.post("/:provider/webhook", webhookRateLimit, async (req, res, next) => {
  try {
    const provider = String(req.params.provider ?? "").trim().toLowerCase();
    if (!ALLOWED_WEBHOOK_PROVIDERS.has(provider)) {
      return res.status(404).json({ error: "Webhook provider not found" });
    }

    if (!config.INTEGRATION_WEBHOOK_ALLOW_QUERY_TENANT_ROUTING) {
      return res.status(503).json({ error: "Webhook tenant routing is not enabled for this environment" });
    }

    const parsedQuery = webhookQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: parsedQuery.error.flatten()
      });
    }

    if (provider === "microsoft_graph" && parsedQuery.data.validationToken) {
      return res.status(200).type("text/plain").send(parsedQuery.data.validationToken);
    }

    const verificationMode =
      provider === "microsoft_graph"
        ? resolveMicrosoftGraphWebhookVerificationMode(req)
        : resolveSharedSecretWebhookVerificationMode(req);
    if (!verificationMode.accepted) {
      return res.status(verificationMode.status).json({ error: verificationMode.message });
    }

    if (typeof req.body?.challenge === "string" && req.body.challenge.length <= 512) {
      return res.json({ challenge: req.body.challenge });
    }

    const tenantId = parsedQuery.data.tenant_id;
    const serializedBody = safeSerializeWebhookBody(req.body);
    if (Buffer.byteLength(serializedBody, "utf8") > WEBHOOK_BODY_MAX_BYTES) {
      return res.status(413).json({ error: "Webhook payload is too large" });
    }

    const event = await withClientTransaction(tenantId, null, async (client) =>
      createAppEvent(client, {
        tenantId,
        eventType: `${provider}.webhook.received`,
        aggregateType: "integration_webhook",
        aggregateId: null,
        dedupeKey: `${provider}:${req.header("Idempotency-Key") ?? hashWebhookBody(serializedBody)}`,
        payload: {
          provider,
          received_at: new Date().toISOString(),
          source_ip: req.ip,
          verification_mode: verificationMode.mode,
          headers: sanitizeWebhookHeaders(req.headers),
          body: normalizeWebhookPayloadBody(req.body)
        }
      })
    );
    return res.status(202).json(event);
  } catch (error) {
    return next(error);
  }
});

router.get("/governance", requireAuth, requireAction("dashboard.read"), requireIntegrationGovernanceAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => getIntegrationGovernance(client, auth));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/microsoft/health", requireAuth, requireAction("dashboard.read"), requireIntegrationGovernanceAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => getMicrosoftIntegrationHealth(client, auth));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/microsoft/diagnostics",
  requireAuth,
  requireAction("dashboard.read"),
  requireIntegrationGovernanceAccess,
  validateQuery(microsoftDiagnosticsQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listMicrosoftIntegrationEvents(client, auth, {
          area: req.query.area ? (String(req.query.area) as any) : null,
          level: req.query.level ? (String(req.query.level) as any) : null,
          limit: req.query.limit ? Number(req.query.limit) : undefined
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/microsoft/provisioning/links",
  requireAuth,
  requireAction("dashboard.read"),
  requireIntegrationGovernanceAccess,
  validateQuery(microsoftProvisioningLinksQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listMicrosoft365ProvisioningLinks(client, auth, {
          dashboardEntityType: req.query.dashboard_entity_type
            ? (String(req.query.dashboard_entity_type) as
                | "organization"
                | "job"
                | "job_readiness_item"
                | "post_shoot_evaluation"
                | "work_task"
                | "communication_event")
            : null,
          dashboardEntityId: req.query.dashboard_entity_id ? String(req.query.dashboard_entity_id) : null,
          syncStatus: req.query.sync_status
            ? (String(req.query.sync_status) as "pending" | "linked" | "failed" | "drifted" | "archived")
            : null
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/microsoft/provisioning/scaffold",
  requireAuth,
  requireAction("schedule.manage"),
  requireElevatedSession,
  requireIntegrationGovernanceManageAccess,
  validateBody(microsoftProvisioningScaffoldBodySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        queueMicrosoft365ProvisioningScaffold(client, auth, {
          dashboard_entity_type: req.body.dashboard_entity_type,
          dashboard_entity_id: req.body.dashboard_entity_id,
          source_change_key: req.body.source_change_key ?? null
        })
      );
      return res.status(202).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/microsoft/provisioning/links",
  requireAuth,
  requireAction("schedule.manage"),
  requireElevatedSession,
  requireIntegrationGovernanceManageAccess,
  validateBody(microsoftProvisioningLinkBodySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        upsertMicrosoft365ProvisioningLinks(client, auth, {
          dashboard_entity_type: req.body.dashboard_entity_type,
          dashboard_entity_id: req.body.dashboard_entity_id,
          operation_id: req.body.operation_id ?? null,
          dashboard_url: req.body.dashboard_url ?? null,
          resolved_objects: req.body.resolved_objects
        })
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/microsoft/email-automation/contracts",
  requireAuth,
  requireAction("dashboard.read"),
  requireIntegrationGovernanceAccess,
  validateQuery(microsoftMailAutomationContractsQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listMicrosoft365MailAutomationContracts(client, auth)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/microsoft/email-automation/contracts/sync",
  requireAuth,
  requireAction("schedule.manage"),
  requireElevatedSession,
  requireIntegrationGovernanceManageAccess,
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        syncMicrosoft365MailAutomationContracts(client, auth)
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/microsoft/email-automation/deliveries",
  requireAuth,
  requireAction("dashboard.read"),
  requireIntegrationGovernanceAccess,
  validateQuery(microsoftMailAutomationDeliveriesQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listMicrosoft365MailAutomationDeliveries(client, auth, {
          status: req.query.status ? (String(req.query.status) as any) : null,
          recordType: req.query.related_record_type ? (String(req.query.related_record_type) as any) : null,
          recordId: req.query.related_record_id ? String(req.query.related_record_id) : null,
          mailboxKey: req.query.shared_mailbox_key ? String(req.query.shared_mailbox_key) : null,
          triggerType: req.query.trigger_type ? (String(req.query.trigger_type) as any) : null,
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
  "/microsoft/email-automation/deliveries",
  requireAuth,
  requireAction("schedule.manage"),
  requireElevatedSession,
  requireIntegrationGovernanceManageAccess,
  validateBody(microsoftMailAutomationQueueBodySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        queueMicrosoft365MailAutomationDelivery(client, auth, {
          related_record_type: req.body.related_record_type,
          related_record_id: req.body.related_record_id,
          template_key: req.body.template_key,
          trigger_type: req.body.trigger_type,
          contact_id: req.body.contact_id ?? null,
          recipient_name: req.body.recipient_name ?? null,
          recipient_email: req.body.recipient_email ?? null,
          source_change_key: req.body.source_change_key ?? null,
          secure_link: req.body.secure_link ?? null,
          extra_merge_context: req.body.extra_merge_context ?? undefined
        })
      );
      return res.status(payload.deduped ? 200 : 202).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/microsoft/email-automation/deliveries/replay",
  requireAuth,
  requireAction("schedule.manage"),
  requireElevatedSession,
  requireIntegrationGovernanceManageAccess,
  validateBody(microsoftMailAutomationReplayBodySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        replayMicrosoft365MailAutomationDelivery(client, auth, {
          delivery_id: req.body.delivery_id
        })
      );
      return res.status(202).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/microsoft/email-automation/callback", validateBody(microsoftMailAutomationCallbackBodySchema), async (req, res, next) => {
  try {
    if (config.MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET) {
      if (req.header("X-PMC-Mail-Automation-Secret") !== config.MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET) {
        return res.status(401).json({ error: "Invalid callback credentials" });
      }
    } else if (config.NODE_ENV === "production") {
      return res.status(503).json({ error: "Mail automation callback verification is not configured for production" });
    }

    const payload = await withSystemTransaction((client) =>
      recordMicrosoft365MailAutomationCallback(client, {
        delivery_id: req.body.delivery_id,
        status: req.body.status,
        provider_message_id: req.body.provider_message_id ?? null,
        provider_message_url: req.body.provider_message_url ?? null,
        flow_run_id: req.body.flow_run_id ?? null,
        flow_run_url: req.body.flow_run_url ?? null,
        error_code: req.body.error_code ?? null,
        error_message: req.body.error_message ?? null,
        metadata: req.body.metadata ?? {}
      })
    );
    return res.status(202).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/microsoft/client-intake/mappings",
  requireAuth,
  requireAction("dashboard.read"),
  requireIntegrationGovernanceAccess,
  validateQuery(microsoftClientIntakeMappingsQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listMicrosoft365ClientIntakeMappings(client, auth, {
          relatedRecordType: req.query.related_record_type ? (String(req.query.related_record_type) as "job" | "job_readiness_item") : null,
          relatedRecordId: req.query.related_record_id ? String(req.query.related_record_id) : null,
          status: req.query.status ? (String(req.query.status) as "active" | "paused" | "archived") : null
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/microsoft/client-intake/mappings",
  requireAuth,
  requireAction("schedule.manage"),
  requireElevatedSession,
  requireIntegrationGovernanceManageAccess,
  validateBody(microsoftClientIntakeMappingBodySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        upsertMicrosoft365ClientIntakeMapping(client, auth, {
          related_record_type: req.body.related_record_type,
          related_record_id: req.body.related_record_id,
          request_link_url: req.body.request_link_url,
          request_link_external_id: req.body.request_link_external_id ?? null,
          sharepoint_site_url: req.body.sharepoint_site_url,
          sharepoint_library_name: req.body.sharepoint_library_name,
          sharepoint_folder_path: req.body.sharepoint_folder_path,
          sharepoint_folder_url: req.body.sharepoint_folder_url ?? null,
          forms_schema_key: req.body.forms_schema_key ?? null,
          recipient_name_override: req.body.recipient_name_override ?? null,
          recipient_email_override: req.body.recipient_email_override ?? null,
          reviewer_user_ids: req.body.reviewer_user_ids ?? undefined,
          manager_user_ids: req.body.manager_user_ids ?? undefined,
          department_lead_user_ids: req.body.department_lead_user_ids ?? undefined,
          reminder_enabled: req.body.reminder_enabled,
          reminder_cadence_hours: req.body.reminder_cadence_hours,
          review_due_hours: req.body.review_due_hours,
          first_escalation_hours: req.body.first_escalation_hours,
          second_escalation_hours: req.body.second_escalation_hours,
          digest_enabled: req.body.digest_enabled,
          status: req.body.status,
          metadata: req.body.metadata ?? {}
        })
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/microsoft/client-intake/operations/workspace",
  requireAuth,
  requireAction("dashboard.read"),
  requireIntegrationGovernanceAccess,
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getMicrosoft365ClientIntakeOperationsWorkspace(client, auth)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/microsoft/client-intake/submissions",
  requireAuth,
  requireAction("dashboard.read"),
  requireIntegrationGovernanceAccess,
  validateQuery(microsoftClientIntakeSubmissionsQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listMicrosoft365ClientIntakeSubmissions(client, auth, {
          status: req.query.status ? (String(req.query.status) as any) : null,
          relatedRecordType: req.query.related_record_type ? (String(req.query.related_record_type) as "job" | "job_readiness_item") : null,
          relatedRecordId: req.query.related_record_id ? String(req.query.related_record_id) : null,
          unmatchedOnly: String(req.query.unmatched_only) === "true",
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
  "/microsoft/client-intake/submissions/:id/control",
  requireAuth,
  requireAction("schedule.manage"),
  requireElevatedSession,
  requireIntegrationGovernanceManageAccess,
  validateBody(microsoftClientIntakeControlBodySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateMicrosoft365ClientIntakeSubmissionControl(client, auth, String(req.params.id), {
          assigned_reviewer_user_id: req.body.assigned_reviewer_user_id ?? undefined,
          exception_state: req.body.exception_state ?? undefined,
          note: req.body.note ?? undefined,
          review_due_at: req.body.review_due_at ?? undefined
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/microsoft/client-intake/submissions/:id/review",
  requireAuth,
  requireAction("schedule.manage"),
  requireElevatedSession,
  requireIntegrationGovernanceManageAccess,
  validateBody(microsoftClientIntakeReviewBodySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        reviewMicrosoft365ClientIntakeSubmission(client, auth, String(req.params.id), {
          decision: req.body.decision,
          mapping_id: req.body.mapping_id ?? null,
          target_record_type: req.body.target_record_type ?? null,
          target_record_id: req.body.target_record_id ?? null,
          create_mapping_from_submission: req.body.create_mapping_from_submission,
          note: req.body.note ?? null,
          complete_required_item: req.body.complete_required_item
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/microsoft/client-intake/callback", validateBody(microsoftClientIntakeCallbackBodySchema), async (req, res, next) => {
  try {
    if (config.MICROSOFT_365_CLIENT_INTAKE_CALLBACK_SECRET) {
      if (req.header("X-PMC-Client-Intake-Secret") !== config.MICROSOFT_365_CLIENT_INTAKE_CALLBACK_SECRET) {
        return res.status(401).json({ error: "Invalid callback credentials" });
      }
    } else if (config.NODE_ENV === "production") {
      return res.status(503).json({ error: "Client intake callback verification is not configured for production" });
    }

    const resolvedTenantId = String(req.header("X-PMC-Tenant-Id") ?? req.body.tenant_id ?? "").trim();
    if (!z.string().uuid().safeParse(resolvedTenantId).success) {
      return res.status(400).json({ error: "A valid tenant id is required for client intake callbacks." });
    }

    const payload = await withSystemTransaction((client) =>
      recordMicrosoft365ClientIntakeSubmission(client, {
        tenantId: resolvedTenantId,
        actorUserId: null,
        submission: {
          mapping_id: req.body.mapping_id ?? null,
          request_link_external_id: req.body.request_link_external_id ?? null,
          request_link_url: req.body.request_link_url ?? null,
          sharepoint_site_url: req.body.sharepoint_site_url ?? null,
          sharepoint_library_name: req.body.sharepoint_library_name ?? null,
          sharepoint_folder_path: req.body.sharepoint_folder_path ?? null,
          sharepoint_folder_url: req.body.sharepoint_folder_url ?? null,
          provider_submission_key: req.body.provider_submission_key ?? null,
          microsoft_drive_id: req.body.microsoft_drive_id ?? null,
          microsoft_drive_item_id: req.body.microsoft_drive_item_id ?? null,
          file_name: req.body.file_name,
          file_url: req.body.file_url ?? null,
          content_type: req.body.content_type ?? null,
          file_size_bytes: req.body.file_size_bytes ?? null,
          uploader_name: req.body.uploader_name ?? null,
          uploader_email: req.body.uploader_email ?? null,
          submitted_at: req.body.submitted_at ?? null,
          dashboard_entity_type_hint: req.body.dashboard_entity_type_hint ?? null,
          dashboard_entity_id_hint: req.body.dashboard_entity_id_hint ?? null,
          metadata: req.body.metadata ?? {}
        }
      })
    );
    return res.status(payload.deduped ? 200 : 202).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/microsoft/client-intake/reminders/sweep",
  requireAuth,
  requireAction("schedule.manage"),
  requireElevatedSession,
  requireIntegrationGovernanceManageAccess,
  validateBody(microsoftClientIntakeReminderSweepBodySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        sweepMicrosoft365ClientIntakeReminders(client, auth, {
          limit: req.body.limit
        })
      );
      return res.json({ result });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/microsoft/client-portal/workspace",
  requireAuth,
  requireAction("dashboard.read"),
  requireIntegrationGovernanceAccess,
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getMicrosoft365ClientPortalWorkspace(client, auth)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/microsoft/client-portal/access-grants",
  requireAuth,
  requireAction("dashboard.read"),
  requireIntegrationGovernanceAccess,
  validateQuery(microsoftClientPortalAccessGrantsQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listMicrosoft365ClientPortalAccessGrants(client, auth, {
          organizationId: req.query.organization_id ? String(req.query.organization_id) : null,
          jobId: req.query.job_id ? String(req.query.job_id) : null,
          accessStatus: req.query.access_status
            ? (String(req.query.access_status) as "invited" | "active" | "disabled" | "revoked")
            : null,
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
  "/microsoft/client-portal/access-grants",
  requireAuth,
  requireAction("schedule.manage"),
  requireElevatedSession,
  requireIntegrationGovernanceManageAccess,
  validateBody(microsoftClientPortalAccessGrantBodySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        upsertMicrosoft365ClientPortalAccessGrant(client, auth, {
          organization_id: req.body.organization_id ?? null,
          contact_id: req.body.contact_id ?? null,
          job_id: req.body.job_id ?? null,
          access_scope: req.body.access_scope,
          access_status: req.body.access_status,
          external_email: req.body.external_email,
          external_identity_provider: req.body.external_identity_provider,
          external_identity_subject: req.body.external_identity_subject ?? null,
          power_pages_contact_id: req.body.power_pages_contact_id ?? null,
          power_pages_web_role_keys: req.body.power_pages_web_role_keys ?? undefined,
          metadata: req.body.metadata ?? {}
        })
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/microsoft/client-portal/projects",
  requireAuth,
  requireAction("dashboard.read"),
  requireIntegrationGovernanceAccess,
  validateQuery(microsoftClientPortalProjectsQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listMicrosoft365ClientPortalProjectLinks(client, auth, {
          organizationId: req.query.organization_id ? String(req.query.organization_id) : null,
          jobId: req.query.job_id ? String(req.query.job_id) : null,
          linkStatus: req.query.link_status ? (String(req.query.link_status) as "planned" | "linked" | "drifted" | "archived") : null,
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
  "/microsoft/client-portal/projects",
  requireAuth,
  requireAction("schedule.manage"),
  requireElevatedSession,
  requireIntegrationGovernanceManageAccess,
  validateBody(microsoftClientPortalProjectBodySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        upsertMicrosoft365ClientPortalProjectLink(client, auth, {
          job_id: req.body.job_id,
          power_pages_site_key: req.body.power_pages_site_key ?? null,
          portal_project_key: req.body.portal_project_key,
          overview_page_url: req.body.overview_page_url ?? null,
          required_items_page_url: req.body.required_items_page_url ?? null,
          upload_page_url: req.body.upload_page_url ?? null,
          submission_history_page_url: req.body.submission_history_page_url ?? null,
          help_page_url: req.body.help_page_url ?? null,
          link_status: req.body.link_status,
          metadata: req.body.metadata ?? {}
        })
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/microsoft/sms-optimization/workspace",
  requireAuth,
  requireAction("dashboard.read"),
  requireIntegrationGovernanceAccess,
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getMicrosoft365SmsOptimizationWorkspace(client, auth)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/microsoft/sms-optimization/consents",
  requireAuth,
  requireAction("dashboard.read"),
  requireIntegrationGovernanceAccess,
  validateQuery(microsoftSmsConsentsQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listMicrosoft365SmsConsents(client, auth, {
          contactId: req.query.contact_id ? String(req.query.contact_id) : null,
          consentStatus: req.query.consent_status ? (String(req.query.consent_status) as any) : null,
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
  "/microsoft/sms-optimization/consents",
  requireAuth,
  requireAction("schedule.manage"),
  requireElevatedSession,
  requireIntegrationGovernanceManageAccess,
  validateBody(microsoftSmsConsentBodySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        upsertMicrosoft365SmsConsent(client, auth, {
          contact_id: req.body.contact_id ?? null,
          phone_number: req.body.phone_number,
          consent_status: req.body.consent_status,
          consent_source: req.body.consent_source,
          consent_captured_at: req.body.consent_captured_at ?? null,
          consent_expires_at: req.body.consent_expires_at ?? null,
          suppress_until: req.body.suppress_until ?? null,
          opt_out_reason: req.body.opt_out_reason ?? null,
          metadata: req.body.metadata ?? {}
        })
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/microsoft/sms-optimization/deliveries",
  requireAuth,
  requireAction("dashboard.read"),
  requireIntegrationGovernanceAccess,
  validateQuery(microsoftSmsDeliveriesQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listMicrosoft365SmsDeliveries(client, auth, {
          status: req.query.status ? (String(req.query.status) as any) : null,
          relatedRecordType: req.query.related_record_type ? (String(req.query.related_record_type) as any) : null,
          relatedRecordId: req.query.related_record_id ? String(req.query.related_record_id) : null,
          templateKey: req.query.template_key ? String(req.query.template_key) : null,
          triggerType: req.query.trigger_type ? (String(req.query.trigger_type) as any) : null,
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
  "/microsoft/sms-optimization/deliveries",
  requireAuth,
  requireAction("schedule.manage"),
  requireElevatedSession,
  requireIntegrationGovernanceManageAccess,
  validateBody(microsoftSmsQueueBodySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        queueMicrosoft365SmsDelivery(client, auth, {
          related_record_type: req.body.related_record_type,
          related_record_id: req.body.related_record_id,
          template_key: req.body.template_key,
          trigger_type: req.body.trigger_type,
          contact_id: req.body.contact_id ?? null,
          recipient_name: req.body.recipient_name ?? null,
          recipient_phone_number: req.body.recipient_phone_number ?? null,
          secure_link_url: req.body.secure_link_url ?? null,
          source_change_key: req.body.source_change_key ?? null,
          extra_merge_context: req.body.extra_merge_context ?? {}
        })
      );
      return res.status(payload.deduped ? 200 : 202).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/microsoft/sms-optimization/deliveries/replay",
  requireAuth,
  requireAction("schedule.manage"),
  requireElevatedSession,
  requireIntegrationGovernanceManageAccess,
  validateBody(microsoftSmsReplayBodySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        replayMicrosoft365SmsDelivery(client, auth, {
          delivery_id: req.body.delivery_id
        })
      );
      return res.status(202).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/microsoft/sms-optimization/callback", validateBody(microsoftSmsCallbackBodySchema), async (req, res, next) => {
  try {
    if (config.MICROSOFT_365_SMS_CALLBACK_SECRET) {
      if (req.header("X-PMC-SMS-Callback-Secret") !== config.MICROSOFT_365_SMS_CALLBACK_SECRET) {
        return res.status(401).json({ error: "Invalid callback credentials" });
      }
    } else if (config.NODE_ENV === "production") {
      return res.status(503).json({ error: "SMS callback verification is not configured for production" });
    }

    const payload = await withSystemTransaction((client) =>
      recordMicrosoft365SmsCallback(client, {
        delivery_id: req.body.delivery_id,
        status: req.body.status,
        provider_message_id: req.body.provider_message_id ?? null,
        provider_message_url: req.body.provider_message_url ?? null,
        flow_run_id: req.body.flow_run_id ?? null,
        flow_run_url: req.body.flow_run_url ?? null,
        error_code: req.body.error_code ?? null,
        error_message: req.body.error_message ?? null,
        opted_out: req.body.opted_out ?? false,
        metadata: req.body.metadata ?? {}
      })
    );
    return res.status(202).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/microsoft/sms-optimization/reminders/sweep",
  requireAuth,
  requireAction("schedule.manage"),
  requireElevatedSession,
  requireIntegrationGovernanceManageAccess,
  validateBody(microsoftSmsReminderSweepBodySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        sweepMicrosoft365SmsReminders(client, auth, {
          limit: req.body.limit
        })
      );
      return res.json({ result });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/microsoft/client-intake/internal/operations/sweep",
  validateBody(internalMicrosoftClientIntakeOperationalSweepSchema),
  async (req, res, next) => {
    try {
      if ((req.header("X-PMC-Internal-Secret") ?? "") !== config.INTERNAL_SOCKET_SECRET) {
        return res.status(401).json({ error: "Invalid internal credentials" });
      }

      const tenantIds =
        typeof req.body.tenant_id === "string"
          ? [req.body.tenant_id]
          : await withSystemTransaction(async (client) => {
              const { rows } = await client.query<{ id: string }>(
                `
                  SELECT id::text AS id
                  FROM tenant
                  ORDER BY created_at ASC
                `
              );
              return rows.map((row) => row.id);
            });

      const results: Array<{ tenant_id: string; result: SweepMicrosoft365ClientIntakeOperationalControlResult }> = [];
      for (const tenantId of tenantIds) {
        const result = await withClientTransaction(tenantId, null, (client) =>
          sweepMicrosoft365ClientIntakeOperationalControl(client, { tenantId, id: null }, { limit: req.body.limit })
        );
        results.push({ tenant_id: tenantId, result });
      }

      return res.json({
        tenant_count: tenantIds.length,
        scanned_submission_count: results.reduce((sum, entry) => sum + entry.result.scanned_submission_count, 0),
        review_assignment_count: results.reduce((sum, entry) => sum + entry.result.review_assignment_count, 0),
        escalated_count: results.reduce((sum, entry) => sum + entry.result.escalated_count, 0),
        digest_queued_count: results.reduce((sum, entry) => sum + entry.result.digest_queued_count, 0),
        suppressed_count: results.reduce((sum, entry) => sum + entry.result.suppressed_count, 0),
        failed_count: results.reduce((sum, entry) => sum + entry.result.failed_count, 0),
        results
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/microsoft/client-intake/internal/reminders/sweep",
  validateBody(internalMicrosoftClientIntakeReminderSweepSchema),
  async (req, res, next) => {
    try {
      if ((req.header("X-PMC-Internal-Secret") ?? "") !== config.INTERNAL_SOCKET_SECRET) {
        return res.status(401).json({ error: "Invalid internal credentials" });
      }

      const tenantIds =
        typeof req.body.tenant_id === "string"
          ? [req.body.tenant_id]
          : await withSystemTransaction(async (client) => {
              const { rows } = await client.query<{ id: string }>(
                `
                  SELECT id::text AS id
                  FROM tenant
                  ORDER BY created_at ASC
                `
              );
              return rows.map((row) => row.id);
            });

      const results: Array<{ tenant_id: string; result: SweepMicrosoft365ClientIntakeRemindersResult }> = [];
      for (const tenantId of tenantIds) {
        const result = await withClientTransaction(tenantId, null, (client) =>
          sweepMicrosoft365ClientIntakeReminders(client, { tenantId, id: null }, { limit: req.body.limit })
        );
        results.push({ tenant_id: tenantId, result });
      }

      return res.json({
        tenant_count: tenantIds.length,
        scanned_mapping_count: results.reduce((sum, entry) => sum + entry.result.scanned_mapping_count, 0),
        reminder_queued_count: results.reduce((sum, entry) => sum + entry.result.reminder_queued_count, 0),
        overdue_queued_count: results.reduce((sum, entry) => sum + entry.result.overdue_queued_count, 0),
        suppressed_count: results.reduce((sum, entry) => sum + entry.result.suppressed_count, 0),
        unmatched_open_count: results.reduce((sum, entry) => sum + entry.result.unmatched_open_count, 0),
        failed_count: results.reduce((sum, entry) => sum + entry.result.failed_count, 0),
        results
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/microsoft/sms-optimization/internal/reminders/sweep",
  validateBody(internalMicrosoftSmsReminderSweepSchema),
  async (req, res, next) => {
    try {
      if ((req.header("X-PMC-Internal-Secret") ?? "") !== config.INTERNAL_SOCKET_SECRET) {
        return res.status(401).json({ error: "Invalid internal credentials" });
      }

      const tenantIds =
        typeof req.body.tenant_id === "string"
          ? [req.body.tenant_id]
          : await withSystemTransaction(async (client) => {
              const { rows } = await client.query<{ id: string }>(
                `
                  SELECT id::text AS id
                  FROM tenant
                  ORDER BY created_at ASC
                `
              );
              return rows.map((row) => row.id);
            });

      const results: Array<{ tenant_id: string; result: SweepMicrosoft365SmsRemindersResult }> = [];
      for (const tenantId of tenantIds) {
        const result = await withClientTransaction(tenantId, null, (client) =>
          sweepMicrosoft365SmsReminders(client, { tenantId, id: null }, { limit: req.body.limit })
        );
        results.push({ tenant_id: tenantId, result });
      }

      return res.json({
        tenant_count: tenantIds.length,
        scanned_mapping_count: results.reduce((sum, entry) => sum + entry.result.scanned_mapping_count, 0),
        queued_count: results.reduce((sum, entry) => sum + entry.result.queued_count, 0),
        overdue_queued_count: results.reduce((sum, entry) => sum + entry.result.overdue_queued_count, 0),
        suppressed_count: results.reduce((sum, entry) => sum + entry.result.suppressed_count, 0),
        ineligible_count: results.reduce((sum, entry) => sum + entry.result.ineligible_count, 0),
        failed_count: results.reduce((sum, entry) => sum + entry.result.failed_count, 0),
        results
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/teams/message-extension", validateBody(teamsMessageExtensionQuerySchema), async (req, res, next) => {
  let authUser: { tenantId: string; id: string } | null = null;
  try {
    requestContextService.setRequestContextSourceSurface?.("teams_message_extension");
    const auth = await withSystemTransaction((client) => authenticateTeamsMessageExtension(client, req.headers, req.body));
    authUser = { tenantId: auth.tenantId, id: auth.id };
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => buildTeamsMessageExtensionResponse(client, auth, req.body));
    return res.json(payload);
  } catch (error) {
    try {
      await withSystemTransaction((client) =>
        recordMicrosoftIntegrationEvent(client, {
          tenantId: authUser?.tenantId ?? null,
          actorUserId: authUser?.id ?? null,
          integrationArea: "teams_search",
          eventLevel: "error",
          eventType: "teams.message_extension.request_failed",
          summary: "Teams message extension request failed before a result payload could be returned.",
          detail: {
            message: error instanceof Error ? error.message : "Unknown Teams message extension failure."
          }
        })
      );
    } catch {
      // Keep the original Teams request failure visible even if diagnostics logging also fails.
    }
    return next(error);
  }
});

router.get("/teams/message-extension/open", validateQuery(teamsMessageExtensionOpenQuerySchema), async (req, res, next) => {
  try {
    requestContextService.setRequestContextSourceSurface?.("teams_message_extension");
    requestContextService.markRequestContextAsAction?.();
    const payload = await resolveTeamsMessageExtensionOpen(String(req.query.token));
    const targetUrl = buildTeamsEmbeddedAppUrl(payload.deep_link);
    await withClientTransaction(payload.tenant_id, payload.user_id, async (client) => {
      await logTeamsMessageExtensionOpen(client, payload);
      return null;
    });
    return res.redirect(302, targetUrl);
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/teams/message-extension/telemetry",
  requireAuth,
  requireAction("dashboard.read"),
  requireIntegrationGovernanceAccess,
  validateQuery(teamsMessageExtensionTelemetryQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listTeamsMessageExtensionTelemetry(client, auth, req.query.limit ? Number(req.query.limit) : 50)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/teams/operational-alerts", requireAuth, requireAction("dashboard.read"), requireIntegrationGovernanceAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => getOperationalAlertAdminPayload(client, auth));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/teams/operational-alerts/deliveries",
  requireAuth,
  requireAction("dashboard.read"),
  requireIntegrationGovernanceAccess,
  validateQuery(
    z.object({
      status: operationalAlertStatusSchema.optional(),
      limit: z.coerce.number().int().min(1).max(200).optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listOperationalAlertDeliveries(client, auth, {
          status: req.query.status ? (String(req.query.status) as "queued" | "throttled" | "sent" | "failed") : null,
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
  "/teams/operational-alerts/routes",
  requireAuth,
  requireAction("schedule.manage"),
  requireElevatedSession,
  requireIntegrationGovernanceManageAccess,
  validateBody(operationalAlertRouteBodySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createOperationalAlertRoute(client, auth, {
          alert_type: req.body.alert_type,
          delivery_channel: req.body.delivery_channel,
          route_name: req.body.route_name,
          destination_label: req.body.destination_label,
          destination_config: req.body.destination_config,
          severity_threshold: req.body.severity_threshold,
          throttle_window_minutes: req.body.throttle_window_minutes,
          enabled: req.body.enabled
        })
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/teams/operational-alerts/routes/:id",
  requireAuth,
  requireAction("schedule.manage"),
  requireElevatedSession,
  requireIntegrationGovernanceManageAccess,
  validateBody(operationalAlertRouteUpdateBodySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateOperationalAlertRoute(client, auth, String(req.params.id), req.body)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/sync-operations",
  requireAuth,
  requireAction("schedule.manage"),
  validateQuery(
    z.object({
      provider: z.enum(["outlook", "monday", "microsoft365_workspace", "microsoft365_mail_automation"]).optional(),
      status: z.enum(["pending", "processing", "succeeded", "failed", "conflict"]).optional(),
      entity_type: z.string().optional(),
      entity_id: z.string().uuid().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const rows = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listIntegrationSyncOperations(client, auth, {
          provider: req.query.provider ? String(req.query.provider) : null,
          status: req.query.status ? String(req.query.status) : null,
          entityType: req.query.entity_type ? String(req.query.entity_type) : null,
          entityId: req.query.entity_id ? String(req.query.entity_id) : null
        })
      );
      return res.json(rows);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/sync-operations/:id/replay", requireAuth, requireAction("schedule.manage"), requireElevatedSession, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const operation = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      replayIntegrationSyncOperation(client, auth, String(req.params.id))
    );
    return res.status(202).json(operation);
  } catch (error) {
    return next(error);
  }
});

function sanitizeWebhookHeaders(headers: IncomingHttpHeaders) {
  const sanitized: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key.toLowerCase();
    if (!["content-type", "user-agent", "idempotency-key", "x-request-id"].includes(normalizedKey)) {
      continue;
    }
    if (typeof value === "string" || Array.isArray(value)) {
      sanitized[normalizedKey] = value;
    }
  }
  return sanitized;
}

function extractMicrosoftGraphWebhookNotifications(body: unknown) {
  const normalizedBody = normalizeWebhookPayloadBody(body);
  const rawNotifications = Array.isArray(normalizedBody.value) ? normalizedBody.value : [];
  return rawNotifications.filter(
    (notification): notification is Record<string, unknown> => Boolean(notification) && typeof notification === "object" && !Array.isArray(notification)
  );
}

function hasExpectedMicrosoftGraphClientState(body: unknown, expectedClientState: string) {
  const notifications = extractMicrosoftGraphWebhookNotifications(body);
  if (!notifications.length) {
    return false;
  }
  return notifications.every(
    (notification) => typeof notification.clientState === "string" && notification.clientState === expectedClientState
  );
}

function resolveSharedSecretWebhookVerificationMode(req: Request) {
  if (config.WEBHOOK_SHARED_SECRET) {
    if (req.header("X-PMC-Webhook-Secret") !== config.WEBHOOK_SHARED_SECRET) {
      return {
        accepted: false,
        status: 401,
        message: "Invalid webhook credentials",
        mode: "rejected"
      } as const;
    }
    return {
      accepted: true,
      status: 202,
      message: "verified",
      mode: "shared_secret"
    } as const;
  }

  if (config.NODE_ENV === "production") {
    return {
      accepted: false,
      status: 503,
      message: "Webhook verification is not configured for production",
      mode: "rejected"
    } as const;
  }

  return {
    accepted: true,
    status: 202,
    message: "accepted for local development",
    mode: "development_unverified"
  } as const;
}

function resolveMicrosoftGraphWebhookVerificationMode(req: Request) {
  if (config.WEBHOOK_SHARED_SECRET && req.header("X-PMC-Webhook-Secret") === config.WEBHOOK_SHARED_SECRET) {
    return {
      accepted: true,
      status: 202,
      message: "verified",
      mode: "shared_secret"
    } as const;
  }

  const expectedClientState = config.MICROSOFT_GRAPH_WEBHOOK_CLIENT_STATE.trim();
  if (expectedClientState.length > 0) {
    if (!hasExpectedMicrosoftGraphClientState(req.body, expectedClientState)) {
      return {
        accepted: false,
        status: 401,
        message: "Invalid Microsoft Graph webhook client state",
        mode: "rejected"
      } as const;
    }
    return {
      accepted: true,
      status: 202,
      message: "verified",
      mode: "graph_client_state"
    } as const;
  }

  if (config.WEBHOOK_SHARED_SECRET && req.header("X-PMC-Webhook-Secret")) {
    return {
      accepted: false,
      status: 401,
      message: "Invalid webhook credentials",
      mode: "rejected"
    } as const;
  }

  if (config.NODE_ENV === "production") {
    return {
      accepted: false,
      status: 503,
      message: "Microsoft Graph webhook verification is not configured for production",
      mode: "rejected"
    } as const;
  }

  return {
    accepted: true,
    status: 202,
    message: "accepted for local development",
    mode: "development_unverified"
  } as const;
}

function normalizeWebhookPayloadBody(body: unknown): Record<string, unknown> {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  if (Array.isArray(body)) {
    return { items: body };
  }
  return { value: body ?? null };
}

function safeSerializeWebhookBody(body: unknown) {
  return JSON.stringify(body ?? null);
}

function hashWebhookBody(serializedBody: string) {
  return createHash("sha256").update(serializedBody).digest("hex");
}

function requireIntegrationGovernanceAccess(req: Request, res: Response, next: NextFunction) {
  const auth = (req as AuthenticatedRequest).auth;
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    return next();
  }
  return res.status(403).json({ error: "Forbidden" });
}

function requireIntegrationGovernanceManageAccess(req: Request, res: Response, next: NextFunction) {
  const auth = (req as AuthenticatedRequest).auth;
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    return next();
  }
  return res.status(403).json({ error: "Forbidden" });
}

export default router;
