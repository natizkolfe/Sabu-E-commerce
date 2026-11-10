-- MIGRATION 023 - guest checkout + payment extensions --------------------

-- Guest customers (no iam.users required)
ALTER TABLE crm.customers ALTER COLUMN user_id DROP NOT NULL;
DROP INDEX IF EXISTS crm.ux_customers_user; -- may not exist; user_id UNIQUE constraint name varies
ALTER TABLE crm.customers DROP CONSTRAINT IF EXISTS customers_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_user_id
  ON crm.customers (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE crm.customers
  ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT
    CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$');

CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_guest_phone
  ON crm.customers (phone_e164)
  WHERE is_guest = true AND phone_e164 IS NOT NULL;

-- Order guest tracking
ALTER TABLE sales.orders
  ADD COLUMN IF NOT EXISTS guest_track_token_hash BYTEA,
  ADD COLUMN IF NOT EXISTS guest_phone_e164 TEXT
    CHECK (guest_phone_e164 IS NULL OR guest_phone_e164 ~ '^\+[1-9][0-9]{7,14}$');

CREATE INDEX IF NOT EXISTS ix_orders_guest_phone
  ON sales.orders (guest_phone_e164)
  WHERE guest_phone_e164 IS NOT NULL;

-- Company bank accounts for manual transfer instructions
CREATE TABLE IF NOT EXISTS payments.company_bank_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name       TEXT NOT NULL,
  account_name    TEXT NOT NULL,
  account_number  TEXT NOT NULL,
  account_number_masked TEXT NOT NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'ETB' REFERENCES core.currencies(code),
  branch_name     TEXT,
  instructions    TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE payments.payment_transactions
  ADD COLUMN IF NOT EXISTS company_bank_account_id UUID
    REFERENCES payments.company_bank_accounts(id),
  ADD COLUMN IF NOT EXISTS customer_reference TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Bulk purchasing flag
ALTER TABLE catalog.products
  ADD COLUMN IF NOT EXISTS bulk_purchasing_enabled BOOLEAN NOT NULL DEFAULT false;

-- Activate payment methods for Phase A
INSERT INTO payments.payment_methods (provider_id, code, display_name, channel, is_active, sort_order, allowed_for)
SELECT p.id, 'chapa_checkout', 'Chapa (cards, wallets, banks)', 'redirect', true, 10, '{retail,wholesale,special_order}'
FROM payments.payment_providers p WHERE p.code = 'chapa'
ON CONFLICT (code) DO UPDATE SET is_active = true, display_name = EXCLUDED.display_name;

INSERT INTO payments.payment_methods (provider_id, code, display_name, channel, is_active, sort_order, allowed_for)
SELECT p.id, 'bank_transfer_manual', 'Bank transfer (receipt upload)', 'manual_verification', true, 20, '{retail,wholesale,special_order}'
FROM payments.payment_providers p WHERE p.code = 'bank_transfer'
ON CONFLICT (code) DO UPDATE SET is_active = true;

UPDATE payments.payment_providers
SET integration_status = 'sandbox'
WHERE code = 'chapa';

UPDATE payments.payment_providers
SET integration_status = 'live'
WHERE code = 'bank_transfer';

INSERT INTO payments.company_bank_accounts (
  bank_name, account_name, account_number, account_number_masked, currency, branch_name, instructions, sort_order
)
SELECT * FROM (VALUES
  ('Commercial Bank of Ethiopia', 'Sabu Trading PLC', '1000123456789', '****6789', 'ETB', 'Bole',
   'Transfer the exact order total. Use the order number as the transfer remark when possible.', 10),
  ('Bank of Abyssinia', 'Sabu Trading PLC', '2000987654321', '****4321', 'ETB', 'Kazanchis',
   'Upload a clear screenshot of the completed transfer for verification.', 20)
) AS v(bank_name, account_name, account_number, account_number_masked, currency, branch_name, instructions, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM payments.company_bank_accounts LIMIT 1);
