-- MIGRATION 007 - suppliers & special-order requests -----------------
CREATE TABLE procurement.suppliers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  supplier_type    TEXT NOT NULL CHECK (supplier_type IN ('local','international')),
  country_code     CHAR(2) NOT NULL,
  region_id        UUID REFERENCES core.operating_regions(id),
  contact_name     TEXT,
  contact_phone    TEXT,
  contact_email    CITEXT,
  tax_id           TEXT,
  default_currency CHAR(3) NOT NULL REFERENCES core.currencies(code),
  payment_terms_days SMALLINT NOT NULL DEFAULT 0,
  bank_details_enc BYTEA,                        -- app-encrypted
  rating           SMALLINT CHECK (rating BETWEEN 1 AND 5),
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
-- Customer asks for something not in the catalogue (Dubai sourcing).
CREATE TABLE procurement.special_order_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number    TEXT NOT NULL UNIQUE,        -- SR-2026-000045
  customer_id       UUID NOT NULL REFERENCES crm.customers(id),
  sourcing_region_id UUID NOT NULL REFERENCES core.operating_regions(id),  -- Dubai
  delivery_address_id UUID REFERENCES crm.customer_addresses(id),
  product_name      TEXT NOT NULL,
  description       TEXT,
  quantity          INT NOT NULL CHECK (quantity > 0),
  product_url       TEXT CHECK (product_url IS NULL OR product_url ~ '^https?://'),
  expected_specs    JSONB NOT NULL DEFAULT '{}'::jsonb,
  budget_amount     NUMERIC(18,2) CHECK (budget_amount > 0),
  budget_currency   CHAR(3) REFERENCES core.currencies(code),
  status            TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (
                      'submitted','under_review','sourcing','quotation_prepared',
                      'awaiting_customer_approval','awaiting_payment','payment_confirmed',
                      'purchasing','purchased','preparing_shipment','in_transit',
                      'customs_clearance','arrived_ethiopia','ready_for_delivery',
                      'out_for_delivery','delivered','rejected_by_customer',
                      'unavailable','cancelled','refunded')),
  assigned_to       UUID REFERENCES iam.users(id),   -- Dubai procurement admin
  supplier_id       UUID REFERENCES procurement.suppliers(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((budget_amount IS NULL) = (budget_currency IS NULL))
);
CREATE INDEX ix_sor_status ON procurement.special_order_requests (sourcing_region_id, status, created_at);
CREATE INDEX ix_sor_customer ON procurement.special_order_requests (customer_id, created_at DESC);
CREATE TABLE procurement.special_order_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID NOT NULL REFERENCES procurement.special_order_requests(id) ON DELETE CASCADE,
  storage_key   TEXT NOT NULL,
  mime_type     TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes    INT NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  scan_status   TEXT NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending','clean','infected')),
  uploaded_by   UUID NOT NULL REFERENCES iam.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE procurement.special_order_status_history (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id    UUID NOT NULL REFERENCES procurement.special_order_requests(id) ON DELETE CASCADE,
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  note          TEXT,
  is_customer_visible BOOLEAN NOT NULL DEFAULT true,
  changed_by    UUID REFERENCES iam.users(id),
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_sor_hist ON procurement.special_order_status_history (request_id, changed_at);
-- Threaded messages between customer and Dubai team on a request.
CREATE TABLE procurement.special_order_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID NOT NULL REFERENCES procurement.special_order_requests(id) ON DELETE CASCADE,
  author_id     UUID NOT NULL REFERENCES iam.users(id),
  body          TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  is_internal   BOOLEAN NOT NULL DEFAULT false,  -- staff-only note
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_sor_msgs ON procurement.special_order_messages (request_id, created_at);
