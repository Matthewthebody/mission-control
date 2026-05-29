import type { PoolClient } from "pg";
import { JOB_DEPARTMENT_TYPES, type JobDepartmentType } from "../domain/jobTruth/index.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  ReportingFoundationBucketMetric,
  ReportingFoundationMetric,
  ReportingFoundationReadinessArea,
  ReportingFoundationResponse,
  ReportingFoundationSection,
  ReportingFoundationSummaryCard,
  ReportingFoundationTrendPoint,
  ReportingFoundationWorkloadPerson
} from "../types/reportingFoundation.js";
import type { OperationalReportingBucket, OperationalReportingPeriod, OperationalReportingTone } from "../types/operationalReporting.js";
import { writeAuditEvent } from "./diagnostics/auditEventService.js";
import { getOperatingSystemQueryScope } from "./operatingSystemAccess.js";
import { markRequestContextAsAction } from "./requestContext.js";

type ReportBucket = OperationalReportingBucket & {
  startsAt: Date;
  endsBefore: Date;
};

type ReportingWindow = {
  anchorDate: string;
  periodLabel: string;
  startsAt: Date;
  endsBefore: Date;
  buckets: ReportBucket[];
};

type JobAnalyticsRow = {
  id: string;
  department_type: string;
  job_status: string;
  staffing_status: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  completed_at: string | null;
  archived_at: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  client_deadline_at: string | null;
  production_deadline_at: string | null;
};

type JobDayAnalyticsRow = {
  id: string;
  job_id: string;
  date: string;
  day_status: string;
  lead_user_id: string | null;
};

type AssignmentAnalyticsRow = {
  id: string;
  user_id: string;
  job_id: string;
  job_day_id: string | null;
  assignment_status: string;
  created_at: string;
  scheduled_at: string | null;
};

type WorkTaskAnalyticsRow = {
  id: string;
  department_type: string;
  assigned_to_user_id: string | null;
  status: string;
  due_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type ProductionItemAnalyticsRow = {
  id: string;
  department_type: string;
  assigned_to_user_id: string | null;
  status: string;
  workflow_status: string;
  release_status: string | null;
  due_at: string | null;
  release_due_at: string | null;
  delivery_deadline_at: string | null;
  created_at: string;
  completed_at: string | null;
  blocker_count: number;
  rework_count: number;
};

type ApprovalAnalyticsRow = {
  id: string;
  request_type: string;
  status: string;
  requester_department: string | null;
  requested_by_user_id: string | null;
  current_approver_user_id: string | null;
  created_at: string;
  decided_at: string | null;
  sla_due_at: string | null;
  overdue_at: string | null;
};

type ApprovalEventAnalyticsRow = {
  approval_request_id: string;
  event_type: string;
  created_at: string;
};

type OperationalEventAnalyticsRow = {
  id: string;
  event_type: string;
  severity: string;
  action_required: boolean;
  occurred_at: string;
  department_type: string | null;
};

type OperationalEventDeliveryAnalyticsRow = {
  operational_event_id: string;
  dispatch_status: string;
  created_at: string;
};

type UserIdentityRow = {
  id: string;
  full_name: string;
  department: string | null;
};

type ReadinessGapRow = {
  jobs_missing_completed_at: string;
  tasks_missing_completed_at: string;
};

type ReportingColumnSupport = {
  jobsCompletedAt: boolean;
  workTaskCompletedAt: boolean;
  approvalCurrentApproverUserId: boolean;
  evaluationJobId: boolean;
};

const ACTIVE_JOB_STATUSES = new Set([
  "draft",
  "intake_blocked",
  "pending_confirmation",
  "confirmed",
  "ready_to_staff",
  "staffed",
  "ready_to_execute",
  "in_progress",
  "weather_hold",
  "postponed"
]);
const ACTIVE_TASK_STATUSES = new Set(["not_started", "in_progress", "waiting", "blocked", "review"]);
const ACTIVE_PRODUCTION_STATUSES = new Set([
  "queued",
  "awaiting_ingest",
  "ingest_complete",
  "editing",
  "proof_build",
  "proof_sent",
  "awaiting_approval",
  "revisions_requested",
  "approved_for_production",
  "ordered_or_printed",
  "packaged",
  "blocked"
]);
const READY_FOR_QA_WORKFLOW_STATUSES = new Set(["READY_FOR_QA", "IN_PEER_REVIEW"]);
const READY_FOR_RELEASE_WORKFLOW_STATUSES = new Set(["UPLOADED", "READY_FOR_RELEASE"]);
const FINAL_APPROVAL_STATUSES = new Set(["approved", "rejected", "canceled"]);

function formatValue(value: number, suffix = "") {
  return `${value}${suffix}`;
}

function formatPercentValue(value: number) {
  return `${value.toFixed(1)}%`;
}

function makeSummaryCard(id: string, label: string, value: string, detail: string, tone: OperationalReportingTone): ReportingFoundationSummaryCard {
  return { id, label, value, detail, tone };
}

function makeMetric(
  key: string,
  label: string,
  value: string,
  definition: string,
  sourceTables: string[],
  tone: OperationalReportingTone = "neutral"
): ReportingFoundationMetric {
  return {
    key,
    label,
    value,
    definition,
    source_tables: sourceTables,
    tone
  };
}

function makeBucketMetric(key: string, label: string, value: number): ReportingFoundationBucketMetric {
  return { key, label, value };
}

function rate(count: number, total: number) {
  if (!total) {
    return 0;
  }
  return Number(((count / total) * 100).toFixed(1));
}

function average(values: number[]) {
  if (!values.length) {
    return null;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

function hoursBetween(start: string, end: string | null) {
  if (!end) {
    return null;
  }
  return Number(((new Date(end).getTime() - new Date(start).getTime()) / 3_600_000).toFixed(1));
}

function isWithinRange(value: string | null | undefined, startsAt: Date, endsBefore: Date) {
  if (!value) {
    return false;
  }
  const time = new Date(value).getTime();
  return time >= startsAt.getTime() && time < endsBefore.getTime();
}

function isDateWithinRange(value: string | null | undefined, startsAt: Date, endsBefore: Date) {
  if (!value) {
    return false;
  }
  const time = new Date(`${value}T00:00:00`).getTime();
  return time >= startsAt.getTime() && time < endsBefore.getTime();
}

function humanizeToken(value: string) {
  return value
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function toneFromCount(count: number, warningThreshold = 1, actionThreshold = 3): OperationalReportingTone {
  if (count >= actionThreshold) {
    return "action_needed";
  }
  if (count >= warningThreshold) {
    return "heads_up";
  }
  return "neutral";
}

function toneFromRate(value: number, goodThreshold: number, warningThreshold: number): OperationalReportingTone {
  if (value >= goodThreshold) {
    return "good";
  }
  if (value >= warningThreshold) {
    return "heads_up";
  }
  return "action_needed";
}

function effectiveJobCompletedAt(job: JobAnalyticsRow) {
  if (job.completed_at) {
    return job.completed_at;
  }
  if (job.job_status === "execution_complete") {
    return job.updated_at;
  }
  if (job.job_status === "archived") {
    return job.archived_at ?? null;
  }
  return null;
}

function effectiveProductionDueAt(item: ProductionItemAnalyticsRow) {
  return item.delivery_deadline_at ?? item.release_due_at ?? item.due_at ?? null;
}

function isApprovalOverdue(row: ApprovalAnalyticsRow, compareDate: Date) {
  if (FINAL_APPROVAL_STATUSES.has(row.status)) {
    return false;
  }
  if (row.overdue_at) {
    return true;
  }
  return Boolean(row.sla_due_at && new Date(row.sla_due_at).getTime() < compareDate.getTime());
}

function stripBucketInternals(bucket: ReportBucket): OperationalReportingBucket {
  return {
    key: bucket.key,
    label: bucket.label,
    starts_at: bucket.starts_at,
    ends_before: bucket.ends_before
  };
}

function makeBucket(key: string, label: string, startsAt: Date, endsBefore: Date): ReportBucket {
  return {
    key,
    label,
    starts_at: startsAt.toISOString(),
    ends_before: endsBefore.toISOString(),
    startsAt,
    endsBefore
  };
}

function formatMonthLabel(value: Date) {
  return value.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatMonthDay(value: Date) {
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function buildReportingWindow(anchorDate: string, period: OperationalReportingPeriod): ReportingWindow {
  const anchor = new Date(`${anchorDate}T00:00:00`);
  const endsBefore = new Date(anchor.getTime());
  endsBefore.setDate(endsBefore.getDate() + 1);

  if (period === "monthly") {
    const startsAt = new Date(endsBefore.getTime());
    startsAt.setDate(startsAt.getDate() - 28);
    return {
      anchorDate,
      periodLabel: "Monthly",
      startsAt,
      endsBefore,
      buckets: Array.from({ length: 4 }, (_, index) => {
        const bucketStart = new Date(startsAt.getTime());
        bucketStart.setDate(bucketStart.getDate() + index * 7);
        const bucketEnd = index === 3 ? endsBefore : new Date(bucketStart.getTime() + 7 * 24 * 60 * 60 * 1000);
        return makeBucket(
          `week_${index + 1}`,
          `${formatMonthDay(bucketStart)}-${formatMonthDay(new Date(bucketEnd.getTime() - 24 * 60 * 60 * 1000))}`,
          bucketStart,
          bucketEnd
        );
      })
    };
  }

  const monthCount = period === "quarterly" ? 3 : 12;
  const currentMonthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const startsAt = new Date(currentMonthStart.getFullYear(), currentMonthStart.getMonth() - (monthCount - 1), 1);
  return {
    anchorDate,
    periodLabel: period === "quarterly" ? "Quarterly" : "Annual",
    startsAt,
    endsBefore,
    buckets: Array.from({ length: monthCount }, (_, index) => {
      const bucketStart = new Date(startsAt.getFullYear(), startsAt.getMonth() + index, 1);
      const bucketEnd = index === monthCount - 1 ? endsBefore : new Date(startsAt.getFullYear(), startsAt.getMonth() + index + 1, 1);
      return makeBucket(`month_${index + 1}`, formatMonthLabel(bucketStart), bucketStart, bucketEnd);
    })
  };
}

function resolveScopedDepartment(auth: AuthUser, scopeLevel: "none" | "own" | "department" | "all", requestedDepartment: string | null) {
  if (scopeLevel === "department") {
    if (requestedDepartment && requestedDepartment !== auth.department) {
      throw new ApiError(403, "You can only report on your scoped department.");
    }
    return auth.department;
  }
  return requestedDepartment;
}

const JOB_DEPARTMENT_TYPE_SET = new Set<string>(JOB_DEPARTMENT_TYPES);

function toJobDepartmentType(value: string | null): JobDepartmentType | null {
  return value && JOB_DEPARTMENT_TYPE_SET.has(value) ? (value as JobDepartmentType) : null;
}

async function loadReportingColumnSupport(client: PoolClient): Promise<ReportingColumnSupport> {
  const result = await client.query<{
    jobs_completed_at: boolean;
    work_task_completed_at: boolean;
    approval_current_approver_user_id: boolean;
    evaluation_job_id: boolean;
  }>(
    `
      SELECT
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'jobs'
            AND column_name = 'completed_at'
        ) AS jobs_completed_at,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'work_task'
            AND column_name = 'completed_at'
        ) AS work_task_completed_at,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'operational_approval_request'
            AND column_name = 'current_approver_user_id'
        ) AS approval_current_approver_user_id,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'post_shoot_evaluation'
            AND column_name = 'job_id'
        ) AS evaluation_job_id
    `
  );

  return {
    jobsCompletedAt: Boolean(result.rows[0]?.jobs_completed_at),
    workTaskCompletedAt: Boolean(result.rows[0]?.work_task_completed_at),
    approvalCurrentApproverUserId: Boolean(result.rows[0]?.approval_current_approver_user_id),
    evaluationJobId: Boolean(result.rows[0]?.evaluation_job_id)
  };
}

async function loadJobs(
  client: PoolClient,
  tenantId: string,
  department: string | null,
  endsBefore: Date,
  columnSupport: ReportingColumnSupport
) {
  const params: unknown[] = [tenantId, endsBefore.toISOString()];
  let sql = `
    SELECT
      job.id::text,
      job.department_type::text,
      job.job_status::text,
      job.staffing_status::text,
      job.created_at::text,
      job.updated_at::text,
      job.published_at::text,
      ${columnSupport.jobsCompletedAt ? "job.completed_at::text" : "NULL::text"} AS completed_at,
      job.archived_at::text,
      job.scheduled_start_at::text,
      job.scheduled_end_at::text,
      job.client_deadline_at::text,
      job.production_deadline_at::text
    FROM jobs job
    WHERE job.tenant_id = $1
      AND job.created_at < $2::timestamptz
  `;
  if (department) {
    params.push(department);
    sql += ` AND job.department_type::text = $${params.length}`;
  }
  const result = await client.query<JobAnalyticsRow>(sql, params);
  return result.rows;
}

async function loadJobDays(client: PoolClient, tenantId: string, department: string | null, startsAt: Date, endsBefore: Date) {
  const params: unknown[] = [tenantId, startsAt.toISOString().slice(0, 10), endsBefore.toISOString().slice(0, 10)];
  let sql = `
    SELECT
      day.id::text,
      day.job_id::text,
      day.date::text,
      day.day_status::text,
      day.lead_user_id::text
    FROM job_days day
    JOIN jobs job
      ON job.tenant_id = day.tenant_id
     AND job.id = day.job_id
    WHERE day.tenant_id = $1
      AND day.date >= $2::date
      AND day.date < $3::date
  `;
  if (department) {
    params.push(department);
    sql += ` AND job.department_type::text = $${params.length}`;
  }
  const result = await client.query<JobDayAnalyticsRow>(sql, params);
  return result.rows;
}

async function loadAssignments(client: PoolClient, tenantId: string, department: string | null, endsBefore: Date) {
  const params: unknown[] = [tenantId, endsBefore.toISOString()];
  let sql = `
    SELECT
      assignment.id::text,
      assignment.user_id::text,
      assignment.job_id::text,
      assignment.job_day_id::text,
      assignment.assignment_status::text,
      assignment.created_at::text,
      COALESCE(day.date::text, job.scheduled_start_at::text, job.created_at::text) AS scheduled_at
    FROM job_staff_assignments assignment
    JOIN jobs job
      ON job.tenant_id = assignment.tenant_id
     AND job.id = assignment.job_id
    LEFT JOIN job_days day
      ON day.tenant_id = assignment.tenant_id
     AND day.id = assignment.job_day_id
    WHERE assignment.tenant_id = $1
      AND assignment.created_at < $2::timestamptz
  `;
  if (department) {
    params.push(department);
    sql += ` AND job.department_type::text = $${params.length}`;
  }
  const result = await client.query<AssignmentAnalyticsRow>(sql, params);
  return result.rows;
}

async function loadWorkTasks(
  client: PoolClient,
  tenantId: string,
  department: string | null,
  endsBefore: Date,
  columnSupport: ReportingColumnSupport
) {
  const params: unknown[] = [tenantId, endsBefore.toISOString()];
  let sql = `
    SELECT
      task.id::text,
      task.department_type::text,
      task.assigned_to_user_id::text,
      task.status::text,
      task.due_at::text,
      task.created_at::text,
      task.updated_at::text,
      ${columnSupport.workTaskCompletedAt ? "task.completed_at::text" : "NULL::text"} AS completed_at
    FROM work_task task
    WHERE task.tenant_id = $1
      AND task.created_at < $2::timestamptz
  `;
  if (department) {
    params.push(department);
    sql += ` AND task.department_type::text = $${params.length}`;
  }
  const result = await client.query<WorkTaskAnalyticsRow>(sql, params);
  return result.rows;
}

async function loadProductionItems(client: PoolClient, tenantId: string, department: string | null, endsBefore: Date) {
  const params: unknown[] = [tenantId, endsBefore.toISOString()];
  let sql = `
    SELECT
      item.id::text,
      item.department_type::text,
      item.assigned_to_user_id::text,
      item.status::text,
      item.workflow_status::text,
      item.release_status::text,
      item.due_at::text,
      item.release_due_at::text,
      item.delivery_deadline_at::text,
      item.created_at::text,
      item.completed_at::text,
      item.blocker_count,
      item.rework_count
    FROM production_items item
    WHERE item.tenant_id = $1
      AND item.created_at < $2::timestamptz
  `;
  if (department) {
    params.push(department);
    sql += ` AND item.department_type::text = $${params.length}`;
  }
  const result = await client.query<ProductionItemAnalyticsRow>(sql, params);
  return result.rows;
}

async function loadApprovals(
  client: PoolClient,
  tenantId: string,
  department: string | null,
  endsBefore: Date,
  columnSupport: ReportingColumnSupport
) {
  const params: unknown[] = [tenantId, endsBefore.toISOString()];
  let sql = `
    SELECT
      request.id::text,
      request.request_type::text,
      request.status::text,
      request.requester_department,
      request.requested_by_user_id::text,
      ${columnSupport.approvalCurrentApproverUserId ? "request.current_approver_user_id::text" : "NULL::text"} AS current_approver_user_id,
      request.created_at::text,
      request.decided_at::text,
      request.sla_due_at::text,
      request.overdue_at::text
    FROM operational_approval_request request
    WHERE request.tenant_id = $1
      AND request.created_at < $2::timestamptz
  `;
  if (department) {
    params.push(department);
    sql += ` AND request.requester_department = $${params.length}`;
  }
  const result = await client.query<ApprovalAnalyticsRow>(sql, params);
  return result.rows;
}

async function loadApprovalEvents(client: PoolClient, tenantId: string, department: string | null, startsAt: Date, endsBefore: Date) {
  const params: unknown[] = [tenantId, startsAt.toISOString(), endsBefore.toISOString()];
  let sql = `
    SELECT
      event.approval_request_id::text,
      event.event_type,
      event.created_at::text
    FROM operational_approval_event event
    JOIN operational_approval_request request
      ON request.tenant_id = event.tenant_id
     AND request.id = event.approval_request_id
    WHERE event.tenant_id = $1
      AND event.created_at >= $2::timestamptz
      AND event.created_at < $3::timestamptz
  `;
  if (department) {
    params.push(department);
    sql += ` AND request.requester_department = $${params.length}`;
  }
  const result = await client.query<ApprovalEventAnalyticsRow>(sql, params);
  return result.rows;
}

async function loadOperationalEvents(
  client: PoolClient,
  tenantId: string,
  department: string | null,
  startsAt: Date,
  endsBefore: Date,
  columnSupport: ReportingColumnSupport
) {
  const params: unknown[] = [tenantId, startsAt.toISOString(), endsBefore.toISOString(), department];
  const result = await client.query<OperationalEventAnalyticsRow>(
    `
      SELECT
        scoped.id::text,
        scoped.event_type,
        scoped.severity::text,
        scoped.action_required,
        scoped.occurred_at::text,
        scoped.department_type
      FROM (
        SELECT
          event.id,
          event.event_type,
          event.severity,
          event.action_required,
          COALESCE(event.occurred_at, event.created_at) AS occurred_at,
          CASE
            WHEN event.source_object_type = 'job' THEN job.department_type::text
            WHEN event.source_object_type = 'job_staff_assignment' THEN assignment_job.department_type::text
            WHEN event.source_object_type = 'production_item' THEN production.department_type::text
            WHEN event.source_object_type = 'work_task' THEN task.department_type::text
            WHEN event.source_object_type = 'operational_approval_request' THEN approval.requester_department
            WHEN event.source_object_type = 'post_shoot_evaluation' THEN evaluation_job.department_type::text
            ELSE NULL
          END AS department_type
        FROM operational_event event
        LEFT JOIN jobs job
          ON job.tenant_id = event.tenant_id
         AND event.source_object_type = 'job'
         AND job.id::text = event.source_object_id
        LEFT JOIN jobs assignment_job
          ON assignment_job.tenant_id = event.tenant_id
         AND event.source_object_type = 'job_staff_assignment'
         AND assignment_job.id::text = split_part(event.source_object_id, ':', 1)
        LEFT JOIN production_items production
          ON production.tenant_id = event.tenant_id
         AND event.source_object_type = 'production_item'
         AND production.id::text = event.source_object_id
        LEFT JOIN work_task task
          ON task.tenant_id = event.tenant_id
         AND event.source_object_type = 'work_task'
         AND task.id::text = event.source_object_id
        LEFT JOIN operational_approval_request approval
          ON approval.tenant_id = event.tenant_id
         AND event.source_object_type = 'operational_approval_request'
         AND approval.id::text = event.source_object_id
        LEFT JOIN post_shoot_evaluation evaluation
          ON evaluation.tenant_id = event.tenant_id
         AND event.source_object_type = 'post_shoot_evaluation'
         AND evaluation.id::text = event.source_object_id
        LEFT JOIN jobs evaluation_job
          ON evaluation_job.tenant_id = event.tenant_id
         AND ${
           columnSupport.evaluationJobId
             ? "evaluation_job.id = evaluation.job_id"
             : "evaluation_job.legacy_shoot_id = evaluation.shoot_id"
         }
        WHERE event.tenant_id = $1
          AND COALESCE(event.occurred_at, event.created_at) >= $2::timestamptz
          AND COALESCE(event.occurred_at, event.created_at) < $3::timestamptz
      ) scoped
      WHERE $4::text IS NULL OR scoped.department_type = $4::text
      ORDER BY scoped.occurred_at DESC
    `,
    params
  );
  return result.rows;
}

async function loadOperationalEventDeliveries(client: PoolClient, tenantId: string, eventIds: string[]) {
  if (!eventIds.length) {
    return [];
  }
  const result = await client.query<OperationalEventDeliveryAnalyticsRow>(
    `
      SELECT
        delivery.operational_event_id::text,
        delivery.dispatch_status::text,
        delivery.created_at::text
      FROM operational_event_delivery delivery
      WHERE delivery.tenant_id = $1
        AND delivery.operational_event_id = ANY($2::uuid[])
    `,
    [tenantId, eventIds]
  );
  return result.rows;
}

async function loadUserIdentities(client: PoolClient, tenantId: string, userIds: string[]) {
  if (!userIds.length) {
    return [];
  }
  const result = await client.query<UserIdentityRow>(
    `
      SELECT
        user_row.id::text,
        user_row.full_name,
        user_row.department::text
      FROM app_user user_row
      WHERE user_row.tenant_id = $1
        AND user_row.id = ANY($2::uuid[])
    `,
    [tenantId, userIds]
  );
  return result.rows;
}

async function loadReadinessGaps(
  client: PoolClient,
  tenantId: string,
  department: string | null,
  columnSupport: ReportingColumnSupport
) {
  const result = await client.query<ReadinessGapRow>(
    `
      SELECT
        (
          SELECT count(*)
          FROM jobs job
          WHERE job.tenant_id = $1
            AND job.job_status::text = 'execution_complete'
            ${columnSupport.jobsCompletedAt ? "AND job.completed_at IS NULL" : ""}
            AND ($2::text IS NULL OR job.department_type::text = $2::text)
        )::text AS jobs_missing_completed_at,
        (
          SELECT count(*)
          FROM work_task task
          WHERE task.tenant_id = $1
            AND task.status::text = 'completed'
            ${columnSupport.workTaskCompletedAt ? "AND task.completed_at IS NULL" : ""}
            AND ($2::text IS NULL OR task.department_type::text = $2::text)
        )::text AS tasks_missing_completed_at
    `,
    [tenantId, department]
  );
  return result.rows[0];
}

function buildStaffingEfficiencySection(
  jobs: JobAnalyticsRow[],
  jobDays: JobDayAnalyticsRow[],
  assignments: AssignmentAnalyticsRow[],
  window: ReportingWindow
): ReportingFoundationSection {
  const scheduledJobs = jobs.filter((job) => isWithinRange(job.scheduled_start_at ?? job.created_at, window.startsAt, window.endsBefore));
  const staffedJobs = scheduledJobs.filter((job) => ["staffed", "checked_in", "ready_confirmed"].includes(job.staffing_status));
  const staffingGapJobs = scheduledJobs.filter((job) => ["unassigned", "partially_staffed", "gap_flagged"].includes(job.staffing_status));
  const assignmentsCreated = assignments.filter((assignment) => isWithinRange(assignment.created_at, window.startsAt, window.endsBefore));
  const leadGapDays = jobDays.filter((day) => ["scheduled", "ready", "in_progress"].includes(day.day_status) && !day.lead_user_id);
  const staffedJobRate = rate(staffedJobs.length, Math.max(scheduledJobs.length, 1));
  const averageAssignmentsPerJob = average(
    Array.from(
      assignmentsCreated.reduce((map, assignment) => {
        map.set(assignment.job_id, (map.get(assignment.job_id) ?? 0) + 1);
        return map;
      }, new Map<string, number>()).values()
    )
  );

  return {
    summary_line:
      scheduledJobs.length === 0
        ? "No scheduled jobs landed inside this reporting window."
        : `${staffedJobs.length}/${scheduledJobs.length} scheduled job${scheduledJobs.length === 1 ? "" : "s"} reached staffed coverage, while ${staffingGapJobs.length} still show staffing gaps.`,
    metrics: [
      makeMetric("scheduled_jobs", "Scheduled jobs", formatValue(scheduledJobs.length), "Jobs whose scheduled start fell inside the reporting window.", ["jobs"]),
      makeMetric(
        "staffed_job_rate",
        "Staffed job rate",
        formatPercentValue(staffedJobRate),
        "Scheduled jobs that reached staffed/check-in-ready staffing states.",
        ["jobs", "job_staff_assignments"],
        toneFromRate(staffedJobRate, 90, 75)
      ),
      makeMetric(
        "staffing_gap_jobs",
        "Jobs with staffing gaps",
        formatValue(staffingGapJobs.length),
        "Scheduled jobs still marked unassigned, partially staffed, or gap flagged.",
        ["jobs"],
        toneFromCount(staffingGapJobs.length, 1, 3)
      ),
      makeMetric(
        "lead_gap_days",
        "Job days missing a lead",
        formatValue(leadGapDays.length),
        "Job days that are active in the window and still do not have a lead user assigned.",
        ["job_days"],
        toneFromCount(leadGapDays.length, 1, 2)
      ),
      makeMetric(
        "average_assignments_per_job",
        "Average assignments per staffed job",
        averageAssignmentsPerJob == null ? "No staffed jobs yet" : `${averageAssignmentsPerJob.toFixed(1)} avg`,
        "Average number of staffing assignments created for jobs with at least one staffing action in the window.",
        ["job_staff_assignments"]
      )
    ],
    trend: window.buckets.map((bucket): ReportingFoundationTrendPoint => {
      const bucketScheduled = scheduledJobs.filter((job) => isWithinRange(job.scheduled_start_at ?? job.created_at, bucket.startsAt, bucket.endsBefore));
      const bucketGapJobs = bucketScheduled.filter((job) => ["unassigned", "partially_staffed", "gap_flagged"].includes(job.staffing_status));
      return {
        bucket: stripBucketInternals(bucket),
        metrics: [
          makeBucketMetric("scheduled_jobs", "Scheduled jobs", bucketScheduled.length),
          makeBucketMetric("assignments_created", "Assignments created", assignmentsCreated.filter((assignment) => isWithinRange(assignment.created_at, bucket.startsAt, bucket.endsBefore)).length),
          makeBucketMetric("staffing_gap_jobs", "Gap jobs", bucketGapJobs.length),
          makeBucketMetric("lead_gap_days", "Lead gaps", leadGapDays.filter((day) => isDateWithinRange(day.date, bucket.startsAt, bucket.endsBefore)).length)
        ]
      };
    })
  };
}

function buildJobCompletionSection(jobs: JobAnalyticsRow[], window: ReportingWindow): ReportingFoundationSection {
  const completedJobs = jobs
    .map((job) => ({ job, completedAt: effectiveJobCompletedAt(job) }))
    .filter((item) => isWithinRange(item.completedAt, window.startsAt, window.endsBefore));
  const publishLeadTimes = jobs
    .filter((job) => isWithinRange(job.published_at, window.startsAt, window.endsBefore))
    .map((job) => hoursBetween(job.created_at, job.published_at))
    .filter((value): value is number => value != null && value >= 0);
  const closeoutTimes = completedJobs
    .map(({ job, completedAt }) => hoursBetween(job.scheduled_end_at ?? job.scheduled_start_at ?? job.created_at, completedAt))
    .filter((value): value is number => value != null && value >= 0);
  const deadlineScopedJobs = completedJobs.filter(({ job }) => Boolean(job.production_deadline_at ?? job.client_deadline_at));
  const onTimeRate = rate(
    deadlineScopedJobs.filter(({ job, completedAt }) => new Date(completedAt!).getTime() <= new Date(job.production_deadline_at ?? job.client_deadline_at!).getTime()).length,
    Math.max(deadlineScopedJobs.length, 1)
  );
  const overdueOpenJobs = jobs.filter((job) => {
    const deadline = job.production_deadline_at ?? job.client_deadline_at;
    return Boolean(deadline && ACTIVE_JOB_STATUSES.has(job.job_status) && new Date(deadline).getTime() < window.endsBefore.getTime());
  });
  const averagePublishLeadHours = average(publishLeadTimes);
  const averageCloseoutHours = average(closeoutTimes);

  return {
    summary_line:
      completedJobs.length === 0
        ? "No jobs closed inside this reporting window yet."
        : `${completedJobs.length} job${completedJobs.length === 1 ? "" : "s"} reached completion, with ${overdueOpenJobs.length} still open past a tracked deadline.`,
    metrics: [
      makeMetric("completed_jobs", "Completed jobs", formatValue(completedJobs.length), "Jobs that reached a durable completion timestamp inside the reporting window.", ["jobs"]),
      makeMetric(
        "avg_publish_lead_hours",
        "Average publish lead time",
        averagePublishLeadHours == null ? "No publish activity" : `${averagePublishLeadHours.toFixed(1)}h`,
        "Average hours from job creation to publish timestamp for jobs published in the window.",
        ["jobs"]
      ),
      makeMetric(
        "avg_execution_to_close_hours",
        "Average execution-to-close time",
        averageCloseoutHours == null ? "No completed jobs" : `${averageCloseoutHours.toFixed(1)}h`,
        "Average hours from scheduled execution end to durable completion.",
        ["jobs"]
      ),
      makeMetric(
        "on_time_completion_rate",
        "On-time completion rate",
        deadlineScopedJobs.length ? formatPercentValue(onTimeRate) : "No deadline-backed completions",
        "Completed jobs that landed on or before their production or client deadline.",
        ["jobs"],
        deadlineScopedJobs.length ? toneFromRate(onTimeRate, 90, 75) : "neutral"
      ),
      makeMetric(
        "open_jobs_past_deadline",
        "Open jobs past deadline",
        formatValue(overdueOpenJobs.length),
        "Jobs still active even though their current production or client deadline has passed.",
        ["jobs"],
        toneFromCount(overdueOpenJobs.length, 1, 3)
      )
    ],
    trend: window.buckets.map((bucket): ReportingFoundationTrendPoint => {
      const bucketCompleted = completedJobs.filter((item) => isWithinRange(item.completedAt, bucket.startsAt, bucket.endsBefore));
      return {
        bucket: stripBucketInternals(bucket),
        metrics: [
          makeBucketMetric("completed_jobs", "Completed jobs", bucketCompleted.length),
          makeBucketMetric("published_jobs", "Published jobs", jobs.filter((job) => isWithinRange(job.published_at, bucket.startsAt, bucket.endsBefore)).length),
          makeBucketMetric(
            "overdue_open_jobs",
            "Open past deadline",
            overdueOpenJobs.filter((job) => {
              const deadline = job.production_deadline_at ?? job.client_deadline_at;
              return Boolean(deadline && isWithinRange(deadline, bucket.startsAt, bucket.endsBefore));
            }).length
          ),
          makeBucketMetric(
            "execution_to_close_hours",
            "Close hours",
            Math.round(
              average(
                bucketCompleted
                  .map(({ job, completedAt }) => hoursBetween(job.scheduled_end_at ?? job.scheduled_start_at ?? job.created_at, completedAt))
                  .filter((value): value is number => value != null)
              ) ?? 0
            )
          )
        ]
      };
    })
  };
}

function buildOverdueWorkSection(
  jobs: JobAnalyticsRow[],
  tasks: WorkTaskAnalyticsRow[],
  productionItems: ProductionItemAnalyticsRow[],
  approvals: ApprovalAnalyticsRow[],
  window: ReportingWindow
): ReportingFoundationSection {
  const overdueTasks = tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status) && task.due_at && new Date(task.due_at).getTime() < window.endsBefore.getTime());
  const overdueProduction = productionItems.filter((item) => {
    const dueAt = effectiveProductionDueAt(item);
    return Boolean(dueAt && ACTIVE_PRODUCTION_STATUSES.has(item.status) && new Date(dueAt).getTime() < window.endsBefore.getTime());
  });
  const overdueApprovals = approvals.filter((approval) => isApprovalOverdue(approval, window.endsBefore));
  const overdueJobs = jobs.filter((job) => {
    const deadline = job.production_deadline_at ?? job.client_deadline_at;
    return Boolean(deadline && ACTIVE_JOB_STATUSES.has(job.job_status) && new Date(deadline).getTime() < window.endsBefore.getTime());
  });

  return {
    summary_line:
      overdueTasks.length + overdueProduction.length + overdueApprovals.length + overdueJobs.length === 0
        ? "No overdue work signals are currently open in this reporting window."
        : `${overdueTasks.length} tasks, ${overdueProduction.length} production items, ${overdueApprovals.length} approvals, and ${overdueJobs.length} jobs are overdue or past their tracked deadline.`,
    metrics: [
      makeMetric("overdue_tasks", "Overdue tasks", formatValue(overdueTasks.length), "Open tasks whose due date is earlier than the report anchor window end.", ["work_task"], toneFromCount(overdueTasks.length, 1, 4)),
      makeMetric("overdue_production_items", "Overdue production items", formatValue(overdueProduction.length), "Open production items with a due, release, or delivery deadline already in the past.", ["production_items"], toneFromCount(overdueProduction.length, 1, 4)),
      makeMetric("overdue_approvals", "Overdue approvals", formatValue(overdueApprovals.length), "Operational approval requests still pending after their SLA or explicit overdue marker.", ["operational_approval_request"], toneFromCount(overdueApprovals.length, 1, 3)),
      makeMetric("open_jobs_past_deadline", "Jobs past tracked deadline", formatValue(overdueJobs.length), "Active jobs with client or production deadlines already behind them.", ["jobs"], toneFromCount(overdueJobs.length, 1, 3))
    ],
    trend: window.buckets.map((bucket): ReportingFoundationTrendPoint => ({
      bucket: stripBucketInternals(bucket),
      metrics: [
        makeBucketMetric("overdue_tasks", "Overdue tasks", overdueTasks.filter((task) => task.due_at && isWithinRange(task.due_at, bucket.startsAt, bucket.endsBefore)).length),
        makeBucketMetric(
          "overdue_production_items",
          "Overdue production",
          overdueProduction.filter((item) => {
            const dueAt = effectiveProductionDueAt(item);
            return Boolean(dueAt && isWithinRange(dueAt, bucket.startsAt, bucket.endsBefore));
          }).length
        ),
        makeBucketMetric(
          "overdue_approvals",
          "Overdue approvals",
          overdueApprovals.filter((approval) => {
            const dueAt = approval.overdue_at ?? approval.sla_due_at;
            return Boolean(dueAt && isWithinRange(dueAt, bucket.startsAt, bucket.endsBefore));
          }).length
        ),
        makeBucketMetric(
          "jobs_past_deadline",
          "Jobs past deadline",
          overdueJobs.filter((job) => {
            const deadline = job.production_deadline_at ?? job.client_deadline_at;
            return Boolean(deadline && isWithinRange(deadline, bucket.startsAt, bucket.endsBefore));
          }).length
        )
      ]
    }))
  };
}

function buildProductionThroughputSection(productionItems: ProductionItemAnalyticsRow[], window: ReportingWindow): ReportingFoundationSection {
  const completed = productionItems.filter((item) => Boolean(item.completed_at && isWithinRange(item.completed_at, window.startsAt, window.endsBefore)));
  const turnaroundHours = completed
    .map((item) => hoursBetween(item.created_at, item.completed_at))
    .filter((value): value is number => value != null && value >= 0);
  const blocked = productionItems.filter((item) => ACTIVE_PRODUCTION_STATUSES.has(item.status) && (item.status === "blocked" || item.blocker_count > 0));
  const readyForQa = productionItems.filter((item) => ACTIVE_PRODUCTION_STATUSES.has(item.status) && READY_FOR_QA_WORKFLOW_STATUSES.has(item.workflow_status));
  const readyForRelease = productionItems.filter((item) => ACTIVE_PRODUCTION_STATUSES.has(item.status) && READY_FOR_RELEASE_WORKFLOW_STATUSES.has(item.workflow_status));
  const reworkRate = rate(productionItems.filter((item) => item.rework_count > 0).length, Math.max(productionItems.length, 1));
  const averageTurnaroundHours = average(turnaroundHours);

  return {
    summary_line:
      completed.length === 0
        ? "No production items completed in this reporting window yet."
        : `${completed.length} production item${completed.length === 1 ? "" : "s"} completed, while ${blocked.length} remain blocked and ${readyForQa.length} are waiting for QA.`,
    metrics: [
      makeMetric("completed_items", "Completed items", formatValue(completed.length), "Production items whose completion timestamp landed inside the reporting window.", ["production_items"]),
      makeMetric("average_turnaround_hours", "Average turnaround", averageTurnaroundHours == null ? "No completions" : `${averageTurnaroundHours.toFixed(1)}h`, "Average hours from production item creation to completion.", ["production_items"]),
      makeMetric("blocked_items", "Blocked items", formatValue(blocked.length), "Open production items that are explicitly blocked or still carry open blocker counts.", ["production_items"], toneFromCount(blocked.length, 1, 4)),
      makeMetric("ready_for_qa", "Ready for QA", formatValue(readyForQa.length), "Open production items sitting in Ready for QA or peer-review workflow states.", ["production_items"], toneFromCount(readyForQa.length, 1, 5)),
      makeMetric("ready_for_release", "Ready for release", formatValue(readyForRelease.length), "Open production items that finished upload/release prep and are waiting for release action.", ["production_items"], toneFromCount(readyForRelease.length, 1, 5)),
      makeMetric("rework_rate", "Rework rate", formatPercentValue(reworkRate), "Production items carrying one or more rework counts divided by total items in scope.", ["production_items"], toneFromCount(Math.round(reworkRate), 15, 35))
    ],
    trend: window.buckets.map((bucket): ReportingFoundationTrendPoint => ({
      bucket: stripBucketInternals(bucket),
      metrics: [
        makeBucketMetric("completed_items", "Completed items", completed.filter((item) => isWithinRange(item.completed_at, bucket.startsAt, bucket.endsBefore)).length),
        makeBucketMetric("blocked_items", "Blocked items", blocked.filter((item) => isWithinRange(item.created_at, bucket.startsAt, bucket.endsBefore) || !item.completed_at).length),
        makeBucketMetric("ready_for_qa", "Ready for QA", readyForQa.filter((item) => isWithinRange(item.created_at, bucket.startsAt, bucket.endsBefore) || !item.completed_at).length),
        makeBucketMetric("ready_for_release", "Ready for release", readyForRelease.filter((item) => isWithinRange(item.created_at, bucket.startsAt, bucket.endsBefore) || !item.completed_at).length)
      ]
    }))
  };
}

function buildApprovalsSection(
  approvals: ApprovalAnalyticsRow[],
  approvalEvents: ApprovalEventAnalyticsRow[],
  window: ReportingWindow
): ReportingFoundationSection {
  const createdInRange = approvals.filter((approval) => isWithinRange(approval.created_at, window.startsAt, window.endsBefore));
  const decidedInRange = approvals.filter((approval) => isWithinRange(approval.decided_at, window.startsAt, window.endsBefore));
  const overdue = approvals.filter((approval) => isApprovalOverdue(approval, window.endsBefore));
  const averageDecisionHours = average(
    decidedInRange
      .map((approval) => hoursBetween(approval.created_at, approval.decided_at))
      .filter((value): value is number => value != null && value >= 0)
  );
  const approvedCount = decidedInRange.filter((approval) => approval.status === "approved").length;
  const rejectedCount = decidedInRange.filter((approval) => approval.status === "rejected").length;
  const sentBackCount = approvalEvents.filter((event) => event.event_type === "approval.sent_back").length;

  return {
    summary_line:
      createdInRange.length === 0
        ? "No operational approvals were created in this reporting window."
        : `${createdInRange.length} approval request${createdInRange.length === 1 ? "" : "s"} were created, ${approvedCount} were approved, and ${overdue.length} remain overdue.`,
    metrics: [
      makeMetric("approval_volume", "Approval volume", formatValue(createdInRange.length), "Operational approval requests created inside the reporting window.", ["operational_approval_request"]),
      makeMetric("approved_count", "Approved", formatValue(approvedCount), "Approval requests decided as approved inside the reporting window.", ["operational_approval_request"], "good"),
      makeMetric("rejected_count", "Rejected", formatValue(rejectedCount), "Approval requests decided as rejected inside the reporting window.", ["operational_approval_request"], toneFromCount(rejectedCount, 1, 3)),
      makeMetric("overdue_count", "Overdue requests", formatValue(overdue.length), "Open approval requests that have crossed their SLA or explicit overdue marker.", ["operational_approval_request"], toneFromCount(overdue.length, 1, 3)),
      makeMetric("average_decision_hours", "Average decision time", averageDecisionHours == null ? "No decisions" : `${averageDecisionHours.toFixed(1)}h`, "Average hours from request creation to final decision.", ["operational_approval_request"]),
      makeMetric("sent_back_count", "Sent back for clarification", formatValue(sentBackCount), "Approval event volume where a request was sent back for more information.", ["operational_approval_event"], toneFromCount(sentBackCount, 1, 3))
    ],
    trend: window.buckets.map((bucket): ReportingFoundationTrendPoint => ({
      bucket: stripBucketInternals(bucket),
      metrics: [
        makeBucketMetric("volume", "Volume", createdInRange.filter((approval) => isWithinRange(approval.created_at, bucket.startsAt, bucket.endsBefore)).length),
        makeBucketMetric("approved", "Approved", decidedInRange.filter((approval) => approval.status === "approved" && isWithinRange(approval.decided_at, bucket.startsAt, bucket.endsBefore)).length),
        makeBucketMetric("rejected", "Rejected", decidedInRange.filter((approval) => approval.status === "rejected" && isWithinRange(approval.decided_at, bucket.startsAt, bucket.endsBefore)).length),
        makeBucketMetric("sent_back", "Sent back", approvalEvents.filter((event) => event.event_type === "approval.sent_back" && isWithinRange(event.created_at, bucket.startsAt, bucket.endsBefore)).length)
      ]
    }))
  };
}

function buildNotificationEventSection(
  events: OperationalEventAnalyticsRow[],
  deliveries: OperationalEventDeliveryAnalyticsRow[],
  window: ReportingWindow
): ReportingFoundationSection {
  const highSeverity = events.filter((event) => ["high", "critical"].includes(event.severity)).length;
  const actionRequired = events.filter((event) => event.action_required).length;
  const dispatched = deliveries.filter((delivery) => delivery.dispatch_status === "dispatched").length;
  const queued = deliveries.filter((delivery) => delivery.dispatch_status === "queued").length;
  const throttled = deliveries.filter((delivery) => delivery.dispatch_status === "throttled").length;
  const eventTypeCounts = new Map<string, number>();
  for (const event of events) {
    eventTypeCounts.set(event.event_type, (eventTypeCounts.get(event.event_type) ?? 0) + 1);
  }
  const topEventType = [...eventTypeCounts.entries()].sort((left, right) => right[1] - left[1])[0];

  return {
    summary_line:
      events.length === 0
        ? "No operational events were emitted in this reporting window."
        : `${events.length} operational event${events.length === 1 ? "" : "s"} were emitted, ${highSeverity} were high severity, and ${throttled} deliveries were throttled to reduce duplicate noise.`,
    metrics: [
      makeMetric("event_volume", "Operational events", formatValue(events.length), "Operational events emitted in the reporting window before delivery fan-out.", ["operational_event"]),
      makeMetric("high_severity_events", "High-severity events", formatValue(highSeverity), "Operational events tagged high or critical severity.", ["operational_event"], toneFromCount(highSeverity, 1, 4)),
      makeMetric("action_required_events", "Action-required events", formatValue(actionRequired), "Operational events flagged as action-required for follow-through.", ["operational_event"], toneFromCount(actionRequired, 1, 4)),
      makeMetric("dispatched_notifications", "Dispatched notifications", formatValue(dispatched), "Recipient-level operational event deliveries successfully dispatched into the in-app channel.", ["operational_event_delivery"], dispatched > 0 ? "good" : "neutral"),
      makeMetric("queued_notifications", "Queued notifications", formatValue(queued), "Recipient-level deliveries queued but not yet marked dispatched.", ["operational_event_delivery"], toneFromCount(queued, 1, 6)),
      makeMetric("throttled_notifications", "Throttled notifications", formatValue(throttled), "Recipient-level deliveries intentionally suppressed by dedupe/throttle rules.", ["operational_event_delivery"], throttled > 0 ? "info" : "neutral"),
      makeMetric("top_event_type", "Top event type", topEventType ? `${humanizeToken(topEventType[0])} (${topEventType[1]})` : "No events", "Most common operational event type in the reporting window.", ["operational_event"])
    ],
    trend: window.buckets.map((bucket): ReportingFoundationTrendPoint => {
      const bucketEventIds = events.filter((event) => isWithinRange(event.occurred_at, bucket.startsAt, bucket.endsBefore)).map((event) => event.id);
      return {
        bucket: stripBucketInternals(bucket),
        metrics: [
          makeBucketMetric("events", "Events", bucketEventIds.length),
          makeBucketMetric("high_severity", "High severity", events.filter((event) => ["high", "critical"].includes(event.severity) && isWithinRange(event.occurred_at, bucket.startsAt, bucket.endsBefore)).length),
          makeBucketMetric("dispatched", "Dispatched", deliveries.filter((delivery) => bucketEventIds.includes(delivery.operational_event_id) && delivery.dispatch_status === "dispatched").length),
          makeBucketMetric("throttled", "Throttled", deliveries.filter((delivery) => bucketEventIds.includes(delivery.operational_event_id) && delivery.dispatch_status === "throttled").length)
        ]
      };
    })
  };
}

function buildEmployeeWorkloadSection(
  assignments: AssignmentAnalyticsRow[],
  tasks: WorkTaskAnalyticsRow[],
  productionItems: ProductionItemAnalyticsRow[],
  approvals: ApprovalAnalyticsRow[],
  users: UserIdentityRow[],
  window: ReportingWindow,
  limit: number
): ReportingFoundationSection & { people: ReportingFoundationWorkloadPerson[] } {
  const nextSevenDays = new Date(window.endsBefore.getTime());
  nextSevenDays.setDate(nextSevenDays.getDate() + 7);
  const peopleMap = new Map<string, ReportingFoundationWorkloadPerson>();
  const userIndex = new Map(users.map((user) => [user.id, user]));

  function ensurePerson(userId: string) {
    const existing = peopleMap.get(userId);
    if (existing) {
      return existing;
    }
    const identity = userIndex.get(userId);
    const created: ReportingFoundationWorkloadPerson = {
      user_id: userId,
      full_name: identity?.full_name ?? "Unknown Employee",
      department: identity?.department ?? null,
      upcoming_assignments: 0,
      open_tasks: 0,
      overdue_tasks: 0,
      open_production_items: 0,
      overdue_production_items: 0,
      pending_approvals: 0,
      load_score: 0
    };
    peopleMap.set(userId, created);
    return created;
  }

  for (const assignment of assignments) {
    if (!assignment.user_id || assignment.assignment_status === "cancelled") {
      continue;
    }
    const scheduledAt = assignment.scheduled_at ? new Date(assignment.scheduled_at) : null;
    if (!scheduledAt || scheduledAt.getTime() < window.endsBefore.getTime() || scheduledAt.getTime() >= nextSevenDays.getTime()) {
      continue;
    }
    ensurePerson(assignment.user_id).upcoming_assignments += 1;
  }

  for (const task of tasks) {
    if (!task.assigned_to_user_id || !ACTIVE_TASK_STATUSES.has(task.status)) {
      continue;
    }
    const person = ensurePerson(task.assigned_to_user_id);
    person.open_tasks += 1;
    if (task.due_at && new Date(task.due_at).getTime() < window.endsBefore.getTime()) {
      person.overdue_tasks += 1;
    }
  }

  for (const item of productionItems) {
    if (!item.assigned_to_user_id || !ACTIVE_PRODUCTION_STATUSES.has(item.status)) {
      continue;
    }
    const person = ensurePerson(item.assigned_to_user_id);
    person.open_production_items += 1;
    const dueAt = effectiveProductionDueAt(item);
    if (dueAt && new Date(dueAt).getTime() < window.endsBefore.getTime()) {
      person.overdue_production_items += 1;
    }
  }

  for (const approval of approvals) {
    if (!approval.current_approver_user_id || FINAL_APPROVAL_STATUSES.has(approval.status)) {
      continue;
    }
    ensurePerson(approval.current_approver_user_id).pending_approvals += 1;
  }

  const people = [...peopleMap.values()]
    .map((person) => ({
      ...person,
      load_score:
        person.upcoming_assignments * 2 +
        person.open_tasks +
        person.overdue_tasks * 2 +
        person.open_production_items * 2 +
        person.overdue_production_items * 3 +
        person.pending_approvals
    }))
    .sort((left, right) => right.load_score - left.load_score || left.full_name.localeCompare(right.full_name))
    .slice(0, limit);

  const employeesOverCapacity = people.filter((person) => person.load_score >= 8).length;
  const employeesWithOverdueOwnedWork = people.filter((person) => person.overdue_tasks + person.overdue_production_items > 0).length;
  const averageLoadScore = average(people.map((person) => person.load_score));

  return {
    summary_line:
      people.length === 0
        ? "No employee workload signals landed in this reporting scope."
        : `${people[0]?.full_name ?? "Top assignee"} currently carries the heaviest visible workload, and ${employeesWithOverdueOwnedWork} employee${employeesWithOverdueOwnedWork === 1 ? "" : "s"} have overdue owned work.`,
    metrics: [
      makeMetric("visible_people", "People with visible workload", formatValue(people.length), "Employees with upcoming assignments, open tasks, open production items, or pending approvals in scope.", ["job_staff_assignments", "work_task", "production_items", "operational_approval_request"]),
      makeMetric("employees_over_capacity", "Employees over capacity watch", formatValue(employeesOverCapacity), "People whose blended load score crossed the conservative watch threshold.", ["job_staff_assignments", "work_task", "production_items", "operational_approval_request"], toneFromCount(employeesOverCapacity, 1, 3)),
      makeMetric("employees_with_overdue_owned_work", "Employees with overdue owned work", formatValue(employeesWithOverdueOwnedWork), "People carrying overdue tasks or production items.", ["work_task", "production_items"], toneFromCount(employeesWithOverdueOwnedWork, 1, 3)),
      makeMetric("average_load_score", "Average visible load score", averageLoadScore == null ? "No visible workload" : averageLoadScore.toFixed(1), "Blended score across upcoming assignments, open tasks, production items, and pending approvals.", ["job_staff_assignments", "work_task", "production_items", "operational_approval_request"])
    ],
    people,
    trend: window.buckets.map((bucket): ReportingFoundationTrendPoint => ({
      bucket: stripBucketInternals(bucket),
      metrics: [
        makeBucketMetric("upcoming_assignments", "Upcoming assignments", assignments.filter((assignment) => assignment.scheduled_at && isWithinRange(assignment.scheduled_at, bucket.startsAt, bucket.endsBefore)).length),
        makeBucketMetric("open_tasks_created", "Open tasks created", tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status) && isWithinRange(task.created_at, bucket.startsAt, bucket.endsBefore)).length),
        makeBucketMetric("open_production_created", "Open production created", productionItems.filter((item) => ACTIVE_PRODUCTION_STATUSES.has(item.status) && isWithinRange(item.created_at, bucket.startsAt, bucket.endsBefore)).length),
        makeBucketMetric("pending_approvals_created", "Pending approvals created", approvals.filter((approval) => !FINAL_APPROVAL_STATUSES.has(approval.status) && isWithinRange(approval.created_at, bucket.startsAt, bucket.endsBefore)).length)
      ]
    }))
  };
}

function buildDataReadiness(
  readinessGaps: ReadinessGapRow,
  scopedDepartment: string | null
): { summary_line: string; areas: ReportingFoundationReadinessArea[] } {
  const jobsMissingCompletedAt = Number(readinessGaps.jobs_missing_completed_at ?? 0);
  const tasksMissingCompletedAt = Number(readinessGaps.tasks_missing_completed_at ?? 0);
  const areas: ReportingFoundationReadinessArea[] = [
    {
      area: "staffing_efficiency",
      label: "Staffing Efficiency",
      state: "ready",
      summary: "Staffing efficiency is backed by canonical jobs, job days, and staffing assignments.",
      source_tables: ["jobs", "job_days", "job_staff_assignments"],
      gaps: []
    },
    {
      area: "job_completion_timing",
      label: "Job Completion Timing",
      state: jobsMissingCompletedAt > 0 ? "improving" : "ready",
      summary:
        jobsMissingCompletedAt > 0
          ? `${jobsMissingCompletedAt} completed job record${jobsMissingCompletedAt === 1 ? "" : "s"} still predate the new durable completion timestamp and will fall back to updated/archive time in analytics.`
          : "Job completion timing now has a durable completion timestamp for future transitions.",
      source_tables: ["jobs"],
      gaps: jobsMissingCompletedAt > 0 ? ["Historical completed jobs without completed_at still rely on fallback timestamps until they are backfilled precisely."] : []
    },
    {
      area: "overdue_work",
      label: "Overdue Work",
      state: "ready",
      summary: "Overdue work is measurable from current-state due dates on jobs, tasks, production items, and approvals.",
      source_tables: ["jobs", "work_task", "production_items", "operational_approval_request"],
      gaps: []
    },
    {
      area: "production_throughput",
      label: "Production Throughput",
      state: "ready",
      summary: "Production throughput already has completion, blocker, workflow, QA, and rework signals on the canonical production item model.",
      source_tables: ["production_items"],
      gaps: []
    },
    {
      area: "exception_approval_volume",
      label: "Exception and Approval Volume",
      state: "ready",
      summary: "Operational approvals already capture request type, status, actor, SLA, and event history for reusable reporting.",
      source_tables: ["operational_approval_request", "operational_approval_event"],
      gaps: []
    },
    {
      area: "notification_event_trends",
      label: "Notification and Event Trends",
      state: scopedDepartment ? "partial" : "ready",
      summary:
        scopedDepartment
          ? "Department-scoped event reporting works, but some event rows still require source-object inference because department is not first-class on every operational event."
          : "Operational events and recipient deliveries already form a durable event-trend foundation.",
      source_tables: ["operational_event", "operational_event_delivery"],
      gaps: scopedDepartment ? ["Department filtering for notification events still depends on linked source-object inference for older event types."] : []
    },
    {
      area: "employee_workload",
      label: "Employee Workload Visibility",
      state: tasksMissingCompletedAt > 0 ? "improving" : "ready",
      summary:
        tasksMissingCompletedAt > 0
          ? `${tasksMissingCompletedAt} completed task record${tasksMissingCompletedAt === 1 ? "" : "s"} still predate the new durable completion timestamp, so historical workload closeout timing can still fall back to updated_at.`
          : "Employee workload is measurable from staffing assignments, tasks, production ownership, and pending approvals.",
      source_tables: ["job_staff_assignments", "work_task", "production_items", "operational_approval_request"],
      gaps: tasksMissingCompletedAt > 0 ? ["Historical completed tasks without completed_at still use updated_at as a temporary analytics fallback."] : []
    }
  ];

  return {
    summary_line:
      "This foundation prefers durable source-of-truth tables and event streams over UI-specific queries. Most metric areas are report-ready today, and Phase 10 adds durable completion timestamps where analytics was previously falling back to generic update times.",
    areas
  };
}

export async function getReportingFoundation(
  client: PoolClient,
  auth: AuthUser,
  input: {
    anchorDate: string;
    period: OperationalReportingPeriod;
    department?: string | null;
    workloadLimit?: number | null;
  }
): Promise<ReportingFoundationResponse> {
  const scope = getOperatingSystemQueryScope(auth, "reports");
  if (scope.level === "none") {
    throw new ApiError(403, "You do not have access to view reporting.");
  }

  const scopedDepartment = resolveScopedDepartment(auth, scope.level, input.department ?? null);
  const window = buildReportingWindow(input.anchorDate, input.period);
  const workloadLimit = Math.min(Math.max(Number(input.workloadLimit ?? 8), 3), 20);
  const columnSupport = await loadReportingColumnSupport(client);

  const jobs = await loadJobs(client, auth.tenantId, scopedDepartment, window.endsBefore, columnSupport);
  const jobDays = await loadJobDays(client, auth.tenantId, scopedDepartment, window.startsAt, window.endsBefore);
  const assignments = await loadAssignments(client, auth.tenantId, scopedDepartment, window.endsBefore);
  const tasks = await loadWorkTasks(client, auth.tenantId, scopedDepartment, window.endsBefore, columnSupport);
  const productionItems = await loadProductionItems(client, auth.tenantId, scopedDepartment, window.endsBefore);
  const approvals = await loadApprovals(client, auth.tenantId, scopedDepartment, window.endsBefore, columnSupport);
  const approvalEvents = await loadApprovalEvents(client, auth.tenantId, scopedDepartment, window.startsAt, window.endsBefore);
  const operationalEvents = await loadOperationalEvents(client, auth.tenantId, scopedDepartment, window.startsAt, window.endsBefore, columnSupport);
  const readinessGaps = await loadReadinessGaps(client, auth.tenantId, scopedDepartment, columnSupport);

  const deliveries = await loadOperationalEventDeliveries(
    client,
    auth.tenantId,
    operationalEvents.map((event) => event.id)
  );

  const userIds = [
    ...new Set(
      [
        ...assignments.map((assignment) => assignment.user_id),
        ...tasks.map((task) => task.assigned_to_user_id).filter((value): value is string => Boolean(value)),
        ...productionItems.map((item) => item.assigned_to_user_id).filter((value): value is string => Boolean(value)),
        ...approvals.map((approval) => approval.current_approver_user_id).filter((value): value is string => Boolean(value))
      ].filter((value): value is string => Boolean(value))
    )
  ];
  const users = await loadUserIdentities(client, auth.tenantId, userIds);

  const staffingEfficiency = buildStaffingEfficiencySection(jobs, jobDays, assignments, window);
  const jobCompletionTiming = buildJobCompletionSection(jobs, window);
  const overdueWork = buildOverdueWorkSection(jobs, tasks, productionItems, approvals, window);
  const productionThroughput = buildProductionThroughputSection(productionItems, window);
  const approvalsExceptions = buildApprovalsSection(approvals, approvalEvents, window);
  const notificationEventTrends = buildNotificationEventSection(operationalEvents, deliveries, window);
  const employeeWorkload = buildEmployeeWorkloadSection(assignments, tasks, productionItems, approvals, users, window, workloadLimit);
  const dataReadiness = buildDataReadiness(readinessGaps, scopedDepartment);

  const summaryStrip: ReportingFoundationSummaryCard[] = [
    makeSummaryCard(
      "staffed_job_rate",
      "Staffed Job Rate",
      staffingEfficiency.metrics[1]?.value ?? "0.0%",
      staffingEfficiency.summary_line,
      staffingEfficiency.metrics[1]?.tone ?? "neutral"
    ),
    makeSummaryCard(
      "completed_jobs",
      "Completed Jobs",
      jobCompletionTiming.metrics[0]?.value ?? "0",
      jobCompletionTiming.summary_line,
      jobCompletionTiming.metrics[0]?.tone ?? "neutral"
    ),
    makeSummaryCard(
      "overdue_work",
      "Overdue Work",
      formatValue([overdueWork.metrics[0], overdueWork.metrics[1], overdueWork.metrics[2], overdueWork.metrics[3]].reduce((sum, metric) => sum + Number.parseInt(metric?.value ?? "0", 10), 0)),
      overdueWork.summary_line,
      "action_needed"
    ),
    makeSummaryCard(
      "production_completed",
      "Production Completed",
      productionThroughput.metrics[0]?.value ?? "0",
      productionThroughput.summary_line,
      productionThroughput.metrics[0]?.tone ?? "neutral"
    ),
    makeSummaryCard(
      "approval_volume",
      "Approval Volume",
      approvalsExceptions.metrics[0]?.value ?? "0",
      approvalsExceptions.summary_line,
      approvalsExceptions.metrics[0]?.tone ?? "neutral"
    ),
    makeSummaryCard(
      "event_volume",
      "Operational Events",
      notificationEventTrends.metrics[0]?.value ?? "0",
      notificationEventTrends.summary_line,
      notificationEventTrends.metrics[0]?.tone ?? "neutral"
    ),
    makeSummaryCard(
      "employee_capacity_watch",
      "Capacity Watch",
      employeeWorkload.metrics[1]?.value ?? "0",
      employeeWorkload.summary_line,
      employeeWorkload.metrics[1]?.tone ?? "neutral"
    )
  ];

  const readinessGapCount = Number(readinessGaps.jobs_missing_completed_at ?? 0) + Number(readinessGaps.tasks_missing_completed_at ?? 0);
  const auditDepartmentType = toJobDepartmentType(scopedDepartment);
  const hasResultData =
    jobs.length > 0 ||
    assignments.length > 0 ||
    tasks.length > 0 ||
    productionItems.length > 0 ||
    approvals.length > 0 ||
    approvalEvents.length > 0 ||
    operationalEvents.length > 0 ||
    deliveries.length > 0 ||
    readinessGapCount > 0;

  markRequestContextAsAction();
  await writeAuditEvent(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    eventCategory: "reporting_foundation",
    eventType: "reporting_foundation.generated",
    resourceType: "reporting_foundation_query",
    resourceId: `${input.period}:${input.anchorDate}:${scopedDepartment ?? "all"}`,
    departmentType: auditDepartmentType,
    context: {
      anchor_date: input.anchorDate,
      period: input.period,
      scope_department: scopedDepartment,
      workload_limit: workloadLimit,
      source_counts: {
        jobs: jobs.length,
        assignments: assignments.length,
        tasks: tasks.length,
        production_items: productionItems.length,
        approvals: approvals.length,
        approval_events: approvalEvents.length,
        operational_events: operationalEvents.length,
        operational_event_deliveries: deliveries.length,
        readiness_gaps: readinessGapCount
      }
    },
    result: hasResultData ? "results" : "empty"
  });

  return {
    generated_at: new Date().toISOString(),
    anchor_date: input.anchorDate,
    period: input.period,
    period_label: window.periodLabel,
    scope_department: scopedDepartment,
    data_readiness: dataReadiness,
    summary_strip: summaryStrip,
    staffing_efficiency: staffingEfficiency,
    job_completion_timing: jobCompletionTiming,
    overdue_work: overdueWork,
    production_throughput: productionThroughput,
    approvals_exceptions: approvalsExceptions,
    notification_event_trends: notificationEventTrends,
    employee_workload: employeeWorkload,
    technical_debt: [
      "Historical jobs and tasks that were already complete before Phase 10 may still rely on updated_at or archive fallback timing until they are backfilled precisely.",
      "Department scoping for operational events still depends on source-object inference because department is not first-class on every event row.",
      "Employee workload is blended from upcoming assignments, open tasks, production ownership, and pending approvals; it is not yet a true capacity model with hours or shift duration weighting."
    ]
  };
}
