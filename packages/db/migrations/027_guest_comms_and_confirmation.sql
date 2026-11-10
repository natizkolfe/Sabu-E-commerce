-- MIGRATION 027 - guest communication prefs, notification logs, contact attempts

-- Order-level preferred channel (works for guests without iam.users)
ALTER TABLE sales.orders
  ADD COLUMN IF NOT EXISTS preferred_contact_channel TEXT
    CHECK (
      preferred_contact_channel IS NULL
      OR preferred_contact_channel IN ('whatsapp', 'telegram', 'viber', 'phone', 'sms')
    ),
  ADD COLUMN IF NOT EXISTS requires_manual_contact BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contact_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS estimated_delivery_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ix_orders_manual_contact
  ON sales.orders (requires_manual_contact)
  WHERE requires_manual_contact = true;

ALTER TABLE crm.customers
  ADD COLUMN IF NOT EXISTS preferred_contact_channel TEXT
    CHECK (
      preferred_contact_channel IS NULL
      OR preferred_contact_channel IN ('whatsapp', 'telegram', 'viber', 'phone', 'sms')
    );

-- Durable per-order notification attempts (guests included; no user_id required)
CREATE TABLE IF NOT EXISTS notify.order_notification_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES sales.orders(id) ON DELETE CASCADE,
  event_code          TEXT NOT NULL,
  channel             TEXT NOT NULL CHECK (channel IN (
                        'whatsapp', 'telegram', 'viber', 'phone', 'sms', 'email'
                      )),
  destination_masked  TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                        'queued', 'sending', 'sent', 'delivered', 'failed',
                        'skipped_no_consent', 'skipped_manual', 'stubbed'
                      )),
  provider            TEXT,
  provider_message_id TEXT,
  message_preview     TEXT,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error          TEXT,
  attempt_count       SMALLINT NOT NULL DEFAULT 0,
  outbox_event_id     BIGINT REFERENCES core.outbox_events(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_order_notif_order
  ON notify.order_notification_logs (order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_order_notif_status
  ON notify.order_notification_logs (status)
  WHERE status IN ('queued', 'failed');

-- Admin manual contact history (phone calls, etc.)
CREATE TABLE IF NOT EXISTS notify.customer_contact_attempts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES sales.orders(id) ON DELETE CASCADE,
  attempted_by  UUID REFERENCES iam.users(id),
  channel       TEXT NOT NULL CHECK (channel IN (
                  'phone', 'sms', 'whatsapp', 'telegram', 'viber', 'email', 'other'
                )),
  outcome       TEXT NOT NULL CHECK (outcome IN (
                  'reached', 'no_answer', 'voicemail', 'wrong_number',
                  'callback_requested', 'declined', 'other'
                )),
  notes         TEXT,
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_contact_attempts_order
  ON notify.customer_contact_attempts (order_id, attempted_at DESC);

COMMENT ON COLUMN sales.orders.preferred_contact_channel IS
  'Customer preferred update channel captured at checkout (guest-safe).';
COMMENT ON COLUMN sales.orders.requires_manual_contact IS
  'True when preferred channel is phone/SMS-only or messaging send cannot run — admin must call.';
COMMENT ON TABLE notify.order_notification_logs IS
  'Per-order notification attempts for guests and accounts; written by notify outbox worker.';
COMMENT ON TABLE notify.customer_contact_attempts IS
  'Admin-recorded manual contact attempts (calls, SMS, messaging).';
