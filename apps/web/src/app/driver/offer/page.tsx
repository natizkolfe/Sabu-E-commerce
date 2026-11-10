"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "http://localhost:3001/v1";

type Offer = {
  assignmentId: string;
  status: string;
  expired: boolean;
  orderNumber: string;
  deliveryNumber: string;
  packageCount: number;
  distanceKm: number | null;
  etaMinutes: number | null;
  instructions: string | null;
  pickup: { name: string; address: string | null };
  dropoff: { name: string; address: string };
};

function OfferInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [offer, setOffer] = useState<Offer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!token) {
      setError("Missing assignment token");
      return;
    }
    fetch(`${API_URL}/delivery/offers?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.message ?? "Not found");
        setOffer(body);
      })
      .catch((err: Error) => setError(err.message));
  }, [token]);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/delivery/offers/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Accept failed");
      router.push(`/driver/delivery?token=${encodeURIComponent(token)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Accept failed");
    } finally {
      setBusy(false);
    }
  }

  async function decline(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/delivery/offers/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, reason: reason || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Decline failed");
      setOffer((o) => (o ? { ...o, status: "rejected" } : o));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Decline failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !offer) {
    return (
      <main className="mx-auto min-h-screen max-w-md bg-[#0f1412] px-4 py-10 text-[#eef2ef]">
        <p className="text-red-400">{error}</p>
      </main>
    );
  }

  if (!offer) {
    return (
      <main className="mx-auto min-h-screen max-w-md bg-[#0f1412] px-4 py-10 text-[#eef2ef]">
        <p className="text-[#8aa897]">Loading assignment…</p>
      </main>
    );
  }

  const canRespond = offer.status === "offered" && !offer.expired;

  return (
    <main className="mx-auto min-h-screen max-w-md bg-[#0f1412] px-4 py-8 text-[#eef2ef]">
      <p className="text-[11px] tracking-[0.2em] text-[#8aa897] uppercase">
        Sabu driver
      </p>
      <h1 className="mt-2 text-2xl font-medium">Delivery request</h1>
      <p className="mt-1 text-sm text-[#9eb0a6]">
        Order #{offer.orderNumber} · {offer.deliveryNumber}
      </p>

      <div className="mt-6 space-y-3 rounded border border-[#24302a] p-4 text-sm">
        <div>
          <p className="text-[11px] text-[#8aa897] uppercase">Pickup</p>
          <p className="mt-1">{offer.pickup.name}</p>
          <p className="text-[#9eb0a6]">{offer.pickup.address}</p>
        </div>
        <div>
          <p className="text-[11px] text-[#8aa897] uppercase">Destination</p>
          <p className="mt-1">{offer.dropoff.name}</p>
          <p className="text-[#9eb0a6]">{offer.dropoff.address}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-[#b7c7be]">
          <p>Packages: {offer.packageCount}</p>
          <p>Distance: {offer.distanceKm ?? "—"} km</p>
          <p>ETA: {offer.etaMinutes ?? "—"} min</p>
          <p>Status: {offer.expired ? "expired" : offer.status}</p>
        </div>
        {offer.instructions && (
          <p className="text-[#9eb0a6]">Note: {offer.instructions}</p>
        )}
      </div>

      {canRespond ? (
        <div className="mt-6 space-y-3">
          <button
            type="button"
            disabled={busy}
            onClick={accept}
            className="w-full bg-[#2f6b4f] px-4 py-3 text-sm font-medium disabled:opacity-60"
          >
            ACCEPT DELIVERY
          </button>
          <form onSubmit={decline} className="space-y-2">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Decline reason (optional)"
              className="w-full bg-[#17201c] px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full border border-[#24302a] px-4 py-3 text-sm disabled:opacity-60"
            >
              DECLINE DELIVERY
            </button>
          </form>
        </div>
      ) : offer.status === "accepted" ? (
        <button
          type="button"
          onClick={() =>
            router.push(`/driver/delivery?token=${encodeURIComponent(token)}`)
          }
          className="mt-6 w-full bg-[#2f6b4f] px-4 py-3 text-sm"
        >
          Open delivery dashboard
        </button>
      ) : (
        <p className="mt-6 text-sm text-[#8aa897]">
          This offer is no longer available ({offer.status}).
        </p>
      )}

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
    </main>
  );
}

export default function DriverOfferPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#0f1412] px-4 py-10 text-[#8aa897]">
          Loading…
        </main>
      }
    >
      <OfferInner />
    </Suspense>
  );
}
