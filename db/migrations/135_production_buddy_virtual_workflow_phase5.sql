DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_project_lane_type') THEN
    CREATE TYPE production_project_lane_type AS ENUM ('buddy_photos', 'virtual_teams');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_project_exception_status') THEN
    CREATE TYPE production_project_exception_status AS ENUM ('open', 'resolved', 'dismissed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_project_exception_severity') THEN
    CREATE TYPE production_project_exception_severity AS ENUM ('low', 'normal', 'high', 'critical');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_project_exception_type') THEN
    CREATE TYPE production_project_exception_type AS ENUM (
      'buddy_unresolved_group',
      'buddy_duplicate_handling_needed',
      'vt_ambiguous_match',
      'vt_coach_tag_missing',
      'vt_split_group_mismatch',
      'vt_attribute_validation_failed'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS production_project_buddy_workflow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES production_project(id) ON DELETE CASCADE,
  status production_project_task_status NOT NULL DEFAULT 'todo',
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  duplicate_handling_required boolean NOT NULL DEFAULT false,
  cleanup_completed_at timestamptz,
  cleanup_completed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  unresolved_group_count integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id)
);

CREATE TABLE IF NOT EXISTS production_project_virtual_team_workflow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES production_project(id) ON DELETE CASCADE,
  status production_project_task_status NOT NULL DEFAULT 'todo',
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  attributes_validated boolean NOT NULL DEFAULT false,
  coach_tags_validated boolean NOT NULL DEFAULT false,
  split_by_group_validated boolean NOT NULL DEFAULT false,
  ambiguous_match_required boolean NOT NULL DEFAULT false,
  ambiguous_match_resolved_at timestamptz,
  completed_at timestamptz,
  completed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id)
);

CREATE TABLE IF NOT EXISTS production_project_exception (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES production_project(id) ON DELETE CASCADE,
  lane_type production_project_lane_type NOT NULL,
  exception_type production_project_exception_type NOT NULL,
  severity production_project_exception_severity NOT NULL DEFAULT 'normal',
  blocking boolean NOT NULL DEFAULT false,
  status production_project_exception_status NOT NULL DEFAULT 'open',
  assignee_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  notes text,
  resolution_notes text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  resolved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS production_project_buddy_workflow_tenant_idx
  ON production_project_buddy_workflow (tenant_id, status, owner_user_id);

CREATE INDEX IF NOT EXISTS production_project_virtual_team_workflow_tenant_idx
  ON production_project_virtual_team_workflow (tenant_id, status, owner_user_id);

CREATE INDEX IF NOT EXISTS production_project_exception_tenant_idx
  ON production_project_exception (tenant_id, status, lane_type, exception_type);
