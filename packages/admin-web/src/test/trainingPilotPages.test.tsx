import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRouteId } from "../navigation";
import { canAccessRoute } from "../permissions";
import MyTraining from "../pages/MyTraining";
import TrainingLessons from "../pages/TrainingLessons";
import type { SessionUser } from "../types";

// Ask Bailey H6 — training pilot pages: route wiring, access gating, the
// employee learning path (readiness feedback cites review topics), and the
// manager desk (lessons + pilot metrics + cohorts).

const api = {
  listMyAssignments: vi.fn(),
  getMyLesson: vi.fn(),
  recordSectionViewed: vi.fn(),
  acknowledgeLesson: vi.fn(),
  submitReadiness: vi.fn(),
  listLessons: vi.fn(),
  listCohorts: vi.fn(),
  getPilotMetrics: vi.fn(),
  listTrainingPeople: vi.fn(),
  getLessonDetail: vi.fn(),
  getLessonResults: vi.fn()
};

vi.mock("../services/trainingPilotApi", () => ({
  listMyAssignments: (...a: unknown[]) => api.listMyAssignments(...a),
  getMyLesson: (...a: unknown[]) => api.getMyLesson(...a),
  recordSectionViewed: (...a: unknown[]) => api.recordSectionViewed(...a),
  acknowledgeLesson: (...a: unknown[]) => api.acknowledgeLesson(...a),
  submitReadiness: (...a: unknown[]) => api.submitReadiness(...a),
  listLessons: (...a: unknown[]) => api.listLessons(...a),
  listCohorts: (...a: unknown[]) => api.listCohorts(...a),
  getPilotMetrics: (...a: unknown[]) => api.getPilotMetrics(...a),
  listTrainingPeople: (...a: unknown[]) => api.listTrainingPeople(...a),
  getLessonDetail: (...a: unknown[]) => api.getLessonDetail(...a),
  getLessonResults: (...a: unknown[]) => api.getLessonResults(...a),
  createLesson: vi.fn(),
  createLessonRevision: vi.fn(),
  submitLessonVersion: vi.fn(),
  approveLessonVersion: vi.fn(),
  rejectLessonVersion: vi.fn(),
  retireLessonVersion: vi.fn(),
  assignLesson: vi.fn(),
  createCohort: vi.fn(),
  setCohortState: vi.fn(),
  addCohortMember: vi.fn()
}));

// Ask Bailey launcher needs its provider; stub the button.
vi.mock("../components/askBailey/AskBaileyLauncher", () => ({
  AskBaileyLaunchButton: () => null
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.listMyAssignments.mockResolvedValue({
    assignments: [
      {
        id: "asg-1",
        lesson_id: "l-1",
        lesson_version_id: "v-1",
        status: "assigned",
        due_at: null,
        assigned_at: "2026-07-16T10:00:00Z",
        completed_at: null,
        assignment_reason: "First tethered school shoot",
        title: "Tether Recovery",
        objective: "Recover a dropped feed.",
        version_number: 1,
        pass_threshold_percent: 50,
        progress_percent: 0,
        acknowledged: false,
        section_count: 1,
        question_count: 1,
        best_score: null,
        overdue: false
      }
    ]
  });
  api.getMyLesson.mockResolvedValue({
    assignment: { id: "asg-1", status: "assigned" },
    lesson: { title: "Tether Recovery", objective: "Recover a dropped feed.", version_number: 1, pass_threshold_percent: 50, publication_status: "approved" },
    sections: [{ id: "s-1", ordinal: 0, section_kind: "reading", title: "Reset the feed", body: "Reseat the cable.", source_id: "src-1", source_title: "Tether SOP", media_start_seconds: null, media_url: null }],
    questions: [{ id: "q-1", ordinal: 0, prompt: "First move on a drop?", scenario: null, allow_open_text: false, choices: [{ id: "a", label: "Reseat and restart" }, { id: "b", label: "Send class away" }] }],
    progress: { viewed_section_ids: [], progress_percent: 0, acknowledged: false }
  });
  api.recordSectionViewed.mockResolvedValue({ progress_percent: 100 });
  api.acknowledgeLesson.mockResolvedValue({ acknowledged: true });
  api.submitReadiness.mockResolvedValue({
    attempt_id: "at-1",
    score_percent: 0,
    passed: false,
    pass_threshold_percent: 50,
    needs_human_review: false,
    correct_count: 0,
    question_count: 1,
    feedback: [{ question_id: "q-1", result: "incorrect", prompt: "First move on a drop?", review_topic: "Reset the feed", coaching: "Review “Reset the feed”." }]
  });
  api.listLessons.mockResolvedValue({ lessons: [{ id: "l-1", title: "Tether Recovery", objective: null, intended_role: "associate_photographer", intended_department: "schools", is_demo: true, current_version_id: "v-1", current_status: "approved", current_version_number: 1, latest_status: "approved", latest_version_number: 1, assignment_count: 2 }] });
  api.listCohorts.mockResolvedValue({ cohorts: [{ id: "c-1", name: "Fall Pilot", description: null, status: "draft", enabled: false, is_demo: true, starts_on: null, ends_on: null, support_contact: null, member_count: 0 }] });
  api.getPilotMetrics.mockResolvedValue({ assignments: { assigned: 2, completed: 1, in_progress: 1 }, readiness: { attempts: 3, passed: 2, needs_review: 0, avg_score: 84 } });
  api.listTrainingPeople.mockResolvedValue([{ id: "u-1", full_name: "Demo Associate", department: "schools", roles: ["associate_photographer"] }]);
});

function user(tier: string): SessionUser {
  return { authorityTier: tier, roles: [], permissions: [], permissionGrants: [], effectiveScopes: [], jobFunctionProfiles: [] } as unknown as SessionUser;
}

describe("H6 route wiring + access", () => {
  const TABS = ["dashboard"] as never[];
  it("resolves the employee and manager training routes", () => {
    expect(resolveRouteId("#my-work/training", TABS, false)).toBe("my-training");
    expect(resolveRouteId("#training/lessons", TABS, false)).toBe("training-lessons");
  });
  it("gates the manager desk but opens the employee surface to everyone", () => {
    expect(canAccessRoute(user("standard_employee"), "training-lessons")).toBe(false);
    expect(canAccessRoute(user("leadership"), "training-lessons")).toBe(true);
    expect(canAccessRoute(user("standard_employee"), "my-training")).toBe(true);
  });
});

describe("MyTraining (employee path)", () => {
  it("lists assignments, opens a lesson, and shows readiness feedback pointing at the review topic", async () => {
    render(<MyTraining token="t" />);
    expect(await screen.findByText("Tether Recovery")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Open lesson"));
    expect(await screen.findByText("Reset the feed")).toBeInTheDocument();
    // Answer + submit readiness.
    fireEvent.click(screen.getByLabelText(/Reseat and restart/));
    fireEvent.click(screen.getByText("Submit readiness check"));
    expect(await screen.findByText(/Review “Reset the feed”/)).toBeInTheDocument();
    expect(screen.getByText(/Not passed yet/)).toBeInTheDocument();
  });
});

describe("TrainingLessons (manager path)", () => {
  it("renders pilot metrics, the cohort list, and the lesson list", async () => {
    render(<TrainingLessons token="t" />);
    expect(await screen.findByText("Assigned: 2")).toBeInTheDocument();
    expect(screen.getByText("Readiness attempts: 3")).toBeInTheDocument();
    expect(screen.getByText("Fall Pilot")).toBeInTheDocument();
    expect(screen.getByText("Tether Recovery")).toBeInTheDocument();
  });
});
