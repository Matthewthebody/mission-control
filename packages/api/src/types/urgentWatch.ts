import type {
  OperationalExceptionDetail,
  OperationalExceptionEventRecord,
  OperationalExceptionListItem,
  OperationalExceptionOwnerOption,
  OperationalExceptionWorkspace
} from "./exceptions.js";

// Legacy urgent-watch vocabulary remains as a compatibility alias while
// Exceptions becomes the canonical product term.
export const URGENT_WATCH_SOURCE_MODULES = ["scheduling", "attendance", "production", "approvals", "workflow"] as const;
export type UrgentWatchSourceModule = (typeof URGENT_WATCH_SOURCE_MODULES)[number];

export const URGENT_WATCH_SEVERITIES = ["red", "yellow"] as const;
export type UrgentWatchSeverity = (typeof URGENT_WATCH_SEVERITIES)[number];

export const URGENT_WATCH_STATUSES = ["active", "snoozed", "handled", "resolved"] as const;
export type UrgentWatchStatus = (typeof URGENT_WATCH_STATUSES)[number];

export const URGENT_WATCH_TYPES = [
  "staffing_gap",
  "critical_role_gap",
  "unconfirmed_shoot",
  "missing_contact_info",
  "overdue_production_task",
  "blocked_production_work",
  "pending_peer_review",
  "final_qc_waiting",
  "release_blocker",
  "stale_production_work",
  "production_intake_issue",
  "approval_blocker",
  "missing_acknowledgement",
  "attendance_failure_staffing_risk",
  "replacement_needed",
  "calendar_sync_attention"
] as const;
export type UrgentWatchType = (typeof URGENT_WATCH_TYPES)[number];

export type UrgentWatchCandidate = {
  source_module: UrgentWatchSourceModule;
  source_entity_type: string;
  source_entity_id: string;
  source_entity_label: string | null;
  scope_department: string | null;
  watch_type: UrgentWatchType;
  severity: UrgentWatchSeverity;
  title: string;
  summary: string;
  owner_user_id: string | null;
  owner_label: string | null;
  due_at: string | null;
  next_action_label: string;
  action_hash: string;
  operational_impact_score: number;
  source_snapshot: Record<string, unknown>;
};

export type UrgentWatchOwnerOption = {
  id: string;
  label: string;
  detail: string | null;
};

export type UrgentWatchEventRecord = {
  id: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type UrgentWatchListItem = {
  id: string;
  source_module: UrgentWatchSourceModule;
  source_module_label: string;
  source_entity_type: string;
  source_entity_id: string;
  source_entity_label: string | null;
  scope_department: string | null;
  watch_type: UrgentWatchType;
  watch_type_label: string;
  status: UrgentWatchStatus;
  severity: UrgentWatchSeverity;
  severity_label: string;
  title: string;
  summary: string;
  owner_user_id: string | null;
  owner_label: string | null;
  due_at: string | null;
  due_label: string | null;
  timing_state: "overdue" | "due_within_24h" | "at_risk" | "unscheduled";
  timing_label: string;
  next_action_label: string;
  action_hash: string;
  operational_impact_score: number;
  snoozed_until: string | null;
  status_detail: string | null;
  source_snapshot: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type UrgentWatchDetail = {
  generated_at: string;
  item: UrgentWatchListItem;
  owner_options: UrgentWatchOwnerOption[];
  history: UrgentWatchEventRecord[];
  available_actions: Array<"assign_owner" | "snooze" | "mark_handled">;
};

export type UrgentWatchWorkspace = {
  generated_at: string;
  scope: "all" | "department" | "own";
  summary: {
    active_count: number;
    red_count: number;
    yellow_count: number;
    overdue_count: number;
    snoozed_count: number;
  };
  home_ready_summary: {
    visible: boolean;
    tone: "neutral" | "heads_up" | "action_needed";
    summary_line: string;
    urgent_count: number;
    items: UrgentWatchListItem[];
  };
  owner_options: UrgentWatchOwnerOption[];
  items: UrgentWatchListItem[];
};

export type ExceptionOwnerOption = OperationalExceptionOwnerOption;
export type ExceptionEventRecord = OperationalExceptionEventRecord;
export type ExceptionListItem = OperationalExceptionListItem;
export type ExceptionDetail = OperationalExceptionDetail;
export type ExceptionWorkspace = OperationalExceptionWorkspace;
