// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRouteById, getVisibleChildRoutes, resolveRouteId, type TabKey } from "../navigation";
import { StudiosWorkspace } from "../pages/PhotographyWorkspace";
import { Schedule } from "../pages/Schedule";
import type { SharedJobDetailResponse, SharedJobListItem } from "../jobTruthTypes";
import type { ProjectWorkflowJobRow } from "../projectTrackingTypes";
import type { ScheduleRecordIntegrationState, SessionUser, UnifiedScheduleShootItem } from "../types";

const listSharedJobsMock = vi.fn();
const getSharedJobDetailMock = vi.fn();
const apiFetchMock = vi.fn();
const getProjectWorkflowCommandCenterMock = vi.fn();

vi.mock("../services/jobsApi", () => ({
  getSharedJobDetail: (...args: unknown[]) => getSharedJobDetailMock(...args),
  listSharedJobs: (...args: unknown[]) => listSharedJobsMock(...args)
}));

vi.mock("../api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args)
}));

vi.mock("../services/projectTracking", () => ({
  getProjectWorkflowCommandCenter: (...args: unknown[]) => getProjectWorkflowCommandCenterMock(...args)
}));

const currentUser: SessionUser = {
  id: "user-photo",
  tenantId: "tenant-demo",
  accountId: "account-photo",
  sessionId: "session-photo",
  email: "photo@example.com",
  fullName: "Photo Lead",
  status: "active",
  department: "schools",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["photographer"],
  permissions: ["shoot.read", "schedule.read"],
  authorityTier: "standard_employee",
  primaryJobFunctionProfile: "lead_photographer",
  jobFunctionProfiles: ["lead_photographer"],
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

const availableTabs: TabKey[] = ["dashboard", "calendar", "shoots", "projects", "time", "alerts"];

const photographyWorkflowRow = {
  job_id: "job-photo-workflow",
  job_number: "PHO-2001",
  job_code: "PHO-2001",
  job_title: "North Metro Stadium Media Day",
  organization_id: "org-photo",
  organization_name: "North Metro Athletics",
  account_id: "account-photo",
  account_name: "North Metro Athletics",
  workflow_run_id: "workflow-photo-1",
  workflow_template_id: "template-photo",
  workflow_template_name: "Photography readiness",
  workflow_template_version: "v1",
  current_step: {
    id: "step-photo-1",
    workflow_run_id: "workflow-photo-1",
    job_id: "job-photo-workflow",
    milestone_key: "field_readiness",
    step_key: "post_shoot_eval",
    name: "Post-shoot evaluation follow-up",
    description: null,
    department: "photography",
    role_key: "senior_photographer",
    assigned_user_id: "user-photo",
    assigned_user_name: "Photo Lead",
    assignment_status: "assigned",
    assigned_queue: "photography",
    assigned_by_user_id: null,
    assigned_by_user_name: null,
    assigned_at: null,
    waiting_on_party: "none",
    waiting_detail: null,
    status: "IN_PROGRESS",
    required: true,
    skippable: false,
    blocking: false,
    expected_duration_minutes: 120,
    started_at: null,
    completed_at: null,
    completed_by_user_id: null,
    notes: "Check setup reference and post-shoot notes.",
    exception_reason: null,
    rework_count: 0,
    dependency_step_ids: [],
    timing: {
      elapsed_minutes: 0,
      remaining_minutes: 120,
      overdue_minutes: 0,
      idle_minutes: 0,
      sla_percent: 0,
      alert_level: "early_warning",
      health_state: "yellow"
    },
    updated_at: "2026-06-05T12:00:00.000Z",
    phase: "field_follow_up"
  },
  phase: "field_follow_up",
  owner_display: "Photo Lead",
  owner_type: "user",
  job_date: "2026-06-05",
  next_deadline_at: "2026-06-08T12:00:00.000Z",
  deadline_state: "due_soon",
  waiting_on_party: "none",
  health: "due_soon",
  health_reasons: ["Post-shoot evaluation needs review"],
  file_status: "qa_review",
  missing_info_flags: [],
  rework_count: 0,
  blocked_reason: null,
  queue_intelligence: {
    reason: "Photography follow-up is due soon.",
    trigger: "due_soon",
    owner_lane: "Photography",
    next_action: "Review post-shoot evaluation and setup references.",
    clear_condition: "Evaluation is complete and references are attached.",
    operational_status: "needs_action"
  },
  updated_at: "2026-06-05T12:00:00.000Z"
} as unknown as ProjectWorkflowJobRow;

const photographyActionHashWorkflowRow = {
  ...photographyWorkflowRow,
  job_id: "job-photo-action-hash",
  job_number: "PHO-2002",
  job_code: "PHO-2002",
  job_title: "Setup Photo Follow-Up",
  workflow_run_id: null,
  action_hash: "#project-tracking/workflows/workflow-photo-action",
  current_step: {
    ...photographyWorkflowRow.current_step,
    id: "step-photo-action",
    name: "Confirm setup photo references"
  },
  queue_intelligence: {
    ...photographyWorkflowRow.queue_intelligence,
    next_action: "Attach the missing setup reference photo."
  }
} as unknown as ProjectWorkflowJobRow;

function localDateKeyForTest(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

const cleanIntegration: ScheduleRecordIntegrationState = {
  provider: "outlook",
  link_state: "not_linked",
  source_of_truth: "mission_control",
  sync_state: "not_linked",
  sync_health: "neutral",
  sync_required: false,
  manual_review_required: false,
  review_reason: null,
  external_record_id: null,
  external_calendar_id: null,
  last_synced_at: null,
  last_sync_direction: "none",
  last_sync_error: null,
  external_last_modified_at: null,
  changed_fields: [],
  changed_field_labels: [],
  source_system: null,
  pending_external_changes: false,
  stale_data_warning: false,
  recommended_next_action: null
};

function buildSharedJob(overrides: Partial<SharedJobListItem> = {}): SharedJobListItem {
  return {
    id: "job-1",
    tenant_id: "tenant-demo",
    legacy_shoot_id: null,
    job_number: "SCH-101",
    department_type: "schools",
    job_category: "photo_day",
    organization_id: "org-1",
    primary_location_id: "loc-1",
    primary_contact_id: "contact-1",
    account_owner_user_id: "account-owner-1",
    title: "Spring Picture Day",
    event_name: null,
    description_internal: null,
    job_status: "ready_to_execute",
    production_status: "queued",
    staffing_status: "ready_confirmed",
    readiness_status: "ready",
    sync_status: "clean",
    risk_status: "low",
    priority_level: "normal",
    delivery_type: null,
    gallery_type: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    timezone: "America/Chicago",
    estimated_subject_count: 100,
    actual_subject_count: null,
    estimated_staff_count: 4,
    actual_staff_count: 3,
    client_deadline_at: null,
    production_deadline_at: null,
    published_at: null,
    archived_at: null,
    cancelled_at: null,
    cancel_reason: null,
    production_required: true,
    location_override_note: null,
    contact_override_note: null,
    created_by_user_id: null,
    updated_by_user_id: null,
    created_at: "2026-04-01T10:00:00.000Z",
    updated_at: "2026-04-01T10:00:00.000Z",
    organization_name: "Lakeview High School",
    primary_location_name: "Main Gym",
    primary_location_address: "123 Lakeview Ave",
    primary_contact_name: "Jordan Lee",
    account_owner_name: "Alex Account",
    lead_owner_user_id: "user-photo",
    lead_owner_name: "Photo Lead",
    primary_day_date: "2026-04-10",
    primary_day_start_time: "08:00",
    primary_day_end_time: "13:00",
    primary_day_label: "Picture Day",
    school_profile: null,
    sports_profile: null,
    department_summary: {},
    proof_status: null,
    open_watch_flag_count: 0,
    readiness_percent: 100,
    blocker_count: 0,
    day_count: 1,
    assigned_staff_count: 4,
    checked_in_staff_count: 0,
    ready_present_count: 4,
    ...overrides
  };
}

function buildScheduleShoot(overrides: Partial<UnifiedScheduleShootItem> = {}): UnifiedScheduleShootItem {
  return {
    item_kind: "shoot",
    id: "schedule-shoot-1",
    shoot_id: "schedule-shoot-1",
    date_key: "2026-06-10",
    title: "Spring Picture Day",
    shoot_code: "SCH-101",
    department: "schools",
    shoot_category: "schools",
    status: "ready",
    starts_at: "2026-06-10T08:30:00.000Z",
    ends_at: "2026-06-10T12:00:00.000Z",
    showtime: null,
    arrival_time: null,
    start_time: null,
    end_time_est: null,
    location_name: "Lakeview High School",
    location_address: "123 Lakeview Ave",
    navigation_url: null,
    estimated_drive_minutes: null,
    projected_students: 100,
    planned_staff_count: 4,
    assigned_staff_count: 4,
    required_lead_count: 1,
    lead_coverage_count: 1,
    lead_name: "Carisa Lead",
    operations_priority: "standard",
    big_shoot_manual_override: false,
    special_equipment: null,
    missing_fields: [],
    open_alert_count: 0,
    open_attendance_exception_count: 0,
    schedule_sync_state: "clean",
    schedule_sync_required: false,
    staffing_state: "staffed",
    staffing_health_state: "healthy",
    staffing_health_label: "Staffed",
    staffing_detail_visibility: "limited",
    staffing_gap_count: 0,
    unconfirmed_staff_count: 0,
    scale_label: "Standard",
    priority_label: null,
    priority_label_display: null,
    priority_reasons: [],
    future_profitability_flag: null,
    future_profitability_display: null,
    board_day_part: "morning",
    under_staffed: false,
    missing_lead: false,
    over_staffed: false,
    conflict_warning_count: 0,
    draft_shift_count: 0,
    published_shift_count: 0,
    publish_state: "published",
    integration: cleanIntegration,
    ...overrides
  };
}

function buildSharedJobDetail(job: SharedJobListItem): SharedJobDetailResponse {
  return {
    job,
    summary: {
      organization_name: job.organization_name,
      organization_account_type: "school",
      primary_location_name: job.primary_location_name,
      primary_location_address: job.primary_location_address,
      primary_contact_name: job.primary_contact_name,
      primary_contact_title: "Athletics Coordinator",
      account_owner_name: job.account_owner_name,
      lead_owner_user_id: job.lead_owner_user_id,
      lead_owner_name: job.lead_owner_name,
      primary_day_date: job.primary_day_date,
      primary_day_start_time: job.primary_day_start_time,
      primary_day_end_time: job.primary_day_end_time,
      primary_day_label: job.primary_day_label,
      latest_activity_at: null,
      department_summary: {},
      proof_status: null
    },
    school_profile: null,
    sports_profile: {
      job_id: job.id,
      tenant_id: job.tenant_id,
      sport_type: "Football",
      season: "Fall",
      league_name: null,
      division: null,
      team_structure: null,
      estimated_team_count: 4,
      proof_required: true,
      approval_contact_id: null,
      approval_contact_name: null,
      billing_contact_id: null,
      billing_contact_name: null,
      revenue_share_enabled: null,
      revenue_share_terms_summary: null,
      banner_work_required: false,
      specialty_products_required: false,
      buddy_photos_required: false,
      sponsor_graphics_required: false,
      client_expectations_notes: "Coach wants a heads-up if athlete pacing falls behind."
    },
    job_shoot_links: [],
    days: [
      {
        id: "day-travel",
        tenant_id: job.tenant_id,
        job_id: job.id,
        legacy_shoot_day_id: null,
        day_label: "Media Day",
        date: "2026-06-18",
        start_time: "09:30",
        end_time: "12:00",
        timezone: "America/Chicago",
        location_id: "loc-north-metro",
        location_name: "North Metro Stadium",
        onsite_contact_id: "contact-riley",
        onsite_contact_name: "Riley Hart",
        lead_user_id: "user-photo",
        lead_user_name: "Carisa Lead",
        day_status: "ready",
        weather_sensitive: true,
        indoor_outdoor: "outdoor",
        access_notes: "Check in at the fieldhouse door before unloading.",
        parking_notes: "Use the east athlete gate and keep a runner by the fieldhouse door.",
        setup_notes: "Weighted sideline staging only.",
        travel_notes: "Stadium traffic is heavier than normal but inside the planned buffer.",
        check_in_window_start: "09:00",
        check_in_window_end: "09:15",
        ready_confirmed_at: null,
        ready_confirmed_by_user_id: null,
        created_at: "2026-06-01T10:00:00.000Z",
        updated_at: "2026-06-01T10:00:00.000Z"
      }
    ],
    staff_assignments: [
      {
        id: "assignment-lead",
        tenant_id: job.tenant_id,
        job_id: job.id,
        job_day_id: "day-travel",
        user_id: "user-photo",
        user_name: "Carisa Lead",
        assignment_role: "lead_photographer",
        assignment_status: "confirmed",
        is_lead: true,
        check_in_at: null,
        check_out_at: null,
        is_ready_present: true,
        notes: null,
        created_at: "2026-06-01T10:00:00.000Z",
        updated_at: "2026-06-01T10:00:00.000Z"
      },
      {
        id: "assignment-second",
        tenant_id: job.tenant_id,
        job_id: job.id,
        job_day_id: "day-travel",
        user_id: "user-second",
        user_name: "Senior Photographer",
        assignment_role: "photographer",
        assignment_status: "confirmed",
        is_lead: false,
        check_in_at: null,
        check_out_at: null,
        is_ready_present: true,
        notes: null,
        created_at: "2026-06-01T10:00:00.000Z",
        updated_at: "2026-06-01T10:00:00.000Z"
      }
    ],
    readiness_items: [
      {
        id: "readiness-arrival-packet",
        tenant_id: job.tenant_id,
        job_id: job.id,
        job_day_id: "day-travel",
        section_key: "field_prep",
        label: "Confirm arrival packet",
        description: "Confirm senior photographers have the packet before travel.",
        is_required: true,
        is_blocker: false,
        is_complete: false,
        completed_at: null,
        completed_by_user_id: null,
        completed_by_name: null,
        due_at: null,
        sort_order: 1,
        source_template_key: null,
        notes: "Packet should include QR document and setup reference.",
        created_at: "2026-06-01T10:00:00.000Z",
        updated_at: "2026-06-01T10:00:00.000Z"
      },
      {
        id: "readiness-parking-notes",
        tenant_id: job.tenant_id,
        job_id: job.id,
        job_day_id: "day-travel",
        section_key: "field_prep",
        label: "Review parking notes",
        description: null,
        is_required: true,
        is_blocker: false,
        is_complete: true,
        completed_at: "2026-06-01T10:00:00.000Z",
        completed_by_user_id: "user-photo",
        completed_by_name: "Carisa Lead",
        due_at: null,
        sort_order: 2,
        source_template_key: null,
        notes: null,
        created_at: "2026-06-01T10:00:00.000Z",
        updated_at: "2026-06-01T10:00:00.000Z"
      }
    ],
    production_items: [
      {
        id: "production-prior-eval",
        tenant_id: job.tenant_id,
        job_id: job.id,
        title: "Prior post-shoot evaluation",
        post_shoot_eval_summary: "Last year: staging worked well, but add a second runner during peak athlete arrivals.",
        internal_notes: null
      }
    ] as SharedJobDetailResponse["production_items"],
    production_item_shoot_links: [],
    production_handoffs: [],
    approval_requests: [],
    qa_reviews: [],
    qa_findings: [],
    deliverable_items: [],
    production_issues: [],
    production_blockers: [],
    watch_flags: [],
    activity: [],
    status: {
      readiness_percent: job.readiness_percent,
      job_status: job.job_status,
      production_status: job.production_status,
      staffing_status: job.staffing_status,
      readiness_status: job.readiness_status,
      risk_status: job.risk_status,
      blocker_count: job.blocker_count,
      open_watch_flag_count: job.open_watch_flag_count
    },
    workflow: {} as SharedJobDetailResponse["workflow"],
    prep_readiness: {
      preview_only: true,
      generated_at: "2026-06-01T10:00:00.000Z",
      status: "ready",
      client_prep: {
        account_name: job.organization_name,
        job_name: job.title,
        job_date: job.primary_day_date,
        primary_location: {
          id: "loc-north-metro",
          location_name: "North Metro Stadium",
          address_display: "2500 Stadium Drive, Plymouth, MN 55447",
          google_maps_url: null,
          client_facing_notes: null,
          reference_attachments: [
            {
              id: "attachment-client-map",
              title: "Client check-in map PDF",
              description: "Client-facing map packet.",
              attachment_type: "qr_code_job_document",
              audience: "client_facing",
              file_url: "https://example.test/check-in-map.pdf",
              storage_key: null
            }
          ]
        },
        eligible_email_recipients: [
          {
            id: "contact-riley",
            display_name: "Riley Hart",
            title: "Athletics Coordinator",
            email: "riley.hart@example.com",
            mobile_phone: "555-0142",
            client_roles: ["photo_day_contact"]
          }
        ],
        eligible_sms_recipients: [],
        excluded_contacts: []
      },
      employee_briefing: {
        primary_location: {
          id: "loc-north-metro",
          location_name: "North Metro Stadium",
          address_display: "2500 Stadium Drive, Plymouth, MN 55447",
          google_maps_url: null,
          client_facing_notes: null,
          navigation_notes: "Plan a small arrival buffer for stadium traffic.",
          parking_instructions: "Use the east athlete gate and keep a runner by the fieldhouse door.",
          entrance_instructions: "Enter through the fieldhouse door.",
          unloading_instructions: "Unload cases at the east curb, then move vehicles.",
          setup_area: "Sideline staging near the fieldhouse.",
          backup_indoor_location: null,
          accessibility_notes: null,
          power_availability_notes: null,
          wifi_cell_notes: null,
          security_checkin_requirements: null,
          weather_contingency_notes: null,
          employee_facing_notes: "Keep team warmup lanes clear.",
          internal_only_notes: null,
          reference_attachments: [
            {
              id: "attachment-qr-packet",
              title: "Check-in QR Packet",
              description: "PDF packet for field check-in.",
              attachment_type: "qr_code_job_document",
              audience: "employee_facing",
              file_url: "https://example.test/check-in-qr.pdf",
              storage_key: null
            },
            {
              id: "attachment-setup-photo",
              title: "Best reference setup photo",
              description: "Prior successful setup angle.",
              attachment_type: "setup_photo",
              audience: "employee_facing",
              file_url: "https://example.test/setup-photo.jpg",
              storage_key: null
            }
          ]
        }
      },
      message_previews: {
        client_prep_email: {
          preview_only: true,
          template_key: "client_prep_email_v1",
          label: "Client prep email",
          channel: "email",
          can_preview: true,
          recipients: [],
          subject: "North Metro Stadium Media Day prep",
          body_lines: ["Please have athletes ready near the fieldhouse entrance."],
          warnings: [],
          reference_attachments: []
        },
        client_prep_sms: {
          preview_only: true,
          template_key: "client_prep_sms_v1",
          label: "Client prep SMS",
          channel: "sms",
          can_preview: true,
          recipients: [],
          subject: null,
          body_lines: ["Mission Control reminder for photo day."],
          warnings: [],
          reference_attachments: []
        },
        employee_briefing: {
          preview_only: true,
          template_key: "employee_briefing_v1",
          label: "Employee briefing",
          channel: "internal_briefing",
          can_preview: true,
          recipients: [],
          subject: "Field briefing",
          body_lines: ["Arrive early enough to clear the east athlete gate before warmups."],
          warnings: [],
          reference_attachments: [
            {
              id: "attachment-briefing-reference",
              title: "Fieldhouse reference photo",
              description: "Internal reference photo.",
              attachment_type: "location_reference",
              audience: "employee_facing",
              file_url: "https://example.test/fieldhouse-reference.jpg",
              storage_key: null
            }
          ]
        }
      },
      warnings: []
    },
    policy: {} as SharedJobDetailResponse["policy"]
  };
}

describe("StudiosWorkspace", () => {
  beforeEach(() => {
    listSharedJobsMock.mockReset();
    getSharedJobDetailMock.mockReset();
    apiFetchMock.mockReset();
    getProjectWorkflowCommandCenterMock.mockReset();
    getProjectWorkflowCommandCenterMock.mockResolvedValue({
      generated_at: "2026-06-05T12:00:00.000Z",
      view: "department",
      summary: {},
      alerts: [],
      steps: [],
      job_rows: [photographyWorkflowRow, photographyActionHashWorkflowRow]
    });
    window.location.hash = "#studios";
  });

  afterEach(() => {
    cleanup();
  });

  it("renders Photography as a field command hub with work-spine and blocker links", async () => {
    const today = localDateKeyForTest();
    listSharedJobsMock.mockResolvedValue({
      jobs: [
        buildSharedJob({
          id: "job-home-early",
          title: "North Metro Stadium Media Day",
          organization_name: "North Metro Athletics",
          primary_location_name: "North Metro Stadium",
          primary_day_date: today,
          primary_day_start_time: "09:30",
          primary_day_end_time: "12:00",
          lead_owner_name: "Carisa Lead",
          assigned_staff_count: 3,
          ready_present_count: 2,
          readiness_percent: 82,
          open_watch_flag_count: 1,
          blocker_count: 1
        })
      ]
    });
    render(<StudiosWorkspace token="token-demo" currentUser={currentUser} />);

    expect(await screen.findByRole("heading", { level: 2, name: "Photography Command Hub" })).toBeInTheDocument();
    expect(screen.getByText("Run today's shoots, job prep, travel, senior photographer coverage, and post-shoot handoffs.")).toBeInTheDocument();
    expect(screen.getByText("Open First")).toBeInTheDocument();
    expect(screen.getByText("Attention Needed")).toBeInTheDocument();
    expect(screen.getByText("This Week's Work")).toBeInTheDocument();
    expect(screen.getByText("Work Queues")).toBeInTheDocument();
    expect(screen.getByText("Travel / Load-In")).toBeInTheDocument();
    expect(screen.getByText("Post-Shoot Handoffs")).toBeInTheDocument();
    expect(listSharedJobsMock).toHaveBeenCalledWith("token-demo", { day_date: today });
    expect(screen.getByRole("heading", { level: 3, name: "Today's Photography Shoots" })).toBeInTheDocument();
    expect(screen.getAllByText("Today's Shoots").length).toBeGreaterThan(0);
    expect(screen.getByText("Ready to Go")).toBeInTheDocument();
    expect(screen.getByText("Needs Prep")).toBeInTheDocument();
    expect(screen.getByText("Travel Notes")).toBeInTheDocument();
    expect(screen.getByText("Post-Shoot Evals")).toBeInTheDocument();
    expect(screen.getByText("Recently Changed")).toBeInTheDocument();
    expect(screen.getAllByText("North Metro Stadium Media Day").length).toBeGreaterThan(0);
    expect(screen.getByText("North Metro Stadium")).toBeInTheDocument();
    expect(screen.getByText("Carisa Lead")).toBeInTheDocument();
    expect(screen.getByText("3 assigned / 2 active")).toBeInTheDocument();
    expect(screen.getByText("1 blocker")).toBeInTheDocument();
    expect(screen.getByText(/82% ready/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Travel details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Job Prep" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open work" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Project Tracking" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review Job Prep" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Senior Photographer View" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30-Day Planning Calendar" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 3, name: "Photography Active Work" })).toBeInTheDocument();
    expect(screen.getByLabelText("Photography Active Work summary")).toBeInTheDocument();
    expect(screen.getByText("Review post-shoot evaluation and setup references.")).toBeInTheDocument();
    const workflowLinks = screen.getAllByRole("link", { name: "View Workflow" }).map((link) => link.getAttribute("href"));
    expect(workflowLinks).toContain("#project-tracking/workflows/workflow-photo-1");
    expect(workflowLinks).toContain("#project-tracking/workflows/workflow-photo-action");

    fireEvent.click(screen.getByRole("button", { name: "30-Day Planning Calendar" }));
    await waitFor(() => {
      expect(window.location.hash).toBe("#studios/calendar");
    });

    expect(screen.getByRole("button", { name: "Post-Shoot Evaluation" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: "30-Day Photography Calendar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Photography 30-Day Calendar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "My Schedule" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "My Work" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Today" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Staffing/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Attendance/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Compact Active Work")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Job \/ Event/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Studios Task/i })).not.toBeInTheDocument();
  });

  it("renders Job Prep as the consolidated Pre-Service and Readiness packet", async () => {
    const prepJob = buildSharedJob({
      id: "job-prep",
      title: "North Metro Stadium Media Day",
      organization_name: "North Metro Athletics",
      primary_location_name: "North Metro Stadium",
      primary_location_address: "2500 Stadium Drive, Plymouth, MN 55447",
      primary_contact_name: "Riley Hart",
      primary_day_date: "2026-06-18",
      primary_day_start_time: "09:30",
      primary_day_end_time: "12:00",
      estimated_subject_count: 220,
      lead_owner_name: "Carisa Lead"
    });
    listSharedJobsMock.mockResolvedValue({ jobs: [prepJob] });
    getSharedJobDetailMock.mockResolvedValue(buildSharedJobDetail(prepJob));

    render(<StudiosWorkspace token="token-demo" currentUser={currentUser} focus="pre_service" />);

    expect(await screen.findByRole("heading", { level: 2, name: "Job Prep / Pre-Service" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 3, name: "North Metro Stadium Media Day" })).toBeInTheDocument();
    expect(screen.getAllByText("North Metro Athletics").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { level: 4, name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByText("Time: 9:30 AM-12:00 PM")).toBeInTheDocument();
    expect(screen.getByText("Estimated volume: 220")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Location" })).toBeInTheDocument();
    expect(screen.getByText("North Metro Stadium")).toBeInTheDocument();
    expect(screen.getByText("2500 Stadium Drive, Plymouth, MN 55447")).toBeInTheDocument();
    expect(screen.getByText("Primary: Riley Hart")).toBeInTheDocument();
    expect(screen.getByText("Lead photographer: Carisa Lead")).toBeInTheDocument();
    expect(await screen.findByText("Arrive early enough to clear the east athlete gate before warmups.")).toBeInTheDocument();
    expect(screen.getByText("Confirm arrival packet - required")).toBeInTheDocument();
    expect(screen.getByText("Review parking notes - complete")).toBeInTheDocument();
    expect(screen.getByText("Last year: staging worked well, but add a second runner during peak athlete arrivals.")).toBeInTheDocument();
    expect(screen.getByText("No customer survey notes are in this seeded packet yet.")).toBeInTheDocument();
    expect(screen.getByText("Check-in QR Packet")).toBeInTheDocument();
    expect(screen.getByText("Client check-in map PDF")).toBeInTheDocument();
    expect(screen.getByText("Best reference setup photo")).toBeInTheDocument();
    expect(screen.getByText("Fieldhouse reference photo")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Shoot References" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Setup References" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Travel Details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open work" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Project Tracking" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review Job Prep" })).toBeInTheDocument();

    expect(screen.queryByText("Reference Packet")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Travel & Logistics" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "My Work" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compact List" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Board" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Full Workspace" })).not.toBeInTheDocument();
  });

  it("keeps the old Readiness route as a thin compatibility path into Job Prep", async () => {
    const prepJob = buildSharedJob({ id: "job-readiness", title: "North Metro Stadium Media Day" });
    listSharedJobsMock.mockResolvedValue({ jobs: [prepJob] });
    getSharedJobDetailMock.mockResolvedValue(buildSharedJobDetail(prepJob));

    render(<StudiosWorkspace token="token-demo" currentUser={currentUser} focus="readiness" />);

    expect(await screen.findByRole("heading", { level: 2, name: "Job Prep / Pre-Service" })).toBeInTheDocument();
    expect(screen.getByText("Readiness is part of Job Prep / Pre-Service. Use this packet for readiness, notes, resources, and crew context.")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 3, name: "North Metro Stadium Media Day" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Readiness Inside Job Prep" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compact List" })).not.toBeInTheDocument();
  });

  it("renders a Photography-specific Day at a Glance route without generic create-task actions", async () => {
    const today = localDateKeyForTest();
    listSharedJobsMock.mockResolvedValue({
      jobs: [
        buildSharedJob({
          id: "job-today-later",
          title: "Senior Banner Session",
          organization_name: "North Metro Athletics",
          primary_location_name: "North Metro Fieldhouse",
          primary_day_date: today,
          primary_day_start_time: "13:30",
          primary_day_end_time: "15:00",
          lead_owner_name: "Senior Photographer",
          assigned_staff_count: 2,
          ready_present_count: 1,
          readiness_percent: 100,
          open_watch_flag_count: 0
        }),
        buildSharedJob({
          id: "job-today-early",
          title: "North Metro Stadium Media Day",
          organization_name: "North Metro Athletics",
          primary_location_name: "North Metro Stadium",
          primary_day_date: today,
          primary_day_start_time: "09:30",
          primary_day_end_time: "12:00",
          lead_owner_name: "Carisa Lead",
          assigned_staff_count: 3,
          ready_present_count: 2,
          readiness_percent: 82,
          open_watch_flag_count: 1,
          blocker_count: 1
        })
      ]
    });

    render(<StudiosWorkspace token="token-demo" currentUser={currentUser} focus="today" />);

    expect(await screen.findByRole("heading", { level: 2, name: "Day at a Glance" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Today's Photography Shoots" })).toBeInTheDocument();
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(screen.getByText("shoots today")).toBeInTheDocument();
    expect(screen.getByText("red flag")).toBeInTheDocument();
    expect(screen.getByText("watch flag")).toBeInTheDocument();
    expect(screen.getByText("North Metro Stadium Media Day")).toBeInTheDocument();
    expect(screen.getByText("Senior Banner Session")).toBeInTheDocument();
    expect(screen.getByText("9:30 AM-12:00 PM")).toBeInTheDocument();
    expect(screen.getByText("1:30 PM-3:00 PM")).toBeInTheDocument();
    expect(screen.getAllByText("North Metro Athletics").length).toBeGreaterThan(0);
    expect(screen.getByText("North Metro Stadium")).toBeInTheDocument();
    expect(screen.getByText("Carisa Lead")).toBeInTheDocument();
    expect(screen.getByText("3 assigned / 2 active")).toBeInTheDocument();
    expect(screen.getByText("1 blocker")).toBeInTheDocument();
    expect(screen.getByText(/82% ready/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Job Prep" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Travel details" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Open work" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Open Project Tracking" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Review Job Prep" }).length).toBeGreaterThan(0);
    expect(screen.getByText("North Metro Stadium Media Day").compareDocumentPosition(screen.getByText("Senior Banner Session"))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByText("Department Focus")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Photography route shortcuts")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "My Work" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create Task/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/school task/i)).not.toBeInTheDocument();
  });

  it("renders Travel as a field-ready overview with maps and without dead pilot controls", async () => {
    const travelJob = buildSharedJob({
      id: "job-travel",
      title: "North Metro Stadium Media Day",
      organization_name: "North Metro Athletics",
      primary_location_name: "North Metro Stadium",
      primary_location_address: "2500 Stadium Drive, Plymouth, MN 55447",
      primary_contact_name: "Riley Hart",
      primary_day_date: "2026-06-18",
      primary_day_start_time: "09:30",
      primary_day_end_time: "12:00",
      assigned_staff_count: 3,
      ready_present_count: 2,
      lead_owner_name: "Carisa Lead"
    });
    listSharedJobsMock.mockResolvedValue({ jobs: [travelJob] });
    getSharedJobDetailMock.mockResolvedValue(buildSharedJobDetail(travelJob));

    render(<StudiosWorkspace token="token-demo" currentUser={currentUser} focus="travel" />);

    expect(await screen.findByRole("heading", { level: 2, name: "Travel & Logistics" })).toBeInTheDocument();
    expect(await screen.findByText("North Metro Stadium Media Day")).toBeInTheDocument();
    expect(screen.getByText("North Metro Athletics")).toBeInTheDocument();
    expect(screen.getByText("North Metro Stadium")).toBeInTheDocument();
    expect(screen.getByText("2500 Stadium Drive, Plymouth, MN 55447")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in Google Maps" })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=2500%20Stadium%20Drive%2C%20Plymouth%2C%20MN%2055447"
    );
    expect(screen.getByText("Primary: Riley Hart")).toBeInTheDocument();
    expect(await screen.findByText("Phone: 555-0142")).toBeInTheDocument();
    expect(screen.getByText("Lead photographer: Carisa Lead")).toBeInTheDocument();
    expect(screen.getByText(/Use the east athlete gate/i)).toBeInTheDocument();
    expect(screen.getByText("Leadership handles staffing and attendance review so this page stays focused on field travel.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Job Prep" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open work" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Project Tracking" })).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Open Sample Map" })).not.toBeInTheDocument();
    expect(screen.queryByText("Travel Cleanup")).not.toBeInTheDocument();
    expect(screen.queryByText("Travel Visibility")).not.toBeInTheDocument();
    expect(screen.queryByText("Location Prep")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "My Work" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Team Work" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compact List" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Board" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More Filters" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Full Workspace" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30-Day Calendar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Day at a Glance" })).toBeInTheDocument();
  });

  it("routes studios shoots to the Photography Today surface", () => {
    const routeId = resolveRouteId("#studios/shoots", availableTabs, false);
    expect(routeId).toBe("studios-shoots");
    expect(getRouteById(routeId)?.render).toEqual({ kind: "studios-workspace", focus: "today" });
    expect(getRouteById(routeId)?.label).toBe("Day at a Glance");
  });

  it("keeps staffing and attendance owned by Leadership navigation instead of Photography", () => {
    const photographyRoutes = getVisibleChildRoutes("photography", availableTabs, false);
    const leadershipRoutes = getVisibleChildRoutes("leadership", availableTabs, false);
    const photographyRouteIds = photographyRoutes.map((route) => route.id);
    const leadershipRouteIds = leadershipRoutes.map((route) => route.id);

    expect(photographyRouteIds).toEqual([
      "studios-shoots",
      "studios-pre-service",
      "studios-travel",
      "job-closeout-v1",
      "studios-workload",
      "studios-calendar"
    ]);
    expect(photographyRouteIds).not.toContain("studios-staffing");
    expect(photographyRouteIds).not.toContain("operations-attendance");
    expect(getRouteById("studios-pre-service")?.label).toBe("Job Prep / Pre-Service");
    expect(getRouteById("studios-readiness")?.label).toBe("Readiness (Job Prep)");
    expect(getRouteById("studios-readiness")?.showInSectionNav).toBe(false);

    expect(leadershipRouteIds[0]).toBe("operations-staffing");
    expect(leadershipRouteIds[1]).toBe("operations-attendance");
    expect(getRouteById("operations-staffing")?.label).toBe("Staff Assignment Board");
    expect(getRouteById("operations-attendance")?.canonicalHash).toBe("#employees/attendance");
  });

  it("routes old Photography staffing deep links to the Leadership staff assignment board", () => {
    expect(resolveRouteId("#photography/staffing", availableTabs, false)).toBe("operations-staffing");
    expect(resolveRouteId("#studios/staffing", availableTabs, false)).toBe("operations-staffing");
    expect(resolveRouteId("#schedule/assignment-board", availableTabs, false)).toBe("operations-staffing");
    expect(resolveRouteId("#employees/attendance", availableTabs, false)).toBe("operations-attendance");
  });

  it("opens Photography calendar as a readable read-only 30-day view with a week toggle", async () => {
    window.location.hash = "#studios/calendar";
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/shifts/resources/members")) {
        return [{ id: currentUser.id, full_name: currentUser.fullName, department: currentUser.department, roles: currentUser.roles }];
      }
      if (path.startsWith("/api/schedule/calendar?")) {
        return {
          range: { start_date: "2026-06-01", end_date: "2026-06-30" },
          items: [
            buildScheduleShoot(),
            buildScheduleShoot({
              id: "schedule-shoot-2",
              shoot_id: "schedule-shoot-2",
              date_key: "2026-06-10",
              title: "Senior Banner Session",
              shoot_code: "SCH-102",
              starts_at: "2026-06-10T13:00:00.000Z",
              ends_at: "2026-06-10T15:00:00.000Z",
              open_alert_count: 1,
              staffing_health_state: "watch"
            }),
            buildScheduleShoot({
              id: "schedule-shoot-3",
              shoot_id: "schedule-shoot-3",
              date_key: "2026-06-10",
              title: "Makeup Portraits",
              shoot_code: "SCH-103",
              starts_at: "2026-06-10T16:00:00.000Z",
              ends_at: "2026-06-10T17:00:00.000Z"
            })
          ],
          sync: {
            source_of_truth: "outlook_mock",
            outlook_connected: false,
            outlook_health_state: "OUTLOOK_MOCK",
            pending_sync_count: 3
          }
        };
      }
      if (path.startsWith("/api/shifts?")) {
        return [];
      }
      return [];
    });

    render(<Schedule token="token-demo" currentUser={currentUser} />);

    expect(await screen.findByRole("heading", { name: "Photography Calendar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30-Day" })).toHaveClass("is-active");
    expect(screen.getByRole("button", { name: "Week" })).toBeInTheDocument();
    expect(screen.getByText("Spring Picture Day")).toBeInTheDocument();
    expect(screen.getByText("Senior Banner Session")).toBeInTheDocument();
    expect(screen.getByText("+1 more")).toBeInTheDocument();
    expect(screen.getByText("Read-only calendar")).toBeInTheDocument();
    expect(screen.queryByText("Company scope")).not.toBeInTheDocument();
    expect(screen.queryByText("Job Schedule")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Day" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "3-Day" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "List" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Staffing Schedule/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Coverage Requests/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Staff Shoot/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/OUTLOOK MOCK/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pending sync/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Week" })).toHaveClass("is-active");
    });
    expect(screen.getByText("Day Briefing")).toBeInTheDocument();
    expect(screen.queryByText("Open Shoot Workspace")).not.toBeInTheDocument();
  });

  it("keeps focused subpages above the repeated homepage launch stack and labels workload for senior photographers", async () => {
    listSharedJobsMock.mockResolvedValue({ jobs: [] });

    render(<StudiosWorkspace token="token-demo" currentUser={currentUser} focus="workload" />);

    expect(await screen.findByRole("heading", { level: 2, name: "Senior Photographer View" })).toBeInTheDocument();
    expect(screen.queryByText("Open First")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open 30-Day Calendar/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Senior Photographer View" })).toBeInTheDocument();
  });
});
