import type { PoolClient } from "pg";
import type { AuthUser } from "../../types/auth.js";
import { writeAuditEvent } from "../diagnostics/auditEventService.js";

type PolicyAuditInput = {
  actorUserId?: string | null;
  targetUserId?: string | null;
  policyEventType: string;
  resourceType?: string | null;
  resourceId?: string | null;
  permissionCode?: string | null;
  result: string;
  details?: Record<string, unknown> | null;
};

export async function writePolicyAuditEvent(
  client: PoolClient,
  tenantId: string,
  input: PolicyAuditInput
) {
  await client.query(
    `
      INSERT INTO policy_audit_event (
        tenant_id,
        actor_user_id,
        target_user_id,
        policy_event_type,
        resource_type,
        resource_id,
        permission_code,
        result,
        details_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `,
    [
      tenantId,
      input.actorUserId ?? null,
      input.targetUserId ?? null,
      input.policyEventType,
      input.resourceType ?? null,
      input.resourceId ?? null,
      input.permissionCode ?? null,
      input.result,
      input.details ?? null
    ]
  );
  await writeAuditEvent(client, {
    tenantId,
    actorUserId: input.actorUserId ?? null,
    eventCategory: "policy",
    eventType: input.policyEventType,
    resourceType: input.resourceType ?? "policy",
    resourceId: input.resourceId ?? null,
    targetUserId: input.targetUserId ?? null,
    context: input.details ?? null,
    result: input.result
  });
}

export async function writeAuthPolicyAuditEvent(
  client: PoolClient,
  auth: AuthUser,
  input: Omit<PolicyAuditInput, "actorUserId">
) {
  await writePolicyAuditEvent(client, auth.tenantId, {
    ...input,
    actorUserId: auth.id
  });
}
