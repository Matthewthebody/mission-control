import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { withClientTransaction } from "../db/tx.js";
import { config } from "../config.js";
import type { AuthUser } from "../types/auth.js";
import type { ProactiveCommunicationDefaultsConfig } from "../types/adminConfiguration.js";
import type { OperationalEventType } from "../types/operationalEvents.js";
import type {
  ProactiveCommunicationDecisionRecord,
  ProactiveCommunicationRouteResult,
  ProactiveCommunicationRouteStatus,
  ProactiveCommunicationRouteType,
  ProactiveCommunicationTriggerInput,
  ProactiveCommunicationTriggerType
} from "../types/proactiveCommunication.js";
import type { TeamsCommunicationLinkedObjectType, TeamsCommunicationReferenceType } from "../types/teamsMessaging.js";
import { getProactiveCommunicationDefaultsConfiguration } from "./adminConfiguration.js";
import { evaluateCommunicationGovernance } from "./communicationGovernance.js";
import { resolveCommunicationRecordContext } from "./communicationRecords.js";
import { emitOperationalEvent } from "./operationalEvents.js";
import { canViewRecords } from "./policy/operationalAuthorization.js";
import { queueTeamsCommunicationMessage } from "./teamsMessaging.js";

type ProactiveDecisionRow = {
  id: string;
  trigger_type: ProactiveCommunicationTriggerType;
  source_module: string;
  source_object_type: string;
  source_object_id: string;
  source_object_label: string | null;
  communication_object_type: TeamsCommunicationLinkedObjectType;
  communication_object_id: string;
  route_kind: ProactiveCommunicationRouteType;
  route_status: ProactiveCommunicationRouteStatus;
  actor_user_id: string | null;
  recipient_user_ids: string[] | null;
  teams_reference_id: string | null;
  teams_delivery_id: string | null;
  operational_event_id: string | null;
  title: string;
  summary: string;
  throttle_key: string | null;
  throttle_window_minutes: number;
  throttled_by_decision_id: string | null;
  failure_reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type TeamsReferenceSummary = {
  id: string;
  reference_type: TeamsCommunicationReferenceType;
  label: string;
  teams_web_url: string;
  is_primary: boolean;
};

type RouteAttemptFailure = {
  routeKind: ProactiveCommunicationRouteType;
  reason: string;
};

const BUILT_IN_RULE_DEFAULTS: Record<
  ProactiveCommunicationTriggerType,
  {
    preferredRoute: ProactiveCommunicationRouteType;
    throttleWindowMinutes: number;
    maxDirectRecipients?: number;
    eventType: OperationalEventType;
  }
> = {
  assignment_changed: {
    preferredRoute: "direct_teams_message",
    throttleWindowMinutes: 90,
    maxDirectRecipients: 3,
    eventType: "job.assignment_changed"
  },
  call_time_changed: {
    preferredRoute: "channel_alert",
    throttleWindowMinutes: 180,
    eventType: "job.call_time_changed"
  },
  required_info_missing: {
    preferredRoute: "in_app_notification",
    throttleWindowMinutes: 240,
    eventType: "job.required_data_missing"
  },
  approval_needed: {
    preferredRoute: "in_app_notification",
    throttleWindowMinutes: 120,
    eventType: "approval.requested"
  },
  conflict_detected: {
    preferredRoute: "channel_alert",
    throttleWindowMinutes: 120,
    eventType: "staffing.assignment_conflict"
  },
  urgent_job_update: {
    preferredRoute: "channel_alert",
    throttleWindowMinutes: 60,
    eventType: "job.urgent_update"
  },
  overdue_task_tied_to_job: {
    preferredRoute: "open_teams_recommendation",
    throttleWindowMinutes: 180,
    eventType: "task.overdue"
  }
};

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => normalizeText(value)).filter((value): value is string => Boolean(value)))];
}

function parseMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function rowToDecision(row: ProactiveDecisionRow): ProactiveCommunicationDecisionRecord {
  return {
    ...row,
    recipient_user_ids: Array.isArray(row.recipient_user_ids) ? row.recipient_user_ids.filter((value): value is string => typeof value === "string") : [],
    metadata: parseMetadata(row.metadata)
  };
}

function buildDefaultAppDeepLink(objectType: TeamsCommunicationLinkedObjectType, objectId: string) {
  if (objectType === "job") {
    return `#jobs/${encodeURIComponent(objectId)}`;
  }
  if (objectType === "task") {
    return `#tasks/${encodeURIComponent(objectId)}`;
  }
  if (objectType === "organization") {
    return `#directory/organizations/${encodeURIComponent(objectId)}`;
  }
  if (objectType === "location") {
    return `#directory/locations?location=${encodeURIComponent(objectId)}`;
  }
  return null;
}

function buildThrottleKey(input: {
  triggerType: ProactiveCommunicationTriggerType;
  sourceObjectType: string;
  sourceObjectId: string;
  communicationObjectType: TeamsCommunicationLinkedObjectType;
  communicationObjectId: string;
  dedupeKey?: string | null;
  recipientUserIds: string[];
}) {
  const explicit = normalizeText(input.dedupeKey);
  if (explicit) {
    return explicit;
  }

  const digest = createHash("sha256")
    .update(
      [
        input.triggerType,
        input.sourceObjectType,
        input.sourceObjectId,
        input.communicationObjectType,
        input.communicationObjectId,
        input.recipientUserIds.slice().sort().join(",")
      ].join("|")
    )
    .digest("hex");
  return `proactive-communication:${digest}`;
}

function buildRouteCandidates(
  preferredRoute: ProactiveCommunicationRouteType,
  fallbackRoute: ProactiveCommunicationDefaultsConfig["default_fallback_route"]
) {
  const candidates = [preferredRoute];
  if (preferredRoute === "direct_teams_message") {
    candidates.push("channel_alert");
  } else if (preferredRoute === "channel_alert") {
    candidates.push("direct_teams_message");
  } else if (preferredRoute === "open_teams_recommendation") {
    candidates.push("in_app_notification");
  }
  candidates.push(fallbackRoute);
  return [...new Set(candidates)];
}

async function hasProactiveCommunicationSchema(client: PoolClient) {
  const { rows } = await client.query<{ has_decision: boolean }>(
    `
      SELECT (to_regclass('public.proactive_communication_decision') IS NOT NULL) AS has_decision
    `
  );
  return Boolean(rows[0]?.has_decision);
}

async function hasTeamsReferenceSchema(client: PoolClient) {
  const { rows } = await client.query<{ has_reference: boolean; has_link: boolean }>(
    `
      SELECT
        (to_regclass('public.teams_communication_reference') IS NOT NULL) AS has_reference,
        (to_regclass('public.teams_communication_reference_link') IS NOT NULL) AS has_link
    `
  );
  return Boolean(rows[0]?.has_reference && rows[0]?.has_link);
}

async function listTeamsReferencesForRecord(
  client: PoolClient,
  tenantId: string,
  objectType: TeamsCommunicationLinkedObjectType,
  objectId: string
) {
  if (!(await hasTeamsReferenceSchema(client))) {
    return [] as TeamsReferenceSummary[];
  }

  const { rows } = await client.query<TeamsReferenceSummary>(
    `
      SELECT
        reference.id::text,
        reference.reference_type::text AS reference_type,
        reference.label,
        reference.teams_web_url,
        link.is_primary
      FROM teams_communication_reference_link link
      JOIN teams_communication_reference reference
        ON reference.tenant_id = link.tenant_id
       AND reference.id = link.reference_id
      WHERE link.tenant_id = $1
        AND link.object_type = $2::teams_communication_link_object_type
        AND link.object_id = $3
        AND reference.status = 'active'::teams_communication_reference_status
      ORDER BY link.is_primary DESC, reference.label ASC, reference.created_at DESC
    `,
    [tenantId, objectType, objectId]
  );
  return rows;
}

function pickReference(references: TeamsReferenceSummary[], type: TeamsCommunicationReferenceType) {
  return references.find((reference) => reference.reference_type === type) ?? null;
}

async function findThrottleMatch(
  client: PoolClient,
  tenantId: string,
  throttleKey: string,
  throttleWindowMinutes: number
) {
  if (throttleWindowMinutes <= 0) {
    return null;
  }

  const { rows } = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM proactive_communication_decision
      WHERE tenant_id = $1
        AND throttle_key = $2
        AND route_status IN (
          'queued'::proactive_communication_route_status,
          'notified'::proactive_communication_route_status,
          'recommended'::proactive_communication_route_status
        )
        AND created_at >= now() - ($3 * interval '1 minute')
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [tenantId, throttleKey, throttleWindowMinutes]
  );

  return rows[0]?.id ?? null;
}

async function insertDecision(
  client: PoolClient,
  auth: AuthUser,
  input: ProactiveCommunicationTriggerInput,
  decision: {
    routeKind: ProactiveCommunicationRouteType;
    routeStatus: ProactiveCommunicationRouteStatus;
    recipientUserIds: string[];
    throttleKey: string | null;
    throttleWindowMinutes: number;
    teamsReferenceId?: string | null;
    teamsDeliveryId?: string | null;
    operationalEventId?: string | null;
    throttledByDecisionId?: string | null;
    failureReason?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const { rows } = await client.query<ProactiveDecisionRow>(
    `
      INSERT INTO proactive_communication_decision (
        tenant_id,
        trigger_type,
        source_module,
        source_object_type,
        source_object_id,
        source_object_label,
        communication_object_type,
        communication_object_id,
        route_kind,
        route_status,
        actor_user_id,
        recipient_user_ids,
        teams_reference_id,
        teams_delivery_id,
        operational_event_id,
        title,
        summary,
        throttle_key,
        throttle_window_minutes,
        throttled_by_decision_id,
        failure_reason,
        metadata
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9::proactive_communication_route_kind,$10::proactive_communication_route_status,$11,$12::uuid[],$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb
      )
      RETURNING
        id::text,
        trigger_type::text,
        source_module,
        source_object_type,
        source_object_id,
        source_object_label,
        communication_object_type::text,
        communication_object_id::text,
        route_kind::text,
        route_status::text,
        actor_user_id::text,
        recipient_user_ids::text[],
        teams_reference_id::text,
        teams_delivery_id::text,
        operational_event_id::text,
        title,
        summary,
        throttle_key,
        throttle_window_minutes,
        throttled_by_decision_id::text,
        failure_reason,
        metadata,
        created_at::text,
        updated_at::text
    `,
    [
      auth.tenantId,
      input.triggerType,
      normalizeText(input.sourceModule),
      normalizeText(input.sourceObjectType),
      normalizeText(input.sourceObjectId),
      normalizeText(input.sourceObjectLabel),
      input.communicationObjectType,
      input.communicationObjectId,
      decision.routeKind,
      decision.routeStatus,
      auth.id,
      decision.recipientUserIds,
      decision.teamsReferenceId ?? null,
      decision.teamsDeliveryId ?? null,
      decision.operationalEventId ?? null,
      normalizeText(input.title),
      normalizeText(input.summary),
      decision.throttleKey,
      decision.throttleWindowMinutes,
      decision.throttledByDecisionId ?? null,
      normalizeText(decision.failureReason),
      JSON.stringify(decision.metadata ?? {})
    ]
  );

  return rowToDecision(rows[0]);
}

function buildEventType(input: ProactiveCommunicationTriggerInput) {
  return input.operationalEventType ?? BUILT_IN_RULE_DEFAULTS[input.triggerType].eventType;
}

function buildRecommendationSummary(input: {
  title: string;
  summary: string;
  triggerType: ProactiveCommunicationTriggerType;
  reference: TeamsReferenceSummary;
}) {
  return `${input.summary} Open ${input.reference.label} in Teams for the latest coordination context.`;
}

function buildFailureResult(reason: string): ProactiveCommunicationRouteResult {
  return {
    decision: null,
    route_kind: null,
    route_status: "failed",
    failure_reason: reason
  };
}

async function applyInAppRoute(
  client: PoolClient,
  auth: AuthUser,
  input: ProactiveCommunicationTriggerInput,
  routeKind: "in_app_notification" | "open_teams_recommendation",
  references: TeamsReferenceSummary[],
  throttleKey: string,
  throttleWindowMinutes: number
) {
  const reference = references[0] ?? null;
  const recipientUserIds = uniqueStrings(input.recipientUserIds ?? []).filter((userId) => userId !== auth.id);
  if (recipientUserIds.length === 0) {
    return {
      decision: await insertDecision(client, auth, input, {
        routeKind,
        routeStatus: "suppressed",
        recipientUserIds: [],
        throttleKey,
        throttleWindowMinutes,
        failureReason: "No meaningful recipients were available for the proactive communication rule.",
        metadata: {
          trigger_type: input.triggerType
        }
      }),
      route_kind: routeKind,
      route_status: "suppressed" as const,
      failure_reason: "No meaningful recipients were available for the proactive communication rule."
    };
  }

  const event = await emitOperationalEvent(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    eventType: buildEventType(input),
    sourceModule: input.sourceModule,
    sourceObjectType: input.sourceObjectType,
    sourceObjectId: input.sourceObjectId,
    sourceObjectLabel: input.sourceObjectLabel ?? null,
    title: input.title,
    summary:
      routeKind === "open_teams_recommendation" && reference
        ? buildRecommendationSummary({
            title: input.title,
            summary: input.summary,
            triggerType: input.triggerType,
            reference
          })
        : input.summary,
    recipientUserIds,
    deliveryChannels: ["in_app"],
    category: input.notificationCategory,
    severity: input.severity,
    actionRequired: input.actionRequired ?? true,
    deepLink: normalizeText(input.appDeepLink) ?? buildDefaultAppDeepLink(input.communicationObjectType, input.communicationObjectId),
    dedupeKey: throttleKey,
    throttleWindowMinutes,
    metadata: {
      ...(input.metadata ?? {}),
      trigger_type: input.triggerType,
      proactive_route_kind: routeKind,
      recommended_action: routeKind === "open_teams_recommendation" && reference ? "open_teams_destination" : null,
      teams_reference_id: reference?.id ?? null,
      teams_reference_type: reference?.reference_type ?? null,
      teams_destination_url: reference?.teams_web_url ?? null,
      communication_object_type: input.communicationObjectType,
      communication_object_id: input.communicationObjectId
    }
  });

  const decision = await insertDecision(client, auth, input, {
    routeKind,
    routeStatus: routeKind === "open_teams_recommendation" ? "recommended" : "notified",
    recipientUserIds,
    throttleKey,
    throttleWindowMinutes,
    operationalEventId: event.event.id,
    teamsReferenceId: reference?.id ?? null,
    metadata: {
      trigger_type: input.triggerType,
      queued_count: event.queued_count,
      throttled_count: event.throttled_count
    }
  });

  return {
    decision,
    route_kind: routeKind,
    route_status: decision.route_status,
    failure_reason: null
  } satisfies ProactiveCommunicationRouteResult;
}

async function applyTeamsRoute(
  client: PoolClient,
  auth: AuthUser,
  input: ProactiveCommunicationTriggerInput,
  routeKind: "direct_teams_message" | "channel_alert",
  references: TeamsReferenceSummary[],
  throttleKey: string,
  throttleWindowMinutes: number,
  maxDirectRecipients: number
): Promise<ProactiveCommunicationRouteResult | RouteAttemptFailure> {
  try {
    const recipientUserIds = uniqueStrings(input.recipientUserIds ?? []).filter((userId) => userId !== auth.id);
    if (routeKind === "direct_teams_message" && recipientUserIds.length === 0) {
      return {
        routeKind,
        reason: "Direct Teams messages require at least one recipient other than the actor."
      };
    }
    if (routeKind === "direct_teams_message" && recipientUserIds.length > maxDirectRecipients) {
      return {
        routeKind,
        reason: `Direct Teams messages are limited to ${maxDirectRecipients} recipients for this rule.`
      };
    }

    const reference = pickReference(references, routeKind === "direct_teams_message" ? "chat" : "channel");
    if (!reference) {
      return {
        routeKind,
        reason: routeKind === "direct_teams_message" ? "No active Teams chat is linked to this record." : "No active Teams channel is linked to this record."
      };
    }

    const delivery = await queueTeamsCommunicationMessage(
      client,
      auth,
      {
        reference_id: reference.id,
        object_type: input.communicationObjectType,
        object_id: input.communicationObjectId,
        message_text: normalizeText(input.messageText) ?? normalizeText(input.summary) ?? normalizeText(input.title) ?? "Operational update",
        app_deep_link: normalizeText(input.appDeepLink) ?? buildDefaultAppDeepLink(input.communicationObjectType, input.communicationObjectId)
      },
      {
        sourceSurface: "proactive_rule"
      }
    );

    const decision = await insertDecision(client, auth, input, {
      routeKind,
      routeStatus: "queued",
      recipientUserIds,
      throttleKey,
      throttleWindowMinutes,
      teamsReferenceId: reference.id,
      teamsDeliveryId: delivery.id,
      metadata: {
        trigger_type: input.triggerType,
        delivery_status: delivery.status,
        teams_destination_url: reference.teams_web_url,
        teams_reference_type: reference.reference_type
      }
    });

    return {
      decision,
      route_kind: routeKind,
      route_status: decision.route_status,
      failure_reason: null
    };
  } catch (error) {
    return {
      routeKind,
      reason: error instanceof Error ? error.message : "Teams route could not be queued."
    };
  }
}

export async function applyProactiveCommunicationRule(
  client: PoolClient,
  auth: AuthUser,
  input: ProactiveCommunicationTriggerInput
): Promise<ProactiveCommunicationRouteResult> {
  try {
    const schemaReady = await hasProactiveCommunicationSchema(client);
    if (!schemaReady) {
      return buildFailureResult("Proactive communication schema is not available yet.");
    }

    const defaults = await getProactiveCommunicationDefaultsConfiguration(client, auth);
    const ruleDefaults = BUILT_IN_RULE_DEFAULTS[input.triggerType];
    const override = defaults.trigger_overrides[input.triggerType] ?? {};
    const enabled = override.enabled ?? true;
    const preferredRoute = override.preferred_route ?? ruleDefaults.preferredRoute;
    const throttleWindowMinutes =
      override.throttle_window_minutes ?? ruleDefaults.throttleWindowMinutes ?? defaults.default_throttle_window_minutes;
    const maxDirectRecipients = override.max_direct_message_recipients ?? ruleDefaults.maxDirectRecipients ?? defaults.max_direct_message_recipients;
    const recipientUserIds = uniqueStrings(input.recipientUserIds ?? []);
    const throttleKey = buildThrottleKey({
      triggerType: input.triggerType,
      sourceObjectType: input.sourceObjectType,
      sourceObjectId: input.sourceObjectId,
      communicationObjectType: input.communicationObjectType,
      communicationObjectId: input.communicationObjectId,
      dedupeKey: input.dedupeKey,
      recipientUserIds
    });

    if (!config.COMMUNICATION_PROACTIVE_RULES_ENABLED) {
      const decision = await insertDecision(client, auth, input, {
        routeKind: preferredRoute,
        routeStatus: "suppressed",
        recipientUserIds,
        throttleKey,
        throttleWindowMinutes,
        failureReason: "Proactive communication rules are disabled in this environment.",
        metadata: {
          trigger_type: input.triggerType,
          disabled_by_feature_flag: true
        }
      });
      return {
        decision,
        route_kind: preferredRoute,
        route_status: "suppressed",
        failure_reason: "Proactive communication rules are disabled in this environment."
      };
    }

    if (!enabled) {
      const decision = await insertDecision(client, auth, input, {
        routeKind: preferredRoute,
        routeStatus: "suppressed",
        recipientUserIds,
        throttleKey,
        throttleWindowMinutes,
        failureReason: "This proactive communication trigger is disabled by configuration.",
        metadata: {
          trigger_type: input.triggerType
        }
      });
      return {
        decision,
        route_kind: preferredRoute,
        route_status: "suppressed",
        failure_reason: "This proactive communication trigger is disabled by configuration."
      };
    }

    const record = await resolveCommunicationRecordContext(
      client,
      auth,
      input.communicationObjectType,
      input.communicationObjectId
    );
    if (
      !canViewRecords(auth, record.permissionEntity, {
        departmentType: record.policyContext.departmentType ?? null,
        organizationId: record.policyContext.organizationId ?? null,
        locationId: record.policyContext.locationId ?? null,
        ownerUserIds: record.policyContext.ownerUserIds ?? [],
        assignedUserIds: record.policyContext.assignedUserIds ?? [],
        customScopeValues: record.policyContext.customScopeValues ?? []
      })
    ) {
      return {
        decision: await insertDecision(client, auth, input, {
          routeKind: preferredRoute,
          routeStatus: "suppressed",
          recipientUserIds,
          throttleKey,
          throttleWindowMinutes,
          failureReason: "The actor no longer has access to the linked communication record.",
          metadata: {
            trigger_type: input.triggerType
          }
        }),
        route_kind: preferredRoute,
        route_status: "suppressed",
        failure_reason: "The actor no longer has access to the linked communication record."
      };
    }

    const governance = evaluateCommunicationGovernance(auth, {
      objectType: record.objectType,
      objectId: record.objectId,
      objectLabel: record.objectLabel,
      module: record.module,
      policyContext: {
        departmentType: record.policyContext.departmentType ?? null,
        organizationId: record.policyContext.organizationId ?? null,
        locationId: record.policyContext.locationId ?? null,
        ownerUserIds: record.policyContext.ownerUserIds ?? [],
        assignedUserIds: record.policyContext.assignedUserIds ?? [],
        customScopeValues: record.policyContext.customScopeValues ?? []
      }
    });
    if (!governance.permissions.can_send_proactive) {
      const decision = await insertDecision(client, auth, input, {
        routeKind: preferredRoute,
        routeStatus: "suppressed",
        recipientUserIds,
        throttleKey,
        throttleWindowMinutes,
        failureReason: "The actor is not allowed to send proactive communications from this record.",
        metadata: {
          trigger_type: input.triggerType,
          governance_module: governance.module
        }
      });
      return {
        decision,
        route_kind: preferredRoute,
        route_status: "suppressed",
        failure_reason: "The actor is not allowed to send proactive communications from this record."
      };
    }

    const throttledByDecisionId = await findThrottleMatch(client, auth.tenantId, throttleKey, throttleWindowMinutes);
    if (throttledByDecisionId) {
      const decision = await insertDecision(client, auth, input, {
        routeKind: preferredRoute,
        routeStatus: "throttled",
        recipientUserIds,
        throttleKey,
        throttleWindowMinutes,
        throttledByDecisionId,
        failureReason: "A matching proactive communication decision was already routed recently.",
        metadata: {
          trigger_type: input.triggerType
        }
      });
      return {
        decision,
        route_kind: preferredRoute,
        route_status: "throttled",
        failure_reason: null
      };
    }

    const references = await listTeamsReferencesForRecord(
      client,
      auth.tenantId,
      input.communicationObjectType,
      input.communicationObjectId
    );
    const routeCandidates = buildRouteCandidates(preferredRoute, defaults.default_fallback_route);
    const failures: RouteAttemptFailure[] = [];

    for (const candidate of routeCandidates) {
      if (candidate === "direct_teams_message" || candidate === "channel_alert") {
        const result = await applyTeamsRoute(client, auth, input, candidate, references, throttleKey, throttleWindowMinutes, maxDirectRecipients);
        if ("routeKind" in result) {
          failures.push(result);
          continue;
        }
        return result;
      }

      if (candidate === "in_app_notification" || candidate === "open_teams_recommendation") {
        if (candidate === "open_teams_recommendation" && references.length === 0) {
          failures.push({
            routeKind: candidate,
            reason: "No active Teams destination is linked to this record."
          });
          continue;
        }
        return applyInAppRoute(client, auth, input, candidate, references, throttleKey, throttleWindowMinutes);
      }
    }

    const decision = await insertDecision(client, auth, input, {
      routeKind: preferredRoute,
      routeStatus: "failed",
      recipientUserIds,
      throttleKey,
      throttleWindowMinutes,
      failureReason: failures.map((failure) => `${failure.routeKind}: ${failure.reason}`).join(" | ") || "No proactive communication route was available.",
      metadata: {
        trigger_type: input.triggerType,
        attempted_routes: failures.map((failure) => failure.routeKind)
      }
    });

    return {
      decision,
      route_kind: preferredRoute,
      route_status: "failed",
      failure_reason: decision.failure_reason
    };
  } catch (error) {
    return buildFailureResult(error instanceof Error ? error.message : "Unknown proactive communication error.");
  }
}

export async function applyProactiveCommunicationRuleOutOfBand(auth: AuthUser, input: ProactiveCommunicationTriggerInput) {
  return withClientTransaction(auth.tenantId, auth.id, (client) => applyProactiveCommunicationRule(client, auth, input));
}
