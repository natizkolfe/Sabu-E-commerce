import Link from "next/link";

export default function Home() {
  return (
    <main>
      <section className="relative flex min-h-screen items-end overflow-hidden bg-sabu-ink pb-20 pt-28 sm:items-center sm:pb-24">
        <div
          aria-hidden
          className="sabu-gradient-shift absolute inset-0 bg-[radial-gradient(ellipse_at_20%_20%,#1a4d3a_0%,transparent_50%),radial-gradient(ellipse_at_80%_0%,#0f3d2e_0%,transparent_45%),linear-gradient(160deg,#07140f_0%,#0b1f17_55%,#123528_100%)]"
        />
        <div
          aria-hidden
          className="sabu-hero-glow pointer-events-none absolute -right-24 top-10 h-[28rem] w-[28rem] rounded-full bg-[#2f6b52]/30 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239bc4b0' fill-opacity='0.35'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
          }}
        />

        <div className="relative z-10 mx-auto w-full max-w-6xl px-6">
          <p className="sabu-rise text-xs tracking-[0.28em] text-sabu-mist uppercase">
            Sabu Online Shopping · Ethiopia
          </p>
          <h1 className="sabu-rise sabu-rise-delay-1 mt-4 font-[family-name:var(--font-syne)] text-6xl leading-[0.95] tracking-tight text-sabu-cream sm:text-8xl">
            Sabu
          </h1>
          <p className="sabu-rise sabu-rise-delay-2 mt-6 max-w-lg text-base text-sabu-mist sm:text-lg">
            One store for everyday life — fashion, home, beauty, electronics,
            and more. Local stock, bulk rates, and Dubai specials delivered
            across Ethiopia.
          </p>
          <div className="sabu-rise sabu-rise-delay-3 mt-10 flex flex-wrap gap-3">
            <Link
              href="/catalog"
              className="bg-sabu-cream px-5 py-3 text-sm font-medium text-sabu-ink transition hover:bg-white"
            >
              Start shopping
            </Link>
            <Link
              href="/catalog?bulk=1"
              className="border border-sabu-moss px-5 py-3 text-sm text-sabu-cream transition hover:border-sabu-mist"
            >
              Buy in bulk
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-sabu-paper px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs tracking-[0.24em] text-sabu-moss uppercase">
            Departments
          </p>
          <h2 className="mt-3 max-w-2xl font-[family-name:var(--font-syne)] text-3xl tracking-tight text-sabu-ink sm:text-4xl">
            Shop the whole aisle — not just one wardrobe.
          </h2>
          <p className="mt-4 max-w-xl text-sabu-moss">
            From kids and fashion to home living, kitchen, beauty, and
            Ethiopian traditional goods. New categories appear as Sabu grows.
          </p>
          <div className="mt-10 flex flex-wrap gap-2">
            {[
              { href: "/catalog?category=mens-fashion", label: "Men" },
              { href: "/catalog?category=womens-fashion", label: "Women" },
              { href: "/catalog?category=kids", label: "Kids" },
              { href: "/catalog?category=home-living", label: "Home" },
              { href: "/catalog?category=electronics", label: "Electronics" },
              {
                href: "/catalog?category=ethiopian-traditional",
                label: "Traditional",
              },
              { href: "/catalog", label: "All departments →" },
            ].map((item) => (
              <Link
                key={item.href + item.label}
                href={item.href}
                className="border border-sabu-mist px-3 py-2 text-sm text-sabu-ink transition hover:border-sabu-leaf hover:text-sabu-leaf"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section
        id="special-orders"
        className="bg-[linear-gradient(180deg,#f3f7f4_0%,#e8f5ee_100%)] px-6 py-24"
      >
        <div className="mx-auto max-w-6xl">
          <p className="text-xs tracking-[0.24em] text-sabu-moss uppercase">
            Beyond the shelf
          </p>
          <h2 className="mt-3 max-w-xl font-[family-name:var(--font-syne)] text-4xl tracking-tight text-sabu-ink sm:text-5xl">
            Can’t find it? We’ll source it.
          </h2>
          <p className="mt-4 max-w-lg text-sabu-moss">
            Special orders move through quotation, Dubai procurement, and
            international logistics — then local delivery in Ethiopia.
          </p>
          <Link
            href="/login"
            className="mt-8 inline-block border-b border-sabu-leaf pb-1 text-sm font-medium text-sabu-leaf transition hover:border-sabu-ink hover:text-sabu-ink"
          >
            Start with your phone number
          </Link>
        </div>
      </section>
    </main>
  );
}
