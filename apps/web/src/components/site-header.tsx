"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../context/auth-context";
import { useCart } from "../context/cart-context";

const links = [
  { href: "/catalog", label: "Catalog" },
  { href: "/catalog?bulk=1", label: "Bulk buy" },
  { href: "/orders/track", label: "Track" },
  { href: "/#special-orders", label: "Special orders" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { user, ready } = useAuth();
  const { itemCount } = useCart();
  const onHero = pathname === "/";

  return (
    <header
      className={`absolute inset-x-0 top-0 z-20 ${
        onHero ? "text-sabu-cream" : "text-sabu-ink"
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link
          href="/"
          className="font-[family-name:var(--font-syne)] text-2xl tracking-tight"
        >
          Sabu
        </Link>
        <nav className="flex items-center gap-6 text-sm">
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
      </div>
    </header>
  );
}
