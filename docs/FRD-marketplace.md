# Sabu Marketplace Expansion — Functional Requirements Document (FRD)

**Version:** 1.0  
**Date:** 2026-11-10  
**Depends on:** Guest checkout FRD (`docs/FRD-expansion.md`), existing modular monolith

## 1. Actors & roles

| Role | Capabilities |
|------|----------------|
| `super_admin` / `et_operations_admin` | Full marketplace oversight |
| `finance_admin` | Commissions, settlements, receipts, payouts |
| `vendor_owner` / `vendor_staff` | Own catalog, orders, statements only |
| `procurement_manager` | Special orders + partners |
| `partner` (tokenized) | Quotation submit via secure link |
| Guest / customer | Checkout, track, special-order request |

New permissions (seeded):  
`marketplace.vendors.read|write`, `marketplace.commissions.read|write`, `marketplace.settlements.write`, `analytics.read`, `special_orders.read|write`, `partners.read|write`, `receipts.write`

## 2. Functional requirements

### FR-M1 Multi-category catalog
- Unlimited categories/subcategories; enable/disable.
- Category ↔ attribute set mapping (size/color vs material/capacity).
- Flag `ai_studio_enabled` per category.
- Seed initial trees: men/women/kids apparel, cosmetics, traditional, jebena, antiques, electronics, home, other.
- Products remain primarily single `category_id`; optional M:N later.

### FR-M2 Multi-vendor marketplace
- `marketplace.vendors` with status `pending|active|suspended|rejected`.
- Vendor users via `marketplace.vendor_users` → `iam.users`.
- `catalog.products.vendor_id` nullable (NULL = platform).
- Vendor dashboard APIs scoped by vendor membership.
- Admin onboards or approves self-registration.

### FR-M3 Commission 2%
- Global default rule 2.00% of line merchandise value.
- Per-vendor override rates.
- On order completion event: create `marketplace.commission_entries` per vendor slice (idempotent on `order_id+vendor_id`).
- Support adjustments/refunds as signed delta rows.
- Settlements aggregate unpaid commissions into payout batches.

### FR-M4 Receipts & statements
- Generate `finance.customer_receipts` (or reuse `finance.invoices`) with PDF storage key + QR payload (track/receipt token).
- Vendor settlement statements with period, GMV, commissions, net payable.
- Outbox `receipt.ready` → WhatsApp stub with secure link.
- Admin resend from dashboard.

### FR-M5 Analytics
- Admin KPIs: GMV, orders, commission revenue, refunds, AOV, trends.
- Vendor, category, payment-method breakdowns.
- Special-order funnel metrics.
- CSV/Excel export endpoints; charts in admin UI.

### FR-M6 International special orders
- Guest/customer form: sourcing country (USA/China/Dubai), name, phone, product, description, ≥1 image, optional specs.
- Reference `SR-…` / extend existing `procurement.special_order_requests`.
- Admin assigns partners, sends WhatsApp/outbox request, records partner quotations, customer quotation, payment, procurement, shipping statuses.
- Partner tokenized quotation portal (no full ERP account required).

### FR-M7 Status model (special orders)
Map FRD 18 statuses onto existing CHECK + additive statuses via migration. Keep history in `special_order_status_history`.

## 3. API surface (Phase M1–M3)

| Method | Path | Notes |
|--------|------|-------|
| GET/POST | `/v1/marketplace/admin/vendors` | Admin vendor CRUD |
| PATCH | `/v1/marketplace/admin/vendors/:id` | Approve/suspend |
| GET | `/v1/marketplace/me` | Vendor self profile |
| GET | `/v1/marketplace/me/orders` | Vendor order lines |
| GET | `/v1/marketplace/admin/commissions` | Commission ledger |
| POST | `/v1/marketplace/admin/settlements` | Create settlement batch |
| GET | `/v1/analytics/admin/overview` | KPI cards |
| POST | `/v1/procurement/special-orders` | Guest/customer create |
| POST | `/v1/procurement/special-orders/:id/images` | Upload (multipart later; base64 Phase M3) |
| GET | `/v1/procurement/admin/special-orders` | Admin queue |
| POST | `/v1/procurement/admin/partners` | Partner CRUD |
| POST | `/v1/procurement/admin/special-orders/:id/assign` | Assign partner + outbox |

## 4. Non-functional
- Idempotent commission & settlement posts.
- Vendor data isolation enforced in SQL (`WHERE vendor_id = $vendor`).
- Audit log commission rate changes and settlement approvals.
- Preserve existing sales/payments/delivery modules; hook commission on payment/delivery events via outbox.
