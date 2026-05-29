import type { AttendanceState, PunchTimingStatus } from "../types/domain.js";
import {
  ATTENDANCE_AWARENESS_POLICY,
  classifyOperationalPunchTiming,
  getAllowedEarlyClockInMinutes
} from "./attendanceAwareness.js";

export const ATTENDANCE_POLICY = {
  earlyGraceMinutes: ATTENDANCE_AWARENESS_POLICY.standardEarlyClockInMinutes,
  leadSetupEarlyClockInMinutes: ATTENDANCE_AWARENESS_POLICY.leadSetupEarlyClockInMinutes,
  graceWindowMinutes: ATTENDANCE_AWARENESS_POLICY.graceWindowMinutes,
  lateWarningMinutes: ATTENDANCE_AWARENESS_POLICY.lateThresholdMinutes,
  lateThresholdMinutes: ATTENDANCE_AWARENESS_POLICY.criticalLateThresholdMinutes,
  missedClockInMinutes: 60,
  noShowSuspectedMinutes: ATTENDANCE_AWARENESS_POLICY.probableNoShowMinutes,
  preShiftReminderMinutes: 15,
  staffingRiskLeadMinutes: 10,
  autoCloseMinutes: 45,
  autoBreakThresholdMinutes: 300,
  autoBreakDeductionMinutes: 30
} as const;

export function getEarlyMinutes(startsAt: string, capturedAt: string) {
  const diffMs = new Date(startsAt).getTime() - new Date(capturedAt).getTime();
  if (diffMs <= 0) {
    return 0;
  }
  return Math.ceil(diffMs / 60000);
}

export function getLateMinutes(startsAt: string, capturedAt: string) {
  const diffMs = new Date(capturedAt).getTime() - new Date(startsAt).getTime();
  if (diffMs <= 0) {
    return 0;
  }
  return Math.floor(diffMs / 60000);
}

export function getPunchTimingStatus(input: {
  direction: "in" | "out";
  earlyMinutes: number;
  lateMinutes: number;
  requiresMissedPunchWorkflow: boolean;
}): PunchTimingStatus {
  if (input.direction === "out") {
    return "normal";
  }
  if (input.requiresMissedPunchWorkflow) {
    return "missed_punch_required";
  }
  const operational = classifyOperationalPunchTiming({
    direction: input.direction,
    earlyMinutes: input.earlyMinutes,
    lateMinutes: input.lateMinutes
  });
  if (operational === "early") {
    return "early";
  }
  if (operational === "grace_window") {
    return "grace_window";
  }
  if (operational === "late") {
    return "late";
  }
  if (operational === "critically_late") {
    return "critically_late";
  }
  if (input.earlyMinutes > ATTENDANCE_POLICY.earlyGraceMinutes) {
    return "early_exception";
  }
  return "normal";
}

export function getAttendanceStateForPunch(input: {
  direction: "in" | "out";
  timingStatus: PunchTimingStatus;
}): AttendanceState {
  if (input.direction === "out") {
    return "clocked_out";
  }
  if (input.timingStatus === "critically_late") {
    return "late";
  }
  if (input.timingStatus === "late") {
    return "late_warning";
  }
  return "clocked_in";
}

export function getClockInAllowanceMinutes(input: {
  staffingRole?: string | null;
  satisfiesLeadCoverage?: boolean | null;
}) {
  return getAllowedEarlyClockInMinutes(input);
}

export function getAutoBreakDeductionMinutes(grossMinutes: number) {
  if (grossMinutes > ATTENDANCE_POLICY.autoBreakThresholdMinutes) {
    return ATTENDANCE_POLICY.autoBreakDeductionMinutes;
  }
  return 0;
}

export function calculateDurationMinutes(startsAt: string, endsAt: string) {
  return Math.max(0, Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000));
}
