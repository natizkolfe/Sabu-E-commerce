"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { API_URL, adminApi, ApiError } from "../../lib/api";
import { loadSession } from "../../lib/session";

type ProductListItem = Awaited<ReturnType<typeof adminApi.listProducts>>[number];
type ProductDetail = Awaited<ReturnType<typeof adminApi.getProduct>>;
type Category = Awaited<ReturnType<typeof adminApi.listCategories>>[number];
type Brand = Awaited<ReturnType<typeof adminApi.listBrands>>[number];

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function ProductsAdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [items, setItems] = useState<ProductListItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [bulkOnly, setBulkOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // product edit
  const [editName, setEditName] = useState("");
  const [editNameAm, setEditNameAm] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStatus, setEditStatus] = useState("active");
  const [editBulk, setEditBulk] = useState(false);
  const [editBrandId, setEditBrandId] = useState("");
  const [editCategoryIds, setEditCategoryIds] = useState<string[]>([]);
  const [editReturnsAllowed, setEditReturnsAllowed] = useState(true);
  const [editReturnDays, setEditReturnDays] = useState("7");
  const [editReturnConditions, setEditReturnConditions] = useState("");
  const [editReturnInstructions, setEditReturnInstructions] = useState("");
  const [editReturnDescription, setEditReturnDescription] = useState("");

  // create product
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newCategoryId, setNewCategoryId] = useState("");
  const [newBrandId, setNewBrandId] = useState("");
  const [newStatus, setNewStatus] = useState("draft");
  const [newBulk, setNewBulk] = useState(false);

  // variant create
  const [newSku, setNewSku] = useState("");
  const [newVariantName, setNewVariantName] = useState("");

  // pricing
  const [variantId, setVariantId] = useState("");
  const [listCode, setListCode] = useState<"RETAIL-ETB" | "WHOLESALE-ETB">(
    "RETAIL-ETB",
  );
  const [minQty, setMinQty] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [compareAt, setCompareAt] = useState("");

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedVariant = useMemo(
    () => detail?.variants.find((v) => v.id === variantId) ?? null,
    [detail, variantId],
  );

  const refreshList = useCallback(
    async (accessToken: string) => {
      const list = await adminApi.listProducts(accessToken, {
        q: q.trim() || undefined,
        status: statusFilter || undefined,
        bulk: bulkOnly || undefined,
      });
      setItems(list);
    },
    [q, statusFilter, bulkOnly],
  );

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    Promise.all([
      adminApi.listCategories(s.accessToken),
      adminApi.listBrands(s.accessToken),
    ]).then(([cats, brandRows]) => {
      setCategories(cats);
      setNewCategoryId(cats[0]?.id ?? "");
      setBrands(brandRows);
    });
  }, []);

  useEffect(() => {
    if (!token) return;
    refreshList(token).catch(() => setItems([]));
  }, [token, refreshList]);

  async function openProduct(id: string) {
    if (!token) return;
    setError(null);
    setMessage(null);
    setSelectedId(id);
    setShowCreate(false);
    const p = await adminApi.getProduct(token, id);
    setDetail(p);
    setEditName(p.name);
    setEditNameAm(p.nameAm ?? "");
    setEditDescription(p.description ?? "");
    setEditStatus(p.status);
    setEditBulk(p.bulkPurchasingEnabled);
    setEditBrandId(p.brandId ?? "");
    setEditCategoryIds(
      p.categoryIds?.length ? p.categoryIds : [p.categoryId],
    );
    setEditReturnsAllowed(p.returnsAllowed !== false);
    setEditReturnDays(String(p.returnWindowDays ?? 7));
    setEditReturnConditions(p.returnConditions ?? "");
    setEditReturnInstructions(p.returnInstructions ?? "");
    setEditReturnDescription(p.returnPolicyDescription ?? "");
    setVariantId(p.variants[0]?.id ?? "");
    const first = p.variants[0];
    if (first?.retailPrice != null) {
      setListCode("RETAIL-ETB");
      setMinQty("1");
      setUnitPrice(String(first.retailPrice));
    } else {
      setUnitPrice("");
    }
  }

  async function saveProduct(e: FormEvent) {
    e.preventDefault();
    if (!token || !detail) return;
    setBusy(true);
    setError(null);
    try {
      const categoryIds = editCategoryIds.length
        ? editCategoryIds
        : [detail.categoryId];
      const next = await adminApi.updateProduct(token, detail.id, {
        name: editName,
        nameAm: editNameAm || undefined,
        description: editDescription || undefined,
        status: editStatus,
        brandId: editBrandId || null,
        categoryId: categoryIds[0],
        categoryIds,
        bulkPurchasingEnabled: editBulk,
        returnsAllowed: editReturnsAllowed,
        returnWindowDays: editReturnsAllowed
          ? Number(editReturnDays) || 7
          : null,
        returnConditions: editReturnConditions || null,
        returnInstructions: editReturnInstructions || null,
        returnPolicyDescription: editReturnDescription || null,
      });
      setDetail(next as ProductDetail);
      setMessage("Product saved");
      await refreshList(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function createProduct(e: FormEvent) {
    e.preventDefault();
    if (!token || !newCategoryId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await adminApi.createProduct(token, {
        categoryId: newCategoryId,
        categoryIds: [newCategoryId],
        brandId: newBrandId || undefined,
        slug: newSlug || slugify(newName),
        name: newName,
        status: newStatus,
        bulkPurchasingEnabled: newBulk,
      });
      setMessage(
        created.retailNumber
          ? `Product created · retail # ${created.retailNumber}`
          : "Product created",
      );
      setShowCreate(false);
      setNewName("");
      setNewSlug("");
      await refreshList(token);
      await openProduct(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function createVariant(e: FormEvent) {
    e.preventDefault();
    if (!token || !detail || !newVariantName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await adminApi.createVariant(token, detail.id, {
        sku: newSku.trim() ? newSku.trim().toUpperCase() : undefined,
        variantName: newVariantName.trim(),
      });
      setNewSku("");
      setNewVariantName("");
      setMessage(
        created.sku
          ? `Variant created · SKU ${created.sku}`
          : "Variant created",
      );
      await openProduct(detail.id);
      await refreshList(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Variant failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleVariantActive(id: string, isActive: boolean) {
    if (!token || !detail) return;
    try {
      await adminApi.updateVariant(token, id, { isActive: !isActive });
      await openProduct(detail.id);
      setMessage(isActive ? "Variant deactivated" : "Variant activated");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  async function savePrice(e: FormEvent) {
    e.preventDefault();
    if (!token || !variantId) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.setTier(token, {
        listCode,
        variantId,
        minQty: Number(minQty) || 1,
        unitPrice: Number(unitPrice),
        compareAtPrice: compareAt ? Number(compareAt) : undefined,
      });
      setMessage("Price tier saved (previous range closed)");
      if (selectedId) await openProduct(selectedId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Price failed");
    } finally {
      setBusy(false);
    }
  }

  function applyQuickTier(kind: "retail" | "wholesale") {
    if (!selectedVariant) return;
    if (kind === "retail") {
      setListCode("RETAIL-ETB");
      setMinQty("1");
      setUnitPrice(
        selectedVariant.retailPrice != null
          ? String(selectedVariant.retailPrice)
          : "",
      );
      return;
    }
    setListCode("WHOLESALE-ETB");
    setMinQty("10");
    setUnitPrice(
      selectedVariant.wholesaleQty10 != null
        ? String(selectedVariant.wholesaleQty10)
        : "",
    );
  }

  async function uploadProductImage(file: File) {
    if (!token || !detail) return;
    setBusy(true);
    setError(null);
    try {
      const data = await fileToDataUrl(file);
      const uploaded = await adminApi.uploadMedia(token, {
        data,
        folder: `products/${detail.id}`,
        mimeType: file.type || undefined,
      });
      await adminApi.addProductImage(token, detail.id, {
        storageKey: uploaded.storageKey,
        isPrimary: !(detail.images?.length),
        source: "upload",
      });
      setMessage("Image uploaded");
      await openProduct(detail.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
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
    <main className="min-h-screen bg-[#0f1412] px-4 py-10 text-[#eef2ef] sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/" className="text-sm text-[#8aa897]">
              ← Admin
            </Link>
            <h1 className="mt-2 text-3xl tracking-tight">Products & prices</h1>
            <p className="mt-1 text-sm text-[#9eb0a6]">
              Edit catalog, variants, retail/wholesale tiers. Prices are
              versioned (close old range + insert).
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowCreate(true);
              setDetail(null);
              setSelectedId(null);
            }}
            className="bg-[#2f6b4f] px-4 py-2 text-sm"
          >
            New product
          </button>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.2fr)]">
          {/* List */}
          <section className="border border-[#24302a]">
            <div className="space-y-2 border-b border-[#24302a] p-3">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, slug, or retail #…"
                className="w-full bg-[#17201c] px-3 py-2 text-sm outline-none"
              />
              <div className="flex flex-wrap gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="bg-[#17201c] px-2 py-1.5 text-xs"
                >
                  <option value="">All statuses</option>
                  <option value="active">active</option>
                  <option value="draft">draft</option>
                  <option value="inactive">inactive</option>
                  <option value="archived">archived</option>
                </select>
                <label className="flex items-center gap-1.5 text-xs text-[#9eb0a6]">
                  <input
                    type="checkbox"
                    checked={bulkOnly}
                    onChange={(e) => setBulkOnly(e.target.checked)}
                  />
                  Bulk only
                </label>
              </div>
            </div>
            <ul className="max-h-[70vh] overflow-y-auto divide-y divide-[#24302a]">
              {items.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => openProduct(p.id)}
                    className={`flex w-full justify-between gap-3 px-3 py-2.5 text-left text-sm ${
                      selectedId === p.id
                        ? "bg-[#1a2922] text-white"
                        : "hover:bg-[#141c18]"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{p.name}</span>
                      <span className="mt-0.5 block text-[11px] text-[#8aa897]">
                        {p.retailNumber ? `${p.retailNumber} · ` : ""}
                        {p.categoryName} · {p.variantCount} var · {p.status}
                      </span>
                    </span>
                    {p.bulkPurchasingEnabled && (
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-[#2f6b4f]">
                        bulk
                      </span>
                    )}
                  </button>
                </li>
              ))}
              {items.length === 0 && (
                <li className="px-3 py-6 text-sm text-[#8aa897]">
                  No products match.
                </li>
              )}
            </ul>
          </section>

          {/* Detail / create */}
          <section className="border border-[#24302a] p-4">
            {showCreate ? (
              <form onSubmit={createProduct} className="space-y-3">
                <h2 className="text-xl">Create product</h2>
                <input
                  required
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    if (!newSlug || newSlug === slugify(newName)) {
                      setNewSlug(slugify(e.target.value));
                    }
                  }}
                  placeholder="Name"
                  className="w-full bg-[#17201c] px-3 py-2 text-sm"
                />
                <input
                  required
                  value={newSlug}
                  onChange={(e) => setNewSlug(slugify(e.target.value))}
                  placeholder="slug"
                  className="w-full bg-[#17201c] px-3 py-2 text-sm"
                />
                <select
                  required
                  value={newCategoryId}
                  onChange={(e) => setNewCategoryId(e.target.value)}
                  className="w-full bg-[#17201c] px-3 py-2 text-sm"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  value={newBrandId}
                  onChange={(e) => setNewBrandId(e.target.value)}
                  className="w-full bg-[#17201c] px-3 py-2 text-sm"
                >
                  <option value="">No brand</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <div className="flex flex-wrap gap-3">
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                    className="bg-[#17201c] px-3 py-2 text-sm"
                  >
                    <option value="draft">draft</option>
                    <option value="active">active</option>
                  </select>
                  <label className="flex items-center gap-2 text-sm text-[#9eb0a6]">
                    <input
                      type="checkbox"
                      checked={newBulk}
                      onChange={(e) => setNewBulk(e.target.checked)}
                    />
                    Bulk purchasing
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="bg-[#2f6b4f] px-4 py-2 text-sm disabled:opacity-60"
                >
                  Create
                </button>
              </form>
            ) : !detail ? (
              <p className="text-[#8aa897]">
                Select a product to edit details, variants, and prices.
              </p>
            ) : (
              <div className="space-y-6">
                <form onSubmit={saveProduct} className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="text-xl">{detail.name}</h2>
                      <p className="text-xs text-[#8aa897]">
                        {detail.retailNumber
                          ? `Retail # ${detail.retailNumber} · `
                          : ""}
                        {detail.categoryName} · {detail.slug}
                      </p>
                      {detail.retailNumber && (
                        <p className="mt-1 text-[11px] text-[#9dcdb4]">
                          All variants share this retail number. SKUs are
                          auto-built for stock tracking.
                        </p>
                      )}
                    </div>
                    <span className="text-[11px] uppercase tracking-wide text-[#8aa897]">
                      {detail.status}
                      {detail.bulkPurchasingEnabled ? " · bulk" : ""}
                    </span>
                  </div>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full bg-[#17201c] px-3 py-2 text-sm"
                  />
                  <input
                    value={editNameAm}
                    onChange={(e) => setEditNameAm(e.target.value)}
                    placeholder="Amharic name"
                    className="w-full bg-[#17201c] px-3 py-2 text-sm"
                  />
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={3}
                    placeholder="Description"
                    className="w-full bg-[#17201c] px-3 py-2 text-sm"
                  />
                  <label className="block text-xs text-[#8aa897]">
                    Brand
                    <select
                      value={editBrandId}
                      onChange={(e) => setEditBrandId(e.target.value)}
                      className="mt-1 w-full bg-[#17201c] px-3 py-2 text-sm"
                    >
                      <option value="">No brand</option>
                      {brands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div>
                    <p className="text-xs text-[#8aa897]">Categories</p>
                    <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto text-sm">
                      {categories.map((c) => {
                        const checked = editCategoryIds.includes(c.id);
                        return (
                          <li key={c.id}>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  setEditCategoryIds((prev) =>
                                    e.target.checked
                                      ? [...prev, c.id]
                                      : prev.filter((id) => id !== c.id),
                                  );
                                }}
                              />
                              {c.name}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-1 text-[11px] text-[#8aa897]">
                      First checked category becomes primary.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value)}
                      className="bg-[#17201c] px-3 py-2 text-sm"
                    >
                      <option value="draft">draft</option>
                      <option value="active">active</option>
                      <option value="inactive">inactive</option>
                      <option value="archived">archived</option>
                    </select>
                    <label className="flex items-center gap-2 text-sm text-[#9eb0a6]">
                      <input
                        type="checkbox"
                        checked={editBulk}
                        onChange={(e) => setEditBulk(e.target.checked)}
                      />
                      Bulk purchasing enabled
                    </label>
                  </div>
                  <div className="space-y-2 border border-[#24302a] p-3">
                    <p className="text-xs text-[#8aa897]">Return policy</p>
                    <label className="flex items-center gap-2 text-sm text-[#9eb0a6]">
                      <input
                        type="checkbox"
                        checked={editReturnsAllowed}
                        onChange={(e) =>
                          setEditReturnsAllowed(e.target.checked)
                        }
                      />
                      Returns allowed
                    </label>
                    {editReturnsAllowed ? (
                      <>
                        <label className="block text-xs text-[#9eb0a6]">
                          Return window (days)
                          <input
                            type="number"
                            min={0}
                            value={editReturnDays}
                            onChange={(e) => setEditReturnDays(e.target.value)}
                            className="mt-1 w-full bg-[#17201c] px-3 py-2 text-sm"
                          />
                        </label>
                        <textarea
                          value={editReturnDescription}
                          onChange={(e) =>
                            setEditReturnDescription(e.target.value)
                          }
                          rows={2}
                          placeholder="Return policy description"
                          className="w-full bg-[#17201c] px-3 py-2 text-sm"
                        />
                        <textarea
                          value={editReturnConditions}
                          onChange={(e) =>
                            setEditReturnConditions(e.target.value)
                          }
                          rows={2}
                          placeholder="Return conditions"
                          className="w-full bg-[#17201c] px-3 py-2 text-sm"
                        />
                        <textarea
                          value={editReturnInstructions}
                          onChange={(e) =>
                            setEditReturnInstructions(e.target.value)
                          }
                          rows={2}
                          placeholder="Return instructions"
                          className="w-full bg-[#17201c] px-3 py-2 text-sm"
                        />
                      </>
                    ) : (
                      <p className="text-xs text-amber-400">
                        Customers will see: No Returns Available for This Item.
                      </p>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={busy}
                    className="bg-[#2f6b4f] px-4 py-2 text-sm disabled:opacity-60"
                  >
                    Save product
                  </button>
                </form>

                <div className="border-t border-[#24302a] pt-4">
                  <h3 className="text-sm text-[#8aa897]">Product images</h3>
                  <p className="mt-1 text-[11px] text-[#8aa897]">
                    Upload phone photos here, then enhance them in AI Studio.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(detail.images ?? []).map((img) => (
                      <div
                        key={img.id}
                        className="relative w-20 overflow-hidden rounded-md border border-[#24302a]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={
                            img.url?.startsWith("http")
                              ? img.url
                              : `${API_URL}${img.url}`
                          }
                          alt={img.altText ?? ""}
                          className="aspect-[3/4] w-full object-cover"
                        />
                        <div className="flex flex-col gap-0.5 p-1">
                          {img.isPrimary ? (
                            <span className="text-[9px] text-[#9dcdb4]">
                              Primary
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="text-[9px] text-[#8aa897]"
                              onClick={async () => {
                                if (!token) return;
                                await adminApi.setPrimaryProductImage(
                                  token,
                                  detail.id,
                                  img.id,
                                );
                                await openProduct(detail.id);
                              }}
                            >
                              Make primary
                            </button>
                          )}
                          <button
                            type="button"
                            className="text-[9px] text-red-400"
                            onClick={async () => {
                              if (!token) return;
                              await adminApi.deleteProductImage(
                                token,
                                detail.id,
                                img.id,
                              );
                              await openProduct(detail.id);
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <label className="mt-3 inline-block cursor-pointer border border-[#24302a] px-3 py-2 text-xs">
                    Upload image
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadProductImage(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>

                <div className="border-t border-[#24302a] pt-4">
                  <h3 className="text-sm text-[#8aa897]">Variants</h3>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-[#8aa897]">
                        <tr>
                          <th className="py-1 pr-2 font-normal">SKU</th>
                          <th className="py-1 pr-2 font-normal">Name</th>
                          <th className="py-1 pr-2 font-normal">Retail</th>
                          <th className="py-1 pr-2 font-normal">W10</th>
                          <th className="py-1 font-normal">Active</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.variants.map((v) => (
                          <tr
                            key={v.id}
                            className={`border-t border-[#24302a] ${
                              variantId === v.id ? "bg-[#1a2922]" : ""
                            }`}
                          >
                            <td className="py-2 pr-2">
                              <button
                                type="button"
                                className="text-left hover:underline"
                                onClick={() => {
                                  setVariantId(v.id);
                                  setListCode("RETAIL-ETB");
                                  setMinQty("1");
                                  setUnitPrice(
                                    v.retailPrice != null
                                      ? String(v.retailPrice)
                                      : "",
                                  );
                                }}
                              >
                                {v.sku}
                              </button>
                            </td>
                            <td className="py-2 pr-2 text-[#b7c7be]">
                              {v.name ?? "—"}
                            </td>
                            <td className="py-2 pr-2">
                              {v.retailPrice ?? "—"}
                            </td>
                            <td className="py-2 pr-2">
                              {v.wholesaleQty10 ?? "—"}
                            </td>
                            <td className="py-2">
                              <button
                                type="button"
                                onClick={() =>
                                  toggleVariantActive(v.id, v.isActive)
                                }
                                className={
                                  v.isActive
                                    ? "text-[#2f6b4f]"
                                    : "text-[#8aa897]"
                                }
                              >
                                {v.isActive ? "on" : "off"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <form
                    onSubmit={createVariant}
                    className="mt-3 grid gap-2 sm:grid-cols-[1.2fr_1fr_auto]"
                  >
                    <input
                      value={newVariantName}
                      onChange={(e) => setNewVariantName(e.target.value)}
                      placeholder="Variant name (e.g. 28 / Navy)"
                      className="bg-[#17201c] px-3 py-2 text-sm"
                      required
                    />
                    <input
                      value={newSku}
                      onChange={(e) => setNewSku(e.target.value)}
                      placeholder="SKU optional — auto if blank"
                      className="bg-[#17201c] px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      disabled={busy || !newVariantName.trim()}
                      className="border border-[#24302a] px-3 py-2 text-sm disabled:opacity-60"
                    >
                      Add variant
                    </button>
                  </form>
                </div>

                <div className="border-t border-[#24302a] pt-4">
                  <h3 className="text-sm text-[#8aa897]">
                    Set price tier
                    {selectedVariant ? ` · ${selectedVariant.sku}` : ""}
                  </h3>
                  {selectedVariant && (
                    <ul className="mt-2 space-y-1 text-xs text-[#b7c7be]">
                      {selectedVariant.priceTiers.length === 0 && (
                        <li>No active tiers yet</li>
                      )}
                      {selectedVariant.priceTiers.map((t) => (
                        <li key={`${t.listCode}-${t.minQty}`}>
                          {t.listCode} · qty {t.minQty}+ → {t.unitPrice} ETB
                          {t.compareAtPrice != null
                            ? ` (was ${t.compareAtPrice})`
                            : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => applyQuickTier("retail")}
                      className="border border-[#24302a] px-2 py-1 text-[11px]"
                    >
                      Load retail 1+
                    </button>
                    <button
                      type="button"
                      onClick={() => applyQuickTier("wholesale")}
                      className="border border-[#24302a] px-2 py-1 text-[11px]"
                    >
                      Load wholesale 10+
                    </button>
                    {["10", "50", "100"].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => {
                          setListCode("WHOLESALE-ETB");
                          setMinQty(n);
                        }}
                        className="border border-[#24302a] px-2 py-1 text-[11px]"
                      >
                        W {n}+
                      </button>
                    ))}
                  </div>
                  <form
                    onSubmit={savePrice}
                    className="mt-3 grid gap-2 sm:grid-cols-2"
                  >
                    <select
                      value={variantId}
                      onChange={(e) => setVariantId(e.target.value)}
                      className="bg-[#17201c] px-3 py-2 text-sm sm:col-span-2"
                    >
                      {detail.variants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.sku}
                          {v.name ? ` — ${v.name}` : ""}
                        </option>
                      ))}
                    </select>
                    <select
                      value={listCode}
                      onChange={(e) =>
                        setListCode(
                          e.target.value as "RETAIL-ETB" | "WHOLESALE-ETB",
                        )
                      }
                      className="bg-[#17201c] px-3 py-2 text-sm"
                    >
                      <option value="RETAIL-ETB">RETAIL-ETB</option>
                      <option value="WHOLESALE-ETB">WHOLESALE-ETB</option>
                    </select>
                    <input
                      value={minQty}
                      onChange={(e) => setMinQty(e.target.value)}
                      placeholder="Min qty"
                      className="bg-[#17201c] px-3 py-2 text-sm"
                    />
                    <input
                      required
                      value={unitPrice}
                      onChange={(e) => setUnitPrice(e.target.value)}
                      placeholder="Unit price ETB"
                      className="bg-[#17201c] px-3 py-2 text-sm"
                    />
                    <input
                      value={compareAt}
                      onChange={(e) => setCompareAt(e.target.value)}
                      placeholder="Compare-at (optional)"
                      className="bg-[#17201c] px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      disabled={busy || !variantId}
                      className="bg-[#2f6b4f] px-4 py-2 text-sm disabled:opacity-60 sm:col-span-2"
                    >
                      Save price tier
                    </button>
                  </form>
                </div>
              </div>
            )}

            {message && (
              <p className="mt-4 text-sm text-[#2f6b4f]">{message}</p>
            )}
            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
          </section>
        </div>
      </div>
    </main>
  );
}
