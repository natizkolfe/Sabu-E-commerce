"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adminApi, ApiError, type DeliveryAdminDetail } from "../../lib/api";
import { loadSession } from "../../lib/session";

type QueueItem = Awaited<ReturnType<typeof adminApi.deliveryQueue>>[number];
type Driver = Awaited<ReturnType<typeof adminApi.deliveryDrivers>>[number];

function splitCustomerName(fullName: string | null | undefined) {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "—", lastName: "—" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "—" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

/** Short driver-facing paste: order #, name, item count, address, map. */
function formatDeliverySummary(d: DeliveryAdminDetail): string {
  const { firstName, lastName } = splitCustomerName(d.recipientName);
  const itemCount = d.items.reduce((sum, i) => sum + (i.quantity || 0), 0);
  return [
    `Order Number: ${d.orderNumber}`,
    `First Name: ${firstName}`,
    `Last Name: ${lastName}`,
    `Phone: ${d.recipientPhone || "—"}`,
    `Number of Items: ${itemCount || d.packageCount || 0}`,
    `Address: ${d.address || "—"}`,
    `Google Maps: ${d.googleMapsUrl || "—"}`,
    `Delivery Notes: ${d.deliveryInstructions?.trim() || "—"}`,
  ].join("\n");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function DeliveriesAdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DeliveryAdminDetail | null>(null);
  const [driverId, setDriverId] = useState("");
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoOpenRef = useRef<string | null>(null);

  const selectedDriver = useMemo(
    () => drivers.find((d) => d.id === driverId) ?? null,
    [drivers, driverId],
  );

  const refresh = useCallback(async (accessToken: string) => {
    // Include all active drivers so reassignment can pick someone currently on_delivery
    const [q, d] = await Promise.all([
      adminApi.deliveryQueue(accessToken),
      adminApi.deliveryDrivers(accessToken, true),
    ]);
    const active = d.filter((x) => x.status === "active");
    setQueue(q);
    setDrivers(active);
    setDriverId((prev) => {
      if (prev && active.some((x) => x.id === prev)) return prev;
      const preferred =
        active.find((x) => x.availability === "available") ?? active[0];
      return preferred?.id || "";
    });
  }, []);

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    refresh(s.accessToken).catch(() => undefined);
    const t = setInterval(() => {
      refresh(s.accessToken).catch(() => undefined);
    }, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  async function ensureDelivery(orderId: string, deliveryId: string | null) {
    if (!token) return;
    setBusy(true);
    setError(null);
    setPortalUrl(null);
    try {
      let id = deliveryId;
      if (!id) {
        const created = await adminApi.createDelivery(token, orderId);
        id = created.id;
        setMessage(`Created ${created.deliveryNumber}`);
      }
      const d = await adminApi.getDelivery(token, id!);
      setDetail(d);
      setSelectedOrderId(orderId);
      if (d.assignedDriver?.id) {
        setDriverId(d.assignedDriver.id);
      }
      await refresh(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  // Deep-link from dashboard: /deliveries?orderId=...
  useEffect(() => {
    if (!token || busy) return;
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get("orderId");
    if (!orderId || autoOpenRef.current === orderId) return;
    if (queue.length === 0) return;

    const match = queue.find((o) => o.orderId === orderId);
    autoOpenRef.current = orderId;
    if (!match) {
      setSelectedOrderId(orderId);
      setError(
        "That order is not ready for dispatch yet (needs paid + approved + QA passed).",
      );
      return;
    }
    setSelectedOrderId(match.orderId);
    setMessage(`Opening ${match.orderNumber} for driver assignment…`);
    ensureDelivery(match.orderId, match.deliveryId)
      .then(() => {
        requestAnimationFrame(() => {
          document
            .getElementById(`dispatch-${match.orderId}`)
            ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, queue, busy]);

  async function assignDriver() {
    if (!token || !detail || !driverId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.assignDriver(token, detail.id, driverId);
      setPortalUrl(res.dashboardUrl);
      setMessage(
        res.reassigned
          ? `Reassigned to ${res.driverName ?? "driver"}. Delivery status: assigned.`
          : `Assigned to ${res.driverName ?? "driver"}. Delivery status: assigned.`,
      );
      const d = await adminApi.getDelivery(token, detail.id);
      setDetail(d);
      await refresh(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Assign failed");
    } finally {
      setBusy(false);
    }
  }

  async function reissue() {
    if (!token || !detail) return;
    try {
      const res = await adminApi.reissueVerification(token, detail.id);
      setMessage(`Reissued PIN ${res.pin} · QR ${res.qrToken.slice(0, 8)}…`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reissue failed");
    }
  }

  async function onCopyDetails() {
    if (!detail) return;
    const ok = await copyText(formatDeliverySummary(detail));
    setMessage(ok ? "Delivery details copied to clipboard" : "Copy failed");
  }

  async function onCopyMaps() {
    if (!detail?.googleMapsUrl) {
      setError("No Google Maps link for this delivery");
      return;
    }
    const ok = await copyText(detail.googleMapsUrl);
    setMessage(ok ? "Google Maps link copied" : "Copy failed");
  }

  async function onCopyPhone() {
    if (!detail?.recipientPhone) {
      setError("No customer phone on this delivery");
      return;
    }
    const ok = await copyText(detail.recipientPhone);
    setMessage(ok ? "Customer phone copied" : "Copy failed");
  }

  async function onCopyPortal() {
    if (!portalUrl) {
      setError("Assign a driver first to generate the verification portal link");
      return;
    }
    const ok = await copyText(portalUrl);
    setMessage(ok ? "Driver verification portal link copied" : "Copy failed");
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

  const isAssigned = Boolean(
    detail?.assignedDriver &&
      ["accepted", "offered"].includes(
        detail.assignedDriver.assignmentStatus ?? "",
      ),
  );

  return (
    <main className="min-h-screen bg-[#0f1412] px-4 py-10 text-[#eef2ef] sm:px-6">
      <div className="mx-auto max-w-6xl">
        <Link href="/" className="text-sm text-[#8aa897]">
          ← Admin
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl tracking-tight">Delivery dispatch</h1>
            <p className="mt-1 text-sm text-[#9eb0a6]">
              Call drivers on their registered phone, assign manually, then copy
              delivery details to share. Auto-refreshes every 8s.
            </p>
          </div>
          <Link
            href="/drivers"
            className="border border-[#24302a] px-3 py-2 text-sm text-[#b7c7be]"
          >
            Manage drivers →
          </Link>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="border border-[#24302a]">
            <div className="border-b border-[#24302a] px-3 py-2 text-sm text-[#8aa897]">
              Dispatch queue
            </div>
            <ul className="max-h-[70vh] divide-y divide-[#24302a] overflow-y-auto">
              {queue.map((o) => {
                const selected = selectedOrderId === o.orderId;
                return (
                  <li
                    key={o.orderId}
                    id={`dispatch-${o.orderId}`}
                    className={`px-3 py-3 text-sm ${
                      selected
                        ? "bg-[#14201a] ring-1 ring-inset ring-[#2f6b4f]"
                        : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {o.orderNumber}
                          {selected && (
                            <span className="ml-2 text-[10px] font-normal text-[#2f6b4f]">
                              selected
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-[#8aa897]">
                          {o.recipientName} · {o.address}
                        </p>
                        <p className="mt-1 text-xs text-[#b7c7be]">
                          {o.itemCount} items · {o.orderStatus} /{" "}
                          {o.deliveryStatus ?? "no delivery"}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          ensureDelivery(o.orderId, o.deliveryId)
                        }
                        className="bg-[#2f6b4f] px-3 py-1.5 text-xs disabled:opacity-60"
                      >
                        {o.deliveryId ? "Open" : "Create delivery"}
                      </button>
                    </div>
                  </li>
                );
              })}
              {queue.length === 0 && (
                <li className="px-3 py-6 text-sm text-[#8aa897]">
                  No paid local-delivery orders waiting.
                </li>
              )}
            </ul>
          </section>

          <section className="border border-[#24302a] p-4">
            {!detail ? (
              <p className="text-[#8aa897]">
                Select an order to review delivery details and assign a driver.
              </p>
            ) : (
              <div className="space-y-5 text-sm">
                <div>
                  <h2 className="text-xl">Delivery Details</h2>
                  <p className="text-xs text-[#8aa897]">
                    {detail.deliveryNumber} · order {detail.orderNumber} ·{" "}
                    {detail.status}
                  </p>
                </div>

                <div className="space-y-1 border-t border-[#24302a] pt-3">
                  <p className="text-xs text-[#8aa897]">Customer information</p>
                  <p className="text-[#eef2ef]">{detail.recipientName}</p>
                  <p className="text-[#b7c7be]">{detail.recipientPhone || "—"}</p>
                  <p className="text-xs text-[#8aa897]">
                    Preferred: {detail.preferredContactChannel ?? "—"}
                  </p>
                </div>

                <div className="space-y-1 border-t border-[#24302a] pt-3">
                  <p className="text-xs text-[#8aa897]">Delivery information</p>
                  <p className="text-[#b7c7be]">
                    Service:{" "}
                    <span className="text-[#eef2ef]">
                      {detail.serviceType ?? "Standard"}
                    </span>
                  </p>
                  <p className="text-[#b7c7be]">{detail.address}</p>
                  <p className="text-xs text-[#8aa897]">
                    Landmark: {detail.landmarkName || "—"}
                  </p>
                  {detail.deliveryInstructions && (
                    <p className="text-xs text-amber-200/80">
                      Instructions: {detail.deliveryInstructions}
                    </p>
                  )}
                  <p className="text-xs text-[#8aa897]">
                    Pickup: {detail.warehouseName} ·{" "}
                    {detail.distanceKm != null
                      ? `${detail.distanceKm} km`
                      : "distance n/a"}{" "}
                    · ETA {detail.etaMinutes ?? "—"} min · {detail.packageCount}{" "}
                    packages
                  </p>
                  {detail.googleMapsUrl && (
                    <a
                      href={detail.googleMapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-xs text-[#9dcdb4] underline"
                    >
                      Open Google Maps navigation
                    </a>
                  )}
                </div>

                <div className="border-t border-[#24302a] pt-3">
                  <p className="text-xs text-[#8aa897]">Order items</p>
                  <ul className="mt-1 space-y-1 text-xs text-[#b7c7be]">
                    {detail.items.map((i, idx) => (
                      <li key={idx}>
                        {i.name} × {i.quantity}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="border-t border-[#24302a] pt-3">
                  <p className="text-xs text-[#8aa897]">Copy and sharing</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={onCopyDetails}
                      className="bg-[#2f6b4f] px-3 py-2 text-xs"
                    >
                      Copy Delivery Details
                    </button>
                    <button
                      type="button"
                      onClick={onCopyMaps}
                      className="border border-[#24302a] px-3 py-2 text-xs"
                    >
                      Copy Google Maps Link
                    </button>
                    <button
                      type="button"
                      onClick={onCopyPhone}
                      className="border border-[#24302a] px-3 py-2 text-xs"
                    >
                      Copy Customer Phone Number
                    </button>
                    {portalUrl && (
                      <button
                        type="button"
                        onClick={onCopyPortal}
                        className="border border-[#24302a] px-3 py-2 text-xs"
                      >
                        Copy Driver Portal Link
                      </button>
                    )}
                  </div>
                  <pre className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap bg-[#121916] p-3 text-[11px] leading-relaxed text-[#b7c7be]">
                    {formatDeliverySummary(detail)}
                  </pre>
                </div>

                <div className="border-t border-[#24302a] pt-3">
                  <p className="text-xs text-[#8aa897]">Driver assignment</p>
                  {detail.assignedDriver && (
                    <p className="mt-1 text-xs text-[#b7c7be]">
                      Current: {detail.assignedDriver.name} ·{" "}
                      {detail.assignedDriver.phone || "no phone"} ·{" "}
                      {detail.assignedDriver.assignmentStatus}
                    </p>
                  )}
                  <select
                    value={driverId}
                    onChange={(e) => setDriverId(e.target.value)}
                    className="mt-2 w-full bg-[#17201c] px-3 py-2 text-sm"
                  >
                    {drivers.length === 0 && (
                      <option value="">No available drivers</option>
                    )}
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} · {d.phone || "no phone"} ·{" "}
                        {d.zoneName || "no zone"} · {d.availability} · load{" "}
                        {d.activeDeliveries}
                      </option>
                    ))}
                  </select>
                  {selectedDriver && (
                    <p className="mt-2 text-xs text-[#eef2ef]">
                      Contact driver at{" "}
                      <span className="font-mono">
                        {selectedDriver.phone || "—"}
                      </span>{" "}
                      (call from your phone — not in-app)
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy || !driverId}
                      onClick={assignDriver}
                      className="bg-[#2f6b4f] px-4 py-2 text-sm disabled:opacity-60"
                    >
                      {isAssigned ? "Reassign Driver" : "Assign Driver"}
                    </button>
                    <button
                      type="button"
                      onClick={reissue}
                      className="border border-[#24302a] px-3 py-2 text-sm"
                    >
                      Reissue QR/PIN
                    </button>
                  </div>
                </div>

                {(detail.assignments?.length ?? detail.offers?.length ?? 0) >
                  0 && (
                  <div className="border-t border-[#24302a] pt-3">
                    <p className="text-xs text-[#8aa897]">Assignment history</p>
                    <ul className="mt-2 space-y-1 text-xs">
                      {(detail.assignments ?? detail.offers ?? []).map((o) => (
                        <li key={o.id} className="text-[#b7c7be]">
                          {o.driverName} · {o.status}
                          {"assignedByName" in o && o.assignedByName
                            ? ` · by ${o.assignedByName}`
                            : ""}
                          {o.respondedAt
                            ? ` · ${new Date(o.respondedAt).toLocaleString()}`
                            : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
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
