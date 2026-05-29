DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'school_deliverable_type') THEN
    CREATE TYPE school_deliverable_type AS ENUM (
      'gallery',
      'ids',
      'yearbook',
      'graduation',
      'admin_items',
      'shipment',
      'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'school_deliverable_status') THEN
    CREATE TYPE school_deliverable_status AS ENUM (
      'planned',
      'in_progress',
      'blocked',
      'ready',
      'delivered',
      'cancelled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'school_delivery_method') THEN
    CREATE TYPE school_delivery_method AS ENUM (
      'pickup',
      'mail',
      'courier',
      'digital',
      'field_drop',
      'other'
    );
  END IF;
END $$;

DROP INDEX IF EXISTS school_job_linked_shoot_unique_idx;

CREATE UNIQUE INDEX IF NOT EXISTS school_job_linked_shoot_job_type_unique_idx
  ON school_job (tenant_id, linked_shoot_id, job_type)
  WHERE linked_shoot_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS school_deliverable (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  school_job_id uuid REFERENCES school_job(id) ON DELETE SET NULL,
  school_work_item_id uuid REFERENCES school_work_item(id) ON DELETE SET NULL,
  linked_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  linked_production_project_id uuid REFERENCES production_project(id) ON DELETE SET NULL,
  linked_location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  deliverable_type school_deliverable_type NOT NULL,
  status school_deliverable_status NOT NULL DEFAULT 'planned',
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  due_date date,
  ready_date date,
  delivered_date date,
  delivery_method school_delivery_method,
  tracking_reference text,
  notes text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_deliverable_lookup_idx
  ON school_deliverable (tenant_id, organization_id, status, due_date, ready_date, created_at DESC);

CREATE INDEX IF NOT EXISTS school_deliverable_owner_idx
  ON school_deliverable (tenant_id, owner_user_id, status, due_date);

CREATE INDEX IF NOT EXISTS school_deliverable_links_idx
  ON school_deliverable (tenant_id, school_job_id, school_work_item_id, linked_shoot_id, linked_production_project_id);

CREATE UNIQUE INDEX IF NOT EXISTS school_deliverable_work_item_unique_idx
  ON school_deliverable (tenant_id, school_work_item_id)
  WHERE school_work_item_id IS NOT NULL;

ALTER TABLE school_deliverable ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_deliverable FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'school_deliverable'
      AND policyname = 'tenant_isolation_school_deliverable'
  ) THEN
    CREATE POLICY tenant_isolation_school_deliverable ON school_deliverable
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
