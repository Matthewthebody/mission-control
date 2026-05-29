DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agreement_activity_type') THEN
    ALTER TYPE agreement_activity_type ADD VALUE IF NOT EXISTS 'sent_via_provider';
    ALTER TYPE agreement_activity_type ADD VALUE IF NOT EXISTS 'provider_sync_updated';
    ALTER TYPE agreement_activity_type ADD VALUE IF NOT EXISTS 'provider_send_failed';
    ALTER TYPE agreement_activity_type ADD VALUE IF NOT EXISTS 'provider_sync_failed';
    ALTER TYPE agreement_activity_type ADD VALUE IF NOT EXISTS 'provider_viewed';
    ALTER TYPE agreement_activity_type ADD VALUE IF NOT EXISTS 'provider_signed';
    ALTER TYPE agreement_activity_type ADD VALUE IF NOT EXISTS 'provider_countersigned';
    ALTER TYPE agreement_activity_type ADD VALUE IF NOT EXISTS 'provider_voided';
    ALTER TYPE agreement_activity_type ADD VALUE IF NOT EXISTS 'provider_cancelled';
    ALTER TYPE agreement_activity_type ADD VALUE IF NOT EXISTS 'provider_reminder_sent';
    ALTER TYPE agreement_activity_type ADD VALUE IF NOT EXISTS 'final_signed_file_registered';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agreement_provider_event_direction') THEN
    CREATE TYPE agreement_provider_event_direction AS ENUM (
      'outbound',
      'inbound'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agreement_provider_event_type') THEN
    CREATE TYPE agreement_provider_event_type AS ENUM (
      'send_requested',
      'sent',
      'reminder_requested',
      'reminder_sent',
      'sync_requested',
      'sync_updated',
      'viewed',
      'signed',
      'countersigned',
      'completed_package_registered',
      'voided',
      'cancelled',
      'send_failed',
      'sync_failed'
    );
  END IF;
END $$;

ALTER TABLE agreement
  ADD COLUMN IF NOT EXISTS external_provider_name text,
  ADD COLUMN IF NOT EXISTS external_envelope_id text,
  ADD COLUMN IF NOT EXISTS external_status text,
  ADD COLUMN IF NOT EXISTS last_provider_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_error_state text,
  ADD COLUMN IF NOT EXISTS provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE agreement_signer
  ADD COLUMN IF NOT EXISTS external_recipient_id text,
  ADD COLUMN IF NOT EXISTS external_status text,
  ADD COLUMN IF NOT EXISTS last_provider_sync_at timestamptz;

CREATE TABLE IF NOT EXISTS agreement_provider_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  agreement_id uuid NOT NULL REFERENCES agreement(id) ON DELETE CASCADE,
  signer_id uuid REFERENCES agreement_signer(id) ON DELETE SET NULL,
  provider_name text NOT NULL,
  external_envelope_id text,
  external_recipient_id text,
  direction agreement_provider_event_direction NOT NULL,
  event_type agreement_provider_event_type NOT NULL,
  provider_status text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agreement_external_envelope_idx
  ON agreement (tenant_id, external_provider_name, external_envelope_id)
  WHERE external_envelope_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agreement_external_status_idx
  ON agreement (tenant_id, external_status, last_provider_sync_at DESC)
  WHERE external_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS agreement_provider_event_agreement_idx
  ON agreement_provider_event (tenant_id, agreement_id, occurred_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS agreement_provider_event_envelope_idx
  ON agreement_provider_event (tenant_id, provider_name, external_envelope_id, occurred_at DESC)
  WHERE external_envelope_id IS NOT NULL;

ALTER TABLE agreement_provider_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_provider_event FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agreement_provider_event'
      AND policyname = 'tenant_isolation_agreement_provider_event'
  ) THEN
    CREATE POLICY tenant_isolation_agreement_provider_event ON agreement_provider_event
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
