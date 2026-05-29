CREATE TYPE microsoft_integration_area AS ENUM (
  'auth',
  'account_linking',
  'outlook_calendar_sync',
  'teams_alerts',
  'teams_search',
  'teams_personal_app',
  'config'
);

CREATE TYPE microsoft_integration_event_level AS ENUM ('info', 'warning', 'error');

CREATE TABLE microsoft_integration_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL REFERENCES tenant(id) ON DELETE CASCADE,
  integration_area microsoft_integration_area NOT NULL,
  event_level microsoft_integration_event_level NOT NULL,
  event_type text NOT NULL,
  event_status text NOT NULL DEFAULT 'observed',
  summary text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text NULL,
  trace_id text NULL,
  actor_user_id uuid NULL REFERENCES app_user(id) ON DELETE SET NULL,
  related_entity_type text NULL,
  related_entity_id text NULL,
  external_target text NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX microsoft_integration_event_tenant_area_occurred_idx
  ON microsoft_integration_event (tenant_id, integration_area, occurred_at DESC);

CREATE INDEX microsoft_integration_event_area_level_occurred_idx
  ON microsoft_integration_event (integration_area, event_level, occurred_at DESC);

CREATE INDEX microsoft_integration_event_request_idx
  ON microsoft_integration_event (request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX microsoft_integration_event_trace_idx
  ON microsoft_integration_event (trace_id)
  WHERE trace_id IS NOT NULL;
