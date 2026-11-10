-- MIGRATION 010 - purchase orders & goods receipt --------------------
CREATE TABLE procurement.purchase_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number         TEXT NOT NULL UNIQUE,
  supplier_id       UUID NOT NULL REFERENCES procurement.suppliers(id),
  region_id         UUID NOT NULL REFERENCES core.operating_regions(id),
  special_order_request_id UUID REFERENCES procurement.special_order_requests(id),  -- back-to-back PO
  destination_warehouse_id UUID REFERENCES inventory.warehouses(id),
  currency          CHAR(3) NOT NULL REFERENCES core.currencies(code),
  exchange_rate_to_etb NUMERIC(20,8) CHECK (exchange_rate_to_etb > 0),
  subtotal          NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_total         NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  grand_total       NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                      'draft','pending_approval','approved','sent','partially_received','received','closed','cancelled')),
  expected_date     DATE,
  created_by        UUID NOT NULL REFERENCES iam.users(id),
  approved_by       UUID REFERENCES iam.users(id),
  approved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (approved_by IS NULL OR approved_by <> created_by)   -- maker-checker
);
CREATE INDEX ix_po_supplier ON procurement.purchase_orders (supplier_id, created_at DESC);
CREATE INDEX ix_po_sor ON procurement.purchase_orders (special_order_request_id);
CREATE TABLE procurement.purchase_order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES procurement.purchase_orders(id) ON DELETE CASCADE,
  line_no         SMALLINT NOT NULL,
  variant_id      UUID REFERENCES catalog.product_variants(id),   -- NULL for special-order items
  description     TEXT NOT NULL,
  quantity        NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  qty_received    NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_cost       NUMERIC(18,2) NOT NULL CHECK (unit_cost >= 0),
  line_total      NUMERIC(18,2) NOT NULL CHECK (line_total >= 0),
  UNIQUE (purchase_order_id, line_no),
  CHECK (qty_received <= quantity)
);
CREATE TABLE procurement.goods_receipts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_number        TEXT NOT NULL UNIQUE,
  purchase_order_id UUID NOT NULL REFERENCES procurement.purchase_orders(id),
  warehouse_id      UUID NOT NULL REFERENCES inventory.warehouses(id),
  received_by       UUID NOT NULL REFERENCES iam.users(id),
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  note              TEXT
);
CREATE TABLE procurement.goods_receipt_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goods_receipt_id  UUID NOT NULL REFERENCES procurement.goods_receipts(id) ON DELETE CASCADE,
  po_item_id        UUID NOT NULL REFERENCES procurement.purchase_order_items(id),
  qty_received      NUMERIC(12,3) NOT NULL CHECK (qty_received > 0),
  qty_rejected      NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (qty_rejected >= 0),
  UNIQUE (goods_receipt_id, po_item_id)
);
-- Append-only stock ledger. Sum of qty_change per (warehouse, variant)
-- must equal stock_balances.qty_on_hand (nightly reconciliation job).
CREATE TABLE inventory.inventory_movements (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  warehouse_id    UUID NOT NULL REFERENCES inventory.warehouses(id),
  storage_location_id UUID REFERENCES inventory.storage_locations(id),
  variant_id      UUID NOT NULL REFERENCES catalog.product_variants(id),
  movement_type   TEXT NOT NULL CHECK (movement_type IN (
                    'purchase_receipt','sale_shipment','return_restock','return_damaged',
                    'transfer_out','transfer_in','adjustment_in','adjustment_out','opening_balance')),
  qty_change      INT NOT NULL CHECK (qty_change <> 0),
  unit_cost       NUMERIC(18,4),                 -- for valuation (moving average later)
  -- polymorphic source document; exactly one set
  order_item_id   UUID REFERENCES sales.order_items(id),
  goods_receipt_item_id UUID REFERENCES procurement.goods_receipt_items(id),
  transfer_item_id UUID REFERENCES inventory.stock_transfer_items(id),
  adjustment_id   UUID REFERENCES inventory.stock_adjustments(id),
  return_item_id  UUID REFERENCES sales.return_items(id),
  performed_by    UUID REFERENCES iam.users(id),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(order_item_id, goods_receipt_item_id, transfer_item_id, adjustment_id, return_item_id) <= 1)
);
CREATE INDEX ix_mov_wh_variant ON inventory.inventory_movements (warehouse_id, variant_id, occurred_at);
CREATE INDEX ix_mov_occurred ON inventory.inventory_movements USING BRIN (occurred_at);
