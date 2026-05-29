BEGIN;

ALTER TABLE user_account
  ADD COLUMN IF NOT EXISTS communication_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS teams_chat_default_target text,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;

UPDATE user_account
SET
  communication_enabled = true,
  last_verified_at = COALESCE(last_verified_at, last_login_at, linked_at, updated_at)
WHERE microsoft_user_id IS NOT NULL
  AND microsoft_tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_account_communication_ready_idx
  ON user_account (communication_enabled, last_verified_at DESC)
  WHERE microsoft_user_id IS NOT NULL
    AND microsoft_tenant_id IS NOT NULL;

INSERT INTO permission (code, name, description, resource_type, action_group)
VALUES
  (
    'communication.use',
    'Use Communication Actions',
    'Launch approved internal communication actions such as Teams chat, call, or meeting entry points for linked employees.',
    'communication',
    'use'
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
    ('admin', 'global', NULL, ARRAY['communication.use']::text[]),
    ('leadership', 'global', NULL, ARRAY['communication.use']::text[]),
    ('system_admin', 'global', NULL, ARRAY['communication.use']::text[]),
    ('schools', 'department', 'schools', ARRAY['communication.use']::text[]),
    ('sports', 'department', 'sports', ARRAY['communication.use']::text[]),
    ('account_reps', 'global', NULL, ARRAY['communication.use']::text[]),
    ('senior_photographers', 'assigned', NULL, ARRAY['communication.use']::text[]),
    ('seasonal_photographers', 'assigned', NULL, ARRAY['communication.use']::text[]),
    ('graphics_production', 'department', 'production', ARRAY['communication.use']::text[]),
    ('customer_service', 'department', 'customer_service', ARRAY['communication.use']::text[])
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
