import Link from "next/link";
import { formatEtb } from "../lib/money";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "http://localhost:3001/v1";

const tones = [
  "from-[#1a4d3a] to-[#0b1f17]",
  "from-[#3d6b56] to-[#1a4d3a]",
  "from-[#2a5a45] to-[#123528]",
  "from-[#4a7a62] to-[#1f4032]",
];

type ProductCardProps = {
  slug: string;
  name: string;
  nameAm?: string | null;
  brand?: string | null;
  categoryName: string;
  fromPrice: number | null;
  compareAtPrice?: number | null;
  wholesaleFromPrice?: number | null;
  bulkPurchasingEnabled?: boolean;
  imageUrl?: string | null;
  index?: number;
};

export function ProductCard({
  slug,
  name,
  nameAm,
  brand,
  categoryName,
  fromPrice,
  compareAtPrice,
  wholesaleFromPrice,
  bulkPurchasingEnabled,
  imageUrl,
  index = 0,
}: ProductCardProps) {
  const tone = tones[index % tones.length];
  const src =
    imageUrl &&
    (imageUrl.startsWith("http")
      ? imageUrl
      : `${API_URL}${imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`}`);

  return (
    <Link href={`/catalog/${slug}`} className="group block">
      <div
        className={`relative aspect-[3/4] overflow-hidden rounded-xl bg-gradient-to-br ${tone}`}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={name}
            className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]"
          />
        ) : (
          <div
            className="absolute inset-0 opacity-25 transition duration-500 group-hover:opacity-40"
            style={{
              backgroundImage:
                "radial-gradient(circle at 30% 20%, rgba(232,245,238,0.35), transparent 45%)",
            }}
          />
        )}
        {bulkPurchasingEnabled && (
          <span className="absolute top-2 left-2 bg-sabu-cream/95 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-sabu-ink uppercase">
            Bulk
          </span>
        )}
        <p
          className={`absolute right-2 bottom-2 left-2 font-[family-name:var(--font-syne)] text-sm leading-snug sm:text-base ${
            src
              ? "rounded bg-black/45 px-1.5 py-1 text-white"
              : "text-sabu-cream"
          }`}
        >
          {name}
        </p>
      </div>
      <div className="mt-2 space-y-0.5">
        <p className="truncate text-[11px] tracking-wide text-sabu-moss uppercase">
          {brand ?? categoryName}
          {nameAm ? ` · ${nameAm}` : ""}
        </p>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium text-sabu-ink">
            {formatEtb(fromPrice)}
          </span>
          {compareAtPrice != null &&
            fromPrice != null &&
            compareAtPrice > fromPrice && (
              <span className="text-xs text-sabu-moss line-through">
                {formatEtb(compareAtPrice)}
              </span>
            )}
        </div>
        {bulkPurchasingEnabled && wholesaleFromPrice != null && (
          <p className="text-[11px] text-sabu-leaf">
            Bulk from {formatEtb(wholesaleFromPrice)}
          </p>
        )}
      </div>
    </Link>
  );
}
