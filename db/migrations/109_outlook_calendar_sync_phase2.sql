DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'outlook_shift_sync_status'
  ) THEN
    CREATE TYPE outlook_shift_sync_status AS ENUM (
      'not_queued',
      'pending',
      'processing',
      'synced',
      'failed',
      'cancelled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'outlook_conflict_status'
  ) THEN
    CREATE TYPE outlook_conflict_status AS ENUM (
      'clear',
      'warning',
      'blocking'
    );
  END IF;
END $$;

ALTER TABLE work_shift
  ADD COLUMN IF NOT EXISTS outlook_event_id text,
  ADD COLUMN IF NOT EXISTS outlook_calendar_owner_email text,
  ADD COLUMN IF NOT EXISTS sync_status outlook_shift_sync_status NOT NULL DEFAULT 'not_queued',
  ADD COLUMN IF NOT EXISTS synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_error text,
  ADD COLUMN IF NOT EXISTS conflict_status outlook_conflict_status NOT NULL DEFAULT 'clear',
  ADD COLUMN IF NOT EXISTS conflict_detail jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE work_shift
SET synced_at = COALESCE(synced_at, calendar_last_synced_at),
    last_sync_attempt_at = COALESCE(last_sync_attempt_at, calendar_last_synced_at),
    sync_error = COALESCE(sync_error, calendar_last_error),
    sync_status = CASE
      WHEN cancelled_at IS NOT NULL THEN 'cancelled'::outlook_shift_sync_status
      WHEN calendar_last_error IS NOT NULL THEN 'failed'::outlook_shift_sync_status
      WHEN calendar_last_synced_at IS NOT NULL THEN 'synced'::outlook_shift_sync_status
      WHEN calendar_sync_required THEN 'pending'::outlook_shift_sync_status
      ELSE 'not_queued'::outlook_shift_sync_status
    END
WHERE synced_at IS NULL
   OR last_sync_attempt_at IS NULL
   OR sync_error IS NULL
   OR sync_status = 'not_queued'::outlook_shift_sync_status;

CREATE INDEX IF NOT EXISTS work_shift_tenant_sync_status_idx
  ON work_shift (tenant_id, sync_status, starts_at)
  WHERE cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS work_shift_tenant_calendar_sync_required_idx
  ON work_shift (tenant_id, calendar_sync_required, starts_at)
  WHERE cancelled_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS work_shift_tenant_outlook_event_uidx
  ON work_shift (tenant_id, outlook_calendar_owner_email, outlook_event_id)
  WHERE outlook_event_id IS NOT NULL
    AND outlook_calendar_owner_email IS NOT NULL;
