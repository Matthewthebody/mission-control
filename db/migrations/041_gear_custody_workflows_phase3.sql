DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gear_checkout_status') THEN
    CREATE TYPE gear_checkout_status AS ENUM (
      'assigned',
      'checked_out',
      'returned',
      'cancelled',
      'overridden'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gear_return_condition_status') THEN
    CREATE TYPE gear_return_condition_status AS ENUM (
      'working_order_confirmed',
      'issues_reported'
    );
  END IF;
END $$;

ALTER TABLE gear_kit
  ADD COLUMN IF NOT EXISTS assignment_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS assignment_note text,
  ADD COLUMN IF NOT EXISTS current_custodian_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_seen_with_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS gear_kit_current_custodian_idx
  ON gear_kit (tenant_id, current_custodian_id)
  WHERE current_custodian_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_kit_last_seen_with_idx
  ON gear_kit (tenant_id, last_seen_with_user_id)
  WHERE last_seen_with_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS gear_checkout_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES gear_asset(id) ON DELETE SET NULL,
  kit_id uuid REFERENCES gear_kit(id) ON DELETE SET NULL,
  checked_out_to_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  linked_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  linked_location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  status gear_checkout_status NOT NULL DEFAULT 'checked_out',
  reserved_at timestamptz NOT NULL DEFAULT now(),
  checked_out_at timestamptz,
  expected_return_at timestamptz,
  returned_at timestamptz,
  checkout_note text,
  return_condition_status gear_return_condition_status,
  return_note text,
  override_reason text,
  override_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gear_checkout_record_target_chk CHECK (num_nonnulls(asset_id, kit_id) = 1),
  CONSTRAINT gear_checkout_record_time_order_chk CHECK (
    checked_out_at IS NULL
    OR checked_out_at >= reserved_at
  ),
  CONSTRAINT gear_checkout_record_return_order_chk CHECK (
    returned_at IS NULL
    OR returned_at >= COALESCE(checked_out_at, reserved_at)
  ),
  CONSTRAINT gear_checkout_record_return_condition_chk CHECK (
    (status IN ('returned', 'cancelled', 'overridden') AND return_condition_status IS NOT NULL)
    OR (status NOT IN ('returned', 'cancelled', 'overridden'))
    OR (status IN ('cancelled', 'overridden') AND return_condition_status IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS gear_checkout_record_user_idx
  ON gear_checkout_record (tenant_id, checked_out_to_user_id, status, reserved_at DESC);

CREATE INDEX IF NOT EXISTS gear_checkout_record_shoot_idx
  ON gear_checkout_record (tenant_id, linked_shoot_id, status, reserved_at DESC)
  WHERE linked_shoot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_checkout_record_asset_idx
  ON gear_checkout_record (tenant_id, asset_id, status, reserved_at DESC)
  WHERE asset_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_checkout_record_kit_idx
  ON gear_checkout_record (tenant_id, kit_id, status, reserved_at DESC)
  WHERE kit_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gear_checkout_record_open_asset_uq
  ON gear_checkout_record (tenant_id, asset_id)
  WHERE asset_id IS NOT NULL
    AND status IN ('assigned', 'checked_out');

CREATE UNIQUE INDEX IF NOT EXISTS gear_checkout_record_open_kit_uq
  ON gear_checkout_record (tenant_id, kit_id)
  WHERE kit_id IS NOT NULL
    AND status IN ('assigned', 'checked_out');

ALTER TABLE gear_checkout_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE gear_checkout_record FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'gear_checkout_record'
      AND policyname = 'tenant_isolation_gear_checkout_record'
  ) THEN
    CREATE POLICY tenant_isolation_gear_checkout_record ON gear_checkout_record
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
