DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'directory_contact_status') THEN
    CREATE TYPE directory_contact_status AS ENUM ('active', 'needs_review', 'inactive', 'archived');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'directory_contact_role_category') THEN
    CREATE TYPE directory_contact_role_category AS ENUM (
      'district_leadership',
      'school_leadership',
      'school_administration',
      'yearbook_publications',
      'athletics_activities',
      'day_of_logistics',
      'data_roster',
      'finance_billing',
      'technology_systems',
      'front_office_secretary',
      'facilities_building_access',
      'vendor_external_partner',
      'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'directory_contact_influence_type') THEN
    CREATE TYPE directory_contact_influence_type AS ENUM (
      'decision_maker',
      'approver',
      'recommender',
      'gatekeeper',
      'day_to_day_operator',
      'logistics_owner',
      'billing_owner',
      'informational_only'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'directory_operational_importance') THEN
    CREATE TYPE directory_operational_importance AS ENUM ('critical', 'high', 'normal', 'low');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'directory_relationship_strength') THEN
    CREATE TYPE directory_relationship_strength AS ENUM (
      'introduced',
      'working_relationship',
      'strong_relationship',
      'trusted_relationship',
      'unknown'
    );
  END IF;
END $$;

ALTER TABLE organization_contact
  ADD COLUMN IF NOT EXISTS preferred_name text,
  ADD COLUMN IF NOT EXISTS department_program text,
  ADD COLUMN IF NOT EXISTS contact_status directory_contact_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS role_category directory_contact_role_category NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS decision_influence directory_contact_influence_type NOT NULL DEFAULT 'informational_only',
  ADD COLUMN IF NOT EXISTS operational_importance directory_operational_importance NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS primary_internal_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS backup_internal_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS relationship_strength directory_relationship_strength NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS handoff_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_confirmed_at date,
  ADD COLUMN IF NOT EXISTS uncertainty_flag boolean NOT NULL DEFAULT false;

UPDATE organization_contact
SET contact_status = CASE
  WHEN active_status = 'inactive' THEN 'inactive'::directory_contact_status
  ELSE 'active'::directory_contact_status
END
WHERE contact_status IS DISTINCT FROM CASE
  WHEN active_status = 'inactive' THEN 'inactive'::directory_contact_status
  ELSE 'active'::directory_contact_status
END;

CREATE INDEX IF NOT EXISTS organization_contact_status_idx
  ON organization_contact (tenant_id, contact_status, operational_importance, role_category);

CREATE INDEX IF NOT EXISTS organization_contact_owner_idx
  ON organization_contact (tenant_id, primary_internal_owner_user_id, backup_internal_owner_user_id);

CREATE INDEX IF NOT EXISTS organization_contact_confirmed_idx
  ON organization_contact (tenant_id, last_confirmed_at);
