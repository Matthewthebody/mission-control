import { z } from "zod";
import type { PoolClient } from "pg";
import { resolveRuntimeAdminSettingValue } from "./adminSettings.js";
import type { AppBaseRole, AuthorityTier, CapabilityOverlay, InternalRoleGroup, SessionAssuranceLevel } from "../types/auth.js";

const sessionAssuranceSchema = z.enum(["standard", "mfa", "phishing_resistant"]);
const authorityTierSchema = z.enum([
  "super_admin",
  "leadership",
  "director_admin",
  "supervisor",
  "standard_employee",
  "read_only_viewer"
]);
const internalRoleGroupSchema = z.enum([
  "system_admin",
  "leadership",
  "schools",
  "sports",
  "account_reps",
  "senior_photographers",
  "seasonal_photographers",
  "graphics_production",
  "customer_service"
]);
const appBaseRoleSchema = z.enum([
  "Admin",
  "Leadership",
  "Manager",
  "OfficeStaff",
  "SeniorPhotographer",
  "AssociatePhotographer"
]);
const capabilityOverlaySchema = z.enum(["Finance", "CommunicationsModerator", "UserAccessAdmin", "SecurityAdmin"]);

const stepUpRuleSchema = z
  .object({
    auth_context_id: z.string().trim().min(1).nullable().default(null),
    required_assurance: sessionAssuranceSchema.default("mfa"),
    reauth_window_minutes: z.number().int().min(1).max(24 * 60).default(10),
    elevated_window_minutes: z.number().int().min(1).max(24 * 60).default(10),
    privileged_window_minutes: z.number().int().min(1).max(24 * 60).default(15),
    allow_break_glass: z.boolean().default(false),
    prompt: z.enum(["login", "select_account"]).default("login")
  })
  .strict();

const sensitiveActionContractSchema = z
  .object({
    default_action_key: z.string().trim().min(1).default("session.elevate"),
    actions: z.record(z.string().trim().min(1), stepUpRuleSchema).default({})
  })
  .strict();

const authorizationMappingSchema = z
  .object({
    authority_tier: authorityTierSchema.nullable().optional(),
    base_role: appBaseRoleSchema.nullable().optional(),
    capability_overlays: z.array(capabilityOverlaySchema).default([]),
    internal_role_groups: z.array(internalRoleGroupSchema).default([]),
    policy_roles: z.array(z.string().trim().min(1)).default([]),
    permission_keys: z.array(z.string().trim().min(1)).default([]),
    privileged: z.boolean().default(false)
  })
  .strict();

const authorizationGroupMappingSchema = authorizationMappingSchema.extend({
  group_id: z.string().trim().min(1)
});

const authorizationContractSchema = z
  .object({
    contract_version: z.string().trim().min(1).default("1"),
    require_assignment_for_sign_in: z.boolean().default(false),
    fail_closed_for_privileged: z.boolean().default(true),
    app_role_mappings: z.record(z.string().trim().min(1), authorizationMappingSchema).default({}),
    group_mappings: z.array(authorizationGroupMappingSchema).default([])
  })
  .strict();

const claimsSnapshotSchema = z
  .object({
    tenant_id: z.string().trim().min(1),
    user_id: z.string().trim().min(1),
    email: z.string().trim().min(1),
    scopes: z.array(z.string().trim().min(1)).default([]),
    app_role_values: z.array(z.string().trim().min(1)).default([]),
    group_ids: z.array(z.string().trim().min(1)).default([]),
    group_claims_overage: z.boolean().default(false),
    auth_context_ids: z.array(z.string().trim().min(1)).default([]),
    amr: z.array(z.string().trim().min(1)).default([]),
    acr: z.string().trim().min(1).nullable().default(null),
    session_assurance: sessionAssuranceSchema.default("standard"),
    raw_claims: z.record(z.string(), z.unknown()).default({})
  })
  .strict();

const authorizationIssueSchema = z
  .object({
    code: z.string().trim().min(1),
    severity: z.enum(["warning", "error"]),
    message: z.string().trim().min(1)
  })
  .strict();

const authorizationStateSchema = z
  .object({
    provider: z.literal("microsoft_entra"),
    source_contract_version: z.string().trim().min(1),
    raw: claimsSnapshotSchema,
    resolved: z
      .object({
        authority_tier: authorityTierSchema.nullable(),
        base_role: appBaseRoleSchema.nullable(),
        capability_overlays: z.array(capabilityOverlaySchema).default([]),
        internal_role_groups: z.array(internalRoleGroupSchema).default([]),
        policy_roles: z.array(z.string().trim().min(1)).default([]),
        permission_keys: z.array(z.string().trim().min(1)).default([]),
        mapped_app_roles: z.array(z.string().trim().min(1)).default([]),
        mapped_group_ids: z.array(z.string().trim().min(1)).default([]),
        finance_sensitive_access: z.boolean().default(false),
        communications_moderation: z.boolean().default(false),
        user_access_administration: z.boolean().default(false),
        security_administration: z.boolean().default(false)
      })
      .strict(),
    issues: z.array(authorizationIssueSchema).default([]),
    sign_in_allowed: z.boolean().default(true)
  })
  .strict();

export type MicrosoftEntraStepUpRule = z.infer<typeof stepUpRuleSchema>;
export type MicrosoftEntraSensitiveActionContract = z.infer<typeof sensitiveActionContractSchema>;
export type MicrosoftEntraAuthorizationContract = z.infer<typeof authorizationContractSchema>;
export type MicrosoftEntraClaimsSnapshot = z.infer<typeof claimsSnapshotSchema>;
export type MicrosoftEntraAuthorizationState = z.infer<typeof authorizationStateSchema>;

type SessionTrustLike = {
  sessionAssurance: SessionAssuranceLevel;
  lastReauthenticatedAt?: string | null;
  activeAuthContextIds?: string[];
};

type MappingSource = {
  source: "app_role" | "group";
  sourceKey: string;
  authorityTier: AuthorityTier | null;
  baseRole: AppBaseRole | null;
  capabilityOverlays: CapabilityOverlay[];
  internalRoleGroups: InternalRoleGroup[];
  policyRoles: string[];
  permissionKeys: string[];
  privileged: boolean;
};

const AUTHORITY_RANK: AuthorityTier[] = [
  "read_only_viewer",
  "standard_employee",
  "supervisor",
  "director_admin",
  "leadership",
  "super_admin"
];

const BASE_ROLE_RANK: AppBaseRole[] = [
  "AssociatePhotographer",
  "SeniorPhotographer",
  "OfficeStaff",
  "Manager",
  "Leadership",
  "Admin"
];

const DEFAULT_SENSITIVE_ACTION_CONTRACT: MicrosoftEntraSensitiveActionContract = {
  default_action_key: "session.elevate",
  actions: {
    "session.elevate": {
      auth_context_id: null,
      required_assurance: "mfa",
      reauth_window_minutes: 10,
      elevated_window_minutes: 10,
      privileged_window_minutes: 15,
      allow_break_glass: false,
      prompt: "login"
    },
    "break_glass.start": {
      auth_context_id: null,
      required_assurance: "mfa",
      reauth_window_minutes: 5,
      elevated_window_minutes: 10,
      privileged_window_minutes: 30,
      allow_break_glass: true,
      prompt: "login"
    }
  }
};

const DEFAULT_AUTHORIZATION_CONTRACT: MicrosoftEntraAuthorizationContract = {
  contract_version: "1",
  require_assignment_for_sign_in: false,
  fail_closed_for_privileged: true,
  app_role_mappings: {},
  group_mappings: []
};

export async function getMicrosoftEntraSensitiveActionContract(client: PoolClient, tenantId: string) {
  return resolveRuntimeAdminSettingValue<MicrosoftEntraSensitiveActionContract>(
    client,
    tenantId,
    "roles_access.microsoft_entra_sensitive_action_contract",
    {},
    new Date()
  ).catch(() => DEFAULT_SENSITIVE_ACTION_CONTRACT);
}

export async function getMicrosoftEntraStepUpRule(client: PoolClient, tenantId: string, actionKey: string | null | undefined) {
  const contract = await getMicrosoftEntraSensitiveActionContract(client, tenantId);
  const normalizedActionKey = actionKey?.trim() || contract.default_action_key;
  return {
    actionKey: normalizedActionKey,
    rule: contract.actions[normalizedActionKey] ?? contract.actions[contract.default_action_key]
  };
}

export async function getMicrosoftEntraAuthorizationContract(client: PoolClient, tenantId: string) {
  return resolveRuntimeAdminSettingValue<MicrosoftEntraAuthorizationContract>(
    client,
    tenantId,
    "roles_access.microsoft_entra_authorization_contract",
    {},
    new Date()
  ).catch(() => DEFAULT_AUTHORIZATION_CONTRACT);
}

export function extractMicrosoftEntraClaimsSnapshot(input: {
  claims: Record<string, unknown>;
  scopes: string[];
  tenantId: string;
  userId: string;
  email: string;
}): MicrosoftEntraClaimsSnapshot {
  const appRoleValues = uniqueStrings(asStringArray(input.claims.roles));
  const groupIds = uniqueStrings(asStringArray(input.claims.groups));
  const claimNames = isRecord(input.claims._claim_names) ? input.claims._claim_names : {};
  const groupClaimsOverage =
    input.claims.hasgroups === true ||
    input.claims.hasgroups === "true" ||
    claimNames.groups !== undefined;
  const acrValue = asTrimmedString(input.claims.acr) || null;
  const authContextIds = uniqueStrings([
    ...asStringArray(input.claims.acrs),
    ...(acrValue && acrValue.startsWith("c") ? [acrValue] : [])
  ]);
  const amr = uniqueStrings(asStringArray(input.claims.amr));
  const sessionAssurance = deriveSessionAssurance({
    amr,
    authContextIds
  });

  return claimsSnapshotSchema.parse({
    tenant_id: input.tenantId,
    user_id: input.userId,
    email: input.email,
    scopes: uniqueStrings(input.scopes),
    app_role_values: appRoleValues,
    group_ids: groupIds,
    group_claims_overage: groupClaimsOverage,
    auth_context_ids: authContextIds,
    amr,
    acr: acrValue,
    session_assurance: sessionAssurance,
    raw_claims: input.claims
  });
}

export function resolveMicrosoftEntraAuthorization(input: {
  contract: MicrosoftEntraAuthorizationContract;
  claims: MicrosoftEntraClaimsSnapshot;
  currentAuthorityTier?: AuthorityTier | null;
}): MicrosoftEntraAuthorizationState {
  const mappings: MappingSource[] = [];
  const issues: Array<{ code: string; severity: "warning" | "error"; message: string }> = [];

  for (const appRoleValue of input.claims.app_role_values) {
    const mapping = input.contract.app_role_mappings[appRoleValue];
    if (!mapping) {
      issues.push({
        code: "app_role.unmapped",
        severity: "warning",
        message: `The Entra app role "${appRoleValue}" is not mapped to Mission Control authorization.`
      });
      continue;
    }
    mappings.push({
      source: "app_role",
      sourceKey: appRoleValue,
      authorityTier: mapping.authority_tier ?? null,
      baseRole: mapping.base_role ?? null,
      capabilityOverlays: mapping.capability_overlays,
      internalRoleGroups: mapping.internal_role_groups,
      policyRoles: mapping.policy_roles,
      permissionKeys: mapping.permission_keys,
      privileged: mapping.privileged
    });
  }

  if (input.claims.group_claims_overage && input.contract.group_mappings.length > 0) {
    issues.push({
      code: "groups.overage",
      severity: "error",
      message: "Microsoft group overage was reported, so group-based authorization mappings could not be verified safely."
    });
  } else {
    for (const groupMapping of input.contract.group_mappings) {
      if (!input.claims.group_ids.includes(groupMapping.group_id)) {
        continue;
      }
      mappings.push({
        source: "group",
        sourceKey: groupMapping.group_id,
        authorityTier: groupMapping.authority_tier ?? null,
        baseRole: groupMapping.base_role ?? null,
        capabilityOverlays: groupMapping.capability_overlays,
        internalRoleGroups: groupMapping.internal_role_groups,
        policyRoles: groupMapping.policy_roles,
        permissionKeys: groupMapping.permission_keys,
        privileged: groupMapping.privileged
      });
    }
  }

  const resolvedAuthorityTier = pickStrongestAuthorityTier(mappings.map((mapping) => mapping.authorityTier).filter(isAuthorityTier));
  const resolvedBaseRole = pickStrongestBaseRole(mappings.map((mapping) => mapping.baseRole).filter(isAppBaseRole));
  const distinctAuthorityTiers = uniqueStrings(mappings.map((mapping) => mapping.authorityTier).filter(isAuthorityTier));
  const distinctBaseRoles = uniqueStrings(mappings.map((mapping) => mapping.baseRole).filter(isAppBaseRole));
  if (distinctAuthorityTiers.length > 1) {
    issues.push({
      code: "authority.conflict",
      severity: "warning",
      message: `Multiple Entra mappings resolved to different authority tiers (${distinctAuthorityTiers.join(", ")}). The strongest tier was applied.`
    });
  }
  if (distinctBaseRoles.length > 1) {
    issues.push({
      code: "base_role.conflict",
      severity: "warning",
      message: `Multiple Entra mappings resolved to different Mission Control base roles (${distinctBaseRoles.join(", ")}). The strongest role was applied.`
    });
  }

  const resolvedCapabilityOverlays = uniqueStrings(mappings.flatMap((mapping) => mapping.capabilityOverlays)) as CapabilityOverlay[];
  const resolvedInternalRoleGroups = uniqueStrings(
    mappings.flatMap((mapping) => mapping.internalRoleGroups)
  ) as InternalRoleGroup[];
  const resolvedPolicyRoles = uniqueStrings(mappings.flatMap((mapping) => mapping.policyRoles));
  const resolvedPermissionKeys = uniqueStrings(mappings.flatMap((mapping) => mapping.permissionKeys));
  const mappedAppRoles = uniqueStrings(mappings.filter((mapping) => mapping.source === "app_role").map((mapping) => mapping.sourceKey));
  const mappedGroupIds = uniqueStrings(mappings.filter((mapping) => mapping.source === "group").map((mapping) => mapping.sourceKey));

  const hasResolvedAssignment =
    Boolean(resolvedAuthorityTier) ||
    resolvedInternalRoleGroups.length > 0 ||
    resolvedPolicyRoles.length > 0 ||
    resolvedPermissionKeys.length > 0;
  const hasPrivilegedMapping = mappings.some((mapping) => mapping.privileged) || isPrivilegedAuthorityTier(resolvedAuthorityTier);
  const currentAuthorityIsPrivileged = isPrivilegedAuthorityTier(input.currentAuthorityTier ?? null);

  let signInAllowed = true;
  if (input.contract.require_assignment_for_sign_in && !hasResolvedAssignment) {
    signInAllowed = false;
    issues.push({
      code: "assignment.required",
      severity: "error",
      message: "No approved Entra app role or group assignment mapped to Mission Control authorization."
    });
  }

  if (input.contract.fail_closed_for_privileged && currentAuthorityIsPrivileged && !hasPrivilegedMapping) {
    signInAllowed = false;
    issues.push({
      code: "privileged.assignment_missing",
      severity: "error",
      message: "This account maps to a privileged Mission Control authority tier, but the Entra assignment contract did not prove a privileged assignment."
    });
  }

  return authorizationStateSchema.parse({
    provider: "microsoft_entra",
    source_contract_version: input.contract.contract_version,
    raw: input.claims,
    resolved: {
      authority_tier: resolvedAuthorityTier,
      base_role: resolvedBaseRole,
      capability_overlays: resolvedCapabilityOverlays,
      internal_role_groups: resolvedInternalRoleGroups,
      policy_roles: resolvedPolicyRoles,
      permission_keys: resolvedPermissionKeys,
      mapped_app_roles: mappedAppRoles,
      mapped_group_ids: mappedGroupIds,
      finance_sensitive_access: resolvedCapabilityOverlays.includes("Finance"),
      communications_moderation: resolvedCapabilityOverlays.includes("CommunicationsModerator"),
      user_access_administration: resolvedCapabilityOverlays.includes("UserAccessAdmin"),
      security_administration: resolvedCapabilityOverlays.includes("SecurityAdmin")
    },
    issues,
    sign_in_allowed: signInAllowed
  });
}

export function parseStoredMicrosoftEntraAuthorization(value: unknown): MicrosoftEntraAuthorizationState | null {
  const parsed = authorizationStateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function isMicrosoftEntraStepUpSatisfied(
  sessionTrust: SessionTrustLike,
  rule: Pick<MicrosoftEntraStepUpRule, "required_assurance" | "auth_context_id" | "reauth_window_minutes">
) {
  if (!isSessionAssuranceAtLeast(sessionTrust.sessionAssurance, rule.required_assurance)) {
    return false;
  }
  if (rule.auth_context_id && !(sessionTrust.activeAuthContextIds ?? []).includes(rule.auth_context_id)) {
    return false;
  }
  if (!sessionTrust.lastReauthenticatedAt) {
    return false;
  }
  const reauthenticatedAt = new Date(sessionTrust.lastReauthenticatedAt);
  if (Number.isNaN(reauthenticatedAt.getTime())) {
    return false;
  }
  const ageMs = Date.now() - reauthenticatedAt.getTime();
  return ageMs <= rule.reauth_window_minutes * 60_000;
}

export function isSessionAssuranceAtLeast(current: SessionAssuranceLevel, required: SessionAssuranceLevel) {
  return getSessionAssuranceWeight(current) >= getSessionAssuranceWeight(required);
}

export function isPrivilegedAuthorityTier(authorityTier: AuthorityTier | null | undefined) {
  return authorityTier === "super_admin" || authorityTier === "leadership" || authorityTier === "director_admin";
}

export function deriveSessionAssurance(input: { amr: string[]; authContextIds: string[] }): SessionAssuranceLevel {
  const lowerAmr = input.amr.map((value) => value.toLowerCase());
  if (lowerAmr.some((value) => ["fido", "hwk", "x509", "rsa", "phr"].includes(value))) {
    return "phishing_resistant";
  }
  if (lowerAmr.some((value) => ["mfa", "otp", "sms", "wiaormfa"].includes(value)) || input.authContextIds.length > 0) {
    return "mfa";
  }
  return "standard";
}

function getSessionAssuranceWeight(level: SessionAssuranceLevel) {
  switch (level) {
    case "phishing_resistant":
      return 3;
    case "mfa":
      return 2;
    case "standard":
    default:
      return 1;
  }
}

function pickStrongestAuthorityTier(authorityTiers: AuthorityTier[]) {
  if (!authorityTiers.length) {
    return null;
  }
  return [...authorityTiers].sort((left, right) => AUTHORITY_RANK.indexOf(right) - AUTHORITY_RANK.indexOf(left))[0] ?? null;
}

function pickStrongestBaseRole(baseRoles: AppBaseRole[]) {
  if (!baseRoles.length) {
    return null;
  }
  return [...baseRoles].sort((left, right) => BASE_ROLE_RANK.indexOf(right) - BASE_ROLE_RANK.indexOf(left))[0] ?? null;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return typeof value === "string" && value.trim() ? [value.trim()] : [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
}

function asTrimmedString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function uniqueStrings<T extends string>(values: T[]) {
  return [...new Set(values.filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAuthorityTier(value: string | null | undefined): value is AuthorityTier {
  return Boolean(value) && authorityTierSchema.safeParse(value).success;
}

function isAppBaseRole(value: string | null | undefined): value is AppBaseRole {
  return Boolean(value) && appBaseRoleSchema.safeParse(value).success;
}
