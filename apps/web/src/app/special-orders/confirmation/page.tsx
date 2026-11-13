"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type ConfirmationSnapshot = {
  id: string;
  requestNumber: string;
  status: string;
  statusLabel: string;
  productName: string;
  guestName: string;
  sourcingRegion: string;
  sourcingRegionName: string;
  quantity: number;
  submittedAt: string;
  message: string;
};

function ConfirmationInner() {
  const params = useSearchParams();
  const requestNumber = params.get("requestNumber") ?? "";
  const [snapshot, setSnapshot] = useState<ConfirmationSnapshot | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!requestNumber) return;
    try {
      const raw = sessionStorage.getItem(`sabu_sor_${requestNumber}`);
      if (raw) setSnapshot(JSON.parse(raw) as ConfirmationSnapshot);
    } catch {
      /* ignore */
    }
  }, [requestNumber]);

  async function copyRequestNumber() {
    if (!requestNumber) return;
    try {
      await navigator.clipboard.writeText(requestNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const submittedAt = snapshot?.submittedAt
    ? new Date(snapshot.submittedAt).toLocaleString()
    : new Date().toLocaleString();

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f7faf8_0%,#eef5f0_55%,#f7faf8_100%)] px-6 py-16 text-sabu-ink">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/"
          className="text-sm text-sabu-moss transition hover:text-sabu-leaf"
        >
          ← Home
        </Link>

        <p className="mt-8 text-xs tracking-[0.24em] text-sabu-moss uppercase">
          Request received
        </p>
        <h1 className="mt-3 font-[family-name:var(--font-syne)] text-3xl tracking-tight sm:text-4xl">
          Thank you for submitting your special order request!
        </h1>
        <div className="mt-5 space-y-3 text-sabu-moss">
          <p>
            Our team will review your request and contact you once we find your
            requested item. We will provide the product price, shipping costs,
            and estimated delivery time before proceeding.
          </p>
          <p>
            Your item will be shipped once your payment has been received and
            verified.
          </p>
          <p>Thank you for choosing Sabu Online Shopping!</p>
        </div>

        <div className="mt-10 space-y-4 border-t border-sabu-moss/20 pt-8 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs tracking-wide text-sabu-moss uppercase">
                Special order request number
              </p>
              <p className="mt-1 font-[family-name:var(--font-syne)] text-2xl">
                {requestNumber || "—"}
              </p>
            </div>
            <button
              type="button"
              onClick={copyRequestNumber}
              disabled={!requestNumber}
              className="border border-sabu-leaf px-4 py-2 text-sabu-leaf transition hover:bg-sabu-leaf hover:text-white disabled:opacity-40"
            >
              {copied ? "Copied" : "Copy request number"}
            </button>
          </div>

          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-sabu-moss">Customer</dt>
              <dd className="mt-1">{snapshot?.guestName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-sabu-moss">Requested product</dt>
              <dd className="mt-1">{snapshot?.productName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-sabu-moss">Selected country</dt>
              <dd className="mt-1">{snapshot?.sourcingRegionName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-sabu-moss">Submission date</dt>
              <dd className="mt-1">{submittedAt}</dd>
            </div>
            <div>
              <dt className="text-xs text-sabu-moss">Request status</dt>
              <dd className="mt-1">
                {snapshot?.statusLabel ?? "Request Received"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-10 flex flex-wrap gap-4 text-sm">
          <Link
            href="/special-orders"
            className="border-b border-sabu-leaf pb-1 text-sabu-leaf"
          >
            Submit another request
          </Link>
          <Link href="/catalog" className="border-b border-sabu-moss/40 pb-1">
            Continue shopping
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function SpecialOrderConfirmationPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#f7faf8] px-6 py-16 text-sabu-ink">
          Loading confirmation…
        </main>
      }
    >
      <ConfirmationInner />
    </Suspense>
  );
}
