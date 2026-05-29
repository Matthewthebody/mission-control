ALTER TABLE role
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS department_type text,
  ADD COLUMN IF NOT EXISTS is_system_role boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_assignable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE permission
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS resource_type text,
  ADD COLUMN IF NOT EXISTS action_group text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'policy_scope_type') THEN
    CREATE TYPE policy_scope_type AS ENUM (
      'global',
      'department',
      'organization',
      'location',
      'owned',
      'assigned',
      'self',
      'team',
      'custom'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'policy_effect_type') THEN
    CREATE TYPE policy_effect_type AS ENUM ('allow', 'deny');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delegation_status_type') THEN
    CREATE TYPE delegation_status_type AS ENUM ('pending', 'active', 'expired', 'revoked');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'visibility_state_type') THEN
    CREATE TYPE visibility_state_type AS ENUM ('hidden', 'masked', 'readonly', 'editable');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sensitivity_category_type') THEN
    CREATE TYPE sensitivity_category_type AS ENUM (
      'operational_standard',
      'operational_sensitive',
      'contact_private',
      'financial_restricted',
      'personnel_restricted',
      'leadership_restricted',
      'system_admin_only'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'masking_strategy_type') THEN
    CREATE TYPE masking_strategy_type AS ENUM (
      'partial_email',
      'partial_phone',
      'money_summary_only',
      'initials_only',
      'redacted_text',
      'none'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS role_permission_grant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permission(id) ON DELETE CASCADE,
  scope_type policy_scope_type NOT NULL,
  scope_value text,
  effect policy_effect_type NOT NULL DEFAULT 'allow',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_role_permission_grant_identity
  ON role_permission_grant (role_id, permission_id, scope_type, COALESCE(scope_value, ''), effect);

CREATE TABLE IF NOT EXISTS user_role_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  scope_type policy_scope_type NOT NULL,
  scope_value text,
  starts_at timestamptz,
  ends_at timestamptz,
  assigned_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_role_assignment_lookup
  ON user_role_assignment (tenant_id, user_id, role_id, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS permission_override (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permission(id) ON DELETE CASCADE,
  scope_type policy_scope_type NOT NULL,
  scope_value text,
  effect policy_effect_type NOT NULL,
  starts_at timestamptz,
  ends_at timestamptz,
  reason text NOT NULL,
  approved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_permission_override_lookup
  ON permission_override (tenant_id, user_id, permission_id, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS delegation_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role_id uuid REFERENCES role(id) ON DELETE SET NULL,
  permission_bundle_key text,
  scope_type policy_scope_type NOT NULL,
  scope_value text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status delegation_status_type NOT NULL DEFAULT 'pending',
  reason text NOT NULL,
  approved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delegation_assignment_lookup
  ON delegation_assignment (tenant_id, to_user_id, status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS field_visibility_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type text NOT NULL,
  field_key text NOT NULL,
  sensitivity_category sensitivity_category_type NOT NULL DEFAULT 'operational_standard',
  required_permission_code text REFERENCES permission(code) ON DELETE SET NULL,
  default_visibility visibility_state_type NOT NULL DEFAULT 'editable',
  masking_strategy masking_strategy_type,
  department_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_field_visibility_rule_identity
  ON field_visibility_rule (resource_type, field_key, COALESCE(department_type::text, ''));

CREATE TABLE IF NOT EXISTS section_visibility_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type text NOT NULL,
  section_key text NOT NULL,
  required_permission_code text REFERENCES permission(code) ON DELETE SET NULL,
  sensitivity_category sensitivity_category_type,
  default_visibility visibility_state_type NOT NULL DEFAULT 'editable',
  department_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_section_visibility_rule_identity
  ON section_visibility_rule (resource_type, section_key, COALESCE(department_type::text, ''));

CREATE TABLE IF NOT EXISTS policy_audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  policy_event_type text NOT NULL,
  resource_type text,
  resource_id text,
  permission_code text REFERENCES permission(code) ON DELETE SET NULL,
  result text NOT NULL,
  details_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_policy_audit_event_lookup
  ON policy_audit_event (tenant_id, created_at DESC);

ALTER TABLE user_role_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_role_assignment FORCE ROW LEVEL SECURITY;
ALTER TABLE permission_override ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_override FORCE ROW LEVEL SECURITY;
ALTER TABLE delegation_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegation_assignment FORCE ROW LEVEL SECURITY;
ALTER TABLE policy_audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_audit_event FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_role_assignment' AND policyname = 'tenant_isolation_user_role_assignment') THEN
    CREATE POLICY tenant_isolation_user_role_assignment ON user_role_assignment
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'permission_override' AND policyname = 'tenant_isolation_permission_override') THEN
    CREATE POLICY tenant_isolation_permission_override ON permission_override
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'delegation_assignment' AND policyname = 'tenant_isolation_delegation_assignment') THEN
    CREATE POLICY tenant_isolation_delegation_assignment ON delegation_assignment
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'policy_audit_event' AND policyname = 'tenant_isolation_policy_audit_event') THEN
    CREATE POLICY tenant_isolation_policy_audit_event ON policy_audit_event
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

INSERT INTO role (code, name, description, department_type, is_system_role, is_assignable)
VALUES
  ('admin', 'Admin', 'Full system access across all modules and scopes.', NULL, true, true),
  ('leadership', 'Leadership', 'Cross-department operational leadership access.', NULL, true, true),
  ('schools_manager', 'Schools Manager', 'Department management access for Schools.', 'schools', true, true),
  ('schools_coordinator', 'Schools Coordinator', 'Scoped operational execution access for Schools.', 'schools', true, true),
  ('sports_manager', 'Sports Manager', 'Department management access for Sports.', 'sports', true, true),
  ('sports_coordinator', 'Sports Coordinator', 'Scoped operational execution access for Sports.', 'sports', true, true),
  ('photographer_lead', 'Photographer Lead', 'Lead day-of execution access for assigned work.', NULL, true, true),
  ('photographer_staff', 'Photographer Staff', 'Assigned field-work access for day-of execution.', NULL, true, true),
  ('production_manager', 'Production Manager', 'Cross-department downstream production management.', NULL, true, true),
  ('production_staff', 'Production Staff', 'Assigned downstream production execution.', NULL, true, true),
  ('customer_service', 'Customer Service', 'Client-safe operational and delivery issue access.', NULL, true, true),
  ('finance_readonly', 'Finance Readonly', 'Read-only finance visibility.', NULL, true, true),
  ('finance_manager', 'Finance Manager', 'Finance editing and reconciliation access.', NULL, true, true),
  ('department_observer', 'Department Observer', 'Read-only scoped department observer access.', NULL, true, true)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  department_type = EXCLUDED.department_type,
  is_system_role = EXCLUDED.is_system_role,
  is_assignable = EXCLUDED.is_assignable,
  updated_at = now();

INSERT INTO permission (code, name, description, resource_type, action_group)
VALUES
  ('dashboard.read', 'Read Dashboard', 'View shared operational dashboards.', 'dashboard', 'read'),
  ('dashboard.customize', 'Customize Dashboard', 'Reorder and personalize dashboard widgets.', 'dashboard', 'customize'),
  ('executive.read', 'Read Executive Dashboard', 'View cross-department executive dashboard surfaces.', 'dashboard', 'read'),
  ('watchlist.read', 'Read Watchlist', 'View scoped watchlist items.', 'watchlist', 'read'),
  ('watchflag.acknowledge', 'Acknowledge Watch Flag', 'Acknowledge scoped watch flags.', 'watchflag', 'manage'),
  ('watchflag.assign_owner', 'Assign Watch Flag Owner', 'Assign owners to scoped watch flags.', 'watchflag', 'manage'),
  ('watchflag.snooze', 'Snooze Watch Flag', 'Snooze scoped watch flags.', 'watchflag', 'manage'),
  ('watchflag.resolve', 'Resolve Watch Flag', 'Resolve scoped watch flags.', 'watchflag', 'manage'),
  ('watchflag.dismiss', 'Dismiss Watch Flag', 'Dismiss scoped watch flags.', 'watchflag', 'manage'),
  ('watchflag.escalate', 'Escalate Watch Flag', 'Escalate scoped watch flags.', 'watchflag', 'manage'),
  ('alerts.read_own', 'Read Own Alerts', 'View personal alert deliveries.', 'alert', 'read'),
  ('alerts.manage_own', 'Manage Own Alerts', 'Act on personal alert deliveries.', 'alert', 'manage'),
  ('job.create', 'Create Job', 'Create jobs in allowed scope.', 'job', 'write'),
  ('job.read', 'Read Job', 'Read jobs in allowed scope.', 'job', 'read'),
  ('job.update', 'Update Job', 'Update jobs in allowed scope.', 'job', 'write'),
  ('job.publish', 'Publish Job', 'Publish draft jobs in allowed scope.', 'job', 'write'),
  ('job.cancel', 'Cancel Job', 'Cancel jobs in allowed scope.', 'job', 'write'),
  ('job.archive', 'Archive Job', 'Archive jobs in allowed scope.', 'job', 'write'),
  ('job.duplicate', 'Duplicate Job', 'Duplicate jobs in allowed scope.', 'job', 'write'),
  ('jobday.create', 'Create Job Day', 'Create job days in allowed scope.', 'jobday', 'write'),
  ('jobday.update', 'Update Job Day', 'Update job days in allowed scope.', 'jobday', 'write'),
  ('jobday.cancel', 'Cancel Job Day', 'Cancel job days in allowed scope.', 'jobday', 'write'),
  ('jobday.mark_in_progress', 'Mark Job Day In Progress', 'Move job days into in-progress state.', 'jobday', 'write'),
  ('jobday.mark_complete', 'Mark Job Day Complete', 'Complete job days in allowed scope.', 'jobday', 'write'),
  ('job.assign_staff', 'Assign Staff', 'Assign or edit staffing in allowed scope.', 'job', 'manage_staff'),
  ('job.mark_ready', 'Mark Job Ready', 'Confirm job-day readiness.', 'job', 'manage_ready'),
  ('job.check_in_self', 'Check In Self', 'Check in on assigned work.', 'job', 'manage_ready'),
  ('job.check_in_others', 'Check In Others', 'Check in or mark presence for others.', 'job', 'manage_ready'),
  ('job.manage_readiness', 'Manage Readiness', 'Manage readiness items and blockers.', 'job', 'manage_ready'),
  ('organization.read', 'Read Organization', 'Read organizations in allowed scope.', 'organization', 'read'),
  ('organization.update', 'Update Organization', 'Update organizations in allowed scope.', 'organization', 'write'),
  ('organization.create', 'Create Organization', 'Create organizations.', 'organization', 'write'),
  ('contact.read', 'Read Contact', 'Read contacts in allowed scope.', 'contact', 'read'),
  ('contact.update', 'Update Contact', 'Update contacts in allowed scope.', 'contact', 'write'),
  ('contact.create', 'Create Contact', 'Create contacts.', 'contact', 'write'),
  ('location.read', 'Read Location', 'Read locations in allowed scope.', 'location', 'read'),
  ('location.update', 'Update Location', 'Update locations in allowed scope.', 'location', 'write'),
  ('location.create', 'Create Location', 'Create locations.', 'location', 'write'),
  ('production.read', 'Read Production', 'Read production queues and items in allowed scope.', 'production', 'read'),
  ('production.create', 'Create Production', 'Create production items.', 'production', 'write'),
  ('production.update', 'Update Production', 'Update production items.', 'production', 'write'),
  ('production.assign_owner', 'Assign Production Owner', 'Assign production owners.', 'production', 'manage'),
  ('production.mark_blocked', 'Mark Production Blocked', 'Block or unblock production items.', 'production', 'manage'),
  ('production.manage_handoffs', 'Manage Production Handoffs', 'Manage internal production handoffs.', 'production', 'manage'),
  ('approval.read', 'Read Approvals', 'Read approvals in allowed scope.', 'approval', 'read'),
  ('approval.manage', 'Manage Approvals', 'Manage approvals in allowed scope.', 'approval', 'manage'),
  ('qa.read', 'Read QA', 'Read QA reviews in allowed scope.', 'qa', 'read'),
  ('qa.manage', 'Manage QA', 'Manage QA reviews and findings.', 'qa', 'manage'),
  ('deliverable.read', 'Read Deliverables', 'Read deliverables in allowed scope.', 'deliverable', 'read'),
  ('deliverable.manage', 'Manage Deliverables', 'Manage deliverables in allowed scope.', 'deliverable', 'manage'),
  ('productionissue.manage', 'Manage Production Issues', 'Manage production issue records.', 'production_issue', 'manage'),
  ('finance.view_summary', 'View Finance Summary', 'View finance summary fields.', 'finance', 'read'),
  ('finance.view_costs', 'View Finance Costs', 'View restricted finance cost fields.', 'finance', 'read'),
  ('finance.view_margin', 'View Finance Margin', 'View restricted margin and profitability fields.', 'finance', 'read'),
  ('finance.edit', 'Edit Finance', 'Edit finance-sensitive fields.', 'finance', 'write'),
  ('report.read_department', 'Read Department Reports', 'Read department-scoped reports.', 'report', 'read'),
  ('report.read_global', 'Read Global Reports', 'Read global reports.', 'report', 'read'),
  ('report.export', 'Export Reports', 'Export report datasets in allowed scope.', 'report', 'export'),
  ('profitability.read', 'Read Profitability', 'Read profitability surfaces.', 'profitability', 'read'),
  ('settings.read', 'Read Settings', 'Read settings areas in allowed scope.', 'setting', 'read'),
  ('settings.update', 'Update Settings', 'Update settings areas in allowed scope.', 'setting', 'write'),
  ('settings.permissions.read', 'Read Access Settings', 'Read roles, policy rules, and access settings.', 'setting', 'read'),
  ('settings.permissions.manage', 'Manage Access Settings', 'Manage roles, grants, and access settings.', 'setting', 'manage'),
  ('settings.roles.manage', 'Manage Roles', 'Manage scoped role assignments.', 'setting', 'manage'),
  ('settings.delegations.manage', 'Manage Delegations', 'Create and revoke delegations.', 'setting', 'manage'),
  ('settings.field_policies.manage', 'Manage Field Policies', 'Manage field visibility rules.', 'setting', 'manage'),
  ('access_preview.use', 'Use Access Preview', 'Preview effective access decisions.', 'setting', 'read'),
  ('auditlog.read', 'Read Policy Audit Log', 'Read policy audit events.', 'audit', 'read'),
  ('import.jobs', 'Import Jobs', 'Import jobs in allowed scope.', 'import', 'write'),
  ('import.contacts', 'Import Contacts', 'Import contacts in allowed scope.', 'import', 'write'),
  ('export.jobs', 'Export Jobs', 'Export jobs in allowed scope.', 'export', 'export'),
  ('export.watchlist', 'Export Watchlist', 'Export watchlist data in allowed scope.', 'export', 'export'),
  ('export.production', 'Export Production', 'Export production data in allowed scope.', 'export', 'export'),
  ('export.reports', 'Export Reports', 'Export reports in allowed scope.', 'export', 'export')
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  resource_type = EXCLUDED.resource_type,
  action_group = EXCLUDED.action_group,
  updated_at = now();

WITH target_role AS (SELECT id FROM role WHERE code = 'admin')
INSERT INTO role_permission_grant (role_id, permission_id, scope_type, scope_value, effect)
SELECT target_role.id, permission.id, 'global'::policy_scope_type, NULL, 'allow'::policy_effect_type
FROM target_role
JOIN permission ON permission.code = ANY (ARRAY[
  'dashboard.read','dashboard.customize','executive.read','watchlist.read',
  'watchflag.acknowledge','watchflag.assign_owner','watchflag.snooze','watchflag.resolve','watchflag.dismiss','watchflag.escalate',
  'alerts.read_own','alerts.manage_own',
  'job.create','job.read','job.update','job.publish','job.cancel','job.archive','job.duplicate',
  'jobday.create','jobday.update','jobday.cancel','jobday.mark_in_progress','jobday.mark_complete',
  'job.assign_staff','job.mark_ready','job.check_in_self','job.check_in_others','job.manage_readiness',
  'organization.read','organization.update','organization.create',
  'contact.read','contact.update','contact.create',
  'location.read','location.update','location.create',
  'production.read','production.create','production.update','production.assign_owner','production.mark_blocked','production.manage_handoffs',
  'approval.read','approval.manage','qa.read','qa.manage','deliverable.read','deliverable.manage','productionissue.manage',
  'finance.view_summary','finance.view_costs','finance.view_margin','finance.edit',
  'report.read_department','report.read_global','report.export','profitability.read',
  'settings.read','settings.update','settings.permissions.read','settings.permissions.manage',
  'settings.roles.manage','settings.delegations.manage','settings.field_policies.manage',
  'access_preview.use','auditlog.read',
  'import.jobs','import.contacts','export.jobs','export.watchlist','export.production','export.reports'
])
ON CONFLICT DO NOTHING;

WITH target_role AS (SELECT id FROM role WHERE code = 'leadership')
INSERT INTO role_permission_grant (role_id, permission_id, scope_type, scope_value, effect)
SELECT target_role.id, permission.id, 'global'::policy_scope_type, NULL, 'allow'::policy_effect_type
FROM target_role
JOIN permission ON permission.code = ANY (ARRAY[
  'dashboard.read','dashboard.customize','executive.read','watchlist.read',
  'watchflag.acknowledge','watchflag.assign_owner','watchflag.snooze','watchflag.resolve','watchflag.dismiss','watchflag.escalate',
  'alerts.read_own','alerts.manage_own',
  'job.read','job.update','job.publish','job.cancel','job.archive',
  'jobday.create','jobday.update','jobday.cancel','jobday.mark_in_progress','jobday.mark_complete',
  'job.assign_staff','job.mark_ready','job.check_in_others','job.manage_readiness',
  'organization.read','organization.update','contact.read','contact.update','location.read','location.update',
  'production.read','production.update','production.assign_owner','production.manage_handoffs',
  'approval.read','approval.manage','qa.read','qa.manage','deliverable.read','deliverable.manage','productionissue.manage',
  'finance.view_summary','finance.view_costs','finance.view_margin',
  'report.read_department','report.read_global','report.export',
  'settings.read','settings.permissions.read','access_preview.use','auditlog.read'
])
ON CONFLICT DO NOTHING;

WITH seeded(role_code, scope_type, scope_value, permission_codes) AS (
  VALUES
    ('schools_manager', 'department', 'schools', ARRAY[
      'dashboard.read','watchlist.read','alerts.read_own','alerts.manage_own',
      'job.create','job.read','job.update','job.publish','job.cancel','job.archive',
      'jobday.create','jobday.update','jobday.cancel','jobday.mark_in_progress','jobday.mark_complete',
      'job.assign_staff','job.mark_ready','job.check_in_others','job.manage_readiness',
      'organization.read','organization.update','contact.read','contact.update','location.read','location.update',
      'production.read','production.update','approval.read','approval.manage','qa.read','qa.manage','deliverable.read','deliverable.manage',
      'finance.view_summary','report.read_department','import.jobs','export.jobs'
    ]::text[]),
    ('schools_coordinator', 'department', 'schools', ARRAY[
      'dashboard.read','watchlist.read','alerts.read_own',
      'job.create','job.read','job.update','job.publish',
      'jobday.create','jobday.update',
      'job.assign_staff','job.manage_readiness',
      'organization.read','contact.read','contact.update','location.read',
      'production.read','approval.read','report.read_department'
    ]::text[]),
    ('sports_manager', 'department', 'sports', ARRAY[
      'dashboard.read','watchlist.read','alerts.read_own','alerts.manage_own',
      'job.create','job.read','job.update','job.publish','job.cancel','job.archive',
      'jobday.create','jobday.update','jobday.cancel','jobday.mark_in_progress','jobday.mark_complete',
      'job.assign_staff','job.mark_ready','job.check_in_others','job.manage_readiness',
      'organization.read','organization.update','contact.read','contact.update','location.read','location.update',
      'production.read','production.update','production.assign_owner','approval.read','approval.manage',
      'qa.read','qa.manage','deliverable.read','deliverable.manage','productionissue.manage',
      'finance.view_summary','report.read_department','import.jobs','export.jobs'
    ]::text[]),
    ('sports_coordinator', 'department', 'sports', ARRAY[
      'dashboard.read','watchlist.read','alerts.read_own',
      'job.create','job.read','job.update','job.publish',
      'jobday.create','jobday.update',
      'job.assign_staff','job.manage_readiness',
      'organization.read','contact.read','contact.update','location.read',
      'production.read','approval.read','report.read_department'
    ]::text[]),
    ('department_observer', 'department', NULL, ARRAY[
      'dashboard.read','watchlist.read','job.read','organization.read','contact.read','location.read','production.read','approval.read','deliverable.read','report.read_department'
    ]::text[])
)
INSERT INTO role_permission_grant (role_id, permission_id, scope_type, scope_value, effect)
SELECT role.id, permission.id, seeded.scope_type::policy_scope_type, seeded.scope_value, 'allow'::policy_effect_type
FROM seeded
JOIN role ON role.code = seeded.role_code
JOIN permission ON permission.code = ANY (seeded.permission_codes)
ON CONFLICT DO NOTHING;

WITH seeded(role_code, scope_type, permission_codes) AS (
  VALUES
    ('photographer_lead', 'assigned', ARRAY['dashboard.read','alerts.read_own','alerts.manage_own','job.read','job.check_in_self','job.mark_ready','watchlist.read','watchflag.acknowledge']::text[]),
    ('photographer_staff', 'assigned', ARRAY['dashboard.read','alerts.read_own','job.read','job.check_in_self']::text[]),
    ('production_manager', 'global', ARRAY[
      'dashboard.read','watchlist.read','alerts.read_own','alerts.manage_own',
      'job.read',
      'production.read','production.create','production.update','production.assign_owner','production.mark_blocked','production.manage_handoffs',
      'approval.read','approval.manage','qa.read','qa.manage','deliverable.read','deliverable.manage','productionissue.manage',
      'watchflag.resolve','watchflag.escalate'
    ]::text[]),
    ('production_staff', 'assigned', ARRAY[
      'dashboard.read','alerts.read_own','production.read','production.update','approval.read','qa.read','qa.manage','deliverable.read','deliverable.manage'
    ]::text[]),
    ('customer_service', 'global', ARRAY[
      'dashboard.read','watchlist.read','alerts.read_own','alerts.manage_own',
      'job.read','organization.read','contact.read','location.read','deliverable.read','watchflag.resolve'
    ]::text[]),
    ('finance_readonly', 'global', ARRAY['dashboard.read','finance.view_summary','finance.view_costs','finance.view_margin','report.read_global']::text[]),
    ('finance_manager', 'global', ARRAY['dashboard.read','finance.view_summary','finance.view_costs','finance.view_margin','finance.edit','report.read_global']::text[])
)
INSERT INTO role_permission_grant (role_id, permission_id, scope_type, scope_value, effect)
SELECT role.id, permission.id, seeded.scope_type::policy_scope_type, NULL, 'allow'::policy_effect_type
FROM seeded
JOIN role ON role.code = seeded.role_code
JOIN permission ON permission.code = ANY (seeded.permission_codes)
ON CONFLICT DO NOTHING;

WITH defaults AS (
  SELECT
    u.tenant_id,
    u.id AS user_id,
    CASE
      WHEN uaa.authority_tier = 'super_admin' THEN 'admin'
      WHEN uaa.authority_tier = 'leadership' THEN 'leadership'
      WHEN uaa.primary_job_function_profile = 'director_of_school_photography' THEN 'schools_manager'
      WHEN uaa.primary_job_function_profile = 'schools_client_success' AND uaa.authority_tier IN ('supervisor', 'director_admin') THEN 'schools_manager'
      WHEN uaa.primary_job_function_profile = 'schools_client_success' THEN 'schools_coordinator'
      WHEN uaa.primary_job_function_profile = 'director_of_sports_photography' THEN 'sports_manager'
      WHEN uaa.primary_job_function_profile = 'sports_client_success' AND uaa.authority_tier IN ('supervisor', 'director_admin') THEN 'sports_manager'
      WHEN uaa.primary_job_function_profile = 'sports_client_success' THEN 'sports_coordinator'
      WHEN uaa.primary_job_function_profile = 'director_of_digital_production' THEN 'production_manager'
      WHEN uaa.primary_job_function_profile = 'graphic_artist' THEN 'production_staff'
      WHEN uaa.primary_job_function_profile = 'customer_service_rep' THEN 'customer_service'
      WHEN uaa.primary_job_function_profile IN ('senior_photographer', 'director_of_photography') THEN 'photographer_lead'
      WHEN uaa.primary_job_function_profile IN ('associate_photographer', 'seasonal_photographer', 'part_time_photographer') THEN 'photographer_staff'
      WHEN uaa.primary_job_function_profile = 'leadership_viewer' THEN 'department_observer'
      ELSE NULL
    END AS role_code,
    CASE
      WHEN uaa.authority_tier IN ('super_admin', 'leadership') THEN 'global'
      WHEN uaa.primary_job_function_profile = 'leadership_viewer' THEN 'department'
      WHEN uaa.primary_job_function_profile IN ('associate_photographer', 'seasonal_photographer', 'part_time_photographer', 'senior_photographer', 'director_of_photography') THEN 'assigned'
      WHEN u.department IN ('schools', 'sports') THEN 'department'
      ELSE 'global'
    END AS scope_type,
    CASE
      WHEN uaa.primary_job_function_profile = 'leadership_viewer' THEN u.department::text
      WHEN u.department IN ('schools', 'sports')
        AND uaa.primary_job_function_profile NOT IN ('associate_photographer', 'seasonal_photographer', 'part_time_photographer', 'senior_photographer', 'director_of_photography')
        THEN u.department::text
      ELSE NULL
    END AS scope_value
  FROM app_user u
  LEFT JOIN user_authority_assignment uaa
    ON uaa.tenant_id = u.tenant_id
   AND uaa.user_id = u.id
  WHERE u.status IN ('active', 'pending_approval', 'invited')
)
INSERT INTO user_role_assignment (tenant_id, user_id, role_id, scope_type, scope_value, starts_at, ends_at, assigned_by_user_id, reason)
SELECT
  defaults.tenant_id,
  defaults.user_id,
  role.id,
  defaults.scope_type::policy_scope_type,
  defaults.scope_value,
  now(),
  NULL,
  NULL,
  'Backfilled from authority assignment'
FROM defaults
JOIN role ON role.code = defaults.role_code
WHERE defaults.role_code IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM user_role_assignment assignment
    WHERE assignment.tenant_id = defaults.tenant_id
      AND assignment.user_id = defaults.user_id
      AND assignment.role_id = role.id
      AND assignment.scope_type = defaults.scope_type::policy_scope_type
      AND COALESCE(assignment.scope_value::text, '') = COALESCE(defaults.scope_value::text, '')
  );

INSERT INTO field_visibility_rule (resource_type, field_key, sensitivity_category, required_permission_code, default_visibility, masking_strategy, department_type)
VALUES
  ('shared_job', 'description_internal', 'operational_sensitive', 'job.read', 'readonly', 'none', NULL),
  ('shared_staff_assignment', 'notes', 'personnel_restricted', 'job.assign_staff', 'hidden', 'redacted_text', NULL),
  ('shared_watch_flag', 'description', 'operational_sensitive', 'watchlist.read', 'readonly', 'none', NULL),
  ('shared_production_item', 'blocked_reason', 'operational_sensitive', 'production.read', 'readonly', 'none', NULL),
  ('shared_approval_request', 'notes', 'operational_sensitive', 'approval.manage', 'hidden', 'redacted_text', NULL),
  ('shared_qa_review', 'notes', 'operational_sensitive', 'qa.manage', 'hidden', 'redacted_text', NULL),
  ('shared_deliverable_item', 'notes', 'operational_sensitive', 'deliverable.manage', 'hidden', 'redacted_text', NULL),
  ('shared_job', 'sports_profile.revenue_share_enabled', 'financial_restricted', 'finance.view_summary', 'hidden', 'none', 'sports'),
  ('shared_job', 'sports_profile.revenue_share_terms_summary', 'financial_restricted', 'finance.view_summary', 'hidden', 'money_summary_only', 'sports')
ON CONFLICT DO NOTHING;

INSERT INTO section_visibility_rule (resource_type, section_key, required_permission_code, sensitivity_category, default_visibility, department_type)
VALUES
  ('dashboard', 'executive_dashboard', 'executive.read', 'leadership_restricted', 'hidden', NULL),
  ('shared_job', 'financial', 'finance.view_summary', 'financial_restricted', 'hidden', NULL),
  ('settings', 'access', 'settings.permissions.read', 'system_admin_only', 'hidden', NULL),
  ('settings', 'roles', 'settings.permissions.read', 'system_admin_only', 'hidden', NULL),
  ('settings', 'delegations', 'settings.delegations.manage', 'system_admin_only', 'hidden', NULL),
  ('settings', 'field_policies', 'settings.field_policies.manage', 'system_admin_only', 'hidden', NULL),
  ('settings', 'section_policies', 'settings.field_policies.manage', 'system_admin_only', 'hidden', NULL),
  ('settings', 'overrides', 'settings.permissions.manage', 'system_admin_only', 'hidden', NULL),
  ('settings', 'policy_audit', 'auditlog.read', 'system_admin_only', 'hidden', NULL),
  ('settings', 'access_preview', 'access_preview.use', 'system_admin_only', 'hidden', NULL),
  ('profitability', 'workspace', 'profitability.read', 'financial_restricted', 'hidden', NULL)
ON CONFLICT DO NOTHING;
