DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shared_workflow_family_type') THEN
    CREATE TYPE shared_workflow_family_type AS ENUM ('schools', 'sports', 'graphics_handoff');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shared_workflow_template_version_status_type') THEN
    CREATE TYPE shared_workflow_template_version_status_type AS ENUM ('draft', 'active', 'retired');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shared_workflow_run_status_type') THEN
    CREATE TYPE shared_workflow_run_status_type AS ENUM ('draft', 'active', 'completed', 'cancelled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shared_workflow_ack_status_type') THEN
    CREATE TYPE shared_workflow_ack_status_type AS ENUM ('pending', 'acknowledged', 'dismissed');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shared_workflow_approval_checkpoint_status_type') THEN
    CREATE TYPE shared_workflow_approval_checkpoint_status_type AS ENUM ('queued', 'pending', 'approved', 'rejected', 'canceled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shared_workflow_date_anchor_type') THEN
    CREATE TYPE shared_workflow_date_anchor_type AS ENUM (
      'job_scheduled_start',
      'job_scheduled_end',
      'job_client_deadline',
      'job_production_deadline',
      'event_start',
      'event_end'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS workflow_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_key text NOT NULL,
  name text NOT NULL,
  description text,
  workflow_family shared_workflow_family_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_template_identity_unique UNIQUE (tenant_id, template_key)
);

CREATE INDEX IF NOT EXISTS workflow_template_tenant_family_idx
  ON workflow_template (tenant_id, workflow_family, created_at DESC);

CREATE TABLE IF NOT EXISTS workflow_template_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES workflow_template(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  status shared_workflow_template_version_status_type NOT NULL DEFAULT 'active',
  default_for_new_jobs boolean NOT NULL DEFAULT false,
  owner_defaults_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_template_version_identity_unique UNIQUE (template_id, version_number)
);

CREATE INDEX IF NOT EXISTS workflow_template_version_lookup_idx
  ON workflow_template_version (tenant_id, template_id, status, default_for_new_jobs, version_number DESC);

CREATE TABLE IF NOT EXISTS workflow_template_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_version_id uuid NOT NULL REFERENCES workflow_template_version(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  title text NOT NULL,
  event_type text NOT NULL DEFAULT 'job_event',
  start_anchor shared_workflow_date_anchor_type NOT NULL DEFAULT 'job_scheduled_start',
  start_offset_days integer NOT NULL DEFAULT 0,
  start_offset_minutes integer NOT NULL DEFAULT 0,
  duration_minutes integer NOT NULL DEFAULT 120,
  required boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_template_event_identity_unique UNIQUE (template_version_id, event_key)
);

CREATE INDEX IF NOT EXISTS workflow_template_event_version_idx
  ON workflow_template_event (tenant_id, template_version_id, sort_order, created_at DESC);

CREATE TABLE IF NOT EXISTS workflow_template_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_version_id uuid NOT NULL REFERENCES workflow_template_version(id) ON DELETE CASCADE,
  task_key text NOT NULL,
  title text NOT NULL,
  description text,
  task_type text NOT NULL DEFAULT 'general',
  department_type work_department_type NOT NULL,
  event_key text,
  owner_default_type text NOT NULL DEFAULT 'unassigned',
  owner_default_value text,
  status work_task_status_type NOT NULL DEFAULT 'not_started',
  priority job_priority_level NOT NULL DEFAULT 'normal',
  due_anchor shared_workflow_date_anchor_type NOT NULL DEFAULT 'job_scheduled_start',
  due_offset_days integer NOT NULL DEFAULT 0,
  due_offset_minutes integer NOT NULL DEFAULT 0,
  required boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_template_task_identity_unique UNIQUE (template_version_id, task_key)
);

CREATE INDEX IF NOT EXISTS workflow_template_task_version_idx
  ON workflow_template_task (tenant_id, template_version_id, department_type, sort_order, created_at DESC);

CREATE TABLE IF NOT EXISTS workflow_template_task_dependency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_version_id uuid NOT NULL REFERENCES workflow_template_version(id) ON DELETE CASCADE,
  task_key text NOT NULL,
  depends_on_task_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_template_task_dependency_identity_unique UNIQUE (template_version_id, task_key, depends_on_task_key)
);

CREATE TABLE IF NOT EXISTS workflow_template_acknowledgement_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_version_id uuid NOT NULL REFERENCES workflow_template_version(id) ON DELETE CASCADE,
  rule_key text NOT NULL,
  target_type text NOT NULL,
  target_key text NOT NULL,
  require_on_assignment boolean NOT NULL DEFAULT false,
  require_on_claim boolean NOT NULL DEFAULT false,
  summary text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_template_ack_rule_target_type_check CHECK (target_type IN ('task')),
  CONSTRAINT workflow_template_ack_rule_identity_unique UNIQUE (template_version_id, rule_key)
);

CREATE TABLE IF NOT EXISTS workflow_template_approval_checkpoint (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_version_id uuid NOT NULL REFERENCES workflow_template_version(id) ON DELETE CASCADE,
  checkpoint_key text NOT NULL,
  title text NOT NULL,
  target_type text NOT NULL,
  target_key text,
  activate_when text NOT NULL,
  request_type text NOT NULL,
  requested_action_code text NOT NULL,
  request_summary text,
  reason text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  blocking boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_template_approval_target_type_check CHECK (target_type IN ('job', 'task')),
  CONSTRAINT workflow_template_approval_activate_when_check CHECK (activate_when IN ('on_run_start', 'on_task_completion')),
  CONSTRAINT workflow_template_approval_identity_unique UNIQUE (template_version_id, checkpoint_key)
);

CREATE TABLE IF NOT EXISTS workflow_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES workflow_template(id) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL REFERENCES workflow_template_version(id) ON DELETE RESTRICT,
  template_key text NOT NULL,
  workflow_family shared_workflow_family_type NOT NULL,
  status shared_workflow_run_status_type NOT NULL DEFAULT 'draft',
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  started_at timestamptz,
  completed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_run_job_family_unique UNIQUE (tenant_id, job_id, workflow_family)
);

CREATE INDEX IF NOT EXISTS workflow_run_tenant_job_idx
  ON workflow_run (tenant_id, job_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS workflow_run_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  workflow_run_id uuid NOT NULL REFERENCES workflow_run(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  job_day_id uuid NOT NULL REFERENCES job_days(id) ON DELETE CASCADE,
  event_title text NOT NULL,
  event_type text NOT NULL DEFAULT 'job_event',
  start_at timestamptz,
  end_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_run_event_identity_unique UNIQUE (workflow_run_id, event_key),
  CONSTRAINT workflow_run_event_day_unique UNIQUE (workflow_run_id, job_day_id)
);

ALTER TABLE work_task
  ADD COLUMN IF NOT EXISTS job_day_id uuid REFERENCES job_days(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workflow_run_id uuid REFERENCES workflow_run(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workflow_template_task_key text;

CREATE INDEX IF NOT EXISTS work_task_tenant_job_day_idx
  ON work_task (tenant_id, job_day_id, status, due_at)
  WHERE job_day_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS work_task_tenant_workflow_run_idx
  ON work_task (tenant_id, workflow_run_id, status, due_at, created_at DESC)
  WHERE workflow_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS workflow_run_task_dependency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  workflow_run_id uuid NOT NULL REFERENCES workflow_run(id) ON DELETE CASCADE,
  work_task_id uuid NOT NULL REFERENCES work_task(id) ON DELETE CASCADE,
  depends_on_work_task_id uuid NOT NULL REFERENCES work_task(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_run_task_dependency_identity_unique UNIQUE (workflow_run_id, work_task_id, depends_on_work_task_id)
);

CREATE INDEX IF NOT EXISTS workflow_run_task_dependency_task_idx
  ON workflow_run_task_dependency (tenant_id, workflow_run_id, work_task_id, depends_on_work_task_id);

CREATE TABLE IF NOT EXISTS workflow_run_acknowledgement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  workflow_run_id uuid NOT NULL REFERENCES workflow_run(id) ON DELETE CASCADE,
  rule_key text NOT NULL,
  work_task_id uuid REFERENCES work_task(id) ON DELETE CASCADE,
  requested_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  acknowledged_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  status shared_workflow_ack_status_type NOT NULL DEFAULT 'pending',
  summary text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_run_acknowledgement_identity_unique UNIQUE (workflow_run_id, rule_key, work_task_id)
);

CREATE INDEX IF NOT EXISTS workflow_run_acknowledgement_task_idx
  ON workflow_run_acknowledgement (tenant_id, workflow_run_id, work_task_id, status, requested_at DESC);

CREATE TABLE IF NOT EXISTS workflow_run_approval_checkpoint (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  workflow_run_id uuid NOT NULL REFERENCES workflow_run(id) ON DELETE CASCADE,
  checkpoint_key text NOT NULL,
  work_task_id uuid REFERENCES work_task(id) ON DELETE SET NULL,
  operational_approval_request_id uuid REFERENCES operational_approval_request(id) ON DELETE SET NULL,
  title text NOT NULL,
  request_type text NOT NULL,
  requested_action_code text NOT NULL,
  request_summary text,
  reason text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  blocking boolean NOT NULL DEFAULT true,
  status shared_workflow_approval_checkpoint_status_type NOT NULL DEFAULT 'queued',
  activated_at timestamptz,
  resolved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_run_approval_checkpoint_identity_unique UNIQUE (workflow_run_id, checkpoint_key)
);

CREATE INDEX IF NOT EXISTS workflow_run_approval_checkpoint_lookup_idx
  ON workflow_run_approval_checkpoint (tenant_id, workflow_run_id, status, created_at DESC);

INSERT INTO workflow_template (
  tenant_id,
  template_key,
  name,
  description,
  workflow_family
)
SELECT
  tenant.id,
  seeded.template_key,
  seeded.name,
  seeded.description,
  seeded.workflow_family::shared_workflow_family_type
FROM tenant
CROSS JOIN (
  VALUES
    (
      'schools_phase_one_core',
      'Schools Phase-One Workflow',
      'Shared schools workflow from scheduling confirmation through graphics handoff.',
      'schools'
    ),
    (
      'sports_phase_one_core',
      'Sports Phase-One Workflow',
      'Shared sports workflow from roster prep through graphics handoff.',
      'sports'
    ),
    (
      'graphics_handoff_phase_one_core',
      'Graphics Handoff Phase-One Workflow',
      'Shared graphics handoff workflow for internal production, QA, and release readiness.',
      'graphics_handoff'
    )
) AS seeded(template_key, name, description, workflow_family)
WHERE NOT EXISTS (
  SELECT 1
  FROM workflow_template existing
  WHERE existing.tenant_id = tenant.id
    AND existing.template_key = seeded.template_key
);

INSERT INTO workflow_template_version (
  tenant_id,
  template_id,
  version_number,
  status,
  default_for_new_jobs,
  owner_defaults_json
)
SELECT
  template.tenant_id,
  template.id,
  1,
  'active'::shared_workflow_template_version_status_type,
  true,
  '{}'::jsonb
FROM workflow_template template
WHERE NOT EXISTS (
  SELECT 1
  FROM workflow_template_version version_row
  WHERE version_row.template_id = template.id
    AND version_row.version_number = 1
);

INSERT INTO workflow_template_event (
  tenant_id,
  template_version_id,
  event_key,
  title,
  event_type,
  start_anchor,
  start_offset_days,
  start_offset_minutes,
  duration_minutes,
  required,
  sort_order
)
SELECT
  version_row.tenant_id,
  version_row.id,
  seeded.event_key,
  seeded.title,
  seeded.event_type,
  seeded.start_anchor::shared_workflow_date_anchor_type,
  seeded.start_offset_days,
  seeded.start_offset_minutes,
  seeded.duration_minutes,
  seeded.required,
  seeded.sort_order
FROM workflow_template template
JOIN workflow_template_version version_row
  ON version_row.template_id = template.id
 AND version_row.version_number = 1
JOIN (
  VALUES
    ('schools_phase_one_core', 'picture_day', 'Picture Day', 'job_event', 'job_scheduled_start', 0, 0, 120, true, 0),
    ('sports_phase_one_core', 'media_day', 'Media Day', 'job_event', 'job_scheduled_start', 0, 0, 120, true, 0),
    ('graphics_handoff_phase_one_core', 'graphics_handoff_window', 'Graphics Handoff Window', 'job_event', 'job_scheduled_end', 0, 0, 60, true, 0)
 ) AS seeded(
    template_key,
    event_key,
    title,
    event_type,
    start_anchor,
    start_offset_days,
    start_offset_minutes,
    duration_minutes,
    required,
    sort_order
 )
  ON seeded.template_key = template.template_key
WHERE NOT EXISTS (
  SELECT 1
  FROM workflow_template_event existing
  WHERE existing.template_version_id = version_row.id
    AND existing.event_key = seeded.event_key
);

INSERT INTO workflow_template_task (
  tenant_id,
  template_version_id,
  task_key,
  title,
  description,
  task_type,
  department_type,
  event_key,
  owner_default_type,
  owner_default_value,
  status,
  priority,
  due_anchor,
  due_offset_days,
  due_offset_minutes,
  required,
  sort_order
)
SELECT
  version_row.tenant_id,
  version_row.id,
  seeded.task_key,
  seeded.title,
  seeded.description,
  seeded.task_type,
  seeded.department_type::work_department_type,
  seeded.event_key,
  seeded.owner_default_type,
  seeded.owner_default_value,
  seeded.status::work_task_status_type,
  seeded.priority::job_priority_level,
  seeded.due_anchor::shared_workflow_date_anchor_type,
  seeded.due_offset_days,
  seeded.due_offset_minutes,
  seeded.required,
  seeded.sort_order
FROM workflow_template template
JOIN workflow_template_version version_row
  ON version_row.template_id = template.id
 AND version_row.version_number = 1
JOIN (
  VALUES
    (
      'schools_phase_one_core',
      'confirm_schedule',
      'Confirm school schedule and account context',
      'Lock the school day timing, contact expectations, and internal ownership before staffing starts.',
      'coordination',
      'schools',
      'picture_day',
      'account_owner',
      NULL,
      'not_started',
      'high',
      'job_scheduled_start',
      -5,
      0,
      true,
      0
    ),
    (
      'schools_phase_one_core',
      'staff_picture_day',
      'Staff picture day coverage',
      'Assign field coverage and confirm who owns the school-day staffing handoff.',
      'staffing',
      'schools',
      'picture_day',
      'team',
      'schools_staffing',
      'not_started',
      'high',
      'job_scheduled_start',
      -3,
      0,
      true,
      1
    ),
    (
      'schools_phase_one_core',
      'graphics_handoff',
      'Send school work to graphics',
      'Package the school job for internal graphics handoff once day-of work is complete.',
      'handoff',
      'production',
      'picture_day',
      'team',
      'graphics-production',
      'not_started',
      'high',
      'job_scheduled_end',
      1,
      0,
      true,
      2
    ),
    (
      'sports_phase_one_core',
      'collect_roster',
      'Confirm roster and team structure',
      'Validate roster shape, proof requirements, and contact ownership before staffing.',
      'coordination',
      'sports',
      'media_day',
      'account_owner',
      NULL,
      'not_started',
      'high',
      'job_scheduled_start',
      -4,
      0,
      true,
      0
    ),
    (
      'sports_phase_one_core',
      'staff_media_day',
      'Staff sports media day',
      'Assign sports coverage and make the lead staffing handoff explicit.',
      'staffing',
      'sports',
      'media_day',
      'team',
      'sports_staffing',
      'not_started',
      'high',
      'job_scheduled_start',
      -2,
      0,
      true,
      1
    ),
    (
      'sports_phase_one_core',
      'graphics_handoff',
      'Send sports work to graphics',
      'Package the sports job for internal graphics handoff after the media day closes.',
      'handoff',
      'production',
      'media_day',
      'team',
      'graphics-production',
      'not_started',
      'high',
      'job_scheduled_end',
      1,
      0,
      true,
      2
    ),
    (
      'graphics_handoff_phase_one_core',
      'ingest_assets',
      'Ingest graphics handoff',
      'Claim the incoming work, verify the handoff package, and begin internal production.',
      'production',
      'production',
      'graphics_handoff_window',
      'team',
      'graphics-production',
      'not_started',
      'high',
      'job_scheduled_end',
      0,
      0,
      true,
      0
    ),
    (
      'graphics_handoff_phase_one_core',
      'peer_review',
      'Peer review the graphics package',
      'Run internal peer review before release-ready confirmation.',
      'peer_review',
      'production',
      'graphics_handoff_window',
      'team',
      'graphics-qa',
      'not_started',
      'high',
      'job_scheduled_end',
      1,
      0,
      true,
      1
    ),
    (
      'graphics_handoff_phase_one_core',
      'release_ready',
      'Prepare release-ready package',
      'Finalize the graphics package and request blocking release signoff.',
      'release',
      'production',
      'graphics_handoff_window',
      'team',
      'graphics-release',
      'not_started',
      'high',
      'job_scheduled_end',
      2,
      0,
      true,
      2
    )
 ) AS seeded(
    template_key,
    task_key,
    title,
    description,
    task_type,
    department_type,
    event_key,
    owner_default_type,
    owner_default_value,
    status,
    priority,
    due_anchor,
    due_offset_days,
    due_offset_minutes,
    required,
    sort_order
 )
  ON seeded.template_key = template.template_key
WHERE NOT EXISTS (
  SELECT 1
  FROM workflow_template_task existing
  WHERE existing.template_version_id = version_row.id
    AND existing.task_key = seeded.task_key
);

INSERT INTO workflow_template_task_dependency (
  tenant_id,
  template_version_id,
  task_key,
  depends_on_task_key
)
SELECT
  version_row.tenant_id,
  version_row.id,
  seeded.task_key,
  seeded.depends_on_task_key
FROM workflow_template template
JOIN workflow_template_version version_row
  ON version_row.template_id = template.id
 AND version_row.version_number = 1
JOIN (
  VALUES
    ('schools_phase_one_core', 'staff_picture_day', 'confirm_schedule'),
    ('schools_phase_one_core', 'graphics_handoff', 'staff_picture_day'),
    ('sports_phase_one_core', 'staff_media_day', 'collect_roster'),
    ('sports_phase_one_core', 'graphics_handoff', 'staff_media_day'),
    ('graphics_handoff_phase_one_core', 'peer_review', 'ingest_assets'),
    ('graphics_handoff_phase_one_core', 'release_ready', 'peer_review')
 ) AS seeded(template_key, task_key, depends_on_task_key)
  ON seeded.template_key = template.template_key
WHERE NOT EXISTS (
  SELECT 1
  FROM workflow_template_task_dependency existing
  WHERE existing.template_version_id = version_row.id
    AND existing.task_key = seeded.task_key
    AND existing.depends_on_task_key = seeded.depends_on_task_key
);

INSERT INTO workflow_template_acknowledgement_rule (
  tenant_id,
  template_version_id,
  rule_key,
  target_type,
  target_key,
  require_on_assignment,
  require_on_claim,
  summary,
  sort_order
)
SELECT
  version_row.tenant_id,
  version_row.id,
  seeded.rule_key,
  seeded.target_type,
  seeded.target_key,
  seeded.require_on_assignment,
  seeded.require_on_claim,
  seeded.summary,
  seeded.sort_order
FROM workflow_template template
JOIN workflow_template_version version_row
  ON version_row.template_id = template.id
 AND version_row.version_number = 1
JOIN (
  VALUES
    (
      'schools_phase_one_core',
      'schools_schedule_ack',
      'task',
      'confirm_schedule',
      true,
      false,
      'Acknowledge the school schedule confirmation assignment.',
      0
    ),
    (
      'schools_phase_one_core',
      'schools_graphics_claim',
      'task',
      'graphics_handoff',
      false,
      true,
      'Claim the school graphics handoff before work begins.',
      1
    ),
    (
      'sports_phase_one_core',
      'sports_roster_ack',
      'task',
      'collect_roster',
      true,
      false,
      'Acknowledge the sports roster preparation assignment.',
      0
    ),
    (
      'sports_phase_one_core',
      'sports_graphics_claim',
      'task',
      'graphics_handoff',
      false,
      true,
      'Claim the sports graphics handoff before work begins.',
      1
    ),
    (
      'graphics_handoff_phase_one_core',
      'graphics_ingest_claim',
      'task',
      'ingest_assets',
      false,
      true,
      'Claim the graphics ingest queue before taking ownership.',
      0
    )
 ) AS seeded(
    template_key,
    rule_key,
    target_type,
    target_key,
    require_on_assignment,
    require_on_claim,
    summary,
    sort_order
 )
  ON seeded.template_key = template.template_key
WHERE NOT EXISTS (
  SELECT 1
  FROM workflow_template_acknowledgement_rule existing
  WHERE existing.template_version_id = version_row.id
    AND existing.rule_key = seeded.rule_key
);

INSERT INTO workflow_template_approval_checkpoint (
  tenant_id,
  template_version_id,
  checkpoint_key,
  title,
  target_type,
  target_key,
  activate_when,
  request_type,
  requested_action_code,
  request_summary,
  reason,
  severity,
  blocking,
  sort_order
)
SELECT
  version_row.tenant_id,
  version_row.id,
  seeded.checkpoint_key,
  seeded.title,
  seeded.target_type,
  seeded.target_key,
  seeded.activate_when,
  seeded.request_type,
  seeded.requested_action_code,
  seeded.request_summary,
  seeded.reason,
  seeded.severity,
  seeded.blocking,
  seeded.sort_order
FROM workflow_template template
JOIN workflow_template_version version_row
  ON version_row.template_id = template.id
 AND version_row.version_number = 1
JOIN (
  VALUES
    (
      'graphics_handoff_phase_one_core',
      'graphics_release_signoff',
      'Graphics release signoff',
      'task',
      'release_ready',
      'on_task_completion',
      'release_override_approval',
      'approve_graphics_release',
      'Release-ready graphics package requires blocking signoff before downstream release actions.',
      'Approve the graphics release-ready package before it leaves the internal workflow.',
      'high',
      true,
      0
    )
 ) AS seeded(
    template_key,
    checkpoint_key,
    title,
    target_type,
    target_key,
    activate_when,
    request_type,
    requested_action_code,
    request_summary,
    reason,
    severity,
    blocking,
    sort_order
 )
  ON seeded.template_key = template.template_key
WHERE NOT EXISTS (
  SELECT 1
  FROM workflow_template_approval_checkpoint existing
  WHERE existing.template_version_id = version_row.id
    AND existing.checkpoint_key = seeded.checkpoint_key
);
