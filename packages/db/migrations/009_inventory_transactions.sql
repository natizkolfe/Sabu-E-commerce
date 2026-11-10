-- MIGRATION 009 - inventory transactions -----------------------------
CREATE TABLE inventory.stock_reservations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id   UUID NOT NULL,
  variant_id     UUID NOT NULL,
  order_item_id  UUID NOT NULL REFERENCES sales.order_items(id) ON DELETE CASCADE,
  quantity       INT NOT NULL CHECK (quantity > 0),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','fulfilled','released','expired')),
  expires_at     TIMESTAMPTZ NOT NULL,           -- unpaid orders release stock (e.g. 30 min)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (warehouse_id, variant_id) REFERENCES inventory.stock_balances(warehouse_id, variant_id)
);
CREATE INDEX ix_resv_expiry ON inventory.stock_reservations (expires_at) WHERE status = 'active';
CREATE INDEX ix_resv_item ON inventory.stock_reservations (order_item_id);
CREATE TABLE inventory.stock_transfers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number  TEXT NOT NULL UNIQUE,
  from_warehouse_id UUID NOT NULL REFERENCES inventory.warehouses(id),
  to_warehouse_id  UUID NOT NULL REFERENCES inventory.warehouses(id),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','in_transit','received','cancelled')),
  requested_by     UUID REFERENCES iam.users(id),
  approved_by      UUID REFERENCES iam.users(id),
  shipped_at       TIMESTAMPTZ,
  received_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_warehouse_id <> to_warehouse_id)
);
CREATE TABLE inventory.stock_transfer_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id   UUID NOT NULL REFERENCES inventory.stock_transfers(id) ON DELETE CASCADE,
  variant_id    UUID NOT NULL REFERENCES catalog.product_variants(id),
  qty_sent      INT NOT NULL CHECK (qty_sent > 0),
  qty_received  INT CHECK (qty_received >= 0),
  UNIQUE (transfer_id, variant_id)
);
CREATE TABLE inventory.stock_adjustments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id  UUID NOT NULL REFERENCES inventory.warehouses(id),
  reason        TEXT NOT NULL CHECK (reason IN ('cycle_count','damage','theft','expiry','correction','opening_balance')),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','posted','rejected')),
  note          TEXT,
  created_by    UUID NOT NULL REFERENCES iam.users(id),
  approved_by   UUID REFERENCES iam.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at     TIMESTAMPTZ
);
