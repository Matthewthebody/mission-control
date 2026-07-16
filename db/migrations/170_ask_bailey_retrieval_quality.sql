-- 170: Ask Bailey retrieval quality (charter H1).
--
-- 1. Language-aware full text: knowledge_segment.search_document moves from
--    the 'simple' configuration to 'english' so inflections stem (drop /
--    drops / dropped all resolve to the same lexeme). Proper nouns such as
--    Captura or Smart Shooter pass through unstemmed.
-- 2. Typo tolerance: pg_trgm trigram index over segment content supports
--    bounded word-similarity credit for near-miss terms.
-- 3. Company-owned synonym/acronym map: knowledge_synonym, reviewer-managed
--    and audited; query expansion only ever widens through APPROVED mappings.
-- 4. Embedding lifecycle storage: knowledge_segment_embedding keeps vectors
--    INSIDE the governed schema, joined to segments so the eligibility
--    predicate applies to the semantic path exactly as it does to lexical.
--
--    Forward-safety note: this PostgreSQL image does not ship the pgvector
--    extension, so vectors are stored as double precision[] and similarity is
--    computed at pilot scale by the service over eligibility-filtered rows.
--    When a pgvector-enabled image is adopted, a follow-up migration can add
--    a typed vector column + ANN index without changing the lifecycle,
--    fingerprints, or any authorization behavior.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- 1. English-stemmed search document (generated column swap).
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS knowledge_segment_search_idx;
ALTER TABLE knowledge_segment DROP COLUMN IF EXISTS search_document;
ALTER TABLE knowledge_segment ADD COLUMN search_document tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(heading, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(locator_label, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(content, '')), 'C')
) STORED;
CREATE INDEX IF NOT EXISTS knowledge_segment_search_idx
  ON knowledge_segment USING gin (search_document);

-- ---------------------------------------------------------------------------
-- 2. Trigram support for controlled typo tolerance.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS knowledge_segment_content_trgm_idx
  ON knowledge_segment USING gin (content gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 3. Company-owned synonym / acronym mappings.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_synonym (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  term text NOT NULL,
  expansion text[] NOT NULL,
  note text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, term),
  CONSTRAINT knowledge_synonym_term_lower_check CHECK (term = lower(term)),
  CONSTRAINT knowledge_synonym_expansion_check CHECK (cardinality(expansion) > 0)
);

CREATE INDEX IF NOT EXISTS knowledge_synonym_tenant_idx
  ON knowledge_synonym (tenant_id, term);

-- ---------------------------------------------------------------------------
-- 4. Embedding lifecycle storage (governed, RLS, eligibility via joins).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_segment_embedding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  segment_id uuid NOT NULL REFERENCES knowledge_segment(id) ON DELETE CASCADE,
  source_version_id uuid NOT NULL REFERENCES knowledge_source_version(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text NOT NULL,
  dimensions integer NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  content_fingerprint text NOT NULL,
  embedding double precision[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, segment_id, provider, model),
  CONSTRAINT knowledge_segment_embedding_status_check CHECK (status IN (
    'pending', 'completed', 'failed'
  ))
);

CREATE INDEX IF NOT EXISTS knowledge_segment_embedding_status_idx
  ON knowledge_segment_embedding (tenant_id, status, updated_at);
CREATE INDEX IF NOT EXISTS knowledge_segment_embedding_version_idx
  ON knowledge_segment_embedding (tenant_id, source_version_id);

-- ---------------------------------------------------------------------------
-- 5. RLS on the new tables (same pattern as migration 169).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'knowledge_synonym',
    'knowledge_segment_embedding'
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
