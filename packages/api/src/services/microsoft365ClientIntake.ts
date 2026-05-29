import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { z } from "zod";
import { hasAuthorityTier } from "../authz/authority.js";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  Microsoft365ClientIntakeArtifact,
  Microsoft365ClientIntakeBaseline,
  Microsoft365ClientIntakeCurrentStateFinding,
  Microsoft365ClientIntakeDiagnosticsResponse,
  Microsoft365ClientIntakeDocReference,
  Microsoft365ClientIntakeEnvironment,
  Microsoft365ClientIntakeExceptionState,
  Microsoft365ClientIntakeEventRecord,
  Microsoft365ClientIntakeEventType,
  Microsoft365ClientIntakeGoNoGo,
  Microsoft365ClientIntakeMappingRecord,
  Microsoft365ClientIntakeMappingStatus,
  Microsoft365ClientIntakeRecordType,
  Microsoft365ClientIntakeRefactorItem,
  Microsoft365ClientIntakeSubmissionRecord,
  Microsoft365ClientIntakeSubmissionStatus,
  Microsoft365ClientIntakeValidationIssue,
  RecordMicrosoft365ClientIntakeSubmissionInput,
  ReviewMicrosoft365ClientIntakeSubmissionInput,
  SweepMicrosoft365ClientIntakeRemindersResult,
  UpsertMicrosoft365ClientIntakeMappingInput
} from "../types/microsoft365ClientIntake.js";
import { resolveApiRepoPath } from "../utils/repoPaths.js";
import { createAuditLog } from "./audit.js";
import { writeJobActivity } from "./jobTruth/activityLogService.js";
import { updateReadinessItem } from "./jobTruth/jobService.js";
import { getMicrosoft365GovernanceValidationIssues } from "./microsoft365Governance.js";
import {
  getMicrosoft365MailAutomationValidationIssues,
  queueMicrosoft365MailAutomationDeliveryForSystem
} from "./microsoft365MailAutomation.js";
import { getMicrosoft365OperatingSystemValidationIssues } from "./microsoft365OperatingSystem.js";
import { getMicrosoft365ProvisioningValidationIssues } from "./microsoft365Provisioning.js";
import { recordMicrosoftIntegrationEvent } from "./microsoftIntegrationObservability.js";
import { emitOperationalEvent } from "./operationalEvents.js";
import { inferResourceTypeFromFile, syncLegacyResourceLibraryItemLinks } from "./resourceLibrary.js";

const environmentSchema = z.enum(["development", "staging", "production"]);
const recordTypeSchema = z.enum(["job", "job_readiness_item"]);
const mappingStatusSchema = z.enum(["active", "paused", "archived"]);
const exceptionStateSchema = z.enum(["none", "waiting_on_client", "paused", "manually_overridden"]);
const submissionStatusSchema = z.enum([
  "received_matched",
  "received_unmatched",
  "under_review",
  "revision_requested",
  "approved",
  "rejected",
  "archived"
]);
const eventTypeSchema = z.enum([
  "mapping_upserted",
  "submission_received",
  "submission_matched",
  "submission_unmatched",
  "reviewer_notified",
  "reviewer_notification_failed",
  "reviewer_assigned",
  "client_confirmation_queued",
  "client_confirmation_failed",
  "reminder_queued",
  "reminder_failed",
  "revision_requested",
  "exception_state_changed",
  "escalation_queued",
  "escalation_failed",
  "digest_queued",
  "digest_failed",
  "manual_override_applied",
  "approved",
  "rejected",
  "resource_linked"
]);

const baselineSchema = z.object({
  phase: z.literal("phase5_secure_client_intake_mvp"),
  baseline_version: z.string().trim().min(1),
  environment: environmentSchema,
  tenant_tier: z.enum(["sandbox", "preproduction", "production"]),
  upload_architecture: z.object({
    upload_pattern: z.string().trim().min(1),
    forms_policy: z.string().trim().min(1),
    source_of_truth_rule: z.string().trim().min(1),
    external_access_rule: z.string().trim().min(1),
    traceability_rule: z.string().trim().min(1),
    review_gate_rule: z.string().trim().min(1)
  }),
  mapping_defaults: z.object({
    default_record_strategy: z.string().trim().min(1),
    sharepoint_site_url: z.string().trim().url(),
    library_name: z.string().trim().min(1),
    folder_path_pattern: z.string().trim().min(1),
    request_link_policy: z.string().trim().min(1),
    reviewer_resolution_rule: z.string().trim().min(1),
    default_reminder_cadence_hours: z.number().int().positive(),
    default_request_mode: z.string().trim().min(1)
  }),
  matching_rules: z
    .array(
      z.object({
        order: z.number().int().positive(),
        key: z.string().trim().min(1),
        description: z.string().trim().min(1),
        confidence: z.enum(["high", "medium", "low"]),
        escalation_rule: z.string().trim().min(1)
      })
    )
    .min(1),
  notification_flows: z.object({
    client_confirmation: z.object({
      provider: z.string().trim().min(1),
      template_key: z.string().trim().min(1).nullable().optional(),
      overdue_template_key: z.string().trim().min(1).nullable().optional(),
      trigger_type: z.string().trim().min(1).nullable().optional(),
      overdue_trigger_type: z.string().trim().min(1).nullable().optional(),
      recipient_rule: z.string().trim().min(1).nullable().optional(),
      event_type: z.string().trim().min(1).nullable().optional(),
      channel: z.string().trim().min(1).nullable().optional(),
      deep_link_rule: z.string().trim().min(1).nullable().optional(),
      target: z.string().trim().min(1).nullable().optional(),
      suppression_rule: z.string().trim().min(1).nullable().optional()
    }),
    reviewer_notification: z.object({
      provider: z.string().trim().min(1),
      template_key: z.string().trim().min(1).nullable().optional(),
      overdue_template_key: z.string().trim().min(1).nullable().optional(),
      trigger_type: z.string().trim().min(1).nullable().optional(),
      overdue_trigger_type: z.string().trim().min(1).nullable().optional(),
      recipient_rule: z.string().trim().min(1).nullable().optional(),
      event_type: z.string().trim().min(1).nullable().optional(),
      channel: z.string().trim().min(1).nullable().optional(),
      deep_link_rule: z.string().trim().min(1).nullable().optional(),
      target: z.string().trim().min(1).nullable().optional(),
      suppression_rule: z.string().trim().min(1).nullable().optional()
    }),
    reminder_email: z.object({
      provider: z.string().trim().min(1),
      template_key: z.string().trim().min(1).nullable().optional(),
      overdue_template_key: z.string().trim().min(1).nullable().optional(),
      trigger_type: z.string().trim().min(1).nullable().optional(),
      overdue_trigger_type: z.string().trim().min(1).nullable().optional(),
      recipient_rule: z.string().trim().min(1).nullable().optional(),
      event_type: z.string().trim().min(1).nullable().optional(),
      channel: z.string().trim().min(1).nullable().optional(),
      deep_link_rule: z.string().trim().min(1).nullable().optional(),
      target: z.string().trim().min(1).nullable().optional(),
      suppression_rule: z.string().trim().min(1).nullable().optional()
    }),
    failure_alerting: z.object({
      provider: z.string().trim().min(1),
      template_key: z.string().trim().min(1).nullable().optional(),
      overdue_template_key: z.string().trim().min(1).nullable().optional(),
      trigger_type: z.string().trim().min(1).nullable().optional(),
      overdue_trigger_type: z.string().trim().min(1).nullable().optional(),
      recipient_rule: z.string().trim().min(1).nullable().optional(),
      event_type: z.string().trim().min(1).nullable().optional(),
      channel: z.string().trim().min(1).nullable().optional(),
      deep_link_rule: z.string().trim().min(1).nullable().optional(),
      target: z.string().trim().min(1).nullable().optional(),
      suppression_rule: z.string().trim().min(1).nullable().optional()
    })
  }),
  exception_handling: z.object({
    unmatched_queue_rule: z.string().trim().min(1),
    review_handling_rule: z.string().trim().min(1),
    retry_rule: z.string().trim().min(1),
    audit_rule: z.string().trim().min(1),
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

const DOCS: Microsoft365ClientIntakeDocReference[] = [
  {
    key: "phase_summary",
    title: "Phase 5 Secure Client Intake MVP",
    path: "docs/microsoft365/phase5-secure-client-intake-mvp.md",
    summary: "Primary phase audit, upload architecture, matching rules, reminders, exception handling, and rollout guidance."
  },
  {
    key: "request_files_model",
    title: "Request Files Intake Model",
    path: "docs/microsoft365/request-files-intake-model.md",
    summary: "How secure upload-only links map back to dashboard required items without exposing unrelated files."
  },
  {
    key: "client_instructions",
    title: "Client Intake MVP Instructions",
    path: "docs/microsoft365/client-intake-mvp-instructions.md",
    summary: "The exact user-facing language for the MVP upload flow."
  }
];

const ARTIFACTS: Microsoft365ClientIntakeArtifact[] = [
  {
    kind: "baseline",
    path: "ops/microsoft365/phase5/client-intake-baseline.development.json",
    summary: "Development/sandbox Phase 5 secure intake baseline.",
    tenant_admin_action: false
  },
  {
    kind: "baseline",
    path: "ops/microsoft365/phase5/client-intake-baseline.staging.json",
    summary: "Staging/pilot Phase 5 secure intake baseline.",
    tenant_admin_action: false
  },
  {
    kind: "baseline",
    path: "ops/microsoft365/phase5/client-intake-baseline.production.json",
    summary: "Production Phase 5 secure intake baseline.",
    tenant_admin_action: false
  },
  {
    kind: "script",
    path: "ops/microsoft365/phase5/Test-M365ClientIntakeBaseline.ps1",
    summary: "Non-destructive validation script for the secure client intake baseline and environment assumptions.",
    tenant_admin_action: true
  },
  {
    kind: "script",
    path: "ops/microsoft365/phase5/Get-M365ClientIntakePlan.ps1",
    summary: "Renders the exact mapping and notification plan for a record type before rollout.",
    tenant_admin_action: false
  },
  {
    kind: "api",
    path: "GET /api/admin/system/microsoft-client-intake",
    summary: "Admin diagnostics payload for Phase 5 secure client intake mappings, submissions, and rollout readiness.",
    tenant_admin_action: false
  }
];

type MappingRow = Omit<Microsoft365ClientIntakeMappingRecord, "reviewer_user_ids" | "metadata"> & {
  reviewer_user_ids: string[] | null;
  manager_user_ids: string[] | null;
  department_lead_user_ids: string[] | null;
  metadata: Record<string, unknown> | null;
};

type SubmissionRow = Omit<
  Microsoft365ClientIntakeSubmissionRecord,
  "file_size_bytes" | "match_confidence" | "reviewer_user_ids" | "metadata"
> & {
  file_size_bytes: number | string | null;
  match_confidence: number | string;
  reviewer_user_ids: string[] | null;
  metadata: Record<string, unknown> | null;
};

type EventRow = Omit<Microsoft365ClientIntakeEventRecord, "metadata"> & {
  metadata: Record<string, unknown> | null;
};

type RelatedContext = {
  relatedRecordType: Microsoft365ClientIntakeRecordType;
  relatedRecordId: string;
  canonicalDashboardId: string;
  dashboardUrl: string | null;
  jobId: string;
  requiredItemId: string | null;
  organizationId: string | null;
  primaryContactId: string | null;
  departmentScope: string | null;
  relatedRecordLabel: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  organizationName: string | null;
  jobTitle: string | null;
  jobNumber: string | null;
  ownerName: string | null;
  ownerUserId: string | null;
  dueAt: string | null;
  isComplete: boolean | null;
};

type MatchResult = {
  mapping: MappingRow | null;
  matchRule: string | null;
  matchConfidence: number;
};

type ReminderState = {
  suppress: boolean;
  suppressReason: string | null;
  overdue: boolean;
  recipientEmail: string | null;
  recipientName: string | null;
};

function resolveEnvironment(): Microsoft365ClientIntakeEnvironment {
  if (config.MICROSOFT_365_CLIENT_INTAKE_ENV) {
    return config.MICROSOFT_365_CLIENT_INTAKE_ENV;
  }
  if (config.NODE_ENV === "production") {
    return "production";
  }
  return "development";
}

function getBaselinePath(environment: Microsoft365ClientIntakeEnvironment) {
  return resolveApiRepoPath("ops", "microsoft365", "phase5", `client-intake-baseline.${environment}.json`);
}

function loadBaseline(environment = resolveEnvironment()): Microsoft365ClientIntakeBaseline {
  const raw = readFileSync(getBaselinePath(environment), "utf8");
  const parsed = baselineSchema.parse(JSON.parse(raw));
  if (parsed.environment !== environment) {
    throw new Error(
      `Microsoft 365 client intake baseline environment mismatch: expected ${environment}, found ${parsed.environment}.`
    );
  }
  return parsed;
}

function addIssue(issues: Microsoft365ClientIntakeValidationIssue[], issue: Microsoft365ClientIntakeValidationIssue) {
  issues.push(issue);
}

function buildCurrentStateFindings(): Microsoft365ClientIntakeCurrentStateFinding[] {
  return [
    {
      key: "request_files_not_yet_modeled",
      state: "missing",
      summary:
        "The dashboard already has durable readiness items, record resources, and Microsoft mail automation, but it did not yet have a durable intake mapping model for Request Files or secure upload receipt matching.",
      evidence: [
        "packages/api/src/services/jobTruth/jobService.ts",
        "packages/api/src/services/recordResources.ts",
        "packages/api/src/services/microsoft365MailAutomation.ts"
      ]
    },
    {
      key: "resource_library_can_hold_external_links",
      state: "existing",
      summary:
        "The resource library already supports SharePoint and OneDrive external links, which makes it practical to surface matched intake files back inside the dashboard without copying client uploads into a second storage system.",
      evidence: [
        "packages/api/src/services/recordResources.ts",
        "packages/api/src/services/resourceLibrary.ts",
        "packages/api/src/types/recordResources.ts"
      ]
    },
    {
      key: "reminder_queue_exists",
      state: "existing",
      summary:
        "The worker already has an internal scheduled-sweep pattern for reminders, so intake reminders can reuse the same API-driven scheduler instead of creating a second background execution style.",
      evidence: [
        "packages/worker/src/jobs/checklistMonitor.ts",
        "packages/api/src/routes/checklists.ts",
        "packages/worker/src/queue/bullmq.ts"
      ]
    },
    {
      key: "forms_file_upload_not_safe_default",
      state: "conflict",
      summary:
        "Microsoft Forms is not a safe primary pattern for anonymous external file intake, so the secure MVP should stay on SharePoint or OneDrive Request Files and use Forms only for optional non-file metadata later.",
      evidence: [
        "docs/microsoft365/phase5-secure-client-intake-mvp.md",
        "docs/microsoft365/request-files-intake-model.md"
      ],
      recommended_refactor: "Keep file intake on Request Files and reserve Forms for optional supplemental questions."
    }
  ];
}

function buildRefactorFirst(): Microsoft365ClientIntakeRefactorItem[] {
  return [
    {
      key: "do_not_bypass_mail_automation",
      severity: "high",
      summary: "Client confirmation and reminder emails should keep using the Phase 4 mail automation queue instead of feature-local HTTP calls or personal inbox assumptions.",
      consequence: "Bypassing the queue would break logging, retry, and shared-mailbox governance."
    },
    {
      key: "keep_request_files_mapping_explicit",
      severity: "high",
      summary: "Every upload destination must be mapped explicitly to a dashboard record instead of inferring the record only from folder names.",
      consequence: "Without explicit mapping, unmatched uploads become hard to trace and reminders become unreliable."
    },
    {
      key: "preserve_dashboard_required_item_truth",
      severity: "high",
      summary: "Upload receipt should not auto-complete dashboard required items without an internal review action.",
      consequence: "Auto-completing on receipt would turn Microsoft into a workflow authority and create false-complete states."
    }
  ];
}

function determineRecommendation(issues: Microsoft365ClientIntakeValidationIssue[]): Microsoft365ClientIntakeGoNoGo {
  if (issues.some((issue) => issue.severity === "error")) {
    return "no_go";
  }
  if (issues.length > 0) {
    return "conditional_go";
  }
  return "go";
}

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeStringArray(values: string[] | null | undefined) {
  return Array.isArray(values)
    ? values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))
    : [];
}

function normalizeJsonObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function buildCanonicalDashboardId(recordType: Microsoft365ClientIntakeRecordType, recordId: string) {
  return recordType === "job" ? `project:${recordId}` : `required_item:${recordId}`;
}

function buildDashboardUrl(recordType: Microsoft365ClientIntakeRecordType, recordId: string, jobId?: string | null) {
  if (!config.ADMIN_WEB_URL) {
    return null;
  }
  const base = config.ADMIN_WEB_URL.replace(/\/$/, "");
  if (recordType === "job") {
    return `${base}/#jobs/${recordId}`;
  }
  return jobId ? `${base}/#jobs/${jobId}` : null;
}

function addHours(value: string, hours: number) {
  const baseTime = Date.parse(value);
  if (!Number.isFinite(baseTime)) {
    return null;
  }
  return new Date(baseTime + hours * 60 * 60 * 1000).toISOString();
}

function pickAssignedReviewer(reviewerUserIds: string[], ownerUserId: string | null) {
  return reviewerUserIds[0] ?? ownerUserId ?? null;
}

function isReminderSuppressedByStatus(status: Microsoft365ClientIntakeSubmissionStatus | null | undefined) {
  return Boolean(status && ["received_matched", "under_review", "revision_requested", "approved"].includes(status));
}

function isExceptionStateSuppressed(exceptionState: Microsoft365ClientIntakeExceptionState | null | undefined) {
  return Boolean(exceptionState && exceptionState !== "none");
}

function parseMappingRow(row: MappingRow): Microsoft365ClientIntakeMappingRecord {
  return {
    ...row,
    reviewer_user_ids: normalizeStringArray(row.reviewer_user_ids),
    manager_user_ids: normalizeStringArray(row.manager_user_ids),
    department_lead_user_ids: normalizeStringArray(row.department_lead_user_ids),
    metadata: normalizeJsonObject(row.metadata)
  };
}

function parseSubmissionRow(row: SubmissionRow): Microsoft365ClientIntakeSubmissionRecord {
  return {
    ...row,
    file_size_bytes: row.file_size_bytes === null ? null : Number(row.file_size_bytes),
    match_confidence: Number(row.match_confidence ?? 0),
    reviewer_user_ids: normalizeStringArray(row.reviewer_user_ids),
    escalation_level: Number(row.escalation_level ?? 0),
    metadata: normalizeJsonObject(row.metadata)
  };
}

function parseEventRow(row: EventRow): Microsoft365ClientIntakeEventRecord {
  return {
    ...row,
    metadata: normalizeJsonObject(row.metadata)
  };
}

function normalizeMatchText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createProviderSubmissionKey(input: RecordMicrosoft365ClientIntakeSubmissionInput) {
  const providerKey = normalizeText(input.provider_submission_key);
  if (providerKey) {
    return providerKey;
  }
  const driveItemId = normalizeText(input.microsoft_drive_item_id);
  if (driveItemId) {
    return driveItemId;
  }
  throw new ApiError(400, "A provider submission key or Microsoft drive item id is required.");
}

async function hasClientIntakeSchema(client: PoolClient) {
  const { rows } = await client.query<{
    has_mapping: boolean;
    has_submission: boolean;
    has_event: boolean;
  }>(
    `
      SELECT
        (to_regclass('public.microsoft_client_intake_mapping') IS NOT NULL) AS has_mapping,
        (to_regclass('public.microsoft_client_intake_submission') IS NOT NULL) AS has_submission,
        (to_regclass('public.microsoft_client_intake_event') IS NOT NULL) AS has_event
    `
  );
  const row = rows[0];
  return Boolean(row?.has_mapping && row?.has_submission && row?.has_event);
}

async function assertClientIntakeSchemaReady(client: PoolClient) {
  if (!(await hasClientIntakeSchema(client))) {
    throw new ApiError(503, "Microsoft 365 client intake schema is not available in this environment.");
  }
}

function ensureClientIntakeEnabled() {
  if (!config.MICROSOFT_365_CLIENT_INTAKE_ENABLED) {
    throw new ApiError(503, "Microsoft 365 client intake is disabled in this environment.");
  }
}

function assertClientIntakeAccess(auth: Pick<AuthUser, "authorityTier">) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    throw new ApiError(403, "Integration governance access is required.");
  }
}

function assertClientIntakeManageAccess(auth: Pick<AuthUser, "authorityTier">) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Integration governance management access is required.");
  }
}

async function recordClientIntakeEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    mappingId?: string | null;
    submissionId?: string | null;
    eventType: Microsoft365ClientIntakeEventType;
    actorUserId?: string | null;
    note?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const eventType = eventTypeSchema.parse(input.eventType);
  await client.query(
    `
      INSERT INTO microsoft_client_intake_event (
        tenant_id,
        mapping_id,
        submission_id,
        event_type,
        actor_user_id,
        note,
        metadata
      )
      VALUES ($1,$2::uuid,$3::uuid,$4::microsoft_client_intake_event_type,$5,$6,$7::jsonb)
    `,
    [
      input.tenantId,
      input.mappingId ?? null,
      input.submissionId ?? null,
      eventType,
      input.actorUserId ?? null,
      input.note ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
}

async function resolveRelatedContext(
  client: PoolClient,
  tenantId: string,
  relatedRecordType: Microsoft365ClientIntakeRecordType,
  relatedRecordId: string
): Promise<RelatedContext> {
  if (recordTypeSchema.parse(relatedRecordType) === "job") {
    const { rows } = await client.query<{
      id: string;
      job_number: string | null;
      title: string | null;
      department_type: string | null;
      organization_id: string | null;
      organization_name: string | null;
      primary_contact_id: string | null;
      primary_contact_name: string | null;
      primary_contact_email: string | null;
      owner_id: string | null;
      owner_name: string | null;
      client_deadline_at: string | null;
    }>(
      `
        SELECT
          j.id::text,
          j.job_number,
          j.title,
          j.department_type::text,
          j.organization_id::text,
          org.display_name AS organization_name,
          contact.id::text AS primary_contact_id,
          contact.full_name AS primary_contact_name,
          contact.email AS primary_contact_email,
          owner.id::text AS owner_id,
          owner.full_name AS owner_name,
          j.client_deadline_at::text
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
      [tenantId, relatedRecordId]
    );
    const job = rows[0];
    if (!job) {
      throw new ApiError(404, "Job not found.");
    }
    return {
      relatedRecordType: "job",
      relatedRecordId: job.id,
      canonicalDashboardId: buildCanonicalDashboardId("job", job.id),
      dashboardUrl: buildDashboardUrl("job", job.id),
      jobId: job.id,
      requiredItemId: null,
      organizationId: job.organization_id,
      primaryContactId: job.primary_contact_id,
      departmentScope: job.department_type,
      relatedRecordLabel: job.title ?? job.job_number,
      recipientName: job.primary_contact_name,
      recipientEmail: job.primary_contact_email,
      organizationName: job.organization_name,
      jobTitle: job.title,
      jobNumber: job.job_number,
      ownerName: job.owner_name,
      ownerUserId: job.owner_id,
      dueAt: job.client_deadline_at,
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
    primary_contact_email: string | null;
    owner_id: string | null;
    owner_name: string | null;
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
        contact.email AS primary_contact_email,
        owner.id::text AS owner_id,
        owner.full_name AS owner_name
      FROM job_readiness_items item
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
    [tenantId, relatedRecordId]
  );
  const item = rows[0];
  if (!item) {
    throw new ApiError(404, "Required item not found.");
  }
  return {
    relatedRecordType: "job_readiness_item",
    relatedRecordId: item.id,
    canonicalDashboardId: buildCanonicalDashboardId("job_readiness_item", item.id),
    dashboardUrl: buildDashboardUrl("job_readiness_item", item.id, item.job_id),
    jobId: item.job_id,
    requiredItemId: item.id,
    organizationId: item.organization_id,
    primaryContactId: item.primary_contact_id,
    departmentScope: item.department_type,
    relatedRecordLabel: item.label,
    recipientName: item.primary_contact_name,
    recipientEmail: item.primary_contact_email,
    organizationName: item.organization_name,
    jobTitle: item.job_title,
    jobNumber: item.job_number,
    ownerName: item.owner_name,
    ownerUserId: item.owner_id,
    dueAt: item.due_at,
    isComplete: item.is_complete
  };
}

async function loadMappingById(client: PoolClient, tenantId: string, mappingId: string) {
  const { rows } = await client.query<MappingRow>(
    `
      SELECT
        id::text,
        tenant_id::text,
        related_record_type::text,
        related_record_id,
        canonical_dashboard_id,
        job_id::text,
        required_item_id::text,
        organization_id::text,
        primary_contact_id::text,
        department_scope,
        related_record_label,
        request_mode,
        request_link_url,
        request_link_external_id,
        sharepoint_site_url,
        sharepoint_library_name,
        sharepoint_folder_path,
        sharepoint_folder_url,
        forms_schema_key,
        recipient_name_override,
        recipient_email_override,
        reviewer_user_ids,
        manager_user_ids,
        department_lead_user_ids,
        reminder_enabled,
        reminder_cadence_hours,
        review_due_hours,
        first_escalation_hours,
        second_escalation_hours,
        digest_enabled,
        last_submission_at::text,
        last_submission_status::text,
        last_submission_exception_state::text,
        last_reminder_sent_at::text,
        last_reminder_trigger_type,
        status::text,
        metadata,
        created_by_user_id::text,
        updated_by_user_id::text,
        created_at::text,
        updated_at::text
      FROM microsoft_client_intake_mapping
      WHERE tenant_id = $1
        AND id = $2::uuid
      LIMIT 1
    `,
    [tenantId, mappingId]
  );
  return rows[0] ?? null;
}

async function loadMappingByRecord(
  client: PoolClient,
  tenantId: string,
  relatedRecordType: Microsoft365ClientIntakeRecordType,
  relatedRecordId: string
) {
  const { rows } = await client.query<MappingRow>(
    `
      SELECT
        id::text,
        tenant_id::text,
        related_record_type::text,
        related_record_id,
        canonical_dashboard_id,
        job_id::text,
        required_item_id::text,
        organization_id::text,
        primary_contact_id::text,
        department_scope,
        related_record_label,
        request_mode,
        request_link_url,
        request_link_external_id,
        sharepoint_site_url,
        sharepoint_library_name,
        sharepoint_folder_path,
        sharepoint_folder_url,
        forms_schema_key,
        recipient_name_override,
        recipient_email_override,
        reviewer_user_ids,
        manager_user_ids,
        department_lead_user_ids,
        reminder_enabled,
        reminder_cadence_hours,
        review_due_hours,
        first_escalation_hours,
        second_escalation_hours,
        digest_enabled,
        last_submission_at::text,
        last_submission_status::text,
        last_submission_exception_state::text,
        last_reminder_sent_at::text,
        last_reminder_trigger_type,
        status::text,
        metadata,
        created_by_user_id::text,
        updated_by_user_id::text,
        created_at::text,
        updated_at::text
      FROM microsoft_client_intake_mapping
      WHERE tenant_id = $1
        AND related_record_type = $2::microsoft_client_intake_record_type
        AND related_record_id = $3
      LIMIT 1
    `,
    [tenantId, relatedRecordType, relatedRecordId]
  );
  return rows[0] ?? null;
}

async function loadExistingSubmissionByKey(client: PoolClient, tenantId: string, providerSubmissionKey: string) {
  const { rows } = await client.query<SubmissionRow>(
    `
      SELECT
        id::text,
        tenant_id::text,
        mapping_id::text,
        related_record_type::text,
        related_record_id,
        canonical_dashboard_id,
        job_id::text,
        required_item_id::text,
        organization_id::text,
        primary_contact_id::text,
        request_link_external_id,
        request_link_url,
        sharepoint_site_url,
        sharepoint_library_name,
        sharepoint_folder_path,
        sharepoint_folder_url,
        provider_submission_key,
        microsoft_drive_id,
        microsoft_drive_item_id,
        resource_library_item_id::text,
        file_name,
        file_url,
        content_type,
        file_size_bytes,
        uploader_name,
        uploader_email,
        submitted_at::text,
        matching_status::text,
        match_rule,
        match_confidence,
        reviewer_user_ids,
        assigned_reviewer_user_id::text,
        exception_state::text,
        exception_note,
        exception_set_by_user_id::text,
        exception_set_at::text,
        review_note,
        reviewed_by_user_id::text,
        reviewed_at::text,
        review_due_at::text,
        first_escalation_at::text,
        second_escalation_at::text,
        escalated_at::text,
        escalation_level,
        revision_requested_by_user_id::text,
        revision_requested_at::text,
        revision_request_delivery_id::text,
        confirmation_delivery_id::text,
        metadata,
        last_error,
        created_at::text,
        updated_at::text
      FROM microsoft_client_intake_submission
      WHERE tenant_id = $1
        AND provider_submission_key = $2
      LIMIT 1
    `,
    [tenantId, providerSubmissionKey]
  );
  return rows[0] ? parseSubmissionRow(rows[0]) : null;
}

async function loadSubmissionById(client: PoolClient, tenantId: string, submissionId: string) {
  const { rows } = await client.query<SubmissionRow>(
    `
      SELECT
        id::text,
        tenant_id::text,
        mapping_id::text,
        related_record_type::text,
        related_record_id,
        canonical_dashboard_id,
        job_id::text,
        required_item_id::text,
        organization_id::text,
        primary_contact_id::text,
        request_link_external_id,
        request_link_url,
        sharepoint_site_url,
        sharepoint_library_name,
        sharepoint_folder_path,
        sharepoint_folder_url,
        provider_submission_key,
        microsoft_drive_id,
        microsoft_drive_item_id,
        resource_library_item_id::text,
        file_name,
        file_url,
        content_type,
        file_size_bytes,
        uploader_name,
        uploader_email,
        submitted_at::text,
        matching_status::text,
        match_rule,
        match_confidence,
        reviewer_user_ids,
        assigned_reviewer_user_id::text,
        exception_state::text,
        exception_note,
        exception_set_by_user_id::text,
        exception_set_at::text,
        review_note,
        reviewed_by_user_id::text,
        reviewed_at::text,
        review_due_at::text,
        first_escalation_at::text,
        second_escalation_at::text,
        escalated_at::text,
        escalation_level,
        revision_requested_by_user_id::text,
        revision_requested_at::text,
        revision_request_delivery_id::text,
        confirmation_delivery_id::text,
        metadata,
        last_error,
        created_at::text,
        updated_at::text
      FROM microsoft_client_intake_submission
      WHERE tenant_id = $1
        AND id = $2::uuid
      LIMIT 1
    `,
    [tenantId, submissionId]
  );
  return rows[0] ? parseSubmissionRow(rows[0]) : null;
}

async function findMappingForSubmission(
  client: PoolClient,
  tenantId: string,
  input: RecordMicrosoft365ClientIntakeSubmissionInput
): Promise<MatchResult> {
  const mappingId = normalizeText(input.mapping_id);
  if (mappingId) {
    const mapping = await loadMappingById(client, tenantId, mappingId);
    if (mapping) {
      return { mapping, matchRule: "mapping_id", matchConfidence: 100 };
    }
  }

  const requestLinkExternalId = normalizeText(input.request_link_external_id);
  if (requestLinkExternalId) {
    const { rows } = await client.query<MappingRow>(
      `
        SELECT *
        FROM microsoft_client_intake_mapping
        WHERE tenant_id = $1
          AND request_link_external_id = $2
          AND status = 'active'::microsoft_client_intake_mapping_status
        LIMIT 1
      `,
      [tenantId, requestLinkExternalId]
    );
    const mapping = rows[0] ?? null;
    if (mapping) {
      return { mapping, matchRule: "request_link_external_id", matchConfidence: 95 };
    }
  }

  const requestLinkUrl = normalizeText(input.request_link_url);
  if (requestLinkUrl) {
    const { rows } = await client.query<MappingRow>(
      `
        SELECT *
        FROM microsoft_client_intake_mapping
        WHERE tenant_id = $1
          AND request_link_url = $2
          AND status = 'active'::microsoft_client_intake_mapping_status
        LIMIT 1
      `,
      [tenantId, requestLinkUrl]
    );
    const mapping = rows[0] ?? null;
    if (mapping) {
      return { mapping, matchRule: "request_link_url", matchConfidence: 93 };
    }
  }

  const folderUrl = normalizeText(input.sharepoint_folder_url);
  if (folderUrl) {
    const { rows } = await client.query<MappingRow>(
      `
        SELECT *
        FROM microsoft_client_intake_mapping
        WHERE tenant_id = $1
          AND sharepoint_folder_url = $2
          AND status = 'active'::microsoft_client_intake_mapping_status
        LIMIT 1
      `,
      [tenantId, folderUrl]
    );
    const mapping = rows[0] ?? null;
    if (mapping) {
      return { mapping, matchRule: "sharepoint_folder_url", matchConfidence: 91 };
    }
  }

  const sharepointSiteUrl = normalizeText(input.sharepoint_site_url);
  const sharepointLibraryName = normalizeText(input.sharepoint_library_name);
  const sharepointFolderPath = normalizeText(input.sharepoint_folder_path);
  if (sharepointSiteUrl && sharepointLibraryName && sharepointFolderPath) {
    const { rows } = await client.query<MappingRow>(
      `
        SELECT *
        FROM microsoft_client_intake_mapping
        WHERE tenant_id = $1
          AND sharepoint_site_url = $2
          AND sharepoint_library_name = $3
          AND sharepoint_folder_path = $4
          AND status = 'active'::microsoft_client_intake_mapping_status
        LIMIT 1
      `,
      [tenantId, sharepointSiteUrl, sharepointLibraryName, sharepointFolderPath]
    );
    const mapping = rows[0] ?? null;
    if (mapping) {
      return { mapping, matchRule: "sharepoint_folder_path", matchConfidence: 90 };
    }
  }

  const hintedType = input.dashboard_entity_type_hint ?? null;
  const hintedId = normalizeText(input.dashboard_entity_id_hint);
  if (hintedType && hintedId) {
    const mapping = await loadMappingByRecord(client, tenantId, hintedType, hintedId);
    if (mapping) {
      return { mapping, matchRule: "dashboard_hint", matchConfidence: 84 };
    }
  }

  const hintedJobId =
    hintedType === "job"
      ? hintedId
      : hintedType === "job_readiness_item"
        ? (await resolveRelatedContext(client, tenantId, "job_readiness_item", hintedId ?? "")).jobId
        : null;
  if (hintedJobId) {
    const candidates = await loadRequiredItemMappingsForJob(client, tenantId, hintedJobId);
    const normalizedFileName = normalizeMatchText(input.file_name);
    const matchedCandidates = candidates.filter((candidate) => {
      const label = normalizeMatchText(candidate.related_record_label);
      return Boolean(label) && normalizedFileName.includes(label);
    });
    if (matchedCandidates.length === 1) {
      return { mapping: matchedCandidates[0], matchRule: "filename_required_item_label", matchConfidence: 68 };
    }
  }

  return { mapping: null, matchRule: null, matchConfidence: 0 };
}

async function updateMappingSnapshotFromSubmission(
  client: PoolClient,
  input: {
    tenantId: string;
    mappingId: string;
    submittedAt: string;
    status: Microsoft365ClientIntakeSubmissionStatus;
    exceptionState?: Microsoft365ClientIntakeExceptionState | null;
  }
) {
  const status = submissionStatusSchema.parse(input.status);
  const exceptionState = exceptionStateSchema.parse(input.exceptionState ?? "none");
  await client.query(
    `
      UPDATE microsoft_client_intake_mapping
      SET
        last_submission_at = $3::timestamptz,
        last_submission_status = $4::microsoft_client_intake_submission_status,
        last_submission_exception_state = $5::microsoft_client_intake_exception_state,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2::uuid
    `,
    [input.tenantId, input.mappingId, input.submittedAt, status, exceptionState]
  );
}

async function updateSubmissionLastError(client: PoolClient, tenantId: string, submissionId: string, message: string) {
  await client.query(
    `
      UPDATE microsoft_client_intake_submission
      SET
        last_error = $3,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2::uuid
    `,
    [tenantId, submissionId, message]
  );
}

async function upsertClientIntakeResourceLink(
  client: PoolClient,
  input: {
    tenantId: string;
    mapping: Microsoft365ClientIntakeMappingRecord;
    submission: Microsoft365ClientIntakeSubmissionRecord;
    approvalStatus: "pending_review" | "approved" | "rejected_not_useful";
    actorUserId?: string | null;
  }
) {
  if (!input.submission.file_url) {
    return null;
  }
  const resourceType = inferResourceTypeFromFile({
    fileName: input.submission.file_name,
    contentType: input.submission.content_type ?? null,
    storageKey: null,
    url: input.submission.file_url
  });
  const category = input.mapping.required_item_id ? "proof_document" : "support_document";
  const uploaderName = input.submission.uploader_name?.trim() || "Client Upload";
  const note = input.mapping.required_item_id
    ? `Client intake submission for ${input.mapping.related_record_label ?? input.mapping.canonical_dashboard_id}.`
    : `Client intake upload linked to ${input.mapping.related_record_label ?? input.mapping.canonical_dashboard_id}.`;

  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO resource_library_item (
        tenant_id, organization_id, location_id, shoot_id, uploader_user_id, uploader_name, resource_type, category, note,
        issue_type, approval_status, visibility_scope, best_reference_candidate, is_best_reference, best_reference_category,
        file_name, content_type, file_size_bytes, storage_key, file_url, upload_source, gps_lat, gps_lng, captured_at,
        source_record_type, source_record_id, reference_kind, external_provider, created_at, updated_at
      )
      VALUES (
        $1,$2::uuid,NULL,NULL,NULL,$3,$4::resource_library_type,$5::resource_library_category,$6,
        NULL,$7::resource_library_approval_status,'photographer_prep'::resource_library_visibility_scope,false,false,NULL,
        $8,$9,$10,NULL,$11,'system_migration'::resource_library_upload_source,NULL,NULL,$12::timestamptz,
        'microsoft_client_intake_submission',$13::uuid,'external_link'::resource_reference_kind,'sharepoint'::resource_external_provider,
        now(),now()
      )
      ON CONFLICT (tenant_id, source_record_type, source_record_id)
      DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        uploader_name = EXCLUDED.uploader_name,
        resource_type = EXCLUDED.resource_type,
        category = EXCLUDED.category,
        note = EXCLUDED.note,
        approval_status = EXCLUDED.approval_status,
        file_name = EXCLUDED.file_name,
        content_type = EXCLUDED.content_type,
        file_size_bytes = EXCLUDED.file_size_bytes,
        file_url = EXCLUDED.file_url,
        captured_at = EXCLUDED.captured_at,
        updated_at = now()
      RETURNING id::text
    `,
    [
      input.tenantId,
      input.mapping.organization_id,
      uploaderName,
      resourceType,
      category,
      note,
      input.approvalStatus,
      input.submission.file_name,
      input.submission.content_type ?? null,
      input.submission.file_size_bytes ?? null,
      input.submission.file_url,
      input.submission.submitted_at,
      input.submission.id
    ]
  );
  const resourceLibraryItemId = rows[0]?.id ?? null;
  if (!resourceLibraryItemId) {
    return null;
  }

  await syncLegacyResourceLibraryItemLinks(client, {
    tenantId: input.tenantId,
    itemId: resourceLibraryItemId,
    organizationId: input.mapping.organization_id,
    locationId: null,
    shootId: null,
    createdByUserId: input.actorUserId ?? null
  });

  if (input.mapping.job_id) {
    await client.query(
      `
        INSERT INTO resource_library_item_link (
          tenant_id,
          resource_library_item_id,
          object_type,
          object_id,
          created_by_user_id
        )
        VALUES ($1,$2::uuid,'job'::resource_record_object_type,$3::uuid,$4)
        ON CONFLICT (tenant_id, resource_library_item_id, object_type, object_id)
        DO NOTHING
      `,
      [input.tenantId, resourceLibraryItemId, input.mapping.job_id, input.actorUserId ?? null]
    );
  }

  await client.query(
    `
      UPDATE microsoft_client_intake_submission
      SET
        resource_library_item_id = $3::uuid,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2::uuid
    `,
    [input.tenantId, input.submission.id, resourceLibraryItemId]
  );

  await recordClientIntakeEvent(client, {
    tenantId: input.tenantId,
    mappingId: input.mapping.id,
    submissionId: input.submission.id,
    actorUserId: input.actorUserId ?? null,
    eventType: "resource_linked",
    note: "Submission file linked into the dashboard resource library.",
    metadata: {
      resource_library_item_id: resourceLibraryItemId,
      approval_status: input.approvalStatus
    }
  });

  return resourceLibraryItemId;
}

async function loadRequiredItemMappingsForJob(client: PoolClient, tenantId: string, jobId: string) {
  const { rows } = await client.query<MappingRow>(
    `
      SELECT
        id::text,
        tenant_id::text,
        related_record_type::text,
        related_record_id,
        canonical_dashboard_id,
        job_id::text,
        required_item_id::text,
        organization_id::text,
        primary_contact_id::text,
        department_scope,
        related_record_label,
        request_mode,
        request_link_url,
        request_link_external_id,
        sharepoint_site_url,
        sharepoint_library_name,
        sharepoint_folder_path,
        sharepoint_folder_url,
        forms_schema_key,
        recipient_name_override,
        recipient_email_override,
        reviewer_user_ids,
        manager_user_ids,
        department_lead_user_ids,
        reminder_enabled,
        reminder_cadence_hours,
        review_due_hours,
        first_escalation_hours,
        second_escalation_hours,
        digest_enabled,
        last_submission_at::text,
        last_submission_status::text,
        last_submission_exception_state::text,
        last_reminder_sent_at::text,
        last_reminder_trigger_type,
        status::text,
        metadata,
        created_by_user_id::text,
        updated_by_user_id::text,
        created_at::text,
        updated_at::text
      FROM microsoft_client_intake_mapping
      WHERE tenant_id = $1
        AND job_id = $2::uuid
        AND required_item_id IS NOT NULL
        AND status = 'active'::microsoft_client_intake_mapping_status
      ORDER BY updated_at DESC
    `,
    [tenantId, jobId]
  );
  return rows.map(parseMappingRow);
}

async function queueClientConfirmation(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId?: string | null;
    mapping: Microsoft365ClientIntakeMappingRecord;
    submission: Microsoft365ClientIntakeSubmissionRecord;
  }
) {
  const baseline = loadBaseline(resolveEnvironment());
  const flow = baseline.notification_flows.client_confirmation;
  if (flow.provider !== "mail_automation" || !flow.template_key || !flow.trigger_type) {
    return null;
  }

  const context = await resolveRelatedContext(client, input.tenantId, input.mapping.related_record_type, input.mapping.related_record_id);
  const recipientEmail = input.mapping.recipient_email_override ?? context.recipientEmail;
  if (!recipientEmail) {
    throw new Error("Client confirmation could not be queued because no recipient email was available.");
  }

  const recipientName = input.mapping.recipient_name_override ?? context.recipientName ?? context.organizationName ?? "Client";
  const result = await queueMicrosoft365MailAutomationDeliveryForSystem(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    related_record_type: input.mapping.related_record_type,
    related_record_id: input.mapping.related_record_id,
    template_key: flow.template_key,
    trigger_type: flow.trigger_type as "confirmation",
    contact_id: context.primaryContactId,
    recipient_name: recipientName,
    recipient_email: recipientEmail,
    source_change_key: `client-intake-confirmation:${input.submission.id}`,
    secure_link: input.mapping.request_link_url,
    extra_merge_context: {
      client_name: context.organizationName ?? recipientName,
      project_name: context.jobTitle ?? input.mapping.related_record_label ?? context.jobNumber ?? context.canonicalDashboardId,
      project_number: context.jobNumber ?? "",
      due_date: context.dueAt ?? "",
      owner_name: context.ownerName ?? "",
      owner_email: "",
      required_item_label: input.mapping.related_record_type === "job_readiness_item" ? (input.mapping.related_record_label ?? "") : "",
      submitted_file_name: input.submission.file_name,
      submission_received_at: input.submission.submitted_at,
      secure_link: input.mapping.request_link_url
    }
  });

  await client.query(
    `
      UPDATE microsoft_client_intake_submission
      SET
        confirmation_delivery_id = $3::uuid,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2::uuid
    `,
    [input.tenantId, input.submission.id, result.delivery.id]
  );

  await recordClientIntakeEvent(client, {
    tenantId: input.tenantId,
    mappingId: input.mapping.id,
    submissionId: input.submission.id,
    actorUserId: input.actorUserId ?? null,
    eventType: "client_confirmation_queued",
    note: "Queued client confirmation email for the received submission.",
    metadata: {
      delivery_id: result.delivery.id,
      trigger_type: flow.trigger_type,
      template_key: flow.template_key
    }
  });

  return result;
}

async function notifyReviewers(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId?: string | null;
    mapping: Microsoft365ClientIntakeMappingRecord;
    submission: Microsoft365ClientIntakeSubmissionRecord;
  }
) {
  const baseline = loadBaseline(resolveEnvironment());
  const flow = baseline.notification_flows.reviewer_notification;
  const context = await resolveRelatedContext(client, input.tenantId, input.mapping.related_record_type, input.mapping.related_record_id);
  const reviewerUserIds = input.mapping.reviewer_user_ids.length
    ? input.mapping.reviewer_user_ids
    : context.ownerUserId
      ? [context.ownerUserId]
      : [];

  if (!reviewerUserIds.length) {
    throw new Error("Reviewer notification could not be queued because no reviewer users were configured.");
  }

  const result = await emitOperationalEvent(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    eventType: (flow.event_type ?? "client_intake.review_required") as "client_intake.review_required",
    sourceModule: "microsoft365_client_intake",
    sourceObjectType: "microsoft_client_intake_submission",
    sourceObjectId: input.submission.id,
    sourceObjectLabel: input.submission.file_name,
    title: `Client upload needs review: ${input.submission.file_name}`,
    summary: `${context.organizationName ?? "Client"} submitted ${input.submission.file_name} for ${context.relatedRecordLabel ?? context.jobTitle ?? "the mapped record"}.`,
    deepLink: context.dashboardUrl,
    recipientUserIds: reviewerUserIds,
    deliveryChannels: ["in_app"],
    dedupeKey: `client-intake-review:${input.submission.id}`,
    metadata: {
      mapping_id: input.mapping.id,
      submission_id: input.submission.id,
      request_link_url: input.mapping.request_link_url,
      file_url: input.submission.file_url,
      review_target: context.canonicalDashboardId
    },
    actionRequired: true
  });

  await recordClientIntakeEvent(client, {
    tenantId: input.tenantId,
    mappingId: input.mapping.id,
    submissionId: input.submission.id,
    actorUserId: input.actorUserId ?? null,
    eventType: "reviewer_notified",
    note: "Queued reviewer notification for the matched submission.",
    metadata: {
      recipient_user_ids: reviewerUserIds,
      queued_count: result.queued_count,
      throttled_count: result.throttled_count
    }
  });

  await client.query(
    `
      UPDATE microsoft_client_intake_submission
      SET
        reviewer_user_ids = $3::uuid[],
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2::uuid
    `,
    [input.tenantId, input.submission.id, reviewerUserIds]
  );

  return result;
}

async function completeRequiredItemFromSubmissionReview(
  client: PoolClient,
  input: {
    auth: AuthUser;
    mapping: Microsoft365ClientIntakeMappingRecord;
    submission: Microsoft365ClientIntakeSubmissionRecord;
    note?: string | null;
  }
) {
  if (!input.mapping.required_item_id || !input.mapping.job_id) {
    return null;
  }

  return updateReadinessItem(client, input.auth, input.mapping.job_id, input.mapping.required_item_id, {
    is_complete: true,
    note: input.note ?? `Completed from client intake submission ${input.submission.file_name}.`
  });
}

async function buildReminderState(
  client: PoolClient,
  tenantId: string,
  mapping: Microsoft365ClientIntakeMappingRecord
): Promise<ReminderState> {
  if (mapping.status !== "active") {
    return { suppress: true, suppressReason: "mapping_inactive", overdue: false, recipientEmail: null, recipientName: null };
  }
  if (!mapping.reminder_enabled) {
    return { suppress: true, suppressReason: "reminders_disabled", overdue: false, recipientEmail: null, recipientName: null };
  }

  const context = await resolveRelatedContext(client, tenantId, mapping.related_record_type, mapping.related_record_id);
  if (context.isComplete) {
    return {
      suppress: true,
      suppressReason: "required_item_complete",
      overdue: false,
      recipientEmail: mapping.recipient_email_override ?? context.recipientEmail,
      recipientName: mapping.recipient_name_override ?? context.recipientName
    };
  }

  if (isExceptionStateSuppressed(mapping.last_submission_exception_state)) {
    return {
      suppress: true,
      suppressReason: `exception_${mapping.last_submission_exception_state}`,
      overdue: false,
      recipientEmail: mapping.recipient_email_override ?? context.recipientEmail,
      recipientName: mapping.recipient_name_override ?? context.recipientName
    };
  }

  if (isReminderSuppressedByStatus(mapping.last_submission_status)) {
    return {
      suppress: true,
      suppressReason: "submission_received_or_approved",
      overdue: false,
      recipientEmail: mapping.recipient_email_override ?? context.recipientEmail,
      recipientName: mapping.recipient_name_override ?? context.recipientName
    };
  }

  const recipientEmail = mapping.recipient_email_override ?? context.recipientEmail;
  const recipientName = mapping.recipient_name_override ?? context.recipientName;
  if (!recipientEmail) {
    return { suppress: true, suppressReason: "recipient_missing", overdue: false, recipientEmail: null, recipientName };
  }

  const dueAt = context.dueAt ? Date.parse(context.dueAt) : Number.NaN;
  const overdue = Number.isFinite(dueAt) ? dueAt <= Date.now() : false;
  return {
    suppress: false,
    suppressReason: null,
    overdue,
    recipientEmail,
    recipientName
  };
}

async function loadEventsForSubmissions(client: PoolClient, tenantId: string, submissionIds: string[]) {
  if (!submissionIds.length) {
    return new Map<string, Microsoft365ClientIntakeEventRecord[]>();
  }
  const { rows } = await client.query<EventRow>(
    `
      SELECT
        id::text,
        tenant_id::text,
        mapping_id::text,
        submission_id::text,
        event_type::text,
        actor_user_id::text,
        note,
        metadata,
        occurred_at::text,
        created_at::text
      FROM microsoft_client_intake_event
      WHERE tenant_id = $1
        AND submission_id = ANY($2::uuid[])
      ORDER BY occurred_at DESC, created_at DESC
    `,
    [tenantId, submissionIds]
  );

  const eventsBySubmission = new Map<string, Microsoft365ClientIntakeEventRecord[]>();
  for (const row of rows) {
    const parsed = parseEventRow(row);
    const current = eventsBySubmission.get(parsed.submission_id ?? "") ?? [];
    current.push(parsed);
    eventsBySubmission.set(parsed.submission_id ?? "", current);
  }
  return eventsBySubmission;
}

export function getMicrosoft365ClientIntakeValidationIssues(): Microsoft365ClientIntakeValidationIssue[] {
  const issues: Microsoft365ClientIntakeValidationIssue[] = [];
  let baseline: Microsoft365ClientIntakeBaseline | null = null;
  const environment = resolveEnvironment();

  try {
    baseline = loadBaseline(environment);
  } catch (error) {
    addIssue(issues, {
      area: "baseline",
      severity: "error",
      code: "baseline.unreadable",
      summary: "The Phase 5 client intake baseline could not be loaded.",
      details: {
        environment,
        message: error instanceof Error ? error.message : "Unknown baseline failure."
      }
    });
    return issues;
  }

  for (const issue of getMicrosoft365GovernanceValidationIssues()) {
    if (issue.severity === "error") {
      addIssue(issues, {
        area: "prerequisite",
        severity: "error",
        code: `governance.${issue.code}`,
        summary: `Phase 1 governance prerequisite is not ready: ${issue.summary}`
      });
    }
  }

  for (const issue of getMicrosoft365OperatingSystemValidationIssues()) {
    if (issue.severity === "error") {
      addIssue(issues, {
        area: "prerequisite",
        severity: "error",
        code: `operating_system.${issue.code}`,
        summary: `Phase 2 operating-system prerequisite is not ready: ${issue.summary}`
      });
    }
  }

  for (const issue of getMicrosoft365ProvisioningValidationIssues()) {
    if (issue.severity === "error") {
      addIssue(issues, {
        area: "prerequisite",
        severity: "error",
        code: `provisioning.${issue.code}`,
        summary: `Phase 3 provisioning prerequisite is not ready: ${issue.summary}`
      });
    }
  }

  for (const issue of getMicrosoft365MailAutomationValidationIssues()) {
    if (issue.severity === "error") {
      addIssue(issues, {
        area: "prerequisite",
        severity: "error",
        code: `mail_automation.${issue.code}`,
        summary: `Phase 4 mail automation prerequisite is not ready: ${issue.summary}`
      });
    }
  }

  if (!config.MICROSOFT_365_SHAREPOINT_ROOT_URL) {
    addIssue(issues, {
      area: "config",
      severity: "error",
      code: "config.sharepoint_root_url.missing",
      summary: "Secure client intake requires MICROSOFT_365_SHAREPOINT_ROOT_URL."
    });
  }

  if (!config.API_PUBLIC_URL) {
    addIssue(issues, {
      area: "config",
      severity: "error",
      code: "config.api_public_url.missing",
      summary: "Secure client intake needs API_PUBLIC_URL for callback routing and traceable dashboard backlinks."
    });
  }

  if (config.MICROSOFT_365_CLIENT_INTAKE_ENABLED && !config.MICROSOFT_365_MAIL_AUTOMATION_ENABLED) {
    addIssue(issues, {
      area: "config",
      severity: "error",
      code: "config.mail_automation_disabled",
      summary: "Secure client intake is enabled but Phase 4 mail automation is disabled, so confirmations and reminders cannot run."
    });
  }

  if (config.NODE_ENV === "production" && config.MICROSOFT_365_CLIENT_INTAKE_ENABLED && !config.MICROSOFT_365_CLIENT_INTAKE_CALLBACK_SECRET) {
    addIssue(issues, {
      area: "config",
      severity: "error",
      code: "config.callback_secret.missing",
      summary: "Secure client intake is enabled in production but MICROSOFT_365_CLIENT_INTAKE_CALLBACK_SECRET is missing."
    });
  }

  if (!baseline.matching_rules.length) {
    addIssue(issues, {
      area: "baseline",
      severity: "error",
      code: "baseline.matching_rules.empty",
      summary: "The client intake baseline must define at least one matching rule."
    });
  }

  if (!baseline.mapping_defaults.sharepoint_site_url.startsWith(config.MICROSOFT_365_SHAREPOINT_ROOT_URL || "https://")) {
    addIssue(issues, {
      area: "baseline",
      severity: "warning",
      code: "baseline.sharepoint_site_url.outside_root",
      summary: "The default client intake SharePoint site is outside the configured SharePoint root.",
      details: {
        sharepoint_site_url: baseline.mapping_defaults.sharepoint_site_url,
        expected_root: config.MICROSOFT_365_SHAREPOINT_ROOT_URL
      }
    });
  }

  if (baseline.notification_flows.client_confirmation.provider === "mail_automation") {
    if (!baseline.notification_flows.client_confirmation.template_key) {
      addIssue(issues, {
        area: "notification_flows",
        severity: "error",
        code: "notification_flows.client_confirmation.template_missing",
        summary: "Client confirmation flow must define a template_key."
      });
    }
    if (!baseline.notification_flows.client_confirmation.trigger_type) {
      addIssue(issues, {
        area: "notification_flows",
        severity: "error",
        code: "notification_flows.client_confirmation.trigger_missing",
        summary: "Client confirmation flow must define a trigger_type."
      });
    }
  }

  if (baseline.notification_flows.reviewer_notification.provider === "operational_event" && !baseline.notification_flows.reviewer_notification.event_type) {
    addIssue(issues, {
      area: "notification_flows",
      severity: "error",
      code: "notification_flows.reviewer_notification.event_missing",
      summary: "Reviewer notification flow must define an operational event type."
    });
  }

  if (baseline.notification_flows.reminder_email.provider === "mail_automation") {
    if (!baseline.notification_flows.reminder_email.template_key) {
      addIssue(issues, {
        area: "notification_flows",
        severity: "error",
        code: "notification_flows.reminder_email.template_missing",
        summary: "Reminder flow must define a template_key."
      });
    }
    if (!baseline.notification_flows.reminder_email.trigger_type) {
      addIssue(issues, {
        area: "notification_flows",
        severity: "error",
        code: "notification_flows.reminder_email.trigger_missing",
        summary: "Reminder flow must define a trigger_type."
      });
    }
  }

  return issues;
}

export function assertMicrosoft365ClientIntakeStartupConfig() {
  const issues = getMicrosoft365ClientIntakeValidationIssues();
  const errors = issues.filter((issue) => issue.severity === "error");
  if ((config.MICROSOFT_365_CLIENT_INTAKE_STRICT_VALIDATION || config.NODE_ENV === "production") && errors.length > 0) {
    throw new Error(
      `Microsoft 365 client intake startup validation failed: ${errors.map((issue) => `${issue.area}:${issue.code}`).join(", ")}`
    );
  }
}

export function getPublicMicrosoft365ClientIntakeHealthSummary() {
  const issues = getMicrosoft365ClientIntakeValidationIssues();
  let baseline: Microsoft365ClientIntakeBaseline | null = null;

  try {
    baseline = loadBaseline(resolveEnvironment());
  } catch {
    baseline = null;
  }

  return {
    baseline_environment: resolveEnvironment(),
    enabled: Boolean(config.MICROSOFT_365_CLIENT_INTAKE_ENABLED),
    startup_valid: issues.every((issue) => issue.severity !== "error"),
    issue_count: issues.length,
    matching_rule_count: baseline?.matching_rules.length ?? 0,
    reminder_cadence_hours: baseline?.mapping_defaults.default_reminder_cadence_hours ?? null,
    recommendation: determineRecommendation(issues)
  };
}

export async function getMicrosoft365ClientIntakeDiagnostics(
  client: PoolClient,
  auth: AuthUser
): Promise<
  Microsoft365ClientIntakeDiagnosticsResponse & {
    active_mapping_count: number;
    unmatched_submission_count: number;
    recent_submissions: Array<Microsoft365ClientIntakeSubmissionRecord & { events: Microsoft365ClientIntakeEventRecord[] }>;
  }
> {
  assertClientIntakeAccess(auth);
  const baselineEnvironment = resolveEnvironment();
  const baseline = loadBaseline(baselineEnvironment);
  const issues = getMicrosoft365ClientIntakeValidationIssues();
  const schemaReady = await hasClientIntakeSchema(client);
  const diagnosticsIssues = schemaReady
    ? issues
    : [
        ...issues,
        {
          area: "schema",
          severity: "error",
          code: "schema.phase5_missing",
          summary: "Phase 5 client intake tables are not available in this environment."
        } satisfies Microsoft365ClientIntakeValidationIssue
      ];

  let activeMappingCount = 0;
  let unmatchedSubmissionCount = 0;
  let recentSubmissions: Array<Microsoft365ClientIntakeSubmissionRecord & { events: Microsoft365ClientIntakeEventRecord[] }> = [];
  if (schemaReady) {
    const mappingCountResult = await client.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM microsoft_client_intake_mapping
        WHERE tenant_id = $1
          AND status = 'active'::microsoft_client_intake_mapping_status
      `,
      [auth.tenantId]
    );
    const unmatchedCountResult = await client.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM microsoft_client_intake_submission
        WHERE tenant_id = $1
          AND matching_status = 'received_unmatched'::microsoft_client_intake_submission_status
      `,
      [auth.tenantId]
    );
    const submissionRows = await client.query<SubmissionRow>(
      `
          SELECT
            id::text,
            tenant_id::text,
            mapping_id::text,
            related_record_type::text,
            related_record_id,
            canonical_dashboard_id,
            job_id::text,
            required_item_id::text,
            organization_id::text,
            primary_contact_id::text,
            request_link_external_id,
            request_link_url,
            sharepoint_site_url,
            sharepoint_library_name,
            sharepoint_folder_path,
            sharepoint_folder_url,
            provider_submission_key,
            microsoft_drive_id,
            microsoft_drive_item_id,
            resource_library_item_id::text,
            file_name,
            file_url,
            content_type,
            file_size_bytes,
            uploader_name,
            uploader_email,
            submitted_at::text,
            matching_status::text,
            match_rule,
            match_confidence,
            reviewer_user_ids,
            assigned_reviewer_user_id::text,
            exception_state::text,
            exception_note,
            exception_set_by_user_id::text,
            exception_set_at::text,
            review_note,
            reviewed_by_user_id::text,
            reviewed_at::text,
            review_due_at::text,
            first_escalation_at::text,
            second_escalation_at::text,
            escalated_at::text,
            escalation_level,
            revision_requested_by_user_id::text,
            revision_requested_at::text,
            revision_request_delivery_id::text,
            confirmation_delivery_id::text,
            metadata,
            last_error,
            created_at::text,
            updated_at::text
          FROM microsoft_client_intake_submission
          WHERE tenant_id = $1
          ORDER BY submitted_at DESC, created_at DESC
          LIMIT 25
      `,
      [auth.tenantId]
    );

    activeMappingCount = Number(mappingCountResult.rows[0]?.count ?? "0");
    unmatchedSubmissionCount = Number(unmatchedCountResult.rows[0]?.count ?? "0");
    const parsed = submissionRows.rows.map(parseSubmissionRow);
    const eventsBySubmission = await loadEventsForSubmissions(
      client,
      auth.tenantId,
      parsed.map((submission) => submission.id)
    );
    recentSubmissions = parsed.map((submission) => ({
      ...submission,
      events: eventsBySubmission.get(submission.id) ?? []
    }));
  }

  return {
    generated_at: new Date().toISOString(),
    baseline_environment: baselineEnvironment,
    startup_validation: {
      valid: diagnosticsIssues.every((issue) => issue.severity !== "error"),
      issues: diagnosticsIssues
    },
    phase_audit_summary: {
      implementation_status: "implemented_as_dashboard_first_secure_intake_mvp",
      current_state:
        "The dashboard already had required-item truth, resource-linking, and mail automation, but it did not yet have a durable Request Files mapping contract, matched versus unmatched receipt handling, or a reminder-suppression model tied directly to required-item workflow state.",
      recommendation: determineRecommendation(diagnosticsIssues)
    },
    current_state_findings: buildCurrentStateFindings(),
    refactor_first: buildRefactorFirst(),
    upload_architecture: baseline.upload_architecture,
    mapping_defaults: baseline.mapping_defaults,
    matching_rules: baseline.matching_rules,
    notification_flows: baseline.notification_flows,
    exception_handling: baseline.exception_handling,
    execution_order: baseline.execution_order,
    configuration_artifacts: ARTIFACTS,
    governance_docs: DOCS,
    manual_admin_checklist: baseline.manual_admin_checklist,
    validation_checklist: baseline.validation_checklist,
    rollback_principles: baseline.rollback_principles,
    active_mapping_count: activeMappingCount,
    unmatched_submission_count: unmatchedSubmissionCount,
    recent_submissions: recentSubmissions
  };
}

export async function listMicrosoft365ClientIntakeMappings(
  client: PoolClient,
  auth: AuthUser,
  filters: {
    relatedRecordType?: Microsoft365ClientIntakeRecordType | null;
    relatedRecordId?: string | null;
    status?: Microsoft365ClientIntakeMappingStatus | null;
    allowDisabledFeature?: boolean;
  } = {}
) {
  assertClientIntakeAccess(auth);
  if (!filters.allowDisabledFeature) {
    ensureClientIntakeEnabled();
  }
  await assertClientIntakeSchemaReady(client);

  const values: unknown[] = [auth.tenantId];
  const where = ["tenant_id = $1"];
  if (filters.relatedRecordType) {
    values.push(filters.relatedRecordType);
    where.push(`related_record_type = $${values.length}::microsoft_client_intake_record_type`);
  }
  if (filters.relatedRecordId) {
    values.push(filters.relatedRecordId);
    where.push(`related_record_id = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    where.push(`status = $${values.length}::microsoft_client_intake_mapping_status`);
  }

  const { rows } = await client.query<MappingRow>(
    `
      SELECT
        id::text,
        tenant_id::text,
        related_record_type::text,
        related_record_id,
        canonical_dashboard_id,
        job_id::text,
        required_item_id::text,
        organization_id::text,
        primary_contact_id::text,
        department_scope,
        related_record_label,
        request_mode,
        request_link_url,
        request_link_external_id,
        sharepoint_site_url,
        sharepoint_library_name,
        sharepoint_folder_path,
        sharepoint_folder_url,
        forms_schema_key,
        recipient_name_override,
        recipient_email_override,
        reviewer_user_ids,
        manager_user_ids,
        department_lead_user_ids,
        reminder_enabled,
        reminder_cadence_hours,
        review_due_hours,
        first_escalation_hours,
        second_escalation_hours,
        digest_enabled,
        last_submission_at::text,
        last_submission_status::text,
        last_submission_exception_state::text,
        last_reminder_sent_at::text,
        last_reminder_trigger_type,
        status::text,
        metadata,
        created_by_user_id::text,
        updated_by_user_id::text,
        created_at::text,
        updated_at::text
      FROM microsoft_client_intake_mapping
      WHERE ${where.join(" AND ")}
      ORDER BY updated_at DESC, created_at DESC
    `,
    values
  );

  return {
    baseline_environment: resolveEnvironment(),
    mappings: rows.map(parseMappingRow)
  };
}

export async function upsertMicrosoft365ClientIntakeMapping(
  client: PoolClient,
  auth: AuthUser,
  input: UpsertMicrosoft365ClientIntakeMappingInput
) {
  assertClientIntakeManageAccess(auth);
  ensureClientIntakeEnabled();
  await assertClientIntakeSchemaReady(client);

  const baseline = loadBaseline(resolveEnvironment());
  const context = await resolveRelatedContext(client, auth.tenantId, input.related_record_type, input.related_record_id);
  const reviewerUserIds = normalizeStringArray(input.reviewer_user_ids).length
    ? normalizeStringArray(input.reviewer_user_ids)
    : context.ownerUserId
      ? [context.ownerUserId]
      : [];
  const managerUserIds = normalizeStringArray(input.manager_user_ids);
  const departmentLeadUserIds = normalizeStringArray(input.department_lead_user_ids);
  const metadata = normalizeJsonObject(input.metadata);
  const reminderCadenceHours = Math.max(1, input.reminder_cadence_hours ?? baseline.mapping_defaults.default_reminder_cadence_hours);
  const reviewDueHours = Math.max(1, input.review_due_hours ?? 24);
  const firstEscalationHours = Math.max(1, input.first_escalation_hours ?? 12);
  const secondEscalationHours = Math.max(firstEscalationHours, input.second_escalation_hours ?? 24);
  const digestEnabled = input.digest_enabled ?? true;
  const status = mappingStatusSchema.parse(input.status ?? "active");

  const { rows } = await client.query<MappingRow>(
    `
      INSERT INTO microsoft_client_intake_mapping (
        tenant_id,
        related_record_type,
        related_record_id,
        canonical_dashboard_id,
        job_id,
        required_item_id,
        organization_id,
        primary_contact_id,
        department_scope,
        related_record_label,
        request_mode,
        request_link_url,
        request_link_external_id,
        sharepoint_site_url,
        sharepoint_library_name,
        sharepoint_folder_path,
        sharepoint_folder_url,
        forms_schema_key,
        recipient_name_override,
        recipient_email_override,
        reviewer_user_ids,
        manager_user_ids,
        department_lead_user_ids,
        reminder_enabled,
        reminder_cadence_hours,
        review_due_hours,
        first_escalation_hours,
        second_escalation_hours,
        digest_enabled,
        status,
        metadata,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES (
        $1,
        $2::microsoft_client_intake_record_type,
        $3,
        $4,
        $5::uuid,
        $6::uuid,
        $7::uuid,
        $8::uuid,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17,
        $18,
        $19,
        $20,
        $21::uuid[],
        $22::uuid[],
        $23::uuid[],
        $24,
        $25,
        $26,
        $27,
        $28,
        $29::microsoft_client_intake_mapping_status,
        $30::jsonb,
        $31::uuid,
        $31::uuid
      )
      ON CONFLICT (tenant_id, related_record_type, related_record_id)
      DO UPDATE SET
        canonical_dashboard_id = EXCLUDED.canonical_dashboard_id,
        job_id = EXCLUDED.job_id,
        required_item_id = EXCLUDED.required_item_id,
        organization_id = EXCLUDED.organization_id,
        primary_contact_id = EXCLUDED.primary_contact_id,
        department_scope = EXCLUDED.department_scope,
        related_record_label = EXCLUDED.related_record_label,
        request_mode = EXCLUDED.request_mode,
        request_link_url = EXCLUDED.request_link_url,
        request_link_external_id = EXCLUDED.request_link_external_id,
        sharepoint_site_url = EXCLUDED.sharepoint_site_url,
        sharepoint_library_name = EXCLUDED.sharepoint_library_name,
        sharepoint_folder_path = EXCLUDED.sharepoint_folder_path,
        sharepoint_folder_url = EXCLUDED.sharepoint_folder_url,
        forms_schema_key = EXCLUDED.forms_schema_key,
        recipient_name_override = EXCLUDED.recipient_name_override,
        recipient_email_override = EXCLUDED.recipient_email_override,
        reviewer_user_ids = EXCLUDED.reviewer_user_ids,
        manager_user_ids = EXCLUDED.manager_user_ids,
        department_lead_user_ids = EXCLUDED.department_lead_user_ids,
        reminder_enabled = EXCLUDED.reminder_enabled,
        reminder_cadence_hours = EXCLUDED.reminder_cadence_hours,
        review_due_hours = EXCLUDED.review_due_hours,
        first_escalation_hours = EXCLUDED.first_escalation_hours,
        second_escalation_hours = EXCLUDED.second_escalation_hours,
        digest_enabled = EXCLUDED.digest_enabled,
        status = EXCLUDED.status,
        metadata = COALESCE(microsoft_client_intake_mapping.metadata, '{}'::jsonb) || EXCLUDED.metadata,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
      RETURNING
        id::text,
        tenant_id::text,
        related_record_type::text,
        related_record_id,
        canonical_dashboard_id,
        job_id::text,
        required_item_id::text,
        organization_id::text,
        primary_contact_id::text,
        department_scope,
        related_record_label,
        request_mode,
        request_link_url,
        request_link_external_id,
        sharepoint_site_url,
        sharepoint_library_name,
        sharepoint_folder_path,
        sharepoint_folder_url,
        forms_schema_key,
        recipient_name_override,
        recipient_email_override,
        reviewer_user_ids,
        manager_user_ids,
        department_lead_user_ids,
        reminder_enabled,
        reminder_cadence_hours,
        review_due_hours,
        first_escalation_hours,
        second_escalation_hours,
        digest_enabled,
        last_submission_at::text,
        last_submission_status::text,
        last_submission_exception_state::text,
        last_reminder_sent_at::text,
        last_reminder_trigger_type,
        status::text,
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
      context.primaryContactId,
      context.departmentScope,
      context.relatedRecordLabel,
      baseline.mapping_defaults.default_request_mode,
      input.request_link_url,
      normalizeText(input.request_link_external_id),
      input.sharepoint_site_url,
      input.sharepoint_library_name,
      input.sharepoint_folder_path,
      normalizeText(input.sharepoint_folder_url),
      normalizeText(input.forms_schema_key),
      normalizeText(input.recipient_name_override),
      normalizeText(input.recipient_email_override),
      reviewerUserIds,
      managerUserIds,
      departmentLeadUserIds,
      input.reminder_enabled ?? true,
      reminderCadenceHours,
      reviewDueHours,
      firstEscalationHours,
      secondEscalationHours,
      digestEnabled,
      status,
      JSON.stringify(metadata),
      auth.id
    ]
  );

  const mapping = parseMappingRow(rows[0]);

  await recordClientIntakeEvent(client, {
    tenantId: auth.tenantId,
    mappingId: mapping.id,
    actorUserId: auth.id,
    eventType: "mapping_upserted",
    note: "Secure client intake mapping created or updated.",
    metadata: {
      related_record_type: mapping.related_record_type,
      related_record_id: mapping.related_record_id,
      request_link_external_id: mapping.request_link_external_id,
      sharepoint_folder_path: mapping.sharepoint_folder_path
    }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "integration.microsoft365_client_intake.mapping_upserted",
    entityType: "microsoft_client_intake_mapping",
    entityId: mapping.id,
    metadata: {
      related_record_type: mapping.related_record_type,
      related_record_id: mapping.related_record_id,
      request_link_url: mapping.request_link_url
    }
  });

  await recordMicrosoftIntegrationEvent(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    integrationArea: "client_intake",
    eventLevel: "info",
    eventType: "client_intake.mapping.upserted",
    eventStatus: "configured",
    summary: `Configured secure client intake mapping for ${mapping.related_record_type}.`,
    detail: {
      mapping_id: mapping.id,
      related_record_type: mapping.related_record_type,
      related_record_id: mapping.related_record_id
    },
    relatedEntityType: "microsoft_client_intake_mapping",
    relatedEntityId: mapping.id,
    externalTarget: mapping.request_link_url
  });

  return {
    mapping,
    dashboard_url: context.dashboardUrl
  };
}

export async function listMicrosoft365ClientIntakeSubmissions(
  client: PoolClient,
  auth: AuthUser,
  filters: {
    status?: Microsoft365ClientIntakeSubmissionStatus | null;
    relatedRecordType?: Microsoft365ClientIntakeRecordType | null;
    relatedRecordId?: string | null;
    unmatchedOnly?: boolean;
    limit?: number;
    allowDisabledFeature?: boolean;
  } = {}
) {
  assertClientIntakeAccess(auth);
  if (!filters.allowDisabledFeature) {
    ensureClientIntakeEnabled();
  }
  await assertClientIntakeSchemaReady(client);

  const values: unknown[] = [auth.tenantId];
  const where = ["tenant_id = $1"];
  if (filters.status) {
    values.push(filters.status);
    where.push(`matching_status = $${values.length}::microsoft_client_intake_submission_status`);
  }
  if (filters.relatedRecordType) {
    values.push(filters.relatedRecordType);
    where.push(`related_record_type = $${values.length}::microsoft_client_intake_record_type`);
  }
  if (filters.relatedRecordId) {
    values.push(filters.relatedRecordId);
    where.push(`related_record_id = $${values.length}`);
  }
  if (filters.unmatchedOnly) {
    where.push(`matching_status = 'received_unmatched'::microsoft_client_intake_submission_status`);
  }
  values.push(Math.min(Math.max(filters.limit ?? 100, 1), 200));

  const { rows } = await client.query<SubmissionRow>(
    `
      SELECT
        id::text,
        tenant_id::text,
        mapping_id::text,
        related_record_type::text,
        related_record_id,
        canonical_dashboard_id,
        job_id::text,
        required_item_id::text,
        organization_id::text,
        primary_contact_id::text,
        request_link_external_id,
        request_link_url,
        sharepoint_site_url,
        sharepoint_library_name,
        sharepoint_folder_path,
        sharepoint_folder_url,
        provider_submission_key,
        microsoft_drive_id,
        microsoft_drive_item_id,
        resource_library_item_id::text,
        file_name,
        file_url,
        content_type,
        file_size_bytes,
        uploader_name,
        uploader_email,
        submitted_at::text,
        matching_status::text,
        match_rule,
        match_confidence,
        reviewer_user_ids,
        assigned_reviewer_user_id::text,
        exception_state::text,
        exception_note,
        exception_set_by_user_id::text,
        exception_set_at::text,
        review_note,
        reviewed_by_user_id::text,
        reviewed_at::text,
        review_due_at::text,
        first_escalation_at::text,
        second_escalation_at::text,
        escalated_at::text,
        escalation_level,
        revision_requested_by_user_id::text,
        revision_requested_at::text,
        revision_request_delivery_id::text,
        confirmation_delivery_id::text,
        metadata,
        last_error,
        created_at::text,
        updated_at::text
      FROM microsoft_client_intake_submission
      WHERE ${where.join(" AND ")}
      ORDER BY submitted_at DESC, created_at DESC
      LIMIT $${values.length}
    `,
    values
  );

  const submissions = rows.map(parseSubmissionRow);
  const eventsBySubmission = await loadEventsForSubmissions(
    client,
    auth.tenantId,
    submissions.map((submission) => submission.id)
  );

  return {
    submissions: submissions.map((submission) => ({
      ...submission,
      events: eventsBySubmission.get(submission.id) ?? []
    })),
    unmatched_open_count: submissions.filter((submission) => submission.matching_status === "received_unmatched").length
  };
}

export async function recordMicrosoft365ClientIntakeSubmission(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId?: string | null;
    submission: RecordMicrosoft365ClientIntakeSubmissionInput;
  }
) {
  ensureClientIntakeEnabled();
  await assertClientIntakeSchemaReady(client);

  const normalizedSubmission = input.submission;
  const providerSubmissionKey = createProviderSubmissionKey(normalizedSubmission);
  const existing = await loadExistingSubmissionByKey(client, input.tenantId, providerSubmissionKey);
  if (existing) {
    return {
      deduped: true,
      submission: existing
    };
  }

  const match = await findMappingForSubmission(client, input.tenantId, normalizedSubmission);
  const mapping = match.mapping ? parseMappingRow(match.mapping as MappingRow) : null;
  const relatedContext = mapping
    ? await resolveRelatedContext(client, input.tenantId, mapping.related_record_type, mapping.related_record_id)
    : null;
  const submissionStatus: Microsoft365ClientIntakeSubmissionStatus = mapping ? "received_matched" : "received_unmatched";
  const reviewerUserIds = mapping?.reviewer_user_ids.length
    ? mapping.reviewer_user_ids
    : relatedContext?.ownerUserId
      ? [relatedContext.ownerUserId]
      : [];
  const assignedReviewerUserId = pickAssignedReviewer(reviewerUserIds, relatedContext?.ownerUserId ?? null);
  const submittedAt = normalizeText(normalizedSubmission.submitted_at) ?? new Date().toISOString();
  const reviewDueAt = addHours(submittedAt, mapping?.review_due_hours ?? 24);

  const { rows } = await client.query<SubmissionRow>(
    `
      INSERT INTO microsoft_client_intake_submission (
        tenant_id,
        mapping_id,
        related_record_type,
        related_record_id,
        canonical_dashboard_id,
        job_id,
        required_item_id,
        organization_id,
        primary_contact_id,
        request_link_external_id,
        request_link_url,
        sharepoint_site_url,
        sharepoint_library_name,
        sharepoint_folder_path,
        sharepoint_folder_url,
        provider_submission_key,
        microsoft_drive_id,
        microsoft_drive_item_id,
        file_name,
        file_url,
        content_type,
        file_size_bytes,
        uploader_name,
        uploader_email,
        submitted_at,
        matching_status,
        match_rule,
        match_confidence,
        reviewer_user_ids,
        assigned_reviewer_user_id,
        exception_state,
        review_due_at,
        metadata
      )
      VALUES (
        $1,
        $2::uuid,
        $3::microsoft_client_intake_record_type,
        $4,
        $5,
        $6::uuid,
        $7::uuid,
        $8::uuid,
        $9::uuid,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17,
        $18,
        $19,
        $20,
        $21,
        $22,
        $23,
        $24,
        $25::timestamptz,
        $26::microsoft_client_intake_submission_status,
        $27,
        $28,
        $29::uuid[],
        $30::uuid,
        $31::microsoft_client_intake_exception_state,
        $32::timestamptz,
        $33::jsonb
      )
      RETURNING
        id::text,
        tenant_id::text,
        mapping_id::text,
        related_record_type::text,
        related_record_id,
        canonical_dashboard_id,
        job_id::text,
        required_item_id::text,
        organization_id::text,
        primary_contact_id::text,
        request_link_external_id,
        request_link_url,
        sharepoint_site_url,
        sharepoint_library_name,
        sharepoint_folder_path,
        sharepoint_folder_url,
        provider_submission_key,
        microsoft_drive_id,
        microsoft_drive_item_id,
        resource_library_item_id::text,
        file_name,
        file_url,
        content_type,
        file_size_bytes,
        uploader_name,
        uploader_email,
        submitted_at::text,
        matching_status::text,
        match_rule,
        match_confidence,
        reviewer_user_ids,
        assigned_reviewer_user_id::text,
        exception_state::text,
        exception_note,
        exception_set_by_user_id::text,
        exception_set_at::text,
        review_note,
        reviewed_by_user_id::text,
        reviewed_at::text,
        review_due_at::text,
        first_escalation_at::text,
        second_escalation_at::text,
        escalated_at::text,
        escalation_level,
        revision_requested_by_user_id::text,
        revision_requested_at::text,
        revision_request_delivery_id::text,
        confirmation_delivery_id::text,
        metadata,
        last_error,
        created_at::text,
        updated_at::text
    `,
    [
      input.tenantId,
      mapping?.id ?? null,
      mapping?.related_record_type ?? null,
      mapping?.related_record_id ?? null,
      mapping?.canonical_dashboard_id ?? null,
      mapping?.job_id ?? null,
      mapping?.required_item_id ?? null,
      mapping?.organization_id ?? null,
      mapping?.primary_contact_id ?? null,
      normalizeText(normalizedSubmission.request_link_external_id),
      normalizeText(normalizedSubmission.request_link_url),
      normalizeText(normalizedSubmission.sharepoint_site_url),
      normalizeText(normalizedSubmission.sharepoint_library_name),
      normalizeText(normalizedSubmission.sharepoint_folder_path),
      normalizeText(normalizedSubmission.sharepoint_folder_url),
      providerSubmissionKey,
      normalizeText(normalizedSubmission.microsoft_drive_id),
      normalizeText(normalizedSubmission.microsoft_drive_item_id),
      normalizedSubmission.file_name.trim(),
      normalizeText(normalizedSubmission.file_url),
      normalizeText(normalizedSubmission.content_type),
      normalizedSubmission.file_size_bytes ?? null,
      normalizeText(normalizedSubmission.uploader_name),
      normalizeText(normalizedSubmission.uploader_email),
      submittedAt,
      submissionStatus,
      match.matchRule,
      match.matchConfidence,
      reviewerUserIds,
      assignedReviewerUserId,
      "none",
      reviewDueAt,
      JSON.stringify(normalizeJsonObject(normalizedSubmission.metadata))
    ]
  );

  const submission = parseSubmissionRow(rows[0]);

  await recordClientIntakeEvent(client, {
    tenantId: input.tenantId,
    mappingId: mapping?.id ?? null,
    submissionId: submission.id,
    actorUserId: input.actorUserId ?? null,
    eventType: "submission_received",
    note: "Received a secure client upload submission.",
    metadata: {
      provider_submission_key: providerSubmissionKey,
      file_name: submission.file_name
    }
  });

  await recordClientIntakeEvent(client, {
    tenantId: input.tenantId,
    mappingId: mapping?.id ?? null,
    submissionId: submission.id,
    actorUserId: input.actorUserId ?? null,
    eventType: mapping ? "submission_matched" : "submission_unmatched",
    note: mapping
      ? `Matched submission to ${mapping.related_record_type} using ${match.matchRule ?? "mapping"}.`
      : "Submission did not match a configured intake mapping and requires human review.",
    metadata: {
      match_rule: match.matchRule,
      match_confidence: match.matchConfidence
    }
  });

  if (assignedReviewerUserId) {
    await recordClientIntakeEvent(client, {
      tenantId: input.tenantId,
      mappingId: mapping?.id ?? null,
      submissionId: submission.id,
      actorUserId: input.actorUserId ?? null,
      eventType: "reviewer_assigned",
      note: "Assigned the submission to a primary reviewer.",
      metadata: {
        assigned_reviewer_user_id: assignedReviewerUserId,
        reviewer_user_ids: reviewerUserIds,
        review_due_at: reviewDueAt
      }
    });
  }

  await createAuditLog(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    action: "integration.microsoft365_client_intake.submission_received",
    entityType: "microsoft_client_intake_submission",
    entityId: submission.id,
    metadata: {
      mapping_id: mapping?.id ?? null,
      provider_submission_key: providerSubmissionKey,
      file_name: submission.file_name,
      matching_status: submission.matching_status
    }
  });

  await recordMicrosoftIntegrationEvent(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    integrationArea: "client_intake",
    eventLevel: mapping ? "info" : "warning",
    eventType: mapping ? "client_intake.submission.matched" : "client_intake.submission.unmatched",
    eventStatus: submission.matching_status,
    summary: mapping
      ? `Matched secure intake submission ${submission.file_name}.`
      : `Secure intake submission ${submission.file_name} needs human review.`,
    detail: {
      submission_id: submission.id,
      mapping_id: mapping?.id ?? null,
      match_rule: match.matchRule,
      match_confidence: match.matchConfidence
    },
    relatedEntityType: "microsoft_client_intake_submission",
    relatedEntityId: submission.id,
    externalTarget: submission.file_url
  });

  if (!mapping) {
    return {
      deduped: false,
      submission,
      mapping: null
    };
  }

  await updateMappingSnapshotFromSubmission(client, {
    tenantId: input.tenantId,
    mappingId: mapping.id,
    submittedAt: submission.submitted_at,
    status: submission.matching_status,
    exceptionState: submission.exception_state
  });

  await upsertClientIntakeResourceLink(client, {
    tenantId: input.tenantId,
    mapping,
    submission,
    approvalStatus: "pending_review",
    actorUserId: input.actorUserId ?? null
  });

  try {
    await queueClientConfirmation(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      mapping,
      submission
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown confirmation queue failure.";
    await updateSubmissionLastError(client, input.tenantId, submission.id, message);
    await recordClientIntakeEvent(client, {
      tenantId: input.tenantId,
      mappingId: mapping.id,
      submissionId: submission.id,
      actorUserId: input.actorUserId ?? null,
      eventType: "client_confirmation_failed",
      note: message
    });
    await recordMicrosoftIntegrationEvent(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      integrationArea: "client_intake",
      eventLevel: "error",
      eventType: "client_intake.client_confirmation.failed",
      eventStatus: "failed",
      summary: "Client confirmation could not be queued for a matched secure upload.",
      detail: {
        submission_id: submission.id,
        mapping_id: mapping.id,
        message
      },
      relatedEntityType: "microsoft_client_intake_submission",
      relatedEntityId: submission.id
    });
  }

  try {
    await notifyReviewers(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      mapping,
      submission
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown reviewer notification failure.";
    await updateSubmissionLastError(client, input.tenantId, submission.id, message);
    await recordClientIntakeEvent(client, {
      tenantId: input.tenantId,
      mappingId: mapping.id,
      submissionId: submission.id,
      actorUserId: input.actorUserId ?? null,
      eventType: "reviewer_notification_failed",
      note: message
    });
    await recordMicrosoftIntegrationEvent(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      integrationArea: "client_intake",
      eventLevel: "error",
      eventType: "client_intake.reviewer_notification.failed",
      eventStatus: "failed",
      summary: "Reviewer notification failed for a matched secure upload.",
      detail: {
        submission_id: submission.id,
        mapping_id: mapping.id,
        message
      },
      relatedEntityType: "microsoft_client_intake_submission",
      relatedEntityId: submission.id
    });
  }

  const refreshed = await loadSubmissionById(client, input.tenantId, submission.id);
  return {
    deduped: false,
    submission: refreshed ?? submission,
    mapping
  };
}

export async function reviewMicrosoft365ClientIntakeSubmission(
  client: PoolClient,
  auth: AuthUser,
  submissionId: string,
  input: ReviewMicrosoft365ClientIntakeSubmissionInput
) {
  assertClientIntakeManageAccess(auth);
  ensureClientIntakeEnabled();
  await assertClientIntakeSchemaReady(client);

  const submission = await loadSubmissionById(client, auth.tenantId, submissionId);
  if (!submission) {
    throw new ApiError(404, "Client intake submission not found.");
  }

  let mapping: Microsoft365ClientIntakeMappingRecord | null = null;
  if (input.mapping_id) {
    const byId = await loadMappingById(client, auth.tenantId, input.mapping_id);
    if (!byId) {
      throw new ApiError(404, "Client intake mapping not found.");
    }
    mapping = parseMappingRow(byId);
  }
  if (!mapping && input.target_record_type && input.target_record_id) {
    const byRecord = await loadMappingByRecord(client, auth.tenantId, input.target_record_type, input.target_record_id);
    mapping = byRecord ? parseMappingRow(byRecord) : null;
  }
  if (!mapping && input.create_mapping_from_submission && input.target_record_type && input.target_record_id) {
    const defaults = loadBaseline(resolveEnvironment()).mapping_defaults;
    const created = await upsertMicrosoft365ClientIntakeMapping(client, auth, {
      related_record_type: input.target_record_type,
      related_record_id: input.target_record_id,
      request_link_url: submission.request_link_url ?? submission.sharepoint_folder_url ?? "https://example.invalid/request-files",
      request_link_external_id: submission.request_link_external_id ?? null,
      sharepoint_site_url: submission.sharepoint_site_url ?? defaults.sharepoint_site_url,
      sharepoint_library_name: submission.sharepoint_library_name ?? defaults.library_name,
      sharepoint_folder_path: submission.sharepoint_folder_path ?? defaults.folder_path_pattern,
      sharepoint_folder_url: submission.sharepoint_folder_url ?? null,
      recipient_name_override: submission.uploader_name ?? null,
      recipient_email_override: submission.uploader_email ?? null,
      metadata: {
        created_from_submission_id: submission.id
      }
    });
    mapping = created.mapping;
  }

  if ((input.decision === "match" || input.decision === "approve" || input.decision === "request_revision") && !mapping) {
    throw new ApiError(400, "A target mapping is required to match, approve, or request revision on a submission.");
  }

  let nextStatus: Microsoft365ClientIntakeSubmissionStatus;
  if (input.decision === "match") {
    nextStatus = "under_review";
  } else if (input.decision === "request_revision") {
    nextStatus = "revision_requested";
  } else if (input.decision === "approve") {
    nextStatus = "approved";
  } else {
    nextStatus = "rejected";
  }

  const note = normalizeText(input.note);
  const context =
    mapping ? await resolveRelatedContext(client, auth.tenantId, mapping.related_record_type, mapping.related_record_id) : null;
  const reviewerUserIds = mapping?.reviewer_user_ids.length
    ? mapping.reviewer_user_ids
    : context?.ownerUserId
      ? [context.ownerUserId]
      : [];
  const assignedReviewerUserId = pickAssignedReviewer(reviewerUserIds, context?.ownerUserId ?? null);
  const nextExceptionState: Microsoft365ClientIntakeExceptionState =
    input.decision === "request_revision" ? "waiting_on_client" : "none";
  const reviewDueAt =
    input.decision === "match"
      ? addHours(submission.submitted_at, mapping?.review_due_hours ?? 24)
      : input.decision === "request_revision"
        ? null
        : submission.review_due_at;

  await client.query(
    `
      UPDATE microsoft_client_intake_submission
      SET
        mapping_id = $3::uuid,
        related_record_type = $4::microsoft_client_intake_record_type,
        related_record_id = $5,
        canonical_dashboard_id = $6,
        job_id = $7::uuid,
        required_item_id = $8::uuid,
        organization_id = $9::uuid,
        primary_contact_id = $10::uuid,
        matching_status = $11::microsoft_client_intake_submission_status,
        reviewer_user_ids = $12::uuid[],
        assigned_reviewer_user_id = $13::uuid,
        exception_state = $14::microsoft_client_intake_exception_state,
        exception_note = CASE
          WHEN $14::microsoft_client_intake_exception_state = 'none'::microsoft_client_intake_exception_state THEN NULL
          ELSE $15
        END,
        exception_set_by_user_id = CASE
          WHEN $14::microsoft_client_intake_exception_state = 'none'::microsoft_client_intake_exception_state THEN NULL
          ELSE $16::uuid
        END,
        exception_set_at = CASE
          WHEN $14::microsoft_client_intake_exception_state = 'none'::microsoft_client_intake_exception_state THEN NULL
          ELSE now()
        END,
        review_note = $15,
        reviewed_by_user_id = $16::uuid,
        reviewed_at = now(),
        review_due_at = $17::timestamptz,
        revision_requested_by_user_id = CASE WHEN $18 THEN $16::uuid ELSE revision_requested_by_user_id END,
        revision_requested_at = CASE WHEN $18 THEN now() ELSE revision_requested_at END,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2::uuid
    `,
    [
      auth.tenantId,
      submission.id,
      mapping?.id ?? null,
      mapping?.related_record_type ?? null,
      mapping?.related_record_id ?? null,
      mapping?.canonical_dashboard_id ?? null,
      mapping?.job_id ?? null,
      mapping?.required_item_id ?? null,
      mapping?.organization_id ?? null,
      mapping?.primary_contact_id ?? null,
      nextStatus,
      reviewerUserIds,
      assignedReviewerUserId,
      nextExceptionState,
      note,
      auth.id
      ,
      reviewDueAt,
      input.decision === "request_revision"
    ]
  );

  const refreshed = await loadSubmissionById(client, auth.tenantId, submission.id);
  if (!refreshed) {
    throw new ApiError(404, "Client intake submission not found after review.");
  }

  if (mapping) {
    await updateMappingSnapshotFromSubmission(client, {
      tenantId: auth.tenantId,
      mappingId: mapping.id,
      submittedAt: refreshed.submitted_at,
      status: nextStatus,
      exceptionState: nextExceptionState
    });
    await upsertClientIntakeResourceLink(client, {
      tenantId: auth.tenantId,
      mapping,
      submission: refreshed,
      approvalStatus: nextStatus === "approved" ? "approved" : nextStatus === "rejected" ? "rejected_not_useful" : "pending_review",
      actorUserId: auth.id
    });
  }

  if (input.decision === "approve" && mapping && input.complete_required_item !== false && mapping.required_item_id && mapping.job_id) {
    await completeRequiredItemFromSubmissionReview(client, {
      auth,
      mapping,
      submission: refreshed,
      note
    });
  }

  await recordClientIntakeEvent(client, {
    tenantId: auth.tenantId,
    mappingId: mapping?.id ?? null,
    submissionId: refreshed.id,
    actorUserId: auth.id,
    eventType:
      input.decision === "approve"
        ? "approved"
        : input.decision === "reject"
          ? "rejected"
          : input.decision === "request_revision"
            ? "revision_requested"
            : "submission_matched",
    note:
      input.decision === "approve"
        ? "Submission approved and linked back to the dashboard record."
        : input.decision === "reject"
          ? "Submission rejected during human review."
          : input.decision === "request_revision"
            ? "Reviewer requested a revision and moved the submission to waiting on client."
          : "Submission matched to a dashboard record during review.",
    metadata: {
      review_note: note,
      target_mapping_id: mapping?.id ?? null,
      assigned_reviewer_user_id: assignedReviewerUserId,
      exception_state: nextExceptionState
    }
  });

  if (mapping?.job_id) {
    await writeJobActivity(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      jobId: mapping.job_id,
      eventType:
        input.decision === "approve"
          ? "client_intake_approved"
          : input.decision === "reject"
            ? "client_intake_rejected"
            : input.decision === "request_revision"
              ? "client_intake_revision_requested"
              : "client_intake_matched",
      summary:
        input.decision === "approve"
          ? "Approved client intake submission"
          : input.decision === "reject"
            ? "Rejected client intake submission"
            : input.decision === "request_revision"
              ? "Requested client intake revision"
            : "Matched client intake submission",
      metadata: {
        submission_id: refreshed.id,
        mapping_id: mapping?.id ?? null,
        file_name: refreshed.file_name,
        note
      }
    });
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: `integration.microsoft365_client_intake.${input.decision}`,
    entityType: "microsoft_client_intake_submission",
    entityId: refreshed.id,
    metadata: {
      mapping_id: mapping?.id ?? null,
      next_status: nextStatus,
      exception_state: nextExceptionState,
      complete_required_item: input.complete_required_item ?? null
    }
  });

  return {
    submission: refreshed,
    mapping
  };
}

export async function sweepMicrosoft365ClientIntakeReminders(
  client: PoolClient,
  auth: Pick<AuthUser, "tenantId"> & { id: string | null },
  input: { limit?: number } = {}
): Promise<SweepMicrosoft365ClientIntakeRemindersResult> {
  ensureClientIntakeEnabled();
  await assertClientIntakeSchemaReady(client);
  const baseline = loadBaseline(resolveEnvironment());
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);

  const { rows } = await client.query<MappingRow>(
    `
      SELECT
        id::text,
        tenant_id::text,
        related_record_type::text,
        related_record_id,
        canonical_dashboard_id,
        job_id::text,
        required_item_id::text,
        organization_id::text,
        primary_contact_id::text,
        department_scope,
        related_record_label,
        request_mode,
        request_link_url,
        request_link_external_id,
        sharepoint_site_url,
        sharepoint_library_name,
        sharepoint_folder_path,
        sharepoint_folder_url,
        forms_schema_key,
        recipient_name_override,
        recipient_email_override,
        reviewer_user_ids,
        manager_user_ids,
        department_lead_user_ids,
        reminder_enabled,
        reminder_cadence_hours,
        review_due_hours,
        first_escalation_hours,
        second_escalation_hours,
        digest_enabled,
        last_submission_at::text,
        last_submission_status::text,
        last_submission_exception_state::text,
        last_reminder_sent_at::text,
        last_reminder_trigger_type,
        status::text,
        metadata,
        created_by_user_id::text,
        updated_by_user_id::text,
        created_at::text,
        updated_at::text
      FROM microsoft_client_intake_mapping
      WHERE tenant_id = $1
        AND status = 'active'::microsoft_client_intake_mapping_status
      ORDER BY updated_at DESC
      LIMIT $2
    `,
    [auth.tenantId, limit]
  );

  let reminderQueuedCount = 0;
  let overdueQueuedCount = 0;
  let suppressedCount = 0;
  let unmatchedOpenCount = 0;
  let failedCount = 0;

  for (const row of rows) {
    const mapping = parseMappingRow(row);
    const reminderState = await buildReminderState(client, auth.tenantId, mapping);
    if (mapping.last_submission_status === "received_unmatched") {
      unmatchedOpenCount += 1;
    }
    if (reminderState.suppress) {
      suppressedCount += 1;
      continue;
    }

    if (mapping.last_reminder_sent_at) {
      const lastSentAt = Date.parse(mapping.last_reminder_sent_at);
      const cadenceMs = mapping.reminder_cadence_hours * 60 * 60 * 1000;
      if (Number.isFinite(lastSentAt) && Date.now() - lastSentAt < cadenceMs) {
        suppressedCount += 1;
        continue;
      }
    }

    const flow = baseline.notification_flows.reminder_email;
    if (flow.provider !== "mail_automation" || !flow.template_key || !flow.trigger_type) {
      throw new Error("Reminder flow is not configured for mail automation.");
    }

    const context = await resolveRelatedContext(client, auth.tenantId, mapping.related_record_type, mapping.related_record_id);
    const triggerType = reminderState.overdue
      ? (flow.overdue_trigger_type ?? "overdue")
      : flow.trigger_type;
    const templateKey = reminderState.overdue
      ? (flow.overdue_template_key ?? "required_items_overdue")
      : flow.template_key;

    try {
      await queueMicrosoft365MailAutomationDeliveryForSystem(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id ?? null,
        related_record_type: mapping.related_record_type,
        related_record_id: mapping.related_record_id,
        template_key: templateKey,
        trigger_type: triggerType as "reminder" | "overdue",
        contact_id: context.primaryContactId,
        recipient_name: reminderState.recipientName ?? context.organizationName ?? "Client",
        recipient_email: reminderState.recipientEmail,
        source_change_key: `client-intake-reminder:${mapping.id}:${triggerType}:${mapping.last_submission_at ?? "none"}`,
        secure_link: mapping.request_link_url,
        extra_merge_context: {
          client_name: context.organizationName ?? reminderState.recipientName ?? "Client",
          project_name: context.jobTitle ?? mapping.related_record_label ?? context.jobNumber ?? context.canonicalDashboardId,
          project_number: context.jobNumber ?? "",
          missing_items_summary:
            mapping.related_record_type === "job_readiness_item"
              ? (mapping.related_record_label ?? "Requested upload")
              : "Please upload the requested items for this project.",
          due_date: context.dueAt ?? "",
          owner_name: context.ownerName ?? "",
          owner_email: "",
          required_item_label: mapping.related_record_type === "job_readiness_item" ? (mapping.related_record_label ?? "") : "",
          secure_link: mapping.request_link_url
        }
      });

      await client.query(
        `
          UPDATE microsoft_client_intake_mapping
          SET
            last_reminder_sent_at = now(),
            last_reminder_trigger_type = $3,
            updated_at = now()
          WHERE tenant_id = $1
            AND id = $2::uuid
        `,
        [auth.tenantId, mapping.id, triggerType]
      );

      await recordClientIntakeEvent(client, {
        tenantId: auth.tenantId,
        mappingId: mapping.id,
        actorUserId: auth.id ?? null,
        eventType: "reminder_queued",
        note: reminderState.overdue ? "Queued overdue missing-item reminder." : "Queued missing-item reminder.",
        metadata: {
          template_key: templateKey,
          trigger_type: triggerType
        }
      });

      if (reminderState.overdue) {
        overdueQueuedCount += 1;
      } else {
        reminderQueuedCount += 1;
      }
    } catch (error) {
      failedCount += 1;
      const message = error instanceof Error ? error.message : "Unknown reminder queue failure.";
      await recordClientIntakeEvent(client, {
        tenantId: auth.tenantId,
        mappingId: mapping.id,
        actorUserId: auth.id ?? null,
        eventType: "reminder_failed",
        note: message,
        metadata: {
          overdue: reminderState.overdue
        }
      });
      await recordMicrosoftIntegrationEvent(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id ?? null,
        integrationArea: "client_intake",
        eventLevel: "error",
        eventType: "client_intake.reminder.failed",
        eventStatus: "failed",
        summary: "A client intake reminder could not be queued.",
        detail: {
          mapping_id: mapping.id,
          trigger_type: reminderState.overdue ? "overdue" : "reminder",
          message
        },
        relatedEntityType: "microsoft_client_intake_mapping",
        relatedEntityId: mapping.id,
        externalTarget: mapping.request_link_url
      });
    }
  }

  return {
    scanned_mapping_count: rows.length,
    reminder_queued_count: reminderQueuedCount,
    overdue_queued_count: overdueQueuedCount,
    suppressed_count: suppressedCount,
    unmatched_open_count: unmatchedOpenCount,
    failed_count: failedCount
  };
}
