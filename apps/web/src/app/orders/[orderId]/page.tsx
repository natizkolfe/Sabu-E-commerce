"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useAuth } from "../../../context/auth-context";
import { formatEtb } from "../../../lib/money";

type OrderDetail = Awaited<ReturnType<typeof api.getOrder>>;

export default function OrderConfirmationPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const { ready, user, accessToken } = useAuth();
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  useEffect(() => {
    if (!accessToken || !params.orderId) return;
    api
      .getOrder(accessToken, params.orderId)
      .then(setDetail)
      .catch((err: Error) => setError(err.message));
  }, [accessToken, params.orderId]);

  if (error) {
    return (
      <main className="min-h-screen bg-sabu-paper px-6 pt-28">
        <p className="text-red-700">{error}</p>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="min-h-screen bg-sabu-paper px-6 pt-28">
        <p className="text-sabu-moss">Loading order…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-sabu-paper pt-28 pb-16">
      <div className="mx-auto max-w-3xl px-6">
        <p className="text-xs tracking-[0.24em] text-sabu-moss uppercase">
          Order placed
        </p>
        <h1 className="mt-3 font-[family-name:var(--font-syne)] text-4xl text-sabu-ink">
          {detail.orderNumber}
        </h1>
        <p className="mt-3 text-sabu-moss">
          Status: <span className="text-sabu-ink">{detail.status}</span> · Payment:{" "}
          <span className="text-sabu-ink">{detail.paymentStatus}</span>
        </p>

        <ul className="mt-10 space-y-3 border-t border-sabu-mist/50 pt-6 text-sm">
          {detail.items.map((item) => (
            <li key={item.lineNo} className="flex justify-between gap-4">
              <span className="text-sabu-moss">
                {item.name} × {item.quantity}
              </span>
              <span>{formatEtb(item.lineTotal)}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 space-y-2 text-sm">
          <div className="flex justify-between text-sabu-moss">
            <span>Subtotal</span>
            <span>{formatEtb(detail.subtotal)}</span>
          </div>
          <div className="flex justify-between text-sabu-moss">
            <span>Delivery</span>
            <span>{formatEtb(detail.deliveryFee)}</span>
          </div>
          <div className="flex justify-between text-lg text-sabu-ink">
            <span>Total</span>
            <span>{formatEtb(detail.grandTotal)}</span>
          </div>
        </div>

        <div className="mt-8 text-sm text-sabu-moss">
          <p className="text-sabu-ink">{detail.shipping.name}</p>
          <p>{detail.shipping.phone}</p>
          <p>{detail.shipping.address}</p>
        </div>

        <Link
          href="/catalog"
          className="mt-10 inline-block bg-sabu-leaf px-5 py-3 text-sm text-sabu-cream hover:bg-sabu-forest"
        >
          Continue shopping
        </Link>
      </div>
    </main>
  );
}
