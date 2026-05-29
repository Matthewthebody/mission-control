BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_integration_area')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum
       WHERE enumtypid = 'microsoft_integration_area'::regtype
         AND enumlabel = 'mail_automation'
     ) THEN
    ALTER TYPE microsoft_integration_area ADD VALUE 'mail_automation';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_mail_automation_record_type') THEN
    CREATE TYPE microsoft_mail_automation_record_type AS ENUM (
      'organization',
      'job',
      'job_readiness_item',
      'post_shoot_evaluation',
      'work_task',
      'operational_approval_request',
      'communication_event'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_mail_automation_trigger_type') THEN
    CREATE TYPE microsoft_mail_automation_trigger_type AS ENUM (
      'kickoff',
      'reminder',
      'overdue',
      'confirmation',
      'approval_request',
      'escalation',
      'manual'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_mail_template_storage_type') THEN
    CREATE TYPE microsoft_mail_template_storage_type AS ENUM (
      'sharepoint_file',
      'sharepoint_list_item'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_mail_automation_status') THEN
    CREATE TYPE microsoft_mail_automation_status AS ENUM (
      'queued',
      'dispatching',
      'flow_accepted',
      'sent',
      'failed',
      'skipped',
      'throttled',
      'archived'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_mail_automation_event_type') THEN
    CREATE TYPE microsoft_mail_automation_event_type AS ENUM (
      'queued',
      'dispatching',
      'flow_accepted',
      'sent',
      'failed',
      'skipped',
      'throttled',
      'replayed',
      'callback_received',
      'alerted'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS microsoft_shared_mailbox_contract (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  mailbox_key text NOT NULL,
  display_name text NOT NULL,
  alias_address text NOT NULL,
  department_scope text,
  mailbox_purpose text NOT NULL,
  send_as_mode text NOT NULL DEFAULT 'shared_mailbox',
  fallback_mailbox_key text,
  microsoft_object_id text,
  microsoft_url text,
  owner_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  active_status boolean NOT NULL DEFAULT true,
  last_sync_error text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, mailbox_key)
);

CREATE INDEX IF NOT EXISTS microsoft_shared_mailbox_contract_tenant_scope_idx
  ON microsoft_shared_mailbox_contract (tenant_id, department_scope, active_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS microsoft_mail_template_contract (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_key text NOT NULL,
  template_name text NOT NULL,
  template_family text NOT NULL,
  department_scope text,
  shared_mailbox_key text NOT NULL,
  storage_provider microsoft_mail_template_storage_type NOT NULL DEFAULT 'sharepoint_file',
  sharepoint_site_url text,
  sharepoint_library_name text,
  storage_path text,
  template_url text,
  subject_hint text,
  merge_tokens jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_tokens jsonb NOT NULL DEFAULT '[]'::jsonb,
  owner_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  active_status boolean NOT NULL DEFAULT true,
  last_sync_error text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, template_key)
);

CREATE INDEX IF NOT EXISTS microsoft_mail_template_contract_tenant_scope_idx
  ON microsoft_mail_template_contract (tenant_id, department_scope, active_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS microsoft_mail_automation_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'microsoft365_mail_automation',
  related_record_type microsoft_mail_automation_record_type NOT NULL,
  related_record_id text NOT NULL,
  canonical_dashboard_id text,
  contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  recipient_name text,
  recipient_email text NOT NULL,
  shared_mailbox_key text NOT NULL,
  sender_alias text NOT NULL,
  template_key text NOT NULL,
  template_url text,
  flow_key text NOT NULL,
  trigger_type microsoft_mail_automation_trigger_type NOT NULL,
  status microsoft_mail_automation_status NOT NULL DEFAULT 'queued',
  subject_hint text,
  merge_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  dashboard_url text,
  microsoft_message_id text,
  microsoft_message_url text,
  flow_run_id text,
  flow_run_url text,
  sync_operation_id uuid REFERENCES integration_sync_operation(id) ON DELETE SET NULL,
  source_change_key text,
  attempt_count integer NOT NULL DEFAULT 0,
  queued_at timestamptz NOT NULL DEFAULT now(),
  first_dispatched_at timestamptz,
  last_dispatched_at timestamptz,
  sent_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS microsoft_mail_automation_delivery_tenant_record_idx
  ON microsoft_mail_automation_delivery (tenant_id, related_record_type, related_record_id, created_at DESC);

CREATE INDEX IF NOT EXISTS microsoft_mail_automation_delivery_tenant_status_idx
  ON microsoft_mail_automation_delivery (tenant_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS microsoft_mail_automation_delivery_tenant_mailbox_idx
  ON microsoft_mail_automation_delivery (tenant_id, shared_mailbox_key, created_at DESC);

CREATE INDEX IF NOT EXISTS microsoft_mail_automation_delivery_tenant_flow_idx
  ON microsoft_mail_automation_delivery (tenant_id, flow_key, queued_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS microsoft_mail_automation_delivery_source_change_uidx
  ON microsoft_mail_automation_delivery (tenant_id, flow_key, source_change_key)
  WHERE source_change_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS microsoft_mail_automation_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  delivery_id uuid NOT NULL REFERENCES microsoft_mail_automation_delivery(id) ON DELETE CASCADE,
  event_type microsoft_mail_automation_event_type NOT NULL,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS microsoft_mail_automation_event_tenant_delivery_idx
  ON microsoft_mail_automation_event (tenant_id, delivery_id, occurred_at DESC);

ALTER TABLE microsoft_shared_mailbox_contract ENABLE ROW LEVEL SECURITY;
ALTER TABLE microsoft_shared_mailbox_contract FORCE ROW LEVEL SECURITY;
ALTER TABLE microsoft_mail_template_contract ENABLE ROW LEVEL SECURITY;
ALTER TABLE microsoft_mail_template_contract FORCE ROW LEVEL SECURITY;
ALTER TABLE microsoft_mail_automation_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE microsoft_mail_automation_delivery FORCE ROW LEVEL SECURITY;
ALTER TABLE microsoft_mail_automation_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE microsoft_mail_automation_event FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'microsoft_shared_mailbox_contract'
      AND policyname = 'tenant_isolation_microsoft_shared_mailbox_contract'
  ) THEN
    CREATE POLICY tenant_isolation_microsoft_shared_mailbox_contract ON microsoft_shared_mailbox_contract
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
      AND tablename = 'microsoft_mail_template_contract'
      AND policyname = 'tenant_isolation_microsoft_mail_template_contract'
  ) THEN
    CREATE POLICY tenant_isolation_microsoft_mail_template_contract ON microsoft_mail_template_contract
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
      AND tablename = 'microsoft_mail_automation_delivery'
      AND policyname = 'tenant_isolation_microsoft_mail_automation_delivery'
  ) THEN
    CREATE POLICY tenant_isolation_microsoft_mail_automation_delivery ON microsoft_mail_automation_delivery
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
      AND tablename = 'microsoft_mail_automation_event'
      AND policyname = 'tenant_isolation_microsoft_mail_automation_event'
  ) THEN
    CREATE POLICY tenant_isolation_microsoft_mail_automation_event ON microsoft_mail_automation_event
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

COMMIT;
