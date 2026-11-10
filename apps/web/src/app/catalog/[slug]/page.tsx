"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../../../lib/api";
import { formatEtb } from "../../../lib/money";
import { useAuth } from "../../../context/auth-context";
import { useCart } from "../../../context/cart-context";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "http://localhost:3001/v1";

type Product = Awaited<ReturnType<typeof api.getProduct>>;

function mediaUrl(path: string) {
  if (path.startsWith("http")) return path;
  return `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function resolveUnitPrice(
  tiers: Array<{ listCode: string; minQty: number; unitPrice: number }>,
  qty: number,
  preferWholesale: boolean,
) {
  const list = preferWholesale
    ? tiers.filter((t) => t.listCode === "WHOLESALE-ETB")
    : tiers.filter((t) => t.listCode === "RETAIL-ETB");
  const pool = list.length
    ? list
    : tiers.filter((t) => t.listCode === "RETAIL-ETB");
  const applicable = pool
    .filter((t) => t.minQty <= qty)
    .sort((a, b) => b.minQty - a.minQty);
  return applicable[0]?.unitPrice ?? null;
}

export default function ProductDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const { accessToken } = useAuth();
  const { addItem } = useCart();
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [activePreview, setActivePreview] = useState(0);

  useEffect(() => {
    if (!slug) return;
    api
      .getProduct(slug)
      .then((p) => {
        setProduct(p);
        setVariantId(p.variants[0]?.id ?? null);
        setQty(p.bulkPurchasingEnabled ? 10 : 1);
        setActivePreview(0);
      })
      .catch((err: Error) => setError(err.message));
  }, [slug]);

  const aiPreviews = product?.aiPreviews ?? [];
  const currentPreview = aiPreviews[activePreview] ?? null;

  const selected = useMemo(
    () =>
      product?.variants.find((v) => v.id === variantId) ?? product?.variants[0],
    [product, variantId],
  );

  const useWholesale =
    !!product?.bulkPurchasingEnabled &&
    qty >= (selected?.minOrderQtyWholesale ?? 10);

  const unitPrice = useMemo(() => {
    if (!selected) return null;
    return (
      resolveUnitPrice(selected.priceTiers ?? [], qty, useWholesale) ??
      selected.price
    );
  }, [selected, qty, useWholesale]);

  const lineTotal =
    unitPrice != null ? Math.round(unitPrice * qty * 100) / 100 : null;

  const wholesaleTiers = (selected?.priceTiers ?? []).filter(
    (t) => t.listCode === "WHOLESALE-ETB",
  );

  async function onAdd() {
    if (!selected) return;
    setMessage(null);
    setBusy(true);
    try {
      await addItem(selected.id, qty);
      setMessage(
        useWholesale
          ? `Added ${qty} (wholesale tier)`
          : accessToken
            ? `Added ${qty} to cart`
            : `Added ${qty} to guest cart`,
      );
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Could not add to cart");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <main className="min-h-screen bg-sabu-paper px-6 pt-24">
        <p className="text-red-700">{error}</p>
        <Link href="/catalog" className="mt-4 inline-block text-sabu-leaf">
          Back to catalog
        </Link>
      </main>
    );
  }

  if (!product) {
    return (
      <main className="min-h-screen bg-sabu-paper px-6 pt-24">
        <p className="text-sabu-moss">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-sabu-paper pt-24 pb-12">
      <div className="mx-auto grid max-w-5xl gap-6 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-8">
        <div>
          <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-gradient-to-br from-sabu-leaf to-sabu-ink lg:aspect-[4/5] lg:min-h-[360px]">
            {currentPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mediaUrl(currentPreview.previewUrl)}
                alt={`${product.name} AI preview`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-end p-5">
                <div>
                  {product.bulkPurchasingEnabled && (
                    <span className="mb-2 inline-block bg-sabu-cream/95 px-2 py-0.5 text-[10px] font-medium tracking-wide text-sabu-ink uppercase">
                      Bulk available
                    </span>
                  )}
                  <p className="font-[family-name:var(--font-syne)] text-2xl text-sabu-cream sm:text-3xl">
                    {product.name}
                  </p>
                </div>
              </div>
            )}
            {currentPreview && (
              <span className="absolute top-3 left-3 bg-sabu-cream/95 px-2 py-0.5 text-[10px] font-medium tracking-wide text-sabu-ink uppercase">
                AI Preview
              </span>
            )}
          </div>
          {aiPreviews.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {aiPreviews.map((preview, idx) => (
                <button
                  key={preview.id}
                  type="button"
                  onClick={() => setActivePreview(idx)}
                  className={`h-16 w-12 overflow-hidden rounded-md border ${
                    idx === activePreview
                      ? "border-sabu-leaf"
                      : "border-sabu-mist"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={mediaUrl(preview.previewUrl)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
          {aiPreviews.length > 0 && (
            <p className="mt-2 text-[11px] text-sabu-moss">
              Synthetic / licensed AI try-on preview for this product.
            </p>
          )}
        </div>

        <div>
          <Link
            href={
              product.bulkPurchasingEnabled
                ? "/catalog?bulk=1"
                : "/catalog"
            }
            className="text-xs text-sabu-moss hover:text-sabu-ink"
          >
            ← {product.bulkPurchasingEnabled ? "Bulk buy" : "Catalog"}
          </Link>
          <p className="mt-3 text-[11px] tracking-[0.22em] text-sabu-moss uppercase">
            {product.brand ?? product.category.name}
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-syne)] text-3xl text-sabu-ink">
            {product.name}
          </h1>
          {product.nameAm && (
            <p className="mt-1 text-base text-sabu-moss">{product.nameAm}</p>
          )}
          <p className="mt-3 text-sm leading-relaxed text-sabu-moss">
            {product.description}
          </p>

          <div
            className={`mt-4 border px-3 py-2 text-xs ${
              product.returnsAllowed === false
                ? "border-amber-700/40 text-amber-900"
                : "border-sabu-mist/60 text-sabu-moss"
            }`}
          >
            <p className="font-medium text-sabu-ink">
              {product.returnPolicyLabel ??
                (product.returnsAllowed === false
                  ? "No Returns Available for This Item."
                  : `Returns within ${product.returnWindowDays ?? 7} day(s)`)}
            </p>
            {product.returnsAllowed !== false &&
              product.returnPolicyDescription && (
                <p className="mt-1">{product.returnPolicyDescription}</p>
              )}
            {product.returnConditions && product.returnsAllowed !== false && (
              <p className="mt-1">Conditions: {product.returnConditions}</p>
            )}
          </div>

          <div className="mt-5 flex items-baseline gap-2">
            <span className="text-2xl font-medium text-sabu-ink">
              {formatEtb(unitPrice)}
            </span>
            <span className="text-xs text-sabu-moss">/ unit</span>
            {useWholesale && (
              <span className="text-xs text-sabu-leaf">wholesale tier</span>
            )}
          </div>
          {lineTotal != null && qty > 1 && (
            <p className="mt-1 text-sm text-sabu-moss">
              Line total {formatEtb(lineTotal)}
            </p>
          )}

          <label className="mt-5 block text-xs text-sabu-moss">
            Size / color
            <select
              className="mt-1.5 w-full border border-sabu-mist bg-transparent px-3 py-2 text-sm text-sabu-ink outline-none focus:border-sabu-leaf"
              value={selected?.id ?? ""}
              onChange={(e) => setVariantId(e.target.value)}
            >
              {product.variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} — {formatEtb(v.price)}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-4 block text-xs text-sabu-moss">
            Quantity
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={500}
                value={qty}
                onChange={(e) =>
                  setQty(Math.max(1, Math.min(500, Number(e.target.value) || 1)))
                }
                className="w-24 border border-sabu-mist bg-transparent px-3 py-2 text-sm text-sabu-ink outline-none focus:border-sabu-leaf"
              />
              {product.bulkPurchasingEnabled && (
                <div className="flex flex-wrap gap-1">
                  {[10, 50, 100].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setQty(n)}
                      className={`px-2 py-1 text-[11px] ${
                        qty === n
                          ? "bg-sabu-leaf text-sabu-cream"
                          : "border border-sabu-mist text-sabu-moss hover:border-sabu-leaf"
                      }`}
                    >
                      {n}+
                    </button>
                  ))}
                </div>
              )}
            </div>
          </label>

          {product.bulkPurchasingEnabled && wholesaleTiers.length > 0 && (
            <div className="mt-5 border border-sabu-mist/60 px-3 py-3">
              <p className="text-[11px] tracking-wide text-sabu-moss uppercase">
                Bulk price tiers
              </p>
              <ul className="mt-2 space-y-1.5 text-sm">
                <li className="flex justify-between text-sabu-moss">
                  <span>Retail (1+)</span>
                  <span className="text-sabu-ink">
                    {formatEtb(selected?.price)}
                  </span>
                </li>
                {wholesaleTiers.map((t) => (
                  <li
                    key={`${t.minQty}-${t.unitPrice}`}
                    className={`flex justify-between ${
                      useWholesale && qty >= t.minQty
                        ? "font-medium text-sabu-leaf"
                        : "text-sabu-moss"
                    }`}
                  >
                    <span>{t.minQty}+ units</span>
                    <span>{formatEtb(t.unitPrice)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            onClick={onAdd}
            disabled={busy || !selected}
            className="mt-5 w-full bg-sabu-leaf px-4 py-2.5 text-sm text-sabu-cream transition hover:bg-sabu-forest disabled:opacity-60"
          >
            {busy
              ? "Adding…"
              : useWholesale
                ? `Add ${qty} at wholesale`
                : `Add ${qty} to cart`}
          </button>
          {message && <p className="mt-2 text-sm text-sabu-moss">{message}</p>}
          {message?.startsWith("Added") && (
            <Link
              href="/cart"
              className="mt-1 inline-block text-sm text-sabu-leaf underline"
            >
              View cart
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
