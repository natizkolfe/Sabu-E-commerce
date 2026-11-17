-- MIGRATION 051: dynamic commission rules, adjustments, settlement payments, audit

-- ——— Enrich commission_rules ———
ALTER TABLE marketplace.commission_rules
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Africa/Addis_Ababa',
  ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commission_rules_kind_check'
  ) THEN
    ALTER TABLE marketplace.commission_rules
      ADD CONSTRAINT commission_rules_kind_check
      CHECK (kind IN ('standard','promo','event'));
  END IF;
END $$;

UPDATE marketplace.commission_rules
SET name = COALESCE(name, code),
    kind = CASE
      WHEN code ILIKE '%PROMO%' OR code ILIKE '%HOLIDAY%' THEN 'promo'
      WHEN code ILIKE '%EVENT%' OR code ILIKE '%DEMAND%' THEN 'event'
      ELSE COALESCE(kind, 'standard')
    END,
    priority = CASE
      WHEN scope = 'vendor' AND kind = 'promo' THEN 100
      WHEN scope = 'vendor' THEN 80
      WHEN scope = 'category' AND kind = 'promo' THEN 60
      WHEN scope = 'category' THEN 40
      WHEN scope = 'global' AND kind IN ('promo','event') THEN 20
      ELSE 10
    END
WHERE name IS NULL OR priority = 10;

UPDATE marketplace.commission_rules
SET is_enabled = is_active
WHERE is_enabled IS DISTINCT FROM is_active;

-- ——— Settlement status expansion ———
ALTER TABLE marketplace.settlements
  DROP CONSTRAINT IF EXISTS settlements_status_check;

ALTER TABLE marketplace.settlements
  ADD CONSTRAINT settlements_status_check
  CHECK (status IN (
    'draft','approved','pending_payment','partially_paid','paid','cancelled','adjustment_required'
  ));

ALTER TABLE marketplace.settlements
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- Backfill amount_paid for already-paid settlements
UPDATE marketplace.settlements
SET amount_paid = net_payable
WHERE status = 'paid' AND COALESCE(amount_paid, 0) = 0;

-- Keep 'approved' valid for existing rows.

-- ——— Settlement payments (partial pay support) ———
CREATE TABLE IF NOT EXISTS marketplace.settlement_payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id      UUID NOT NULL REFERENCES marketplace.settlements(id) ON DELETE CASCADE,
  amount             NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency           CHAR(3) NOT NULL DEFAULT 'ETB' REFERENCES core.currencies(code),
  paid_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  payment_method     TEXT,
  payout_reference   TEXT,
  payout_receipt_key TEXT,
  idempotency_key    TEXT NOT NULL UNIQUE,
  notes              TEXT,
  created_by         UUID REFERENCES iam.users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_settlement_payments_stl
  ON marketplace.settlement_payments (settlement_id, paid_at DESC);

-- ——— Financial adjustments ———
CREATE TABLE IF NOT EXISTS marketplace.financial_adjustments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_number  TEXT NOT NULL UNIQUE,
  vendor_id          UUID NOT NULL REFERENCES marketplace.vendors(id),
  settlement_id      UUID REFERENCES marketplace.settlements(id),
  commission_entry_id UUID REFERENCES marketplace.commission_entries(id),
  adjustment_type    TEXT NOT NULL
                     CHECK (adjustment_type IN (
                       'commission_discount','commission_credit','settlement_correction',
                       'vendor_bonus','vendor_deduction','refund_related','accounting_correction'
                     )),
  original_amount    NUMERIC(18,2),
  adjustment_amount  NUMERIC(18,2) NOT NULL,
  currency           CHAR(3) NOT NULL DEFAULT 'ETB' REFERENCES core.currencies(code),
  reason             TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','void')),
  created_by         UUID REFERENCES iam.users(id),
  approved_by        UUID REFERENCES iam.users(id),
  approved_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_financial_adj_vendor
  ON marketplace.financial_adjustments (vendor_id, created_at DESC);

-- ——— Audit log ———
CREATE TABLE IF NOT EXISTS marketplace.commission_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  action        TEXT NOT NULL,
  actor_id      UUID REFERENCES iam.users(id),
  before_json   JSONB,
  after_json    JSONB,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_commission_audit_entity
  ON marketplace.commission_audit_log (entity_type, entity_id, created_at DESC);

-- ——— Receipt send log (WhatsApp / copy) ———
CREATE TABLE IF NOT EXISTS marketplace.settlement_receipt_sends (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id   UUID NOT NULL REFERENCES marketplace.settlements(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL CHECK (channel IN ('whatsapp','copy','email')),
  destination     TEXT,
  status          TEXT NOT NULL DEFAULT 'sent',
  provider_ref    TEXT,
  created_by      UUID REFERENCES iam.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Permissions
INSERT INTO iam.permissions (code, module, description) VALUES
  ('marketplace.commissions.write', 'marketplace', 'Create and edit commission rules and adjustments'),
  ('marketplace.adjustments.write', 'marketplace', 'Approve financial adjustments')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code IN ('et_operations_admin', 'super_admin')
  AND p.code IN ('marketplace.commissions.write', 'marketplace.adjustments.write')
ON CONFLICT DO NOTHING;
