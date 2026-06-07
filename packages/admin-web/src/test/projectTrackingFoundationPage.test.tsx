// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectTrackingFoundation } from "../pages/ProjectTrackingFoundation";
import { ProductionWorkflowQueue } from "../pages/ProductionWorkflowQueue";
import { ProjectTrackingDepartmentQueue } from "../components/projectTracking/ProjectTrackingDepartmentQueue";
import type { ProjectWorkflowCommandCenter } from "../projectTrackingTypes";
import type { SessionUser } from "../types";

const listProjectWorkflowTemplatesMock = vi.fn();
const getProjectWorkflowCommandCenterMock = vi.fn();
const getProjectWorkflowInstanceMock = vi.fn();
const transitionProjectWorkflowStepMock = vi.fn();
const sendProjectWorkflowStepBackMock = vi.fn();
const listWorkflowAssignableUsersMock = vi.fn();
const getProjectWorkflowProductionQueueMock = vi.fn();
const acceptProjectWorkflowHandoffMock = vi.fn();
const claimProjectWorkflowHandoffMock = vi.fn();
const markProjectWorkflowHandoffWaitingMock = vi.fn();
const markProjectWorkflowHandoffProductionCompleteMock = vi.fn();
const returnProjectWorkflowHandoffToSchoolsMock = vi.fn();

vi.mock("../services/projectTracking", async () => {
  const actual = await vi.importActual<typeof import("../services/projectTracking")>("../services/projectTracking");
  return {
    ...actual,
    listProjectWorkflowTemplates: (...args: unknown[]) => listProjectWorkflowTemplatesMock(...args),
    getProjectWorkflowCommandCenter: (...args: unknown[]) => getProjectWorkflowCommandCenterMock(...args),
    getProjectWorkflowInstance: (...args: unknown[]) => getProjectWorkflowInstanceMock(...args),
    transitionProjectWorkflowStep: (...args: unknown[]) => transitionProjectWorkflowStepMock(...args),
    sendProjectWorkflowStepBack: (...args: unknown[]) => sendProjectWorkflowStepBackMock(...args),
    listWorkflowAssignableUsers: (...args: unknown[]) => listWorkflowAssignableUsersMock(...args),
    getProjectWorkflowProductionQueue: (...args: unknown[]) => getProjectWorkflowProductionQueueMock(...args),
    acceptProjectWorkflowHandoff: (...args: unknown[]) => acceptProjectWorkflowHandoffMock(...args),
    claimProjectWorkflowHandoff: (...args: unknown[]) => claimProjectWorkflowHandoffMock(...args),
    markProjectWorkflowHandoffWaiting: (...args: unknown[]) => markProjectWorkflowHandoffWaitingMock(...args),
    markProjectWorkflowHandoffProductionComplete: (...args: unknown[]) => markProjectWorkflowHandoffProductionCompleteMock(...args),
    returnProjectWorkflowHandoffToSchools: (...args: unknown[]) => returnProjectWorkflowHandoffToSchoolsMock(...args)
  };
});

const sessionTrust = {
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
  id: "leader-1",
  tenantId: "tenant-1",
  accountId: "account-1",
  sessionId: "session-1",
  email: "leader@example.com",
  fullName: "Leader One",
  status: "active",
  department: "schools",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["leadership"],
  permissions: ["workflow.read", "workflow.template.manage"],
  authorityTier: "leadership",
  primaryJobFunctionProfile: "leadership_team_member",
  jobFunctionProfiles: ["leadership_team_member"],
  permissionGrants: [],
  effectiveScopes: ["organization_wide_scope"],
  sessionTrust
};

function step(overrides: Partial<ProjectWorkflowCommandCenter["steps"][number]>): ProjectWorkflowCommandCenter["steps"][number] {
  return {
    id: "step-1",
    workflow_run_id: "workflow-1",
    job_id: "job-1",
    milestone_key: "intake",
    step_key: "confirm_scope",
    name: "Confirm scope",
    description: "Make sure the job has enough information to move forward.",
    department: "schools",
    role_key: "account_owner",
    assigned_user_id: null,
    assigned_user_name: null,
    assignment_status: null,
    assigned_queue: null,
    assigned_by_user_id: null,
    assigned_by_user_name: null,
    assigned_at: null,
    waiting_on_party: null,
    waiting_detail: null,
    status: "IN_PROGRESS",
    required: true,
    skippable: false,
    blocking: true,
    expected_duration_minutes: 1440,
    started_at: "2026-05-01T10:00:00.000Z",
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
    updated_at: "2026-05-01T11:00:00.000Z",
    job_title: "White Bear Lake High School Fall Portraits",
    organization_name: "White Bear Lake High School",
    ...overrides
  };
}

const globalCommandCenter: ProjectWorkflowCommandCenter = {
  generated_at: "2026-05-01T12:00:00.000Z",
  view: "global",
  summary: {
    open_steps: 2,
    overdue_steps: 1,
    due_soon_steps: 0,
    blocked_steps: 1,
    assigned_steps: 0,
    rework_steps: 0,
    at_risk_steps: 2,
    total_active_workflows: 2,
    total_open_work: 2,
    total_needs_attention: 2,
    total_blocked: 1,
    total_running_late: 1,
    total_due_soon: 0,
    total_returned_for_fixes: 0,
    total_waiting_on_school: 0,
    total_waiting_on_kp: 0,
    total_missing_info: 1,
    total_complete: 0,
    total_no_workflow_linked: 0,
    source: "true_totals",
    confidence: "mixed"
  },
  alerts: [
    {
      step_id: "step-late",
      workflow_run_id: "workflow-late",
      job_id: "job-late",
      level: "overdue",
      title: "Confirm Files Received",
      summary: "Files are running late.",
      department: "production",
      assigned_user_id: null,
      job_title: "Maple Grove Senior High Retakes",
      organization_name: "Maple Grove Senior High"
    }
  ],
  steps: [
    step({
      id: "step-late",
      workflow_run_id: "workflow-late",
      job_id: "job-late",
      milestone_key: "production",
      step_key: "confirm_files_received",
      name: "Confirm Files Received",
      department: "production",
      role_key: "production_owner",
      assigned_user_name: "Maya",
      status: "OVERDUE",
      timing: {
        elapsed_minutes: 1700,
        remaining_minutes: 0,
        overdue_minutes: 260,
        idle_minutes: 0,
        sla_percent: 118,
        alert_level: "overdue",
        health_state: "red"
      },
      job_title: "Maple Grove Senior High Retakes",
      organization_name: "Maple Grove Senior High"
    }),
    step({
      id: "step-blocked",
      workflow_run_id: "workflow-blocked",
      job_id: "job-blocked",
      name: "Confirm roster upload",
      status: "BLOCKED",
      exception_reason: "Waiting on school roster",
      timing: {
        elapsed_minutes: 500,
        remaining_minutes: 0,
        overdue_minutes: 0,
        idle_minutes: 45,
        sla_percent: 65,
        alert_level: "risk",
        health_state: "red"
      },
      job_title: "White Bear Lake High School Fall Portraits",
      organization_name: "White Bear Lake High School"
    })
  ],
  job_rows: [
    {
      job_id: "job-late",
      job_number: "SCH-2026-0001",
      job_code: "SCH-2026-0001",
      job_title: "Maple Grove Senior High Retakes",
      organization_id: "org-maple-grove",
      organization_name: "Maple Grove Senior High",
      account_id: null,
      account_name: null,
      workflow_run_id: "workflow-late",
      workflow_template_id: "template-1",
      workflow_template_name: "School Portraits Workflow",
      workflow_template_version: "v1",
      current_step: {
        ...step({
          id: "step-late",
          workflow_run_id: "workflow-late",
          job_id: "job-late",
          milestone_key: "production",
          step_key: "confirm_files_received",
          name: "Confirm Files Received",
          department: "production",
          role_key: "production_owner",
          assigned_user_name: "Maya",
          status: "OVERDUE",
          timing: {
            elapsed_minutes: 1700,
            remaining_minutes: 0,
            overdue_minutes: 260,
            idle_minutes: 0,
            sla_percent: 118,
            alert_level: "overdue",
            health_state: "red"
          },
          job_title: "Maple Grove Senior High Retakes",
          organization_name: "Maple Grove Senior High"
        }),
        phase: "production"
      },
      phase: "production",
      owner_display: "Maya",
      owner_type: "user",
      job_date: null,
      next_deadline_at: "2026-05-01T12:00:00.000Z",
      deadline_state: "running_late",
      waiting_on_party: "none",
      health: "running_late",
      health_reasons: ["Next deadline is overdue"],
      file_status: "waiting_for_files",
      missing_info_flags: ["missing_job_date"],
      rework_count: 0,
      blocked_reason: null,
      queue_intelligence: {
        reason: "Confirm Files Received is overdue.",
        trigger: "Next workflow deadline has passed.",
        owner_lane: "Maya",
        next_action: "Open the workflow and move, complete, or replan Confirm Files Received.",
        clear_condition: "Clear when the step completes or the workflow deadline is replanned.",
        operational_status: "overdue"
      },
      updated_at: "2026-05-01T11:00:00.000Z"
    },
    {
      job_id: "job-blocked",
      job_number: "SCH-2026-0002",
      job_code: "SCH-2026-0002",
      job_title: "White Bear Lake High School Fall Portraits",
      organization_id: "org-white-bear",
      organization_name: "White Bear Lake High School",
      account_id: null,
      account_name: null,
      workflow_run_id: "workflow-blocked",
      workflow_template_id: "template-1",
      workflow_template_name: "School Portraits Workflow",
      workflow_template_version: "v1",
      current_step: {
        ...step({
          id: "step-blocked",
          workflow_run_id: "workflow-blocked",
          job_id: "job-blocked",
          name: "Confirm roster upload",
          status: "BLOCKED",
          exception_reason: "Waiting on school roster",
          timing: {
            elapsed_minutes: 500,
            remaining_minutes: 0,
            overdue_minutes: 0,
            idle_minutes: 45,
            sla_percent: 65,
            alert_level: "risk",
            health_state: "red"
          },
          job_title: "White Bear Lake High School Fall Portraits",
          organization_name: "White Bear Lake High School"
        }),
        phase: "intake"
      },
      phase: "intake",
      owner_display: "account owner",
      owner_type: "role",
      job_date: "2026-05-10T14:00:00.000Z",
      next_deadline_at: "2026-05-02T12:00:00.000Z",
      deadline_state: "blocked",
      waiting_on_party: "unknown",
      health: "blocked",
      health_reasons: ["Current step is blocked"],
      file_status: "not_connected",
      missing_info_flags: ["missing_waiting_on_party"],
      rework_count: 0,
      blocked_reason: "Waiting on school roster",
      queue_intelligence: {
        reason: "Blocked: Waiting on school roster",
        trigger: "Current workflow step is blocked.",
        owner_lane: "Schools Queue",
        next_action: "Resolve the blocker on Confirm roster upload.",
        clear_condition: "Clear when the blocker is removed or the step leaves Blocked.",
        operational_status: "blocked"
      },
      updated_at: "2026-05-01T11:00:00.000Z"
    }
  ]
};

describe("ProjectTrackingFoundation", () => {
  beforeEach(() => {
    listProjectWorkflowTemplatesMock.mockReset();
    getProjectWorkflowCommandCenterMock.mockReset();
    getProjectWorkflowInstanceMock.mockReset();
    transitionProjectWorkflowStepMock.mockReset();
    sendProjectWorkflowStepBackMock.mockReset();
    listWorkflowAssignableUsersMock.mockReset();
    getProjectWorkflowProductionQueueMock.mockReset();
    acceptProjectWorkflowHandoffMock.mockReset();
    claimProjectWorkflowHandoffMock.mockReset();
    markProjectWorkflowHandoffWaitingMock.mockReset();
    markProjectWorkflowHandoffProductionCompleteMock.mockReset();
    returnProjectWorkflowHandoffToSchoolsMock.mockReset();
    window.location.hash = "#project-tracking";
    listProjectWorkflowTemplatesMock.mockResolvedValue({
      templates: [
        {
          id: "template-1",
          template_key: "mission_control_demo_school_portraits",
          name: "School Portraits Workflow",
          description: "Demo workflow.",
          active_version_id: "version-1",
          version_number: 1,
          departments_involved: ["schools", "production"],
          default_for_new_jobs: true,
          updated_at: "2026-05-01T10:00:00.000Z"
        }
      ]
    });
    listWorkflowAssignableUsersMock.mockResolvedValue([
      {
        user_id: "leader-1",
        full_name: "Leader One",
        email: "leader@example.com",
        department: "schools",
        membership_status: "active"
      },
      {
        user_id: "production-1",
        full_name: "Production Lead",
        email: "production@example.com",
        department: "production",
        membership_status: "active"
      }
    ]);
    getProjectWorkflowCommandCenterMock.mockImplementation((_token: string, query: { view?: string }) => {
      if (query.view === "global") {
        return Promise.resolve(globalCommandCenter);
      }
      return Promise.resolve({ ...globalCommandCenter, view: query.view ?? "personal", steps: [], alerts: [] });
    });
    getProjectWorkflowInstanceMock.mockResolvedValue(null);
    getProjectWorkflowProductionQueueMock.mockResolvedValue({
      generated_at: "2026-05-01T12:00:00.000Z",
      summary: { ready_for_production: 0, needs_assignment: 0, waiting_on_info: 0, due_today: 0, overdue: 0 },
      items: []
    });
  });

  it("renders Project Tracking as a board-first kanban surface with owners, due dates, priority, and attention signals", async () => {
    render(<ProjectTrackingFoundation token="token" currentUser={leadershipUser} />);

    expect(await screen.findByRole("heading", { name: "Project Tracking" })).toBeInTheDocument();
    expect(screen.getByText("Track internal projects, owners, blockers, milestones, and leadership decisions.")).toBeInTheDocument();
    expect(screen.queryByText("Open First")).not.toBeInTheDocument();
    expect(screen.queryByText("Quick Access")).not.toBeInTheDocument();
    expect(screen.queryByText("Shortcuts")).not.toBeInTheDocument();
    expect(screen.queryByText(/Work Spine/i)).not.toBeInTheDocument();
    expect(screen.getByText("Project Health")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Active Projects/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Needs Attention/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /At Risk/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Blocked/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Completed This Month/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Review Blocked / At Risk" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review Blocked / At Risk" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Prep Readiness" })).not.toBeInTheDocument();

    expect(screen.getByText("Project Board")).toBeInTheDocument();
    expect(screen.getByText("Kanban view of projects, owners, due dates, blockers, and next steps.")).toBeInTheDocument();
    const viewModes = screen.getByLabelText("Project Tracking view modes");
    expect(within(viewModes).getByRole("button", { name: /Board/i })).toHaveAttribute("aria-pressed", "true");
    expect(within(viewModes).getByRole("button", { name: /List/i })).toHaveAttribute("aria-pressed", "false");
    expect(within(viewModes).getByRole("button", { name: /Table/i })).toHaveAttribute("aria-pressed", "false");
    expect(within(viewModes).getByRole("button", { name: /Timeline/i })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Board-first view grouped by project status. Filters and search control the work shown here.")).toBeInTheDocument();
    expect(screen.getByLabelText("Project Tracking board lanes")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /To Do, 0 items/i })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /In Progress, 0 items/i })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /In Review, 0 items/i })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /On Hold, 2 items/i })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /Complete, 0 items/i })).toBeInTheDocument();
    expect(screen.getAllByText("Owner").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Due").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Priority").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Status").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Confirm Files Received").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Maple Grove Senior High").length).toBeGreaterThan(0);
    expect(screen.getAllByText("High").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Running late").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Needs Attention").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /View workflow for/i }).length).toBeGreaterThan(0);
    expect(screen.queryByText("School Portraits Workflow")).not.toBeInTheDocument();
    expect(screen.queryByText("mission_control_demo_school_portraits")).not.toBeInTheDocument();
    expect(screen.queryByText("No workflow linked")).not.toBeInTheDocument();
    expect(screen.queryByText("Job record")).not.toBeInTheDocument();

    const presetLenses = screen.getByLabelText("Project Tracking preset lenses");
    expect(within(presetLenses).getByRole("button", { name: /All Active, 2 items, active preset/i })).toHaveAttribute("aria-pressed", "true");
    expect(within(presetLenses).getByRole("button", { name: /Leadership Review, 2 items/i })).toBeInTheDocument();
    expect(within(presetLenses).getByRole("button", { name: /Schools, 1 item/i })).toBeInTheDocument();
    expect(within(presetLenses).getByRole("button", { name: /Sports, 0 items/i })).toBeInTheDocument();
    expect(within(presetLenses).getByRole("button", { name: /Photography, 0 items/i })).toBeInTheDocument();
    expect(within(presetLenses).getByRole("button", { name: /Completed This Month, 0 items/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search work, schools, owners, next steps...")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Department" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Priority" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Owner" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Due Month" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Due Year" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sort" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Saved views planned/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mine filter" })).toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 2 work items - Preset: All Active - all departments - Filtered by all work")).toBeInTheDocument();

    fireEvent.click(within(viewModes).getByRole("button", { name: /Table/i }));
    expect(within(viewModes).getByRole("button", { name: /Table/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Precision review for owner, status, due date, health, and action.")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Project Tracking table view" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Department" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Owner / Queue" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status / Phase" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Waiting / Blocked" })).toBeInTheDocument();

    fireEvent.click(within(viewModes).getByRole("button", { name: /Timeline/i }));
    expect(within(viewModes).getByRole("button", { name: /Timeline/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Date pressure from the same filtered work. Unscheduled work stays visible.")).toBeInTheDocument();
    expect(screen.getByLabelText("Project Tracking timeline preview")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /Overdue, 2 items/i })).toBeInTheDocument();
    expect(screen.getByText("Unscheduled")).toBeInTheDocument();

    fireEvent.click(within(viewModes).getByRole("button", { name: /List/i }));
    expect(within(viewModes).getByRole("button", { name: /List/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("list", { name: "Project Tracking active work list" })).toBeInTheDocument();

    const expandMaple = screen.getByRole("button", { name: /Expand details for Maple Grove Senior High Retakes/i });
    expect(expandMaple).toHaveAttribute("aria-expanded", "false");
    expect(expandMaple).toHaveAttribute("aria-controls");
    fireEvent.click(expandMaple);
    expect(expandMaple).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("Workflow Details")).toBeInTheDocument();
    expect(screen.getByText("Owner / Queue")).toBeInTheDocument();
    expect(screen.getByText("Deadlines")).toBeInTheDocument();
    expect(screen.getByText("Blockers / Waiting")).toBeInTheDocument();
    expect(screen.getByText("Related Job / Account")).toBeInTheDocument();
    expect(await screen.findByText("Job record")).toBeInTheDocument();
    expect(screen.getByText("Job date")).toBeInTheDocument();
    expect(screen.getByText("File status")).toBeInTheDocument();
    expect(screen.getByText("Shared note")).toBeInTheDocument();
    expect(screen.getByText("Why it matters")).toBeInTheDocument();
    expect(screen.getByText("Confirm Files Received is overdue.")).toBeInTheDocument();
    expect(screen.getByText("Clear condition")).toBeInTheDocument();
    expect(screen.getByText("Clear when the step completes or the workflow deadline is replanned.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /View workflow for/i }).length).toBeGreaterThan(0);

    const activeWorkBoard = screen.getByRole("list", { name: "Project Tracking active work list" });
    const mapleRow = within(activeWorkBoard).getByText("Maple Grove Senior High Retakes").closest("article");
    expect(mapleRow).not.toBeNull();
    fireEvent.click(within(mapleRow as HTMLElement).getAllByRole("button", { name: /View workflow for Maple Grove Senior High Retakes/i })[0]);
    expect(window.location.hash).toBe("#project-tracking/workflows/workflow-late");
  });

  it("filters, searches, and clears the jobs board from compact controls", async () => {
    render(<ProjectTrackingFoundation token="token" currentUser={leadershipUser} />);

    await screen.findByLabelText("Project Tracking board lanes");
    const departmentSelect = screen.getByRole("combobox", { name: "Department" });
    fireEvent.change(departmentSelect, { target: { value: "schools" } });

    let board = screen.getByLabelText("Project Tracking board lanes").closest("section");
    expect(board).not.toBeNull();
    expect(within(board as HTMLElement).getByText("White Bear Lake High School Fall Portraits")).toBeInTheDocument();
    expect(within(board as HTMLElement).queryByText("Maple Grove Senior High Retakes")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 2 work items - Preset: All Active - Schools - Filtered by all work")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Clear Project Tracking filters/i }));
    expect(screen.getByText("Showing 2 of 2 work items - Preset: All Active - all departments - Filtered by all work")).toBeInTheDocument();

    const filters = screen.getByLabelText("Project tracking filters");
    fireEvent.click(within(filters).getByRole("button", { name: "Blocked filter" }));

    board = screen.getByLabelText("Project Tracking board lanes").closest("section");
    expect(board).not.toBeNull();
    expect(within(board as HTMLElement).getByText("White Bear Lake High School Fall Portraits")).toBeInTheDocument();
    expect(within(board as HTMLElement).queryByText("Maple Grove Senior High Retakes")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 2 work items - Preset: All Active - all departments - Filtered by blocked")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Clear Project Tracking filters/i }));
    expect(screen.getByText("Showing 2 of 2 work items - Preset: All Active - all departments - Filtered by all work")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Priority" }), { target: { value: "high" } });
    expect(screen.getByText("Showing 2 of 2 work items - Preset: All Active - all departments - Filtered by all work - Priority: High")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Clear Project Tracking filters/i }));
    fireEvent.change(screen.getByPlaceholderText("Search work, schools, owners, next steps..."), { target: { value: "Maple Grove" } });
    board = screen.getByLabelText("Project Tracking board lanes").closest("section");
    expect(within(board as HTMLElement).getByText("Maple Grove Senior High Retakes")).toBeInTheDocument();
    expect(within(board as HTMLElement).queryByText("White Bear Lake High School Fall Portraits")).not.toBeInTheDocument();
    await waitFor(() => expect(getProjectWorkflowCommandCenterMock).toHaveBeenCalled());
  });

  it("uses Needs Attention Review actions as temporary filters without breaking preset lenses", async () => {
    render(<ProjectTrackingFoundation token="token" currentUser={leadershipUser} />);

    await screen.findByLabelText("Project Tracking board lanes");
    const blockedCommandGroup = screen.getByLabelText("Blocked command group");
    const blockedCommandButton = within(blockedCommandGroup).getByRole("button", { name: "Review blocked work" });
    expect(blockedCommandButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(blockedCommandButton);

    let board = screen.getByLabelText("Project Tracking board lanes").closest("section");
    expect(board).not.toBeNull();
    expect(within(board as HTMLElement).getByText("White Bear Lake High School Fall Portraits")).toBeInTheDocument();
    expect(within(board as HTMLElement).queryByText("Maple Grove Senior High Retakes")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 1 work items - Preset: All Active - all departments - Filtered by all work - Needs Attention: Blocked")).toBeInTheDocument();
    expect(screen.getByLabelText("Blocked command group, active command filter")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Active command filter: blocked work" })).toHaveAttribute("aria-pressed", "true");

    const presetLenses = screen.getByLabelText("Project Tracking preset lenses");
    fireEvent.click(within(presetLenses).getByRole("button", { name: /Leadership Review, 2 items/i }));
    board = screen.getByLabelText("Project Tracking board lanes").closest("section");
    expect(board).not.toBeNull();
    expect(within(board as HTMLElement).getByText("White Bear Lake High School Fall Portraits")).toBeInTheDocument();
    expect(within(board as HTMLElement).getByText("Maple Grove Senior High Retakes")).toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 2 work items - Preset: Leadership Review - all departments - Filtered by all work")).toBeInTheDocument();
    expect(screen.queryByText(/Needs Attention: Blocked/)).not.toBeInTheDocument();
  });

  it("applies no-persistence preset lenses with honest counts and calm empty states", async () => {
    render(<ProjectTrackingFoundation token="token" currentUser={leadershipUser} />);

    await screen.findByLabelText("Project Tracking board lanes");
    const presetLenses = screen.getByLabelText("Project Tracking preset lenses");
    fireEvent.click(within(presetLenses).getByRole("button", { name: /Schools, 1 item/i }));

    let board = screen.getByLabelText("Project Tracking board lanes").closest("section");
    expect(board).not.toBeNull();
    expect(within(board as HTMLElement).getByText("White Bear Lake High School Fall Portraits")).toBeInTheDocument();
    expect(within(board as HTMLElement).queryByText("Maple Grove Senior High Retakes")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 1 work items - Preset: Schools - all departments - Filtered by all work")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search work, schools, owners, next steps..."), { target: { value: "missing search text" } });
    expect(screen.getByText('No work items match "missing search text" inside Schools. Clear the search or filters to broaden the view.')).toBeInTheDocument();

    fireEvent.click(within(presetLenses).getByRole("button", { name: /Photography, 0 items/i }));
    expect(screen.getByText("No Photography active work found.")).toBeInTheDocument();

    fireEvent.click(within(presetLenses).getByRole("button", { name: /Leadership Review, 2 items/i }));
    board = screen.getByLabelText("Project Tracking board lanes").closest("section");
    expect(board).not.toBeNull();
    expect(within(board as HTMLElement).getByText("White Bear Lake High School Fall Portraits")).toBeInTheDocument();
    expect(within(board as HTMLElement).getByText("Maple Grove Senior High Retakes")).toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 2 work items - Preset: Leadership Review - all departments - Filtered by all work")).toBeInTheDocument();
  });

  it("renders department queues from the current workflow step department only", async () => {
    render(
      <ProjectTrackingDepartmentQueue
        token="token"
        department="production"
        title="Production / Graphics Work Queue"
        summary="Active Project Dashboard steps currently owned by Production."
      />
    );

    expect(await screen.findByRole("heading", { name: "Production / Graphics Work Queue" })).toBeInTheDocument();
    expect(screen.getByText("1 in queue")).toBeInTheDocument();
    expect(screen.getByText("Maple Grove Senior High Retakes")).toBeInTheDocument();
    expect(screen.queryByText("White Bear Lake High School Fall Portraits")).not.toBeInTheDocument();
    expect(screen.getByText("Organization / account")).toBeInTheDocument();
    expect(screen.getByText("Current step")).toBeInTheDocument();
    expect(screen.getByText("Department")).toBeInTheDocument();
    expect(screen.getByText("Assigned person")).toBeInTheDocument();
    expect(screen.getByText("Shared note")).toBeInTheDocument();
    expect(screen.getByText("Here by current step department")).toBeInTheDocument();
    expect(screen.getByText("Running late")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("Job date")).toBeInTheDocument();
    expect(screen.getByText("Next deadline")).toBeInTheDocument();
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(screen.getByText("Confirm Files Received is overdue.")).toBeInTheDocument();
    expect(screen.getByText("Open the workflow and move, complete, or replan Confirm Files Received.")).toBeInTheDocument();
    expect(screen.getByText("Clear when the step completes or the workflow deadline is replanned.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Job" })).toHaveAttribute("href", "#jobs/job-late");
    expect(screen.getByRole("link", { name: "Open Workflow" })).toHaveAttribute(
      "href",
      "#project-tracking/workflows/workflow-late"
    );
    await waitFor(() =>
      expect(getProjectWorkflowCommandCenterMock).toHaveBeenCalledWith("token", {
        view: "department",
        department: "production",
        limit: 6
      })
    );
  });

  it("also routes department queues by assigned department when ownership moves across departments", async () => {
    getProjectWorkflowCommandCenterMock.mockResolvedValueOnce({
      ...globalCommandCenter,
      job_rows: [
        {
          ...globalCommandCenter.job_rows[1],
          job_id: "job-schools-production-queue",
          job_title: "White Bear Lake Production Assist",
          current_step: {
            ...globalCommandCenter.job_rows[1].current_step!,
            department: "schools",
            assigned_queue: "production",
            assignment_status: "queued"
          },
          owner_display: "Production queue",
          owner_type: "department"
        }
      ]
    });

    render(
      <ProjectTrackingDepartmentQueue
        token="token"
        department="production"
        title="Production / Graphics Work Queue"
        summary="Active Project Dashboard steps currently owned by Production."
      />
    );

    expect(await screen.findByText("White Bear Lake Production Assist")).toBeInTheDocument();
    expect(screen.getByText("1 in queue")).toBeInTheDocument();
    expect(screen.getByText("Schools / Production")).toBeInTheDocument();
    expect(screen.getByText("Here by Production department")).toBeInTheDocument();
    expect(screen.getByText("Production Queue")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("Blocked: Waiting on school roster")).toBeInTheDocument();
  });

  it("opens the workflow progress route and updates the current step with the existing transition API", async () => {
    window.location.hash = "#project-tracking/workflows/workflow-late";
    const workflowDetail = {
      workflow_run: {
        id: "workflow-late",
        job_id: "job-late",
        template_id: "template-1",
        template_version_id: "version-1",
        template_key: "school_portraits",
        template_name: "School Portraits Workflow",
        template_version_label: "v1",
        workflow_family: "project_tracking" as const,
        status: "active",
        started_at: "2026-05-01T10:00:00.000Z",
        completed_at: null
      },
      job: {
        id: "job-late",
        title: "Maple Grove Senior High Retakes",
        job_type: "photo_day",
        organization_id: "org-maple-grove",
        organization_name: "Maple Grove Senior High",
        account_owner_user_id: null
      },
      milestones: [
        {
          id: "milestone-production",
          milestone_key: "production",
          name: "Production",
          description: null,
          status: "ACTIVE" as const,
          steps: [
            {
              ...step({
                id: "step-prior",
                workflow_run_id: "workflow-late",
                job_id: "job-late",
                milestone_key: "production",
                step_key: "receive_images",
                name: "Receive Images",
                department: "production",
                status: "COMPLETE",
                completed_at: "2026-05-01T10:30:00.000Z",
                updated_at: "2026-05-01T10:30:00.000Z",
                expected_duration_minutes: 720,
                job_title: "Maple Grove Senior High Retakes",
                organization_name: "Maple Grove Senior High"
              })
            },
            {
              ...step({
                id: "step-late",
                workflow_run_id: "workflow-late",
                job_id: "job-late",
                milestone_key: "production",
                step_key: "confirm_files_received",
                name: "Confirm Files Received",
                department: "production",
                role_key: "production_owner",
                assigned_user_name: "Maya",
                status: "IN_PROGRESS",
                timing: {
                  elapsed_minutes: 120,
                  remaining_minutes: 1320,
                  overdue_minutes: 0,
                  idle_minutes: 0,
                  sla_percent: 20,
                  alert_level: "none",
                  health_state: "green"
                },
                job_title: "Maple Grove Senior High Retakes",
                organization_name: "Maple Grove Senior High"
              })
            }
          ]
        }
      ],
      handoffs: [],
      audit_events: []
    };
    getProjectWorkflowInstanceMock.mockResolvedValue(workflowDetail);
    transitionProjectWorkflowStepMock.mockResolvedValue(workflowDetail);
    sendProjectWorkflowStepBackMock.mockResolvedValue(workflowDetail);

    render(<ProjectTrackingFoundation token="token" currentUser={leadershipUser} />);

    await screen.findByRole("heading", { name: "Maple Grove Senior High Retakes" });
    expect(screen.getAllByText("Workflow Detail").length).toBeGreaterThan(0);
    expect(screen.getByText("Action surface for the selected job workflow.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Maple Grove Senior High Retakes" })).toBeInTheDocument();
    expect(screen.getByLabelText("Current State")).toHaveTextContent("Ready");
    expect(screen.getAllByText("Work the current step: Confirm Files Received.").length).toBeGreaterThan(0);
    expect(screen.getByText("Owner: Maya. Due: On track; exact deadline not connected yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit Workflow Steps" })).toHaveAttribute("href", "#project-tracking/workflow-templates");
    expect(screen.getByText("Edit step names, departments, and order in Workflow Templates.")).toBeInTheDocument();
    expect(screen.getAllByText("Current Step Editor").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Step Editor" })).toBeInTheDocument();
    expect(screen.getAllByText("Workflow Steps").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Current Step: Confirm Files Received")).toBeInTheDocument();
    expect(screen.getByText("No handoffs recorded yet.")).toBeInTheDocument();
    expect(screen.getByText("No activity recorded yet.")).toBeInTheDocument();
    expect(await screen.findByText("Assigned person appears in My Work. Department-only work stays in the Production Queue until a person is assigned.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Assign step to me" }));
    await waitFor(() =>
      expect(transitionProjectWorkflowStepMock).toHaveBeenCalledWith(
        "token",
        "step-late",
        expect.objectContaining({
          assigned_user_id: "leader-1",
          reason: "Assigned current workflow step to Leader One."
        })
      )
    );
    transitionProjectWorkflowStepMock.mockClear();
    fireEvent.change(await screen.findByLabelText("Assigned person"), { target: { value: "production-1" } });
    fireEvent.change(screen.getByLabelText("Department"), { target: { value: "production" } });
    fireEvent.change(screen.getByPlaceholderText("Why is ownership changing?"), { target: { value: "Assigning Production lead for Tuesday QA." } });
    fireEvent.click(screen.getByRole("button", { name: "Save assignment" }));
    await waitFor(() =>
      expect(transitionProjectWorkflowStepMock).toHaveBeenCalledWith(
        "token",
        "step-late",
        expect.objectContaining({
          status: "IN_PROGRESS",
          assigned_user_id: "production-1",
          assigned_queue: "production",
          notes: "Assigning Production lead for Tuesday QA.",
          reason: "Updated workflow assignment (person: Production Lead, queue: Production Queue)."
        })
      )
    );
    transitionProjectWorkflowStepMock.mockClear();
    fireEvent.change(screen.getByLabelText("Current step"), { target: { value: "COMPLETE" } });
    fireEvent.change(screen.getByPlaceholderText("Visible in queues, My Work, and workflow detail"), { target: { value: "Files checked and ready." } });
    fireEvent.click(screen.getByRole("button", { name: "Save progress" }));

    await waitFor(() =>
      expect(transitionProjectWorkflowStepMock).toHaveBeenCalledWith(
        "token",
        "step-late",
        expect.objectContaining({
          status: "COMPLETE",
          notes: "Files checked and ready.",
          last_seen_updated_at: "2026-05-01T11:00:00.000Z"
        })
      )
    );
    expect(await screen.findByText("Progress saved")).toBeInTheDocument();
    transitionProjectWorkflowStepMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Close job" }));
    const closeDialog = await screen.findByRole("dialog", { name: "Close this job?" });
    expect(within(closeDialog).getByText("This will mark the job as closed. You can still review it later, but it may leave active queues.")).toBeInTheDocument();
    fireEvent.click(within(closeDialog).getByRole("button", { name: "Cancel" }));
    expect(transitionProjectWorkflowStepMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close job" }));
    const reopenedCloseDialog = await screen.findByRole("dialog", { name: "Close this job?" });
    fireEvent.change(within(reopenedCloseDialog).getByLabelText("Closeout note (optional)"), { target: { value: "Final review complete." } });
    fireEvent.click(within(reopenedCloseDialog).getByRole("button", { name: "Yes, close job" }));
    await waitFor(() =>
      expect(transitionProjectWorkflowStepMock).toHaveBeenCalledWith(
        "token",
        "step-late",
        expect.objectContaining({
          status: "COMPLETE",
          notes: "Final review complete.",
          reason: "Final review complete."
        })
      )
    );
    expect(await screen.findByText("Closeout step completed")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Close this job?" })).not.toBeInTheDocument();
    transitionProjectWorkflowStepMock.mockClear();
    fireEvent.change(screen.getByPlaceholderText("Why are we clawing this job back?"), { target: { value: "Moved too soon during review." } });
    fireEvent.click(screen.getByRole("button", { name: "Claw back to previous step" }));
    await waitFor(() =>
      expect(sendProjectWorkflowStepBackMock).toHaveBeenCalledWith(
        "token",
        "step-late",
        expect.objectContaining({
          target_step_id: "step-prior",
          reason: "Moved too soon during review.",
          assigned_user_id: "leader-1",
          expected_duration_minutes: 720
        })
      )
    );
    await waitFor(() => expect(getProjectWorkflowCommandCenterMock).toHaveBeenCalledWith("token", { view: "global", limit: 100 }));
  });

  it("renders Production Queue V1 with only handoff-backed workflow items and queue actions", async () => {
    const queuePayload = {
      generated_at: "2026-05-01T12:00:00.000Z",
      summary: { ready_for_production: 1, needs_assignment: 1, waiting_on_info: 0, due_today: 1, overdue: 0 },
      items: [
        {
          source: "handoff" as const,
          handoff_id: "handoff-1",
          workflow_run_id: "workflow-lakeview",
          job_id: "job-lakeview",
          job_title: "Lakeview Elementary Retake Day",
          job_type: "photo_day",
          organization_id: "org-lakeview",
          organization_name: "Lakeview Elementary",
          step_id: "step-production",
          production_step: "Confirm Files Received",
          step_status: "WAITING",
          needed_work: "Confirm files, count images, and prepare Production work.",
          due_at: "2026-05-02T18:00:00.000Z",
          status: "sent_to_production" as const,
          assignment_status: "needs_assignment" as const,
          assigned_queue: "production",
          assigned_user_id: null,
          assigned_user_name: null,
          waiting_on_party: null,
          waiting_detail: null,
          missing_info: null,
          notes: "Production handoff note is visible from the queue.",
          lane_reason: "Here by Production handoff",
          next_action: "Accept the Production handoff and confirm the next owner.",
          clear_condition: "Clears when Production accepts the handoff.",
          operational_status: "missing_owner" as const,
          last_updated: "2026-05-01T11:00:00.000Z"
        },
        {
          source: "live_workflow_assignment" as const,
          handoff_id: null,
          workflow_run_id: "workflow-queue-only",
          job_id: "job-queue-only",
          job_title: "Riverside Elementary Spring Portraits",
          job_type: "photo_day",
          organization_id: "org-riverside",
          organization_name: "Riverside Elementary",
          step_id: "step-queue-only",
          production_step: "Edit proof set",
          step_status: "IN_PROGRESS",
          needed_work: "Work the current Production step: Edit proof set.",
          due_at: "2026-05-03T18:00:00.000Z",
          status: "accepted_by_production" as const,
          assignment_status: "queued" as const,
          assigned_queue: "production",
          assigned_user_id: null,
          assigned_user_name: null,
          waiting_on_party: null,
          waiting_detail: null,
          missing_info: "Assigned to Production Queue",
          notes: "Edit proof set before parent preview.",
          lane_reason: "Here by Production queue assignment",
          next_action: "Work the current Production step: Edit proof set.",
          clear_condition: "Clears when the current step completes or advances.",
          operational_status: "active" as const,
          last_updated: "2026-05-01T10:00:00.000Z"
        }
      ]
    };
    getProjectWorkflowProductionQueueMock.mockResolvedValue(queuePayload);
    acceptProjectWorkflowHandoffMock.mockResolvedValue({});
    transitionProjectWorkflowStepMock.mockResolvedValue({});

    render(<ProductionWorkflowQueue token="token" currentUser={leadershipUser} />);

    expect(await screen.findByRole("heading", { name: "Production Operating Board" })).toBeInTheDocument();
    expect(screen.getByText("Spencer-facing board for real Production handoffs and queue-owned workflow steps. No fake automation, no synthetic urgency.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What came in" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ready to start" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Blocked / waiting" })).toBeInTheDocument();
    expect(screen.getAllByText("Lakeview Elementary").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Riverside Elementary").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Needs Assignment - Production").length).toBeGreaterThanOrEqual(2);
    const detailButtons = screen.getAllByRole("button", { name: "Details" });
    fireEvent.click(detailButtons[0]);
    expect(screen.getByText("Here by Production handoff")).toBeInTheDocument();
    fireEvent.click(detailButtons[1]);
    expect(screen.getByText("Current workflow step. Use Assign / Status for owner, department, and shared note changes.")).toBeInTheDocument();
    expect(screen.queryByText("Command Layer Job")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Assign / Status" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Open Workflow" })[0]).toHaveAttribute("href", "#project-tracking/workflows/workflow-lakeview");
    expect(screen.getAllByRole("link", { name: "Open Workflow" })[1]).toHaveAttribute("href", "#project-tracking/workflows/workflow-queue-only");
    expect(screen.getAllByRole("link", { name: "Open account" })[0]).toHaveAttribute("href", "#client-command-center/accounts/org-lakeview");
    expect(screen.getAllByRole("link", { name: "Open Account" })[0]).toHaveAttribute("href", "#client-command-center/accounts/org-lakeview");
    expect(screen.getAllByRole("link", { name: "Open job" })[0]).toHaveAttribute("href", "#jobs/detail?preview=job-lakeview");
    expect(screen.getAllByRole("link", { name: "Open Job" })[0]).toHaveAttribute("href", "#jobs/detail?preview=job-lakeview");
    expect(screen.queryByText("Use Assign / Status for owner, department, and note changes, or Open Workflow for deeper review and send-back.")).not.toBeInTheDocument();
    expect(window.location.hash).toBe("#project-tracking");
    const lakeviewRow = screen
      .getAllByText("Lakeview Elementary")
      .map((element) => element.closest(".production-workflow-row"))
      .find(Boolean);
    expect(lakeviewRow).not.toBeNull();
    getProjectWorkflowInstanceMock.mockResolvedValue({
      workflow_run: {
        id: "workflow-lakeview",
        job_id: "job-lakeview",
        template_id: "template-1",
        template_version_id: "version-1",
        template_key: "school_portraits",
        template_name: "School Portraits Workflow",
        template_version_label: "v1",
        workflow_family: "project_tracking" as const,
        status: "active",
        started_at: "2026-05-01T10:00:00.000Z",
        completed_at: null
      },
      job: {
        id: "job-lakeview",
        title: "Lakeview Elementary Retake Day",
        job_type: "photo_day",
        organization_id: "org-lakeview",
        organization_name: "Lakeview Elementary",
        account_owner_user_id: null
      },
      milestones: [
        {
          id: "milestone-production",
          milestone_key: "production",
          name: "Production",
          description: null,
          status: "ACTIVE" as const,
          steps: [
            {
              ...step({
                id: "step-production",
                workflow_run_id: "workflow-lakeview",
                job_id: "job-lakeview",
                milestone_key: "production",
                step_key: "confirm_files_received",
                name: "Confirm Files Received",
                department: "production",
                status: "IN_PROGRESS",
                updated_at: "2026-05-01T11:00:00.000Z"
              })
            }
          ]
        }
      ],
      handoffs: [],
      audit_events: []
    });
    fireEvent.click(within(lakeviewRow as HTMLElement).getByRole("button", { name: /Confirm Files Received/i }));
    const noNextEditor = await screen.findByLabelText("Move to next step");
    expect(within(noNextEditor).getByText("No valid next step is available. Open Workflow for closeout or send-back review.")).toBeInTheDocument();
    expect(within(noNextEditor).getByRole("button", { name: "Move to next step" })).toBeDisabled();
    fireEvent.click(within(noNextEditor).getByRole("button", { name: "Cancel" }));
    const riversideRow = screen
      .getAllByText("Riverside Elementary")
      .map((element) => element.closest(".production-workflow-row"))
      .find(Boolean);
    expect(riversideRow).not.toBeNull();
    const workflowBeforeMove = {
      workflow_run: {
        id: "workflow-queue-only",
        job_id: "job-queue-only",
        template_id: "template-1",
        template_version_id: "version-1",
        template_key: "school_portraits",
        template_name: "School Portraits Workflow",
        template_version_label: "v1",
        workflow_family: "project_tracking" as const,
        status: "active",
        started_at: "2026-05-01T10:00:00.000Z",
        completed_at: null
      },
      job: {
        id: "job-queue-only",
        title: "Riverside Elementary Spring Portraits",
        job_type: "photo_day",
        organization_id: "org-riverside",
        organization_name: "Riverside Elementary",
        account_owner_user_id: null
      },
      milestones: [
        {
          id: "milestone-production",
          milestone_key: "production",
          name: "Production",
          description: null,
          status: "ACTIVE" as const,
          steps: [
            {
              ...step({
                id: "step-queue-only",
                workflow_run_id: "workflow-queue-only",
                job_id: "job-queue-only",
                milestone_key: "production",
                step_key: "edit_proof_set",
                name: "Edit proof set",
                department: "production",
                status: "IN_PROGRESS",
                assigned_user_id: "production-1",
                assigned_user_name: "Production Lead",
                assigned_queue: "production",
                updated_at: "2026-05-01T10:00:00.000Z"
              })
            },
            {
              ...step({
                id: "step-upload-proofs",
                workflow_run_id: "workflow-queue-only",
                job_id: "job-queue-only",
                milestone_key: "production",
                step_key: "upload_proofs",
                name: "Upload Proofs",
                department: "production",
                status: "WAITING",
                assigned_user_id: null,
                assigned_user_name: null,
                assigned_queue: "production",
                dependency_step_ids: ["step-queue-only"],
                updated_at: "2026-05-01T10:05:00.000Z"
              })
            }
          ]
        }
      ],
      handoffs: [],
      audit_events: []
    };
    const workflowAfterMove = {
      ...workflowBeforeMove,
      milestones: [
        {
          ...workflowBeforeMove.milestones[0],
          steps: [
            { ...workflowBeforeMove.milestones[0].steps[0], status: "COMPLETE" as const, updated_at: "2026-05-01T10:10:00.000Z" },
            { ...workflowBeforeMove.milestones[0].steps[1], status: "NOT_STARTED" as const, updated_at: "2026-05-01T10:10:00.000Z" }
          ]
        }
      ]
    };
    getProjectWorkflowInstanceMock.mockResolvedValue(workflowBeforeMove);
    transitionProjectWorkflowStepMock.mockResolvedValue(workflowAfterMove);
    fireEvent.click(within(riversideRow as HTMLElement).getByRole("button", { name: /Edit proof set/i }));
    const moveEditor = await screen.findByLabelText("Move to next step");
    expect(within(moveEditor).getByDisplayValue("Edit proof set")).toBeInTheDocument();
    expect(within(moveEditor).getByLabelText("Next step")).toHaveValue("step-upload-proofs");
    expect(within(moveEditor).getByLabelText("Keep assigned to current owner")).toBeChecked();
    fireEvent.change(within(moveEditor).getByLabelText("Add a note (optional)"), { target: { value: "Proofs ready for upload." } });
    fireEvent.click(within(moveEditor).getByRole("button", { name: "Move to next step" }));
    await waitFor(() =>
      expect(transitionProjectWorkflowStepMock).toHaveBeenCalledWith(
        "token",
        "step-queue-only",
        expect.objectContaining({
          status: "COMPLETE",
          notes: "Proofs ready for upload.",
          last_seen_updated_at: "2026-05-01T10:00:00.000Z"
        })
      )
    );
    await waitFor(() =>
      expect(transitionProjectWorkflowStepMock).toHaveBeenCalledWith(
        "token",
        "step-upload-proofs",
        expect.objectContaining({
          status: "IN_PROGRESS",
          assigned_user_id: null,
          assigned_queue: "production",
          notes: "Proofs ready for upload.",
          reason: "Moved workflow forward from Edit proof set to Upload Proofs."
        })
      )
    );
    expect(await screen.findByText("Step moved forward. Moved to next step: Upload Proofs")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Close this job?" })).not.toBeInTheDocument();
    expect(window.location.hash).toBe("#project-tracking");
    transitionProjectWorkflowStepMock.mockClear();
    transitionProjectWorkflowStepMock.mockResolvedValue({});
    fireEvent.click(within(riversideRow as HTMLElement).getByRole("button", { name: "Assign / Status" }));
    expect(await screen.findByText("Update current step")).toBeInTheDocument();
    const quickEditor = screen.getByLabelText("Assign / Status current step");
    expect(within(quickEditor).getByText("Edit proof set")).toBeInTheDocument();
    expect(window.location.hash).toBe("#project-tracking");
    await waitFor(() => expect(listWorkflowAssignableUsersMock).toHaveBeenCalledWith("token"));
    expect(within(quickEditor).getByDisplayValue("Edit proof set before parent preview.")).toBeInTheDocument();
    fireEvent.change(within(quickEditor).getByLabelText("Current step"), { target: { value: "BLOCKED" } });
    fireEvent.change(within(quickEditor).getByLabelText("Assigned person"), { target: { value: "production-1" } });
    fireEvent.change(within(quickEditor).getByLabelText("Department"), { target: { value: "production" } });
    fireEvent.keyDown(within(quickEditor).getByLabelText("Shared note"), { key: " " });
    fireEvent.change(within(quickEditor).getByLabelText("Shared note"), { target: { value: "Shared note with spaces" } });
    fireEvent.click(within(quickEditor).getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(transitionProjectWorkflowStepMock).toHaveBeenCalledWith(
        "token",
        "step-queue-only",
        expect.objectContaining({
          status: "BLOCKED",
          assigned_user_id: "production-1",
          assigned_queue: "production",
          notes: "Shared note with spaces",
          reason: expect.stringContaining("Quick update current workflow step")
        })
      )
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Details" })[0]);
    expect(screen.getAllByRole("button", { name: "Return to Schools" })[0]).toBeDisabled();
    expect(screen.getByRole("button", { name: "Accept first" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() =>
      expect(acceptProjectWorkflowHandoffMock).toHaveBeenCalledWith(
        "token",
        "handoff-1"
      )
    );
  });
});
