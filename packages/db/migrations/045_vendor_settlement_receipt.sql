-- MIGRATION 045 — vendor payout confirmation receipt on settlements

ALTER TABLE marketplace.settlements
  ADD COLUMN IF NOT EXISTS payout_receipt_key TEXT;

COMMENT ON COLUMN marketplace.settlements.payout_receipt_key IS
  'Storage key for admin-uploaded proof that the vendor remittance was paid.';
