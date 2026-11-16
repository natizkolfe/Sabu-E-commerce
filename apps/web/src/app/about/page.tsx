"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type AboutContent = Awaited<ReturnType<typeof api.getAboutContent>>;

const FALLBACK: AboutContent = {
  headline: "About Sabu",
  intro:
    "Sabu Online Shopping brings everyday products to your door across Ethiopia — local stock, bulk rates, and special orders when you need something we do not carry yet.",
  phone: "+251911129726",
  whatsappUrl: "https://wa.me/251911129726",
  instagramUrl: "https://instagram.com/sabu_placeholder",
  tiktokUrl: "https://tiktok.com/@sabu_placeholder",
  facebookUrl: "https://facebook.com/sabu_placeholder",
  contactNote:
    "Questions or issues? Call or message us, or reach out on social media.",
  faqs: [],
};

export default function AboutPage() {
  const [content, setContent] = useState<AboutContent>(FALLBACK);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useEffect(() => {
    api
      .getAboutContent()
      .then(setContent)
      .catch(() => undefined);
  }, []);

  return (
    <main className="bg-sabu-paper text-sabu-ink">
      <section className="relative overflow-hidden bg-[linear-gradient(160deg,#07140f_0%,#0b1f17_55%,#123528_100%)] px-6 pb-16 pt-28 text-sabu-cream sm:pt-32">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 top-8 h-72 w-72 rounded-full bg-[#2f6b52]/25 blur-3xl"
        />
        <div className="relative mx-auto max-w-3xl">
          <p className="text-xs tracking-[0.28em] text-sabu-mist uppercase">
            Sabu Online Shopping
          </p>
          <h1 className="mt-3 font-[family-name:var(--font-syne)] text-4xl tracking-tight sm:text-5xl">
            {content.headline}
          </h1>
          <p className="mt-5 max-w-2xl text-base text-sabu-mist sm:text-lg">
            {content.intro}
          </p>
        </div>
      </section>

      <section className="px-6 py-14">
        <div className="mx-auto grid max-w-3xl gap-10">
          <div>
            <h2 className="font-[family-name:var(--font-syne)] text-2xl tracking-tight">
              Contact us
            </h2>
            <p className="mt-2 text-sm text-sabu-moss">{content.contactNote}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href={`tel:${content.phone.replace(/\s/g, "")}`}
                className="bg-sabu-forest px-4 py-2.5 text-sm text-sabu-cream transition hover:bg-sabu-leaf"
              >
                Call {content.phone}
              </a>
              <a
                href={content.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="border border-sabu-mist px-4 py-2.5 text-sm transition hover:border-sabu-leaf"
              >
                WhatsApp
              </a>
              <a
                href={content.instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="border border-sabu-mist px-4 py-2.5 text-sm transition hover:border-sabu-leaf"
              >
                Instagram
              </a>
              <a
                href={content.tiktokUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="border border-sabu-mist px-4 py-2.5 text-sm transition hover:border-sabu-leaf"
              >
                TikTok
              </a>
              <a
                href={content.facebookUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="border border-sabu-mist px-4 py-2.5 text-sm transition hover:border-sabu-leaf"
              >
                Facebook
              </a>
            </div>
          </div>

          <div>
            <h2 className="font-[family-name:var(--font-syne)] text-2xl tracking-tight">
              Customer questions
            </h2>
            <p className="mt-2 text-sm text-sabu-moss">
              Delivery fees, tracking, payments, and more — kept here so checkout
              stays simple.
            </p>
            <ul className="mt-6 divide-y divide-sabu-mist/50 border-y border-sabu-mist/50">
              {content.faqs.map((faq, i) => {
                const open = openFaq === i;
                return (
                  <li key={`${faq.question}-${i}`}>
                    <button
                      type="button"
                      className="flex w-full items-start justify-between gap-4 py-4 text-left"
                      aria-expanded={open}
                      onClick={() => setOpenFaq(open ? null : i)}
                    >
                      <span className="font-medium">{faq.question}</span>
                      <span className="text-sabu-moss" aria-hidden>
                        {open ? "−" : "+"}
                      </span>
                    </button>
                    {open && (
                      <p className="pb-4 text-sm leading-relaxed text-sabu-moss">
                        {faq.answer}
                      </p>
                    )}
                  </li>
                );
              })}
              {content.faqs.length === 0 && (
                <li className="py-6 text-sm text-sabu-moss">
                  FAQs will appear here once published.
                </li>
              )}
            </ul>
          </div>

          <div className="flex flex-wrap gap-3 text-sm">
            <Link
              href="/catalog"
              className="bg-sabu-leaf px-4 py-2.5 text-sabu-cream transition hover:bg-sabu-forest"
            >
              Start shopping
            </Link>
            <Link
              href="/orders/track"
              className="border border-sabu-mist px-4 py-2.5 transition hover:border-sabu-leaf"
            >
              Track an order
            </Link>
            <Link
              href="/special-orders"
              className="border border-sabu-mist px-4 py-2.5 transition hover:border-sabu-leaf"
            >
              Special Orders
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
