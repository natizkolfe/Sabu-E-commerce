-- =====================================================================
-- Ethiopian E-Commerce & ERP Platform - PostgreSQL Schema (v0.1 draft)
-- Target: PostgreSQL 16 + PostGIS 3
-- Layout: one PostgreSQL schema per business module (modular monolith).
-- Each "MIGRATION nnn" block is intended to become its own migration file
-- (e.g. 001_core.sql, 002_iam.sql ...). Blocks are in dependency order.
--
-- Conventions
--   * PK: UUID (gen_random_uuid(); app may supply UUIDv7 for index locality)
--   * Money: NUMERIC(18,2) + currency CHAR(3); FX rates NUMERIC(20,8)
--   * Status: TEXT + CHECK list (easier to evolve than ENUM types)
--   * Timestamps: TIMESTAMPTZ, stored UTC; created_at / updated_at everywhere
--   * Soft delete: deleted_at on master data only; transactional rows are
--     never deleted, they change status (cancelled, voided, reversed).
--   * PII columns suffixed _enc are application-encrypted (envelope keys in
--     KMS); companion _hash columns (HMAC-SHA256) allow exact-match lookup.
-- =====================================================================
-- MIGRATION 000 - extensions & schemas -------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- digest(), gen_random_bytes()
CREATE EXTENSION IF NOT EXISTS citext;       -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS postgis;      -- geography types
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- exclusion constraints
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- fuzzy product search
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS crm;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS pricing;
CREATE SCHEMA IF NOT EXISTS inventory;
CREATE SCHEMA IF NOT EXISTS sales;
CREATE SCHEMA IF NOT EXISTS procurement;
CREATE SCHEMA IF NOT EXISTS logistics;
CREATE SCHEMA IF NOT EXISTS payments;
CREATE SCHEMA IF NOT EXISTS delivery;
CREATE SCHEMA IF NOT EXISTS notify;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE OR REPLACE FUNCTION core.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
