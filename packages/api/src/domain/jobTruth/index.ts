export const JOB_DEPARTMENT_TYPES = ["schools", "sports", "corporate", "headshots", "other"] as const;
export const JOB_CATEGORIES = [
  "photo_day",
  "makeup_day",
  "reshoot",
  "media_day",
  "event",
  "banner_day",
  "specialty",
  "delivery_only",
  "other"
] as const;
export const JOB_STATUSES = [
  "draft",
  "intake_blocked",
  "pending_confirmation",
  "confirmed",
  "ready_to_staff",
  "staffed",
  "ready_to_execute",
  "in_progress",
  "execution_complete",
  "postponed",
  "weather_hold",
  "cancelled",
  "archived"
] as const;
export const JOB_DAY_STATUSES = ["scheduled", "ready", "in_progress", "complete", "postponed", "cancelled"] as const;
export const JOB_PRODUCTION_STATUSES = [
  "not_created",
  "queued",
  "awaiting_ingest",
  "ingest_complete",
  "editing",
  "awaiting_internal_review",
  "proof_build",
  "proof_sent",
  "awaiting_approval",
  "revisions_requested",
  "approved_for_production",
  "approved_for_final",
  "in_final_production",
  "ordered_or_printed",
  "ordered_or_sent",
  "packaged",
  "delivered",
  "complete",
  "blocked",
  "cancelled"
] as const;
export const JOB_STAFFING_STATUSES = [
  "unassigned",
  "partially_staffed",
  "staffed",
  "checked_in",
  "ready_confirmed",
  "gap_flagged"
] as const;
export const JOB_READINESS_STATUSES = ["off_track", "at_risk", "on_track", "ready"] as const;
export const JOB_SYNC_STATUSES = ["clean", "pending", "warning", "error"] as const;
export const JOB_RISK_STATUSES = ["none", "low", "medium", "high", "critical"] as const;
export const JOB_PRIORITY_LEVELS = ["low", "normal", "high", "urgent"] as const;
export const WORK_OBJECT_KINDS = ["job_event", "task", "assignment", "schedule_entry"] as const;
export const WORK_DEPARTMENT_TYPES = ["schools", "sports", "production", "photography", "operations", "other"] as const;
export const WORK_TASK_STATUSES = ["not_started", "in_progress", "waiting", "blocked", "review", "completed", "cancelled"] as const;
export const WORK_ASSIGNMENT_TYPES = [
  "photographer",
  "assistant",
  "account_rep",
  "production_assignee",
  "lead",
  "backup",
  "driver",
  "editor",
  "qa_reviewer"
] as const;
export const WORK_ASSIGNMENT_STATUSES = ["assigned", "confirmed", "in_progress", "completed", "cancelled"] as const;
export const SCHEDULE_ENTRY_TYPES = ["job_event", "staffing", "availability", "hold", "travel", "internal"] as const;
export const JOB_WATCH_FLAG_STATUSES = ["open", "acknowledged", "snoozed", "resolved", "dismissed"] as const;
export const JOB_WATCH_FLAG_SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export const JOB_ASSIGNMENT_STATUSES = ["assigned", "confirmed", "checked_in", "checked_out", "absent", "cancelled"] as const;
export const JOB_ATTACHMENT_ENTITY_TYPES = [
  "job",
  "job_day",
  "production_item",
  "approval_request",
  "qa_review_record",
  "deliverable_item",
  "production_issue_record"
] as const;
export const JOB_APPROVAL_STATUSES = [
  "not_required",
  "not_started",
  "requested",
  "viewed",
  "approved",
  "rejected",
  "revisions_requested",
  "overdue",
  "cancelled"
] as const;
export const JOB_QA_REVIEW_STATUSES = [
  "not_required",
  "queued",
  "in_review",
  "passed",
  "passed_with_notes",
  "failed",
  "rework_in_progress",
  "recheck_required",
  "complete"
] as const;
export const JOB_DELIVERABLE_STATUSES = [
  "not_started",
  "preparing",
  "sent",
  "in_transit",
  "delivered",
  "confirmed",
  "issue_flagged",
  "cancelled"
] as const;
export const JOB_HANDOFF_STATUSES = ["pending", "accepted", "in_progress", "completed", "rejected", "blocked"] as const;
export const JOB_PRODUCTION_ISSUE_STATUSES = ["open", "acknowledged", "resolved", "dismissed"] as const;
export const PRODUCTION_BOARD_WORKFLOW_STATUSES = [
  "DRAFT",
  "WAITING_ON_INTAKE",
  "WAITING_ON_FILES",
  "INTAKE_REVIEW",
  "READY_FOR_PRODUCTION",
  "IN_PRODUCTION",
  "READY_FOR_QA",
  "IN_PEER_REVIEW",
  "REWORK_REQUIRED",
  "READY_FOR_UPLOAD",
  "UPLOADING",
  "UPLOADED",
  "READY_FOR_RELEASE",
  "RELEASED",
  "SENT_TO_VENDOR",
  "DELIVERED_CLOSED",
  "ON_HOLD",
  "BLOCKED",
  "CANCELLED"
] as const;
export const PRODUCTION_BOARD_HEALTH_STATES = ["ON_TRACK", "WATCH", "AT_RISK", "OVERDUE", "BLOCKED"] as const;
export const PRODUCTION_BOARD_SYNC_STATES = [
  "CLEAN",
  "PENDING_SYNC",
  "SYNCED",
  "PARTIAL_ERROR",
  "SYNC_ERROR",
  "STALE"
] as const;
export const PRODUCTION_BOARD_FILE_MATCH_STATUSES = [
  "UNKNOWN",
  "NOT_APPLICABLE",
  "MISSING",
  "PARTIAL",
  "MATCHED",
  "MISMATCH",
  "EXTRA_FILES"
] as const;
export const PRODUCTION_BOARD_UPLOAD_STATUSES = ["NOT_STARTED", "READY", "UPLOADING", "UPLOADED", "VERIFIED", "FAILED"] as const;
export const PRODUCTION_BOARD_RELEASE_STATUSES = [
  "NOT_STARTED",
  "PENDING_REVIEW",
  "READY_FOR_RELEASE",
  "RELEASED",
  "SENT_TO_VENDOR",
  "DELIVERED",
  "CLOSED",
  "FAILED"
] as const;
export const CHECKLIST_SCOPE_TYPES = ["shoot", "production_item", "job", "location"] as const;
export const CHECKLIST_TRIGGER_TYPES = [
  "manual",
  "shoot_status_transition",
  "production_status_transition",
  "job_publish",
  "shoot_complete",
  "upload_verified",
  "release_review"
] as const;
export const CHECKLIST_BLOCKING_LEVELS = ["none", "soft_block", "hard_block"] as const;
export const CHECKLIST_ITEM_TYPES = [
  "checkbox",
  "text",
  "textarea",
  "number",
  "date",
  "time",
  "select",
  "multi_select",
  "yes_no",
  "user_picker",
  "photo_upload",
  "file_upload",
  "signature"
] as const;
export const CHECKLIST_CONDITION_EFFECTS = ["show", "hide", "require", "disable"] as const;
export const CHECKLIST_CONDITION_LOGICS = ["AND", "OR"] as const;
export const CHECKLIST_INSTANCE_STATUSES = [
  "not_started",
  "in_progress",
  "submitted",
  "approved",
  "rejected",
  "overdue",
  "waived"
] as const;
export const CHECKLIST_TEMPLATE_VERSION_STATUSES = ["draft", "published", "archived"] as const;
export const CHECKLIST_APPROVAL_DECISIONS = ["submitted", "approved", "rejected", "waived"] as const;
export const CHECKLIST_REMINDER_TYPES = ["before_due", "at_due", "overdue", "escalation"] as const;
export const WORKFLOW_BLOCK_RESOURCE_TYPES = ["shoot", "production_item"] as const;
export const CHECKLIST_COMMENT_VISIBILITIES = ["standard_internal", "manager_only", "leadership_only"] as const;
export const CHECKLIST_ASSIGNMENT_ROLE_KEYS = [
  "context_owner",
  "context_reviewer",
  "context_approver",
  "account_owner",
  "readiness_owner",
  "production_owner",
  "department_owner",
  "peer_reviewer",
  "release_reviewer",
  "escalation_owner",
  "created_by_user",
  "department_manager",
  "production_manager"
] as const;
export const JOB_ASSIGNMENT_ROLES = [
  "lead_photographer",
  "photographer",
  "assistant",
  "runner",
  "support",
  "coordinator",
  "producer",
  "other"
] as const;
export const ALERT_DELIVERY_CHANNELS = ["in_app", "push", "email", "sms"] as const;
export const ALERT_DELIVERY_STATUSES = ["queued", "delivered", "failed", "read", "acted_on"] as const;
export const DASHBOARD_HEALTH_STATES = ["healthy", "watch", "at_risk", "critical"] as const;

export type JobDepartmentType = (typeof JOB_DEPARTMENT_TYPES)[number];
export type JobCategory = (typeof JOB_CATEGORIES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobDayStatus = (typeof JOB_DAY_STATUSES)[number];
export type JobProductionStatus = (typeof JOB_PRODUCTION_STATUSES)[number];
export type JobStaffingStatus = (typeof JOB_STAFFING_STATUSES)[number];
export type JobReadinessStatus = (typeof JOB_READINESS_STATUSES)[number];
export type JobSyncStatus = (typeof JOB_SYNC_STATUSES)[number];
export type JobRiskStatus = (typeof JOB_RISK_STATUSES)[number];
export type JobPriorityLevel = (typeof JOB_PRIORITY_LEVELS)[number];
export type WorkObjectKind = (typeof WORK_OBJECT_KINDS)[number];
export type WorkDepartmentType = (typeof WORK_DEPARTMENT_TYPES)[number];
export type WorkTaskStatus = (typeof WORK_TASK_STATUSES)[number];
export type WorkAssignmentType = (typeof WORK_ASSIGNMENT_TYPES)[number];
export type WorkAssignmentStatus = (typeof WORK_ASSIGNMENT_STATUSES)[number];
export type ScheduleEntryType = (typeof SCHEDULE_ENTRY_TYPES)[number];
export type JobWatchFlagStatus = (typeof JOB_WATCH_FLAG_STATUSES)[number];
export type JobWatchFlagSeverity = (typeof JOB_WATCH_FLAG_SEVERITIES)[number];
export type JobAssignmentStatus = (typeof JOB_ASSIGNMENT_STATUSES)[number];
export type JobAttachmentEntityType = (typeof JOB_ATTACHMENT_ENTITY_TYPES)[number];
export type JobApprovalStatus = (typeof JOB_APPROVAL_STATUSES)[number];
export type JobQaReviewStatus = (typeof JOB_QA_REVIEW_STATUSES)[number];
export type JobDeliverableStatus = (typeof JOB_DELIVERABLE_STATUSES)[number];
export type JobHandoffStatus = (typeof JOB_HANDOFF_STATUSES)[number];
export type JobProductionIssueStatus = (typeof JOB_PRODUCTION_ISSUE_STATUSES)[number];
export type ProductionBoardWorkflowStatus = (typeof PRODUCTION_BOARD_WORKFLOW_STATUSES)[number];
export type ProductionBoardHealthState = (typeof PRODUCTION_BOARD_HEALTH_STATES)[number];
export type ProductionBoardSyncState = (typeof PRODUCTION_BOARD_SYNC_STATES)[number];
export type ProductionBoardFileMatchStatus = (typeof PRODUCTION_BOARD_FILE_MATCH_STATUSES)[number];
export type ProductionBoardUploadStatus = (typeof PRODUCTION_BOARD_UPLOAD_STATUSES)[number];
export type ProductionBoardReleaseStatus = (typeof PRODUCTION_BOARD_RELEASE_STATUSES)[number];
export type ChecklistScopeType = (typeof CHECKLIST_SCOPE_TYPES)[number];
export type ChecklistTriggerType = (typeof CHECKLIST_TRIGGER_TYPES)[number];
export type ChecklistBlockingLevel = (typeof CHECKLIST_BLOCKING_LEVELS)[number];
export type ChecklistItemType = (typeof CHECKLIST_ITEM_TYPES)[number];
export type ChecklistConditionEffect = (typeof CHECKLIST_CONDITION_EFFECTS)[number];
export type ChecklistConditionLogic = (typeof CHECKLIST_CONDITION_LOGICS)[number];
export type ChecklistInstanceStatus = (typeof CHECKLIST_INSTANCE_STATUSES)[number];
export type ChecklistTemplateVersionStatus = (typeof CHECKLIST_TEMPLATE_VERSION_STATUSES)[number];
export type ChecklistApprovalDecision = (typeof CHECKLIST_APPROVAL_DECISIONS)[number];
export type ChecklistReminderType = (typeof CHECKLIST_REMINDER_TYPES)[number];
export type WorkflowBlockResourceType = (typeof WORKFLOW_BLOCK_RESOURCE_TYPES)[number];
export type ChecklistCommentVisibility = (typeof CHECKLIST_COMMENT_VISIBILITIES)[number];
export type ChecklistAssignmentRoleKey = (typeof CHECKLIST_ASSIGNMENT_ROLE_KEYS)[number];
export type JobAssignmentRole = (typeof JOB_ASSIGNMENT_ROLES)[number];
export type AlertDeliveryChannel = (typeof ALERT_DELIVERY_CHANNELS)[number];
export type AlertDeliveryStatus = (typeof ALERT_DELIVERY_STATUSES)[number];
export type DashboardHealthState = (typeof DASHBOARD_HEALTH_STATES)[number];
