export type OperationalApprovalRequestType =
  | "staffing_exception_approval"
  | "schedule_change_approval"
  | "role_override_approval"
  | "overtime_labor_exception_approval"
  | "rush_order_approval"
  | "fee_refund_approval"
  | "due_date_extension_approval"
  | "deadline_override_approval"
  | "peer_review_exception_approval"
  | "qc_exception_approval"
  | "release_override_approval"
  | "rework_waiver_approval"
  | "cancellation_approval"
  | "policy_exception_approval";

export type OperationalApprovalSourceEntityType = "job" | "production_item";

export type OperationalApprovalStatus =
  | "pending"
  | "needs_clarification"
  | "approved"
  | "rejected"
  | "canceled";

export type OperationalApprovalStepStatus =
  | "queued"
  | "pending"
  | "approved"
  | "rejected"
  | "sent_back"
  | "delegated"
  | "canceled";

export type OperationalApprovalRoleGroup =
  | "leadership"
  | "operations_lead"
  | "department_manager"
  | "scheduling_lead"
  | "production_manager";

export type OperationalApprovalDecisionAction =
  | "approve"
  | "reject"
  | "send_back"
  | "cancel"
  | "resubmit"
  | "delegate";

export interface OperationalApprovalRequestSummary {
  id: string;
  request_type: OperationalApprovalRequestType;
  request_type_label: string;
  status: OperationalApprovalStatus;
  status_label: string;
  source_module: string;
  source_entity_type: string;
  source_entity_id: string;
  source_entity_label: string | null;
  requested_action_code: string;
  request_title: string;
  request_summary: string | null;
  reason: string;
  severity: string;
  blocking: boolean;
  requester_department: string | null;
  requested_by_user_id: string;
  requested_by_name: string | null;
  approval_chain: OperationalApprovalRoleGroup[];
  current_approver_user_id: string | null;
  current_approver_name: string | null;
  current_approver_role_group: OperationalApprovalRoleGroup | null;
  current_approver_role_group_label: string | null;
  sla_due_at: string | null;
  overdue: boolean;
  escalated: boolean;
  escalation_level: number;
  decided_at: string | null;
  executed_at: string | null;
  created_at: string;
  updated_at: string;
  can_decide: boolean;
  can_cancel: boolean;
  can_resubmit: boolean;
  can_delegate: boolean;
}

export interface OperationalApprovalStepRecord {
  id: string;
  step_order: number;
  approver_role_group: OperationalApprovalRoleGroup;
  approver_role_group_label: string;
  approver_department: string | null;
  approver_user_id: string | null;
  approver_name: string | null;
  status: OperationalApprovalStepStatus;
  status_label: string;
  acted_by_user_id: string | null;
  acted_by_name: string | null;
  delegated_from_user_id: string | null;
  delegated_from_name: string | null;
  note: string | null;
  due_at: string | null;
  acted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OperationalApprovalEventRecord {
  id: string;
  approval_step_id: string | null;
  event_type: string;
  event_type_label: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface OperationalApprovalCandidateApprover {
  id: string;
  label: string;
  detail: string | null;
}

export interface OperationalApprovalDetail {
  request: OperationalApprovalRequestSummary;
  steps: OperationalApprovalStepRecord[];
  events: OperationalApprovalEventRecord[];
  candidate_approvers: OperationalApprovalCandidateApprover[];
  current_state: Record<string, unknown>;
  requested_state: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface OperationalApprovalWorkspace {
  generated_at: string;
  summary: {
    awaiting_my_decision: number;
    submitted_by_me: number;
    overdue: number;
    escalated: number;
    pending_blocking: number;
    needs_clarification: number;
  };
  awaiting_my_decision: OperationalApprovalRequestSummary[];
  submitted_by_me: OperationalApprovalRequestSummary[];
  overdue: OperationalApprovalRequestSummary[];
  escalated: OperationalApprovalRequestSummary[];
}

export interface OperationalApprovalSourceSummary {
  source_module: string;
  source_entity_type: string;
  source_entity_id: string;
  open_count: number;
  blocking_open_count: number;
  overdue_count: number;
  escalated_count: number;
  items: OperationalApprovalRequestSummary[];
}

export interface OperationalApprovalDecisionPayload {
  action: OperationalApprovalDecisionAction;
  note?: string | null;
  delegate_to_user_id?: string | null;
}

export interface CreateOperationalApprovalRequestInput {
  request_type: OperationalApprovalRequestType;
  source_module: string;
  source_entity_type: OperationalApprovalSourceEntityType;
  source_entity_id: string;
  requested_action_code: string;
  request_title: string;
  request_summary?: string | null;
  reason: string;
  severity?: string | null;
  blocking?: boolean | null;
  current_state?: Record<string, unknown>;
  requested_state?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  dedupe_key?: string | null;
}

export interface OperationalApprovalBlockingResult {
  approval_required: true;
  approval_request: OperationalApprovalRequestSummary;
}

export interface OperationalApprovalExecuteResult {
  approval_required: false;
  consumed_approval_request_id?: string | null;
}
