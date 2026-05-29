DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trade_request_status') THEN
    BEGIN
      ALTER TYPE trade_request_status ADD VALUE IF NOT EXISTS 'pending_recipient';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TYPE trade_request_status ADD VALUE IF NOT EXISTS 'recipient_declined';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TYPE trade_request_status ADD VALUE IF NOT EXISTS 'pending_manager';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TYPE trade_request_status ADD VALUE IF NOT EXISTS 'denied';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TYPE trade_request_status ADD VALUE IF NOT EXISTS 'canceled';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pto_request_status') THEN
    BEGIN
      ALTER TYPE pto_request_status ADD VALUE IF NOT EXISTS 'submitted';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TYPE pto_request_status ADD VALUE IF NOT EXISTS 'denied';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TYPE pto_request_status ADD VALUE IF NOT EXISTS 'canceled';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS approval_routing_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  request_kind text NOT NULL,
  policy_code text NOT NULL,
  label text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, request_kind)
);

CREATE TABLE IF NOT EXISTS role_level_rank (
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  job_function_profile job_function_profile NOT NULL,
  level_rank integer NOT NULL CHECK (level_rank > 0),
  allow_shift_trade boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, job_function_profile)
);

CREATE TABLE IF NOT EXISTS dangerous_action_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  action_code text NOT NULL,
  minimum_authority_tier authority_tier NOT NULL,
  confirmation_required boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, action_code)
);

CREATE TABLE IF NOT EXISTS dangerous_action_execution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  action_code text NOT NULL,
  status text NOT NULL,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id text,
  source_module text NOT NULL DEFAULT 'unknown',
  reason text,
  before_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_sync_operation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  provider text NOT NULL,
  direction text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  external_object_type text NOT NULL,
  external_id text,
  operation_type text NOT NULL,
  source_system text NOT NULL,
  source_change_key text,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  triggered_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  last_error_at timestamptz,
  conflict_summary text,
  conflict_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  replay_of_operation_id uuid REFERENCES integration_sync_operation(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS approval_routing_policy_tenant_kind_idx
  ON approval_routing_policy (tenant_id, request_kind, enabled);

CREATE INDEX IF NOT EXISTS dangerous_action_policy_tenant_action_idx
  ON dangerous_action_policy (tenant_id, action_code, enabled);

CREATE INDEX IF NOT EXISTS dangerous_action_execution_tenant_created_idx
  ON dangerous_action_execution (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS dangerous_action_execution_tenant_status_idx
  ON dangerous_action_execution (tenant_id, action_code, status, created_at DESC);

CREATE INDEX IF NOT EXISTS integration_sync_operation_tenant_provider_idx
  ON integration_sync_operation (tenant_id, provider, status, created_at DESC);

CREATE INDEX IF NOT EXISTS integration_sync_operation_tenant_entity_idx
  ON integration_sync_operation (tenant_id, entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS integration_sync_operation_tenant_external_idx
  ON integration_sync_operation (tenant_id, provider, external_object_type, external_id);

ALTER TABLE shift_trade_request
  ADD COLUMN IF NOT EXISTS recipient_responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS recipient_notes text,
  ADD COLUMN IF NOT EXISTS manager_decided_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS manager_notes text,
  ADD COLUMN IF NOT EXISTS canceled_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_routing_policy_code text NOT NULL DEFAULT 'shift_manager_user',
  ADD COLUMN IF NOT EXISTS approver_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requester_role_rank integer,
  ADD COLUMN IF NOT EXISTS recipient_role_rank integer,
  ADD COLUMN IF NOT EXISTS conflict_code text,
  ADD COLUMN IF NOT EXISTS conflict_summary text,
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS finalized_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_resolution_reason text;

ALTER TABLE pto_request
  ADD COLUMN IF NOT EXISTS requested_on date,
  ADD COLUMN IF NOT EXISTS request_unit text NOT NULL DEFAULT 'full_day',
  ADD COLUMN IF NOT EXISTS requested_hours numeric(4,1) NOT NULL DEFAULT 7.5,
  ADD COLUMN IF NOT EXISTS approval_routing_policy_code text NOT NULL DEFAULT 'department_supervisor_or_leadership',
  ADD COLUMN IF NOT EXISTS approver_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conflicting_shift_id uuid REFERENCES work_shift(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conflicting_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_denial_reason text,
  ADD COLUMN IF NOT EXISTS denied_automatically boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS canceled_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS exported_at timestamptz;

ALTER TABLE pto_request
  DROP CONSTRAINT IF EXISTS pto_request_request_unit_check;

ALTER TABLE pto_request
  ADD CONSTRAINT pto_request_request_unit_check
  CHECK (request_unit IN ('half_day', 'full_day'));

ALTER TABLE pto_request
  DROP CONSTRAINT IF EXISTS pto_request_requested_hours_check;

ALTER TABLE pto_request
  ADD CONSTRAINT pto_request_requested_hours_check
  CHECK (requested_hours IN (4.0, 7.5));

ALTER TABLE approval_routing_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_level_rank ENABLE ROW LEVEL SECURITY;
ALTER TABLE dangerous_action_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE dangerous_action_execution ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_sync_operation ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_routing_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE role_level_rank FORCE ROW LEVEL SECURITY;
ALTER TABLE dangerous_action_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE dangerous_action_execution FORCE ROW LEVEL SECURITY;
ALTER TABLE integration_sync_operation FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'approval_routing_policy'
      AND policyname = 'tenant_isolation_approval_routing_policy'
  ) THEN
    CREATE POLICY tenant_isolation_approval_routing_policy ON approval_routing_policy
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'role_level_rank'
      AND policyname = 'tenant_isolation_role_level_rank'
  ) THEN
    CREATE POLICY tenant_isolation_role_level_rank ON role_level_rank
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'dangerous_action_policy'
      AND policyname = 'tenant_isolation_dangerous_action_policy'
  ) THEN
    CREATE POLICY tenant_isolation_dangerous_action_policy ON dangerous_action_policy
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'dangerous_action_execution'
      AND policyname = 'tenant_isolation_dangerous_action_execution'
  ) THEN
    CREATE POLICY tenant_isolation_dangerous_action_execution ON dangerous_action_execution
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'integration_sync_operation'
      AND policyname = 'tenant_isolation_integration_sync_operation'
  ) THEN
    CREATE POLICY tenant_isolation_integration_sync_operation ON integration_sync_operation
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

INSERT INTO approval_routing_policy (tenant_id, request_kind, policy_code, label, config)
SELECT t.id, 'pto_request', 'department_supervisor_or_leadership', 'Department supervisors or leadership', '{}'::jsonb
FROM tenant t
ON CONFLICT (tenant_id, request_kind) DO NOTHING;

INSERT INTO approval_routing_policy (tenant_id, request_kind, policy_code, label, config)
SELECT t.id, 'shift_trade_request', 'shift_manager_user', 'Shift manager user', '{}'::jsonb
FROM tenant t
ON CONFLICT (tenant_id, request_kind) DO NOTHING;

INSERT INTO role_level_rank (tenant_id, job_function_profile, level_rank, allow_shift_trade)
SELECT t.id, profile.job_function_profile::job_function_profile, profile.level_rank, profile.allow_shift_trade
FROM tenant t
CROSS JOIN (
  VALUES
    ('leadership_team_member', 100, false),
    ('leadership_viewer', 90, false),
    ('director_of_photography', 80, true),
    ('director_of_school_photography', 80, true),
    ('director_of_sports_photography', 80, true),
    ('director_of_digital_production', 75, true),
    ('senior_photographer', 60, true),
    ('schools_client_success', 55, true),
    ('sports_client_success', 55, true),
    ('customer_service_rep', 50, true),
    ('graphic_artist', 45, true),
    ('associate_photographer', 30, true),
    ('part_time_photographer', 25, true),
    ('seasonal_photographer', 20, true)
) AS profile(job_function_profile, level_rank, allow_shift_trade)
ON CONFLICT (tenant_id, job_function_profile) DO NOTHING;

INSERT INTO dangerous_action_policy (tenant_id, action_code, minimum_authority_tier, confirmation_required)
SELECT t.id, policy.action_code, policy.minimum_authority_tier::authority_tier, policy.confirmation_required
FROM tenant t
CROSS JOIN (
  VALUES
    ('delete_shift', 'leadership', true),
    ('delete_shoot', 'leadership', true),
    ('bulk_reassign_staff', 'director_admin', true),
    ('backdate_punch_change', 'director_admin', true),
    ('change_shoot_status_complete', 'director_admin', true),
    ('hide_alert', 'director_admin', true),
    ('cancel_big_shoot', 'leadership', true),
    ('edit_historical_record', 'director_admin', true),
    ('push_external_updates', 'director_admin', true)
) AS policy(action_code, minimum_authority_tier, confirmation_required)
ON CONFLICT (tenant_id, action_code) DO NOTHING;
