DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_follow_up_type') THEN
    CREATE TYPE production_follow_up_type AS ENUM ('training', 'ops_followup', 'coaching', 'process_update');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_follow_up_status') THEN
    CREATE TYPE production_follow_up_status AS ENUM ('open', 'in_progress', 'complete');
  END IF;
END $$;

ALTER TABLE production_project_exception
  ADD COLUMN IF NOT EXISTS issue_tag text,
  ADD COLUMN IF NOT EXISTS follow_up_type production_follow_up_type,
  ADD COLUMN IF NOT EXISTS follow_up_status production_follow_up_status,
  ADD COLUMN IF NOT EXISTS follow_up_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS follow_up_notes text;

CREATE INDEX IF NOT EXISTS production_project_exception_issue_tag_idx
  ON production_project_exception (tenant_id, issue_tag);

CREATE INDEX IF NOT EXISTS production_project_exception_follow_up_idx
  ON production_project_exception (tenant_id, follow_up_type, follow_up_status);

CREATE INDEX IF NOT EXISTS production_project_exception_created_idx
  ON production_project_exception (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS production_project_review_created_idx
  ON production_project_review (tenant_id, created_at, result);

CREATE INDEX IF NOT EXISTS production_project_stage_updated_idx
  ON production_project (tenant_id, stage, updated_at);
