"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { API_URL, adminApi, ApiError, mediaUrl } from "../../lib/api";
import { loadSession } from "../../lib/session";

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function StudioAdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [models, setModels] = useState<
    Awaited<ReturnType<typeof adminApi.studioModels>>
  >([]);
  const [presets, setPresets] = useState<
    Awaited<ReturnType<typeof adminApi.studioTransformPresets>>
  >([]);
  const [pending, setPending] = useState<
    Awaited<ReturnType<typeof adminApi.studioPending>>
  >([]);
  const [products, setProducts] = useState<
    Awaited<ReturnType<typeof adminApi.listProducts>>
  >([]);
  const [mode, setMode] = useState<"product_transform" | "try_on">(
    "product_transform",
  );
  const [productId, setProductId] = useState("");
  const [modelId, setModelId] = useState("");
  const [preset, setPreset] = useState<
    "studio_packshot" | "ghost_mannequin" | "background_cleanup"
  >("studio_packshot");
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
      adminApi.studioPending(s.accessToken),
      adminApi.listProducts(s.accessToken),
      adminApi.studioTransformPresets(s.accessToken).catch(() => []),
    ])
      .then(([m, p, productRows, presetRows]) => {
        setModels(m);
        setPending(p);
        setProducts(productRows);
        setPresets(presetRows);
        setModelId(m[0]?.id ?? "");
        setProductId(productRows[0]?.id ?? "");
        if (presetRows[0]?.code) {
          setPreset(
            presetRows[0].code as
              | "studio_packshot"
              | "ghost_mannequin"
              | "background_cleanup",
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
      await adminApi.addProductImage(token, productId, {
        storageKey: uploaded.storageKey,
        source: "upload",
      });
      setMessage("Original phone photo uploaded");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function generate(e: FormEvent) {
    e.preventDefault();
    if (!token || !productId) return;
    setError(null);
    setBusy(true);
    try {
      if (mode === "product_transform") {
        await adminApi.studioGenerate(token, {
          productId,
          jobType: "product_transform",
          transformPreset: preset,
          sourceImageKey: sourceImageKey || undefined,
        });
        setMessage("Studio transform ready for review");
      } else {
        if (!modelId) return;
        await adminApi.studioGenerate(token, {
          productId,
          modelId,
          jobType: "try_on",
          sourceImageKey: sourceImageKey || undefined,
        });
        setMessage("Try-on preview ready for review");
      }
      setPending(await adminApi.studioPending(token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Generate failed");
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: string) {
    if (!token) return;
    await adminApi.studioApprove(token, id);
    setPending(await adminApi.studioPending(token));
    setMessage(
      "Approved — packshots become product images; try-ons publish to PDP",
    );
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
      <div className="mx-auto max-w-4xl">
        <Link href="/" className="text-sm text-[#8aa897]">
          ← Admin
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-3xl">AI Product Image Studio</h1>
            <p className="mt-2 text-sm text-[#9eb0a6]">
              Admin Portal — turn phone photos into studio-quality catalog
              images, or generate try-on previews. Customers only see approved
              results.
            </p>
          </div>
          <span className="rounded border border-[#24302a] px-2 py-1 text-[10px] uppercase tracking-wide text-[#8aa897]">
            Admin Portal
          </span>
        </div>

        {message && <p className="mt-4 text-sm text-[#2f6b4f]">{message}</p>}
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <form
          onSubmit={generate}
          className="mt-8 space-y-3 border border-[#24302a] p-4"
        >
          <div className="flex flex-wrap gap-2 text-sm">
            <button
              type="button"
              onClick={() => setMode("product_transform")}
              className={`px-3 py-1.5 ${
                mode === "product_transform"
                  ? "bg-[#2f6b4f]"
                  : "border border-[#24302a]"
              }`}
            >
              Phone → studio
            </button>
            <button
              type="button"
              onClick={() => setMode("try_on")}
              className={`px-3 py-1.5 ${
                mode === "try_on" ? "bg-[#2f6b4f]" : "border border-[#24302a]"
              }`}
            >
              Try-on preview
            </button>
          </div>

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
            Original phone photo (optional if product already has images)
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

          {mode === "product_transform" ? (
            <label className="block text-xs text-[#8aa897]">
              Transform preset
              <select
                value={preset}
                onChange={(e) =>
                  setPreset(
                    e.target.value as
                      | "studio_packshot"
                      | "ghost_mannequin"
                      | "background_cleanup",
                  )
                }
                className="mt-1 w-full bg-[#17201c] px-3 py-2 text-sm"
              >
                {(presets.length
                  ? presets
                  : [
                      {
                        code: "studio_packshot",
                        label: "Studio packshot",
                        description: "",
                      },
                      {
                        code: "ghost_mannequin",
                        label: "Ghost mannequin",
                        description: "",
                      },
                      {
                        code: "background_cleanup",
                        label: "Background cleanup",
                        description: "",
                      },
                    ]
                ).map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
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
          )}

          <button
            type="submit"
            disabled={busy || !productId}
            className="bg-[#2f6b4f] px-4 py-2 text-sm disabled:opacity-50"
          >
            {busy ? "Working…" : "Generate"}
          </button>
        </form>

        <section className="mt-10">
          <h2 className="text-lg">Pending review</h2>
          <ul className="mt-4 divide-y divide-[#24302a]">
            {pending.length === 0 && (
              <li className="py-4 text-[#8aa897]">No pending images</li>
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
                    {img.jobType === "product_transform"
                      ? `Transform · ${(img.transformPreset ?? "studio").replace(/_/g, " ")}`
                      : `Try-on · ${img.modelName ?? "model"}`}
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-[#8aa897]">
                        Original phone photo
                      </p>
                      <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-xl border border-[#24302a] bg-[#17201c]">
                        {sourceSrc ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={sourceSrc}
                            alt="Original"
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display =
                                "none";
                            }}
                          />
                        ) : (
                          <span className="px-3 text-center text-xs text-[#8aa897]">
                            No source file on disk (seed/placeholder key)
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-[#8aa897]">
                        Target studio quality
                      </p>
                      <div className="overflow-hidden rounded-xl border border-[#24302a]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={previewSrc}
                          alt="AI target"
                          className="aspect-[3/4] w-full object-cover"
                        />
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] text-[#8aa897]">
                    Illustrative examples, not an actual AI transformation of
                    the same garment.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => approve(img.id)}
                      className="bg-[#2f6b4f] px-3 py-1.5 text-sm"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => reject(img.id)}
                      className="border border-[#24302a] px-3 py-1.5 text-sm"
                    >
                      Reject
                    </button>
                    <a
                      href={`${process.env.NEXT_PUBLIC_WEB_URL ?? "http://localhost:3000"}/catalog/${img.productSlug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 text-sm text-[#8aa897]"
                    >
                      View product →
                    </a>
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
