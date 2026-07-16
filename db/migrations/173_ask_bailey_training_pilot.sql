-- Ask Bailey H6 — Fall Field Coach role-based training pilot.
-- Design: docs/ask-bailey/2026-07-16-h6-training-pilot.md
--
-- The existing training system (migration 012 + services/trainingCatalog.ts) is a
-- STATIC, code-defined workbook plus per-user progress state. It is not source-backed,
-- not versioned through governance, and not linked to approved Ask Bailey knowledge.
-- H6 adds the smallest coherent GOVERNED lesson layer that is missing: lessons built
-- from approved knowledge source segments, drafts-until-approved, assignable to a
-- controlled pilot cohort, with readiness questions whose scored answers map back to
-- approved lesson/source content.
--
-- Trust rules encoded here:
--  * A lesson answers/teaches only through an APPROVED, effective, non-retired,
--    non-superseded version (mirrors knowledge_source_version governance).
--  * AI may DRAFT content (ai_drafted flag) but never publish; approval is a human act.
--  * Assignments pin an exact lesson_version so retiring/revising a lesson never
--    silently changes what an in-flight assignment teaches.
--  * The pilot is disabled by default (cohort.enabled defaults false).
--  * Readiness results support coaching; nothing here creates discipline or scoring.
-- text + CHECK style throughout, mirroring migrations 165/166/169; RLS on every table.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Governed lesson identity + versioned content.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS training_lesson (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  title text NOT NULL,
  objective text,
  intended_role text,
  intended_department text,
  prerequisite_lesson_id uuid REFERENCES training_lesson(id) ON DELETE SET NULL,
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  current_version_id uuid, -- FK added below (circular)
  is_demo boolean NOT NULL DEFAULT false,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_lesson_title_check CHECK (length(btrim(title)) > 0)
);

CREATE TABLE IF NOT EXISTS training_lesson_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES training_lesson(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  publication_status text NOT NULL DEFAULT 'draft',
  authored_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  approved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  approved_at timestamptz,
  effective_from timestamptz,
  effective_until timestamptz,
  review_due_at timestamptz,
  supersedes_version_id uuid REFERENCES training_lesson_version(id) ON DELETE SET NULL,
  superseded_by_version_id uuid REFERENCES training_lesson_version(id) ON DELETE SET NULL,
  ai_drafted boolean NOT NULL DEFAULT false,
  pass_threshold_percent integer NOT NULL DEFAULT 80,
  review_notes text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_lesson_version_status_check CHECK (publication_status IN (
    'draft', 'pending_review', 'approved', 'rejected', 'retired', 'superseded'
  )),
  CONSTRAINT training_lesson_version_threshold_check CHECK (pass_threshold_percent BETWEEN 0 AND 100),
  UNIQUE (tenant_id, lesson_id, version_number)
);

ALTER TABLE training_lesson
  ADD CONSTRAINT training_lesson_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES training_lesson_version(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS training_lesson_version_lesson_idx
  ON training_lesson_version (tenant_id, lesson_id, version_number DESC);
CREATE INDEX IF NOT EXISTS training_lesson_version_status_idx
  ON training_lesson_version (tenant_id, publication_status);

-- ---------------------------------------------------------------------------
-- 2. Ordered, source-backed lesson sections. A section teaches from an approved
--    knowledge segment (with optional exact video timestamp clip) and/or its own
--    reviewed body text. Timestamps here are only ever copied from a real segment.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS training_lesson_section (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  lesson_version_id uuid NOT NULL REFERENCES training_lesson_version(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  section_kind text NOT NULL DEFAULT 'reading',
  title text NOT NULL,
  body text,
  knowledge_source_version_id uuid REFERENCES knowledge_source_version(id) ON DELETE SET NULL,
  knowledge_segment_id uuid REFERENCES knowledge_segment(id) ON DELETE SET NULL,
  media_start_seconds numeric(9,3),
  media_end_seconds numeric(9,3),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_lesson_section_kind_check CHECK (section_kind IN (
    'reading', 'video_clip', 'checklist', 'scenario'
  )),
  CONSTRAINT training_lesson_section_media_range_check CHECK (
    media_start_seconds IS NULL OR media_end_seconds IS NULL OR media_end_seconds >= media_start_seconds
  ),
  UNIQUE (lesson_version_id, ordinal)
);

CREATE INDEX IF NOT EXISTS training_lesson_section_version_idx
  ON training_lesson_section (tenant_id, lesson_version_id, ordinal);

-- ---------------------------------------------------------------------------
-- 3. Readiness questions. choices is a JSON array of
--    {id,label,correct,explanation}. The scoring rubric IS the correct flags and
--    is visible to authorized reviewers. review_section_id is "what to review"
--    when missed, mapping every scored question back to approved lesson content.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS training_lesson_question (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  lesson_version_id uuid NOT NULL REFERENCES training_lesson_version(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  prompt text NOT NULL,
  scenario text,
  choices jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_section_id uuid REFERENCES training_lesson_section(id) ON DELETE SET NULL,
  knowledge_segment_id uuid REFERENCES knowledge_segment(id) ON DELETE SET NULL,
  allow_open_text boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_lesson_question_prompt_check CHECK (length(btrim(prompt)) > 0),
  UNIQUE (lesson_version_id, ordinal)
);

CREATE INDEX IF NOT EXISTS training_lesson_question_version_idx
  ON training_lesson_question (tenant_id, lesson_version_id, ordinal);

-- ---------------------------------------------------------------------------
-- 4. Pilot cohort + explicit membership. Disabled by default.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS training_pilot_cohort (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft',
  enabled boolean NOT NULL DEFAULT false,
  is_demo boolean NOT NULL DEFAULT false,
  starts_on date,
  ends_on date,
  content_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  support_contact text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_pilot_cohort_name_check CHECK (length(btrim(name)) > 0),
  CONSTRAINT training_pilot_cohort_status_check CHECK (status IN ('draft', 'active', 'ended'))
);

CREATE TABLE IF NOT EXISTS training_pilot_cohort_member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  cohort_id uuid NOT NULL REFERENCES training_pilot_cohort(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  added_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, cohort_id, user_id)
);

CREATE INDEX IF NOT EXISTS training_pilot_cohort_member_user_idx
  ON training_pilot_cohort_member (tenant_id, user_id);

-- ---------------------------------------------------------------------------
-- 5. Assignments pin an exact approved lesson version to an employee.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS training_lesson_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES training_lesson(id) ON DELETE CASCADE,
  lesson_version_id uuid NOT NULL REFERENCES training_lesson_version(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  cohort_id uuid REFERENCES training_pilot_cohort(id) ON DELETE SET NULL,
  assigned_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  assignment_reason text,
  status text NOT NULL DEFAULT 'assigned',
  due_at timestamptz,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT training_lesson_assignment_status_check CHECK (status IN (
    'assigned', 'in_progress', 'completed', 'cancelled'
  )),
  UNIQUE (tenant_id, lesson_version_id, user_id)
);

CREATE INDEX IF NOT EXISTS training_lesson_assignment_user_idx
  ON training_lesson_assignment (tenant_id, user_id, status);
CREATE INDEX IF NOT EXISTS training_lesson_assignment_lesson_idx
  ON training_lesson_assignment (tenant_id, lesson_id);

-- ---------------------------------------------------------------------------
-- 6. Per-assignment progress + acknowledgment.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS training_lesson_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES training_lesson_assignment(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  viewed_section_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  progress_percent integer NOT NULL DEFAULT 0,
  acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_at timestamptz,
  last_viewed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_lesson_progress_percent_check CHECK (progress_percent BETWEEN 0 AND 100),
  UNIQUE (assignment_id)
);

-- ---------------------------------------------------------------------------
-- 7. Readiness attempts (lesson-scoped). answers/missed map back to content.
--    needs_human_review flags ambiguous open-text answers for a person.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS training_readiness_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES training_lesson_assignment(id) ON DELETE CASCADE,
  lesson_version_id uuid NOT NULL REFERENCES training_lesson_version(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  score_percent integer NOT NULL,
  passed boolean NOT NULL DEFAULT false,
  correct_count integer NOT NULL DEFAULT 0,
  question_count integer NOT NULL DEFAULT 0,
  missed_question_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  needs_human_review boolean NOT NULL DEFAULT false,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  played_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_readiness_attempt_score_check CHECK (score_percent BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS training_readiness_attempt_assignment_idx
  ON training_readiness_attempt (tenant_id, assignment_id, played_at DESC);
CREATE INDEX IF NOT EXISTS training_readiness_attempt_user_idx
  ON training_readiness_attempt (tenant_id, user_id, played_at DESC);

-- ---------------------------------------------------------------------------
-- 8. RLS on every table (tenant isolation; finer authorization is in service code).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'training_lesson',
    'training_lesson_version',
    'training_lesson_section',
    'training_lesson_question',
    'training_pilot_cohort',
    'training_pilot_cohort_member',
    'training_lesson_assignment',
    'training_lesson_progress',
    'training_readiness_attempt'
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
