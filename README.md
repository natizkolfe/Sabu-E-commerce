# Sabu — Ethiopian E-Commerce & ERP

Modular monolith for retail, wholesale, Dubai special orders, delivery, payments, and ERP.

**Stack:** NestJS · PostgreSQL 16 + PostGIS · Redis · Next.js (storefront + admin)

Based on the Technical Design v0.1 (Architecture, ERD & Data Structure) — 14 module schemas, 98 tables.

## Repository layout

```
apps/
  api/      NestJS REST API (/v1)
  web/      Customer storefront (Next.js)
  admin/    Admin / ERP portal (Next.js)
packages/
  db/       schema.sql, migrations/, migrate runner
docker-compose.yml
```

## Quick start

1. **Prerequisites:** Node 20+, Docker Desktop (PostGIS + Redis).

2. **Environment**

```bash
cp .env.example .env
```

3. **Infrastructure** (Docker Desktop required — PostGIS image; host port **5433**)

```bash
npm run db:up
```

> If you already have PostgreSQL on port 5432, leave it alone. Sabu uses **5433** via Docker so the two do not collide.

4. **Install & migrate**

```bash
npm install
npm run db:migrate
```

5. **Run API**

```bash
npm run dev:api
```

Health: [http://localhost:3001/v1/health](http://localhost:3001/v1/health)

6. **Frontends**

```bash
npm run dev:web    # storefront :3000 — home, catalog shell, phone OTP login
npm run dev:admin  # :3002
```

Storefront auth talks to `NEXT_PUBLIC_API_URL` (default `http://localhost:3001/v1`).

## Module map (API ↔ PostgreSQL schema)

| Module        | Schema       | Owns |
|---------------|--------------|------|
| Core          | `core`       | currencies, regions, FX, settings, outbox, idempotency |
| IAM           | `iam`        | users, roles, permissions, sessions, OTP |
| Customers     | `crm`        | customers, addresses, business accounts |
| Catalog       | `catalog`    | categories, brands, products, variants, images |
| Pricing       | `pricing`    | price lists, promotions, discount codes |
| Inventory     | `inventory`  | warehouses, balances, reservations, movements |
| Sales         | `sales`      | carts, quotations, orders, returns |
| Procurement   | `procurement`| special orders, suppliers, POs, GRNs |
| Logistics     | `logistics`  | international shipments, customs |
| Payments      | `payments`   | intents, transactions, webhooks, refunds |
| Delivery      | `delivery`   | zones, drivers, deliveries, PoD |
| Notifications | `notify`     | templates, providers, deliveries |
| Finance       | `finance`    | invoices, tax, expenses, journal |
| Audit         | `audit`      | audit + data-access logs |

Module boundaries: a module reads/writes only its own schema; cross-module side effects go through `core.outbox_events`.

## Database

- Full DDL: `packages/db/schema.sql`
- Ordered migrations: `packages/db/migrations/000_*.sql` … `019_*.sql`
- Apply: `npm run db:migrate`
- Wipe and re-apply: `npm run db:reset`

## Auth (phone OTP)

```bash
# 1) Request OTP (dev returns devCode)
curl -X POST http://localhost:3001/v1/auth/otp/request \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"+251911000001\",\"fullName\":\"Test Customer\"}"

# 2) Verify → accessToken + refreshToken
curl -X POST http://localhost:3001/v1/auth/otp/verify \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"+251911000001\",\"code\":\"123456\",\"clientType\":\"web\"}"

# 3) Profile
curl http://localhost:3001/v1/auth/me -H "Authorization: Bearer <accessToken>"
```

New customers auto-register as `retail_customer` with a `crm.customers` row. SMS gateway is not wired yet — OTP is logged and returned as `devCode` in development.

## Status

IAM auth (OTP + JWT sessions + RBAC guards) is live. Next: catalog & pricing read APIs, then checkout.
