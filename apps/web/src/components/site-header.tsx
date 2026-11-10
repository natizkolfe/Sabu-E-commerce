"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "../lib/api";
import { useAuth } from "../context/auth-context";
import { useCart } from "../context/cart-context";

type Cat = Awaited<ReturnType<typeof api.listCategories>>[number];

const links = [
  { href: "/", label: "Home" },
  { href: "/catalog", label: "All Categories" },
  { href: "/catalog?newArrivals=1", label: "New Arrivals" },
  { href: "/catalog?sort=bestselling", label: "Best Sellers" },
  { href: "/catalog?onSale=1", label: "Special Offers" },
  { href: "/#special-orders", label: "Special Orders" },
  { href: "/orders/track", label: "Track Order" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { user, ready } = useAuth();
  const { itemCount } = useCart();
  const onHero = pathname === "/";
  const [topCats, setTopCats] = useState<Cat[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api
      .listCategories({ tree: true })
      .then((rows) =>
        setTopCats(
          rows
            .filter((c) => !c.parentId)
            .sort(
              (a, b) =>
                (a.featuredSort ?? a.sortOrder ?? 0) -
                  (b.featuredSort ?? b.sortOrder ?? 0) ||
                a.name.localeCompare(b.name),
            ),
        ),
      )
      .catch(() => undefined);
  }, []);

  return (
    <header
      className={`absolute inset-x-0 top-0 z-20 ${
        onHero ? "text-sabu-cream" : "text-sabu-ink"
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5">
        <Link
          href="/"
          className="font-[family-name:var(--font-syne)] text-2xl tracking-tight"
        >
          Sabu
        </Link>
        <nav className="hidden items-center gap-5 text-sm lg:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`transition ${
                onHero
                  ? "text-sabu-mist hover:text-white"
                  : "text-sabu-moss hover:text-sabu-ink"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <div
            className="relative"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
          >
            <button
              type="button"
              className={`transition ${
                onHero
                  ? "text-sabu-mist hover:text-white"
                  : "text-sabu-moss hover:text-sabu-ink"
              }`}
            >
              Shop ▾
            </button>
            {open && topCats.length > 0 && (
              <div
                className={`absolute top-full left-0 mt-2 min-w-[220px] border p-2 shadow-lg ${
                  onHero
                    ? "border-white/10 bg-[#0f1412] text-sabu-cream"
                    : "border-sabu-mist bg-sabu-paper text-sabu-ink"
                }`}
              >
                {topCats.map((c) => (
                  <Link
                    key={c.id}
                    href={`/catalog?category=${encodeURIComponent(c.slug)}`}
                    className="block px-3 py-2 text-sm hover:bg-sabu-leaf/15"
                    onClick={() => setOpen(false)}
                  >
                    {c.name}
                  </Link>
                ))}
                <Link
                  href="/catalog?bulk=1"
                  className="mt-1 block border-t border-sabu-mist/40 px-3 py-2 text-sm text-sabu-leaf"
                  onClick={() => setOpen(false)}
                >
                  Bulk buy
                </Link>
              </div>
            )}
          </div>
          <Link
            href="/cart"
            className={`transition ${
              onHero
                ? "text-sabu-mist hover:text-white"
                : "text-sabu-moss hover:text-sabu-ink"
            }`}
          >
            Cart{itemCount > 0 ? ` (${itemCount})` : ""}
          </Link>
          {!ready ? null : user ? (
            <Link
              href="/account"
              className={`rounded-sm px-3 py-2 transition ${
                onHero
                  ? "bg-sabu-cream/15 hover:bg-sabu-cream/25"
                  : "bg-sabu-leaf text-sabu-cream hover:bg-sabu-forest"
              }`}
            >
              {user.fullName.split(" ")[0]}
            </Link>
          ) : (
            <Link
              href="/login"
              className={`rounded-sm px-3 py-2 transition ${
                onHero
                  ? "bg-sabu-cream text-sabu-ink hover:bg-white"
                  : "bg-sabu-leaf text-sabu-cream hover:bg-sabu-forest"
              }`}
            >
              Sign in
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-3 lg:hidden">
          <Link href="/catalog" className="text-sm">
            Shop
          </Link>
          <Link href="/cart" className="text-sm">
            Cart{itemCount > 0 ? ` (${itemCount})` : ""}
          </Link>
          <Link
            href={user ? "/account" : "/login"}
            className={`rounded-sm px-2.5 py-1.5 text-sm ${
              onHero
                ? "bg-sabu-cream text-sabu-ink"
                : "bg-sabu-leaf text-sabu-cream"
            }`}
          >
            {user ? user.fullName.split(" ")[0] : "Sign in"}
          </Link>
        </div>
      </div>
    </header>
  );
}
