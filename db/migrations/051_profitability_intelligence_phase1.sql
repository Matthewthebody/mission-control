DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'profitability_import_source') THEN
    CREATE TYPE profitability_import_source AS ENUM (
      'revenue_summary',
      'lab_cost',
      'shipping_cost',
      'support_burden',
      'specialty_revenue',
      'yearbook_revenue'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'profitability_import_run_mode') THEN
    CREATE TYPE profitability_import_run_mode AS ENUM ('dry_run', 'apply');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'profitability_import_run_status') THEN
    CREATE TYPE profitability_import_run_status AS ENUM (
      'queued',
      'running',
      'completed',
      'completed_with_issues',
      'failed'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'profitability_validation_issue_severity') THEN
    CREATE TYPE profitability_validation_issue_severity AS ENUM (
      'info',
      'warning',
      'blocking'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'profitability_mapping_status') THEN
    CREATE TYPE profitability_mapping_status AS ENUM (
      'mapped',
      'unmapped',
      'needs_review',
      'held'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'profitability_snapshot_scope') THEN
    CREATE TYPE profitability_snapshot_scope AS ENUM (
      'job',
      'account',
      'season',
      'division',
      'staff',
      'location',
      'dashboard'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'profitability_snapshot_status') THEN
    CREATE TYPE profitability_snapshot_status AS ENUM (
      'pending',
      'fresh',
      'stale',
      'failed',
      'restated'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'profitability_override_type') THEN
    CREATE TYPE profitability_override_type AS ENUM (
      'revenue_adjustment',
      'expense_restatement',
      'allocation_override',
      'mapping_override',
      'snapshot_restated',
      'coaching_signal_suppression',
      'recommendation_dismissal'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'profitability_flag_severity') THEN
    CREATE TYPE profitability_flag_severity AS ENUM (
      'info',
      'watch',
      'warning',
      'critical'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'profitability_dashboard_audience') THEN
    CREATE TYPE profitability_dashboard_audience AS ENUM (
      'leadership',
      'employee_safe',
      'admin'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'profitability_allocation_method') THEN
    CREATE TYPE profitability_allocation_method AS ENUM (
      'flat_amount',
      'percentage_of_revenue',
      'percentage_of_direct_cost',
      'per_subject',
      'per_labor_hour',
      'district_family_split'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS profitability_calculation_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  version_tag text NOT NULL,
  definition_hash text NOT NULL,
  formula_bundle_version text NOT NULL,
  allocation_bundle_version text NOT NULL,
  recommendation_bundle_version text NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  notes text,
  created_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profitability_calculation_version_tag_trimmed_chk CHECK (length(trim(version_tag)) >= 2),
  CONSTRAINT profitability_calculation_version_effective_order_chk CHECK (
    effective_to IS NULL
    OR effective_to >= effective_from
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS profitability_calculation_version_tag_uq
  ON profitability_calculation_version (tenant_id, lower(version_tag));

CREATE TABLE IF NOT EXISTS profitability_import_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  source_type profitability_import_source NOT NULL,
  run_mode profitability_import_run_mode NOT NULL,
  status profitability_import_run_status NOT NULL DEFAULT 'queued',
  file_name text,
  batch_reference text,
  requested_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  mapping_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  dry_run_summary jsonb,
  error_summary jsonb,
  source_line_count integer NOT NULL DEFAULT 0,
  applied_line_count integer NOT NULL DEFAULT 0,
  rejected_line_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profitability_import_run_line_counts_chk CHECK (
    source_line_count >= 0
    AND applied_line_count >= 0
    AND rejected_line_count >= 0
  )
);

CREATE INDEX IF NOT EXISTS profitability_import_run_source_status_idx
  ON profitability_import_run (tenant_id, source_type, status, started_at DESC);

CREATE TABLE IF NOT EXISTS profitability_import_validation_issue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  import_run_id uuid NOT NULL REFERENCES profitability_import_run(id) ON DELETE CASCADE,
  severity profitability_validation_issue_severity NOT NULL,
  issue_code text NOT NULL,
  message text NOT NULL,
  field_name text,
  row_number integer,
  source_line_hash text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS profitability_import_validation_issue_run_idx
  ON profitability_import_validation_issue (tenant_id, import_run_id, severity, created_at DESC);

CREATE TABLE IF NOT EXISTS profitability_source_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  source_type profitability_import_source NOT NULL,
  external_key text NOT NULL,
  external_parent_key text,
  mapping_status profitability_mapping_status NOT NULL DEFAULT 'unmapped',
  job_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  account_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  staff_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  original_job_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  season_id text,
  division_id text,
  notes text,
  mapping_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  mapped_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS profitability_source_mapping_external_key_uq
  ON profitability_source_mapping (tenant_id, source_type, lower(external_key));

CREATE INDEX IF NOT EXISTS profitability_source_mapping_status_idx
  ON profitability_source_mapping (tenant_id, mapping_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS profitability_revenue_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  import_run_id uuid NOT NULL REFERENCES profitability_import_run(id) ON DELETE CASCADE,
  source_mapping_id uuid REFERENCES profitability_source_mapping(id) ON DELETE SET NULL,
  source_line_hash text NOT NULL,
  external_source_name text NOT NULL,
  external_job_key text,
  external_account_key text,
  occurred_at timestamptz NOT NULL,
  currency_code text NOT NULL DEFAULT 'USD',
  gross_amount numeric(14, 2) NOT NULL DEFAULT 0,
  adjustment_amount numeric(14, 2) NOT NULL DEFAULT 0,
  pass_through_amount numeric(14, 2) NOT NULL DEFAULT 0,
  net_operating_adjustment_amount numeric(14, 2) NOT NULL DEFAULT 0,
  job_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  account_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  season_id text,
  division_id text,
  location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS profitability_revenue_entry_line_hash_uq
  ON profitability_revenue_entry (tenant_id, import_run_id, source_line_hash);

CREATE INDEX IF NOT EXISTS profitability_revenue_entry_job_idx
  ON profitability_revenue_entry (tenant_id, job_id, occurred_at DESC)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS profitability_revenue_entry_account_idx
  ON profitability_revenue_entry (tenant_id, account_id, occurred_at DESC)
  WHERE account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS profitability_expense_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  import_run_id uuid NOT NULL REFERENCES profitability_import_run(id) ON DELETE CASCADE,
  source_mapping_id uuid REFERENCES profitability_source_mapping(id) ON DELETE SET NULL,
  source_line_hash text NOT NULL,
  external_job_key text,
  external_account_key text,
  expense_type profitability_import_source NOT NULL,
  expense_category text NOT NULL,
  occurred_at timestamptz NOT NULL,
  currency_code text NOT NULL DEFAULT 'USD',
  cost_amount numeric(14, 2) NOT NULL DEFAULT 0,
  burden_units numeric(14, 2),
  vendor_reference text,
  shipment_reference text,
  job_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  account_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  original_job_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  season_id text,
  division_id text,
  location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS profitability_expense_entry_line_hash_uq
  ON profitability_expense_entry (tenant_id, import_run_id, source_line_hash);

CREATE INDEX IF NOT EXISTS profitability_expense_entry_job_idx
  ON profitability_expense_entry (tenant_id, job_id, occurred_at DESC)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS profitability_expense_entry_original_job_idx
  ON profitability_expense_entry (tenant_id, original_job_id, occurred_at DESC)
  WHERE original_job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS profitability_allocation_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  rule_name text NOT NULL,
  scope_type profitability_snapshot_scope NOT NULL,
  allocation_method profitability_allocation_method NOT NULL,
  dimension_key text,
  effective_from date NOT NULL,
  effective_to date,
  active_status boolean NOT NULL DEFAULT true,
  rule_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  updated_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profitability_allocation_rule_name_trimmed_chk CHECK (length(trim(rule_name)) >= 2),
  CONSTRAINT profitability_allocation_rule_effective_order_chk CHECK (
    effective_to IS NULL
    OR effective_to >= effective_from
  )
);

CREATE INDEX IF NOT EXISTS profitability_allocation_rule_active_idx
  ON profitability_allocation_rule (tenant_id, active_status, effective_from DESC);

CREATE TABLE IF NOT EXISTS profitability_allocation_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES profitability_allocation_rule(id) ON DELETE CASCADE,
  calculation_version_id uuid NOT NULL REFERENCES profitability_calculation_version(id) ON DELETE RESTRICT,
  date_range_start date NOT NULL,
  date_range_end date NOT NULL,
  requested_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  status profitability_import_run_status NOT NULL DEFAULT 'queued',
  allocation_output jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profitability_allocation_run_date_order_chk CHECK (
    date_range_end >= date_range_start
  )
);

CREATE INDEX IF NOT EXISTS profitability_allocation_run_rule_idx
  ON profitability_allocation_run (tenant_id, rule_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS profitability_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  snapshot_scope profitability_snapshot_scope NOT NULL,
  scope_id text NOT NULL,
  scope_label text,
  job_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  account_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  season_id text,
  division_id text,
  staff_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  calculation_version_id uuid NOT NULL REFERENCES profitability_calculation_version(id) ON DELETE RESTRICT,
  snapshot_status profitability_snapshot_status NOT NULL DEFAULT 'pending',
  source_window_start date,
  source_window_end date,
  captured_at timestamptz NOT NULL DEFAULT now(),
  stale_marked_at timestamptz,
  stale_reason text,
  stale_source_events jsonb NOT NULL DEFAULT '[]'::jsonb,
  metric_values jsonb NOT NULL DEFAULT '[]'::jsonb,
  lineage_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  override_count integer NOT NULL DEFAULT 0,
  recommendation_count integer NOT NULL DEFAULT 0,
  coaching_flag_count integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profitability_snapshot_scope_id_trimmed_chk CHECK (length(trim(scope_id)) >= 1),
  CONSTRAINT profitability_snapshot_window_order_chk CHECK (
    source_window_end IS NULL
    OR source_window_start IS NULL
    OR source_window_end >= source_window_start
  )
);

CREATE INDEX IF NOT EXISTS profitability_snapshot_scope_idx
  ON profitability_snapshot (tenant_id, snapshot_scope, scope_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS profitability_snapshot_status_idx
  ON profitability_snapshot (tenant_id, snapshot_status, captured_at DESC);

CREATE TABLE IF NOT EXISTS profitability_override (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  target_scope profitability_snapshot_scope NOT NULL,
  target_id text NOT NULL,
  snapshot_id uuid REFERENCES profitability_snapshot(id) ON DELETE SET NULL,
  calculation_version_id uuid REFERENCES profitability_calculation_version(id) ON DELETE SET NULL,
  override_type profitability_override_type NOT NULL,
  reason text NOT NULL,
  previous_value jsonb,
  override_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  reverted_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  revert_reason text,
  CONSTRAINT profitability_override_target_id_trimmed_chk CHECK (length(trim(target_id)) >= 1)
);

CREATE INDEX IF NOT EXISTS profitability_override_target_idx
  ON profitability_override (tenant_id, target_scope, target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS profitability_coaching_flag (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES profitability_snapshot(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  job_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  flag_type text NOT NULL,
  severity profitability_flag_severity NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  signal_key text NOT NULL,
  signal_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS profitability_coaching_flag_staff_idx
  ON profitability_coaching_flag (tenant_id, staff_id, created_at DESC);

CREATE TABLE IF NOT EXISTS profitability_recommendation_flag (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES profitability_snapshot(id) ON DELETE CASCADE,
  scope_type profitability_snapshot_scope NOT NULL,
  scope_id text NOT NULL,
  recommendation_type text NOT NULL,
  severity profitability_flag_severity NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  driver_metrics jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  dismissed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS profitability_recommendation_flag_scope_idx
  ON profitability_recommendation_flag (tenant_id, scope_type, scope_id, created_at DESC);

CREATE TABLE IF NOT EXISTS profitability_dashboard_metric_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  audience profitability_dashboard_audience NOT NULL,
  metric_key text NOT NULL,
  scope_type profitability_snapshot_scope NOT NULL,
  scope_id text NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES profitability_snapshot(id) ON DELETE CASCADE,
  metric_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profitability_dashboard_metric_snapshot_lookup_idx
  ON profitability_dashboard_metric_snapshot (
    tenant_id,
    audience,
    metric_key,
    scope_type,
    scope_id,
    captured_at DESC
  );

DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'profitability_calculation_version',
    'profitability_import_run',
    'profitability_import_validation_issue',
    'profitability_source_mapping',
    'profitability_revenue_entry',
    'profitability_expense_entry',
    'profitability_allocation_rule',
    'profitability_allocation_run',
    'profitability_snapshot',
    'profitability_override',
    'profitability_coaching_flag',
    'profitability_recommendation_flag',
    'profitability_dashboard_metric_snapshot'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);

    policy_name := format('tenant_isolation_%s', table_name);

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = table_name
        AND policyname = policy_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
        policy_name,
        table_name
      );
    END IF;
  END LOOP;
END $$;
