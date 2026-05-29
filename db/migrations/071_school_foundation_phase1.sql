DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'school_relationship_health_state') THEN
    CREATE TYPE school_relationship_health_state AS ENUM (
      'healthy',
      'needs_attention',
      'fragile',
      'at_risk',
      'unknown'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'school_contact_category') THEN
    CREATE TYPE school_contact_category AS ENUM (
      'principal',
      'secretary',
      'district_contact',
      'photo_day_contact',
      'yearbook_contact',
      'billing_contact',
      'athletics_contact',
      'graduation_contact',
      'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'school_rule_type') THEN
    CREATE TYPE school_rule_type AS ENUM (
      'additional_language_needs',
      'qr_organization_rules',
      'hat_policy',
      'additional_shoot_rules',
      'punch_id_rules',
      'sticker_counts',
      'subject_directory_requirements',
      'subject_directory_counts',
      'yearbook_participation',
      'delivery_preferences',
      'mailing_preferences',
      'special_handling'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'school_activity_type') THEN
    CREATE TYPE school_activity_type AS ENUM (
      'profile_created',
      'profile_updated',
      'contact_categories_updated',
      'rule_created',
      'rule_updated',
      'note_added'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS school_profile (
  organization_id uuid PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  district_name text,
  school_type text,
  school_year_label text,
  relationship_health_state school_relationship_health_state NOT NULL DEFAULT 'unknown',
  relationship_summary text,
  primary_internal_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  backup_internal_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  primary_location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  notes text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_profile_tenant_idx
  ON school_profile (tenant_id, relationship_health_state, school_year_label);

ALTER TABLE organization_contact_relationship
  ADD COLUMN IF NOT EXISTS school_contact_categories school_contact_category[] NOT NULL DEFAULT '{}'::school_contact_category[];

CREATE TABLE IF NOT EXISTS school_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  rule_type school_rule_type NOT NULL,
  active_status directory_active_status NOT NULL DEFAULT 'active',
  title text NOT NULL,
  summary text,
  structured_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_rule_lookup_idx
  ON school_rule (tenant_id, organization_id, active_status, rule_type, sort_order, created_at DESC);

CREATE TABLE IF NOT EXISTS school_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  activity_type school_activity_type NOT NULL,
  summary text NOT NULL,
  detail text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  related_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  related_rule_id uuid REFERENCES school_rule(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_activity_log_lookup_idx
  ON school_activity_log (tenant_id, organization_id, created_at DESC);

ALTER TABLE school_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_profile FORCE ROW LEVEL SECURITY;
ALTER TABLE school_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE school_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_activity_log FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_school_profile ON school_profile
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_school_rule ON school_rule
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_school_activity_log ON school_activity_log
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

INSERT INTO school_profile (
  organization_id,
  tenant_id,
  primary_location_id,
  created_by_user_id,
  updated_by_user_id
)
SELECT
  o.id,
  o.tenant_id,
  primary_location.id,
  o.created_by_user_id,
  o.updated_by_user_id
FROM organization o
LEFT JOIN LATERAL (
  SELECT sl.id
  FROM shoot_location sl
  WHERE sl.tenant_id = o.tenant_id
    AND sl.organization_id = o.id
    AND sl.active_status = 'active'
  ORDER BY lower(sl.name), sl.created_at
  LIMIT 1
) primary_location ON true
WHERE o.account_type IN ('schools_underclass_portraits', 'schools_events')
  AND NOT EXISTS (
    SELECT 1
    FROM school_profile sp
    WHERE sp.organization_id = o.id
  );

UPDATE organization_contact_relationship ocr
SET school_contact_categories = CASE oc.role_category
  WHEN 'school_leadership' THEN ARRAY['principal'::school_contact_category]
  WHEN 'front_office_secretary' THEN ARRAY['secretary'::school_contact_category]
  WHEN 'district_leadership' THEN ARRAY['district_contact'::school_contact_category]
  WHEN 'day_of_logistics' THEN ARRAY['photo_day_contact'::school_contact_category]
  WHEN 'yearbook_publications' THEN ARRAY['yearbook_contact'::school_contact_category]
  WHEN 'finance_billing' THEN ARRAY['billing_contact'::school_contact_category]
  WHEN 'athletics_activities' THEN ARRAY['athletics_contact'::school_contact_category]
  ELSE ARRAY[]::school_contact_category[]
END
FROM organization_contact oc,
     organization o
WHERE oc.tenant_id = ocr.tenant_id
  AND oc.id = ocr.contact_id
  AND o.tenant_id = ocr.tenant_id
  AND o.id = ocr.organization_id
  AND o.account_type IN ('schools_underclass_portraits', 'schools_events')
  AND cardinality(ocr.school_contact_categories) = 0;
