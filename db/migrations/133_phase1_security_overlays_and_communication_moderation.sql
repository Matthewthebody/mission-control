BEGIN;

ALTER TABLE auth_session
  ADD COLUMN IF NOT EXISTS authenticated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'communication_message_visibility_status') THEN
    CREATE TYPE communication_message_visibility_status AS ENUM ('visible', 'moderated_hidden');
  END IF;
END $$;

ALTER TABLE teams_communication_delivery
  ADD COLUMN IF NOT EXISTS visibility_status communication_message_visibility_status NOT NULL DEFAULT 'visible',
  ADD COLUMN IF NOT EXISTS moderated_at timestamptz,
  ADD COLUMN IF NOT EXISTS moderated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moderation_reason text,
  ADD COLUMN IF NOT EXISTS original_visibility_scope jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS teams_communication_delivery_visibility_idx
  ON teams_communication_delivery (tenant_id, visibility_status, created_at DESC);

ALTER TABLE user_account
  ADD COLUMN IF NOT EXISTS communication_posting_disabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS communication_posting_disabled_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS communication_posting_disabled_reason text;

CREATE TABLE IF NOT EXISTS communication_moderation_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  target_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  related_reference_id uuid REFERENCES teams_communication_reference(id) ON DELETE SET NULL,
  related_delivery_id uuid REFERENCES teams_communication_delivery(id) ON DELETE SET NULL,
  object_type text,
  object_id uuid,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reason text NOT NULL,
  original_visibility_status communication_message_visibility_status,
  original_visibility_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    action_type IN (
      'message_hidden',
      'message_restored',
      'posting_disabled',
      'posting_enabled',
      'communication_access_revoked',
      'communication_access_restored',
      'app_access_revoked'
    )
  ),
  CHECK (
    target_type IN ('delivery', 'user_account', 'membership')
  )
);

CREATE INDEX IF NOT EXISTS communication_moderation_event_tenant_created_idx
  ON communication_moderation_event (tenant_id, created_at DESC);

ALTER TABLE communication_moderation_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_moderation_event FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'communication_moderation_event'
      AND policyname = 'tenant_isolation_communication_moderation_event'
  ) THEN
    CREATE POLICY tenant_isolation_communication_moderation_event ON communication_moderation_event
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

INSERT INTO permission (code, name, description, resource_type, action_group)
VALUES
  (
    'communication.moderate',
    'Moderate Communication Visibility',
    'Hide or restore record-linked communication items from normal user-facing views while preserving audit history.',
    'communication',
    'moderate'
  ),
  (
    'communication.revoke_access',
    'Revoke Communication Access',
    'Disable communication posting or linked communication access for a user immediately.',
    'communication',
    'configure'
  )
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  resource_type = EXCLUDED.resource_type,
  action_group = EXCLUDED.action_group,
  updated_at = now();

WITH seeded(role_code, scope_type, scope_value, permission_codes) AS (
  VALUES
    ('admin', 'global', NULL, ARRAY['communication.moderate', 'communication.revoke_access']::text[]),
    ('system_admin', 'global', NULL, ARRAY['communication.moderate', 'communication.revoke_access']::text[])
)
INSERT INTO role_permission_grant (role_id, permission_id, scope_type, scope_value, effect)
SELECT
  role.id,
  permission.id,
  seeded.scope_type::policy_scope_type,
  seeded.scope_value,
  'allow'::policy_effect_type
FROM seeded
JOIN role
  ON role.code = seeded.role_code
JOIN LATERAL unnest(seeded.permission_codes) AS permission_code(code)
  ON true
JOIN permission
  ON permission.code = permission_code.code
ON CONFLICT DO NOTHING;

COMMIT;
