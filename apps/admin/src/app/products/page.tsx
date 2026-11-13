"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { API_URL, adminApi, ApiError } from "../../lib/api";
import { formatLabel } from "../../lib/format";
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
  const [enhanceLibrary, setEnhanceLibrary] = useState<
    Awaited<ReturnType<typeof adminApi.studioLibrary>>
  >([]);
  const [newLibraryImageIds, setNewLibraryImageIds] = useState<string[]>([]);

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
  const [removeBackground, setRemoveBackground] = useState(false);
  const [pendingEnhance, setPendingEnhance] = useState<
    Awaited<ReturnType<typeof adminApi.studioPending>>
  >([]);

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
    if (token) await refreshPendingEnhance(id, token);
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
      let attached = 0;
      for (const [i, imageId] of newLibraryImageIds.entries()) {
        try {
          await adminApi.studioAttach(token, imageId, {
            productId: created.id,
            setPrimary: i === 0,
            includeOriginal: true,
          });
          attached += 1;
        } catch {
          // continue attaching remaining
        }
      }
      setMessage(
        created.retailNumber
          ? `Product created · retail # ${created.retailNumber}${
              attached ? ` · ${attached} enhanced image(s) attached` : ""
            }`
          : attached
            ? `Product created · ${attached} enhanced image(s) attached`
            : "Product created",
      );
      setShowCreate(false);
      setNewName("");
      setNewSlug("");
      setNewLibraryImageIds([]);
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

  async function refreshPendingEnhance(productId: string, accessToken: string) {
    try {
      const [forProduct, staged, lib] = await Promise.all([
        adminApi.studioPending(accessToken, {
          productId,
          jobType: "product_transform",
        }),
        adminApi.studioPending(accessToken, {
          stagedOnly: true,
          jobType: "product_transform",
        }),
        adminApi.studioLibrary(accessToken).catch(() => []),
      ]);
      const seen = new Set(forProduct.map((j) => j.id));
      setPendingEnhance([
        ...forProduct,
        ...staged.filter((j) => !seen.has(j.id)),
      ]);
      setEnhanceLibrary(lib);
    } catch {
      setPendingEnhance([]);
    }
  }

  async function loadEnhanceLibrary(accessToken: string) {
    try {
      setEnhanceLibrary(await adminApi.studioLibrary(accessToken));
    } catch {
      setEnhanceLibrary([]);
    }
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
      setMessage("Image uploaded — use Enhance with AI for white background");
      await openProduct(detail.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function enhanceImage(storageKey: string) {
    if (!token || !detail) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.studioGenerate(token, {
        productId: detail.id,
        jobType: "product_transform",
        transformPreset: "white_background_ecommerce",
        sourceImageKey: storageKey,
        removeBackground,
      });
      setMessage(
        removeBackground
          ? `Enhanced with bg removal (${res.provider ?? "ai"}) — review below`
          : `White canvas ready (${res.provider ?? "canvas"}) — review below`,
      );
      await refreshPendingEnhance(detail.id, token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Enhance failed");
    } finally {
      setBusy(false);
    }
  }

  async function approveEnhance(id: string) {
    if (!token || !detail) return;
    setBusy(true);
    try {
      const job = pendingEnhance.find((j) => j.id === id);
      if (job?.staged || !job?.productId) {
        await adminApi.studioAttach(token, id, {
          productId: detail.id,
          setPrimary: true,
          includeOriginal: true,
        });
        setMessage("Staged enhance assigned to this product as primary");
      } else {
        await adminApi.studioApprove(token, id);
        setMessage("Enhanced image approved and set as primary");
      }
      await refreshPendingEnhance(detail.id, token);
      await openProduct(detail.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  }

  async function rejectEnhance(id: string) {
    if (!token || !detail) return;
    await adminApi.studioReject(token, id);
    setMessage("Kept original — enhanced draft discarded");
    await refreshPendingEnhance(detail.id, token);
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
              setNewLibraryImageIds([]);
              if (token) void loadEnhanceLibrary(token);
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
                        {p.categoryName} · {p.variantCount} var ·{" "}
                        {formatLabel(p.status)}
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

                <div className="border border-[#24302a] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm text-[#9dcdb4]">
                        Enhanced photos from library
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#8aa897]">
                        Optional — pick clean images you already enhanced.
                        First selected becomes primary.
                      </p>
                    </div>
                    <Link
                      href="/studio"
                      className="text-[11px] text-[#9dcdb4] underline"
                    >
                      Enhance more →
                    </Link>
                  </div>
                  {enhanceLibrary.length === 0 ? (
                    <p className="mt-3 text-xs text-[#8aa897]">
                      No saved enhances yet. Enhance phone photos first, then
                      create the product.
                    </p>
                  ) : (
                    <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {enhanceLibrary.map((img) => {
                        const selected = newLibraryImageIds.includes(img.id);
                        const src = `${API_URL}${
                          img.resultUrl ??
                          img.previewUrl ??
                          `/studio/images/${img.id}/preview`
                        }`;
                        return (
                          <li key={img.id}>
                            <button
                              type="button"
                              onClick={() =>
                                setNewLibraryImageIds((prev) =>
                                  selected
                                    ? prev.filter((id) => id !== img.id)
                                    : [...prev, img.id],
                                )
                              }
                              className={`w-full overflow-hidden rounded-md border ${
                                selected
                                  ? "border-[#2f6b4f] ring-1 ring-[#2f6b4f]"
                                  : "border-[#24302a]"
                              }`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={src}
                                alt="Enhanced"
                                className="aspect-[3/4] w-full object-cover"
                              />
                              <span className="block truncate px-1 py-1 text-[9px] text-[#8aa897]">
                                {selected
                                  ? `#${newLibraryImageIds.indexOf(img.id) + 1} · `
                                  : ""}
                                {img.label ?? img.productName ?? "Select"}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
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
                      {formatLabel(detail.status)}
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
                    Prefer{" "}
                    <Link href="/studio" className="text-[#9dcdb4] underline">
                      Enhance photos
                    </Link>{" "}
                    for white-canvas standards, then assign here. Try-on is
                    optional and separate.
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2 rounded border border-[#24302a] px-2 py-1.5">
                    <span className="text-[11px] text-[#8aa897]">
                      Remove background when enhancing
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={removeBackground}
                      onClick={() => setRemoveBackground((v) => !v)}
                      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
                        removeBackground ? "bg-[#2f6b4f]" : "bg-[#2a3530]"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                          removeBackground ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {(detail.images ?? []).map((img) => {
                      const src = img.url?.startsWith("http")
                        ? img.url
                        : `${API_URL}${img.url}`;
                      const isOriginal =
                        !img.source ||
                        img.source === "upload" ||
                        img.source === "seed";
                      return (
                        <div
                          key={img.id}
                          className="w-28 overflow-hidden rounded-md border border-[#24302a]"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={src}
                            alt={img.altText ?? ""}
                            className="aspect-[3/4] w-full object-cover"
                          />
                          <div className="space-y-0.5 p-1.5">
                            <span className="block text-[9px] uppercase tracking-wide text-[#8aa897]">
                              {img.isPrimary ? "Primary · " : ""}
                              {img.source === "ai_enhance"
                                ? "AI enhanced"
                                : isOriginal
                                  ? "Original"
                                  : img.source}
                            </span>
                            {isOriginal && (
                              <button
                                type="button"
                                disabled={busy}
                                className="w-full bg-[#2f6b4f] px-1 py-1 text-[10px] disabled:opacity-50"
                                onClick={() =>
                                  void enhanceImage(img.storageKey)
                                }
                              >
                                Enhance with AI
                              </button>
                            )}
                            {!img.isPrimary && (
                              <button
                                type="button"
                                className="w-full text-[9px] text-[#8aa897]"
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
                              className="w-full text-[9px] text-red-400"
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
                      );
                    })}
                  </div>
                  <label className="mt-3 inline-block cursor-pointer border border-[#24302a] px-3 py-2 text-xs">
                    Upload phone photo
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadProductImage(f);
                        e.target.value = "";
                      }}
                    />
                  </label>

                  {pendingEnhance.length > 0 && (
                    <div className="mt-4 space-y-4 border border-[#24302a] p-3">
                      <p className="text-xs text-[#9dcdb4]">
                        Pending AI enhance — approve to publish, or assign a
                        staged enhance to this product
                      </p>
                      {pendingEnhance.map((job) => {
                        const staged = job.staged || !job.productId;
                        const originalSrc = job.sourceUrl
                          ? `${API_URL}${job.sourceUrl}`
                          : null;
                        const resultSrc = `${API_URL}${
                          job.resultUrl ??
                          job.previewUrl ??
                          `/studio/images/${job.id}/preview`
                        }`;
                        return (
                          <div key={job.id}>
                            <p className="text-[11px] text-[#8aa897]">
                              {(job.transformPreset ?? "enhance").replace(
                                /_/g,
                                " ",
                              )}{" "}
                              · {job.provider ?? "ai"}
                              {staged ? " · staged (unassigned)" : ""}
                            </p>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              <div>
                                <p className="mb-1 text-[10px] uppercase text-[#8aa897]">
                                  Original
                                </p>
                                <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg border border-[#24302a] bg-[#17201c]">
                                  {originalSrc ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={originalSrc}
                                      alt="Original"
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <span className="px-2 text-center text-[10px] text-[#8aa897]">
                                      No source preview
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div>
                                <p className="mb-1 text-[10px] uppercase text-[#8aa897]">
                                  AI enhanced
                                </p>
                                <div className="overflow-hidden rounded-lg border border-[#24302a]">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={resultSrc}
                                    alt="Enhanced"
                                    className="aspect-[3/4] w-full object-cover"
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void approveEnhance(job.id)}
                                className="bg-[#2f6b4f] px-3 py-1.5 text-xs disabled:opacity-50"
                              >
                                {staged ? "Assign to this product" : "Approve"}
                              </button>
                              <button
                                type="button"
                                disabled={busy || !job.sourceImageKey}
                                onClick={() =>
                                  job.sourceImageKey &&
                                  void enhanceImage(job.sourceImageKey)
                                }
                                className="border border-[#24302a] px-3 py-1.5 text-xs disabled:opacity-50"
                              >
                                Regenerate
                              </button>
                              <button
                                type="button"
                                onClick={() => void rejectEnhance(job.id)}
                                className="border border-[#24302a] px-3 py-1.5 text-xs"
                              >
                                Keep original
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
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
