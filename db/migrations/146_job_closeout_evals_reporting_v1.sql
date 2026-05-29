DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shoot_check_in_status_type') THEN
    CREATE TYPE shoot_check_in_status_type AS ENUM ('pending', 'good', 'issue', 'missed');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_closeout_submitter_role_type') THEN
    CREATE TYPE job_closeout_submitter_role_type AS ENUM (
      'senior_photographer',
      'shoot_lead',
      'associate',
      'leadership',
      'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_closeout_evaluation_type') THEN
    CREATE TYPE job_closeout_evaluation_type AS ENUM ('post_shoot', 'post_production');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_closeout_overall_status_type') THEN
    CREATE TYPE job_closeout_overall_status_type AS ENUM ('smooth', 'few_bumps', 'rough');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_closeout_schedule_status_type') THEN
    CREATE TYPE job_closeout_schedule_status_type AS ENUM ('on_schedule', 'slight_delays', 'major_delays');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_closeout_issue_status_type') THEN
    CREATE TYPE job_closeout_issue_status_type AS ENUM ('none', 'minor', 'major');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_closeout_retake_risk_type') THEN
    CREATE TYPE job_closeout_retake_risk_type AS ENUM ('none', 'possible', 'likely');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_closeout_client_sentiment_type') THEN
    CREATE TYPE job_closeout_client_sentiment_type AS ENUM ('very_happy', 'fine', 'frustrated');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_closeout_data_issue_type') THEN
    CREATE TYPE job_closeout_data_issue_type AS ENUM (
      'missing_subjects',
      'qr_missing_or_would_not_scan',
      'qr_sorting_issue',
      'schedule_or_roster_issue',
      'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_closeout_mileage_disqualification_type') THEN
    CREATE TYPE job_closeout_mileage_disqualification_type AS ENUM (
      'company_vehicle',
      'carpool',
      'did_not_drive',
      'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_closeout_attachment_type') THEN
    CREATE TYPE job_closeout_attachment_type AS ENUM ('setup', 'location', 'issue', 'other');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_closeout_mileage_status_type') THEN
    CREATE TYPE job_closeout_mileage_status_type AS ENUM (
      'pending_review',
      'approved',
      'exported',
      'voided',
      'needs_zone_review'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operations_report_type') THEN
    CREATE TYPE operations_report_type AS ENUM ('daily', 'weekly');
  END IF;
END $$;

ALTER TABLE post_shoot_evaluation
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS evaluation_type job_closeout_evaluation_type NOT NULL DEFAULT 'post_shoot',
  ADD COLUMN IF NOT EXISTS evaluation_version text NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS submitter_role job_closeout_submitter_role_type,
  ADD COLUMN IF NOT EXISTS v1_overall_status job_closeout_overall_status_type,
  ADD COLUMN IF NOT EXISTS v1_overall_score integer,
  ADD COLUMN IF NOT EXISTS schedule_status job_closeout_schedule_status_type,
  ADD COLUMN IF NOT EXISTS schedule_note text,
  ADD COLUMN IF NOT EXISTS staffing_status job_closeout_issue_status_type,
  ADD COLUMN IF NOT EXISTS staffing_note text,
  ADD COLUMN IF NOT EXISTS all_photographers_on_time boolean,
  ADD COLUMN IF NOT EXISTS late_note text,
  ADD COLUMN IF NOT EXISTS image_confidence_score integer,
  ADD COLUMN IF NOT EXISTS technical_issue_status job_closeout_issue_status_type,
  ADD COLUMN IF NOT EXISTS technical_issue_note text,
  ADD COLUMN IF NOT EXISTS retake_risk job_closeout_retake_risk_type,
  ADD COLUMN IF NOT EXISTS client_sentiment job_closeout_client_sentiment_type,
  ADD COLUMN IF NOT EXISTS client_issue_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_issue_note text,
  ADD COLUMN IF NOT EXISTS data_issue_types job_closeout_data_issue_type[] NOT NULL DEFAULT ARRAY[]::job_closeout_data_issue_type[],
  ADD COLUMN IF NOT EXISTS data_issue_note text,
  ADD COLUMN IF NOT EXISTS positive_shoutout_note text,
  ADD COLUMN IF NOT EXISTS support_needed_note text,
  ADD COLUMN IF NOT EXISTS next_year_improvement_note text,
  ADD COLUMN IF NOT EXISTS mileage_qualified boolean,
  ADD COLUMN IF NOT EXISTS mileage_note text,
  ADD COLUMN IF NOT EXISTS mileage_disqualification_reason job_closeout_mileage_disqualification_type,
  ADD COLUMN IF NOT EXISTS import_source text,
  ADD COLUMN IF NOT EXISTS external_source_id text,
  ADD COLUMN IF NOT EXISTS imported_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'post_shoot_evaluation_v1_score_check'
  ) THEN
    ALTER TABLE post_shoot_evaluation
      ADD CONSTRAINT post_shoot_evaluation_v1_score_check
      CHECK (
        (v1_overall_score IS NULL OR v1_overall_score BETWEEN 1 AND 5)
        AND (image_confidence_score IS NULL OR image_confidence_score BETWEEN 1 AND 5)
      );
  END IF;
END $$;

UPDATE post_shoot_evaluation pse
SET job_id = COALESCE(pse.job_id, job.id)
FROM jobs job
WHERE pse.job_id IS NULL
  AND pse.tenant_id = job.tenant_id
  AND (
    job.id = pse.shoot_id
    OR job.legacy_shoot_id = pse.shoot_id
  );

CREATE TABLE IF NOT EXISTS shoot_check_in_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  job_day_id uuid REFERENCES job_days(id) ON DELETE SET NULL,
  requested_for_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  responded_at timestamptz,
  status shoot_check_in_status_type NOT NULL DEFAULT 'pending',
  issue_note text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shoot_check_in_due_order_check CHECK (due_at >= requested_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS shoot_check_in_request_job_user_due_uq
  ON shoot_check_in_request (tenant_id, job_id, requested_for_user_id, due_at);

CREATE INDEX IF NOT EXISTS shoot_check_in_request_due_idx
  ON shoot_check_in_request (tenant_id, status, due_at, created_at DESC);

CREATE INDEX IF NOT EXISTS shoot_check_in_request_job_idx
  ON shoot_check_in_request (tenant_id, job_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS post_shoot_late_staff_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  evaluation_id uuid NOT NULL REFERENCES post_shoot_evaluation(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  minutes_late integer,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_shoot_late_staff_minutes_check CHECK (minutes_late IS NULL OR minutes_late >= 0)
);

CREATE INDEX IF NOT EXISTS post_shoot_late_staff_evaluation_idx
  ON post_shoot_late_staff_entry (tenant_id, evaluation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS post_shoot_late_staff_user_idx
  ON post_shoot_late_staff_entry (tenant_id, user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS post_shoot_evaluation_attachment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  evaluation_id uuid REFERENCES post_shoot_evaluation(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  uploaded_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  attachment_type job_closeout_attachment_type NOT NULL DEFAULT 'setup',
  storage_key text,
  file_url text,
  filename text,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_shoot_evaluation_attachment_location_check CHECK (storage_key IS NOT NULL OR file_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS post_shoot_evaluation_attachment_job_idx
  ON post_shoot_evaluation_attachment (tenant_id, job_id, attachment_type, created_at DESC);

CREATE TABLE IF NOT EXISTS job_closeout_mileage_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  account_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  evaluation_id uuid REFERENCES post_shoot_evaluation(id) ON DELETE SET NULL,
  mileage_qualified boolean NOT NULL DEFAULT false,
  zone_id uuid REFERENCES mileage_zone(id) ON DELETE SET NULL,
  zone_name text,
  calculated_amount numeric(10,2),
  status job_closeout_mileage_status_type NOT NULL DEFAULT 'pending_review',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  exported_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS job_closeout_mileage_review_eval_user_uq
  ON job_closeout_mileage_review (tenant_id, evaluation_id, user_id)
  WHERE evaluation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS job_closeout_mileage_review_status_idx
  ON job_closeout_mileage_review (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS job_closeout_mileage_review_job_idx
  ON job_closeout_mileage_review (tenant_id, job_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS operations_report_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  report_type operations_report_type NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Chicago',
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  generated_by text NOT NULL DEFAULT 'system',
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  issue_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  wins_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  people_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  account_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_year_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_evaluation_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  source_flag_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operations_report_snapshot_period_check CHECK (period_end > period_start)
);

CREATE INDEX IF NOT EXISTS operations_report_snapshot_period_idx
  ON operations_report_snapshot (tenant_id, report_type, period_start DESC, period_end DESC);

CREATE INDEX IF NOT EXISTS post_shoot_evaluation_job_v1_idx
  ON post_shoot_evaluation (tenant_id, job_id, evaluation_type, submitted_at DESC)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS post_shoot_evaluation_report_filter_idx
  ON post_shoot_evaluation (tenant_id, evaluation_type, v1_overall_status, image_confidence_score, submitted_at DESC);

CREATE INDEX IF NOT EXISTS post_shoot_evaluation_mileage_v1_idx
  ON post_shoot_evaluation (tenant_id, mileage_qualified, submitted_at DESC)
  WHERE mileage_qualified IS NOT NULL;

CREATE INDEX IF NOT EXISTS job_watch_flags_closeout_source_idx
  ON job_watch_flags (tenant_id, source_entity_type, source_entity_id, status, created_at DESC)
  WHERE source_entity_type IN ('shoot_check_in', 'post_shoot_evaluation', 'missing_evaluation', 'mileage', 'report');

CREATE INDEX IF NOT EXISTS job_watch_flags_closeout_filter_idx
  ON job_watch_flags (tenant_id, flag_type, severity, status, created_at DESC)
  WHERE flag_type LIKE 'job_closeout_%';

ALTER TABLE shoot_check_in_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_shoot_late_staff_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_shoot_evaluation_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_closeout_mileage_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_report_snapshot ENABLE ROW LEVEL SECURITY;

ALTER TABLE shoot_check_in_request FORCE ROW LEVEL SECURITY;
ALTER TABLE post_shoot_late_staff_entry FORCE ROW LEVEL SECURITY;
ALTER TABLE post_shoot_evaluation_attachment FORCE ROW LEVEL SECURITY;
ALTER TABLE job_closeout_mileage_review FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_report_snapshot FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_shoot_check_in_request ON shoot_check_in_request;
CREATE POLICY tenant_isolation_shoot_check_in_request ON shoot_check_in_request
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_post_shoot_late_staff_entry ON post_shoot_late_staff_entry;
CREATE POLICY tenant_isolation_post_shoot_late_staff_entry ON post_shoot_late_staff_entry
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_post_shoot_evaluation_attachment ON post_shoot_evaluation_attachment;
CREATE POLICY tenant_isolation_post_shoot_evaluation_attachment ON post_shoot_evaluation_attachment
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_job_closeout_mileage_review ON job_closeout_mileage_review;
CREATE POLICY tenant_isolation_job_closeout_mileage_review ON job_closeout_mileage_review
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_operations_report_snapshot ON operations_report_snapshot;
CREATE POLICY tenant_isolation_operations_report_snapshot ON operations_report_snapshot
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_resource_library_item_link ON resource_library_item_link;
CREATE POLICY tenant_isolation_resource_library_item_link ON resource_library_item_link
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE OR REPLACE FUNCTION refresh_global_search_index_post_shoot_evaluation(p_tenant_id uuid, p_evaluation_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM global_search_index
  WHERE tenant_id = p_tenant_id
    AND entity_type = 'post_shoot_evaluation'
    AND entity_id = p_evaluation_id
    AND NOT EXISTS (
      SELECT 1
      FROM post_shoot_evaluation evaluation
      WHERE evaluation.tenant_id = p_tenant_id
        AND evaluation.id = p_evaluation_id
    );

  INSERT INTO global_search_index (
    tenant_id, entity_type, entity_id, title, subtitle, body_search_text, status, department, org_id, org_name,
    owner_id, assignee_ids, related_ids, primary_date, risk_level, permissions_payload, deep_link, updated_at, activity_at,
    has_notes, has_alerts, has_staffing_gap
  )
  SELECT
    evaluation.tenant_id,
    'post_shoot_evaluation',
    evaluation.id,
    concat('Post-Shoot Eval: ', coalesce(shoot_row.title, evaluation.shoot_name)),
    concat_ws(' | ', org_row.display_name, location_row.name, evaluation.photographer_name),
    concat_ws(
      ' ',
      evaluation.short_summary_note,
      evaluation.next_time_recommendation,
      evaluation.went_well,
      evaluation.remember_next_time,
      evaluation.top_watch_out,
      evaluation.location_memory_promotion_text,
      evaluation.open_comment,
      evaluation.issue_category::text,
      evaluation.staffing_change_recommendation,
      evaluation.special_gear_needed_next_time
    ),
    evaluation.eval_status::text,
    shoot_row.department::text,
    evaluation.organization_id,
    org_row.display_name,
    coalesce(evaluation.eval_owner_user_id, evaluation.photographer_user_id),
    array_remove(ARRAY[evaluation.photographer_user_id, evaluation.follow_up_owner_user_id, shift_row.manager_user_id]::uuid[], null::uuid),
    array_remove(ARRAY[evaluation.shift_id, evaluation.shoot_id, evaluation.organization_id, evaluation.location_id]::uuid[], null::uuid),
    coalesce(evaluation.submitted_at, evaluation.updated_at, evaluation.created_at),
    CASE
      WHEN evaluation.leadership_review_needed OR evaluation.major_issue_flag THEN 'critical'
      WHEN evaluation.follow_up_required THEN 'warning'
      ELSE NULL
    END,
    jsonb_build_object(
      'access_model', 'post_shoot_evaluation',
      'department', shoot_row.department::text,
      'photographer_user_id', evaluation.photographer_user_id::text,
      'manager_user_id', shift_row.manager_user_id::text,
      'assigned_user_ids',
        array_remove(ARRAY[evaluation.photographer_user_id::text, evaluation.follow_up_owner_user_id::text], NULL),
      'lead_user_ids',
        coalesce(
          (
            SELECT array_agg(DISTINCT ws.assigned_user_id::text)
            FROM work_shift ws
            WHERE ws.tenant_id = evaluation.tenant_id
              AND ws.shoot_id = evaluation.shoot_id
              AND ws.cancelled_at IS NULL
              AND ws.status IN ('draft', 'published', 'completed')
              AND ws.satisfies_lead_coverage = true
          ),
          ARRAY[]::text[]
        )
    ),
    CASE
      WHEN evaluation.shoot_id IS NOT NULL THEN '#photography/shoots?shoot=' || evaluation.shoot_id::text
      WHEN evaluation.shift_id IS NOT NULL THEN '#schedule/staffing?shift=' || evaluation.shift_id::text
      ELSE '#photography'
    END,
    evaluation.updated_at,
    coalesce(evaluation.submitted_at, evaluation.updated_at, evaluation.created_at),
    true,
    false,
    coalesce(evaluation.staffing_fit = 'understaffed'::post_shoot_eval_staffing_fit, false)
  FROM post_shoot_evaluation evaluation
  LEFT JOIN shoot shoot_row
    ON shoot_row.tenant_id = evaluation.tenant_id
   AND shoot_row.id = evaluation.shoot_id
  LEFT JOIN organization org_row
    ON org_row.tenant_id = evaluation.tenant_id
   AND org_row.id = evaluation.organization_id
  LEFT JOIN shoot_location location_row
    ON location_row.tenant_id = evaluation.tenant_id
   AND location_row.id = evaluation.location_id
  LEFT JOIN work_shift shift_row
    ON shift_row.tenant_id = evaluation.tenant_id
   AND shift_row.id = evaluation.shift_id
  WHERE evaluation.tenant_id = p_tenant_id
    AND evaluation.id = p_evaluation_id
  ON CONFLICT (tenant_id, entity_type, entity_id)
  DO UPDATE SET
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    body_search_text = EXCLUDED.body_search_text,
    status = EXCLUDED.status,
    department = EXCLUDED.department,
    org_id = EXCLUDED.org_id,
    org_name = EXCLUDED.org_name,
    owner_id = EXCLUDED.owner_id,
    assignee_ids = EXCLUDED.assignee_ids,
    related_ids = EXCLUDED.related_ids,
    primary_date = EXCLUDED.primary_date,
    risk_level = EXCLUDED.risk_level,
    permissions_payload = EXCLUDED.permissions_payload,
    deep_link = EXCLUDED.deep_link,
    updated_at = EXCLUDED.updated_at,
    activity_at = EXCLUDED.activity_at,
    has_notes = EXCLUDED.has_notes,
    has_alerts = EXCLUDED.has_alerts,
    has_staffing_gap = EXCLUDED.has_staffing_gap;
END;
$$;

INSERT INTO permission (code, name, description, resource_type, action_group)
VALUES
  ('job_closeout.read', 'Read Job Closeout', 'Read job check-ins, post-shoot evaluations, account history, and pre-shoot brief signals.', 'job_closeout', 'read'),
  ('job_closeout.submit', 'Submit Job Closeout', 'Submit shoot check-ins and post-shoot evaluations for assigned jobs.', 'job_closeout', 'write'),
  ('job_closeout.manage', 'Manage Job Closeout', 'Manage job closeout records and operational follow-up.', 'job_closeout', 'manage'),
  ('job_closeout.reporting.read', 'Read Job Closeout Reports', 'Read daily and weekly operations report snapshots.', 'job_closeout_report', 'read'),
  ('job_closeout.reporting.sensitive', 'Read Sensitive Job Closeout Reporting', 'Read personnel, coaching, support, and payroll-sensitive job closeout trends.', 'job_closeout_report', 'sensitive'),
  ('job_closeout.mileage.manage', 'Manage Job Closeout Mileage', 'Review, approve, void, and export mileage qualification records.', 'job_closeout_mileage', 'manage')
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  resource_type = EXCLUDED.resource_type,
  action_group = EXCLUDED.action_group;
