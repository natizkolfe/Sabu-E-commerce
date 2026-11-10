-- MIGRATION 030 - expand AI Studio virtual model options

INSERT INTO studio.model_age_groups (code, label, age_min_months, age_max_months, sort_order) VALUES
  ('infant', '8–24 months', 8, 24, 10),
  ('toddler', '2–4 years', 24, 48, 20),
  ('kids', '5–8 years', 48, 96, 30),
  ('preteen', '9–12 years', 96, 144, 40),
  ('teen', '13–16 years', 144, 192, 50)
ON CONFLICT (code) DO NOTHING;

INSERT INTO studio.virtual_models (age_group_id, code, display_name, gender_label, license_note)
SELECT g.id, v.code, v.display_name, v.gender_label, 'Synthetic demo model — not a real child'
FROM studio.model_age_groups g
JOIN (VALUES
  -- Infant
  ('infant',  'model-infant-boy',     'Infant Boy — soft pose',      'boy'),
  ('infant',  'model-infant-girl',    'Infant Girl — soft pose',     'girl'),
  -- Toddler
  ('toddler', 'model-toddler-a',      'Demo Toddler A',             'unisex'),
  ('toddler', 'model-toddler-boy',    'Toddler Boy — standing',     'boy'),
  ('toddler', 'model-toddler-girl',   'Toddler Girl — standing',    'girl'),
  -- Kids
  ('kids',    'model-kids-a',         'Demo Kids A',                'unisex'),
  ('kids',    'model-kids-boy',       'Kids Boy — casual',          'boy'),
  ('kids',    'model-kids-girl',      'Kids Girl — casual',         'girl'),
  ('kids',    'model-kids-sport',     'Kids Unisex — sport pose',   'unisex'),
  -- Preteen
  ('preteen', 'model-preteen-a',      'Demo Preteen A',             'unisex'),
  ('preteen', 'model-preteen-boy',    'Preteen Boy — school look',  'boy'),
  ('preteen', 'model-preteen-girl',   'Preteen Girl — school look', 'girl'),
  -- Teen (older kidswear)
  ('teen',    'model-teen-boy',       'Teen Boy — lifestyle',       'boy'),
  ('teen',    'model-teen-girl',      'Teen Girl — lifestyle',      'girl')
) AS v(group_code, code, display_name, gender_label) ON v.group_code = g.code
ON CONFLICT (code) DO UPDATE
SET display_name = EXCLUDED.display_name,
    gender_label = EXCLUDED.gender_label,
    is_active = true,
    updated_at = now();
