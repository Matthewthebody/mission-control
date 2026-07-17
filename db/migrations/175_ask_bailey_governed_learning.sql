-- Ask Bailey H9 — governed organizational learning + bounded assistive actions.
--
-- Two governed surfaces:
--  1. knowledge_improvement_proposal — evidence-backed proposals (add/update SOP,
--     record a video, add a readiness question, resolve a conflict, add a synonym,
--     clarify location guidance). Proposals are DRAFTS; a human owner accepts or
--     dismisses. Evidence is kept even when dismissed. Deduplicated by dedup_key.
--  2. ai_assistive_action — the preview/confirm/cancel ledger for narrow,
--     permission-checked assistive actions (e.g. draft a pre-shoot huddle from
--     approved sources). Every action previews first, confirms explicitly, writes
--     only through existing typed APIs, is audited, and is duplicate-safe via a
--     unique idempotency_key. Nothing here gives a model arbitrary write authority.
BEGIN;

CREATE TABLE IF NOT EXISTS knowledge_improvement_proposal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  proposal_kind text NOT NULL,
  title text NOT NULL,
  rationale text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  dedup_key text NOT NULL,
  related_source_id uuid REFERENCES knowledge_source(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_improvement_proposal_kind_check CHECK (proposal_kind IN (
    'add_or_update_sop', 'record_training_video', 'add_troubleshooting_segment',
    'add_glossary_synonym', 'resolve_source_conflict', 'add_readiness_question',
    'clarify_location_guidance'
  )),
  CONSTRAINT knowledge_improvement_proposal_status_check CHECK (status IN (
    'draft', 'accepted', 'dismissed', 'superseded'
  ))
);

-- One open draft per dedup_key (regenerating gaps never duplicates a live proposal).
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_improvement_proposal_dedup_idx
  ON knowledge_improvement_proposal (tenant_id, dedup_key)
  WHERE status = 'draft';
CREATE INDEX IF NOT EXISTS knowledge_improvement_proposal_status_idx
  ON knowledge_improvement_proposal (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_assistive_action (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  action_kind text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'previewed',
  preview jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key text NOT NULL,
  result_ref text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  confirmed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_assistive_action_kind_check CHECK (action_kind IN (
    'pre_shoot_huddle', 'training_assignment_draft', 'sop_update_draft',
    'task_or_escalation_note', 'location_history_summary', 'owner_follow_up'
  )),
  CONSTRAINT ai_assistive_action_status_check CHECK (status IN ('previewed', 'confirmed', 'cancelled')),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ai_assistive_action_target_idx
  ON ai_assistive_action (tenant_id, target_type, target_id);

DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['knowledge_improvement_proposal', 'ai_assistive_action']
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
