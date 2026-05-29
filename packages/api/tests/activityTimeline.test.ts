import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { getActivityTimeline } from "../src/services/activityTimeline.js";
import type { AuthUser } from "../src/types/auth.js";

function createAuth(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "user-1",
    tenantId: "tenant-1",
    accountId: "account-1",
    sessionId: "session-1",
    email: "leadership@example.com",
    fullName: "Leadership User",
    status: "active",
    department: "sports",
    isEmailVerified: true,
    authVersion: 1,
    authorityTier: "leadership",
    jobFunctionProfiles: ["leadership_team_member"],
    primaryJobFunctionProfile: "leadership_team_member",
    permissionGrants: [],
    policyGrants: [],
    policyRoles: [],
    internalRoleGroups: ["leadership"],
    effectiveScopes: ["organization_wide_scope"],
    roles: ["leadership"],
    permissions: [],
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
    },
    ...overrides
  };
}

function createClient(queryImpl: (sql: string) => { rows: any[] }) {
  return {
    query: vi.fn(async (sql: string) => queryImpl(sql))
  } as unknown as PoolClient;
}

describe("activity timeline", () => {
  it("builds a readable job timeline from durable activity, note, evaluation, and sync sources", async () => {
    const client = createClient((sql) => {
      if (sql.includes("FROM jobs")) {
        return {
          rows: [
            {
              id: "job-1",
              job_number: "SPT-1001",
              title: "Metro Media Day",
              department_type: "sports",
              organization_id: "org-1",
              primary_location_id: "loc-1",
              primary_contact_id: "contact-1",
              account_owner_user_id: "owner-1",
              created_by_user_id: "owner-1"
            }
          ]
        };
      }
      if (sql.includes("FROM job_staff_assignments") && !sql.includes("JOIN jobs job")) {
        return { rows: [{ user_id: "user-2" }] };
      }
      if (sql.includes("FROM production_items") && !sql.includes("JOIN jobs job")) {
        return { rows: [] };
      }
      if (sql.includes("FROM job_watch_flags")) {
        return { rows: [] };
      }
      if (sql.includes("FROM job_shoot_links")) {
        return { rows: [{ shoot_id: "shoot-1" }] };
      }
      if (sql.includes("FROM activity_log_entries entry")) {
        return {
          rows: [
            {
              id: "log-1",
              job_id: "job-1",
              job_day_id: null,
              production_item_id: null,
              watch_flag_id: null,
              organization_id: "org-1",
              location_id: "loc-1",
              contact_id: "contact-1",
              actor_user_id: "owner-1",
              actor_name: "Alex Owner",
              event_type: "job_published",
              summary: "Job published",
              metadata: {},
              resource_type: "job",
              resource_id: "job-1",
              created_at: "2026-04-01T12:00:00.000Z"
            }
          ]
        };
      }
      if (sql.includes("audit.action = 'note.created'")) {
        return {
          rows: [
            {
              id: "audit-note-1",
              actor_user_id: "owner-1",
              actor_name: "Alex Owner",
              action: "note.created",
              entity_type: "operational_note",
              entity_id: "note-1",
              metadata: { note_type: "post_shoot_follow_up", visibility_scope: "object_viewers" },
              reason_comment: null,
              created_at: "2026-04-01T12:05:00.000Z"
            }
          ]
        };
      }
      if (sql.includes("shoot.post_shoot_evaluation.submitted")) {
        return {
          rows: [
            {
              id: "audit-eval-1",
              actor_user_id: "owner-1",
              actor_name: "Alex Owner",
              action: "shoot.post_shoot_evaluation.submitted",
              entity_type: "post_shoot_evaluation",
              entity_id: "eval-1",
              metadata: { overall_outcome: "major_issues", eval_status: "submitted" },
              reason_comment: null,
              created_at: "2026-04-01T12:10:00.000Z"
            }
          ]
        };
      }
      if (sql.includes("FROM approval_requests request")) {
        return { rows: [] };
      }
      if (sql.includes("FROM operational_approval_event event")) {
        return {
          rows: [
            {
              id: "approval-event-1",
              approval_request_id: "approval-1",
              request_type: "policy_exception_approval",
              event_type: "approval.requested",
              summary: "Operational exception approval submitted",
              note: "Need sign-off before the job moves.",
              actor_user_id: "owner-1",
              actor_name: "Alex Owner",
              metadata: {},
              created_at: "2026-04-01T12:11:00.000Z"
            }
          ]
        };
      }
      if (sql.includes("FROM operational_event event")) {
        return { rows: [] };
      }
      if (sql.includes("integration.sync.processing")) {
        return {
          rows: [
            {
              id: "audit-sync-1",
              actor_user_id: "owner-1",
              actor_name: "Alex Owner",
              action: "integration.sync.succeeded",
              entity_type: "job",
              entity_id: "job-1",
              metadata: { provider: "microsoft_graph", operation_type: "calendar_update" },
              reason_comment: null,
              created_at: "2026-04-01T12:12:00.000Z"
            }
          ]
        };
      }
      return { rows: [] };
    });

    const timeline = await getActivityTimeline(client, createAuth(), {
      objectType: "job",
      objectId: "job-1",
      limit: 20
    });

    expect(timeline.object_label).toBe("SPT-1001 · Metro Media Day");
    expect(timeline.items).toHaveLength(5);
    expect(timeline.items[0].action_label).toBe("Sync completed");
    expect(timeline.items[1].action_label).toBe("Approval Requested");
    expect(timeline.items[2].action_label).toBe("Evaluation submitted");
    expect(timeline.items[3].action_label).toBe("Note added");
    expect(timeline.items[4].summary).toBe("Job published");
  });

  it("builds a staffing-assignment timeline from assignment-linked activity rows", async () => {
    const client = createClient((sql) => {
      if (sql.includes("FROM job_staff_assignments assignment")) {
        return {
          rows: [
            {
              id: "assignment-1",
              job_id: "job-1",
              job_day_id: "day-1",
              user_id: "user-2",
              assignment_role: "lead_photographer",
              user_name: "Jamie Staff",
              job_number: "SPT-1001",
              job_title: "Metro Media Day",
              department_type: "sports",
              organization_id: "org-1",
              primary_location_id: "loc-1",
              primary_contact_id: "contact-1",
              account_owner_user_id: "owner-1",
              created_by_user_id: "owner-1"
            }
          ]
        };
      }
      if (sql.includes("FROM job_shoot_links")) {
        return { rows: [] };
      }
      if (sql.includes("FROM activity_log_entries entry")) {
        return {
          rows: [
            {
              id: "assignment-log-1",
              job_id: "job-1",
              job_day_id: "day-1",
              production_item_id: null,
              watch_flag_id: null,
              organization_id: "org-1",
              location_id: "loc-1",
              contact_id: "contact-1",
              actor_user_id: "owner-1",
              actor_name: "Alex Owner",
              event_type: "assignment_created",
              summary: "Assigned lead photographer staff",
              metadata: { assignment_id: "assignment-1" },
              resource_type: "job",
              resource_id: "job-1",
              created_at: "2026-04-01T13:00:00.000Z"
            }
          ]
        };
      }
      if (sql.includes("audit.action = 'note.created'")) {
        return { rows: [] };
      }
      if (sql.includes("shoot.post_shoot_evaluation.submitted")) {
        return { rows: [] };
      }
      if (sql.includes("FROM approval_requests request")) {
        return { rows: [] };
      }
      if (sql.includes("FROM operational_event event")) {
        return { rows: [] };
      }
      if (sql.includes("integration.sync.processing")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const timeline = await getActivityTimeline(client, createAuth(), {
      objectType: "staffing_assignment",
      objectId: "assignment-1",
      limit: 20
    });

    expect(timeline.object_label).toContain("Jamie Staff");
    expect(timeline.items).toHaveLength(1);
    expect(timeline.items[0].event_type).toBe("assignment_created");
    expect(timeline.items[0].job_day_id).toBe("day-1");
    expect(timeline.items[0].metadata.assignment_id).toBe("assignment-1");
  });
});
