ALTER TABLE shoot_sports_detail
  ADD COLUMN IF NOT EXISTS league_name text,
  ADD COLUMN IF NOT EXISTS division text,
  ADD COLUMN IF NOT EXISTS team_structure text,
  ADD COLUMN IF NOT EXISTS is_multi_day boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS weather_sensitive boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS indoor_outdoor text,
  ADD COLUMN IF NOT EXISTS roster_source text,
  ADD COLUMN IF NOT EXISTS proof_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS proof_due_date date,
  ADD COLUMN IF NOT EXISTS approval_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS billing_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revenue_share_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revenue_share_terms_summary text,
  ADD COLUMN IF NOT EXISTS banner_work_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS buddy_photo_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sponsor_graphics_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS senior_banner_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gear_package_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS schedule_file_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS travel_notes text,
  ADD COLUMN IF NOT EXISTS parking_notes text,
  ADD COLUMN IF NOT EXISTS access_notes text,
  ADD COLUMN IF NOT EXISTS setup_notes text,
  ADD COLUMN IF NOT EXISTS client_expectations_notes text,
  ADD COLUMN IF NOT EXISTS post_shoot_eval_summary text;

ALTER TABLE shoot_readiness_item
  ADD COLUMN IF NOT EXISTS section text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shoot_readiness_item_sort_order_nonnegative_chk'
  ) THEN
    ALTER TABLE shoot_readiness_item
      ADD CONSTRAINT shoot_readiness_item_sort_order_nonnegative_chk
      CHECK (sort_order >= 0)
      NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sports_team_unit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  team_name text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  age_group text,
  division text,
  coach_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  proof_owner_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  scheduled_slot_start timestamptz,
  scheduled_slot_end timestamptz,
  estimated_subject_count integer,
  actual_subject_count integer,
  banner_required boolean NOT NULL DEFAULT false,
  specialty_notes text,
  status text NOT NULL DEFAULT 'planned',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (display_order >= 0),
  CHECK (estimated_subject_count IS NULL OR estimated_subject_count >= 0),
  CHECK (actual_subject_count IS NULL OR actual_subject_count >= 0),
  CHECK (scheduled_slot_end IS NULL OR scheduled_slot_start IS NULL OR scheduled_slot_end > scheduled_slot_start)
);

CREATE INDEX IF NOT EXISTS sports_team_unit_tenant_shoot_display_idx
  ON sports_team_unit (tenant_id, shoot_id, display_order, created_at);

CREATE TABLE IF NOT EXISTS sports_proof_cycle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  production_item_id uuid REFERENCES production_project(id) ON DELETE SET NULL,
  team_unit_id uuid REFERENCES sports_team_unit(id) ON DELETE SET NULL,
  approver_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'not_started',
  sent_at timestamptz,
  viewed_at timestamptz,
  approved_at timestamptz,
  revision_count integer NOT NULL DEFAULT 0,
  due_date date,
  last_follow_up_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (revision_count >= 0)
);

CREATE INDEX IF NOT EXISTS sports_proof_cycle_tenant_shoot_status_idx
  ON sports_proof_cycle (tenant_id, shoot_id, status, due_date);

CREATE TABLE IF NOT EXISTS sports_specialty_product_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  production_item_id uuid REFERENCES production_project(id) ON DELETE SET NULL,
  team_unit_id uuid REFERENCES sports_team_unit(id) ON DELETE SET NULL,
  product_type text NOT NULL,
  title text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'queued',
  approval_required boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  assigned_to_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  vendor_name text,
  due_date date,
  delivered_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (quantity >= 0)
);

CREATE INDEX IF NOT EXISTS sports_specialty_product_item_tenant_shoot_status_idx
  ON sports_specialty_product_item (tenant_id, shoot_id, status, due_date);

CREATE TABLE IF NOT EXISTS sports_financial_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  pricing_profile_name text,
  invoice_number text,
  invoice_status text NOT NULL DEFAULT 'pending',
  invoice_due_date date,
  revenue_share_enabled boolean NOT NULL DEFAULT false,
  revenue_share_terms_summary text,
  estimated_revenue numeric(12,2),
  actual_revenue numeric(12,2),
  estimated_cost numeric(12,2),
  actual_cost numeric(12,2),
  payout_amount numeric(12,2),
  payment_status text NOT NULL DEFAULT 'pending',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, shoot_id)
);

CREATE INDEX IF NOT EXISTS sports_financial_summary_tenant_invoice_idx
  ON sports_financial_summary (tenant_id, invoice_status, payment_status, invoice_due_date);

CREATE TABLE IF NOT EXISTS shoot_watch_flag (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  severity text NOT NULL,
  flag_type text NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open',
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shoot_watch_flag_tenant_status_due_idx
  ON shoot_watch_flag (tenant_id, status, due_at, created_at DESC);

CREATE INDEX IF NOT EXISTS shoot_watch_flag_tenant_shoot_status_idx
  ON shoot_watch_flag (tenant_id, shoot_id, status, severity);
