-- Focused release-gate/dashboard hot-path indexes.
-- These support existing read paths without changing response shape or ownership.

CREATE INDEX IF NOT EXISTS shoot_home_dashboard_tenant_date_idx
  ON shoot (tenant_id, shoot_date, record_state, created_at, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS work_shift_home_dashboard_published_window_idx
  ON work_shift (tenant_id, status, starts_at, ends_at)
  WHERE cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS attendance_exception_home_dashboard_open_idx
  ON attendance_exception (tenant_id, status, created_at DESC, user_id, shift_id, shoot_id);

CREATE INDEX IF NOT EXISTS time_clock_presence_incident_open_employee_shift_idx
  ON time_clock_presence_incident (tenant_id, resolution_status, employee_id, shift_id, last_observed_at DESC);

CREATE INDEX IF NOT EXISTS time_clock_presence_incident_open_employee_shoot_idx
  ON time_clock_presence_incident (tenant_id, resolution_status, employee_id, shoot_id, last_observed_at DESC);
