-- MIGRATION 024 - attributes model + wholesale tier seed -----------------

CREATE TABLE IF NOT EXISTS catalog.attributes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_]+$'),
  name        TEXT NOT NULL,
  name_am     TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog.attribute_values (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attribute_id  UUID NOT NULL REFERENCES catalog.attributes(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  label         TEXT NOT NULL,
  label_am      TEXT,
  sort_order    INT NOT NULL DEFAULT 0,
  UNIQUE (attribute_id, code)
);

CREATE TABLE IF NOT EXISTS catalog.variant_attribute_values (
  variant_id          UUID NOT NULL REFERENCES catalog.product_variants(id) ON DELETE CASCADE,
  attribute_value_id  UUID NOT NULL REFERENCES catalog.attribute_values(id) ON DELETE RESTRICT,
  PRIMARY KEY (variant_id, attribute_value_id)
);

INSERT INTO catalog.attributes (code, name, name_am, sort_order) VALUES
  ('color', 'Color', 'ቀለም', 10),
  ('size', 'Size', 'መጠን', 20)
ON CONFLICT (code) DO NOTHING;

INSERT INTO pricing.price_lists (code, name, list_type, currency, prices_include_vat, priority)
VALUES ('WHOLESALE-ETB', 'Wholesale Ethiopia (ETB)', 'wholesale', 'ETB', false, 200)
ON CONFLICT (code) DO NOTHING;

-- Enable bulk on a few demo products and seed wholesale tiers (qty 10 / 50 / 100)
DO $$
DECLARE
  wl UUID;
  r RECORD;
  base NUMERIC(18,2);
BEGIN
  SELECT id INTO wl FROM pricing.price_lists WHERE code = 'WHOLESALE-ETB';

  UPDATE catalog.products
  SET bulk_purchasing_enabled = true
  WHERE slug IN (
    'boys-cotton-tee-pack','boys-chino-shorts','girls-floral-dress',
    'kids-canvas-sneakers','kids-backpack-mini'
  );

  FOR r IN
    SELECT pv.id AS variant_id, pli.unit_price
    FROM catalog.product_variants pv
    JOIN catalog.products p ON p.id = pv.product_id
    JOIN pricing.price_list_items pli ON pli.variant_id = pv.id AND pli.min_qty = 1
    JOIN pricing.price_lists pl ON pl.id = pli.price_list_id AND pl.code = 'RETAIL-ETB'
    WHERE p.bulk_purchasing_enabled
      AND pli.valid_during @> now()
  LOOP
    base := r.unit_price;
    -- 10+: ~8% off retail
    INSERT INTO pricing.price_list_items (price_list_id, variant_id, min_qty, unit_price, valid_during)
    SELECT wl, r.variant_id, 10, round(base * 0.92, 2), tstzrange(now() - interval '1 day', NULL)
    WHERE NOT EXISTS (
      SELECT 1 FROM pricing.price_list_items x
      WHERE x.price_list_id = wl AND x.variant_id = r.variant_id AND x.min_qty = 10
        AND x.valid_during @> now()
    );
    INSERT INTO pricing.price_list_items (price_list_id, variant_id, min_qty, unit_price, valid_during)
    SELECT wl, r.variant_id, 50, round(base * 0.85, 2), tstzrange(now() - interval '1 day', NULL)
    WHERE NOT EXISTS (
      SELECT 1 FROM pricing.price_list_items x
      WHERE x.price_list_id = wl AND x.variant_id = r.variant_id AND x.min_qty = 50
        AND x.valid_during @> now()
    );
    INSERT INTO pricing.price_list_items (price_list_id, variant_id, min_qty, unit_price, valid_during)
    SELECT wl, r.variant_id, 100, round(base * 0.78, 2), tstzrange(now() - interval '1 day', NULL)
    WHERE NOT EXISTS (
      SELECT 1 FROM pricing.price_list_items x
      WHERE x.price_list_id = wl AND x.variant_id = r.variant_id AND x.min_qty = 100
        AND x.valid_during @> now()
    );
  END LOOP;
END $$;
