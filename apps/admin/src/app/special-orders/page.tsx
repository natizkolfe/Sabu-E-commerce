"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { formatLabel } from "../../lib/format";
import { loadSession } from "../../lib/session";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "http://localhost:3001/v1";

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "submitted", label: "Request Received" },
  { value: "under_review", label: "Under Review" },
  { value: "searching_for_product", label: "Searching for Product" },
  { value: "product_found", label: "Product Found" },
  { value: "quotation_sent", label: "Quotation Sent" },
  { value: "awaiting_customer_confirmation", label: "Awaiting Customer Confirmation" },
  { value: "awaiting_payment", label: "Awaiting Payment" },
  { value: "payment_verification_pending", label: "Payment Verification Pending" },
  { value: "payment_confirmed", label: "Payment Confirmed" },
  { value: "purchased", label: "Purchased" },
  { value: "shipped", label: "Shipped" },
  { value: "arrived_in_ethiopia", label: "Arrived in Ethiopia" },
  { value: "ready_for_delivery", label: "Ready for Delivery" },
  { value: "delivered", label: "Delivered" },
  { value: "product_unavailable", label: "Product Unavailable" },
  { value: "cancelled", label: "Cancelled" },
];

type SpecialOrderDetail = Awaited<
  ReturnType<typeof adminApi.getSpecialOrder>
>;

export default function SpecialOrdersPage() {
  const [token, setToken] = useState<string | null>(null);
  const [orders, setOrders] = useState<
    Awaited<ReturnType<typeof adminApi.listSpecialOrders>>
  >([]);
  const [partners, setPartners] = useState<
    Awaited<ReturnType<typeof adminApi.listPartners>>
  >([]);
  const [selectedPartner, setSelectedPartner] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SpecialOrderDetail | null>(null);
  const [statusDraft, setStatusDraft] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshList = useCallback(async (accessToken: string) => {
    setOrders(await adminApi.listSpecialOrders(accessToken));
  }, []);

  const loadDetail = useCallback(async (accessToken: string, id: string) => {
    const d = await adminApi.getSpecialOrder(accessToken, id);
    setDetail(d);
    setStatusDraft(d.status);
    setSelectedId(id);
  }, []);

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    Promise.all([
      adminApi.listSpecialOrders(s.accessToken),
      adminApi.listPartners(s.accessToken),
    ])
      .then(([o, p]) => {
        setOrders(o);
        setPartners(p);
        setSelectedPartner(p[0]?.id ?? "");
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "Load failed"),
      );
  }, []);

  async function assign(requestId: string) {
    if (!token || !selectedPartner) return;
    setError(null);
    setMessage(null);
    try {
      const res = await adminApi.assignSpecialOrderPartner(
        token,
        requestId,
        selectedPartner,
      );
      setMessage((res as { message?: string }).message ?? "Assigned");
      await refreshList(token);
      if (selectedId === requestId) await loadDetail(token, requestId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Assign failed");
    }
  }

  async function openDetail(id: string) {
    if (!token) return;
    setError(null);
    setMessage(null);
    try {
      await loadDetail(token, id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load request");
    }
  }

  async function saveStatus() {
    if (!token || !selectedId || !statusDraft) return;
    setError(null);
    setMessage(null);
    try {
      await adminApi.updateSpecialOrderStatus(token, selectedId, {
        status: statusDraft,
        note: statusNote.trim() || undefined,
      });
      setStatusNote("");
      setMessage("Status updated");
      await refreshList(token);
      await loadDetail(token, selectedId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Status update failed");
    }
  }

  async function copyDetails() {
    if (!detail?.copyText) return;
    try {
      await navigator.clipboard.writeText(detail.copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (!token) {
    return (
      <main className="min-h-screen bg-[#0f1412] px-6 py-16 text-[#eef2ef]">
        <Link href="/?modules=1" className="text-[#8aa897]">
          ← Admin
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0f1412] px-4 py-10 text-[#eef2ef] sm:px-6">
      <div className="mx-auto max-w-6xl">
        <Link href="/?modules=1" className="text-sm text-[#8aa897]">
          ← Admin
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl tracking-tight">Special Orders</h1>
            <p className="mt-1 text-sm text-[#9eb0a6]">
              Guest international requests (Dubai / China / USA). Review,
              forward to partners, update status, and share details.
            </p>
          </div>
          <Link
            href="/receipts"
            className="border border-[#24302a] px-3 py-1.5 text-xs text-[#9dcdb4]"
          >
            View receipts →
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[#8aa897]">Assign to partner:</span>
          <select
            value={selectedPartner}
            onChange={(e) => setSelectedPartner(e.target.value)}
            className="bg-[#17201c] px-3 py-2"
          >
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.countryCode} — {p.name}
              </option>
            ))}
          </select>
          <Link href="/partners" className="text-[#9dcdb4] underline">
            Manage partners
          </Link>
        </div>

        {message && <p className="mt-3 text-sm text-[#2f6b4f]">{message}</p>}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <ul className="divide-y divide-[#24302a] border-t border-[#24302a]">
            {orders.length === 0 && (
              <li className="py-6 text-[#8aa897]">No special orders yet.</li>
            )}
            {orders.map((o) => (
              <li
                key={o.id}
                className={`flex flex-wrap items-start justify-between gap-3 py-4 text-sm ${
                  selectedId === o.id ? "bg-[#17201c]/40" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => openDetail(o.id)}
                  className="text-left"
                >
                  <p className="font-medium">
                    {o.requestNumber} · {o.productName}
                  </p>
                  <p className="text-xs text-[#9eb0a6]">
                    {o.sourcingRegionName} ({o.sourcingRegion}) ·{" "}
                    {o.statusLabel || formatLabel(o.status)} · qty {o.quantity}{" "}
                    · {o.imageCount} image(s)
                  </p>
                  <p className="text-xs text-[#8aa897]">
                    {o.guestName} · {o.guestPhone}
                    {o.preferredContactChannel
                      ? ` · ${formatLabel(o.preferredContactChannel)}`
                      : ""}
                  </p>
                  <p className="mt-1 text-[11px] text-[#6f857a]">
                    {new Date(o.createdAt).toLocaleString()}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => assign(o.id)}
                  className="bg-[#2f6b4f] px-3 py-2 text-xs"
                >
                  Send to partner
                </button>
              </li>
            ))}
          </ul>

          <aside className="border border-[#24302a] bg-[#121916] p-4 text-sm">
            {!detail ? (
              <p className="text-[#8aa897]">
                Select a request to review details, update status, and copy
                supplier-ready text.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs tracking-wide text-[#8aa897] uppercase">
                      {detail.requestNumber}
                    </p>
                    <h2 className="mt-1 text-xl">{detail.productName}</h2>
                    <p className="mt-1 text-[#9eb0a6]">
                      {detail.statusLabel} · {detail.sourcingRegionName}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={copyDetails}
                    className="border border-[#9dcdb4] px-3 py-2 text-xs text-[#9dcdb4]"
                  >
                    {copied ? "Copied" : "Copy Request Details"}
                  </button>
                </div>

                <dl className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-[#8aa897]">Customer</dt>
                    <dd>{detail.guestName}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[#8aa897]">Phone</dt>
                    <dd>{detail.guestPhone ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[#8aa897]">Preferred contact</dt>
                    <dd>
                      {detail.preferredContactChannel
                        ? formatLabel(detail.preferredContactChannel)
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[#8aa897]">Quantity</dt>
                    <dd>{detail.quantity}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-[#8aa897]">Description</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-[#c9d6ce]">
                      {detail.description ?? "—"}
                    </dd>
                  </div>
                  {detail.customerInstructions && (
                    <div className="sm:col-span-2">
                      <dt className="text-xs text-[#8aa897]">
                        Additional instructions
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap text-[#c9d6ce]">
                        {detail.customerInstructions}
                      </dd>
                    </div>
                  )}
                  {detail.productUrl && (
                    <div className="sm:col-span-2">
                      <dt className="text-xs text-[#8aa897]">Website link</dt>
                      <dd className="mt-1 break-all">
                        <a
                          href={detail.productUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#9dcdb4] underline"
                        >
                          {detail.productUrl}
                        </a>
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-[#8aa897]">Submitted</dt>
                    <dd>{new Date(detail.createdAt).toLocaleString()}</dd>
                  </div>
                </dl>

                {detail.images.length > 0 && (
                  <div>
                    <p className="text-xs text-[#8aa897]">Product images</p>
                    <div className="mt-2 flex flex-wrap gap-3">
                      {detail.images.map((img) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <a
                          key={img.id}
                          href={`${API_URL}${img.url}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <img
                            src={`${API_URL}${img.url}`}
                            alt="Reference"
                            className="h-24 w-24 object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2 border-t border-[#24302a] pt-4">
                  <p className="text-xs text-[#8aa897]">Update status</p>
                  <select
                    value={statusDraft}
                    onChange={(e) => setStatusDraft(e.target.value)}
                    className="w-full bg-[#17201c] px-3 py-2"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={statusNote}
                    onChange={(e) => setStatusNote(e.target.value)}
                    placeholder="Optional note for history"
                    className="w-full bg-[#17201c] px-3 py-2"
                  />
                  <button
                    type="button"
                    onClick={saveStatus}
                    className="bg-[#2f6b4f] px-3 py-2 text-xs"
                  >
                    Save status
                  </button>
                </div>

                <div className="border-t border-[#24302a] pt-4">
                  <p className="text-xs text-[#8aa897]">Request history</p>
                  <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto">
                    {detail.history.length === 0 && (
                      <li className="text-[#6f857a]">No history yet.</li>
                    )}
                    {detail.history.map((h) => (
                      <li key={h.id} className="text-xs text-[#9eb0a6]">
                        <span className="text-[#eef2ef]">{h.toStatusLabel}</span>
                        {h.note ? ` — ${h.note}` : ""}
                        <span className="block text-[10px] text-[#6f857a]">
                          {new Date(h.changedAt).toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
