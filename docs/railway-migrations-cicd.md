# Railway migrations & CI/CD (learning guide)

This doc explains **Option C**: run database migrations securely on every API deploy, over Railway’s **private** network. No public Postgres port. No laptop tunnel required.

---

## 1. What problem this solves

Sabu’s API expects Postgres tables/schemas (`core`, `catalog`, `sales`, …).

A fresh Railway Postgres starts **empty**. If you deploy the API without migrations, the app boots but background jobs fail (example: `relation "core.outbox_events" does not exist`).

**Goal:** every time we ship a new API version, the database schema is updated *before* (or as part of) starting the new process — automatically, safely, repeatably.

---

## 2. Mental model (draw this)

```
GitHub push
    │
    ▼
Railway builds Dockerfile.api
    │
    ▼
Container starts → railway-api-entrypoint.js
    │
    ├─ 1) node packages/db/scripts/migrate.js
    │       uses DATABASE_URL → postgres.railway.internal (private)
    │       applies packages/db/migrations/*.sql in order
    │
    └─ 2) node apps/api/dist/main.js
            Nest API listens on $PORT
```

Brother’s Admin UI later talks to this API. The API talks to Postgres.  
Migrations are **not** run from the browser — only from the deploy pipeline.

---

## 3. Key files in this repo

| Path | Role |
|------|------|
| `packages/db/migrations/*.sql` | Ordered schema changes (`000_…`, `001_…`, …) |
| `packages/db/scripts/migrate.js` | Applies pending `.sql` files; tracks them in `public.schema_migrations` |
| `scripts/railway-api-entrypoint.js` | **Migrate then start** entrypoint for production |
| `Dockerfile.api` | Production image that keeps migrations + API `dist` |
| `.dockerignore` | Keeps build context small (excludes local uploads, `.next`, etc.) |

Locally you still use:

```bash
npm run db:migrate
```

On Railway the same migrate script runs inside the container via the entrypoint.

---

## 4. Why this is the secure choice

| Approach | Secure? | CI/CD fit |
|----------|---------|-----------|
| Public TCP proxy to Postgres from laptop | Weak if left open | Poor |
| One-off SSH into container | OK for emergencies | Not repeatable |
| **Entrypoint / pre-deploy migrate on private network** | **Strong** | **Best** |

Security properties of Option C:

1. Postgres hostname stays `*.railway.internal` — not on the public internet.
2. `DATABASE_URL` lives in Railway Variables (not in Git).
3. Migration code ships with the same git SHA as the API — schema and app stay paired.
4. If migrate fails, the entrypoint **exits non-zero** and refuses to start a half-broken API.

---

## 5. How `migrate.js` works (step by step)

1. Read `DATABASE_URL` from the environment.
2. Connect with `pg`.
3. Ensure table `public.schema_migrations (id, applied_at)`.
4. List `packages/db/migrations/*.sql` sorted by filename.
5. For each file:
   - If `id` already in `schema_migrations` → `skip`
   - Else run SQL in a **transaction**, then insert the `id` → `apply`
6. Exit `0` on success, `1` on failure (triggers deploy failure).

**Rule for future migrations you write:**

- Prefer additive changes (add column/table) over destructive renames in one shot.
- Never use `--reset` / `db:reset` against production.
- One concern per migration file; name it `042_something_clear.sql`.

---

## 6. How this becomes full CI/CD later

Today (minimal):

```
push to main → Railway auto-build → migrate → start API
```

Soon (recommended maturity path):

1. **GitHub Actions** on PR: `lint` + `test` (no deploy).
2. Merge to `main` → Railway deploys **staging**.
3. Manual promote / second environment → **production**.
4. Same `Dockerfile.api` + entrypoint in both environments.
5. Optional: Railway backup / point-in-time recovery before large migrations.

You do **not** need to change the migration strategy when you add CI — you only add quality gates *before* Railway builds.

---

## 7. Railway service settings (API)

For service `@sabu/api`:

| Setting | Value |
|---------|--------|
| Builder | Prefer **Dockerfile** with path `Dockerfile.api` (set in Railway service settings) |
| Dockerfile path | `Dockerfile.api` |
| Start command | `node scripts/railway-api-entrypoint.js` **or** `npm run start:prod --workspace=@sabu/api` (both run migrate-then-start) |
| Note | `railway.api.json` in the repo documents the intended settings; Railway’s older “config as code” path is deprecated, so apply these in the dashboard/API settings |
| `DATABASE_URL` | Reference Postgres `DATABASE_URL` |
| `NODE_ENV` | `production` |
| JWT / auth vars | Set in Variables (never commit) |

`apps/api` `start:prod` calls the same entrypoint so even Railpack deploys migrate before boot.

Public domain example:

`https://sabuapi-production.up.railway.app/v1/finance/health`

---

## 8. How to verify after deploy

1. Railway → `@sabu/api` → Deployments → open latest → **Deploy Logs**.
2. Look for:

```text
[railway-api] Running database migrations…
migrate target: postgresql://postgres.railway.internal:5432/railway
apply 000_….sql
…
Migrations complete.
[railway-api] Migrations OK.
[railway-api] Starting API…
Sabu API listening on http://localhost:8080/v1
```

3. Confirm health:

```bash
curl https://<your-api-domain>/v1/finance/health
```

4. Confirm outbox warnings stop (schema exists).

---

## 9. Common failures (and what they mean)

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `ENOTFOUND postgres.railway.internal` | Migrate ran on your laptop with internal URL | Run migrate only inside Railway, or use a temporary public URL carefully |
| `relation "…" does not exist` | Migrations never applied / image lacked SQL files | Use `Dockerfile.api` + entrypoint; redeploy |
| Deploy stuck / failed on migrate | Bad SQL in a new migration | Fix SQL, push again; failed txn is rolled back |
| `extension "postgis" is not available` | Stock Railway Postgres image has no PostGIS | Deploy Railway template **`postgis`** (or image `postgis/postgis:…`) and point API `DATABASE_URL` at `${{PostGIS.DATABASE_PRIVATE_URL}}` |
| Postgres crashes after swapping images | Old volume/data dir incompatible with new major version | Use a **fresh PostGIS service + volume**; don’t reuse a PG18 stock volume with a mismatched image |
| Admin build fails, API OK | Separate Next.js typecheck issue | Fix admin separately; doesn’t block API schema |

---

## 10. Learning checklist

- [ ] I can explain why Postgres should stay private.
- [ ] I know where SQL files live and how they’re ordered.
- [ ] I understand `schema_migrations` prevents re-running old files.
- [ ] I know the entrypoint order: **migrate → start**.
- [ ] I can find migrate lines in Railway deploy logs.
- [ ] I will never run `db:reset` on the shared brother/production database.

---

## 11. Related project docs

- Marketplace roadmap: `docs/ROADMAP-marketplace.md`
- Data model: `docs/ERD-marketplace.md`

When Admin is deployed, point `NEXT_PUBLIC_API_URL` at the public API `/v1` URL so your brother can enter **real products into this real database**.
