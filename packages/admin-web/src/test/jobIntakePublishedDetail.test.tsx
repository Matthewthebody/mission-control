// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShootDetailDrawer } from "../components/ShootDetailDrawer";
import type { CentralJobIntakeResponse } from "../jobIntakeTypes";
import type { ShootDetail, ShootSummary } from "../types";

const getCentralJobMock = vi.fn();

vi.mock("../services/centralJobIntakeApi", () => ({
  getCentralJob: (...args: unknown[]) => getCentralJobMock(...args)
}));

vi.mock("../services/shootHotSheet", () => ({
  buildShootBriefing: (summary: ShootSummary) => ({
    id: summary.id,
    shootId: summary.id,
    shootCode: summary.shoot_code,
    title: summary.title,
    category: "schools",
    categoryLabel: "Schools",
    shootDate: summary.shoot_date ?? "2026-04-15",
    timeRange: "8:00 AM - 10:00 AM",
    locationLine: summary.location_name,
    fullAddress: summary.location_address ?? null,
    priorityLabel: null,
    priorityLevel: null,
    priorityReasons: [],
    profitabilityDisplay: null,
    arrivalLabel: "7:30 AM",
    shootLabel: "8:00 AM",
    teardownLabel: "10:00 AM",
    leadName: null,
    leadPhone: null,
    photographerCountLabel: "2 photographers",
    staffingTone: "staffed",
    staffingDetail: "Staffing ready",
    specialGearSummary: null,
    specialGear: [],
    weatherSummary: null,
    weatherDetail: null,
    weatherTone: null,
    travelSummary: null,
    driveTimeLabel: null,
    missingFields: [],
    alertIndicators: [],
    notes: [],
    customNeeds: [],
    contacts: [{ label: "Primary", name: summary.primary_contact_name ?? "Pat Contact", phone: null }],
    recurringIssues: [],
    bestPractices: [],
    photos: [],
    historicalContext: null,
    files: [],
    mapsUrl: null,
    statusNote: "Ready for intake detail review."
  })
}));

vi.mock("../services/shootApi", () => ({
  confirmShootReadyToShoot: vi.fn()
}));

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  getCentralJobMock.mockReset();
});

describe("central job published detail", () => {
  it("loads a published schools job with readiness blockers and activity history", async () => {
    getCentralJobMock.mockResolvedValue(makeCentralJobResponse("schools"));

    render(
      <ShootDetailDrawer
        token="token-demo"
        shootSummary={makeShootSummary("shoot-school-1")}
        shoot={makeShootDetail("shoot-school-1")}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(getCentralJobMock).toHaveBeenCalledWith("token-demo", "shoot-school-1"));
    expect(await screen.findByText("Central Job Header")).toBeInTheDocument();
    expect(screen.getByText("Published but still blocked")).toBeInTheDocument();
    expect(screen.getByText("Missing location")).toBeInTheDocument();
    expect(screen.getByText("Job Published")).toBeInTheDocument();
    expect(screen.getByText("School production shell")).toBeInTheDocument();
  });

  it("loads a published sports job with sports-specific detail", async () => {
    getCentralJobMock.mockResolvedValue(makeCentralJobResponse("sports"));

    render(
      <ShootDetailDrawer
        token="token-demo"
        shootSummary={makeShootSummary("shoot-sports-1")}
        shoot={makeShootDetail("shoot-sports-1")}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(getCentralJobMock).toHaveBeenCalledWith("token-demo", "shoot-sports-1"));
    expect(await screen.findByText("Department Detail")).toBeInTheDocument();
    expect(screen.getByText("Hockey")).toBeInTheDocument();
    expect(screen.getByText("Specialty poster, Trader cards")).toBeInTheDocument();
    expect(screen.getByText("Duplicate override used")).toBeInTheDocument();
  });
});

function makeShootSummary(id: string): ShootSummary {
  return {
    id,
    shoot_code: id === "shoot-sports-1" ? "SPT-100" : "SCH-100",
    title: id === "shoot-sports-1" ? "Metro Hockey Media Day" : "North High Underclass Day",
    shoot_date: "2026-04-15",
    location_name: "Main Gym",
    location_address: "123 Main St",
    primary_contact_name: "Pat Contact",
    primary_contact_phone: "555-0100",
    primary_contact_email: "pat@example.com",
    organization_display_name: id === "shoot-sports-1" ? "Metro Athletics" : "North High",
    status: "CONFIRMED",
    status_display: "Confirmed",
    normalized_status: "CONFIRMED",
    readiness_summary: "Blocked",
    ready_eligible: false,
    readiness_requirements: [],
    agreement_warning_summary: null,
    additional_contacts: [],
    scheduled_employee_count: 2,
    planned_staff_count: 2,
    required_lead_count: 1,
    lead_coverage_count: 1,
    open_alert_count: 0,
    missing_lead: false,
    under_staffed: false,
    over_staffed: false,
    conflict_warning_count: 0,
    priority_reasons: [],
    operational_flags: [],
    importance_override_applied: false
  } as ShootSummary;
}

function makeShootDetail(id: string): ShootDetail {
  return {
    ...makeShootSummary(id),
    alerts: [],
    attendance_exceptions: [],
    status_events: [],
    shifts: [],
    location_intelligence: null,
    ready_to_shoot: null,
    resource_library: null
  } as unknown as ShootDetail;
}

function makeCentralJobResponse(department: "schools" | "sports"): CentralJobIntakeResponse {
  return {
    job: {
      id: department === "schools" ? "shoot-school-1" : "shoot-sports-1",
      tenant_id: "tenant-demo",
      shoot_code: department === "schools" ? "SCH-100" : "SPT-100",
      title: department === "schools" ? "North High Underclass Day" : "Metro Hockey Media Day",
      organization_display_name: department === "schools" ? "North High" : "Metro Athletics",
      location_display_name: "Main Gym",
      primary_contact_name: "Pat Contact",
      account_owner_name: "Alex Owner",
      job_owner_name: "Jamie Coordinator",
      job_number: department === "schools" ? "SCH-2026-00123" : "SPT-2026-00124",
      department,
      job_type: department === "schools" ? "schools_underclass_portraits" : "sports",
      source_reference: null,
      record_state: "published",
      job_status: "confirmed",
      readiness_status: "blocked",
      sync_status: "in_sync",
      organization_id: "org-1",
      unresolved_organization_name: null,
      location_id: "loc-1",
      unresolved_location_name: null,
      primary_contact_id: "contact-1",
      unresolved_primary_contact_name: null,
      account_owner_user_id: "owner-1",
      job_owner_user_id: "owner-2",
      start_date: "2026-04-15",
      schedule_date_placeholder: false,
      start_time: "08:00",
      end_time: "10:00",
      timezone: "America/Chicago",
      date_only: false,
      start_time_confirmed: true,
      is_multi_day: false,
      delivery_due_date: "2026-04-20",
      production_required: true,
      staffing_required: true,
      staffing_estimate: 2,
      priority: "high",
      delivery_type: "digital_gallery",
      production_grouping_rule: "one_per_job",
      request_source: "manual",
      internal_notes: "Internal follow-through note",
      client_notes: "Client note",
      special_instructions: "Use west entrance",
      raw_source_text: "Requested from email",
      merge_parent_job_id: null,
      duplicate_override_note: department === "sports" ? "League split event" : null,
      duplicate_check_completed_at: "2026-04-01T10:00:00.000Z",
      created_by: "user-1",
      updated_by_user_id: "user-1",
      published_by_user_id: "user-2",
      published_at: "2026-04-01T11:00:00.000Z",
      created_at: "2026-04-01T09:00:00.000Z",
      updated_at: "2026-04-01T11:00:00.000Z"
    },
    job_days: [
      {
        id: "day-1",
        shoot_id: department === "schools" ? "shoot-school-1" : "shoot-sports-1",
        day_index: 0,
        shoot_date: "2026-04-15",
        start_time: "08:00",
        end_time: "10:00",
        timezone: "America/Chicago",
        location_id: "loc-1",
        date_only: false,
        start_time_confirmed: true
      }
    ],
    school_detail:
      department === "schools"
        ? ({
            shoot_id: "shoot-school-1",
            school_job_type: "underclass",
            school_type: "High school",
            student_count_estimate: 400,
            staff_count_estimate: 40,
            grade_range: "9-12",
            camera_count_estimate: 2,
            roster_status: "received",
            roster_due_date: "2026-04-10",
            id_required: true,
            id_sort_method: null,
            yearbook_required: true,
            yearbook_due_date: "2026-04-18",
            staff_packages_required: false,
            parent_communication_needed: false,
            background_requirements: null,
            school_day_notes: "Unload by west entrance",
            building_instructions: null,
            photo_day_special_notes: null
          } as CentralJobIntakeResponse["school_detail"])
        : null,
    sports_detail:
      department === "sports"
        ? ({
            shoot_id: "shoot-sports-1",
            sports_job_type: "media_day",
            sport_name: "Hockey",
            season: "Winter",
            level_or_age_group: "Varsity",
            team_count_estimate: 2,
            athlete_count_estimate: 44,
            coach_count_estimate: 6,
            coach_contact_id: null,
            alternate_team_contact_id: null,
            specialty_products_required: true,
            specialty_product_types: ["Specialty poster", "Trader cards"],
            gallery_required: true,
            delivery_deadline_type: "event_date",
            uniform_notes: null,
            sponsor_notes: null,
            event_notes: "Arrive before warmups",
            on_site_sales_notes: null
          } as CentralJobIntakeResponse["sports_detail"])
        : null,
    draft_validation: { valid: true, errors: [], warnings: [] },
    publish_validation: { valid: true, errors: [], warnings: [] },
    readiness: {
      readiness_status: "blocked",
      blockers: [
        {
          code: "MISSING_LOCATION",
          label: "Missing location",
          message: "Resolve the primary location before the job can be ready.",
          field: "location_id",
          blocking: true
        }
      ],
      warnings: [],
      items: [
        {
          code: "MISSING_LOCATION",
          label: "Missing location",
          blocking: true,
          status: "pending",
          detail: "Resolve the location."
        }
      ]
    },
    production_items: [
      {
        id: "production-1",
        tenant_id: "tenant-demo",
        linked_shoot_id: department === "schools" ? "shoot-school-1" : "shoot-sports-1",
        title: department === "schools" ? "School production shell" : "Sports production shell",
        status: "active",
        stage: "qa",
        priority: "high",
        owner_user_id: "prod-1",
        owner_name: "Production Lead",
        due_date: "2026-04-20",
        follow_up_date: null,
        current_step_label: "Peer review",
        created_reason: "Central intake publish",
        source_trigger_label: null,
        created_at: "2026-04-01T11:00:00.000Z",
        updated_at: "2026-04-01T11:00:00.000Z"
      }
    ],
    staffing_requirements: [
      {
        id: "staffing-1",
        tenant_id: "tenant-demo",
        shoot_id: department === "schools" ? "shoot-school-1" : "shoot-sports-1",
        source_of_creation: "central_job_publish",
        staffing_role: "photographer",
        label: "Photographer coverage",
        minimum_count: 1,
        ideal_count: 2,
        required_for_ready: true,
        lead_required: true,
        role_notes: null,
        sort_order: 1,
        assigned_count: 0,
        open_count: 2,
        created_at: "2026-04-01T11:00:00.000Z",
        updated_at: "2026-04-01T11:00:00.000Z"
      }
    ],
    activity_log: [
      {
        id: "activity-1",
        tenant_id: "tenant-demo",
        shoot_id: department === "schools" ? "shoot-school-1" : "shoot-sports-1",
        event_type: "job_draft_created",
        actor_user_id: "user-1",
        actor_name: "Jamie Coordinator",
        payload: {},
        created_at: "2026-04-01T09:00:00.000Z"
      },
      {
        id: "activity-2",
        tenant_id: "tenant-demo",
        shoot_id: department === "schools" ? "shoot-school-1" : "shoot-sports-1",
        event_type: "job_published",
        actor_user_id: "user-2",
        actor_name: "Alex Owner",
        payload: { job_number: department === "schools" ? "SCH-2026-00123" : "SPT-2026-00124" },
        created_at: "2026-04-01T11:00:00.000Z"
      }
    ]
  } as unknown as CentralJobIntakeResponse;
}
