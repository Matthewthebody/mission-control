DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operational_approval_request_type') THEN
    CREATE TYPE operational_approval_request_type AS ENUM (
      'staffing_exception_approval',
      'schedule_change_approval',
      'role_override_approval',
      'overtime_labor_exception_approval',
      'due_date_extension_approval',
      'deadline_override_approval',
      'peer_review_exception_approval',
      'qc_exception_approval',
      'release_override_approval',
      'rework_waiver_approval',
      'cancellation_approval',
      'policy_exception_approval'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operational_approval_status') THEN
    CREATE TYPE operational_approval_status AS ENUM (
      'pending',
      'needs_clarification',
      'approved',
      'rejected',
      'canceled'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operational_approval_step_status') THEN
    CREATE TYPE operational_approval_step_status AS ENUM (
      'queued',
      'pending',
      'approved',
      'rejected',
      'sent_back',
      'delegated',
      'canceled'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS operational_approval_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  request_type operational_approval_request_type NOT NULL,
  status operational_approval_status NOT NULL DEFAULT 'pending',
  source_module text NOT NULL,
  source_entity_type text NOT NULL,
  source_entity_id text NOT NULL,
  source_entity_label text,
  requester_department text,
  blocking boolean NOT NULL DEFAULT true,
  requested_action_code text NOT NULL,
  request_title text NOT NULL,
  request_summary text,
  reason text NOT NULL,
  severity text NOT NULL DEFAULT 'normal',
  dedupe_key text,
  requested_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  approval_chain text[] NOT NULL DEFAULT '{}'::text[],
  current_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  clarification_note text,
  decision_note text,
  approved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  rejected_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  canceled_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  sla_due_at timestamptz,
  overdue_at timestamptz,
  escalated_at timestamptz,
  escalation_level integer NOT NULL DEFAULT 0,
  decided_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operational_approval_step (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  approval_request_id uuid NOT NULL REFERENCES operational_approval_request(id) ON DELETE CASCADE,
  step_order integer NOT NULL,
  approver_role_group text NOT NULL,
  approver_department text,
  approver_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  status operational_approval_step_status NOT NULL DEFAULT 'queued',
  acted_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  delegated_from_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  note text,
  due_at timestamptz,
  acted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, approval_request_id, step_order)
);

CREATE TABLE IF NOT EXISTS operational_approval_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  approval_request_id uuid NOT NULL REFERENCES operational_approval_request(id) ON DELETE CASCADE,
  approval_step_id uuid REFERENCES operational_approval_step(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  summary text NOT NULL,
  note text,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operational_approval_request_status_idx
  ON operational_approval_request (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS operational_approval_request_source_idx
  ON operational_approval_request (tenant_id, source_module, source_entity_type, source_entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS operational_approval_request_requester_idx
  ON operational_approval_request (tenant_id, requested_by_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS operational_approval_request_due_idx
  ON operational_approval_request (tenant_id, sla_due_at, escalation_level)
  WHERE status IN ('pending', 'needs_clarification');

CREATE UNIQUE INDEX IF NOT EXISTS operational_approval_request_active_dedupe_idx
  ON operational_approval_request (tenant_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL
    AND status IN ('pending', 'needs_clarification', 'approved')
    AND executed_at IS NULL;

CREATE INDEX IF NOT EXISTS operational_approval_step_inbox_idx
  ON operational_approval_step (tenant_id, approver_user_id, status, due_at, step_order);

CREATE INDEX IF NOT EXISTS operational_approval_event_request_idx
  ON operational_approval_event (tenant_id, approval_request_id, created_at DESC);

ALTER TABLE operational_approval_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_approval_step ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_approval_event ENABLE ROW LEVEL SECURITY;

ALTER TABLE operational_approval_request FORCE ROW LEVEL SECURITY;
ALTER TABLE operational_approval_step FORCE ROW LEVEL SECURITY;
ALTER TABLE operational_approval_event FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'operational_approval_request'
      AND policyname = 'tenant_isolation_operational_approval_request'
  ) THEN
    CREATE POLICY tenant_isolation_operational_approval_request ON operational_approval_request
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'operational_approval_step'
      AND policyname = 'tenant_isolation_operational_approval_step'
  ) THEN
    CREATE POLICY tenant_isolation_operational_approval_step ON operational_approval_step
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'operational_approval_event'
      AND policyname = 'tenant_isolation_operational_approval_event'
  ) THEN
    CREATE POLICY tenant_isolation_operational_approval_event ON operational_approval_event
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
