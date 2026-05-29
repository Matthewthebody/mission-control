import { describe, expect, it } from "vitest";
import {
  buildEmployeesWorkspaceSummaryStrip,
  canViewEmployeesWorkspace,
  getEmployeesWorkspaceRoleMode
} from "../src/services/employeesWorkspace.js";

describe("employees workspace helpers", () => {
  it("builds a role-aware summary strip without pretending Employees is an operations page", () => {
    const employeeCards = buildEmployeesWorkspaceSummaryStrip({
      roleMode: "employee",
      requestActionCount: 2,
      approvalActionCount: 0,
      openTimeReviewCount: 1,
      trainingDueCount: 3,
      signoffDueCount: 0,
      availabilityConflictCount: 1,
      timeStatusLabel: "Punch In Needed. 1 time review item is open."
    });

    const managerCards = buildEmployeesWorkspaceSummaryStrip({
      roleMode: "manager",
      requestActionCount: 5,
      approvalActionCount: 4,
      openTimeReviewCount: 2,
      trainingDueCount: 6,
      signoffDueCount: 2,
      availabilityConflictCount: 3,
      timeStatusLabel: "Punched In. 2 time review items are open."
    });

    expect(employeeCards[0]).toMatchObject({
      id: "requests_awaiting_action",
      label: "My Requests",
      count: 2,
      action_hash: "#employees/requests"
    });
    expect(employeeCards.find((card) => card.id === "time_review_status")?.detail).toContain("Punch In Needed");
    expect(managerCards[0]).toMatchObject({
      id: "requests_awaiting_action",
      label: "Requests Awaiting Action",
      count: 5
    });
    expect(managerCards.find((card) => card.id === "approvals_awaiting_me")?.count).toBe(4);
  });

  it("separates employee, manager, and admin role modes from the real auth profile", () => {
    expect(
      getEmployeesWorkspaceRoleMode({
        authorityTier: "standard_employee",
        permissions: ["schedule.read", "time.clock"]
      } as any)
    ).toBe("employee");

    expect(
      getEmployeesWorkspaceRoleMode({
        authorityTier: "supervisor",
        permissions: ["schedule.read", "pto.approve"]
      } as any)
    ).toBe("manager");

    expect(
      getEmployeesWorkspaceRoleMode({
        authorityTier: "leadership",
        permissions: ["reports.view", "labor.read"]
      } as any)
    ).toBe("admin");
  });

  it("does not open the Employees workspace for unrelated active users without any people-facing capability", () => {
    expect(
      canViewEmployeesWorkspace({
        status: "active",
        authorityTier: "standard_employee",
        permissions: ["media.attach"]
      } as any)
    ).toBe(false);

    expect(
      canViewEmployeesWorkspace({
        status: "active",
        authorityTier: "standard_employee",
        permissions: ["training.view"]
      } as any)
    ).toBe(true);
  });
});
