import { apiFetch } from "../api";
import type {
  EmployeeTrainingProfile,
  SessionUser,
  TrainingCatalogResponse,
  TrainingDashboardSnapshot,
  TrainingEmployeeSummary,
  TrainingQuizRound,
  TrainingQuizRoundResponse,
  TrainingQuizSubmitResponse
} from "../types";

type TrainingLookupUser = {
  email?: string | null;
  full_name?: string | null;
  department?: string | null;
  roles?: string[] | null;
};

export type TrainingAssignmentWarning = {
  state: TrainingEmployeeSummary["readiness_state"];
  label: string;
  note: string;
  tone: "success" | "watch" | "danger";
};

export async function listTrainingProfiles(token: string) {
  return apiFetch<EmployeeTrainingProfile[]>("/api/training/profiles", token);
}

export async function listTrainingSummaries(token: string) {
  return apiFetch<TrainingEmployeeSummary[]>("/api/training/summaries", token);
}

export async function getTrainingDashboardSnapshot(token: string) {
  return apiFetch<TrainingDashboardSnapshot>("/api/training/dashboard", token);
}

export async function getTrainingCatalog(token: string) {
  return apiFetch<TrainingCatalogResponse>("/api/training/catalog", token);
}

export async function createTrainingQuizRound(
  token: string,
  input: {
    employeeId?: string | null;
    moduleId?: string | null;
    mode?: TrainingQuizRound["mode"];
    questionIds?: string[];
  }
) {
  return apiFetch<TrainingQuizRoundResponse>("/api/training/quiz-rounds", token, {
    method: "POST",
    body: JSON.stringify({
      employee_id: input.employeeId ?? null,
      module_id: input.moduleId ?? null,
      mode: input.mode ?? "dashboard",
      question_ids: input.questionIds ?? []
    })
  });
}

export async function submitTrainingQuizRound(
  token: string,
  input: {
    employeeId?: string | null;
    round: TrainingQuizRound;
    answers: Record<string, string>;
  }
) {
  return apiFetch<TrainingQuizSubmitResponse>("/api/training/quiz-attempts", token, {
    method: "POST",
    body: JSON.stringify({
      employee_id: input.employeeId ?? null,
      round: {
        id: input.round.id,
        mode: input.round.mode,
        title: input.round.title,
        module_id: input.round.module_id ?? null,
        question_ids: input.round.question_ids,
        pass_threshold: input.round.pass_threshold,
        best_score: input.round.best_score,
        streak_placeholder: input.round.streak_placeholder
      },
      answers: input.answers
    })
  });
}

export async function updateTrainingManagerSignoff(
  token: string,
  employeeId: string,
  status: "pending" | "complete"
) {
  return apiFetch<EmployeeTrainingProfile>(`/api/training/profiles/${employeeId}/signoff`, token, {
    method: "POST",
    body: JSON.stringify({ status })
  });
}

export function getTrainingSummaryForUser(
  summaries: TrainingEmployeeSummary[],
  user: TrainingLookupUser | SessionUser | null | undefined
): TrainingEmployeeSummary {
  const email = user?.email?.toLowerCase();
  const matched = email ? summaries.find((summary) => summary.identity.email.toLowerCase() === email) : undefined;
  if (matched) {
    return matched;
  }

  const roles = normalizeTrainingRoles(user?.roles ?? []);
  const department = user?.department ?? "operations";
  if (roles.includes("leadership")) {
    return {
      identity: {
        id: email ?? "generated-user",
        email: user?.email ?? "leadership@example.com",
        full_name:
          user && "fullName" in user
            ? user.fullName
            : user?.full_name ?? "Leadership User",
        department,
        roles,
        employment_status: "active"
      },
      readiness_state: "cleared",
      readiness_note: "Leadership profile assumed cleared while durable training data is still being built out for this member.",
      onboarding_stage: "Leadership ready",
      workbook_progress_percent: 100,
      required_progress_percent: 100,
      optional_progress_percent: 90,
      overdue_module_count: 0,
      needs_signoff: false,
      next_module_title: "Advanced coaching refresh"
    };
  }

  return {
    identity: {
      id: email ?? "generated-user",
      email: user?.email ?? "employee@example.com",
      full_name:
        user && "fullName" in user
          ? user.fullName
          : user?.full_name ?? "Team Member",
      department,
      roles,
      employment_status: "active"
    },
    readiness_state: "not_cleared",
    readiness_note: "Training readiness is still being established for this employee.",
    onboarding_stage: "Onboarding",
    workbook_progress_percent: 0,
    required_progress_percent: 0,
    optional_progress_percent: 0,
    overdue_module_count: 0,
    needs_signoff: true,
    next_module_title: "School Photographer Workbook"
  };
}

export function getTrainingAssignmentWarning(summary: TrainingEmployeeSummary): TrainingAssignmentWarning {
  switch (summary.readiness_state) {
    case "cleared":
      return { state: summary.readiness_state, label: "Cleared", note: "Ready for school shoots without extra coverage.", tone: "success" };
    case "cleared_with_oversight":
      return { state: summary.readiness_state, label: "Oversight", note: summary.readiness_note, tone: "watch" };
    case "retraining_required":
      return { state: summary.readiness_state, label: "Retraining required", note: summary.readiness_note, tone: "danger" };
    default:
      return { state: summary.readiness_state, label: "Not cleared", note: summary.readiness_note, tone: "danger" };
  }
}

function normalizeTrainingRoles(roles: string[]) {
  const next = new Set(roles);
  if (roles.includes("photographer")) {
    next.add("associate_photographer");
  }
  if (roles.some((role) => ["owner_admin", "admin"].includes(role))) {
    next.add("leadership");
  }
  return [...next];
}
