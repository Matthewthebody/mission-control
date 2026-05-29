import type { ApprovalRequest } from "./approval-request.js";
import type { ApprovalStatus } from "./approval-status.js";

export interface ApprovalExecutionRepository {
  getApprovalRequestById(approvalRequestId: string): Promise<ApprovalRequest | null>;
  updateApprovalRequestStatus(
    approvalRequestId: string,
    status: ApprovalStatus
  ): Promise<ApprovalRequest>;
}
