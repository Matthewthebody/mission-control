DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gear_status') THEN
    CREATE TYPE gear_status AS ENUM (
      'available',
      'assigned',
      'checked_out',
      'in_transit',
      'in_office',
      'needs_repair',
      'under_repair',
      'missing',
      'retired'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gear_custody_event_type') THEN
    CREATE TYPE gear_custody_event_type AS ENUM (
      'assigned',
      'unassigned',
      'checked_out',
      'returned',
      'scanned',
      'moved',
      'custody_transferred',
      'home_location_updated',
      'current_custodian_updated',
      'last_seen_with_updated',
      'pre_shoot_verification',
      'temporary_substitution_started',
      'temporary_substitution_ended',
      'overdue_return_flagged',
      'missing_gear_alerted',
      'tile_tracker_linked',
      'tile_tracker_unlinked'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gear_service_repair_issue_type') THEN
    CREATE TYPE gear_service_repair_issue_type AS ENUM (
      'damage',
      'missing_part',
      'tracker_issue',
      'battery_issue',
      'routine_service',
      'cleaning',
      'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gear_service_repair_status') THEN
    CREATE TYPE gear_service_repair_status AS ENUM (
      'open',
      'under_review',
      'in_service',
      'resolved',
      'closed'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS gear_home_location (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  active_status boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gear_home_location_name_uq
  ON gear_home_location (tenant_id, lower(name));

CREATE TABLE IF NOT EXISTS gear_kit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  kit_name text NOT NULL,
  kit_type text NOT NULL,
  internal_kit_id text NOT NULL,
  qr_code_id text,
  tile_tracker_id text,
  assigned_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  home_location_id uuid REFERENCES gear_home_location(id) ON DELETE SET NULL,
  status gear_status NOT NULL DEFAULT 'available',
  notes text,
  active_status boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gear_kit_internal_kit_id_uq
  ON gear_kit (tenant_id, lower(internal_kit_id));

CREATE UNIQUE INDEX IF NOT EXISTS gear_kit_qr_code_id_uq
  ON gear_kit (tenant_id, lower(qr_code_id))
  WHERE qr_code_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gear_kit_tile_tracker_id_uq
  ON gear_kit (tenant_id, lower(tile_tracker_id))
  WHERE tile_tracker_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_kit_status_idx
  ON gear_kit (tenant_id, status, active_status);

CREATE INDEX IF NOT EXISTS gear_kit_assigned_user_idx
  ON gear_kit (tenant_id, assigned_user_id)
  WHERE assigned_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS gear_asset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  internal_asset_id text NOT NULL,
  asset_name text NOT NULL,
  category text NOT NULL,
  manufacturer text,
  model text,
  serial_number text,
  qr_code_id text,
  tile_tracker_id text,
  tile_tracker_active boolean,
  status gear_status NOT NULL DEFAULT 'available',
  home_location_id uuid REFERENCES gear_home_location(id) ON DELETE SET NULL,
  current_kit_id uuid REFERENCES gear_kit(id) ON DELETE SET NULL,
  current_custodian_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  last_seen_with_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  notes text,
  active_status boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gear_asset_internal_asset_id_uq
  ON gear_asset (tenant_id, lower(internal_asset_id));

CREATE UNIQUE INDEX IF NOT EXISTS gear_asset_serial_number_uq
  ON gear_asset (tenant_id, lower(serial_number))
  WHERE serial_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gear_asset_qr_code_id_uq
  ON gear_asset (tenant_id, lower(qr_code_id))
  WHERE qr_code_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gear_asset_tile_tracker_id_uq
  ON gear_asset (tenant_id, lower(tile_tracker_id))
  WHERE tile_tracker_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_asset_status_idx
  ON gear_asset (tenant_id, status, active_status);

CREATE INDEX IF NOT EXISTS gear_asset_home_location_idx
  ON gear_asset (tenant_id, home_location_id)
  WHERE home_location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_asset_current_kit_idx
  ON gear_asset (tenant_id, current_kit_id)
  WHERE current_kit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_asset_current_custodian_idx
  ON gear_asset (tenant_id, current_custodian_id)
  WHERE current_custodian_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_asset_last_seen_with_idx
  ON gear_asset (tenant_id, last_seen_with_user_id)
  WHERE last_seen_with_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS gear_kit_asset_membership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  kit_id uuid NOT NULL REFERENCES gear_kit(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES gear_asset(id) ON DELETE CASCADE,
  required_in_kit boolean NOT NULL DEFAULT true,
  display_order integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gear_kit_asset_membership_pair_uq
  ON gear_kit_asset_membership (tenant_id, kit_id, asset_id);

CREATE UNIQUE INDEX IF NOT EXISTS gear_kit_asset_membership_asset_active_uq
  ON gear_kit_asset_membership (tenant_id, asset_id);

CREATE INDEX IF NOT EXISTS gear_kit_asset_membership_kit_idx
  ON gear_kit_asset_membership (tenant_id, kit_id, display_order, created_at);

CREATE TABLE IF NOT EXISTS gear_custody_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES gear_asset(id) ON DELETE SET NULL,
  kit_id uuid REFERENCES gear_kit(id) ON DELETE SET NULL,
  event_type gear_custody_event_type NOT NULL,
  from_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  to_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  linked_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  linked_location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  timestamp timestamptz NOT NULL DEFAULT now(),
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  note text,
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gear_custody_event_target_chk CHECK (num_nonnulls(asset_id, kit_id) = 1),
  CONSTRAINT gear_custody_event_geo_pair_chk CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude IS NOT NULL AND longitude IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS gear_custody_event_asset_idx
  ON gear_custody_event (tenant_id, asset_id, timestamp DESC)
  WHERE asset_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_custody_event_kit_idx
  ON gear_custody_event (tenant_id, kit_id, timestamp DESC)
  WHERE kit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_custody_event_shoot_idx
  ON gear_custody_event (tenant_id, linked_shoot_id, timestamp DESC)
  WHERE linked_shoot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_custody_event_type_idx
  ON gear_custody_event (tenant_id, event_type, timestamp DESC);

CREATE TABLE IF NOT EXISTS gear_service_repair_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES gear_asset(id) ON DELETE SET NULL,
  kit_id uuid REFERENCES gear_kit(id) ON DELETE SET NULL,
  issue_type gear_service_repair_issue_type NOT NULL,
  status gear_service_repair_status NOT NULL DEFAULT 'open',
  reported_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  note text,
  CONSTRAINT gear_service_repair_record_target_chk CHECK (num_nonnulls(asset_id, kit_id) = 1),
  CONSTRAINT gear_service_repair_record_resolution_chk CHECK (
    resolved_at IS NULL OR resolved_at >= opened_at
  )
);

CREATE INDEX IF NOT EXISTS gear_service_repair_record_asset_idx
  ON gear_service_repair_record (tenant_id, asset_id, opened_at DESC)
  WHERE asset_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_service_repair_record_kit_idx
  ON gear_service_repair_record (tenant_id, kit_id, opened_at DESC)
  WHERE kit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gear_service_repair_record_status_idx
  ON gear_service_repair_record (tenant_id, status, opened_at DESC);

ALTER TABLE gear_home_location ENABLE ROW LEVEL SECURITY;
ALTER TABLE gear_home_location FORCE ROW LEVEL SECURITY;
ALTER TABLE gear_kit ENABLE ROW LEVEL SECURITY;
ALTER TABLE gear_kit FORCE ROW LEVEL SECURITY;
ALTER TABLE gear_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE gear_asset FORCE ROW LEVEL SECURITY;
ALTER TABLE gear_kit_asset_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE gear_kit_asset_membership FORCE ROW LEVEL SECURITY;
ALTER TABLE gear_custody_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE gear_custody_event FORCE ROW LEVEL SECURITY;
ALTER TABLE gear_service_repair_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE gear_service_repair_record FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'gear_home_location'
      AND policyname = 'tenant_isolation_gear_home_location'
  ) THEN
    CREATE POLICY tenant_isolation_gear_home_location ON gear_home_location
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
      AND tablename = 'gear_kit'
      AND policyname = 'tenant_isolation_gear_kit'
  ) THEN
    CREATE POLICY tenant_isolation_gear_kit ON gear_kit
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
      AND tablename = 'gear_asset'
      AND policyname = 'tenant_isolation_gear_asset'
  ) THEN
    CREATE POLICY tenant_isolation_gear_asset ON gear_asset
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
      AND tablename = 'gear_kit_asset_membership'
      AND policyname = 'tenant_isolation_gear_kit_asset_membership'
  ) THEN
    CREATE POLICY tenant_isolation_gear_kit_asset_membership ON gear_kit_asset_membership
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
      AND tablename = 'gear_custody_event'
      AND policyname = 'tenant_isolation_gear_custody_event'
  ) THEN
    CREATE POLICY tenant_isolation_gear_custody_event ON gear_custody_event
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
      AND tablename = 'gear_service_repair_record'
      AND policyname = 'tenant_isolation_gear_service_repair_record'
  ) THEN
    CREATE POLICY tenant_isolation_gear_service_repair_record ON gear_service_repair_record
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
