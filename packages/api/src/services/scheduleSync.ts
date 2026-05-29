import type { PoolClient } from "pg";
import { config } from "../config.js";
import { queueIntegrationSyncOperation } from "./integrationSync.js";
import { loadOutlookTenantState } from "./outlookStore.js";

export type WritableScheduleSyncState = "not_linked" | "pending_sync";

export async function getScheduleSyncWriteState(client: PoolClient, tenantId: string): Promise<{
  syncRequired: boolean;
  syncState: WritableScheduleSyncState;
}> {
  const tenantState = await loadOutlookTenantState(client, tenantId);
  const connected =
    tenantState.activeConnection?.provider_mode === "graph_live" &&
    tenantState.activeConnection.connection_status === "connected";
  return connected
    ? {
        syncRequired: true,
        syncState: "pending_sync"
      }
    : {
        syncRequired: false,
        syncState: "not_linked"
      };
}

export async function queueScheduleSync(client: PoolClient, input: {
  tenantId: string;
  aggregateType: "shoot" | "schedule_event" | "work_shift";
  aggregateId: string;
  dedupeSuffix: string;
  payload: Record<string, unknown>;
  triggeredByUserId?: string | null;
  operationType?: string;
}) {
  return queueIntegrationSyncOperation(client, {
    tenantId: input.tenantId,
    provider: "outlook",
    direction: "outbound",
    entityType: input.aggregateType,
    entityId: input.aggregateId,
    externalObjectType: "calendar_event",
    operationType: input.operationType ?? "upsert",
    sourceSystem: "mission_control",
    sourceChangeKey: `${input.aggregateType}:${input.aggregateId}:${input.dedupeSuffix}`,
    triggeredByUserId: input.triggeredByUserId ?? null,
    payload: input.payload
  });
}
