import type { ApprovalExecutionMode } from "./approval-execution-mode.js";
import type { ApprovalPolicy } from "./approval-policy.js";
import type { ApprovalType } from "./approval-type.js";
import type { Role } from "../auth/role.js";

const STAFFING_APPROVER_ROLES: Role[] = ["super_admin", "leadership", "director_admin"];
const READINESS_APPROVER_ROLES: Role[] = ["super_admin", "leadership", "director_admin"];
const LIFECYCLE_APPROVER_ROLES: Role[] = ["super_admin", "leadership", "director_admin"];

export const APPROVAL_POLICIES: ApprovalPolicy[] = [
  {
    policyKey: "staffing-conflict-override",
    approvalType: "staffing_conflict_override",
    requestedAction: "override",
    targetResource: "staff_assignment",
    executionMode: "manual_after_approval",
    requiredApproverRoles: STAFFING_APPROVER_ROLES,
    minimumApproverCount: 1,
    requiresSecondApproval: false,
    requiresAudit: true,
    allowSelfApproval: false,
    reasonRequired: true,
    description: "A staffing conflict override requires an operator approval before a soft conflict can be forced through."
  },
  {
    policyKey: "staffing-publication-override",
    approvalType: "staffing_publication_override",
    requestedAction: "publish",
    targetResource: "staffing_board",
    executionMode: "manual_after_approval",
    requiredApproverRoles: STAFFING_APPROVER_ROLES,
    minimumApproverCount: 1,
    requiresSecondApproval: false,
    requiresAudit: true,
    allowSelfApproval: false,
    reasonRequired: true,
    description: "Publishing staffing with override conditions requires an explicit approval and audit trail."
  },
  {
    policyKey: "staffing-protected-window-change",
    approvalType: "staffing_protected_window_change",
    requestedAction: "override",
    targetResource: "staffing_board",
    executionMode: "manual_after_approval",
    requiredApproverRoles: STAFFING_APPROVER_ROLES,
    minimumApproverCount: 2,
    requiresSecondApproval: true,
    requiresAudit: true,
    allowSelfApproval: false,
    reasonRequired: true,
    description: "Protected staffing window changes require dual approval because they modify late-stage staffing truth."
  },
  {
    policyKey: "readiness-override",
    approvalType: "readiness_override",
    requestedAction: "override",
    targetResource: "readiness_summary",
    executionMode: "manual_after_approval",
    requiredApproverRoles: READINESS_APPROVER_ROLES,
    minimumApproverCount: 1,
    requiresSecondApproval: false,
    requiresAudit: true,
    allowSelfApproval: false,
    reasonRequired: true,
    description: "Readiness override approvals allow a blocked readiness rule to be bypassed under operator control."
  },
  {
    policyKey: "go-no-go-override",
    approvalType: "go_no_go_override",
    requestedAction: "override",
    targetResource: "readiness_summary",
    executionMode: "manual_after_approval",
    requiredApproverRoles: READINESS_APPROVER_ROLES,
    minimumApproverCount: 2,
    requiresSecondApproval: true,
    requiresAudit: true,
    allowSelfApproval: false,
    reasonRequired: true,
    description: "Go/No-Go overrides require dual approval because they directly affect day-of execution risk."
  },
  {
    policyKey: "lifecycle-rollback-transition",
    approvalType: "lifecycle_rollback_transition",
    requestedAction: "transition",
    targetResource: "shoot_lifecycle",
    executionMode: "automatic_on_approval",
    requiredApproverRoles: LIFECYCLE_APPROVER_ROLES,
    minimumApproverCount: 2,
    requiresSecondApproval: true,
    requiresAudit: true,
    allowSelfApproval: false,
    reasonRequired: true,
    description: "Lifecycle rollback transitions require dual approval before the rollback can execute automatically."
  },
  {
    policyKey: "lifecycle-reopen-transition",
    approvalType: "lifecycle_reopen_transition",
    requestedAction: "transition",
    targetResource: "shoot_lifecycle",
    executionMode: "automatic_on_approval",
    requiredApproverRoles: LIFECYCLE_APPROVER_ROLES,
    minimumApproverCount: 2,
    requiresSecondApproval: true,
    requiresAudit: true,
    allowSelfApproval: false,
    reasonRequired: true,
    description: "Lifecycle reopen transitions require dual approval before the reopen can execute automatically."
  }
];

const APPROVAL_POLICY_BY_TYPE = new Map<ApprovalType, ApprovalPolicy>(
  APPROVAL_POLICIES.map((policy) => [policy.approvalType, policy])
);

const APPROVAL_POLICY_BY_KEY = new Map<string, ApprovalPolicy>(
  APPROVAL_POLICIES.map((policy) => [policy.policyKey, policy])
);

function buildDefaultApprovalPolicy(approvalType: ApprovalType): ApprovalPolicy {
  return {
    policyKey: `unconfigured-${approvalType}`,
    approvalType,
    requestedAction: "approve",
    targetResource: "approval_request",
    executionMode: "record_only",
    requiredApproverRoles: [],
    minimumApproverCount: 1,
    requiresSecondApproval: false,
    requiresAudit: true,
    allowSelfApproval: false,
    reasonRequired: true,
    description: "No explicit approval policy has been registered for this approval type."
  };
}

export function listApprovalPolicies(): ApprovalPolicy[] {
  return [...APPROVAL_POLICIES];
}

export function getApprovalPolicy(approvalType: ApprovalType): ApprovalPolicy {
  return APPROVAL_POLICY_BY_TYPE.get(approvalType) ?? buildDefaultApprovalPolicy(approvalType);
}

export function getApprovalPolicyByKey(policyKey: string): ApprovalPolicy | null {
  return APPROVAL_POLICY_BY_KEY.get(policyKey) ?? null;
}

export function getAllowedApproverRoles(approvalType: ApprovalType): Role[] {
  return getApprovalPolicy(approvalType).requiredApproverRoles;
}

export function approvalTypeRequiresSecondApproval(approvalType: ApprovalType): boolean {
  return getApprovalPolicy(approvalType).requiresSecondApproval;
}

export function approvalTypeRequiresAudit(approvalType: ApprovalType): boolean {
  return getApprovalPolicy(approvalType).requiresAudit;
}

export function getApprovalExecutionMode(approvalType: ApprovalType): ApprovalExecutionMode {
  return getApprovalPolicy(approvalType).executionMode;
}

export function getRequiredApproverCount(approvalType: ApprovalType): number {
  return getApprovalPolicy(approvalType).minimumApproverCount;
}
