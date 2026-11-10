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
