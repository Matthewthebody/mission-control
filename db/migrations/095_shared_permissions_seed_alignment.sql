INSERT INTO role_permission_grant (role_id, permission_id, scope_type, scope_value, effect)
SELECT role.id, permission.id, 'global'::policy_scope_type, NULL, 'allow'::policy_effect_type
FROM role
JOIN permission ON permission.code = 'profitability.read'
WHERE role.code = 'leadership'
ON CONFLICT DO NOTHING;

WITH admin_targets AS (
  SELECT DISTINCT
    u.tenant_id,
    u.id AS user_id
  FROM app_user u
  LEFT JOIN user_authority_assignment uaa
    ON uaa.tenant_id = u.tenant_id
   AND uaa.user_id = u.id
  LEFT JOIN user_role legacy_assignment
    ON legacy_assignment.tenant_id = u.tenant_id
   AND legacy_assignment.user_id = u.id
  LEFT JOIN role legacy_role
    ON legacy_role.id = legacy_assignment.role_id
  WHERE u.status IN ('active', 'pending_approval', 'invited')
    AND (
      uaa.authority_tier = 'super_admin'
      OR legacy_role.code = 'admin'
    )
)
INSERT INTO user_role_assignment (
  tenant_id,
  user_id,
  role_id,
  scope_type,
  scope_value,
  starts_at,
  ends_at,
  assigned_by_user_id,
  reason
)
SELECT
  admin_targets.tenant_id,
  admin_targets.user_id,
  role.id,
  'global'::policy_scope_type,
  NULL,
  now(),
  NULL,
  NULL,
  'Backfilled shared admin role from legacy admin authority'
FROM admin_targets
JOIN role ON role.code = 'admin'
WHERE NOT EXISTS (
  SELECT 1
  FROM user_role_assignment assignment
  WHERE assignment.tenant_id = admin_targets.tenant_id
    AND assignment.user_id = admin_targets.user_id
    AND assignment.role_id = role.id
    AND assignment.scope_type = 'global'::policy_scope_type
    AND assignment.scope_value IS NULL
);
