export type OperationalActionTone = "neutral" | "info" | "success" | "warning" | "critical";

export type ManagerCockpitQueueId =
  | "needs_staffing"
  | "needs_contact_cleanup"
  | "needs_approval"
  | "needs_follow_up"
  | "needs_project_setup"
  | "needs_project_follow_up"
  | "overdue_project_tasks"
  | "needs_payroll_compliance_review";

export type ManagerCockpitEntityKind =
  | "shoot"
  | "organization"
  | "contact"
  | "location"
  | "approval_request"
  | "project"
  | "employee"
  | "compliance_review"
  | "payroll_review";

export interface ManagerCockpitFlag {
  label: string;
  tone: OperationalActionTone;
}

export interface ManagerCockpitQueueItem {
  id: string;
  entity_kind: ManagerCockpitEntityKind;
  entity_id: string | null;
  organization_id: string | null;
  shoot_id: string | null;
  title: string;
  summary: string;
  owner_label: string;
  due_label: string | null;
  status_label: string;
  status_tone: OperationalActionTone;
  next_action: string;
  action_hash: string;
  flags: ManagerCockpitFlag[];
}

export interface ManagerCockpitQueue {
  id: ManagerCockpitQueueId;
  label: string;
  summary: string;
  count: number;
  items: ManagerCockpitQueueItem[];
}

export interface ManagerCockpitResponse {
  generated_at: string;
  anchor_date: string;
  headline: string;
  summary: {
    total_open: number;
    needs_staffing: number;
    needs_contact_cleanup: number;
    needs_approval: number;
    needs_follow_up: number;
    needs_project_setup: number;
    needs_project_follow_up: number;
    overdue_project_tasks: number;
    needs_payroll_compliance_review: number;
  };
  queues: ManagerCockpitQueue[];
}
