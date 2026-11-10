-- MIGRATION 021 - synthetic kids retail catalog (dev/demo) ---------------
-- Categories, brands, products, variants, and RETAIL-ETB prices.

INSERT INTO pricing.price_lists (code, name, list_type, currency, prices_include_vat, priority)
VALUES ('RETAIL-ETB', 'Retail Ethiopia (ETB, VAT-inclusive)', 'retail', 'ETB', true, 100)
ON CONFLICT (code) DO NOTHING;

INSERT INTO catalog.brands (slug, name) VALUES
  ('little-addis', 'Little Addis'),
  ('tiny-trek', 'Tiny Trek'),
  ('softnest', 'SoftNest'),
  ('playday-et', 'PlayDay ET')
ON CONFLICT (slug) DO NOTHING;

-- Root + children categories
INSERT INTO catalog.categories (slug, name, name_am, path, sort_order)
VALUES
  ('kids', 'Kids', 'ልጆች', 'kids', 10),
  ('kids-clothing', 'Kids clothing', 'የልጆች ልብስ', 'kids/clothing', 20),
  ('kids-boys', 'Boys', 'ወንዶች', 'kids/clothing/boys', 21),
  ('kids-girls', 'Girls', 'ሴቶች', 'kids/clothing/girls', 22),
  ('kids-baby', 'Baby', 'ህፃናት', 'kids/clothing/baby', 23),
  ('kids-shoes', 'Kids shoes', 'ጫማዎች', 'kids/shoes', 30),
  ('kids-accessories', 'Accessories', 'ተጨማሪዎች', 'kids/accessories', 40),
  ('kids-items', 'Kids items & toys', 'መጫወቻዎች', 'kids/items', 50)
ON CONFLICT (slug) DO NOTHING;

UPDATE catalog.categories c
SET parent_id = p.id
FROM catalog.categories p
WHERE (c.slug, p.slug) IN (
  ('kids-clothing', 'kids'),
  ('kids-boys', 'kids-clothing'),
  ('kids-girls', 'kids-clothing'),
  ('kids-baby', 'kids-clothing'),
  ('kids-shoes', 'kids'),
  ('kids-accessories', 'kids'),
  ('kids-items', 'kids')
)
AND c.parent_id IS NULL;

-- Helper: insert product if slug missing
WITH brand AS (
  SELECT slug, id FROM catalog.brands
),
cat AS (
  SELECT slug, id FROM catalog.categories
),
ins AS (
  INSERT INTO catalog.products (
    category_id, brand_id, slug, name, name_am, description, specifications, sales_channel, status
  )
  SELECT c.id, b.id, v.slug, v.name, v.name_am, v.description, v.specs::jsonb, 'retail', 'active'
  FROM (VALUES
    ('kids-boys', 'little-addis', 'boys-cotton-tee-pack', 'Boys cotton tee (2-pack)', 'የወንዶች ጥጥ ቲሸርት',
     'Soft everyday cotton tees for school and play. Ages 4–10.',
     '{"age_range":"4-10","material":"cotton","pack_size":2,"gender":"boys"}'),
    ('kids-boys', 'tiny-trek', 'boys-chino-shorts', 'Boys chino shorts', 'የወንዶች ቁምጣ',
     'Light chino shorts with elastic waist. Great for Addis heat.',
     '{"age_range":"5-12","material":"cotton blend","gender":"boys"}'),
    ('kids-boys', 'little-addis', 'boys-hoodie-fleece', 'Boys fleece hoodie', 'የወንዶች ሁዲ',
     'Warm fleece hoodie for cool mornings and highland evenings.',
     '{"age_range":"6-14","material":"fleece","gender":"boys"}'),
    ('kids-girls', 'softnest', 'girls-floral-dress', 'Girls floral day dress', 'የሴቶች ቀሚስ',
     'Breathable floral dress with soft lining. Party or Sunday wear.',
     '{"age_range":"3-9","material":"cotton","gender":"girls"}'),
    ('kids-girls', 'little-addis', 'girls-legging-set', 'Girls legging set', 'የሴቶች ሌጊንግ',
     'Matching top + leggings set. Stretchy and wash-friendly.',
     '{"age_range":"2-8","material":"cotton elastane","pack_size":1,"gender":"girls"}'),
    ('kids-girls', 'tiny-trek', 'girls-denim-jacket', 'Girls denim jacket', 'የሴቶች ጃኬት',
     'Light denim jacket for layering over dresses and tees.',
     '{"age_range":"5-12","material":"denim","gender":"girls"}'),
    ('kids-baby', 'softnest', 'baby-romper-organic', 'Baby organic romper', 'የህፃን ሮምፐር',
     'Organic cotton romper with easy snaps. Newborn to 18 months.',
     '{"age_range":"0-18m","material":"organic cotton","gender":"unisex"}'),
    ('kids-baby', 'softnest', 'baby-sleepsuit-2pk', 'Baby sleepsuit 2-pack', 'የእንቅልፍ ልብስ',
     'Gentle sleepsuits for overnight comfort.',
     '{"age_range":"0-12m","material":"cotton","pack_size":2,"gender":"unisex"}'),
    ('kids-shoes', 'tiny-trek', 'kids-canvas-sneakers', 'Kids canvas sneakers', 'ጫማ ካንቫስ',
     'Everyday canvas sneakers with non-slip sole.',
     '{"age_range":"3-12","material":"canvas","type":"sneakers"}'),
    ('kids-shoes', 'playday-et', 'kids-school-sandals', 'School sandals', 'የትምህርት ቤት ሳንዳል',
     'Durable open sandals for school runs.',
     '{"age_range":"4-14","material":"synthetic","type":"sandals"}'),
    ('kids-accessories', 'little-addis', 'kids-cotton-cap', 'Kids cotton cap', 'ካፕ',
     'Sun cap with adjustable strap.',
     '{"age_range":"3-10","type":"hat"}'),
    ('kids-accessories', 'softnest', 'kids-backpack-mini', 'Mini school backpack', 'ቦርሳ',
     'Lightweight backpack for books and lunch.',
     '{"age_range":"5-12","type":"bag","capacity_l":12}'),
    ('kids-items', 'playday-et', 'wooden-stacking-rings', 'Wooden stacking rings', 'የእንጨት ጨዋታ',
     'Classic stacking toy. Smooth edges, natural finish.',
     '{"age_range":"1-4","type":"toy","material":"wood"}'),
    ('kids-items', 'playday-et', 'kids-storybook-amharic', 'Amharic storybook set', 'የአማርኛ ታሪክ መጽሐፍ',
     'Three short illustrated stories in Amharic for early readers.',
     '{"age_range":"3-8","type":"book","language":"am","pack_size":3}'),
    ('kids-items', 'tiny-trek', 'kids-water-bottle', 'Kids water bottle 500ml', 'የውሃ ጠርሙስ',
     'Leak-resistant bottle for school and outings.',
     '{"age_range":"4-12","type":"bottle","capacity_ml":500}')
  ) AS v(cat_slug, brand_slug, slug, name, name_am, description, specs)
  JOIN cat c ON c.slug = v.cat_slug
  JOIN brand b ON b.slug = v.brand_slug
  WHERE NOT EXISTS (
    SELECT 1 FROM catalog.products p WHERE p.slug = v.slug AND p.deleted_at IS NULL
  )
  RETURNING id, slug
)
SELECT count(*) AS products_inserted FROM ins;

-- Variants (sizes / colors) + prices
DO $$
DECLARE
  retail_id UUID;
  r RECORD;
  vid UUID;
  sizes TEXT[];
  colors TEXT[];
  s TEXT;
  col TEXT;
  v_sku TEXT;
  price NUMERIC(18,2);
  compare NUMERIC(18,2);
BEGIN
  SELECT id INTO retail_id FROM pricing.price_lists WHERE code = 'RETAIL-ETB';

  FOR r IN
    SELECT p.id, p.slug, p.specifications
    FROM catalog.products p
    WHERE p.slug IN (
      'boys-cotton-tee-pack','boys-chino-shorts','boys-hoodie-fleece',
      'girls-floral-dress','girls-legging-set','girls-denim-jacket',
      'baby-romper-organic','baby-sleepsuit-2pk',
      'kids-canvas-sneakers','kids-school-sandals',
      'kids-cotton-cap','kids-backpack-mini',
      'wooden-stacking-rings','kids-storybook-amharic','kids-water-bottle'
    )
  LOOP
    -- default size/color matrices by product family
    IF r.slug LIKE 'baby-%' THEN
      sizes := ARRAY['0-3M','3-6M','6-12M','12-18M'];
      colors := ARRAY['cream','sky'];
    ELSIF r.slug LIKE 'kids-canvas%' OR r.slug LIKE 'kids-school%' THEN
      sizes := ARRAY['28','30','32','34','36'];
      colors := ARRAY['navy','white'];
    ELSIF r.slug IN ('kids-cotton-cap','kids-backpack-mini','wooden-stacking-rings','kids-storybook-amharic','kids-water-bottle') THEN
      sizes := ARRAY['one-size'];
      colors := ARRAY['default'];
    ELSIF r.slug LIKE 'girls-%' THEN
      sizes := ARRAY['3Y','4Y','6Y','8Y','10Y'];
      colors := ARRAY['rose','lilac','white'];
    ELSE
      sizes := ARRAY['4Y','6Y','8Y','10Y','12Y'];
      colors := ARRAY['navy','olive','grey'];
    END IF;

    price := CASE r.slug
      WHEN 'boys-cotton-tee-pack' THEN 899.00
      WHEN 'boys-chino-shorts' THEN 1199.00
      WHEN 'boys-hoodie-fleece' THEN 1899.00
      WHEN 'girls-floral-dress' THEN 1499.00
      WHEN 'girls-legging-set' THEN 1299.00
      WHEN 'girls-denim-jacket' THEN 2199.00
      WHEN 'baby-romper-organic' THEN 999.00
      WHEN 'baby-sleepsuit-2pk' THEN 1099.00
      WHEN 'kids-canvas-sneakers' THEN 1599.00
      WHEN 'kids-school-sandals' THEN 999.00
      WHEN 'kids-cotton-cap' THEN 399.00
      WHEN 'kids-backpack-mini' THEN 1299.00
      WHEN 'wooden-stacking-rings' THEN 799.00
      WHEN 'kids-storybook-amharic' THEN 649.00
      WHEN 'kids-water-bottle' THEN 449.00
      ELSE 999.00
    END;
    compare := round(price * 1.15, 2);

    FOREACH s IN ARRAY sizes LOOP
      FOREACH col IN ARRAY colors LOOP
        v_sku := upper(replace(r.slug, '-', '')) || '-' || upper(s) || '-' || upper(left(col, 3));
        IF NOT EXISTS (
          SELECT 1 FROM catalog.product_variants pv
          WHERE pv.sku = v_sku AND pv.deleted_at IS NULL
        ) THEN
          INSERT INTO catalog.product_variants (
            product_id, sku, variant_name, options, unit_of_measure, weight_kg
          ) VALUES (
            r.id,
            v_sku,
            CASE WHEN s = 'one-size' AND col = 'default' THEN 'Standard'
                 ELSE s || ' / ' || initcap(col) END,
            jsonb_build_object('size', s, 'color', col),
            'piece',
            0.25
          )
          RETURNING id INTO vid;

          INSERT INTO catalog.product_images (product_id, variant_id, storage_key, alt_text, sort_order, is_primary)
          SELECT r.id, NULL, 'demo/kids/' || r.slug || '.jpg', r.slug, 0, true
          WHERE NOT EXISTS (
            SELECT 1 FROM catalog.product_images pi WHERE pi.product_id = r.id AND pi.is_primary
          );

          INSERT INTO pricing.price_list_items (
            price_list_id, variant_id, min_qty, unit_price, compare_at_price, valid_during
          ) VALUES (
            retail_id, vid, 1, price, compare, tstzrange(now() - interval '1 day', NULL)
          );
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;
