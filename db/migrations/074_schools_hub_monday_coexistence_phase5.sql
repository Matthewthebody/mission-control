CREATE INDEX IF NOT EXISTS external_object_map_tenant_provider_object_lookup_idx
  ON external_object_map (tenant_id, provider, object_type, object_id);

CREATE INDEX IF NOT EXISTS integration_sync_operation_tenant_provider_entity_created_idx
  ON integration_sync_operation (tenant_id, provider, entity_type, entity_id, created_at DESC);
