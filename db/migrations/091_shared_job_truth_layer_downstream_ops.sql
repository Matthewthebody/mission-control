ALTER TYPE job_production_status_type ADD VALUE IF NOT EXISTS 'awaiting_internal_review';
ALTER TYPE job_production_status_type ADD VALUE IF NOT EXISTS 'approved_for_final';
ALTER TYPE job_production_status_type ADD VALUE IF NOT EXISTS 'in_final_production';
ALTER TYPE job_production_status_type ADD VALUE IF NOT EXISTS 'ordered_or_sent';
ALTER TYPE job_production_status_type ADD VALUE IF NOT EXISTS 'cancelled';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_approval_status_type') THEN
    CREATE TYPE job_approval_status_type AS ENUM (
      'not_required',
      'not_started',
      'requested',
      'viewed',
      'approved',
      'rejected',
      'revisions_requested',
      'overdue',
      'cancelled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_qa_review_status_type') THEN
    CREATE TYPE job_qa_review_status_type AS ENUM (
      'not_required',
      'queued',
      'in_review',
      'passed',
      'passed_with_notes',
      'failed',
      'rework_in_progress',
      'recheck_required',
      'complete'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_deliverable_status_type') THEN
    CREATE TYPE job_deliverable_status_type AS ENUM (
      'not_started',
      'preparing',
      'sent',
      'in_transit',
      'delivered',
      'confirmed',
      'issue_flagged',
      'cancelled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_handoff_status_type') THEN
    CREATE TYPE job_handoff_status_type AS ENUM (
      'pending',
      'accepted',
      'in_progress',
      'completed',
      'rejected',
      'blocked'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_issue_status_type') THEN
    CREATE TYPE job_issue_status_type AS ENUM (
      'open',
      'acknowledged',
      'resolved',
      'dismissed'
    );
  END IF;
END $$;

ALTER TABLE production_items
  ADD COLUMN IF NOT EXISTS department_type job_department_type,
  ADD COLUMN IF NOT EXISTS qa_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_visible_label text;

UPDATE production_items item
SET department_type = job.department_type
FROM jobs job
WHERE item.job_id = job.id
  AND item.department_type IS NULL;

ALTER TABLE production_items
  ALTER COLUMN department_type SET DEFAULT 'other'::job_department_type;

UPDATE production_items
SET department_type = 'other'::job_department_type
WHERE department_type IS NULL;

ALTER TABLE production_items
  ALTER COLUMN department_type SET NOT NULL;

CREATE TABLE IF NOT EXISTS production_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  production_item_id uuid NOT NULL REFERENCES production_items(id) ON DELETE CASCADE,
  handoff_type text NOT NULL,
  from_stage text NOT NULL,
  to_stage text NOT NULL,
  from_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  to_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  status job_handoff_status_type NOT NULL DEFAULT 'pending',
  note text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS production_handoffs_tenant_item_idx
  ON production_handoffs (tenant_id, production_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  production_item_id uuid NOT NULL REFERENCES production_items(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  job_day_id uuid REFERENCES job_days(id) ON DELETE SET NULL,
  approval_type text NOT NULL,
  approver_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  approver_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  status job_approval_status_type NOT NULL DEFAULT 'not_started',
  requested_at timestamptz,
  viewed_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  revision_requested_at timestamptz,
  due_at timestamptz,
  last_follow_up_at timestamptz,
  revision_count integer NOT NULL DEFAULT 0,
  summary text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (revision_count >= 0)
);

CREATE INDEX IF NOT EXISTS approval_requests_tenant_item_idx
  ON approval_requests (tenant_id, production_item_id, status, due_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS approval_requests_tenant_job_idx
  ON approval_requests (tenant_id, job_id, status, due_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS qa_review_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  production_item_id uuid NOT NULL REFERENCES production_items(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  review_type text NOT NULL,
  review_stage text NOT NULL,
  reviewer_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  requested_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  status job_qa_review_status_type NOT NULL DEFAULT 'queued',
  decision text,
  reviewed_at timestamptz,
  sample_size_percent integer,
  checklist_template_key text,
  notes text,
  rework_required boolean NOT NULL DEFAULT false,
  sent_back_to_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sample_size_percent IS NULL OR (sample_size_percent >= 0 AND sample_size_percent <= 100))
);

CREATE INDEX IF NOT EXISTS qa_review_records_tenant_item_idx
  ON qa_review_records (tenant_id, production_item_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS qa_review_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  qa_review_record_id uuid NOT NULL REFERENCES qa_review_records(id) ON DELETE CASCADE,
  finding_type text NOT NULL,
  severity job_watch_flag_severity_type NOT NULL DEFAULT 'low',
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_blocking boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qa_review_findings_tenant_review_idx
  ON qa_review_findings (tenant_id, qa_review_record_id, created_at DESC);

CREATE TABLE IF NOT EXISTS deliverable_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  production_item_id uuid NOT NULL REFERENCES production_items(id) ON DELETE CASCADE,
  deliverable_type text NOT NULL,
  title text NOT NULL,
  quantity integer,
  delivery_method text NOT NULL DEFAULT 'digital',
  status job_deliverable_status_type NOT NULL DEFAULT 'not_started',
  vendor_name text,
  tracking_reference text,
  delivered_at timestamptz,
  recipient_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  recipient_organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (quantity IS NULL OR quantity >= 0)
);

CREATE INDEX IF NOT EXISTS deliverable_items_tenant_item_idx
  ON deliverable_items (tenant_id, production_item_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS production_issue_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  production_item_id uuid NOT NULL REFERENCES production_items(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  issue_type text NOT NULL,
  severity job_watch_flag_severity_type NOT NULL DEFAULT 'medium',
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status job_issue_status_type NOT NULL DEFAULT 'open',
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS production_issue_records_tenant_item_idx
  ON production_issue_records (tenant_id, production_item_id, status, severity, created_at DESC);

ALTER TYPE job_attachment_entity_type ADD VALUE IF NOT EXISTS 'approval_request';
ALTER TYPE job_attachment_entity_type ADD VALUE IF NOT EXISTS 'qa_review_record';
ALTER TYPE job_attachment_entity_type ADD VALUE IF NOT EXISTS 'deliverable_item';
ALTER TYPE job_attachment_entity_type ADD VALUE IF NOT EXISTS 'production_issue_record';

ALTER TABLE job_attachment_links
  ADD COLUMN IF NOT EXISTS approval_request_id uuid REFERENCES approval_requests(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS qa_review_record_id uuid REFERENCES qa_review_records(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS deliverable_item_id uuid REFERENCES deliverable_items(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS production_issue_record_id uuid REFERENCES production_issue_records(id) ON DELETE CASCADE;

ALTER TABLE job_attachment_links
  DROP CONSTRAINT IF EXISTS job_attachment_links_check;

ALTER TABLE job_attachment_links
  ADD CONSTRAINT job_attachment_links_check
  CHECK (
    (CASE WHEN job_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN job_day_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN production_item_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN approval_request_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN qa_review_record_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN deliverable_item_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN production_issue_record_id IS NULL THEN 0 ELSE 1 END) = 1
  );

CREATE INDEX IF NOT EXISTS job_attachment_links_tenant_approval_idx
  ON job_attachment_links (tenant_id, approval_request_id, created_at DESC)
  WHERE approval_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS job_attachment_links_tenant_qa_idx
  ON job_attachment_links (tenant_id, qa_review_record_id, created_at DESC)
  WHERE qa_review_record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS job_attachment_links_tenant_deliverable_idx
  ON job_attachment_links (tenant_id, deliverable_item_id, created_at DESC)
  WHERE deliverable_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS job_attachment_links_tenant_issue_idx
  ON job_attachment_links (tenant_id, production_issue_record_id, created_at DESC)
  WHERE production_issue_record_id IS NOT NULL;

DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'production_handoffs',
    'approval_requests',
    'qa_review_records',
    'qa_review_findings',
    'deliverable_items',
    'production_issue_records'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    policy_name := 'tenant_isolation_' || table_name;
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      policy_name,
      table_name
    );
  END LOOP;
END $$;
