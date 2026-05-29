import type { PoolClient } from "pg";
import { hasAuthorityTier, hasJobFunctionProfile } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type { ShootStatus } from "../domain/lifecycle/index.js";

export type ApprovalLevel = 1 | 2 | 3;

export type Phase1RoleGroup =
  | "system_admin_owner"
  | "leadership"
  | "department_manager_coordinator"
  | "senior_photographer_shoot_lead"
  | "production_lead"
  | "standard_employee_staff"
  | "read_only_limited_viewer";

export type ShootStatusApprovalDecision = {
  approvalLevel: ApprovalLevel;
  roleGroup: Phase1RoleGroup;
  readinessOverrideApplied: boolean;
  dangerousActionCode: "cancel_operational_shoot" | "change_shoot_status_complete" | null;
};

function hasProductionLeadProfile(auth: AuthUser) {
  return hasJobFunctionProfile(auth, "director_of_digital_production");
}

function hasProductionStaffProfile(auth: AuthUser) {
  return hasJobFunctionProfile(auth, ["graphic_artist", "director_of_digital_production"]);
}

function hasSeniorFieldProfile(auth: AuthUser) {
  return hasJobFunctionProfile(auth, [
    "senior_photographer",
    "director_of_photography",
    "director_of_school_photography",
    "director_of_sports_photography"
  ]);
}

export function resolvePhase1RoleGroup(auth: AuthUser): Phase1RoleGroup {
  if (hasAuthorityTier(auth, "super_admin")) {
    return "system_admin_owner";
  }
  if (hasAuthorityTier(auth, "leadership")) {
    return "leadership";
  }
  if (hasProductionLeadProfile(auth)) {
    return "production_lead";
  }
  if (
    hasAuthorityTier(auth, ["director_admin", "supervisor"]) ||
    hasJobFunctionProfile(auth, ["schools_client_success", "sports_client_success"])
  ) {
    return "department_manager_coordinator";
  }
  if (hasSeniorFieldProfile(auth)) {
    return "senior_photographer_shoot_lead";
  }
  if (hasAuthorityTier(auth, "read_only_viewer")) {
    return "read_only_limited_viewer";
  }
  return "standard_employee_staff";
}

export function hasLeadershipApprovalAuthority(auth: AuthUser) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]);
}

export function hasManagerApprovalAuthority(auth: AuthUser) {
  return (
    hasLeadershipApprovalAuthority(auth) ||
    hasAuthorityTier(auth, "supervisor") ||
    hasJobFunctionProfile(auth, ["schools_client_success", "sports_client_success"]) ||
    hasProductionLeadProfile(auth)
  );
}

export function canModerateOperationalNotes(auth: AuthUser) {
  return hasManagerApprovalAuthority(auth);
}

export function canOverrideProtectedAttendanceHistory(auth: AuthUser) {
  return hasLeadershipApprovalAuthority(auth);
}

export function canManageShootPlanningStates(auth: AuthUser) {
  return hasManagerApprovalAuthority(auth);
}

export function canConfirmReadyState(auth: AuthUser) {
  return hasManagerApprovalAuthority(auth);
}

export function canManageOnHoldState(auth: AuthUser) {
  return hasManagerApprovalAuthority(auth);
}

export function canManageCancellationState(auth: AuthUser) {
  return hasLeadershipApprovalAuthority(auth);
}

export function canManagePostProductionState(auth: AuthUser) {
  return hasManagerApprovalAuthority(auth) || hasProductionStaffProfile(auth);
}

export function canMarkShootCompleteFromProduction(auth: AuthUser) {
  return hasManagerApprovalAuthority(auth) || hasProductionLeadProfile(auth);
}

export async function hasAssignedShootWorkContext(client: PoolClient, auth: AuthUser, shootId: string) {
  const assignment = await client.query(
    `
      SELECT 1
      FROM work_shift ws
      WHERE ws.tenant_id = $1
        AND ws.shoot_id = $2
        AND ws.assigned_user_id = $3
        AND ws.cancelled_at IS NULL
        AND ws.status IN ('draft', 'published', 'completed')
      LIMIT 1
    `,
    [auth.tenantId, shootId, auth.id]
  );

  if (assignment.rows[0]) {
    return true;
  }

  const shootAssignment = await client.query(
    `
      SELECT 1
      FROM shoot_assignment
      WHERE tenant_id = $1
        AND shoot_id = $2
        AND user_id = $3
      LIMIT 1
    `,
    [auth.tenantId, shootId, auth.id]
  );

  return Boolean(shootAssignment.rows[0]);
}

export async function hasAssignedShootLeadAuthority(client: PoolClient, auth: AuthUser, shootId: string) {
  const directLeadAssignment = await client.query(
    `
      SELECT 1
      FROM work_shift ws
      WHERE ws.tenant_id = $1
        AND ws.shoot_id = $2
        AND ws.assigned_user_id = $3
        AND ws.cancelled_at IS NULL
        AND ws.status IN ('draft', 'published', 'completed')
        AND ws.satisfies_lead_coverage = true
      LIMIT 1
    `,
    [auth.tenantId, shootId, auth.id]
  );

  if (directLeadAssignment.rows[0]) {
    return true;
  }

  if (!hasSeniorFieldProfile(auth)) {
    return false;
  }

  return hasAssignedShootWorkContext(client, auth, shootId);
}

function buildShootStatusAuthorityError(message: string) {
  return new ApiError(403, message);
}

export async function assertShootStatusApprovalRights(
  client: PoolClient,
  auth: AuthUser,
  input: {
    shootId: string;
    currentStatus: ShootStatus;
    nextStatus: ShootStatus;
    readyEligible: boolean;
    reason?: string | null;
  }
): Promise<ShootStatusApprovalDecision> {
  const roleGroup = resolvePhase1RoleGroup(auth);
  const reason = input.reason?.trim() ?? "";
  const readinessOverrideApplied = input.currentStatus === "CONFIRMED" && input.nextStatus === "READY" && !input.readyEligible;

  if (input.currentStatus === input.nextStatus) {
    return {
      approvalLevel: 1,
      roleGroup,
      readinessOverrideApplied: false,
      dangerousActionCode: null
    };
  }

  if (input.currentStatus === "COMPLETE" && input.nextStatus !== "COMPLETE") {
    if (!hasLeadershipApprovalAuthority(auth)) {
      throw buildShootStatusAuthorityError("Only leadership or admin can reopen a completed shoot in Phase 1.");
    }
    if (!reason) {
      throw new ApiError(400, "Reopening a completed shoot requires a reason.");
    }
    return {
      approvalLevel: 3,
      roleGroup,
      readinessOverrideApplied: false,
      dangerousActionCode: "change_shoot_status_complete"
    };
  }

  switch (input.nextStatus) {
    case "DRAFT":
    case "TENTATIVE":
    case "CONFIRMED":
      if (!canManageShootPlanningStates(auth)) {
        throw buildShootStatusAuthorityError("Only a manager, coordinator, leadership user, or admin can make that planning-stage status change.");
      }
      return {
        approvalLevel: 1,
        roleGroup,
        readinessOverrideApplied: false,
        dangerousActionCode: null
      };
    case "READY":
      if (!canConfirmReadyState(auth)) {
        throw buildShootStatusAuthorityError("Only an authorized manager, coordinator, leadership user, or admin can move a shoot to Ready.");
      }
      if (readinessOverrideApplied && !reason) {
        throw new ApiError(400, "Moving a shoot to Ready before all readiness requirements are complete requires a reason.");
      }
      return {
        approvalLevel: readinessOverrideApplied ? 2 : 1,
        roleGroup,
        readinessOverrideApplied,
        dangerousActionCode: null
      };
    case "LIVE":
    case "SHOOT_COMPLETE": {
      if (hasManagerApprovalAuthority(auth)) {
        return {
          approvalLevel: 1,
          roleGroup,
          readinessOverrideApplied: false,
          dangerousActionCode: null
        };
      }
      const hasFieldExecutionAuthority = await hasAssignedShootLeadAuthority(client, auth, input.shootId);
      if (!hasFieldExecutionAuthority) {
        throw buildShootStatusAuthorityError(
          input.nextStatus === "LIVE"
            ? "Only the assigned shoot lead, senior photographer, manager, leadership user, or admin can start a shoot Live."
            : "Only the assigned shoot lead, senior photographer, manager, leadership user, or admin can mark a shoot Shot Complete."
        );
      }
      return {
        approvalLevel: 1,
        roleGroup,
        readinessOverrideApplied: false,
        dangerousActionCode: null
      };
    }
    case "POST_PRODUCTION":
      if (!canManagePostProductionState(auth)) {
        throw buildShootStatusAuthorityError("Only production staff in scope, a production lead, a manager, leadership, or an admin can move a shoot into Post-Production.");
      }
      return {
        approvalLevel: 1,
        roleGroup,
        readinessOverrideApplied: false,
        dangerousActionCode: null
      };
    case "COMPLETE":
      if (!canMarkShootCompleteFromProduction(auth)) {
        throw buildShootStatusAuthorityError("Only an authorized production lead, manager, leadership user, or admin can mark a shoot Complete.");
      }
      return {
        approvalLevel: 1,
        roleGroup,
        readinessOverrideApplied: false,
        dangerousActionCode: null
      };
    case "ON_HOLD":
      if (!canManageOnHoldState(auth)) {
        throw buildShootStatusAuthorityError("Only a manager, leadership user, or admin can place a shoot On Hold.");
      }
      return {
        approvalLevel: 2,
        roleGroup,
        readinessOverrideApplied: false,
        dangerousActionCode: null
      };
    case "CANCELLED":
      if (!canManageCancellationState(auth)) {
        throw buildShootStatusAuthorityError("Only leadership or admin can cancel a shoot in Phase 1.");
      }
      if (!reason) {
        throw new ApiError(400, "Cancelling a shoot requires a reason.");
      }
      return {
        approvalLevel: 3,
        roleGroup,
        readinessOverrideApplied: false,
        dangerousActionCode: "cancel_operational_shoot"
      };
    default:
      return {
        approvalLevel: 1,
        roleGroup,
        readinessOverrideApplied: false,
        dangerousActionCode: null
      };
  }
}

export function resolveStaffingApprovalLevel(input: {
  insideProtectedWindow: boolean;
  leadAssignmentChange: boolean;
  warningOverride: boolean;
  conflictOverride: boolean;
}): ApprovalLevel {
  if (input.insideProtectedWindow || input.leadAssignmentChange || input.warningOverride || input.conflictOverride) {
    return 2;
  }
  return 1;
}

export function resolveAttendanceApprovalLevel(input: {
  protectedHistoryEdit: boolean;
  exceptionReview: boolean;
}): ApprovalLevel {
  if (input.protectedHistoryEdit) {
    return 3;
  }
  if (input.exceptionReview) {
    return 2;
  }
  return 1;
}

export function getApprovalLevelLabel(level: ApprovalLevel) {
  switch (level) {
    case 1:
      return "level_1_no_approval";
    case 2:
      return "level_2_manager_approval";
    case 3:
      return "level_3_leadership_or_admin_approval";
    default:
      return "level_1_no_approval";
  }
}
