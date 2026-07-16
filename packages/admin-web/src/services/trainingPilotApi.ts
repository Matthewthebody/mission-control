import { apiFetch } from "../api";

// Ask Bailey H6 — Fall Field Coach governed training client. All authorization
// is enforced server-side; these are typed calls into /api/training.

export type LessonListRow = {
  id: string;
  title: string;
  objective: string | null;
  intended_role: string | null;
  intended_department: string | null;
  is_demo: boolean;
  current_version_id: string | null;
  current_status: string | null;
  current_version_number: number | null;
  latest_status: string | null;
  latest_version_number: number | null;
  assignment_count: number;
};

export type LessonVersionRow = {
  id: string;
  version_number: number;
  publication_status: string;
  ai_drafted: boolean;
  pass_threshold_percent: number;
  approved_at: string | null;
  approved_by_name: string | null;
  effective_from: string | null;
  effective_until: string | null;
  review_due_at: string | null;
  supersedes_version_id: string | null;
  superseded_by_version_id: string | null;
  review_notes: string | null;
  created_at: string;
};

export type LessonSectionRow = {
  id: string;
  lesson_version_id: string;
  ordinal: number;
  section_kind: string;
  title: string;
  body: string | null;
  knowledge_source_version_id: string | null;
  knowledge_segment_id: string | null;
  media_start_seconds: number | null;
  media_end_seconds: number | null;
  source_title: string | null;
};

export type ManagerQuestion = {
  id: string;
  lesson_version_id: string;
  ordinal: number;
  prompt: string;
  scenario: string | null;
  choices: Array<{ id: string; label: string; correct: boolean; explanation?: string }>;
  review_section_id: string | null;
  allow_open_text: boolean;
};

export type LessonDetail = {
  mode: "manager";
  lesson: {
    id: string;
    title: string;
    objective: string | null;
    intended_role: string | null;
    intended_department: string | null;
    is_demo: boolean;
    current_version_id: string | null;
    prerequisite_lesson_id: string | null;
    owner_name: string | null;
    created_at: string;
  };
  versions: LessonVersionRow[];
  sections: LessonSectionRow[];
  questions: ManagerQuestion[];
};

export type SectionInput = {
  title: string;
  section_kind?: "reading" | "video_clip" | "checklist" | "scenario";
  body?: string | null;
  knowledge_source_version_id?: string | null;
  knowledge_segment_id?: string | null;
  media_start_seconds?: number | null;
  media_end_seconds?: number | null;
};
export type QuestionInput = {
  prompt: string;
  scenario?: string | null;
  choices: Array<{ id: string; label: string; correct: boolean; explanation?: string }>;
  review_section_ordinal?: number | null;
  allow_open_text?: boolean;
};

export function listLessons(token: string, filters: { query?: string; status?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.query) params.set("query", filters.query);
  if (filters.status) params.set("status", filters.status);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<{ lessons: LessonListRow[] }>(`/api/training/lessons${suffix}`, token);
}

export function getLessonDetail(token: string, lessonId: string) {
  return apiFetch<LessonDetail>(`/api/training/lessons/${lessonId}`, token);
}

export function createLesson(
  token: string,
  input: {
    title: string;
    objective?: string | null;
    intended_role?: string | null;
    intended_department?: string | null;
    pass_threshold_percent?: number;
    ai_drafted?: boolean;
    is_demo?: boolean;
    sections?: SectionInput[];
    questions?: QuestionInput[];
  }
) {
  return apiFetch<{ lesson_id: string; version_id: string }>(`/api/training/lessons`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function submitLessonVersion(token: string, versionId: string) {
  return apiFetch<{ version_id: string }>(`/api/training/lesson-versions/${versionId}/submit`, token, { method: "POST", body: "{}" });
}
export function approveLessonVersion(token: string, versionId: string) {
  return apiFetch<{ version_id: string }>(`/api/training/lesson-versions/${versionId}/approve`, token, { method: "POST", body: "{}" });
}
export function rejectLessonVersion(token: string, versionId: string, note: string) {
  return apiFetch<{ version_id: string }>(`/api/training/lesson-versions/${versionId}/reject`, token, {
    method: "POST",
    body: JSON.stringify({ note })
  });
}
export function retireLessonVersion(token: string, versionId: string, note?: string) {
  return apiFetch<{ version_id: string }>(`/api/training/lesson-versions/${versionId}/retire`, token, {
    method: "POST",
    body: JSON.stringify(note ? { note } : {})
  });
}
export function createLessonRevision(token: string, lessonId: string, copyFromCurrent = true) {
  return apiFetch<{ version_id: string }>(`/api/training/lessons/${lessonId}/revisions`, token, {
    method: "POST",
    body: JSON.stringify({ copy_from_current: copyFromCurrent })
  });
}

export function assignLesson(
  token: string,
  input: { lesson_id: string; user_id: string; cohort_id?: string | null; reason?: string | null; due_at?: string | null }
) {
  return apiFetch<{ assignment_id: string; lesson_version_id: string }>(`/api/training/assignments`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export type CohortRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  enabled: boolean;
  is_demo: boolean;
  starts_on: string | null;
  ends_on: string | null;
  support_contact: string | null;
  member_count: number;
};
export function listCohorts(token: string) {
  return apiFetch<{ cohorts: CohortRow[] }>(`/api/training/cohorts`, token);
}
export function createCohort(token: string, input: { name: string; is_demo?: boolean }) {
  return apiFetch<{ cohort_id: string }>(`/api/training/cohorts`, token, { method: "POST", body: JSON.stringify(input) });
}
export function setCohortState(token: string, cohortId: string, input: { enabled?: boolean; status?: "draft" | "active" | "ended" }) {
  return apiFetch<{ cohort_id: string }>(`/api/training/cohorts/${cohortId}`, token, { method: "PATCH", body: JSON.stringify(input) });
}
export function addCohortMember(token: string, cohortId: string, userId: string) {
  return apiFetch<{ cohort_id: string }>(`/api/training/cohorts/${cohortId}/members`, token, {
    method: "POST",
    body: JSON.stringify({ user_id: userId })
  });
}

export type LessonResults = {
  assignments: Array<{
    id: string;
    status: string;
    due_at: string | null;
    completed_at: string | null;
    employee_name: string;
    version_number: number;
    progress_percent: number | null;
    acknowledged: boolean | null;
    best_score: number | null;
    attempt_count: number;
    needs_review: boolean | null;
  }>;
  question_difficulty: Array<{ id: string; prompt: string; attempts: number; misses: number }>;
};
export function getLessonResults(token: string, lessonId: string) {
  return apiFetch<LessonResults>(`/api/training/lessons/${lessonId}/results`, token);
}

export type PilotMetrics = {
  assignments: { assigned: number; completed: number; in_progress: number };
  readiness: { attempts: number; passed: number; needs_review: number; avg_score: number | null };
};
export function getPilotMetrics(token: string, cohortId?: string) {
  const suffix = cohortId ? `?cohort_id=${cohortId}` : "";
  return apiFetch<PilotMetrics>(`/api/training/pilot-metrics${suffix}`, token);
}

export type TrainingPerson = { id: string; full_name: string; department: string; roles: string[] };
export function listTrainingPeople(token: string) {
  return apiFetch<Array<{ identity: TrainingPerson }>>(`/api/training/summaries`, token).then((rows) => rows.map((r) => r.identity));
}

// --- Employee ---
export type MyAssignment = {
  id: string;
  lesson_id: string;
  lesson_version_id: string;
  status: string;
  due_at: string | null;
  assigned_at: string;
  completed_at: string | null;
  assignment_reason: string | null;
  title: string;
  objective: string | null;
  version_number: number;
  pass_threshold_percent: number;
  progress_percent: number | null;
  acknowledged: boolean | null;
  section_count: number;
  question_count: number;
  best_score: number | null;
  overdue: boolean;
};
export function listMyAssignments(token: string) {
  return apiFetch<{ assignments: MyAssignment[] }>(`/api/training/my-assignments`, token);
}

export type MyLesson = {
  assignment: { id: string; status: string };
  lesson: { title: string; objective: string | null; version_number: number; pass_threshold_percent: number; publication_status: string };
  sections: Array<{
    id: string;
    ordinal: number;
    section_kind: string;
    title: string;
    body: string | null;
    source_id: string | null;
    source_title: string | null;
    media_start_seconds: number | null;
    media_url: string | null;
  }>;
  questions: Array<{ id: string; ordinal: number; prompt: string; scenario: string | null; allow_open_text: boolean; choices: Array<{ id: string; label: string }> }>;
  progress: { viewed_section_ids: string[]; progress_percent: number; acknowledged: boolean };
};
export function getMyLesson(token: string, assignmentId: string) {
  return apiFetch<MyLesson>(`/api/training/my-assignments/${assignmentId}`, token);
}
export function recordSectionViewed(token: string, assignmentId: string, sectionId: string) {
  return apiFetch<{ progress_percent: number }>(`/api/training/my-assignments/${assignmentId}/section-viewed`, token, {
    method: "POST",
    body: JSON.stringify({ section_id: sectionId })
  });
}
export function acknowledgeLesson(token: string, assignmentId: string) {
  return apiFetch<{ acknowledged: boolean }>(`/api/training/my-assignments/${assignmentId}/acknowledge`, token, { method: "POST", body: "{}" });
}

export type ReadinessResult = {
  attempt_id: string;
  score_percent: number;
  passed: boolean;
  pass_threshold_percent: number;
  needs_human_review: boolean;
  correct_count: number;
  question_count: number;
  feedback: Array<{ question_id: string; prompt: string; result: "correct" | "incorrect" | "needs_review"; review_topic: string | null; coaching: string }>;
};
export function submitReadiness(token: string, assignmentId: string, answers: Record<string, string>) {
  return apiFetch<ReadinessResult>(`/api/training/my-assignments/${assignmentId}/readiness`, token, {
    method: "POST",
    body: JSON.stringify({ answers })
  });
}
