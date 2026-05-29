import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import { createAppEvent } from "./outbox.js";
import type { AuthUser } from "../types/auth.js";
import type {
  NotificationCategory,
  NotificationCenterState,
  NotificationChannel,
  NotificationEventType,
  NotificationPriority,
  NotificationSeverity,
  NotificationStatus
} from "../types/domain.js";
import { evaluateShootPriority } from "./shootPriority.js";
import { hasPublishedSeniorScopeOnShoot } from "./shiftAccess.js";

type RecipientLookupOptions = {
  tenantId: string;
  eventCode: string;
  shiftId?: string | null;
  shootId?: string | null;
  directUserIds?: string[];
  excludeUserIds?: string[];
};

type QueueNotificationInput = {
  tenantId: string;
  actorUserId?: string | null;
  recipientUserIds: string[];
  notificationType: string;
  title: string;
  body: string;
  priority?: NotificationPriority;
  deepLink?: string | null;
  shiftId?: string | null;
  shootId?: string | null;
  attendanceExceptionId?: string | null;
  relatedUserId?: string | null;
  channels?: NotificationChannel[];
  metadata?: Record<string, unknown>;
  category?: NotificationCategory;
  severity?: NotificationSeverity;
  actionRequired?: boolean;
  actionOwnerUserId?: string | null;
  dueAt?: string | null;
  requiresAcknowledgement?: boolean;
  allowSnooze?: boolean;
  digestEligible?: boolean;
  sourceEvent?: string | null;
  groupKey?: string | null;
  appEventDedupeKey?: string | null;
};

export type QueuedNotificationDispatch = {
  recipientUserId: string;
  appEventId: string;
  groupKey: string;
  channels: NotificationChannel[];
};

type ListNotificationOptions = {
  includeResolved?: boolean;
  limit?: number;
  states?: NotificationCenterState[];
  categories?: NotificationCategory[];
  view?: NotificationCenterViewId;
  actionableOnly?: boolean;
};

type NotificationRow = {
  id: string;
  tenant_id: string;
  recipient_user_id: string;
  related_user_id: string | null;
  shift_id: string | null;
  shoot_id: string | null;
  attendance_exception_id: string | null;
  notification_type: string;
  channel: NotificationChannel;
  priority: NotificationPriority;
  status: NotificationStatus;
  title: string;
  body: string;
  deep_link: string | null;
  metadata: Record<string, unknown> | null;
  category: NotificationCategory;
  severity: NotificationSeverity;
  action_required: boolean;
  action_owner_user_id: string | null;
  due_at: string | null;
  source_event: string | null;
  state: NotificationCenterState;
  seen_at: string | null;
  acknowledged_at: string | null;
  snoozed_until: string | null;
  resolved_at: string | null;
  expired_at: string | null;
  escalated_at: string | null;
  escalation_level: number;
  requires_acknowledgement: boolean;
  allow_snooze: boolean;
  group_key: string;
  digest_eligible: boolean;
  quiet_hours_deferred: boolean;
  delivery_channels: unknown;
  created_at: string;
  updated_at: string;
};

type GroupedNotification = {
  primary: NotificationRow;
  rows: NotificationRow[];
};

export type OpsNotificationRecord = {
  id: string;
  group_key: string;
  recipient_user_id: string;
  related_user_id: string | null;
  shift_id: string | null;
  shoot_id: string | null;
  attendance_exception_id: string | null;
  notification_type: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  priority: NotificationPriority;
  status: NotificationCenterState;
  delivery_status: NotificationStatus;
  title: string;
  body: string;
  deep_link: string | null;
  created_at: string;
  updated_at: string;
  due_at: string | null;
  action_required: boolean;
  action_owner_user_id: string | null;
  requires_acknowledgement: boolean;
  allow_snooze: boolean;
  acknowledged_at: string | null;
  seen_at: string | null;
  snoozed_until: string | null;
  resolved_at: string | null;
  expired_at: string | null;
  escalated_at: string | null;
  escalation_level: number;
  digest_eligible: boolean;
  quiet_hours_deferred: boolean;
  source_event: string | null;
  channel: NotificationChannel;
  delivery_channels: NotificationChannel[];
  metadata: Record<string, unknown>;
};

export type NotificationCenterViewId = "all" | "my_action_needed" | "team_risk" | "approval_queue" | "escalated" | "resolved_recent";

export type NotificationCenterResponse = {
  generated_at: string;
  view: NotificationCenterViewId;
  summary: {
    active_count: number;
    new_count: number;
    action_required_count: number;
    critical_count: number;
    escalated_count: number;
    resolved_recent_count: number;
  };
  saved_views: Array<{
    id: NotificationCenterViewId;
    label: string;
    count: number;
  }>;
  items: OpsNotificationRecord[];
};

type NotificationRule = {
  category: NotificationCategory;
  severity: NotificationSeverity;
  actionRequired: boolean;
  requiresAcknowledgement?: boolean;
  allowSnooze?: boolean;
  digestEligible?: boolean;
  dueMinutes?: number | null;
  quietHoursDeferred?: boolean;
  escalateOnHighImportance?: boolean;
};

const VIEW_LABELS: Record<NotificationCenterViewId, string> = {
  all: "All Active",
  my_action_needed: "My Action Needed",
  team_risk: "Team Risk",
  approval_queue: "Approval Queue",
  escalated: "Escalated",
  resolved_recent: "Resolved Recent"
};

const TEAM_RISK_CATEGORIES = new Set<NotificationCategory>([
  "urgent_operational_risk",
  "staffing",
  "attendance_time",
  "schedule_change",
  "production"
]);

const ACTIVE_STATES = new Set<NotificationCenterState>(["new", "seen", "acknowledged", "snoozed", "escalated"]);

function ruleFor(type: string): NotificationRule {
  if (type === "schedule.pto_requested") return { category: "approval_needed", severity: "medium", actionRequired: true, dueMinutes: 480, allowSnooze: true, digestEligible: true, quietHoursDeferred: true };
  if (type === "schedule.pto_approved") return { category: "pto_availability", severity: "low", actionRequired: false, digestEligible: true, quietHoursDeferred: true };
  if (type === "schedule.pto_rejected") return { category: "pto_availability", severity: "medium", actionRequired: true, dueMinutes: 720, allowSnooze: true };
  if (type === "schedule.same_day_absence_reported") return { category: "pto_availability", severity: "high", actionRequired: true, dueMinutes: 30, allowSnooze: true, escalateOnHighImportance: true };
  if (type === "schedule.shift_changed") return { category: "schedule_change", severity: "high", actionRequired: true, dueMinutes: 90, allowSnooze: true, escalateOnHighImportance: true };
  if (type === "schedule.shift_published") return { category: "assignment_update", severity: "medium", actionRequired: true, dueMinutes: 720, allowSnooze: true };
  if (type.startsWith("schedule.staffing.")) return { category: "staffing", severity: "high", actionRequired: true, dueMinutes: 120, allowSnooze: true, escalateOnHighImportance: true };
  if (type.startsWith("attendance.")) return { category: "attendance_time", severity: type.includes("critical") || type.includes("no_show") ? "critical" : type.includes("late") || type.includes("outside") || type.includes("missed_punch") ? "high" : "medium", actionRequired: true, dueMinutes: 90, allowSnooze: true, requiresAcknowledgement: type.includes("no_show"), quietHoursDeferred: false, escalateOnHighImportance: true };
  if (type === "shoot.ready_to_shoot_confirmed") return { category: "urgent_operational_risk", severity: "high", actionRequired: false, digestEligible: false, quietHoursDeferred: false, escalateOnHighImportance: true };
  if (type === "shoot.ready_to_shoot_exception" || type === "shoot.ready_to_shoot_missing") return { category: "urgent_operational_risk", severity: "critical", actionRequired: true, dueMinutes: 20, allowSnooze: true, requiresAcknowledgement: true, quietHoursDeferred: false, escalateOnHighImportance: true };
  if (type === "shoot.ready_to_shoot_reminder") return { category: "urgent_operational_risk", severity: "high", actionRequired: true, dueMinutes: 15, allowSnooze: true, quietHoursDeferred: false, escalateOnHighImportance: true };
  if (type.startsWith("shoot.closeout_")) return { category: "follow_up_task", severity: "high", actionRequired: true, dueMinutes: 360, allowSnooze: true };
  if (type.startsWith("gear.")) return { category: "urgent_operational_risk", severity: "high", actionRequired: true, dueMinutes: 240, allowSnooze: true };
  if (type.startsWith("sales.")) return { category: "follow_up_task", severity: "medium", actionRequired: true, dueMinutes: 480, allowSnooze: true, digestEligible: true, quietHoursDeferred: true };
  return { category: "informational_summary", severity: "medium", actionRequired: false, digestEligible: true, quietHoursDeferred: true };
}

function isNotificationChannel(value: unknown): value is NotificationChannel {
  return value === "in_app" || value === "push" || value === "sms" || value === "email";
}

function priorityToSeverity(priority?: NotificationPriority | null): NotificationSeverity {
  return priority === "critical" ? "critical" : priority === "high" ? "high" : "medium";
}

function severityToPriority(severity: NotificationSeverity): NotificationPriority {
  return severity === "critical" ? "critical" : severity === "high" ? "high" : "normal";
}

function normalizeChannels(channels: NotificationChannel[] | undefined, severity: NotificationSeverity, quietHoursDeferred: boolean) {
  const unique = [...new Set((channels ?? []).filter(isNotificationChannel))];
  if (!unique.includes("in_app")) unique.unshift("in_app");
  const hour = new Date().getHours();
  const quietHours = hour >= 22 || hour < 6;
  if (!quietHoursDeferred || !quietHours || severity === "high" || severity === "critical") {
    return { channels: unique, quietHoursDeferred: false };
  }
  return { channels: unique.filter((channel) => channel === "in_app"), quietHoursDeferred: unique.some((channel) => channel !== "in_app") };
}

function buildGroupKey(input: { notificationType: string; shiftId?: string | null; shootId?: string | null; attendanceExceptionId?: string | null; metadata?: Record<string, unknown>; groupKey?: string | null }) {
  if (input.groupKey && input.groupKey.trim()) return input.groupKey.trim();
  const dedupe = typeof input.metadata?.dedupe === "string" && input.metadata.dedupe.trim() ? input.metadata.dedupe.trim() : "default";
  return [input.notificationType, input.shiftId ?? "none", input.shootId ?? "none", input.attendanceExceptionId ?? "none", dedupe].join(":");
}

function parseMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseDeliveryChannels(value: unknown, fallbackChannel: NotificationChannel): NotificationChannel[] {
  if (Array.isArray(value)) {
    const parsed = value.filter(isNotificationChannel);
    if (parsed.length) {
      return [...new Set(parsed)];
    }
  }
  return [fallbackChannel];
}

function isResolvedState(value: NotificationCenterState) {
  return value === "resolved" || value === "expired";
}

function isApprovalQueueRecord(record: OpsNotificationRecord) {
  return record.category === "approval_needed" || record.notification_type.includes("approval") || record.notification_type.includes("pto_");
}

function coerceIsoString(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function computeDeliveryStatus(rows: NotificationRow[]): NotificationStatus {
  if (rows.some((row) => row.status === "failed")) return "failed";
  if (rows.some((row) => row.status === "sent")) return "sent";
  if (rows.some((row) => row.status === "pending")) return "pending";
  if (rows.every((row) => row.status === "dismissed")) return "dismissed";
  return "skipped";
}

function groupNotificationRows(rows: NotificationRow[]) {
  const groups = new Map<string, GroupedNotification>();
  for (const row of rows) {
    const existing = groups.get(row.group_key);
    if (!existing) {
      groups.set(row.group_key, { primary: row, rows: [row] });
      continue;
    }
    existing.rows.push(row);
  }
  return [...groups.values()];
}

function deriveNotificationLifecycle(row: NotificationRow) {
  if (row.resolved_at || row.expired_at) {
    return {
      state: row.state,
      snoozed_until: row.snoozed_until,
      escalated_at: row.escalated_at,
      escalation_level: row.escalation_level
    };
  }

  const now = Date.now();
  const dueAtMs = row.due_at ? new Date(row.due_at).getTime() : null;
  const snoozedUntilMs = row.snoozed_until ? new Date(row.snoozed_until).getTime() : null;
  const dueElapsed = dueAtMs !== null && dueAtMs <= now;
  const snoozeElapsed = row.state === "snoozed" && snoozedUntilMs !== null && snoozedUntilMs <= now;

  if (snoozeElapsed) {
    if (dueElapsed) {
      return {
        state: "escalated" as const,
        snoozed_until: null,
        escalated_at: row.escalated_at ?? new Date(now).toISOString(),
        escalation_level: Math.max(row.escalation_level, 1)
      };
    }

    return {
      state: "new" as const,
      snoozed_until: null,
      escalated_at: row.escalated_at,
      escalation_level: row.escalation_level
    };
  }

  if (dueElapsed && (row.state === "new" || row.state === "seen" || row.state === "acknowledged")) {
    return {
      state: "escalated" as const,
      snoozed_until: row.snoozed_until,
      escalated_at: row.escalated_at ?? new Date(now).toISOString(),
      escalation_level: Math.max(row.escalation_level, 1)
    };
  }

  return {
    state: row.state,
    snoozed_until: row.snoozed_until,
    escalated_at: row.escalated_at,
    escalation_level: row.escalation_level
  };
}

function toNotificationRecord(group: GroupedNotification): OpsNotificationRecord {
  const primary = group.primary;
  const lifecycle = deriveNotificationLifecycle(primary);
  const deliveryChannels = new Set<NotificationChannel>();
  for (const row of group.rows) {
    deliveryChannels.add(row.channel);
    for (const channel of parseDeliveryChannels(row.delivery_channels, row.channel)) {
      deliveryChannels.add(channel);
    }
  }

  const latestUpdated = group.rows.reduce((latest, row) => {
    const latestMs = new Date(latest).getTime();
    const rowMs = new Date(row.updated_at ?? row.created_at).getTime();
    return rowMs > latestMs ? row.updated_at ?? row.created_at : latest;
  }, primary.updated_at ?? primary.created_at);

  return {
    id: primary.id,
    group_key: primary.group_key,
    recipient_user_id: primary.recipient_user_id,
    related_user_id: primary.related_user_id,
    shift_id: primary.shift_id,
    shoot_id: primary.shoot_id,
    attendance_exception_id: primary.attendance_exception_id,
    notification_type: primary.notification_type,
    category: primary.category,
    severity: primary.severity,
    priority: primary.priority,
    status: lifecycle.state,
    delivery_status: computeDeliveryStatus(group.rows),
    title: primary.title,
    body: primary.body,
    deep_link: primary.deep_link,
    created_at: primary.created_at,
    updated_at: latestUpdated,
    due_at: coerceIsoString(primary.due_at),
    action_required: primary.action_required,
    action_owner_user_id: primary.action_owner_user_id,
    requires_acknowledgement: primary.requires_acknowledgement,
    allow_snooze: primary.allow_snooze,
    acknowledged_at: coerceIsoString(primary.acknowledged_at),
    seen_at: coerceIsoString(primary.seen_at),
    snoozed_until: coerceIsoString(lifecycle.snoozed_until),
    resolved_at: coerceIsoString(primary.resolved_at),
    expired_at: coerceIsoString(primary.expired_at),
    escalated_at: coerceIsoString(lifecycle.escalated_at),
    escalation_level: lifecycle.escalation_level,
    digest_eligible: primary.digest_eligible,
    quiet_hours_deferred: primary.quiet_hours_deferred,
    source_event: primary.source_event,
    channel: primary.channel,
    delivery_channels: [...deliveryChannels],
    metadata: parseMetadata(primary.metadata)
  };
}

function matchesNotificationFilters(record: OpsNotificationRecord, options: ListNotificationOptions = {}) {
  if (!options.includeResolved && isResolvedState(record.status)) {
    return false;
  }

  if (options.states?.length && !options.states.includes(record.status)) {
    return false;
  }

  if (options.categories?.length && !options.categories.includes(record.category)) {
    return false;
  }

  if (options.actionableOnly && !record.action_required) {
    return false;
  }

  switch (options.view ?? "all") {
    case "all":
      return options.includeResolved ? true : ACTIVE_STATES.has(record.status);
    case "my_action_needed":
      return ACTIVE_STATES.has(record.status) && record.action_required;
    case "team_risk":
      return ACTIVE_STATES.has(record.status) && TEAM_RISK_CATEGORIES.has(record.category) && (record.severity === "high" || record.severity === "critical" || record.requires_acknowledgement);
    case "approval_queue":
      return ACTIVE_STATES.has(record.status) && isApprovalQueueRecord(record);
    case "escalated":
      return record.status === "escalated";
    case "resolved_recent": {
      if (!isResolvedState(record.status)) {
        return false;
      }
      const resolvedAt = record.resolved_at ?? record.expired_at ?? record.updated_at;
      return new Date(resolvedAt).getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000;
    }
    default:
      return true;
  }
}

function severityRank(value: NotificationSeverity) {
  if (value === "critical") return 4;
  if (value === "high") return 3;
  if (value === "medium") return 2;
  return 1;
}

function stateRank(value: NotificationCenterState) {
  if (value === "escalated") return 6;
  if (value === "new") return 5;
  if (value === "acknowledged") return 4;
  if (value === "seen") return 3;
  if (value === "snoozed") return 2;
  if (value === "resolved") return 1;
  return 0;
}

function sortNotifications(left: OpsNotificationRecord, right: OpsNotificationRecord) {
  const severityDelta = severityRank(right.severity) - severityRank(left.severity);
  if (severityDelta !== 0) {
    return severityDelta;
  }

  const stateDelta = stateRank(right.status) - stateRank(left.status);
  if (stateDelta !== 0) {
    return stateDelta;
  }

  const leftDue = left.due_at ? new Date(left.due_at).getTime() : Number.MAX_SAFE_INTEGER;
  const rightDue = right.due_at ? new Date(right.due_at).getTime() : Number.MAX_SAFE_INTEGER;
  if (leftDue !== rightDue) {
    return leftDue - rightDue;
  }

  return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
}

async function recordEvent(client: PoolClient, input: { tenantId: string; notificationId: string; actorUserId?: string | null; eventType: NotificationEventType; channel?: NotificationChannel | null; metadata?: Record<string, unknown> }) {
  await client.query(
    `INSERT INTO ops_notification_event (tenant_id, notification_id, actor_user_id, event_type, channel, metadata) VALUES ($1,$2,$3,$4::notification_event_type,$5::notification_channel,$6::jsonb)`,
    [input.tenantId, input.notificationId, input.actorUserId ?? null, input.eventType, input.channel ?? null, JSON.stringify(input.metadata ?? {})]
  );
}

async function getRoleRecipients(client: PoolClient, tenantId: string, eventCode: string, shiftDepartment?: string | null) {
  const { rows } = await client.query(
    `
      SELECT DISTINCT au.id
      FROM notification_routing_rule nrr
      JOIN role r ON r.code = nrr.role_code
      JOIN user_role ur ON ur.role_id = r.id AND ur.tenant_id = nrr.tenant_id
      JOIN app_user au ON au.id = ur.user_id AND au.tenant_id = ur.tenant_id
      WHERE nrr.tenant_id = $1
        AND nrr.event_code = $2
        AND nrr.enabled = true
        AND au.status = 'active'
        AND ($3::department_code IS NULL OR nrr.department IS NULL OR nrr.department = $3::department_code)
    `,
    [tenantId, eventCode, shiftDepartment ?? null]
  );
  return rows.map((row) => String(row.id));
}

async function getShiftContext(client: PoolClient, shiftId?: string | null) {
  if (!shiftId) return null;
  const { rows } = await client.query(
    `
      SELECT
        ws.*,
        s.shoot_code,
        s.projected_students,
        s.planned_staff_count,
        s.estimated_drive_minutes,
        s.camera_station_count,
        s.shoot_structure::text,
        s.additional_products_flag,
        s.special_equipment_flag,
        s.additional_products,
        s.special_equipment,
        s.multi_team_coordination,
        s.first_year_customer_flag,
        s.flagship_priority_account_flag,
        s.strategic_district_importance,
        s.revenue_potential_score,
        s.account_growth_importance_score,
        s.complexity_score,
        s.customer_history_risk_score,
        s.weather_travel_risk_flag,
        s.manual_leadership_boost,
        s.operations_priority::text,
        s.big_shoot_manual_override,
        s.importance_override_tier::text,
        s.importance_override_reason,
        COALESCE(
          (
            SELECT SUM(str.headcount)
            FROM staffing_template_role str
            WHERE str.tenant_id = s.tenant_id
              AND str.staffing_template_id = s.staffing_template_id
              AND str.staffing_role IN ('lead_photographer', 'senior_photographer', 'photographer')
          ),
          0
        ) AS template_photographer_count,
        EXISTS (
          SELECT 1
          FROM shoot_location_link sl
          JOIN post_shoot_evaluation pse
            ON pse.location_id = sl.location_id
           AND pse.tenant_id = sl.tenant_id
          WHERE sl.tenant_id = s.tenant_id
            AND sl.shoot_id = s.id
            AND (
              pse.overall_rating <= 2
              OR pse.on_time = 'No'
              OR pse.easy_access = 'No'
              OR COALESCE(NULLIF(trim(pse.late_details), ''), NULLIF(trim(pse.access_details), ''), NULLIF(trim(pse.notes), '')) IS NOT NULL
            )
        ) AS prior_major_issue_exists,
        COALESCE(
          (
            SELECT COUNT(DISTINCT child_ws.assigned_user_id)
            FROM work_shift child_ws
            WHERE child_ws.shoot_id = s.id
              AND child_ws.cancelled_at IS NULL
              AND child_ws.status IN ('draft', 'published', 'completed')
          ),
          CASE WHEN ws.assigned_user_id IS NULL THEN 0 ELSE 1 END
        ) AS assigned_staff_count
      FROM work_shift ws
      LEFT JOIN shoot s ON s.id = ws.shoot_id
      WHERE ws.id = $1
      LIMIT 1
    `,
    [shiftId]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }

  const plannedStaffCount = Number(row.planned_staff_count ?? 0);
  const assignedStaffCount = Number(row.assigned_staff_count ?? (row.assigned_user_id ? 1 : 0));
  const priority = evaluateShootPriority({
    projectedHeadcount: Number(row.projected_students ?? 0),
    photographerHeadcount: Number(row.template_photographer_count ?? 0),
    assignedStaffCount,
    plannedStaffCount,
    estimatedDriveMinutes: row.estimated_drive_minutes == null ? null : Number(row.estimated_drive_minutes),
    cameraStationCount: row.camera_station_count == null ? null : Number(row.camera_station_count),
    shootStructure: (row.shoot_structure as "standard" | "open_house" | null | undefined) ?? "standard",
    hasSpecialtyRequirements:
      Boolean(row.additional_products_flag) ||
      Boolean(row.special_equipment_flag) ||
      Boolean(row.additional_products) ||
      Boolean(row.special_equipment) ||
      Boolean(row.multi_team_coordination),
    firstYearCustomerFlag: Boolean(row.first_year_customer_flag),
    flagshipPriorityAccountFlag: Boolean(row.flagship_priority_account_flag),
    strategicDistrictImportance: Boolean(row.strategic_district_importance),
    revenuePotentialScore: row.revenue_potential_score == null ? null : Number(row.revenue_potential_score),
    accountGrowthImportanceScore:
      row.account_growth_importance_score == null ? null : Number(row.account_growth_importance_score),
    complexityScore: row.complexity_score == null ? null : Number(row.complexity_score),
    customerHistoryRiskScore:
      row.customer_history_risk_score == null ? null : Number(row.customer_history_risk_score),
    priorMajorIssueExists: Boolean(row.prior_major_issue_exists),
    multiTeamCoordination: Boolean(row.multi_team_coordination),
    missingStaffingCoverageCount: Math.max(plannedStaffCount - assignedStaffCount, 0),
    missingRequiredPrepCount: 0,
    weatherTravelRiskFlag: Boolean(row.weather_travel_risk_flag),
    manualLeadershipBoost: row.manual_leadership_boost == null ? null : Number(row.manual_leadership_boost),
    operationsPriority: (row.operations_priority as "standard" | "elevated" | "high_priority" | null | undefined) ?? null,
    manualBigShootOverride: Boolean(row.big_shoot_manual_override),
    importanceOverrideTier: (row.importance_override_tier as "standard" | "elevated" | "big_shoot" | "critical_shoot" | null | undefined) ?? null,
    importanceOverrideReason: typeof row.importance_override_reason === "string" ? row.importance_override_reason : null
  });

  return {
    ...row,
    priority_label: priority.priorityLabel
  };
}

async function getLeadershipRecipients(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT DISTINCT uaa.user_id AS id
      FROM user_authority_assignment uaa
      JOIN app_user au
        ON au.id = uaa.user_id
       AND au.tenant_id = uaa.tenant_id
      WHERE uaa.tenant_id = $1
        AND au.status = 'active'
        AND uaa.authority_tier = ANY($2::authority_tier[])
    `,
    [tenantId, ["super_admin", "leadership", "director_admin"]]
  );
  return rows.map((row) => row.id);
}

async function refreshNotificationLifecycle(client: PoolClient, tenantId: string, userId: string) {
  const reopened = await client.query<{ id: string; channel: NotificationChannel; state: NotificationCenterState }>(
    `
      UPDATE ops_notification
      SET
        state = CASE
          WHEN due_at IS NOT NULL AND due_at <= now() THEN 'escalated'::notification_center_state
          ELSE 'new'::notification_center_state
        END,
        snoozed_until = NULL,
        escalated_at = CASE
          WHEN due_at IS NOT NULL AND due_at <= now() THEN COALESCE(escalated_at, now())
          ELSE escalated_at
        END,
        escalation_level = CASE
          WHEN due_at IS NOT NULL AND due_at <= now() THEN GREATEST(escalation_level, 1)
          ELSE escalation_level
        END,
        updated_at = now()
      WHERE tenant_id = $1
        AND recipient_user_id = $2
        AND state = 'snoozed'
        AND snoozed_until IS NOT NULL
        AND snoozed_until <= now()
      RETURNING id, channel, state::text
    `,
    [tenantId, userId]
  );

  for (const row of reopened.rows) {
    if (row.state === "escalated") {
      await recordEvent(client, {
        tenantId,
        notificationId: row.id,
        eventType: "escalated",
        channel: row.channel,
        metadata: { reason: "snooze_elapsed" }
      });
    }
  }

  const escalated = await client.query<{ id: string; channel: NotificationChannel }>(
    `
      UPDATE ops_notification
      SET
        state = 'escalated',
        escalated_at = COALESCE(escalated_at, now()),
        escalation_level = GREATEST(escalation_level, 1),
        updated_at = now()
      WHERE tenant_id = $1
        AND recipient_user_id = $2
        AND state IN ('new', 'seen', 'acknowledged')
        AND due_at IS NOT NULL
        AND due_at <= now()
        AND resolved_at IS NULL
        AND expired_at IS NULL
      RETURNING id, channel
    `,
    [tenantId, userId]
  );

  for (const row of escalated.rows) {
    await recordEvent(client, {
      tenantId,
      notificationId: row.id,
      eventType: "escalated",
      channel: row.channel,
      metadata: { reason: "due_at_elapsed" }
    });
  }
}

async function fetchNotificationRows(client: PoolClient, tenantId: string, userId: string, limit: number) {
  const { rows } = await client.query<NotificationRow>(
    `
      SELECT *
      FROM ops_notification
      WHERE tenant_id = $1
        AND recipient_user_id = $2
      ORDER BY created_at DESC, updated_at DESC
      LIMIT $3
    `,
    [tenantId, userId, limit]
  );
  return rows;
}

async function loadNotificationRecords(client: PoolClient, auth: AuthUser, options: ListNotificationOptions = {}) {
  const rows = await fetchNotificationRows(client, auth.tenantId, auth.id, Math.max(options.limit ?? 50, 200));
  const records = groupNotificationRows(rows).map(toNotificationRecord).filter((record) => matchesNotificationFilters(record, options)).sort(sortNotifications);
  return records.slice(0, options.limit ?? 50);
}

async function getNotificationRecordById(client: PoolClient, tenantId: string, userId: string, notificationId: string) {
  const lookup = await client.query<{ group_key: string }>(
    `
      SELECT group_key
      FROM ops_notification
      WHERE tenant_id = $1
        AND recipient_user_id = $2
        AND id = $3
      LIMIT 1
    `,
    [tenantId, userId, notificationId]
  );
  const groupKey = lookup.rows[0]?.group_key;
  if (!groupKey) {
    throw new ApiError(404, "Notification not found");
  }

  const rows = await client.query<NotificationRow>(
    `
      SELECT *
      FROM ops_notification
      WHERE tenant_id = $1
        AND recipient_user_id = $2
        AND group_key = $3
      ORDER BY created_at DESC, updated_at DESC
    `,
    [tenantId, userId, groupKey]
  );

  const grouped = groupNotificationRows(rows.rows)[0];
  if (!grouped) {
    throw new ApiError(404, "Notification not found");
  }
  return toNotificationRecord(grouped);
}

async function updateNotificationGroupState(
  client: PoolClient,
  auth: AuthUser,
  notificationId: string,
  options: {
    state: NotificationCenterState;
    eventType: NotificationEventType;
    minutes?: number;
    actorUserId?: string | null;
  }
) {
  const record = await getNotificationRecordById(client, auth.tenantId, auth.id, notificationId);

  if (options.state === "acknowledged" && !record.action_required && !record.requires_acknowledgement) {
    throw new ApiError(409, "This notification does not need acknowledgement.");
  }

  if (options.state === "snoozed" && !record.allow_snooze) {
    throw new ApiError(409, "This notification cannot be snoozed.");
  }

  if (isResolvedState(record.status)) {
    throw new ApiError(409, "This notification is already closed.");
  }

  const minutes =
    options.state === "snoozed"
      ? Math.max(
          5,
          Math.min(
            typeof options.minutes === "number" && Number.isFinite(options.minutes) ? Math.round(options.minutes) : 30,
            record.severity === "critical" ? 30 : 240
          )
        )
      : null;

  const result = await client.query<{ id: string; channel: NotificationChannel }>(
    `
      UPDATE ops_notification
      SET
        state = $4::notification_center_state,
        seen_at = COALESCE(seen_at, now()),
        acknowledged_at = CASE WHEN $4 = 'acknowledged' THEN COALESCE(acknowledged_at, now()) ELSE acknowledged_at END,
        snoozed_until = CASE WHEN $4 = 'snoozed' THEN now() + ($5::text || ' minutes')::interval ELSE NULL END,
        resolved_at = CASE WHEN $4 = 'resolved' THEN COALESCE(resolved_at, now()) ELSE resolved_at END,
        updated_at = now()
      WHERE tenant_id = $1
        AND recipient_user_id = $2
        AND group_key = $3
      RETURNING id, channel
    `,
    [auth.tenantId, auth.id, record.group_key, options.state, minutes]
  );

  for (const row of result.rows) {
    await recordEvent(client, {
      tenantId: auth.tenantId,
      notificationId: row.id,
      actorUserId: options.actorUserId ?? auth.id,
      eventType: options.eventType,
      channel: row.channel,
      metadata: minutes ? { minutes } : {}
    });
  }

  return getNotificationRecordById(client, auth.tenantId, auth.id, notificationId);
}

export async function findNotificationRecipients(client: PoolClient, options: RecipientLookupOptions) {
  const shift = await getShiftContext(client, options.shiftId);
  const recipients = new Set<string>(options.directUserIds ?? []);
  for (const userId of await getRoleRecipients(client, options.tenantId, options.eventCode, shift?.department ?? null)) recipients.add(userId);
  if (shift?.manager_user_id) recipients.add(String(shift.manager_user_id));

  const shootId = options.shootId ?? shift?.shoot_id ?? null;
  if (shootId) {
    const seniorRows = await client.query(
      `
        SELECT DISTINCT ws.assigned_user_id AS id
        FROM work_shift ws
        JOIN app_user au ON au.id = ws.assigned_user_id
        WHERE ws.tenant_id = $1
          AND ws.shoot_id = $2
          AND ws.status = 'published'
          AND ws.cancelled_at IS NULL
          AND au.status = 'active'
      `,
      [options.tenantId, shootId]
    );
    for (const row of seniorRows.rows) {
      if (await hasPublishedSeniorScopeOnShoot(client, options.tenantId, shootId, String(row.id))) recipients.add(String(row.id));
    }
  }

  const rule = ruleFor(options.eventCode);
  const importance = String(shift?.priority_label ?? "").trim().toLowerCase();
  if (rule.escalateOnHighImportance && (importance === "big_shoot" || importance === "critical_shoot")) {
    for (const userId of await getLeadershipRecipients(client, options.tenantId)) recipients.add(userId);
  }

  for (const userId of options.excludeUserIds ?? []) recipients.delete(userId);
  return [...recipients];
}

export async function queueNotificationDispatch(client: PoolClient, input: QueueNotificationInput) {
  const queued: QueuedNotificationDispatch[] = [];
  for (const recipientUserId of input.recipientUserIds) {
    const rule = ruleFor(input.notificationType);
    const severity = input.severity ?? priorityToSeverity(input.priority) ?? rule.severity;
    const dueAt =
      input.dueAt ??
      (rule.dueMinutes && ((input.actionRequired ?? rule.actionRequired) || (input.requiresAcknowledgement ?? rule.requiresAcknowledgement))
        ? new Date(Date.now() + rule.dueMinutes * 60 * 1000).toISOString()
        : null);
    const routing = normalizeChannels(input.channels, severity, Boolean(rule.quietHoursDeferred));
    const metadata = { ...(input.metadata ?? {}), quiet_hours_deferred: routing.quietHoursDeferred, severity };
    const groupKey = buildGroupKey({
      notificationType: input.notificationType,
      shiftId: input.shiftId ?? null,
      shootId: input.shootId ?? null,
      attendanceExceptionId: input.attendanceExceptionId ?? null,
      metadata,
      groupKey: input.groupKey ?? null
    });

    const appEvent = await createAppEvent(client, {
      tenantId: input.tenantId,
      eventType: "notification.dispatch",
      aggregateType: "ops_notification",
      dedupeKey: input.appEventDedupeKey ? `${input.appEventDedupeKey}:${recipientUserId}` : `notify:${recipientUserId}:${groupKey}`,
      payload: {
        tenant_id: input.tenantId,
        actor_user_id: input.actorUserId ?? null,
        recipient_user_id: recipientUserId,
        related_user_id: input.relatedUserId ?? null,
        shift_id: input.shiftId ?? null,
        shoot_id: input.shootId ?? null,
        attendance_exception_id: input.attendanceExceptionId ?? null,
        notification_type: input.notificationType,
        priority: input.priority ?? severityToPriority(severity),
        category: input.category ?? rule.category,
        severity,
        title: input.title,
        body: input.body,
        deep_link: input.deepLink ?? null,
        channels: routing.channels,
        action_required: input.actionRequired ?? rule.actionRequired,
        action_owner_user_id: input.actionOwnerUserId ?? ((input.actionRequired ?? rule.actionRequired) ? recipientUserId : null),
        due_at: dueAt,
        source_event: input.sourceEvent ?? input.notificationType,
        state: "new",
        requires_acknowledgement: input.requiresAcknowledgement ?? Boolean(rule.requiresAcknowledgement),
        allow_snooze: input.allowSnooze ?? Boolean(rule.allowSnooze),
        group_key: groupKey,
        digest_eligible: input.digestEligible ?? Boolean(rule.digestEligible),
        quiet_hours_deferred: routing.quietHoursDeferred,
        metadata
      }
    });
    queued.push({
      recipientUserId,
      appEventId: String(appEvent.id),
      groupKey,
      channels: routing.channels
    });
  }
  return queued;
}

export async function listNotifications(client: PoolClient, auth: AuthUser, options: ListNotificationOptions = {}) {
  return loadNotificationRecords(client, auth, {
    limit: options.limit ?? 25,
    includeResolved: options.includeResolved ?? false,
    states: options.states,
    categories: options.categories,
    view: options.view,
    actionableOnly: options.actionableOnly
  });
}

export async function getNotificationCenter(client: PoolClient, auth: AuthUser, options: Pick<ListNotificationOptions, "limit"> & { view?: NotificationCenterViewId } = {}) {
  const allRecords = await loadNotificationRecords(client, auth, {
    includeResolved: true,
    limit: Math.max(options.limit ?? 50, 250)
  });

  const view = options.view ?? "all";
  const items = allRecords.filter((record) => matchesNotificationFilters(record, { includeResolved: view === "resolved_recent", view })).sort(sortNotifications).slice(0, options.limit ?? 50);

  const activeRecords = allRecords.filter((record) => ACTIVE_STATES.has(record.status));
  const resolvedRecent = allRecords.filter((record) => matchesNotificationFilters(record, { includeResolved: true, view: "resolved_recent" }));

  return {
    generated_at: new Date().toISOString(),
    view,
    summary: {
      active_count: activeRecords.length,
      new_count: activeRecords.filter((record) => record.status === "new").length,
      action_required_count: activeRecords.filter((record) => record.action_required).length,
      critical_count: activeRecords.filter((record) => record.severity === "critical").length,
      escalated_count: activeRecords.filter((record) => record.status === "escalated").length,
      resolved_recent_count: resolvedRecent.length
    },
    saved_views: (Object.keys(VIEW_LABELS) as NotificationCenterViewId[]).map((viewId) => ({
      id: viewId,
      label: VIEW_LABELS[viewId],
      count: allRecords.filter((record) => matchesNotificationFilters(record, { includeResolved: viewId === "resolved_recent", view: viewId })).length
    })),
    items
  } satisfies NotificationCenterResponse;
}

export async function markNotificationsSeen(client: PoolClient, auth: AuthUser, notificationIds?: string[]) {
  let groupKeys: string[] = [];
  if (notificationIds?.length) {
    const { rows } = await client.query<{ group_key: string }>(
      `
        SELECT DISTINCT group_key
        FROM ops_notification
        WHERE tenant_id = $1
          AND recipient_user_id = $2
          AND id = ANY($3::uuid[])
      `,
      [auth.tenantId, auth.id, notificationIds]
    );
    groupKeys = rows.map((row) => row.group_key);
  }

  const query = groupKeys.length
    ? `
        UPDATE ops_notification
        SET
          seen_at = COALESCE(seen_at, now()),
          state = CASE WHEN state = 'new' THEN 'seen'::notification_center_state ELSE state END,
          updated_at = now()
        WHERE tenant_id = $1
          AND recipient_user_id = $2
          AND group_key = ANY($3::text[])
          AND state IN ('new', 'escalated')
        RETURNING id, channel
      `
    : `
        UPDATE ops_notification
        SET
          seen_at = COALESCE(seen_at, now()),
          state = CASE WHEN state = 'new' THEN 'seen'::notification_center_state ELSE state END,
          updated_at = now()
        WHERE tenant_id = $1
          AND recipient_user_id = $2
          AND state IN ('new', 'escalated')
        RETURNING id, channel
      `;

  const result = groupKeys.length
    ? await client.query<{ id: string; channel: NotificationChannel }>(query, [auth.tenantId, auth.id, groupKeys])
    : await client.query<{ id: string; channel: NotificationChannel }>(query, [auth.tenantId, auth.id]);

  for (const row of result.rows) {
    await recordEvent(client, {
      tenantId: auth.tenantId,
      notificationId: row.id,
      actorUserId: auth.id,
      eventType: "seen",
      channel: row.channel
    });
  }

  return { updated: result.rowCount ?? 0 };
}

export async function acknowledgeNotification(client: PoolClient, auth: AuthUser, notificationId: string) {
  return updateNotificationGroupState(client, auth, notificationId, {
    state: "acknowledged",
    eventType: "acknowledged"
  });
}

export async function snoozeNotification(client: PoolClient, auth: AuthUser, notificationId: string, minutes?: number) {
  return updateNotificationGroupState(client, auth, notificationId, {
    state: "snoozed",
    eventType: "snoozed",
    minutes
  });
}

export async function resolveNotification(client: PoolClient, auth: AuthUser, notificationId: string) {
  return updateNotificationGroupState(client, auth, notificationId, {
    state: "resolved",
    eventType: "resolved"
  });
}

export function canReadNotificationInbox(auth: AuthUser) {
  return auth.permissions.includes("notification.read") || auth.permissions.includes("alerts.read");
}

export function ensureNotificationInboxAccess(auth: AuthUser) {
  if (!canReadNotificationInbox(auth)) {
    throw new ApiError(403, "Notification inbox access is not allowed for this user.");
  }
}
