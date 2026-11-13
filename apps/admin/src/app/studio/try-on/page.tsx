"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { API_URL, adminApi, ApiError, mediaUrl } from "../../../lib/api";
import { loadSession } from "../../../lib/session";

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/** Optional try-on previews — separate from catalog photo enhance. */
export default function TryOnStudioPage() {
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
  const [sourceImageKey, setSourceImageKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    Promise.all([
      adminApi.studioModels(s.accessToken),
      adminApi.studioPending(s.accessToken, { jobType: "try_on" }),
      adminApi.listProducts(s.accessToken),
    ])
      .then(([m, p, productRows]) => {
        setModels(m);
        setPending(p);
        setProducts(productRows);
        setModelId(m[0]?.id ?? "");
        setProductId(productRows[0]?.id ?? "");
      })
      .catch((err: unknown) => {
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load try-on studio",
        );
      });
  }, []);

  async function uploadSource(file: File) {
    if (!token || !productId) return;
    setBusy(true);
    setError(null);
    try {
      const data = await fileToDataUrl(file);
      const uploaded = await adminApi.uploadMedia(token, {
        data,
        folder: `products/${productId}/source`,
        mimeType: file.type || undefined,
      });
      setSourceImageKey(uploaded.storageKey);
      setMessage("Source photo uploaded");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function generate(e: FormEvent) {
    e.preventDefault();
    if (!token || !productId || !modelId) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.studioGenerate(token, {
        productId,
        modelId,
        jobType: "try_on",
        sourceImageKey: sourceImageKey || undefined,
      });
      setMessage("Try-on preview ready for review");
      setPending(
        await adminApi.studioPending(token, { jobType: "try_on" }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Generate failed");
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: string) {
    if (!token) return;
    await adminApi.studioApprove(token, id);
    setPending(await adminApi.studioPending(token, { jobType: "try_on" }));
    setMessage("Approved — published to product try-on previews");
  }

  async function reject(id: string) {
    if (!token) return;
    await adminApi.studioReject(token, id);
    setPending(await adminApi.studioPending(token, { jobType: "try_on" }));
    setMessage("Rejected");
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
    <main className="min-h-screen bg-[#0f1412] px-6 py-12 text-[#eef2ef]">
      <div className="mx-auto max-w-4xl">
        <Link href="/studio" className="text-sm text-[#8aa897]">
          ← Enhance photos
        </Link>
        <div className="mt-2">
          <p className="text-[10px] uppercase tracking-wide text-[#8aa897]">
            Optional
          </p>
          <h1 className="text-3xl">Try-on preview</h1>
          <p className="mt-2 max-w-xl text-sm text-[#9eb0a6]">
            Virtual model try-ons are optional. Use them only when you need a
            lifestyle/preview shot — not for standard catalog photos. For clean
            product images, use{" "}
            <Link href="/studio" className="text-[#9dcdb4] underline">
              Enhance photos
            </Link>
            .
          </p>
        </div>

        {message && <p className="mt-4 text-sm text-[#2f6b4f]">{message}</p>}
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <form
          onSubmit={generate}
          className="mt-8 space-y-3 border border-[#24302a] p-4"
        >
          <label className="block text-xs text-[#8aa897]">
            Product
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="mt-1 w-full bg-[#17201c] px-3 py-2 text-sm"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-[#8aa897]">
            Virtual model
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="mt-1 w-full bg-[#17201c] px-3 py-2 text-sm"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} · {m.ageGroup}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-[#8aa897]">
            Source photo (optional)
            <input
              type="file"
              accept="image/*"
              className="mt-1 block w-full text-xs"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadSource(f);
              }}
            />
            {sourceImageKey && (
              <span className="mt-1 block truncate text-[10px] text-[#8aa897]">
                {sourceImageKey}
              </span>
            )}
          </label>
          <button
            type="submit"
            disabled={busy || !productId || !modelId}
            className="bg-[#2f6b4f] px-4 py-2 text-sm disabled:opacity-50"
          >
            {busy ? "Working…" : "Generate try-on"}
          </button>
        </form>

        <section className="mt-10">
          <h2 className="text-lg">Pending try-ons</h2>
          <ul className="mt-4 divide-y divide-[#24302a]">
            {pending.length === 0 && (
              <li className="py-4 text-[#8aa897]">No pending try-ons</li>
            )}
            {pending.map((img) => {
              const previewSrc = `${API_URL}${img.previewUrl ?? `/studio/images/${img.id}/preview`}`;
              const sourceSrc = img.sourceUrl
                ? `${API_URL}${img.sourceUrl}`
                : img.sourceImageKey
                  ? mediaUrl(img.sourceImageKey)
                  : null;
              return (
                <li key={img.id} className="py-4">
                  <p className="text-sm font-medium">{img.productName}</p>
                  <p className="text-[11px] text-[#8aa897]">
                    Try-on · {img.modelName ?? "model"}
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-xl border border-[#24302a] bg-[#17201c]">
                      {sourceSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={sourceSrc}
                          alt="Source"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-xs text-[#8aa897]">No source</span>
                      )}
                    </div>
                    <div className="overflow-hidden rounded-xl border border-[#24302a]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewSrc}
                        alt="Try-on"
                        className="aspect-[3/4] w-full object-cover"
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void approve(img.id)}
                      className="bg-[#2f6b4f] px-3 py-1.5 text-sm"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => void reject(img.id)}
                      className="border border-[#24302a] px-3 py-1.5 text-sm"
                    >
                      Reject
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </main>
  );
}
