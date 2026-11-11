"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { loadSession } from "../../lib/session";

export default function SpecialOrdersPage() {
  const [token, setToken] = useState<string | null>(null);
  const [orders, setOrders] = useState<
    Awaited<ReturnType<typeof adminApi.listSpecialOrders>>
  >([]);
  const [partners, setPartners] = useState<
    Awaited<ReturnType<typeof adminApi.listPartners>>
  >([]);
  const [selectedPartner, setSelectedPartner] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    Promise.all([
      adminApi.listSpecialOrders(s.accessToken),
      adminApi.listPartners(s.accessToken),
    ])
      .then(([o, p]) => {
        setOrders(o);
        setPartners(p);
        setSelectedPartner(p[0]?.id ?? "");
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "Load failed"),
      );
  }, []);

  async function assign(requestId: string) {
    if (!token || !selectedPartner) return;
    setError(null);
    try {
      const res = await adminApi.assignSpecialOrderPartner(
        token,
        requestId,
        selectedPartner,
      );
      setMessage((res as { message?: string }).message ?? "Assigned");
      setOrders(await adminApi.listSpecialOrders(token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Assign failed");
    }
  }

  if (!token) {
    return (
      <main className="min-h-screen bg-[#0f1412] px-6 py-16 text-[#eef2ef]">
        <Link href="/" className="text-[#8aa897]">
          ← Admin
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0f1412] px-4 py-10 text-[#eef2ef] sm:px-6">
      <div className="mx-auto max-w-5xl">
        <Link href="/" className="text-sm text-[#8aa897]">
          ← Admin
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl tracking-tight">Special Orders</h1>
            <p className="mt-1 text-sm text-[#9eb0a6]">
              International procurement requests (USA / China / Dubai). Paid
              demos link to customer receipts.
            </p>
          </div>
          <Link
            href="/receipts"
            className="border border-[#24302a] px-3 py-1.5 text-xs text-[#9dcdb4]"
          >
            View receipts →
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[#8aa897]">Assign to partner:</span>
          <select
            value={selectedPartner}
            onChange={(e) => setSelectedPartner(e.target.value)}
            className="bg-[#17201c] px-3 py-2"
          >
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.countryCode} — {p.name}
              </option>
            ))}
          </select>
          <Link href="/partners" className="text-[#9dcdb4] underline">
            Manage partners
          </Link>
        </div>

        {message && <p className="mt-3 text-sm text-[#2f6b4f]">{message}</p>}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <ul className="mt-8 divide-y divide-[#24302a] border-t border-[#24302a]">
          {orders.length === 0 && (
            <li className="py-6 text-[#8aa897]">No special orders yet.</li>
          )}
          {orders.map((o) => (
            <li
              key={o.id}
              className="flex flex-wrap items-start justify-between gap-3 py-4 text-sm"
            >
              <div>
                <p className="font-medium">
                  {o.requestNumber} · {o.productName}
                </p>
                <p className="text-xs text-[#9eb0a6]">
                  {o.sourcingRegionName} ({o.sourcingRegion}) · {o.status} · qty{" "}
                  {o.quantity} · {o.imageCount} image(s)
                </p>
                <p className="text-xs text-[#8aa897]">
                  {o.guestName} · {o.guestPhone}
                </p>
              </div>
              <button
                type="button"
                onClick={() => assign(o.id)}
                className="bg-[#2f6b4f] px-3 py-2 text-xs"
              >
                Send to partner (WhatsApp stub)
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
