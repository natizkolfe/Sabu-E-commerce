# Sabu Marketplace Expansion — Business Requirements Document (BRD)

**Version:** 1.0  
**Date:** 2026-11-10  
**Status:** Approved for phased delivery  
**Architecture:** Preserve NestJS modular monolith + Next.js + PostgreSQL (+ Redis later for caches/queues)

## 1. Business objectives

Transform Sabu from a single-operator kids retail storefront into a **multi-vendor Ethiopian marketplace + ERP** that also supports **international special-order procurement** (USA, China, Dubai), while keeping guest checkout, local payments, delivery, and AI studio.

Success means every significant sale, commission, quotation, payout, receipt, and WhatsApp notification is **traceable in the web app**.

## 2. Stakeholders

| Stakeholder | Needs |
|-------------|--------|
| Platform owner (Lulie Tech / Sabu) | 2% marketplace fee, oversight, analytics |
| Independent vendors | Sell via Sabu, manage inventory/orders, see net payouts |
| Customers (guest or account) | Browse multi-category catalog, checkout, track, receipts |
| Procurement managers | Route special orders to international partners |
| International partners | Receive requests, submit quotations via WhatsApp/token links |
| Finance | Settlements, refunds, commission adjustments, reports |
| Drivers / ops | Existing delivery flows unchanged |

## 3. Scope

### In scope
- Multi-category catalog (clothing, cosmetics, traditional goods, jebena, electronics, home, etc.)
- Multi-vendor listings with vendor-scoped ERP access
- Default **2%** commission on completed vendor sales (configurable)
- Customer PDF receipts + vendor settlement statements
- WhatsApp stubs → BSP for receipts, partner requests, customer updates
- Admin analytics (GMV, commission, vendors, inventory, special orders)
- International special orders with mandatory product images
- Partner management (USA / China / Dubai)
- Unified admin navigation for all modules

### Out of scope (initial phases)
- Native mobile apps for vendors/partners
- Full live WhatsApp Business API (stub + webhook contracts first)
- Rebuilding existing guest checkout / delivery / payments modules
- Multi-warehouse vendor fulfillment networks outside Ethiopia (later)

## 4. Business rules (summary)

1. **Commission base** = sum of vendor’s order line totals (product value). Exclude delivery fee and tax unless settings say otherwise.
2. **Finalize commission** when sale reaches configured completion rule (default: order `delivered` **and** payment `paid`).
3. **Multi-vendor carts** → one customer order, multiple vendor slices, separate commission rows.
4. **Platform-owned catalog** (no vendor) → 0% commission unless marked otherwise.
5. **Special orders** require ≥1 valid image (JPEG/PNG, ≤10 MB); guest OK.
6. **Receipts** are customer-facing; **settlement statements** are vendor-facing; never interchangeable.
7. Roles enforce least privilege; vendors never see other vendors’ financials.

## 5. Phasing (business priority)

| Phase | Outcome |
|-------|---------|
| M1 | Docs + marketplace schema + vendor CRUD + category expansion |
| M2 | Commission engine on paid/delivered orders + admin commission UI |
| M3 | Special-order guest form + admin/partner workflow (reuse procurement tables) |
| M4 | Receipts PDF + WhatsApp receipt link + vendor statements |
| M5 | Analytics dashboard + exports |
| M6 | Live WhatsApp BSP + partner token portals hardening |

## 6. Risks

- Confusing **procurement suppliers** with **marketplace vendors** — keep schemas separate.
- Guest special-order attachments currently require `uploaded_by` user — must allow guest uploads.
- Commission double-posting on retries — require idempotent keys.
- PDF/WhatsApp latency — use outbox + async workers (existing pattern).
