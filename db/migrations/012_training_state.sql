CREATE TYPE training_readiness_state AS ENUM ('cleared', 'cleared_with_oversight', 'not_cleared', 'retraining_required');
CREATE TYPE training_module_status AS ENUM ('not_started', 'in_progress', 'completed', 'overdue', 'needs_review');
CREATE TYPE training_signoff_status AS ENUM ('pending', 'complete', 'not_required');
CREATE TYPE training_checkpoint_status AS ENUM ('pass', 'attention', 'pending');

CREATE TABLE training_profile_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  assigned_learning_path text NOT NULL,
  onboarding_stage text NOT NULL,
  readiness_state training_readiness_state NOT NULL DEFAULT 'not_cleared',
  readiness_note text NOT NULL,
  workbook_progress_percent integer NOT NULL DEFAULT 0,
  required_progress_percent integer NOT NULL DEFAULT 0,
  optional_progress_percent integer NOT NULL DEFAULT 0,
  manager_signoff_status training_signoff_status NOT NULL DEFAULT 'pending',
  oversight_note text,
  last_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE training_module_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  module_id text NOT NULL,
  status training_module_status NOT NULL DEFAULT 'not_started',
  progress_percent integer NOT NULL DEFAULT 0,
  due_at timestamptz,
  last_started_at timestamptz,
  completed_at timestamptz,
  best_score integer,
  signoff_status training_signoff_status NOT NULL DEFAULT 'not_required',
  acknowledgement_complete boolean NOT NULL DEFAULT false,
  version_completed text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, module_id)
);

CREATE TABLE training_quiz_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  round_title text NOT NULL,
  module_id text,
  played_at timestamptz NOT NULL,
  score_percent integer NOT NULL,
  passed boolean NOT NULL DEFAULT false,
  correct_count integer NOT NULL,
  question_count integer NOT NULL,
  missed_question_ids text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE training_checkpoint_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  checkpoint_id text NOT NULL,
  status training_checkpoint_status NOT NULL DEFAULT 'pending',
  notes text NOT NULL DEFAULT '',
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, checkpoint_id)
);

CREATE TABLE training_acknowledgement_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  acknowledgement_id text NOT NULL,
  acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, acknowledgement_id)
);

CREATE INDEX training_profile_state_tenant_user_idx ON training_profile_state (tenant_id, user_id);
CREATE INDEX training_module_progress_tenant_user_idx ON training_module_progress (tenant_id, user_id, updated_at DESC);
CREATE INDEX training_quiz_attempt_tenant_user_idx ON training_quiz_attempt (tenant_id, user_id, played_at DESC);
CREATE INDEX training_checkpoint_result_tenant_user_idx ON training_checkpoint_result (tenant_id, user_id, updated_at DESC);
CREATE INDEX training_acknowledgement_state_tenant_user_idx ON training_acknowledgement_state (tenant_id, user_id, updated_at DESC);

ALTER TABLE training_profile_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_module_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_quiz_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_checkpoint_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_acknowledgement_state ENABLE ROW LEVEL SECURITY;

ALTER TABLE training_profile_state FORCE ROW LEVEL SECURITY;
ALTER TABLE training_module_progress FORCE ROW LEVEL SECURITY;
ALTER TABLE training_quiz_attempt FORCE ROW LEVEL SECURITY;
ALTER TABLE training_checkpoint_result FORCE ROW LEVEL SECURITY;
ALTER TABLE training_acknowledgement_state FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_training_profile_state ON training_profile_state
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_training_module_progress ON training_module_progress
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_training_quiz_attempt ON training_quiz_attempt
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_training_checkpoint_result ON training_checkpoint_result
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_training_acknowledgement_state ON training_acknowledgement_state
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
