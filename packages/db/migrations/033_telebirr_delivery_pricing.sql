-- MIGRATION 033 - Telebirr manual pay + km delivery pricing + fee snapshots

-- ---------------------------------------------------------------------------
-- Delivery pricing settings (Kolfe Atena Tera origin, 5 ETB/km default)
-- ---------------------------------------------------------------------------
ALTER TABLE delivery.dispatch_settings
  ADD COLUMN IF NOT EXISTS origin_warehouse_id UUID
    REFERENCES inventory.warehouses(id),
  ADD COLUMN IF NOT EXISTS origin_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS origin_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS fee_per_km NUMERIC(18,2) NOT NULL DEFAULT 5
    CHECK (fee_per_km >= 0),
  ADD COLUMN IF NOT EXISTS min_fee NUMERIC(18,2) NOT NULL DEFAULT 0
    CHECK (min_fee >= 0),
  ADD COLUMN IF NOT EXISTS max_fee NUMERIC(18,2)
    CHECK (max_fee IS NULL OR max_fee >= 0),
  ADD COLUMN IF NOT EXISTS free_over_amount NUMERIC(18,2)
    CHECK (free_over_amount IS NULL OR free_over_amount >= 0);

-- Kolfe Atena Tera approximate coords (admin must refine before production)
UPDATE delivery.dispatch_settings ds
SET
  origin_lng = COALESCE(ds.origin_lng, 38.7125),
  origin_lat = COALESCE(ds.origin_lat, 9.0330),
  fee_per_km = COALESCE(ds.fee_per_km, 5),
  origin_warehouse_id = COALESCE(
    ds.origin_warehouse_id,
    (SELECT id FROM inventory.warehouses WHERE code = 'ADD-MAIN' LIMIT 1)
  ),
  updated_at = now()
WHERE ds.id = 1;

UPDATE inventory.warehouses
SET
  name = 'Kolfe Atena Tera Dispatch',
  address_text = 'Kolfe Atena Tera, Addis Ababa, Ethiopia',
  location = ST_SetSRID(ST_MakePoint(38.7125, 9.0330), 4326)::geography,
  updated_at = now()
WHERE code = 'ADD-MAIN';

-- Align demo zone rate with default 5 ETB/km (base kept for free-threshold logic)
UPDATE delivery.delivery_zones
SET fee_per_km = 5, base_fee = 0, updated_at = now()
WHERE name = 'Addis Demo Zone';

-- ---------------------------------------------------------------------------
-- Order delivery fee snapshot
-- ---------------------------------------------------------------------------
ALTER TABLE sales.orders
  ADD COLUMN IF NOT EXISTS delivery_distance_km NUMERIC(10,2)
    CHECK (delivery_distance_km IS NULL OR delivery_distance_km >= 0),
  ADD COLUMN IF NOT EXISTS delivery_fee_rate NUMERIC(18,2)
    CHECK (delivery_fee_rate IS NULL OR delivery_fee_rate >= 0),
  ADD COLUMN IF NOT EXISTS delivery_route_source TEXT
    CHECK (delivery_route_source IS NULL OR delivery_route_source IN (
      'geodesic', 'road', 'admin_override', 'pending'
    )),
  ADD COLUMN IF NOT EXISTS delivery_pricing_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Allow pending_verification while Telebirr TXN awaits admin review
ALTER TABLE sales.orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE sales.orders
  ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN (
    'unpaid',
    'pending_verification',
    'partially_paid',
    'paid',
    'partially_refunded',
    'refunded',
    'on_credit'
  ));

-- ---------------------------------------------------------------------------
-- Telebirr merchant settings + method activation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments.telebirr_merchant_settings (
  id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  display_name      TEXT NOT NULL DEFAULT 'Sabu Online Shopping',
  merchant_account  TEXT NOT NULL DEFAULT 'Configure Telebirr merchant account',
  instructions      TEXT NOT NULL DEFAULT
    'Open Telebirr, send the exact Total Payable to the Sabu merchant account, then enter the transaction reference below.',
  help_text         TEXT,
  txn_format_regex  TEXT NOT NULL DEFAULT '^[A-Za-z0-9-]{6,40}$',
  is_active         BOOLEAN NOT NULL DEFAULT true,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        UUID REFERENCES iam.users(id)
);

INSERT INTO payments.telebirr_merchant_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

UPDATE payments.payment_providers
SET integration_status = 'live', updated_at = now()
WHERE code = 'telebirr';

INSERT INTO payments.payment_methods (
  provider_id, code, display_name, channel, is_active, sort_order, allowed_for
)
SELECT p.id, 'telebirr_manual', 'Telebirr', 'manual_verification', true, 5,
       '{retail,wholesale,special_order}'
FROM payments.payment_providers p
WHERE p.code = 'telebirr'
ON CONFLICT (code) DO UPDATE
SET is_active = true,
    display_name = EXCLUDED.display_name,
    channel = EXCLUDED.channel,
    sort_order = EXCLUDED.sort_order;

-- Storefront Telebirr-only: deactivate other customer methods (backend remains)
UPDATE payments.payment_methods
SET is_active = false
WHERE code IN ('chapa_checkout', 'bank_transfer_manual');

-- Verification audit log (Telebirr + bank)
CREATE TABLE IF NOT EXISTS payments.payment_verification_logs (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id    UUID NOT NULL REFERENCES payments.payment_transactions(id) ON DELETE CASCADE,
  order_id          UUID REFERENCES sales.orders(id),
  action            TEXT NOT NULL CHECK (action IN (
                      'submitted', 'verified', 'rejected',
                      'clarification_requested', 'flagged_duplicate', 'note'
                    )),
  notes             TEXT,
  actor_user_id     UUID REFERENCES iam.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_pay_verify_logs_tx
  ON payments.payment_verification_logs (transaction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_pay_verify_logs_order
  ON payments.payment_verification_logs (order_id, created_at DESC)
  WHERE order_id IS NOT NULL;

COMMENT ON TABLE payments.telebirr_merchant_settings IS
  'Admin-editable Telebirr merchant display + TXN ID format for manual checkout.';
COMMENT ON TABLE payments.payment_verification_logs IS
  'Audit trail for manual payment verification actions.';
COMMENT ON COLUMN sales.orders.delivery_pricing_snapshot IS
  'Immutable fee breakdown at checkout (rate, distance, min/max/free flags).';
