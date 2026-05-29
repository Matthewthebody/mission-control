export const APPROVAL_EXECUTION_MODE_REGISTRY = [
  "automatic_on_approval",
  "manual_after_approval",
  "record_only"
] as const;

export type ApprovalExecutionMode = (typeof APPROVAL_EXECUTION_MODE_REGISTRY)[number];

const APPROVAL_EXECUTION_MODE_SET = new Set<string>(APPROVAL_EXECUTION_MODE_REGISTRY);

export function isApprovalExecutionMode(value: string): value is ApprovalExecutionMode {
  return APPROVAL_EXECUTION_MODE_SET.has(value);
}
