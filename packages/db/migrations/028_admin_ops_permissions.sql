-- MIGRATION 028 - ensure ops admin can dispatch + verify payments

INSERT INTO iam.permissions (code, module, description) VALUES
  ('delivery.dispatch', 'delivery', 'Assign drivers and manage deliveries'),
  ('delivery.read', 'delivery', 'View delivery queue and status'),
  ('payments.verify', 'payments', 'Verify bank transfer receipts')
ON CONFLICT (code) DO NOTHING;

-- Ethiopia ops admin: dispatch + payment verification
INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code = 'et_operations_admin'
  AND p.code IN (
    'delivery.dispatch', 'delivery.read', 'delivery.write',
    'payments.read', 'payments.verify',
    'catalog.read', 'catalog.write',
    'orders.read', 'orders.write',
    'inventory.read', 'inventory.write',
    'users.read'
  )
ON CONFLICT DO NOTHING;

-- Super admin gets any newly added permissions
INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code = 'super_admin'
ON CONFLICT DO NOTHING;

-- Promote existing mistaken admin-web retail logins to staff ops
UPDATE iam.users u
SET user_type = 'staff', updated_at = now()
WHERE u.user_type = 'customer'
  AND u.full_name ILIKE 'Admin%'
  AND u.phone_e164 IS NOT NULL;

INSERT INTO iam.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM iam.users u
CROSS JOIN iam.roles r
WHERE u.user_type = 'staff'
  AND r.code = 'et_operations_admin'
  AND NOT EXISTS (
    SELECT 1 FROM iam.user_roles ur
    WHERE ur.user_id = u.id AND ur.role_id = r.id
  );
