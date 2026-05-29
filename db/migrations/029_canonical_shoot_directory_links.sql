DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shoot_contact_role') THEN
    CREATE TYPE shoot_contact_role AS ENUM ('primary', 'additional');
  END IF;
END $$;

ALTER TABLE shoot
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS primary_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shoot_type organization_account_type,
  ADD COLUMN IF NOT EXISTS shoot_subtype text,
  ADD COLUMN IF NOT EXISTS internal_notes text,
  ADD COLUMN IF NOT EXISTS special_equipment_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS additional_products_flag boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS shoot_contact_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES organization_contact(id) ON DELETE CASCADE,
  contact_role shoot_contact_role NOT NULL DEFAULT 'additional',
  sort_order integer NOT NULL DEFAULT 0,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, shoot_id, contact_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS shoot_contact_link_primary_idx
  ON shoot_contact_link (tenant_id, shoot_id)
  WHERE contact_role = 'primary';

CREATE INDEX IF NOT EXISTS shoot_tenant_organization_idx ON shoot (tenant_id, organization_id, shoot_date);
CREATE INDEX IF NOT EXISTS shoot_tenant_location_idx ON shoot (tenant_id, location_id, shoot_date);
CREATE INDEX IF NOT EXISTS shoot_tenant_primary_contact_idx ON shoot (tenant_id, primary_contact_id, shoot_date);
CREATE INDEX IF NOT EXISTS shoot_tenant_type_idx ON shoot (tenant_id, shoot_type, shoot_date);
CREATE INDEX IF NOT EXISTS shoot_contact_link_tenant_role_idx ON shoot_contact_link (tenant_id, shoot_id, contact_role, sort_order);

UPDATE shoot s
SET shoot_type = CASE
  WHEN s.department = 'sports' THEN 'sports'::organization_account_type
  WHEN s.department = 'schools' THEN 'schools_underclass_portraits'::organization_account_type
  WHEN s.department = 'production' AND COALESCE(s.shoot_category::text, '') = 'studio' THEN 'studio'::organization_account_type
  WHEN s.department = 'production' THEN 'headshots'::organization_account_type
  WHEN s.department = 'executive' THEN 'internal'::organization_account_type
  ELSE 'events'::organization_account_type
END
WHERE s.shoot_type IS NULL;

UPDATE shoot s
SET
  location_id = sl.location_id,
  organization_id = COALESCE(s.organization_id, loc.organization_id)
FROM shoot_location_link sl
JOIN shoot_location loc
  ON loc.id = sl.location_id
 AND loc.tenant_id = sl.tenant_id
WHERE s.id = sl.shoot_id
  AND s.tenant_id = sl.tenant_id
  AND (s.location_id IS NULL OR s.organization_id IS NULL);

UPDATE shoot s
SET primary_contact_id = oc.id
FROM organization_contact oc
WHERE s.primary_contact_id IS NULL
  AND s.tenant_id = oc.tenant_id
  AND s.organization_id = oc.organization_id
  AND (
    (
      NULLIF(trim(s.primary_contact_email), '') IS NOT NULL
      AND lower(oc.email) = lower(NULLIF(trim(s.primary_contact_email), ''))
    )
    OR (
      NULLIF(trim(s.primary_contact_name), '') IS NOT NULL
      AND oc.normalized_full_name = lower(regexp_replace(trim(s.primary_contact_name), '\s+', ' ', 'g'))
    )
  );

UPDATE shoot
SET
  special_equipment_flag = COALESCE(NULLIF(trim(special_equipment), ''), '') <> '',
  additional_products_flag = COALESCE(NULLIF(trim(additional_products), ''), '') <> '';

INSERT INTO shoot_contact_link (
  tenant_id,
  shoot_id,
  contact_id,
  contact_role,
  sort_order,
  created_by_user_id,
  updated_by_user_id
)
SELECT
  s.tenant_id,
  s.id,
  s.primary_contact_id,
  'primary'::shoot_contact_role,
  0,
  s.created_by,
  s.created_by
FROM shoot s
WHERE s.primary_contact_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM shoot_contact_link scl
    WHERE scl.tenant_id = s.tenant_id
      AND scl.shoot_id = s.id
      AND scl.contact_id = s.primary_contact_id
      AND scl.contact_role = 'primary'
  );

ALTER TABLE shoot_contact_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE shoot_contact_link FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_shoot_contact_link ON shoot_contact_link
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
