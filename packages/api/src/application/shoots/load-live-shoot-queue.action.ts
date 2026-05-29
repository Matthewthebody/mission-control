import type { PoolClient } from "pg";
import {
  buildLiveShootQueueProjection,
  type LiveShootQueueProjection
} from "../../domain/lifecycle/live-shoot-queue-projection.js";
import { listShoots, type ShootListWindow } from "../../services/shoots.js";
import type { AuthUser } from "../../types/auth.js";

export type LiveShootQueueSource = Awaited<ReturnType<typeof listShoots>>[number];

export function buildLiveShootQueueFromSources(
  shoots: LiveShootQueueSource[],
  window: ShootListWindow
): LiveShootQueueProjection<LiveShootQueueSource> {
  return buildLiveShootQueueProjection(shoots, {
    date: window.date ?? null,
    dateFrom: window.dateFrom ?? null,
    dateTo: window.dateTo ?? null
  });
}

export async function loadLiveShootQueue(
  client: PoolClient,
  window: ShootListWindow,
  auth: AuthUser
): Promise<LiveShootQueueProjection<LiveShootQueueSource>> {
  const shoots = await listShoots(client, window, auth);

  return buildLiveShootQueueFromSources(shoots, window);
}
