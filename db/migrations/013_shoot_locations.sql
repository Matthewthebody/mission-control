CREATE TABLE shoot_location (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  external_source text NOT NULL DEFAULT 'cdn',
  external_key text NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  address text,
  normalized_address text,
  location_details text,
  commentary text,
  custodian_contact text,
  photo_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  latitude double precision,
  longitude double precision,
  navigation_url text,
  estimated_drive_minutes integer,
  catalog_raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_catalog_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_source, external_key)
);

CREATE TABLE shoot_location_area (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES shoot_location(id) ON DELETE CASCADE,
  external_key text NOT NULL,
  name text NOT NULL,
  location_details text,
  commentary text,
  photo_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, location_id, external_key)
);

CREATE TABLE shoot_location_alias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES shoot_location(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shoot_location_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid REFERENCES shoot(id) ON DELETE CASCADE,
  outlook_event_id text,
  outlook_calendar_id text,
  shoot_code text,
  event_subject text,
  event_location text,
  location_id uuid NOT NULL REFERENCES shoot_location(id) ON DELETE CASCADE,
  match_status text NOT NULL DEFAULT 'matched',
  match_source text NOT NULL DEFAULT 'auto',
  confidence numeric(5,2),
  linked_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE post_shoot_evaluation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES shoot_location(id) ON DELETE CASCADE,
  shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  outlook_event_id text,
  monday_item_id text,
  shoot_name text NOT NULL,
  shoot_date date NOT NULL,
  photographer_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  photographer_name text NOT NULL,
  shoot_type text NOT NULL,
  on_time text NOT NULL,
  easy_access text NOT NULL,
  overall_rating integer NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  photos_uploaded text NOT NULL,
  late_details text,
  access_details text,
  notes text,
  outreach_notes text,
  recommendations text,
  image_quality text,
  submitted_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'mission_control',
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE setup_photo_upload (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES shoot_location(id) ON DELETE CASCADE,
  shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  outlook_event_id text,
  monday_item_id text,
  monday_asset_id text,
  uploader_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  uploader_name text NOT NULL,
  file_name text NOT NULL,
  content_type text,
  image_url text NOT NULL,
  source text NOT NULL DEFAULT 'mission_control',
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE alert
  ADD COLUMN IF NOT EXISTS resolution_note text;

ALTER TABLE alert
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX shoot_location_tenant_name_idx ON shoot_location (tenant_id, normalized_name);
CREATE INDEX shoot_location_tenant_address_idx ON shoot_location (tenant_id, normalized_address);
CREATE INDEX shoot_location_area_tenant_location_idx ON shoot_location_area (tenant_id, location_id);
CREATE UNIQUE INDEX shoot_location_alias_tenant_alias_uq ON shoot_location_alias (tenant_id, normalized_alias);
CREATE UNIQUE INDEX shoot_location_link_tenant_shoot_uq
  ON shoot_location_link (tenant_id, shoot_id)
  WHERE shoot_id IS NOT NULL;
CREATE UNIQUE INDEX shoot_location_link_tenant_outlook_event_uq
  ON shoot_location_link (tenant_id, outlook_event_id)
  WHERE outlook_event_id IS NOT NULL;
CREATE INDEX post_shoot_evaluation_tenant_location_idx ON post_shoot_evaluation (tenant_id, location_id, shoot_date DESC);
CREATE INDEX post_shoot_evaluation_tenant_photographer_idx ON post_shoot_evaluation (tenant_id, photographer_name, shoot_date DESC);
CREATE INDEX setup_photo_upload_tenant_location_idx ON setup_photo_upload (tenant_id, location_id, uploaded_at DESC);
CREATE INDEX setup_photo_upload_tenant_shoot_idx ON setup_photo_upload (tenant_id, shoot_id, uploaded_at DESC);

ALTER TABLE shoot_location ENABLE ROW LEVEL SECURITY;
ALTER TABLE shoot_location_area ENABLE ROW LEVEL SECURITY;
ALTER TABLE shoot_location_alias ENABLE ROW LEVEL SECURITY;
ALTER TABLE shoot_location_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_shoot_evaluation ENABLE ROW LEVEL SECURITY;
ALTER TABLE setup_photo_upload ENABLE ROW LEVEL SECURITY;

ALTER TABLE shoot_location FORCE ROW LEVEL SECURITY;
ALTER TABLE shoot_location_area FORCE ROW LEVEL SECURITY;
ALTER TABLE shoot_location_alias FORCE ROW LEVEL SECURITY;
ALTER TABLE shoot_location_link FORCE ROW LEVEL SECURITY;
ALTER TABLE post_shoot_evaluation FORCE ROW LEVEL SECURITY;
ALTER TABLE setup_photo_upload FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_shoot_location ON shoot_location
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_shoot_location_area ON shoot_location_area
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_shoot_location_alias ON shoot_location_alias
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_shoot_location_link ON shoot_location_link
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_post_shoot_evaluation ON post_shoot_evaluation
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_setup_photo_upload ON setup_photo_upload
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
