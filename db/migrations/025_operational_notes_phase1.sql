CREATE TYPE operational_note_object_type AS ENUM (
  'shoot',
  'shift',
  'location',
  'alert'
);

CREATE TYPE operational_note_type AS ENUM (
  'operational_update',
  'temporary_note',
  'permanent_note',
  'location_memory',
  'post_shoot_follow_up'
);

CREATE TYPE operational_note_permanence AS ENUM (
  'temporary',
  'permanent',
  'persistent_memory',
  'follow_up'
);

CREATE TYPE operational_note_visibility_scope AS ENUM (
  'object_viewers',
  'assigned_staff_and_managers',
  'managers_and_leadership',
  'leadership_only'
);

CREATE TYPE operational_note_publication_state AS ENUM (
  'active',
  'proposed'
);

CREATE TABLE operational_note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  object_type operational_note_object_type NOT NULL,
  object_id uuid NOT NULL,
  note_type operational_note_type NOT NULL,
  body text NOT NULL,
  author_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  edited_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  archived_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  promoted_from_note_id uuid REFERENCES operational_note(id) ON DELETE SET NULL,
  promoted_to_location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  promotion_reviewed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  permanence_classification operational_note_permanence NOT NULL,
  visibility_scope operational_note_visibility_scope NOT NULL DEFAULT 'object_viewers',
  publication_state operational_note_publication_state NOT NULL DEFAULT 'active',
  source_context text NOT NULL DEFAULT 'mission_control',
  mention_metadata jsonb NOT NULL DEFAULT '[]'::jsonb,
  attachment_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  pinned boolean NOT NULL DEFAULT false,
  edited_at timestamptz,
  archived_at timestamptz,
  archived_reason text,
  promotion_requested_at timestamptz,
  promotion_published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(trim(body)) > 0)
);

CREATE TABLE operational_note_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  note_id uuid NOT NULL REFERENCES operational_note(id) ON DELETE CASCADE,
  edited_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  source_context text NOT NULL DEFAULT 'mission_control',
  reason text,
  before_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX operational_note_tenant_object_idx
  ON operational_note (tenant_id, object_type, object_id, created_at DESC);

CREATE INDEX operational_note_tenant_active_idx
  ON operational_note (tenant_id, object_type, object_id, archived_at, pinned, created_at DESC);

CREATE INDEX operational_note_tenant_location_memory_idx
  ON operational_note (tenant_id, note_type, promoted_to_location_id, publication_state, archived_at, created_at DESC);

CREATE INDEX operational_note_revision_tenant_note_idx
  ON operational_note_revision (tenant_id, note_id, created_at DESC);

ALTER TABLE operational_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_note_revision ENABLE ROW LEVEL SECURITY;

ALTER TABLE operational_note FORCE ROW LEVEL SECURITY;
ALTER TABLE operational_note_revision FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_operational_note ON operational_note
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_operational_note_revision ON operational_note_revision
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
