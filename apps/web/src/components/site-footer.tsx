"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import {
  FacebookIcon,
  InstagramIcon,
  TikTokIcon,
  WhatsAppIcon,
} from "./social-icons";

const DEFAULT_PHONE = "+251911129726";
const DEFAULT_WA = "https://wa.me/251911129726";
const DEFAULT_IG = "https://www.instagram.com/sabusonlineshop/";
const DEFAULT_TT = "https://www.tiktok.com/@sabuonlineshope?lang=en";
const DEFAULT_FB = "https://facebook.com/sabu_placeholder";

export function SiteFooter() {
  const [phone, setPhone] = useState(DEFAULT_PHONE);
  const [whatsappUrl, setWhatsappUrl] = useState(DEFAULT_WA);
  const [instagramUrl, setInstagramUrl] = useState(DEFAULT_IG);
  const [tiktokUrl, setTiktokUrl] = useState(DEFAULT_TT);
  const [facebookUrl, setFacebookUrl] = useState(DEFAULT_FB);

  useEffect(() => {
    api
      .getAboutContent()
      .then((c) => {
        setPhone(c.phone || DEFAULT_PHONE);
        setWhatsappUrl(c.whatsappUrl || DEFAULT_WA);
        setInstagramUrl(c.instagramUrl || DEFAULT_IG);
        setTiktokUrl(c.tiktokUrl || DEFAULT_TT);
        setFacebookUrl(c.facebookUrl || DEFAULT_FB);
      })
      .catch(() => undefined);
  }, []);

  return (
    <footer className="border-t border-sabu-mist/30 bg-sabu-forest text-sabu-cream">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-[family-name:var(--font-syne)] text-2xl">
            Sabu Online Shopping
          </p>
          <p className="mt-2 max-w-sm text-sm text-sabu-mist">
            Everyday shopping for Ethiopia. Every aisle, one checkout,
            delivered to your door.
          </p>
          <p className="mt-4 text-sm">
            <a
              href={`tel:${phone.replace(/\s/g, "")}`}
              className="text-sabu-cream underline decoration-sabu-mist/50 underline-offset-4 hover:decoration-white"
            >
              {phone}
            </a>
          </p>
        </div>
        <div className="flex flex-col items-start gap-4 sm:items-end">
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-sabu-mist">
            <Link href="/about" className="hover:text-white">
              About Sabu
            </Link>
            <Link href="/catalog" className="hover:text-white">
              Shop
            </Link>
            <Link href="/orders/track" className="hover:text-white">
              Track order
            </Link>
            <Link href="/login" className="hover:text-white">
              Sign in
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sabu-mist">
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="WhatsApp"
              title="WhatsApp"
              className="inline-flex h-9 w-9 items-center justify-center transition hover:text-white"
            >
              <WhatsAppIcon className="h-5 w-5" />
            </a>
            <a
              href={instagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram"
              title="Instagram"
              className="inline-flex h-9 w-9 items-center justify-center transition hover:text-white"
            >
              <InstagramIcon className="h-5 w-5" />
            </a>
            <a
              href={tiktokUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="TikTok"
              title="TikTok"
              className="inline-flex h-9 w-9 items-center justify-center transition hover:text-white"
            >
              <TikTokIcon className="h-5 w-5" />
            </a>
            <a
              href={facebookUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Facebook"
              title="Facebook"
              className="inline-flex h-9 w-9 items-center justify-center transition hover:text-white"
            >
              <FacebookIcon className="h-5 w-5" />
            </a>
          </div>
          <p className="text-xs text-sabu-mist/80">
            © <span className="text-sabu-cream">Lulie Tech LLC</span>. All
            rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
