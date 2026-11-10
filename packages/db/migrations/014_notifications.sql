-- MIGRATION 014 - notifications --------------------------------------
CREATE TABLE notify.message_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_code      TEXT NOT NULL,                 -- 'order.confirmed'
  channel         TEXT NOT NULL CHECK (channel IN ('sms','whatsapp','email','push','in_app')),
  locale          TEXT NOT NULL,
  version         INT NOT NULL DEFAULT 1,
  subject         TEXT,
  body            TEXT NOT NULL,                 -- {{order_number}} placeholders
  provider_template_name TEXT,                   -- WhatsApp: Meta-approved template name
  provider_approval_status TEXT CHECK (provider_approval_status IN ('not_required','pending','approved','rejected')),
  category        TEXT NOT NULL CHECK (category IN ('transactional','marketing','security')),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_code, channel, locale, version)
);
CREATE TABLE notify.notification_providers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,            -- 'ethio_telecom_sms','afromessage','meta_cloud_api','fcm','ses'
  channel       TEXT NOT NULL CHECK (channel IN ('sms','whatsapp','email','push')),
  priority      SMALLINT NOT NULL DEFAULT 1,     -- failover order within channel
  integration_status TEXT NOT NULL DEFAULT 'unverified' CHECK (integration_status IN ('unverified','sandbox','live','disabled')),
  config        JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE notify.communication_preferences (
  user_id       UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL CHECK (channel IN ('sms','whatsapp','email','push','in_app')),
  category      TEXT NOT NULL CHECK (category IN ('transactional','marketing')),
  opted_in      BOOLEAN NOT NULL,
  consent_source TEXT,                           -- 'signup_checkbox','whatsapp_reply','admin'
  consented_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel, category)
);
CREATE TABLE notify.customer_segments (           -- target groups for broadcasts
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  rule          JSONB,                           -- dynamic filter; NULL = static list
  created_by    UUID REFERENCES iam.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE notify.customer_segment_members (
  segment_id    UUID NOT NULL REFERENCES notify.customer_segments(id) ON DELETE CASCADE,
  customer_id   UUID NOT NULL REFERENCES crm.customers(id) ON DELETE CASCADE,
  PRIMARY KEY (segment_id, customer_id)
);
CREATE TABLE notify.campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  segment_id    UUID REFERENCES notify.customer_segments(id),
  template_id   UUID NOT NULL REFERENCES notify.message_templates(id),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','cancelled')),
  scheduled_at  TIMESTAMPTZ,
  created_by    UUID NOT NULL REFERENCES iam.users(id),
  approved_by   UUID REFERENCES iam.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Logical notification (one event → one user). In-app feed reads this.
CREATE TABLE notify.notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  event_code    TEXT NOT NULL,
  campaign_id   UUID REFERENCES notify.campaigns(id),
  entity_type   TEXT,                            -- 'order','special_order_request'
  entity_id     UUID,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key    TEXT UNIQUE,                     -- e.g. 'order.confirmed:<order_id>'
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_notif_user ON notify.notifications (user_id, created_at DESC);
CREATE INDEX ix_notif_unread ON notify.notifications (user_id) WHERE read_at IS NULL;
-- Physical send attempts per channel (WhatsApp and SMS are separate rows).
CREATE TABLE notify.message_deliveries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id     UUID NOT NULL REFERENCES notify.notifications(id) ON DELETE CASCADE,
  channel             TEXT NOT NULL CHECK (channel IN ('sms','whatsapp','email','push')),
  provider_id         UUID REFERENCES notify.notification_providers(id),
  template_id         UUID REFERENCES notify.message_templates(id),
  destination_masked  TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                        'queued','sending','sent','delivered','read','failed','skipped_no_consent','fallback_triggered')),
  provider_message_id TEXT,
  attempt_count       SMALLINT NOT NULL DEFAULT 0,
  next_attempt_at     TIMESTAMPTZ,
  last_error          TEXT,
  cost                NUMERIC(10,4),
  sent_at             TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_msg_retry ON notify.message_deliveries (next_attempt_at) WHERE status IN ('queued','failed');
CREATE INDEX ix_msg_notif ON notify.message_deliveries (notification_id);
CREATE UNIQUE INDEX ux_msg_provider_id ON notify.message_deliveries (provider_id, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE TABLE notify.device_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
  token         TEXT NOT NULL UNIQUE,
  app           TEXT NOT NULL CHECK (app IN ('customer','driver')),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
