import type { StaffingActionEvaluationResult, StaffingOverrideRequirement } from "./staffing-action-evaluation.js";
import type { StaffingAssignment } from "./staffing-assignment.js";
import type {
  InternalStaffingDto,
  PublishedStaffingDto
} from "./staffing-publication-dto.js";
import type { StaffingPublicationState } from "./staffing-publication-state.js";
import type { StaffingRequirement } from "./staffing-requirement.js";
import type { StaffingValidationResult } from "./staffing-validation.js";

export const STAFFING_PUBLICATION_ACTION_REGISTRY = ["publish", "unpublish"] as const;

export type StaffingPublicationAction = (typeof STAFFING_PUBLICATION_ACTION_REGISTRY)[number];

export const STAFFING_PUBLICATION_DENIAL_REASON_REGISTRY = [
  "already_in_target_state",
  "override_required",
  "blocked_by_validation_hook"
] as const;

export type StaffingPublicationDenialReason =
  (typeof STAFFING_PUBLICATION_DENIAL_REASON_REGISTRY)[number];

export const STAFFING_PUBLICATION_VALIDATION_HOOK_OUTCOME_REGISTRY = [
  "pass",
  "warning",
  "block"
] as const;

export type StaffingPublicationValidationHookOutcome =
  (typeof STAFFING_PUBLICATION_VALIDATION_HOOK_OUTCOME_REGISTRY)[number];

export interface StaffingPublicationRequest {
  publicationAction: StaffingPublicationAction;
  requirement: StaffingRequirement;
  assignments: StaffingAssignment[];
  currentPublicationState: StaffingPublicationState;
  actionEvaluation?: StaffingActionEvaluationResult | null;
  staffingValidation?: StaffingValidationResult | null;
  shootStartsAt?: string | Date | null;
  evaluationTime?: string | Date | null;
  overrideAcknowledged?: boolean;
  overrideReason?: string | null;
}

export interface StaffingPublicationValidationHookContext {
  request: StaffingPublicationRequest;
  targetPublicationState: StaffingPublicationState;
  actionEvaluation: StaffingActionEvaluationResult | null;
}

export interface StaffingPublicationValidationHookResult {
  hookKey: string;
  outcome: StaffingPublicationValidationHookOutcome;
  message: string | null;
  metadata?: Record<string, unknown>;
}

export interface StaffingPublicationValidationHook {
  hookKey: string;
  evaluate(context: StaffingPublicationValidationHookContext): StaffingPublicationValidationHookResult;
}

export type StaffingPublicationValidationHookRegistry = Readonly<
  Record<string, StaffingPublicationValidationHook>
>;

export interface StaffingPublicationResult {
  allowed: boolean;
  publicationAction: StaffingPublicationAction;
  currentPublicationState: StaffingPublicationState;
  targetPublicationState: StaffingPublicationState;
  denialReason: StaffingPublicationDenialReason | null;
  publicationStateChanged: boolean;
  employeeVisibleScheduleReleased: boolean;
  overrideRequired: boolean;
  overrideRequirement: StaffingOverrideRequirement | null;
  validationHookResults: StaffingPublicationValidationHookResult[];
  blockingHookResults: StaffingPublicationValidationHookResult[];
  warningHookResults: StaffingPublicationValidationHookResult[];
  internalStaffing: InternalStaffingDto;
  publishedStaffing: PublishedStaffingDto | null;
}

const STAFFING_PUBLICATION_ACTION_SET = new Set<string>(STAFFING_PUBLICATION_ACTION_REGISTRY);
const STAFFING_PUBLICATION_DENIAL_REASON_SET = new Set<string>(STAFFING_PUBLICATION_DENIAL_REASON_REGISTRY);
const STAFFING_PUBLICATION_VALIDATION_HOOK_OUTCOME_SET = new Set<string>(
  STAFFING_PUBLICATION_VALIDATION_HOOK_OUTCOME_REGISTRY
);

export function isStaffingPublicationAction(value: string): value is StaffingPublicationAction {
  return STAFFING_PUBLICATION_ACTION_SET.has(value);
}

export function isStaffingPublicationDenialReason(value: string): value is StaffingPublicationDenialReason {
  return STAFFING_PUBLICATION_DENIAL_REASON_SET.has(value);
}

export function isStaffingPublicationValidationHookOutcome(
  value: string
): value is StaffingPublicationValidationHookOutcome {
  return STAFFING_PUBLICATION_VALIDATION_HOOK_OUTCOME_SET.has(value);
}
