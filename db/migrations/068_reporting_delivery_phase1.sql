DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_saved_view_source_module') THEN
    CREATE TYPE report_saved_view_source_module AS ENUM (
      'reporting_dashboard',
      'schedule',
      'staffing',
      'attendance_review',
      'production_tracker',
      'relationship_follow_through',
      'directory_review'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_saved_view_visibility') THEN
    CREATE TYPE report_saved_view_visibility AS ENUM (
      'private',
      'team_role_shared',
      'department_shared',
      'leadership_shared',
      'company_shared'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_export_format') THEN
    CREATE TYPE report_export_format AS ENUM ('csv', 'pdf', 'link');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_export_status') THEN
    CREATE TYPE report_export_status AS ENUM ('requested', 'completed', 'failed');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leadership_packet_source_type') THEN
    CREATE TYPE leadership_packet_source_type AS ENUM ('packet_template', 'saved_view');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leadership_packet_run_status') THEN
    CREATE TYPE leadership_packet_run_status AS ENUM ('completed', 'failed');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leadership_delivery_cadence') THEN
    CREATE TYPE leadership_delivery_cadence AS ENUM ('weekly', 'daily', 'monthly');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leadership_delivery_channel') THEN
    CREATE TYPE leadership_delivery_channel AS ENUM ('in_app_summary', 'email_link');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS report_saved_view (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_key text,
  source_module report_saved_view_source_module NOT NULL DEFAULT 'reporting_dashboard',
  report_id text,
  name text NOT NULL,
  description text,
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  visibility report_saved_view_visibility NOT NULL DEFAULT 'private',
  department_code text,
  is_default boolean NOT NULL DEFAULT false,
  is_pinned boolean NOT NULL DEFAULT false,
  system_defined boolean NOT NULL DEFAULT false,
  active_status boolean NOT NULL DEFAULT true,
  filter_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  grouping_state jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_state jsonb NOT NULL DEFAULT '[]'::jsonb,
  column_state jsonb NOT NULL DEFAULT '[]'::jsonb,
  scope_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS report_saved_view_template_key_idx
  ON report_saved_view (tenant_id, template_key)
  WHERE template_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS report_saved_view_lookup_idx
  ON report_saved_view (tenant_id, source_module, visibility, active_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS report_saved_view_owner_idx
  ON report_saved_view (tenant_id, owner_user_id, updated_at DESC)
  WHERE owner_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS leadership_packet_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_key text,
  name text NOT NULL,
  audience text NOT NULL,
  description text,
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  visibility report_saved_view_visibility NOT NULL DEFAULT 'leadership_shared',
  default_window text NOT NULL DEFAULT 'last_7_days',
  department_code text,
  section_config jsonb NOT NULL DEFAULT '[]'::jsonb,
  system_defined boolean NOT NULL DEFAULT false,
  is_pinned boolean NOT NULL DEFAULT false,
  active_status boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS leadership_packet_template_key_idx
  ON leadership_packet_template (tenant_id, template_key)
  WHERE template_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS leadership_packet_template_lookup_idx
  ON leadership_packet_template (tenant_id, visibility, active_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS leadership_packet_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  source_type leadership_packet_source_type NOT NULL,
  template_id uuid REFERENCES leadership_packet_template(id) ON DELETE SET NULL,
  saved_view_id uuid REFERENCES report_saved_view(id) ON DELETE SET NULL,
  schedule_id uuid,
  run_label text NOT NULL,
  requested_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  anchor_date date NOT NULL,
  date_from date,
  date_to date,
  filter_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  freshness_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  packet_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  record_count integer,
  status leadership_packet_run_status NOT NULL DEFAULT 'completed',
  pdf_reference text,
  recipient_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  delivery_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leadership_packet_run_source_chk CHECK (
    (source_type = 'packet_template' AND template_id IS NOT NULL AND saved_view_id IS NULL)
    OR (source_type = 'saved_view' AND saved_view_id IS NOT NULL AND template_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS leadership_packet_run_history_idx
  ON leadership_packet_run (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS leadership_packet_run_template_idx
  ON leadership_packet_run (tenant_id, template_id, created_at DESC)
  WHERE template_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS leadership_packet_run_saved_view_idx
  ON leadership_packet_run (tenant_id, saved_view_id, created_at DESC)
  WHERE saved_view_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS report_export_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  source_module report_saved_view_source_module NOT NULL DEFAULT 'reporting_dashboard',
  report_id text,
  saved_view_id uuid REFERENCES report_saved_view(id) ON DELETE SET NULL,
  packet_run_id uuid REFERENCES leadership_packet_run(id) ON DELETE SET NULL,
  requested_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  export_name text NOT NULL,
  format report_export_format NOT NULL,
  status report_export_status NOT NULL DEFAULT 'requested',
  filter_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  freshness_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  record_count integer,
  file_reference text,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS report_export_job_history_idx
  ON report_export_job (tenant_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS report_export_job_requester_idx
  ON report_export_job (tenant_id, requested_by_user_id, requested_at DESC)
  WHERE requested_by_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS leadership_delivery_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  label text NOT NULL,
  source_type leadership_packet_source_type NOT NULL,
  template_id uuid REFERENCES leadership_packet_template(id) ON DELETE SET NULL,
  saved_view_id uuid REFERENCES report_saved_view(id) ON DELETE SET NULL,
  cadence leadership_delivery_cadence NOT NULL DEFAULT 'weekly',
  day_of_week integer NOT NULL DEFAULT 1,
  hour_local integer NOT NULL DEFAULT 8,
  minute_local integer NOT NULL DEFAULT 0,
  timezone text NOT NULL DEFAULT 'America/Chicago',
  delivery_channel leadership_delivery_channel NOT NULL DEFAULT 'in_app_summary',
  recipient_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  active_status boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  last_status text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leadership_delivery_schedule_source_chk CHECK (
    (source_type = 'packet_template' AND template_id IS NOT NULL AND saved_view_id IS NULL)
    OR (source_type = 'saved_view' AND saved_view_id IS NOT NULL AND template_id IS NULL)
  ),
  CONSTRAINT leadership_delivery_schedule_day_chk CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT leadership_delivery_schedule_hour_chk CHECK (hour_local BETWEEN 0 AND 23),
  CONSTRAINT leadership_delivery_schedule_minute_chk CHECK (minute_local BETWEEN 0 AND 59)
);

ALTER TABLE leadership_packet_run
  ADD CONSTRAINT leadership_packet_run_schedule_fk
  FOREIGN KEY (schedule_id) REFERENCES leadership_delivery_schedule(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS leadership_delivery_schedule_due_idx
  ON leadership_delivery_schedule (tenant_id, active_status, next_run_at ASC);

CREATE INDEX IF NOT EXISTS leadership_delivery_schedule_owner_idx
  ON leadership_delivery_schedule (tenant_id, owner_user_id, updated_at DESC)
  WHERE owner_user_id IS NOT NULL;

ALTER TABLE report_saved_view ENABLE ROW LEVEL SECURITY;
ALTER TABLE leadership_packet_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE leadership_packet_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_export_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE leadership_delivery_schedule ENABLE ROW LEVEL SECURITY;

ALTER TABLE report_saved_view FORCE ROW LEVEL SECURITY;
ALTER TABLE leadership_packet_template FORCE ROW LEVEL SECURITY;
ALTER TABLE leadership_packet_run FORCE ROW LEVEL SECURITY;
ALTER TABLE report_export_job FORCE ROW LEVEL SECURITY;
ALTER TABLE leadership_delivery_schedule FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_report_saved_view ON report_saved_view
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_leadership_packet_template ON leadership_packet_template
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_leadership_packet_run ON leadership_packet_run
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_report_export_job ON report_export_job
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_leadership_delivery_schedule ON leadership_delivery_schedule
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
