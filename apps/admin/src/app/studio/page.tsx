"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { loadSession } from "../../lib/session";

export default function StudioAdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [models, setModels] = useState<
    Awaited<ReturnType<typeof adminApi.studioModels>>
  >([]);
  const [pending, setPending] = useState<
    Awaited<ReturnType<typeof adminApi.studioPending>>
  >([]);
  const [products, setProducts] = useState<
    Awaited<ReturnType<typeof adminApi.listProducts>>
  >([]);
  const [productId, setProductId] = useState("");
  const [modelId, setModelId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    Promise.all([
      adminApi.studioModels(s.accessToken),
      adminApi.studioPending(s.accessToken),
      adminApi.listProducts(s.accessToken),
    ])
      .then(([m, p, products]) => {
        setModels(m);
        setPending(p);
        setProducts(products);
        setModelId(m[0]?.id ?? "");
        setProductId(products[0]?.id ?? "");
      })
      .catch(() => undefined);
  }, []);

  async function generate(e: FormEvent) {
    e.preventDefault();
    if (!token || !productId || !modelId) return;
    setError(null);
    try {
      await adminApi.studioGenerate(token, { productId, modelId });
      setMessage("Mock generation completed — pending review");
      setPending(await adminApi.studioPending(token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Generate failed");
    }
  }

  async function approve(id: string) {
    if (!token) return;
    await adminApi.studioApprove(token, id);
    setPending(await adminApi.studioPending(token));
    setMessage("Published AI preview");
  }

  async function reject(id: string) {
    if (!token) return;
    await adminApi.studioReject(token, id);
    setPending(await adminApi.studioPending(token));
    setMessage("Rejected");
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
    <main className="min-h-screen bg-[#0f1412] px-6 py-12 text-[#eef2ef]">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-[#8aa897]">
          ← Admin
        </Link>
        <h1 className="mt-4 text-3xl">AI Studio</h1>
        <p className="mt-2 text-sm text-[#9eb0a6]">
          Synthetic/licensed models only. Outputs are labeled AI preview until
          approved.
        </p>

        <form onSubmit={generate} className="mt-8 space-y-3">
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="w-full bg-[#17201c] px-3 py-2 text-sm"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="w-full bg-[#17201c] px-3 py-2 text-sm"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName} ({m.ageGroup})
              </option>
            ))}
          </select>
          <button type="submit" className="bg-[#2f6b4f] px-4 py-2 text-sm">
            Run mock generate
          </button>
        </form>

        {message && <p className="mt-4 text-sm text-[#2f6b4f]">{message}</p>}
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <h2 className="mt-10 text-xl">Pending review</h2>
        <ul className="mt-4 divide-y divide-[#24302a] border-t border-[#24302a]">
          {pending.length === 0 && (
            <li className="py-4 text-[#8aa897]">No pending images</li>
          )}
          {pending.map((img) => (
            <li
              key={img.id}
              className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm"
            >
              <span>
                {img.productName}
                <span className="mt-1 block text-[#8aa897]">{img.storageKey}</span>
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => approve(img.id)}
                  className="bg-[#2f6b4f] px-3 py-2"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => reject(img.id)}
                  className="border border-[#24302a] px-3 py-2"
                >
                  Reject
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
