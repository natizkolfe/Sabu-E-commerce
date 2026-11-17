# OTP delivery — Twilio (US) & WhatsApp (Ethiopia)

Login codes are sent by phone channel:

| Phone prefix | Channel | Provider |
|--------------|---------|----------|
| `+1…` (US) | SMS | **Twilio Verify** |
| `+251…` (Ethiopia) | WhatsApp | Meta WhatsApp Cloud API |
| Other | WhatsApp first | Same as Ethiopia |

Admin sign-in is also limited to an allowlist (`AUTH_ADMIN_PHONE_ALLOWLIST`), currently including `+14045101204` and `+251911129726`.

---

## Railway variables (`@sabu/api`)

Set these on the **API** service only (Variables → Save → redeploy):

```text
# Required for US SMS OTP
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_FROM_NUMBER=+1xxxxxxxxxx          # Twilio's number (sender), not your phone
TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxx     # Verify → Services → Sabu

# Production safety
NODE_ENV=production
# true = show OTP on login screen when SMS/WhatsApp did not send a provider-managed code
# (temporary until Ethiopia WhatsApp works). Set false once WhatsApp OTP is live.
AUTH_DEV_RETURN_OTP=true

# Optional
OTP_BRAND_NAME=Sabu

# Ethiopia WhatsApp (when ready)
WHATSAPP_MODE=cloud
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_OTP_TEMPLATE_NAME=               # approved Meta OTP/auth template
WHATSAPP_OTP_TEMPLATE_LANG=en
```

Do **not** commit real secrets. Prefer Railway Variables (or a local `.env` that is gitignored).

---

## Twilio setup (US SMS) — step by step

### 1. Create / upgrade a Twilio account

1. Sign up at [twilio.com](https://www.twilio.com/try-twilio).
2. Onboarding: select **Messaging** + **Verification and identity**, build **With code**.
3. A free trial can send sample SMS, but **custom OTP needs an upgraded account** (add payment / starting balance).  
   For light testing, **$20** starting balance is enough.
4. Optional: turn **off auto-recharge** until you want it.

### 2. Get Account SID, Auth Token, and From number

1. Twilio Console → **Account Dashboard** (or Account → API keys & tokens).
2. Copy:
   - **Account SID** → `TWILIO_ACCOUNT_SID`
   - **Auth Token** → `TWILIO_AUTH_TOKEN` (never paste in chat/commits)
3. **Phone Numbers → Manage → Active numbers** (or the “From” number used in Try SMS).
4. Copy that Twilio number (E.164, e.g. `+1737…`) → `TWILIO_FROM_NUMBER`.  
   This is **Twilio’s sender**, not the admin’s personal phone.

### 3. Create a Verify service (required for trial / OTP)

Plain SMS bodies fail on many Twilio accounts with:

> Invalid template name. Trial accounts can only use predefined SMS templates.

Use **Verify** instead (already wired in the API):

1. Console → **Develop → Verify → Services → Create new**.
2. Friendly name: `Sabu` (authorize friendly name when asked).
3. Enable channel: **SMS**.
4. Fraud Guard: Yes is fine.
5. Copy **Service SID** (`VA…`) → `TWILIO_VERIFY_SERVICE_SID`.

### 4. Verify recipient phones (before compliance is approved)

Until a **Primary Compliance Profile** is approved, Twilio only sends to **Verified Caller IDs**.

For each US phone that must receive OTP (e.g. `+14045101204`):

1. Console → search **Verified Caller IDs**, or open  
   `https://console.twilio.com/us1/account/phone-numbers/verified-caller-ids`
2. **Add a new Caller ID** → enter the E.164 number.
3. Answer the automated call and enter the validation code on the keypad.

API alternative (same result):

```bash
# From a machine with Railway CLI linked to the project:
railway run -s "@sabu/api" -- node -e "/* POST OutgoingCallerIds with PhoneNumber=+1... */"
```

Confirm the number appears under Outgoing Caller IDs before testing Sabu Admin.

### 5. Put variables on Railway and deploy

1. [railway.app](https://railway.app) → project → service **`@sabu/api`** → **Variables**.
2. Add the four Twilio vars above.
3. Set `AUTH_DEV_RETURN_OTP=false` and `NODE_ENV=production`.
4. Save / redeploy. Wait until deploy status is **SUCCESS**.

### 6. Test admin login

1. Open Sabu Admin.
2. Phone: `+14045101204` → **Send OTP**.
3. Enter the **6-digit code from SMS** (not the phone number) → **Verify**.

If it fails, check Railway logs for `@sabu/api`:

```text
railway logs -s "@sabu/api"
```

Look for `[twilio verify]` warnings.

---

## Common Twilio errors

| Message / symptom | Fix |
|-------------------|-----|
| `Could not send SMS code. Check Twilio configuration.` | See API logs; usually missing Verify SID, wrong token, or unverified recipient |
| `Invalid template name. Trial accounts can only use predefined SMS templates.` | Use `TWILIO_VERIFY_SERVICE_SID` (Verify), not raw Messaging Body |
| `…add recipient numbers as verified caller IDs…` / Primary Compliance Profile | Verify the recipient phone under Verified Caller IDs |
| Dev OTP shown on screen in production | Set `AUTH_DEV_RETURN_OTP=false` |
| OTP field validation `/^\d{6}$/` | You entered the phone in the **code** box — enter only the 6 digits |

---

## WhatsApp setup (Ethiopia) — outline

Code already routes `+251…` to WhatsApp. To finish production delivery:

1. Create a Meta WhatsApp Business / Cloud API app.
2. Set `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` on `@sabu/api`.
3. Create and get approval for an **authentication / OTP template**.
4. Set `WHATSAPP_OTP_TEMPLATE_NAME` (+ optional `WHATSAPP_OTP_TEMPLATE_LANG`).
5. Redeploy API and test with `+251911129726`.

Free-form WhatsApp text only works inside Meta’s customer-care window; OTP login needs an approved template.

---

## Local development

Without Twilio/WhatsApp credentials:

- `AUTH_DEV_RETURN_OTP=true` and `NODE_ENV=development` returns `devCode` in the API response (shown on web/admin login).
- Production never returns `devCode` when `NODE_ENV=production`.

---

## Related code

| Area | Path |
|------|------|
| Twilio client + Verify | `apps/api/src/modules/notify/twilio.service.ts` |
| Channel routing | `apps/api/src/modules/notify/otp-delivery.service.ts` |
| Request / verify OTP | `apps/api/src/modules/iam/auth.service.ts` |
| Env examples | `.env.example` |
