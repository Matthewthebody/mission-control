import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTemplateBuilderPage } from "../pages/WorkflowTemplateBuilderPage";
import type { SessionUser } from "../types";

const listTemplatesMock = vi.fn();
const getTemplateDetailMock = vi.fn();
const addStepMock = vi.fn();
const updateStepMock = vi.fn();
const moveStepMock = vi.fn();
const removeStepMock = vi.fn();

vi.mock("../services/projectTracking", async () => {
  const actual = await vi.importActual<typeof import("../services/projectTracking")>("../services/projectTracking");
  return {
    ...actual,
    addWorkflowTemplateBuilderStep: (...args: unknown[]) => addStepMock(...args),
    getWorkflowTemplateBuilderDetail: (...args: unknown[]) => getTemplateDetailMock(...args),
    listWorkflowTemplateBuilderTemplates: (...args: unknown[]) => listTemplatesMock(...args),
    moveWorkflowTemplateBuilderStep: (...args: unknown[]) => moveStepMock(...args),
    removeWorkflowTemplateBuilderStep: (...args: unknown[]) => removeStepMock(...args),
    updateWorkflowTemplateBuilderStep: (...args: unknown[]) => updateStepMock(...args)
  };
});

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
  id: "leader-1",
  tenantId: "tenant-1",
  accountId: "account-1",
  sessionId: "session-1",
  email: "leader@example.com",
  fullName: "Leader One",
  status: "active",
  department: "operations",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["leadership"],
  permissions: ["workflow.template.manage"],
  authorityTier: "leadership",
  primaryJobFunctionProfile: "leadership_team_member",
  jobFunctionProfiles: ["leadership_team_member"],
  permissionGrants: [],
  effectiveScopes: ["organization_wide_scope"],
  sessionTrust: standardSessionTrust
};

describe("WorkflowTemplateBuilderPage", () => {
  beforeEach(() => {
    listTemplatesMock.mockClear();
    getTemplateDetailMock.mockClear();
    addStepMock.mockClear();
    updateStepMock.mockClear();
    moveStepMock.mockClear();
    removeStepMock.mockClear();
    listTemplatesMock.mockResolvedValue({
      templates: [
        {
          id: "template-1",
          template_key: "school_photo_day",
          name: "School Photo Day",
          description: "Reusable school workflow.",
          job_type: "photo_day",
          category: "schools",
          status: "active",
          updated_at: "2026-05-01T10:00:00.000Z",
          latest_version: {
            id: "version-1",
            version_number: 2,
            status: "published",
            default_for_new_jobs: true,
            departments_involved: ["schools", "production"],
            published_at: "2026-05-01T10:00:00.000Z",
            published_by_user_id: "leader-1"
          }
        }
      ]
    });
    getTemplateDetailMock.mockResolvedValue({
      template: {
        id: "template-1",
        template_key: "school_photo_day",
        name: "School Photo Day",
        description: "Reusable school workflow.",
        job_type: "photo_day",
        category: "schools",
        status: "active",
        updated_at: "2026-05-01T10:00:00.000Z"
      },
      version: {
        id: "version-1",
        version_number: 3,
        status: "draft",
        default_for_new_jobs: false,
        departments_involved: ["schools", "production"],
        published_at: null,
        published_by_user_id: null
      },
      milestones: [
        {
          id: "milestone-1",
          milestone_key: "intake",
          name: "Intake",
          description: "Confirm scope before picture day.",
          sort_order: 1,
          default_owner_type: "account_owner",
          default_owner_value: "account_owner",
          steps: [
            {
              id: "step-1",
              step_key: "confirm_scope",
              name: "Confirm scope",
              description: "Make sure the job can move forward.",
              sort_order: 10,
              department: "schools",
              role_key: "account_owner",
              assigned_user_id: null,
              owner_type: "account_owner",
              owner_value: "account_owner",
              required: true,
              skippable: false,
              blocking: true,
              expected_duration_minutes: 1440,
              due_offset_minutes: 0,
              dependency_mode: "waits_for_prior_step",
              blocked_behavior: null,
              checklist_template_id: null,
              checklist_template_name: null,
              depends_on_step_keys: []
            }
          ]
        }
      ]
    });
    addStepMock.mockImplementation(async () => getTemplateDetailMock());
    updateStepMock.mockImplementation(async () => getTemplateDetailMock());
    moveStepMock.mockImplementation(async () => getTemplateDetailMock());
    removeStepMock.mockImplementation(async () => getTemplateDetailMock());
  });

  it("renders the leadership-only linear builder and clarifies checklist templates", async () => {
    render(<WorkflowTemplateBuilderPage token="token" currentUser={leadershipUser} />);

    expect(await screen.findByRole("heading", { name: "Workflow Template Builder" })).toBeInTheDocument();
    expect(screen.getByText(/Build a reusable workflow recipe/i)).toBeInTheDocument();
    expect(screen.getByText(/Duplicate a template before editing/i)).toBeInTheDocument();
    expect(screen.getByText("New Recipe Details")).toBeInTheDocument();
    expect(screen.getByText("Big Stages")).toBeInTheDocument();
    expect(screen.getByText("Recipe Preview")).toBeInTheDocument();
    expect(screen.getByText(/Click Edit, \+ Add after, or Duplicate/i)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Template" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Team / category" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Add department" })).toBeInTheDocument();
    expect(screen.queryByText("App shortcut")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Duplicate template to edit" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Full-screen editor" })).toBeInTheDocument();
    expect(await screen.findByText("Production and Graphics")).toBeInTheDocument();
  });

  it("opens an inline step editor directly after an existing step", async () => {
    render(<WorkflowTemplateBuilderPage token="token" currentUser={leadershipUser} />);

    const templateSelect = await screen.findByRole("combobox", { name: "Template" });
    fireEvent.change(templateSelect, { target: { value: "template-1" } });
    expect(await screen.findByText("Confirm scope")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "+ Add after" }));

    expect(screen.getByText("New step")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Step name" })).toHaveValue("Next controlled step");
    expect(screen.getByRole("combobox", { name: "Assignment mode" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Assignment mode" }), { target: { value: "needs_assignment" } });
    expect(screen.getByRole("combobox", { name: "Team queue" })).toHaveValue("schools");
    expect(screen.getByText(/keeps the step in the team queue/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save step" })).toBeEnabled();
    expect(screen.getByText("More details")).toBeInTheDocument();
  });

  it("edits a draft step inline without opening a separate workflow window", async () => {
    const updatedDetail = {
      template: {
        id: "template-1",
        template_key: "school_photo_day",
        name: "School Photo Day",
        description: "Reusable school workflow.",
        job_type: "photo_day",
        category: "schools",
        status: "active",
        updated_at: "2026-05-01T10:00:00.000Z"
      },
      version: {
        id: "version-1",
        version_number: 3,
        status: "draft",
        default_for_new_jobs: false,
        departments_involved: ["schools", "production"],
        published_at: null,
        published_by_user_id: null
      },
      milestones: [
        {
          id: "milestone-1",
          milestone_key: "intake",
          name: "Intake",
          description: "Confirm scope before picture day.",
          sort_order: 1,
          default_owner_type: "account_owner",
          default_owner_value: "account_owner",
          steps: [
            {
              id: "step-1",
              step_key: "confirm_scope",
              name: "Confirm roster and scope",
              description: "Make sure the job can move forward.",
              sort_order: 10,
              department: "production",
              role_key: "production_lead",
              assigned_user_id: null,
              owner_type: "department",
              owner_value: "production",
              required: true,
              skippable: false,
              blocking: true,
              expected_duration_minutes: 240,
              due_offset_minutes: 0,
              dependency_mode: "waits_for_prior_step",
              blocked_behavior: null,
              checklist_template_id: null,
              checklist_template_name: null,
              depends_on_step_keys: []
            }
          ]
        }
      ]
    };
    updateStepMock.mockResolvedValue(updatedDetail);

    render(<WorkflowTemplateBuilderPage token="token" currentUser={leadershipUser} />);

    const templateSelect = await screen.findByRole("combobox", { name: "Template" });
    fireEvent.change(templateSelect, { target: { value: "template-1" } });
    expect(await screen.findByText("Confirm scope")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByText("Editing step")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Step name" })).toHaveValue("Confirm scope");
    fireEvent.change(screen.getByRole("textbox", { name: "Step name" }), { target: { value: "Confirm roster and scope" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Assignment mode" }), { target: { value: "team_queue" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Team queue" }), { target: { value: "production" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Due rule" }), { target: { value: "240" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateStepMock).toHaveBeenCalledWith(
        "token",
        "version-1",
        "step-1",
        expect.objectContaining({
          name: "Confirm roster and scope",
          department: "production",
          owner_type: "department",
          owner_value: "production",
          expected_duration_minutes: 240
        })
      )
    );
    expect(await screen.findByText("Controlled step updated in the draft.")).toBeInTheDocument();
    expect(screen.getByText("Confirm roster and scope")).toBeInTheDocument();
  });

  it("shows draft-only move and remove controls for workflow steps", async () => {
    const firstStep = {
      id: "step-1",
      step_key: "confirm_scope",
      name: "Confirm scope",
      description: "Make sure the job can move forward.",
      sort_order: 10,
      department: "schools",
      role_key: "account_owner",
      assigned_user_id: null,
      owner_type: "account_owner",
      owner_value: "account_owner",
      required: true,
      skippable: false,
      blocking: true,
      expected_duration_minutes: 1440,
      due_offset_minutes: 0,
      dependency_mode: "waits_for_prior_step",
      blocked_behavior: null,
      checklist_template_id: null,
      checklist_template_name: null,
      depends_on_step_keys: []
    };
    const secondStep = {
      ...firstStep,
      id: "step-2",
      step_key: "archive_delivery",
      name: "Archive delivery",
      sort_order: 20,
      department: "production",
      owner_type: "department",
      owner_value: "production",
      role_key: "production_lead"
    };
    const draftDetail = {
      template: {
        id: "template-1",
        template_key: "school_photo_day",
        name: "School Photo Day",
        description: "Reusable school workflow.",
        job_type: "photo_day",
        category: "schools",
        status: "active",
        updated_at: "2026-05-01T10:00:00.000Z"
      },
      version: {
        id: "version-1",
        version_number: 3,
        status: "draft",
        default_for_new_jobs: false,
        departments_involved: ["schools", "production"],
        published_at: null,
        published_by_user_id: null
      },
      milestones: [
        {
          id: "milestone-1",
          milestone_key: "intake",
          name: "Intake",
          description: "Confirm scope before picture day.",
          sort_order: 1,
          default_owner_type: "account_owner",
          default_owner_value: "account_owner",
          steps: [firstStep, secondStep]
        }
      ]
    };
    const movedDetail = {
      ...draftDetail,
      milestones: [
        {
          ...draftDetail.milestones[0],
          steps: [{ ...secondStep, sort_order: 10 }, { ...firstStep, sort_order: 20 }]
        }
      ]
    };
    const removedDetail = {
      ...draftDetail,
      milestones: [
        {
          ...draftDetail.milestones[0],
          steps: [firstStep]
        }
      ]
    };
    getTemplateDetailMock.mockResolvedValue(draftDetail);
    moveStepMock.mockResolvedValue(movedDetail);
    removeStepMock.mockResolvedValue(removedDetail);
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<WorkflowTemplateBuilderPage token="token" currentUser={leadershipUser} />);

    const templateSelect = await screen.findByRole("combobox", { name: "Template" });
    fireEvent.change(templateSelect, { target: { value: "template-1" } });
    expect(await screen.findByText("Archive delivery")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Move up" })[0]).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Move down" })[1]).toBeDisabled();

    fireEvent.click(screen.getAllByRole("button", { name: "Move up" })[1]);
    await waitFor(() => expect(moveStepMock).toHaveBeenCalledWith("token", "version-1", "step-2", "up"));
    expect(await screen.findByText("Step moved up in the draft copy.")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]);
    await waitFor(() => expect(removeStepMock).toHaveBeenCalledWith("token", "version-1", "step-1"));
    expect(await screen.findByText("Step removed from the draft copy.")).toBeInTheDocument();
    expect(confirmMock).toHaveBeenCalled();
    confirmMock.mockRestore();
  });

  it("blocks users who can view workflow work but cannot manage templates", async () => {
    const workflowStaff = {
      ...leadershipUser,
      authorityTier: "standard_employee" as const,
      roles: ["office_employee" as const],
      permissions: ["workflow.read", "workflow.step.execute"],
      primaryJobFunctionProfile: "graphic_artist" as const,
      jobFunctionProfiles: ["graphic_artist" as const]
    };

    render(<WorkflowTemplateBuilderPage token="token" currentUser={workflowStaff} />);

    expect(screen.getByText(/Workflow game plans are managed by leadership/i)).toBeInTheDocument();
    expect(listTemplatesMock).not.toHaveBeenCalled();
  });
});
