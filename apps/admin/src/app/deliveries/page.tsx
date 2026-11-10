"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { loadSession } from "../../lib/session";

type QueueItem = Awaited<ReturnType<typeof adminApi.deliveryQueue>>[number];
type Driver = Awaited<ReturnType<typeof adminApi.deliveryDrivers>>[number];
type DeliveryDetail = Awaited<ReturnType<typeof adminApi.getDelivery>>;

export default function DeliveriesAdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DeliveryDetail | null>(null);
  const [driverId, setDriverId] = useState("");
  const [offerLink, setOfferLink] = useState<string | null>(null);
  const [whatsappPreview, setWhatsappPreview] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (accessToken: string) => {
    const [q, d] = await Promise.all([
      adminApi.deliveryQueue(accessToken),
      adminApi.deliveryDrivers(accessToken),
    ]);
    setQueue(q);
    setDrivers(d);
    setDriverId((prev) => prev || d[0]?.id || "");
  }, []);

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    refresh(s.accessToken).catch(() => undefined);
    const t = setInterval(() => {
      refresh(s.accessToken).catch(() => undefined);
    }, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  async function ensureDelivery(orderId: string, deliveryId: string | null) {
    if (!token) return;
    setBusy(true);
    setError(null);
    setOfferLink(null);
    setWhatsappPreview(null);
    try {
      let id = deliveryId;
      if (!id) {
        const created = await adminApi.createDelivery(token, orderId);
        id = created.id;
        setMessage(`Created ${created.deliveryNumber}`);
      }
      const d = await adminApi.getDelivery(token, id!);
      setDetail(d);
      setSelectedOrderId(orderId);
      await refresh(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendOffer() {
    if (!token || !detail || !driverId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.offerDelivery(token, detail.id, driverId);
      setOfferLink(res.offerLink);
      setWhatsappPreview(res.whatsappPreview);
      setMessage(
        `Offer sent (stub WhatsApp → ${res.driverPhone ?? "no phone"}). Expires ${new Date(res.expiresAt).toLocaleTimeString()}`,
      );
      const d = await adminApi.getDelivery(token, detail.id);
      setDetail(d);
      await refresh(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Offer failed");
    } finally {
      setBusy(false);
    }
  }

  async function reissue() {
    if (!token || !detail) return;
    try {
      const res = await adminApi.reissueVerification(token, detail.id);
      setMessage(`Reissued PIN ${res.pin} · QR ${res.qrToken.slice(0, 8)}…`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reissue failed");
    }
  }

  if (!token) {
    return (
      <main className="min-h-screen bg-[#0f1412] px-6 py-16 text-[#eef2ef]">
        <p>Sign in from the home page first.</p>
        <Link href="/" className="mt-4 inline-block text-[#8aa897]">
          ← Admin home
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0f1412] px-4 py-10 text-[#eef2ef] sm:px-6">
      <div className="mx-auto max-w-6xl">
        <Link href="/" className="text-sm text-[#8aa897]">
          ← Admin
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl tracking-tight">Delivery dispatch</h1>
            <p className="mt-1 text-sm text-[#9eb0a6]">
              Paid orders → create delivery → offer to driver via WhatsApp link.
              Auto-refreshes every 8s.
            </p>
          </div>
          <Link
            href="/drivers"
            className="border border-[#24302a] px-3 py-2 text-sm text-[#b7c7be]"
          >
            Manage drivers →
          </Link>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="border border-[#24302a]">
            <div className="border-b border-[#24302a] px-3 py-2 text-sm text-[#8aa897]">
              Dispatch queue
            </div>
            <ul className="max-h-[70vh] divide-y divide-[#24302a] overflow-y-auto">
              {queue.map((o) => (
                <li key={o.orderId} className="px-3 py-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{o.orderNumber}</p>
                      <p className="text-xs text-[#8aa897]">
                        {o.recipientName} · {o.address}
                      </p>
                      <p className="mt-1 text-xs text-[#b7c7be]">
                        {o.itemCount} items · {o.orderStatus} /{" "}
                        {o.deliveryStatus ?? "no delivery"}
                        {o.distanceKm != null ? ` · ~km later` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        ensureDelivery(o.orderId, o.deliveryId)
                      }
                      className="bg-[#2f6b4f] px-3 py-1.5 text-xs disabled:opacity-60"
                    >
                      {o.deliveryId ? "Open" : "Create delivery"}
                    </button>
                  </div>
                </li>
              ))}
              {queue.length === 0 && (
                <li className="px-3 py-6 text-sm text-[#8aa897]">
                  No paid local-delivery orders waiting.
                </li>
              )}
            </ul>
          </section>

          <section className="border border-[#24302a] p-4">
            {!detail ? (
              <p className="text-[#8aa897]">
                Select an order to create or manage its delivery.
              </p>
            ) : (
              <div className="space-y-4 text-sm">
                <div>
                  <h2 className="text-xl">{detail.deliveryNumber}</h2>
                  <p className="text-xs text-[#8aa897]">
                    Order {detail.orderNumber} · status {detail.status}
                  </p>
                  <p className="mt-2 text-[#b7c7be]">
                    {detail.recipientName} · {detail.recipientPhone}
                  </p>
                  <p className="text-[#b7c7be]">{detail.address}</p>
                  <p className="mt-1 text-xs text-[#8aa897]">
                    Pickup: {detail.warehouseName} ·{" "}
                    {detail.distanceKm != null
                      ? `${detail.distanceKm} km`
                      : "distance n/a"}{" "}
                    · ETA {detail.etaMinutes ?? "—"} min ·{" "}
                    {detail.packageCount} packages
                  </p>
                </div>

                <ul className="space-y-1 border-t border-[#24302a] pt-3 text-xs text-[#b7c7be]">
                  {detail.items.map((i, idx) => (
                    <li key={idx}>
                      {i.name} × {i.quantity}
                    </li>
                  ))}
                </ul>

                <div className="border-t border-[#24302a] pt-3">
                  <p className="text-xs text-[#8aa897]">Available drivers</p>
                  <select
                    value={driverId}
                    onChange={(e) => setDriverId(e.target.value)}
                    className="mt-2 w-full bg-[#17201c] px-3 py-2 text-sm"
                  >
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.code}) · {d.availability} · load{" "}
                        {d.activeDeliveries}
                      </option>
                    ))}
                  </select>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy || !driverId}
                      onClick={sendOffer}
                      className="bg-[#2f6b4f] px-4 py-2 text-sm disabled:opacity-60"
                    >
                      Send WhatsApp offer
                    </button>
                    <button
                      type="button"
                      onClick={reissue}
                      className="border border-[#24302a] px-3 py-2 text-sm"
                    >
                      Reissue QR/PIN
                    </button>
                  </div>
                </div>

                {detail.offers?.length > 0 && (
                  <div className="border-t border-[#24302a] pt-3">
                    <p className="text-xs text-[#8aa897]">Offer history</p>
                    <ul className="mt-2 space-y-1 text-xs">
                      {detail.offers.map((o) => (
                        <li key={o.id} className="text-[#b7c7be]">
                          {o.driverName} · {o.status}
                          {o.expiresAt
                            ? ` · exp ${new Date(o.expiresAt).toLocaleTimeString()}`
                            : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {offerLink && (
                  <div className="border border-[#2f6b4f]/40 bg-[#14201a] p-3 text-xs">
                    <p className="text-[#8aa897]">Secure driver link</p>
                    <a
                      href={offerLink}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block break-all text-[#9dcdb4] underline"
                    >
                      {offerLink}
                    </a>
                    {whatsappPreview && (
                      <pre className="mt-3 whitespace-pre-wrap text-[#b7c7be]">
                        {whatsappPreview}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}

            {message && (
              <p className="mt-4 text-sm text-[#2f6b4f]">{message}</p>
            )}
            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
            {selectedOrderId && (
              <p className="mt-2 text-[10px] text-[#5f7368]">
                Selected order {selectedOrderId}
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
