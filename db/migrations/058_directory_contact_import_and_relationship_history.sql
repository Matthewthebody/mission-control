DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'directory_import_session_status') THEN
    CREATE TYPE directory_import_session_status AS ENUM ('staged', 'applied', 'partially_applied', 'cancelled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'directory_import_row_status') THEN
    CREATE TYPE directory_import_row_status AS ENUM ('staged', 'ready', 'needs_review', 'applied', 'skipped', 'error');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'directory_import_row_action') THEN
    CREATE TYPE directory_import_row_action AS ENUM ('create_contact', 'link_existing', 'skip', 'needs_review');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS directory_import_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  source_file_name text NOT NULL,
  import_kind text NOT NULL DEFAULT 'contacts_csv',
  status directory_import_session_status NOT NULL DEFAULT 'staged',
  has_header_row boolean NOT NULL DEFAULT true,
  default_organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  applied_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE organization_contact_relationship
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organization_contact_relationship_date_range_check'
  ) THEN
    ALTER TABLE organization_contact_relationship
      ADD CONSTRAINT organization_contact_relationship_date_range_check
      CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);
  END IF;
END $$;

DO $$
DECLARE
  existing_constraint text;
BEGIN
  SELECT c.conname
  INTO existing_constraint
  FROM pg_constraint c
  WHERE c.conrelid = 'organization_contact_relationship'::regclass
    AND c.contype = 'u'
    AND pg_get_constraintdef(c.oid) LIKE '%tenant_id, organization_id, contact_id%';

  IF existing_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE organization_contact_relationship DROP CONSTRAINT %I', existing_constraint);
  END IF;
END $$;

DROP INDEX IF EXISTS organization_contact_relationship_primary_idx;

CREATE TABLE IF NOT EXISTS directory_import_row (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES directory_import_session(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  status directory_import_row_status NOT NULL DEFAULT 'staged',
  proposed_action directory_import_row_action NOT NULL,
  selected_action directory_import_row_action,
  selected_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  resolved_organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  raw_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  warning_messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  candidate_matches jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_note text,
  applied_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  applied_relationship_id uuid REFERENCES organization_contact_relationship(id) ON DELETE SET NULL,
  result_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, row_number)
);

UPDATE organization_contact_relationship
SET is_current = CASE
  WHEN end_date IS NOT NULL THEN false
  ELSE true
END
WHERE is_current IS DISTINCT FROM CASE
  WHEN end_date IS NOT NULL THEN false
  ELSE true
END;

CREATE UNIQUE INDEX IF NOT EXISTS organization_contact_relationship_current_idx
  ON organization_contact_relationship (tenant_id, organization_id, contact_id)
  WHERE is_current;

CREATE UNIQUE INDEX IF NOT EXISTS organization_contact_relationship_primary_current_idx
  ON organization_contact_relationship (tenant_id, organization_id)
  WHERE is_primary AND is_current;

CREATE INDEX IF NOT EXISTS organization_contact_relationship_history_contact_idx
  ON organization_contact_relationship (tenant_id, contact_id, is_current, start_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS directory_import_session_tenant_status_idx
  ON directory_import_session (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS directory_import_row_session_status_idx
  ON directory_import_row (session_id, status, row_number);

CREATE INDEX IF NOT EXISTS directory_import_row_selected_contact_idx
  ON directory_import_row (tenant_id, selected_contact_id);

ALTER TABLE directory_import_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE directory_import_row ENABLE ROW LEVEL SECURITY;

ALTER TABLE directory_import_session FORCE ROW LEVEL SECURITY;
ALTER TABLE directory_import_row FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'directory_import_session'
      AND policyname = 'tenant_isolation_directory_import_session'
  ) THEN
    CREATE POLICY tenant_isolation_directory_import_session ON directory_import_session
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'directory_import_row'
      AND policyname = 'tenant_isolation_directory_import_row'
  ) THEN
    CREATE POLICY tenant_isolation_directory_import_row ON directory_import_row
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
