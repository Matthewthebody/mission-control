import type { ProjectWorkflowStepStatus } from "../../domain/projectTracking/index.js";
import type { ProjectWorkflowStepTiming } from "../../types/projectTracking.js";

type TimingInput = {
  status: ProjectWorkflowStepStatus;
  expectedDurationMinutes: number;
  startedAt: string | Date | null;
  completedAt: string | Date | null;
  lastTransitionAt: string | Date | null;
  now?: Date;
};

function toDate(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value : new Date(value);
}

function minutesBetween(start: Date | null, end: Date) {
  if (!start) {
    return 0;
  }
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
}

function alertLevel(percent: number): ProjectWorkflowStepTiming["alert_level"] {
  if (percent >= 100) {
    return "overdue";
  }
  if (percent >= 90) {
    return "urgent";
  }
  if (percent >= 75) {
    return "risk";
  }
  if (percent >= 50) {
    return "early_warning";
  }
  return "none";
}

export function calculateStepTiming(input: TimingInput): ProjectWorkflowStepTiming {
  const now = input.now ?? new Date();
  const startedAt = toDate(input.startedAt);
  const completedAt = toDate(input.completedAt);
  const lastTransitionAt = toDate(input.lastTransitionAt);
  const end = completedAt ?? now;
  const expectedDurationMinutes = Math.max(1, input.expectedDurationMinutes);
  const elapsedMinutes = minutesBetween(startedAt, end);
  const remainingMinutes = Math.max(0, expectedDurationMinutes - elapsedMinutes);
  const overdueMinutes = Math.max(0, elapsedMinutes - expectedDurationMinutes);
  const slaPercent = Math.min(999, Math.floor((elapsedMinutes / expectedDurationMinutes) * 100));
  const level = input.status === "COMPLETE" || input.status === "SKIPPED" ? "none" : alertLevel(slaPercent);
  const idleMinutes = minutesBetween(lastTransitionAt ?? startedAt, now);

  return {
    elapsed_minutes: elapsedMinutes,
    remaining_minutes: remainingMinutes,
    overdue_minutes: overdueMinutes,
    idle_minutes: input.status === "COMPLETE" || input.status === "SKIPPED" ? 0 : idleMinutes,
    sla_percent: slaPercent,
    alert_level: level,
    health_state: level === "overdue" || input.status === "BLOCKED" || input.status === "OVERDUE" ? "red" : level === "risk" || level === "urgent" || level === "early_warning" ? "yellow" : "green"
  };
}
