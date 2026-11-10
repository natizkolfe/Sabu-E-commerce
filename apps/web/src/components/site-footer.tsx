import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-sabu-mist/30 bg-sabu-forest text-sabu-cream">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-[family-name:var(--font-syne)] text-2xl">
            Sabu Online Shopping
          </p>
          <p className="mt-2 max-w-sm text-sm text-sabu-mist">
            Everyday shopping for Ethiopia — every aisle, one checkout,
            delivered to your door.
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <div className="flex gap-6 text-sm text-sabu-mist">
            <Link href="/catalog" className="hover:text-white">
              Shop
            </Link>
            <Link href="/catalog?bulk=1" className="hover:text-white">
              Bulk buy
            </Link>
            <Link href="/login" className="hover:text-white">
              Sign in
            </Link>
          </div>
          <p className="text-xs text-sabu-mist/80">
            ©{" "}
            <span className="text-sabu-cream">Lulie Tech LLC</span>
            . All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
