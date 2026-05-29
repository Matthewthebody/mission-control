import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { JobDepartmentType } from "../../domain/jobTruth/index.js";
import type { AuthUser } from "../../types/auth.js";
import type { AuditEventRecord } from "../../types/diagnostics.js";
import { getRequestContext } from "../requestContext.js";

type JsonShape = Record<string, unknown> | null | undefined;

export type AuditEventInput = {
  tenantId: string;
  actorUserId?: string | null;
  eventCategory: string;
  eventType: string;
  resourceType: string;
  resourceId?: string | null;
  targetUserId?: string | null;
  departmentType?: JobDepartmentType | null;
  requestId?: string | null;
  traceId?: string | null;
  oldValues?: JsonShape;
  newValues?: JsonShape;
  context?: JsonShape;
  result: string;
};

function stringifyJson(value: JsonShape) {
  return value == null ? null : JSON.stringify(value);
}

export async function writeAuditEvent(client: PoolClient, input: AuditEventInput): Promise<AuditEventRecord> {
  const requestContext = getRequestContext();
  const requestId = input.requestId ?? requestContext?.requestId ?? null;
  const traceId =
    input.traceId ??
    (requestId
      ? `${input.eventCategory}:${input.eventType}:${input.resourceType}:${input.resourceId ?? "record"}:${requestId}`
      : randomUUID());

  const { rows } = await client.query<AuditEventRecord>(
    `
      INSERT INTO audit_events (
        tenant_id,
        actor_user_id,
        event_category,
        event_type,
        resource_type,
        resource_id,
        target_user_id,
        department_type,
        request_id,
        trace_id,
        old_values_json,
        new_values_json,
        context_json,
        result
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14)
      RETURNING
        id::text,
        tenant_id::text,
        actor_user_id::text,
        event_category,
        event_type,
        resource_type,
        resource_id,
        target_user_id::text,
        department_type,
        request_id,
        trace_id,
        old_values_json,
        new_values_json,
        context_json,
        result,
        created_at
    `,
    [
      input.tenantId,
      input.actorUserId ?? null,
      input.eventCategory,
      input.eventType,
      input.resourceType,
      input.resourceId ?? null,
      input.targetUserId ?? null,
      input.departmentType ?? null,
      requestId,
      traceId,
      stringifyJson(input.oldValues),
      stringifyJson(input.newValues),
      stringifyJson({
        request: requestContext
          ? {
              method: requestContext.method,
              path: requestContext.path,
              ip_address: requestContext.ipAddress,
              user_agent: requestContext.userAgent,
              source_surface: requestContext.sourceSurface,
              request_transport: requestContext.requestTransport
            }
          : null,
        ...(input.context ?? {})
      }),
      input.result
    ]
  );

  return rows[0];
}

export async function writeAuthAuditEvent(
  client: PoolClient,
  auth: AuthUser,
  input: Omit<AuditEventInput, "tenantId" | "actorUserId">
) {
  return writeAuditEvent(client, {
    ...input,
    tenantId: auth.tenantId,
    actorUserId: auth.id
  });
}
