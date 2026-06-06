import { useEffect, useState, type FormEvent } from "react";
import type {
  ProjectWorkflowHandoff,
  ProjectWorkflowInstance,
  ProjectWorkflowStep,
  ProjectWorkflowStepStatus,
  ProjectWorkflowWaitingOnParty
} from "../../projectTrackingTypes";
import {
  acceptProjectWorkflowHandoff,
  claimProjectWorkflowHandoff,
  listWorkflowAssignableUsers,
  markProjectWorkflowHandoffProductionComplete,
  markProjectWorkflowHandoffWaiting,
  returnProjectWorkflowHandoffToSchools,
  sendProjectWorkflowStepBack,
  sendProjectWorkflowToProduction,
  transitionProjectWorkflowStep
} from "../../services/projectTracking";
import { featureFlags } from "../../featureFlags";
import { canManageWorkflowTemplates } from "../../permissions";
import type { WorkflowAssignableUser } from "../../services/projectTracking";
import type { SessionUser } from "../../types";

type ProjectWorkflowMapProps = {
  workflow: ProjectWorkflowInstance;
  token: string;
  currentUser: SessionUser;
  onWorkflowUpdated?: (workflow: ProjectWorkflowInstance) => void;
};

type ActiveWorkflowStep = ProjectWorkflowStep & { milestone_name: string };
type WorkflowStepLane = "schools" | "production" | "family" | "id_admin";
type WorkflowReadinessState =
  | "In Schools Setup"
  | "Ready for Production"
  | "With Production"
  | "Returned to Schools"
  | "Ready for Family Communication"
  | "ID/Admin Needed"
  | "Ready for Closeout"
  | "Closed";

const PROGRESS_STATUSES: Array<{ value: ProjectWorkflowStepStatus; label: string }> = [
  { value: "NOT_STARTED", label: "Not started" },
  { value: "WAITING", label: "Waiting" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "COMPLETE", label: "Complete" },
  { value: "OVERDUE", label: "Running late" },
  { value: "SKIPPED", label: "Skipped" }
];

const ASSIGNMENT_QUEUES = [
  { value: "", label: "Keep current queue" },
  { value: "schools", label: "Schools Queue" },
  { value: "sports", label: "Sports Queue" },
  { value: "production", label: "Production Queue" },
  { value: "photography", label: "Photography Queue" },
  { value: "operations", label: "Operations Queue" },
  { value: "other", label: "Other Queue" }
];

function statusLabel(status: ProjectWorkflowStep["status"]) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function friendlyName(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function departmentLabel(value: string | null | undefined) {
  const normalized = value?.toLowerCase();
  if (!normalized) {
    return "Not connected yet";
  }
  if (normalized === "id_admin") {
    return "ID/Admin";
  }
  if (normalized === "kp") {
    return "KP";
  }
  return friendlyName(value);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not connected yet";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not connected yet";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function healthTone(step: ProjectWorkflowStep) {
  if (step.status === "BLOCKED" || step.timing.health_state === "red") {
    return "critical";
  }
  if (step.timing.health_state === "yellow") {
    return "warning";
  }
  return "healthy";
}

function ownerLabel(step: ProjectWorkflowStep) {
  if (step.assignment_status === "needs_assignment") {
    return `Needs Assignment · ${departmentLabel(step.assigned_queue ?? step.department)}`;
  }
  if (step.assignment_status === "queued" && step.assigned_queue) {
    return `${departmentLabel(step.assigned_queue)} Queue`;
  }
  if (step.assigned_user_name) {
    return step.assigned_user_name;
  }
  if (step.role_key) {
    return friendlyName(step.role_key);
  }
  if (step.department) {
    return `${friendlyName(step.department)} queue`;
  }
  return "Owner not set";
}

function assignmentLabel(step: ActiveWorkflowStep | undefined) {
  if (!step) {
    return "No active assignment";
  }
  if (step.assignment_status === "needs_assignment") {
    return `Needs Assignment · ${departmentLabel(step.assigned_queue ?? step.department)}`;
  }
  if (step.assignment_status === "claimed" && step.assigned_user_name) {
    return `Claimed by ${step.assigned_user_name}`;
  }
  if (step.assignment_status === "assigned" && step.assigned_user_name) {
    return `Assigned to ${step.assigned_user_name}`;
  }
  if (step.assignment_status === "waiting_on_info") {
    return "Waiting on info";
  }
  if (step.assignment_status === "completed") {
    return "Production complete";
  }
  if (step.assignment_status === "returned") {
    return "Returned to Schools";
  }
  return ownerLabel(step);
}

function slaLabel(step: ProjectWorkflowStep) {
  if (step.status === "BLOCKED") {
    return "Blocked";
  }
  if (step.timing.health_state === "red" || step.status === "OVERDUE") {
    return "Overdue";
  }
  if (step.timing.health_state === "yellow") {
    if (step.timing.alert_level === "early_warning") {
      return "Due soon";
    }
    if (step.timing.alert_level === "risk") {
      return "At risk";
    }
    if (step.timing.alert_level === "urgent") {
      return "Urgent";
    }
    return friendlyName(step.timing.alert_level);
  }
  return "On track";
}

function currentStep(workflow: ProjectWorkflowInstance): ActiveWorkflowStep | undefined {
  return workflow.milestones
    .flatMap((milestone) => milestone.steps.map((step) => ({ ...step, milestone_name: milestone.name })))
    .find((step) => ["IN_PROGRESS", "BLOCKED", "OVERDUE", "WAITING", "NOT_STARTED"].includes(step.status));
}

function workflowSteps(workflow: ProjectWorkflowInstance): ActiveWorkflowStep[] {
  return workflow.milestones.flatMap((milestone) =>
    milestone.steps.map((step) => ({ ...step, milestone_name: milestone.name }))
  );
}

function stepLane(step: ProjectWorkflowStep): WorkflowStepLane {
  const haystack = [step.department, step.milestone_key, step.step_key, step.name, step.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (haystack.includes("production") || haystack.includes("image") || haystack.includes("edit") || haystack.includes("qa")) {
    return "production";
  }
  if (haystack.includes("family") || haystack.includes("gallery") || haystack.includes("follow")) {
    return "family";
  }
  if (haystack.includes("id") || haystack.includes("admin") || haystack.includes("badge")) {
    return "id_admin";
  }
  return "schools";
}

function nextActionLabel(step: ActiveWorkflowStep | undefined) {
  if (!step) {
    return "Workflow is complete or waiting for setup.";
  }
  if (step.status === "BLOCKED") {
    return step.exception_reason ? `Resolve blocker: ${step.exception_reason}` : "Resolve the blocker before this can move.";
  }
  if (step.status === "WAITING") {
    return "Follow up on the information this step is waiting for.";
  }
  if (step.status === "OVERDUE") {
    return "Update this step or mark what is holding it up.";
  }
  return `Work the current step: ${step.name}.`;
}

function stepText(step: ProjectWorkflowStep | undefined) {
  return [step?.department, step?.milestone_key, step?.step_key, step?.name, step?.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function recentlyCompletedStep(steps: ActiveWorkflowStep[]) {
  return [...steps]
    .filter((step) => step.status === "COMPLETE")
    .sort((a, b) => {
      const aTime = new Date(a.completed_at ?? a.updated_at).getTime();
      const bTime = new Date(b.completed_at ?? b.updated_at).getTime();
      return bTime - aTime;
    })[0];
}

function lastWorkflowUpdate(workflow: ProjectWorkflowInstance, steps: ActiveWorkflowStep[]) {
  const timestamps = [
    workflow.workflow_run.completed_at,
    workflow.workflow_run.started_at,
    ...workflow.handoffs.map((handoff) => handoff.updated_at),
    ...workflow.handoffs.map((handoff) => handoff.sent_at),
    ...workflow.handoffs.map((handoff) => handoff.accepted_at),
    ...workflow.handoffs.map((handoff) => handoff.returned_at),
    ...workflow.audit_events.map((event) => event.created_at),
    ...steps.map((step) => step.updated_at),
    ...steps.map((step) => step.completed_at)
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value));
  if (timestamps.length === 0) {
    return null;
  }
  return new Date(Math.max(...timestamps)).toISOString();
}

function waitingForLabel(step: ActiveWorkflowStep | undefined) {
  if (!step) {
    return "No active wait";
  }
  if (step.waiting_on_party && step.waiting_on_party !== "none") {
    const party = step.waiting_on_party === "unknown" ? "not set yet" : departmentLabel(step.waiting_on_party);
    return step.waiting_detail ? `Waiting for ${party}: ${step.waiting_detail}` : `Waiting for ${party}`;
  }
  if (step.status === "BLOCKED") {
    return step.exception_reason ? `Blocked: ${step.exception_reason}` : "Blocked";
  }
  if (step.status === "WAITING") {
    return step.exception_reason ? `Waiting for: ${step.exception_reason}` : "Waiting for information";
  }
  if (stepLane(step) === "production") {
    return "Production";
  }
  return "No wait";
}

function blockerWaitingLabel(step: ActiveWorkflowStep | undefined) {
  if (!step) {
    return "No blocker or wait";
  }
  if (step.waiting_on_party && step.waiting_on_party !== "none") {
    const party = step.waiting_on_party === "unknown" ? "not set yet" : departmentLabel(step.waiting_on_party);
    return step.waiting_detail ? `Waiting for ${party}: ${step.waiting_detail}` : `Waiting for ${party}`;
  }
  if (step.status === "BLOCKED") {
    return step.exception_reason ? `Blocked: ${step.exception_reason}` : "Blocked";
  }
  if (step.status === "WAITING") {
    return step.exception_reason ? `Waiting for: ${step.exception_reason}` : "Waiting for information";
  }
  return "No blocker or wait";
}

function handoffStatusLabel(status: ProjectWorkflowHandoff["status"]) {
  const labels: Record<ProjectWorkflowHandoff["status"], string> = {
    pending: "Ready for Production",
    acknowledged: "Accepted",
    completed: "Complete",
    rejected: "Rejected",
    sent_to_production: "Sent to Production",
    accepted_by_production: "Accepted by Production",
    waiting_on_info: "Waiting on Info",
    production_complete: "Production Complete",
    returned_to_schools: "Returned to Schools",
    returned_with_issue: "Returned with Issue"
  };
  return labels[status] ?? friendlyName(status);
}

function handoffTimestamp(handoff: ProjectWorkflowHandoff) {
  return handoff.returned_at ?? handoff.accepted_at ?? handoff.sent_at ?? handoff.updated_at ?? handoff.created_at;
}

function nextDeadlineLabel(step: ActiveWorkflowStep | undefined) {
  if (!step) {
    return "No active deadline";
  }
  const state = slaLabel(step);
  if (state === "On track") {
    return "On track; exact deadline not connected yet";
  }
  return `${state}; exact deadline not connected yet`;
}

function workflowStatusLabel(value: string | null | undefined) {
  if (!value) {
    return "Status not set";
  }
  return friendlyName(value);
}

function jobTypeLabel(value: string | null | undefined) {
  if (!value) {
    return "Not classified";
  }
  return friendlyName(value);
}

function currentStateLabel(step: ActiveWorkflowStep | undefined) {
  if (!step) {
    return "Complete";
  }
  if (step.status === "BLOCKED") {
    return "Blocked";
  }
  if (step.status === "WAITING") {
    return "Waiting";
  }
  if (step.status === "OVERDUE" || step.timing.health_state === "red") {
    return "At Risk";
  }
  if (step.status === "COMPLETE") {
    return "Complete";
  }
  return "Ready";
}

function workflowHealthChip(step: ActiveWorkflowStep | undefined) {
  if (!step) {
    return { label: "Complete", className: "project-workflow-status-chip--complete" };
  }
  if (step.status === "BLOCKED") {
    return { label: "Blocked", className: "project-workflow-status-chip--blocked" };
  }
  if (step.status === "WAITING" || step.waiting_on_party) {
    return { label: "Waiting On", className: "project-workflow-status-chip--waiting" };
  }
  if (step.status === "OVERDUE" || step.timing.health_state === "red") {
    return { label: "At Risk", className: "project-workflow-status-chip--risk" };
  }
  if (step.timing.health_state === "yellow") {
    return { label: "At Risk", className: "project-workflow-status-chip--risk" };
  }
  return { label: "Ready", className: "project-workflow-status-chip--ready" };
}

function deriveReadinessState(workflow: ProjectWorkflowInstance, activeStep: ActiveWorkflowStep | undefined, steps: ActiveWorkflowStep[]): { label: WorkflowReadinessState; detail: string } {
  if (!activeStep || workflow.workflow_run.completed_at || workflow.workflow_run.status === "COMPLETE") {
    return { label: "Closed", detail: "No active workflow step is waiting for action." };
  }

  const latestCompleted = recentlyCompletedStep(steps);
  const activeText = stepText(activeStep);
  const latestCompletedText = stepText(latestCompleted);
  const lane = stepLane(activeStep);

  if (activeText.includes("closeout") || activeText.includes("close_job") || activeText.includes("close job")) {
    return { label: "Ready for Closeout", detail: "Final notes and closeout are the next working step." };
  }
  if (lane === "id_admin") {
    return { label: "ID/Admin Needed", detail: "ID or administrative follow-up is the next working step." };
  }
  if (lane === "family") {
    return { label: "Ready for Family Communication", detail: "Schools owns the next family communication step." };
  }
  if (latestCompletedText.includes("return_to_schools") || latestCompletedText.includes("return to schools")) {
    return { label: "Returned to Schools", detail: `Production returned this job; next Schools action is ${activeStep.name}.` };
  }
  if (activeText.includes("send_to_production") || activeText.includes("send to production")) {
    return { label: "Ready for Production", detail: "Schools can send this job once handoff readiness is confirmed." };
  }
  if (lane === "production") {
    return { label: "With Production", detail: "Production owns the current working step." };
  }
  return { label: "In Schools Setup", detail: "Schools owns setup, prep, data, or admin work right now." };
}

export function ProjectWorkflowMap({ workflow, token, currentUser, onWorkflowUpdated }: ProjectWorkflowMapProps) {
  const activeStep = currentStep(workflow);
  const allSteps = workflowSteps(workflow);
  const completedCount = allSteps.filter((step) => step.status === "COMPLETE").length;
  const waitingCount = allSteps.filter((step) => step.status === "WAITING" || step.status === "NOT_STARTED").length;
  const blockedCount = allSteps.filter((step) => step.status === "BLOCKED").length;
  const reworkCount = allSteps.reduce((total, step) => total + step.rework_count, 0);
  const laneCounts = allSteps.reduce(
    (counts, step) => {
      counts[stepLane(step)] += 1;
      return counts;
    },
    { schools: 0, production: 0, family: 0, id_admin: 0 } satisfies Record<WorkflowStepLane, number>
  );
  const [draftStatus, setDraftStatus] = useState<ProjectWorkflowStepStatus>(activeStep?.status ?? "IN_PROGRESS");
  const [draftNote, setDraftNote] = useState(activeStep?.notes ?? "");
  const [draftReason, setDraftReason] = useState(activeStep?.exception_reason ?? "");
  const [handoffFilesConfirmed, setHandoffFilesConfirmed] = useState(false);
  const [handoffDataConfirmed, setHandoffDataConfirmed] = useState(false);
  const [handoffJobTypeConfirmed, setHandoffJobTypeConfirmed] = useState(false);
  const [handoffDueDateConfirmed, setHandoffDueDateConfirmed] = useState(false);
  const [handoffNote, setHandoffNote] = useState("");
  const [returnNote, setReturnNote] = useState("");
  const [missingInfoDetail, setMissingInfoDetail] = useState("");
  const [missingInfoParty, setMissingInfoParty] = useState<ProjectWorkflowWaitingOnParty>("school");
  const [clawbackReason, setClawbackReason] = useState("");
  const [closeJobConfirmationOpen, setCloseJobConfirmationOpen] = useState(false);
  const [closeoutNote, setCloseoutNote] = useState("");
  const [assignableUsers, setAssignableUsers] = useState<WorkflowAssignableUser[]>([]);
  const [assignableUserState, setAssignableUserState] = useState<"loading" | "ready" | "error">("loading");
  const [assignmentUserId, setAssignmentUserId] = useState("");
  const [assignmentQueue, setAssignmentQueue] = useState("");
  const [assignmentNote, setAssignmentNote] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const productionHandoffs = workflow.handoffs.filter(
    (handoff) => handoff.to_department === "production" && handoff.from_department !== handoff.to_department && Boolean(handoff.sent_at)
  );
  const activeProductionHandoff =
    [...productionHandoffs]
      .filter((handoff) => !["returned_to_schools", "returned_with_issue"].includes(handoff.status))
      .sort((a, b) => Date.parse(handoffTimestamp(b)) - Date.parse(handoffTimestamp(a)))[0] ?? null;
  const activeHandoffStatus = activeProductionHandoff?.status ?? null;
  const canSendToProduction =
    Boolean(activeStep) &&
    !activeProductionHandoff &&
    (activeStep?.step_key === "send_to_production" || activeStep?.name.toLowerCase().includes("send to production"));
  const canAcceptHandoff = activeHandoffStatus === "sent_to_production";
  const canClaimHandoff =
    Boolean(activeProductionHandoff) &&
    activeHandoffStatus === "accepted_by_production" &&
    !activeStep?.assigned_user_id &&
    !["claimed", "assigned", "in_progress", "completed"].includes(activeStep?.assignment_status ?? "");
  const canMarkMissingInfo = activeHandoffStatus === "accepted_by_production";
  const canCompleteProduction = activeHandoffStatus === "accepted_by_production" || activeHandoffStatus === "waiting_on_info";
  const canReturnToSchools = activeHandoffStatus === "production_complete";
  const claimHandoffLabel = canClaimHandoff ? "Claim" : activeHandoffStatus !== "accepted_by_production" ? "Accept first" : "Claimed / assigned";
  const canEditWorkflowRecipe = featureFlags.workflowTemplateBuilderV1 && canManageWorkflowTemplates(currentUser);

  useEffect(() => {
    setDraftStatus(activeStep?.status ?? "IN_PROGRESS");
    setDraftNote(activeStep?.notes ?? "");
    setDraftReason(activeStep?.exception_reason ?? "");
    setHandoffFilesConfirmed(false);
    setHandoffDataConfirmed(false);
    setHandoffJobTypeConfirmed(false);
    setHandoffDueDateConfirmed(false);
    setHandoffNote("");
    setReturnNote("");
    setMissingInfoDetail("");
    setMissingInfoParty("school");
    setClawbackReason("");
    setCloseJobConfirmationOpen(false);
    setCloseoutNote("");
  }, [activeStep?.id, activeStep?.status, activeStep?.notes, activeStep?.exception_reason]);

  useEffect(() => {
    setSaveState("idle");
    setSaveError("");
  }, [activeStep?.id]);

  useEffect(() => {
    setSaveNotice("");
  }, [workflow.workflow_run.id]);

  useEffect(() => {
    let active = true;
    setAssignableUserState("loading");
    listWorkflowAssignableUsers(token)
      .then((users) => {
        if (!active) {
          return;
        }
        setAssignableUsers(users.filter((user) => user.membership_status === "active" || !user.membership_status));
        setAssignableUserState("ready");
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setAssignableUsers([]);
        setAssignableUserState("error");
      });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    setAssignmentUserId(activeStep?.assigned_user_id ?? "");
    setAssignmentQueue(activeStep?.assigned_queue ?? "");
    setAssignmentNote("");
  }, [activeStep?.id, activeStep?.assigned_user_id, activeStep?.assigned_queue]);

  const saveStepTransition = async ({
    status,
    notes,
    reason,
    assignedUserId,
    assignedQueue,
    successNotice
  }: {
    status: ProjectWorkflowStepStatus;
    notes?: string | null;
    reason?: string | null;
    assignedUserId?: string | null;
    assignedQueue?: string | null;
    successNotice: string;
  }) => {
    if (!activeStep) {
      return false;
    }
    const note = notes?.trim() ?? "";
    const reasonText = reason?.trim() ?? "";
    if (status === "BLOCKED" && !reasonText) {
      setSaveState("error");
      setSaveError("Add a short blocker reason before marking this step blocked.");
      setSaveNotice("");
      return false;
    }
    setSaveState("saving");
    setSaveError("");
    setSaveNotice("");
    try {
      const updated = await transitionProjectWorkflowStep(token, activeStep.id, {
        status,
        notes: note || null,
        reason: reasonText || note || (status !== activeStep.status ? "Updated from the job workflow." : null),
        assigned_user_id: assignedUserId ?? null,
        assigned_queue: assignedQueue ?? null,
        last_seen_updated_at: activeStep.updated_at,
        idempotency_key: `live-job-workflow:${activeStep.id}:${status}:${Date.now()}`
      });
      onWorkflowUpdated?.(updated);
      setSaveState("saved");
      setSaveNotice(successNotice);
      return true;
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "We couldn't update this workflow step.");
      setSaveNotice("");
      return false;
    }
  };

  const runHandoffAction = async (action: () => Promise<ProjectWorkflowInstance>, successNotice: string) => {
    setSaveState("saving");
    setSaveError("");
    setSaveNotice("");
    try {
      const updated = await action();
      onWorkflowUpdated?.(updated);
      setSaveState("saved");
      setSaveNotice(successNotice);
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "We couldn't update this handoff.");
      setSaveNotice("");
    }
  };

  const submitProgressUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await saveStepTransition({
      status: draftStatus,
      notes: draftNote,
      reason: draftReason || (draftStatus !== activeStep?.status ? "Updated from the job workflow." : null),
      successNotice: "Progress saved"
    });
  };

  const sendToProduction = async () => {
    if (!canSendToProduction) {
      setSaveState("error");
      setSaveError(
        activeProductionHandoff
          ? "This job is already connected to an active Production handoff."
          : "Send to Production is available when the workflow reaches the Schools handoff step."
      );
      setSaveNotice("");
      return;
    }
    if (!handoffFilesConfirmed || !handoffDataConfirmed || !handoffJobTypeConfirmed || !handoffDueDateConfirmed) {
      setSaveState("error");
      setSaveError("Confirm files, data, job type, and due date before sending this job to Production.");
      setSaveNotice("");
      return;
    }
    if (!activeStep) {
      return;
    }
    await runHandoffAction(
      () =>
        sendProjectWorkflowToProduction(token, workflow.workflow_run.id, {
          step_id: activeStep.id,
          notes: [
        "Sent to Production.",
        "Files confirmed.",
        "Data confirmed.",
        "Job type confirmed.",
        "Due date confirmed.",
        handoffNote.trim() ? `Production note: ${handoffNote.trim()}` : ""
      ]
        .filter(Boolean)
        .join(" "),
          readiness: {
            files_confirmed: handoffFilesConfirmed,
            data_confirmed: handoffDataConfirmed,
            job_type_confirmed: handoffJobTypeConfirmed,
            due_date_confirmed: handoffDueDateConfirmed
          }
        }),
      "Sent to Production"
    );
  };

  const returnToSchools = async () => {
    const note = returnNote.trim();
    if (!note) {
      setSaveState("error");
      setSaveError("Add a short completion or issue note before returning this job to Schools.");
      setSaveNotice("");
      return;
    }
    if (!activeProductionHandoff) {
      setSaveState("error");
      setSaveError("No active Production handoff is connected to this workflow yet.");
      setSaveNotice("");
      return;
    }
    if (!canReturnToSchools) {
      setSaveState("error");
      setSaveError("Mark Production Complete before returning this job to Schools.");
      setSaveNotice("");
      return;
    }
    await runHandoffAction(
      () => returnProjectWorkflowHandoffToSchools(token, activeProductionHandoff.id, { return_reason: note, issue_flag: false }),
      "Returned to Schools"
    );
  };

  const acceptHandoff = async () => {
    if (!activeProductionHandoff || !canAcceptHandoff) {
      return;
    }
    await runHandoffAction(() => acceptProjectWorkflowHandoff(token, activeProductionHandoff.id), "Production accepted the handoff");
  };

  const claimHandoff = async () => {
    if (!activeProductionHandoff || !canClaimHandoff) {
      return;
    }
    await runHandoffAction(
      () => claimProjectWorkflowHandoff(token, activeProductionHandoff.id, { assigned_queue: "production", notes: "Production claimed this work." }),
      "Production claimed the work"
    );
  };

  const markHandoffMissingInfo = async () => {
    if (!activeProductionHandoff || !canMarkMissingInfo) {
      return;
    }
    const detail = missingInfoDetail.trim();
    if (!detail) {
      setSaveState("error");
      setSaveError("Add what Production is waiting on before marking missing info.");
      setSaveNotice("");
      return;
    }
    await runHandoffAction(
      () => markProjectWorkflowHandoffWaiting(token, activeProductionHandoff.id, { waiting_on_party: missingInfoParty, waiting_detail: detail }),
      "Marked waiting on info"
    );
  };

  const markHandoffProductionComplete = async () => {
    if (!activeProductionHandoff || !canCompleteProduction) {
      return;
    }
    await runHandoffAction(
      () => markProjectWorkflowHandoffProductionComplete(token, activeProductionHandoff.id),
      "Production marked complete"
    );
  };

  const readiness = deriveReadinessState(workflow, activeStep, allSteps);
  const recentCompleted = recentlyCompletedStep(allSteps);
  const canClawBackRecentStep = Boolean(activeStep && recentCompleted && recentCompleted.id !== activeStep.id);
  const lastUpdated = lastWorkflowUpdate(workflow, allSteps);
  const healthChip = workflowHealthChip(activeStep);
  const waitingLabel = waitingForLabel(activeStep);
  const blockerWaiting = blockerWaitingLabel(activeStep);
  const hasWaitingOrBlocker = Boolean(
    activeStep &&
      (activeStep.status === "BLOCKED" ||
        activeStep.status === "WAITING" ||
        (activeStep.waiting_on_party && activeStep.waiting_on_party !== "none"))
  );

  const assignCurrentStepToMe = async () => {
    if (!activeStep) {
      return;
    }
    await saveStepTransition({
      status: draftStatus,
      notes: draftNote || `Assigned to ${currentUser.fullName}.`,
      reason: `Assigned current workflow step to ${currentUser.fullName}.`,
      assignedUserId: currentUser.id,
      successNotice: "Current step assigned"
    });
  };

  const assignCurrentStep = async () => {
    if (!activeStep) {
      return;
    }
    const selectedUser = assignableUsers.find((user) => user.user_id === assignmentUserId);
    const selectedQueue = ASSIGNMENT_QUEUES.find((queue) => queue.value === assignmentQueue);
    const userChanged = assignmentUserId && assignmentUserId !== activeStep.assigned_user_id;
    const queueChanged = assignmentQueue && assignmentQueue !== activeStep.assigned_queue;
    if (!userChanged && !queueChanged) {
      setSaveState("error");
      setSaveError("Choose a different person or queue before saving assignment.");
      setSaveNotice("");
      return;
    }
    const assignmentParts = [
      selectedUser ? `person: ${selectedUser.full_name}` : null,
      selectedQueue?.value ? `queue: ${selectedQueue.label}` : null
    ].filter(Boolean);
    const note = assignmentNote.trim();
    await saveStepTransition({
      status: activeStep.status,
      notes: note || `Assignment updated (${assignmentParts.join(", ")}).`,
      reason: `Updated workflow assignment (${assignmentParts.join(", ")}).`,
      assignedUserId: assignmentUserId || null,
      assignedQueue: assignmentQueue || null,
      successNotice: "Assignment updated"
    });
  };

  const clawBackRecentStep = async () => {
    if (!activeStep || !recentCompleted || !canClawBackRecentStep) {
      return;
    }
    const reason = clawbackReason.trim();
    if (!reason) {
      setSaveState("error");
      setSaveError("Add a reason before clawing a job back to the previous completed step.");
      setSaveNotice("");
      return;
    }
    setSaveState("saving");
    setSaveError("");
    setSaveNotice("");
    try {
      const updated = await sendProjectWorkflowStepBack(token, activeStep.id, {
        target_step_id: recentCompleted.id,
        reason,
        assigned_user_id: activeStep.assigned_user_id ?? currentUser.id,
        expected_duration_minutes: recentCompleted.expected_duration_minutes ?? activeStep.expected_duration_minutes ?? 1440,
        expectations: "Clawback from the job workflow because the job moved forward too soon."
      });
      onWorkflowUpdated?.(updated);
      setSaveState("saved");
      setSaveNotice("Clawed back to previous step");
      setClawbackReason("");
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "We couldn't claw this workflow step back.");
      setSaveNotice("");
    }
  };

  const confirmCloseJob = async () => {
    const note = closeoutNote.trim();
    const saved = await saveStepTransition({
      status: "COMPLETE",
      notes: note || "Job closeout step completed.",
      reason: note || "Job closeout completed from the job workflow.",
      successNotice: "Closeout step completed"
    });
    if (saved) {
      setCloseJobConfirmationOpen(false);
      setCloseoutNote("");
    }
  };

  return (
    <section className="panel project-workflow-map">
      <div className="project-workflow-map__header">
        <div>
          <div className="section-title">Workflow Detail</div>
          <p className="section-subtitle">
            Action surface for the selected job workflow.
          </p>
        </div>
        <div className="project-tracking-board-header__actions">
          {canEditWorkflowRecipe ? (
            <a className="button button-secondary" href="#project-tracking/workflow-templates">
              Edit Workflow Steps
            </a>
          ) : null}
          <a className="button button-secondary" href="#project-tracking">
            Back to Project Dashboard
          </a>
        </div>
      </div>

      <section className="project-workflow-detail-hero" aria-labelledby="workflow-detail-title">
        <div className="project-workflow-detail-hero__summary">
          <span className="metric-label">Workflow Detail</span>
          <h1 id="workflow-detail-title" title={workflow.job.title}>{workflow.job.title}</h1>
          <p>
            {jobTypeLabel(workflow.job.job_type)} for {workflow.job.organization_name ?? "No account linked"}
          </p>
          <div className="project-workflow-status-row" aria-label="Current workflow status">
            <span className={`project-workflow-status-chip ${healthChip.className}`}>{healthChip.label}</span>
            <span className="project-workflow-status-chip project-workflow-status-chip--neutral">Status: {workflowStatusLabel(workflow.workflow_run.status)}</span>
            <span className="project-workflow-status-chip project-workflow-status-chip--neutral">Step: {activeStep ? statusLabel(activeStep.status) : "Complete"}</span>
            {hasWaitingOrBlocker ? <span className="project-workflow-status-chip project-workflow-status-chip--waiting">{waitingLabel}</span> : null}
          </div>
        </div>
        <div className="project-workflow-current-state" aria-label="Current State">
          <div>
            <span className="metric-label">Current State</span>
            <strong>{currentStateLabel(activeStep)}</strong>
          </div>
          <div>
            <span className="metric-label">Current Step</span>
            <strong>{activeStep?.name ?? "No active step"}</strong>
            <small>{activeStep?.milestone_name ?? "Workflow complete or waiting for setup"}</small>
          </div>
          <div>
            <span className="metric-label">Owner</span>
            <strong>{activeStep ? assignmentLabel(activeStep) : "No active owner"}</strong>
            <small>{activeStep ? departmentLabel(activeStep.department) : "No active department"}</small>
          </div>
          <div>
            <span className="metric-label">Due</span>
            <strong>{nextDeadlineLabel(activeStep)}</strong>
          </div>
        </div>
      </section>

      <section className="project-workflow-next-action" aria-labelledby="workflow-next-action-title">
        <div>
          <span className="metric-label">Next Action</span>
          <h2 id="workflow-next-action-title">{nextActionLabel(activeStep)}</h2>
          <p>
            {activeStep
              ? `Owner: ${assignmentLabel(activeStep)}. Due: ${nextDeadlineLabel(activeStep)}.`
              : "No active workflow step is waiting for action."}
          </p>
        </div>
        <div className="project-workflow-next-action__context">
          <div>
            <span>Blocked / Waiting</span>
            <strong>{blockerWaiting}</strong>
          </div>
          <div>
            <span>Activity</span>
            <strong>{formatDateTime(lastUpdated)}</strong>
          </div>
          <div>
            <span>Primary Controls</span>
            <strong>{activeStep ? "Use current step editor and quick actions below" : "No action controls available"}</strong>
          </div>
        </div>
      </section>

      <div className="project-workflow-map__context-grid">
        <div>
          <span className="metric-label">Related Job</span>
          <strong title={workflow.job.title}>{workflow.job.title}</strong>
        </div>
        <div>
          <span className="metric-label">Related Account</span>
          <strong title={workflow.job.organization_name ?? undefined}>{workflow.job.organization_name ?? "No account linked"}</strong>
        </div>
        <div>
          <span className="metric-label">Workflow</span>
          <strong title={workflow.workflow_run.template_name ?? workflow.workflow_run.template_key}>{workflow.workflow_run.template_name ?? workflow.workflow_run.template_key}</strong>
          <small>{canEditWorkflowRecipe ? "Edit step names, departments, and order in Workflow Templates." : "Workflow setup copied into this job."}</small>
        </div>
        <div>
          <span className="metric-label">Department</span>
          <strong>{activeStep ? departmentLabel(activeStep.department) : "No active department"}</strong>
        </div>
        <div>
          <span className="metric-label">Job Type</span>
          <strong>{jobTypeLabel(workflow.job.job_type)}</strong>
        </div>
        <div>
          <span className="metric-label">Template Version</span>
          <strong>{workflow.workflow_run.template_version_label}</strong>
        </div>
        <div>
          <span className="metric-label">Owner</span>
          <strong>{activeStep ? `${departmentLabel(activeStep.department)} - ${ownerLabel(activeStep)}` : "No active owner"}</strong>
          <small>Departments route work; people can claim or be assigned.</small>
        </div>
        <div>
          <span className="metric-label">Late / At Risk</span>
          <strong>{activeStep ? slaLabel(activeStep) : "Complete"}</strong>
        </div>
      </div>

      <div className="project-workflow-map__snapshot">
        <div>
          <span className="metric-label">Template recipe</span>
          <strong>{workflow.workflow_run.template_name ?? workflow.workflow_run.template_key}</strong>
        </div>
        <div>
          <span className="metric-label">Current Milestone</span>
          <strong>{activeStep?.milestone_name ?? "No active step"}</strong>
        </div>
        <div>
          <span className="metric-label">Current Step</span>
          <strong>{activeStep?.name ?? "Complete or waiting"}</strong>
        </div>
        <div>
          <span className="metric-label">Next Action</span>
          <strong>{nextActionLabel(activeStep)}</strong>
        </div>
        <div>
          <span className="metric-label">Step Counts</span>
          <strong>{completedCount} done / {waitingCount} waiting / {blockedCount} blocked</strong>
        </div>
      </div>

      <div className="project-workflow-lane-summary" aria-label="Workflow sections">
        <div>
          <span>Schools steps</span>
          <strong>{laneCounts.schools}</strong>
        </div>
        <div>
          <span>Production steps</span>
          <strong>{laneCounts.production}</strong>
        </div>
        <div>
          <span>Family communication</span>
          <strong>{laneCounts.family}</strong>
        </div>
        <div>
          <span>ID / admin steps</span>
          <strong>{laneCounts.id_admin}</strong>
        </div>
      </div>

      <div className="project-workflow-trust-strip" aria-label="Workflow trust and freshness">
        <div>
          <span>Readiness state</span>
          <strong>{readiness.label}</strong>
          <small>{readiness.detail}</small>
        </div>
        <div>
          <span>Current department</span>
          <strong>{activeStep ? departmentLabel(activeStep.department) : "No active department"}</strong>
          <small>{activeStep ? `Current step: ${activeStep.name}` : "Workflow complete or waiting for setup"}</small>
        </div>
        <div>
          <span>Waiting for</span>
          <strong>{waitingForLabel(activeStep)}</strong>
          <small>{activeStep?.waiting_on_party ? "Persisted from the current workflow step." : "No explicit wait is set on the active step."}</small>
        </div>
        <div>
          <span>Next deadline</span>
          <strong>{nextDeadlineLabel(activeStep)}</strong>
          <small>Exact due timestamps need durable workflow deadlines.</small>
        </div>
        <div>
          <span>Last updated</span>
          <strong>{formatDateTime(lastUpdated)}</strong>
          <small>Based on workflow and step update times.</small>
        </div>
        <div>
          <span>Recently completed</span>
          <strong>{recentCompleted?.name ?? "No completed step yet"}</strong>
          <small>{recentCompleted ? formatDateTime(recentCompleted.completed_at ?? recentCompleted.updated_at) : "History begins as steps are completed."}</small>
        </div>
      </div>

      <p className="project-workflow-map__truth-note">
        Readiness labels come from this job workflow's steps, handoffs, waiting state, and recent updates.
      </p>

      <section className="project-workflow-handoff-history" aria-label="Production handoff history">
        <div className="project-workflow-handoff-history__header">
          <div>
            <span className="metric-label">Activity</span>
            <strong>{activeProductionHandoff ? handoffStatusLabel(activeProductionHandoff.status) : "No active Production handoff"}</strong>
          </div>
          <p>Durable record of Schools sending work to Production and Production returning it to Schools.</p>
        </div>
        {productionHandoffs.length > 0 ? (
          <div className="project-workflow-handoff-timeline">
            {productionHandoffs.map((handoff) => (
              <article className="project-workflow-handoff-event" key={handoff.id}>
                <div>
                  <strong>{handoffStatusLabel(handoff.status)}</strong>
                  <span>{departmentLabel(handoff.from_department)} → {departmentLabel(handoff.to_department)}</span>
                </div>
                <p>{handoff.notes ?? handoff.return_reason ?? handoff.reason ?? handoff.expectations ?? "No note recorded yet."}</p>
                <small>
                  {handoff.sent_by_user_name ? `Sent by ${handoff.sent_by_user_name} · ` : ""}
                  {handoff.accepted_by_user_name ? `Accepted by ${handoff.accepted_by_user_name} · ` : ""}
                  {handoff.returned_by_user_name ? `Returned by ${handoff.returned_by_user_name} · ` : ""}
                  {formatDateTime(handoffTimestamp(handoff))}
                </small>
              </article>
            ))}
          </div>
        ) : (
          <p className="section-subtitle">No Production handoff has been created for this workflow yet.</p>
        )}
        {workflow.audit_events.length > 0 ? (
          <details className="project-workflow-audit-log">
            <summary>Show recent workflow history</summary>
            <div>
              {workflow.audit_events.slice(0, 8).map((event, index) => (
                <p key={`${event.workflow_step_id ?? "workflow"}-${event.created_at ?? index}`}>
                  <strong>{friendlyName(event.transition_type)}</strong>
                  <span>{event.reason ?? "No note"}</span>
                  <small>{event.actor_name ? `${event.actor_name} · ` : ""}{formatDateTime(event.created_at)}</small>
                </p>
              ))}
            </div>
          </details>
        ) : null}
      </section>

      {reworkCount > 0 ? (
        <div className="project-workflow-map__rework">
          <strong>Rework history:</strong> {reworkCount} send-back or rework action{reworkCount === 1 ? "" : "s"} recorded.
        </div>
      ) : null}

      <form className="project-workflow-progress-editor" onSubmit={(event) => void submitProgressUpdate(event)}>
        <div className="project-workflow-progress-editor__intro">
          <div>
            <span className="metric-label">Current Step Editor</span>
              <strong>{activeStep?.name ?? "Workflow complete"}</strong>
            <p>
              Update this job's current step here.
            </p>
          </div>
          {saveNotice ? <span className="project-workflow-progress-editor__success">{saveNotice}</span> : null}
        </div>
        {activeStep ? (
          <div className="project-workflow-progress-editor__grid">
            <label>
              <span>Current step</span>
              <select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value as ProjectWorkflowStepStatus)}>
                {PROGRESS_STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Shared note</span>
              <input
                value={draftNote}
                onChange={(event) => setDraftNote(event.target.value)}
                placeholder="Visible in queues, My Work, and workflow detail"
              />
            </label>
            <label>
              <span>{draftStatus === "BLOCKED" ? "Blocker reason" : "Reason if needed"}</span>
              <input
                value={draftReason}
                onChange={(event) => setDraftReason(event.target.value)}
                placeholder={draftStatus === "BLOCKED" ? "What is blocking this step?" : "Optional unless changing blocked/skipped/late state"}
              />
            </label>
            <div className="project-workflow-progress-editor__readout">
              <span>Ownership</span>
              <strong>{assignmentLabel(activeStep)}</strong>
              <small>
                {activeStep.assignment_status === "needs_assignment"
                  ? "Needs assignment is a real workflow state. Assign a person, department, or both below."
                  : "Job workflow ownership updates here; the source Workflow Template recipe is not changed."}
              </small>
            </div>
            <button type="button" disabled={saveState === "saving" || activeStep.assigned_user_id === currentUser.id} onClick={() => void assignCurrentStepToMe()}>
              {activeStep.assigned_user_id === currentUser.id ? "Assigned to me" : "Assign step to me"}
            </button>
            <div className="project-workflow-assignment-controls">
              <label>
                <span>Assigned person</span>
                <select
                  value={assignmentUserId}
                  onChange={(event) => setAssignmentUserId(event.target.value)}
                  disabled={saveState === "saving" || assignableUserState === "loading"}
                >
                  <option value="">No person selected</option>
                  {assignableUsers.map((user) => (
                    <option key={user.user_id} value={user.user_id}>
                      {user.full_name}{user.department ? ` - ${departmentLabel(user.department)}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Department</span>
                <select value={assignmentQueue} onChange={(event) => setAssignmentQueue(event.target.value)} disabled={saveState === "saving"}>
                  {ASSIGNMENT_QUEUES.map((queue) => (
                    <option key={queue.value || "none"} value={queue.value}>
                      {queue.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="project-workflow-assignment-controls__wide">
                <span>Assignment note</span>
                <input
                  value={assignmentNote}
                  onChange={(event) => setAssignmentNote(event.target.value)}
                  placeholder="Why is ownership changing?"
                  disabled={saveState === "saving"}
                />
              </label>
              <button type="button" onClick={() => void assignCurrentStep()} disabled={saveState === "saving" || assignableUserState === "loading"}>
                Save assignment
              </button>
              <small className="project-workflow-assignment-controls__help">
                {assignableUserState === "loading"
                  ? "Loading active employees..."
                  : assignableUserState === "error"
                    ? "Employee list is unavailable; assign to yourself or use queue ownership for now."
                    : "Assigned person appears in My Work. Department-only work stays in the Production Queue until a person is assigned."}
              </small>
            </div>
            <div className="project-workflow-progress-editor__readout">
              <span>Waiting on</span>
              <strong>{waitingForLabel(activeStep)}</strong>
              <small>Production missing-info actions persist the waiting party and detail.</small>
            </div>
            <button type="submit" disabled={saveState === "saving"}>
              {saveState === "saving" ? "Saving..." : "Save progress"}
            </button>
          </div>
        ) : (
          <p className="section-subtitle">There is no active step to update. This workflow is complete or waiting for setup.</p>
        )}
        {saveState === "error" && saveError ? <p className="project-workflow-progress-editor__error">{saveError}</p> : null}
      </form>

      {activeStep ? (
        <section className="project-workflow-action-panel" aria-label="Job workflow actions">
          <div className="project-workflow-action-panel__header">
            <div>
              <span className="metric-label">Quick Actions</span>
              <strong>Move this job forward</strong>
            </div>
            <p>Use these for common Schools and Production handoffs without leaving this workflow.</p>
          </div>
          <div className="project-workflow-action-grid">
            <button type="button" onClick={() => void saveStepTransition({ status: "COMPLETE", notes: "Step completed.", reason: "Step completed from the job workflow.", successNotice: "Step completed" })} disabled={saveState === "saving"}>
              Complete step
            </button>
            <button type="button" onClick={() => void saveStepTransition({ status: "WAITING", notes: "Waiting for information.", reason: "Marked waiting for information.", successNotice: "Marked waiting for information" })} disabled={saveState === "saving"}>
              Mark waiting for information
            </button>
            <button type="button" onClick={() => void saveStepTransition({ status: "COMPLETE", notes: "Family communication complete.", reason: "Family communication completed.", successNotice: "Family communication complete" })} disabled={saveState === "saving"}>
              Mark family communication complete
            </button>
            <button type="button" onClick={() => void saveStepTransition({ status: "COMPLETE", notes: "ID/admin item complete.", reason: "ID/admin item completed.", successNotice: "ID/admin item complete" })} disabled={saveState === "saving"}>
              Mark ID/admin item complete
            </button>
            <button type="button" onClick={() => setCloseJobConfirmationOpen(true)} disabled={saveState === "saving"}>
              Close job
            </button>
          </div>
          {closeJobConfirmationOpen ? (
            <div className="confirm-dialog-backdrop" role="presentation">
              <div className="confirm-dialog panel" role="dialog" aria-modal="true" aria-labelledby="close-job-confirm-title">
                <div className="eyebrow">Confirmation</div>
                <h3 id="close-job-confirm-title" className="section-title">
                  Close this job?
                </h3>
                <p className="section-subtitle">
                  This will mark the job as closed. You can still review it later, but it may leave active queues.
                </p>
                <label className="filter-field">
                  <span>Closeout note (optional)</span>
                  <textarea rows={3} value={closeoutNote} onChange={(event) => setCloseoutNote(event.target.value)} />
                </label>
                <div className="confirm-dialog__actions">
                  <button type="button" className="secondary-button" onClick={() => setCloseJobConfirmationOpen(false)} disabled={saveState === "saving"}>
                    Cancel
                  </button>
                  <button type="button" className="danger-button" onClick={() => void confirmCloseJob()} disabled={saveState === "saving"}>
                    {saveState === "saving" ? "Closing..." : "Yes, close job"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          <div className="project-workflow-handoff-card project-workflow-handoff-card--wide">
            <div>
              <strong>Claw back / undo last move</strong>
              <p>
                Use only when the job moved forward too soon. This reopens the most recently completed step on the job workflow; the Workflow Template recipe stays locked.
              </p>
            </div>
            <div className="project-workflow-progress-editor__readout">
              <span>Target step</span>
              <strong>{recentCompleted?.name ?? "No completed step available"}</strong>
              <small>{canClawBackRecentStep ? "Manager override uses existing workflow history." : "Available after at least one prior step is complete."}</small>
            </div>
            <input
              value={clawbackReason}
              onChange={(event) => setClawbackReason(event.target.value)}
              placeholder="Why are we clawing this job back?"
              disabled={!canClawBackRecentStep}
            />
            <button type="button" onClick={() => void clawBackRecentStep()} disabled={saveState === "saving" || !canClawBackRecentStep}>
              Claw back to previous step
            </button>
          </div>
          <div className="project-workflow-handoff-grid">
            <div className="project-workflow-handoff-card">
              <div>
                <strong>Send to Production</strong>
                <p>
                  {canSendToProduction
                    ? "Confirm the handoff basics before Production starts. This creates or updates the durable Production handoff and queues the current Production work."
                    : activeProductionHandoff
                      ? `Already with Production: ${handoffStatusLabel(activeProductionHandoff.status)}.`
                      : "Available when the workflow reaches the Schools handoff step."}
                </p>
              </div>
              <ul className="project-workflow-handoff-list">
                <li>Files/data are ready for Production.</li>
                <li>Job type and due date are confirmed.</li>
                <li>Production notes are included when something needs context.</li>
              </ul>
              <label>
                <input type="checkbox" checked={handoffFilesConfirmed} onChange={(event) => setHandoffFilesConfirmed(event.target.checked)} />
                Files confirmed
              </label>
              <label>
                <input type="checkbox" checked={handoffDataConfirmed} onChange={(event) => setHandoffDataConfirmed(event.target.checked)} />
                Data confirmed
              </label>
              <label>
                <input type="checkbox" checked={handoffJobTypeConfirmed} onChange={(event) => setHandoffJobTypeConfirmed(event.target.checked)} />
                Job type confirmed
              </label>
              <label>
                <input type="checkbox" checked={handoffDueDateConfirmed} onChange={(event) => setHandoffDueDateConfirmed(event.target.checked)} />
                Due date confirmed
              </label>
              <input value={handoffNote} onChange={(event) => setHandoffNote(event.target.value)} placeholder="Production notes if needed" />
              <button type="button" onClick={() => void sendToProduction()} disabled={saveState === "saving" || !canSendToProduction}>
                Send to Production
              </button>
            </div>
            <div className="project-workflow-handoff-card">
              <div>
                <strong>Return to Schools</strong>
                <p>Use when Production is done or needs Schools to resolve an issue. The next Schools action stays visible in this workflow.</p>
              </div>
              <ul className="project-workflow-handoff-list">
                <li>Production step is complete or the issue is clearly noted.</li>
                <li>Output is ready for Schools review, family communication, ID/admin, or closeout.</li>
              </ul>
              <input value={returnNote} onChange={(event) => setReturnNote(event.target.value)} placeholder="Completion or issue note" />
              {!canReturnToSchools && activeProductionHandoff ? (
                <p className="project-workflow-handoff-note">Mark Production Complete before returning this job to Schools.</p>
              ) : null}
              <button type="button" onClick={() => void returnToSchools()} disabled={saveState === "saving" || !canReturnToSchools}>
                Return to Schools
              </button>
            </div>
            <div className="project-workflow-handoff-card">
              <div>
                <strong>Production queue actions</strong>
                <p>{activeProductionHandoff ? `Current handoff: ${handoffStatusLabel(activeProductionHandoff.status)}.` : "Send this job to Production before queue actions are available."}</p>
              </div>
              <div className="project-workflow-action-grid project-workflow-action-grid--compact">
                <button type="button" onClick={() => void acceptHandoff()} disabled={saveState === "saving" || !canAcceptHandoff}>
                  {canAcceptHandoff ? "Accept" : "Accepted"}
                </button>
                <button type="button" onClick={() => void claimHandoff()} disabled={saveState === "saving" || !canClaimHandoff}>
                  {claimHandoffLabel}
                </button>
                <button type="button" onClick={() => void markHandoffProductionComplete()} disabled={saveState === "saving" || !canCompleteProduction}>
                  {canCompleteProduction ? "Mark Production Complete" : "Production Complete"}
                </button>
              </div>
              <label>
                <span>Waiting for</span>
                <select value={missingInfoParty} onChange={(event) => setMissingInfoParty(event.target.value as ProjectWorkflowWaitingOnParty)}>
                  <option value="school">School</option>
                  <option value="kp">KP</option>
                  <option value="production">Production</option>
                  <option value="graphics">Graphics</option>
                  <option value="customer_service">Customer Service</option>
                  <option value="vendor">Vendor</option>
                  <option value="family">Family</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <input value={missingInfoDetail} onChange={(event) => setMissingInfoDetail(event.target.value)} placeholder="What info is missing?" />
              <button type="button" onClick={() => void markHandoffMissingInfo()} disabled={saveState === "saving" || !canMarkMissingInfo}>
                Mark Missing Info
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <div className="project-workflow-section-heading">
        <span className="metric-label">Workflow Steps</span>
        <h2>Workflow Steps</h2>
        <p>Milestones and step state for this workflow.</p>
      </div>
      <div className="workflow-map-grid">
        {workflow.milestones.map((milestone) => (
          <details className="workflow-map-milestone" key={milestone.id} open={milestone.steps.some((step) => step.id === activeStep?.id)}>
            <summary className="workflow-map-milestone__summary">
              <span className="eyebrow">{milestone.status}</span>
              <strong>{milestone.name}</strong>
              <small>{milestone.steps.length} step{milestone.steps.length === 1 ? "" : "s"}</small>
            </summary>
            {milestone.description ? <p>{milestone.description}</p> : null}
            <div className="workflow-map-step-list">
              {milestone.steps.map((step) => (
                <div className={`workflow-map-step workflow-map-step--${healthTone(step)}`} key={step.id}>
                  <div>
                    <strong title={step.name}>{step.name}</strong>
                    <span title={`${step.department} - ${ownerLabel(step)}`}>{step.department} - {ownerLabel(step)}</span>
                    {step.notes ? <span>Shared note: {step.notes}</span> : null}
                    {step.exception_reason ? <span>Reason: {step.exception_reason}</span> : null}
                  </div>
                  <div>
                    <span>{statusLabel(step.status)}</span>
                    <span>Timing: {slaLabel(step)}</span>
                    {step.rework_count > 0 ? <span>{step.rework_count} rework action{step.rework_count === 1 ? "" : "s"}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
