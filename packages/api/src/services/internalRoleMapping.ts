import type { AuthorityTier, DepartmentCode, InternalRoleGroup, JobFunctionProfile } from "../types/auth.js";

type InternalRoleMappingInput = {
  authorityTier: AuthorityTier | null;
  department: DepartmentCode;
  primaryJobFunctionProfile: JobFunctionProfile | null;
  jobFunctionProfiles: JobFunctionProfile[];
};

export function deriveInternalRoleGroups(input: InternalRoleMappingInput): InternalRoleGroup[] {
  const groups = new Set<InternalRoleGroup>();
  const profiles = new Set<JobFunctionProfile>([
    ...(input.primaryJobFunctionProfile ? [input.primaryJobFunctionProfile] : []),
    ...input.jobFunctionProfiles
  ]);

  if (input.authorityTier === "super_admin") {
    groups.add("system_admin");
  }

  if (input.authorityTier === "super_admin" || input.authorityTier === "leadership" || profiles.has("leadership_team_member")) {
    groups.add("leadership");
  }

  if (
    input.department === "schools" ||
    profiles.has("schools_client_success") ||
    profiles.has("director_of_school_photography")
  ) {
    groups.add("schools");
  }

  if (
    input.department === "sports" ||
    profiles.has("sports_client_success") ||
    profiles.has("director_of_sports_photography")
  ) {
    groups.add("sports");
  }

  if (profiles.has("schools_client_success") || profiles.has("sports_client_success")) {
    groups.add("account_reps");
  }

  if (profiles.has("senior_photographer") || profiles.has("director_of_photography")) {
    groups.add("senior_photographers");
  }

  if (
    profiles.has("associate_photographer") ||
    profiles.has("seasonal_photographer") ||
    profiles.has("part_time_photographer")
  ) {
    groups.add("seasonal_photographers");
  }

  if (
    input.department === "production" ||
    profiles.has("graphic_artist") ||
    profiles.has("director_of_digital_production")
  ) {
    groups.add("graphics_production");
  }

  if (input.department === "customer_service" || profiles.has("customer_service_rep")) {
    groups.add("customer_service");
  }

  return [...groups];
}
