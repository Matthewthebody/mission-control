INSERT INTO permission (code, name) VALUES
  ('shoot.create', 'Create shoots'),
  ('shoot.read', 'Read shoots'),
  ('shoot.update', 'Update shoots'),
  ('shoot.delete', 'Delete shoots'),
  ('status_event.create', 'Create status events'),
  ('time_entry.read', 'Read time entries'),
  ('mileage.create', 'Create mileage claims'),
  ('finance.view', 'View finance data'),
  ('alerts.read', 'Read alerts'),
  ('alerts.resolve', 'Resolve alerts'),
  ('push.manage', 'Manage push tokens')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role (code, name) VALUES
  ('admin', 'Admin'),
  ('photographer', 'Photographer')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
JOIN permission p ON (
  (r.code = 'admin')
  OR (r.code = 'photographer' AND p.code IN ('shoot.read', 'status_event.create', 'time_entry.read', 'mileage.create', 'push.manage'))
)
ON CONFLICT DO NOTHING;
