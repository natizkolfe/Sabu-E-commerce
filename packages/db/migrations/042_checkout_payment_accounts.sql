-- MIGRATION 042 — multi-method checkout payment accounts (Telebirr, CBE, other banks)

-- Prefer CBE as featured bank account for storefront "CBE" option
ALTER TABLE payments.company_bank_accounts
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS ux_company_bank_accounts_code
  ON payments.company_bank_accounts (code)
  WHERE code IS NOT NULL;

-- Telebirr merchant phone for Sabu
UPDATE payments.telebirr_merchant_settings
SET
  display_name = 'Sabu Online Shopping',
  merchant_account = '+251911129726',
  instructions = 'Open Telebirr, send the exact Total Payable to the Sabu merchant account, then enter the transaction reference below.',
  help_text = 'Keep your Telebirr SMS or app receipt until Sabu verifies the payment.',
  txn_format_regex = '^[A-Za-z0-9\\-]{6,40}$',
  is_active = true,
  updated_at = now()
WHERE id = 1;

-- Upsert CBE receiving account
UPDATE payments.company_bank_accounts
SET
  bank_name = 'Commercial Bank of Ethiopia (CBE)',
  account_name = 'Sabu Online Shopping',
  account_number = '1000199513676',
  account_number_masked = '****3676',
  instructions = 'Transfer the exact Total Payable. Use your order number or name as the transfer remark when possible.',
  is_active = true,
  sort_order = 10,
  code = 'cbe',
  is_featured = true,
  updated_at = now()
WHERE account_number IN ('1000199513676', '1000123456789')
   OR code = 'cbe'
   OR bank_name ILIKE 'Commercial Bank of Ethiopia%';

INSERT INTO payments.company_bank_accounts (
  bank_name, account_name, account_number, account_number_masked,
  currency, branch_name, instructions, is_active, sort_order, code, is_featured
)
SELECT
  'Commercial Bank of Ethiopia (CBE)',
  'Sabu Online Shopping',
  '1000199513676',
  '****3676',
  'ETB',
  'Addis Ababa',
  'Transfer the exact Total Payable. Use your order number or name as the transfer remark when possible.',
  true,
  10,
  'cbe',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM payments.company_bank_accounts
  WHERE account_number = '1000199513676' OR code = 'cbe'
);

UPDATE payments.company_bank_accounts
SET is_featured = false
WHERE code IS DISTINCT FROM 'cbe';

UPDATE payments.company_bank_accounts
SET is_featured = true, code = 'cbe'
WHERE account_number = '1000199513676';

-- Payment methods for checkout
INSERT INTO payments.payment_methods (provider_id, code, display_name, channel, is_active, sort_order, allowed_for)
SELECT COALESCE(
         (SELECT id FROM payments.payment_providers WHERE code = 'cbe' LIMIT 1),
         (SELECT id FROM payments.payment_providers WHERE code = 'bank_transfer' LIMIT 1)
       ),
       'cbe_manual',
       'Commercial Bank of Ethiopia (CBE)',
       'manual_verification',
       true,
       20,
       '{retail,wholesale,special_order}'
WHERE NOT EXISTS (
  SELECT 1 FROM payments.payment_methods WHERE code = 'cbe_manual'
);

UPDATE payments.payment_methods
SET is_active = true,
    display_name = 'Commercial Bank of Ethiopia (CBE)',
    channel = 'manual_verification',
    sort_order = 20
WHERE code = 'cbe_manual';

INSERT INTO payments.payment_methods (provider_id, code, display_name, channel, is_active, sort_order, allowed_for)
SELECT p.id, 'other_bank_manual', 'Other Banks', 'manual_verification', true, 30,
       '{retail,wholesale,special_order}'
FROM payments.payment_providers p WHERE p.code = 'bank_transfer'
ON CONFLICT (code) DO UPDATE
SET is_active = true,
    display_name = EXCLUDED.display_name,
    sort_order = 30;

UPDATE payments.payment_methods
SET is_active = true, display_name = 'Telebirr', sort_order = 10
WHERE code = 'telebirr_manual';

-- Ensure CBE provider is selectable on storefront (listActiveMethods filters status)
UPDATE payments.payment_providers
SET integration_status = 'live'
WHERE code IN ('cbe', 'telebirr', 'bank_transfer');

UPDATE payments.payment_methods m
SET provider_id = COALESCE(
  (SELECT id FROM payments.payment_providers WHERE code = 'cbe' LIMIT 1),
  m.provider_id
)
WHERE m.code = 'cbe_manual';

-- Keep Chapa off storefront for now; bank_transfer_manual superseded by cbe/other
UPDATE payments.payment_methods
SET is_active = false
WHERE code IN ('chapa_checkout', 'bank_transfer_manual');

-- Snapshot columns on payment transactions for historical verification
ALTER TABLE payments.payment_transactions
  ADD COLUMN IF NOT EXISTS payment_destination_label TEXT,
  ADD COLUMN IF NOT EXISTS payment_destination_value TEXT;

COMMENT ON COLUMN payments.company_bank_accounts.is_featured IS
  'Featured bank shown as dedicated CBE checkout option';
COMMENT ON COLUMN payments.payment_transactions.payment_destination_label IS
  'Frozen label shown to customer at checkout (bank or Telebirr)';
COMMENT ON COLUMN payments.payment_transactions.payment_destination_value IS
  'Frozen phone/account number at time of order';
