import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import {
  canAssignStaffOnLiveShoot,
  canCreateOrEditCalendarDepartment,
  hasAuthorityTier,
  hasJobFunctionProfile
} from "../authz/authority.js";
import {
  assertTradeRoleLevelEligible,
  canUserApprovePTORequest,
  canUserApproveTradeRequest,
  findTradeAcceptanceConflict,
  resolveTradeAllowShiftTrade,
  resolveTradeLevelRank,
  resolvePTOApproverUserIds,
  resolveTradeApproverUserIds
} from "./approvalRouting.js";
import { createAuditLog } from "./audit.js";
import {
  loadAvailabilityWindowsForUsersOnDate,
  syncAvailabilityImpactsForUser,
  type AvailabilityRequestStatus,
  type AvailabilityWindow
} from "./availabilityRequests.js";
import { getShiftCloseoutCompliance } from "./postShootEvaluations.js";
import { beginDangerousAction, completeDangerousAction, failDangerousAction } from "./dangerousActions.js";
import { createAppEvent } from "./outbox.js";
import { buildGoogleMapsLink, estimateDriveMinutesFromStudio, getDefaultShootGeofenceMeters, getStudioLocation, type StudioLocation } from "./maps.js";
import { findNotificationRecipients, queueNotificationDispatch } from "./opsNotifications.js";
import { queueShootChangedWithin48HoursAlert } from "./operationalAlerting.js";
import { queueWorkShiftOutlookSync } from "./outlookCalendarSync.js";
import { assertShiftAccess, assertShiftManagementScope, shouldDepartmentScopeShiftList, shouldRestrictShiftList } from "./shiftAccess.js";
import { getTimeClockStateSummary } from "./timeClockRuntime.js";
import type { AuthUser, DepartmentCode } from "../types/auth.js";
import type { NotificationChannel, ShiftSegmentKind, TradeRequestStatus, WorkShiftKind } from "../types/domain.js";
import { getLocalDateString } from "../utils/localDate.js";

export type ShiftSegmentInput = {
  segment_kind: ShiftSegmentKind;
  label: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  rate_code: string;
  hourly_rate_cents: number;
  sort_order?: number;
};

export type WorkShiftInput = {
  shoot_id?: string | null;
  studio_id?: string | null;
  assigned_user_id: string;
  manager_user_id?: string | null;
  shift_kind: WorkShiftKind;
  department: DepartmentCode;
  staffing_role?: "lead_photographer" | "senior_photographer" | "photographer" | "support" | "check_in" | "assistant" | "producer" | "custom";
  satisfies_lead_coverage?: boolean;
  title: string;
  starts_at: string;
  ends_at: string;
  location_name?: string;
  location_address?: string;
  location_lat?: number | null;
  location_lng?: number | null;
  geofence_radius_meters?: number | null;
  notes?: string | null;
  segments?: ShiftSegmentInput[];
};

export type ShiftListFilters = {
  dateFrom?: string;
  dateTo?: string;
  assignedUserId?: string;
  shootId?: string;
  status?: "draft" | "published" | "cancelled" | "completed";
};

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type LegacyPTOReviewStatus = Extract<AvailabilityRequestStatus, "approved"> | "denied";

type ShiftLocation = {
  studioId: string | null;
  title: string;
  locationName: string;
  locationAddress: string;
  locationLat: number | null;
  locationLng: number | null;
  geofenceRadiusMeters: number;
  navigationUrl: string | null;
  estimatedDriveMinutes: number | null;
};

type MaterialShiftSnapshot = {
  assigned_user_id: string;
  starts_at: string;
  ends_at: string;
  location_name: string;
  location_address: string;
  location_lat: number | null;
  location_lng: number | null;
};

type ShiftCoworker = {
  id: string;
  email: string;
  full_name: string;
  roles: string[];
};

type ShiftCoworkerContext = {
  shoot_id?: string | null;
  assigned_user_id: string;
};

type ScheduleMemberSummaryRow = {
  id: string;
  email: string;
  full_name: string;
  department: string;
  roles: string[];
  authority_tier: string | null;
  primary_job_function_profile: string | null;
  job_function_profiles: string[];
};

type AvailabilityBlock = {
  id: string;
  kind: "shift" | "event";
  title: string;
  starts_at: string;
  ends_at: string;
};

const FIELD_STAFF_PROFILES = new Set([
  "associate_photographer",
  "seasonal_photographer",
  "part_time_photographer",
  "senior_photographer",
  "director_of_photography",
  "director_of_school_photography",
  "director_of_sports_photography"
]);

const LEAD_QUALIFIED_PROFILES = new Set([
  "lead_photographer",
  "senior_photographer",
  "director_of_photography",
  "director_of_school_photography",
  "director_of_sports_photography"
]);

function formatShiftWindow(startsAt: string, endsAt: string) {
  return `${new Date(startsAt).toLocaleString()} - ${new Date(endsAt).toLocaleTimeString()}`;
}

function channelsForPriority(priority: "normal" | "high" | "critical"): NotificationChannel[] {
  if (priority === "critical") {
    return ["in_app", "push", "sms", "email"];
  }
  if (priority === "high") {
    return ["in_app", "push", "email"];
  }
  return ["in_app"];
}

function uniqueUserIds(ids: Array<string | null | undefined>) {
  return [...new Set(ids.filter((value): value is string => Boolean(value)))];
}

function parseDateOnly(value: string) {
  return new Date(`${value}T12:00:00`);
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

function getWeekBounds(anchorDate: string) {
  const anchor = parseDateOnly(anchorDate);
  const weekday = anchor.getDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = addDays(anchor, mondayOffset);
  return {
    startDate: formatDateOnly(monday),
    endDate: formatDateOnly(addDays(monday, 6))
  };
}

function isFieldStaffEligible(member: {
  roles?: string[] | null;
  primary_job_function_profile?: string | null;
  job_function_profiles?: string[] | null;
}) {
  const profiles = [member.primary_job_function_profile, ...(member.job_function_profiles ?? [])].filter(
    (value): value is string => Boolean(value)
  );
  return profiles.some((profile) => FIELD_STAFF_PROFILES.has(profile)) || (member.roles ?? []).some((role) => ["lead_photographer", "senior_photographer", "director_of_photography"].includes(role));
}

function isLeadQualifiedMember(member: {
  roles?: string[] | null;
  primary_job_function_profile?: string | null;
  job_function_profiles?: string[] | null;
}) {
  const profiles = [member.primary_job_function_profile, ...(member.job_function_profiles ?? [])].filter(
    (value): value is string => Boolean(value)
  );
  return (
    profiles.some((profile) => LEAD_QUALIFIED_PROFILES.has(profile)) ||
    (member.roles ?? []).some((role) => ["lead_photographer", "senior_photographer", "director_of_photography"].includes(role))
  );
}

function isBlockActive(block: AvailabilityBlock, now: Date) {
  return new Date(block.starts_at).getTime() <= now.getTime() && new Date(block.ends_at).getTime() > now.getTime();
}

function formatBlockWindow(block: AvailabilityBlock) {
  const start = new Date(block.starts_at);
  const end = new Date(block.ends_at);
  return `${start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - ${end.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  })}`;
}

function rangesOverlap(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string) {
  return new Date(leftStart).getTime() < new Date(rightEnd).getTime() && new Date(leftEnd).getTime() > new Date(rightStart).getTime();
}

function isAvailabilityWindowActive(window: AvailabilityWindow, now: Date) {
  return rangesOverlap(window.starts_at, window.ends_at, now.toISOString(), new Date(now.getTime() + 1000).toISOString());
}

function availabilityWindowLabel(window: AvailabilityWindow) {
  switch (window.availability_state) {
    case "approved_time_off":
      return window.label || "Approved time off";
    case "sick_same_day_absence":
      return window.label || "Same-day absence";
    case "blocked_by_manager_admin":
      return window.label || "Blocked by manager";
    case "company_holiday_closed":
      return window.label || "Company holiday";
    case "availability_restriction":
      return window.label || "Availability restriction";
    case "submitted_request_warning":
      return window.label || "Pending availability review";
    default:
      return window.label || "Availability change";
  }
}

function pushValue(values: unknown[], value: unknown) {
  values.push(value);
  return `$${values.length}`;
}

async function emitScheduleRealtimeChange(
  client: PoolClient,
  input: {
    tenantId: string;
    shiftId: string;
    shootId?: string | null;
    title: string;
    status: string;
    changeType: "created" | "updated" | "published";
    versionToken: string;
  }
) {
  await createAppEvent(client, {
    tenantId: input.tenantId,
    eventType: "schedule.realtime.changed",
    aggregateType: "work_shift",
    aggregateId: input.shiftId,
    dedupeKey: `schedule-realtime:${input.changeType}:${input.shiftId}:${input.versionToken}`,
    payload: {
      shift_id: input.shiftId,
      shoot_id: input.shootId ?? null,
      title: input.title,
      status: input.status,
      change_type: input.changeType
    }
  });
}

async function getStudioRow(client: PoolClient, studioId?: string | null) {
  if (!studioId) {
    return null;
  }
  const { rows } = await client.query("SELECT * FROM studio WHERE id = $1 LIMIT 1", [studioId]);
  return rows[0] ?? null;
}

async function getShootRow(client: PoolClient, shootId?: string | null) {
  if (!shootId) {
    return null;
  }
  const { rows } = await client.query("SELECT * FROM shoot WHERE id = $1 AND deleted_at IS NULL LIMIT 1", [shootId]);
  return rows[0] ?? null;
}

async function buildShiftLocation(client: PoolClient, input: WorkShiftInput): Promise<ShiftLocation> {
  const shoot = await getShootRow(client, input.shoot_id ?? null);
  if (shoot) {
    return {
      studioId: shoot.studio_id,
      title: input.title || `${shoot.shoot_code} Assignment`,
      locationName: input.location_name || shoot.location_name,
      locationAddress: input.location_address || shoot.location_address || "",
      locationLat: input.location_lat ?? shoot.location_lat,
      locationLng: input.location_lng ?? shoot.location_lng,
      geofenceRadiusMeters: input.geofence_radius_meters ?? shoot.geofence_radius_meters ?? getDefaultShootGeofenceMeters(),
      navigationUrl:
        buildGoogleMapsLink({
          latitude: input.location_lat ?? shoot.location_lat,
          longitude: input.location_lng ?? shoot.location_lng,
          address: input.location_address || shoot.location_address,
          label: input.location_name || shoot.location_name
        }) ?? shoot.navigation_url,
      estimatedDriveMinutes: estimateDriveMinutesFromStudio(input.location_lat ?? shoot.location_lat, input.location_lng ?? shoot.location_lng)
    };
  }

  if (input.shift_kind === "studio") {
    const studio = ((await getStudioRow(client, input.studio_id ?? null)) ?? getStudioLocation()) as Partial<StudioLocation>;
    return {
      studioId: input.studio_id ?? null,
      title: input.title,
      locationName: input.location_name || "Main Studio",
      locationAddress: input.location_address || studio.address || "",
      locationLat: input.location_lat ?? studio.latitude ?? null,
      locationLng: input.location_lng ?? studio.longitude ?? null,
      geofenceRadiusMeters: input.geofence_radius_meters ?? studio.geofenceRadiusMeters ?? 804,
      navigationUrl:
        buildGoogleMapsLink({
          latitude: input.location_lat ?? studio.latitude ?? null,
          longitude: input.location_lng ?? studio.longitude ?? null,
          address: input.location_address || studio.address || null,
          label: input.location_name || "Main Studio"
        }) ?? null,
      estimatedDriveMinutes: null
    };
  }

  return {
    studioId: input.studio_id ?? null,
    title: input.title,
    locationName: input.location_name || "Operations Shift",
    locationAddress: input.location_address || "",
    locationLat: input.location_lat ?? null,
    locationLng: input.location_lng ?? null,
    geofenceRadiusMeters: input.geofence_radius_meters ?? getDefaultShootGeofenceMeters(),
    navigationUrl:
      buildGoogleMapsLink({
        latitude: input.location_lat ?? null,
        longitude: input.location_lng ?? null,
        address: input.location_address ?? "",
        label: input.location_name ?? input.title
      }) ?? null,
    estimatedDriveMinutes: estimateDriveMinutesFromStudio(input.location_lat ?? null, input.location_lng ?? null)
  };
}

async function replaceShiftSegments(client: PoolClient, tenantId: string, shiftId: string, segments: ShiftSegmentInput[] = []) {
  await client.query("DELETE FROM shift_segment WHERE tenant_id = $1 AND shift_id = $2", [tenantId, shiftId]);

  if (!segments.length) {
    return;
  }

  for (const [index, segment] of segments.entries()) {
    await client.query(
      `
        INSERT INTO shift_segment (
          tenant_id, shift_id, segment_kind, label, scheduled_start_at, scheduled_end_at, rate_code, hourly_rate_cents, sort_order
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        tenantId,
        shiftId,
        segment.segment_kind,
        segment.label,
        segment.scheduled_start_at,
        segment.scheduled_end_at,
        segment.rate_code,
        segment.hourly_rate_cents,
        segment.sort_order ?? index
      ]
    );
  }
}

async function isShootLive(client: PoolClient, shootId?: string | null) {
  if (!shootId) {
    return false;
  }
  const { rows } = await client.query<{ is_live: boolean }>(
    `
      SELECT CASE
        WHEN deleted_at IS NOT NULL THEN false
        WHEN start_time IS NULL THEN false
        WHEN start_time <= now() THEN true
        ELSE false
      END AS is_live
      FROM shoot
      WHERE id = $1
      LIMIT 1
    `,
    [shootId]
  );
  return Boolean(rows[0]?.is_live);
}

function canManageScheduleDepartment(auth: AuthUser, department: DepartmentCode) {
  return canCreateOrEditCalendarDepartment(auth, department);
}

async function assertShiftMutationAllowed(
  client: PoolClient,
  auth: AuthUser,
  input: {
    department: DepartmentCode;
    shootId?: string | null;
    nextAssignedUserId?: string | null;
    currentAssignedUserId?: string | null;
    staffingRole?: WorkShiftInput["staffing_role"];
    satisfiesLeadCoverage?: boolean;
  }
) {
  if (!canManageScheduleDepartment(auth, input.department)) {
    throw new ApiError(403, "Forbidden");
  }

  if (hasJobFunctionProfile(auth, "customer_service_rep") && input.shootId) {
    throw new ApiError(403, "Customer service scheduling does not include field-staff assignments");
  }

  const liveShoot = await isShootLive(client, input.shootId ?? null);
  const assignmentChanged =
    input.nextAssignedUserId !== null &&
    input.nextAssignedUserId !== undefined &&
    input.nextAssignedUserId !== (input.currentAssignedUserId ?? input.nextAssignedUserId);

  if (liveShoot && assignmentChanged && !canAssignStaffOnLiveShoot(auth)) {
    throw new ApiError(403, "Only directors and leadership can assign staff after a shoot is live");
  }

  const leadControlledRole =
    input.staffingRole === "lead_photographer" ||
    input.staffingRole === "senior_photographer" ||
    Boolean(input.satisfiesLeadCoverage);

  if (leadControlledRole && !hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Only directors and leadership can assign lead or senior coverage");
  }
}

function hasMaterialShiftChange(previous: MaterialShiftSnapshot, next: MaterialShiftSnapshot) {
  return (
    previous.assigned_user_id !== next.assigned_user_id ||
    previous.starts_at !== next.starts_at ||
    previous.ends_at !== next.ends_at ||
    previous.location_name !== next.location_name ||
    previous.location_address !== next.location_address ||
    Number(previous.location_lat ?? 0) !== Number(next.location_lat ?? 0) ||
    Number(previous.location_lng ?? 0) !== Number(next.location_lng ?? 0)
  );
}

async function userHasSeniorProfile(client: PoolClient, tenantId: string, userId: string) {
  const { rows } = await client.query(
    `
      SELECT 1
      FROM user_job_function_profile
      WHERE tenant_id = $1
        AND user_id = $2
        AND job_function_profile = 'senior_photographer'
      LIMIT 1
    `,
    [tenantId, userId]
  );
  return Boolean(rows[0]);
}

async function hasShiftOverlapForUser(client: PoolClient, shiftId: string, userId: string, startsAt: string, endsAt: string) {
  const { rows } = await client.query(
    `
      SELECT ws.id, ws.title, ws.starts_at, ws.ends_at
      FROM work_shift ws
      WHERE ws.assigned_user_id = $1
        AND ws.id <> $2
        AND ws.cancelled_at IS NULL
        AND ws.status IN ('draft', 'published', 'completed')
        AND tstzrange(ws.starts_at, ws.ends_at, '[)') && tstzrange($3::timestamptz, $4::timestamptz, '[)')
      ORDER BY ws.starts_at ASC
      LIMIT 1
    `,
    [userId, shiftId, startsAt, endsAt]
  );
  return rows[0] ?? null;
}

function resolvePTOHours(requestUnit: "half_day" | "full_day") {
  return requestUnit === "half_day" ? 4.0 : 7.5;
}

async function findAssignedShootConflictForPTODate(client: PoolClient, tenantId: string, userId: string, requestedOn: string) {
  const { rows } = await client.query<{
    shift_id: string | null;
    shoot_id: string | null;
    title: string | null;
    starts_at: string | null;
  }>(
    `
      SELECT *
      FROM (
        SELECT
          ws.id AS shift_id,
          ws.shoot_id,
          COALESCE(ws.title, s.title) AS title,
          ws.starts_at::text
        FROM work_shift ws
        LEFT JOIN shoot s
          ON s.id = ws.shoot_id
         AND s.tenant_id = ws.tenant_id
        WHERE ws.tenant_id = $1
          AND ws.assigned_user_id = $2
          AND ws.shoot_id IS NOT NULL
          AND ws.cancelled_at IS NULL
          AND ws.status IN ('draft', 'published', 'completed')
          AND ws.starts_at::date <= $3::date
          AND ws.ends_at::date >= $3::date

        UNION ALL

        SELECT
          NULL::uuid AS shift_id,
          sa.shoot_id,
          s.title,
          s.start_time::text AS starts_at
        FROM shoot_assignment sa
        JOIN shoot s
          ON s.id = sa.shoot_id
         AND s.tenant_id = sa.tenant_id
        WHERE sa.tenant_id = $1
          AND sa.user_id = $2
          AND s.deleted_at IS NULL
          AND s.shoot_date = $3::date
      ) conflicts
      ORDER BY starts_at NULLS LAST
      LIMIT 1
    `,
    [tenantId, userId, requestedOn]
  );
  return rows[0] ?? null;
}

async function autoDenyPTORequest(
  client: PoolClient,
  input: {
    tenantId: string;
    requestId: string;
    requesterUserId: string;
    requestedOn: string;
    conflictingShiftId?: string | null;
    conflictingShootId?: string | null;
    reason: string;
  }
) {
  const { rows } = await client.query(
    `
      UPDATE pto_request
      SET status = 'denied'::pto_request_status,
          denied_automatically = true,
          auto_denial_reason = $2,
          conflicting_shift_id = COALESCE($3, conflicting_shift_id),
          conflicting_shoot_id = COALESCE($4, conflicting_shoot_id),
          decided_at = now(),
          updated_at = now()
      WHERE id = $1
        AND status = 'submitted'::pto_request_status
      RETURNING *
    `,
    [input.requestId, input.reason, input.conflictingShiftId ?? null, input.conflictingShootId ?? null]
  );
  const request = rows[0];
  if (!request) {
    return null;
  }

  await createAuditLog(client, {
    tenantId: input.tenantId,
    targetUserId: input.requesterUserId,
    action: "schedule.pto.auto_denied",
    entityType: "pto_request",
    entityId: input.requestId,
    metadata: {
      requested_on: input.requestedOn,
      conflicting_shift_id: input.conflictingShiftId ?? null,
      conflicting_shoot_id: input.conflictingShootId ?? null,
      reason: input.reason,
      execution_mode: "automatic"
    }
  });

  const recipients = await findNotificationRecipients(client, {
    tenantId: input.tenantId,
    eventCode: "schedule.pto_auto_denied",
    directUserIds: [input.requesterUserId, ...(request.approver_user_id ? [String(request.approver_user_id)] : [])]
  });
  await queueNotificationDispatch(client, {
    tenantId: input.tenantId,
    actorUserId: null,
    recipientUserIds: recipients,
    notificationType: "schedule.pto_auto_denied",
    title: "PTO request auto-denied",
    body: `The PTO request for ${input.requestedOn} was automatically denied because a conflicting shoot assignment now exists.`,
    priority: "high",
    deepLink: "/approvals",
    relatedUserId: input.requesterUserId,
    channels: channelsForPriority("high"),
    metadata: {
      request_id: input.requestId,
      requested_on: input.requestedOn,
      reason: input.reason
    }
  });

  return request;
}

export async function reconcileSubmittedPTOConflictsForUser(
  client: PoolClient,
  input: {
    tenantId: string;
    userId: string;
  }
) {
  await syncAvailabilityImpactsForUser(client, input);
}

async function getCoworkersForShift(client: PoolClient, shift: ShiftCoworkerContext): Promise<ShiftCoworker[]> {
  if (!shift.shoot_id) {
    return [];
  }
  const { rows } = await client.query(
    `
      SELECT au.id, au.email, au.full_name, ARRAY_REMOVE(array_agg(DISTINCT r.code), NULL) AS roles
      FROM work_shift ws
      JOIN app_user au ON au.id = ws.assigned_user_id
      LEFT JOIN user_role ur ON ur.user_id = au.id AND ur.tenant_id = au.tenant_id
      LEFT JOIN role r ON r.id = ur.role_id
      WHERE ws.shoot_id = $1
        AND ws.assigned_user_id <> $2
        AND ws.status = 'published'
        AND ws.cancelled_at IS NULL
      GROUP BY au.id, au.email, au.full_name
      ORDER BY au.full_name ASC
    `,
    [shift.shoot_id, shift.assigned_user_id]
  );
  return rows as ShiftCoworker[];
}

// Default lookback when a caller gives no dateFrom: shifts append across
// seasons and an unwindowed list grows forever (audit §11 F10). Future shifts
// stay fully visible; only the unbounded past is windowed by default.
const SHIFT_LIST_DEFAULT_LOOKBACK_DAYS = 90;

export async function listShifts(client: PoolClient, auth: AuthUser, filters: ShiftListFilters = {}) {
  const values: unknown[] = [];
  const where: string[] = ["ws.cancelled_at IS NULL"];

  if (filters.dateFrom) {
    values.push(filters.dateFrom);
    where.push(`ws.ends_at::date >= $${values.length}::date`);
  } else {
    where.push(`ws.ends_at::date >= CURRENT_DATE - ${SHIFT_LIST_DEFAULT_LOOKBACK_DAYS}`);
  }
  if (filters.dateTo) {
    values.push(filters.dateTo);
    where.push(`ws.starts_at::date <= $${values.length}::date`);
  }
  if (filters.assignedUserId) {
    values.push(filters.assignedUserId);
    where.push(`ws.assigned_user_id = $${values.length}`);
  }
  if (filters.shootId) {
    values.push(filters.shootId);
    where.push(`ws.shoot_id = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    where.push(`ws.status = $${values.length}::work_shift_status`);
  }
  if (shouldRestrictShiftList(auth)) {
    values.push(auth.id);
    where.push(`ws.assigned_user_id = $${values.length}`);
  } else if (shouldDepartmentScopeShiftList(auth)) {
    values.push(auth.department);
    where.push(`ws.department = $${values.length}::department_code`);
  }

  const { rows } = await client.query(
    `
      SELECT
        ws.*,
        au.email AS assigned_user_email,
        au.full_name AS assigned_user_name,
        manager.full_name AS manager_name,
        s.shoot_code,
        s.projected_students,
        s.title AS shoot_title,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', seg.id,
                'segment_kind', seg.segment_kind,
                'label', seg.label,
                'scheduled_start_at', seg.scheduled_start_at,
                'scheduled_end_at', seg.scheduled_end_at,
                'actual_start_at', seg.actual_start_at,
                'actual_end_at', seg.actual_end_at,
                'rate_code', seg.rate_code,
                'hourly_rate_cents', seg.hourly_rate_cents,
                'sort_order', seg.sort_order
              )
              ORDER BY seg.sort_order ASC
            )
            FROM shift_segment seg
            WHERE seg.shift_id = ws.id
          ),
          '[]'::json
        ) AS segments,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', sp.id,
                'direction', sp.direction,
                'client_timestamp', sp.client_timestamp,
                'geofence_status', sp.geofence_status,
                'gps_confidence', sp.gps_confidence,
                'unscheduled', sp.unscheduled,
                'requires_approval', sp.requires_approval,
                'approval_state', sp.approval_state,
                'timing_status', sp.timing_status,
                'early_minutes', sp.early_minutes,
                'late_minutes', sp.late_minutes,
                'missed_punch_required', sp.missed_punch_required
              )
              ORDER BY sp.client_timestamp ASC
            )
            FROM shift_punch sp
            WHERE sp.shift_id = ws.id
          ),
          '[]'::json
        ) AS punches,
        (
          SELECT json_build_object(
            'id', te.id,
            'clock_in_at', te.clock_in_at,
            'clock_out_at', te.clock_out_at,
            'gross_minutes', te.gross_minutes,
            'break_deduction_minutes', te.break_deduction_minutes,
            'approved_payable_minutes', te.approved_payable_minutes,
            'payroll_state', te.payroll_state,
            'attendance_state', te.attendance_state,
            'break_deduction_overridden', te.break_deduction_overridden
          )
          FROM time_entry te
          WHERE te.shift_id = ws.id
          ORDER BY te.clock_in_at DESC NULLS LAST, te.created_at DESC
          LIMIT 1
        ) AS payroll_summary,
        -- G2: canonical payroll truth alongside the legacy time_entry summary.
        -- NULL when no time session covers the shift — honestly unavailable.
        -- Canonical vocabulary differs by design (lunch deduction, session
        -- status) — consumers opt in explicitly, never a silent field swap.
        (
          SELECT json_build_object(
            'session_id', ts.id,
            'work_date', ts.work_date,
            'session_status', ts.status,
            'clock_in_at', (SELECT MIN(seg.start_time) FROM time_segment seg WHERE seg.session_id = ts.id),
            'clock_out_at', (SELECT MAX(seg.end_time) FROM time_segment seg WHERE seg.session_id = ts.id),
            'total_worked_minutes', ps.total_worked_minutes,
            'lunch_deduction_minutes', ps.lunch_deduction_minutes,
            'payable_minutes', ps.payable_minutes,
            'lunch_challenge_status', ps.lunch_challenge_status,
            'manual_correction_count', ps.manual_correction_count
          )
          FROM time_session ts
          JOIN time_session_payroll_summary ps
            ON ps.session_id = ts.id
           AND ps.tenant_id = ts.tenant_id
          WHERE ts.source_shift_id = ws.id
            AND ts.tenant_id = ws.tenant_id
          ORDER BY ts.work_date DESC, ts.created_at DESC
          LIMIT 1
        ) AS payroll_summary_canonical
      FROM work_shift ws
      JOIN app_user au ON au.id = ws.assigned_user_id
      LEFT JOIN app_user manager ON manager.id = ws.manager_user_id
      LEFT JOIN shoot s ON s.id = ws.shoot_id
      WHERE ${where.join(" AND ")}
      ORDER BY ws.starts_at ASC, ws.created_at ASC
    `,
    values
  );
  return rows;
}

export async function listScheduleMembers(client: PoolClient, auth: AuthUser, anchorDate = getLocalDateString()) {
  const values: unknown[] = [];
  const where = ["au.status = 'active'"];
  if (shouldRestrictShiftList(auth)) {
    values.push(auth.id);
    where.push(`au.id = $${values.length}`);
  } else if (shouldDepartmentScopeShiftList(auth)) {
    values.push(auth.department);
    where.push(`au.department = $${values.length}::department_code`);
  }
  const { rows } = await client.query<ScheduleMemberSummaryRow>(
    `
      SELECT
        au.id,
        au.email,
        au.full_name,
        au.department::text,
        ARRAY_REMOVE(array_agg(DISTINCT r.code), NULL) AS roles,
        uaa.authority_tier::text AS authority_tier,
        uaa.primary_job_function_profile::text AS primary_job_function_profile,
        ARRAY_REMOVE(array_agg(DISTINCT ujp.job_function_profile::text), NULL) AS job_function_profiles
      FROM app_user au
      LEFT JOIN user_role ur ON ur.user_id = au.id AND ur.tenant_id = au.tenant_id
      LEFT JOIN role r ON r.id = ur.role_id
      LEFT JOIN user_authority_assignment uaa ON uaa.user_id = au.id AND uaa.tenant_id = au.tenant_id
      LEFT JOIN user_job_function_profile ujp ON ujp.user_id = au.id AND ujp.tenant_id = au.tenant_id
      WHERE ${where.join(" AND ")}
      GROUP BY au.id, au.email, au.full_name, au.department, uaa.authority_tier, uaa.primary_job_function_profile
      ORDER BY au.full_name ASC
    `,
    values
  );
  const memberIds = rows.map((row) => row.id);
  if (!memberIds.length) {
    return [];
  }

  const { startDate: weekStart, endDate: weekEnd } = getWeekBounds(anchorDate);
  const now = new Date();

  const shiftRows = await client.query<{
      id: string;
      assigned_user_id: string;
      title: string;
      starts_at: string;
      ends_at: string;
    }>(
      `
        SELECT ws.id, ws.assigned_user_id, ws.title, ws.starts_at::text, ws.ends_at::text
        FROM work_shift ws
        WHERE ws.tenant_id = $1
          AND ws.assigned_user_id = ANY($2::uuid[])
          AND ws.cancelled_at IS NULL
          AND ws.status IN ('draft', 'published', 'completed')
          AND ws.ends_at::date >= $3::date
          AND ws.starts_at::date <= $3::date
        ORDER BY ws.starts_at ASC
      `,
      [auth.tenantId, memberIds, anchorDate]
    );
  const eventRows = await client.query<{
      id: string;
      lead_user_id: string;
      title: string;
      starts_at: string;
      ends_at: string;
    }>(
      `
        SELECT se.id, se.lead_user_id, se.title, se.starts_at::text, se.ends_at::text
        FROM schedule_event se
        WHERE se.tenant_id = $1
          AND se.lead_user_id = ANY($2::uuid[])
          AND se.deleted_at IS NULL
          AND se.status IN ('scheduled', 'tentative', 'completed')
          AND se.ends_at::date >= $3::date
          AND se.starts_at::date <= $3::date
        ORDER BY se.starts_at ASC
      `,
      [auth.tenantId, memberIds, anchorDate]
    );
  const availabilityWindowsByUser = await loadAvailabilityWindowsForUsersOnDate(client, {
      tenantId: auth.tenantId,
      userContexts: rows.map((member) => ({ id: member.id, department: member.department })),
      anchorDate,
      includePendingRequests: true
    });
  const dayHoursRows = await client.query<{ assigned_user_id: string; scheduled_hours: string }>(
      `
        SELECT
          ws.assigned_user_id,
          SUM(EXTRACT(EPOCH FROM (ws.ends_at - ws.starts_at)) / 3600.0)::numeric AS scheduled_hours
        FROM work_shift ws
        WHERE ws.tenant_id = $1
          AND ws.assigned_user_id = ANY($2::uuid[])
          AND ws.cancelled_at IS NULL
          AND ws.status IN ('draft', 'published', 'completed')
          AND ws.ends_at::date >= $3::date
          AND ws.starts_at::date <= $3::date
        GROUP BY ws.assigned_user_id
      `,
      [auth.tenantId, memberIds, anchorDate]
    );
  const weekHoursRows = await client.query<{ assigned_user_id: string; scheduled_hours: string }>(
      `
        SELECT
          ws.assigned_user_id,
          SUM(EXTRACT(EPOCH FROM (ws.ends_at - ws.starts_at)) / 3600.0)::numeric AS scheduled_hours
        FROM work_shift ws
        WHERE ws.tenant_id = $1
          AND ws.assigned_user_id = ANY($2::uuid[])
          AND ws.cancelled_at IS NULL
          AND ws.status IN ('draft', 'published', 'completed')
          AND ws.starts_at::date <= $4::date
          AND ws.ends_at::date >= $3::date
        GROUP BY ws.assigned_user_id
      `,
      [auth.tenantId, memberIds, weekStart, weekEnd]
    );

  const shiftBlocksByUser = new Map<string, AvailabilityBlock[]>();
  for (const row of shiftRows.rows) {
    const blocks = shiftBlocksByUser.get(row.assigned_user_id) ?? [];
    blocks.push({
      id: row.id,
      kind: "shift",
      title: row.title,
      starts_at: row.starts_at,
      ends_at: row.ends_at
    });
    shiftBlocksByUser.set(row.assigned_user_id, blocks);
  }

  const eventBlocksByUser = new Map<string, AvailabilityBlock[]>();
  for (const row of eventRows.rows) {
    const blocks = eventBlocksByUser.get(row.lead_user_id) ?? [];
    blocks.push({
      id: row.id,
      kind: "event",
      title: row.title,
      starts_at: row.starts_at,
      ends_at: row.ends_at
    });
    eventBlocksByUser.set(row.lead_user_id, blocks);
  }

  const hoursTodayByUser = new Map(dayHoursRows.rows.map((row) => [row.assigned_user_id, Number(row.scheduled_hours ?? 0)]));
  const hoursWeekByUser = new Map(weekHoursRows.rows.map((row) => [row.assigned_user_id, Number(row.scheduled_hours ?? 0)]));

  return rows.map((row) => {
    const scheduleBlocks = [...(shiftBlocksByUser.get(row.id) ?? []), ...(eventBlocksByUser.get(row.id) ?? [])].sort(
      (left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime()
    );
    const activeBlock = scheduleBlocks.find((block) => isBlockActive(block, now)) ?? null;
    const futureBlocks = scheduleBlocks.filter((block) => new Date(block.starts_at).getTime() > now.getTime());
    const nextBlock = futureBlocks[0] ?? null;
    const previousBlocks = scheduleBlocks.filter((block) => new Date(block.ends_at).getTime() <= now.getTime());
    const previousBlock = previousBlocks.length ? previousBlocks[previousBlocks.length - 1] : null;
    const hasOverlap = scheduleBlocks.some((block, index) =>
      scheduleBlocks.some(
        (candidate, candidateIndex) =>
          index !== candidateIndex &&
          new Date(candidate.starts_at).getTime() < new Date(block.ends_at).getTime() &&
          new Date(candidate.ends_at).getTime() > new Date(block.starts_at).getTime()
      )
    );
    const fieldStaffEligible = isFieldStaffEligible(row);
    const leadQualified = isLeadQualifiedMember(row);
    const hoursToday = Number(hoursTodayByUser.get(row.id) ?? 0);
    const hoursWeek = Number(hoursWeekByUser.get(row.id) ?? 0);
    const availabilityWindows = availabilityWindowsByUser.get(row.id) ?? [];
    const blockingAvailabilityWindows = availabilityWindows.filter((window) => !window.warning_only);
    const warningAvailabilityWindows = availabilityWindows.filter((window) => window.warning_only);
    const activeAvailabilityWindow =
      blockingAvailabilityWindows.find((window) => isAvailabilityWindowActive(window, now)) ??
      blockingAvailabilityWindows[0] ??
      warningAvailabilityWindows[0] ??
      null;
    const availabilityNote = activeAvailabilityWindow ? availabilityWindowLabel(activeAvailabilityWindow) : null;
    const onBlockedAvailabilityToday = blockingAvailabilityWindows.length > 0;

    const availabilityStatus = (() => {
      if (!fieldStaffEligible) {
        return "unavailable";
      }
      if (onBlockedAvailabilityToday) {
        return "pto";
      }
      if (hasOverlap) {
        return "conflict";
      }
      if (activeBlock) {
        return "on_shoot_now";
      }
      if (hoursToday >= 8 || hoursWeek >= 40) {
        return "overtime_watch";
      }
      if (previousBlock && nextBlock) {
        return "partially_available";
      }
      if (nextBlock) {
        return "assigned_later";
      }
      if (previousBlock) {
        return "partially_available";
      }
      return "available";
    })();

    const focusBlock = activeBlock ?? nextBlock ?? previousBlock;
    return {
      ...row,
      field_staff_eligible: fieldStaffEligible,
      lead_qualified: leadQualified,
      availability_status: availabilityStatus,
      current_assignment_title: focusBlock?.title ?? availabilityNote,
      current_assignment_kind: focusBlock?.kind ?? null,
      current_assignment_window: focusBlock ? formatBlockWindow(focusBlock) : null,
      scheduled_hours_today: Number(hoursToday.toFixed(1)),
      scheduled_hours_week: Number(hoursWeek.toFixed(1)),
      approved_pto_today: onBlockedAvailabilityToday,
      availability_note: availabilityNote,
      availability_warning_today: warningAvailabilityWindows.length > 0
    };
  });
}

export async function listTradeCandidates(client: PoolClient, auth: AuthUser, shiftId: string) {
  await assertShiftAccess(client, auth, shiftId);

  const shift = await getShiftById(client, auth, shiftId);
  if (String(shift.assigned_user_id) !== auth.id) {
    throw new ApiError(403, "You can only request a trade for your own shift");
  }

  const requesterRankResult = await client.query<{
    authority_tier: string | null;
    primary_job_function_profile: string | null;
    level_rank: number | null;
  }>(
    `
      SELECT
        uaa.authority_tier::text AS authority_tier,
        uaa.primary_job_function_profile::text AS primary_job_function_profile,
        MAX(rlr.level_rank)::integer AS level_rank
      FROM app_user au
      LEFT JOIN user_authority_assignment uaa
        ON uaa.tenant_id = au.tenant_id
       AND uaa.user_id = au.id
      LEFT JOIN user_job_function_profile ujp
        ON ujp.tenant_id = au.tenant_id
       AND ujp.user_id = au.id
      LEFT JOIN role_level_rank rlr
        ON rlr.tenant_id = ujp.tenant_id
       AND rlr.job_function_profile = ujp.job_function_profile
      WHERE au.tenant_id = $1
        AND au.id = $2
      GROUP BY uaa.authority_tier, uaa.primary_job_function_profile
    `,
    [auth.tenantId, auth.id]
  );
  const requesterLevelRow = requesterRankResult.rows[0] ?? null;
  const requesterRank = resolveTradeLevelRank(
    requesterLevelRow?.level_rank ?? null,
    requesterLevelRow?.primary_job_function_profile ?? null,
    requesterLevelRow?.authority_tier ?? null
  );

  const { rows } = await client.query<
    {
      id: string;
      email: string;
      full_name: string;
      department: string;
      authority_tier: string | null;
      primary_job_function_profile: string | null;
      level_rank: number | null;
      allow_shift_trade: boolean | null;
    } & { roles: string[] }
  >(
    `
      SELECT
        au.id,
        au.email,
        au.full_name,
        au.department::text,
        uaa.authority_tier::text AS authority_tier,
        uaa.primary_job_function_profile::text AS primary_job_function_profile,
        MAX(rlr.level_rank)::integer AS level_rank,
        BOOL_OR(rlr.allow_shift_trade) AS allow_shift_trade,
        ARRAY_REMOVE(array_agg(DISTINCT r.code), NULL) AS roles
      FROM app_user au
      LEFT JOIN user_authority_assignment uaa
        ON uaa.tenant_id = au.tenant_id
       AND uaa.user_id = au.id
      LEFT JOIN user_job_function_profile ujp
        ON ujp.tenant_id = au.tenant_id
       AND ujp.user_id = au.id
      LEFT JOIN role_level_rank rlr
        ON rlr.tenant_id = au.tenant_id
       AND rlr.job_function_profile = ujp.job_function_profile
      LEFT JOIN user_role ur
        ON ur.tenant_id = au.tenant_id
       AND ur.user_id = au.id
      LEFT JOIN role r
        ON r.id = ur.role_id
      WHERE au.tenant_id = $1
        AND au.status = 'active'
        AND au.id <> $2
      GROUP BY au.id, au.email, au.full_name, au.department, uaa.authority_tier, uaa.primary_job_function_profile
      ORDER BY au.full_name ASC
    `,
    [auth.tenantId, auth.id]
  );

  const candidates = [];
  for (const row of rows) {
    const candidateLevelRank = resolveTradeLevelRank(row.level_rank, row.primary_job_function_profile, row.authority_tier);
    if (candidateLevelRank < requesterRank) {
      continue;
    }
    if (!resolveTradeAllowShiftTrade(row.allow_shift_trade, row.primary_job_function_profile, row.authority_tier)) {
      continue;
    }
    const conflict = await findTradeAcceptanceConflict(client, {
      tenantId: auth.tenantId,
      shiftId,
      shootId: shift.shoot_id ?? null,
      userId: row.id,
      startsAt: shift.starts_at,
      endsAt: shift.ends_at
    });
    candidates.push({
      ...row,
      level_rank: candidateLevelRank,
      has_conflict: Boolean(conflict),
      conflict_summary: conflict?.summary ?? null,
      conflict_code: conflict?.code ?? null
    });
  }

  candidates.sort((left, right) => right.level_rank - left.level_rank || left.full_name.localeCompare(right.full_name));
  return candidates;
}

export async function getShiftById(client: PoolClient, auth: AuthUser, shiftId: string) {
  await assertShiftAccess(client, auth, shiftId);

  const { rows } = await client.query(
    `
      SELECT
        ws.*,
        au.email AS assigned_user_email,
        au.full_name AS assigned_user_name,
        manager.full_name AS manager_name,
        s.shoot_code,
        s.title AS shoot_title,
        s.projected_students
      FROM work_shift ws
      JOIN app_user au ON au.id = ws.assigned_user_id
      LEFT JOIN app_user manager ON manager.id = ws.manager_user_id
      LEFT JOIN shoot s ON s.id = ws.shoot_id
      WHERE ws.id = $1
      LIMIT 1
    `,
    [shiftId]
  );
  const shift = rows[0];
  if (!shift) {
    throw new ApiError(404, "Shift not found");
  }

  const segments = await client.query("SELECT * FROM shift_segment WHERE shift_id = $1 ORDER BY sort_order ASC", [shiftId]);
  const punches = await client.query("SELECT * FROM shift_punch WHERE shift_id = $1 ORDER BY client_timestamp ASC", [shiftId]);
  const exceptions = await client.query(
    "SELECT * FROM attendance_exception WHERE shift_id = $1 ORDER BY created_at DESC",
    [shiftId]
  );
  const timeEntries = await client.query("SELECT * FROM time_entry WHERE shift_id = $1 ORDER BY clock_in_at DESC NULLS LAST, created_at DESC", [shiftId]);
  // G2: canonical payroll truth alongside the legacy time_entry projection.
  // Empty/NULL when no time session covers the shift — honestly unavailable.
  const canonicalSessions = await client.query(
    `
      SELECT
        ts.id AS session_id,
        ts.work_date,
        ts.status AS session_status,
        (SELECT MIN(seg.start_time) FROM time_segment seg WHERE seg.session_id = ts.id) AS clock_in_at,
        (SELECT MAX(seg.end_time) FROM time_segment seg WHERE seg.session_id = ts.id) AS clock_out_at,
        ps.total_worked_minutes,
        ps.lunch_deduction_minutes,
        ps.payable_minutes,
        ps.lunch_challenge_status,
        ps.manual_correction_count
      FROM time_session ts
      JOIN time_session_payroll_summary ps
        ON ps.session_id = ts.id
       AND ps.tenant_id = ts.tenant_id
      WHERE ts.source_shift_id = $1
        AND ts.tenant_id = $2
      ORDER BY ts.work_date DESC, ts.created_at DESC
    `,
    [shiftId, auth.tenantId]
  );
  const coworkers = await getCoworkersForShift(client, shift);
  const closeoutCompliance = await getShiftCloseoutCompliance(client, {
    tenantId: auth.tenantId,
    shiftId,
    submitterUserId: auth.id
  });
  const timeClockState = await getTimeClockStateSummary(client, {
    tenantId: auth.tenantId,
    employeeId: shift.assigned_user_id
  });

  return {
    ...shift,
    segments: segments.rows,
    punches: punches.rows,
    time_entries: timeEntries.rows,
    payroll_summary: timeEntries.rows[0] ?? null,
    canonical_sessions: canonicalSessions.rows,
    payroll_summary_canonical: canonicalSessions.rows[0] ?? null,
    exceptions: exceptions.rows,
    coworkers,
    closeout_compliance: closeoutCompliance,
    time_clock_state: timeClockState
  };
}

export async function createShift(
  client: PoolClient,
  auth: AuthUser,
  input: WorkShiftInput,
  meta: RequestMeta
) {
  await assertShiftMutationAllowed(client, auth, {
    department: input.department,
    shootId: input.shoot_id ?? null,
    nextAssignedUserId: input.assigned_user_id,
    staffingRole: input.staffing_role,
    satisfiesLeadCoverage: input.satisfies_lead_coverage
  });
  const location = await buildShiftLocation(client, input);

  const { rows } = await client.query(
    `
      INSERT INTO work_shift (
        tenant_id, shoot_id, studio_id, assigned_user_id, manager_user_id, created_by_user_id,
        shift_kind, department, staffing_role, satisfies_lead_coverage, title, starts_at, ends_at, location_name, location_address,
        location_lat, location_lng, geofence_radius_meters, navigation_url, notes, calendar_sync_required
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,true)
      RETURNING *
    `,
    [
      auth.tenantId,
      input.shoot_id ?? null,
      location.studioId,
      input.assigned_user_id,
      input.manager_user_id ?? null,
      auth.id,
      input.shift_kind,
      input.department,
      input.staffing_role ?? "photographer",
      Boolean(input.satisfies_lead_coverage),
      location.title,
      input.starts_at,
      input.ends_at,
      location.locationName,
      location.locationAddress,
      location.locationLat,
      location.locationLng,
      location.geofenceRadiusMeters,
      location.navigationUrl,
      input.notes ?? null
    ]
  );

  const shift = rows[0];
  await replaceShiftSegments(client, auth.tenantId, shift.id, input.segments ?? []);

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: input.assigned_user_id,
    action: "schedule.shift.created",
    entityType: "work_shift",
    entityId: shift.id,
    metadata: {
      shift_kind: input.shift_kind,
      title: shift.title,
      staffing_role: input.staffing_role ?? "photographer",
      satisfies_lead_coverage: Boolean(input.satisfies_lead_coverage)
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  await emitScheduleRealtimeChange(client, {
    tenantId: auth.tenantId,
    shiftId: shift.id,
    shootId: shift.shoot_id ?? null,
    title: shift.title,
    status: shift.status,
    changeType: "created",
    versionToken: String(shift.created_at ?? shift.id)
  });

  await reconcileSubmittedPTOConflictsForUser(client, {
    tenantId: auth.tenantId,
    userId: shift.assigned_user_id
  });

  await queueWorkShiftOutlookSync(client, {
    tenantId: auth.tenantId,
    shiftId: shift.id,
    triggeredByUserId: auth.id,
    operationType: "upsert",
    dedupeSuffix: String(shift.created_at ?? shift.id)
  });

  return getShiftById(client, auth, shift.id);
}

export async function updateShift(
  client: PoolClient,
  auth: AuthUser,
  shiftId: string,
  patch: Partial<WorkShiftInput>,
  meta: RequestMeta
) {
  const current = await getShiftById(client, auth, shiftId);

  const merged = {
    shoot_id: patch.shoot_id ?? current.shoot_id,
    studio_id: patch.studio_id ?? current.studio_id,
    assigned_user_id: patch.assigned_user_id ?? current.assigned_user_id,
    manager_user_id: patch.manager_user_id ?? current.manager_user_id,
    shift_kind: patch.shift_kind ?? current.shift_kind,
    department: patch.department ?? current.department,
    staffing_role: patch.staffing_role ?? current.staffing_role,
    satisfies_lead_coverage: patch.satisfies_lead_coverage ?? current.satisfies_lead_coverage,
    title: patch.title ?? current.title,
    starts_at: patch.starts_at ?? current.starts_at,
    ends_at: patch.ends_at ?? current.ends_at,
    location_name: patch.location_name ?? current.location_name,
    location_address: patch.location_address ?? current.location_address,
    location_lat: patch.location_lat ?? current.location_lat,
    location_lng: patch.location_lng ?? current.location_lng,
    geofence_radius_meters: patch.geofence_radius_meters ?? current.geofence_radius_meters,
    notes: patch.notes ?? current.notes
  } satisfies WorkShiftInput;

  await assertShiftMutationAllowed(client, auth, {
    department: merged.department,
    shootId: merged.shoot_id ?? null,
    currentAssignedUserId: current.assigned_user_id,
    nextAssignedUserId: merged.assigned_user_id,
    staffingRole: merged.staffing_role,
    satisfiesLeadCoverage: merged.satisfies_lead_coverage
  });

  const location = await buildShiftLocation(client, merged);

  const { rows } = await client.query(
    `
      UPDATE work_shift
      SET shoot_id = $2,
          studio_id = $3,
          assigned_user_id = $4,
          manager_user_id = $5,
          shift_kind = $6,
          department = $7,
          staffing_role = $8,
          satisfies_lead_coverage = $9,
          title = $10,
          starts_at = $11,
          ends_at = $12,
          location_name = $13,
          location_address = $14,
          location_lat = $15,
          location_lng = $16,
          geofence_radius_meters = $17,
          navigation_url = $18,
          notes = $19,
          updated_at = now(),
          calendar_sync_required = CASE WHEN status = 'published' THEN true ELSE calendar_sync_required END
      WHERE id = $1
      RETURNING *
    `,
    [
      shiftId,
      merged.shoot_id ?? null,
      location.studioId,
      merged.assigned_user_id,
      merged.manager_user_id ?? null,
      merged.shift_kind,
      merged.department,
      merged.staffing_role ?? "photographer",
      Boolean(merged.satisfies_lead_coverage),
      location.title,
      merged.starts_at,
      merged.ends_at,
      location.locationName,
      location.locationAddress,
      location.locationLat,
      location.locationLng,
      location.geofenceRadiusMeters,
      location.navigationUrl,
      merged.notes ?? null
    ]
  );

  const updated = rows[0];
  await replaceShiftSegments(client, auth.tenantId, shiftId, patch.segments ?? current.segments ?? []);

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: updated.assigned_user_id,
    action: "schedule.shift.updated",
    entityType: "work_shift",
    entityId: updated.id,
    metadata: { previous_assigned_user_id: current.assigned_user_id, status: updated.status },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  await emitScheduleRealtimeChange(client, {
    tenantId: auth.tenantId,
    shiftId: updated.id,
    shootId: updated.shoot_id ?? null,
    title: updated.title,
    status: updated.status,
    changeType: "updated",
    versionToken: String(updated.updated_at ?? updated.id)
  });

  if (updated.status === "published" && hasMaterialShiftChange(current, updated)) {
    const recipients = await findNotificationRecipients(client, {
      tenantId: auth.tenantId,
      eventCode: "schedule.shift_changed",
      shiftId: updated.id,
      directUserIds: [String(current.assigned_user_id), String(updated.assigned_user_id)],
      excludeUserIds: []
    });
    await queueNotificationDispatch(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      recipientUserIds: recipients,
      notificationType: "schedule.shift_changed",
      title: `Shift updated for ${updated.title}`,
      body: `Your published shift now runs ${formatShiftWindow(updated.starts_at, updated.ends_at)} at ${updated.location_name}.`,
      priority: "high",
      deepLink: `/shifts/${updated.id}`,
      shiftId: updated.id,
      shootId: updated.shoot_id ?? null,
      relatedUserId: updated.assigned_user_id,
      channels: channelsForPriority("high"),
      metadata: {
        dedupe: updated.updated_at,
        previous_assigned_user_id: current.assigned_user_id
      }
    });
    await queueShootChangedWithin48HoursAlert(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      shootId: updated.shoot_id ?? null,
      shiftId: updated.id,
      title: updated.title,
      startsAt: updated.starts_at,
      locationName: updated.location_name,
      previousAssignedUserId: current.assigned_user_id
    });
  }

  await reconcileSubmittedPTOConflictsForUser(client, {
    tenantId: auth.tenantId,
    userId: updated.assigned_user_id
  });
  if (current.assigned_user_id && current.assigned_user_id !== updated.assigned_user_id) {
    await reconcileSubmittedPTOConflictsForUser(client, {
      tenantId: auth.tenantId,
      userId: current.assigned_user_id
    });
  }

  await queueWorkShiftOutlookSync(client, {
    tenantId: auth.tenantId,
    shiftId: updated.id,
    triggeredByUserId: auth.id,
    operationType: "upsert",
    previousAssignedUserId: current.assigned_user_id,
    previousAssignedUserEmail: current.assigned_user_email ?? null,
    previousOutlookEventId: current.outlook_event_id ?? null,
    previousOutlookCalendarOwnerEmail: current.outlook_calendar_owner_email ?? null,
    dedupeSuffix: String(updated.updated_at ?? updated.id)
  });

  return getShiftById(client, auth, updated.id);
}

export async function publishShift(client: PoolClient, auth: AuthUser, shiftId: string, meta: RequestMeta) {
  const current = await getShiftById(client, auth, shiftId);
  await assertShiftMutationAllowed(client, auth, {
    department: current.department,
    shootId: current.shoot_id ?? null,
    currentAssignedUserId: current.assigned_user_id,
    nextAssignedUserId: current.assigned_user_id
  });
  const { rows } = await client.query(
    `
      UPDATE work_shift
      SET status = 'published',
          published_at = now(),
          published_by_user_id = $2,
          updated_at = now(),
          calendar_sync_required = true
      WHERE id = $1
      RETURNING *
    `,
    [shiftId, auth.id]
  );
  const shift = rows[0];
  if (!shift) {
    throw new ApiError(404, "Shift not found");
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: shift.assigned_user_id,
    action: "schedule.shift.published",
    entityType: "work_shift",
    entityId: shift.id,
    metadata: { starts_at: shift.starts_at, ends_at: shift.ends_at },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  await queueNotificationDispatch(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    recipientUserIds: [String(shift.assigned_user_id)],
    notificationType: "schedule.shift_published",
    title: `Shift published: ${shift.title}`,
    body: `You are scheduled for ${formatShiftWindow(shift.starts_at, shift.ends_at)} at ${shift.location_name}.`,
    priority: "high",
    deepLink: `/shifts/${shift.id}`,
    shiftId: shift.id,
    shootId: shift.shoot_id ?? null,
    relatedUserId: shift.assigned_user_id,
    channels: channelsForPriority("high"),
    metadata: { dedupe: shift.published_at ?? shift.updated_at }
  });

  await emitScheduleRealtimeChange(client, {
    tenantId: auth.tenantId,
    shiftId: shift.id,
    shootId: shift.shoot_id ?? null,
    title: shift.title,
    status: shift.status,
    changeType: "published",
    versionToken: String(shift.published_at ?? shift.updated_at ?? shift.id)
  });

  await reconcileSubmittedPTOConflictsForUser(client, {
    tenantId: auth.tenantId,
    userId: shift.assigned_user_id
  });

  await queueWorkShiftOutlookSync(client, {
    tenantId: auth.tenantId,
    shiftId: shift.id,
    triggeredByUserId: auth.id,
    operationType: "upsert",
    previousAssignedUserId: current.assigned_user_id,
    previousAssignedUserEmail: current.assigned_user_email ?? null,
    previousOutlookEventId: current.outlook_event_id ?? null,
    previousOutlookCalendarOwnerEmail: current.outlook_calendar_owner_email ?? null,
    dedupeSuffix: String(shift.published_at ?? shift.updated_at ?? shift.id)
  });

  return getShiftById(client, auth, shift.id);
}

export async function requestShiftTrade(
  client: PoolClient,
  auth: AuthUser,
  shiftId: string,
  input: { requested_with_user_id?: string | null; reason: string },
  meta: RequestMeta
) {
  await assertShiftAccess(client, auth, shiftId);
  const shift = await getShiftById(client, auth, shiftId);
  if (String(shift.assigned_user_id) !== auth.id) {
    throw new ApiError(403, "You can only request a trade for your own shift");
  }
  if (!input.requested_with_user_id) {
    throw new ApiError(400, "Choose a teammate to receive this trade request");
  }
  if (input.requested_with_user_id && input.requested_with_user_id === auth.id) {
    throw new ApiError(400, "Pick a different teammate for a swap request");
  }

  const levelCheck = await assertTradeRoleLevelEligible(client, auth.tenantId, auth.id, input.requested_with_user_id);
  const existingConflict = await findTradeAcceptanceConflict(client, {
    tenantId: auth.tenantId,
    shiftId,
    shootId: shift.shoot_id ?? null,
    userId: input.requested_with_user_id,
    startsAt: shift.starts_at,
    endsAt: shift.ends_at
  });
  const approverResolution = await resolveTradeApproverUserIds(client, {
    tenantId: auth.tenantId,
    department: shift.department,
    shiftManagerUserId: shift.manager_user_id ?? null,
    shootId: shift.shoot_id ?? null
  });
  const sameDay = getLocalDateString(shift.starts_at) === getLocalDateString();
  const { rows } = await client.query(
    `
      INSERT INTO shift_trade_request (
        tenant_id, shift_id, requester_user_id, requested_with_user_id, reason, status,
        same_day_exception_eligible, approval_routing_policy_code, approver_user_id,
        requester_role_rank, recipient_role_rank, conflict_code, conflict_summary
      )
      VALUES ($1,$2,$3,$4,$5,'pending_recipient',$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
    `,
    [
      auth.tenantId,
      shiftId,
      auth.id,
      input.requested_with_user_id,
      input.reason,
      sameDay,
      approverResolution.policy.policy_code,
      approverResolution.primaryApproverUserId,
      levelCheck.requester.level_rank,
      levelCheck.recipient.level_rank,
      existingConflict?.code ?? null,
      existingConflict?.summary ?? null
    ]
  );
  const tradeRequest = rows[0];

  const recipients = await findNotificationRecipients(client, {
    tenantId: auth.tenantId,
    eventCode: "schedule.trade_requested",
    shiftId,
    directUserIds: [input.requested_with_user_id],
    excludeUserIds: [auth.id]
  });
  await queueNotificationDispatch(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    recipientUserIds: recipients,
    notificationType: "schedule.trade_requested",
    title: `Trade requested for ${shift.title}`,
    body: `${auth.fullName} proposed a shift trade for ${formatShiftWindow(shift.starts_at, shift.ends_at)}.`,
    priority: sameDay ? "critical" : "high",
    deepLink: `/schedule/trades/${tradeRequest.id}`,
    shiftId,
    shootId: shift.shoot_id ?? null,
    relatedUserId: auth.id,
    channels: channelsForPriority(sameDay ? "critical" : "high"),
    metadata: { dedupe: tradeRequest.id }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: input.requested_with_user_id ?? null,
    action: "schedule.trade.requested",
    entityType: "shift_trade_request",
    entityId: tradeRequest.id,
    metadata: {
      shift_id: shiftId,
      same_day: sameDay,
      approver_user_id: approverResolution.primaryApproverUserId,
      approval_policy: approverResolution.policy.policy_code,
      requester_role_rank: levelCheck.requester.level_rank,
      recipient_role_rank: levelCheck.recipient.level_rank,
      conflict_summary: existingConflict?.summary ?? null
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return tradeRequest;
}

export async function respondToTradeRequest(
  client: PoolClient,
  auth: AuthUser,
  requestId: string,
  input: { status: "accepted" | "declined"; notes?: string | null },
  meta: RequestMeta
) {
  const { rows } = await client.query("SELECT * FROM shift_trade_request WHERE id = $1 LIMIT 1", [requestId]);
  const tradeRequest = rows[0];
  if (!tradeRequest) {
    throw new ApiError(404, "Trade request not found");
  }
  if (!tradeRequest.requested_with_user_id || String(tradeRequest.requested_with_user_id) !== auth.id) {
    throw new ApiError(403, "Only the proposed replacement can respond to this trade");
  }
  if (tradeRequest.status !== "pending_recipient") {
    throw new ApiError(409, "This trade request is no longer waiting on recipient response");
  }

  const shiftResult = await client.query("SELECT * FROM work_shift WHERE id = $1 LIMIT 1", [tradeRequest.shift_id]);
  const shift = shiftResult.rows[0];
  if (!shift) {
    throw new ApiError(404, "Shift not found");
  }

  if (input.status === "accepted") {
    const conflict = await findTradeAcceptanceConflict(client, {
      tenantId: auth.tenantId,
      shiftId: tradeRequest.shift_id,
      shootId: shift.shoot_id ?? null,
      userId: auth.id,
      startsAt: shift.starts_at,
      endsAt: shift.ends_at
    });
    if (conflict) {
      await client.query(
        `
          UPDATE shift_trade_request
          SET conflict_code = $2,
              conflict_summary = $3,
              updated_at = now()
          WHERE id = $1
        `,
        [requestId, conflict.code, conflict.summary]
      );
      throw new ApiError(409, conflict.summary);
    }

    const approverResolution = await resolveTradeApproverUserIds(client, {
      tenantId: auth.tenantId,
      department: shift.department,
      shiftManagerUserId: shift.manager_user_id ?? null,
      shootId: shift.shoot_id ?? null
    });

    const { rows: updatedRows } = await client.query(
      `
        UPDATE shift_trade_request
        SET status = 'pending_manager'::trade_request_status,
            recipient_responded_at = now(),
            recipient_notes = $2,
            approval_routing_policy_code = $3,
            approver_user_id = $4,
            conflict_code = NULL,
            conflict_summary = NULL,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [requestId, input.notes ?? null, approverResolution.policy.policy_code, approverResolution.primaryApproverUserId]
    );
    const updated = updatedRows[0];

    const recipients = await findNotificationRecipients(client, {
      tenantId: auth.tenantId,
      eventCode: "schedule.trade_pending_manager",
      shiftId: tradeRequest.shift_id,
      directUserIds: approverResolution.approverUserIds,
      excludeUserIds: [auth.id]
    });
    await queueNotificationDispatch(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      recipientUserIds: recipients,
      notificationType: "schedule.trade_pending_manager",
      title: `Trade review needed for ${shift.title}`,
      body: `${auth.fullName} accepted the trade. Manager approval is now required.`,
      priority: tradeRequest.same_day_exception_eligible ? "critical" : "high",
      deepLink: `/approvals?trade=${updated.id}`,
      shiftId: tradeRequest.shift_id,
      shootId: shift.shoot_id ?? null,
      relatedUserId: tradeRequest.requester_user_id,
      channels: channelsForPriority(tradeRequest.same_day_exception_eligible ? "critical" : "high"),
      metadata: { dedupe: updated.id }
    });
    await queueNotificationDispatch(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      recipientUserIds: [String(tradeRequest.requester_user_id)],
      notificationType: "schedule.trade_recipient_accepted",
      title: "Trade accepted by recipient",
      body: "Your trade request was accepted and is now waiting on manager approval.",
      priority: "high",
      deepLink: `/schedule/trades/${updated.id}`,
      shiftId: tradeRequest.shift_id,
      shootId: shift.shoot_id ?? null,
      relatedUserId: auth.id,
      channels: channelsForPriority("high"),
      metadata: { dedupe: updated.id }
    });

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: tradeRequest.requester_user_id,
      action: "schedule.trade.recipient_accepted",
      entityType: "shift_trade_request",
      entityId: requestId,
      metadata: {
        shift_id: tradeRequest.shift_id,
        approver_user_id: approverResolution.primaryApproverUserId,
        approval_policy: approverResolution.policy.policy_code,
        notes: input.notes ?? null
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });

    return updated;
  }

  const { rows: updatedRows } = await client.query(
    `
      UPDATE shift_trade_request
      SET status = 'recipient_declined'::trade_request_status,
          recipient_responded_at = now(),
          recipient_notes = $2,
          decided_by_user_id = $3,
          decided_at = now(),
          updated_at = now()
      WHERE id = $1
      RETURNING *
    `,
    [requestId, input.notes ?? null, auth.id]
  );
  const updated = updatedRows[0];

  await queueNotificationDispatch(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    recipientUserIds: [String(tradeRequest.requester_user_id)],
    notificationType: "schedule.trade_recipient_declined",
    title: "Trade declined by recipient",
    body: `${auth.fullName} declined the trade request. No manager review will happen.`,
    priority: "normal",
    deepLink: `/schedule/trades/${updated.id}`,
    shiftId: tradeRequest.shift_id,
    shootId: shift.shoot_id ?? null,
    relatedUserId: auth.id,
    channels: channelsForPriority("normal"),
    metadata: { dedupe: updated.id }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: tradeRequest.requester_user_id,
    action: "schedule.trade.recipient_declined",
    entityType: "shift_trade_request",
    entityId: requestId,
    metadata: {
      shift_id: tradeRequest.shift_id,
      notes: input.notes ?? null
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return updated;
}

export async function reviewTradeRequest(
  client: PoolClient,
  auth: AuthUser,
  requestId: string,
  input: { status: Extract<TradeRequestStatus, "approved" | "denied">; notes?: string | null },
  meta: RequestMeta
) {
  const { rows } = await client.query("SELECT * FROM shift_trade_request WHERE id = $1 LIMIT 1", [requestId]);
  const tradeRequest = rows[0];
  if (!tradeRequest) {
    throw new ApiError(404, "Trade request not found");
  }
  const shiftResult = await client.query("SELECT * FROM work_shift WHERE id = $1 LIMIT 1", [tradeRequest.shift_id]);
  const shift = shiftResult.rows[0];
  if (!shift) {
    throw new ApiError(404, "Shift not found");
  }
  if (tradeRequest.status !== "pending_manager") {
    throw new ApiError(409, "This trade request is not waiting on manager approval");
  }
  if (
    !(await canUserApproveTradeRequest(client, auth, {
      requesterUserId: String(tradeRequest.requester_user_id),
      requestedWithUserId: tradeRequest.requested_with_user_id ? String(tradeRequest.requested_with_user_id) : null,
      department: shift.department,
      shiftManagerUserId: shift.manager_user_id ? String(shift.manager_user_id) : null,
      shootId: shift.shoot_id ? String(shift.shoot_id) : null
    }))
  ) {
    throw new ApiError(403, "Manager or leadership review is required before a trade can finalize");
  }

  const leadControlledShift =
    shift.staffing_role === "lead_photographer" ||
    shift.staffing_role === "senior_photographer" ||
    Boolean(shift.satisfies_lead_coverage);

  if (leadControlledShift && !hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Lead and senior role trades require director or leadership approval");
  }

  if (input.status === "approved" && !tradeRequest.requested_with_user_id) {
    throw new ApiError(409, "A replacement employee is required before this trade can be approved");
  }

  if (input.status === "approved" && tradeRequest.requested_with_user_id) {
    const conflict = await findTradeAcceptanceConflict(client, {
      tenantId: auth.tenantId,
      shiftId: tradeRequest.shift_id,
      shootId: shift.shoot_id ?? null,
      userId: String(tradeRequest.requested_with_user_id),
      startsAt: shift.starts_at,
      endsAt: shift.ends_at
    });
    if (conflict) {
      await client.query(
        `
          UPDATE shift_trade_request
          SET conflict_code = $2,
              conflict_summary = $3,
              updated_at = now()
          WHERE id = $1
        `,
        [requestId, conflict.code, conflict.summary]
      );
      throw new ApiError(409, conflict.summary);
    }
  }

  const { rows: requestRows } = await client.query(
    `
      UPDATE shift_trade_request
      SET status = $2,
          manager_decided_by_user_id = $3,
          manager_decided_at = now(),
          manager_notes = $4,
          decided_by_user_id = $3,
          decided_at = now(),
          notes = $4,
          finalized_at = CASE WHEN $2::trade_request_status = 'approved' THEN now() ELSE finalized_at END,
          finalized_by_user_id = CASE WHEN $2::trade_request_status = 'approved' THEN $3 ELSE finalized_by_user_id END,
          updated_at = now()
      WHERE id = $1
      RETURNING *
    `,
    [requestId, input.status, auth.id, input.notes ?? null]
  );
  const updatedRequest = requestRows[0];

  if (input.status === "approved" && tradeRequest.requested_with_user_id) {
    if (leadControlledShift) {
      const replacementHasSeniorProfile = await userHasSeniorProfile(client, auth.tenantId, tradeRequest.requested_with_user_id);
      if (!replacementHasSeniorProfile) {
        throw new ApiError(409, "Lead coverage cannot be reassigned to a teammate without senior lead coverage");
      }
    }

    await client.query(
      `
        UPDATE work_shift
        SET assigned_user_id = $2,
            manager_user_id = COALESCE(manager_user_id, $3),
            updated_at = now(),
            calendar_sync_required = CASE WHEN status = 'published' THEN true ELSE calendar_sync_required END
        WHERE id = $1
      `,
      [tradeRequest.shift_id, tradeRequest.requested_with_user_id, tradeRequest.approver_user_id ?? shift.manager_user_id ?? null]
    );

    await reconcileSubmittedPTOConflictsForUser(client, {
      tenantId: auth.tenantId,
      userId: String(tradeRequest.requested_with_user_id)
    });
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: tradeRequest.requester_user_id,
    action: `schedule.trade.${input.status}`,
    entityType: "shift_trade_request",
    entityId: requestId,
    metadata: {
      shift_id: tradeRequest.shift_id,
      staffing_role: shift.staffing_role,
      satisfies_lead_coverage: Boolean(shift.satisfies_lead_coverage),
      requested_with_user_id: tradeRequest.requested_with_user_id ?? null,
      approver_user_id: updatedRequest.approver_user_id ?? null,
      manager_notes: input.notes ?? null
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  const statusLabel = input.status === "approved" ? "approved" : "denied";
  await queueNotificationDispatch(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    recipientUserIds: [
      String(tradeRequest.requester_user_id),
      ...(tradeRequest.requested_with_user_id ? [String(tradeRequest.requested_with_user_id)] : [])
    ],
    notificationType: `schedule.trade_${input.status}`,
    title: `Trade request ${statusLabel}`,
    body: `Your trade request for ${shift.title} was ${statusLabel}.`,
    priority: "high",
    deepLink: `/schedule/trades/${requestId}`,
    shiftId: tradeRequest.shift_id,
    shootId: shift.shoot_id ?? null,
    relatedUserId: tradeRequest.requester_user_id,
    channels: channelsForPriority("high"),
    metadata: { dedupe: requestId }
  });

  return updatedRequest;
}

export async function cancelTradeRequest(client: PoolClient, auth: AuthUser, requestId: string, meta: RequestMeta) {
  const { rows } = await client.query("SELECT * FROM shift_trade_request WHERE id = $1 LIMIT 1", [requestId]);
  const tradeRequest = rows[0];
  if (!tradeRequest) {
    throw new ApiError(404, "Trade request not found");
  }
  if (String(tradeRequest.requester_user_id) !== auth.id) {
    throw new ApiError(403, "Only the requesting employee can cancel this trade request");
  }
  if (!["pending_recipient", "pending_manager"].includes(tradeRequest.status)) {
    throw new ApiError(409, "This trade request can no longer be canceled");
  }

  const { rows: updatedRows } = await client.query(
    `
      UPDATE shift_trade_request
      SET status = 'canceled'::trade_request_status,
          canceled_by_user_id = $2,
          canceled_at = now(),
          updated_at = now()
      WHERE id = $1
      RETURNING *
    `,
    [requestId, auth.id]
  );
  const updated = updatedRows[0];

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: tradeRequest.requested_with_user_id ?? null,
    action: "schedule.trade.canceled",
    entityType: "shift_trade_request",
    entityId: requestId,
    metadata: {
      shift_id: tradeRequest.shift_id,
      status_before: tradeRequest.status
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  const recipients = uniqueUserIds([
    tradeRequest.requested_with_user_id ? String(tradeRequest.requested_with_user_id) : null,
    tradeRequest.approver_user_id ? String(tradeRequest.approver_user_id) : null
  ]);
  if (recipients.length) {
    await queueNotificationDispatch(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      recipientUserIds: recipients,
      notificationType: "schedule.trade_canceled",
      title: "Trade request canceled",
      body: `${auth.fullName} canceled the pending trade request.`,
      priority: "normal",
      deepLink: `/schedule/trades/${updated.id}`,
      shiftId: tradeRequest.shift_id,
      relatedUserId: auth.id,
      channels: channelsForPriority("normal"),
      metadata: { dedupe: updated.id }
    });
  }

  return updated;
}

export async function createPTORequest(
  client: PoolClient,
  auth: AuthUser,
  input: { requested_on: string; request_unit: "half_day" | "full_day"; reason?: string | null },
  meta: RequestMeta
) {
  const conflict = await findAssignedShootConflictForPTODate(client, auth.tenantId, auth.id, input.requested_on);
  if (conflict) {
    throw new ApiError(409, "PTO cannot be submitted because you are already assigned to a conflicting shoot on that date");
  }

  const approverResolution = await resolvePTOApproverUserIds(client, {
    tenantId: auth.tenantId,
    department: auth.department
  });
  const { rows } = await client.query(
    `
      INSERT INTO pto_request (
        tenant_id, user_id, department, starts_on, ends_on, partial_day, reason, status,
        requested_on, request_unit, requested_hours, approval_routing_policy_code, approver_user_id
      )
      VALUES ($1,$2,$3,$4,$4,$5,$6,'submitted',$4,$7,$8,$9,$10)
      RETURNING *
    `,
    [
      auth.tenantId,
      auth.id,
      auth.department,
      input.requested_on,
      input.request_unit === "half_day",
      input.reason ?? null,
      input.request_unit,
      resolvePTOHours(input.request_unit),
      approverResolution.policy.policy_code,
      approverResolution.primaryApproverUserId
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: auth.id,
    action: "schedule.pto.requested",
    entityType: "pto_request",
    entityId: rows[0].id,
    metadata: {
      requested_on: input.requested_on,
      request_unit: input.request_unit,
      requested_hours: resolvePTOHours(input.request_unit),
      approver_user_id: approverResolution.primaryApproverUserId,
      approval_policy: approverResolution.policy.policy_code
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  const recipients = await findNotificationRecipients(client, {
    tenantId: auth.tenantId,
    eventCode: "schedule.pto_requested",
    directUserIds: approverResolution.approverUserIds,
    excludeUserIds: [auth.id]
  });
  await queueNotificationDispatch(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    recipientUserIds: recipients,
    notificationType: "schedule.pto_requested",
    title: `PTO request from ${auth.fullName}`,
    body: `${auth.fullName} requested ${input.request_unit === "half_day" ? "half-day" : "full-day"} PTO for ${input.requested_on}.`,
    priority: "normal",
    deepLink: "/approvals?queue=pto",
    relatedUserId: auth.id,
    channels: channelsForPriority("normal"),
    metadata: { dedupe: rows[0].id }
  });

  return rows[0];
}

export async function cancelPTORequest(client: PoolClient, auth: AuthUser, requestId: string, meta: RequestMeta) {
  const { rows } = await client.query("SELECT * FROM pto_request WHERE id = $1 LIMIT 1", [requestId]);
  const request = rows[0];
  if (!request) {
    throw new ApiError(404, "PTO request not found");
  }
  if (String(request.user_id) !== auth.id) {
    throw new ApiError(403, "Only the requesting employee can cancel this PTO request");
  }
  if (request.status !== "submitted") {
    throw new ApiError(409, "Only submitted PTO requests can be canceled");
  }

  const { rows: updatedRows } = await client.query(
    `
      UPDATE pto_request
      SET status = 'canceled'::pto_request_status,
          canceled_by_user_id = $2,
          canceled_at = now(),
          updated_at = now()
      WHERE id = $1
      RETURNING *
    `,
    [requestId, auth.id]
  );
  const updated = updatedRows[0];

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: auth.id,
    action: "schedule.pto.canceled",
    entityType: "pto_request",
    entityId: requestId,
    metadata: {
      requested_on: request.requested_on,
      request_unit: request.request_unit
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  if (request.approver_user_id) {
    await queueNotificationDispatch(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      recipientUserIds: [String(request.approver_user_id)],
      notificationType: "schedule.pto_canceled",
      title: "PTO request canceled",
      body: `${auth.fullName} canceled a submitted PTO request for ${request.requested_on}.`,
      priority: "normal",
      deepLink: "/approvals?queue=pto",
      relatedUserId: auth.id,
      channels: channelsForPriority("normal"),
      metadata: { dedupe: requestId }
    });
  }

  return updated;
}

export async function reviewPTORequest(
  client: PoolClient,
  auth: AuthUser,
  requestId: string,
  input: { status: LegacyPTOReviewStatus; notes?: string | null },
  meta: RequestMeta
) {
  const { rows } = await client.query("SELECT * FROM pto_request WHERE id = $1 LIMIT 1", [requestId]);
  const request = rows[0];
  if (!request) {
    throw new ApiError(404, "PTO request not found");
  }
  if (request.status !== "submitted") {
    throw new ApiError(409, "This PTO request is no longer waiting on approval");
  }
  if (
    !(await canUserApprovePTORequest(client, auth, {
      requesterUserId: String(request.user_id),
      department: request.department
    }))
  ) {
    throw new ApiError(403, "Manager or leadership approval is required for this PTO request");
  }

  if (input.status === "approved") {
    const conflict = await findAssignedShootConflictForPTODate(client, auth.tenantId, String(request.user_id), request.requested_on);
    if (conflict) {
      const autoDenied = await autoDenyPTORequest(client, {
        tenantId: auth.tenantId,
        requestId,
        requesterUserId: String(request.user_id),
        requestedOn: String(request.requested_on),
        conflictingShiftId: conflict.shift_id,
        conflictingShootId: conflict.shoot_id,
        reason: "A conflicting shoot assignment appeared before PTO approval"
      });
      if (autoDenied) {
        return autoDenied;
      }
    }
  }

  const { rows: updatedRows } = await client.query(
    `
      UPDATE pto_request
      SET status = $2::pto_request_status,
          decided_by_user_id = $3,
          decided_at = now(),
          notes = $4,
          updated_at = now()
      WHERE id = $1
      RETURNING *
    `,
    [requestId, input.status, auth.id, input.notes ?? null]
  );
  const updated = updatedRows[0];

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: request.user_id,
    action: `schedule.pto.${input.status}`,
    entityType: "pto_request",
    entityId: requestId,
    metadata: {
      requested_on: request.requested_on,
      request_unit: request.request_unit,
      requested_hours: request.requested_hours,
      approver_user_id: auth.id,
      notes: input.notes ?? null
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  const recipients = await findNotificationRecipients(client, {
    tenantId: auth.tenantId,
    eventCode: `schedule.pto_${input.status}`,
    directUserIds: [String(request.user_id)],
    excludeUserIds: [auth.id]
  });

  await queueNotificationDispatch(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    recipientUserIds: recipients,
    notificationType: `schedule.pto_${input.status}`,
    title: `PTO ${input.status}`,
    body: `Your PTO request for ${request.requested_on} was ${input.status}.`,
    priority: "high",
    deepLink: "/approvals?queue=pto",
    relatedUserId: request.user_id,
    channels: channelsForPriority("high"),
    metadata: { dedupe: requestId, notes: input.notes ?? null }
  });

  return updated;
}

export async function listTradeRequests(client: PoolClient, auth: AuthUser, status?: TradeRequestStatus | null) {
  const values: unknown[] = [auth.tenantId];
  const where = ["str.tenant_id = $1"];

  if (status) {
    values.push(status);
    where.push(`str.status = $${values.length}::trade_request_status`);
  }
  if (shouldRestrictShiftList(auth)) {
    values.push(auth.id);
    where.push(
      `(str.requester_user_id = $${values.length} OR str.requested_with_user_id = $${values.length} OR str.approver_user_id = $${values.length} OR ws.assigned_user_id = $${values.length})`
    );
  } else if (shouldDepartmentScopeShiftList(auth)) {
    values.push(auth.department);
    where.push(`(ws.department = $${values.length}::department_code OR str.approver_user_id = ${pushValue(values, auth.id)})`);
  }

  const { rows } = await client.query(
    `
      SELECT
        str.*,
        ws.title AS shift_title,
        ws.department,
        ws.starts_at,
        ws.ends_at,
        ws.manager_user_id,
        ws.staffing_role,
        ws.satisfies_lead_coverage,
        s.shoot_code,
        s.title AS shoot_title,
        requester.full_name AS requester_name,
        requested.full_name AS requested_with_name,
        approver.full_name AS approver_name,
        CASE
          WHEN str.requested_with_user_id IS NULL THEN false
          ELSE EXISTS (
            SELECT 1
            FROM work_shift overlap_shift
            WHERE overlap_shift.assigned_user_id = str.requested_with_user_id
              AND overlap_shift.id <> str.shift_id
              AND overlap_shift.cancelled_at IS NULL
              AND overlap_shift.status IN ('draft', 'published', 'completed')
              AND tstzrange(overlap_shift.starts_at, overlap_shift.ends_at, '[)') &&
                  tstzrange(ws.starts_at, ws.ends_at, '[)')
          )
        END AS requested_with_conflict
      FROM shift_trade_request str
      JOIN work_shift ws ON ws.id = str.shift_id
      LEFT JOIN shoot s ON s.id = ws.shoot_id
      JOIN app_user requester ON requester.id = str.requester_user_id
      LEFT JOIN app_user requested ON requested.id = str.requested_with_user_id
      LEFT JOIN app_user approver ON approver.id = str.approver_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY str.created_at DESC
      LIMIT 500
    `,
    values
  );
  return rows;
}

export async function listPTORequests(client: PoolClient, auth: AuthUser, status?: string | null) {
  const values: unknown[] = [auth.tenantId];
  const where = ["pto.tenant_id = $1"];

  if (status) {
    values.push(status);
    where.push(`pto.status = $${values.length}::pto_request_status`);
  }
  if (shouldRestrictShiftList(auth)) {
    values.push(auth.id);
    where.push(`(pto.user_id = $${values.length} OR pto.approver_user_id = $${values.length})`);
  } else if (shouldDepartmentScopeShiftList(auth)) {
    values.push(auth.department);
    where.push(`(pto.department = $${values.length}::department_code OR pto.approver_user_id = ${pushValue(values, auth.id)})`);
  }

  const { rows } = await client.query(
    `
      SELECT pto.*, au.full_name AS user_name, approver.full_name AS approver_name
      FROM pto_request pto
      JOIN app_user au ON au.id = pto.user_id
      LEFT JOIN app_user approver ON approver.id = pto.approver_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY pto.created_at DESC
      LIMIT 500
    `,
    values
  );
  return rows;
}

export async function exportPTORequestsCsv(
  client: PoolClient,
  auth: AuthUser,
  filters: { status?: string | null; dateFrom?: string | null; dateTo?: string | null } = {}
) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Leadership or directors can export PTO requests");
  }

  const values: unknown[] = [auth.tenantId];
  const where = ["pto.tenant_id = $1"];
  if (filters.status) {
    values.push(filters.status);
    where.push(`pto.status = $${values.length}::pto_request_status`);
  }
  if (filters.dateFrom) {
    values.push(filters.dateFrom);
    where.push(`pto.requested_on >= $${values.length}::date`);
  }
  if (filters.dateTo) {
    values.push(filters.dateTo);
    where.push(`pto.requested_on <= $${values.length}::date`);
  }

  const { rows } = await client.query<{
    employee_name: string;
    department: string;
    requested_on: string;
    request_unit: string;
    requested_hours: string;
    status: string;
    decided_at: string | null;
  }>(
    `
      SELECT
        au.full_name AS employee_name,
        pto.department::text AS department,
        pto.requested_on::text AS requested_on,
        pto.request_unit,
        pto.requested_hours::text AS requested_hours,
        pto.status::text AS status,
        pto.decided_at::text AS decided_at
      FROM pto_request pto
      JOIN app_user au ON au.id = pto.user_id
      WHERE ${where.join(" AND ")}
      ORDER BY pto.requested_on ASC, au.full_name ASC
    `,
    values
  );

  const header = ["employee_name", "department", "requested_on", "request_unit", "requested_hours", "status", "decided_at"];
  const csvRows = rows.map((row) =>
    [row.employee_name, row.department, row.requested_on, row.request_unit, row.requested_hours, row.status, row.decided_at ?? ""]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header.join(","), ...csvRows].join("\n");
}

export async function deleteShift(client: PoolClient, auth: AuthUser, shiftId: string, meta: RequestMeta) {
  const shift = await getShiftById(client, auth, shiftId);
  const dangerousAction = await beginDangerousAction(client, auth, {
    actionCode: "delete_shift",
    entityType: "work_shift",
    entityId: shiftId,
    sourceModule: "shifts",
    reason: "Leadership requested shift deletion",
    beforeValue: {
      assigned_user_id: shift.assigned_user_id,
      shoot_id: shift.shoot_id,
      starts_at: shift.starts_at,
      ends_at: shift.ends_at,
      status: shift.status
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  try {
    const { rowCount } = await client.query(
      `
        UPDATE work_shift
        SET cancelled_at = now(),
            status = 'cancelled'::work_shift_status,
            updated_at = now()
        WHERE id = $1
      `,
      [shiftId]
    );
    if (!rowCount) {
      throw new ApiError(404, "Shift not found");
    }

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: shift.assigned_user_id,
      action: "schedule.shift.deleted",
      entityType: "work_shift",
      entityId: shiftId,
      metadata: {
        shift_id: shiftId,
        deleted_mode: "cancelled_record",
        execution_mode: "manual"
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });

    await queueNotificationDispatch(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      recipientUserIds: [String(shift.assigned_user_id)],
      notificationType: "schedule.shift_deleted",
      title: `Shift deleted for ${shift.title}`,
      body: `A leadership user removed your shift scheduled for ${formatShiftWindow(shift.starts_at, shift.ends_at)}.`,
      priority: "high",
      deepLink: "/schedule",
      shiftId,
      shootId: shift.shoot_id ?? null,
      relatedUserId: shift.assigned_user_id,
      channels: channelsForPriority("high"),
      metadata: { dedupe: shiftId }
    });

    await completeDangerousAction(client, auth, {
      executionId: dangerousAction.executionId,
      actionCode: "delete_shift",
      entityType: "work_shift",
      entityId: shiftId,
      afterValue: { status: "cancelled", cancelled_at: new Date().toISOString() },
      reason: "Leadership requested shift deletion",
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });

    await queueWorkShiftOutlookSync(client, {
      tenantId: auth.tenantId,
      shiftId,
      triggeredByUserId: auth.id,
      operationType: "cancel",
      previousAssignedUserId: shift.assigned_user_id,
      previousAssignedUserEmail: shift.assigned_user_email ?? null,
      previousOutlookEventId: shift.outlook_event_id ?? null,
      previousOutlookCalendarOwnerEmail: shift.outlook_calendar_owner_email ?? null,
      dedupeSuffix: `cancel:${new Date().toISOString()}`
    });

    return true;
  } catch (error) {
    await failDangerousAction(client, auth, {
      executionId: dangerousAction.executionId,
      actionCode: "delete_shift",
      entityType: "work_shift",
      entityId: shiftId,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });
    throw error;
  }
}
