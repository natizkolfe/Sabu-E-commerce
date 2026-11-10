-- MIGRATION 004 - catalog --------------------------------------------
CREATE TABLE catalog.categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id     UUID REFERENCES catalog.categories(id) ON DELETE RESTRICT,
  slug          TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  name          TEXT NOT NULL,
  name_am       TEXT,                            -- Amharic display name
  path          TEXT NOT NULL,                   -- materialized path 'electronics/phones'
  sort_order    INT NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX ix_categories_parent ON catalog.categories (parent_id);
CREATE INDEX ix_categories_path ON catalog.categories (path text_pattern_ops);
CREATE TABLE catalog.brands (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  logo_key      TEXT,                            -- object-storage key
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE catalog.products (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id      UUID NOT NULL REFERENCES catalog.categories(id),
  brand_id         UUID REFERENCES catalog.brands(id),
  slug             TEXT NOT NULL,
  name             TEXT NOT NULL,
  name_am          TEXT,
  description      TEXT,
  specifications   JSONB NOT NULL DEFAULT '{}'::jsonb,  -- flexible spec sheet; filterable attrs below
  sales_channel    TEXT NOT NULL DEFAULT 'both' CHECK (sales_channel IN ('retail','wholesale','both')),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','inactive','archived')),
  tax_category     TEXT NOT NULL DEFAULT 'standard',
  created_by       UUID REFERENCES iam.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_products_slug ON catalog.products (slug) WHERE deleted_at IS NULL;
CREATE INDEX ix_products_category ON catalog.products (category_id) WHERE status = 'active';
CREATE INDEX ix_products_brand ON catalog.products (brand_id);
CREATE INDEX ix_products_name_trgm ON catalog.products USING GIN (name gin_trgm_ops);
CREATE INDEX ix_products_specs ON catalog.products USING GIN (specifications jsonb_path_ops);
-- The sellable unit. Every order line, stock balance and price points here.
CREATE TABLE catalog.product_variants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID NOT NULL REFERENCES catalog.products(id) ON DELETE RESTRICT,
  sku              TEXT NOT NULL,
  barcode          TEXT,
  variant_name     TEXT,                         -- '128GB / Black'
  options          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {"color":"black","storage":"128GB"}
  unit_of_measure  TEXT NOT NULL DEFAULT 'piece',
  weight_kg        NUMERIC(10,3) CHECK (weight_kg >= 0),
  volume_m3        NUMERIC(10,4) CHECK (volume_m3 >= 0),
  min_order_qty_wholesale INT NOT NULL DEFAULT 1 CHECK (min_order_qty_wholesale >= 1),
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_variants_sku ON catalog.product_variants (sku) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_variants_barcode ON catalog.product_variants (barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_variants_product ON catalog.product_variants (product_id);
CREATE TABLE catalog.product_images (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES catalog.products(id) ON DELETE CASCADE,
  variant_id    UUID REFERENCES catalog.product_variants(id) ON DELETE CASCADE,
  storage_key   TEXT NOT NULL,                   -- never store public URLs; resolve via CDN
  alt_text      TEXT,
  sort_order    INT NOT NULL DEFAULT 0,
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_one_primary_image ON catalog.product_images (product_id) WHERE is_primary;
