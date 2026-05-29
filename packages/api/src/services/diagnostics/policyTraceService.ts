import type { PoolClient } from "pg";
import type { AuthUser } from "../../types/auth.js";
import type {
  PolicyDecisionTraceListItem,
  PolicyDecisionTraceRecord
} from "../../types/diagnostics.js";

type JsonMap = Record<string, unknown> | null | undefined;

export type PolicyDecisionTraceInput = {
  permissionKey: string;
  resourceType?: string | null;
  resourceId?: string | null;
  scopeContext: Record<string, unknown>;
  decision: "allowed" | "denied" | "masked" | "readonly";
  decisionReason: string;
  matchedRules?: JsonMap;
};

function stringifyJson(value: JsonMap) {
  return value == null ? null : JSON.stringify(value);
}

export async function writePolicyDecisionTrace(
  client: PoolClient,
  auth: AuthUser,
  input: PolicyDecisionTraceInput
): Promise<PolicyDecisionTraceRecord> {
  const { rows } = await client.query<PolicyDecisionTraceRecord>(
    `
      INSERT INTO policy_decision_traces (
        tenant_id,
        actor_user_id,
        permission_key,
        resource_type,
        resource_id,
        scope_context_json,
        decision,
        decision_reason,
        matched_rules_json
      )
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb)
      RETURNING
        id::text,
        tenant_id::text,
        actor_user_id::text,
        permission_key,
        resource_type,
        resource_id,
        scope_context_json,
        decision,
        decision_reason,
        matched_rules_json,
        created_at
    `,
    [
      auth.tenantId,
      auth.id,
      input.permissionKey,
      input.resourceType ?? null,
      input.resourceId ?? null,
      JSON.stringify(input.scopeContext),
      input.decision,
      input.decisionReason,
      stringifyJson(input.matchedRules)
    ]
  );

  return rows[0];
}

export async function listPolicyDecisionTraces(
  client: PoolClient,
  tenantId: string,
  filters: {
    permissionKey?: string | null;
    resourceType?: string | null;
    resourceId?: string | null;
    actorUserId?: string | null;
    limit?: number;
  } = {}
): Promise<PolicyDecisionTraceListItem[]> {
  const conditions = ["trace.tenant_id = $1"];
  const values: Array<string | number> = [tenantId];

  if (filters.resourceType) {
    values.push(filters.resourceType);
    conditions.push(`trace.resource_type = $${values.length}`);
  }
  if (filters.permissionKey) {
    values.push(filters.permissionKey);
    conditions.push(`trace.permission_key = $${values.length}`);
  }
  if (filters.resourceId) {
    values.push(filters.resourceId);
    conditions.push(`trace.resource_id = $${values.length}`);
  }
  if (filters.actorUserId) {
    values.push(filters.actorUserId);
    conditions.push(`trace.actor_user_id = $${values.length}::uuid`);
  }
  values.push(filters.limit ?? 100);

  const { rows } = await client.query<PolicyDecisionTraceListItem>(
    `
      SELECT
        trace.id::text,
        trace.tenant_id::text,
        trace.actor_user_id::text,
        trace.permission_key,
        trace.resource_type,
        trace.resource_id,
        trace.scope_context_json,
        trace.decision,
        trace.decision_reason,
        trace.matched_rules_json,
        trace.created_at,
        actor.full_name AS actor_name
      FROM policy_decision_traces trace
      LEFT JOIN app_user actor ON actor.id = trace.actor_user_id AND actor.tenant_id = trace.tenant_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY trace.created_at DESC
      LIMIT $${values.length}
    `,
    values
  );

  return rows;
}
