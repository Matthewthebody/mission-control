BEGIN;

INSERT INTO permission (code, name, description, resource_type, action_group)
VALUES
  (
    'communication.history.read',
    'Read Communication History',
    'View durable communication history, meeting sync state, and post-call metadata linked to operational records.',
    'communication',
    'read'
  ),
  (
    'communication.proactive.send',
    'Send Proactive Communications',
    'Allow the dashboard to queue proactive record-linked internal communications, recommendations, and alerts on behalf of the actor.',
    'communication',
    'send'
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
    (
      'admin',
      'global',
      NULL,
      ARRAY['communication.history.read', 'communication.proactive.send']::text[]
    ),
    (
      'leadership',
      'global',
      NULL,
      ARRAY['communication.history.read', 'communication.proactive.send']::text[]
    ),
    (
      'system_admin',
      'global',
      NULL,
      ARRAY['communication.history.read', 'communication.proactive.send']::text[]
    ),
    (
      'schools',
      'department',
      'schools',
      ARRAY['communication.history.read', 'communication.proactive.send']::text[]
    ),
    (
      'sports',
      'department',
      'sports',
      ARRAY['communication.history.read', 'communication.proactive.send']::text[]
    ),
    (
      'account_reps',
      'global',
      NULL,
      ARRAY['communication.history.read', 'communication.proactive.send']::text[]
    ),
    (
      'graphics_production',
      'department',
      'production',
      ARRAY['communication.history.read', 'communication.proactive.send']::text[]
    ),
    (
      'customer_service',
      'department',
      'customer_service',
      ARRAY['communication.history.read', 'communication.proactive.send']::text[]
    ),
    (
      'senior_photographers',
      'assigned',
      NULL,
      ARRAY['communication.history.read']::text[]
    ),
    (
      'seasonal_photographers',
      'assigned',
      NULL,
      ARRAY['communication.history.read']::text[]
    )
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
