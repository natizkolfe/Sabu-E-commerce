-- MIGRATION 022 - Addis sellable warehouse + stock for demo catalog -------

INSERT INTO inventory.warehouses (
  region_id, code, name, warehouse_type, address_text, location, is_sellable, is_active
)
SELECT r.id, 'ADD-MAIN', 'Addis Main Warehouse', 'warehouse',
       'Bole, Addis Ababa',
       ST_SetSRID(ST_MakePoint(38.7890, 8.9806), 4326)::geography,
       true, true
FROM core.operating_regions r
WHERE r.code = 'ET'
  AND NOT EXISTS (SELECT 1 FROM inventory.warehouses w WHERE w.code = 'ADD-MAIN');

-- Give every active retail variant plenty of sellable stock
INSERT INTO inventory.stock_balances (warehouse_id, variant_id, qty_on_hand, qty_reserved, reorder_point, reorder_qty)
SELECT w.id, pv.id, 50, 0, 5, 20
FROM inventory.warehouses w
CROSS JOIN catalog.product_variants pv
JOIN catalog.products p ON p.id = pv.product_id
WHERE w.code = 'ADD-MAIN'
  AND pv.deleted_at IS NULL
  AND pv.is_active
  AND p.status = 'active'
  AND p.deleted_at IS NULL
ON CONFLICT (warehouse_id, variant_id) DO NOTHING;
