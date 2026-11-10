-- MIGRATION 011 - international logistics ----------------------------
CREATE TABLE logistics.international_shipments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_number    TEXT NOT NULL UNIQUE,
  origin_region_id   UUID NOT NULL REFERENCES core.operating_regions(id),
  destination_region_id UUID NOT NULL REFERENCES core.operating_regions(id),
  transport_mode     TEXT NOT NULL CHECK (transport_mode IN ('air','sea','road','courier')),
  carrier_name       TEXT,                       -- freight forwarder: requires commercial agreement
  tracking_number    TEXT,
  airway_bill_no     TEXT,
  status             TEXT NOT NULL DEFAULT 'preparing' CHECK (status IN (
                       'preparing','booked','departed','in_transit','arrived_port',
                       'customs_clearance','cleared','delivered_to_hub','exception','cancelled')),
  freight_cost       NUMERIC(18,2) CHECK (freight_cost >= 0),
  freight_currency   CHAR(3) REFERENCES core.currencies(code),
  departed_at        TIMESTAMPTZ,
  eta                TIMESTAMPTZ,
  arrived_at         TIMESTAMPTZ,
  created_by         UUID REFERENCES iam.users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (origin_region_id <> destination_region_id)
);
-- A consolidated shipment can carry many special orders; an order may be split
-- across shipments → M:N bridge.
CREATE TABLE logistics.shipment_contents (
  shipment_id              UUID NOT NULL REFERENCES logistics.international_shipments(id) ON DELETE CASCADE,
  special_order_request_id UUID NOT NULL REFERENCES procurement.special_order_requests(id),
  package_count            SMALLINT NOT NULL DEFAULT 1 CHECK (package_count > 0),
  declared_value           NUMERIC(18,2) CHECK (declared_value >= 0),
  declared_currency        CHAR(3) REFERENCES core.currencies(code),
  gross_weight_kg          NUMERIC(10,3),
  PRIMARY KEY (shipment_id, special_order_request_id)
);
CREATE INDEX ix_ship_contents_sor ON logistics.shipment_contents (special_order_request_id);
CREATE TABLE logistics.shipment_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id   UUID NOT NULL REFERENCES logistics.international_shipments(id) ON DELETE CASCADE,
  status        TEXT NOT NULL,
  location_text TEXT,
  description   TEXT,
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','carrier_api')),
  occurred_at   TIMESTAMPTZ NOT NULL,
  recorded_by   UUID REFERENCES iam.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_ship_events ON logistics.shipment_events (shipment_id, occurred_at);
CREATE TABLE logistics.customs_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id     UUID NOT NULL REFERENCES logistics.international_shipments(id),
  declaration_no  TEXT,                          -- ECC customs declaration
  broker_name     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','assessed','paid','released','held')),
  duty_amount     NUMERIC(18,2) CHECK (duty_amount >= 0),
  vat_amount      NUMERIC(18,2) CHECK (vat_amount >= 0),
  excise_amount   NUMERIC(18,2) CHECK (excise_amount >= 0),
  other_charges   NUMERIC(18,2) CHECK (other_charges >= 0),
  currency        CHAR(3) NOT NULL DEFAULT 'ETB' REFERENCES core.currencies(code),
  submitted_at    TIMESTAMPTZ,
  released_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_customs_shipment ON logistics.customs_records (shipment_id);
