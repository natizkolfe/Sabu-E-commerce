"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { formatLabel } from "../../lib/format";
import { loadSession } from "../../lib/session";

type Driver = Awaited<ReturnType<typeof adminApi.deliveryDrivers>>[number];
type Zone = Awaited<ReturnType<typeof adminApi.deliveryZones>>[number];

export default function DriversAdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("+2519");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseExpiry, setLicenseExpiry] = useState("");
  const [employmentType, setEmploymentType] = useState<
    "contractor" | "employee"
  >("contractor");
  const [zoneId, setZoneId] = useState("");
  const [availability, setAvailability] = useState<
    "available" | "offline" | "on_break"
  >("available");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (accessToken: string) => {
    const [list, z] = await Promise.all([
      adminApi.deliveryDrivers(accessToken, true),
      adminApi.deliveryZones(accessToken),
    ]);
    setDrivers(list);
    setZones(z);
    setZoneId((prev) => prev || z[0]?.id || "");
  }, []);

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    // Default expiry ~1 year from today
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    setLicenseExpiry(d.toISOString().slice(0, 10));
    refresh(s.accessToken).catch(() => undefined);
  }, [refresh]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const created = await adminApi.createDriver(token, {
        fullName,
        phone,
        licenseNumber,
        licenseExpiry,
        employmentType,
        homeZoneId: zoneId || undefined,
        availability,
        activate: true,
      });
      setMessage(`Added ${created.code} — ${created.name}`);
      setFullName("");
      setPhone("+2519");
      setLicenseNumber("");
      await refresh(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: string) {
    if (!token) return;
    try {
      await adminApi.updateDriver(token, id, { status });
      await refresh(token);
      setMessage("Driver updated");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  async function setAvail(id: string, availability: string) {
    if (!token) return;
    try {
      await adminApi.updateDriver(token, id, { availability });
      await refresh(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
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
    <main className="min-h-screen bg-[#0f1412] px-4 py-10 text-[#eef2ef] sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/" className="text-sm text-[#8aa897]">
              ← Admin
            </Link>
            <h1 className="mt-2 text-3xl tracking-tight">Drivers</h1>
            <p className="mt-1 text-sm text-[#9eb0a6]">
              Add drivers for manual phone assignment. They appear in Delivery
              dispatch when available.
            </p>
          </div>
          <Link
            href="/deliveries"
            className="border border-[#24302a] px-3 py-2 text-sm text-[#b7c7be]"
          >
            Open dispatch →
          </Link>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.1fr)]">
          <form
            onSubmit={onCreate}
            className="space-y-3 border border-[#24302a] p-4"
          >
            <h2 className="text-lg">Add driver</h2>
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Full name"
              className="w-full bg-[#17201c] px-3 py-2 text-sm"
            />
            <input
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+2519..."
              className="w-full bg-[#17201c] px-3 py-2 text-sm"
            />
            <input
              required
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              placeholder="License number"
              className="w-full bg-[#17201c] px-3 py-2 text-sm"
            />
            <input
              required
              type="date"
              value={licenseExpiry}
              onChange={(e) => setLicenseExpiry(e.target.value)}
              className="w-full bg-[#17201c] px-3 py-2 text-sm"
            />
            <select
              value={employmentType}
              onChange={(e) =>
                setEmploymentType(e.target.value as "contractor" | "employee")
              }
              className="w-full bg-[#17201c] px-3 py-2 text-sm"
            >
              <option value="contractor">Contractor</option>
              <option value="employee">Employee</option>
            </select>
            <select
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
              className="w-full bg-[#17201c] px-3 py-2 text-sm"
            >
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
            <select
              value={availability}
              onChange={(e) =>
                setAvailability(
                  e.target.value as "available" | "offline" | "on_break",
                )
              }
              className="w-full bg-[#17201c] px-3 py-2 text-sm"
            >
              <option value="available">Available</option>
              <option value="on_break">On break</option>
              <option value="offline">Offline</option>
            </select>
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-[#2f6b4f] px-4 py-2 text-sm disabled:opacity-60"
            >
              {busy ? "Saving…" : "Add driver"}
            </button>
            {message && <p className="text-sm text-[#2f6b4f]">{message}</p>}
            {error && <p className="text-sm text-red-400">{error}</p>}
          </form>

          <section className="border border-[#24302a]">
            <div className="border-b border-[#24302a] px-3 py-2 text-sm text-[#8aa897]">
              Fleet ({drivers.length})
            </div>
            <ul className="max-h-[70vh] divide-y divide-[#24302a] overflow-y-auto">
              {drivers.map((d) => (
                <li key={d.id} className="px-3 py-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {d.name}{" "}
                        <span className="text-xs text-[#8aa897]">{d.code}</span>
                      </p>
                      <p className="text-xs text-[#9eb0a6]">
                        {d.phone} · {d.zoneName ?? "no zone"} · load{" "}
                        {d.activeDeliveries}
                      </p>
                      <p className="mt-1 text-[11px] text-[#8aa897]">
                        {formatLabel(d.status)} · {formatLabel(d.availability)} ·{" "}
                        {d.employmentType ?? "—"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => setAvail(d.id, "available")}
                        className="border border-[#24302a] px-2 py-1 text-[11px]"
                      >
                        Available
                      </button>
                      <button
                        type="button"
                        onClick={() => setAvail(d.id, "offline")}
                        className="border border-[#24302a] px-2 py-1 text-[11px]"
                      >
                        Offline
                      </button>
                      {d.status !== "active" ? (
                        <button
                          type="button"
                          onClick={() => setStatus(d.id, "active")}
                          className="bg-[#2f6b4f] px-2 py-1 text-[11px]"
                        >
                          Activate
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setStatus(d.id, "suspended")}
                          className="border border-[#24302a] px-2 py-1 text-[11px]"
                        >
                          Suspend
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
              {drivers.length === 0 && (
                <li className="px-3 py-6 text-sm text-[#8aa897]">
                  No drivers yet — add one on the left.
                </li>
              )}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
