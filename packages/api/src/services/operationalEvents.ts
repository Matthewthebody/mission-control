import type { PoolClient } from "pg";
import type { NotificationCategory, NotificationChannel, NotificationSeverity } from "../types/domain.js";
import type {
  EmitOperationalEventInput,
  EmitOperationalEventResult,
  OperationalEventDefinition,
  OperationalEventDeliveryRecord,
  OperationalEventRecord,
  OperationalEventType
} from "../types/operationalEvents.js";
import { applyOperationalEventDefaultOverride, getOperationalEventDefaultsConfiguration } from "./adminConfiguration.js";
import { queueNotificationDispatch } from "./opsNotifications.js";

type OperationalEventRow = {
  id: string;
  tenant_id: string;
  event_type: OperationalEventType;
  source_module: string;
  source_object_type: string;
  source_object_id: string;
  source_object_label: string | null;
  actor_user_id: string | null;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  summary: string;
  deep_link: string | null;
  action_required: boolean;
  digest_eligible: boolean;
  throttle_window_minutes: number;
  recipient_user_ids: string[] | null;
  delivery_channels: unknown;
  metadata: Record<string, unknown> | null;
  dedupe_key: string | null;
  occurred_at: string;
  created_at: string;
};

type OperationalEventDeliveryRow = {
  id: string;
  tenant_id: string;
  operational_event_id: string;
  recipient_user_id: string | null;
  notification_group_key: string;
  delivery_channels: unknown;
  dispatch_status: OperationalEventDeliveryRecord["dispatch_status"];
  notification_app_event_id: string | null;
  notification_id: string | null;
  throttled_by_delivery_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

const OPERATIONAL_EVENT_DEFINITIONS: OperationalEventDefinition[] = [
  {
    type: "job.assigned",
    label: "Job Assigned",
    summary: "Notifies staff when they are assigned to a job or staffing slot.",
    defaultCategory: "assignment_update",
    defaultSeverity: "medium",
    defaultChannels: ["in_app"],
    defaultActionRequired: true,
    defaultDigestEligible: false,
    defaultThrottleWindowMinutes: 60
  },
  {
    type: "job.assignment_changed",
    label: "Assignment Changed",
    summary: "Flags meaningful assignment changes that staff should acknowledge or review in context.",
    defaultCategory: "assignment_update",
    defaultSeverity: "medium",
    defaultChannels: ["in_app"],
    defaultActionRequired: true,
    defaultDigestEligible: false,
    defaultThrottleWindowMinutes: 90
  },
  {
    type: "job.changed",
    label: "Job Changed",
    summary: "Flags high-signal operational changes to a job or its execution details.",
    defaultCategory: "schedule_change",
    defaultSeverity: "medium",
    defaultChannels: ["in_app"],
    defaultActionRequired: true,
    defaultDigestEligible: false,
    defaultThrottleWindowMinutes: 90
  },
  {
    type: "job.call_time_changed",
    label: "Call Time Changed",
    summary: "Highlights a published job time change that should reach staff quickly without flooding every update path.",
    defaultCategory: "schedule_change",
    defaultSeverity: "high",
    defaultChannels: ["in_app"],
    defaultActionRequired: true,
    defaultDigestEligible: false,
    defaultThrottleWindowMinutes: 180
  },
  {
    type: "job.required_data_missing",
    label: "Required Data Missing",
    summary: "Highlights jobs that are blocked by missing required operational data.",
    defaultCategory: "urgent_operational_risk",
    defaultSeverity: "high",
    defaultChannels: ["in_app"],
    defaultActionRequired: true,
    defaultDigestEligible: false,
    defaultThrottleWindowMinutes: 180
  },
  {
    type: "job.urgent_update",
    label: "Urgent Job Update",
    summary: "Escalates a high-severity operational job update that likely needs same-day attention.",
    defaultCategory: "urgent_operational_risk",
    defaultSeverity: "high",
    defaultChannels: ["in_app"],
    defaultActionRequired: true,
    defaultDigestEligible: false,
    defaultThrottleWindowMinutes: 60
  },
  {
    type: "staffing.assignment_conflict",
    label: "Assignment Conflict",
    summary: "Warns about scheduling or availability conflicts before staffing is finalized.",
    defaultCategory: "staffing",
    defaultSeverity: "high",
    defaultChannels: ["in_app"],
    defaultActionRequired: true,
    defaultDigestEligible: false,
    defaultThrottleWindowMinutes: 120
  },
  {
    type: "evaluation.flagged",
    label: "Evaluation Flagged",
    summary: "Escalates post-shoot issues that need operational follow-up or leadership review.",
    defaultCategory: "follow_up_task",
    defaultSeverity: "high",
    defaultChannels: ["in_app"],
    defaultActionRequired: true,
    defaultDigestEligible: false,
    defaultThrottleWindowMinutes: 240
  },
  {
    type: "approval.requested",
    label: "Approval Requested",
    summary: "Routes a high-signal approval request to the right reviewer.",
    defaultCategory: "approval_needed",
    defaultSeverity: "medium",
    defaultChannels: ["in_app"],
    defaultActionRequired: true,
    defaultDigestEligible: false,
    defaultThrottleWindowMinutes: 90
  },
  {
    type: "client_intake.review_required",
    label: "Client Intake Review Required",
    summary: "Alerts internal reviewers that a client-uploaded file was received and needs human review before the dashboard status changes.",
    defaultCategory: "follow_up_task",
    defaultSeverity: "medium",
    defaultChannels: ["in_app"],
    defaultActionRequired: true,
    defaultDigestEligible: false,
    defaultThrottleWindowMinutes: 60
  },
  {
    type: "client_intake.escalated",
    label: "Client Intake Escalated",
    summary: "Escalates a secure client upload that missed a review threshold or needs leadership intervention.",
    defaultCategory: "follow_up_task",
    defaultSeverity: "high",
    defaultChannels: ["in_app"],
    defaultActionRequired: true,
    defaultDigestEligible: false,
    defaultThrottleWindowMinutes: 120
  },
  {
    type: "client_intake.digest",
    label: "Client Intake Digest",
    summary: "Summarizes secure intake backlog, overdue items, and escalations for operational review.",
    defaultCategory: "system_confirmation",
    defaultSeverity: "medium",
    defaultChannels: ["in_app"],
    defaultActionRequired: false,
    defaultDigestEligible: true,
    defaultThrottleWindowMinutes: 1440
  },
  {
    type: "production.overdue",
    label: "Production Overdue",
    summary: "Flags production work that is overdue or blocked in a way that needs intervention.",
    defaultCategory: "production",
    defaultSeverity: "high",
    defaultChannels: ["in_app"],
    defaultActionRequired: true,
    defaultDigestEligible: false,
    defaultThrottleWindowMinutes: 180
  },
  {
    type: "task.completed",
    label: "Task Completed",
    summary: "Confirms that a tracked operational task has been completed.",
    defaultCategory: "system_confirmation",
    defaultSeverity: "low",
    defaultChannels: ["in_app"],
    defaultActionRequired: false,
    defaultDigestEligible: true,
    defaultThrottleWindowMinutes: 60
  },
  {
    type: "task.overdue",
    label: "Task Overdue",
    summary: "Flags a still-open task that is past due and tied to active operational work.",
    defaultCategory: "follow_up_task",
    defaultSeverity: "high",
    defaultChannels: ["in_app"],
    defaultActionRequired: true,
    defaultDigestEligible: false,
    defaultThrottleWindowMinutes: 180
  }
];

function isNotificationChannel(value: unknown): value is NotificationChannel {
  return value === "in_app" || value === "push" || value === "sms" || value === "email";
}

function normalizeText(value: string | null | undefined, label: string) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function parseMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseChannels(value: unknown): NotificationChannel[] {
  if (Array.isArray(value)) {
    const channels = value.filter(isNotificationChannel);
    if (channels.length) {
      return [...new Set(channels)];
    }
  }
  return ["in_app"];
}

function getOperationalEventDefinition(type: OperationalEventType) {
  return OPERATIONAL_EVENT_DEFINITIONS.find((definition) => definition.type === type) ?? OPERATIONAL_EVENT_DEFINITIONS[0];
}

function buildNotificationGroupKey(input: Pick<EmitOperationalEventInput, "eventType" | "sourceObjectType" | "sourceObjectId" | "dedupeKey">) {
  const explicit = normalizeOptionalText(input.dedupeKey);
  if (explicit) {
    return explicit;
  }
  return [input.eventType, input.sourceObjectType, input.sourceObjectId].join(":");
}

function rowToEventRecord(row: OperationalEventRow): OperationalEventRecord {
  return {
    ...row,
    recipient_user_ids: Array.isArray(row.recipient_user_ids) ? row.recipient_user_ids.filter((value): value is string => typeof value === "string") : [],
    delivery_channels: parseChannels(row.delivery_channels),
    metadata: parseMetadata(row.metadata)
  };
}

function rowToDeliveryRecord(row: OperationalEventDeliveryRow): OperationalEventDeliveryRecord {
  return {
    ...row,
    delivery_channels: parseChannels(row.delivery_channels),
    metadata: parseMetadata(row.metadata)
  };
}

export function listOperationalEventDefinitions() {
  return OPERATIONAL_EVENT_DEFINITIONS;
}

export async function emitOperationalEvent(client: PoolClient, input: EmitOperationalEventInput): Promise<EmitOperationalEventResult> {
  const definition = getOperationalEventDefinition(input.eventType);
  const configuredDefaults = applyOperationalEventDefaultOverride({
    base: definition,
    defaults: await getOperationalEventDefaultsConfiguration(client, input.tenantId),
    eventType: input.eventType
  });
  const deliveryChannels = parseChannels(input.deliveryChannels ?? configuredDefaults.defaultChannels);
  const recipientUserIds = [...new Set((input.recipientUserIds ?? []).filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
  const notificationGroupKey = buildNotificationGroupKey(input);
  const throttleWindowMinutes = Math.max(0, Math.round(input.throttleWindowMinutes ?? configuredDefaults.defaultThrottleWindowMinutes));
  const eventMetadata = {
    ...(input.metadata ?? {}),
    source_module: input.sourceModule,
    source_object_type: input.sourceObjectType,
    source_object_id: input.sourceObjectId,
    recipient_user_ids: recipientUserIds,
    delivery_channels: deliveryChannels
  };

  const eventInsert = await client.query<OperationalEventRow>(
    `
      INSERT INTO operational_event (
        tenant_id,
        event_type,
        source_module,
        source_object_type,
        source_object_id,
        source_object_label,
        actor_user_id,
        category,
        severity,
        title,
        summary,
        deep_link,
        action_required,
        digest_eligible,
        throttle_window_minutes,
        recipient_user_ids,
        delivery_channels,
        metadata,
        dedupe_key
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8::notification_category,$9::notification_severity,$10,$11,$12,$13,$14,$15,$16::uuid[],$17::jsonb,$18::jsonb,$19
      )
      RETURNING
        id::text,
        tenant_id::text,
        event_type::text,
        source_module,
        source_object_type,
        source_object_id,
        source_object_label,
        actor_user_id::text,
        category::text,
        severity::text,
        title,
        summary,
        deep_link,
        action_required,
        digest_eligible,
        throttle_window_minutes,
        recipient_user_ids::text[],
        delivery_channels,
        metadata,
        dedupe_key,
        occurred_at::text,
        created_at::text
    `,
    [
      input.tenantId,
      input.eventType,
      normalizeText(input.sourceModule, "Source module"),
      normalizeText(input.sourceObjectType, "Source object type"),
      normalizeText(input.sourceObjectId, "Source object id"),
      normalizeOptionalText(input.sourceObjectLabel),
      input.actorUserId ?? null,
      input.category ?? definition.defaultCategory,
      input.severity ?? configuredDefaults.defaultSeverity,
      normalizeText(input.title, "Title"),
      normalizeText(input.summary, "Summary"),
      normalizeOptionalText(input.deepLink),
      input.actionRequired ?? configuredDefaults.defaultActionRequired,
      input.digestEligible ?? configuredDefaults.defaultDigestEligible,
      throttleWindowMinutes,
      recipientUserIds,
      JSON.stringify(deliveryChannels),
      JSON.stringify(eventMetadata),
      normalizeOptionalText(input.dedupeKey)
    ]
  );

  const event = rowToEventRecord(eventInsert.rows[0]);
  const deliveries: OperationalEventDeliveryRecord[] = [];

  for (const recipientUserId of recipientUserIds) {
    let throttledByDeliveryId: string | null = null;
    if (throttleWindowMinutes > 0) {
      const throttleWindowSeconds = throttleWindowMinutes * 60;
      const throttleCheck = await client.query<{ id: string }>(
        `
          SELECT id::text
          FROM operational_event_delivery
          WHERE tenant_id = $1
            AND recipient_user_id = $2
            AND notification_group_key = $3
            AND dispatch_status IN ('queued'::operational_event_delivery_status, 'dispatched'::operational_event_delivery_status)
            AND created_at >= now() - ($4 * interval '1 second')
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [input.tenantId, recipientUserId, notificationGroupKey, throttleWindowSeconds]
      );
      throttledByDeliveryId = throttleCheck.rows[0]?.id ?? null;
    }

    const deliveryInsert = await client.query<OperationalEventDeliveryRow>(
      `
        INSERT INTO operational_event_delivery (
          tenant_id,
          operational_event_id,
          recipient_user_id,
          notification_group_key,
          delivery_channels,
          dispatch_status,
          throttled_by_delivery_id,
          metadata
        )
        VALUES ($1,$2,$3,$4,$5::jsonb,$6::operational_event_delivery_status,$7,$8::jsonb)
        RETURNING
          id::text,
          tenant_id::text,
          operational_event_id::text,
          recipient_user_id::text,
          notification_group_key,
          delivery_channels,
          dispatch_status::text,
          notification_app_event_id::text,
          notification_id::text,
          throttled_by_delivery_id::text,
          metadata,
          created_at::text,
          updated_at::text
      `,
      [
        input.tenantId,
        event.id,
        recipientUserId,
        notificationGroupKey,
        JSON.stringify(deliveryChannels),
        throttledByDeliveryId ? "throttled" : "queued",
        throttledByDeliveryId,
        JSON.stringify({
          event_type: input.eventType,
          recipient_user_id: recipientUserId,
          throttle_window_minutes: throttleWindowMinutes
        })
      ]
    );

    const delivery = rowToDeliveryRecord(deliveryInsert.rows[0]);

    if (delivery.dispatch_status === "queued") {
      const dispatches = await queueNotificationDispatch(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId ?? null,
        recipientUserIds: [recipientUserId],
        notificationType: input.eventType,
        title: event.title,
        body: event.summary,
        deepLink: event.deep_link,
        shiftId: input.shiftId ?? null,
        shootId: input.shootId ?? null,
        attendanceExceptionId: input.attendanceExceptionId ?? null,
        relatedUserId: input.relatedUserId ?? null,
        channels: deliveryChannels,
        metadata: {
          ...event.metadata,
          operational_event_id: event.id,
          operational_event_delivery_id: delivery.id
        },
        category: event.category,
        severity: event.severity,
        actionRequired: event.action_required,
        actionOwnerUserId: input.actionOwnerUserId ?? null,
        dueAt: input.dueAt ?? null,
        requiresAcknowledgement: input.requiresAcknowledgement,
        allowSnooze: input.allowSnooze,
        digestEligible: event.digest_eligible,
        sourceEvent: input.eventType,
        groupKey: notificationGroupKey,
        appEventDedupeKey: `operational_event_delivery:${delivery.id}`
      });

      const dispatch = dispatches[0] ?? null;
      if (dispatch?.appEventId) {
        const updated = await client.query<OperationalEventDeliveryRow>(
          `
            UPDATE operational_event_delivery
            SET
              notification_app_event_id = $3,
              updated_at = now()
            WHERE tenant_id = $1
              AND id = $2
            RETURNING
              id::text,
              tenant_id::text,
              operational_event_id::text,
              recipient_user_id::text,
              notification_group_key,
              delivery_channels,
              dispatch_status::text,
              notification_app_event_id::text,
              notification_id::text,
              throttled_by_delivery_id::text,
              metadata,
              created_at::text,
              updated_at::text
          `,
          [input.tenantId, delivery.id, dispatch.appEventId]
        );
        deliveries.push(rowToDeliveryRecord(updated.rows[0]));
        continue;
      }
    }

    deliveries.push(delivery);
  }

  return {
    event,
    deliveries,
    queued_count: deliveries.filter((delivery) => delivery.dispatch_status === "queued").length,
    throttled_count: deliveries.filter((delivery) => delivery.dispatch_status === "throttled").length
  };
}

export async function emitJobAssignedEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId: string;
    jobId: string;
    jobTitle: string;
    jobNumber?: string | null;
    assignmentRole: string;
    recipientUserId: string;
    jobDayId?: string | null;
  }
) {
  return emitOperationalEvent(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    eventType: "job.assigned",
    sourceModule: "jobs",
    sourceObjectType: "job_staff_assignment",
    sourceObjectId: `${input.jobId}:${input.recipientUserId}:${normalizeOptionalText(input.jobDayId) ?? "job"}`,
    sourceObjectLabel: input.jobNumber ?? input.jobTitle,
    title: `Assigned to ${input.jobNumber ?? input.jobTitle}`,
    summary: `You were assigned as ${input.assignmentRole} on ${input.jobNumber ?? input.jobTitle}.`,
    recipientUserIds: [input.recipientUserId],
    deliveryChannels: ["in_app"],
    category: "assignment_update",
    severity: "medium",
    actionRequired: true,
    deepLink: `#jobs/${encodeURIComponent(input.jobId)}`,
    dedupeKey: `job.assigned:${input.jobId}:${input.recipientUserId}:${normalizeOptionalText(input.jobDayId) ?? "job"}`
  });
}

export async function emitApprovalRequestedEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId: string;
    requestId: string;
    requestTitle: string;
    requestSummary?: string | null;
    severity?: NotificationSeverity;
    recipientUserIds?: string[];
    dueAt?: string | null;
  }
) {
  return emitOperationalEvent(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    eventType: "approval.requested",
    sourceModule: "approvals",
    sourceObjectType: "operational_approval_request",
    sourceObjectId: input.requestId,
    sourceObjectLabel: input.requestTitle,
    title: `Approval requested: ${input.requestTitle}`,
    summary: normalizeOptionalText(input.requestSummary) ?? "A new approval request needs attention.",
    recipientUserIds: input.recipientUserIds ?? [],
    deliveryChannels: ["in_app"],
    category: "approval_needed",
    severity: input.severity ?? "medium",
    actionRequired: true,
    dueAt: input.dueAt ?? null,
    deepLink: `#approvals?tab=operational&request=${encodeURIComponent(input.requestId)}`,
    dedupeKey: `approval.requested:${input.requestId}`
  });
}

export async function emitEvaluationFlaggedEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId: string;
    shiftId: string;
    shootId: string;
    evaluationId: string;
    shootTitle: string;
    shootCode?: string | null;
    summary?: string | null;
    recipientUserIds?: string[];
    leadershipReviewNeeded?: boolean;
    channels?: NotificationChannel[];
  }
) {
  const label = input.shootCode ?? input.shootTitle;
  const leadershipReviewNeeded = Boolean(input.leadershipReviewNeeded);
  return emitOperationalEvent(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    eventType: "evaluation.flagged",
    sourceModule: "post_shoot_evaluations",
    sourceObjectType: "post_shoot_evaluation",
    sourceObjectId: input.evaluationId,
    sourceObjectLabel: label,
    title: leadershipReviewNeeded ? `Leadership review flagged for ${label}` : `Post-shoot follow-up flagged for ${label}`,
    summary:
      normalizeOptionalText(input.summary) ??
      (leadershipReviewNeeded ? "A submitted Post-Shoot Eval needs leadership review." : "A submitted Post-Shoot Eval needs manager follow-up."),
    recipientUserIds: input.recipientUserIds ?? [],
    deliveryChannels: input.channels ?? (leadershipReviewNeeded ? ["in_app", "push", "email"] : ["in_app", "push"]),
    category: "follow_up_task",
    severity: leadershipReviewNeeded ? "critical" : "high",
    actionRequired: true,
    requiresAcknowledgement: leadershipReviewNeeded,
    shiftId: input.shiftId,
    shootId: input.shootId,
    deepLink: `#operations/shoots?shoot=${encodeURIComponent(input.shootId)}&panel=post_shoot_eval&evaluation=${encodeURIComponent(input.evaluationId)}`,
    dedupeKey: `evaluation.flagged:${input.evaluationId}`
  });
}

export async function emitTaskCompletedEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId: string;
    taskId: string;
    taskNumber: string;
    taskTitle: string;
    recipientUserIds?: string[];
    relatedJobId?: string | null;
  }
) {
  return emitOperationalEvent(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    eventType: "task.completed",
    sourceModule: "tasks",
    sourceObjectType: "work_task",
    sourceObjectId: input.taskId,
    sourceObjectLabel: input.taskNumber,
    title: `Task completed: ${input.taskNumber}`,
    summary: `${input.taskTitle} was marked complete.`,
    recipientUserIds: input.recipientUserIds ?? [],
    deliveryChannels: ["in_app"],
    category: "system_confirmation",
    severity: "low",
    actionRequired: false,
    digestEligible: true,
    deepLink: `#tasks/${encodeURIComponent(input.taskId)}`,
    dedupeKey: `task.completed:${input.taskId}`
  });
}
