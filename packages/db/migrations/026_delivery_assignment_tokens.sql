-- MIGRATION 026 - driver offer tokens, QR/PIN PoD, dispatch settings ------

ALTER TABLE delivery.driver_assignments
  ADD COLUMN IF NOT EXISTS offer_token_hash BYTEA,
  ADD COLUMN IF NOT EXISTS offer_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eta_minutes INT CHECK (eta_minutes IS NULL OR eta_minutes > 0),
  ADD COLUMN IF NOT EXISTS whatsapp_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_assignment_offer_token
  ON delivery.driver_assignments (offer_token_hash)
  WHERE offer_token_hash IS NOT NULL;

ALTER TABLE delivery.deliveries
  ADD COLUMN IF NOT EXISTS qr_token_hash BYTEA,
  ADD COLUMN IF NOT EXISTS pin_hash BYTEA,
  -- Short-lived plaintext for customer display / WhatsApp; cleared after verify
  ADD COLUMN IF NOT EXISTS qr_token_plain TEXT,
  ADD COLUMN IF NOT EXISTS pin_plain TEXT,
  ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_method TEXT
    CHECK (verified_method IS NULL OR verified_method IN ('qr','pin')),
  ADD COLUMN IF NOT EXISTS package_count SMALLINT NOT NULL DEFAULT 1
    CHECK (package_count > 0),
  ADD COLUMN IF NOT EXISTS delivery_instructions TEXT,
  ADD COLUMN IF NOT EXISTS eta_minutes INT CHECK (eta_minutes IS NULL OR eta_minutes > 0);

-- Extend PoD methods for QR / PIN
ALTER TABLE delivery.proof_of_delivery DROP CONSTRAINT IF EXISTS proof_of_delivery_method_check;
ALTER TABLE delivery.proof_of_delivery
  ADD CONSTRAINT proof_of_delivery_method_check
  CHECK (method IN ('otp','signature','photo','otp_and_photo','qr','pin','qr_and_pin'));

ALTER TABLE delivery.proof_of_delivery DROP CONSTRAINT IF EXISTS proof_of_delivery_check;
ALTER TABLE delivery.proof_of_delivery DROP CONSTRAINT IF EXISTS proof_of_delivery_check1;
ALTER TABLE delivery.proof_of_delivery DROP CONSTRAINT IF EXISTS proof_of_delivery_check2;

-- Soften legacy checks; enforce in app for qr/pin
ALTER TABLE delivery.proof_of_delivery
  ADD CONSTRAINT proof_of_delivery_sig_check
  CHECK (method <> 'signature' OR signature_key IS NOT NULL),
  ADD CONSTRAINT proof_of_delivery_photo_check
  CHECK (method NOT IN ('photo','otp_and_photo') OR photo_key IS NOT NULL);

CREATE TABLE IF NOT EXISTS delivery.dispatch_settings (
  id                    SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  offer_ttl_minutes     INT NOT NULL DEFAULT 15 CHECK (offer_ttl_minutes BETWEEN 5 AND 240),
  default_speed_kmh     NUMERIC(6,2) NOT NULL DEFAULT 25 CHECK (default_speed_kmh > 0),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO delivery.dispatch_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- Permissions
INSERT INTO iam.permissions (code, module, description) VALUES
  ('delivery.dispatch', 'delivery', 'Assign drivers and manage deliveries'),
  ('delivery.read', 'delivery', 'View delivery queue and status')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code IN ('super_admin','warehouse_manager','logistics_manager','et_operations_admin')
  AND p.code IN ('delivery.dispatch','delivery.read')
ON CONFLICT DO NOTHING;

-- Demo drivers (Abebe + Sara) for WhatsApp assignment flow
DO $$
DECLARE
  region UUID;
  zone UUID;
  u1 UUID;
  u2 UUID;
  dummy_enc BYTEA := decode('00','hex');
  dummy_hash1 BYTEA := decode(encode(sha256('demo-license-abebe'::bytea), 'hex'), 'hex');
  dummy_hash2 BYTEA := decode(encode(sha256('demo-license-sara'::bytea), 'hex'), 'hex');
BEGIN
  SELECT id INTO region FROM core.operating_regions WHERE code = 'ET' LIMIT 1;
  IF region IS NULL THEN RETURN; END IF;

  SELECT id INTO zone FROM delivery.delivery_zones WHERE name = 'Addis Demo Zone' LIMIT 1;
  IF zone IS NULL THEN
    INSERT INTO delivery.delivery_zones (
      region_id, name, boundary, base_fee, fee_per_km, currency, sla_hours, is_active
    ) VALUES (
      region,
      'Addis Demo Zone',
      ST_GeogFromText('MULTIPOLYGON(((38.6 8.8,38.95 8.8,38.95 9.15,38.6 9.15,38.6 8.8)))'),
      150, 12, 'ETB', 4, true
    ) RETURNING id INTO zone;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM iam.users WHERE phone_e164 = '+251911100001') THEN
    INSERT INTO iam.users (user_type, phone_e164, full_name, status, phone_verified_at)
    VALUES ('driver', '+251911100001', 'Abebe Kebede', 'active', now())
    RETURNING id INTO u1;
  ELSE
    SELECT id INTO u1 FROM iam.users WHERE phone_e164 = '+251911100001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM iam.users WHERE phone_e164 = '+251911100002') THEN
    INSERT INTO iam.users (user_type, phone_e164, full_name, status, phone_verified_at)
    VALUES ('driver', '+251911100002', 'Sara Hailu', 'active', now())
    RETURNING id INTO u2;
  ELSE
    SELECT id INTO u2 FROM iam.users WHERE phone_e164 = '+251911100002';
  END IF;

  INSERT INTO iam.user_roles (user_id, role_id)
  SELECT u1, r.id FROM iam.roles r
  WHERE r.code = 'driver'
    AND NOT EXISTS (
      SELECT 1 FROM iam.user_roles ur WHERE ur.user_id = u1 AND ur.role_id = r.id
    );
  INSERT INTO iam.user_roles (user_id, role_id)
  SELECT u2, r.id FROM iam.roles r
  WHERE r.code = 'driver'
    AND NOT EXISTS (
      SELECT 1 FROM iam.user_roles ur WHERE ur.user_id = u2 AND ur.role_id = r.id
    );

  IF NOT EXISTS (SELECT 1 FROM delivery.drivers WHERE driver_code = 'DRV-0001') THEN
    INSERT INTO delivery.drivers (
      user_id, driver_code, employment_type, home_zone_id, region_id,
      license_number_enc, license_number_hash, license_expiry, status, availability
    ) VALUES (
      u1, 'DRV-0001', 'contractor', zone, region,
      dummy_enc, dummy_hash1, CURRENT_DATE + 365, 'active', 'available'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM delivery.drivers WHERE driver_code = 'DRV-0002') THEN
    INSERT INTO delivery.drivers (
      user_id, driver_code, employment_type, home_zone_id, region_id,
      license_number_enc, license_number_hash, license_expiry, status, availability
    ) VALUES (
      u2, 'DRV-0002', 'contractor', zone, region,
      dummy_enc, dummy_hash2, CURRENT_DATE + 365, 'active', 'available'
    );
  END IF;
END $$;
