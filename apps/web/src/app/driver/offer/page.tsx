"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { formatLabel } from "../../../lib/format";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "http://localhost:3001/v1";

type Offer = {
  assignmentId: string;
  status: string;
  expired: boolean;
  orderNumber: string;
  deliveryNumber: string;
};

function OfferInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [offer, setOffer] = useState<Offer | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        if (body.status === "accepted") {
          router.replace(
            `/driver/delivery?token=${encodeURIComponent(token)}`,
          );
        }
      })
      .catch((err: Error) => setError(err.message));
  }, [token, router]);

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

  return (
    <main className="mx-auto min-h-screen max-w-md bg-[#0f1412] px-4 py-8 text-[#eef2ef]">
      <p className="text-[11px] tracking-[0.2em] text-[#8aa897] uppercase">
        Sabu driver
      </p>
      <h1 className="mt-2 text-2xl font-medium">Assignment notice</h1>
      <p className="mt-1 text-sm text-[#9eb0a6]">
        Order #{offer.orderNumber} · {offer.deliveryNumber}
      </p>

      <div className="mt-6 space-y-3 rounded border border-[#24302a] p-4 text-sm text-[#b7c7be]">
        <p>
          Driver accept and decline are no longer used. An administrator assigns
          deliveries after contacting you by phone.
        </p>
        <p>
          If you already have an active assignment, open the delivery dashboard
          to verify QR/PIN and confirm delivery.
        </p>
      </div>

      {offer.status === "accepted" ? (
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
          This link is not an active assignment ({formatLabel(offer.status)}).
        </p>
      )}
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
