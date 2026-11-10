-- MIGRATION 029 - give Ethiopia ops admin AI Studio access

INSERT INTO iam.permissions (code, module, description) VALUES
  ('studio.generate', 'studio', 'Run AI try-on generation'),
  ('studio.publish', 'studio', 'Approve and publish AI previews')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code IN ('et_operations_admin', 'super_admin')
  AND p.code IN ('studio.generate', 'studio.publish')
ON CONFLICT DO NOTHING;
