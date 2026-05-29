BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_integration_area')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum
       WHERE enumtypid = 'microsoft_integration_area'::regtype
         AND enumlabel = 'client_intake'
     ) THEN
    ALTER TYPE microsoft_integration_area ADD VALUE 'client_intake';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_client_intake_record_type') THEN
    CREATE TYPE microsoft_client_intake_record_type AS ENUM (
      'job',
      'job_readiness_item'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_client_intake_mapping_status') THEN
    CREATE TYPE microsoft_client_intake_mapping_status AS ENUM (
      'active',
      'paused',
      'archived'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_client_intake_submission_status') THEN
    CREATE TYPE microsoft_client_intake_submission_status AS ENUM (
      'received_matched',
      'received_unmatched',
      'under_review',
      'approved',
      'rejected',
      'archived'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_client_intake_event_type') THEN
    CREATE TYPE microsoft_client_intake_event_type AS ENUM (
      'mapping_upserted',
      'submission_received',
      'submission_matched',
      'submission_unmatched',
      'reviewer_notified',
      'reviewer_notification_failed',
      'client_confirmation_queued',
      'client_confirmation_failed',
      'reminder_queued',
      'reminder_failed',
      'approved',
      'rejected',
      'resource_linked'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS microsoft_client_intake_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  related_record_type microsoft_client_intake_record_type NOT NULL,
  related_record_id text NOT NULL,
  canonical_dashboard_id text NOT NULL,
  job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
  required_item_id uuid REFERENCES job_readiness_items(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  primary_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  department_scope text,
  related_record_label text,
  request_mode text NOT NULL DEFAULT 'sharepoint_request_files',
  request_link_url text NOT NULL,
  request_link_external_id text,
  sharepoint_site_url text NOT NULL,
  sharepoint_library_name text NOT NULL,
  sharepoint_folder_path text NOT NULL,
  sharepoint_folder_url text,
  forms_schema_key text,
  recipient_name_override text,
  recipient_email_override text,
  reviewer_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  reminder_enabled boolean NOT NULL DEFAULT true,
  reminder_cadence_hours integer NOT NULL DEFAULT 72,
  last_submission_at timestamptz,
  last_submission_status microsoft_client_intake_submission_status,
  last_reminder_sent_at timestamptz,
  last_reminder_trigger_type text,
  status microsoft_client_intake_mapping_status NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, related_record_type, related_record_id)
);

CREATE INDEX IF NOT EXISTS microsoft_client_intake_mapping_status_idx
  ON microsoft_client_intake_mapping (tenant_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS microsoft_client_intake_mapping_request_link_idx
  ON microsoft_client_intake_mapping (tenant_id, request_link_external_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS microsoft_client_intake_mapping_job_idx
  ON microsoft_client_intake_mapping (tenant_id, job_id, required_item_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS microsoft_client_intake_submission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  mapping_id uuid REFERENCES microsoft_client_intake_mapping(id) ON DELETE SET NULL,
  related_record_type microsoft_client_intake_record_type,
  related_record_id text,
  canonical_dashboard_id text,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  required_item_id uuid REFERENCES job_readiness_items(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  primary_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  request_link_external_id text,
  request_link_url text,
  sharepoint_site_url text,
  sharepoint_library_name text,
  sharepoint_folder_path text,
  sharepoint_folder_url text,
  provider_submission_key text NOT NULL,
  microsoft_drive_id text,
  microsoft_drive_item_id text,
  resource_library_item_id uuid REFERENCES resource_library_item(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  file_url text,
  content_type text,
  file_size_bytes bigint,
  uploader_name text,
  uploader_email text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  matching_status microsoft_client_intake_submission_status NOT NULL DEFAULT 'received_unmatched',
  match_rule text,
  match_confidence integer NOT NULL DEFAULT 0,
  reviewer_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  review_note text,
  reviewed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  confirmation_delivery_id uuid REFERENCES microsoft_mail_automation_delivery(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider_submission_key)
);

CREATE INDEX IF NOT EXISTS microsoft_client_intake_submission_status_idx
  ON microsoft_client_intake_submission (tenant_id, matching_status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS microsoft_client_intake_submission_mapping_idx
  ON microsoft_client_intake_submission (tenant_id, mapping_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS microsoft_client_intake_submission_record_idx
  ON microsoft_client_intake_submission (tenant_id, related_record_type, related_record_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS microsoft_client_intake_submission_drive_item_idx
  ON microsoft_client_intake_submission (tenant_id, microsoft_drive_item_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS microsoft_client_intake_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  mapping_id uuid REFERENCES microsoft_client_intake_mapping(id) ON DELETE SET NULL,
  submission_id uuid REFERENCES microsoft_client_intake_submission(id) ON DELETE CASCADE,
  event_type microsoft_client_intake_event_type NOT NULL,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS microsoft_client_intake_event_mapping_idx
  ON microsoft_client_intake_event (tenant_id, mapping_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS microsoft_client_intake_event_submission_idx
  ON microsoft_client_intake_event (tenant_id, submission_id, occurred_at DESC);

ALTER TABLE microsoft_client_intake_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE microsoft_client_intake_mapping FORCE ROW LEVEL SECURITY;
ALTER TABLE microsoft_client_intake_submission ENABLE ROW LEVEL SECURITY;
ALTER TABLE microsoft_client_intake_submission FORCE ROW LEVEL SECURITY;
ALTER TABLE microsoft_client_intake_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE microsoft_client_intake_event FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'microsoft_client_intake_mapping'
      AND policyname = 'tenant_isolation_microsoft_client_intake_mapping'
  ) THEN
    CREATE POLICY tenant_isolation_microsoft_client_intake_mapping ON microsoft_client_intake_mapping
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
      AND tablename = 'microsoft_client_intake_submission'
      AND policyname = 'tenant_isolation_microsoft_client_intake_submission'
  ) THEN
    CREATE POLICY tenant_isolation_microsoft_client_intake_submission ON microsoft_client_intake_submission
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
      AND tablename = 'microsoft_client_intake_event'
      AND policyname = 'tenant_isolation_microsoft_client_intake_event'
  ) THEN
    CREATE POLICY tenant_isolation_microsoft_client_intake_event ON microsoft_client_intake_event
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

COMMIT;
