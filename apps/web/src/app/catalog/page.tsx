"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api } from "../../lib/api";
import { ProductCard } from "../../components/product-card";

type Category = Awaited<ReturnType<typeof api.listCategories>>[number];
type Product = Awaited<ReturnType<typeof api.listProducts>>["items"][number];

const FILTERS = [
  { slug: "kids", label: "All kids", bulk: false },
  { slug: "bulk", label: "Bulk buy", bulk: true },
  { slug: "kids-boys", label: "Boys", bulk: false },
  { slug: "kids-girls", label: "Girls", bulk: false },
  { slug: "kids-baby", label: "Baby", bulk: false },
  { slug: "kids-shoes", label: "Shoes", bulk: false },
  { slug: "kids-accessories", label: "Accessories", bulk: false },
  { slug: "kids-items", label: "Items & toys", bulk: false },
];

function CatalogInner() {
  const searchParams = useSearchParams();
  const initialBulk = searchParams.get("bulk") === "1";
  const [filter, setFilter] = useState(initialBulk ? "bulk" : "kids");
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const active = FILTERS.find((f) => f.slug === filter) ?? FILTERS[0];

  useEffect(() => {
    api.listCategories().then(setCategories).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listProducts({
        category: active.bulk ? "kids" : active.slug,
        bulk: active.bulk || undefined,
      })
      .then((res) => {
        if (!cancelled) setProducts(res.items);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || "Could not load catalog");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active.bulk, active.slug]);

  const subtitle = useMemo(() => {
    if (active.bulk) return "Wholesale tier pricing from 10+ units";
    const match = categories.find((c) => c.slug === active.slug);
    return match?.nameAm ? `${match.name} · ${match.nameAm}` : match?.name;
  }, [categories, active]);

  return (
    <main className="min-h-screen bg-sabu-paper pt-24 pb-12">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] tracking-[0.22em] text-sabu-moss uppercase">
              {active.bulk ? "Wholesale" : "Retail catalog"}
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-syne)] text-3xl tracking-tight text-sabu-ink sm:text-4xl">
              {active.bulk ? "Bulk buy" : "Kids clothes & items"}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-sabu-moss">
              {active.bulk
                ? "Qty-based wholesale prices on selected SKUs. Add 10+ to unlock the first tier."
                : "Demo stock with ETB prices — tees, dresses, babywear, shoes, school items."}
              {subtitle && !active.bulk ? ` Showing ${subtitle}.` : null}
              {active.bulk ? ` ${subtitle}.` : null}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.slug}
              type="button"
              onClick={() => setFilter(f.slug)}
              className={`px-2.5 py-1.5 text-xs transition ${
                filter === f.slug
                  ? "bg-sabu-leaf text-sabu-cream"
                  : "border border-sabu-mist text-sabu-moss hover:border-sabu-leaf hover:text-sabu-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading && <p className="mt-8 text-sm text-sabu-moss">Loading…</p>}
        {error && <p className="mt-8 text-sm text-red-700">{error}</p>}

        {!loading && !error && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
            {products.map((p, i) => (
              <ProductCard
                key={p.id}
                slug={p.slug}
                name={p.name}
                nameAm={p.nameAm}
                brand={p.brand}
                categoryName={p.category.name}
                fromPrice={p.fromPrice}
                compareAtPrice={p.compareAtPrice}
                wholesaleFromPrice={p.wholesaleFromPrice}
                bulkPurchasingEnabled={p.bulkPurchasingEnabled}
                index={i}
              />
            ))}
          </div>
        )}

        {!loading && !error && products.length === 0 && (
          <p className="mt-8 text-sm text-sabu-moss">
            No products in this view yet.
          </p>
        )}
      </div>
    </main>
  );
}

export default function CatalogPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-sabu-paper px-6 pt-24">
          <p className="text-sabu-moss">Loading catalog…</p>
        </main>
      }
    >
      <CatalogInner />
    </Suspense>
  );
}
