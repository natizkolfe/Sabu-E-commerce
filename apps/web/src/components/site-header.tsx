"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { api } from "../lib/api";
import { useAuth } from "../context/auth-context";
import { useCart } from "../context/cart-context";

type Cat = Awaited<ReturnType<typeof api.listCategories>>[number];

const links = [
  { href: "/", label: "Home", match: "home" as const },
  { href: "/catalog", label: "All Categories", match: "catalog" as const },
  {
    href: "/catalog?newArrivals=1",
    label: "New Arrivals",
    match: "newArrivals" as const,
  },
  {
    href: "/catalog?sort=bestselling",
    label: "Best Sellers",
    match: "bestselling" as const,
  },
  {
    href: "/catalog?onSale=1",
    label: "Special Offers",
    match: "onSale" as const,
  },
  {
    href: "/#special-orders",
    label: "Special Orders",
    match: "specialOrders" as const,
  },
  { href: "/orders/track", label: "Track Order", match: "track" as const },
];

function linkClass(active: boolean, onHero: boolean) {
  if (active) {
    return onHero
      ? "font-medium text-white underline decoration-sabu-leaf decoration-2 underline-offset-8"
      : "font-medium text-sabu-ink underline decoration-sabu-leaf decoration-2 underline-offset-8";
  }
  return onHero
    ? "text-sabu-mist transition hover:text-white"
    : "text-sabu-moss transition hover:text-sabu-ink";
}

export function SiteHeader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, ready } = useAuth();
  const { itemCount } = useCart();
  const onHero = pathname === "/";
  const [topCats, setTopCats] = useState<Cat[]>([]);
  const [open, setOpen] = useState(false);
  const [hash, setHash] = useState("");

  useEffect(() => {
    const syncHash = () => setHash(window.location.hash);
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [pathname]);

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

  function isActive(match: (typeof links)[number]["match"]) {
    const category = searchParams.get("category");
    const bulk = searchParams.get("bulk");
    const newArrivals = searchParams.get("newArrivals");
    const onSale = searchParams.get("onSale");
    const sort = searchParams.get("sort");
    const catalogFiltered = Boolean(
      category || bulk || newArrivals || onSale || sort,
    );

    switch (match) {
      case "home":
        return pathname === "/" && hash !== "#special-orders";
      case "catalog":
        return (
          (pathname === "/catalog" || pathname.startsWith("/catalog/")) &&
          !catalogFiltered
        );
      case "newArrivals":
        return pathname === "/catalog" && newArrivals === "1";
      case "bestselling":
        return pathname === "/catalog" && sort === "bestselling";
      case "onSale":
        return pathname === "/catalog" && onSale === "1";
      case "specialOrders":
        return pathname === "/" && hash === "#special-orders";
      case "track":
        return pathname.startsWith("/orders/track");
      default:
        return false;
    }
  }

  const shopActive =
    pathname.startsWith("/catalog") &&
    Boolean(searchParams.get("category") || searchParams.get("bulk"));
  const cartActive = pathname.startsWith("/cart") || pathname.startsWith("/checkout");
  const accountActive =
    pathname.startsWith("/account") || pathname.startsWith("/login");

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
          aria-current={pathname === "/" ? "page" : undefined}
        >
          Sabu
        </Link>
        <nav
          className="hidden items-center gap-5 text-sm lg:flex"
          aria-label="Main"
        >
          {links.map((link) => {
            const active = isActive(link.match);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={linkClass(active, onHero)}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </Link>
            );
          })}
          <div
            className="relative"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
          >
            <button
              type="button"
              className={linkClass(shopActive, onHero)}
              aria-expanded={open}
              aria-haspopup="true"
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
                {topCats.map((c) => {
                  const active =
                    pathname === "/catalog" &&
                    searchParams.get("category") === c.slug;
                  return (
                    <Link
                      key={c.id}
                      href={`/catalog?category=${encodeURIComponent(c.slug)}`}
                      className={`block px-3 py-2 text-sm hover:bg-sabu-leaf/15 ${
                        active ? "bg-sabu-leaf/15 font-medium text-sabu-leaf" : ""
                      }`}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpen(false)}
                    >
                      {c.name}
                    </Link>
                  );
                })}
                <Link
                  href="/catalog?bulk=1"
                  className={`mt-1 block border-t border-sabu-mist/40 px-3 py-2 text-sm ${
                    pathname === "/catalog" && searchParams.get("bulk") === "1"
                      ? "font-medium text-sabu-leaf"
                      : "text-sabu-leaf"
                  }`}
                  aria-current={
                    pathname === "/catalog" && searchParams.get("bulk") === "1"
                      ? "page"
                      : undefined
                  }
                  onClick={() => setOpen(false)}
                >
                  Bulk buy
                </Link>
              </div>
            )}
          </div>
          <Link
            href="/cart"
            className={linkClass(cartActive, onHero)}
            aria-current={cartActive ? "page" : undefined}
          >
            Cart{itemCount > 0 ? ` (${itemCount})` : ""}
          </Link>
          {!ready ? null : user ? (
            <Link
              href="/account"
              className={`rounded-sm px-3 py-2 transition ${
                accountActive
                  ? onHero
                    ? "bg-sabu-cream text-sabu-ink ring-2 ring-sabu-leaf/60"
                    : "bg-sabu-forest text-sabu-cream ring-2 ring-sabu-leaf/40"
                  : onHero
                    ? "bg-sabu-cream/15 hover:bg-sabu-cream/25"
                    : "bg-sabu-leaf text-sabu-cream hover:bg-sabu-forest"
              }`}
              aria-current={accountActive ? "page" : undefined}
            >
              {user.fullName.split(" ")[0]}
            </Link>
          ) : (
            <Link
              href="/login"
              className={`rounded-sm px-3 py-2 transition ${
                accountActive
                  ? onHero
                    ? "bg-white text-sabu-ink ring-2 ring-sabu-leaf/60"
                    : "bg-sabu-forest text-sabu-cream ring-2 ring-sabu-leaf/40"
                  : onHero
                    ? "bg-sabu-cream text-sabu-ink hover:bg-white"
                    : "bg-sabu-leaf text-sabu-cream hover:bg-sabu-forest"
              }`}
              aria-current={accountActive ? "page" : undefined}
            >
              Sign in
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-3 lg:hidden">
          <Link
            href="/catalog"
            className={`text-sm ${
              pathname.startsWith("/catalog")
                ? "font-medium underline decoration-sabu-leaf decoration-2 underline-offset-4"
                : ""
            }`}
            aria-current={pathname.startsWith("/catalog") ? "page" : undefined}
          >
            Shop
          </Link>
          <Link
            href="/cart"
            className={`text-sm ${
              cartActive
                ? "font-medium underline decoration-sabu-leaf decoration-2 underline-offset-4"
                : ""
            }`}
            aria-current={cartActive ? "page" : undefined}
          >
            Cart{itemCount > 0 ? ` (${itemCount})` : ""}
          </Link>
          <Link
            href={user ? "/account" : "/login"}
            className={`rounded-sm px-2.5 py-1.5 text-sm ${
              onHero
                ? "bg-sabu-cream text-sabu-ink"
                : "bg-sabu-leaf text-sabu-cream"
            } ${accountActive ? "ring-2 ring-sabu-leaf/50" : ""}`}
            aria-current={accountActive ? "page" : undefined}
          >
            {user ? user.fullName.split(" ")[0] : "Sign in"}
          </Link>
        </div>
      </div>
    </header>
  );
}
