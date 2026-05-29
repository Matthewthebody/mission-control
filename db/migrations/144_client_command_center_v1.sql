DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_entity_kind') THEN
    CREATE TYPE client_entity_kind AS ENUM ('parent_organization', 'account');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_organization_type') THEN
    CREATE TYPE client_organization_type AS ENUM (
      'school_district',
      'league',
      'sports_association',
      'company',
      'nonprofit',
      'elementary_school',
      'middle_school',
      'high_school',
      'school',
      'studio_client',
      'corporate_client',
      'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_lifecycle_status') THEN
    CREATE TYPE client_lifecycle_status AS ENUM ('active', 'inactive', 'prospect', 'former_client', 'archived');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_contact_role') THEN
    CREATE TYPE client_contact_role AS ENUM (
      'principal',
      'head_secretary',
      'administrative_assistant',
      'athletic_director',
      'activities_director',
      'coach',
      'yearbook_contact',
      'picture_day_contact',
      'billing_contact',
      'approval_contact',
      'contract_signer',
      'emergency_day_of_contact',
      'district_contact',
      'primary_contact',
      'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_owner_type') THEN
    CREATE TYPE client_owner_type AS ENUM (
      'studio_bestie',
      'csr_owner',
      'department_owner',
      'sales_owner',
      'escalation_owner',
      'production_owner',
      'support_owner'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_service_type') THEN
    CREATE TYPE account_service_type AS ENUM (
      'fall_pictures',
      'retakes',
      'spring_pictures',
      'graduation',
      'yearbook',
      'id_cards',
      'sports',
      'groups',
      'staff_photos',
      'studio_work',
      'corporate_headshots',
      'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_service_status') THEN
    CREATE TYPE account_service_status AS ENUM ('active', 'inactive', 'seasonal', 'unknown');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_communication_type') THEN
    CREATE TYPE client_communication_type AS ENUM (
      'new_client_onboarding',
      'picture_day_confirmation',
      'picture_day_prep',
      'reminder_email',
      'yearbook_deadline',
      'gallery_live',
      'retake_reminder',
      'missing_approval_followup',
      'post_shoot_thank_you',
      'issue_escalation'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_event_type') THEN
    CREATE TYPE client_event_type AS ENUM (
      'picture_day',
      'retake_day',
      'yearbook_deadline',
      'gallery_live',
      'client_meeting',
      'onboarding_call',
      'prep_email_due',
      'reminder_due',
      'approval_due',
      'follow_up_due',
      'other'
    );
  END IF;
END $$;

ALTER TABLE organization
  ADD COLUMN IF NOT EXISTS external_code text,
  ADD COLUMN IF NOT EXISTS parent_organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_entity_kind client_entity_kind NOT NULL DEFAULT 'account',
  ADD COLUMN IF NOT EXISTS client_organization_type client_organization_type,
  ADD COLUMN IF NOT EXISTS client_lifecycle_status client_lifecycle_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS main_phone text,
  ADD COLUMN IF NOT EXISTS office_phone text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS client_demo_key text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organization_parent_not_self'
  ) THEN
    ALTER TABLE organization
      ADD CONSTRAINT organization_parent_not_self
      CHECK (parent_organization_id IS NULL OR parent_organization_id <> id);
  END IF;
END $$;

DO $$
DECLARE
  existing_constraint text;
BEGIN
  SELECT c.conname
  INTO existing_constraint
  FROM pg_constraint c
  WHERE c.conrelid = 'organization'::regclass
    AND c.contype = 'u'
    AND pg_get_constraintdef(c.oid) LIKE '%tenant_id, normalized_canonical_name%';

  IF existing_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE organization DROP CONSTRAINT %I', existing_constraint);
  END IF;
END $$;

ALTER TABLE organization_contact
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS mobile_phone text,
  ADD COLUMN IF NOT EXISTS preferred_contact_method text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS client_demo_key text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organization_contact_preferred_method_check'
  ) THEN
    ALTER TABLE organization_contact
      ADD CONSTRAINT organization_contact_preferred_method_check
      CHECK (preferred_contact_method IN ('email', 'phone', 'text', 'unknown'));
  END IF;
END $$;

UPDATE organization_contact
SET display_name = COALESCE(display_name, full_name)
WHERE display_name IS NULL;

ALTER TABLE organization_contact_relationship
  ADD COLUMN IF NOT EXISTS client_roles client_contact_role[] NOT NULL DEFAULT '{}'::client_contact_role[],
  ADD COLUMN IF NOT EXISTS receives_picture_day_emails boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receives_yearbook_emails boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receives_billing_emails boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receives_gallery_emails boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receives_approval_emails boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receives_onboarding_emails boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receives_internal_escalations boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS relationship_notes text;

CREATE TABLE IF NOT EXISTS client_internal_owner (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organization(id) ON DELETE CASCADE,
  account_id uuid REFERENCES organization(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  owner_type client_owner_type NOT NULL,
  notes text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (CASE WHEN organization_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN account_id IS NULL THEN 0 ELSE 1 END) = 1
  )
);

CREATE TABLE IF NOT EXISTS account_service (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  service_type account_service_type NOT NULL,
  status account_service_status NOT NULL DEFAULT 'active',
  notes text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, account_id, service_type)
);

CREATE TABLE IF NOT EXISTS client_context_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  account_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  task_id uuid REFERENCES work_task(id) ON DELETE SET NULL,
  event_id uuid REFERENCES job_days(id) ON DELETE SET NULL,
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  service_type account_service_type,
  communication_type client_communication_type,
  source_type text NOT NULL,
  source_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE work_task
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_type account_service_type,
  ADD COLUMN IF NOT EXISTS communication_type client_communication_type,
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id uuid;

ALTER TABLE job_days
  ADD COLUMN IF NOT EXISTS client_event_type client_event_type,
  ADD COLUMN IF NOT EXISTS communication_type client_communication_type;

CREATE INDEX IF NOT EXISTS organization_client_parent_idx
  ON organization (tenant_id, parent_organization_id, client_entity_kind, active_status, lower(display_name));

CREATE INDEX IF NOT EXISTS organization_client_search_idx
  ON organization (tenant_id, client_entity_kind, client_lifecycle_status, lower(display_name));

CREATE UNIQUE INDEX IF NOT EXISTS organization_client_parent_active_name_unique_idx
  ON organization (tenant_id, normalized_canonical_name)
  WHERE client_entity_kind = 'parent_organization'::client_entity_kind
    AND active_status = 'active'::directory_active_status;

CREATE UNIQUE INDEX IF NOT EXISTS organization_client_account_parent_active_name_unique_idx
  ON organization (tenant_id, COALESCE(parent_organization_id, '00000000-0000-0000-0000-000000000000'::uuid), normalized_canonical_name)
  WHERE client_entity_kind = 'account'::client_entity_kind
    AND active_status = 'active'::directory_active_status;

CREATE INDEX IF NOT EXISTS organization_client_demo_idx
  ON organization (tenant_id, client_demo_key)
  WHERE client_demo_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS organization_contact_client_email_idx
  ON organization_contact (tenant_id, lower(email))
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS organization_contact_relationship_client_roles_idx
  ON organization_contact_relationship USING gin (client_roles);

CREATE INDEX IF NOT EXISTS client_internal_owner_account_idx
  ON client_internal_owner (tenant_id, account_id, owner_type, owner_user_id)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS client_internal_owner_org_idx
  ON client_internal_owner (tenant_id, organization_id, owner_type, owner_user_id)
  WHERE organization_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS client_internal_owner_unique_idx
  ON client_internal_owner (
    tenant_id,
    COALESCE(account_id, organization_id),
    owner_type,
    owner_user_id
  );

CREATE INDEX IF NOT EXISTS account_service_lookup_idx
  ON account_service (tenant_id, account_id, status, service_type);

CREATE INDEX IF NOT EXISTS client_context_link_account_idx
  ON client_context_link (tenant_id, account_id, created_at DESC)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS client_context_link_contact_idx
  ON client_context_link (tenant_id, contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS client_context_link_task_idx
  ON client_context_link (tenant_id, task_id)
  WHERE task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS work_task_client_context_idx
  ON work_task (tenant_id, organization_id, contact_id, service_type, communication_type, due_at)
  WHERE organization_id IS NOT NULL;

ALTER TABLE client_internal_owner ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_service ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_context_link ENABLE ROW LEVEL SECURITY;

ALTER TABLE client_internal_owner FORCE ROW LEVEL SECURITY;
ALTER TABLE account_service FORCE ROW LEVEL SECURITY;
ALTER TABLE client_context_link FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'client_internal_owner'
      AND policyname = 'tenant_isolation_client_internal_owner'
  ) THEN
    CREATE POLICY tenant_isolation_client_internal_owner ON client_internal_owner
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'account_service'
      AND policyname = 'tenant_isolation_account_service'
  ) THEN
    CREATE POLICY tenant_isolation_account_service ON account_service
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'client_context_link'
      AND policyname = 'tenant_isolation_client_context_link'
  ) THEN
    CREATE POLICY tenant_isolation_client_context_link ON client_context_link
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

INSERT INTO permission (code, name, description, resource_type, action_group)
VALUES
  ('client_command_center.read', 'Read Client Command Center', 'View client context, communication readiness, and relationship ownership.', 'client_command_center', 'read'),
  ('client_command_center.manage', 'Manage Client Command Center', 'Create and update client context records, contacts, services, and ownership.', 'client_command_center', 'write')
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  resource_type = EXCLUDED.resource_type,
  action_group = EXCLUDED.action_group,
  updated_at = now();

WITH seeded(role_code, scope_type, scope_value, permission_codes) AS (
  VALUES
    ('admin', 'global', NULL, ARRAY['client_command_center.read','client_command_center.manage']::text[]),
    ('leadership', 'global', NULL, ARRAY['client_command_center.read','client_command_center.manage']::text[]),
    ('schools_manager', 'department', 'schools', ARRAY['client_command_center.read','client_command_center.manage']::text[]),
    ('schools_coordinator', 'department', 'schools', ARRAY['client_command_center.read','client_command_center.manage']::text[]),
    ('sports_manager', 'department', 'sports', ARRAY['client_command_center.read','client_command_center.manage']::text[]),
    ('sports_coordinator', 'department', 'sports', ARRAY['client_command_center.read','client_command_center.manage']::text[]),
    ('production_manager', 'global', NULL, ARRAY['client_command_center.read']::text[]),
    ('production_staff', 'assigned', NULL, ARRAY['client_command_center.read']::text[]),
    ('photographer_lead', 'assigned', NULL, ARRAY['client_command_center.read']::text[]),
    ('photographer_staff', 'assigned', NULL, ARRAY['client_command_center.read']::text[])
)
INSERT INTO role_permission_grant (role_id, permission_id, scope_type, scope_value, effect)
SELECT role.id, permission.id, seeded.scope_type::policy_scope_type, seeded.scope_value, 'allow'::policy_effect_type
FROM seeded
JOIN role ON role.code = seeded.role_code
JOIN permission ON permission.code = ANY (seeded.permission_codes)
ON CONFLICT DO NOTHING;
