import Link from "next/link";
import { formatEtb } from "../lib/money";

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
  index = 0,
}: ProductCardProps) {
  const tone = tones[index % tones.length];

  return (
    <Link href={`/catalog/${slug}`} className="group block">
      <div
        className={`relative aspect-[4/5] overflow-hidden bg-gradient-to-br ${tone}`}
      >
        <div className="absolute inset-0 opacity-30 transition duration-500 group-hover:opacity-45"
          style={{
            backgroundImage:
              "radial-gradient(circle at 30% 20%, rgba(232,245,238,0.35), transparent 45%)",
          }}
        />
        <p className="absolute bottom-4 left-4 right-4 font-[family-name:var(--font-syne)] text-2xl leading-tight text-sabu-cream">
          {name}
        </p>
      </div>
      <div className="mt-3">
        <p className="text-xs tracking-wide text-sabu-moss uppercase">
          {brand ?? categoryName}
        </p>
        {nameAm && <p className="mt-1 text-sm text-sabu-moss">{nameAm}</p>}
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-base font-medium text-sabu-ink">
            {formatEtb(fromPrice)}
          </span>
          {compareAtPrice != null && fromPrice != null && compareAtPrice > fromPrice && (
            <span className="text-sm text-sabu-moss line-through">
              {formatEtb(compareAtPrice)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
