import type { PoolClient } from "pg";
import type { AuthUser } from "../../types/auth.js";
import { listProductionProjects } from "../../services/productionProjects.js";
import { inspectProductionIntake } from "../../services/productionIntake.js";
import type {
  ProductionLeadBoardFocus,
  ProductionLeadBoardSort,
  ProductionProjectBoardResponse,
  ProductionProjectCategory,
  ProductionProjectDueState,
  ProductionProjectJobType,
  ProductionProjectPriority,
  ProductionProjectQueueId,
  ProductionProjectStage,
  ProductionProjectTeamOwner
} from "../../types/productionProjects.js";

export async function loadProductionProjectBoard(
  client: PoolClient,
  auth: AuthUser,
  options: {
    anchorDate: string;
    workspaceView?: "lead_board" | "staff_workspace" | null;
    status?: "open" | "completed" | "all";
    queue?: ProductionProjectQueueId | "all";
    search?: string | null;
    ownerUserId?: string | "unassigned" | null;
    priority?: ProductionProjectPriority | null;
    templateId?: string | null;
    sourceType?: "manual" | "trigger" | null;
    sourceTriggerKey?: string | null;
    category?: ProductionProjectCategory | null;
    jobType?: ProductionProjectJobType | null;
    stage?: ProductionProjectStage | null;
    teamOwner?: ProductionProjectTeamOwner | null;
    linkedOrganizationId?: string | null;
    linkedLocationId?: string | null;
    linkedShootId?: string | null;
    dueState?: ProductionProjectDueState | null;
    bigCriticalOnly?: boolean;
    leadBoardSort?: ProductionLeadBoardSort;
    leadBoardFocus?: ProductionLeadBoardFocus;
  }
): Promise<ProductionProjectBoardResponse> {
  const intake = await inspectProductionIntake(client, auth, {
    anchorDate: options.anchorDate
  });
  return listProductionProjects(client, auth, options, intake);
}
