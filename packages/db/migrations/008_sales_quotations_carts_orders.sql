-- MIGRATION 008 - sales: quotations, carts, orders -------------------
-- One quotation model for both wholesale RFQs and Dubai special orders.
CREATE TABLE sales.quotations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_number   TEXT NOT NULL UNIQUE,
  quotation_type     TEXT NOT NULL CHECK (quotation_type IN ('wholesale','special_order')),
  customer_id        UUID NOT NULL REFERENCES crm.customers(id),
  special_order_request_id UUID REFERENCES procurement.special_order_requests(id),
  revision           SMALLINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  supersedes_id      UUID REFERENCES sales.quotations(id),
  currency           CHAR(3) NOT NULL REFERENCES core.currencies(code),   -- what customer pays in (ETB)
  source_currency    CHAR(3) REFERENCES core.currencies(code),            -- e.g. AED for Dubai cost
  exchange_rate_id   UUID REFERENCES core.exchange_rates(id),
  exchange_rate      NUMERIC(20,8) CHECK (exchange_rate > 0),             -- snapshot
  subtotal           NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_total          NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  grand_total        NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
  deposit_required   NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (deposit_required >= 0),
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                       'requested','draft','pending_internal_approval','sent',
                       'accepted','rejected','expired','superseded','converted','cancelled')),
  valid_until        TIMESTAMPTZ,
  terms              TEXT,
  prepared_by        UUID REFERENCES iam.users(id),
  approved_by        UUID REFERENCES iam.users(id),
  customer_responded_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((quotation_type = 'special_order') = (special_order_request_id IS NOT NULL)),
  CHECK (deposit_required <= grand_total),
  CHECK ((source_currency IS NULL) OR (exchange_rate IS NOT NULL))
);
CREATE INDEX ix_quotes_customer ON sales.quotations (customer_id, created_at DESC);
CREATE INDEX ix_quotes_sor ON sales.quotations (special_order_request_id);
CREATE UNIQUE INDEX ux_one_open_quote_per_sor ON sales.quotations (special_order_request_id)
  WHERE status IN ('draft','pending_internal_approval','sent','accepted');
CREATE TABLE sales.quotation_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id    UUID NOT NULL REFERENCES sales.quotations(id) ON DELETE CASCADE,
  line_no         SMALLINT NOT NULL,
  line_type       TEXT NOT NULL CHECK (line_type IN (
                    'product','international_shipping','service_fee','customs_estimate',
                    'local_delivery','insurance','other')),
  variant_id      UUID REFERENCES catalog.product_variants(id),   -- catalogue item (wholesale)
  description     TEXT NOT NULL,                                   -- free text (special order)
  quantity        NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  source_unit_cost NUMERIC(18,2) CHECK (source_unit_cost >= 0),    -- e.g. AED cost
  unit_price      NUMERIC(18,2) NOT NULL CHECK (unit_price >= 0), -- in quotation currency
  tax_rate        NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 1),
  line_total      NUMERIC(18,2) NOT NULL CHECK (line_total >= 0),
  is_estimate     BOOLEAN NOT NULL DEFAULT false,                  -- customs often estimated
  UNIQUE (quotation_id, line_no)
);
CREATE TABLE sales.carts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID REFERENCES crm.customers(id) ON DELETE CASCADE,
  anonymous_token_hash BYTEA,                    -- guest cart
  currency      CHAR(3) NOT NULL DEFAULT 'ETB' REFERENCES core.currencies(code),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','converted','abandoned','merged')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ,
  CHECK (customer_id IS NOT NULL OR anonymous_token_hash IS NOT NULL)
);
CREATE UNIQUE INDEX ux_one_active_cart ON sales.carts (customer_id) WHERE status = 'active' AND customer_id IS NOT NULL;
CREATE TABLE sales.cart_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id       UUID NOT NULL REFERENCES sales.carts(id) ON DELETE CASCADE,
  variant_id    UUID NOT NULL REFERENCES catalog.product_variants(id),
  quantity      INT NOT NULL CHECK (quantity > 0 AND quantity <= 100000),
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cart_id, variant_id)
);
-- No price in cart: price is re-resolved at checkout and frozen on order_items.
-- Orders: one table for all four kinds, discriminated by order_type +
-- fulfillment_type. Amounts are snapshots and never recomputed.
CREATE TABLE sales.orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number        TEXT NOT NULL UNIQUE,      -- ORD-2026-000123
  customer_id         UUID NOT NULL REFERENCES crm.customers(id),
  business_account_id UUID REFERENCES crm.business_accounts(id),
  order_type          TEXT NOT NULL CHECK (order_type IN ('retail','wholesale','special_order')),
  fulfillment_type    TEXT NOT NULL CHECK (fulfillment_type IN ('local_delivery','store_pickup','international_procurement')),
  sales_channel       TEXT NOT NULL CHECK (sales_channel IN ('web','customer_app','admin','whatsapp','phone')),
  source_quotation_id UUID REFERENCES sales.quotations(id),
  special_order_request_id UUID REFERENCES procurement.special_order_requests(id),
  fulfillment_warehouse_id UUID REFERENCES inventory.warehouses(id),
  region_id           UUID NOT NULL REFERENCES core.operating_regions(id),
  status              TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN (
                        'draft','pending_payment','awaiting_deposit','confirmed','processing',
                        'partially_fulfilled','ready_for_dispatch','dispatched','delivered',
                        'completed','delivery_failed','cancelled','returned','partially_returned')),
  payment_status      TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN (
                        'unpaid','partially_paid','paid','partially_refunded','refunded','on_credit')),
  currency            CHAR(3) NOT NULL REFERENCES core.currencies(code),
  subtotal            NUMERIC(18,2) NOT NULL CHECK (subtotal >= 0),
  discount_total      NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total           NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  delivery_fee        NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  grand_total         NUMERIC(18,2) NOT NULL CHECK (grand_total >= 0),
  amount_paid         NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  amount_refunded     NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0),
  -- delivery address snapshot (address book rows can change later)
  ship_recipient_name TEXT,
  ship_recipient_phone TEXT,
  ship_address_text   TEXT,
  ship_location       GEOGRAPHY(Point, 4326),
  delivery_address_id UUID REFERENCES crm.customer_addresses(id),
  customer_note       TEXT,
  placed_at           TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  cancel_reason       TEXT,
  idempotency_key     TEXT UNIQUE,               -- client-supplied on checkout
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (grand_total = subtotal - discount_total + tax_total + delivery_fee),
  CHECK (amount_refunded <= amount_paid),
  CHECK ((order_type = 'special_order') = (special_order_request_id IS NOT NULL)),
  CHECK (order_type <> 'wholesale' OR business_account_id IS NOT NULL),
  CHECK (fulfillment_type <> 'local_delivery' OR ship_location IS NOT NULL OR status = 'draft')
);
CREATE INDEX ix_orders_customer ON sales.orders (customer_id, created_at DESC);
CREATE INDEX ix_orders_status ON sales.orders (region_id, status, created_at);
CREATE INDEX ix_orders_placed ON sales.orders (placed_at);
CREATE INDEX ix_orders_quote ON sales.orders (source_quotation_id);
CREATE TABLE sales.order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL REFERENCES sales.orders(id) ON DELETE RESTRICT,
  line_no           SMALLINT NOT NULL,
  variant_id        UUID REFERENCES catalog.product_variants(id),   -- NULL for special-order lines
  quotation_item_id UUID REFERENCES sales.quotation_items(id),
  sku_snapshot      TEXT,
  name_snapshot     TEXT NOT NULL,
  quantity          INT NOT NULL CHECK (quantity > 0),
  qty_fulfilled     INT NOT NULL DEFAULT 0 CHECK (qty_fulfilled >= 0),
  qty_cancelled     INT NOT NULL DEFAULT 0 CHECK (qty_cancelled >= 0),
  qty_returned      INT NOT NULL DEFAULT 0 CHECK (qty_returned >= 0),
  unit_price        NUMERIC(18,2) NOT NULL CHECK (unit_price >= 0),
  price_list_item_id UUID REFERENCES pricing.price_list_items(id), -- provenance of price
  discount_amount   NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_rate          NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 1),
  tax_amount        NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total        NUMERIC(18,2) NOT NULL CHECK (line_total >= 0),
  UNIQUE (order_id, line_no),
  CHECK (qty_fulfilled + qty_cancelled <= quantity),
  CHECK (qty_returned <= qty_fulfilled)
);
CREATE INDEX ix_order_items_variant ON sales.order_items (variant_id);
CREATE TABLE sales.order_discounts (              -- which promotions applied
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID NOT NULL REFERENCES sales.orders(id) ON DELETE CASCADE,
  promotion_id     UUID NOT NULL REFERENCES pricing.promotions(id),
  discount_code_id UUID REFERENCES pricing.discount_codes(id),
  amount           NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
  UNIQUE (order_id, promotion_id)
);
CREATE INDEX ix_order_discount_code ON sales.order_discounts (discount_code_id);
CREATE TABLE sales.order_status_history (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id      UUID NOT NULL REFERENCES sales.orders(id) ON DELETE CASCADE,
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  reason        TEXT,
  changed_by    UUID REFERENCES iam.users(id),   -- NULL = system
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_order_hist ON sales.order_status_history (order_id, changed_at);
CREATE TABLE sales.returns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number   TEXT NOT NULL UNIQUE,
  order_id        UUID NOT NULL REFERENCES sales.orders(id),
  status          TEXT NOT NULL DEFAULT 'requested' CHECK (status IN (
                    'requested','approved','rejected','pickup_scheduled','received','inspected','refunded','closed')),
  reason_code     TEXT NOT NULL CHECK (reason_code IN ('damaged','wrong_item','not_as_described','changed_mind','failed_delivery','other')),
  customer_note   TEXT,
  approved_by     UUID REFERENCES iam.users(id),
  receive_warehouse_id UUID REFERENCES inventory.warehouses(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_returns_order ON sales.returns (order_id);
CREATE TABLE sales.return_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id      UUID NOT NULL REFERENCES sales.returns(id) ON DELETE CASCADE,
  order_item_id  UUID NOT NULL REFERENCES sales.order_items(id),
  quantity       INT NOT NULL CHECK (quantity > 0),
  condition      TEXT CHECK (condition IN ('resellable','damaged','defective')),
  UNIQUE (return_id, order_item_id)
);
