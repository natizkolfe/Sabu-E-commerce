-- MIGRATION 025 - AI studio schema (pluggable try-on) --------------------

CREATE SCHEMA IF NOT EXISTS studio;

CREATE TABLE studio.model_age_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  age_min_months INT NOT NULL CHECK (age_min_months >= 0),
  age_max_months INT NOT NULL CHECK (age_max_months >= age_min_months),
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE studio.virtual_models (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  age_group_id    UUID NOT NULL REFERENCES studio.model_age_groups(id),
  code            TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  gender_label    TEXT,
  license_note    TEXT NOT NULL DEFAULT 'Synthetic / licensed reference only',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE studio.model_images (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id      UUID NOT NULL REFERENCES studio.virtual_models(id) ON DELETE CASCADE,
  storage_key   TEXT NOT NULL,
  pose_label    TEXT,
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ux_studio_one_primary_model_image
  ON studio.model_images (model_id) WHERE is_primary;

CREATE TABLE studio.generation_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES catalog.products(id),
  variant_id      UUID REFERENCES catalog.product_variants(id),
  model_id        UUID NOT NULL REFERENCES studio.virtual_models(id),
  source_image_key TEXT NOT NULL,
  provider        TEXT NOT NULL DEFAULT 'mock',
  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  error_message   TEXT,
  requested_by    UUID REFERENCES iam.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE TABLE studio.generated_images (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES studio.generation_jobs(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES catalog.products(id),
  variant_id    UUID REFERENCES catalog.product_variants(id),
  storage_key   TEXT NOT NULL,
  is_ai_preview BOOLEAN NOT NULL DEFAULT true,
  review_status TEXT NOT NULL DEFAULT 'pending'
                CHECK (review_status IN ('pending','approved','rejected')),
  published     BOOLEAN NOT NULL DEFAULT false,
  reviewed_by   UUID REFERENCES iam.users(id),
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_studio_jobs_product ON studio.generation_jobs (product_id, created_at DESC);
CREATE INDEX ix_studio_gen_pending ON studio.generated_images (review_status)
  WHERE review_status = 'pending';

INSERT INTO studio.model_age_groups (code, label, age_min_months, age_max_months, sort_order) VALUES
  ('infant', '8–24 months', 8, 24, 10),
  ('toddler', '2–4 years', 24, 48, 20),
  ('kids', '5–8 years', 48, 96, 30),
  ('preteen', '9–12 years', 96, 144, 40)
ON CONFLICT (code) DO NOTHING;

INSERT INTO studio.virtual_models (age_group_id, code, display_name, gender_label, license_note)
SELECT g.id, v.code, v.display_name, v.gender_label, 'Synthetic demo model — not a real child'
FROM studio.model_age_groups g
JOIN (VALUES
  ('toddler', 'model-toddler-a', 'Demo Toddler A', 'unisex'),
  ('kids', 'model-kids-a', 'Demo Kids A', 'unisex'),
  ('preteen', 'model-preteen-a', 'Demo Preteen A', 'unisex')
) AS v(group_code, code, display_name, gender_label) ON v.group_code = g.code
ON CONFLICT (code) DO NOTHING;

-- Permissions for new modules
INSERT INTO iam.permissions (code, module, description) VALUES
  ('payments.verify', 'payments', 'Approve/reject manual bank transfers'),
  ('payments.read', 'payments', 'View payment transactions'),
  ('studio.generate', 'studio', 'Run AI try-on generation'),
  ('studio.publish', 'studio', 'Approve and publish AI previews')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code = 'super_admin'
  AND p.code IN ('payments.verify','payments.read','studio.generate','studio.publish')
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
JOIN iam.permissions p ON p.code IN ('payments.verify','payments.read')
WHERE r.code = 'finance_admin'
ON CONFLICT DO NOTHING;
