"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { loadSession } from "../../lib/session";

type Partner = Awaited<ReturnType<typeof adminApi.listPartners>>[number];

const COUNTRIES = [
  { code: "AE", label: "United Arab Emirates (Dubai)" },
  { code: "CN", label: "China" },
  { code: "US", label: "United States" },
];

const emptyForm = {
  name: "",
  countryCode: "AE",
  city: "",
  contactName: "",
  whatsapp: "+",
  email: "",
  portalEnabled: true,
  isActive: true,
};

export default function PartnersPage() {
  const [token, setToken] = useState<string | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(access: string) {
    setPartners(await adminApi.listPartners(access));
  }

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    refresh(s.accessToken).catch((err: unknown) =>
      setError(err instanceof ApiError ? err.message : "Load failed"),
    );
  }, []);

  function startEdit(p: Partner) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      countryCode: p.countryCode,
      city: p.city ?? "",
      contactName: p.contactName ?? "",
      whatsapp: p.whatsapp ?? "+",
      email: p.email ?? "",
      portalEnabled: p.portalEnabled,
      isActive: p.isActive,
    });
    setMessage(null);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const payload = {
      name: form.name.trim(),
      countryCode: form.countryCode,
      city: form.city.trim() || undefined,
      contactName: form.contactName.trim() || undefined,
      whatsapp: form.whatsapp.trim() === "+" ? undefined : form.whatsapp.trim(),
      email: form.email.trim() || undefined,
      portalEnabled: form.portalEnabled,
      isActive: form.isActive,
    };
    try {
      if (editingId) {
        await adminApi.updatePartner(token, editingId, {
          ...payload,
          city: form.city.trim() || null,
          contactName: form.contactName.trim() || null,
          whatsapp:
            form.whatsapp.trim() === "+" ? null : form.whatsapp.trim() || null,
          email: form.email.trim() || null,
        });
        setMessage("Partner updated");
        setEditingId(null);
      } else {
        await adminApi.createPartner(token, payload);
        setMessage("Partner added");
      }
      setForm(emptyForm);
      await refresh(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
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
      <div className="mx-auto max-w-4xl">
        <Link href="/?modules=1" className="text-sm text-[#8aa897]">
          ← Admin
        </Link>
        <h1 className="mt-2 text-3xl tracking-tight">Sourcing Partners</h1>
        <p className="mt-1 text-sm text-[#9eb0a6]">
          USA, China, and Dubai procurement partners for special orders. Add or
          edit contacts here — they appear when assigning a special order.
        </p>

        <form
          onSubmit={onSubmit}
          className="mt-8 space-y-3 border border-[#24302a] p-4"
        >
          <h2 className="text-lg">
            {editingId ? "Edit partner" : "Add partner"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Partner name"
              className="bg-[#17201c] px-3 py-2 text-sm sm:col-span-2"
            />
            <select
              value={form.countryCode}
              onChange={(e) =>
                setForm({ ...form, countryCode: e.target.value })
              }
              className="bg-[#17201c] px-3 py-2 text-sm"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              placeholder="City"
              className="bg-[#17201c] px-3 py-2 text-sm"
            />
            <input
              value={form.contactName}
              onChange={(e) =>
                setForm({ ...form, contactName: e.target.value })
              }
              placeholder="Contact person"
              className="bg-[#17201c] px-3 py-2 text-sm"
            />
            <input
              value={form.whatsapp}
              onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
              placeholder="WhatsApp +971..."
              className="bg-[#17201c] px-3 py-2 text-sm"
            />
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="Email"
              className="bg-[#17201c] px-3 py-2 text-sm sm:col-span-2"
            />
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-[#9eb0a6]">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) =>
                  setForm({ ...form, isActive: e.target.checked })
                }
              />
              Active
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.portalEnabled}
                onChange={(e) =>
                  setForm({ ...form, portalEnabled: e.target.checked })
                }
              />
              Portal enabled
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="bg-[#2f6b4f] px-4 py-2 text-sm disabled:opacity-50"
            >
              {busy
                ? "Saving…"
                : editingId
                  ? "Save changes"
                  : "Add partner"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={cancelEdit}
                className="border border-[#24302a] px-4 py-2 text-sm"
              >
                Cancel
              </button>
            )}
          </div>
          {message && <p className="text-sm text-[#2f6b4f]">{message}</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </form>

        <ul className="mt-8 divide-y divide-[#24302a] border-t border-[#24302a]">
          {partners.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-start justify-between gap-3 py-4 text-sm"
            >
              <div>
                <p className="font-medium">
                  {p.name}{" "}
                  <span className="text-[#8aa897]">
                    {p.countryCode} · {p.code}
                  </span>
                </p>
                <p className="text-xs text-[#9eb0a6]">
                  {p.city || "—"} · {p.contactName || "—"} · WhatsApp{" "}
                  {p.whatsapp ?? "—"} · {p.email ?? "—"}
                </p>
                <p className="text-xs text-[#8aa897]">
                  {p.isActive ? "active" : "inactive"}
                  {p.portalEnabled ? " · portal enabled" : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => startEdit(p)}
                className="border border-[#24302a] px-3 py-1.5 text-xs"
              >
                Edit
              </button>
            </li>
          ))}
          {partners.length === 0 && (
            <li className="py-6 text-[#8aa897]">
              No partners yet — add one above.
            </li>
          )}
        </ul>
      </div>
    </main>
  );
}
