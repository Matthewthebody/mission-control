-- migrate: no-transaction
-- Kemmetmueller Concierge Phase 1 relies on broad text lookup across directory
-- and task records. These trigram indexes keep the initial shared search fast
-- without tying the app to a single search engine implementation.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS organization_display_name_trgm_idx
  ON organization
  USING gin (lower(display_name) gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS organization_normalized_name_trgm_idx
  ON organization
  USING gin (normalized_canonical_name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS organization_alias_normalized_alias_trgm_idx
  ON organization_alias
  USING gin (normalized_alias gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS organization_contact_normalized_name_trgm_idx
  ON organization_contact
  USING gin (normalized_full_name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS organization_contact_email_trgm_idx
  ON organization_contact
  USING gin (lower(coalesce(email, '')) gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS shoot_location_normalized_name_trgm_idx
  ON shoot_location
  USING gin (normalized_name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS shoot_location_normalized_address_trgm_idx
  ON shoot_location
  USING gin (coalesce(normalized_address, '') gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS work_task_title_trgm_idx
  ON work_task
  USING gin (lower(title) gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS work_task_description_trgm_idx
  ON work_task
  USING gin (lower(coalesce(description, '')) gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS work_task_number_trgm_idx
  ON work_task
  USING gin (lower(task_number) gin_trgm_ops);
