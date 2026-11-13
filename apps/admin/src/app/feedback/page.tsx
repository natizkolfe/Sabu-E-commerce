"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { loadSession } from "../../lib/session";

export default function FeedbackPage() {
  const [token, setToken] = useState<string | null>(null);
  const [rows, setRows] = useState<
    Awaited<ReturnType<typeof adminApi.listOrderFeedback>>
  >([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    adminApi
      .listOrderFeedback(s.accessToken)
      .then(setRows)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "Load failed"),
      );
  }, []);

  if (!token) {
    return (
      <main className="min-h-screen bg-[#0f1412] px-6 py-16 text-[#eef2ef]">
        <Link href="/?modules=1" className="text-[#8aa897]">
          ← Admin
        </Link>
      </main>
    );
  }

  const avg =
    rows.length === 0
      ? null
      : rows.reduce((s, r) => s + r.overallRating, 0) / rows.length;

  return (
    <main className="min-h-screen bg-[#0f1412] px-4 py-10 text-[#eef2ef] sm:px-6">
      <div className="mx-auto max-w-4xl">
        <Link href="/?modules=1" className="text-sm text-[#8aa897]">
          ← Admin
        </Link>
        <h1 className="mt-2 text-3xl tracking-tight">Customer feedback</h1>
        <p className="mt-1 text-sm text-[#9eb0a6]">
          Ratings submitted after checkout / from the track order page.
          {avg != null ? ` Average overall: ${avg.toFixed(1)} / 5` : ""}
        </p>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <ul className="mt-8 divide-y divide-[#24302a] border-t border-[#24302a] text-sm">
          {rows.length === 0 && (
            <li className="py-6 text-[#8aa897]">No feedback yet.</li>
          )}
          {rows.map((r) => (
            <li key={r.id} className="space-y-1 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {r.orderNumber}
                  {r.customerName ? ` · ${r.customerName}` : ""}
                </p>
                <p className="text-[#9dcdb4]">
                  {"★".repeat(r.overallRating)}
                  <span className="text-[#6f857a]">
                    {"★".repeat(5 - r.overallRating)}
                  </span>
                </p>
              </div>
              <p className="text-xs text-[#8aa897]">
                {new Date(r.createdAt).toLocaleString()}
                {r.serviceRating != null
                  ? ` · Website ${r.serviceRating}/5`
                  : ""}
                {r.productRating != null
                  ? ` · Interactive ${r.productRating}/5`
                  : ""}
                {r.deliveryRating != null
                  ? ` · Delivery ${r.deliveryRating}/5`
                  : ""}
                {r.wouldRecommend != null
                  ? r.wouldRecommend
                    ? " · Would recommend"
                    : " · Would not recommend"
                  : ""}
              </p>
              {r.comment && (
                <p className="text-[#c9d6ce]">“{r.comment}”</p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
