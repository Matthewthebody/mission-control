// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SportsOverview } from "../pages/SportsOverview";
import type { SharedDashboardResponse, SharedExceptionListItem, SharedJobListItem, SharedProductionQueueItem } from "../jobTruthTypes";
import type { SportsOverviewResponse } from "../sportsTypes";
import type { SessionUser } from "../types";
import type { SharedTaskListItem } from "../workModelTypes";

const getSportsOverviewMock = vi.fn();
const listSharedJobsMock = vi.fn();
const listSharedTasksMock = vi.fn();
const listSharedExceptionsMock = vi.fn();
const getSharedDashboardMock = vi.fn();
const getProjectWorkflowCommandCenterMock = vi.fn();

vi.mock("../featureFlags", () => ({
  featureFlags: {
    centralJobIntakeV1: false
  }
}));

vi.mock("../permissions", () => ({
  canCreateShootRecords: () => true,
  getSportsWorkspaceAccessScope: () => "all"
}));

vi.mock("../services/sportsApi", () => ({
  getSportsOverview: (...args: unknown[]) => getSportsOverviewMock(...args)
}));

vi.mock("../services/jobsApi", () => ({
  listSharedJobs: (...args: unknown[]) => listSharedJobsMock(...args),
  listSharedExceptions: (...args: unknown[]) => listSharedExceptionsMock(...args),
  getSharedDashboard: (...args: unknown[]) => getSharedDashboardMock(...args)
}));

vi.mock("../services/tasksApi", () => ({
  listSharedTasks: (...args: unknown[]) => listSharedTasksMock(...args)
}));

vi.mock("../services/projectTracking", () => ({
  getProjectWorkflowCommandCenter: (...args: unknown[]) => getProjectWorkflowCommandCenterMock(...args)
}));

vi.mock("../components/jobs/SharedJobCommandCenter", () => ({
  DepartmentDashboardPanel: () => <div>Mock Sports Command Layer</div>
}));

vi.mock("../components/workspace/CompactActiveWorkPanel", () => ({
  CompactActiveWorkPanel: () => <div>Mock Sports Active Work</div>
}));

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
  permissions: ["dashboard.read", "job.read", "task.read", "exceptions.read"],
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

const overview = {
  anchor_start: "Apr 1",
  anchor_end: "Apr 7",
  kpis: [],
  saved_views: [],
  upcoming_shoots: [
    {
      id: "shoot-1",
      title: "Friday Night Lights",
      summary: "North Metro Athletics | varsity media day",
      tone: "info",
      action_hash: "#sports/shoots/shoot-1"
    }
  ],
  staffing_readiness: [
    {
      id: "staffing-1",
      title: "Need one more photographer",
      summary: "Lead ready confirmation still open",
      tone: "warning",
      action_hash: "#sports/exceptions"
    }
  ],
  ready_pings: [],
  proof_and_products: [],
  account_health: [],
  recent_activity: []
} as unknown as SportsOverviewResponse;

const jobs: SharedJobListItem[] = [
  {
    id: "job-1",
    tenant_id: "tenant-demo",
    legacy_shoot_id: null,
    job_number: "SPT-1001",
    department_type: "sports",
    job_category: "media_day",
    organization_id: "org-1",
    primary_location_id: null,
    primary_contact_id: null,
    account_owner_user_id: "user-sports-manager",
    title: "Friday Night Lights Media Day",
    event_name: null,
    description_internal: null,
    job_status: "in_progress",
    production_status: "queued",
    staffing_status: "staffed",
    readiness_status: "ready",
    sync_status: "clean",
    risk_status: "low",
    priority_level: "high",
    delivery_type: null,
    gallery_type: null,
    scheduled_start_at: "2026-04-05T09:00:00.000Z",
    scheduled_end_at: null,
    timezone: "America/Chicago",
    estimated_subject_count: null,
    actual_subject_count: null,
    estimated_staff_count: null,
    actual_staff_count: null,
    client_deadline_at: "2026-04-10T12:00:00.000Z",
    production_deadline_at: "2026-04-08T12:00:00.000Z",
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
    updated_at: "2026-04-03T12:00:00.000Z",
    organization_name: "North Metro Athletics",
    primary_location_name: "Stadium",
    primary_location_address: null,
    primary_contact_name: "Jamie Coach",
    account_owner_name: "Sports Manager",
    lead_owner_user_id: "user-sports-manager",
    lead_owner_name: "Sports Manager",
    primary_day_date: "2026-04-05",
    primary_day_start_time: null,
    primary_day_end_time: null,
    primary_day_label: null,
    school_profile: null,
    sports_profile: null,
    department_summary: {},
    proof_status: null,
    open_watch_flag_count: 0,
    readiness_percent: 90,
    blocker_count: 0,
    day_count: 1,
    assigned_staff_count: 3,
    checked_in_staff_count: 0,
    ready_present_count: 0
  }
];

const tasks: SharedTaskListItem[] = [
  {
    id: "task-1",
    tenant_id: "tenant-demo",
    task_number: "TSK-SPORT-001",
    title: "Confirm sponsor banner crop",
    description: null,
    task_type: "client_success_follow_up",
    department_type: "sports",
    related_job_id: "job-1",
    assigned_to_user_id: "user-sports-manager",
    assigned_team_id: "sports_team",
    status: "in_progress",
    priority: "high",
    due_at: "2026-04-06T12:00:00.000Z",
    blocked_reason: null,
    proof_required: false,
    completion_notes: null,
    created_by_user_id: null,
    updated_by_user_id: null,
    created_at: "2026-04-01T12:00:00.000Z",
    updated_at: "2026-04-03T12:00:00.000Z",
    assigned_to_name: "Sports Manager",
    related_job_number: "SPT-1001",
    related_job_title: "Friday Night Lights Media Day",
    related_job_status: "in_progress",
    related_job_department: "sports",
    organization_name: "North Metro Athletics",
    department_label: "Sports"
  }
];

const exceptions: SharedExceptionListItem[] = [
  {
    id: "exception-1",
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
    flag_type: "staffing_gap",
    title: "Lead ready confirmation missing",
    description: "Lead photographer still has not confirmed ready state.",
    status: "open",
    owner_user_id: "user-sports-manager",
    owner_name: "Sports Manager",
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
    updated_at: "2026-04-03T12:00:00.000Z",
    department_type: "sports",
    job_number: "SPT-1001",
    job_title: "Friday Night Lights Media Day",
    organization_id: "org-1",
    organization_name: "North Metro Athletics",
    created_by_name: null,
    source_entity_label: "Job",
    source_scope_label: "Sports",
    next_action_label: "Get the lead ready confirmation before call time",
    priority_rank: 1
  }
];

const workflowItems: SharedProductionQueueItem[] = [
  {
    id: "workflow-1",
    organization_id: "org-1",
    organization_name: "North Metro Athletics",
    title: "Proof gallery build",
    production_type: "proof_gallery",
    workflow_status: "in_progress",
    assigned_to_name: "Graphics Lead",
    due_at: "2026-04-07T12:00:00.000Z",
    blocked_reason: null,
    blocking_issue_count: 0,
    overdue_approval_count: 0,
    health_state: "ON_TRACK",
    approval_status: "none"
  }
] as unknown as SharedProductionQueueItem[];

const dashboard = {
  blocked_production: workflowItems,
  overdue_approvals: [],
  delivery_risks: []
} as unknown as SharedDashboardResponse;

describe("SportsOverview", () => {
  beforeEach(() => {
    window.location.hash = "#sports";
    getProjectWorkflowCommandCenterMock.mockReset();
    getProjectWorkflowCommandCenterMock.mockResolvedValue({
      generated_at: "2026-04-04T12:00:00.000Z",
      view: "department",
      summary: {},
      alerts: [],
      steps: [],
      job_rows: []
    });
    getSportsOverviewMock.mockResolvedValue(overview);
    listSharedJobsMock.mockResolvedValue({ jobs });
    listSharedTasksMock.mockResolvedValue({ items: tasks });
    listSharedExceptionsMock.mockResolvedValue({ items: exceptions, summary: {}, saved_views: [] });
    getSharedDashboardMock.mockResolvedValue(dashboard);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders sports on the shared jobs/tasks/exceptions/workflow contract", async () => {
    render(<SportsOverview token="token" currentUser={baseUser} />);

    expect(await screen.findByRole("heading", { name: "Sports" })).toBeInTheDocument();
    expect(screen.getByText(/Sports now runs on the same shared jobs, tasks, exceptions, and workflow contract as Schools/i)).toBeInTheDocument();
    expect(screen.getByText("Shared operational contract")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Jobs" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Exceptions" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Workflow" })).toBeInTheDocument();
    expect(screen.getByText("Sports read-model projections")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Upcoming Shoots" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Staffing Readiness" })).toBeInTheDocument();
  });

  it("routes workflow items into the canonical sports graphics hash", async () => {
    render(<SportsOverview token="token" currentUser={baseUser} />);

    fireEvent.click(await screen.findByRole("button", { name: /Proof gallery build/i }));

    expect(window.location.hash).toBe("#sports/graphics?item=workflow-1");
  });
});
