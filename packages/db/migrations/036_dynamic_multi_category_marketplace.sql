-- MIGRATION 036 - dynamic multi-category marketplace foundations
-- Merchandising fields, M:N product categories, flexible attributes, path normalize

-- ——— Category merchandising / SEO ———
ALTER TABLE catalog.categories
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS description_am TEXT,
  ADD COLUMN IF NOT EXISTS image_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS icon_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS featured_sort INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meta_title TEXT,
  ADD COLUMN IF NOT EXISTS meta_description TEXT;

CREATE INDEX IF NOT EXISTS ix_categories_featured
  ON catalog.categories (featured_sort, sort_order)
  WHERE is_featured AND is_active;

-- Normalize path to no leading slash (kids seed style)
UPDATE catalog.categories
SET path = regexp_replace(path, '^/+', '')
WHERE path LIKE '/%';

-- ——— Multi-category product assignment (primary still on products.category_id) ———
CREATE TABLE IF NOT EXISTS catalog.product_categories (
  product_id   UUID NOT NULL REFERENCES catalog.products(id) ON DELETE CASCADE,
  category_id  UUID NOT NULL REFERENCES catalog.categories(id) ON DELETE RESTRICT,
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, category_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_one_primary_category
  ON catalog.product_categories (product_id)
  WHERE is_primary;

CREATE INDEX IF NOT EXISTS ix_product_categories_category
  ON catalog.product_categories (category_id);

-- Backfill primary category rows from products.category_id
INSERT INTO catalog.product_categories (product_id, category_id, is_primary, sort_order)
SELECT p.id, p.category_id, true, 0
FROM catalog.products p
WHERE p.deleted_at IS NULL
ON CONFLICT (product_id, category_id) DO UPDATE
  SET is_primary = EXCLUDED.is_primary;

-- ——— Flexible attribute types ———
ALTER TABLE catalog.attributes
  ADD COLUMN IF NOT EXISTS data_type TEXT NOT NULL DEFAULT 'dropdown'
    CHECK (data_type IN (
      'text','number','dropdown','multi_select','boolean','color','measurement'
    )),
  ADD COLUMN IF NOT EXISTS unit TEXT,
  ADD COLUMN IF NOT EXISTS is_filterable BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_variant_level BOOLEAN NOT NULL DEFAULT true;

-- Extra common retail attributes (safe upsert)
INSERT INTO catalog.attributes (code, name, name_am, sort_order, data_type, is_filterable)
VALUES
  ('material', 'Material', 'ቁሳቁስ', 30, 'dropdown', true),
  ('gender', 'Gender', 'ጾታ', 40, 'dropdown', true),
  ('width_cm', 'Width (cm)', 'ስፋት (ሴሜ)', 50, 'measurement', true),
  ('height_cm', 'Height (cm)', 'ቁመት (ሴሜ)', 60, 'measurement', true),
  ('fabric', 'Fabric', 'ጨርቅ', 70, 'dropdown', true),
  ('warranty_months', 'Warranty (months)', 'ዋስትና (ወራት)', 80, 'number', true),
  ('skin_type', 'Skin type', 'የቆዳ አይነት', 90, 'dropdown', true),
  ('shade', 'Shade', 'ጥላ', 100, 'color', true)
ON CONFLICT (code) DO NOTHING;

-- Seed attribute values for new filters
INSERT INTO catalog.attribute_values (attribute_id, code, label, sort_order)
SELECT a.id, v.code, v.label, v.sort_order
FROM catalog.attributes a
JOIN (VALUES
  ('material','cotton','Cotton',10),
  ('material','polyester','Polyester',20),
  ('material','leather','Leather',30),
  ('material','canvas','Canvas',40),
  ('gender','men','Men',10),
  ('gender','women','Women',20),
  ('gender','unisex','Unisex',30),
  ('gender','boys','Boys',40),
  ('gender','girls','Girls',50),
  ('fabric','cotton','Cotton',10),
  ('fabric','linen','Linen',20),
  ('fabric','velvet','Velvet',30),
  ('skin_type','normal','Normal',10),
  ('skin_type','oily','Oily',20),
  ('skin_type','dry','Dry',30),
  ('skin_type','combination','Combination',40)
) AS v(attr_code, code, label, sort_order) ON v.attr_code = a.code
ON CONFLICT (attribute_id, code) DO NOTHING;

-- Wire apparel/home categories to attribute sets when those categories exist
INSERT INTO catalog.category_attribute_sets (category_id, attribute_id, is_required, sort_order)
SELECT c.id, a.id, (a.code IN ('color','size')), a.sort_order
FROM catalog.categories c
CROSS JOIN catalog.attributes a
WHERE c.slug IN (
  'mens-fashion','womens-fashion','kids','kids-boys','kids-girls','kids-baby',
  'kids-clothing','kids-shoes','home-living','beauty-cosmetics','electronics'
)
AND a.code IN ('color','size','material','gender','fabric','width_cm','height_cm','warranty_months','skin_type','shade')
ON CONFLICT DO NOTHING;

-- Ensure featured examples (non-destructive)
UPDATE catalog.categories
SET is_featured = true,
    featured_sort = CASE slug
      WHEN 'mens-fashion' THEN 10
      WHEN 'womens-fashion' THEN 20
      WHEN 'kids' THEN 30
      WHEN 'home-living' THEN 40
      WHEN 'electronics' THEN 50
      WHEN 'ethiopian-traditional' THEN 60
      ELSE featured_sort
    END
WHERE parent_id IS NULL
  AND slug IN (
    'mens-fashion','womens-fashion','kids','home-living','electronics','ethiopian-traditional'
  );
