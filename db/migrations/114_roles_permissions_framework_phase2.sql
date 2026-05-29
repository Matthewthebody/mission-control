BEGIN;

INSERT INTO permission (code, name, description, resource_type, action_group)
VALUES
  ('job.status.change', 'Change Job Status', 'Change operational job lifecycle and state fields in allowed scope.', 'job', 'write'),
  ('task.status.change', 'Change Task Status', 'Change task lifecycle and blocked/completed states in allowed scope.', 'task', 'write'),
  ('production.status.change', 'Change Production Status', 'Change production workflow and release status in allowed scope.', 'production', 'write'),
  ('exception.approve', 'Approve Exceptions', 'Approve operational exceptions, overrides, and protected follow-through.', 'approval', 'approve'),
  ('note.read', 'Read Notes', 'View operational notes in allowed scope.', 'operational_note', 'read'),
  ('note.create', 'Create Notes', 'Create operational notes in allowed scope.', 'operational_note', 'write'),
  ('note.update', 'Update Notes', 'Edit operational notes in allowed scope.', 'operational_note', 'write'),
  ('note.archive', 'Archive Notes', 'Archive operational notes in allowed scope.', 'operational_note', 'manage'),
  ('note.publish', 'Publish Notes', 'Publish or promote durable operational notes such as location memory.', 'operational_note', 'manage'),
  ('note.read_sensitive', 'Read Sensitive Notes', 'View manager, leadership, and restricted operational notes.', 'operational_note', 'read'),
  ('evaluation.read', 'Read Evaluations', 'View post-shoot evaluations in allowed scope.', 'post_shoot_evaluation', 'read'),
  ('evaluation.create', 'Create Evaluations', 'Create post-shoot evaluations in allowed scope.', 'post_shoot_evaluation', 'write'),
  ('evaluation.update', 'Update Evaluations', 'Update post-shoot evaluations in allowed scope.', 'post_shoot_evaluation', 'write'),
  ('evaluation.review', 'Review Evaluations', 'Review, close, or route post-shoot evaluations.', 'post_shoot_evaluation', 'approve'),
  ('evaluation.read_sensitive', 'Read Sensitive Evaluations', 'View leadership-sensitive evaluation details and follow-up context.', 'post_shoot_evaluation', 'read'),
  ('system.configure', 'Configure System', 'Change protected system configuration and internal behavior controls.', 'system', 'manage')
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  resource_type = EXCLUDED.resource_type,
  action_group = EXCLUDED.action_group,
  updated_at = now();

INSERT INTO role (code, name, description, department_type, is_system_role, is_assignable)
VALUES
  ('system_admin', 'System Admin', 'Internal system administration role for protected configuration and access management.', NULL, true, true),
  ('schools', 'Schools', 'Department-scoped operational role for Schools work.', 'schools', true, true),
  ('sports', 'Sports', 'Department-scoped operational role for Sports work.', 'sports', true, true),
  ('account_reps', 'Account Reps', 'Client-facing ownership role for school and sports account relationships.', NULL, true, true),
  ('senior_photographers', 'Senior Photographers', 'Assigned operational role for senior and lead field photographers.', NULL, true, true),
  ('seasonal_photographers', 'Seasonal Photographers', 'Assigned operational role for associate and seasonal field photographers.', NULL, true, true),
  ('graphics_production', 'Graphics / Production', 'Department-scoped downstream production role.', 'production', true, true),
  ('customer_service', 'Customer Service', 'Client support and delivery follow-through role.', 'customer_service', true, true)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  department_type = EXCLUDED.department_type,
  is_system_role = EXCLUDED.is_system_role,
  is_assignable = EXCLUDED.is_assignable,
  updated_at = now();

UPDATE role
SET
  code = 'customer_service',
  name = 'Customer Service',
  description = 'Client support and delivery follow-through role.',
  department_type = 'customer_service',
  updated_at = now()
WHERE code = 'customer_service_ops'
  AND NOT EXISTS (
    SELECT 1
    FROM role existing
    WHERE existing.code = 'customer_service'
  );

WITH all_permissions AS (
  SELECT id
  FROM permission
),
system_admin_role AS (
  SELECT id
  FROM role
  WHERE code = 'system_admin'
)
INSERT INTO role_permission_grant (role_id, permission_id, scope_type, scope_value, effect)
SELECT system_admin_role.id, all_permissions.id, 'global'::policy_scope_type, NULL, 'allow'::policy_effect_type
FROM system_admin_role
JOIN all_permissions ON true
ON CONFLICT DO NOTHING;

WITH seeded(role_code, scope_type, scope_value, permission_codes) AS (
  VALUES
    (
      'admin',
      'global',
      NULL,
      ARRAY[
        'job.status.change',
        'task.read',
        'task.create',
        'task.update',
        'task.assign',
        'task.status.change',
        'production.status.change',
        'exception.approve',
        'note.read',
        'note.create',
        'note.update',
        'note.archive',
        'note.publish',
        'note.read_sensitive',
        'evaluation.read',
        'evaluation.create',
        'evaluation.update',
        'evaluation.review',
        'evaluation.read_sensitive',
        'system.configure'
      ]::text[]
    ),
    (
      'leadership',
      'global',
      NULL,
      ARRAY[
        'job.status.change',
        'task.read',
        'task.create',
        'task.update',
        'task.assign',
        'task.status.change',
        'production.status.change',
        'exception.approve',
        'note.read',
        'note.create',
        'note.update',
        'note.archive',
        'note.publish',
        'note.read_sensitive',
        'evaluation.read',
        'evaluation.create',
        'evaluation.update',
        'evaluation.review',
        'evaluation.read_sensitive'
      ]::text[]
    ),
    (
      'schools',
      'department',
      'schools',
      ARRAY[
        'dashboard.read',
        'watchlist.read',
        'alerts.read_own',
        'alerts.manage_own',
        'job.create',
        'job.read',
        'job.update',
        'job.status.change',
        'job.publish',
        'job.cancel',
        'job.archive',
        'jobday.create',
        'jobday.update',
        'jobday.cancel',
        'jobday.mark_in_progress',
        'jobday.mark_complete',
        'job.assign_staff',
        'job.mark_ready',
        'job.check_in_others',
        'job.manage_readiness',
        'task.create',
        'task.read',
        'task.update',
        'task.assign',
        'task.status.change',
        'organization.read',
        'organization.update',
        'organization.create',
        'contact.read',
        'contact.update',
        'contact.create',
        'location.read',
        'location.update',
        'location.create',
        'production.read',
        'note.read',
        'note.create',
        'note.update',
        'note.archive',
        'note.publish',
        'note.read_sensitive',
        'evaluation.read',
        'evaluation.create',
        'evaluation.update',
        'evaluation.review',
        'evaluation.read_sensitive',
        'approval.read',
        'approval.manage',
        'exception.approve',
        'report.read_department',
        'import.jobs',
        'export.jobs'
      ]::text[]
    ),
    (
      'sports',
      'department',
      'sports',
      ARRAY[
        'dashboard.read',
        'watchlist.read',
        'alerts.read_own',
        'alerts.manage_own',
        'job.create',
        'job.read',
        'job.update',
        'job.status.change',
        'job.publish',
        'job.cancel',
        'job.archive',
        'jobday.create',
        'jobday.update',
        'jobday.cancel',
        'jobday.mark_in_progress',
        'jobday.mark_complete',
        'job.assign_staff',
        'job.mark_ready',
        'job.check_in_others',
        'job.manage_readiness',
        'task.create',
        'task.read',
        'task.update',
        'task.assign',
        'task.status.change',
        'organization.read',
        'organization.update',
        'organization.create',
        'contact.read',
        'contact.update',
        'contact.create',
        'location.read',
        'location.update',
        'location.create',
        'production.read',
        'production.update',
        'production.status.change',
        'note.read',
        'note.create',
        'note.update',
        'note.archive',
        'note.publish',
        'note.read_sensitive',
        'evaluation.read',
        'evaluation.create',
        'evaluation.update',
        'evaluation.review',
        'evaluation.read_sensitive',
        'approval.read',
        'approval.manage',
        'exception.approve',
        'report.read_department',
        'import.jobs',
        'export.jobs'
      ]::text[]
    ),
    (
      'account_reps',
      'global',
      NULL,
      ARRAY[
        'dashboard.read',
        'job.read',
        'organization.read',
        'organization.update',
        'contact.read',
        'contact.update',
        'contact.create',
        'location.read',
        'task.read',
        'task.update',
        'note.read',
        'note.create',
        'evaluation.read',
        'approval.read',
        'report.read_department'
      ]::text[]
    ),
    (
      'senior_photographers',
      'assigned',
      NULL,
      ARRAY[
        'dashboard.read',
        'alerts.read_own',
        'alerts.manage_own',
        'watchlist.read',
        'watchflag.acknowledge',
        'job.read',
        'job.mark_ready',
        'job.check_in_self',
        'task.read',
        'task.update',
        'note.read',
        'note.create',
        'note.update',
        'note.read_sensitive',
        'evaluation.read',
        'evaluation.create',
        'evaluation.update',
        'evaluation.read_sensitive'
      ]::text[]
    ),
    (
      'seasonal_photographers',
      'assigned',
      NULL,
      ARRAY[
        'dashboard.read',
        'alerts.read_own',
        'job.read',
        'job.check_in_self',
        'task.read',
        'note.read',
        'note.create',
        'note.update',
        'evaluation.read',
        'evaluation.create',
        'evaluation.update'
      ]::text[]
    ),
    (
      'graphics_production',
      'department',
      'production',
      ARRAY[
        'dashboard.read',
        'alerts.read_own',
        'job.read',
        'task.read',
        'task.update',
        'task.assign',
        'task.status.change',
        'production.read',
        'production.create',
        'production.update',
        'production.status.change',
        'production.assign_owner',
        'production.mark_blocked',
        'production.manage_handoffs',
        'note.read',
        'note.create',
        'note.update',
        'evaluation.read',
        'approval.read',
        'qa.read',
        'qa.manage',
        'deliverable.read',
        'deliverable.manage',
        'productionissue.manage'
      ]::text[]
    ),
    (
      'customer_service',
      'department',
      'customer_service',
      ARRAY[
        'dashboard.read',
        'watchlist.read',
        'alerts.read_own',
        'alerts.manage_own',
        'job.read',
        'organization.read',
        'organization.update',
        'contact.read',
        'contact.update',
        'contact.create',
        'location.read',
        'task.read',
        'task.update',
        'note.read',
        'note.create',
        'evaluation.read',
        'approval.read',
        'deliverable.read'
      ]::text[]
    )
)
INSERT INTO role_permission_grant (role_id, permission_id, scope_type, scope_value, effect)
SELECT role.id, permission.id, seeded.scope_type::policy_scope_type, seeded.scope_value, 'allow'::policy_effect_type
FROM seeded
JOIN role ON role.code = seeded.role_code
JOIN permission ON permission.code = ANY (seeded.permission_codes)
ON CONFLICT DO NOTHING;

WITH candidate_roles AS (
  SELECT
    u.tenant_id,
    u.id AS user_id,
    'system_admin'::text AS role_code,
    'global'::text AS scope_type,
    NULL::text AS scope_value
  FROM app_user u
  LEFT JOIN user_authority_assignment uaa
    ON uaa.tenant_id = u.tenant_id
   AND uaa.user_id = u.id
  WHERE u.status IN ('active', 'pending_approval', 'invited')
    AND uaa.authority_tier = 'super_admin'

  UNION ALL

  SELECT
    u.tenant_id,
    u.id AS user_id,
    'leadership'::text AS role_code,
    'global'::text AS scope_type,
    NULL::text AS scope_value
  FROM app_user u
  LEFT JOIN user_authority_assignment uaa
    ON uaa.tenant_id = u.tenant_id
   AND uaa.user_id = u.id
  WHERE u.status IN ('active', 'pending_approval', 'invited')
    AND (
      uaa.authority_tier IN ('super_admin', 'leadership')
      OR uaa.primary_job_function_profile = 'leadership_team_member'
    )

  UNION ALL

  SELECT
    u.tenant_id,
    u.id AS user_id,
    'schools'::text AS role_code,
    'department'::text AS scope_type,
    'schools'::text AS scope_value
  FROM app_user u
  LEFT JOIN user_authority_assignment uaa
    ON uaa.tenant_id = u.tenant_id
   AND uaa.user_id = u.id
  WHERE u.status IN ('active', 'pending_approval', 'invited')
    AND (
      u.department = 'schools'
      OR uaa.primary_job_function_profile IN ('schools_client_success', 'director_of_school_photography')
    )

  UNION ALL

  SELECT
    u.tenant_id,
    u.id AS user_id,
    'sports'::text AS role_code,
    'department'::text AS scope_type,
    'sports'::text AS scope_value
  FROM app_user u
  LEFT JOIN user_authority_assignment uaa
    ON uaa.tenant_id = u.tenant_id
   AND uaa.user_id = u.id
  WHERE u.status IN ('active', 'pending_approval', 'invited')
    AND (
      u.department = 'sports'
      OR uaa.primary_job_function_profile IN ('sports_client_success', 'director_of_sports_photography')
    )

  UNION ALL

  SELECT
    u.tenant_id,
    u.id AS user_id,
    'account_reps'::text AS role_code,
    'department'::text AS scope_type,
    CASE
      WHEN uaa.primary_job_function_profile = 'schools_client_success' THEN 'schools'
      WHEN uaa.primary_job_function_profile = 'sports_client_success' THEN 'sports'
      ELSE NULL
    END AS scope_value
  FROM app_user u
  LEFT JOIN user_authority_assignment uaa
    ON uaa.tenant_id = u.tenant_id
   AND uaa.user_id = u.id
  WHERE u.status IN ('active', 'pending_approval', 'invited')
    AND uaa.primary_job_function_profile IN ('schools_client_success', 'sports_client_success')

  UNION ALL

  SELECT
    u.tenant_id,
    u.id AS user_id,
    'senior_photographers'::text AS role_code,
    'assigned'::text AS scope_type,
    NULL::text AS scope_value
  FROM app_user u
  LEFT JOIN user_authority_assignment uaa
    ON uaa.tenant_id = u.tenant_id
   AND uaa.user_id = u.id
  WHERE u.status IN ('active', 'pending_approval', 'invited')
    AND uaa.primary_job_function_profile IN ('senior_photographer', 'director_of_photography')

  UNION ALL

  SELECT
    u.tenant_id,
    u.id AS user_id,
    'seasonal_photographers'::text AS role_code,
    'assigned'::text AS scope_type,
    NULL::text AS scope_value
  FROM app_user u
  LEFT JOIN user_authority_assignment uaa
    ON uaa.tenant_id = u.tenant_id
   AND uaa.user_id = u.id
  WHERE u.status IN ('active', 'pending_approval', 'invited')
    AND uaa.primary_job_function_profile IN ('associate_photographer', 'seasonal_photographer', 'part_time_photographer')

  UNION ALL

  SELECT
    u.tenant_id,
    u.id AS user_id,
    'graphics_production'::text AS role_code,
    'department'::text AS scope_type,
    'production'::text AS scope_value
  FROM app_user u
  LEFT JOIN user_authority_assignment uaa
    ON uaa.tenant_id = u.tenant_id
   AND uaa.user_id = u.id
  WHERE u.status IN ('active', 'pending_approval', 'invited')
    AND (
      u.department = 'production'
      OR uaa.primary_job_function_profile IN ('graphic_artist', 'director_of_digital_production')
    )

  UNION ALL

  SELECT
    u.tenant_id,
    u.id AS user_id,
    'customer_service'::text AS role_code,
    'department'::text AS scope_type,
    'customer_service'::text AS scope_value
  FROM app_user u
  LEFT JOIN user_authority_assignment uaa
    ON uaa.tenant_id = u.tenant_id
   AND uaa.user_id = u.id
  WHERE u.status IN ('active', 'pending_approval', 'invited')
    AND (
      u.department = 'customer_service'
      OR uaa.primary_job_function_profile = 'customer_service_rep'
    )
),
derived_roles AS (
  SELECT DISTINCT tenant_id, user_id, role_code, scope_type, scope_value
  FROM candidate_roles
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
  derived_roles.tenant_id,
  derived_roles.user_id,
  role.id,
  derived_roles.scope_type::policy_scope_type,
  derived_roles.scope_value,
  now(),
  NULL,
  NULL,
  'Backfilled internal role framework assignment'
FROM derived_roles
JOIN role ON role.code = derived_roles.role_code
WHERE derived_roles.role_code IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM user_role_assignment assignment
    WHERE assignment.tenant_id = derived_roles.tenant_id
      AND assignment.user_id = derived_roles.user_id
      AND assignment.role_id = role.id
      AND assignment.scope_type = derived_roles.scope_type::policy_scope_type
      AND COALESCE(assignment.scope_value, '') = COALESCE(derived_roles.scope_value, '')
  );

INSERT INTO section_visibility_rule (resource_type, section_key, required_permission_code, sensitivity_category, default_visibility, department_type)
VALUES
  ('operational_note', 'sensitive_notes', 'note.read_sensitive', 'operational_sensitive', 'hidden', NULL),
  ('post_shoot_evaluation', 'sensitive_review', 'evaluation.read_sensitive', 'leadership_restricted', 'hidden', NULL),
  ('settings', 'system_configuration', 'system.configure', 'system_admin_only', 'hidden', NULL)
ON CONFLICT DO NOTHING;

COMMIT;
