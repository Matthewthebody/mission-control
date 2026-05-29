import type { AuthUser } from "../types/auth.js";
import type { TeamsCommunicationLinkedObjectType } from "../types/teamsMessaging.js";
import type { TeamsMeetingLinkedObjectType } from "../types/teamsMeetings.js";
import type { PolicyResourceContext } from "./policy/policyEngine.js";
import { canSharedPolicy } from "./policy/policyEngine.js";

export type CommunicationGovernanceModule = "jobs" | "staffing" | "tasks" | "production" | "directory";
export type CommunicationGovernanceObjectType = TeamsCommunicationLinkedObjectType | TeamsMeetingLinkedObjectType;

export type CommunicationGovernanceContext = {
  objectType: CommunicationGovernanceObjectType;
  objectId: string;
  objectLabel: string;
  module?: CommunicationGovernanceModule;
  policyContext: PolicyResourceContext;
};

export type CommunicationGovernancePermissions = {
  can_use: boolean;
  can_send: boolean;
  can_configure: boolean;
  can_manage_meetings: boolean;
  can_create_meetings: boolean;
  can_view_history: boolean;
  can_send_proactive: boolean;
  can_message_chats: boolean;
  can_message_channels: boolean;
  can_message_assigned_staff: boolean;
};

export type CommunicationGovernanceDecision = {
  module: CommunicationGovernanceModule;
  identity_ready: boolean;
  permissions: CommunicationGovernancePermissions;
};

const COMMUNICATION_SURFACE_PERMISSION_KEYS = [
  "communication.use",
  "communication.send",
  "communication.meeting.manage",
  "communication.configure",
  "communication.history.read",
  "communication.proactive.send",
  "system.configure"
] as const;

type PermissionOptions = {
  requireIdentityReady?: boolean;
  allowSystemConfigure?: boolean;
};

function normalizeUserIds(values: Array<string | null | undefined> | undefined) {
  return (values ?? []).filter((value): value is string => Boolean(value));
}

function isCommunicationIdentityReady(auth: Pick<AuthUser, "communicationIdentity">) {
  return auth.communicationIdentity?.status === "linked_ready";
}

function hasCommunicationPermission(
  auth: Pick<AuthUser, "permissions" | "policyGrants" | "communicationIdentity">,
  permissionKey: string,
  context: PolicyResourceContext = {},
  options: PermissionOptions = {}
) {
  if (options.requireIdentityReady && !isCommunicationIdentityReady(auth)) {
    return false;
  }

  if (auth.permissions.includes(permissionKey)) {
    return true;
  }
  if (canSharedPolicy(auth as AuthUser, permissionKey, context)) {
    return true;
  }

  if (!options.allowSystemConfigure) {
    return false;
  }

  return auth.permissions.includes("system.configure") || canSharedPolicy(auth as AuthUser, "system.configure", context);
}

export function getCommunicationGovernanceModule(objectType: CommunicationGovernanceObjectType): CommunicationGovernanceModule {
  switch (objectType) {
    case "job":
      return "jobs";
    case "task":
      return "tasks";
    case "production_item":
      return "production";
    case "organization":
    case "location":
      return "directory";
    default:
      return "jobs";
  }
}

export function canAccessCommunicationSurface(auth: Pick<AuthUser, "permissions" | "policyGrants">) {
  return (
    COMMUNICATION_SURFACE_PERMISSION_KEYS.some((permissionKey) => auth.permissions.includes(permissionKey)) ||
    (auth.policyGrants ?? []).some((grant) => COMMUNICATION_SURFACE_PERMISSION_KEYS.includes(grant.permissionKey as (typeof COMMUNICATION_SURFACE_PERMISSION_KEYS)[number]))
  );
}

export function canUseCommunicationActions(
  auth: Pick<AuthUser, "permissions" | "policyGrants" | "communicationIdentity">,
  context: PolicyResourceContext = {}
) {
  return hasCommunicationPermission(auth, "communication.use", context, {
    requireIdentityReady: true
  });
}

export function canSendCommunicationMessages(
  auth: Pick<AuthUser, "permissions" | "policyGrants" | "communicationIdentity">,
  context: PolicyResourceContext = {}
) {
  return hasCommunicationPermission(auth, "communication.send", context, {
    requireIdentityReady: true
  });
}

export function canManageCommunicationMeetings(
  auth: Pick<AuthUser, "permissions" | "policyGrants" | "communicationIdentity">,
  context: PolicyResourceContext = {}
) {
  return hasCommunicationPermission(auth, "communication.meeting.manage", context, {
    requireIdentityReady: true,
    allowSystemConfigure: true
  });
}

export function canConfigureCommunicationDestinations(
  auth: Pick<AuthUser, "permissions" | "policyGrants">,
  context: PolicyResourceContext = {}
) {
  return hasCommunicationPermission(auth, "communication.configure", context, {
    allowSystemConfigure: true
  });
}

export function canViewCommunicationHistory(
  auth: Pick<AuthUser, "permissions" | "policyGrants">,
  context: PolicyResourceContext = {}
) {
  return hasCommunicationPermission(auth, "communication.history.read", context, {
    allowSystemConfigure: true
  });
}

export function canSendProactiveCommunications(
  auth: Pick<AuthUser, "permissions" | "policyGrants" | "communicationIdentity">,
  context: PolicyResourceContext = {}
) {
  return hasCommunicationPermission(auth, "communication.proactive.send", context, {
    requireIdentityReady: true,
    allowSystemConfigure: true
  });
}

export function evaluateCommunicationGovernance(
  auth: Pick<AuthUser, "permissions" | "policyGrants" | "communicationIdentity" | "id">,
  context: CommunicationGovernanceContext
): CommunicationGovernanceDecision {
  const module = context.module ?? getCommunicationGovernanceModule(context.objectType);
  const policyContext = context.policyContext ?? {};
  const canUse = canUseCommunicationActions(auth, policyContext);
  const canSend = canSendCommunicationMessages(auth, policyContext);
  const canManageMeetings = canManageCommunicationMeetings(auth, policyContext);
  const canConfigure = canConfigureCommunicationDestinations(auth, policyContext);
  const canViewHistory = canViewCommunicationHistory(auth, policyContext);
  const canSendProactive = canSendProactiveCommunications(auth, policyContext);
  const assignedUserIds = normalizeUserIds(policyContext.assignedUserIds);
  const hasOtherAssignedAudience = assignedUserIds.some((userId) => userId !== auth.id);

  return {
    module,
    identity_ready: isCommunicationIdentityReady(auth),
    permissions: {
      can_use: canUse,
      can_send: canSend,
      can_configure: canConfigure,
      can_manage_meetings: canManageMeetings,
      can_create_meetings: canManageMeetings,
      can_view_history: canViewHistory,
      can_send_proactive: canSendProactive,
      can_message_chats: canSend,
      can_message_channels: canSend,
      can_message_assigned_staff: canSend && hasOtherAssignedAudience
    }
  };
}
