import type { HomeRole } from "./homeRoles";

// Demo-safe display rules for Home. These gate what each role is allowed to see
// so associates never get company-wide / sensitive surfaces. They mirror the
// intent of the real permission model but stay frontend-only for the demo.

export function canSeeCompanyCommand(role: HomeRole): boolean {
  return role.mode === "company_command";
}

export function canSeeCompanyDirectory(role: HomeRole): boolean {
  return role.leadership;
}

export function canSeeLeadershipReports(role: HomeRole): boolean {
  return role.leadership;
}

export function canSeeCompanyAttendance(role: HomeRole): boolean {
  return role.leadership;
}

export function canSeeCompanyWideRisk(role: HomeRole): boolean {
  return role.leadership;
}
