"use client";

import Link from "next/link";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "../../../lib/api";

function PayInner() {
  const router = useRouter();
  const params = useSearchParams();
  const orderNumber = params.get("orderNumber") ?? "";
  const intentId = params.get("intentId") ?? "";
  const method = params.get("method") ?? "";
  const track = params.get("track") ?? "";

  const [banks, setBanks] = useState<
    Awaited<ReturnType<typeof api.listBankAccounts>>
  >([]);
  const [bankId, setBankId] = useState("");
  const [ref, setRef] = useState("");
  const [receiptKey, setReceiptKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (method.includes("bank")) {
      api.listBankAccounts().then((b) => {
        setBanks(b);
        setBankId(b[0]?.id ?? "");
      });
    }
  }, [method]);

  async function startChapa() {
    if (!intentId) return;
    setBusy(true);
    setError(null);
    try {
      const returnUrl = `${window.location.origin}/orders/track?orderNumber=${encodeURIComponent(orderNumber)}&token=${encodeURIComponent(track)}`;
      const init = await api.initializeChapa(intentId, {
        returnUrl,
        customerPhone: undefined,
      });
      if (init.mode === "mock") {
        await api.mockCompleteChapa(init.merchantReference);
        setMessage("Mock Chapa payment completed.");
        router.push(
          `/orders/track?orderNumber=${encodeURIComponent(orderNumber)}&token=${encodeURIComponent(track)}`,
        );
        return;
      }
      window.location.href = init.checkoutUrl;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Chapa failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitBank(e: FormEvent) {
    e.preventDefault();
    if (!intentId || !bankId) return;
    setBusy(true);
    setError(null);
    try {
      const key =
        receiptKey.trim() ||
        `receipts/${orderNumber}/${Date.now()}.jpg`;
      const res = await api.submitBankTransfer({
        paymentIntentId: intentId,
        companyBankAccountId: bankId,
        customerReference: ref || undefined,
        receiptStorageKey: key,
      });
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  const isChapa = method.includes("chapa");
  const isBank = method.includes("bank");

  return (
    <main className="min-h-screen bg-sabu-paper pt-28 pb-16">
      <div className="mx-auto max-w-xl px-6">
        <h1 className="font-[family-name:var(--font-syne)] text-4xl text-sabu-ink">
          Pay for {orderNumber || "order"}
        </h1>
        <p className="mt-2 text-sabu-moss">
          Complete payment to confirm. Paid status is set only after verified
          webhook or admin approval.
        </p>

        {isChapa && (
          <div className="mt-8 space-y-4">
            <button
              type="button"
              disabled={busy || !intentId}
              onClick={startChapa}
              className="w-full bg-sabu-leaf px-5 py-3 text-sm text-sabu-cream hover:bg-sabu-forest disabled:opacity-60"
            >
              {busy ? "Starting Chapa…" : "Pay with Chapa"}
            </button>
          </div>
        )}

        {isBank && (
          <form onSubmit={submitBank} className="mt-8 space-y-4">
            <p className="text-sm text-sabu-moss">
              Transfer the exact order total, then upload a receipt key (object
              storage path) for admin verification.
            </p>
            {banks.map((b) => (
              <label
                key={b.id}
                className="flex cursor-pointer gap-3 border border-sabu-mist/60 px-3 py-3 text-sm"
              >
                <input
                  type="radio"
                  name="bank"
                  checked={bankId === b.id}
                  onChange={() => setBankId(b.id)}
                />
                <span className="text-sabu-ink">
                  <strong>{b.bankName}</strong> — {b.accountName}
                  <br />
                  <span className="text-sabu-moss">
                    {b.accountNumberMasked} · {b.branchName}
                  </span>
                  {b.instructions && (
                    <span className="mt-1 block text-sabu-moss">
                      {b.instructions}
                    </span>
                  )}
                </span>
              </label>
            ))}
            <label className="block text-sm text-sabu-moss">
              Bank reference (optional)
              <input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                className="mt-1 w-full border-b border-sabu-moss/40 bg-transparent py-3 outline-none"
              />
            </label>
            <label className="block text-sm text-sabu-moss">
              Receipt storage key
              <input
                value={receiptKey}
                onChange={(e) => setReceiptKey(e.target.value)}
                placeholder={`receipts/${orderNumber}/proof.jpg`}
                className="mt-1 w-full border-b border-sabu-moss/40 bg-transparent py-3 outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-sabu-leaf px-5 py-3 text-sm text-sabu-cream hover:bg-sabu-forest disabled:opacity-60"
            >
              {busy ? "Submitting…" : "Submit for verification"}
            </button>
          </form>
        )}

        {!isChapa && !isBank && (
          <p className="mt-8 text-sabu-moss">Unknown payment method.</p>
        )}

        {message && <p className="mt-6 text-sm text-sabu-leaf">{message}</p>}
        {error && <p className="mt-6 text-sm text-red-700">{error}</p>}

        {track && orderNumber && (
          <Link
            href={`/orders/track?orderNumber=${encodeURIComponent(orderNumber)}&token=${encodeURIComponent(track)}`}
            className="mt-8 inline-block text-sabu-leaf underline"
          >
            Track order
          </Link>
        )}
      </div>
    </main>
  );
}

export default function PayPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-sabu-paper px-6 pt-28">
          <p className="text-sabu-moss">Loading payment…</p>
        </main>
      }
    >
      <PayInner />
    </Suspense>
  );
}
