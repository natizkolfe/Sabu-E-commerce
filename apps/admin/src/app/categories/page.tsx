"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { loadSession } from "../../lib/session";

type CategoryNode = {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  nameAm: string | null;
  path: string;
  sortOrder: number;
  isActive: boolean;
  isFeatured: boolean;
  featuredSort: number;
  description: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  aiStudioEnabled: boolean;
  imageKey?: string | null;
  iconKey?: string | null;
  imageStorageKey?: string | null;
  iconStorageKey?: string | null;
  children?: CategoryNode[];
};

type Attribute = Awaited<ReturnType<typeof adminApi.listAttributes>>[number];

function flatten(
  nodes: CategoryNode[],
  depth = 0,
): Array<CategoryNode & { depth: number }> {
  const out: Array<CategoryNode & { depth: number }> = [];
  for (const n of nodes) {
    out.push({ ...n, depth });
    if (n.children?.length) out.push(...flatten(n.children, depth + 1));
  }
  return out;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function CategoriesAdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assigned, setAssigned] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [parentId, setParentId] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isFeatured, setIsFeatured] = useState(false);
  const [featuredSort, setFeaturedSort] = useState(0);
  const [sortOrder, setSortOrder] = useState(0);
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [aiStudioEnabled, setAiStudioEnabled] = useState(false);
  const [imageStorageKey, setImageStorageKey] = useState("");
  const [iconStorageKey, setIconStorageKey] = useState("");

  const flat = useMemo(() => flatten(tree), [tree]);
  const selected = flat.find((c) => c.id === selectedId) ?? null;

  const refresh = useCallback(async (accessToken: string) => {
    const [cats, attrs] = await Promise.all([
      adminApi.adminCategories(accessToken),
      adminApi.listAttributes(accessToken),
    ]);
    setTree(cats as CategoryNode[]);
    setAttributes(attrs);
  }, []);

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    refresh(s.accessToken).catch((err: unknown) =>
      setError(err instanceof ApiError ? err.message : "Failed to load"),
    );
  }, [refresh]);

  useEffect(() => {
    if (!token || !selectedId) {
      setAssigned([]);
      return;
    }
    adminApi
      .getCategoryAttributes(token, selectedId)
      .then((rows) => setAssigned(rows.map((r) => r.attributeId)))
      .catch(() => setAssigned([]));
  }, [token, selectedId]);

  function selectCategory(c: CategoryNode) {
    setSelectedId(c.id);
    setName(c.name);
    setSlug(c.slug);
    setParentId(c.parentId ?? "");
    setDescription(c.description ?? "");
    setIsActive(c.isActive);
    setIsFeatured(c.isFeatured);
    setFeaturedSort(c.featuredSort ?? 0);
    setSortOrder(c.sortOrder);
    setMetaTitle(c.metaTitle ?? "");
    setMetaDescription(c.metaDescription ?? "");
    setAiStudioEnabled(c.aiStudioEnabled);
    setImageStorageKey(c.imageKey ?? c.imageStorageKey ?? "");
    setIconStorageKey(c.iconKey ?? c.iconStorageKey ?? "");
    setMessage(null);
    setError(null);
  }

  function resetForm() {
    setSelectedId(null);
    setName("");
    setSlug("");
    setParentId("");
    setDescription("");
    setIsActive(true);
    setIsFeatured(false);
    setFeaturedSort(0);
    setSortOrder(0);
    setMetaTitle("");
    setMetaDescription("");
    setAiStudioEnabled(false);
    setImageStorageKey("");
    setIconStorageKey("");
    setAssigned([]);
  }

  async function uploadCategoryAsset(
    file: File,
    kind: "image" | "icon",
  ) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const data = await fileToDataUrl(file);
      const uploaded = await adminApi.uploadMedia(token, {
        data,
        folder: `categories/${kind}`,
        mimeType: file.type || undefined,
      });
      if (kind === "image") setImageStorageKey(uploaded.storageKey);
      else setIconStorageKey(uploaded.storageKey);
      setMessage(`${kind === "image" ? "Image" : "Icon"} uploaded — save category to keep`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!token || !name.trim() || !slug.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        parentId: parentId || null,
        slug: slug.trim().toLowerCase(),
        name: name.trim(),
        description: description || null,
        sortOrder: Number(sortOrder) || 0,
        isActive,
        isFeatured,
        featuredSort: Number(featuredSort) || 0,
        imageStorageKey: imageStorageKey || null,
        iconStorageKey: iconStorageKey || null,
        metaTitle: metaTitle || null,
        metaDescription: metaDescription || null,
        aiStudioEnabled,
      };
      if (selectedId) {
        await adminApi.updateCategory(token, selectedId, body);
        setMessage("Category updated — storefront reflects changes immediately");
      } else {
        const created = await adminApi.createCategory(token, body);
        setSelectedId(created.id);
        setMessage("Category created");
      }
      await refresh(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveAttributes() {
    if (!token || !selectedId) return;
    setBusy(true);
    try {
      await adminApi.setCategoryAttributes(
        token,
        selectedId,
        assigned.map((attributeId, idx) => ({
          attributeId,
          isRequired: false,
          sortOrder: idx * 10,
        })),
      );
      setMessage("Category attributes saved (used for storefront filters)");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Attribute save failed");
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
        <Link href="/" className="text-sm text-[#8aa897]">
          ← Admin
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl tracking-tight">Category management</h1>
            <p className="mt-1 text-sm text-[#9eb0a6]">
              Unlimited nested categories for any retail vertical — no code
              changes required to add new departments.
            </p>
          </div>
          <button
            type="button"
            onClick={resetForm}
            className="border border-[#24302a] px-3 py-2 text-sm"
          >
            New category
          </button>
        </div>

        {message && <p className="mt-4 text-sm text-[#2f6b4f]">{message}</p>}
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <section className="border border-[#24302a]">
            <div className="border-b border-[#24302a] px-3 py-2 text-sm text-[#8aa897]">
              Category tree
            </div>
            <ul className="max-h-[70vh] divide-y divide-[#24302a] overflow-y-auto">
              {flat.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => selectCategory(c)}
                    className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm ${
                      selectedId === c.id ? "bg-[#14201a]" : ""
                    }`}
                    style={{ paddingLeft: `${12 + c.depth * 14}px` }}
                  >
                    <span>
                      {c.name}
                      <span className="ml-2 text-[11px] text-[#8aa897]">
                        /{c.slug}
                      </span>
                    </span>
                    <span className="text-[10px] text-[#8aa897]">
                      {!c.isActive ? "inactive" : c.isFeatured ? "featured" : ""}
                    </span>
                  </button>
                </li>
              ))}
              {flat.length === 0 && (
                <li className="px-3 py-6 text-sm text-[#8aa897]">
                  No categories yet
                </li>
              )}
            </ul>
          </section>

          <section className="border border-[#24302a] p-4">
            <h2 className="text-xl">
              {selected ? `Edit · ${selected.name}` : "Create category"}
            </h2>
            <form onSubmit={onSave} className="mt-4 space-y-3 text-sm">
              <label className="block text-xs text-[#8aa897]">
                Parent
                <select
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  className="mt-1 w-full bg-[#17201c] px-3 py-2 text-sm"
                >
                  <option value="">Top level</option>
                  {flat
                    .filter((c) => c.id !== selectedId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {"—".repeat(c.depth)} {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block text-xs text-[#8aa897]">
                Name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full bg-[#17201c] px-3 py-2"
                  required
                />
              </label>
              <label className="block text-xs text-[#8aa897]">
                Slug (URL)
                <input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="mt-1 w-full bg-[#17201c] px-3 py-2 font-mono text-xs"
                  required
                />
              </label>
              <label className="block text-xs text-[#8aa897]">
                Description
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="mt-1 w-full bg-[#17201c] px-3 py-2"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-[#8aa897]">
                  Sort order
                  <input
                    type="number"
                    value={sortOrder}
                    onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
                    className="mt-1 w-full bg-[#17201c] px-3 py-2"
                  />
                </label>
                <label className="block text-xs text-[#8aa897]">
                  Featured sort
                  <input
                    type="number"
                    value={featuredSort}
                    onChange={(e) =>
                      setFeaturedSort(Number(e.target.value) || 0)
                    }
                    className="mt-1 w-full bg-[#17201c] px-3 py-2"
                  />
                </label>
              </div>
              <div className="flex flex-col gap-2 text-xs">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                  />
                  Active on storefront
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={isFeatured}
                    onChange={(e) => setIsFeatured(e.target.checked)}
                  />
                  Featured on homepage
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={aiStudioEnabled}
                    onChange={(e) => setAiStudioEnabled(e.target.checked)}
                  />
                  AI Studio enabled for this category
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-[#8aa897]">
                  Category image
                  <input
                    type="file"
                    accept="image/*"
                    className="mt-1 block w-full text-xs"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadCategoryAsset(f, "image");
                    }}
                  />
                  {imageStorageKey && (
                    <span className="mt-1 block truncate text-[10px] text-[#8aa897]">
                      {imageStorageKey}
                    </span>
                  )}
                </label>
                <label className="block text-xs text-[#8aa897]">
                  Category icon
                  <input
                    type="file"
                    accept="image/*"
                    className="mt-1 block w-full text-xs"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadCategoryAsset(f, "icon");
                    }}
                  />
                  {iconStorageKey && (
                    <span className="mt-1 block truncate text-[10px] text-[#8aa897]">
                      {iconStorageKey}
                    </span>
                  )}
                </label>
              </div>
              <label className="block text-xs text-[#8aa897]">
                SEO title
                <input
                  value={metaTitle}
                  onChange={(e) => setMetaTitle(e.target.value)}
                  className="mt-1 w-full bg-[#17201c] px-3 py-2"
                />
              </label>
              <label className="block text-xs text-[#8aa897]">
                SEO description
                <textarea
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  rows={2}
                  className="mt-1 w-full bg-[#17201c] px-3 py-2"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="bg-[#2f6b4f] px-4 py-2 text-sm disabled:opacity-50"
              >
                {selectedId ? "Save category" : "Create category"}
              </button>
            </form>

            {selectedId && (
              <div className="mt-8 border-t border-[#24302a] pt-4">
                <h3 className="text-sm text-[#8aa897]">
                  Category-specific attributes (filters)
                </h3>
                <p className="mt-1 text-xs text-[#8aa897]">
                  These drive storefront filters when shoppers browse this
                  category (size/color for fashion, fabric/width for curtains,
                  etc.).
                </p>
                <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-sm">
                  {attributes.map((a) => {
                    const checked = assigned.includes(a.id);
                    return (
                      <li key={a.id}>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setAssigned((prev) =>
                                e.target.checked
                                  ? [...prev, a.id]
                                  : prev.filter((id) => id !== a.id),
                              );
                            }}
                          />
                          {a.name}
                          <span className="text-[11px] text-[#8aa897]">
                            {a.dataType ?? "dropdown"} · {a.code}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <button
                  type="button"
                  disabled={busy}
                  onClick={saveAttributes}
                  className="mt-3 border border-[#24302a] px-3 py-2 text-xs disabled:opacity-50"
                >
                  Save attribute set
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
