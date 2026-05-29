import type { PoolClient } from "pg";
import type { AuthUser } from "../../types/auth.js";
import { updateProductionProjectTask, type UpdateProductionProjectTaskInput } from "../../services/productionProjects.js";
import type { ProductionProjectDetail } from "../../types/productionProjects.js";

export async function updateProductionProjectTaskAction(
  client: PoolClient,
  auth: AuthUser,
  projectId: string,
  taskId: string,
  input: UpdateProductionProjectTaskInput
): Promise<ProductionProjectDetail> {
  return updateProductionProjectTask(client, auth, projectId, taskId, input);
}
