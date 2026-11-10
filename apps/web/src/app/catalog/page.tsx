"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { ProductCard } from "../../components/product-card";

type Category = Awaited<ReturnType<typeof api.listCategories>>[number];
type Product = Awaited<ReturnType<typeof api.listProducts>>["items"][number];

const FILTERS = [
  { slug: "kids", label: "All kids" },
  { slug: "kids-boys", label: "Boys" },
  { slug: "kids-girls", label: "Girls" },
  { slug: "kids-baby", label: "Baby" },
  { slug: "kids-shoes", label: "Shoes" },
  { slug: "kids-accessories", label: "Accessories" },
  { slug: "kids-items", label: "Items & toys" },
];

export default function CatalogPage() {
  const [category, setCategory] = useState("kids");
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listCategories().then(setCategories).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listProducts({ category })
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
  }, [category]);

  const subtitle = useMemo(() => {
    const match = categories.find((c) => c.slug === category);
    return match?.nameAm ? `${match.name} · ${match.nameAm}` : match?.name;
  }, [categories, category]);

  return (
    <main className="min-h-screen bg-sabu-paper pt-28 pb-16">
      <div className="mx-auto max-w-6xl px-6">
        <p className="text-xs tracking-[0.24em] text-sabu-moss uppercase">
          Retail catalog
        </p>
        <h1 className="mt-3 font-[family-name:var(--font-syne)] text-4xl tracking-tight text-sabu-ink sm:text-5xl">
          Kids clothes & items
        </h1>
        <p className="mt-4 max-w-xl text-sabu-moss">
          Synthetic demo stock for Ethiopian retail — tees, dresses, babywear,
          shoes, and school items with ETB prices.
          {subtitle ? ` Showing ${subtitle}.` : null}
        </p>

        <div className="mt-8 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.slug}
              type="button"
              onClick={() => setCategory(f.slug)}
              className={`px-3 py-2 text-sm transition ${
                category === f.slug
                  ? "bg-sabu-leaf text-sabu-cream"
                  : "border border-sabu-mist text-sabu-moss hover:border-sabu-leaf hover:text-sabu-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading && (
          <p className="mt-12 text-sabu-moss">Loading products…</p>
        )}
        {error && <p className="mt-12 text-red-700">{error}</p>}

        {!loading && !error && (
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
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
                index={i}
              />
            ))}
          </div>
        )}

        {!loading && !error && products.length === 0 && (
          <p className="mt-12 text-sabu-moss">No products in this category yet.</p>
        )}
      </div>
    </main>
  );
}
