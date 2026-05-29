// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedTaskPage } from "../pages/SharedTaskPage";
import type { SessionUser } from "../types";

const listSharedJobsMock = vi.fn();
const listDirectoryOwnerOptionsMock = vi.fn();
const createSharedTaskMock = vi.fn();
const getSharedTaskDetailMock = vi.fn();
const updateSharedTaskMock = vi.fn();
const getTeamsCommunicationRecordViewMock = vi.fn();
const createTeamsCommunicationReferenceMock = vi.fn();
const queueTeamsCommunicationMessageMock = vi.fn();
const getTeamsMeetingRecordViewMock = vi.fn();
const upsertTeamsMeetingMock = vi.fn();
const cancelTeamsMeetingMock = vi.fn();
const getCommunicationHistoryRecordViewMock = vi.fn();

vi.mock("../services/jobsApi", () => ({
  listSharedJobs: (...args: unknown[]) => listSharedJobsMock(...args)
}));

vi.mock("../services/organizationApi", () => ({
  listDirectoryOwnerOptions: (...args: unknown[]) => listDirectoryOwnerOptionsMock(...args)
}));

vi.mock("../services/tasksApi", () => ({
  createSharedTask: (...args: unknown[]) => createSharedTaskMock(...args),
  getSharedTaskDetail: (...args: unknown[]) => getSharedTaskDetailMock(...args),
  updateSharedTask: (...args: unknown[]) => updateSharedTaskMock(...args)
}));

vi.mock("../services/teamsCommunicationApi", () => ({
  getTeamsCommunicationRecordView: (...args: unknown[]) => getTeamsCommunicationRecordViewMock(...args),
  createTeamsCommunicationReference: (...args: unknown[]) => createTeamsCommunicationReferenceMock(...args),
  queueTeamsCommunicationMessage: (...args: unknown[]) => queueTeamsCommunicationMessageMock(...args)
}));

vi.mock("../services/teamsMeetingsApi", () => ({
  getTeamsMeetingRecordView: (...args: unknown[]) => getTeamsMeetingRecordViewMock(...args),
  upsertTeamsMeeting: (...args: unknown[]) => upsertTeamsMeetingMock(...args),
  cancelTeamsMeeting: (...args: unknown[]) => cancelTeamsMeetingMock(...args)
}));

vi.mock("../services/communicationHistoryApi", () => ({
  getCommunicationHistoryRecordView: (...args: unknown[]) => getCommunicationHistoryRecordViewMock(...args)
}));

const currentUser: SessionUser = {
  id: "user-1",
  tenantId: "tenant-demo",
  accountId: "account-1",
  sessionId: "session-1",
  email: "user@example.com",
  fullName: "Demo User",
  status: "active",
  department: "production",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["manager"],
  permissions: ["task.create", "task.read", "task.update"],
  authorityTier: "supervisor",
  primaryJobFunctionProfile: "director_of_digital_production",
  jobFunctionProfiles: ["director_of_digital_production"],
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

const communicationUser: SessionUser = {
  ...currentUser,
  permissions: [...currentUser.permissions, "communication.use", "communication.send", "communication.meeting.manage"],
  communicationIdentity: {
    provider: "microsoft_teams",
    microsoftUserId: "ms-user-1",
    microsoftTenantId: "ms-tenant-1",
    communicationEnabled: true,
    teamsChatDefaultTarget: null,
    linkedAt: "2026-04-03T12:00:00.000Z",
    lastVerifiedAt: "2026-04-03T12:00:00.000Z",
    status: "linked_ready"
  }
};

describe("SharedTaskPage", () => {
  beforeEach(() => {
    window.location.hash = "#tasks/new?department=production&jobId=job-1";
    listSharedJobsMock.mockReset();
    listDirectoryOwnerOptionsMock.mockReset();
    createSharedTaskMock.mockReset();
    getSharedTaskDetailMock.mockReset();
    updateSharedTaskMock.mockReset();
    getTeamsCommunicationRecordViewMock.mockReset();
    createTeamsCommunicationReferenceMock.mockReset();
    queueTeamsCommunicationMessageMock.mockReset();
    getTeamsMeetingRecordViewMock.mockReset();
    upsertTeamsMeetingMock.mockReset();
    cancelTeamsMeetingMock.mockReset();
    getCommunicationHistoryRecordViewMock.mockReset();

    listDirectoryOwnerOptionsMock.mockResolvedValue({
      owners: [{ user_id: "user-1", full_name: "Demo User", email: "user@example.com", department: "production", status: "active" }]
    });
    listSharedJobsMock.mockResolvedValue({
      jobs: [
        {
          id: "job-1",
          job_number: "SCH-100",
          title: "Spring Picture Day"
        }
      ]
    });
    createSharedTaskMock.mockResolvedValue({
      task: {
        id: "task-1",
        tenant_id: "tenant-demo",
        task_number: "TSK-PRO-2026-0001",
        title: "Upload QA pass",
        description: null,
        task_type: "upload_qa",
        department_type: "production",
        related_job_id: "job-1",
        assigned_to_user_id: "user-1",
        assigned_team_id: null,
        status: "not_started",
        priority: "normal",
        due_at: null,
        blocked_reason: null,
        proof_required: false,
        completion_notes: null,
        created_by_user_id: "user-1",
        updated_by_user_id: "user-1",
        created_at: "2026-04-02T12:00:00.000Z",
        updated_at: "2026-04-02T12:00:00.000Z",
        assigned_to_name: "Demo User",
        related_job_number: "SCH-100",
        related_job_title: "Spring Picture Day",
        organization_name: "Lakeview",
        department_label: "Production"
      },
      related_job: {
        id: "job-1",
        job_number: "SCH-100",
        title: "Spring Picture Day",
        department_type: "schools",
        job_status: "ready_to_execute"
      },
      assignments: [],
      work_model: [],
      policy: {
        permissions: [],
        fields: {},
        sections: {},
        actions: { update: true },
        reasons: {}
      }
    });
    getTeamsCommunicationRecordViewMock.mockResolvedValue({
      object_type: "task",
      object_id: "task-1",
      object_label: "TSK-PRO-2026-0001 | Upload QA pass",
      permissions: {
        can_use: true,
        can_send: true,
        can_configure: false
      },
      feature_enabled: true,
      references: [
        {
          id: "reference-1",
          reference_type: "chat",
          status: "active",
          label: "Production Follow Through",
          description: "Task follow-through chat",
          teams_web_url: "https://teams.microsoft.com/l/chat/0/0?users=user@example.com",
          team_id: null,
          channel_id: null,
          chat_id: "19:task-chat",
          is_primary: true,
          created_at: "2026-04-03T12:00:00.000Z",
          updated_at: "2026-04-03T12:00:00.000Z",
          last_verified_at: "2026-04-03T12:05:00.000Z"
        }
      ],
      recent_deliveries: []
    });
    getTeamsMeetingRecordViewMock.mockResolvedValue({
      object_type: "task",
      object_id: "task-1",
      object_label: "TSK-PRO-2026-0001 | Upload QA pass",
      feature_enabled: true,
      permissions: {
        can_use: true,
        can_manage: true
      },
      defaults: {
        suggested_title: "TSK-PRO-2026-0001 Internal Teams Meeting",
        suggested_description: "Internal Teams meeting linked to TSK-PRO-2026-0001.",
        scheduled_start_at: "2026-04-03T18:00:00.000Z",
        scheduled_end_at: "2026-04-03T18:30:00.000Z",
        app_deep_link: "https://app.example.test/?teams=1#tasks/task-1",
        suggested_participants: []
      },
      meeting: {
        id: "meeting-1",
        linked_record_type: "task",
        linked_record_id: "task-1",
        meeting_provider: "microsoft_teams",
        meeting_mode: "calendar_event",
        meeting_status: "scheduled",
        title: "TSK-PRO-2026-0001 Internal Teams Meeting",
        description: "Internal Teams meeting linked to TSK-PRO-2026-0001.",
        meeting_join_url: "https://teams.microsoft.com/l/meetup-join/task-meeting-1",
        meeting_web_url: "https://outlook.office.com/calendar/item/task-meeting-1",
        external_meeting_id: "meeting-1",
        external_calendar_event_id: "event-1",
        organizer_user_id: "user-1",
        organizer_email: "user@example.com",
        organizer_microsoft_user_id: "ms-user-1",
        participant_snapshot: [],
        app_deep_link: "https://app.example.test/?teams=1#tasks/task-1",
        scheduled_start_at: "2026-04-03T18:00:00.000Z",
        scheduled_end_at: "2026-04-03T18:30:00.000Z",
        created_by_user_id: "user-1",
        updated_by_user_id: "user-1",
        last_sync_operation_id: null,
        last_sync_attempt_at: null,
        last_synced_at: "2026-04-03T12:15:00.000Z",
        sync_error: null,
        cancelled_at: null,
        created_at: "2026-04-03T12:00:00.000Z",
        updated_at: "2026-04-03T12:15:00.000Z"
      },
      recent_operations: []
    });
    getCommunicationHistoryRecordViewMock.mockResolvedValue({
      object_type: "task",
      object_id: "task-1",
      object_label: "TSK-PRO-2026-0001 | Upload QA pass",
      feature_enabled: true,
      permissions: {
        can_view_messages: true,
        can_view_meetings: true
      },
      summary: {
        latest_activity_at: "2026-04-03T12:15:00.000Z",
        latest_message: null,
        latest_meeting: {
          kind: "meeting",
          action_type: "meeting_create",
          target_type: "meeting",
          target_reference_id: "meeting-1",
          target_id: "meeting-1",
          target_label: "TSK-PRO-2026-0001 Internal Teams Meeting",
          target_url: "https://outlook.office.com/calendar/item/task-meeting-1",
          actor_user_id: "user-1",
          actor_name: "Demo User",
          status: "scheduled",
          summary: "Linked TSK-PRO-2026-0001 Internal Teams Meeting",
          join_url: "https://teams.microsoft.com/l/meetup-join/task-meeting-1",
          failure_reason: null,
          occurred_at: "2026-04-03T12:15:00.000Z",
          created_at: "2026-04-03T12:00:00.000Z",
          updated_at: "2026-04-03T12:15:00.000Z"
        },
        latest_failure: null
      },
      entries: []
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("creates a shared task from the native task flow and keeps the linked job distinction visible", async () => {
    render(<SharedTaskPage token="token-demo" currentUser={currentUser} mode="create" />);

    expect(screen.getByText(/Tasks are internal execution items/i)).toBeInTheDocument();
    expect(await screen.findByText("Demo User")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Upload QA pass" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Task" }));

    await waitFor(() => {
      expect(createSharedTaskMock).toHaveBeenCalledWith(
        "token-demo",
        expect.objectContaining({
          title: "Upload QA pass",
          department_type: "production",
          related_job_id: "job-1",
          assigned_to_user_id: "user-1"
        })
      );
    });
    await waitFor(() => {
      expect(window.location.hash).toBe("#tasks/task-1");
    });
  });

  it("shows Teams messaging and meeting actions on task detail when the user is communication-ready", async () => {
    window.location.hash = "#tasks/task-1";
    getSharedTaskDetailMock.mockResolvedValueOnce({
      task: {
        id: "task-1",
        tenant_id: "tenant-demo",
        task_number: "TSK-PRO-2026-0001",
        title: "Upload QA pass",
        description: null,
        task_type: "upload_qa",
        department_type: "production",
        related_job_id: "job-1",
        assigned_to_user_id: "user-1",
        assigned_team_id: null,
        status: "in_progress",
        priority: "normal",
        due_at: "2026-04-03T18:00:00.000Z",
        blocked_reason: null,
        proof_required: false,
        completion_notes: null,
        created_by_user_id: "user-1",
        updated_by_user_id: "user-1",
        created_at: "2026-04-02T12:00:00.000Z",
        updated_at: "2026-04-03T12:00:00.000Z",
        assigned_to_name: "Demo User",
        related_job_number: "SCH-100",
        related_job_title: "Spring Picture Day",
        related_job_status: "ready_to_execute",
        related_job_department: "schools",
        organization_name: "Lakeview",
        department_label: "Production"
      },
      related_job: {
        id: "job-1",
        job_number: "SCH-100",
        title: "Spring Picture Day",
        department_type: "schools",
        job_status: "ready_to_execute"
      },
      assignments: [],
      work_model: [],
      policy: {
        permissions: [],
        fields: {},
        sections: {},
        actions: { update: true },
        reasons: {}
      }
    });

    render(<SharedTaskPage token="token-demo" currentUser={communicationUser} mode="detail" />);

    expect(await screen.findByText("Task Communications")).toBeInTheDocument();
    expect(await screen.findByText("Task Teams Meeting")).toBeInTheDocument();
    expect(getTeamsCommunicationRecordViewMock).toHaveBeenCalledWith("token-demo", "task", "task-1");
    expect(getTeamsMeetingRecordViewMock).toHaveBeenCalledWith("token-demo", "task", "task-1");
    expect(getCommunicationHistoryRecordViewMock).toHaveBeenCalledWith("token-demo", "task", "task-1");
    expect(await screen.findByRole("link", { name: "Join / Start Teams Meeting" })).toHaveAttribute(
      "href",
      "https://teams.microsoft.com/l/meetup-join/task-meeting-1"
    );
    expect(await screen.findByText("Pre-Call Context")).toBeInTheDocument();
    expect(screen.getByText("Task Owners")).toBeInTheDocument();
    expect(screen.getAllByText("Linked Job").length).toBeGreaterThan(0);
    expect(await screen.findByText("Task Communication History")).toBeInTheDocument();
  });
});
