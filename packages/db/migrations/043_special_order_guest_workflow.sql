-- MIGRATION 043 — guest special-order workflow fields + expanded statuses

ALTER TABLE procurement.special_order_requests
  ADD COLUMN IF NOT EXISTS customer_instructions TEXT;

-- Expand status vocabulary for international special-order lifecycle
ALTER TABLE procurement.special_order_requests
  DROP CONSTRAINT IF EXISTS special_order_requests_status_check;

ALTER TABLE procurement.special_order_requests
  ADD CONSTRAINT special_order_requests_status_check CHECK (status IN (
    'submitted',
    'under_review',
    'sourcing',
    'searching_for_product',
    'product_found',
    'quotation_prepared',
    'quotation_sent',
    'awaiting_customer_approval',
    'awaiting_customer_confirmation',
    'awaiting_payment',
    'payment_verification_pending',
    'payment_confirmed',
    'purchasing',
    'purchased',
    'preparing_shipment',
    'shipped',
    'in_transit',
    'customs_clearance',
    'arrived_ethiopia',
    'arrived_in_ethiopia',
    'ready_for_delivery',
    'out_for_delivery',
    'delivered',
    'rejected_by_customer',
    'unavailable',
    'product_unavailable',
    'cancelled',
    'refunded'
  ));

COMMENT ON COLUMN procurement.special_order_requests.customer_instructions IS
  'Optional extra notes from the guest (separate from product description).';
