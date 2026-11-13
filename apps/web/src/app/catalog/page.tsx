"use client";

import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "../../lib/api";
import { ProductCard } from "../../components/product-card";

type Category = Awaited<ReturnType<typeof api.listCategories>>[number];
type Product = Awaited<ReturnType<typeof api.listProducts>>["items"][number];
type Facets = Awaited<ReturnType<typeof api.listFacets>>;

const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
  { value: "popular", label: "Most Popular" },
  { value: "bestselling", label: "Best Selling" },
  { value: "rating", label: "Highest Rated" },
];

function CatalogInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryTree, setCategoryTree] = useState<Category[]>([]);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const q = searchParams.get("q") ?? "";
  const category = searchParams.get("category") ?? "";
  const sort = searchParams.get("sort") ?? "newest";
  const brand = searchParams.get("brand") ?? "";
  const attribute = searchParams.get("attribute") ?? "";
  const minPrice = searchParams.get("minPrice") ?? "";
  const maxPrice = searchParams.get("maxPrice") ?? "";
  const inStock = searchParams.get("inStock") === "1";
  const onSale = searchParams.get("onSale") === "1";
  const newArrivals = searchParams.get("newArrivals") === "1";
  const bulk = searchParams.get("bulk") === "1";
  const wholesale = searchParams.get("wholesale") === "1";
  const retail = searchParams.get("retail") === "1";

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value == null || value === "") next.delete(key);
      else next.set(key, value);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setMany = useCallback(
    (entries: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(entries)) {
        if (v == null || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    api.listCategories().then(setCategories).catch(() => undefined);
    api
      .listCategories({ tree: true })
      .then(setCategoryTree)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    api
      .listFacets({ category: category || undefined })
      .then(setFacets)
      .catch(() => undefined);
  }, [category]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listProducts({
        category: category || undefined,
        q: q || undefined,
        bulk: bulk || undefined,
        brand: brand || undefined,
        attribute: attribute || undefined,
        minPrice: minPrice ? Number(minPrice) : undefined,
        maxPrice: maxPrice ? Number(maxPrice) : undefined,
        inStock: inStock || undefined,
        onSale: onSale || undefined,
        newArrivals: newArrivals || undefined,
        wholesale: wholesale || undefined,
        retail: retail || undefined,
        sort,
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
  }, [
    attribute,
    brand,
    bulk,
    category,
    inStock,
    maxPrice,
    minPrice,
    newArrivals,
    onSale,
    q,
    retail,
    sort,
    wholesale,
  ]);

  const topLevel = useMemo(
    () =>
      categoryTree
        .filter((c) => !c.parentId)
        .sort(
          (a, b) =>
            (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
            a.name.localeCompare(b.name),
        ),
    [categoryTree],
  );

  const childChips = useMemo(() => {
    if (!category) return [];
    const parent = categoryTree.find((c) => c.slug === category);
    if (parent?.children?.length) {
      return parent.children.map((c) => ({
        slug: c.slug,
        label: c.name,
      }));
    }
    const node = categories.find((c) => c.slug === category);
    if (!node?.parentId) return [];
    return categories
      .filter((c) => c.parentId === node.parentId)
      .map((c) => ({ slug: c.slug, label: c.name }));
  }, [categories, category, categoryTree]);

  const subtitle = useMemo(() => {
    if (bulk || wholesale) return "Wholesale tier pricing from 10+ units";
    if (newArrivals) return "Added in the last 60 days";
    if (onSale) return "Products with compare-at discounts";
    const match = categories.find((c) => c.slug === category);
    return match?.nameAm ? `${match.name} · ${match.nameAm}` : match?.name;
  }, [bulk, categories, category, newArrivals, onSale, wholesale]);

  const heading = useMemo(() => {
    if (bulk || wholesale) return "Buy more, pay less";
    if (newArrivals) return "Just landed";
    if (onSale) return "Worth a second look";
    const match = categories.find((c) => c.slug === category);
    return match?.name ?? "Online shopping";
  }, [bulk, categories, category, newArrivals, onSale, wholesale]);

  const lead = useMemo(() => {
    if (bulk || wholesale)
      return "Wholesale tiers kick in from 10+ units — built for shops and resellers.";
    if (newArrivals)
      return "Fresh stock from across Sabu’s departments.";
    if (onSale) return "Compare-at deals while they last.";
    if (category)
      return "Browse this department with filters that match what you’re shopping for.";
    return "Fashion, home, beauty, electronics, and more — one Ethiopian marketplace.";
  }, [bulk, category, newArrivals, onSale, wholesale]);

  const advancedFilterCount = useMemo(() => {
    let n = 0;
    if (minPrice) n += 1;
    if (maxPrice) n += 1;
    if (brand) n += 1;
    if (attribute) n += 1;
    if (inStock) n += 1;
    if (onSale) n += 1;
    if (newArrivals) n += 1;
    if (retail) n += 1;
    return n;
  }, [
    attribute,
    brand,
    inStock,
    maxPrice,
    minPrice,
    newArrivals,
    onSale,
    retail,
  ]);

  const chipClass = (active: boolean, ink = false) =>
    `shrink-0 whitespace-nowrap px-2.5 py-1.5 text-xs transition ${
      active
        ? ink
          ? "bg-sabu-ink text-sabu-cream"
          : "bg-sabu-leaf text-sabu-cream"
        : "border border-sabu-mist text-sabu-moss hover:border-sabu-leaf"
    }`;

  const filterPanel = (
    <div className="grid gap-3 border border-sabu-mist/70 p-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-xs text-sabu-moss">
        Min price (ETB)
        <input
          type="number"
          min={0}
          value={minPrice}
          onChange={(e) => setParam("minPrice", e.target.value || null)}
          className="mt-1 w-full border-b border-sabu-mist bg-transparent py-1.5 text-sm text-sabu-ink outline-none"
        />
      </label>
      <label className="text-xs text-sabu-moss">
        Max price (ETB)
        <input
          type="number"
          min={0}
          value={maxPrice}
          onChange={(e) => setParam("maxPrice", e.target.value || null)}
          className="mt-1 w-full border-b border-sabu-mist bg-transparent py-1.5 text-sm text-sabu-ink outline-none"
        />
      </label>
      <label className="text-xs text-sabu-moss">
        Brand
        <select
          value={brand}
          onChange={(e) => setParam("brand", e.target.value || null)}
          className="mt-1 w-full border-b border-sabu-mist bg-transparent py-1.5 text-sm text-sabu-ink outline-none"
        >
          <option value="">All brands</option>
          {(facets?.brands ?? []).map((b) => (
            <option key={b.name} value={b.name}>
              {b.name} ({b.count})
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-sabu-moss">
        Attribute
        <select
          value={attribute}
          onChange={(e) => setParam("attribute", e.target.value || null)}
          className="mt-1 w-full border-b border-sabu-mist bg-transparent py-1.5 text-sm text-sabu-ink outline-none"
        >
          <option value="">Any attribute</option>
          {(facets?.attributes ?? []).flatMap((a) =>
            a.values.map((v) => (
              <option
                key={`${a.code}:${v.code}`}
                value={`${a.code}:${v.code}`}
              >
                {a.name}: {v.label} ({v.count})
              </option>
            )),
          )}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs text-sabu-moss">
        <input
          type="checkbox"
          checked={inStock}
          onChange={(e) => setParam("inStock", e.target.checked ? "1" : null)}
        />
        In stock
      </label>
      <label className="flex items-center gap-2 text-xs text-sabu-moss">
        <input
          type="checkbox"
          checked={onSale}
          onChange={(e) => setParam("onSale", e.target.checked ? "1" : null)}
        />
        On sale
      </label>
      <label className="flex items-center gap-2 text-xs text-sabu-moss">
        <input
          type="checkbox"
          checked={newArrivals}
          onChange={(e) =>
            setParam("newArrivals", e.target.checked ? "1" : null)
          }
        />
        New arrivals
      </label>
      <label className="flex items-center gap-2 text-xs text-sabu-moss">
        <input
          type="checkbox"
          checked={retail}
          onChange={(e) =>
            setMany({
              retail: e.target.checked ? "1" : null,
              wholesale: null,
              bulk: null,
            })
          }
        />
        Retail only
      </label>
    </div>
  );

  return (
    <main className="min-h-screen bg-sabu-paper pt-24 pb-12">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] tracking-[0.22em] text-sabu-moss uppercase">
              {bulk || wholesale
                ? "Wholesale"
                : "Sabu Online Shopping"}
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-syne)] text-3xl tracking-tight text-sabu-ink sm:text-4xl">
              {heading}
            </h1>
            <p className="mt-2 hidden max-w-xl text-sm text-sabu-moss sm:block">
              {lead}
              {subtitle ? ` ${subtitle}.` : null}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={q}
            onChange={(e) => setParam("q", e.target.value || null)}
            placeholder="Search products…"
            className="w-full border border-sabu-mist bg-transparent px-3 py-2 text-sm text-sabu-ink outline-none focus:border-sabu-leaf sm:max-w-xs"
          />
          <div className="flex gap-2">
            <select
              value={sort}
              onChange={(e) => setParam("sort", e.target.value)}
              className="min-w-0 flex-1 border border-sabu-mist bg-transparent px-3 py-2 text-sm text-sabu-ink outline-none sm:flex-none"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              className="shrink-0 border border-sabu-mist px-3 py-2 text-sm text-sabu-ink md:hidden"
              aria-expanded={filtersOpen}
            >
              Filters
              {advancedFilterCount > 0 ? ` (${advancedFilterCount})` : ""}
            </button>
          </div>
        </div>

        {/* One-row swipe on phone; wrap on desktop — keeps all categories */}
        <div className="-mx-4 mt-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() =>
              setMany({
                category: null,
                bulk: null,
                wholesale: null,
                retail: null,
              })
            }
            className={chipClass(!bulk && !category)}
          >
            All
          </button>
          <button
            type="button"
            onClick={() =>
              setMany({
                bulk: "1",
                category: null,
                wholesale: null,
                retail: null,
              })
            }
            className={chipClass(!!bulk)}
          >
            Bulk buy
          </button>
          {topLevel.map((f) => (
            <button
              key={f.slug}
              type="button"
              title={f.name}
              onClick={() =>
                setMany({
                  category: f.slug,
                  bulk: null,
                  wholesale: null,
                  attribute: null,
                })
              }
              className={chipClass(!bulk && category === f.slug)}
            >
              {f.name}
            </button>
          ))}
        </div>
        {childChips.length > 0 && (
          <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
            {childChips.map((f) => (
              <button
                key={f.slug}
                type="button"
                title={f.label}
                onClick={() =>
                  setMany({
                    category: f.slug,
                    bulk: null,
                    wholesale: null,
                    attribute: null,
                  })
                }
                className={chipClass(category === f.slug, true)}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {/* Mobile: collapsed until Filters; desktop: always open */}
        <div
          className={`mt-4 ${filtersOpen ? "block" : "hidden"} md:block`}
        >
          {filterPanel}
          {filtersOpen && (
            <button
              type="button"
              onClick={() => setFiltersOpen(false)}
              className="mt-2 w-full border border-sabu-mist py-2 text-sm text-sabu-moss md:hidden"
            >
              Done
            </button>
          )}
        </div>

        {error && <p className="mt-8 text-sm text-red-700">{error}</p>}

        {/*
          Keep the product block mounted while filters refresh so page height
          stays stable on phone — otherwise the green site footer jumps into view.
        */}
        <div className="mt-4 min-h-[55vh]">
          {loading && products.length === 0 && !error && (
            <p className="mt-8 text-sm text-sabu-moss">Loading…</p>
          )}

          {!error && (products.length > 0 || !loading) && (
            <>
              <p className="text-xs text-sabu-moss">
                {loading ? "Updating…" : null}
                {!loading &&
                  `${products.length} product${products.length === 1 ? "" : "s"}`}
              </p>
              <div
                className={`mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 ${
                  loading && products.length > 0 ? "opacity-60" : ""
                }`}
              >
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
                    imageUrl={p.imageUrl ?? null}
                    index={i}
                  />
                ))}
              </div>
              {!loading && products.length === 0 && (
                <p className="mt-8 text-sm text-sabu-moss">
                  No products match these filters.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default function CatalogPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-sabu-paper px-6 pt-28">
          <p className="text-sabu-moss">Loading catalog…</p>
        </main>
      }
    >
      <CatalogInner />
    </Suspense>
  );
}
