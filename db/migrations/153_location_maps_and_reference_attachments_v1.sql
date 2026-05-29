ALTER TABLE shoot_location
  ADD COLUMN IF NOT EXISTS navigation_notes text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'location_reference_attachment_type') THEN
    CREATE TYPE location_reference_attachment_type AS ENUM (
      'parking_map',
      'entrance_photo',
      'setup_reference',
      'field_map',
      'screenshot',
      'building_map',
      'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'location_reference_attachment_audience') THEN
    CREATE TYPE location_reference_attachment_audience AS ENUM (
      'client_facing',
      'employee_facing',
      'internal_only'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS location_reference_attachment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES shoot_location(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  attachment_type location_reference_attachment_type NOT NULL DEFAULT 'other',
  audience location_reference_attachment_audience NOT NULL DEFAULT 'employee_facing',
  file_url text,
  storage_key text,
  uploaded_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  active_status directory_active_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT location_reference_attachment_has_reference_check
    CHECK (NULLIF(file_url, '') IS NOT NULL OR NULLIF(storage_key, '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS location_reference_attachment_location_idx
  ON location_reference_attachment (tenant_id, location_id, active_status, audience);

CREATE INDEX IF NOT EXISTS location_reference_attachment_type_idx
  ON location_reference_attachment (tenant_id, attachment_type, uploaded_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS location_reference_attachment_location_title_uq
  ON location_reference_attachment (tenant_id, location_id, title);

ALTER TABLE location_reference_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_reference_attachment FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy
    WHERE polname = 'tenant_isolation_location_reference_attachment'
      AND polrelid = 'location_reference_attachment'::regclass
  ) THEN
    CREATE POLICY tenant_isolation_location_reference_attachment ON location_reference_attachment
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
