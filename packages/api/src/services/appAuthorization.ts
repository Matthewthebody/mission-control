import type {
  AppBaseRole,
  AuthRole,
  AuthorityTier,
  CapabilityOverlay,
  DepartmentCode,
  InternalRoleGroup,
  JobFunctionProfile
} from "../types/auth.js";

type AuthorizationProfileInput = {
  authorityTier: AuthorityTier | null;
  department: DepartmentCode;
  roles: AuthRole[];
  internalRoleGroups: InternalRoleGroup[];
  jobFunctionProfiles: JobFunctionProfile[];
  primaryJobFunctionProfile: JobFunctionProfile | null;
  permissionKeys: string[];
  explicitBaseRole?: AppBaseRole | null;
  explicitCapabilityOverlays?: CapabilityOverlay[] | null;
};

export type AppAuthorizationProfile = {
  baseRole: AppBaseRole;
  capabilityOverlays: CapabilityOverlay[];
  authorizationFlags: {
    financeSensitiveAccess: boolean;
    communicationsModeration: boolean;
    userAccessAdministration: boolean;
    securityAdministration: boolean;
  };
};

const FIELD_PHOTOGRAPHY_PROFILES: JobFunctionProfile[] = [
  "associate_photographer",
  "seasonal_photographer",
  "part_time_photographer"
];

const SENIOR_FIELD_PROFILES: JobFunctionProfile[] = ["senior_photographer", "director_of_photography"];
const OFFICE_PROFILES: JobFunctionProfile[] = [
  "schools_client_success",
  "sports_client_success",
  "customer_service_rep",
  "graphic_artist",
  "director_of_school_photography",
  "director_of_sports_photography",
  "director_of_digital_production",
  "leadership_viewer"
];

function uniqueOverlays(values: CapabilityOverlay[]) {
  return [...new Set(values)];
}

function hasPermissionPrefix(permissionKeys: string[], prefix: string) {
  return permissionKeys.some((permission) => permission === prefix || permission.startsWith(`${prefix}.`));
}

export function deriveDefaultAppBaseRole(input: Omit<AuthorizationProfileInput, "explicitBaseRole" | "explicitCapabilityOverlays" | "permissionKeys">): AppBaseRole {
  const profileSet = new Set<JobFunctionProfile>([
    ...(input.primaryJobFunctionProfile ? [input.primaryJobFunctionProfile] : []),
    ...input.jobFunctionProfiles
  ]);
  const roleSet = new Set(input.roles);
  const groupSet = new Set(input.internalRoleGroups);

  if (input.authorityTier === "super_admin" || groupSet.has("system_admin") || roleSet.has("owner_admin")) {
    return "Admin";
  }

  if (input.authorityTier === "leadership" || groupSet.has("leadership")) {
    return "Leadership";
  }

  if (input.authorityTier === "director_admin" || input.authorityTier === "supervisor") {
    return "Manager";
  }

  if ([...profileSet].some((profile) => SENIOR_FIELD_PROFILES.includes(profile))) {
    return "SeniorPhotographer";
  }

  if ([...profileSet].some((profile) => FIELD_PHOTOGRAPHY_PROFILES.includes(profile)) || roleSet.has("photographer")) {
    return "AssociatePhotographer";
  }

  if (input.department === "office" || input.department === "customer_service" || [...profileSet].some((profile) => OFFICE_PROFILES.includes(profile))) {
    return "OfficeStaff";
  }

  return "OfficeStaff";
}

function deriveDefaultCapabilityOverlays(input: Omit<AuthorizationProfileInput, "explicitBaseRole" | "explicitCapabilityOverlays">) {
  const overlays: CapabilityOverlay[] = [];
  const groupSet = new Set(input.internalRoleGroups);

  if (
    hasPermissionPrefix(input.permissionKeys, "finance") ||
    hasPermissionPrefix(input.permissionKeys, "sports_finance") ||
    input.permissionKeys.includes("labor.read") ||
    input.permissionKeys.includes("profitability.read") ||
    input.permissionKeys.includes("profitability_leadership.view")
  ) {
    overlays.push("Finance");
  }

  if (
    input.permissionKeys.includes("communication.moderate") ||
    input.permissionKeys.includes("communication.revoke_access")
  ) {
    overlays.push("CommunicationsModerator");
  }

  if (
    hasPermissionPrefix(input.permissionKeys, "user.") ||
    hasPermissionPrefix(input.permissionKeys, "settings.roles") ||
    hasPermissionPrefix(input.permissionKeys, "settings.permissions") ||
    input.permissionKeys.includes("access_preview.use")
  ) {
    overlays.push("UserAccessAdmin");
  }

  if (
    input.permissionKeys.includes("security.manage") ||
    input.permissionKeys.includes("auditlog.read") ||
    groupSet.has("system_admin") ||
    input.authorityTier === "super_admin"
  ) {
    overlays.push("SecurityAdmin");
  }

  return uniqueOverlays(overlays);
}

export function deriveAppAuthorizationProfile(input: AuthorizationProfileInput): AppAuthorizationProfile {
  const baseRole =
    input.explicitBaseRole ??
    deriveDefaultAppBaseRole({
      authorityTier: input.authorityTier,
      department: input.department,
      roles: input.roles,
      internalRoleGroups: input.internalRoleGroups,
      jobFunctionProfiles: input.jobFunctionProfiles,
      primaryJobFunctionProfile: input.primaryJobFunctionProfile
    });
  const capabilityOverlays = uniqueOverlays(
    input.explicitCapabilityOverlays && input.explicitCapabilityOverlays.length
      ? input.explicitCapabilityOverlays
      : deriveDefaultCapabilityOverlays(input)
  );

  return {
    baseRole,
    capabilityOverlays,
    authorizationFlags: {
      financeSensitiveAccess: capabilityOverlays.includes("Finance"),
      communicationsModeration: capabilityOverlays.includes("CommunicationsModerator") || baseRole === "Admin",
      userAccessAdministration: capabilityOverlays.includes("UserAccessAdmin") || baseRole === "Admin",
      securityAdministration: capabilityOverlays.includes("SecurityAdmin") || baseRole === "Admin"
    }
  };
}

export function hasCapabilityOverlay(
  auth: Pick<AppAuthorizationProfile, "capabilityOverlays"> | { capabilityOverlays?: CapabilityOverlay[] | null },
  overlay: CapabilityOverlay
) {
  return (auth.capabilityOverlays ?? []).includes(overlay);
}

export function hasFinanceSensitiveAccess(
  auth: Pick<AppAuthorizationProfile, "authorizationFlags"> | { authorizationFlags?: AppAuthorizationProfile["authorizationFlags"] | null }
) {
  return Boolean(auth.authorizationFlags?.financeSensitiveAccess);
}

export function hasCommunicationModerationRights(
  auth: Pick<AppAuthorizationProfile, "authorizationFlags"> | { authorizationFlags?: AppAuthorizationProfile["authorizationFlags"] | null }
) {
  return Boolean(auth.authorizationFlags?.communicationsModeration);
}

export function hasUserAccessAdministrationRights(
  auth: Pick<AppAuthorizationProfile, "authorizationFlags"> | { authorizationFlags?: AppAuthorizationProfile["authorizationFlags"] | null }
) {
  return Boolean(auth.authorizationFlags?.userAccessAdministration);
}

export function hasSecurityAdministrationRights(
  auth: Pick<AppAuthorizationProfile, "authorizationFlags"> | { authorizationFlags?: AppAuthorizationProfile["authorizationFlags"] | null }
) {
  return Boolean(auth.authorizationFlags?.securityAdministration);
}
