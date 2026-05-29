DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'directory_touchpoint_channel') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum
      WHERE enumtypid = 'directory_touchpoint_channel'::regtype
        AND enumlabel = 'picture_day_conversation'
    ) THEN
      ALTER TYPE directory_touchpoint_channel ADD VALUE 'picture_day_conversation';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum
      WHERE enumtypid = 'directory_touchpoint_channel'::regtype
        AND enumlabel = 'internal_debrief'
    ) THEN
      ALTER TYPE directory_touchpoint_channel ADD VALUE 'internal_debrief';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum
      WHERE enumtypid = 'directory_touchpoint_channel'::regtype
        AND enumlabel = 'portal_message'
    ) THEN
      ALTER TYPE directory_touchpoint_channel ADD VALUE 'portal_message';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'directory_touchpoint_category') THEN
    CREATE TYPE directory_touchpoint_category AS ENUM (
      'planning',
      'pre_shoot_confirmation',
      'day_of_readiness',
      'post_shoot_follow_up',
      'yearbook_deliverables',
      'customer_issue_resolution',
      'relationship_maintenance',
      'renewal_contract',
      'billing_finance',
      'operational_change',
      'thank_you_appreciation',
      'executive_leadership_checkin'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'directory_touchpoint_plan_lifecycle_status') THEN
    CREATE TYPE directory_touchpoint_plan_lifecycle_status AS ENUM (
      'planned',
      'completed',
      'skipped',
      'cancelled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'directory_communication_outcome') THEN
    CREATE TYPE directory_communication_outcome AS ENUM (
      'informational_only',
      'confirmed',
      'waiting_on_customer',
      'waiting_on_internal_team',
      'follow_up_needed',
      'resolved',
      'escalated',
      'relationship_building',
      'problem_identified'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'directory_relationship_memory_type') THEN
    CREATE TYPE directory_relationship_memory_type AS ENUM (
      'communication_preference',
      'operational_expectation',
      'cadence_timing_preference',
      'escalation_preference',
      'day_of_coordination_preference',
      'yearbook_deliverable_preference',
      'relationship_sensitivity',
      'appreciation_hospitality_note',
      'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'directory_relationship_memory_status') THEN
    CREATE TYPE directory_relationship_memory_status AS ENUM ('active', 'needs_review', 'archived');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'directory_relationship_memory_visibility') THEN
    CREATE TYPE directory_relationship_memory_visibility AS ENUM (
      'assignment_relevant',
      'manager_plus',
      'leadership_only'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'directory_follow_up_status') THEN
    CREATE TYPE directory_follow_up_status AS ENUM ('open', 'in_progress', 'completed', 'cancelled');
  END IF;
END $$;

ALTER TABLE directory_touchpoint
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS category directory_touchpoint_category,
  ADD COLUMN IF NOT EXISTS outcome_state directory_communication_outcome,
  ADD COLUMN IF NOT EXISTS follow_up_needed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS follow_up_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS relationship_memory_suggested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attachment_reference text;

CREATE TABLE IF NOT EXISTS directory_touchpoint_plan_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_key text NOT NULL,
  template_name text NOT NULL,
  category directory_touchpoint_category NOT NULL,
  scope_hint text NOT NULL DEFAULT 'organization',
  summary text NOT NULL,
  default_offset_days integer,
  default_due_time time,
  active_status boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, template_key)
);

CREATE TABLE IF NOT EXISTS directory_touchpoint_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  linked_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  template_id uuid REFERENCES directory_touchpoint_plan_template(id) ON DELETE SET NULL,
  category directory_touchpoint_category NOT NULL,
  status directory_touchpoint_plan_lifecycle_status NOT NULL DEFAULT 'planned',
  title text NOT NULL,
  summary text,
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  backup_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  due_at timestamptz NOT NULL,
  completed_at timestamptz,
  skipped_reason text,
  cancelled_reason text,
  completion_note text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE directory_touchpoint
  ADD COLUMN IF NOT EXISTS touchpoint_plan_id uuid REFERENCES directory_touchpoint_plan(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS directory_relationship_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  source_touchpoint_id uuid REFERENCES directory_touchpoint(id) ON DELETE SET NULL,
  memory_type directory_relationship_memory_type NOT NULL,
  summary text NOT NULL,
  why_it_matters text NOT NULL,
  source_label text,
  visibility directory_relationship_memory_visibility NOT NULL DEFAULT 'assignment_relevant',
  status directory_relationship_memory_status NOT NULL DEFAULT 'needs_review',
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  last_confirmed_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT directory_relationship_memory_scope_chk CHECK (
    organization_id IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS directory_relationship_follow_up (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  linked_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  source_touchpoint_id uuid REFERENCES directory_touchpoint(id) ON DELETE SET NULL,
  source_touchpoint_plan_id uuid REFERENCES directory_touchpoint_plan(id) ON DELETE SET NULL,
  title text NOT NULL,
  summary text,
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  backup_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  due_at timestamptz NOT NULL,
  status directory_follow_up_status NOT NULL DEFAULT 'open',
  completed_at timestamptz,
  resolution_note text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS directory_touchpoint_follow_up_idx
  ON directory_touchpoint (tenant_id, follow_up_needed, follow_up_date, occurred_at DESC);

CREATE INDEX IF NOT EXISTS directory_touchpoint_plan_due_idx
  ON directory_touchpoint_plan (tenant_id, organization_id, due_at, status);

CREATE INDEX IF NOT EXISTS directory_touchpoint_plan_contact_idx
  ON directory_touchpoint_plan (tenant_id, contact_id, due_at DESC)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS directory_relationship_memory_scope_idx
  ON directory_relationship_memory (tenant_id, organization_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS directory_relationship_memory_contact_idx
  ON directory_relationship_memory (tenant_id, contact_id, updated_at DESC)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS directory_relationship_follow_up_due_idx
  ON directory_relationship_follow_up (tenant_id, organization_id, due_at, status);

CREATE INDEX IF NOT EXISTS directory_relationship_follow_up_contact_idx
  ON directory_relationship_follow_up (tenant_id, contact_id, due_at DESC)
  WHERE contact_id IS NOT NULL;

ALTER TABLE directory_touchpoint_plan_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE directory_touchpoint_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE directory_relationship_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE directory_relationship_follow_up ENABLE ROW LEVEL SECURITY;

ALTER TABLE directory_touchpoint_plan_template FORCE ROW LEVEL SECURITY;
ALTER TABLE directory_touchpoint_plan FORCE ROW LEVEL SECURITY;
ALTER TABLE directory_relationship_memory FORCE ROW LEVEL SECURITY;
ALTER TABLE directory_relationship_follow_up FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_directory_touchpoint_plan_template ON directory_touchpoint_plan_template
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_directory_touchpoint_plan ON directory_touchpoint_plan
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_directory_relationship_memory ON directory_relationship_memory
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_directory_relationship_follow_up ON directory_relationship_follow_up
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

INSERT INTO directory_touchpoint_plan_template (
  tenant_id,
  template_key,
  template_name,
  category,
  scope_hint,
  summary,
  default_offset_days,
  default_due_time
)
SELECT
  tenant.id,
  seeded.template_key,
  seeded.template_name,
  seeded.category::directory_touchpoint_category,
  seeded.scope_hint,
  seeded.summary,
  seeded.default_offset_days,
  seeded.default_due_time::time
FROM tenant
JOIN (
  VALUES
    ('spring_planning_meeting', 'Spring Planning Meeting', 'planning', 'organization', 'Kick off planning before the season locks. Confirm timing, key contacts, and what changed since last year.', -45, '09:00'),
    ('pre_shoot_confirmation', 'Pre-Shoot Confirmation', 'pre_shoot_confirmation', 'contact', 'Confirm timing, roster/data expectations, and day-of contact coverage before the shoot.', -10, '10:00'),
    ('one_day_out_confirmation', '1-Day-Out Confirmation', 'day_of_readiness', 'contact', 'Make sure tomorrow''s logistics, access, and setup expectations are still true.', -1, '14:00'),
    ('post_shoot_check_in', 'Post-Shoot Check-In', 'post_shoot_follow_up', 'contact', 'Close the loop after picture day, confirm concerns, and capture next steps.', 1, '10:00'),
    ('yearbook_deliverable_check', 'Yearbook / Deliverables Check-In', 'yearbook_deliverables', 'organization', 'Keep yearbook and deliverable communication from going stale between major milestones.', 14, '09:00'),
    ('relationship_maintenance', 'Relationship Maintenance', 'relationship_maintenance', 'organization', 'Maintain contact rhythm even when no major issue is open.', 30, '09:00'),
    ('billing_follow_up', 'Billing / Finance Follow-Up', 'billing_finance', 'contact', 'Track billing questions, approvals, or invoice follow-through without burying them in general notes.', 7, '09:00'),
    ('leadership_check_in', 'Executive / Leadership Check-In', 'executive_leadership_checkin', 'organization', 'Use a lightweight leadership touchpoint for key accounts or recovery moments.', 30, '11:00')
) AS seeded(template_key, template_name, category, scope_hint, summary, default_offset_days, default_due_time)
  ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM directory_touchpoint_plan_template existing
  WHERE existing.tenant_id = tenant.id
    AND existing.template_key = seeded.template_key
);
