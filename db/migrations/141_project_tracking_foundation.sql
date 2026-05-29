-- migrate: no-transaction

ALTER TYPE shared_workflow_family_type ADD VALUE IF NOT EXISTS 'project_tracking';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_step_status_type') THEN
    CREATE TYPE workflow_step_status_type AS ENUM (
      'NOT_STARTED',
      'WAITING',
      'IN_PROGRESS',
      'BLOCKED',
      'COMPLETE',
      'SKIPPED',
      'OVERDUE'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_milestone_status_type') THEN
    CREATE TYPE workflow_milestone_status_type AS ENUM (
      'WAITING',
      'ACTIVE',
      'COMPLETE',
      'SKIPPED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_step_transition_type') THEN
    CREATE TYPE workflow_step_transition_type AS ENUM (
      'started',
      'completed',
      'blocked',
      'skipped',
      'reopened',
      'sent_back',
      'updated',
      'activated'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_handoff_status_type') THEN
    CREATE TYPE workflow_handoff_status_type AS ENUM (
      'pending',
      'acknowledged',
      'completed',
      'rejected'
    );
  END IF;
END $$;

ALTER TABLE workflow_template_version
  ADD COLUMN IF NOT EXISTS departments_involved work_department_type[] NOT NULL DEFAULT ARRAY[]::work_department_type[];

CREATE TABLE IF NOT EXISTS workflow_template_milestone (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_version_id uuid NOT NULL REFERENCES workflow_template_version(id) ON DELETE CASCADE,
  milestone_key text NOT NULL,
  name text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_template_milestone_identity_unique UNIQUE (template_version_id, milestone_key)
);

CREATE INDEX IF NOT EXISTS workflow_template_milestone_version_idx
  ON workflow_template_milestone (tenant_id, template_version_id, sort_order, created_at DESC);

CREATE TABLE IF NOT EXISTS workflow_template_step (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_version_id uuid NOT NULL REFERENCES workflow_template_version(id) ON DELETE CASCADE,
  template_milestone_id uuid NOT NULL REFERENCES workflow_template_milestone(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  name text NOT NULL,
  description text,
  department work_department_type NOT NULL,
  role_key text,
  assigned_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  required boolean NOT NULL DEFAULT true,
  skippable boolean NOT NULL DEFAULT false,
  blocking boolean NOT NULL DEFAULT true,
  expected_duration_minutes integer NOT NULL DEFAULT 1440,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_template_step_identity_unique UNIQUE (template_version_id, step_key),
  CONSTRAINT workflow_template_step_duration_check CHECK (expected_duration_minutes > 0)
);

CREATE INDEX IF NOT EXISTS workflow_template_step_version_idx
  ON workflow_template_step (tenant_id, template_version_id, template_milestone_id, sort_order, created_at DESC);

CREATE INDEX IF NOT EXISTS workflow_template_step_department_idx
  ON workflow_template_step (tenant_id, department, sort_order);

CREATE TABLE IF NOT EXISTS workflow_template_step_dependency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_version_id uuid NOT NULL REFERENCES workflow_template_version(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  depends_on_step_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_template_step_dependency_identity_unique UNIQUE (template_version_id, step_key, depends_on_step_key),
  CONSTRAINT workflow_template_step_dependency_not_self CHECK (step_key <> depends_on_step_key)
);

CREATE INDEX IF NOT EXISTS workflow_template_step_dependency_lookup_idx
  ON workflow_template_step_dependency (tenant_id, template_version_id, step_key, depends_on_step_key);

CREATE TABLE IF NOT EXISTS workflow_run_milestone (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  workflow_run_id uuid NOT NULL REFERENCES workflow_run(id) ON DELETE CASCADE,
  template_milestone_id uuid REFERENCES workflow_template_milestone(id) ON DELETE SET NULL,
  milestone_key text NOT NULL,
  name text NOT NULL,
  description text,
  status workflow_milestone_status_type NOT NULL DEFAULT 'WAITING',
  sort_order integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_run_milestone_identity_unique UNIQUE (workflow_run_id, milestone_key)
);

CREATE INDEX IF NOT EXISTS workflow_run_milestone_run_idx
  ON workflow_run_milestone (tenant_id, workflow_run_id, status, sort_order);

CREATE TABLE IF NOT EXISTS workflow_step (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  workflow_run_id uuid NOT NULL REFERENCES workflow_run(id) ON DELETE CASCADE,
  workflow_run_milestone_id uuid NOT NULL REFERENCES workflow_run_milestone(id) ON DELETE CASCADE,
  template_step_id uuid REFERENCES workflow_template_step(id) ON DELETE SET NULL,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  name text NOT NULL,
  description text,
  department work_department_type NOT NULL,
  role_key text,
  assigned_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  status workflow_step_status_type NOT NULL DEFAULT 'WAITING',
  required boolean NOT NULL DEFAULT true,
  skippable boolean NOT NULL DEFAULT false,
  blocking boolean NOT NULL DEFAULT true,
  expected_duration_minutes integer NOT NULL DEFAULT 1440,
  started_at timestamptz,
  completed_at timestamptz,
  completed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  notes text,
  exception_reason text,
  rework_count integer NOT NULL DEFAULT 0,
  last_transition_at timestamptz NOT NULL DEFAULT now(),
  last_transition_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  active_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_step_identity_unique UNIQUE (workflow_run_id, step_key),
  CONSTRAINT workflow_step_duration_check CHECK (expected_duration_minutes > 0)
);

CREATE INDEX IF NOT EXISTS workflow_step_run_idx
  ON workflow_step (tenant_id, workflow_run_id, status, sort_order, created_at DESC);

CREATE INDEX IF NOT EXISTS workflow_step_job_idx
  ON workflow_step (tenant_id, job_id, status, department, sort_order);

CREATE INDEX IF NOT EXISTS workflow_step_assignee_idx
  ON workflow_step (tenant_id, assigned_user_id, status, last_transition_at)
  WHERE assigned_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS workflow_step_department_idx
  ON workflow_step (tenant_id, department, status, last_transition_at);

CREATE TABLE IF NOT EXISTS workflow_step_dependency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  workflow_run_id uuid NOT NULL REFERENCES workflow_run(id) ON DELETE CASCADE,
  workflow_step_id uuid NOT NULL REFERENCES workflow_step(id) ON DELETE CASCADE,
  depends_on_workflow_step_id uuid NOT NULL REFERENCES workflow_step(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_step_dependency_identity_unique UNIQUE (workflow_run_id, workflow_step_id, depends_on_workflow_step_id),
  CONSTRAINT workflow_step_dependency_not_self CHECK (workflow_step_id <> depends_on_workflow_step_id)
);

CREATE INDEX IF NOT EXISTS workflow_step_dependency_lookup_idx
  ON workflow_step_dependency (tenant_id, workflow_run_id, workflow_step_id, depends_on_workflow_step_id);

CREATE TABLE IF NOT EXISTS workflow_handoff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  workflow_run_id uuid NOT NULL REFERENCES workflow_run(id) ON DELETE CASCADE,
  from_step_id uuid REFERENCES workflow_step(id) ON DELETE SET NULL,
  to_step_id uuid NOT NULL REFERENCES workflow_step(id) ON DELETE CASCADE,
  from_department work_department_type,
  to_department work_department_type NOT NULL,
  from_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  to_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  status workflow_handoff_status_type NOT NULL DEFAULT 'pending',
  reason text,
  expectations text,
  sla_started_at timestamptz,
  acknowledged_at timestamptz,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_handoff_run_idx
  ON workflow_handoff (tenant_id, workflow_run_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS workflow_handoff_to_step_idx
  ON workflow_handoff (tenant_id, to_step_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS workflow_step_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  workflow_run_id uuid NOT NULL REFERENCES workflow_run(id) ON DELETE CASCADE,
  workflow_step_id uuid NOT NULL REFERENCES workflow_step(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  transition_type workflow_step_transition_type NOT NULL,
  previous_status workflow_step_status_type,
  new_status workflow_step_status_type NOT NULL,
  previous_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  conflict_detected boolean NOT NULL DEFAULT false,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_step_audit_log_step_idx
  ON workflow_step_audit_log (tenant_id, workflow_step_id, created_at DESC);

CREATE INDEX IF NOT EXISTS workflow_step_audit_log_run_idx
  ON workflow_step_audit_log (tenant_id, workflow_run_id, created_at DESC);

ALTER TABLE work_task
  ADD COLUMN IF NOT EXISTS linked_step_id uuid REFERENCES workflow_step(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS work_task_linked_step_idx
  ON work_task (tenant_id, linked_step_id, status, due_at)
  WHERE linked_step_id IS NOT NULL;

ALTER TABLE workflow_template_milestone ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_template_step ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_template_step_dependency ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_run_milestone ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_step ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_step_dependency ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_handoff ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_step_audit_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE workflow_template_milestone FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_template_step FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_template_step_dependency FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_run_milestone FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_step FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_step_dependency FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_handoff FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_step_audit_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_workflow_template_milestone ON workflow_template_milestone;
CREATE POLICY tenant_isolation_workflow_template_milestone ON workflow_template_milestone
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_workflow_template_step ON workflow_template_step;
CREATE POLICY tenant_isolation_workflow_template_step ON workflow_template_step
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_workflow_template_step_dependency ON workflow_template_step_dependency;
CREATE POLICY tenant_isolation_workflow_template_step_dependency ON workflow_template_step_dependency
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_workflow_run_milestone ON workflow_run_milestone;
CREATE POLICY tenant_isolation_workflow_run_milestone ON workflow_run_milestone
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_workflow_step ON workflow_step;
CREATE POLICY tenant_isolation_workflow_step ON workflow_step
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_workflow_step_dependency ON workflow_step_dependency;
CREATE POLICY tenant_isolation_workflow_step_dependency ON workflow_step_dependency
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_workflow_handoff ON workflow_handoff;
CREATE POLICY tenant_isolation_workflow_handoff ON workflow_handoff
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_workflow_step_audit_log ON workflow_step_audit_log;
CREATE POLICY tenant_isolation_workflow_step_audit_log ON workflow_step_audit_log
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

INSERT INTO permission (code, name, description, resource_type, action_group)
VALUES
  ('workflow.read', 'Read Workflow', 'Read workflow templates, instances, milestones, steps, handoffs, and command-center projections.', 'workflow', 'read'),
  ('workflow.template.manage', 'Manage Workflow Templates', 'Create versioned workflow templates and step structures.', 'workflow', 'manage'),
  ('workflow.instance.manage', 'Manage Workflow Instances', 'Start and administer workflow instances for jobs.', 'workflow', 'manage'),
  ('workflow.step.execute', 'Execute Workflow Steps', 'Start, complete, block, and annotate assigned workflow steps.', 'workflow_step', 'write'),
  ('workflow.step.override', 'Override Workflow Steps', 'Perform explained workflow overrides such as skip, reopen, and send-back.', 'workflow_step', 'manage')
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  resource_type = EXCLUDED.resource_type,
  action_group = EXCLUDED.action_group,
  updated_at = now();

WITH seeded(role_code, scope_type, scope_value, permission_codes) AS (
  VALUES
    ('admin', 'global', NULL, ARRAY['workflow.read','workflow.template.manage','workflow.instance.manage','workflow.step.execute','workflow.step.override']::text[]),
    ('leadership', 'global', NULL, ARRAY['workflow.read','workflow.template.manage','workflow.instance.manage','workflow.step.execute','workflow.step.override']::text[]),
    ('schools_manager', 'department', 'schools', ARRAY['workflow.read','workflow.instance.manage','workflow.step.execute','workflow.step.override']::text[]),
    ('sports_manager', 'department', 'sports', ARRAY['workflow.read','workflow.instance.manage','workflow.step.execute','workflow.step.override']::text[]),
    ('production_manager', 'department', 'production', ARRAY['workflow.read','workflow.instance.manage','workflow.step.execute','workflow.step.override']::text[]),
    ('schools_coordinator', 'department', 'schools', ARRAY['workflow.read','workflow.step.execute']::text[]),
    ('sports_coordinator', 'department', 'sports', ARRAY['workflow.read','workflow.step.execute']::text[]),
    ('production_staff', 'department', 'production', ARRAY['workflow.read','workflow.step.execute']::text[]),
    ('photographer_lead', 'department', 'photography', ARRAY['workflow.read','workflow.step.execute','workflow.step.override']::text[]),
    ('photographer_staff', 'department', 'photography', ARRAY['workflow.read','workflow.step.execute']::text[])
)
INSERT INTO role_permission_grant (role_id, permission_id, scope_type, scope_value, effect)
SELECT role.id, permission.id, seeded.scope_type::policy_scope_type, seeded.scope_value, 'allow'::policy_effect_type
FROM seeded
JOIN role ON role.code = seeded.role_code
JOIN permission ON permission.code = ANY (seeded.permission_codes)
ON CONFLICT DO NOTHING;
