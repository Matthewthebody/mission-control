import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { createAuditLog } from "./audit.js";
import { evaluatePunchLocation } from "./geo.js";
import { createAppEvent } from "./outbox.js";
import { findNotificationRecipients, queueNotificationDispatch } from "./opsNotifications.js";
import { hasAssignedShootLeadAuthority, hasManagerApprovalAuthority } from "./approvalRights.js";
import { getShootStaffingSnapshot } from "./scheduleStaffing.js";
import {
  isShootFinishedOnSite,
  isShootTerminalStatus,
  normalizeShootStatusValue
} from "./shootLifecycle.js";
import { getHomeAttendanceAwarenessWidget, type HomeAttendanceAwarenessEntry } from "./timeClockPresence.js";
import { getLocalDateString } from "../utils/localDate.js";

export const READY_TO_SHOOT_SETUP_WINDOW_LEAD_MINUTES = 45;
export const READY_TO_SHOOT_REMINDER_THRESHOLD_MINUTES = 20;
export const READY_TO_SHOOT_MANAGER_ESCALATION_MINUTES = 10;
export const READY_TO_SHOOT_WINDOW_AFTER_START_MINUTES = 15;

type ReadyToShootTone = "neutral" | "info" | "good" | "heads_up" | "action_needed";
type ReadyToShootStatus =
  | "not_available"
  | "awaiting_confirmation"
  | "reminder_due"
  | "escalation_due"
  | "confirmed_clean"
  | "confirmed_exception";

type ReadyToShootContextRow = {
  id: string;
  tenant_id: string;
  shoot_code: string;
  title: string;
  shoot_date: string | null;
  arrival_time: string | null;
  start_time: string | null;
  end_time_est: string | null;
  status: string | null;
  location_id: string | null;
  location_name: string | null;
  location_lat: number | null;
  location_lng: number | null;
  geofence_radius_meters: number | null;
  readiness_owner_user_id: string | null;
  pre_service_notes_complete: boolean;
  special_deliverables_ready: boolean;
  gear_requirements_ready: boolean;
  roster_data_required: boolean;
  roster_data_ready: boolean;
  additional_products_flag: boolean;
  special_equipment_flag: boolean;
  lead_confirmed_ready: boolean;
  lead_confirmed_ready_at: string | null;
  lead_confirmed_ready_by_user_id: string | null;
  lead_confirmed_ready_by_name: string | null;
  lead_confirmed_ready_exception_flag: boolean;
  lead_confirmed_ready_confirmation_id: string | null;
};

type ReadyToShootShiftRow = {
  id: string;
  assigned_user_id: string;
  assigned_user_name: string;
  staffing_role: string | null;
  satisfies_lead_coverage: boolean;
  status: string;
  manager_user_id: string | null;
  latest_punch_direction: "in" | "out" | null;
  latest_punch_at: string | null;
  observation_state: string | null;
  observation_captured_at: string | null;
  observation_linked_shift_id: string | null;
  observation_linked_shoot_id: string | null;
};

export type ReadyToShootSummaryFields = {
  lead_confirmed_ready: boolean;
  lead_confirmed_ready_at: string | null;
  lead_confirmed_ready_by_user_id: string | null;
  lead_confirmed_ready_by_name: string | null;
  lead_confirmed_ready_exception_flag: boolean;
  lead_confirmed_ready_confirmation_id: string | null;
  ready_to_shoot_status: ReadyToShootStatus;
  ready_to_shoot_label: string | null;
  ready_to_shoot_tone: ReadyToShootTone | null;
  ready_to_shoot_available: boolean;
  ready_to_shoot_setup_window_active: boolean;
  ready_to_shoot_reminder_due: boolean;
  ready_to_shoot_escalation_due: boolean;
  ready_to_shoot_minutes_until_start: number | null;
};

export type ReadyToShootCheckKey =
  | "lead_on_site"
  | "required_photographers_present"
  | "minimum_staffing_met"
  | "no_critical_missing_staff_signal"
  | "required_pre_service_items_complete";

export type ReadyToShootCheck = {
  key: ReadyToShootCheckKey;
  label: string;
  passed: boolean;
  detail: string;
};

export type ReadyToShootParticipant = {
  shift_id: string;
  user_id: string;
  name: string;
  role_label: string;
  is_photographer_role: boolean;
  is_lead_assignment: boolean;
  accounted_for: boolean;
  accounted_label: string;
  latest_punch_direction: "in" | "out" | null;
  latest_punch_at: string | null;
  presence_state: string | null;
  presence_captured_at: string | null;
};

export type ReadyToShootState = ReadyToShootSummaryFields & {
  show_action: boolean;
  already_confirmed: boolean;
  actor_is_authorized: boolean;
  actor_has_exception_authority: boolean;
  actor_on_site: boolean;
  checks: ReadyToShootCheck[];
  missing_items: string[];
  can_confirm_clean: boolean;
  can_confirm_with_exception: boolean;
  participants: ReadyToShootParticipant[];
  staffing_snapshot: {
    assigned_staff_count: number;
    minimum_staff_count: number;
    lead_coverage_count: number;
    open_required_slot_count: number;
    staffing_state: string | null;
    staffing_clean_for_ready: boolean;
    staffing_hard_blockers: string[];
    staffing_warnings: string[];
  };
  latest_confirmation: {
    id: string;
    confirmed_at: string;
    confirmed_by_user_id: string | null;
    confirmed_by_name: string | null;
    clean_confirmation: boolean;
    exception_reason: string | null;
    note: string | null;
    all_assigned_photographers_present: boolean;
  } | null;
  window: {
    shoot_is_today: boolean;
    starts_at: string | null;
    opens_at: string | null;
    closes_at: string | null;
    minutes_until_start: number | null;
  };
};

type ReadyToShootConfirmationRow = {
  id: string;
  confirmed_at: string;
  confirmed_by_user_id: string | null;
  confirmed_by_name: string | null;
  clean_confirmation: boolean;
  exception_reason: string | null;
  note: string | null;
  all_assigned_photographers_present: boolean;
};

type ReadyToShootConfirmationInput = {
  exception_reason?: string | null;
  note?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracy_meters?: number | null;
  device_context?: Record<string, unknown> | null;
};

type ReadyToShootRequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
  sourceSurface?: string | null;
};

function normalizeNullableText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

function normalizeTimeValue(value: string | null | undefined) {
  const normalized = normalizeNullableText(value);
  if (!normalized) {
    return null;
  }
  return /^\d{2}:\d{2}$/.test(normalized) ? `${normalized}:00` : normalized;
}

function toShootDateTime(shootDate: string | null | undefined, timeValue: string | null | undefined) {
  const rawTime = normalizeNullableText(timeValue);
  if (!rawTime) {
    return null;
  }
  const parsedDirect = new Date(rawTime);
  if (!Number.isNaN(parsedDirect.getTime())) {
    return parsedDirect;
  }
  const normalizedDate = normalizeNullableText(shootDate);
  const normalizedTime = normalizeTimeValue(rawTime);
  if (!normalizedDate || !normalizedTime) {
    return null;
  }
  const parsedCombined = new Date(`${normalizedDate}T${normalizedTime}`);
  return Number.isNaN(parsedCombined.getTime()) ? null : parsedCombined;
}

function formatShortTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function minutesUntil(target: Date | null, now: Date) {
  if (!target) {
    return null;
  }
  return Math.round((target.getTime() - now.getTime()) / 60000);
}

function deriveReadyToShootTiming(row: {
  shoot_date?: string | null;
  arrival_time?: string | null;
  start_time?: string | null;
  status?: string | null;
  lead_confirmed_ready?: boolean | null;
  lead_confirmed_ready_at?: string | null;
  lead_confirmed_ready_by_user_id?: string | null;
  lead_confirmed_ready_by_name?: string | null;
  lead_confirmed_ready_exception_flag?: boolean | null;
  lead_confirmed_ready_confirmation_id?: string | null;
}): ReadyToShootSummaryFields {
  const now = new Date();
  const shootDate = normalizeNullableText(row.shoot_date);
  const status = normalizeShootStatusValue(row.status);
  const alreadyConfirmed = Boolean(row.lead_confirmed_ready);
  const shootIsToday = Boolean(shootDate) && shootDate === getLocalDateString(now);
  const startAt = toShootDateTime(shootDate, row.start_time);
  const arrivalAt = toShootDateTime(shootDate, row.arrival_time);
  const opensAt =
    arrivalAt ??
    (startAt ? new Date(startAt.getTime() - READY_TO_SHOOT_SETUP_WINDOW_LEAD_MINUTES * 60 * 1000) : null);
  const closesAt = startAt ? new Date(startAt.getTime() + READY_TO_SHOOT_WINDOW_AFTER_START_MINUTES * 60 * 1000) : null;
  const setupWindowActive = Boolean(
    shootIsToday &&
      opensAt &&
      closesAt &&
      now.getTime() >= opensAt.getTime() &&
      now.getTime() <= closesAt.getTime()
  );
  const terminal = isShootFinishedOnSite(status) || isShootTerminalStatus(status);
  const minutesUntilStart = minutesUntil(startAt, now);
  const reminderDue = Boolean(
    !alreadyConfirmed &&
      shootIsToday &&
      !terminal &&
      minutesUntilStart != null &&
      minutesUntilStart <= READY_TO_SHOOT_REMINDER_THRESHOLD_MINUTES &&
      minutesUntilStart > READY_TO_SHOOT_MANAGER_ESCALATION_MINUTES
  );
  const escalationDue = Boolean(
    !alreadyConfirmed &&
      shootIsToday &&
      !terminal &&
      minutesUntilStart != null &&
      minutesUntilStart <= READY_TO_SHOOT_MANAGER_ESCALATION_MINUTES
  );
  const available = Boolean(!alreadyConfirmed && shootIsToday && !terminal && setupWindowActive);

  let readyStatus: ReadyToShootStatus = "not_available";
  let readyLabel: string | null = null;
  let readyTone: ReadyToShootTone | null = null;

  if (alreadyConfirmed && row.lead_confirmed_ready_exception_flag) {
    readyStatus = "confirmed_exception";
    readyLabel = "Ready with Exception";
    readyTone = "heads_up";
  } else if (alreadyConfirmed) {
    readyStatus = "confirmed_clean";
    readyLabel = "Lead Confirmed Ready";
    readyTone = "good";
  } else if (escalationDue) {
    readyStatus = "escalation_due";
    readyLabel = "Lead confirmation overdue";
    readyTone = "action_needed";
  } else if (reminderDue) {
    readyStatus = "reminder_due";
    readyLabel = "Awaiting lead confirmation";
    readyTone = "heads_up";
  } else if (available) {
    readyStatus = "awaiting_confirmation";
    readyLabel = "Ready to Shoot available";
    readyTone = "info";
  }

  return {
    lead_confirmed_ready: Boolean(row.lead_confirmed_ready),
    lead_confirmed_ready_at: normalizeNullableText(row.lead_confirmed_ready_at) ?? null,
    lead_confirmed_ready_by_user_id: normalizeNullableText(row.lead_confirmed_ready_by_user_id) ?? null,
    lead_confirmed_ready_by_name: normalizeNullableText(row.lead_confirmed_ready_by_name) ?? null,
    lead_confirmed_ready_exception_flag: Boolean(row.lead_confirmed_ready_exception_flag),
    lead_confirmed_ready_confirmation_id: normalizeNullableText(row.lead_confirmed_ready_confirmation_id) ?? null,
    ready_to_shoot_status: readyStatus,
    ready_to_shoot_label: readyLabel,
    ready_to_shoot_tone: readyTone,
    ready_to_shoot_available: available,
    ready_to_shoot_setup_window_active: setupWindowActive,
    ready_to_shoot_reminder_due: reminderDue,
    ready_to_shoot_escalation_due: escalationDue,
    ready_to_shoot_minutes_until_start: minutesUntilStart
  };
}

export function buildReadyToShootSummaryFields(row: {
  shoot_date?: string | null;
  arrival_time?: string | null;
  start_time?: string | null;
  status?: string | null;
  lead_confirmed_ready?: boolean | null;
  lead_confirmed_ready_at?: string | null;
  lead_confirmed_ready_by_user_id?: string | null;
  lead_confirmed_ready_by_name?: string | null;
  lead_confirmed_ready_exception_flag?: boolean | null;
  lead_confirmed_ready_confirmation_id?: string | null;
}): ReadyToShootSummaryFields {
  return deriveReadyToShootTiming(row);
}

function humanizeStaffingRole(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return "Assigned staff";
  }
  return normalized
    .split("_")
    .map((part) => (part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}

function isPhotographerRole(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "lead_photographer" || normalized === "senior_photographer" || normalized === "photographer";
}

function buildPreServiceGaps(shoot: ReadyToShootContextRow) {
  const gaps: string[] = [];
  if (!shoot.pre_service_notes_complete) {
    gaps.push("Pre-service briefing is incomplete.");
  }
  if (shoot.additional_products_flag && !shoot.special_deliverables_ready) {
    gaps.push("Special deliverables are not documented.");
  }
  if (shoot.special_equipment_flag && !shoot.gear_requirements_ready) {
    gaps.push("Gear requirements are not assigned.");
  }
  if (shoot.roster_data_required && !shoot.roster_data_ready) {
    gaps.push("Roster or data is not marked ready.");
  }
  return gaps;
}

function buildLocationContext(shoot: ReadyToShootContextRow, input: ReadyToShootConfirmationInput) {
  const hasCoordinates =
    typeof input.latitude === "number" &&
    typeof input.longitude === "number" &&
    typeof shoot.location_lat === "number" &&
    typeof shoot.location_lng === "number";

  const evaluation = hasCoordinates
    ? evaluatePunchLocation({
        targetLat: Number(shoot.location_lat),
        targetLng: Number(shoot.location_lng),
        radiusMeters: Math.max(Number(shoot.geofence_radius_meters ?? 500), 1),
        eventLat: input.latitude ?? null,
        eventLng: input.longitude ?? null,
        accuracyMeters: input.accuracy_meters ?? null,
        isAssignedContext: true
      })
    : null;

  return {
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    accuracy_meters: input.accuracy_meters ?? null,
    geofence_status: evaluation?.geofenceStatus ?? null,
    location_classification: evaluation?.locationClassification ?? null,
    distance_meters: evaluation?.distanceMeters ?? null
  };
}

async function loadReadyToShootContext(client: PoolClient, tenantId: string, shootId: string) {
  const { rows } = await client.query<ReadyToShootContextRow>(
    `
      SELECT
        s.id,
        s.tenant_id,
        s.shoot_code,
        s.title,
        s.shoot_date::text,
        s.arrival_time::text,
        s.start_time::text,
        s.end_time_est::text,
        s.status::text,
        s.location_id,
        s.location_name,
        s.location_lat,
        s.location_lng,
        s.geofence_radius_meters,
        s.readiness_owner_user_id,
        COALESCE(s.pre_service_notes_complete, false) AS pre_service_notes_complete,
        COALESCE(s.special_deliverables_ready, false) AS special_deliverables_ready,
        COALESCE(s.gear_requirements_ready, false) AS gear_requirements_ready,
        COALESCE(s.roster_data_required, false) AS roster_data_required,
        COALESCE(s.roster_data_ready, false) AS roster_data_ready,
        COALESCE(s.additional_products_flag, false) AS additional_products_flag,
        COALESCE(s.special_equipment_flag, false) AS special_equipment_flag,
        COALESCE(s.lead_confirmed_ready, false) AS lead_confirmed_ready,
        s.lead_confirmed_ready_at::text,
        s.lead_confirmed_ready_by_user_id,
        confirmer.full_name AS lead_confirmed_ready_by_name,
        COALESCE(s.lead_confirmed_ready_exception_flag, false) AS lead_confirmed_ready_exception_flag,
        s.lead_confirmed_ready_confirmation_id
      FROM shoot s
      LEFT JOIN app_user confirmer
        ON confirmer.id = s.lead_confirmed_ready_by_user_id
      WHERE s.tenant_id = $1
        AND s.id = $2
        AND s.deleted_at IS NULL
      LIMIT 1
    `,
    [tenantId, shootId]
  );

  return rows[0] ?? null;
}

async function listReadyToShootParticipants(client: PoolClient, tenantId: string, shootId: string) {
  const { rows } = await client.query<ReadyToShootShiftRow>(
    `
      SELECT
        ws.id,
        ws.assigned_user_id,
        au.full_name AS assigned_user_name,
        ws.staffing_role::text,
        COALESCE(ws.satisfies_lead_coverage, false) AS satisfies_lead_coverage,
        ws.status::text,
        ws.manager_user_id,
        latest_punch.direction::text AS latest_punch_direction,
        latest_punch.client_timestamp::text AS latest_punch_at,
        observation.current_state::text AS observation_state,
        observation.captured_at::text AS observation_captured_at,
        observation.linked_shift_id::text AS observation_linked_shift_id,
        observation.linked_shoot_id::text AS observation_linked_shoot_id
      FROM work_shift ws
      JOIN app_user au
        ON au.id = ws.assigned_user_id
       AND au.tenant_id = ws.tenant_id
      LEFT JOIN LATERAL (
        SELECT sp.direction, sp.client_timestamp
        FROM shift_punch sp
        WHERE sp.tenant_id = ws.tenant_id
          AND sp.shift_id = ws.id
        ORDER BY sp.client_timestamp DESC, sp.created_at DESC
        LIMIT 1
      ) latest_punch ON TRUE
      LEFT JOIN time_clock_presence_observation observation
        ON observation.tenant_id = ws.tenant_id
       AND observation.employee_id = ws.assigned_user_id
      WHERE ws.tenant_id = $1
        AND ws.shoot_id = $2
        AND ws.cancelled_at IS NULL
        AND ws.status IN ('draft', 'published', 'completed')
        AND au.status = 'active'
      ORDER BY ws.satisfies_lead_coverage DESC, ws.starts_at ASC, au.full_name ASC
    `,
    [tenantId, shootId]
  );

  return rows;
}

async function getLatestReadyToShootConfirmation(client: PoolClient, tenantId: string, shootId: string) {
  const { rows } = await client.query<ReadyToShootConfirmationRow>(
    `
      SELECT
        soc.id,
        soc.confirmed_at::text,
        soc.confirmed_by_user_id,
        confirmer.full_name AS confirmed_by_name,
        soc.clean_confirmation,
        soc.exception_reason,
        soc.note,
        soc.all_assigned_photographers_present
      FROM shoot_operational_confirmation soc
      LEFT JOIN app_user confirmer
        ON confirmer.id = soc.confirmed_by_user_id
      WHERE soc.tenant_id = $1
        AND soc.shoot_id = $2
        AND soc.confirmation_type = 'ready_to_shoot'
      ORDER BY soc.confirmed_at DESC, soc.created_at DESC
      LIMIT 1
    `,
    [tenantId, shootId]
  );

  return rows[0] ?? null;
}

function buildPresenceParticipants(rows: ReadyToShootShiftRow[], shootId: string): ReadyToShootParticipant[] {
  return rows.map((row) => {
    const punchBasedPresence = row.latest_punch_direction === "in";
    const observationBasedPresence =
      row.observation_state != null &&
      row.observation_state !== "off_clock" &&
      (row.observation_linked_shift_id === row.id || row.observation_linked_shoot_id === shootId);
    const accountedFor = punchBasedPresence || observationBasedPresence;

    return {
      shift_id: row.id,
      user_id: row.assigned_user_id,
      name: row.assigned_user_name,
      role_label: humanizeStaffingRole(row.staffing_role),
      is_photographer_role: isPhotographerRole(row.staffing_role),
      is_lead_assignment: Boolean(row.satisfies_lead_coverage),
      accounted_for: accountedFor,
      accounted_label: accountedFor
        ? punchBasedPresence
          ? "Clocked in"
          : "Marked present"
        : "Not yet accounted for",
      latest_punch_direction: row.latest_punch_direction,
      latest_punch_at: row.latest_punch_at ?? null,
      presence_state: row.observation_state ?? null,
      presence_captured_at: row.observation_captured_at ?? null
    };
  });
}

function filterCriticalAttendanceSignals(items: HomeAttendanceAwarenessEntry[], shootId: string) {
  return items.filter(
    (item) =>
      item.shoot_id === shootId &&
      (item.staffing_risk || item.operational_state === "wrong_location" || item.operational_state === "probable_no_show") &&
      (item.severity === "high" || item.severity === "critical")
  );
}

function summarizeMissingNames(participants: ReadyToShootParticipant[]) {
  const missing = participants.filter((participant) => !participant.accounted_for).map((participant) => participant.name);
  if (!missing.length) {
    return null;
  }
  return missing.join(", ");
}

export async function getShootReadyToShootState(
  client: PoolClient,
  auth: AuthUser,
  shootId: string
): Promise<ReadyToShootState | null> {
  const shoot = await loadReadyToShootContext(client, auth.tenantId, shootId);
  if (!shoot) {
    return null;
  }

  const summary = buildReadyToShootSummaryFields(shoot);
  const staffingSnapshot = await getShootStaffingSnapshot(client, auth, shootId);
  const participantRows = await listReadyToShootParticipants(client, auth.tenantId, shootId);
  const latestConfirmation = await getLatestReadyToShootConfirmation(client, auth.tenantId, shootId);
  const actorAuthorized = await hasAssignedShootLeadAuthority(client, auth, shootId);
  const actorHasExceptionAuthority = hasManagerApprovalAuthority(auth);
  const participants = buildPresenceParticipants(participantRows, shootId);
  const photographerParticipants = participants.filter((participant) => participant.is_photographer_role);
  const photographerPresentCount = photographerParticipants.filter((participant) => participant.accounted_for).length;
  const allAssignedPhotographersPresent =
    photographerParticipants.length > 0 && photographerPresentCount >= photographerParticipants.length;
  const actorParticipant = participants.find((participant) => participant.user_id === auth.id) ?? null;
  const actorOnSite = Boolean(actorParticipant?.accounted_for);
  const staffing = staffingSnapshot.shoot;
  const preServiceGaps = buildPreServiceGaps(shoot);

  let criticalAttendanceSignals: HomeAttendanceAwarenessEntry[] = [];
  if (shoot.shoot_date && shoot.shoot_date === getLocalDateString()) {
    const attendance = await getHomeAttendanceAwarenessWidget(client, {
      tenantId: auth.tenantId,
      anchorDate: shoot.shoot_date,
      shootId
    });
    criticalAttendanceSignals = filterCriticalAttendanceSignals(
      [
        ...attendance.missing_clock_in.items,
        ...attendance.critically_late.items,
        ...attendance.probable_no_show.items,
        ...attendance.wrong_location.items
      ],
      shootId
    );
  }

  const checks: ReadyToShootCheck[] = [
    {
      key: "lead_on_site",
      label: "Lead is on site",
      passed: actorOnSite,
      detail: actorOnSite ? "The confirming lead is clocked in or otherwise marked present." : "The confirming lead must be on site before confirming."
    },
    {
      key: "required_photographers_present",
      label: "Assigned photographers are present or accounted for",
      passed: allAssignedPhotographersPresent,
      detail:
        photographerParticipants.length > 0
          ? `${photographerPresentCount}/${photographerParticipants.length} assigned photographer${photographerParticipants.length === 1 ? "" : "s"} accounted for.`
          : "No photographer assignments are linked to this shoot yet."
    },
    {
      key: "minimum_staffing_met",
      label: "Staffing is at or above minimum",
      passed: Number(staffing.assigned_staff_count ?? 0) >= Number(staffing.minimum_staff_count ?? 0),
      detail: `${staffing.assigned_staff_count}/${staffing.minimum_staff_count} assigned against the minimum staffing threshold.`
    },
    {
      key: "no_critical_missing_staff_signal",
      label: "No unresolved critical missing-staff signal exists",
      passed: criticalAttendanceSignals.length === 0,
      detail:
        criticalAttendanceSignals.length === 0
          ? "No high-severity staffing or attendance signal is still unresolved."
          : `${criticalAttendanceSignals.length} critical staffing signal${criticalAttendanceSignals.length === 1 ? "" : "s"} still need review.`
    },
    {
      key: "required_pre_service_items_complete",
      label: "Required pre-service items are complete",
      passed: preServiceGaps.length === 0,
      detail: preServiceGaps.length === 0 ? "Briefing, data, gear, and special deliverables are complete." : preServiceGaps.join(" ")
    }
  ];

  const missingItems = checks.filter((check) => !check.passed).map((check) => check.detail);
  const alreadyConfirmed = summary.lead_confirmed_ready;
  const showAction = summary.ready_to_shoot_available && !alreadyConfirmed && actorAuthorized && actorOnSite;
  const canConfirmClean = showAction && actorAuthorized && actorOnSite && checks.every((check) => check.passed);
  const canConfirmWithException =
    showAction && actorAuthorized && actorOnSite && !checks.every((check) => check.passed) && actorHasExceptionAuthority;

  return {
    ...summary,
    show_action: showAction,
    already_confirmed: alreadyConfirmed,
    actor_is_authorized: actorAuthorized,
    actor_has_exception_authority: actorHasExceptionAuthority,
    actor_on_site: actorOnSite,
    checks,
    missing_items: missingItems,
    can_confirm_clean: canConfirmClean,
    can_confirm_with_exception: canConfirmWithException,
    participants,
    staffing_snapshot: {
      assigned_staff_count: Number(staffing.assigned_staff_count ?? 0),
      minimum_staff_count: Number(staffing.minimum_staff_count ?? 0),
      lead_coverage_count: Number(staffing.lead_coverage_count ?? 0),
      open_required_slot_count: Number(staffing.open_required_slot_count ?? 0),
      staffing_state: staffing.staffing_state ?? null,
      staffing_clean_for_ready: Boolean(staffing.staffing_clean_for_ready),
      staffing_hard_blockers: [...(staffing.staffing_hard_blockers ?? [])],
      staffing_warnings: [...(staffing.staffing_warnings ?? [])]
    },
    latest_confirmation: latestConfirmation,
    window: {
      shoot_is_today: shoot.shoot_date === getLocalDateString(),
      starts_at: toShootDateTime(shoot.shoot_date, shoot.start_time)?.toISOString() ?? null,
      opens_at:
        (
          toShootDateTime(shoot.shoot_date, shoot.arrival_time) ??
          (() => {
            const startAt = toShootDateTime(shoot.shoot_date, shoot.start_time);
            return startAt
              ? new Date(startAt.getTime() - READY_TO_SHOOT_SETUP_WINDOW_LEAD_MINUTES * 60 * 1000)
              : null;
          })()
        )?.toISOString() ?? null,
      closes_at:
        (() => {
          const startAt = toShootDateTime(shoot.shoot_date, shoot.start_time);
          return startAt
            ? new Date(startAt.getTime() + READY_TO_SHOOT_WINDOW_AFTER_START_MINUTES * 60 * 1000).toISOString()
            : null;
        })() ?? null,
      minutes_until_start: summary.ready_to_shoot_minutes_until_start
    }
  };
}

async function listManagerRecipients(client: PoolClient, tenantId: string, shootId: string) {
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT DISTINCT manager_user_id AS id
      FROM work_shift
      WHERE tenant_id = $1
        AND shoot_id = $2
        AND cancelled_at IS NULL
        AND manager_user_id IS NOT NULL
    `,
    [tenantId, shootId]
  );
  return rows.map((row) => row.id);
}

async function resolveNotificationRecipients(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  participantRows: ReadyToShootShiftRow[],
  readinessOwnerUserId: string | null,
  eventCode: string
) {
  const direct = new Set<string>([...(await listManagerRecipients(client, auth.tenantId, shootId))]);
  if (readinessOwnerUserId) {
    direct.add(readinessOwnerUserId);
  }
  const lookupShiftId = participantRows.find((row) => row.satisfies_lead_coverage)?.id ?? participantRows[0]?.id ?? null;
  return findNotificationRecipients(client, {
    tenantId: auth.tenantId,
    eventCode,
    shiftId: lookupShiftId,
    shootId,
    directUserIds: [...direct],
    excludeUserIds: [auth.id]
  });
}

export async function confirmShootReadyToShoot(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  input: ReadyToShootConfirmationInput,
  meta: ReadyToShootRequestMeta = {}
) {
  const shoot = await loadReadyToShootContext(client, auth.tenantId, shootId);
  if (!shoot) {
    throw new ApiError(404, "Shoot not found.");
  }

  const state = await getShootReadyToShootState(client, auth, shootId);
  if (!state) {
    throw new ApiError(404, "Shoot not found.");
  }

  if (state.already_confirmed) {
    throw new ApiError(409, "Ready to Shoot has already been confirmed for this shoot.");
  }

  if (!state.show_action || !state.actor_is_authorized) {
    throw new ApiError(403, "Only the assigned lead on site can submit Ready to Shoot for this shoot.");
  }

  if (!state.actor_on_site) {
    throw new ApiError(409, "The confirming lead must be clocked in or otherwise marked on site before confirming.");
  }

  const exceptionReason = normalizeNullableText(input.exception_reason);
  const note = normalizeNullableText(input.note);
  const cleanConfirmation = !exceptionReason;

  if (cleanConfirmation && !state.can_confirm_clean) {
    throw new ApiError(
      409,
      state.can_confirm_with_exception
        ? "Clean Ready to Shoot confirmation is blocked. Confirm with exception and add a reason if policy allows."
        : `Ready to Shoot is still blocked: ${state.missing_items.join(" ")}`
    );
  }

  if (!cleanConfirmation && !state.can_confirm_with_exception) {
    throw new ApiError(403, "Confirming Ready to Shoot with an exception requires manager-level authority on the shoot.");
  }

  const staffingSnapshot = {
    assigned_staff_count: state.staffing_snapshot.assigned_staff_count,
    minimum_staff_count: state.staffing_snapshot.minimum_staff_count,
    lead_coverage_count: state.staffing_snapshot.lead_coverage_count,
    open_required_slot_count: state.staffing_snapshot.open_required_slot_count,
    staffing_state: state.staffing_snapshot.staffing_state,
    staffing_clean_for_ready: state.staffing_snapshot.staffing_clean_for_ready,
    staffing_hard_blockers: state.staffing_snapshot.staffing_hard_blockers,
    staffing_warnings: state.staffing_snapshot.staffing_warnings
  };
  const photographerParticipants = state.participants.filter((participant) => participant.is_photographer_role);
  const photographerPresentCount = photographerParticipants.filter((participant) => participant.accounted_for).length;
  const allAssignedPhotographersPresent =
    photographerParticipants.length > 0 && photographerPresentCount >= photographerParticipants.length;
  const missingNames = summarizeMissingNames(photographerParticipants);
  const confirmedAt = new Date().toISOString();
  const locationContext = buildLocationContext(shoot, input);
  const deviceContext = {
    ...(input.device_context ?? {}),
    user_agent: meta.userAgent ?? null
  };

  const confirmationResult = await client.query<{ id: string }>(
    `
      INSERT INTO shoot_operational_confirmation (
        tenant_id,
        shoot_id,
        confirmation_type,
        confirmed_by_user_id,
        confirmed_at,
        staffing_snapshot,
        all_assigned_photographers_present,
        clean_confirmation,
        exception_reason,
        note,
        location_context,
        device_context
      )
      VALUES ($1,$2,'ready_to_shoot',$3,$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb,$11::jsonb)
      RETURNING id
    `,
    [
      auth.tenantId,
      shootId,
      auth.id,
      confirmedAt,
      JSON.stringify(staffingSnapshot),
      allAssignedPhotographersPresent,
      cleanConfirmation,
      exceptionReason,
      note,
      JSON.stringify(locationContext),
      JSON.stringify(deviceContext)
    ]
  );
  const confirmationId = confirmationResult.rows[0]!.id;

  await client.query(
    `
      UPDATE shoot
      SET
        lead_confirmed_ready = true,
        lead_confirmed_ready_at = $3::timestamptz,
        lead_confirmed_ready_by_user_id = $4,
        lead_confirmed_ready_exception_flag = $5,
        lead_confirmed_ready_confirmation_id = $6,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, shootId, confirmedAt, auth.id, !cleanConfirmation, confirmationId]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: cleanConfirmation ? "shoot.ready_to_shoot.confirmed" : "shoot.ready_to_shoot.confirmed_with_exception",
    entityType: "shoot",
    entityId: shootId,
    sourceSurface: meta.sourceSurface ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    reasonComment: exceptionReason ?? note ?? null,
    previousValues: {
      lead_confirmed_ready: shoot.lead_confirmed_ready,
      lead_confirmed_ready_at: shoot.lead_confirmed_ready_at,
      lead_confirmed_ready_by_user_id: shoot.lead_confirmed_ready_by_user_id,
      lead_confirmed_ready_exception_flag: shoot.lead_confirmed_ready_exception_flag
    },
    newValues: {
      lead_confirmed_ready: true,
      lead_confirmed_ready_at: confirmedAt,
      lead_confirmed_ready_by_user_id: auth.id,
      lead_confirmed_ready_exception_flag: !cleanConfirmation,
      lead_confirmed_ready_confirmation_id: confirmationId
    },
    metadata: {
      confirmation_id: confirmationId,
      confirmation_type: "ready_to_shoot",
      staffing_snapshot: staffingSnapshot,
      all_assigned_photographers_present: allAssignedPhotographersPresent,
      missing_names: missingNames,
      location_context: locationContext
    }
  });

  await createAppEvent(client, {
    tenantId: auth.tenantId,
    eventType: "schedule.realtime.changed",
    aggregateType: "shoot",
    aggregateId: shootId,
    dedupeKey: `ready-to-shoot:${confirmationId}`,
    payload: {
      shoot_id: shootId,
      shoot_code: shoot.shoot_code,
      ready_to_shoot: true,
      exception_flag: !cleanConfirmation
    }
  });

  const participants = await listReadyToShootParticipants(client, auth.tenantId, shootId);
  const notificationType = cleanConfirmation ? "shoot.ready_to_shoot_confirmed" : "shoot.ready_to_shoot_exception";
  const recipients = await resolveNotificationRecipients(
    client,
    auth,
    shootId,
    participants,
    shoot.readiness_owner_user_id ?? null,
    notificationType
  );
  const formattedTime = formatShortTime(confirmedAt) ?? confirmedAt;
  const title = cleanConfirmation
    ? `${shoot.title} is ready to shoot`
    : `${shoot.title} marked ready with exception`;
  const body = cleanConfirmation
    ? `${shoot.title} is set up and ready to shoot. Confirmed by ${auth.fullName} at ${formattedTime}. ${photographerPresentCount}/${Math.max(
        photographerParticipants.length,
        photographerPresentCount
      )} photographers present.`
    : `${shoot.title} marked ready with exception. Confirmed by ${auth.fullName} at ${formattedTime}. ${photographerPresentCount}/${Math.max(
        photographerParticipants.length,
        photographerPresentCount
      )} photographers present.${missingNames ? ` Missing: ${missingNames}.` : ""}`;

  if (recipients.length) {
    await queueNotificationDispatch(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      recipientUserIds: recipients,
      notificationType,
      title,
      body,
      shootId,
      deepLink: `#operations/shoots?shoot=${shootId}`,
      channels: ["in_app", "push"],
      category: "urgent_operational_risk",
      severity: cleanConfirmation ? "high" : "critical",
      actionRequired: !cleanConfirmation,
      sourceEvent: notificationType,
      groupKey: `ready-to-shoot:${shootId}`,
      metadata: {
        confirmation_id: confirmationId,
        confirmed_by_name: auth.fullName,
        confirmed_at: confirmedAt,
        clean_confirmation: cleanConfirmation,
        exception_reason: exceptionReason,
        staffing_snapshot: staffingSnapshot,
        all_assigned_photographers_present: allAssignedPhotographersPresent,
        missing_names: missingNames
      }
    });
  }

  return {
    confirmation_id: confirmationId,
    confirmed_at: confirmedAt
  };
}
