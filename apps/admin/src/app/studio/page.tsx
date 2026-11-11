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

type StudioImage = Awaited<ReturnType<typeof adminApi.studioPending>>[number];

export default function EnhancePhotosPage() {
  const [token, setToken] = useState<string | null>(null);
  const [pending, setPending] = useState<StudioImage[]>([]);
  const [library, setLibrary] = useState<
    Awaited<ReturnType<typeof adminApi.studioLibrary>>
  >([]);
  const [products, setProducts] = useState<
    Awaited<ReturnType<typeof adminApi.listProducts>>
  >([]);
  const [attachProductId, setAttachProductId] = useState<Record<string, string>>(
    {},
  );
  const [preset, setPreset] = useState<
    | "white_background_ecommerce"
    | "studio_packshot"
    | "ghost_mannequin"
    | "background_cleanup"
  >("white_background_ecommerce");
  const [presets, setPresets] = useState<
    Awaited<ReturnType<typeof adminApi.studioTransformPresets>>
  >([]);
  const [sourceImageKey, setSourceImageKey] = useState("");
  const [removeBackground, setRemoveBackground] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload(accessToken: string) {
    const [p, lib, productRows] = await Promise.all([
      adminApi.studioPending(accessToken, { jobType: "product_transform" }),
      adminApi.studioLibrary(accessToken),
      adminApi.listProducts(accessToken),
    ]);
    setPending(p);
    setLibrary(lib);
    setProducts(productRows);
  }

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    Promise.all([
      reload(s.accessToken),
      adminApi.studioTransformPresets(s.accessToken).catch(() => []),
    ])
      .then(([, presetRows]) => {
        setPresets(presetRows);
        const preferred =
          presetRows.find((row) => row.code === "white_background_ecommerce") ??
          presetRows[0];
        if (preferred?.code) {
          setPreset(
            preferred.code as
              | "white_background_ecommerce"
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
            : "Failed to load Enhance Photos",
        );
      });
  }, []);

  async function uploadSource(file: File) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const data = await fileToDataUrl(file);
      const uploaded = await adminApi.uploadMedia(token, {
        data,
        folder: "studio/staged/source",
        mimeType: file.type || undefined,
      });
      setSourceImageKey(uploaded.storageKey);
      setMessage("Phone photo uploaded — ready to enhance");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function enhance(e: FormEvent) {
    e.preventDefault();
    if (!token || !sourceImageKey) {
      setError("Upload a phone photo first");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await adminApi.studioGenerate(token, {
        jobType: "product_transform",
        transformPreset: preset,
        sourceImageKey,
        removeBackground,
      });
      setMessage(
        removeBackground
          ? "Enhanced with background removal — review & save"
          : "Placed on white canvas — review & save",
      );
      setSourceImageKey("");
      await reload(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Enhance failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveToLibrary(id: string) {
    if (!token) return;
    setBusy(true);
    try {
      await adminApi.studioSaveToLibrary(token, id);
      setMessage("Saved to library — use it when creating a product");
      await reload(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function attach(id: string) {
    if (!token) return;
    const pid = attachProductId[id];
    if (!pid) {
      setError("Select a product to assign this image");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminApi.studioAttach(token, id, {
        productId: pid,
        setPrimary: true,
        includeOriginal: true,
      });
      setMessage("Assigned to product gallery");
      await reload(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Assign failed");
    } finally {
      setBusy(false);
    }
  }

  async function reject(id: string) {
    if (!token) return;
    await adminApi.studioReject(token, id);
    setMessage("Discarded");
    await reload(token);
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

  function renderCompare(img: StudioImage) {
    const previewSrc = `${API_URL}${img.previewUrl ?? `/studio/images/${img.id}/preview`}`;
    const sourceSrc = img.sourceUrl
      ? `${API_URL}${img.sourceUrl}`
      : img.sourceImageKey
        ? mediaUrl(img.sourceImageKey)
        : null;
    return (
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-[#8aa897]">
            Phone photo
          </p>
          <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-xl border border-[#24302a] bg-[#17201c]">
            {sourceSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sourceSrc}
                alt="Original"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="px-3 text-center text-xs text-[#8aa897]">
                No source preview
              </span>
            )}
          </div>
        </div>
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-[#8aa897]">
            Enhanced
          </p>
          <div className="overflow-hidden rounded-xl border border-[#24302a]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={previewSrc}
                          alt="Enhanced"
                          className="aspect-[3/4] w-full bg-white object-contain"
                        />
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#0f1412] px-6 py-12 text-[#eef2ef]">
      <div className="mx-auto max-w-4xl">
        <Link href="/" className="text-sm text-[#8aa897]">
          ← Admin
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl">Enhance photos</h1>
            <p className="mt-2 max-w-xl text-sm text-[#9eb0a6]">
              Place phone photos on a clean white canvas for catalog standards.
              Background removal is optional. Save to library, then attach on
              product create.
            </p>
            <p className="mt-2 max-w-xl text-[12px] text-[#8aa897]">
              Tip for suppliers: shoot the product alone, fill the frame, even
              lighting, plain surface — a clean photo enhances best.
            </p>
          </div>
          <Link
            href="/studio/try-on"
            className="border border-[#24302a] px-3 py-1.5 text-xs text-[#8aa897]"
          >
            Optional: Try-on preview →
          </Link>
        </div>

        {message && <p className="mt-4 text-sm text-[#2f6b4f]">{message}</p>}
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <form
          onSubmit={enhance}
          className="mt-8 space-y-3 border border-[#24302a] p-4"
        >
          <h2 className="text-sm font-medium text-[#9dcdb4]">
            1. Upload &amp; enhance
          </h2>
          <label className="block text-xs text-[#8aa897]">
            Phone photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="mt-1 block w-full text-xs"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadSource(f);
                e.target.value = "";
              }}
            />
            {sourceImageKey && (
              <span className="mt-1 block truncate text-[10px] text-[#8aa897]">
                {sourceImageKey}
              </span>
            )}
          </label>
          <label className="block text-xs text-[#8aa897]">
            Enhance style
            <select
              value={preset}
              onChange={(e) =>
                setPreset(
                  e.target.value as
                    | "white_background_ecommerce"
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
                      code: "white_background_ecommerce",
                      label: "White background (ecommerce)",
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

          <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-[#24302a] bg-[#141c18] px-3 py-2.5">
            <div>
              <p className="text-sm text-[#eef2ef]">Remove background</p>
              <p className="mt-0.5 text-[11px] text-[#8aa897]">
                Off by default — white canvas keeps your photo. Turn on for
                cluttered warehouse / lifestyle shots (Photoroom when configured).
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={removeBackground}
              onClick={() => setRemoveBackground((v) => !v)}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                removeBackground ? "bg-[#2f6b4f]" : "bg-[#2a3530]"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white transition-transform ${
                  removeBackground ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <button
            type="submit"
            disabled={busy || !sourceImageKey}
            className="bg-[#2f6b4f] px-4 py-2 text-sm disabled:opacity-50"
          >
            {busy
              ? "Working…"
              : removeBackground
                ? "Enhance + remove background"
                : "Enhance on white canvas"}
          </button>
        </form>

        <section className="mt-10">
          <h2 className="text-lg">2. Review &amp; save</h2>
          <p className="mt-1 text-xs text-[#8aa897]">
            Save to library for later, or assign to an existing product now.
          </p>
          <ul className="mt-4 divide-y divide-[#24302a]">
            {pending.length === 0 && (
              <li className="py-4 text-[#8aa897]">No pending enhances</li>
            )}
            {pending.map((img) => (
              <li key={img.id} className="py-4">
                <p className="text-[11px] text-[#8aa897]">
                  {(img.transformPreset ?? "enhance").replace(/_/g, " ")} ·{" "}
                  {img.provider ?? "ai"}
                </p>
                {renderCompare(img)}
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveToLibrary(img.id)}
                    className="bg-[#2f6b4f] px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    Save to library
                  </button>
                  <label className="block min-w-[12rem] flex-1 text-xs text-[#8aa897]">
                    Or assign now
                    <select
                      value={attachProductId[img.id] ?? ""}
                      onChange={(e) =>
                        setAttachProductId((prev) => ({
                          ...prev,
                          [img.id]: e.target.value,
                        }))
                      }
                      className="mt-1 w-full bg-[#17201c] px-3 py-1.5 text-sm"
                    >
                      <option value="">Select product…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void attach(img.id)}
                    className="border border-[#24302a] px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    Assign
                  </button>
                  <button
                    type="button"
                    onClick={() => void reject(img.id)}
                    className="border border-[#24302a] px-3 py-1.5 text-sm text-red-300"
                  >
                    Discard
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-lg">3. Enhanced library</h2>
              <p className="mt-1 text-xs text-[#8aa897]">
                Saved clean images ready to use on new products. Demo seeds are
                local white-canvas placeholders — swap for Photoroom in
                production.
              </p>
            </div>
            <Link href="/products" className="text-xs text-[#9dcdb4]">
              Create product →
            </Link>
          </div>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {library.length === 0 && (
              <li className="col-span-full py-4 text-[#8aa897]">
                Library empty — enhance and save photos first
              </li>
            )}
            {library.map((img) => {
              const src = `${API_URL}${img.resultUrl ?? img.previewUrl ?? `/studio/images/${img.id}/preview`}`;
              return (
                <li
                  key={img.id}
                  className="overflow-hidden rounded-xl border border-[#24302a]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={img.productName ?? "Library"}
                    className="aspect-[3/4] w-full bg-white object-contain"
                  />
                  <div className="space-y-2 p-2">
                    <p className="truncate text-xs font-medium text-[#eef2ef]">
                      {img.label ?? img.productName}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-[#8aa897]">
                      {(img.transformPreset ?? "enhanced").replace(/_/g, " ")}
                      {img.demoSeed ? " · demo placeholder" : ""}
                    </p>
                    <label className="block text-[10px] text-[#8aa897]">
                      Assign to product
                      <select
                        value={attachProductId[img.id] ?? ""}
                        onChange={(e) =>
                          setAttachProductId((prev) => ({
                            ...prev,
                            [img.id]: e.target.value,
                          }))
                        }
                        className="mt-1 w-full bg-[#17201c] px-2 py-1 text-xs"
                      >
                        <option value="">Select…</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void attach(img.id)}
                      className="w-full bg-[#2f6b4f] px-2 py-1.5 text-xs disabled:opacity-50"
                    >
                      Assign
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
