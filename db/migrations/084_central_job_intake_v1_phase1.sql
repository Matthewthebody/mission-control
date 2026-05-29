DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shoot_record_state') THEN
    CREATE TYPE shoot_record_state AS ENUM ('draft', 'published', 'cancelled', 'archived');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shoot_job_status') THEN
    CREATE TYPE shoot_job_status AS ENUM (
      'new',
      'confirmed',
      'scheduled',
      'in_progress',
      'in_production',
      'complete',
      'cancelled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shoot_readiness_status') THEN
    CREATE TYPE shoot_readiness_status AS ENUM ('blocked', 'needs_info', 'ready');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shoot_request_source') THEN
    CREATE TYPE shoot_request_source AS ENUM (
      'manual',
      'smart_paste',
      'bulk_import',
      'api',
      'converted_from_inquiry',
      'internal_request'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shoot_job_priority') THEN
    CREATE TYPE shoot_job_priority AS ENUM ('low', 'normal', 'high', 'urgent');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shoot_delivery_type') THEN
    CREATE TYPE shoot_delivery_type AS ENUM (
      'ship_to_home',
      'school_delivery',
      'digital_gallery',
      'specialty_products',
      'mixed'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shoot_production_grouping_rule') THEN
    CREATE TYPE shoot_production_grouping_rule AS ENUM (
      'one_per_job',
      'one_per_day',
      'one_per_delivery',
      'one_per_gallery',
      'manual'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shoot_readiness_item_status') THEN
    CREATE TYPE shoot_readiness_item_status AS ENUM ('pending', 'resolved', 'waived');
  END IF;
END $$;

ALTER TABLE shoot
  ADD COLUMN IF NOT EXISTS job_number text,
  ADD COLUMN IF NOT EXISTS source_reference text,
  ADD COLUMN IF NOT EXISTS record_state shoot_record_state NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS job_status shoot_job_status NOT NULL DEFAULT 'scheduled',
  ADD COLUMN IF NOT EXISTS readiness_status shoot_readiness_status NOT NULL DEFAULT 'needs_info',
  ADD COLUMN IF NOT EXISTS unresolved_organization_name text,
  ADD COLUMN IF NOT EXISTS unresolved_location_name text,
  ADD COLUMN IF NOT EXISTS unresolved_primary_contact_name text,
  ADD COLUMN IF NOT EXISTS account_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'America/Chicago',
  ADD COLUMN IF NOT EXISTS is_multi_day boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_due_date date,
  ADD COLUMN IF NOT EXISTS production_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS staffing_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS staffing_estimate integer,
  ADD COLUMN IF NOT EXISTS job_priority shoot_job_priority NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS delivery_type shoot_delivery_type,
  ADD COLUMN IF NOT EXISTS production_grouping_rule shoot_production_grouping_rule NOT NULL DEFAULT 'one_per_job',
  ADD COLUMN IF NOT EXISTS client_notes text,
  ADD COLUMN IF NOT EXISTS raw_source_text text,
  ADD COLUMN IF NOT EXISTS merge_parent_job_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS duplicate_override_note text,
  ADD COLUMN IF NOT EXISTS duplicate_check_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS published_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shoot_staffing_estimate_nonnegative_chk'
  ) THEN
    ALTER TABLE shoot
      ADD CONSTRAINT shoot_staffing_estimate_nonnegative_chk
      CHECK (staffing_estimate IS NULL OR staffing_estimate >= 0)
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shoot_end_time_est_after_start_time_chk'
  ) THEN
    ALTER TABLE shoot
      ADD CONSTRAINT shoot_end_time_est_after_start_time_chk
      CHECK (end_time_est > start_time)
      NOT VALID;
  END IF;
END $$;

UPDATE shoot
SET
  job_number = COALESCE(job_number, shoot_code),
  record_state = CASE
    WHEN deleted_at IS NOT NULL THEN 'archived'::shoot_record_state
    WHEN status = 'CANCELLED'::shoot_status THEN 'cancelled'::shoot_record_state
    ELSE 'published'::shoot_record_state
  END,
  job_status = CASE
    WHEN status = 'CANCELLED'::shoot_status THEN 'cancelled'::shoot_job_status
    WHEN status = 'COMPLETE'::shoot_status THEN 'complete'::shoot_job_status
    WHEN status = 'POST_PRODUCTION'::shoot_status THEN 'in_production'::shoot_job_status
    WHEN status IN ('LIVE'::shoot_status, 'SHOOT_COMPLETE'::shoot_status) THEN 'in_progress'::shoot_job_status
    WHEN status IN ('CONFIRMED'::shoot_status, 'READY'::shoot_status, 'ON_HOLD'::shoot_status) THEN 'scheduled'::shoot_job_status
    ELSE 'new'::shoot_job_status
  END,
  readiness_status = CASE
    WHEN status IN (
      'READY'::shoot_status,
      'LIVE'::shoot_status,
      'SHOOT_COMPLETE'::shoot_status,
      'POST_PRODUCTION'::shoot_status,
      'COMPLETE'::shoot_status
    ) OR COALESCE(lead_confirmed_ready, false) THEN 'ready'::shoot_readiness_status
    WHEN organization_id IS NULL OR location_id IS NULL OR primary_contact_id IS NULL THEN 'blocked'::shoot_readiness_status
    ELSE 'needs_info'::shoot_readiness_status
  END,
  time_zone = COALESCE(NULLIF(trim(time_zone), ''), 'America/Chicago'),
  production_required = CASE
    WHEN production_required THEN true
    WHEN department IN ('schools'::department_code, 'sports'::department_code, 'production'::department_code) THEN true
    ELSE false
  END,
  staffing_required = COALESCE(staffing_required, true),
  staffing_estimate = COALESCE(staffing_estimate, NULLIF(planned_staff_count, 0)),
  job_priority = CASE
    WHEN operations_priority = 'high_priority' THEN 'urgent'::shoot_job_priority
    WHEN operations_priority = 'elevated' THEN 'high'::shoot_job_priority
    ELSE COALESCE(job_priority, 'normal'::shoot_job_priority)
  END,
  job_owner_user_id = COALESCE(job_owner_user_id, readiness_owner_user_id, created_by),
  updated_by_user_id = COALESCE(updated_by_user_id, status_changed_by_user_id, created_by),
  published_by_user_id = COALESCE(published_by_user_id, created_by),
  published_at = COALESCE(published_at, created_at, updated_at, now())
WHERE job_number IS NULL
   OR record_state IS NULL
   OR job_status IS NULL
   OR readiness_status IS NULL
   OR time_zone IS NULL
   OR published_at IS NULL;

UPDATE shoot AS s
SET account_owner_user_id = sp.primary_internal_owner_user_id
FROM school_profile sp
WHERE s.organization_id = sp.organization_id
  AND s.account_owner_user_id IS NULL
  AND sp.primary_internal_owner_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS shoot_tenant_job_number_uq
  ON shoot (tenant_id, job_number)
  WHERE job_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS shoot_tenant_record_state_idx
  ON shoot (tenant_id, record_state, shoot_date);

CREATE INDEX IF NOT EXISTS shoot_tenant_job_owner_idx
  ON shoot (tenant_id, job_owner_user_id, shoot_date)
  WHERE job_owner_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS shoot_school_detail (
  shoot_id uuid PRIMARY KEY REFERENCES shoot(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  school_job_type text,
  school_type text,
  student_count_estimate integer,
  staff_count_estimate integer,
  grade_range text,
  camera_count_estimate integer,
  roster_status text NOT NULL DEFAULT 'unknown',
  roster_due_date date,
  id_required boolean NOT NULL DEFAULT false,
  id_sort_method text,
  yearbook_required boolean NOT NULL DEFAULT false,
  yearbook_due_date date,
  staff_packages_required boolean NOT NULL DEFAULT false,
  parent_communication_needed boolean NOT NULL DEFAULT false,
  background_requirements text,
  school_day_notes text,
  building_instructions text,
  photo_day_special_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (student_count_estimate IS NULL OR student_count_estimate >= 0),
  CHECK (staff_count_estimate IS NULL OR staff_count_estimate >= 0),
  CHECK (camera_count_estimate IS NULL OR camera_count_estimate >= 0)
);

CREATE TABLE IF NOT EXISTS shoot_sports_detail (
  shoot_id uuid PRIMARY KEY REFERENCES shoot(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  sports_job_type text,
  sport_name text,
  season text,
  level_or_age_group text,
  team_count_estimate integer,
  athlete_count_estimate integer,
  coach_count_estimate integer,
  coach_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  alternate_team_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  specialty_products_required boolean NOT NULL DEFAULT false,
  specialty_product_types text[] NOT NULL DEFAULT '{}'::text[],
  gallery_required boolean NOT NULL DEFAULT false,
  delivery_deadline_type text,
  uniform_notes text,
  sponsor_notes text,
  event_notes text,
  on_site_sales_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (team_count_estimate IS NULL OR team_count_estimate >= 0),
  CHECK (athlete_count_estimate IS NULL OR athlete_count_estimate >= 0),
  CHECK (coach_count_estimate IS NULL OR coach_count_estimate >= 0)
);

CREATE TABLE IF NOT EXISTS shoot_day (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  day_index integer NOT NULL DEFAULT 0,
  shoot_date date NOT NULL,
  start_time time,
  end_time time,
  time_zone text NOT NULL,
  location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, shoot_id, day_index),
  CHECK (day_index >= 0),
  CHECK (start_time IS NULL OR end_time IS NULL OR end_time > start_time)
);

ALTER TABLE shoot_day
  ADD COLUMN IF NOT EXISTS day_index integer,
  ADD COLUMN IF NOT EXISTS shoot_date date,
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time time,
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shoot_day'
      AND column_name = 'service_date'
  ) THEN
    EXECUTE '
      UPDATE shoot_day
      SET shoot_date = COALESCE(shoot_date, service_date)
      WHERE shoot_date IS NULL
        AND service_date IS NOT NULL
    ';
    EXECUTE 'ALTER TABLE shoot_day ALTER COLUMN service_date DROP NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shoot_day'
      AND column_name = 'start_time_local'
  ) THEN
    EXECUTE '
      UPDATE shoot_day
      SET start_time = COALESCE(start_time, start_time_local)
      WHERE start_time IS NULL
        AND start_time_local IS NOT NULL
    ';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shoot_day'
      AND column_name = 'end_time_local'
  ) THEN
    EXECUTE '
      UPDATE shoot_day
      SET end_time = COALESCE(end_time, end_time_local)
      WHERE end_time IS NULL
        AND end_time_local IS NOT NULL
    ';
  END IF;
END $$;

UPDATE shoot_day AS sd
SET location_id = COALESCE(sd.location_id, s.location_id)
FROM shoot AS s
WHERE sd.shoot_id = s.id
  AND sd.location_id IS NULL
  AND s.location_id IS NOT NULL;

WITH ranked_days AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tenant_id, shoot_id
      ORDER BY shoot_date ASC NULLS LAST, created_at ASC, id ASC
    ) - 1 AS normalized_day_index
  FROM shoot_day
)
UPDATE shoot_day AS sd
SET day_index = ranked_days.normalized_day_index
FROM ranked_days
WHERE sd.id = ranked_days.id
  AND sd.day_index IS NULL;

UPDATE shoot_day
SET day_index = 0
WHERE day_index IS NULL;

ALTER TABLE shoot_day
  ALTER COLUMN day_index SET DEFAULT 0,
  ALTER COLUMN day_index SET NOT NULL,
  ALTER COLUMN shoot_date SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shoot_day_day_index_nonnegative_chk'
  ) THEN
    ALTER TABLE shoot_day
      ADD CONSTRAINT shoot_day_day_index_nonnegative_chk
      CHECK (day_index >= 0)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shoot_day_time_order_chk'
  ) THEN
    ALTER TABLE shoot_day
      ADD CONSTRAINT shoot_day_time_order_chk
      CHECK (start_time IS NULL OR end_time IS NULL OR end_time > start_time)
      NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS shoot_readiness_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  blocking boolean NOT NULL DEFAULT true,
  status shoot_readiness_item_status NOT NULL DEFAULT 'pending',
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (tenant_id, shoot_id, code)
);

ALTER TABLE shoot_readiness_item
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS status shoot_readiness_item_status NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shoot_readiness_item'
      AND column_name = 'item_key'
  ) THEN
    EXECUTE '
      UPDATE shoot_readiness_item
      SET code = COALESCE(code, item_key)
      WHERE code IS NULL
        AND item_key IS NOT NULL
    ';
    EXECUTE 'ALTER TABLE shoot_readiness_item ALTER COLUMN item_key DROP NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shoot_readiness_item'
      AND column_name = 'item_label'
  ) THEN
    EXECUTE '
      UPDATE shoot_readiness_item
      SET label = COALESCE(label, item_label)
      WHERE label IS NULL
        AND item_label IS NOT NULL
    ';
    EXECUTE 'ALTER TABLE shoot_readiness_item ALTER COLUMN item_label DROP NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shoot_readiness_item'
      AND column_name = 'state'
  ) THEN
    EXECUTE '
      UPDATE shoot_readiness_item
      SET status = CASE
        WHEN state::text = ''resolved'' THEN ''resolved''::shoot_readiness_item_status
        ELSE ''pending''::shoot_readiness_item_status
      END
      WHERE status IS NULL
         OR status = ''pending''::shoot_readiness_item_status
    ';
  END IF;
END $$;

ALTER TABLE shoot_readiness_item
  ALTER COLUMN code SET NOT NULL,
  ALTER COLUMN label SET NOT NULL;

CREATE TABLE IF NOT EXISTS shoot_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shoot_import_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  department department_code,
  source_filename text NOT NULL,
  source_type text NOT NULL,
  status text NOT NULL,
  mappings jsonb NOT NULL DEFAULT '{}'::jsonb,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shoot_import_row (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  import_session_id uuid NOT NULL REFERENCES shoot_import_session(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload jsonb,
  status text NOT NULL,
  errors jsonb,
  linked_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, import_session_id, row_number),
  CHECK (row_number >= 1)
);

CREATE INDEX IF NOT EXISTS shoot_day_tenant_shoot_date_idx
  ON shoot_day (tenant_id, shoot_id, shoot_date);

CREATE UNIQUE INDEX IF NOT EXISTS shoot_day_tenant_shoot_day_index_uq
  ON shoot_day (tenant_id, shoot_id, day_index);

CREATE INDEX IF NOT EXISTS production_project_tenant_status_due_idx
  ON production_project (tenant_id, status, due_date, created_at DESC);

CREATE INDEX IF NOT EXISTS work_shift_tenant_status_idx
  ON work_shift (tenant_id, status, starts_at);

CREATE INDEX IF NOT EXISTS shoot_readiness_item_lookup_idx
  ON shoot_readiness_item (tenant_id, shoot_id, blocking, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS shoot_readiness_item_tenant_shoot_code_uq
  ON shoot_readiness_item (tenant_id, shoot_id, code);

CREATE INDEX IF NOT EXISTS shoot_activity_log_lookup_idx
  ON shoot_activity_log (tenant_id, shoot_id, created_at DESC);

CREATE INDEX IF NOT EXISTS shoot_import_session_lookup_idx
  ON shoot_import_session (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS shoot_import_row_session_status_idx
  ON shoot_import_row (tenant_id, import_session_id, status, row_number);

INSERT INTO shoot_school_detail (
  shoot_id,
  tenant_id,
  school_job_type,
  student_count_estimate,
  staff_count_estimate,
  camera_count_estimate,
  roster_status,
  building_instructions,
  school_day_notes,
  photo_day_special_notes
)
SELECT
  s.id,
  s.tenant_id,
  COALESCE(NULLIF(trim(s.shoot_subtype), ''), CASE WHEN s.shoot_type = 'schools_events' THEN 'school_event' ELSE 'portrait_day' END),
  NULLIF(s.projected_students, 0),
  NULLIF(s.planned_staff_count, 0),
  NULLIF(s.camera_station_count, 0),
  CASE
    WHEN s.roster_data_required AND s.roster_data_ready THEN 'ready'
    WHEN s.roster_data_required THEN 'needed'
    ELSE 'not_required'
  END,
  s.access_notes,
  s.day_of_notes,
  s.special_instructions
FROM shoot s
WHERE (s.department = 'schools'::department_code OR s.shoot_type IN ('schools_underclass_portraits', 'schools_events'))
ON CONFLICT (shoot_id) DO NOTHING;

INSERT INTO shoot_sports_detail (
  shoot_id,
  tenant_id,
  sports_job_type,
  specialty_products_required,
  gallery_required,
  event_notes,
  on_site_sales_notes
)
SELECT
  s.id,
  s.tenant_id,
  NULLIF(trim(s.shoot_subtype), ''),
  COALESCE(s.additional_products_flag, false),
  true,
  s.day_of_notes,
  s.additional_products
FROM shoot s
WHERE s.department = 'sports'::department_code OR s.shoot_type = 'sports'
ON CONFLICT (shoot_id) DO NOTHING;

INSERT INTO shoot_day (
  tenant_id,
  shoot_id,
  day_index,
  shoot_date,
  start_time,
  end_time,
  time_zone,
  location_id
)
SELECT
  s.tenant_id,
  s.id,
  0,
  s.shoot_date,
  (s.start_time AT TIME ZONE COALESCE(NULLIF(trim(s.time_zone), ''), 'America/Chicago'))::time,
  (s.end_time_est AT TIME ZONE COALESCE(NULLIF(trim(s.time_zone), ''), 'America/Chicago'))::time,
  COALESCE(NULLIF(trim(s.time_zone), ''), 'America/Chicago'),
  s.location_id
FROM shoot s
ON CONFLICT (tenant_id, shoot_id, day_index) DO NOTHING;

ALTER TABLE shoot_school_detail ENABLE ROW LEVEL SECURITY;
ALTER TABLE shoot_sports_detail ENABLE ROW LEVEL SECURITY;
ALTER TABLE shoot_day ENABLE ROW LEVEL SECURITY;
ALTER TABLE shoot_readiness_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE shoot_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE shoot_import_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE shoot_import_row ENABLE ROW LEVEL SECURITY;

ALTER TABLE shoot_school_detail FORCE ROW LEVEL SECURITY;
ALTER TABLE shoot_sports_detail FORCE ROW LEVEL SECURITY;
ALTER TABLE shoot_day FORCE ROW LEVEL SECURITY;
ALTER TABLE shoot_readiness_item FORCE ROW LEVEL SECURITY;
ALTER TABLE shoot_activity_log FORCE ROW LEVEL SECURITY;
ALTER TABLE shoot_import_session FORCE ROW LEVEL SECURITY;
ALTER TABLE shoot_import_row FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_shoot_school_detail ON shoot_school_detail;
CREATE POLICY tenant_isolation_shoot_school_detail ON shoot_school_detail
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_shoot_sports_detail ON shoot_sports_detail;
CREATE POLICY tenant_isolation_shoot_sports_detail ON shoot_sports_detail
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_shoot_day ON shoot_day;
CREATE POLICY tenant_isolation_shoot_day ON shoot_day
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_shoot_readiness_item ON shoot_readiness_item;
CREATE POLICY tenant_isolation_shoot_readiness_item ON shoot_readiness_item
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_shoot_activity_log ON shoot_activity_log;
CREATE POLICY tenant_isolation_shoot_activity_log ON shoot_activity_log
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_shoot_import_session ON shoot_import_session;
CREATE POLICY tenant_isolation_shoot_import_session ON shoot_import_session
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_shoot_import_row ON shoot_import_row;
CREATE POLICY tenant_isolation_shoot_import_row ON shoot_import_row
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
