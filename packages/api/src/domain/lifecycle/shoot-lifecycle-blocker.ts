import type { Role } from "../auth/role.js";
import type { ShootLifecycleTransitionDefinition } from "./shoot-lifecycle-transition.js";
import type { ShootStatus } from "./shoot-status.js";

export const SHOOT_LIFECYCLE_BLOCKER_OUTCOME_REGISTRY = ["clear", "warning", "hard_blocker"] as const;

export type ShootLifecycleBlockerOutcome = (typeof SHOOT_LIFECYCLE_BLOCKER_OUTCOME_REGISTRY)[number];

export interface ShootLifecycleTransitionContext {
  shootId?: string | null;
  tenantId?: string | null;
  currentStatus: ShootStatus;
  targetStatus: ShootStatus;
  actorRoles: Role[];
  reason?: string | null;
  transition: ShootLifecycleTransitionDefinition;
  metadata?: Record<string, unknown>;
}

export interface ShootLifecycleBlockerEvaluation {
  evaluatorKey: string;
  outcome: ShootLifecycleBlockerOutcome;
  blockerCode: string | null;
  message: string | null;
  metadata?: Record<string, unknown>;
}

export interface ShootLifecycleBlockerEvaluator {
  evaluatorKey: string;
  evaluate(context: ShootLifecycleTransitionContext): ShootLifecycleBlockerEvaluation;
}

export type ShootLifecycleBlockerEvaluatorRegistry = Readonly<Record<string, ShootLifecycleBlockerEvaluator>>;
