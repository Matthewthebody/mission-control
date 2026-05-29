BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_integration_area')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum
       WHERE enumtypid = 'microsoft_integration_area'::regtype
         AND enumlabel = 'sms_automation'
     ) THEN
    ALTER TYPE microsoft_integration_area ADD VALUE 'sms_automation';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_sms_consent_status') THEN
    CREATE TYPE microsoft_sms_consent_status AS ENUM (
      'unknown',
      'opted_in',
      'opted_out',
      'suppressed'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_sms_consent_source') THEN
    CREATE TYPE microsoft_sms_consent_source AS ENUM (
      'manual_internal',
      'portal_opt_in',
      'client_reply',
      'compliance_import'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_sms_record_type') THEN
    CREATE TYPE microsoft_sms_record_type AS ENUM (
      'job',
      'job_readiness_item'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_sms_trigger_type') THEN
    CREATE TYPE microsoft_sms_trigger_type AS ENUM (
      'reminder',
      'overdue',
      'manual'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_sms_delivery_status') THEN
    CREATE TYPE microsoft_sms_delivery_status AS ENUM (
      'queued',
      'dispatching',
      'provider_accepted',
      'sent',
      'delivered',
      'failed',
      'skipped',
      'throttled',
      'archived'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_sms_event_type') THEN
    CREATE TYPE microsoft_sms_event_type AS ENUM (
      'consent_upserted',
      'queued',
      'dispatching',
      'provider_accepted',
      'sent',
      'delivered',
      'failed',
      'skipped',
      'throttled',
      'replayed',
      'callback_received',
      'opted_out',
      'alerted'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS microsoft_sms_consent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  phone_number text NOT NULL,
  normalized_phone_number text NOT NULL,
  consent_status microsoft_sms_consent_status NOT NULL DEFAULT 'unknown',
  consent_source microsoft_sms_consent_source NOT NULL DEFAULT 'manual_internal',
  consent_captured_at timestamptz,
  consent_expires_at timestamptz,
  last_confirmed_at timestamptz,
  suppress_until timestamptz,
  opt_out_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, normalized_phone_number)
);

CREATE INDEX IF NOT EXISTS microsoft_sms_consent_contact_idx
  ON microsoft_sms_consent (tenant_id, contact_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS microsoft_sms_consent_status_idx
  ON microsoft_sms_consent (tenant_id, consent_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS microsoft_sms_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'microsoft365_sms_automation',
  related_record_type microsoft_sms_record_type NOT NULL,
  related_record_id text NOT NULL,
  canonical_dashboard_id text,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  required_item_id uuid REFERENCES job_readiness_items(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  consent_id uuid REFERENCES microsoft_sms_consent(id) ON DELETE SET NULL,
  recipient_name text,
  recipient_phone_number text NOT NULL,
  normalized_phone_number text NOT NULL,
  sender_key text NOT NULL,
  sender_number text NOT NULL,
  template_key text NOT NULL,
  flow_key text NOT NULL,
  trigger_type microsoft_sms_trigger_type NOT NULL,
  status microsoft_sms_delivery_status NOT NULL DEFAULT 'queued',
  message_body text NOT NULL,
  dashboard_url text,
  secure_link_url text,
  provider_message_id text,
  provider_message_url text,
  flow_run_id text,
  flow_run_url text,
  sync_operation_id uuid REFERENCES integration_sync_operation(id) ON DELETE SET NULL,
  source_change_key text,
  attempt_count integer NOT NULL DEFAULT 0,
  queued_at timestamptz NOT NULL DEFAULT now(),
  first_dispatched_at timestamptz,
  last_dispatched_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS microsoft_sms_delivery_record_idx
  ON microsoft_sms_delivery (tenant_id, related_record_type, related_record_id, created_at DESC);

CREATE INDEX IF NOT EXISTS microsoft_sms_delivery_status_idx
  ON microsoft_sms_delivery (tenant_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS microsoft_sms_delivery_phone_idx
  ON microsoft_sms_delivery (tenant_id, normalized_phone_number, created_at DESC);

CREATE INDEX IF NOT EXISTS microsoft_sms_delivery_trigger_idx
  ON microsoft_sms_delivery (tenant_id, trigger_type, queued_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS microsoft_sms_delivery_source_change_uidx
  ON microsoft_sms_delivery (tenant_id, flow_key, source_change_key)
  WHERE source_change_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS microsoft_sms_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  delivery_id uuid NOT NULL REFERENCES microsoft_sms_delivery(id) ON DELETE CASCADE,
  event_type microsoft_sms_event_type NOT NULL,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS microsoft_sms_event_delivery_idx
  ON microsoft_sms_event (tenant_id, delivery_id, occurred_at DESC);

ALTER TABLE microsoft_sms_consent ENABLE ROW LEVEL SECURITY;
ALTER TABLE microsoft_sms_consent FORCE ROW LEVEL SECURITY;
ALTER TABLE microsoft_sms_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE microsoft_sms_delivery FORCE ROW LEVEL SECURITY;
ALTER TABLE microsoft_sms_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE microsoft_sms_event FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'microsoft_sms_consent'
      AND policyname = 'tenant_isolation_microsoft_sms_consent'
  ) THEN
    CREATE POLICY tenant_isolation_microsoft_sms_consent ON microsoft_sms_consent
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'microsoft_sms_delivery'
      AND policyname = 'tenant_isolation_microsoft_sms_delivery'
  ) THEN
    CREATE POLICY tenant_isolation_microsoft_sms_delivery ON microsoft_sms_delivery
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'microsoft_sms_event'
      AND policyname = 'tenant_isolation_microsoft_sms_event'
  ) THEN
    CREATE POLICY tenant_isolation_microsoft_sms_event ON microsoft_sms_event
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

COMMIT;
