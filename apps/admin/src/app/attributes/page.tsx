"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { loadSession } from "../../lib/session";

const DATA_TYPES = [
  "text",
  "number",
  "dropdown",
  "multi_select",
  "boolean",
  "color",
  "measurement",
] as const;

type Attribute = Awaited<ReturnType<typeof adminApi.listAttributes>>[number];

export default function AttributesAdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [items, setItems] = useState<Attribute[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [dataType, setDataType] = useState<string>("dropdown");
  const [unit, setUnit] = useState("");
  const [isFilterable, setIsFilterable] = useState(true);

  const [valueCode, setValueCode] = useState("");
  const [valueLabel, setValueLabel] = useState("");

  const selected = items.find((a) => a.id === selectedId) ?? null;

  const refresh = useCallback(async (accessToken: string) => {
    setItems(await adminApi.listAttributes(accessToken));
  }, []);

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    refresh(s.accessToken).catch((err: unknown) =>
      setError(err instanceof ApiError ? err.message : "Failed to load"),
    );
  }, [refresh]);

  function select(a: Attribute) {
    setSelectedId(a.id);
    setCode(a.code);
    setName(a.name);
    setDataType(a.dataType ?? "dropdown");
    setUnit(a.unit ?? "");
    setIsFilterable(a.isFilterable !== false);
    setMessage(null);
    setError(null);
  }

  function resetForm() {
    setSelectedId(null);
    setCode("");
    setName("");
    setDataType("dropdown");
    setUnit("");
    setIsFilterable(true);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!token || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (selectedId) {
        await adminApi.updateAttribute(token, selectedId, {
          name: name.trim(),
          dataType,
          unit: unit || null,
          isFilterable,
        });
        setMessage("Attribute updated");
      } else {
        const created = await adminApi.createAttribute(token, {
          code: code.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_"),
          name: name.trim(),
          dataType,
          unit: unit || null,
          isFilterable,
        });
        setSelectedId(created.id);
        setMessage("Attribute created — assign it to categories next");
      }
      await refresh(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function addValue(e: FormEvent) {
    e.preventDefault();
    if (!token || !selectedId || !valueCode.trim() || !valueLabel.trim()) return;
    setBusy(true);
    try {
      await adminApi.addAttributeValue(token, selectedId, {
        code: valueCode.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_"),
        label: valueLabel.trim(),
      });
      setValueCode("");
      setValueLabel("");
      setMessage("Value added");
      await refresh(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Value failed");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <main className="min-h-screen bg-[#0f1412] px-6 py-16 text-[#eef2ef]">
        <p>Sign in from the home page first.</p>
        <Link href="/?modules=1" className="mt-4 inline-block text-[#8aa897]">
          ← Admin home
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0f1412] px-4 py-10 text-[#eef2ef] sm:px-6">
      <div className="mx-auto max-w-5xl">
        <Link href="/?modules=1" className="text-sm text-[#8aa897]">
          ← Admin
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl tracking-tight">Product attributes</h1>
            <p className="mt-1 text-sm text-[#9eb0a6]">
              Define flexible specs (size, fabric, warranty…) then assign them
              per category — no code changes.
            </p>
          </div>
          <button
            type="button"
            onClick={resetForm}
            className="border border-[#24302a] px-3 py-2 text-sm"
          >
            New attribute
          </button>
        </div>

        {message && <p className="mt-4 text-sm text-[#2f6b4f]">{message}</p>}
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className="border border-[#24302a]">
            <div className="border-b border-[#24302a] px-3 py-2 text-sm text-[#8aa897]">
              Definitions
            </div>
            <ul className="max-h-[70vh] divide-y divide-[#24302a] overflow-y-auto">
              {items.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => select(a)}
                    className={`flex w-full justify-between px-3 py-2.5 text-left text-sm ${
                      selectedId === a.id ? "bg-[#14201a]" : ""
                    }`}
                  >
                    <span>
                      {a.name}
                      <span className="ml-2 text-[11px] text-[#8aa897]">
                        {a.code}
                      </span>
                    </span>
                    <span className="text-[11px] text-[#8aa897]">
                      {a.dataType ?? "dropdown"} · {a.values.length} vals
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="border border-[#24302a] p-4">
            <h2 className="text-xl">
              {selected ? `Edit · ${selected.name}` : "Create attribute"}
            </h2>
            <form onSubmit={onSave} className="mt-4 space-y-3 text-sm">
              {!selectedId && (
                <label className="block text-xs text-[#8aa897]">
                  Code
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="mt-1 w-full bg-[#17201c] px-3 py-2 font-mono text-xs"
                    placeholder="fabric"
                    required
                  />
                </label>
              )}
              <label className="block text-xs text-[#8aa897]">
                Name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full bg-[#17201c] px-3 py-2"
                  required
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-[#8aa897]">
                  Data type
                  <select
                    value={dataType}
                    onChange={(e) => setDataType(e.target.value)}
                    className="mt-1 w-full bg-[#17201c] px-3 py-2"
                  >
                    {DATA_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-[#8aa897]">
                  Unit (optional)
                  <input
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="mt-1 w-full bg-[#17201c] px-3 py-2"
                    placeholder="cm, ml…"
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={isFilterable}
                  onChange={(e) => setIsFilterable(e.target.checked)}
                />
                Filterable on storefront
              </label>
              <button
                type="submit"
                disabled={busy}
                className="bg-[#2f6b4f] px-4 py-2 text-sm disabled:opacity-50"
              >
                {selectedId ? "Save attribute" : "Create attribute"}
              </button>
            </form>

            {selectedId && (
              <div className="mt-8 border-t border-[#24302a] pt-4">
                <h3 className="text-sm text-[#8aa897]">Values</h3>
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm">
                  {(selected?.values ?? []).map((v) => (
                    <li key={v.id} className="text-[#b7c7be]">
                      {v.label}{" "}
                      <span className="text-[11px] text-[#8aa897]">
                        ({v.code})
                      </span>
                    </li>
                  ))}
                  {!selected?.values.length && (
                    <li className="text-[#8aa897]">No values yet</li>
                  )}
                </ul>
                <form
                  onSubmit={addValue}
                  className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                >
                  <input
                    value={valueCode}
                    onChange={(e) => setValueCode(e.target.value)}
                    placeholder="code"
                    className="bg-[#17201c] px-3 py-2 text-sm"
                  />
                  <input
                    value={valueLabel}
                    onChange={(e) => setValueLabel(e.target.value)}
                    placeholder="Label"
                    className="bg-[#17201c] px-3 py-2 text-sm"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="border border-[#24302a] px-3 py-2 text-sm"
                  >
                    Add
                  </button>
                </form>
                <p className="mt-3 text-[11px] text-[#8aa897]">
                  Assign attributes to categories on the{" "}
                  <Link href="/categories" className="text-[#9dcdb4]">
                    Categories
                  </Link>{" "}
                  page.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
