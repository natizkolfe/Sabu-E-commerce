-- MIGRATION 006 - inventory (masters) --------------------------------
CREATE TABLE inventory.warehouses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id     UUID NOT NULL REFERENCES core.operating_regions(id),
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  warehouse_type TEXT NOT NULL CHECK (warehouse_type IN ('warehouse','store','consolidation_hub','transit')),
  address_text  TEXT,
  location      GEOGRAPHY(Point, 4326),
  is_sellable   BOOLEAN NOT NULL DEFAULT true,   -- Dubai hub stock is not sold locally
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE inventory.storage_locations (       -- bins / shelves inside a warehouse
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id  UUID NOT NULL REFERENCES inventory.warehouses(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,                   -- 'A-03-2'
  location_type TEXT NOT NULL DEFAULT 'pick' CHECK (location_type IN ('pick','bulk','quarantine','damaged','returns')),
  UNIQUE (warehouse_id, code)
);
-- One row per warehouse × variant. Updated ONLY together with an
-- inventory_movements insert, inside one transaction, using
-- SELECT ... FOR UPDATE or a conditional UPDATE (see doc §Concurrency).
CREATE TABLE inventory.stock_balances (
  warehouse_id      UUID NOT NULL REFERENCES inventory.warehouses(id),
  variant_id        UUID NOT NULL REFERENCES catalog.product_variants(id),
  qty_on_hand       INT NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
  qty_reserved      INT NOT NULL DEFAULT 0 CHECK (qty_reserved >= 0),
  qty_damaged       INT NOT NULL DEFAULT 0 CHECK (qty_damaged >= 0),
  reorder_point     INT CHECK (reorder_point >= 0),
  reorder_qty       INT CHECK (reorder_qty > 0),
  version           BIGINT NOT NULL DEFAULT 0,   -- optimistic-lock counter
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, variant_id),
  CHECK (qty_reserved <= qty_on_hand)
);
CREATE INDEX ix_stock_variant ON inventory.stock_balances (variant_id);
CREATE INDEX ix_stock_low ON inventory.stock_balances (warehouse_id)
  WHERE reorder_point IS NOT NULL AND qty_on_hand - qty_reserved <= reorder_point;
