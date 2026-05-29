import { canManagePermissions, isFieldPhotographyProfile } from "./authority.js";
import type { AuthRole, AuthUser } from "../types/auth.js";

export type AccessAction =
  | "auth.session.read"
  | "shoot.create"
  | "shoot.read"
  | "shoot.update"
  | "shoot.delete"
  | "schedule.read"
  | "schedule.manage"
  | "schedule.publish"
  | "status_event.create"
  | "time.clock"
  | "time_entry.read"
  | "mileage.create"
  | "upload.presign"
  | "media.attach"
  | "attendance.read"
  | "attendance.manage"
  | "alerts.read"
  | "alerts.resolve"
  | "push.manage"
  | "trade.request"
  | "trade.approve"
  | "pto.request"
  | "pto.approve"
  | "notification.read"
  | "dashboard.read"
  | "user.read"
  | "user.invite"
  | "user.approve"
  | "user.role.update"
  | "user.department.update"
  | "user.suspend"
  | "user.reactivate"
  | "user.revoke"
  | "audit.read"
  | "security.manage";

export type MembershipSubject = {
  type: "membership";
  targetUserId: string;
  targetRoles: AuthRole[];
  targetStatus: string;
  proposedRole?: AuthRole | null;
};

export const LEGACY_PERMISSION_TO_ACTION: Record<string, AccessAction> = {
  "shoot.create": "shoot.create",
  "shoot.read": "shoot.read",
  "shoot.update": "shoot.update",
  "shoot.delete": "shoot.delete",
  "schedule.read": "schedule.read",
  "schedule.manage": "schedule.manage",
  "schedule.publish": "schedule.publish",
  "status_event.create": "status_event.create",
  "time_entry.read": "time_entry.read",
  "mileage.create": "mileage.create",
  "attendance.read": "attendance.read",
  "attendance.manage": "attendance.manage",
  "alerts.read": "alerts.read",
  "alerts.resolve": "alerts.resolve",
  "push.manage": "push.manage",
  "trade.request": "trade.request",
  "trade.approve": "trade.approve",
  "pto.request": "pto.request",
  "pto.approve": "pto.approve",
  "notification.read": "notification.read",
  "dashboard.read": "dashboard.read",
  "user.read": "user.read",
  "user.invite": "user.invite",
  "user.approve": "user.approve",
  "user.role.update": "user.role.update",
  "user.department.update": "user.department.update",
  "user.suspend": "user.suspend",
  "user.reactivate": "user.reactivate",
  "user.revoke": "user.revoke",
  "audit.read": "audit.read",
  "security.manage": "security.manage"
};

export function isActiveMembership(auth: Pick<AuthUser, "status">) {
  return auth.status === "active";
}

export function isFieldRole(auth: Pick<AuthUser, "roles" | "jobFunctionProfiles">) {
  return isFieldPhotographyProfile(auth);
}

export function canPerformAction(auth: AuthUser, action: AccessAction) {
  if (!isActiveMembership(auth)) {
    return false;
  }
  return auth.permissions.includes(action);
}

export function canManageMembership(auth: AuthUser, subject: MembershipSubject, action: AccessAction) {
  if (!canManagePermissions(auth) || !canPerformAction(auth, action)) {
    return false;
  }

  return true;
}

export function hasRole(auth: Pick<AuthUser, "roles">, role: AuthRole) {
  return auth.roles.includes(role);
}
