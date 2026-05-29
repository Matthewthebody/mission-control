CREATE TYPE membership_status AS ENUM ('invited', 'pending_approval', 'active', 'suspended', 'revoked');
CREATE TYPE department_code AS ENUM ('executive', 'operations', 'schools', 'sports', 'office', 'production', 'customer_service', 'unassigned');

CREATE TABLE user_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  password_hash text,
  is_email_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_user
  ADD COLUMN account_id uuid REFERENCES user_account(id) ON DELETE SET NULL,
  ADD COLUMN department department_code NOT NULL DEFAULT 'unassigned',
  ADD COLUMN status membership_status NOT NULL DEFAULT 'active',
  ADD COLUMN approved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN invited_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN invited_at timestamptz,
  ADD COLUMN suspended_at timestamptz,
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN last_login_at timestamptz,
  ADD COLUMN auth_version integer NOT NULL DEFAULT 1;

UPDATE app_user
SET status = 'active',
    approved_at = COALESCE(approved_at, created_at),
    is_active = true
WHERE status = 'active';

CREATE TABLE user_invite (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  app_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  email text NOT NULL,
  invited_role text,
  invited_department department_code,
  invited_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX user_invite_tenant_email_idx ON user_invite (tenant_id, email);
CREATE INDEX app_user_account_id_idx ON app_user (account_id);
CREATE INDEX app_user_status_idx ON app_user (tenant_id, status);

CREATE TABLE auth_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  auth_provider text NOT NULL DEFAULT 'password',
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text
);

CREATE INDEX auth_session_tenant_user_idx ON auth_session (tenant_id, user_id);
CREATE INDEX auth_session_active_idx ON auth_session (user_id, revoked_at, expires_at);

CREATE TABLE password_reset_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  requested_ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_tenant_created_idx ON audit_log (tenant_id, created_at DESC);
CREATE INDEX audit_log_tenant_action_idx ON audit_log (tenant_id, action, created_at DESC);

ALTER TABLE user_invite ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_invite FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_session FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_user_invite ON user_invite
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_auth_session ON auth_session
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_audit_log ON audit_log
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
