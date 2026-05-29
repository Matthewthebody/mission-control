DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_live_state') THEN
    CREATE TYPE attendance_live_state AS ENUM (
      'scheduled',
      'upcoming',
      'grace_window',
      'checked_in',
      'on_time',
      'late',
      'late_acknowledged',
      'unresolved_no_check_in',
      'called_out',
      'replacement_needed',
      'no_show',
      'manager_excused',
      'completed',
      'canceled'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_live_signal_source') THEN
    CREATE TYPE attendance_live_signal_source AS ENUM (
      'system_schedule',
      'employee_check_in',
      'manager_mark_present',
      'time_clock_start',
      'manager_acknowledge_late',
      'manager_mark_called_out',
      'manager_request_replacement',
      'manager_mark_no_show',
      'manager_excuse',
      'system_complete',
      'system_cancel'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS shift_attendance_runtime (
  shift_id uuid PRIMARY KEY REFERENCES work_shift(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  employee_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  current_state attendance_live_state NOT NULL DEFAULT 'scheduled',
  current_state_reason text,
  signal_source attendance_live_signal_source NOT NULL DEFAULT 'system_schedule',
  last_signal_at timestamptz,
  first_present_at timestamptz,
  first_present_source attendance_live_signal_source,
  latest_check_in_at timestamptz,
  latest_time_clock_start_at timestamptz,
  manager_mark_present_at timestamptz,
  manager_mark_present_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  late_acknowledged_at timestamptz,
  late_acknowledged_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  called_out_at timestamptz,
  called_out_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  replacement_needed_at timestamptz,
  replacement_needed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  no_show_marked_at timestamptz,
  no_show_marked_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  manager_excused_at timestamptz,
  manager_excused_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  escalation_level integer NOT NULL DEFAULT 0,
  last_escalated_at timestamptz,
  open_alert_types text[] NOT NULL DEFAULT '{}'::text[],
  coverage_impact boolean NOT NULL DEFAULT false,
  critical_role_missing boolean NOT NULL DEFAULT false,
  understaffed_due_to_attendance boolean NOT NULL DEFAULT false,
  minimum_staff_count integer NOT NULL DEFAULT 0,
  planned_staff_count integer NOT NULL DEFAULT 0,
  required_lead_count integer NOT NULL DEFAULT 0,
  active_present_count integer NOT NULL DEFAULT 0,
  present_lead_count integer NOT NULL DEFAULT 0,
  last_evaluated_at timestamptz,
  last_state_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shift_attendance_runtime_tenant_state_idx
  ON shift_attendance_runtime (tenant_id, current_state, updated_at DESC);

CREATE INDEX IF NOT EXISTS shift_attendance_runtime_tenant_shoot_idx
  ON shift_attendance_runtime (tenant_id, shoot_id, current_state);

CREATE INDEX IF NOT EXISTS shift_attendance_runtime_tenant_employee_idx
  ON shift_attendance_runtime (tenant_id, employee_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS shift_attendance_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES work_shift(id) ON DELETE CASCADE,
  shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  employee_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  from_state attendance_live_state,
  to_state attendance_live_state,
  signal_source attendance_live_signal_source,
  escalation_level integer,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shift_attendance_history_tenant_shift_idx
  ON shift_attendance_history (tenant_id, shift_id, created_at DESC);

CREATE INDEX IF NOT EXISTS shift_attendance_history_tenant_shoot_idx
  ON shift_attendance_history (tenant_id, shoot_id, created_at DESC);

ALTER TABLE shift_attendance_runtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_attendance_runtime FORCE ROW LEVEL SECURITY;
ALTER TABLE shift_attendance_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_attendance_history FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'shift_attendance_runtime'
      AND policyname = 'tenant_isolation_shift_attendance_runtime'
  ) THEN
    CREATE POLICY tenant_isolation_shift_attendance_runtime ON shift_attendance_runtime
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'shift_attendance_history'
      AND policyname = 'tenant_isolation_shift_attendance_history'
  ) THEN
    CREATE POLICY tenant_isolation_shift_attendance_history ON shift_attendance_history
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

INSERT INTO shift_attendance_runtime (
  shift_id,
  tenant_id,
  shoot_id,
  employee_id,
  current_state,
  current_state_reason,
  signal_source,
  last_state_changed_at
)
SELECT
  ws.id,
  ws.tenant_id,
  ws.shoot_id,
  ws.assigned_user_id,
  CASE
    WHEN ws.cancelled_at IS NOT NULL OR ws.status = 'cancelled' THEN 'canceled'::attendance_live_state
    WHEN ws.status = 'completed' THEN 'completed'::attendance_live_state
    ELSE 'scheduled'::attendance_live_state
  END,
  CASE
    WHEN ws.cancelled_at IS NOT NULL OR ws.status = 'cancelled' THEN 'Shift was canceled.'
    WHEN ws.status = 'completed' THEN 'Shift is already complete.'
    ELSE 'Shift is scheduled and waiting for live attendance evaluation.'
  END,
  CASE
    WHEN ws.cancelled_at IS NOT NULL OR ws.status = 'cancelled' THEN 'system_cancel'::attendance_live_signal_source
    WHEN ws.status = 'completed' THEN 'system_complete'::attendance_live_signal_source
    ELSE 'system_schedule'::attendance_live_signal_source
  END,
  now()
FROM work_shift ws
WHERE ws.cancelled_at IS NULL
   OR ws.status IN ('published', 'completed')
ON CONFLICT (shift_id) DO NOTHING;
