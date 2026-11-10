"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "http://localhost:3001/v1";

type Dashboard = {
  orderNumber: string;
  deliveryNumber: string;
  deliveryStatus: string;
  verified: boolean;
  packageCount: number;
  distanceKm: number | null;
  etaMinutes: number | null;
  instructions?: string | null;
  landmarkName?: string | null;
  locationType?: string | null;
  recipientPhone?: string | null;
  googleMapsUrl?: string | null;
  pickup: { name: string; address: string | null };
  dropoff: {
    name: string;
    address: string;
    lng?: number | null;
    lat?: number | null;
  };
  items: Array<{ name: string; sku: string | null; quantity: number }>;
};

function DeliveryInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [data, setData] = useState<Dashboard | null>(null);
  const [pin, setPin] = useState("");
  const [qrToken, setQrToken] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch(
      `${API_URL}/delivery/driver/dashboard?token=${encodeURIComponent(token)}`,
    );
    const body = await res.json();
    if (!res.ok) throw new Error(body.message ?? "Failed");
    setData(body);
  }

  useEffect(() => {
    if (!token) {
      setError("Missing token");
      return;
    }
    load().catch((err: Error) => setError(err.message));
  }, [token]);

  async function verifyPin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/delivery/driver/verify-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, pin }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Verify failed");
      setMessage(`Verified via PIN · ${body.items?.length ?? 0} lines`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verify failed");
    } finally {
      setBusy(false);
    }
  }

  async function verifyQr(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/delivery/driver/verify-qr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, qrToken }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Verify failed");
      setMessage(`Verified via QR · ${body.items?.length ?? 0} lines`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verify failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/delivery/driver/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Confirm failed");
      setMessage("Delivery confirmed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) {
    return (
      <main className="min-h-screen bg-[#0f1412] px-4 py-10 text-[#8aa897]">
        Loading delivery…
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-[#0f1412] px-4 py-10 text-red-400">
        {error}
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-md bg-[#0f1412] px-4 py-8 text-[#eef2ef]">
      <p className="text-[11px] tracking-[0.2em] text-[#8aa897] uppercase">
        Active delivery
      </p>
      <h1 className="mt-2 text-2xl">#{data.orderNumber}</h1>
      <p className="text-sm text-[#9eb0a6]">
        {data.deliveryNumber} · {data.deliveryStatus}
        {data.verified ? " · verified" : ""}
      </p>

      <div className="mt-5 space-y-3 border border-[#24302a] p-4 text-sm">
        <div>
          <p className="text-[11px] text-[#8aa897] uppercase">Pickup</p>
          <p>{data.pickup.name}</p>
          <p className="text-[#9eb0a6]">{data.pickup.address}</p>
        </div>
        <div>
          <p className="text-[11px] text-[#8aa897] uppercase">Drop-off</p>
          <p>{data.dropoff.name}</p>
          <p className="text-[#9eb0a6]">{data.dropoff.address}</p>
          {data.landmarkName && (
            <p className="mt-1 text-[#9dcdb4]">
              Nearest landmark: {data.landmarkName}
              {data.locationType === "landmark_nearby"
                ? " (reference — not always the door)"
                : ""}
            </p>
          )}
          {data.instructions && (
            <p className="mt-1 text-[#b7c7be]">
              Instructions: {data.instructions}
            </p>
          )}
          {data.dropoff.lat != null && data.dropoff.lng != null && (
            <p className="mt-1 text-[11px] text-[#8aa897]">
              {data.dropoff.lat.toFixed(5)}, {data.dropoff.lng.toFixed(5)}
            </p>
          )}
        </div>
        <p className="text-[#b7c7be]">
          {data.distanceKm ?? "—"} km · ETA {data.etaMinutes ?? "—"} min ·{" "}
          {data.packageCount} packages
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {data.googleMapsUrl && (
            <a
              href={data.googleMapsUrl}
              target="_blank"
              rel="noreferrer"
              className="bg-[#2f6b4f] px-3 py-2 text-xs"
            >
              Open in Google Maps
            </a>
          )}
          {data.googleMapsUrl && (
            <a
              href={data.googleMapsUrl}
              target="_blank"
              rel="noreferrer"
              className="border border-[#24302a] px-3 py-2 text-xs"
            >
              Navigate to destination
            </a>
          )}
          {data.recipientPhone && (
            <a
              href={`tel:${data.recipientPhone}`}
              className="border border-[#24302a] px-3 py-2 text-xs"
            >
              Call customer
            </a>
          )}
        </div>
      </div>

      <ul className="mt-4 space-y-1 text-sm text-[#b7c7be]">
        {data.items.map((i, idx) => (
          <li key={idx}>
            {i.name} × {i.quantity}
          </li>
        ))}
      </ul>

      {data.deliveryStatus !== "delivered" && (
        <div className="mt-6 space-y-4">
          {!data.verified && (
            <>
              <form onSubmit={verifyPin} className="space-y-2">
                <p className="text-xs text-[#8aa897]">Verify with customer PIN</p>
                <input
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="6-digit PIN"
                  className="w-full bg-[#17201c] px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full border border-[#24302a] px-3 py-2 text-sm"
                >
                  Verify PIN
                </button>
              </form>
              <form onSubmit={verifyQr} className="space-y-2">
                <p className="text-xs text-[#8aa897]">
                  Or paste QR token from customer screen
                </p>
                <input
                  value={qrToken}
                  onChange={(e) => setQrToken(e.target.value)}
                  placeholder="QR token"
                  className="w-full bg-[#17201c] px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full border border-[#24302a] px-3 py-2 text-sm"
                >
                  Verify QR
                </button>
              </form>
            </>
          )}
          <button
            type="button"
            disabled={busy || !data.verified}
            onClick={confirm}
            className="w-full bg-[#2f6b4f] px-4 py-3 text-sm font-medium disabled:opacity-50"
          >
            CONFIRM DELIVERY
          </button>
        </div>
      )}

      {message && <p className="mt-4 text-sm text-[#2f6b4f]">{message}</p>}
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
    </main>
  );
}

export default function DriverDeliveryPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#0f1412] px-4 py-10 text-[#8aa897]">
          Loading…
        </main>
      }
    >
      <DeliveryInner />
    </Suspense>
  );
}
