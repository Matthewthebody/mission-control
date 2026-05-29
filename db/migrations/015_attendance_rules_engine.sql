DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_state') THEN
    CREATE TYPE attendance_state AS ENUM (
      'pending',
      'clocked_in',
      'clocked_out',
      'late_warning',
      'late',
      'missed_clock_in',
      'missed_clock_out',
      'no_show_suspected',
      'resolved',
      'corrected'
    );
  END IF;
END $$;

ALTER TABLE work_shift
  ADD COLUMN IF NOT EXISTS attendance_state attendance_state NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attendance_state_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS attendance_state_note text,
  ADD COLUMN IF NOT EXISTS attendance_resolved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attendance_resolved_at timestamptz;

ALTER TABLE shift_punch
  ADD COLUMN IF NOT EXISTS late_minutes integer,
  ADD COLUMN IF NOT EXISTS timing_status text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS missed_punch_required boolean NOT NULL DEFAULT false;

ALTER TABLE attendance_exception
  ADD COLUMN IF NOT EXISTS workflow_kind text NOT NULL DEFAULT 'exception',
  ADD COLUMN IF NOT EXISTS missing_direction punch_direction,
  ADD COLUMN IF NOT EXISTS corrected_time timestamptz,
  ADD COLUMN IF NOT EXISTS override_flag boolean NOT NULL DEFAULT false;

ALTER TABLE time_entry
  ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES work_shift(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS scheduled_minutes integer,
  ADD COLUMN IF NOT EXISTS gross_minutes integer,
  ADD COLUMN IF NOT EXISTS break_deduction_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS break_deduction_applied boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS break_deduction_source text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS break_deduction_overridden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS break_deduction_override_reason text,
  ADD COLUMN IF NOT EXISTS break_deduction_overridden_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payable_minutes integer,
  ADD COLUMN IF NOT EXISTS approved_payable_minutes integer,
  ADD COLUMN IF NOT EXISTS payroll_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attendance_state attendance_state NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS work_shift_tenant_attendance_state_idx
  ON work_shift (tenant_id, attendance_state, starts_at);

CREATE INDEX IF NOT EXISTS shift_punch_tenant_timing_status_idx
  ON shift_punch (tenant_id, timing_status, client_timestamp DESC);

CREATE INDEX IF NOT EXISTS attendance_exception_tenant_workflow_kind_idx
  ON attendance_exception (tenant_id, workflow_kind, status, created_at DESC);

CREATE INDEX IF NOT EXISTS time_entry_tenant_shift_idx
  ON time_entry (tenant_id, shift_id, created_at DESC);

UPDATE work_shift
SET attendance_state = CASE
  WHEN EXISTS (
    SELECT 1
    FROM shift_punch sp
    WHERE sp.shift_id = work_shift.id
      AND sp.direction = 'out'
  ) THEN 'clocked_out'::attendance_state
  WHEN EXISTS (
    SELECT 1
    FROM shift_punch sp
    WHERE sp.shift_id = work_shift.id
      AND sp.direction = 'in'
  ) THEN 'clocked_in'::attendance_state
  ELSE 'pending'::attendance_state
END
WHERE attendance_state = 'pending';

WITH matched_shift AS (
  SELECT
    te.id AS time_entry_id,
    ws.id AS shift_id,
    ROUND(EXTRACT(EPOCH FROM (ws.ends_at - ws.starts_at)) / 60.0)::integer AS scheduled_minutes
  FROM time_entry te
  JOIN LATERAL (
    SELECT ws.*
    FROM work_shift ws
    WHERE ws.tenant_id = te.tenant_id
      AND ws.shoot_id = te.shoot_id
      AND ws.assigned_user_id = te.user_id
      AND ws.starts_at <= COALESCE(te.clock_in_at, te.created_at) + interval '8 hours'
      AND ws.ends_at >= COALESCE(te.clock_in_at, te.created_at) - interval '8 hours'
    ORDER BY ABS(EXTRACT(EPOCH FROM (ws.starts_at - COALESCE(te.clock_in_at, te.created_at)))) ASC
    LIMIT 1
  ) ws ON TRUE
)
UPDATE time_entry te
SET shift_id = matched_shift.shift_id,
    scheduled_minutes = COALESCE(te.scheduled_minutes, matched_shift.scheduled_minutes)
FROM matched_shift
WHERE te.id = matched_shift.time_entry_id
  AND te.shift_id IS NULL;

UPDATE time_entry
SET gross_minutes = COALESCE(minutes_worked, CASE
      WHEN clock_out_at IS NOT NULL THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (clock_out_at - clock_in_at)) / 60.0)::integer)
      ELSE NULL
    END),
    break_deduction_minutes = CASE
      WHEN COALESCE(minutes_worked, 0) > 300 THEN 30
      ELSE break_deduction_minutes
    END,
    break_deduction_applied = CASE
      WHEN COALESCE(minutes_worked, 0) > 300 THEN true
      ELSE break_deduction_applied
    END,
    break_deduction_source = CASE
      WHEN COALESCE(minutes_worked, 0) > 300 THEN 'auto_30_after_5h'
      ELSE break_deduction_source
    END,
    payable_minutes = CASE
      WHEN COALESCE(minutes_worked, 0) > 300 THEN GREATEST(COALESCE(minutes_worked, 0) - 30, 0)
      ELSE COALESCE(minutes_worked, payable_minutes)
    END,
    approved_payable_minutes = CASE
      WHEN COALESCE(minutes_worked, 0) > 300 THEN GREATEST(COALESCE(minutes_worked, 0) - 30, 0)
      ELSE COALESCE(minutes_worked, approved_payable_minutes)
    END,
    attendance_state = CASE
      WHEN clock_out_at IS NOT NULL THEN 'clocked_out'::attendance_state
      WHEN clock_in_at IS NOT NULL THEN 'clocked_in'::attendance_state
      ELSE attendance_state
    END,
    updated_at = now()
WHERE gross_minutes IS NULL
   OR payable_minutes IS NULL
   OR approved_payable_minutes IS NULL;

