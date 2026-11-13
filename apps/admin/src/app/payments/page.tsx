"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { loadSession } from "../../lib/session";

type Pending = Awaited<ReturnType<typeof adminApi.pendingVerifications>>[number];
type Telebirr = Awaited<ReturnType<typeof adminApi.getTelebirrSettings>>;

export default function PaymentsAdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [rows, setRows] = useState<Pending[]>([]);
  const [telebirr, setTelebirr] = useState<Telebirr | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const [logs, setLogs] = useState<
    Awaited<ReturnType<typeof adminApi.paymentVerificationLogs>>
  >([]);
  const [focusOrderId, setFocusOrderId] = useState<string | null>(null);

  async function load(t: string) {
    const [data, settings] = await Promise.all([
      adminApi.pendingVerifications(t),
      adminApi.getTelebirrSettings(t),
    ]);
    setRows(data);
    setTelebirr(settings);
  }

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    const params = new URLSearchParams(window.location.search);
    setFocusOrderId(params.get("orderId"));
    load(s.accessToken).catch(() => setRows([]));
  }, []);

  const sortedRows = useMemo(() => {
    if (!focusOrderId) return rows;
    return [...rows].sort((a, b) => {
      const aHit = a.orderId === focusOrderId ? 0 : 1;
      const bHit = b.orderId === focusOrderId ? 0 : 1;
      return aHit - bHit;
    });
  }, [rows, focusOrderId]);

  useEffect(() => {
    if (!focusOrderId || sortedRows.length === 0) return;
    const el = document.getElementById(`pay-order-${focusOrderId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusOrderId, sortedRows]);

  async function approve(id: string) {
    if (!token) return;
    setError(null);
    try {
      await adminApi.approvePayment(token, id);
      setMessage("Verified — order marked paid and eligible for fulfillment");
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

  async function clarify(id: string) {
    if (!token) return;
    const notes = window.prompt("Clarification request notes") ?? "";
    if (notes.length < 3) return;
    try {
      await adminApi.requestPaymentClarification(token, id, notes);
      setMessage("Clarification requested");
      const next = await adminApi.paymentVerificationLogs(token, id);
      setLogs(next);
      setLogsFor(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Clarification failed");
    }
  }

  async function flag(id: string) {
    if (!token) return;
    try {
      await adminApi.flagPaymentDuplicate(token, id);
      setMessage("Flagged as possible duplicate");
      const next = await adminApi.paymentVerificationLogs(token, id);
      setLogs(next);
      setLogsFor(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Flag failed");
    }
  }

  async function showLogs(id: string) {
    if (!token) return;
    const next = await adminApi.paymentVerificationLogs(token, id);
    setLogs(next);
    setLogsFor(id);
  }

  async function saveTelebirr(e: FormEvent) {
    e.preventDefault();
    if (!token || !telebirr) return;
    setError(null);
    try {
      const next = await adminApi.updateTelebirrSettings(token, telebirr);
      setTelebirr(next as Telebirr);
      setMessage("Telebirr merchant settings saved");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    }
  }

  if (!token) {
    return (
      <main className="min-h-screen bg-[#0f1412] px-6 py-16 text-[#eef2ef]">
        <p>Sign in from the home page first.</p>
        <Link href="/?modules=1" className="mt-4 inline-block text-[#8aa897]">
          ← Admin home
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0f1412] px-6 py-12 text-[#eef2ef]">
      <div className="mx-auto max-w-4xl space-y-10">
        <div>
          <Link href="/?modules=1" className="text-sm text-[#8aa897]">
            ← Admin
          </Link>
          <h1 className="mt-4 text-3xl">Payment verification</h1>
          <p className="mt-2 text-sm text-[#9eb0a6]">
            Telebirr and bank transfers stay pending until verified against
            merchant records — customer TXN IDs alone are not proof of payment.
          </p>
          <p className="mt-2 text-sm">
            <Link href="/delivery-settings" className="text-[#8aa897] underline">
              Delivery pricing settings
            </Link>
          </p>
          {message && <p className="mt-4 text-sm text-[#2f6b4f]">{message}</p>}
          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        </div>

        {telebirr && (
          <form
            onSubmit={saveTelebirr}
            className="space-y-3 border border-[#24302a] p-4"
          >
            <h2 className="text-xl">Telebirr merchant instructions</h2>
            <label className="block text-sm text-[#9eb0a6]">
              Display name
              <input
                className="mt-1 w-full border border-[#24302a] bg-transparent px-3 py-2 text-[#eef2ef]"
                value={telebirr.displayName}
                onChange={(e) =>
                  setTelebirr({ ...telebirr, displayName: e.target.value })
                }
              />
            </label>
            <label className="block text-sm text-[#9eb0a6]">
              Merchant account / phone
              <input
                className="mt-1 w-full border border-[#24302a] bg-transparent px-3 py-2 text-[#eef2ef]"
                value={telebirr.merchantAccount}
                onChange={(e) =>
                  setTelebirr({ ...telebirr, merchantAccount: e.target.value })
                }
              />
            </label>
            <label className="block text-sm text-[#9eb0a6]">
              Instructions
              <textarea
                className="mt-1 w-full border border-[#24302a] bg-transparent px-3 py-2 text-[#eef2ef]"
                rows={3}
                value={telebirr.instructions}
                onChange={(e) =>
                  setTelebirr({ ...telebirr, instructions: e.target.value })
                }
              />
            </label>
            <label className="block text-sm text-[#9eb0a6]">
              TXN format regex
              <input
                className="mt-1 w-full border border-[#24302a] bg-transparent px-3 py-2 font-mono text-sm text-[#eef2ef]"
                value={telebirr.txnFormatRegex}
                onChange={(e) =>
                  setTelebirr({ ...telebirr, txnFormatRegex: e.target.value })
                }
              />
            </label>
            <button
              type="submit"
              className="bg-[#2f6b4f] px-4 py-2 text-sm text-white"
            >
              Save Telebirr settings
            </button>
          </form>
        )}

        {focusOrderId && (
          <p className="text-sm text-[#9dcdb4]">
            Focusing order from dashboard ·{" "}
            <button
              type="button"
              className="underline"
              onClick={() => {
                setFocusOrderId(null);
                window.history.replaceState({}, "", "/payments");
              }}
            >
              clear
            </button>
          </p>
        )}

        <ul className="divide-y divide-[#24302a] border-t border-[#24302a]">
          {sortedRows.length === 0 && (
            <li className="py-6 text-[#8aa897]">No pending payments</li>
          )}
          {sortedRows.map((r) => (
            <li
              key={r.transactionId}
              id={`pay-order-${r.orderId}`}
              className={`py-5 ${
                focusOrderId === r.orderId
                  ? "border border-[#2f6b4f] bg-[#14201a] px-3"
                  : ""
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 text-sm">
                  <p className="text-lg text-white">
                    {r.orderNumber}{" "}
                    <span className="text-sm text-[#8aa897]">
                      · {r.methodName}
                    </span>
                    {focusOrderId === r.orderId && (
                      <span className="ml-2 text-xs text-[#2f6b4f]">
                        selected
                      </span>
                    )}
                  </p>
                  <p className="text-[#b7c7be]">
                    {r.customerName ?? "—"} · {r.phone ?? "—"}
                  </p>
                  <p className="text-[#b7c7be]">
                    Products {r.subtotal} + Delivery {r.deliveryFee} ={" "}
                    <strong>
                      {r.grandTotal} {r.currency}
                    </strong>
                  </p>
                  <p className="text-[#8aa897]">
                    TXN: {r.telebirrTxnId ?? r.customerReference ?? "—"}
                    {r.duplicateFlag ? " · DUPLICATE FLAG" : ""}
                  </p>
                  <ul className="text-xs text-[#9eb0a6]">
                    {r.items.map((it, idx) => (
                      <li key={idx}>
                        {it.name} × {it.quantity} — {it.lineTotal}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-[#6f8078]">
                    Submitted {new Date(r.submittedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => approve(r.transactionId)}
                    className="bg-[#2f6b4f] px-3 py-2 text-sm"
                  >
                    Verify
                  </button>
                  <button
                    type="button"
                    onClick={() => reject(r.transactionId)}
                    className="border border-[#24302a] px-3 py-2 text-sm"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => clarify(r.transactionId)}
                    className="border border-[#24302a] px-3 py-2 text-sm"
                  >
                    Clarify
                  </button>
                  <button
                    type="button"
                    onClick={() => flag(r.transactionId)}
                    className="border border-[#24302a] px-3 py-2 text-sm"
                  >
                    Flag duplicate
                  </button>
                  <button
                    type="button"
                    onClick={() => showLogs(r.transactionId)}
                    className="border border-[#24302a] px-3 py-2 text-sm"
                  >
                    History
                  </button>
                </div>
              </div>
              {logsFor === r.transactionId && logs.length > 0 && (
                <ul className="mt-3 space-y-1 border-l border-[#24302a] pl-3 text-xs text-[#9eb0a6]">
                  {logs.map((l) => (
                    <li key={l.id}>
                      {l.action} — {l.notes ?? "—"} · {l.actorName ?? "system"}{" "}
                      · {new Date(l.createdAt).toLocaleString()}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
