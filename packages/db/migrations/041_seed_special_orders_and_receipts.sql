-- MIGRATION 041 - synthetic special orders + customer receipts for testing

INSERT INTO iam.permissions (code, module, description) VALUES
  ('receipts.read', 'finance', 'View customer receipts')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code IN ('super_admin', 'et_operations_admin')
  AND p.code IN ('receipts.read', 'receipts.write')
ON CONFLICT DO NOTHING;

-- Clean prior demo special-order seed (safe re-run)
DELETE FROM finance.customer_receipts
WHERE order_id IN (
  SELECT id FROM sales.orders WHERE order_number LIKE 'ORD-SO-DEMO-%'
);
DELETE FROM sales.order_items
WHERE order_id IN (
  SELECT id FROM sales.orders WHERE order_number LIKE 'ORD-SO-DEMO-%'
);
DELETE FROM sales.orders WHERE order_number LIKE 'ORD-SO-DEMO-%';
DELETE FROM procurement.partner_quotations
WHERE assignment_id IN (
  SELECT pa.id FROM procurement.partner_assignments pa
  JOIN procurement.special_order_requests r ON r.id = pa.request_id
  WHERE r.request_number LIKE 'SR-DEMO-%'
);
DELETE FROM procurement.partner_assignments
WHERE request_id IN (
  SELECT id FROM procurement.special_order_requests WHERE request_number LIKE 'SR-DEMO-%'
);
DELETE FROM procurement.special_order_attachments
WHERE request_id IN (
  SELECT id FROM procurement.special_order_requests WHERE request_number LIKE 'SR-DEMO-%'
);
DELETE FROM procurement.special_order_status_history
WHERE request_id IN (
  SELECT id FROM procurement.special_order_requests WHERE request_number LIKE 'SR-DEMO-%'
);
DELETE FROM procurement.special_order_requests WHERE request_number LIKE 'SR-DEMO-%';
DELETE FROM crm.customers
WHERE is_guest AND phone_e164 IN (
  '+251911000101', '+251911000102', '+251911000103', '+251911000104', '+251911000105'
);

DO $$
DECLARE
  reg_us UUID;
  reg_cn UUID;
  reg_ae UUID;
  reg_et UUID;
  c1 UUID; c2 UUID; c3 UUID; c4 UUID; c5 UUID;
  r1 UUID; r2 UUID; r3 UUID; r4 UUID; r5 UUID;
  partner_us UUID; partner_cn UUID; partner_dxb UUID;
  assign_id UUID;
  ord1 UUID; ord2 UUID;
BEGIN
  SELECT id INTO reg_us FROM core.operating_regions WHERE code = 'US' LIMIT 1;
  SELECT id INTO reg_cn FROM core.operating_regions WHERE code = 'CN' LIMIT 1;
  SELECT id INTO reg_ae FROM core.operating_regions WHERE code IN ('AE-DXB','AE') LIMIT 1;
  SELECT id INTO reg_et FROM core.operating_regions WHERE code = 'ET' LIMIT 1;
  IF reg_ae IS NULL THEN reg_ae := reg_et; END IF;
  IF reg_us IS NULL OR reg_cn IS NULL OR reg_et IS NULL THEN
    RAISE EXCEPTION 'Operating regions missing (US/CN/ET)';
  END IF;

  SELECT id INTO partner_us FROM procurement.suppliers WHERE code = 'PARTNER-US-01' LIMIT 1;
  SELECT id INTO partner_cn FROM procurement.suppliers WHERE code = 'PARTNER-CN-01' LIMIT 1;
  SELECT id INTO partner_dxb FROM procurement.suppliers WHERE code = 'PARTNER-DXB-01' LIMIT 1;

  INSERT INTO crm.customers (
    user_id, customer_type, customer_code, is_guest, first_name, last_name, phone_e164
  ) VALUES
    (NULL, 'retail', 'CUS-DEMO-SO-001', true, 'Hanna', 'Bekele', '+251911000101'),
    (NULL, 'retail', 'CUS-DEMO-SO-002', true, 'Dawit', 'Alemu', '+251911000102'),
    (NULL, 'retail', 'CUS-DEMO-SO-003', true, 'Sara', 'Tesfaye', '+251911000103'),
    (NULL, 'retail', 'CUS-DEMO-SO-004', true, 'Yonas', 'Girma', '+251911000104'),
    (NULL, 'retail', 'CUS-DEMO-SO-005', true, 'Meron', 'Hailu', '+251911000105');

  SELECT id INTO c1 FROM crm.customers WHERE customer_code = 'CUS-DEMO-SO-001';
  SELECT id INTO c2 FROM crm.customers WHERE customer_code = 'CUS-DEMO-SO-002';
  SELECT id INTO c3 FROM crm.customers WHERE customer_code = 'CUS-DEMO-SO-003';
  SELECT id INTO c4 FROM crm.customers WHERE customer_code = 'CUS-DEMO-SO-004';
  SELECT id INTO c5 FROM crm.customers WHERE customer_code = 'CUS-DEMO-SO-005';

  -- 1) Newly submitted (USA)
  INSERT INTO procurement.special_order_requests (
    request_number, customer_id, sourcing_region_id, product_name, description,
    quantity, status, guest_first_name, guest_last_name, guest_phone_e164,
    preferred_contact_channel, budget_amount, budget_currency
  ) VALUES (
    'SR-DEMO-0001', c1, reg_us,
    'Nike Air Max Kids 28',
    'Looking for authentic Nike Air Max kids size 28, white/pink.',
    1, 'submitted', 'Hanna', 'Bekele', '+251911000101', 'whatsapp', 4500, 'ETB'
  ) RETURNING id INTO r1;

  INSERT INTO procurement.special_order_status_history (request_id, from_status, to_status, note, is_customer_visible)
  VALUES (r1, NULL, 'submitted', 'Demo: guest submitted', true);

  INSERT INTO procurement.special_order_attachments (
    request_id, storage_key, mime_type, size_bytes, scan_status, uploaded_by
  ) VALUES (
    r1, 'studio/demo/stroller/source/placeholder.jpg', 'image/jpeg', 120000, 'clean', NULL
  );

  -- 2) Under review + partner assigned (China)
  INSERT INTO procurement.special_order_requests (
    request_number, customer_id, sourcing_region_id, product_name, description,
    quantity, status, guest_first_name, guest_last_name, guest_phone_e164,
    preferred_contact_channel, supplier_id, budget_amount, budget_currency
  ) VALUES (
    'SR-DEMO-0002', c2, reg_cn,
    'Foldable baby bathtub SC-7038',
    'Need grey/white foldable bathtub set with stool, authentic packaging.',
    2, 'sourcing', 'Dawit', 'Alemu', '+251911000102', 'telegram', partner_cn, 3200, 'ETB'
  ) RETURNING id INTO r2;

  INSERT INTO procurement.special_order_status_history (request_id, from_status, to_status, note, is_customer_visible)
  VALUES
    (r2, NULL, 'submitted', 'Demo submitted', true),
    (r2, 'submitted', 'under_review', 'Demo under review', true),
    (r2, 'under_review', 'sourcing', 'Assigned Shenzhen partner', true);

  INSERT INTO procurement.special_order_attachments (
    request_id, storage_key, mime_type, size_bytes, scan_status, uploaded_by
  ) VALUES (
    r2, 'studio/demo/bathtub/source/placeholder.jpg', 'image/jpeg', 140000, 'clean', NULL
  );

  IF partner_cn IS NOT NULL THEN
    INSERT INTO procurement.partner_assignments (request_id, supplier_id, status, sent_at)
    VALUES (r2, partner_cn, 'quoted', now() - interval '1 day')
    RETURNING id INTO assign_id;

    INSERT INTO procurement.partner_quotations (
      assignment_id, currency, product_cost, shipping_cost, other_costs, lead_time_days, notes
    ) VALUES (
      assign_id, 'CNY', 180.00, 45.00, 10.00, 12, 'Demo quote from Shenzhen desk'
    );
  END IF;

  -- 3) Awaiting payment (Dubai) — quotation ready
  INSERT INTO procurement.special_order_requests (
    request_number, customer_id, sourcing_region_id, product_name, description,
    quantity, status, guest_first_name, guest_last_name, guest_phone_e164,
    preferred_contact_channel, supplier_id, budget_amount, budget_currency
  ) VALUES (
    'SR-DEMO-0003', c3, reg_ae,
    'Dyson Airwrap Complete',
    'Customer wants Dyson Airwrap Complete (nickel/fuchsia) shipped to Addis.',
    1, 'awaiting_payment', 'Sara', 'Tesfaye', '+251911000103', 'whatsapp', partner_dxb, 28000, 'ETB'
  ) RETURNING id INTO r3;

  INSERT INTO procurement.special_order_status_history (request_id, from_status, to_status, note, is_customer_visible)
  VALUES
    (r3, NULL, 'submitted', 'Demo submitted', true),
    (r3, 'submitted', 'quotation_prepared', 'Quote prepared', true),
    (r3, 'quotation_prepared', 'awaiting_payment', 'Waiting deposit', true);

  INSERT INTO procurement.special_order_attachments (
    request_id, storage_key, mime_type, size_bytes, scan_status, uploaded_by
  ) VALUES (
    r3, 'studio/demo/keyboard/source/placeholder.jpg', 'image/jpeg', 110000, 'clean', NULL
  );

  -- 4) Paid special order + receipt
  INSERT INTO procurement.special_order_requests (
    request_number, customer_id, sourcing_region_id, product_name, description,
    quantity, status, guest_first_name, guest_last_name, guest_phone_e164,
    preferred_contact_channel, supplier_id, budget_amount, budget_currency
  ) VALUES (
    'SR-DEMO-0004', c4, reg_us,
    'LEGO Technic Bugatti',
    'LEGO Technic Bugatti Chiron set, sealed box.',
    1, 'payment_confirmed', 'Yonas', 'Girma', '+251911000104', 'phone', partner_us, 18500, 'ETB'
  ) RETURNING id INTO r4;

  INSERT INTO procurement.special_order_status_history (request_id, from_status, to_status, note, is_customer_visible)
  VALUES
    (r4, NULL, 'submitted', 'Demo submitted', true),
    (r4, 'submitted', 'awaiting_payment', 'Invoice sent', true),
    (r4, 'awaiting_payment', 'payment_confirmed', 'Bank transfer verified', true);

  INSERT INTO sales.orders (
    order_number, customer_id, order_type, fulfillment_type, sales_channel,
    special_order_request_id, region_id, status, payment_status, currency,
    subtotal, discount_total, tax_total, delivery_fee, grand_total,
    amount_paid, ship_recipient_name, ship_recipient_phone, ship_address_text,
    guest_phone_e164, placed_at
  ) VALUES (
    'ORD-SO-DEMO-0004', c4, 'special_order', 'international_procurement', 'web',
    r4, reg_et, 'confirmed', 'paid', 'ETB',
    17500, 0, 0, 1000, 18500,
    18500, 'Yonas Girma', '+251911000104', 'Bole, Addis Ababa — near Edna Mall',
    '+251911000104', now() - interval '2 days'
  ) RETURNING id INTO ord1;

  INSERT INTO sales.order_items (
    order_id, line_no, variant_id, sku_snapshot, name_snapshot,
    quantity, unit_price, discount_amount, tax_amount, line_total
  ) VALUES (
    ord1, 1, NULL, 'SO-LEGO-BUGATTI', 'LEGO Technic Bugatti (special order)',
    1, 17500, 0, 0, 17500
  );

  INSERT INTO finance.customer_receipts (
    receipt_number, order_id, customer_name, customer_phone,
    payment_method_code, payment_status, subtotal, delivery_fee, tax_total,
    discount_total, grand_total, currency, qr_payload, line_items
  ) VALUES (
    'RCP-SO-DEMO-0004', ord1, 'Yonas Girma', '+251911000104',
    'bank_transfer_manual', 'paid', 17500, 1000, 0, 0, 18500, 'ETB',
    'sabu://receipt/RCP-SO-DEMO-0004',
    jsonb_build_array(
      jsonb_build_object(
        'name', 'LEGO Technic Bugatti (special order)',
        'qty', 1,
        'unitPrice', 17500,
        'lineTotal', 17500
      ),
      jsonb_build_object(
        'name', 'International handling / delivery',
        'qty', 1,
        'unitPrice', 1000,
        'lineTotal', 1000
      )
    )
  );

  -- 5) Delivered special order + receipt
  INSERT INTO procurement.special_order_requests (
    request_number, customer_id, sourcing_region_id, product_name, description,
    quantity, status, guest_first_name, guest_last_name, guest_phone_e164,
    preferred_contact_channel, supplier_id, budget_amount, budget_currency
  ) VALUES (
    'SR-DEMO-0005', c5, reg_cn,
    'Music Bed Bell mobile',
    'Pink music bed bell / crib mobile, detachable toys.',
    1, 'delivered', 'Meron', 'Hailu', '+251911000105', 'whatsapp', partner_cn, 2800, 'ETB'
  ) RETURNING id INTO r5;

  INSERT INTO procurement.special_order_status_history (request_id, from_status, to_status, note, is_customer_visible)
  VALUES
    (r5, NULL, 'submitted', 'Demo submitted', true),
    (r5, 'submitted', 'payment_confirmed', 'Paid', true),
    (r5, 'payment_confirmed', 'in_transit', 'Left Shenzhen', true),
    (r5, 'in_transit', 'delivered', 'Delivered in Addis', true);

  INSERT INTO sales.orders (
    order_number, customer_id, order_type, fulfillment_type, sales_channel,
    special_order_request_id, region_id, status, payment_status, currency,
    subtotal, discount_total, tax_total, delivery_fee, grand_total,
    amount_paid, ship_recipient_name, ship_recipient_phone, ship_address_text,
    guest_phone_e164, placed_at
  ) VALUES (
    'ORD-SO-DEMO-0005', c5, 'special_order', 'international_procurement', 'whatsapp',
    r5, reg_et, 'delivered', 'paid', 'ETB',
    2400, 0, 0, 400, 2800,
    2800, 'Meron Hailu', '+251911000105', 'Piassa, Addis Ababa',
    '+251911000105', now() - interval '12 days'
  ) RETURNING id INTO ord2;

  INSERT INTO sales.order_items (
    order_id, line_no, variant_id, sku_snapshot, name_snapshot,
    quantity, unit_price, discount_amount, tax_amount, line_total
  ) VALUES (
    ord2, 1, NULL, 'SO-BED-BELL', 'Music Bed Bell mobile (special order)',
    1, 2400, 0, 0, 2400
  );

  INSERT INTO finance.customer_receipts (
    receipt_number, order_id, customer_name, customer_phone,
    payment_method_code, payment_status, subtotal, delivery_fee, tax_total,
    discount_total, grand_total, currency, qr_payload, line_items
  ) VALUES (
    'RCP-SO-DEMO-0005', ord2, 'Meron Hailu', '+251911000105',
    'telebirr', 'paid', 2400, 400, 0, 0, 2800, 'ETB',
    'sabu://receipt/RCP-SO-DEMO-0005',
    jsonb_build_array(
      jsonb_build_object(
        'name', 'Music Bed Bell mobile (special order)',
        'qty', 1,
        'unitPrice', 2400,
        'lineTotal', 2400
      ),
      jsonb_build_object(
        'name', 'Delivery fee',
        'qty', 1,
        'unitPrice', 400,
        'lineTotal', 400
      )
    )
  );
END $$;
