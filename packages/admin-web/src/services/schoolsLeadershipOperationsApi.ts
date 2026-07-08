import { apiFetch } from "../api";

// Phase 6A — client for the canonical Schools Leadership & CSR operating read model
// (GET /api/schools/leadership/operations). React never re-totals: every available category's
// `count` is materialized on the server and equals its `issues.length` (displayed === filtered).
// Unavailable categories carry `count: null` + a `reason` and must render as an honest disabled
// state — never a fabricated zero, never an enabled dead action.

export type LeadershipTimeState = "today" | "this_week" | "next_week" | "overdue" | "future" | "none";
export type LeadershipSection = "current_season" | "building_next_season";
export type LeadershipSeverity = "info" | "warning" | "critical";

export type LeadershipIssue = {
  issue_id: string;
  section: LeadershipSection;
  category: string;
  source_type: string;
  source_id: string;
  district_id: string | null;
  district_name: string | null;
  school_id: string | null;
  school_name: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  internal_owner: string | null;
  reason: string;
  severity: LeadershipSeverity;
  status: string;
  date_deadline: string | null;
  time_state: LeadershipTimeState;
  exact_destination_hash: string;
  focus_reason: string;
  can_act: boolean;
  primary_action: string | null;
  source_availability: "live" | "derived";
  provenance: string;
};

export type LeadershipCategory =
  | { category: string; section: LeadershipSection; available: true; count: number; issues: LeadershipIssue[] }
  | { category: string; section: LeadershipSection; available: false; count: null; reason: string };

export type SchoolsLeadershipOperations = {
  generated_at: string;
  scope: "all" | "own";
  sections: {
    current_season: LeadershipCategory[];
    building_next_season: LeadershipCategory[];
  };
};

export async function getSchoolsLeadershipOperations(token: string) {
  return apiFetch<SchoolsLeadershipOperations>("/api/schools/leadership/operations", token);
}

// Human labels for each read-model category key. Keys with no entry fall back to the raw key.
export const LEADERSHIP_CATEGORY_LABELS: Record<string, string> = {
  shoots_today: "Shoots today",
  shoots_this_week: "Shoots this week",
  shoots_next_week: "Shoots next week",
  missing_current_service_term: "Missing current service term",
  service_term_confirmation_exceptions: "Service term to confirm",
  missing_approved_location: "Missing approved location",
  workflow_blockers: "Workflow blockers",
  schedule_change_requests: "Schedule-change requests",
  declined_replacement_staffing: "Declined / replacement staffing",
  unresolved_client_communication_cases: "Client communication cases",
  next_season_ownership_gap: "Ownership gap",
  next_service_term_awaiting_confirmation: "Next-season term to confirm",
  rebooking_state: "Rebooking state"
};

export const LEADERSHIP_SECTION_LABELS: Record<LeadershipSection, string> = {
  current_season: "Current season",
  building_next_season: "Building next season"
};

export const LEADERSHIP_TIME_LABELS: Record<LeadershipTimeState, string> = {
  today: "Today",
  this_week: "This week",
  next_week: "Next week",
  overdue: "Overdue",
  future: "Scheduled",
  none: "—"
};

export const LEADERSHIP_SEVERITY_LABELS: Record<LeadershipSeverity, string> = {
  info: "Info",
  warning: "At risk",
  critical: "Critical"
};

// Severity → the shared global pill modifier (info = plain meta-pill).
export const LEADERSHIP_SEVERITY_PILL: Record<LeadershipSeverity, string> = {
  info: "meta-pill",
  warning: "meta-pill meta-pill--warning",
  critical: "meta-pill meta-pill--critical"
};

export function leadershipCategoryLabel(category: string): string {
  return LEADERSHIP_CATEGORY_LABELS[category] ?? category;
}

// Human labels for the read-model `primary_action` verbs. Only rendered as a clickable action when
// the issue's `can_act` is true; otherwise the row still offers a plain "Open" deep-link (viewing a
// record is always safe) but never the action verb.
export const LEADERSHIP_ACTION_LABELS: Record<string, string> = {
  open_shoot: "Open shoot",
  open_job: "Open job",
  set_service_term: "Set service term",
  confirm_service_term: "Confirm service term",
  add_location: "Add location",
  open_work_item: "Open work item",
  assign_owner: "Assign owner",
  confirm_next_term: "Confirm term"
};

export function leadershipActionLabel(action: string): string {
  return LEADERSHIP_ACTION_LABELS[action] ?? action.replace(/_/g, " ");
}
