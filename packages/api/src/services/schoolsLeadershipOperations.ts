import type { PoolClient } from "pg";
import type { AuthUser } from "../types/auth.js";
import { getSchoolsHubAccessScope } from "../authz/authority.js";

// Phase 6A — Schools Leadership & CSR operating read model. ONE server-side aggregate over
// CANONICAL records (organization / school_service_term / shoot / shoot_location / school_work_item /
// school_profile). React never re-totals: each enabled category's `count` IS its materialized
// `issues.length` (displayed === filtered). Categories with no canonical source return
// `{ available:false, count:null, reason }` — no fake count, no enabled dead action. Scope is
// derived from getSchoolsHubAccessScope: "all" = every School, "own" = the CSR's owned Schools.

export type LeadershipTimeState = "today" | "this_week" | "next_week" | "overdue" | "future" | "none";

export type NormalizedIssue = {
  issue_id: string;
  section: "current_season" | "building_next_season";
  category: string;
  source_type: string;
  source_id: string;
  district_id: string | null;
  district_name: string | null;
  school_id: string | null;
  school_name: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  internal_owner: string | null;
  reason: string;
  severity: "info" | "warning" | "critical";
  status: string;
  date_deadline: string | null;
  time_state: LeadershipTimeState;
  exact_destination_hash: string;
  focus_reason: string;
  can_act: boolean;
  primary_action: string | null;
  source_availability: "live" | "derived";
  provenance: string;
};

export type AvailableCategory = {
  category: string;
  section: "current_season" | "building_next_season";
  available: true;
  count: number;
  issues: NormalizedIssue[];
};
export type UnavailableCategory = {
  category: string;
  section: "current_season" | "building_next_season";
  available: false;
  count: null;
  reason: string;
};
export type LeadershipCategory = AvailableCategory | UnavailableCategory;

export type SchoolsLeadershipOperations = {
  generated_at: string;
  scope: "all" | "own";
  sections: {
    current_season: LeadershipCategory[];
    building_next_season: LeadershipCategory[];
  };
};

const orgDestination = (id: string) => `#directory/organizations/${id}`;

// The authoritative shoot deep-link: the Staff Assignment Board consumes ?date= as its anchor date
// and ?shoot= as a pending deep-link that opens that shoot's staffing drawer once the board loads
// (StaffAssignmentBoard.readInitialDateFromHash / readShootFromHash). NOTE: deliberately NOT the
// urgent-watch "#scheduling?area=staffing" hash — that path resolves to the Team Schedule calendar,
// which never opens the shoot drawer.
function shootDestination(shootId: string, shootDate: string) {
  const params = new URLSearchParams();
  params.set("date", shootDate);
  params.set("shoot", shootId);
  return `#operations/staffing?${params.toString()}`;
}

function severityForTimeState(time: LeadershipTimeState): "info" | "warning" | "critical" {
  if (time === "today" || time === "overdue") return "critical";
  if (time === "this_week") return "warning";
  return "info";
}

export async function getSchoolsLeadershipOperations(client: PoolClient, auth: AuthUser): Promise<SchoolsLeadershipOperations> {
  const scope = getSchoolsHubAccessScope(auth);
  if (!scope) {
    const err = new Error("Forbidden") as Error & { status?: number };
    err.status = 403;
    throw err;
  }
  const ownScope = scope === "own";
  // `own` restricts to Schools this user internally owns (profile owner OR account owner on a shoot).
  const ownerFilter = ownScope
    ? `AND (sp.primary_internal_owner_user_id = $2 OR EXISTS (SELECT 1 FROM shoot sx WHERE sx.tenant_id = o.tenant_id AND sx.organization_id = o.id AND sx.account_owner_user_id = $2))`
    : "";
  const params: unknown[] = ownScope ? [auth.tenantId, auth.id] : [auth.tenantId];

  // Canonical School set (account schools), with district + internal owner resolved. Split into a
  // FROM clause (joins only) and a WHERE clause so category queries can insert their own JOIN
  // between them without producing a JOIN-after-WHERE.
  const schoolsFrom = `
    FROM organization o
    LEFT JOIN organization d ON d.tenant_id = o.tenant_id AND d.id = o.parent_organization_id
    LEFT JOIN school_profile sp ON sp.tenant_id = o.tenant_id AND sp.organization_id = o.id
    LEFT JOIN app_user owner ON owner.id = sp.primary_internal_owner_user_id`;
  const schoolsWhere = `
    WHERE o.tenant_id = $1
      AND o.client_entity_kind = 'account'
      AND o.account_type::text LIKE 'schools%'
      AND o.active_status = 'active'
      ${ownerFilter}`;

  const cols = `o.id::text AS school_id, o.display_name AS school_name,
                d.id::text AS district_id, d.display_name AS district_name,
                sp.primary_internal_owner_user_id::text AS owner_user_id, owner.full_name AS owner_name`;

  // ── Current Season ─────────────────────────────────────────────────────────
  const current: LeadershipCategory[] = [];

  // Shoots today / this week / next week (published schools shoots only).
  const shootRows = (
    await client.query<{ shoot_id: string; school_id: string; school_name: string; district_id: string | null; district_name: string | null; owner_user_id: string | null; owner_name: string | null; shoot_date: string; readiness_status: string; bucket: string }>(
      `SELECT s.id::text AS shoot_id, ${cols}, s.shoot_date::text AS shoot_date, s.readiness_status::text AS readiness_status,
              CASE WHEN s.shoot_date = current_date THEN 'today'
                   WHEN s.shoot_date > current_date AND s.shoot_date < current_date + 7 THEN 'this_week'
                   WHEN s.shoot_date >= current_date + 7 AND s.shoot_date < current_date + 14 THEN 'next_week'
                   ELSE 'other' END AS bucket
         ${schoolsFrom}
         JOIN shoot s ON s.tenant_id = o.tenant_id AND s.organization_id = o.id
         ${schoolsWhere}
          AND s.record_state = 'published' AND s.deleted_at IS NULL
          AND s.shoot_date >= current_date AND s.shoot_date < current_date + 14`,
      params
    )
  ).rows;
  for (const [cat, bucket, label] of [
    ["shoots_today", "today", "today"],
    ["shoots_this_week", "this_week", "this week"],
    ["shoots_next_week", "next_week", "next week"]
  ] as const) {
    const rows = shootRows.filter((r) => r.bucket === bucket);
    current.push({
      category: cat,
      section: "current_season",
      available: true,
      count: rows.length,
      issues: rows.map((r) => ({
        issue_id: `${cat}:${r.shoot_id}`,
        section: "current_season",
        category: cat,
        source_type: "shoot",
        source_id: r.shoot_id,
        district_id: r.district_id,
        district_name: r.district_name,
        school_id: r.school_id,
        school_name: r.school_name,
        owner_user_id: r.owner_user_id,
        owner_name: r.owner_name,
        internal_owner: r.owner_name,
        reason: `Confirmed shoot ${label} (${r.readiness_status})`,
        severity: severityForTimeState(bucket),
        status: r.readiness_status,
        date_deadline: r.shoot_date,
        time_state: bucket,
        // A shoot is a LEGACY-spine record (0 of these ids exist in the canonical jobs world), so the
        // exact destination is the authoritative scheduling deep-link — the same convention urgent-watch
        // uses — which opens the shoot's staffing drawer. Never a jobs-world hash for a shoot id.
        exact_destination_hash: shootDestination(r.shoot_id, r.shoot_date),
        focus_reason: "Open the confirmed shoot to verify readiness and staffing.",
        can_act: true,
        primary_action: "open_shoot",
        source_availability: "live",
        provenance: "shoot(record_state=published)"
      }))
    });
  }

  // Missing current service term (a School with no status='current' term).
  const missingTerm = (
    await client.query<{ school_id: string; school_name: string; district_id: string | null; district_name: string | null; owner_user_id: string | null; owner_name: string | null }>(
      `SELECT ${cols} ${schoolsFrom} ${schoolsWhere}
         AND NOT EXISTS (SELECT 1 FROM school_service_term t WHERE t.tenant_id = o.tenant_id AND t.organization_id = o.id AND t.status = 'current')`,
      params
    )
  ).rows;
  current.push({
    category: "missing_current_service_term",
    section: "current_season",
    available: true,
    count: missingTerm.length,
    issues: missingTerm.map((r) => ({
      issue_id: `missing_current_service_term:${r.school_id}`,
      section: "current_season",
      category: "missing_current_service_term",
      source_type: "organization",
      source_id: r.school_id,
      district_id: r.district_id,
      district_name: r.district_name,
      school_id: r.school_id,
      school_name: r.school_name,
      owner_user_id: r.owner_user_id,
      owner_name: r.owner_name,
      internal_owner: r.owner_name,
      reason: "No current service term is set for this School.",
      severity: "warning",
      status: "missing",
      date_deadline: null,
      time_state: "none",
      exact_destination_hash: `${orgDestination(r.school_id)}?tab=profile`,
      focus_reason: "Set or confirm the current service term.",
      can_act: Boolean(r.owner_user_id),
      primary_action: r.owner_user_id ? "set_service_term" : null,
      source_availability: "live",
      provenance: "school_service_term(status=current absent)"
    }))
  });

  // Current service term awaiting confirmation (confirmation_state='unconfirmed').
  const unconfirmed = (
    await client.query<{ school_id: string; school_name: string; district_id: string | null; district_name: string | null; owner_user_id: string | null; owner_name: string | null; term_id: string; period_label: string }>(
      `SELECT ${cols}, t.id::text AS term_id, t.period_label AS period_label
         ${schoolsFrom}
         JOIN school_service_term t ON t.tenant_id = o.tenant_id AND t.organization_id = o.id AND t.status = 'current'
         ${schoolsWhere}
          AND t.confirmation_state = 'unconfirmed'`,
      params
    )
  ).rows;
  current.push({
    category: "service_term_confirmation_exceptions",
    section: "current_season",
    available: true,
    count: unconfirmed.length,
    issues: unconfirmed.map((r) => ({
      issue_id: `service_term_confirmation_exceptions:${r.term_id}`,
      section: "current_season",
      category: "service_term_confirmation_exceptions",
      source_type: "school_service_term",
      source_id: r.term_id,
      district_id: r.district_id,
      district_name: r.district_name,
      school_id: r.school_id,
      school_name: r.school_name,
      owner_user_id: r.owner_user_id,
      owner_name: r.owner_name,
      internal_owner: r.owner_name,
      reason: `Current term "${r.period_label}" is unconfirmed.`,
      severity: "warning",
      status: "unconfirmed",
      date_deadline: null,
      time_state: "none",
      exact_destination_hash: `${orgDestination(r.school_id)}?tab=profile`,
      focus_reason: "Review and confirm the inherited service term values.",
      can_act: Boolean(r.owner_user_id),
      primary_action: r.owner_user_id ? "confirm_service_term" : null,
      source_availability: "live",
      provenance: "school_service_term(confirmation_state=unconfirmed)"
    }))
  });

  // Missing approved Location (School with no active shoot_location).
  const missingLoc = (
    await client.query<{ school_id: string; school_name: string; district_id: string | null; district_name: string | null; owner_user_id: string | null; owner_name: string | null }>(
      `SELECT ${cols} ${schoolsFrom} ${schoolsWhere}
         AND NOT EXISTS (SELECT 1 FROM shoot_location l WHERE l.tenant_id = o.tenant_id AND l.organization_id = o.id AND l.active_status = 'active')`,
      params
    )
  ).rows;
  current.push({
    category: "missing_approved_location",
    section: "current_season",
    available: true,
    count: missingLoc.length,
    issues: missingLoc.map((r) => ({
      issue_id: `missing_approved_location:${r.school_id}`,
      section: "current_season",
      category: "missing_approved_location",
      source_type: "organization",
      source_id: r.school_id,
      district_id: r.district_id,
      district_name: r.district_name,
      school_id: r.school_id,
      school_name: r.school_name,
      owner_user_id: r.owner_user_id,
      owner_name: r.owner_name,
      internal_owner: r.owner_name,
      reason: "No approved (active) canonical Location for this School.",
      severity: "warning",
      status: "missing",
      date_deadline: null,
      time_state: "none",
      exact_destination_hash: `${orgDestination(r.school_id)}?tab=profile`,
      focus_reason: "Add or activate a canonical Location.",
      can_act: Boolean(r.owner_user_id),
      primary_action: r.owner_user_id ? "add_location" : null,
      source_availability: "live",
      provenance: "shoot_location(active absent)"
    }))
  });

  // Workflow blockers (school_work_item status='blocked').
  const blockers = (
    await client.query<{ item_id: string; school_id: string; school_name: string; district_id: string | null; district_name: string | null; owner_user_id: string | null; owner_name: string | null; title: string; blocker_reason: string | null; due_date: string | null }>(
      `SELECT w.id::text AS item_id, ${cols}, w.title AS title, w.blocker_reason AS blocker_reason, w.due_date::text AS due_date
         ${schoolsFrom}
         JOIN school_work_item w ON w.tenant_id = o.tenant_id AND w.organization_id = o.id
         ${schoolsWhere}
          AND w.status = 'blocked'`,
      params
    )
  ).rows;
  current.push({
    category: "workflow_blockers",
    section: "current_season",
    available: true,
    count: blockers.length,
    issues: blockers.map((r) => ({
      issue_id: `workflow_blockers:${r.item_id}`,
      section: "current_season",
      category: "workflow_blockers",
      source_type: "school_work_item",
      source_id: r.item_id,
      district_id: r.district_id,
      district_name: r.district_name,
      school_id: r.school_id,
      school_name: r.school_name,
      owner_user_id: r.owner_user_id,
      owner_name: r.owner_name,
      internal_owner: r.owner_name,
      reason: r.blocker_reason ? `Blocked: ${r.blocker_reason}` : `Blocked work item: ${r.title}`,
      severity: "critical",
      status: "blocked",
      date_deadline: r.due_date,
      time_state: r.due_date ? "future" : "none",
      // focus=stalled is the Schools hub's existing consumed filter for blocked/stalled work — a
      // filtered landing, not a generic list. (No per-work-item route exists yet to focus tighter.)
      exact_destination_hash: `#schools/jobs?focus=stalled`,
      focus_reason: "Resolve the blocker on this work item.",
      can_act: Boolean(r.owner_user_id),
      primary_action: r.owner_user_id ? "open_work_item" : null,
      source_availability: "live",
      provenance: "school_work_item(status=blocked)"
    }))
  });

  // Unavailable current-season categories (no canonical source — honest, no fake count).
  current.push({ category: "schedule_change_requests", section: "current_season", available: false, count: null, reason: "No canonical schedule-change-request source is connected." });
  current.push({ category: "declined_replacement_staffing", section: "current_season", available: false, count: null, reason: "No canonical staffing decline/replacement lifecycle is connected." });
  current.push({ category: "unresolved_client_communication_cases", section: "current_season", available: false, count: null, reason: "No canonical communication-case source is connected (touchpoints exist, but not a case lifecycle)." });

  // ── Building Next Season ───────────────────────────────────────────────────
  const next: LeadershipCategory[] = [];

  // Next-season ownership gap (School with no internal owner).
  const ownerGap = (
    await client.query<{ school_id: string; school_name: string; district_id: string | null; district_name: string | null }>(
      `SELECT o.id::text AS school_id, o.display_name AS school_name, d.id::text AS district_id, d.display_name AS district_name
         ${schoolsFrom} ${schoolsWhere}
         AND sp.primary_internal_owner_user_id IS NULL`,
      params
    )
  ).rows;
  next.push({
    category: "next_season_ownership_gap",
    section: "building_next_season",
    available: true,
    count: ownerGap.length,
    issues: ownerGap.map((r) => ({
      issue_id: `next_season_ownership_gap:${r.school_id}`,
      section: "building_next_season",
      category: "next_season_ownership_gap",
      source_type: "organization",
      source_id: r.school_id,
      district_id: r.district_id,
      district_name: r.district_name,
      school_id: r.school_id,
      school_name: r.school_name,
      owner_user_id: null,
      owner_name: null,
      internal_owner: null,
      reason: "No internal/CSR owner assigned for next-season planning.",
      severity: "warning",
      status: "ownership_gap",
      date_deadline: null,
      time_state: "none",
      exact_destination_hash: `${orgDestination(r.school_id)}?tab=profile`,
      focus_reason: "Assign a primary internal owner.",
      can_act: true,
      primary_action: "assign_owner",
      source_availability: "live",
      provenance: "school_profile(primary_internal_owner_user_id IS NULL)"
    }))
  });

  // Next service term awaiting confirmation (draft term unconfirmed).
  const nextTermUnconfirmed = (
    await client.query<{ school_id: string; school_name: string; district_id: string | null; district_name: string | null; owner_user_id: string | null; owner_name: string | null; term_id: string; period_label: string; inherited: number }>(
      `SELECT ${cols}, t.id::text AS term_id, t.period_label AS period_label, COALESCE(array_length(t.inherited_field_keys, 1), 0) AS inherited
         ${schoolsFrom}
         JOIN school_service_term t ON t.tenant_id = o.tenant_id AND t.organization_id = o.id AND t.status = 'draft'
         ${schoolsWhere}
          AND t.confirmation_state = 'unconfirmed'`,
      params
    )
  ).rows;
  next.push({
    category: "next_service_term_awaiting_confirmation",
    section: "building_next_season",
    available: true,
    count: nextTermUnconfirmed.length,
    issues: nextTermUnconfirmed.map((r) => ({
      issue_id: `next_service_term_awaiting_confirmation:${r.term_id}`,
      section: "building_next_season",
      category: "next_service_term_awaiting_confirmation",
      source_type: "school_service_term",
      source_id: r.term_id,
      district_id: r.district_id,
      district_name: r.district_name,
      school_id: r.school_id,
      school_name: r.school_name,
      owner_user_id: r.owner_user_id,
      owner_name: r.owner_name,
      internal_owner: r.owner_name,
      reason: `Next term "${r.period_label}" is a draft awaiting confirmation${Number(r.inherited) > 0 ? ` (${r.inherited} inherited value(s))` : ""}.`,
      severity: "info",
      status: "unconfirmed",
      date_deadline: null,
      time_state: "future",
      exact_destination_hash: `${orgDestination(r.school_id)}?tab=profile`,
      focus_reason: "Confirm the next-season service term and inherited values.",
      can_act: Boolean(r.owner_user_id),
      primary_action: r.owner_user_id ? "confirm_next_term" : null,
      source_availability: "live",
      provenance: "school_service_term(status=draft, confirmation_state=unconfirmed)"
    }))
  });

  // Unavailable next-season category.
  next.push({ category: "rebooking_state", section: "building_next_season", available: false, count: null, reason: "No canonical rebooking/next-season transaction source is connected (term rollover exists, but not a rebooking lifecycle)." });

  return {
    generated_at: new Date().toISOString(),
    scope,
    sections: { current_season: current, building_next_season: next }
  };
}
