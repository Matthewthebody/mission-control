CREATE TABLE outlook_calendar_visibility_preference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  calendar_id text NOT NULL,
  visible_in_app boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, calendar_id)
);

CREATE INDEX outlook_calendar_visibility_tenant_user_idx
  ON outlook_calendar_visibility_preference (tenant_id, user_id, updated_at DESC);

ALTER TABLE outlook_calendar_visibility_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE outlook_calendar_visibility_preference FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_outlook_calendar_visibility_preference ON outlook_calendar_visibility_preference
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
