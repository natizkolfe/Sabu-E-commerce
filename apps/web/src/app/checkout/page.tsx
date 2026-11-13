"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, ContactChannel } from "../../lib/api";
import { useAuth } from "../../context/auth-context";
import { useCart } from "../../context/cart-context";
import { formatEtb } from "../../lib/money";
import {
  ETHIOPIAN_PHONE_ERROR,
  ethiopianLocalPart,
  isValidEthiopianMobile,
  normalizeEthiopianPhone,
} from "../../lib/phone";
import {
  DeliveryLocationPicker,
  type DeliveryLocationValue,
} from "../../components/DeliveryLocationPicker";

type PayMethod = Awaited<ReturnType<typeof api.listPaymentMethods>>[number];
type TelebirrSettings = Awaited<ReturnType<typeof api.telebirrSettings>>;
type BankAccount = Awaited<ReturnType<typeof api.listBankAccounts>>[number];
type Quote = Awaited<ReturnType<typeof api.deliveryQuote>>;

const CHANNELS: Array<{ value: ContactChannel; label: string; hint: string }> =
  [
    {
      value: "whatsapp",
      label: "WhatsApp",
      hint: "Order updates via WhatsApp when available",
    },
    {
      value: "telegram",
      label: "Telegram",
      hint: "Order updates via Telegram when available",
    },
    {
      value: "phone",
      label: "Regular phone call",
      hint: "Our team will call you on the number you provide",
    },
  ];

export default function CheckoutPage() {
  const router = useRouter();
  const { ready, user, accessToken } = useAuth();
  const { cart, refresh, isGuest, guestToken, updateItem, removeItem } =
    useCart();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [note, setNote] = useState("");
  const [channel, setChannel] = useState<ContactChannel>("whatsapp");
  const [consent, setConsent] = useState(true);
  const [showErrors, setShowErrors] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [location, setLocation] = useState<DeliveryLocationValue>({
    lng: 38.789,
    lat: 8.9806,
    addressText: "Bole, Addis Ababa",
    formattedAddress: "Bole, Addis Ababa",
    landmarkName: null,
    landmarkPlaceId: null,
    landmarkLng: null,
    landmarkLat: null,
    deliveryInstructions: "",
    locationType: "exact",
    locationSource: "manual_pin",
    confirmed: false,
  });
  const [methods, setMethods] = useState<PayMethod[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [bankQuery, setBankQuery] = useState("");
  const [telebirr, setTelebirr] = useState<TelebirrSettings | null>(null);
  const [txnId, setTxnId] = useState("");
  const [amountAck, setAmountAck] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [serviceType, setServiceType] = useState<"standard" | "express">(
    "standard",
  );
  const [useWholesale, setUseWholesale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cartBusy, setCartBusy] = useState(false);

  const canWholesale = useMemo(
    () => cart?.items.some((i) => i.bulkEnabled) ?? false,
    [cart],
  );
  const qualifiesWholesale = useMemo(
    () => cart?.items.some((i) => i.bulkEnabled && i.quantity >= 10) ?? false,
    [cart],
  );

  const selectedMethod = methods.find((m) => m.id === paymentMethodId);
  const methodCode = selectedMethod?.code ?? "";
  const isTelebirr = methodCode === "telebirr_manual";
  const isCbe = methodCode === "cbe_manual";
  const isOtherBank = methodCode === "other_bank_manual";
  const isManualPay = isTelebirr || isCbe || isOtherBank;

  const cbeAccount = useMemo(
    () =>
      banks.find((b) => b.code === "cbe" || b.isFeatured) ??
      banks.find((b) => b.bankName.toLowerCase().includes("commercial")),
    [banks],
  );
  const otherBanks = useMemo(
    () =>
      banks.filter(
        (b) => b.id !== cbeAccount?.id && b.isActive !== false,
      ),
    [banks, cbeAccount],
  );
  const filteredOtherBanks = useMemo(() => {
    const q = bankQuery.trim().toLowerCase();
    if (!q) return otherBanks;
    return otherBanks.filter(
      (b) =>
        b.bankName.toLowerCase().includes(q) ||
        b.accountName.toLowerCase().includes(q),
    );
  }, [otherBanks, bankQuery]);
  const selectedBank = useMemo(() => {
    if (isCbe) return cbeAccount ?? null;
    if (isOtherBank)
      return banks.find((b) => b.id === bankAccountId) ?? null;
    return null;
  }, [isCbe, isOtherBank, cbeAccount, banks, bankAccountId]);

  const recipientPhone = normalizeEthiopianPhone(phoneLocal) ?? "";
  const phoneValid = isValidEthiopianMobile(phoneLocal);

  const txnValid = useMemo(() => {
    if (!isManualPay) return true;
    const trimmed = txnId.trim();
    if (!trimmed) return false;
    const regex = telebirr?.txnFormatRegex ?? "^[A-Za-z0-9\\-]{6,40}$";
    try {
      return new RegExp(regex).test(trimmed);
    } catch {
      return /^[A-Za-z0-9-]{6,40}$/.test(trimmed);
    }
  }, [isManualPay, txnId, telebirr]);

  useEffect(() => {
    // Bulk remains optional — do not auto-enable wholesale.
  }, [qualifiesWholesale]);

  useEffect(() => {
    api.listPaymentMethods().then((m) => {
      setMethods(m);
      const tb = m.find((x) => x.code === "telebirr_manual");
      setPaymentMethodId(tb?.id ?? m[0]?.id ?? "");
    });
    api.telebirrSettings().then(setTelebirr).catch(() => undefined);
    api.listBankAccounts().then(setBanks).catch(() => setBanks([]));
  }, []);

  useEffect(() => {
    if (isCbe && cbeAccount) setBankAccountId(cbeAccount.id);
  }, [isCbe, cbeAccount]);

  useEffect(() => {
    if (user) {
      setRecipientName(user.fullName);
      setPhoneLocal(ethiopianLocalPart(user.phone ?? ""));
      const parts = user.fullName.split(" ");
      setFirstName(parts[0] ?? "");
      setLastName(parts.slice(1).join(" ") || parts[0] || "");
    }
  }, [user]);

  useEffect(() => {
    const combined = `${firstName} ${lastName}`.trim();
    if (combined) setRecipientName(combined);
  }, [firstName, lastName]);

  useEffect(() => {
    if (!location.confirmed) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    api
      .deliveryQuote({
        lat: location.lat,
        lng: location.lng,
        subtotal: cart?.subtotal ?? 0,
        serviceType,
      })
      .then((q) => {
        if (!cancelled) {
          setQuote(q);
          // If Express unavailable, fall back to Standard
          if (
            serviceType === "express" &&
            q.services &&
            !q.services.find((s) => s.code === "express")?.available
          ) {
            setServiceType("standard");
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setQuote(null);
          if (serviceType === "express") {
            setServiceType("standard");
            setError(
              err instanceof ApiError
                ? err.message
                : "Express delivery is unavailable",
            );
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    location.confirmed,
    location.lat,
    location.lng,
    cart?.subtotal,
    serviceType,
  ]);

  function invalidatePaymentDraft() {
    setTxnId("");
    setAmountAck(false);
  }

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setError(`Could not copy ${label}`);
    }
  }

  async function changeQty(itemId: string, quantity: number) {
    setCartBusy(true);
    setError(null);
    try {
      if (quantity < 1) await removeItem(itemId);
      else await updateItem(itemId, quantity);
      invalidatePaymentDraft();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update cart");
    } finally {
      setCartBusy(false);
    }
  }

  const deliveryFee =
    location.confirmed && quote && !quote.pendingAdmin && quote.deliveryFee != null
      ? quote.deliveryFee
      : null;
  const grandTotal =
    deliveryFee != null ? (cart?.subtotal ?? 0) + deliveryFee : null;

  const bankOk = !isOtherBank || !!bankAccountId;
  const missing = useMemo(() => {
    const items: Array<{ id: string; message: string }> = [];
    if (!firstName.trim())
      items.push({ id: "firstName", message: "Please enter your first name." });
    if (!lastName.trim())
      items.push({ id: "lastName", message: "Please enter your last name." });
    if (!phoneValid)
      items.push({
        id: "phone",
        message: ETHIOPIAN_PHONE_ERROR,
      });
    if (!channel)
      items.push({
        id: "channel",
        message: "Please select a preferred communication method.",
      });
    if (!location.confirmed)
      items.push({
        id: "location",
        message: "Please confirm your delivery location.",
      });
    if (deliveryFee == null)
      items.push({
        id: "delivery",
        message: "Please select a delivery service (Standard or Express).",
      });
    if (!paymentMethodId)
      items.push({
        id: "payment",
        message: "Please select a payment method.",
      });
    if (isOtherBank && !bankAccountId)
      items.push({
        id: "bank",
        message: "Please select your bank.",
      });
    if (!txnValid)
      items.push({
        id: "txn",
        message: "Please enter your payment transaction reference ID.",
      });
    if (!amountAck)
      items.push({
        id: "ack",
        message: "Please confirm you paid the total payable amount.",
      });
    return items;
  }, [
    firstName,
    lastName,
    phoneValid,
    channel,
    location.confirmed,
    deliveryFee,
    paymentMethodId,
    isOtherBank,
    bankAccountId,
    txnValid,
    amountAck,
  ]);

  const canPlace =
    !!cart?.items.length &&
    missing.length === 0 &&
    bankOk &&
    !busy &&
    !cartBusy;

  useEffect(() => {
    if (!showErrors) return;
    if (missing.length === 0) setError(null);
    else setError(missing[0]?.message ?? null);
  }, [missing, showErrors]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setShowErrors(true);
    if (!canPlace) {
      const first = missing[0];
      setError(
        first
          ? first.message
          : "Complete the required information to place your order.",
      );
      if (first) {
        window.setTimeout(() => {
          const el = document.getElementById(`checkout-${first.id}`);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
          const focusable = el?.querySelector(
            "input, textarea, select, button",
          ) as HTMLElement | null;
          focusable?.focus({ preventScroll: true });
        }, 50);
      }
      return;
    }
    if (!consent && ["whatsapp", "telegram"].includes(channel)) {
      setError("Consent is required for messaging channels");
      return;
    }
    const phoneE164 = normalizeEthiopianPhone(phoneLocal);
    if (!phoneE164) {
      setError(ETHIOPIAN_PHONE_ERROR);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        recipientName,
        recipientPhone: phoneE164,
        addressText: location.addressText || location.formattedAddress,
        lng: location.lng,
        lat: location.lat,
        landmarkName: location.landmarkName ?? undefined,
        landmarkPlaceId: location.landmarkPlaceId ?? undefined,
        landmarkLng: location.landmarkLng ?? undefined,
        landmarkLat: location.landmarkLat ?? undefined,
        formattedAddress: location.formattedAddress,
        deliveryInstructions: location.deliveryInstructions || undefined,
        locationType: location.locationType,
        locationSource: location.locationSource,
        locationConfirmed: true,
        fulfillmentType: "local_delivery" as const,
        deliveryServiceType: serviceType,
        customerNote: note || undefined,
        idempotencyKey: crypto.randomUUID(),
        paymentMethodId,
        telebirrTxnId: isManualPay ? txnId.trim() : undefined,
        companyBankAccountId:
          isCbe || isOtherBank
            ? bankAccountId || cbeAccount?.id
            : undefined,
        amountAcknowledged: true,
        preferredContactChannel: channel,
        contactConsent: consent,
        priceListCode: (useWholesale && canWholesale
          ? "WHOLESALE-ETB"
          : "RETAIL-ETB") as "RETAIL-ETB" | "WHOLESALE-ETB",
        firstName,
        lastName,
      };

      const result =
        accessToken && user
          ? await api.checkoutAuth(accessToken, body)
          : await api.checkoutGuest(guestToken!, {
              ...body,
              asGuest: true,
            });

      await refresh();

      if (result.trackToken) {
        sessionStorage.setItem(
          `sabu_track_${result.orderNumber}`,
          result.trackToken,
        );
      }
      sessionStorage.setItem(
        `sabu_confirm_${result.orderNumber}`,
        JSON.stringify(result),
      );

      router.push(
        `/checkout/confirmation?orderNumber=${encodeURIComponent(result.orderNumber)}&track=${encodeURIComponent(result.trackToken ?? "")}&intentId=${encodeURIComponent(result.paymentIntentId ?? "")}&method=${encodeURIComponent(result.paymentMethodCode ?? "")}`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <main className="min-h-screen bg-sabu-paper px-6 pt-28">
        <p className="text-sabu-moss">Loading…</p>
      </main>
    );
  }

  if (!cart?.items.length) {
    return (
      <main className="min-h-screen bg-sabu-paper px-6 pt-28">
        <p className="text-sabu-moss">Cart is empty.</p>
        <Link href="/catalog" className="mt-4 inline-block text-sabu-leaf underline">
          Browse catalog
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-sabu-paper pt-28 pb-16">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 lg:grid-cols-2">
        <form onSubmit={onSubmit} className="space-y-4">
          <h1 className="font-[family-name:var(--font-syne)] text-4xl text-sabu-ink">
            Checkout
          </h1>
          <p className="text-sabu-moss">
            {isGuest
              ? "No account needed — place your order as a guest."
              : "Signed-in checkout with delivery across Ethiopia."}
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <label id="checkout-firstName" className="block text-sm text-sabu-moss">
              First name
              <input
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className={`mt-1 w-full border-b bg-transparent py-3 outline-none focus:border-sabu-leaf ${
                  showErrors && !firstName.trim()
                    ? "border-red-500"
                    : "border-sabu-moss/40"
                }`}
              />
              {showErrors && !firstName.trim() && (
                <span className="mt-1 block text-xs text-red-700">
                  Please enter your first name.
                </span>
              )}
            </label>
            <label id="checkout-lastName" className="block text-sm text-sabu-moss">
              Last name
              <input
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className={`mt-1 w-full border-b bg-transparent py-3 outline-none focus:border-sabu-leaf ${
                  showErrors && !lastName.trim()
                    ? "border-red-500"
                    : "border-sabu-moss/40"
                }`}
              />
              {showErrors && !lastName.trim() && (
                <span className="mt-1 block text-xs text-red-700">
                  Please enter your last name.
                </span>
              )}
            </label>
          </div>

          <label className="block text-sm text-sabu-moss">
            Recipient name
            <input
              required
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              className="mt-1 w-full border-b border-sabu-moss/40 bg-transparent py-3 outline-none focus:border-sabu-leaf"
            />
          </label>
          <div id="checkout-phone">
            <p className="text-sm text-sabu-moss">Phone number</p>
            <div
              className={`mt-1 flex items-stretch border-b ${
                showErrors && !phoneValid
                  ? "border-red-500"
                  : "border-sabu-moss/40"
              }`}
            >
              <span className="flex items-center bg-sabu-mist/20 px-3 py-3 text-sm font-medium text-sabu-ink">
                +251
              </span>
              <input
                required
                inputMode="numeric"
                autoComplete="tel-national"
                value={phoneLocal}
                onChange={(e) => {
                  const next = e.target.value.replace(/\D/g, "").slice(0, 9);
                  setPhoneLocal(next);
                }}
                placeholder="911123456"
                className="w-full bg-transparent px-3 py-3 text-sm text-sabu-ink outline-none"
                aria-label="Ethiopian mobile number without country code"
              />
            </div>
            {showErrors && !phoneValid && (
              <p className="mt-1 text-xs text-red-700">{ETHIOPIAN_PHONE_ERROR}</p>
            )}
            {phoneValid && (
              <p className="mt-1 text-xs text-sabu-moss">
                Will be saved as {recipientPhone}
              </p>
            )}
          </div>
          <div id="checkout-location">
            <DeliveryLocationPicker
              value={location}
              onChange={(next) => {
                setLocation(next);
                invalidatePaymentDraft();
              }}
            />
            {showErrors && !location.confirmed && (
              <p className="mt-2 text-xs text-red-700">
                Please confirm your delivery location.
              </p>
            )}
          </div>

          <fieldset
            id="checkout-delivery"
            className="space-y-3 border border-sabu-mist/60 p-4"
          >
            <legend className="px-1 text-sm text-sabu-moss">
              Delivery service
            </legend>
            {(quote?.services ?? [
              {
                code: "standard" as const,
                name: "Standard Delivery",
                enabled: true,
                available: true,
                unavailableReason: null,
              },
              {
                code: "express" as const,
                name: "Express Delivery",
                enabled: false,
                available: false,
                unavailableReason:
                  "Express pricing has not been configured by the administrator",
              },
            ]).map((s) => (
              <label
                key={s.code}
                className={`flex cursor-pointer items-start gap-3 border px-3 py-3 text-sm ${
                  serviceType === s.code
                    ? "border-sabu-leaf bg-sabu-leaf/5"
                    : "border-sabu-mist/60"
                } ${!s.available ? "opacity-60" : ""}`}
              >
                <input
                  type="radio"
                  name="deliveryService"
                  disabled={!s.available}
                  checked={serviceType === s.code}
                  onChange={() => {
                    setServiceType(s.code);
                    invalidatePaymentDraft();
                  }}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-sabu-ink">{s.name}</span>
                  {s.code === "standard" && (
                    <span className="mt-0.5 block text-xs text-sabu-moss">
                      Default option · lower cost · estimated arrival
                    </span>
                  )}
                  {s.code === "express" && (
                    <span className="mt-0.5 block text-xs text-sabu-moss">
                      Priority when available · estimated arrival only (not a
                      guarantee)
                    </span>
                  )}
                  {!s.available && s.unavailableReason && (
                    <span className="mt-1 block text-xs text-amber-800">
                      Unavailable: {s.unavailableReason}
                    </span>
                  )}
                </span>
              </label>
            ))}
            {location.confirmed && quote && !quote.pendingAdmin && (
              <div className="space-y-1 text-xs text-sabu-moss">
                {quote.etaWindowText && (
                  <p className="text-sabu-ink">
                    Estimated delivery: {quote.etaWindowText}
                  </p>
                )}
                <p>
                  {quote.etaDisclaimer ??
                    "Estimated delivery time may vary depending on traffic conditions, weather, driver availability, and other unexpected delays."}
                </p>
              </div>
            )}
            {showErrors && deliveryFee == null && (
              <p className="text-xs text-red-700">
                Please select a delivery service (Standard or Express).
              </p>
            )}
          </fieldset>

          <label className="block text-sm text-sabu-moss">
            Order note (optional)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full border-b border-sabu-moss/40 bg-transparent py-3 outline-none focus:border-sabu-leaf"
            />
          </label>

          <fieldset id="checkout-channel" className="space-y-2 pt-2">
            <legend className="text-sm text-sabu-moss">
              Preferred communication method
            </legend>
            {CHANNELS.map((c) => (
              <label
                key={c.value}
                className="flex cursor-pointer items-start gap-3 border border-sabu-mist/60 px-3 py-3 text-sm text-sabu-ink"
              >
                <input
                  type="radio"
                  name="channel"
                  className="mt-1"
                  checked={channel === c.value}
                  onChange={() => setChannel(c.value)}
                />
                <span>
                  <span className="font-medium">{c.label}</span>
                  <span className="mt-0.5 block text-xs text-sabu-moss">
                    {c.hint}
                  </span>
                </span>
              </label>
            ))}
            {["whatsapp", "telegram"].includes(channel) && (
              <label className="flex items-start gap-2 pt-1 text-xs text-sabu-moss">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  I consent to receive transactional order updates on {channel}.
                </span>
              </label>
            )}
          </fieldset>

          {canWholesale && (
            <label className="flex items-start gap-2 text-sm text-sabu-moss">
              <input
                type="checkbox"
                className="mt-1"
                checked={useWholesale}
                onChange={(e) => setUseWholesale(e.target.checked)}
              />
              <span>
                <span className="font-medium text-sabu-ink">
                  Buy in Bulk – Wholesale Pricing
                </span>
                <span className="mt-0.5 block text-xs">
                  Optional
                  {qualifiesWholesale
                    ? " · cart already qualifies at 10+"
                    : " · needs 10+ on bulk-enabled lines"}
                </span>
              </span>
            </label>
          )}

          <section
            id="checkout-payment"
            className="space-y-3 border border-sabu-mist/60 p-4"
          >
            <h2 className="font-[family-name:var(--font-syne)] text-xl text-sabu-ink">
              Payment
            </h2>
            <div className="space-y-1 text-sm text-sabu-moss">
              <p className="flex justify-between gap-3">
                <span>Products</span>
                <span className="text-sabu-ink">
                  {formatEtb(cart?.subtotal ?? 0)}
                </span>
              </p>
              <p className="flex justify-between gap-3">
                <span>Delivery</span>
                <span className="text-sabu-ink">
                  {deliveryFee != null
                    ? formatEtb(deliveryFee)
                    : !location.confirmed
                      ? "Confirm location"
                      : quote?.pendingAdmin
                        ? "Pending admin quote"
                        : "Calculating…"}
                </span>
              </p>
              <p className="flex justify-between gap-3 font-medium text-sabu-ink">
                <span>Total payable</span>
                <span>
                  {grandTotal != null
                    ? formatEtb(grandTotal)
                    : formatEtb(cart?.subtotal ?? 0) + " + delivery"}
                </span>
              </p>
              {grandTotal == null && (
                <p className="text-xs">
                  Confirm your delivery location above so Sabu can add the
                  distance-based delivery fee to your total.
                </p>
              )}
            </div>

            <div className="space-y-2">
              {methods.map((m) => (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-center gap-3 text-sm text-sabu-ink"
                >
                  <input
                    type="radio"
                    name="pay"
                    checked={paymentMethodId === m.id}
                    onChange={() => {
                      setPaymentMethodId(m.id);
                      setBankQuery("");
                      if (m.code !== "other_bank_manual") setBankAccountId("");
                      invalidatePaymentDraft();
                      setError(null);
                    }}
                  />
                  <span>{m.displayName}</span>
                </label>
              ))}
              {showErrors && !paymentMethodId && (
                <p className="text-xs text-red-700">
                  Please select a payment method.
                </p>
              )}
            </div>

            {isTelebirr && telebirr && (
              <div className="space-y-2 border border-sabu-mist/50 p-3 text-sm text-sabu-moss">
                <p>
                  <span className="text-sabu-ink">Payment method:</span> Telebirr
                </p>
                <p>
                  <span className="text-sabu-ink">Phone number:</span>{" "}
                  {telebirr.merchantAccount}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    copyText("phone", telebirr.merchantAccount)
                  }
                  className="border border-sabu-mist px-3 py-1.5 text-xs text-sabu-ink"
                >
                  {copied === "phone" ? "Copied" : "Copy phone number"}
                </button>
                <p>{telebirr.instructions}</p>
              </div>
            )}

            {isCbe && selectedBank && (
              <div className="space-y-2 border border-sabu-mist/50 p-3 text-sm text-sabu-moss">
                <p>
                  <span className="text-sabu-ink">Bank name:</span>{" "}
                  {selectedBank.bankName}
                </p>
                <p>
                  <span className="text-sabu-ink">Account name:</span>{" "}
                  {selectedBank.accountName}
                </p>
                <p>
                  <span className="text-sabu-ink">Account number:</span>{" "}
                  {selectedBank.accountNumber}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    copyText("account", selectedBank.accountNumber)
                  }
                  className="border border-sabu-mist px-3 py-1.5 text-xs text-sabu-ink"
                >
                  {copied === "account" ? "Copied" : "Copy account number"}
                </button>
                {selectedBank.instructions && <p>{selectedBank.instructions}</p>}
              </div>
            )}

            {isOtherBank && (
              <div id="checkout-bank" className="space-y-2">
                <label className="block text-sm text-sabu-moss">
                  Search bank
                  <input
                    value={bankQuery}
                    onChange={(e) => setBankQuery(e.target.value)}
                    placeholder="Type bank name…"
                    className="mt-1 w-full border-b border-sabu-moss/40 bg-transparent py-2 outline-none focus:border-sabu-leaf"
                  />
                </label>
                <ul className="max-h-40 overflow-y-auto border border-sabu-mist/50 text-sm">
                  {filteredOtherBanks.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setBankAccountId(b.id);
                          invalidatePaymentDraft();
                        }}
                        className={`flex w-full flex-col items-start px-3 py-2 text-left hover:bg-sabu-mist/20 ${
                          bankAccountId === b.id ? "bg-sabu-leaf/10" : ""
                        }`}
                      >
                        <span className="text-sabu-ink">{b.bankName}</span>
                        <span className="text-xs text-sabu-moss">
                          {b.accountName} · {b.accountNumber}
                        </span>
                      </button>
                    </li>
                  ))}
                  {filteredOtherBanks.length === 0 && (
                    <li className="px-3 py-2 text-xs text-sabu-moss">
                      No other banks configured yet — use CBE or Telebirr, or ask
                      admin to add banks.
                    </li>
                  )}
                </ul>
                {selectedBank && (
                  <div className="space-y-2 border border-sabu-mist/50 p-3 text-sm text-sabu-moss">
                    <p>
                      <span className="text-sabu-ink">Bank:</span>{" "}
                      {selectedBank.bankName}
                    </p>
                    <p>
                      <span className="text-sabu-ink">Account number:</span>{" "}
                      {selectedBank.accountNumber}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        copyText("account", selectedBank.accountNumber)
                      }
                      className="border border-sabu-mist px-3 py-1.5 text-xs text-sabu-ink"
                    >
                      {copied === "account" ? "Copied" : "Copy account number"}
                    </button>
                    {selectedBank.instructions && (
                      <p>{selectedBank.instructions}</p>
                    )}
                  </div>
                )}
                {showErrors && !bankAccountId && (
                  <p className="text-xs text-red-700">Please select your bank.</p>
                )}
              </div>
            )}

            {isManualPay && (
              <label id="checkout-txn" className="block text-sm text-sabu-moss">
                Payment transaction reference ID
                <input
                  value={txnId}
                  onChange={(e) => setTxnId(e.target.value)}
                  placeholder="e.g. TB123456789"
                  className={`mt-1 w-full border-b bg-transparent py-3 outline-none focus:border-sabu-leaf ${
                    showErrors && !txnValid
                      ? "border-red-500"
                      : "border-sabu-moss/40"
                  }`}
                />
                {showErrors && !txnValid && (
                  <span className="mt-1 block text-xs text-red-700">
                    Please enter your payment transaction reference ID.
                  </span>
                )}
              </label>
            )}

            <div id="checkout-ack">
              <label
                className={`flex items-start gap-2 text-sm text-sabu-moss ${
                  showErrors && !amountAck ? "text-red-800" : ""
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={amountAck}
                  onChange={(e) => {
                    setAmountAck(e.target.checked);
                    if (e.target.checked) setError(null);
                  }}
                  disabled={grandTotal == null}
                />
                <span>
                  I paid{" "}
                  <strong className="text-sabu-ink">
                    {grandTotal != null
                      ? formatEtb(grandTotal)
                      : "the total payable amount"}
                  </strong>{" "}
                  via {selectedMethod?.displayName ?? "the selected method"}.
                  Submitting a reference does not prove payment — Sabu will
                  verify before fulfillment.
                </span>
              </label>
              {showErrors && !amountAck && (
                <p className="mt-1 text-xs text-red-700">
                  Please confirm you paid the total payable amount.
                </p>
              )}
            </div>
          </section>

          {error && <p className="text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={busy || cartBusy || !cart?.items.length}
            className="mt-4 w-full bg-sabu-leaf px-5 py-3 text-sm text-sabu-cream hover:bg-sabu-forest disabled:opacity-60"
          >
            {busy ? "Placing order…" : "Place order"}
          </button>
        </form>

        <aside className="border-t border-sabu-mist/50 pt-6 lg:border-t-0 lg:pt-0">
          <h2 className="font-[family-name:var(--font-syne)] text-2xl text-sabu-ink">
            Your cart
          </h2>
          <ul className="mt-4 space-y-4 text-sm">
            {cart.items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-start justify-between gap-3 border-b border-sabu-mist/40 pb-3 text-sabu-moss"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sabu-ink">{item.productName}</p>
                  <p className="text-xs">
                    {formatEtb(item.unitPrice)} each
                  </p>
                  {"returnPolicyLabel" in item && item.returnPolicyLabel && (
                    <p
                      className={`mt-1 text-xs ${
                        item.returnsAllowed === false
                          ? "text-amber-800"
                          : "text-sabu-moss"
                      }`}
                    >
                      {item.returnPolicyLabel}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={cartBusy}
                      onClick={() => changeQty(item.id, item.quantity - 1)}
                      className="h-8 w-8 border border-sabu-mist text-sabu-ink"
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-sabu-ink">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      disabled={cartBusy}
                      onClick={() => changeQty(item.id, item.quantity + 1)}
                      className="h-8 w-8 border border-sabu-mist text-sabu-ink"
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      disabled={cartBusy}
                      onClick={() => changeQty(item.id, 0)}
                      className="ml-2 text-xs text-red-700 underline"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <span className="text-sabu-ink">{formatEtb(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6 space-y-2 border-t border-sabu-mist/50 pt-4 text-sm">
            <div className="flex justify-between text-sabu-moss">
              <span>Products subtotal</span>
              <span>{formatEtb(cart.subtotal)}</span>
            </div>
            {location.confirmed && quote ? (
              <>
                <div className="flex justify-between text-sabu-moss">
                  <span>Delivery service</span>
                  <span className="capitalize">{serviceType}</span>
                </div>
                <div className="flex justify-between text-sabu-moss">
                  <span>Delivery distance</span>
                  <span>
                    {quote.distanceKm != null
                      ? `${quote.distanceKm} km`
                      : "Pending"}
                  </span>
                </div>
                {quote.baseFare != null && (
                  <div className="flex justify-between text-sabu-moss">
                    <span>Base fare</span>
                    <span>{formatEtb(quote.baseFare)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sabu-moss">
                  <span>Distance rate</span>
                  <span>{quote.feePerKm} ETB/km</span>
                </div>
                <div className="flex justify-between text-sabu-moss">
                  <span>Delivery fee</span>
                  <span>
                    {quote.pendingAdmin || quote.deliveryFee == null
                      ? "Quote pending admin"
                      : formatEtb(quote.deliveryFee)}
                  </span>
                </div>
                {quote.etaWindowText && (
                  <p className="text-xs text-sabu-ink">{quote.etaWindowText}</p>
                )}
                <p className="text-xs text-sabu-moss">
                  {quote.etaDisclaimer ??
                    "Estimated delivery time may vary depending on traffic conditions, weather, driver availability, and other unexpected delays."}
                </p>
                {quote.message && (
                  <p className="text-xs text-sabu-moss">{quote.message}</p>
                )}
              </>
            ) : (
              <div className="flex justify-between text-sabu-moss">
                <span>Delivery fee</span>
                <span>Confirm location</span>
              </div>
            )}
            <div className="flex justify-between text-lg text-sabu-ink">
              <span>Total payable</span>
              <span>
                {grandTotal != null
                  ? formatEtb(grandTotal)
                  : `${formatEtb(cart.subtotal)} + delivery`}
              </span>
            </div>
            {grandTotal == null && (
              <p className="text-xs text-sabu-moss">
                Confirm delivery location to calculate the final total.
              </p>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
