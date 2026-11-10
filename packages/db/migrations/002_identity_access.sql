-- MIGRATION 002 - identity & access ----------------------------------
CREATE TABLE iam.users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_type          TEXT NOT NULL CHECK (user_type IN ('customer','staff','driver')),
  email              CITEXT,
  phone_e164         TEXT CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  password_hash      TEXT,                       -- argon2id; NULL for OTP-only login
  full_name          TEXT NOT NULL,
  preferred_locale   TEXT NOT NULL DEFAULT 'am-ET'
                     CHECK (preferred_locale IN ('am-ET','en-US','om-ET','ti-ET','ar-AE')),
  status             TEXT NOT NULL DEFAULT 'pending_verification'
                     CHECK (status IN ('pending_verification','active','suspended','deactivated')),
  email_verified_at  TIMESTAMPTZ,
  phone_verified_at  TIMESTAMPTZ,
  mfa_enabled        BOOLEAN NOT NULL DEFAULT false,
  mfa_secret_enc     BYTEA,                      -- TOTP secret, app-encrypted
  failed_login_count SMALLINT NOT NULL DEFAULT 0,
  locked_until       TIMESTAMPTZ,
  last_login_at      TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ,
  CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL)
  -- MFA for staff is enforced at login by policy (role-dependent), not by a row constraint
);
CREATE UNIQUE INDEX ux_users_email ON iam.users (email) WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE UNIQUE INDEX ux_users_phone ON iam.users (phone_e164) WHERE deleted_at IS NULL AND phone_e164 IS NOT NULL;
ALTER TABLE core.exchange_rates  ADD FOREIGN KEY (created_by) REFERENCES iam.users(id);
ALTER TABLE core.system_settings ADD FOREIGN KEY (updated_by) REFERENCES iam.users(id);
CREATE TABLE iam.roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,            -- 'super_admin','dubai_procurement_admin'
  name          TEXT NOT NULL,
  description   TEXT,
  is_system     BOOLEAN NOT NULL DEFAULT false,  -- system roles cannot be deleted
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE iam.permissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE CHECK (code ~ '^[a-z_]+\.[a-z_]+(\.[a-z_]+)?$'), -- 'orders.read', 'payments.refund.approve'
  module        TEXT NOT NULL,
  description   TEXT
);
CREATE TABLE iam.role_permissions (               -- M:N roles ↔ permissions
  role_id       UUID NOT NULL REFERENCES iam.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES iam.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
-- M:N users ↔ roles, optionally scoped to a region (Dubai admin sees Dubai data).
CREATE TABLE iam.user_roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  role_id       UUID NOT NULL REFERENCES iam.roles(id) ON DELETE RESTRICT,
  region_id     UUID REFERENCES core.operating_regions(id),   -- NULL = all regions
  granted_by    UUID REFERENCES iam.users(id),
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_user_roles ON iam.user_roles (user_id, role_id, COALESCE(region_id, '00000000-0000-0000-0000-000000000000'));
CREATE TABLE iam.sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  refresh_token_hash  BYTEA NOT NULL UNIQUE,     -- SHA-256 of opaque refresh token
  client_type         TEXT NOT NULL CHECK (client_type IN ('web','customer_app','driver_app','admin_web')),
  ip_address          INET,
  user_agent          TEXT,
  mfa_verified        BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ
);
CREATE INDEX ix_sessions_user ON iam.sessions (user_id) WHERE revoked_at IS NULL;
CREATE TABLE iam.otp_challenges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES iam.users(id) ON DELETE CASCADE,
  destination   TEXT NOT NULL,                   -- phone or email
  purpose       TEXT NOT NULL CHECK (purpose IN ('login','verify_phone','verify_email','password_reset','mfa')),
  code_hash     BYTEA NOT NULL,
  attempts      SMALLINT NOT NULL DEFAULT 0 CHECK (attempts <= 5),
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_otp_dest ON iam.otp_challenges (destination, purpose, created_at DESC);
