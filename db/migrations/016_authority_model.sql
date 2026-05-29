CREATE TYPE authority_tier AS ENUM (
  'super_admin',
  'leadership',
  'director_admin',
  'supervisor',
  'standard_employee',
  'read_only_viewer'
);

CREATE TYPE job_function_profile AS ENUM (
  'associate_photographer',
  'seasonal_photographer',
  'part_time_photographer',
  'senior_photographer',
  'schools_client_success',
  'sports_client_success',
  'customer_service_rep',
  'graphic_artist',
  'director_of_photography',
  'director_of_school_photography',
  'director_of_sports_photography',
  'director_of_digital_production',
  'leadership_team_member',
  'leadership_viewer'
);

CREATE TYPE permission_domain AS ENUM (
  'training_documents',
  'shoot_locations',
  'calendar_events',
  'sessions_shoots',
  'staffing_assignments',
  'schedules_shifts',
  'clock_in_out',
  'time_edits',
  'missed_punches',
  'early_late_clock_in_approvals',
  'pto_requests',
  'pto_approvals',
  'shift_swaps',
  'attendance_exceptions',
  'labor_cost',
  'customer_service_metrics',
  'reporting_exports',
  'audit_logs',
  'system_settings_permissions'
);

CREATE TYPE permission_action AS ENUM (
  'view',
  'create',
  'edit',
  'approve',
  'override',
  'delete',
  'export',
  'receive_notifications'
);

CREATE TYPE permission_scope AS ENUM (
  'own_records_only',
  'own_shift_only',
  'own_pto_only',
  'assigned_shoot_only',
  'shoot_lead_scope_only',
  'department_only',
  'organization_wide_scope',
  'trade_participant_scope_only'
);

ALTER TABLE user_invite
  ADD COLUMN invited_authority_tier authority_tier,
  ADD COLUMN invited_job_function_profile job_function_profile;

CREATE TABLE user_authority_assignment (
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  authority_tier authority_tier NOT NULL,
  primary_job_function_profile job_function_profile NOT NULL,
  scope_department department_code,
  scope_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE user_job_function_profile (
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  job_function_profile job_function_profile NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, job_function_profile)
);

CREATE TABLE authority_permission_grant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_tier authority_tier,
  job_function_profile job_function_profile,
  permission_domain permission_domain NOT NULL,
  permission_action permission_action NOT NULL,
  permission_scope permission_scope NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (authority_tier IS NOT NULL OR job_function_profile IS NOT NULL),
  UNIQUE (authority_tier, job_function_profile, permission_domain, permission_action, permission_scope)
);

CREATE INDEX user_authority_assignment_tenant_tier_idx ON user_authority_assignment (tenant_id, authority_tier);
CREATE INDEX user_job_function_profile_tenant_profile_idx ON user_job_function_profile (tenant_id, job_function_profile);
CREATE INDEX authority_permission_grant_tier_idx ON authority_permission_grant (authority_tier, permission_domain, permission_action);
CREATE INDEX authority_permission_grant_profile_idx ON authority_permission_grant (job_function_profile, permission_domain, permission_action);

ALTER TABLE user_authority_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_job_function_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE authority_permission_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_authority_assignment FORCE ROW LEVEL SECURITY;
ALTER TABLE user_job_function_profile FORCE ROW LEVEL SECURITY;
ALTER TABLE authority_permission_grant FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_user_authority_assignment ON user_authority_assignment
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_user_job_function_profile ON user_job_function_profile
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_authority_permission_grant ON authority_permission_grant
  USING (true)
  WITH CHECK (true);

WITH primary_role AS (
  SELECT
    u.tenant_id,
    u.id AS user_id,
    u.department,
    (
      SELECT r.code
      FROM user_role ur
      JOIN role r ON r.id = ur.role_id
      WHERE ur.tenant_id = u.tenant_id
        AND ur.user_id = u.id
      ORDER BY CASE r.code
        WHEN 'owner_admin' THEN 1
        WHEN 'admin' THEN 2
        WHEN 'leadership' THEN 3
        WHEN 'senior_photographer' THEN 4
        WHEN 'associate_photographer' THEN 5
        WHEN 'photographer' THEN 6
        WHEN 'office_employee' THEN 7
        ELSE 99
      END
      LIMIT 1
    ) AS role_code
  FROM app_user u
)
INSERT INTO user_authority_assignment (
  tenant_id,
  user_id,
  authority_tier,
  primary_job_function_profile,
  scope_department,
  scope_overrides
)
SELECT
  tenant_id,
  user_id,
  CASE COALESCE(role_code, 'office_employee')
    WHEN 'owner_admin' THEN 'super_admin'::authority_tier
    WHEN 'leadership' THEN 'leadership'::authority_tier
    WHEN 'admin' THEN 'director_admin'::authority_tier
    WHEN 'senior_photographer' THEN 'supervisor'::authority_tier
    WHEN 'associate_photographer' THEN 'standard_employee'::authority_tier
    WHEN 'photographer' THEN 'standard_employee'::authority_tier
    ELSE 'standard_employee'::authority_tier
  END,
  CASE COALESCE(role_code, 'office_employee')
    WHEN 'owner_admin' THEN 'leadership_team_member'::job_function_profile
    WHEN 'leadership' THEN 'leadership_team_member'::job_function_profile
    WHEN 'admin' THEN 'director_of_photography'::job_function_profile
    WHEN 'senior_photographer' THEN 'senior_photographer'::job_function_profile
    WHEN 'associate_photographer' THEN 'associate_photographer'::job_function_profile
    WHEN 'photographer' THEN 'seasonal_photographer'::job_function_profile
    ELSE CASE department
      WHEN 'schools' THEN 'schools_client_success'::job_function_profile
      WHEN 'sports' THEN 'sports_client_success'::job_function_profile
      WHEN 'production' THEN 'graphic_artist'::job_function_profile
      ELSE 'customer_service_rep'::job_function_profile
    END
  END,
  department,
  '{}'::jsonb
FROM primary_role
ON CONFLICT (tenant_id, user_id) DO NOTHING;

INSERT INTO user_job_function_profile (tenant_id, user_id, job_function_profile)
SELECT tenant_id, user_id, primary_job_function_profile
FROM user_authority_assignment
ON CONFLICT (tenant_id, user_id, job_function_profile) DO NOTHING;

UPDATE user_invite ui
SET invited_authority_tier = CASE COALESCE(invited_role, 'office_employee')
    WHEN 'owner_admin' THEN 'super_admin'::authority_tier
    WHEN 'leadership' THEN 'leadership'::authority_tier
    WHEN 'admin' THEN 'director_admin'::authority_tier
    WHEN 'senior_photographer' THEN 'supervisor'::authority_tier
    ELSE 'standard_employee'::authority_tier
  END,
  invited_job_function_profile = CASE COALESCE(invited_role, 'office_employee')
    WHEN 'owner_admin' THEN 'leadership_team_member'::job_function_profile
    WHEN 'leadership' THEN 'leadership_team_member'::job_function_profile
    WHEN 'admin' THEN 'director_of_photography'::job_function_profile
    WHEN 'senior_photographer' THEN 'senior_photographer'::job_function_profile
    WHEN 'associate_photographer' THEN 'associate_photographer'::job_function_profile
    WHEN 'photographer' THEN 'seasonal_photographer'::job_function_profile
    ELSE CASE invited_department
      WHEN 'schools' THEN 'schools_client_success'::job_function_profile
      WHEN 'sports' THEN 'sports_client_success'::job_function_profile
      WHEN 'production' THEN 'graphic_artist'::job_function_profile
      ELSE 'customer_service_rep'::job_function_profile
    END
  END
WHERE invited_authority_tier IS NULL
   OR invited_job_function_profile IS NULL;
