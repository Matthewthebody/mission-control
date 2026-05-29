DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_clock_compliance_item') THEN
    CREATE TYPE time_clock_compliance_item AS ENUM (
      'missing_setup_photo',
      'missing_post_shoot_evaluation',
      'mileage_blocked_missing_post_shoot_evaluation',
      'upload_while_off_clock',
      'unresolved_end_of_day_confirmation'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_clock_compliance_status') THEN
    CREATE TYPE time_clock_compliance_status AS ENUM (
      'open',
      'resolved'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_clock_compliance_severity') THEN
    CREATE TYPE time_clock_compliance_severity AS ENUM (
      'warning',
      'high'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS time_clock_compliance_flag (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  shift_id uuid REFERENCES work_shift(id) ON DELETE SET NULL,
  session_id uuid REFERENCES time_session(id) ON DELETE SET NULL,
  shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  linked_exception_request_id uuid REFERENCES exception_request(id) ON DELETE SET NULL,
  item_type time_clock_compliance_item NOT NULL,
  severity time_clock_compliance_severity NOT NULL DEFAULT 'warning',
  status time_clock_compliance_status NOT NULL DEFAULT 'open',
  dedupe_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS time_clock_compliance_flag_employee_idx
  ON time_clock_compliance_flag (tenant_id, employee_id, last_detected_at DESC);

CREATE INDEX IF NOT EXISTS time_clock_compliance_flag_shift_idx
  ON time_clock_compliance_flag (tenant_id, shift_id, last_detected_at DESC)
  WHERE shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS time_clock_compliance_flag_session_idx
  ON time_clock_compliance_flag (tenant_id, session_id, last_detected_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS time_clock_compliance_flag_status_idx
  ON time_clock_compliance_flag (tenant_id, status, severity, last_detected_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS time_clock_compliance_flag_open_uq
  ON time_clock_compliance_flag (tenant_id, dedupe_key)
  WHERE status = 'open';

ALTER TABLE time_clock_compliance_flag ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_clock_compliance_flag FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'time_clock_compliance_flag'
      AND policyname = 'tenant_isolation_time_clock_compliance_flag'
  ) THEN
    CREATE POLICY tenant_isolation_time_clock_compliance_flag ON time_clock_compliance_flag
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
