DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_email_template_key') THEN
    CREATE TYPE sales_email_template_key AS ENUM (
      'proposal_email',
      'contract_follow_up',
      'renewal_outreach',
      'onboarding_message',
      'post_shoot_follow_up'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_email_trigger_type') THEN
    CREATE TYPE sales_email_trigger_type AS ENUM (
      'manual',
      'automated'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_email_communication_status') THEN
    CREATE TYPE sales_email_communication_status AS ENUM (
      'queued',
      'sent',
      'skipped',
      'failed'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_email_event_type') THEN
    CREATE TYPE sales_email_event_type AS ENUM (
      'queued',
      'sent',
      'skipped',
      'failed'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sales_email_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_key sales_email_template_key NOT NULL,
  template_name text NOT NULL,
  subject_template text NOT NULL,
  body_template text NOT NULL,
  merge_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  active_status boolean NOT NULL DEFAULT true,
  automation_enabled boolean NOT NULL DEFAULT false,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, template_key)
);

CREATE INDEX IF NOT EXISTS sales_email_template_tenant_active_idx
  ON sales_email_template (tenant_id, active_status, template_key);

CREATE TABLE IF NOT EXISTS sales_email_communication (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  template_id uuid REFERENCES sales_email_template(id) ON DELETE SET NULL,
  template_key sales_email_template_key,
  template_name_snapshot text,
  opportunity_id uuid REFERENCES sales_opportunity(id) ON DELETE SET NULL,
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  sent_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  trigger_type sales_email_trigger_type NOT NULL DEFAULT 'manual',
  status sales_email_communication_status NOT NULL DEFAULT 'queued',
  recipient_name text,
  recipient_email text,
  subject text NOT NULL,
  body text NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_delivery_attempt_at timestamptz,
  delivery_provider text,
  delivery_reference text,
  provider_error_state text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_email_communication_tenant_opportunity_idx
  ON sales_email_communication (tenant_id, opportunity_id, created_at DESC)
  WHERE opportunity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_email_communication_tenant_organization_idx
  ON sales_email_communication (tenant_id, organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sales_email_communication_tenant_contact_idx
  ON sales_email_communication (tenant_id, contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sales_email_communication_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  communication_id uuid NOT NULL REFERENCES sales_email_communication(id) ON DELETE CASCADE,
  event_type sales_email_event_type NOT NULL,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  timestamp timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_email_communication_event_tenant_comm_idx
  ON sales_email_communication_event (tenant_id, communication_id, timestamp DESC);

ALTER TABLE sales_email_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_email_template FORCE ROW LEVEL SECURITY;

ALTER TABLE sales_email_communication ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_email_communication FORCE ROW LEVEL SECURITY;

ALTER TABLE sales_email_communication_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_email_communication_event FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales_email_template'
      AND policyname = 'tenant_isolation_sales_email_template'
  ) THEN
    CREATE POLICY tenant_isolation_sales_email_template ON sales_email_template
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales_email_communication'
      AND policyname = 'tenant_isolation_sales_email_communication'
  ) THEN
    CREATE POLICY tenant_isolation_sales_email_communication ON sales_email_communication
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales_email_communication_event'
      AND policyname = 'tenant_isolation_sales_email_communication_event'
  ) THEN
    CREATE POLICY tenant_isolation_sales_email_communication_event ON sales_email_communication_event
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

INSERT INTO sales_email_template (
  tenant_id,
  template_key,
  template_name,
  subject_template,
  body_template,
  merge_fields,
  automation_enabled
)
SELECT
  t.id,
  seeded.template_key::sales_email_template_key,
  seeded.template_name,
  seeded.subject_template,
  seeded.body_template,
  seeded.merge_fields::jsonb,
  seeded.automation_enabled
FROM tenant t
CROSS JOIN (
  VALUES
    (
      'proposal_email',
      'Proposal Email',
      'Proposal for {{organization_name}}',
      'Hi {{contact_name}},\n\nThanks for taking the time to connect with us about {{organization_name}}. I''m sending over the current proposal so we can keep momentum moving.\n\nEstimated value: {{estimated_value}}\nNext action: {{next_action_date}}\n\nBest,\n{{sender_name}}',
      '["organization_name","contact_name","estimated_value","next_action_date","sender_name"]',
      false
    ),
    (
      'contract_follow_up',
      'Contract Follow-Up',
      'Following up on the agreement for {{organization_name}}',
      'Hi {{contact_name}},\n\nI wanted to follow up on the agreement for {{organization_name}}. If anything is holding up signature or review, just let me know and I can help unblock it.\n\nCurrent stage: {{opportunity_stage}}\n\nBest,\n{{sender_name}}',
      '["organization_name","contact_name","opportunity_stage","sender_name"]',
      true
    ),
    (
      'renewal_outreach',
      'Renewal Outreach',
      'Renewal planning for {{organization_name}}',
      'Hi {{contact_name}},\n\nWe''re getting ahead on renewal planning for {{organization_name}} and wanted to reconnect before the next season gets too tight.\n\nPipeline: {{pipeline_type}}\nNext action: {{next_action_date}}\n\nBest,\n{{sender_name}}',
      '["organization_name","contact_name","pipeline_type","next_action_date","sender_name"]',
      true
    ),
    (
      'onboarding_message',
      'Onboarding Message',
      'Welcome from Kemmetmueller Photography',
      'Hi {{contact_name}},\n\nWe''re excited to get {{organization_name}} set up with Mission Control. This email is a starting point for next steps, contacts, and anything we need before work begins.\n\nBest,\n{{sender_name}}',
      '["organization_name","contact_name","sender_name"]',
      false
    ),
    (
      'post_shoot_follow_up',
      'Post-Shoot Follow-Up',
      'Post-shoot follow-up for {{organization_name}}',
      'Hi {{contact_name}},\n\nThanks again for working with us on {{organization_name}}. I wanted to follow up after the shoot and keep the line open if there are any questions, concerns, or next steps we should line up.\n\nBest,\n{{sender_name}}',
      '["organization_name","contact_name","sender_name"]',
      true
    )
) AS seeded(template_key, template_name, subject_template, body_template, merge_fields, automation_enabled)
ON CONFLICT (tenant_id, template_key) DO NOTHING;
