-- MIGRATION 013 - delivery & fleet -----------------------------------
CREATE TABLE delivery.delivery_zones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id      UUID NOT NULL REFERENCES core.operating_regions(id),
  name           TEXT NOT NULL,                  -- 'Bole', 'Addis - Zone A'
  boundary       GEOGRAPHY(MultiPolygon, 4326) NOT NULL,
  base_fee       NUMERIC(18,2) NOT NULL CHECK (base_fee >= 0),
  fee_per_km     NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (fee_per_km >= 0),
  free_over_amount NUMERIC(18,2),
  currency       CHAR(3) NOT NULL DEFAULT 'ETB' REFERENCES core.currencies(code),
  sla_hours      SMALLINT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_zone_geo ON delivery.delivery_zones USING GIST (boundary);
CREATE TABLE delivery.drivers (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL UNIQUE REFERENCES iam.users(id),
  driver_code            TEXT NOT NULL UNIQUE,   -- DRV-0042
  employment_type        TEXT NOT NULL CHECK (employment_type IN ('employee','contractor')),
  home_zone_id           UUID REFERENCES delivery.delivery_zones(id),
  region_id              UUID NOT NULL REFERENCES core.operating_regions(id),
  -- sensitive identity data: app-level envelope encryption + blind index
  license_number_enc     BYTEA NOT NULL,
  license_number_hash    BYTEA NOT NULL UNIQUE,
  license_class          TEXT,
  license_expiry         DATE NOT NULL,
  national_id_enc        BYTEA,
  national_id_hash       BYTEA UNIQUE,
  emergency_contact_enc  BYTEA,
  status                 TEXT NOT NULL DEFAULT 'pending_verification' CHECK (status IN (
                           'pending_verification','active','suspended','terminated')),
  availability           TEXT NOT NULL DEFAULT 'offline' CHECK (availability IN ('offline','available','on_delivery','on_break')),
  verified_by            UUID REFERENCES iam.users(id),
  verified_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_drivers_dispatch ON delivery.drivers (region_id, availability) WHERE status = 'active';
-- Separate from drivers: vehicles can be pooled/reassigned.
CREATE TABLE delivery.vehicles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number     TEXT NOT NULL UNIQUE,
  vehicle_type     TEXT NOT NULL CHECK (vehicle_type IN ('motorbike','car','van','pickup','truck','bajaj')),
  make_model       TEXT,
  capacity_kg      NUMERIC(10,2) CHECK (capacity_kg > 0),
  capacity_m3      NUMERIC(10,3) CHECK (capacity_m3 > 0),
  ownership        TEXT NOT NULL CHECK (ownership IN ('company','driver_owned')),
  insurance_expiry DATE,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE delivery.driver_vehicle_assignments (  -- history of who drives what
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id     UUID NOT NULL REFERENCES delivery.drivers(id),
  vehicle_id    UUID NOT NULL REFERENCES delivery.vehicles(id),
  active_during TSTZRANGE NOT NULL DEFAULT tstzrange(now(), NULL),
  EXCLUDE USING gist (vehicle_id WITH =, active_during WITH &&),
  EXCLUDE USING gist (driver_id WITH =, active_during WITH &&)
);
-- A delivery = one physical trip leg for (part of) an order.
-- Partial fulfilment ⇒ several deliveries per order.
CREATE TABLE delivery.deliveries (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_number    TEXT NOT NULL UNIQUE,
  order_id           UUID NOT NULL REFERENCES sales.orders(id),
  origin_warehouse_id UUID NOT NULL REFERENCES inventory.warehouses(id),
  zone_id            UUID REFERENCES delivery.delivery_zones(id),
  dropoff_location   GEOGRAPHY(Point, 4326) NOT NULL,
  dropoff_address_text TEXT NOT NULL,
  recipient_name     TEXT NOT NULL,
  recipient_phone    TEXT NOT NULL,
  distance_km        NUMERIC(8,2) CHECK (distance_km >= 0),
  status             TEXT NOT NULL DEFAULT 'pending_assignment' CHECK (status IN (
                       'pending_assignment','assigned','accepted','picked_up','in_transit',
                       'arrived','delivered','failed','returned_to_warehouse','cancelled')),
  cod_amount         NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (cod_amount >= 0),
  attempt_count      SMALLINT NOT NULL DEFAULT 0,
  scheduled_for      TIMESTAMPTZ,
  delivered_at       TIMESTAMPTZ,
  failure_reason     TEXT CHECK (failure_reason IN ('customer_unreachable','address_not_found','refused','payment_issue','vehicle_issue','other')),
  otp_hash           BYTEA,                      -- delivery OTP sent to customer
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_deliv_order ON delivery.deliveries (order_id);
CREATE INDEX ix_deliv_queue ON delivery.deliveries (zone_id, status) WHERE status IN ('pending_assignment','assigned');
CREATE TABLE delivery.delivery_items (            -- which order lines are on this trip
  delivery_id   UUID NOT NULL REFERENCES delivery.deliveries(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL REFERENCES sales.order_items(id),
  quantity      INT NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (delivery_id, order_item_id)
);
-- Full assignment history incl. rejections & reassignments.
CREATE TABLE delivery.driver_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id   UUID NOT NULL REFERENCES delivery.deliveries(id),
  driver_id     UUID NOT NULL REFERENCES delivery.drivers(id),
  vehicle_id    UUID REFERENCES delivery.vehicles(id),
  assigned_by   UUID REFERENCES iam.users(id),   -- NULL = auto-dispatch (future)
  assignment_method TEXT NOT NULL DEFAULT 'manual' CHECK (assignment_method IN ('manual','auto')),
  status        TEXT NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','accepted','rejected','expired','cancelled','completed')),
  reject_reason TEXT,
  offered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at  TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_one_live_assignment ON delivery.driver_assignments (delivery_id)
  WHERE status IN ('offered','accepted');
CREATE INDEX ix_assign_driver ON delivery.driver_assignments (driver_id, offered_at DESC);
CREATE TABLE delivery.delivery_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id   UUID NOT NULL REFERENCES delivery.deliveries(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,                   -- status change / note / call_attempt
  from_status   TEXT,
  to_status     TEXT,
  location      GEOGRAPHY(Point, 4326),
  note          TEXT,
  actor_id      UUID REFERENCES iam.users(id),
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_deliv_events ON delivery.delivery_events (delivery_id, occurred_at);
-- High-volume GPS pings. Partition by month in production (pg_partman);
-- retain raw pings ~90 days, keep only delivery_events long-term.
CREATE TABLE delivery.driver_location_pings (
  driver_id     UUID NOT NULL REFERENCES delivery.drivers(id),
  recorded_at   TIMESTAMPTZ NOT NULL,
  location      GEOGRAPHY(Point, 4326) NOT NULL,
  accuracy_m    REAL,
  speed_kmh     REAL,
  delivery_id   UUID REFERENCES delivery.deliveries(id),
  PRIMARY KEY (driver_id, recorded_at)
);
CREATE INDEX ix_pings_time ON delivery.driver_location_pings USING BRIN (recorded_at);
CREATE TABLE delivery.proof_of_delivery (
  delivery_id     UUID PRIMARY KEY REFERENCES delivery.deliveries(id),   -- 1:1
  method          TEXT NOT NULL CHECK (method IN ('otp','signature','photo','otp_and_photo')),
  otp_verified    BOOLEAN NOT NULL DEFAULT false,
  signature_key   TEXT,
  photo_key       TEXT,
  received_by_name TEXT,
  location        GEOGRAPHY(Point, 4326),
  cod_collected   NUMERIC(18,2) CHECK (cod_collected >= 0),
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (method NOT IN ('otp','otp_and_photo') OR otp_verified),
  CHECK (method <> 'signature' OR signature_key IS NOT NULL),
  CHECK (method NOT IN ('photo','otp_and_photo') OR photo_key IS NOT NULL)
);
CREATE TABLE delivery.delivery_feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES sales.orders(id),
  delivery_id   UUID REFERENCES delivery.deliveries(id),
  customer_id   UUID NOT NULL REFERENCES crm.customers(id),
  rating        SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, customer_id)
);
