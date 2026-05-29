import type { Action } from "../auth/action.js";
import type { Resource } from "../auth/resource.js";
import type { ApprovalExecutionMode } from "./approval-execution-mode.js";
import type { ApprovalStatus } from "./approval-status.js";
import type { ApprovalType } from "./approval-type.js";

export interface ApprovalRequest {
  approvalRequestId: string;
  approvalType: ApprovalType;
  status: ApprovalStatus;
  executionMode: ApprovalExecutionMode;
  policyKey: string;
  tenantId: string;
  requestedByActorId: string;
  requestedAt: string;
  targetResource: Resource;
  targetResourceId: string;
  requestedAction: Action;
  reason: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}
