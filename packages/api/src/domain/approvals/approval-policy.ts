import type { Action } from "../auth/action.js";
import type { Resource } from "../auth/resource.js";
import type { Role } from "../auth/role.js";
import type { ApprovalExecutionMode } from "./approval-execution-mode.js";
import type { ApprovalType } from "./approval-type.js";

export interface ApprovalPolicy {
  policyKey: string;
  approvalType: ApprovalType;
  requestedAction: Action;
  targetResource: Resource;
  executionMode: ApprovalExecutionMode;
  requiredApproverRoles: Role[];
  minimumApproverCount: number;
  requiresSecondApproval: boolean;
  requiresAudit: boolean;
  allowSelfApproval: boolean;
  reasonRequired: boolean;
  description: string;
}
