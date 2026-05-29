BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_client_intake_exception_state') THEN
    CREATE TYPE microsoft_client_intake_exception_state AS ENUM (
      'none',
      'waiting_on_client',
      'paused',
      'manually_overridden'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_client_intake_submission_status')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum
       WHERE enumtypid = 'microsoft_client_intake_submission_status'::regtype
         AND enumlabel = 'revision_requested'
     ) THEN
    ALTER TYPE microsoft_client_intake_submission_status ADD VALUE 'revision_requested';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_client_intake_event_type')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum
       WHERE enumtypid = 'microsoft_client_intake_event_type'::regtype
         AND enumlabel = 'reviewer_assigned'
     ) THEN
    ALTER TYPE microsoft_client_intake_event_type ADD VALUE 'reviewer_assigned';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_client_intake_event_type')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum
       WHERE enumtypid = 'microsoft_client_intake_event_type'::regtype
         AND enumlabel = 'revision_requested'
     ) THEN
    ALTER TYPE microsoft_client_intake_event_type ADD VALUE 'revision_requested';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_client_intake_event_type')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum
       WHERE enumtypid = 'microsoft_client_intake_event_type'::regtype
         AND enumlabel = 'exception_state_changed'
     ) THEN
    ALTER TYPE microsoft_client_intake_event_type ADD VALUE 'exception_state_changed';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_client_intake_event_type')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum
       WHERE enumtypid = 'microsoft_client_intake_event_type'::regtype
         AND enumlabel = 'escalation_queued'
     ) THEN
    ALTER TYPE microsoft_client_intake_event_type ADD VALUE 'escalation_queued';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_client_intake_event_type')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum
       WHERE enumtypid = 'microsoft_client_intake_event_type'::regtype
         AND enumlabel = 'escalation_failed'
     ) THEN
    ALTER TYPE microsoft_client_intake_event_type ADD VALUE 'escalation_failed';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_client_intake_event_type')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum
       WHERE enumtypid = 'microsoft_client_intake_event_type'::regtype
         AND enumlabel = 'digest_queued'
     ) THEN
    ALTER TYPE microsoft_client_intake_event_type ADD VALUE 'digest_queued';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_client_intake_event_type')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum
       WHERE enumtypid = 'microsoft_client_intake_event_type'::regtype
         AND enumlabel = 'digest_failed'
     ) THEN
    ALTER TYPE microsoft_client_intake_event_type ADD VALUE 'digest_failed';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_client_intake_event_type')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum
       WHERE enumtypid = 'microsoft_client_intake_event_type'::regtype
         AND enumlabel = 'manual_override_applied'
     ) THEN
    ALTER TYPE microsoft_client_intake_event_type ADD VALUE 'manual_override_applied';
  END IF;
END $$;

ALTER TABLE microsoft_client_intake_mapping
  ADD COLUMN IF NOT EXISTS manager_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS department_lead_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS review_due_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS first_escalation_hours integer NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS second_escalation_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS digest_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_submission_exception_state microsoft_client_intake_exception_state;

ALTER TABLE microsoft_client_intake_submission
  ADD COLUMN IF NOT EXISTS assigned_reviewer_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS exception_state microsoft_client_intake_exception_state NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS exception_note text,
  ADD COLUMN IF NOT EXISTS exception_set_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS exception_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_escalation_at timestamptz,
  ADD COLUMN IF NOT EXISTS second_escalation_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_level integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revision_requested_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revision_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS revision_request_delivery_id uuid REFERENCES microsoft_mail_automation_delivery(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS microsoft_client_intake_submission_review_queue_idx
  ON microsoft_client_intake_submission (tenant_id, matching_status, exception_state, review_due_at ASC, submitted_at DESC);

CREATE INDEX IF NOT EXISTS microsoft_client_intake_submission_escalation_idx
  ON microsoft_client_intake_submission (tenant_id, escalation_level, submitted_at DESC);

CREATE INDEX IF NOT EXISTS microsoft_client_intake_mapping_operational_idx
  ON microsoft_client_intake_mapping (tenant_id, status, digest_enabled, updated_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operational_alert_type')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum
       WHERE enumtypid = 'operational_alert_type'::regtype
         AND enumlabel = 'client_intake_review_overdue'
     ) THEN
    ALTER TYPE operational_alert_type ADD VALUE 'client_intake_review_overdue';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operational_alert_type')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum
       WHERE enumtypid = 'operational_alert_type'::regtype
         AND enumlabel = 'client_intake_escalated'
     ) THEN
    ALTER TYPE operational_alert_type ADD VALUE 'client_intake_escalated';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operational_alert_type')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum
       WHERE enumtypid = 'operational_alert_type'::regtype
         AND enumlabel = 'client_intake_daily_digest'
     ) THEN
    ALTER TYPE operational_alert_type ADD VALUE 'client_intake_daily_digest';
  END IF;
END $$;

COMMIT;
