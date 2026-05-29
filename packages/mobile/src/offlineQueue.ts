import { db } from "./db";

export type OfflineQueueRow = {
  id: string;
  shoot_id: string | null;
  request_path: string | null;
  request_method: string | null;
  request_headers: string | null;
  payload: string;
  created_at: string;
};

export type OfflineRequestInput = {
  id: string;
  shootId?: string | null;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  payload: Record<string, unknown>;
};

export function enqueueOfflineRequest(input: OfflineRequestInput) {
  db.runSync(
    `
      INSERT OR REPLACE INTO offline_queue (
        id, shoot_id, request_path, request_method, request_headers, payload, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.id,
      input.shootId ?? null,
      input.path,
      input.method ?? "POST",
      JSON.stringify(input.headers ?? {}),
      JSON.stringify(input.payload),
      new Date().toISOString()
    ]
  );
}

export function enqueueOfflineEvent(id: string, shootId: string, payload: Record<string, unknown>) {
  enqueueOfflineRequest({
    id,
    shootId,
    path: `/api/shoots/${shootId}/status-events`,
    method: "POST",
    headers: {
      "Idempotency-Key": id
    },
    payload
  });
}

export function listOfflineRequests() {
  return db.getAllSync("SELECT * FROM offline_queue ORDER BY created_at ASC") as OfflineQueueRow[];
}

export function getOfflineQueueCount() {
  const result = db.getFirstSync("SELECT COUNT(*) AS count FROM offline_queue");
  return Number((result as { count?: number } | null)?.count ?? 0);
}

export function listOfflineEvents() {
  return listOfflineRequests();
}

export function deleteOfflineRequest(id: string) {
  db.runSync("DELETE FROM offline_queue WHERE id = ?", [id]);
}

export function deleteOfflineEvent(id: string) {
  deleteOfflineRequest(id);
}
