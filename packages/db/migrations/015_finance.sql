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
