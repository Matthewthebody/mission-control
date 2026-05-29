-- migrate: no-transaction

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_assignment_status_type') THEN
    CREATE TYPE workflow_assignment_status_type AS ENUM (
      'needs_assignment',
      'queued',
      'claimed',
      'assigned',
      'in_progress',
      'waiting_on_info',
      'completed',
      'returned'
    );
  END IF;
END $$;

ALTER TYPE workflow_handoff_status_type ADD VALUE IF NOT EXISTS 'sent_to_production';
ALTER TYPE workflow_handoff_status_type ADD VALUE IF NOT EXISTS 'accepted_by_production';
ALTER TYPE workflow_handoff_status_type ADD VALUE IF NOT EXISTS 'waiting_on_info';
ALTER TYPE workflow_handoff_status_type ADD VALUE IF NOT EXISTS 'production_complete';
ALTER TYPE workflow_handoff_status_type ADD VALUE IF NOT EXISTS 'returned_to_schools';
ALTER TYPE workflow_handoff_status_type ADD VALUE IF NOT EXISTS 'returned_with_issue';

ALTER TABLE workflow_step
  ADD COLUMN IF NOT EXISTS assignment_status workflow_assignment_status_type,
  ADD COLUMN IF NOT EXISTS assigned_queue work_department_type,
  ADD COLUMN IF NOT EXISTS assigned_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS waiting_on_party text,
  ADD COLUMN IF NOT EXISTS waiting_detail text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workflow_step_waiting_on_party_chk'
  ) THEN
    ALTER TABLE workflow_step
      ADD CONSTRAINT workflow_step_waiting_on_party_chk
      CHECK (
        waiting_on_party IS NULL
        OR waiting_on_party IN ('school', 'kp', 'production', 'graphics', 'customer_service', 'vendor', 'family', 'other', 'none', 'unknown')
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE workflow_handoff
  ADD COLUMN IF NOT EXISTS sent_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS returned_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS issue_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS return_reason text;

UPDATE workflow_handoff
SET sent_at = COALESCE(sent_at, sla_started_at, created_at),
    sent_by_user_id = COALESCE(sent_by_user_id, created_by_user_id)
WHERE sent_at IS NULL
   OR sent_by_user_id IS NULL;

CREATE INDEX IF NOT EXISTS workflow_step_assignment_queue_idx
  ON workflow_step (tenant_id, assigned_queue, assignment_status, status, updated_at DESC)
  WHERE assigned_queue IS NOT NULL OR assignment_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS workflow_step_waiting_party_idx
  ON workflow_step (tenant_id, waiting_on_party, status, updated_at DESC)
  WHERE waiting_on_party IS NOT NULL;

CREATE INDEX IF NOT EXISTS workflow_handoff_production_queue_idx
  ON workflow_handoff (tenant_id, to_department, status, updated_at DESC, created_at DESC)
  WHERE to_department = 'production'::work_department_type;
