CREATE TABLE IF NOT EXISTS shift_note_acknowledgement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES work_shift(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  acknowledgement_scope text NOT NULL DEFAULT 'pre_service_notes',
  note_snapshot_hash text NOT NULL,
  source_module text NOT NULL DEFAULT 'employee_my_work',
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, shift_id, user_id, acknowledgement_scope, note_snapshot_hash)
);

CREATE INDEX IF NOT EXISTS idx_shift_note_acknowledgement_shift_user
  ON shift_note_acknowledgement (tenant_id, shift_id, user_id);
