DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mileage_vehicle_type') THEN
    CREATE TYPE mileage_vehicle_type AS ENUM (
      'personal_vehicle',
      'carpool_passenger',
      'company_vehicle',
      'other_needs_review'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mileage_reimbursement_status') THEN
    CREATE TYPE mileage_reimbursement_status AS ENUM (
      'candidate',
      'review_required',
      'ineligible',
      'approved',
      'exported',
      'cancelled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mileage_reimbursement_reason_code') THEN
    CREATE TYPE mileage_reimbursement_reason_code AS ENUM (
      'missing_post_shoot_evaluation',
      'not_mileage_eligible',
      'submit_declined',
      'company_vehicle',
      'carpool_passenger',
      'other_needs_review',
      'missing_location_coordinates',
      'missing_zone_match',
      'no_eligible_personal_vehicle_submission'
    );
  END IF;
END $$;

ALTER TABLE post_shoot_evaluation
  ADD COLUMN IF NOT EXISTS submit_for_mileage boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vehicle_type mileage_vehicle_type;

CREATE TABLE IF NOT EXISTS mileage_zone (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  zone_name text NOT NULL,
  min_distance numeric(10,2) NOT NULL CHECK (min_distance >= 0),
  max_distance numeric(10,2) NOT NULL CHECK (max_distance > min_distance),
  reimbursement_amount numeric(10,2) NOT NULL CHECK (reimbursement_amount >= 0),
  active_status boolean NOT NULL DEFAULT true,
  effective_date date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, zone_name, effective_date)
);

ALTER TABLE mileage_zone
  ADD COLUMN IF NOT EXISTS zone_name text,
  ADD COLUMN IF NOT EXISTS min_distance numeric(10,2),
  ADD COLUMN IF NOT EXISTS max_distance numeric(10,2),
  ADD COLUMN IF NOT EXISTS active_status boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS effective_date date NOT NULL DEFAULT current_date,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mileage_zone'
      AND column_name = 'code'
  ) THEN
    EXECUTE $sql$
      UPDATE mileage_zone
      SET zone_name = COALESCE(zone_name, code, concat('Legacy Zone ', left(id::text, 8)))
      WHERE zone_name IS NULL
    $sql$;
  ELSE
    UPDATE mileage_zone
    SET zone_name = COALESCE(zone_name, concat('Zone ', left(id::text, 8)))
    WHERE zone_name IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mileage_zone'
      AND column_name = 'min_miles'
  ) THEN
    EXECUTE $sql$
      UPDATE mileage_zone
      SET min_distance = COALESCE(min_distance, min_miles, 0)
      WHERE min_distance IS NULL
    $sql$;
  ELSE
    UPDATE mileage_zone
    SET min_distance = COALESCE(min_distance, 0)
    WHERE min_distance IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mileage_zone'
      AND column_name = 'max_miles'
  ) THEN
    EXECUTE $sql$
      UPDATE mileage_zone
      SET max_distance = COALESCE(max_distance, max_miles, min_distance + 0.01)
      WHERE max_distance IS NULL
    $sql$;
  ELSE
    UPDATE mileage_zone
    SET max_distance = COALESCE(max_distance, min_distance + 0.01)
    WHERE max_distance IS NULL;
  END IF;
END $$;

ALTER TABLE mileage_zone
  ALTER COLUMN zone_name SET NOT NULL,
  ALTER COLUMN min_distance SET NOT NULL,
  ALTER COLUMN max_distance SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'mileage_zone'::regclass
      AND conname = 'mileage_zone_tenant_id_code_key'
  ) THEN
    ALTER TABLE mileage_zone DROP CONSTRAINT mileage_zone_tenant_id_code_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'mileage_zone'::regclass
      AND conname = 'mileage_zone_tenant_zone_effective_key'
  ) THEN
    ALTER TABLE mileage_zone
      ADD CONSTRAINT mileage_zone_tenant_zone_effective_key UNIQUE (tenant_id, zone_name, effective_date);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS mileage_reimbursement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  selected_evaluation_id uuid REFERENCES post_shoot_evaluation(id) ON DELETE SET NULL,
  linked_shift_id uuid REFERENCES work_shift(id) ON DELETE SET NULL,
  linked_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  zone_id uuid REFERENCES mileage_zone(id) ON DELETE SET NULL,
  zone_name text,
  studio_distance_miles numeric(10,2),
  reimbursement_amount numeric(10,2) NOT NULL DEFAULT 0,
  vehicle_type mileage_vehicle_type,
  status mileage_reimbursement_status NOT NULL DEFAULT 'candidate',
  review_reason_code mileage_reimbursement_reason_code,
  source_evaluation_count integer NOT NULL DEFAULT 0,
  reporting_flags text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, work_date)
);

CREATE TABLE IF NOT EXISTS mileage_reimbursement_source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  reimbursement_id uuid NOT NULL REFERENCES mileage_reimbursement(id) ON DELETE CASCADE,
  evaluation_id uuid REFERENCES post_shoot_evaluation(id) ON DELETE SET NULL,
  shift_id uuid REFERENCES work_shift(id) ON DELETE SET NULL,
  shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  zone_id uuid REFERENCES mileage_zone(id) ON DELETE SET NULL,
  zone_name text,
  studio_distance_miles numeric(10,2),
  reimbursement_amount numeric(10,2) NOT NULL DEFAULT 0,
  submit_for_mileage boolean NOT NULL DEFAULT false,
  vehicle_type mileage_vehicle_type,
  eligible_for_selection boolean NOT NULL DEFAULT false,
  review_reason_code mileage_reimbursement_reason_code,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mileage_zone_lookup_idx
  ON mileage_zone (tenant_id, active_status, effective_date DESC, min_distance, max_distance);

CREATE INDEX IF NOT EXISTS mileage_reimbursement_employee_idx
  ON mileage_reimbursement (tenant_id, employee_id, work_date DESC);

CREATE INDEX IF NOT EXISTS mileage_reimbursement_status_idx
  ON mileage_reimbursement (tenant_id, status, work_date DESC);

CREATE INDEX IF NOT EXISTS mileage_reimbursement_source_reimbursement_idx
  ON mileage_reimbursement_source (tenant_id, reimbursement_id, created_at ASC);

CREATE INDEX IF NOT EXISTS mileage_reimbursement_source_shoot_idx
  ON mileage_reimbursement_source (tenant_id, shoot_id, created_at DESC);

ALTER TABLE mileage_zone ENABLE ROW LEVEL SECURITY;
ALTER TABLE mileage_reimbursement ENABLE ROW LEVEL SECURITY;
ALTER TABLE mileage_reimbursement_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE mileage_zone FORCE ROW LEVEL SECURITY;
ALTER TABLE mileage_reimbursement FORCE ROW LEVEL SECURITY;
ALTER TABLE mileage_reimbursement_source FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mileage_zone'
      AND policyname = 'tenant_isolation_mileage_zone'
  ) THEN
    CREATE POLICY tenant_isolation_mileage_zone ON mileage_zone
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mileage_reimbursement'
      AND policyname = 'tenant_isolation_mileage_reimbursement'
  ) THEN
    CREATE POLICY tenant_isolation_mileage_reimbursement ON mileage_reimbursement
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mileage_reimbursement_source'
      AND policyname = 'tenant_isolation_mileage_reimbursement_source'
  ) THEN
    CREATE POLICY tenant_isolation_mileage_reimbursement_source ON mileage_reimbursement_source
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
