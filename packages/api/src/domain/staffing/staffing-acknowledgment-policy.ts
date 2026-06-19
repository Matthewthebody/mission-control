// Centralized acknowledgment-deadline policy for published staffing assignments.
// ALL acknowledgment timing lives here — do NOT scatter these constants through
// routes, workers, selectors, or UI. See docs/staffing-publish-ack-lifecycle-design.md §1.
//
// A freshly published, still-pending assignment is "Awaiting Acknowledgment" — visible
// but NOT urgent. It only becomes a Needs-Attention / urgent-watch issue once the
// acknowledgment deadline passes OR the shoot enters the escalation window while pending.

export type StaffingAcknowledgmentPolicy = {
  /** Hours after publish before a still-pending assignment is considered overdue. */
  ackWindowHours: number;
  /** Hours before the shoot within which a still-pending assignment escalates. */
  escalationWindowHours: number;
  /** Short grace period after publish before "awaiting acknowledgment" starts counting. */
  gracePeriodMinutes: number;
};

export const DEFAULT_STAFFING_ACKNOWLEDGMENT_POLICY: StaffingAcknowledgmentPolicy = {
  ackWindowHours: 48,
  escalationWindowHours: 72,
  gracePeriodMinutes: 15
};

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

type TimeInput = Date | string | number | null | undefined;

function toEpochMs(value: TimeInput): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The acknowledgment deadline for a newly-published (or materially-changed) recipient:
 * publishedAt + ackWindow, never later than the shoot start.
 */
export function computeAcknowledgmentDueAt(
  publishedAt: Date | string | number,
  shootStartAt: TimeInput,
  policy: StaffingAcknowledgmentPolicy = DEFAULT_STAFFING_ACKNOWLEDGMENT_POLICY
): Date | null {
  const publishedMs = toEpochMs(publishedAt);
  if (publishedMs === null) {
    return null;
  }
  const byWindow = publishedMs + policy.ackWindowHours * MS_PER_HOUR;
  const shootMs = toEpochMs(shootStartAt);
  const dueMs = shootMs !== null && shootMs < byWindow ? shootMs : byWindow;
  return new Date(dueMs);
}

/**
 * The effective publication grace boundary: publishedAt + gracePeriod, but NEVER later than the
 * shoot start. A publication less than gracePeriod before the shoot therefore has its grace capped
 * at the shoot start (grace never extends beyond the shoot).
 */
export function publicationGraceBoundary(
  publishedAt: TimeInput,
  shootStartAt: TimeInput,
  policy: StaffingAcknowledgmentPolicy = DEFAULT_STAFFING_ACKNOWLEDGMENT_POLICY
): Date | null {
  const publishedMs = toEpochMs(publishedAt);
  if (publishedMs === null) {
    return null;
  }
  const base = publishedMs + policy.gracePeriodMinutes * MS_PER_MINUTE;
  const shootMs = toEpochMs(shootStartAt);
  const boundaryMs = shootMs !== null && shootMs < base ? shootMs : base;
  return new Date(boundaryMs);
}

/** Current time has reached the effective grace boundary, so urgency may begin to apply. */
export function isPastPublicationGrace(
  publishedAt: TimeInput,
  now: Date | string | number,
  shootStartAt: TimeInput = null,
  policy: StaffingAcknowledgmentPolicy = DEFAULT_STAFFING_ACKNOWLEDGMENT_POLICY
): boolean {
  const boundary = publicationGraceBoundary(publishedAt, shootStartAt, policy);
  const nowMs = toEpochMs(now);
  if (boundary === null || nowMs === null) {
    return true;
  }
  return nowMs >= boundary.getTime();
}

/** The acknowledgment deadline has passed. */
export function isAcknowledgmentOverdue(dueAt: TimeInput, now: Date | string | number): boolean {
  const dueMs = toEpochMs(dueAt);
  const nowMs = toEpochMs(now);
  if (dueMs === null || nowMs === null) {
    return false;
  }
  return nowMs >= dueMs;
}

/** The shoot is inside the escalation window (and still in the future). */
export function isWithinEscalationWindow(
  shootStartAt: TimeInput,
  now: Date | string | number,
  policy: StaffingAcknowledgmentPolicy = DEFAULT_STAFFING_ACKNOWLEDGMENT_POLICY
): boolean {
  const shootMs = toEpochMs(shootStartAt);
  const nowMs = toEpochMs(now);
  if (shootMs === null || nowMs === null) {
    return false;
  }
  return shootMs > nowMs && shootMs - nowMs <= policy.escalationWindowHours * MS_PER_HOUR;
}

/**
 * A pending assignment is "not acknowledged" (a Needs-Attention / urgent issue) only once
 * the deadline has passed OR the shoot enters the escalation window. Anything not currently
 * pending (acknowledged / declined / canceled) is never "not acknowledged".
 */
export type AcknowledgmentUrgency = {
  responseStatus: string;
  /** Whether this pending assignment is a not_acknowledged urgent issue right now. */
  urgent: boolean;
  /**
   * Data-integrity flag: a pending assignment with no resolvable publication time. An unpublished
   * plan simply has no acknowledgment obligation; a CURRENT recipient that hits this is a data
   * anomaly the caller should surface/log. Either way the assignment is treated as NOT urgent and is
   * never inferred to be overdue.
   */
  missingPublicationTime: boolean;
};

/**
 * Evaluate the acknowledgment urgency of one recipient. A pending assignment is urgent only when it
 * has a resolvable publication time, is past the effective grace boundary, and is either overdue or
 * inside the escalation window. A null/unparseable publishedAt means no acknowledgment obligation —
 * not urgent, and flagged via missingPublicationTime for the caller to diagnose current recipients.
 */
export function evaluateAcknowledgmentUrgency(
  args: {
    responseStatus: string;
    publishedAt: TimeInput;
    dueAt: TimeInput;
    shootStartAt: TimeInput;
    now: Date | string | number;
  },
  policy: StaffingAcknowledgmentPolicy = DEFAULT_STAFFING_ACKNOWLEDGMENT_POLICY
): AcknowledgmentUrgency {
  // Only a pending assignment can be "not acknowledged" (declined is a separate, immediate risk).
  if (args.responseStatus !== "pending") {
    return { responseStatus: args.responseStatus, urgent: false, missingPublicationTime: false };
  }
  // No resolvable publication time -> no acknowledgment obligation; never infer a deadline / overdue.
  if (toEpochMs(args.publishedAt) === null) {
    return { responseStatus: args.responseStatus, urgent: false, missingPublicationTime: true };
  }
  const urgent =
    // During the post-publication grace period it is "Awaiting Acknowledgment" — visible, not urgent.
    isPastPublicationGrace(args.publishedAt, args.now, args.shootStartAt, policy) &&
    (isAcknowledgmentOverdue(args.dueAt, args.now) ||
      isWithinEscalationWindow(args.shootStartAt, args.now, policy));
  return { responseStatus: args.responseStatus, urgent, missingPublicationTime: false };
}

/**
 * A pending assignment is "not acknowledged" (a Needs-Attention / urgent issue) per
 * evaluateAcknowledgmentUrgency. Anything not currently pending — and any pending assignment without
 * a resolvable publication time — is never "not acknowledged".
 */
export function isPendingNotAcknowledged(
  args: {
    responseStatus: string;
    publishedAt: TimeInput;
    dueAt: TimeInput;
    shootStartAt: TimeInput;
    now: Date | string | number;
  },
  policy: StaffingAcknowledgmentPolicy = DEFAULT_STAFFING_ACKNOWLEDGMENT_POLICY
): boolean {
  return evaluateAcknowledgmentUrgency(args, policy).urgent;
}
