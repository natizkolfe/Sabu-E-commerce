"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, ContactChannel } from "../../lib/api";
import { useAuth } from "../../context/auth-context";
import { useCart } from "../../context/cart-context";
import { formatEtb } from "../../lib/money";

type PayMethod = Awaited<ReturnType<typeof api.listPaymentMethods>>[number];

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
  const { cart, refresh, isGuest, guestToken } = useCart();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("+251");
  const [addressText, setAddressText] = useState("Bole, Addis Ababa");
  const [note, setNote] = useState("");
  const [channel, setChannel] = useState<ContactChannel>("whatsapp");
  const [consent, setConsent] = useState(true);
  const [methods, setMethods] = useState<PayMethod[]>([]);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [useWholesale, setUseWholesale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canWholesale = useMemo(
    () => cart?.items.some((i) => i.bulkEnabled) ?? false,
    [cart],
  );
  const qualifiesWholesale = useMemo(
    () => cart?.items.some((i) => i.bulkEnabled && i.quantity >= 10) ?? false,
    [cart],
  );

  useEffect(() => {
    if (qualifiesWholesale) setUseWholesale(true);
  }, [qualifiesWholesale]);

  useEffect(() => {
    api.listPaymentMethods().then((m) => {
      setMethods(m);
      setPaymentMethodId(m[0]?.id ?? "");
    });
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!paymentMethodId) {
      setError("Select a payment method");
      return;
    }
    if (!firstName.trim() || !lastName.trim()) {
      setError("First and last name are required");
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
        addressText,
        lng: 38.789,
        lat: 8.9806,
        fulfillmentType: "local_delivery" as const,
        customerNote: note || undefined,
        idempotencyKey: crypto.randomUUID(),
        paymentMethodId,
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

  const deliveryFee = 150;
  const grandTotal = (cart.subtotal ?? 0) + deliveryFee;

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
          <label className="block text-sm text-sabu-moss">
            Delivery address
            <textarea
              required
              value={addressText}
              onChange={(e) => setAddressText(e.target.value)}
              rows={3}
              className="mt-1 w-full border border-sabu-mist bg-transparent px-3 py-3 outline-none focus:border-sabu-leaf"
            />
          </label>
          <label className="block text-sm text-sabu-moss">
            Note (optional)
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
                  You can still complete checkout without messaging apps by
                  choosing Phone call.
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

          <fieldset className="space-y-2 pt-2">
            <legend className="text-sm text-sabu-moss">Payment method</legend>
            {methods.map((m) => (
              <label
                key={m.id}
                className="flex cursor-pointer items-center gap-3 border border-sabu-mist/60 px-3 py-3 text-sm text-sabu-ink"
              >
                <input
                  type="radio"
                  name="pay"
                  checked={paymentMethodId === m.id}
                  onChange={() => setPaymentMethodId(m.id)}
                />
                <span>
                  {m.displayName}
                  <span className="ml-2 text-sabu-moss">({m.channel})</span>
                </span>
              </label>
            ))}
          </fieldset>

          {error && <p className="text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="mt-4 w-full bg-sabu-leaf px-5 py-3 text-sm text-sabu-cream hover:bg-sabu-forest disabled:opacity-60"
          >
            {busy ? "Placing order…" : "Place order"}
          </button>
        </form>

        <aside className="border-t border-sabu-mist/50 pt-6 lg:border-t-0 lg:pt-0">
          <h2 className="font-[family-name:var(--font-syne)] text-2xl text-sabu-ink">
            Summary
          </h2>
          <ul className="mt-4 space-y-3 text-sm">
            {cart.items.map((item) => (
              <li key={item.id} className="flex justify-between gap-4 text-sabu-moss">
                <span>
                  {item.productName} × {item.quantity}
                </span>
                <span className="text-sabu-ink">{formatEtb(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6 space-y-2 border-t border-sabu-mist/50 pt-4 text-sm">
            <div className="flex justify-between text-sabu-moss">
              <span>Subtotal</span>
              <span>{formatEtb(cart.subtotal)}</span>
            </div>
            <div className="flex justify-between text-sabu-moss">
              <span>Delivery</span>
              <span>{formatEtb(deliveryFee)}</span>
            </div>
            <div className="flex justify-between text-lg text-sabu-ink">
              <span>Total</span>
              <span>{formatEtb(grandTotal)}</span>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
