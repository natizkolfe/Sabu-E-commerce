-- MIGRATION 039 - AI white-background ecommerce enhance preset

-- Recreate transform_preset check to include white_background_ecommerce
ALTER TABLE studio.generation_jobs
  DROP CONSTRAINT IF EXISTS generation_jobs_transform_preset_check;

ALTER TABLE studio.generation_jobs
  ADD CONSTRAINT generation_jobs_transform_preset_check
  CHECK (
    transform_preset IS NULL
    OR transform_preset IN (
      'studio_packshot',
      'ghost_mannequin',
      'background_cleanup',
      'white_background_ecommerce'
    )
  );

-- Allow ai_enhance as product image source (originals stay 'upload')
ALTER TABLE catalog.product_images
  DROP CONSTRAINT IF EXISTS product_images_source_check;

ALTER TABLE catalog.product_images
  ADD CONSTRAINT product_images_source_check
  CHECK (source IN ('upload', 'studio_transform', 'seed', 'ai_enhance'));

ALTER TABLE studio.generation_jobs
  ADD COLUMN IF NOT EXISTS provider_job_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_meta JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN studio.generation_jobs.transform_preset IS
  'product_transform presets: white_background_ecommerce (primary), packshot/ghost/cleanup (legacy)';
