DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_asset_validation_status') THEN
    CREATE TYPE production_asset_validation_status AS ENUM ('unvalidated', 'validated', 'deprecated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_asset_license_status') THEN
    CREATE TYPE production_asset_license_status AS ENUM ('active', 'inactive', 'expiring', 'expired');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_asset_license_type') THEN
    CREATE TYPE production_asset_license_type AS ENUM ('subscription', 'perpetual', 'floating', 'device', 'seat', 'other');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS production_asset_preset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  active_status boolean NOT NULL DEFAULT true,
  validation_status production_asset_validation_status NOT NULL DEFAULT 'unvalidated',
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  job_types production_project_job_type[] NULL,
  glasses_handling text,
  known_issues text,
  notes text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS production_asset_preset_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  preset_id uuid NOT NULL REFERENCES production_asset_preset(id) ON DELETE CASCADE,
  version_label text NOT NULL,
  active_status boolean NOT NULL DEFAULT true,
  validation_status production_asset_validation_status NOT NULL DEFAULT 'unvalidated',
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  notes text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS production_background_pack (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  active_status boolean NOT NULL DEFAULT true,
  validation_status production_asset_validation_status NOT NULL DEFAULT 'unvalidated',
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  job_types production_project_job_type[] NULL,
  notes text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS production_background_variant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  pack_id uuid NOT NULL REFERENCES production_background_pack(id) ON DELETE CASCADE,
  name text NOT NULL,
  active_status boolean NOT NULL DEFAULT true,
  notes text,
  storage_key text,
  file_url text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS production_tool_license (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  license_type production_asset_license_type NOT NULL,
  seat_count int,
  status production_asset_license_status NOT NULL DEFAULT 'active',
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  renewal_date date,
  notes text,
  restrictions text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS production_asset_preset_tenant_idx
  ON production_asset_preset (tenant_id, active_status, validation_status);
CREATE INDEX IF NOT EXISTS production_asset_preset_version_tenant_idx
  ON production_asset_preset_version (tenant_id, preset_id, active_status);
CREATE INDEX IF NOT EXISTS production_background_pack_tenant_idx
  ON production_background_pack (tenant_id, active_status, validation_status);
CREATE INDEX IF NOT EXISTS production_background_variant_tenant_idx
  ON production_background_variant (tenant_id, pack_id, active_status);
CREATE INDEX IF NOT EXISTS production_tool_license_tenant_idx
  ON production_tool_license (tenant_id, status);

