import type { PoolClient } from "pg";
import { ApiError } from "../../errors/apiError.js";
import type { JobDepartmentType, JobWatchFlagSeverity, JobWatchFlagStatus } from "../../domain/jobTruth/index.js";
import type { AuthUser } from "../../types/auth.js";
import type {
  JobWatchFlagRecord,
  WatchFlagListItem,
  WatchlistResponse,
  WatchlistSavedViewRecord,
  WatchlistSummary
} from "../../types/jobTruth.js";
import { sanitizeWatchFlagItems } from "../policy/index.js";
import { writeJobActivity } from "./activityLogService.js";
import { resolveAlertsForWatchFlag, syncWatchFlagAlertById } from "./alertEventService.js";
import { assertCanManageSharedDepartment, getSharedDepartmentReadScope, getReadableJobDepartments } from "./sharedCommandAccess.js";
import { listWatchlistSavedViews } from "./watchlistSavedViewService.js";

type WatchlistFilters = {
  department_type?: JobDepartmentType | null;
  severity?: JobWatchFlagSeverity | null;
  flag_type?: string | null;
  production_item_ids?: string[] | null;
  owner_user_id?: string | null;
  status?: JobWatchFlagStatus | null;
  source_entity_type?: string | null;
  only_mine?: boolean;
  next_24_hours?: boolean;
  critical_high_only?: boolean;
  only_snoozed?: boolean;
  only_escalated?: boolean;
  view_id?: string | null;
  limit?: number | null;
  run_automation?: boolean;
};

type WatchFlagMutationContext = {
  flag: JobWatchFlagRecord;
  department_type: JobDepartmentType;
  job_number: string | null;
  job_title: string;
  organization_id: string | null;
  organization_name: string | null;
  account_owner_user_id: string | null;
  job_created_by_user_id: string | null;
  is_assigned_to_user: boolean;
};

type RawWatchFlagRow = WatchFlagMutationContext & {
  flag_id: string;
  tenant_id: string;
  job_id: string;
  job_day_id: string | null;
  production_item_id: string | null;
  approval_request_id: string | null;
  qa_review_record_id: string | null;
  deliverable_item_id: string | null;
  source_entity_type: string | null;
  source_entity_id: string | null;
  severity: JobWatchFlagSeverity;
  flag_type: string;
  title: string;
  description: string;
  status: JobWatchFlagStatus;
  owner_user_id: string | null;
  owner_name: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  due_at: string | null;
  snooze_until: string | null;
  escalated_at: string | null;
  escalated_to_role: string | null;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  resolved_by_name: string | null;
  auto_key: string | null;
  created_at: string;
  updated_at: string;
  first_day_date: string | null;
  source_entity_label: string | null;
};

type WatchFlagUpdateInput = {
  owner_user_id?: string | null;
  due_at?: string | null;
  note?: string | null;
};

type WatchFlagResolveInput = WatchFlagUpdateInput & {
  resolution_note?: string | null;
  root_cause?: string | null;
  follow_up_required?: boolean | null;
};

type WatchFlagEscalationInput = WatchFlagUpdateInput & {
  severity?: JobWatchFlagSeverity | null;
  escalated_to_role?: string | null;
};

function normalizeTimestamp(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function coerceBooleanFlag(value: boolean | undefined) {
  return value === true;
}

function watchFlagIsActive(status: JobWatchFlagStatus) {
  return status === "open" || status === "acknowledged" || status === "snoozed";
}

function canReadWatchFlag(auth: AuthUser, row: RawWatchFlagRow) {
  const scope = getSharedDepartmentReadScope(auth, row.department_type);
  if (scope === "all") {
    return true;
  }
  if (scope === "own") {
    return row.account_owner_user_id === auth.id || row.job_created_by_user_id === auth.id || row.is_assigned_to_user;
  }
  return false;
}

function buildSourceEntityLabel(row: RawWatchFlagRow) {
  if (row.source_entity_label) {
    return row.source_entity_label;
  }
  if (row.deliverable_item_id) {
    return "Deliverable";
  }
  if (row.qa_review_record_id) {
    return "QA Review";
  }
  if (row.approval_request_id) {
    return "Approval Request";
  }
  if (row.production_item_id) {
    return "Production Item";
  }
  if (row.job_day_id) {
    return row.first_day_date ? `Job Day ${row.first_day_date}` : "Job Day";
  }
  return "Job";
}

function buildNextActionLabel(row: RawWatchFlagRow) {
  switch (row.flag_type) {
    case "staffing_gap":
      return "Resolve staffing gap";
    case "ready_confirmation_missing":
      return "Confirm lead ready state";
    case "approval_delay":
      return "Follow up on approval";
    case "production_blocked":
      return "Unblock production";
    case "delivery_issue":
      return "Recover delivery";
    case "missing_files":
      return "Confirm file receipt";
    case "production_overdue":
      return "Escalate overdue work";
    case "production_due_soon":
      return "Get release-ready now";
    case "missing_owner":
      return "Assign a production owner";
    case "missing_peer_reviewer":
      return "Assign a peer reviewer";
    case "missing_release_reviewer":
      return "Assign a release reviewer";
    case "release_review_pending":
      return "Complete final release review";
    case "upload_failure":
      return "Retry upload";
    case "stalled_stage":
      return "Advance or unblock the stage";
    case "qa_rework_escalation":
      return "Management rework review";
    case "hold_review_due":
      return "Review the hold decision";
    case "checklist_due_soon":
    case "checklist_due_now":
      return "Finish the required checklist";
    case "checklist_overdue":
      return "Clear the overdue checklist";
    case "checklist_escalation":
      return "Review the escalated checklist";
    default:
      return row.status === "snoozed" ? "Review snoozed follow-up" : "Review and resolve";
  }
}

function severityWeight(severity: JobWatchFlagSeverity) {
  switch (severity) {
    case "critical":
      return 500;
    case "high":
      return 400;
    case "medium":
      return 300;
    case "low":
      return 200;
    default:
      return 100;
  }
}

function buildPriorityRank(row: RawWatchFlagRow) {
  const dueAt = normalizeTimestamp(row.due_at);
  const now = Date.now();
  let rank = severityWeight(row.severity);
  if (row.escalated_at || row.escalated_to_role) {
    rank += 40;
  }
  if (!row.owner_user_id) {
    rank += 25;
  }
  if (row.flag_type === "production_blocked") {
    rank += 22;
  }
  if (dueAt) {
    const distance = new Date(dueAt).getTime() - now;
    if (distance <= 0) {
      rank += 80;
    } else if (distance <= 24 * 60 * 60 * 1000) {
      rank += 55;
    } else if (distance <= 72 * 60 * 60 * 1000) {
      rank += 25;
    }
  }
  if (row.first_day_date && row.first_day_date === new Date().toISOString().slice(0, 10)) {
    rank += 35;
  }
  return rank;
}

function mapRowToItem(row: RawWatchFlagRow): WatchFlagListItem {
  return {
    id: row.flag_id,
    tenant_id: row.tenant_id,
    job_id: row.job_id,
    job_day_id: row.job_day_id,
    production_item_id: row.production_item_id,
    approval_request_id: row.approval_request_id,
    qa_review_record_id: row.qa_review_record_id,
    deliverable_item_id: row.deliverable_item_id,
    source_entity_type: row.source_entity_type,
    source_entity_id: row.source_entity_id,
    severity: row.severity,
    flag_type: row.flag_type,
    title: row.title,
    description: row.description,
    status: row.status,
    owner_user_id: row.owner_user_id,
    created_by_user_id: row.created_by_user_id,
    due_at: row.due_at,
    snooze_until: row.snooze_until,
    escalated_at: row.escalated_at,
    escalated_to_role: row.escalated_to_role,
    resolved_at: row.resolved_at,
    resolved_by_user_id: row.resolved_by_user_id,
    auto_key: row.auto_key,
    created_at: row.created_at,
    updated_at: row.updated_at,
    department_type: row.department_type,
    job_number: row.job_number,
    job_title: row.job_title,
    organization_id: row.organization_id,
    organization_name: row.organization_name,
    owner_name: row.owner_name,
    created_by_name: row.created_by_name,
    resolved_by_name: row.resolved_by_name,
    source_entity_label: buildSourceEntityLabel(row),
    source_scope_label: row.department_type === "schools" ? "Schools" : row.department_type === "sports" ? "Sports" : "Shared",
    next_action_label: buildNextActionLabel(row),
    priority_rank: buildPriorityRank(row)
  };
}

async function maybeApplySavedViewFilters(client: PoolClient, auth: AuthUser, filters: WatchlistFilters) {
  if (!filters.view_id) {
    return filters;
  }
  const { rows } = await client.query<WatchlistSavedViewRecord>(
    `
      SELECT *
      FROM watchlist_saved_views
      WHERE tenant_id = $1
        AND id = $2
        AND (owner_user_id IS NULL OR owner_user_id = $3)
      LIMIT 1
    `,
    [auth.tenantId, filters.view_id, auth.id]
  );
  if (!rows.length) {
    return filters;
  }
  return { ...(rows[0].filters_json as WatchlistFilters), ...filters, view_id: filters.view_id };
}

async function loadRawWatchFlags(client: PoolClient, auth: AuthUser, filters: WatchlistFilters): Promise<RawWatchFlagRow[]> {
  const resolvedFilters = await maybeApplySavedViewFilters(client, auth, filters);
  const readableDepartments = getReadableJobDepartments(auth);
  if (readableDepartments.length === 0) {
    return [];
  }
  if (resolvedFilters.department_type && !readableDepartments.includes(resolvedFilters.department_type)) {
    throw new ApiError(403, "Forbidden");
  }

  const { rows } = await client.query<RawWatchFlagRow>(
    `
      SELECT
        flag.id::text AS flag_id,
        flag.tenant_id,
        flag.job_id::text AS job_id,
        flag.job_day_id::text AS job_day_id,
        flag.production_item_id::text AS production_item_id,
        flag.approval_request_id::text AS approval_request_id,
        flag.qa_review_record_id::text AS qa_review_record_id,
        flag.deliverable_item_id::text AS deliverable_item_id,
        flag.source_entity_type,
        flag.source_entity_id::text AS source_entity_id,
        flag.severity::text AS severity,
        flag.flag_type,
        flag.title,
        flag.description,
        flag.status::text AS status,
        flag.owner_user_id::text AS owner_user_id,
        owner.full_name AS owner_name,
        flag.created_by_user_id::text AS created_by_user_id,
        creator.full_name AS created_by_name,
        flag.due_at,
        flag.snooze_until,
        flag.escalated_at,
        flag.escalated_to_role,
        flag.resolved_at,
        flag.resolved_by_user_id::text AS resolved_by_user_id,
        resolver.full_name AS resolved_by_name,
        flag.auto_key,
        flag.created_at,
        flag.updated_at,
        job.department_type::text AS department_type,
        job.job_number,
        COALESCE(NULLIF(job.event_name, ''), job.title) AS job_title,
        job.organization_id::text AS organization_id,
        org.display_name AS organization_name,
        job.account_owner_user_id::text AS account_owner_user_id,
        job.created_by_user_id::text AS job_created_by_user_id,
        EXISTS(
          SELECT 1
          FROM job_staff_assignments assignment
          WHERE assignment.tenant_id = job.tenant_id
            AND assignment.job_id = job.id
            AND assignment.user_id = $2
            AND assignment.assignment_status <> 'cancelled'
        ) AS is_assigned_to_user,
        (
          SELECT min(day.date)::text
          FROM job_days day
          WHERE day.tenant_id = job.tenant_id
            AND day.job_id = job.id
        ) AS first_day_date,
        COALESCE(
          CASE WHEN flag.job_day_id IS NOT NULL THEN day.day_label END,
          CASE WHEN flag.production_item_id IS NOT NULL THEN item.title END,
          CASE WHEN flag.approval_request_id IS NOT NULL THEN approval.summary END,
          CASE WHEN flag.qa_review_record_id IS NOT NULL THEN review.review_stage END,
          CASE WHEN flag.deliverable_item_id IS NOT NULL THEN deliverable.title END,
          NULL
        ) AS source_entity_label
      FROM job_watch_flags flag
      JOIN jobs job
        ON job.id = flag.job_id
       AND job.tenant_id = flag.tenant_id
      LEFT JOIN organization org
        ON org.id = job.organization_id
       AND org.tenant_id = job.tenant_id
      LEFT JOIN app_user owner
        ON owner.id = flag.owner_user_id
       AND owner.tenant_id = flag.tenant_id
      LEFT JOIN app_user creator
        ON creator.id = flag.created_by_user_id
       AND creator.tenant_id = flag.tenant_id
      LEFT JOIN app_user resolver
        ON resolver.id = flag.resolved_by_user_id
       AND resolver.tenant_id = flag.tenant_id
      LEFT JOIN job_days day
        ON day.id = flag.job_day_id
       AND day.tenant_id = flag.tenant_id
      LEFT JOIN production_items item
        ON item.id = flag.production_item_id
       AND item.tenant_id = flag.tenant_id
      LEFT JOIN approval_requests approval
        ON approval.id = flag.approval_request_id
       AND approval.tenant_id = flag.tenant_id
      LEFT JOIN qa_review_records review
        ON review.id = flag.qa_review_record_id
       AND review.tenant_id = flag.tenant_id
      LEFT JOIN deliverable_items deliverable
        ON deliverable.id = flag.deliverable_item_id
       AND deliverable.tenant_id = flag.tenant_id
      WHERE flag.tenant_id = $1
        AND job.department_type::text = ANY($3::text[])
        AND ($4::text IS NULL OR job.department_type::text = $4::text)
        AND ($5::text IS NULL OR flag.severity::text = $5::text)
        AND ($6::text IS NULL OR flag.flag_type = $6::text)
        AND ($7::uuid IS NULL OR flag.owner_user_id = $7::uuid)
        AND ($8::text IS NULL OR flag.status::text = $8::text)
        AND ($9::text IS NULL OR flag.source_entity_type = $9::text)
        AND ($10::uuid[] IS NULL OR flag.production_item_id = ANY($10::uuid[]))
      ORDER BY flag.updated_at DESC, flag.created_at DESC
      LIMIT $11
    `,
    [
      auth.tenantId,
      auth.id,
      readableDepartments,
      resolvedFilters.department_type ?? null,
      resolvedFilters.severity ?? null,
      resolvedFilters.flag_type ?? null,
      resolvedFilters.owner_user_id ?? null,
      resolvedFilters.status ?? null,
      resolvedFilters.source_entity_type ?? null,
      resolvedFilters.production_item_ids?.length ? resolvedFilters.production_item_ids : null,
      resolvedFilters.limit ?? 250
    ]
  );

  return rows
    .filter((row) => resolvedFilters.status != null || watchFlagIsActive(row.status))
    .filter((row) => canReadWatchFlag(auth, row))
    .filter((row) => !coerceBooleanFlag(resolvedFilters.only_mine) || row.owner_user_id === auth.id)
    .filter((row) => !coerceBooleanFlag(resolvedFilters.next_24_hours) || (row.due_at ? new Date(row.due_at).getTime() <= Date.now() + 24 * 60 * 60 * 1000 : false))
    .filter((row) => !coerceBooleanFlag(resolvedFilters.critical_high_only) || row.severity === "critical" || row.severity === "high")
    .filter((row) => !coerceBooleanFlag(resolvedFilters.only_snoozed) || row.status === "snoozed")
    .filter((row) => !coerceBooleanFlag(resolvedFilters.only_escalated) || Boolean(row.escalated_at || row.escalated_to_role));
}

function summarizeWatchFlags(items: WatchFlagListItem[]): WatchlistSummary {
  return {
    total_count: items.length,
    critical_count: items.filter((item) => item.severity === "critical" && watchFlagIsActive(item.status)).length,
    high_count: items.filter((item) => item.severity === "high" && watchFlagIsActive(item.status)).length,
    snoozed_count: items.filter((item) => item.status === "snoozed").length,
    ownerless_count: items.filter((item) => !item.owner_user_id && watchFlagIsActive(item.status)).length,
    next_24_hours_count: items.filter((item) => {
      const dueAt = normalizeTimestamp(item.due_at);
      return dueAt ? new Date(dueAt).getTime() <= Date.now() + 24 * 60 * 60 * 1000 && watchFlagIsActive(item.status) : false;
    }).length
  };
}

async function loadWatchFlagContext(client: PoolClient, auth: AuthUser, flagId: string) {
  const readableDepartments = getReadableJobDepartments(auth);
  if (readableDepartments.length === 0) {
    throw new ApiError(404, "Watch flag not found");
  }
  const { rows } = await client.query<RawWatchFlagRow>(
    `
      SELECT
        flag.id::text AS flag_id,
        flag.tenant_id,
        flag.job_id::text AS job_id,
        flag.job_day_id::text AS job_day_id,
        flag.production_item_id::text AS production_item_id,
        flag.approval_request_id::text AS approval_request_id,
        flag.qa_review_record_id::text AS qa_review_record_id,
        flag.deliverable_item_id::text AS deliverable_item_id,
        flag.source_entity_type,
        flag.source_entity_id::text AS source_entity_id,
        flag.severity::text AS severity,
        flag.flag_type,
        flag.title,
        flag.description,
        flag.status::text AS status,
        flag.owner_user_id::text AS owner_user_id,
        owner.full_name AS owner_name,
        flag.created_by_user_id::text AS created_by_user_id,
        creator.full_name AS created_by_name,
        flag.due_at,
        flag.snooze_until,
        flag.escalated_at,
        flag.escalated_to_role,
        flag.resolved_at,
        flag.resolved_by_user_id::text AS resolved_by_user_id,
        resolver.full_name AS resolved_by_name,
        flag.auto_key,
        flag.created_at,
        flag.updated_at,
        COALESCE(job.department_type, 'other'::job_department_type)::text AS department_type,
        job.job_number,
        COALESCE(job.title, flag.title) AS job_title,
        job.organization_id::text AS organization_id,
        org.display_name AS organization_name,
        job.account_owner_user_id::text AS account_owner_user_id,
        job.created_by_user_id::text AS job_created_by_user_id,
        EXISTS(
          SELECT 1
          FROM job_staff_assignments assignment
          WHERE assignment.tenant_id = flag.tenant_id
            AND assignment.job_id = flag.job_id
            AND assignment.user_id = $2
            AND assignment.assignment_status <> 'cancelled'
        ) AS is_assigned_to_user,
        (
          SELECT min(day.date)::text
          FROM job_days day
          WHERE day.tenant_id = flag.tenant_id
            AND day.job_id = flag.job_id
        ) AS first_day_date,
        CASE
          WHEN flag.deliverable_item_id IS NOT NULL THEN deliverable.title
          WHEN flag.qa_review_record_id IS NOT NULL THEN concat('QA ', COALESCE(review.review_type, 'review'))
          WHEN flag.approval_request_id IS NOT NULL THEN concat('Approval ', COALESCE(approval.approval_type, 'request'))
          WHEN flag.production_item_id IS NOT NULL THEN production.title
          ELSE job.title
        END AS source_entity_label
      FROM job_watch_flags flag
      LEFT JOIN jobs job
        ON job.id = flag.job_id
       AND job.tenant_id = flag.tenant_id
      LEFT JOIN organization org
        ON org.id = job.organization_id
       AND org.tenant_id = flag.tenant_id
      LEFT JOIN app_user owner
        ON owner.id = flag.owner_user_id
       AND owner.tenant_id = flag.tenant_id
      LEFT JOIN app_user creator
        ON creator.id = flag.created_by_user_id
       AND creator.tenant_id = flag.tenant_id
      LEFT JOIN app_user resolver
        ON resolver.id = flag.resolved_by_user_id
       AND resolver.tenant_id = flag.tenant_id
      LEFT JOIN production_items production
        ON production.id = flag.production_item_id
       AND production.tenant_id = flag.tenant_id
      LEFT JOIN approval_requests approval
        ON approval.id = flag.approval_request_id
       AND approval.tenant_id = flag.tenant_id
      LEFT JOIN qa_review_records review
        ON review.id = flag.qa_review_record_id
       AND review.tenant_id = flag.tenant_id
      LEFT JOIN deliverable_items deliverable
        ON deliverable.id = flag.deliverable_item_id
       AND deliverable.tenant_id = flag.tenant_id
      WHERE flag.tenant_id = $1
        AND flag.id = $3::uuid
      LIMIT 1
    `,
    [auth.tenantId, auth.id, flagId]
  );
  const match = rows[0];
  if (!match || !readableDepartments.includes(match.department_type)) {
    throw new ApiError(404, "Watch flag not found");
  }
  return {
    ...match,
    flag: {
      id: match.flag_id,
      tenant_id: match.tenant_id,
      job_id: match.job_id,
      job_day_id: match.job_day_id,
      production_item_id: match.production_item_id,
      approval_request_id: match.approval_request_id,
      qa_review_record_id: match.qa_review_record_id,
      deliverable_item_id: match.deliverable_item_id,
      source_entity_type: match.source_entity_type,
      source_entity_id: match.source_entity_id,
      severity: match.severity,
      flag_type: match.flag_type,
      title: match.title,
      description: match.description,
      status: match.status,
      owner_user_id: match.owner_user_id,
      created_by_user_id: match.created_by_user_id,
      due_at: match.due_at,
      snooze_until: match.snooze_until,
      escalated_at: match.escalated_at,
      escalated_to_role: match.escalated_to_role,
      resolved_at: match.resolved_at,
      resolved_by_user_id: match.resolved_by_user_id,
      auto_key: match.auto_key,
      created_at: match.created_at,
      updated_at: match.updated_at
    }
  };
}

async function updateWatchFlagStatus(
  client: PoolClient,
  auth: AuthUser,
  flagId: string,
  nextStatus: JobWatchFlagStatus,
  summary: string,
  metadata: Record<string, unknown> = {},
  snoozeUntil: string | null = null
) {
  const context = await loadWatchFlagContext(client, auth, flagId);
  if (nextStatus === "acknowledged") {
    if (!canReadWatchFlag(auth, context)) {
      throw new ApiError(403, "Forbidden");
    }
  } else {
    assertCanManageSharedDepartment(auth, context.department_type);
  }

  const { rows } = await client.query<{ id: string }>(
    `
      UPDATE job_watch_flags
      SET status = $3::job_watch_flag_status_type,
          snooze_until = CASE WHEN $3 = 'snoozed'::job_watch_flag_status_type THEN $5::timestamptz ELSE NULL END,
          resolved_at = CASE WHEN $3 = 'resolved'::job_watch_flag_status_type OR $3 = 'dismissed'::job_watch_flag_status_type THEN now() ELSE NULL END,
          resolved_by_user_id = CASE
            WHEN $3 = 'resolved'::job_watch_flag_status_type OR $3 = 'dismissed'::job_watch_flag_status_type
            THEN $4::uuid
            ELSE NULL
          END,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING id::text AS id
    `,
    [auth.tenantId, flagId, nextStatus, auth.id, snoozeUntil]
  );
  if (!rows.length) {
    throw new ApiError(404, "Watch flag not found");
  }

  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId: context.job_id,
    jobDayId: context.job_day_id,
    productionItemId: context.production_item_id,
    watchFlagId: flagId,
    eventType: nextStatus === "acknowledged" ? "watch_flag_acknowledged" : nextStatus === "snoozed" ? "watch_flag_snoozed" : nextStatus === "dismissed" ? "watch_flag_dismissed" : "watch_flag_resolved",
    summary,
    metadata
  });

  if (nextStatus === "resolved" || nextStatus === "dismissed") {
    await resolveAlertsForWatchFlag(client, auth.tenantId, flagId);
  } else {
    await syncWatchFlagAlertById(client, auth.tenantId, flagId, auth.id, nextStatus === "acknowledged" ? "updated" : "updated");
  }
}

export async function listWatchFlags(client: PoolClient, auth: AuthUser, filters: WatchlistFilters = {}): Promise<WatchlistResponse> {
  const rows = await loadRawWatchFlags(client, auth, filters);
  const items = rows
    .map(mapRowToItem)
    .sort((left, right) => right.priority_rank - left.priority_rank || String(right.updated_at).localeCompare(String(left.updated_at)));
  const sanitizedItems = await sanitizeWatchFlagItems(client, auth, items);

  return {
    items: sanitizedItems,
    summary: summarizeWatchFlags(sanitizedItems),
    saved_views: await listWatchlistSavedViews(client, auth, filters.department_type ?? null)
  };
}

export async function acknowledgeWatchFlag(client: PoolClient, auth: AuthUser, flagId: string) {
  await updateWatchFlagStatus(client, auth, flagId, "acknowledged", "Acknowledged watch flag");
}

export async function snoozeWatchFlag(client: PoolClient, auth: AuthUser, flagId: string, snoozeUntil: string, note?: string | null) {
  await updateWatchFlagStatus(
    client,
    auth,
    flagId,
    "snoozed",
    "Snoozed watch flag",
    { note: note ?? null, snooze_until: snoozeUntil },
    snoozeUntil
  );
}

export async function resolveWatchFlag(client: PoolClient, auth: AuthUser, flagId: string, input: WatchFlagResolveInput) {
  await updateWatchFlagStatus(client, auth, flagId, "resolved", "Resolved watch flag", {
    resolution_note: input.resolution_note ?? input.note ?? null,
    root_cause: input.root_cause ?? null,
    follow_up_required: input.follow_up_required ?? false
  });
}

export async function dismissWatchFlag(client: PoolClient, auth: AuthUser, flagId: string, reason: string) {
  await updateWatchFlagStatus(client, auth, flagId, "dismissed", "Dismissed watch flag", { reason });
}

export async function escalateWatchFlag(client: PoolClient, auth: AuthUser, flagId: string, input: WatchFlagEscalationInput) {
  const context = await loadWatchFlagContext(client, auth, flagId);
  assertCanManageSharedDepartment(auth, context.department_type);
  const severity = input.severity ?? context.severity;
  await client.query(
    `
      UPDATE job_watch_flags
      SET severity = $3::job_watch_flag_severity_type,
          owner_user_id = COALESCE($4::uuid, owner_user_id),
          due_at = COALESCE($5::timestamptz, due_at),
          escalated_at = now(),
          escalated_to_role = COALESCE($6, escalated_to_role),
          status = CASE
            WHEN status IN ('resolved'::job_watch_flag_status_type, 'dismissed'::job_watch_flag_status_type)
            THEN 'open'::job_watch_flag_status_type
            ELSE status
          END,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, flagId, severity, input.owner_user_id ?? null, input.due_at ?? null, input.escalated_to_role ?? null]
  );
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId: context.job_id,
    jobDayId: context.job_day_id,
    productionItemId: context.production_item_id,
    watchFlagId: flagId,
    eventType: "watch_flag_escalated",
    summary: "Escalated watch flag",
    metadata: {
      severity,
      owner_user_id: input.owner_user_id ?? context.owner_user_id,
      escalated_to_role: input.escalated_to_role ?? null,
      note: input.note ?? null
    }
  });
  await syncWatchFlagAlertById(client, auth.tenantId, flagId, auth.id, "escalated");
}
