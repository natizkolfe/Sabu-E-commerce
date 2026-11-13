-- MIGRATION 046 — customer order feedback & ratings (post-checkout)

CREATE TABLE IF NOT EXISTS sales.order_feedback (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL UNIQUE REFERENCES sales.orders(id) ON DELETE CASCADE,
  overall_rating     SMALLINT NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  product_rating     SMALLINT CHECK (product_rating IS NULL OR product_rating BETWEEN 1 AND 5),
  delivery_rating    SMALLINT CHECK (delivery_rating IS NULL OR delivery_rating BETWEEN 1 AND 5),
  service_rating     SMALLINT CHECK (service_rating IS NULL OR service_rating BETWEEN 1 AND 5),
  comment            TEXT CHECK (comment IS NULL OR length(comment) BETWEEN 1 AND 2000),
  would_recommend    BOOLEAN,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_order_feedback_rating
  ON sales.order_feedback (overall_rating, created_at DESC);

COMMENT ON TABLE sales.order_feedback IS
  'Guest/customer ratings and comments submitted after placing an order (one per order).';
