import type { ShootStaffingSnapshot, StaffingDashboardCoverageRow, StaffingDashboardResponse } from "../types";

// ── Staff Assignment Board state coherence ────────────────────────────────────
// The assign/remove/reassign mutation returns an authoritative per-shoot snapshot.
// Instead of discarding it and re-fetching the whole board (which produces a stale
// "No lead" window and an orphaned drawer), we merge the snapshot onto the dashboard
// payload in place, by stable shoot id, and recompute the staffing summary tiles
// from the merged rows. A guarded background refresh then reconciles member-derived
// availability — it can never restore an older count because it is sequence-guarded
// and fetched after the mutation committed.
//
// Two distinct conflict counts exist and must not be conflated:
//   • dashboard coverage row `conflict_warning_count` = SCHEDULE OVERLAP (the SQL
//     time-overlap of a user's shifts). Surfaced on the board card.
//   • snapshot `shoot.conflict_warning_count` = OVERRIDE REQUIRED (slots whose
//     candidate needs an override: not-lead-qualified, qualification mismatch,
//     commitment/Outlook conflict). Surfaced in the drawer.
// The snapshot does NOT carry the schedule-overlap metric, so the merge preserves the
// existing overlap count on the row and lets the background refresh reconcile it.

export function coverageGap(row: Pick<StaffingDashboardCoverageRow, "planned_staff_count" | "assigned_staff_count">): number {
  return Math.max(0, row.planned_staff_count - row.assigned_staff_count);
}

// A coverage row belongs in the "needs staffing" lists while it has an open slot,
// a missing lead, or a schedule overlap.
export function rowNeedsStaffing(row: StaffingDashboardCoverageRow): boolean {
  return coverageGap(row) > 0 || row.missing_lead || row.conflict_warning_count > 0;
}

// Map the authoritative snapshot onto a coverage row. Only the staffing counts the
// snapshot carries are updated; the schedule-overlap count is preserved.
export function coverageRowFromSnapshot(
  existing: StaffingDashboardCoverageRow | null,
  snapshot: ShootStaffingSnapshot
): StaffingDashboardCoverageRow {
  const shoot = snapshot.shoot;
  const requiredLead = Math.max(shoot.required_lead_count, 1);
  const base: StaffingDashboardCoverageRow =
    existing ?? {
      shoot_id: shoot.id,
      shoot_code: shoot.shoot_code,
      title: shoot.title,
      shoot_date: shoot.shoot_date,
      department: shoot.department,
      location_label: shoot.location_name ?? shoot.location_address ?? "",
      time_label: "",
      assigned_staff_count: 0,
      planned_staff_count: 0,
      required_lead_count: 0,
      lead_coverage_count: 0,
      lead_present: false,
      lead_name: null,
      missing_lead: false,
      under_staffed: false,
      conflict_warning_count: 0,
      sync_state: shoot.schedule_sync_state,
      next_action: ""
    };
  return {
    ...base,
    assigned_staff_count: shoot.assigned_staff_count,
    planned_staff_count: shoot.planned_staff_count,
    required_lead_count: shoot.required_lead_count,
    lead_coverage_count: shoot.lead_coverage_count,
    lead_present: shoot.lead_coverage_count > 0,
    lead_name: shoot.lead_name,
    missing_lead: shoot.lead_coverage_count < requiredLead,
    under_staffed: shoot.planned_staff_count > shoot.assigned_staff_count
    // conflict_warning_count (schedule overlap) intentionally preserved from base.
  };
}

// Merge the snapshot into the dashboard payload: replace/insert the shoot's coverage
// row, drop it from the lists when it no longer needs staffing, and recompute the
// staffing summary tiles. Availability tiles (member-derived) are left untouched for
// the guarded background refresh.
export function mergeStaffingSnapshot(
  payload: StaffingDashboardResponse,
  snapshot: ShootStaffingSnapshot
): StaffingDashboardResponse {
  const shootId = snapshot.shoot.id;
  const existing = [...payload.open_coverage, ...payload.missing_lead].find((row) => row.shoot_id === shootId) ?? null;
  const updated = coverageRowFromSnapshot(existing, snapshot);
  const stays = rowNeedsStaffing(updated);

  const replace = (list: StaffingDashboardCoverageRow[], include: boolean) => {
    const without = list.filter((row) => row.shoot_id !== shootId);
    return include ? [...without, updated] : without;
  };
  const open_coverage = replace(payload.open_coverage, stays);
  const missing_lead = replace(payload.missing_lead, stays && updated.missing_lead);

  const dedup = new Map<string, StaffingDashboardCoverageRow>();
  for (const row of [...open_coverage, ...missing_lead]) {
    if (!dedup.has(row.shoot_id)) dedup.set(row.shoot_id, row);
  }
  const rows = [...dedup.values()];

  return {
    ...payload,
    open_coverage,
    missing_lead,
    summary: {
      ...payload.summary,
      open_staffing_slots: rows.reduce((sum, row) => sum + coverageGap(row), 0),
      shoots_missing_lead: rows.filter((row) => row.missing_lead).length,
      understaffed_shoots: rows.filter((row) => row.under_staffed).length
    }
  };
}

// Human-readable lead-coverage state for a card, kept distinct from total staffing.
export function leadCoverageLabel(row: Pick<StaffingDashboardCoverageRow, "missing_lead" | "lead_name" | "required_lead_count">): string {
  if (row.required_lead_count <= 0 && !row.missing_lead) {
    return "No lead required";
  }
  if (row.missing_lead) {
    return "Lead still required";
  }
  return row.lead_name ? `Lead: ${row.lead_name}` : "Lead covered";
}
