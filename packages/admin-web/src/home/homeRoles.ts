import type { SessionUser } from "../types";
import { getPrimaryBusinessRole } from "../permissions";

// Lightweight, demo-safe role model for the role-aware Home experience.
// This is intentionally separate from real auth/permissions so the demo role
// switcher can preview each operating view without changing the signed-in user.

export type HomeRoleId =
  | "matthew"
  | "jessica"
  | "josh"
  | "sam"
  | "carisa"
  | "spencer"
  | "graphic_artist"
  | "seasonal_photographer"
  | "csr";

export type HomeMode = "company_command" | "my_workspace";

export type OperatingArea =
  | "company"
  | "schools"
  | "sports"
  | "photography"
  | "staffing"
  | "production"
  | "client_success"
  | "sales_orders"
  | "weather";

export type HomeRole = {
  id: HomeRoleId;
  /** Full switcher label, e.g. "Matthew / Owner". */
  label: string;
  /** Short name for compact contexts, e.g. "Matthew". */
  shortLabel: string;
  /** Human role/department title shown under the greeting. */
  title: string;
  mode: HomeMode;
  /** The operating area this role cares about most; rises slightly in lists. */
  emphasizedArea: OperatingArea;
  leadership: boolean;
};

export const HOME_ROLES: HomeRole[] = [
  { id: "matthew", label: "Matthew / Owner", shortLabel: "Matthew", title: "Owner", mode: "company_command", emphasizedArea: "company", leadership: true },
  { id: "jessica", label: "Jessica / Schools Director", shortLabel: "Jessica", title: "Schools Director", mode: "company_command", emphasizedArea: "schools", leadership: true },
  { id: "josh", label: "Josh / Sports Director", shortLabel: "Josh", title: "Sports Director", mode: "company_command", emphasizedArea: "sports", leadership: true },
  { id: "sam", label: "Sam / Sports Coordinator", shortLabel: "Sam", title: "Sports Coordinator", mode: "my_workspace", emphasizedArea: "sports", leadership: false },
  { id: "carisa", label: "Carisa / Photography Ops", shortLabel: "Carisa", title: "Photography Ops", mode: "company_command", emphasizedArea: "photography", leadership: true },
  { id: "spencer", label: "Spencer / Production", shortLabel: "Spencer", title: "Production Lead", mode: "company_command", emphasizedArea: "production", leadership: true },
  { id: "graphic_artist", label: "Graphic Artist", shortLabel: "Graphic Artist", title: "Graphic Artist", mode: "my_workspace", emphasizedArea: "production", leadership: false },
  { id: "seasonal_photographer", label: "Seasonal Photographer", shortLabel: "Photographer", title: "Seasonal Photographer", mode: "my_workspace", emphasizedArea: "photography", leadership: false },
  { id: "csr", label: "CSR / Client Success", shortLabel: "CSR", title: "Client Success", mode: "my_workspace", emphasizedArea: "client_success", leadership: false }
];

const HOME_ROLE_BY_ID = new Map(HOME_ROLES.map((role) => [role.id, role]));

export const DEFAULT_HOME_ROLE_ID: HomeRoleId = "matthew";

export function isHomeRoleId(value: string | null | undefined): value is HomeRoleId {
  return Boolean(value) && HOME_ROLE_BY_ID.has(value as HomeRoleId);
}

export function getHomeRole(id: HomeRoleId): HomeRole {
  return HOME_ROLE_BY_ID.get(id) ?? HOME_ROLE_BY_ID.get(DEFAULT_HOME_ROLE_ID)!;
}

// Map the real signed-in user to a sensible default demo role so Home opens on
// the right experience before anyone touches the switcher.
export function defaultHomeRoleForUser(user: SessionUser): HomeRoleId {
  switch (getPrimaryBusinessRole(user)) {
    case "admin":
    case "leadership":
    case "manager":
      return "matthew";
    case "production_staff":
      return "graphic_artist";
    case "customer_service_staff":
    case "sales_growth_staff":
      return "csr";
    case "photographer":
    case "shoot_lead":
      return "seasonal_photographer";
    default:
      return "seasonal_photographer";
  }
}

export const OPERATING_AREA_LABELS: Record<OperatingArea, string> = {
  company: "Company",
  schools: "Schools",
  sports: "Sports",
  photography: "Photography",
  staffing: "Staffing",
  production: "Production",
  client_success: "Client Success",
  sales_orders: "Sales / Orders",
  weather: "Weather / Field Risk"
};
