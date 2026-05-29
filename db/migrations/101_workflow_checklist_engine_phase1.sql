DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'checklist_scope_type') THEN
    CREATE TYPE checklist_scope_type AS ENUM ('shoot', 'production_item', 'job', 'location');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'checklist_trigger_type') THEN
    CREATE TYPE checklist_trigger_type AS ENUM (
      'manual',
      'shoot_status_transition',
      'production_status_transition',
      'job_publish',
      'shoot_complete',
      'upload_verified',
      'release_review'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'checklist_blocking_level_type') THEN
    CREATE TYPE checklist_blocking_level_type AS ENUM ('none', 'soft_block', 'hard_block');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'checklist_item_type') THEN
    CREATE TYPE checklist_item_type AS ENUM (
      'checkbox',
      'text',
      'textarea',
      'number',
      'date',
      'time',
      'select',
      'multi_select',
      'yes_no',
      'user_picker',
      'photo_upload',
      'file_upload',
      'signature'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'checklist_condition_effect_type') THEN
    CREATE TYPE checklist_condition_effect_type AS ENUM ('show', 'hide', 'require', 'disable');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'checklist_condition_logic_type') THEN
    CREATE TYPE checklist_condition_logic_type AS ENUM ('AND', 'OR');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'checklist_instance_status_type') THEN
    CREATE TYPE checklist_instance_status_type AS ENUM (
      'not_started',
      'in_progress',
      'submitted',
      'approved',
      'rejected',
      'overdue',
      'waived'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'checklist_template_version_status_type') THEN
    CREATE TYPE checklist_template_version_status_type AS ENUM ('draft', 'published', 'archived');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'checklist_approval_decision_type') THEN
    CREATE TYPE checklist_approval_decision_type AS ENUM ('submitted', 'approved', 'rejected', 'waived');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'checklist_reminder_type') THEN
    CREATE TYPE checklist_reminder_type AS ENUM ('before_due', 'at_due', 'overdue', 'escalation');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_block_resource_type') THEN
    CREATE TYPE workflow_block_resource_type AS ENUM ('shoot', 'production_item');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'checklist_comment_visibility_type') THEN
    CREATE TYPE checklist_comment_visibility_type AS ENUM ('standard_internal', 'manager_only', 'leadership_only');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  department_type job_department_type,
  scope_type checklist_scope_type NOT NULL,
  active_version_id uuid,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS checklist_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  status checklist_template_version_status_type NOT NULL DEFAULT 'draft',
  trigger_type checklist_trigger_type NOT NULL DEFAULT 'manual',
  due_rule_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_required boolean NOT NULL DEFAULT false,
  blocking_level checklist_blocking_level_type NOT NULL DEFAULT 'none',
  summary text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  published_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version_number)
);

ALTER TABLE checklist_templates
  DROP CONSTRAINT IF EXISTS checklist_templates_active_version_fk;

ALTER TABLE checklist_templates
  ADD CONSTRAINT checklist_templates_active_version_fk
  FOREIGN KEY (active_version_id) REFERENCES checklist_template_versions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS checklist_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_version_id uuid NOT NULL REFERENCES checklist_template_versions(id) ON DELETE CASCADE,
  section_key text NOT NULL,
  title text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_version_id, section_key)
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_version_id uuid NOT NULL REFERENCES checklist_template_versions(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES checklist_sections(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  label text NOT NULL,
  help_text text,
  item_type checklist_item_type NOT NULL,
  required boolean NOT NULL DEFAULT false,
  proof_required boolean NOT NULL DEFAULT false,
  validation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  options_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_version_id, item_key)
);

CREATE TABLE IF NOT EXISTS checklist_item_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_version_id uuid NOT NULL REFERENCES checklist_template_versions(id) ON DELETE CASCADE,
  checklist_item_id uuid NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  condition_group_key text NOT NULL DEFAULT 'default',
  logic_operator checklist_condition_logic_type NOT NULL DEFAULT 'AND',
  source_item_key text NOT NULL,
  comparison_operator text NOT NULL DEFAULT 'equals',
  expected_value_json jsonb NOT NULL DEFAULT 'null'::jsonb,
  effect checklist_condition_effect_type NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checklist_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES checklist_templates(id) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL REFERENCES checklist_template_versions(id) ON DELETE RESTRICT,
  scope_type checklist_scope_type NOT NULL,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  shoot_id uuid REFERENCES shoot(id) ON DELETE CASCADE,
  production_item_id uuid REFERENCES production_items(id) ON DELETE CASCADE,
  location_id uuid REFERENCES shoot_location(id) ON DELETE CASCADE,
  department_type job_department_type,
  title text NOT NULL,
  trigger_type checklist_trigger_type NOT NULL DEFAULT 'manual',
  status checklist_instance_status_type NOT NULL DEFAULT 'not_started',
  approval_required boolean NOT NULL DEFAULT false,
  blocking_level checklist_blocking_level_type NOT NULL DEFAULT 'none',
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reviewer_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  approver_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  due_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  waived_at timestamptz,
  rejection_note text,
  waiver_note text,
  progress_percent integer NOT NULL DEFAULT 0,
  created_from_trigger_key text,
  source_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_reminded_at timestamptz,
  escalated_at timestamptz,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (progress_percent >= 0 AND progress_percent <= 100),
  CHECK (
    (CASE WHEN job_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN shoot_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN production_item_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN location_id IS NULL THEN 0 ELSE 1 END) = 1
  ),
  CHECK (
    (scope_type = 'job' AND job_id IS NOT NULL) OR
    (scope_type = 'shoot' AND shoot_id IS NOT NULL) OR
    (scope_type = 'production_item' AND production_item_id IS NOT NULL) OR
    (scope_type = 'location' AND location_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS checklist_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  checklist_instance_id uuid NOT NULL REFERENCES checklist_instances(id) ON DELETE CASCADE,
  checklist_item_id uuid NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  checklist_section_id uuid NOT NULL REFERENCES checklist_sections(id) ON DELETE CASCADE,
  response_json jsonb NOT NULL DEFAULT 'null'::jsonb,
  is_complete boolean NOT NULL DEFAULT false,
  answered_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (checklist_instance_id, checklist_item_id)
);

CREATE TABLE IF NOT EXISTS checklist_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  checklist_instance_id uuid NOT NULL REFERENCES checklist_instances(id) ON DELETE CASCADE,
  checklist_response_id uuid REFERENCES checklist_responses(id) ON DELETE CASCADE,
  attachment_type text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  storage_key text NOT NULL,
  object_url text NOT NULL,
  uploaded_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checklist_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  checklist_instance_id uuid NOT NULL REFERENCES checklist_instances(id) ON DELETE CASCADE,
  checklist_response_id uuid REFERENCES checklist_responses(id) ON DELETE CASCADE,
  checklist_item_id uuid REFERENCES checklist_items(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  body text NOT NULL,
  visibility checklist_comment_visibility_type NOT NULL DEFAULT 'standard_internal',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checklist_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  checklist_instance_id uuid NOT NULL REFERENCES checklist_instances(id) ON DELETE CASCADE,
  decision checklist_approval_decision_type NOT NULL,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  note text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_block_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name text NOT NULL,
  department_type job_department_type,
  resource_type workflow_block_resource_type NOT NULL,
  from_stage text,
  to_stage text NOT NULL,
  required_template_code text NOT NULL,
  required_instance_status checklist_instance_status_type NOT NULL DEFAULT 'submitted',
  approval_required boolean NOT NULL DEFAULT false,
  blocking_level checklist_blocking_level_type NOT NULL DEFAULT 'hard_block',
  allow_override boolean NOT NULL DEFAULT false,
  active_status boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checklist_reminder_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_id uuid REFERENCES checklist_templates(id) ON DELETE CASCADE,
  template_version_id uuid REFERENCES checklist_template_versions(id) ON DELETE CASCADE,
  department_type job_department_type,
  scope_type checklist_scope_type,
  reminder_type checklist_reminder_type NOT NULL,
  offset_minutes integer NOT NULL DEFAULT 0,
  delivery_channel alert_delivery_channel_type NOT NULL DEFAULT 'in_app',
  escalation_role text,
  active_status boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checklist_templates_tenant_scope_idx
  ON checklist_templates (tenant_id, scope_type, department_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS checklist_template_versions_template_status_idx
  ON checklist_template_versions (tenant_id, template_id, status, version_number DESC);

CREATE INDEX IF NOT EXISTS checklist_sections_version_sort_idx
  ON checklist_sections (tenant_id, template_version_id, sort_order, created_at);

CREATE INDEX IF NOT EXISTS checklist_items_version_section_sort_idx
  ON checklist_items (tenant_id, template_version_id, section_id, sort_order, created_at);

CREATE INDEX IF NOT EXISTS checklist_item_conditions_item_idx
  ON checklist_item_conditions (tenant_id, checklist_item_id, condition_group_key, sort_order, created_at);

CREATE INDEX IF NOT EXISTS checklist_instances_scope_status_idx
  ON checklist_instances (tenant_id, scope_type, status, due_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS checklist_instances_job_idx
  ON checklist_instances (tenant_id, job_id, status, due_at, updated_at DESC)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS checklist_instances_shoot_idx
  ON checklist_instances (tenant_id, shoot_id, status, due_at, updated_at DESC)
  WHERE shoot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS checklist_instances_production_idx
  ON checklist_instances (tenant_id, production_item_id, status, due_at, updated_at DESC)
  WHERE production_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS checklist_responses_instance_idx
  ON checklist_responses (tenant_id, checklist_instance_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS checklist_attachments_instance_idx
  ON checklist_attachments (tenant_id, checklist_instance_id, created_at DESC);

CREATE INDEX IF NOT EXISTS checklist_comments_instance_idx
  ON checklist_comments (tenant_id, checklist_instance_id, created_at DESC);

CREATE INDEX IF NOT EXISTS checklist_approvals_instance_idx
  ON checklist_approvals (tenant_id, checklist_instance_id, created_at DESC);

CREATE INDEX IF NOT EXISTS workflow_block_rules_lookup_idx
  ON workflow_block_rules (tenant_id, resource_type, department_type, to_stage, active_status);

CREATE INDEX IF NOT EXISTS checklist_reminder_rules_lookup_idx
  ON checklist_reminder_rules (tenant_id, template_id, template_version_id, department_type, scope_type, reminder_type, active_status);

DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'checklist_templates',
    'checklist_template_versions',
    'checklist_sections',
    'checklist_items',
    'checklist_item_conditions',
    'checklist_instances',
    'checklist_responses',
    'checklist_attachments',
    'checklist_comments',
    'checklist_approvals',
    'workflow_block_rules',
    'checklist_reminder_rules'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    policy_name := 'tenant_isolation_' || table_name;
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      policy_name,
      table_name
    );
  END LOOP;
END $$;

INSERT INTO permission (code, name, description, resource_type, action_group)
VALUES
  ('checklist.template.read', 'Checklist Template Read', 'Read workflow checklist templates and versions.', 'workflow_checklist', 'read'),
  ('checklist.template.manage', 'Checklist Template Manage', 'Create, edit, and publish workflow checklist templates.', 'workflow_checklist', 'manage'),
  ('checklist.approve', 'Checklist Approve', 'Approve or reject submitted workflow checklist instances.', 'workflow_checklist', 'approve'),
  ('checklist.waive', 'Checklist Waive', 'Waive workflow checklist instances with an audit reason.', 'workflow_checklist', 'manage'),
  ('checklist.override.soft_block', 'Checklist Soft Block Override', 'Override soft checklist workflow blocks with a reason.', 'workflow_checklist', 'manage')
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  resource_type = EXCLUDED.resource_type,
  action_group = EXCLUDED.action_group,
  updated_at = now();

INSERT INTO role_permission_grant (role_id, permission_id, scope_type, scope_value, effect)
SELECT role.id, permission.id, 'global'::policy_scope_type, NULL, 'allow'::policy_effect_type
FROM role
JOIN permission ON permission.code = ANY (
  CASE role.code
    WHEN 'admin' THEN ARRAY['checklist.template.read','checklist.template.manage','checklist.approve','checklist.waive','checklist.override.soft_block']::text[]
    WHEN 'leadership' THEN ARRAY['checklist.template.read','checklist.template.manage','checklist.approve','checklist.waive','checklist.override.soft_block']::text[]
    WHEN 'schools_manager' THEN ARRAY['checklist.template.read','checklist.approve','checklist.waive','checklist.override.soft_block']::text[]
    WHEN 'sports_manager' THEN ARRAY['checklist.template.read','checklist.approve','checklist.waive','checklist.override.soft_block']::text[]
    WHEN 'production_manager' THEN ARRAY['checklist.template.read','checklist.approve','checklist.override.soft_block']::text[]
    ELSE ARRAY[]::text[]
  END
)
WHERE role.code IN ('admin', 'leadership', 'schools_manager', 'sports_manager', 'production_manager')
ON CONFLICT DO NOTHING;
