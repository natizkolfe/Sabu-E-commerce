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
        if (!m.length) {
          setError(
            "No AI models available. Sign out/in if you just got studio permissions.",
          );
        }
      })
      .catch((err: unknown) => {
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load AI Studio (check studio.generate permission)",
        );
      });
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
    setMessage("Published — visible on the product catalog page");
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
          <label className="block text-xs text-[#8aa897]">
            Product
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="mt-1 w-full bg-[#17201c] px-3 py-2 text-sm text-[#eef2ef]"
            >
              {products.length === 0 && (
                <option value="">No products loaded</option>
              )}
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-[#8aa897]">
            AI model / tool
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="mt-1 w-full bg-[#17201c] px-3 py-2 text-sm text-[#eef2ef]"
            >
              {models.length === 0 && (
                <option value="">No AI models — check permissions</option>
              )}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                  {m.genderLabel ? ` · ${m.genderLabel}` : ""} · {m.ageGroup}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={!productId || !modelId}
            className="bg-[#2f6b4f] px-4 py-2 text-sm disabled:opacity-50"
          >
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
          {pending.map((img) => {
            const previewSrc = `${
              process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
              "http://localhost:3001/v1"
            }/studio/images/${img.id}/preview`;
            return (
              <li
                key={img.id}
                className="flex flex-wrap items-start justify-between gap-3 py-4 text-sm"
              >
                <div className="flex gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewSrc}
                    alt=""
                    className="h-24 w-32 object-cover border border-[#24302a]"
                  />
                  <span>
                    {img.productName}
                    <span className="mt-1 block text-[#8aa897]">
                      {img.storageKey}
                    </span>
                    {img.productSlug && (
                      <a
                        href={`${process.env.NEXT_PUBLIC_WEB_URL ?? "http://localhost:3000"}/catalog/${img.productSlug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-xs text-[#9dcdb4] underline"
                      >
                        View product page
                      </a>
                    )}
                  </span>
                </div>
                <span className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => approve(img.id)}
                    className="bg-[#2f6b4f] px-3 py-2"
                  >
                    Approve & publish
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
            );
          })}
        </ul>
      </div>
    </main>
  );
}
