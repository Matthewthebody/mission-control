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
    expect(screen.getByText("FYI")).toBeInTheDocument();
    expect(screen.getByText("Important")).toBeInTheDocument();
    expect(screen.getByText("Urgent")).toBeInTheDocument();
    expect(screen.getAllByText("Who needs to know:").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Next action:").length).toBeGreaterThan(0);
    expect(screen.queryByText(/push pipeline|entity watcher|notification contract|mutation event/i)).not.toBeInTheDocument();
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

    expect(homeItems).toHaveLength(1);
    expect(homeItems[0]).toMatchObject({
      title: "Location changed: Maple Grove Baseball Media Day",
      urgency_label: "Urgent",
      action_hash: "#studios/travel?job=job-sports-1"
    });
  });
});
