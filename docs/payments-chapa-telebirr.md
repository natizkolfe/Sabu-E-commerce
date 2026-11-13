# Sabu payments — Chapa & Telebirr (developer notes)

**Status:** Guidance / test evaluation (not an implementation checklist to execute yet)  
**Date:** 2026-11-13  
**Related:** [FRD-expansion.md](./FRD-expansion.md) § FR-2 Payment methods

## Official developer links

| Provider | Portal |
|----------|--------|
| **Chapa** | [https://chapa.co/developers](https://chapa.co/developers) |
| **Chapa docs** | [https://developer.chapa.co/](https://developer.chapa.co/) |
| **Telebirr (Ethio Telecom)** | [https://developer.ethiotelecom.et/docs/](https://developer.ethiotelecom.et/docs/) |

## Verdict (test review)

### Chapa — primary online rail (do first)

- Best fit for Sabu’s NestJS + guest checkout flow.
- Clear path: **initialize → redirect to `checkout_url` → verify before marking paid → webhook as backup**.
- Hosted checkout can surface **Telebirr, CBE, cards, and other methods** inside Chapa for many merchants — one integration covers multiple Ethiopian rails.
- Sabu already has a **v1-style** path (`https://api.chapa.co/v1` initialize / verify). Current Chapa marketing docs emphasize **v2** (`https://api.chapa.global/v2`). **v1 remains usable**; plan a later v2 migration, not a day-one rewrite.
- Never trust browser return URL alone. Always re-verify amount, currency, `tx_ref` / reference, and status server-side.

**When implementing live Chapa (later):**

1. Obtain test secret key → sandbox payments.
2. Wire webhook + return URL to verify endpoint.
3. Mark order paid only after verify succeeds (idempotent).
4. Switch to live keys after sandbox sign-off.

### Telebirr (native Ethio Telecom API) — optional, harder

- Developer portal is login-gated; public docs are thinner than Chapa’s.
- Native C2B web flow is heavier: **RSA keys**, fabric token, `preOrder`, signed `notify_url`, separate test vs production gateways.
- Worth building **direct** Telebirr only if Sabu needs Telebirr-branded merchant terms or Chapa’s Telebirr routing is insufficient.
- Until merchant approval + keys are ready, Sabu’s **manual Telebirr / CBE / other bank** verification remains the correct fallback.

### Recommended priority for Sabu

| Priority | Approach |
|----------|----------|
| 1 | Finish **live Chapa hosted checkout** (v1 OK now; track v2) |
| 2 | Keep **manual Telebirr / CBE / other bank** as fallback |
| 3 | Native Telebirr API only after portal approval + keys |

**Bottom line:** Chapa is the right primary online payment rail. Native Telebirr API is optional and more ops-heavy. Manual methods stay as backup until both APIs are proven in sandbox.

## What Sabu already has (code)

- Modular payments schema: intents, transactions, webhooks, admin verification.
- `chapa_checkout` initialize / webhook / verify path (mock mode when `CHAPA_SECRET_KEY` is missing).
- Manual methods: `telebirr_manual`, `cbe_manual`, `other_bank_manual`, bank transfer with receipt upload + admin approve/reject.
- Env knobs (see `.env.example` when present): `CHAPA_SECRET_KEY`, `CHAPA_BASE_URL`, `CHAPA_WEBHOOK_URL`, `CHAPA_WEBHOOK_SECRET`.

## Out of scope for this note

- No live key installation or production cutover from this document alone.
- No Telebirr RSA onboarding steps until merchant portal access is confirmed.
- Special-order quotation payments follow the same rule: **ship only after payment is verified**.
