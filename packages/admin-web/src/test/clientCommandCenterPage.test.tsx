// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientCommandCenter } from "../pages/ClientCommandCenter";
import type { ClientAccountDetail, ClientCommandCenterDashboard } from "../clientCommandCenterTypes";
import type { SessionUser } from "../types";

const getClientCommandCenterDashboardMock = vi.fn();
const getClientAccountDetailMock = vi.fn();

vi.mock("../services/clientCommandCenter", () => ({
  assignClientOwner: vi.fn(),
  attachClientContactRelationship: vi.fn(),
  createClientAccount: vi.fn(),
  createClientAccountNote: vi.fn(),
  createClientAccountTask: vi.fn(),
  createClientContact: vi.fn(),
  createClientOrganization: vi.fn(),
  getClientAccountDetail: (...args: unknown[]) => getClientAccountDetailMock(...args),
  getClientCommandCenterDashboard: (...args: unknown[]) => getClientCommandCenterDashboardMock(...args),
  upsertClientAccountService: vi.fn()
}));

const currentUser = {
  id: "user-1",
  fullName: "Jessica Demo",
  email: "jessica@example.com",
  roles: ["leadership"],
  permissions: ["client_command_center.read"]
} as SessionUser;

const dashboard: ClientCommandCenterDashboard = {
  generated_at: new Date().toISOString(),
  summary: {
    active_accounts: 1,
    accounts_missing_required_contacts: 0,
    accounts_missing_studio_bestie: 0,
    accounts_with_upcoming_jobs: 1,
    readiness_issues: 0
  },
  accounts: [
    {
      id: "account-1",
      entity_kind: "account",
      name: "Wayzata High School",
      parent_organization_id: "district-1",
      parent_organization_name: "Wayzata School District",
      client_organization_type: "high_school",
      lifecycle_status: "active",
      account_type: "schools_underclass_portraits",
      main_phone: "555-1000",
      office_phone: null,
      website: null,
      contact_count: 2,
      service_count: 1,
      open_job_count: 1,
      readiness_issue_count: 0,
      studio_bestie_name: "Jessica Demo",
      updated_at: new Date().toISOString()
    }
  ],
  parent_organizations: [],
  readiness_issues: [],
  recently_updated: []
};

const detail: ClientAccountDetail = {
  account: dashboard.accounts[0],
  parent_organization: null,
  contacts: [
    {
      id: "contact-1",
      display_name: "Jamie Carlson",
      first_name: "Jamie",
      last_name: "Carlson",
      title: "Head Secretary",
      email: "jamie@example.com",
      phone: null,
      mobile_phone: "555-2000",
      office_phone: "555-1001",
      preferred_contact_method: "email",
      active_status: "active",
      allow_email: true,
      allow_sms: true,
      allow_phone: true,
      do_not_contact: false,
      sms_consent_status: "opted_in",
      sms_consent_source: "manual",
      sms_consent_at: null,
      sms_opted_out_at: null,
      prep_email_eligible: true,
      prep_email_exclusion_reason: null,
      prep_sms_eligible: true,
      prep_sms_exclusion_reason: null,
      notes: null,
      relationship_id: "rel-1",
      organization_id: "account-1",
      organization_name: "Wayzata High School",
      client_roles: ["head_secretary", "picture_day_prep_recipient"],
      is_primary: false,
      receives_picture_day_emails: true,
      receives_yearbook_emails: false,
      receives_billing_emails: false,
      receives_gallery_emails: false,
      receives_approval_emails: false,
      receives_onboarding_emails: false,
      receives_internal_escalations: false
    },
    {
      id: "contact-2",
      display_name: "Drew Quiet",
      first_name: "Drew",
      last_name: "Quiet",
      title: "Advisor",
      email: "drew@example.com",
      phone: null,
      mobile_phone: "555-2999",
      office_phone: null,
      preferred_contact_method: "text",
      active_status: "active",
      allow_email: true,
      allow_sms: true,
      allow_phone: false,
      do_not_contact: true,
      sms_consent_status: "opted_in",
      sms_consent_source: "manual",
      sms_consent_at: null,
      sms_opted_out_at: null,
      prep_email_eligible: false,
      prep_email_exclusion_reason: "Do not contact is enabled.",
      prep_sms_eligible: false,
      prep_sms_exclusion_reason: "Do not contact is enabled.",
      notes: null,
      relationship_id: "rel-2",
      organization_id: "account-1",
      organization_name: "Wayzata High School",
      client_roles: ["picture_day_prep_recipient"],
      is_primary: false,
      receives_picture_day_emails: true,
      receives_yearbook_emails: false,
      receives_billing_emails: false,
      receives_gallery_emails: false,
      receives_approval_emails: false,
      receives_onboarding_emails: false,
      receives_internal_escalations: false
    }
  ],
  locations: [
    {
      id: "location-1",
      location_name: "Wayzata High School Main Building",
      location_type: "main_building",
      organization_id: "account-1",
      address_line_1: "4955 Peony Ln N",
      address_line_2: null,
      city: "Plymouth",
      state: "MN",
      zip: "55446",
      address_display: "4955 Peony Ln N, Plymouth, MN 55446",
      google_maps_url: "https://www.google.com/maps/search/?api=1&query=Wayzata%20High%20School",
      active_status: "active",
      navigation_notes: "Use Door 1, not the activities entrance.",
      parking_instructions: "Use the visitor lot near Door 1.",
      entrance_instructions: "Check in at Door 1 with the front office.",
      unloading_instructions: "Unload at the curb cut near Door 1.",
      setup_area: "Main commons by the media center hallway.",
      backup_indoor_location: "Auxiliary gym if commons is unavailable.",
      accessibility_notes: "Elevator is available by the front office.",
      power_availability_notes: "Bring a 25-foot extension cord.",
      wifi_cell_notes: "Guest Wi-Fi requires office approval.",
      security_checkin_requirements: "All staff must show ID badges.",
      weather_contingency_notes: "Use Door 1 only during rain.",
      client_facing_notes: "Photo team should check in at the front office.",
      employee_facing_notes: "Bring extension cord and keep gear tight to the west wall.",
      internal_only_notes: "Do not mention the recurring lunch traffic concern in client prep messages.",
      reference_attachments: [
        {
          id: "location-attachment-1",
          location_id: "location-1",
          title: "Door 1 Parking Map",
          description: "Reference screenshot for visitor parking.",
          attachment_type: "parking_map",
          audience: "employee_facing",
          file_url: "https://example.com/parking-map.png",
          storage_key: null,
          uploaded_by_user_id: null,
          uploaded_by_name: null,
          uploaded_at: new Date().toISOString(),
          active_status: "active"
        },
        {
          id: "location-attachment-2",
          location_id: "location-1",
          title: "Internal Commons Setup",
          description: "Internal-only setup reminder.",
          attachment_type: "setup_reference",
          audience: "internal_only",
          file_url: null,
          storage_key: "demo/internal-setup.png",
          uploaded_by_user_id: null,
          uploaded_by_name: null,
          uploaded_at: new Date().toISOString(),
          active_status: "active"
        }
      ],
      notes: "Reusable location notes.",
      updated_at: new Date().toISOString()
    }
  ],
  owners: [],
  services: [{ id: "service-1", service_type: "fall_pictures", status: "active", notes: null }],
  readiness: {
    account_id: "account-1",
    generated_at: new Date().toISOString(),
    status: "ready",
    checks: [],
    issues: []
  },
  upcoming_jobs: [],
  open_tasks: [],
  timeline: []
};

describe("ClientCommandCenter Contacts V1", () => {
  beforeEach(() => {
    window.location.hash = "#client-command-center/accounts/account-1";
    getClientCommandCenterDashboardMock.mockResolvedValue(dashboard);
    getClientAccountDetailMock.mockResolvedValue(detail);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows communication-ready contact details and message readiness without sending messages", async () => {
    render(<ClientCommandCenter token="token" currentUser={currentUser} />);

    const contactRows = await screen.findAllByText("Jamie Carlson");
    const row = contactRows.map((item) => item.closest(".client-command-center-contact-row")).find(Boolean);
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText(/Head Secretary/)).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText(/Mobile: 555-2000/)).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("Prep email eligible")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("Prep SMS eligible")).toBeInTheDocument();

    const excludedRow = screen.getByText("Drew Quiet").closest(".client-command-center-contact-row");
    expect(excludedRow).not.toBeNull();
    expect(within(excludedRow as HTMLElement).getByText("Do not contact")).toBeInTheDocument();
    expect(within(excludedRow as HTMLElement).getByText("Prep email not ready")).toBeInTheDocument();
  });

  it("shows account locations with clearly separated note audiences", async () => {
    render(<ClientCommandCenter token="token" currentUser={currentUser} />);

    const locationHeading = await screen.findByText("Locations and prep notes");
    expect(locationHeading).toBeInTheDocument();
    expect(screen.getByText("Wayzata High School Main Building")).toBeInTheDocument();
    expect(screen.getByText("4955 Peony Ln N, Plymouth, MN 55446")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in Google Maps" })).toHaveAttribute("href", "https://www.google.com/maps/search/?api=1&query=Wayzata%20High%20School");
    expect(screen.getByText("Navigation")).toBeInTheDocument();
    expect(screen.getByText("Use Door 1, not the activities entrance.")).toBeInTheDocument();
    expect(screen.getByText("Parking")).toBeInTheDocument();
    expect(screen.getByText("Use the visitor lot near Door 1.")).toBeInTheDocument();
    expect(screen.getByText("Client-facing")).toBeInTheDocument();
    expect(screen.getByText("Photo team should check in at the front office.")).toBeInTheDocument();
    expect(screen.getByText("Employee-facing")).toBeInTheDocument();
    expect(screen.getByText("Bring extension cord and keep gear tight to the west wall.")).toBeInTheDocument();
    expect(screen.getByText("Internal-only")).toBeInTheDocument();
    expect(screen.getByText("Do not mention the recurring lunch traffic concern in client prep messages.")).toBeInTheDocument();
    expect(screen.getByText("Reference attachments")).toBeInTheDocument();
    expect(screen.getByText("Door 1 Parking Map")).toBeInTheDocument();
    expect(screen.getByText("Employee Facing")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open reference" })).toHaveAttribute("href", "https://example.com/parking-map.png");
    expect(screen.getByText("Internal Commons Setup")).toBeInTheDocument();
    expect(screen.getAllByText("Internal Only").length).toBeGreaterThan(0);
    expect(screen.getByText("Stored reference")).toBeInTheDocument();
  });
});
