// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveShoots } from "../pages/LiveShoots";
import { SportsShootDetailPage } from "../pages/SportsShootDetailPage";
import type { LiveShootQueueResponse, SessionUser, ShootDetail } from "../types";
import type { SportsShootDetailResponse } from "../sportsTypes";

const apiFetchMock = vi.fn();

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetchMock(...args)
  };
});

const baseUser: SessionUser = {
  id: "user-sports-manager",
  tenantId: "tenant-demo",
  accountId: "account-demo",
  sessionId: "session-demo",
  email: "sports@example.com",
  fullName: "Sports Manager",
  status: "active",
  department: "sports",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["manager"],
  permissions: ["sports_hub.manage", "sports_finance.view", "shoot.read", "shoot.update", "schedule.read"],
  authorityTier: "supervisor",
  primaryJobFunctionProfile: "director_of_sports_photography",
  jobFunctionProfiles: ["director_of_sports_photography"],
  permissionGrants: [],
  effectiveScopes: ["organization_wide_scope"],
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

const detailResponse = {
  generated_at: "2026-04-01T12:00:00.000Z",
  permissions: {
    can_manage_department: true,
    can_edit_shoots: true,
    can_manage_staffing: true,
    can_manage_production: true,
    can_manage_finance: true,
    can_view_finance_detail: true,
    can_manage_settings: false,
    can_publish_imports: true,
    can_override_duplicates: true,
    can_confirm_ready: true
  },
  summary: {
    id: "shoot-1",
    job_number: "SPT-2026-001",
    shoot_code: "SPORT-001",
    title: "State Hockey Media Day",
    event_name: "State Hockey Media Day",
    organization_id: "org-1",
    organization_name: "North Metro Hockey",
    location_id: "loc-1",
    location_name: "Arena A",
    primary_contact_id: "contact-1",
    primary_contact_name: "Jamie Coach",
    account_owner_user_id: "user-sports-manager",
    account_owner_name: "Sports Manager",
    lead_photographer_user_id: "user-sports-manager",
    lead_photographer_name: "Sports Manager",
    shoot_date: "2026-04-03",
    start_time: "08:00",
    end_time: "14:00",
    timezone: "America/Chicago",
    sport_type: "hockey",
    season: "winter",
    league_name: "State League",
    division: "Varsity",
    team_structure: "scheduled_slots",
    estimated_team_count: 6,
    estimated_subject_count: 120,
    proof_required: true,
    proof_due_date: "2026-04-08",
    revenue_share_enabled: true,
    banner_work_required: true,
    specialty_products_enabled: true,
    shoot_status: "confirmed",
    production_status: "proof_build",
    proof_status: "building",
    staffing_status: "partially_staffed",
    readiness_status: "at_risk",
    sync_status: "clean",
    risk_status: "high",
    watch_flag_count: 1,
    blocker_count: 1,
    overdue_proof_count: 0,
    production_item_count: 1,
    specialty_due_count: 1,
    staffing_counts: {
      scheduled: 2,
      minimum: 3,
      missing_staffing: 1,
      waiting_on_approval: 1,
      production_blocked: 0,
      ready_to_shoot: 0
    },
    last_updated_at: "2026-04-01T11:00:00.000Z",
    delivery_type: "mixed"
  },
  client_snapshot: {
    organization_name: "North Metro Hockey",
    primary_contact_name: "Jamie Coach",
    approval_contact_name: "Alex Approver",
    billing_contact_name: "Taylor Billing",
    location_name: "Arena A"
  },
  notes: {
    internal_notes: "Keep banners grouped by division.",
    client_notes: null,
    special_instructions: null,
    event_notes: null,
    setup_notes: "Unload through south doors.",
    travel_notes: null,
    parking_notes: null,
    access_notes: "Credential check at front desk.",
    client_expectations_notes: "Proofs due before sponsor approval."
  },
  readiness: {
    status: "at_risk",
    percent_complete: 67,
    blocker_count: 1,
    warning_count: 1,
    items: [
      {
        id: "item-1",
        shoot_id: "shoot-1",
        section: "staffing",
        code: "MISSING_STAFFING_ESTIMATE",
        label: "Crew minimum confirmed",
        is_required: true,
        is_blocker: true,
        is_complete: false,
        completed_at: null,
        completed_by_user_id: null,
        completed_by_name: null,
        notes: "Need one more photographer.",
        sort_order: 10
      }
    ]
  },
  job_days: [
    {
      id: "day-1",
      day_index: 0,
      shoot_date: "2026-04-03",
      start_time: "08:00",
      end_time: "14:00",
      timezone: "America/Chicago",
      location_id: "loc-1",
      location_name: "Arena A",
      status: "confirmed"
    }
  ],
  staffing: {
    status: "partially_staffed",
    assigned_count: 2,
    required_count: 3,
    lead_photographer_user_id: "user-sports-manager",
    lead_photographer_name: "Sports Manager",
    lead_ready: {
      confirmed: false,
      confirmed_at: null,
      confirmed_by_name: null,
      exception_flag: false,
      available: true
    },
    people: [
      {
        shift_id: "shift-1",
        user_id: "user-sports-manager",
        user_name: "Sports Manager",
        role_on_job: "lead_photographer",
        assignment_status: "assigned",
        check_in_at: null,
        check_out_at: null,
        ready_confirmed_at: null,
        notes: null
      }
    ]
  },
  teams: [],
  production_items: [
    {
      id: "prod-1",
      linked_shoot_id: "shoot-1",
      title: "Proof Build Batch",
      production_type: "proof_gallery",
      status: "proof_build",
      assigned_to_user_id: "prod-user",
      assigned_to_name: "Production Lead",
      due_date: "2026-04-08",
      delivery_deadline: "2026-04-10",
      proof_required: true,
      approval_required: true,
      file_count_expected: 120,
      file_count_received: 40,
      vendor_name: null,
      qa_status: "prep",
      blocked_reason: null,
      created_at: "2026-04-01T10:00:00.000Z",
      updated_at: "2026-04-01T10:00:00.000Z"
    }
  ],
  proof_cycles: [],
  specialty_products: [],
  watch_flags: [
    {
      id: "flag-1",
      shoot_id: "shoot-1",
      shoot_title: "State Hockey Media Day",
      organization_id: "org-1",
      organization_name: "North Metro Hockey",
      severity: "high",
      flag_type: "staffing_gap",
      title: "Need one more photographer",
      description: "Final headcount is still short.",
      status: "open",
      owner_user_id: "user-sports-manager",
      owner_name: "Sports Manager",
      due_at: "2026-04-02T15:00:00.000Z",
      resolved_at: null,
      resolved_by_user_id: null,
      resolved_by_name: null,
      created_at: "2026-04-01T09:00:00.000Z",
      updated_at: "2026-04-01T09:00:00.000Z"
    }
  ],
  financial_summary: {
    id: "fin-1",
    shoot_id: "shoot-1",
    pricing_profile_name: "Hockey Premium",
    invoice_number: "INV-100",
    invoice_status: "estimated",
    invoice_due_date: "2026-04-15",
    revenue_share_enabled: true,
    revenue_share_terms_summary: "15% payout after finals",
    estimated_revenue: 2400,
    actual_revenue: null,
    estimated_cost: 900,
    actual_cost: null,
    payout_amount: null,
    payment_status: "pending",
    notes: "Revenue share kicks after client approval.",
    created_at: "2026-04-01T09:00:00.000Z",
    updated_at: "2026-04-01T09:00:00.000Z"
  },
  activity: [
    {
      id: "activity-1",
      source: "shoot_activity_log",
      event_type: "job_published",
      summary: "Sports published the job and seeded downstream work.",
      actor_user_id: "user-sports-manager",
      actor_name: "Sports Manager",
      payload: null,
      created_at: "2026-04-01T09:00:00.000Z"
    }
  ],
  linked_context: {
    organization_history_hash: "#organizations?organization=org-1",
    location_history_hash: "#operations/locations?location=loc-1",
    contact_history_hash: "#directory/contacts?contact=contact-1",
    production_hash: "#production?project=prod-1"
  }
} as unknown as SportsShootDetailResponse;

const canonicalShoot = {
  id: "shoot-1",
  shoot_code: "SPORT-001",
  title: "State Hockey Media Day",
  location_name: "Arena A",
  primary_contact_name: "Jamie Coach",
  ready_to_shoot: {
    show_action: true
  },
  status_events: []
} as unknown as ShootDetail;

const emptyLiveQueue: LiveShootQueueResponse = {
  generated_at: "2026-04-01T12:00:00.000Z",
  date: "2026-04-01",
  summary: {
    in_view: 0,
    needs_staffing: 0,
    needs_review: 0,
    unscheduled: 0,
    scheduled: 0,
    completed: 0
  },
  sections: []
};

describe("Sports workspace pages", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the sports shoot detail command center with sports-owned tabs", async () => {
    window.location.hash = "#sports/shoots/shoot-1";
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/sports/shoots/shoot-1") {
        return Promise.resolve(detailResponse);
      }
      if (path === "/api/shoots/shoot-1") {
        return Promise.resolve(canonicalShoot);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<SportsShootDetailPage token="token-demo" currentUser={baseUser} />);

    expect(await screen.findByRole("heading", { name: /SPT-2026-001 - State Hockey Media Day/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Readiness" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Staffing" })).toBeInTheDocument();
    expect(screen.getByText("Need one more photographer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Financial" }));
    expect(await screen.findByText("Hockey Premium")).toBeInTheDocument();
  });

  it("keeps sports intake out of operations and points operators to the owning workspace", async () => {
    window.location.hash = "#operations/shoots";
    apiFetchMock.mockImplementation((path: string) => {
      if (String(path).startsWith("/api/shoots/live-queue?date=")) {
        return Promise.resolve(emptyLiveQueue);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<LiveShoots token="token-demo" currentUser={baseUser} socket={null} realtimeStatus="connected" />);

    expect(await screen.findByRole("heading", { name: /Sports intake and follow-through now live in Sports/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Sports" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "New Job Intake" })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalled();
    });
  });
});
