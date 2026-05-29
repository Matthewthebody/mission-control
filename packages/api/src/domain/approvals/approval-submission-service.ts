import { getApprovalPolicy } from "./approval-policy.registry.js";
import type { ApprovalAuditWriter } from "./approval-audit.js";
import type { ApprovalPolicy } from "./approval-policy.js";
import type { ApprovalRequestRepository } from "./approval-request.repository.js";
import type { ApprovalRequest } from "./approval-request.js";
import type { ApprovalType } from "./approval-type.js";

export const APPROVAL_SUBMISSION_DENIAL_REASON_REGISTRY = ["reason_required"] as const;

export type ApprovalSubmissionDenialReason =
  (typeof APPROVAL_SUBMISSION_DENIAL_REASON_REGISTRY)[number];

export interface SubmitApprovalRequestInput {
  approvalType: ApprovalType;
  tenantId: string;
  requestedByActorId: string;
  targetResourceId: string;
  summary: string;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SubmitApprovalRequestDependencies {
  approvalRequestRepository: ApprovalRequestRepository;
  approvalAuditWriter?: ApprovalAuditWriter;
  createApprovalRequestId?: () => string;
  getCurrentTime?: () => string;
}

export interface ApprovalSubmissionResult {
  submitted: boolean;
  approvalRequest: ApprovalRequest | null;
  policy: ApprovalPolicy;
  denialReason: ApprovalSubmissionDenialReason | null;
}

const APPROVAL_SUBMISSION_DENIAL_REASON_SET = new Set<string>(
  APPROVAL_SUBMISSION_DENIAL_REASON_REGISTRY
);

function defaultCreateApprovalRequestId() {
  return `approval-request-${Date.now()}`;
}

function defaultGetCurrentTime() {
  return new Date().toISOString();
}

function normalizeNullableString(value: string | null | undefined) {
  const normalized = value?.trim() ?? null;
  return normalized ? normalized : null;
}

function normalizeSummary(summary: string) {
  return summary.trim();
}

export function isApprovalSubmissionDenialReason(
  value: string
): value is ApprovalSubmissionDenialReason {
  return APPROVAL_SUBMISSION_DENIAL_REASON_SET.has(value);
}

export async function submitApprovalRequest(
  input: SubmitApprovalRequestInput,
  dependencies: SubmitApprovalRequestDependencies
): Promise<ApprovalSubmissionResult> {
  const policy = getApprovalPolicy(input.approvalType);
  const reason = normalizeNullableString(input.reason);

  if (policy.reasonRequired && !reason) {
    return {
      submitted: false,
      approvalRequest: null,
      policy,
      denialReason: "reason_required"
    };
  }

  const approvalRequest: ApprovalRequest = {
    approvalRequestId:
      dependencies.createApprovalRequestId?.() ?? defaultCreateApprovalRequestId(),
    approvalType: input.approvalType,
    status: "submitted",
    executionMode: policy.executionMode,
    policyKey: policy.policyKey,
    tenantId: input.tenantId,
    requestedByActorId: input.requestedByActorId,
    requestedAt: dependencies.getCurrentTime?.() ?? defaultGetCurrentTime(),
    targetResource: policy.targetResource,
    targetResourceId: input.targetResourceId,
    requestedAction: policy.requestedAction,
    reason,
    summary: normalizeSummary(input.summary),
    metadata: input.metadata
  };

  const persistedApprovalRequest =
    await dependencies.approvalRequestRepository.createApprovalRequest(approvalRequest);

  if (policy.requiresAudit && dependencies.approvalAuditWriter) {
    await dependencies.approvalAuditWriter.writeApprovalAuditEvent({
      eventType: "approval_request_submitted",
      approvalRequestId: persistedApprovalRequest.approvalRequestId,
      tenantId: persistedApprovalRequest.tenantId,
      approvalType: persistedApprovalRequest.approvalType,
      policyKey: persistedApprovalRequest.policyKey,
      actorId: persistedApprovalRequest.requestedByActorId,
      occurredAt: persistedApprovalRequest.requestedAt,
      fromStatus: null,
      toStatus: persistedApprovalRequest.status,
      targetResource: persistedApprovalRequest.targetResource,
      targetResourceId: persistedApprovalRequest.targetResourceId,
      requestedAction: persistedApprovalRequest.requestedAction,
      metadata: persistedApprovalRequest.metadata
    });
  }

  return {
    submitted: true,
    approvalRequest: persistedApprovalRequest,
    policy,
    denialReason: null
  };
}
