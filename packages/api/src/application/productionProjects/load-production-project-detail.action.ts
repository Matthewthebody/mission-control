import type { PoolClient } from "pg";
import type { AuthUser } from "../../types/auth.js";
import { getProductionProjectDetail } from "../../services/productionProjects.js";
import type { ProductionProjectDetail } from "../../types/productionProjects.js";

export async function loadProductionProjectDetail(
  client: PoolClient,
  auth: AuthUser,
  projectId: string
): Promise<ProductionProjectDetail> {
  return getProductionProjectDetail(client, auth, projectId);
}
