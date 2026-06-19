import { describe, expect, it } from "vitest";
import {
  canAccessRoute,
  canAccessApprovalsHub,
  canAccessGraphicsWorkspace,
  canAccessProductionProjects,
  canAccessSharedExceptions,
  canAccessSharedTasksShell,
  canAccessSharedWatchlist,
  canAccessStudiosWorkspace,
  canAccessPhotographyWorkspace,
  canAccessTeamsCommunicationSurface,
  canApproveOperationalExceptions,
  canAccessEmployeeMyWork,
  canAccessClientCommandCenter,
  canAccessOperatingSystemModule,
  canAccessProjectTracking,
  canManageWorkflowTemplates,
  canAssignStaffingRecords,
  canChangeProductionStatus,
  canChangeSharedJobStatus,
  canEditJobWorkflow,
  canChangeSharedTaskStatus,
  canConfigureSystemBehavior,
  canManageCanonicalDirectoryRecords,
  canManageOperatingSystemModule,
  canManageSharedTasksShell,
  canManageSchoolFoundation,
  canManageSchoolsHub,
  canReviewPtoRecord,
  canReviewTradeRecord,
  canViewAccessDirectory,
  canViewProfitabilityLeadership,
  canViewSensitiveEvaluations,
  canViewSensitiveNotes,
  getOperatingSystemRoleTemplate,
  getOperatingSystemScope,
  getSchoolsHubAccessScope,
  getBusinessRoles,
  getDefaultLandingRoute,
  shouldLimitToEmployeeWorksurface
} from "../permissions";
import type { SessionUser } from "../types";

const standardSessionTrust = {
  identityProvider: "local_password" as const,
  sessionAssurance: "standard" as const,
  requestTransport: "bearer" as const,
  elevatedUntil: null,
  privilegedModeUntil: null,
  breakGlassStartedAt: null,
  breakGlassUntil: null,
  breakGlassReason: null,
  breakGlassScopeType: null,
  breakGlassScopeId: null,
  elevatedSessionActive: false,
  privilegedModeActive: false,
  breakGlassModeActive: false
};

const baseUser: SessionUser = {
  id: "user-1",
  tenantId: "tenant-1",
  accountId: "account-1",
  sessionId: "session-1",
  email: "user@example.com",
  fullName: "User One",
  status: "active",
  department: "schools",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["office_employee"],
  permissions: [],
  authorityTier: "supervisor",
  primaryJobFunctionProfile: "schools_client_success",
  jobFunctionProfiles: ["schools_client_success"],
  permissionGrants: [],
  effectiveScopes: ["department_only"],
  sessionTrust: standardSessionTrust
};

describe("job workflow editing permissions", () => {
  const job = { department_type: "schools", account_owner_user_id: "owner-9", lead_owner_user_id: "lead-9" };
  const regularEmployee: SessionUser = {
    ...baseUser,
    id: "employee-1",
    authorityTier: "standard_employee",
    primaryJobFunctionProfile: "associate_photographer",
    jobFunctionProfiles: ["associate_photographer"],
    roles: ["office_employee"],
    permissions: ["dashboard.read", "schedule.read"]
  };

  it("lets a job owner or lead edit their own job workflow without granting template management", () => {
    const owner = { ...regularEmployee, id: "owner-9" };
    const lead = { ...regularEmployee, id: "lead-9" };
    expect(canEditJobWorkflow(owner, job)).toBe(true);
    expect(canEditJobWorkflow(lead, job)).toBe(true);
    // Owning a job must never grant global workflow-template management.
    expect(canManageWorkflowTemplates(owner)).toBe(false);
    expect(canManageWorkflowTemplates(lead)).toBe(false);
  });

  it("lets a department status-permission holder edit any job workflow", () => {
    const manager = { ...regularEmployee, id: "manager-1", permissions: ["job.update"] };
    expect(canChangeSharedJobStatus(manager)).toBe(true);
    expect(canEditJobWorkflow(manager, job)).toBe(true);
  });

  it("blocks an unrelated regular employee from editing the job workflow or managing templates", () => {
    const stranger = { ...regularEmployee, id: "stranger-1" };
    expect(canEditJobWorkflow(stranger, job)).toBe(false);
    expect(canManageWorkflowTemplates(stranger)).toBe(false);
  });
});

describe("approval permission helpers", () => {
  it("treats PTO and trade requestors as approval-hub users", () => {
    const requestor = {
      ...baseUser,
      permissions: ["trade.request", "pto.request"]
    };

    expect(canAccessApprovalsHub(requestor)).toBe(true);
  });

  it("allows routed approvers to act without a broad legacy approval code", () => {
    expect(canReviewTradeRecord(baseUser, "user-1")).toBe(true);
    expect(canReviewPtoRecord(baseUser, "user-1")).toBe(true);
  });

  it("keeps unrelated employees from acting on someone else's approval item", () => {
    const unrelatedEmployee = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "customer_service_rep",
      jobFunctionProfiles: ["customer_service_rep"],
      permissions: ["dashboard.read"],
      roles: ["office_employee"]
    };
    expect(canReviewTradeRecord(unrelatedEmployee, "user-2")).toBe(false);
    expect(canReviewPtoRecord(unrelatedEmployee, "user-2")).toBe(false);
  });

  it("does not treat the requester or recipient as a valid approver", () => {
    expect(canReviewTradeRecord(baseUser, "user-1", "user-1", "user-3")).toBe(false);
    expect(canReviewTradeRecord(baseUser, "user-1", "user-2", "user-1")).toBe(false);
    expect(canReviewPtoRecord(baseUser, "user-1", "user-1")).toBe(false);
  });

  it("opens My Work only for field users in the employee tier", () => {
    const fieldEmployee = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "associate_photographer",
      jobFunctionProfiles: ["associate_photographer"],
      permissions: ["schedule.read", "time.clock", "trade.request"]
    };
    const officeEmployee = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "customer_service_rep",
      jobFunctionProfiles: ["customer_service_rep"],
      permissions: ["dashboard.read", "schedule.read", "time.clock"]
    };

    expect(canAccessEmployeeMyWork(fieldEmployee)).toBe(true);
    expect(canAccessEmployeeMyWork(officeEmployee)).toBe(false);
  });

  it("limits field users to the employee worksurface when they do not carry leadership tools", () => {
    const fieldEmployee = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "seasonal_photographer",
      jobFunctionProfiles: ["seasonal_photographer"],
      permissions: ["schedule.read", "time.clock", "trade.request", "media.attach"]
    };
    const fieldLead = {
      ...fieldEmployee,
      authorityTier: "supervisor",
      primaryJobFunctionProfile: "senior_photographer",
      jobFunctionProfiles: ["senior_photographer"],
      permissions: [...fieldEmployee.permissions, "attendance.read", "alerts.read"]
    };

    expect(shouldLimitToEmployeeWorksurface(fieldEmployee)).toBe(true);
    expect(shouldLimitToEmployeeWorksurface(fieldLead)).toBe(false);
  });

  it("maps business roles from authority and job function without requiring a data migration", () => {
    const productionUser = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "graphic_artist",
      jobFunctionProfiles: ["graphic_artist"],
      roles: ["production"]
    };
    const salesUser = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "account_executive",
      jobFunctionProfiles: ["account_executive"],
      roles: ["sales"]
    };

    expect(getBusinessRoles(productionUser)).toContain("production_staff");
    expect(getBusinessRoles(salesUser)).toContain("sales_growth_staff");
  });

  it("keeps directory management available to leadership without opening it for field staff", () => {
    const fieldEmployee = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "associate_photographer",
      jobFunctionProfiles: ["associate_photographer"],
      permissions: ["shoot.read", "shoot_locations.view"],
      roles: ["photographer"]
    };

    expect(canManageCanonicalDirectoryRecords(baseUser)).toBe(true);
    expect(canManageCanonicalDirectoryRecords(fieldEmployee)).toBe(false);
  });

  it("hardens schools hub access into schools-manage, related read-only, and assigned-only scopes", () => {
    const sportsOffice = {
      ...baseUser,
      department: "sports",
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "sports_client_success",
      jobFunctionProfiles: ["sports_client_success"],
      roles: ["office_employee"]
    };
    const fieldEmployee = {
      ...baseUser,
      department: "schools",
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "associate_photographer",
      jobFunctionProfiles: ["associate_photographer"],
      roles: ["photographer"],
      permissions: ["schedule.read", "time.clock"]
    };

    expect(canManageSchoolsHub(baseUser)).toBe(true);
    expect(getSchoolsHubAccessScope(baseUser)).toBe("all");
    expect(canManageSchoolsHub(sportsOffice)).toBe(false);
    expect(getSchoolsHubAccessScope(sportsOffice)).toBe("all");
    expect(canManageSchoolsHub(fieldEmployee)).toBe(false);
    expect(getSchoolsHubAccessScope(fieldEmployee)).toBe("own");
  });

  it("keeps school foundation editing with schools leadership instead of every directory editor", () => {
    const directoryEditor = {
      ...baseUser,
      department: "office",
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "customer_service_rep",
      jobFunctionProfiles: ["customer_service_rep"],
      roles: ["office_employee"],
      permissions: ["directory_accounts.manage"]
    };

    expect(canManageCanonicalDirectoryRecords(directoryEditor)).toBe(true);
    expect(canManageSchoolFoundation(directoryEditor)).toBe(false);
    expect(canManageSchoolFoundation(baseUser)).toBe(true);
  });

  it("protects sensitive routes while keeping settings reachable", () => {
    const fieldEmployee = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "associate_photographer",
      jobFunctionProfiles: ["associate_photographer"],
      permissions: ["schedule.read", "time.clock", "trade.request", "shoot_locations.view"],
      effectiveScopes: ["self_only"]
    };
    const adminUser: SessionUser = {
      ...baseUser,
      authorityTier: "super_admin",
      capabilityOverlays: ["Finance"],
      authorizationFlags: {
        financeSensitiveAccess: true,
        communicationsModeration: false,
        userAccessAdministration: true,
        securityAdministration: true
      },
      primaryJobFunctionProfile: "leadership_team_member",
      jobFunctionProfiles: ["leadership_team_member"],
      roles: ["admin"],
      permissions: [
        "access.manage",
        "security.manage",
        "audit.read",
        "labor.read",
        "profitability.read",
        "outlook.manage",
        "system.diagnostics.read",
        "system.audit.read",
        "system.trace.read",
        "system.repairs.manage",
        "system.policy_trace.read",
        "system.import_audit.read",
        "system.export_audit.read"
      ]
    };

    expect(canAccessRoute(fieldEmployee, "admin")).toBe(false);
    expect(canAccessRoute(fieldEmployee, "admin-settings")).toBe(false);
    expect(canAccessRoute(fieldEmployee, "account")).toBe(true);
    expect(canAccessRoute(fieldEmployee, "admin-review-tools")).toBe(false);
    expect(canAccessRoute(fieldEmployee, "business-health-profitability")).toBe(false);
    expect(canAccessRoute(fieldEmployee, "admin-system")).toBe(false);
    expect(canAccessRoute(fieldEmployee, "admin-system-trace")).toBe(false);
    expect(canAccessRoute(fieldEmployee, "dashboard-my-day")).toBe(true);
    expect(canAccessStudiosWorkspace(fieldEmployee)).toBe(true);
    expect(canAccessRoute(fieldEmployee, "jobs")).toBe(true);
    expect(canAccessRoute(fieldEmployee, "job-new")).toBe(false);
    expect(canAccessRoute(fieldEmployee, "project-tracking")).toBe(false);
    expect(canAccessRoute(fieldEmployee, "workflow-template-builder")).toBe(false);
    expect(canAccessRoute(fieldEmployee, "client-command-center")).toBe(false);
    expect(canAccessRoute(fieldEmployee, "operations-exceptions")).toBe(false);
    expect(canAccessRoute(fieldEmployee, "urgent-window")).toBe(false);
    expect(canAccessRoute(fieldEmployee, "exceptions")).toBe(false);
    expect(canAccessRoute(fieldEmployee, "executive")).toBe(false);
    expect(canAccessRoute(fieldEmployee, "operations-scheduling")).toBe(false);
    expect(canAccessRoute(fieldEmployee, "operations-schedule")).toBe(true);
    expect(canAccessRoute(adminUser, "admin")).toBe(true);
    expect(canAccessRoute(adminUser, "admin-audit")).toBe(true);
    expect(canAccessRoute(adminUser, "admin-review-tools")).toBe(true);
    expect(canAccessRoute(adminUser, "admin-system")).toBe(true);
    expect(canAccessRoute(adminUser, "admin-system-diagnostics")).toBe(true);
    expect(canAccessRoute(adminUser, "admin-system-audit-log")).toBe(true);
    expect(canAccessRoute(adminUser, "admin-system-sync")).toBe(true);
    expect(canAccessRoute(adminUser, "admin-system-repairs")).toBe(true);
    expect(canAccessRoute(adminUser, "admin-system-access-debug")).toBe(true);
    expect(canAccessRoute(adminUser, "admin-system-imports")).toBe(true);
    expect(canAccessRoute(adminUser, "admin-system-exports")).toBe(true);
    expect(canAccessRoute(adminUser, "admin-system-trace")).toBe(true);
    expect(canAccessRoute(adminUser, "account")).toBe(true);
    expect(canAccessRoute(adminUser, "jobs")).toBe(true);
    expect(canAccessRoute(adminUser, "project-tracking")).toBe(true);
    expect(canAccessRoute(adminUser, "workflow-template-builder")).toBe(true);
    expect(canAccessRoute(adminUser, "client-command-center")).toBe(true);
    expect(canAccessRoute(adminUser, "job-new")).toBe(true);
    expect(canAccessRoute(adminUser, "schools-jobs")).toBe(true);
    expect(canAccessRoute(adminUser, "schools-job-new")).toBe(true);
    expect(canAccessRoute(adminUser, "schools-tasks")).toBe(true);
    expect(canAccessRoute(adminUser, "schools-exceptions")).toBe(true);
    expect(canAccessRoute(adminUser, "sports-shoots")).toBe(true);
    expect(canAccessRoute(adminUser, "sports-shoot-new")).toBe(true);
    expect(canAccessRoute(adminUser, "sports-graphics")).toBe(true);
    expect(canAccessRoute(adminUser, "exceptions")).toBe(true);
    expect(canAccessRoute(adminUser, "executive")).toBe(true);
    expect(canAccessRoute(adminUser, "operations-today")).toBe(true);
    expect(canAccessRoute(adminUser, "operations-exceptions")).toBe(true);
    expect(canAccessRoute(adminUser, "operations-scheduling")).toBe(true);
  });

  it("exposes project tracking through backend-derived workflow permissions only", () => {
    const workflowStaff = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "graphic_artist",
      jobFunctionProfiles: ["graphic_artist"],
      permissions: ["workflow.read", "workflow.step.execute"],
      roles: ["production"]
    };
    const unrelatedStaff = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "customer_service_rep",
      jobFunctionProfiles: ["customer_service_rep"],
      permissions: ["dashboard.read"],
      roles: ["office_employee"]
    };

    expect(canAccessProjectTracking(workflowStaff)).toBe(true);
    expect(canAccessRoute(workflowStaff, "project-tracking")).toBe(true);
    expect(canAccessProjectTracking(unrelatedStaff)).toBe(false);
    expect(canAccessRoute(unrelatedStaff, "project-tracking")).toBe(false);
  });

  it("keeps Workflow Template Builder leadership-only", () => {
    const workflowStaff = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "graphic_artist",
      jobFunctionProfiles: ["graphic_artist"],
      permissions: ["workflow.read", "workflow.step.execute"],
      roles: ["production"]
    };
    const templateManager = {
      ...workflowStaff,
      permissions: [...workflowStaff.permissions, "workflow.template.manage"]
    };
    const director = {
      ...workflowStaff,
      authorityTier: "director_admin"
    };

    expect(canAccessProjectTracking(workflowStaff)).toBe(true);
    expect(canManageWorkflowTemplates(workflowStaff)).toBe(false);
    expect(canAccessRoute(workflowStaff, "workflow-template-builder")).toBe(false);
    expect(canManageWorkflowTemplates(templateManager)).toBe(true);
    expect(canAccessRoute(templateManager, "workflow-template-builder")).toBe(true);
    expect(canManageWorkflowTemplates(director)).toBe(true);
    expect(canAccessRoute(director, "workflow-template-builder")).toBe(true);
  });

  it("exposes Client Command Center through backend-derived client and directory access only", () => {
    const clientStaff = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "customer_service_rep",
      jobFunctionProfiles: ["customer_service_rep"],
      permissions: ["client_command_center.read"],
      roles: ["office_employee"]
    };
    const directoryStaff = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "schools_client_success",
      jobFunctionProfiles: ["schools_client_success"],
      permissions: ["directory.read"],
      roles: ["office_employee"]
    };
    const fieldEmployee = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "associate_photographer",
      jobFunctionProfiles: ["associate_photographer"],
      permissions: ["schedule.read", "time.clock"],
      roles: ["photographer"]
    };

    expect(canAccessClientCommandCenter(clientStaff)).toBe(true);
    expect(canAccessRoute(clientStaff, "client-command-center")).toBe(true);
    expect(canAccessClientCommandCenter(directoryStaff)).toBe(true);
    expect(canAccessRoute(directoryStaff, "client-command-center")).toBe(true);
    expect(canAccessClientCommandCenter(fieldEmployee)).toBe(false);
    expect(canAccessRoute(fieldEmployee, "client-command-center")).toBe(false);
  });

  it("keeps Dashboard as the default landing for the main role-aware experience", () => {
    const productionUser = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "graphic_artist",
      jobFunctionProfiles: ["graphic_artist"],
      roles: ["production"],
      permissions: ["projects.read"]
    };
    const salesUser = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "account_executive",
      jobFunctionProfiles: ["account_executive"],
      roles: ["sales"],
      permissions: ["sales_pipeline.view"]
    };

    expect(getDefaultLandingRoute(productionUser)).toBe("dashboard");
    expect(getDefaultLandingRoute(salesUser)).toBe("dashboard");
  });

  it("maps the new operating-system role templates and scope levels cleanly", () => {
    const operationsLead = {
      ...baseUser,
      authorityTier: "supervisor",
      primaryJobFunctionProfile: "senior_photographer",
      jobFunctionProfiles: ["senior_photographer"],
      roles: ["senior_photographer"],
      permissions: ["shoot.read", "schedule.read", "attendance.read"]
    };
    const schedulingLead = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "schools_client_success",
      jobFunctionProfiles: ["schools_client_success"],
      roles: ["office_employee"],
      permissions: ["dashboard.read", "schedule.read", "schedule.manage"]
    };
    const productionManager = {
      ...baseUser,
      department: "production",
      authorityTier: "supervisor",
      primaryJobFunctionProfile: "director_of_digital_production",
      jobFunctionProfiles: ["director_of_digital_production"],
      roles: ["production"]
    };
    const fieldEmployee = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "associate_photographer",
      jobFunctionProfiles: ["associate_photographer"],
      roles: ["photographer"],
      permissions: ["dashboard.read", "schedule.read", "time.clock", "trade.request"]
    };

    expect(getOperatingSystemRoleTemplate(operationsLead)).toBe("operations_lead");
    expect(getOperatingSystemRoleTemplate(schedulingLead)).toBe("scheduling_lead");
    expect(getOperatingSystemRoleTemplate(productionManager)).toBe("production_manager");
    expect(getOperatingSystemRoleTemplate(fieldEmployee)).toBe("standard_employee");

    expect(getOperatingSystemScope(schedulingLead, "scheduling")).toBe("department");
    expect(canAccessOperatingSystemModule(fieldEmployee, "schedule")).toBe(true);
    expect(canAccessOperatingSystemModule(fieldEmployee, "operations")).toBe(false);
    expect(canManageOperatingSystemModule(schedulingLead, "scheduling")).toBe(true);
    expect(canManageOperatingSystemModule(fieldEmployee, "approvals")).toBe(false);
  });

  it("keeps access settings and profitability behind explicit shared permissions while preserving leadership exception access", () => {
    const leadershipWithoutSharedAccess = {
      ...baseUser,
      authorityTier: "leadership",
      primaryJobFunctionProfile: "leadership_team_member",
      jobFunctionProfiles: ["leadership_team_member"],
      roles: ["leadership"],
      permissions: ["dashboard.read", "report.read_global"]
    };
    const leadershipWithSharedAccess: SessionUser = {
      ...leadershipWithoutSharedAccess,
      capabilityOverlays: ["Finance"],
      authorizationFlags: {
        financeSensitiveAccess: true,
        communicationsModeration: false,
        userAccessAdministration: false,
        securityAdministration: false
      },
      permissions: [
        "dashboard.read",
        "report.read_global",
        "settings.permissions.read",
        "profitability.read",
        "production.read"
      ]
    };

    expect(canViewAccessDirectory(leadershipWithoutSharedAccess)).toBe(false);
    expect(canViewProfitabilityLeadership(leadershipWithoutSharedAccess)).toBe(false);
    expect(canAccessGraphicsWorkspace(leadershipWithoutSharedAccess)).toBe(false);
    expect(canAccessSharedExceptions(leadershipWithoutSharedAccess)).toBe(true);

    expect(canViewAccessDirectory(leadershipWithSharedAccess)).toBe(true);
    expect(canViewProfitabilityLeadership(leadershipWithSharedAccess)).toBe(true);
    expect(canAccessGraphicsWorkspace(leadershipWithSharedAccess)).toBe(true);
    expect(canAccessSharedExceptions(leadershipWithSharedAccess)).toBe(true);
  });

  it("keeps deprecated workspace wrappers as compatibility aliases only", () => {
    const graphicsUser = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "graphic_artist",
      jobFunctionProfiles: ["graphic_artist"],
      roles: ["production"],
      permissions: ["production.read"]
    };
    const studiosUser = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "associate_photographer",
      jobFunctionProfiles: ["associate_photographer"],
      roles: ["photographer"],
      permissions: ["schedule.read", "time.clock"]
    };
    const exceptionsUser = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "customer_service_rep",
      jobFunctionProfiles: ["customer_service_rep"],
      roles: ["office_employee"],
      permissions: ["watchlist.read"]
    };

    expect(canAccessProductionProjects(graphicsUser)).toBe(canAccessGraphicsWorkspace(graphicsUser));
    expect(canAccessPhotographyWorkspace(studiosUser)).toBe(canAccessStudiosWorkspace(studiosUser));
    expect(canAccessSharedWatchlist(exceptionsUser)).toBe(canAccessSharedExceptions(exceptionsUser));
  });

  it("keeps canonical task-shell access compatible with legacy photography and production policy scopes", () => {
    const legacyTaskOperator = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "customer_service_rep",
      jobFunctionProfiles: ["customer_service_rep"],
      roles: ["office_employee"],
      permissions: [],
      policyGrants: [
        {
          permissionKey: "task.read",
          scopeType: "department",
          scopeValue: "production",
          effect: "allow" as const,
          source: "role" as const,
          roleKey: "graphics_legacy",
          delegationId: null,
          startsAt: null,
          endsAt: null
        },
        {
          permissionKey: "task.create",
          scopeType: "department",
          scopeValue: "photography",
          effect: "allow" as const,
          source: "role" as const,
          roleKey: "studios_legacy",
          delegationId: null,
          startsAt: null,
          endsAt: null
        }
      ]
    };

    expect(canAccessSharedTasksShell(legacyTaskOperator)).toBe(true);
    expect(canManageSharedTasksShell(legacyTaskOperator)).toBe(true);
  });

  it("uses shared policy grants for operational action guards without scattering role checks", () => {
    const schoolsCoordinator = {
      ...baseUser,
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "schools_client_success",
      jobFunctionProfiles: ["schools_client_success"],
      roles: ["office_employee"],
      permissions: [],
      policyGrants: [
        {
          permissionKey: "job.assign_staff",
          scopeType: "department",
          scopeValue: "schools",
          effect: "allow" as const,
          source: "role" as const,
          roleKey: "schools",
          delegationId: null,
          startsAt: null,
          endsAt: null
        },
        {
          permissionKey: "job.status.change",
          scopeType: "department",
          scopeValue: "schools",
          effect: "allow" as const,
          source: "role" as const,
          roleKey: "schools",
          delegationId: null,
          startsAt: null,
          endsAt: null
        },
        {
          permissionKey: "task.status.change",
          scopeType: "department",
          scopeValue: "schools",
          effect: "allow" as const,
          source: "role" as const,
          roleKey: "schools",
          delegationId: null,
          startsAt: null,
          endsAt: null
        },
        {
          permissionKey: "production.status.change",
          scopeType: "department",
          scopeValue: "schools",
          effect: "allow" as const,
          source: "role" as const,
          roleKey: "schools",
          delegationId: null,
          startsAt: null,
          endsAt: null
        },
        {
          permissionKey: "exception.approve",
          scopeType: "department",
          scopeValue: "schools",
          effect: "allow" as const,
          source: "role" as const,
          roleKey: "schools",
          delegationId: null,
          startsAt: null,
          endsAt: null
        }
      ]
    };

    expect(canAssignStaffingRecords(schoolsCoordinator, "schools")).toBe(true);
    expect(canAssignStaffingRecords(schoolsCoordinator, "sports")).toBe(false);
    expect(canChangeSharedJobStatus(schoolsCoordinator, "schools")).toBe(true);
    expect(canChangeSharedJobStatus(schoolsCoordinator, "sports")).toBe(false);
    expect(canChangeSharedTaskStatus(schoolsCoordinator, "schools")).toBe(true);
    expect(canChangeProductionStatus(schoolsCoordinator, "schools")).toBe(true);
    expect(canApproveOperationalExceptions(schoolsCoordinator, "schools")).toBe(true);
    expect(canApproveOperationalExceptions(schoolsCoordinator, "sports")).toBe(false);
  });

  it("uses internal role groups for privileged admin and sensitive-data visibility", () => {
    const systemAdmin = {
      ...baseUser,
      authorityTier: "standard_employee",
      permissions: [],
      internalRoleGroups: ["system_admin", "leadership"]
    };
    const standardEmployee = {
      ...baseUser,
      authorityTier: "standard_employee",
      permissions: [],
      internalRoleGroups: []
    };

    expect(canConfigureSystemBehavior(systemAdmin)).toBe(true);
    expect(canViewAccessDirectory(systemAdmin)).toBe(true);
    expect(canViewSensitiveNotes(systemAdmin)).toBe(true);
    expect(canViewSensitiveEvaluations(systemAdmin)).toBe(true);

    expect(canConfigureSystemBehavior(standardEmployee)).toBe(false);
    expect(canViewSensitiveNotes(standardEmployee)).toBe(false);
    expect(canViewSensitiveEvaluations(standardEmployee)).toBe(false);
  });

  it("exposes Communications only for users with governed communication access", () => {
    const communicationsUser = {
      ...baseUser,
      permissions: ["communication.use"],
      communicationIdentity: {
        provider: "microsoft_teams" as const,
        microsoftUserId: "ms-user-1",
        microsoftTenantId: "ms-tenant-1",
        communicationEnabled: true,
        teamsChatDefaultTarget: null,
        linkedAt: "2026-04-03T12:00:00.000Z",
        lastVerifiedAt: "2026-04-03T12:00:00.000Z",
        status: "linked_ready" as const
      }
    };
    const unrelatedEmployee = {
      ...baseUser,
      authorityTier: "standard_employee" as const,
      primaryJobFunctionProfile: "associate_photographer" as const,
      jobFunctionProfiles: ["associate_photographer" as const],
      permissions: ["dashboard.read"]
    };

    expect(canAccessTeamsCommunicationSurface(communicationsUser)).toBe(true);
    expect(canAccessRoute(communicationsUser, "communications")).toBe(true);
    expect(canAccessRoute(communicationsUser, "teams-communications")).toBe(true);
    expect(canAccessTeamsCommunicationSurface(unrelatedEmployee)).toBe(true);
    expect(canAccessRoute(unrelatedEmployee, "communications")).toBe(true);
  });
});
