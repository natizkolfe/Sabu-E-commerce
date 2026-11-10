-- MIGRATION 031 - marketplace vendors, commissions, catalog/SOR extensions

CREATE SCHEMA IF NOT EXISTS marketplace;
CREATE SCHEMA IF NOT EXISTS analytics;

-- ——— Vendors ———
CREATE TABLE IF NOT EXISTS marketplace.vendors (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_code        TEXT NOT NULL UNIQUE,
  business_name      TEXT NOT NULL,
  display_name       TEXT NOT NULL,
  phone_e164         TEXT CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email              CITEXT,
  region_id          UUID REFERENCES core.operating_regions(id),
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','active','suspended','rejected')),
  commission_rate_pct NUMERIC(7,4)
                     CHECK (commission_rate_pct IS NULL OR commission_rate_pct BETWEEN 0 AND 100),
  bank_details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketplace.vendor_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id   UUID NOT NULL REFERENCES marketplace.vendors(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  vendor_role TEXT NOT NULL DEFAULT 'owner' CHECK (vendor_role IN ('owner','staff')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, user_id)
);

CREATE TABLE IF NOT EXISTS marketplace.commission_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,
  scope         TEXT NOT NULL CHECK (scope IN ('global','vendor','category')),
  vendor_id     UUID REFERENCES marketplace.vendors(id),
  category_id   UUID REFERENCES catalog.categories(id),
  rate_pct      NUMERIC(7,4) NOT NULL CHECK (rate_pct BETWEEN 0 AND 100),
  applies_to    TEXT NOT NULL DEFAULT 'merchandise'
                CHECK (applies_to IN ('merchandise','merchandise_plus_tax')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  valid_from    TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (scope = 'global' AND vendor_id IS NULL AND category_id IS NULL)
    OR (scope = 'vendor' AND vendor_id IS NOT NULL)
    OR (scope = 'category' AND category_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS marketplace.settlements (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_number  TEXT NOT NULL UNIQUE,
  vendor_id          UUID NOT NULL REFERENCES marketplace.vendors(id),
  period_start       DATE NOT NULL,
  period_end         DATE NOT NULL,
  gross_sales        NUMERIC(18,2) NOT NULL DEFAULT 0,
  refunds            NUMERIC(18,2) NOT NULL DEFAULT 0,
  commission_total   NUMERIC(18,2) NOT NULL DEFAULT 0,
  net_payable        NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency           CHAR(3) NOT NULL DEFAULT 'ETB' REFERENCES core.currencies(code),
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','approved','paid','cancelled')),
  pdf_storage_key    TEXT,
  payout_reference   TEXT,
  paid_at            TIMESTAMPTZ,
  created_by         UUID REFERENCES iam.users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS marketplace.commission_entries (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL REFERENCES sales.orders(id),
  vendor_id          UUID NOT NULL REFERENCES marketplace.vendors(id),
  rule_id            UUID REFERENCES marketplace.commission_rules(id),
  gross_amount       NUMERIC(18,2) NOT NULL CHECK (gross_amount >= 0),
  rate_pct           NUMERIC(7,4) NOT NULL,
  commission_amount  NUMERIC(18,2) NOT NULL,
  currency           CHAR(3) NOT NULL DEFAULT 'ETB' REFERENCES core.currencies(code),
  status             TEXT NOT NULL DEFAULT 'accrued'
                     CHECK (status IN ('accrued','finalized','reversed','paid_out')),
  entry_type         TEXT NOT NULL DEFAULT 'sale'
                     CHECK (entry_type IN ('sale','refund','adjustment')),
  idempotency_key    TEXT NOT NULL UNIQUE,
  settlement_id      UUID REFERENCES marketplace.settlements(id),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_commission_vendor
  ON marketplace.commission_entries (vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_commission_order
  ON marketplace.commission_entries (order_id);

CREATE TABLE IF NOT EXISTS marketplace.settlement_items (
  settlement_id        UUID NOT NULL REFERENCES marketplace.settlements(id) ON DELETE CASCADE,
  commission_entry_id  UUID NOT NULL REFERENCES marketplace.commission_entries(id),
  PRIMARY KEY (settlement_id, commission_entry_id),
  UNIQUE (commission_entry_id)
);

-- ——— Catalog hooks ———
ALTER TABLE catalog.products
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES marketplace.vendors(id);

CREATE INDEX IF NOT EXISTS ix_products_vendor
  ON catalog.products (vendor_id) WHERE vendor_id IS NOT NULL;

ALTER TABLE catalog.categories
  ADD COLUMN IF NOT EXISTS ai_studio_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE sales.order_items
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES marketplace.vendors(id);

CREATE TABLE IF NOT EXISTS catalog.category_attribute_sets (
  category_id   UUID NOT NULL REFERENCES catalog.categories(id) ON DELETE CASCADE,
  attribute_id  UUID NOT NULL REFERENCES catalog.attributes(id) ON DELETE CASCADE,
  is_required   BOOLEAN NOT NULL DEFAULT false,
  sort_order    INT NOT NULL DEFAULT 0,
  PRIMARY KEY (category_id, attribute_id)
);

-- ——— Customer receipts ———
CREATE TABLE IF NOT EXISTS finance.customer_receipts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number        TEXT NOT NULL UNIQUE,
  order_id              UUID NOT NULL UNIQUE REFERENCES sales.orders(id),
  customer_name         TEXT NOT NULL,
  customer_phone        TEXT,
  payment_method_code   TEXT,
  payment_status        TEXT NOT NULL,
  subtotal              NUMERIC(18,2) NOT NULL DEFAULT 0,
  delivery_fee          NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_total             NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_total        NUMERIC(18,2) NOT NULL DEFAULT 0,
  grand_total           NUMERIC(18,2) NOT NULL,
  currency              CHAR(3) NOT NULL DEFAULT 'ETB',
  pdf_storage_key       TEXT,
  qr_payload            TEXT,
  access_token_hash     BYTEA,
  line_items            JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ——— Special order guest + partner extensions ———
ALTER TABLE procurement.special_order_requests
  ADD COLUMN IF NOT EXISTS guest_first_name TEXT,
  ADD COLUMN IF NOT EXISTS guest_last_name TEXT,
  ADD COLUMN IF NOT EXISTS guest_phone_e164 TEXT
    CHECK (guest_phone_e164 IS NULL OR guest_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  ADD COLUMN IF NOT EXISTS preferred_contact_channel TEXT
    CHECK (
      preferred_contact_channel IS NULL
      OR preferred_contact_channel IN ('whatsapp','telegram','viber','phone','sms')
    );

ALTER TABLE procurement.special_order_attachments
  ALTER COLUMN uploaded_by DROP NOT NULL;

ALTER TABLE procurement.suppliers
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_e164 TEXT,
  ADD COLUMN IF NOT EXISTS partner_portal_enabled BOOLEAN NOT NULL DEFAULT false;

-- Optional CHECK for whatsapp (skip if already present via constraint name collision)
DO $$
BEGIN
  ALTER TABLE procurement.suppliers
    ADD CONSTRAINT suppliers_whatsapp_e164_check
    CHECK (whatsapp_e164 IS NULL OR whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS procurement.partner_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID NOT NULL REFERENCES procurement.special_order_requests(id) ON DELETE CASCADE,
  supplier_id   UUID NOT NULL REFERENCES procurement.suppliers(id),
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','sent','viewed','quoted','declined','expired','selected')),
  sent_at       TIMESTAMPTZ,
  access_token_hash BYTEA,
  created_by    UUID REFERENCES iam.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id, supplier_id)
);

CREATE TABLE IF NOT EXISTS procurement.partner_quotations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id   UUID NOT NULL REFERENCES procurement.partner_assignments(id) ON DELETE CASCADE,
  currency        CHAR(3) NOT NULL REFERENCES core.currencies(code),
  product_cost    NUMERIC(18,2) NOT NULL CHECK (product_cost >= 0),
  shipping_cost   NUMERIC(18,2) NOT NULL DEFAULT 0,
  other_costs     NUMERIC(18,2) NOT NULL DEFAULT 0,
  lead_time_days  INT,
  notes           TEXT,
  exchange_rate   NUMERIC(18,8),
  raw_payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ——— Regions: USA + China ———
INSERT INTO core.currencies (code, name, minor_units) VALUES
  ('CNY', 'Chinese Yuan', 2)
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.operating_regions (code, name, country_code, base_currency, timezone)
VALUES
  ('US', 'United States', 'US', 'USD', 'America/New_York'),
  ('CN', 'China', 'CN', 'CNY', 'Asia/Shanghai')
ON CONFLICT (code) DO NOTHING;

-- ——— Global 2% commission rule ———
INSERT INTO marketplace.commission_rules (code, scope, rate_pct, applies_to, is_active)
VALUES ('GLOBAL-2PCT', 'global', 2.0000, 'merchandise', true)
ON CONFLICT (code) DO UPDATE SET rate_pct = 2.0000, is_active = true;

-- ——— Multi-category seed (top-level) ———
INSERT INTO catalog.categories (slug, name, name_am, path, parent_id, sort_order, is_active, ai_studio_enabled)
SELECT v.slug, v.name, v.name_am, '/' || v.slug, NULL, v.sort_order, true, v.ai
FROM (VALUES
  ('mens-fashion', 'Men''s Fashion', 'የወንዶች ፋሽን', 10, true),
  ('womens-fashion', 'Women''s Fashion', 'የሴቶች ፋሽን', 20, true),
  ('kids-fashion', 'Children''s Fashion', 'የልጆች ፋሽን', 30, true),
  ('cosmetics-beauty', 'Cosmetics & Beauty', 'ኮስሜቲክስ', 40, false),
  ('traditional-ethiopian', 'Traditional Ethiopian', 'ባህላዊ', 50, false),
  ('jebena-coffee', 'Jebena & Coffee Culture', 'ጀበና', 60, false),
  ('home-decor', 'Home & Decor', 'የቤት ማስጌጫ', 70, false),
  ('antiques', 'Antiques & Collectibles', 'ጥንታዊ', 80, false),
  ('electronics', 'Electronics', 'ኤሌክትሮኒክስ', 90, false),
  ('home-kitchen', 'Home & Kitchen', 'የቤት እቃ', 100, false),
  ('other', 'Other', 'ሌላ', 999, false)
) AS v(slug, name, name_am, sort_order, ai)
WHERE NOT EXISTS (SELECT 1 FROM catalog.categories c WHERE c.slug = v.slug);

-- Subcategories (examples)
INSERT INTO catalog.categories (slug, name, path, parent_id, sort_order, is_active, ai_studio_enabled)
SELECT v.slug, v.name, p.path || '/' || v.slug, p.id, v.sort_order, true, v.ai
FROM catalog.categories p
JOIN (VALUES
  ('mens-fashion', 'mens-clothing', 'Men''s Clothing', 11, true),
  ('mens-fashion', 'mens-shoes', 'Men''s Shoes', 12, false),
  ('mens-fashion', 'mens-accessories', 'Men''s Accessories', 13, false),
  ('womens-fashion', 'womens-clothing', 'Women''s Clothing', 21, true),
  ('womens-fashion', 'womens-shoes', 'Women''s Shoes', 22, false),
  ('womens-fashion', 'womens-accessories', 'Women''s Accessories', 23, false),
  ('kids-fashion', 'kids-clothing', 'Kids Clothing', 31, true),
  ('kids-fashion', 'kids-accessories', 'Kids Accessories', 32, true),
  ('traditional-ethiopian', 'traditional-textiles', 'Traditional Textiles', 51, false),
  ('jebena-coffee', 'jebena-pots', 'Jebena / Coffee Pots', 61, false)
) AS v(parent_slug, slug, name, sort_order, ai) ON v.parent_slug = p.slug
WHERE NOT EXISTS (SELECT 1 FROM catalog.categories c WHERE c.slug = v.slug);

-- Enable AI studio on apparel categories that already existed (kids)
UPDATE catalog.categories
SET ai_studio_enabled = true
WHERE slug IN (
  'kids-fashion','kids-clothing','kids-accessories',
  'mens-fashion','mens-clothing','womens-fashion','womens-clothing'
) OR path LIKE '%kids%' OR path LIKE '%clothing%';

-- Demo international partners (procurement.suppliers)
INSERT INTO procurement.suppliers (
  code, name, supplier_type, country_code, city, contact_name,
  contact_phone, whatsapp_e164, contact_email, default_currency,
  is_active, partner_portal_enabled
)
SELECT v.code, v.name, 'international', v.country, v.city, v.contact,
       v.wa, v.wa, v.email, v.currency, true, true
FROM (VALUES
  ('PARTNER-US-01', 'US Sourcing Hub', 'US', 'New York', 'Alex Chen', '+12125550101', 'us@partners.sabu.local', 'USD'),
  ('PARTNER-CN-01', 'Shenzhen Trade Desk', 'CN', 'Shenzhen', 'Li Wei', '+8613800138000', 'cn@partners.sabu.local', 'CNY'),
  ('PARTNER-DXB-01', 'Dubai Procurement Cell', 'AE', 'Dubai', 'Sara Al Maktoum', '+971501234567', 'dxb@partners.sabu.local', 'AED')
) AS v(code, name, country, city, contact, wa, email, currency)
WHERE NOT EXISTS (SELECT 1 FROM procurement.suppliers s WHERE s.code = v.code);

-- ——— RBAC ———
INSERT INTO iam.roles (code, name, is_system) VALUES
  ('vendor_owner', 'Marketplace Vendor Owner', true),
  ('vendor_staff', 'Marketplace Vendor Staff', true),
  ('procurement_manager', 'Procurement Manager', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.permissions (code, module, description) VALUES
  ('marketplace.vendors.read', 'marketplace', 'View vendors'),
  ('marketplace.vendors.write', 'marketplace', 'Manage vendors'),
  ('marketplace.commissions.read', 'marketplace', 'View commissions'),
  ('marketplace.commissions.write', 'marketplace', 'Adjust commissions'),
  ('marketplace.settlements.write', 'marketplace', 'Create vendor settlements'),
  ('analytics.read', 'analytics', 'View analytics dashboard'),
  ('special_orders.read', 'procurement', 'View special orders'),
  ('special_orders.write', 'procurement', 'Manage special orders'),
  ('partners.read', 'procurement', 'View sourcing partners'),
  ('partners.write', 'procurement', 'Manage sourcing partners'),
  ('receipts.write', 'finance', 'Generate receipts and statements')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code IN ('super_admin', 'et_operations_admin')
  AND (
    p.code LIKE 'marketplace.%'
    OR p.code IN (
      'analytics.read','special_orders.read','special_orders.write',
      'partners.read','partners.write','receipts.write'
    )
  )
ON CONFLICT DO NOTHING;

-- Fix: previous OR precedence may over-grant; ensure finance gets commissions
INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
JOIN iam.permissions p ON p.code IN (
  'marketplace.commissions.read','marketplace.commissions.write',
  'marketplace.settlements.write','analytics.read','receipts.write'
)
WHERE r.code = 'finance_admin'
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
JOIN iam.permissions p ON p.code IN (
  'special_orders.read','special_orders.write','partners.read','partners.write'
)
WHERE r.code IN ('procurement_manager', 'dubai_procurement_admin')
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code = 'super_admin'
ON CONFLICT DO NOTHING;

-- Analytics views (lightweight)
CREATE OR REPLACE VIEW analytics.v_order_gmv AS
SELECT
  date_trunc('day', COALESCE(o.placed_at, o.created_at)) AS day,
  count(*)::bigint AS order_count,
  coalesce(sum(o.grand_total), 0)::numeric(18,2) AS gmv,
  coalesce(sum(o.delivery_fee), 0)::numeric(18,2) AS delivery_fees,
  coalesce(avg(o.grand_total), 0)::numeric(18,2) AS aov
FROM sales.orders o
WHERE o.status NOT IN ('cancelled')
GROUP BY 1;

CREATE OR REPLACE VIEW analytics.v_commission_summary AS
SELECT
  date_trunc('day', c.created_at) AS day,
  c.vendor_id,
  v.display_name AS vendor_name,
  sum(CASE WHEN c.entry_type = 'sale' THEN c.gross_amount ELSE 0 END) AS gross_sales,
  sum(c.commission_amount) AS commission_total
FROM marketplace.commission_entries c
JOIN marketplace.vendors v ON v.id = c.vendor_id
GROUP BY 1, 2, 3;
