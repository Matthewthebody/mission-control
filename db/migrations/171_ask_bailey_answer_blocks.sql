-- 171: Ask Bailey claim-level answer blocks (charter H2-C).
--
-- Answers become ordered blocks, each carrying the segment ids that support
-- it — validated server-side against the authorized retrieved set before
-- anything is stored or rendered. answer_markdown remains the plain-text
-- rendering of the validated blocks for history and backward compatibility.

BEGIN;

ALTER TABLE ai_message
  ADD COLUMN IF NOT EXISTS answer_blocks jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
