import type { PoolClient } from "pg";
import type { AuthUser } from "../../types/auth.js";
import { updateProductionProject, type UpdateProductionProjectInput } from "../../services/productionProjects.js";
import type { ProductionProjectMutationResult } from "../../types/productionProjects.js";

export async function updateProductionProjectAction(
  client: PoolClient,
  auth: AuthUser,
  projectId: string,
  input: UpdateProductionProjectInput
): Promise<ProductionProjectMutationResult> {
  return updateProductionProject(client, auth, projectId, input);
}
