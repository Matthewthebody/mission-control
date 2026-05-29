import type { PoolClient } from "pg";
import type { AuthUser } from "../../types/auth.js";
import { listContactImportSessions } from "../../services/directoryImports.js";

export async function listContactImportSessionsAction(client: PoolClient, auth: AuthUser) {
  return listContactImportSessions(client, auth);
}
