BEGIN;

DELETE FROM role_permission_grant
USING role, permission
WHERE role_permission_grant.role_id = role.id
  AND role_permission_grant.permission_id = permission.id
  AND role.code = 'leadership'
  AND permission.code IN ('settings.permissions.read', 'access_preview.use', 'auditlog.read');

INSERT INTO section_visibility_rule (resource_type, section_key, required_permission_code, sensitivity_category, default_visibility, department_type)
SELECT values_table.resource_type,
       values_table.section_key,
       values_table.required_permission_code,
       values_table.sensitivity_category::sensitivity_category_type,
       values_table.default_visibility::visibility_state_type,
       values_table.department_type
FROM (
  VALUES
    ('shared_job', 'production', 'production.read', 'operational_sensitive', 'hidden', NULL),
    ('shared_job', 'approvals', 'approval.read', 'operational_sensitive', 'hidden', NULL),
    ('shared_job', 'qa', 'qa.read', 'operational_sensitive', 'hidden', NULL),
    ('shared_job', 'deliverables', 'deliverable.read', 'operational_sensitive', 'hidden', NULL),
    ('shared_job', 'watch_flags', 'watchlist.read', 'operational_sensitive', 'hidden', NULL),
    ('shared_job', 'activity', 'job.read', 'operational_standard', 'readonly', NULL)
) AS values_table(resource_type, section_key, required_permission_code, sensitivity_category, default_visibility, department_type)
WHERE NOT EXISTS (
  SELECT 1
  FROM section_visibility_rule existing
  WHERE existing.resource_type = values_table.resource_type
    AND existing.section_key = values_table.section_key
    AND existing.department_type IS NOT DISTINCT FROM values_table.department_type
);

COMMIT;
