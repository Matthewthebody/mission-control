export const PROJECT_WORKFLOW_STEP_STATUSES = [
  "NOT_STARTED",
  "WAITING",
  "IN_PROGRESS",
  "BLOCKED",
  "COMPLETE",
  "SKIPPED",
  "OVERDUE"
] as const;

export const PROJECT_WORKFLOW_MILESTONE_STATUSES = ["WAITING", "ACTIVE", "COMPLETE", "SKIPPED"] as const;

export const PROJECT_WORKFLOW_TRANSITION_TYPES = [
  "started",
  "completed",
  "blocked",
  "skipped",
  "reopened",
  "sent_back",
  "updated",
  "activated"
] as const;

export const PROJECT_WORKFLOW_HEALTH_STATES = ["green", "yellow", "red"] as const;

export type ProjectWorkflowStepStatus = (typeof PROJECT_WORKFLOW_STEP_STATUSES)[number];
export type ProjectWorkflowMilestoneStatus = (typeof PROJECT_WORKFLOW_MILESTONE_STATUSES)[number];
export type ProjectWorkflowTransitionType = (typeof PROJECT_WORKFLOW_TRANSITION_TYPES)[number];
export type ProjectWorkflowHealthState = (typeof PROJECT_WORKFLOW_HEALTH_STATES)[number];

export const WORKFLOW_TERMINAL_STEP_STATUSES = new Set<ProjectWorkflowStepStatus>(["COMPLETE", "SKIPPED"]);
