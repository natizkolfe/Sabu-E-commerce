import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-sabu-mist/30 bg-sabu-forest text-sabu-cream">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-[family-name:var(--font-syne)] text-2xl">Sabu</p>
          <p className="mt-2 max-w-sm text-sm text-sabu-mist">
            Retail, wholesale, and Dubai-sourced specials — delivered across
            Ethiopia.
          </p>
        </div>
        <div className="flex gap-6 text-sm text-sabu-mist">
          <Link href="/catalog" className="hover:text-white">
            Catalog
          </Link>
          <Link href="/login" className="hover:text-white">
            Sign in
          </Link>
        </div>
      </div>
    </footer>
  );
}
