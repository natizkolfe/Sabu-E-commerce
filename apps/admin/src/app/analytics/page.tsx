"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { formatLabel } from "../../lib/format";
import { clearSession, loadSession } from "../../lib/session";

type Dash = Awaited<ReturnType<typeof adminApi.analyticsDashboard>>;
type OrderRow = Dash["orders"]["items"][number];
type Detail = Awaited<ReturnType<typeof adminApi.getOrder>>;

type Filters = {
  dateFrom?: string;
  dateTo?: string;
  paymentStatus?: string;
  approvalStatus?: string;
  qaStatus?: string;
  deliveryStatus?: string;
  contactStatus?: string;
  orderType?: string;
  fulfillmentType?: string;
  q?: string;
  attention?: string;
  page: number;
  pageSize: number;
  sort: string;
  sortDir: "asc" | "desc";
  amountMin?: string;
  amountMax?: string;
};

const PRESET_KEY = "sabu_dashboard_filter_presets";

const KPI_DEFS: Array<{
  key: keyof Dash["kpis"];
  label: string;
  attention?: string;
  money?: boolean;
}> = [
  { key: "totalOrders", label: "Total Orders" },
  { key: "newOrders", label: "New Orders", attention: "new_today" },
  {
    key: "pendingPaymentVerification",
    label: "Pending Payment Verification",
    attention: "pending_payment",
  },
  {
    key: "pendingAdminApproval",
    label: "Pending Admin Approval",
    attention: "pending_approval",
  },
  {
    key: "pendingQaReview",
    label: "Pending QA Review",
    attention: "pending_qa",
  },
  {
    key: "customerContactRequired",
    label: "Customer Contact Required",
    attention: "contact_required",
  },
  { key: "confirmedOrders", label: "Confirmed Orders", attention: "confirmed" },
  {
    key: "readyForDriverAssignment",
    label: "Ready for Driver Assignment",
    attention: "ready_assignment",
  },
  {
    key: "outForDelivery",
    label: "Out for Delivery",
    attention: "out_for_delivery",
  },
  { key: "completedOrders", label: "Completed Orders", attention: "completed" },
  { key: "cancelledOrders", label: "Cancelled Orders", attention: "cancelled" },
  { key: "confirmedRevenue", label: "Total Revenue (paid)", money: true },
];

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.toISOString();
}

function quickRange(
  key: string,
): Pick<Filters, "dateFrom" | "dateTo"> | null {
  const now = new Date();
  if (key === "today")
    return { dateFrom: startOfDay(now), dateTo: endOfDay(now) };
  if (key === "yesterday") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return { dateFrom: startOfDay(y), dateTo: endOfDay(y) };
  }
  if (key === "7d") {
    const from = new Date(now);
    from.setDate(from.getDate() - 6);
    return { dateFrom: startOfDay(from), dateTo: endOfDay(now) };
  }
  if (key === "30d") {
    const from = new Date(now);
    from.setDate(from.getDate() - 29);
    return { dateFrom: startOfDay(from), dateTo: endOfDay(now) };
  }
  if (key === "month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { dateFrom: startOfDay(from), dateTo: endOfDay(now) };
  }
  return null;
}

const defaultFilters = (): Filters => ({
  ...quickRange("30d")!,
  page: 1,
  pageSize: 25,
  sort: "placedAt",
  sortDir: "desc",
});

export default function AnalyticsDashboardPage() {
  const [token, setToken] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [actionNotes, setActionNotes] = useState("");
  const [presetName, setPresetName] = useState("");
  const [presets, setPresets] = useState<
    Array<{ name: string; filters: Filters }>
  >([]);
  const [quick, setQuick] = useState("30d");

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    try {
      const raw = localStorage.getItem(PRESET_KEY);
      if (raw) setPresets(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await adminApi.analyticsDashboard(token, {
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        paymentStatus: filters.paymentStatus,
        approvalStatus: filters.approvalStatus,
        qaStatus: filters.qaStatus,
        deliveryStatus: filters.deliveryStatus,
        contactStatus: filters.contactStatus,
        orderType: filters.orderType,
        fulfillmentType: filters.fulfillmentType,
        q: filters.q,
        attention: filters.attention,
        page: filters.page,
        pageSize: filters.pageSize,
        sort: filters.sort,
        sortDir: filters.sortDir,
        amountMin: filters.amountMin,
        amountMax: filters.amountMax,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load dashboard");
    }
  }, [token, filters]);

  useEffect(() => {
    load().catch(() => undefined);
    const t = setInterval(() => load().catch(() => undefined), 15000);
    return () => clearInterval(t);
  }, [load]);

  async function openOrder(id: string) {
    if (!token) return;
    setSelectedId(id);
    setActionNotes("");
    try {
      setDetail(await adminApi.getOrder(token, id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load order");
    }
  }

  function patchFilters(patch: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  }

  function applyQuick(key: string) {
    setQuick(key);
    const range = quickRange(key);
    if (range) patchFilters(range);
  }

  function savePreset() {
    if (!presetName.trim()) return;
    const next = [
      ...presets.filter((p) => p.name !== presetName.trim()),
      { name: presetName.trim(), filters },
    ];
    setPresets(next);
    localStorage.setItem(PRESET_KEY, JSON.stringify(next));
    setMessage(`Saved filter preset “${presetName.trim()}”`);
    setPresetName("");
  }

  async function runAction(
    label: string,
    fn: () => Promise<unknown>,
  ) {
    if (!token || !selectedId) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      setMessage(label);
      setDetail(await adminApi.getOrder(token, selectedId));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const chartDays = useMemo(() => {
    if (!data) return [];
    const byDay = new Map(
      data.charts.dailySales.map((d) => [
        new Date(d.day).toISOString().slice(0, 10),
        d,
      ]),
    );
    const from = filters.dateFrom ? new Date(filters.dateFrom) : null;
    const to = filters.dateTo ? new Date(filters.dateTo) : null;
    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return data.charts.dailySales;
    }
    const days: Array<{
      day: string;
      orderCount: number;
      gmv: number;
      paidGmv: number;
    }> = [];
    const cursor = new Date(from);
    cursor.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(0, 0, 0, 0);
    // Cap padded range so the chart stays readable
    const maxPad = 62;
    let n = 0;
    while (cursor <= end && n < maxPad) {
      const key = cursor.toISOString().slice(0, 10);
      const hit = byDay.get(key);
      days.push(
        hit
          ? {
              day: key,
              orderCount: hit.orderCount,
              gmv: hit.gmv,
              paidGmv: hit.paidGmv,
            }
          : { day: key, orderCount: 0, gmv: 0, paidGmv: 0 },
      );
      cursor.setDate(cursor.getDate() + 1);
      n += 1;
    }
    return days.length ? days : data.charts.dailySales;
  }, [data, filters.dateFrom, filters.dateTo]);

  const maxDaily = useMemo(() => {
    if (!chartDays.length) return 1;
    return Math.max(...chartDays.map((d) => d.paidGmv), 1);
  }, [chartDays]);

  if (!token) {
    return (
      <main className="min-h-screen bg-[#0f1412] px-6 py-16 text-[#eef2ef]">
        <p>Sign in from the home page first.</p>
        <Link href="/?modules=1" className="mt-4 inline-block text-[#8aa897]">
          ← Admin
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0f1412] px-3 py-8 text-[#eef2ef] sm:px-6">
      <div className="mx-auto max-w-[1400px]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-[#8aa897]">
              Sabu Operations
            </p>
            <h1 className="mt-1 text-3xl tracking-tight">Analytics Dashboard</h1>
            <p className="mt-1 text-sm text-[#9eb0a6]">
              Payment → Approval → QA → Driver → Delivery. Auto-refreshes every
              15s. Revenue counts paid orders only.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link
              href="/?modules=1"
              className="border border-[#24302a] px-3 py-2 text-[#b7c7be]"
            >
              Modules
            </Link>
            <Link href="/payments" className="border border-[#24302a] px-3 py-2 text-[#b7c7be]">
              Payments
            </Link>
            <Link href="/vendors" className="border border-[#24302a] px-3 py-2 text-[#b7c7be]">
              Vendors
            </Link>
            <Link href="/commissions" className="border border-[#24302a] px-3 py-2 text-[#b7c7be]">
              Vendor report
            </Link>
            <Link href="/deliveries" className="border border-[#24302a] px-3 py-2 text-[#b7c7be]">
              Dispatch
            </Link>
            <button
              type="button"
              onClick={() => {
                clearSession();
                window.location.href = "/";
              }}
              className="text-[#8aa897]"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Quick date slicers */}
        <div className="mt-6 flex flex-wrap gap-2">
          {[
            ["today", "Today"],
            ["yesterday", "Yesterday"],
            ["7d", "Last 7 Days"],
            ["30d", "Last 30 Days"],
            ["month", "This Month"],
          ].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => applyQuick(k)}
              className={`px-3 py-1.5 text-xs ${
                quick === k
                  ? "bg-[#2f6b4f] text-white"
                  : "border border-[#24302a] text-[#b7c7be]"
              }`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setQuick("custom");
              setFilters(defaultFilters());
            }}
            className="border border-[#24302a] px-3 py-1.5 text-xs text-[#8aa897]"
          >
            Reset filters
          </button>
        </div>

        {/* Filter slicers */}
        <div className="mt-4 grid gap-2 border border-[#24302a] bg-[#121916] p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <Field label="Search">
            <input
              value={filters.q ?? ""}
              onChange={(e) => patchFilters({ q: e.target.value || undefined })}
              placeholder="Order #, name, phone"
              className="w-full bg-[#17201c] px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Payment">
            <select
              value={filters.paymentStatus ?? ""}
              onChange={(e) =>
                patchFilters({ paymentStatus: e.target.value || undefined })
              }
              className="w-full bg-[#17201c] px-2 py-1.5 text-sm"
            >
              <option value="">All</option>
              <option value="pending_verification">Pending verification</option>
              <option value="paid">Paid / verified</option>
              <option value="unpaid">Unpaid</option>
            </select>
          </Field>
          <Field label="Approval">
            <select
              value={filters.approvalStatus ?? ""}
              onChange={(e) =>
                patchFilters({ approvalStatus: e.target.value || undefined })
              }
              className="w-full bg-[#17201c] px-2 py-1.5 text-sm"
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </Field>
          <Field label="QA">
            <select
              value={filters.qaStatus ?? ""}
              onChange={(e) =>
                patchFilters({ qaStatus: e.target.value || undefined })
              }
              className="w-full bg-[#17201c] px-2 py-1.5 text-sm"
            >
              <option value="">All</option>
              <option value="not_started">Not started</option>
              <option value="pending">Pending</option>
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
            </select>
          </Field>
          <Field label="Contact">
            <select
              value={filters.contactStatus ?? ""}
              onChange={(e) =>
                patchFilters({ contactStatus: e.target.value || undefined })
              }
              className="w-full bg-[#17201c] px-2 py-1.5 text-sm"
            >
              <option value="">All</option>
              <option value="required">Required</option>
              <option value="in_progress">In progress</option>
              <option value="resolved">Resolved</option>
            </select>
          </Field>
          <Field label="Delivery status">
            <select
              value={filters.deliveryStatus ?? ""}
              onChange={(e) =>
                patchFilters({ deliveryStatus: e.target.value || undefined })
              }
              className="w-full bg-[#17201c] px-2 py-1.5 text-sm"
            >
              <option value="">All</option>
              <option value="pending_assignment">Awaiting assignment</option>
              <option value="assigned">Assigned</option>
              <option value="in_transit">In transit</option>
              <option value="delivered">Delivered</option>
            </select>
          </Field>
          <Field label="Order type">
            <select
              value={filters.orderType ?? ""}
              onChange={(e) =>
                patchFilters({ orderType: e.target.value || undefined })
              }
              className="w-full bg-[#17201c] px-2 py-1.5 text-sm"
            >
              <option value="">All</option>
              <option value="retail">Retail</option>
              <option value="wholesale">Wholesale</option>
              <option value="special_order">Special order</option>
            </select>
          </Field>
          <Field label="Fulfillment">
            <select
              value={filters.fulfillmentType ?? ""}
              onChange={(e) =>
                patchFilters({ fulfillmentType: e.target.value || undefined })
              }
              className="w-full bg-[#17201c] px-2 py-1.5 text-sm"
            >
              <option value="">All</option>
              <option value="local_delivery">Local delivery</option>
              <option value="store_pickup">Store pickup</option>
              <option value="international_procurement">International</option>
            </select>
          </Field>
          <Field label="Amount min">
            <input
              type="number"
              value={filters.amountMin ?? ""}
              onChange={(e) =>
                patchFilters({ amountMin: e.target.value || undefined })
              }
              className="w-full bg-[#17201c] px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Amount max">
            <input
              type="number"
              value={filters.amountMax ?? ""}
              onChange={(e) =>
                patchFilters({ amountMax: e.target.value || undefined })
              }
              className="w-full bg-[#17201c] px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Save preset">
            <div className="flex gap-1">
              <input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="Name"
                className="w-full bg-[#17201c] px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={savePreset}
                className="bg-[#2f6b4f] px-2 text-xs"
              >
                Save
              </button>
            </div>
          </Field>
          <Field label="Load preset">
            <select
              value=""
              onChange={(e) => {
                const p = presets.find((x) => x.name === e.target.value);
                if (p) setFilters(p.filters);
              }}
              className="w-full bg-[#17201c] px-2 py-1.5 text-sm"
            >
              <option value="">Select…</option>
              {presets.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {message && <p className="mt-3 text-sm text-[#9dcdb4]">{message}</p>}

        {/* KPI cards */}
        {data && (
          <div className="mt-6 grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {KPI_DEFS.map((k) => {
              const val = data.kpis[k.key];
              const active = filters.attention === k.attention;
              return (
                <button
                  key={k.key}
                  type="button"
                  disabled={!k.attention}
                  onClick={() =>
                    k.attention &&
                    patchFilters({
                      attention:
                        filters.attention === k.attention
                          ? undefined
                          : k.attention,
                    })
                  }
                  className={`border px-3 py-3 text-left ${
                    active
                      ? "border-[#2f6b4f] bg-[#14201a]"
                      : "border-[#24302a] hover:border-[#2f6b4f]/60"
                  } disabled:cursor-default`}
                >
                  <p className="text-[11px] text-[#8aa897]">{k.label}</p>
                  <p className="mt-1 text-xl tracking-tight">
                    {k.money
                      ? Number(val).toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })
                      : String(val)}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {/* Attention center */}
        {data && (
          <section className="mt-8">
            <h2 className="text-xl tracking-tight">Orders Requiring Attention</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {(
                [
                  [
                    "pending_payment",
                    "Pending Payment Verification",
                    data.attention.pendingPaymentVerification,
                  ],
                  [
                    "pending_approval",
                    "Pending Admin Approval",
                    data.attention.pendingAdminApproval,
                  ],
                  [
                    "pending_qa",
                    "Pending QA Review",
                    data.attention.pendingQaReview,
                  ],
                  [
                    "contact_required",
                    "Customer Contact Required",
                    data.attention.customerContactRequired,
                  ],
                  [
                    "ready_assignment",
                    "Ready for Driver Assignment",
                    data.attention.readyForDriverAssignment,
                  ],
                ] as const
              ).map(([key, label, info]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    patchFilters({
                      attention:
                        filters.attention === key ? undefined : key,
                    })
                  }
                  className={`border px-3 py-4 text-left ${
                    filters.attention === key
                      ? "border-[#2f6b4f] bg-[#14201a]"
                      : "border-[#24302a]"
                  }`}
                >
                  <p className="text-xs text-[#8aa897]">{label}</p>
                  <p className="mt-2 text-2xl">{info.count}</p>
                  {info.overdue > 0 && (
                    <p className="mt-1 text-xs text-amber-400">
                      {info.overdue} overdue
                    </p>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Alerts */}
        {data && data.alerts.length > 0 && (
          <section className="mt-6 border border-[#24302a] p-3">
            <h3 className="text-sm text-[#8aa897]">Operational alerts</h3>
            <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-xs text-[#b7c7be]">
              {data.alerts.map((a) => (
                <li key={a.id} className="flex justify-between gap-3">
                  <span>
                    <span
                      className={
                        a.severity === "critical"
                          ? "text-red-400"
                          : a.severity === "warning"
                            ? "text-amber-400"
                            : "text-[#8aa897]"
                      }
                    >
                      [{a.severity}]
                    </span>{" "}
                    {a.title}
                  </span>
                  <span className="shrink-0 text-[#5f7368]">
                    {new Date(a.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Charts */}
        {data && (
          <section className="mt-8 grid gap-4 lg:grid-cols-3">
            <div className="border border-[#24302a] p-3 lg:col-span-2">
              <h3 className="text-sm text-[#8aa897]">
                Daily paid sales (confirmed revenue)
              </h3>
              <div className="mt-3 flex h-40 items-end gap-0.5 overflow-hidden">
                {chartDays.length === 0 && (
                  <p className="text-xs text-[#8aa897]">No data in range.</p>
                )}
                {chartDays.map((d) => {
                  const px = Math.round((d.paidGmv / maxDaily) * 140);
                  const barH = d.paidGmv > 0 ? Math.max(6, px) : 2;
                  return (
                    <div
                      key={String(d.day)}
                      className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
                      title={`${new Date(d.day).toLocaleDateString()}: ${d.paidGmv.toLocaleString()} ETB · ${d.orderCount} orders`}
                    >
                      <div
                        className={`w-full max-w-8 ${
                          d.paidGmv > 0 ? "bg-[#2f6b4f]" : "bg-[#24302a]"
                        }`}
                        style={{ height: `${barH}px` }}
                      />
                    </div>
                  );
                })}
              </div>
              {chartDays.length > 0 && (
                <div className="mt-2 flex justify-between text-[10px] text-[#5f7368]">
                  <span>
                    {new Date(chartDays[0].day).toLocaleDateString()}
                  </span>
                  <span>
                    Peak {maxDaily.toLocaleString()} ETB paid
                  </span>
                  <span>
                    {new Date(
                      chartDays[chartDays.length - 1].day,
                    ).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
            <div className="border border-[#24302a] p-3">
              <h3 className="text-sm text-[#8aa897]">Orders by status</h3>
              <ul className="mt-3 max-h-36 space-y-1 overflow-y-auto text-xs text-[#b7c7be]">
                {data.charts.ordersByStatus.map((s) => (
                  <li key={s.status} className="flex justify-between gap-2">
                    <span>{formatLabel(s.status)}</span>
                    <span>{s.count}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 border-t border-[#24302a] pt-3 text-xs text-[#b7c7be]">
                <p>
                  Product revenue:{" "}
                  {data.charts.revenueSplit.productRevenue.toLocaleString()} ETB
                </p>
                <p>
                  Delivery fees:{" "}
                  {data.charts.revenueSplit.deliveryFees.toLocaleString()} ETB
                </p>
                <p className="mt-2">
                  QA pass / fail: {data.charts.qaRates.passed} /{" "}
                  {data.charts.qaRates.failed}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Orders table + detail */}
        <section className="mt-8 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
          <div className="overflow-hidden border border-[#24302a]">
            <div className="flex items-center justify-between border-b border-[#24302a] px-3 py-2 text-sm text-[#8aa897]">
              <span>
                Orders{" "}
                {data
                  ? `(${data.orders.total} · page ${data.orders.page}/${data.orders.totalPages})`
                  : ""}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!data || data.orders.page <= 1}
                  onClick={() =>
                    patchFilters({ page: Math.max(1, filters.page - 1) })
                  }
                  className="border border-[#24302a] px-2 py-1 text-xs disabled:opacity-40"
                >
                  Prev
                </button>
                <button
                  type="button"
                  disabled={!data || data.orders.page >= data.orders.totalPages}
                  onClick={() => patchFilters({ page: filters.page + 1 })}
                  className="border border-[#24302a] px-2 py-1 text-xs disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
            <div className="max-h-[560px] overflow-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 bg-[#121916] text-[#8aa897]">
                  <tr>
                    {[
                      ["orderNumber", "Order"],
                      ["customer", "Customer"],
                      ["placedAt", "Date"],
                      ["amount", "Total"],
                      ["paymentStatus", "Payment"],
                      ["approvalStatus", "Approval"],
                      ["qaStatus", "QA"],
                      ["status", "Delivery"],
                    ].map(([key, label]) => (
                      <th key={key} className="px-2 py-2 font-medium">
                        <button
                          type="button"
                          onClick={() =>
                            patchFilters({
                              sort: key,
                              sortDir:
                                filters.sort === key && filters.sortDir === "desc"
                                  ? "asc"
                                  : "desc",
                            })
                          }
                        >
                          {label}
                        </button>
                      </th>
                    ))}
                    <th className="px-2 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.orders.items.map((o) => (
                    <OrderTableRow
                      key={o.id}
                      order={o}
                      active={selectedId === o.id}
                      onOpen={() => openOrder(o.id)}
                    />
                  ))}
                  {data && data.orders.items.length === 0 && (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-3 py-8 text-center text-[#8aa897]"
                      >
                        No orders match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border border-[#24302a] p-4">
            {!detail ? (
              <p className="text-sm text-[#8aa897]">
                Select an order to review payment, approve, run QA, contact the
                customer, or assign a driver.
              </p>
            ) : (
              <OrderReviewPanel
                detail={detail}
                notes={actionNotes}
                setNotes={setActionNotes}
                busy={busy}
                onApprove={() =>
                  runAction("Order approved", () =>
                    adminApi.approveOrder(token, detail.id, actionNotes || undefined),
                  )
                }
                onReject={() =>
                  runAction("Approval rejected", () =>
                    adminApi.rejectOrderApproval(
                      token,
                      detail.id,
                      actionNotes || undefined,
                    ),
                  )
                }
                onQaPass={() =>
                  runAction("QA passed", () =>
                    adminApi.qaOrder(token, detail.id, {
                      result: "passed",
                      notes: actionNotes || undefined,
                      checkedQtyOk: true,
                      variantsOk: true,
                      packagingOk: true,
                    }),
                  )
                }
                onQaFail={() =>
                  runAction("QA failed", () =>
                    adminApi.qaOrder(token, detail.id, {
                      result: "failed",
                      notes: actionNotes || undefined,
                    }),
                  )
                }
                onContact={() =>
                  runAction("Contact case opened", () =>
                    adminApi.openContactCase(token, detail.id, {
                      reasonCode: "other",
                      title: "Follow up with customer",
                      details: actionNotes || undefined,
                    }),
                  )
                }
                onResolveContact={() =>
                  runAction("Contact resolved", () =>
                    adminApi.resolveContactCase(token, detail.id, {
                      closeAll: true,
                      notes: actionNotes || undefined,
                    }),
                  )
                }
                onRecordCall={() =>
                  runAction("Contact attempt logged", () =>
                    adminApi.recordContactAttempt(token, detail.id, {
                      channel: "phone",
                      outcome: "reached",
                      notes: actionNotes || undefined,
                    }),
                  )
                }
                onVerifyPayment={(txId) =>
                  runAction("Payment verified", () =>
                    adminApi.approvePayment(token, txId),
                  )
                }
                onRejectPayment={(txId) =>
                  runAction("Payment rejected", () =>
                    adminApi.rejectPayment(
                      token,
                      txId,
                      actionNotes.trim() || "Rejected from dashboard",
                    ),
                  )
                }
                onClarifyPayment={(txId) =>
                  runAction("Clarification requested", () =>
                    adminApi.requestPaymentClarification(
                      token,
                      txId,
                      actionNotes.trim() || "Please clarify Telebirr TXN",
                    ),
                  )
                }
                onFlagDuplicate={(txId) =>
                  runAction("Flagged as duplicate", () =>
                    adminApi.flagPaymentDuplicate(
                      token,
                      txId,
                      actionNotes.trim() || undefined,
                    ),
                  )
                }
                loadPaymentLogs={(txId) =>
                  adminApi.paymentVerificationLogs(token, txId)
                }
              />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-[11px] text-[#8aa897]">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function OrderTableRow({
  order: o,
  active,
  onOpen,
}: {
  order: OrderRow;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <tr
      className={`border-t border-[#24302a] ${
        active ? "bg-[#14201a]" : "hover:bg-[#121916]"
      }`}
    >
      <td className="px-2 py-2 font-medium">{o.orderNumber}</td>
      <td className="px-2 py-2">
        <div>{o.customerName ?? "—"}</div>
        <div className="text-[#8aa897]">{o.phone}</div>
      </td>
      <td className="px-2 py-2 whitespace-nowrap">
        {o.placedAt ? new Date(o.placedAt).toLocaleString() : "—"}
      </td>
      <td className="px-2 py-2 whitespace-nowrap">
        {o.totalAmount.toLocaleString()}
        <div className="text-[#8aa897]">
          {o.itemCount} items · fee {o.deliveryFee}
        </div>
      </td>
      <td className="px-2 py-2">
        <StatusPill value={o.paymentStatus} />
        {o.telebirrTxnId && (
          <div className="mt-0.5 max-w-[90px] truncate text-[10px] text-[#8aa897]">
            {o.telebirrTxnId}
          </div>
        )}
      </td>
      <td className="px-2 py-2">
        <StatusPill value={o.approvalStatus} />
      </td>
      <td className="px-2 py-2">
        <StatusPill value={o.qaStatus} />
      </td>
      <td className="px-2 py-2">
        <div>{formatLabel(o.deliveryStatus ?? "awaiting")}</div>
        <div className="text-[#8aa897]">{o.assignedDriver ?? "—"}</div>
      </td>
      <td className="px-2 py-2">
        <button
          type="button"
          onClick={onOpen}
          className="bg-[#2f6b4f] px-2 py-1 text-[11px]"
        >
          Review
        </button>
      </td>
    </tr>
  );
}

function StatusPill({ value }: { value: string }) {
  return (
    <span className="inline-block border border-[#24302a] px-1.5 py-0.5 text-[10px] text-[#b7c7be]">
      {formatLabel(value)}
    </span>
  );
}

function OrderReviewPanel({
  detail,
  notes,
  setNotes,
  busy,
  onApprove,
  onReject,
  onQaPass,
  onQaFail,
  onContact,
  onResolveContact,
  onRecordCall,
  onVerifyPayment,
  onRejectPayment,
  onClarifyPayment,
  onFlagDuplicate,
  loadPaymentLogs,
}: {
  detail: Detail;
  notes: string;
  setNotes: (v: string) => void;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onQaPass: () => void;
  onQaFail: () => void;
  onContact: () => void;
  onResolveContact: () => void;
  onRecordCall: () => void;
  onVerifyPayment: (txId: string) => void;
  onRejectPayment: (txId: string) => void;
  onClarifyPayment: (txId: string) => void;
  onFlagDuplicate: (txId: string) => void;
  loadPaymentLogs: (
    txId: string,
  ) => Promise<
    Array<{
      id: string;
      action: string;
      notes: string | null;
      actorName: string | null;
      createdAt: string;
    }>
  >;
}) {
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const [paymentLogs, setPaymentLogs] = useState<
    Array<{
      id: string;
      action: string;
      notes: string | null;
      actorName: string | null;
      createdAt: string;
    }>
  >([]);
  const [logsBusy, setLogsBusy] = useState(false);

  const phone =
    detail.shipping.phone || detail.guestPhone || null;
  const canApprove =
    detail.paymentStatus === "paid" && detail.approvalStatus !== "approved";
  const canQa =
    detail.paymentStatus === "paid" &&
    detail.approvalStatus === "approved" &&
    detail.qaStatus !== "passed";
  const canAssign =
    detail.paymentStatus === "paid" &&
    detail.approvalStatus === "approved" &&
    detail.qaStatus === "passed";
  const terminalTx = new Set([
    "approved",
    "succeeded",
    "paid",
    "rejected",
    "failed",
    "cancelled",
  ]);
  const needsPaymentAction =
    detail.paymentStatus === "pending_verification" ||
    detail.paymentStatus === "unpaid";

  async function showLogs(txId: string) {
    if (logsFor === txId) {
      setLogsFor(null);
      return;
    }
    setLogsBusy(true);
    try {
      const rows = await loadPaymentLogs(txId);
      setPaymentLogs(rows);
      setLogsFor(txId);
    } finally {
      setLogsBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <div>
        <h2 className="text-xl">{detail.orderNumber}</h2>
        <p className="text-xs text-[#8aa897]">
          {formatLabel(detail.status)} · pay {formatLabel(detail.paymentStatus)}{" "}
          · approval {formatLabel(detail.approvalStatus)} · QA{" "}
          {formatLabel(detail.qaStatus)}
        </p>
      </div>

      <div className="text-[#b7c7be]">
        <p>
          {detail.shipping.name} · {phone}
        </p>
        <p className="text-xs text-[#8aa897]">
          Preferred: {detail.preferredContactChannel ?? "—"}
          {detail.requiresManualContact ? " · contact required" : ""}
        </p>
        <p className="mt-1 text-xs">{detail.shipping.address}</p>
        {detail.shipping.deliveryInstructions && (
          <p className="mt-1 text-xs text-amber-200/80">
            Instructions: {detail.shipping.deliveryInstructions}
          </p>
        )}
        {detail.shipping.googleMapsUrl && (
          <a
            href={detail.shipping.googleMapsUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-xs text-[#9dcdb4] underline"
          >
            Open map
          </a>
        )}
      </div>

      <ul className="space-y-1 border-t border-[#24302a] pt-3 text-xs text-[#b7c7be]">
        {detail.items.map((i) => (
          <li key={i.lineNo}>
            {i.name} × {i.quantity} · {i.lineTotal.toLocaleString()} ETB
          </li>
        ))}
      </ul>

      <div className="border-t border-[#24302a] pt-3 text-xs text-[#b7c7be]">
        <p>Products: {detail.subtotal.toLocaleString()} ETB</p>
        <p>Delivery: {detail.deliveryFee.toLocaleString()} ETB</p>
        <p className="text-sm text-[#eef2ef]">
          Total: {detail.grandTotal.toLocaleString()} ETB
        </p>
      </div>

      <div className="border-t border-[#24302a] pt-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[#8aa897]">Payment verification</p>
          <Link
            href={`/payments?orderId=${encodeURIComponent(detail.id)}`}
            className="text-[11px] text-[#9dcdb4] underline"
          >
            Open in payment queue →
          </Link>
        </div>
        {(detail.payments ?? []).length === 0 && (
          <p className="mt-1 text-[#b7c7be]">
            No payment submission on file yet · status{" "}
            {formatLabel(detail.paymentStatus)}
          </p>
        )}
        {(detail.payments ?? []).map((p) => {
          const status = (p.transactionStatus ?? p.intentStatus ?? "").toLowerCase();
          const canManagePayment =
            !!p.transactionId &&
            detail.paymentStatus !== "paid" &&
            !terminalTx.has(status);
          return (
            <div
              key={p.intentId}
              className="mt-2 border border-[#24302a] bg-[#121916] p-2 text-[#b7c7be]"
            >
              <p>
                {p.methodCode ?? "method"} ·{" "}
                {p.transactionStatus ?? p.intentStatus} ·{" "}
                {p.amount.toLocaleString()} ETB
              </p>
              {p.providerReference && (
                <p className="mt-1 text-[#eef2ef]">
                  Telebirr TXN:{" "}
                  <span className="font-mono">{p.providerReference}</span>
                </p>
              )}
              {p.rejectionReason && (
                <p className="mt-1 text-amber-400">
                  Rejection: {p.rejectionReason}
                </p>
              )}
              {p.transactionId && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {canManagePayment && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onVerifyPayment(p.transactionId!)}
                        className="bg-[#2f6b4f] px-2 py-1 text-[11px] disabled:opacity-50"
                      >
                        Verify Payment
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onRejectPayment(p.transactionId!)}
                        className="border border-[#24302a] px-2 py-1 text-[11px] disabled:opacity-50"
                      >
                        Reject Payment
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onClarifyPayment(p.transactionId!)}
                        className="border border-[#24302a] px-2 py-1 text-[11px] disabled:opacity-50"
                      >
                        Request Clarification
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onFlagDuplicate(p.transactionId!)}
                        className="border border-[#24302a] px-2 py-1 text-[11px] disabled:opacity-50"
                      >
                        Flag Duplicate
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    disabled={logsBusy}
                    onClick={() => showLogs(p.transactionId!)}
                    className="border border-[#24302a] px-2 py-1 text-[11px] disabled:opacity-50"
                  >
                    {logsFor === p.transactionId ? "Hide History" : "History"}
                  </button>
                </div>
              )}
              {logsFor === p.transactionId && (
                <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto border-l border-[#24302a] pl-2 text-[11px] text-[#8aa897]">
                  {paymentLogs.length === 0 && <li>No verification history yet</li>}
                  {paymentLogs.map((l) => (
                    <li key={l.id}>
                      {l.action}
                      {l.notes ? ` — ${l.notes}` : ""} ·{" "}
                      {l.actorName ?? "system"} ·{" "}
                      {new Date(l.createdAt).toLocaleString()}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {needsPaymentAction && (
          <p className="mt-2 text-[11px] text-[#8aa897]">
            Use notes below for reject/clarify reasons. Verify marks Telebirr
            paid and unlocks approval.
          </p>
        )}
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Action notes (required for reject / clarification)…"
        className="mt-2 w-full bg-[#17201c] px-3 py-2 text-sm"
        rows={2}
      />

      <div className="flex flex-wrap gap-2">
        {canApprove && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onApprove}
              className="bg-[#2f6b4f] px-3 py-2 text-xs disabled:opacity-50"
            >
              Approve Order
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onReject}
              className="border border-[#24302a] px-3 py-2 text-xs disabled:opacity-50"
            >
              Reject Order
            </button>
          </>
        )}
        {canQa && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onQaPass}
              className="bg-[#2f6b4f] px-3 py-2 text-xs disabled:opacity-50"
            >
              Mark QA Passed
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onQaFail}
              className="border border-[#24302a] px-3 py-2 text-xs disabled:opacity-50"
            >
              Mark QA Failed
            </button>
          </>
        )}
        {phone && (
          <a
            href={`tel:${phone}`}
            className="border border-[#24302a] px-3 py-2 text-xs text-[#b7c7be]"
          >
            Call Customer
          </a>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onRecordCall}
          className="border border-[#24302a] px-3 py-2 text-xs disabled:opacity-50"
        >
          Log Contact
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onContact}
          className="border border-[#24302a] px-3 py-2 text-xs disabled:opacity-50"
        >
          Flag Contact Required
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onResolveContact}
          className="border border-[#24302a] px-3 py-2 text-xs disabled:opacity-50"
        >
          Resolve Contact
        </button>
        {canAssign && (
          <Link
            href={`/deliveries?orderId=${encodeURIComponent(detail.id)}`}
            className="bg-[#2f6b4f] px-3 py-2 text-xs"
          >
            Assign Driver
          </Link>
        )}
        <Link
          href={`/payments?orderId=${encodeURIComponent(detail.id)}`}
          className="border border-[#24302a] px-3 py-2 text-xs"
        >
          Full Payment Queue
        </Link>
      </div>

      {detail.history?.length > 0 && (
        <div className="border-t border-[#24302a] pt-3">
          <p className="text-xs text-[#8aa897]">Activity</p>
          <ul className="mt-1 max-h-28 space-y-1 overflow-y-auto text-[11px] text-[#b7c7be]">
            {detail.history.map((h, idx) => (
              <li key={idx}>
                {formatLabel(h.fromStatus)} → {formatLabel(h.toStatus)}
                {h.reason ? ` · ${formatLabel(h.reason)}` : ""} ·{" "}
                {new Date(h.changedAt).toLocaleString()}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
