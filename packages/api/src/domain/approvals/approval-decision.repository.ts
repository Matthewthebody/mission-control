import type { ApprovalDecision } from "./approval-decision.js";
import type { ApprovalRequest } from "./approval-request.js";
import type { ApprovalStatus } from "./approval-status.js";

export interface ApprovalDecisionRepository {
  getApprovalRequestById(approvalRequestId: string): Promise<ApprovalRequest | null>;
  listApprovalDecisions(approvalRequestId: string): Promise<ApprovalDecision[]>;
  createApprovalDecision(decision: ApprovalDecision): Promise<ApprovalDecision>;
  updateApprovalRequestStatus(
    approvalRequestId: string,
    status: ApprovalStatus
  ): Promise<ApprovalRequest>;
}
