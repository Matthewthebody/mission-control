ALTER TABLE time_segment
  ADD COLUMN IF NOT EXISTS linked_shift_id uuid REFERENCES work_shift(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supersedes_segment_id uuid REFERENCES time_segment(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reporting_flags text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE exception_request
  ADD COLUMN IF NOT EXISTS linked_shift_id uuid REFERENCES work_shift(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requested_approver_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_attendance_exception_id uuid REFERENCES attendance_exception(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS original_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS resolved_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reporting_flags text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS time_segment_linked_shift_idx
  ON time_segment (tenant_id, linked_shift_id, start_time DESC);

CREATE INDEX IF NOT EXISTS time_segment_supersedes_idx
  ON time_segment (tenant_id, supersedes_segment_id)
  WHERE supersedes_segment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS exception_request_linked_shift_idx
  ON exception_request (tenant_id, linked_shift_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS exception_request_related_attendance_idx
  ON exception_request (tenant_id, related_attendance_exception_id)
  WHERE related_attendance_exception_id IS NOT NULL;
