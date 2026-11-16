-- MIGRATION 047 — admin driver vehicle type (motorcycle or car)

ALTER TABLE delivery.drivers
  ADD COLUMN IF NOT EXISTS vehicle_type TEXT;

DO $$
BEGIN
  ALTER TABLE delivery.drivers
    ADD CONSTRAINT drivers_vehicle_type_check
    CHECK (vehicle_type IS NULL OR vehicle_type IN ('motorcycle', 'car'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN delivery.drivers.vehicle_type IS
  'Admin-set vehicle the driver uses for Sabu deliveries: motorcycle or car.';
