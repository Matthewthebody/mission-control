DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_project_status') THEN
    CREATE TYPE production_project_status AS ENUM (
      'new',
      'active',
      'blocked',
      'waiting',
      'completed',
      'canceled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_project_priority') THEN
    CREATE TYPE production_project_priority AS ENUM (
      'low',
      'normal',
      'high',
      'critical'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_project_source_type') THEN
    CREATE TYPE production_project_source_type AS ENUM ('manual', 'trigger');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_project_task_status') THEN
    CREATE TYPE production_project_task_status AS ENUM (
      'todo',
      'in_progress',
      'blocked',
      'done',
      'skipped'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS production_project_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_key text NOT NULL,
  name text NOT NULL,
  description text,
  default_priority production_project_priority NOT NULL DEFAULT 'normal',
  active_status boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, template_key)
);

CREATE TABLE IF NOT EXISTS production_project_template_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES production_project_template(id) ON DELETE CASCADE,
  task_key text NOT NULL,
  title text NOT NULL,
  summary text,
  due_offset_days integer NOT NULL DEFAULT 0,
  required boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, template_id, task_key)
);

CREATE TABLE IF NOT EXISTS production_project_trigger_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  trigger_key text NOT NULL,
  template_id uuid NOT NULL REFERENCES production_project_template(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  default_due_offset_days integer NOT NULL DEFAULT 0,
  default_follow_up_offset_days integer,
  active_status boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, trigger_key)
);

CREATE TABLE IF NOT EXISTS production_project (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_id uuid REFERENCES production_project_template(id) ON DELETE SET NULL,
  trigger_rule_id uuid REFERENCES production_project_trigger_rule(id) ON DELETE SET NULL,
  source_type production_project_source_type NOT NULL DEFAULT 'manual',
  source_event_key text,
  source_trigger_key text,
  source_trigger_label text,
  created_reason text NOT NULL,
  title text NOT NULL,
  summary text,
  status production_project_status NOT NULL DEFAULT 'new',
  priority production_project_priority NOT NULL DEFAULT 'normal',
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  due_date date,
  follow_up_date date,
  snoozed_until date,
  latest_note text,
  linked_organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  linked_location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  linked_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  completed_at timestamptz,
  completed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS production_project_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES production_project(id) ON DELETE CASCADE,
  template_task_id uuid REFERENCES production_project_template_task(id) ON DELETE SET NULL,
  title text NOT NULL,
  summary text,
  status production_project_task_status NOT NULL DEFAULT 'todo',
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  due_date date,
  required boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  completed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS production_project_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES production_project(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  summary text NOT NULL,
  note text,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS production_project_tenant_status_idx
  ON production_project (tenant_id, status, priority, due_date, created_at DESC);

CREATE INDEX IF NOT EXISTS production_project_tenant_owner_idx
  ON production_project (tenant_id, owner_user_id, status, due_date);

CREATE INDEX IF NOT EXISTS production_project_tenant_org_idx
  ON production_project (tenant_id, linked_organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS production_project_tenant_shoot_idx
  ON production_project (tenant_id, linked_shoot_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS production_project_task_project_idx
  ON production_project_task (tenant_id, project_id, status, due_date, sort_order);

CREATE INDEX IF NOT EXISTS production_project_event_project_idx
  ON production_project_event (tenant_id, project_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS production_project_source_event_key_idx
  ON production_project (tenant_id, source_event_key)
  WHERE source_event_key IS NOT NULL;

ALTER TABLE production_project_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_project_template_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_project_trigger_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_project ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_project_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_project_event ENABLE ROW LEVEL SECURITY;

ALTER TABLE production_project_template FORCE ROW LEVEL SECURITY;
ALTER TABLE production_project_template_task FORCE ROW LEVEL SECURITY;
ALTER TABLE production_project_trigger_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE production_project FORCE ROW LEVEL SECURITY;
ALTER TABLE production_project_task FORCE ROW LEVEL SECURITY;
ALTER TABLE production_project_event FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_production_project_template ON production_project_template
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_production_project_template_task ON production_project_template_task
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_production_project_trigger_rule ON production_project_trigger_rule
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_production_project ON production_project
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_production_project_task ON production_project_task
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_production_project_event ON production_project_event
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

INSERT INTO production_project_template (
  tenant_id,
  template_key,
  name,
  description,
  default_priority
)
SELECT
  tenant.id,
  seeded.template_key,
  seeded.name,
  seeded.description,
  seeded.default_priority::production_project_priority
FROM tenant
CROSS JOIN (
  VALUES
    ('manual_production_follow_up', 'Manual Production Follow-Up', 'Track a production follow-up manually without falling back to ad hoc notes.', 'normal'),
    ('post_shoot_production_wrap', 'Post-Shoot Production Wrap', 'Make sure production wrap work starts cleanly once a shoot moves into the post-shoot stage.', 'high'),
    ('post_shoot_issue_remediation', 'Post-Shoot Issue Remediation', 'Coordinate production remediation when a post-shoot evaluation flags quality or delivery issues.', 'critical'),
    ('resource_issue_follow_up', 'Resource Issue Follow-Up', 'Turn uploaded issue/reference evidence into a tracked production follow-up item.', 'high')
) AS seeded(template_key, name, description, default_priority)
WHERE NOT EXISTS (
  SELECT 1
  FROM production_project_template existing
  WHERE existing.tenant_id = tenant.id
    AND existing.template_key = seeded.template_key
);

INSERT INTO production_project_template_task (
  tenant_id,
  template_id,
  task_key,
  title,
  summary,
  due_offset_days,
  required,
  sort_order
)
SELECT
  template.tenant_id,
  template.id,
  seeded.task_key,
  seeded.title,
  seeded.summary,
  seeded.due_offset_days,
  seeded.required,
  seeded.sort_order
FROM production_project_template template
JOIN (
  VALUES
    ('manual_production_follow_up', 'scope', 'Define scope', 'Capture the production ask in plain language before work starts.', 0, true, 0),
    ('manual_production_follow_up', 'owner_due', 'Assign owner and due date', 'Make sure the project has a real owner and a due date.', 0, true, 1),
    ('manual_production_follow_up', 'close_loop', 'Close the loop', 'Record the final note or outcome before marking the project complete.', 1, true, 2),
    ('post_shoot_production_wrap', 'review_uploads', 'Review uploads and asset coverage', 'Confirm the production team has the expected upload set and reference context.', 0, true, 0),
    ('post_shoot_production_wrap', 'confirm_delivery', 'Confirm delivery or handoff path', 'Make sure production knows what happens next for selects, edits, or output delivery.', 1, true, 1),
    ('post_shoot_production_wrap', 'close_notes', 'Capture closeout notes', 'Document what production should remember before the project is closed.', 2, true, 2),
    ('post_shoot_issue_remediation', 'review_issue', 'Review the issue context', 'Inspect the evaluation notes, open comment, and linked shoot context.', 0, true, 0),
    ('post_shoot_issue_remediation', 'assign_recovery', 'Assign remediation owner', 'Make sure one production owner is responsible for the recovery path.', 0, true, 1),
    ('post_shoot_issue_remediation', 'confirm_resolution', 'Confirm resolution and follow-up', 'Capture the recovery outcome before closing the remediation project.', 1, true, 2),
    ('resource_issue_follow_up', 'inspect_upload', 'Inspect uploaded concern', 'Review the uploaded evidence and confirm whether it needs production action.', 0, true, 0),
    ('resource_issue_follow_up', 'route_response', 'Route the response', 'Assign ownership and set the production response path.', 1, true, 1),
    ('resource_issue_follow_up', 'close_with_note', 'Close with a note', 'Capture what happened so the next operator does not start blind.', 2, true, 2)
) AS seeded(template_key, task_key, title, summary, due_offset_days, required, sort_order)
  ON seeded.template_key = template.template_key
WHERE NOT EXISTS (
  SELECT 1
  FROM production_project_template_task existing
  WHERE existing.tenant_id = template.tenant_id
    AND existing.template_id = template.id
    AND existing.task_key = seeded.task_key
);

INSERT INTO production_project_trigger_rule (
  tenant_id,
  trigger_key,
  template_id,
  name,
  description,
  default_due_offset_days,
  default_follow_up_offset_days
)
SELECT
  template.tenant_id,
  seeded.trigger_key,
  template.id,
  seeded.name,
  seeded.description,
  seeded.default_due_offset_days,
  seeded.default_follow_up_offset_days
FROM production_project_template template
JOIN (
  VALUES
    ('post_shoot_production_wrap', 'shoot_completed_post_production', 'Shoot completed and needs production wrap', 'Create a production wrap project when a shoot moves into COMPLETE.', 2, 1),
    ('post_shoot_issue_remediation', 'post_shoot_issue_flagged', 'Post-shoot issue flagged', 'Create a remediation project when the post-shoot evaluation flags an issue.', 1, 0),
    ('resource_issue_follow_up', 'resource_issue_follow_up', 'Resource issue follow-up', 'Create a production follow-up when issue/reference media indicates operational production work.', 2, 1)
) AS seeded(template_key, trigger_key, name, description, default_due_offset_days, default_follow_up_offset_days)
  ON seeded.template_key = template.template_key
WHERE NOT EXISTS (
  SELECT 1
  FROM production_project_trigger_rule existing
  WHERE existing.tenant_id = template.tenant_id
    AND existing.trigger_key = seeded.trigger_key
);
