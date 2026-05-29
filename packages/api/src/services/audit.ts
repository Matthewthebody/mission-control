import type { PoolClient } from "pg";
import { writeAuditEvent } from "./diagnostics/auditEventService.js";
import { getRequestContext } from "./requestContext.js";

export async function createAuditLog(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId?: string | null;
    targetUserId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
    ipAddress?: string | null;
    userAgent?: string | null;
    sourceSurface?: string | null;
    resultStatus?: string | null;
    previousValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    reasonComment?: string | null;
  }
  ) {
  const requestContext = getRequestContext();
  const auth = requestContext?.auth ?? null;
  const { rows } = await client.query(
    `
      INSERT INTO audit_log (
        tenant_id,
        actor_user_id,
        target_user_id,
        session_id,
        request_id,
        effective_authority_tier,
        session_assurance,
        session_transport,
        elevated_session,
        privileged_mode,
        break_glass_mode,
        source_surface,
        result_status,
        action,
        entity_type,
        entity_id,
        previous_values,
        new_values,
        reason_comment,
        metadata,
        ip_address,
        user_agent
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19,$20::jsonb,$21,$22)
      RETURNING *
    `,
    [
      input.tenantId,
      input.actorUserId ?? null,
      input.targetUserId ?? null,
      auth?.sessionId ?? null,
      requestContext?.requestId ?? null,
      auth?.authorityTier ?? null,
      auth?.sessionTrust.sessionAssurance ?? null,
      requestContext?.requestTransport ?? auth?.sessionTrust.requestTransport ?? null,
      auth?.sessionTrust.elevatedSessionActive ?? false,
      auth?.sessionTrust.privilegedModeActive ?? false,
      auth?.sessionTrust.breakGlassModeActive ?? false,
      input.sourceSurface ?? requestContext?.sourceSurface ?? null,
      input.resultStatus ?? "succeeded",
      input.action,
      input.entityType,
      input.entityId ?? null,
      JSON.stringify(input.previousValues ?? {}),
      JSON.stringify(input.newValues ?? {}),
      input.reasonComment ?? null,
      JSON.stringify({
        trust_tier: auth?.authorityTier ?? null,
        break_glass_scope_type: auth?.sessionTrust.breakGlassScopeType ?? null,
        break_glass_scope_id: auth?.sessionTrust.breakGlassScopeId ?? null,
        ...(input.metadata ?? {})
      }),
      input.ipAddress ?? requestContext?.ipAddress ?? null,
      input.userAgent ?? requestContext?.userAgent ?? null
    ]
  );
  await writeAuditEvent(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    eventCategory: input.action.includes(".") ? input.action.split(".")[0] ?? "audit" : "audit",
    eventType: input.action,
    resourceType: input.entityType,
    resourceId: input.entityId ?? null,
    targetUserId: input.targetUserId ?? null,
    requestId: requestContext?.requestId ?? null,
    oldValues: input.previousValues ?? null,
    newValues: input.newValues ?? null,
    context: {
      audit_log_id: rows[0]?.id ?? null,
      source_surface: input.sourceSurface ?? requestContext?.sourceSurface ?? null,
      reason_comment: input.reasonComment ?? null,
      ip_address: input.ipAddress ?? requestContext?.ipAddress ?? null,
      user_agent: input.userAgent ?? requestContext?.userAgent ?? null,
      ...(input.metadata ?? {})
    },
    result: input.resultStatus ?? "succeeded"
  });
  return rows[0];
}
