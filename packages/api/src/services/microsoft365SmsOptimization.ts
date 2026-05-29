import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { z } from "zod";
import { hasAuthorityTier } from "../authz/authority.js";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  Microsoft365SmsConsentRecord,
  Microsoft365SmsConsentStatus,
  Microsoft365SmsDeliveryRecord,
  Microsoft365SmsDeliveryStatus,
  Microsoft365SmsEventRecord,
  Microsoft365SmsKpiCard,
  Microsoft365SmsOptimizationArtifact,
  Microsoft365SmsOptimizationBaseline,
  Microsoft365SmsOptimizationCurrentStateFinding,
  Microsoft365SmsOptimizationDiagnosticsResponse,
  Microsoft365SmsOptimizationDocReference,
  Microsoft365SmsOptimizationEnvironment,
  Microsoft365SmsOptimizationGoNoGo,
  Microsoft365SmsOptimizationRecommendation,
  Microsoft365SmsOptimizationRefactorItem,
  Microsoft365SmsOptimizationValidationIssue,
  Microsoft365SmsOptimizationWorkspace,
  Microsoft365SmsRecordType,
  Microsoft365SmsSlaCard,
  Microsoft365SmsTemplateDefinition,
  Microsoft365SmsTriggerType,
  QueueMicrosoft365SmsDeliveryInput,
  RecordMicrosoft365SmsCallbackInput,
  SweepMicrosoft365SmsRemindersResult,
  UpsertMicrosoft365SmsConsentInput
} from "../types/microsoft365SmsOptimization.js";
import { resolveApiRepoPath } from "../utils/repoPaths.js";
import { createAuditLog } from "./audit.js";
import {
  markIntegrationSyncOperationFailed,
  markIntegrationSyncOperationSucceeded,
  queueIntegrationSyncOperation
} from "./integrationSync.js";
import { getMicrosoft365ClientIntakeValidationIssues } from "./microsoft365ClientIntake.js";
import { getMicrosoft365ClientIntakeOperationalControlValidationIssues } from "./microsoft365ClientIntakeOperations.js";
import { getMicrosoft365GovernanceValidationIssues } from "./microsoft365Governance.js";
import { getMicrosoft365MailAutomationValidationIssues } from "./microsoft365MailAutomation.js";
import { buildMicrosoft365CanonicalDashboardId } from "./microsoft365Provisioning.js";
import { recordMicrosoftIntegrationEvent } from "./microsoftIntegrationObservability.js";

const environmentSchema = z.enum(["development", "staging", "production"]);
const consentStatusSchema = z.enum(["unknown", "opted_in", "opted_out", "suppressed"]);
const recordTypeSchema = z.enum(["job", "job_readiness_item"]);
const triggerTypeSchema = z.enum(["reminder", "overdue", "manual"]);

const baselineSchema = z.object({
  phase: z.literal("phase8_sms_analytics_optimization_layer"),
  baseline_version: z.string().trim().min(1),
  environment: environmentSchema,
  tenant_tier: z.enum(["sandbox", "preproduction", "production"]),
  sms_policy: z.object({
    sms_scope_rule: z.string().trim().min(1),
    sensitive_content_rule: z.string().trim().min(1),
    secure_link_rule: z.string().trim().min(1),
    opt_in_rule: z.string().trim().min(1),
    opt_out_rule: z.string().trim().min(1),
    manual_override_rule: z.string().trim().min(1),
    consent_retention_rule: z.string().trim().min(1)
  }),
  sender_profiles: z
    .array(
      z.object({
        sender_key: z.string().trim().min(1),
        display_name: z.string().trim().min(1),
        provider: z.enum(["azure_communication_services", "power_automate_sms_bridge"]),
        sender_number: z.string().trim().min(1),
        department_scope: z.string().trim().min(1).nullable(),
        related_record_types: z.array(recordTypeSchema).min(1),
        trigger_types: z.array(triggerTypeSchema).min(1),
        notes: z.string().trim().min(1).nullable()
      })
    )
    .min(1),
  template_schema: z
    .array(
      z.object({
        template_key: z.string().trim().min(1),
        trigger_type: triggerTypeSchema,
        department_scope: z.string().trim().min(1).nullable(),
        sender_key: z.string().trim().min(1),
        body_template: z.string().trim().min(1),
        allowed_tokens: z.array(z.string().trim().min(1)).min(1),
        max_length: z.number().int().min(20).max(320),
        forbidden_content_rules: z.array(z.string().trim().min(1)).min(1),
        notes: z.string().trim().min(1)
      })
    )
    .min(1),
  flow_inventory: z
    .array(
      z.object({
        flow_key: z.string().trim().min(1),
        trigger_type: triggerTypeSchema,
        template_key: z.string().trim().min(1),
        provider: z.enum(["azure_communication_services", "power_automate_sms_bridge"]),
        callback_required: z.boolean(),
        failure_alert_target: z.string().trim().min(1),
        retry_rule: z.string().trim().min(1),
        notes: z.string().trim().min(1)
      })
    )
    .min(1),
  kpi_definitions: z
    .array(
      z.object({
        key: z.string().trim().min(1),
        title: z.string().trim().min(1),
        description: z.string().trim().min(1),
        target_rule: z.string().trim().min(1),
        data_rule: z.string().trim().min(1)
      })
    )
    .min(1),
  sla_definitions: z
    .array(
      z.object({
        key: z.string().trim().min(1),
        title: z.string().trim().min(1),
        description: z.string().trim().min(1),
        threshold_hours: z.number().int().positive(),
        breach_rule: z.string().trim().min(1)
      })
    )
    .min(1),
  optimization_rules: z.object({
    reminder_effectiveness_window_hours: z.number().int().positive(),
    overdue_backlog_warning_threshold: z.number().int().nonnegative(),
    review_cycle_warning_hours: z.number().positive(),
    upload_turnaround_warning_hours: z.number().positive(),
    bottleneck_grouping_rule: z.string().trim().min(1)
  }),
  execution_order: z.array(z.object({
    order: z.number().int().positive(),
    title: z.string().trim().min(1),
    owner: z.string().trim().min(1),
    requires_tenant_admin: z.boolean(),
    rollback: z.string().trim().min(1)
  })).min(1),
  manual_admin_checklist: z.array(z.object({
    order: z.number().int().positive(),
    step: z.string().trim().min(1),
    portal: z.string().trim().min(1).nullable(),
    requires_tenant_admin: z.boolean(),
    owner: z.string().trim().min(1)
  })).min(1),
  validation_checklist: z.array(z.string().trim().min(1)).min(1),
  rollback_principles: z.array(z.string().trim().min(1)).min(1)
});

const DOCS: Microsoft365SmsOptimizationDocReference[] = [
  {
    key: "phase_summary",
    title: "Phase 8 SMS, Analytics, and Optimization Layer",
    path: "docs/microsoft365/phase8-sms-analytics-optimization-layer.md",
    summary: "Primary phase audit, SMS policy, delivery logging, KPI/SLA design, and rollout guidance."
  },
  {
    key: "sms_policy",
    title: "SMS Policy and Consent Model",
    path: "docs/microsoft365/sms-policy-and-consent-model.md",
    summary: "Defines reminder-only SMS rules, consent capture requirements, opt-out handling, and safe content boundaries."
  },
  {
    key: "kpi_sla",
    title: "Operational KPI and SLA Definitions",
    path: "docs/microsoft365/operational-kpi-and-sla-definitions.md",
    summary: "Defines overdue, review-cycle, upload-turnaround, reminder-effectiveness, and bottleneck metrics."
  }
];

const ARTIFACTS: Microsoft365SmsOptimizationArtifact[] = [
  {
    kind: "baseline",
    path: "ops/microsoft365/phase8/sms-optimization-baseline.development.json",
    summary: "Development baseline for SMS policy, templates, KPIs, and SLA metrics.",
    tenant_admin_action: false
  },
  {
    kind: "baseline",
    path: "ops/microsoft365/phase8/sms-optimization-baseline.staging.json",
    summary: "Staging baseline for pilot SMS and optimization validation.",
    tenant_admin_action: false
  },
  {
    kind: "baseline",
    path: "ops/microsoft365/phase8/sms-optimization-baseline.production.json",
    summary: "Production baseline for reminder-only SMS, KPI visibility, and SLA monitoring.",
    tenant_admin_action: false
  },
  {
    kind: "script",
    path: "ops/microsoft365/phase8/Test-M365SmsOptimizationBaseline.ps1",
    summary: "Validates the Phase 8 SMS and optimization baseline without changing the tenant.",
    tenant_admin_action: true
  },
  {
    kind: "script",
    path: "ops/microsoft365/phase8/Get-M365SmsOptimizationPlan.ps1",
    summary: "Renders the sender, template, flow, KPI, and SLA plan for an environment or record type.",
    tenant_admin_action: false
  },
  {
    kind: "api",
    path: "GET /api/admin/system/microsoft-sms-optimization",
    summary: "Admin diagnostics payload for SMS consent posture, deliveries, KPIs, and SLA visibility.",
    tenant_admin_action: false
  }
];

type ConsentRow = Omit<Microsoft365SmsConsentRecord, "metadata"> & {
  metadata: Record<string, unknown> | null;
};

type DeliveryRow = Omit<Microsoft365SmsDeliveryRecord, "metadata"> & {
  metadata: Record<string, unknown> | null;
};

type EventRow = Omit<Microsoft365SmsEventRecord, "metadata"> & {
  metadata: Record<string, unknown> | null;
};

type SmsContext = {
  relatedRecordType: Microsoft365SmsRecordType;
  relatedRecordId: string;
  canonicalDashboardId: string;
  dashboardUrl: string | null;
  jobId: string;
  requiredItemId: string | null;
  organizationId: string | null;
  contactId: string | null;
  departmentScope: string | null;
  relatedRecordLabel: string | null;
  organizationName: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  dueAt: string | null;
  isComplete: boolean | null;
};

type ReminderCandidateRow = {
  id: string;
  related_record_type: Microsoft365SmsRecordType;
  related_record_id: string;
  request_link_url: string;
  status: string;
  reminder_enabled: boolean;
  related_record_label: string | null;
  last_submission_status: string | null;
  last_submission_exception_state: string | null;
};

type SmsWorkspaceMetrics = {
  optedInCount: number;
  optedOutCount: number;
  suppressedConsentCount: number;
  pendingDeliveryCount: number;
  failedDeliveryCount: number;
  backlogCount: number;
  overdueRequiredItemCount: number;
  reviewSlaBreachCount: number;
  uploadSlaBreachCount: number;
  avgReviewCycleHours: number | null;
  avgUploadTurnaroundHours: number | null;
  reminderEffectivenessRate: number | null;
  reminderDeliveryCount: number;
};

function resolveEnvironment(): Microsoft365SmsOptimizationEnvironment {
  if (config.MICROSOFT_365_SMS_OPTIMIZATION_ENV) {
    return config.MICROSOFT_365_SMS_OPTIMIZATION_ENV;
  }
  if (config.NODE_ENV === "production") {
    return "production";
  }
  return "development";
}

function getBaselinePath(environment: Microsoft365SmsOptimizationEnvironment) {
  return resolveApiRepoPath("ops", "microsoft365", "phase8", `sms-optimization-baseline.${environment}.json`);
}

function loadBaseline(environment = resolveEnvironment()): Microsoft365SmsOptimizationBaseline {
  const raw = readFileSync(getBaselinePath(environment), "utf8");
  const parsed = baselineSchema.parse(JSON.parse(raw));
  if (parsed.environment !== environment) {
    throw new Error(`Microsoft 365 SMS optimization baseline environment mismatch: expected ${environment}, found ${parsed.environment}.`);
  }
  return parsed;
}

function determineRecommendation(issues: Microsoft365SmsOptimizationValidationIssue[]): Microsoft365SmsOptimizationGoNoGo {
  if (issues.some((issue) => issue.severity === "error")) {
    return "no_go";
  }
  if (issues.length > 0) {
    return "conditional_go";
  }
  return "go";
}

function normalizePhoneNumber(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  if (digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }
  return null;
}

function formatShortDate(value: string | null) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function buildDashboardUrl(recordType: Microsoft365SmsRecordType, recordId: string, jobId?: string | null) {
  const base = config.ADMIN_WEB_URL.replace(/\/$/, "");
  if (recordType === "job") {
    return `${base}/jobs/${recordId}`;
  }
  return `${base}/jobs/${jobId ?? ""}#required-item-${recordId}`;
}

function parseConsentRow(row: ConsentRow): Microsoft365SmsConsentRecord {
  return {
    ...row,
    metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {}
  };
}

function parseDeliveryRow(row: DeliveryRow): Microsoft365SmsDeliveryRecord {
  return {
    ...row,
    attempt_count: Number(row.attempt_count ?? 0),
    metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {}
  };
}

function parseEventRow(row: EventRow): Microsoft365SmsEventRecord {
  return {
    ...row,
    metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {}
  };
}

async function hasPhase8Schema(client: PoolClient) {
  const { rows } = await client.query<{ ready: boolean }>(
    `
      SELECT (
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'microsoft_sms_consent')
        AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'microsoft_sms_delivery')
        AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'microsoft_sms_event')
      ) AS ready
    `
  );
  return Boolean(rows[0]?.ready);
}

async function listMicrosoft365SmsDeliveriesForDiagnostics(
  client: PoolClient,
  tenantId: string,
  limit: number
): Promise<Array<Microsoft365SmsDeliveryRecord & { events: Microsoft365SmsEventRecord[] }>> {
  const normalizedLimit = Math.min(Math.max(limit, 1), 50);
  const { rows } = await client.query<DeliveryRow>(
    `
      SELECT
        delivery.id::text,
        delivery.tenant_id::text,
        delivery.provider,
        delivery.related_record_type::text,
        delivery.related_record_id,
        delivery.canonical_dashboard_id,
        delivery.job_id::text,
        delivery.required_item_id::text,
        delivery.organization_id::text,
        delivery.contact_id::text,
        contact.full_name AS contact_name,
        delivery.consent_id::text,
        delivery.recipient_name,
        delivery.recipient_phone_number,
        delivery.normalized_phone_number,
        delivery.sender_key,
        delivery.sender_number,
        delivery.template_key,
        delivery.flow_key,
        delivery.trigger_type::text,
        delivery.status::text,
        delivery.message_body,
        delivery.dashboard_url,
        delivery.secure_link_url,
        delivery.provider_message_id,
        delivery.provider_message_url,
        delivery.flow_run_id,
        delivery.flow_run_url,
        delivery.sync_operation_id::text,
        delivery.source_change_key,
        delivery.attempt_count,
        delivery.queued_at::text,
        delivery.first_dispatched_at::text,
        delivery.last_dispatched_at::text,
        delivery.sent_at::text,
        delivery.delivered_at::text,
        delivery.last_error,
        delivery.last_error_at::text,
        delivery.metadata,
        delivery.created_by_user_id::text,
        delivery.updated_by_user_id::text,
        delivery.created_at::text,
        delivery.updated_at::text
      FROM microsoft_sms_delivery delivery
      LEFT JOIN organization_contact contact
        ON contact.id = delivery.contact_id
      WHERE delivery.tenant_id = $1
      ORDER BY COALESCE(delivery.delivered_at, delivery.sent_at, delivery.queued_at, delivery.created_at) DESC
      LIMIT $2
    `,
    [tenantId, normalizedLimit]
  );

  if (!rows.length) {
    return [];
  }

  const deliveryIds = rows.map((row) => row.id);
  const eventsResult = await client.query<EventRow>(
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
      FROM microsoft_sms_event
      WHERE tenant_id = $1
        AND delivery_id = ANY($2::uuid[])
      ORDER BY created_at ASC
    `,
    [tenantId, deliveryIds]
  );

  const eventsByDelivery = new Map<string, Microsoft365SmsEventRecord[]>();
  for (const row of eventsResult.rows) {
    const parsed = parseEventRow(row);
    const existing = eventsByDelivery.get(parsed.delivery_id) ?? [];
    existing.push(parsed);
    eventsByDelivery.set(parsed.delivery_id, existing);
  }

  return rows.map((row) => {
    const parsed = parseDeliveryRow(row);
    return {
      ...parsed,
      events: eventsByDelivery.get(parsed.id) ?? []
    };
  });
}

async function assertPhase8SchemaReady(client: PoolClient) {
  if (!(await hasPhase8Schema(client))) {
    throw new ApiError(503, "Phase 8 SMS optimization schema is not available in this environment.");
  }
}

function ensureSmsOptimizationEnabled() {
  if (!config.MICROSOFT_365_SMS_OPTIMIZATION_ENABLED) {
    throw new ApiError(503, "Microsoft 365 SMS optimization is disabled in this environment.");
  }
}

function assertReadAccess(auth: Pick<AuthUser, "authorityTier">) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    throw new ApiError(403, "You do not have access to review SMS optimization.");
  }
}

function assertManageAccess(auth: Pick<AuthUser, "authorityTier">) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "You do not have access to manage SMS optimization.");
  }
}

function getSenderProfile(
  baseline: Microsoft365SmsOptimizationBaseline,
  input: {
    relatedRecordType: Microsoft365SmsRecordType;
    departmentScope: string | null;
    triggerType: Microsoft365SmsTriggerType;
  }
) {
  return (
    baseline.sender_profiles.find(
      (profile) =>
        profile.department_scope === input.departmentScope &&
        profile.related_record_types.includes(input.relatedRecordType) &&
        profile.trigger_types.includes(input.triggerType)
    ) ??
    baseline.sender_profiles.find(
      (profile) =>
        profile.department_scope === null &&
        profile.related_record_types.includes(input.relatedRecordType) &&
        profile.trigger_types.includes(input.triggerType)
    ) ??
    null
  );
}

function getTemplateDefinition(
  baseline: Microsoft365SmsOptimizationBaseline,
  input: {
    templateKey: string;
    departmentScope: string | null;
  }
) {
  return (
    baseline.template_schema.find(
      (template) => template.template_key === input.templateKey && template.department_scope === input.departmentScope
    ) ??
    baseline.template_schema.find((template) => template.template_key === input.templateKey && template.department_scope === null) ??
    null
  );
}

function getFlowDefinition(baseline: Microsoft365SmsOptimizationBaseline, templateKey: string) {
  return baseline.flow_inventory.find((flow) => flow.template_key === templateKey) ?? null;
}

function buildMergeContext(context: SmsContext, input: { secureLinkUrl?: string | null; supportPhone: string }) {
  const dueDate = formatShortDate(context.dueAt);
  const projectLabel =
    context.relatedRecordLabel ?? context.organizationName ?? context.canonicalDashboardId ?? "your project";
  const secureLink = input.secureLinkUrl ?? context.dashboardUrl ?? "";
  return {
    project_label: projectLabel,
    organization_name: context.organizationName ?? "your organization",
    due_date: dueDate,
    due_date_phrase: dueDate ? ` by ${dueDate}` : "",
    secure_link: secureLink,
    support_phone: input.supportPhone,
    required_item_label: context.relatedRecordType === "job_readiness_item" ? (context.relatedRecordLabel ?? "requested item") : "requested item"
  };
}

function renderSmsBody(template: Microsoft365SmsTemplateDefinition, mergeContext: Record<string, string>) {
  const tokenPattern = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  const seenTokens = new Set<string>();
  const rendered = template.body_template.replace(tokenPattern, (_full, rawToken) => {
    const token = String(rawToken).trim();
    seenTokens.add(token);
    if (!template.allowed_tokens.includes(token)) {
      throw new ApiError(400, `SMS template ${template.template_key} uses a token that is not allowed: ${token}`);
    }
    return mergeContext[token] ?? "";
  });

  if (seenTokens.size === 0) {
    throw new ApiError(400, `SMS template ${template.template_key} must use the approved merge-token pattern.`);
  }
  const compact = rendered.replace(/\s+/g, " ").trim();
  if (compact.length > template.max_length) {
    throw new ApiError(400, `SMS template ${template.template_key} exceeds the allowed SMS length.`);
  }
  return compact;
}

async function resolveSmsContext(
  client: PoolClient,
  tenantId: string,
  relatedRecordType: Microsoft365SmsRecordType,
  relatedRecordId: string
): Promise<SmsContext> {
  if (relatedRecordType === "job") {
    const { rows } = await client.query<{
      id: string;
      job_number: string | null;
      title: string | null;
      department_type: string | null;
      client_deadline_at: string | null;
      organization_id: string | null;
      organization_name: string | null;
      primary_contact_id: string | null;
      primary_contact_name: string | null;
      primary_contact_phone: string | null;
    }>(
      `
        SELECT
          j.id::text,
          j.job_number,
          j.title,
          j.department_type::text,
          j.client_deadline_at::text,
          j.organization_id::text,
          org.display_name AS organization_name,
          contact.id::text AS primary_contact_id,
          contact.full_name AS primary_contact_name,
          contact.phone AS primary_contact_phone
        FROM jobs j
        LEFT JOIN organization org
          ON org.id = j.organization_id
        LEFT JOIN organization_contact contact
          ON contact.id = j.primary_contact_id
        WHERE j.tenant_id = $1
          AND j.id = $2::uuid
        LIMIT 1
      `,
      [tenantId, relatedRecordId]
    );
    const row = rows[0];
    if (!row) {
      throw new ApiError(404, "Job not found.");
    }
    return {
      relatedRecordType: "job",
      relatedRecordId: row.id,
      canonicalDashboardId: buildMicrosoft365CanonicalDashboardId("job", row.id),
      dashboardUrl: buildDashboardUrl("job", row.id),
      jobId: row.id,
      requiredItemId: null,
      organizationId: row.organization_id,
      contactId: row.primary_contact_id,
      departmentScope: row.department_type,
      relatedRecordLabel: row.title ?? row.job_number,
      organizationName: row.organization_name,
      recipientName: row.primary_contact_name,
      recipientPhone: row.primary_contact_phone,
      dueAt: row.client_deadline_at,
      isComplete: null
    };
  }

  const { rows } = await client.query<{
    id: string;
    label: string | null;
    due_at: string | null;
    is_complete: boolean;
    job_id: string;
    job_number: string | null;
    job_title: string | null;
    department_type: string | null;
    organization_id: string | null;
    organization_name: string | null;
    primary_contact_id: string | null;
    primary_contact_name: string | null;
    primary_contact_phone: string | null;
  }>(
    `
      SELECT
        item.id::text,
        item.label,
        item.due_at::text,
        item.is_complete,
        item.job_id::text,
        j.job_number,
        j.title AS job_title,
        j.department_type::text,
        j.organization_id::text,
        org.display_name AS organization_name,
        contact.id::text AS primary_contact_id,
        contact.full_name AS primary_contact_name,
        contact.phone AS primary_contact_phone
      FROM job_readiness_items item
      JOIN jobs j
        ON j.tenant_id = item.tenant_id
       AND j.id = item.job_id
      LEFT JOIN organization org
        ON org.id = j.organization_id
      LEFT JOIN organization_contact contact
        ON contact.id = j.primary_contact_id
      WHERE item.tenant_id = $1
        AND item.id = $2::uuid
      LIMIT 1
    `,
    [tenantId, relatedRecordId]
  );
  const row = rows[0];
  if (!row) {
    throw new ApiError(404, "Required item not found.");
  }
  return {
    relatedRecordType: "job_readiness_item",
    relatedRecordId: row.id,
    canonicalDashboardId: buildMicrosoft365CanonicalDashboardId("job_readiness_item", row.id),
    dashboardUrl: buildDashboardUrl("job_readiness_item", row.id, row.job_id),
    jobId: row.job_id,
    requiredItemId: row.id,
    organizationId: row.organization_id,
    contactId: row.primary_contact_id,
    departmentScope: row.department_type,
    relatedRecordLabel: row.label ?? row.job_title ?? row.job_number,
    organizationName: row.organization_name,
    recipientName: row.primary_contact_name,
    recipientPhone: row.primary_contact_phone,
    dueAt: row.due_at,
    isComplete: row.is_complete
  };
}

async function loadConsentByNormalizedPhone(client: PoolClient, tenantId: string, normalizedPhoneNumber: string) {
  const { rows } = await client.query<ConsentRow>(
    `
      SELECT
        consent.id::text,
        consent.tenant_id::text,
        consent.organization_id::text,
        consent.contact_id::text,
        contact.full_name AS contact_name,
        contact.email AS contact_email,
        consent.phone_number,
        consent.normalized_phone_number,
        consent.consent_status::text,
        consent.consent_source::text,
        consent.consent_captured_at::text,
        consent.consent_expires_at::text,
        consent.last_confirmed_at::text,
        consent.suppress_until::text,
        consent.opt_out_reason,
        consent.metadata,
        consent.created_by_user_id::text,
        consent.updated_by_user_id::text,
        consent.created_at::text,
        consent.updated_at::text
      FROM microsoft_sms_consent consent
      LEFT JOIN organization_contact contact
        ON contact.id = consent.contact_id
      WHERE consent.tenant_id = $1
        AND consent.normalized_phone_number = $2
      LIMIT 1
    `,
    [tenantId, normalizedPhoneNumber]
  );
  return rows[0] ? parseConsentRow(rows[0]) : null;
}

async function loadDelivery(client: PoolClient, tenantId: string, deliveryId: string) {
  const { rows } = await client.query<DeliveryRow>(
    `
      SELECT
        delivery.id::text,
        delivery.tenant_id::text,
        delivery.provider,
        delivery.related_record_type::text,
        delivery.related_record_id,
        delivery.canonical_dashboard_id,
        delivery.job_id::text,
        delivery.required_item_id::text,
        delivery.organization_id::text,
        delivery.contact_id::text,
        contact.full_name AS contact_name,
        delivery.consent_id::text,
        delivery.recipient_name,
        delivery.recipient_phone_number,
        delivery.normalized_phone_number,
        delivery.sender_key,
        delivery.sender_number,
        delivery.template_key,
        delivery.flow_key,
        delivery.trigger_type::text,
        delivery.status::text,
        delivery.message_body,
        delivery.dashboard_url,
        delivery.secure_link_url,
        delivery.provider_message_id,
        delivery.provider_message_url,
        delivery.flow_run_id,
        delivery.flow_run_url,
        delivery.sync_operation_id::text,
        delivery.source_change_key,
        delivery.attempt_count,
        delivery.queued_at::text,
        delivery.first_dispatched_at::text,
        delivery.last_dispatched_at::text,
        delivery.sent_at::text,
        delivery.delivered_at::text,
        delivery.last_error,
        delivery.last_error_at::text,
        delivery.metadata,
        delivery.created_by_user_id::text,
        delivery.updated_by_user_id::text,
        delivery.created_at::text,
        delivery.updated_at::text
      FROM microsoft_sms_delivery delivery
      LEFT JOIN organization_contact contact
        ON contact.id = delivery.contact_id
      WHERE delivery.tenant_id = $1
        AND delivery.id = $2::uuid
      LIMIT 1
    `,
    [tenantId, deliveryId]
  );
  return rows[0] ? parseDeliveryRow(rows[0]) : null;
}

async function loadDeliveryEvents(client: PoolClient, tenantId: string, deliveryIds: string[]) {
  if (!deliveryIds.length) {
    return new Map<string, Microsoft365SmsEventRecord[]>();
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
      FROM microsoft_sms_event
      WHERE tenant_id = $1
        AND delivery_id = ANY($2::uuid[])
      ORDER BY occurred_at DESC
    `,
    [tenantId, deliveryIds]
  );
  const map = new Map<string, Microsoft365SmsEventRecord[]>();
  for (const row of rows) {
    const parsed = parseEventRow(row);
    const list = map.get(parsed.delivery_id) ?? [];
    list.push(parsed);
    map.set(parsed.delivery_id, list);
  }
  return map;
}

async function recordSmsEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    deliveryId: string;
    eventType: string;
    actorUserId?: string | null;
    note?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      INSERT INTO microsoft_sms_event (tenant_id, delivery_id, event_type, actor_user_id, note, metadata)
      VALUES ($1,$2::uuid,$3::microsoft_sms_event_type,$4::uuid,$5,$6::jsonb)
    `,
    [input.tenantId, input.deliveryId, input.eventType, input.actorUserId ?? null, input.note ?? null, JSON.stringify(input.metadata ?? {})]
  );
}

export function getMicrosoft365SmsOptimizationValidationIssues(): Microsoft365SmsOptimizationValidationIssue[] {
  const issues: Microsoft365SmsOptimizationValidationIssue[] = [];
  let baseline: Microsoft365SmsOptimizationBaseline | null = null;
  try {
    baseline = loadBaseline(resolveEnvironment());
  } catch (error) {
    issues.push({
      area: "baseline",
      severity: "error",
      code: "phase8.baseline_unreadable",
      summary: "Phase 8 SMS optimization baseline could not be loaded.",
      details: {
        message: error instanceof Error ? error.message : "Unknown baseline parse error."
      }
    });
    return issues;
  }

  if (!config.MICROSOFT_365_SMS_OPTIMIZATION_ENABLED) {
    return issues;
  }

  if (!config.API_PUBLIC_URL) {
    issues.push({
      area: "phase8",
      severity: "error",
      code: "phase8.api_public_url.missing",
      summary: "SMS optimization is enabled but API_PUBLIC_URL is missing."
    });
  }
  if (!config.MICROSOFT_365_SMS_FROM_NUMBER) {
    issues.push({
      area: "phase8",
      severity: "error",
      code: "phase8.sender_number.missing",
      summary: "SMS optimization is enabled but MICROSOFT_365_SMS_FROM_NUMBER is missing."
    });
  }
  if (!(config.MICROSOFT_365_SMS_TIMEOUT_MS > 0)) {
    issues.push({
      area: "phase8",
      severity: "error",
      code: "phase8.timeout.invalid",
      summary: "SMS optimization requires a positive MICROSOFT_365_SMS_TIMEOUT_MS value."
    });
  }
  if (!Object.keys(config.MICROSOFT_365_SMS_FLOW_ENDPOINTS).length) {
    issues.push({
      area: "phase8",
      severity: "error",
      code: "phase8.flow_endpoints.missing",
      summary: "SMS optimization is enabled but MICROSOFT_365_SMS_FLOW_ENDPOINTS is empty."
    });
  }
  for (const flow of baseline.flow_inventory) {
    if (!config.MICROSOFT_365_SMS_FLOW_ENDPOINTS[flow.flow_key]) {
      issues.push({
        area: "phase8",
        severity: "error",
        code: `phase8.flow_endpoint_missing.${flow.flow_key}`,
        summary: `SMS optimization flow ${flow.flow_key} is missing from MICROSOFT_365_SMS_FLOW_ENDPOINTS.`
      });
    }
  }
  if (config.NODE_ENV === "production" && !config.MICROSOFT_365_SMS_CALLBACK_SECRET) {
    issues.push({
      area: "phase8",
      severity: "error",
      code: "phase8.callback_secret.missing",
      summary: "SMS optimization is enabled in production but MICROSOFT_365_SMS_CALLBACK_SECRET is missing."
    });
  }
  if (!config.MICROSOFT_365_CLIENT_INTAKE_ENABLED) {
    issues.push({
      area: "dependency",
      severity: "error",
      code: "phase8.client_intake.disabled",
      summary: "SMS optimization depends on Microsoft 365 client intake mappings, but Phase 5 client intake is disabled."
    });
  }
  if (!config.MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED) {
    issues.push({
      area: "dependency",
      severity: "warning",
      code: "phase8.client_intake_operations.disabled",
      summary: "Client intake operational control is disabled, so some review-cycle and SLA metrics will be incomplete."
    });
  }
  if (!config.MICROSOFT_365_MAIL_AUTOMATION_ENABLED) {
    issues.push({
      area: "dependency",
      severity: "warning",
      code: "phase8.mail_automation.disabled",
      summary: "Mail automation is disabled, so reminder effectiveness will only reflect SMS and not email reminder coverage."
    });
  }
  for (const dependencyIssue of [
    ...getMicrosoft365GovernanceValidationIssues(),
    ...getMicrosoft365ClientIntakeValidationIssues(),
    ...getMicrosoft365ClientIntakeOperationalControlValidationIssues(),
    ...getMicrosoft365MailAutomationValidationIssues()
  ]) {
    if (dependencyIssue.severity === "error") {
      issues.push({
        area: "dependency",
        severity: "warning",
        code: `phase8.dependency.${dependencyIssue.code}`,
        summary: dependencyIssue.summary
      });
    }
  }
  for (const sender of baseline.sender_profiles) {
    if (!normalizePhoneNumber(sender.sender_number)) {
      issues.push({
        area: "sender_profiles",
        severity: "error",
        code: `phase8.sender_number_invalid.${sender.sender_key}`,
        summary: `Sender profile ${sender.sender_key} does not use a valid E.164-style phone number.`
      });
    }
  }
  return issues;
}

export function assertMicrosoft365SmsOptimizationStartupConfig() {
  const errors = getMicrosoft365SmsOptimizationValidationIssues().filter((issue) => issue.severity === "error");
  if ((config.MICROSOFT_365_SMS_STRICT_VALIDATION || config.NODE_ENV === "production") && errors.length > 0) {
    throw new Error(
      `Microsoft 365 SMS optimization startup validation failed: ${errors.map((issue) => `${issue.area}:${issue.code}`).join(", ")}`
    );
  }
}

export function getPublicMicrosoft365SmsOptimizationHealthSummary() {
  const issues = getMicrosoft365SmsOptimizationValidationIssues();
  let baseline: Microsoft365SmsOptimizationBaseline | null = null;
  try {
    baseline = loadBaseline(resolveEnvironment());
  } catch {
    baseline = null;
  }
  return {
    baseline_environment: resolveEnvironment(),
    enabled: Boolean(config.MICROSOFT_365_SMS_OPTIMIZATION_ENABLED),
    provider: config.MICROSOFT_365_SMS_PROVIDER,
    startup_valid: issues.every((issue) => issue.severity !== "error"),
    issue_count: issues.length,
    sender_profile_count: baseline?.sender_profiles.length ?? 0,
    template_count: baseline?.template_schema.length ?? 0,
    kpi_count: baseline?.kpi_definitions.length ?? 0,
    recommendation: determineRecommendation(issues)
  };
}

export async function listMicrosoft365SmsConsents(
  client: PoolClient,
  auth: AuthUser,
  input: { contactId?: string | null; consentStatus?: Microsoft365SmsConsentStatus | null; limit?: number } = {}
) {
  assertReadAccess(auth);
  ensureSmsOptimizationEnabled();
  await assertPhase8SchemaReady(client);

  const { rows } = await client.query<ConsentRow>(
    `
      SELECT
        consent.id::text,
        consent.tenant_id::text,
        consent.organization_id::text,
        consent.contact_id::text,
        contact.full_name AS contact_name,
        contact.email AS contact_email,
        consent.phone_number,
        consent.normalized_phone_number,
        consent.consent_status::text,
        consent.consent_source::text,
        consent.consent_captured_at::text,
        consent.consent_expires_at::text,
        consent.last_confirmed_at::text,
        consent.suppress_until::text,
        consent.opt_out_reason,
        consent.metadata,
        consent.created_by_user_id::text,
        consent.updated_by_user_id::text,
        consent.created_at::text,
        consent.updated_at::text
      FROM microsoft_sms_consent consent
      LEFT JOIN organization_contact contact
        ON contact.id = consent.contact_id
      WHERE consent.tenant_id = $1
        AND ($2::uuid IS NULL OR consent.contact_id = $2::uuid)
        AND ($3::microsoft_sms_consent_status IS NULL OR consent.consent_status = $3::microsoft_sms_consent_status)
      ORDER BY consent.updated_at DESC
      LIMIT $4
    `,
    [auth.tenantId, input.contactId ?? null, input.consentStatus ?? null, Math.min(Math.max(input.limit ?? 100, 1), 200)]
  );

  return rows.map(parseConsentRow);
}

export async function upsertMicrosoft365SmsConsent(
  client: PoolClient,
  auth: AuthUser,
  input: UpsertMicrosoft365SmsConsentInput
) {
  assertManageAccess(auth);
  ensureSmsOptimizationEnabled();
  await assertPhase8SchemaReady(client);

  const normalizedPhone = normalizePhoneNumber(input.phone_number);
  if (!normalizedPhone) {
    throw new ApiError(400, "A valid phone number is required for SMS consent.");
  }

  let organizationId: string | null = null;
  if (input.contact_id) {
    const { rows } = await client.query<{ organization_id: string | null }>(
      `
        SELECT organization_id::text
        FROM organization_contact
        WHERE tenant_id = $1
          AND id = $2::uuid
        LIMIT 1
      `,
      [auth.tenantId, input.contact_id]
    );
    if (!rows[0]) {
      throw new ApiError(404, "Contact not found for SMS consent.");
    }
    organizationId = rows[0].organization_id;
  }

  const { rows } = await client.query<ConsentRow>(
    `
      INSERT INTO microsoft_sms_consent (
        tenant_id,
        organization_id,
        contact_id,
        phone_number,
        normalized_phone_number,
        consent_status,
        consent_source,
        consent_captured_at,
        consent_expires_at,
        last_confirmed_at,
        suppress_until,
        opt_out_reason,
        metadata,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES (
        $1,$2::uuid,$3::uuid,$4,$5,$6::microsoft_sms_consent_status,$7::microsoft_sms_consent_source,
        $8::timestamptz,$9::timestamptz,$10::timestamptz,$11::timestamptz,$12,$13::jsonb,$14::uuid,$14::uuid
      )
      ON CONFLICT (tenant_id, normalized_phone_number)
      DO UPDATE SET
        organization_id = COALESCE(EXCLUDED.organization_id, microsoft_sms_consent.organization_id),
        contact_id = COALESCE(EXCLUDED.contact_id, microsoft_sms_consent.contact_id),
        phone_number = EXCLUDED.phone_number,
        consent_status = EXCLUDED.consent_status,
        consent_source = EXCLUDED.consent_source,
        consent_captured_at = COALESCE(EXCLUDED.consent_captured_at, microsoft_sms_consent.consent_captured_at),
        consent_expires_at = EXCLUDED.consent_expires_at,
        last_confirmed_at = EXCLUDED.last_confirmed_at,
        suppress_until = EXCLUDED.suppress_until,
        opt_out_reason = EXCLUDED.opt_out_reason,
        metadata = COALESCE(microsoft_sms_consent.metadata, '{}'::jsonb) || EXCLUDED.metadata,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
      RETURNING
        id::text,
        tenant_id::text,
        organization_id::text,
        contact_id::text,
        NULL::text AS contact_name,
        NULL::text AS contact_email,
        phone_number,
        normalized_phone_number,
        consent_status::text,
        consent_source::text,
        consent_captured_at::text,
        consent_expires_at::text,
        last_confirmed_at::text,
        suppress_until::text,
        opt_out_reason,
        metadata,
        created_by_user_id::text,
        updated_by_user_id::text,
        created_at::text,
        updated_at::text
    `,
    [
      auth.tenantId,
      organizationId,
      input.contact_id ?? null,
      input.phone_number,
      normalizedPhone,
      input.consent_status,
      input.consent_source,
      input.consent_captured_at ?? null,
      input.consent_expires_at ?? null,
      input.consent_status === "opted_in" ? new Date().toISOString() : null,
      input.suppress_until ?? null,
      input.opt_out_reason ?? null,
      JSON.stringify(input.metadata ?? {}),
      auth.id
    ]
  );

  const consent = parseConsentRow(rows[0]);
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "microsoft.sms.consent.upserted",
    entityType: "microsoft_sms_consent",
    entityId: consent.id,
    metadata: {
      contact_id: consent.contact_id,
      normalized_phone_number: consent.normalized_phone_number,
      consent_status: consent.consent_status,
      consent_source: consent.consent_source
    }
  });
  await recordMicrosoftIntegrationEvent(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    integrationArea: "sms_automation",
    eventLevel: "info",
    eventType: "sms.consent.upserted",
    eventStatus: consent.consent_status,
    summary: "SMS consent was created or updated.",
    detail: {
      contact_id: consent.contact_id,
      normalized_phone_number: consent.normalized_phone_number,
      consent_source: consent.consent_source
    },
    relatedEntityType: "microsoft_sms_consent",
    relatedEntityId: consent.id
  });
  return consent;
}

export async function queueMicrosoft365SmsDelivery(
  client: PoolClient,
  auth: AuthUser,
  input: QueueMicrosoft365SmsDeliveryInput
) {
  assertManageAccess(auth);
  ensureSmsOptimizationEnabled();
  await assertPhase8SchemaReady(client);

  const baseline = loadBaseline(resolveEnvironment());
  const context = await resolveSmsContext(client, auth.tenantId, input.related_record_type, input.related_record_id);
  const template = getTemplateDefinition(baseline, {
    templateKey: input.template_key,
    departmentScope: context.departmentScope
  });
  if (!template) {
    throw new ApiError(404, `SMS template ${input.template_key} is not defined in the active baseline.`);
  }
  if (template.trigger_type !== input.trigger_type) {
    throw new ApiError(400, "SMS trigger type does not match the selected template.");
  }
  const senderProfile = getSenderProfile(baseline, {
    relatedRecordType: input.related_record_type,
    departmentScope: context.departmentScope,
    triggerType: input.trigger_type
  });
  if (!senderProfile) {
    throw new ApiError(400, "No SMS sender profile matches the requested record type and trigger.");
  }
  const flow = getFlowDefinition(baseline, template.template_key);
  if (!flow) {
    throw new ApiError(400, `No SMS flow definition is configured for template ${template.template_key}.`);
  }

  const rawPhone = input.recipient_phone_number ?? context.recipientPhone;
  const normalizedPhone = normalizePhoneNumber(rawPhone);
  if (!normalizedPhone) {
    throw new ApiError(400, "A valid recipient phone number is required.");
  }

  const consent = await loadConsentByNormalizedPhone(client, auth.tenantId, normalizedPhone);
  if (!consent || consent.consent_status !== "opted_in") {
    throw new ApiError(409, "SMS cannot be queued because the recipient has not provided active opt-in consent.");
  }
  if (consent.suppress_until && Date.parse(consent.suppress_until) > Date.now()) {
    throw new ApiError(409, "SMS cannot be queued because the recipient is currently suppressed.");
  }
  if (consent.consent_expires_at && Date.parse(consent.consent_expires_at) < Date.now()) {
    throw new ApiError(409, "SMS cannot be queued because the recipient consent has expired.");
  }

  if (input.source_change_key) {
    const { rows } = await client.query<DeliveryRow>(
      `
        SELECT
          delivery.id::text,
          delivery.tenant_id::text,
          delivery.provider,
          delivery.related_record_type::text,
          delivery.related_record_id,
          delivery.canonical_dashboard_id,
          delivery.job_id::text,
          delivery.required_item_id::text,
          delivery.organization_id::text,
          delivery.contact_id::text,
          contact.full_name AS contact_name,
          delivery.consent_id::text,
          delivery.recipient_name,
          delivery.recipient_phone_number,
          delivery.normalized_phone_number,
          delivery.sender_key,
          delivery.sender_number,
          delivery.template_key,
          delivery.flow_key,
          delivery.trigger_type::text,
          delivery.status::text,
          delivery.message_body,
          delivery.dashboard_url,
          delivery.secure_link_url,
          delivery.provider_message_id,
          delivery.provider_message_url,
          delivery.flow_run_id,
          delivery.flow_run_url,
          delivery.sync_operation_id::text,
          delivery.source_change_key,
          delivery.attempt_count,
          delivery.queued_at::text,
          delivery.first_dispatched_at::text,
          delivery.last_dispatched_at::text,
          delivery.sent_at::text,
          delivery.delivered_at::text,
          delivery.last_error,
          delivery.last_error_at::text,
          delivery.metadata,
          delivery.created_by_user_id::text,
          delivery.updated_by_user_id::text,
          delivery.created_at::text,
          delivery.updated_at::text
        FROM microsoft_sms_delivery delivery
        LEFT JOIN organization_contact contact
          ON contact.id = delivery.contact_id
        WHERE delivery.tenant_id = $1
          AND delivery.flow_key = $2
          AND delivery.source_change_key = $3
        LIMIT 1
      `,
      [auth.tenantId, flow.flow_key, input.source_change_key]
    );
    if (rows[0]) {
      return {
        deduped: true,
        delivery: parseDeliveryRow(rows[0]),
        sync_operation: null,
        template,
        sender_profile: senderProfile,
        flow
      };
    }
  }

  const mergeContext = {
    ...buildMergeContext(context, {
      secureLinkUrl: input.secure_link_url ?? null,
      supportPhone: config.MICROSOFT_365_SMS_FROM_NUMBER || senderProfile.sender_number
    }),
    ...Object.fromEntries(Object.entries(input.extra_merge_context ?? {}).map(([key, value]) => [key, value ?? ""]))
  };
  const messageBody = renderSmsBody(
    template,
    Object.fromEntries(Object.entries(mergeContext).map(([key, value]) => [key, String(value ?? "")]))
  );

  const operation = await queueIntegrationSyncOperation(client, {
    tenantId: auth.tenantId,
    provider: "microsoft365_sms_automation",
    direction: "outbound",
    entityType: "microsoft_sms_delivery",
    entityId: null,
    externalObjectType: "microsoft_sms_message",
    externalId: null,
    operationType: "send",
    sourceSystem: "dashboard",
    sourceChangeKey: input.source_change_key ?? null,
    triggeredByUserId: auth.id,
    payload: {
      template_key: template.template_key,
      flow_key: flow.flow_key,
      trigger_type: input.trigger_type,
      related_record_type: input.related_record_type,
      related_record_id: input.related_record_id
    }
  });

  const { rows } = await client.query<DeliveryRow>(
    `
      INSERT INTO microsoft_sms_delivery (
        tenant_id, provider, related_record_type, related_record_id, canonical_dashboard_id, job_id, required_item_id,
        organization_id, contact_id, consent_id, recipient_name, recipient_phone_number, normalized_phone_number,
        sender_key, sender_number, template_key, flow_key, trigger_type, status, message_body, dashboard_url,
        secure_link_url, sync_operation_id, source_change_key, metadata, created_by_user_id, updated_by_user_id
      )
      VALUES (
        $1,'microsoft365_sms_automation',$2::microsoft_sms_record_type,$3,$4,$5::uuid,$6::uuid,$7::uuid,$8::uuid,$9::uuid,$10,$11,$12,
        $13,$14,$15,$16,$17::microsoft_sms_trigger_type,'queued'::microsoft_sms_delivery_status,$18,$19,$20,$21::uuid,$22,$23::jsonb,$24::uuid,$24::uuid
      )
      RETURNING
        id::text,
        tenant_id::text,
        provider,
        related_record_type::text,
        related_record_id,
        canonical_dashboard_id,
        job_id::text,
        required_item_id::text,
        organization_id::text,
        contact_id::text,
        NULL::text AS contact_name,
        consent_id::text,
        recipient_name,
        recipient_phone_number,
        normalized_phone_number,
        sender_key,
        sender_number,
        template_key,
        flow_key,
        trigger_type::text,
        status::text,
        message_body,
        dashboard_url,
        secure_link_url,
        provider_message_id,
        provider_message_url,
        flow_run_id,
        flow_run_url,
        sync_operation_id::text,
        source_change_key,
        attempt_count,
        queued_at::text,
        first_dispatched_at::text,
        last_dispatched_at::text,
        sent_at::text,
        delivered_at::text,
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
      context.jobId,
      context.requiredItemId,
      context.organizationId,
      input.contact_id ?? context.contactId,
      consent.id,
      input.recipient_name ?? context.recipientName ?? consent.contact_name ?? null,
      rawPhone,
      normalizedPhone,
      senderProfile.sender_key,
      config.MICROSOFT_365_SMS_FROM_NUMBER || senderProfile.sender_number,
      template.template_key,
      flow.flow_key,
      input.trigger_type,
      messageBody,
      context.dashboardUrl,
      input.secure_link_url ?? null,
      operation.id,
      input.source_change_key ?? null,
      JSON.stringify({
        provider: config.MICROSOFT_365_SMS_PROVIDER,
        safe_template: true
      }),
      auth.id
    ]
  );
  const delivery = parseDeliveryRow(rows[0]);
  await recordSmsEvent(client, {
    tenantId: auth.tenantId,
    deliveryId: delivery.id,
    actorUserId: auth.id,
    eventType: "queued",
    note: "SMS delivery queued.",
    metadata: {
      template_key: template.template_key,
      flow_key: flow.flow_key,
      trigger_type: input.trigger_type
    }
  });
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "microsoft.sms.delivery.queued",
    entityType: "microsoft_sms_delivery",
    entityId: delivery.id,
    metadata: {
      related_record_type: input.related_record_type,
      related_record_id: input.related_record_id,
      template_key: template.template_key,
      trigger_type: input.trigger_type
    }
  });
  await recordMicrosoftIntegrationEvent(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    integrationArea: "sms_automation",
    eventLevel: "info",
    eventType: "sms.delivery.queued",
    eventStatus: "queued",
    summary: "Reminder SMS queued for delivery.",
    detail: {
      delivery_id: delivery.id,
      flow_key: flow.flow_key,
      trigger_type: input.trigger_type
    },
    relatedEntityType: "microsoft_sms_delivery",
    relatedEntityId: delivery.id
  });

  return {
    deduped: false,
    delivery,
    sync_operation: operation,
    template,
    sender_profile: senderProfile,
    flow
  };
}

export async function queueMicrosoft365SmsDeliveryForSystem(
  client: PoolClient,
  input: QueueMicrosoft365SmsDeliveryInput & {
    tenantId: string;
    actorUserId?: string | null;
  }
) {
  return queueMicrosoft365SmsDelivery(
    client,
    {
      tenantId: input.tenantId,
      id: input.actorUserId ?? null,
      authorityTier: "super_admin"
    } as AuthUser,
    input
  );
}

export async function listMicrosoft365SmsDeliveries(
  client: PoolClient,
  auth: AuthUser,
  input: {
    status?: Microsoft365SmsDeliveryStatus | null;
    relatedRecordType?: Microsoft365SmsRecordType | null;
    relatedRecordId?: string | null;
    templateKey?: string | null;
    triggerType?: Microsoft365SmsTriggerType | null;
    limit?: number;
  } = {}
) {
  assertReadAccess(auth);
  ensureSmsOptimizationEnabled();
  await assertPhase8SchemaReady(client);

  const { rows } = await client.query<DeliveryRow>(
    `
      SELECT
        delivery.id::text,
        delivery.tenant_id::text,
        delivery.provider,
        delivery.related_record_type::text,
        delivery.related_record_id,
        delivery.canonical_dashboard_id,
        delivery.job_id::text,
        delivery.required_item_id::text,
        delivery.organization_id::text,
        delivery.contact_id::text,
        contact.full_name AS contact_name,
        delivery.consent_id::text,
        delivery.recipient_name,
        delivery.recipient_phone_number,
        delivery.normalized_phone_number,
        delivery.sender_key,
        delivery.sender_number,
        delivery.template_key,
        delivery.flow_key,
        delivery.trigger_type::text,
        delivery.status::text,
        delivery.message_body,
        delivery.dashboard_url,
        delivery.secure_link_url,
        delivery.provider_message_id,
        delivery.provider_message_url,
        delivery.flow_run_id,
        delivery.flow_run_url,
        delivery.sync_operation_id::text,
        delivery.source_change_key,
        delivery.attempt_count,
        delivery.queued_at::text,
        delivery.first_dispatched_at::text,
        delivery.last_dispatched_at::text,
        delivery.sent_at::text,
        delivery.delivered_at::text,
        delivery.last_error,
        delivery.last_error_at::text,
        delivery.metadata,
        delivery.created_by_user_id::text,
        delivery.updated_by_user_id::text,
        delivery.created_at::text,
        delivery.updated_at::text
      FROM microsoft_sms_delivery delivery
      LEFT JOIN organization_contact contact
        ON contact.id = delivery.contact_id
      WHERE delivery.tenant_id = $1
        AND ($2::microsoft_sms_delivery_status IS NULL OR delivery.status = $2::microsoft_sms_delivery_status)
        AND ($3::microsoft_sms_record_type IS NULL OR delivery.related_record_type = $3::microsoft_sms_record_type)
        AND ($4::text IS NULL OR delivery.related_record_id = $4)
        AND ($5::text IS NULL OR delivery.template_key = $5)
        AND ($6::microsoft_sms_trigger_type IS NULL OR delivery.trigger_type = $6::microsoft_sms_trigger_type)
      ORDER BY delivery.created_at DESC
      LIMIT $7
    `,
    [
      auth.tenantId,
      input.status ?? null,
      input.relatedRecordType ?? null,
      input.relatedRecordId ?? null,
      input.templateKey ?? null,
      input.triggerType ?? null,
      Math.min(Math.max(input.limit ?? 100, 1), 200)
    ]
  );

  const deliveries = rows.map(parseDeliveryRow);
  const eventsByDelivery = await loadDeliveryEvents(client, auth.tenantId, deliveries.map((delivery) => delivery.id));
  return deliveries.map((delivery) => ({
    ...delivery,
    events: eventsByDelivery.get(delivery.id) ?? []
  }));
}

export async function replayMicrosoft365SmsDelivery(client: PoolClient, auth: AuthUser, input: { delivery_id: string }) {
  assertManageAccess(auth);
  ensureSmsOptimizationEnabled();
  await assertPhase8SchemaReady(client);
  const original = await loadDelivery(client, auth.tenantId, input.delivery_id);
  if (!original) {
    throw new ApiError(404, "SMS delivery not found.");
  }
  await recordSmsEvent(client, {
    tenantId: auth.tenantId,
    deliveryId: original.id,
    actorUserId: auth.id,
    eventType: "replayed",
    note: "SMS delivery replay requested.",
    metadata: {
      previous_status: original.status
    }
  });
  const result = await queueMicrosoft365SmsDelivery(client, auth, {
    related_record_type: original.related_record_type,
    related_record_id: original.related_record_id,
    template_key: original.template_key,
    trigger_type: original.trigger_type,
    contact_id: original.contact_id ?? null,
    recipient_name: original.recipient_name ?? null,
    recipient_phone_number: original.recipient_phone_number,
    secure_link_url: original.secure_link_url ?? null,
    source_change_key: `${original.source_change_key ?? original.id}:replay:${Date.now()}`,
    extra_merge_context: {}
  });
  return {
    replayed_delivery_id: original.id,
    queued_delivery: result
  };
}

export async function recordMicrosoft365SmsCallback(client: PoolClient, input: RecordMicrosoft365SmsCallbackInput) {
  await assertPhase8SchemaReady(client);
  const { rows } = await client.query<DeliveryRow>(
    `
      SELECT
        delivery.id::text,
        delivery.tenant_id::text,
        delivery.provider,
        delivery.related_record_type::text,
        delivery.related_record_id,
        delivery.canonical_dashboard_id,
        delivery.job_id::text,
        delivery.required_item_id::text,
        delivery.organization_id::text,
        delivery.contact_id::text,
        contact.full_name AS contact_name,
        delivery.consent_id::text,
        delivery.recipient_name,
        delivery.recipient_phone_number,
        delivery.normalized_phone_number,
        delivery.sender_key,
        delivery.sender_number,
        delivery.template_key,
        delivery.flow_key,
        delivery.trigger_type::text,
        delivery.status::text,
        delivery.message_body,
        delivery.dashboard_url,
        delivery.secure_link_url,
        delivery.provider_message_id,
        delivery.provider_message_url,
        delivery.flow_run_id,
        delivery.flow_run_url,
        delivery.sync_operation_id::text,
        delivery.source_change_key,
        delivery.attempt_count,
        delivery.queued_at::text,
        delivery.first_dispatched_at::text,
        delivery.last_dispatched_at::text,
        delivery.sent_at::text,
        delivery.delivered_at::text,
        delivery.last_error,
        delivery.last_error_at::text,
        delivery.metadata,
        delivery.created_by_user_id::text,
        delivery.updated_by_user_id::text,
        delivery.created_at::text,
        delivery.updated_at::text
      FROM microsoft_sms_delivery delivery
      LEFT JOIN organization_contact contact
        ON contact.id = delivery.contact_id
      WHERE delivery.id = $1::uuid
      LIMIT 1
    `,
    [input.delivery_id]
  );
  const delivery = rows[0] ? parseDeliveryRow(rows[0]) : null;
  if (!delivery) {
    throw new ApiError(404, "SMS delivery not found.");
  }

  const nextStatus = input.status === "sent" ? "sent" : input.status === "delivered" ? "delivered" : input.status === "skipped" ? "skipped" : "failed";

  await client.query(
    `
      UPDATE microsoft_sms_delivery
      SET
        status = $2::microsoft_sms_delivery_status,
        provider_message_id = COALESCE($3, provider_message_id),
        provider_message_url = COALESCE($4, provider_message_url),
        flow_run_id = COALESCE($5, flow_run_id),
        flow_run_url = COALESCE($6, flow_run_url),
        sent_at = CASE WHEN $2 IN ('sent'::microsoft_sms_delivery_status, 'delivered'::microsoft_sms_delivery_status) THEN COALESCE(sent_at, now()) ELSE sent_at END,
        delivered_at = CASE WHEN $2 = 'delivered'::microsoft_sms_delivery_status THEN now() ELSE delivered_at END,
        last_error = CASE WHEN $2 = 'failed'::microsoft_sms_delivery_status THEN COALESCE($7, $8) ELSE NULL END,
        last_error_at = CASE WHEN $2 = 'failed'::microsoft_sms_delivery_status THEN now() ELSE NULL END,
        metadata = COALESCE(metadata, '{}'::jsonb) || $9::jsonb,
        updated_at = now()
      WHERE id = $1::uuid
    `,
    [
      input.delivery_id,
      nextStatus,
      input.provider_message_id ?? null,
      input.provider_message_url ?? null,
      input.flow_run_id ?? null,
      input.flow_run_url ?? null,
      input.error_message ?? null,
      input.error_code ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );

  await recordSmsEvent(client, {
    tenantId: delivery.tenant_id,
    deliveryId: delivery.id,
    eventType: "callback_received",
    note: `Provider callback recorded with status ${nextStatus}.`,
    metadata: {
      status: nextStatus,
      provider_message_id: input.provider_message_id ?? null,
      flow_run_id: input.flow_run_id ?? null
    }
  });

  if (nextStatus === "failed") {
    await recordSmsEvent(client, {
      tenantId: delivery.tenant_id,
      deliveryId: delivery.id,
      eventType: "failed",
      note: input.error_message ?? input.error_code ?? "SMS delivery failed.",
      metadata: input.metadata ?? {}
    });
  } else {
    await recordSmsEvent(client, {
      tenantId: delivery.tenant_id,
      deliveryId: delivery.id,
      eventType: nextStatus === "delivered" ? "delivered" : nextStatus === "sent" ? "sent" : "skipped",
      note: `SMS delivery marked ${nextStatus}.`,
      metadata: input.metadata ?? {}
    });
  }

  if (delivery.sync_operation_id) {
    if (nextStatus === "failed") {
      await markIntegrationSyncOperationFailed(client, {
        tenantId: delivery.tenant_id,
        operationId: delivery.sync_operation_id,
        errorMessage: input.error_message ?? input.error_code ?? "SMS delivery failed.",
        resultPayload: {
          delivery_id: delivery.id,
          status: nextStatus
        }
      });
    } else {
      await markIntegrationSyncOperationSucceeded(client, {
        tenantId: delivery.tenant_id,
        operationId: delivery.sync_operation_id,
        externalId: input.provider_message_id ?? null,
        resultPayload: {
          delivery_id: delivery.id,
          status: nextStatus,
          flow_run_id: input.flow_run_id ?? null
        }
      });
    }
  }

  if (input.opted_out) {
    await client.query(
      `
        UPDATE microsoft_sms_consent
        SET
          consent_status = 'opted_out'::microsoft_sms_consent_status,
          opt_out_reason = COALESCE($3, opt_out_reason, 'client_reply_stop'),
          last_confirmed_at = now(),
          updated_at = now()
        WHERE tenant_id = $1
          AND normalized_phone_number = $2
      `,
      [delivery.tenant_id, delivery.normalized_phone_number, input.error_message ?? null]
    );
    await recordSmsEvent(client, {
      tenantId: delivery.tenant_id,
      deliveryId: delivery.id,
      eventType: "opted_out",
      note: "Recipient opted out through the SMS provider callback.",
      metadata: {
        normalized_phone_number: delivery.normalized_phone_number
      }
    });
  }

  await recordMicrosoftIntegrationEvent(client, {
    tenantId: delivery.tenant_id,
    integrationArea: "sms_automation",
    eventLevel: nextStatus === "failed" ? "error" : "info",
    eventType: `sms.delivery.${nextStatus}`,
    eventStatus: nextStatus,
    summary: nextStatus === "failed" ? "Reminder SMS failed during provider execution." : `Reminder SMS marked ${nextStatus} by the provider callback.`,
    detail: {
      delivery_id: delivery.id,
      provider_message_id: input.provider_message_id ?? null,
      flow_run_id: input.flow_run_id ?? null,
      opted_out: Boolean(input.opted_out)
    },
    relatedEntityType: "microsoft_sms_delivery",
    relatedEntityId: delivery.id
  });

  return {
    delivery_id: delivery.id,
    tenant_id: delivery.tenant_id,
    status: nextStatus,
    sync_operation_id: delivery.sync_operation_id
  };
}

async function buildWorkspaceMetrics(client: PoolClient, tenantId: string, baseline: Microsoft365SmsOptimizationBaseline) {
  const consentCounts = await client.query<{ opted_in_count: string; opted_out_count: string; suppressed_count: string }>(
    `
      SELECT
        count(*) FILTER (WHERE consent_status = 'opted_in'::microsoft_sms_consent_status)::text AS opted_in_count,
        count(*) FILTER (WHERE consent_status = 'opted_out'::microsoft_sms_consent_status)::text AS opted_out_count,
        count(*) FILTER (WHERE consent_status = 'suppressed'::microsoft_sms_consent_status)::text AS suppressed_count
      FROM microsoft_sms_consent
      WHERE tenant_id = $1
    `,
    [tenantId]
  );
  const deliveryCounts = await client.query<{ pending_count: string; failed_count: string }>(
    `
      SELECT
        count(*) FILTER (
          WHERE status IN (
            'queued'::microsoft_sms_delivery_status,
            'dispatching'::microsoft_sms_delivery_status,
            'provider_accepted'::microsoft_sms_delivery_status
          )
        )::text AS pending_count,
        count(*) FILTER (WHERE status = 'failed'::microsoft_sms_delivery_status)::text AS failed_count
      FROM microsoft_sms_delivery
      WHERE tenant_id = $1
    `,
    [tenantId]
  );
  const backlogCounts = await client.query<{
    backlog_count: string;
    overdue_required_item_count: string;
    review_sla_breach_count: string;
    upload_sla_breach_count: string;
  }>(
    `
      SELECT
        count(*) FILTER (
          WHERE mapping.status = 'active'::microsoft_client_intake_mapping_status
            AND COALESCE(mapping.last_submission_status::text, 'none') NOT IN ('approved', 'rejected', 'archived')
        )::text AS backlog_count,
        count(*) FILTER (
          WHERE mapping.status = 'active'::microsoft_client_intake_mapping_status
            AND item.id IS NOT NULL
            AND item.is_complete = false
            AND item.due_at IS NOT NULL
            AND item.due_at < now()
        )::text AS overdue_required_item_count,
        (
          SELECT count(*)::text
          FROM microsoft_client_intake_submission submission
          WHERE submission.tenant_id = $1
            AND submission.matching_status IN (
              'received_matched'::microsoft_client_intake_submission_status,
              'received_unmatched'::microsoft_client_intake_submission_status,
              'under_review'::microsoft_client_intake_submission_status
            )
            AND submission.exception_state = 'none'::microsoft_client_intake_exception_state
            AND submission.review_due_at IS NOT NULL
            AND submission.review_due_at < now()
        ) AS review_sla_breach_count,
        count(*) FILTER (
          WHERE mapping.status = 'active'::microsoft_client_intake_mapping_status
            AND item.id IS NOT NULL
            AND item.is_complete = false
            AND item.due_at IS NOT NULL
            AND item.due_at < now()
        )::text AS upload_sla_breach_count
      FROM microsoft_client_intake_mapping mapping
      LEFT JOIN job_readiness_items item
        ON item.id = mapping.required_item_id
      WHERE mapping.tenant_id = $1
    `,
    [tenantId]
  );
  const reviewCycle = await client.query<{ avg_hours: string | null }>(
    `
      SELECT avg(EXTRACT(EPOCH FROM (reviewed_at - submitted_at)) / 3600.0)::text AS avg_hours
      FROM microsoft_client_intake_submission
      WHERE tenant_id = $1
        AND reviewed_at IS NOT NULL
    `,
    [tenantId]
  );
  const uploadTurnaround = await client.query<{ avg_hours: string | null }>(
    `
      WITH first_submission AS (
        SELECT mapping_id, min(submitted_at) AS first_submitted_at
        FROM microsoft_client_intake_submission
        WHERE tenant_id = $1
          AND mapping_id IS NOT NULL
        GROUP BY mapping_id
      )
      SELECT avg(EXTRACT(EPOCH FROM (first_submission.first_submitted_at - mapping.created_at)) / 3600.0)::text AS avg_hours
      FROM microsoft_client_intake_mapping mapping
      JOIN first_submission
        ON first_submission.mapping_id = mapping.id
      WHERE mapping.tenant_id = $1
    `,
    [tenantId]
  );
  const reminderEffectiveness = await client.query<{ total_count: string; effective_count: string }>(
    `
      WITH reminder_deliveries AS (
        SELECT
          id,
          COALESCE(delivered_at, sent_at, queued_at) AS sent_time,
          required_item_id,
          job_id
        FROM microsoft_sms_delivery
        WHERE tenant_id = $1
          AND trigger_type IN ('reminder'::microsoft_sms_trigger_type, 'overdue'::microsoft_sms_trigger_type)
          AND status IN ('sent'::microsoft_sms_delivery_status, 'delivered'::microsoft_sms_delivery_status)
      )
      SELECT
        count(*)::text AS total_count,
        count(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM microsoft_client_intake_submission submission
            WHERE submission.tenant_id = $1
              AND (
                (reminder_deliveries.required_item_id IS NOT NULL AND submission.required_item_id = reminder_deliveries.required_item_id)
                OR (
                  reminder_deliveries.required_item_id IS NULL
                  AND reminder_deliveries.job_id IS NOT NULL
                  AND submission.job_id = reminder_deliveries.job_id
                )
              )
              AND submission.submitted_at >= reminder_deliveries.sent_time
              AND submission.submitted_at < reminder_deliveries.sent_time + make_interval(hours => $2::integer)
          )
        )::text AS effective_count
      FROM reminder_deliveries
    `,
    [tenantId, baseline.optimization_rules.reminder_effectiveness_window_hours]
  );
  const bottleneckRows = await client.query<{
    department_scope: string | null;
    open_backlog_count: string;
    overdue_count: string;
    review_sla_breach_count: string;
    upload_sla_breach_count: string;
  }>(
    `
      SELECT
        mapping.department_scope,
        count(*) FILTER (
          WHERE mapping.status = 'active'::microsoft_client_intake_mapping_status
            AND COALESCE(mapping.last_submission_status::text, 'none') NOT IN ('approved', 'rejected', 'archived')
        )::text AS open_backlog_count,
        count(*) FILTER (
          WHERE item.id IS NOT NULL
            AND item.is_complete = false
            AND item.due_at IS NOT NULL
            AND item.due_at < now()
        )::text AS overdue_count,
        count(*) FILTER (
          WHERE submission.id IS NOT NULL
            AND submission.matching_status IN (
              'received_matched'::microsoft_client_intake_submission_status,
              'received_unmatched'::microsoft_client_intake_submission_status,
              'under_review'::microsoft_client_intake_submission_status
            )
            AND submission.exception_state = 'none'::microsoft_client_intake_exception_state
            AND submission.review_due_at IS NOT NULL
            AND submission.review_due_at < now()
        )::text AS review_sla_breach_count,
        count(*) FILTER (
          WHERE item.id IS NOT NULL
            AND item.is_complete = false
            AND item.due_at IS NOT NULL
            AND item.due_at < now()
        )::text AS upload_sla_breach_count
      FROM microsoft_client_intake_mapping mapping
      LEFT JOIN job_readiness_items item
        ON item.id = mapping.required_item_id
      LEFT JOIN LATERAL (
        SELECT *
        FROM microsoft_client_intake_submission s
        WHERE s.tenant_id = mapping.tenant_id
          AND s.mapping_id = mapping.id
        ORDER BY s.submitted_at DESC
        LIMIT 1
      ) submission ON true
      WHERE mapping.tenant_id = $1
      GROUP BY mapping.department_scope
      ORDER BY count(*) DESC, mapping.department_scope NULLS LAST
      LIMIT 8
    `,
    [tenantId]
  );

  const consentState = consentCounts.rows[0] ?? { opted_in_count: "0", opted_out_count: "0", suppressed_count: "0" };
  const deliveryState = deliveryCounts.rows[0] ?? { pending_count: "0", failed_count: "0" };
  const backlogState = backlogCounts.rows[0] ?? {
    backlog_count: "0",
    overdue_required_item_count: "0",
    review_sla_breach_count: "0",
    upload_sla_breach_count: "0"
  };
  const reminderState = reminderEffectiveness.rows[0] ?? { total_count: "0", effective_count: "0" };
  const reminderTotal = Number(reminderState.total_count ?? "0");
  const reminderEffective = Number(reminderState.effective_count ?? "0");

  return {
    optedInCount: Number(consentState.opted_in_count ?? "0"),
    optedOutCount: Number(consentState.opted_out_count ?? "0"),
    suppressedConsentCount: Number(consentState.suppressed_count ?? "0"),
    pendingDeliveryCount: Number(deliveryState.pending_count ?? "0"),
    failedDeliveryCount: Number(deliveryState.failed_count ?? "0"),
    backlogCount: Number(backlogState.backlog_count ?? "0"),
    overdueRequiredItemCount: Number(backlogState.overdue_required_item_count ?? "0"),
    reviewSlaBreachCount: Number(backlogState.review_sla_breach_count ?? "0"),
    uploadSlaBreachCount: Number(backlogState.upload_sla_breach_count ?? "0"),
    avgReviewCycleHours: reviewCycle.rows[0]?.avg_hours ? Number(reviewCycle.rows[0].avg_hours) : null,
    avgUploadTurnaroundHours: uploadTurnaround.rows[0]?.avg_hours ? Number(uploadTurnaround.rows[0].avg_hours) : null,
    reminderEffectivenessRate: reminderTotal > 0 ? (reminderEffective / reminderTotal) * 100 : null,
    reminderDeliveryCount: reminderTotal,
    bottleneckRows: bottleneckRows.rows.map((row) => ({
      departmentScope: row.department_scope,
      openBacklogCount: Number(row.open_backlog_count ?? "0"),
      overdueCount: Number(row.overdue_count ?? "0"),
      reviewSlaBreachCount: Number(row.review_sla_breach_count ?? "0"),
      uploadSlaBreachCount: Number(row.upload_sla_breach_count ?? "0")
    }))
  };
}

function buildKpiDashboard(
  baseline: Microsoft365SmsOptimizationBaseline,
  metrics: SmsWorkspaceMetrics
): Microsoft365SmsKpiCard[] {
  const definitions = new Map(baseline.kpi_definitions.map((definition) => [definition.key, definition]));
  return [
    {
      key: "overdue_items",
      title: definitions.get("overdue_items")?.title ?? "Overdue Required Items",
      description: definitions.get("overdue_items")?.description ?? "Open required items that have passed their due date.",
      value: metrics.overdueRequiredItemCount,
      unit: "count",
      trend: metrics.overdueRequiredItemCount > baseline.optimization_rules.overdue_backlog_warning_threshold ? "action" : "good",
      target_rule: definitions.get("overdue_items")?.target_rule ?? "Keep overdue required items below the warning threshold."
    },
    {
      key: "review_cycle_hours",
      title: definitions.get("review_cycle_hours")?.title ?? "Average Review Cycle Time",
      description: definitions.get("review_cycle_hours")?.description ?? "Average time from submission receipt to reviewer decision.",
      value: Number((metrics.avgReviewCycleHours ?? 0).toFixed(2)),
      unit: "hours",
      trend: metrics.avgReviewCycleHours !== null && metrics.avgReviewCycleHours > baseline.optimization_rules.review_cycle_warning_hours ? "action" : "good",
      target_rule: definitions.get("review_cycle_hours")?.target_rule ?? "Keep review cycle time inside the review SLA."
    },
    {
      key: "upload_turnaround_hours",
      title: definitions.get("upload_turnaround_hours")?.title ?? "Average Upload Turnaround",
      description: definitions.get("upload_turnaround_hours")?.description ?? "Average time from intake mapping creation to the first submission.",
      value: Number((metrics.avgUploadTurnaroundHours ?? 0).toFixed(2)),
      unit: "hours",
      trend: metrics.avgUploadTurnaroundHours !== null && metrics.avgUploadTurnaroundHours > baseline.optimization_rules.upload_turnaround_warning_hours ? "watch" : "good",
      target_rule: definitions.get("upload_turnaround_hours")?.target_rule ?? "Reduce time to first client upload."
    },
    {
      key: "reminder_effectiveness_rate",
      title: definitions.get("reminder_effectiveness_rate")?.title ?? "Reminder Effectiveness",
      description: definitions.get("reminder_effectiveness_rate")?.description ?? "Percent of reminder SMS deliveries that lead to a submission inside the target window.",
      value: Number((metrics.reminderEffectivenessRate ?? 0).toFixed(2)),
      unit: "percent",
      trend: metrics.reminderEffectivenessRate !== null && metrics.reminderEffectivenessRate < 35 ? "watch" : "good",
      target_rule: definitions.get("reminder_effectiveness_rate")?.target_rule ?? "Maintain a healthy conversion rate from reminder to submission."
    },
    {
      key: "backlog_count",
      title: definitions.get("backlog_count")?.title ?? "Open Intake Backlog",
      description: definitions.get("backlog_count")?.description ?? "Mapped intake work that is still waiting on client or reviewer progress.",
      value: metrics.backlogCount,
      unit: "count",
      trend: metrics.backlogCount > baseline.optimization_rules.overdue_backlog_warning_threshold ? "watch" : "good",
      target_rule: definitions.get("backlog_count")?.target_rule ?? "Keep the intake backlog within department handling capacity."
    }
  ];
}

function buildSlaDashboard(
  baseline: Microsoft365SmsOptimizationBaseline,
  metrics: SmsWorkspaceMetrics
): Microsoft365SmsSlaCard[] {
  return baseline.sla_definitions.map((definition) => {
    const breachCount = definition.key === "review_sla" ? metrics.reviewSlaBreachCount : definition.key === "upload_sla" ? metrics.uploadSlaBreachCount : 0;
    const openCount = definition.key === "review_sla" ? metrics.backlogCount : definition.key === "upload_sla" ? metrics.overdueRequiredItemCount : 0;
    return {
      key: definition.key,
      title: definition.title,
      threshold_hours: definition.threshold_hours,
      breach_count: breachCount,
      open_count: openCount,
      trend: breachCount > 0 ? "action" : openCount > 0 ? "watch" : "good",
      breach_rule: definition.breach_rule
    };
  });
}

function buildOptimizationFindings(
  baseline: Microsoft365SmsOptimizationBaseline,
  metrics: SmsWorkspaceMetrics
): Microsoft365SmsOptimizationRecommendation[] {
  const findings: Microsoft365SmsOptimizationRecommendation[] = [];
  if (metrics.overdueRequiredItemCount > baseline.optimization_rules.overdue_backlog_warning_threshold) {
    findings.push({
      key: "overdue_backlog_pressure",
      severity: "action",
      summary: "Overdue intake backlog is above the configured warning threshold.",
      evidence: {
        overdue_required_item_count: metrics.overdueRequiredItemCount,
        threshold: baseline.optimization_rules.overdue_backlog_warning_threshold
      }
    });
  }
  if (metrics.avgReviewCycleHours !== null && metrics.avgReviewCycleHours > baseline.optimization_rules.review_cycle_warning_hours) {
    findings.push({
      key: "review_cycle_slow",
      severity: "warning",
      summary: "Reviewer turnaround is slower than the configured optimization target.",
      evidence: {
        average_review_cycle_hours: Number(metrics.avgReviewCycleHours.toFixed(2)),
        warning_hours: baseline.optimization_rules.review_cycle_warning_hours
      }
    });
  }
  if (metrics.avgUploadTurnaroundHours !== null && metrics.avgUploadTurnaroundHours > baseline.optimization_rules.upload_turnaround_warning_hours) {
    findings.push({
      key: "upload_turnaround_slow",
      severity: "warning",
      summary: "Clients are taking longer to submit than the configured turnaround target.",
      evidence: {
        average_upload_turnaround_hours: Number(metrics.avgUploadTurnaroundHours.toFixed(2)),
        warning_hours: baseline.optimization_rules.upload_turnaround_warning_hours
      }
    });
  }
  if (metrics.reminderEffectivenessRate !== null && metrics.reminderEffectivenessRate < 35) {
    findings.push({
      key: "reminder_effectiveness_low",
      severity: "warning",
      summary: "Reminder conversion is low enough to warrant template, consent, or cadence review.",
      evidence: {
        reminder_effectiveness_rate: Number(metrics.reminderEffectivenessRate.toFixed(2)),
        reminder_delivery_count: metrics.reminderDeliveryCount
      }
    });
  }
  if (metrics.failedDeliveryCount > 0) {
    findings.push({
      key: "delivery_failures_present",
      severity: "action",
      summary: "SMS delivery failures are present and should be investigated before expanding usage.",
      evidence: {
        failed_delivery_count: metrics.failedDeliveryCount
      }
    });
  }
  if (findings.length === 0) {
    findings.push({
      key: "baseline_healthy",
      severity: "info",
      summary: "Current Phase 8 SMS and KPI metrics are within the configured operating thresholds.",
      evidence: {
        backlog_count: metrics.backlogCount,
        reminder_effectiveness_rate: metrics.reminderEffectivenessRate
      }
    });
  }
  return findings;
}

function buildCurrentStateFindings(): Microsoft365SmsOptimizationCurrentStateFinding[] {
  return [
    {
      key: "reminder_foundation",
      state: "existing",
      summary: "Reminder cadence, required-item mapping, and dashboard-owned workflow state already exist in the client intake foundation.",
      evidence: [
        "Phase 5 secure intake mappings already tie uploads back to dashboard record ids.",
        "Phase 6 operational control already tracks review due dates, escalations, and exception suppression."
      ]
    },
    {
      key: "communication_logging",
      state: "partial",
      summary: "Email and Teams communication logging already exists, but outbound SMS had no durable consent or delivery model before Phase 8.",
      evidence: [
        "Mail automation already persists delivery attempts and callbacks.",
        "Operational reporting exists, but Phase 8 KPI and SLA measures were not mapped to intake and reminder outcomes."
      ],
      recommended_refactor: "Keep SMS on the same queue, diagnostics, and dashboard-id tracing pattern as the other Microsoft communication layers."
    },
    {
      key: "sms_safety",
      state: "missing",
      summary: "Safe SMS content rules, consent gating, and opt-out traceability were missing before this phase.",
      evidence: [
        "No durable opt-in or suppression model existed for outbound client SMS.",
        "The only prior SMS code path was a generic worker stub and not a governed reminder system."
      ],
      recommended_refactor: "Keep SMS reminder-only and baseline-driven. Do not allow arbitrary free-form message bodies or document details."
    }
  ];
}

function buildRefactorFirst(): Microsoft365SmsOptimizationRefactorItem[] {
  return [
    {
      key: "consent_before_delivery",
      severity: "high",
      summary: "Keep consent state in the dashboard and never infer SMS eligibility from contact presence alone.",
      consequence: "Without this boundary, reminder sends will drift into non-compliant or untraceable behavior."
    },
    {
      key: "safe_template_boundary",
      severity: "high",
      summary: "Keep SMS templates limited to approved tokens and short reminder language.",
      consequence: "Allowing arbitrary content would turn SMS into an unsafe document-sharing surface."
    },
    {
      key: "kpi_from_workflow_truth",
      severity: "medium",
      summary: "Compute KPIs and SLA breaches from dashboard workflow state, not provider callbacks alone.",
      consequence: "Provider-only metrics would produce vanity reporting disconnected from operational reality."
    }
  ];
}

export async function getMicrosoft365SmsOptimizationWorkspace(
  client: PoolClient,
  auth: AuthUser
): Promise<Microsoft365SmsOptimizationWorkspace> {
  assertReadAccess(auth);
  ensureSmsOptimizationEnabled();
  await assertPhase8SchemaReady(client);

  const baseline = loadBaseline(resolveEnvironment());
  const metricsResult = await buildWorkspaceMetrics(client, auth.tenantId, baseline);
  const deliveries = await listMicrosoft365SmsDeliveries(client, auth, { limit: 15 });
  const metrics: SmsWorkspaceMetrics = {
    optedInCount: metricsResult.optedInCount,
    optedOutCount: metricsResult.optedOutCount,
    suppressedConsentCount: metricsResult.suppressedConsentCount,
    pendingDeliveryCount: metricsResult.pendingDeliveryCount,
    failedDeliveryCount: metricsResult.failedDeliveryCount,
    backlogCount: metricsResult.backlogCount,
    overdueRequiredItemCount: metricsResult.overdueRequiredItemCount,
    reviewSlaBreachCount: metricsResult.reviewSlaBreachCount,
    uploadSlaBreachCount: metricsResult.uploadSlaBreachCount,
    avgReviewCycleHours: metricsResult.avgReviewCycleHours,
    avgUploadTurnaroundHours: metricsResult.avgUploadTurnaroundHours,
    reminderEffectivenessRate: metricsResult.reminderEffectivenessRate,
    reminderDeliveryCount: metricsResult.reminderDeliveryCount
  };

  return {
    generated_at: new Date().toISOString(),
    summary: {
      opted_in_count: metrics.optedInCount,
      opted_out_count: metrics.optedOutCount,
      suppressed_consent_count: metrics.suppressedConsentCount,
      pending_delivery_count: metrics.pendingDeliveryCount,
      failed_delivery_count: metrics.failedDeliveryCount,
      backlog_count: metrics.backlogCount,
      overdue_required_item_count: metrics.overdueRequiredItemCount,
      review_sla_breach_count: metrics.reviewSlaBreachCount,
      upload_sla_breach_count: metrics.uploadSlaBreachCount,
      reminder_effectiveness_rate: metrics.reminderEffectivenessRate !== null ? Number(metrics.reminderEffectivenessRate.toFixed(2)) : null
    },
    kpi_dashboard: buildKpiDashboard(baseline, metrics),
    sla_dashboard: buildSlaDashboard(baseline, metrics),
    bottleneck_analysis: metricsResult.bottleneckRows.map((row) => ({
      key: row.departmentScope ?? "unscoped",
      label: row.departmentScope ?? "Unscoped",
      department_scope: row.departmentScope,
      open_backlog_count: row.openBacklogCount,
      overdue_count: row.overdueCount,
      review_sla_breach_count: row.reviewSlaBreachCount,
      upload_sla_breach_count: row.uploadSlaBreachCount,
      reminder_effectiveness_rate: null
    })),
    optimization_findings: buildOptimizationFindings(baseline, metrics),
    recent_deliveries: deliveries
  };
}

export async function getMicrosoft365SmsOptimizationDiagnostics(
  client: PoolClient,
  auth: AuthUser
): Promise<
  Microsoft365SmsOptimizationDiagnosticsResponse & {
    active_consent_count: number;
    recent_deliveries: Array<Microsoft365SmsDeliveryRecord & { events: Microsoft365SmsEventRecord[] }>;
  }
> {
  assertReadAccess(auth);
  const baselineEnvironment = resolveEnvironment();
  const baseline = loadBaseline(baselineEnvironment);
  const issues = getMicrosoft365SmsOptimizationValidationIssues();
  const schemaReady = await hasPhase8Schema(client);
  const diagnosticsIssues = schemaReady
    ? issues
    : [
        ...issues,
        {
          area: "schema",
          severity: "error",
          code: "phase8.schema.missing",
          summary: "Phase 8 SMS optimization schema is not available in this environment."
        } satisfies Microsoft365SmsOptimizationValidationIssue
      ];

  let activeConsentCount = 0;
  let recentDeliveries: Array<Microsoft365SmsDeliveryRecord & { events: Microsoft365SmsEventRecord[] }> = [];
  if (schemaReady) {
    const countResult = await client.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM microsoft_sms_consent
        WHERE tenant_id = $1
          AND consent_status = 'opted_in'::microsoft_sms_consent_status
      `,
      [auth.tenantId]
    );
    activeConsentCount = Number(countResult.rows[0]?.count ?? "0");
    recentDeliveries = await listMicrosoft365SmsDeliveriesForDiagnostics(client, auth.tenantId, 10);
  }

  return {
    generated_at: new Date().toISOString(),
    baseline_environment: baselineEnvironment,
    startup_validation: {
      valid: diagnosticsIssues.every((issue) => issue.severity !== "error"),
      issues: diagnosticsIssues
    },
    phase_audit_summary: {
      implementation_status: schemaReady ? "implemented_foundation" : "scaffolded_pending_schema",
      current_state:
        "Reminder and intake foundations already existed, but durable SMS consent, safe reminder templates, delivery logging, and KPI/SLA reporting needed a first-class contract.",
      recommendation: determineRecommendation(diagnosticsIssues)
    },
    current_state_findings: buildCurrentStateFindings(),
    refactor_first: buildRefactorFirst(),
    sms_policy: baseline.sms_policy,
    sender_profiles: baseline.sender_profiles,
    template_schema: baseline.template_schema,
    flow_inventory: baseline.flow_inventory,
    kpi_definitions: baseline.kpi_definitions,
    sla_definitions: baseline.sla_definitions,
    execution_order: baseline.execution_order,
    configuration_artifacts: ARTIFACTS,
    governance_docs: DOCS,
    manual_admin_checklist: baseline.manual_admin_checklist,
    validation_checklist: baseline.validation_checklist,
    rollback_principles: baseline.rollback_principles,
    active_consent_count: activeConsentCount,
    recent_deliveries: recentDeliveries
  };
}

export async function sweepMicrosoft365SmsReminders(
  client: PoolClient,
  auth: Pick<AuthUser, "tenantId"> & { id: string | null },
  input: { limit?: number } = {}
): Promise<SweepMicrosoft365SmsRemindersResult> {
  if (!config.MICROSOFT_365_SMS_OPTIMIZATION_ENABLED) {
    return {
      scanned_mapping_count: 0,
      queued_count: 0,
      overdue_queued_count: 0,
      suppressed_count: 0,
      ineligible_count: 0,
      failed_count: 0
    };
  }

  await assertPhase8SchemaReady(client);
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
  const { rows } = await client.query<ReminderCandidateRow>(
    `
      SELECT
        id::text,
        related_record_type::text,
        related_record_id,
        request_link_url,
        status::text,
        reminder_enabled,
        related_record_label,
        last_submission_status::text,
        last_submission_exception_state::text
      FROM microsoft_client_intake_mapping
      WHERE tenant_id = $1
        AND status = 'active'::microsoft_client_intake_mapping_status
        AND reminder_enabled = true
      ORDER BY updated_at DESC
      LIMIT $2
    `,
    [auth.tenantId, limit]
  );

  let queuedCount = 0;
  let overdueQueuedCount = 0;
  let suppressedCount = 0;
  let ineligibleCount = 0;
  let failedCount = 0;

  for (const row of rows) {
    const context = await resolveSmsContext(client, auth.tenantId, row.related_record_type, row.related_record_id);
    if (context.isComplete === true || ["approved", "rejected", "archived"].includes(row.last_submission_status ?? "")) {
      suppressedCount += 1;
      continue;
    }
    if (["waiting_on_client", "paused", "manually_overridden"].includes(row.last_submission_exception_state ?? "")) {
      suppressedCount += 1;
      continue;
    }
    const normalizedPhone = normalizePhoneNumber(context.recipientPhone);
    if (!normalizedPhone) {
      ineligibleCount += 1;
      continue;
    }
    const consent = await loadConsentByNormalizedPhone(client, auth.tenantId, normalizedPhone);
    if (!consent || consent.consent_status !== "opted_in") {
      ineligibleCount += 1;
      continue;
    }
    if (consent.suppress_until && Date.parse(consent.suppress_until) > Date.now()) {
      suppressedCount += 1;
      continue;
    }
    const { rows: lastSmsRows } = await client.query<{ last_sent_at: string | null }>(
      `
        SELECT max(COALESCE(delivered_at, sent_at, queued_at))::text AS last_sent_at
        FROM microsoft_sms_delivery
        WHERE tenant_id = $1
          AND related_record_type = $2::microsoft_sms_record_type
          AND related_record_id = $3
          AND trigger_type IN ('reminder'::microsoft_sms_trigger_type, 'overdue'::microsoft_sms_trigger_type)
          AND status NOT IN ('failed'::microsoft_sms_delivery_status, 'archived'::microsoft_sms_delivery_status)
      `,
      [auth.tenantId, row.related_record_type, row.related_record_id]
    );
    const lastSentAt = lastSmsRows[0]?.last_sent_at ? Date.parse(lastSmsRows[0].last_sent_at) : Number.NaN;
    const cadenceHours = context.relatedRecordType === "job_readiness_item" ? 72 : 96;
    if (Number.isFinite(lastSentAt) && Date.now() - lastSentAt < cadenceHours * 60 * 60 * 1000) {
      suppressedCount += 1;
      continue;
    }
    const reminderWindowKey = Math.floor(Date.now() / (cadenceHours * 60 * 60 * 1000));

    const overdue = Boolean(context.dueAt) && Date.parse(context.dueAt ?? "") < Date.now();
    try {
      await queueMicrosoft365SmsDeliveryForSystem(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id ?? null,
        related_record_type: row.related_record_type,
        related_record_id: row.related_record_id,
        template_key: overdue ? "required_items_overdue_sms" : "required_items_reminder_sms",
        trigger_type: overdue ? "overdue" : "reminder",
        contact_id: context.contactId ?? null,
        recipient_name: context.recipientName ?? context.organizationName ?? "Client",
        recipient_phone_number: context.recipientPhone,
        secure_link_url: row.request_link_url,
        source_change_key: `phase8-sms:${row.id}:${overdue ? "overdue" : "reminder"}:${row.last_submission_status ?? "none"}:${reminderWindowKey}`,
        extra_merge_context: {
          project_label: context.relatedRecordLabel ?? context.organizationName ?? context.canonicalDashboardId
        }
      });
      queuedCount += 1;
      if (overdue) {
        overdueQueuedCount += 1;
      }
    } catch (error) {
      failedCount += 1;
      await recordMicrosoftIntegrationEvent(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id ?? null,
        integrationArea: "sms_automation",
        eventLevel: "error",
        eventType: "sms.reminder.queue_failed",
        eventStatus: "failed",
        summary: "SMS reminder sweep could not queue a delivery.",
        detail: {
          related_record_type: row.related_record_type,
          related_record_id: row.related_record_id,
          message: error instanceof Error ? error.message : "Unknown SMS queue failure."
        },
        relatedEntityType: "microsoft_client_intake_mapping",
        relatedEntityId: row.id
      });
    }
  }

  return {
    scanned_mapping_count: rows.length,
    queued_count: queuedCount,
    overdue_queued_count: overdueQueuedCount,
    suppressed_count: suppressedCount,
    ineligible_count: ineligibleCount,
    failed_count: failedCount
  };
}
