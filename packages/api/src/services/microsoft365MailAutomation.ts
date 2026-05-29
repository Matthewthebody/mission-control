import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { z } from "zod";
import { hasAuthorityTier } from "../authz/authority.js";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  Microsoft365MailAutomationArtifact,
  Microsoft365MailAutomationBaseline,
  Microsoft365MailAutomationCurrentStateFinding,
  Microsoft365MailAutomationDeliveryRecord,
  Microsoft365MailAutomationDiagnosticsResponse,
  Microsoft365MailAutomationDocReference,
  Microsoft365MailAutomationEnvironment,
  Microsoft365MailAutomationEventRecord,
  Microsoft365MailAutomationGoNoGo,
  Microsoft365MailAutomationRecordType,
  Microsoft365MailAutomationRefactorItem,
  Microsoft365MailAutomationStatus,
  Microsoft365MailAutomationTriggerType,
  Microsoft365MailAutomationValidationIssue,
  Microsoft365SenderAliasRule,
  Microsoft365SharedMailboxContractRecord,
  Microsoft365MailTemplateContractRecord,
  Microsoft365MailTemplateDefinition,
  QueueMicrosoft365MailAutomationDeliveryInput,
  RecordMicrosoft365MailAutomationCallbackInput
} from "../types/microsoft365MailAutomation.js";
import { resolveApiRepoPath } from "../utils/repoPaths.js";
import { createAuditLog } from "./audit.js";
import {
  getIntegrationSyncOperation,
  markIntegrationSyncOperationFailed,
  markIntegrationSyncOperationSucceeded,
  queueIntegrationSyncOperation,
  type IntegrationProvider
} from "./integrationSync.js";
import { getMicrosoft365GovernanceValidationIssues } from "./microsoft365Governance.js";
import { getMicrosoft365OperatingSystemValidationIssues } from "./microsoft365OperatingSystem.js";
import { getMicrosoft365ProvisioningValidationIssues } from "./microsoft365Provisioning.js";
import { recordMicrosoftIntegrationEvent } from "./microsoftIntegrationObservability.js";

const environmentSchema = z.enum(["development", "staging", "production"]);
const recordTypeSchema = z.enum([
  "organization",
  "job",
  "job_readiness_item",
  "post_shoot_evaluation",
  "work_task",
  "operational_approval_request",
  "communication_event"
]);
const triggerTypeSchema = z.enum(["kickoff", "reminder", "overdue", "confirmation", "approval_request", "escalation", "manual"]);
const storageTypeSchema = z.enum(["sharepoint_file", "sharepoint_list_item"]);
const statusSchema = z.enum(["queued", "dispatching", "flow_accepted", "sent", "failed", "skipped", "throttled", "archived"]);
const callbackStatusSchema = z.enum(["sent", "failed", "skipped"]);
const eventTypeSchema = z.enum([
  "queued",
  "dispatching",
  "flow_accepted",
  "sent",
  "failed",
  "skipped",
  "throttled",
  "replayed",
  "callback_received",
  "alerted"
]);

const baselineSchema = z.object({
  phase: z.literal("phase4_shared_mailboxes_templates_email_automation"),
  baseline_version: z.string().trim().min(1),
  environment: environmentSchema,
  tenant_tier: z.enum(["sandbox", "preproduction", "production"]),
  shared_mailboxes: z
    .array(
      z.object({
        mailbox_key: z.string().trim().min(1),
        display_name: z.string().trim().min(1),
        alias_address: z.string().trim().email(),
        department_scope: z.string().trim().min(1).nullable(),
        mailbox_purpose: z.string().trim().min(1),
        send_as_mode: z.literal("shared_mailbox"),
        fallback_mailbox_key: z.string().trim().min(1).nullable(),
        owner_groups: z.array(z.string().trim().min(1)).min(1),
        member_groups: z.array(z.string().trim().min(1)).min(1),
        allowed_trigger_types: z.array(triggerTypeSchema).min(1),
        notes: z.string().trim().min(1).nullable().optional()
      })
    )
    .min(1),
  sender_alias_rules: z
    .array(
      z.object({
        key: z.string().trim().min(1),
        applies_to_record_types: z.array(recordTypeSchema).min(1),
        department_scope: z.string().trim().min(1).nullable(),
        trigger_types: z.array(triggerTypeSchema).min(1),
        shared_mailbox_key: z.string().trim().min(1),
        resolution_rule: z.string().trim().min(1),
        notes: z.string().trim().min(1).nullable().optional()
      })
    )
    .min(1),
  template_library: z.object({
    site_url: z.string().trim().url(),
    library_name: z.string().trim().min(1),
    folder_path_pattern: z.string().trim().min(1),
    dashboard_source_of_truth_rule: z.string().trim().min(1),
    edit_model: z.string().trim().min(1),
    metadata_columns: z
      .array(
        z.object({
          internal_name: z.string().trim().min(1),
          display_name: z.string().trim().min(1),
          field_type: z.string().trim().min(1),
          required: z.boolean(),
          dashboard_source_field: z.string().trim().min(1),
          notes: z.string().trim().min(1)
        })
      )
      .min(1)
  }),
  template_schema: z
    .array(
      z.object({
        template_key: z.string().trim().min(1),
        template_name: z.string().trim().min(1),
        template_family: z.string().trim().min(1),
        department_scope: z.string().trim().min(1).nullable(),
        shared_mailbox_key: z.string().trim().min(1),
        storage_provider: storageTypeSchema,
        storage_path: z.string().trim().min(1),
        template_url: z.string().trim().url(),
        subject_hint: z.string().trim().min(1),
        merge_tokens: z
          .array(
            z.object({
              key: z.string().trim().min(1),
              required: z.boolean(),
              source_rule: z.string().trim().min(1),
              notes: z.string().trim().min(1)
            })
          )
          .min(1),
        notes: z.string().trim().min(1)
      })
    )
    .min(1),
  flow_inventory: z
    .array(
      z.object({
        flow_key: z.string().trim().min(1),
        trigger_type: triggerTypeSchema,
        shared_mailbox_key: z.string().trim().min(1),
        template_key: z.string().trim().min(1),
        related_record_types: z.array(recordTypeSchema).min(1),
        power_automate_owner: z.string().trim().min(1),
        callback_required: z.boolean(),
        failure_alert_target: z.string().trim().min(1),
        retry_rule: z.string().trim().min(1),
        notes: z.string().trim().min(1)
      })
    )
    .min(1),
  logging_and_monitoring: z.object({
    queue_of_record: z.string().trim().min(1),
    callback_route: z.string().trim().min(1),
    failure_queue_rule: z.string().trim().min(1),
    alerting_rule: z.string().trim().min(1),
    retention_rule: z.string().trim().min(1),
    reconciliation_rule: z.string().trim().min(1)
  }),
  execution_order: z
    .array(
      z.object({
        order: z.number().int().positive(),
        title: z.string().trim().min(1),
        owner: z.string().trim().min(1),
        requires_tenant_admin: z.boolean(),
        rollback: z.string().trim().min(1)
      })
    )
    .min(1),
  manual_admin_checklist: z
    .array(
      z.object({
        order: z.number().int().positive(),
        step: z.string().trim().min(1),
        portal: z.string().trim().min(1).nullable(),
        requires_tenant_admin: z.boolean(),
        owner: z.string().trim().min(1)
      })
    )
    .min(1),
  validation_checklist: z.array(z.string().trim().min(1)).min(1),
  rollback_principles: z.array(z.string().trim().min(1)).min(1)
});

type DeliveryRow = Microsoft365MailAutomationDeliveryRecord;
type EventRow = Microsoft365MailAutomationEventRecord;

type ContractSyncResult = {
  baseline_environment: Microsoft365MailAutomationEnvironment;
  baseline_version: string;
  mailbox_contracts_synced: number;
  template_contracts_synced: number;
};

type MailContext = {
  recordType: Microsoft365MailAutomationRecordType;
  recordId: string;
  canonicalDashboardId: string;
  dashboardUrl: string | null;
  departmentScope: string | null;
  relatedEntityLabel: string | null;
  contactId: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  mergeContext: Record<string, string>;
};

type CallbackRouteRecord = {
  id: string;
  tenant_id: string;
  related_record_type: Microsoft365MailAutomationRecordType;
  related_record_id: string;
  canonical_dashboard_id: string | null;
  shared_mailbox_key: string;
  sender_alias: string;
  flow_key: string;
  status: Microsoft365MailAutomationStatus;
  template_key: string;
  recipient_email: string;
  sync_operation_id: string | null;
};

const DOCS: Microsoft365MailAutomationDocReference[] = [
  {
    key: "phase_summary",
    title: "Phase 4 Shared Mailboxes, Templates, and Email Automation",
    path: "docs/microsoft365/phase4-shared-mailboxes-templates-email-automation.md",
    summary: "Primary phase audit, mailbox model, template design, flow inventory, logging contract, and rollout guidance."
  },
  {
    key: "send_model",
    title: "Shared Mailbox Send Model",
    path: "docs/microsoft365/shared-mailbox-send-model.md",
    summary: "Department alias strategy, sender resolution rules, and fallback behavior."
  },
  {
    key: "template_library",
    title: "Email Template Library Schema",
    path: "docs/microsoft365/email-template-library-schema.md",
    summary: "SharePoint-backed template storage, metadata columns, and merge-token ownership rules."
  },
  {
    key: "flow_inventory",
    title: "Power Automate Email Flow Inventory",
    path: "docs/microsoft365/power-automate-email-flow-inventory.md",
    summary: "Kickoff, reminder, overdue, confirmation, approval, and escalation flow design plus monitoring ownership."
  }
];

const ARTIFACTS: Microsoft365MailAutomationArtifact[] = [
  {
    kind: "baseline",
    path: "ops/microsoft365/phase4/mail-automation-baseline.development.json",
    summary: "Development baseline for shared mailboxes, template pointers, and Power Automate email flows.",
    tenant_admin_action: false
  },
  {
    kind: "baseline",
    path: "ops/microsoft365/phase4/mail-automation-baseline.staging.json",
    summary: "Staging baseline used for pilot mailbox routing and flow validation.",
    tenant_admin_action: false
  },
  {
    kind: "baseline",
    path: "ops/microsoft365/phase4/mail-automation-baseline.production.json",
    summary: "Production baseline for team-owned client email automation.",
    tenant_admin_action: false
  },
  {
    kind: "script",
    path: "ops/microsoft365/phase4/Test-M365MailAutomationBaseline.ps1",
    summary: "Validates the Phase 4 mail automation baseline, required flow endpoints, and callback posture without changing the tenant.",
    tenant_admin_action: true
  },
  {
    kind: "script",
    path: "ops/microsoft365/phase4/Get-M365MailAutomationPlan.ps1",
    summary: "Renders the mailbox, template, and flow plan for an environment or trigger family.",
    tenant_admin_action: false
  },
  {
    kind: "api",
    path: "GET /api/admin/system/microsoft-email-automation",
    summary: "Admin diagnostics payload for the shared mailbox and email automation layer.",
    tenant_admin_action: false
  }
];

function resolveEnvironment(): Microsoft365MailAutomationEnvironment {
  if (config.MICROSOFT_365_MAIL_AUTOMATION_ENV) {
    return config.MICROSOFT_365_MAIL_AUTOMATION_ENV;
  }
  if (config.NODE_ENV === "production") {
    return "production";
  }
  return "development";
}

function getBaselinePath(environment: Microsoft365MailAutomationEnvironment) {
  return resolveApiRepoPath("ops", "microsoft365", "phase4", `mail-automation-baseline.${environment}.json`);
}

function loadBaseline(environment = resolveEnvironment()): Microsoft365MailAutomationBaseline {
  const raw = readFileSync(getBaselinePath(environment), "utf8");
  const parsed = baselineSchema.parse(JSON.parse(raw));
  if (parsed.environment !== environment) {
    throw new Error(`Microsoft 365 mail automation baseline environment mismatch: expected ${environment}, found ${parsed.environment}.`);
  }
  return parsed;
}

function addIssue(issues: Microsoft365MailAutomationValidationIssue[], issue: Microsoft365MailAutomationValidationIssue) {
  issues.push(issue);
}

function determineRecommendation(issues: Microsoft365MailAutomationValidationIssue[]): Microsoft365MailAutomationGoNoGo {
  if (issues.some((issue) => issue.severity === "error")) {
    return "no_go";
  }
  if (issues.length > 0) {
    return "conditional_go";
  }
  return "go";
}

function buildCurrentStateFindings(): Microsoft365MailAutomationCurrentStateFinding[] {
  return [
    {
      key: "microsoft_sync_and_observability_exist",
      state: "existing",
      summary:
        "The repo already has reusable integration sync queueing, replay, Microsoft diagnostics, and provisioning/backlink patterns that Phase 4 can reuse.",
      evidence: [
        "packages/api/src/services/integrationSync.ts",
        "packages/api/src/services/microsoftIntegrationObservability.ts",
        "packages/api/src/services/microsoft365Provisioning.ts",
        "packages/worker/src/handlers/appEventHandler.ts"
      ]
    },
    {
      key: "outlook_support_is_person_oriented",
      state: "partial",
      summary:
        "The existing Outlook integration is calendar and user-account oriented, but it is not a team-owned shared mailbox automation model.",
      evidence: [
        "packages/api/src/services/outlook.ts",
        "packages/api/src/services/outlookCalendarSync.ts",
        "packages/api/src/routes/outlook.ts"
      ],
      recommended_refactor: "Do not layer production client automation on personal mailbox or personal OAuth assumptions."
    },
    {
      key: "sales_templates_exist_but_are_localized",
      state: "partial",
      summary:
        "The sales pipeline already has merge-token email templates and delivery logging, but those templates are database-local, scoped to sales, and not shared-mailbox driven.",
      evidence: [
        "db/migrations/050_sales_pipeline_email_phase4.sql",
        "packages/api/src/services/salesPipeline.ts"
      ],
      recommended_refactor:
        "Keep the sales implementation as a domain-specific precursor, but do not reuse it as the platform-wide client email architecture."
    },
    {
      key: "shared_mailbox_governance_exists_but_no_runtime_contract",
      state: "partial",
      summary:
        "Shared mailbox governance and Power Automate governance were documented in Phase 1, but there was no runtime contract for mailbox selection, template storage, callback logging, or send attempt traceability.",
      evidence: [
        "docs/microsoft365/shared-mailbox-governance.md",
        "docs/microsoft365/power-automate-governance.md"
      ]
    },
    {
      key: "editable_template_library_contract_missing",
      state: "missing",
      summary:
        "Before this phase there was no governed SharePoint-backed template contract that let operators edit client email templates without code changes while preserving dashboard-owned merge-token semantics.",
      evidence: ["ops/microsoft365/phase2/operating-system-baseline.production.json"]
    },
    {
      key: "send_attempt_logging_was_not_centralized",
      state: "missing",
      summary:
        "There was no shared Microsoft-facing delivery log for client-facing automated emails that captured queue, dispatch, callback, failure, and replay outcomes.",
      evidence: [
        "packages/api/src/services/outlook.ts",
        "packages/worker/src/notifications/emailStub.ts"
      ]
    }
  ];
}

function buildRefactorFirst(): Microsoft365MailAutomationRefactorItem[] {
  return [
    {
      key: "remove_personal_inbox_assumptions",
      severity: "high",
      summary: "Production client sends must not depend on personal mailbox identity or local SMTP stub behavior.",
      consequence: "Ownership drift, audit ambiguity, and offboarding risk will remain if client email is person-dependent."
    },
    {
      key: "do_not_reuse_sales_templates_as_platform_source",
      severity: "high",
      summary: "Sales email templates and logs are a useful pattern reference, but they are not the right global contract for client operations mail automation.",
      consequence: "Platform email behavior will become inconsistent and hard to govern if domain-local template tables become the de facto standard."
    },
    {
      key: "keep_power_automate_out_of_system_of_record",
      severity: "medium",
      summary: "Power Automate should orchestrate send execution and callbacks, not own project state, approval state, or contact truth.",
      consequence: "Field ownership will drift if flows are allowed to invent or mutate dashboard lifecycle data."
    }
  ];
}

function parseRecordId(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

function buildCanonicalDashboardId(recordType: Microsoft365MailAutomationRecordType, recordId: string) {
  switch (recordType) {
    case "organization":
      return `client:${recordId}`;
    case "job":
      return `project:${recordId}`;
    case "job_readiness_item":
      return `required_item:${recordId}`;
    case "post_shoot_evaluation":
      return `submission:${recordId}`;
    case "work_task":
      return `task:${recordId}`;
    case "operational_approval_request":
      return `approval_request:${recordId}`;
    case "communication_event":
      return `communication_event:${recordId}`;
    default:
      return `${recordType}:${recordId}`;
  }
}

function buildDashboardUrl(recordType: Microsoft365MailAutomationRecordType, recordId: string, jobId?: string | null) {
  if (!config.ADMIN_WEB_URL) {
    return null;
  }
  const base = config.ADMIN_WEB_URL.replace(/\/$/, "");
  switch (recordType) {
    case "organization":
      return `${base}/#directory/organizations/${recordId}`;
    case "job":
      return `${base}/#jobs/${recordId}`;
    case "job_readiness_item":
      return jobId ? `${base}/#jobs/${jobId}` : null;
    case "work_task":
      return `${base}/#tasks/${recordId}`;
    case "operational_approval_request":
      return `${base}/#approvals`;
    default:
      return null;
  }
}

function normalizeStringMap(input?: Record<string, string | null | undefined>) {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (typeof value === "string" && value.trim()) {
      output[key] = value.trim();
    }
  }
  return output;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString().slice(0, 10);
}

function getRequiredTokens(template: Microsoft365MailTemplateDefinition) {
  return template.merge_tokens.filter((token) => token.required).map((token) => token.key);
}

function buildMailAutomationSyncEnvelope(input: {
  recordType: Microsoft365MailAutomationRecordType;
  recordId: string;
  canonicalDashboardId: string | null;
  sharedMailboxKey: string;
  senderAlias: string;
  recipientEmail: string;
  deliveryId?: string | null;
  providerMessageId?: string | null;
  providerMessageUrl?: string | null;
  flowRunId?: string | null;
  flowRunUrl?: string | null;
  callbackStatus?: Extract<Microsoft365MailAutomationStatus, "sent" | "failed" | "skipped"> | null;
  occurredAt?: string | null;
  retryState: "pending_dispatch" | "dispatching" | "awaiting_callback" | "none" | "manual_retry_required";
  providerAccepted: boolean;
  deliveryConfirmed: boolean;
}) {
  return {
    source_object: {
      type: input.recordType,
      id: input.recordId,
      canonical_dashboard_id: input.canonicalDashboardId ?? null
    },
    target_object: {
      type: "microsoft365_mail_delivery" as const,
      id: input.deliveryId ?? null,
      owner_email: input.senderAlias,
      recipient_email: input.recipientEmail,
      shared_mailbox_key: input.sharedMailboxKey,
      provider_message_id: input.providerMessageId ?? null,
      provider_message_url: input.providerMessageUrl ?? null,
      flow_run_id: input.flowRunId ?? null,
      flow_run_url: input.flowRunUrl ?? null
    },
    sync_state: {
      last_attempted_sync_at: input.occurredAt ?? null,
      last_successful_sync_at: input.deliveryConfirmed ? input.occurredAt ?? null : null,
      last_failed_sync_at:
        input.callbackStatus && !input.deliveryConfirmed ? input.occurredAt ?? null : null,
      retry_state: input.retryState,
      provider_accepted: input.providerAccepted,
      delivery_confirmed: input.deliveryConfirmed,
      callback_status: input.callbackStatus ?? null
    }
  };
}

function deriveMailAutomationDeliveryRetryState(
  status: Microsoft365MailAutomationStatus
): "pending_dispatch" | "dispatching" | "awaiting_callback" | "none" | "manual_retry_required" {
  switch (status) {
    case "queued":
      return "pending_dispatch";
    case "dispatching":
      return "dispatching";
    case "flow_accepted":
      return "awaiting_callback";
    case "sent":
    case "archived":
      return "none";
    case "failed":
    case "skipped":
    case "throttled":
      return "manual_retry_required";
    default:
      return "manual_retry_required";
  }
}

export function buildMailAutomationDeliverySyncView(
  delivery: Pick<
    DeliveryRow,
    | "id"
    | "related_record_type"
    | "related_record_id"
    | "canonical_dashboard_id"
    | "shared_mailbox_key"
    | "sender_alias"
    | "recipient_email"
    | "status"
    | "microsoft_message_id"
    | "microsoft_message_url"
    | "flow_run_id"
    | "flow_run_url"
    | "queued_at"
    | "last_dispatched_at"
    | "sent_at"
    | "last_error_at"
  >
) {
  const callbackStatus =
    delivery.status === "sent" || delivery.status === "failed" || delivery.status === "skipped" ? delivery.status : null;
  const providerAccepted = delivery.status === "flow_accepted" || delivery.status === "sent" || Boolean(delivery.flow_run_id);
  const deliveryConfirmed = delivery.status === "sent";
  const occurredAt = delivery.sent_at ?? delivery.last_error_at ?? delivery.last_dispatched_at ?? delivery.queued_at ?? null;

  return buildMailAutomationSyncEnvelope({
    recordType: delivery.related_record_type,
    recordId: delivery.related_record_id,
    canonicalDashboardId: delivery.canonical_dashboard_id,
    sharedMailboxKey: delivery.shared_mailbox_key,
    senderAlias: delivery.sender_alias,
    recipientEmail: delivery.recipient_email,
    deliveryId: delivery.id,
    providerMessageId: delivery.microsoft_message_id ?? null,
    providerMessageUrl: delivery.microsoft_message_url ?? null,
    flowRunId: delivery.flow_run_id ?? null,
    flowRunUrl: delivery.flow_run_url ?? null,
    callbackStatus,
    occurredAt,
    retryState: deriveMailAutomationDeliveryRetryState(delivery.status),
    providerAccepted,
    deliveryConfirmed
  });
}

function decorateMailAutomationDeliveryRow(row: DeliveryRow, events: EventRow[] = []) {
  return {
    ...row,
    ...buildMailAutomationDeliverySyncView(row),
    events
  };
}

export function deriveMailAutomationCallbackSyncOutcome(input: {
  deliveryId: string;
  recordType: Microsoft365MailAutomationRecordType;
  recordId: string;
  canonicalDashboardId: string | null;
  sharedMailboxKey: string;
  senderAlias: string;
  recipientEmail: string;
  status: Extract<Microsoft365MailAutomationStatus, "sent" | "failed" | "skipped">;
  providerMessageId?: string | null;
  providerMessageUrl?: string | null;
  flowRunId?: string | null;
  flowRunUrl?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  occurredAt?: string;
}) {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const deliveryConfirmed = input.status === "sent";
  const defaultErrorMessage =
    input.status === "skipped"
      ? "Power Automate skipped the client email send."
      : "Power Automate reported a client email send failure.";

  const resultPayload = {
    callback_status: input.status,
    error_code: input.errorCode ?? null,
    error_message: input.errorMessage ?? null,
    provider_message_id: input.providerMessageId ?? null,
    provider_message_url: input.providerMessageUrl ?? null,
    flow_run_id: input.flowRunId ?? null,
    flow_run_url: input.flowRunUrl ?? null,
    ...buildMailAutomationSyncEnvelope({
      recordType: input.recordType,
      recordId: input.recordId,
      canonicalDashboardId: input.canonicalDashboardId,
      sharedMailboxKey: input.sharedMailboxKey,
      senderAlias: input.senderAlias,
      recipientEmail: input.recipientEmail,
      deliveryId: input.deliveryId,
      providerMessageId: input.providerMessageId ?? null,
      providerMessageUrl: input.providerMessageUrl ?? null,
      flowRunId: input.flowRunId ?? null,
      flowRunUrl: input.flowRunUrl ?? null,
      callbackStatus: input.status,
      occurredAt,
      retryState: deliveryConfirmed ? "none" : "manual_retry_required",
      providerAccepted: deliveryConfirmed || Boolean(input.flowRunId),
      deliveryConfirmed
    })
  };

  return {
    occurredAt,
    syncStatus: deliveryConfirmed ? ("succeeded" as const) : ("failed" as const),
    errorMessage: deliveryConfirmed ? null : input.errorMessage ?? defaultErrorMessage,
    resultPayload
  };
}

function findMailbox(baseline: Microsoft365MailAutomationBaseline, mailboxKey: string) {
  const mailbox = baseline.shared_mailboxes.find((item) => item.mailbox_key === mailboxKey);
  if (!mailbox) {
    throw new ApiError(500, `Shared mailbox ${mailboxKey} is not defined in the active Phase 4 baseline.`);
  }
  return mailbox;
}

function findTemplate(baseline: Microsoft365MailAutomationBaseline, templateKey: string) {
  const template = baseline.template_schema.find((item) => item.template_key === templateKey);
  if (!template) {
    throw new ApiError(404, `Mail template ${templateKey} is not defined in the active Phase 4 baseline.`);
  }
  return template;
}

function resolveFlow(
  baseline: Microsoft365MailAutomationBaseline,
  input: {
    recordType: Microsoft365MailAutomationRecordType;
    triggerType: Microsoft365MailAutomationTriggerType;
    templateKey: string;
  }
) {
  const flow = baseline.flow_inventory.find(
    (item) =>
      item.trigger_type === input.triggerType &&
      item.template_key === input.templateKey &&
      item.related_record_types.includes(input.recordType)
  );
  if (!flow) {
    throw new ApiError(
      400,
      `No Power Automate flow is defined for ${input.recordType}, ${input.triggerType}, and template ${input.templateKey}.`
    );
  }
  return flow;
}

function selectSenderAliasRule(
  rules: Microsoft365SenderAliasRule[],
  input: {
    recordType: Microsoft365MailAutomationRecordType;
    triggerType: Microsoft365MailAutomationTriggerType;
    departmentScope: string | null;
  }
) {
  const matching = rules
    .filter(
      (rule) =>
        rule.applies_to_record_types.includes(input.recordType) &&
        rule.trigger_types.includes(input.triggerType) &&
        (rule.department_scope === input.departmentScope || rule.department_scope === null)
    )
    .sort((left, right) => {
      const leftSpecific = left.department_scope ? 1 : 0;
      const rightSpecific = right.department_scope ? 1 : 0;
      return rightSpecific - leftSpecific;
    });
  return matching[0] ?? null;
}

function ensureRequiredTemplateTokens(template: Microsoft365MailTemplateDefinition, mergeContext: Record<string, string>) {
  const missing = template.merge_tokens
    .filter((token) => token.required)
    .filter((token) => !mergeContext[token.key])
    .map((token) => token.key);
  if (missing.length > 0) {
    throw new ApiError(
      400,
      `Mail template ${template.template_key} is missing required merge token values: ${missing.join(", ")}.`
    );
  }
}

function getFlowEndpoint(flowKey: string) {
  return config.MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS[flowKey] ?? null;
}

async function recordDeliveryEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    deliveryId: string;
    eventType: z.infer<typeof eventTypeSchema>;
    actorUserId?: string | null;
    note?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const { rows } = await client.query<EventRow>(
    `
      INSERT INTO microsoft_mail_automation_event (
        tenant_id,
        delivery_id,
        event_type,
        actor_user_id,
        note,
        metadata
      )
      VALUES ($1,$2,$3::microsoft_mail_automation_event_type,$4,$5,$6::jsonb)
      RETURNING
        id::text,
        tenant_id::text,
        delivery_id::text,
        event_type::text,
        actor_user_id::text,
        note,
        metadata,
        occurred_at::text,
        created_at::text
    `,
    [input.tenantId, input.deliveryId, input.eventType, input.actorUserId ?? null, input.note ?? null, JSON.stringify(input.metadata ?? {})]
  );
  return rows[0];
}

async function loadDelivery(client: PoolClient, tenantId: string, deliveryId: string) {
  const { rows } = await client.query<DeliveryRow>(
    `
      SELECT
        id::text,
        tenant_id::text,
        provider,
        related_record_type::text,
        related_record_id,
        canonical_dashboard_id,
        contact_id::text,
        recipient_name,
        recipient_email,
        shared_mailbox_key,
        sender_alias,
        template_key,
        template_url,
        flow_key,
        trigger_type::text,
        status::text,
        subject_hint,
        merge_context,
        dashboard_url,
        microsoft_message_id,
        microsoft_message_url,
        flow_run_id,
        flow_run_url,
        sync_operation_id::text,
        source_change_key,
        attempt_count,
        queued_at::text,
        first_dispatched_at::text,
        last_dispatched_at::text,
        sent_at::text,
        last_error,
        last_error_at::text,
        metadata,
        created_by_user_id::text,
        updated_by_user_id::text,
        created_at::text,
        updated_at::text
      FROM microsoft_mail_automation_delivery
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
      `,
      [tenantId, deliveryId]
    );
  const row = rows[0] ?? null;
  if (!row) {
    return null;
  }
  const eventsByDelivery = await loadEventsForDeliveries(client, tenantId, [row.id]);
  return decorateMailAutomationDeliveryRow(row, eventsByDelivery.get(row.id) ?? []);
}

async function loadEventsForDeliveries(client: PoolClient, tenantId: string, deliveryIds: string[]) {
  if (!deliveryIds.length) {
    return new Map<string, EventRow[]>();
  }
  const { rows } = await client.query<EventRow>(
    `
      SELECT
        id::text,
        tenant_id::text,
        delivery_id::text,
        event_type::text,
        actor_user_id::text,
        note,
        metadata,
        occurred_at::text,
        created_at::text
      FROM microsoft_mail_automation_event
      WHERE tenant_id = $1
        AND delivery_id = ANY($2::uuid[])
      ORDER BY occurred_at DESC, created_at DESC
    `,
    [tenantId, deliveryIds]
  );
  const map = new Map<string, EventRow[]>();
  for (const row of rows) {
    const list = map.get(row.delivery_id) ?? [];
    if (list.length < 8) {
      list.push(row);
    }
    map.set(row.delivery_id, list);
  }
  return map;
}

async function loadExistingDeliveryBySourceChangeKey(
  client: PoolClient,
  input: { tenantId: string; flowKey: string; sourceChangeKey: string }
) {
  const { rows } = await client.query<DeliveryRow>(
    `
      SELECT
        id::text,
        tenant_id::text,
        provider,
        related_record_type::text,
        related_record_id,
        canonical_dashboard_id,
        contact_id::text,
        recipient_name,
        recipient_email,
        shared_mailbox_key,
        sender_alias,
        template_key,
        template_url,
        flow_key,
        trigger_type::text,
        status::text,
        subject_hint,
        merge_context,
        dashboard_url,
        microsoft_message_id,
        microsoft_message_url,
        flow_run_id,
        flow_run_url,
        sync_operation_id::text,
        source_change_key,
        attempt_count,
        queued_at::text,
        first_dispatched_at::text,
        last_dispatched_at::text,
        sent_at::text,
        last_error,
        last_error_at::text,
        metadata,
        created_by_user_id::text,
        updated_by_user_id::text,
        created_at::text,
        updated_at::text
      FROM microsoft_mail_automation_delivery
      WHERE tenant_id = $1
        AND flow_key = $2
        AND source_change_key = $3
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [input.tenantId, input.flowKey, input.sourceChangeKey]
  );
  return rows[0] ?? null;
}

async function resolveOrganizationContact(
  client: PoolClient,
  tenantId: string,
  input: {
    organizationId: string;
    contactId?: string | null;
  }
) {
  const { rows } = await client.query<{
    id: string;
    full_name: string | null;
    email: string | null;
  }>(
    `
      SELECT
        c.id::text,
        c.full_name,
        c.email
      FROM organization_contact c
      LEFT JOIN organization_contact_relationship rel
        ON rel.tenant_id = c.tenant_id
       AND rel.organization_id = c.organization_id
       AND rel.contact_id = c.id
      WHERE c.tenant_id = $1
        AND c.organization_id = $2::uuid
        AND c.active_status = 'active'::directory_active_status
        AND c.email IS NOT NULL
        AND ($3::uuid IS NULL OR c.id = $3::uuid)
      ORDER BY
        CASE WHEN c.id = $3::uuid THEN 0 ELSE 1 END,
        CASE WHEN rel.is_primary THEN 0 ELSE 1 END,
        c.created_at ASC
      LIMIT 1
    `,
    [tenantId, input.organizationId, input.contactId ?? null]
  );
  return rows[0] ?? null;
}

async function resolveMailContext(
  client: PoolClient,
  tenantId: string,
  input: QueueMicrosoft365MailAutomationDeliveryInput
): Promise<MailContext> {
  if (input.related_record_type === "organization") {
    const { rows } = await client.query<{
      id: string;
      display_name: string | null;
    }>(
      `
        SELECT id::text, display_name
        FROM organization
        WHERE tenant_id = $1
          AND id = $2::uuid
        LIMIT 1
      `,
      [tenantId, input.related_record_id]
    );
    const organization = rows[0];
    if (!organization) {
      throw new ApiError(404, "Organization not found.");
    }
    const contact = await resolveOrganizationContact(client, tenantId, {
      organizationId: organization.id,
      contactId: input.contact_id ?? null
    });
    const mergeContext = {
      client_name: organization.display_name ?? "Client",
      project_name: organization.display_name ?? "Client",
      project_number: "",
      due_date: "",
      missing_items_summary: "",
      secure_link: input.secure_link?.trim() ?? "",
      owner_name: "",
      owner_email: "",
      related_record_type: "organization",
      related_record_id: organization.id
    };
    return {
      recordType: "organization",
      recordId: organization.id,
      canonicalDashboardId: buildCanonicalDashboardId("organization", organization.id),
      dashboardUrl: buildDashboardUrl("organization", organization.id),
      departmentScope: null,
      relatedEntityLabel: organization.display_name,
      contactId: contact?.id ?? input.contact_id ?? null,
      recipientName: input.recipient_name?.trim() || contact?.full_name || null,
      recipientEmail: input.recipient_email?.trim() || contact?.email || null,
      mergeContext
    };
  }

  if (input.related_record_type === "job") {
    const { rows } = await client.query<{
      id: string;
      job_number: string | null;
      title: string | null;
      department_type: string | null;
      client_deadline_at: string | null;
      organization_name: string | null;
      primary_contact_id: string | null;
      primary_contact_name: string | null;
      primary_contact_email: string | null;
      owner_name: string | null;
      owner_email: string | null;
    }>(
      `
        SELECT
          j.id::text,
          j.job_number,
          j.title,
          j.department_type::text,
          j.client_deadline_at::text,
          org.display_name AS organization_name,
          contact.id::text AS primary_contact_id,
          contact.full_name AS primary_contact_name,
          contact.email AS primary_contact_email,
          owner.full_name AS owner_name,
          owner.email AS owner_email
        FROM jobs j
        LEFT JOIN organization org
          ON org.id = j.organization_id
        LEFT JOIN organization_contact contact
          ON contact.id = j.primary_contact_id
        LEFT JOIN app_user owner
          ON owner.id = j.account_owner_user_id
        WHERE j.tenant_id = $1
          AND j.id = $2::uuid
        LIMIT 1
      `,
      [tenantId, input.related_record_id]
    );
    const job = rows[0];
    if (!job) {
      throw new ApiError(404, "Job not found.");
    }
    const { rows: readinessRows } = await client.query<{ label: string | null }>(
      `
        SELECT label
        FROM job_readiness_item
        WHERE tenant_id = $1
          AND job_id = $2::uuid
          AND is_complete = false
        ORDER BY due_at NULLS LAST, created_at ASC
        LIMIT 5
      `,
      [tenantId, job.id]
    );
    const mergeContext = {
      client_name: job.organization_name ?? "Client",
      project_name: job.title ?? job.job_number ?? "Project",
      project_number: job.job_number ?? "",
      due_date: formatDate(job.client_deadline_at),
      missing_items_summary: readinessRows
        .map((row) => row.label?.trim() ?? "")
        .filter(Boolean)
        .join(", "),
      secure_link: input.secure_link?.trim() ?? "",
      owner_name: job.owner_name ?? "",
      owner_email: job.owner_email ?? "",
      related_record_type: "job",
      related_record_id: job.id
    };
    return {
      recordType: "job",
      recordId: job.id,
      canonicalDashboardId: buildCanonicalDashboardId("job", job.id),
      dashboardUrl: buildDashboardUrl("job", job.id),
      departmentScope: job.department_type,
      relatedEntityLabel: job.title ?? job.job_number,
      contactId: input.contact_id ?? job.primary_contact_id ?? null,
      recipientName: input.recipient_name?.trim() || job.primary_contact_name || null,
      recipientEmail: input.recipient_email?.trim() || job.primary_contact_email || null,
      mergeContext
    };
  }

  if (input.related_record_type === "job_readiness_item") {
    const { rows } = await client.query<{
      id: string;
      label: string | null;
      due_at: string | null;
      job_id: string;
      job_number: string | null;
      job_title: string | null;
      department_type: string | null;
      organization_name: string | null;
      primary_contact_id: string | null;
      primary_contact_name: string | null;
      primary_contact_email: string | null;
      owner_name: string | null;
      owner_email: string | null;
    }>(
      `
        SELECT
          item.id::text,
          item.label,
          item.due_at::text,
          item.job_id::text,
          j.job_number,
          j.title AS job_title,
          j.department_type::text,
          org.display_name AS organization_name,
          contact.id::text AS primary_contact_id,
          contact.full_name AS primary_contact_name,
          contact.email AS primary_contact_email,
          owner.full_name AS owner_name,
          owner.email AS owner_email
        FROM job_readiness_item item
        JOIN jobs j
          ON j.tenant_id = item.tenant_id
         AND j.id = item.job_id
        LEFT JOIN organization org
          ON org.id = j.organization_id
        LEFT JOIN organization_contact contact
          ON contact.id = j.primary_contact_id
        LEFT JOIN app_user owner
          ON owner.id = j.account_owner_user_id
        WHERE item.tenant_id = $1
          AND item.id = $2::uuid
        LIMIT 1
      `,
      [tenantId, input.related_record_id]
    );
    const item = rows[0];
    if (!item) {
      throw new ApiError(404, "Required item not found.");
    }
    const { rows: siblingItems } = await client.query<{ label: string | null }>(
      `
        SELECT label
        FROM job_readiness_item
        WHERE tenant_id = $1
          AND job_id = $2::uuid
          AND is_complete = false
        ORDER BY due_at NULLS LAST, created_at ASC
        LIMIT 5
      `,
      [tenantId, item.job_id]
    );
    const mergeContext = {
      client_name: item.organization_name ?? "Client",
      project_name: item.job_title ?? item.job_number ?? "Project",
      project_number: item.job_number ?? "",
      due_date: formatDate(item.due_at),
      missing_items_summary: siblingItems
        .map((row) => row.label?.trim() ?? "")
        .filter(Boolean)
        .join(", "),
      secure_link: input.secure_link?.trim() ?? "",
      owner_name: item.owner_name ?? "",
      owner_email: item.owner_email ?? "",
      required_item_label: item.label ?? "",
      related_record_type: "job_readiness_item",
      related_record_id: item.id
    };
    return {
      recordType: "job_readiness_item",
      recordId: item.id,
      canonicalDashboardId: buildCanonicalDashboardId("job_readiness_item", item.id),
      dashboardUrl: buildDashboardUrl("job_readiness_item", item.id, item.job_id),
      departmentScope: item.department_type,
      relatedEntityLabel: item.label,
      contactId: input.contact_id ?? item.primary_contact_id ?? null,
      recipientName: input.recipient_name?.trim() || item.primary_contact_name || null,
      recipientEmail: input.recipient_email?.trim() || item.primary_contact_email || null,
      mergeContext
    };
  }

  if (input.related_record_type === "work_task") {
    const { rows } = await client.query<{
      id: string;
      task_number: string | null;
      title: string | null;
      due_at: string | null;
      department_type: string | null;
      organization_name: string | null;
      primary_contact_id: string | null;
      primary_contact_name: string | null;
      primary_contact_email: string | null;
      owner_name: string | null;
      owner_email: string | null;
    }>(
      `
        SELECT
          task.id::text,
          task.task_number,
          task.title,
          task.due_at::text,
          task.department_type::text,
          org.display_name AS organization_name,
          contact.id::text AS primary_contact_id,
          contact.full_name AS primary_contact_name,
          contact.email AS primary_contact_email,
          owner.full_name AS owner_name,
          owner.email AS owner_email
        FROM work_task task
        LEFT JOIN jobs j
          ON j.tenant_id = task.tenant_id
         AND j.id = task.related_job_id
        LEFT JOIN organization org
          ON org.id = j.organization_id
        LEFT JOIN organization_contact contact
          ON contact.id = j.primary_contact_id
        LEFT JOIN app_user owner
          ON owner.id = COALESCE(task.assigned_to_user_id, task.created_by_user_id)
        WHERE task.tenant_id = $1
          AND task.id = $2::uuid
        LIMIT 1
      `,
      [tenantId, input.related_record_id]
    );
    const task = rows[0];
    if (!task) {
      throw new ApiError(404, "Task not found.");
    }
    const mergeContext = {
      client_name: task.organization_name ?? "Client",
      project_name: task.title ?? task.task_number ?? "Task",
      project_number: task.task_number ?? "",
      due_date: formatDate(task.due_at),
      missing_items_summary: "",
      secure_link: input.secure_link?.trim() ?? "",
      owner_name: task.owner_name ?? "",
      owner_email: task.owner_email ?? "",
      task_title: task.title ?? "",
      related_record_type: "work_task",
      related_record_id: task.id
    };
    return {
      recordType: "work_task",
      recordId: task.id,
      canonicalDashboardId: buildCanonicalDashboardId("work_task", task.id),
      dashboardUrl: buildDashboardUrl("work_task", task.id),
      departmentScope: task.department_type,
      relatedEntityLabel: task.title ?? task.task_number,
      contactId: input.contact_id ?? task.primary_contact_id ?? null,
      recipientName: input.recipient_name?.trim() || task.primary_contact_name || null,
      recipientEmail: input.recipient_email?.trim() || task.primary_contact_email || null,
      mergeContext
    };
  }

  if (input.related_record_type === "operational_approval_request") {
    const { rows } = await client.query<{
      id: string;
      request_title: string;
      request_summary: string | null;
      sla_due_at: string | null;
      requester_department: string | null;
      requested_by_name: string | null;
      requested_by_email: string | null;
    }>(
      `
        SELECT
          req.id::text,
          req.request_title,
          req.request_summary,
          req.sla_due_at::text,
          req.requester_department,
          requester.full_name AS requested_by_name,
          requester.email AS requested_by_email
        FROM operational_approval_request req
        LEFT JOIN app_user requester
          ON requester.id = req.requested_by_user_id
        WHERE req.tenant_id = $1
          AND req.id = $2::uuid
        LIMIT 1
      `,
      [tenantId, input.related_record_id]
    );
    const approval = rows[0];
    if (!approval) {
      throw new ApiError(404, "Approval request not found.");
    }
    const mergeContext = {
      client_name: "",
      project_name: approval.request_title,
      project_number: "",
      due_date: formatDate(approval.sla_due_at),
      missing_items_summary: approval.request_summary ?? "",
      secure_link: input.secure_link?.trim() ?? "",
      owner_name: approval.requested_by_name ?? "",
      owner_email: approval.requested_by_email ?? "",
      approval_title: approval.request_title,
      approval_due_at: formatDate(approval.sla_due_at),
      related_record_type: "operational_approval_request",
      related_record_id: approval.id
    };
    return {
      recordType: "operational_approval_request",
      recordId: approval.id,
      canonicalDashboardId: buildCanonicalDashboardId("operational_approval_request", approval.id),
      dashboardUrl: buildDashboardUrl("operational_approval_request", approval.id),
      departmentScope: approval.requester_department,
      relatedEntityLabel: approval.request_title,
      contactId: input.contact_id ?? null,
      recipientName: input.recipient_name?.trim() || null,
      recipientEmail: input.recipient_email?.trim() || null,
      mergeContext
    };
  }

  if (input.related_record_type === "post_shoot_evaluation") {
    const { rows } = await client.query<{
      id: string;
      shoot_name: string;
      shoot_date: string;
      photographer_name: string;
      notes: string | null;
      outreach_notes: string | null;
    }>(
      `
        SELECT
          eval.id::text,
          eval.shoot_name,
          eval.shoot_date::text,
          eval.photographer_name,
          eval.notes,
          eval.outreach_notes
        FROM post_shoot_evaluation eval
        WHERE eval.tenant_id = $1
          AND eval.id = $2::uuid
        LIMIT 1
      `,
      [tenantId, input.related_record_id]
    );
    const submission = rows[0];
    if (!submission) {
      throw new ApiError(404, "Submission not found.");
    }
    const mergeContext = {
      client_name: submission.shoot_name,
      project_name: submission.shoot_name,
      project_number: "",
      due_date: formatDate(submission.shoot_date),
      missing_items_summary: submission.outreach_notes ?? "",
      secure_link: input.secure_link?.trim() ?? "",
      owner_name: submission.photographer_name,
      owner_email: "",
      submission_notes: submission.notes ?? "",
      related_record_type: "post_shoot_evaluation",
      related_record_id: submission.id
    };
    return {
      recordType: "post_shoot_evaluation",
      recordId: submission.id,
      canonicalDashboardId: buildCanonicalDashboardId("post_shoot_evaluation", submission.id),
      dashboardUrl: null,
      departmentScope: null,
      relatedEntityLabel: submission.shoot_name,
      contactId: input.contact_id ?? null,
      recipientName: input.recipient_name?.trim() || null,
      recipientEmail: input.recipient_email?.trim() || null,
      mergeContext
    };
  }

  const mergeContext = {
    client_name: "",
    project_name: "",
    project_number: "",
    due_date: "",
    missing_items_summary: "",
    secure_link: input.secure_link?.trim() ?? "",
    owner_name: "",
    owner_email: "",
    related_record_type: input.related_record_type,
    related_record_id: input.related_record_id
  };
  return {
    recordType: input.related_record_type,
    recordId: input.related_record_id,
    canonicalDashboardId: buildCanonicalDashboardId(input.related_record_type, input.related_record_id),
    dashboardUrl: null,
    departmentScope: null,
    relatedEntityLabel: null,
    contactId: input.contact_id ?? null,
    recipientName: input.recipient_name?.trim() || null,
    recipientEmail: input.recipient_email?.trim() || null,
    mergeContext
  };
}

function assertMailAutomationAccess(auth: Pick<AuthUser, "authorityTier">) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    throw new ApiError(403, "Integration governance access is required.");
  }
}

function assertMailAutomationManageAccess(auth: Pick<AuthUser, "authorityTier">) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Integration governance management access is required.");
  }
}

async function hasMailAutomationSchema(client: PoolClient) {
  const { rows } = await client.query<{
    has_mailbox_contract: boolean;
    has_template_contract: boolean;
    has_delivery: boolean;
    has_event: boolean;
  }>(
    `
      SELECT
        (to_regclass('public.microsoft_shared_mailbox_contract') IS NOT NULL) AS has_mailbox_contract,
        (to_regclass('public.microsoft_mail_template_contract') IS NOT NULL) AS has_template_contract,
        (to_regclass('public.microsoft_mail_automation_delivery') IS NOT NULL) AS has_delivery,
        (to_regclass('public.microsoft_mail_automation_event') IS NOT NULL) AS has_event
    `
  );

  const row = rows[0];
  return Boolean(
    row?.has_mailbox_contract &&
      row?.has_template_contract &&
      row?.has_delivery &&
      row?.has_event
  );
}

async function assertMailAutomationSchemaReady(client: PoolClient) {
  if (!(await hasMailAutomationSchema(client))) {
    throw new ApiError(503, "Microsoft 365 mail automation schema is not available in this environment.");
  }
}

function ensureMailAutomationEnabled() {
  if (!config.MICROSOFT_365_MAIL_AUTOMATION_ENABLED) {
    throw new ApiError(503, "Microsoft 365 mail automation is disabled in this environment.");
  }
}

export function getMicrosoft365MailAutomationValidationIssues(): Microsoft365MailAutomationValidationIssue[] {
  const issues: Microsoft365MailAutomationValidationIssue[] = [];
  const environment = resolveEnvironment();
  let baseline: Microsoft365MailAutomationBaseline | null = null;

  try {
    baseline = loadBaseline(environment);
  } catch (error) {
    addIssue(issues, {
      area: "baseline",
      severity: "error",
      code: "baseline.file_invalid",
      summary: "The Microsoft 365 mail automation baseline is missing or invalid for the active environment.",
      details: {
        environment,
        path: getBaselinePath(environment),
        error: error instanceof Error ? error.message : "Unknown baseline load failure."
      }
    });
    return issues;
  }

  const governanceIssues = getMicrosoft365GovernanceValidationIssues().filter((issue) => issue.severity === "error");
  if (governanceIssues.length > 0) {
    addIssue(issues, {
      area: "phase1_prerequisite",
      severity: "error",
      code: "phase1_prerequisite.governance_not_ready",
      summary: "Phase 4 mail automation depends on Phase 1 governance being ready.",
      details: {
        blocking_issue_codes: governanceIssues.map((issue) => issue.code)
      }
    });
  }

  const operatingSystemIssues = getMicrosoft365OperatingSystemValidationIssues().filter((issue) => issue.severity === "error");
  if (operatingSystemIssues.length > 0) {
    addIssue(issues, {
      area: "phase2_prerequisite",
      severity: "error",
      code: "phase2_prerequisite.operating_system_not_ready",
      summary: "Phase 4 mail automation depends on the Phase 2 Microsoft operating system baseline being ready.",
      details: {
        blocking_issue_codes: operatingSystemIssues.map((issue) => issue.code)
      }
    });
  }

  const provisioningIssues = getMicrosoft365ProvisioningValidationIssues().filter((issue) => issue.severity === "error");
  if (provisioningIssues.length > 0) {
    addIssue(issues, {
      area: "phase3_prerequisite",
      severity: "error",
      code: "phase3_prerequisite.provisioning_not_ready",
      summary: "Phase 4 mail automation depends on the Phase 3 dashboard linking and provisioning contract being ready.",
      details: {
        blocking_issue_codes: provisioningIssues.map((issue) => issue.code)
      }
    });
  }

  if (!config.API_PUBLIC_URL) {
    addIssue(issues, {
      area: "callbacks",
      severity: "error",
      code: "callbacks.api_public_url.missing",
      summary: "API_PUBLIC_URL is required so Power Automate can call back with final send status."
    });
  }

  if (!config.ADMIN_WEB_URL) {
    addIssue(issues, {
      area: "backlinks",
      severity: environment === "production" ? "error" : "warning",
      code: "backlinks.admin_web_url.missing",
      summary: "ADMIN_WEB_URL is required to build dashboard backlinks into mail delivery logs and templates."
    });
  }

  if (!config.MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID) {
    addIssue(issues, {
      area: "power_automate",
      severity: environment === "production" ? "error" : "warning",
      code: "power_automate.environment_id.missing",
      summary: "MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID is required for governed Power Automate ownership and validation."
    });
  }

  if (!(config.MICROSOFT_365_MAIL_AUTOMATION_TIMEOUT_MS > 0)) {
    addIssue(issues, {
      area: "dispatch",
      severity: "error",
      code: "dispatch.timeout.invalid",
      summary: "MICROSOFT_365_MAIL_AUTOMATION_TIMEOUT_MS must be a positive number."
    });
  }

  if (config.MICROSOFT_365_MAIL_AUTOMATION_ENABLED) {
    if (!config.MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET && environment === "production") {
      addIssue(issues, {
        area: "callbacks",
        severity: "error",
        code: "callbacks.secret.missing",
        summary: "Production mail automation requires MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET."
      });
    }

    if (!Object.keys(config.MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS).length) {
      addIssue(issues, {
        area: "power_automate",
        severity: "error",
        code: "power_automate.flow_endpoints.missing",
        summary: "Mail automation is enabled but MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS is empty."
      });
    }
  }

  for (const flow of baseline.flow_inventory) {
    if (!baseline.template_schema.some((template) => template.template_key === flow.template_key)) {
      addIssue(issues, {
        area: "baseline",
        severity: "error",
        code: `baseline.flow_template_missing.${flow.flow_key}`,
        summary: `Flow ${flow.flow_key} references template ${flow.template_key}, which is not defined in the baseline.`
      });
    }
    if (!baseline.shared_mailboxes.some((mailbox) => mailbox.mailbox_key === flow.shared_mailbox_key)) {
      addIssue(issues, {
        area: "baseline",
        severity: "error",
        code: `baseline.flow_mailbox_missing.${flow.flow_key}`,
        summary: `Flow ${flow.flow_key} references shared mailbox ${flow.shared_mailbox_key}, which is not defined in the baseline.`
      });
    }
    if (config.MICROSOFT_365_MAIL_AUTOMATION_ENABLED && !getFlowEndpoint(flow.flow_key)) {
      addIssue(issues, {
        area: "power_automate",
        severity: "error",
        code: `power_automate.flow_endpoint_missing.${flow.flow_key}`,
        summary: `Mail automation flow ${flow.flow_key} does not have a configured invoke endpoint.`
      });
    }
  }

  for (const template of baseline.template_schema) {
    if (!baseline.shared_mailboxes.some((mailbox) => mailbox.mailbox_key === template.shared_mailbox_key)) {
      addIssue(issues, {
        area: "baseline",
        severity: "error",
        code: `baseline.template_mailbox_missing.${template.template_key}`,
        summary: `Template ${template.template_key} references shared mailbox ${template.shared_mailbox_key}, which is not defined in the baseline.`
      });
    }
    if (!template.template_url.startsWith(baseline.template_library.site_url)) {
      addIssue(issues, {
        area: "template_library",
        severity: "warning",
        code: `template_library.template_url_outside_site.${template.template_key}`,
        summary: `Template ${template.template_key} points outside the governed SharePoint template site.`,
        details: {
          template_url: template.template_url,
          expected_site_url: baseline.template_library.site_url
        }
      });
    }
  }

  return issues;
}

export function assertMicrosoft365MailAutomationStartupConfig() {
  const issues = getMicrosoft365MailAutomationValidationIssues();
  const errors = issues.filter((issue) => issue.severity === "error");
  if ((config.MICROSOFT_365_MAIL_AUTOMATION_STRICT_VALIDATION || config.NODE_ENV === "production") && errors.length > 0) {
    throw new Error(
      `Microsoft 365 mail automation startup validation failed: ${errors.map((issue) => `${issue.area}:${issue.code}`).join(", ")}`
    );
  }
}

export function getPublicMicrosoft365MailAutomationHealthSummary() {
  const issues = getMicrosoft365MailAutomationValidationIssues();
  const recommendation = determineRecommendation(issues);
  let baseline: Microsoft365MailAutomationBaseline | null = null;
  try {
    baseline = loadBaseline(resolveEnvironment());
  } catch {
    baseline = null;
  }

  return {
    baseline_environment: resolveEnvironment(),
    startup_valid: issues.every((issue) => issue.severity !== "error"),
    issue_count: issues.length,
    shared_mailbox_count: baseline?.shared_mailboxes.length ?? 0,
    template_count: baseline?.template_schema.length ?? 0,
    flow_count: baseline?.flow_inventory.length ?? 0,
    recommendation
  };
}

export async function getMicrosoft365MailAutomationDiagnostics(
  client: PoolClient,
  auth: AuthUser
): Promise<Microsoft365MailAutomationDiagnosticsResponse & { recent_deliveries: Array<DeliveryRow & { events: EventRow[] }> }> {
  assertMailAutomationAccess(auth);
  const baselineEnvironment = resolveEnvironment();
  const baseline = loadBaseline(baselineEnvironment);
  const issues = getMicrosoft365MailAutomationValidationIssues();
  const schemaReady = await hasMailAutomationSchema(client);
  const diagnosticsIssues = schemaReady
    ? issues
    : [
        ...issues,
        {
          area: "schema",
          severity: "error",
          code: "schema.phase4_missing",
          summary: "Phase 4 mail automation tables are not available in this environment."
        } satisfies Microsoft365MailAutomationValidationIssue
      ];
  const recommendation = determineRecommendation(diagnosticsIssues);

  let deliveryRows: DeliveryRow[] = [];
  let eventsByDelivery = new Map<string, EventRow[]>();
  if (schemaReady) {
    const deliveryResult = await client.query<DeliveryRow>(
      `
        SELECT
          id::text,
          tenant_id::text,
          provider,
          related_record_type::text,
          related_record_id,
          canonical_dashboard_id,
          contact_id::text,
          recipient_name,
          recipient_email,
          shared_mailbox_key,
          sender_alias,
          template_key,
          template_url,
          flow_key,
          trigger_type::text,
          status::text,
          subject_hint,
          merge_context,
          dashboard_url,
          microsoft_message_id,
          microsoft_message_url,
          flow_run_id,
          flow_run_url,
          sync_operation_id::text,
          source_change_key,
          attempt_count,
          queued_at::text,
          first_dispatched_at::text,
          last_dispatched_at::text,
          sent_at::text,
          last_error,
          last_error_at::text,
          metadata,
          created_by_user_id::text,
          updated_by_user_id::text,
          created_at::text,
          updated_at::text
        FROM microsoft_mail_automation_delivery
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 25
      `,
      [auth.tenantId]
    );
    deliveryRows = deliveryResult.rows;
    eventsByDelivery = await loadEventsForDeliveries(
      client,
      auth.tenantId,
      deliveryRows.map((row) => row.id)
    );
  }

  return {
    generated_at: new Date().toISOString(),
    baseline_environment: baselineEnvironment,
    startup_validation: {
      valid: diagnosticsIssues.every((issue) => issue.severity !== "error"),
      issues: diagnosticsIssues
    },
    phase_audit_summary: {
      implementation_status: "implemented_as_shared_mailbox_contract_with_queue_backed_power_automate_dispatch",
      current_state:
        "The dashboard already had generic integration queueing, Microsoft diagnostics, and a domain-local sales email pattern, but it did not yet have one shared-mailbox client email contract, one SharePoint-backed template library contract, or one Power Automate callback/logging layer for client-facing automated sends.",
      recommendation
    },
    current_state_findings: buildCurrentStateFindings(),
    refactor_first: buildRefactorFirst(),
    shared_mailbox_model: baseline.shared_mailboxes,
    sender_alias_rules: baseline.sender_alias_rules,
    template_library: baseline.template_library,
    template_schema: baseline.template_schema,
    flow_inventory: baseline.flow_inventory,
    logging_and_monitoring: baseline.logging_and_monitoring,
    configuration_artifacts: ARTIFACTS,
    governance_docs: DOCS,
    execution_order: baseline.execution_order,
    manual_admin_checklist: baseline.manual_admin_checklist,
    validation_checklist: baseline.validation_checklist,
    rollback_principles: baseline.rollback_principles,
    recent_deliveries: deliveryRows.map((row) => decorateMailAutomationDeliveryRow(row, eventsByDelivery.get(row.id) ?? []))
  };
}

export async function syncMicrosoft365MailAutomationContracts(
  client: PoolClient,
  auth: AuthUser
): Promise<ContractSyncResult> {
  assertMailAutomationManageAccess(auth);
  await assertMailAutomationSchemaReady(client);
  const baseline = loadBaseline(resolveEnvironment());

  for (const mailbox of baseline.shared_mailboxes) {
    await client.query(
      `
        INSERT INTO microsoft_shared_mailbox_contract (
          tenant_id,
          mailbox_key,
          display_name,
          alias_address,
          department_scope,
          mailbox_purpose,
          send_as_mode,
          fallback_mailbox_key,
          owner_metadata,
          active_status,
          last_sync_error,
          created_by_user_id,
          updated_by_user_id,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,true,NULL,$10,$10,now(),now())
        ON CONFLICT (tenant_id, mailbox_key)
        DO UPDATE SET
          display_name = EXCLUDED.display_name,
          alias_address = EXCLUDED.alias_address,
          department_scope = EXCLUDED.department_scope,
          mailbox_purpose = EXCLUDED.mailbox_purpose,
          send_as_mode = EXCLUDED.send_as_mode,
          fallback_mailbox_key = EXCLUDED.fallback_mailbox_key,
          owner_metadata = EXCLUDED.owner_metadata,
          active_status = true,
          last_sync_error = NULL,
          updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_at = now()
      `,
      [
        auth.tenantId,
        mailbox.mailbox_key,
        mailbox.display_name,
        mailbox.alias_address,
        mailbox.department_scope ?? null,
        mailbox.mailbox_purpose,
        mailbox.send_as_mode,
        mailbox.fallback_mailbox_key ?? null,
        JSON.stringify({
          owner_groups: mailbox.owner_groups,
          member_groups: mailbox.member_groups,
          allowed_trigger_types: mailbox.allowed_trigger_types,
          notes: mailbox.notes ?? null
        }),
        auth.id
      ]
    );
  }

  for (const template of baseline.template_schema) {
    await client.query(
      `
        INSERT INTO microsoft_mail_template_contract (
          tenant_id,
          template_key,
          template_name,
          template_family,
          department_scope,
          shared_mailbox_key,
          storage_provider,
          sharepoint_site_url,
          sharepoint_library_name,
          storage_path,
          template_url,
          subject_hint,
          merge_tokens,
          required_tokens,
          owner_metadata,
          active_status,
          last_sync_error,
          created_by_user_id,
          updated_by_user_id,
          created_at,
          updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7::microsoft_mail_template_storage_type,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,true,NULL,$16,$16,now(),now()
        )
        ON CONFLICT (tenant_id, template_key)
        DO UPDATE SET
          template_name = EXCLUDED.template_name,
          template_family = EXCLUDED.template_family,
          department_scope = EXCLUDED.department_scope,
          shared_mailbox_key = EXCLUDED.shared_mailbox_key,
          storage_provider = EXCLUDED.storage_provider,
          sharepoint_site_url = EXCLUDED.sharepoint_site_url,
          sharepoint_library_name = EXCLUDED.sharepoint_library_name,
          storage_path = EXCLUDED.storage_path,
          template_url = EXCLUDED.template_url,
          subject_hint = EXCLUDED.subject_hint,
          merge_tokens = EXCLUDED.merge_tokens,
          required_tokens = EXCLUDED.required_tokens,
          owner_metadata = EXCLUDED.owner_metadata,
          active_status = true,
          last_sync_error = NULL,
          updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_at = now()
      `,
      [
        auth.tenantId,
        template.template_key,
        template.template_name,
        template.template_family,
        template.department_scope ?? null,
        template.shared_mailbox_key,
        template.storage_provider,
        baseline.template_library.site_url,
        baseline.template_library.library_name,
        template.storage_path,
        template.template_url,
        template.subject_hint,
        JSON.stringify(template.merge_tokens.map((token) => token.key)),
        JSON.stringify(getRequiredTokens(template)),
        JSON.stringify({
          notes: template.notes,
          template_library: baseline.template_library
        }),
        auth.id
      ]
    );
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "integration.microsoft365_mail_automation.contracts_synced",
    entityType: "microsoft_mail_template_contract",
    entityId: null,
    metadata: {
      mailbox_count: baseline.shared_mailboxes.length,
      template_count: baseline.template_schema.length,
      baseline_environment: baseline.environment,
      baseline_version: baseline.baseline_version
    }
  });

  await recordMicrosoftIntegrationEvent(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    integrationArea: "mail_automation",
    eventLevel: "info",
    eventType: "mail_automation.contracts_synced",
    eventStatus: "synced",
    summary: "Microsoft 365 mail automation contracts were synchronized from the active baseline.",
    detail: {
      baseline_environment: baseline.environment,
      baseline_version: baseline.baseline_version,
      mailbox_count: baseline.shared_mailboxes.length,
      template_count: baseline.template_schema.length
    }
  });

  return {
    baseline_environment: baseline.environment,
    baseline_version: baseline.baseline_version,
    mailbox_contracts_synced: baseline.shared_mailboxes.length,
    template_contracts_synced: baseline.template_schema.length
  };
}

export async function listMicrosoft365MailAutomationContracts(client: PoolClient, auth: AuthUser) {
  assertMailAutomationAccess(auth);
  await assertMailAutomationSchemaReady(client);
  const baseline = loadBaseline(resolveEnvironment());
  const [mailboxes, templates] = await Promise.all([
    client.query<Microsoft365SharedMailboxContractRecord>(
      `
        SELECT
          id::text,
          tenant_id::text,
          mailbox_key,
          display_name,
          alias_address,
          department_scope,
          mailbox_purpose,
          send_as_mode,
          fallback_mailbox_key,
          microsoft_object_id,
          microsoft_url,
          owner_metadata,
          active_status,
          last_sync_error,
          created_by_user_id::text,
          updated_by_user_id::text,
          created_at::text,
          updated_at::text
        FROM microsoft_shared_mailbox_contract
        WHERE tenant_id = $1
        ORDER BY mailbox_key
      `,
      [auth.tenantId]
    ),
    client.query<Microsoft365MailTemplateContractRecord>(
      `
        SELECT
          id::text,
          tenant_id::text,
          template_key,
          template_name,
          template_family,
          department_scope,
          shared_mailbox_key,
          storage_provider::text,
          sharepoint_site_url,
          sharepoint_library_name,
          storage_path,
          template_url,
          subject_hint,
          merge_tokens,
          required_tokens,
          owner_metadata,
          active_status,
          last_sync_error,
          created_by_user_id::text,
          updated_by_user_id::text,
          created_at::text,
          updated_at::text
        FROM microsoft_mail_template_contract
        WHERE tenant_id = $1
        ORDER BY template_key
      `,
      [auth.tenantId]
    )
  ]);

  return {
    baseline_environment: baseline.environment,
    baseline_version: baseline.baseline_version,
    shared_mailboxes: mailboxes.rows,
    templates: templates.rows,
    sender_alias_rules: baseline.sender_alias_rules,
    flow_inventory: baseline.flow_inventory,
    template_library: baseline.template_library
  };
}

export async function listMicrosoft365MailAutomationDeliveries(
  client: PoolClient,
  auth: AuthUser,
  filters: {
    status?: Microsoft365MailAutomationStatus | null;
    recordType?: Microsoft365MailAutomationRecordType | null;
    recordId?: string | null;
    mailboxKey?: string | null;
    triggerType?: Microsoft365MailAutomationTriggerType | null;
    limit?: number;
  } = {}
) {
  assertMailAutomationAccess(auth);
  await assertMailAutomationSchemaReady(client);
  const values: unknown[] = [auth.tenantId];
  const where: string[] = ["tenant_id = $1"];

  if (filters.status) {
    values.push(filters.status);
    where.push(`status = $${values.length}::microsoft_mail_automation_status`);
  }
  if (filters.recordType) {
    values.push(filters.recordType);
    where.push(`related_record_type = $${values.length}::microsoft_mail_automation_record_type`);
  }
  if (filters.recordId) {
    values.push(filters.recordId);
    where.push(`related_record_id = $${values.length}`);
  }
  if (filters.mailboxKey) {
    values.push(filters.mailboxKey);
    where.push(`shared_mailbox_key = $${values.length}`);
  }
  if (filters.triggerType) {
    values.push(filters.triggerType);
    where.push(`trigger_type = $${values.length}::microsoft_mail_automation_trigger_type`);
  }

  values.push(Math.min(Math.max(filters.limit ?? 50, 1), 200));
  const { rows } = await client.query<DeliveryRow>(
    `
      SELECT
        id::text,
        tenant_id::text,
        provider,
        related_record_type::text,
        related_record_id,
        canonical_dashboard_id,
        contact_id::text,
        recipient_name,
        recipient_email,
        shared_mailbox_key,
        sender_alias,
        template_key,
        template_url,
        flow_key,
        trigger_type::text,
        status::text,
        subject_hint,
        merge_context,
        dashboard_url,
        microsoft_message_id,
        microsoft_message_url,
        flow_run_id,
        flow_run_url,
        sync_operation_id::text,
        source_change_key,
        attempt_count,
        queued_at::text,
        first_dispatched_at::text,
        last_dispatched_at::text,
        sent_at::text,
        last_error,
        last_error_at::text,
        metadata,
        created_by_user_id::text,
        updated_by_user_id::text,
        created_at::text,
        updated_at::text
      FROM microsoft_mail_automation_delivery
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${values.length}
    `,
    values
  );
  const eventsByDelivery = await loadEventsForDeliveries(
    client,
    auth.tenantId,
    rows.map((row) => row.id)
  );
  return rows.map((row) => decorateMailAutomationDeliveryRow(row, eventsByDelivery.get(row.id) ?? []));
}

export async function queueMicrosoft365MailAutomationDelivery(
  client: PoolClient,
  auth: AuthUser,
  input: QueueMicrosoft365MailAutomationDeliveryInput
) {
  assertMailAutomationManageAccess(auth);
  ensureMailAutomationEnabled();
  await assertMailAutomationSchemaReady(client);
  const baseline = loadBaseline(resolveEnvironment());
  const flow = resolveFlow(baseline, {
    recordType: input.related_record_type,
    triggerType: input.trigger_type,
    templateKey: input.template_key
  });
  const template = findTemplate(baseline, input.template_key);
  const context = await resolveMailContext(client, auth.tenantId, input);
  const senderRule =
    selectSenderAliasRule(baseline.sender_alias_rules, {
      recordType: input.related_record_type,
      triggerType: input.trigger_type,
      departmentScope: context.departmentScope
    }) ?? null;
  const sharedMailbox = findMailbox(baseline, senderRule?.shared_mailbox_key ?? flow.shared_mailbox_key);

  if (!sharedMailbox.allowed_trigger_types.includes(input.trigger_type)) {
    throw new ApiError(400, `Shared mailbox ${sharedMailbox.mailbox_key} does not allow ${input.trigger_type} sends.`);
  }

  if (template.shared_mailbox_key !== flow.shared_mailbox_key) {
    throw new ApiError(
      409,
      `Template ${template.template_key} and flow ${flow.flow_key} disagree on the required shared mailbox.`
    );
  }

  const recipientEmail = context.recipientEmail?.trim() ?? null;
  if (!recipientEmail) {
    throw new ApiError(400, "A recipient email address is required for automated client email.");
  }

  const mergeContext = {
    ...context.mergeContext,
    ...normalizeStringMap(input.extra_merge_context),
    recipient_name: context.recipientName ?? "",
    recipient_email: recipientEmail,
    sender_alias: sharedMailbox.alias_address,
    shared_mailbox_address: sharedMailbox.alias_address,
    dashboard_url: context.dashboardUrl ?? "",
    template_key: template.template_key,
    flow_key: flow.flow_key
  };
  ensureRequiredTemplateTokens(template, mergeContext);

  const sourceChangeKey = input.source_change_key?.trim() || null;
  if (sourceChangeKey) {
    const existing = await loadExistingDeliveryBySourceChangeKey(client, {
      tenantId: auth.tenantId,
      flowKey: flow.flow_key,
      sourceChangeKey
    });
    if (existing) {
      return {
        deduped: true,
        delivery: existing,
        flow,
        shared_mailbox: sharedMailbox
      };
    }
  }

  const operation = await queueIntegrationSyncOperation(client, {
    tenantId: auth.tenantId,
    provider: "microsoft365_mail_automation" as IntegrationProvider,
    direction: "outbound",
    entityType: input.related_record_type,
    entityId: parseRecordId(input.related_record_id),
    externalObjectType: "power_automate_flow_run",
    externalId: null,
    operationType: flow.flow_key,
    sourceSystem: "mission_control",
    sourceChangeKey,
    triggeredByUserId: auth.id,
    payload: {
      baseline_version: baseline.baseline_version,
      canonical_dashboard_id: context.canonicalDashboardId,
      related_record_type: input.related_record_type,
      related_record_id: input.related_record_id,
      flow_key: flow.flow_key,
      template_key: template.template_key,
      shared_mailbox_key: sharedMailbox.mailbox_key,
      sender_alias: sharedMailbox.alias_address,
      recipient_name: context.recipientName ?? null,
      recipient_email: recipientEmail,
      dashboard_url: context.dashboardUrl ?? null,
      merge_context: mergeContext,
      ...buildMailAutomationSyncEnvelope({
        recordType: input.related_record_type,
        recordId: input.related_record_id,
        canonicalDashboardId: context.canonicalDashboardId,
        sharedMailboxKey: sharedMailbox.mailbox_key,
        senderAlias: sharedMailbox.alias_address,
        recipientEmail,
        retryState: "pending_dispatch",
        providerAccepted: false,
        deliveryConfirmed: false
      })
    }
  });

  const { rows } = await client.query<DeliveryRow>(
    `
      INSERT INTO microsoft_mail_automation_delivery (
        tenant_id,
        provider,
        related_record_type,
        related_record_id,
        canonical_dashboard_id,
        contact_id,
        recipient_name,
        recipient_email,
        shared_mailbox_key,
        sender_alias,
        template_key,
        template_url,
        flow_key,
        trigger_type,
        status,
        subject_hint,
        merge_context,
        dashboard_url,
        sync_operation_id,
        source_change_key,
        metadata,
        created_by_user_id,
        updated_by_user_id,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        'microsoft365_mail_automation',
        $2::microsoft_mail_automation_record_type,
        $3,
        $4,
        $5::uuid,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13::microsoft_mail_automation_trigger_type,
        'queued'::microsoft_mail_automation_status,
        $14,
        $15::jsonb,
        $16,
        $17::uuid,
        $18,
        $19::jsonb,
        $20::uuid,
        $20::uuid,
        now(),
        now()
      )
      RETURNING
        id::text,
        tenant_id::text,
        provider,
        related_record_type::text,
        related_record_id,
        canonical_dashboard_id,
        contact_id::text,
        recipient_name,
        recipient_email,
        shared_mailbox_key,
        sender_alias,
        template_key,
        template_url,
        flow_key,
        trigger_type::text,
        status::text,
        subject_hint,
        merge_context,
        dashboard_url,
        microsoft_message_id,
        microsoft_message_url,
        flow_run_id,
        flow_run_url,
        sync_operation_id::text,
        source_change_key,
        attempt_count,
        queued_at::text,
        first_dispatched_at::text,
        last_dispatched_at::text,
        sent_at::text,
        last_error,
        last_error_at::text,
        metadata,
        created_by_user_id::text,
        updated_by_user_id::text,
        created_at::text,
        updated_at::text
    `,
    [
      auth.tenantId,
      input.related_record_type,
      input.related_record_id,
      context.canonicalDashboardId,
      parseRecordId(context.contactId),
      context.recipientName ?? null,
      recipientEmail,
      sharedMailbox.mailbox_key,
      sharedMailbox.alias_address,
      template.template_key,
      template.template_url,
      flow.flow_key,
      input.trigger_type,
      template.subject_hint,
      JSON.stringify(mergeContext),
      context.dashboardUrl ?? null,
      operation.id,
      sourceChangeKey,
      JSON.stringify({
        mailbox_purpose: sharedMailbox.mailbox_purpose,
        sender_alias_rule: senderRule?.key ?? null,
        power_automate_owner: flow.power_automate_owner,
        failure_alert_target: flow.failure_alert_target,
        related_entity_label: context.relatedEntityLabel
      }),
      auth.id
    ]
  );
  const delivery = rows[0];

  await recordDeliveryEvent(client, {
    tenantId: auth.tenantId,
    deliveryId: delivery.id,
    eventType: "queued",
    actorUserId: auth.id,
    note: "Email automation delivery queued.",
    metadata: {
      sync_operation_id: operation.id,
      flow_key: flow.flow_key
    }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "integration.microsoft365_mail_automation.delivery_queued",
    entityType: "microsoft_mail_automation_delivery",
    entityId: delivery.id,
    metadata: {
      related_record_type: input.related_record_type,
      related_record_id: input.related_record_id,
      shared_mailbox_key: sharedMailbox.mailbox_key,
      template_key: template.template_key,
      trigger_type: input.trigger_type,
      sync_operation_id: operation.id
    }
  });

  await recordMicrosoftIntegrationEvent(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    integrationArea: "mail_automation",
    eventLevel: "info",
    eventType: "mail_automation.delivery.queued",
    eventStatus: "queued",
    summary: `Queued ${input.trigger_type} email automation from ${sharedMailbox.alias_address}.`,
    detail: {
      delivery_id: delivery.id,
      sync_operation_id: operation.id,
      flow_key: flow.flow_key,
      template_key: template.template_key,
      recipient_email: recipientEmail
    },
    relatedEntityType: "microsoft_mail_automation_delivery",
    relatedEntityId: delivery.id,
    externalTarget: sharedMailbox.alias_address
  });

  return {
    deduped: false,
    delivery,
    sync_operation: operation,
    flow,
    shared_mailbox: sharedMailbox
  };
}

export async function queueMicrosoft365MailAutomationDeliveryForSystem(
  client: PoolClient,
  input: QueueMicrosoft365MailAutomationDeliveryInput & {
    tenantId: string;
    actorUserId?: string | null;
  }
) {
  const systemAuth = {
    tenantId: input.tenantId,
    id: input.actorUserId ?? null,
    authorityTier: "super_admin"
  } as AuthUser;

  return queueMicrosoft365MailAutomationDelivery(client, systemAuth, {
    related_record_type: input.related_record_type,
    related_record_id: input.related_record_id,
    template_key: input.template_key,
    trigger_type: input.trigger_type,
    contact_id: input.contact_id ?? null,
    recipient_name: input.recipient_name ?? null,
    recipient_email: input.recipient_email ?? null,
    source_change_key: input.source_change_key ?? null,
    secure_link: input.secure_link ?? null,
    extra_merge_context: input.extra_merge_context ?? undefined
  });
}

export async function replayMicrosoft365MailAutomationDelivery(
  client: PoolClient,
  auth: AuthUser,
  input: { delivery_id: string }
) {
  assertMailAutomationManageAccess(auth);
  ensureMailAutomationEnabled();
  await assertMailAutomationSchemaReady(client);
  const original = await loadDelivery(client, auth.tenantId, input.delivery_id);
  if (!original) {
    throw new ApiError(404, "Mail automation delivery not found.");
  }

  await recordDeliveryEvent(client, {
    tenantId: auth.tenantId,
    deliveryId: original.id,
    eventType: "replayed",
    actorUserId: auth.id,
    note: "Delivery replay requested.",
    metadata: {
      previous_status: original.status
    }
  });

  const result = await queueMicrosoft365MailAutomationDelivery(client, auth, {
    related_record_type: original.related_record_type,
    related_record_id: original.related_record_id,
    template_key: original.template_key,
    trigger_type: original.trigger_type,
    contact_id: original.contact_id ?? null,
    recipient_name: original.recipient_name ?? null,
    recipient_email: original.recipient_email,
    source_change_key: `${original.source_change_key ?? original.id}:replay:${Date.now()}`,
    secure_link:
      typeof original.merge_context?.secure_link === "string" ? (original.merge_context.secure_link as string) : null,
    extra_merge_context: Object.fromEntries(
      Object.entries(original.merge_context ?? {}).map(([key, value]) => [key, typeof value === "string" ? value : null])
    )
  });

  return {
    replayed_delivery_id: original.id,
    queued_delivery: result
  };
}

export async function recordMicrosoft365MailAutomationCallback(
  client: PoolClient,
  input: RecordMicrosoft365MailAutomationCallbackInput
) {
  await assertMailAutomationSchemaReady(client);
  const { rows } = await client.query<CallbackRouteRecord>(
    `
      SELECT
        id::text,
        tenant_id::text,
        related_record_type::text,
        related_record_id,
        canonical_dashboard_id,
        shared_mailbox_key,
        sender_alias,
        flow_key,
        status::text,
        template_key,
        recipient_email,
        sync_operation_id::text
      FROM microsoft_mail_automation_delivery
      WHERE id = $1
      LIMIT 1
    `,
    [input.delivery_id]
  );
  const delivery = rows[0];
  if (!delivery) {
    throw new ApiError(404, "Mail automation delivery not found.");
  }

  const status = callbackStatusSchema.parse(input.status);
  const metadata = input.metadata ?? {};
  await client.query(
    `
      UPDATE microsoft_mail_automation_delivery
      SET
        status = $2::microsoft_mail_automation_status,
        microsoft_message_id = COALESCE($3, microsoft_message_id),
        microsoft_message_url = COALESCE($4, microsoft_message_url),
        flow_run_id = COALESCE($5, flow_run_id),
        flow_run_url = COALESCE($6, flow_run_url),
        sent_at = CASE WHEN $2 = 'sent'::microsoft_mail_automation_status THEN now() ELSE sent_at END,
        last_error = CASE
          WHEN $2 = 'failed'::microsoft_mail_automation_status THEN COALESCE($7, $8, 'Mail automation callback reported a failure.')
          WHEN $2 = 'skipped'::microsoft_mail_automation_status THEN COALESCE($8, 'Mail automation callback reported a skipped send.')
          ELSE NULL
        END,
        last_error_at = CASE
          WHEN $2 IN ('failed'::microsoft_mail_automation_status, 'skipped'::microsoft_mail_automation_status) THEN now()
          ELSE last_error_at
        END,
        metadata = COALESCE(metadata, '{}'::jsonb) || $9::jsonb,
        updated_at = now()
      WHERE id = $1
    `,
    [
      input.delivery_id,
      status,
      input.provider_message_id ?? null,
      input.provider_message_url ?? null,
      input.flow_run_id ?? null,
      input.flow_run_url ?? null,
      input.error_code ?? null,
      input.error_message ?? null,
      JSON.stringify(metadata)
    ]
  );

  await recordDeliveryEvent(client, {
    tenantId: delivery.tenant_id,
    deliveryId: delivery.id,
    eventType: "callback_received",
    note: "Power Automate callback received.",
    metadata: {
      status,
      flow_run_id: input.flow_run_id ?? null,
      provider_message_id: input.provider_message_id ?? null
    }
  });

  await recordDeliveryEvent(client, {
    tenantId: delivery.tenant_id,
    deliveryId: delivery.id,
    eventType: status === "sent" ? "sent" : status === "skipped" ? "skipped" : "failed",
    note:
      status === "sent"
        ? "Client email send confirmed."
        : status === "skipped"
          ? "Client email send was skipped by the automation flow."
          : "Client email send failed.",
    metadata: {
      error_code: input.error_code ?? null,
      error_message: input.error_message ?? null,
      flow_run_url: input.flow_run_url ?? null,
      provider_message_url: input.provider_message_url ?? null
    }
  });

  if (input.provider_message_id) {
    await client.query(
      `
        INSERT INTO external_object_map (tenant_id, provider, external_id, object_type, object_id, payload)
        VALUES ($1, 'microsoft365_mail_automation', $2, 'mail_automation_delivery', $3::uuid, $4::jsonb)
        ON CONFLICT (tenant_id, provider, external_id, object_type)
        DO UPDATE SET
          object_id = EXCLUDED.object_id,
          payload = EXCLUDED.payload
      `,
      [
        delivery.tenant_id,
        input.provider_message_id,
        delivery.id,
        JSON.stringify({
          flow_key: delivery.flow_key,
          template_key: delivery.template_key,
          shared_mailbox_key: delivery.shared_mailbox_key,
          recipient_email: delivery.recipient_email,
          provider_message_url: input.provider_message_url ?? null,
          flow_run_id: input.flow_run_id ?? null,
          flow_run_url: input.flow_run_url ?? null
        })
      ]
    );
  }

  if (status === "failed" || status === "skipped") {
    await recordDeliveryEvent(client, {
      tenantId: delivery.tenant_id,
      deliveryId: delivery.id,
      eventType: "alerted",
      note: "Failure was recorded into Microsoft integration diagnostics.",
      metadata: {
        status,
        error_code: input.error_code ?? null
      }
    });
  }

  const syncOutcome = deriveMailAutomationCallbackSyncOutcome({
    deliveryId: delivery.id,
    recordType: delivery.related_record_type,
    recordId: delivery.related_record_id,
    canonicalDashboardId: delivery.canonical_dashboard_id,
    sharedMailboxKey: delivery.shared_mailbox_key,
    senderAlias: delivery.sender_alias,
    recipientEmail: delivery.recipient_email,
    status,
    providerMessageId: input.provider_message_id ?? null,
    providerMessageUrl: input.provider_message_url ?? null,
    flowRunId: input.flow_run_id ?? null,
    flowRunUrl: input.flow_run_url ?? null,
    errorCode: input.error_code ?? null,
    errorMessage: input.error_message ?? null
  });

  if (delivery.sync_operation_id && status !== "sent") {
    await markIntegrationSyncOperationFailed(client, {
      tenantId: delivery.tenant_id,
      operationId: delivery.sync_operation_id,
      errorMessage: syncOutcome.errorMessage ?? "Power Automate did not confirm client email delivery.",
      resultPayload: syncOutcome.resultPayload,
      metadata: {
        provider: "microsoft365_mail_automation"
      }
    });
  } else if (delivery.sync_operation_id) {
    await markIntegrationSyncOperationSucceeded(client, {
      tenantId: delivery.tenant_id,
      operationId: delivery.sync_operation_id,
      resultPayload: syncOutcome.resultPayload,
      metadata: {
        provider: "microsoft365_mail_automation"
      }
    });
  }

  await recordMicrosoftIntegrationEvent(client, {
    tenantId: delivery.tenant_id,
    integrationArea: "mail_automation",
    eventLevel: status === "sent" ? "info" : "error",
    eventType:
      status === "sent"
        ? "mail_automation.callback.sent"
        : status === "skipped"
          ? "mail_automation.callback.skipped"
          : "mail_automation.callback.failed",
    eventStatus: status,
    summary:
      status === "sent"
        ? `Power Automate confirmed client email delivery for ${delivery.recipient_email}.`
        : `Power Automate reported ${status} for client email delivery ${delivery.id}.`,
    detail: {
      delivery_id: delivery.id,
      flow_key: delivery.flow_key,
      shared_mailbox_key: delivery.shared_mailbox_key,
      provider_message_id: input.provider_message_id ?? null,
      provider_message_url: input.provider_message_url ?? null,
      flow_run_id: input.flow_run_id ?? null,
      flow_run_url: input.flow_run_url ?? null,
      error_code: input.error_code ?? null,
      error_message: input.error_message ?? null
    },
    relatedEntityType: "microsoft_mail_automation_delivery",
    relatedEntityId: delivery.id,
    externalTarget: delivery.recipient_email
  });

  return loadDelivery(client, delivery.tenant_id, delivery.id);
}

export async function listMicrosoft365MailAutomationDeliveriesForSyncOperation(
  client: PoolClient,
  tenantId: string,
  syncOperationId: string
) {
  await assertMailAutomationSchemaReady(client);
  const { rows } = await client.query<DeliveryRow>(
    `
      SELECT
        id::text,
        tenant_id::text,
        provider,
        related_record_type::text,
        related_record_id,
        canonical_dashboard_id,
        contact_id::text,
        recipient_name,
        recipient_email,
        shared_mailbox_key,
        sender_alias,
        template_key,
        template_url,
        flow_key,
        trigger_type::text,
        status::text,
        subject_hint,
        merge_context,
        dashboard_url,
        microsoft_message_id,
        microsoft_message_url,
        flow_run_id,
        flow_run_url,
        sync_operation_id::text,
        source_change_key,
        attempt_count,
        queued_at::text,
        first_dispatched_at::text,
        last_dispatched_at::text,
        sent_at::text,
        last_error,
        last_error_at::text,
        metadata,
        created_by_user_id::text,
        updated_by_user_id::text,
        created_at::text,
        updated_at::text
      FROM microsoft_mail_automation_delivery
      WHERE tenant_id = $1
        AND sync_operation_id = $2::uuid
      ORDER BY created_at DESC
      `,
      [tenantId, syncOperationId]
    );
  const eventsByDelivery = await loadEventsForDeliveries(
    client,
    tenantId,
    rows.map((row) => row.id)
  );
  return rows.map((row) => decorateMailAutomationDeliveryRow(row, eventsByDelivery.get(row.id) ?? []));
}

export async function getMicrosoft365MailAutomationSyncOperationPayload(
  client: PoolClient,
  tenantId: string,
  operationId: string
) {
  await assertMailAutomationSchemaReady(client);
  const operation = await getIntegrationSyncOperation(client, tenantId, operationId);
  if (!operation) {
    return null;
  }
  const deliveries = await listMicrosoft365MailAutomationDeliveriesForSyncOperation(client, tenantId, operationId);
  return {
    operation,
    deliveries
  };
}

export async function markMicrosoft365MailAutomationDeliveryDispatching(
  client: PoolClient,
  input: {
    tenantId: string;
    deliveryId: string;
    syncOperationId: string;
  }
) {
  await assertMailAutomationSchemaReady(client);
  await client.query(
    `
      UPDATE microsoft_mail_automation_delivery
      SET
        status = 'dispatching'::microsoft_mail_automation_status,
        attempt_count = attempt_count + 1,
        first_dispatched_at = COALESCE(first_dispatched_at, now()),
        last_dispatched_at = now(),
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2::uuid
    `,
    [input.tenantId, input.deliveryId]
  );
  await recordDeliveryEvent(client, {
    tenantId: input.tenantId,
    deliveryId: input.deliveryId,
    eventType: "dispatching",
    note: "Delivery handed to the worker for Power Automate dispatch.",
    metadata: {
      sync_operation_id: input.syncOperationId
    }
  });
}

export async function markMicrosoft365MailAutomationDeliveryFlowAccepted(
  client: PoolClient,
  input: {
    tenantId: string;
    deliveryId: string;
    syncOperationId: string;
    flowRunId?: string | null;
    flowRunUrl?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await assertMailAutomationSchemaReady(client);
  await client.query(
    `
      UPDATE microsoft_mail_automation_delivery
      SET
        status = 'flow_accepted'::microsoft_mail_automation_status,
        flow_run_id = COALESCE($3, flow_run_id),
        flow_run_url = COALESCE($4, flow_run_url),
        last_error = NULL,
        last_error_at = NULL,
        metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2::uuid
    `,
    [input.tenantId, input.deliveryId, input.flowRunId ?? null, input.flowRunUrl ?? null, JSON.stringify(input.metadata ?? {})]
  );
  await recordDeliveryEvent(client, {
    tenantId: input.tenantId,
    deliveryId: input.deliveryId,
    eventType: "flow_accepted",
    note: "Power Automate accepted the send request.",
    metadata: {
      sync_operation_id: input.syncOperationId,
      flow_run_id: input.flowRunId ?? null,
      flow_run_url: input.flowRunUrl ?? null
    }
  });
}

export async function markMicrosoft365MailAutomationDeliveryDispatchFailed(
  client: PoolClient,
  input: {
    tenantId: string;
    deliveryId: string;
    errorMessage: string;
    metadata?: Record<string, unknown>;
  }
) {
  await assertMailAutomationSchemaReady(client);
  await client.query(
    `
      UPDATE microsoft_mail_automation_delivery
      SET
        status = 'failed'::microsoft_mail_automation_status,
        last_error = $3,
        last_error_at = now(),
        metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2::uuid
    `,
    [input.tenantId, input.deliveryId, input.errorMessage, JSON.stringify(input.metadata ?? {})]
  );
  await recordDeliveryEvent(client, {
    tenantId: input.tenantId,
    deliveryId: input.deliveryId,
    eventType: "failed",
    note: input.errorMessage,
    metadata: input.metadata
  });
  await recordDeliveryEvent(client, {
    tenantId: input.tenantId,
    deliveryId: input.deliveryId,
    eventType: "alerted",
    note: "Dispatch failure was recorded into diagnostics.",
    metadata: input.metadata
  });
}

export async function failMicrosoft365MailAutomationSyncOperation(
  client: PoolClient,
  input: {
    tenantId: string;
    operationId: string;
    deliveryId?: string | null;
    errorMessage: string;
    metadata?: Record<string, unknown>;
  }
) {
  if (input.deliveryId) {
    await markMicrosoft365MailAutomationDeliveryDispatchFailed(client, {
      tenantId: input.tenantId,
      deliveryId: input.deliveryId,
      errorMessage: input.errorMessage,
      metadata: input.metadata
    });
  }
  await markIntegrationSyncOperationFailed(client, {
    tenantId: input.tenantId,
    operationId: input.operationId,
    errorMessage: input.errorMessage,
    resultPayload: input.metadata,
    metadata: {
      provider: "microsoft365_mail_automation"
    }
  });
}
