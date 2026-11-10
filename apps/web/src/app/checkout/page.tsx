"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, ContactChannel } from "../../lib/api";
import { useAuth } from "../../context/auth-context";
import { useCart } from "../../context/cart-context";
import { formatEtb } from "../../lib/money";
import {
  DeliveryLocationPicker,
  type DeliveryLocationValue,
} from "../../components/DeliveryLocationPicker";

type PayMethod = Awaited<ReturnType<typeof api.listPaymentMethods>>[number];
type TelebirrSettings = Awaited<ReturnType<typeof api.telebirrSettings>>;
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
      hint: "Requires Telegram linking when enabled",
    },
    {
      value: "viber",
      label: "Viber",
      hint: "Requires Viber linking when enabled",
    },
    {
      value: "phone",
      label: "Phone call",
      hint: "Our team will call the number you provide",
    },
    {
      value: "sms",
      label: "SMS",
      hint: "Text updates when SMS is configured",
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
  const [recipientPhone, setRecipientPhone] = useState("+251");
  const [note, setNote] = useState("");
  const [channel, setChannel] = useState<ContactChannel>("whatsapp");
  const [consent, setConsent] = useState(true);
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
  const [paymentMethodId, setPaymentMethodId] = useState("");
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
  const isTelebirr = selectedMethod?.code === "telebirr_manual";

  const txnValid = useMemo(() => {
    if (!isTelebirr) return true;
    const trimmed = txnId.trim();
    if (!trimmed) return false;
    const regex = telebirr?.txnFormatRegex ?? "^[A-Za-z0-9\\-]{6,40}$";
    try {
      return new RegExp(regex).test(trimmed);
    } catch {
      return /^[A-Za-z0-9-]{6,40}$/.test(trimmed);
    }
  }, [isTelebirr, txnId, telebirr]);

  useEffect(() => {
    if (qualifiesWholesale) setUseWholesale(true);
  }, [qualifiesWholesale]);

  useEffect(() => {
    api.listPaymentMethods().then((m) => {
      setMethods(m);
      const tb = m.find((x) => x.code === "telebirr_manual");
      setPaymentMethodId(tb?.id ?? m[0]?.id ?? "");
    });
    api.telebirrSettings().then(setTelebirr).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (user) {
      setRecipientName(user.fullName);
      setRecipientPhone(user.phone ?? "+251");
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

  const canPlace =
    !!cart?.items.length &&
    !!firstName.trim() &&
    !!lastName.trim() &&
    !!recipientPhone &&
    location.confirmed &&
    deliveryFee != null &&
    amountAck &&
    !!paymentMethodId &&
    txnValid &&
    !busy &&
    !cartBusy;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canPlace) {
      setError("Complete all required fields before placing the order");
      return;
    }
    if (!consent && ["whatsapp", "telegram", "viber"].includes(channel)) {
      setError("Consent is required for messaging channels");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        recipientName,
        recipientPhone,
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
        telebirrTxnId: isTelebirr ? txnId.trim() : undefined,
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
            <label className="block text-sm text-sabu-moss">
              First name
              <input
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="mt-1 w-full border-b border-sabu-moss/40 bg-transparent py-3 outline-none focus:border-sabu-leaf"
              />
            </label>
            <label className="block text-sm text-sabu-moss">
              Last name
              <input
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="mt-1 w-full border-b border-sabu-moss/40 bg-transparent py-3 outline-none focus:border-sabu-leaf"
              />
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
          <label className="block text-sm text-sabu-moss">
            Phone (E.164)
            <input
              required
              value={recipientPhone}
              onChange={(e) => setRecipientPhone(e.target.value)}
              placeholder="+2519..."
              className="mt-1 w-full border-b border-sabu-moss/40 bg-transparent py-3 outline-none focus:border-sabu-leaf"
            />
          </label>
          <DeliveryLocationPicker
            value={location}
            onChange={(next) => {
              setLocation(next);
              invalidatePaymentDraft();
            }}
          />

          <fieldset className="space-y-3 border border-sabu-mist/60 p-4">
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
          </fieldset>

          <label className="block text-sm text-sabu-moss">
            Order note (optional)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full border-b border-sabu-moss/40 bg-transparent py-3 outline-none focus:border-sabu-leaf"
            />
          </label>

          <fieldset className="space-y-2 pt-2">
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
            {["whatsapp", "telegram", "viber"].includes(channel) && (
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
                Apply wholesale tier pricing
                {qualifiesWholesale
                  ? " (cart already qualifies at 10+)"
                  : " (needs 10+ on bulk lines)"}
              </span>
            </label>
          )}

          <section className="space-y-3 border border-sabu-mist/60 p-4">
            <h2 className="font-[family-name:var(--font-syne)] text-xl text-sabu-ink">
              Telebirr payment
            </h2>
            {telebirr && (
              <div className="space-y-1 text-sm text-sabu-moss">
                <p>
                  Pay{" "}
                  <span className="font-medium text-sabu-ink">
                    {grandTotal != null ? formatEtb(grandTotal) : "—"}
                  </span>{" "}
                  to <span className="text-sabu-ink">{telebirr.displayName}</span>
                </p>
                <p>
                  Merchant:{" "}
                  <span className="font-medium text-sabu-ink">
                    {telebirr.merchantAccount}
                  </span>
                </p>
                <p>{telebirr.instructions}</p>
                {telebirr.helpText && (
                  <p className="text-xs">{telebirr.helpText}</p>
                )}
              </div>
            )}
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
                    invalidatePaymentDraft();
                  }}
                />
                <span>{m.displayName}</span>
              </label>
            ))}
            {isTelebirr && (
              <label className="block text-sm text-sabu-moss">
                Telebirr transaction ID
                <input
                  value={txnId}
                  onChange={(e) => setTxnId(e.target.value)}
                  placeholder="e.g. TB123456789"
                  className="mt-1 w-full border-b border-sabu-moss/40 bg-transparent py-3 outline-none focus:border-sabu-leaf"
                />
                {txnId && !txnValid && (
                  <span className="mt-1 block text-xs text-red-700">
                    Enter a valid transaction reference
                  </span>
                )}
              </label>
            )}
            <label className="flex items-start gap-2 text-sm text-sabu-moss">
              <input
                type="checkbox"
                className="mt-1"
                checked={amountAck}
                onChange={(e) => setAmountAck(e.target.checked)}
                disabled={grandTotal == null}
              />
              <span>
                I paid{" "}
                <strong className="text-sabu-ink">
                  {grandTotal != null ? formatEtb(grandTotal) : "—"}
                </strong>{" "}
                via Telebirr. Submitting a reference does not prove payment —
                Sabu will verify before fulfillment.
              </span>
            </label>
          </section>

          {error && <p className="text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={!canPlace}
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
              <span>{grandTotal != null ? formatEtb(grandTotal) : "—"}</span>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
