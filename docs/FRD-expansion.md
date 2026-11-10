# Sabu Expansion — Functional Requirements Document (FRD)

**Version:** 1.0  
**Date:** 2026-11-10  
**Status:** Approved for implementation  
**Scope:** Guest checkout, Ethiopian payments (Chapa + bank transfer), wholesale tiers, variant/pricing admin, AI studio (pluggable)

## 1. Goals

Extend the existing Ethiopian E-Commerce & ERP modular monolith without rebuilding. Preserve NestJS modules, PostgreSQL schemas, Next.js storefront/admin, and outbox-based side effects.

## 2. Actors

| Actor | Description |
|-------|-------------|
| Guest | Browses and checks out without an account |
| Retail customer | Phone OTP account holder |
| Wholesale customer | Approved business account / bulk tiers |
| Admin (ops/finance/catalog) | RBAC-scoped staff |
| Payment provider | Chapa (Phase A); Telebirr/banks later |
| Notify provider | WhatsApp/SMS (stub → live) |

## 3. Functional requirements

### FR-1 Guest checkout
- Guest cart via opaque token (header `X-Guest-Token`); hashed at rest on `sales.carts.anonymous_token_hash`.
- Checkout collects first name, last name, phone (E.164), delivery address + lat/lng.
- Creates/reuses guest `crm.customers` (`is_guest=true`, `user_id` null).
- Issues `order_number` + track token (plaintext once; SHA-256 stored).
- Public track: `orderNumber` + `token`.
- Account registration remains optional.

### FR-2 Payment methods
- Modular `PaymentProvider` interface.
- Phase A: **Chapa** (initialize → webhook → verify) and **manual bank transfer**.
- Telebirr/CBE/etc. remain seeded `unverified` until merchant access.
- Intents + transactions + webhook inbox; never trust browser return URL alone.
- Admins enable/disable methods.

### FR-3 Bank transfer verification
- Customer sees company bank accounts, uploads receipt, optional reference.
- Order/payment stay pending until admin approve/reject.
- Approve → paid + confirmed + notification outbox event.
- Full history on `payment_status_history` + audit log.

### FR-4 Bulk / wholesale pricing
- `RETAIL-ETB` and `WHOLESALE-ETB` price lists with `min_qty` tiers.
- Resolver picks highest `min_qty ≤ quantity`.
- `catalog.products.bulk_purchasing_enabled`; MOQ via `min_order_qty_wholesale`.
- Custom large deals: existing quotations flow.

### FR-5 Admin pricing & catalog
- CRUD products, variants, attributes, tier prices.
- Price changes: close `valid_during` + insert (no in-place amount UPDATE).
- Order line snapshots remain immutable.

### FR-6 Variants
- Sellable unit remains `product_variants`.
- Optional attribute model for color/size admin UX; `options` JSONB kept for reads.
- Per-variant images and stock.

### FR-7 AI studio
- Schema + admin APIs + **mock** generator in Phase C.
- Virtual models, age groups, generation jobs, generated images.
- Customer-facing AI previews labeled; originals unchanged.

## 4. API appendix (Phase A–C)

### Public / storefront
| Method | Path | Notes |
|--------|------|-------|
| GET/POST | `/v1/sales/guest/cart` | Guest cart |
| POST/PATCH/DELETE | `/v1/sales/guest/cart/items…` | Guest cart lines |
| POST | `/v1/sales/checkout` | Auth or guest body |
| GET | `/v1/sales/orders/track` | Guest track |
| GET | `/v1/payments/methods` | Active methods |
| GET | `/v1/payments/bank-accounts` | Public company accounts |
| POST | `/v1/payments/chapa/initialize` | Start Chapa |
| POST | `/v1/payments/webhooks/chapa` | Signed webhook |
| POST | `/v1/payments/bank-transfer/submit` | Receipt + ref |

### Authenticated customer
| Method | Path |
|--------|------|
| * | Existing `/v1/sales/cart…`, `/v1/sales/orders…` |

### Admin
| Method | Path |
|--------|------|
| CRUD | `/v1/catalog/admin/products…` |
| CRUD | `/v1/catalog/admin/variants…` |
| POST | `/v1/pricing/admin/tiers` |
| GET | `/v1/payments/admin/verifications` |
| POST | `/v1/payments/admin/transactions/:id/approve\|reject` |
| * | `/v1/studio/…` models, generate, publish |

## 5. Non-functional
- Modular monolith; schema ownership; outbox events.
- Rate-limit track + OTP + webhooks.
- Private object keys for receipts/AI images; virus-scan hook placeholder.
- RBAC: `payments.verify`, `catalog.write`, `studio.generate`.

## 6. Out of scope (later)
- Live Telebirr/CBE APIs without merchant approval.
- Customer-uploaded child photos for try-on.
- Full WhatsApp BSP production contract (stub acceptable in Phase A).

## 7. Screen inventory

### Storefront
- Guest checkout (name, phone, address, payment method)
- Bank transfer instructions + upload
- Chapa redirect return page
- Order track page

### Admin
- Products / variants / prices
- Payment verification queue
- Company bank accounts
- AI studio (models, jobs, approve)
