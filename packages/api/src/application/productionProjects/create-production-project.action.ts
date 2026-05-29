import type { PoolClient } from "pg";
import type { AuthUser } from "../../types/auth.js";
import { createProductionProject, type CreateProductionProjectInput } from "../../services/productionProjects.js";
import type { ProductionProjectDetail } from "../../types/productionProjects.js";

export async function createProductionProjectAction(
  client: PoolClient,
  auth: AuthUser,
  input: CreateProductionProjectInput
): Promise<ProductionProjectDetail> {
  return createProductionProject(client, auth, input);
}
