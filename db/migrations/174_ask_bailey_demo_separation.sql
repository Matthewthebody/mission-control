-- Ask Bailey H8 — demo/production content separation.
--
-- Demo sources were previously identifiable only by a "[DEMO]" title prefix and
-- the seed script. H8 makes the distinction a real, enforceable column so that
-- a production deployment (ASK_BAILEY_ALLOW_DEMO_CONTENT=false) excludes demo
-- content from retrieval INSIDE the eligibility predicate — never by hoping a
-- title convention holds.
BEGIN;

ALTER TABLE knowledge_source
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- Backfill existing seeded demo sources (title convention) to the flag.
UPDATE knowledge_source SET is_demo = true WHERE title LIKE '[DEMO]%' AND is_demo = false;

CREATE INDEX IF NOT EXISTS knowledge_source_is_demo_idx ON knowledge_source (tenant_id, is_demo);

COMMIT;
