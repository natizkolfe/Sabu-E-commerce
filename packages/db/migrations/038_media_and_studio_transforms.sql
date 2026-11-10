-- MIGRATION 038 - media keys + AI product image transforms (packshot / ghost mannequin)

-- Allow studio jobs that are product-photo transforms (no virtual model required)
ALTER TABLE studio.generation_jobs
  ALTER COLUMN model_id DROP NOT NULL;

ALTER TABLE studio.generation_jobs
  ADD COLUMN IF NOT EXISTS job_type TEXT NOT NULL DEFAULT 'try_on'
    CHECK (job_type IN ('try_on', 'product_transform')),
  ADD COLUMN IF NOT EXISTS transform_preset TEXT
    CHECK (
      transform_preset IS NULL
      OR transform_preset IN (
        'studio_packshot',
        'ghost_mannequin',
        'background_cleanup'
      )
    );

COMMENT ON COLUMN studio.generation_jobs.job_type IS
  'try_on = virtual model wearing garment; product_transform = phone photo → studio quality';

COMMENT ON COLUMN studio.generation_jobs.transform_preset IS
  'Preset for product_transform jobs (packshot / ghost mannequin / cleanup)';

-- Soft metadata for product images (optional caption already via alt_text)
ALTER TABLE catalog.product_images
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'upload'
    CHECK (source IN ('upload', 'studio_transform', 'seed'));
