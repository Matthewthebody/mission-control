import NetInfo from "@react-native-community/netinfo";
import { deleteOfflineRequest, listOfflineRequests } from "./offlineQueue";
import { getToken } from "./auth";
import { mobileFetch } from "./api";

export type SyncOfflineQueueResult = {
  attempted: number;
  synced: number;
  failed: number;
  remaining: number;
  skippedOffline: boolean;
};

export async function syncOfflineQueue() {
  const state = await NetInfo.fetch();
  if (!state.isConnected) {
    return {
      attempted: 0,
      synced: 0,
      failed: 0,
      remaining: listOfflineRequests().length,
      skippedOffline: true
    } satisfies SyncOfflineQueueResult;
  }
  const token = getToken();
  let synced = 0;
  let failed = 0;
  const rows = listOfflineRequests();

  for (const row of rows) {
    const payload = JSON.parse(row.payload);
    const requestPath = row.request_path ?? (row.shoot_id ? `/api/shoots/${row.shoot_id}/status-events` : null);
    if (!requestPath) {
      failed += 1;
      continue;
    }

    const requestHeaders = parseHeaders(row.request_headers);
    if (!requestHeaders["Idempotency-Key"]) {
      requestHeaders["Idempotency-Key"] = row.id;
    }

    try {
      await mobileFetch(requestPath, token, {
        method: row.request_method ?? "POST",
        headers: requestHeaders,
        body: JSON.stringify(payload)
      });
      deleteOfflineRequest(row.id);
      synced += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    attempted: rows.length,
    synced,
    failed,
    remaining: listOfflineRequests().length,
    skippedOffline: false
  } satisfies SyncOfflineQueueResult;
}

function parseHeaders(value: string | null) {
  if (!value) {
    return {} as Record<string, string>;
  }

  try {
    const parsed = JSON.parse(value) as Record<string, string>;
    return parsed ?? {};
  } catch {
    return {};
  }
}
