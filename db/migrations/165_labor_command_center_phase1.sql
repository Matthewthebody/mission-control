-- Labor Command Center Phase 1 — canonical pay-period lifecycle, configurable overtime
-- policy + persisted warnings, employee payroll self-check attestation, and QuickBooks
-- export scaffolding. Mission Control owns operational labor truth only: no paycheck
-- calculation, tax logic, or payroll execution lives here — QuickBooks (later phase)
-- owns final payroll. Design mirrors existing canonical patterns: text + CHECK instead
-- of enums (163/164 style), append-only *_event logs for every lifecycle transition,
-- reminder cooldown columns (157 style), additive ALTERs only, RLS forced on every new
-- table. Purely additive and reversible by inspection (DROP TABLE / DROP COLUMN).

-- ---------------------------------------------------------------------------
-- 1. Canonical pay period entity. Until now pay periods were ad-hoc Monday–Sunday
--    windows computed per request (timeClockPayroll.getPayPeriod). This gives the
--    period a durable identity, a lifecycle, and a lock.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_period (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'open',
  -- planned lock moment drives the self-check window (opens 3 days before) and the
  -- 72/48/24/morning-of reminder schedule.
  lock_scheduled_at timestamptz,
  self_check_opened_at timestamptz,
  locked_at timestamptz,
  locked_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  exported_at timestamptz,
  exported_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  synced_at timestamptz,
  correction_reason text,
  -- reminder cooldown tracking (157 precedent): highest stage already sent.
  last_reminder_stage text,
  last_reminder_at timestamptz,
  reminder_count integer NOT NULL DEFAULT 0,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_period_range_check CHECK (period_end >= period_start),
  CONSTRAINT payroll_period_status_check CHECK (status IN (
    'open', 'self_check_open', 'manager_review', 'payroll_review',
    'locked', 'exported', 'synced', 'correction_needed'
  )),
  CONSTRAINT payroll_period_reminder_stage_check CHECK (
    last_reminder_stage IS NULL OR last_reminder_stage IN ('hours_72', 'hours_48', 'hours_24', 'morning_of')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_period_window_idx
  ON payroll_period (tenant_id, period_start, period_end);

CREATE INDEX IF NOT EXISTS payroll_period_status_idx
  ON payroll_period (tenant_id, status, period_end);

-- Append-only lifecycle log: every transition, reminder, lock, export, and correction
-- records actor + before/after. The period row is never the audit trail.
CREATE TABLE IF NOT EXISTS payroll_period_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  period_id uuid NOT NULL REFERENCES payroll_period(id) ON DELETE CASCADE,
  event_type text NOT NULL, -- created | transition | reminder | lock | unlock | export | sync | correction
  from_status text,
  to_status text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payroll_period_event_period_idx
  ON payroll_period_event (tenant_id, period_id, created_at);

-- Sessions gain a durable link to their pay period plus the honest post-lock edit flag.
ALTER TABLE time_session
  ADD COLUMN IF NOT EXISTS payroll_period_id uuid REFERENCES payroll_period(id) ON DELETE SET NULL;
ALTER TABLE time_session
  ADD COLUMN IF NOT EXISTS edited_after_payroll_review boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS time_session_payroll_period_idx
  ON time_session (tenant_id, payroll_period_id)
  WHERE payroll_period_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Configurable overtime policy. Replaces the hard-coded weekly-over-40 rule with
--    tenant-default / department / employee layers. Resolution order at read time:
--    employee > department > tenant_default > built-in weekly-over-40 fallback.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS overtime_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  scope_type text NOT NULL DEFAULT 'tenant_default',
  department department_code,
  employee_id uuid REFERENCES app_user(id) ON DELETE CASCADE,
  -- 0 = Sunday … 6 = Saturday. Default Monday matches existing week bounds.
  workweek_start_dow smallint NOT NULL DEFAULT 1,
  weekly_overtime_threshold_minutes integer NOT NULL DEFAULT 2400,
  daily_overtime_threshold_minutes integer,
  -- warn when projected/actual hours are within this many minutes of the threshold.
  warn_approaching_minutes integer NOT NULL DEFAULT 120,
  exempt_from_overtime boolean NOT NULL DEFAULT false,
  active_status boolean NOT NULL DEFAULT true,
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT overtime_policy_scope_check CHECK (scope_type IN ('tenant_default', 'department', 'employee')),
  CONSTRAINT overtime_policy_scope_target_check CHECK (
    (scope_type = 'tenant_default' AND department IS NULL AND employee_id IS NULL) OR
    (scope_type = 'department' AND department IS NOT NULL AND employee_id IS NULL) OR
    (scope_type = 'employee' AND employee_id IS NOT NULL)
  ),
  CONSTRAINT overtime_policy_workweek_check CHECK (workweek_start_dow BETWEEN 0 AND 6),
  CONSTRAINT overtime_policy_threshold_check CHECK (
    weekly_overtime_threshold_minutes > 0 AND
    (daily_overtime_threshold_minutes IS NULL OR daily_overtime_threshold_minutes > 0) AND
    warn_approaching_minutes >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS overtime_policy_active_tenant_default_idx
  ON overtime_policy (tenant_id)
  WHERE scope_type = 'tenant_default' AND active_status = true;

CREATE UNIQUE INDEX IF NOT EXISTS overtime_policy_active_department_idx
  ON overtime_policy (tenant_id, department)
  WHERE scope_type = 'department' AND active_status = true;

CREATE UNIQUE INDEX IF NOT EXISTS overtime_policy_active_employee_idx
  ON overtime_policy (tenant_id, employee_id)
  WHERE scope_type = 'employee' AND active_status = true;

-- Persisted overtime warnings so managers/payroll/leadership see the same live truth
-- and notifications dedupe. One active row per employee + workweek + warning type
-- (compliance-flag dedupe precedent, migration 039).
CREATE TABLE IF NOT EXISTS overtime_warning (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  workweek_start date NOT NULL,
  warning_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  status text NOT NULL DEFAULT 'active',
  actual_minutes integer NOT NULL DEFAULT 0,
  projected_minutes integer NOT NULL DEFAULT 0,
  threshold_minutes integer NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_evaluated_at timestamptz NOT NULL DEFAULT now(),
  last_notified_at timestamptz,
  acknowledged_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT overtime_warning_type_check CHECK (warning_type IN (
    'approaching_overtime', 'projected_overtime', 'in_overtime',
    'unscheduled_overtime_risk', 'long_active_session', 'schedule_conflict_overtime'
  )),
  CONSTRAINT overtime_warning_severity_check CHECK (severity IN ('info', 'warning', 'critical')),
  CONSTRAINT overtime_warning_status_check CHECK (status IN ('active', 'acknowledged', 'resolved'))
);

CREATE UNIQUE INDEX IF NOT EXISTS overtime_warning_active_dedupe_idx
  ON overtime_warning (tenant_id, employee_id, workweek_start, warning_type)
  WHERE status <> 'resolved';

CREATE INDEX IF NOT EXISTS overtime_warning_active_idx
  ON overtime_warning (tenant_id, status, workweek_start);

-- ---------------------------------------------------------------------------
-- 3. Payroll self-check: one attestation row per employee per period, plus per-day
--    responses. A discrepancy response never edits time directly — it links to the
--    exception_request it spawned (corrections stay in the canonical approval path).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_self_check (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  payroll_period_id uuid NOT NULL REFERENCES payroll_period(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  confirmed_at timestamptz,
  last_reminder_stage text,
  last_reminder_at timestamptz,
  reminder_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_self_check_status_check CHECK (status IN ('pending', 'confirmed', 'discrepancy_reported')),
  CONSTRAINT payroll_self_check_reminder_stage_check CHECK (
    last_reminder_stage IS NULL OR last_reminder_stage IN ('hours_72', 'hours_48', 'hours_24', 'morning_of')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_self_check_employee_period_idx
  ON payroll_self_check (tenant_id, payroll_period_id, employee_id);

CREATE TABLE IF NOT EXISTS payroll_self_check_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  self_check_id uuid NOT NULL REFERENCES payroll_self_check(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  session_id uuid REFERENCES time_session(id) ON DELETE SET NULL,
  response text NOT NULL,
  note text,
  linked_exception_request_id uuid REFERENCES exception_request(id) ON DELETE SET NULL,
  resolution_status text NOT NULL DEFAULT 'open',
  resolved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_self_check_item_response_check CHECK (response IN (
    'looks_correct', 'something_wrong', 'missing_punch',
    'no_break_taken', 'wrong_job_location', 'worked_extra_time'
  )),
  CONSTRAINT payroll_self_check_item_resolution_check CHECK (resolution_status IN ('open', 'resolved', 'dismissed'))
);

-- Idempotent per day + response type (retry-safe employee submits).
CREATE UNIQUE INDEX IF NOT EXISTS payroll_self_check_item_dedupe_idx
  ON payroll_self_check_item (tenant_id, self_check_id, work_date, response);

CREATE INDEX IF NOT EXISTS payroll_self_check_item_open_idx
  ON payroll_self_check_item (tenant_id, resolution_status)
  WHERE resolution_status = 'open';

-- ---------------------------------------------------------------------------
-- 4. QuickBooks integration scaffolding. Boundary contract: Mission Control exports
--    approved, locked operational labor totals; QuickBooks owns payroll execution.
--    No credentials are stored in this phase — quickbooks_connection is a config
--    placeholder so the UI can show honest not-connected state.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quickbooks_connection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  environment text NOT NULL DEFAULT 'sandbox',
  realm_id text,
  connection_status text NOT NULL DEFAULT 'not_connected',
  last_connected_at timestamptz,
  last_error text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quickbooks_connection_environment_check CHECK (environment IN ('sandbox', 'production')),
  CONSTRAINT quickbooks_connection_status_check CHECK (connection_status IN ('not_connected', 'connected', 'error', 'expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS quickbooks_connection_tenant_idx
  ON quickbooks_connection (tenant_id);

CREATE TABLE IF NOT EXISTS quickbooks_employee_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  quickbooks_employee_id text NOT NULL,
  quickbooks_display_name text,
  active_status boolean NOT NULL DEFAULT true,
  sync_status text NOT NULL DEFAULT 'mapped',
  last_synced_at timestamptz,
  sync_error text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quickbooks_employee_mapping_status_check CHECK (sync_status IN ('unmapped', 'mapped', 'error'))
);

CREATE UNIQUE INDEX IF NOT EXISTS quickbooks_employee_mapping_employee_idx
  ON quickbooks_employee_mapping (tenant_id, employee_id)
  WHERE active_status = true;

CREATE UNIQUE INDEX IF NOT EXISTS quickbooks_employee_mapping_qb_idx
  ON quickbooks_employee_mapping (tenant_id, quickbooks_employee_id)
  WHERE active_status = true;

CREATE TABLE IF NOT EXISTS quickbooks_pay_type_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  pay_category text NOT NULL,
  quickbooks_pay_item text NOT NULL,
  quickbooks_pay_item_id text,
  active_status boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quickbooks_pay_type_category_check CHECK (pay_category IN (
    'regular_office_drive', 'regular_photography', 'overtime', 'mileage_reimbursement'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS quickbooks_pay_type_mapping_category_idx
  ON quickbooks_pay_type_mapping (tenant_id, pay_category)
  WHERE active_status = true;

-- Every export produces a durable batch record (CSV in this phase; API later).
CREATE TABLE IF NOT EXISTS payroll_export_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  payroll_period_id uuid NOT NULL REFERENCES payroll_period(id) ON DELETE CASCADE,
  export_kind text NOT NULL DEFAULT 'csv',
  status text NOT NULL DEFAULT 'generated',
  row_count integer NOT NULL DEFAULT 0,
  total_regular_minutes integer NOT NULL DEFAULT 0,
  total_overtime_minutes integer NOT NULL DEFAULT 0,
  total_mileage_amount numeric(10,2) NOT NULL DEFAULT 0,
  file_name text,
  generated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT payroll_export_batch_kind_check CHECK (export_kind IN ('csv', 'quickbooks_api')),
  CONSTRAINT payroll_export_batch_status_check CHECK (status IN ('generated', 'downloaded', 'failed', 'superseded'))
);

CREATE INDEX IF NOT EXISTS payroll_export_batch_period_idx
  ON payroll_export_batch (tenant_id, payroll_period_id, generated_at);

-- Per-attempt sync log with duplicate prevention on the QuickBooks TimeActivity id.
CREATE TABLE IF NOT EXISTS quickbooks_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES payroll_export_batch(id) ON DELETE SET NULL,
  payroll_period_id uuid REFERENCES payroll_period(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  quickbooks_time_activity_id text,
  sync_status text NOT NULL DEFAULT 'pending',
  sync_error text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT quickbooks_sync_log_status_check CHECK (sync_status IN ('pending', 'success', 'error', 'skipped_duplicate'))
);

CREATE UNIQUE INDEX IF NOT EXISTS quickbooks_sync_log_time_activity_idx
  ON quickbooks_sync_log (tenant_id, quickbooks_time_activity_id)
  WHERE quickbooks_time_activity_id IS NOT NULL AND sync_status = 'success';

-- Aggregate rows gain future-sync bookkeeping (additive; unused until QB API phase).
ALTER TABLE payroll_export_aggregate
  ADD COLUMN IF NOT EXISTS quickbooks_sync_status text;
ALTER TABLE payroll_export_aggregate
  ADD COLUMN IF NOT EXISTS quickbooks_time_activity_id text;
ALTER TABLE payroll_export_aggregate
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE payroll_export_aggregate
  ADD COLUMN IF NOT EXISTS sync_error text;

DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'payroll_period',
    'payroll_period_event',
    'overtime_policy',
    'overtime_warning',
    'payroll_self_check',
    'payroll_self_check_item',
    'quickbooks_connection',
    'quickbooks_employee_mapping',
    'quickbooks_pay_type_mapping',
    'payroll_export_batch',
    'quickbooks_sync_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I ON %I', target, target);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_%I ON %I USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      target, target
    );
  END LOOP;
END $$;
