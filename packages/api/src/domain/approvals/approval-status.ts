export const APPROVAL_STATUS_REGISTRY = [
  "submitted",
  "under_review",
  "approved",
  "denied",
  "returned",
  "cancelled",
  "executed"
] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUS_REGISTRY)[number];

const APPROVAL_STATUS_SET = new Set<string>(APPROVAL_STATUS_REGISTRY);

export function isApprovalStatus(value: string): value is ApprovalStatus {
  return APPROVAL_STATUS_SET.has(value);
}
