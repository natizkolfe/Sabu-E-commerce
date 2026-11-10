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
