-- MIGRATION 034 - Admin analytics dashboard workflow
-- Separate payment / approval / QA / contact / delivery statuses.
-- Gates dispatch until payment verified + approved + QA passed.

-- ---------------------------------------------------------------------------
-- Order workflow columns
-- ---------------------------------------------------------------------------
ALTER TABLE sales.orders
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES iam.users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_notes TEXT,
  ADD COLUMN IF NOT EXISTS qa_status TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS qa_checked_by UUID REFERENCES iam.users(id),
  ADD COLUMN IF NOT EXISTS qa_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qa_notes TEXT,
  ADD COLUMN IF NOT EXISTS contact_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS contact_follow_up_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contact_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contact_resolved_by UUID REFERENCES iam.users(id);

ALTER TABLE sales.orders DROP CONSTRAINT IF EXISTS orders_approval_status_check;
ALTER TABLE sales.orders
  ADD CONSTRAINT orders_approval_status_check
  CHECK (approval_status IN (
    'not_required', 'pending', 'approved', 'rejected'
  ));

ALTER TABLE sales.orders DROP CONSTRAINT IF EXISTS orders_qa_status_check;
ALTER TABLE sales.orders
  ADD CONSTRAINT orders_qa_status_check
  CHECK (qa_status IN (
    'not_started', 'pending', 'passed', 'failed'
  ));

ALTER TABLE sales.orders DROP CONSTRAINT IF EXISTS orders_contact_status_check;
ALTER TABLE sales.orders
  ADD CONSTRAINT orders_contact_status_check
  CHECK (contact_status IN (
    'none', 'required', 'in_progress', 'resolved', 'closed'
  ));

CREATE INDEX IF NOT EXISTS ix_orders_approval_status
  ON sales.orders (approval_status, coalesce(placed_at, created_at) DESC);
CREATE INDEX IF NOT EXISTS ix_orders_qa_status
  ON sales.orders (qa_status, coalesce(placed_at, created_at) DESC);
CREATE INDEX IF NOT EXISTS ix_orders_contact_status
  ON sales.orders (contact_status, coalesce(placed_at, created_at) DESC);
CREATE INDEX IF NOT EXISTS ix_orders_payment_status_placed
  ON sales.orders (payment_status, coalesce(placed_at, created_at) DESC);
CREATE INDEX IF NOT EXISTS ix_orders_dashboard_search
  ON sales.orders (order_number, ship_recipient_name, ship_recipient_phone);

-- ---------------------------------------------------------------------------
-- Approval history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.order_approvals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES sales.orders(id) ON DELETE CASCADE,
  action          TEXT NOT NULL CHECK (action IN (
                    'submitted', 'approved', 'rejected', 'reopened', 'note'
                  )),
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  notes           TEXT,
  actor_id        UUID REFERENCES iam.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_order_approvals_order
  ON sales.order_approvals (order_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- QA reviews
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.order_qa_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES sales.orders(id) ON DELETE CASCADE,
  result          TEXT NOT NULL CHECK (result IN ('passed', 'failed', 'recheck')),
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  notes           TEXT,
  checked_qty_ok  BOOLEAN,
  variants_ok     BOOLEAN,
  packaging_ok    BOOLEAN,
  actor_id        UUID REFERENCES iam.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_order_qa_reviews_order
  ON sales.order_qa_reviews (order_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Customer contact cases (queue until resolved)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.customer_contact_cases (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL REFERENCES sales.orders(id) ON DELETE CASCADE,
  reason_code       TEXT NOT NULL CHECK (reason_code IN (
                      'payment_unverified', 'invalid_txn', 'duplicate_txn',
                      'incomplete_customer', 'unclear_delivery', 'manual_phone',
                      'notify_failed', 'clarification', 'other'
                    )),
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                      'open', 'in_progress', 'resolved', 'closed'
                    )),
  priority          TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN (
                      'low', 'normal', 'high', 'urgent'
                    )),
  title             TEXT NOT NULL,
  details           TEXT,
  follow_up_at      TIMESTAMPTZ,
  assigned_to       UUID REFERENCES iam.users(id),
  opened_by         UUID REFERENCES iam.users(id),
  resolved_by       UUID REFERENCES iam.users(id),
  resolved_at       TIMESTAMPTZ,
  resolution_notes  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_contact_cases_open
  ON sales.customer_contact_cases (status, priority, created_at DESC)
  WHERE status IN ('open', 'in_progress');
CREATE INDEX IF NOT EXISTS ix_contact_cases_order
  ON sales.customer_contact_cases (order_id, created_at DESC);

-- Link contact attempts to cases when present
ALTER TABLE notify.customer_contact_attempts
  ADD COLUMN IF NOT EXISTS case_id UUID REFERENCES sales.customer_contact_cases(id);

-- ---------------------------------------------------------------------------
-- Admin operational alerts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notify.admin_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type      TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'info' CHECK (severity IN (
                    'info', 'warning', 'critical'
                  )),
  title           TEXT NOT NULL,
  body            TEXT,
  order_id        UUID REFERENCES sales.orders(id) ON DELETE SET NULL,
  delivery_id     UUID,
  is_read         BOOLEAN NOT NULL DEFAULT false,
  read_by         UUID REFERENCES iam.users(id),
  read_at         TIMESTAMPTZ,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_admin_alerts_unread
  ON notify.admin_alerts (is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS notify.admin_alert_preferences (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL UNIQUE REFERENCES iam.users(id) ON DELETE CASCADE,
  approval_overdue_hours INT NOT NULL DEFAULT 4,
  contact_overdue_hours INT NOT NULL DEFAULT 2,
  delivery_delay_hours  INT NOT NULL DEFAULT 6,
  notify_new_orders     BOOLEAN NOT NULL DEFAULT true,
  notify_payments       BOOLEAN NOT NULL DEFAULT true,
  notify_qa_failures    BOOLEAN NOT NULL DEFAULT true,
  notify_contact        BOOLEAN NOT NULL DEFAULT true,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Saved dashboard filter presets (per admin user)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics.dashboard_filter_presets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  filters     JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

-- ---------------------------------------------------------------------------
-- Permissions + role grants
-- ---------------------------------------------------------------------------
INSERT INTO iam.permissions (code, module, description) VALUES
  ('orders.approve', 'sales', 'Approve or reject orders after payment verification'),
  ('orders.qa', 'sales', 'Perform order QA before dispatch'),
  ('orders.contact', 'sales', 'Manage customer contact cases'),
  ('analytics.read', 'analytics', 'View analytics dashboard')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code = 'et_operations_admin'
  AND p.code IN (
    'orders.approve', 'orders.qa', 'orders.contact', 'analytics.read'
  )
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code = 'finance_admin'
  AND p.code IN ('payments.verify', 'payments.read', 'analytics.read', 'orders.read')
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code = 'super_admin'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Backfill workflow statuses from existing order state
-- ---------------------------------------------------------------------------
UPDATE sales.orders o
SET
  approval_status = CASE
    WHEN o.status IN ('cancelled', 'returned', 'partially_returned') THEN 'not_required'
    WHEN o.payment_status = 'paid'
      AND o.status IN (
        'confirmed', 'processing', 'partially_fulfilled', 'ready_for_dispatch',
        'dispatched', 'delivered', 'completed', 'delivery_failed'
      ) THEN 'approved'
    WHEN o.payment_status = 'paid' THEN 'pending'
    WHEN o.payment_status = 'pending_verification' THEN 'not_required'
    ELSE 'not_required'
  END,
  qa_status = CASE
    WHEN o.status IN ('ready_for_dispatch', 'dispatched', 'delivered', 'completed')
      THEN 'passed'
    WHEN o.status IN ('processing', 'partially_fulfilled') THEN 'pending'
    WHEN o.payment_status = 'paid'
      AND o.status IN ('confirmed') THEN 'not_started'
    ELSE 'not_started'
  END,
  contact_status = CASE
    WHEN o.requires_manual_contact THEN 'required'
    ELSE 'none'
  END,
  approved_at = CASE
    WHEN o.payment_status = 'paid'
      AND o.status IN (
        'confirmed', 'processing', 'partially_fulfilled', 'ready_for_dispatch',
        'dispatched', 'delivered', 'completed'
      ) THEN coalesce(o.placed_at, o.created_at)
    ELSE NULL
  END
WHERE TRUE;

-- Open contact cases for flagged orders
INSERT INTO sales.customer_contact_cases (
  order_id, reason_code, status, priority, title, details
)
SELECT
  o.id,
  CASE
    WHEN o.preferred_contact_channel IN ('phone', 'sms') THEN 'manual_phone'
    WHEN o.payment_status IN ('unpaid', 'pending_verification') THEN 'payment_unverified'
    ELSE 'other'
  END,
  'open',
  'normal',
  'Customer contact required',
  'Backfilled from requires_manual_contact flag'
FROM sales.orders o
WHERE o.requires_manual_contact = true
  AND NOT EXISTS (
    SELECT 1 FROM sales.customer_contact_cases c
    WHERE c.order_id = o.id AND c.status IN ('open', 'in_progress')
  );

COMMENT ON COLUMN sales.orders.approval_status IS
  'Ops approval after payment: not_required|pending|approved|rejected';
COMMENT ON COLUMN sales.orders.qa_status IS
  'Pre-dispatch QA: not_started|pending|passed|failed';
COMMENT ON COLUMN sales.orders.contact_status IS
  'Customer contact queue: none|required|in_progress|resolved|closed';
