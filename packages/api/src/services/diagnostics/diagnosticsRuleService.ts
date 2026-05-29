import type { PoolClient } from "pg";
import { ApiError } from "../../errors/apiError.js";
import type { AuthUser } from "../../types/auth.js";
import type {
  DiagnosticFindingRecord,
  DiagnosticRuleRunRecord,
  DiagnosticRuleRunSummary
} from "../../types/diagnostics.js";
import type { JobDepartmentType } from "../../domain/jobTruth/index.js";
import { writeAuditEvent } from "./auditEventService.js";

type RuleKey =
  | "core_data.missing_job_day"
  | "workflow_gap.missing_production_item"
  | "status_drift.ready_with_open_blockers"
  | "status_drift.staffed_without_assignments"
  | "status_drift.ready_day_without_lead"
  | "data_integrity.watch_flag_missing_source";

type FindingCandidate = {
  findingType: string;
  severity: DiagnosticFindingRecord["severity"];
  resourceType: string | null;
  resourceId: string | null;
  relatedResourceType?: string | null;
  relatedResourceId?: string | null;
  departmentType: JobDepartmentType | null;
  title: string;
  description: string;
  recommendedAction?: string | null;
  repairable: boolean;
};

export type DiagnosticRuleRunInput = {
  ruleKey?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  departmentType?: JobDepartmentType | null;
  triggerType?: string;
};

const SUPPORTED_RULE_KEYS: RuleKey[] = [
  "core_data.missing_job_day",
  "workflow_gap.missing_production_item",
  "status_drift.ready_with_open_blockers",
  "status_drift.staffed_without_assignments",
  "status_drift.ready_day_without_lead",
  "data_integrity.watch_flag_missing_source"
];

function isSupportedRuleKey(value: string | null | undefined): value is RuleKey {
  return Boolean(value && SUPPORTED_RULE_KEYS.includes(value as RuleKey));
}

function candidateSignature(ruleKey: string, candidate: FindingCandidate) {
  return [
    ruleKey,
    candidate.resourceType ?? "",
    candidate.resourceId ?? "",
    candidate.relatedResourceType ?? "",
    candidate.relatedResourceId ?? ""
  ].join("::");
}

async function createRuleRun(
  client: PoolClient,
  auth: AuthUser,
  ruleKey: string,
  input: DiagnosticRuleRunInput
): Promise<DiagnosticRuleRunRecord> {
  const { rows } = await client.query<DiagnosticRuleRunRecord>(
    `
      INSERT INTO diagnostic_rule_runs (
        tenant_id,
        rule_key,
        scope_type,
        scope_value,
        status,
        trigger_type,
        triggered_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING
        id::text,
        tenant_id::text,
        rule_key,
        scope_type,
        scope_value,
        status,
        started_at,
        completed_at,
        result_summary_json,
        trigger_type,
        triggered_by_user_id::text,
        created_at
    `,
    [
      auth.tenantId,
      ruleKey,
      input.resourceType ? "record" : input.departmentType ? "department" : "tenant",
      input.resourceId ?? input.departmentType ?? null,
      "running",
      input.triggerType ?? "manual",
      auth.id
    ]
  );

  return rows[0];
}

async function completeRuleRun(
  client: PoolClient,
  runId: string,
  resultSummary: Record<string, unknown>
) {
  await client.query(
    `
      UPDATE diagnostic_rule_runs
      SET status = 'completed',
          completed_at = now(),
          result_summary_json = $2::jsonb
      WHERE id = $1::uuid
    `,
    [runId, JSON.stringify(resultSummary)]
  );
}

async function upsertFinding(
  client: PoolClient,
  auth: AuthUser,
  ruleKey: string,
  candidate: FindingCandidate
): Promise<"created" | "updated"> {
  const existing = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM diagnostic_findings
      WHERE tenant_id = $1
        AND rule_key = $2
        AND COALESCE(resource_type, '') = COALESCE($3, '')
        AND COALESCE(resource_id, '') = COALESCE($4, '')
        AND COALESCE(related_resource_type, '') = COALESCE($5, '')
        AND COALESCE(related_resource_id, '') = COALESCE($6, '')
        AND status IN ('open', 'acknowledged', 'in_review')
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [
      auth.tenantId,
      ruleKey,
      candidate.resourceType,
      candidate.resourceId,
      candidate.relatedResourceType ?? null,
      candidate.relatedResourceId ?? null
    ]
  );

  if (existing.rows[0]) {
    await client.query(
      `
        UPDATE diagnostic_findings
        SET
          finding_type = $3,
          severity = $4::diagnostic_severity_type,
          department_type = $5::job_department_type,
          title = $6,
          description = $7,
          recommended_action = $8,
          repairable = $9,
          detected_at = now(),
          updated_at = now()
        WHERE id = $1::uuid
          AND tenant_id = $2
      `,
      [
        existing.rows[0].id,
        auth.tenantId,
        candidate.findingType,
        candidate.severity,
        candidate.departmentType,
        candidate.title,
        candidate.description,
        candidate.recommendedAction ?? null,
        candidate.repairable
      ]
    );
    return "updated";
  }

  await client.query(
    `
      INSERT INTO diagnostic_findings (
        tenant_id,
        finding_type,
        severity,
        status,
        resource_type,
        resource_id,
        related_resource_type,
        related_resource_id,
        department_type,
        title,
        description,
        rule_key,
        detected_at,
        recommended_action,
        repairable
      )
      VALUES ($1,$2,$3::diagnostic_severity_type,'open',$4,$5,$6,$7,$8::job_department_type,$9,$10,$11,now(),$12,$13)
    `,
    [
      auth.tenantId,
      candidate.findingType,
      candidate.severity,
      candidate.resourceType,
      candidate.resourceId,
      candidate.relatedResourceType ?? null,
      candidate.relatedResourceId ?? null,
      candidate.departmentType,
      candidate.title,
      candidate.description,
      ruleKey,
      candidate.recommendedAction ?? null,
      candidate.repairable
    ]
  );
  return "created";
}

async function resolveStaleFindings(
  client: PoolClient,
  auth: AuthUser,
  ruleKey: string,
  candidateSignatures: Set<string>,
  input: DiagnosticRuleRunInput
) {
  const { rows } = await client.query<
    DiagnosticFindingRecord & {
      signature: string;
    }
  >(
    `
      SELECT
        id::text,
        tenant_id::text,
        finding_type,
        severity,
        status,
        resource_type,
        resource_id,
        related_resource_type,
        related_resource_id,
        department_type,
        title,
        description,
        rule_key,
        detected_at,
        owner_user_id::text,
        recommended_action,
        repairable,
        resolved_at,
        resolved_by_user_id::text,
        resolution_note,
        created_at,
        updated_at,
        concat_ws('::', rule_key, coalesce(resource_type, ''), coalesce(resource_id, ''), coalesce(related_resource_type, ''), coalesce(related_resource_id, '')) AS signature
      FROM diagnostic_findings
      WHERE tenant_id = $1
        AND rule_key = $2
        AND status IN ('open', 'acknowledged', 'in_review')
        ${
          input.departmentType
            ? "AND department_type = $3::job_department_type"
            : input.resourceType && input.resourceId
              ? "AND resource_type = $3 AND resource_id = $4"
              : ""
        }
    `,
    input.departmentType
      ? [auth.tenantId, ruleKey, input.departmentType]
      : input.resourceType && input.resourceId
        ? [auth.tenantId, ruleKey, input.resourceType, input.resourceId]
        : [auth.tenantId, ruleKey]
  );

  const staleIds = rows.filter((row) => !candidateSignatures.has(row.signature)).map((row) => row.id);
  if (!staleIds.length) {
    return 0;
  }

  await client.query(
    `
      UPDATE diagnostic_findings
      SET
        status = 'resolved',
        resolved_at = now(),
        resolved_by_user_id = $2::uuid,
        resolution_note = 'Rule no longer matched during diagnostics scan.',
        updated_at = now()
      WHERE tenant_id = $1
        AND id = ANY($3::uuid[])
    `,
    [auth.tenantId, auth.id, staleIds]
  );

  return staleIds.length;
}

async function selectMissingJobDayCandidates(client: PoolClient, auth: AuthUser, input: DiagnosticRuleRunInput) {
  if (input.resourceType && input.resourceType !== "job") {
    return [] as FindingCandidate[];
  }

  const values: Array<string> = [auth.tenantId];
  const conditions = [
    "job.tenant_id = $1",
    "job.published_at IS NOT NULL",
    "job.archived_at IS NULL",
    "job.cancelled_at IS NULL",
    "NOT EXISTS (SELECT 1 FROM job_days day WHERE day.tenant_id = job.tenant_id AND day.job_id = job.id)"
  ];

  if (input.departmentType) {
    values.push(input.departmentType);
    conditions.push(`job.department_type = $${values.length}::job_department_type`);
  }
  if (input.resourceId) {
    values.push(input.resourceId);
    conditions.push(`job.id = $${values.length}::uuid`);
  }

  const { rows } = await client.query<{ id: string; department_type: JobDepartmentType; title: string; job_number: string | null }>(
    `
      SELECT job.id::text, job.department_type, job.title, job.job_number
      FROM jobs job
      WHERE ${conditions.join(" AND ")}
      ORDER BY job.updated_at DESC
    `,
    values
  );

  return rows.map(
    (row): FindingCandidate => ({
      findingType: "core_data_integrity",
      severity: "high",
      resourceType: "job",
      resourceId: row.id,
      departmentType: row.department_type,
      title: `Published job ${row.job_number ?? row.title} has no day`,
      description: "The job is published but no execution day exists, so scheduling and day-of views can drift.",
      recommendedAction: "Create or regenerate a default job day from the shared schedule summary.",
      repairable: true
    })
  );
}

async function selectMissingProductionCandidates(client: PoolClient, auth: AuthUser, input: DiagnosticRuleRunInput) {
  if (input.resourceType && input.resourceType !== "job") {
    return [] as FindingCandidate[];
  }

  const values: Array<string> = [auth.tenantId];
  const conditions = [
    "job.tenant_id = $1",
    "job.published_at IS NOT NULL",
    "job.archived_at IS NULL",
    "job.cancelled_at IS NULL",
    "job.production_required = true",
    "NOT EXISTS (SELECT 1 FROM production_items item WHERE item.tenant_id = job.tenant_id AND item.job_id = job.id)"
  ];

  if (input.departmentType) {
    values.push(input.departmentType);
    conditions.push(`job.department_type = $${values.length}::job_department_type`);
  }
  if (input.resourceId) {
    values.push(input.resourceId);
    conditions.push(`job.id = $${values.length}::uuid`);
  }

  const { rows } = await client.query<{ id: string; department_type: JobDepartmentType; title: string; job_number: string | null }>(
    `
      SELECT job.id::text, job.department_type, job.title, job.job_number
      FROM jobs job
      WHERE ${conditions.join(" AND ")}
      ORDER BY job.updated_at DESC
    `,
    values
  );

  return rows.map(
    (row): FindingCandidate => ({
      findingType: "workflow_gap",
      severity: "critical",
      resourceType: "job",
      resourceId: row.id,
      departmentType: row.department_type,
      title: `Production item missing for ${row.job_number ?? row.title}`,
      description: "The job requires downstream production work, but no shared production item exists to carry the handoff.",
      recommendedAction: "Regenerate the default shared production item for this published job.",
      repairable: true
    })
  );
}

async function selectReadyWithBlockersCandidates(client: PoolClient, auth: AuthUser, input: DiagnosticRuleRunInput) {
  if (input.resourceType && input.resourceType !== "job") {
    return [] as FindingCandidate[];
  }

  const values: Array<string> = [auth.tenantId];
  const conditions = [
    "job.tenant_id = $1",
    "job.readiness_status = 'ready'::job_readiness_status_type",
    "item.is_blocker = true",
    "item.is_complete = false"
  ];

  if (input.departmentType) {
    values.push(input.departmentType);
    conditions.push(`job.department_type = $${values.length}::job_department_type`);
  }
  if (input.resourceId) {
    values.push(input.resourceId);
    conditions.push(`job.id = $${values.length}::uuid`);
  }

  const { rows } = await client.query<{
    id: string;
    department_type: JobDepartmentType;
    title: string;
    job_number: string | null;
    blocker_count: string;
  }>(
    `
      SELECT
        job.id::text,
        job.department_type,
        job.title,
        job.job_number,
        count(*)::text AS blocker_count
      FROM jobs job
      JOIN job_readiness_items item ON item.job_id = job.id AND item.tenant_id = job.tenant_id
      WHERE ${conditions.join(" AND ")}
      GROUP BY job.id
      ORDER BY job.updated_at DESC
    `,
    values
  );

  return rows.map(
    (row): FindingCandidate => ({
      findingType: "status_drift",
      severity: "high",
      resourceType: "job",
      resourceId: row.id,
      departmentType: row.department_type,
      title: `${row.job_number ?? row.title} is marked ready with blockers open`,
      description: `${row.blocker_count} readiness blocker item(s) are still incomplete even though the job readiness state is ready.`,
      recommendedAction: "Recompute readiness state or complete the remaining blocker items before leaving the job ready.",
      repairable: true
    })
  );
}

async function selectStaffedWithoutAssignmentsCandidates(client: PoolClient, auth: AuthUser, input: DiagnosticRuleRunInput) {
  if (input.resourceType && input.resourceType !== "job") {
    return [] as FindingCandidate[];
  }

  const values: Array<string> = [auth.tenantId];
  const conditions = [
    "job.tenant_id = $1",
    "job.staffing_status IN ('staffed'::job_staffing_status_type, 'checked_in'::job_staffing_status_type, 'ready_confirmed'::job_staffing_status_type)",
    "NOT EXISTS (SELECT 1 FROM job_staff_assignments assignment WHERE assignment.tenant_id = job.tenant_id AND assignment.job_id = job.id AND assignment.assignment_status <> 'cancelled'::job_assignment_status)"
  ];

  if (input.departmentType) {
    values.push(input.departmentType);
    conditions.push(`job.department_type = $${values.length}::job_department_type`);
  }
  if (input.resourceId) {
    values.push(input.resourceId);
    conditions.push(`job.id = $${values.length}::uuid`);
  }

  const { rows } = await client.query<{ id: string; department_type: JobDepartmentType; title: string; job_number: string | null }>(
    `
      SELECT job.id::text, job.department_type, job.title, job.job_number
      FROM jobs job
      WHERE ${conditions.join(" AND ")}
      ORDER BY job.updated_at DESC
    `,
    values
  );

  return rows.map(
    (row): FindingCandidate => ({
      findingType: "status_drift",
      severity: "high",
      resourceType: "job",
      resourceId: row.id,
      departmentType: row.department_type,
      title: `${row.job_number ?? row.title} reports staffed with no assignments`,
      description: "The aggregate staffing status says the job is staffed or checked in, but no active staff assignment records exist.",
      recommendedAction: "Recompute staffing state or rebuild the missing shared assignment records.",
      repairable: true
    })
  );
}

async function selectReadyDayWithoutLeadCandidates(client: PoolClient, auth: AuthUser, input: DiagnosticRuleRunInput) {
  if (input.resourceType && !["job_day", "job"].includes(input.resourceType)) {
    return [] as FindingCandidate[];
  }

  const values: Array<string> = [auth.tenantId];
  const conditions = [
    "day.tenant_id = $1",
    "day.day_status = 'ready'::job_day_status_type",
    `NOT EXISTS (
      SELECT 1
      FROM job_staff_assignments assignment
      WHERE assignment.tenant_id = day.tenant_id
        AND assignment.job_id = day.job_id
        AND assignment.is_lead = true
        AND assignment.assignment_status <> 'cancelled'::job_assignment_status
        AND (assignment.job_day_id = day.id OR assignment.job_day_id IS NULL)
    )`
  ];

  if (input.departmentType) {
    values.push(input.departmentType);
    conditions.push(`job.department_type = $${values.length}::job_department_type`);
  }
  if (input.resourceType === "job_day" && input.resourceId) {
    values.push(input.resourceId);
    conditions.push(`day.id = $${values.length}::uuid`);
  }
  if (input.resourceType === "job" && input.resourceId) {
    values.push(input.resourceId);
    conditions.push(`day.job_id = $${values.length}::uuid`);
  }

  const { rows } = await client.query<{
    id: string;
    job_id: string;
    department_type: JobDepartmentType;
    title: string;
    day_label: string | null;
    date: string;
  }>(
    `
      SELECT
        day.id::text,
        day.job_id::text,
        job.department_type,
        job.title,
        day.day_label,
        day.date::text
      FROM job_days day
      JOIN jobs job ON job.id = day.job_id AND job.tenant_id = day.tenant_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY day.date ASC
    `,
    values
  );

  return rows.map(
    (row): FindingCandidate => ({
      findingType: "status_drift",
      severity: "critical",
      resourceType: "job_day",
      resourceId: row.id,
      relatedResourceType: "job",
      relatedResourceId: row.job_id,
      departmentType: row.department_type,
      title: `${row.title} day ${row.day_label ?? row.date} is ready without a lead`,
      description: "The job day has been marked ready, but there is no shared lead assignment for the day or job-wide fallback lead.",
      recommendedAction: "Assign a lead or move the day back out of ready until lead coverage exists.",
      repairable: false
    })
  );
}

async function sourceEntityExists(client: PoolClient, tenantId: string, sourceEntityType: string, sourceEntityId: string) {
  const tableByType: Record<string, { table: string; idColumn?: string }> = {
    job: { table: "jobs" },
    job_day: { table: "job_days" },
    production_item: { table: "production_items" },
    approval_request: { table: "approval_requests" },
    qa_review_record: { table: "qa_review_records" },
    deliverable_item: { table: "deliverable_items" },
    production_issue_record: { table: "production_issue_records" },
    job_watch_flag: { table: "job_watch_flags" }
  };
  const target = tableByType[sourceEntityType];
  if (!target) {
    return false;
  }

  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM ${target.table} WHERE tenant_id = $1 AND id = $2::uuid) AS exists`,
    [tenantId, sourceEntityId]
  );
  return Boolean(result.rows[0]?.exists);
}

async function selectMissingSourceWatchFlagCandidates(client: PoolClient, auth: AuthUser, input: DiagnosticRuleRunInput) {
  if (input.resourceType && !["job_watch_flag", "job"].includes(input.resourceType)) {
    return [] as FindingCandidate[];
  }

  const values: Array<string> = [auth.tenantId];
  const conditions = [
    "flag.tenant_id = $1",
    "flag.status IN ('open'::job_watch_flag_status_type, 'acknowledged'::job_watch_flag_status_type, 'snoozed'::job_watch_flag_status_type)",
    "flag.source_entity_type IS NOT NULL",
    "flag.source_entity_id IS NOT NULL"
  ];

  if (input.departmentType) {
    values.push(input.departmentType);
    conditions.push(`job.department_type = $${values.length}::job_department_type`);
  }
  if (input.resourceType === "job_watch_flag" && input.resourceId) {
    values.push(input.resourceId);
    conditions.push(`flag.id = $${values.length}::uuid`);
  }
  if (input.resourceType === "job" && input.resourceId) {
    values.push(input.resourceId);
    conditions.push(`flag.job_id = $${values.length}::uuid`);
  }

  const { rows } = await client.query<{
    id: string;
    job_id: string | null;
    department_type: JobDepartmentType | null;
    source_entity_type: string;
    source_entity_id: string;
    title: string;
  }>(
    `
      SELECT
        flag.id::text,
        flag.job_id::text,
        job.department_type,
        flag.source_entity_type,
        flag.source_entity_id,
        flag.title
      FROM job_watch_flags flag
      LEFT JOIN jobs job ON job.id = flag.job_id AND job.tenant_id = flag.tenant_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY flag.created_at DESC
    `,
    values
  );

  const candidates: FindingCandidate[] = [];
  for (const row of rows) {
    const exists = await sourceEntityExists(client, auth.tenantId, row.source_entity_type, row.source_entity_id);
    if (exists) {
      continue;
    }
    candidates.push({
      findingType: "data_integrity",
      severity: "medium",
      resourceType: "job_watch_flag",
      resourceId: row.id,
      relatedResourceType: row.job_id ? "job" : null,
      relatedResourceId: row.job_id,
      departmentType: row.department_type,
      title: `${row.title} points to a missing source record`,
      description: `The watch flag references ${row.source_entity_type}:${row.source_entity_id}, but that shared source record no longer exists.`,
      recommendedAction: "Re-evaluate the watch flag or repair the missing linked record before the flag is trusted again.",
      repairable: false
    });
  }

  return candidates;
}

async function collectCandidatesForRule(
  client: PoolClient,
  auth: AuthUser,
  ruleKey: RuleKey,
  input: DiagnosticRuleRunInput
) {
  switch (ruleKey) {
    case "core_data.missing_job_day":
      return selectMissingJobDayCandidates(client, auth, input);
    case "workflow_gap.missing_production_item":
      return selectMissingProductionCandidates(client, auth, input);
    case "status_drift.ready_with_open_blockers":
      return selectReadyWithBlockersCandidates(client, auth, input);
    case "status_drift.staffed_without_assignments":
      return selectStaffedWithoutAssignmentsCandidates(client, auth, input);
    case "status_drift.ready_day_without_lead":
      return selectReadyDayWithoutLeadCandidates(client, auth, input);
    case "data_integrity.watch_flag_missing_source":
      return selectMissingSourceWatchFlagCandidates(client, auth, input);
    default:
      return [];
  }
}

function toRuleKeys(inputRuleKey: string | null | undefined) {
  if (!inputRuleKey) {
    return [...SUPPORTED_RULE_KEYS];
  }
  if (!isSupportedRuleKey(inputRuleKey)) {
    throw new ApiError(400, "Unknown diagnostic rule key");
  }
  return [inputRuleKey];
}

export async function runDiagnosticRules(
  client: PoolClient,
  auth: AuthUser,
  input: DiagnosticRuleRunInput = {}
): Promise<DiagnosticRuleRunSummary[]> {
  const ruleKeys = toRuleKeys(input.ruleKey);
  const summaries: DiagnosticRuleRunSummary[] = [];

  for (const ruleKey of ruleKeys) {
    const run = await createRuleRun(client, auth, ruleKey, input);
    const candidates = await collectCandidatesForRule(client, auth, ruleKey, input);
    const signatures = new Set<string>();
    let findingsCreated = 0;
    let findingsUpdated = 0;

    for (const candidate of candidates) {
      signatures.add(candidateSignature(ruleKey, candidate));
      const action = await upsertFinding(client, auth, ruleKey, candidate);
      if (action === "created") {
        findingsCreated += 1;
      } else {
        findingsUpdated += 1;
      }
    }

    const findingsResolved = await resolveStaleFindings(client, auth, ruleKey, signatures, input);
    const summary = {
      run,
      findings_created: findingsCreated,
      findings_updated: findingsUpdated,
      findings_resolved: findingsResolved
    } satisfies DiagnosticRuleRunSummary;

    await completeRuleRun(client, run.id, {
      findings_created: findingsCreated,
      findings_updated: findingsUpdated,
      findings_resolved: findingsResolved,
      scanned_rule: ruleKey,
      scanned_resource_type: input.resourceType ?? null,
      scanned_resource_id: input.resourceId ?? null,
      scanned_department_type: input.departmentType ?? null
    });
    await writeAuditEvent(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventCategory: "diagnostics",
      eventType: "rule_run_completed",
      resourceType: "diagnostic_rule_run",
      resourceId: run.id,
      departmentType: input.departmentType ?? null,
      newValues: {
        findings_created: findingsCreated,
        findings_updated: findingsUpdated,
        findings_resolved: findingsResolved
      },
      context: {
        rule_key: ruleKey,
        resource_type: input.resourceType ?? null,
        resource_id: input.resourceId ?? null
      },
      result: "completed"
    });

    summaries.push(summary);
  }

  return summaries;
}
