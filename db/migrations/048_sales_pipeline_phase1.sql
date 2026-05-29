DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'permission_domain') THEN
    ALTER TYPE permission_domain ADD VALUE IF NOT EXISTS 'sales_pipeline';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_pipeline_type') THEN
    CREATE TYPE sales_pipeline_type AS ENUM (
      'schools',
      'sports'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_opportunity_type') THEN
    CREATE TYPE sales_opportunity_type AS ENUM (
      'new',
      'renewal',
      'expansion'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_opportunity_stage') THEN
    CREATE TYPE sales_opportunity_stage AS ENUM (
      'lead',
      'contacted',
      'meeting_scheduled',
      'proposal_sent',
      'follow_up',
      'negotiation',
      'contract_sent',
      'won',
      'lost',
      'dormant'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_opportunity_status') THEN
    CREATE TYPE sales_opportunity_status AS ENUM (
      'active',
      'dormant',
      'won',
      'lost'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sales_opportunity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  primary_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  owner_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  opportunity_type sales_opportunity_type NOT NULL,
  pipeline_type sales_pipeline_type NOT NULL,
  stage sales_opportunity_stage NOT NULL DEFAULT 'lead',
  estimated_value numeric(12,2),
  next_action_date date NOT NULL,
  last_touch_date date NOT NULL,
  last_verified_contact_date date,
  notes text,
  status sales_opportunity_status NOT NULL DEFAULT 'active',
  follow_up_date date,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_opportunity_estimated_value_chk CHECK (estimated_value IS NULL OR estimated_value >= 0),
  CONSTRAINT sales_opportunity_dormant_follow_up_chk CHECK (
    stage <> 'dormant' OR follow_up_date IS NOT NULL
  ),
  CONSTRAINT sales_opportunity_stage_status_chk CHECK (
    (stage = 'dormant' AND status = 'dormant')
    OR (stage = 'won' AND status = 'won')
    OR (stage = 'lost' AND status = 'lost')
    OR (stage NOT IN ('dormant', 'won', 'lost') AND status = 'active')
  )
);

CREATE INDEX IF NOT EXISTS sales_opportunity_pipeline_idx
  ON sales_opportunity (tenant_id, pipeline_type, status, stage, next_action_date);

CREATE INDEX IF NOT EXISTS sales_opportunity_follow_up_idx
  ON sales_opportunity (tenant_id, follow_up_date, updated_at DESC)
  WHERE follow_up_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_opportunity_org_idx
  ON sales_opportunity (tenant_id, organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS sales_opportunity_owner_idx
  ON sales_opportunity (tenant_id, owner_id, updated_at DESC);

ALTER TABLE sales_opportunity ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_opportunity FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales_opportunity'
      AND policyname = 'tenant_isolation_sales_opportunity'
  ) THEN
    CREATE POLICY tenant_isolation_sales_opportunity ON sales_opportunity
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
