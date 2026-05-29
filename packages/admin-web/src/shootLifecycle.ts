import type { HomeWidgetTone, ShootPostProductionSubstage, ShootStatus } from "./types";

type ShootStatusOption = {
  value: ShootStatus;
  label: string;
  disabled?: boolean;
  note?: string;
};

const SHOOT_STATUS_LABELS: Record<ShootStatus, string> = {
  DRAFT: "Draft",
  TENTATIVE: "Tentative",
  CONFIRMED: "Confirmed",
  READY: "Ready",
  LIVE: "Live",
  SHOOT_COMPLETE: "Shot Complete",
  POST_PRODUCTION: "Post-Production",
  COMPLETE: "Complete",
  ON_HOLD: "On Hold",
  CANCELLED: "Cancelled"
};

export const SHOOT_POST_PRODUCTION_SUBSTAGE_LABELS: Record<ShootPostProductionSubstage, string> = {
  INTAKE_PENDING: "Intake Pending",
  ASSETS_RECEIVED: "Assets Received",
  EDITING_PROCESSING: "Editing / Processing",
  GRAPHICS_PACKAGING: "Graphics / Packaging",
  UPLOAD_DELIVERY_PREP: "Upload / Delivery Prep",
  QA_REVIEW: "QA Review",
  CORRECTION_NEEDED: "Correction Needed",
  READY_TO_RELEASE: "Ready to Release"
};

const STATUS_ALIASES: Record<string, ShootStatus> = {
  draft: "DRAFT",
  planning: "DRAFT",
  tentative: "TENTATIVE",
  confirmed: "CONFIRMED",
  scheduled: "CONFIRMED",
  staffing_in_progress: "CONFIRMED",
  staffed: "CONFIRMED",
  ready: "READY",
  ready_for_shoot: "READY",
  live: "LIVE",
  in_progress: "LIVE",
  shoot_complete: "SHOOT_COMPLETE",
  shot_complete: "SHOOT_COMPLETE",
  post_production: "POST_PRODUCTION",
  in_post_production: "POST_PRODUCTION",
  complete: "COMPLETE",
  completed: "COMPLETE",
  delivered: "COMPLETE",
  closed: "COMPLETE",
  on_hold: "ON_HOLD",
  cancelled: "CANCELLED",
  canceled: "CANCELLED"
};

const FORWARD_TRANSITIONS: Record<ShootStatus, ShootStatus[]> = {
  DRAFT: ["TENTATIVE", "CONFIRMED", "CANCELLED"],
  TENTATIVE: ["CONFIRMED", "DRAFT", "CANCELLED"],
  CONFIRMED: ["READY", "ON_HOLD", "CANCELLED"],
  READY: ["LIVE", "CONFIRMED", "ON_HOLD", "CANCELLED"],
  LIVE: ["SHOOT_COMPLETE", "ON_HOLD", "CANCELLED"],
  SHOOT_COMPLETE: ["POST_PRODUCTION", "ON_HOLD"],
  POST_PRODUCTION: ["COMPLETE", "ON_HOLD"],
  COMPLETE: [],
  ON_HOLD: [],
  CANCELLED: []
};

export function normalizeShootStatus(value?: string | null): ShootStatus | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return STATUS_ALIASES[normalized] ?? null;
}

export function getShootStatusLabel(value?: string | ShootStatus | null): string {
  const normalized = normalizeShootStatus(value ?? null);
  if (normalized) {
    return SHOOT_STATUS_LABELS[normalized];
  }
  if (!value) {
    return "Unknown";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

export function getShootStatusHomeTone(value?: string | ShootStatus | null): HomeWidgetTone {
  const normalized = normalizeShootStatus(value ?? null);
  switch (normalized) {
    case "READY":
    case "COMPLETE":
      return "good";
    case "TENTATIVE":
    case "POST_PRODUCTION":
    case "ON_HOLD":
      return "heads_up";
    case "CANCELLED":
      return "action_needed";
    default:
      return "info";
  }
}

export function normalizeShootPostProductionSubstage(value?: string | null): ShootPostProductionSubstage | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(SHOOT_POST_PRODUCTION_SUBSTAGE_LABELS, normalized)
    ? (normalized as ShootPostProductionSubstage)
    : null;
}

export function getShootPostProductionSubstageLabel(value?: string | ShootPostProductionSubstage | null): string {
  const normalized = normalizeShootPostProductionSubstage(value ?? null);
  if (normalized) {
    return SHOOT_POST_PRODUCTION_SUBSTAGE_LABELS[normalized];
  }
  if (!value) {
    return "Not set";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

export function getShootPostProductionSubstageOptions(): Array<{ value: ShootPostProductionSubstage; label: string }> {
  return (Object.entries(SHOOT_POST_PRODUCTION_SUBSTAGE_LABELS) as Array<[ShootPostProductionSubstage, string]>).map(([value, label]) => ({
    value,
    label
  }));
}

export function getAvailableShootStatusOptions(input: {
  currentStatus?: string | ShootStatus | null;
  priorActiveStatus?: string | ShootStatus | null;
  readyEligible?: boolean;
  allowCompleteReopen?: boolean;
}): ShootStatusOption[] {
  const currentStatus = normalizeShootStatus(input.currentStatus ?? null);
  const priorActiveStatus = normalizeShootStatus(input.priorActiveStatus ?? null);

  if (!currentStatus) {
    return [
      { value: "DRAFT", label: SHOOT_STATUS_LABELS.DRAFT },
      { value: "TENTATIVE", label: SHOOT_STATUS_LABELS.TENTATIVE },
      { value: "CONFIRMED", label: SHOOT_STATUS_LABELS.CONFIRMED }
    ];
  }

  if (currentStatus === "ON_HOLD") {
    const resumeOption: ShootStatusOption[] = priorActiveStatus
      ? [
          {
            value: priorActiveStatus,
            label: SHOOT_STATUS_LABELS[priorActiveStatus],
            note: "Resume to the prior active status"
          }
        ]
      : [];
    return [
      { value: "ON_HOLD", label: SHOOT_STATUS_LABELS.ON_HOLD },
      ...resumeOption
    ];
  }

  if (currentStatus === "COMPLETE") {
    const reopenOptions: ShootStatusOption[] = input.allowCompleteReopen
      ? [
          {
            value: "POST_PRODUCTION",
            label: SHOOT_STATUS_LABELS.POST_PRODUCTION,
            note: "Reopen into post-production"
          }
        ]
      : [];
    return [
      { value: "COMPLETE", label: SHOOT_STATUS_LABELS.COMPLETE },
      ...reopenOptions
    ];
  }

  if (currentStatus === "CANCELLED") {
    return [{ value: "CANCELLED", label: SHOOT_STATUS_LABELS.CANCELLED }];
  }

  return [
    { value: currentStatus, label: SHOOT_STATUS_LABELS[currentStatus] },
    ...FORWARD_TRANSITIONS[currentStatus].map((status) => ({
      value: status,
      label: SHOOT_STATUS_LABELS[status],
      disabled: status === "READY" && input.readyEligible === false,
      note: status === "READY" && input.readyEligible === false ? "Readiness checklist still has blockers" : undefined
    }))
  ];
}

export function shouldRequireShootStatusReason(input: {
  currentStatus?: string | ShootStatus | null;
  nextStatus?: string | ShootStatus | null;
}): boolean {
  const currentStatus = normalizeShootStatus(input.currentStatus ?? null);
  const nextStatus = normalizeShootStatus(input.nextStatus ?? null);
  if (!currentStatus || !nextStatus || currentStatus === nextStatus) {
    return false;
  }
  return nextStatus === "ON_HOLD" || nextStatus === "CANCELLED" || currentStatus === "COMPLETE";
}

export function getShootStatusReasonLabel(input: {
  currentStatus?: string | ShootStatus | null;
  nextStatus?: string | ShootStatus | null;
}): string {
  const currentStatus = normalizeShootStatus(input.currentStatus ?? null);
  const nextStatus = normalizeShootStatus(input.nextStatus ?? null);
  if (currentStatus === "COMPLETE" && nextStatus && nextStatus !== "COMPLETE") {
    return "Reopen reason";
  }
  if (nextStatus === "ON_HOLD") {
    return "Hold reason";
  }
  if (nextStatus === "CANCELLED") {
    return "Cancellation reason";
  }
  return "Status note";
}

export function getShootLifecycleGuidance(input: {
  currentStatus?: string | ShootStatus | null;
  nextStatus?: string | ShootStatus | null;
  readyEligible?: boolean;
  postProductionSubstage?: string | ShootPostProductionSubstage | null;
}): string {
  const currentStatus = normalizeShootStatus(input.currentStatus ?? null);
  const nextStatus = normalizeShootStatus(input.nextStatus ?? null);

  if (!currentStatus || !nextStatus || currentStatus === nextStatus) {
    if (nextStatus === "POST_PRODUCTION") {
      return input.postProductionSubstage
        ? `Post-production is active in ${getShootPostProductionSubstageLabel(input.postProductionSubstage)}.`
        : "Choose the active post-production stage so the handoff is visible.";
    }
    if (nextStatus === "CONFIRMED" && input.readyEligible === false) {
      return "Confirmed shoots stay visible for staffing, prep, and readiness tracking until they earn a manual Ready confirmation.";
    }
    return "Use the primary status for lifecycle progress and flags for operational issues.";
  }

  if (nextStatus === "READY") {
    return input.readyEligible
      ? "This shoot is Ready Eligible. A leadership or operations user can give it the final green light."
      : "This shoot is not Ready Eligible yet. Finish the readiness checklist before moving it to Ready.";
  }
  if (nextStatus === "LIVE") {
    return "Live should reflect real day-of execution. Use it when the shoot is actually underway or a valid on-site signal supports the start.";
  }
  if (nextStatus === "SHOOT_COMPLETE") {
    return "Shot Complete means on-site capture has ended, even if production follow-through still remains.";
  }
  if (nextStatus === "POST_PRODUCTION") {
    return "Post-Production tracks the downstream editing, QA, packaging, and delivery path after capture is finished.";
  }
  if (nextStatus === "COMPLETE") {
    return "Complete should only be used after required production milestones are done and an authorized user signs off.";
  }
  if (nextStatus === "ON_HOLD") {
    return "On Hold pauses the shoot temporarily and preserves the prior active status for a clean resume.";
  }
  if (nextStatus === "CANCELLED") {
    return "Cancelled is treated as a terminal state for most users.";
  }

  return `${getShootStatusLabel(currentStatus)} can move to ${getShootStatusLabel(nextStatus)} when the next operational handoff is trustworthy.`;
}
