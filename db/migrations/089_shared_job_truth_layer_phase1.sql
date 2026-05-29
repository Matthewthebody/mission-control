DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_department_type') THEN
    CREATE TYPE job_department_type AS ENUM ('schools', 'sports', 'corporate', 'headshots', 'other');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_category_type') THEN
    CREATE TYPE job_category_type AS ENUM (
      'photo_day',
      'makeup_day',
      'reshoot',
      'media_day',
      'event',
      'banner_day',
      'specialty',
      'delivery_only',
      'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status_type') THEN
    CREATE TYPE job_status_type AS ENUM (
      'draft',
      'intake_blocked',
      'pending_confirmation',
      'confirmed',
      'ready_to_staff',
      'staffed',
      'ready_to_execute',
      'in_progress',
      'execution_complete',
      'postponed',
      'weather_hold',
      'cancelled',
      'archived'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_day_status_type') THEN
    CREATE TYPE job_day_status_type AS ENUM ('scheduled', 'ready', 'in_progress', 'complete', 'postponed', 'cancelled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_production_status_type') THEN
    CREATE TYPE job_production_status_type AS ENUM (
      'not_created',
      'queued',
      'awaiting_ingest',
      'ingest_complete',
      'editing',
      'proof_build',
      'proof_sent',
      'awaiting_approval',
      'revisions_requested',
      'approved_for_production',
      'ordered_or_printed',
      'packaged',
      'delivered',
      'complete',
      'blocked'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_staffing_status_type') THEN
    CREATE TYPE job_staffing_status_type AS ENUM (
      'unassigned',
      'partially_staffed',
      'staffed',
      'checked_in',
      'ready_confirmed',
      'gap_flagged'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_readiness_status_type') THEN
    CREATE TYPE job_readiness_status_type AS ENUM ('off_track', 'at_risk', 'on_track', 'ready');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_sync_status_type') THEN
    CREATE TYPE job_sync_status_type AS ENUM ('clean', 'pending', 'warning', 'error');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_risk_status_type') THEN
    CREATE TYPE job_risk_status_type AS ENUM ('none', 'low', 'medium', 'high', 'critical');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_priority_level') THEN
    CREATE TYPE job_priority_level AS ENUM ('low', 'normal', 'high', 'urgent');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_watch_flag_status_type') THEN
    CREATE TYPE job_watch_flag_status_type AS ENUM ('open', 'acknowledged', 'resolved', 'dismissed');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_watch_flag_severity_type') THEN
    CREATE TYPE job_watch_flag_severity_type AS ENUM ('low', 'medium', 'high', 'critical');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_assignment_status_type') THEN
    CREATE TYPE job_assignment_status_type AS ENUM ('assigned', 'confirmed', 'checked_in', 'checked_out', 'absent', 'cancelled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_attachment_entity_type') THEN
    CREATE TYPE job_attachment_entity_type AS ENUM ('job', 'job_day', 'production_item');
  END IF;
END $$;

CREATE SEQUENCE IF NOT EXISTS job_truth_number_seq START WITH 1000;

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  legacy_shoot_id uuid UNIQUE REFERENCES shoot(id) ON DELETE SET NULL,
  job_number text,
  department_type job_department_type NOT NULL,
  job_category job_category_type NOT NULL DEFAULT 'other',
  organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  primary_location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  primary_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  account_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  title text NOT NULL,
  event_name text,
  description_internal text,
  job_status job_status_type NOT NULL DEFAULT 'draft',
  production_status job_production_status_type NOT NULL DEFAULT 'not_created',
  staffing_status job_staffing_status_type NOT NULL DEFAULT 'unassigned',
  readiness_status job_readiness_status_type NOT NULL DEFAULT 'at_risk',
  sync_status job_sync_status_type NOT NULL DEFAULT 'clean',
  risk_status job_risk_status_type NOT NULL DEFAULT 'none',
  priority_level job_priority_level NOT NULL DEFAULT 'normal',
  delivery_type text,
  gallery_type text,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  timezone text NOT NULL DEFAULT 'America/Chicago',
  estimated_subject_count integer,
  actual_subject_count integer,
  estimated_staff_count integer,
  actual_staff_count integer,
  client_deadline_at timestamptz,
  production_deadline_at timestamptz,
  published_at timestamptz,
  archived_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  production_required boolean NOT NULL DEFAULT true,
  location_override_note text,
  contact_override_note text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (scheduled_end_at IS NULL OR scheduled_start_at IS NULL OR scheduled_end_at > scheduled_start_at),
  CHECK (estimated_subject_count IS NULL OR estimated_subject_count >= 0),
  CHECK (actual_subject_count IS NULL OR actual_subject_count >= 0),
  CHECK (estimated_staff_count IS NULL OR estimated_staff_count >= 0),
  CHECK (actual_staff_count IS NULL OR actual_staff_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_tenant_job_number_uq
  ON jobs (tenant_id, job_number)
  WHERE job_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS jobs_tenant_department_schedule_idx
  ON jobs (tenant_id, department_type, scheduled_start_at, created_at DESC);

CREATE INDEX IF NOT EXISTS jobs_tenant_organization_schedule_idx
  ON jobs (tenant_id, organization_id, scheduled_start_at, created_at DESC)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS jobs_tenant_status_schedule_idx
  ON jobs (tenant_id, job_status, readiness_status, scheduled_start_at, created_at DESC);

CREATE INDEX IF NOT EXISTS jobs_tenant_owner_idx
  ON jobs (tenant_id, account_owner_user_id, scheduled_start_at, created_at DESC)
  WHERE account_owner_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS job_legacy_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  legacy_table text NOT NULL,
  legacy_record_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, legacy_table, legacy_record_id),
  UNIQUE (tenant_id, job_id, legacy_table)
);

CREATE TABLE IF NOT EXISTS school_job_profiles (
  job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  school_type text,
  district_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  school_year text,
  grade_scope text,
  roster_source text,
  id_cards_required boolean NOT NULL DEFAULT false,
  yearbook_required boolean NOT NULL DEFAULT false,
  composite_required boolean NOT NULL DEFAULT false,
  admin_portal_required boolean NOT NULL DEFAULT false,
  submission_deadline timestamptz,
  advisor_sorting_required boolean NOT NULL DEFAULT false,
  homeroom_sorting_required boolean NOT NULL DEFAULT false,
  data_import_mode text,
  special_instructions text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sports_job_profiles (
  job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  sport_type text,
  season text,
  league_name text,
  division text,
  team_structure text,
  proof_required boolean NOT NULL DEFAULT false,
  approval_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  billing_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  revenue_share_enabled boolean NOT NULL DEFAULT false,
  revenue_share_terms_summary text,
  banner_work_required boolean NOT NULL DEFAULT false,
  specialty_products_required boolean NOT NULL DEFAULT false,
  buddy_photos_required boolean NOT NULL DEFAULT false,
  sponsor_graphics_required boolean NOT NULL DEFAULT false,
  client_expectations_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  legacy_shoot_day_id uuid UNIQUE REFERENCES shoot_day(id) ON DELETE SET NULL,
  day_label text,
  date date NOT NULL,
  start_time time,
  end_time time,
  timezone text NOT NULL DEFAULT 'America/Chicago',
  location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  onsite_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  lead_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  day_status job_day_status_type NOT NULL DEFAULT 'scheduled',
  weather_sensitive boolean NOT NULL DEFAULT false,
  indoor_outdoor text,
  access_notes text,
  parking_notes text,
  setup_notes text,
  travel_notes text,
  check_in_window_start timestamptz,
  check_in_window_end timestamptz,
  ready_confirmed_at timestamptz,
  ready_confirmed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time IS NULL OR start_time IS NULL OR end_time > start_time)
);

CREATE INDEX IF NOT EXISTS job_days_tenant_job_date_idx
  ON job_days (tenant_id, job_id, date, created_at);

CREATE INDEX IF NOT EXISTS job_days_tenant_lead_idx
  ON job_days (tenant_id, lead_user_id, date)
  WHERE lead_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS job_staff_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  job_day_id uuid REFERENCES job_days(id) ON DELETE CASCADE,
  legacy_shoot_assignment_id uuid REFERENCES shoot_assignment(id) ON DELETE SET NULL,
  legacy_work_shift_id uuid REFERENCES work_shift(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  assignment_role text NOT NULL,
  assignment_status job_assignment_status_type NOT NULL DEFAULT 'assigned',
  is_lead boolean NOT NULL DEFAULT false,
  check_in_at timestamptz,
  check_out_at timestamptz,
  is_ready_present boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_staff_assignments_tenant_job_idx
  ON job_staff_assignments (tenant_id, job_id, assignment_status, is_lead, created_at DESC);

CREATE INDEX IF NOT EXISTS job_staff_assignments_tenant_day_idx
  ON job_staff_assignments (tenant_id, job_day_id, assignment_status, created_at DESC)
  WHERE job_day_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS job_staff_assignments_tenant_user_idx
  ON job_staff_assignments (tenant_id, user_id, assignment_status, created_at DESC);

CREATE TABLE IF NOT EXISTS job_readiness_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  job_day_id uuid REFERENCES job_days(id) ON DELETE CASCADE,
  legacy_shoot_readiness_item_id uuid UNIQUE REFERENCES shoot_readiness_item(id) ON DELETE SET NULL,
  section_key text NOT NULL,
  label text NOT NULL,
  description text,
  is_required boolean NOT NULL DEFAULT true,
  is_blocker boolean NOT NULL DEFAULT false,
  is_complete boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  completed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  due_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  source_template_key text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sort_order >= 0)
);

CREATE INDEX IF NOT EXISTS job_readiness_items_tenant_job_lookup_idx
  ON job_readiness_items (tenant_id, job_id, is_blocker, is_complete, due_at, sort_order);

CREATE TABLE IF NOT EXISTS production_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  job_day_id uuid REFERENCES job_days(id) ON DELETE SET NULL,
  legacy_production_project_id uuid UNIQUE REFERENCES production_project(id) ON DELETE SET NULL,
  production_group_key text NOT NULL,
  title text NOT NULL,
  production_type text NOT NULL,
  status job_production_status_type NOT NULL DEFAULT 'queued',
  priority job_priority_level NOT NULL DEFAULT 'normal',
  assigned_to_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  approval_required boolean NOT NULL DEFAULT false,
  proof_required boolean NOT NULL DEFAULT false,
  due_at timestamptz,
  delivery_deadline_at timestamptz,
  file_count_expected integer,
  file_count_received integer,
  vendor_name text,
  blocked_reason text,
  qa_status text NOT NULL DEFAULT 'not_started',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (file_count_expected IS NULL OR file_count_expected >= 0),
  CHECK (file_count_received IS NULL OR file_count_received >= 0)
);

CREATE INDEX IF NOT EXISTS production_items_tenant_status_due_idx
  ON production_items (tenant_id, status, due_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS production_items_tenant_job_idx
  ON production_items (tenant_id, job_id, status, due_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS job_watch_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  job_day_id uuid REFERENCES job_days(id) ON DELETE CASCADE,
  production_item_id uuid REFERENCES production_items(id) ON DELETE CASCADE,
  legacy_shoot_watch_flag_id uuid UNIQUE REFERENCES shoot_watch_flag(id) ON DELETE SET NULL,
  severity job_watch_flag_severity_type NOT NULL,
  flag_type text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status job_watch_flag_status_type NOT NULL DEFAULT 'open',
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  auto_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_watch_flags_tenant_status_due_idx
  ON job_watch_flags (tenant_id, status, due_at, severity, created_at DESC);

CREATE INDEX IF NOT EXISTS job_watch_flags_tenant_job_idx
  ON job_watch_flags (tenant_id, job_id, status, severity, created_at DESC);

CREATE TABLE IF NOT EXISTS job_attachment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  entity_type job_attachment_entity_type NOT NULL,
  job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
  job_day_id uuid REFERENCES job_days(id) ON DELETE CASCADE,
  production_item_id uuid REFERENCES production_items(id) ON DELETE CASCADE,
  media_asset_id uuid REFERENCES media_asset(id) ON DELETE CASCADE,
  label text,
  attachment_type text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (CASE WHEN job_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN job_day_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN production_item_id IS NULL THEN 0 ELSE 1 END) = 1
  )
);

CREATE INDEX IF NOT EXISTS job_attachment_links_tenant_entity_idx
  ON job_attachment_links (tenant_id, entity_type, created_at DESC);

CREATE TABLE IF NOT EXISTS activity_log_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
  job_day_id uuid REFERENCES job_days(id) ON DELETE CASCADE,
  production_item_id uuid REFERENCES production_items(id) ON DELETE CASCADE,
  watch_flag_id uuid REFERENCES job_watch_flags(id) ON DELETE CASCADE,
  legacy_shoot_activity_log_id uuid UNIQUE REFERENCES shoot_activity_log(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_log_entries_tenant_job_idx
  ON activity_log_entries (tenant_id, job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS activity_log_entries_tenant_actor_idx
  ON activity_log_entries (tenant_id, actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

WITH base_jobs AS (
  SELECT
    s.id AS job_id,
    s.tenant_id,
    s.id AS legacy_shoot_id,
    s.job_number,
    CASE
      WHEN s.department = 'schools'::department_code THEN 'schools'::job_department_type
      WHEN s.department = 'sports'::department_code THEN 'sports'::job_department_type
      WHEN s.department = 'office'::department_code THEN 'corporate'::job_department_type
      ELSE 'other'::job_department_type
    END AS department_type,
    CASE
      WHEN COALESCE(lower(s.shoot_subtype), '') LIKE '%makeup%' THEN 'makeup_day'::job_category_type
      WHEN COALESCE(lower(s.shoot_subtype), '') LIKE '%reshoot%' THEN 'reshoot'::job_category_type
      WHEN COALESCE(lower(s.shoot_subtype), '') LIKE '%media%' THEN 'media_day'::job_category_type
      WHEN COALESCE(lower(s.shoot_subtype), '') LIKE '%banner%' THEN 'banner_day'::job_category_type
      WHEN s.delivery_type = 'ship_to_home'::shoot_delivery_type AND s.production_required = false THEN 'delivery_only'::job_category_type
      ELSE 'photo_day'::job_category_type
    END AS job_category,
    s.organization_id,
    s.location_id AS primary_location_id,
    s.primary_contact_id,
    s.account_owner_user_id,
    s.title,
    CASE WHEN s.department = 'sports'::department_code THEN s.title ELSE NULL END AS event_name,
    s.internal_notes AS description_internal,
    CASE
      WHEN s.deleted_at IS NOT NULL OR s.record_state = 'archived'::shoot_record_state THEN 'archived'::job_status_type
      WHEN s.record_state = 'cancelled'::shoot_record_state OR s.status = 'CANCELLED'::shoot_status THEN 'cancelled'::job_status_type
      WHEN s.status = 'ON_HOLD'::shoot_status THEN 'postponed'::job_status_type
      WHEN s.record_state = 'draft'::shoot_record_state THEN 'draft'::job_status_type
      WHEN s.status IN ('LIVE'::shoot_status, 'SHOOT_COMPLETE'::shoot_status) THEN 'in_progress'::job_status_type
      WHEN s.status IN ('POST_PRODUCTION'::shoot_status, 'COMPLETE'::shoot_status) THEN 'execution_complete'::job_status_type
      WHEN s.readiness_status = 'blocked'::shoot_readiness_status THEN 'intake_blocked'::job_status_type
      WHEN s.job_status = 'new'::shoot_job_status THEN 'pending_confirmation'::job_status_type
      WHEN s.job_status = 'confirmed'::shoot_job_status THEN 'confirmed'::job_status_type
      WHEN s.job_status = 'scheduled'::shoot_job_status THEN 'ready_to_staff'::job_status_type
      WHEN s.job_status = 'in_progress'::shoot_job_status THEN 'in_progress'::job_status_type
      ELSE 'confirmed'::job_status_type
    END AS job_status,
    CASE
      WHEN COALESCE(prod.blocked_count, 0) > 0 THEN 'blocked'::job_production_status_type
      WHEN COALESCE(prod.awaiting_approval_count, 0) > 0 THEN 'awaiting_approval'::job_production_status_type
      WHEN COALESCE(prod.complete_count, 0) > 0 AND COALESCE(prod.total_count, 0) = COALESCE(prod.complete_count, 0) THEN 'complete'::job_production_status_type
      WHEN COALESCE(prod.active_count, 0) > 0 THEN 'editing'::job_production_status_type
      WHEN s.production_required THEN 'queued'::job_production_status_type
      ELSE 'not_created'::job_production_status_type
    END AS production_status,
    CASE
      WHEN COALESCE(staff.ready_confirmed_count, 0) > 0 THEN 'ready_confirmed'::job_staffing_status_type
      WHEN COALESCE(staff.checked_in_count, 0) > 0 THEN 'checked_in'::job_staffing_status_type
      WHEN COALESCE(staff.assigned_count, 0) = 0 THEN 'unassigned'::job_staffing_status_type
      WHEN COALESCE(staff.required_count, 0) > 0 AND COALESCE(staff.assigned_count, 0) < COALESCE(staff.required_count, 0) THEN 'partially_staffed'::job_staffing_status_type
      WHEN COALESCE(staff.required_count, 0) > 0 THEN 'staffed'::job_staffing_status_type
      ELSE 'unassigned'::job_staffing_status_type
    END AS staffing_status,
    CASE
      WHEN s.readiness_status = 'ready'::shoot_readiness_status THEN 'ready'::job_readiness_status_type
      WHEN s.readiness_status = 'blocked'::shoot_readiness_status THEN 'off_track'::job_readiness_status_type
      ELSE 'at_risk'::job_readiness_status_type
    END AS readiness_status,
    'clean'::job_sync_status_type AS sync_status,
    CASE
      WHEN COALESCE(watch.highest_severity, '') = 'critical' THEN 'critical'::job_risk_status_type
      WHEN COALESCE(watch.highest_severity, '') = 'high' THEN 'high'::job_risk_status_type
      WHEN COALESCE(watch.highest_severity, '') = 'medium' THEN 'medium'::job_risk_status_type
      WHEN COALESCE(watch.highest_severity, '') = 'low' THEN 'low'::job_risk_status_type
      ELSE 'none'::job_risk_status_type
    END AS risk_status,
    CASE s.job_priority
      WHEN 'low'::shoot_job_priority THEN 'low'::job_priority_level
      WHEN 'high'::shoot_job_priority THEN 'high'::job_priority_level
      WHEN 'urgent'::shoot_job_priority THEN 'urgent'::job_priority_level
      ELSE 'normal'::job_priority_level
    END AS priority_level,
    s.delivery_type::text AS delivery_type,
    CASE
      WHEN COALESCE(ssd.gallery_required, false) THEN 'team_and_individual'
      ELSE NULL
    END AS gallery_type,
    s.start_time AS scheduled_start_at,
    s.end_time_est AS scheduled_end_at,
    COALESCE(NULLIF(trim(s.time_zone), ''), 'America/Chicago') AS timezone,
    COALESCE(NULLIF(s.projected_students, 0), NULLIF(ssd.athlete_count_estimate, 0), NULLIF(sch.student_count_estimate, 0)) AS estimated_subject_count,
    NULL::integer AS actual_subject_count,
    COALESCE(NULLIF(s.staffing_estimate, 0), NULLIF(s.planned_staff_count, 0), NULLIF(s.minimum_staff_count, 0)) AS estimated_staff_count,
    NULL::integer AS actual_staff_count,
    CASE WHEN s.delivery_due_date IS NULL THEN NULL ELSE s.delivery_due_date::timestamp AT TIME ZONE COALESCE(NULLIF(trim(s.time_zone), ''), 'America/Chicago') END AS client_deadline_at,
    CASE WHEN s.delivery_due_date IS NULL THEN NULL ELSE s.delivery_due_date::timestamp AT TIME ZONE COALESCE(NULLIF(trim(s.time_zone), ''), 'America/Chicago') END AS production_deadline_at,
    s.published_at,
    s.deleted_at AS archived_at,
    CASE WHEN s.record_state = 'cancelled'::shoot_record_state OR s.status = 'CANCELLED'::shoot_status THEN COALESCE(s.updated_at, s.created_at) ELSE NULL END AS cancelled_at,
    NULL::text AS cancel_reason,
    s.production_required,
    NULL::text AS location_override_note,
    NULL::text AS contact_override_note,
    s.created_by AS created_by_user_id,
    s.updated_by_user_id,
    s.created_at,
    s.updated_at
  FROM shoot s
  LEFT JOIN shoot_school_detail sch
    ON sch.tenant_id = s.tenant_id
   AND sch.shoot_id = s.id
  LEFT JOIN shoot_sports_detail ssd
    ON ssd.tenant_id = s.tenant_id
   AND ssd.shoot_id = s.id
  LEFT JOIN (
    SELECT
      linked_shoot_id,
      tenant_id,
      count(*) AS total_count,
      count(*) FILTER (WHERE status = 'blocked'::production_project_status) AS blocked_count,
      count(*) FILTER (WHERE status IN ('active'::production_project_status, 'waiting'::production_project_status)) AS active_count,
      count(*) FILTER (WHERE status = 'completed'::production_project_status) AS complete_count,
      count(*) FILTER (WHERE status = 'waiting'::production_project_status) AS awaiting_approval_count
    FROM production_project
    WHERE linked_shoot_id IS NOT NULL
    GROUP BY tenant_id, linked_shoot_id
  ) prod
    ON prod.tenant_id = s.tenant_id
   AND prod.linked_shoot_id = s.id
  LEFT JOIN (
    SELECT
      sa.shoot_id,
      sa.tenant_id,
      count(*) AS assigned_count,
      count(*) FILTER (WHERE sh.lead_confirmed_ready) AS ready_confirmed_count,
      count(*) FILTER (WHERE te.clock_in_at IS NOT NULL AND te.clock_out_at IS NULL) AS checked_in_count,
      max(COALESCE(st.minimum_count, sh.minimum_staff_count, sh.planned_staff_count, 0)) AS required_count
    FROM shoot_assignment sa
    JOIN shoot sh
      ON sh.tenant_id = sa.tenant_id
     AND sh.id = sa.shoot_id
    LEFT JOIN shoot_staffing_requirement st
      ON st.tenant_id = sa.tenant_id
     AND st.shoot_id = sa.shoot_id
    LEFT JOIN time_entry te
      ON te.tenant_id = sa.tenant_id
     AND te.shoot_id = sa.shoot_id
     AND te.user_id = sa.user_id
    GROUP BY sa.tenant_id, sa.shoot_id
  ) staff
    ON staff.tenant_id = s.tenant_id
   AND staff.shoot_id = s.id
  LEFT JOIN (
    SELECT
      tenant_id,
      shoot_id,
      max(severity) AS highest_severity
    FROM shoot_watch_flag
    WHERE status <> 'resolved'
    GROUP BY tenant_id, shoot_id
  ) watch
    ON watch.tenant_id = s.tenant_id
   AND watch.shoot_id = s.id
)
INSERT INTO jobs (
  id,
  tenant_id,
  legacy_shoot_id,
  job_number,
  department_type,
  job_category,
  organization_id,
  primary_location_id,
  primary_contact_id,
  account_owner_user_id,
  title,
  event_name,
  description_internal,
  job_status,
  production_status,
  staffing_status,
  readiness_status,
  sync_status,
  risk_status,
  priority_level,
  delivery_type,
  gallery_type,
  scheduled_start_at,
  scheduled_end_at,
  timezone,
  estimated_subject_count,
  actual_subject_count,
  estimated_staff_count,
  actual_staff_count,
  client_deadline_at,
  production_deadline_at,
  published_at,
  archived_at,
  cancelled_at,
  cancel_reason,
  production_required,
  location_override_note,
  contact_override_note,
  created_by_user_id,
  updated_by_user_id,
  created_at,
  updated_at
)
SELECT
  b.job_id,
  b.tenant_id,
  b.legacy_shoot_id,
  b.job_number,
  b.department_type,
  b.job_category,
  b.organization_id,
  b.primary_location_id,
  b.primary_contact_id,
  b.account_owner_user_id,
  b.title,
  b.event_name,
  b.description_internal,
  b.job_status,
  b.production_status,
  b.staffing_status,
  b.readiness_status,
  b.sync_status,
  b.risk_status,
  b.priority_level,
  b.delivery_type,
  b.gallery_type,
  b.scheduled_start_at,
  b.scheduled_end_at,
  b.timezone,
  b.estimated_subject_count,
  b.actual_subject_count,
  b.estimated_staff_count,
  b.actual_staff_count,
  b.client_deadline_at,
  b.production_deadline_at,
  b.published_at,
  b.archived_at,
  b.cancelled_at,
  b.cancel_reason,
  b.production_required,
  b.location_override_note,
  b.contact_override_note,
  b.created_by_user_id,
  b.updated_by_user_id,
  b.created_at,
  b.updated_at
FROM base_jobs b
WHERE NOT EXISTS (
  SELECT 1
  FROM jobs j
  WHERE j.id = b.job_id
     OR j.legacy_shoot_id = b.legacy_shoot_id
);

INSERT INTO job_legacy_mapping (tenant_id, job_id, legacy_table, legacy_record_id)
SELECT j.tenant_id, j.id, 'shoot', j.legacy_shoot_id
FROM jobs j
WHERE j.legacy_shoot_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM job_legacy_mapping mapping
    WHERE mapping.tenant_id = j.tenant_id
      AND mapping.legacy_table = 'shoot'
      AND mapping.legacy_record_id = j.legacy_shoot_id
  );

INSERT INTO school_job_profiles (
  job_id,
  tenant_id,
  school_type,
  school_year,
  grade_scope,
  roster_source,
  id_cards_required,
  yearbook_required,
  composite_required,
  admin_portal_required,
  submission_deadline,
  advisor_sorting_required,
  homeroom_sorting_required,
  data_import_mode,
  special_instructions,
  created_at,
  updated_at
)
SELECT
  j.id,
  j.tenant_id,
  detail.school_type,
  NULL::text,
  detail.grade_range,
  detail.roster_status,
  detail.id_required,
  detail.yearbook_required,
  false,
  false,
  CASE WHEN detail.yearbook_due_date IS NULL THEN NULL ELSE detail.yearbook_due_date::timestamp AT TIME ZONE j.timezone END,
  detail.id_sort_method IS NOT NULL,
  false,
  NULL::text,
  concat_ws(E'\n', detail.background_requirements, detail.building_instructions, detail.school_day_notes, detail.photo_day_special_notes),
  detail.created_at,
  detail.updated_at
FROM shoot_school_detail detail
JOIN jobs j
  ON j.tenant_id = detail.tenant_id
 AND j.legacy_shoot_id = detail.shoot_id
WHERE NOT EXISTS (
  SELECT 1
  FROM school_job_profiles existing
  WHERE existing.job_id = j.id
);

INSERT INTO sports_job_profiles (
  job_id,
  tenant_id,
  sport_type,
  season,
  league_name,
  division,
  team_structure,
  proof_required,
  approval_contact_id,
  billing_contact_id,
  revenue_share_enabled,
  revenue_share_terms_summary,
  banner_work_required,
  specialty_products_required,
  buddy_photos_required,
  sponsor_graphics_required,
  client_expectations_notes,
  created_at,
  updated_at
)
SELECT
  j.id,
  j.tenant_id,
  detail.sport_name,
  detail.season,
  detail.league_name,
  detail.division,
  detail.team_structure,
  detail.proof_required,
  detail.approval_contact_id,
  detail.billing_contact_id,
  detail.revenue_share_enabled,
  detail.revenue_share_terms_summary,
  detail.banner_work_required,
  detail.specialty_products_required,
  detail.buddy_photo_required,
  detail.sponsor_graphics_required,
  detail.client_expectations_notes,
  detail.created_at,
  detail.updated_at
FROM shoot_sports_detail detail
JOIN jobs j
  ON j.tenant_id = detail.tenant_id
 AND j.legacy_shoot_id = detail.shoot_id
WHERE NOT EXISTS (
  SELECT 1
  FROM sports_job_profiles existing
  WHERE existing.job_id = j.id
);

INSERT INTO job_days (
  tenant_id,
  job_id,
  legacy_shoot_day_id,
  day_label,
  date,
  start_time,
  end_time,
  timezone,
  location_id,
  lead_user_id,
  day_status,
  created_at,
  updated_at
)
SELECT
  day_row.tenant_id,
  job_row.id,
  day_row.id,
  CASE
    WHEN day_row.day_index = 0 THEN 'Primary day'
    ELSE concat('Day ', day_row.day_index + 1)
  END,
  day_row.shoot_date,
  day_row.start_time,
  day_row.end_time,
  COALESCE(NULLIF(trim(day_row.time_zone), ''), job_row.timezone),
  COALESCE(day_row.location_id, job_row.primary_location_id),
  lead_assignment.user_id,
  CASE
    WHEN job_row.job_status = 'cancelled'::job_status_type THEN 'cancelled'::job_day_status_type
    WHEN job_row.job_status = 'execution_complete'::job_status_type THEN 'complete'::job_day_status_type
    WHEN job_row.job_status = 'in_progress'::job_status_type THEN 'in_progress'::job_day_status_type
    WHEN job_row.job_status = 'ready_to_execute'::job_status_type THEN 'ready'::job_day_status_type
    ELSE 'scheduled'::job_day_status_type
  END,
  day_row.created_at,
  day_row.updated_at
FROM shoot_day day_row
JOIN jobs job_row
  ON job_row.tenant_id = day_row.tenant_id
 AND job_row.legacy_shoot_id = day_row.shoot_id
LEFT JOIN LATERAL (
  SELECT sa.user_id
  FROM shoot_assignment sa
  WHERE sa.tenant_id = day_row.tenant_id
    AND sa.shoot_id = day_row.shoot_id
    AND sa.is_primary = true
  ORDER BY sa.created_at ASC
  LIMIT 1
) lead_assignment ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM job_days existing
  WHERE existing.legacy_shoot_day_id = day_row.id
);

INSERT INTO job_days (
  tenant_id,
  job_id,
  day_label,
  date,
  start_time,
  end_time,
  timezone,
  location_id,
  lead_user_id,
  day_status,
  created_at,
  updated_at
)
SELECT
  j.tenant_id,
  j.id,
  'Primary day',
  s.shoot_date,
  s.start_time::time,
  s.end_time_est::time,
  j.timezone,
  j.primary_location_id,
  lead_assignment.user_id,
  CASE
    WHEN j.job_status = 'cancelled'::job_status_type THEN 'cancelled'::job_day_status_type
    WHEN j.job_status = 'execution_complete'::job_status_type THEN 'complete'::job_day_status_type
    WHEN j.job_status = 'in_progress'::job_status_type THEN 'in_progress'::job_day_status_type
    WHEN j.job_status = 'ready_to_execute'::job_status_type THEN 'ready'::job_day_status_type
    ELSE 'scheduled'::job_day_status_type
  END,
  j.created_at,
  j.updated_at
FROM jobs j
JOIN shoot s
  ON s.tenant_id = j.tenant_id
 AND s.id = j.legacy_shoot_id
LEFT JOIN LATERAL (
  SELECT sa.user_id
  FROM shoot_assignment sa
  WHERE sa.tenant_id = j.tenant_id
    AND sa.shoot_id = j.legacy_shoot_id
    AND sa.is_primary = true
  ORDER BY sa.created_at ASC
  LIMIT 1
) lead_assignment ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM job_days day_row
  WHERE day_row.job_id = j.id
)
  AND s.shoot_date IS NOT NULL;

INSERT INTO job_staff_assignments (
  tenant_id,
  job_id,
  legacy_shoot_assignment_id,
  user_id,
  assignment_role,
  assignment_status,
  is_lead,
  notes,
  created_at,
  updated_at
)
SELECT
  assignment.tenant_id,
  job_row.id,
  assignment.id,
  assignment.user_id,
  CASE WHEN assignment.is_primary THEN 'lead_photographer' ELSE 'photographer' END,
  'assigned'::job_assignment_status_type,
  assignment.is_primary,
  NULL::text,
  assignment.created_at,
  assignment.created_at
FROM shoot_assignment assignment
JOIN jobs job_row
  ON job_row.tenant_id = assignment.tenant_id
 AND job_row.legacy_shoot_id = assignment.shoot_id
WHERE NOT EXISTS (
  SELECT 1
  FROM job_staff_assignments existing
  WHERE existing.legacy_shoot_assignment_id = assignment.id
);

INSERT INTO job_readiness_items (
  tenant_id,
  job_id,
  legacy_shoot_readiness_item_id,
  section_key,
  label,
  description,
  is_required,
  is_blocker,
  is_complete,
  completed_at,
  completed_by_user_id,
  due_at,
  sort_order,
  source_template_key,
  notes,
  created_at,
  updated_at
)
SELECT
  item.tenant_id,
  job_row.id,
  item.id,
  COALESCE(NULLIF(trim(item.section), ''), 'general'),
  item.label,
  item.detail,
  true,
  item.blocking,
  item.status = 'resolved'::shoot_readiness_item_status,
  CASE WHEN item.status = 'resolved'::shoot_readiness_item_status THEN item.created_at ELSE NULL END,
  item.completed_by_user_id,
  NULL::timestamptz,
  item.sort_order,
  item.code,
  item.detail,
  item.created_at,
  item.created_at
FROM shoot_readiness_item item
JOIN jobs job_row
  ON job_row.tenant_id = item.tenant_id
 AND job_row.legacy_shoot_id = item.shoot_id
WHERE NOT EXISTS (
  SELECT 1
  FROM job_readiness_items existing
  WHERE existing.legacy_shoot_readiness_item_id = item.id
);

INSERT INTO production_items (
  tenant_id,
  job_id,
  legacy_production_project_id,
  production_group_key,
  title,
  production_type,
  status,
  priority,
  assigned_to_user_id,
  approval_required,
  proof_required,
  due_at,
  delivery_deadline_at,
  file_count_expected,
  file_count_received,
  vendor_name,
  blocked_reason,
  qa_status,
  created_at,
  updated_at
)
SELECT
  project.tenant_id,
  job_row.id,
  project.id,
  COALESCE(project.source_trigger_key, project.source_event_key, project.id::text),
  project.title,
  COALESCE(project.source_trigger_label, project.source_trigger_key, 'general_production'),
  CASE
    WHEN project.status = 'blocked'::production_project_status THEN 'blocked'::job_production_status_type
    WHEN project.status = 'completed'::production_project_status THEN 'complete'::job_production_status_type
    WHEN project.status = 'waiting'::production_project_status THEN 'awaiting_approval'::job_production_status_type
    WHEN project.status = 'active'::production_project_status THEN 'editing'::job_production_status_type
    ELSE 'queued'::job_production_status_type
  END,
  CASE project.priority
    WHEN 'low'::production_project_priority THEN 'low'::job_priority_level
    WHEN 'high'::production_project_priority THEN 'high'::job_priority_level
    WHEN 'critical'::production_project_priority THEN 'urgent'::job_priority_level
    ELSE 'normal'::job_priority_level
  END,
  project.owner_user_id,
  false,
  false,
  CASE WHEN project.due_date IS NULL THEN NULL ELSE project.due_date::timestamp AT TIME ZONE job_row.timezone END,
  CASE WHEN project.follow_up_date IS NULL THEN NULL ELSE project.follow_up_date::timestamp AT TIME ZONE job_row.timezone END,
  NULL::integer,
  NULL::integer,
  NULL::text,
  NULL::text,
  CASE WHEN project.status = 'completed'::production_project_status THEN 'passed' ELSE 'not_started' END,
  project.created_at,
  project.updated_at
FROM production_project project
JOIN jobs job_row
  ON job_row.tenant_id = project.tenant_id
 AND job_row.legacy_shoot_id = project.linked_shoot_id
WHERE project.linked_shoot_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM production_items existing
    WHERE existing.legacy_production_project_id = project.id
  );

INSERT INTO job_watch_flags (
  tenant_id,
  job_id,
  legacy_shoot_watch_flag_id,
  severity,
  flag_type,
  title,
  description,
  status,
  owner_user_id,
  due_at,
  resolved_at,
  resolved_by_user_id,
  created_at
)
SELECT
  flag.tenant_id,
  job_row.id,
  flag.id,
  CASE
    WHEN lower(flag.severity) = 'critical' THEN 'critical'::job_watch_flag_severity_type
    WHEN lower(flag.severity) = 'high' THEN 'high'::job_watch_flag_severity_type
    WHEN lower(flag.severity) = 'medium' THEN 'medium'::job_watch_flag_severity_type
    ELSE 'low'::job_watch_flag_severity_type
  END,
  flag.flag_type,
  flag.title,
  COALESCE(flag.description, ''),
  CASE
    WHEN lower(flag.status) = 'resolved' THEN 'resolved'::job_watch_flag_status_type
    WHEN lower(flag.status) = 'acknowledged' THEN 'acknowledged'::job_watch_flag_status_type
    WHEN lower(flag.status) = 'dismissed' THEN 'dismissed'::job_watch_flag_status_type
    ELSE 'open'::job_watch_flag_status_type
  END,
  flag.owner_user_id,
  flag.due_at,
  flag.resolved_at,
  flag.resolved_by_user_id,
  flag.created_at
FROM shoot_watch_flag flag
JOIN jobs job_row
  ON job_row.tenant_id = flag.tenant_id
 AND job_row.legacy_shoot_id = flag.shoot_id
WHERE NOT EXISTS (
  SELECT 1
  FROM job_watch_flags existing
  WHERE existing.legacy_shoot_watch_flag_id = flag.id
);

INSERT INTO job_attachment_links (
  tenant_id,
  entity_type,
  job_id,
  media_asset_id,
  label,
  attachment_type,
  created_by_user_id,
  created_at
)
SELECT
  asset.tenant_id,
  'job'::job_attachment_entity_type,
  job_row.id,
  asset.id,
  asset.kind,
  asset.kind,
  asset.user_id,
  asset.created_at
FROM media_asset asset
JOIN jobs job_row
  ON job_row.tenant_id = asset.tenant_id
 AND job_row.legacy_shoot_id = asset.shoot_id
WHERE NOT EXISTS (
  SELECT 1
  FROM job_attachment_links existing
  WHERE existing.media_asset_id = asset.id
);

INSERT INTO activity_log_entries (
  tenant_id,
  job_id,
  legacy_shoot_activity_log_id,
  actor_user_id,
  event_type,
  summary,
  metadata,
  created_at
)
SELECT
  activity.tenant_id,
  job_row.id,
  activity.id,
  activity.actor_user_id,
  activity.event_type,
  concat_ws(' ', initcap(replace(activity.event_type, '_', ' ')), 'recorded'),
  activity.payload,
  activity.created_at
FROM shoot_activity_log activity
JOIN jobs job_row
  ON job_row.tenant_id = activity.tenant_id
 AND job_row.legacy_shoot_id = activity.shoot_id
WHERE NOT EXISTS (
  SELECT 1
  FROM activity_log_entries existing
  WHERE existing.legacy_shoot_activity_log_id = activity.id
);

DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'jobs',
    'job_legacy_mapping',
    'school_job_profiles',
    'sports_job_profiles',
    'job_days',
    'job_staff_assignments',
    'job_readiness_items',
    'production_items',
    'job_watch_flags',
    'job_attachment_links',
    'activity_log_entries'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    policy_name := 'tenant_isolation_' || table_name;
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      policy_name,
      table_name
    );
  END LOOP;
END $$;
