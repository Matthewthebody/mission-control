DO $$
BEGIN
  CREATE TYPE post_shoot_overall_status AS ENUM (
    'successful',
    'completed_with_issues',
    'significant_issue'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE post_shoot_evaluation
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES work_shift(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS evaluation_year integer,
  ADD COLUMN IF NOT EXISTS overall_shoot_status post_shoot_overall_status,
  ADD COLUMN IF NOT EXISTS went_well text,
  ADD COLUMN IF NOT EXISTS remember_next_time text,
  ADD COLUMN IF NOT EXISTS issue_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS open_comment text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS submitter_locked boolean NOT NULL DEFAULT true;

UPDATE post_shoot_evaluation p
SET
  organization_id = COALESCE(p.organization_id, sl.organization_id),
  evaluation_year = COALESCE(p.evaluation_year, EXTRACT(YEAR FROM p.shoot_date)::integer),
  submitted_at = COALESCE(p.submitted_at, p.created_at),
  overall_shoot_status = COALESCE(
    p.overall_shoot_status,
    CASE
      WHEN p.overall_rating >= 4 THEN 'successful'::post_shoot_overall_status
      WHEN p.overall_rating = 3 THEN 'completed_with_issues'::post_shoot_overall_status
      ELSE 'significant_issue'::post_shoot_overall_status
    END
  ),
  open_comment = COALESCE(p.open_comment, p.notes),
  remember_next_time = COALESCE(p.remember_next_time, p.recommendations),
  issue_flag = COALESCE(
    p.issue_flag,
    CASE
      WHEN p.overall_rating <= 2 THEN true
      ELSE false
    END
  )
FROM shoot_location sl
WHERE sl.id = p.location_id;

CREATE INDEX IF NOT EXISTS post_shoot_evaluation_tenant_shoot_idx
  ON post_shoot_evaluation (tenant_id, shoot_id, created_at DESC);

CREATE INDEX IF NOT EXISTS post_shoot_evaluation_tenant_shift_idx
  ON post_shoot_evaluation (tenant_id, shift_id, created_at DESC);

CREATE INDEX IF NOT EXISTS post_shoot_evaluation_tenant_org_idx
  ON post_shoot_evaluation (tenant_id, organization_id, shoot_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS post_shoot_evaluation_tenant_shift_submitter_uq
  ON post_shoot_evaluation (tenant_id, shift_id, photographer_user_id)
  WHERE shift_id IS NOT NULL AND photographer_user_id IS NOT NULL;
