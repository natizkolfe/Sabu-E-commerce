-- MIGRATION 005 - pricing --------------------------------------------
CREATE TABLE pricing.price_lists (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,            -- 'RETAIL-ETB', 'WHOLESALE-ETB', 'CUST-<id>'
  name          TEXT NOT NULL,
  list_type     TEXT NOT NULL CHECK (list_type IN ('retail','wholesale','customer_specific')),
  currency      CHAR(3) NOT NULL REFERENCES core.currencies(code),
  business_account_id UUID REFERENCES crm.business_accounts(id),  -- for customer_specific
  prices_include_vat BOOLEAN NOT NULL DEFAULT true,
  priority      INT NOT NULL DEFAULT 100,        -- lower wins when several apply
  is_active     BOOLEAN NOT NULL DEFAULT true,
  valid_from    TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((list_type = 'customer_specific') = (business_account_id IS NOT NULL)),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
-- Quantity tiers: min_qty 1 = base price; min_qty 50 = tier price.
-- Rows are versioned by validity window (never UPDATE amount; close + insert)
-- so price history is preserved and auditable.
CREATE TABLE pricing.price_list_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id  UUID NOT NULL REFERENCES pricing.price_lists(id) ON DELETE CASCADE,
  variant_id     UUID NOT NULL REFERENCES catalog.product_variants(id) ON DELETE RESTRICT,
  min_qty        INT NOT NULL DEFAULT 1 CHECK (min_qty >= 1),
  unit_price     NUMERIC(18,2) NOT NULL CHECK (unit_price >= 0),
  compare_at_price NUMERIC(18,2) CHECK (compare_at_price IS NULL OR compare_at_price >= unit_price),
  valid_during   TSTZRANGE NOT NULL DEFAULT tstzrange(now(), NULL),
  created_by     UUID REFERENCES iam.users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- no two active prices for the same list/variant/tier at the same moment
  EXCLUDE USING gist (price_list_id WITH =, variant_id WITH =, min_qty WITH =, valid_during WITH &&)
);
CREATE INDEX ix_pli_variant ON pricing.price_list_items (variant_id, price_list_id);
CREATE TABLE pricing.promotions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  promo_type      TEXT NOT NULL CHECK (promo_type IN ('percentage','fixed_amount','free_delivery')),
  value           NUMERIC(18,2) NOT NULL CHECK (value >= 0),
  currency        CHAR(3) REFERENCES core.currencies(code),
  applies_to      TEXT NOT NULL DEFAULT 'order' CHECK (applies_to IN ('order','category','product','variant')),
  target_ids      UUID[] NOT NULL DEFAULT '{}',  -- ids matching applies_to
  customer_segment TEXT NOT NULL DEFAULT 'all' CHECK (customer_segment IN ('all','retail','wholesale')),
  min_order_amount NUMERIC(18,2) CHECK (min_order_amount >= 0),
  max_discount_amount NUMERIC(18,2) CHECK (max_discount_amount >= 0),
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  stackable       BOOLEAN NOT NULL DEFAULT false,
  created_by      UUID REFERENCES iam.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (promo_type <> 'percentage' OR value <= 100),
  CHECK (promo_type <> 'fixed_amount' OR currency IS NOT NULL)
);
CREATE TABLE pricing.discount_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id    UUID NOT NULL REFERENCES pricing.promotions(id) ON DELETE CASCADE,
  code            CITEXT NOT NULL UNIQUE,
  usage_limit     INT CHECK (usage_limit > 0),
  per_customer_limit INT NOT NULL DEFAULT 1 CHECK (per_customer_limit > 0),
  times_used      INT NOT NULL DEFAULT 0 CHECK (times_used >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (usage_limit IS NULL OR times_used <= usage_limit)
);
