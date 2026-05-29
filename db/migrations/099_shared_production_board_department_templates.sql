ALTER TABLE production_items
  ADD COLUMN IF NOT EXISTS production_template_key text,
  ADD COLUMN IF NOT EXISTS completion_rule_key text,
  ADD COLUMN IF NOT EXISTS imported_status_source text,
  ADD COLUMN IF NOT EXISTS legacy_owner_history_json jsonb;

ALTER TABLE deliverable_items
  ADD COLUMN IF NOT EXISTS parent_deliverable_item_id uuid REFERENCES deliverable_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deliverable_group_key text,
  ADD COLUMN IF NOT EXISTS legacy_source_reference text,
  ADD COLUMN IF NOT EXISTS completion_marker_key text;

CREATE INDEX IF NOT EXISTS production_items_template_idx
  ON production_items (tenant_id, department_type, production_template_key, workflow_status, due_at);

CREATE INDEX IF NOT EXISTS production_items_completion_rule_idx
  ON production_items (tenant_id, completion_rule_key, completed_at, closed_at);

CREATE INDEX IF NOT EXISTS deliverable_items_group_idx
  ON deliverable_items (tenant_id, production_item_id, deliverable_group_key, completion_marker_key, status, created_at DESC);

CREATE INDEX IF NOT EXISTS deliverable_items_parent_idx
  ON deliverable_items (tenant_id, parent_deliverable_item_id, created_at DESC)
  WHERE parent_deliverable_item_id IS NOT NULL;

WITH resolved_template AS (
  SELECT
    item.id,
    CASE
      WHEN lower(coalesce(item.title, '')) LIKE '%photos over time%'
        OR lower(coalesce(item.title, '')) LIKE '%preload%'
        OR lower(coalesce(item.production_type, '')) LIKE '%photos_over_time%'
        OR lower(coalesce(item.production_type, '')) LIKE '%preload%'
        THEN 'photos_over_time'
      WHEN item.department_type = 'schools'::job_department_type
        THEN 'schools_workflow'
      WHEN item.department_type = 'sports'::job_department_type
        AND (
          item.job_type IN ('specialty', 'banner_day')
          OR lower(coalesce(item.production_type, '')) ~ '(banner|specialty|poster|memory|trader|vendor|print)'
          OR coalesce(item.vendor_name, '') <> ''
          OR (
            coalesce(item.release_target, '') <> ''
            AND lower(coalesce(item.release_target, '')) NOT IN ('gallery', 'standard_gallery', 'team_gallery', 'portal', 'admin_portal')
          )
        )
        THEN 'specialty_workflow'
      WHEN item.department_type = 'sports'::job_department_type
        THEN 'sports_workflow'
      WHEN item.job_type IN ('specialty', 'banner_day')
        THEN 'specialty_workflow'
      ELSE 'specialty_workflow'
    END AS template_key
  FROM production_items item
)
UPDATE production_items item
SET
  production_template_key = COALESCE(item.production_template_key, resolved_template.template_key),
  completion_rule_key = COALESCE(
    item.completion_rule_key,
    CASE resolved_template.template_key
      WHEN 'schools_workflow' THEN 'schools_gallery_or_email'
      WHEN 'sports_workflow' THEN 'sports_release_date_or_legacy_finished'
      WHEN 'photos_over_time' THEN 'photos_over_time_event'
      ELSE 'specialty_template_marker'
    END
  )
FROM resolved_template
WHERE resolved_template.id = item.id
  AND (
    item.production_template_key IS NULL
    OR item.completion_rule_key IS NULL
  );

UPDATE deliverable_items
SET
  deliverable_group_key = COALESCE(
    deliverable_group_key,
    CASE
      WHEN deliverable_type IN ('gallery_live', 'gallery_email_sent', 'admin_portal_ready') THEN 'gallery'
      WHEN deliverable_type IN ('yearbook_export_sent', 'composite_delivered') THEN 'yearbook'
      WHEN deliverable_type IN ('id_cards_delivered', 'id_package_delivered') THEN 'id_package'
      WHEN deliverable_type IN ('banner_delivered') THEN 'banners'
      WHEN deliverable_type IN ('proof_packet_delivered') THEN 'proofs'
      WHEN deliverable_type IN ('specialty_products_delivered', 'poster_delivered') THEN 'specialty_products'
      WHEN deliverable_type IN ('vendor_output_sent', 'vendor_print_batch_sent') THEN 'vendor'
      ELSE regexp_replace(lower(coalesce(deliverable_type, 'deliverable')), '[^a-z0-9]+', '_', 'g')
    END
  ),
  completion_marker_key = COALESCE(
    completion_marker_key,
    CASE
      WHEN deliverable_type = 'gallery_live' THEN 'gallery_release_event'
      WHEN deliverable_type = 'gallery_email_sent' THEN 'gallery_email_sent'
      WHEN deliverable_type = 'admin_portal_ready' THEN 'admin_portal_ready'
      WHEN deliverable_type = 'yearbook_export_sent' THEN 'yearbook_export_sent'
      WHEN deliverable_type = 'id_cards_delivered' THEN 'id_package_delivered'
      WHEN deliverable_type = 'id_package_delivered' THEN 'id_package_delivered'
      WHEN deliverable_type = 'composite_delivered' THEN 'composite_delivered'
      WHEN deliverable_type = 'proof_packet_delivered' THEN 'proof_approval'
      WHEN deliverable_type = 'banner_delivered' THEN 'banner_delivery_confirmation'
      WHEN deliverable_type = 'poster_delivered' THEN 'delivery_confirmation'
      WHEN deliverable_type = 'specialty_products_delivered' THEN 'specialty_delivery_confirmation'
      WHEN deliverable_type = 'vendor_output_sent' THEN 'vendor_submission'
      WHEN deliverable_type = 'vendor_print_batch_sent' THEN 'vendor_submission'
      ELSE null
    END
  )
WHERE deliverable_group_key IS NULL
   OR completion_marker_key IS NULL;
