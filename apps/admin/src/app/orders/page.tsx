"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { formatLabel } from "../../lib/format";
import { loadSession } from "../../lib/session";

type OrderRow = Awaited<ReturnType<typeof adminApi.listOrders>>[number];
type OrderDetail = Awaited<ReturnType<typeof adminApi.getOrder>>;

export default function OrdersAdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [manualOnly, setManualOnly] = useState(false);
  const [nextStatus, setNextStatus] = useState("processing");
  const [contactChannel, setContactChannel] = useState("phone");
  const [contactOutcome, setContactOutcome] = useState("reached");
  const [contactNotes, setContactNotes] = useState("");
  const [clearManual, setClearManual] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (accessToken: string) => {
      const list = await adminApi.listOrders(accessToken, {
        q: q.trim() || undefined,
        status: status || undefined,
        paymentStatus: paymentStatus || undefined,
        requiresManualContact: manualOnly || undefined,
      });
      setOrders(list);
    },
    [q, status, paymentStatus, manualOnly],
  );

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
  }, []);

  useEffect(() => {
    if (!token) return;
    refresh(token).catch(() => setOrders([]));
  }, [token, refresh]);

  async function openOrder(id: string) {
    if (!token) return;
    setError(null);
    const d = await adminApi.getOrder(token, id);
    setDetail(d);
    setNextStatus(
      d.status === "confirmed"
        ? "processing"
        : d.status === "processing"
          ? "ready_for_dispatch"
          : "processing",
    );
  }

  async function updateStatus() {
    if (!token || !detail) return;
    setError(null);
    try {
      const next = await adminApi.updateOrderStatus(token, detail.id, {
        status: nextStatus,
      });
      setDetail(next as OrderDetail);
      setMessage(`Status → ${nextStatus}`);
      await refresh(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  async function recordContact() {
    if (!token || !detail) return;
    setError(null);
    try {
      const next = (await adminApi.recordContactAttempt(token, detail.id, {
        channel: contactChannel,
        outcome: contactOutcome,
        notes: contactNotes || undefined,
        clearManualFlag: clearManual,
      })) as OrderDetail;
      setDetail(next);
      setContactNotes("");
      setMessage("Contact attempt recorded");
      await refresh(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Contact log failed");
    }
  }

  async function resendNotification() {
    if (!token || !detail) return;
    setError(null);
    try {
      const res = await adminApi.resendOrderNotification(token, detail.id);
      setMessage(res.message);
      const next = await adminApi.getOrder(token, detail.id);
      setDetail(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Resend failed");
    }
  }

  if (!token) {
    return (
      <main className="min-h-screen bg-[#0f1412] px-6 py-16 text-[#eef2ef]">
        <p>Sign in from the home page first.</p>
        <Link href="/" className="mt-4 inline-block text-[#8aa897]">
          ← Admin home
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0f1412] px-4 py-10 text-[#eef2ef] sm:px-6">
      <div className="mx-auto max-w-6xl">
        <Link href="/" className="text-sm text-[#8aa897]">
          ← Admin
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl tracking-tight">Order management</h1>
            <p className="mt-1 text-sm text-[#9eb0a6]">
              Guest orders, communication prefs, notifications, and manual
              contact.
            </p>
          </div>
          <div className="flex gap-2 text-sm">
            <Link
              href="/payments"
              className="border border-[#24302a] px-3 py-2 text-[#b7c7be]"
            >
              Payments
            </Link>
            <Link
              href="/deliveries"
              className="border border-[#24302a] px-3 py-2 text-[#b7c7be]"
            >
              Dispatch
            </Link>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <section className="border border-[#24302a]">
            <div className="space-y-2 border-b border-[#24302a] p-3">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search order #, name, phone…"
                className="w-full bg-[#17201c] px-3 py-2 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="bg-[#17201c] px-2 py-1.5 text-xs"
                >
                  <option value="">All statuses</option>
                  <option value="pending_payment">Pending payment</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="processing">Processing</option>
                  <option value="ready_for_dispatch">Ready for dispatch</option>
                  <option value="dispatched">Dispatched</option>
                  <option value="delivered">Delivered</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <select
                  value={paymentStatus}
                  onChange={(e) => setPaymentStatus(e.target.value)}
                  className="bg-[#17201c] px-2 py-1.5 text-xs"
                >
                  <option value="">All payments</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="paid">Paid</option>
                  <option value="partially_paid">Partially paid</option>
                  <option value="pending_verification">
                    Pending verification
                  </option>
                </select>
                <label className="flex items-center gap-1.5 text-xs text-[#9eb0a6]">
                  <input
                    type="checkbox"
                    checked={manualOnly}
                    onChange={(e) => setManualOnly(e.target.checked)}
                  />
                  Needs manual contact
                </label>
              </div>
            </div>
            <ul className="max-h-[70vh] divide-y divide-[#24302a] overflow-y-auto">
              {orders.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => openOrder(o.id)}
                    className={`flex w-full justify-between gap-3 px-3 py-3 text-left text-sm ${
                      detail?.id === o.id
                        ? "bg-[#1a2922]"
                        : "hover:bg-[#141c18]"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{o.orderNumber}</span>
                      {o.requiresManualContact && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-300">
                          call
                        </span>
                      )}
                      <span className="mt-0.5 block truncate text-xs text-[#8aa897]">
                        {o.recipientName} · {o.recipientPhone}
                        {o.isGuest ? " · guest" : ""}
                        {o.preferredContactChannel
                          ? ` · ${o.preferredContactChannel}`
                          : ""}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-[#9eb0a6]">
                        {o.itemCount} items · {formatLabel(o.status)} /{" "}
                        {formatLabel(o.paymentStatus)}
                        {o.deliveryStatus
                          ? ` · delivery ${o.deliveryStatus}`
                          : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-[#b7c7be]">
                      {o.grandTotal} {o.currency}
                    </span>
                  </button>
                </li>
              ))}
              {orders.length === 0 && (
                <li className="px-3 py-6 text-sm text-[#8aa897]">
                  No orders match.
                </li>
              )}
            </ul>
          </section>

          <section className="border border-[#24302a] p-4">
            {!detail ? (
              <p className="text-[#8aa897]">
                Select an order to view items, payment, notifications, and
                contact history.
              </p>
            ) : (
              <div className="space-y-4 text-sm">
                <div>
                  <h2 className="text-xl">{detail.orderNumber}</h2>
                  <p className="text-xs text-[#8aa897]">
                    {formatLabel(detail.status)} · payment{" "}
                    {formatLabel(detail.paymentStatus)}
                    {detail.isGuest ? " · guest" : ""}
                    {detail.requiresManualContact
                      ? " · needs manual contact"
                      : ""}
                  </p>
                  <p className="mt-2 text-[#b7c7be]">
                    {detail.shipping.name} · {detail.shipping.phone}
                  </p>
                  <p className="text-[#b7c7be]">
                    {detail.shipping.formattedAddress ?? detail.shipping.address}
                  </p>
                  {detail.shipping.landmarkName && (
                    <p className="mt-1 text-xs text-[#9dcdb4]">
                      Landmark: {detail.shipping.landmarkName}
                      {detail.shipping.locationType
                        ? ` (${detail.shipping.locationType})`
                        : ""}
                    </p>
                  )}
                  {detail.shipping.deliveryInstructions && (
                    <p className="mt-1 text-xs text-[#b7c7be]">
                      Directions: {detail.shipping.deliveryInstructions}
                    </p>
                  )}
                  {detail.shipping.lat != null && detail.shipping.lng != null && (
                    <p className="mt-1 text-[11px] text-[#8aa897]">
                      Pin {detail.shipping.lat.toFixed(5)},{" "}
                      {detail.shipping.lng.toFixed(5)}
                      {detail.shipping.googleMapsUrl && (
                        <>
                          {" · "}
                          <a
                            href={detail.shipping.googleMapsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[#9dcdb4] underline"
                          >
                            Open in Google Maps
                          </a>
                        </>
                      )}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-[#b7c7be]">
                    Products {detail.subtotal} + Delivery {detail.deliveryFee}
                    {detail.deliveryDistanceKm != null
                      ? ` (${detail.deliveryDistanceKm} km × ${detail.deliveryFeeRate ?? "?"} ETB/km, ${detail.deliveryRouteSource ?? "—"})`
                      : ""}{" "}
                    = {detail.grandTotal} {detail.currency}
                  </p>
                  <p className="mt-1 text-xs text-[#8aa897]">
                    Preferred: {detail.preferredContactChannel ?? "—"}
                  </p>
                  {detail.customerNote && (
                    <p className="mt-1 text-xs text-[#8aa897]">
                      Note: {detail.customerNote}
                    </p>
                  )}
                </div>

                <ul className="space-y-1 border-t border-[#24302a] pt-3 text-xs text-[#b7c7be]">
                  {detail.items.map((i) => (
                    <li key={i.lineNo} className="flex justify-between gap-3">
                      <span>
                        {i.name} × {i.quantity}
                      </span>
                      <span>
                        {i.lineTotal} {detail.currency}
                      </span>
                    </li>
                  ))}
                  <li className="flex justify-between pt-2 text-sm text-white">
                    <span>Total</span>
                    <span>
                      {detail.grandTotal} {detail.currency}
                    </span>
                  </li>
                </ul>

                <div className="border-t border-[#24302a] pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-[#8aa897]">Notifications</p>
                    <button
                      type="button"
                      onClick={resendNotification}
                      className="text-xs text-[#9dcdb4] underline"
                    >
                      Resend confirmation
                    </button>
                  </div>
                  <ul className="mt-1 max-h-36 space-y-1 overflow-y-auto text-[11px] text-[#9eb0a6]">
                    {(detail.notifications ?? []).length === 0 && (
                      <li>No notification attempts yet</li>
                    )}
                    {(detail.notifications ?? []).map((n) => (
                      <li key={n.id}>
                        {formatLabel(n.eventCode)} · {formatLabel(n.channel)} ·{" "}
                        {formatLabel(n.status)} · {n.destinationMasked}
                        {n.lastError ? ` (${n.lastError})` : ""}
                        {n.whatsappDeepLink ? (
                          <>
                            {" · "}
                            <a
                              href={n.whatsappDeepLink}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[#9dcdb4] underline"
                            >
                              Open WhatsApp
                            </a>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="border-t border-[#24302a] pt-3">
                  <p className="text-xs text-[#8aa897]">Record phone / contact</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <select
                      value={contactChannel}
                      onChange={(e) => setContactChannel(e.target.value)}
                      className="bg-[#17201c] px-2 py-2 text-xs"
                    >
                      <option value="phone">phone</option>
                      <option value="sms">sms</option>
                      <option value="whatsapp">whatsapp</option>
                      <option value="telegram">telegram</option>
                      <option value="viber">viber</option>
                      <option value="email">email</option>
                      <option value="other">other</option>
                    </select>
                    <select
                      value={contactOutcome}
                      onChange={(e) => setContactOutcome(e.target.value)}
                      className="bg-[#17201c] px-2 py-2 text-xs"
                    >
                      <option value="reached">reached</option>
                      <option value="no_answer">no_answer</option>
                      <option value="voicemail">voicemail</option>
                      <option value="wrong_number">wrong_number</option>
                      <option value="callback_requested">
                        callback_requested
                      </option>
                      <option value="declined">declined</option>
                      <option value="other">other</option>
                    </select>
                  </div>
                  <input
                    value={contactNotes}
                    onChange={(e) => setContactNotes(e.target.value)}
                    placeholder="Notes (optional)"
                    className="mt-2 w-full bg-[#17201c] px-3 py-2 text-xs"
                  />
                  <label className="mt-2 flex items-center gap-2 text-xs text-[#9eb0a6]">
                    <input
                      type="checkbox"
                      checked={clearManual}
                      onChange={(e) => setClearManual(e.target.checked)}
                    />
                    Clear “needs manual contact” flag
                  </label>
                  <button
                    type="button"
                    onClick={recordContact}
                    className="mt-2 bg-[#2f6b4f] px-4 py-2 text-sm"
                  >
                    Save contact attempt
                  </button>
                  <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-[11px] text-[#9eb0a6]">
                    {(detail.contactAttempts ?? []).map((a) => (
                      <li key={a.id}>
                        {formatLabel(a.channel)} · {formatLabel(a.outcome)}
                        {a.attemptedByName ? ` · ${a.attemptedByName}` : ""}
                        {a.notes ? ` — ${a.notes}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="border-t border-[#24302a] pt-3">
                  <p className="text-xs text-[#8aa897]">Payments</p>
                  <ul className="mt-1 space-y-1 text-xs text-[#b7c7be]">
                    {detail.payments.length === 0 && <li>No payment intents</li>}
                    {detail.payments.map((p) => (
                      <li key={p.intentId}>
                        {formatLabel(p.methodCode ?? "method")} · intent{" "}
                        {formatLabel(p.intentStatus)} · tx{" "}
                        {formatLabel(p.transactionStatus)} · {p.amount}
                      </li>
                    ))}
                  </ul>
                  {detail.paymentStatus !== "paid" && (
                    <Link
                      href={`/payments?orderId=${encodeURIComponent(detail.id)}`}
                      className="mt-2 inline-block text-xs text-[#9dcdb4] underline"
                    >
                      Open payment verification
                    </Link>
                  )}
                </div>

                <div className="border-t border-[#24302a] pt-3">
                  <p className="text-xs text-[#8aa897]">Deliveries</p>
                  <ul className="mt-1 space-y-1 text-xs text-[#b7c7be]">
                    {detail.deliveries.length === 0 && (
                      <li>No delivery created yet</li>
                    )}
                    {detail.deliveries.map((d) => (
                      <li key={d.id}>
                        {d.deliveryNumber} · {formatLabel(d.status)}
                      </li>
                    ))}
                  </ul>
                  {detail.paymentStatus === "paid" && (
                    <Link
                      href={`/deliveries?orderId=${encodeURIComponent(detail.id)}`}
                      className="mt-2 inline-block text-xs text-[#9dcdb4] underline"
                    >
                      Open delivery dispatch
                    </Link>
                  )}
                </div>

                <div className="border-t border-[#24302a] pt-3">
                  <p className="text-xs text-[#8aa897]">Update status</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <select
                      value={nextStatus}
                      onChange={(e) => setNextStatus(e.target.value)}
                      className="bg-[#17201c] px-3 py-2 text-sm"
                    >
                      <option value="confirmed">Confirmed</option>
                      <option value="processing">Processing</option>
                      <option value="ready_for_dispatch">
                        Ready for dispatch
                      </option>
                      <option value="dispatched">Dispatched</option>
                      <option value="delivered">Delivered</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                    <button
                      type="button"
                      onClick={updateStatus}
                      className="bg-[#2f6b4f] px-4 py-2 text-sm"
                    >
                      Save status
                    </button>
                  </div>
                </div>

                <div className="border-t border-[#24302a] pt-3">
                  <p className="text-xs text-[#8aa897]">Status history</p>
                  <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-[11px] text-[#9eb0a6]">
                    {detail.history.map((h, i) => (
                      <li key={i}>
                        {formatLabel(h.fromStatus)} → {formatLabel(h.toStatus)}
                        {h.reason ? ` (${formatLabel(h.reason)})` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {message && (
              <p className="mt-4 text-sm text-[#2f6b4f]">{message}</p>
            )}
            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
          </section>
        </div>
      </div>
    </main>
  );
}
