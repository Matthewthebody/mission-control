DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gear_scan_action') THEN
    CREATE TYPE gear_scan_action AS ENUM (
      'open_asset_detail',
      'open_kit_detail',
      'check_out',
      'return',
      'pre_shoot_verification',
      'confirm_contents_presence',
      'log_missing_item'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gear_pre_shoot_verification_status') THEN
    CREATE TYPE gear_pre_shoot_verification_status AS ENUM (
      'in_progress',
      'verified_ready',
      'verified_with_missing_items'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gear_verification_item_presence_status') THEN
    CREATE TYPE gear_verification_item_presence_status AS ENUM (
      'pending',
      'present',
      'missing',
      'unexpected'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS gear_pre_shoot_verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  kit_id uuid NOT NULL REFERENCES gear_kit(id) ON DELETE CASCADE,
  verified_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  linked_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  linked_location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  status gear_pre_shoot_verification_status NOT NULL DEFAULT 'in_progress',
  all_required_items_present boolean NOT NULL DEFAULT false,
  override_reason text,
  verified_ready_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gear_pre_shoot_verification_kit_idx
  ON gear_pre_shoot_verification (tenant_id, kit_id, created_at DESC);

CREATE INDEX IF NOT EXISTS gear_pre_shoot_verification_shoot_idx
  ON gear_pre_shoot_verification (tenant_id, linked_shoot_id, created_at DESC)
  WHERE linked_shoot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_pre_shoot_verification_status_idx
  ON gear_pre_shoot_verification (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS gear_pre_shoot_verification_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  verification_id uuid NOT NULL REFERENCES gear_pre_shoot_verification(id) ON DELETE CASCADE,
  expected_asset_id uuid REFERENCES gear_asset(id) ON DELETE SET NULL,
  scanned_asset_id uuid REFERENCES gear_asset(id) ON DELETE SET NULL,
  required_in_kit boolean NOT NULL DEFAULT true,
  display_order integer,
  presence_status gear_verification_item_presence_status NOT NULL DEFAULT 'pending',
  note text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gear_pre_shoot_verification_item_target_chk CHECK (num_nonnulls(expected_asset_id, scanned_asset_id) >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS gear_pre_shoot_verification_expected_asset_uq
  ON gear_pre_shoot_verification_item (tenant_id, verification_id, expected_asset_id)
  WHERE expected_asset_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_pre_shoot_verification_item_status_idx
  ON gear_pre_shoot_verification_item (tenant_id, verification_id, presence_status, display_order, created_at);

CREATE TABLE IF NOT EXISTS gear_scan_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES gear_asset(id) ON DELETE SET NULL,
  kit_id uuid REFERENCES gear_kit(id) ON DELETE SET NULL,
  linked_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  linked_location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  linked_pre_shoot_verification_id uuid REFERENCES gear_pre_shoot_verification(id) ON DELETE SET NULL,
  qr_code_id text,
  scan_action gear_scan_action NOT NULL,
  scanned_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  mismatch_detected boolean NOT NULL DEFAULT false,
  override_applied boolean NOT NULL DEFAULT false,
  note text,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gear_scan_event_geo_pair_chk CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude IS NOT NULL AND longitude IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS gear_scan_event_asset_idx
  ON gear_scan_event (tenant_id, asset_id, scanned_at DESC)
  WHERE asset_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_scan_event_kit_idx
  ON gear_scan_event (tenant_id, kit_id, scanned_at DESC)
  WHERE kit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_scan_event_shoot_idx
  ON gear_scan_event (tenant_id, linked_shoot_id, scanned_at DESC)
  WHERE linked_shoot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_scan_event_verification_idx
  ON gear_scan_event (tenant_id, linked_pre_shoot_verification_id, scanned_at DESC)
  WHERE linked_pre_shoot_verification_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_scan_event_action_idx
  ON gear_scan_event (tenant_id, scan_action, scanned_at DESC);

CREATE INDEX IF NOT EXISTS gear_scan_event_qr_idx
  ON gear_scan_event (tenant_id, lower(qr_code_id), scanned_at DESC)
  WHERE qr_code_id IS NOT NULL;

ALTER TABLE gear_pre_shoot_verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE gear_pre_shoot_verification FORCE ROW LEVEL SECURITY;
ALTER TABLE gear_pre_shoot_verification_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE gear_pre_shoot_verification_item FORCE ROW LEVEL SECURITY;
ALTER TABLE gear_scan_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE gear_scan_event FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'gear_pre_shoot_verification'
      AND policyname = 'tenant_isolation_gear_pre_shoot_verification'
  ) THEN
    CREATE POLICY tenant_isolation_gear_pre_shoot_verification ON gear_pre_shoot_verification
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'gear_pre_shoot_verification_item'
      AND policyname = 'tenant_isolation_gear_pre_shoot_verification_item'
  ) THEN
    CREATE POLICY tenant_isolation_gear_pre_shoot_verification_item ON gear_pre_shoot_verification_item
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'gear_scan_event'
      AND policyname = 'tenant_isolation_gear_scan_event'
  ) THEN
    CREATE POLICY tenant_isolation_gear_scan_event ON gear_scan_event
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
