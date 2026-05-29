import type { PoolClient } from "pg";
import { loadLiveShootQueue, type LiveShootQueueSource } from "../shoots/load-live-shoot-queue.action.js";
import type { LiveShootQueueProjection } from "../../domain/lifecycle/live-shoot-queue-projection.js";
import { listComplianceWorkspaceItems } from "../../services/complianceWorkspace.js";
import { getDirectoryOperationsQueues } from "../../services/organizationOperations.js";
import { getPayrollReview } from "../../services/payrollReview.js";
import { getProductionProjectManagerQueues } from "../../services/productionProjects.js";
import { listSecurityApprovalRequests } from "../../services/securityApprovals.js";
import type { ManagerCockpitQueue, ManagerCockpitQueueItem, ManagerCockpitResponse } from "../../types/managerCockpit.js";
import type { AuthUser } from "../../types/auth.js";

export async function loadManagerCockpit(
  client: PoolClient,
  auth: AuthUser,
  options: { date: string; liveQueue?: LiveShootQueueProjection<LiveShootQueueSource> }
): Promise<ManagerCockpitResponse> {
  const liveQueue = options.liveQueue ?? (await loadLiveShootQueue(client, { date: options.date }, auth));
  const directoryQueues = await getDirectoryOperationsQueues(client, auth, { anchorDate: options.date });
  const approvals = await listSecurityApprovalRequests(client, auth, { status: "pending" });
  const compliance = await listComplianceWorkspaceItems(client, auth, { date: options.date, status: "unresolved", window: "all" });
  const payroll = await getPayrollReview(client, auth, {});
  const projectQueues = await getProductionProjectManagerQueues(client, auth, { anchorDate: options.date });

  const payrollComplianceItems: ManagerCockpitQueueItem[] = [
    ...compliance.rows
      .filter((item) => item.status_bucket === "unresolved")
      .slice(0, 8)
      .map((item): ManagerCockpitQueueItem => ({
        id: item.id,
        entity_kind: "compliance_review",
        entity_id: item.source_id,
        organization_id: item.organization_id,
        shoot_id: item.shoot_id,
        title: item.employee_name || item.issue_label,
        summary: item.message,
        owner_label: item.organization_display_name || item.location_name || "Review queue",
        due_label: item.payroll_blocking ? "Payroll blocking" : item.mileage_blocking ? "Mileage blocking" : null,
        status_label: item.issue_label,
        status_tone: item.urgency === "urgent" ? "critical" : "warning",
        next_action: "Review compliance item",
        action_hash: "#compliance",
        flags: [
          ...(item.payroll_blocking ? [{ label: "Payroll blocking", tone: "critical" as const }] : []),
          ...(item.mileage_blocking ? [{ label: "Mileage blocking", tone: "warning" as const }] : [])
        ]
      })),
    ...payroll.rows
      .filter((row) => row.export_readiness === "blocked")
      .slice(0, 8)
      .map((row): ManagerCockpitQueueItem => ({
        id: `payroll:${row.employee_id}`,
        entity_kind: "payroll_review",
        entity_id: row.employee_id,
        organization_id: null,
        shoot_id: null,
        title: row.employee_name || row.employee_id,
        summary: row.review_issues.map((issue) => issue.label).join(" | ") || "Payroll review is blocked.",
        owner_label: row.department || "Payroll review",
        due_label: "Blocked for export",
        status_label: "Payroll Review",
        status_tone: "critical",
        next_action: "Resolve payroll blockers",
        action_hash: "#payroll",
        flags: row.review_issues
          .filter((issue) => issue.blocks_export)
          .map((issue) => ({ label: issue.label, tone: issue.severity === "important" ? ("critical" as const) : ("warning" as const) }))
      }))
  ];

  const queues: ManagerCockpitQueue[] = [
    {
      id: "needs_staffing",
      label: "Needs Staffing",
      summary: "Shoots with open staffing pressure or missing lead coverage.",
      count: liveQueue.sections.find((section) => section.id === "needs_staffing")?.items.length ?? 0,
      items:
        liveQueue.sections
          .find((section) => section.id === "needs_staffing")
          ?.items.map<ManagerCockpitQueueItem>((entry) => ({
            id: `shoot:${entry.shoot.id}`,
            entity_kind: "shoot",
            entity_id: entry.shoot.id,
            organization_id: "organization_id" in entry.shoot && typeof entry.shoot.organization_id === "string" ? entry.shoot.organization_id : null,
            shoot_id: entry.shoot.id,
            title: entry.shoot.title,
            summary: entry.summary_string,
            owner_label: entry.owner_label,
            due_label: "shoot_date" in entry.shoot && entry.shoot.shoot_date ? `Shoot ${entry.shoot.shoot_date}` : null,
            status_label: entry.status_label,
            status_tone: entry.status_tone,
            next_action: entry.next_action,
            action_hash: "#shoots",
            flags: entry.key_flags.map((flag) => ({ label: flag.label, tone: flag.tone }))
          })) ?? []
    },
    {
      id: "needs_contact_cleanup",
      label: "Needs Contact Cleanup",
      summary: "Accounts with primary-owner, duplicate, or location-contact gaps.",
      count: directoryQueues.contact_cleanup.length,
      items: directoryQueues.contact_cleanup
    },
    {
      id: "needs_approval",
      label: "Needs Approval",
      summary: "Pending approval work that still needs leadership review.",
      count: approvals.length,
      items: approvals.map((request) => ({
        id: request.id,
        entity_kind: "approval_request",
        entity_id: request.id,
        organization_id: null,
        shoot_id: null,
        title: humanizeValue(request.request_type),
        summary: request.reason || "Approval request is waiting on review.",
        owner_label: request.requester_name || request.requester_email || "Requester unknown",
        due_label: `Opened ${new Date(request.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
        status_label: "Pending Approval",
        status_tone: "warning",
        next_action: "Review the approval request",
        action_hash: "#approvals",
        flags: [{ label: humanizeValue(request.action_code), tone: "warning" }]
      }))
    },
    {
      id: "needs_follow_up",
      label: "Needs Follow-Up",
      summary: "Accounts that need outreach, follow-up logging, or next-step confirmation.",
      count: directoryQueues.follow_up.length,
      items: directoryQueues.follow_up
    },
    {
      id: "needs_project_setup",
      label: "Needs Production Setup",
      summary: "Triggered or manual production work still missing an owner, due date, or kickoff.",
      count: projectQueues.needs_project_setup.length,
      items: projectQueues.needs_project_setup
    },
    {
      id: "needs_project_follow_up",
      label: "Needs Production Follow-Up",
      summary: "Production work where follow-up is due and the operational loop still needs attention.",
      count: projectQueues.needs_project_follow_up.length,
      items: projectQueues.needs_project_follow_up
    },
    {
      id: "overdue_project_tasks",
      label: "Overdue Production Tasks",
      summary: "Production checklist work that is already overdue.",
      count: projectQueues.overdue_project_tasks.length,
      items: projectQueues.overdue_project_tasks
    },
    {
      id: "needs_payroll_compliance_review",
      label: "Needs Payroll / Compliance Review",
      summary: "Unresolved payroll blockers and compliance review work.",
      count:
        compliance.rows.filter((item) => item.status_bucket === "unresolved").length +
        payroll.rows.filter((row) => row.export_readiness === "blocked").length,
      items: payrollComplianceItems
    }
  ];

  return {
    generated_at: new Date().toISOString(),
    anchor_date: options.date,
    headline: "Manager action queue",
    summary: {
      total_open: queues.reduce((sum, queue) => sum + queue.count, 0),
      needs_staffing: queues[0].count,
      needs_contact_cleanup: queues[1].count,
      needs_approval: queues[2].count,
      needs_follow_up: queues[3].count,
      needs_project_setup: queues[4].count,
      needs_project_follow_up: queues[5].count,
      overdue_project_tasks: queues[6].count,
      needs_payroll_compliance_review: queues[7].count
    },
    queues
  };
}

function humanizeValue(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}
