BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'post_call_outcome_status') THEN
    CREATE TYPE post_call_outcome_status AS ENUM (
      'follow_up_open',
      'handled'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS communication_post_call_outcome (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  related_record_type teams_meeting_link_object_type NOT NULL,
  related_record_id uuid NOT NULL,
  meeting_id uuid REFERENCES teams_meeting_reference(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  handled_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  outcome_status post_call_outcome_status NOT NULL DEFAULT 'handled',
  summary text NOT NULL,
  notes text,
  reason_for_call text,
  meeting_target_id text,
  meeting_join_url text,
  follow_up_task_id uuid REFERENCES work_task(id) ON DELETE SET NULL,
  follow_up_assignee_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  watch_flag_id uuid REFERENCES job_watch_flags(id) ON DELETE SET NULL,
  issue_flagged boolean NOT NULL DEFAULT false,
  handled_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS communication_post_call_outcome_record_idx
  ON communication_post_call_outcome (tenant_id, related_record_type, related_record_id, created_at DESC);

CREATE INDEX IF NOT EXISTS communication_post_call_outcome_meeting_idx
  ON communication_post_call_outcome (tenant_id, meeting_id, created_at DESC)
  WHERE meeting_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS communication_post_call_outcome_status_idx
  ON communication_post_call_outcome (tenant_id, outcome_status, created_at DESC);

ALTER TABLE communication_post_call_outcome ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_post_call_outcome FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'communication_post_call_outcome'
      AND policyname = 'tenant_isolation_communication_post_call_outcome'
  ) THEN
    CREATE POLICY tenant_isolation_communication_post_call_outcome ON communication_post_call_outcome
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

COMMIT;
