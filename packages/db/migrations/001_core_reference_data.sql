-- MIGRATION 001 - core reference data --------------------------------
CREATE TABLE core.currencies (
  code          CHAR(3) PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  name          TEXT NOT NULL,
  minor_units   SMALLINT NOT NULL DEFAULT 2 CHECK (minor_units BETWEEN 0 AND 4),
  is_active     BOOLEAN NOT NULL DEFAULT true
);
-- Operating regions drive data scoping for RBAC (Ethiopia vs Dubai teams).
CREATE TABLE core.operating_regions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,            -- 'ET', 'AE-DXB'
  name          TEXT NOT NULL,
  country_code  CHAR(2) NOT NULL,
  base_currency CHAR(3) NOT NULL REFERENCES core.currencies(code),
  timezone      TEXT NOT NULL,                   -- 'Africa/Addis_Ababa'
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Rates are appended, never updated; documents snapshot the rate they used.
CREATE TABLE core.exchange_rates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency  CHAR(3) NOT NULL REFERENCES core.currencies(code),
  quote_currency CHAR(3) NOT NULL REFERENCES core.currencies(code),
  rate           NUMERIC(20,8) NOT NULL CHECK (rate > 0),
  rate_type      TEXT NOT NULL DEFAULT 'commercial'
                 CHECK (rate_type IN ('official_nbe','commercial','internal')),
  effective_from TIMESTAMPTZ NOT NULL,
  source         TEXT NOT NULL,                  -- 'NBE', 'manual', bank name
  created_by     UUID,                           -- FK added after iam.users
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (base_currency <> quote_currency),
  UNIQUE (base_currency, quote_currency, rate_type, effective_from)
);
CREATE INDEX ix_fx_lookup ON core.exchange_rates (base_currency, quote_currency, rate_type, effective_from DESC);
CREATE TABLE core.system_settings (
  key           TEXT PRIMARY KEY,
  value         JSONB NOT NULL,
  description   TEXT,
  is_secret     BOOLEAN NOT NULL DEFAULT false,  -- secrets live in vault; flag only
  updated_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Human-readable document numbers (ORD-2026-000123) without gaps races.
CREATE TABLE core.document_sequences (
  doc_type      TEXT NOT NULL,
  period        TEXT NOT NULL,                   -- '2026'
  next_value    BIGINT NOT NULL DEFAULT 1 CHECK (next_value > 0),
  PRIMARY KEY (doc_type, period)
);
