# Railway stability & performance (learning guide)

How to keep Sabu **online**, avoid **crashes**, and stay fast as your brother adds **many product photos** — and as real customers hit the storefront.

**Go-live?** Use **§11 Go-live plan** (Phase A now → B launch day → C first weeks → D scale).  
You do not need the full backlog before soft catalog entry.

Companion doc (migrations / Option C): `docs/railway-migrations-cicd.md`

---

## 1. What “high performance + no crash” means here

| Goal | Meaning for Sabu |
|------|------------------|
| **No crash** | API stays up; Railway restarts unhealthy instances; one bad upload/studio job cannot kill the process |
| **No data loss** | Product rows survive in PostGIS; picture files survive on a volume (later: object storage); backups exist |
| **Fast enough** | Catalog loads quickly; images are resized; DB connections are pooled; builds don’t OOM the trial plan |
| **Recoverable** | You can see errors, redeploy, and restore |

Crash ≠ slow. A slow site can still be “up.” A crash takes Admin + Web down with the API.

---

## 2. Mental model (draw this)

```
Browser (Web / Admin)
        │  HTTPS
        ▼
   @sabu/web / @sabu/admin     ← Next.js (static UI + calls API)
        │  NEXT_PUBLIC_API_URL
        ▼
      @sabu/api                ← Nest (business logic)
        │
        ├── private net ──► PostGIS (+ postgis-volume)     rows
        └── disk ─────────► api-uploads (/data/uploads)    picture files
```

**Rule:** UI apps are replaceable. **PostGIS + media** are the precious parts. Protect those first.

---

## 3. What we already have (baseline)

| Piece | Status | Why it matters |
|-------|--------|----------------|
| Option C migrate-on-deploy | Live | Schema always matches the API version |
| Private `DATABASE_URL` → PostGIS | Live | DB not on the public internet |
| `postgis-volume` | Live | Product/order data survives restarts |
| `api-uploads` + `MEDIA_ROOT=/data/uploads` | Live | Uploaded photos survive API redeploys |
| Demo pastel seed on boot | Live | Catalog doesn’t show green tiles when `demo/kids` files are missing |
| `pg.Pool` with `max: 20` | In code | Caps DB connections (good start) |
| Per-image size cap (~8MB) | In code | Stops huge payloads |
| `railway.api.json` healthcheck path | In repo | `/v1/finance/health` (confirm it is applied in Railway UI) |
| Watch patterns per service | Live | Avoid rebuilding all apps on every push |

Public URLs (production):

- API: `https://sabuapi-production.up.railway.app`
- Admin: `https://sabuadmin-production.up.railway.app`
- Web: `https://sabuweb-production.up.railway.app`

---

## 4. Crash prevention — implement in this order

### 4.1 Healthchecks + auto-restart (highest priority)

Railway should probe the API and replace a dead container.

| Setting | Suggested value |
|---------|-----------------|
| Healthcheck path | `/v1/finance/health` (or add `/v1/health` that pings DB) |
| Timeout | 30–100 seconds on cold start |
| Restart policy | `ON_FAILURE` (already common on Railway) |

**Learn:** Healthcheck = “are you alive?” If migrate fails, entrypoint exits and deploy fails — that is **good** (better than a half-broken API).

Also add healthchecks for `@sabu/web` and `@sabu/admin` (e.g. `/`) so a bad Next start gets restarted.

### 4.2 Cap heavy work (studio / sharp / big images)

Background removal and large image processing use a lot of **RAM**. On a trial/hobby plan, 2–3 parallel jobs can OOM-kill the API → sudden crash for everyone.

Implement:

1. **Concurrency limit** — only 1 (or 2) sharp/studio jobs at a time; queue the rest.
2. **Timeouts** — kill a stuck job after N seconds; return a clear error.
3. **Resize on upload** — store a catalog card size + optional full size; don’t serve 8MB originals on the grid.
4. **Fail soft** — studio failure should return an error to Admin, never take down Nest.

### 4.3 Upload guardrails

Already partially done; keep tightening:

| Guard | Why |
|-------|-----|
| Max bytes per file | Stops memory spikes |
| Allow-list mime types | jpeg/png/webp/gif/svg only |
| Virus/malformed check optional later | Nice-to-have |
| Write only under `MEDIA_ROOT` | Never write outside the volume |

### 4.4 Database pool & timeouts

Current pool (`apps/api/src/database/database.service.ts`):

- `max: 20`
- `connectionTimeoutMillis: 3000`

Tune later if you scale replicas:

- Each API replica × `max` ≤ PostGIS `max_connections`
- Prefer fewer, reused connections over opening new ones per request

### 4.5 Turn off dangerous prod flags

| Variable | Dev | Production |
|----------|-----|------------|
| `AUTH_DEV_RETURN_OTP` | OK for local | **Must be off / false** when brother + real users share Admin |
| Public Postgres TCP proxy | Temporary only | Prefer private URL only |

### 4.6 Delete unused services

The leftover stock **Postgres** (not PostGIS) still burns RAM/CPU. API does **not** use it. Remove it once you confirm nothing points at it — frees headroom for PostGIS + API and reduces crash risk from resource pressure.

### 4.7 Backups

Volumes keep data across **redeploys**. They do **not** protect against:

- Accidental `DELETE` / bad migration
- Volume corruption
- Account mistakes

Enable Railway backups / periodic `pg_dump` of PostGIS. Media: volume snapshots or (later) object storage versioning.

---

## 5. Performance — especially “lots of pictures”

### 5.1 Today: Railway volume (`api-uploads`)

```
Good for: early catalog, brother uploading real products
Limit:   ~500 MB on trial (check Railway UI for current size)
Risk:    Filling the disk → upload failures (app may stay up, photos fail)
```

Tips while on volume:

- Prefer **jpeg/webp**, ~1–2 MB each (or smaller after resize)
- Don’t upload the same photo 10 times at full phone resolution
- Watch **current size** on the `api-uploads` volume card

### 5.2 Next: object storage (S3 / Cloudflare R2)

When photo volume grows, move files off the API disk:

```
Admin upload → API validates → store in R2/S3 → save key in PostGIS
Web/Admin    → CDN URL or signed URL (not API disk)
```

Benefits:

- API redeploys never touch photo bytes
- Almost unlimited catalog photos
- CDN = faster storefront worldwide
- API RAM stays free for Nest, not file serving

### 5.3 Image pipeline (recommended shape)

```
Original upload
   │
   ├─► thumb  (e.g. 200px)   — admin lists
   ├─► card   (e.g. 600px)   — catalog grid
   └─► full   (e.g. 1600px)  — product detail
```

Catalog should load **card**, not **full**. That alone prevents most “slow catalog” complaints.

### 5.4 Build / deploy performance (avoid trial OOM)

Lesson learned: building **admin + web at the same time** on trial can kill a build with little error text.

| Practice | Why |
|----------|-----|
| Separate watch patterns | Only rebuild what changed |
| Don’t redeploy all three apps for a docs-only change | Saves minutes + RAM |
| Dockerfile for API | Reproducible migrate-then-start |

### 5.5 Caching

- Media: `Cache-Control` on `/v1/media/file` (already public max-age)
- Later: CDN in front of media or R2
- Catalog API: optional short cache for anonymous product list (careful with stock)

---

## 6. Monitoring (know about crashes before users do)

| Layer | What to watch |
|-------|----------------|
| Railway metrics | CPU, RAM, restart count |
| Deploy logs | `[railway-api] Migrations OK`, seed lines, Nest boot |
| HTTP | 5xx rate on API domain |
| Optional Sentry | Stack traces for uncaught errors |

Minimum habit: after every production deploy, hit:

```bash
curl https://sabuapi-production.up.railway.app/v1/finance/health
```

Expect `{ "status": "ok", ... }`.

---

## 7. Staging (when you outgrow “push straight to production”)

```
GitHub → staging (copy of API + PostGIS)
              │ test migrate + upload
              ▼
         production
```

Never run experimental SQL or `db:reset` against the brother/production PostGIS.

---

## 8. Scaling ladder (when traffic grows)

| Stage | What you run |
|-------|----------------|
| Now | 1 API + PostGIS + volume + Admin + Web |
| Busy catalog | Resize images + CDN; maybe larger volume |
| Many photos | R2/S3 + CDN; API stays thin |
| Real traffic | 2 API replicas; stronger Postgres plan; connection pool tuned |
| Peak | Separate worker service for studio/sharp jobs |

Replicas only help if **sessions/media** are shared correctly (JWT already stateless; media must be on volume or object storage — **not** ephemeral disk).

---

## 9. Failure cheat sheet

| Symptom | Likely cause | What to do |
|---------|--------------|------------|
| Green product tiles | Missing files under `MEDIA_ROOT` for that key | Ensure boot seed ran; or re-upload; check volume mount |
| Upload fails after many photos | Volume full (~500MB) | Grow volume or move to R2/S3; compress images |
| API 502 / offline | OOM or crash loop | Check Railway metrics/logs; lower concurrency; raise plan |
| Admin OTP weird in prod | `AUTH_DEV_RETURN_OTP` still on | Disable for real users |
| `relation does not exist` | Migrate didn’t run | See `docs/railway-migrations-cicd.md` |
| Build failed with almost no error | Parallel builds OOM on trial | Redeploy **one** service at a time |
| Photos vanish after redeploy | `MEDIA_ROOT` not on volume | Confirm `api-uploads` → `/data/uploads` and `MEDIA_ROOT` |

---

## 10. Implementation backlog (checklist)

Use this as the engineering todo list. Mark items as you ship them.

### Crash / reliability

- [ ] Confirm Railway UI healthcheck on `@sabu/api` (`/v1/finance/health`)
- [ ] Healthcheck on `@sabu/web` and `@sabu/admin`
- [ ] Dedicated `/v1/health` that checks DB ping (optional but better)
- [ ] Limit concurrent sharp/studio jobs
- [ ] Request/job timeouts for heavy endpoints
- [ ] Disable `AUTH_DEV_RETURN_OTP` in production
- [ ] Remove unused stock **Postgres** service
- [ ] Enable PostGIS backups / dump schedule
- [ ] Alert on 5xx or restart spikes (Railway or Sentry)

### Pictures / performance

- [ ] Resize to thumb/card/full on upload
- [ ] Serve card size on catalog grid
- [ ] Monitor `api-uploads` used MB
- [ ] Plan + implement R2/S3 when volume pressure appears
- [ ] CDN in front of media
- [ ] Prefer webp/jpeg compression in Admin upload UX

### Process

- [ ] Staging environment for migrate/upload tests
- [ ] Short runbook: “API down” / “uploads failing” (link this doc)
- [ ] Never `db:reset` on shared production DB

---

## 11. Go-live plan (do this when you launch)

You do **not** need every backlog item before brother starts entering products.  
Use phases. Treat this section as the **launch plan**; sections 4–10 are the detail.

### Phase A — Now (brother enters real catalog, storefront soft / limited)

**Goal:** data safe, Admin usable, no silly foot-guns.

| # | Action | Done? |
|---|--------|-------|
| A1 | Keep PostGIS + `api-uploads` + migrate-on-deploy as-is | ✅ already live |
| A2 | Confirm API healthcheck in Railway UI | [ ] |
| A3 | Disable `AUTH_DEV_RETURN_OTP` before sharing Admin widely | [ ] |
| A4 | Delete unused stock **Postgres** (not PostGIS) | [ ] |
| A5 | Brother uses compressed photos (~1–2 MB); watch volume MB | [ ] |
| A6 | After each API deploy: curl finance/health | [ ] |

Soft rule for Phase A: **prefer stability over new features.**

### Phase B — Storefront go-live day (public customers)

**Goal:** customers can browse/buy without the API falling over.

| # | Action | Done? |
|---|--------|-------|
| B1 | Healthchecks on Web + Admin too | [ ] |
| B2 | Upload resize (card/thumb) + limit concurrent sharp/studio jobs | [ ] |
| B3 | PostGIS backup enabled or first successful `pg_dump` | [ ] |
| B4 | Smoke test: login → catalog → product image → checkout path | [ ] |
| B5 | Know the rollback: previous Railway deploy + this doc’s cheat sheet | [ ] |
| B6 | OTP/auth works for real phones (no dev OTP leak) | [ ] |

**Go / no-go:** if B2–B4 are incomplete, launch with low traffic only and watch RAM/restarts closely.

### Phase C — First weeks after go-live

**Goal:** survive real photo volume and real traffic.

| # | Action | Done? |
|---|--------|-------|
| C1 | If `api-uploads` nears full → grow volume **or** move to R2/S3 | [ ] |
| C2 | CDN in front of media (or R2 public/CDN URL) | [ ] |
| C3 | Error alerts (Railway + optional Sentry) | [ ] |
| C4 | Staging env for migrations before production | [ ] |
| C5 | If traffic grows → 2 API replicas + stronger DB plan | [ ] |
| C6 | Heavy studio work → separate worker (optional) | [ ] |

### Phase D — Scale (only when metrics say so)

Follow **§8 Scaling ladder**. Don’t buy replicas “just in case” while the catalog is still being filled.

### One-page launch order

```
Phase A (now)     → safe catalog entry
Phase B (launch)  → public storefront
Phase C (weeks)   → photos + monitoring + staging
Phase D (later)   → replicas / workers / bigger DB
```

### When orders grow (what to learn next)

You do not need deep scaling knowledge on day one. When real order volume appears, study in this order:

| Learn | Why orders care | Where |
|-------|-----------------|-------|
| 1. Deploy logs + healthchecks | A down API = no checkout | §4.1, §6 |
| 2. PostGIS backups + never `db:reset` | Orders/payments live in the DB | §4.7, migrations doc |
| 3. Connection pool / DB size | More checkouts = more queries | §4.4, §8 |
| 4. Media vs DB | Order rows ≠ receipt/product images | §5, migrations §12 |
| 5. Replicas + workers | Only after metrics show CPU/RAM pressure | §8, Phase D |
| 6. Staging before migrate | A bad migration can block all new orders | §7, Phase C4 |

**Order-specific watch list (later):** payment webhook failures, receipt uploads filling media, delivery/dispatch job errors, outbox/event lag, 5xx on `/checkout` paths.

Re-read this doc + `docs/railway-migrations-cicd.md` before you buy a bigger Railway plan — most “we need scale” moments are really backups, healthchecks, or a full disk.

---

## 12. Suggested “next 3” before / at go-live

1. **Healthchecks verified in Railway** — auto-restart dead API  
2. **Upload resize + sharp concurrency limit** — stop OOM when many photos / studio run  
3. **Object storage plan (R2/S3)** — before `api-uploads` fills after go-live  

Ship 1–2 in Phase B; keep 3 ready as Phase C trigger when volume usage climbs.

---

## 13. Related docs

- Migrations & CI/CD (Option C): `docs/railway-migrations-cicd.md`
- Marketplace roadmap: `docs/ROADMAP-marketplace.md`
- Data model: `docs/ERD-marketplace.md`
- Product requirements: `docs/FRD-marketplace.md` / `docs/BRD-marketplace.md`

---

## 14. Learning checklist

- [ ] I can explain why PostGIS volume ≠ picture storage
- [ ] I know why `MEDIA_ROOT` must point at `api-uploads`
- [ ] I know healthchecks restart dead containers
- [ ] I know heavy image work can OOM the API
- [ ] I know when to move from volume → R2/S3
- [ ] I will not leave `AUTH_DEV_RETURN_OTP` on for real users
- [ ] I know unused Postgres should be removed to free resources
- [ ] I know Phase A vs B vs C of the go-live plan
