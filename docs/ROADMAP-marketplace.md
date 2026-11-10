# Implementation Roadmap — Marketplace & International Special Orders

**Principle:** Extend modules; reuse outbox/notify; never confuse vendors with procurement suppliers.

## Dependencies

```
M1 schema/RBAC
  → M2 commission hooks (needs vendor_id on order lines)
  → M4 receipts/settlements (needs finalized commissions)
M1 categories
  → storefront browse + AI studio category flag
Existing SOR tables
  → M3 APIs/UI (guest image upload fix first)
M2+M3 data
  → M5 analytics views
M4 outbox contracts
  → M6 live WhatsApp BSP
```

## Phase M1 — Foundation (this delivery)

- [x] BRD / FRD / ERD docs
- [ ] Migration `031_marketplace_and_special_orders_ext.sql`
- [ ] Nest `marketplace` module (admin vendor CRUD)
- [ ] Admin nav: Analytics, Vendors, Commissions, Special Orders, Partners
- [ ] Seed USA/China regions + multi-category tree + global 2% rule

## Phase M2 — Commission engine

- Snapshot `vendor_id` on checkout lines
- Accrue/finalize commission on payment verified + delivered
- Admin commission ledger + rate overrides
- Idempotency keys + refund adjustments

## Phase M3 — Special orders live path

- Public special-order form (image required)
- Admin queue + partner assign + WhatsApp outbox stub
- Partner quotation capture (admin form + token link)
- Customer quotation accept/reject

## Phase M4 — Receipts & settlements

- PDF receipt generation (storage key)
- Secure receipt download by token
- Vendor settlement batches + statement PDF
- Resend WhatsApp receipt

## Phase M5 — Analytics

- Overview KPIs API + charts
- Filters (date, vendor, category, country)
- CSV/Excel exports

## Phase M6 — Production messaging

- WhatsApp BSP adapter behind NotifyService
- Webhooks for partner replies
- Template approval workflow

## Effort guide (rough)

| Phase | Effort |
|-------|--------|
| M1 | 2–4 days |
| M2 | 3–5 days |
| M3 | 5–8 days |
| M4 | 4–6 days |
| M5 | 4–6 days |
| M6 | 5–10 days (provider-dependent) |
