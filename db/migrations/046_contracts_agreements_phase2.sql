DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agreement_signer_type') THEN
    CREATE TYPE agreement_signer_type AS ENUM (
      'external',
      'internal',
      'countersigner'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agreement_signer_status') THEN
    CREATE TYPE agreement_signer_status AS ENUM (
      'pending',
      'viewed',
      'signed',
      'replaced',
      'cancelled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agreement_version_stage') THEN
    CREATE TYPE agreement_version_stage AS ENUM (
      'draft',
      'revised',
      'signed',
      'countersigned_final',
      'legacy_import'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agreement_reminder_type') THEN
    CREATE TYPE agreement_reminder_type AS ENUM (
      'unsigned_3_day',
      'unsigned_30_day',
      'expiration_6_month',
      'expiration_90_day',
      'expiration_30_day',
      'manual_follow_up'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agreement_reminder_channel') THEN
    CREATE TYPE agreement_reminder_channel AS ENUM (
      'email',
      'internal_notice'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agreement_reminder_status') THEN
    CREATE TYPE agreement_reminder_status AS ENUM (
      'queued',
      'sent',
      'skipped',
      'cancelled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agreement_activity_type') THEN
    ALTER TYPE agreement_activity_type ADD VALUE IF NOT EXISTS 'template_created';
    ALTER TYPE agreement_activity_type ADD VALUE IF NOT EXISTS 'template_updated';
    ALTER TYPE agreement_activity_type ADD VALUE IF NOT EXISTS 'draft_created_from_template';
    ALTER TYPE agreement_activity_type ADD VALUE IF NOT EXISTS 'signer_added';
    ALTER TYPE agreement_activity_type ADD VALUE IF NOT EXISTS 'signer_updated';
    ALTER TYPE agreement_activity_type ADD VALUE IF NOT EXISTS 'reminder_sent';
    ALTER TYPE agreement_activity_type ADD VALUE IF NOT EXISTS 'renewal_draft_created';
    ALTER TYPE agreement_activity_type ADD VALUE IF NOT EXISTS 'version_created';
    ALTER TYPE agreement_activity_type ADD VALUE IF NOT EXISTS 'version_superseded';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agreement_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_name text NOT NULL,
  agreement_type agreement_type NOT NULL,
  active_status boolean NOT NULL DEFAULT true,
  template_body text,
  template_file_reference text,
  merge_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agreement_template_name_trimmed_chk CHECK (length(trim(template_name)) >= 2),
  CONSTRAINT agreement_template_body_or_file_chk CHECK (
    NULLIF(trim(COALESCE(template_body, '')), '') IS NOT NULL
    OR NULLIF(trim(COALESCE(template_file_reference, '')), '') IS NOT NULL
  )
);

ALTER TABLE agreement
  ADD COLUMN IF NOT EXISTS source_template_id uuid REFERENCES agreement_template(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS agreement_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  agreement_id uuid NOT NULL REFERENCES agreement(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  version_label text NOT NULL,
  version_stage agreement_version_stage NOT NULL DEFAULT 'draft',
  prior_version_id uuid REFERENCES agreement_version(id) ON DELETE SET NULL,
  source_template_id uuid REFERENCES agreement_template(id) ON DELETE SET NULL,
  rendered_body text,
  merge_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_current boolean NOT NULL DEFAULT false,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agreement_version_number_chk CHECK (version_number > 0),
  CONSTRAINT agreement_version_label_trimmed_chk CHECK (length(trim(version_label)) >= 1),
  CONSTRAINT agreement_version_self_prior_chk CHECK (prior_version_id IS NULL OR prior_version_id <> id),
  UNIQUE (tenant_id, agreement_id, version_number)
);

ALTER TABLE agreement_file
  ADD COLUMN IF NOT EXISTS agreement_version_id uuid REFERENCES agreement_version(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS agreement_signer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  agreement_id uuid NOT NULL REFERENCES agreement(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  signer_name text NOT NULL,
  signer_email text,
  signer_role text,
  signer_order integer,
  signer_type agreement_signer_type NOT NULL DEFAULT 'external',
  status agreement_signer_status NOT NULL DEFAULT 'pending',
  viewed_at timestamptz,
  signed_at timestamptz,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agreement_signer_name_trimmed_chk CHECK (length(trim(signer_name)) >= 1)
);

CREATE TABLE IF NOT EXISTS agreement_reminder (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  agreement_id uuid NOT NULL REFERENCES agreement(id) ON DELETE CASCADE,
  signer_id uuid REFERENCES agreement_signer(id) ON DELETE SET NULL,
  reminder_type agreement_reminder_type NOT NULL,
  reminder_channel agreement_reminder_channel NOT NULL,
  status agreement_reminder_status NOT NULL DEFAULT 'queued',
  follow_up_state text,
  recipient_name text,
  recipient_email text,
  due_at timestamptz,
  sent_at timestamptz,
  triggered_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agreement_template_tenant_type_idx
  ON agreement_template (tenant_id, agreement_type, active_status, lower(template_name));

CREATE INDEX IF NOT EXISTS agreement_version_tenant_agreement_idx
  ON agreement_version (tenant_id, agreement_id, version_number DESC);

CREATE UNIQUE INDEX IF NOT EXISTS agreement_version_current_uq
  ON agreement_version (tenant_id, agreement_id)
  WHERE is_current = true;

CREATE INDEX IF NOT EXISTS agreement_file_version_idx
  ON agreement_file (tenant_id, agreement_version_id)
  WHERE agreement_version_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agreement_signer_tenant_agreement_idx
  ON agreement_signer (tenant_id, agreement_id, signer_order NULLS LAST, created_at ASC);

CREATE INDEX IF NOT EXISTS agreement_signer_tenant_status_idx
  ON agreement_signer (tenant_id, signer_type, status, signed_at DESC);

CREATE INDEX IF NOT EXISTS agreement_reminder_tenant_agreement_idx
  ON agreement_reminder (tenant_id, agreement_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agreement_reminder_due_idx
  ON agreement_reminder (tenant_id, reminder_type, status, due_at)
  WHERE due_at IS NOT NULL;

ALTER TABLE agreement_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_template FORCE ROW LEVEL SECURITY;
ALTER TABLE agreement_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_version FORCE ROW LEVEL SECURITY;
ALTER TABLE agreement_signer ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_signer FORCE ROW LEVEL SECURITY;
ALTER TABLE agreement_reminder ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_reminder FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agreement_template'
      AND policyname = 'tenant_isolation_agreement_template'
  ) THEN
    CREATE POLICY tenant_isolation_agreement_template ON agreement_template
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
      AND tablename = 'agreement_version'
      AND policyname = 'tenant_isolation_agreement_version'
  ) THEN
    CREATE POLICY tenant_isolation_agreement_version ON agreement_version
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
      AND tablename = 'agreement_signer'
      AND policyname = 'tenant_isolation_agreement_signer'
  ) THEN
    CREATE POLICY tenant_isolation_agreement_signer ON agreement_signer
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
      AND tablename = 'agreement_reminder'
      AND policyname = 'tenant_isolation_agreement_reminder'
  ) THEN
    CREATE POLICY tenant_isolation_agreement_reminder ON agreement_reminder
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
