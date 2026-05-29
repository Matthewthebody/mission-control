DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'organization_account_type') THEN
    CREATE TYPE organization_account_type AS ENUM (
      'schools_underclass_portraits',
      'schools_events',
      'sports',
      'events',
      'studio',
      'headshots',
      'commercial',
      'internal'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'directory_active_status') THEN
    CREATE TYPE directory_active_status AS ENUM ('active', 'inactive');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS organization (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  canonical_name text NOT NULL,
  normalized_canonical_name text NOT NULL,
  display_name text NOT NULL,
  account_type organization_account_type NOT NULL,
  active_status directory_active_status NOT NULL DEFAULT 'active',
  notes text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, normalized_canonical_name)
);

CREATE TABLE IF NOT EXISTS organization_alias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, organization_id, normalized_alias)
);

CREATE TABLE IF NOT EXISTS organization_contact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  full_name text NOT NULL,
  normalized_full_name text NOT NULL,
  title text,
  phone text,
  email text,
  photo_url text,
  active_status directory_active_status NOT NULL DEFAULT 'active',
  notes text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE shoot_location
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS address_line_1 text,
  ADD COLUMN IF NOT EXISTS address_line_2 text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS zip text,
  ADD COLUMN IF NOT EXISTS maps_label text,
  ADD COLUMN IF NOT EXISTS active_status directory_active_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;

UPDATE shoot_location
SET
  address_line_1 = COALESCE(address_line_1, address),
  maps_label = COALESCE(NULLIF(maps_label, ''), NULLIF(name, ''), NULLIF(address, ''))
WHERE address_line_1 IS NULL
   OR maps_label IS NULL
   OR maps_label = '';

CREATE INDEX IF NOT EXISTS organization_tenant_display_idx ON organization (tenant_id, lower(display_name));
CREATE INDEX IF NOT EXISTS organization_tenant_account_type_idx ON organization (tenant_id, account_type, active_status);
CREATE INDEX IF NOT EXISTS organization_alias_tenant_alias_idx ON organization_alias (tenant_id, normalized_alias);
CREATE INDEX IF NOT EXISTS organization_contact_tenant_org_idx ON organization_contact (tenant_id, organization_id, active_status);
CREATE INDEX IF NOT EXISTS organization_contact_tenant_name_idx ON organization_contact (tenant_id, normalized_full_name);
CREATE INDEX IF NOT EXISTS organization_contact_tenant_email_idx ON organization_contact (tenant_id, lower(email));
CREATE INDEX IF NOT EXISTS shoot_location_tenant_org_idx ON shoot_location (tenant_id, organization_id, active_status);
CREATE INDEX IF NOT EXISTS shoot_location_tenant_maps_label_idx ON shoot_location (tenant_id, lower(COALESCE(maps_label, name)));

ALTER TABLE organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_alias ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_contact ENABLE ROW LEVEL SECURITY;

ALTER TABLE organization FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_alias FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_contact FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_organization ON organization
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_organization_alias ON organization_alias
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_organization_contact ON organization_contact
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
