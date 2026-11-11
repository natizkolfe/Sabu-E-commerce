"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { loadSession } from "../../lib/session";

export default function ReceiptsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [rows, setRows] = useState<
    Awaited<ReturnType<typeof adminApi.listReceipts>>
  >([]);
  const [selected, setSelected] = useState<
    Awaited<ReturnType<typeof adminApi.getReceipt>> | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    adminApi
      .listReceipts(s.accessToken)
      .then(setRows)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "Load failed"),
      );
  }, []);

  async function openReceipt(idOrNumber: string) {
    if (!token) return;
    setError(null);
    try {
      setSelected(await adminApi.getReceipt(token, idOrNumber));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Open failed");
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
        <h1 className="mt-2 text-3xl tracking-tight">Customer receipts</h1>
        <p className="mt-1 text-sm text-[#9eb0a6]">
          Payment receipts for retail and special-order invoices. Demo special
          orders include RCP-SO-DEMO-0004 / 0005.
        </p>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <ul className="divide-y divide-[#24302a] border border-[#24302a]">
            {rows.length === 0 && (
              <li className="px-4 py-6 text-sm text-[#8aa897]">
                No receipts yet.
              </li>
            )}
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => void openReceipt(r.receiptNumber)}
                  className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-[#141c18]"
                >
                  <span>
                    <span className="block font-medium">{r.receiptNumber}</span>
                    <span className="mt-0.5 block text-xs text-[#8aa897]">
                      {r.orderNumber}
                      {r.specialOrderNumber
                        ? ` · ${r.specialOrderNumber}`
                        : ""}{" "}
                      · {r.customerName}
                    </span>
                  </span>
                  <span className="text-right">
                    {r.grandTotal.toLocaleString()} {r.currency}
                    <span className="mt-0.5 block text-xs text-[#8aa897]">
                      {r.paymentStatus}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <section className="border border-[#24302a] p-4">
            {!selected ? (
              <p className="text-sm text-[#8aa897]">
                Select a receipt to preview totals and line items.
              </p>
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[#8aa897]">
                    Receipt
                  </p>
                  <h2 className="text-xl">{selected.receiptNumber}</h2>
                  <p className="text-xs text-[#8aa897]">
                    {selected.orderNumber}
                    {selected.specialOrderNumber
                      ? ` · Special order ${selected.specialOrderNumber}`
                      : ""}
                  </p>
                </div>
                <p>
                  <span className="text-[#8aa897]">Customer: </span>
                  {selected.customerName}
                  {selected.customerPhone ? ` · ${selected.customerPhone}` : ""}
                </p>
                {selected.productName && (
                  <p>
                    <span className="text-[#8aa897]">Item: </span>
                    {selected.productName}
                  </p>
                )}
                <ul className="divide-y divide-[#24302a] border-y border-[#24302a]">
                  {(Array.isArray(selected.lineItems)
                    ? selected.lineItems
                    : []
                  ).map((line, i) => (
                    <li
                      key={`${line.name}-${i}`}
                      className="flex justify-between gap-3 py-2 text-xs"
                    >
                      <span>
                        {line.name}
                        <span className="mt-0.5 block text-[#8aa897]">
                          qty {line.qty} · {line.unitPrice}
                        </span>
                      </span>
                      <span>{line.lineTotal}</span>
                    </li>
                  ))}
                </ul>
                <div className="space-y-1 text-xs text-[#9eb0a6]">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{selected.subtotal}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Delivery</span>
                    <span>{selected.deliveryFee}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tax</span>
                    <span>{selected.taxTotal}</span>
                  </div>
                  <div className="flex justify-between text-sm text-[#eef2ef]">
                    <span>Grand total</span>
                    <span>
                      {selected.grandTotal.toLocaleString()} {selected.currency}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-[#8aa897]">
                  Payment: {selected.paymentMethodCode ?? "—"} ·{" "}
                  {selected.paymentStatus}
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
