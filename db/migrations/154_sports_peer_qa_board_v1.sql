CREATE TABLE IF NOT EXISTS sports_peer_qa_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  production_item_id uuid NOT NULL REFERENCES production_items(id) ON DELETE CASCADE,
  qa_status text NOT NULL,
  sports_job_type text NOT NULL,
  known_exceptions text,
  owner_checklist_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  peer_checklist_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  conditional_checklist_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  correction_category text,
  correction_notes text,
  blocker_reason text,
  blocker_owner text,
  blocker_notes text,
  release_packet_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_for_release_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, production_item_id)
);

CREATE INDEX IF NOT EXISTS sports_peer_qa_reviews_tenant_status_idx
  ON sports_peer_qa_reviews (tenant_id, qa_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS sports_peer_qa_reviews_tenant_job_type_idx
  ON sports_peer_qa_reviews (tenant_id, sports_job_type, qa_status);

DO $$
BEGIN
  EXECUTE 'ALTER TABLE sports_peer_qa_reviews ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE sports_peer_qa_reviews FORCE ROW LEVEL SECURITY';
  DROP POLICY IF EXISTS tenant_isolation_sports_peer_qa_reviews ON sports_peer_qa_reviews;
  CREATE POLICY tenant_isolation_sports_peer_qa_reviews
    ON sports_peer_qa_reviews
    USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
END $$;
