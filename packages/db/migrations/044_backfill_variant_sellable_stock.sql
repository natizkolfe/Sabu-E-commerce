-- MIGRATION 044 — backfill ADD-MAIN stock for variants missing a balance
-- Admin-created variants previously had no inventory row, so checkout failed
-- with "Insufficient stock".

INSERT INTO inventory.stock_balances (
  warehouse_id, variant_id, qty_on_hand, qty_reserved, reorder_point, reorder_qty
)
SELECT w.id, pv.id, 50, 0, 5, 20
FROM inventory.warehouses w
CROSS JOIN catalog.product_variants pv
JOIN catalog.products p ON p.id = pv.product_id
WHERE w.code = 'ADD-MAIN'
  AND w.is_active
  AND w.is_sellable
  AND pv.deleted_at IS NULL
  AND pv.is_active
  AND p.deleted_at IS NULL
ON CONFLICT (warehouse_id, variant_id) DO NOTHING;
