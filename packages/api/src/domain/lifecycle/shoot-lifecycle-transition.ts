import type { ShootLifecycleApprovalRequirement } from "./shoot-lifecycle-approval.js";
import type { Role } from "../auth/role.js";
import type { ShootLifecycleBlockerEvaluation } from "./shoot-lifecycle-blocker.js";
import type { ShootLifecycleAutomationPolicyKey } from "./shoot-lifecycle-automation-policy.js";
import type { ShootLifecycleTransitionControlClass } from "./shoot-lifecycle-control.js";
import type { ShootStatus } from "./shoot-status.js";

export const SHOOT_LIFECYCLE_TRANSITION_DENIAL_REASON_REGISTRY = [
  "transition_not_found",
  "terminal_status_locked",
  "actor_not_allowed",
  "reason_required",
  "approval_required",
  "blocked_by_evaluator"
] as const;

export type ShootLifecycleTransitionDenialReason =
  (typeof SHOOT_LIFECYCLE_TRANSITION_DENIAL_REASON_REGISTRY)[number];

export interface ShootLifecycleTransitionDefinition {
  transitionKey: string;
  transitionDirection: "forward" | "rollback" | "reopen";
  controlClass: ShootLifecycleTransitionControlClass;
  fromStatus: ShootStatus;
  toStatus: ShootStatus;
  allowedRoles: Role[];
  reasonRequired: boolean;
  automationPolicyKey?: ShootLifecycleAutomationPolicyKey | null;
}

export interface ShootLifecycleTransitionRequest {
  currentStatus: ShootStatus;
  targetStatus: ShootStatus;
  actorRoles: Role[];
  reason?: string | null;
}

export interface ShootLifecycleTransitionResult {
  allowed: boolean;
  currentStatus: ShootStatus;
  targetStatus: ShootStatus;
  denialReason: ShootLifecycleTransitionDenialReason | null;
  matchedTransition: ShootLifecycleTransitionDefinition | null;
  allowedRoles: Role[];
  reasonRequired: boolean;
  blockerEvaluations: ShootLifecycleBlockerEvaluation[];
  hardBlockers: ShootLifecycleBlockerEvaluation[];
  warnings: ShootLifecycleBlockerEvaluation[];
  approvalRequirement: ShootLifecycleApprovalRequirement | null;
  dangerousTransition: boolean;
}
