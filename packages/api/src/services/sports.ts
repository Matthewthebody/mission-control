import type { PoolClient } from "pg";
import {
  canManageSportsFinance,
  canManageSportsSettings,
  canManageSportsWorkspace,
  canOverrideSportsDuplicates,
  canPublishSportsImports,
  canViewSportsFinance,
  getSportsWorkspaceAccessScope
} from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { SPORTS_PEER_QA_STATUSES } from "../types/sports.js";
import type {
  SportsAccountDetailResponse,
  SportsAccountSummary,
  SportsActivityEntry,
  SportsContactsResponse,
  SportsFinancialSummaryRecord,
  SportsKpiCard,
  SportsOverviewListItem,
  SportsOverviewResponse,
  SportsPermissionSnapshot,
  SportsPeerQaBoardResponse,
  SportsPeerQaChecklistItem,
  SportsPeerQaJob,
  SportsPeerQaStatus,
  SportsProductionItemSummary,
  SportsProductionResponse,
  SportsProofCycleRecord,
  SportsReadinessChecklistItemRecord,
  SportsReadinessStatus,
  SportsReportsResponse,
  SportsSettingsResponse,
  SportsShootDetailResponse,
  SportsShootListFilters,
  SportsShootListResponse,
  SportsShootStatus,
  SportsShootSummary,
  SportsSpecialtyProductItemRecord,
  SportsStaffingPersonRecord,
  SportsStaffingStatus,
  SportsSyncStatus,
  SportsTeamUnitRecord,
  SportsWatchFlagRecord,
  SportsWatchlistResponse,
  SportsRiskStatus,
  SportsProductionStatus,
  SportsProofStatus
} from "../types/sports.js";
import { createAuditLog } from "./audit.js";
import { getIntakeJob } from "./centralJobIntake.js";
import { getShootReadyToShootState } from "./readyToShoot.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  sourceSurface?: string | null;
};

type SportsShootSummaryRow = {
  id: string;
  shoot_code: string;
  job_number: string | null;
  title: string;
  organization_id: string | null;
  organization_name: string | null;
  location_id: string | null;
  location_name: string | null;
  primary_contact_id: string | null;
  primary_contact_name: string | null;
  account_owner_user_id: string | null;
  account_owner_name: string | null;
  shoot_date: string | null;
  start_time: string | null;
  end_time: string | null;
  timezone: string | null;
  shoot_status_raw: string | null;
  sync_status_raw: string | null;
  delivery_due_date: string | null;
  planned_staff_count: number | null;
  minimum_staff_count: number | null;
  required_lead_count: number | null;
  lead_confirmed_ready: boolean | null;
  lead_confirmed_ready_at: string | null;
  lead_confirmed_ready_by_name: string | null;
  sport_type: string | null;
  season: string | null;
  league_name: string | null;
  division: string | null;
  team_structure: string | null;
  proof_required: boolean | null;
  proof_due_date: string | null;
  revenue_share_enabled: boolean | null;
  banner_work_required: boolean | null;
  specialty_products_enabled: boolean | null;
  estimated_team_count: number | null;
  estimated_subject_count: number | null;
  lead_photographer_user_id: string | null;
  lead_photographer_name: string | null;
  scheduled_employee_count: number | null;
  lead_coverage_count: number | null;
  clocked_in_employee_count: number | null;
  blocker_count: number | null;
  incomplete_required_count: number | null;
  incomplete_blocker_count: number | null;
  watch_flag_count: number | null;
  highest_watch_severity: string | null;
  production_item_count: number | null;
  blocked_production_count: number | null;
  awaiting_approval_count: number | null;
  overdue_proof_count: number | null;
  specialty_due_count: number | null;
  last_updated_at: string;
};

type SportsAccountRow = {
  id: string;
  organization_name: string;
  account_type: string;
  account_owner_name: string | null;
  health_rank: number;
  health_status: string;
  active_shoots_count: number;
  next_shoot_date: string | null;
  open_issues: number;
  revenue_share_enabled: boolean;
  contract_or_pricing_flag: boolean;
  last_touchpoint: string | null;
  active_seasons: string[] | null;
};

type SportsContactRow = {
  id: string;
  full_name: string;
  organization_id: string;
  organization_name: string;
  role: string | null;
  preferred_contact_method: string | null;
  phone: string | null;
  email: string | null;
  contact_type: string | null;
  active_shoot_count: number;
  last_interaction: string | null;
  approval_owner: boolean;
  billing_contact: boolean;
};

type SportsWatchFlagMutationInput = {
  severity?: string | null;
  flag_type?: string | null;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  owner_user_id?: string | null;
  due_at?: string | null;
};

type SportsTeamUnitInput = {
  team_name: string;
  display_order?: number | null;
  age_group?: string | null;
  division?: string | null;
  coach_contact_id?: string | null;
  proof_owner_contact_id?: string | null;
  scheduled_slot_start?: string | null;
  scheduled_slot_end?: string | null;
  estimated_subject_count?: number | null;
  actual_subject_count?: number | null;
  banner_required?: boolean | null;
  specialty_notes?: string | null;
  status?: string | null;
};

type SportsProofCycleInput = {
  production_item_id?: string | null;
  team_unit_id?: string | null;
  approver_contact_id?: string | null;
  status?: string | null;
  sent_at?: string | null;
  viewed_at?: string | null;
  approved_at?: string | null;
  revision_count?: number | null;
  due_date?: string | null;
  last_follow_up_at?: string | null;
  notes?: string | null;
};

type SportsProductItemInput = {
  production_item_id?: string | null;
  team_unit_id?: string | null;
  product_type: string;
  title: string;
  quantity?: number | null;
  status?: string | null;
  approval_required?: boolean | null;
  approved_at?: string | null;
  assigned_to_user_id?: string | null;
  vendor_name?: string | null;
  due_date?: string | null;
  delivered_at?: string | null;
  notes?: string | null;
};

type SportsFinancialSummaryInput = {
  pricing_profile_name?: string | null;
  invoice_number?: string | null;
  invoice_status?: string | null;
  invoice_due_date?: string | null;
  revenue_share_enabled?: boolean | null;
  revenue_share_terms_summary?: string | null;
  estimated_revenue?: number | null;
  actual_revenue?: number | null;
  estimated_cost?: number | null;
  actual_cost?: number | null;
  payout_amount?: number | null;
  payment_status?: string | null;
  notes?: string | null;
};

type SportsPeerQaRow = {
  id: string;
  production_item_id: string;
  linked_shoot_id: string | null;
  job_id: string;
  job_name: string;
  organization_id: string | null;
  organization_name: string | null;
  shoot_date: string | null;
  qa_status: string;
  sports_job_type: string;
  owner_user_id: string | null;
  owner_name: string | null;
  peer_reviewer_user_id: string | null;
  peer_reviewer_name: string | null;
  final_reviewer_user_id: string | null;
  final_reviewer_name: string | null;
  blocker_reason: string | null;
  blocker_owner: string | null;
  blocker_notes: string | null;
  correction_category: string | null;
  correction_notes: string | null;
  known_exceptions: string | null;
  owner_checklist_json: unknown;
  peer_checklist_json: unknown;
  conditional_checklist_json: unknown;
  release_packet_json: unknown;
  approved_for_release_at: string | null;
  last_updated_at: string;
};

const SPORTS_SAVED_VIEWS: Array<{ key: string; label: string; hash: string }> = [
  { key: "today", label: "Today", hash: "#sports?saved_view=today" },
  { key: "next_7_days", label: "Next 7 Days", hash: "#sports?saved_view=next_7_days" },
  { key: "at_risk", label: "At Risk", hash: "#sports/shoots?saved_view=at_risk" },
  { key: "waiting_on_client", label: "Waiting on Client", hash: "#sports/exceptions?group=overdue_approvals" },
  { key: "production_blocked", label: "Production Blocked", hash: "#sports/production?view=blocked" }
];

function normalizeText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function numericValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function boolValue(value: unknown) {
  return Boolean(value);
}

function humanizeToken(value: string | null | undefined) {
  if (!value) {
    return "Unknown";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function toPeerQaStatus(value: string | null | undefined): SportsPeerQaStatus {
  return SPORTS_PEER_QA_STATUSES.includes(value as SportsPeerQaStatus) ? (value as SportsPeerQaStatus) : "ready_for_owner_qa";
}

function checklistItems(value: unknown): SportsPeerQaChecklistItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: SportsPeerQaChecklistItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.label !== "string" || !record.label.trim()) {
      continue;
    }
    const mapped: SportsPeerQaChecklistItem = {
      label: record.label,
      complete: Boolean(record.complete)
    };
    if (typeof record.applies === "boolean") {
      mapped.applies = record.applies;
    }
    items.push(mapped);
  }
  return items;
}

function releasePacket(value: unknown): SportsPeerQaJob["release_packet"] {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    owner_qa_complete: Boolean(record.owner_qa_complete),
    peer_qa_complete: Boolean(record.peer_qa_complete),
    corrections_resolved: Boolean(record.corrections_resolved),
    spencer_review_complete: Boolean(record.spencer_review_complete),
    price_sheet_confirmed: Boolean(record.price_sheet_confirmed),
    team_images_confirmed: Boolean(record.team_images_confirmed),
    individual_galleries_confirmed: Boolean(record.individual_galleries_confirmed),
    buddy_photos_complete: typeof record.buddy_photos_complete === "boolean" ? record.buddy_photos_complete : null,
    virtual_teams_complete: typeof record.virtual_teams_complete === "boolean" ? record.virtual_teams_complete : null,
    known_exceptions_documented: Boolean(record.known_exceptions_documented),
    approved_for_release: Boolean(record.approved_for_release)
  };
}

function mapSportsPeerQaRow(row: SportsPeerQaRow): SportsPeerQaJob {
  return {
    id: row.id,
    production_item_id: row.production_item_id,
    linked_shoot_id: row.linked_shoot_id,
    job_id: row.job_id,
    job_name: row.job_name,
    organization_id: row.organization_id,
    organization_name: row.organization_name,
    shoot_date: row.shoot_date,
    qa_status: toPeerQaStatus(row.qa_status),
    sports_job_type: row.sports_job_type,
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_name,
    peer_reviewer_user_id: row.peer_reviewer_user_id,
    peer_reviewer_name: row.peer_reviewer_name,
    final_reviewer_user_id: row.final_reviewer_user_id,
    final_reviewer_name: row.final_reviewer_name,
    blocker_reason: row.blocker_reason,
    blocker_owner: row.blocker_owner,
    blocker_notes: row.blocker_notes,
    correction_category: row.correction_category,
    correction_notes: row.correction_notes,
    known_exceptions: row.known_exceptions,
    owner_checklist: checklistItems(row.owner_checklist_json),
    peer_checklist: checklistItems(row.peer_checklist_json),
    conditional_checklist: checklistItems(row.conditional_checklist_json),
    release_packet: releasePacket(row.release_packet_json),
    approved_for_release_at: row.approved_for_release_at,
    last_updated_at: row.last_updated_at
  };
}

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function isoDate(input: Date) {
  return input.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function severityRank(value: string | null | undefined) {
  switch ((value ?? "").toLowerCase()) {
    case "critical":
      return 5;
    case "high":
      return 4;
    case "medium":
      return 3;
    case "low":
      return 2;
    case "none":
      return 1;
    default:
      return 0;
  }
}

function toSportsShootStatus(rawStatus: string | null | undefined): SportsShootStatus {
  switch ((rawStatus ?? "").toUpperCase()) {
    case "DRAFT":
      return "draft";
    case "TENTATIVE":
      return "pending_confirmation";
    case "READY":
      return "ready_to_shoot";
    case "LIVE":
      return "in_progress";
    case "SHOOT_COMPLETE":
      return "shot_complete";
    case "ON_HOLD":
      return "postponed";
    case "CANCELLED":
      return "cancelled";
    case "CONFIRMED":
    default:
      return "confirmed";
  }
}

function toSportsSyncStatus(rawStatus: string | null | undefined): SportsSyncStatus {
  switch ((rawStatus ?? "").toLowerCase()) {
    case "sync_error":
    case "error":
      return "error";
    case "sync_warning":
    case "warning":
      return "warning";
    case "pending_sync":
    case "pending":
      return "pending";
    default:
      return "clean";
  }
}

function toSportsReadinessStatus(row: SportsShootSummaryRow): SportsReadinessStatus {
  const blockers = numericValue(row.incomplete_blocker_count);
  const required = numericValue(row.incomplete_required_count);
  const shootDate = row.shoot_date ? new Date(`${row.shoot_date}T12:00:00`) : null;
  const hoursUntilShoot = shootDate ? (shootDate.getTime() - Date.now()) / 3600000 : null;
  const staffingGap =
    numericValue(row.minimum_staff_count || row.planned_staff_count) > numericValue(row.scheduled_employee_count);

  if ((blockers > 0 || staffingGap) && hoursUntilShoot !== null && hoursUntilShoot <= 72) {
    return "off_track";
  }
  if (blockers > 0 || required > 0 || severityRank(row.highest_watch_severity) >= 4) {
    return "at_risk";
  }
  if (!blockers && required > 0) {
    return "on_track";
  }
  return "ready";
}

function toSportsProofStatus(row: SportsShootSummaryRow): SportsProofStatus {
  if (!boolValue(row.proof_required)) {
    return "not_required";
  }
  if (numericValue(row.overdue_proof_count) > 0) {
    return "overdue";
  }
  if (numericValue(row.awaiting_approval_count) > 0) {
    return "sent";
  }
  if (numericValue(row.production_item_count) > 0) {
    return "building";
  }
  return "not_started";
}

function toSportsProductionStatus(row: SportsShootSummaryRow): SportsProductionStatus {
  if (numericValue(row.blocked_production_count) > 0) {
    return "blocked";
  }
  if (numericValue(row.awaiting_approval_count) > 0) {
    return "awaiting_client_approval";
  }
  if (numericValue(row.production_item_count) > 0) {
    return "queued";
  }
  return "not_created";
}

function toSportsStaffingStatus(row: SportsShootSummaryRow): SportsStaffingStatus {
  const assigned = numericValue(row.scheduled_employee_count);
  const minimum = Math.max(numericValue(row.minimum_staff_count), numericValue(row.required_lead_count));
  const leadCount = numericValue(row.lead_coverage_count);
  const clockedIn = numericValue(row.clocked_in_employee_count);
  if (assigned === 0 || leadCount === 0) {
    return "unassigned";
  }
  if (assigned < minimum) {
    return "gap_flagged";
  }
  if (boolValue(row.lead_confirmed_ready)) {
    return "ready_confirmed";
  }
  if (clockedIn > 0) {
    return "checked_in";
  }
  if (assigned >= minimum) {
    return "staffed";
  }
  return "partially_staffed";
}

function toSportsRiskStatus(row: SportsShootSummaryRow, readinessStatus: SportsReadinessStatus): SportsRiskStatus {
  const syncStatus = toSportsSyncStatus(row.sync_status_raw);
  if (syncStatus === "error") {
    return "critical";
  }
  const severity = row.highest_watch_severity?.toLowerCase();
  if (severity === "critical" || readinessStatus === "off_track") {
    return "critical";
  }
  if (severity === "high" || readinessStatus === "at_risk") {
    return "high";
  }
  if (severity === "medium") {
    return "medium";
  }
  if (severity === "low" || numericValue(row.watch_flag_count) > 0) {
    return "low";
  }
  return "none";
}

function buildSportsPermissionSnapshot(auth: AuthUser): SportsPermissionSnapshot {
  return {
    can_manage_department: canManageSportsWorkspace(auth),
    can_edit_shoots: canManageSportsWorkspace(auth),
    can_manage_staffing: canManageSportsWorkspace(auth),
    can_manage_production: canManageSportsWorkspace(auth),
    can_manage_finance: canManageSportsFinance(auth),
    can_view_finance_detail: canViewSportsFinance(auth),
    can_manage_settings: canManageSportsSettings(auth),
    can_publish_imports: canPublishSportsImports(auth),
    can_override_duplicates: canOverrideSportsDuplicates(auth),
    can_confirm_ready: getSportsWorkspaceAccessScope(auth) !== null
  };
}

function buildSavedViews(activeKey?: string | null) {
  return SPORTS_SAVED_VIEWS.map((view) => ({
    ...view,
    active: view.key === activeKey
  }));
}

async function logSportsActivity(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  eventType: string,
  payload: Record<string, unknown>,
  meta: RequestMeta = {}
) {
  await client.query(
    `INSERT INTO shoot_activity_log (tenant_id, shoot_id, event_type, actor_user_id, payload)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [auth.tenantId, shootId, eventType, auth.id, JSON.stringify(payload)]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: `sports.${eventType}`,
    entityType: "shoot",
    entityId: shootId,
    metadata: payload,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    sourceSurface: meta.sourceSurface ?? "sports_workspace"
  });
}

async function loadSportsShootRows(
  client: PoolClient,
  auth: AuthUser,
  filters: SportsShootListFilters = {}
): Promise<SportsShootSummaryRow[]> {
  const params: unknown[] = [auth.tenantId];
  const conditions = ["s.tenant_id = $1", "s.deleted_at IS NULL", "s.record_state = 'published'::shoot_record_state", "s.department = 'sports'::department_code"];

  if (filters.date_from) {
    params.push(filters.date_from);
    conditions.push(`s.shoot_date >= $${params.length}::date`);
  }
  if (filters.date_to) {
    params.push(filters.date_to);
    conditions.push(`s.shoot_date <= $${params.length}::date`);
  }
  if (filters.organization_id) {
    params.push(filters.organization_id);
    conditions.push(`s.organization_id = $${params.length}::uuid`);
  }
  if (filters.location_id) {
    params.push(filters.location_id);
    conditions.push(`s.location_id = $${params.length}::uuid`);
  }
  if (filters.account_owner_user_id) {
    params.push(filters.account_owner_user_id);
    conditions.push(`s.account_owner_user_id = $${params.length}::uuid`);
  }
  if (filters.lead_photographer_user_id) {
    params.push(filters.lead_photographer_user_id);
    conditions.push(
      `EXISTS (
        SELECT 1
        FROM work_shift lead_filter
        WHERE lead_filter.tenant_id = s.tenant_id
          AND lead_filter.shoot_id = s.id
          AND lead_filter.assigned_user_id = $${params.length}::uuid
          AND lead_filter.cancelled_at IS NULL
          AND lead_filter.satisfies_lead_coverage = true
      )`
    );
  }
  if (filters.sport_type) {
    params.push(filters.sport_type);
    conditions.push(`COALESCE(spd.sport_name, '') = $${params.length}`);
  }
  if (filters.season) {
    params.push(filters.season);
    conditions.push(`COALESCE(spd.season, '') = $${params.length}`);
  }
  if (filters.proof_required !== undefined && filters.proof_required !== null) {
    params.push(filters.proof_required);
    conditions.push(`COALESCE(spd.proof_required, false) = $${params.length}`);
  }
  if (filters.revenue_share_enabled !== undefined && filters.revenue_share_enabled !== null) {
    params.push(filters.revenue_share_enabled);
    conditions.push(`COALESCE(spd.revenue_share_enabled, false) = $${params.length}`);
  }
  if (filters.banner_work_required !== undefined && filters.banner_work_required !== null) {
    params.push(filters.banner_work_required);
    conditions.push(`COALESCE(spd.banner_work_required, false) = $${params.length}`);
  }
  if (normalizeText(filters.search)) {
    params.push(`%${normalizeText(filters.search)}%`);
    const searchIndex = params.length;
    conditions.push(
      `(
        s.job_number ILIKE $${searchIndex}
        OR s.shoot_code ILIKE $${searchIndex}
        OR s.title ILIKE $${searchIndex}
        OR COALESCE(o.display_name, '') ILIKE $${searchIndex}
        OR COALESCE(sl.name, s.location_name, '') ILIKE $${searchIndex}
        OR COALESCE(oc.full_name, s.primary_contact_name, '') ILIKE $${searchIndex}
        OR EXISTS (
          SELECT 1
          FROM sports_team_unit team_search
          WHERE team_search.tenant_id = s.tenant_id
            AND team_search.shoot_id = s.id
            AND team_search.team_name ILIKE $${searchIndex}
        )
      )`
    );
  }

  const { rows } = await client.query<SportsShootSummaryRow>(
    `
      SELECT
        s.id::text,
        s.shoot_code,
        s.job_number,
        s.title,
        s.organization_id::text,
        o.display_name AS organization_name,
        s.location_id::text,
        COALESCE(sl.name, s.location_name) AS location_name,
        s.primary_contact_id::text,
        COALESCE(oc.full_name, s.primary_contact_name, s.unresolved_primary_contact_name) AS primary_contact_name,
        s.account_owner_user_id::text,
        account_owner.full_name AS account_owner_name,
        s.shoot_date::text,
        to_char(sd.start_time, 'HH24:MI:SS') AS start_time,
        to_char(sd.end_time, 'HH24:MI:SS') AS end_time,
        s.time_zone AS timezone,
        s.status::text AS shoot_status_raw,
        s.schedule_sync_state::text AS sync_status_raw,
        s.delivery_due_date::text,
        s.planned_staff_count,
        s.minimum_staff_count,
        s.required_lead_count,
        s.lead_confirmed_ready,
        s.lead_confirmed_ready_at::text,
        lead_confirmer.full_name AS lead_confirmed_ready_by_name,
        spd.sport_name AS sport_type,
        spd.season,
        spd.league_name,
        spd.division,
        spd.team_structure,
        spd.proof_required,
        spd.proof_due_date::text,
        spd.revenue_share_enabled,
        spd.banner_work_required,
        spd.specialty_products_required AS specialty_products_enabled,
        spd.team_count_estimate AS estimated_team_count,
        spd.athlete_count_estimate AS estimated_subject_count,
        lead_assignment.assigned_user_id::text AS lead_photographer_user_id,
        lead_assignment.lead_name AS lead_photographer_name,
        COALESCE(staffing.scheduled_employee_count, 0)::int AS scheduled_employee_count,
        COALESCE(staffing.lead_coverage_count, 0)::int AS lead_coverage_count,
        COALESCE(staffing.clocked_in_employee_count, 0)::int AS clocked_in_employee_count,
        COALESCE(readiness.blocker_count, 0)::int AS blocker_count,
        COALESCE(readiness.incomplete_required_count, 0)::int AS incomplete_required_count,
        COALESCE(readiness.incomplete_blocker_count, 0)::int AS incomplete_blocker_count,
        COALESCE(flags.watch_flag_count, 0)::int AS watch_flag_count,
        flags.highest_watch_severity,
        COALESCE(production.production_item_count, 0)::int AS production_item_count,
        COALESCE(production.blocked_production_count, 0)::int AS blocked_production_count,
        COALESCE(production.awaiting_approval_count, 0)::int AS awaiting_approval_count,
        COALESCE(production.overdue_proof_count, 0)::int AS overdue_proof_count,
        COALESCE(products.specialty_due_count, 0)::int AS specialty_due_count,
        s.updated_at::text AS last_updated_at
      FROM shoot s
      LEFT JOIN organization o
        ON o.tenant_id = s.tenant_id
       AND o.id = s.organization_id
      LEFT JOIN shoot_location sl
        ON sl.tenant_id = s.tenant_id
       AND sl.id = s.location_id
      LEFT JOIN organization_contact oc
        ON oc.tenant_id = s.tenant_id
       AND oc.id = s.primary_contact_id
      LEFT JOIN app_user account_owner
        ON account_owner.id = s.account_owner_user_id
      LEFT JOIN app_user lead_confirmer
        ON lead_confirmer.id = s.lead_confirmed_ready_by_user_id
      LEFT JOIN shoot_day sd
        ON sd.tenant_id = s.tenant_id
       AND sd.shoot_id = s.id
       AND sd.day_index = 0
      LEFT JOIN shoot_sports_detail spd
        ON spd.tenant_id = s.tenant_id
       AND spd.shoot_id = s.id
      LEFT JOIN LATERAL (
        SELECT
          MIN(ws.assigned_user_id::text)::uuid AS assigned_user_id,
          MIN(au.full_name) AS lead_name
        FROM work_shift ws
        LEFT JOIN app_user au
          ON au.id = ws.assigned_user_id
        WHERE ws.tenant_id = s.tenant_id
          AND ws.shoot_id = s.id
          AND ws.cancelled_at IS NULL
          AND ws.status IN ('draft', 'published', 'completed')
          AND ws.satisfies_lead_coverage = true
      ) lead_assignment ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(DISTINCT ws.assigned_user_id)::int AS scheduled_employee_count,
          COUNT(*) FILTER (WHERE ws.satisfies_lead_coverage = true)::int AS lead_coverage_count,
          (
            SELECT COUNT(DISTINCT sp.user_id)::int
            FROM shift_punch sp
            JOIN work_shift ws2
              ON ws2.id = sp.shift_id
            WHERE ws2.tenant_id = s.tenant_id
              AND ws2.shoot_id = s.id
              AND sp.direction = 'in'
          ) AS clocked_in_employee_count
        FROM work_shift ws
        WHERE ws.tenant_id = s.tenant_id
          AND ws.shoot_id = s.id
          AND ws.cancelled_at IS NULL
          AND ws.status IN ('draft', 'published', 'completed')
      ) staffing ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE item.blocking)::int AS blocker_count,
          COUNT(*) FILTER (WHERE item.blocking AND item.status = 'pending'::shoot_readiness_item_status)::int AS incomplete_required_count,
          COUNT(*) FILTER (WHERE item.blocking AND item.status = 'pending'::shoot_readiness_item_status)::int AS incomplete_blocker_count
        FROM shoot_readiness_item item
        WHERE item.tenant_id = s.tenant_id
          AND item.shoot_id = s.id
      ) readiness ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE flag.status IN ('open', 'acknowledged'))::int AS watch_flag_count,
          (
            SELECT severity
            FROM shoot_watch_flag flag_severity
            WHERE flag_severity.tenant_id = s.tenant_id
              AND flag_severity.shoot_id = s.id
              AND flag_severity.status IN ('open', 'acknowledged')
            ORDER BY
              CASE lower(flag_severity.severity)
                WHEN 'critical' THEN 5
                WHEN 'high' THEN 4
                WHEN 'medium' THEN 3
                WHEN 'low' THEN 2
                ELSE 1
              END DESC,
              flag_severity.created_at DESC
            LIMIT 1
          ) AS highest_watch_severity
        FROM shoot_watch_flag flag
        WHERE flag.tenant_id = s.tenant_id
          AND flag.shoot_id = s.id
      ) flags ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS production_item_count,
          COUNT(*) FILTER (
            WHERE project.status = 'blocked'::production_project_status
               OR project.stage = 'blocked'::production_project_stage
          )::int AS blocked_production_count,
          COUNT(*) FILTER (
            WHERE project.stage IN (
              'ready_for_qa'::production_project_stage,
              'in_qa_review'::production_project_stage,
              'ready_to_release'::production_project_stage
            )
          )::int AS awaiting_approval_count,
          COUNT(*) FILTER (
            WHERE project.due_date IS NOT NULL
              AND project.due_date < current_date
              AND project.status <> 'completed'::production_project_status
              AND project.status <> 'canceled'::production_project_status
          )::int AS overdue_proof_count
        FROM production_project project
        WHERE project.tenant_id = s.tenant_id
          AND project.linked_shoot_id = s.id
      ) production ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (
            WHERE product.due_date IS NOT NULL
              AND product.due_date <= current_date + 7
              AND product.status NOT IN ('complete', 'delivered', 'cancelled')
          )::int AS specialty_due_count
        FROM sports_specialty_product_item product
        WHERE product.tenant_id = s.tenant_id
          AND product.shoot_id = s.id
      ) products ON true
      WHERE ${conditions.join(" AND ")}
      ORDER BY s.shoot_date ASC NULLS LAST, sd.start_time ASC NULLS LAST, s.updated_at DESC
    `,
    params
  );

  return rows;
}

function mapSportsShootSummary(row: SportsShootSummaryRow): SportsShootSummary {
  const readiness_status = toSportsReadinessStatus(row);
  return {
    id: row.id,
    job_number: row.job_number,
    shoot_code: row.shoot_code,
    title: row.title,
    event_name: row.title,
    organization_id: row.organization_id,
    organization_name: row.organization_name,
    location_id: row.location_id,
    location_name: row.location_name,
    primary_contact_id: row.primary_contact_id,
    primary_contact_name: row.primary_contact_name,
    account_owner_user_id: row.account_owner_user_id,
    account_owner_name: row.account_owner_name,
    lead_photographer_user_id: row.lead_photographer_user_id,
    lead_photographer_name: row.lead_photographer_name,
    shoot_date: row.shoot_date,
    start_time: row.start_time,
    end_time: row.end_time,
    timezone: row.timezone,
    sport_type: row.sport_type,
    season: row.season,
    league_name: row.league_name,
    division: row.division,
    team_structure: row.team_structure,
    estimated_team_count: row.estimated_team_count,
    estimated_subject_count: row.estimated_subject_count,
    shoot_status: toSportsShootStatus(row.shoot_status_raw),
    production_status: toSportsProductionStatus(row),
    proof_status: toSportsProofStatus(row),
    staffing_status: toSportsStaffingStatus(row),
    readiness_status,
    sync_status: toSportsSyncStatus(row.sync_status_raw),
    risk_status: toSportsRiskStatus(row, readiness_status),
    proof_required: boolValue(row.proof_required),
    revenue_share_enabled: boolValue(row.revenue_share_enabled),
    banner_work_required: boolValue(row.banner_work_required),
    watch_flag_count: numericValue(row.watch_flag_count),
    blocker_count: numericValue(row.incomplete_blocker_count),
    last_updated_at: row.last_updated_at
  };
}

async function syncAutomaticWatchFlags(client: PoolClient, auth: AuthUser, shoot: SportsShootSummaryRow) {
  const requiredCount = Math.max(numericValue(shoot.minimum_staff_count), numericValue(shoot.required_lead_count));
  const assignedCount = numericValue(shoot.scheduled_employee_count);
  const leadMissing = numericValue(shoot.lead_coverage_count) === 0;
  const readinessRisk = numericValue(shoot.incomplete_blocker_count) > 0;
  const proofOverdue = boolValue(shoot.proof_required) && Boolean(shoot.proof_due_date) && shoot.proof_due_date! < isoDate(startOfToday());
  const approvalOwnerMissing = boolValue(shoot.proof_required) && !shoot.primary_contact_id;
  const syncError = toSportsSyncStatus(shoot.sync_status_raw) === "error";
  const productionBlocked = numericValue(shoot.blocked_production_count) > 0;
  const staffingGap = assignedCount < requiredCount;
  const dueSoon = shoot.shoot_date ? new Date(`${shoot.shoot_date}T12:00:00`) : null;
  const hoursUntilShoot = dueSoon ? (dueSoon.getTime() - Date.now()) / 3600000 : null;

  const automaticFlags = [
    {
      flag_type: "critical_readiness",
      active: readinessRisk && hoursUntilShoot !== null && hoursUntilShoot <= 72,
      severity: hoursUntilShoot !== null && hoursUntilShoot <= 24 ? "critical" : "high",
      title: "Critical readiness items still incomplete",
      description: "The shoot is approaching and blocker readiness items are still open."
    },
    {
      flag_type: "missing_lead",
      active: leadMissing && hoursUntilShoot !== null && hoursUntilShoot <= 72,
      severity: "high",
      title: "Lead photographer still missing",
      description: "A lead photographer still needs to be assigned before the shoot can stabilize."
    },
    {
      flag_type: "staffing_gap",
      active: staffingGap && hoursUntilShoot !== null && hoursUntilShoot <= 24,
      severity: "critical",
      title: "Staffing gap inside next 24 hours",
      description: "Assigned staffing is still below the required floor for this sports shoot."
    },
    {
      flag_type: "proof_overdue",
      active: proofOverdue,
      severity: "high",
      title: "Proof approval overdue",
      description: "Proofs are required and the due date has passed without final approval."
    },
    {
      flag_type: "blocked_production",
      active: productionBlocked,
      severity: "high",
      title: "Production is blocked",
      description: "At least one linked production item is currently blocked."
    },
    {
      flag_type: "sync_error",
      active: syncError,
      severity: "critical",
      title: "Sync or integrity warning",
      description: "The canonical sports shoot has an active sync error that needs intervention."
    },
    {
      flag_type: "missing_approval_owner",
      active: approvalOwnerMissing,
      severity: "medium",
      title: "Proof approval owner missing",
      description: "Proofs are required but there is no approval owner/contact linked yet."
    }
  ];

  for (const flag of automaticFlags) {
    const existing = await client.query<{ id: string; status: string }>(
      `
        SELECT id::text, status
        FROM shoot_watch_flag
        WHERE tenant_id = $1
          AND shoot_id = $2
          AND flag_type = $3
          AND status <> 'dismissed'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [auth.tenantId, shoot.id, flag.flag_type]
    );

    if (flag.active) {
      if (existing.rows[0]) {
        await client.query(
          `
            UPDATE shoot_watch_flag
            SET severity = $4,
                title = $5,
                description = $6,
                status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END,
                updated_at = now()
            WHERE tenant_id = $1
              AND shoot_id = $2
              AND id = $3::uuid
          `,
          [auth.tenantId, shoot.id, existing.rows[0].id, flag.severity, flag.title, flag.description]
        );
      } else {
        await client.query(
          `
            INSERT INTO shoot_watch_flag (tenant_id, shoot_id, severity, flag_type, title, description, status)
            VALUES ($1,$2,$3,$4,$5,$6,'open')
          `,
          [auth.tenantId, shoot.id, flag.severity, flag.flag_type, flag.title, flag.description]
        );
      }
    } else if (existing.rows[0] && existing.rows[0].status !== "resolved") {
      await client.query(
        `
          UPDATE shoot_watch_flag
          SET status = 'resolved',
              resolved_at = now(),
              resolved_by_user_id = $4::uuid,
              updated_at = now()
          WHERE tenant_id = $1
            AND shoot_id = $2
            AND id = $3::uuid
        `,
        [auth.tenantId, shoot.id, existing.rows[0].id, auth.id]
      );
    }
  }
}

async function syncWatchFlagsForResultSet(client: PoolClient, auth: AuthUser, rows: SportsShootSummaryRow[]) {
  for (const row of rows.slice(0, 50)) {
    await syncAutomaticWatchFlags(client, auth, row);
  }
}

function buildKpi(
  key: string,
  label: string,
  value: number,
  detail: string,
  action_hash: string,
  tone: SportsKpiCard["tone"]
): SportsKpiCard {
  return { key, label, value, detail, action_hash, tone };
}

function toOverviewListItem(item: SportsShootSummary, meta: string, action_hash: string): SportsOverviewListItem {
  return {
    id: item.id,
    title: item.title,
    summary: `${item.organization_name ?? "Organization"} | ${item.sport_type ?? "Sport pending"}`,
    tone: item.risk_status === "critical" ? "danger" : item.risk_status === "high" ? "warning" : item.readiness_status === "ready" ? "success" : "info",
    action_hash,
    shoot_id: item.id,
    organization_id: item.organization_id,
    due_at: item.shoot_date,
    meta
  };
}

export async function getSportsOverview(client: PoolClient, auth: AuthUser, options: { saved_view?: string | null } = {}): Promise<SportsOverviewResponse> {
  const anchorStart = startOfToday();
  const anchorEnd = addDays(anchorStart, 7);
  const rows = await loadSportsShootRows(client, auth, {
    date_from: isoDate(anchorStart),
    date_to: isoDate(anchorEnd)
  });
  const summaries = rows.map(mapSportsShootSummary);
  const urgent = summaries
    .filter((item) => item.risk_status === "critical" || item.readiness_status === "off_track" || item.staffing_status === "gap_flagged")
    .slice(0, 8);
  const productionBlocked = summaries.filter((item) => item.production_status === "blocked");
  const proofWaiting = summaries.filter((item) => item.proof_status === "overdue" || item.proof_status === "sent");
  const staffingRisk = summaries.filter(
    (item) => item.staffing_status === "gap_flagged" || item.staffing_status === "unassigned" || item.staffing_status === "partially_staffed"
  );
  const readyPings = summaries.filter(
    (item) => item.staffing_status === "ready_confirmed" || item.staffing_status === "checked_in" || item.shoot_status === "in_progress"
  );
  const accountRows = await listSportsAccounts(client, auth);

  return {
    generated_at: new Date().toISOString(),
    anchor_start: isoDate(anchorStart),
    anchor_end: isoDate(anchorEnd),
    permissions: buildSportsPermissionSnapshot(auth),
    saved_views: SPORTS_SAVED_VIEWS,
    kpis: [
      buildKpi("upcoming", "Upcoming shoots (next 7 days)", summaries.length, "Sports jobs in the next week.", "#sports/shoots?saved_view=next_14_days", "info"),
      buildKpi("at-risk", "At-risk shoots", summaries.filter((item) => item.readiness_status === "off_track" || item.risk_status === "critical").length, "Needs intervention.", "#sports/shoots?saved_view=at_risk", "danger"),
      buildKpi("staffing", "Missing staffing", staffingRisk.length, "Lead or crew coverage is short.", "#sports/shoots?saved_view=missing_staffing", staffingRisk.length ? "warning" : "success"),
      buildKpi("proofs", "Proofs awaiting approval", proofWaiting.length, "Awaiting client review or overdue.", "#sports/production?view=proof_queue", proofWaiting.length ? "warning" : "neutral"),
      buildKpi("blocked-production", "Production blocked", productionBlocked.length, "Linked downstream work is blocked.", "#sports/production?view=blocked", productionBlocked.length ? "danger" : "neutral"),
      buildKpi("specialty", "Specialty items due this week", rows.reduce((count, item) => count + (item.banner_work_required ? 1 : 0), 0), "Banners and specialty work approaching due dates.", "#sports/production?view=specialty_products", "info")
    ],
    urgent_watch: urgent.map((item) => toOverviewListItem(item, `${humanizeToken(item.risk_status)} risk`, "#sports/exceptions")),
    upcoming_shoots: summaries.slice(0, 8).map((item) => toOverviewListItem(item, `${item.shoot_date ?? "Date pending"} | ${item.location_name ?? "Location pending"}`, `#sports/shoots/${item.id}`)),
    staffing_readiness: staffingRisk.slice(0, 8).map((item) => toOverviewListItem(item, `${humanizeToken(item.staffing_status)} | ${item.lead_photographer_name ?? "Lead pending"}`, `#sports/shoots/${item.id}?tab=staffing`)),
    ready_pings: readyPings.slice(0, 8).map((item) => toOverviewListItem(item, `${humanizeToken(item.staffing_status)} | ${item.lead_photographer_name ?? "Lead pending"}`, `#sports/shoots/${item.id}?tab=staffing`)),
    production_bottlenecks: productionBlocked.slice(0, 8).map((item) => toOverviewListItem(item, `${humanizeToken(item.production_status)} | ${item.organization_name ?? "Organization"}`, `#sports/production?shoot=${item.id}`)),
    proof_and_products: proofWaiting.slice(0, 8).map((item) => toOverviewListItem(item, `${humanizeToken(item.proof_status)} | ${item.organization_name ?? "Organization"}`, `#sports/shoots/${item.id}?tab=proofs`)),
    account_health: accountRows.items.slice(0, 8).map((account) => ({
      id: account.id,
      title: account.organization_name,
      summary: `${humanizeToken(account.health_status)} | ${account.active_shoots_count} active sports job${account.active_shoots_count === 1 ? "" : "s"}`,
      tone: account.health_status === "critical" ? "danger" : account.health_status === "watch" ? "warning" : "success",
      action_hash: `#sports/accounts?organization=${account.id}`,
      organization_id: account.id,
      meta: account.next_shoot_date ? `Next shoot ${account.next_shoot_date}` : "No upcoming shoot"
    })),
    recent_activity: summaries.slice(0, 8).map((item) => ({
      id: item.id,
      title: item.title,
      summary: `${item.organization_name ?? "Organization"} | ${humanizeToken(item.shoot_status)} | ${humanizeToken(item.production_status)}`,
      tone: item.risk_status === "critical" ? "danger" : item.risk_status === "high" ? "warning" : "info",
      action_hash: `#sports/shoots/${item.id}`,
      shoot_id: item.id,
      organization_id: item.organization_id,
      meta: `Updated ${item.last_updated_at}`
    }))
  };
}

export async function listSportsShoots(
  client: PoolClient,
  auth: AuthUser,
  filters: SportsShootListFilters = {}
): Promise<SportsShootListResponse> {
  const rows = await loadSportsShootRows(client, auth, filters);
  await syncWatchFlagsForResultSet(client, auth, rows);
  const refreshedRows = await loadSportsShootRows(client, auth, filters);
  let items = refreshedRows.map(mapSportsShootSummary);

  if (filters.shoot_status) {
    items = items.filter((item) => item.shoot_status === filters.shoot_status);
  }
  if (filters.production_status) {
    items = items.filter((item) => item.production_status === filters.production_status);
  }
  if (filters.proof_status) {
    items = items.filter((item) => item.proof_status === filters.proof_status);
  }
  if (filters.staffing_status) {
    items = items.filter((item) => item.staffing_status === filters.staffing_status);
  }
  if (filters.readiness_status) {
    items = items.filter((item) => item.readiness_status === filters.readiness_status);
  }
  if (filters.risk_status) {
    items = items.filter((item) => item.risk_status === filters.risk_status);
  }

  return {
    generated_at: new Date().toISOString(),
    filters,
    permissions: buildSportsPermissionSnapshot(auth),
    saved_views: buildSavedViews(filters.saved_view),
    summary: {
      total: items.length,
      at_risk: items.filter((item) => item.readiness_status === "off_track" || item.risk_status === "critical").length,
      missing_staffing: items.filter((item) => item.staffing_status === "unassigned" || item.staffing_status === "gap_flagged").length,
      waiting_on_approval: items.filter((item) => item.proof_status === "sent" || item.proof_status === "overdue").length,
      production_blocked: items.filter((item) => item.production_status === "blocked").length,
      ready_to_shoot: items.filter((item) => item.shoot_status === "ready_to_shoot" || item.staffing_status === "ready_confirmed").length
    },
    items
  };
}

export async function listSportsAccounts(client: PoolClient, auth: AuthUser): Promise<{ items: SportsAccountSummary[] }> {
  const { rows } = await client.query<SportsAccountRow>(
    `
      SELECT
        o.id::text,
        o.display_name AS organization_name,
        o.account_type::text AS account_type,
        owner.full_name AS account_owner_name,
        COALESCE(MAX(
          CASE lower(flag.severity)
            WHEN 'critical' THEN 5
            WHEN 'high' THEN 4
            WHEN 'medium' THEN 3
            WHEN 'low' THEN 2
            ELSE 1
          END
        ), 1) AS health_rank,
        CASE
          WHEN COALESCE(MAX(CASE lower(flag.severity) WHEN 'critical' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 ELSE 1 END), 1) >= 5 THEN 'critical'
          WHEN COALESCE(MAX(CASE lower(flag.severity) WHEN 'critical' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 ELSE 1 END), 1) >= 3 THEN 'watch'
          ELSE 'healthy'
        END AS health_status,
        COUNT(DISTINCT s.id)::int AS active_shoots_count,
        MIN(s.shoot_date)::text AS next_shoot_date,
        COUNT(DISTINCT flag.id)::int AS open_issues,
        BOOL_OR(COALESCE(spd.revenue_share_enabled, false)) AS revenue_share_enabled,
        BOOL_OR(fin.pricing_profile_name IS NOT NULL OR fin.invoice_number IS NOT NULL) AS contract_or_pricing_flag,
        MAX(audit.created_at)::text AS last_touchpoint,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT spd.season), NULL) AS active_seasons
      FROM organization o
      JOIN shoot s
        ON s.tenant_id = o.tenant_id
       AND s.organization_id = o.id
       AND s.deleted_at IS NULL
       AND s.record_state = 'published'::shoot_record_state
       AND s.department = 'sports'::department_code
      LEFT JOIN app_user owner
        ON owner.id = s.account_owner_user_id
      LEFT JOIN shoot_sports_detail spd
        ON spd.tenant_id = s.tenant_id
       AND spd.shoot_id = s.id
      LEFT JOIN shoot_watch_flag flag
        ON flag.tenant_id = s.tenant_id
       AND flag.shoot_id = s.id
       AND flag.status IN ('open', 'acknowledged')
      LEFT JOIN sports_financial_summary fin
        ON fin.tenant_id = s.tenant_id
       AND fin.shoot_id = s.id
      LEFT JOIN audit_log audit
        ON audit.tenant_id = o.tenant_id
       AND audit.entity_type = 'organization'
       AND audit.entity_id = o.id::text
      WHERE o.tenant_id = $1
      GROUP BY o.id, o.display_name, o.account_type, owner.full_name
      ORDER BY next_shoot_date ASC NULLS LAST, organization_name ASC
    `,
    [auth.tenantId]
  );

  return {
    items: rows.map((row) => ({
      id: row.id,
      organization_name: row.organization_name,
      account_type: row.account_type,
      account_owner_name: row.account_owner_name,
      health_status: (row.health_status as SportsAccountSummary["health_status"]) ?? "healthy",
      active_seasons: row.active_seasons ?? [],
      active_shoots_count: numericValue(row.active_shoots_count),
      next_shoot_date: row.next_shoot_date,
      open_issues: numericValue(row.open_issues),
      revenue_share_enabled: boolValue(row.revenue_share_enabled),
      contract_or_pricing_flag: boolValue(row.contract_or_pricing_flag),
      last_touchpoint: row.last_touchpoint,
      last_production_turnaround_summary: null
    }))
  };
}

export async function listSportsContacts(client: PoolClient, auth: AuthUser): Promise<SportsContactsResponse> {
  const { rows } = await client.query<SportsContactRow>(
    `
      SELECT
        contact.id::text,
        contact.full_name,
        contact.organization_id::text,
        organization.display_name AS organization_name,
        contact.title AS role,
        CASE
          WHEN contact.phone IS NOT NULL THEN 'phone'
          WHEN contact.email IS NOT NULL THEN 'email'
          ELSE NULL
        END AS preferred_contact_method,
        contact.phone,
        contact.email,
        contact.role_category AS contact_type,
        COUNT(DISTINCT s.id)::int AS active_shoot_count,
        MAX(audit.created_at)::text AS last_interaction,
        BOOL_OR(spd.approval_contact_id = contact.id) AS approval_owner,
        BOOL_OR(spd.billing_contact_id = contact.id) AS billing_contact
      FROM organization_contact contact
      JOIN organization
        ON organization.id = contact.organization_id
      LEFT JOIN shoot s
        ON s.tenant_id = contact.tenant_id
       AND s.organization_id = contact.organization_id
       AND s.department = 'sports'::department_code
       AND s.record_state = 'published'::shoot_record_state
      LEFT JOIN shoot_sports_detail spd
        ON spd.tenant_id = s.tenant_id
       AND spd.shoot_id = s.id
      LEFT JOIN audit_log audit
        ON audit.tenant_id = contact.tenant_id
       AND audit.entity_type IN ('organization_contact', 'shoot')
       AND (audit.entity_id = contact.id::text OR audit.entity_id = s.id::text)
      WHERE contact.tenant_id = $1
      GROUP BY contact.id, organization.display_name
      HAVING COUNT(DISTINCT s.id) > 0
      ORDER BY contact.full_name ASC
    `,
    [auth.tenantId]
  );

  return {
    generated_at: new Date().toISOString(),
    permissions: buildSportsPermissionSnapshot(auth),
    items: rows.map((row) => ({
      id: row.id,
      full_name: row.full_name,
      organization_id: row.organization_id,
      organization_name: row.organization_name,
      role: row.role,
      preferred_contact_method: row.preferred_contact_method,
      phone: row.phone,
      email: row.email,
      contact_type: row.contact_type,
      active_shoot_count: numericValue(row.active_shoot_count),
      last_interaction: row.last_interaction,
      approval_owner: boolValue(row.approval_owner),
      billing_contact: boolValue(row.billing_contact)
    }))
  };
}

async function loadReadinessItems(client: PoolClient, tenantId: string, shootId: string): Promise<SportsReadinessChecklistItemRecord[]> {
  const { rows } = await client.query<SportsReadinessChecklistItemRecord>(
    `
      SELECT
        item.id::text,
        item.shoot_id::text,
        COALESCE(item.section, 'general') AS section,
        item.code,
        item.label,
        item.blocking AS is_required,
        item.blocking AS is_blocker,
        item.status IN ('resolved'::shoot_readiness_item_status, 'waived'::shoot_readiness_item_status) AS is_complete,
        item.resolved_at::text AS completed_at,
        item.completed_by_user_id::text,
        completer.full_name AS completed_by_name,
        item.detail AS notes,
        item.sort_order
      FROM shoot_readiness_item item
      LEFT JOIN app_user completer
        ON completer.id = item.completed_by_user_id
      WHERE item.tenant_id = $1
        AND item.shoot_id = $2
      ORDER BY item.section ASC, item.sort_order ASC, item.created_at ASC
    `,
    [tenantId, shootId]
  );
  return rows;
}

async function loadTeams(client: PoolClient, tenantId: string, shootId: string): Promise<SportsTeamUnitRecord[]> {
  const { rows } = await client.query<SportsTeamUnitRecord>(
    `
      SELECT
        team.id::text,
        team.shoot_id::text,
        team.team_name,
        team.display_order,
        team.age_group,
        team.division,
        team.coach_contact_id::text,
        coach.full_name AS coach_contact_name,
        team.proof_owner_contact_id::text,
        proof_owner.full_name AS proof_owner_contact_name,
        team.scheduled_slot_start::text,
        team.scheduled_slot_end::text,
        team.estimated_subject_count,
        team.actual_subject_count,
        team.banner_required,
        team.specialty_notes,
        team.status,
        team.created_at::text,
        team.updated_at::text
      FROM sports_team_unit team
      LEFT JOIN organization_contact coach
        ON coach.id = team.coach_contact_id
      LEFT JOIN organization_contact proof_owner
        ON proof_owner.id = team.proof_owner_contact_id
      WHERE team.tenant_id = $1
        AND team.shoot_id = $2
      ORDER BY team.display_order ASC, team.created_at ASC
    `,
    [tenantId, shootId]
  );
  return rows;
}

async function loadProofCycles(client: PoolClient, tenantId: string, shootId: string): Promise<SportsProofCycleRecord[]> {
  const { rows } = await client.query<SportsProofCycleRecord>(
    `
      SELECT
        cycle.id::text,
        cycle.shoot_id::text,
        cycle.production_item_id::text,
        project.title AS production_item_title,
        cycle.team_unit_id::text,
        team.team_name AS team_unit_name,
        cycle.approver_contact_id::text,
        approver.full_name AS approver_contact_name,
        cycle.status,
        cycle.sent_at::text,
        cycle.viewed_at::text,
        cycle.approved_at::text,
        cycle.revision_count,
        cycle.due_date::text,
        cycle.last_follow_up_at::text,
        cycle.notes,
        cycle.created_at::text,
        cycle.updated_at::text
      FROM sports_proof_cycle cycle
      LEFT JOIN production_project project
        ON project.id = cycle.production_item_id
      LEFT JOIN sports_team_unit team
        ON team.id = cycle.team_unit_id
      LEFT JOIN organization_contact approver
        ON approver.id = cycle.approver_contact_id
      WHERE cycle.tenant_id = $1
        AND cycle.shoot_id = $2
      ORDER BY cycle.due_date ASC NULLS LAST, cycle.created_at DESC
    `,
    [tenantId, shootId]
  );
  return rows;
}

async function loadSpecialtyProducts(
  client: PoolClient,
  tenantId: string,
  shootId: string
): Promise<SportsSpecialtyProductItemRecord[]> {
  const { rows } = await client.query<SportsSpecialtyProductItemRecord>(
    `
      SELECT
        item.id::text,
        item.shoot_id::text,
        item.production_item_id::text,
        project.title AS production_item_title,
        item.team_unit_id::text,
        team.team_name AS team_unit_name,
        item.product_type,
        item.title,
        item.quantity,
        item.status,
        item.approval_required,
        item.approved_at::text,
        item.assigned_to_user_id::text,
        assignee.full_name AS assigned_to_name,
        item.vendor_name,
        item.due_date::text,
        item.delivered_at::text,
        item.notes,
        item.created_at::text,
        item.updated_at::text
      FROM sports_specialty_product_item item
      LEFT JOIN production_project project
        ON project.id = item.production_item_id
      LEFT JOIN sports_team_unit team
        ON team.id = item.team_unit_id
      LEFT JOIN app_user assignee
        ON assignee.id = item.assigned_to_user_id
      WHERE item.tenant_id = $1
        AND item.shoot_id = $2
      ORDER BY item.due_date ASC NULLS LAST, item.created_at DESC
    `,
    [tenantId, shootId]
  );
  return rows;
}

async function loadFinancialSummary(
  client: PoolClient,
  tenantId: string,
  shootId: string,
  canViewFinance: boolean
): Promise<SportsFinancialSummaryRecord | null> {
  const { rows } = await client.query<SportsFinancialSummaryRecord>(
    `
      SELECT
        summary.id::text,
        summary.shoot_id::text,
        summary.pricing_profile_name,
        summary.invoice_number,
        summary.invoice_status,
        summary.invoice_due_date::text,
        summary.revenue_share_enabled,
        summary.revenue_share_terms_summary,
        ${canViewFinance ? "summary.estimated_revenue" : "NULL::numeric AS estimated_revenue"},
        ${canViewFinance ? "summary.actual_revenue" : "NULL::numeric AS actual_revenue"},
        ${canViewFinance ? "summary.estimated_cost" : "NULL::numeric AS estimated_cost"},
        ${canViewFinance ? "summary.actual_cost" : "NULL::numeric AS actual_cost"},
        ${canViewFinance ? "summary.payout_amount" : "NULL::numeric AS payout_amount"},
        summary.payment_status,
        summary.notes,
        summary.created_at::text,
        summary.updated_at::text
      FROM sports_financial_summary summary
      WHERE summary.tenant_id = $1
        AND summary.shoot_id = $2
      LIMIT 1
    `,
    [tenantId, shootId]
  );
  return rows[0] ?? null;
}

async function loadWatchFlags(client: PoolClient, tenantId: string, shootId: string): Promise<SportsWatchFlagRecord[]> {
  const { rows } = await client.query<SportsWatchFlagRecord>(
    `
      SELECT
        flag.id::text,
        flag.shoot_id::text,
        shoot.title AS shoot_title,
        shoot.organization_id::text,
        organization.display_name AS organization_name,
        flag.severity,
        flag.flag_type,
        flag.title,
        flag.description,
        flag.status,
        flag.owner_user_id::text,
        owner.full_name AS owner_name,
        flag.due_at::text,
        flag.resolved_at::text,
        flag.resolved_by_user_id::text,
        resolver.full_name AS resolved_by_name,
        flag.created_at::text,
        flag.updated_at::text
      FROM shoot_watch_flag flag
      JOIN shoot
        ON shoot.id = flag.shoot_id
      LEFT JOIN organization
        ON organization.id = shoot.organization_id
      LEFT JOIN app_user owner
        ON owner.id = flag.owner_user_id
      LEFT JOIN app_user resolver
        ON resolver.id = flag.resolved_by_user_id
      WHERE flag.tenant_id = $1
        AND flag.shoot_id = $2
      ORDER BY
        CASE lower(flag.severity)
          WHEN 'critical' THEN 5
          WHEN 'high' THEN 4
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 2
          ELSE 1
        END DESC,
        flag.created_at DESC
    `,
    [tenantId, shootId]
  );
  return rows;
}

async function loadStaffingPeople(client: PoolClient, tenantId: string, shootId: string): Promise<SportsStaffingPersonRecord[]> {
  const { rows } = await client.query<SportsStaffingPersonRecord>(
    `
      SELECT
        ws.id::text AS shift_id,
        ws.assigned_user_id::text AS user_id,
        au.full_name AS user_name,
        ws.staffing_role::text AS role_on_job,
        ws.status AS assignment_status,
        latest_in.captured_at::text AS check_in_at,
        latest_out.captured_at::text AS check_out_at,
        CASE
          WHEN shoot.lead_confirmed_ready AND ws.satisfies_lead_coverage = true THEN shoot.lead_confirmed_ready_at::text
          ELSE NULL
        END AS ready_confirmed_at,
        ws.notes
      FROM work_shift ws
      LEFT JOIN app_user au
        ON au.id = ws.assigned_user_id
      JOIN shoot
        ON shoot.id = ws.shoot_id
      LEFT JOIN LATERAL (
        SELECT sp.captured_at
        FROM shift_punch sp
        WHERE sp.shift_id = ws.id
          AND sp.direction = 'in'
        ORDER BY sp.captured_at DESC
        LIMIT 1
      ) latest_in ON true
      LEFT JOIN LATERAL (
        SELECT sp.captured_at
        FROM shift_punch sp
        WHERE sp.shift_id = ws.id
          AND sp.direction = 'out'
        ORDER BY sp.captured_at DESC
        LIMIT 1
      ) latest_out ON true
      WHERE ws.tenant_id = $1
        AND ws.shoot_id = $2
        AND ws.cancelled_at IS NULL
      ORDER BY ws.satisfies_lead_coverage DESC, au.full_name ASC NULLS LAST, ws.created_at ASC
    `,
    [tenantId, shootId]
  );
  return rows;
}

async function loadActivity(client: PoolClient, tenantId: string, shootId: string): Promise<SportsActivityEntry[]> {
  const { rows } = await client.query<{
    id: string;
    source: SportsActivityEntry["source"];
    event_type: string;
    summary: string;
    actor_user_id: string | null;
    actor_name: string | null;
    payload: Record<string, unknown> | null;
    created_at: string;
  }>(
    `
      SELECT
        entry.id::text,
        entry.source,
        entry.event_type,
        entry.summary,
        entry.actor_user_id::text,
        entry.actor_name,
        entry.payload,
        entry.created_at::text
      FROM (
        SELECT
          log.id,
          'shoot_activity_log'::text AS source,
          log.event_type,
          initcap(replace(log.event_type, '_', ' ')) AS summary,
          log.actor_user_id,
          actor.full_name AS actor_name,
          log.payload,
          log.created_at
        FROM shoot_activity_log log
        LEFT JOIN app_user actor
          ON actor.id = log.actor_user_id
        WHERE log.tenant_id = $1
          AND log.shoot_id = $2

        UNION ALL

        SELECT
          audit.id,
          'audit_log'::text AS source,
          audit.action AS event_type,
          initcap(replace(replace(audit.action, '.', ' '), '_', ' ')) AS summary,
          audit.actor_user_id,
          actor.full_name AS actor_name,
          audit.metadata AS payload,
          audit.created_at
        FROM audit_log audit
        LEFT JOIN app_user actor
          ON actor.id = audit.actor_user_id
        WHERE audit.tenant_id = $1
          AND audit.entity_type = 'shoot'
          AND audit.entity_id = $2
      ) entry
      ORDER BY entry.created_at DESC
      LIMIT 80
    `,
    [tenantId, shootId]
  );

  return rows;
}

async function loadJobDays(
  client: PoolClient,
  tenantId: string,
  shootId: string
): Promise<SportsShootDetailResponse["job_days"]> {
  const { rows } = await client.query<{
    id: string;
    day_index: number;
    shoot_date: string;
    start_time: string | null;
    end_time: string | null;
    timezone: string;
    location_id: string | null;
    location_name: string | null;
    status: string | null;
  }>(
    `
      SELECT
        day.id::text,
        day.day_index,
        day.shoot_date::text,
        day.start_time::text,
        day.end_time::text,
        day.time_zone AS timezone,
        day.location_id::text,
        COALESCE(location.name, shoot.location_name, shoot.unresolved_location_name) AS location_name,
        NULL::text AS status
      FROM shoot_day day
      JOIN shoot
        ON shoot.id = day.shoot_id
      LEFT JOIN shoot_location location
        ON location.id = day.location_id
      WHERE day.tenant_id = $1
        AND day.shoot_id = $2
      ORDER BY day.day_index ASC, day.shoot_date ASC
    `,
    [tenantId, shootId]
  );

  return rows;
}

async function loadProductionItems(
  client: PoolClient,
  tenantId: string,
  shootId: string
): Promise<SportsProductionItemSummary[]> {
  const { rows } = await client.query<SportsProductionItemSummary>(
    `
      SELECT
        project.id::text,
        project.linked_shoot_id::text AS linked_shoot_id,
        project.title,
        COALESCE(project.source_type::text, 'job') AS production_type,
        CASE
          WHEN project.status = 'blocked'::production_project_status OR project.stage = 'blocked'::production_project_stage THEN 'blocked'
          WHEN project.status = 'completed'::production_project_status THEN 'complete'
          WHEN project.stage = 'released'::production_project_stage THEN 'delivered'
          WHEN project.stage = 'ready_for_release'::production_project_stage THEN 'approved_for_production'
          WHEN project.stage = 'in_qa_review'::production_project_stage THEN 'proof_sent'
          WHEN project.stage = 'ready_for_qa'::production_project_stage THEN 'proof_build'
          WHEN project.stage = 'active_work'::production_project_stage THEN 'editing'
          WHEN project.stage = 'ready_for_production'::production_project_stage THEN 'queued'
          ELSE 'queued'
        END AS status,
        project.owner_user_id::text AS assigned_to_user_id,
        owner.full_name AS assigned_to_name,
        project.due_date::text,
        project.follow_up_date::text AS delivery_deadline,
        COALESCE(project.peer_review_required, false) AS proof_required,
        COALESCE(project.final_qc_required, false) AS approval_required,
        NULL::int AS file_count_expected,
        NULL::int AS file_count_received,
        NULL::text AS vendor_name,
        project.stage::text AS qa_status,
        blocker.blocked_reason,
        project.created_at::text,
        project.updated_at::text
      FROM production_project project
      LEFT JOIN app_user owner
        ON owner.id = project.owner_user_id
      LEFT JOIN LATERAL (
        SELECT string_agg(reason, '; ' ORDER BY created_at DESC) AS blocked_reason
        FROM production_project_blocker
        WHERE tenant_id = project.tenant_id
          AND project_id = project.id
          AND resolved_at IS NULL
      ) blocker ON true
      WHERE project.tenant_id = $1
        AND project.linked_shoot_id = $2
      ORDER BY project.due_date ASC NULLS LAST, project.created_at DESC
    `,
    [tenantId, shootId]
  );
  return rows;
}

async function loadSportsShootSummaryById(client: PoolClient, auth: AuthUser, shootId: string) {
  const rows = await loadSportsShootRows(client, auth, { search: null });
  return rows.find((row) => row.id === shootId) ?? null;
}

async function loadSportsShootDetailContext(
  client: PoolClient,
  tenantId: string,
  shootId: string
): Promise<{
  approval_contact_name: string | null;
  billing_contact_name: string | null;
  internal_notes: string | null;
  client_notes: string | null;
  special_instructions: string | null;
  event_notes: string | null;
  setup_notes: string | null;
  travel_notes: string | null;
  parking_notes: string | null;
  access_notes: string | null;
  client_expectations_notes: string | null;
} | null> {
  const { rows } = await client.query<{
    approval_contact_name: string | null;
    billing_contact_name: string | null;
    internal_notes: string | null;
    client_notes: string | null;
    special_instructions: string | null;
    event_notes: string | null;
    setup_notes: string | null;
    travel_notes: string | null;
    parking_notes: string | null;
    access_notes: string | null;
    client_expectations_notes: string | null;
  }>(
    `
      SELECT
        approval_contact.full_name AS approval_contact_name,
        billing_contact.full_name AS billing_contact_name,
        shoot.internal_notes,
        shoot.client_notes,
        shoot.special_instructions,
        detail.event_notes,
        detail.setup_notes,
        detail.travel_notes,
        detail.parking_notes,
        detail.access_notes,
        detail.client_expectations_notes
      FROM shoot
      LEFT JOIN shoot_sports_detail detail
        ON detail.tenant_id = shoot.tenant_id
       AND detail.shoot_id = shoot.id
      LEFT JOIN organization_contact approval_contact
        ON approval_contact.id = detail.approval_contact_id
      LEFT JOIN organization_contact billing_contact
        ON billing_contact.id = detail.billing_contact_id
      WHERE shoot.tenant_id = $1
        AND shoot.id = $2
      LIMIT 1
    `,
    [tenantId, shootId]
  );

  return rows[0] ?? null;
}

function buildReadinessAggregate(items: SportsReadinessChecklistItemRecord[], summary: SportsShootSummary) {
  const requiredCount = items.filter((item) => item.is_required).length;
  const completedRequiredCount = items.filter((item) => item.is_required && item.is_complete).length;
  const blockerCount = items.filter((item) => item.is_blocker && !item.is_complete).length;
  const warningCount = items.filter((item) => !item.is_blocker && item.is_required && !item.is_complete).length;
  return {
    status: summary.readiness_status,
    percent_complete: requiredCount ? Math.round((completedRequiredCount / requiredCount) * 100) : 100,
    blocker_count: blockerCount,
    warning_count: warningCount,
    items
  };
}

function buildLinkedContext(summary: SportsShootSummary) {
  return {
    organization_history_hash: summary.organization_id ? `#sports/accounts?organization=${summary.organization_id}` : null,
    location_history_hash: summary.location_id ? `#directory/locations?location=${summary.location_id}` : null,
    contact_history_hash: summary.primary_contact_id ? `#sports/contacts?contact=${summary.primary_contact_id}` : null,
    production_hash: `#sports/production?shoot=${summary.id}`
  };
}

function assertSportsManageAccess(auth: AuthUser) {
  if (!canManageSportsWorkspace(auth)) {
    throw new ApiError(403, "Sports management access is required.");
  }
}

function assertSportsFinanceManageAccess(auth: AuthUser) {
  if (!canManageSportsFinance(auth)) {
    throw new ApiError(403, "Sports financial access is required.");
  }
}

export async function getSportsShootDetail(
  client: PoolClient,
  auth: AuthUser,
  shootId: string
): Promise<SportsShootDetailResponse> {
  const baseRow = await loadSportsShootSummaryById(client, auth, shootId);
  if (!baseRow) {
    throw new ApiError(404, "Sports shoot not found.");
  }

  await syncAutomaticWatchFlags(client, auth, baseRow);
  const refreshedRow = (await loadSportsShootSummaryById(client, auth, shootId)) ?? baseRow;
  const summary = mapSportsShootSummary(refreshedRow);
  const permissionSnapshot = buildSportsPermissionSnapshot(auth);
  const detailContext = await loadSportsShootDetailContext(client, auth.tenantId, shootId);
  const readinessItems = await loadReadinessItems(client, auth.tenantId, shootId);
  const readyState = await getShootReadyToShootState(client, auth, shootId);

  return {
    generated_at: new Date().toISOString(),
    permissions: permissionSnapshot,
    summary,
    client_snapshot: {
      organization_name: summary.organization_name,
      primary_contact_name: summary.primary_contact_name,
      approval_contact_name: detailContext?.approval_contact_name ?? null,
      billing_contact_name: detailContext?.billing_contact_name ?? null,
      location_name: summary.location_name
    },
    notes: {
      internal_notes: detailContext?.internal_notes ?? null,
      client_notes: detailContext?.client_notes ?? null,
      special_instructions: detailContext?.special_instructions ?? null,
      event_notes: detailContext?.event_notes ?? null,
      setup_notes: detailContext?.setup_notes ?? null,
      travel_notes: detailContext?.travel_notes ?? null,
      parking_notes: detailContext?.parking_notes ?? null,
      access_notes: detailContext?.access_notes ?? null,
      client_expectations_notes: detailContext?.client_expectations_notes ?? null
    },
    readiness: buildReadinessAggregate(readinessItems, summary),
    job_days: await loadJobDays(client, auth.tenantId, shootId),
    staffing: {
      status: summary.staffing_status,
      assigned_count: numericValue(refreshedRow.scheduled_employee_count),
      required_count: Math.max(numericValue(refreshedRow.minimum_staff_count), numericValue(refreshedRow.required_lead_count)),
      lead_photographer_user_id: summary.lead_photographer_user_id,
      lead_photographer_name: summary.lead_photographer_name,
      lead_ready: {
        confirmed: Boolean(readyState?.already_confirmed ?? readyState?.lead_confirmed_ready),
        confirmed_at: readyState?.lead_confirmed_ready_at ?? readyState?.latest_confirmation?.confirmed_at ?? null,
        confirmed_by_name: readyState?.lead_confirmed_ready_by_name ?? readyState?.latest_confirmation?.confirmed_by_name ?? null,
        exception_flag: Boolean(readyState?.lead_confirmed_ready_exception_flag),
        available: Boolean(readyState?.show_action && readyState?.actor_is_authorized)
      },
      people: await loadStaffingPeople(client, auth.tenantId, shootId)
    },
    teams: await loadTeams(client, auth.tenantId, shootId),
    production_items: await loadProductionItems(client, auth.tenantId, shootId),
    proof_cycles: await loadProofCycles(client, auth.tenantId, shootId),
    specialty_products: await loadSpecialtyProducts(client, auth.tenantId, shootId),
    watch_flags: await loadWatchFlags(client, auth.tenantId, shootId),
    financial_summary: await loadFinancialSummary(client, auth.tenantId, shootId, permissionSnapshot.can_view_finance_detail),
    activity: await loadActivity(client, auth.tenantId, shootId),
    linked_context: buildLinkedContext(summary)
  };
}

export async function getSportsAccountDetail(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string
): Promise<SportsAccountDetailResponse> {
  const accounts = await listSportsAccounts(client, auth);
  const account = accounts.items.find((item) => item.id === organizationId);
  if (!account) {
    throw new ApiError(404, "Sports account not found.");
  }

  const allShoots = await listSportsShoots(client, auth, { organization_id: organizationId });
  const today = isoDate(startOfToday());
  const [contactsResult, locationsResult, flagsResult] = await Promise.all([
    client.query<{
      id: string;
      full_name: string;
      title: string | null;
      role_category: string | null;
      email: string | null;
      phone: string | null;
      approval_owner: boolean;
      billing_contact: boolean;
    }>(
      `
        SELECT DISTINCT
          contact.id::text,
          contact.full_name,
          contact.title,
          contact.role_category,
          contact.email,
          contact.phone,
          BOOL_OR(detail.approval_contact_id = contact.id) AS approval_owner,
          BOOL_OR(detail.billing_contact_id = contact.id) AS billing_contact
        FROM organization_contact contact
        JOIN shoot shoot
          ON shoot.tenant_id = contact.tenant_id
         AND shoot.organization_id = contact.organization_id
         AND shoot.department = 'sports'::department_code
         AND shoot.record_state = 'published'::shoot_record_state
        LEFT JOIN shoot_sports_detail detail
          ON detail.tenant_id = shoot.tenant_id
         AND detail.shoot_id = shoot.id
        WHERE contact.tenant_id = $1
          AND contact.organization_id = $2::uuid
        GROUP BY contact.id
        ORDER BY contact.full_name ASC
      `,
      [auth.tenantId, organizationId]
    ),
    client.query<{ id: string; name: string; address: string | null }>(
      `
        SELECT DISTINCT
          location.id::text,
          location.name,
          COALESCE(location.address_line1, location.address_city, location.address_state) AS address
        FROM shoot_location location
        JOIN shoot shoot
          ON shoot.tenant_id = location.tenant_id
         AND shoot.location_id = location.id
         AND shoot.organization_id = $2::uuid
         AND shoot.department = 'sports'::department_code
         AND shoot.record_state = 'published'::shoot_record_state
        WHERE location.tenant_id = $1
        ORDER BY location.name ASC
      `,
      [auth.tenantId, organizationId]
    ),
    client.query<SportsWatchFlagRecord>(
      `
        SELECT
          flag.id::text,
          flag.shoot_id::text,
          shoot.title AS shoot_title,
          shoot.organization_id::text,
          organization.display_name AS organization_name,
          flag.severity,
          flag.flag_type,
          flag.title,
          flag.description,
          flag.status,
          flag.owner_user_id::text,
          owner.full_name AS owner_name,
          flag.due_at::text,
          flag.resolved_at::text,
          flag.resolved_by_user_id::text,
          resolver.full_name AS resolved_by_name,
          flag.created_at::text,
          flag.updated_at::text
        FROM shoot_watch_flag flag
        JOIN shoot
          ON shoot.id = flag.shoot_id
        LEFT JOIN organization
          ON organization.id = shoot.organization_id
        LEFT JOIN app_user owner
          ON owner.id = flag.owner_user_id
        LEFT JOIN app_user resolver
          ON resolver.id = flag.resolved_by_user_id
        WHERE flag.tenant_id = $1
          AND shoot.organization_id = $2::uuid
          AND shoot.department = 'sports'::department_code
          AND flag.status IN ('open', 'acknowledged')
        ORDER BY flag.created_at DESC
      `,
      [auth.tenantId, organizationId]
    )
  ]);

  return {
    generated_at: new Date().toISOString(),
    permissions: buildSportsPermissionSnapshot(auth),
    account: {
      ...account,
      notes: null,
      linked_organization_hash: `#directory/accounts?organization=${organizationId}`
    },
    contacts: contactsResult.rows,
    linked_locations: locationsResult.rows,
    past_shoots: allShoots.items.filter((item) => item.shoot_date != null && item.shoot_date < today).slice(0, 12),
    upcoming_shoots: allShoots.items.filter((item) => item.shoot_date == null || item.shoot_date >= today).slice(0, 12),
    open_escalations: flagsResult.rows
  };
}

export async function listSportsProduction(client: PoolClient, auth: AuthUser): Promise<SportsProductionResponse> {
  const { rows } = await client.query<SportsProductionItemSummary>(
    `
      SELECT
        project.id::text,
        project.linked_shoot_id::text AS linked_shoot_id,
        project.title,
        COALESCE(project.source_type::text, 'job') AS production_type,
        CASE
          WHEN project.status = 'blocked'::production_project_status OR project.stage = 'blocked'::production_project_stage THEN 'blocked'
          WHEN project.status = 'completed'::production_project_status THEN 'complete'
          WHEN project.stage = 'released'::production_project_stage THEN 'delivered'
          WHEN project.stage = 'ready_for_release'::production_project_stage THEN 'approved_for_production'
          WHEN project.stage = 'in_qa_review'::production_project_stage THEN 'proof_sent'
          WHEN project.stage = 'ready_for_qa'::production_project_stage THEN 'proof_build'
          WHEN project.stage = 'active_work'::production_project_stage THEN 'editing'
          WHEN project.stage = 'ready_for_production'::production_project_stage THEN 'queued'
          ELSE 'queued'
        END AS status,
        project.owner_user_id::text AS assigned_to_user_id,
        owner.full_name AS assigned_to_name,
        project.due_date::text,
        project.follow_up_date::text AS delivery_deadline,
        COALESCE(project.peer_review_required, false) AS proof_required,
        COALESCE(project.final_qc_required, false) AS approval_required,
        NULL::int AS file_count_expected,
        NULL::int AS file_count_received,
        NULL::text AS vendor_name,
        project.stage::text AS qa_status,
        blocker.blocked_reason,
        project.created_at::text,
        project.updated_at::text
      FROM production_project project
      JOIN shoot shoot
        ON shoot.id = project.linked_shoot_id
       AND shoot.tenant_id = project.tenant_id
       AND shoot.department = 'sports'::department_code
       AND shoot.record_state = 'published'::shoot_record_state
      LEFT JOIN app_user owner
        ON owner.id = project.owner_user_id
      LEFT JOIN LATERAL (
        SELECT string_agg(reason, '; ' ORDER BY created_at DESC) AS blocked_reason
        FROM production_project_blocker
        WHERE tenant_id = project.tenant_id
          AND project_id = project.id
          AND resolved_at IS NULL
      ) blocker ON true
      WHERE project.tenant_id = $1
      ORDER BY project.due_date ASC NULLS LAST, project.updated_at DESC
    `,
    [auth.tenantId]
  );

  const proofCycles = await client.query<SportsProofCycleRecord>(
    `
      SELECT
        cycle.id::text,
        cycle.shoot_id::text,
        cycle.production_item_id::text,
        project.title AS production_item_title,
        cycle.team_unit_id::text,
        team.team_name AS team_unit_name,
        cycle.approver_contact_id::text,
        approver.full_name AS approver_contact_name,
        cycle.status,
        cycle.sent_at::text,
        cycle.viewed_at::text,
        cycle.approved_at::text,
        cycle.revision_count,
        cycle.due_date::text,
        cycle.last_follow_up_at::text,
        cycle.notes,
        cycle.created_at::text,
        cycle.updated_at::text
      FROM sports_proof_cycle cycle
      LEFT JOIN production_project project
        ON project.id = cycle.production_item_id
      LEFT JOIN sports_team_unit team
        ON team.id = cycle.team_unit_id
      LEFT JOIN organization_contact approver
        ON approver.id = cycle.approver_contact_id
      WHERE cycle.tenant_id = $1
      ORDER BY cycle.due_date ASC NULLS LAST, cycle.created_at DESC
    `,
    [auth.tenantId]
  );

  const specialtyProducts = await client.query<SportsSpecialtyProductItemRecord>(
    `
      SELECT
        item.id::text,
        item.shoot_id::text,
        item.production_item_id::text,
        project.title AS production_item_title,
        item.team_unit_id::text,
        team.team_name AS team_unit_name,
        item.product_type,
        item.title,
        item.quantity,
        item.status,
        item.approval_required,
        item.approved_at::text,
        item.assigned_to_user_id::text,
        assignee.full_name AS assigned_to_name,
        item.vendor_name,
        item.due_date::text,
        item.delivered_at::text,
        item.notes,
        item.created_at::text,
        item.updated_at::text
      FROM sports_specialty_product_item item
      LEFT JOIN production_project project
        ON project.id = item.production_item_id
      LEFT JOIN sports_team_unit team
        ON team.id = item.team_unit_id
      LEFT JOIN app_user assignee
        ON assignee.id = item.assigned_to_user_id
      WHERE item.tenant_id = $1
      ORDER BY item.due_date ASC NULLS LAST, item.created_at DESC
    `,
    [auth.tenantId]
  );

  return {
    generated_at: new Date().toISOString(),
    permissions: buildSportsPermissionSnapshot(auth),
    summary: {
      total: rows.length,
      proof_queue: proofCycles.rows.filter((item) => ["sent", "viewed", "overdue", "revisions_requested"].includes(String(item.status))).length,
      specialty_products: specialtyProducts.rows.length,
      qa_review: rows.filter((item) => item.qa_status === "ready_for_qa" || item.qa_status === "in_qa_review").length,
      blocked: rows.filter((item) => String(item.status) === "blocked").length
    },
    items: rows,
    proof_cycles: proofCycles.rows,
    specialty_products: specialtyProducts.rows
  };
}

export async function listSportsPeerQaBoard(client: PoolClient, auth: AuthUser): Promise<SportsPeerQaBoardResponse> {
  const { rows } = await client.query<SportsPeerQaRow>(
    `
      SELECT
        qa.id::text,
        qa.production_item_id::text,
        shoot_link.shoot_id::text AS linked_shoot_id,
        job.id::text AS job_id,
        job.title AS job_name,
        COALESCE(item.organization_id, job.organization_id)::text AS organization_id,
        org.display_name AS organization_name,
        COALESCE(item.shoot_date_start, job.scheduled_start_at::date)::text AS shoot_date,
        qa.qa_status,
        qa.sports_job_type,
        COALESCE(item.department_owner_user_id, item.assigned_to_user_id, job.account_owner_user_id)::text AS owner_user_id,
        owner.full_name AS owner_name,
        item.assigned_peer_reviewer_user_id::text AS peer_reviewer_user_id,
        peer.full_name AS peer_reviewer_name,
        item.assigned_release_reviewer_user_id::text AS final_reviewer_user_id,
        final_reviewer.full_name AS final_reviewer_name,
        qa.blocker_reason,
        qa.blocker_owner,
        qa.blocker_notes,
        qa.correction_category,
        qa.correction_notes,
        qa.known_exceptions,
        qa.owner_checklist_json,
        qa.peer_checklist_json,
        qa.conditional_checklist_json,
        qa.release_packet_json,
        qa.approved_for_release_at::text,
        GREATEST(qa.updated_at, item.updated_at, job.updated_at)::text AS last_updated_at
      FROM sports_peer_qa_reviews qa
      JOIN production_items item
        ON item.tenant_id = qa.tenant_id
       AND item.id = qa.production_item_id
       AND item.merged_into_production_item_id IS NULL
      JOIN jobs job
        ON job.tenant_id = item.tenant_id
       AND job.id = item.job_id
       AND job.department_type = 'sports'::job_department_type
       AND job.archived_at IS NULL
       AND job.cancelled_at IS NULL
      LEFT JOIN organization org
        ON org.tenant_id = job.tenant_id
       AND org.id = COALESCE(item.organization_id, job.organization_id)
      LEFT JOIN app_user owner
        ON owner.id = COALESCE(item.department_owner_user_id, item.assigned_to_user_id, job.account_owner_user_id)
      LEFT JOIN app_user peer
        ON peer.id = item.assigned_peer_reviewer_user_id
      LEFT JOIN app_user final_reviewer
        ON final_reviewer.id = item.assigned_release_reviewer_user_id
      LEFT JOIN LATERAL (
        SELECT link.shoot_id
        FROM production_item_shoot_links link
        WHERE link.tenant_id = item.tenant_id
          AND link.production_item_id = item.id
        ORDER BY link.created_at DESC
        LIMIT 1
      ) shoot_link ON true
      WHERE qa.tenant_id = $1
      ORDER BY
        CASE qa.qa_status
          WHEN 'corrections_needed' THEN 1
          WHEN 'blocked_waiting' THEN 2
          WHEN 'ready_for_peer_qa' THEN 3
          WHEN 'ready_for_spencer_review' THEN 4
          WHEN 'ready_for_owner_qa' THEN 5
          WHEN 'owner_qa_in_progress' THEN 6
          WHEN 'peer_qa_in_progress' THEN 7
          WHEN 'corrections_complete' THEN 8
          WHEN 'approved_for_release' THEN 9
          ELSE 10
        END,
        GREATEST(qa.updated_at, item.updated_at, job.updated_at) DESC
    `,
    [auth.tenantId]
  );
  const items = rows.map(mapSportsPeerQaRow);
  const summary = SPORTS_PEER_QA_STATUSES.reduce(
    (acc, status) => {
      acc[status] = items.filter((item) => item.qa_status === status).length;
      return acc;
    },
    { total: items.length, blocked: items.filter((item) => item.qa_status === "blocked_waiting").length } as SportsPeerQaBoardResponse["summary"]
  );
  return {
    generated_at: new Date().toISOString(),
    permissions: buildSportsPermissionSnapshot(auth),
    summary,
    items
  };
}

export async function listSportsWatchlist(client: PoolClient, auth: AuthUser): Promise<SportsWatchlistResponse> {
  const shootRows = await loadSportsShootRows(client, auth, {
    date_from: isoDate(addDays(startOfToday(), -7)),
    date_to: isoDate(addDays(startOfToday(), 30))
  });
  await syncWatchFlagsForResultSet(client, auth, shootRows);
  const { rows } = await client.query<SportsWatchFlagRecord>(
    `
      SELECT
        flag.id::text,
        flag.shoot_id::text,
        shoot.title AS shoot_title,
        shoot.organization_id::text,
        organization.display_name AS organization_name,
        flag.severity,
        flag.flag_type,
        flag.title,
        flag.description,
        flag.status,
        flag.owner_user_id::text,
        owner.full_name AS owner_name,
        flag.due_at::text,
        flag.resolved_at::text,
        flag.resolved_by_user_id::text,
        resolver.full_name AS resolved_by_name,
        flag.created_at::text,
        flag.updated_at::text
      FROM shoot_watch_flag flag
      JOIN shoot
        ON shoot.id = flag.shoot_id
       AND shoot.tenant_id = flag.tenant_id
       AND shoot.department = 'sports'::department_code
       AND shoot.record_state = 'published'::shoot_record_state
      LEFT JOIN organization
        ON organization.id = shoot.organization_id
      LEFT JOIN app_user owner
        ON owner.id = flag.owner_user_id
      LEFT JOIN app_user resolver
        ON resolver.id = flag.resolved_by_user_id
      WHERE flag.tenant_id = $1
        AND flag.status IN ('open', 'acknowledged')
      ORDER BY
        CASE lower(flag.severity)
          WHEN 'critical' THEN 5
          WHEN 'high' THEN 4
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 2
          ELSE 1
        END DESC,
        flag.due_at ASC NULLS LAST,
        flag.created_at DESC
    `,
    [auth.tenantId]
  );

  const now = Date.now();
  const next24Hours = rows.filter((item) => item.due_at && new Date(item.due_at).getTime() <= now + 24 * 60 * 60 * 1000).length;
  return {
    generated_at: new Date().toISOString(),
    permissions: buildSportsPermissionSnapshot(auth),
    summary: {
      next_24_hours: next24Hours,
      missing_staffing: rows.filter((item) => item.flag_type === "staffing_gap" || item.flag_type === "missing_lead").length,
      missing_critical_info: rows.filter((item) => item.flag_type === "critical_readiness" || item.flag_type === "missing_approval_owner").length,
      blocked_production: rows.filter((item) => item.flag_type === "blocked_production").length,
      overdue_approvals: rows.filter((item) => item.flag_type === "proof_overdue").length,
      overdue_delivery: rows.filter((item) => item.flag_type === "delivery_at_risk").length,
      open_escalations: rows.filter((item) => item.status === "open").length,
      sync_errors: rows.filter((item) => item.flag_type === "sync_error").length
    },
    items: rows
  };
}

export async function getSportsReports(client: PoolClient, auth: AuthUser): Promise<SportsReportsResponse> {
  const shoots = await listSportsShoots(client, auth, {});
  const watchlist = await listSportsWatchlist(client, auth);
  const production = await listSportsProduction(client, auth);
  return {
    generated_at: new Date().toISOString(),
    permissions: buildSportsPermissionSnapshot(auth),
    starter_metrics: [
      {
        key: "shoots_by_season",
        label: "Published sports shoots",
        value: shoots.summary.total,
        detail: "Canonical sports jobs currently visible in the department board."
      },
      {
        key: "readiness_rate",
        label: "Ready / on-track shoots",
        value: shoots.items.filter((item) => item.readiness_status === "ready" || item.readiness_status === "on_track").length,
        detail: "Department jobs that are not currently off track."
      },
      {
        key: "staffing_gap_rate",
        label: "Staffing gaps",
        value: shoots.summary.missing_staffing,
        detail: "Jobs still missing crew or lead coverage."
      },
      {
        key: "turnaround",
        label: "Production blocked",
        value: production.summary.blocked,
        detail: "Linked production work that needs intervention."
      },
      {
        key: "proof_delay",
        label: "Proof delays",
        value: watchlist.summary.overdue_approvals,
        detail: "Proof cycles that are overdue or awaiting action."
      },
      {
        key: "watch_flag_frequency",
        label: "Open exceptions",
        value: watchlist.items.length,
        detail: "Unresolved risks across the sports department."
      }
    ]
  };
}

export async function getSportsSettings(auth: AuthUser): Promise<SportsSettingsResponse> {
  return {
    generated_at: new Date().toISOString(),
    permissions: buildSportsPermissionSnapshot(auth),
    checklist_templates: [
      {
        sports_job_type: "team_day",
        section: "preflight",
        items: [
          { code: "MISSING_LOCATION", label: "Location confirmed", is_required: true, is_blocker: true, sort_order: 10 },
          { code: "MISSING_PRIMARY_CONTACT", label: "Primary contact confirmed", is_required: true, is_blocker: true, sort_order: 20 },
          { code: "MISSING_START_TIME", label: "Shoot time confirmed", is_required: true, is_blocker: true, sort_order: 30 },
          { code: "MISSING_STAFFING_ESTIMATE", label: "Crew target confirmed", is_required: true, is_blocker: false, sort_order: 40 }
        ]
      },
      {
        sports_job_type: "media_day",
        section: "proofing",
        items: [
          { code: "MISSING_DELIVERY_DUE_DATE", label: "Delivery deadline confirmed", is_required: true, is_blocker: true, sort_order: 10 },
          { code: "MISSING_SPECIALTY_PRODUCT_TYPES", label: "Specialty product list confirmed", is_required: false, is_blocker: false, sort_order: 20 }
        ]
      }
    ],
    product_type_presets: ["banners", "memory_mates", "sponsor_graphics", "senior_banners", "posters"],
    saved_view_keys: SPORTS_SAVED_VIEWS.map((item) => item.key),
    watch_flag_thresholds: [
      { key: "critical_readiness", label: "Critical readiness threshold", hours: 72 },
      { key: "missing_lead", label: "Missing lead threshold", hours: 72 },
      { key: "staffing_gap", label: "Staffing gap threshold", hours: 24 }
    ],
    role_visibility_notes: [
      "Financial detail is limited to leadership, finance, and explicit sports finance roles.",
      "Sports settings are leadership and admin only.",
      "Duplicate overrides and import publishing require lead/admin authority."
    ]
  };
}

async function assertSportsShootExists(client: PoolClient, auth: AuthUser, shootId: string) {
  const shoot = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM shoot
      WHERE tenant_id = $1
        AND id = $2
        AND deleted_at IS NULL
        AND record_state = 'published'::shoot_record_state
        AND department = 'sports'::department_code
    `,
    [auth.tenantId, shootId]
  );
  if (!shoot.rows[0]) {
    throw new ApiError(404, "Sports shoot not found.");
  }
}

export async function updateSportsReadinessItem(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  itemId: string,
  input: { is_complete: boolean; notes?: string | null },
  meta: RequestMeta = {}
) {
  assertSportsManageAccess(auth);
  await assertSportsShootExists(client, auth, shootId);
  const result = await client.query<{ id: string }>(
    `
      UPDATE shoot_readiness_item
      SET
        status = CASE WHEN $4 THEN 'resolved'::shoot_readiness_item_status ELSE 'pending'::shoot_readiness_item_status END,
        resolved_at = CASE WHEN $4 THEN now() ELSE NULL END,
        completed_by_user_id = CASE WHEN $4 THEN $5::uuid ELSE NULL END,
        detail = COALESCE($6, detail)
      WHERE tenant_id = $1
        AND shoot_id = $2
        AND id = $3::uuid
      RETURNING id::text
    `,
    [auth.tenantId, shootId, itemId, input.is_complete, auth.id, normalizeText(input.notes)]
  );
  if (!result.rows[0]) {
    throw new ApiError(404, "Readiness item not found.");
  }
  await logSportsActivity(client, auth, shootId, input.is_complete ? "readiness_item_completed" : "readiness_item_reopened", {
    readiness_item_id: itemId,
    notes: normalizeText(input.notes)
  }, meta);
  return getSportsShootDetail(client, auth, shootId);
}

export async function upsertSportsTeamUnit(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  input: SportsTeamUnitInput,
  options: { teamUnitId?: string | null } = {},
  meta: RequestMeta = {}
) {
  assertSportsManageAccess(auth);
  await assertSportsShootExists(client, auth, shootId);
  if (options.teamUnitId) {
    const result = await client.query<{ id: string }>(
      `
        UPDATE sports_team_unit
        SET
          team_name = $4,
          display_order = COALESCE($5, display_order),
          age_group = $6,
          division = $7,
          coach_contact_id = $8::uuid,
          proof_owner_contact_id = $9::uuid,
          scheduled_slot_start = $10::timestamptz,
          scheduled_slot_end = $11::timestamptz,
          estimated_subject_count = $12,
          actual_subject_count = $13,
          banner_required = COALESCE($14, false),
          specialty_notes = $15,
          status = COALESCE($16, status),
          updated_at = now()
        WHERE tenant_id = $1
          AND shoot_id = $2
          AND id = $3::uuid
        RETURNING id::text
      `,
      [
        auth.tenantId,
        shootId,
        options.teamUnitId,
        input.team_name,
        input.display_order ?? 0,
        normalizeText(input.age_group),
        normalizeText(input.division),
        normalizeText(input.coach_contact_id),
        normalizeText(input.proof_owner_contact_id),
        normalizeText(input.scheduled_slot_start),
        normalizeText(input.scheduled_slot_end),
        input.estimated_subject_count ?? null,
        input.actual_subject_count ?? null,
        input.banner_required ?? false,
        normalizeText(input.specialty_notes),
        normalizeText(input.status) ?? "planned"
      ]
    );
    if (!result.rows[0]) {
      throw new ApiError(404, "Sports team unit not found.");
    }
    await logSportsActivity(client, auth, shootId, "team_unit_updated", { team_unit_id: options.teamUnitId, team_name: input.team_name }, meta);
  } else {
    const created = await client.query<{ id: string }>(
      `
        INSERT INTO sports_team_unit (
          tenant_id, shoot_id, team_name, display_order, age_group, division, coach_contact_id, proof_owner_contact_id,
          scheduled_slot_start, scheduled_slot_end, estimated_subject_count, actual_subject_count, banner_required,
          specialty_notes, status
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7::uuid,$8::uuid,$9::timestamptz,$10::timestamptz,$11,$12,$13,$14,$15)
        RETURNING id::text
      `,
      [
        auth.tenantId,
        shootId,
        input.team_name,
        input.display_order ?? 0,
        normalizeText(input.age_group),
        normalizeText(input.division),
        normalizeText(input.coach_contact_id),
        normalizeText(input.proof_owner_contact_id),
        normalizeText(input.scheduled_slot_start),
        normalizeText(input.scheduled_slot_end),
        input.estimated_subject_count ?? null,
        input.actual_subject_count ?? null,
        input.banner_required ?? false,
        normalizeText(input.specialty_notes),
        normalizeText(input.status) ?? "planned"
      ]
    );
    await logSportsActivity(client, auth, shootId, "team_unit_created", { team_unit_id: created.rows[0]?.id ?? null, team_name: input.team_name }, meta);
  }
  return getSportsShootDetail(client, auth, shootId);
}

export async function deleteSportsTeamUnit(client: PoolClient, auth: AuthUser, shootId: string, teamUnitId: string, meta: RequestMeta = {}) {
  assertSportsManageAccess(auth);
  await assertSportsShootExists(client, auth, shootId);
  const result = await client.query<{ id: string }>(
    `
      DELETE FROM sports_team_unit
      WHERE tenant_id = $1
        AND shoot_id = $2
        AND id = $3::uuid
      RETURNING id::text
    `,
    [auth.tenantId, shootId, teamUnitId]
  );
  if (!result.rows[0]) {
    throw new ApiError(404, "Sports team unit not found.");
  }
  await logSportsActivity(client, auth, shootId, "team_unit_deleted", { team_unit_id: teamUnitId }, meta);
  return getSportsShootDetail(client, auth, shootId);
}

export async function upsertSportsWatchFlag(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  input: SportsWatchFlagMutationInput,
  options: { flagId?: string | null } = {},
  meta: RequestMeta = {}
) {
  assertSportsManageAccess(auth);
  await assertSportsShootExists(client, auth, shootId);
  if (options.flagId) {
    const result = await client.query<{ id: string }>(
      `
        UPDATE shoot_watch_flag
        SET
          severity = COALESCE($4, severity),
          flag_type = COALESCE($5, flag_type),
          title = COALESCE($6, title),
          description = $7,
          status = COALESCE($8, status),
          owner_user_id = $9::uuid,
          due_at = $10::timestamptz,
          resolved_at = CASE WHEN COALESCE($8, status) IN ('resolved', 'dismissed') THEN COALESCE(resolved_at, now()) ELSE NULL END,
          resolved_by_user_id = CASE WHEN COALESCE($8, status) IN ('resolved', 'dismissed') THEN $11::uuid ELSE NULL END,
          updated_at = now()
        WHERE tenant_id = $1
          AND shoot_id = $2
          AND id = $3::uuid
        RETURNING id::text
      `,
      [
        auth.tenantId,
        shootId,
        options.flagId,
        normalizeText(input.severity),
        normalizeText(input.flag_type),
        normalizeText(input.title),
        normalizeText(input.description),
        normalizeText(input.status),
        normalizeText(input.owner_user_id),
        normalizeText(input.due_at),
        auth.id
      ]
    );
    if (!result.rows[0]) {
      throw new ApiError(404, "Sports watch flag not found.");
    }
    await logSportsActivity(client, auth, shootId, "watch_flag_updated", { watch_flag_id: options.flagId, status: normalizeText(input.status) }, meta);
  } else {
    const created = await client.query<{ id: string }>(
      `
        INSERT INTO shoot_watch_flag (tenant_id, shoot_id, severity, flag_type, title, description, status, owner_user_id, due_at)
        VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'open'),$8::uuid,$9::timestamptz)
        RETURNING id::text
      `,
      [
        auth.tenantId,
        shootId,
        normalizeText(input.severity) ?? "medium",
        normalizeText(input.flag_type) ?? "manual_issue",
        normalizeText(input.title) ?? "Manual issue",
        normalizeText(input.description),
        normalizeText(input.status),
        normalizeText(input.owner_user_id),
        normalizeText(input.due_at)
      ]
    );
    await logSportsActivity(client, auth, shootId, "watch_flag_created", { watch_flag_id: created.rows[0]?.id ?? null }, meta);
  }
  return getSportsShootDetail(client, auth, shootId);
}

export async function upsertSportsProofCycle(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  input: SportsProofCycleInput,
  options: { proofCycleId?: string | null } = {},
  meta: RequestMeta = {}
) {
  assertSportsManageAccess(auth);
  await assertSportsShootExists(client, auth, shootId);
  if (options.proofCycleId) {
    const result = await client.query<{ id: string }>(
      `
        UPDATE sports_proof_cycle
        SET
          production_item_id = $4::uuid,
          team_unit_id = $5::uuid,
          approver_contact_id = $6::uuid,
          status = COALESCE($7, status),
          sent_at = $8::timestamptz,
          viewed_at = $9::timestamptz,
          approved_at = $10::timestamptz,
          revision_count = COALESCE($11, revision_count),
          due_date = $12::date,
          last_follow_up_at = $13::timestamptz,
          notes = $14,
          updated_at = now()
        WHERE tenant_id = $1
          AND shoot_id = $2
          AND id = $3::uuid
        RETURNING id::text
      `,
      [
        auth.tenantId,
        shootId,
        options.proofCycleId,
        normalizeText(input.production_item_id),
        normalizeText(input.team_unit_id),
        normalizeText(input.approver_contact_id),
        normalizeText(input.status),
        normalizeText(input.sent_at),
        normalizeText(input.viewed_at),
        normalizeText(input.approved_at),
        input.revision_count ?? null,
        normalizeText(input.due_date),
        normalizeText(input.last_follow_up_at),
        normalizeText(input.notes)
      ]
    );
    if (!result.rows[0]) {
      throw new ApiError(404, "Sports proof cycle not found.");
    }
    await logSportsActivity(client, auth, shootId, "proof_cycle_updated", { proof_cycle_id: options.proofCycleId, status: normalizeText(input.status) }, meta);
  } else {
    const created = await client.query<{ id: string }>(
      `
        INSERT INTO sports_proof_cycle (
          tenant_id, shoot_id, production_item_id, team_unit_id, approver_contact_id, status, sent_at, viewed_at,
          approved_at, revision_count, due_date, last_follow_up_at, notes
        )
        VALUES ($1,$2,$3::uuid,$4::uuid,$5::uuid,COALESCE($6,'not_started'),$7::timestamptz,$8::timestamptz,$9::timestamptz,$10,$11::date,$12::timestamptz,$13)
        RETURNING id::text
      `,
      [
        auth.tenantId,
        shootId,
        normalizeText(input.production_item_id),
        normalizeText(input.team_unit_id),
        normalizeText(input.approver_contact_id),
        normalizeText(input.status),
        normalizeText(input.sent_at),
        normalizeText(input.viewed_at),
        normalizeText(input.approved_at),
        input.revision_count ?? 0,
        normalizeText(input.due_date),
        normalizeText(input.last_follow_up_at),
        normalizeText(input.notes)
      ]
    );
    await logSportsActivity(client, auth, shootId, "proof_cycle_created", { proof_cycle_id: created.rows[0]?.id ?? null }, meta);
  }
  return getSportsShootDetail(client, auth, shootId);
}

export async function upsertSportsSpecialtyProduct(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  input: SportsProductItemInput,
  options: { productItemId?: string | null } = {},
  meta: RequestMeta = {}
) {
  assertSportsManageAccess(auth);
  await assertSportsShootExists(client, auth, shootId);
  if (options.productItemId) {
    const result = await client.query<{ id: string }>(
      `
        UPDATE sports_specialty_product_item
        SET
          production_item_id = $4::uuid,
          team_unit_id = $5::uuid,
          product_type = $6,
          title = $7,
          quantity = COALESCE($8, quantity),
          status = COALESCE($9, status),
          approval_required = COALESCE($10, approval_required),
          approved_at = $11::timestamptz,
          assigned_to_user_id = $12::uuid,
          vendor_name = $13,
          due_date = $14::date,
          delivered_at = $15::timestamptz,
          notes = $16,
          updated_at = now()
        WHERE tenant_id = $1
          AND shoot_id = $2
          AND id = $3::uuid
        RETURNING id::text
      `,
      [
        auth.tenantId,
        shootId,
        options.productItemId,
        normalizeText(input.production_item_id),
        normalizeText(input.team_unit_id),
        input.product_type,
        input.title,
        input.quantity ?? null,
        normalizeText(input.status),
        input.approval_required ?? null,
        normalizeText(input.approved_at),
        normalizeText(input.assigned_to_user_id),
        normalizeText(input.vendor_name),
        normalizeText(input.due_date),
        normalizeText(input.delivered_at),
        normalizeText(input.notes)
      ]
    );
    if (!result.rows[0]) {
      throw new ApiError(404, "Sports product item not found.");
    }
    await logSportsActivity(client, auth, shootId, "specialty_product_updated", { product_item_id: options.productItemId, status: normalizeText(input.status) }, meta);
  } else {
    const created = await client.query<{ id: string }>(
      `
        INSERT INTO sports_specialty_product_item (
          tenant_id, shoot_id, production_item_id, team_unit_id, product_type, title, quantity, status,
          approval_required, approved_at, assigned_to_user_id, vendor_name, due_date, delivered_at, notes
        )
        VALUES ($1,$2,$3::uuid,$4::uuid,$5,$6,$7,COALESCE($8,'queued'),COALESCE($9,false),$10::timestamptz,$11::uuid,$12,$13::date,$14::timestamptz,$15)
        RETURNING id::text
      `,
      [
        auth.tenantId,
        shootId,
        normalizeText(input.production_item_id),
        normalizeText(input.team_unit_id),
        input.product_type,
        input.title,
        input.quantity ?? 1,
        normalizeText(input.status),
        input.approval_required ?? false,
        normalizeText(input.approved_at),
        normalizeText(input.assigned_to_user_id),
        normalizeText(input.vendor_name),
        normalizeText(input.due_date),
        normalizeText(input.delivered_at),
        normalizeText(input.notes)
      ]
    );
    await logSportsActivity(client, auth, shootId, "specialty_product_created", { product_item_id: created.rows[0]?.id ?? null }, meta);
  }
  return getSportsShootDetail(client, auth, shootId);
}

export async function upsertSportsFinancialSummary(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  input: SportsFinancialSummaryInput,
  meta: RequestMeta = {}
) {
  assertSportsFinanceManageAccess(auth);
  await assertSportsShootExists(client, auth, shootId);
  await client.query(
    `
      INSERT INTO sports_financial_summary (
        tenant_id, shoot_id, pricing_profile_name, invoice_number, invoice_status, invoice_due_date,
        revenue_share_enabled, revenue_share_terms_summary, estimated_revenue, actual_revenue, estimated_cost,
        actual_cost, payout_amount, payment_status, notes
      )
      VALUES ($1,$2,$3,$4,COALESCE($5,'pending'),$6::date,COALESCE($7,false),$8,$9,$10,$11,$12,$13,COALESCE($14,'pending'),$15)
      ON CONFLICT (tenant_id, shoot_id)
      DO UPDATE SET
        pricing_profile_name = EXCLUDED.pricing_profile_name,
        invoice_number = EXCLUDED.invoice_number,
        invoice_status = EXCLUDED.invoice_status,
        invoice_due_date = EXCLUDED.invoice_due_date,
        revenue_share_enabled = EXCLUDED.revenue_share_enabled,
        revenue_share_terms_summary = EXCLUDED.revenue_share_terms_summary,
        estimated_revenue = EXCLUDED.estimated_revenue,
        actual_revenue = EXCLUDED.actual_revenue,
        estimated_cost = EXCLUDED.estimated_cost,
        actual_cost = EXCLUDED.actual_cost,
        payout_amount = EXCLUDED.payout_amount,
        payment_status = EXCLUDED.payment_status,
        notes = EXCLUDED.notes,
        updated_at = now()
    `,
    [
      auth.tenantId,
      shootId,
      normalizeText(input.pricing_profile_name),
      normalizeText(input.invoice_number),
      normalizeText(input.invoice_status),
      normalizeText(input.invoice_due_date),
      input.revenue_share_enabled ?? false,
      normalizeText(input.revenue_share_terms_summary),
      input.estimated_revenue ?? null,
      input.actual_revenue ?? null,
      input.estimated_cost ?? null,
      input.actual_cost ?? null,
      input.payout_amount ?? null,
      normalizeText(input.payment_status),
      normalizeText(input.notes)
    ]
  );
  await logSportsActivity(client, auth, shootId, "financial_summary_updated", {
    invoice_status: normalizeText(input.invoice_status),
    payment_status: normalizeText(input.payment_status)
  }, meta);
  return getSportsShootDetail(client, auth, shootId);
}
