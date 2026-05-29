import type { PoolClient } from "pg";
import type { JobDepartmentType } from "../../domain/jobTruth/index.js";
import type { AuthUser } from "../../types/auth.js";
import type {
  ProductionManagementExceptionItem,
  ProductionManagementExceptionResponse,
  ProductionQueueItem,
  ProductionQueueSummary,
  ProductionUrgentWatchResponse,
  WatchFlagListItem
} from "../../types/jobTruth.js";
import { listProductionQueue } from "./jobService.js";
import { listWatchFlags } from "./watchFlagService.js";

type ProductionBoardViewOptions = {
  department_type?: JobDepartmentType | null;
  limit?: number | null;
};

const PRODUCTION_URGENT_FLAG_TYPES = new Set([
  "production_blocked",
  "production_overdue",
  "production_due_soon",
  "missing_files",
  "missing_owner",
  "missing_peer_reviewer",
  "missing_release_reviewer",
  "release_review_pending",
  "upload_failure",
  "qa_rework_escalation",
  "stalled_stage",
  "hold_review_due",
  "production_issue"
]);

const PRODUCTION_MANAGEMENT_EXCEPTION_TYPES = new Map<string, string>([
  ["production_blocked", "blocked"],
  ["production_overdue", "overdue"],
  ["missing_files", "blocked"],
  ["missing_owner", "missing_owner"],
  ["missing_peer_reviewer", "missing_peer_reviewer"],
  ["missing_release_reviewer", "missing_release_reviewer"],
  ["qa_rework_escalation", "rework_escalation"],
  ["hold_review_due", "hold_review_due"],
  ["stalled_stage", "stalled_stage"]
]);

function sortUrgentFlags(left: WatchFlagListItem, right: WatchFlagListItem) {
  return right.priority_rank - left.priority_rank || String(right.updated_at).localeCompare(String(left.updated_at));
}

function flattenUrgentFlagGroups(items: WatchFlagListItem[], limit: number) {
  const groups = new Map<string, WatchFlagListItem[]>();
  for (const item of items) {
    const groupKey = item.production_item_id ?? item.source_entity_id ?? item.id;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.push(item);
      continue;
    }
    groups.set(groupKey, [item]);
  }

  const orderedGroups = [...groups.values()]
    .map((group) => group.sort(sortUrgentFlags))
    .sort((left, right) => {
      const leftHead = left[0];
      const rightHead = right[0];
      const priorityDiff = sortUrgentFlags(leftHead, rightHead);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return right.length - left.length;
    });

  const flattened: WatchFlagListItem[] = [];
  let includedGroupCount = 0;
  for (const group of orderedGroups) {
    if (includedGroupCount >= limit) {
      break;
    }
    flattened.push(...group);
    includedGroupCount += 1;
  }
  return flattened;
}

function isProductionUrgentFlag(item: WatchFlagListItem) {
  return item.production_item_id != null || PRODUCTION_URGENT_FLAG_TYPES.has(item.flag_type);
}

function isQueueBackedProductionFlag(item: WatchFlagListItem, queueItemIds: Set<string>) {
  const productionItemId = item.production_item_id ?? (item.source_entity_type === "production_item" ? item.source_entity_id : null);
  return productionItemId != null && queueItemIds.has(productionItemId);
}

export function summarizeUrgentFlags(items: WatchFlagListItem[]) {
  return {
    total_count: items.length,
    critical_count: items.filter((item) => item.severity === "critical").length,
    high_count: items.filter((item) => item.severity === "high").length,
    blocked_count: items.filter((item) => item.flag_type === "production_blocked").length,
    overdue_count: items.filter((item) => item.flag_type === "production_overdue").length,
    next_24_hours_count: items.filter((item) => {
      return item.due_at ? new Date(item.due_at).getTime() <= Date.now() + 24 * 60 * 60 * 1000 : false;
    }).length
  };
}

function getExceptionPriorityRank(item: ProductionManagementExceptionItem) {
  if (item.exception_types.includes("blocked")) {
    return 10;
  }
  if (item.exception_types.includes("rework_escalation")) {
    return 9;
  }
  if (item.exception_types.includes("overdue")) {
    return 8;
  }
  if (
    item.exception_types.includes("missing_peer_reviewer") ||
    item.exception_types.includes("missing_release_reviewer")
  ) {
    return 7;
  }
  if (item.exception_types.includes("stalled_stage")) {
    return 6;
  }
  if (item.exception_types.includes("missing_owner")) {
    return 5;
  }
  if (item.exception_types.includes("hold_review_due")) {
    return 4;
  }
  return 0;
}

function sortExceptionItems(left: ProductionManagementExceptionItem, right: ProductionManagementExceptionItem) {
  const priorityDiff = getExceptionPriorityRank(right) - getExceptionPriorityRank(left);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }
  const blockedDiff = Number(Boolean(right.exception_types.includes("blocked"))) - Number(Boolean(left.exception_types.includes("blocked")));
  if (blockedDiff !== 0) {
    return blockedDiff;
  }
  const overdueDiff = Number(Boolean(right.exception_types.includes("overdue"))) - Number(Boolean(left.exception_types.includes("overdue")));
  if (overdueDiff !== 0) {
    return overdueDiff;
  }
  if (left.due_at && right.due_at) {
    return new Date(left.due_at).getTime() - new Date(right.due_at).getTime();
  }
  if (left.due_at) {
    return -1;
  }
  if (right.due_at) {
    return 1;
  }
  return right.exception_types.length - left.exception_types.length;
}

function summarizeExceptions(items: ProductionManagementExceptionItem[]) {
  return {
    total_count: items.length,
    blocked_count: items.filter((item) => item.exception_types.includes("blocked")).length,
    overdue_count: items.filter((item) => item.exception_types.includes("overdue")).length,
    missing_owner_count: items.filter((item) => item.exception_types.includes("missing_owner")).length,
    reviewer_gap_count: items.filter(
      (item) => item.exception_types.includes("missing_peer_reviewer") || item.exception_types.includes("missing_release_reviewer")
    ).length,
    stalled_count: items.filter((item) => item.exception_types.includes("stalled_stage")).length,
    rework_exception_count: items.filter((item) => item.exception_types.includes("rework_escalation")).length,
    hold_review_due_count: items.filter((item) => item.exception_types.includes("hold_review_due")).length
  };
}

function buildExceptionTypeGroups(flags: WatchFlagListItem[]) {
  const grouped = new Map<string, Set<string>>();
  for (const flag of flags) {
    const productionItemId = flag.production_item_id ?? (flag.source_entity_type === "production_item" ? flag.source_entity_id : null);
    const exceptionType = PRODUCTION_MANAGEMENT_EXCEPTION_TYPES.get(flag.flag_type) ?? null;
    if (!productionItemId || !exceptionType) {
      continue;
    }
    const existing = grouped.get(productionItemId);
    if (existing) {
      existing.add(exceptionType);
      continue;
    }
    grouped.set(productionItemId, new Set([exceptionType]));
  }
  return grouped;
}

export function buildProductionManagementExceptionItems(
  items: ProductionQueueItem[],
  flags: WatchFlagListItem[],
  limit: number | null = 100
): ProductionManagementExceptionItem[] {
  const exceptionTypeGroups = buildExceptionTypeGroups(flags);
  const exceptionItems = items
    .map<ProductionManagementExceptionItem | null>((item) => {
      const exceptionTypes = [...(exceptionTypeGroups.get(item.id) ?? [])];
      if (exceptionTypes.length === 0) {
        return null;
      }
      return {
        ...item,
        exception_types: exceptionTypes
      };
    })
    .filter((item): item is ProductionManagementExceptionItem => item != null)
    .sort(sortExceptionItems);

  if (limit == null) {
    return exceptionItems;
  }

  return exceptionItems.slice(0, limit);
}

async function listPersistedProductionUrgentFlags(
  client: PoolClient,
  auth: AuthUser,
  options: ProductionBoardViewOptions
) {
  const watchlist = await listWatchFlags(client, auth, {
    department_type: options.department_type ?? null,
    limit: Math.max((options.limit ?? 100) * 4, 400),
    run_automation: false
  });
  return watchlist.items.filter(isProductionUrgentFlag);
}

export async function listProductionFlagsForItems(
  client: PoolClient,
  auth: AuthUser,
  productionItemIds: string[],
  options: ProductionBoardViewOptions = {}
) {
  if (!productionItemIds.length) {
    return [] as WatchFlagListItem[];
  }
  const watchlist = await listWatchFlags(client, auth, {
    department_type: options.department_type ?? null,
    production_item_ids: productionItemIds,
    limit: Math.max(productionItemIds.length * 8, 250),
    run_automation: false
  });
  return watchlist.items.filter(isProductionUrgentFlag);
}

export async function listProductionUrgentWatch(
  client: PoolClient,
  auth: AuthUser,
  options: ProductionBoardViewOptions = {}
): Promise<ProductionUrgentWatchResponse> {
  const queue = await listProductionQueue(client, auth, {
    department_type: options.department_type ?? null,
    run_automation: false
  });
  const persistedItems = await listPersistedProductionUrgentFlags(client, auth, options);
  const queueItemIds = new Set(queue.items.map((item) => item.id));
  const queueBackedPersistedItems = persistedItems.filter((item) => isQueueBackedProductionFlag(item, queueItemIds));
  const externalPersistedItems = persistedItems.filter((item) => !isQueueBackedProductionFlag(item, queueItemIds));
  const primaryItems = flattenUrgentFlagGroups(queueBackedPersistedItems, options.limit ?? 100);
  const items =
    primaryItems.length >= (options.limit ?? 100)
      ? primaryItems
      : [...primaryItems, ...flattenUrgentFlagGroups(externalPersistedItems, Math.max((options.limit ?? 100) - primaryItems.length, 0))];

  return {
    items,
    summary: summarizeUrgentFlags(items)
  };
}

export async function listProductionManagementExceptions(
  client: PoolClient,
  auth: AuthUser,
  options: ProductionBoardViewOptions = {}
): Promise<ProductionManagementExceptionResponse> {
  const queue = await listProductionQueue(client, auth, {
    department_type: options.department_type ?? null,
    run_automation: false
  });
  const persistedItems = await listPersistedProductionUrgentFlags(client, auth, options);
  const queueItemIds = new Set(queue.items.map((item) => item.id));
  const queueBackedPersistedItems = persistedItems.filter((item) => isQueueBackedProductionFlag(item, queueItemIds));
  const items = buildProductionManagementExceptionItems(queue.items, queueBackedPersistedItems, options.limit ?? 100);

  return {
    items,
    summary: summarizeExceptions(items)
  };
}

export async function listProductionOverdueQueue(
  client: PoolClient,
  auth: AuthUser,
  options: ProductionBoardViewOptions = {}
): Promise<{ items: ProductionQueueItem[]; summary: ProductionQueueSummary }> {
  return listProductionQueue(client, auth, {
    department_type: options.department_type ?? null,
    due_bucket: "overdue",
    run_automation: false
  });
}

export async function listProductionBlockedQueue(
  client: PoolClient,
  auth: AuthUser,
  options: ProductionBoardViewOptions = {}
): Promise<{ items: ProductionQueueItem[]; summary: ProductionQueueSummary }> {
  return listProductionQueue(client, auth, {
    department_type: options.department_type ?? null,
    blocked: "yes",
    run_automation: false
  });
}
