import type { PoolClient } from "pg";
import type {
  JobDepartmentType,
  JobQaReviewStatus,
  ProductionBoardHealthState,
  ProductionBoardWorkflowStatus
} from "../../domain/jobTruth/index.js";
import type { AuthUser } from "../../types/auth.js";
import type {
  DashboardProductionSnapshot,
  ProductionAccountBurdenItem,
  ProductionDepartmentBacklogItem,
  ProductionDelaySignalItem,
  ProductionManagementExceptionItem,
  ProductionOwnerBacklogItem,
  ProductionQaFailureCategoryItem,
  ProductionQaPerformanceItem,
  ProductionQueueItem,
  ProductionReportingResponse,
  ProductionRestrictedOverlayCard,
  ProductionTopPerformerItem,
  ProductionTrendBucket,
  ProductionUrgentWatchSummary
} from "../../types/jobTruth.js";
import type { OperationalProductionReportingSection } from "../../types/operationalReporting.js";
import { canSharedPolicy } from "../policy/policyEngine.js";
import { listProductionQueue } from "./jobService.js";
import {
  buildProductionManagementExceptionItems,
  listProductionFlagsForItems,
  summarizeUrgentFlags
} from "./productionBoardWatchService.js";
import { canAccessExecutiveCommandLayer } from "./sharedCommandAccess.js";

type ReportingContext = {
  items: ProductionQueueItem[];
  qaRows: QaAnalyticsRow[];
  accountOwnerNames: Map<string, string>;
};

type ReportingDerivedMetrics = {
  ownerBacklog: ProductionOwnerBacklogItem[];
  departmentBacklog: ProductionDepartmentBacklogItem[];
  qaPerformance: ProductionQaPerformanceItem[];
  qaFailureCategories: ProductionQaFailureCategoryItem[];
  accountBurden: ProductionAccountBurdenItem[];
  organizationRisk: ProductionReportingResponse["insights"]["repeat_problem_organizations"];
  delaySignals: ProductionDelaySignalItem[];
  topPerformers: ProductionTopPerformerItem[];
};

type QaAnalyticsRow = {
  production_item_id: string;
  reviewer_user_id: string | null;
  reviewer_name: string | null;
  review_stage: string;
  status: JobQaReviewStatus;
  issue_category: string | null;
  created_at: string;
  reviewed_at: string | null;
  accountable_reviewer_user_id: string | null;
};

type TrendWindowBucket = {
  key: string;
  label: string;
  startsAt: Date;
  endsBefore: Date;
};

type ProductionReportingOptions = {
  department_type?: JobDepartmentType | null;
  status?: ProductionQueueItem["status"] | null;
  workflow_status?: ProductionBoardWorkflowStatus | null;
  health_state?: ProductionBoardHealthState | null;
  approval_status?: ProductionQueueItem["approval_status"] | null;
  qa_status?: JobQaReviewStatus | null;
  assigned_to_user_id?: string | null;
  blocked?: "yes" | "no" | null;
  priority?: ProductionQueueItem["priority"] | null;
  due_bucket?: "today" | "overdue" | "next-7" | null;
  search?: string | null;
  deliverable_type?: string | null;
  organization_id?: string | null;
  release_status?: ProductionQueueItem["release_status"] | null;
  checklist_state?: "overdue" | "awaiting_approval" | "rejected" | "blocked" | null;
  due_window?: "all" | "today" | "overdue" | "next_3" | "next_7" | "closed_last_7_days" | null;
  now?: Date;
};

type ProductionOperationalSectionOptions = {
  department_type?: JobDepartmentType | null;
  anchorDate: string;
  periodLabel: string;
  buckets: Array<{
    key: string;
    label: string;
    startsAt: Date;
    endsBefore: Date;
    starts_at: string;
    ends_before: string;
  }>;
  startsAt: Date;
  endsBefore: Date;
};

const CLOSED_WORKFLOW_STATUSES = new Set<ProductionBoardWorkflowStatus>(["DELIVERED_CLOSED", "CANCELLED"]);
const BLOCKED_HEALTH_STATES = new Set<ProductionBoardHealthState>(["BLOCKED", "OVERDUE", "AT_RISK"]);
const PASS_REVIEW_STATUSES = new Set<JobQaReviewStatus>(["passed", "passed_with_notes", "complete"]);
const FAIL_REVIEW_STATUSES = new Set<JobQaReviewStatus>(["failed", "rework_in_progress", "recheck_required"]);

function roundMetric(value: number, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  if (!values.length) {
    return null;
  }
  return roundMetric(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentage(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return 0;
  }
  return roundMetric((numerator / denominator) * 100);
}

function humanizeLabel(value: string | null | undefined) {
  if (!value) {
    return "Unknown";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (token) => token.toUpperCase());
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function utcDateKey(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function differenceInDays(start: string | Date | null | undefined, end: string | Date | null | undefined) {
  if (!start || !end) {
    return null;
  }
  const startDate = start instanceof Date ? start : new Date(start);
  const endDate = end instanceof Date ? end : new Date(end);
  return roundMetric((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
}

function isClosedItem(item: ProductionQueueItem) {
  return CLOSED_WORKFLOW_STATUSES.has(item.workflow_status) || Boolean(item.closed_at);
}

function isOpenItem(item: ProductionQueueItem) {
  return !isClosedItem(item);
}

function isBlockedItem(item: ProductionQueueItem) {
  return item.health_state === "BLOCKED" || item.status === "blocked" || item.blocking_issue_count > 0 || item.open_blocker_count > 0 || Boolean(item.blocked_reason);
}

function isAtRiskItem(item: ProductionQueueItem) {
  return BLOCKED_HEALTH_STATES.has(item.health_state) || item.overdue_flag;
}

function isFileMismatch(item: ProductionQueueItem) {
  return ["MISMATCH", "PARTIAL", "MISSING", "EXTRA_FILES"].includes(item.file_match_status);
}

function isVendorItem(item: ProductionQueueItem) {
  return Boolean(item.vendor_name) || item.release_status === "SENT_TO_VENDOR" || item.workflow_status === "SENT_TO_VENDOR";
}

function isWithinRange(value: string | Date | null | undefined, startsAt: Date, endsBefore: Date) {
  if (!value) {
    return false;
  }
  const timestamp = (value instanceof Date ? value : new Date(value)).getTime();
  return timestamp >= startsAt.getTime() && timestamp < endsBefore.getTime();
}

function buildDefaultDayBuckets(now: Date) {
  const anchor = startOfUtcDay(now);
  return Array.from({ length: 14 }, (_, index): TrendWindowBucket => {
    const startsAt = addUtcDays(anchor, -(13 - index));
    const endsBefore = addUtcDays(startsAt, 1);
    return {
      key: startsAt.toISOString().slice(0, 10),
      label: startsAt.toISOString().slice(5, 10),
      startsAt,
      endsBefore
    };
  });
}

function buildDefaultWeekBuckets(now: Date) {
  const anchor = startOfUtcDay(now);
  return Array.from({ length: 8 }, (_, index): TrendWindowBucket => {
    const startsAt = addUtcDays(anchor, -((7 - index) * 7));
    const endsBefore = addUtcDays(startsAt, 7);
    return {
      key: `week_${startsAt.toISOString().slice(0, 10)}`,
      label: `${startsAt.toISOString().slice(5, 10)}-${addUtcDays(endsBefore, -1).toISOString().slice(5, 10)}`,
      startsAt,
      endsBefore
    };
  });
}

async function loadQaRows(client: PoolClient, tenantId: string, productionItemIds: string[]) {
  if (!productionItemIds.length) {
    return [] as QaAnalyticsRow[];
  }
  const { rows } = await client.query<QaAnalyticsRow>(
    `
      SELECT
        review.production_item_id::text AS production_item_id,
        review.reviewer_user_id::text AS reviewer_user_id,
        reviewer.full_name AS reviewer_name,
        review.review_stage,
        review.status::text AS status,
        review.issue_category,
        review.created_at::text AS created_at,
        review.reviewed_at::text AS reviewed_at,
        review.accountable_reviewer_user_id::text AS accountable_reviewer_user_id
      FROM qa_review_records review
      LEFT JOIN app_user reviewer
        ON reviewer.tenant_id = review.tenant_id
       AND reviewer.id = review.reviewer_user_id
      WHERE review.tenant_id = $1
        AND review.production_item_id = ANY($2::uuid[])
      ORDER BY review.created_at DESC
    `,
    [tenantId, productionItemIds]
  );
  return rows;
}

async function loadAccountOwnerNames(client: PoolClient, tenantId: string, ownerIds: string[]) {
  if (!ownerIds.length) {
    return new Map<string, string>();
  }
  const { rows } = await client.query<{ id: string; full_name: string | null }>(
    `
      SELECT
        id::text AS id,
        full_name
      FROM app_user
      WHERE tenant_id = $1
        AND id = ANY($2::uuid[])
    `,
    [tenantId, ownerIds]
  );
  return new Map(rows.map((row) => [row.id, row.full_name ?? "Unknown owner"]));
}

async function loadReportingContext(
  client: PoolClient,
  auth: AuthUser,
  options: Omit<ProductionReportingOptions, "due_window" | "now"> = {}
) {
  const queue = await listProductionQueue(client, auth, {
    department_type: options.department_type ?? null,
    status: options.status ?? null,
    workflow_status: options.workflow_status ?? null,
    health_state: options.health_state ?? null,
    approval_status: options.approval_status ?? null,
    qa_status: options.qa_status ?? null,
    assigned_to_user_id: options.assigned_to_user_id ?? null,
    blocked: options.blocked ?? null,
    priority: options.priority ?? null,
    due_bucket: options.due_bucket ?? null,
    search: options.search ?? null,
    deliverable_type: options.deliverable_type ?? null,
    organization_id: options.organization_id ?? null,
    release_status: options.release_status ?? null,
    checklist_state: options.checklist_state ?? null,
    run_automation: false
  });
  const qaRows = await loadQaRows(client, auth.tenantId, queue.items.map((item) => item.id));
  const accountOwnerNames = await loadAccountOwnerNames(
    client,
    auth.tenantId,
    [...new Set(queue.items.map((item) => item.account_owner_user_id).filter((value): value is string => Boolean(value)))]
  );
  return {
    items: queue.items,
    qaRows,
    accountOwnerNames
  } satisfies ReportingContext;
}

function matchesReportingDueWindow(item: ProductionQueueItem, dueWindow: ProductionReportingOptions["due_window"], now: Date) {
  if (!dueWindow || dueWindow === "all") {
    return true;
  }
  const dueTime = item.due_at ? new Date(item.due_at).getTime() : null;
  const closedTime = item.closed_at ? new Date(item.closed_at).getTime() : null;
  if (dueWindow === "today") {
    return Boolean(item.due_at && utcDateKey(item.due_at) === utcDateKey(now));
  }
  if (dueWindow === "overdue") {
    return Boolean(item.overdue_flag || (dueTime != null && dueTime < now.getTime() && !isClosedItem(item)));
  }
  if (dueWindow === "next_3") {
    return Boolean(dueTime != null && dueTime >= now.getTime() && dueTime - now.getTime() <= 3 * 24 * 60 * 60 * 1000);
  }
  if (dueWindow === "next_7") {
    return Boolean(dueTime != null && dueTime >= now.getTime() && dueTime - now.getTime() <= 7 * 24 * 60 * 60 * 1000);
  }
  if (dueWindow === "closed_last_7_days") {
    return Boolean(closedTime != null && now.getTime() - closedTime <= 7 * 24 * 60 * 60 * 1000);
  }
  return true;
}

function buildTrendBuckets(items: ProductionQueueItem[], qaRows: QaAnalyticsRow[], buckets: TrendWindowBucket[]): ProductionTrendBucket[] {
  return buckets.map((bucket) => {
    const completions = items.filter((item) => isWithinRange(item.closed_at ?? item.completed_at, bucket.startsAt, bucket.endsBefore)).length;
    const releases = items.filter((item) => {
      if (!["READY_FOR_RELEASE", "RELEASED", "SENT_TO_VENDOR", "DELIVERED", "CLOSED"].includes(item.release_status)) {
        return false;
      }
      return isWithinRange(item.closed_at ?? item.completed_at ?? item.updated_at, bucket.startsAt, bucket.endsBefore);
    }).length;
    const overdue = items.filter((item) => {
      if (!item.due_at) {
        return false;
      }
      const dueAt = new Date(item.due_at);
      if (dueAt.getTime() < bucket.startsAt.getTime() || dueAt.getTime() >= bucket.endsBefore.getTime()) {
        return false;
      }
      const closeAt = item.closed_at ? new Date(item.closed_at) : item.completed_at ? new Date(item.completed_at) : null;
      return !closeAt || closeAt.getTime() > dueAt.getTime();
    }).length;
    const blocked = items.filter((item) => isBlockedItem(item) && isWithinRange(item.updated_at, bucket.startsAt, bucket.endsBefore)).length;
    const rework = qaRows.filter((row) => FAIL_REVIEW_STATUSES.has(row.status) && isWithinRange(row.created_at, bucket.startsAt, bucket.endsBefore)).length;
    return {
      key: bucket.key,
      label: bucket.label,
      starts_at: bucket.startsAt.toISOString(),
      ends_before: bucket.endsBefore.toISOString(),
      completions,
      releases,
      overdue,
      blocked,
      rework
    };
  });
}

export function buildDashboardProductionSnapshot(summary: ProductionReportingResponse["summary"]): DashboardProductionSnapshot {
  return {
    open_items: summary.total_open_items,
    overdue_items: summary.overdue_items,
    blocked_items: summary.blocked_items,
    due_this_week: summary.due_this_week,
    average_turnaround_days: summary.average_turnaround_days,
    on_time_release_percentage: summary.on_time_release_percentage,
    rework_rate: summary.rework_rate,
    first_pass_approval_rate: summary.first_pass_approval_rate
  };
}

function buildSummary(items: ProductionQueueItem[], now: Date): ProductionReportingResponse["summary"] {
  const todayStart = startOfUtcDay(now);
  const tomorrowStart = addUtcDays(todayStart, 1);
  const weekEnd = addUtcDays(todayStart, 8);
  const weekStart = addUtcDays(todayStart, -6);
  const openItems = items.filter(isOpenItem);
  const completedItems = items.filter((item) => isClosedItem(item) && item.turnaround_days != null);
  const onTimePool = items.filter((item) => item.on_time_flag != null);
  const qaRelevantItems = items.filter(
    (item) => item.qa_required || item.peer_review_complete || item.final_release_review_complete || item.rework_count > 0 || item.qa_fail_count > 0
  );
  const uploadRelevant = items.filter((item) => ["READY", "UPLOADING", "UPLOADED", "VERIFIED", "FAILED"].includes(item.upload_status));
  const vendorCompleted = items.filter((item) => isVendorItem(item) && isClosedItem(item));

  return {
    total_open_items: openItems.length,
    overdue_items: openItems.filter((item) => item.overdue_flag || item.health_state === "OVERDUE").length,
    blocked_items: openItems.filter(isBlockedItem).length,
    due_today: openItems.filter((item) => item.due_at && new Date(item.due_at).getTime() >= todayStart.getTime() && new Date(item.due_at).getTime() < tomorrowStart.getTime()).length,
    due_this_week: openItems.filter((item) => item.due_at && new Date(item.due_at).getTime() >= todayStart.getTime() && new Date(item.due_at).getTime() < weekEnd.getTime()).length,
    average_turnaround_days: average(completedItems.map((item) => item.turnaround_days!).filter((value) => value >= 0)),
    on_time_release_percentage: onTimePool.length ? percentage(onTimePool.filter((item) => item.on_time_flag).length, onTimePool.length) : null,
    average_stage_duration_days: average(openItems.map((item) => item.stage_age).filter((value) => Number.isFinite(value))),
    rework_rate: percentage(items.filter((item) => item.rework_count > 0).length, Math.max(items.length, 1)),
    first_pass_approval_rate: qaRelevantItems.length ? percentage(qaRelevantItems.filter((item) => item.first_pass_approved).length, qaRelevantItems.length) : null,
    file_mismatch_rate: percentage(
      items.filter(isFileMismatch).length,
      Math.max(items.filter((item) => item.file_count_expected != null || item.file_count_received != null).length, 1)
    ),
    upload_failure_rate: percentage(uploadRelevant.filter((item) => item.upload_status === "FAILED").length, Math.max(uploadRelevant.length, 1)),
    vendor_turnaround_days: average(
      vendorCompleted
        .map((item) => differenceInDays(item.production_start_at ?? item.created_at, item.closed_at ?? item.completed_at))
        .filter((value): value is number => value != null)
    ),
    completion_volume_this_week: items.filter((item) => isWithinRange(item.closed_at ?? item.completed_at, weekStart, tomorrowStart)).length,
    ready_for_qa_count: openItems.filter((item) => item.workflow_status === "READY_FOR_QA").length,
    ready_for_release_count: openItems.filter((item) => item.workflow_status === "READY_FOR_RELEASE").length,
    awaiting_files_count: openItems.filter((item) => item.workflow_status === "WAITING_ON_FILES").length,
    awaiting_upload_count: openItems.filter((item) => item.workflow_status === "READY_FOR_UPLOAD" || item.workflow_status === "UPLOADING").length,
    vendor_pending_count: openItems.filter((item) => isVendorItem(item) && ["READY_FOR_RELEASE", "RELEASED", "SENT_TO_VENDOR"].includes(item.workflow_status)).length
  };
}

function buildOwnerBacklogItems(items: ProductionQueueItem[]): ProductionOwnerBacklogItem[] {
  const groups = new Map<string | null, ProductionOwnerBacklogItem & { stageAges: number[] }>();
  const openItems = items.filter(isOpenItem);
  const total = openItems.length || 1;

  for (const item of openItems) {
    const key = item.assigned_to_user_id ?? null;
    const current = groups.get(key) ?? {
      owner_user_id: key,
      owner_name: item.assigned_to_name ?? "Unassigned",
      open_count: 0,
      blocked_count: 0,
      overdue_count: 0,
      due_this_week_count: 0,
      ready_for_qa_count: 0,
      ready_for_release_count: 0,
      average_stage_age_days: null,
      work_share_percent: 0,
      load_score: 0,
      stageAges: []
    };
    current.open_count += 1;
    current.blocked_count += isBlockedItem(item) ? 1 : 0;
    current.overdue_count += item.overdue_flag || item.health_state === "OVERDUE" ? 1 : 0;
    current.due_this_week_count += item.days_to_due != null && item.days_to_due >= 0 && item.days_to_due <= 7 ? 1 : 0;
    current.ready_for_qa_count += item.workflow_status === "READY_FOR_QA" ? 1 : 0;
    current.ready_for_release_count += item.workflow_status === "READY_FOR_RELEASE" ? 1 : 0;
    current.stageAges.push(item.stage_age);
    groups.set(key, current);
  }

  return [...groups.values()]
    .map(({ stageAges, ...item }) => ({
      ...item,
      average_stage_age_days: average(stageAges),
      work_share_percent: percentage(item.open_count, total),
      load_score: item.open_count * 4 + item.blocked_count * 8 + item.overdue_count * 6 + item.ready_for_qa_count * 3 + item.ready_for_release_count * 3
    }))
    .sort((left, right) => right.load_score - left.load_score || right.open_count - left.open_count);
}

function buildDepartmentBacklog(items: ProductionQueueItem[]): ProductionDepartmentBacklogItem[] {
  const groups = new Map<JobDepartmentType, ProductionDepartmentBacklogItem>();
  const openItems = items.filter(isOpenItem);
  for (const item of openItems) {
    const current = groups.get(item.department_type) ?? {
      department_type: item.department_type,
      open_count: 0,
      blocked_count: 0,
      overdue_count: 0,
      due_this_week_count: 0,
      rework_rate: 0,
      on_time_release_percentage: null
    };
    current.open_count += 1;
    current.blocked_count += isBlockedItem(item) ? 1 : 0;
    current.overdue_count += item.overdue_flag || item.health_state === "OVERDUE" ? 1 : 0;
    current.due_this_week_count += item.days_to_due != null && item.days_to_due >= 0 && item.days_to_due <= 7 ? 1 : 0;
    groups.set(item.department_type, current);
  }

  return [...groups.values()]
    .map((item) => {
      const departmentItems = items.filter((row) => row.department_type === item.department_type);
      const onTimePool = departmentItems.filter((row) => row.on_time_flag != null);
      return {
        ...item,
        rework_rate: percentage(departmentItems.filter((row) => row.rework_count > 0).length, Math.max(departmentItems.length, 1)),
        on_time_release_percentage: onTimePool.length ? percentage(onTimePool.filter((row) => row.on_time_flag).length, onTimePool.length) : null
      };
    })
    .sort((left, right) => right.open_count - left.open_count);
}

function buildQaFailureCategories(qaRows: QaAnalyticsRow[]): ProductionQaFailureCategoryItem[] {
  const counts = new Map<string, number>();
  for (const row of qaRows) {
    if (!FAIL_REVIEW_STATUSES.has(row.status)) {
      continue;
    }
    const key = row.issue_category ?? "uncategorized";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({
      category,
      label: humanizeLabel(category),
      count
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 8);
}

function buildQaPerformance(qaRows: QaAnalyticsRow[], itemsById: Map<string, ProductionQueueItem>): ProductionQaPerformanceItem[] {
  const groups = new Map<string | null, ProductionQaPerformanceItem & { turnaround: number[] }>();
  for (const row of qaRows) {
    const key = row.reviewer_user_id ?? null;
    const current = groups.get(key) ?? {
      reviewer_user_id: key,
      reviewer_name: row.reviewer_name ?? "Unassigned reviewer",
      reviews_completed: 0,
      send_back_count: 0,
      first_pass_approvals: 0,
      accountability_failures: 0,
      average_review_turnaround_days: null,
      turnaround: []
    };
    if (PASS_REVIEW_STATUSES.has(row.status) || FAIL_REVIEW_STATUSES.has(row.status)) {
      current.reviews_completed += 1;
    }
    current.send_back_count += FAIL_REVIEW_STATUSES.has(row.status) ? 1 : 0;
    current.first_pass_approvals += PASS_REVIEW_STATUSES.has(row.status) && itemsById.get(row.production_item_id)?.first_pass_approved ? 1 : 0;
    current.accountability_failures += row.accountable_reviewer_user_id && row.accountable_reviewer_user_id === row.reviewer_user_id ? 1 : 0;
    const turnaround = differenceInDays(row.created_at, row.reviewed_at);
    if (turnaround != null) {
      current.turnaround.push(turnaround);
    }
    groups.set(key, current);
  }
  return [...groups.values()]
    .filter((item) => item.reviews_completed > 0)
    .map(({ turnaround, ...item }) => ({
      ...item,
      average_review_turnaround_days: average(turnaround)
    }))
    .sort((left, right) => right.reviews_completed - left.reviews_completed || right.send_back_count - left.send_back_count)
    .slice(0, 10);
}

function buildAccountBurden(items: ProductionQueueItem[], accountOwnerNames: Map<string, string>): ProductionAccountBurdenItem[] {
  const openItems = items.filter(isOpenItem);
  const groups = new Map<string | null, ProductionAccountBurdenItem>();
  for (const item of openItems) {
    const key = item.account_owner_user_id ?? null;
    const current = groups.get(key) ?? {
      account_owner_user_id: key,
      account_owner_name: key ? accountOwnerNames.get(key) ?? "Unknown owner" : "Unassigned account owner",
      open_count: 0,
      blocked_count: 0,
      overdue_count: 0,
      at_risk_count: 0,
      burden_score: 0
    };
    current.open_count += 1;
    current.blocked_count += isBlockedItem(item) ? 1 : 0;
    current.overdue_count += item.overdue_flag || item.health_state === "OVERDUE" ? 1 : 0;
    current.at_risk_count += isAtRiskItem(item) ? 1 : 0;
    groups.set(key, current);
  }
  return [...groups.values()]
    .map((item) => ({
      ...item,
      burden_score: item.open_count * 2 + item.blocked_count * 6 + item.overdue_count * 5 + item.at_risk_count * 3
    }))
    .sort((left, right) => right.burden_score - left.burden_score || right.open_count - left.open_count)
    .slice(0, 10);
}

function buildOrganizationRisk(items: ProductionQueueItem[]): ProductionReportingResponse["insights"]["repeat_problem_organizations"] {
  const groups = new Map<string, ProductionReportingResponse["insights"]["repeat_problem_organizations"][number]>();
  for (const item of items) {
    if (!item.organization_id) {
      continue;
    }
    const current = groups.get(item.organization_id) ?? {
      organization_id: item.organization_id,
      organization_name: item.organization_name ?? "Unknown organization",
      blocked_count: 0,
      overdue_count: 0,
      rework_count: 0,
      file_mismatch_count: 0,
      issue_count: 0,
      risk_score: 0
    };
    current.blocked_count += isBlockedItem(item) ? 1 : 0;
    current.overdue_count += item.overdue_flag || item.health_state === "OVERDUE" ? 1 : 0;
    current.rework_count += item.rework_count;
    current.file_mismatch_count += isFileMismatch(item) ? 1 : 0;
    current.issue_count += item.open_issue_count + item.blocking_issue_count;
    groups.set(item.organization_id, current);
  }
  return [...groups.values()]
    .map((item) => ({
      ...item,
      risk_score: item.blocked_count * 6 + item.overdue_count * 5 + item.rework_count * 2 + item.file_mismatch_count * 3 + item.issue_count
    }))
    .sort((left, right) => right.risk_score - left.risk_score || right.blocked_count - left.blocked_count)
    .slice(0, 10);
}

function buildDelaySignals(items: ProductionQueueItem[]): ProductionDelaySignalItem[] {
  return items
    .filter((item) => item.post_shoot_eval_summary && ((item.days_past_due ?? 0) > 0 || item.stage_age >= 3 || item.rework_count > 0))
    .map((item) => ({
      production_item_id: item.id,
      title: item.title,
      organization_name: item.organization_name,
      workflow_status: item.workflow_status,
      health_state: item.health_state,
      delay_days: Math.max(item.days_past_due ?? 0, item.stage_age),
      post_shoot_eval_summary: item.post_shoot_eval_summary ?? ""
    }))
    .sort((left, right) => right.delay_days - left.delay_days)
    .slice(0, 10);
}

function buildTopPerformers(items: ProductionQueueItem[], qaRows: QaAnalyticsRow[]): ProductionTopPerformerItem[] {
  const completedItems = items.filter((item) => isClosedItem(item) && item.assigned_to_user_id);
  const qaRowsByItem = new Map<string, QaAnalyticsRow[]>();
  for (const row of qaRows) {
    const rows = qaRowsByItem.get(row.production_item_id) ?? [];
    rows.push(row);
    qaRowsByItem.set(row.production_item_id, rows);
  }
  const groups = new Map<string, ProductionTopPerformerItem & { turnaround: number[]; onTimePool: number; onTimeHits: number; firstPassPool: number; firstPassHits: number; qaFails: number }>();
  for (const item of completedItems) {
    const key = item.assigned_to_user_id!;
    const current = groups.get(key) ?? {
      owner_user_id: key,
      owner_name: item.assigned_to_name ?? "Unknown owner",
      items_completed: 0,
      on_time_release_percentage: null,
      first_pass_approval_rate: null,
      average_turnaround_days: null,
      qa_fail_rate: 0,
      performance_score: 0,
      turnaround: [],
      onTimePool: 0,
      onTimeHits: 0,
      firstPassPool: 0,
      firstPassHits: 0,
      qaFails: 0
    };
    current.items_completed += 1;
    if (item.turnaround_days != null) {
      current.turnaround.push(item.turnaround_days);
    }
    if (item.on_time_flag != null) {
      current.onTimePool += 1;
      current.onTimeHits += item.on_time_flag ? 1 : 0;
    }
    const relatedQaRows = qaRowsByItem.get(item.id) ?? [];
    if (relatedQaRows.length) {
      current.firstPassPool += 1;
      current.firstPassHits += item.first_pass_approved ? 1 : 0;
      current.qaFails += relatedQaRows.filter((row) => FAIL_REVIEW_STATUSES.has(row.status)).length;
    }
    groups.set(key, current);
  }
  return [...groups.values()]
    .map(({ turnaround, onTimePool, onTimeHits, firstPassPool, firstPassHits, qaFails, ...item }) => ({
      ...item,
      on_time_release_percentage: onTimePool ? percentage(onTimeHits, onTimePool) : null,
      first_pass_approval_rate: firstPassPool ? percentage(firstPassHits, firstPassPool) : null,
      average_turnaround_days: average(turnaround),
      qa_fail_rate: percentage(qaFails, Math.max(item.items_completed, 1)),
      performance_score: roundMetric(
        (onTimePool ? percentage(onTimeHits, onTimePool) : 85) * 0.45 +
          (firstPassPool ? percentage(firstPassHits, firstPassPool) : 85) * 0.35 +
          Math.max(0, 100 - percentage(qaFails, Math.max(item.items_completed, 1))) * 0.2
      )
    }))
    .sort((left, right) => right.performance_score - left.performance_score || right.items_completed - left.items_completed)
    .slice(0, 10);
}

function canViewRestrictedOverlays(auth: AuthUser) {
  return canAccessExecutiveCommandLayer(auth) || canSharedPolicy(auth, "profitability.read");
}

function buildRestrictedOverlays(
  auth: AuthUser,
  items: ProductionQueueItem[],
  derived: Pick<ReportingDerivedMetrics, "ownerBacklog" | "accountBurden">
): ProductionRestrictedOverlayCard[] | null {
  if (!canViewRestrictedOverlays(auth)) {
    return null;
  }
  const vendorItems = items.filter(isVendorItem);
  const concentratedOwner = derived.ownerBacklog[0] ?? null;
  const highRiskAccounts = derived.accountBurden[0] ?? null;
  return [
    {
      key: "cost_overlay",
      title: "Cost Overlay",
      availability: "scaffolded",
      summary: "Profitability-safe production cost overlay is ready for real cost inputs when finance integrations are connected.",
      metric: `${vendorItems.length} vendor-touched item${vendorItems.length === 1 ? "" : "s"}`,
      detail: "The board is already isolating the items that should receive cost and margin overlays later.",
      tone: vendorItems.length ? "info" : "neutral"
    },
    {
      key: "burden_vs_revenue",
      title: "Burden vs Revenue Signals",
      availability: highRiskAccounts ? "live" : "scaffolded",
      summary: highRiskAccounts
        ? `${highRiskAccounts.account_owner_name} is carrying the heaviest open burden signal right now.`
        : "Operational burden signals are live even where direct revenue data is still incomplete.",
      metric: concentratedOwner ? `${concentratedOwner.work_share_percent}% concentration` : "No active concentration",
      detail: "This overlay currently uses operational burden and concentration as the safe proxy until revenue joins are complete.",
      tone: concentratedOwner && concentratedOwner.work_share_percent >= 35 ? "warning" : "info"
    },
    {
      key: "vendor_cost_concentration",
      title: "Vendor Cost Concentration",
      availability: "scaffolded",
      summary: "Vendor concentration is tracked now so executive-only cost overlays can land without reshaping the Production Board later.",
      metric: `${vendorItems.length} vendor item${vendorItems.length === 1 ? "" : "s"}`,
      detail: "When vendor cost data is connected, this card can roll up actual concentration and spend exposure without broadening access.",
      tone: vendorItems.length >= 5 ? "warning" : "neutral"
    }
  ];
}

export async function getProductionReporting(
  client: PoolClient,
  auth: AuthUser,
  options: ProductionReportingOptions = {}
): Promise<ProductionReportingResponse> {
  const now = options.now ?? new Date();
  const departmentType = options.department_type ?? null;
  const context = await loadReportingContext(client, auth, {
    department_type: departmentType,
    status: options.status ?? null,
    workflow_status: options.workflow_status ?? null,
    health_state: options.health_state ?? null,
    approval_status: options.approval_status ?? null,
    qa_status: options.qa_status ?? null,
    assigned_to_user_id: options.assigned_to_user_id ?? null,
    blocked: options.blocked ?? null,
    priority: options.priority ?? null,
    due_bucket: options.due_bucket ?? null,
    search: options.search ?? null,
    deliverable_type: options.deliverable_type ?? null,
    organization_id: options.organization_id ?? null,
    release_status: options.release_status ?? null
  });
  const filteredItems = context.items.filter((item) => matchesReportingDueWindow(item, options.due_window ?? "all", now));
  const visibleItemIds = new Set(filteredItems.map((item) => item.id));
  const filteredQaRows = context.qaRows.filter((row) => visibleItemIds.has(row.production_item_id));
  const itemsById = new Map(filteredItems.map((item) => [item.id, item] as const));
  const filteredUrgentWatchItems =
    visibleItemIds.size === 0
      ? []
      : await listProductionFlagsForItems(client, auth, [...visibleItemIds], {
          department_type: departmentType
        });
  const fullExceptionView = buildProductionManagementExceptionItems(filteredItems, filteredUrgentWatchItems, null);
  const exceptionView = fullExceptionView.slice(0, 50);
  const overdueQueue = fullExceptionView.filter((item) => item.exception_types.includes("overdue")).slice(0, 50);
  const blockedQueue = fullExceptionView.filter((item) => item.exception_types.includes("blocked")).slice(0, 50);
  const dayBuckets = buildTrendBuckets(filteredItems, filteredQaRows, buildDefaultDayBuckets(now));
  const weekBuckets = buildTrendBuckets(filteredItems, filteredQaRows, buildDefaultWeekBuckets(now));
  const derived: ReportingDerivedMetrics = {
    ownerBacklog: buildOwnerBacklogItems(filteredItems),
    departmentBacklog: buildDepartmentBacklog(filteredItems),
    qaPerformance: buildQaPerformance(filteredQaRows, itemsById),
    qaFailureCategories: buildQaFailureCategories(filteredQaRows),
    accountBurden: buildAccountBurden(filteredItems, context.accountOwnerNames),
    organizationRisk: buildOrganizationRisk(filteredItems),
    delaySignals: buildDelaySignals(filteredItems),
    topPerformers: buildTopPerformers(filteredItems, filteredQaRows)
  };
  return {
    generated_at: now.toISOString(),
    department_type: departmentType,
    summary: buildSummary(filteredItems, now),
    management: {
      overdue_queue: overdueQueue,
      blocked_queue: blockedQueue,
      exception_view: exceptionView,
      team_workload: derived.ownerBacklog,
      qa_performance: derived.qaPerformance
    },
    insights: {
      backlog_by_owner: derived.ownerBacklog,
      backlog_by_department: derived.departmentBacklog,
      qa_failure_categories: derived.qaFailureCategories,
      operational_burden_by_account: derived.accountBurden,
      work_concentration_by_person: derived.ownerBacklog,
      repeat_problem_organizations: derived.organizationRisk,
      post_shoot_eval_delay_signals: derived.delaySignals,
      top_performers: derived.topPerformers
    },
    trends: {
      by_day: dayBuckets,
      by_week: weekBuckets
    },
    urgent_watch: summarizeUrgentFlags(filteredUrgentWatchItems),
    restricted_overlays: buildRestrictedOverlays(auth, filteredItems, derived)
  };
}

export async function getOperationalProductionSection(
  client: PoolClient,
  auth: AuthUser,
  options: ProductionOperationalSectionOptions
): Promise<OperationalProductionReportingSection> {
  const departmentType = options.department_type ?? null;
  const context = await loadReportingContext(client, auth, { department_type: departmentType });
  const summary = buildSummary(context.items, options.startsAt);
  const trendBuckets = buildTrendBuckets(
    context.items,
    context.qaRows,
    options.buckets.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      startsAt: bucket.startsAt,
      endsBefore: bucket.endsBefore
    }))
  );
  const blockedReasons = new Map<string, number>();
  for (const item of context.items.filter(isBlockedItem)) {
    const key = item.blocked_reason ? item.blocked_reason.toLowerCase().replace(/\s+/g, "_").slice(0, 60) : "blocked_state";
    blockedReasons.set(key, (blockedReasons.get(key) ?? 0) + 1);
  }

  return {
    action_hash: departmentType ? `#${departmentType}/production` : "#production",
    summary_line:
      summary.overdue_items > 0
        ? `${summary.overdue_items} production item${summary.overdue_items === 1 ? "" : "s"} are overdue and ${summary.blocked_items} remain blocked.`
        : `${summary.total_open_items} open production item${summary.total_open_items === 1 ? "" : "s"} with ${summary.ready_for_release_count} ready for release.`,
    jobs_completed: context.items.filter((item) => isWithinRange(item.closed_at ?? item.completed_at, options.startsAt, options.endsBefore)).length,
    average_turnaround_hours: summary.average_turnaround_days != null ? roundMetric(summary.average_turnaround_days * 24) : null,
    average_turnaround_label:
      summary.average_turnaround_days != null ? `${roundMetric(summary.average_turnaround_days)} days average` : "No completed production items in range",
    overdue_tasks: summary.overdue_items,
    blocked_reasons: [...blockedReasons.entries()]
      .map(([blocker_type, count]) => ({
        blocker_type,
        label: humanizeLabel(blocker_type),
        count
      }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 6),
    peer_review_backlog: context.items.filter((item) => item.workflow_status === "READY_FOR_QA" || item.workflow_status === "IN_PEER_REVIEW").length,
    qc_backlog: context.items.filter((item) => item.workflow_status === "WAITING_ON_INTAKE" || item.workflow_status === "INTAKE_REVIEW").length,
    rework_rate: summary.rework_rate,
    send_back_rate: percentage(context.qaRows.filter((row) => FAIL_REVIEW_STATUSES.has(row.status)).length, Math.max(context.qaRows.length, 1)),
    trend: trendBuckets.map((bucket) => ({
      bucket: {
        key: bucket.key,
        label: bucket.label,
        starts_at: bucket.starts_at,
        ends_before: bucket.ends_before
      },
      metrics: [
        { key: "jobs_completed", label: "Completed", value: bucket.completions },
        { key: "overdue_tasks", label: "Overdue", value: bucket.overdue },
        { key: "blocked", label: "Blocked", value: bucket.blocked },
        { key: "rework", label: "Rework", value: bucket.rework }
      ]
    }))
  };
}
