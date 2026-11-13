"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { loadSession } from "../../lib/session";

export default function PartnersPage() {
  const [token, setToken] = useState<string | null>(null);
  const [partners, setPartners] = useState<
    Awaited<ReturnType<typeof adminApi.listPartners>>
  >([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    adminApi
      .listPartners(s.accessToken)
      .then(setPartners)
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
        <h1 className="mt-2 text-3xl tracking-tight">Sourcing Partners</h1>
        <p className="mt-1 text-sm text-[#9eb0a6]">
          USA, China, and Dubai procurement partners for special orders.
        </p>
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        <ul className="mt-8 divide-y divide-[#24302a] border-t border-[#24302a]">
          {partners.map((p) => (
            <li key={p.id} className="py-4 text-sm">
              <p className="font-medium">
                {p.name}{" "}
                <span className="text-[#8aa897]">
                  {p.countryCode} · {p.code}
                </span>
              </p>
              <p className="text-xs text-[#9eb0a6]">
                {p.city} · {p.contactName} · WhatsApp {p.whatsapp ?? "—"} ·{" "}
                {p.email ?? "—"}
              </p>
              <p className="text-xs text-[#8aa897]">
                {p.isActive ? "active" : "inactive"}
                {p.portalEnabled ? " · portal enabled" : ""}
              </p>
            </li>
          ))}
          {partners.length === 0 && (
            <li className="py-6 text-[#8aa897]">No partners seeded.</li>
          )}
        </ul>
      </div>
    </main>
  );
}
