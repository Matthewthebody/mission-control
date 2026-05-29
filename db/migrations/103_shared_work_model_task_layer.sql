DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_task_status_type') THEN
    CREATE TYPE work_task_status_type AS ENUM ('not_started', 'in_progress', 'waiting', 'blocked', 'review', 'completed', 'cancelled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_assignment_type') THEN
    CREATE TYPE work_assignment_type AS ENUM (
      'photographer',
      'assistant',
      'account_rep',
      'production_assignee',
      'lead',
      'backup',
      'driver',
      'editor',
      'qa_reviewer'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_assignment_status_type') THEN
    CREATE TYPE work_assignment_status_type AS ENUM ('assigned', 'confirmed', 'in_progress', 'completed', 'cancelled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS work_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  task_number text NOT NULL,
  title text NOT NULL,
  description text,
  task_type text NOT NULL DEFAULT 'general',
  department_type job_department_type NOT NULL,
  related_job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  assigned_to_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  assigned_team_id text,
  status work_task_status_type NOT NULL DEFAULT 'not_started',
  priority job_priority_level NOT NULL DEFAULT 'normal',
  due_at timestamptz,
  blocked_reason text,
  proof_required boolean NOT NULL DEFAULT false,
  completion_notes text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS work_task_tenant_task_number_idx
  ON work_task (tenant_id, task_number);

CREATE INDEX IF NOT EXISTS work_task_tenant_department_status_idx
  ON work_task (tenant_id, department_type, status, due_at, created_at DESC);

CREATE INDEX IF NOT EXISTS work_task_tenant_related_job_idx
  ON work_task (tenant_id, related_job_id, created_at DESC)
  WHERE related_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS work_task_tenant_assignee_idx
  ON work_task (tenant_id, assigned_to_user_id, status, due_at)
  WHERE assigned_to_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS work_task_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  work_task_id uuid NOT NULL REFERENCES work_task(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  related_job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  assignment_type work_assignment_type NOT NULL,
  role_on_job text,
  start_datetime timestamptz,
  end_datetime timestamptz,
  status work_assignment_status_type NOT NULL DEFAULT 'assigned',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_task_assignment_identity_unique UNIQUE (work_task_id, user_id, assignment_type)
);

CREATE INDEX IF NOT EXISTS work_task_assignment_tenant_task_idx
  ON work_task_assignment (tenant_id, work_task_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS work_task_assignment_tenant_user_idx
  ON work_task_assignment (tenant_id, user_id, status, created_at DESC);

INSERT INTO permission (code, name, description, resource_type, action_group)
VALUES
  ('task.create', 'Create Task', 'Create internal execution tasks in allowed scope.', 'task', 'write'),
  ('task.read', 'Read Task', 'Read internal execution tasks in allowed scope.', 'task', 'read'),
  ('task.update', 'Update Task', 'Update internal execution tasks in allowed scope.', 'task', 'write'),
  ('task.assign', 'Assign Task', 'Assign people to internal execution tasks in allowed scope.', 'task', 'manage')
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  resource_type = EXCLUDED.resource_type,
  action_group = EXCLUDED.action_group,
  updated_at = now();

WITH seeded(role_code, scope_type, scope_value, permission_codes) AS (
  VALUES
    ('admin', 'global', NULL, ARRAY['task.create','task.read','task.update','task.assign']::text[]),
    ('leadership', 'global', NULL, ARRAY['task.create','task.read','task.update','task.assign']::text[]),
    ('schools_manager', 'department', 'schools', ARRAY['task.create','task.read','task.update','task.assign']::text[]),
    ('schools_coordinator', 'department', 'schools', ARRAY['task.create','task.read','task.update']::text[]),
    ('sports_manager', 'department', 'sports', ARRAY['task.create','task.read','task.update','task.assign']::text[]),
    ('sports_coordinator', 'department', 'sports', ARRAY['task.create','task.read','task.update']::text[]),
    ('production_manager', 'global', NULL, ARRAY['task.create','task.read','task.update','task.assign']::text[]),
    ('production_staff', 'assigned', NULL, ARRAY['task.read','task.update']::text[]),
    ('photographer_lead', 'assigned', NULL, ARRAY['task.read','task.update']::text[]),
    ('photographer_staff', 'assigned', NULL, ARRAY['task.read']::text[])
)
INSERT INTO role_permission_grant (role_id, permission_id, scope_type, scope_value, effect)
SELECT role.id, permission.id, seeded.scope_type::policy_scope_type, seeded.scope_value, 'allow'::policy_effect_type
FROM seeded
JOIN role ON role.code = seeded.role_code
JOIN permission ON permission.code = ANY (seeded.permission_codes)
ON CONFLICT DO NOTHING;
