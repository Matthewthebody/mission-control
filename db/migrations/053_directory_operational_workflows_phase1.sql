DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'directory_contact_relationship_role') THEN
    CREATE TYPE directory_contact_relationship_role AS ENUM (
      'general',
      'planning',
      'billing',
      'decision_maker',
      'day_of',
      'operations',
      'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'directory_touchpoint_channel') THEN
    CREATE TYPE directory_touchpoint_channel AS ENUM (
      'call',
      'email',
      'text',
      'meeting',
      'onsite',
      'note',
      'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'directory_duplicate_review_status') THEN
    CREATE TYPE directory_duplicate_review_status AS ENUM ('open', 'resolved', 'dismissed');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'directory_duplicate_review_decision') THEN
    CREATE TYPE directory_duplicate_review_decision AS ENUM (
      'pending',
      'keep_separate',
      'merge_candidate',
      'merged_later'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS organization_contact_relationship (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES organization_contact(id) ON DELETE CASCADE,
  relationship_role directory_contact_relationship_role NOT NULL DEFAULT 'general',
  is_primary boolean NOT NULL DEFAULT false,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, organization_id, contact_id)
);

CREATE TABLE IF NOT EXISTS location_contact_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES shoot_location(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES organization_contact(id) ON DELETE CASCADE,
  relationship_role directory_contact_relationship_role NOT NULL DEFAULT 'general',
  is_primary boolean NOT NULL DEFAULT false,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, location_id, contact_id)
);

CREATE TABLE IF NOT EXISTS directory_touchpoint (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  channel directory_touchpoint_channel NOT NULL,
  summary text NOT NULL,
  outcome text,
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  follow_up_date date,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS directory_duplicate_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  primary_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  suspected_duplicate_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  status directory_duplicate_review_status NOT NULL DEFAULT 'open',
  decision directory_duplicate_review_decision NOT NULL DEFAULT 'pending',
  summary text NOT NULL,
  notes text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE shoot_contact_link
  ADD COLUMN IF NOT EXISTS relationship_role directory_contact_relationship_role NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

INSERT INTO organization_contact_relationship (
  tenant_id,
  organization_id,
  contact_id,
  relationship_role,
  is_primary,
  created_by_user_id,
  updated_by_user_id,
  created_at,
  updated_at
)
SELECT
  oc.tenant_id,
  oc.organization_id,
  oc.id,
  'general'::directory_contact_relationship_role,
  false,
  oc.created_by_user_id,
  oc.updated_by_user_id,
  oc.created_at,
  oc.updated_at
FROM organization_contact oc
WHERE NOT EXISTS (
  SELECT 1
  FROM organization_contact_relationship ocr
  WHERE ocr.tenant_id = oc.tenant_id
    AND ocr.organization_id = oc.organization_id
    AND ocr.contact_id = oc.id
);

UPDATE shoot_contact_link
SET
  is_primary = (contact_role = 'primary'),
  relationship_role = CASE
    WHEN contact_role = 'primary' THEN 'day_of'::directory_contact_relationship_role
    ELSE 'general'::directory_contact_relationship_role
  END
WHERE is_primary = false
   OR relationship_role = 'general';

CREATE INDEX IF NOT EXISTS organization_contact_relationship_tenant_org_idx
  ON organization_contact_relationship (tenant_id, organization_id, contact_id);
CREATE INDEX IF NOT EXISTS location_contact_link_tenant_location_idx
  ON location_contact_link (tenant_id, location_id, contact_id);
CREATE INDEX IF NOT EXISTS directory_touchpoint_tenant_org_idx
  ON directory_touchpoint (tenant_id, organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS directory_touchpoint_tenant_contact_idx
  ON directory_touchpoint (tenant_id, contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS directory_duplicate_review_tenant_status_idx
  ON directory_duplicate_review (tenant_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS organization_contact_relationship_primary_idx
  ON organization_contact_relationship (tenant_id, organization_id)
  WHERE is_primary;
CREATE UNIQUE INDEX IF NOT EXISTS location_contact_link_primary_idx
  ON location_contact_link (tenant_id, location_id)
  WHERE is_primary;
CREATE UNIQUE INDEX IF NOT EXISTS shoot_contact_link_primary_flag_idx
  ON shoot_contact_link (tenant_id, shoot_id)
  WHERE is_primary;

ALTER TABLE organization_contact_relationship ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_contact_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE directory_touchpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE directory_duplicate_review ENABLE ROW LEVEL SECURITY;

ALTER TABLE organization_contact_relationship FORCE ROW LEVEL SECURITY;
ALTER TABLE location_contact_link FORCE ROW LEVEL SECURITY;
ALTER TABLE directory_touchpoint FORCE ROW LEVEL SECURITY;
ALTER TABLE directory_duplicate_review FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_organization_contact_relationship ON organization_contact_relationship
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_location_contact_link ON location_contact_link
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_directory_touchpoint ON directory_touchpoint
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_directory_duplicate_review ON directory_duplicate_review
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
