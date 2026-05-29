export type ShootImportanceTier = "standard" | "elevated" | "big_shoot" | "critical_shoot";
export type ShootPriorityLabel = ShootImportanceTier | "high_priority";
export type ShootProfitabilityFlag = "favorable" | "neutral" | "watch" | "needs_review";

type ScoreBand = {
  minimum: number;
  label: ShootImportanceTier;
};

type ReasonChip = {
  key: string;
  label: string;
  detail: string;
};

type HardTrigger = ReasonChip & {
  active: boolean;
};

export type ShootPriorityInput = {
  projectedHeadcount?: number | null;
  photographerHeadcount?: number | null;
  assignedStaffCount?: number | null;
  plannedStaffCount?: number | null;
  estimatedDriveMinutes?: number | null;
  cameraStationCount?: number | null;
  shootStructure?: "standard" | "open_house" | null;
  hasSpecialtyRequirements?: boolean | null;
  firstYearCustomerFlag?: boolean | null;
  flagshipPriorityAccountFlag?: boolean | null;
  strategicDistrictImportance?: boolean | null;
  revenuePotentialScore?: number | null;
  accountGrowthImportanceScore?: number | null;
  complexityScore?: number | null;
  customerHistoryRiskScore?: number | null;
  priorMajorIssueExists?: boolean | null;
  multiTeamCoordination?: boolean | null;
  missingStaffingCoverageCount?: number | null;
  missingRequiredPrepCount?: number | null;
  weatherTravelRiskFlag?: boolean | null;
  manualLeadershipBoost?: number | null;
  futureProfitabilityManual?: ShootProfitabilityFlag | null;
  operationsPriority?: Exclude<ShootPriorityLabel, "big_shoot" | "critical_shoot"> | null;
  manualBigShootOverride?: boolean | null;
  importanceOverrideTier?: ShootImportanceTier | null;
  importanceOverrideReason?: string | null;
};

export type ShootPriorityResult = {
  weightedScore: number;
  calculatedLabel: ShootImportanceTier;
  priorityLabel: ShootImportanceTier;
  hardTriggerCount: number;
  hardTriggers: HardTrigger[];
  reasons: ReasonChip[];
  override: {
    applied: boolean;
    label: ShootImportanceTier | null;
    reason: string | null;
    source: "manual_override" | "legacy_big_shoot" | null;
  };
  profitability: {
    systemFlag: ShootProfitabilityFlag;
    finalFlag: ShootProfitabilityFlag;
    manualOverride: ShootProfitabilityFlag | null;
    needsReview: boolean;
    explanation: string;
  };
};

export type BigShootReadinessResult = {
  readinessStatus: "on_track" | "needs_attention" | "at_risk";
  readinessLabel: "On Track" | "Needs Attention" | "At Risk";
  reason: string;
  checklist: Array<{
    key: string;
    label: string;
    state: "ready" | "watch" | "missing";
  }>;
  prepReminders: Array<{
    key: "t_minus_14" | "t_minus_7" | "t_minus_3" | "day_before";
    label: string;
    dueDate: string;
    due: boolean;
  }>;
  nextPrepReminder:
    | {
        key: "t_minus_14" | "t_minus_7" | "t_minus_3" | "day_before";
        label: string;
        dueDate: string;
        due: boolean;
      }
    | null;
};

export const SHOOT_PRIORITY_DEFAULTS = {
  hardTriggerThresholds: {
    projectedHeadcount: 500,
    totalStaffCount: 6,
    cameraStations: 4,
    travelMinutes: 60,
    missingPrepCount: 3
  },
  maxManualLeadershipBoost: 15,
  scoreBands: [
    { minimum: 85, label: "critical_shoot" },
    { minimum: 65, label: "big_shoot" },
    { minimum: 40, label: "elevated" },
    { minimum: 0, label: "standard" }
  ] satisfies ScoreBand[]
} as const;

function clampPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Number(value)));
}

function clampScore(value: number | null | undefined, maximum: number) {
  if (value == null || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(maximum, Number(value)));
}

function manualBoostFromLegacyPriority(
  value: Exclude<ShootPriorityLabel, "big_shoot" | "critical_shoot"> | null | undefined
) {
  if (value === "high_priority") {
    return 10;
  }
  if (value === "elevated") {
    return 5;
  }
  return 0;
}

function scoreHeadcount(value: number | null | undefined) {
  const safeValue = Number(value ?? 0);
  if (safeValue >= 800) {
    return 12;
  }
  if (safeValue >= 500) {
    return 10;
  }
  if (safeValue >= 300) {
    return 8;
  }
  if (safeValue >= 150) {
    return 5;
  }
  if (safeValue >= 80) {
    return 3;
  }
  return 0;
}

function scoreStaffingComplexity(value: number | null | undefined) {
  const safeValue = Number(value ?? 0);
  if (safeValue >= 8) {
    return 8;
  }
  if (safeValue >= 6) {
    return 6;
  }
  if (safeValue >= 4) {
    return 4;
  }
  if (safeValue >= 3) {
    return 2;
  }
  return 0;
}

function scoreCameraStations(value: number | null | undefined) {
  const safeValue = Number(value ?? 0);
  if (safeValue >= 5) {
    return 6;
  }
  if (safeValue >= 4) {
    return 5;
  }
  if (safeValue >= 3) {
    return 4;
  }
  if (safeValue >= 2) {
    return 2;
  }
  return 0;
}

function scoreMissingStaffingCoverage(value: number | null | undefined) {
  const safeValue = Math.max(0, Number(value ?? 0));
  if (safeValue >= 4) {
    return 12;
  }
  if (safeValue >= 3) {
    return 10;
  }
  if (safeValue >= 2) {
    return 8;
  }
  if (safeValue >= 1) {
    return 4;
  }
  return 0;
}

function scoreMissingPrep(value: number | null | undefined) {
  const safeValue = Math.max(0, Number(value ?? 0));
  if (safeValue >= 4) {
    return 10;
  }
  if (safeValue >= 3) {
    return 8;
  }
  if (safeValue >= 2) {
    return 6;
  }
  if (safeValue >= 1) {
    return 3;
  }
  return 0;
}

function scoreCustomerVisibility(input: ShootPriorityInput) {
  if (input.flagshipPriorityAccountFlag || input.strategicDistrictImportance) {
    return 10;
  }
  const growthScore = Number(input.accountGrowthImportanceScore ?? 0);
  if (growthScore >= 80) {
    return 8;
  }
  if (growthScore >= 60) {
    return 6;
  }
  if (growthScore >= 40) {
    return 4;
  }
  return 0;
}

function scoreOperationalComplexity(value: number | null | undefined) {
  const safeValue = Number(value ?? 0);
  if (safeValue >= 85) {
    return 8;
  }
  if (safeValue >= 70) {
    return 6;
  }
  if (safeValue >= 55) {
    return 4;
  }
  if (safeValue >= 40) {
    return 2;
  }
  return 0;
}

function scoreOperationalFragility(input: ShootPriorityInput) {
  if (input.multiTeamCoordination) {
    return 6;
  }
  if (input.hasSpecialtyRequirements) {
    return 4;
  }
  return 0;
}

function scoreIssueHistory(value: number | null | undefined, priorMajorIssueExists: boolean | null | undefined) {
  if (priorMajorIssueExists) {
    return 10;
  }
  const safeValue = Number(value ?? 0);
  if (safeValue >= 80) {
    return 8;
  }
  if (safeValue >= 60) {
    return 6;
  }
  if (safeValue >= 40) {
    return 3;
  }
  return 0;
}

function scoreWeatherTravelRisk(input: ShootPriorityInput) {
  if (input.weatherTravelRiskFlag) {
    return 6;
  }
  const driveMinutes = Number(input.estimatedDriveMinutes ?? 0);
  if (driveMinutes >= 90) {
    return 6;
  }
  if (driveMinutes >= 60) {
    return 4;
  }
  if (driveMinutes >= 45) {
    return 2;
  }
  return 0;
}

function mapScoreToBand(score: number) {
  const band = SHOOT_PRIORITY_DEFAULTS.scoreBands.find((entry) => score >= entry.minimum);
  return band?.label ?? "standard";
}

export function importanceRank(value: ShootPriorityLabel) {
  switch (value) {
    case "critical_shoot":
      return 4;
    case "big_shoot":
      return 3;
    case "high_priority":
      return 2;
    case "elevated":
      return 1;
    default:
      return 0;
  }
}

export function isBigShootLabel(value: ShootPriorityLabel | null | undefined) {
  return value === "big_shoot" || value === "critical_shoot";
}

function weightedLabel(input: ShootPriorityInput) {
  const activeStaffCount = Math.max(Number(input.assignedStaffCount ?? 0), Number(input.plannedStaffCount ?? 0));
  const manualLeadershipBoost = Math.max(
    clampScore(input.manualLeadershipBoost, SHOOT_PRIORITY_DEFAULTS.maxManualLeadershipBoost),
    manualBoostFromLegacyPriority(input.operationsPriority)
  );

  const components = {
    headcount: scoreHeadcount(input.projectedHeadcount),
    staffingComplexity: scoreStaffingComplexity(activeStaffCount),
    cameraStations: scoreCameraStations(input.cameraStationCount),
    shootStructure: input.shootStructure === "open_house" ? 6 : 0,
    specialtyRequirements: input.hasSpecialtyRequirements ? 8 : 0,
    firstYearCustomer: input.firstYearCustomerFlag ? 6 : 0,
    customerVisibility: scoreCustomerVisibility(input),
    operationalComplexity: scoreOperationalComplexity(input.complexityScore),
    operationalFragility: scoreOperationalFragility(input),
    priorIssueHistory: scoreIssueHistory(input.customerHistoryRiskScore, input.priorMajorIssueExists),
    missingStaffingCoverage: scoreMissingStaffingCoverage(input.missingStaffingCoverageCount),
    missingRequiredPrep: scoreMissingPrep(input.missingRequiredPrepCount),
    weatherTravelRisk: scoreWeatherTravelRisk(input),
    manualLeadershipBoost
  };

  const total = Math.max(
    0,
    Math.min(
      100,
      Number(
        Object.values(components)
          .reduce((sum, value) => sum + value, 0)
          .toFixed(1)
      )
    )
  );

  return {
    weightedScore: total,
    manualLeadershipBoost,
    baseLabel: mapScoreToBand(total)
  };
}

function buildHardTriggers(input: ShootPriorityInput): HardTrigger[] {
  const activeStaffCount = Math.max(Number(input.assignedStaffCount ?? 0), Number(input.plannedStaffCount ?? 0));
  const cameraStationCount = Number(input.cameraStationCount ?? 0);
  const missingPrepCount = Math.max(0, Number(input.missingRequiredPrepCount ?? 0));
  const missingStaffingCount = Math.max(0, Number(input.missingStaffingCoverageCount ?? 0));
  const driveMinutes = Number(input.estimatedDriveMinutes ?? 0);

  return [
    {
      key: "headcount",
      label: "High Headcount",
      detail: `Expected headcount is ${Number(input.projectedHeadcount ?? 0).toLocaleString()}, which is well above the standard prep baseline.`,
      active: Number(input.projectedHeadcount ?? 0) >= SHOOT_PRIORITY_DEFAULTS.hardTriggerThresholds.projectedHeadcount
    },
    {
      key: "staffing_complexity",
      label: "Heavy Staffing",
      detail: "Staffing demand is unusually high for this shoot.",
      active: activeStaffCount >= SHOOT_PRIORITY_DEFAULTS.hardTriggerThresholds.totalStaffCount
    },
    {
      key: "camera_stations",
      label: "Multi-Station Setup",
      detail: "Camera coverage requires multiple stations or parallel lanes.",
      active: cameraStationCount >= SHOOT_PRIORITY_DEFAULTS.hardTriggerThresholds.cameraStations
    },
    {
      key: "structure",
      label: "Open House Flow",
      detail: "Open house structure adds day-of coordination risk and customer visibility.",
      active: input.shootStructure === "open_house"
    },
    {
      key: "customer_importance",
      label: "Priority Account",
      detail: "This shoot carries added customer visibility or account importance.",
      active: Boolean(input.flagshipPriorityAccountFlag || input.strategicDistrictImportance || input.firstYearCustomerFlag)
    },
    {
      key: "prior_issues",
      label: "Prior Issues",
      detail: "Prior issue history means the team should expect tighter operational guardrails.",
      active: Boolean(input.priorMajorIssueExists)
    },
    {
      key: "staffing_gap",
      label: "Coverage Gap",
      detail:
        missingStaffingCount > 0
          ? `${missingStaffingCount} staffing slot${missingStaffingCount === 1 ? "" : "s"} are still uncovered.`
          : "Coverage is complete.",
      active: missingStaffingCount > 0
    },
    {
      key: "prep_gap",
      label: "Prep Incomplete",
      detail:
        missingPrepCount > 0
          ? `${missingPrepCount} required prep item${missingPrepCount === 1 ? "" : "s"} are still missing.`
          : "Prep inputs are covered.",
      active: missingPrepCount >= SHOOT_PRIORITY_DEFAULTS.hardTriggerThresholds.missingPrepCount
    },
    {
      key: "travel_risk",
      label: "Travel Risk",
      detail:
        input.weatherTravelRiskFlag || driveMinutes >= SHOOT_PRIORITY_DEFAULTS.hardTriggerThresholds.travelMinutes
          ? "Travel or weather risk could tighten the operating margin on this shoot."
          : "Travel profile is within the normal operating range.",
      active: Boolean(input.weatherTravelRiskFlag) || driveMinutes >= SHOOT_PRIORITY_DEFAULTS.hardTriggerThresholds.travelMinutes
    }
  ];
}

function buildReasons(
  input: ShootPriorityInput,
  weightedScore: number,
  hardTriggers: HardTrigger[],
  manualLeadershipBoost: number
): ReasonChip[] {
  const reasons: ReasonChip[] = [];
  const activeTriggerKeys = new Set(hardTriggers.filter((trigger) => trigger.active).map((trigger) => trigger.key));

  for (const trigger of hardTriggers) {
    if (trigger.active) {
      reasons.push({
        key: trigger.key,
        label: trigger.label,
        detail: trigger.detail
      });
    }
  }

  if (manualLeadershipBoost > 0) {
    reasons.push({
      key: "leadership_boost",
      label: "Leadership Boost",
      detail: `Leadership added ${manualLeadershipBoost} manual importance point${manualLeadershipBoost === 1 ? "" : "s"} to keep this shoot more visible.`
    });
  }

  if (!activeTriggerKeys.has("customer_importance") && input.firstYearCustomerFlag) {
    reasons.push({
      key: "first_year_customer",
      label: "First-Year Customer",
      detail: "First-year customers get a tighter watch until the team has a stable operating rhythm."
    });
  }
  if (!activeTriggerKeys.has("customer_importance") && (input.flagshipPriorityAccountFlag || input.strategicDistrictImportance)) {
    reasons.push({
      key: "flagship_account",
      label: "Priority Account",
      detail: "Account visibility is high enough that mistakes would carry outsized business cost."
    });
  }
  if (scoreOperationalComplexity(input.complexityScore) > 0) {
    reasons.push({
      key: "deliverable_complexity",
      label: "Deliverable Complexity",
      detail: "Deliverables or workflow complexity make this shoot harder to recover when something slips."
    });
  }
  if (!input.priorMajorIssueExists && scoreIssueHistory(input.customerHistoryRiskScore, false) > 0) {
    reasons.push({
      key: "issue_history_watch",
      label: "Issue History Watch",
      detail: "Recent issue history suggests this shoot should carry extra operational attention."
    });
  }
  if (!activeTriggerKeys.has("structure") && Boolean(input.multiTeamCoordination || input.hasSpecialtyRequirements)) {
    reasons.push({
      key: "specialty_requirements",
      label: "Specialty Requirements",
      detail: "Special products, setup requirements, or multi-team coordination make this shoot less forgiving."
    });
  }
  if (!activeTriggerKeys.has("travel_risk") && Number(input.estimatedDriveMinutes ?? 0) >= 45) {
    reasons.push({
      key: "travel_watch",
      label: "Travel Watch",
      detail: "Travel time is high enough to shrink day-of recovery time."
    });
  }
  if (!reasons.length && weightedScore >= 40) {
    reasons.push({
      key: "elevated_mix",
      label: "Elevated Mix",
      detail: "A mix of size, staffing, prep risk, and customer visibility lifts this shoot above the standard baseline."
    });
  }

  return reasons.slice(0, 6);
}

function computeProfitability(input: ShootPriorityInput): ShootPriorityResult["profitability"] {
  const requiredInputsPresent =
    input.revenuePotentialScore != null &&
    input.plannedStaffCount != null &&
    input.estimatedDriveMinutes != null &&
    input.complexityScore != null;

  let systemFlag: ShootProfitabilityFlag = "needs_review";
  let explanation = "Required business inputs are incomplete, so the operational profitability signal needs review.";

  if (requiredInputsPresent) {
    const revenue = clampPercent(input.revenuePotentialScore);
    const staffingPressure = Math.max(0, Number(input.plannedStaffCount ?? 0)) /
      Math.max(SHOOT_PRIORITY_DEFAULTS.hardTriggerThresholds.totalStaffCount, 1);
    const travelPressure = Math.max(0, Number(input.estimatedDriveMinutes ?? 0)) /
      Math.max(SHOOT_PRIORITY_DEFAULTS.hardTriggerThresholds.travelMinutes, 1);
    const complexityPressure = clampPercent(input.complexityScore) / 100;
    const frictionPressure = Math.max(
      clampPercent(input.customerHistoryRiskScore) / 100,
      input.priorMajorIssueExists ? 0.75 : 0
    );

    if (
      revenue >= 70 &&
      staffingPressure < 0.7 &&
      travelPressure < 0.7 &&
      complexityPressure < 0.55 &&
      frictionPressure < 0.55
    ) {
      systemFlag = "favorable";
      explanation = "Revenue potential is strong and the current travel, staffing, and complexity profile stays in a healthy operating range.";
    } else if (
      staffingPressure >= 1 ||
      travelPressure >= 1 ||
      complexityPressure >= 0.75 ||
      frictionPressure >= 0.7
    ) {
      systemFlag = "watch";
      explanation = "Staffing, travel, complexity, or prior friction makes this shoot worth closer economic review before treating it as a clean win.";
    } else {
      systemFlag = "neutral";
      explanation = "The current revenue and operating-demand mix is mixed enough that this shoot reads as operationally neutral for now.";
    }
  }

  return {
    systemFlag,
    finalFlag: input.futureProfitabilityManual ?? systemFlag,
    manualOverride: input.futureProfitabilityManual ?? null,
    needsReview: systemFlag === "needs_review",
    explanation
  };
}

export function evaluateShootPriority(input: ShootPriorityInput): ShootPriorityResult {
  const weighted = weightedLabel(input);
  const hardTriggers = buildHardTriggers(input);
  const hardTriggerCount = hardTriggers.filter((trigger) => trigger.active).length;
  let calculatedLabel = weighted.baseLabel;

  if (hardTriggerCount >= 4 && importanceRank(calculatedLabel) < importanceRank("critical_shoot") && weighted.weightedScore >= 65) {
    calculatedLabel = "critical_shoot";
  } else if (hardTriggerCount >= 3 && calculatedLabel === "elevated") {
    calculatedLabel = "big_shoot";
  }

  const overrideTier =
    input.importanceOverrideTier ?? (input.manualBigShootOverride ? "big_shoot" : null);
  const overrideReason =
    input.importanceOverrideReason?.trim() ||
    (input.manualBigShootOverride ? "Legacy leadership big-shoot override." : null);
  const overrideSource = input.importanceOverrideTier
    ? "manual_override"
    : input.manualBigShootOverride
      ? "legacy_big_shoot"
      : null;

  const priorityLabel = overrideTier ?? calculatedLabel;
  const reasons = buildReasons(input, weighted.weightedScore, hardTriggers, weighted.manualLeadershipBoost);

  if (overrideTier) {
    reasons.unshift({
      key: "importance_override",
      label: "Manual Override",
      detail:
        overrideSource === "legacy_big_shoot"
          ? "A legacy leadership override keeps this shoot visible as a big shoot."
          : `Leadership manually set this shoot to ${humanizePriorityLabel(overrideTier)}${overrideReason ? `: ${overrideReason}` : "."}`
    });
  }

  return {
    weightedScore: weighted.weightedScore,
    calculatedLabel,
    priorityLabel,
    hardTriggerCount,
    hardTriggers,
    reasons: reasons.slice(0, 6),
    override: {
      applied: Boolean(overrideTier),
      label: overrideTier,
      reason: overrideReason,
      source: overrideSource
    },
    profitability: computeProfitability(input)
  };
}

function formatDateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number) {
  const next = new Date(value.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

export function buildBigShootReadiness(input: {
  shootDate: string | null | undefined;
  priorityLabel: ShootPriorityLabel;
  missingFields: string[];
  underStaffed: boolean;
  missingLead: boolean;
  openAlertCount?: number | null;
  conflictWarningCount?: number | null;
  todayDate?: string;
}): BigShootReadinessResult {
  const anchorDate = input.todayDate ? new Date(`${input.todayDate}T12:00:00`) : new Date();
  anchorDate.setHours(12, 0, 0, 0);
  const shootDate = input.shootDate ? new Date(`${input.shootDate}T12:00:00`) : anchorDate;
  const prepReminders = [
    { key: "t_minus_14" as const, label: "T-14 Prep", dueDate: formatDateOnly(addDays(shootDate, -14)) },
    { key: "t_minus_7" as const, label: "T-7 Prep", dueDate: formatDateOnly(addDays(shootDate, -7)) },
    { key: "t_minus_3" as const, label: "T-3 Prep", dueDate: formatDateOnly(addDays(shootDate, -3)) },
    { key: "day_before" as const, label: "Day-Before Prep", dueDate: formatDateOnly(addDays(shootDate, -1)) }
  ].map((reminder) => ({
    ...reminder,
    due: new Date(`${reminder.dueDate}T12:00:00`).getTime() <= anchorDate.getTime()
  }));

  const checklist = [
    {
      key: "lead",
      label: "Lead coverage confirmed",
      state: input.missingLead ? "missing" : "ready"
    },
    {
      key: "staffing",
      label: "Staffing plan covered",
      state: input.underStaffed ? "watch" : "ready"
    },
    {
      key: "data",
      label: "Core shoot data complete",
      state: input.missingFields.length ? "missing" : "ready"
    },
    {
      key: "alerts",
      label: "Open alerts reviewed",
      state: Number(input.openAlertCount ?? 0) > 0 ? "watch" : "ready"
    },
    {
      key: "conflicts",
      label: "Staffing conflicts resolved",
      state: Number(input.conflictWarningCount ?? 0) > 0 ? "watch" : "ready"
    }
  ] as const;

  let readinessStatus: BigShootReadinessResult["readinessStatus"] = "on_track";
  let readinessLabel: BigShootReadinessResult["readinessLabel"] = "On Track";
  let reason = "Prep posture is currently healthy.";

  const bigOrCritical = isBigShootLabel(input.priorityLabel);
  const criticalShoot = input.priorityLabel === "critical_shoot";

  if (
    input.missingLead ||
    input.missingFields.length >= 2 ||
    Number(input.openAlertCount ?? 0) >= 2 ||
    (criticalShoot && (input.underStaffed || input.missingFields.length > 0 || Number(input.conflictWarningCount ?? 0) > 0))
  ) {
    readinessStatus = "at_risk";
    readinessLabel = "At Risk";
    reason = input.missingLead
      ? "Lead-qualified coverage is still open."
      : criticalShoot && input.underStaffed
        ? "Critical shoot still has uncovered staffing and should be escalated now."
        : criticalShoot && input.missingFields.length > 0
          ? `Critical shoot still has prep data missing: ${input.missingFields.join(", ")}.`
          : input.missingFields.length >= 2
            ? `Important prep data is still missing: ${input.missingFields.join(", ")}.`
            : "Multiple open alerts are still attached to this shoot.";
  } else if (
    bigOrCritical &&
    (input.underStaffed ||
      input.missingFields.length > 0 ||
      Number(input.conflictWarningCount ?? 0) > 0 ||
      Number(input.openAlertCount ?? 0) > 0)
  ) {
    readinessStatus = "needs_attention";
    readinessLabel = "Needs Attention";
    reason = input.underStaffed
      ? "Coverage is still short for this flagged shoot."
      : input.missingFields.length
        ? `Prep detail still needs review: ${input.missingFields.join(", ")}.`
        : "A conflict or open alert still needs review before the shoot is fully ready.";
  }

  return {
    readinessStatus,
    readinessLabel,
    reason,
    checklist: checklist.map((item) => ({ ...item })),
    prepReminders,
    nextPrepReminder: prepReminders.find((reminder) => !reminder.due) ?? prepReminders[prepReminders.length - 1] ?? null
  };
}

export function humanizePriorityLabel(value: ShootPriorityLabel) {
  switch (value) {
    case "critical_shoot":
      return "Critical Shoot";
    case "big_shoot":
      return "Big Shoot";
    case "high_priority":
      return "High Priority";
    case "elevated":
      return "Elevated";
    default:
      return "Standard";
  }
}

export function humanizeProfitabilityFlag(value: ShootProfitabilityFlag) {
  switch (value) {
    case "favorable":
      return "Favorable";
    case "watch":
      return "Watch";
    case "needs_review":
      return "Needs Review";
    default:
      return "Neutral";
  }
}
