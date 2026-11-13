"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { formatLabel } from "../../lib/format";
import { loadSession } from "../../lib/session";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "http://localhost:3001/v1";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function payoutBadge(state: "unpaid" | "settlement_pending" | "paid") {
  if (state === "paid") {
    return (
      <span className="border border-[#2f6b4f] bg-[#2f6b4f]/20 px-2 py-0.5 text-[11px] text-[#9dcdb4]">
        Paid
      </span>
    );
  }
  if (state === "settlement_pending") {
    return (
      <span className="border border-[#8a6a2f] bg-[#8a6a2f]/20 px-2 py-0.5 text-[11px] text-[#e6c97a]">
        Awaiting remittance
      </span>
    );
  }
  return (
    <span className="border border-[#8a3a3a] bg-[#8a3a3a]/20 px-2 py-0.5 text-[11px] text-[#f0a0a0]">
      Unpaid
    </span>
  );
}

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
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [confirmSettlementId, setConfirmSettlementId] = useState<string | null>(
    null,
  );
  const [paidAt, setPaidAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [payoutReference, setPayoutReference] = useState("");
  const [receiptKey, setReceiptKey] = useState<string | null>(null);
  const [receiptName, setReceiptName] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unpaid" | "paid">("all");
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

  const unpaidRows = useMemo(
    () => rows.filter((r) => r.payoutState === "unpaid"),
    [rows],
  );

  const unpaidByVendor = useMemo(() => {
    const map = new Map<
      string,
      { name: string; gross: number; fee: number; net: number; count: number }
    >();
    for (const r of unpaidRows) {
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
  }, [unpaidRows]);

  const previewItems = useMemo(() => {
    if (!settleVendorId) return [];
    const vendorUnpaid = unpaidRows.filter((r) => r.vendorId === settleVendorId);
    if (selectedEntryIds.length === 0) return vendorUnpaid;
    return vendorUnpaid.filter((r) => selectedEntryIds.includes(r.id));
  }, [settleVendorId, unpaidRows, selectedEntryIds]);

  const previewTotals = useMemo(() => {
    return previewItems.reduce(
      (acc, r) => {
        acc.gross += r.grossAmount;
        acc.fee += r.commissionAmount;
        acc.net += r.netPayable;
        return acc;
      },
      { gross: 0, fee: 0, net: 0 },
    );
  }, [previewItems]);

  const filteredRows = useMemo(() => {
    if (filter === "unpaid") {
      return rows.filter((r) => r.payoutState !== "paid");
    }
    if (filter === "paid") {
      return rows.filter((r) => r.payoutState === "paid");
    }
    return rows;
  }, [rows, filter]);

  const report = useMemo(() => {
    const unpaid = rows.filter((r) => r.payoutState === "unpaid");
    const pending = rows.filter((r) => r.payoutState === "settlement_pending");
    const paid = rows.filter((r) => r.payoutState === "paid");
    return {
      unpaidCount: unpaid.length,
      unpaidNet: unpaid.reduce((s, r) => s + r.netPayable, 0),
      pendingCount: pending.length,
      pendingNet: pending.reduce((s, r) => s + r.netPayable, 0),
      paidCount: paid.length,
      paidNet: paid.reduce((s, r) => s + r.netPayable, 0),
      sabuFees: rows.reduce((s, r) => s + r.commissionAmount, 0),
    };
  }, [rows]);

  useEffect(() => {
    if (!settleVendorId) {
      setSelectedEntryIds([]);
      return;
    }
    setSelectedEntryIds(
      unpaidRows.filter((r) => r.vendorId === settleVendorId).map((r) => r.id),
    );
  }, [settleVendorId, unpaidRows]);

  async function settleVendor() {
    if (!token || !settleVendorId || previewItems.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.createSettlement(token, {
        vendorId: settleVendorId,
        entryIds: previewItems.map((r) => r.id),
      });
      setMessage(
        "Settlement created with the listed items. After you pay the vendor, confirm below with date and receipt.",
      );
      setSettleVendorId("");
      await refresh(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Settlement failed");
    } finally {
      setBusy(false);
    }
  }

  function openConfirm(id: string) {
    setConfirmSettlementId(id);
    setPaidAt(new Date().toISOString().slice(0, 10));
    setPayoutReference("");
    setReceiptKey(null);
    setReceiptName(null);
    setMessage(null);
    setError(null);
  }

  async function onReceiptSelected(file: File | null) {
    if (!token || !file) return;
    setBusy(true);
    setError(null);
    try {
      const data = await fileToDataUrl(file);
      const uploaded = await adminApi.uploadMedia(token, {
        data,
        folder: "vendor-payouts",
        mimeType: file.type || undefined,
      });
      setReceiptKey(uploaded.storageKey);
      setReceiptName(file.name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Receipt upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPaid(e: FormEvent) {
    e.preventDefault();
    if (!token || !confirmSettlementId) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.markSettlementPaid(token, confirmSettlementId, {
        payoutReference: payoutReference.trim() || undefined,
        payoutReceiptKey: receiptKey || undefined,
        paidAt: new Date(`${paidAt}T12:00:00`).toISOString(),
      });
      setMessage("Vendor payment confirmed — items marked paid.");
      setConfirmSettlementId(null);
      await refresh(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  function toggleEntry(id: string) {
    setSelectedEntryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
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

  const confirming = settlements.find((s) => s.id === confirmSettlementId);

  return (
    <main className="min-h-screen bg-[#0f1412] px-4 py-10 text-[#eef2ef] sm:px-6">
      <div className="mx-auto max-w-5xl space-y-10">
        <div>
          <Link href="/?modules=1" className="text-sm text-[#8aa897]">
            ← Admin
          </Link>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-3xl tracking-tight">
                Vendor commissions & payouts
              </h1>
              <p className="mt-1 text-sm text-[#9eb0a6]">
                Itemized vendor sales report. Sabu keeps the commission (default{" "}
                {rule ? `${rule.ratePct}%` : "2%"}). Confirm remittance with
                payment date and receipt.
              </p>
            </div>
            <Link
              href="/vendors"
              className="border border-[#24302a] px-3 py-2 text-xs text-[#9dcdb4]"
            >
              Vendor directory →
            </Link>
          </div>
          {message && <p className="mt-3 text-sm text-[#2f6b4f]">{message}</p>}
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </div>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="border border-[#8a3a3a]/50 bg-[#8a3a3a]/10 p-4">
            <p className="text-xs uppercase tracking-wide text-[#f0a0a0]">
              Unpaid to vendors
            </p>
            <p className="mt-2 text-2xl">{report.unpaidNet.toFixed(2)} ETB</p>
            <p className="text-xs text-[#9eb0a6]">{report.unpaidCount} sale(s)</p>
          </div>
          <div className="border border-[#8a6a2f]/50 bg-[#8a6a2f]/10 p-4">
            <p className="text-xs uppercase tracking-wide text-[#e6c97a]">
              Awaiting remittance
            </p>
            <p className="mt-2 text-2xl">{report.pendingNet.toFixed(2)} ETB</p>
            <p className="text-xs text-[#9eb0a6]">
              {report.pendingCount} sale(s) in settlements
            </p>
          </div>
          <div className="border border-[#2f6b4f]/50 bg-[#2f6b4f]/10 p-4">
            <p className="text-xs uppercase tracking-wide text-[#9dcdb4]">
              Paid to vendors
            </p>
            <p className="mt-2 text-2xl">{report.paidNet.toFixed(2)} ETB</p>
            <p className="text-xs text-[#9eb0a6]">{report.paidCount} sale(s)</p>
          </div>
          <div className="border border-[#24302a] p-4">
            <p className="text-xs uppercase tracking-wide text-[#8aa897]">
              Sabu commission earned
            </p>
            <p className="mt-2 text-2xl">{report.sabuFees.toFixed(2)} ETB</p>
            <p className="text-xs text-[#9eb0a6]">{vendors.length} vendor(s)</p>
          </div>
        </section>

        <section className="space-y-3 border border-[#24302a] p-4">
          <h2 className="text-xl">Create vendor settlement</h2>
          <p className="text-xs text-[#8aa897]">
            Select a vendor to see unpaid sold items. Check the lines you are
            about to pay, then create the settlement.
          </p>
          <div className="flex flex-wrap gap-2">
            <select
              value={settleVendorId}
              onChange={(e) => setSettleVendorId(e.target.value)}
              className="bg-[#17201c] px-3 py-2 text-sm"
            >
              <option value="">Select vendor to settle…</option>
              {unpaidByVendor.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {v.count} unpaid · {v.net.toFixed(2)} ETB
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
              disabled={busy || !settleVendorId || previewItems.length === 0}
              onClick={settleVendor}
              className="bg-[#2f6b4f] px-4 py-2 text-sm disabled:opacity-50"
            >
              Create settlement ({previewItems.length} item
              {previewItems.length === 1 ? "" : "s"})
            </button>
          </div>

          {settleVendorId && (
            <div className="mt-3 border border-[#24302a] bg-[#121916]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#24302a] px-3 py-2 text-xs text-[#9eb0a6]">
                <span>
                  Items included in this payout · Gross{" "}
                  {previewTotals.gross.toFixed(2)} · Sabu fee{" "}
                  {previewTotals.fee.toFixed(2)} ·{" "}
                  <span className="text-[#9dcdb4]">
                    Pay vendor {previewTotals.net.toFixed(2)} ETB
                  </span>
                </span>
              </div>
              <ul className="max-h-64 divide-y divide-[#24302a] overflow-y-auto text-sm">
                {previewItems.length === 0 && (
                  <li className="px-3 py-4 text-[#8aa897]">
                    No unpaid items for this vendor.
                  </li>
                )}
                {unpaidRows
                  .filter((r) => r.vendorId === settleVendorId)
                  .map((r) => (
                    <li key={r.id} className="flex gap-3 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedEntryIds.includes(r.id)}
                        onChange={() => toggleEntry(r.id)}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {r.orderNumber} ·{" "}
                          {r.productSummary ?? "Vendor merchandise"}
                        </p>
                        <p className="text-xs text-[#8aa897]">
                          Sold {new Date(r.createdAt).toLocaleDateString()} ·
                          Sabu {r.ratePct}% · Fee {r.commissionAmount.toFixed(2)}
                        </p>
                      </div>
                      <p className="text-[#9dcdb4]">
                        {r.netPayable.toFixed(2)} ETB
                      </p>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </section>

        <section>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-xl">Vendor sales report</h2>
            <div className="flex gap-2 text-xs">
              {(
                [
                  ["all", "All"],
                  ["unpaid", "Unpaid / pending"],
                  ["paid", "Paid"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`px-3 py-1.5 ${
                    filter === value
                      ? "bg-[#2f6b4f] text-white"
                      : "border border-[#24302a] text-[#9eb0a6]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <ul className="mt-4 divide-y divide-[#24302a] border-t border-[#24302a] text-sm">
            {filteredRows.length === 0 && (
              <li className="py-6 text-[#8aa897]">
                No commission entries yet. Assign vendors on products, then
                verify customer payment.
              </li>
            )}
            {filteredRows.map((r) => (
              <li
                key={r.id}
                className={`flex flex-wrap items-start justify-between gap-3 py-3 ${
                  r.payoutState === "paid"
                    ? "bg-[#2f6b4f]/5"
                    : r.payoutState === "settlement_pending"
                      ? "bg-[#8a6a2f]/5"
                      : "bg-[#8a3a3a]/5"
                }`}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {payoutBadge(r.payoutState)}
                    <span className="font-medium">
                      {r.orderNumber} · {r.vendorName}
                    </span>
                  </div>
                  <p className="text-[#c9d6ce]">
                    {r.productSummary ?? "Vendor merchandise"}
                  </p>
                  <p className="text-xs text-[#8aa897]">
                    Sold {new Date(r.createdAt).toLocaleString()} · Sabu{" "}
                    {r.ratePct}% of {r.grossAmount.toFixed(2)}
                    {r.settlementNumber ? ` · ${r.settlementNumber}` : ""}
                    {r.paidAt
                      ? ` · Paid ${new Date(r.paidAt).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[#9dcdb4]">
                    Vendor {r.netPayable.toFixed(2)} ETB
                  </p>
                  <p className="text-xs text-[#8aa897]">
                    Fee {r.commissionAmount.toFixed(2)} ETB
                  </p>
                </div>
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
              <li key={s.id} className="space-y-2 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      {s.status === "paid"
                        ? payoutBadge("paid")
                        : payoutBadge("settlement_pending")}
                      <p className="font-medium">
                        {s.settlementNumber} · {s.vendorName}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-[#9eb0a6]">
                      {s.periodStart} → {s.periodEnd} · Gross {s.grossSales} ·
                      Fee {s.commissionTotal} ·{" "}
                      <span className="text-[#9dcdb4]">
                        Net {s.netPayable} ETB
                      </span>
                      {s.paidAt
                        ? ` · Confirmed ${new Date(s.paidAt).toLocaleDateString()}`
                        : ""}
                      {s.payoutReference ? ` · Ref ${s.payoutReference}` : ""}
                    </p>
                  </div>
                  {s.status !== "paid" && s.status !== "cancelled" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => openConfirm(s.id)}
                      className="bg-[#2f6b4f] px-3 py-1.5 text-xs"
                    >
                      Confirm paid to vendor
                    </button>
                  )}
                  {s.payoutReceiptUrl && (
                    <a
                      href={`${API_URL}${s.payoutReceiptUrl}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-[#9dcdb4] underline"
                    >
                      View receipt
                    </a>
                  )}
                </div>
                {s.items.length > 0 && (
                  <ul className="space-y-1 border border-[#24302a] bg-[#121916] px-3 py-2 text-xs text-[#9eb0a6]">
                    {s.items.map((it) => (
                      <li
                        key={it.entryId}
                        className="flex justify-between gap-3"
                      >
                        <span>
                          {it.orderNumber} ·{" "}
                          {it.productSummary ?? "Merchandise"}
                        </span>
                        <span className="text-[#9dcdb4]">
                          {it.netPayable.toFixed(2)} ETB
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>

        {confirming && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
            <form
              onSubmit={confirmPaid}
              className="w-full max-w-md space-y-4 border border-[#24302a] bg-[#121916] p-5"
            >
              <h3 className="text-lg">Confirm vendor payment</h3>
              <p className="text-sm text-[#9eb0a6]">
                {confirming.settlementNumber} · {confirming.vendorName} ·{" "}
                <span className="text-[#9dcdb4]">
                  {confirming.netPayable} ETB
                </span>
              </p>
              <ul className="max-h-40 space-y-1 overflow-y-auto border border-[#24302a] px-3 py-2 text-xs text-[#9eb0a6]">
                {confirming.items.map((it) => (
                  <li key={it.entryId}>
                    {it.orderNumber} · {it.productSummary ?? "Merchandise"} ·{" "}
                    {it.netPayable.toFixed(2)} ETB
                  </li>
                ))}
              </ul>
              <label className="block text-sm text-[#8aa897]">
                Payment confirmation date
                <input
                  type="date"
                  required
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                  className="mt-1 w-full bg-[#17201c] px-3 py-2 text-[#eef2ef]"
                />
              </label>
              <label className="block text-sm text-[#8aa897]">
                Payout reference (Telebirr / bank TXN)
                <input
                  value={payoutReference}
                  onChange={(e) => setPayoutReference(e.target.value)}
                  placeholder="Optional but recommended"
                  className="mt-1 w-full bg-[#17201c] px-3 py-2 text-[#eef2ef]"
                />
              </label>
              <div className="text-sm text-[#8aa897]">
                Receipt / proof of payment
                <label className="mt-1 flex cursor-pointer flex-col gap-1 border border-dashed border-[#24302a] px-3 py-3">
                  <span className="text-[#9dcdb4]">
                    {receiptName ?? "Upload receipt image (JPG/PNG)"}
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(e) =>
                      void onReceiptSelected(e.target.files?.[0] ?? null)
                    }
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmSettlementId(null)}
                  className="flex-1 border border-[#24302a] px-3 py-2 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 bg-[#2f6b4f] px-3 py-2 text-sm disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Mark paid"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}
