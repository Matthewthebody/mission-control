BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_client_portal_auth_provider') THEN
    CREATE TYPE microsoft_client_portal_auth_provider AS ENUM (
      'entra_external_id'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_client_portal_access_scope') THEN
    CREATE TYPE microsoft_client_portal_access_scope AS ENUM (
      'organization',
      'job'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_client_portal_access_status') THEN
    CREATE TYPE microsoft_client_portal_access_status AS ENUM (
      'invited',
      'active',
      'disabled',
      'revoked'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_client_portal_link_status') THEN
    CREATE TYPE microsoft_client_portal_link_status AS ENUM (
      'planned',
      'linked',
      'drifted',
      'archived'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS microsoft_client_portal_access_grant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
  access_scope microsoft_client_portal_access_scope NOT NULL,
  access_status microsoft_client_portal_access_status NOT NULL DEFAULT 'invited',
  external_email text NOT NULL,
  external_identity_provider microsoft_client_portal_auth_provider NOT NULL DEFAULT 'entra_external_id',
  external_identity_subject text,
  power_pages_contact_id text,
  power_pages_web_role_keys text[] NOT NULL DEFAULT '{}'::text[],
  invited_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  last_sign_in_at timestamptz,
  last_notified_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT microsoft_client_portal_access_grant_scope_chk CHECK (
    (access_scope = 'organization'::microsoft_client_portal_access_scope AND job_id IS NULL)
    OR (access_scope = 'job'::microsoft_client_portal_access_scope AND job_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS microsoft_client_portal_access_grant_status_idx
  ON microsoft_client_portal_access_grant (tenant_id, access_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS microsoft_client_portal_access_grant_org_idx
  ON microsoft_client_portal_access_grant (tenant_id, organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS microsoft_client_portal_access_grant_job_idx
  ON microsoft_client_portal_access_grant (tenant_id, job_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS microsoft_client_portal_access_grant_org_scope_email_uidx
  ON microsoft_client_portal_access_grant (tenant_id, organization_id, lower(external_email))
  WHERE access_scope = 'organization'::microsoft_client_portal_access_scope
    AND job_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS microsoft_client_portal_access_grant_job_scope_email_uidx
  ON microsoft_client_portal_access_grant (tenant_id, organization_id, job_id, lower(external_email))
  WHERE access_scope = 'job'::microsoft_client_portal_access_scope
    AND job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS microsoft_client_portal_project_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  canonical_dashboard_id text NOT NULL,
  power_pages_site_key text NOT NULL,
  portal_project_key text NOT NULL,
  overview_page_url text,
  required_items_page_url text,
  upload_page_url text,
  submission_history_page_url text,
  help_page_url text,
  link_status microsoft_client_portal_link_status NOT NULL DEFAULT 'planned',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  last_sync_error text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS microsoft_client_portal_project_link_job_uidx
  ON microsoft_client_portal_project_link (tenant_id, job_id);

CREATE UNIQUE INDEX IF NOT EXISTS microsoft_client_portal_project_link_site_project_uidx
  ON microsoft_client_portal_project_link (tenant_id, power_pages_site_key, portal_project_key);

CREATE INDEX IF NOT EXISTS microsoft_client_portal_project_link_status_idx
  ON microsoft_client_portal_project_link (tenant_id, link_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS microsoft_client_portal_project_link_org_idx
  ON microsoft_client_portal_project_link (tenant_id, organization_id, updated_at DESC);

ALTER TABLE microsoft_client_portal_access_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE microsoft_client_portal_access_grant FORCE ROW LEVEL SECURITY;
ALTER TABLE microsoft_client_portal_project_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE microsoft_client_portal_project_link FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'microsoft_client_portal_access_grant'
      AND policyname = 'tenant_isolation_microsoft_client_portal_access_grant'
  ) THEN
    CREATE POLICY tenant_isolation_microsoft_client_portal_access_grant ON microsoft_client_portal_access_grant
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
      AND tablename = 'microsoft_client_portal_project_link'
      AND policyname = 'tenant_isolation_microsoft_client_portal_project_link'
  ) THEN
    CREATE POLICY tenant_isolation_microsoft_client_portal_project_link ON microsoft_client_portal_project_link
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

COMMIT;
