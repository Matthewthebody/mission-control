ALTER TABLE pto_request
  ALTER COLUMN status TYPE text
  USING CASE
    WHEN status::text = 'pending' THEN 'submitted'
    WHEN status::text = 'rejected' THEN 'rejected'
    WHEN status::text = 'denied' THEN 'rejected'
    WHEN status::text = 'cancelled' THEN 'cancelled_by_employee'
    WHEN status::text = 'canceled' THEN 'cancelled_by_employee'
    ELSE status::text
  END;

ALTER TABLE pto_request
  ADD COLUMN IF NOT EXISTS request_type text NOT NULL DEFAULT 'full_day_off',
  ADD COLUMN IF NOT EXISTS all_day boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time time,
  ADD COLUMN IF NOT EXISTS reason_category text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS impacted_assignments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS staffing_impact_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS coverage_found boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS crosses_protected_date boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS protected_date_severity text,
  ADD COLUMN IF NOT EXISTS live_operational_absence_state text,
  ADD COLUMN IF NOT EXISTS warning_level text NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS requested_recurring_rule jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE pto_request
SET
  request_type = CASE
    WHEN COALESCE(ends_on, starts_on) > starts_on THEN 'multi_day_off'
    WHEN request_unit = 'half_day' THEN 'partial_day_off'
    ELSE 'full_day_off'
  END,
  all_day = CASE
    WHEN request_unit = 'half_day' OR partial_day THEN false
    ELSE true
  END,
  submitted_at = COALESCE(submitted_at, created_at),
  warning_level = COALESCE(NULLIF(warning_level, ''), 'low'),
  impacted_assignments = COALESCE(impacted_assignments, '[]'::jsonb),
  staffing_impact_summary = COALESCE(staffing_impact_summary, '{}'::jsonb),
  requested_recurring_rule = COALESCE(requested_recurring_rule, '{}'::jsonb),
  status = CASE
    WHEN status = 'canceled' THEN 'cancelled_by_employee'
    ELSE status
  END
WHERE true;

ALTER TABLE pto_request
  DROP CONSTRAINT IF EXISTS pto_request_requested_hours_check;

ALTER TABLE pto_request
  ADD CONSTRAINT pto_request_requested_hours_check
  CHECK (requested_hours >= 0);

ALTER TABLE pto_request
  DROP CONSTRAINT IF EXISTS pto_request_request_status_check;

ALTER TABLE pto_request
  ADD CONSTRAINT pto_request_request_status_check
  CHECK (
    status IN (
      'draft',
      'submitted',
      'approved',
      'rejected',
      'cancelled_by_employee',
      'cancelled_by_manager_admin',
      'expired',
      'needs_review'
    )
  );

ALTER TABLE pto_request
  DROP CONSTRAINT IF EXISTS pto_request_request_type_check;

ALTER TABLE pto_request
  ADD CONSTRAINT pto_request_request_type_check
  CHECK (
    request_type IN (
      'full_day_off',
      'partial_day_off',
      'multi_day_off',
      'sick_illness',
      'personal_appointment',
      'unavailable_for_assignment',
      'availability_restriction_update',
      'company_holiday',
      'manager_blocked_day',
      'training_meeting_hold',
      'admin_unavailable',
      'protected_blackout'
    )
  );

ALTER TABLE pto_request
  DROP CONSTRAINT IF EXISTS pto_request_warning_level_check;

ALTER TABLE pto_request
  ADD CONSTRAINT pto_request_warning_level_check
  CHECK (warning_level IN ('low', 'medium', 'high', 'critical'));

ALTER TABLE pto_request
  DROP CONSTRAINT IF EXISTS pto_request_protected_date_severity_check;

ALTER TABLE pto_request
  ADD CONSTRAINT pto_request_protected_date_severity_check
  CHECK (protected_date_severity IS NULL OR protected_date_severity IN ('soft', 'hard'));

ALTER TABLE pto_request
  DROP CONSTRAINT IF EXISTS pto_request_live_operational_absence_state_check;

ALTER TABLE pto_request
  ADD CONSTRAINT pto_request_live_operational_absence_state_check
  CHECK (
    live_operational_absence_state IS NULL
    OR live_operational_absence_state IN (
      'reported_absent',
      'excused',
      'unexcused',
      'pending_coverage_review'
    )
  );

CREATE INDEX IF NOT EXISTS pto_request_tenant_status_idx
  ON pto_request (tenant_id, status, starts_on, ends_on);

CREATE INDEX IF NOT EXISTS pto_request_tenant_request_type_idx
  ON pto_request (tenant_id, request_type, starts_on, ends_on);

CREATE TABLE IF NOT EXISTS employee_availability_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  request_id uuid REFERENCES pto_request(id) ON DELETE SET NULL,
  department department_code NOT NULL DEFAULT 'unassigned',
  rule_type text NOT NULL,
  weekdays smallint[] NOT NULL DEFAULT '{}'::smallint[],
  start_time time,
  end_time time,
  season_start date,
  season_end date,
  note text,
  status text NOT NULL DEFAULT 'active',
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    rule_type IN (
      'unavailable_weekday',
      'available_after_time',
      'available_between_times',
      'seasonal_unavailable'
    )
  ),
  CHECK (status IN ('active', 'inactive')),
  CHECK (season_end IS NULL OR season_start IS NULL OR season_end >= season_start)
);

CREATE INDEX IF NOT EXISTS employee_availability_rule_tenant_user_idx
  ON employee_availability_rule (tenant_id, user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS staffing_blocked_date (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  target_scope text NOT NULL,
  target_department department_code,
  target_user_id uuid REFERENCES app_user(id) ON DELETE CASCADE,
  block_type text NOT NULL,
  block_severity text NOT NULL DEFAULT 'soft',
  label text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  approval_required boolean NOT NULL DEFAULT false,
  note text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (target_scope IN ('company', 'department', 'user')),
  CHECK (
    block_type IN (
      'company_holiday',
      'manager_blocked_day',
      'training_meeting_hold',
      'admin_unavailable',
      'protected_blackout'
    )
  ),
  CHECK (block_severity IN ('soft', 'hard')),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS staffing_blocked_date_tenant_window_idx
  ON staffing_blocked_date (tenant_id, starts_at, ends_at, block_type);

CREATE INDEX IF NOT EXISTS staffing_blocked_date_tenant_scope_idx
  ON staffing_blocked_date (tenant_id, target_scope, target_department, target_user_id);

ALTER TABLE employee_availability_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_availability_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE staffing_blocked_date ENABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_blocked_date FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'employee_availability_rule'
      AND policyname = 'tenant_isolation_employee_availability_rule'
  ) THEN
    CREATE POLICY tenant_isolation_employee_availability_rule ON employee_availability_rule
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'staffing_blocked_date'
      AND policyname = 'tenant_isolation_staffing_blocked_date'
  ) THEN
    CREATE POLICY tenant_isolation_staffing_blocked_date ON staffing_blocked_date
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
