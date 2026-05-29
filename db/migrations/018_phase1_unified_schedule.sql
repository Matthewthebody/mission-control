CREATE TYPE staffing_role_code AS ENUM (
  'lead_photographer',
  'senior_photographer',
  'photographer',
  'support',
  'check_in',
  'assistant',
  'producer',
  'custom'
);

CREATE TYPE schedule_event_kind AS ENUM ('meeting', 'operations', 'travel', 'other');
CREATE TYPE schedule_event_status AS ENUM ('scheduled', 'tentative', 'cancelled', 'completed');
CREATE TYPE schedule_sync_state AS ENUM ('not_linked', 'pending_sync', 'in_sync', 'sync_warning', 'sync_error');

CREATE TABLE staffing_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  department department_code NOT NULL DEFAULT 'operations',
  name text NOT NULL,
  description text,
  planned_staff_count integer NOT NULL DEFAULT 0,
  required_lead_count integer NOT NULL DEFAULT 1,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, department, name)
);

CREATE TABLE staffing_template_role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  staffing_template_id uuid NOT NULL REFERENCES staffing_template(id) ON DELETE CASCADE,
  staffing_role staffing_role_code NOT NULL DEFAULT 'photographer',
  label text NOT NULL,
  headcount integer NOT NULL DEFAULT 1,
  satisfies_lead_coverage boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE shoot
  ADD COLUMN planned_staff_count integer NOT NULL DEFAULT 0,
  ADD COLUMN required_lead_count integer NOT NULL DEFAULT 1,
  ADD COLUMN staffing_template_id uuid REFERENCES staffing_template(id) ON DELETE SET NULL,
  ADD COLUMN schedule_sync_required boolean NOT NULL DEFAULT false,
  ADD COLUMN schedule_sync_state schedule_sync_state NOT NULL DEFAULT 'not_linked',
  ADD COLUMN schedule_last_synced_at timestamptz,
  ADD COLUMN schedule_last_error text;

ALTER TABLE work_shift
  ADD COLUMN staffing_role staffing_role_code NOT NULL DEFAULT 'photographer',
  ADD COLUMN satisfies_lead_coverage boolean NOT NULL DEFAULT false;

CREATE TABLE schedule_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  studio_id uuid REFERENCES studio(id) ON DELETE SET NULL,
  department department_code NOT NULL DEFAULT 'operations',
  event_kind schedule_event_kind NOT NULL DEFAULT 'meeting',
  status schedule_event_status NOT NULL DEFAULT 'scheduled',
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  location_name text NOT NULL DEFAULT '',
  location_address text NOT NULL DEFAULT '',
  location_lat double precision,
  location_lng double precision,
  navigation_url text,
  lead_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  notes text,
  source_system text NOT NULL DEFAULT 'mission_control',
  linked_shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  outlook_calendar_id text,
  outlook_event_id text,
  sync_required boolean NOT NULL DEFAULT false,
  sync_state schedule_sync_state NOT NULL DEFAULT 'not_linked',
  last_synced_at timestamptz,
  last_sync_error text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX schedule_event_tenant_outlook_event_uq
  ON schedule_event (tenant_id, outlook_calendar_id, outlook_event_id)
  WHERE outlook_event_id IS NOT NULL;

CREATE INDEX staffing_template_tenant_department_idx
  ON staffing_template (tenant_id, department, created_at DESC);

CREATE INDEX staffing_template_role_tenant_template_idx
  ON staffing_template_role (tenant_id, staffing_template_id, sort_order);

CREATE INDEX shoot_tenant_schedule_sync_idx
  ON shoot (tenant_id, schedule_sync_state, shoot_date);

CREATE INDEX work_shift_tenant_staffing_role_idx
  ON work_shift (tenant_id, staffing_role, starts_at);

CREATE INDEX schedule_event_tenant_starts_idx
  ON schedule_event (tenant_id, starts_at, department);

CREATE INDEX schedule_event_tenant_linked_shoot_idx
  ON schedule_event (tenant_id, linked_shoot_id, starts_at);

UPDATE work_shift ws
SET staffing_role = CASE
      WHEN EXISTS (
        SELECT 1
        FROM user_job_function_profile ujp
        WHERE ujp.tenant_id = ws.tenant_id
          AND ujp.user_id = ws.assigned_user_id
          AND ujp.job_function_profile = 'senior_photographer'
      ) THEN 'senior_photographer'::staffing_role_code
      WHEN ws.title ILIKE '%lead%' THEN 'lead_photographer'::staffing_role_code
      WHEN ws.title ILIKE '%check-in%' THEN 'check_in'::staffing_role_code
      WHEN ws.title ILIKE '%support%' THEN 'support'::staffing_role_code
      ELSE 'photographer'::staffing_role_code
    END,
    satisfies_lead_coverage = CASE
      WHEN EXISTS (
        SELECT 1
        FROM user_job_function_profile ujp
        WHERE ujp.tenant_id = ws.tenant_id
          AND ujp.user_id = ws.assigned_user_id
          AND ujp.job_function_profile = 'senior_photographer'
      ) THEN true
      WHEN ws.title ILIKE '%lead%' THEN true
      ELSE false
    END;

WITH shift_summary AS (
  SELECT
    ws.shoot_id,
    COUNT(DISTINCT ws.assigned_user_id)::integer AS planned_staff_count,
    GREATEST(COUNT(*) FILTER (WHERE ws.satisfies_lead_coverage), 1)::integer AS required_lead_count
  FROM work_shift ws
  WHERE ws.shoot_id IS NOT NULL
    AND ws.cancelled_at IS NULL
  GROUP BY ws.shoot_id
)
UPDATE shoot s
SET planned_staff_count = COALESCE(shift_summary.planned_staff_count, s.planned_staff_count),
    required_lead_count = COALESCE(shift_summary.required_lead_count, s.required_lead_count)
FROM shift_summary
WHERE shift_summary.shoot_id = s.id;

ALTER TABLE staffing_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_template_role ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_template FORCE ROW LEVEL SECURITY;
ALTER TABLE staffing_template_role FORCE ROW LEVEL SECURITY;
ALTER TABLE schedule_event FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_staffing_template ON staffing_template
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_staffing_template_role ON staffing_template_role
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_schedule_event ON schedule_event
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
