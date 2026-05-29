export type TrainingReadinessState = "cleared" | "cleared_with_oversight" | "not_cleared" | "retraining_required";

export type TrainingModuleStatus = "not_started" | "in_progress" | "completed" | "overdue" | "needs_review";

export type TrainingSignoffStatus = "pending" | "complete" | "not_required";

export type TrainingIdentity = {
  id: string;
  email: string;
  full_name: string;
  department: string;
  roles: string[];
  employment_status: string;
};

export type TrainingWorkbook = {
  id: string;
  title: string;
  summary: string;
  version: string;
  updated_at: string;
  sections: TrainingSection[];
};

export type TrainingSection = {
  id: string;
  title: string;
  summary: string;
  sort_order: number;
  module_ids: string[];
};

export type TrainingContentBlock = {
  id: string;
  type: "overview" | "checklist" | "scenario" | "callout";
  title: string;
  body: string;
  bullets?: string[];
};

export type TrainingModule = {
  id: string;
  section_id: string;
  title: string;
  summary: string;
  estimated_minutes: number;
  required: boolean;
  signoff_required: boolean;
  last_updated: string;
  version: string;
  content_blocks: TrainingContentBlock[];
  checkpoint_ids: string[];
  acknowledgement_ids: string[];
  question_ids: string[];
};

export type TrainingAcknowledgement = {
  id: string;
  module_id: string;
  title: string;
  summary: string;
};

export type TrainingQuizChoice = {
  id: string;
  label: string;
  correct: boolean;
  explanation: string;
};

export type TrainingQuizQuestion = {
  id: string;
  module_id: string;
  roles: string[];
  prompt: string;
  scenario: string;
  choices: TrainingQuizChoice[];
};

export type TrainingQuizRound = {
  id: string;
  mode: "dashboard" | "profile" | "module";
  title: string;
  module_id?: string | null;
  question_ids: string[];
  pass_threshold: number;
  best_score: number;
  streak_placeholder: number;
};

export type TrainingQuizAttempt = {
  id: string;
  round_title: string;
  module_id?: string | null;
  played_at: string;
  score_percent: number;
  passed: boolean;
  correct_count: number;
  question_count: number;
  missed_question_ids: string[];
};

export type EmployeeTrainingModuleProgress = {
  module_id: string;
  status: TrainingModuleStatus;
  progress_percent: number;
  due_at?: string | null;
  last_started_at?: string | null;
  completed_at?: string | null;
  best_score?: number | null;
  signoff_status: TrainingSignoffStatus;
  acknowledgement_complete: boolean;
  version_completed?: string | null;
};

export type EmployeeCheckpointResult = {
  checkpoint_id: string;
  status: "pass" | "attention" | "pending";
  notes: string;
  reviewed_at?: string | null;
};

export type EmployeeAcknowledgementState = {
  acknowledgement_id: string;
  acknowledged: boolean;
  acknowledged_at?: string | null;
};

export type EmployeeTrainingProfile = {
  employee: TrainingIdentity;
  assigned_learning_path: string;
  onboarding_stage: string;
  readiness_state: TrainingReadinessState;
  readiness_note: string;
  workbook_progress_percent: number;
  required_progress_percent: number;
  optional_progress_percent: number;
  manager_signoff_status: TrainingSignoffStatus;
  modules: EmployeeTrainingModuleProgress[];
  quiz_history: TrainingQuizAttempt[];
  checkpoints: EmployeeCheckpointResult[];
  acknowledgements: EmployeeAcknowledgementState[];
  last_completed_at?: string | null;
  oversight_note?: string | null;
};

export type TrainingEmployeeSummary = {
  identity: TrainingIdentity;
  readiness_state: TrainingReadinessState;
  readiness_note: string;
  onboarding_stage: string;
  workbook_progress_percent: number;
  required_progress_percent: number;
  optional_progress_percent: number;
  overdue_module_count: number;
  needs_signoff: boolean;
  next_module_title: string;
};

export type TrainingRecentCompletion = {
  employee_name: string;
  module_title: string;
  completed_at: string;
};

export type TrainingRecentSignoff = {
  employee_name: string;
  module_title: string;
  signed_off_by: string;
  signed_off_at: string;
};

export type TrainingOverdueRecord = {
  employee_name: string;
  module_title: string;
  due_at: string;
  readiness_state: TrainingReadinessState;
};

export type TrainingTeamCompletion = {
  team: string;
  completion_percent: number;
  cleared_count: number;
  total_count: number;
};

export type TrainingDashboardSnapshot = {
  org_completion_percent: number;
  required_completion_percent: number;
  optional_completion_percent: number;
  overdue_module_count: number;
  not_cleared_count: number;
  oversight_count: number;
  retraining_required_count: number;
  new_hires_in_onboarding: number;
  recent_completions: TrainingRecentCompletion[];
  recent_quiz_scores: Array<{ employee_name: string; score_percent: number; played_at: string }>;
  recent_signoffs: TrainingRecentSignoff[];
  most_overdue_modules: TrainingOverdueRecord[];
  completion_by_team: TrainingTeamCompletion[];
};

export type TrainingCatalogResponse = {
  workbook: TrainingWorkbook;
  modules: TrainingModule[];
  acknowledgements: TrainingAcknowledgement[];
};

export type TrainingQuizRoundResponse = {
  round: TrainingQuizRound;
  questions: TrainingQuizQuestion[];
};

export type TrainingQuizSubmitResponse = {
  profile: EmployeeTrainingProfile;
  attempt: TrainingQuizAttempt;
  questions: TrainingQuizQuestion[];
};
