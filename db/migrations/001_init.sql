CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pmc_app') THEN
    CREATE ROLE pmc_app NOBYPASSRLS;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.set_context(p_tenant_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.tenant_id', COALESCE(p_tenant_id::text, ''), true);
  PERFORM set_config('app.user_id', COALESCE(p_user_id::text, ''), true);
END;
$$;

CREATE TABLE tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE studio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE permission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE role_permission (
  role_id uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permission(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_role (
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  PRIMARY KEY (tenant_id, user_id, role_id)
);

CREATE OR REPLACE FUNCTION app.dev_login_lookup(p_email text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  email text,
  full_name text,
  roles text[],
  permissions text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT u.id,
         u.tenant_id,
         u.email,
         u.full_name,
         COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
         COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
  FROM app_user u
  LEFT JOIN user_role ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
  LEFT JOIN role r ON r.id = ur.role_id
  LEFT JOIN role_permission rp ON rp.role_id = r.id
  LEFT JOIN permission p ON p.id = rp.permission_id
  WHERE u.email = p_email
  GROUP BY u.id
$$;

GRANT USAGE ON SCHEMA public, app TO pmc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pmc_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pmc_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO pmc_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pmc_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO pmc_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT EXECUTE ON FUNCTIONS TO pmc_app;

ALTER TABLE studio ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_role ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio FORCE ROW LEVEL SECURITY;
ALTER TABLE app_user FORCE ROW LEVEL SECURITY;
ALTER TABLE user_role FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_studio ON studio
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_user ON app_user
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_user_role ON user_role
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
