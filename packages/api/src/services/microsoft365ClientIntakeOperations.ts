import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { z } from "zod";
import { hasAuthorityTier } from "../authz/authority.js";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  Microsoft365ClientIntakeCurrentStateFinding,
  Microsoft365ClientIntakeEnvironment,
  Microsoft365ClientIntakeExceptionState,
  Microsoft365ClientIntakeGoNoGo,
  Microsoft365ClientIntakeMappingRecord,
  Microsoft365ClientIntakeOperationalControlDiagnosticsResponse,
  Microsoft365ClientIntakeOperationalQueueItem,
  Microsoft365ClientIntakeOperationsWorkspace,
  Microsoft365ClientIntakeRefactorItem,
  Microsoft365ClientIntakeSubmissionRecord,
  Microsoft365ClientIntakeValidationIssue,
  SweepMicrosoft365ClientIntakeOperationalControlResult,
  UpdateMicrosoft365ClientIntakeSubmissionControlInput
} from "../types/microsoft365ClientIntake.js";
import { resolveApiRepoPath } from "../utils/repoPaths.js";
import { createAuditLog } from "./audit.js";
import {
  getMicrosoft365ClientIntakeValidationIssues,
  listMicrosoft365ClientIntakeMappings,
  listMicrosoft365ClientIntakeSubmissions
} from "./microsoft365ClientIntake.js";
import { recordMicrosoftIntegrationEvent } from "./microsoftIntegrationObservability.js";
import { emitOperationalEvent } from "./operationalEvents.js";
import { queueOperationalAlert } from "./operationalAlerting.js";

const environmentSchema = z.enum(["development", "staging", "production"]);
const exceptionStateSchema = z.enum(["none", "waiting_on_client", "paused", "manually_overridden"]);
const statusSchema = z.enum([
  "received_matched",
  "received_unmatched",
  "under_review",
  "revision_requested",
  "approved",
  "rejected",
  "archived"
]);

const baselineSchema = z.object({
  phase: z.literal("phase6_approvals_escalations_alerts_operational_control"),
  baseline_version: z.string().trim().min(1),
  environment: environmentSchema,
  tenant_tier: z.enum(["sandbox", "preproduction", "production"]),
  reviewer_assignment: z.object({
    default_reviewer_rule: z.string().trim().min(1),
    manager_escalation_rule: z.string().trim().min(1),
    department_lead_escalation_rule: z.string().trim().min(1),
    default_review_due_hours: z.number().int().positive(),
    default_first_escalation_hours: z.number().int().positive(),
    default_second_escalation_hours: z.number().int().positive()
  }),
  approval_workflow: z.object({
    approve_rule: z.string().trim().min(1),
    reject_rule: z.string().trim().min(1),
    revision_request_rule: z.string().trim().min(1),
    completion_rule: z.string().trim().min(1),
    audit_rule: z.string().trim().min(1)
  }),
  exception_states: z.array(
    z.object({
      key: exceptionStateSchema,
      label: z.string().trim().min(1),
      suppression_rule: z.string().trim().min(1),
      operator_use: z.string().trim().min(1)
    })
  ),
  alerting_and_digests: z.object({
    teams_alerts_channel_rule: z.string().trim().min(1),
    immediate_alert_types: z.array(z.string().trim().min(1)).min(1),
    daily_digest: z.object({
      enabled: z.boolean(),
      timezone: z.string().trim().min(1),
      local_hour: z.number().int().min(0).max(23),
      window_minutes: z.number().int().min(1).max(120),
      rule: z.string().trim().min(1)
    }),
    failure_visibility_rule: z.string().trim().min(1)
  }),
  backlog_views: z.object({
    review_queue_rule: z.string().trim().min(1),
    overdue_rule: z.string().trim().min(1),
    exception_queue_rule: z.string().trim().min(1),
    escalation_queue_rule: z.string().trim().min(1)
  }),
  execution_order: z.array(
    z.object({
      order: z.number().int().positive(),
      title: z.string().trim().min(1),
      owner: z.string().trim().min(1),
      requires_tenant_admin: z.boolean(),
      rollback: z.string().trim().min(1)
    })
  ),
  manual_admin_checklist: z.array(
    z.object({
      order: z.number().int().positive(),
      step: z.string().trim().min(1),
      portal: z.string().trim().min(1).nullable(),
      requires_tenant_admin: z.boolean(),
      owner: z.string().trim().min(1)
    })
  ),
  validation_checklist: z.array(z.string().trim().min(1)).min(1),
  rollback_principles: z.array(z.string().trim().min(1)).min(1)
});

type Phase6Baseline = z.infer<typeof baselineSchema>;

type SubmissionControlRow = {
  id: string;
  mapping_id: string | null;
  related_record_type: "job" | "job_readiness_item" | null;
  related_record_id: string | null;
  job_id: string | null;
  file_name: string;
  submitted_at: string;
  matching_status: Microsoft365ClientIntakeSubmissionRecord["matching_status"];
  reviewer_user_ids: string[] | null;
  assigned_reviewer_user_id: string | null;
  assigned_reviewer_name: string | null;
  exception_state: Microsoft365ClientIntakeExceptionState;
  exception_note: string | null;
  review_due_at: string | null;
  first_escalation_at: string | null;
  second_escalation_at: string | null;
  escalated_at: string | null;
  escalation_level: number | string;
  related_record_label: string | null;
  request_link_url: string | null;
  manager_user_ids: string[] | null;
  department_lead_user_ids: string[] | null;
  mapping_reviewer_user_ids: string[] | null;
  review_due_hours: number | null;
  first_escalation_hours: number | null;
  second_escalation_hours: number | null;
  digest_enabled: boolean | null;
  organization_name: string | null;
};

function resolveEnvironment(): Microsoft365ClientIntakeEnvironment {
  if (config.MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENV) {
    return config.MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENV;
  }
  if (config.MICROSOFT_365_CLIENT_INTAKE_ENV) {
    return config.MICROSOFT_365_CLIENT_INTAKE_ENV;
  }
  if (config.NODE_ENV === "production") {
    return "production";
  }
  return "development";
}

function getBaselinePath(environment: Microsoft365ClientIntakeEnvironment) {
  return resolveApiRepoPath("ops", "microsoft365", "phase6", `client-intake-operational-control-baseline.${environment}.json`);
}

function loadBaseline(environment = resolveEnvironment()): Phase6Baseline {
  const raw = readFileSync(getBaselinePath(environment), "utf8");
  const parsed = baselineSchema.parse(JSON.parse(raw));
  if (parsed.environment !== environment) {
    throw new Error(
      `Microsoft 365 client intake operational-control baseline environment mismatch: expected ${environment}, found ${parsed.environment}.`
    );
  }
  return parsed;
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

function addIssue(issues: Microsoft365ClientIntakeValidationIssue[], issue: Microsoft365ClientIntakeValidationIssue) {
  issues.push(issue);
}

function normalizeStringArray(values: string[] | null | undefined) {
  return Array.isArray(values)
    ? values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))
    : [];
}

function buildDashboardUrl(recordType: "job" | "job_readiness_item" | null, recordId: string | null, jobId?: string | null) {
  if (!config.ADMIN_WEB_URL || !recordType || !recordId) {
    return null;
  }
  const base = config.ADMIN_WEB_URL.replace(/\/$/, "");
  return recordType === "job" ? `${base}/#jobs/${recordId}` : jobId ? `${base}/#jobs/${jobId}` : null;
}

function addHours(value: string, hours: number) {
  const baseTime = Date.parse(value);
  if (!Number.isFinite(baseTime)) {
    return null;
  }
  return new Date(baseTime + hours * 60 * 60 * 1000).toISOString();
}

function isFinalStatus(status: Microsoft365ClientIntakeSubmissionRecord["matching_status"]) {
  return status === "approved" || status === "rejected" || status === "archived";
}

function isExceptionSuppressed(state: Microsoft365ClientIntakeExceptionState) {
  return state !== "none";
}

function getLocalTimeParts(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    dateKey: `${values.get("year")}-${values.get("month")}-${values.get("day")}`,
    hour: Number(values.get("hour") ?? "0"),
    minute: Number(values.get("minute") ?? "0")
  };
}

function shouldQueueDigest(baseline: Phase6Baseline) {
  if (!baseline.alerting_and_digests.daily_digest.enabled) {
    return false;
  }
  const local = getLocalTimeParts(baseline.alerting_and_digests.daily_digest.timezone);
  return (
    local.hour === baseline.alerting_and_digests.daily_digest.local_hour &&
    local.minute < baseline.alerting_and_digests.daily_digest.window_minutes
  );
}

async function recordOperationalFailure(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId?: string | null;
    submissionId?: string | null;
    eventType: string;
    summary: string;
    detail?: Record<string, unknown>;
  }
) {
  await recordMicrosoftIntegrationEvent(client, {
    tenantId: input.tenantId,
    integrationArea: "client_intake",
    eventLevel: "error",
    eventType: input.eventType,
    eventStatus: "failed",
    summary: input.summary,
    detail: input.detail,
    actorUserId: input.actorUserId ?? null,
    relatedEntityType: input.submissionId ? "microsoft_client_intake_submission" : null,
    relatedEntityId: input.submissionId ?? null
  });
}

function selectRiskLevel(item: Microsoft365ClientIntakeOperationalQueueItem) {
  if (item.submission.escalation_level >= 2) {
    return "critical" as const;
  }
  if (item.overdue || item.submission.escalation_level >= 1) {
    return "high" as const;
  }
  if (item.submission.exception_state !== "none" || item.submission.matching_status === "received_unmatched") {
    return "medium" as const;
  }
  return "low" as const;
}

function buildWorkspaceItem(
  submission: Microsoft365ClientIntakeSubmissionRecord,
  mapping: Microsoft365ClientIntakeMappingRecord | null
): Microsoft365ClientIntakeOperationalQueueItem {
  const reviewDueAt = submission.review_due_at ? Date.parse(submission.review_due_at) : Number.NaN;
  const overdue = !isExceptionSuppressed(submission.exception_state) && Number.isFinite(reviewDueAt) && reviewDueAt < Date.now();
  const item: Microsoft365ClientIntakeOperationalQueueItem = {
    submission,
    mapping,
    dashboard_url: buildDashboardUrl(submission.related_record_type, submission.related_record_id, submission.job_id),
    related_record_label: mapping?.related_record_label ?? null,
    organization_name: null,
    owner_name: null,
    risk_level: "low",
    overdue
  };
  item.risk_level = selectRiskLevel(item);
  return item;
}

function buildCurrentStateFindings(): Microsoft365ClientIntakeCurrentStateFinding[] {
  return [
    {
      key: "phase5_review_core_exists",
      state: "existing",
      summary:
        "Phase 5 already created durable intake mappings, submission receipts, reviewer notifications, and reminder logging, so Phase 6 can extend the same tables instead of creating a second approval system.",
      evidence: [
        "packages/api/src/services/microsoft365ClientIntake.ts",
        "db/migrations/127_microsoft365_secure_client_intake_phase5.sql"
      ]
    },
    {
      key: "approval_framework_exists_but_is_not_primary_here",
      state: "partial",
      summary:
        "The app already has a broader operational approvals framework, but secure client intake needs a simpler reviewer workflow tied directly to intake submissions, not a second approval request record for each upload.",
      evidence: [
        "packages/api/src/services/operationalApprovals.ts",
        "packages/api/src/services/microsoft365ClientIntake.ts"
      ],
      recommended_refactor: "Keep client-intake decisions on the submission record and escalate through alerts plus visibility first."
    },
    {
      key: "teams_alert_engine_exists",
      state: "existing",
      summary:
        "The Teams Automation Alerts path already exists through operational alert routes, so Phase 6 should reuse that channel for overdue and digest visibility instead of inventing a second alert transport.",
      evidence: [
        "packages/api/src/services/operationalAlerting.ts",
        "packages/worker/src/handlers/appEventHandler.ts"
      ]
    }
  ];
}

function buildRefactorFirst(): Microsoft365ClientIntakeRefactorItem[] {
  return [
    {
      key: "keep_review_state_durable",
      severity: "high",
      summary: "Reviewer assignment, exception state, and escalation level must stay on the submission record instead of living only in event metadata.",
      consequence: "If control state lives only in alerts or event history, operators cannot reliably suppress, recover, or report on intake risk."
    },
    {
      key: "reuse_existing_alert_and_event_engines",
      severity: "high",
      summary: "Escalations and digests should reuse operational events and Teams alert routes instead of feature-local webhooks.",
      consequence: "Bypassing shared alerting would create invisible failures and fragmented support tooling."
    },
    {
      key: "suppress_by_exception_state",
      severity: "high",
      summary: "Waiting on client, paused, and manual-override states must suppress reminder and escalation automation deterministically.",
      consequence: "Without explicit suppression, the system will spam clients and leadership during known exception handling."
    }
  ];
}

function assertReadAccess(auth: Pick<AuthUser, "authorityTier">) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    throw new ApiError(403, "Integration governance access is required.");
  }
}

function assertManageAccess(auth: Pick<AuthUser, "authorityTier">) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Integration governance management access is required.");
  }
}

async function hasPhase6Schema(client: PoolClient) {
  const { rows } = await client.query<{
    has_exception_state: boolean;
    has_mapping_columns: boolean;
    has_submission_columns: boolean;
  }>(
    `
      SELECT
        (to_regtype('microsoft_client_intake_exception_state') IS NOT NULL) AS has_exception_state,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'microsoft_client_intake_mapping'
            AND column_name = 'manager_user_ids'
        ) AS has_mapping_columns,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'microsoft_client_intake_submission'
            AND column_name = 'exception_state'
        ) AS has_submission_columns
    `
  );

  const row = rows[0];
  return Boolean(row?.has_exception_state && row?.has_mapping_columns && row?.has_submission_columns);
}

async function recordEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    mappingId?: string | null;
    submissionId?: string | null;
    actorUserId?: string | null;
    eventType:
      | "reviewer_assigned"
      | "exception_state_changed"
      | "escalation_queued"
      | "escalation_failed"
      | "digest_queued"
      | "digest_failed"
      | "manual_override_applied";
    note?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
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
      VALUES ($1,$2::uuid,$3::uuid,$4::microsoft_client_intake_event_type,$5::uuid,$6,$7::jsonb)
    `,
    [
      input.tenantId,
      input.mappingId ?? null,
      input.submissionId ?? null,
      input.eventType,
      input.actorUserId ?? null,
      input.note ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
}

async function updateMappingExceptionSnapshot(
  client: PoolClient,
  tenantId: string,
  mappingId: string | null,
  exceptionState: Microsoft365ClientIntakeExceptionState
) {
  if (!mappingId) {
    return;
  }
  await client.query(
    `
      UPDATE microsoft_client_intake_mapping
      SET
        last_submission_exception_state = $3::microsoft_client_intake_exception_state,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2::uuid
    `,
    [tenantId, mappingId, exceptionState]
  );
}

async function loadSubmissionControlRow(client: PoolClient, tenantId: string, submissionId: string) {
  const { rows } = await client.query<SubmissionControlRow>(
    `
      SELECT
        s.id::text,
        s.mapping_id::text,
        s.related_record_type::text,
        s.related_record_id,
        s.job_id::text,
        s.file_name,
        s.submitted_at::text,
        s.matching_status::text,
        s.reviewer_user_ids,
        s.assigned_reviewer_user_id::text,
        reviewer.full_name AS assigned_reviewer_name,
        s.exception_state::text,
        s.exception_note,
        s.review_due_at::text,
        s.first_escalation_at::text,
        s.second_escalation_at::text,
        s.escalated_at::text,
        s.escalation_level::text,
        m.related_record_label,
        m.request_link_url,
        m.manager_user_ids,
        m.department_lead_user_ids,
        m.reviewer_user_ids AS mapping_reviewer_user_ids,
        m.review_due_hours,
        m.first_escalation_hours,
        m.second_escalation_hours,
        m.digest_enabled,
        org.display_name AS organization_name
      FROM microsoft_client_intake_submission s
      LEFT JOIN microsoft_client_intake_mapping m
        ON m.tenant_id = s.tenant_id
       AND m.id = s.mapping_id
      LEFT JOIN app_user reviewer
        ON reviewer.id = s.assigned_reviewer_user_id
      LEFT JOIN organization org
        ON org.id = COALESCE(s.organization_id, m.organization_id)
      WHERE s.tenant_id = $1
        AND s.id = $2::uuid
      LIMIT 1
    `,
    [tenantId, submissionId]
  );

  const row = rows[0] ?? null;
  if (!row) {
    return null;
  }
  return {
    ...row,
    reviewer_user_ids: normalizeStringArray(row.reviewer_user_ids),
    manager_user_ids: normalizeStringArray(row.manager_user_ids),
    department_lead_user_ids: normalizeStringArray(row.department_lead_user_ids),
    mapping_reviewer_user_ids: normalizeStringArray(row.mapping_reviewer_user_ids),
    escalation_level: Number(row.escalation_level ?? 0)
  };
}

async function listOpenControlRows(client: PoolClient, tenantId: string, limit: number) {
  const { rows } = await client.query<SubmissionControlRow>(
    `
      SELECT
        s.id::text,
        s.mapping_id::text,
        s.related_record_type::text,
        s.related_record_id,
        s.job_id::text,
        s.file_name,
        s.submitted_at::text,
        s.matching_status::text,
        s.reviewer_user_ids,
        s.assigned_reviewer_user_id::text,
        reviewer.full_name AS assigned_reviewer_name,
        s.exception_state::text,
        s.exception_note,
        s.review_due_at::text,
        s.first_escalation_at::text,
        s.second_escalation_at::text,
        s.escalated_at::text,
        s.escalation_level::text,
        m.related_record_label,
        m.request_link_url,
        m.manager_user_ids,
        m.department_lead_user_ids,
        m.reviewer_user_ids AS mapping_reviewer_user_ids,
        m.review_due_hours,
        m.first_escalation_hours,
        m.second_escalation_hours,
        m.digest_enabled,
        org.display_name AS organization_name
      FROM microsoft_client_intake_submission s
      LEFT JOIN microsoft_client_intake_mapping m
        ON m.tenant_id = s.tenant_id
       AND m.id = s.mapping_id
      LEFT JOIN app_user reviewer
        ON reviewer.id = s.assigned_reviewer_user_id
      LEFT JOIN organization org
        ON org.id = COALESCE(s.organization_id, m.organization_id)
      WHERE s.tenant_id = $1
        AND s.matching_status <> 'approved'::microsoft_client_intake_submission_status
        AND s.matching_status <> 'rejected'::microsoft_client_intake_submission_status
        AND s.matching_status <> 'archived'::microsoft_client_intake_submission_status
      ORDER BY s.submitted_at DESC, s.created_at DESC
      LIMIT $2
    `,
    [tenantId, limit]
  );

  return rows.map((row) => ({
    ...row,
    reviewer_user_ids: normalizeStringArray(row.reviewer_user_ids),
    manager_user_ids: normalizeStringArray(row.manager_user_ids),
    department_lead_user_ids: normalizeStringArray(row.department_lead_user_ids),
    mapping_reviewer_user_ids: normalizeStringArray(row.mapping_reviewer_user_ids),
    escalation_level: Number(row.escalation_level ?? 0)
  }));
}

function buildSummary(items: Microsoft365ClientIntakeOperationalQueueItem[]): Microsoft365ClientIntakeOperationsWorkspace["summary"] {
  const open = items.filter((item) => !isFinalStatus(item.submission.matching_status));
  return {
    open_backlog_count: open.length,
    review_queue_count: open.filter((item) => item.submission.exception_state === "none").length,
    overdue_count: open.filter((item) => item.overdue).length,
    escalated_count: open.filter((item) => item.submission.escalation_level > 0).length,
    waiting_on_client_count: open.filter((item) => item.submission.exception_state === "waiting_on_client").length,
    paused_count: open.filter((item) => item.submission.exception_state === "paused").length,
    unmatched_count: open.filter((item) => item.submission.matching_status === "received_unmatched").length,
    manual_override_count: open.filter((item) => item.submission.exception_state === "manually_overridden").length
  };
}

async function buildWorkspace(
  client: PoolClient,
  auth: AuthUser,
  options: { allowDisabledFeature?: boolean } = {}
): Promise<Microsoft365ClientIntakeOperationsWorkspace> {
  const mappingPayload = await listMicrosoft365ClientIntakeMappings(client, auth, {
    allowDisabledFeature: options.allowDisabledFeature
  });
  const submissionPayload = await listMicrosoft365ClientIntakeSubmissions(client, auth, {
    limit: 250,
    allowDisabledFeature: options.allowDisabledFeature
  });
  const mappingMap = new Map<string, Microsoft365ClientIntakeMappingRecord>(
    mappingPayload.mappings.map((mapping) => [mapping.id, mapping])
  );

  const items = submissionPayload.submissions
    .filter((entry) => !isFinalStatus(entry.matching_status))
    .map((entry) => buildWorkspaceItem(entry, entry.mapping_id ? (mappingMap.get(entry.mapping_id) ?? null) : null))
    .sort((left, right) => Date.parse(right.submission.submitted_at) - Date.parse(left.submission.submitted_at));

  return {
    generated_at: new Date().toISOString(),
    summary: buildSummary(items),
    review_queue: items.filter((item) => item.submission.exception_state === "none").slice(0, 50),
    overdue_items: items.filter((item) => item.overdue).slice(0, 50),
    escalated_items: items.filter((item) => item.submission.escalation_level > 0).slice(0, 50),
    backlog: items.slice(0, 100),
    exception_items: items.filter((item) => item.submission.exception_state !== "none").slice(0, 50)
  };
}

export function getMicrosoft365ClientIntakeOperationalControlValidationIssues(): Microsoft365ClientIntakeValidationIssue[] {
  const issues = [...getMicrosoft365ClientIntakeValidationIssues()];
  const environment = resolveEnvironment();
  let baseline: Phase6Baseline | null = null;

  try {
    baseline = loadBaseline(environment);
  } catch (error) {
    addIssue(issues, {
      area: "baseline",
      severity: "error",
      code: "phase6.baseline.unreadable",
      summary: "The Phase 6 operational-control baseline could not be loaded.",
      details: {
        environment,
        message: error instanceof Error ? error.message : "Unknown baseline failure."
      }
    });
    return issues;
  }

  if (!config.MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED) {
    addIssue(issues, {
      area: "feature_flag",
      severity: environment === "production" ? "error" : "warning",
      code: "phase6.feature_disabled",
      summary: "Phase 6 operational control is disabled for this environment."
    });
  }

  if (!config.TEAMS_OPERATIONAL_ALERTS_ENABLED) {
    addIssue(issues, {
      area: "teams_alerts",
      severity: environment === "production" ? "error" : "warning",
      code: "phase6.teams_alerts_disabled",
      summary: "Teams operational alerts are disabled, so escalations and daily risk summaries cannot reach the Automation Alerts channel."
    });
  }

  if (!baseline.alerting_and_digests.daily_digest.timezone) {
    addIssue(issues, {
      area: "digest",
      severity: "error",
      code: "phase6.digest_timezone_missing",
      summary: "Daily digest scheduling requires a timezone."
    });
  }

  return issues;
}

export function assertMicrosoft365ClientIntakeOperationalControlStartupConfig() {
  const issues = getMicrosoft365ClientIntakeOperationalControlValidationIssues().filter((issue) => issue.severity === "error");
  if ((config.MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_STRICT_VALIDATION || config.NODE_ENV === "production") && issues.length > 0) {
    throw new Error(
      `Microsoft 365 client intake operational control startup validation failed: ${issues
        .map((issue) => `${issue.area}:${issue.code}`)
        .join(", ")}`
    );
  }
}

export function getPublicMicrosoft365ClientIntakeOperationalControlHealthSummary() {
  const issues = getMicrosoft365ClientIntakeOperationalControlValidationIssues();
  let baseline: Phase6Baseline | null = null;
  try {
    baseline = loadBaseline(resolveEnvironment());
  } catch {
    baseline = null;
  }
  return {
    baseline_environment: resolveEnvironment(),
    enabled: Boolean(config.MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED),
    startup_valid: issues.every((issue) => issue.severity !== "error"),
    issue_count: issues.length,
    default_review_due_hours: baseline?.reviewer_assignment.default_review_due_hours ?? null,
    daily_digest_enabled: baseline?.alerting_and_digests.daily_digest.enabled ?? false,
    recommendation: determineRecommendation(issues)
  };
}

export async function getMicrosoft365ClientIntakeOperationsWorkspace(
  client: PoolClient,
  auth: AuthUser
): Promise<Microsoft365ClientIntakeOperationsWorkspace> {
  assertReadAccess(auth);
  return buildWorkspace(client, auth);
}

export async function updateMicrosoft365ClientIntakeSubmissionControl(
  client: PoolClient,
  auth: AuthUser,
  submissionId: string,
  input: UpdateMicrosoft365ClientIntakeSubmissionControlInput
) {
  assertManageAccess(auth);
  if (!config.MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED) {
    throw new ApiError(503, "Microsoft 365 client intake operational control is disabled in this environment.");
  }
  if (!(await hasPhase6Schema(client))) {
    throw new ApiError(503, "Phase 6 client intake operational-control schema is not available in this environment.");
  }

  const submission = await loadSubmissionControlRow(client, auth.tenantId, submissionId);
  if (!submission) {
    throw new ApiError(404, "Client intake submission not found.");
  }
  if (isFinalStatus(statusSchema.parse(submission.matching_status))) {
    throw new ApiError(409, "Completed submissions cannot be edited through the operational control surface.");
  }

  const nextAssignedReviewerUserId =
    input.assigned_reviewer_user_id !== undefined ? input.assigned_reviewer_user_id : submission.assigned_reviewer_user_id;
  const nextExceptionState = exceptionStateSchema.parse(input.exception_state ?? submission.exception_state);
  const nextReviewDueAt = input.review_due_at !== undefined ? input.review_due_at : submission.review_due_at;
  const note = input.note?.trim() || null;

  await client.query(
    `
      UPDATE microsoft_client_intake_submission
      SET
        assigned_reviewer_user_id = $3::uuid,
        exception_state = $4::microsoft_client_intake_exception_state,
        exception_note = CASE
          WHEN $4::microsoft_client_intake_exception_state = 'none'::microsoft_client_intake_exception_state THEN NULL
          ELSE $5
        END,
        exception_set_by_user_id = CASE
          WHEN $4::microsoft_client_intake_exception_state = 'none'::microsoft_client_intake_exception_state THEN NULL
          ELSE $6::uuid
        END,
        exception_set_at = CASE
          WHEN $4::microsoft_client_intake_exception_state = 'none'::microsoft_client_intake_exception_state THEN NULL
          ELSE now()
        END,
        review_due_at = $7::timestamptz,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2::uuid
    `,
    [auth.tenantId, submissionId, nextAssignedReviewerUserId, nextExceptionState, note, auth.id, nextReviewDueAt]
  );

  if (submission.mapping_id) {
    await updateMappingExceptionSnapshot(client, auth.tenantId, submission.mapping_id, nextExceptionState);
  }

  if (nextAssignedReviewerUserId !== submission.assigned_reviewer_user_id) {
    await recordEvent(client, {
      tenantId: auth.tenantId,
      mappingId: submission.mapping_id,
      submissionId,
      actorUserId: auth.id,
      eventType: "reviewer_assigned",
      note: "Updated the primary reviewer assignment from the operational control surface.",
      metadata: {
        assigned_reviewer_user_id: nextAssignedReviewerUserId
      }
    });
  }

  if (nextExceptionState !== submission.exception_state) {
    await recordEvent(client, {
      tenantId: auth.tenantId,
      mappingId: submission.mapping_id,
      submissionId,
      actorUserId: auth.id,
      eventType: nextExceptionState === "manually_overridden" ? "manual_override_applied" : "exception_state_changed",
      note:
        nextExceptionState === "none"
          ? "Cleared the submission exception state."
          : `Set submission exception state to ${nextExceptionState}.`,
      metadata: {
        previous_exception_state: submission.exception_state,
        next_exception_state: nextExceptionState,
        note
      }
    });
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "integration.microsoft365_client_intake.operational_control.updated",
    entityType: "microsoft_client_intake_submission",
    entityId: submissionId,
    metadata: {
      assigned_reviewer_user_id: nextAssignedReviewerUserId,
      exception_state: nextExceptionState,
      review_due_at: nextReviewDueAt
    }
  });

  const refreshed = await loadSubmissionControlRow(client, auth.tenantId, submissionId);
  return {
    submission_id: submissionId,
    assigned_reviewer_user_id: refreshed?.assigned_reviewer_user_id ?? null,
    exception_state: refreshed?.exception_state ?? "none",
    review_due_at: refreshed?.review_due_at ?? null
  };
}

export async function sweepMicrosoft365ClientIntakeOperationalControl(
  client: PoolClient,
  auth: Pick<AuthUser, "tenantId"> & { id: string | null },
  input: { limit?: number } = {}
): Promise<SweepMicrosoft365ClientIntakeOperationalControlResult> {
  if (!config.MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED) {
    return {
      scanned_submission_count: 0,
      review_assignment_count: 0,
      escalated_count: 0,
      digest_queued_count: 0,
      suppressed_count: 0,
      failed_count: 0
    };
  }
  if (!(await hasPhase6Schema(client))) {
    throw new ApiError(503, "Phase 6 client intake operational-control schema is not available in this environment.");
  }

  const baseline = loadBaseline(resolveEnvironment());
  const rows = await listOpenControlRows(client, auth.tenantId, Math.min(Math.max(input.limit ?? 250, 1), 500));
  let reviewAssignmentCount = 0;
  let escalatedCount = 0;
  let digestQueuedCount = 0;
  let suppressedCount = 0;
  let failedCount = 0;

  for (const row of rows) {
    const reviewerCandidates = row.mapping_reviewer_user_ids.length ? row.mapping_reviewer_user_ids : row.reviewer_user_ids;
    const assignedReviewerUserId = row.assigned_reviewer_user_id ?? reviewerCandidates[0] ?? null;
    const reviewDueAt = row.review_due_at ?? addHours(row.submitted_at, row.review_due_hours ?? baseline.reviewer_assignment.default_review_due_hours);

    if (!row.assigned_reviewer_user_id && assignedReviewerUserId) {
      await client.query(
        `
          UPDATE microsoft_client_intake_submission
          SET
            assigned_reviewer_user_id = $3::uuid,
            review_due_at = COALESCE(review_due_at, $4::timestamptz),
            updated_at = now()
          WHERE tenant_id = $1
            AND id = $2::uuid
        `,
        [auth.tenantId, row.id, assignedReviewerUserId, reviewDueAt]
      );
      await recordEvent(client, {
        tenantId: auth.tenantId,
        mappingId: row.mapping_id,
        submissionId: row.id,
        actorUserId: auth.id,
        eventType: "reviewer_assigned",
        note: "Assigned a primary reviewer during the operational control sweep.",
        metadata: {
          assigned_reviewer_user_id: assignedReviewerUserId,
          review_due_at: reviewDueAt
        }
      });
      reviewAssignmentCount += 1;
    }

    if (isExceptionSuppressed(row.exception_state)) {
      suppressedCount += 1;
      continue;
    }

    const dueAtMs = reviewDueAt ? Date.parse(reviewDueAt) : Number.NaN;
    if (!Number.isFinite(dueAtMs) || dueAtMs > Date.now()) {
      continue;
    }

    const hoursPastDue = Math.floor((Date.now() - dueAtMs) / (60 * 60 * 1000));
    const firstEscalationHours = row.first_escalation_hours ?? baseline.reviewer_assignment.default_first_escalation_hours;
    const secondEscalationHours = row.second_escalation_hours ?? baseline.reviewer_assignment.default_second_escalation_hours;
    const nextLevel =
      hoursPastDue >= secondEscalationHours && row.escalation_level < 2
        ? 2
        : hoursPastDue >= firstEscalationHours && row.escalation_level < 1
          ? 1
          : 0;
    if (nextLevel === 0) {
      continue;
    }

    const recipients =
      nextLevel === 1
        ? row.manager_user_ids.length
          ? row.manager_user_ids
          : assignedReviewerUserId
            ? [assignedReviewerUserId]
            : reviewerCandidates
        : row.department_lead_user_ids.length
          ? row.department_lead_user_ids
          : row.manager_user_ids;

    if (!recipients.length) {
      failedCount += 1;
      await recordEvent(client, {
        tenantId: auth.tenantId,
        mappingId: row.mapping_id,
        submissionId: row.id,
        actorUserId: auth.id,
        eventType: "escalation_failed",
        note: "Escalation could not be queued because no recipients were configured.",
        metadata: {
          escalation_level: nextLevel
        }
      });
      await recordOperationalFailure(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        submissionId: row.id,
        eventType: "client_intake_escalation_missing_recipients",
        summary: "Client intake escalation could not be queued because no recipients were configured.",
        detail: {
          escalation_level: nextLevel,
          mapping_id: row.mapping_id
        }
      });
      continue;
    }

    try {
      const dashboardUrl = buildDashboardUrl(row.related_record_type, row.related_record_id, row.job_id);
      const title =
        nextLevel === 1
          ? `Client intake review overdue: ${row.file_name}`
          : `Client intake escalated to leadership: ${row.file_name}`;
      const summary =
        nextLevel === 1
          ? `${row.organization_name ?? "Client"} upload ${row.file_name} is overdue for review.`
          : `${row.organization_name ?? "Client"} upload ${row.file_name} exceeded the department review threshold.`;

      await emitOperationalEvent(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        eventType: "client_intake.escalated",
        sourceModule: "microsoft365_client_intake_operations",
        sourceObjectType: "microsoft_client_intake_submission",
        sourceObjectId: row.id,
        sourceObjectLabel: row.file_name,
        title,
        summary,
        deepLink: dashboardUrl,
        recipientUserIds: recipients,
        deliveryChannels: ["in_app"],
        dedupeKey: `client-intake-escalation:${row.id}:${nextLevel}`,
        metadata: {
          escalation_level: nextLevel,
          related_record_label: row.related_record_label
        },
        actionRequired: true
      });

      await queueOperationalAlert(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        alertType: nextLevel === 1 ? "client_intake_review_overdue" : "client_intake_escalated",
        title,
        summary,
        severity: nextLevel === 1 ? "high" : "critical",
        deepLink: "#admin/system",
        sourceEventType: "client_intake.escalated",
        sourceEntityType: "microsoft_client_intake_submission",
        sourceEntityId: row.id,
        dedupeKey: `client-intake-alert:${row.id}:${nextLevel}`,
        metadata: {
          escalation_level: nextLevel
        },
        facts: [
          { label: "Related record", value: row.related_record_label ?? "Unmapped submission" },
          { label: "Hours overdue", value: hoursPastDue },
          { label: "Submission", value: row.file_name }
        ]
      });

      await client.query(
        `
          UPDATE microsoft_client_intake_submission
          SET
            escalation_level = $3,
            first_escalation_at = CASE WHEN $3 >= 1 AND first_escalation_at IS NULL THEN now() ELSE first_escalation_at END,
            second_escalation_at = CASE WHEN $3 >= 2 AND second_escalation_at IS NULL THEN now() ELSE second_escalation_at END,
            escalated_at = now(),
            updated_at = now()
          WHERE tenant_id = $1
            AND id = $2::uuid
        `,
        [auth.tenantId, row.id, nextLevel]
      );

      await recordEvent(client, {
        tenantId: auth.tenantId,
        mappingId: row.mapping_id,
        submissionId: row.id,
        actorUserId: auth.id,
        eventType: "escalation_queued",
        note: nextLevel === 1 ? "Queued manager escalation for overdue review." : "Queued department-lead escalation for overdue review.",
        metadata: {
          escalation_level: nextLevel,
          recipient_user_ids: recipients
        }
      });
      escalatedCount += 1;
    } catch (error) {
      failedCount += 1;
      await recordEvent(client, {
        tenantId: auth.tenantId,
        mappingId: row.mapping_id,
        submissionId: row.id,
        actorUserId: auth.id,
        eventType: "escalation_failed",
        note: error instanceof Error ? error.message : "Unknown escalation failure.",
        metadata: {
          escalation_level: nextLevel
        }
      });
      await recordOperationalFailure(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        submissionId: row.id,
        eventType: "client_intake_escalation_queue_failed",
        summary: error instanceof Error ? error.message : "Unknown escalation failure.",
        detail: {
          escalation_level: nextLevel,
          mapping_id: row.mapping_id
        }
      });
    }
  }

  if (shouldQueueDigest(baseline)) {
    const local = getLocalTimeParts(baseline.alerting_and_digests.daily_digest.timezone);
    const workspace = await buildWorkspace(client, {
      tenantId: auth.tenantId,
      authorityTier: "super_admin"
    } as AuthUser);
    const digestItems = workspace.backlog.filter((item) => item.mapping?.digest_enabled !== false);
    const digestSummary = buildSummary(digestItems);

    if (digestSummary.open_backlog_count > 0) {
      try {
        const result = await queueOperationalAlert(client, {
          tenantId: auth.tenantId,
          actorUserId: auth.id,
          alertType: "client_intake_daily_digest",
          title: "Client intake daily risk summary",
          summary: `${digestSummary.open_backlog_count} open items, ${digestSummary.overdue_count} overdue, ${digestSummary.escalated_count} escalated.`,
          severity: digestSummary.escalated_count > 0 ? "high" : digestSummary.overdue_count > 0 ? "medium" : "low",
          deepLink: "#admin/system",
          sourceEventType: "client_intake.digest",
          sourceEntityType: "microsoft_client_intake_submission",
          sourceEntityId: null,
          dedupeKey: `client-intake-digest:${local.dateKey}`,
          metadata: {
            summary: digestSummary
          },
          facts: [
            { label: "Open backlog", value: digestSummary.open_backlog_count },
            { label: "Review queue", value: digestSummary.review_queue_count },
            { label: "Overdue", value: digestSummary.overdue_count },
            { label: "Escalated", value: digestSummary.escalated_count }
          ]
        });
        if (result.queued_count > 0) {
          digestQueuedCount += 1;
          await recordEvent(client, {
            tenantId: auth.tenantId,
            actorUserId: auth.id,
            eventType: "digest_queued",
            note: "Queued the daily client intake risk digest.",
            metadata: {
              date_key: local.dateKey,
              summary: digestSummary
            }
          });
        }
      } catch (error) {
        failedCount += 1;
        await recordEvent(client, {
          tenantId: auth.tenantId,
          actorUserId: auth.id,
          eventType: "digest_failed",
          note: error instanceof Error ? error.message : "Unknown digest failure."
        });
        await recordOperationalFailure(client, {
          tenantId: auth.tenantId,
          actorUserId: auth.id,
          eventType: "client_intake_daily_digest_failed",
          summary: error instanceof Error ? error.message : "Unknown digest failure.",
          detail: {
            date_key: local.dateKey
          }
        });
      }
    }
  }

  return {
    scanned_submission_count: rows.length,
    review_assignment_count: reviewAssignmentCount,
    escalated_count: escalatedCount,
    digest_queued_count: digestQueuedCount,
    suppressed_count: suppressedCount,
    failed_count: failedCount
  };
}

export async function getMicrosoft365ClientIntakeOperationalControlDiagnostics(
  client: PoolClient,
  auth: AuthUser
): Promise<Microsoft365ClientIntakeOperationalControlDiagnosticsResponse> {
  assertReadAccess(auth);
  const baselineEnvironment = resolveEnvironment();
  const baseline = loadBaseline(baselineEnvironment);
  const issues = getMicrosoft365ClientIntakeOperationalControlValidationIssues();
  const schemaReady = await hasPhase6Schema(client);
  const workspace = schemaReady
    ? await buildWorkspace(client, auth, { allowDisabledFeature: true })
    : {
        generated_at: new Date().toISOString(),
        summary: {
          open_backlog_count: 0,
          review_queue_count: 0,
          overdue_count: 0,
          escalated_count: 0,
          waiting_on_client_count: 0,
          paused_count: 0,
          unmatched_count: 0,
          manual_override_count: 0
        },
        review_queue: [],
        overdue_items: [],
        escalated_items: [],
        backlog: [],
        exception_items: []
      };

  const diagnosticsIssues = schemaReady
    ? issues
    : [
        ...issues,
        {
          area: "schema",
          severity: "error",
          code: "phase6.schema.missing",
          summary: "Phase 6 client intake operational-control schema is not available in this environment."
        } satisfies Microsoft365ClientIntakeValidationIssue
      ];

  return {
    generated_at: new Date().toISOString(),
    baseline_environment: baselineEnvironment,
    startup_validation: {
      valid: diagnosticsIssues.every((issue) => issue.severity !== "error"),
      issues: diagnosticsIssues
    },
    phase_audit_summary: {
      implementation_status: "implemented_as_dashboard_first_operational_control_layer",
      current_state:
        "Phase 5 already handled receipt, matching, and reminders. Phase 6 adds explicit reviewer ownership, approval and revision states, exception suppression, escalation thresholds, Teams alerting, daily risk summary behavior, and durable backlog views.",
      recommendation: determineRecommendation(diagnosticsIssues)
    },
    current_state_findings: buildCurrentStateFindings(),
    refactor_first: buildRefactorFirst(),
    approval_workflow: baseline.approval_workflow,
    escalation_rules: baseline.reviewer_assignment,
    alerting_and_digests: baseline.alerting_and_digests,
    exception_state_model: {
      states: baseline.exception_states,
      backlog_views: baseline.backlog_views
    },
    execution_order: baseline.execution_order,
    manual_admin_checklist: baseline.manual_admin_checklist,
    validation_checklist: baseline.validation_checklist,
    rollback_principles: baseline.rollback_principles,
    workspace
  };
}
