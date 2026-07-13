// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEMO_WORKFLOW_CHANGE_NOTICES,
  WorkflowChangeNoticePanel,
  buildHomeUrgentItemsFromWorkflowChangeNotices,
  getWorkflowChangeNoticesForUser,
  type WorkflowChangeNotice
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

// A locally-constructed notice keeps the PANEL behavior covered without any
// fabricated operational data shipping in the app bundle.
const testNotice: WorkflowChangeNotice = {
  id: "test-location-change",
  level: "urgent",
  changeKind: "location",
  changeLabel: "Location changed",
  title: "Location changed: Test Media Day",
  summary: "The shoot moved to the backup gym.",
  jobTitle: "Test Media Day",
  department: "schools",
  updatedBy: "Test Coordinator",
  updatedAt: "2026-07-13T14:00:00.000Z",
  audienceLabel: "Assigned photographers",
  audienceUserIds: ["user-photo"],
  audienceDepartments: ["schools"],
  affectedTeams: ["Photography"],
  actionNeeded: "Confirm you saw the new location before call time.",
  actionLabel: "Open schedule",
  actionHash: "#my-work",
  requiresAcknowledgement: true,
  surfaces: ["my-work"]
};

describe("workflow change notices", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("ships ZERO fabricated notices — the demo array is empty by contract (MC-AUDIT-003/015)", () => {
    expect(DEMO_WORKFLOW_CHANGE_NOTICES).toEqual([]);
    expect(getWorkflowChangeNoticesForUser(userPhoto, { includeAcknowledged: true })).toEqual([]);
    expect(buildHomeUrgentItemsFromWorkflowChangeNotices(DEMO_WORKFLOW_CHANGE_NOTICES)).toEqual([]);
  });

  it("renders nothing (not an empty shell) when there are no notices", () => {
    const { container } = render(<WorkflowChangeNoticePanel notices={[]} title="Test Change Notices" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a real notice with plain operational language when one is provided", () => {
    render(<WorkflowChangeNoticePanel notices={[testNotice]} title="Test Change Notices" />);

    expect(screen.getByRole("heading", { name: "Test Change Notices" })).toBeInTheDocument();
    expect(screen.getByText("Location changed: Test Media Day")).toBeInTheDocument();
    expect(screen.getByText("Who needs to know:")).toBeInTheDocument();
    expect(screen.getByText("Next action:")).toBeInTheDocument();
    expect(screen.queryByText(/push pipeline|entity watcher|notification contract|mutation event/i)).not.toBeInTheDocument();
  });

  it("keeps urgent acknowledgement local and visible", () => {
    render(<WorkflowChangeNoticePanel notices={[testNotice]} title="Test Change Notices" />);

    const acknowledgeButton = screen.getByRole("button", { name: "Acknowledge" });
    fireEvent.click(acknowledgeButton);

    expect(screen.getByRole("button", { name: "Acknowledged" })).toBeDisabled();
  });
});
