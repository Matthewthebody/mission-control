import type { PoolClient } from "pg";
import type { AuthUser, SharedMaskingStrategy, SharedVisibilityState } from "../../types/auth.js";
import type {
  DashboardResponse,
  JobDetailResponse,
  JobListItem,
  JobRecord,
  ProductionQueueItem,
  WatchFlagListItem
} from "../../types/jobTruth.js";
import {
  buildSharedResourcePolicySnapshot,
  getFieldVisibilityRules,
  getVisibleFields,
  maskVisibilityValue,
  type PolicyResourceContext
} from "./policyEngine.js";

type FieldRuleDescriptor = {
  state: SharedVisibilityState;
  strategy: SharedMaskingStrategy | null;
};

type DescriptorCache = Map<string, Promise<Map<string, FieldRuleDescriptor>>>;

function buildJobPolicyContext(
  job: Pick<JobRecord, "department_type" | "organization_id" | "primary_location_id" | "account_owner_user_id" | "created_by_user_id">,
  input: {
    assignedUserIds?: Array<string | null | undefined>;
    ownerUserIds?: Array<string | null | undefined>;
  } = {}
): PolicyResourceContext {
  return {
    departmentType: job.department_type,
    organizationId: job.organization_id,
    locationId: job.primary_location_id,
    ownerUserIds: [job.account_owner_user_id, job.created_by_user_id, ...(input.ownerUserIds ?? [])],
    assignedUserIds: input.assignedUserIds ?? []
  };
}

async function getFieldRuleDescriptors(
  client: PoolClient,
  auth: AuthUser,
  resourceType: string,
  context: PolicyResourceContext
) {
  const states = await getVisibleFields(client, auth, resourceType, context);
  const rules = await getFieldVisibilityRules(client, resourceType, context.departmentType ?? null);
  const descriptors = new Map<string, FieldRuleDescriptor>();
  for (const rule of rules) {
    descriptors.set(rule.field_key, {
      state: states[rule.field_key] ?? rule.default_visibility,
      strategy: rule.masking_strategy
    });
  }
  return descriptors;
}

function normalizeContextIds(values: Array<string | null | undefined> | undefined) {
  return [...new Set((values ?? []).filter((value): value is string => Boolean(value)))].sort();
}

function buildDescriptorCacheKey(resourceType: string, context: PolicyResourceContext) {
  return JSON.stringify({
    resourceType,
    departmentType: context.departmentType ?? null,
    organizationId: context.organizationId ?? null,
    locationId: context.locationId ?? null,
    ownerUserIds: normalizeContextIds(context.ownerUserIds),
    assignedUserIds: normalizeContextIds(context.assignedUserIds)
  });
}

async function getCachedFieldRuleDescriptors(
  cache: DescriptorCache,
  client: PoolClient,
  auth: AuthUser,
  resourceType: string,
  context: PolicyResourceContext
) {
  const key = buildDescriptorCacheKey(resourceType, context);
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }
  const next = getFieldRuleDescriptors(client, auth, resourceType, context);
  cache.set(key, next);
  return next;
}

function applyFieldValue<T>(value: T, descriptor: FieldRuleDescriptor | undefined): T {
  if (!descriptor) {
    return value;
  }
  if (descriptor.state === "hidden") {
    return null as T;
  }
  if (descriptor.state === "masked") {
    return maskVisibilityValue(value, descriptor.state, descriptor.strategy) as T;
  }
  return value;
}

function applyBooleanField(value: boolean | null, descriptor: FieldRuleDescriptor | undefined) {
  if (!descriptor) {
    return value;
  }
  if (descriptor.state === "hidden" || descriptor.state === "masked") {
    return null;
  }
  return value;
}

export async function sanitizeJobListItems(client: PoolClient, auth: AuthUser, items: JobListItem[], descriptorCache: DescriptorCache = new Map()) {
  const sanitized: JobListItem[] = [];
  for (const item of items) {
    const context = buildJobPolicyContext(item, {
      ownerUserIds: [item.lead_owner_user_id],
      assignedUserIds: [item.lead_owner_user_id]
    });
    const jobFields = await getCachedFieldRuleDescriptors(descriptorCache, client, auth, "shared_job", context);
    sanitized.push({
      ...item,
      description_internal: applyFieldValue(item.description_internal, jobFields.get("shared_job.description_internal")),
      sports_profile: item.sports_profile
        ? {
            ...item.sports_profile,
            revenue_share_enabled: applyBooleanField(
              item.sports_profile.revenue_share_enabled,
              jobFields.get("shared_job.sports_profile.revenue_share_enabled") ?? jobFields.get("sports_profile.revenue_share_enabled")
            ),
            revenue_share_terms_summary: applyFieldValue(
              item.sports_profile.revenue_share_terms_summary,
              jobFields.get("shared_job.sports_profile.revenue_share_terms_summary") ?? jobFields.get("sports_profile.revenue_share_terms_summary")
            )
          }
        : null
    });
  }
  return sanitized;
}

export async function sanitizeProductionQueueItems(
  client: PoolClient,
  auth: AuthUser,
  items: ProductionQueueItem[],
  descriptorCache: DescriptorCache = new Map()
) {
  const sanitized: ProductionQueueItem[] = [];
  for (const item of items) {
    const context: PolicyResourceContext = {
      departmentType: item.department_type,
      organizationId: item.organization_id,
      locationId: null,
      ownerUserIds: [item.assigned_to_user_id],
      assignedUserIds: [item.assigned_to_user_id]
    };
    const fields = await getCachedFieldRuleDescriptors(descriptorCache, client, auth, "shared_production_item", context);
    sanitized.push({
      ...item,
      blocked_reason: applyFieldValue(item.blocked_reason, fields.get("shared_production_item.blocked_reason"))
    });
  }
  return sanitized;
}

export async function sanitizeWatchFlagItems(
  client: PoolClient,
  auth: AuthUser,
  items: WatchFlagListItem[],
  descriptorCache: DescriptorCache = new Map()
) {
  const sanitized: WatchFlagListItem[] = [];
  for (const item of items) {
    const context: PolicyResourceContext = {
      departmentType: item.department_type,
      organizationId: item.organization_id,
      ownerUserIds: [item.owner_user_id, item.created_by_user_id],
      assignedUserIds: [item.owner_user_id]
    };
    const fields = await getCachedFieldRuleDescriptors(descriptorCache, client, auth, "shared_watch_flag", context);
    sanitized.push({
      ...item,
      description: applyFieldValue(item.description, fields.get("shared_watch_flag.description"))
    });
  }
  return sanitized;
}

export async function sanitizeDashboardResponse(client: PoolClient, auth: AuthUser, dashboard: DashboardResponse) {
  const descriptorCache: DescriptorCache = new Map();
  const urgentWatch = await sanitizeWatchFlagItems(client, auth, dashboard.urgent_watch, descriptorCache);
  const upcomingRisks = await sanitizeWatchFlagItems(client, auth, dashboard.upcoming_risks, descriptorCache);
  const myOpenFlags = await sanitizeWatchFlagItems(client, auth, dashboard.my_open_flags, descriptorCache);
  const blockedProduction = await sanitizeProductionQueueItems(client, auth, dashboard.blocked_production, descriptorCache);
  const overdueApprovals = await sanitizeProductionQueueItems(client, auth, dashboard.overdue_approvals, descriptorCache);
  const deliveryRisks = await sanitizeProductionQueueItems(client, auth, dashboard.delivery_risks, descriptorCache);
  const todayJobs = await sanitizeJobListItems(client, auth, dashboard.today_jobs, descriptorCache);

  return {
    ...dashboard,
    urgent_watch: urgentWatch,
    upcoming_risks: upcomingRisks,
    my_open_flags: myOpenFlags,
    blocked_production: blockedProduction,
    overdue_approvals: overdueApprovals,
    delivery_risks: deliveryRisks,
    today_jobs: todayJobs
  };
}

export async function sanitizeJobDetailResponse(client: PoolClient, auth: AuthUser, detail: JobDetailResponse): Promise<JobDetailResponse> {
  const context = buildJobPolicyContext(detail.job, {
    ownerUserIds: [detail.summary.lead_owner_user_id],
    assignedUserIds: [
      ...detail.staff_assignments.map((assignment) => assignment.user_id),
      ...detail.production_items.map((item) => item.assigned_to_user_id),
      ...detail.job_exceptions.map((flag) => flag.owner_user_id)
    ]
  });

  const jobFields = await getFieldRuleDescriptors(client, auth, "shared_job", context);
  const staffFields = await getFieldRuleDescriptors(client, auth, "shared_staff_assignment", context);
  const productionFields = await getFieldRuleDescriptors(client, auth, "shared_production_item", context);
  const watchFields = await getFieldRuleDescriptors(client, auth, "shared_watch_flag", context);
  const approvalFields = await getFieldRuleDescriptors(client, auth, "shared_approval_request", context);
  const qaFields = await getFieldRuleDescriptors(client, auth, "shared_qa_review", context);
  const deliverableFields = await getFieldRuleDescriptors(client, auth, "shared_deliverable_item", context);
  const policy = await buildSharedResourcePolicySnapshot(client, auth, "shared_job", context, {
    read: "job.read",
    update: "job.update",
    publish: "job.publish",
    cancel: "job.cancel",
    archive: "job.archive",
    assign_staff: "job.assign_staff",
    mark_ready: "job.mark_ready",
    manage_readiness: "job.manage_readiness",
    manage_production: "production.update",
    manage_approvals: "approval.manage",
    manage_qa: "qa.manage",
    manage_deliverables: "deliverable.manage",
    manage_watch_flags: "watchflag.resolve"
  });

  const sanitizedJobExceptions = detail.job_exceptions.map((flag) => ({
    ...flag,
    description: applyFieldValue(flag.description, watchFields.get("shared_watch_flag.description"))
  }));

  return {
    ...detail,
    job: {
      ...detail.job,
      description_internal: applyFieldValue(detail.job.description_internal, jobFields.get("shared_job.description_internal"))
    },
    sports_profile: detail.sports_profile
      ? {
          ...detail.sports_profile,
          revenue_share_enabled: applyBooleanField(
            detail.sports_profile.revenue_share_enabled,
            jobFields.get("shared_job.sports_profile.revenue_share_enabled") ?? jobFields.get("sports_profile.revenue_share_enabled")
          ),
          revenue_share_terms_summary: applyFieldValue(
            detail.sports_profile.revenue_share_terms_summary,
            jobFields.get("shared_job.sports_profile.revenue_share_terms_summary") ?? jobFields.get("sports_profile.revenue_share_terms_summary")
          )
        }
      : null,
    staff_assignments: detail.staff_assignments.map((assignment) => ({
      ...assignment,
      notes: applyFieldValue(assignment.notes, staffFields.get("shared_staff_assignment.notes"))
    })),
    production_items: detail.production_items.map((item) => ({
      ...item,
      blocked_reason: applyFieldValue(item.blocked_reason, productionFields.get("shared_production_item.blocked_reason"))
    })),
    approval_requests: detail.approval_requests.map((request) => ({
      ...request,
      notes: applyFieldValue(request.notes, approvalFields.get("shared_approval_request.notes"))
    })),
    qa_reviews: detail.qa_reviews.map((review) => ({
      ...review,
      notes: applyFieldValue(review.notes, qaFields.get("shared_qa_review.notes"))
    })),
    deliverable_items: detail.deliverable_items.map((item) => ({
      ...item,
      notes: applyFieldValue(item.notes, deliverableFields.get("shared_deliverable_item.notes"))
    })),
    job_exceptions: sanitizedJobExceptions,
    watch_flags: sanitizedJobExceptions,
    policy
  };
}
