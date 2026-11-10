-- MIGRATION 037 - shared product retail number (style code)
-- One human-facing retail number per product; variants keep unique SKUs for stock.

ALTER TABLE catalog.products
  ADD COLUMN IF NOT EXISTS retail_number TEXT;

-- Backfill existing products from primary variant SKU base, or a stable fallback
UPDATE catalog.products p
SET retail_number = COALESCE(
  (
    SELECT regexp_replace(pv.sku, '-[A-Z0-9]+(-[A-Z0-9]+)?$', '')
    FROM catalog.product_variants pv
    WHERE pv.product_id = p.id AND pv.deleted_at IS NULL
    ORDER BY pv.created_at
    LIMIT 1
  ),
  'SABU-LEGACY-' || upper(substr(replace(p.id::text, '-', ''), 1, 8))
)
WHERE p.retail_number IS NULL;

-- Ensure uniqueness where present
CREATE UNIQUE INDEX IF NOT EXISTS ux_products_retail_number
  ON catalog.products (retail_number)
  WHERE retail_number IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN catalog.products.retail_number IS
  'Human retail/style number shared by all variants. Auto-generated SABU-YYYY-######. Not a barcode.';
