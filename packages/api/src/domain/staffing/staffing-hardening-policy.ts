import type { StaffingCapability } from "./staffing-capability.js";
import type { StaffingPublicationState } from "./staffing-publication-state.js";
import type { ProtectedStaffingWindowLevel } from "./protected-staffing-window-policy.js";

export const STAFFING_HARDENING_ACTION_KIND_REGISTRY = [
  "change_staffing_assignment",
  "remove_staffing_assignment",
  "publish_staffing",
  "unpublish_staffing"
] as const;

export type StaffingHardeningActionKind = (typeof STAFFING_HARDENING_ACTION_KIND_REGISTRY)[number];

export const STAFFING_HARDENING_RULE_OUTCOME_REGISTRY = [
  "warning",
  "override_required",
  "block"
] as const;

export type StaffingHardeningRuleOutcome =
  (typeof STAFFING_HARDENING_RULE_OUTCOME_REGISTRY)[number];

export const STAFFING_HARDENING_RULE_CODE_REGISTRY = [
  "published_change_inside_protected_window",
  "published_change_reduces_staffing_inside_locked_window",
  "published_change_reduces_lead_coverage_inside_locked_window",
  "publish_with_risk_inside_protected_window",
  "unpublish_inside_protected_window",
  "unpublish_inside_locked_window"
] as const;

export type StaffingHardeningRuleCode = (typeof STAFFING_HARDENING_RULE_CODE_REGISTRY)[number];

export interface StaffingHardeningPolicyRule {
  ruleCode: StaffingHardeningRuleCode;
  actionKinds: StaffingHardeningActionKind[];
  appliesToPublicationStates: StaffingPublicationState[];
  windowLevels: ProtectedStaffingWindowLevel[];
  outcome: StaffingHardeningRuleOutcome;
  requiredCapabilities: StaffingCapability[];
  message: string;
}

export const STAFFING_HARDENING_POLICY_REGISTRY: Readonly<
  Record<StaffingHardeningRuleCode, StaffingHardeningPolicyRule>
> = {
  published_change_inside_protected_window: {
    ruleCode: "published_change_inside_protected_window",
    actionKinds: ["change_staffing_assignment", "remove_staffing_assignment"],
    appliesToPublicationStates: ["published"],
    windowLevels: ["protected", "locked"],
    outcome: "override_required",
    requiredCapabilities: ["override_staffing_warnings"],
    message:
      "Changing already-published staffing inside the protected window requires an explicit override."
  },
  published_change_reduces_staffing_inside_locked_window: {
    ruleCode: "published_change_reduces_staffing_inside_locked_window",
    actionKinds: ["change_staffing_assignment", "remove_staffing_assignment"],
    appliesToPublicationStates: ["published"],
    windowLevels: ["locked"],
    outcome: "block",
    requiredCapabilities: [],
    message: "Reducing published staffing inside the locked window is blocked."
  },
  published_change_reduces_lead_coverage_inside_locked_window: {
    ruleCode: "published_change_reduces_lead_coverage_inside_locked_window",
    actionKinds: ["change_staffing_assignment", "remove_staffing_assignment"],
    appliesToPublicationStates: ["published"],
    windowLevels: ["locked"],
    outcome: "block",
    requiredCapabilities: [],
    message: "Reducing lead coverage inside the locked window is blocked."
  },
  publish_with_risk_inside_protected_window: {
    ruleCode: "publish_with_risk_inside_protected_window",
    actionKinds: ["publish_staffing"],
    appliesToPublicationStates: ["draft", "ready_to_publish"],
    windowLevels: ["protected", "locked"],
    outcome: "override_required",
    requiredCapabilities: ["override_staffing_warnings"],
    message:
      "Publishing a staffing plan with unresolved risk inside the protected window requires an explicit override."
  },
  unpublish_inside_protected_window: {
    ruleCode: "unpublish_inside_protected_window",
    actionKinds: ["unpublish_staffing"],
    appliesToPublicationStates: ["published"],
    windowLevels: ["protected", "locked"],
    outcome: "override_required",
    requiredCapabilities: ["override_staffing_warnings"],
    message: "Unpublishing staffing inside the protected window requires an explicit override."
  },
  unpublish_inside_locked_window: {
    ruleCode: "unpublish_inside_locked_window",
    actionKinds: ["unpublish_staffing"],
    appliesToPublicationStates: ["published"],
    windowLevels: ["locked"],
    outcome: "block",
    requiredCapabilities: [],
    message: "Unpublishing staffing inside the locked window is blocked."
  }
} as const;

const STAFFING_HARDENING_ACTION_KIND_SET = new Set<string>(STAFFING_HARDENING_ACTION_KIND_REGISTRY);
const STAFFING_HARDENING_RULE_OUTCOME_SET = new Set<string>(STAFFING_HARDENING_RULE_OUTCOME_REGISTRY);
const STAFFING_HARDENING_RULE_CODE_SET = new Set<string>(STAFFING_HARDENING_RULE_CODE_REGISTRY);

export function isStaffingHardeningActionKind(value: string): value is StaffingHardeningActionKind {
  return STAFFING_HARDENING_ACTION_KIND_SET.has(value);
}

export function isStaffingHardeningRuleOutcome(value: string): value is StaffingHardeningRuleOutcome {
  return STAFFING_HARDENING_RULE_OUTCOME_SET.has(value);
}

export function isStaffingHardeningRuleCode(value: string): value is StaffingHardeningRuleCode {
  return STAFFING_HARDENING_RULE_CODE_SET.has(value);
}

export function getStaffingHardeningPolicyRule(
  ruleCode: StaffingHardeningRuleCode
): StaffingHardeningPolicyRule {
  return STAFFING_HARDENING_POLICY_REGISTRY[ruleCode];
}

export function getStaffingHardeningPolicyRulesForAction(
  actionKind: StaffingHardeningActionKind
): StaffingHardeningPolicyRule[] {
  return Object.values(STAFFING_HARDENING_POLICY_REGISTRY).filter((rule) =>
    rule.actionKinds.includes(actionKind)
  );
}
