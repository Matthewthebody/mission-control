import type { PoolClient } from "pg";
import type { AuthUser } from "../../types/auth.js";
import { getProductionProjectReferenceData } from "../../services/productionProjects.js";
import type { ProductionProjectReferenceData } from "../../types/productionProjects.js";

export async function loadProductionProjectReferenceData(
  client: PoolClient,
  auth: AuthUser,
  options: {
    linkedOrganizationId?: string | null;
    linkedLocationId?: string | null;
  } = {}
): Promise<ProductionProjectReferenceData> {
  return getProductionProjectReferenceData(client, auth, options);
}

