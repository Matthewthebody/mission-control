DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_project_job_type') THEN
    CREATE TYPE production_project_job_type AS ENUM (
      'standard_school_production',
      'sports_production',
      'specialty_graphics',
      'banner_specialty_product',
      'gallery_prep_upload',
      'qa_final_review',
      'correction_rework'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_project_qa_state') THEN
    CREATE TYPE production_project_qa_state AS ENUM (
      'not_started',
      'ready_for_qa',
      'in_qa_review',
      'passed',
      'failed',
      'correction_needed',
      'peer_review_required',
      'final_review_required'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_project_release_state') THEN
    CREATE TYPE production_project_release_state AS ENUM (
      'not_ready',
      'ready_to_release',
      'released'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_project_blocker_type') THEN
    CREATE TYPE production_project_blocker_type AS ENUM (
      'missing_files',
      'bad_incomplete_data',
      'waiting_on_decision',
      'waiting_on_customer_school',
      'upload_failure',
      'qa_issue',
      'system_tool_problem',
      'staffing_capacity_issue',
      'external_vendor_dependency',
      'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_project_review_result') THEN
    CREATE TYPE production_project_review_result AS ENUM (
      'passed',
      'correction_needed',
      'blocked',
      'released'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_project_stage_phase4') THEN
    CREATE TYPE production_project_stage_phase4 AS ENUM (
      'intake_pending',
      'ready_for_production',
      'in_production',
      'blocked',
      'ready_for_qa',
      'in_qa_review',
      'correction_needed',
      'ready_to_release',
      'released_complete',
      'on_hold',
      'cancelled'
    );
  END IF;
END $$;

ALTER TABLE production_project_template
  ADD COLUMN IF NOT EXISTS job_type production_project_job_type;

ALTER TABLE production_project
  ADD COLUMN IF NOT EXISTS job_type production_project_job_type,
  ADD COLUMN IF NOT EXISTS qa_state production_project_qa_state NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS release_state production_project_release_state NOT NULL DEFAULT 'not_ready',
  ADD COLUMN IF NOT EXISTS previous_active_stage production_project_stage_phase4,
  ADD COLUMN IF NOT EXISTS correction_reason text,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;

UPDATE production_project_template
SET job_type = CASE template_key
  WHEN 'digital_production_delivery' THEN 'gallery_prep_upload'::production_project_job_type
  WHEN 'post_shoot_issue_remediation' THEN 'correction_rework'::production_project_job_type
  WHEN 'resource_issue_follow_up' THEN 'correction_rework'::production_project_job_type
  WHEN 'manual_production_follow_up' THEN 'specialty_graphics'::production_project_job_type
  ELSE 'standard_school_production'::production_project_job_type
END
WHERE job_type IS NULL;

UPDATE production_project project
SET job_type = CASE
  WHEN project.job_type IS NOT NULL THEN project.job_type
  WHEN project.category = 'remediation'::production_project_category THEN 'correction_rework'::production_project_job_type
  WHEN project.category = 'qa_peer_review'::production_project_category THEN 'qa_final_review'::production_project_job_type
  WHEN project.category = 'digital_production'::production_project_category THEN 'gallery_prep_upload'::production_project_job_type
  WHEN project.source_trigger_key = 'resource_issue_follow_up' THEN 'correction_rework'::production_project_job_type
  WHEN shoot.shoot_type = 'sports' THEN 'sports_production'::production_project_job_type
  ELSE 'standard_school_production'::production_project_job_type
END
FROM shoot
WHERE shoot.tenant_id = project.tenant_id
  AND shoot.id = project.linked_shoot_id
  AND project.job_type IS NULL;

UPDATE production_project
SET job_type = CASE
  WHEN category = 'remediation'::production_project_category THEN 'correction_rework'::production_project_job_type
  WHEN category = 'qa_peer_review'::production_project_category THEN 'qa_final_review'::production_project_job_type
  WHEN category = 'digital_production'::production_project_category THEN 'gallery_prep_upload'::production_project_job_type
  WHEN source_trigger_key = 'resource_issue_follow_up' THEN 'correction_rework'::production_project_job_type
  WHEN source_trigger_key = 'post_shoot_issue_flagged' THEN 'correction_rework'::production_project_job_type
  WHEN source_trigger_key = 'shoot_completed_post_production' THEN 'standard_school_production'::production_project_job_type
  WHEN category = 'production_follow_up'::production_project_category THEN 'specialty_graphics'::production_project_job_type
  ELSE 'standard_school_production'::production_project_job_type
END
WHERE job_type IS NULL;

ALTER TABLE production_project_template
  ALTER COLUMN job_type SET NOT NULL;

ALTER TABLE production_project
  ALTER COLUMN job_type SET NOT NULL;

ALTER TABLE production_project_template
  ALTER COLUMN default_stage DROP DEFAULT;

ALTER TABLE production_project
  ALTER COLUMN stage DROP DEFAULT;

ALTER TABLE production_project_template
  ALTER COLUMN default_stage TYPE production_project_stage_phase4
  USING (
    CASE default_stage::text
      WHEN 'not_started' THEN 'intake_pending'
      WHEN 'in_production' THEN 'in_production'
      WHEN 'needs_peer_review' THEN 'ready_for_qa'
      WHEN 'changes_requested' THEN 'correction_needed'
      WHEN 'qa_approved' THEN 'ready_to_release'
      WHEN 'ready_for_release' THEN 'ready_to_release'
      WHEN 'released' THEN 'released_complete'
      ELSE 'intake_pending'
    END
  )::production_project_stage_phase4;

ALTER TABLE production_project
  ALTER COLUMN stage TYPE production_project_stage_phase4
  USING (
    CASE stage::text
      WHEN 'not_started' THEN 'intake_pending'
      WHEN 'in_production' THEN 'in_production'
      WHEN 'needs_peer_review' THEN 'ready_for_qa'
      WHEN 'changes_requested' THEN 'correction_needed'
      WHEN 'qa_approved' THEN 'ready_to_release'
      WHEN 'ready_for_release' THEN 'ready_to_release'
      WHEN 'released' THEN 'released_complete'
      ELSE 'intake_pending'
    END
  )::production_project_stage_phase4;

DROP TYPE production_project_stage;
ALTER TYPE production_project_stage_phase4 RENAME TO production_project_stage;

ALTER TABLE production_project_template
  ALTER COLUMN default_stage SET DEFAULT 'intake_pending'::production_project_stage;

ALTER TABLE production_project
  ALTER COLUMN stage SET DEFAULT 'intake_pending'::production_project_stage;

UPDATE production_project_template
SET default_stage = CASE template_key
  WHEN 'digital_production_delivery' THEN 'ready_for_production'::production_project_stage
  WHEN 'post_shoot_issue_remediation' THEN 'correction_needed'::production_project_stage
  WHEN 'resource_issue_follow_up' THEN 'blocked'::production_project_stage
  ELSE COALESCE(default_stage, 'intake_pending'::production_project_stage)
END;

UPDATE production_project
SET
  stage = CASE
    WHEN status = 'canceled'::production_project_status THEN 'cancelled'::production_project_stage
    WHEN status = 'completed'::production_project_status THEN 'released_complete'::production_project_stage
    ELSE stage
  END,
  qa_state = CASE
    WHEN stage = 'ready_for_qa'::production_project_stage THEN 'ready_for_qa'::production_project_qa_state
    WHEN stage = 'in_qa_review'::production_project_stage THEN 'in_qa_review'::production_project_qa_state
    WHEN stage = 'correction_needed'::production_project_stage THEN 'correction_needed'::production_project_qa_state
    WHEN stage IN ('ready_to_release'::production_project_stage, 'released_complete'::production_project_stage) THEN 'passed'::production_project_qa_state
    ELSE 'not_started'::production_project_qa_state
  END,
  release_state = CASE
    WHEN stage = 'ready_to_release'::production_project_stage THEN 'ready_to_release'::production_project_release_state
    WHEN stage = 'released_complete'::production_project_stage THEN 'released'::production_project_release_state
    ELSE 'not_ready'::production_project_release_state
  END,
  previous_active_stage = CASE
    WHEN stage = 'blocked'::production_project_stage THEN 'in_production'::production_project_stage
    WHEN stage = 'on_hold'::production_project_stage THEN 'in_production'::production_project_stage
    ELSE NULL
  END;

CREATE TABLE IF NOT EXISTS production_project_blocker (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES production_project(id) ON DELETE CASCADE,
  blocker_type production_project_blocker_type NOT NULL,
  blocker_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reason text NOT NULL,
  dependency text,
  expected_resolution_date date,
  notes text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  resolved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS production_project_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES production_project(id) ON DELETE CASCADE,
  reviewer_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  review_stage production_project_stage NOT NULL,
  result production_project_review_result NOT NULL,
  correction_reason text,
  note text,
  reassigned_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS production_project_tenant_job_type_idx
  ON production_project (tenant_id, job_type, stage, due_date, created_at DESC);

CREATE INDEX IF NOT EXISTS production_project_tenant_qa_state_idx
  ON production_project (tenant_id, qa_state, release_state, due_date, created_at DESC);

CREATE INDEX IF NOT EXISTS production_project_blocker_project_idx
  ON production_project_blocker (tenant_id, project_id, resolved_at, created_at DESC);

CREATE INDEX IF NOT EXISTS production_project_review_project_idx
  ON production_project_review (tenant_id, project_id, created_at DESC);

ALTER TABLE production_project_blocker ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_project_review ENABLE ROW LEVEL SECURITY;

ALTER TABLE production_project_blocker FORCE ROW LEVEL SECURITY;
ALTER TABLE production_project_review FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_production_project_blocker ON production_project_blocker
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_production_project_review ON production_project_review
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
