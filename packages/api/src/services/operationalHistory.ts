import type { PoolClient } from "pg";
import type { AuthUser } from "../types/auth.js";
import type { ReportsWorkspaceHistoryFocus, ReportsWorkspaceHistoryItem, ReportsWorkspaceHistorySection } from "../types/reportsWorkspace.js";
import type { WorkflowHistoryRecord } from "../types/workflowDomain.js";
import { listWorkflowHistory } from "./workflowDomain.js";

type NotificationHistoryRow = {
  id: string;
  event_type: string;
  category: string;
  severity: string;
  title: string;
  body: string;
  deep_link: string | null;
  actor_name: string | null;
  created_at: string;
};

type AuditHistoryRow = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_name: string | null;
  reason_comment: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const FOCUS_LABELS: Record<ReportsWorkspaceHistoryFocus, string> = {
  all: "All",
  watch: "Exceptions",
  staffing: "Staffing",
  attendance: "Attendance",
  production: "Production",
  approvals: "Approvals",
  notifications: "Notifications",
  audit: "Audit"
};

type HistoryCandidate = ReportsWorkspaceHistoryItem & {
  sort_key: string;
};

export async function getOperationalHistorySection(
  client: PoolClient,
  auth: AuthUser,
  input: {
    focus?: ReportsWorkspaceHistoryFocus | null;
    department?: string | null;
    limit?: number;
  } = {}
): Promise<ReportsWorkspaceHistorySection> {
  const focus = input.focus ?? "all";
  const limit = Math.max(10, Math.min(input.limit ?? 18, 60));
  const includeAdminAudit = !input.department;

  const workflowHistory = await listWorkflowHistory(client, auth.tenantId, {
    department: input.department ?? null,
    limit: 120
  });
  const notificationHistory = includeAdminAudit ? await loadNotificationHistory(client, auth.tenantId, 30) : [];
  const auditHistory = includeAdminAudit ? await loadAuditHistory(client, auth.tenantId, 25) : [];

  const candidates = [
    ...workflowHistory.map(mapWorkflowHistory),
    ...notificationHistory.map(mapNotificationHistory),
    ...auditHistory.map(mapAuditHistory)
  ].sort((left, right) => compareIsoDesc(left.sort_key, right.sort_key));

  const counts = countByFocus(candidates);
  const filtered = focus === "all" ? candidates : candidates.filter((item) => item.focus === focus);
  const items = filtered.slice(0, limit).map(stripSortKey);
  const latestEventAt = candidates[0]?.sort_key ?? null;

  return {
    generated_at: new Date().toISOString(),
    summary_line: latestEventAt
      ? `Recent workflow, notification, and audit signals are composed here so reporting can investigate drift without pretending to own the live queues.`
      : "No recent operational history is available in this reporting scope yet.",
    focus,
    focus_options: (Object.keys(FOCUS_LABELS) as ReportsWorkspaceHistoryFocus[]).map((id) => ({
      id,
      label: FOCUS_LABELS[id],
      count: counts[id] ?? 0
    })),
    items
  };
}

async function loadNotificationHistory(client: PoolClient, tenantId: string, limit: number) {
  const { rows } = await client.query<NotificationHistoryRow>(
    `
      SELECT
        event.id::text,
        event.event_type::text,
        notification.category::text AS category,
        notification.severity::text AS severity,
        notification.title,
        notification.body,
        notification.deep_link,
        actor.full_name AS actor_name,
        event.created_at::text
      FROM ops_notification_event event
      JOIN ops_notification notification
        ON notification.tenant_id = event.tenant_id
       AND notification.id = event.notification_id
      LEFT JOIN app_user actor
        ON actor.id = event.actor_user_id
      WHERE event.tenant_id = $1
      ORDER BY event.created_at DESC
      LIMIT $2
    `,
    [tenantId, limit]
  );
  return rows;
}

async function loadAuditHistory(client: PoolClient, tenantId: string, limit: number) {
  const { rows } = await client.query<AuditHistoryRow>(
    `
      SELECT
        audit.id::text,
        audit.action,
        audit.entity_type,
        audit.entity_id::text,
        actor.full_name AS actor_name,
        audit.reason_comment,
        audit.metadata,
        audit.created_at::text
      FROM audit_log audit
      LEFT JOIN app_user actor
        ON actor.id = audit.actor_user_id
      WHERE audit.tenant_id = $1
        AND (
          audit.action LIKE 'reporting.%'
          OR audit.action LIKE 'integration.%'
          OR audit.action LIKE 'access.%'
          OR audit.action LIKE 'admin.%'
          OR audit.action LIKE 'security.%'
        )
      ORDER BY audit.created_at DESC
      LIMIT $2
    `,
    [tenantId, limit]
  );
  return rows;
}

function mapWorkflowHistory(item: WorkflowHistoryRecord): HistoryCandidate {
  const focus =
    item.module === "watch"
      ? "watch"
      : item.module === "staffing" || item.module === "assignments"
        ? "staffing"
        : item.module === "attendance"
          ? "attendance"
          : item.module === "production"
            ? "production"
            : "approvals";
  return {
    id: `workflow:${item.id}`,
    focus,
    source: "workflow",
    module_label: humanizeModuleLabel(item.module),
    title: humanizeEventLabel(item.event_type),
    summary: item.summary,
    note: item.note,
    actor_label: item.actor_name ?? "System",
    created_at: item.created_at,
    action_hash: actionHashForWorkflowModule(item),
    confidence_label: "Direct workflow event",
    chips: [
      { label: humanizeModuleLabel(item.module) },
      ...(item.scope_department ? [{ label: humanizeValue(item.scope_department), tone: "info" as const }] : [])
    ],
    sort_key: item.created_at
  };
}

function mapNotificationHistory(item: NotificationHistoryRow): HistoryCandidate {
  const focus = focusForNotificationCategory(item.category);
  return {
    id: `notification:${item.id}`,
    focus,
    source: "notification",
    module_label: "Notification",
    title: humanizeEventLabel(item.event_type),
    summary: item.title,
    note: item.body,
    actor_label: item.actor_name ?? "System",
    created_at: item.created_at,
    action_hash: item.deep_link ?? actionHashForHistoryFocus(focus),
    confidence_label: "Notification history",
    chips: [
      { label: humanizeValue(item.category) },
      { label: humanizeValue(item.severity), tone: toneForSeverity(item.severity) }
    ],
    sort_key: item.created_at
  };
}

function mapAuditHistory(item: AuditHistoryRow): HistoryCandidate {
  return {
    id: `audit:${item.id}`,
    focus: "audit",
    source: "audit",
    module_label: "Audit",
    title: humanizeEventLabel(item.action),
    summary: `${humanizeValue(item.entity_type)} ${item.entity_id ?? ""}`.trim(),
    note: item.reason_comment,
    actor_label: item.actor_name ?? "System",
    created_at: item.created_at,
    action_hash: "#admin/audit",
    confidence_label: "Audit log",
    chips: [
      { label: humanizeValue(item.entity_type) },
      { label: "Admin trail", tone: "warning" }
    ],
    sort_key: item.created_at
  };
}

function countByFocus(items: HistoryCandidate[]) {
  return items.reduce<Record<ReportsWorkspaceHistoryFocus, number>>(
    (accumulator, item) => {
      accumulator.all += 1;
      accumulator[item.focus] += 1;
      return accumulator;
    },
    {
      all: 0,
      watch: 0,
      staffing: 0,
      attendance: 0,
      production: 0,
      approvals: 0,
      notifications: 0,
      audit: 0
    }
  );
}

function stripSortKey(item: HistoryCandidate): ReportsWorkspaceHistoryItem {
  return {
    id: item.id,
    focus: item.focus,
    source: item.source,
    module_label: item.module_label,
    title: item.title,
    summary: item.summary,
    note: item.note,
    actor_label: item.actor_label,
    created_at: item.created_at,
    action_hash: item.action_hash,
    confidence_label: item.confidence_label,
    chips: item.chips
  };
}

function focusForNotificationCategory(category: string): ReportsWorkspaceHistoryFocus {
  if (category === "urgent_operational_risk") return "watch";
  if (category === "staffing" || category === "schedule_change") return "staffing";
  if (category === "attendance_time") return "attendance";
  if (category === "approval_needed") return "approvals";
  if (category === "production") return "production";
  return "notifications";
}

function actionHashForWorkflowModule(item: WorkflowHistoryRecord) {
  switch (item.module) {
    case "watch":
      return "#operations/exceptions";
    case "assignments":
    case "staffing":
      return "#operations/staffing?area=staffing";
    case "attendance":
      return "#operations/attendance";
    case "production":
      return "#production";
    case "approvals":
      return "#approvals";
    default:
      return "#reports";
  }
}

function actionHashForHistoryFocus(focus: ReportsWorkspaceHistoryFocus) {
  switch (focus) {
    case "watch":
      return "#operations/exceptions";
    case "staffing":
      return "#operations/staffing?area=staffing";
    case "attendance":
      return "#operations/attendance";
    case "production":
      return "#production";
    case "approvals":
      return "#approvals";
    case "audit":
      return "#admin/audit";
    default:
      return "#dashboard/alerts";
  }
}

function humanizeModuleLabel(module: WorkflowHistoryRecord["module"]) {
  switch (module) {
    case "assignments":
      return "Assignments";
    case "staffing":
      return "Staffing";
    case "watch":
      return "Exceptions";
    case "production":
      return "Production";
    case "approvals":
      return "Approvals";
    case "attendance":
      return "Attendance";
    default:
      return humanizeValue(module);
  }
}

function toneForSeverity(value: string) {
  if (value === "critical") return "critical";
  if (value === "high") return "warning";
  return "neutral";
}

function humanizeEventLabel(value: string) {
  return humanizeValue(value);
}

function humanizeValue(value: string) {
  return value.replace(/[._]/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function compareIsoDesc(left: string, right: string) {
  return right.localeCompare(left);
}
