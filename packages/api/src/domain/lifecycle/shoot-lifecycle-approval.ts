export interface ShootLifecycleApprovalContext {
  approvalSatisfied: boolean;
  approvalRequestId?: string | null;
}

export interface ShootLifecycleApprovalRequirement {
  required: boolean;
  satisfied: boolean;
  approvalRequestId: string | null;
  transitionKey: string | null;
}
