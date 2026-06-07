// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MyWork } from "../pages/MyWork";
import type { SessionUser } from "../types";

const apiFetchMock = vi.fn();

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

vi.mock("../api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  apiUrl: "http://localhost:4000"
}));

const fieldUser: SessionUser = {
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
  permissions: ["schedule.read", "time.clock", "trade.request", "attendance_exceptions.create", "media.attach", "notification.read", "shoot.read"],
  authorityTier: "standard_employee",
  primaryJobFunctionProfile: "seasonal_photographer",
  jobFunctionProfiles: ["seasonal_photographer"],
  permissionGrants: [],
  effectiveScopes: ["own_shift_only"],
  sessionTrust: standardSessionTrust
};

const myWorkResponse = {
  anchor_date: "2026-03-26",
  window_end_date: "2026-04-02",
  summary: {
    events_today: 1,
    upcoming_events: 1,
    shifts_today: 1,
    upcoming_shifts: 1,
    pending_trade_requests: 1,
    unread_notifications: 2,
    clocked_in_shift_count: 0,
    attention_needed_count: 2,
    closeout_due_count: 1,
    late_or_exception_count: 1,
    mileage_review_count: 1,
    assigned_job_count: 1,
    assigned_event_count: 1,
    assigned_task_count: 2,
    live_workflow_step_count: 1,
    acknowledgement_count: 1,
    owned_exception_count: 1,
    approval_waiting_count: 1,
    recent_change_count: 4,
    next_event_label: "DEMO-001 at 2:15 PM",
    next_shift_label: "DEMO-001 at 2:15 PM"
  },
  shifts: [
    {
      id: "shift-1",
      shoot_id: "shoot-1",
      shoot_code: "DEMO-001",
      shoot_title: "Spring Portrait Day",
      shoot_date: "2026-03-26",
      title: "Primary Photographer",
      shift_kind: "shoot",
      status: "published",
      department: "schools",
      staffing_role: "photographer",
      satisfies_lead_coverage: false,
      starts_at: "2026-03-26T19:15:00.000Z",
      ends_at: "2026-03-26T23:00:00.000Z",
      location_name: "Lincoln Elementary",
      location_address: "123 School Street",
      navigation_url: "https://maps.example/lincoln",
      manager_name: "Demo Senior Photographer",
      attendance_state: null,
      attendance_state_note: null,
      latest_punch_direction: null,
      latest_punch_at: null,
      latest_geofence_status: null,
      latest_punch_approval_state: null,
      has_pre_service_notes: true,
      notes_acknowledged: false,
      note_summary: "Use the east gym doors and keep the portable risers tight to the wall.",
      trade_request_count: 1,
      open_exception_count: 1,
      follow_through_label: "1 closeout item due",
      follow_through_tone: "action_needed",
      closeout_missing_count: 1,
      mileage_status: "review_required",
      mileage_issue_label: "Post-Shoot Evaluation still missing"
    }
  ],
  notifications: [
    {
      id: "notification-1",
      notification_type: "schedule.shift_published",
      channel: "in_app",
      priority: "high",
      status: "sent",
      title: "Shift updated",
      body: "Your published shift is ready for review.",
      deep_link: "/my-work",
      created_at: "2026-03-26T15:10:00.000Z"
    }
  ],
  jobs: [
    {
      id: "job-1",
      job_number: "JOB-100",
      title: "Spring Portrait Day",
      department: "schools",
      status: "staffed",
      status_label: "Staffed",
      organization_display_name: "Lincoln Elementary",
      assigned_task_count: 2,
      assigned_event_count: 1,
      assigned_workflow_step_count: 1,
      open_exception_count: 1,
      next_event_at: "2026-03-26T19:15:00.000Z"
    }
  ],
  live_workflow_steps: [
    {
      id: "workflow-step-1",
      workflow_run_id: "workflow-run-1",
      job_id: "job-1",
      job_number: "JOB-100",
      job_title: "Spring Portrait Day",
      organization_display_name: "Lincoln Elementary",
      step_name: "Confirm Files",
      department: "production",
      assigned_user_id: "user-photo",
      assigned_queue: "production",
      assignment_status: "assigned",
      status: "IN_PROGRESS" as const,
      status_label: "In Progress",
      operational_status: "active",
      next_action: "Work the current step: Confirm Files.",
      clear_condition: "Clear when the current step completes or advances.",
      due_at: "2026-03-27T17:00:00.000Z",
      waiting_on_party: null,
      waiting_detail: null,
      notes: "Edit proof set before parent preview.",
      blocked_reason: null,
      updated_at: "2026-03-26T16:00:00.000Z",
      deep_link: "#project-tracking/workflows/workflow-run-1"
    }
  ],
  events: [
    {
      id: "shift-1",
      event_id: "shift-1",
      source: "work_shift",
      source_record_type: "work_shift",
      source_record_id: "shift-1",
      shift_id: "shift-1",
      linked_job_id: "job-1",
      linked_job_number: "JOB-100",
      linked_job_title: "Spring Portrait Day",
      title: "DEMO-001",
      subtitle: "Spring Portrait Day",
      department: "schools",
      staffing_role: "photographer",
      status: "published",
      starts_at: "2026-03-26T19:15:00.000Z",
      ends_at: "2026-03-26T23:00:00.000Z",
      location_name: "Lincoln Elementary",
      location_address: "123 School Street",
      action_label: "Upcoming",
      follow_through_label: "1 closeout item due",
      note_summary: "Use the east gym doors and keep the portable risers tight to the wall.",
      open_exception_count: 1,
      notes_acknowledged: false
    }
  ],
  tasks: [
    {
      id: "task-1",
      task_number: "TSK-SCH-2026-0001",
      title: "Confirm roster",
      department: "schools",
      status: "in_progress",
      status_label: "In Progress",
      priority: "normal",
      due_at: "2026-03-26T17:00:00.000Z",
      blocked_reason: null,
      job_id: "job-1",
      event_id: null,
      workflow_run_id: null,
      linked_job_number: "JOB-100",
      linked_job_title: "Spring Portrait Day",
      organization_display_name: "Lincoln Elementary",
      proof_required: false
    },
    {
      id: "task-2",
      task_number: "TSK-SCH-2026-0002",
      title: "Upload setup proof",
      department: "schools",
      status: "blocked",
      status_label: "Blocked",
      priority: "high",
      due_at: "2026-03-26T18:00:00.000Z",
      blocked_reason: "Waiting on access confirmation.",
      job_id: "job-1",
      event_id: null,
      workflow_run_id: null,
      linked_job_number: "JOB-100",
      linked_job_title: "Spring Portrait Day",
      organization_display_name: "Lincoln Elementary",
      proof_required: true
    }
  ],
  acknowledgements: [
    {
      id: "ack-1",
      acknowledgement_type: "pre_service_notes",
      title: "DEMO-001",
      summary: "Use the east gym doors and keep the portable risers tight to the wall.",
      department: "schools",
      due_at: "2026-03-26T19:15:00.000Z",
      event_id: "shift-1",
      source_record_type: "work_shift",
      source_record_id: "shift-1",
      shift_id: "shift-1",
      linked_job_id: "job-1",
      linked_job_number: "JOB-100",
      linked_job_title: "Spring Portrait Day",
      action_label: "Acknowledge notes"
    }
  ],
  exceptions: [
    {
      id: "exception-1",
      exception_type: "running_late_notice",
      exception_type_label: "Running Late Notice",
      status: "open",
      severity: "high",
      reason_code: "traffic_delay",
      notes: "Traffic is slower than expected.",
      created_at: "2026-03-26T16:10:00.000Z",
      department: "schools",
      event_id: "shift-1",
      source_record_type: "work_shift",
      source_record_id: "shift-1",
      shift_id: "shift-1",
      linked_job_id: "job-1",
      linked_job_number: "JOB-100",
      linked_job_title: "Spring Portrait Day",
      scope_label: "DEMO-001",
      tone: "action_needed"
    }
  ],
  approvals: [
    {
      id: "approval-1",
      request_type: "staffing_exception_approval",
      request_type_label: "Staffing Exception Approval",
      request_title: "Approve lead coverage change",
      request_summary: "Coverage shifted to the assistant lead.",
      source_entity_type: "job",
      source_entity_id: "job-1",
      source_entity_label: "Spring Portrait Day",
      blocking: true,
      severity: "high",
      current_approver_role_group_label: "Department Manager",
      due_at: "2026-03-26T18:30:00.000Z",
      overdue: false,
      escalated: false
    }
  ],
  recent_changes: [
    {
      id: "change-1",
      change_type: "notification",
      title: "Shift updated",
      summary: "Your published shift is ready for review.",
      created_at: "2026-03-26T15:10:00.000Z",
      tone: "action_needed",
      department: "schools",
      related_record_type: "notification",
      related_record_id: "notification-1"
    },
    {
      id: "change-2",
      change_type: "task",
      title: "Upload setup proof",
      summary: "Blocked · JOB-100",
      created_at: "2026-03-26T15:20:00.000Z",
      tone: "action_needed",
      department: "schools",
      related_record_type: "task",
      related_record_id: "task-2"
    }
  ],
  schedule_context: {
    active_now_count: 0,
    upcoming_today_count: 1,
    current_event: null,
    next_event: {
      id: "shift-1",
      event_id: "shift-1",
      source: "work_shift",
      source_record_type: "work_shift",
      source_record_id: "shift-1",
      shift_id: "shift-1",
      linked_job_id: "job-1",
      linked_job_number: "JOB-100",
      linked_job_title: "Spring Portrait Day",
      title: "DEMO-001",
      subtitle: "Spring Portrait Day",
      department: "schools",
      staffing_role: "photographer",
      status: "published",
      starts_at: "2026-03-26T19:15:00.000Z",
      ends_at: "2026-03-26T23:00:00.000Z",
      location_name: "Lincoln Elementary",
      location_address: "123 School Street",
      action_label: "Upcoming",
      follow_through_label: "1 closeout item due",
      note_summary: "Use the east gym doors and keep the portable risers tight to the wall.",
      open_exception_count: 1,
      notes_acknowledged: false
    }
  }
};

const workflowInstanceResponse = {
  workflow_run: {
    id: "workflow-run-1",
    job_id: "job-1",
    template_id: "template-1",
    template_version_id: "version-1",
    template_key: "school_portraits",
    template_name: "School Portraits Workflow",
    template_version_label: "v1",
    workflow_family: "project_tracking",
    status: "active",
    started_at: "2026-03-26T15:00:00.000Z",
    completed_at: null
  },
  job: {
    id: "job-1",
    title: "Spring Portrait Day",
    job_type: "photo_day",
    organization_id: "org-1",
    organization_name: "Lincoln Elementary",
    account_owner_user_id: null
  },
  milestones: [
    {
      id: "milestone-production",
      milestone_key: "production",
      name: "Production",
      description: null,
      status: "ACTIVE",
      steps: [
        {
          id: "workflow-step-1",
          workflow_run_id: "workflow-run-1",
          job_id: "job-1",
          milestone_key: "production",
          step_key: "confirm_files",
          name: "Confirm Files",
          description: null,
          department: "production",
          role_key: "production_owner",
          assigned_user_id: "user-photo",
          assigned_user_name: "Demo Photographer",
          assignment_status: "assigned",
          assigned_queue: "production",
          assigned_by_user_id: null,
          assigned_by_user_name: null,
          assigned_at: null,
          waiting_on_party: null,
          waiting_detail: null,
          status: "IN_PROGRESS",
          required: true,
          skippable: false,
          blocking: false,
          expected_duration_minutes: 720,
          started_at: "2026-03-26T15:00:00.000Z",
          completed_at: null,
          completed_by_user_id: null,
          dependency_step_ids: [],
          downstream_step_ids: ["workflow-step-2"],
          notes: "Edit proof set before parent preview.",
          sort_order: 1,
          updated_at: "2026-03-26T16:00:00.000Z"
        },
        {
          id: "workflow-step-2",
          workflow_run_id: "workflow-run-1",
          job_id: "job-1",
          milestone_key: "production",
          step_key: "upload_proofs",
          name: "Upload Proofs",
          description: null,
          department: "production",
          role_key: "production_owner",
          assigned_user_id: null,
          assigned_user_name: null,
          assignment_status: "queued",
          assigned_queue: "production",
          assigned_by_user_id: null,
          assigned_by_user_name: null,
          assigned_at: null,
          waiting_on_party: null,
          waiting_detail: null,
          status: "NOT_STARTED",
          required: true,
          skippable: false,
          blocking: false,
          expected_duration_minutes: 720,
          started_at: null,
          completed_at: null,
          completed_by_user_id: null,
          dependency_step_ids: ["workflow-step-1"],
          downstream_step_ids: [],
          notes: null,
          sort_order: 2,
          updated_at: "2026-03-26T16:05:00.000Z"
        }
      ]
    }
  ],
  handoffs: [],
  audit_events: []
};

const shiftDetailResponse = {
  event: {
    id: "shift-1",
    source: "work_shift",
    source_record_type: "work_shift",
    source_record_id: "shift-1",
    linked_record_type: "work_shift",
    shift_id: "shift-1",
    title: "DEMO-001",
    subtitle: "Spring Portrait Day",
    department: "schools",
    staffing_role: "photographer",
    status: "published",
    starts_at: "2026-03-26T19:15:00.000Z",
    ends_at: "2026-03-26T23:00:00.000Z",
    location_name: "Lincoln Elementary",
    location_address: "123 School Street",
    navigation_url: "https://maps.example/lincoln",
    manager_name: "Demo Senior Photographer",
    attendance_state: null,
    attendance_state_note: null
  },
  shift: {
    id: "shift-1",
    shoot_id: "shoot-1",
    shoot_code: "DEMO-001",
    shoot_title: "Spring Portrait Day",
    shoot_date: "2026-03-26",
    title: "Primary Photographer",
    shift_kind: "shoot",
    status: "published",
    department: "schools",
    staffing_role: "photographer",
    satisfies_lead_coverage: false,
    starts_at: "2026-03-26T19:15:00.000Z",
    ends_at: "2026-03-26T23:00:00.000Z",
    arrival_time: "2026-03-26T19:00:00.000Z",
    start_time: "2026-03-26T19:15:00.000Z",
    end_time_est: "2026-03-26T22:30:00.000Z",
    location_name: "Lincoln Elementary",
    location_address: "123 School Street",
    navigation_url: "https://maps.example/lincoln",
    estimated_drive_minutes: 24,
    manager_user_id: "user-senior",
    manager_name: "Demo Senior Photographer",
    manager_phone_number: "+15550000004",
    attendance_state: null,
    attendance_state_note: null,
    segments: [],
    punches: []
  },
  linked_records: {
    shoot: {
      id: "shoot-1",
      shoot_code: "DEMO-001",
      title: "Spring Portrait Day"
    },
    organization: {
      id: "org-1",
      display_name: "Lincoln Elementary"
    },
    location: {
      id: "location-1",
      name: "Lincoln Elementary",
      address: "123 School Street"
    }
  },
  primary_contact: {
    name: "Demo Senior Photographer",
    role_label: "Lead Contact",
    phone_number: "+15550000004",
    call_href: "tel:+15550000004",
    text_href: "sms:+15550000004"
  },
  site_contact: {
    label: "Site Contact",
    value: "Coach Riley Hart"
  },
  pre_service_notes: {
    summary_line: "Use the east gym doors and keep the portable risers tight to the wall.",
    highlights: [{ label: "Setup", text: "Use the east gym doors and keep the portable risers tight to the wall." }],
    note_snapshot_hash: "hash-1",
    acknowledged: false
  },
  location_context: {
    matched_location_id: "location-1",
    location_name: "Lincoln Elementary",
    location_address: "123 School Street",
    navigation_url: "https://maps.example/lincoln",
    estimated_drive_minutes: 24,
    location_memory_summary: {
      status: "needs_refresh",
      last_confirmed_at: null,
      where_to_go: "123 School Street",
      where_to_park: "Enter from the east lot.",
      where_to_set_up: "Main gym, north wall.",
      top_watch_out: "Portable risers stay tight to the wall.",
      setup_photos: []
    },
    recent_photos: [],
    recent_evaluations: []
  },
  actions: {
    can_clock: true,
    can_upload_setup_photo: true,
    can_submit_post_shoot_eval: true,
    can_request_trade: true,
    can_submit_exception_note: true,
    can_submit_missed_punch: true
  },
  closeout_compliance: {
    shift_id: "shift-1",
    shoot_id: "shoot-1",
    organization_id: "org-1",
    location_id: "location-1",
    reminder_threshold_minutes: 30,
    setup_photo_required: true,
    setup_photo_uploaded: false,
    setup_photo_reminder_due: false,
    setup_photo_state: "required",
    post_shoot_evaluation_required: true,
    post_shoot_evaluation_submitted: false,
    post_shoot_evaluation_state: "not_started",
    missing_required_items: ["post_shoot_evaluation"],
    last_post_shoot_evaluation: null,
    mileage_reimbursement: {
      work_date: "2026-03-26",
      mileage_eligible: true,
      status: "review_required",
      review_reason_code: "missing_post_shoot_evaluation",
      reimbursement_amount: null,
      zone_name: null,
      vehicle_type: null,
      studio_distance_miles: null,
      issue_label: "Post-Shoot Evaluation still missing",
      selected_shoot: null
    },
    compliance_flags: []
  },
  resource_library: {
    access: {
      can_manage: false,
      can_download: false,
      limited_view: true,
      historical_window_years: 2
    },
    summary: {
      total_items: 1,
      media_count: 1,
      document_count: 0,
      best_reference_count: 1,
      pending_review_count: 0,
      prep_highlight_count: 1
    },
    prep_highlights: [],
    media: [],
    documents: [],
    historical_references: [],
    post_shoot_learnings: []
  },
  trade_candidates: [],
  trade_requests: [],
  exceptions: []
};

describe("My Work page", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/attendance/time-clock/state") {
        return {
          generated_at: "2026-03-26T15:00:00.000Z",
          state: "off_shift",
          emphasis: "neutral",
          label: "Time Clock",
          helper_text: "No punch is needed until the next published event window.",
          time_clock_state: {
            session_id: null,
            session_status: "off_clock",
            current_state: "off_clock",
            current_segment_id: null,
            current_segment_review_status: null,
            current_linked_shoot_id: null,
            current_linked_location_id: null,
            current_segment_started_at: null,
            needs_end_of_day_confirmation: false,
            last_clock_event_at: null
          },
          active_shift: null,
          next_shift: {
            id: "shift-1",
            shoot_id: "shoot-1",
            title: "DEMO-001",
            shift_kind: "shoot",
            starts_at: "2026-03-26T19:15:00.000Z",
            ends_at: "2026-03-26T23:00:00.000Z",
            location_name: "Lincoln Elementary",
            actionable_now: false,
            starts_in_minutes: 180,
            late_by_minutes: null
          },
          latest_session: null,
          review: {
            has_open_review: false,
            open_request_count: 0,
            label: null
          },
          action: {
            direction: null,
            label: null,
            enabled: false,
            shift_id: null,
            shoot_id: null,
            work_state: null
          }
        };
      }
      if (path.startsWith("/api/employee/my-work")) {
        return myWorkResponse;
      }
      if (path === "/api/workflows/instances/workflow-run-1") {
        return workflowInstanceResponse;
      }
      if (path === "/api/workflows/assignable-users") {
        return [
          {
            user_id: "user-photo",
            full_name: "Demo Photographer",
            email: "photo@example.com",
            department: "production",
            membership_status: "active"
          }
        ];
      }
      if (path === "/api/employee/events/shift-1") {
        return shiftDetailResponse;
      }
      throw new Error(`Unexpected My Work call: ${path}`);
    });
  });

  it("renders My Work as a focused employee launchpad", async () => {
    render(<MyWork token="token" currentUser={fieldUser} socket={null} />);

    expect(await screen.findByRole("heading", { name: "My Work" })).toBeInTheDocument();
    expect(screen.queryAllByText(/^My Work$/i)).toHaveLength(1);
    expect(screen.queryByText("Daily Cockpit")).not.toBeInTheDocument();
    expect(screen.getByText("Tasks assigned to you, workflows you're part of, and things your department may need help with.")).toBeInTheDocument();
    expect(screen.getByText("Launchpad")).toBeInTheDocument();
    expect(screen.queryByText("Quick Access")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Quick Access" })).not.toBeInTheDocument();
    expect(screen.queryByText(/My Work refreshed/i)).not.toBeInTheDocument();
    expect(screen.queryAllByText("Time Clock").length).toBeLessThanOrEqual(1);
    expect(screen.queryAllByText("Off Shift").length).toBeLessThanOrEqual(1);
    expect(screen.getAllByRole("link", { name: "Clocked Out" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Clocked Out" })).toHaveAttribute("href", "#employees/attendance");
    expect(screen.queryByText("Anchor Date")).not.toBeInTheDocument();
    expect(screen.queryByText("Connected Standards")).not.toBeInTheDocument();
    expect(screen.queryByText("Directory of Photography")).not.toBeInTheDocument();
    expect(screen.queryByText("Demo Admin")).not.toBeInTheDocument();
    expect(screen.queryByText("Company scope")).not.toBeInTheDocument();
    expect(screen.queryByText("Staffing Schedule")).not.toBeInTheDocument();
    expect(screen.getAllByText("My Schedule This Week").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Assigned Tasks")).toHaveLength(1);
    expect(screen.getAllByText("Workflow Steps Waiting on Me")).toHaveLength(1);
    expect(screen.getAllByText("Heads Up")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /My Schedule This Week/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Assigned Tasks/i })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /Workflow Steps Waiting on Me/i })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /Heads Up/i })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByText("Scheduled Hours: 3.8h").length).toBeGreaterThan(0);
    expect(screen.getByText("Worked Hours: 3.8h")).toBeInTheDocument();
    expect(screen.getByText("Remaining Hours: 0h")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View schedule" })).toHaveAttribute("href", "#my-schedule");
    expect(screen.getByLabelText("Compact weekly schedule")).toBeInTheDocument();
    expect(screen.getByText("Thu")).toBeInTheDocument();
    expect(screen.getByText("Assigned shoot")).toBeInTheDocument();
    expect(screen.getAllByText("DEMO-001").length).toBeGreaterThan(0);
    expect(screen.getByText("Related jobs (1)")).toBeInTheDocument();
    expect(screen.queryByText("Assigned Jobs")).not.toBeInTheDocument();
    expect(screen.queryByText("Current Steps")).not.toBeInTheDocument();
    expect(screen.queryByText("Events")).not.toBeInTheDocument();
    expect(screen.queryByText("Exceptions")).not.toBeInTheDocument();
    expect(screen.queryByText("Approvals")).not.toBeInTheDocument();
    expect(screen.queryByText("Recent Changes")).not.toBeInTheDocument();
    expect(screen.queryByText("Required Acknowledgements")).not.toBeInTheDocument();
    expect(screen.queryByText("Owned Exceptions")).not.toBeInTheDocument();
    expect(screen.queryByText("Approvals Waiting On You")).not.toBeInTheDocument();
    expect(screen.queryByText(/Confirm roster/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Assigned to you")).not.toBeInTheDocument();
    expect(screen.queryByText("Approve lead coverage change")).not.toBeInTheDocument();
    expect(screen.queryByText("Selected Event Detail")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Assigned Tasks/i }));
    expect(screen.getByText(/Confirm roster/i)).toBeInTheDocument();
    expect(screen.getByText(/Upload setup proof/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Assigned Tasks/i })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /Workflow Steps Waiting on Me/i }));
    expect(screen.getByText("Assigned to you")).toBeInTheDocument();
    expect(screen.getByText("Department: Production")).toBeInTheDocument();
    expect(screen.getByText("What to do now:")).toBeInTheDocument();
    const confirmFilesButton = screen.getByRole("button", { name: "Confirm Files" });
    expect(confirmFilesButton).toBeInTheDocument();
    expect(screen.getByText("Shared note: Edit proof set before parent preview.")).toBeInTheDocument();
    fireEvent.click(confirmFilesButton);
    expect(await screen.findByLabelText("Move to next step")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Assign / Status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update step" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Assign / Status current step")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open work detail" })[0]).toHaveAttribute("href", "#project-tracking/workflows/workflow-run-1");

    fireEvent.click(screen.getByRole("button", { name: /Heads Up/i }));
    expect(screen.getAllByText(/Acknowledge notes/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Running Late Notice/i)).toBeInTheDocument();
    expect(screen.getByText("Approve lead coverage change")).toBeInTheDocument();
    expect(screen.getByText(/Blocking downstream work until reviewed/i)).toBeInTheDocument();

    expect(screen.queryByText("My Shifts")).not.toBeInTheDocument();
    expect(screen.queryByText("Attendance Risk")).not.toBeInTheDocument();
  });

  it("keeps detailed field actions available only after an event is selected", async () => {
    render(<MyWork token="token" currentUser={fieldUser} socket={null} />);

    expect(await screen.findByRole("heading", { name: "My Work" })).toBeInTheDocument();
    expect(screen.queryByText("Selected Event Detail")).not.toBeInTheDocument();
    expect(screen.queryByText(/Choose an event from My Schedule This Week/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /DEMO-001/i }));

    await waitFor(() => {
      expect(screen.getByText("Selected Event Detail")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Submit Post-Shoot Eval" })).toBeInTheDocument();
    });

    expect(apiFetchMock).toHaveBeenCalledWith("/api/employee/events/shift-1", "token");
    expect(screen.queryByText(/Choose an event from My Schedule This Week/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit Post-Shoot Eval" })).toBeInTheDocument();
  });
});
