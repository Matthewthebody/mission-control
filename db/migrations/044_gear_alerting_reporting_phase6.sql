DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gear_alert_type') THEN
    CREATE TYPE gear_alert_type AS ENUM (
      'overdue_return',
      'missing_gear'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gear_alert_status') THEN
    CREATE TYPE gear_alert_status AS ENUM (
      'open',
      'resolved'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gear_alert_resolution_type') THEN
    CREATE TYPE gear_alert_resolution_type AS ENUM (
      'returned',
      'manual_resolution',
      'status_cleared'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS gear_alert (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  alert_type gear_alert_type NOT NULL,
  status gear_alert_status NOT NULL DEFAULT 'open',
  asset_id uuid REFERENCES gear_asset(id) ON DELETE CASCADE,
  kit_id uuid REFERENCES gear_kit(id) ON DELETE CASCADE,
  checkout_id uuid REFERENCES gear_checkout_record(id) ON DELETE SET NULL,
  linked_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  linked_location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  first_triggered_at timestamptz NOT NULL DEFAULT now(),
  last_triggered_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  resolution_type gear_alert_resolution_type,
  resolution_note text,
  created_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gear_alert_target_chk CHECK (num_nonnulls(asset_id, kit_id) = 1),
  CONSTRAINT gear_alert_resolution_chk CHECK (
    (status = 'open' AND resolved_at IS NULL AND resolved_by IS NULL AND resolution_type IS NULL)
    OR (status = 'resolved' AND resolved_at IS NOT NULL AND resolution_type IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS gear_alert_status_idx
  ON gear_alert (tenant_id, status, alert_type, first_triggered_at DESC);

CREATE INDEX IF NOT EXISTS gear_alert_checkout_idx
  ON gear_alert (tenant_id, checkout_id, alert_type, created_at DESC)
  WHERE checkout_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_alert_asset_idx
  ON gear_alert (tenant_id, asset_id, alert_type, created_at DESC)
  WHERE asset_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_alert_kit_idx
  ON gear_alert (tenant_id, kit_id, alert_type, created_at DESC)
  WHERE kit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_alert_shoot_idx
  ON gear_alert (tenant_id, linked_shoot_id, alert_type, created_at DESC)
  WHERE linked_shoot_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gear_alert_open_asset_uq
  ON gear_alert (tenant_id, alert_type, asset_id)
  WHERE status = 'open'
    AND asset_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gear_alert_open_kit_uq
  ON gear_alert (tenant_id, alert_type, kit_id)
  WHERE status = 'open'
    AND kit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_checkout_record_returned_idx
  ON gear_checkout_record (tenant_id, returned_at DESC)
  WHERE returned_at IS NOT NULL;

ALTER TABLE gear_alert ENABLE ROW LEVEL SECURITY;
ALTER TABLE gear_alert FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'gear_alert'
      AND policyname = 'tenant_isolation_gear_alert'
  ) THEN
    CREATE POLICY tenant_isolation_gear_alert ON gear_alert
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
