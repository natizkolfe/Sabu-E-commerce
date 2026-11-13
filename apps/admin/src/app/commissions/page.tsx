"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { formatLabel } from "../../lib/format";
import { loadSession } from "../../lib/session";

export default function CommissionsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [rule, setRule] = useState<{ ratePct: number; code: string } | null>(
    null,
  );
  const [rows, setRows] = useState<
    Awaited<ReturnType<typeof adminApi.listCommissions>>
  >([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    Promise.all([
      adminApi.commissionRule(s.accessToken),
      adminApi.listCommissions(s.accessToken),
    ])
      .then(([r, list]) => {
        setRule(r);
        setRows(list);
      })
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

  return (
    <main className="min-h-screen bg-[#0f1412] px-4 py-10 text-[#eef2ef] sm:px-6">
      <div className="mx-auto max-w-4xl">
        <Link href="/?modules=1" className="text-sm text-[#8aa897]">
          ← Admin
        </Link>
        <h1 className="mt-2 text-3xl tracking-tight">Commissions</h1>
        <p className="mt-1 text-sm text-[#9eb0a6]">
          Marketplace service fee ledger. Default rule:{" "}
          {rule ? `${rule.ratePct}% (${rule.code})` : "…"}
        </p>
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        <ul className="mt-8 divide-y divide-[#24302a] border-t border-[#24302a] text-sm">
          {rows.length === 0 && (
            <li className="py-6 text-[#8aa897]">
              No commission entries yet. They accrue when vendor order lines are
              finalized.
            </li>
          )}
          {rows.map((r) => (
            <li key={r.id} className="flex justify-between gap-4 py-3">
              <span>
                {r.orderNumber} · {r.vendorName}
                <span className="mt-0.5 block text-xs text-[#8aa897]">
                  {formatLabel(r.entryType)} · {formatLabel(r.status)} ·{" "}
                  {r.ratePct}%
                </span>
              </span>
              <span className="text-right">
                {r.commissionAmount} ETB
                <span className="mt-0.5 block text-xs text-[#8aa897]">
                  on {r.grossAmount}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
