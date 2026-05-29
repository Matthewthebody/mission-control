INSERT INTO permission (code, name) VALUES
  ('schedule.read', 'Read schedules and calendar views'),
  ('schedule.manage', 'Create and edit schedules'),
  ('schedule.publish', 'Publish schedule changes'),
  ('attendance.read', 'Read attendance exceptions and punches'),
  ('attendance.manage', 'Review and classify attendance issues'),
  ('trade.request', 'Request shift trades'),
  ('trade.approve', 'Approve shift trades'),
  ('pto.request', 'Request PTO'),
  ('notification.read', 'Read in-app notifications'),
  ('dashboard.read', 'Read operational dashboards')
ON CONFLICT (code) DO NOTHING;

WITH role_permissions AS (
  SELECT 'owner_admin'::text AS role_code, unnest(ARRAY[
    'schedule.read',
    'schedule.manage',
    'schedule.publish',
    'attendance.read',
    'attendance.manage',
    'trade.request',
    'trade.approve',
    'pto.request',
    'notification.read',
    'dashboard.read'
  ]) AS permission_code

  UNION ALL
  SELECT 'admin', unnest(ARRAY[
    'schedule.read',
    'attendance.read',
    'notification.read',
    'dashboard.read',
    'trade.request',
    'pto.request'
  ])

  UNION ALL
  SELECT 'leadership', unnest(ARRAY[
    'schedule.read',
    'schedule.manage',
    'schedule.publish',
    'attendance.read',
    'attendance.manage',
    'trade.request',
    'trade.approve',
    'pto.request',
    'notification.read',
    'dashboard.read'
  ])

  UNION ALL
  SELECT 'senior_photographer', unnest(ARRAY[
    'schedule.read',
    'attendance.read',
    'attendance.manage',
    'trade.request',
    'trade.approve',
    'pto.request',
    'notification.read',
    'dashboard.read'
  ])

  UNION ALL
  SELECT 'associate_photographer', unnest(ARRAY[
    'schedule.read',
    'attendance.read',
    'trade.request',
    'pto.request',
    'notification.read'
  ])

  UNION ALL
  SELECT 'photographer', unnest(ARRAY[
    'schedule.read',
    'attendance.read',
    'trade.request',
    'pto.request',
    'notification.read'
  ])

  UNION ALL
  SELECT 'office_employee', unnest(ARRAY[
    'schedule.read',
    'attendance.read',
    'pto.request',
    'notification.read'
  ])
)
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role_permissions rp
JOIN role r ON r.code = rp.role_code
JOIN permission p ON p.code = rp.permission_code
ON CONFLICT DO NOTHING;
