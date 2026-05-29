DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agreement_type') THEN
    CREATE TYPE agreement_type AS ENUM (
      'schools',
      'sports',
      'events',
      'studio_client',
      'nda',
      'image_release'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agreement_status') THEN
    CREATE TYPE agreement_status AS ENUM (
      'draft',
      'sent',
      'viewed',
      'partially_signed',
      'signed',
      'countersigned',
      'active',
      'expiring_soon',
      'expired',
      'replaced',
      'cancelled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agreement_file_type') THEN
    CREATE TYPE agreement_file_type AS ENUM (
      'pdf',
      'image',
      'document',
      'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agreement_linked_entity_type') THEN
    CREATE TYPE agreement_linked_entity_type AS ENUM (
      'organization',
      'client_account',
      'organization_contact',
      'shoot_location'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agreement_activity_type') THEN
    CREATE TYPE agreement_activity_type AS ENUM (
      'created',
      'metadata_updated',
      'status_changed',
      'file_uploaded',
      'file_marked_current',
      'legacy_file_registered',
      'prior_agreement_linked',
      'replacement_linked',
      'note_added'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agreement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  agreement_title text NOT NULL,
  agreement_type agreement_type NOT NULL,
  status agreement_status NOT NULL DEFAULT 'draft',
  organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  client_account_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  primary_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  description text,
  contract_value numeric(12, 2),
  revenue_share_terms text,
  effective_date date,
  expiration_date date,
  renewal_date date,
  notice_deadline date,
  auto_renew boolean,
  sent_at timestamptz,
  viewed_at timestamptz,
  signed_at timestamptz,
  countersigned_at timestamptz,
  internal_countersigner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  updated_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  replaced_by_agreement_id uuid REFERENCES agreement(id) ON DELETE SET NULL,
  prior_agreement_id uuid REFERENCES agreement(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agreement_title_trimmed_chk CHECK (length(trim(agreement_title)) >= 2),
  CONSTRAINT agreement_dates_order_chk CHECK (
    expiration_date IS NULL
    OR effective_date IS NULL
    OR expiration_date >= effective_date
  ),
  CONSTRAINT agreement_self_link_chk CHECK (
    replaced_by_agreement_id IS NULL
    OR replaced_by_agreement_id <> id
  ),
  CONSTRAINT agreement_prior_self_link_chk CHECK (
    prior_agreement_id IS NULL
    OR prior_agreement_id <> id
  ),
  CONSTRAINT agreement_scope_presence_chk CHECK (
    organization_id IS NOT NULL
    OR client_account_id IS NOT NULL
    OR primary_contact_id IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS agreement_file (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  agreement_id uuid NOT NULL REFERENCES agreement(id) ON DELETE CASCADE,
  file_type agreement_file_type NOT NULL,
  file_name text NOT NULL,
  storage_reference text NOT NULL,
  file_url text,
  content_type text,
  file_size_bytes bigint,
  version_label text,
  is_current boolean NOT NULL DEFAULT false,
  uploaded_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agreement_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  agreement_id uuid NOT NULL REFERENCES agreement(id) ON DELETE CASCADE,
  linked_entity_type agreement_linked_entity_type NOT NULL,
  linked_entity_id uuid NOT NULL,
  relationship_type text NOT NULL,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, agreement_id, linked_entity_type, linked_entity_id, relationship_type)
);

CREATE TABLE IF NOT EXISTS agreement_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  agreement_id uuid NOT NULL REFERENCES agreement(id) ON DELETE CASCADE,
  activity_type agreement_activity_type NOT NULL,
  actor_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  actor_role text,
  timestamp timestamptz NOT NULL DEFAULT now(),
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS agreement_tenant_org_idx
  ON agreement (tenant_id, organization_id, updated_at DESC)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agreement_tenant_client_account_idx
  ON agreement (tenant_id, client_account_id, updated_at DESC)
  WHERE client_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agreement_tenant_contact_idx
  ON agreement (tenant_id, primary_contact_id, updated_at DESC)
  WHERE primary_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agreement_tenant_type_status_idx
  ON agreement (tenant_id, agreement_type, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS agreement_tenant_expiration_idx
  ON agreement (tenant_id, expiration_date, status)
  WHERE expiration_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS agreement_file_tenant_agreement_idx
  ON agreement_file (tenant_id, agreement_id, uploaded_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS agreement_file_current_uq
  ON agreement_file (tenant_id, agreement_id)
  WHERE is_current = true;

CREATE INDEX IF NOT EXISTS agreement_link_tenant_entity_idx
  ON agreement_link (tenant_id, linked_entity_type, linked_entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agreement_activity_log_tenant_agreement_idx
  ON agreement_activity_log (tenant_id, agreement_id, timestamp DESC);

ALTER TABLE agreement ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement FORCE ROW LEVEL SECURITY;
ALTER TABLE agreement_file ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_file FORCE ROW LEVEL SECURITY;
ALTER TABLE agreement_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_link FORCE ROW LEVEL SECURITY;
ALTER TABLE agreement_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_activity_log FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agreement'
      AND policyname = 'tenant_isolation_agreement'
  ) THEN
    CREATE POLICY tenant_isolation_agreement ON agreement
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
      AND tablename = 'agreement_file'
      AND policyname = 'tenant_isolation_agreement_file'
  ) THEN
    CREATE POLICY tenant_isolation_agreement_file ON agreement_file
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
      AND tablename = 'agreement_link'
      AND policyname = 'tenant_isolation_agreement_link'
  ) THEN
    CREATE POLICY tenant_isolation_agreement_link ON agreement_link
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
      AND tablename = 'agreement_activity_log'
      AND policyname = 'tenant_isolation_agreement_activity_log'
  ) THEN
    CREATE POLICY tenant_isolation_agreement_activity_log ON agreement_activity_log
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
