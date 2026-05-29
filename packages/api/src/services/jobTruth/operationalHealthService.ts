import type { DashboardHealthSummary } from "../../types/jobTruth.js";

type HealthInputs = {
  criticalWatchCount: number;
  highWatchCount: number;
  staffingGapCount: number;
  blockedProductionCount: number;
  overdueApprovalCount: number;
  deliveryRiskCount: number;
  missingReadyConfirmationCount: number;
  jobsToday: number;
};

export function computeOperationalHealth(inputs: HealthInputs): DashboardHealthSummary {
  const score = Math.max(
    0,
    100 -
      inputs.criticalWatchCount * 18 -
      inputs.highWatchCount * 8 -
      inputs.staffingGapCount * 7 -
      inputs.blockedProductionCount * 6 -
      inputs.overdueApprovalCount * 5 -
      inputs.deliveryRiskCount * 5 -
      inputs.missingReadyConfirmationCount * 4
  );

  const explanation: string[] = [];
  if (inputs.criticalWatchCount > 0) {
    explanation.push(`${inputs.criticalWatchCount} critical watch flag(s) are unresolved.`);
  }
  if (inputs.staffingGapCount > 0) {
    explanation.push(`${inputs.staffingGapCount} staffing gap(s) still need coverage.`);
  }
  if (inputs.blockedProductionCount > 0) {
    explanation.push(`${inputs.blockedProductionCount} production item(s) are blocked.`);
  }
  if (inputs.overdueApprovalCount > 0) {
    explanation.push(`${inputs.overdueApprovalCount} approval(s) are overdue.`);
  }
  if (inputs.deliveryRiskCount > 0) {
    explanation.push(`${inputs.deliveryRiskCount} delivery risk(s) need follow-through.`);
  }
  if (inputs.missingReadyConfirmationCount > 0) {
    explanation.push(`${inputs.missingReadyConfirmationCount} job(s) are still missing ready confirmation.`);
  }
  if (inputs.jobsToday > 0 && explanation.length === 0) {
    explanation.push(`${inputs.jobsToday} job(s) are live today and tracking healthy.`);
  }
  if (explanation.length === 0) {
    explanation.push("No major operational risk is open right now.");
  }

  const state =
    inputs.criticalWatchCount > 0 || score < 45
      ? "critical"
      : inputs.highWatchCount > 0 || inputs.blockedProductionCount > 0 || score < 65
        ? "at_risk"
        : inputs.staffingGapCount > 0 || inputs.overdueApprovalCount > 0 || inputs.deliveryRiskCount > 0 || score < 82
          ? "watch"
          : "healthy";

  return {
    score,
    state,
    explanation
  };
}
