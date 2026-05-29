import type { PoolClient } from "pg";
import type { AuthUser } from "../../types/auth.js";
import {
  getProfitabilityWorkspace,
  type ProfitabilityWorkspaceResponse
} from "../../services/profitabilityWorkspace.js";

export async function loadProfitabilityWorkspace(
  client: PoolClient,
  auth: AuthUser,
  options: {
    anchorDate: string;
    dateFrom: string;
    dateTo: string;
    department?: string | null;
    focus?: "overview" | "watch" | "burden" | "data_health";
  }
): Promise<ProfitabilityWorkspaceResponse> {
  return getProfitabilityWorkspace(client, auth, options);
}
