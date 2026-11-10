-- MIGRATION 035 - Standard/Express delivery options, base fare, product returns

-- ---------------------------------------------------------------------------
-- Delivery service types + extended pricing on dispatch_settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delivery.service_types (
  code              TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT,
  is_enabled        BOOLEAN NOT NULL DEFAULT false,
  sort_order        SMALLINT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO delivery.service_types (code, name, description, is_enabled, sort_order) VALUES
  ('standard', 'Standard Delivery',
   'Default delivery with lower cost. Arrival is estimated, not guaranteed.',
   true, 1),
  ('express', 'Express Delivery',
   'Priority delivery when available. Faster when operationally possible; ETA is an estimate only.',
   false, 2)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE delivery.dispatch_settings
  ADD COLUMN IF NOT EXISTS standard_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS express_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS standard_base_fare NUMERIC(18,2) NOT NULL DEFAULT 100
    CHECK (standard_base_fare >= 0),
  ADD COLUMN IF NOT EXISTS express_base_fare NUMERIC(18,2) NOT NULL DEFAULT 100
    CHECK (express_base_fare >= 0),
  ADD COLUMN IF NOT EXISTS express_fee_per_km NUMERIC(18,2)
    CHECK (express_fee_per_km IS NULL OR express_fee_per_km >= 0),
  ADD COLUMN IF NOT EXISTS express_surcharge NUMERIC(18,2) NOT NULL DEFAULT 0
    CHECK (express_surcharge >= 0),
  ADD COLUMN IF NOT EXISTS peak_surcharge NUMERIC(18,2) NOT NULL DEFAULT 0
    CHECK (peak_surcharge >= 0),
  ADD COLUMN IF NOT EXISTS holiday_surcharge NUMERIC(18,2) NOT NULL DEFAULT 0
    CHECK (holiday_surcharge >= 0),
  ADD COLUMN IF NOT EXISTS standard_eta_buffer_minutes INT NOT NULL DEFAULT 20
    CHECK (standard_eta_buffer_minutes >= 0),
  ADD COLUMN IF NOT EXISTS express_eta_buffer_minutes INT NOT NULL DEFAULT 10
    CHECK (express_eta_buffer_minutes >= 0),
  ADD COLUMN IF NOT EXISTS express_speed_kmh NUMERIC(6,2)
    CHECK (express_speed_kmh IS NULL OR express_speed_kmh > 0),
  ADD COLUMN IF NOT EXISTS promo_discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0
    CHECK (promo_discount_amount >= 0),
  ADD COLUMN IF NOT EXISTS promo_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (promo_discount_percent >= 0 AND promo_discount_percent <= 100),
  ADD COLUMN IF NOT EXISTS promo_label TEXT,
  ADD COLUMN IF NOT EXISTS eta_disclaimer TEXT NOT NULL DEFAULT
    'Estimated delivery time may vary depending on traffic conditions, weather, driver availability, and other unexpected delays.';

-- Initial Standard pricing: 100 ETB base + 5 ETB/km
UPDATE delivery.dispatch_settings
SET
  standard_enabled = true,
  express_enabled = false,
  standard_base_fare = 100,
  express_base_fare = 100,
  fee_per_km = 5,
  min_fee = 100,
  express_fee_per_km = NULL,
  express_surcharge = 0,
  updated_at = now()
WHERE id = 1;

UPDATE delivery.service_types
SET is_enabled = true, updated_at = now()
WHERE code = 'standard';

UPDATE delivery.service_types
SET is_enabled = false, updated_at = now()
WHERE code = 'express';

CREATE TABLE IF NOT EXISTS delivery.pricing_audit_logs (
  id              BIGSERIAL PRIMARY KEY,
  actor_id        UUID REFERENCES iam.users(id),
  action          TEXT NOT NULL DEFAULT 'settings_updated',
  before_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_snapshot  JSONB NOT NULL DEFAULT '{}'::jsonb,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Order selected delivery service + ETA snapshot
-- ---------------------------------------------------------------------------
ALTER TABLE sales.orders
  ADD COLUMN IF NOT EXISTS delivery_service_type TEXT
    CHECK (delivery_service_type IS NULL OR delivery_service_type IN ('standard', 'express')),
  ADD COLUMN IF NOT EXISTS delivery_eta_minutes INT
    CHECK (delivery_eta_minutes IS NULL OR delivery_eta_minutes >= 0),
  ADD COLUMN IF NOT EXISTS delivery_eta_window_text TEXT,
  ADD COLUMN IF NOT EXISTS delivery_eta_disclaimer TEXT;

-- ---------------------------------------------------------------------------
-- Product return policies
-- ---------------------------------------------------------------------------
ALTER TABLE catalog.products
  ADD COLUMN IF NOT EXISTS returns_allowed BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS return_window_days INT
    CHECK (return_window_days IS NULL OR return_window_days >= 0),
  ADD COLUMN IF NOT EXISTS return_conditions TEXT,
  ADD COLUMN IF NOT EXISTS return_instructions TEXT,
  ADD COLUMN IF NOT EXISTS return_policy_description TEXT,
  ADD COLUMN IF NOT EXISTS return_policy_effective_at TIMESTAMPTZ;

UPDATE catalog.products
SET
  returns_allowed = COALESCE(returns_allowed, true),
  return_window_days = COALESCE(return_window_days, 7),
  return_policy_description = COALESCE(
    return_policy_description,
    'Returns accepted within the stated window subject to condition checks and Ethiopian consumer protection requirements.'
  ),
  return_policy_effective_at = COALESCE(return_policy_effective_at, now())
WHERE TRUE;

-- Order-item return policy snapshots (frozen at purchase)
ALTER TABLE sales.order_items
  ADD COLUMN IF NOT EXISTS returns_allowed_snapshot BOOLEAN,
  ADD COLUMN IF NOT EXISTS return_window_days_snapshot INT,
  ADD COLUMN IF NOT EXISTS return_conditions_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS return_instructions_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS return_policy_description_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS return_policy_label_snapshot TEXT;

COMMENT ON COLUMN catalog.products.returns_allowed IS
  'Admin-configured return eligibility; frozen onto order_items at checkout';
COMMENT ON COLUMN sales.orders.delivery_service_type IS
  'standard|express chosen at checkout; fee/ETA frozen on the order';
COMMENT ON COLUMN delivery.dispatch_settings.standard_base_fare IS
  'Added to distance charge for Standard: base + (km × fee_per_km)';
COMMENT ON COLUMN delivery.dispatch_settings.express_enabled IS
  'Express stays disabled until admin configures express_fee_per_km and enables it';
