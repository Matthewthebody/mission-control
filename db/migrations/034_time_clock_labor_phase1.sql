DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_work_state') THEN
    CREATE TYPE time_work_state AS ENUM ('office_drive', 'photography');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_session_status') THEN
    CREATE TYPE time_session_status AS ENUM (
      'open',
      'closed',
      'needs_end_of_day_confirmation',
      'approved',
      'payroll_exported'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_segment_source_type') THEN
    CREATE TYPE time_segment_source_type AS ENUM (
      'manual',
      'automatic_transition',
      'manual_correction',
      'admin_override'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_segment_review_status') THEN
    CREATE TYPE time_segment_review_status AS ENUM (
      'not_required',
      'pending_review',
      'approved',
      'rejected'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'clock_event_type') THEN
    CREATE TYPE clock_event_type AS ENUM (
      'clock_in',
      'clock_out',
      'session_opened',
      'session_closed',
      'work_state_started',
      'work_state_ended',
      'manual_correction',
      'admin_override',
      'exception_requested',
      'approval_recorded',
      'auto_lunch_deduction_applied',
      'auto_lunch_deduction_removed'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'clock_event_actor_type') THEN
    CREATE TYPE clock_event_actor_type AS ENUM (
      'employee',
      'system',
      'manager',
      'leadership',
      'integration',
      'admin'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'exception_request_type') THEN
    CREATE TYPE exception_request_type AS ENUM (
      'missing_clock_in',
      'missing_clock_out',
      'time_segment_correction',
      'work_state_change',
      'lunch_deduction_challenge',
      'mileage_review',
      'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'exception_request_status') THEN
    CREATE TYPE exception_request_status AS ENUM (
      'submitted',
      'under_review',
      'approved',
      'rejected',
      'cancelled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'approval_record_decision') THEN
    CREATE TYPE approval_record_decision AS ENUM (
      'approved',
      'rejected',
      'returned'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS employee_pay_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  office_rate numeric(10,2) NOT NULL CHECK (office_rate >= 0),
  photography_rate numeric(10,2) NOT NULL CHECK (photography_rate >= 0),
  overtime_eligible boolean NOT NULL DEFAULT true,
  mileage_eligible boolean NOT NULL DEFAULT false,
  active_status boolean NOT NULL DEFAULT true,
  effective_date date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, effective_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS employee_pay_profile_active_employee_uq
  ON employee_pay_profile (tenant_id, employee_id)
  WHERE active_status = true;

CREATE TABLE IF NOT EXISTS time_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  source_shift_id uuid REFERENCES work_shift(id) ON DELETE SET NULL,
  status time_session_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS time_session_employee_work_date_open_uq
  ON time_session (tenant_id, employee_id, work_date)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS time_segment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES time_session(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  work_state time_work_state NOT NULL,
  linked_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  linked_location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz,
  duration_minutes integer GENERATED ALWAYS AS (
    CASE
      WHEN end_time IS NULL THEN NULL
      ELSE GREATEST(ROUND(EXTRACT(EPOCH FROM (end_time - start_time)) / 60.0)::integer, 0)
    END
  ) STORED,
  source_type time_segment_source_type NOT NULL DEFAULT 'manual',
  geofence_supported boolean NOT NULL DEFAULT false,
  review_status time_segment_review_status NOT NULL DEFAULT 'not_required',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time IS NULL OR end_time > start_time)
);

CREATE TABLE IF NOT EXISTS clock_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  linked_session_id uuid REFERENCES time_session(id) ON DELETE SET NULL,
  linked_segment_id uuid REFERENCES time_segment(id) ON DELETE SET NULL,
  linked_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  linked_location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  event_type clock_event_type NOT NULL,
  event_timestamp timestamptz NOT NULL,
  latitude double precision,
  longitude double precision,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_actor clock_event_actor_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exception_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  request_type exception_request_type NOT NULL,
  linked_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  linked_session_id uuid REFERENCES time_session(id) ON DELETE SET NULL,
  linked_segment_id uuid REFERENCES time_segment(id) ON DELETE SET NULL,
  requested_state time_work_state,
  requested_start_time timestamptz,
  requested_end_time timestamptz,
  note text NOT NULL DEFAULT '',
  status exception_request_status NOT NULL DEFAULT 'submitted',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES app_user(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS approval_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES exception_request(id) ON DELETE CASCADE,
  approver_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  approver_role text NOT NULL,
  decision approval_record_decision NOT NULL,
  comment text,
  decided_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS previous_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS new_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reason_comment text;

CREATE INDEX IF NOT EXISTS employee_pay_profile_lookup_idx
  ON employee_pay_profile (tenant_id, employee_id, active_status, effective_date DESC);

CREATE INDEX IF NOT EXISTS time_session_employee_idx
  ON time_session (tenant_id, employee_id, work_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS time_session_shift_idx
  ON time_session (tenant_id, source_shift_id, work_date DESC);

CREATE INDEX IF NOT EXISTS time_segment_session_idx
  ON time_segment (tenant_id, session_id, start_time ASC);

CREATE INDEX IF NOT EXISTS time_segment_employee_idx
  ON time_segment (tenant_id, employee_id, start_time DESC);

CREATE INDEX IF NOT EXISTS time_segment_shoot_idx
  ON time_segment (tenant_id, linked_shoot_id, start_time DESC);

CREATE INDEX IF NOT EXISTS clock_event_employee_idx
  ON clock_event (tenant_id, employee_id, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS clock_event_session_idx
  ON clock_event (tenant_id, linked_session_id, event_timestamp ASC);

CREATE INDEX IF NOT EXISTS clock_event_shoot_idx
  ON clock_event (tenant_id, linked_shoot_id, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS exception_request_employee_idx
  ON exception_request (tenant_id, employee_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS exception_request_status_idx
  ON exception_request (tenant_id, status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS approval_record_request_idx
  ON approval_record (tenant_id, request_id, decided_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_entity_review_idx
  ON audit_log (tenant_id, entity_type, entity_id, created_at DESC);

ALTER TABLE employee_pay_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_segment ENABLE ROW LEVEL SECURITY;
ALTER TABLE clock_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE exception_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_pay_profile FORCE ROW LEVEL SECURITY;
ALTER TABLE time_session FORCE ROW LEVEL SECURITY;
ALTER TABLE time_segment FORCE ROW LEVEL SECURITY;
ALTER TABLE clock_event FORCE ROW LEVEL SECURITY;
ALTER TABLE exception_request FORCE ROW LEVEL SECURITY;
ALTER TABLE approval_record FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'employee_pay_profile'
      AND policyname = 'tenant_isolation_employee_pay_profile'
  ) THEN
    CREATE POLICY tenant_isolation_employee_pay_profile ON employee_pay_profile
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'time_session'
      AND policyname = 'tenant_isolation_time_session'
  ) THEN
    CREATE POLICY tenant_isolation_time_session ON time_session
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'time_segment'
      AND policyname = 'tenant_isolation_time_segment'
  ) THEN
    CREATE POLICY tenant_isolation_time_segment ON time_segment
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'clock_event'
      AND policyname = 'tenant_isolation_clock_event'
  ) THEN
    CREATE POLICY tenant_isolation_clock_event ON clock_event
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'exception_request'
      AND policyname = 'tenant_isolation_exception_request'
  ) THEN
    CREATE POLICY tenant_isolation_exception_request ON exception_request
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'approval_record'
      AND policyname = 'tenant_isolation_approval_record'
  ) THEN
    CREATE POLICY tenant_isolation_approval_record ON approval_record
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
