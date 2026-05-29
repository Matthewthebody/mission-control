import type { SharedJobWatchFlag } from "./jobTruthTypes";
import type { TeamsMeetingLinkedObjectType, TeamsMeetingStatus } from "./teamsMeetingTypes";
import type { SharedTaskStatus } from "./workModelTypes";

export type PostCallOutcomeStatus = "follow_up_open" | "handled";

export type PostCallAssigneeOption = {
  user_id: string;
  full_name: string;
};

export type PostCallLinkedMeetingSummary = {
  id: string;
  title: string;
  meeting_status: TeamsMeetingStatus;
  meeting_join_url: string | null;
  scheduled_start_at: string;
  scheduled_end_at: string;
};

export type PostCallLinkedTaskSummary = {
  id: string;
  task_number: string;
  title: string;
  status: SharedTaskStatus;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
};

export type PostCallLinkedIssueSummary = {
  id: string;
  title: string;
  severity: SharedJobWatchFlag["severity"];
  status: SharedJobWatchFlag["status"];
};

export type PostCallOutcomeRecord = {
  id: string;
  related_record_type: TeamsMeetingLinkedObjectType;
  related_record_id: string;
  meeting_id: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  handled_by_user_id: string | null;
  handled_by_name: string | null;
  outcome_status: PostCallOutcomeStatus;
  summary: string;
  notes: string | null;
  reason_for_call: string | null;
  meeting_target_id: string | null;
  meeting_join_url: string | null;
  follow_up_task: PostCallLinkedTaskSummary | null;
  follow_up_issue: PostCallLinkedIssueSummary | null;
  issue_flagged: boolean;
  handled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PostCallFollowUpView = {
  object_type: TeamsMeetingLinkedObjectType;
  object_id: string;
  object_label: string;
  feature_enabled: boolean;
  permissions: {
    can_log_outcome: boolean;
    can_create_follow_up_task: boolean;
    can_flag_issue: boolean;
  };
  defaults: {
    suggested_reason: string | null;
    suggested_task_title: string;
    assignee_options: PostCallAssigneeOption[];
    default_assignee_user_id: string | null;
  };
  meeting: PostCallLinkedMeetingSummary | null;
  summary: {
    latest_outcome: PostCallOutcomeRecord | null;
    open_follow_up_count: number;
    handled_count: number;
  };
  recent_outcomes: PostCallOutcomeRecord[];
};

export type CreatePostCallOutcomeInput = {
  meeting_id?: string | null;
  summary: string;
  notes?: string | null;
  reason_for_call?: string | null;
  outcome_status?: PostCallOutcomeStatus | null;
  create_follow_up_task?: boolean;
  follow_up_task_title?: string | null;
  follow_up_task_assignee_user_id?: string | null;
  follow_up_task_due_at?: string | null;
  flag_issue?: boolean;
  issue_severity?: SharedJobWatchFlag["severity"] | null;
  issue_title?: string | null;
  issue_description?: string | null;
};

export type CreatePostCallOutcomeResponse = {
  outcome: PostCallOutcomeRecord | null;
  view: PostCallFollowUpView;
};
