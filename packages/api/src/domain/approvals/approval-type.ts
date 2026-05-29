export const APPROVAL_TYPE_REGISTRY = [
  "staffing_conflict_override",
  "staffing_publication_override",
  "staffing_protected_window_change",
  "readiness_override",
  "go_no_go_override",
  "lifecycle_rollback_transition",
  "lifecycle_reopen_transition"
] as const;

export type ApprovalType = (typeof APPROVAL_TYPE_REGISTRY)[number];

const APPROVAL_TYPE_SET = new Set<string>(APPROVAL_TYPE_REGISTRY);

export function isApprovalType(value: string): value is ApprovalType {
  return APPROVAL_TYPE_SET.has(value);
}
