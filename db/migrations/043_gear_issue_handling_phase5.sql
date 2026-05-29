DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gear_service_repair_issue_type') THEN
    ALTER TYPE gear_service_repair_issue_type ADD VALUE IF NOT EXISTS 'broken';
    ALTER TYPE gear_service_repair_issue_type ADD VALUE IF NOT EXISTS 'missing';
    ALTER TYPE gear_service_repair_issue_type ADD VALUE IF NOT EXISTS 'not_working';
    ALTER TYPE gear_service_repair_issue_type ADD VALUE IF NOT EXISTS 'tile_inactive';
    ALTER TYPE gear_service_repair_issue_type ADD VALUE IF NOT EXISTS 'needs_repair';
  END IF;
END $$;

ALTER TABLE gear_service_repair_record
  ADD COLUMN IF NOT EXISTS linked_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_checkout_id uuid REFERENCES gear_checkout_record(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_surface text,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS gear_service_repair_record_shoot_idx
  ON gear_service_repair_record (tenant_id, linked_shoot_id, opened_at DESC)
  WHERE linked_shoot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_service_repair_record_checkout_idx
  ON gear_service_repair_record (tenant_id, source_checkout_id, opened_at DESC)
  WHERE source_checkout_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gear_temporary_substitution_status') THEN
    CREATE TYPE gear_temporary_substitution_status AS ENUM (
      'active',
      'ended'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS gear_temporary_substitution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  original_asset_id uuid NOT NULL REFERENCES gear_asset(id) ON DELETE RESTRICT,
  substitute_asset_id uuid NOT NULL REFERENCES gear_asset(id) ON DELETE RESTRICT,
  assigned_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  linked_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  linked_location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  substitute_checkout_id uuid REFERENCES gear_checkout_record(id) ON DELETE SET NULL,
  status gear_temporary_substitution_status NOT NULL DEFAULT 'active',
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  note text,
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  ended_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gear_temporary_substitution_asset_pair_chk CHECK (original_asset_id <> substitute_asset_id),
  CONSTRAINT gear_temporary_substitution_time_chk CHECK (ends_at IS NULL OR ends_at >= starts_at),
  CONSTRAINT gear_temporary_substitution_status_chk CHECK (
    (status = 'active' AND ends_at IS NULL)
    OR (status = 'ended' AND ends_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS gear_temporary_substitution_original_asset_idx
  ON gear_temporary_substitution (tenant_id, original_asset_id, starts_at DESC);

CREATE INDEX IF NOT EXISTS gear_temporary_substitution_substitute_asset_idx
  ON gear_temporary_substitution (tenant_id, substitute_asset_id, starts_at DESC);

CREATE INDEX IF NOT EXISTS gear_temporary_substitution_user_idx
  ON gear_temporary_substitution (tenant_id, assigned_user_id, starts_at DESC);

CREATE INDEX IF NOT EXISTS gear_temporary_substitution_shoot_idx
  ON gear_temporary_substitution (tenant_id, linked_shoot_id, starts_at DESC)
  WHERE linked_shoot_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gear_temporary_substitution_original_asset_active_uq
  ON gear_temporary_substitution (tenant_id, original_asset_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS gear_temporary_substitution_substitute_asset_active_uq
  ON gear_temporary_substitution (tenant_id, substitute_asset_id)
  WHERE status = 'active';

ALTER TABLE gear_temporary_substitution ENABLE ROW LEVEL SECURITY;
ALTER TABLE gear_temporary_substitution FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'gear_temporary_substitution'
      AND policyname = 'tenant_isolation_gear_temporary_substitution'
  ) THEN
    CREATE POLICY tenant_isolation_gear_temporary_substitution ON gear_temporary_substitution
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
