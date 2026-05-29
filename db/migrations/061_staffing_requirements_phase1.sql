ALTER TABLE staffing_template
  ADD COLUMN minimum_staff_count integer NOT NULL DEFAULT 0;

UPDATE staffing_template
SET minimum_staff_count = planned_staff_count
WHERE minimum_staff_count = 0;

ALTER TABLE staffing_template_role
  ADD COLUMN minimum_count integer NOT NULL DEFAULT 1,
  ADD COLUMN ideal_count integer NOT NULL DEFAULT 1,
  ADD COLUMN required_for_ready boolean NOT NULL DEFAULT true,
  ADD COLUMN lead_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN lead_required boolean NOT NULL DEFAULT false,
  ADD COLUMN call_offset_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN start_offset_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN end_offset_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN location_name_override text,
  ADD COLUMN location_address_override text,
  ADD COLUMN required_qualification_tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN role_notes text;

UPDATE staffing_template_role
SET minimum_count = headcount,
    ideal_count = headcount,
    required_for_ready = true,
    lead_eligible = satisfies_lead_coverage,
    lead_required = satisfies_lead_coverage;

ALTER TABLE shoot
  ADD COLUMN minimum_staff_count integer NOT NULL DEFAULT 0;

UPDATE shoot
SET minimum_staff_count = planned_staff_count
WHERE minimum_staff_count = 0;

CREATE TABLE shoot_staffing_requirement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  source_of_creation text NOT NULL DEFAULT 'manual_from_shoot',
  source_template_role_id uuid REFERENCES staffing_template_role(id) ON DELETE SET NULL,
  copied_from_requirement_id uuid REFERENCES shoot_staffing_requirement(id) ON DELETE SET NULL,
  staffing_role staffing_role_code NOT NULL DEFAULT 'photographer',
  label text NOT NULL,
  minimum_count integer NOT NULL DEFAULT 1,
  ideal_count integer NOT NULL DEFAULT 1,
  required_for_ready boolean NOT NULL DEFAULT true,
  lead_eligible boolean NOT NULL DEFAULT false,
  lead_required boolean NOT NULL DEFAULT false,
  call_offset_minutes integer NOT NULL DEFAULT 0,
  start_offset_minutes integer NOT NULL DEFAULT 0,
  end_offset_minutes integer NOT NULL DEFAULT 0,
  location_name_override text,
  location_address_override text,
  required_qualification_tags text[] NOT NULL DEFAULT '{}'::text[],
  role_notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (minimum_count >= 0),
  CHECK (ideal_count >= minimum_count)
);

ALTER TABLE work_shift
  ADD COLUMN staffing_requirement_id uuid REFERENCES shoot_staffing_requirement(id) ON DELETE SET NULL,
  ADD COLUMN assignment_source text NOT NULL DEFAULT 'manual_from_shoot',
  ADD COLUMN reassignment_history jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX shoot_staffing_requirement_tenant_shoot_idx
  ON shoot_staffing_requirement (tenant_id, shoot_id, sort_order, created_at);

CREATE INDEX work_shift_staffing_requirement_idx
  ON work_shift (tenant_id, staffing_requirement_id, starts_at);
