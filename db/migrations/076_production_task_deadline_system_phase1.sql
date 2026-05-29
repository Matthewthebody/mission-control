DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_project_task_type') THEN
    CREATE TYPE production_project_task_type AS ENUM (
      'production',
      'peer_review',
      'final_qc',
      'release',
      'handoff',
      'rework'
    );
  END IF;
END $$;

ALTER TABLE production_project_template_task
  ADD COLUMN IF NOT EXISTS task_type production_project_task_type NOT NULL DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS handoff_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocks_release boolean NOT NULL DEFAULT false;

ALTER TABLE production_project_task
  ADD COLUMN IF NOT EXISTS task_type production_project_task_type NOT NULL DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS handoff_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocks_release boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_handoff_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_handoff_to_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS production_project_template_task_dependency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES production_project_template(id) ON DELETE CASCADE,
  task_template_id uuid NOT NULL REFERENCES production_project_template_task(id) ON DELETE CASCADE,
  depends_on_template_task_id uuid NOT NULL REFERENCES production_project_template_task(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, task_template_id, depends_on_template_task_id)
);

CREATE TABLE IF NOT EXISTS production_project_task_dependency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES production_project(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES production_project_task(id) ON DELETE CASCADE,
  depends_on_task_id uuid NOT NULL REFERENCES production_project_task(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, task_id, depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS production_project_task_handoff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES production_project(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES production_project_task(id) ON DELETE CASCADE,
  from_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  to_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  note text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS production_project_task_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES production_project(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES production_project_task(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  summary text NOT NULL,
  note text,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS production_project_template_task_dependency_idx
  ON production_project_template_task_dependency (tenant_id, template_id, task_template_id);

CREATE INDEX IF NOT EXISTS production_project_task_dependency_idx
  ON production_project_task_dependency (tenant_id, project_id, task_id);

CREATE INDEX IF NOT EXISTS production_project_task_handoff_idx
  ON production_project_task_handoff (tenant_id, project_id, task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS production_project_task_event_idx
  ON production_project_task_event (tenant_id, project_id, task_id, created_at DESC);

UPDATE production_project_template_task
SET
  task_type = CASE
    WHEN task_key IN ('peer_review', 'peer_review_issue', 'peer_review_pass') THEN 'peer_review'::production_project_task_type
    WHEN task_key IN ('final_qc', 'final_qc_issue', 'final_qc_signoff') THEN 'final_qc'::production_project_task_type
    WHEN task_key IN ('release_assets') THEN 'release'::production_project_task_type
    WHEN task_key IN ('assign_recovery', 'route_response', 'confirm_delivery') THEN 'handoff'::production_project_task_type
    WHEN task_key IN ('confirm_resolution', 'review_issue') THEN 'rework'::production_project_task_type
    ELSE 'production'::production_project_task_type
  END,
  handoff_required = CASE
    WHEN task_key IN ('peer_review', 'peer_review_issue', 'peer_review_pass', 'final_qc', 'final_qc_issue', 'final_qc_signoff', 'confirm_delivery', 'route_response', 'assign_recovery', 'release_assets') THEN true
    ELSE handoff_required
  END,
  blocks_release = CASE
    WHEN task_key IN ('peer_review', 'peer_review_issue', 'peer_review_pass', 'final_qc', 'final_qc_issue', 'final_qc_signoff') THEN true
    ELSE blocks_release
  END
WHERE tenant_id IS NOT NULL;

INSERT INTO production_project_template_task_dependency (
  tenant_id,
  template_id,
  task_template_id,
  depends_on_template_task_id
)
SELECT
  dep.tenant_id,
  dep.template_id,
  dep.task_template_id,
  dep.depends_on_template_task_id
FROM (
  SELECT
    child.tenant_id,
    child.template_id,
    child.id AS task_template_id,
    parent.id AS depends_on_template_task_id
  FROM production_project_template_task child
  JOIN production_project_template_task parent
    ON parent.tenant_id = child.tenant_id
   AND parent.template_id = child.template_id
  JOIN production_project_template template
    ON template.tenant_id = child.tenant_id
   AND template.id = child.template_id
  WHERE (template.template_key = 'manual_production_follow_up' AND child.task_key = 'owner_due' AND parent.task_key = 'scope')
     OR (template.template_key = 'manual_production_follow_up' AND child.task_key = 'close_loop' AND parent.task_key = 'owner_due')
     OR (template.template_key = 'post_shoot_production_wrap' AND child.task_key = 'confirm_delivery' AND parent.task_key = 'review_uploads')
     OR (template.template_key = 'post_shoot_production_wrap' AND child.task_key = 'prepare_delivery' AND parent.task_key = 'confirm_delivery')
     OR (template.template_key = 'post_shoot_production_wrap' AND child.task_key = 'peer_review' AND parent.task_key = 'prepare_delivery')
     OR (template.template_key = 'post_shoot_production_wrap' AND child.task_key = 'final_qc' AND parent.task_key = 'peer_review')
     OR (template.template_key = 'post_shoot_production_wrap' AND child.task_key = 'close_notes' AND parent.task_key = 'final_qc')
     OR (template.template_key = 'post_shoot_issue_remediation' AND child.task_key = 'assign_recovery' AND parent.task_key = 'review_issue')
     OR (template.template_key = 'post_shoot_issue_remediation' AND child.task_key = 'confirm_resolution' AND parent.task_key = 'assign_recovery')
     OR (template.template_key = 'resource_issue_follow_up' AND child.task_key = 'route_response' AND parent.task_key = 'inspect_upload')
     OR (template.template_key = 'resource_issue_follow_up' AND child.task_key = 'peer_review_issue' AND parent.task_key = 'route_response')
     OR (template.template_key = 'resource_issue_follow_up' AND child.task_key = 'final_qc_issue' AND parent.task_key = 'peer_review_issue')
     OR (template.template_key = 'resource_issue_follow_up' AND child.task_key = 'close_with_note' AND parent.task_key = 'final_qc_issue')
     OR (template.template_key = 'digital_production_delivery' AND child.task_key = 'build_package' AND parent.task_key = 'confirm_scope')
     OR (template.template_key = 'digital_production_delivery' AND child.task_key = 'peer_review_pass' AND parent.task_key = 'build_package')
     OR (template.template_key = 'digital_production_delivery' AND child.task_key = 'final_qc_signoff' AND parent.task_key = 'peer_review_pass')
     OR (template.template_key = 'digital_production_delivery' AND child.task_key = 'release_assets' AND parent.task_key = 'final_qc_signoff')
) dep
WHERE NOT EXISTS (
  SELECT 1
  FROM production_project_template_task_dependency existing
  WHERE existing.tenant_id = dep.tenant_id
    AND existing.task_template_id = dep.task_template_id
    AND existing.depends_on_template_task_id = dep.depends_on_template_task_id
);

UPDATE production_project_task task
SET
  task_type = template_task.task_type,
  handoff_required = template_task.handoff_required,
  blocks_release = template_task.blocks_release
FROM production_project_template_task template_task
WHERE template_task.tenant_id = task.tenant_id
  AND template_task.id = task.template_task_id;

INSERT INTO production_project_task_dependency (
  tenant_id,
  project_id,
  task_id,
  depends_on_task_id
)
SELECT
  child.tenant_id,
  child.project_id,
  child.id AS task_id,
  parent.id AS depends_on_task_id
FROM production_project_task child
JOIN production_project_task parent
  ON parent.tenant_id = child.tenant_id
 AND parent.project_id = child.project_id
JOIN production_project_template_task_dependency template_dependency
  ON template_dependency.tenant_id = child.tenant_id
 AND template_dependency.task_template_id = child.template_task_id
 AND template_dependency.depends_on_template_task_id = parent.template_task_id
WHERE NOT EXISTS (
  SELECT 1
  FROM production_project_task_dependency existing
  WHERE existing.tenant_id = child.tenant_id
    AND existing.task_id = child.id
    AND existing.depends_on_task_id = parent.id
);

ALTER TABLE production_project_template_task_dependency ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_project_task_dependency ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_project_task_handoff ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_project_task_event ENABLE ROW LEVEL SECURITY;

ALTER TABLE production_project_template_task_dependency FORCE ROW LEVEL SECURITY;
ALTER TABLE production_project_task_dependency FORCE ROW LEVEL SECURITY;
ALTER TABLE production_project_task_handoff FORCE ROW LEVEL SECURITY;
ALTER TABLE production_project_task_event FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_production_project_template_task_dependency ON production_project_template_task_dependency
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_production_project_task_dependency ON production_project_task_dependency
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_production_project_task_handoff ON production_project_task_handoff
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_production_project_task_event ON production_project_task_event
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
