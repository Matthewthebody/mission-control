// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchoolsHub } from "../pages/SchoolsHub";
import type { SharedDashboardResponse, SharedJobListItem, SharedWatchFlagListItem } from "../jobTruthTypes";
import type { SchoolWorkItemRecord, SchoolsHubWorkspaceResponse } from "../schoolsHubTypes";
import type { SessionUser } from "../types";
import type { SharedTaskListItem } from "../workModelTypes";

const getSchoolsHubWorkspaceMock = vi.fn();
const listSharedJobsMock = vi.fn();
const listSharedTasksMock = vi.fn();
const listSharedWatchlistMock = vi.fn();
const getSharedDashboardMock = vi.fn();
const getProjectWorkflowCommandCenterMock = vi.fn();

vi.mock("../featureFlags", () => ({
  featureFlags: {
    centralJobIntakeV1: false
  }
}));

vi.mock("../services/schoolsHubApi", () => ({
  getSchoolsHubWorkspace: (...args: unknown[]) => getSchoolsHubWorkspaceMock(...args)
}));

vi.mock("../services/jobsApi", () => ({
  listSharedJobs: (...args: unknown[]) => listSharedJobsMock(...args),
  listSharedExceptions: (...args: unknown[]) => listSharedWatchlistMock(...args),
  getSharedDashboard: (...args: unknown[]) => getSharedDashboardMock(...args)
}));

vi.mock("../services/tasksApi", () => ({
  listSharedTasks: (...args: unknown[]) => listSharedTasksMock(...args)
}));

vi.mock("../services/projectTracking", () => ({
  getProjectWorkflowCommandCenter: (...args: unknown[]) => getProjectWorkflowCommandCenterMock(...args)
}));

afterEach(() => {
  cleanup();
});

const baseUser: SessionUser = {
  id: "user-schools-manager",
  tenantId: "tenant-demo",
  accountId: "account-demo",
  sessionId: "session-demo",
  email: "schools@example.com",
  fullName: "Schools Manager",
  status: "active",
  department: "schools",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["manager"],
  permissions: ["dashboard.read", "notification.read", "job.read", "task.read", "watchlist.read"],
  authorityTier: "supervisor",
  primaryJobFunctionProfile: "schools_client_success",
  jobFunctionProfiles: ["schools_client_success"],
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

const schoolWorkItem: SchoolWorkItemRecord = {
  id: "school-work-1",
  organization_id: "org-1",
  school_name: "North High",
  school_logo_url: null,
  school_job_id: "job-1",
  school_job_title: "North High Spring Portraits",
  school_job_type: "fall_portraits",
  linked_shoot_id: null,
  linked_shoot_code: null,
  linked_shoot_title: null,
  linked_location_id: null,
  linked_location_name: null,
  linked_contact_id: "contact-1",
  linked_contact_name: "Jamie Carlson",
  linked_follow_up_id: null,
  linked_follow_up_title: null,
  linked_production_project_id: null,
  linked_production_project_title: null,
  work_type: "pre_shoot_coordination",
  title: "Confirm roster upload",
  description: "Roster file is due before picture day.",
  owner_user_id: "csr-1",
  owner_name: "Myra",
  status: "in_progress",
  stage: "waiting_on_school",
  priority: "high",
  due_date: "2026-04-05",
  sla_date: "2026-04-05",
  blocker_reason: null,
  waiting_on: "school",
  source_system: "monday",
  source_reference: "pulse-100",
  external_sync: {
    provider: "monday",
    external_record_id: "pulse-100",
    external_record_url: "https://monday.example/pulse-100",
    external_record_name: "Confirm roster upload",
    board_id: "board-school-portraits",
    board_name: "School Portraits Board",
    group_id: "prep",
    group_title: "Prep",
    last_synced_at: "2026-04-04T12:00:00.000Z",
    sync_state: "synced",
    sync_state_label: "Synced",
    last_error: null,
    last_operation_id: null,
    last_operation_status: null,
    can_reimport: false
  },
  generated_by_rule: false,
  notes: null,
  completed_at: null,
  created_at: "2026-04-01T12:00:00.000Z",
  updated_at: "2026-04-04T12:00:00.000Z",
  status_label: "In Progress",
  status_tone: "info",
  due_state: "due_soon",
  due_label: "Due Apr 5",
  waiting_on_label: "Waiting on school",
  source_label: "Monday",
  flags: []
};

const workspace: SchoolsHubWorkspaceResponse = {
  anchor_date: "2026-04-04",
  generated_at: "2026-04-04T12:00:00.000Z",
  scope: "all",
  summary: {
    due_today: 2,
    overdue: 1,
    upcoming_shoots_needing_prep: 2,
    waiting_on_school: 1,
    waiting_on_internal_production: 1,
    id_work_queue: 2,
    gallery_due_soon: 3,
    yearbook_deadlines_approaching: 1,
    deliveries_ready: 1,
    recently_completed: 1,
    open_total: 6
  },
  sections: [],
  queue_total_count: 1,
  queue_page: 1,
  queue_page_size: 25,
  queue_has_more: false,
  queue_items: [schoolWorkItem]
};

const jobs: SharedJobListItem[] = [
  {
    id: "job-1",
    tenant_id: "tenant-demo",
    legacy_shoot_id: null,
    job_number: "SCH-1001",
    department_type: "schools",
    job_category: "photo_day",
    organization_id: "org-1",
    primary_location_id: null,
    primary_contact_id: null,
    account_owner_user_id: "csr-1",
    title: "North High Spring Portraits",
    event_name: null,
    description_internal: null,
    job_status: "in_progress",
    production_status: "queued",
    staffing_status: "staffed",
    readiness_status: "ready",
    sync_status: "warning",
    risk_status: "high",
    priority_level: "high",
    delivery_type: null,
    gallery_type: null,
    scheduled_start_at: "2026-04-08T14:00:00.000Z",
    scheduled_end_at: null,
    timezone: "America/Chicago",
    estimated_subject_count: null,
    actual_subject_count: null,
    estimated_staff_count: null,
    actual_staff_count: null,
    client_deadline_at: "2026-04-12T12:00:00.000Z",
    production_deadline_at: "2026-04-10T12:00:00.000Z",
    published_at: null,
    archived_at: null,
    cancelled_at: null,
    cancel_reason: null,
    production_required: true,
    location_override_note: null,
    contact_override_note: null,
    created_by_user_id: null,
    updated_by_user_id: null,
    created_at: "2026-04-01T12:00:00.000Z",
    updated_at: "2026-04-04T12:00:00.000Z",
    organization_name: "North High",
    primary_location_name: "Gym",
    primary_location_address: null,
    primary_contact_name: "Jamie Carlson",
    account_owner_name: "Myra",
    lead_owner_user_id: "director-1",
    lead_owner_name: "Corey",
    primary_day_date: "2026-04-08",
    primary_day_start_time: null,
    primary_day_end_time: null,
    primary_day_label: null,
    school_profile: {
      job_id: "job-1",
      tenant_id: "tenant-demo",
      district_id: null,
      district_name: null,
      school_type: null,
      school_year: null,
      grade_scope: null,
      roster_source: null,
      id_cards_required: true,
      yearbook_required: true,
      composite_required: false,
      admin_portal_required: false,
      submission_deadline: "2026-04-18",
      advisor_sorting_required: false,
      homeroom_sorting_required: false,
      data_import_mode: null,
      special_instructions: null
    },
    sports_profile: null,
    department_summary: {},
    proof_status: null,
    open_watch_flag_count: 2,
    readiness_percent: 80,
    blocker_count: 1,
    day_count: 1,
    assigned_staff_count: 2,
    checked_in_staff_count: 0,
    ready_present_count: 0
  }
];

const westMiddleJob: SharedJobListItem = {
  ...jobs[0],
  id: "job-2",
  job_number: "SCH-1002",
  organization_id: "org-2",
  title: "West Middle Retake Day",
  job_status: "ready_to_staff",
  production_status: "awaiting_approval",
  staffing_status: "gap_flagged",
  risk_status: "medium",
  primary_day_date: "2026-04-11",
  scheduled_start_at: "2026-04-11T14:00:00.000Z",
  client_deadline_at: "2026-04-14T12:00:00.000Z",
  production_deadline_at: "2026-04-13T12:00:00.000Z",
  organization_name: "West Middle",
  primary_contact_name: "Taylor Morgan",
  account_owner_user_id: "csr-2",
  account_owner_name: "Jessica",
  lead_owner_user_id: "director-2",
  lead_owner_name: "Spencer",
  proof_status: "requested",
  open_watch_flag_count: 0,
  blocker_count: 0,
  readiness_percent: 64,
  assigned_staff_count: 1,
  checked_in_staff_count: 0,
  ready_present_count: 0,
  school_profile: {
    ...jobs[0].school_profile!,
    job_id: "job-2",
    id_cards_required: false,
    yearbook_required: false,
    submission_deadline: "2026-04-19"
  }
};

const schoolsWorkflowRow = {
  job_id: "job-1",
  job_number: "SCH-1001",
  job_code: "SCH-1001",
  job_title: "North High Spring Portraits",
  organization_id: "org-1",
  organization_name: "North High",
  account_id: null,
  account_name: null,
  workflow_run_id: "workflow-school-1",
  workflow_template_id: "template-schools",
  workflow_template_name: "School Portraits Workflow",
  workflow_template_version: "v1",
  current_step: {
    id: "step-school-1",
    workflow_run_id: "workflow-school-1",
    job_id: "job-1",
    milestone_key: "intake",
    step_key: "confirm_roster",
    name: "Confirm roster upload",
    description: "Roster file is due before picture day.",
    department: "schools",
    role_key: "csr_owner",
    assigned_user_id: null,
    assigned_user_name: null,
    status: "IN_PROGRESS",
    required: true,
    skippable: false,
    blocking: true,
    expected_duration_minutes: 1440,
    started_at: "2026-04-04T12:00:00.000Z",
    completed_at: null,
    completed_by_user_id: null,
    notes: null,
    exception_reason: null,
    rework_count: 0,
    dependency_step_ids: [],
    timing: {
      elapsed_minutes: 60,
      remaining_minutes: 1380,
      overdue_minutes: 0,
      idle_minutes: 0,
      sla_percent: 10,
      alert_level: "none",
      health_state: "green"
    },
    updated_at: "2026-04-04T12:00:00.000Z",
    phase: "intake"
  },
  phase: "intake",
  owner_display: "CSR Owner",
  owner_type: "role",
  job_date: "2026-04-08T14:00:00.000Z",
  next_deadline_at: "2026-04-08T14:00:00.000Z",
  deadline_state: "due_soon",
  waiting_on_party: "school",
  health: "due_soon",
  health_reasons: ["Due within 7 days"],
  file_status: "not_connected",
  missing_info_flags: [],
  rework_count: 0,
  blocked_reason: null,
  queue_intelligence: {
    reason: "Waiting on School.",
    trigger: "Current step has an explicit waiting state.",
    owner_lane: "Schools Queue",
    next_action: "Follow up with School and update the waiting state.",
    clear_condition: "Clear when waiting is set to No wait or the step advances.",
    operational_status: "waiting"
  },
  updated_at: "2026-04-04T12:00:00.000Z"
};

const tasks: SharedTaskListItem[] = [
  {
    id: "task-1",
    tenant_id: "tenant-demo",
    task_number: "TSK-SCH-2026-0001",
    title: "Confirm roster upload",
    description: null,
    task_type: "client_success_follow_up",
    department_type: "schools",
    related_job_id: "job-1",
    assigned_to_user_id: "csr-1",
    assigned_team_id: "client_success_team",
    status: "in_progress",
    priority: "high",
    due_at: "2026-04-04T16:00:00.000Z",
    blocked_reason: null,
    proof_required: false,
    completion_notes: null,
    created_by_user_id: null,
    updated_by_user_id: null,
    created_at: "2026-04-01T12:00:00.000Z",
    updated_at: "2026-04-04T12:00:00.000Z",
    assigned_to_name: "Myra",
    related_job_number: "SCH-1001",
    related_job_title: "North High Spring Portraits",
    related_job_status: "in_progress",
    related_job_department: "schools",
    organization_name: "North High",
    department_label: "Schools"
  }
];

const watchlist: SharedWatchFlagListItem[] = [
  {
    id: "flag-1",
    tenant_id: "tenant-demo",
    job_id: "job-1",
    job_day_id: null,
    production_item_id: null,
    approval_request_id: null,
    qa_review_record_id: null,
    deliverable_item_id: null,
    source_entity_type: "job",
    source_entity_id: "job-1",
    severity: "high",
    flag_type: "gallery_release_risk",
    title: "Gallery release is at risk",
    description: "The gallery is waiting on final approval.",
    status: "open",
    owner_user_id: "director-1",
    owner_name: "Corey",
    created_by_user_id: null,
    due_at: "2026-04-05T12:00:00.000Z",
    snooze_until: null,
    escalated_at: null,
    escalated_to_role: null,
    resolved_at: null,
    resolved_by_user_id: null,
    resolved_by_name: null,
    auto_key: null,
    created_at: "2026-04-03T12:00:00.000Z",
    updated_at: "2026-04-04T12:00:00.000Z",
    department_type: "schools",
    job_number: "SCH-1001",
    job_title: "North High Spring Portraits",
    organization_id: "org-1",
    organization_name: "North High",
    created_by_name: null,
    source_entity_label: "Job",
    source_scope_label: "Schools",
    next_action_label: "Get final approval and release the gallery",
    priority_rank: 1
  }
];

const dashboard: SharedDashboardResponse = {
  scope: "home",
  department_type: "schools",
  summary: {
    jobs_today: 1,
    jobs_next_7_days: 2,
    urgent_count: 1,
    critical_watch_count: 0,
    high_watch_count: 1,
    blocked_production_count: 0,
    overdue_approval_count: 0,
    delivery_risk_count: 2,
    staffing_gap_count: 0,
    missing_ready_confirmation_count: 0,
    overdue_checklist_count: 0,
    awaiting_checklist_approval_count: 0,
    rejected_checklist_count: 0,
    blocked_job_count: 1
  },
    health: { state: "at_risk", score: 72, explanation: [] },
    widgets: [],
    widget_layout: {
      role_key: "schools",
      supports_personalization: false,
      items: []
    },
  urgent_watch: watchlist,
  checklist_attention_summary: { total_count: 0, overdue_count: 0, awaiting_approval_count: 0, rejected_count: 0, blocked_count: 0, missing_proof_count: 0, assigned_to_me_count: 0 },
  checklist_attention: [],
  upcoming_risks: [],
  today_jobs: [],
  blocked_production: [],
  overdue_approvals: [],
  delivery_risks: [],
  my_open_flags: [],
  recent_movement: [],
  workload_pressure: [],
  production_snapshot: null
};

beforeEach(() => {
  window.location.hash = "#schools";
  getProjectWorkflowCommandCenterMock.mockReset();
  getProjectWorkflowCommandCenterMock.mockResolvedValue({
    generated_at: "2026-04-04T12:00:00.000Z",
    view: "department",
    summary: {},
    alerts: [],
    steps: [],
    job_rows: [schoolsWorkflowRow]
  });
  getSchoolsHubWorkspaceMock.mockResolvedValue(workspace);
  listSharedJobsMock.mockResolvedValue({ jobs: [...jobs, westMiddleJob] });
  listSharedTasksMock.mockResolvedValue({ items: tasks });
  listSharedWatchlistMock.mockResolvedValue({ items: watchlist, summary: { total_count: 1, critical_count: 0, high_count: 1, snoozed_count: 0, ownerless_count: 0, next_24_hours_count: 1 }, saved_views: [] });
  getSharedDashboardMock.mockResolvedValue(dashboard);
});

describe("SchoolsHub", () => {
  it("renders Schools as a department workspace with project and blocker links", async () => {
    render(<SchoolsHub token="token" currentUser={baseUser} />);

    expect(await screen.findByRole("heading", { name: "Department Brief" })).toBeInTheDocument();
    expect(screen.getByText("School picture days, gallery releases, retakes, missing data, and client follow-up that need Jessica's team to move work forward.")).toBeInTheDocument();
    expect(screen.queryAllByRole("heading", { name: "Schools" })).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "My Schedule" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Notifications" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import Jobs" })).not.toBeInTheDocument();
    expect(screen.getByText("Open First")).toBeInTheDocument();
    expect(screen.getByText("Attention Needed")).toBeInTheDocument();
    expect(screen.getByText("This Week's Work")).toBeInTheDocument();
    expect(screen.getByText("Work Queues")).toBeInTheDocument();
    expect(screen.getByText("Galleries Due")).toBeInTheDocument();
    expect(screen.getAllByText("Missing Data").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Retakes").length).toBeGreaterThan(0);
    expect(screen.getByText("School Follow-Up")).toBeInTheDocument();
    expect(screen.getByText("Schools Daily Board")).toBeInTheDocument();
    expect(screen.queryByText("Schools Command Hub")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Schools Active Work" })).toBeInTheDocument();
    expect(screen.getByText("1 in queue")).toBeInTheDocument();
    expect(screen.getByLabelText("Schools Active Work summary")).toBeInTheDocument();
    expect(screen.getAllByText("View Workflow").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "View Workflow" })).toHaveAttribute("href", "#project-tracking/workflows/workflow-school-1");
    expect(screen.getByRole("table", { name: "Schools department command list" })).toBeInTheDocument();
    expect(screen.getByText("Active School Work")).toBeInTheDocument();
    expect(screen.getByText("Due Soon")).toBeInTheDocument();
    expect(screen.getByText("Waiting on School")).toBeInTheDocument();
    expect(screen.getByText("Blocked / Needs Review")).toBeInTheDocument();
    expect(screen.getByText("Recently Changed")).toBeInTheDocument();
    expect(screen.getByText("What needs attention")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Department work" })).toBeInTheDocument();
    expect(screen.getByText("ID jobs")).toBeInTheDocument();
    expect(screen.getAllByText("North High").length).toBeGreaterThan(0);
    expect(screen.getByText("West Middle")).toBeInTheDocument();
    expect(screen.getAllByText("Confirm roster upload").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Open work" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "View Workflow" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Open Exceptions" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Open Needs Attention" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Open details" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Account" }).length).toBeGreaterThan(0);
    expect(screen.getByText("Proof approvals")).toBeInTheDocument();
    expect(screen.getByText("Staffing issues")).toBeInTheDocument();
    expect(screen.getByText("Production blockers")).toBeInTheDocument();
    expect(screen.getByText("Missing info / client")).toBeInTheDocument();
    expect(screen.getByText("Proof")).toBeInTheDocument();
    expect(screen.getAllByText("Staffing").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Production").length).toBeGreaterThan(0);
    expect(screen.getByText("Client/info")).toBeInTheDocument();
    expect(screen.getByText("Contact: Jamie Carlson")).toBeInTheDocument();
    expect(screen.getByText("Contact: Taylor Morgan")).toBeInTheDocument();
    expect(screen.queryByText("Schools Dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText("Schools Operating Board")).not.toBeInTheDocument();
    expect(screen.queryByText("Board rows")).not.toBeInTheDocument();
    expect(screen.queryByText("Board / workflow status")).not.toBeInTheDocument();
    expect(screen.queryByText("School operations board")).not.toBeInTheDocument();
    expect(screen.queryByText("Schools operational workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Admin Integrations")).not.toBeInTheDocument();
    expect(screen.queryByText("Anchor Date")).not.toBeInTheDocument();
    expect(screen.queryByText("Primary work modes")).not.toBeInTheDocument();
    expect(screen.queryByText("View Date")).not.toBeInTheDocument();
  });

  it("shows Jobs, Tasks, and Exceptions as direct department tabs", async () => {
    render(<SchoolsHub token="token" currentUser={baseUser} />);

    expect(await screen.findByRole("tab", { name: "Jobs" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Tasks" }));
    expect(window.location.hash).toBe("#schools/tasks");
    expect(await screen.findByText("By Employee")).toBeInTheDocument();
    expect(screen.getByText("By Role")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Exceptions" }));
    expect(window.location.hash).toBe("#schools/exceptions");
    expect(await screen.findByText("Gallery release risks")).toBeInTheDocument();
    expect(screen.getAllByText("ID issues").length).toBeGreaterThan(0);
  });

  it("opens due-soon rows into the live job workflow when connected", async () => {
    render(<SchoolsHub token="token" currentUser={baseUser} />);

    const workflowButtons = await screen.findAllByRole("button", { name: "Open work" });
    fireEvent.click(workflowButtons[0]);
    expect(window.location.hash).toBe("#project-tracking/workflows/workflow-school-1");
  });

  it("shows direct dashboard language without old quick access clutter", async () => {
    render(<SchoolsHub token="token" currentUser={baseUser} />);

    expect(await screen.findByText("Next action")).toBeInTheDocument();
    expect(screen.getByText("Next owner")).toBeInTheDocument();
    expect(screen.getByText("Blocker / review")).toBeInTheDocument();
    expect(screen.getByText("Open next")).toBeInTheDocument();
    expect(screen.queryByText("Queue")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "My Schedule" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Notifications" })).not.toBeInTheDocument();
  });

  it("opens directly into the exceptions view when routed there", async () => {
    window.location.hash = "#schools/exceptions";
    render(<SchoolsHub token="token" currentUser={baseUser} />);

    expect(await screen.findByRole("tab", { name: "Exceptions" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("At-risk school work with a clear next action and owner.")).toBeInTheDocument();
  });
});
