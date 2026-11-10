"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { loadSession } from "../../lib/session";

export default function PaymentsAdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [rows, setRows] = useState<
    Awaited<ReturnType<typeof adminApi.pendingVerifications>>
  >([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(t: string) {
    const data = await adminApi.pendingVerifications(t);
    setRows(data);
  }

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    load(s.accessToken).catch(() => setRows([]));
  }, []);

  async function approve(id: string) {
    if (!token) return;
    setError(null);
    try {
      await adminApi.approvePayment(token, id);
      setMessage("Approved — order marked paid");
      await load(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Approve failed");
    }
  }

  async function reject(id: string) {
    if (!token) return;
    const reason = window.prompt("Rejection reason") ?? "";
    if (reason.length < 3) return;
    setError(null);
    try {
      await adminApi.rejectPayment(token, id, reason);
      setMessage("Rejected");
      await load(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reject failed");
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
    <main className="min-h-screen bg-[#0f1412] px-6 py-12 text-[#eef2ef]">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-[#8aa897]">
          ← Admin
        </Link>
        <h1 className="mt-4 text-3xl">Bank transfer verification</h1>
        <p className="mt-2 text-sm text-[#9eb0a6]">
          Approve only after comparing amount and receipt. Never trust client
          upload alone.
        </p>
        {message && <p className="mt-4 text-sm text-[#2f6b4f]">{message}</p>}
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        <ul className="mt-8 divide-y divide-[#24302a] border-t border-[#24302a]">
          {rows.length === 0 && (
            <li className="py-6 text-[#8aa897]">No pending transfers</li>
          )}
          {rows.map((r) => (
            <li key={r.transactionId} className="py-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="text-sm">
                  <p className="text-lg text-white">{r.orderNumber}</p>
                  <p className="text-[#b7c7be]">
                    {r.amount} {r.currency} · {r.bankName ?? "bank"}
                  </p>
                  <p className="text-[#8aa897]">
                    Ref: {r.customerReference ?? "—"} · Receipt:{" "}
                    {r.receiptKey ?? "—"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => approve(r.transactionId)}
                    className="bg-[#2f6b4f] px-3 py-2 text-sm"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => reject(r.transactionId)}
                    className="border border-[#24302a] px-3 py-2 text-sm"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
