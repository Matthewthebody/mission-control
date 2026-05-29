import type { ChecklistInstanceDetail } from "../../checklistTypes";
import { StatusPill, formatDateTime, humanizeToken } from "../sports/SportsPrimitives";

export type ChecklistRecordSummary = {
  total_count: number;
  open_count: number;
  overdue_count: number;
  awaiting_approval_count: number;
  rejected_count: number;
  blocked_count: number;
  missing_proof_count: number;
  blocking_instance_id: string | null;
  blocking_title: string | null;
};

function isChecklistClosed(instance: ChecklistInstanceDetail) {
  return instance.status === "approved" || instance.status === "waived";
}

function isChecklistBlocked(instance: ChecklistInstanceDetail) {
  return (
    instance.blocking_level !== "none" &&
    (instance.progress.missing_item_ids.length > 0 ||
      instance.progress.missing_proof_item_ids.length > 0 ||
      instance.progress.missing_approval)
  );
}

function byChecklistPriority(left: ChecklistInstanceDetail, right: ChecklistInstanceDetail) {
  const leftRank =
    left.status === "overdue"
      ? 0
      : isChecklistBlocked(left)
        ? 1
        : left.status === "rejected"
          ? 2
          : left.progress.missing_approval
            ? 3
            : left.progress.missing_proof_item_ids.length
              ? 4
              : 5;
  const rightRank =
    right.status === "overdue"
      ? 0
      : isChecklistBlocked(right)
        ? 1
        : right.status === "rejected"
          ? 2
          : right.progress.missing_approval
            ? 3
            : right.progress.missing_proof_item_ids.length
              ? 4
              : 5;
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  const leftDue = left.due_at ? new Date(left.due_at).getTime() : Number.MAX_SAFE_INTEGER;
  const rightDue = right.due_at ? new Date(right.due_at).getTime() : Number.MAX_SAFE_INTEGER;
  return leftDue - rightDue;
}

export function buildChecklistRecordSummary(instances: ChecklistInstanceDetail[]): ChecklistRecordSummary {
  const openInstances = instances.filter((instance) => !isChecklistClosed(instance));
  const blockingInstance = [...openInstances].sort(byChecklistPriority).find(
    (instance) =>
      instance.status === "overdue" ||
      isChecklistBlocked(instance) ||
      instance.status === "rejected" ||
      instance.progress.missing_approval ||
      instance.progress.missing_proof_item_ids.length > 0
  );

  return {
    total_count: instances.length,
    open_count: openInstances.length,
    overdue_count: openInstances.filter((instance) => instance.status === "overdue").length,
    awaiting_approval_count: openInstances.filter(
      (instance) => instance.progress.approval_required && instance.progress.missing_approval && instance.status === "submitted"
    ).length,
    rejected_count: openInstances.filter((instance) => instance.status === "rejected").length,
    blocked_count: openInstances.filter((instance) => isChecklistBlocked(instance)).length,
    missing_proof_count: openInstances.filter((instance) => instance.progress.missing_proof_item_ids.length > 0).length,
    blocking_instance_id: blockingInstance?.id ?? null,
    blocking_title: blockingInstance?.title ?? null
  };
}

type ChecklistStatusSummaryProps = {
  instances: ChecklistInstanceDetail[];
  title?: string;
  summary?: string;
  compact?: boolean;
  onOpenBlockingChecklist?: (instanceId: string) => void;
};

export function ChecklistStatusSummary({
  instances,
  title = "Workflow Checklists",
  summary = "Readiness, proof, approvals, and hard workflow blocks.",
  compact = false,
  onOpenBlockingChecklist
}: ChecklistStatusSummaryProps) {
  const checklistSummary = buildChecklistRecordSummary(instances);
  if (!checklistSummary.total_count) {
    return null;
  }

  const blockingInstance = checklistSummary.blocking_instance_id
    ? instances.find((instance) => instance.id === checklistSummary.blocking_instance_id) ?? null
    : null;

  return (
    <section className={`checklist-status-summary${compact ? " checklist-status-summary--compact" : ""}`}>
      <div className="checklist-status-summary__copy">
        <strong>{title}</strong>
        <span>{summary}</span>
      </div>
      <div className="checklist-status-summary__badges">
        <StatusPill label={`${checklistSummary.open_count} open`} tone={checklistSummary.open_count ? "info" : "success"} />
        {checklistSummary.overdue_count ? <StatusPill label={`${checklistSummary.overdue_count} overdue`} tone="danger" /> : null}
        {checklistSummary.blocked_count ? <StatusPill label={`${checklistSummary.blocked_count} blocked`} tone="danger" /> : null}
        {checklistSummary.awaiting_approval_count ? <StatusPill label={`${checklistSummary.awaiting_approval_count} awaiting approval`} tone="warning" /> : null}
        {checklistSummary.rejected_count ? <StatusPill label={`${checklistSummary.rejected_count} rejected`} tone="warning" /> : null}
        {checklistSummary.missing_proof_count ? <StatusPill label={`${checklistSummary.missing_proof_count} missing proof`} tone="warning" /> : null}
      </div>
      {blockingInstance ? (
        <div className="checklist-status-summary__attention">
          <div>
            <strong>{blockingInstance.title}</strong>
            <span>
              {humanizeToken(blockingInstance.status)}
              {blockingInstance.due_at ? ` | due ${formatDateTime(blockingInstance.due_at)}` : ""}
            </span>
          </div>
          {onOpenBlockingChecklist ? (
            <button type="button" className="secondary-button" onClick={() => onOpenBlockingChecklist(blockingInstance.id)}>
              Open Blocking Checklist
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
