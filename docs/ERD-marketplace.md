# Sabu Marketplace Expansion — ERD Delta

**Version:** 1.0 · Extends migrations 000–030

## New schema: `marketplace`

```
marketplace.vendors
  id, vendor_code, business_name, display_name, phone_e164, email,
  region_id → core.operating_regions, status, commission_rate_pct (NULL=use global),
  bank_details JSONB, created_at, updated_at

marketplace.vendor_users
  vendor_id, user_id → iam.users, role (owner|staff), UNIQUE(vendor_id,user_id)

marketplace.commission_rules
  id, code, scope (global|vendor|category), vendor_id?, category_id?,
  rate_pct NUMERIC(7,4), applies_to (merchandise|merchandise_plus_tax),
  valid_during TSTZRANGE, is_active

marketplace.commission_entries
  id, order_id, order_item_ids UUID[], vendor_id, rule_id,
  gross_amount, rate_pct, commission_amount, currency,
  status (accrued|finalized|reversed|paid_out),
  idempotency_key UNIQUE, settlement_id?, created_at

marketplace.settlements
  id, settlement_number, vendor_id, period_start, period_end,
  gross_sales, refunds, commission_total, net_payable, currency,
  status (draft|approved|paid|cancelled), paid_at, payout_reference

marketplace.settlement_items
  settlement_id, commission_entry_id UNIQUE
```

## Catalog / sales hooks

```
catalog.products.vendor_id → marketplace.vendors (NULL = platform)
catalog.categories.ai_studio_enabled BOOLEAN
catalog.category_attribute_sets (category_id, attribute_id, required, sort_order)

sales.order_items.vendor_id → marketplace.vendors (snapshot at checkout)
```

## Finance receipts

```
finance.customer_receipts
  id, receipt_number, order_id UNIQUE, customer_name, customer_phone,
  pdf_storage_key, qr_payload, payment_status_snapshot, grand_total,
  access_token_hash, created_at

finance.vendor_statements  (optional view of settlements + PDF key)
```

## Special orders (extend existing `procurement`)

```
core.operating_regions seed: US, CN (AE-DXB already exists)

procurement.partners  (marketplace-facing alias or view of suppliers with country tags)
  — Prefer: extend procurement.suppliers with country_code, whatsapp_e164, portal fields

procurement.special_order_requests
  + guest_first_name, guest_last_name, guest_phone_e164
  + preferred_contact_channel
  + allow uploaded_by NULL on attachments for guests

procurement.partner_assignments
  request_id, supplier_id, sent_at, status, outbox_event_id

procurement.partner_quotations
  assignment_id, currency, product_cost, shipping, lead_days,
  notes, received_at, raw_payload JSONB
```

## Analytics

Prefer **SQL views / materialized views** over duplicate fact tables initially:

- `analytics.v_daily_gmv`
- `analytics.v_vendor_performance`
- `analytics.v_commission_summary`
- `analytics.v_special_order_funnel`

## Do not confuse

| Entity | Purpose |
|--------|---------|
| `marketplace.vendors` | Sellers on the storefront |
| `procurement.suppliers` | Sourcing / PO partners (incl. international) |
| `crm.business_accounts` | Wholesale **buyers** |
