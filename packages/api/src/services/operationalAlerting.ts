import { URL } from "node:url";
import type { PoolClient } from "pg";
import { hasAuthorityTier } from "../authz/authority.js";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type { NotificationSeverity } from "../types/domain.js";
import type {
  OperationalAlertAdminPayload,
  OperationalAlertDefinition,
  OperationalAlertDeliveryRecord,
  OperationalAlertDeliveryStatus,
  OperationalAlertDispatchPayload,
  OperationalAlertRouteRecord,
  OperationalAlertRouteUpdateInput,
  OperationalAlertRouteWriteInput,
  QueueOperationalAlertInput,
  QueueOperationalAlertResult,
  TeamsWebhookDestinationConfig
} from "../types/operationalAlerts.js";
import { createAuditLog } from "./audit.js";
import { buildTeamsEmbeddedAppUrl } from "./microsoftTeamsLinks.js";
import { createAppEvent } from "./outbox.js";

type RouteSummaryRow = OperationalAlertRouteRecord & {
  last_delivery_at: string | null;
  last_delivery_status: OperationalAlertDeliveryStatus | null;
  failure_count_14d: number | string;
};

type DeliveryRow = OperationalAlertDeliveryRecord;

const OPERATIONAL_ALERT_DEFINITIONS: OperationalAlertDefinition[] = [
  {
    type: "shoot_changed_within_48h",
    label: "Shoot Changed Within 48 Hours",
    summary: "Warns operations when published shoot timing or location changes close to execution.",
    recommended_severity: "high",
    recommended_throttle_minutes: 180
  },
  {
    type: "job_missing_required_data",
    label: "Job Missing Required Data",
    summary: "Flags jobs or shoots that are operationally blocked by missing required fields.",
    recommended_severity: "high",
    recommended_throttle_minutes: 180
  },
  {
    type: "staff_assignment_conflict_detected",
    label: "Staff Assignment Conflict Detected",
    summary: "Warns when an assignment overlaps with another commitment or busy window.",
    recommended_severity: "high",
    recommended_throttle_minutes: 120
  },
  {
    type: "understaffed_job",
    label: "Understaffed Job",
    summary: "Flags jobs or shoots that are still below minimum staffing coverage.",
    recommended_severity: "high",
    recommended_throttle_minutes: 180
  },
  {
    type: "red_flag_post_shoot_eval",
    label: "Red-Flag Post-Shoot Eval",
    summary: "Escalates major post-shoot issues and leadership review flags.",
    recommended_severity: "critical",
    recommended_throttle_minutes: 240
  },
  {
    type: "overdue_production_item",
    label: "Overdue Production Item",
    summary: "Highlights production items that are overdue or operationally blocked.",
    recommended_severity: "high",
    recommended_throttle_minutes: 180
  },
  {
    type: "approval_needed",
    label: "Approval Needed",
    summary: "Notifies approvers about high-signal approvals that need attention.",
    recommended_severity: "medium",
    recommended_throttle_minutes: 90
  },
  {
    type: "gallery_job_completed",
    label: "Gallery / Job Completed",
    summary: "Provides completion visibility for high-value finished work.",
    recommended_severity: "medium",
    recommended_throttle_minutes: 360
  },
  {
    type: "client_intake_review_overdue",
    label: "Client Intake Review Overdue",
    summary: "Warns operations that a secure client upload is waiting too long for reviewer action.",
    recommended_severity: "high",
    recommended_throttle_minutes: 180
  },
  {
    type: "client_intake_escalated",
    label: "Client Intake Escalated",
    summary: "Escalates a secure client upload that missed review thresholds or needs leadership attention.",
    recommended_severity: "critical",
    recommended_throttle_minutes: 120
  },
  {
    type: "client_intake_daily_digest",
    label: "Client Intake Daily Digest",
    summary: "Summarizes backlog, overdue items, and escalations for the secure client intake workflow.",
    recommended_severity: "medium",
    recommended_throttle_minutes: 1440
  }
];

const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

function assertOperationalAlertReadAccess(auth: Pick<AuthUser, "authorityTier">) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    throw new ApiError(403, "Only leadership or audit admins can review Teams operational alerts.");
  }
}

function assertOperationalAlertManageAccess(auth: Pick<AuthUser, "authorityTier">) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Only leadership or directors can manage Teams operational alerts.");
  }
}

function normalizeText(value: string | null | undefined, label: string) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new ApiError(400, `${label} is required.`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeWebhookDestinationConfig(configValue: Record<string, unknown>): TeamsWebhookDestinationConfig {
  const webhookUrl = typeof configValue.webhook_url === "string" ? configValue.webhook_url.trim() : "";
  if (!webhookUrl) {
    throw new ApiError(400, "Teams webhook routes require a webhook_url destination.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(webhookUrl);
  } catch {
    throw new ApiError(400, "Teams webhook URL must be a valid absolute URL.");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new ApiError(400, "Teams webhook URL must use HTTPS.");
  }

  const channelName =
    typeof configValue.channel_name === "string" && configValue.channel_name.trim().length
      ? configValue.channel_name.trim()
      : null;

  return {
    webhook_url: parsedUrl.toString(),
    channel_name: channelName
  };
}

function normalizeRouteInput(input: OperationalAlertRouteWriteInput): OperationalAlertRouteWriteInput {
  if (input.delivery_channel !== "teams_webhook") {
    throw new ApiError(400, "Phase 3 currently supports teams_webhook routes only.");
  }

  return {
    alert_type: input.alert_type,
    delivery_channel: input.delivery_channel,
    route_name: normalizeText(input.route_name, "Route name"),
    destination_label: normalizeText(input.destination_label, "Destination label"),
    destination_config: normalizeWebhookDestinationConfig(input.destination_config),
    severity_threshold: input.severity_threshold,
    throttle_window_minutes: Math.max(1, Math.min(Math.round(input.throttle_window_minutes), 10080)),
    enabled: input.enabled ?? true
  };
}

function mergeRouteInput(
  current: OperationalAlertRouteRecord,
  input: OperationalAlertRouteUpdateInput
): OperationalAlertRouteWriteInput {
  return normalizeRouteInput({
    alert_type: input.alert_type ?? current.alert_type,
    delivery_channel: input.delivery_channel ?? current.delivery_channel,
    route_name: input.route_name ?? current.route_name,
    destination_label: input.destination_label ?? current.destination_label,
    destination_config: input.destination_config ?? current.destination_config,
    severity_threshold: input.severity_threshold ?? current.severity_threshold,
    throttle_window_minutes: input.throttle_window_minutes ?? current.throttle_window_minutes,
    enabled: input.enabled ?? current.enabled
  });
}

function buildMaskedDestination(route: Pick<OperationalAlertRouteRecord, "delivery_channel" | "destination_config">) {
  if (route.delivery_channel !== "teams_webhook") {
    return null;
  }
  const configValue = route.destination_config as Record<string, unknown>;
  const webhookUrl = typeof configValue.webhook_url === "string" ? configValue.webhook_url : "";
  if (!webhookUrl) {
    return null;
  }
  try {
    const parsed = new URL(webhookUrl);
    const tail = parsed.pathname.length > 12 ? parsed.pathname.slice(-12) : parsed.pathname;
    return `${parsed.host}${tail ? ` ...${tail}` : ""}`;
  } catch {
    return "Configured";
  }
}

function severityMeetsThreshold(severity: NotificationSeverity, threshold: NotificationSeverity) {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold];
}

function buildAbsoluteDeepLink(value?: string | null) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }
  return buildTeamsEmbeddedAppUrl(normalized);
}

function normalizeFactValue(value: string | number | boolean | null) {
  if (value == null) {
    return "n/a";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
}

function buildDedupeKey(input: QueueOperationalAlertInput) {
  const explicit = normalizeOptionalText(input.dedupeKey ?? (typeof input.metadata?.dedupe === "string" ? input.metadata.dedupe : null));
  if (explicit) {
    return explicit;
  }
  return [
    input.alertType,
    input.sourceEntityType ?? "global",
    input.sourceEntityId ?? normalizeText(input.title, "Alert title").toLowerCase().replace(/[^a-z0-9]+/g, "-")
  ].join(":");
}

function buildDeliveryRequestPayload(
  route: OperationalAlertRouteRecord,
  input: QueueOperationalAlertInput,
  absoluteDeepLink: string | null
) {
  return {
    route: {
      id: route.id,
      route_name: route.route_name,
      delivery_channel: route.delivery_channel,
      destination_label: route.destination_label,
      destination_config: route.destination_config
    },
    alert: {
      type: input.alertType,
      title: input.title,
      summary: input.summary,
      severity: input.severity,
      deep_link: absoluteDeepLink,
      source_event_type: input.sourceEventType ?? null,
      source_entity_type: input.sourceEntityType ?? null,
      source_entity_id: input.sourceEntityId ?? null,
      metadata: input.metadata ?? {},
      facts: (input.facts ?? []).map((fact) => ({
        label: fact.label,
        value: normalizeFactValue(fact.value)
      }))
    }
  };
}

function rowToRouteRecord(row: OperationalAlertRouteRecord): OperationalAlertRouteRecord {
  return {
    ...row,
    destination_config:
      row.destination_config && typeof row.destination_config === "object" && !Array.isArray(row.destination_config)
        ? row.destination_config
        : {}
  };
}

function rowToDeliveryRecord(row: DeliveryRow): DeliveryRow {
  return {
    ...row,
    request_payload:
      row.request_payload && typeof row.request_payload === "object" && !Array.isArray(row.request_payload)
        ? row.request_payload
        : {},
    response_payload:
      row.response_payload && typeof row.response_payload === "object" && !Array.isArray(row.response_payload)
        ? row.response_payload
        : {},
    metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {}
  };
}

export function listOperationalAlertDefinitions() {
  return OPERATIONAL_ALERT_DEFINITIONS;
}

export async function listOperationalAlertRoutes(client: PoolClient, auth: AuthUser) {
  assertOperationalAlertReadAccess(auth);
  const { rows } = await client.query<RouteSummaryRow>(
    `
      SELECT
        route.id::text,
        route.tenant_id::text,
        route.alert_type::text,
        route.delivery_channel::text,
        route.route_name,
        route.destination_label,
        route.destination_config,
        route.severity_threshold::text,
        route.throttle_window_minutes,
        route.enabled,
        route.created_by_user_id::text,
        route.updated_by_user_id::text,
        route.created_at::text,
        route.updated_at::text,
        latest.occurred_at AS last_delivery_at,
        latest.status AS last_delivery_status,
        COALESCE(failures.failure_count_14d, 0) AS failure_count_14d
      FROM operational_alert_route route
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(delivery.sent_at, delivery.failed_at, delivery.last_attempted_at, delivery.created_at)::text AS occurred_at,
          delivery.status::text AS status
        FROM operational_alert_delivery delivery
        WHERE delivery.tenant_id = route.tenant_id
          AND delivery.route_id = route.id
        ORDER BY delivery.created_at DESC
        LIMIT 1
      ) latest ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS failure_count_14d
        FROM operational_alert_delivery delivery
        WHERE delivery.tenant_id = route.tenant_id
          AND delivery.route_id = route.id
          AND delivery.status = 'failed'::operational_alert_delivery_status
          AND delivery.created_at >= now() - interval '14 days'
      ) failures ON true
      WHERE route.tenant_id = $1
      ORDER BY route.updated_at DESC, route.created_at DESC
    `,
    [auth.tenantId]
  );

  return rows.map((row) => ({
    ...rowToRouteRecord(row),
    last_delivery_at: row.last_delivery_at,
    last_delivery_status: row.last_delivery_status,
    failure_count_14d: Number(row.failure_count_14d ?? 0),
    masked_destination: buildMaskedDestination(row)
  }));
}

export async function listOperationalAlertDeliveries(
  client: PoolClient,
  auth: AuthUser,
  options: {
    status?: OperationalAlertDeliveryStatus | null;
    limit?: number;
  } = {}
) {
  assertOperationalAlertReadAccess(auth);
  const values: unknown[] = [auth.tenantId];
  const where = ["delivery.tenant_id = $1"];
  if (options.status) {
    values.push(options.status);
    where.push(`delivery.status = $${values.length}::operational_alert_delivery_status`);
  }
  values.push(Math.max(1, Math.min(options.limit ?? 40, 200)));

  const { rows } = await client.query<DeliveryRow>(
    `
      SELECT
        delivery.id::text,
        delivery.tenant_id::text,
        delivery.route_id::text,
        delivery.delivery_channel::text,
        delivery.alert_type::text,
        delivery.source_event_type,
        delivery.source_entity_type,
        delivery.source_entity_id,
        delivery.dedupe_key,
        delivery.status::text,
        delivery.title,
        delivery.summary,
        delivery.severity::text,
        delivery.deep_link,
        delivery.app_event_id::text,
        delivery.request_payload,
        delivery.response_payload,
        delivery.metadata,
        delivery.attempt_count,
        delivery.first_attempted_at::text,
        delivery.last_attempted_at::text,
        delivery.sent_at::text,
        delivery.failed_at::text,
        delivery.last_error,
        delivery.created_at::text,
        delivery.updated_at::text,
        route.route_name,
        route.destination_label
      FROM operational_alert_delivery delivery
      JOIN operational_alert_route route
        ON route.id = delivery.route_id
      WHERE ${where.join(" AND ")}
      ORDER BY delivery.created_at DESC
      LIMIT $${values.length}
    `,
    values
  );

  return rows.map(rowToDeliveryRecord);
}

export async function getOperationalAlertAdminPayload(client: PoolClient, auth: AuthUser): Promise<OperationalAlertAdminPayload> {
  const [routes, recentDeliveries] = await Promise.all([
    listOperationalAlertRoutes(client, auth),
    listOperationalAlertDeliveries(client, auth, { limit: 20 })
  ]);

  return {
    generated_at: new Date().toISOString(),
    teams_enabled: config.TEAMS_OPERATIONAL_ALERTS_ENABLED,
    definitions: OPERATIONAL_ALERT_DEFINITIONS,
    routes,
    recent_deliveries: recentDeliveries
  };
}

export async function getOperationalAlertRoute(client: PoolClient, tenantId: string, routeId: string) {
  const { rows } = await client.query<OperationalAlertRouteRecord>(
    `
      SELECT
        id::text,
        tenant_id::text,
        alert_type::text,
        delivery_channel::text,
        route_name,
        destination_label,
        destination_config,
        severity_threshold::text,
        throttle_window_minutes,
        enabled,
        created_by_user_id::text,
        updated_by_user_id::text,
        created_at::text,
        updated_at::text
      FROM operational_alert_route
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, routeId]
  );
  return rows[0] ? rowToRouteRecord(rows[0]) : null;
}

export async function createOperationalAlertRoute(
  client: PoolClient,
  auth: AuthUser,
  input: OperationalAlertRouteWriteInput
) {
  assertOperationalAlertManageAccess(auth);
  const normalized = normalizeRouteInput(input);
  const { rows } = await client.query<OperationalAlertRouteRecord>(
    `
      INSERT INTO operational_alert_route (
        tenant_id,
        alert_type,
        delivery_channel,
        route_name,
        destination_label,
        destination_config,
        severity_threshold,
        throttle_window_minutes,
        enabled,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$10)
      RETURNING
        id::text,
        tenant_id::text,
        alert_type::text,
        delivery_channel::text,
        route_name,
        destination_label,
        destination_config,
        severity_threshold::text,
        throttle_window_minutes,
        enabled,
        created_by_user_id::text,
        updated_by_user_id::text,
        created_at::text,
        updated_at::text
    `,
    [
      auth.tenantId,
      normalized.alert_type,
      normalized.delivery_channel,
      normalized.route_name,
      normalized.destination_label,
      JSON.stringify(normalized.destination_config),
      normalized.severity_threshold,
      normalized.throttle_window_minutes,
      normalized.enabled ?? true,
      auth.id
    ]
  );

  const route = rowToRouteRecord(rows[0]);
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "integration.teams_alert_route.created",
    entityType: "operational_alert_route",
    entityId: route.id,
    metadata: {
      alert_type: route.alert_type,
      delivery_channel: route.delivery_channel,
      route_name: route.route_name,
      destination_label: route.destination_label,
      severity_threshold: route.severity_threshold,
      throttle_window_minutes: route.throttle_window_minutes,
      enabled: route.enabled
    },
    sourceSurface: "integration_governance"
  });
  return route;
}

export async function updateOperationalAlertRoute(
  client: PoolClient,
  auth: AuthUser,
  routeId: string,
  input: OperationalAlertRouteUpdateInput
) {
  assertOperationalAlertManageAccess(auth);
  const current = await getOperationalAlertRoute(client, auth.tenantId, routeId);
  if (!current) {
    throw new ApiError(404, "Operational alert route not found.");
  }
  const normalized = mergeRouteInput(current, input);
  const { rows } = await client.query<OperationalAlertRouteRecord>(
    `
      UPDATE operational_alert_route
      SET
        alert_type = $3,
        delivery_channel = $4,
        route_name = $5,
        destination_label = $6,
        destination_config = $7::jsonb,
        severity_threshold = $8,
        throttle_window_minutes = $9,
        enabled = $10,
        updated_by_user_id = $11,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING
        id::text,
        tenant_id::text,
        alert_type::text,
        delivery_channel::text,
        route_name,
        destination_label,
        destination_config,
        severity_threshold::text,
        throttle_window_minutes,
        enabled,
        created_by_user_id::text,
        updated_by_user_id::text,
        created_at::text,
        updated_at::text
    `,
    [
      auth.tenantId,
      routeId,
      normalized.alert_type,
      normalized.delivery_channel,
      normalized.route_name,
      normalized.destination_label,
      JSON.stringify(normalized.destination_config),
      normalized.severity_threshold,
      normalized.throttle_window_minutes,
      normalized.enabled ?? true,
      auth.id
    ]
  );

  const route = rowToRouteRecord(rows[0]);
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "integration.teams_alert_route.updated",
    entityType: "operational_alert_route",
    entityId: route.id,
    metadata: {
      alert_type: route.alert_type,
      delivery_channel: route.delivery_channel,
      route_name: route.route_name,
      destination_label: route.destination_label,
      severity_threshold: route.severity_threshold,
      throttle_window_minutes: route.throttle_window_minutes,
      enabled: route.enabled
    },
    previousValues: {
      alert_type: current.alert_type,
      route_name: current.route_name,
      destination_label: current.destination_label,
      severity_threshold: current.severity_threshold,
      throttle_window_minutes: current.throttle_window_minutes,
      enabled: current.enabled
    },
    sourceSurface: "integration_governance"
  });
  return route;
}

export async function queueOperationalAlert(client: PoolClient, input: QueueOperationalAlertInput): Promise<QueueOperationalAlertResult> {
  if (!config.TEAMS_OPERATIONAL_ALERTS_ENABLED) {
    return {
      queued_count: 0,
      throttled_count: 0,
      deliveries: []
    };
  }

  const absoluteDeepLink = buildAbsoluteDeepLink(input.deepLink ?? null);
  const dedupeKey = buildDedupeKey(input);
  const alertTitle = normalizeText(input.title, "Alert title");
  const alertSummary = normalizeText(input.summary, "Alert summary");

  const { rows } = await client.query<OperationalAlertRouteRecord>(
    `
      SELECT
        id::text,
        tenant_id::text,
        alert_type::text,
        delivery_channel::text,
        route_name,
        destination_label,
        destination_config,
        severity_threshold::text,
        throttle_window_minutes,
        enabled,
        created_by_user_id::text,
        updated_by_user_id::text,
        created_at::text,
        updated_at::text
      FROM operational_alert_route
      WHERE tenant_id = $1
        AND alert_type = $2::operational_alert_type
        AND enabled = true
      ORDER BY created_at ASC
    `,
    [input.tenantId, input.alertType]
  );

  let queuedCount = 0;
  let throttledCount = 0;
  const deliveries: QueueOperationalAlertResult["deliveries"] = [];

  for (const rawRoute of rows.map(rowToRouteRecord)) {
    if (!severityMeetsThreshold(input.severity, rawRoute.severity_threshold)) {
      continue;
    }

    const existingThrottle = await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM operational_alert_delivery
        WHERE tenant_id = $1
          AND route_id = $2
          AND dedupe_key = $3
          AND status <> 'throttled'::operational_alert_delivery_status
          AND created_at >= now() - make_interval(mins => $4)
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [input.tenantId, rawRoute.id, dedupeKey, rawRoute.throttle_window_minutes]
    );

    const requestPayload = buildDeliveryRequestPayload(rawRoute, { ...input, title: alertTitle, summary: alertSummary }, absoluteDeepLink);

    if (existingThrottle.rows[0]?.id) {
      const throttledInsert = await client.query<{ id: string }>(
        `
          INSERT INTO operational_alert_delivery (
            tenant_id,
            route_id,
            delivery_channel,
            alert_type,
            source_event_type,
            source_entity_type,
            source_entity_id,
            dedupe_key,
            status,
            title,
            summary,
            severity,
            deep_link,
            request_payload,
            metadata
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'throttled',$9,$10,$11,$12,$13::jsonb,$14::jsonb)
          RETURNING id::text
        `,
        [
          input.tenantId,
          rawRoute.id,
          rawRoute.delivery_channel,
          input.alertType,
          input.sourceEventType ?? null,
          input.sourceEntityType ?? null,
          input.sourceEntityId ?? null,
          dedupeKey,
          alertTitle,
          alertSummary,
          input.severity,
          absoluteDeepLink,
          JSON.stringify(requestPayload),
          JSON.stringify({
            ...(input.metadata ?? {}),
            throttled_by_delivery_id: existingThrottle.rows[0].id
          })
        ]
      );
      throttledCount += 1;
      deliveries.push({
        delivery_id: throttledInsert.rows[0].id,
        route_id: rawRoute.id,
        status: "throttled",
        app_event_id: null
      });
      continue;
    }

    const insert = await client.query<{ id: string }>(
      `
        INSERT INTO operational_alert_delivery (
          tenant_id,
          route_id,
          delivery_channel,
          alert_type,
          source_event_type,
          source_entity_type,
          source_entity_id,
          dedupe_key,
          status,
          title,
          summary,
          severity,
          deep_link,
          request_payload,
          metadata
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued',$9,$10,$11,$12,$13::jsonb,$14::jsonb)
        RETURNING id::text
      `,
      [
        input.tenantId,
        rawRoute.id,
        rawRoute.delivery_channel,
        input.alertType,
        input.sourceEventType ?? null,
        input.sourceEntityType ?? null,
        input.sourceEntityId ?? null,
        dedupeKey,
        alertTitle,
        alertSummary,
        input.severity,
        absoluteDeepLink,
        JSON.stringify(requestPayload),
        JSON.stringify(input.metadata ?? {})
      ]
    );
    const deliveryId = insert.rows[0].id;

    const event = await createAppEvent(client, {
      tenantId: input.tenantId,
      eventType: "operational_alert.dispatch",
      aggregateType: "operational_alert_delivery",
      aggregateId: deliveryId,
      dedupeKey: `operational-alert:${deliveryId}`,
      payload: {
        delivery_id: deliveryId
      } satisfies OperationalAlertDispatchPayload
    });

    await client.query(
      `
        UPDATE operational_alert_delivery
        SET app_event_id = $3
        WHERE tenant_id = $1
          AND id = $2
      `,
      [input.tenantId, deliveryId, event.id]
    );

    queuedCount += 1;
    deliveries.push({
      delivery_id: deliveryId,
      route_id: rawRoute.id,
      status: "queued",
      app_event_id: event.id
    });
  }

  return {
    queued_count: queuedCount,
    throttled_count: throttledCount,
    deliveries
  };
}

export async function queueStaffAssignmentConflictDetectedAlert(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId?: string | null;
    shootId: string;
    shootCode: string;
    shootDate?: string | null;
    slotLabel: string;
    assignedUserName: string;
    shiftId?: string | null;
    conflictStatus: "warning" | "blocking";
    conflictDetail?: Record<string, unknown> | null;
  }
) {
  return queueOperationalAlert(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    alertType: "staff_assignment_conflict_detected",
    title: `Staffing conflict on ${input.shootCode}`,
    summary: `${input.assignedUserName} has a ${input.conflictStatus} conflict on ${input.slotLabel}. Review staffing before the shoot is impacted.`,
    severity: input.conflictStatus === "blocking" ? "critical" : "high",
    deepLink: `#schedule/staffing?shoot=${encodeURIComponent(input.shootId)}${input.shiftId ? `&shift=${encodeURIComponent(input.shiftId)}` : ""}`,
    sourceEventType: "schedule.staffing.assignment_created",
    sourceEntityType: "shoot",
    sourceEntityId: input.shootId,
    dedupeKey: `staffing-conflict:${input.shootId}:${input.shiftId ?? input.slotLabel}:${input.assignedUserName}:${input.conflictStatus}`,
    metadata: {
      shoot_id: input.shootId,
      shoot_code: input.shootCode,
      shift_id: input.shiftId ?? null,
      conflict_detail: input.conflictDetail ?? {}
    },
    facts: [
      { label: "Shoot", value: input.shootCode },
      { label: "Assignment", value: input.slotLabel },
      { label: "Staff", value: input.assignedUserName },
      { label: "Conflict", value: input.conflictStatus },
      { label: "Date", value: input.shootDate ?? null }
    ]
  });
}

export async function queueRedFlagPostShootEvalAlert(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId?: string | null;
    shootId: string;
    evaluationId: string;
    shootCode: string | null;
    shootTitle: string;
    summary: string | null;
    outcome: string;
    leadershipReviewNeeded: boolean;
  }
) {
  const label = input.shootCode ?? input.shootTitle;
  return queueOperationalAlert(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    alertType: "red_flag_post_shoot_eval",
    title: `Red-flag post-shoot eval for ${label}`,
    summary:
      normalizeOptionalText(input.summary) ??
      (input.leadershipReviewNeeded
        ? "A post-shoot evaluation needs leadership review."
        : "A post-shoot evaluation flagged major follow-up issues."),
    severity: input.leadershipReviewNeeded ? "critical" : "high",
    deepLink: `#operations/shoots?shoot=${encodeURIComponent(input.shootId)}&panel=post_shoot_eval&evaluation=${encodeURIComponent(input.evaluationId)}`,
    sourceEventType: "shoot.closeout_eval_follow_up",
    sourceEntityType: "post_shoot_evaluation",
    sourceEntityId: input.evaluationId,
    dedupeKey: `post-shoot-red-flag:${input.evaluationId}`,
    metadata: {
      shoot_id: input.shootId,
      shoot_code: input.shootCode,
      evaluation_id: input.evaluationId
    },
    facts: [
      { label: "Shoot", value: label },
      { label: "Outcome", value: input.outcome },
      { label: "Leadership Review", value: input.leadershipReviewNeeded }
    ]
  });
}

export async function queueApprovalNeededOperationalAlert(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId?: string | null;
    approvalEntityType: string;
    approvalEntityId: string;
    title: string;
    summary: string;
    deepLink?: string | null;
    jobCode?: string | null;
    department?: string | null;
    dueAt?: string | null;
  }
) {
  return queueOperationalAlert(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    alertType: "approval_needed",
    title: input.title,
    summary: input.summary,
    severity: "medium",
    deepLink: input.deepLink ?? "#approvals",
    sourceEventType: "approval.requested",
    sourceEntityType: input.approvalEntityType,
    sourceEntityId: input.approvalEntityId,
    dedupeKey: `approval-needed:${input.approvalEntityType}:${input.approvalEntityId}`,
    metadata: {
      due_at: input.dueAt ?? null,
      department: input.department ?? null
    },
    facts: [
      { label: "Item", value: input.title },
      { label: "Department", value: input.department ?? null },
      { label: "Job", value: input.jobCode ?? null },
      { label: "Due", value: input.dueAt ?? null }
    ]
  });
}

export async function queueShootChangedWithin48HoursAlert(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId?: string | null;
    shootId: string | null;
    shiftId: string;
    title: string;
    startsAt: string;
    locationName: string;
    previousAssignedUserId?: string | null;
  }
) {
  const startsAtMs = new Date(input.startsAt).getTime();
  if (!Number.isFinite(startsAtMs) || startsAtMs > Date.now() + 48 * 60 * 60 * 1000) {
    return {
      queued_count: 0,
      throttled_count: 0,
      deliveries: []
    };
  }

  return queueOperationalAlert(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    alertType: "shoot_changed_within_48h",
    title: "Published shoot changed within 48 hours",
    summary: `${input.title} changed close to execution and should be reviewed by operations.`,
    severity: "high",
    deepLink: input.shootId
      ? `#schedule/staffing?shoot=${encodeURIComponent(input.shootId)}&shift=${encodeURIComponent(input.shiftId)}`
      : `#schedule/jobs?shift=${encodeURIComponent(input.shiftId)}`,
    sourceEventType: "schedule.shift_changed",
    sourceEntityType: "work_shift",
    sourceEntityId: input.shiftId,
    dedupeKey: `shift-changed-48h:${input.shiftId}:${input.startsAt}`,
    metadata: {
      shoot_id: input.shootId,
      previous_assigned_user_id: input.previousAssignedUserId ?? null
    },
    facts: [
      { label: "Shift", value: input.title },
      { label: "Start", value: input.startsAt },
      { label: "Location", value: input.locationName }
    ]
  });
}

export function canReadOperationalAlertAdmin(auth: Pick<AuthUser, "authorityTier">) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"]);
}

export function canManageOperationalAlertAdmin(auth: Pick<AuthUser, "authorityTier">) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]);
}
