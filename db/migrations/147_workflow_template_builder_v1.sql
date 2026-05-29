ALTER TABLE workflow_template
  ADD COLUMN IF NOT EXISTS job_type text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE workflow_template_version
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;

ALTER TABLE workflow_template_milestone
  ADD COLUMN IF NOT EXISTS default_owner_type text,
  ADD COLUMN IF NOT EXISTS default_owner_value text;

ALTER TABLE workflow_template_step
  ADD COLUMN IF NOT EXISTS owner_type text,
  ADD COLUMN IF NOT EXISTS owner_value text,
  ADD COLUMN IF NOT EXISTS due_offset_minutes integer,
  ADD COLUMN IF NOT EXISTS dependency_mode text NOT NULL DEFAULT 'waits_for_prior_step',
  ADD COLUMN IF NOT EXISTS blocked_behavior text,
  ADD COLUMN IF NOT EXISTS checklist_template_id uuid REFERENCES checklist_templates(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workflow_template_step_due_offset_nonnegative_chk'
  ) THEN
    ALTER TABLE workflow_template_step
      ADD CONSTRAINT workflow_template_step_due_offset_nonnegative_chk
      CHECK (due_offset_minutes IS NULL OR due_offset_minutes >= 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workflow_template_step_dependency_mode_chk'
  ) THEN
    ALTER TABLE workflow_template_step
      ADD CONSTRAINT workflow_template_step_dependency_mode_chk
      CHECK (dependency_mode IN ('can_start_immediately', 'waits_for_prior_step', 'waits_for_dependencies', 'waits_for_milestone_completion')) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS workflow_template_tenant_family_status_idx
  ON workflow_template (tenant_id, workflow_family, archived_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS workflow_template_version_builder_status_idx
  ON workflow_template_version (tenant_id, template_id, status, version_number DESC);

CREATE INDEX IF NOT EXISTS workflow_template_milestone_version_sort_idx
  ON workflow_template_milestone (tenant_id, template_version_id, sort_order, created_at);

CREATE INDEX IF NOT EXISTS workflow_template_step_version_milestone_sort_idx
  ON workflow_template_step (tenant_id, template_version_id, template_milestone_id, sort_order, created_at);

CREATE INDEX IF NOT EXISTS workflow_template_step_checklist_template_idx
  ON workflow_template_step (tenant_id, checklist_template_id)
  WHERE checklist_template_id IS NOT NULL;
