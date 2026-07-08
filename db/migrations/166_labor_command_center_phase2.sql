-- Labor Command Center Phase 2 — business-rule alignment.
-- (1) Bi-weekly configurable payroll calendar (close rule + self-check window are
--     tenant config because the exact close rule is not yet verified with the owner).
-- (2) owner_review lifecycle status: the owner (Matthew) must give final approval
--     before locked time can be sent to QuickBooks. Mission Control never runs
--     payroll — QuickBooks Online owns payroll execution.
-- (3) Pay codes: at least two pay rates exist, so hours carry a Mission Control pay
--     code; QuickBooks sync maps pay codes to QuickBooks pay types.
-- (4) No-break claims can record "manager approved no break".
-- (5) Overtime warnings gain a manager-approval outcome and a 38h company warning
--     threshold distinct from the legal overtime threshold; jurisdiction column is
--     the state-specific policy hook (one employee works out of state).
-- (6) payroll_alert operational-alert type so payroll alerts can route to Teams via
--     the existing Teams webhook governance (migration 110 pipeline).
-- Additive and reversible by inspection; text + CHECK style throughout.

-- ---------------------------------------------------------------------------
-- 1. Payroll calendar configuration (bi-weekly default; close rule configurable).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_calendar_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  period_length_days integer NOT NULL DEFAULT 14,
  -- Anchor date some real period started on; every period boundary is derived from
  -- this by modular arithmetic. NEEDS BUSINESS VERIFICATION with the owner.
  reference_period_start date NOT NULL DEFAULT '2026-06-29',
  -- Payroll close = (day after period_end at 00:00 local) + close_offset_hours.
  -- Default 60h = Tuesday 12:00 after a Sunday period end. NEEDS BUSINESS VERIFICATION.
  close_offset_hours integer NOT NULL DEFAULT 60,
  -- Self-check window opens this many hours before payroll close (default 24h).
  self_check_window_hours integer NOT NULL DEFAULT 24,
  -- Travel/pay policy knobs (e.g. post-session travel payable, part-time drive-time
  -- rules). Structured config, surfaced for payroll review — not silently applied.
  travel_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_calendar_period_length_check CHECK (period_length_days BETWEEN 7 AND 31),
  CONSTRAINT payroll_calendar_offsets_check CHECK (close_offset_hours >= 0 AND self_check_window_hours BETWEEN 1 AND 168)
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_calendar_config_tenant_idx
  ON payroll_calendar_config (tenant_id);

-- ---------------------------------------------------------------------------
-- 2. owner_review status in the pay-period lifecycle.
-- ---------------------------------------------------------------------------
ALTER TABLE payroll_period DROP CONSTRAINT IF EXISTS payroll_period_status_check;
ALTER TABLE payroll_period ADD CONSTRAINT payroll_period_status_check CHECK (status IN (
  'open', 'self_check_open', 'manager_review', 'payroll_review', 'owner_review',
  'locked', 'exported', 'synced', 'correction_needed'
));
ALTER TABLE payroll_period
  ADD COLUMN IF NOT EXISTS owner_reviewed_at timestamptz;
ALTER TABLE payroll_period
  ADD COLUMN IF NOT EXISTS owner_reviewed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 3. Pay codes — catalog + per-segment assignment + QuickBooks pay-type mapping.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_code (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  description text,
  -- payable_default false => hours under this code are held for payroll review
  -- rather than assumed payable (e.g. part-time pre-shoot drive time).
  payable_default boolean NOT NULL DEFAULT true,
  requires_review boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  active_status boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pay_code_tenant_code_idx
  ON pay_code (tenant_id, code);

INSERT INTO pay_code (tenant_id, code, label, description, payable_default, requires_review, sort_order)
SELECT t.id, seed.code, seed.label, seed.description, seed.payable_default, seed.requires_review, seed.sort_order
FROM tenant t
CROSS JOIN (
  VALUES
    ('session_labor', 'Shoot / Session Labor', 'On-site photography and session work.', true, false, 10),
    ('travel_post_session', 'Post-Session Travel', 'Travel after a session; payability follows the configurable travel policy and is highlighted for payroll review.', true, true, 20),
    ('travel_pre_session', 'Pre-Session Travel', 'Drive time to a shoot. Not payable for part-time staff without a manager/payroll override.', false, true, 25),
    ('studio_admin', 'Studio / Admin / Production', 'Studio, office, admin, and production time.', true, false, 30),
    ('training_meeting', 'Training / Meeting', 'Training sessions and meetings.', true, false, 40),
    ('manager_adjustment', 'Manager Adjustment', 'Time added or corrected by a manager/leadership adjustment.', true, true, 50),
    ('no_break_adjustment', 'No-Break Adjustment', 'Break repayment when an auto-deducted break was not taken.', true, true, 60),
    ('overtime_candidate', 'Overtime Candidate', 'Hours past the weekly overtime threshold, pending payroll classification.', true, true, 70)
) AS seed(code, label, description, payable_default, requires_review, sort_order)
ON CONFLICT DO NOTHING;

ALTER TABLE time_segment
  ADD COLUMN IF NOT EXISTS pay_code text;

-- QuickBooks pay-type mapping is now keyed by Mission Control pay code. The phase-1
-- category column stays for aggregate-level exports but is no longer required.
ALTER TABLE quickbooks_pay_type_mapping DROP CONSTRAINT IF EXISTS quickbooks_pay_type_category_check;
ALTER TABLE quickbooks_pay_type_mapping ALTER COLUMN pay_category DROP NOT NULL;
ALTER TABLE quickbooks_pay_type_mapping
  ADD COLUMN IF NOT EXISTS pay_code text;
ALTER TABLE quickbooks_pay_type_mapping ADD CONSTRAINT quickbooks_pay_type_target_check CHECK (
  pay_code IS NOT NULL OR pay_category IS NOT NULL
);
ALTER TABLE quickbooks_pay_type_mapping ADD CONSTRAINT quickbooks_pay_type_category_value_check CHECK (
  pay_category IS NULL OR pay_category IN ('regular_office_drive', 'regular_photography', 'overtime', 'mileage_reimbursement')
);

CREATE UNIQUE INDEX IF NOT EXISTS quickbooks_pay_type_mapping_pay_code_idx
  ON quickbooks_pay_type_mapping (tenant_id, pay_code)
  WHERE active_status = true AND pay_code IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. No-break claims: record whether the employee says a manager approved it.
-- ---------------------------------------------------------------------------
ALTER TABLE payroll_self_check_item
  ADD COLUMN IF NOT EXISTS manager_approved_claimed boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 5. Overtime: manager approval outcome + 38h company warning + jurisdiction hook.
-- ---------------------------------------------------------------------------
ALTER TABLE overtime_warning DROP CONSTRAINT IF EXISTS overtime_warning_status_check;
ALTER TABLE overtime_warning ADD CONSTRAINT overtime_warning_status_check CHECK (
  status IN ('active', 'acknowledged', 'approved', 'resolved')
);

ALTER TABLE overtime_policy
  ADD COLUMN IF NOT EXISTS company_warning_threshold_minutes integer NOT NULL DEFAULT 2280;
ALTER TABLE overtime_policy
  ADD COLUMN IF NOT EXISTS jurisdiction text;
ALTER TABLE overtime_policy ADD CONSTRAINT overtime_policy_company_warning_check CHECK (
  company_warning_threshold_minutes > 0
);

-- ---------------------------------------------------------------------------
-- 6. Teams routing: payroll alerts join the operational alert pipeline.
--    (New enum value only; not referenced elsewhere in this migration.)
-- ---------------------------------------------------------------------------
ALTER TYPE operational_alert_type ADD VALUE IF NOT EXISTS 'payroll_alert';

DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['payroll_calendar_config', 'pay_code'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I ON %I', target, target);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_%I ON %I USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      target, target
    );
  END LOOP;
END $$;
