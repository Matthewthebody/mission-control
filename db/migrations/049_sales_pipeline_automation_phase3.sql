DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agreement_reminder_type') THEN
    ALTER TYPE agreement_reminder_type ADD VALUE IF NOT EXISTS 'unsigned_7_day';
  END IF;
END $$;

ALTER TABLE sales_opportunity
  ALTER COLUMN next_action_date DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_pipeline_alert_type') THEN
    CREATE TYPE sales_pipeline_alert_type AS ENUM (
      'missing_next_action',
      'inactive_opportunity',
      'meeting_scheduled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_pipeline_alert_status') THEN
    CREATE TYPE sales_pipeline_alert_status AS ENUM (
      'open',
      'resolved'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_pipeline_alert_severity') THEN
    CREATE TYPE sales_pipeline_alert_severity AS ENUM (
      'warning',
      'major',
      'critical'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sales_pipeline_alert (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  alert_type sales_pipeline_alert_type NOT NULL,
  status sales_pipeline_alert_status NOT NULL DEFAULT 'open',
  severity sales_pipeline_alert_severity NOT NULL DEFAULT 'warning',
  dedupe_key text NOT NULL,
  pipeline_type sales_pipeline_type,
  opportunity_id uuid REFERENCES sales_opportunity(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organization(id) ON DELETE CASCADE,
  agreement_id uuid REFERENCES agreement(id) ON DELETE SET NULL,
  linked_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  title text NOT NULL,
  message text NOT NULL,
  due_at timestamptz,
  first_triggered_at timestamptz NOT NULL DEFAULT now(),
  last_triggered_at timestamptz NOT NULL DEFAULT now(),
  first_notified_at timestamptz,
  last_notified_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  resolution_note text,
  created_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_pipeline_alert_target_chk CHECK (
    num_nonnulls(opportunity_id, organization_id, agreement_id, linked_shoot_id) >= 1
  ),
  CONSTRAINT sales_pipeline_alert_resolution_chk CHECK (
    (status = 'open' AND resolved_at IS NULL AND resolved_by IS NULL)
    OR (status = 'resolved' AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS sales_pipeline_alert_status_idx
  ON sales_pipeline_alert (tenant_id, status, severity, last_triggered_at DESC);

CREATE INDEX IF NOT EXISTS sales_pipeline_alert_pipeline_idx
  ON sales_pipeline_alert (tenant_id, pipeline_type, status, last_triggered_at DESC)
  WHERE pipeline_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_pipeline_alert_opportunity_idx
  ON sales_pipeline_alert (tenant_id, opportunity_id, status, alert_type, created_at DESC)
  WHERE opportunity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_pipeline_alert_organization_idx
  ON sales_pipeline_alert (tenant_id, organization_id, status, alert_type, created_at DESC)
  WHERE organization_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sales_pipeline_alert_open_dedupe_uq
  ON sales_pipeline_alert (tenant_id, dedupe_key)
  WHERE status = 'open';

ALTER TABLE sales_pipeline_alert ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_pipeline_alert FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales_pipeline_alert'
      AND policyname = 'tenant_isolation_sales_pipeline_alert'
  ) THEN
    CREATE POLICY tenant_isolation_sales_pipeline_alert ON sales_pipeline_alert
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
