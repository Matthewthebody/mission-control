import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser, CommunicationIdentity, CommunicationIdentityStatus } from "../types/auth.js";
import type { PolicyResourceContext } from "./policy/policyEngine.js";
import {
  canConfigureCommunicationDestinations as canConfigureCommunicationDestinationsByGovernance,
  canManageCommunicationMeetings as canManageCommunicationMeetingsByGovernance,
  canSendCommunicationMessages as canSendCommunicationMessagesByGovernance,
  canUseCommunicationActions as canUseCommunicationActionsByGovernance
} from "./communicationGovernance.js";

type CommunicationIdentitySource = {
  microsoftUserId?: string | null;
  microsoftTenantId?: string | null;
  communicationEnabled?: boolean | null;
  communicationPostingDisabledAt?: string | null;
  communicationPostingDisabledReason?: string | null;
  teamsChatDefaultTarget?: string | null;
  linkedAt?: string | null;
  lastVerifiedAt?: string | null;
  authProvider?: string | null;
};

type CommunicationIdentityRow = {
  user_id: string;
  tenant_id: string;
  email: string;
  full_name: string;
  membership_status: string;
  microsoft_user_id: string | null;
  microsoft_tenant_id: string | null;
  communication_enabled: boolean;
  communication_posting_disabled_at: string | null;
  communication_posting_disabled_reason: string | null;
  teams_chat_default_target: string | null;
  linked_at: string | null;
  last_verified_at: string | null;
  auth_provider: string | null;
};

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function deriveCommunicationIdentityStatus(input: CommunicationIdentitySource): CommunicationIdentityStatus {
  const microsoftUserId = normalizeText(input.microsoftUserId);
  const microsoftTenantId = normalizeText(input.microsoftTenantId);
  const authProvider = normalizeText(input.authProvider);
  const hasCompleteLink = Boolean(microsoftUserId && microsoftTenantId);
  const hasPartialLink = Boolean(microsoftUserId || microsoftTenantId || authProvider === "microsoft_entra" || input.linkedAt || input.lastVerifiedAt);

  if (hasCompleteLink) {
    return input.communicationEnabled ? "linked_ready" : "disabled";
  }
  if (hasPartialLink) {
    return "incomplete";
  }
  return "unlinked";
}

export function buildCommunicationIdentity(input: CommunicationIdentitySource): CommunicationIdentity {
  const postingDisabledAt = input.communicationPostingDisabledAt ?? null;
  const postingDisabledReason = normalizeText(input.communicationPostingDisabledReason);
  return {
    provider: "microsoft_teams",
    microsoftUserId: normalizeText(input.microsoftUserId),
    microsoftTenantId: normalizeText(input.microsoftTenantId),
    communicationEnabled: Boolean(input.communicationEnabled),
    postingDisabledAt,
    postingDisabledReason,
    canPost: Boolean(input.communicationEnabled) && !postingDisabledAt,
    teamsChatDefaultTarget: normalizeText(input.teamsChatDefaultTarget),
    linkedAt: input.linkedAt ?? null,
    lastVerifiedAt: input.lastVerifiedAt ?? null,
    status: deriveCommunicationIdentityStatus(input)
  };
}

export function isCommunicationIdentityReady(identity: Pick<CommunicationIdentity, "status"> | null | undefined) {
  return identity?.status === "linked_ready";
}

export function canUseCommunicationActions(
  auth: Pick<AuthUser, "permissions" | "policyGrants" | "communicationIdentity">,
  context: PolicyResourceContext = {}
) {
  return canUseCommunicationActionsByGovernance(auth, context);
}

export function canSendCommunicationMessages(
  auth: Pick<AuthUser, "permissions" | "policyGrants" | "communicationIdentity">,
  context: PolicyResourceContext = {}
) {
  return canSendCommunicationMessagesByGovernance(auth, context);
}

export function canManageCommunicationMeetings(
  auth: Pick<AuthUser, "permissions" | "policyGrants" | "communicationIdentity">,
  context: PolicyResourceContext = {}
) {
  return canManageCommunicationMeetingsByGovernance(auth, context);
}

export function canConfigureCommunicationDestinations(
  auth: Pick<AuthUser, "permissions" | "policyGrants">,
  context: PolicyResourceContext = {}
) {
  return canConfigureCommunicationDestinationsByGovernance(auth, context);
}

export async function loadCommunicationIdentityByUserId(client: PoolClient, tenantId: string, userId: string) {
  const { rows } = await client.query<CommunicationIdentityRow>(
    `
      SELECT
        u.id::text AS user_id,
        u.tenant_id::text AS tenant_id,
        u.email,
        u.full_name,
        u.status::text AS membership_status,
        account.microsoft_user_id,
        account.microsoft_tenant_id,
        COALESCE(account.communication_enabled, false) AS communication_enabled,
        account.communication_posting_disabled_at::text AS communication_posting_disabled_at,
        account.communication_posting_disabled_reason,
        account.teams_chat_default_target,
        account.linked_at::text AS linked_at,
        account.last_verified_at::text AS last_verified_at,
        account.auth_provider
      FROM app_user u
      LEFT JOIN user_account account ON account.id = u.account_id
      WHERE u.tenant_id = $1
        AND u.id = $2
      LIMIT 1
    `,
    [tenantId, userId]
  );

  const row = rows[0] ?? null;
  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    tenantId: row.tenant_id,
    email: row.email,
    fullName: row.full_name,
    membershipStatus: row.membership_status,
    communicationIdentity: buildCommunicationIdentity({
      microsoftUserId: row.microsoft_user_id,
      microsoftTenantId: row.microsoft_tenant_id,
      communicationEnabled: row.communication_enabled,
      communicationPostingDisabledAt: row.communication_posting_disabled_at,
      communicationPostingDisabledReason: row.communication_posting_disabled_reason,
      teamsChatDefaultTarget: row.teams_chat_default_target,
      linkedAt: row.linked_at,
      lastVerifiedAt: row.last_verified_at,
      authProvider: row.auth_provider
    })
  };
}

export async function assertCommunicationIdentityReady(
  client: PoolClient,
  tenantId: string,
  userId: string,
  options: { label?: string } = {}
) {
  const record = await loadCommunicationIdentityByUserId(client, tenantId, userId);
  if (!record) {
    throw new ApiError(404, `${options.label ?? "Employee"} record not found`);
  }
  if (record.membershipStatus !== "active") {
    throw new ApiError(409, `${options.label ?? "Employee"} is not active for internal communications.`);
  }
  if (!isCommunicationIdentityReady(record.communicationIdentity)) {
    throw new ApiError(409, `${options.label ?? "Employee"} is not fully linked for Teams communication yet.`);
  }
  return record;
}
