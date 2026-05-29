import type { PoolClient } from "pg";
import type { AuthUser } from "../../types/auth.js";
import { getContactImportSession } from "../../services/directoryImports.js";

export async function getContactImportSessionAction(client: PoolClient, auth: AuthUser, sessionId: string) {
  return getContactImportSession(client, auth, sessionId);
}
