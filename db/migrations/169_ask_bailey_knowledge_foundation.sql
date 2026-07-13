-- Ask Bailey — knowledge governance foundation (Phase B).
-- Design: docs/ask-bailey/2026-07-13-ask-bailey-architecture.md
--
-- Two layers: the Resource Library item stays the canonical ORIGINAL asset;
-- this layer adds versioned knowledge GOVERNANCE (source type, authority,
-- publication lifecycle, knowledge mode, scopes, effective dates, supersession)
-- plus retrievable segments, ingestion jobs, declared conflicts, and the
-- Ask Bailey conversation/feedback/unresolved-question records.
--
-- Retrieval eligibility is enforced in SQL BEFORE anything reaches a model:
-- approved + effective + not superseded/retired + mode-eligible + scope-authorized.
-- text + CHECK style throughout, mirroring migrations 165/166; RLS on every table.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Knowledge source identity (references the Resource Library asset; a
--    source may also be inline-authored, e.g. a verified expert answer).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  resource_library_item_id uuid REFERENCES resource_library_item(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  department_owner text,
  current_version_id uuid, -- FK added below (circular)
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_source_title_check CHECK (length(btrim(title)) > 0)
);

CREATE TABLE IF NOT EXISTS knowledge_source_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES knowledge_source(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  source_type text NOT NULL,
  authority_class text NOT NULL,
  publication_status text NOT NULL DEFAULT 'draft',
  knowledge_mode text NOT NULL DEFAULT 'operational',
  -- Inline body for sources authored directly in review (expert answers);
  -- file-backed sources leave this NULL and carry extracted segments instead.
  inline_body text,
  content_fingerprint text,
  effective_from date,
  effective_until date,
  review_due_at date,
  supersedes_version_id uuid REFERENCES knowledge_source_version(id) ON DELETE SET NULL,
  superseded_by_version_id uuid REFERENCES knowledge_source_version(id) ON DELETE SET NULL,
  -- Scope: empty array = no restriction on that axis. Confidential sources
  -- additionally require leadership-tier access.
  department_scope text[] NOT NULL DEFAULT '{}',
  role_scope text[] NOT NULL DEFAULT '{}',
  confidential boolean NOT NULL DEFAULT false,
  source_language text NOT NULL DEFAULT 'en',
  extraction_status text NOT NULL DEFAULT 'not_started',
  last_indexed_at timestamptz,
  review_notes text,
  submitted_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  approved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_id, version_number),
  CONSTRAINT knowledge_source_version_type_check CHECK (source_type IN (
    'written_sop', 'company_policy', 'training_video', 'training_audio', 'presentation',
    'checklist', 'approved_example', 'visual_standard', 'verified_expert_answer',
    'current_workflow_observation', 'meeting_recording', 'raw_transcript',
    'post_shoot_evidence', 'incident_evidence', 'future_design', 'historical_reference',
    'external_reference'
  )),
  CONSTRAINT knowledge_source_version_authority_check CHECK (authority_class IN (
    'official_company_policy', 'approved_sop', 'approved_training',
    'approved_expert_guidance', 'approved_visual_standard', 'verified_current_workflow',
    'observation_only', 'raw_evidence', 'future_design_only', 'historical_only'
  )),
  CONSTRAINT knowledge_source_version_status_check CHECK (publication_status IN (
    'draft', 'pending_review', 'approved', 'rejected', 'superseded', 'retired', 'archived'
  )),
  CONSTRAINT knowledge_source_version_mode_check CHECK (knowledge_mode IN (
    'operational', 'training', 'planning', 'historical', 'evidence_only'
  )),
  CONSTRAINT knowledge_source_version_extraction_check CHECK (extraction_status IN (
    'not_started', 'queued', 'processing', 'needs_review', 'completed', 'failed', 'not_configured'
  ))
);

ALTER TABLE knowledge_source DROP CONSTRAINT IF EXISTS knowledge_source_current_version_fk;
ALTER TABLE knowledge_source
  ADD CONSTRAINT knowledge_source_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES knowledge_source_version(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS knowledge_source_tenant_idx
  ON knowledge_source (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS knowledge_source_version_tenant_source_idx
  ON knowledge_source_version (tenant_id, source_id, version_number DESC);
CREATE INDEX IF NOT EXISTS knowledge_source_version_status_idx
  ON knowledge_source_version (tenant_id, publication_status, knowledge_mode);

-- ---------------------------------------------------------------------------
-- 2. Segments — the retrievable unit. Mirrors the migration-106 weighted
--    generated-tsvector + GIN full-text pattern. Media segments carry EXACT
--    stored timestamps; a citation can never invent one.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_segment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  source_version_id uuid NOT NULL REFERENCES knowledge_source_version(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  segment_kind text NOT NULL DEFAULT 'extracted_text',
  heading text,
  locator_label text,
  content text NOT NULL,
  start_seconds numeric(10,2),
  end_seconds numeric(10,2),
  speaker_label text,
  -- Reviewer classification for transcript segments (approved_instruction,
  -- current_workflow_observation, pain_point, future_design_idea,
  -- raw_discussion, restricted). NULL = inherits the version classification.
  reviewer_classification text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  search_document tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(heading, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(locator_label, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(content, '')), 'C')
  ) STORED,
  UNIQUE (tenant_id, source_version_id, ordinal),
  CONSTRAINT knowledge_segment_kind_check CHECK (segment_kind IN (
    'extracted_text', 'transcript', 'reviewer_note'
  )),
  CONSTRAINT knowledge_segment_content_check CHECK (length(btrim(content)) > 0),
  CONSTRAINT knowledge_segment_timestamps_check CHECK (
    (start_seconds IS NULL AND end_seconds IS NULL)
    OR (start_seconds IS NOT NULL AND end_seconds IS NOT NULL AND end_seconds >= start_seconds)
  ),
  CONSTRAINT knowledge_segment_classification_check CHECK (
    reviewer_classification IS NULL OR reviewer_classification IN (
      'approved_instruction', 'current_workflow_observation', 'pain_point',
      'future_design_idea', 'raw_discussion', 'restricted'
    )
  )
);

CREATE INDEX IF NOT EXISTS knowledge_segment_version_idx
  ON knowledge_segment (tenant_id, source_version_id, ordinal);
CREATE INDEX IF NOT EXISTS knowledge_segment_search_idx
  ON knowledge_segment USING gin (search_document);

-- ---------------------------------------------------------------------------
-- 3. Ingestion jobs — background extraction/transcription lifecycle.
--    Idempotent per (version, kind, fingerprint); retries never duplicate segments.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_ingestion_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  source_version_id uuid NOT NULL REFERENCES knowledge_source_version(id) ON DELETE CASCADE,
  job_kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  idempotency_fingerprint text NOT NULL,
  provider text,
  error_message text,
  requested_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_version_id, job_kind, idempotency_fingerprint),
  CONSTRAINT knowledge_ingestion_job_kind_check CHECK (job_kind IN (
    'document_extract', 'media_transcribe'
  )),
  CONSTRAINT knowledge_ingestion_job_status_check CHECK (status IN (
    'queued', 'processing', 'needs_review', 'completed', 'failed', 'not_configured'
  ))
);

CREATE INDEX IF NOT EXISTS knowledge_ingestion_job_status_idx
  ON knowledge_ingestion_job (tenant_id, status, created_at);

-- ---------------------------------------------------------------------------
-- 4. Declared source conflicts — never silently ranked away.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_source_conflict (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  version_a_id uuid NOT NULL REFERENCES knowledge_source_version(id) ON DELETE CASCADE,
  version_b_id uuid NOT NULL REFERENCES knowledge_source_version(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open',
  note text,
  opened_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  resolved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, version_a_id, version_b_id),
  CONSTRAINT knowledge_source_conflict_status_check CHECK (status IN (
    'open', 'resolved', 'dismissed'
  )),
  CONSTRAINT knowledge_source_conflict_distinct_check CHECK (version_a_id <> version_b_id)
);

CREATE INDEX IF NOT EXISTS knowledge_source_conflict_open_idx
  ON knowledge_source_conflict (tenant_id, status);

-- ---------------------------------------------------------------------------
-- 5. Ask Bailey conversations, messages, citations, feedback.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_conversation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_conversation_user_idx
  ON ai_conversation (tenant_id, user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES ai_conversation(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  knowledge_mode text NOT NULL DEFAULT 'operational',
  question text NOT NULL,
  context_envelope jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL,
  answer_markdown text,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider text,
  model text,
  latency_ms integer,
  prompt_tokens integer,
  completion_tokens integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_message_status_check CHECK (status IN (
    'supported', 'partially_supported', 'no_approved_answer', 'source_conflict',
    'provider_unavailable', 'access_limited', 'error'
  )),
  CONSTRAINT ai_message_mode_check CHECK (knowledge_mode IN (
    'operational', 'training', 'planning', 'historical'
  ))
);

CREATE INDEX IF NOT EXISTS ai_message_conversation_idx
  ON ai_message (tenant_id, conversation_id, created_at);

CREATE TABLE IF NOT EXISTS ai_message_citation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES ai_message(id) ON DELETE CASCADE,
  segment_id uuid NOT NULL REFERENCES knowledge_segment(id) ON DELETE CASCADE,
  source_version_id uuid NOT NULL REFERENCES knowledge_source_version(id) ON DELETE CASCADE,
  ordinal integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, message_id, segment_id)
);

CREATE TABLE IF NOT EXISTS ai_message_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES ai_message(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  feedback_kind text NOT NULL,
  note text,
  review_status text NOT NULL DEFAULT 'open',
  reviewed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, message_id, user_id, feedback_kind),
  CONSTRAINT ai_message_feedback_kind_check CHECK (feedback_kind IN (
    'helpful', 'not_helpful', 'report_incorrect', 'missing_information', 'source_outdated'
  )),
  CONSTRAINT ai_message_feedback_review_check CHECK (review_status IN (
    'open', 'reviewed', 'dismissed'
  ))
);

CREATE INDEX IF NOT EXISTS ai_message_feedback_review_idx
  ON ai_message_feedback (tenant_id, review_status, created_at);

-- ---------------------------------------------------------------------------
-- 6. Unresolved questions — the organizational-learning queue. Deduplicated by
--    a normalized-question hash; frequency and asking departments accumulate.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_unresolved_question (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  normalized_question text NOT NULL,
  question_hash text NOT NULL,
  example_question text NOT NULL,
  occurrence_count integer NOT NULL DEFAULT 1,
  departments_asking text[] NOT NULL DEFAULT '{}',
  roles_asking text[] NOT NULL DEFAULT '{}',
  last_asked_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open',
  assigned_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  -- A proposed answer stays a DRAFT knowledge source version until approved.
  proposed_source_version_id uuid REFERENCES knowledge_source_version(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, question_hash),
  CONSTRAINT ai_unresolved_question_status_check CHECK (status IN (
    'open', 'assigned', 'answered', 'dismissed'
  ))
);

CREATE INDEX IF NOT EXISTS ai_unresolved_question_status_idx
  ON ai_unresolved_question (tenant_id, status, occurrence_count DESC);

-- ---------------------------------------------------------------------------
-- 7. Provider usage — cost/latency accountability per operation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_provider_usage_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  provider text NOT NULL,
  model text,
  operation text NOT NULL,
  prompt_tokens integer,
  completion_tokens integer,
  estimated_cost_cents numeric(10,4),
  latency_ms integer,
  status text NOT NULL DEFAULT 'ok',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_provider_usage_operation_check CHECK (operation IN (
    'generate', 'embed', 'transcribe'
  )),
  CONSTRAINT ai_provider_usage_status_check CHECK (status IN ('ok', 'error', 'timeout'))
);

CREATE INDEX IF NOT EXISTS ai_provider_usage_tenant_idx
  ON ai_provider_usage_event (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 8. RLS on every table.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'knowledge_source',
    'knowledge_source_version',
    'knowledge_segment',
    'knowledge_ingestion_job',
    'knowledge_source_conflict',
    'ai_conversation',
    'ai_message',
    'ai_message_citation',
    'ai_message_feedback',
    'ai_unresolved_question',
    'ai_provider_usage_event'
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

COMMIT;
