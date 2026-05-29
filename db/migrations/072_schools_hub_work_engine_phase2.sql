DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'school_job_type') THEN
    CREATE TYPE school_job_type AS ENUM (
      'fall_portraits',
      'retakes',
      'spring_portraits',
      'sports',
      'graduation',
      'yearbook',
      'ids',
      'admin_fulfillment',
      'delivery',
      'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'school_job_status') THEN
    CREATE TYPE school_job_status AS ENUM (
      'planned',
      'active',
      'waiting',
      'on_hold',
      'completed',
      'cancelled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'school_work_type') THEN
    CREATE TYPE school_work_type AS ENUM (
      'pre_shoot_coordination',
      'gallery_release',
      'id_production',
      'admin_item',
      'yearbook',
      'graduation',
      'delivery',
      'invoicing',
      'follow_up',
      'exception_handling'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'school_work_status') THEN
    CREATE TYPE school_work_status AS ENUM (
      'open',
      'in_progress',
      'waiting',
      'blocked',
      'completed',
      'cancelled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'school_work_stage') THEN
    CREATE TYPE school_work_stage AS ENUM (
      'intake',
      'planning',
      'active',
      'waiting_on_school',
      'waiting_on_internal',
      'ready_for_delivery',
      'done'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'school_work_priority') THEN
    CREATE TYPE school_work_priority AS ENUM (
      'low',
      'normal',
      'high',
      'critical'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'school_work_waiting_on') THEN
    CREATE TYPE school_work_waiting_on AS ENUM (
      'none',
      'school',
      'internal_production',
      'internal_ops',
      'shipping_vendor',
      'billing',
      'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'school_work_source_system') THEN
    CREATE TYPE school_work_source_system AS ENUM (
      'mission_control',
      'monday',
      'manual_import',
      'zendesk',
      'outlook',
      'other'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS school_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  linked_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  linked_location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  job_type school_job_type NOT NULL DEFAULT 'other',
  event_date date,
  due_date date,
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  source_system school_work_source_system NOT NULL DEFAULT 'mission_control',
  source_reference text,
  status school_job_status NOT NULL DEFAULT 'planned',
  title text NOT NULL,
  notes text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_job_lookup_idx
  ON school_job (tenant_id, organization_id, status, due_date, event_date, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS school_job_linked_shoot_unique_idx
  ON school_job (linked_shoot_id)
  WHERE linked_shoot_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS school_work_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  school_job_id uuid REFERENCES school_job(id) ON DELETE SET NULL,
  linked_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  linked_location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  linked_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  linked_follow_up_id uuid REFERENCES directory_relationship_follow_up(id) ON DELETE SET NULL,
  linked_production_project_id uuid REFERENCES production_project(id) ON DELETE SET NULL,
  work_type school_work_type NOT NULL,
  title text NOT NULL,
  description text,
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  status school_work_status NOT NULL DEFAULT 'open',
  stage school_work_stage NOT NULL DEFAULT 'intake',
  priority school_work_priority NOT NULL DEFAULT 'normal',
  due_date date,
  sla_date date,
  blocker_reason text,
  waiting_on school_work_waiting_on NOT NULL DEFAULT 'none',
  source_system school_work_source_system NOT NULL DEFAULT 'mission_control',
  source_reference text,
  generated_by_rule boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  notes text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_work_item_lookup_idx
  ON school_work_item (
    tenant_id,
    organization_id,
    status,
    stage,
    priority,
    due_date,
    sla_date,
    waiting_on,
    created_at DESC
  );

CREATE INDEX IF NOT EXISTS school_work_item_owner_idx
  ON school_work_item (tenant_id, owner_user_id, status, due_date);

CREATE INDEX IF NOT EXISTS school_work_item_links_idx
  ON school_work_item (tenant_id, linked_shoot_id, linked_location_id, linked_contact_id);

ALTER TABLE school_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_job FORCE ROW LEVEL SECURITY;
ALTER TABLE school_work_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_work_item FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_school_job ON school_job
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_school_work_item ON school_work_item
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

INSERT INTO school_job (
  tenant_id,
  organization_id,
  linked_shoot_id,
  linked_location_id,
  job_type,
  event_date,
  due_date,
  owner_user_id,
  source_system,
  source_reference,
  status,
  title,
  notes,
  created_by_user_id,
  updated_by_user_id
)
SELECT
  s.tenant_id,
  s.organization_id,
  s.id,
  s.location_id,
  CASE
    WHEN lower(coalesce(s.title, '')) LIKE '%retake%' THEN 'retakes'::school_job_type
    WHEN lower(coalesce(s.title, '')) LIKE '%grad%' THEN 'graduation'::school_job_type
    WHEN lower(coalesce(s.title, '')) LIKE '%yearbook%' THEN 'yearbook'::school_job_type
    WHEN lower(coalesce(s.title, '')) LIKE '%id%' THEN 'ids'::school_job_type
    WHEN s.shoot_type = 'schools_underclass_portraits' THEN 'fall_portraits'::school_job_type
    WHEN s.shoot_type = 'sports' THEN 'sports'::school_job_type
    ELSE 'other'::school_job_type
  END,
  s.shoot_date,
  s.shoot_date,
  sp.primary_internal_owner_user_id,
  'mission_control'::school_work_source_system,
  concat('shoot:', s.id::text),
  CASE
    WHEN lower(coalesce(s.status::text, '')) IN ('cancelled', 'canceled') THEN 'cancelled'::school_job_status
    WHEN lower(coalesce(s.status::text, '')) IN ('complete', 'completed') THEN 'completed'::school_job_status
    ELSE 'active'::school_job_status
  END,
  coalesce(nullif(trim(s.title), ''), s.shoot_code, 'School job'),
  'Backfilled from the linked shoot record during Schools Hub rollout.',
  s.created_by,
  s.created_by
FROM shoot s
JOIN school_profile sp
  ON sp.tenant_id = s.tenant_id
 AND sp.organization_id = s.organization_id
WHERE s.shoot_date >= current_date - 14
  AND NOT EXISTS (
    SELECT 1
    FROM school_job sj
    WHERE sj.linked_shoot_id = s.id
  );

INSERT INTO school_work_item (
  tenant_id,
  organization_id,
  school_job_id,
  linked_shoot_id,
  linked_location_id,
  work_type,
  title,
  description,
  owner_user_id,
  status,
  stage,
  priority,
  due_date,
  sla_date,
  waiting_on,
  source_system,
  source_reference,
  generated_by_rule,
  completed_at,
  notes,
  created_by_user_id,
  updated_by_user_id
)
SELECT
  sj.tenant_id,
  sj.organization_id,
  sj.id,
  sj.linked_shoot_id,
  sj.linked_location_id,
  'pre_shoot_coordination'::school_work_type,
  concat('Prepare ', sj.title),
  'Backfilled coordination item created from the linked shoot so the Schools Hub has one canonical prep queue.',
  sj.owner_user_id,
  CASE
    WHEN sj.status = 'completed' THEN 'completed'::school_work_status
    WHEN sj.status = 'cancelled' THEN 'cancelled'::school_work_status
    ELSE 'open'::school_work_status
  END,
  CASE
    WHEN sj.status = 'completed' THEN 'done'::school_work_stage
    ELSE 'planning'::school_work_stage
  END,
  CASE
    WHEN sj.event_date IS NOT NULL AND sj.event_date <= current_date + 2 THEN 'high'::school_work_priority
    ELSE 'normal'::school_work_priority
  END,
  sj.due_date,
  sj.event_date,
  'none'::school_work_waiting_on,
  sj.source_system,
  sj.source_reference,
  true,
  CASE
    WHEN sj.status = 'completed' THEN now()
    ELSE NULL
  END,
  'Generated from the linked shoot during Schools Hub rollout.',
  sj.created_by_user_id,
  sj.updated_by_user_id
FROM school_job sj
WHERE sj.linked_shoot_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM school_work_item swi
    WHERE swi.school_job_id = sj.id
      AND swi.work_type = 'pre_shoot_coordination'
  );
