import { createHash } from "node:crypto";

// Deterministic content hashing for staffing publish versioning.
// - plan_hash (per shoot): determines whether a new published VERSION exists.
// - recipient_hash (per employee): determines whether THAT employee must re-acknowledge.
//
// Only MATERIAL fields are hashed; arrays are normalized to a stable order; timestamps are
// collapsed to a single canonical instant so source-offset / property-order differences never
// produce a spurious re-acknowledgment. Excluded: display labels, internal-only notes, reads,
// UI state, and any other employee's assignments. See docs/staffing-publish-ack-lifecycle-design.md §4.

export type RecipientAssignmentInput = {
  /** Canonical slot / requirement identity (preferred over any display label). */
  requirementId?: string | null;
  shiftId?: string | null;
  staffingRole?: string | null;
  satisfiesLeadCoverage?: boolean | null;
  startsAt?: string | null;
  endsAt?: string | null;
  /** Call / setup time (shoot arrival) presented to the employee. */
  callTime?: string | null;
  /** Employee-facing instructions (NOT internal-only notes). */
  instructions?: string | null;
};

export type RecipientPackageInput = {
  employeeUserId: string;
  shootDate?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  assignments: RecipientAssignmentInput[];
};

export type NormalizedRecipientAssignment = {
  requirement_id: string | null;
  shift_id: string | null;
  staffing_role: string | null;
  satisfies_lead_coverage: boolean;
  starts_at: string | null;
  ends_at: string | null;
  call_time: string | null;
  instructions: string | null;
};

export type NormalizedRecipientPackage = {
  employee_user_id: string;
  shoot_date: string | null;
  location_name: string | null;
  location_address: string | null;
  assignments: NormalizedRecipientAssignment[];
};

export type NormalizedPlan = {
  shoot_id: string;
  shoot_date: string | null;
  recipients: Array<{ employee_user_id: string; recipient_hash: string }>;
};

export type PlanInput = {
  shootId: string;
  shootDate?: string | null;
  recipients: RecipientPackageInput[];
};

function normalizeText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

/**
 * Collapse a timestamp to one canonical instant (UTC ISO). The database stores these as
 * timestamptz (absolute instants), so normalizing to a single zone removes any source-offset
 * ambiguity before hashing — two representations of the same instant hash identically. Values
 * that do not parse as a timestamp (e.g. a date-only shoot_date) are kept verbatim.
 */
export function normalizeInstant(value: string | null | undefined): string | null {
  const text = normalizeText(value);
  if (text === null) {
    return null;
  }
  const ms = new Date(text).getTime();
  return Number.isNaN(ms) ? text : new Date(ms).toISOString();
}

function normalizeAssignment(input: RecipientAssignmentInput): NormalizedRecipientAssignment {
  return {
    requirement_id: normalizeText(input.requirementId),
    shift_id: normalizeText(input.shiftId),
    staffing_role: normalizeText(input.staffingRole),
    satisfies_lead_coverage: Boolean(input.satisfiesLeadCoverage),
    starts_at: normalizeInstant(input.startsAt),
    ends_at: normalizeInstant(input.endsAt),
    call_time: normalizeInstant(input.callTime),
    instructions: normalizeText(input.instructions)
  };
}

function compareAssignments(a: NormalizedRecipientAssignment, b: NormalizedRecipientAssignment): number {
  return (
    (a.requirement_id ?? "").localeCompare(b.requirement_id ?? "") ||
    (a.starts_at ?? "").localeCompare(b.starts_at ?? "") ||
    (a.staffing_role ?? "").localeCompare(b.staffing_role ?? "") ||
    (a.shift_id ?? "").localeCompare(b.shift_id ?? "")
  );
}

export function normalizeRecipientPackage(input: RecipientPackageInput): NormalizedRecipientPackage {
  const assignments = input.assignments.map(normalizeAssignment).sort(compareAssignments);
  return {
    employee_user_id: input.employeeUserId,
    shoot_date: normalizeText(input.shootDate),
    location_name: normalizeText(input.locationName),
    location_address: normalizeText(input.locationAddress),
    assignments
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function computeRecipientHash(input: RecipientPackageInput): string {
  return sha256(JSON.stringify(normalizeRecipientPackage(input)));
}

export function normalizePlan(input: PlanInput): NormalizedPlan {
  const recipients = input.recipients
    .map((pkg) => ({ employee_user_id: pkg.employeeUserId, recipient_hash: computeRecipientHash(pkg) }))
    .sort((a, b) => a.employee_user_id.localeCompare(b.employee_user_id));
  return {
    shoot_id: input.shootId,
    shoot_date: normalizeText(input.shootDate),
    recipients
  };
}

export function computePlanHash(input: PlanInput): string {
  return sha256(JSON.stringify(normalizePlan(input)));
}
