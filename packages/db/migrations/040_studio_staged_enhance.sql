-- MIGRATION 040 - stage AI enhance before assigning a product

ALTER TABLE studio.generation_jobs
  ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE studio.generated_images
  ALTER COLUMN product_id DROP NOT NULL;

COMMENT ON COLUMN studio.generation_jobs.product_id IS
  'Nullable for staged white-background enhance jobs; assigned when admin picks a product';
COMMENT ON COLUMN studio.generated_images.product_id IS
  'Nullable until staged enhance is attached to a catalog product';
