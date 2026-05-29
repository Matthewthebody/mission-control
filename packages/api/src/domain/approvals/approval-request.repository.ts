import type { ApprovalRequest } from "./approval-request.js";

export interface ApprovalRequestRepository {
  createApprovalRequest(request: ApprovalRequest): Promise<ApprovalRequest>;
}
