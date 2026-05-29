import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser, AuthorityTier } from "../types/auth.js";
import { createAuditLog } from "./audit.js";
import { getRequestContext } from "./requestContext.js";
import { hasElevatedSession } from "./securitySession.js";

export type DangerousActionCode =
  | "delete_shift"
  | "delete_shoot"
  | "bulk_reassign_staff"
  | "backdate_punch_change"
  | "change_shoot_status_complete"
  | "cancel_operational_shoot"
  | "hide_alert"
  | "cancel_big_shoot"
  | "edit_historical_record"
  | "push_external_updates";

type DangerousActionPolicyRow = {
  id: string;
  tenant_id: string;
  action_code: DangerousActionCode;
  minimum_authority_tier: AuthorityTier;
  confirmation_required: boolean;
  elevation_required: boolean;
  reason_required: boolean;
  dual_approval_required: boolean;
  break_glass_allowed: boolean;
  reauth_window_minutes: number;
  enabled: boolean;
};

const AUTHORITY_ORDER: Record<AuthorityTier, number> = {
  read_only_viewer: 0,
  standard_employee: 1,
  supervisor: 2,
  director_admin: 3,
  leadership: 4,
  super_admin: 5
};

const DEFAULT_DANGEROUS_ACTION_POLICIES: Record<
  DangerousActionCode,
  Omit<DangerousActionPolicyRow, "id" | "tenant_id" | "action_code">
> = {
  delete_shift: {
    minimum_authority_tier: "leadership",
    confirmation_required: true,
    elevation_required: true,
    reason_required: true,
    dual_approval_required: false,
    break_glass_allowed: false,
    reauth_window_minutes: 10,
    enabled: true
  },
  delete_shoot: {
    minimum_authority_tier: "leadership",
    confirmation_required: true,
    elevation_required: true,
    reason_required: true,
    dual_approval_required: false,
    break_glass_allowed: false,
    reauth_window_minutes: 10,
    enabled: true
  },
  bulk_reassign_staff: {
    minimum_authority_tier: "leadership",
    confirmation_required: true,
    elevation_required: true,
    reason_required: true,
    dual_approval_required: false,
    break_glass_allowed: false,
    reauth_window_minutes: 15,
    enabled: true
  },
  backdate_punch_change: {
    minimum_authority_tier: "leadership",
    confirmation_required: true,
    elevation_required: true,
    reason_required: true,
    dual_approval_required: false,
    break_glass_allowed: false,
    reauth_window_minutes: 15,
    enabled: true
  },
  change_shoot_status_complete: {
    minimum_authority_tier: "leadership",
    confirmation_required: true,
    elevation_required: true,
    reason_required: true,
    dual_approval_required: false,
    break_glass_allowed: false,
    reauth_window_minutes: 15,
    enabled: true
  },
  cancel_operational_shoot: {
    minimum_authority_tier: "leadership",
    confirmation_required: true,
    elevation_required: true,
    reason_required: true,
    dual_approval_required: false,
    break_glass_allowed: false,
    reauth_window_minutes: 15,
    enabled: true
  },
  hide_alert: {
    minimum_authority_tier: "director_admin",
    confirmation_required: true,
    elevation_required: true,
    reason_required: true,
    dual_approval_required: false,
    break_glass_allowed: false,
    reauth_window_minutes: 10,
    enabled: true
  },
  cancel_big_shoot: {
    minimum_authority_tier: "leadership",
    confirmation_required: true,
    elevation_required: true,
    reason_required: true,
    dual_approval_required: false,
    break_glass_allowed: false,
    reauth_window_minutes: 10,
    enabled: true
  },
  edit_historical_record: {
    minimum_authority_tier: "leadership",
    confirmation_required: true,
    elevation_required: true,
    reason_required: true,
    dual_approval_required: false,
    break_glass_allowed: false,
    reauth_window_minutes: 15,
    enabled: true
  },
  push_external_updates: {
    minimum_authority_tier: "leadership",
    confirmation_required: true,
    elevation_required: true,
    reason_required: true,
    dual_approval_required: false,
    break_glass_allowed: false,
    reauth_window_minutes: 10,
    enabled: true
  }
};

export async function getDangerousActionPolicy(client: PoolClient, tenantId: string, actionCode: DangerousActionCode) {
  const { rows } = await client.query<DangerousActionPolicyRow>(
    `
      SELECT
        id,
        tenant_id,
        action_code,
        minimum_authority_tier::text AS minimum_authority_tier,
        confirmation_required,
        elevation_required,
        reason_required,
        dual_approval_required,
        break_glass_allowed,
        reauth_window_minutes,
        enabled
      FROM dangerous_action_policy
      WHERE tenant_id = $1
        AND action_code = $2
        AND enabled = true
      LIMIT 1
    `,
    [tenantId, actionCode]
  );

  return rows[0] ?? {
    id: "",
    tenant_id: tenantId,
    action_code: actionCode,
    ...DEFAULT_DANGEROUS_ACTION_POLICIES[actionCode]
  };
}

function hasRequiredAuthority(auth: AuthUser, minimumTier: AuthorityTier) {
  return AUTHORITY_ORDER[auth.authorityTier] >= AUTHORITY_ORDER[minimumTier];
}

export async function beginDangerousAction(
  client: PoolClient,
  auth: AuthUser,
  input: {
    actionCode: DangerousActionCode;
    entityType: string;
    entityId?: string | null;
    sourceModule: string;
    reason?: string | null;
    beforeValue?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    approvalRequestId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
) {
  const policy = await getDangerousActionPolicy(client, auth.tenantId, input.actionCode);
  const requestContext = getRequestContext();
  const meetsAuthority = hasRequiredAuthority(auth, policy.minimum_authority_tier);
  const hasEmergencyOverride = auth.sessionTrust.breakGlassModeActive && policy.break_glass_allowed;
  const hasElevation = hasElevatedSession(auth);
  const missingReason = policy.reason_required && !input.reason?.trim();
  const missingElevation = policy.elevation_required && !hasElevation;
  const missingApproval = policy.dual_approval_required && !input.approvalRequestId;
  const allowed = (meetsAuthority || hasEmergencyOverride) && !missingReason && !missingElevation && !missingApproval;
  const denialReason = missingReason
    ? "reason_required"
    : missingElevation
      ? "elevation_required"
      : missingApproval
        ? "approval_required"
        : meetsAuthority || hasEmergencyOverride
          ? "allowed"
          : "insufficient_authority";
  const { rows } = await client.query(
    `
      INSERT INTO dangerous_action_execution (
        tenant_id,
        action_code,
        status,
        actor_user_id,
        entity_type,
        entity_id,
        source_module,
        reason,
        before_value,
        metadata,
        request_id,
        session_id,
        security_approval_request_id,
        elevated_session,
        break_glass_mode,
        result_code
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16)
      RETURNING *
    `,
    [
      auth.tenantId,
      input.actionCode,
      allowed ? "allowed" : "denied",
      auth.id,
      input.entityType,
      input.entityId ?? null,
      input.sourceModule,
      input.reason ?? null,
      JSON.stringify(input.beforeValue ?? {}),
      JSON.stringify({
        ...(input.metadata ?? {}),
        minimum_authority_tier: policy.minimum_authority_tier,
        confirmation_required: policy.confirmation_required,
        elevation_required: policy.elevation_required,
        dual_approval_required: policy.dual_approval_required,
        break_glass_allowed: policy.break_glass_allowed,
        reauth_window_minutes: policy.reauth_window_minutes
      }),
      requestContext?.requestId ?? null,
      auth.sessionId || null,
      input.approvalRequestId ?? null,
      auth.sessionTrust.elevatedSessionActive,
      auth.sessionTrust.breakGlassModeActive,
      denialReason
    ]
  );
  const execution = rows[0];

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: allowed ? "dangerous_action.allowed" : "dangerous_action.denied",
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: {
      dangerous_action_execution_id: execution.id,
      action_code: input.actionCode,
      source_module: input.sourceModule,
      reason: input.reason ?? null,
      before_value: input.beforeValue ?? {},
      policy_minimum_authority_tier: policy.minimum_authority_tier,
      policy_elevation_required: policy.elevation_required,
      policy_dual_approval_required: policy.dual_approval_required,
      execution_mode: "manual",
      outcome: allowed ? "allowed" : "denied",
      result_code: denialReason
    },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    resultStatus: allowed ? "succeeded" : "denied"
  });

  if (missingReason) {
    throw new ApiError(400, "A reason is required before this action can run.");
  }
  if (missingElevation) {
    throw new ApiError(428, "Recent reauthentication is required before this action can run.");
  }
  if (missingApproval) {
    throw new ApiError(428, "A secondary security approval is required before this action can run.");
  }
  if (!allowed) {
    throw new ApiError(403, "This action is limited to leadership-controlled workflows");
  }

  return {
    executionId: execution.id,
    policy
  };
}

export async function completeDangerousAction(
  client: PoolClient,
  auth: AuthUser,
  input: {
    executionId: string;
    actionCode: DangerousActionCode;
    entityType: string;
    entityId?: string | null;
    afterValue?: Record<string, unknown>;
    reason?: string | null;
    metadata?: Record<string, unknown>;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
) {
  await client.query(
    `
      UPDATE dangerous_action_execution
      SET status = 'executed',
          after_value = $2::jsonb,
          metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
          result_code = 'executed'
      WHERE id = $1
    `,
    [input.executionId, JSON.stringify(input.afterValue ?? {}), JSON.stringify(input.metadata ?? {})]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "dangerous_action.executed",
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: {
      dangerous_action_execution_id: input.executionId,
      action_code: input.actionCode,
      reason: input.reason ?? null,
      after_value: input.afterValue ?? {},
      execution_mode: "manual"
    },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    resultStatus: "succeeded"
  });
}

export async function failDangerousAction(
  client: PoolClient,
  auth: AuthUser,
  input: {
    executionId: string;
    actionCode: DangerousActionCode;
    entityType: string;
    entityId?: string | null;
    errorMessage: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
) {
  await client.query(
    `
      UPDATE dangerous_action_execution
      SET status = 'failed',
          metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
          result_code = 'failed'
      WHERE id = $1
    `,
    [
      input.executionId,
      JSON.stringify({
        ...(input.metadata ?? {}),
        error: input.errorMessage
      })
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "dangerous_action.failed",
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: {
      dangerous_action_execution_id: input.executionId,
      action_code: input.actionCode,
      error: input.errorMessage,
      execution_mode: "manual"
    },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    resultStatus: "failed"
  });
}
