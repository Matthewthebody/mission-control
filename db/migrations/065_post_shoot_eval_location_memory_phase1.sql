DO $$
BEGIN
  CREATE TYPE post_shoot_eval_status AS ENUM (
    'draft',
    'submitted',
    'reviewed',
    'closed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE post_shoot_eval_outcome AS ENUM (
    'smooth',
    'minor_issues',
    'major_issues',
    'needs_leadership_review'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE post_shoot_eval_staffing_fit AS ENUM (
    'understaffed',
    'right_sized',
    'overstaffed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE post_shoot_eval_setup_difficulty AS ENUM (
    'low',
    'medium',
    'high'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE post_shoot_eval_readiness_state AS ENUM (
    'ready',
    'minor_friction',
    'major_friction'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE post_shoot_eval_issue_state AS ENUM (
    'none',
    'minor',
    'major'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE post_shoot_issue_category AS ENUM (
    'staffing',
    'attendance_no_show',
    'setup_room_problem',
    'parking_load_in',
    'school_readiness',
    'data_roster',
    'equipment_technical',
    'lighting_environment',
    'line_flow_traffic',
    'student_parent_flow',
    'communication_contact_issue',
    'special_product_deliverable_issue',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE setup_photo_category AS ENUM (
    'arrival_entrance',
    'parking_load_in',
    'check_in_flow_area',
    'room_wide_shot',
    'final_camera_background_setup',
    'power_staging_storage',
    'special_constraint_watch_out'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE setup_photo_memory_state AS ENUM (
    'submitted',
    'reviewed',
    'added_to_memory'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE post_shoot_evaluation
  ALTER COLUMN submitted_at DROP NOT NULL;

ALTER TABLE post_shoot_evaluation
  ADD COLUMN IF NOT EXISTS eval_status post_shoot_eval_status NOT NULL DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS overall_outcome post_shoot_eval_outcome,
  ADD COLUMN IF NOT EXISTS eval_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS staffing_fit post_shoot_eval_staffing_fit,
  ADD COLUMN IF NOT EXISTS setup_difficulty post_shoot_eval_setup_difficulty,
  ADD COLUMN IF NOT EXISTS customer_school_readiness post_shoot_eval_readiness_state,
  ADD COLUMN IF NOT EXISTS data_roster_readiness post_shoot_eval_readiness_state,
  ADD COLUMN IF NOT EXISTS equipment_workflow_issue post_shoot_eval_issue_state,
  ADD COLUMN IF NOT EXISTS started_on_time boolean,
  ADD COLUMN IF NOT EXISTS short_summary_note text,
  ADD COLUMN IF NOT EXISTS next_time_recommendation text,
  ADD COLUMN IF NOT EXISTS follow_up_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS major_issue_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS location_memory_update_suggested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS leadership_review_needed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS issue_category post_shoot_issue_category,
  ADD COLUMN IF NOT EXISTS understaffed_role text,
  ADD COLUMN IF NOT EXISTS staffing_change_recommendation text,
  ADD COLUMN IF NOT EXISTS customer_follow_up_needed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS follow_up_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recommended_staffing_next_time integer,
  ADD COLUMN IF NOT EXISTS recommended_arrival_buffer_minutes integer,
  ADD COLUMN IF NOT EXISTS recommended_room_setup_change text,
  ADD COLUMN IF NOT EXISTS special_gear_needed_next_time text,
  ADD COLUMN IF NOT EXISTS top_watch_out text,
  ADD COLUMN IF NOT EXISTS location_memory_promotion_text text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS close_note text;

UPDATE post_shoot_evaluation
SET
  eval_status = COALESCE(eval_status, 'submitted'::post_shoot_eval_status),
  overall_outcome = COALESCE(
    overall_outcome,
    CASE overall_shoot_status
      WHEN 'successful'::post_shoot_overall_status THEN 'smooth'::post_shoot_eval_outcome
      WHEN 'completed_with_issues'::post_shoot_overall_status THEN 'minor_issues'::post_shoot_eval_outcome
      WHEN 'significant_issue'::post_shoot_overall_status THEN 'major_issues'::post_shoot_eval_outcome
      ELSE NULL
    END
  ),
  eval_owner_user_id = COALESCE(eval_owner_user_id, photographer_user_id),
  started_on_time = COALESCE(started_on_time, CASE WHEN on_time = 'Yes' THEN true WHEN on_time = 'No' THEN false ELSE NULL END),
  short_summary_note = COALESCE(short_summary_note, open_comment, notes),
  next_time_recommendation = COALESCE(next_time_recommendation, remember_next_time, recommendations),
  follow_up_required = COALESCE(follow_up_required, issue_flag),
  major_issue_flag = COALESCE(major_issue_flag, overall_shoot_status = 'significant_issue'::post_shoot_overall_status),
  leadership_review_needed = COALESCE(leadership_review_needed, overall_shoot_status = 'significant_issue'::post_shoot_overall_status),
  submitter_locked = COALESCE(submitter_locked, true);

ALTER TABLE setup_photo_upload
  ADD COLUMN IF NOT EXISTS photo_category setup_photo_category,
  ADD COLUMN IF NOT EXISTS caption text,
  ADD COLUMN IF NOT EXISTS promote_to_location_memory boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS memory_state setup_photo_memory_state NOT NULL DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS added_to_memory_at timestamptz,
  ADD COLUMN IF NOT EXISTS added_to_memory_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;

UPDATE setup_photo_upload
SET
  caption = COALESCE(caption, file_name),
  memory_state = COALESCE(memory_state, 'reviewed'::setup_photo_memory_state),
  reviewed_at = COALESCE(reviewed_at, uploaded_at);

CREATE INDEX IF NOT EXISTS post_shoot_evaluation_tenant_status_idx
  ON post_shoot_evaluation (tenant_id, eval_status, created_at DESC);

CREATE INDEX IF NOT EXISTS post_shoot_evaluation_tenant_follow_up_idx
  ON post_shoot_evaluation (tenant_id, follow_up_required, leadership_review_needed, created_at DESC);

CREATE INDEX IF NOT EXISTS setup_photo_upload_tenant_memory_idx
  ON setup_photo_upload (tenant_id, location_id, memory_state, uploaded_at DESC);
