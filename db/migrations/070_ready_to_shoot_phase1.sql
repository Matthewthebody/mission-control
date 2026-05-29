ALTER TABLE shoot
  ADD COLUMN IF NOT EXISTS lead_confirmed_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lead_confirmed_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS lead_confirmed_ready_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_confirmed_ready_exception_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lead_confirmed_ready_confirmation_id uuid;

CREATE TABLE IF NOT EXISTS shoot_operational_confirmation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  confirmation_type text NOT NULL,
  confirmed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  confirmed_at timestamptz NOT NULL,
  staffing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  all_assigned_photographers_present boolean NOT NULL DEFAULT false,
  clean_confirmation boolean NOT NULL DEFAULT true,
  exception_reason text,
  note text,
  location_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  device_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shoot_operational_confirmation_type_chk CHECK (confirmation_type = 'ready_to_shoot')
);

CREATE INDEX IF NOT EXISTS shoot_operational_confirmation_lookup_idx
  ON shoot_operational_confirmation (tenant_id, shoot_id, confirmation_type, confirmed_at DESC);

CREATE INDEX IF NOT EXISTS shoot_operational_confirmation_actor_idx
  ON shoot_operational_confirmation (tenant_id, confirmed_by_user_id, confirmed_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shoot_lead_confirmed_ready_confirmation_fk'
  ) THEN
    ALTER TABLE shoot
      ADD CONSTRAINT shoot_lead_confirmed_ready_confirmation_fk
      FOREIGN KEY (lead_confirmed_ready_confirmation_id)
      REFERENCES shoot_operational_confirmation(id)
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE shoot_operational_confirmation ENABLE ROW LEVEL SECURITY;
ALTER TABLE shoot_operational_confirmation FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_shoot_operational_confirmation ON shoot_operational_confirmation;
CREATE POLICY tenant_isolation_shoot_operational_confirmation ON shoot_operational_confirmation
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
