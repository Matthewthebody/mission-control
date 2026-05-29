import type { PoolClient } from "pg";
import { hasAuthorityTier } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";

export type ApprovalRoutingRequestKind = "pto_request" | "shift_trade_request";
export type ApprovalRoutingPolicyCode =
  | "department_supervisor_or_leadership"
  | "shift_manager_user"
  | "requester_shift_manager"
  | "shoot_lead_or_leadership"
  | "leadership_only";

type ApprovalRoutingPolicyRow = {
  id: string;
  tenant_id: string;
  request_kind: ApprovalRoutingRequestKind;
  policy_code: ApprovalRoutingPolicyCode;
  label: string;
  config: Record<string, unknown>;
  enabled: boolean;
};

type UserLevelContext = {
  id: string;
  full_name: string;
  department: string;
  authority_tier: string | null;
  primary_job_function_profile: string | null;
  level_rank: number;
  allow_shift_trade: boolean;
  status: string;
};

const TRADE_LEVEL_PROFILE_RANKS: Record<string, { level_rank: number; allow_shift_trade: boolean }> = {
  seasonal_photographer: { level_rank: 20, allow_shift_trade: true },
  part_time_photographer: { level_rank: 20, allow_shift_trade: true },
  associate_photographer: { level_rank: 30, allow_shift_trade: true },
  photographer: { level_rank: 40, allow_shift_trade: true },
  senior_photographer: { level_rank: 60, allow_shift_trade: true },
  lead_photographer: { level_rank: 70, allow_shift_trade: true },
  director_of_photography: { level_rank: 80, allow_shift_trade: true },
  director_of_school_photography: { level_rank: 80, allow_shift_trade: true },
  director_of_sports_photography: { level_rank: 80, allow_shift_trade: true }
};

const TRADE_LEVEL_AUTHORITY_RANKS: Record<string, { level_rank: number; allow_shift_trade: boolean }> = {
  standard_employee: { level_rank: 20, allow_shift_trade: true },
  supervisor: { level_rank: 60, allow_shift_trade: true },
  director_admin: { level_rank: 80, allow_shift_trade: true },
  leadership: { level_rank: 90, allow_shift_trade: true },
  super_admin: { level_rank: 100, allow_shift_trade: true }
};

export function resolveTradeLevelRank(
  levelRank: number | null | undefined,
  primaryJobFunctionProfile: string | null | undefined,
  authorityTier: string | null | undefined
) {
  if (typeof levelRank === "number" && Number.isFinite(levelRank) && levelRank > 0) {
    return levelRank;
  }
  const profileFallback = primaryJobFunctionProfile ? TRADE_LEVEL_PROFILE_RANKS[primaryJobFunctionProfile] : null;
  if (profileFallback) {
    return profileFallback.level_rank;
  }
  const authorityFallback = authorityTier ? TRADE_LEVEL_AUTHORITY_RANKS[authorityTier] : null;
  if (authorityFallback) {
    return authorityFallback.level_rank;
  }
  return 0;
}

export function resolveTradeAllowShiftTrade(
  allowShiftTrade: boolean | null | undefined,
  primaryJobFunctionProfile: string | null | undefined,
  authorityTier: string | null | undefined
) {
  if (typeof allowShiftTrade === "boolean") {
    return allowShiftTrade;
  }
  const profileFallback = primaryJobFunctionProfile ? TRADE_LEVEL_PROFILE_RANKS[primaryJobFunctionProfile] : null;
  if (profileFallback) {
    return profileFallback.allow_shift_trade;
  }
  const authorityFallback = authorityTier ? TRADE_LEVEL_AUTHORITY_RANKS[authorityTier] : null;
  if (authorityFallback) {
    return authorityFallback.allow_shift_trade;
  }
  return true;
}

export type TradeAcceptanceConflict = {
  code: "shift_overlap" | "schedule_event_overlap" | "shoot_assignment_overlap" | "approved_pto";
  summary: string;
  relatedType: "work_shift" | "schedule_event" | "shoot" | "pto_request";
  relatedId: string;
};

export function listAvailableApprovalRoutingModels(kind: ApprovalRoutingRequestKind) {
  if (kind === "pto_request") {
    return [
      { code: "department_supervisor_or_leadership", label: "Department supervisors or leadership" },
      { code: "leadership_only", label: "Leadership only" }
    ] as const;
  }
  return [
    { code: "shift_manager_user", label: "Shift manager user" },
    { code: "requester_shift_manager", label: "Requester's shift manager" },
    { code: "shoot_lead_or_leadership", label: "Shoot lead or leadership fallback" },
    { code: "department_supervisor_or_leadership", label: "Department supervisors or leadership" },
    { code: "leadership_only", label: "Leadership only" }
  ] as const;
}

export async function getApprovalRoutingPolicy(
  client: PoolClient,
  tenantId: string,
  requestKind: ApprovalRoutingRequestKind
): Promise<ApprovalRoutingPolicyRow> {
  const { rows } = await client.query<ApprovalRoutingPolicyRow>(
    `
      SELECT id, tenant_id, request_kind, policy_code, label, config, enabled
      FROM approval_routing_policy
      WHERE tenant_id = $1
        AND request_kind = $2
        AND enabled = true
      LIMIT 1
    `,
    [tenantId, requestKind]
  );

  if (rows[0]) {
    return rows[0];
  }

  return {
    id: "",
    tenant_id: tenantId,
    request_kind: requestKind,
    policy_code: requestKind === "pto_request" ? "department_supervisor_or_leadership" : "shift_manager_user",
    label: requestKind === "pto_request" ? "Department supervisors or leadership" : "Shift manager user",
    config: {},
    enabled: true
  };
}

async function loadUserLevelContext(client: PoolClient, tenantId: string, userId: string) {
  const { rows } = await client.query<
    Omit<UserLevelContext, "level_rank" | "allow_shift_trade"> & {
      level_rank: number | null;
      allow_shift_trade: boolean | null;
    }
  >(
    `
      SELECT
        au.id,
        au.full_name,
        au.department::text,
        uaa.authority_tier::text AS authority_tier,
        uaa.primary_job_function_profile::text AS primary_job_function_profile,
        MAX(rlr.level_rank)::integer AS level_rank,
        BOOL_OR(rlr.allow_shift_trade) AS allow_shift_trade,
        au.status::text AS status
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
      WHERE au.tenant_id = $1
        AND au.id = $2
      GROUP BY au.id, au.full_name, au.department, uaa.authority_tier, uaa.primary_job_function_profile, au.status
      LIMIT 1
    `,
    [tenantId, userId]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    ...row,
    level_rank: resolveTradeLevelRank(row.level_rank, row.primary_job_function_profile, row.authority_tier),
    allow_shift_trade: resolveTradeAllowShiftTrade(row.allow_shift_trade, row.primary_job_function_profile, row.authority_tier)
  };
}

async function listLeadershipFallbackUsers(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT au.id
      FROM app_user au
      JOIN user_authority_assignment uaa
        ON uaa.tenant_id = au.tenant_id
       AND uaa.user_id = au.id
      WHERE au.tenant_id = $1
        AND au.status = 'active'
        AND uaa.authority_tier IN ('super_admin', 'leadership', 'director_admin')
      ORDER BY CASE uaa.authority_tier
        WHEN 'super_admin' THEN 1
        WHEN 'leadership' THEN 2
        WHEN 'director_admin' THEN 3
        ELSE 99
      END, au.full_name ASC
    `,
    [tenantId]
  );
  return rows.map((row) => row.id);
}

async function listDepartmentSupervisors(client: PoolClient, tenantId: string, department: string) {
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT au.id
      FROM app_user au
      JOIN user_authority_assignment uaa
        ON uaa.tenant_id = au.tenant_id
       AND uaa.user_id = au.id
      WHERE au.tenant_id = $1
        AND au.status = 'active'
        AND au.department::text = $2
        AND uaa.authority_tier IN ('supervisor', 'director_admin', 'leadership', 'super_admin')
      ORDER BY CASE uaa.authority_tier
        WHEN 'supervisor' THEN 1
        WHEN 'director_admin' THEN 2
        WHEN 'leadership' THEN 3
        WHEN 'super_admin' THEN 4
        ELSE 99
      END, au.full_name ASC
    `,
    [tenantId, department]
  );
  return rows.map((row) => row.id);
}

async function listShootLeadUsers(client: PoolClient, tenantId: string, shootId: string | null | undefined) {
  if (!shootId) {
    return [];
  }
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT DISTINCT ws.assigned_user_id AS id
      FROM work_shift ws
      WHERE ws.tenant_id = $1
        AND ws.shoot_id = $2
        AND ws.cancelled_at IS NULL
        AND ws.status IN ('draft', 'published', 'completed')
        AND ws.satisfies_lead_coverage = true
      ORDER BY ws.assigned_user_id
    `,
    [tenantId, shootId]
  );
  return rows.map((row) => row.id);
}

function uniqueUserIds(ids: Array<string | null | undefined>) {
  return [...new Set(ids.filter((value): value is string => Boolean(value)))];
}

export async function assertTradeRoleLevelEligible(
  client: PoolClient,
  tenantId: string,
  requesterUserId: string,
  recipientUserId: string
) {
  const [requester, recipient] = await Promise.all([
    loadUserLevelContext(client, tenantId, requesterUserId),
    loadUserLevelContext(client, tenantId, recipientUserId)
  ]);

  if (!requester || !recipient) {
    throw new ApiError(404, "Trade participant could not be resolved");
  }
  if (recipient.status !== "active") {
    throw new ApiError(409, "The proposed replacement is not active");
  }
  if (!recipient.allow_shift_trade) {
    throw new ApiError(409, "The proposed replacement is not eligible for shift trades");
  }
  if (recipient.level_rank < requester.level_rank) {
    throw new ApiError(409, "Shift trades require the proposed replacement to be at the same level or higher");
  }

  return {
    requester,
    recipient
  };
}

export async function findTradeAcceptanceConflict(
  client: PoolClient,
  input: {
    tenantId: string;
    shiftId: string;
    shootId?: string | null;
    userId: string;
    startsAt: string;
    endsAt: string;
  }
): Promise<TradeAcceptanceConflict | null> {
  const shiftOverlap = await client.query<{ id: string; title: string }>(
    `
      SELECT ws.id, ws.title
      FROM work_shift ws
      WHERE ws.tenant_id = $1
        AND ws.assigned_user_id = $2
        AND ws.id <> $3
        AND ws.cancelled_at IS NULL
        AND ws.status IN ('draft', 'published', 'completed')
        AND tstzrange(ws.starts_at, ws.ends_at, '[)') && tstzrange($4::timestamptz, $5::timestamptz, '[)')
      LIMIT 1
    `,
    [input.tenantId, input.userId, input.shiftId, input.startsAt, input.endsAt]
  );
  if (shiftOverlap.rows[0]) {
    return {
      code: "shift_overlap",
      summary: `Recipient already has ${shiftOverlap.rows[0].title} scheduled during that time.`,
      relatedType: "work_shift",
      relatedId: shiftOverlap.rows[0].id
    };
  }

  const scheduleEventOverlap = await client.query<{ id: string; title: string }>(
    `
      SELECT se.id, se.title
      FROM schedule_event se
      WHERE se.tenant_id = $1
        AND se.lead_user_id = $2
        AND se.deleted_at IS NULL
        AND se.status IN ('scheduled', 'tentative', 'completed')
        AND tstzrange(se.starts_at, se.ends_at, '[)') && tstzrange($3::timestamptz, $4::timestamptz, '[)')
      LIMIT 1
    `,
    [input.tenantId, input.userId, input.startsAt, input.endsAt]
  );
  if (scheduleEventOverlap.rows[0]) {
    return {
      code: "schedule_event_overlap",
      summary: `Recipient is already committed to ${scheduleEventOverlap.rows[0].title} during that time.`,
      relatedType: "schedule_event",
      relatedId: scheduleEventOverlap.rows[0].id
    };
  }

  const shootAssignmentOverlap = await client.query<{ id: string; title: string }>(
    `
      SELECT s.id, s.title
      FROM shoot_assignment sa
      JOIN shoot s
        ON s.id = sa.shoot_id
       AND s.tenant_id = sa.tenant_id
      WHERE sa.tenant_id = $1
        AND sa.user_id = $2
        AND sa.shoot_id <> COALESCE($3::uuid, sa.shoot_id)
        AND s.deleted_at IS NULL
        AND s.start_time IS NOT NULL
        AND s.end_time_est IS NOT NULL
        AND tstzrange(s.start_time, s.end_time_est, '[)') && tstzrange($4::timestamptz, $5::timestamptz, '[)')
      LIMIT 1
    `,
    [input.tenantId, input.userId, input.shootId ?? null, input.startsAt, input.endsAt]
  );
  if (shootAssignmentOverlap.rows[0]) {
    return {
      code: "shoot_assignment_overlap",
      summary: `Recipient is already assigned to shoot coverage for ${shootAssignmentOverlap.rows[0].title}.`,
      relatedType: "shoot",
      relatedId: shootAssignmentOverlap.rows[0].id
    };
  }

  const ptoOverlap = await client.query<{ id: string }>(
    `
      SELECT pto.id
      FROM pto_request pto
      WHERE pto.tenant_id = $1
        AND pto.user_id = $2
        AND pto.status = 'approved'
        AND pto.requested_on = $3::date
      LIMIT 1
    `,
    [input.tenantId, input.userId, new Date(input.startsAt).toISOString().slice(0, 10)]
  );
  if (ptoOverlap.rows[0]) {
    return {
      code: "approved_pto",
      summary: "Recipient already has approved PTO on that date.",
      relatedType: "pto_request",
      relatedId: ptoOverlap.rows[0].id
    };
  }

  return null;
}

export async function resolveTradeApproverUserIds(
  client: PoolClient,
  input: {
    tenantId: string;
    department: string;
    shiftManagerUserId?: string | null;
    shootId?: string | null;
  }
) {
  const policy = await getApprovalRoutingPolicy(client, input.tenantId, "shift_trade_request");

  let approverIds: string[] = [];
  switch (policy.policy_code) {
    case "shift_manager_user":
    case "requester_shift_manager":
      approverIds = uniqueUserIds([input.shiftManagerUserId]);
      break;
    case "shoot_lead_or_leadership":
      approverIds = await listShootLeadUsers(client, input.tenantId, input.shootId ?? null);
      break;
    case "department_supervisor_or_leadership":
      approverIds = await listDepartmentSupervisors(client, input.tenantId, input.department);
      break;
    case "leadership_only":
      approverIds = await listLeadershipFallbackUsers(client, input.tenantId);
      break;
    default:
      approverIds = uniqueUserIds([input.shiftManagerUserId]);
      break;
  }

  if (!approverIds.length || policy.policy_code === "shoot_lead_or_leadership" || policy.policy_code === "shift_manager_user") {
    approverIds = uniqueUserIds([...approverIds, ...(await listLeadershipFallbackUsers(client, input.tenantId))]);
  }

  return {
    policy,
    approverUserIds: approverIds,
    primaryApproverUserId: approverIds[0] ?? null
  };
}

export async function resolvePTOApproverUserIds(
  client: PoolClient,
  input: {
    tenantId: string;
    department: string;
    forceLeadershipOnly?: boolean;
  }
) {
  const policy = input.forceLeadershipOnly
    ? {
        id: "",
        tenant_id: input.tenantId,
        request_kind: "pto_request" as const,
        policy_code: "leadership_only" as const,
        label: "Leadership only",
        config: {},
        enabled: true
      }
    : await getApprovalRoutingPolicy(client, input.tenantId, "pto_request");

  let approverIds: string[] = [];
  switch (policy.policy_code) {
    case "department_supervisor_or_leadership":
      approverIds = await listDepartmentSupervisors(client, input.tenantId, input.department);
      break;
    case "leadership_only":
      approverIds = await listLeadershipFallbackUsers(client, input.tenantId);
      break;
    default:
      approverIds = await listDepartmentSupervisors(client, input.tenantId, input.department);
      break;
  }

  if (!approverIds.length) {
    approverIds = await listLeadershipFallbackUsers(client, input.tenantId);
  }

  return {
    policy,
    approverUserIds: approverIds,
    primaryApproverUserId: approverIds[0] ?? null
  };
}

export async function canUserApproveTradeRequest(
  client: PoolClient,
  auth: AuthUser,
  input: {
    requesterUserId: string;
    requestedWithUserId?: string | null;
    department: string;
    shiftManagerUserId?: string | null;
    shootId?: string | null;
  }
) {
  if (auth.id === input.requesterUserId || auth.id === (input.requestedWithUserId ?? null)) {
    return false;
  }
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    return true;
  }
  const resolution = await resolveTradeApproverUserIds(client, {
    tenantId: auth.tenantId,
    department: input.department,
    shiftManagerUserId: input.shiftManagerUserId ?? null,
    shootId: input.shootId ?? null
  });
  return resolution.approverUserIds.includes(auth.id);
}

export async function canUserApprovePTORequest(
  client: PoolClient,
  auth: AuthUser,
  input: {
    requesterUserId: string;
    department: string;
  }
) {
  if (auth.id === input.requesterUserId) {
    return false;
  }
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    return true;
  }
  const resolution = await resolvePTOApproverUserIds(client, {
    tenantId: auth.tenantId,
    department: input.department
  });
  return resolution.approverUserIds.includes(auth.id);
}
