"use client";

import Link from "next/link";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OrderFeedbackForm } from "../../../components/order-feedback-form";
import { api, ApiError } from "../../../lib/api";
import { formatEtb } from "../../../lib/money";
import { formatLabel } from "../../../lib/format";
import {
  ETHIOPIAN_PHONE_ERROR,
  isValidEthiopianMobile,
  normalizeEthiopianPhone,
} from "../../../lib/phone";

function TrackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const orderNumberQ = params.get("orderNumber") ?? "";
  const tokenQ = params.get("token") ?? "";
  const [orderNumber, setOrderNumber] = useState(orderNumberQ);
  const [phoneLocal, setPhoneLocal] = useState("");
  const [data, setData] = useState<Awaited<
    ReturnType<typeof api.trackOrder>
  > | null>(null);
  const [delivery, setDelivery] = useState<Awaited<
    ReturnType<typeof api.trackDelivery>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const phoneValid = isValidEthiopianMobile(phoneLocal);
  const phoneE164 = normalizeEthiopianPhone(phoneLocal) ?? "";

  useEffect(() => {
    if (!orderNumberQ || !tokenQ) return;
    api
      .trackOrder(orderNumberQ, tokenQ)
      .then(async (order) => {
        setData(order);
        try {
          const d = await api.trackDelivery(orderNumberQ, tokenQ);
          setDelivery(d);
        } catch {
          setDelivery(null);
        }
      })
      .catch((err: Error) =>
        setError(err instanceof ApiError ? err.message : "Not found"),
      );
  }, [orderNumberQ, tokenQ]);

  function onLookup(e: FormEvent) {
    e.preventDefault();
    setShowErrors(true);
    if (!orderNumber.trim() || !phoneValid) return;
    setBusy(true);
    setError(null);
    api
      .recoverTrack(orderNumber.trim(), phoneE164)
      .then((res) => {
        sessionStorage.setItem(`sabu_track_${res.orderNumber}`, res.trackToken);
        router.push(
          `/orders/track?orderNumber=${encodeURIComponent(res.orderNumber)}&token=${encodeURIComponent(res.trackToken)}`,
        );
      })
      .catch((err: Error) =>
        setError(err instanceof ApiError ? err.message : "Lookup failed"),
      )
      .finally(() => setBusy(false));
  }

  if (!orderNumberQ || !tokenQ) {
    return (
      <main className="min-h-screen bg-sabu-paper pt-28 pb-16">
        <form onSubmit={onLookup} className="mx-auto max-w-md space-y-4 px-6">
          <h1 className="font-[family-name:var(--font-syne)] text-4xl text-sabu-ink">
            Track order
          </h1>
          <p className="text-sabu-moss">
            Enter your order number and the phone number used at checkout.
          </p>
          <label className="block text-sm text-sabu-moss">
            Order number
            <input
              required
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder="e.g. SABU-2026-000001"
              className="mt-1 w-full border-b border-sabu-moss/40 bg-transparent py-3 outline-none"
            />
          </label>
          <div>
            <p className="text-sm text-sabu-moss">Phone used at checkout</p>
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
                onChange={(e) =>
                  setPhoneLocal(e.target.value.replace(/\D/g, "").slice(0, 9))
                }
                placeholder="911123456"
                className="w-full bg-transparent px-3 py-3 text-sm outline-none"
                aria-label="Ethiopian mobile number without country code"
              />
            </div>
            {showErrors && !phoneValid && (
              <p className="mt-1 text-xs text-red-700">{ETHIOPIAN_PHONE_ERROR}</p>
            )}
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-sabu-leaf px-5 py-3 text-sm text-sabu-cream disabled:opacity-60"
          >
            {busy ? "Finding your order…" : "Find my order"}
          </button>
        </form>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-sabu-paper px-6 pt-28">
        <p className="text-red-700">{error}</p>
        <Link href="/orders/track" className="mt-4 inline-block text-sabu-leaf">
          Try again
        </Link>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-sabu-paper px-6 pt-28">
        <p className="text-sabu-moss">Loading order…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-sabu-paper pt-28 pb-16">
      <div className="mx-auto max-w-xl px-6">
        <h1 className="font-[family-name:var(--font-syne)] text-4xl text-sabu-ink">
          {data.orderNumber}
        </h1>
        <p className="mt-2 text-sabu-moss">
          Status: {formatLabel(data.status)} · Payment:{" "}
          {formatLabel(data.paymentStatus)}
        </p>
        {data.recipientName && (
          <p className="mt-1 text-sm text-sabu-ink">{data.recipientName}</p>
        )}
        {data.address && (
          <p className="text-sm text-sabu-moss">{data.address}</p>
        )}
        {data.paymentMethodDisplayName && (
          <p className="mt-1 text-sm text-sabu-moss">
            Payment method: {data.paymentMethodDisplayName}
          </p>
        )}
        <p className="mt-1 text-lg text-sabu-ink">
          {formatEtb(data.grandTotal)} {data.currency}
        </p>
        {(data.deliveryServiceType || data.deliveryEtaWindowText) && (
          <div className="mt-3 space-y-1 text-sm text-sabu-moss">
            {data.deliveryServiceType && (
              <p className="capitalize">
                Delivery service: {formatLabel(data.deliveryServiceType)}
              </p>
            )}
            {data.deliveryEtaWindowText && (
              <p className="text-sabu-ink">{data.deliveryEtaWindowText}</p>
            )}
            <p className="text-xs">
              {data.deliveryEtaDisclaimer ??
                "Estimated delivery time may vary depending on traffic conditions, weather, driver availability, and other unexpected delays."}
            </p>
          </div>
        )}
        {data.requiresManualContact && (
          <p className="mt-3 border border-sabu-mist/60 px-3 py-2 text-xs text-sabu-moss">
            You asked for phone updates. Our team will contact{" "}
            {data.recipientPhoneMasked ?? "your number"} after review.
          </p>
        )}

        {delivery && (
          <div className="mt-6 border border-sabu-mist/60 px-4 py-4">
            <p className="text-xs tracking-wide text-sabu-moss uppercase">
              Delivery {delivery.deliveryNumber}
            </p>
            <p className="mt-1 text-sm text-sabu-ink">
              Status: {formatLabel(delivery.status)}
              {delivery.etaMinutes != null
                ? ` · estimated ~${delivery.etaMinutes} min`
                : ""}
            </p>
            <p className="mt-1 text-xs text-sabu-moss">
              Estimated delivery time may vary depending on traffic conditions,
              weather, driver availability, and other unexpected delays.
            </p>
            {delivery.driverName && (
              <div className="mt-2 space-y-2">
                <p className="text-sm text-sabu-moss">
                  Driver: {delivery.driverName}
                  {delivery.driverPhone ? ` · ${delivery.driverPhone}` : ""}
                </p>
                {delivery.driverPhone && (
                  <a
                    href={`tel:${delivery.driverPhone}`}
                    className="inline-block border border-sabu-leaf px-3 py-2 text-xs text-sabu-leaf"
                  >
                    Call driver
                  </a>
                )}
              </div>
            )}
            {!delivery.verified && (delivery.pin || delivery.qrToken) && (
              <div className="mt-4 space-y-2">
                <p className="text-xs text-sabu-moss">
                  Show this to your driver for handoff verification
                </p>
                {delivery.pin && (
                  <p className="font-[family-name:var(--font-syne)] text-3xl tracking-widest text-sabu-ink">
                    PIN {delivery.pin}
                  </p>
                )}
                {delivery.qrToken && (
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(delivery.qrToken)}`}
                    alt="Delivery verification QR"
                    width={160}
                    height={160}
                    className="border border-sabu-mist/60 bg-white p-2"
                  />
                )}
              </div>
            )}
            {delivery.verified && (
              <p className="mt-2 text-sm text-sabu-leaf">
                Handoff verified
                {delivery.status === "delivered" ? " · delivered" : ""}
              </p>
            )}
          </div>
        )}

        <ul className="mt-8 divide-y divide-sabu-mist/50 border-t border-sabu-mist/50">
          {data.items.map((item, i) => (
            <li
              key={i}
              className="flex justify-between gap-3 py-3 text-sm text-sabu-moss"
            >
              <span>
                <span className="block text-sabu-ink">
                  {item.name} × {item.quantity}
                </span>
                {item.returnPolicyLabel && (
                  <span
                    className={`mt-1 block text-xs ${
                      item.returnsAllowed === false
                        ? "text-amber-800"
                        : "text-sabu-moss"
                    }`}
                  >
                    {item.returnPolicyLabel}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-sabu-ink">
                {formatEtb(item.lineTotal)}
              </span>
            </li>
          ))}
        </ul>

        {tokenQ && (
          <OrderFeedbackForm
            orderNumber={data.orderNumber}
            trackToken={tokenQ}
            initialFeedback={data.feedback ?? null}
            orderStatus={data.status}
          />
        )}
      </div>
    </main>
  );
}

export default function TrackPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-sabu-paper px-6 pt-28">
          <p className="text-sabu-moss">Loading…</p>
        </main>
      }
    >
      <TrackInner />
    </Suspense>
  );
}
