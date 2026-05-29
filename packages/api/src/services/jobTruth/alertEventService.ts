import type { PoolClient } from "pg";
import { hasAuthorityTier } from "../../authz/authority.js";
import { ApiError } from "../../errors/apiError.js";
import type { JobDepartmentType, JobWatchFlagSeverity, JobWatchFlagStatus } from "../../domain/jobTruth/index.js";
import type { AuthUser } from "../../types/auth.js";
import type { AlertCenterResponse, AlertEventRecord, AlertFeedItem, AlertCenterSummary, JobWatchFlagRecord } from "../../types/jobTruth.js";
import { createAuditLog } from "../audit.js";

type AlertJobContext = {
  id: string;
  department_type: JobDepartmentType;
  job_number: string | null;
  title: string;
  event_name: string | null;
  account_owner_user_id: string | null;
  organization_name: string | null;
};

type AlertWatchFlagContext = {
  tenantId: string;
  actorUserId?: string | null;
  job: AlertJobContext;
  watchFlag: JobWatchFlagRecord;
  trigger?: "created" | "updated" | "escalated" | "reopened";
};

type AlertWatchFlagRow = {
  flag: JobWatchFlagRecord;
  job: AlertJobContext;
};

function normalizeTimestamp(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function watchFlagIsActive(status: JobWatchFlagStatus) {
  return status === "open" || status === "acknowledged" || status === "snoozed";
}

function shouldTriggerWatchFlagAlert(flag: JobWatchFlagRecord) {
  if (!watchFlagIsActive(flag.status)) {
    return false;
  }
  if (flag.severity === "critical" || flag.severity === "high") {
    return true;
  }
  const dueAt = normalizeTimestamp(flag.due_at);
  if (!dueAt) {
    return false;
  }
  return new Date(dueAt).getTime() - Date.now() <= 24 * 60 * 60 * 1000;
}

function buildAlertType(flag: JobWatchFlagRecord, trigger: AlertWatchFlagContext["trigger"]) {
  if (trigger === "escalated" || flag.escalated_at) {
    return "watch_flag_escalated";
  }
  if (trigger === "reopened") {
    return "watch_flag_reopened";
  }
  if (flag.severity === "critical") {
    return "critical_watch_flag";
  }
  if (flag.flag_type === "ready_confirmation_missing") {
    return "ready_confirmation_missing";
  }
  if (flag.flag_type === "production_blocked") {
    return "production_blocked";
  }
  if (flag.flag_type === "approval_delay") {
    return "approval_overdue";
  }
  if (flag.flag_type === "delivery_issue") {
    return "delivery_issue";
  }
  if (flag.flag_type === "missing_files") {
    return "missing_files";
  }
  if (flag.flag_type === "production_overdue") {
    return "production_overdue";
  }
  if (flag.flag_type === "stalled_stage") {
    return "production_stalled";
  }
  if (flag.flag_type === "upload_failure") {
    return "upload_failure";
  }
  if (flag.flag_type === "qa_rework_escalation") {
    return "qa_rework_escalated";
  }
  if (flag.flag_type === "hold_review_due") {
    return "hold_review_due";
  }
  if (flag.flag_type === "checklist_due_soon" || flag.flag_type === "checklist_due_now") {
    return "checklist_due";
  }
  if (flag.flag_type === "checklist_overdue") {
    return "checklist_overdue";
  }
  if (flag.flag_type === "checklist_escalation") {
    return "checklist_escalated";
  }
  return "watch_flag_open";
}

function buildAlertMessage(job: AlertJobContext, flag: JobWatchFlagRecord) {
  const jobLabel = job.job_number ?? job.event_name ?? job.title;
  const prefix =
    flag.severity === "critical"
      ? "Critical issue"
      : flag.severity === "high"
        ? "High-priority issue"
        : "Operational issue";
  return `${prefix} on ${jobLabel}: ${flag.title}`;
}

function buildAlertDedupeKey(flag: JobWatchFlagRecord, trigger: AlertWatchFlagContext["trigger"]) {
  return [
    "watch-flag",
    flag.id,
    trigger ?? "steady-state",
    flag.severity,
    flag.status,
    flag.owner_user_id ?? "unowned",
    flag.escalated_to_role ?? "none"
  ].join(":");
}

async function listAlertRecipientIds(client: PoolClient, tenantId: string, job: AlertJobContext, flag: JobWatchFlagRecord) {
  const directRecipients = new Set<string>();
  if (flag.owner_user_id) {
    directRecipients.add(flag.owner_user_id);
  }
  if (flag.created_by_user_id) {
    directRecipients.add(flag.created_by_user_id);
  }
  if (job.account_owner_user_id) {
    directRecipients.add(job.account_owner_user_id);
  }

  if (flag.production_item_id) {
    const { rows } = await client.query<{
      assigned_to_user_id: string | null;
      assigned_peer_reviewer_user_id: string | null;
      assigned_release_reviewer_user_id: string | null;
      escalation_owner_user_id: string | null;
      department_owner_user_id: string | null;
      hold_owner_user_id: string | null;
    }>(
      `
        SELECT
          assigned_to_user_id::text AS assigned_to_user_id,
          assigned_peer_reviewer_user_id::text AS assigned_peer_reviewer_user_id,
          assigned_release_reviewer_user_id::text AS assigned_release_reviewer_user_id,
          escalation_owner_user_id::text AS escalation_owner_user_id,
          department_owner_user_id::text AS department_owner_user_id,
          hold_owner_user_id::text AS hold_owner_user_id
        FROM production_items
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [tenantId, flag.production_item_id]
    );
    const item = rows[0];
    if (item) {
      [
        item.assigned_to_user_id,
        item.assigned_peer_reviewer_user_id,
        item.assigned_release_reviewer_user_id,
        item.escalation_owner_user_id,
        item.department_owner_user_id,
        item.hold_owner_user_id
      ].forEach((recipientId) => {
        if (recipientId) {
          directRecipients.add(recipientId);
        }
      });
    }
  }

  const fallbackIds = [...directRecipients];
  const sentinel = "00000000-0000-0000-0000-000000000000";
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT DISTINCT id::text AS id
      FROM app_user user_record
      LEFT JOIN user_authority_assignment authority_assignment
        ON authority_assignment.tenant_id = user_record.tenant_id
       AND authority_assignment.user_id = user_record.id
      WHERE user_record.tenant_id = $1
        AND (
          user_record.id = ANY($2::uuid[])
          OR authority_assignment.authority_tier::text = ANY($3::text[])
          OR (
            $4::text IS NOT NULL
            AND user_record.department::text = $4::text
            AND authority_assignment.authority_tier::text = 'supervisor'
          )
        )
    `,
    [
      tenantId,
      fallbackIds.length > 0 ? fallbackIds : [sentinel],
      ["super_admin", "leadership", "director_admin"],
      job.department_type === "schools" || job.department_type === "sports" ? job.department_type : null
    ]
  );
  return rows.map((row) => row.id);
}

export async function resolveAlertsForWatchFlag(client: PoolClient, tenantId: string, watchFlagId: string) {
  await client.query(
    `
      UPDATE alert_events
      SET status = 'resolved',
          updated_at = now()
      WHERE tenant_id = $1
        AND watch_flag_id = $2
        AND status <> 'resolved'
    `,
    [tenantId, watchFlagId]
  );
}

export async function syncWatchFlagAlert(client: PoolClient, input: AlertWatchFlagContext) {
  if (!watchFlagIsActive(input.watchFlag.status)) {
    await resolveAlertsForWatchFlag(client, input.tenantId, input.watchFlag.id);
    return;
  }
  if (!shouldTriggerWatchFlagAlert(input.watchFlag)) {
    return;
  }

  const dedupeKey = buildAlertDedupeKey(input.watchFlag, input.trigger);
  const recent = await client.query<{ id: string }>(
    `
      SELECT id::text AS id
      FROM alert_events
      WHERE tenant_id = $1
        AND dedupe_key = $2
        AND triggered_at >= now() - interval '60 minutes'
      LIMIT 1
    `,
    [input.tenantId, dedupeKey]
  );
  if (recent.rowCount) {
    return;
  }

  const { rows } = await client.query<AlertEventRecord>(
    `
      INSERT INTO alert_events (
        tenant_id,
        watch_flag_id,
        source_entity_type,
        source_entity_id,
        alert_type,
        severity,
        title,
        message,
        status,
        triggered_at,
        dedupe_key,
        payload_json
      )
      VALUES ($1,$2,$3,$4,$5,$6::job_watch_flag_severity_type,$7,$8,'open',now(),$9,$10::jsonb)
      RETURNING *
    `,
    [
      input.tenantId,
      input.watchFlag.id,
      input.watchFlag.source_entity_type ?? "job_watch_flag",
      input.watchFlag.source_entity_id ?? input.watchFlag.id,
      buildAlertType(input.watchFlag, input.trigger),
      input.watchFlag.severity,
      input.watchFlag.title,
      buildAlertMessage(input.job, input.watchFlag),
      dedupeKey,
      JSON.stringify({
        job_id: input.job.id,
        job_number: input.job.job_number,
        department_type: input.job.department_type,
        flag_type: input.watchFlag.flag_type,
        escalated_to_role: input.watchFlag.escalated_to_role,
        trigger: input.trigger ?? "updated"
      })
    ]
  );

  const recipients = await listAlertRecipientIds(client, input.tenantId, input.job, input.watchFlag);
  if (recipients.length) {
    await client.query(
      `
        INSERT INTO alert_deliveries (
          tenant_id,
          alert_event_id,
          recipient_user_id,
          delivery_channel,
          delivery_status,
          delivered_at
        )
        SELECT
          $1,
          $2,
          recipient_user_id,
          'in_app'::alert_delivery_channel_type,
          'delivered'::alert_delivery_status_type,
          now()
        FROM unnest($3::uuid[]) AS recipient_user_id
      `,
      [input.tenantId, rows[0].id, recipients]
    );
  }

  await createAuditLog(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    action: "job_truth.alert_event_created",
    entityType: "alert_event",
    entityId: rows[0].id,
    metadata: {
      watch_flag_id: input.watchFlag.id,
      job_id: input.job.id,
      alert_type: buildAlertType(input.watchFlag, input.trigger),
      recipient_count: recipients.length
    },
    sourceSurface: "job_truth_command_center"
  });
}

export async function syncWatchFlagAlertById(
  client: PoolClient,
  tenantId: string,
  watchFlagId: string,
  actorUserId?: string | null,
  trigger?: AlertWatchFlagContext["trigger"]
) {
  const context = await client.query<{
    tenant_id: string;
    flag_id: string;
    job_id: string;
    job_number: string | null;
    department_type: JobDepartmentType;
    title: string;
    event_name: string | null;
    account_owner_user_id: string | null;
    organization_name: string | null;
    job_day_id: string | null;
    production_item_id: string | null;
    approval_request_id: string | null;
    qa_review_record_id: string | null;
    deliverable_item_id: string | null;
    source_entity_type: string | null;
    source_entity_id: string | null;
    severity: JobWatchFlagSeverity;
    flag_type: string;
    flag_title: string;
    description: string;
    status: JobWatchFlagStatus;
    owner_user_id: string | null;
    created_by_user_id: string | null;
    due_at: string | null;
    snooze_until: string | null;
    escalated_at: string | null;
    escalated_to_role: string | null;
    resolved_at: string | null;
    resolved_by_user_id: string | null;
    auto_key: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT
        flag.tenant_id,
        flag.id::text AS flag_id,
        job.id::text AS job_id,
        job.job_number,
        job.department_type::text AS department_type,
        job.title,
        job.event_name,
        job.account_owner_user_id::text AS account_owner_user_id,
        org.display_name AS organization_name,
        flag.job_day_id::text AS job_day_id,
        flag.production_item_id::text AS production_item_id,
        flag.approval_request_id::text AS approval_request_id,
        flag.qa_review_record_id::text AS qa_review_record_id,
        flag.deliverable_item_id::text AS deliverable_item_id,
        flag.source_entity_type,
        flag.source_entity_id::text AS source_entity_id,
        flag.severity::text AS severity,
        flag.flag_type,
        flag.title AS flag_title,
        flag.description,
        flag.status::text AS status,
        flag.owner_user_id::text AS owner_user_id,
        flag.created_by_user_id::text AS created_by_user_id,
        flag.due_at,
        flag.snooze_until,
        flag.escalated_at,
        flag.escalated_to_role,
        flag.resolved_at,
        flag.resolved_by_user_id::text AS resolved_by_user_id,
        flag.auto_key,
        flag.created_at,
        flag.updated_at
      FROM job_watch_flags flag
      JOIN jobs job
        ON job.id = flag.job_id
       AND job.tenant_id = flag.tenant_id
      LEFT JOIN organization org
        ON org.id = job.organization_id
       AND org.tenant_id = job.tenant_id
      WHERE flag.tenant_id = $1
        AND flag.id = $2
      LIMIT 1
    `,
    [tenantId, watchFlagId]
  );
  if (!context.rowCount) {
    throw new ApiError(404, "Watch flag not found");
  }

  const row = context.rows[0];
  await syncWatchFlagAlert(client, {
    tenantId,
    actorUserId,
    trigger,
    job: {
      id: row.job_id,
      department_type: row.department_type,
      job_number: row.job_number,
      title: row.title,
      event_name: row.event_name,
      account_owner_user_id: row.account_owner_user_id,
      organization_name: row.organization_name
    },
    watchFlag: {
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
      title: row.flag_title,
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
      updated_at: row.updated_at
    }
  });
}

export async function listAlertCenter(client: PoolClient, auth: AuthUser, unreadOnly = false, limit = 100): Promise<AlertCenterResponse> {
  const { rows } = await client.query<{
    delivery_id: string;
    delivery_tenant_id: string;
    alert_event_id: string;
    recipient_user_id: string;
    delivery_channel: string;
    delivery_status: string;
    delivered_at: string | null;
    read_at: string | null;
    acted_at: string | null;
    action_type: string | null;
    delivery_created_at: string;
    delivery_updated_at: string;
    event_id: string;
    watch_flag_id: string | null;
    source_entity_type: string;
    source_entity_id: string | null;
    alert_type: string;
    severity: JobWatchFlagSeverity;
    title: string;
    message: string;
    event_status: string;
    triggered_at: string;
    dedupe_key: string;
    payload_json: Record<string, unknown> | null;
    event_created_at: string;
    event_updated_at: string;
    job_id: string | null;
    job_number: string | null;
    job_title: string | null;
    department_type: JobDepartmentType | null;
    organization_name: string | null;
    owner_name: string | null;
    recipient_name: string | null;
  }>(
    `
      SELECT
        delivery.id::text AS delivery_id,
        delivery.tenant_id AS delivery_tenant_id,
        delivery.alert_event_id::text AS alert_event_id,
        delivery.recipient_user_id::text AS recipient_user_id,
        delivery.delivery_channel::text AS delivery_channel,
        delivery.delivery_status::text AS delivery_status,
        delivery.delivered_at,
        delivery.read_at,
        delivery.acted_at,
        delivery.action_type,
        delivery.created_at AS delivery_created_at,
        delivery.updated_at AS delivery_updated_at,
        event.id::text AS event_id,
        event.watch_flag_id::text AS watch_flag_id,
        event.source_entity_type,
        event.source_entity_id::text AS source_entity_id,
        event.alert_type,
        event.severity::text AS severity,
        event.title,
        event.message,
        event.status AS event_status,
        event.triggered_at,
        event.dedupe_key,
        event.payload_json,
        event.created_at AS event_created_at,
        event.updated_at AS event_updated_at,
        flag.job_id::text AS job_id,
        job.job_number,
        COALESCE(NULLIF(job.event_name, ''), job.title) AS job_title,
        job.department_type::text AS department_type,
        org.display_name AS organization_name,
        owner.full_name AS owner_name,
        recipient.full_name AS recipient_name
      FROM alert_deliveries delivery
      JOIN alert_events event
        ON event.id = delivery.alert_event_id
       AND event.tenant_id = delivery.tenant_id
      LEFT JOIN job_watch_flags flag
        ON flag.id = event.watch_flag_id
       AND flag.tenant_id = event.tenant_id
      LEFT JOIN jobs job
        ON job.id = flag.job_id
       AND job.tenant_id = flag.tenant_id
      LEFT JOIN organization org
        ON org.id = job.organization_id
       AND org.tenant_id = job.tenant_id
      LEFT JOIN app_user owner
        ON owner.id = flag.owner_user_id
       AND owner.tenant_id = flag.tenant_id
      LEFT JOIN app_user recipient
        ON recipient.id = delivery.recipient_user_id
       AND recipient.tenant_id = delivery.tenant_id
      WHERE delivery.tenant_id = $1
        AND delivery.recipient_user_id = $2
        AND ($3::boolean = false OR delivery.read_at IS NULL)
      ORDER BY
        CASE event.severity::text
          WHEN 'critical' THEN 5
          WHEN 'high' THEN 4
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 2
          ELSE 1
        END DESC,
        event.triggered_at DESC
      LIMIT $4
    `,
    [auth.tenantId, auth.id, unreadOnly, limit]
  );

  const items: AlertFeedItem[] = rows.map((row) => ({
    id: row.delivery_id,
    tenant_id: row.delivery_tenant_id,
    alert_event_id: row.alert_event_id,
    watch_flag_id: row.watch_flag_id,
    recipient_user_id: row.recipient_user_id,
    delivery_channel: row.delivery_channel as AlertFeedItem["delivery_channel"],
    delivery_status: row.delivery_status as AlertFeedItem["delivery_status"],
    delivered_at: row.delivered_at,
    read_at: row.read_at,
    acted_at: row.acted_at,
    action_type: row.action_type,
    created_at: row.delivery_created_at,
    updated_at: row.delivery_updated_at,
    alert_event: {
      id: row.event_id,
      tenant_id: auth.tenantId,
      watch_flag_id: row.watch_flag_id,
      source_entity_type: row.source_entity_type,
      source_entity_id: row.source_entity_id,
      alert_type: row.alert_type,
      severity: row.severity,
      title: row.title,
      message: row.message,
      status: row.event_status,
      triggered_at: row.triggered_at,
      dedupe_key: row.dedupe_key,
      payload_json: row.payload_json,
      created_at: row.event_created_at,
      updated_at: row.event_updated_at
    },
    watch_flag: row.watch_flag_id
      ? {
          id: row.watch_flag_id,
          tenant_id: auth.tenantId,
          job_id: row.job_id ?? "",
          job_day_id: null,
          production_item_id: null,
          approval_request_id: null,
          qa_review_record_id: null,
          deliverable_item_id: null,
          source_entity_type: row.source_entity_type,
          source_entity_id: row.source_entity_id,
          severity: row.severity,
          flag_type: row.alert_type,
          title: row.title,
          description: row.message,
          status: "open",
          owner_user_id: null,
          owner_name: row.owner_name,
          created_by_user_id: null,
          due_at: null,
          snooze_until: null,
          escalated_at: null,
          escalated_to_role: null,
          resolved_at: null,
          resolved_by_user_id: null,
          auto_key: null,
          created_at: row.event_created_at,
          updated_at: row.event_updated_at
        }
      : null,
    job_id: row.job_id,
    job_number: row.job_number,
    job_title: row.job_title,
    department_type: row.department_type,
    organization_name: row.organization_name,
    recipient_name: row.recipient_name
  }));

  const summary: AlertCenterSummary = {
    unread_count: items.filter((item) => !item.read_at).length,
    critical_count: items.filter((item) => item.alert_event.severity === "critical").length,
    acted_count: items.filter((item) => item.acted_at).length
  };

  return { items, summary };
}

export async function markAlertDeliveryRead(client: PoolClient, auth: AuthUser, deliveryId: string) {
  const { rows } = await client.query<{ id: string; alert_event_id: string; read_at: string | null; acted_at: string | null; action_type: string | null }>(
    `
      UPDATE alert_deliveries
      SET read_at = COALESCE(read_at, now()),
          delivery_status = CASE WHEN delivery_status = 'acted_on'::alert_delivery_status_type THEN delivery_status ELSE 'read'::alert_delivery_status_type END,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
        AND recipient_user_id = $3
      RETURNING id::text AS id, alert_event_id::text AS alert_event_id, read_at, acted_at, action_type
    `,
    [auth.tenantId, deliveryId, auth.id]
  );
  if (!rows.length) {
    throw new ApiError(404, "Alert delivery not found");
  }
  return rows[0];
}

export async function markAlertDeliveryActed(client: PoolClient, auth: AuthUser, deliveryId: string, actionType: string) {
  const { rows } = await client.query<{ id: string; alert_event_id: string; read_at: string | null; acted_at: string | null; action_type: string | null }>(
    `
      UPDATE alert_deliveries
      SET acted_at = now(),
          action_type = $4,
          delivery_status = 'acted_on'::alert_delivery_status_type,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
        AND recipient_user_id = $3
      RETURNING id::text AS id, alert_event_id::text AS alert_event_id, read_at, acted_at, action_type
    `,
    [auth.tenantId, deliveryId, auth.id, actionType]
  );
  if (!rows.length) {
    throw new ApiError(404, "Alert delivery not found");
  }
  return rows[0];
}

export function canManageAlertCommandLayer(auth: AuthUser) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "supervisor"]);
}
