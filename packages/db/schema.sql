-- =====================================================================
-- Ethiopian E-Commerce & ERP Platform - PostgreSQL Schema (v0.1 draft)
-- Target: PostgreSQL 16 + PostGIS 3
-- Layout: one PostgreSQL schema per business module (modular monolith).
-- Each "MIGRATION nnn" block is intended to become its own migration file
-- (e.g. 001_core.sql, 002_iam.sql ...). Blocks are in dependency order.
--
-- Conventions
--   * PK: UUID (gen_random_uuid(); app may supply UUIDv7 for index locality)
--   * Money: NUMERIC(18,2) + currency CHAR(3); FX rates NUMERIC(20,8)
--   * Status: TEXT + CHECK list (easier to evolve than ENUM types)
--   * Timestamps: TIMESTAMPTZ, stored UTC; created_at / updated_at everywhere
--   * Soft delete: deleted_at on master data only; transactional rows are
--     never deleted, they change status (cancelled, voided, reversed).
--   * PII columns suffixed _enc are application-encrypted (envelope keys in
--     KMS); companion _hash columns (HMAC-SHA256) allow exact-match lookup.
-- =====================================================================
-- MIGRATION 000 - extensions & schemas -------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- digest(), gen_random_bytes()
CREATE EXTENSION IF NOT EXISTS citext;       -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS postgis;      -- geography types
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- exclusion constraints
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- fuzzy product search
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS crm;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS pricing;
CREATE SCHEMA IF NOT EXISTS inventory;
CREATE SCHEMA IF NOT EXISTS sales;
CREATE SCHEMA IF NOT EXISTS procurement;
CREATE SCHEMA IF NOT EXISTS logistics;
CREATE SCHEMA IF NOT EXISTS payments;
CREATE SCHEMA IF NOT EXISTS delivery;
CREATE SCHEMA IF NOT EXISTS notify;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE OR REPLACE FUNCTION core.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
-- MIGRATION 001 - core reference data --------------------------------
CREATE TABLE core.currencies (
  code          CHAR(3) PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  name          TEXT NOT NULL,
  minor_units   SMALLINT NOT NULL DEFAULT 2 CHECK (minor_units BETWEEN 0 AND 4),
  is_active     BOOLEAN NOT NULL DEFAULT true
);
-- Operating regions drive data scoping for RBAC (Ethiopia vs Dubai teams).
CREATE TABLE core.operating_regions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,            -- 'ET', 'AE-DXB'
  name          TEXT NOT NULL,
  country_code  CHAR(2) NOT NULL,
  base_currency CHAR(3) NOT NULL REFERENCES core.currencies(code),
  timezone      TEXT NOT NULL,                   -- 'Africa/Addis_Ababa'
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Rates are appended, never updated; documents snapshot the rate they used.
CREATE TABLE core.exchange_rates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency  CHAR(3) NOT NULL REFERENCES core.currencies(code),
  quote_currency CHAR(3) NOT NULL REFERENCES core.currencies(code),
  rate           NUMERIC(20,8) NOT NULL CHECK (rate > 0),
  rate_type      TEXT NOT NULL DEFAULT 'commercial'
                 CHECK (rate_type IN ('official_nbe','commercial','internal')),
  effective_from TIMESTAMPTZ NOT NULL,
  source         TEXT NOT NULL,                  -- 'NBE', 'manual', bank name
  created_by     UUID,                           -- FK added after iam.users
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (base_currency <> quote_currency),
  UNIQUE (base_currency, quote_currency, rate_type, effective_from)
);
CREATE INDEX ix_fx_lookup ON core.exchange_rates (base_currency, quote_currency, rate_type, effective_from DESC);
CREATE TABLE core.system_settings (
  key           TEXT PRIMARY KEY,
  value         JSONB NOT NULL,
  description   TEXT,
  is_secret     BOOLEAN NOT NULL DEFAULT false,  -- secrets live in vault; flag only
  updated_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Human-readable document numbers (ORD-2026-000123) without gaps races.
CREATE TABLE core.document_sequences (
  doc_type      TEXT NOT NULL,
  period        TEXT NOT NULL,                   -- '2026'
  next_value    BIGINT NOT NULL DEFAULT 1 CHECK (next_value > 0),
  PRIMARY KEY (doc_type, period)
);
-- MIGRATION 002 - identity & access ----------------------------------
CREATE TABLE iam.users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_type          TEXT NOT NULL CHECK (user_type IN ('customer','staff','driver')),
  email              CITEXT,
  phone_e164         TEXT CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  password_hash      TEXT,                       -- argon2id; NULL for OTP-only login
  full_name          TEXT NOT NULL,
  preferred_locale   TEXT NOT NULL DEFAULT 'am-ET'
                     CHECK (preferred_locale IN ('am-ET','en-US','om-ET','ti-ET','ar-AE')),
  status             TEXT NOT NULL DEFAULT 'pending_verification'
                     CHECK (status IN ('pending_verification','active','suspended','deactivated')),
  email_verified_at  TIMESTAMPTZ,
  phone_verified_at  TIMESTAMPTZ,
  mfa_enabled        BOOLEAN NOT NULL DEFAULT false,
  mfa_secret_enc     BYTEA,                      -- TOTP secret, app-encrypted
  failed_login_count SMALLINT NOT NULL DEFAULT 0,
  locked_until       TIMESTAMPTZ,
  last_login_at      TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ,
  CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL)
  -- MFA for staff is enforced at login by policy (role-dependent), not by a row constraint
);
CREATE UNIQUE INDEX ux_users_email ON iam.users (email) WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE UNIQUE INDEX ux_users_phone ON iam.users (phone_e164) WHERE deleted_at IS NULL AND phone_e164 IS NOT NULL;
ALTER TABLE core.exchange_rates  ADD FOREIGN KEY (created_by) REFERENCES iam.users(id);
ALTER TABLE core.system_settings ADD FOREIGN KEY (updated_by) REFERENCES iam.users(id);
CREATE TABLE iam.roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,            -- 'super_admin','dubai_procurement_admin'
  name          TEXT NOT NULL,
  description   TEXT,
  is_system     BOOLEAN NOT NULL DEFAULT false,  -- system roles cannot be deleted
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE iam.permissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE CHECK (code ~ '^[a-z_]+\.[a-z_]+(\.[a-z_]+)?$'), -- 'orders.read', 'payments.refund.approve'
  module        TEXT NOT NULL,
  description   TEXT
);
CREATE TABLE iam.role_permissions (               -- M:N roles ↔ permissions
  role_id       UUID NOT NULL REFERENCES iam.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES iam.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
-- M:N users ↔ roles, optionally scoped to a region (Dubai admin sees Dubai data).
CREATE TABLE iam.user_roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  role_id       UUID NOT NULL REFERENCES iam.roles(id) ON DELETE RESTRICT,
  region_id     UUID REFERENCES core.operating_regions(id),   -- NULL = all regions
  granted_by    UUID REFERENCES iam.users(id),
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_user_roles ON iam.user_roles (user_id, role_id, COALESCE(region_id, '00000000-0000-0000-0000-000000000000'));
CREATE TABLE iam.sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  refresh_token_hash  BYTEA NOT NULL UNIQUE,     -- SHA-256 of opaque refresh token
  client_type         TEXT NOT NULL CHECK (client_type IN ('web','customer_app','driver_app','admin_web')),
  ip_address          INET,
  user_agent          TEXT,
  mfa_verified        BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ
);
CREATE INDEX ix_sessions_user ON iam.sessions (user_id) WHERE revoked_at IS NULL;
CREATE TABLE iam.otp_challenges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES iam.users(id) ON DELETE CASCADE,
  destination   TEXT NOT NULL,                   -- phone or email
  purpose       TEXT NOT NULL CHECK (purpose IN ('login','verify_phone','verify_email','password_reset','mfa')),
  code_hash     BYTEA NOT NULL,
  attempts      SMALLINT NOT NULL DEFAULT 0 CHECK (attempts <= 5),
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_otp_dest ON iam.otp_challenges (destination, purpose, created_at DESC);
-- MIGRATION 003 - customers ------------------------------------------
-- Business (wholesale) accounts: a company with one or more users.
CREATE TABLE crm.business_accounts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name         TEXT NOT NULL,
  trade_name         TEXT,
  tin_number         TEXT,                       -- Ethiopian Taxpayer ID
  trade_license_no   TEXT,
  vat_registered     BOOLEAN NOT NULL DEFAULT false,
  status             TEXT NOT NULL DEFAULT 'pending_review'
                     CHECK (status IN ('pending_review','approved','rejected','suspended')),
  credit_limit       NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  payment_terms_days SMALLINT NOT NULL DEFAULT 0 CHECK (payment_terms_days BETWEEN 0 AND 180),
  approved_by        UUID REFERENCES iam.users(id),
  approved_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_business_tin ON crm.business_accounts (tin_number) WHERE tin_number IS NOT NULL AND deleted_at IS NULL;
CREATE TABLE crm.customers (                      -- 1:1 with iam.users of type customer
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL UNIQUE REFERENCES iam.users(id) ON DELETE RESTRICT,
  customer_type       TEXT NOT NULL DEFAULT 'retail' CHECK (customer_type IN ('retail','wholesale')),
  business_account_id UUID REFERENCES crm.business_accounts(id),
  business_role       TEXT CHECK (business_role IN ('owner','buyer','viewer')),
  customer_code       TEXT NOT NULL UNIQUE,      -- CUS-000123
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((customer_type = 'wholesale') = (business_account_id IS NOT NULL)),
  CHECK ((business_account_id IS NULL) = (business_role IS NULL))
);
CREATE INDEX ix_customers_business ON crm.customers (business_account_id);
CREATE TABLE crm.customer_addresses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID NOT NULL REFERENCES crm.customers(id) ON DELETE CASCADE,
  label            TEXT,                         -- 'Home', 'Shop'
  recipient_name   TEXT NOT NULL,
  recipient_phone  TEXT NOT NULL CHECK (recipient_phone ~ '^\+[1-9][0-9]{7,14}$'),
  region           TEXT NOT NULL,                -- Addis Ababa, Oromia ...
  city             TEXT NOT NULL,
  sub_city         TEXT,
  woreda           TEXT,
  kebele           TEXT,
  house_no         TEXT,
  landmark         TEXT,                         -- important: many addresses are landmark-based
  location         GEOGRAPHY(Point, 4326) NOT NULL,
  is_default       BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_one_default_address ON crm.customer_addresses (customer_id) WHERE is_default AND deleted_at IS NULL;
CREATE INDEX ix_address_geo ON crm.customer_addresses USING GIST (location);
-- MIGRATION 004 - catalog --------------------------------------------
CREATE TABLE catalog.categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id     UUID REFERENCES catalog.categories(id) ON DELETE RESTRICT,
  slug          TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  name          TEXT NOT NULL,
  name_am       TEXT,                            -- Amharic display name
  path          TEXT NOT NULL,                   -- materialized path 'electronics/phones'
  sort_order    INT NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX ix_categories_parent ON catalog.categories (parent_id);
CREATE INDEX ix_categories_path ON catalog.categories (path text_pattern_ops);
CREATE TABLE catalog.brands (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  logo_key      TEXT,                            -- object-storage key
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE catalog.products (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id      UUID NOT NULL REFERENCES catalog.categories(id),
  brand_id         UUID REFERENCES catalog.brands(id),
  slug             TEXT NOT NULL,
  name             TEXT NOT NULL,
  name_am          TEXT,
  description      TEXT,
  specifications   JSONB NOT NULL DEFAULT '{}'::jsonb,  -- flexible spec sheet; filterable attrs below
  sales_channel    TEXT NOT NULL DEFAULT 'both' CHECK (sales_channel IN ('retail','wholesale','both')),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','inactive','archived')),
  tax_category     TEXT NOT NULL DEFAULT 'standard',
  created_by       UUID REFERENCES iam.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_products_slug ON catalog.products (slug) WHERE deleted_at IS NULL;
CREATE INDEX ix_products_category ON catalog.products (category_id) WHERE status = 'active';
CREATE INDEX ix_products_brand ON catalog.products (brand_id);
CREATE INDEX ix_products_name_trgm ON catalog.products USING GIN (name gin_trgm_ops);
CREATE INDEX ix_products_specs ON catalog.products USING GIN (specifications jsonb_path_ops);
-- The sellable unit. Every order line, stock balance and price points here.
CREATE TABLE catalog.product_variants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID NOT NULL REFERENCES catalog.products(id) ON DELETE RESTRICT,
  sku              TEXT NOT NULL,
  barcode          TEXT,
  variant_name     TEXT,                         -- '128GB / Black'
  options          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {"color":"black","storage":"128GB"}
  unit_of_measure  TEXT NOT NULL DEFAULT 'piece',
  weight_kg        NUMERIC(10,3) CHECK (weight_kg >= 0),
  volume_m3        NUMERIC(10,4) CHECK (volume_m3 >= 0),
  min_order_qty_wholesale INT NOT NULL DEFAULT 1 CHECK (min_order_qty_wholesale >= 1),
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_variants_sku ON catalog.product_variants (sku) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_variants_barcode ON catalog.product_variants (barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_variants_product ON catalog.product_variants (product_id);
CREATE TABLE catalog.product_images (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES catalog.products(id) ON DELETE CASCADE,
  variant_id    UUID REFERENCES catalog.product_variants(id) ON DELETE CASCADE,
  storage_key   TEXT NOT NULL,                   -- never store public URLs; resolve via CDN
  alt_text      TEXT,
  sort_order    INT NOT NULL DEFAULT 0,
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_one_primary_image ON catalog.product_images (product_id) WHERE is_primary;
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
-- MIGRATION 006 - inventory (masters) --------------------------------
CREATE TABLE inventory.warehouses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id     UUID NOT NULL REFERENCES core.operating_regions(id),
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  warehouse_type TEXT NOT NULL CHECK (warehouse_type IN ('warehouse','store','consolidation_hub','transit')),
  address_text  TEXT,
  location      GEOGRAPHY(Point, 4326),
  is_sellable   BOOLEAN NOT NULL DEFAULT true,   -- Dubai hub stock is not sold locally
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE inventory.storage_locations (       -- bins / shelves inside a warehouse
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id  UUID NOT NULL REFERENCES inventory.warehouses(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,                   -- 'A-03-2'
  location_type TEXT NOT NULL DEFAULT 'pick' CHECK (location_type IN ('pick','bulk','quarantine','damaged','returns')),
  UNIQUE (warehouse_id, code)
);
-- One row per warehouse × variant. Updated ONLY together with an
-- inventory_movements insert, inside one transaction, using
-- SELECT ... FOR UPDATE or a conditional UPDATE (see doc §Concurrency).
CREATE TABLE inventory.stock_balances (
  warehouse_id      UUID NOT NULL REFERENCES inventory.warehouses(id),
  variant_id        UUID NOT NULL REFERENCES catalog.product_variants(id),
  qty_on_hand       INT NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
  qty_reserved      INT NOT NULL DEFAULT 0 CHECK (qty_reserved >= 0),
  qty_damaged       INT NOT NULL DEFAULT 0 CHECK (qty_damaged >= 0),
  reorder_point     INT CHECK (reorder_point >= 0),
  reorder_qty       INT CHECK (reorder_qty > 0),
  version           BIGINT NOT NULL DEFAULT 0,   -- optimistic-lock counter
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, variant_id),
  CHECK (qty_reserved <= qty_on_hand)
);
CREATE INDEX ix_stock_variant ON inventory.stock_balances (variant_id);
CREATE INDEX ix_stock_low ON inventory.stock_balances (warehouse_id)
  WHERE reorder_point IS NOT NULL AND qty_on_hand - qty_reserved <= reorder_point;
-- MIGRATION 007 - suppliers & special-order requests -----------------
CREATE TABLE procurement.suppliers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  supplier_type    TEXT NOT NULL CHECK (supplier_type IN ('local','international')),
  country_code     CHAR(2) NOT NULL,
  region_id        UUID REFERENCES core.operating_regions(id),
  contact_name     TEXT,
  contact_phone    TEXT,
  contact_email    CITEXT,
  tax_id           TEXT,
  default_currency CHAR(3) NOT NULL REFERENCES core.currencies(code),
  payment_terms_days SMALLINT NOT NULL DEFAULT 0,
  bank_details_enc BYTEA,                        -- app-encrypted
  rating           SMALLINT CHECK (rating BETWEEN 1 AND 5),
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
-- Customer asks for something not in the catalogue (Dubai sourcing).
CREATE TABLE procurement.special_order_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number    TEXT NOT NULL UNIQUE,        -- SR-2026-000045
  customer_id       UUID NOT NULL REFERENCES crm.customers(id),
  sourcing_region_id UUID NOT NULL REFERENCES core.operating_regions(id),  -- Dubai
  delivery_address_id UUID REFERENCES crm.customer_addresses(id),
  product_name      TEXT NOT NULL,
  description       TEXT,
  quantity          INT NOT NULL CHECK (quantity > 0),
  product_url       TEXT CHECK (product_url IS NULL OR product_url ~ '^https?://'),
  expected_specs    JSONB NOT NULL DEFAULT '{}'::jsonb,
  budget_amount     NUMERIC(18,2) CHECK (budget_amount > 0),
  budget_currency   CHAR(3) REFERENCES core.currencies(code),
  status            TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (
                      'submitted','under_review','sourcing','quotation_prepared',
                      'awaiting_customer_approval','awaiting_payment','payment_confirmed',
                      'purchasing','purchased','preparing_shipment','in_transit',
                      'customs_clearance','arrived_ethiopia','ready_for_delivery',
                      'out_for_delivery','delivered','rejected_by_customer',
                      'unavailable','cancelled','refunded')),
  assigned_to       UUID REFERENCES iam.users(id),   -- Dubai procurement admin
  supplier_id       UUID REFERENCES procurement.suppliers(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((budget_amount IS NULL) = (budget_currency IS NULL))
);
CREATE INDEX ix_sor_status ON procurement.special_order_requests (sourcing_region_id, status, created_at);
CREATE INDEX ix_sor_customer ON procurement.special_order_requests (customer_id, created_at DESC);
CREATE TABLE procurement.special_order_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID NOT NULL REFERENCES procurement.special_order_requests(id) ON DELETE CASCADE,
  storage_key   TEXT NOT NULL,
  mime_type     TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes    INT NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  scan_status   TEXT NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending','clean','infected')),
  uploaded_by   UUID NOT NULL REFERENCES iam.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE procurement.special_order_status_history (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id    UUID NOT NULL REFERENCES procurement.special_order_requests(id) ON DELETE CASCADE,
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  note          TEXT,
  is_customer_visible BOOLEAN NOT NULL DEFAULT true,
  changed_by    UUID REFERENCES iam.users(id),
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_sor_hist ON procurement.special_order_status_history (request_id, changed_at);
-- Threaded messages between customer and Dubai team on a request.
CREATE TABLE procurement.special_order_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID NOT NULL REFERENCES procurement.special_order_requests(id) ON DELETE CASCADE,
  author_id     UUID NOT NULL REFERENCES iam.users(id),
  body          TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  is_internal   BOOLEAN NOT NULL DEFAULT false,  -- staff-only note
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_sor_msgs ON procurement.special_order_messages (request_id, created_at);
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
-- MIGRATION 009 - inventory transactions -----------------------------
CREATE TABLE inventory.stock_reservations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id   UUID NOT NULL,
  variant_id     UUID NOT NULL,
  order_item_id  UUID NOT NULL REFERENCES sales.order_items(id) ON DELETE CASCADE,
  quantity       INT NOT NULL CHECK (quantity > 0),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','fulfilled','released','expired')),
  expires_at     TIMESTAMPTZ NOT NULL,           -- unpaid orders release stock (e.g. 30 min)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (warehouse_id, variant_id) REFERENCES inventory.stock_balances(warehouse_id, variant_id)
);
CREATE INDEX ix_resv_expiry ON inventory.stock_reservations (expires_at) WHERE status = 'active';
CREATE INDEX ix_resv_item ON inventory.stock_reservations (order_item_id);
CREATE TABLE inventory.stock_transfers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number  TEXT NOT NULL UNIQUE,
  from_warehouse_id UUID NOT NULL REFERENCES inventory.warehouses(id),
  to_warehouse_id  UUID NOT NULL REFERENCES inventory.warehouses(id),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','in_transit','received','cancelled')),
  requested_by     UUID REFERENCES iam.users(id),
  approved_by      UUID REFERENCES iam.users(id),
  shipped_at       TIMESTAMPTZ,
  received_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_warehouse_id <> to_warehouse_id)
);
CREATE TABLE inventory.stock_transfer_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id   UUID NOT NULL REFERENCES inventory.stock_transfers(id) ON DELETE CASCADE,
  variant_id    UUID NOT NULL REFERENCES catalog.product_variants(id),
  qty_sent      INT NOT NULL CHECK (qty_sent > 0),
  qty_received  INT CHECK (qty_received >= 0),
  UNIQUE (transfer_id, variant_id)
);
CREATE TABLE inventory.stock_adjustments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id  UUID NOT NULL REFERENCES inventory.warehouses(id),
  reason        TEXT NOT NULL CHECK (reason IN ('cycle_count','damage','theft','expiry','correction','opening_balance')),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','posted','rejected')),
  note          TEXT,
  created_by    UUID NOT NULL REFERENCES iam.users(id),
  approved_by   UUID REFERENCES iam.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at     TIMESTAMPTZ
);
-- MIGRATION 010 - purchase orders & goods receipt --------------------
CREATE TABLE procurement.purchase_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number         TEXT NOT NULL UNIQUE,
  supplier_id       UUID NOT NULL REFERENCES procurement.suppliers(id),
  region_id         UUID NOT NULL REFERENCES core.operating_regions(id),
  special_order_request_id UUID REFERENCES procurement.special_order_requests(id),  -- back-to-back PO
  destination_warehouse_id UUID REFERENCES inventory.warehouses(id),
  currency          CHAR(3) NOT NULL REFERENCES core.currencies(code),
  exchange_rate_to_etb NUMERIC(20,8) CHECK (exchange_rate_to_etb > 0),
  subtotal          NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_total         NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  grand_total       NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                      'draft','pending_approval','approved','sent','partially_received','received','closed','cancelled')),
  expected_date     DATE,
  created_by        UUID NOT NULL REFERENCES iam.users(id),
  approved_by       UUID REFERENCES iam.users(id),
  approved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (approved_by IS NULL OR approved_by <> created_by)   -- maker-checker
);
CREATE INDEX ix_po_supplier ON procurement.purchase_orders (supplier_id, created_at DESC);
CREATE INDEX ix_po_sor ON procurement.purchase_orders (special_order_request_id);
CREATE TABLE procurement.purchase_order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES procurement.purchase_orders(id) ON DELETE CASCADE,
  line_no         SMALLINT NOT NULL,
  variant_id      UUID REFERENCES catalog.product_variants(id),   -- NULL for special-order items
  description     TEXT NOT NULL,
  quantity        NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  qty_received    NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_cost       NUMERIC(18,2) NOT NULL CHECK (unit_cost >= 0),
  line_total      NUMERIC(18,2) NOT NULL CHECK (line_total >= 0),
  UNIQUE (purchase_order_id, line_no),
  CHECK (qty_received <= quantity)
);
CREATE TABLE procurement.goods_receipts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_number        TEXT NOT NULL UNIQUE,
  purchase_order_id UUID NOT NULL REFERENCES procurement.purchase_orders(id),
  warehouse_id      UUID NOT NULL REFERENCES inventory.warehouses(id),
  received_by       UUID NOT NULL REFERENCES iam.users(id),
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  note              TEXT
);
CREATE TABLE procurement.goods_receipt_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goods_receipt_id  UUID NOT NULL REFERENCES procurement.goods_receipts(id) ON DELETE CASCADE,
  po_item_id        UUID NOT NULL REFERENCES procurement.purchase_order_items(id),
  qty_received      NUMERIC(12,3) NOT NULL CHECK (qty_received > 0),
  qty_rejected      NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (qty_rejected >= 0),
  UNIQUE (goods_receipt_id, po_item_id)
);
-- Append-only stock ledger. Sum of qty_change per (warehouse, variant)
-- must equal stock_balances.qty_on_hand (nightly reconciliation job).
CREATE TABLE inventory.inventory_movements (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  warehouse_id    UUID NOT NULL REFERENCES inventory.warehouses(id),
  storage_location_id UUID REFERENCES inventory.storage_locations(id),
  variant_id      UUID NOT NULL REFERENCES catalog.product_variants(id),
  movement_type   TEXT NOT NULL CHECK (movement_type IN (
                    'purchase_receipt','sale_shipment','return_restock','return_damaged',
                    'transfer_out','transfer_in','adjustment_in','adjustment_out','opening_balance')),
  qty_change      INT NOT NULL CHECK (qty_change <> 0),
  unit_cost       NUMERIC(18,4),                 -- for valuation (moving average later)
  -- polymorphic source document; exactly one set
  order_item_id   UUID REFERENCES sales.order_items(id),
  goods_receipt_item_id UUID REFERENCES procurement.goods_receipt_items(id),
  transfer_item_id UUID REFERENCES inventory.stock_transfer_items(id),
  adjustment_id   UUID REFERENCES inventory.stock_adjustments(id),
  return_item_id  UUID REFERENCES sales.return_items(id),
  performed_by    UUID REFERENCES iam.users(id),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(order_item_id, goods_receipt_item_id, transfer_item_id, adjustment_id, return_item_id) <= 1)
);
CREATE INDEX ix_mov_wh_variant ON inventory.inventory_movements (warehouse_id, variant_id, occurred_at);
CREATE INDEX ix_mov_occurred ON inventory.inventory_movements USING BRIN (occurred_at);
-- MIGRATION 011 - international logistics ----------------------------
CREATE TABLE logistics.international_shipments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_number    TEXT NOT NULL UNIQUE,
  origin_region_id   UUID NOT NULL REFERENCES core.operating_regions(id),
  destination_region_id UUID NOT NULL REFERENCES core.operating_regions(id),
  transport_mode     TEXT NOT NULL CHECK (transport_mode IN ('air','sea','road','courier')),
  carrier_name       TEXT,                       -- freight forwarder: requires commercial agreement
  tracking_number    TEXT,
  airway_bill_no     TEXT,
  status             TEXT NOT NULL DEFAULT 'preparing' CHECK (status IN (
                       'preparing','booked','departed','in_transit','arrived_port',
                       'customs_clearance','cleared','delivered_to_hub','exception','cancelled')),
  freight_cost       NUMERIC(18,2) CHECK (freight_cost >= 0),
  freight_currency   CHAR(3) REFERENCES core.currencies(code),
  departed_at        TIMESTAMPTZ,
  eta                TIMESTAMPTZ,
  arrived_at         TIMESTAMPTZ,
  created_by         UUID REFERENCES iam.users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (origin_region_id <> destination_region_id)
);
-- A consolidated shipment can carry many special orders; an order may be split
-- across shipments → M:N bridge.
CREATE TABLE logistics.shipment_contents (
  shipment_id              UUID NOT NULL REFERENCES logistics.international_shipments(id) ON DELETE CASCADE,
  special_order_request_id UUID NOT NULL REFERENCES procurement.special_order_requests(id),
  package_count            SMALLINT NOT NULL DEFAULT 1 CHECK (package_count > 0),
  declared_value           NUMERIC(18,2) CHECK (declared_value >= 0),
  declared_currency        CHAR(3) REFERENCES core.currencies(code),
  gross_weight_kg          NUMERIC(10,3),
  PRIMARY KEY (shipment_id, special_order_request_id)
);
CREATE INDEX ix_ship_contents_sor ON logistics.shipment_contents (special_order_request_id);
CREATE TABLE logistics.shipment_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id   UUID NOT NULL REFERENCES logistics.international_shipments(id) ON DELETE CASCADE,
  status        TEXT NOT NULL,
  location_text TEXT,
  description   TEXT,
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','carrier_api')),
  occurred_at   TIMESTAMPTZ NOT NULL,
  recorded_by   UUID REFERENCES iam.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_ship_events ON logistics.shipment_events (shipment_id, occurred_at);
CREATE TABLE logistics.customs_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id     UUID NOT NULL REFERENCES logistics.international_shipments(id),
  declaration_no  TEXT,                          -- ECC customs declaration
  broker_name     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','assessed','paid','released','held')),
  duty_amount     NUMERIC(18,2) CHECK (duty_amount >= 0),
  vat_amount      NUMERIC(18,2) CHECK (vat_amount >= 0),
  excise_amount   NUMERIC(18,2) CHECK (excise_amount >= 0),
  other_charges   NUMERIC(18,2) CHECK (other_charges >= 0),
  currency        CHAR(3) NOT NULL DEFAULT 'ETB' REFERENCES core.currencies(code),
  submitted_at    TIMESTAMPTZ,
  released_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_customs_shipment ON logistics.customs_records (shipment_id);
-- MIGRATION 012 - payments -------------------------------------------
-- Provider registry. Credentials are NOT stored here (vault/secret manager).
CREATE TABLE payments.payment_providers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code             TEXT NOT NULL UNIQUE,         -- 'telebirr','chapa','cbe_birr','bank_transfer','cash_on_delivery'
  name             TEXT NOT NULL,
  provider_kind    TEXT NOT NULL CHECK (provider_kind IN ('gateway','wallet','bank','manual')),
  integration_status TEXT NOT NULL DEFAULT 'unverified'
                   CHECK (integration_status IN ('unverified','sandbox','live','disabled')),
  supports_refund_api BOOLEAN NOT NULL DEFAULT false,
  supports_partial_refund BOOLEAN NOT NULL DEFAULT false,
  supported_currencies CHAR(3)[] NOT NULL DEFAULT '{ETB}',
  config           JSONB NOT NULL DEFAULT '{}'::jsonb,  -- non-secret: timeouts, fee %
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Checkout-visible methods (a provider can expose several).
CREATE TABLE payments.payment_methods (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   UUID NOT NULL REFERENCES payments.payment_providers(id),
  code          TEXT NOT NULL UNIQUE,            -- 'telebirr_superapp','chapa_card','cbe_transfer'
  display_name  TEXT NOT NULL,
  channel       TEXT NOT NULL CHECK (channel IN ('redirect','ussd_push','in_app','manual_verification','cash')),
  min_amount    NUMERIC(18,2) CHECK (min_amount >= 0),
  max_amount    NUMERIC(18,2) CHECK (max_amount >= 0),
  allowed_for   TEXT[] NOT NULL DEFAULT '{retail,wholesale,special_order}',
  is_active     BOOLEAN NOT NULL DEFAULT false,
  sort_order    INT NOT NULL DEFAULT 0
);
-- "We are asking for X money for Y" - one intent per payable instalment
-- (full payment, special-order deposit, balance).
CREATE TABLE payments.payment_intents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID NOT NULL REFERENCES sales.orders(id),
  purpose          TEXT NOT NULL CHECK (purpose IN ('full','deposit','balance','delivery_fee','customs_balance')),
  amount           NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency         CHAR(3) NOT NULL REFERENCES core.currencies(code),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','failed','cancelled','expired')),
  due_at           TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_pi_order ON payments.payment_intents (order_id);
CREATE UNIQUE INDEX ux_pi_one_success_per_purpose ON payments.payment_intents (order_id, purpose)
  WHERE status = 'succeeded' AND purpose IN ('full','deposit');
-- Each attempt at a provider. Success is set ONLY by a verified webhook or
-- server-to-server verify call - never by the browser return URL.
CREATE TABLE payments.payment_transactions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id    UUID NOT NULL REFERENCES payments.payment_intents(id),
  payment_method_id    UUID NOT NULL REFERENCES payments.payment_methods(id),
  merchant_reference   TEXT NOT NULL UNIQUE,     -- our tx_ref sent to provider
  provider_reference   TEXT,                     -- provider's transaction id
  idempotency_key      TEXT NOT NULL UNIQUE,
  amount               NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency             CHAR(3) NOT NULL REFERENCES core.currencies(code),
  provider_fee         NUMERIC(18,2) CHECK (provider_fee >= 0),
  status               TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN (
                         'initiated','pending','succeeded','failed','cancelled','expired','reversed')),
  failure_code         TEXT,
  failure_message      TEXT,
  payer_phone_masked   TEXT,                     -- '+2519****5678'
  manual_proof_key     TEXT,                     -- bank-transfer receipt upload
  verified_by          UUID REFERENCES iam.users(id),   -- manual verification
  verified_at          TIMESTAMPTZ,
  initiated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at         TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_ptx_provider_ref ON payments.payment_transactions (payment_method_id, provider_reference) WHERE provider_reference IS NOT
NULL;
CREATE INDEX ix_ptx_intent ON payments.payment_transactions (payment_intent_id);
CREATE INDEX ix_ptx_pending ON payments.payment_transactions (initiated_at) WHERE status IN ('initiated','pending');
CREATE TABLE payments.payment_status_history (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id   UUID NOT NULL REFERENCES payments.payment_transactions(id) ON DELETE CASCADE,
  from_status      TEXT,
  to_status        TEXT NOT NULL,
  source           TEXT NOT NULL CHECK (source IN ('webhook','verify_api','reconciliation','admin','system')),
  webhook_event_id UUID,                         -- FK below
  changed_by       UUID REFERENCES iam.users(id),
  changed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_pay_hist ON payments.payment_status_history (transaction_id, changed_at);
-- Raw inbound callbacks, stored before processing (inbox pattern) and
-- de-duplicated on the provider's event id.
CREATE TABLE payments.webhook_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id       UUID NOT NULL REFERENCES payments.payment_providers(id),
  provider_event_id TEXT NOT NULL,
  signature_valid   BOOLEAN NOT NULL,
  payload           JSONB NOT NULL,
  headers           JSONB,
  processing_status TEXT NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received','processed','ignored','failed')),
  error             TEXT,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  UNIQUE (provider_id, provider_event_id)
);
ALTER TABLE payments.payment_status_history
  ADD FOREIGN KEY (webhook_event_id) REFERENCES payments.webhook_events(id);
CREATE TABLE payments.refunds (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_number      TEXT NOT NULL UNIQUE,
  transaction_id     UUID NOT NULL REFERENCES payments.payment_transactions(id),
  order_id           UUID NOT NULL REFERENCES sales.orders(id),
  return_id          UUID REFERENCES sales.returns(id),
  amount             NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency           CHAR(3) NOT NULL REFERENCES core.currencies(code),
  reason             TEXT NOT NULL,
  method             TEXT NOT NULL CHECK (method IN ('provider_api','bank_transfer','wallet_credit','cash')),
  status             TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','processing','succeeded','failed','rejected')),
  provider_reference TEXT,
  idempotency_key    TEXT NOT NULL UNIQUE,
  requested_by       UUID NOT NULL REFERENCES iam.users(id),
  approved_by        UUID REFERENCES iam.users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (approved_by IS NULL OR approved_by <> requested_by)
);
CREATE INDEX ix_refunds_order ON payments.refunds (order_id);
-- Daily settlement file / statement import, matched against transactions.
CREATE TABLE payments.reconciliation_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     UUID NOT NULL REFERENCES payments.payment_providers(id),
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  source_file_key TEXT,
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','completed_with_exceptions','failed')),
  matched_count   INT NOT NULL DEFAULT 0,
  exception_count INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end > period_start)
);
CREATE TABLE payments.reconciliation_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id             UUID NOT NULL REFERENCES payments.reconciliation_runs(id) ON DELETE CASCADE,
  provider_reference TEXT NOT NULL,
  statement_amount   NUMERIC(18,2) NOT NULL,
  transaction_id     UUID REFERENCES payments.payment_transactions(id),
  result             TEXT NOT NULL CHECK (result IN ('matched','amount_mismatch','missing_in_system','missing_in_statement','status_mismatch')),
  resolved_by        UUID REFERENCES iam.users(id),
  resolved_at        TIMESTAMPTZ,
  resolution_note    TEXT
);
CREATE INDEX ix_recon_open ON payments.reconciliation_items (run_id) WHERE result <> 'matched' AND resolved_at IS NULL;
-- MIGRATION 013 - delivery & fleet -----------------------------------
CREATE TABLE delivery.delivery_zones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id      UUID NOT NULL REFERENCES core.operating_regions(id),
  name           TEXT NOT NULL,                  -- 'Bole', 'Addis - Zone A'
  boundary       GEOGRAPHY(MultiPolygon, 4326) NOT NULL,
  base_fee       NUMERIC(18,2) NOT NULL CHECK (base_fee >= 0),
  fee_per_km     NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (fee_per_km >= 0),
  free_over_amount NUMERIC(18,2),
  currency       CHAR(3) NOT NULL DEFAULT 'ETB' REFERENCES core.currencies(code),
  sla_hours      SMALLINT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_zone_geo ON delivery.delivery_zones USING GIST (boundary);
CREATE TABLE delivery.drivers (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL UNIQUE REFERENCES iam.users(id),
  driver_code            TEXT NOT NULL UNIQUE,   -- DRV-0042
  employment_type        TEXT NOT NULL CHECK (employment_type IN ('employee','contractor')),
  home_zone_id           UUID REFERENCES delivery.delivery_zones(id),
  region_id              UUID NOT NULL REFERENCES core.operating_regions(id),
  -- sensitive identity data: app-level envelope encryption + blind index
  license_number_enc     BYTEA NOT NULL,
  license_number_hash    BYTEA NOT NULL UNIQUE,
  license_class          TEXT,
  license_expiry         DATE NOT NULL,
  national_id_enc        BYTEA,
  national_id_hash       BYTEA UNIQUE,
  emergency_contact_enc  BYTEA,
  status                 TEXT NOT NULL DEFAULT 'pending_verification' CHECK (status IN (
                           'pending_verification','active','suspended','terminated')),
  availability           TEXT NOT NULL DEFAULT 'offline' CHECK (availability IN ('offline','available','on_delivery','on_break')),
  verified_by            UUID REFERENCES iam.users(id),
  verified_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_drivers_dispatch ON delivery.drivers (region_id, availability) WHERE status = 'active';
-- Separate from drivers: vehicles can be pooled/reassigned.
CREATE TABLE delivery.vehicles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number     TEXT NOT NULL UNIQUE,
  vehicle_type     TEXT NOT NULL CHECK (vehicle_type IN ('motorbike','car','van','pickup','truck','bajaj')),
  make_model       TEXT,
  capacity_kg      NUMERIC(10,2) CHECK (capacity_kg > 0),
  capacity_m3      NUMERIC(10,3) CHECK (capacity_m3 > 0),
  ownership        TEXT NOT NULL CHECK (ownership IN ('company','driver_owned')),
  insurance_expiry DATE,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE delivery.driver_vehicle_assignments (  -- history of who drives what
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id     UUID NOT NULL REFERENCES delivery.drivers(id),
  vehicle_id    UUID NOT NULL REFERENCES delivery.vehicles(id),
  active_during TSTZRANGE NOT NULL DEFAULT tstzrange(now(), NULL),
  EXCLUDE USING gist (vehicle_id WITH =, active_during WITH &&),
  EXCLUDE USING gist (driver_id WITH =, active_during WITH &&)
);
-- A delivery = one physical trip leg for (part of) an order.
-- Partial fulfilment ⇒ several deliveries per order.
CREATE TABLE delivery.deliveries (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_number    TEXT NOT NULL UNIQUE,
  order_id           UUID NOT NULL REFERENCES sales.orders(id),
  origin_warehouse_id UUID NOT NULL REFERENCES inventory.warehouses(id),
  zone_id            UUID REFERENCES delivery.delivery_zones(id),
  dropoff_location   GEOGRAPHY(Point, 4326) NOT NULL,
  dropoff_address_text TEXT NOT NULL,
  recipient_name     TEXT NOT NULL,
  recipient_phone    TEXT NOT NULL,
  distance_km        NUMERIC(8,2) CHECK (distance_km >= 0),
  status             TEXT NOT NULL DEFAULT 'pending_assignment' CHECK (status IN (
                       'pending_assignment','assigned','accepted','picked_up','in_transit',
                       'arrived','delivered','failed','returned_to_warehouse','cancelled')),
  cod_amount         NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (cod_amount >= 0),
  attempt_count      SMALLINT NOT NULL DEFAULT 0,
  scheduled_for      TIMESTAMPTZ,
  delivered_at       TIMESTAMPTZ,
  failure_reason     TEXT CHECK (failure_reason IN ('customer_unreachable','address_not_found','refused','payment_issue','vehicle_issue','other')),
  otp_hash           BYTEA,                      -- delivery OTP sent to customer
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_deliv_order ON delivery.deliveries (order_id);
CREATE INDEX ix_deliv_queue ON delivery.deliveries (zone_id, status) WHERE status IN ('pending_assignment','assigned');
CREATE TABLE delivery.delivery_items (            -- which order lines are on this trip
  delivery_id   UUID NOT NULL REFERENCES delivery.deliveries(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL REFERENCES sales.order_items(id),
  quantity      INT NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (delivery_id, order_item_id)
);
-- Full assignment history incl. rejections & reassignments.
CREATE TABLE delivery.driver_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id   UUID NOT NULL REFERENCES delivery.deliveries(id),
  driver_id     UUID NOT NULL REFERENCES delivery.drivers(id),
  vehicle_id    UUID REFERENCES delivery.vehicles(id),
  assigned_by   UUID REFERENCES iam.users(id),   -- NULL = auto-dispatch (future)
  assignment_method TEXT NOT NULL DEFAULT 'manual' CHECK (assignment_method IN ('manual','auto')),
  status        TEXT NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','accepted','rejected','expired','cancelled','completed')),
  reject_reason TEXT,
  offered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at  TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_one_live_assignment ON delivery.driver_assignments (delivery_id)
  WHERE status IN ('offered','accepted');
CREATE INDEX ix_assign_driver ON delivery.driver_assignments (driver_id, offered_at DESC);
CREATE TABLE delivery.delivery_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id   UUID NOT NULL REFERENCES delivery.deliveries(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,                   -- status change / note / call_attempt
  from_status   TEXT,
  to_status     TEXT,
  location      GEOGRAPHY(Point, 4326),
  note          TEXT,
  actor_id      UUID REFERENCES iam.users(id),
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_deliv_events ON delivery.delivery_events (delivery_id, occurred_at);
-- High-volume GPS pings. Partition by month in production (pg_partman);
-- retain raw pings ~90 days, keep only delivery_events long-term.
CREATE TABLE delivery.driver_location_pings (
  driver_id     UUID NOT NULL REFERENCES delivery.drivers(id),
  recorded_at   TIMESTAMPTZ NOT NULL,
  location      GEOGRAPHY(Point, 4326) NOT NULL,
  accuracy_m    REAL,
  speed_kmh     REAL,
  delivery_id   UUID REFERENCES delivery.deliveries(id),
  PRIMARY KEY (driver_id, recorded_at)
);
CREATE INDEX ix_pings_time ON delivery.driver_location_pings USING BRIN (recorded_at);
CREATE TABLE delivery.proof_of_delivery (
  delivery_id     UUID PRIMARY KEY REFERENCES delivery.deliveries(id),   -- 1:1
  method          TEXT NOT NULL CHECK (method IN ('otp','signature','photo','otp_and_photo')),
  otp_verified    BOOLEAN NOT NULL DEFAULT false,
  signature_key   TEXT,
  photo_key       TEXT,
  received_by_name TEXT,
  location        GEOGRAPHY(Point, 4326),
  cod_collected   NUMERIC(18,2) CHECK (cod_collected >= 0),
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (method NOT IN ('otp','otp_and_photo') OR otp_verified),
  CHECK (method <> 'signature' OR signature_key IS NOT NULL),
  CHECK (method NOT IN ('photo','otp_and_photo') OR photo_key IS NOT NULL)
);
CREATE TABLE delivery.delivery_feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES sales.orders(id),
  delivery_id   UUID REFERENCES delivery.deliveries(id),
  customer_id   UUID NOT NULL REFERENCES crm.customers(id),
  rating        SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, customer_id)
);
-- MIGRATION 014 - notifications --------------------------------------
CREATE TABLE notify.message_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_code      TEXT NOT NULL,                 -- 'order.confirmed'
  channel         TEXT NOT NULL CHECK (channel IN ('sms','whatsapp','email','push','in_app')),
  locale          TEXT NOT NULL,
  version         INT NOT NULL DEFAULT 1,
  subject         TEXT,
  body            TEXT NOT NULL,                 -- {{order_number}} placeholders
  provider_template_name TEXT,                   -- WhatsApp: Meta-approved template name
  provider_approval_status TEXT CHECK (provider_approval_status IN ('not_required','pending','approved','rejected')),
  category        TEXT NOT NULL CHECK (category IN ('transactional','marketing','security')),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_code, channel, locale, version)
);
CREATE TABLE notify.notification_providers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,            -- 'ethio_telecom_sms','afromessage','meta_cloud_api','fcm','ses'
  channel       TEXT NOT NULL CHECK (channel IN ('sms','whatsapp','email','push')),
  priority      SMALLINT NOT NULL DEFAULT 1,     -- failover order within channel
  integration_status TEXT NOT NULL DEFAULT 'unverified' CHECK (integration_status IN ('unverified','sandbox','live','disabled')),
  config        JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE notify.communication_preferences (
  user_id       UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL CHECK (channel IN ('sms','whatsapp','email','push','in_app')),
  category      TEXT NOT NULL CHECK (category IN ('transactional','marketing')),
  opted_in      BOOLEAN NOT NULL,
  consent_source TEXT,                           -- 'signup_checkbox','whatsapp_reply','admin'
  consented_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel, category)
);
CREATE TABLE notify.customer_segments (           -- target groups for broadcasts
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  rule          JSONB,                           -- dynamic filter; NULL = static list
  created_by    UUID REFERENCES iam.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE notify.customer_segment_members (
  segment_id    UUID NOT NULL REFERENCES notify.customer_segments(id) ON DELETE CASCADE,
  customer_id   UUID NOT NULL REFERENCES crm.customers(id) ON DELETE CASCADE,
  PRIMARY KEY (segment_id, customer_id)
);
CREATE TABLE notify.campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  segment_id    UUID REFERENCES notify.customer_segments(id),
  template_id   UUID NOT NULL REFERENCES notify.message_templates(id),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','cancelled')),
  scheduled_at  TIMESTAMPTZ,
  created_by    UUID NOT NULL REFERENCES iam.users(id),
  approved_by   UUID REFERENCES iam.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Logical notification (one event → one user). In-app feed reads this.
CREATE TABLE notify.notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  event_code    TEXT NOT NULL,
  campaign_id   UUID REFERENCES notify.campaigns(id),
  entity_type   TEXT,                            -- 'order','special_order_request'
  entity_id     UUID,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key    TEXT UNIQUE,                     -- e.g. 'order.confirmed:<order_id>'
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_notif_user ON notify.notifications (user_id, created_at DESC);
CREATE INDEX ix_notif_unread ON notify.notifications (user_id) WHERE read_at IS NULL;
-- Physical send attempts per channel (WhatsApp and SMS are separate rows).
CREATE TABLE notify.message_deliveries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id     UUID NOT NULL REFERENCES notify.notifications(id) ON DELETE CASCADE,
  channel             TEXT NOT NULL CHECK (channel IN ('sms','whatsapp','email','push')),
  provider_id         UUID REFERENCES notify.notification_providers(id),
  template_id         UUID REFERENCES notify.message_templates(id),
  destination_masked  TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                        'queued','sending','sent','delivered','read','failed','skipped_no_consent','fallback_triggered')),
  provider_message_id TEXT,
  attempt_count       SMALLINT NOT NULL DEFAULT 0,
  next_attempt_at     TIMESTAMPTZ,
  last_error          TEXT,
  cost                NUMERIC(10,4),
  sent_at             TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_msg_retry ON notify.message_deliveries (next_attempt_at) WHERE status IN ('queued','failed');
CREATE INDEX ix_msg_notif ON notify.message_deliveries (notification_id);
CREATE UNIQUE INDEX ux_msg_provider_id ON notify.message_deliveries (provider_id, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE TABLE notify.device_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
  token         TEXT NOT NULL UNIQUE,
  app           TEXT NOT NULL CHECK (app IN ('customer','driver')),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- MIGRATION 015 - finance --------------------------------------------
CREATE TABLE finance.tax_rates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL,                   -- 'VAT15','TOT2','EXEMPT'
  tax_category  TEXT NOT NULL,                   -- matches catalog.products.tax_category
  country_code  CHAR(2) NOT NULL DEFAULT 'ET',
  rate          NUMERIC(5,4) NOT NULL CHECK (rate BETWEEN 0 AND 1),
  valid_during  TSTZRANGE NOT NULL,
  EXCLUDE USING gist (tax_category WITH =, country_code WITH =, valid_during WITH &&)
);
CREATE TABLE finance.invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number    TEXT NOT NULL UNIQUE,        -- sequential per fiscal year (ERCA requirement)
  invoice_type      TEXT NOT NULL CHECK (invoice_type IN ('sales','proforma','credit_note','deposit')),
  order_id          UUID REFERENCES sales.orders(id),
  customer_id       UUID NOT NULL REFERENCES crm.customers(id),
  original_invoice_id UUID REFERENCES finance.invoices(id),   -- for credit notes
  -- buyer snapshot for legal document
  buyer_name        TEXT NOT NULL,
  buyer_tin         TEXT,
  currency          CHAR(3) NOT NULL REFERENCES core.currencies(code),
  subtotal          NUMERIC(18,2) NOT NULL,
  tax_total         NUMERIC(18,2) NOT NULL DEFAULT 0,
  grand_total       NUMERIC(18,2) NOT NULL,
  amount_due        NUMERIC(18,2) NOT NULL,
  status            TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('draft','issued','partially_paid','paid','void')),
  issued_at         TIMESTAMPTZ,
  due_date          DATE,
  pdf_storage_key   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((invoice_type = 'credit_note') = (original_invoice_id IS NOT NULL))
);
CREATE INDEX ix_inv_customer ON finance.invoices (customer_id, issued_at DESC);
CREATE INDEX ix_inv_order ON finance.invoices (order_id);
CREATE INDEX ix_inv_ar ON finance.invoices (due_date) WHERE status IN ('issued','partially_paid');
CREATE TABLE finance.invoice_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID NOT NULL REFERENCES finance.invoices(id) ON DELETE CASCADE,
  line_no       SMALLINT NOT NULL,
  order_item_id UUID REFERENCES sales.order_items(id),
  description   TEXT NOT NULL,
  quantity      NUMERIC(12,3) NOT NULL,
  unit_price    NUMERIC(18,2) NOT NULL,
  tax_rate_id   UUID REFERENCES finance.tax_rates(id),
  tax_amount    NUMERIC(18,2) NOT NULL DEFAULT 0,
  line_total    NUMERIC(18,2) NOT NULL,
  UNIQUE (invoice_id, line_no)
);
-- Which payments settle which invoices (M:N: deposits, partial payments).
CREATE TABLE finance.payment_allocations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL REFERENCES payments.payment_transactions(id),
  invoice_id      UUID NOT NULL REFERENCES finance.invoices(id),
  amount          NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  allocated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, invoice_id)
);
CREATE TABLE finance.expense_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,            -- 'freight','customs','fuel','driver_pay','packaging'
  name          TEXT NOT NULL,
  ledger_account_code TEXT                      -- mapped later to chart of accounts
);
CREATE TABLE finance.expenses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_number    TEXT NOT NULL UNIQUE,
  category_id       UUID NOT NULL REFERENCES finance.expense_categories(id),
  region_id         UUID NOT NULL REFERENCES core.operating_regions(id),
  supplier_id       UUID REFERENCES procurement.suppliers(id),
  purchase_order_id UUID REFERENCES procurement.purchase_orders(id),
  shipment_id       UUID REFERENCES logistics.international_shipments(id),
  delivery_id       UUID REFERENCES delivery.deliveries(id),
  special_order_request_id UUID REFERENCES procurement.special_order_requests(id),
  amount            NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency          CHAR(3) NOT NULL REFERENCES core.currencies(code),
  exchange_rate_to_etb NUMERIC(20,8) CHECK (exchange_rate_to_etb > 0),
  amount_etb        NUMERIC(18,2) GENERATED ALWAYS AS (round(amount * COALESCE(exchange_rate_to_etb, 1), 2)) STORED,
  incurred_on       DATE NOT NULL,
  status            TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','paid','rejected')),
  receipt_key       TEXT,
  submitted_by      UUID NOT NULL REFERENCES iam.users(id),
  approved_by       UUID REFERENCES iam.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (currency = 'ETB' OR exchange_rate_to_etb IS NOT NULL)
);
CREATE INDEX ix_exp_period ON finance.expenses (region_id, incurred_on);
CREATE TABLE finance.supplier_payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id       UUID NOT NULL REFERENCES procurement.suppliers(id),
  purchase_order_id UUID REFERENCES procurement.purchase_orders(id),
  amount            NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency          CHAR(3) NOT NULL REFERENCES core.currencies(code),
  exchange_rate_to_etb NUMERIC(20,8),
  method            TEXT NOT NULL CHECK (method IN ('bank_transfer','cash','lc','card','other')),
  reference         TEXT,
  paid_at           TIMESTAMPTZ NOT NULL,
  recorded_by       UUID NOT NULL REFERENCES iam.users(id),
  approved_by       UUID REFERENCES iam.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Double-entry ready (Phase 6). MVP can post summarised entries only.
CREATE TABLE finance.ledger_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,            -- '1100' Cash, '1200' AR, '4000' Revenue
  name          TEXT NOT NULL,
  account_type  TEXT NOT NULL CHECK (account_type IN ('asset','liability','equity','revenue','expense')),
  parent_id     UUID REFERENCES finance.ledger_accounts(id),
  currency      CHAR(3) REFERENCES core.currencies(code),
  is_active     BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE finance.journal_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number  TEXT NOT NULL UNIQUE,
  entry_date    DATE NOT NULL,
  description   TEXT NOT NULL,
  source_type   TEXT NOT NULL,                   -- 'invoice','payment','refund','expense','grn'
  source_id     UUID NOT NULL,
  status        TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','posted','reversed')),
  reversal_of_id UUID REFERENCES finance.journal_entries(id),
  posted_by     UUID REFERENCES iam.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id, reversal_of_id)
);
CREATE TABLE finance.journal_lines (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journal_entry_id UUID NOT NULL REFERENCES finance.journal_entries(id) ON DELETE CASCADE,
  account_id       UUID NOT NULL REFERENCES finance.ledger_accounts(id),
  debit            NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit           NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  currency         CHAR(3) NOT NULL REFERENCES core.currencies(code),
  amount_etb       NUMERIC(18,2) NOT NULL,       -- functional currency
  CHECK ((debit = 0) <> (credit = 0))
);
CREATE INDEX ix_jl_entry ON finance.journal_lines (journal_entry_id);
CREATE INDEX ix_jl_account ON finance.journal_lines (account_id);
-- Balanced-entry guard: deferred so all lines of an entry insert first.
CREATE OR REPLACE FUNCTION finance.assert_entry_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE d NUMERIC; c NUMERIC;
BEGIN
  SELECT COALESCE(sum(debit),0), COALESCE(sum(credit),0) INTO d, c
  FROM finance.journal_lines WHERE journal_entry_id = NEW.journal_entry_id;
  IF d <> c THEN
    RAISE EXCEPTION 'Journal entry % unbalanced: debit % credit %', NEW.journal_entry_id, d, c;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_journal_balanced
  AFTER INSERT OR UPDATE ON finance.journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance.assert_entry_balanced();
-- MIGRATION 016 - audit & integration plumbing -----------------------
-- Generic audit trail for every privileged write. Append-only; the app
-- DB role gets INSERT only (no UPDATE/DELETE). Partition by month.
CREATE TABLE audit.audit_logs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id      UUID REFERENCES iam.users(id),
  actor_role    TEXT,
  session_id    UUID,
  ip_address    INET,
  action        TEXT NOT NULL,                   -- 'product.price.update','order.cancel'
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  before_data   JSONB,                           -- PII fields redacted before write
  after_data    JSONB,
  request_id    TEXT
);
CREATE INDEX ix_audit_entity ON audit.audit_logs (entity_type, entity_id, occurred_at DESC);
CREATE INDEX ix_audit_actor ON audit.audit_logs (actor_id, occurred_at DESC);
CREATE INDEX ix_audit_time ON audit.audit_logs USING BRIN (occurred_at);
-- Who viewed sensitive data (driver IDs, customer PII exports).
CREATE TABLE audit.data_access_logs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id      UUID NOT NULL REFERENCES iam.users(id),
  resource      TEXT NOT NULL,                   -- 'driver.license_number'
  resource_id   TEXT NOT NULL,
  purpose       TEXT,
  ip_address    INET
);
CREATE INDEX ix_dal_actor ON audit.data_access_logs (actor_id, occurred_at DESC);
-- Transactional outbox: domain events written in the SAME transaction as
-- the business change; a worker publishes them (BullMQ) → notifications etc.
CREATE TABLE core.outbox_events (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id   UUID NOT NULL,
  event_type     TEXT NOT NULL,                  -- 'order.placed','payment.succeeded'
  payload        JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ,
  attempts       SMALLINT NOT NULL DEFAULT 0
);
CREATE INDEX ix_outbox_unpublished ON core.outbox_events (id) WHERE published_at IS NULL;
-- Generic API idempotency store (POST /checkout, /payments, /refunds).
CREATE TABLE core.idempotency_keys (
  key            TEXT NOT NULL,
  user_id        UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  endpoint       TEXT NOT NULL,
  request_hash   BYTEA NOT NULL,                 -- reject same key + different body
  response_code  SMALLINT,
  response_body  JSONB,
  locked_until   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, endpoint, key)
);
CREATE INDEX ix_idem_gc ON core.idempotency_keys (created_at);
-- MIGRATION 017 - updated_at triggers --------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.table_schema, c.table_name
           FROM information_schema.columns c
           JOIN information_schema.tables t USING (table_schema, table_name)
           WHERE c.column_name = 'updated_at' AND t.table_type = 'BASE TABLE'
             AND c.table_schema IN ('core','iam','crm','catalog','pricing','inventory','sales',
                                    'procurement','logistics','payments','delivery','notify','finance')
  LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON %I.%I
                    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at()',
                   r.table_name, r.table_schema, r.table_name);
  END LOOP;
END $$;
-- MIGRATION 018 - seed reference data --------------------------------
INSERT INTO core.currencies (code, name, minor_units) VALUES
  ('ETB','Ethiopian Birr',2), ('AED','UAE Dirham',2), ('USD','US Dollar',2);
INSERT INTO core.operating_regions (code, name, country_code, base_currency, timezone) VALUES
  ('ET','Ethiopia','ET','ETB','Africa/Addis_Ababa'),
  ('AE-DXB','Dubai','AE','AED','Asia/Dubai');
INSERT INTO iam.roles (code, name, is_system) VALUES
  ('super_admin','Super Administrator',true),
  ('et_operations_admin','Ethiopia Operations Administrator',true),
  ('dubai_procurement_admin','Dubai Procurement Administrator',true),
  ('warehouse_manager','Inventory / Warehouse Manager',true),
  ('finance_admin','Finance Administrator',true),
  ('support_agent','Customer Support Agent',true),
  ('logistics_manager','Delivery / Logistics Manager',true),
  ('driver','Driver',true),
  ('retail_customer','Retail Customer',true),
  ('wholesale_customer','Wholesale Customer',true);
-- Providers seeded as 'unverified': none are confirmed integrations.
INSERT INTO payments.payment_providers (code, name, provider_kind, integration_status) VALUES
  ('telebirr','telebirr (Ethio Telecom)','wallet','unverified'),
  ('chapa','Chapa','gateway','unverified'),
  ('cbe','Commercial Bank of Ethiopia','bank','unverified'),
  ('bank_transfer','Manual bank transfer','manual','live'),
  ('cash_on_delivery','Cash on delivery','manual','live');
-- MIGRATION 019 - table comments (self-documenting catalog) -------
COMMENT ON TABLE audit.audit_logs IS 'Append-only record of every privileged write: who, what, before/after.';
COMMENT ON TABLE audit.data_access_logs IS 'Who viewed or exported sensitive data (driver IDs, customer PII).';
COMMENT ON TABLE catalog.brands IS 'Product brands for filtering and merchandising.';
COMMENT ON TABLE catalog.categories IS 'Category tree (self-referencing) with materialised path for fast subtree queries.';
COMMENT ON TABLE catalog.product_images IS 'Image references (object-storage keys) per product or variant.';
COMMENT ON TABLE catalog.product_variants IS 'Sellable SKU (size/colour/storage). Prices, stock and order lines all point here.';
COMMENT ON TABLE catalog.products IS 'Product master: shared description, category, brand, specs. Not directly sellable.';
COMMENT ON TABLE core.currencies IS 'ISO-4217 currencies the platform can price, pay or cost in (ETB, AED, USD).';
COMMENT ON TABLE core.document_sequences IS 'Gap-free counters for human-readable numbers (ORD-, INV-, PO-) per document type and year.';
COMMENT ON TABLE core.exchange_rates IS 'Append-only FX rate history. Documents copy the rate they used so history never changes.';
COMMENT ON TABLE core.idempotency_keys IS 'Stores the first response for each client idempotency key so retried POSTs never double-execute.';
COMMENT ON TABLE core.operating_regions IS 'Business regions (Ethiopia, Dubai). Scopes warehouses, orders, staff roles and reporting.';
COMMENT ON TABLE core.outbox_events IS 'Transactional outbox: domain events written in the same transaction as the change, then published by a worker.';
COMMENT ON TABLE core.system_settings IS 'Non-secret runtime configuration (reservation TTL, default fees, feature flags).';
COMMENT ON TABLE crm.business_accounts IS 'Wholesale companies: TIN, trade licence, credit limit, payment terms, approval state.';
COMMENT ON TABLE crm.customer_addresses IS 'Customer address book with Ethiopian address parts, landmark and a map pin (PostGIS point).';
COMMENT ON TABLE crm.customers IS 'Customer profile (1:1 with a customer user); retail or wholesale, linked to a business account when wholesale.';
COMMENT ON TABLE delivery.deliveries IS 'One physical delivery trip for all or part of an order.';
COMMENT ON TABLE delivery.delivery_events IS 'Delivery status timeline and notes, with optional location.';
COMMENT ON TABLE delivery.delivery_feedback IS 'Customer rating and comment after delivery.';
COMMENT ON TABLE delivery.delivery_items IS 'Which order lines and quantities are on a delivery (supports partial fulfilment).';
COMMENT ON TABLE delivery.delivery_zones IS 'Delivery areas as map polygons with fee rules and SLA.';
COMMENT ON TABLE delivery.driver_assignments IS 'Offer/accept/reject history of drivers for a delivery; one live assignment at a time.';
COMMENT ON TABLE delivery.driver_location_pings IS 'High-volume GPS points from the driver app (short retention, partition by month).';
COMMENT ON TABLE delivery.driver_vehicle_assignments IS 'Who drove which vehicle when; overlap is prevented.';
COMMENT ON TABLE delivery.drivers IS 'Driver profile linked to a user; licence and ID numbers encrypted with blind-index hashes.';
COMMENT ON TABLE delivery.proof_of_delivery IS 'OTP/signature/photo evidence and cash collected (1:1 with delivery).';
COMMENT ON TABLE delivery.vehicles IS 'Fleet vehicles with plate, type and capacity.';
COMMENT ON TABLE finance.expense_categories IS 'Expense types (freight, customs, fuel, driver pay) mapped to ledger accounts.';
COMMENT ON TABLE finance.expenses IS 'Operating expenses linked to the PO, shipment, delivery or special order that caused them.';
COMMENT ON TABLE finance.invoice_items IS 'Invoice lines.';
COMMENT ON TABLE finance.invoices IS 'Legal sales invoices, proformas, deposit invoices and credit notes with buyer snapshot.';
COMMENT ON TABLE finance.journal_entries IS 'Journal entry header tied to its source document.';
COMMENT ON TABLE finance.journal_lines IS 'Debit/credit lines; a deferred trigger rejects unbalanced entries.';
COMMENT ON TABLE finance.ledger_accounts IS 'Chart of accounts (Phase 6 double-entry).';
COMMENT ON TABLE finance.payment_allocations IS 'Bridge: which payments settle which invoices (M:N; partial payments).';
COMMENT ON TABLE finance.supplier_payments IS 'Payments made to suppliers (accounts payable).';
COMMENT ON TABLE finance.tax_rates IS 'VAT/TOT rates by tax category with validity windows (no overlaps).';
COMMENT ON TABLE iam.otp_challenges IS 'One-time codes for phone/email verification, OTP login, password reset and MFA.';
COMMENT ON TABLE iam.permissions IS 'Atomic capabilities checked by the API (orders.read, payments.refund.approve).';
COMMENT ON TABLE iam.role_permissions IS 'Bridge table: which permissions each role grants (M:N).';
COMMENT ON TABLE iam.roles IS 'Named bundles of permissions (Super Admin, Dubai Procurement Admin, Driver...).';
COMMENT ON TABLE iam.sessions IS 'Refresh-token sessions per device; supports revocation and MFA-verified flag.';
COMMENT ON TABLE iam.user_roles IS 'Bridge table: which roles a user holds, optionally limited to one operating region (M:N).';
COMMENT ON TABLE iam.users IS 'Every login identity: customers, staff and drivers. Phone-first, email optional.';
COMMENT ON TABLE inventory.inventory_movements IS 'Append-only stock ledger. Every change to on-hand quantity has exactly one row here.';
COMMENT ON TABLE inventory.stock_adjustments IS 'Approved corrections: cycle counts, damage, theft, opening balances.';
COMMENT ON TABLE inventory.stock_balances IS 'Current quantity per warehouse × variant: on hand, reserved, damaged. Guarded so reserved can never exceed on hand.';
COMMENT ON TABLE inventory.stock_reservations IS 'Stock held for an order line until paid/fulfilled or the hold expires.';
COMMENT ON TABLE inventory.stock_transfer_items IS 'Lines of a stock transfer.';
COMMENT ON TABLE inventory.stock_transfers IS 'Movement of stock between warehouses (header).';
COMMENT ON TABLE inventory.storage_locations IS 'Bins/shelves inside a warehouse, incl. quarantine, damaged and returns areas.';
COMMENT ON TABLE inventory.warehouses IS 'Physical stock locations: warehouses, stores, Dubai consolidation hub.';
COMMENT ON TABLE logistics.customs_records IS 'Customs declaration, duties, VAT, excise and release status for a shipment.';
COMMENT ON TABLE logistics.international_shipments IS 'Consolidated Dubai to Ethiopia shipments (air/sea/courier) with carrier and tracking.';
COMMENT ON TABLE logistics.shipment_contents IS 'Bridge: which special orders travel in which shipment (M:N).';
COMMENT ON TABLE logistics.shipment_events IS 'Tracking timeline of a shipment (manual or carrier API).';
COMMENT ON TABLE notify.campaigns IS 'Admin broadcasts to a segment using a template, with approval.';
COMMENT ON TABLE notify.communication_preferences IS 'Per-user opt-in per channel and category (transactional vs marketing) with consent source.';
COMMENT ON TABLE notify.customer_segment_members IS 'Bridge: customers in a static segment (M:N).';
COMMENT ON TABLE notify.customer_segments IS 'Named customer groups for broadcasts (static or rule-based).';
COMMENT ON TABLE notify.device_tokens IS 'Push tokens for the customer and driver apps.';
COMMENT ON TABLE notify.message_deliveries IS 'Each channel send attempt (SMS and WhatsApp separately) with provider status and retries.';
COMMENT ON TABLE notify.message_templates IS 'Message text per event, channel and language; WhatsApp templates track Meta approval.';
COMMENT ON TABLE notify.notification_providers IS 'SMS, WhatsApp, email and push providers with failover priority.';
COMMENT ON TABLE notify.notifications IS 'One logical notification to one user; also the in-app inbox.';
COMMENT ON TABLE payments.payment_intents IS 'What we are asking the customer to pay for an order: full, deposit, balance.';
COMMENT ON TABLE payments.payment_methods IS 'Methods shown at checkout, each backed by a provider.';
COMMENT ON TABLE payments.payment_providers IS 'Payment provider registry (telebirr, Chapa, CBE, manual). Credentials live in the secret store, not here.';
COMMENT ON TABLE payments.payment_status_history IS 'Every payment status change with its source (webhook, verify API, admin).';
COMMENT ON TABLE payments.payment_transactions IS 'Each attempt with a provider. Only a verified webhook or verify API marks success.';
COMMENT ON TABLE payments.reconciliation_items IS 'Statement line vs our transaction: matched or the type of mismatch.';
COMMENT ON TABLE payments.reconciliation_runs IS 'Import of a provider settlement/statement for a period.';
COMMENT ON TABLE payments.refunds IS 'Refund requests and outcomes, with maker-checker approval and idempotency key.';
COMMENT ON TABLE payments.webhook_events IS 'Raw provider callbacks stored before processing, de-duplicated on provider event id.';
COMMENT ON TABLE pricing.discount_codes IS 'Redeemable codes attached to a promotion with usage limits.';
COMMENT ON TABLE pricing.price_list_items IS 'Price per variant per quantity tier, versioned by time range. History is kept by closing old rows, never overwriting.';
COMMENT ON TABLE pricing.price_lists IS 'Price books: retail, wholesale, and customer-specific lists, per currency and validity window.';
COMMENT ON TABLE pricing.promotions IS 'Campaign rules: percentage, fixed or free-delivery discounts with targeting and dates.';
COMMENT ON TABLE procurement.goods_receipt_items IS 'Received and rejected quantities per PO line.';
COMMENT ON TABLE procurement.goods_receipts IS 'Goods received note (GRN) against a purchase order into a warehouse.';
COMMENT ON TABLE procurement.purchase_order_items IS 'Lines of a purchase order.';
COMMENT ON TABLE procurement.purchase_orders IS 'Orders placed with suppliers, incl. back-to-back POs for special orders. Maker-checker approval.';
COMMENT ON TABLE procurement.special_order_attachments IS 'Reference images/PDFs uploaded with a special order request (virus-scanned).';
COMMENT ON TABLE procurement.special_order_messages IS 'Conversation thread between customer and Dubai team on a request (internal notes flagged).';
COMMENT ON TABLE procurement.special_order_requests IS 'Customer request for an item not in the catalogue, sourced by the Dubai team.';
COMMENT ON TABLE procurement.special_order_status_history IS 'Every status change of a special order request, with who/when/note.';
COMMENT ON TABLE procurement.suppliers IS 'Local and international suppliers with terms and (encrypted) bank details.';
COMMENT ON TABLE sales.cart_items IS 'Variants and quantities in a cart. No price stored; price is resolved at checkout.';
COMMENT ON TABLE sales.carts IS 'Shopping cart per customer or guest token.';
COMMENT ON TABLE sales.order_discounts IS 'Promotions and codes applied to an order and the amount each gave.';
COMMENT ON TABLE sales.order_items IS 'Order lines with frozen price, tax and fulfilled/cancelled/returned quantities.';
COMMENT ON TABLE sales.order_status_history IS 'Every order status change with actor and reason.';
COMMENT ON TABLE sales.orders IS 'One table for retail, wholesale and special orders. Amounts and delivery address are frozen snapshots.';
COMMENT ON TABLE sales.quotation_items IS 'Quotation lines: products plus shipping, service fee, customs estimate and other charges.';
COMMENT ON TABLE sales.quotations IS 'Priced offers to customers, for both wholesale RFQs and Dubai special orders. Revisions supersede earlier ones.';
COMMENT ON TABLE sales.return_items IS 'Order lines and quantities being returned, with condition after inspection.';
COMMENT ON TABLE sales.returns IS 'Return/RMA requests for delivered orders.';
