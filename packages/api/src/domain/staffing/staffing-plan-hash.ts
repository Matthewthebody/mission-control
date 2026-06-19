import { createHash } from "node:crypto";

// Deterministic content hashing for staffing publish versioning.
// - plan_hash (per shoot): determines whether a new published VERSION exists.
// - recipient_hash (per employee): determines whether THAT employee must re-acknowledge.
//
// Normalization contract (its version is stored as hash_version alongside the hash; bump on change):
//   - Hash version: STAFFING_PLAN_HASH_VERSION below, persisted on the version + recipient rows so a
//     future algorithm change does NOT make historical plans look changed merely because the
//     algorithm changed. Comparisons only treat hashes as equal when hash_version also matches.
//   - Stable sort: each employee's assignments sort by (requirement_id, starts_at, role, ends_at);
//     plan recipients sort by employee id. JSON keys are emitted in a fixed literal order.
//   - Timestamp normalization: every timestamp collapses to one canonical UTC instant (toISOString);
//     unparseable values are kept verbatim; date-only values (shoot_date) are kept as-is.
//   - Null/empty normalization: blank / whitespace-only strings normalize to null.
//   - Canonical IDs: requirement_id (the slot) is hashed; the internal work_shift instance id and
//     display names are NOT — a re-created shift with identical material is the same commitment.
//   - Excluded fields: work_shift.notes / free-text instructions (employee-facing pre-service notes
//     already carry their own content-hash acknowledgment via shift_note_acknowledgement; folding
//     them in here would double the re-ack triggers and risk hashing internal note usage — a
//     dedicated employee-facing assignment-instructions field can be added and hashed later),
//     display labels, reads, UI state, lifecycle/publish status, and any other employee's assignments.
// See docs/staffing-publish-ack-lifecycle-design.md §4.

// Bump when the normalization algorithm above changes. Stored as hash_version on the plan + recipient rows.
export const STAFFING_PLAN_HASH_VERSION = 1;

// Bump when the stored plan_snapshot / assignment_snapshot JSON FORMAT changes (independent of the
// digest algorithm). Stored as snapshot_schema_version so a future format change selects the right
// reader rather than making historical snapshots look changed.
export const STAFFING_PLAN_SNAPSHOT_SCHEMA_VERSION = 1;

export type RecipientAssignmentInput = {
  /** Canonical slot / requirement identity (preferred over any display label). */
  requirementId?: string | null;
  staffingRole?: string | null;
  satisfiesLeadCoverage?: boolean | null;
  startsAt?: string | null;
  endsAt?: string | null;
  /** Call / setup time (shoot arrival) presented to the employee. */
  callTime?: string | null;
  /** Source work_shift instance id — retained in the immutable snapshot for traceability, EXCLUDED from the hash. */
  sourceShiftId?: string | null;
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
  staffing_role: string | null;
  satisfies_lead_coverage: boolean;
  starts_at: string | null;
  ends_at: string | null;
  call_time: string | null;
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
    staffing_role: normalizeText(input.staffingRole),
    satisfies_lead_coverage: Boolean(input.satisfiesLeadCoverage),
    starts_at: normalizeInstant(input.startsAt),
    ends_at: normalizeInstant(input.endsAt),
    call_time: normalizeInstant(input.callTime)
  };
}

function compareAssignments(a: NormalizedRecipientAssignment, b: NormalizedRecipientAssignment): number {
  return (
    (a.requirement_id ?? "").localeCompare(b.requirement_id ?? "") ||
    (a.starts_at ?? "").localeCompare(b.starts_at ?? "") ||
    (a.staffing_role ?? "").localeCompare(b.staffing_role ?? "") ||
    (a.ends_at ?? "").localeCompare(b.ends_at ?? "")
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

export type RecipientSnapshotAssignment = NormalizedRecipientAssignment & {
  /** Traceability only — the source work_shift row id. NOT part of recipient_hash. */
  source_shift_id: string | null;
};

export type RecipientSnapshot = {
  snapshot_schema_version: number;
  employee_user_id: string;
  shoot_date: string | null;
  location_name: string | null;
  location_address: string | null;
  assignments: RecipientSnapshotAssignment[];
};

/**
 * The immutable per-recipient snapshot stored on the recipient row: the same material as the hash,
 * plus source_shift_id for traceability and the snapshot schema version. Treated as a sorted
 * multiset — identical material assignments remain distinct entries (never deduplicated).
 */
export function buildRecipientSnapshot(input: RecipientPackageInput): RecipientSnapshot {
  const assignments = input.assignments
    .map((assignment) => ({
      ...normalizeAssignment(assignment),
      source_shift_id: normalizeText(assignment.sourceShiftId)
    }))
    .sort((a, b) => compareAssignments(a, b) || (a.source_shift_id ?? "").localeCompare(b.source_shift_id ?? ""));
  return {
    snapshot_schema_version: STAFFING_PLAN_SNAPSHOT_SCHEMA_VERSION,
    employee_user_id: input.employeeUserId,
    shoot_date: normalizeText(input.shootDate),
    location_name: normalizeText(input.locationName),
    location_address: normalizeText(input.locationAddress),
    assignments
  };
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
