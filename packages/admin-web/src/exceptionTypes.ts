// Canonical operator-facing exception-center contract for admin-web.
// Watch and urgent-watch names survive only as compatibility aliases in
// legacy modules that have not been retired yet.

export type OperationalExceptionSourceModule = "scheduling" | "attendance" | "production" | "approvals" | "workflow";
export type OperationalExceptionSeverity = "warning" | "at_risk" | "blocking";
export type OperationalExceptionStatus = "open" | "snoozed" | "handled" | "resolved";
export type OperationalExceptionCategory =
  | "staffing"
  | "approval"
  | "acknowledgement"
  | "handoff"
  | "sync"
  | "data"
  | "files"
  | "production"
  | "schedule"
  | "delivery";

export type OperationalExceptionOwnerOption = {
  id: string;
  label: string;
  detail: string | null;
};

export type OperationalExceptionEventRecord = {
  id: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type OperationalExceptionListItem = {
  id: string;
  entity_type: string;
  entity_id: string;
  workflow_run_id: string | null;
  category: OperationalExceptionCategory;
  type: string;
  severity: OperationalExceptionSeverity;
  severity_label: string;
  blocking: boolean;
  status: OperationalExceptionStatus;
  owner_user_id: string | null;
  owner_label: string | null;
  assigned_team_id: string | null;
  source_module: OperationalExceptionSourceModule;
  source_module_label: string;
  source_entity_label: string | null;
  scope_department: string | null;
  title: string;
  summary: string;
  due_at: string | null;
  due_label: string | null;
  timing_state: "overdue" | "due_within_24h" | "at_risk" | "unscheduled";
  timing_label: string;
  next_action_label: string;
  action_hash: string;
  operational_impact_score: number;
  snoozed_until: string | null;
  status_detail: string | null;
  resolution_note: string | null;
  source_snapshot: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

export type OperationalExceptionDetail = {
  generated_at: string;
  item: OperationalExceptionListItem;
  owner_options: OperationalExceptionOwnerOption[];
  history: OperationalExceptionEventRecord[];
  available_actions: Array<"assign_owner" | "snooze" | "mark_handled">;
};

export type OperationalExceptionWorkspace = {
  generated_at: string;
  scope: "all" | "department" | "own";
  summary: {
    open_count: number;
    blocking_count: number;
    at_risk_count: number;
    warning_count: number;
    overdue_count: number;
    snoozed_count: number;
  };
  home_ready_summary: {
    visible: boolean;
    tone: "neutral" | "heads_up" | "action_needed";
    summary_line: string;
    urgent_count: number;
    items: OperationalExceptionListItem[];
  };
  owner_options: OperationalExceptionOwnerOption[];
  items: OperationalExceptionListItem[];
};

export type OperationalExceptionActionPayload =
  | {
      action: "assign_owner";
      owner_user_id: string | null;
      note?: string | null;
    }
  | {
      action: "snooze";
      reason: string;
      duration_minutes: number;
      note?: string | null;
    }
  | {
      action: "mark_handled";
      note?: string | null;
    };
