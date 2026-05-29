import type { Action } from "../auth/action.js";
import type { Resource } from "../auth/resource.js";
import type { ApprovalDecisionOutcome } from "./approval-decision.js";
import type { ApprovalExecutionOutcome } from "./approval-execution.js";
import type { ApprovalStatus } from "./approval-status.js";
import type { ApprovalType } from "./approval-type.js";

export const APPROVAL_AUDIT_EVENT_TYPE_REGISTRY = [
  "approval_request_submitted",
  "approval_decision_recorded",
  "approval_action_executed"
] as const;

export type ApprovalAuditEventType = (typeof APPROVAL_AUDIT_EVENT_TYPE_REGISTRY)[number];

export interface ApprovalAuditEvent {
  eventType: ApprovalAuditEventType;
  approvalRequestId: string;
  tenantId: string;
  approvalType: ApprovalType;
  policyKey: string;
  actorId: string | null;
  occurredAt: string;
  fromStatus: ApprovalStatus | null;
  toStatus: ApprovalStatus;
  targetResource: Resource;
  targetResourceId: string;
  requestedAction: Action;
  decisionOutcome?: ApprovalDecisionOutcome | null;
  executionOutcome?: ApprovalExecutionOutcome | null;
  executionCode?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ApprovalAuditWriter {
  writeApprovalAuditEvent(event: ApprovalAuditEvent): Promise<void> | void;
}

const APPROVAL_AUDIT_EVENT_TYPE_SET = new Set<string>(APPROVAL_AUDIT_EVENT_TYPE_REGISTRY);

export function isApprovalAuditEventType(value: string): value is ApprovalAuditEventType {
  return APPROVAL_AUDIT_EVENT_TYPE_SET.has(value);
}
