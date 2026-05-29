ALTER TABLE auth_session
  ADD COLUMN IF NOT EXISTS identity_provider text NOT NULL DEFAULT 'local_password',
  ADD COLUMN IF NOT EXISTS session_assurance text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS csrf_token_hash text,
  ADD COLUMN IF NOT EXISTS last_reauthenticated_at timestamptz,
  ADD COLUMN IF NOT EXISTS elevated_until timestamptz,
  ADD COLUMN IF NOT EXISTS privileged_mode_until timestamptz,
  ADD COLUMN IF NOT EXISTS elevation_reason text,
  ADD COLUMN IF NOT EXISTS break_glass_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS break_glass_until timestamptz,
  ADD COLUMN IF NOT EXISTS break_glass_reason text,
  ADD COLUMN IF NOT EXISTS break_glass_scope_type text,
  ADD COLUMN IF NOT EXISTS break_glass_scope_id text,
  ADD COLUMN IF NOT EXISTS revoked_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoked_by_reason text;

ALTER TABLE dangerous_action_policy
  ADD COLUMN IF NOT EXISTS elevation_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reason_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS dual_approval_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS break_glass_allowed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reauth_window_minutes integer NOT NULL DEFAULT 10;

ALTER TABLE dangerous_action_execution
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES auth_session(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS security_approval_request_id uuid,
  ADD COLUMN IF NOT EXISTS elevated_session boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS break_glass_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS result_code text;

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES auth_session(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS effective_authority_tier authority_tier,
  ADD COLUMN IF NOT EXISTS session_assurance text,
  ADD COLUMN IF NOT EXISTS session_transport text,
  ADD COLUMN IF NOT EXISTS elevated_session boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS privileged_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS break_glass_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_surface text,
  ADD COLUMN IF NOT EXISTS result_status text;

CREATE TABLE IF NOT EXISTS break_glass_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES auth_session(id) ON DELETE CASCADE,
  scope_type text,
  scope_id text,
  reason text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  ended_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ended_reason text,
  review_status text NOT NULL DEFAULT 'pending_review',
  reviewed_at timestamptz,
  reviewed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS security_approval_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  request_type text NOT NULL,
  action_code text NOT NULL,
  subject_resource_type text NOT NULL,
  subject_resource_id text,
  status text NOT NULL DEFAULT 'pending',
  required_approver_tier authority_tier NOT NULL DEFAULT 'super_admin',
  requested_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  target_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reason text NOT NULL,
  current_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision_note text,
  approved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  rejected_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  canceled_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  executed_at timestamptz
);

CREATE INDEX IF NOT EXISTS auth_session_active_security_idx
  ON auth_session (tenant_id, user_id, revoked_at, expires_at, elevated_until, break_glass_until);

CREATE INDEX IF NOT EXISTS break_glass_event_active_idx
  ON break_glass_event (tenant_id, expires_at DESC)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS security_approval_request_pending_idx
  ON security_approval_request (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_security_review_idx
  ON audit_log (tenant_id, action, created_at DESC);

ALTER TABLE break_glass_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_approval_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE break_glass_event FORCE ROW LEVEL SECURITY;
ALTER TABLE security_approval_request FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'break_glass_event'
      AND policyname = 'tenant_isolation_break_glass_event'
  ) THEN
    CREATE POLICY tenant_isolation_break_glass_event ON break_glass_event
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'security_approval_request'
      AND policyname = 'tenant_isolation_security_approval_request'
  ) THEN
    CREATE POLICY tenant_isolation_security_approval_request ON security_approval_request
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

UPDATE dangerous_action_policy
SET
  elevation_required = true,
  reason_required = true,
  dual_approval_required = CASE
    WHEN action_code IN ('push_external_updates') THEN false
    ELSE dual_approval_required
  END,
  break_glass_allowed = CASE
    WHEN action_code IN ('delete_shift', 'delete_shoot', 'bulk_reassign_staff', 'backdate_punch_change', 'edit_historical_record', 'push_external_updates') THEN true
    ELSE break_glass_allowed
  END,
  reauth_window_minutes = CASE
    WHEN action_code IN ('delete_shift', 'delete_shoot', 'push_external_updates') THEN 10
    WHEN action_code IN ('bulk_reassign_staff', 'backdate_punch_change', 'edit_historical_record', 'change_shoot_status_complete') THEN 15
    ELSE reauth_window_minutes
  END;
