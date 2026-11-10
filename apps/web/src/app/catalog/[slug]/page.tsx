"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { formatEtb } from "../../../lib/money";

type Product = Awaited<ReturnType<typeof api.getProduct>>;

export default function ProductDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    api
      .getProduct(slug)
      .then((p) => {
        setProduct(p);
        setVariantId(p.variants[0]?.id ?? null);
      })
      .catch((err: Error) => setError(err.message));
  }, [slug]);

  const selected = useMemo(
    () => product?.variants.find((v) => v.id === variantId) ?? product?.variants[0],
    [product, variantId],
  );

  if (error) {
    return (
      <main className="min-h-screen bg-sabu-paper px-6 pt-28">
        <p className="text-red-700">{error}</p>
        <Link href="/catalog" className="mt-4 inline-block text-sabu-leaf">
          Back to catalog
        </Link>
      </main>
    );
  }

  if (!product) {
    return (
      <main className="min-h-screen bg-sabu-paper px-6 pt-28">
        <p className="text-sabu-moss">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-sabu-paper pt-28 pb-16">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 lg:grid-cols-2">
        <div className="aspect-[4/5] bg-gradient-to-br from-sabu-leaf to-sabu-ink">
          <div className="flex h-full items-end p-8">
            <p className="font-[family-name:var(--font-syne)] text-4xl text-sabu-cream">
              {product.name}
            </p>
          </div>
        </div>

        <div>
          <Link href="/catalog" className="text-sm text-sabu-moss hover:text-sabu-ink">
            ← Catalog
          </Link>
          <p className="mt-4 text-xs tracking-[0.24em] text-sabu-moss uppercase">
            {product.brand ?? product.category.name}
          </p>
          <h1 className="mt-2 font-[family-name:var(--font-syne)] text-4xl text-sabu-ink">
            {product.name}
          </h1>
          {product.nameAm && (
            <p className="mt-2 text-lg text-sabu-moss">{product.nameAm}</p>
          )}
          <p className="mt-6 text-sabu-moss">{product.description}</p>

          <div className="mt-8 flex items-baseline gap-3">
            <span className="text-3xl font-medium text-sabu-ink">
              {formatEtb(selected?.price)}
            </span>
            {selected?.compareAtPrice != null &&
              selected.price != null &&
              selected.compareAtPrice > selected.price && (
                <span className="text-sabu-moss line-through">
                  {formatEtb(selected.compareAtPrice)}
                </span>
              )}
          </div>

          <label className="mt-8 block text-sm text-sabu-moss">
            Size / color
            <select
              className="mt-2 w-full border border-sabu-mist bg-transparent px-3 py-3 text-sabu-ink outline-none focus:border-sabu-leaf"
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

          <button
            type="button"
            className="mt-6 w-full bg-sabu-leaf px-5 py-3 text-sm text-sabu-cream opacity-70"
            disabled
            title="Cart comes after sales APIs"
          >
            Add to cart (soon)
          </button>
        </div>
      </div>
    </main>
  );
}
