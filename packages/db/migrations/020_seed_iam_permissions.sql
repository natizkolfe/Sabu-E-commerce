-- MIGRATION 020 - seed IAM permissions and role grants --------------------
INSERT INTO iam.permissions (code, module, description) VALUES
  ('catalog.read', 'catalog', 'View catalog'),
  ('catalog.write', 'catalog', 'Manage catalog'),
  ('orders.read', 'sales', 'View orders'),
  ('orders.write', 'sales', 'Create/update orders'),
  ('inventory.read', 'inventory', 'View stock'),
  ('inventory.write', 'inventory', 'Adjust/transfer stock'),
  ('payments.read', 'payments', 'View payments'),
  ('payments.refund.approve', 'payments', 'Approve refunds'),
  ('delivery.read', 'delivery', 'View deliveries'),
  ('delivery.write', 'delivery', 'Assign/manage deliveries'),
  ('procurement.read', 'procurement', 'View special orders / POs'),
  ('procurement.write', 'procurement', 'Manage procurement'),
  ('finance.read', 'finance', 'View finance'),
  ('finance.write', 'finance', 'Manage finance'),
  ('users.read', 'iam', 'View users'),
  ('users.write', 'iam', 'Manage users and roles')
ON CONFLICT (code) DO NOTHING;

-- Super admin gets every permission
INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code = 'super_admin'
ON CONFLICT DO NOTHING;

-- Retail customers: browse + place orders
INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
JOIN iam.permissions p ON p.code IN ('catalog.read', 'orders.read', 'orders.write')
WHERE r.code = 'retail_customer'
ON CONFLICT DO NOTHING;

-- Wholesale customers: same as retail for MVP
INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
JOIN iam.permissions p ON p.code IN ('catalog.read', 'orders.read', 'orders.write')
WHERE r.code = 'wholesale_customer'
ON CONFLICT DO NOTHING;

-- Ethiopia operations admin
INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
JOIN iam.permissions p ON p.code IN (
  'catalog.read','catalog.write','orders.read','orders.write',
  'inventory.read','inventory.write','delivery.read','delivery.write',
  'payments.read','users.read'
)
WHERE r.code = 'et_operations_admin'
ON CONFLICT DO NOTHING;
