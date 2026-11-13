"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { formatLabel } from "../../lib/format";
import { loadSession } from "../../lib/session";

export default function CommissionsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [rule, setRule] = useState<{ ratePct: number; code: string } | null>(
    null,
  );
  const [vendors, setVendors] = useState<
    Awaited<ReturnType<typeof adminApi.listVendors>>
  >([]);
  const [rows, setRows] = useState<
    Awaited<ReturnType<typeof adminApi.listCommissions>>
  >([]);
  const [settlements, setSettlements] = useState<
    Awaited<ReturnType<typeof adminApi.listSettlements>>
  >([]);
  const [settleVendorId, setSettleVendorId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(access: string) {
    const [r, list, v, stl] = await Promise.all([
      adminApi.commissionRule(access),
      adminApi.listCommissions(access),
      adminApi.listVendors(access),
      adminApi.listSettlements(access),
    ]);
    setRule(r);
    setRows(list);
    setVendors(v);
    setSettlements(stl);
  }

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    refresh(s.accessToken).catch((err: unknown) =>
      setError(err instanceof ApiError ? err.message : "Load failed"),
    );
  }, []);

  const unpaidByVendor = useMemo(() => {
    const map = new Map<
      string,
      { name: string; gross: number; fee: number; net: number; count: number }
    >();
    for (const r of rows) {
      if (r.status === "paid_out") continue;
      const cur = map.get(r.vendorId) ?? {
        name: r.vendorName,
        gross: 0,
        fee: 0,
        net: 0,
        count: 0,
      };
      cur.gross += r.grossAmount;
      cur.fee += r.commissionAmount;
      cur.net += r.netPayable;
      cur.count += 1;
      map.set(r.vendorId, cur);
    }
    return [...map.entries()].map(([id, v]) => ({ id, ...v }));
  }, [rows]);

  async function settleVendor() {
    if (!token || !settleVendorId) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.createSettlement(token, { vendorId: settleVendorId });
      setMessage(
        "Settlement created — pay the vendor the remaining balance, then mark as paid.",
      );
      await refresh(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Settlement failed");
    } finally {
      setBusy(false);
    }
  }

  async function markPaid(id: string) {
    if (!token) return;
    const payoutReference =
      window.prompt("Payout reference (Telebirr/bank TXN)") ?? "";
    setBusy(true);
    setError(null);
    try {
      await adminApi.markSettlementPaid(token, id, {
        payoutReference: payoutReference.trim() || undefined,
      });
      setMessage("Marked paid — vendor remittance recorded");
      await refresh(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setBusy(false);
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
      <div className="mx-auto max-w-4xl space-y-10">
        <div>
          <Link href="/?modules=1" className="text-sm text-[#8aa897]">
            ← Admin
          </Link>
          <h1 className="mt-2 text-3xl tracking-tight">
            Vendor commissions & payouts
          </h1>
          <p className="mt-1 text-sm text-[#9eb0a6]">
            When a vendor product sells and payment is verified, Sabu keeps the
            commission (default {rule ? `${rule.ratePct}%` : "2%"} — or the
            vendor&apos;s own rate). Delivery fees stay with Sabu. The remaining
            product balance is what you send to the vendor (e.g. Mimi Baletena).
          </p>
          {message && <p className="mt-3 text-sm text-[#2f6b4f]">{message}</p>}
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </div>

        <section className="space-y-3 border border-[#24302a] p-4">
          <h2 className="text-xl">Balances ready to pay</h2>
          {unpaidByVendor.length === 0 ? (
            <p className="text-sm text-[#8aa897]">
              No unpaid vendor sales yet. Assign a vendor on products, then
              verify customer payment.
            </p>
          ) : (
            <ul className="divide-y divide-[#24302a] text-sm">
              {unpaidByVendor.map((v) => (
                <li
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <p className="font-medium">{v.name}</p>
                    <p className="text-xs text-[#9eb0a6]">
                      {v.count} sale(s) · Gross {v.gross.toFixed(2)} · Sabu fee{" "}
                      {v.fee.toFixed(2)}
                    </p>
                  </div>
                  <p className="text-[#9dcdb4]">
                    Pay vendor{" "}
                    <strong className="text-white">{v.net.toFixed(2)} ETB</strong>
                  </p>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <select
              value={settleVendorId}
              onChange={(e) => setSettleVendorId(e.target.value)}
              className="bg-[#17201c] px-3 py-2 text-sm"
            >
              <option value="">Select vendor to settle…</option>
              {unpaidByVendor.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {v.net.toFixed(2)} ETB
                </option>
              ))}
              {vendors
                .filter((v) => !unpaidByVendor.some((u) => u.id === v.id))
                .map((v) => (
                  <option key={v.id} value={v.id} disabled>
                    {v.displayName} (nothing pending)
                  </option>
                ))}
            </select>
            <button
              type="button"
              disabled={busy || !settleVendorId}
              onClick={settleVendor}
              className="bg-[#2f6b4f] px-4 py-2 text-sm disabled:opacity-50"
            >
              Create settlement
            </button>
          </div>
        </section>

        <section>
          <h2 className="text-xl">Sale ledger</h2>
          <ul className="mt-4 divide-y divide-[#24302a] border-t border-[#24302a] text-sm">
            {rows.length === 0 && (
              <li className="py-6 text-[#8aa897]">
                No commission entries yet.
              </li>
            )}
            {rows.map((r) => (
              <li key={r.id} className="flex justify-between gap-4 py-3">
                <span>
                  {r.orderNumber} · {r.vendorName}
                  <span className="mt-0.5 block text-xs text-[#8aa897]">
                    {formatLabel(r.status)} · Sabu {r.ratePct}% of{" "}
                    {r.grossAmount.toFixed(2)}
                  </span>
                </span>
                <span className="text-right">
                  Fee {r.commissionAmount.toFixed(2)} ETB
                  <span className="mt-0.5 block text-xs text-[#9dcdb4]">
                    Vendor gets {r.netPayable.toFixed(2)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="text-xl">Settlements</h2>
          <ul className="mt-4 divide-y divide-[#24302a] border-t border-[#24302a] text-sm">
            {settlements.length === 0 && (
              <li className="py-6 text-[#8aa897]">No settlements yet.</li>
            )}
            {settlements.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <p>
                    {s.settlementNumber} · {s.vendorName}
                  </p>
                  <p className="text-xs text-[#9eb0a6]">
                    {s.periodStart} → {s.periodEnd} · Gross {s.grossSales} · Fee{" "}
                    {s.commissionTotal} ·{" "}
                    <span className="text-[#9dcdb4]">
                      Net {s.netPayable} ETB
                    </span>{" "}
                    · {formatLabel(s.status)}
                    {s.payoutReference ? ` · ${s.payoutReference}` : ""}
                  </p>
                </div>
                {s.status !== "paid" && s.status !== "cancelled" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => markPaid(s.id)}
                    className="bg-[#2f6b4f] px-3 py-1.5 text-xs"
                  >
                    Mark paid to vendor
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
