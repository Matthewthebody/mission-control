import type { PoolClient } from "pg";
import { getOrganizationOperationsHub } from "../../services/organizationOperations.js";
import type { AuthUser } from "../../types/auth.js";

export async function loadOrganizationOperationsHub(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  options: { date?: string | null } = {}
) {
  return getOrganizationOperationsHub(client, auth, organizationId, { anchorDate: options.date ?? null });
}
