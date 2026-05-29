import type { PoolClient } from "pg";
import { handleAppEvent } from "../handlers/appEventHandler.js";

export async function dispatchAppEvent(client: PoolClient, appEvent: any) {
  await handleAppEvent(client, appEvent);
}
