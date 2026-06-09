// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEMO_WORKFLOW_CHANGE_NOTICES,
  WorkflowChangeNoticePanel,
  buildHomeUrgentItemsFromWorkflowChangeNotices,
  getWorkflowChangeNoticesForUser
} from "../workflowChangeNotices";
import type { SessionUser } from "../types";

const userPhoto: SessionUser = {
  id: "user-photo",
  tenantId: "tenant-demo",
  accountId: "account-photo",
  sessionId: "session-photo",
  email: "photo@example.com",
  fullName: "Demo Photographer",
  status: "active",
  department: "schools",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["photographer"],
  permissions: ["notification.read", "shoot.read"],
  authorityTier: "standard_employee",
  primaryJobFunctionProfile: "seasonal_photographer",
  jobFunctionProfiles: ["seasonal_photographer"],
  permissionGrants: [],
  effectiveScopes: ["own_shift_only"],
  sessionTrust: {
    identityProvider: "local_password",
    sessionAssurance: "standard",
    requestTransport: "bearer",
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
  }
};

describe("workflow change notices", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("renders FYI, Important, and Urgent notices without fake push language", () => {
    render(<WorkflowChangeNoticePanel notices={DEMO_WORKFLOW_CHANGE_NOTICES} title="Test Change Notices" />);

    expect(screen.getByRole("heading", { name: "Test Change Notices" })).toBeInTheDocument();
    expect(screen.getAllByText("FYI").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Important").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Urgent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Who needs to know:").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Next action:").length).toBeGreaterThan(0);
    expect(screen.queryByText(/push pipeline|entity watcher|notification contract|mutation event/i)).not.toBeInTheDocument();
  });

  it("covers the core demo change notice examples with plain operational language", () => {
    const labels = DEMO_WORKFLOW_CHANGE_NOTICES.map((notice) => notice.changeLabel);
    expect(labels).toEqual(
      expect.arrayContaining([
        "Shoot date changed",
        "Call time changed",
        "Location changed",
        "Roster received",
        "Roster still missing",
        "Priority changed",
        "Blocker added",
        "Blocker resolved",
        "Job launched",
        "Gallery deadline changed",
        "Shoot manager assigned",
        "Shoot manager still needed"
      ])
    );
    expect(DEMO_WORKFLOW_CHANGE_NOTICES.some((notice) => notice.requiresAcknowledgement && notice.level === "urgent")).toBe(true);
    expect(DEMO_WORKFLOW_CHANGE_NOTICES.every((notice) => notice.actionNeeded && notice.audienceLabel)).toBe(true);
  });

  it("keeps urgent acknowledgement local and visible", () => {
    render(<WorkflowChangeNoticePanel notices={[DEMO_WORKFLOW_CHANGE_NOTICES[0]]} title="Test Change Notices" />);

    expect(screen.getByText("Location changed: Maple Grove Baseball Media Day")).toBeInTheDocument();
    const acknowledgeButton = screen.getByRole("button", { name: "Acknowledge" });
    fireEvent.click(acknowledgeButton);

    expect(screen.getByRole("button", { name: "Acknowledged" })).toBeDisabled();
  });

  it("targets affected users without blasting unrelated employees", () => {
    expect(getWorkflowChangeNoticesForUser(userPhoto).map((notice) => notice.id)).toContain("maple-grove-location-change");
    expect(getWorkflowChangeNoticesForUser({ ...userPhoto, id: "employee-1", department: "operations" })).toHaveLength(0);
  });

  it("converts unacknowledged urgent notices into Home urgent issue items", () => {
    const homeItems = buildHomeUrgentItemsFromWorkflowChangeNotices(getWorkflowChangeNoticesForUser(userPhoto));

    expect(homeItems.length).toBeGreaterThanOrEqual(3);
    expect(homeItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
      title: "Location changed: Maple Grove Baseball Media Day",
      urgency_label: "Urgent",
      action_hash: "#studios/travel?job=job-sports-1"
      }),
      expect.objectContaining({
        title: "Roster still missing: Lakeview Elementary Picture Day",
        urgency_label: "Urgent"
      }),
      expect.objectContaining({
        title: "Blocker added: assistant coverage missing",
        urgency_label: "Urgent"
      })
    ]));
  });
});
