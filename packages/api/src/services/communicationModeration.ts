import type { PoolClient } from "pg";
import { hasAuthorityTier } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { createAuditLog } from "./audit.js";
import { hasCommunicationModerationRights } from "./appAuthorization.js";
import { loadCommunicationIdentityByUserId } from "./communicationIdentity.js";
import { captureCommunicationFailure, writeCommunicationAuditEvent } from "./communicationObservability.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
  sourceSurface?: string | null;
};

type DeliveryModerationRow = {
  delivery_id: string;
  actor_user_id: string | null;
  reference_id: string;
  reference_type: "chat" | "channel";
  reference_label: string;
  object_type: string;
  object_id: string;
  visibility_status: "visible" | "moderated_hidden";
  moderation_reason: string | null;
  teams_destination_url: string;
  message_text: string;
};

type UserCommunicationStateRow = {
  user_id: string;
  account_id: string | null;
  full_name: string;
  email: string;
  membership_status: string;
  communication_enabled: boolean;
  communication_posting_disabled_at: string | null;
  communication_posting_disabled_reason: string | null;
};

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function assertModerationRights(auth: AuthUser) {
  if (
    hasCommunicationModerationRights(auth) ||
    auth.permissions.includes("communication.moderate") ||
    auth.permissions.includes("communication.revoke_access") ||
    hasAuthorityTier(auth, ["super_admin"])
  ) {
    return;
  }
  throw new ApiError(403, "Forbidden");
}

async function loadDeliveryForModeration(client: PoolClient, tenantId: string, deliveryId: string) {
  const { rows } = await client.query<DeliveryModerationRow>(
    `
      SELECT
        delivery.id::text AS delivery_id,
        delivery.actor_user_id::text AS actor_user_id,
        delivery.reference_id::text AS reference_id,
        reference.reference_type::text AS reference_type,
        reference.label AS reference_label,
        delivery.object_type::text AS object_type,
        delivery.object_id::text AS object_id,
        delivery.visibility_status::text AS visibility_status,
        delivery.moderation_reason,
        delivery.teams_destination_url,
        delivery.message_text
      FROM teams_communication_delivery delivery
      JOIN teams_communication_reference reference
        ON reference.tenant_id = delivery.tenant_id
       AND reference.id = delivery.reference_id
      WHERE delivery.tenant_id = $1
        AND delivery.id = $2
      LIMIT 1
    `,
    [tenantId, deliveryId]
  );
  return rows[0] ?? null;
}

async function loadUserCommunicationState(client: PoolClient, tenantId: string, userId: string) {
  const { rows } = await client.query<UserCommunicationStateRow>(
    `
      SELECT
        user_target.id::text AS user_id,
        user_target.account_id::text AS account_id,
        user_target.full_name,
        user_target.email,
        user_target.status::text AS membership_status,
        COALESCE(account.communication_enabled, false) AS communication_enabled,
        account.communication_posting_disabled_at::text AS communication_posting_disabled_at,
        account.communication_posting_disabled_reason
      FROM app_user user_target
      LEFT JOIN user_account account
        ON account.id = user_target.account_id
      WHERE user_target.tenant_id = $1
        AND user_target.id = $2
      LIMIT 1
    `,
    [tenantId, userId]
  );
  return rows[0] ?? null;
}

async function insertModerationEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId: string;
    actionType: string;
    targetType: "delivery" | "thread" | "user";
    targetId?: string | null;
    targetUserId?: string | null;
    relatedDeliveryId?: string | null;
    objectType?: string | null;
    objectId?: string | null;
    reason?: string | null;
    originalVisibilityStatus?: string | null;
    originalVisibilityScope?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      INSERT INTO communication_moderation_event (
        tenant_id,
        action_type,
        target_type,
        target_id,
        target_user_id,
        related_delivery_id,
        object_type,
        object_id,
        actor_user_id,
        reason,
        original_visibility_status,
        original_visibility_scope,
        metadata
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)
    `,
    [
      input.tenantId,
      input.actionType,
      input.targetType,
      input.targetId ?? null,
      input.targetUserId ?? null,
      input.relatedDeliveryId ?? null,
      input.objectType ?? null,
      input.objectId ?? null,
      input.actorUserId,
      input.reason ?? null,
      input.originalVisibilityStatus ?? null,
      JSON.stringify(input.originalVisibilityScope ?? {}),
      JSON.stringify(input.metadata ?? {})
    ]
  );
}

export async function hideTeamsCommunicationDelivery(
  client: PoolClient,
  auth: AuthUser,
  input: { deliveryId: string; reason: string },
  requestMeta: RequestMeta = {}
) {
  let delivery: DeliveryModerationRow | null = null;
  try {
    assertModerationRights(auth);
    const reason = normalizeText(input.reason);
    if (!reason) {
      throw new ApiError(400, "A moderation reason is required.");
    }

    delivery = await loadDeliveryForModeration(client, auth.tenantId, input.deliveryId);
    if (!delivery) {
      throw new ApiError(404, "Communication delivery not found.");
    }
    if (delivery.visibility_status === "moderated_hidden") {
      throw new ApiError(409, "This communication message is already hidden.");
    }

    const originalVisibilityScope = {
      reference_id: delivery.reference_id,
      reference_type: delivery.reference_type,
      reference_label: delivery.reference_label,
      object_type: delivery.object_type,
      object_id: delivery.object_id,
      teams_destination_url: delivery.teams_destination_url
    };

    await client.query(
      `
        UPDATE teams_communication_delivery
        SET
          visibility_status = 'moderated_hidden'::communication_message_visibility_status,
          moderated_at = now(),
          moderated_by_user_id = $3,
          moderation_reason = $4,
          original_visibility_scope = $5::jsonb,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [auth.tenantId, input.deliveryId, auth.id, reason, JSON.stringify(originalVisibilityScope)]
    );

    await insertModerationEvent(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      actionType: "message_hidden",
      targetType: "delivery",
      targetId: input.deliveryId,
      targetUserId: delivery.actor_user_id,
      relatedDeliveryId: input.deliveryId,
      objectType: delivery.object_type,
      objectId: delivery.object_id,
      reason,
      originalVisibilityStatus: delivery.visibility_status,
      originalVisibilityScope
    });

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: delivery.actor_user_id,
      action: "communication.message.hidden",
      entityType: "teams_communication_delivery",
      entityId: input.deliveryId,
      metadata: {
        reference_id: delivery.reference_id,
        reference_type: delivery.reference_type,
        object_type: delivery.object_type,
        object_id: delivery.object_id
      },
      previousValues: {
        visibility_status: delivery.visibility_status,
        moderation_reason: delivery.moderation_reason
      },
      newValues: {
        visibility_status: "moderated_hidden",
        moderation_reason: reason
      },
      reasonComment: reason,
      ipAddress: requestMeta.ipAddress ?? null,
      userAgent: requestMeta.userAgent ?? null,
      sourceSurface: requestMeta.sourceSurface ?? "communications"
    });

    await writeCommunicationAuditEvent(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: delivery.actor_user_id,
      eventType: "communication.message.hidden",
      resourceType: "teams_communication_delivery",
      resourceId: input.deliveryId,
      result: "moderated_hidden",
      context: {
        reference_id: delivery.reference_id,
        reference_type: delivery.reference_type,
        object_type: delivery.object_type,
        object_id: delivery.object_id
      },
      oldValues: {
        visibility_status: delivery.visibility_status
      },
      newValues: {
        visibility_status: "moderated_hidden",
        moderation_reason: reason
      }
    });

    return {
      ok: true as const,
      delivery_id: input.deliveryId,
      visibility_status: "moderated_hidden" as const,
      moderation_reason: reason
    };
  } catch (error) {
    await captureCommunicationFailure(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventType: "communication.moderation.hide_failed",
      resourceType: "teams_communication_delivery",
      resourceId: input.deliveryId,
      area: "governance",
      action: "hide_message",
      error,
      context: {
        target_user_id: delivery?.actor_user_id ?? null,
        object_type: delivery?.object_type ?? null,
        object_id: delivery?.object_id ?? null
      }
    });
    throw error;
  }
}

export async function restoreTeamsCommunicationDelivery(
  client: PoolClient,
  auth: AuthUser,
  input: { deliveryId: string; reason?: string | null },
  requestMeta: RequestMeta = {}
) {
  let delivery: DeliveryModerationRow | null = null;
  try {
    assertModerationRights(auth);
    delivery = await loadDeliveryForModeration(client, auth.tenantId, input.deliveryId);
    if (!delivery) {
      throw new ApiError(404, "Communication delivery not found.");
    }
    if (delivery.visibility_status !== "moderated_hidden") {
      throw new ApiError(409, "This communication message is already visible.");
    }

    const reason = normalizeText(input.reason);

    await client.query(
      `
        UPDATE teams_communication_delivery
        SET
          visibility_status = 'visible'::communication_message_visibility_status,
          moderated_at = NULL,
          moderated_by_user_id = NULL,
          moderation_reason = NULL,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [auth.tenantId, input.deliveryId]
    );

    await insertModerationEvent(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      actionType: "message_restored",
      targetType: "delivery",
      targetId: input.deliveryId,
      targetUserId: delivery.actor_user_id,
      relatedDeliveryId: input.deliveryId,
      objectType: delivery.object_type,
      objectId: delivery.object_id,
      reason,
      originalVisibilityStatus: delivery.visibility_status,
      originalVisibilityScope: {
        reference_id: delivery.reference_id,
        reference_type: delivery.reference_type,
        reference_label: delivery.reference_label,
        object_type: delivery.object_type,
        object_id: delivery.object_id
      }
    });

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: delivery.actor_user_id,
      action: "communication.message.restored",
      entityType: "teams_communication_delivery",
      entityId: input.deliveryId,
      metadata: {
        reference_id: delivery.reference_id,
        reference_type: delivery.reference_type,
        object_type: delivery.object_type,
        object_id: delivery.object_id
      },
      previousValues: {
        visibility_status: delivery.visibility_status,
        moderation_reason: delivery.moderation_reason
      },
      newValues: {
        visibility_status: "visible"
      },
      reasonComment: reason,
      ipAddress: requestMeta.ipAddress ?? null,
      userAgent: requestMeta.userAgent ?? null,
      sourceSurface: requestMeta.sourceSurface ?? "communications"
    });

    await writeCommunicationAuditEvent(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: delivery.actor_user_id,
      eventType: "communication.message.restored",
      resourceType: "teams_communication_delivery",
      resourceId: input.deliveryId,
      result: "visible",
      context: {
        reference_id: delivery.reference_id,
        reference_type: delivery.reference_type,
        object_type: delivery.object_type,
        object_id: delivery.object_id
      },
      oldValues: {
        visibility_status: delivery.visibility_status
      },
      newValues: {
        visibility_status: "visible"
      }
    });

    return {
      ok: true as const,
      delivery_id: input.deliveryId,
      visibility_status: "visible" as const
    };
  } catch (error) {
    await captureCommunicationFailure(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventType: "communication.moderation.restore_failed",
      resourceType: "teams_communication_delivery",
      resourceId: input.deliveryId,
      area: "governance",
      action: "restore_message",
      error,
      context: {
        target_user_id: delivery?.actor_user_id ?? null,
        object_type: delivery?.object_type ?? null,
        object_id: delivery?.object_id ?? null
      }
    });
    throw error;
  }
}

export async function setUserCommunicationPostingState(
  client: PoolClient,
  auth: AuthUser,
  input: {
    userId: string;
    disabled: boolean;
    reason?: string | null;
  },
  requestMeta: RequestMeta = {}
) {
  let target: UserCommunicationStateRow | null = null;
  try {
    assertModerationRights(auth);
    target = await loadUserCommunicationState(client, auth.tenantId, input.userId);
    if (!target) {
      throw new ApiError(404, "Employee not found.");
    }
    if (!target.account_id) {
      throw new ApiError(409, "This employee does not have a linked account to update.");
    }

    const reason = normalizeText(input.reason);
    if (input.disabled && !reason) {
      throw new ApiError(400, "A moderation reason is required to disable posting.");
    }

    await client.query(
      `
        UPDATE user_account
        SET
          communication_posting_disabled_at = CASE WHEN $3::boolean THEN now() ELSE NULL END,
          communication_posting_disabled_by_user_id = CASE WHEN $3::boolean THEN $4 ELSE NULL END,
          communication_posting_disabled_reason = CASE WHEN $3::boolean THEN $5 ELSE NULL END,
          updated_at = now()
        WHERE id = $1
          AND tenant_id = $2
      `,
      [target.account_id, auth.tenantId, input.disabled, auth.id, reason]
    );

    await insertModerationEvent(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      actionType: input.disabled ? "posting_disabled" : "posting_restored",
      targetType: "user",
      targetId: target.user_id,
      targetUserId: target.user_id,
      reason,
      metadata: {
        previous_posting_disabled_at: target.communication_posting_disabled_at,
        previous_posting_disabled_reason: target.communication_posting_disabled_reason
      }
    });

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: target.user_id,
      action: input.disabled ? "communication.user.posting_disabled" : "communication.user.posting_restored",
      entityType: "user_account",
      entityId: target.account_id,
      previousValues: {
        communication_posting_disabled_at: target.communication_posting_disabled_at,
        communication_posting_disabled_reason: target.communication_posting_disabled_reason
      },
      newValues: {
        communication_posting_disabled_at: input.disabled ? new Date().toISOString() : null,
        communication_posting_disabled_reason: input.disabled ? reason : null
      },
      reasonComment: reason,
      ipAddress: requestMeta.ipAddress ?? null,
      userAgent: requestMeta.userAgent ?? null,
      sourceSurface: requestMeta.sourceSurface ?? "communications"
    });

    await writeCommunicationAuditEvent(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: target.user_id,
      eventType: input.disabled ? "communication.user.posting_disabled" : "communication.user.posting_restored",
      resourceType: "user_account",
      resourceId: target.account_id,
      result: input.disabled ? "disabled" : "enabled",
      newValues: {
        communication_posting_disabled_at: input.disabled ? "set" : null,
        communication_posting_disabled_reason: input.disabled ? reason : null
      }
    });

    const reloaded = await loadCommunicationIdentityByUserId(client, auth.tenantId, target.user_id);
    return {
      ok: true as const,
      user_id: target.user_id,
      posting_disabled: input.disabled,
      communication_identity: reloaded?.communicationIdentity ?? null
    };
  } catch (error) {
    await captureCommunicationFailure(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventType: "communication.moderation.posting_update_failed",
      resourceType: "user_account",
      resourceId: target?.account_id ?? null,
      area: "governance",
      action: "update_posting_state",
      error,
      context: {
        target_user_id: target?.user_id ?? input.userId,
        disabled: input.disabled
      }
    });
    throw error;
  }
}

export async function setUserCommunicationAccessState(
  client: PoolClient,
  auth: AuthUser,
  input: {
    userId: string;
    enabled: boolean;
    reason?: string | null;
  },
  requestMeta: RequestMeta = {}
) {
  let target: UserCommunicationStateRow | null = null;
  try {
    assertModerationRights(auth);
    target = await loadUserCommunicationState(client, auth.tenantId, input.userId);
    if (!target) {
      throw new ApiError(404, "Employee not found.");
    }
    if (!target.account_id) {
      throw new ApiError(409, "This employee does not have a linked account to update.");
    }

    const reason = normalizeText(input.reason);
    if (!input.enabled && !reason) {
      throw new ApiError(400, "A moderation reason is required to revoke communication access.");
    }

    await client.query(
      `
        UPDATE user_account
        SET
          communication_enabled = $3,
          updated_at = now()
        WHERE id = $1
          AND tenant_id = $2
      `,
      [target.account_id, auth.tenantId, input.enabled]
    );

    await insertModerationEvent(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      actionType: input.enabled ? "communication_access_restored" : "communication_access_revoked",
      targetType: "user",
      targetId: target.user_id,
      targetUserId: target.user_id,
      reason,
      metadata: {
        previous_communication_enabled: target.communication_enabled
      }
    });

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: target.user_id,
      action: input.enabled ? "communication.user.access_restored" : "communication.user.access_revoked",
      entityType: "user_account",
      entityId: target.account_id,
      previousValues: {
        communication_enabled: target.communication_enabled
      },
      newValues: {
        communication_enabled: input.enabled
      },
      reasonComment: reason,
      ipAddress: requestMeta.ipAddress ?? null,
      userAgent: requestMeta.userAgent ?? null,
      sourceSurface: requestMeta.sourceSurface ?? "communications"
    });

    await writeCommunicationAuditEvent(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: target.user_id,
      eventType: input.enabled ? "communication.user.access_restored" : "communication.user.access_revoked",
      resourceType: "user_account",
      resourceId: target.account_id,
      result: input.enabled ? "enabled" : "disabled",
      newValues: {
        communication_enabled: input.enabled
      }
    });

    const reloaded = await loadCommunicationIdentityByUserId(client, auth.tenantId, target.user_id);
    return {
      ok: true as const,
      user_id: target.user_id,
      communication_enabled: input.enabled,
      communication_identity: reloaded?.communicationIdentity ?? null
    };
  } catch (error) {
    await captureCommunicationFailure(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventType: "communication.moderation.access_update_failed",
      resourceType: "user_account",
      resourceId: target?.account_id ?? null,
      area: "governance",
      action: "update_access_state",
      error,
      context: {
        target_user_id: target?.user_id ?? input.userId,
        enabled: input.enabled
      }
    });
    throw error;
  }
}
