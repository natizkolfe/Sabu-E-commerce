"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { formatLabel } from "../../lib/format";
import { loadSession } from "../../lib/session";

export default function VendorsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [vendors, setVendors] = useState<
    Awaited<ReturnType<typeof adminApi.listVendors>>
  >([]);
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("+2519");
  const [rate, setRate] = useState("2");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh(access: string) {
    setVendors(await adminApi.listVendors(access));
  }

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    refresh(s.accessToken).catch(() => undefined);
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    try {
      await adminApi.createVendor(token, {
        businessName,
        phone,
        commissionRatePct: Number(rate) || undefined,
      });
      setMessage("Vendor created (pending approval)");
      setBusinessName("");
      await refresh(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Create failed");
    }
  }

  async function setStatus(id: string, status: string) {
    if (!token) return;
    try {
      await adminApi.updateVendor(token, id, { status });
      await refresh(token);
      setMessage(`Status → ${status}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  if (!token) {
    return (
      <main className="min-h-screen bg-[#0f1412] px-6 py-16 text-[#eef2ef]">
        <Link href="/?modules=1" className="text-[#8aa897]">
          ← Admin
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0f1412] px-4 py-10 text-[#eef2ef] sm:px-6">
      <div className="mx-auto max-w-4xl">
        <Link href="/?modules=1" className="text-sm text-[#8aa897]">
          ← Admin
        </Link>
        <h1 className="mt-2 text-3xl tracking-tight">Vendors</h1>
        <p className="mt-1 text-sm text-[#9eb0a6]">
          Marketplace sellers. Default commission 2% unless overridden.
        </p>

        <form onSubmit={onCreate} className="mt-8 grid gap-3 sm:grid-cols-2">
          <input
            required
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Business name"
            className="bg-[#17201c] px-3 py-2 text-sm"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+251..."
            className="bg-[#17201c] px-3 py-2 text-sm"
          />
          <input
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="Commission %"
            className="bg-[#17201c] px-3 py-2 text-sm"
          />
          <button type="submit" className="bg-[#2f6b4f] px-4 py-2 text-sm">
            Add vendor
          </button>
        </form>

        {message && <p className="mt-3 text-sm text-[#2f6b4f]">{message}</p>}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <ul className="mt-8 divide-y divide-[#24302a] border-t border-[#24302a]">
          {vendors.map((v) => (
            <li
              key={v.id}
              className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm"
            >
              <div>
                <p className="font-medium">
                  {v.displayName}{" "}
                  <span className="text-[#8aa897]">{v.vendorCode}</span>
                </p>
                <p className="text-xs text-[#9eb0a6]">
                  {formatLabel(v.status)} ·{" "}
                  {v.commissionRatePct != null
                    ? `${v.commissionRatePct}%`
                    : "global rate"}{" "}
                  · {v.productCount} products · {v.phone}
                </p>
              </div>
              <div className="flex gap-2">
                {v.status !== "active" && (
                  <button
                    type="button"
                    onClick={() => setStatus(v.id, "active")}
                    className="bg-[#2f6b4f] px-3 py-1.5 text-xs"
                  >
                    Activate
                  </button>
                )}
                {v.status === "active" && (
                  <button
                    type="button"
                    onClick={() => setStatus(v.id, "suspended")}
                    className="border border-[#24302a] px-3 py-1.5 text-xs"
                  >
                    Suspend
                  </button>
                )}
              </div>
            </li>
          ))}
          {vendors.length === 0 && (
            <li className="py-6 text-[#8aa897]">No vendors yet.</li>
          )}
        </ul>
      </div>
    </main>
  );
}
