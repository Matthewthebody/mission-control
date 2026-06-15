import type { OperatingArea } from "./homeRoles";

// Centralized Needs Attention logic. This is intentionally strict and easy to
// replace later with real backend signals. Something is "Needs Attention" ONLY
// if it meets one or more of the six locked rules below — nothing fuzzy or
// nice-to-know belongs here.

export type NeedsAttentionReason =
  | "late"
  | "not_acknowledged"
  | "affects_client_or_shoot_72h"
  | "behind_promised_delivery"
  | "blocked_no_owner"
  | "missing_required_details";

export const NEEDS_ATTENTION_REASON_LABELS: Record<NeedsAttentionReason, string> = {
  late: "Late",
  not_acknowledged: "Not acknowledged",
  affects_client_or_shoot_72h: "Affects client/shoot within 72 hours",
  behind_promised_delivery: "Behind promised delivery",
  blocked_no_owner: "Blocked with no clear owner",
  missing_required_details: "Missing required details"
};

export type NeedsAttentionSeverity = "urgent" | "watch" | "info";

export const NEEDS_ATTENTION_SEVERITY_LABELS: Record<NeedsAttentionSeverity, string> = {
  urgent: "Urgent",
  watch: "Watch",
  info: "Info"
};

export type NeedsAttentionStatus = "open" | "in_progress" | "waiting" | "resolved";

export type NeedsAttentionItem = {
  id: string;
  area: OperatingArea;
  title: string;
  issue: string;
  owner: string;
  nextAction: string;
  dueAt?: string;
  ageLabel?: string;
  relatedJobId?: string;
  relatedJobName?: string;
  reasons: NeedsAttentionReason[];
  severity: NeedsAttentionSeverity;
  status: NeedsAttentionStatus;
};

// An item qualifies for Needs Attention only when it is unresolved AND carries
// at least one of the six locked reasons. Routine, on-schedule, or purely
// informational work has no reasons and therefore never appears.
export function isNeedsAttention(item: NeedsAttentionItem): boolean {
  return item.status !== "resolved" && item.reasons.length > 0;
}

export function getNeedsAttentionReasons(item: NeedsAttentionItem): NeedsAttentionReason[] {
  return item.reasons;
}

export function getNeedsAttentionSeverity(item: NeedsAttentionItem): NeedsAttentionSeverity {
  return item.severity;
}

export function getNeedsAttentionOwner(item: NeedsAttentionItem): string {
  return item.owner;
}

export function getNeedsAttentionNextAction(item: NeedsAttentionItem): string {
  return item.nextAction;
}

const SEVERITY_RANK: Record<NeedsAttentionSeverity, number> = {
  urgent: 0,
  watch: 1,
  info: 2
};

// Lower rank sorts first. Encodes the locked priority: imminent 72-hour
// shoot/client risk, then a broken delivery promise, then blocked-with-no-owner,
// then late, then missing required details, then not-acknowledged.
const REASON_RANK: Record<NeedsAttentionReason, number> = {
  affects_client_or_shoot_72h: 0,
  behind_promised_delivery: 1,
  blocked_no_owner: 2,
  late: 3,
  missing_required_details: 4,
  not_acknowledged: 5
};

function bestReasonRank(item: NeedsAttentionItem): number {
  return item.reasons.reduce((best, reason) => Math.min(best, REASON_RANK[reason]), Number.MAX_SAFE_INTEGER);
}

// Filter to real Needs Attention items and sort by the locked order:
// 1) Urgent > Watch > Info, 2) reason priority (72h / behind delivery /
// blocked-no-owner / late / missing details / not acknowledged), 3) emphasized
// department rises slightly within ties.
// The emphasized area never hides other company issues — it is only a tiebreaker.
export function selectNeedsAttention(
  items: NeedsAttentionItem[],
  emphasizedArea?: OperatingArea
): NeedsAttentionItem[] {
  return items
    .filter(isNeedsAttention)
    .slice()
    .sort((left, right) => {
      const severity = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
      if (severity !== 0) {
        return severity;
      }
      const reason = bestReasonRank(left) - bestReasonRank(right);
      if (reason !== 0) {
        return reason;
      }
      if (emphasizedArea && emphasizedArea !== "company") {
        const leftEmphasis = left.area === emphasizedArea ? 0 : 1;
        const rightEmphasis = right.area === emphasizedArea ? 0 : 1;
        if (leftEmphasis !== rightEmphasis) {
          return leftEmphasis - rightEmphasis;
        }
      }
      return left.id.localeCompare(right.id);
    });
}

export function countBySeverity(items: NeedsAttentionItem[]): Record<NeedsAttentionSeverity, number> {
  return items.filter(isNeedsAttention).reduce(
    (counts, item) => {
      counts[item.severity] += 1;
      return counts;
    },
    { urgent: 0, watch: 0, info: 0 } as Record<NeedsAttentionSeverity, number>
  );
}
