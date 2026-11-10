"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Cat = {
  id: string;
  slug: string;
  name: string;
  isFeatured?: boolean;
  featuredSort?: number;
  parentId?: string | null;
};

export function HomeDepartments() {
  const [items, setItems] = useState<Array<{ href: string; label: string }>>(
    [],
  );

  useEffect(() => {
    api
      .listCategories({ tree: true })
      .then((tree) => {
        const roots = tree as Cat[];
        const featured = roots
          .filter((c) => c.isFeatured)
          .sort(
            (a, b) =>
              (a.featuredSort ?? 0) - (b.featuredSort ?? 0) ||
              a.name.localeCompare(b.name),
          );
        const source = featured.length ? featured : roots.slice(0, 8);
        const links = source.map((c) => ({
          href: `/catalog?category=${encodeURIComponent(c.slug)}`,
          label: c.name,
        }));
        links.push({ href: "/catalog", label: "All departments →" });
        setItems(links);
      })
      .catch(() => {
        setItems([{ href: "/catalog", label: "All departments →" }]);
      });
  }, []);

  return (
    <div className="mt-10 flex flex-wrap gap-2">
      {items.map((item) => (
        <Link
          key={item.href + item.label}
          href={item.href}
          className="border border-sabu-mist px-3 py-2 text-sm text-sabu-ink transition hover:border-sabu-leaf hover:text-sabu-leaf"
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
