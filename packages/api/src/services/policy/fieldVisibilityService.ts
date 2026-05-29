import type { PoolClient } from "pg";
import type { AuthUser } from "../../types/auth.js";
import type {
  DashboardResponse,
  JobDetailResponse,
  JobDraftInput,
  JobListItem,
  ProductionQueueItem,
  WatchFlagListItem,
  WatchlistResponse
} from "../../types/jobTruth.js";
import { ApiError } from "../../errors/apiError.js";
import { buildSharedResourcePolicySnapshot, maskVisibilityValue } from "./policyEngine.js";

function applyFieldState<T>(value: T, state: "hidden" | "masked" | "readonly" | "editable", strategy: Parameters<typeof maskVisibilityValue>[2]) {
  if (state === "hidden") {
    return null;
  }
  if (state === "masked") {
    return maskVisibilityValue(value, state, strategy) as T | null;
  }
  return value;
}

export async function buildSharedJobPolicy(client: PoolClient, auth: AuthUser, detail: JobDetailResponse) {
  return buildSharedResourcePolicySnapshot(
    client,
    auth,
    "shared_job",
    {
      departmentType: detail.job.department_type,
      organizationId: detail.job.organization_id,
      locationId: detail.job.primary_location_id,
      ownerUserIds: [detail.job.account_owner_user_id, detail.summary.lead_owner_user_id],
      assignedUserIds: detail.staff_assignments.map((assignment) => assignment.user_id)
    },
    {
      update: "job.update",
      publish: "job.publish",
      cancel: "job.cancel",
      archive: "job.archive",
      assign_staff: "job.assign_staff",
      manage_readiness: "job.manage_readiness",
      mark_ready: "job.mark_ready",
      check_in_self: "job.check_in_self",
      check_in_others: "job.check_in_others",
      production_update: "production.update",
      approval_manage: "approval.manage",
      qa_manage: "qa.manage",
      deliverable_manage: "deliverable.manage",
      watchflag_resolve: "watchflag.resolve",
      finance_edit: "finance.edit"
    }
  );
}

export async function sanitizeSharedJobDetailResponse(client: PoolClient, auth: AuthUser, detail: JobDetailResponse) {
  const policy = await buildSharedJobPolicy(client, auth, detail);
  return {
    ...detail,
    sports_profile: detail.sports_profile
      ? {
          ...detail.sports_profile,
          revenue_share_enabled: applyFieldState(
            detail.sports_profile.revenue_share_enabled,
            policy.fields["sports_profile.revenue_share_enabled"] ?? policy.fields["shared_job.sports_profile.revenue_share_enabled"] ?? policy.sections.financial ?? "editable",
            "none"
          ),
          revenue_share_terms_summary: applyFieldState(
            detail.sports_profile.revenue_share_terms_summary,
            policy.fields["sports_profile.revenue_share_terms_summary"] ??
              policy.fields["shared_job.sports_profile.revenue_share_terms_summary"] ??
              policy.sections.financial ??
              "editable",
            "money_summary_only"
          )
        }
      : null,
    staff_assignments: detail.staff_assignments.map((assignment) => ({
      ...assignment,
      notes: applyFieldState(assignment.notes, policy.fields["notes"] ?? policy.fields["shared_staff_assignment.notes"] ?? "editable", "redacted_text")
    })),
    production_items: detail.production_items.map((item) => ({
      ...item,
      blocked_reason: applyFieldState(
        item.blocked_reason,
        policy.fields["shared_production_item.blocked_reason"] ?? "editable",
        "redacted_text"
      )
    })),
    approval_requests: detail.approval_requests.map((request) => ({
      ...request,
      notes: applyFieldState(request.notes, policy.fields["shared_approval_request.notes"] ?? "editable", "redacted_text")
    })),
    qa_reviews: detail.qa_reviews.map((review) => ({
      ...review,
      notes: applyFieldState(review.notes, policy.fields["shared_qa_review.notes"] ?? "editable", "redacted_text")
    })),
    deliverable_items: detail.deliverable_items.map((item) => ({
      ...item,
      notes: applyFieldState(item.notes, policy.fields["shared_deliverable_item.notes"] ?? "editable", "redacted_text")
    })),
    watch_flags: detail.watch_flags.map((flag) => ({
      ...flag,
      description: applyFieldState(flag.description, policy.fields["shared_watch_flag.description"] ?? "editable", "redacted_text")
    })),
    policy
  };
}

export function sanitizeJobDraftInput(auth: AuthUser, input: JobDraftInput) {
  const next: JobDraftInput = {
    ...input,
    sports_profile: input.sports_profile ? { ...input.sports_profile } : input.sports_profile
  };
  if (next.sports_profile && !auth.permissions.includes("finance.edit")) {
    if (next.sports_profile.revenue_share_enabled != null || next.sports_profile.revenue_share_terms_summary != null) {
      throw new ApiError(403, "Forbidden");
    }
  }
  return next;
}

export function sanitizeSharedJobListItem(auth: AuthUser, item: JobListItem): JobListItem {
  if (item.department_type !== "sports" || !item.sports_profile || auth.permissions.includes("finance.view_summary")) {
    return item;
  }
  return {
    ...item,
    sports_profile: {
      ...item.sports_profile,
      revenue_share_enabled: null,
      revenue_share_terms_summary: null
    }
  };
}

export function sanitizeWatchFlagListItem(auth: AuthUser, item: WatchFlagListItem): WatchFlagListItem {
  if (auth.permissions.includes("watchlist.read")) {
    return item;
  }
  return {
    ...item,
    description: null
  };
}

export function sanitizeProductionQueueItem(auth: AuthUser, item: ProductionQueueItem): ProductionQueueItem {
  if (auth.permissions.includes("production.read")) {
    return item;
  }
  return {
    ...item,
    blocked_reason: null
  };
}

export function sanitizeWatchlistResponse(auth: AuthUser, payload: WatchlistResponse): WatchlistResponse {
  return {
    ...payload,
    items: payload.items.map((item) => sanitizeWatchFlagListItem(auth, item))
  };
}

export function sanitizeDashboardResponse(auth: AuthUser, payload: DashboardResponse): DashboardResponse {
  return {
    ...payload,
    urgent_watch: payload.urgent_watch.map((item) => sanitizeWatchFlagListItem(auth, item)),
    upcoming_risks: payload.upcoming_risks.map((item) => sanitizeWatchFlagListItem(auth, item)),
    blocked_production: payload.blocked_production.map((item) => sanitizeProductionQueueItem(auth, item))
  };
}
