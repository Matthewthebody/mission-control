import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Gear } from "../pages/Gear";
import type {
  GearAssetDetailView,
  GearAssetListResponse,
  GearDashboardView,
  GearKitDetailView,
  GearKitListResponse,
  GearMonthlyReportView
} from "../gearTypes";
import type { SessionUser } from "../types";

const apiFetchMock = vi.fn();

vi.mock("../api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  apiUrl: "http://localhost:4000"
}));

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

const leadershipUser: SessionUser = {
  id: "user-leadership",
  tenantId: "tenant-demo",
  accountId: "account-leadership",
  sessionId: "session-demo",
  email: "leadership@example.com",
  fullName: "Demo Leadership",
  status: "active",
  department: "operations",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["leadership"],
  permissions: ["gear_assets.view", "gear_assets.edit", "gear_kits.view", "gear_kits.edit", "gear_custody.view"],
  authorityTier: "leadership",
  primaryJobFunctionProfile: "leadership_team_member",
  jobFunctionProfiles: ["leadership_team_member"],
  permissionGrants: [],
  effectiveScopes: ["organization_wide_scope"],
  sessionTrust: standardSessionTrust
};

const photographerUser: SessionUser = {
  ...leadershipUser,
  id: "user-photo",
  email: "photo@example.com",
  fullName: "Demo Photographer",
  roles: ["photographer"],
  permissions: ["shoot.read"],
  authorityTier: "standard_employee",
  primaryJobFunctionProfile: "associate_photographer",
  jobFunctionProfiles: ["associate_photographer"]
};

const dashboardResponse: GearDashboardView = {
  summary: {
    total_assets: 8,
    total_kits: 1,
    available: 1,
    assigned: 1,
    checked_out: 4,
    in_office: 1,
    in_transit: 1,
    needs_repair: 1,
    under_repair: 0,
    missing: 1,
    overdue_returns: 1,
    recently_returned: 1,
    tile_tracker_attention: 4
  },
  checked_out_now: [
    {
      target_type: "kit",
      target_id: "kit-1",
      label: "Phase 2 Candid Media Kit",
      status: "checked_out",
      current_custodian_name: "Demo Photographer",
      last_seen_with_name: "Demo Leadership",
      linked_shoot_title: "Spring Portrait Day",
      expected_return_at: "2026-03-27T22:00:00.000Z",
      note: "Checked out for candid coverage."
    },
    {
      target_type: "asset",
      target_id: "asset-2",
      label: "Phase 2 Audio Mixer",
      status: "checked_out",
      current_custodian_name: "Demo Photographer",
      last_seen_with_name: "Demo Leadership",
      linked_shoot_title: "Spring Portrait Day",
      expected_return_at: "2026-03-26T22:00:00.000Z",
      note: "Still out from the prior event and now overdue."
    }
  ],
  repair_queue: [
    {
      target_type: "asset",
      target_id: "asset-3",
      label: "Phase 2 Lighting Stand",
      status: "needs_repair",
      current_custodian_name: null,
      last_seen_with_name: "Demo Photographer",
      linked_shoot_title: null,
      expected_return_at: null,
      note: "Clamp is bent and needs service review."
    }
  ],
  missing_gear: [
    {
      target_type: "asset",
      target_id: "asset-4",
      label: "Phase 2 70-200 Lens",
      status: "missing",
      current_custodian_name: null,
      last_seen_with_name: "Demo Photographer",
      linked_shoot_title: null,
      expected_return_at: null,
      note: "Missing after recent field use and needs immediate follow-up."
    }
  ],
  overdue_returns: [
    {
      target_type: "asset",
      target_id: "asset-2",
      label: "Phase 2 Audio Mixer",
      status: "checked_out",
      current_custodian_name: "Demo Photographer",
      last_seen_with_name: "Demo Leadership",
      linked_shoot_title: "Spring Portrait Day",
      expected_return_at: "2026-03-26T22:00:00.000Z",
      note: "Still out from the prior event and now overdue."
    }
  ],
  recently_returned: [
    {
      target_type: "kit",
      target_id: "kit-1",
      label: "Phase 2 Candid Media Kit",
      status: "in_office",
      current_custodian_name: "Demo Photographer",
      last_seen_with_name: "Demo Leadership",
      linked_shoot_title: "Spring Portrait Day",
      expected_return_at: null,
      event_at: "2026-03-27T23:00:00.000Z",
      note: "Returned and logged back into inventory."
    }
  ],
  tile_attention: [
    {
      target_type: "kit",
      target_id: "kit-1",
      label: "Phase 2 Candid Media Kit",
      status: "checked_out",
      current_custodian_name: "Demo Photographer",
      last_seen_with_name: "Demo Leadership",
      linked_shoot_title: "Spring Portrait Day",
      expected_return_at: "2026-03-27T22:00:00.000Z",
      note: "Tile tracker link is missing for this Kit."
    }
  ]
};

const assetListResponse: GearAssetListResponse = {
  assets: [
    {
      id: "asset-2",
      internal_asset_id: "GEAR-P2-AUDIO",
      asset_name: "Phase 2 Audio Mixer",
      category: "audio",
      manufacturer: "Zoom",
      model: "PodTrak P4",
      serial_number: "AUDIO-123",
      qr_code_id: "ASSET-QR-AUDIO",
      tile_tracker_id: "TILE-AUDIO",
      tile_tracker_active: true,
      status: "checked_out",
      home_location_id: "home-1",
      home_location_name: "Studio Cage",
      current_kit_id: null,
      current_kit_name: null,
      current_custodian_id: "user-photo",
      current_custodian_name: "Demo Photographer",
      last_seen_with_user_id: "user-leadership",
      last_seen_with_name: "Demo Leadership",
      active_checkout_id: "checkout-asset",
      active_checkout_status: "checked_out",
      linked_shoot_id: "shoot-1",
      linked_shoot_title: "Spring Portrait Day",
      expected_return_at: "2026-03-26T22:00:00.000Z",
      overdue_return: true,
      open_service_count: 0,
      notes: "Standalone audio asset for event coverage.",
      active_status: true,
      created_at: "2026-03-27T12:00:00.000Z",
      updated_at: "2026-03-27T12:00:00.000Z"
    },
    {
      id: "asset-3",
      internal_asset_id: "GEAR-P2-REPAIR",
      asset_name: "Phase 2 Lighting Stand",
      category: "lighting",
      manufacturer: "Manfrotto",
      model: "Nano Stand",
      serial_number: "REPAIR-123",
      qr_code_id: "ASSET-QR-REPAIR",
      tile_tracker_id: null,
      tile_tracker_active: null,
      status: "needs_repair",
      home_location_id: "home-1",
      home_location_name: "Studio Cage",
      current_kit_id: null,
      current_kit_name: null,
      current_custodian_id: null,
      current_custodian_name: null,
      last_seen_with_user_id: "user-photo",
      last_seen_with_name: "Demo Photographer",
      active_checkout_id: null,
      active_checkout_status: null,
      linked_shoot_id: null,
      linked_shoot_title: null,
      expected_return_at: null,
      overdue_return: false,
      open_service_count: 1,
      notes: "Clamp is bent and needs service review.",
      active_status: true,
      created_at: "2026-03-27T12:00:00.000Z",
      updated_at: "2026-03-27T12:00:00.000Z"
    }
  ],
  filters: {
    categories: ["audio", "lighting"],
    custodians: [{ id: "user-photo", full_name: "Demo Photographer" }],
    home_locations: [{ id: "home-1", name: "Studio Cage" }],
    kits: [{ id: "kit-1", label: "Phase 2 Candid Media Kit" }]
  }
};

const assetDetailResponse: GearAssetDetailView = {
  asset: assetListResponse.assets[0],
  active_checkout: {
    id: "checkout-asset",
    status: "checked_out",
    checked_out_to_user_id: "user-photo",
    checked_out_to_user_name: "Demo Photographer",
    linked_shoot_id: "shoot-1",
    linked_shoot_title: "Spring Portrait Day",
    linked_location_id: "location-1",
    linked_location_name: "Main Gym",
    reserved_at: "2026-03-26T18:00:00.000Z",
    checked_out_at: "2026-03-26T18:30:00.000Z",
    expected_return_at: "2026-03-26T22:00:00.000Z",
    checkout_note: "Still out from the prior event and now overdue."
  },
  service_records: [
    {
      id: "repair-asset",
      issue_type: "broken",
      status: "open",
      reported_by_name: "Demo Leadership",
      opened_at: "2026-03-26T19:00:00.000Z",
      resolved_at: null,
      resolved_by_name: null,
      linked_shoot_id: "shoot-1",
      linked_shoot_title: "Spring Portrait Day",
      linked_location_name: "Main Gym",
      source_checkout_id: "checkout-asset",
      source_surface: "admin_web",
      note: "Audio output failed during pickup review.",
      updated_at: "2026-03-26T19:00:00.000Z"
    }
  ],
  temporary_substitutions: [
    {
      id: "sub-asset-1",
      original_asset_id: "asset-2",
      original_asset_name: "Phase 2 Audio Mixer",
      original_asset_internal_id: "GEAR-P2-AUDIO",
      substitute_asset_id: "asset-6",
      substitute_asset_name: "Phase 2 Backup Audio Mixer",
      substitute_asset_internal_id: "GEAR-P2-AUDIO-BACKUP",
      assigned_user_id: "user-photo",
      assigned_user_name: "Demo Photographer",
      linked_shoot_id: "shoot-1",
      linked_shoot_title: "Spring Portrait Day",
      linked_location_name: "Main Gym",
      substitute_checkout_id: "checkout-sub-1",
      status: "active",
      starts_at: "2026-03-26T19:15:00.000Z",
      ends_at: null,
      note: "Backup mixer issued after pickup issue.",
      created_by_name: "Demo Leadership",
      ended_by_name: null,
      created_at: "2026-03-26T19:15:00.000Z",
      updated_at: "2026-03-26T19:15:00.000Z"
    }
  ],
  custody_history: [
    {
      id: "custody-asset",
      event_type: "checked_out",
      timestamp: "2026-03-26T18:30:00.000Z",
      from_user_name: null,
      to_user_name: "Demo Photographer",
      linked_shoot_title: "Spring Portrait Day",
      linked_location_name: "Main Gym",
      note: "Checked out for field coverage.",
      created_by_name: "Demo Leadership"
    }
  ]
};

const kitListResponse: GearKitListResponse = {
  kits: [
    {
      id: "kit-1",
      kit_name: "Phase 2 Candid Media Kit",
      kit_type: "candid_media",
      internal_kit_id: "KIT-P2-001",
      qr_code_id: "KIT-QR-P2-001",
      tile_tracker_id: null,
      status: "checked_out",
      assigned_user_id: "user-photo",
      assigned_user_name: "Demo Photographer",
      assignment_started_at: "2026-02-25T12:00:00.000Z",
      assignment_note: "Standing Kit for candid coverage.",
      current_custodian_id: "user-photo",
      current_custodian_name: "Demo Photographer",
      last_seen_with_user_id: "user-leadership",
      last_seen_with_name: "Demo Leadership",
      home_location_id: "home-1",
      home_location_name: "Studio Cage",
      active_checkout_id: "checkout-kit",
      active_checkout_status: "checked_out",
      linked_shoot_id: "shoot-1",
      linked_shoot_title: "Spring Portrait Day",
      expected_return_at: "2026-03-27T22:00:00.000Z",
      overdue_return: false,
      open_service_count: 1,
      asset_count: 2,
      required_asset_count: 2,
      notes: "Primary candid coverage Kit for leadership review.",
      active_status: true,
      created_at: "2026-03-27T12:00:00.000Z",
      updated_at: "2026-03-27T12:00:00.000Z"
    }
  ],
  filters: {
    kit_types: ["candid_media"],
    assigned_users: [{ id: "user-photo", full_name: "Demo Photographer" }]
  }
};

const kitDetailResponse: GearKitDetailView = {
  kit: kitListResponse.kits[0],
  active_checkout: {
    id: "checkout-kit",
    status: "checked_out",
    checked_out_to_user_id: "user-photo",
    checked_out_to_user_name: "Demo Photographer",
    linked_shoot_id: "shoot-1",
    linked_shoot_title: "Spring Portrait Day",
    linked_location_id: "location-1",
    linked_location_name: "Main Gym",
    reserved_at: "2026-03-27T10:00:00.000Z",
    checked_out_at: "2026-03-27T11:00:00.000Z",
    expected_return_at: "2026-03-27T22:00:00.000Z",
    checkout_note: "Checked out for candid coverage."
  },
  contents: [
    {
      membership_id: "membership-1",
      asset_id: "asset-1",
      internal_asset_id: "GEAR-P2-CAM",
      asset_name: "Phase 2 Candid Camera",
      category: "camera",
      serial_number: "CAM-123",
      qr_code_id: "ASSET-QR-CAM",
      tile_tracker_id: "TILE-CAM",
      tile_tracker_active: true,
      status: "checked_out",
      required_in_kit: true,
      display_order: 1,
      current_custodian_name: "Demo Photographer",
      last_seen_with_name: "Demo Leadership",
      open_service_count: 0
    },
    {
      membership_id: "membership-2",
      asset_id: "asset-5",
      internal_asset_id: "GEAR-P2-FLASH",
      asset_name: "Phase 2 Flash Kit",
      category: "lighting",
      serial_number: "FLASH-123",
      qr_code_id: "ASSET-QR-FLASH",
      tile_tracker_id: "TILE-FLASH",
      tile_tracker_active: true,
      status: "checked_out",
      required_in_kit: true,
      display_order: 2,
      current_custodian_name: "Demo Photographer",
      last_seen_with_name: "Demo Leadership",
      open_service_count: 0
    }
  ],
  latest_pre_shoot_verification: {
    id: "verification-1",
    status: "verified_ready",
    verified_by_name: "Demo Leadership",
    linked_shoot_title: "Spring Portrait Day",
    verified_ready_at: "2026-03-27T11:15:00.000Z",
    created_at: "2026-03-27T11:00:00.000Z"
  },
  service_records: [
    {
      id: "repair-kit",
      issue_type: "tracker_issue",
      status: "under_review",
      reported_by_name: "Demo Leadership",
      opened_at: "2026-03-26T12:00:00.000Z",
      resolved_at: null,
      resolved_by_name: null,
      linked_shoot_id: "shoot-1",
      linked_shoot_title: "Spring Portrait Day",
      linked_location_name: "Main Gym",
      source_checkout_id: "checkout-kit",
      source_surface: "admin_web",
      note: "Tile tracker link is missing for this Kit.",
      updated_at: "2026-03-26T12:00:00.000Z"
    }
  ],
  temporary_substitutions: [
    {
      id: "sub-kit-1",
      original_asset_id: "asset-5",
      original_asset_name: "Phase 2 Flash Kit",
      original_asset_internal_id: "GEAR-P2-FLASH",
      substitute_asset_id: "asset-7",
      substitute_asset_name: "Phase 2 Backup Flash",
      substitute_asset_internal_id: "GEAR-P2-FLASH-BACKUP",
      assigned_user_id: "user-photo",
      assigned_user_name: "Demo Photographer",
      linked_shoot_id: "shoot-1",
      linked_shoot_title: "Spring Portrait Day",
      linked_location_name: "Main Gym",
      substitute_checkout_id: "checkout-sub-2",
      status: "active",
      starts_at: "2026-03-27T11:10:00.000Z",
      ends_at: null,
      note: "Flash substituted after verification.",
      created_by_name: "Demo Leadership",
      ended_by_name: null,
      created_at: "2026-03-27T11:10:00.000Z",
      updated_at: "2026-03-27T11:10:00.000Z"
    }
  ],
  custody_history: [
    {
      id: "custody-kit",
      event_type: "assigned",
      timestamp: "2026-02-25T12:00:00.000Z",
      from_user_name: null,
      to_user_name: "Demo Photographer",
      linked_shoot_title: "Spring Portrait Day",
      linked_location_name: "Main Gym",
      note: "Standing Kit assignment.",
      created_by_name: "Demo Leadership"
    }
  ]
};

const currentMonthKey = new Date().toISOString().slice(0, 7);

const monthlyReportResponse: GearMonthlyReportView = {
  month: currentMonthKey,
  period_start: `${currentMonthKey}-01T00:00:00.000Z`,
  period_end: `${currentMonthKey}-31T00:00:00.000Z`,
  summary: {
    missing_items: 1,
    overdue_returns: 1,
    unresolved_repairs: 2,
    missing_over_30_days: 1,
    current_custody: 2,
    recent_custody_activity: 3,
    recent_scan_activity: 2,
    tile_attention_items: 2
  },
  missing_items: [
    {
      target_type: "asset",
      target_id: "asset-4",
      label: "Phase 2 70-200 Lens",
      status: "missing",
      current_custodian_name: null,
      last_seen_with_name: "Demo Photographer",
      linked_shoot_id: "shoot-1",
      linked_shoot_title: "Spring Portrait Day",
      linked_location_name: "Main Gym",
      due_at: null,
      event_at: "2026-03-01T12:00:00.000Z",
      last_scanned_at: "2026-03-01T11:30:00.000Z",
      last_scanned_by_name: "Demo Leadership",
      note: "Missing after recent field use and needs immediate follow-up."
    }
  ],
  overdue_returns: [
    {
      target_type: "asset",
      target_id: "asset-2",
      label: "Phase 2 Audio Mixer",
      status: "checked_out",
      current_custodian_name: "Demo Photographer",
      last_seen_with_name: "Demo Leadership",
      linked_shoot_id: "shoot-1",
      linked_shoot_title: "Spring Portrait Day",
      linked_location_name: "Main Gym",
      due_at: "2026-03-26T22:00:00.000Z",
      event_at: "2026-03-27T08:00:00.000Z",
      last_scanned_at: "2026-03-26T19:15:00.000Z",
      last_scanned_by_name: "Demo Leadership",
      note: "Still out from the prior event and now overdue."
    }
  ],
  unresolved_repairs: kitDetailResponse.service_records,
  missing_over_30_days: [
    {
      target_type: "asset",
      target_id: "asset-4",
      label: "Phase 2 70-200 Lens",
      status: "missing",
      current_custodian_name: null,
      last_seen_with_name: "Demo Photographer",
      linked_shoot_id: "shoot-1",
      linked_shoot_title: "Spring Portrait Day",
      linked_location_name: "Main Gym",
      due_at: null,
      event_at: "2026-02-01T12:00:00.000Z",
      last_scanned_at: "2026-02-01T11:30:00.000Z",
      last_scanned_by_name: "Demo Leadership",
      note: "Missing more than 30 days and still unresolved."
    }
  ],
  current_custody: [
    {
      target_type: "kit",
      target_id: "kit-1",
      label: "Phase 2 Candid Media Kit",
      status: "checked_out",
      checkout_status: "checked_out",
      current_custodian_name: "Demo Photographer",
      linked_shoot_title: "Spring Portrait Day",
      linked_location_name: "Main Gym",
      reserved_at: "2026-03-27T10:00:00.000Z",
      checked_out_at: "2026-03-27T11:00:00.000Z",
      expected_return_at: "2026-03-27T22:00:00.000Z",
      last_scanned_at: "2026-03-27T11:05:00.000Z",
      last_scanned_by_name: "Demo Leadership",
      note: "Checked out for candid coverage."
    }
  ],
  recent_custody_activity: [
    {
      target_type: "kit",
      target_id: "kit-1",
      label: "Phase 2 Candid Media Kit",
      event_type: "checked_out",
      occurred_at: "2026-03-27T11:00:00.000Z",
      to_user_name: "Demo Photographer",
      linked_shoot_title: "Spring Portrait Day",
      linked_location_name: "Main Gym",
      note: "Checked out for candid coverage."
    }
  ],
  recent_scan_activity: [
    {
      id: "scan-1",
      target_type: "kit",
      target_id: "kit-1",
      label: "Phase 2 Candid Media Kit",
      scan_action: "check_out",
      scanned_at: "2026-03-27T11:05:00.000Z",
      scanned_by_name: "Demo Leadership",
      linked_shoot_title: "Spring Portrait Day",
      linked_location_name: "Main Gym",
      mismatch_detected: false,
      override_applied: false,
      note: "Verified before departure."
    }
  ],
  tile_attention: dashboardResponse.tile_attention
};

describe("Gear page", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    window.history.replaceState(null, "", "#gear");
  });

  it("renders the dashboard-first inventory workspace and drills into Asset and Kit detail panels", async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/gear/dashboard") {
        return dashboardResponse;
      }
      if (path === `/api/gear/reports/monthly?month=${currentMonthKey}`) {
        return monthlyReportResponse;
      }
      if (path === "/api/gear/assets") {
        return assetListResponse;
      }
      if (path === "/api/gear/assets/asset-2") {
        return assetDetailResponse;
      }
      if (path === "/api/gear/kits") {
        return kitListResponse;
      }
      if (path === "/api/gear/kits/kit-1") {
        return kitDetailResponse;
      }
      throw new Error(`Unexpected gear call: ${path}`);
    });

    render(<Gear token="token" currentUser={leadershipUser} />);

    expect(await screen.findByText("Inventory, custody, and readiness")).toBeInTheDocument();
    expect(screen.getByText("Total Assets")).toBeInTheDocument();
    expect(screen.getByText("Assigned")).toBeInTheDocument();
    expect(screen.getAllByText("Checked Out").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Overdue Return").length).toBeGreaterThan(0);
    expect(screen.getByText("Missing Gear Alert")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Assets" }));

    expect(await screen.findByText("Asset Inventory")).toBeInTheDocument();
    expect(await screen.findByText("Phase 2 Audio Mixer")).toBeInTheDocument();
    expect(await screen.findByText("Asset Detail")).toBeInTheDocument();
    expect(screen.getByText("Asset Summary")).toBeInTheDocument();
    expect(screen.getByText("Current Custody")).toBeInTheDocument();
    expect(screen.getByText("Service / Repair Record")).toBeInTheDocument();
    expect(screen.getByText("Issue Reporting")).toBeInTheDocument();
    expect(screen.getByText("Temporary Substitution")).toBeInTheDocument();
    expect(screen.getByText("Custody Event History")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Kits" }));

    expect(await screen.findByText("Kit Inventory")).toBeInTheDocument();
    expect(await screen.findByText("Phase 2 Candid Media Kit")).toBeInTheDocument();
    expect(await screen.findByText("Required Contents Checklist")).toBeInTheDocument();
    expect(screen.getByText("Pre-Shoot Verification")).toBeInTheDocument();
    expect(screen.getByText("Report Kit Issue")).toBeInTheDocument();
    expect(screen.getByText("Phase 2 Candid Camera")).toBeInTheDocument();
    expect(screen.getByText("Verified Ready At")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reports" }));

    expect(await screen.findByText("Monthly Gear Report")).toBeInTheDocument();
    expect(screen.getByText("Current Custody Summary")).toBeInTheDocument();
    expect(screen.getByText("Recent Scan Activity")).toBeInTheDocument();
    expect(screen.getAllByText("Phase 2 70-200 Lens").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the module restricted for users without Gear access", async () => {
    render(<Gear token="token" currentUser={photographerUser} />);

    expect(screen.getByText("Gear access is restricted")).toBeInTheDocument();
    await waitFor(() => {
      expect(apiFetchMock).not.toHaveBeenCalled();
    });
  });
});
