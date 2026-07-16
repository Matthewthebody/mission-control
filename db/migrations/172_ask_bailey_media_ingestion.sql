-- 172: Ask Bailey real media ingestion (charter H3).
--
-- 1. Segment review: reviewer corrections preserve the provider's original
--    text, carry notes and optional word timings, and classification gains
--    the full H3 vocabulary. Classification drives retrieval eligibility
--    (SEGMENT_ELIGIBILITY_SQL in knowledgeGovernance.ts).
-- 2. Ingestion jobs: cancellation state, preserved raw provider payload for
--    audit, and the provider request id for observability.
-- 3. Versions: stored media duration so no citation timestamp can ever
--    exceed the known length of the source media.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Segment review + classification vocabulary.
-- ---------------------------------------------------------------------------
ALTER TABLE knowledge_segment
  ADD COLUMN IF NOT EXISTS original_content text,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS word_timings jsonb;

ALTER TABLE knowledge_segment DROP CONSTRAINT IF EXISTS knowledge_segment_classification_check;
ALTER TABLE knowledge_segment ADD CONSTRAINT knowledge_segment_classification_check CHECK (
  reviewer_classification IS NULL OR reviewer_classification IN (
    'approved_instruction', 'approved_training', 'current_workflow_observation',
    'pain_point', 'future_design_idea', 'raw_discussion', 'evidence_only',
    'historical_reference', 'restricted'
  )
);

-- ---------------------------------------------------------------------------
-- 2. Ingestion job lifecycle additions.
-- ---------------------------------------------------------------------------
ALTER TABLE knowledge_ingestion_job
  ADD COLUMN IF NOT EXISTS provider_payload jsonb,
  ADD COLUMN IF NOT EXISTS provider_request_id text;

ALTER TABLE knowledge_ingestion_job DROP CONSTRAINT IF EXISTS knowledge_ingestion_job_status_check;
ALTER TABLE knowledge_ingestion_job ADD CONSTRAINT knowledge_ingestion_job_status_check CHECK (status IN (
  'queued', 'processing', 'needs_review', 'completed', 'failed', 'not_configured', 'canceled'
));

-- ---------------------------------------------------------------------------
-- 3. Stored media duration (timestamp-validation boundary).
-- ---------------------------------------------------------------------------
ALTER TABLE knowledge_source_version
  ADD COLUMN IF NOT EXISTS media_duration_seconds numeric(10,2);

COMMIT;
