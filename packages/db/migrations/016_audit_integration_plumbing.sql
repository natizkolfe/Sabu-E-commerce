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
