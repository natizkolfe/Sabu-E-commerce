"use client";

import Link from "next/link";
import { useCart } from "../../context/cart-context";
import { formatEtb } from "../../lib/money";

export default function CartPage() {
  const { cart, updateItem, removeItem, isGuest } = useCart();
  const items = cart?.items ?? [];
  const hasBulk = items.some((i) => i.bulkEnabled);
  const wholesaleActive = items.some(
    (i) => i.bulkEnabled && i.quantity >= 10,
  );

  return (
    <main className="min-h-screen bg-sabu-paper pt-24 pb-12">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h1 className="font-[family-name:var(--font-syne)] text-3xl text-sabu-ink">
          Cart
        </h1>
        <p className="mt-2 text-sm text-sabu-moss">
          {isGuest
            ? "Shopping as guest — no account required."
            : "Prices are re-checked at checkout."}{" "}
          Delivery: ETB 150.
          {wholesaleActive
            ? " Wholesale tiers applied on qualifying lines."
            : hasBulk
              ? " Raise qty to 10+ on bulk items for wholesale rates."
              : ""}
        </p>

        {items.length === 0 ? (
          <div className="mt-10">
            <p className="text-sabu-moss">Your cart is empty.</p>
            <Link href="/catalog" className="mt-4 inline-block text-sabu-leaf underline">
              Browse catalog
            </Link>
          </div>
        ) : (
          <>
            <ul className="mt-6 divide-y divide-sabu-mist/50 border-t border-sabu-mist/50">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/catalog/${item.productSlug}`}
                      className="text-sm font-medium text-sabu-ink hover:underline"
                    >
                      {item.productName}
                    </Link>
                    <p className="text-xs text-sabu-moss">
                      {item.variantName} · {formatEtb(item.unitPrice)} each
                      {item.bulkEnabled && item.quantity >= 10
                        ? " · wholesale"
                        : item.bulkEnabled
                          ? " · bulk available"
                          : ""}
                    </p>
                    {item.bulkEnabled && (
                      <div className="mt-1.5 flex gap-1">
                        {[10, 50, 100].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => updateItem(item.id, n)}
                            className="border border-sabu-mist px-1.5 py-0.5 text-[10px] text-sabu-moss hover:border-sabu-leaf"
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={item.quantity}
                      onChange={(e) =>
                        updateItem(
                          item.id,
                          Math.max(1, Number(e.target.value) || 1),
                        )
                      }
                      className="w-14 border border-sabu-mist bg-transparent px-2 py-1.5 text-sm text-sabu-ink"
                    />
                    <span className="w-20 text-right text-sm text-sabu-ink">
                      {formatEtb(item.lineTotal)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="text-xs text-sabu-moss hover:text-sabu-ink"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-8 flex items-center justify-between border-t border-sabu-mist/50 pt-6">
              <p className="text-sabu-moss">Subtotal</p>
              <p className="text-xl font-medium text-sabu-ink">
                {formatEtb(cart?.subtotal ?? 0)}
              </p>
            </div>

            <Link
              href="/checkout"
              className="mt-8 inline-block w-full bg-sabu-leaf px-5 py-3 text-center text-sm text-sabu-cream hover:bg-sabu-forest sm:w-auto"
            >
              Checkout
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
