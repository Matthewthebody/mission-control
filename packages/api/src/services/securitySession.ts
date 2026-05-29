import type { PoolClient } from "pg";
import { config } from "../config.js";
import { withSystemTransaction } from "../db/tx.js";
import { hasAuthorityTier } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { createAuditLog } from "./audit.js";
import { loadAuthenticatedUserBySession, verifyPassword } from "./auth.js";
import { createMicrosoftEntraStepUpUrl } from "./microsoftEntra.js";
import { getMicrosoftEntraStepUpRule, isMicrosoftEntraStepUpSatisfied } from "./microsoftEntraContracts.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

function assertSessionOwnership(auth: AuthUser) {
  if (!auth.sessionId) {
    throw new ApiError(401, "A live authenticated session is required.");
  }
}

export function hasElevatedSession(auth: Pick<AuthUser, "sessionTrust">) {
  return auth.sessionTrust.elevatedSessionActive || auth.sessionTrust.breakGlassModeActive;
}

export function hasPrivilegedMode(auth: Pick<AuthUser, "sessionTrust">) {
  return auth.sessionTrust.privilegedModeActive || auth.sessionTrust.breakGlassModeActive;
}

export function canEnterBreakGlass(auth: Pick<AuthUser, "authorityTier" | "permissions">) {
  return hasAuthorityTier(auth, ["super_admin", "leadership"]);
}

async function resolveMicrosoftStepUpChallenge(
  client: PoolClient,
  auth: AuthUser,
  actionKey: string | null | undefined,
  meta: RequestMeta,
  returnHash = "#account"
) {
  const stepUp = await getMicrosoftEntraStepUpRule(client, auth.tenantId, actionKey);
  return {
    stepUp,
    // Persist the OAuth state outside the current transaction so the 428 challenge can safely abort without losing the step-up request.
    startUrl: await withSystemTransaction((systemClient) =>
      createMicrosoftEntraStepUpUrl(
        systemClient,
        auth,
        {
          actionKey: stepUp.actionKey,
          returnHash
        },
        meta
      )
    )
  };
}

export async function elevateAuthenticatedSession(
  client: PoolClient,
  auth: AuthUser,
  input: {
    currentPassword?: string | null;
    reason?: string | null;
    actionKey?: string | null;
    returnHash?: string | null;
  },
  meta: RequestMeta
) {
  assertSessionOwnership(auth);
  let elevatedMinutes = config.AUTH_ELEVATED_MINUTES;
  let privilegedMinutes = config.AUTH_PRIVILEGED_MODE_MINUTES;

  if (auth.sessionTrust.identityProvider === "local_password") {
    if (!auth.accountId) {
      throw new ApiError(400, "Password-based elevation is not configured for this account.");
    }
    if (!input.currentPassword) {
      throw new ApiError(400, "Current password is required to elevate this session.");
    }
    const result = await client.query<{ password_hash: string | null }>("SELECT password_hash FROM user_account WHERE id = $1", [auth.accountId]);
    const passwordHash = result.rows[0]?.password_hash ?? null;
    if (!(await verifyPassword(input.currentPassword, passwordHash))) {
      throw new ApiError(401, "Current password is incorrect.");
    }
  } else if (auth.sessionTrust.identityProvider === "dev") {
    if (config.NODE_ENV === "production") {
      throw new ApiError(403, "Development session elevation is unavailable in production.");
    }
  } else {
    const { stepUp, startUrl } = await resolveMicrosoftStepUpChallenge(client, auth, input.actionKey ?? null, meta, input.returnHash ?? "#account");
    elevatedMinutes = stepUp.rule.elevated_window_minutes;
    privilegedMinutes = stepUp.rule.privileged_window_minutes;
    if (!isMicrosoftEntraStepUpSatisfied(auth.sessionTrust, stepUp.rule)) {
      throw new ApiError(428, "Microsoft reauthentication is required before this privileged action can run.", {
        code: "microsoft_entra_step_up_required",
        challenge_type: "microsoft_entra_step_up",
        action_key: stepUp.actionKey,
        start_url: startUrl,
        required_auth_context_id: stepUp.rule.auth_context_id,
        required_assurance: stepUp.rule.required_assurance,
        reauth_window_minutes: stepUp.rule.reauth_window_minutes,
        elevated_window_minutes: stepUp.rule.elevated_window_minutes,
        privileged_window_minutes: stepUp.rule.privileged_window_minutes,
        allow_break_glass: stepUp.rule.allow_break_glass
      });
    }
  }

  await client.query(
    `
      UPDATE auth_session
      SET
        last_reauthenticated_at = now(),
        elevated_until = now() + ($2::text || ' minutes')::interval,
        privileged_mode_until = now() + ($3::text || ' minutes')::interval,
        elevation_reason = $4,
        updated_at = now()
      WHERE id = $1
    `,
    [auth.sessionId, String(elevatedMinutes), String(privilegedMinutes), input.reason ?? null]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: auth.id,
    action: "auth.session.elevated",
    entityType: "session",
    entityId: auth.sessionId,
    metadata: {
      elevated_minutes: elevatedMinutes,
      privileged_mode_minutes: privilegedMinutes,
      action_key: input.actionKey ?? "session.elevate",
      reason: input.reason ?? null
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  const refreshed = await loadAuthenticatedUserBySession(client, auth.sessionId);
  if (!refreshed) {
    throw new ApiError(401, "The session could not be refreshed after elevation.");
  }
  return refreshed;
}

export async function endSessionElevation(client: PoolClient, auth: AuthUser, meta: RequestMeta) {
  assertSessionOwnership(auth);
  await client.query(
    `
      UPDATE auth_session
      SET
        elevated_until = NULL,
        privileged_mode_until = NULL,
        elevation_reason = NULL,
        updated_at = now()
      WHERE id = $1
    `,
    [auth.sessionId]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: auth.id,
    action: "auth.session.elevation_ended",
    entityType: "session",
    entityId: auth.sessionId,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  const refreshed = await loadAuthenticatedUserBySession(client, auth.sessionId);
  if (!refreshed) {
    throw new ApiError(401, "The session could not be refreshed after ending elevation.");
  }
  return refreshed;
}

export async function activateBreakGlass(
  client: PoolClient,
  auth: AuthUser,
  input: {
    reason: string;
    scopeType?: string | null;
    scopeId?: string | null;
    durationMinutes?: number | null;
  },
  meta: RequestMeta
) {
  assertSessionOwnership(auth);
  if (!canEnterBreakGlass(auth)) {
    throw new ApiError(403, "Break-glass access is limited to leadership emergency workflows.");
  }
  if (auth.sessionTrust.identityProvider === "microsoft_entra") {
    const { stepUp, startUrl } = await resolveMicrosoftStepUpChallenge(client, auth, "break_glass.start", meta);
    if (!stepUp.rule.allow_break_glass) {
      throw new ApiError(403, "Microsoft break-glass activation is disabled by the current enterprise step-up policy.");
    }
    if (!isMicrosoftEntraStepUpSatisfied(auth.sessionTrust, stepUp.rule)) {
      throw new ApiError(428, "Recent Microsoft reauthentication is required before break-glass access can start.", {
        code: "microsoft_entra_step_up_required",
        challenge_type: "microsoft_entra_step_up",
        action_key: stepUp.actionKey,
        start_url: startUrl,
        required_auth_context_id: stepUp.rule.auth_context_id,
        required_assurance: stepUp.rule.required_assurance,
        reauth_window_minutes: stepUp.rule.reauth_window_minutes,
        elevated_window_minutes: stepUp.rule.elevated_window_minutes,
        privileged_window_minutes: stepUp.rule.privileged_window_minutes,
        allow_break_glass: stepUp.rule.allow_break_glass
      });
    }
  } else if (!hasElevatedSession(auth)) {
    throw new ApiError(428, "Recent reauthentication is required before break-glass access can start.");
  }

  const durationMinutes = Math.max(5, Math.min(config.AUTH_BREAK_GLASS_MAX_MINUTES, Number(input.durationMinutes ?? 15)));
  const eventResult = await client.query<{ id: string; expires_at: string }>(
    `
      INSERT INTO break_glass_event (
        tenant_id, actor_user_id, session_id, scope_type, scope_id, reason, expires_at
      )
      VALUES ($1,$2,$3,$4,$5,$6, now() + ($7::text || ' minutes')::interval)
      RETURNING id, expires_at::text
    `,
    [auth.tenantId, auth.id, auth.sessionId, input.scopeType ?? null, input.scopeId ?? null, input.reason, String(durationMinutes)]
  );

  await client.query(
    `
      UPDATE auth_session
      SET
        break_glass_started_at = now(),
        break_glass_until = now() + ($2::text || ' minutes')::interval,
        break_glass_reason = $3,
        break_glass_scope_type = $4,
        break_glass_scope_id = $5,
        privileged_mode_until = GREATEST(COALESCE(privileged_mode_until, now()), now() + ($2::text || ' minutes')::interval),
        updated_at = now()
      WHERE id = $1
    `,
    [auth.sessionId, String(durationMinutes), input.reason, input.scopeType ?? null, input.scopeId ?? null]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: auth.id,
    action: "auth.break_glass.started",
    entityType: "break_glass_event",
    entityId: eventResult.rows[0].id,
    metadata: {
      scope_type: input.scopeType ?? null,
      scope_id: input.scopeId ?? null,
      duration_minutes: durationMinutes,
      reason: input.reason
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  const refreshed = await loadAuthenticatedUserBySession(client, auth.sessionId);
  if (!refreshed) {
    throw new ApiError(401, "The session could not be refreshed after break-glass activation.");
  }
  return {
    auth: refreshed,
    breakGlassEventId: eventResult.rows[0].id
  };
}

export async function endBreakGlass(client: PoolClient, auth: AuthUser, input: { reason?: string | null }, meta: RequestMeta) {
  assertSessionOwnership(auth);
  await client.query(
    `
      UPDATE break_glass_event
      SET ended_at = now(),
          ended_by_user_id = $2,
          ended_reason = COALESCE($3, ended_reason),
          review_status = CASE WHEN review_status = 'pending_review' THEN 'reviewed' ELSE review_status END
      WHERE tenant_id = $1
        AND session_id = $4
        AND ended_at IS NULL
    `,
    [auth.tenantId, auth.id, input.reason ?? null, auth.sessionId]
  );

  await client.query(
    `
      UPDATE auth_session
      SET
        break_glass_started_at = NULL,
        break_glass_until = NULL,
        break_glass_reason = NULL,
        break_glass_scope_type = NULL,
        break_glass_scope_id = NULL,
        updated_at = now()
      WHERE id = $1
    `,
    [auth.sessionId]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: auth.id,
    action: "auth.break_glass.ended",
    entityType: "session",
    entityId: auth.sessionId,
    metadata: {
      reason: input.reason ?? null
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  const refreshed = await loadAuthenticatedUserBySession(client, auth.sessionId);
  if (!refreshed) {
    throw new ApiError(401, "The session could not be refreshed after break-glass ended.");
  }
  return refreshed;
}
