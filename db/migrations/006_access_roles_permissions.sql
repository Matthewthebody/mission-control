INSERT INTO permission (code, name) VALUES
  ('time.clock', 'Clock into or out of shoots'),
  ('upload.presign', 'Create upload presign requests'),
  ('media.attach', 'Attach uploaded media to shoots'),
  ('user.read', 'Read users and memberships'),
  ('user.invite', 'Invite users'),
  ('user.approve', 'Approve pending users'),
  ('user.role.update', 'Change user roles'),
  ('user.department.update', 'Change user departments'),
  ('user.suspend', 'Suspend users'),
  ('user.reactivate', 'Reactivate suspended users'),
  ('user.revoke', 'Revoke users'),
  ('audit.read', 'Read security audit logs'),
  ('security.manage', 'Manage security-sensitive settings')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role (code, name) VALUES
  ('owner_admin', 'Owner Admin'),
  ('leadership', 'Leadership'),
  ('senior_photographer', 'Senior Photographer'),
  ('associate_photographer', 'Associate Photographer'),
  ('office_employee', 'Office Employee')
ON CONFLICT (code) DO NOTHING;

WITH role_permissions AS (
  SELECT 'owner_admin'::text AS role_code, p.code AS permission_code
  FROM permission p

  UNION ALL
  SELECT 'admin', unnest(ARRAY[
    'shoot.create',
    'shoot.read',
    'shoot.update',
    'shoot.delete',
    'status_event.create',
    'time.clock',
    'time_entry.read',
    'mileage.create',
    'finance.view',
    'alerts.read',
    'alerts.resolve',
    'push.manage',
    'upload.presign',
    'media.attach',
    'user.read',
    'user.invite',
    'user.approve',
    'user.role.update',
    'user.department.update',
    'user.suspend',
    'user.reactivate',
    'user.revoke',
    'audit.read',
    'security.manage'
  ])

  UNION ALL
  SELECT 'leadership', unnest(ARRAY[
    'shoot.create',
    'shoot.read',
    'shoot.update',
    'shoot.delete',
    'status_event.create',
    'time.clock',
    'time_entry.read',
    'mileage.create',
    'finance.view',
    'alerts.read',
    'alerts.resolve',
    'push.manage',
    'upload.presign',
    'media.attach'
  ])

  UNION ALL
  SELECT 'senior_photographer', unnest(ARRAY[
    'shoot.read',
    'status_event.create',
    'time.clock',
    'time_entry.read',
    'mileage.create',
    'push.manage',
    'upload.presign',
    'media.attach'
  ])

  UNION ALL
  SELECT 'associate_photographer', unnest(ARRAY[
    'shoot.read',
    'status_event.create',
    'time.clock',
    'time_entry.read',
    'mileage.create',
    'push.manage',
    'upload.presign',
    'media.attach'
  ])

  UNION ALL
  SELECT 'photographer', unnest(ARRAY[
    'shoot.read',
    'status_event.create',
    'time.clock',
    'time_entry.read',
    'mileage.create',
    'push.manage',
    'upload.presign',
    'media.attach'
  ])

  UNION ALL
  SELECT 'office_employee', unnest(ARRAY[
    'shoot.read',
    'alerts.read'
  ])
)
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role_permissions rp
JOIN role r ON r.code = rp.role_code
JOIN permission p ON p.code = rp.permission_code
ON CONFLICT DO NOTHING;
