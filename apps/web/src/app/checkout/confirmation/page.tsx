"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiError, CheckoutResult } from "../../../lib/api";
import { formatEtb } from "../../../lib/money";

function ConfirmationInner() {
  const params = useSearchParams();
  const orderNumber = params.get("orderNumber") ?? "";
  const track = params.get("track") ?? "";
  const intentId = params.get("intentId") ?? "";
  const method = params.get("method") ?? "";

  const [snapshot, setSnapshot] = useState<CheckoutResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!orderNumber) return;
    try {
      const raw = sessionStorage.getItem(`sabu_confirm_${orderNumber}`);
      if (raw) setSnapshot(JSON.parse(raw) as CheckoutResult);
    } catch {
      /* ignore */
    }

    const token =
      track ||
      (typeof window !== "undefined"
        ? sessionStorage.getItem(`sabu_track_${orderNumber}`)
        : null);
    if (!token) return;

    api
      .trackOrder(orderNumber, token)
      .then((live) => {
        setSnapshot((prev) => ({
          orderId: prev?.orderId ?? live.orderId ?? "",
          orderNumber: live.orderNumber,
          status: live.status,
          paymentStatus: live.paymentStatus,
          subtotal: live.subtotal ?? prev?.subtotal,
          deliveryFee: live.deliveryFee ?? prev?.deliveryFee,
          grandTotal: live.grandTotal,
          currency: live.currency,
          paymentIntentId: prev?.paymentIntentId ?? (intentId || null),
          paymentMethodCode: live.paymentMethodCode ?? prev?.paymentMethodCode ?? method,
          paymentMethodDisplayName:
            live.paymentMethodDisplayName ?? prev?.paymentMethodDisplayName,
          preferredContactChannel:
            live.preferredContactChannel ?? prev?.preferredContactChannel,
          requiresManualContact:
            live.requiresManualContact ?? prev?.requiresManualContact,
          recipientName: live.recipientName ?? prev?.recipientName,
          recipientPhone: prev?.recipientPhone,
          addressText: live.address ?? prev?.addressText,
          fulfillmentType: live.fulfillmentType ?? prev?.fulfillmentType,
          estimatedDeliveryAt:
            live.estimatedDeliveryAt ?? prev?.estimatedDeliveryAt ?? null,
          trackingUrl: live.trackingUrl ?? prev?.trackingUrl,
          trackToken: token,
          items: live.items ?? prev?.items,
          confirmationMessage: prev?.confirmationMessage,
          replayed: prev?.replayed ?? false,
        }));
      })
      .catch((err: Error) => {
        if (!snapshot) {
          setError(err instanceof ApiError ? err.message : "Order not found");
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNumber, track, intentId, method]);

  const trackingUrl = useMemo(() => {
    if (snapshot?.trackingUrl) return snapshot.trackingUrl;
    if (!orderNumber || !track) return "";
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/orders/track?orderNumber=${encodeURIComponent(orderNumber)}&token=${encodeURIComponent(track)}`;
  }, [snapshot?.trackingUrl, orderNumber, track]);

  const qrSrc = trackingUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(trackingUrl)}`
    : null;

  async function copyText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  function saveDetails() {
    if (!snapshot) return;
    const lines = [
      "Sabu Online Shopping — Order confirmation",
      `Order: ${snapshot.orderNumber}`,
      `Customer: ${snapshot.recipientName ?? ""}`,
      `Phone: ${snapshot.recipientPhone ?? ""}`,
      `Status: ${snapshot.status} / payment ${snapshot.paymentStatus}`,
      `Payment: ${snapshot.paymentMethodDisplayName ?? snapshot.paymentMethodCode ?? ""}`,
      `Address: ${snapshot.addressText ?? ""}`,
      `Total: ${snapshot.grandTotal} ${snapshot.currency ?? "ETB"}`,
      "",
      "Items:",
      ...(snapshot.items ?? []).map(
        (i) => `- ${i.name} × ${i.quantity} = ${i.lineTotal}`,
      ),
      "",
      `Tracking: ${trackingUrl}`,
      "",
      snapshot.confirmationMessage ?? "",
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${snapshot.orderNumber}-confirmation.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!orderNumber) {
    return (
      <main className="min-h-screen bg-sabu-paper px-6 pt-28">
        <p className="text-sabu-moss">Missing order reference.</p>
        <Link href="/catalog" className="mt-4 inline-block text-sabu-leaf">
          Browse catalog
        </Link>
      </main>
    );
  }

  if (error && !snapshot) {
    return (
      <main className="min-h-screen bg-sabu-paper px-6 pt-28">
        <p className="text-red-700">{error}</p>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="min-h-screen bg-sabu-paper px-6 pt-28">
        <p className="text-sabu-moss">Loading confirmation…</p>
      </main>
    );
  }

  const message =
    snapshot.confirmationMessage ??
    (snapshot.requiresManualContact
      ? `Thank you for shopping with Sabu Online Shopping!\n\nYour order #${snapshot.orderNumber} has been received successfully.\n\nOur administration team will contact you using the phone number you provided once your order has been reviewed and processed.\n\nPlease keep your phone available for further updates.`
      : `Thank you for shopping with Sabu Online Shopping!\n\nYour order #${snapshot.orderNumber} has been received successfully.\n\nWe are currently processing your order. You can use your order number and secure tracking link to check its status.\n\nWe appreciate your business and look forward to serving you!`);

  return (
    <main className="min-h-screen bg-sabu-paper pt-28 pb-16">
      <div className="mx-auto max-w-2xl px-6">
        <p className="text-xs tracking-[0.2em] text-sabu-moss uppercase">
          Order received successfully
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-syne)] text-4xl text-sabu-ink">
          {snapshot.orderNumber}
        </h1>
        <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-sabu-moss">
          {message}
        </p>

        <div className="mt-8 space-y-3 border-t border-sabu-mist/50 pt-6 text-sm">
          <Row label="Customer" value={snapshot.recipientName ?? "—"} />
          <Row
            label="Payment"
            value={`${snapshot.paymentMethodDisplayName ?? snapshot.paymentMethodCode ?? "—"} · ${snapshot.paymentStatus ?? "unpaid"}`}
          />
          <Row label="Order status" value={snapshot.status} />
          <Row
            label="Delivery"
            value={
              snapshot.fulfillmentType === "store_pickup"
                ? "Store pickup"
                : (snapshot.addressText ?? "—")
            }
          />
          {snapshot.estimatedDeliveryAt && (
            <Row
              label="Estimated delivery"
              value={new Date(snapshot.estimatedDeliveryAt).toLocaleString()}
            />
          )}
          <Row
            label="Updates via"
            value={
              snapshot.requiresManualContact
                ? `${snapshot.preferredContactChannel ?? "phone"} (admin will contact you)`
                : (snapshot.preferredContactChannel ?? "—")
            }
          />
          <Row
            label="Total"
            value={`${formatEtb(snapshot.grandTotal)} ${snapshot.currency ?? "ETB"}`}
          />
        </div>

        <ul className="mt-6 divide-y divide-sabu-mist/50 border-t border-sabu-mist/50">
          {(snapshot.items ?? []).map((item, i) => (
            <li
              key={i}
              className="flex justify-between gap-4 py-3 text-sm text-sabu-moss"
            >
              <span>
                {item.name} × {item.quantity}
              </span>
              <span className="text-sabu-ink">{formatEtb(item.lineTotal)}</span>
            </li>
          ))}
        </ul>

        {qrSrc && (
          <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            {/* Tracking QR — delivery verification PIN/QR appears later on the track page */}
            <img
              src={qrSrc}
              alt="Order tracking QR code"
              width={180}
              height={180}
              className="border border-sabu-mist/60 bg-white p-2"
            />
            <p className="max-w-xs text-xs text-sabu-moss">
              Scan to open your secure tracking page. Delivery handoff QR/PIN
              will appear here once a driver is assigned.
            </p>
          </div>
        )}

        <div className="mt-8 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => copyText("order", snapshot.orderNumber)}
            className="border border-sabu-moss/40 px-4 py-2 text-sm text-sabu-ink"
          >
            {copied === "order" ? "Copied" : "Copy order number"}
          </button>
          {trackingUrl && (
            <button
              type="button"
              onClick={() => copyText("link", trackingUrl)}
              className="border border-sabu-moss/40 px-4 py-2 text-sm text-sabu-ink"
            >
              {copied === "link" ? "Copied" : "Copy tracking link"}
            </button>
          )}
          <button
            type="button"
            onClick={saveDetails}
            className="border border-sabu-moss/40 px-4 py-2 text-sm text-sabu-ink"
          >
            Save order details
          </button>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {(intentId || snapshot.paymentIntentId) &&
            snapshot.paymentStatus !== "paid" && (
              <Link
                href={`/checkout/pay?orderId=${snapshot.orderId}&orderNumber=${encodeURIComponent(snapshot.orderNumber)}&intentId=${encodeURIComponent(intentId || snapshot.paymentIntentId || "")}&method=${encodeURIComponent(method || snapshot.paymentMethodCode || "")}&track=${encodeURIComponent(track || snapshot.trackToken || "")}`}
                className="bg-sabu-leaf px-5 py-3 text-sm text-sabu-cream hover:bg-sabu-forest"
              >
                Continue to payment
              </Link>
            )}
          {trackingUrl && (
            <Link
              href={`/orders/track?orderNumber=${encodeURIComponent(snapshot.orderNumber)}&token=${encodeURIComponent(track || snapshot.trackToken || "")}`}
              className="border border-sabu-leaf px-5 py-3 text-sm text-sabu-leaf"
            >
              Track order
            </Link>
          )}
          <Link
            href="/catalog"
            className="px-5 py-3 text-sm text-sabu-moss underline"
          >
            Keep shopping
          </Link>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6">
      <span className="text-sabu-moss">{label}</span>
      <span className="text-right text-sabu-ink">{value}</span>
    </div>
  );
}

export default function ConfirmationPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-sabu-paper px-6 pt-28">
          <p className="text-sabu-moss">Loading…</p>
        </main>
      }
    >
      <ConfirmationInner />
    </Suspense>
  );
}
