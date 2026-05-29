ALTER TABLE schedule_event
  ADD COLUMN outlook_organizer text,
  ADD COLUMN outlook_timezone text,
  ADD COLUMN outlook_all_day boolean NOT NULL DEFAULT false,
  ADD COLUMN outlook_attendees jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN outlook_recurrence_master_id text,
  ADD COLUMN outlook_recurrence_occurrence_id text,
  ADD COLUMN outlook_body_preview text,
  ADD COLUMN outlook_cancellation_state text,
  ADD COLUMN external_last_modified_at timestamptz,
  ADD COLUMN last_sync_direction text,
  ADD COLUMN sync_review_required boolean NOT NULL DEFAULT false,
  ADD COLUMN sync_review_reason text,
  ADD COLUMN sync_review_acknowledged_at timestamptz,
  ADD COLUMN sync_review_acknowledged_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN external_changed_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN external_change_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX schedule_event_tenant_review_idx
  ON schedule_event (tenant_id, sync_review_required, starts_at DESC)
  WHERE deleted_at IS NULL;
