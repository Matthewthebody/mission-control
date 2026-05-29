DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lunch_deduction_source') THEN
    CREATE TYPE lunch_deduction_source AS ENUM (
      'not_applicable',
      'auto_deducted',
      'challenge_pending',
      'challenge_approved',
      'challenge_rejected',
      'manual_override'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payroll_export_aggregate_status') THEN
    CREATE TYPE payroll_export_aggregate_status AS ENUM (
      'draft',
      'ready',
      'exported'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS time_session_payroll_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES time_session(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  office_drive_minutes integer NOT NULL DEFAULT 0,
  photography_minutes integer NOT NULL DEFAULT 0,
  total_worked_minutes integer NOT NULL DEFAULT 0,
  lunch_deduction_minutes integer NOT NULL DEFAULT 0,
  lunch_deduction_source lunch_deduction_source NOT NULL DEFAULT 'not_applicable',
  lunch_challenge_request_id uuid REFERENCES exception_request(id) ON DELETE SET NULL,
  lunch_challenge_status exception_request_status,
  payable_minutes integer NOT NULL DEFAULT 0,
  manual_correction_count integer NOT NULL DEFAULT 0,
  missed_clock_in_approval_count integer NOT NULL DEFAULT 0,
  exception_request_count integer NOT NULL DEFAULT 0,
  approval_record_count integer NOT NULL DEFAULT 0,
  reporting_flags text[] NOT NULL DEFAULT '{}'::text[],
  generated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, session_id)
);

CREATE TABLE IF NOT EXISTS payroll_export_aggregate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  pay_period_start date NOT NULL,
  pay_period_end date NOT NULL,
  regular_office_drive_minutes integer NOT NULL DEFAULT 0,
  regular_photography_minutes integer NOT NULL DEFAULT 0,
  overtime_minutes integer NOT NULL DEFAULT 0,
  overtime_base_rate numeric(10,2),
  overtime_rate numeric(10,2),
  lunch_deduction_minutes integer NOT NULL DEFAULT 0,
  manual_correction_count integer NOT NULL DEFAULT 0,
  missed_clock_in_approval_count integer NOT NULL DEFAULT 0,
  mileage_reimbursement_amount numeric(10,2) NOT NULL DEFAULT 0,
  exception_request_count integer NOT NULL DEFAULT 0,
  approval_record_count integer NOT NULL DEFAULT 0,
  exception_flags text[] NOT NULL DEFAULT '{}'::text[],
  approval_flags text[] NOT NULL DEFAULT '{}'::text[],
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  status payroll_export_aggregate_status NOT NULL DEFAULT 'draft',
  generated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, pay_period_start, pay_period_end),
  CHECK (pay_period_end >= pay_period_start)
);

CREATE TABLE IF NOT EXISTS payroll_export_aggregate_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  aggregate_id uuid NOT NULL REFERENCES payroll_export_aggregate(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES time_session(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  office_drive_minutes integer NOT NULL DEFAULT 0,
  photography_minutes integer NOT NULL DEFAULT 0,
  total_worked_minutes integer NOT NULL DEFAULT 0,
  lunch_deduction_minutes integer NOT NULL DEFAULT 0,
  payable_minutes integer NOT NULL DEFAULT 0,
  regular_office_drive_minutes integer NOT NULL DEFAULT 0,
  regular_photography_minutes integer NOT NULL DEFAULT 0,
  overtime_minutes integer NOT NULL DEFAULT 0,
  manual_correction_count integer NOT NULL DEFAULT 0,
  missed_clock_in_approval_count integer NOT NULL DEFAULT 0,
  reporting_flags text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aggregate_id, session_id)
);

CREATE INDEX IF NOT EXISTS time_session_payroll_summary_employee_idx
  ON time_session_payroll_summary (tenant_id, employee_id, work_date DESC);

CREATE INDEX IF NOT EXISTS time_session_payroll_summary_challenge_idx
  ON time_session_payroll_summary (tenant_id, lunch_challenge_request_id)
  WHERE lunch_challenge_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payroll_export_aggregate_employee_period_idx
  ON payroll_export_aggregate (tenant_id, employee_id, pay_period_start DESC, pay_period_end DESC);

CREATE INDEX IF NOT EXISTS payroll_export_aggregate_status_idx
  ON payroll_export_aggregate (tenant_id, status, pay_period_start DESC, pay_period_end DESC);

CREATE INDEX IF NOT EXISTS payroll_export_aggregate_session_aggregate_idx
  ON payroll_export_aggregate_session (tenant_id, aggregate_id, work_date ASC);

ALTER TABLE time_session_payroll_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_export_aggregate ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_export_aggregate_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_session_payroll_summary FORCE ROW LEVEL SECURITY;
ALTER TABLE payroll_export_aggregate FORCE ROW LEVEL SECURITY;
ALTER TABLE payroll_export_aggregate_session FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'time_session_payroll_summary'
      AND policyname = 'tenant_isolation_time_session_payroll_summary'
  ) THEN
    CREATE POLICY tenant_isolation_time_session_payroll_summary ON time_session_payroll_summary
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payroll_export_aggregate'
      AND policyname = 'tenant_isolation_payroll_export_aggregate'
  ) THEN
    CREATE POLICY tenant_isolation_payroll_export_aggregate ON payroll_export_aggregate
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payroll_export_aggregate_session'
      AND policyname = 'tenant_isolation_payroll_export_aggregate_session'
  ) THEN
    CREATE POLICY tenant_isolation_payroll_export_aggregate_session ON payroll_export_aggregate_session
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
