import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostCallFollowUpPanel } from "../components/PostCallFollowUpPanel";
import type { PostCallFollowUpView } from "../postCallFollowUpTypes";
import type { SessionUser } from "../types";

const getPostCallFollowUpViewMock = vi.fn();
const createPostCallOutcomeMock = vi.fn();

vi.mock("../services/postCallFollowUpApi", () => ({
  getPostCallFollowUpView: (...args: unknown[]) => getPostCallFollowUpViewMock(...args),
  createPostCallOutcome: (...args: unknown[]) => createPostCallOutcomeMock(...args)
}));

const currentUser: SessionUser = {
  id: "user-1",
  tenantId: "tenant-1",
  accountId: "account-1",
  sessionId: "session-1",
  email: "alex@example.com",
  fullName: "Alex Owner",
  status: "active",
  department: "sports",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["admin"],
  permissions: ["communication.use", "communication.meeting.manage"],
  authorityTier: "supervisor",
  primaryJobFunctionProfile: "sports_client_success",
  jobFunctionProfiles: ["sports_client_success"],
  permissionGrants: [],
  policyGrants: [],
  effectiveScopes: ["organization_wide_scope"],
  communicationIdentity: {
    provider: "microsoft_teams",
    microsoftUserId: "ms-user-1",
    microsoftTenantId: "ms-tenant-1",
    communicationEnabled: true,
    teamsChatDefaultTarget: null,
    linkedAt: "2026-04-03T12:00:00.000Z",
    lastVerifiedAt: "2026-04-03T12:00:00.000Z",
    status: "linked_ready"
  },
  sessionTrust: {
    identityProvider: "microsoft_entra",
    sessionAssurance: "mfa",
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

function buildView(): PostCallFollowUpView {
  return {
    object_type: "job",
    object_id: "job-1",
    object_label: "JOB-001 | Metro Football Media Day",
    feature_enabled: true,
    permissions: {
      can_log_outcome: true,
      can_create_follow_up_task: true,
      can_flag_issue: true
    },
    defaults: {
      suggested_reason: "Day-of escalation",
      suggested_task_title: "Follow up: JOB-001 | Metro Football Media Day",
      assignee_options: [
        {
          user_id: "user-1",
          full_name: "Alex Owner"
        },
        {
          user_id: "user-2",
          full_name: "Morgan Coordinator"
        }
      ],
      default_assignee_user_id: "user-2"
    },
    meeting: {
      id: "meeting-1",
      title: "JOB-001 Internal Teams Meeting",
      meeting_status: "scheduled",
      meeting_join_url: "https://teams.microsoft.com/l/meetup-join/meeting-1",
      scheduled_start_at: "2026-04-10T15:00:00.000Z",
      scheduled_end_at: "2026-04-10T16:00:00.000Z"
    },
    summary: {
      latest_outcome: null,
      open_follow_up_count: 0,
      handled_count: 0
    },
    recent_outcomes: []
  };
}

describe("PostCallFollowUpPanel", () => {
  beforeEach(() => {
    getPostCallFollowUpViewMock.mockReset();
    createPostCallOutcomeMock.mockReset();
  });

  it("loads meeting context and saves a follow-up task outcome", async () => {
    getPostCallFollowUpViewMock.mockResolvedValue(buildView());
    createPostCallOutcomeMock.mockResolvedValue({
      outcome: {
        id: "outcome-1",
        related_record_type: "job",
        related_record_id: "job-1",
        meeting_id: "meeting-1",
        actor_user_id: "user-1",
        actor_name: "Alex Owner",
        handled_by_user_id: "user-1",
        handled_by_name: "Alex Owner",
        outcome_status: "follow_up_open",
        summary: "Need athletics office confirmation",
        notes: "Waiting on final field access confirmation.",
        reason_for_call: "Day-of escalation",
        meeting_target_id: "meeting-external-1",
        meeting_join_url: "https://teams.microsoft.com/l/meetup-join/meeting-1",
        follow_up_task: {
          id: "task-1",
          task_number: "TASK-201",
          title: "Confirm field access",
          status: "not_started",
          assigned_to_user_id: "user-2",
          assigned_to_name: "Morgan Coordinator"
        },
        follow_up_issue: null,
        issue_flagged: false,
        handled_at: null,
        created_at: "2026-04-03T12:45:00.000Z",
        updated_at: "2026-04-03T12:45:00.000Z"
      },
      view: {
        ...buildView(),
        summary: {
          latest_outcome: {
            id: "outcome-1",
            related_record_type: "job",
            related_record_id: "job-1",
            meeting_id: "meeting-1",
            actor_user_id: "user-1",
            actor_name: "Alex Owner",
            handled_by_user_id: "user-1",
            handled_by_name: "Alex Owner",
            outcome_status: "follow_up_open",
            summary: "Need athletics office confirmation",
            notes: "Waiting on final field access confirmation.",
            reason_for_call: "Day-of escalation",
            meeting_target_id: "meeting-external-1",
            meeting_join_url: "https://teams.microsoft.com/l/meetup-join/meeting-1",
            follow_up_task: {
              id: "task-1",
              task_number: "TASK-201",
              title: "Confirm field access",
              status: "not_started",
              assigned_to_user_id: "user-2",
              assigned_to_name: "Morgan Coordinator"
            },
            follow_up_issue: null,
            issue_flagged: false,
            handled_at: null,
            created_at: "2026-04-03T12:45:00.000Z",
            updated_at: "2026-04-03T12:45:00.000Z"
          },
          open_follow_up_count: 1,
          handled_count: 0
        },
        recent_outcomes: [
          {
            id: "outcome-1",
            related_record_type: "job",
            related_record_id: "job-1",
            meeting_id: "meeting-1",
            actor_user_id: "user-1",
            actor_name: "Alex Owner",
            handled_by_user_id: "user-1",
            handled_by_name: "Alex Owner",
            outcome_status: "follow_up_open",
            summary: "Need athletics office confirmation",
            notes: "Waiting on final field access confirmation.",
            reason_for_call: "Day-of escalation",
            meeting_target_id: "meeting-external-1",
            meeting_join_url: "https://teams.microsoft.com/l/meetup-join/meeting-1",
            follow_up_task: {
              id: "task-1",
              task_number: "TASK-201",
              title: "Confirm field access",
              status: "not_started",
              assigned_to_user_id: "user-2",
              assigned_to_name: "Morgan Coordinator"
            },
            follow_up_issue: null,
            issue_flagged: false,
            handled_at: null,
            created_at: "2026-04-03T12:45:00.000Z",
            updated_at: "2026-04-03T12:45:00.000Z"
          }
        ]
      }
    });

    render(<PostCallFollowUpPanel token="token-demo" currentUser={currentUser} objectType="job" objectId="job-1" />);

    expect(await screen.findByText("JOB-001 Internal Teams Meeting")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Outcome summary"), {
      target: { value: "Need athletics office confirmation" }
    });
    fireEvent.click(screen.getByLabelText("Create follow-up task / assign action item"));
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Confirm field access" }
    });
    fireEvent.change(screen.getByLabelText("Assign to"), {
      target: { value: "user-2" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Post-Call Outcome" }));

    await waitFor(() =>
      expect(createPostCallOutcomeMock).toHaveBeenCalledWith(
        "token-demo",
        "job",
        "job-1",
        expect.objectContaining({
          summary: "Need athletics office confirmation",
          create_follow_up_task: true,
          follow_up_task_title: "Confirm field access",
          follow_up_task_assignee_user_id: "user-2"
        })
      )
    );

    expect(await screen.findByText("Post-call follow-up saved.")).toBeInTheDocument();
    expect(screen.getByText("Task: TASK-201 - Confirm field access - Morgan Coordinator")).toBeInTheDocument();
  });

  it("shows a readable load error even when the failure is a plain Error", async () => {
    getPostCallFollowUpViewMock.mockRejectedValue(new Error("Permission check failed."));

    render(<PostCallFollowUpPanel token="token-demo" currentUser={currentUser} objectType="job" objectId="job-1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Permission check failed.");
  });
});
