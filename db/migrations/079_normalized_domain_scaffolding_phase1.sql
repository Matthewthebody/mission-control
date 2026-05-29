DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'staffing_issue_type') THEN
    CREATE TYPE staffing_issue_type AS ENUM (
      'coverage_gap',
      'critical_role_gap',
      'assignment_conflict',
      'overstaffed',
      'unconfirmed_labor',
      'attendance_impact',
      'replacement_needed',
      'missing_contact_info',
      'unconfirmed_shoot',
      'other'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'staffing_issue_status') THEN
    CREATE TYPE staffing_issue_status AS ENUM (
      'open',
      'acknowledged',
      'in_progress',
      'resolved',
      'canceled'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'staffing_issue_severity') THEN
    CREATE TYPE staffing_issue_severity AS ENUM (
      'low',
      'medium',
      'high',
      'critical'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS staffing_issue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  issue_type staffing_issue_type NOT NULL,
  status staffing_issue_status NOT NULL DEFAULT 'open',
  severity staffing_issue_severity NOT NULL DEFAULT 'medium',
  source_module text NOT NULL DEFAULT 'scheduling',
  source_entity_type text NOT NULL,
  source_entity_id text NOT NULL,
  source_entity_label text,
  department department_code,
  shift_id uuid REFERENCES work_shift(id) ON DELETE SET NULL,
  shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  staffing_requirement_id uuid REFERENCES shoot_staffing_requirement(id) ON DELETE SET NULL,
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  acknowledged_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  resolved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  dedupe_key text,
  title text NOT NULL,
  summary text,
  resolution_note text,
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staffing_issue_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  staffing_issue_id uuid NOT NULL REFERENCES staffing_issue(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  summary text NOT NULL,
  note text,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staffing_issue_status_idx
  ON staffing_issue (tenant_id, status, severity, detected_at DESC);

CREATE INDEX IF NOT EXISTS staffing_issue_owner_idx
  ON staffing_issue (tenant_id, owner_user_id, status, detected_at DESC);

CREATE INDEX IF NOT EXISTS staffing_issue_source_idx
  ON staffing_issue (tenant_id, source_module, source_entity_type, source_entity_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS staffing_issue_shift_idx
  ON staffing_issue (tenant_id, shift_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS staffing_issue_shoot_idx
  ON staffing_issue (tenant_id, shoot_id, detected_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS staffing_issue_active_dedupe_idx
  ON staffing_issue (tenant_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL
    AND status IN ('open', 'acknowledged', 'in_progress');

CREATE INDEX IF NOT EXISTS staffing_issue_event_issue_idx
  ON staffing_issue_event (tenant_id, staffing_issue_id, created_at DESC);

ALTER TABLE staffing_issue ENABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_issue FORCE ROW LEVEL SECURITY;
ALTER TABLE staffing_issue_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_issue_event FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'staffing_issue'
      AND policyname = 'tenant_isolation_staffing_issue'
  ) THEN
    CREATE POLICY tenant_isolation_staffing_issue ON staffing_issue
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'staffing_issue_event'
      AND policyname = 'tenant_isolation_staffing_issue_event'
  ) THEN
    CREATE POLICY tenant_isolation_staffing_issue_event ON staffing_issue_event
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
