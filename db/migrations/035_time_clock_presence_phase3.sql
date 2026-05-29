DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_presence_state') THEN
    CREATE TYPE time_presence_state AS ENUM (
      'off_clock',
      'office_drive',
      'photography',
      'needs_end_of_day_confirmation'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_presence_observation_source') THEN
    CREATE TYPE time_presence_observation_source AS ENUM (
      'location_check',
      'clock_punch',
      'end_of_day_confirmation',
      'system_transition'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_presence_alert_type') THEN
    CREATE TYPE time_presence_alert_type AS ENUM (
      'assigned_but_missing',
      'likely_present_missing_clock_in'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_presence_incident_status') THEN
    CREATE TYPE time_presence_incident_status AS ENUM (
      'open',
      'resolved'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_presence_geofence_classification') THEN
    CREATE TYPE time_presence_geofence_classification AS ENUM (
      'inside_shoot_radius',
      'inside_soft_radius',
      'outside_soft_radius',
      'inside_studio_radius',
      'outside_studio_radius',
      'unknown'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS time_clock_presence_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  session_id uuid REFERENCES time_session(id) ON DELETE SET NULL,
  segment_id uuid REFERENCES time_segment(id) ON DELETE SET NULL,
  linked_shift_id uuid REFERENCES work_shift(id) ON DELETE SET NULL,
  linked_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  linked_location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  current_state time_presence_state NOT NULL DEFAULT 'off_clock',
  session_status time_session_status,
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  captured_at timestamptz NOT NULL,
  source_type time_presence_observation_source NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id)
);

CREATE TABLE IF NOT EXISTS time_clock_presence_incident (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  shift_id uuid REFERENCES work_shift(id) ON DELETE SET NULL,
  shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  alert_type time_presence_alert_type NOT NULL,
  geofence_classification time_presence_geofence_classification NOT NULL DEFAULT 'unknown',
  current_state time_presence_state NOT NULL,
  resolution_status time_presence_incident_status NOT NULL DEFAULT 'open',
  linked_correction_request_id uuid REFERENCES exception_request(id) ON DELETE SET NULL,
  repeat_count integer NOT NULL DEFAULT 1 CHECK (repeat_count > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  last_notified_at timestamptz,
  resolved_at timestamptz,
  resolution_reason text
);

CREATE INDEX IF NOT EXISTS time_clock_presence_observation_lookup_idx
  ON time_clock_presence_observation (tenant_id, employee_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS time_clock_presence_observation_state_idx
  ON time_clock_presence_observation (tenant_id, current_state, captured_at DESC);

CREATE INDEX IF NOT EXISTS time_clock_presence_incident_employee_idx
  ON time_clock_presence_incident (tenant_id, employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS time_clock_presence_incident_shift_idx
  ON time_clock_presence_incident (tenant_id, shift_id, created_at DESC);

CREATE INDEX IF NOT EXISTS time_clock_presence_incident_open_idx
  ON time_clock_presence_incident (tenant_id, resolution_status, alert_type, last_observed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS time_clock_presence_incident_active_uq
  ON time_clock_presence_incident (tenant_id, employee_id, shift_id, alert_type)
  WHERE resolution_status = 'open';

ALTER TABLE time_clock_presence_observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_clock_presence_incident ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_clock_presence_observation FORCE ROW LEVEL SECURITY;
ALTER TABLE time_clock_presence_incident FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'time_clock_presence_observation'
      AND policyname = 'tenant_isolation_time_clock_presence_observation'
  ) THEN
    CREATE POLICY tenant_isolation_time_clock_presence_observation ON time_clock_presence_observation
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'time_clock_presence_incident'
      AND policyname = 'tenant_isolation_time_clock_presence_incident'
  ) THEN
    CREATE POLICY tenant_isolation_time_clock_presence_incident ON time_clock_presence_incident
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
