-- MIGRATION 032 - order delivery location snapshot (map pin + landmark)

ALTER TABLE sales.orders
  ADD COLUMN IF NOT EXISTS landmark_name TEXT,
  ADD COLUMN IF NOT EXISTS landmark_place_id TEXT,
  ADD COLUMN IF NOT EXISTS landmark_location GEOGRAPHY(Point, 4326),
  ADD COLUMN IF NOT EXISTS formatted_address TEXT,
  ADD COLUMN IF NOT EXISTS delivery_instructions TEXT,
  ADD COLUMN IF NOT EXISTS location_type TEXT
    CHECK (location_type IS NULL OR location_type IN ('exact', 'landmark_nearby')),
  ADD COLUMN IF NOT EXISTS location_source TEXT
    CHECK (
      location_source IS NULL
      OR location_source IN ('gps', 'search', 'manual_pin', 'admin', 'assisted')
    ),
  ADD COLUMN IF NOT EXISTS location_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS landmark_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS landmark_lat DOUBLE PRECISION;

COMMENT ON COLUMN sales.orders.ship_location IS
  'Confirmed delivery destination point (PostGIS). Snapshot at checkout.';
COMMENT ON COLUMN sales.orders.landmark_name IS
  'Nearby recognizable landmark used as a navigation reference (not always the drop-off).';
COMMENT ON COLUMN sales.orders.location_type IS
  'exact = pin is the destination; landmark_nearby = landmark is a reference near the destination.';

ALTER TABLE delivery.deliveries
  ADD COLUMN IF NOT EXISTS landmark_name TEXT,
  ADD COLUMN IF NOT EXISTS landmark_place_id TEXT,
  ADD COLUMN IF NOT EXISTS location_type TEXT
    CHECK (location_type IS NULL OR location_type IN ('exact', 'landmark_nearby')),
  ADD COLUMN IF NOT EXISTS google_maps_url TEXT;

-- Seed common Addis landmarks for checkout quick-pick (no Google Places key required)
CREATE TABLE IF NOT EXISTS delivery.landmarks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  area          TEXT NOT NULL,
  city          TEXT NOT NULL DEFAULT 'Addis Ababa',
  place_id      TEXT UNIQUE,
  location      GEOGRAPHY(Point, 4326) NOT NULL,
  category      TEXT NOT NULL DEFAULT 'other'
                CHECK (category IN (
                  'bank','hotel','mall','hospital','business','landmark','other'
                )),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_landmarks_area ON delivery.landmarks (city, area)
  WHERE is_active;

INSERT INTO delivery.landmarks (name, area, city, place_id, location, category, sort_order)
SELECT v.name, v.area, 'Addis Ababa', v.place_id,
       ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326)::geography,
       v.category, v.sort_order
FROM (VALUES
  ('Commercial Bank of Ethiopia — Bole Branch', 'Bole', 'cbe-bole', 38.7895, 8.9942, 'bank', 10),
  ('Edna Mall', 'Bole', 'edna-mall', 38.7890, 8.9975, 'mall', 20),
  ('Bole International Airport', 'Bole', 'add-airport', 38.7993, 8.9779, 'landmark', 30),
  ('Friendship City Center', 'Kazanchis', 'friendship-cc', 38.7685, 9.0165, 'mall', 40),
  ('Hilton Addis Ababa', 'Kazanchis', 'hilton-addis', 38.7632, 9.0178, 'hotel', 50),
  ('Meskel Square', 'Kirkos', 'meskel-square', 38.7614, 9.0106, 'landmark', 60),
  ('Mexico Square', 'Kirkos', 'mexico-square', 38.7447, 9.0104, 'landmark', 70),
  ('Piazza (St. George Cathedral area)', 'Arada', 'piazza', 38.7490, 9.0365, 'landmark', 80),
  ('Merkato', 'Addis Ketema', 'merkato', 38.7360, 9.0305, 'landmark', 90),
  ('CMC / Civil Service University area', 'CMC', 'cmc-area', 38.8300, 9.0200, 'landmark', 100),
  ('Megenagna', 'Yeka', 'megenagna', 38.8025, 9.0210, 'landmark', 110),
  ('Sarbet / Sar Bet', 'Nifas Silk', 'sarbet', 38.7400, 8.9800, 'landmark', 120),
  ('Ayat Mall', 'Ayat', 'ayat-mall', 38.8600, 9.0200, 'mall', 130),
  ('Black Lion Hospital', 'Lideta', 'black-lion', 38.7480, 9.0220, 'hospital', 140),
  ('National Palace (area)', 'Arada', 'national-palace', 38.7560, 9.0225, 'landmark', 150)
) AS v(name, area, place_id, lng, lat, category, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM delivery.landmarks LIMIT 1);
