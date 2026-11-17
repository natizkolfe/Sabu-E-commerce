"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { formatLabel } from "../../lib/format";
import { loadSession } from "../../lib/session";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "http://localhost:3001/v1";

type Tab =
  | "overview"
  | "sales"
  | "rules"
  | "settlements"
  | "adjustments"
  | "analytics"
  | "audit";

type Settlement = Awaited<
  ReturnType<typeof adminApi.listSettlements>
>[number];
type CommissionRow = Awaited<
  ReturnType<typeof adminApi.listCommissions>
>[number];
type Rule = Awaited<ReturnType<typeof adminApi.listCommissionRules>>[number];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function payoutBadge(state: "unpaid" | "settlement_pending" | "paid") {
  if (state === "paid") {
    return (
      <span className="border border-[#2f6b4f] bg-[#2f6b4f]/20 px-2 py-0.5 text-[11px] text-[#9dcdb4]">
        Paid
      </span>
    );
  }
  if (state === "settlement_pending") {
    return (
      <span className="border border-[#8a6a2f] bg-[#8a6a2f]/20 px-2 py-0.5 text-[11px] text-[#e6c97a]">
        Awaiting remittance
      </span>
    );
  }
  return (
    <span className="border border-[#8a3a3a] bg-[#8a3a3a]/20 px-2 py-0.5 text-[11px] text-[#f0a0a0]">
      Unpaid
    </span>
  );
}

function formatVendorReceipt(s: Settlement): string {
  const lines: string[] = [
    "Sabu Online Shopping — Vendor settlement receipt",
    "==============================================",
    `Settlement: ${s.settlementNumber}`,
    `Vendor: ${s.vendorName}`,
    `Period: ${s.periodStart} → ${s.periodEnd}`,
    `Status: ${s.status === "paid" ? "Paid" : formatLabel(s.status)}`,
  ];
  if (s.paidAt) lines.push(`Paid date: ${new Date(s.paidAt).toLocaleDateString()}`);
  if (s.payoutReference) lines.push(`Payout reference: ${s.payoutReference}`);
  if (s.adjustmentsTotal) {
    lines.push(`Adjustments: ${s.adjustmentsTotal.toFixed(2)} ETB`);
  }
  lines.push("", "Items", "-----");
  for (const it of s.items) {
    lines.push(
      `• ${it.orderNumber} — ${it.productSummary ?? "Merchandise"}`,
      `  Sale total: ${it.grossAmount.toFixed(2)} ETB`,
      `  Sabu fee: ${it.ratePct}% = ${it.commissionAmount.toFixed(2)} ETB`,
      `  Vendor net: ${it.netPayable.toFixed(2)} ETB`,
      "",
    );
  }
  lines.push(
    "Totals",
    "------",
    `Gross sales: ${s.grossSales.toFixed(2)} ETB`,
    `Sabu commission: ${s.commissionTotal.toFixed(2)} ETB`,
    `Amount paid to vendor: ${s.netPayable.toFixed(2)} ETB`,
    "",
    `QR payload: ${s.receiptQrPayload ?? s.settlementNumber}`,
    "",
    "Delivery fees stay with Sabu and are not included in vendor payouts.",
    "Thank you for selling with Sabu.",
  );
  return lines.join("\n");
}

function SimpleBarChart({
  data,
  valueKey,
  labelKey,
  color = "#3d8f6a",
}: {
  data: Array<Record<string, string | number>>;
  valueKey: string;
  labelKey: string;
  color?: string;
}) {
  const max = Math.max(...data.map((d) => Number(d[valueKey]) || 0), 1);
  return (
    <div className="space-y-2">
      {data.map((d) => {
        const v = Number(d[valueKey]) || 0;
        const pct = Math.round((v / max) * 100);
        return (
          <div key={String(d[labelKey])} className="grid grid-cols-[100px_1fr_72px] items-center gap-2 text-xs">
            <span className="truncate text-[#9aa]">
              {String(d[labelKey])}
            </span>
            <div className="h-2 overflow-hidden rounded bg-[#1a1f1c]">
              <div
                className="h-full rounded transition-all"
                style={{ width: `${pct}%`, background: color }}
              />
            </div>
            <span className="text-right tabular-nums text-[#cfc]">
              {v.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>
        );
      })}
      {!data.length ? (
        <p className="text-sm text-[#888]">No data for this range.</p>
      ) : null}
    </div>
  );
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "sales", label: "Vendor Sales" },
  { id: "rules", label: "Commission Rules" },
  { id: "settlements", label: "Settlements" },
  { id: "adjustments", label: "Adjustments" },
  { id: "analytics", label: "Analytics" },
  { id: "audit", label: "Audit" },
];

const emptyFilters = {
  vendorId: "",
  vendorQ: "",
  dateFrom: "",
  dateTo: "",
  payoutState: "",
  orderNumber: "",
  settlementNumber: "",
  rateMin: "",
  rateMax: "",
  amountMin: "",
  amountMax: "",
  channel: "",
  sort: "date_desc",
};

export default function CommissionsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [rule, setRule] = useState<{ ratePct: number; code: string } | null>(
    null,
  );
  const [rules, setRules] = useState<Rule[]>([]);
  const [presets, setPresets] = useState<
    Array<{ code: string; name: string; kind: string }>
  >([]);
  const [vendors, setVendors] = useState<
    Awaited<ReturnType<typeof adminApi.listVendors>>
  >([]);
  const [categories, setCategories] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [rows, setRows] = useState<CommissionRow[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [adjustments, setAdjustments] = useState<
    Awaited<ReturnType<typeof adminApi.listAdjustments>>
  >([]);
  const [audit, setAudit] = useState<
    Awaited<ReturnType<typeof adminApi.listCommissionAudit>>
  >([]);
  const [summary, setSummary] = useState<Awaited<
    ReturnType<typeof adminApi.commissionsSummary>
  > | null>(null);
  const [analytics, setAnalytics] = useState<Awaited<
    ReturnType<typeof adminApi.commissionsAnalytics>
  > | null>(null);
  const [filters, setFilters] = useState(emptyFilters);
  const [vendorSuggestions, setVendorSuggestions] = useState<
    Awaited<ReturnType<typeof adminApi.vendorAutocomplete>>
  >([]);
  const [detailVendorId, setDetailVendorId] = useState<string | null>(null);
  const [vendorDetail, setVendorDetail] = useState<Awaited<
    ReturnType<typeof adminApi.vendorCommissionDetail>
  > | null>(null);

  const [settleVendorId, setSettleVendorId] = useState("");
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [confirmSettlementId, setConfirmSettlementId] = useState<string | null>(
    null,
  );
  const [partialAmount, setPartialAmount] = useState("");
  const [paidAt, setPaidAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [payoutReference, setPayoutReference] = useState("");
  const [receiptKey, setReceiptKey] = useState<string | null>(null);
  const [receiptName, setReceiptName] = useState<string | null>(null);
  const [vendorReceiptId, setVendorReceiptId] = useState<string | null>(null);

  const [ruleForm, setRuleForm] = useState({
    name: "",
    scope: "global" as "global" | "vendor" | "category",
    kind: "standard" as "standard" | "promo" | "event",
    ratePct: "2",
    vendorId: "",
    categoryId: "",
    validFrom: "",
    validTo: "",
    confirmLargeChange: false,
  });
  const [adjForm, setAdjForm] = useState({
    vendorId: "",
    adjustmentType: "settlement_correction",
    adjustmentAmount: "",
    reason: "",
    confirmLargeChange: false,
  });
  const [globalRateDraft, setGlobalRateDraft] = useState("2");
  const [previewImpact, setPreviewImpact] = useState<{
    estimatedCommissionAtRate: number;
    currentAccruedCommission: number;
    delta: number;
    note: string;
  } | null>(null);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const filterParams = useCallback(() => {
    return {
      vendorId: filters.vendorId || undefined,
      dateFrom: filters.dateFrom
        ? new Date(`${filters.dateFrom}T00:00:00`).toISOString()
        : undefined,
      dateTo: filters.dateTo
        ? new Date(`${filters.dateTo}T23:59:59`).toISOString()
        : undefined,
      payoutState: filters.payoutState || undefined,
      orderNumber: filters.orderNumber || undefined,
      settlementNumber: filters.settlementNumber || undefined,
      rateMin: filters.rateMin ? Number(filters.rateMin) : undefined,
      rateMax: filters.rateMax ? Number(filters.rateMax) : undefined,
      amountMin: filters.amountMin ? Number(filters.amountMin) : undefined,
      amountMax: filters.amountMax ? Number(filters.amountMax) : undefined,
      channel: filters.channel || undefined,
      sort: filters.sort || undefined,
    };
  }, [filters]);

  async function refresh(
    access: string,
    fp: Partial<ReturnType<typeof filterParams>> = filterParams(),
  ) {
    const [r, list, v, stl, rulesList, sum, adjs, auditList, cats, presetList] =
      await Promise.all([
        adminApi.commissionRule(access),
        adminApi.listCommissions(access, fp),
        adminApi.listVendors(access),
        adminApi.listSettlements(access, {
          vendorId: fp.vendorId,
          dateFrom: fp.dateFrom,
          dateTo: fp.dateTo,
          settlementNumber: fp.settlementNumber,
        }),
        adminApi.listCommissionRules(access),
        adminApi.commissionsSummary(access, {
          vendorId: fp.vendorId,
          dateFrom: fp.dateFrom,
          dateTo: fp.dateTo,
        }),
        adminApi.listAdjustments(access, { vendorId: fp.vendorId }),
        adminApi.listCommissionAudit(access, { limit: 80 }),
        adminApi.adminCategories(access).catch(() => []),
        adminApi.commissionRulePresets(access).catch(() => []),
      ]);
    setRule(r);
    setGlobalRateDraft(String(r.ratePct));
    setRows(list);
    setVendors(v);
    setSettlements(stl);
    setRules(rulesList);
    setSummary(sum);
    setAdjustments(adjs);
    setAudit(auditList);
    setCategories(
      (cats as Array<{ id: string; name: string }>).map((c) => ({
        id: c.id,
        name: c.name,
      })),
    );
    setPresets(presetList);
  }

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    refresh(s.accessToken).catch((err: unknown) =>
      setError(err instanceof ApiError ? err.message : "Load failed"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!token || tab !== "analytics") return;
    adminApi
      .commissionsAnalytics(token, {
        vendorId: filters.vendorId || undefined,
        dateFrom: filters.dateFrom
          ? new Date(`${filters.dateFrom}T00:00:00`).toISOString()
          : undefined,
        dateTo: filters.dateTo
          ? new Date(`${filters.dateTo}T23:59:59`).toISOString()
          : undefined,
      })
      .then(setAnalytics)
      .catch(() => setAnalytics(null));
  }, [token, tab, filters.vendorId, filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    if (!token || !detailVendorId) {
      setVendorDetail(null);
      return;
    }
    adminApi
      .vendorCommissionDetail(token, detailVendorId)
      .then(setVendorDetail)
      .catch(() => setVendorDetail(null));
  }, [token, detailVendorId]);

  const unpaidRows = useMemo(
    () => rows.filter((r) => r.payoutState === "unpaid"),
    [rows],
  );

  const previewItems = useMemo(() => {
    if (!settleVendorId) return [];
    const vendorUnpaid = unpaidRows.filter((r) => r.vendorId === settleVendorId);
    if (selectedEntryIds.length === 0) return vendorUnpaid;
    return vendorUnpaid.filter((r) => selectedEntryIds.includes(r.id));
  }, [settleVendorId, unpaidRows, selectedEntryIds]);

  const previewTotals = useMemo(
    () =>
      previewItems.reduce(
        (acc, r) => {
          acc.gross += r.grossAmount;
          acc.fee += r.commissionAmount;
          acc.net += r.netPayable;
          return acc;
        },
        { gross: 0, fee: 0, net: 0 },
      ),
    [previewItems],
  );

  useEffect(() => {
    if (!settleVendorId) {
      setSelectedEntryIds([]);
      return;
    }
    setSelectedEntryIds(
      unpaidRows.filter((r) => r.vendorId === settleVendorId).map((r) => r.id),
    );
  }, [settleVendorId, unpaidRows]);

  async function applyFilters() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await refresh(token);
      setMessage("Filters applied.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Filter failed");
    } finally {
      setBusy(false);
    }
  }

  async function clearFilters() {
    setFilters(emptyFilters);
    setVendorSuggestions([]);
    if (!token) return;
    setBusy(true);
    try {
      await refresh(token, {});
      setMessage("Filters cleared.");
    } finally {
      setBusy(false);
    }
  }

  async function onVendorSearch(q: string) {
    setFilters((f) => ({ ...f, vendorQ: q }));
    if (!token || q.trim().length < 1) {
      setVendorSuggestions([]);
      return;
    }
    try {
      const list = await adminApi.vendorAutocomplete(token, q.trim());
      setVendorSuggestions(list);
    } catch {
      setVendorSuggestions([]);
    }
  }

  async function settleVendor() {
    if (!token || !settleVendorId || previewItems.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.createSettlement(token, {
        vendorId: settleVendorId,
        entryIds: previewItems.map((r) => r.id),
        status: "pending_payment",
      });
      setMessage("Settlement created. Confirm payment when remitted.");
      setSettleVendorId("");
      await refresh(token);
      setTab("settlements");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Settlement failed");
    } finally {
      setBusy(false);
    }
  }

  function openConfirm(id: string) {
    const s = settlements.find((x) => x.id === id);
    setConfirmSettlementId(id);
    setPaidAt(new Date().toISOString().slice(0, 10));
    setPayoutReference("");
    setReceiptKey(null);
    setReceiptName(null);
    setPartialAmount(s ? String(s.balanceDue ?? s.netPayable) : "");
    setMessage(null);
    setError(null);
  }

  async function onReceiptSelected(file: File | null) {
    if (!token || !file) return;
    setBusy(true);
    setError(null);
    try {
      const data = await fileToDataUrl(file);
      const uploaded = await adminApi.uploadMedia(token, {
        data,
        folder: "vendor-payouts",
        mimeType: file.type || undefined,
      });
      setReceiptKey(uploaded.storageKey);
      setReceiptName(file.name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Receipt upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPaid(e: FormEvent) {
    e.preventDefault();
    if (!token || !confirmSettlementId) return;
    setBusy(true);
    setError(null);
    try {
      const amount = Number(partialAmount);
      await adminApi.markSettlementPaid(token, confirmSettlementId, {
        payoutReference: payoutReference.trim() || undefined,
        payoutReceiptKey: receiptKey || undefined,
        paidAt: new Date(`${paidAt}T12:00:00`).toISOString(),
        amount: Number.isFinite(amount) && amount > 0 ? amount : undefined,
        markFullyPaid: true,
      });
      setMessage("Vendor payment recorded.");
      setConfirmSettlementId(null);
      await refresh(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyVendorReceipt(s: Settlement) {
    const text = formatVendorReceipt(s);
    try {
      await navigator.clipboard.writeText(text);
      if (token) await adminApi.logSettlementCopy(token, s.id).catch(() => null);
      setMessage(`Receipt for ${s.settlementNumber} copied.`);
    } catch {
      setError("Could not copy receipt.");
    }
  }

  async function sendWhatsApp(s: Settlement) {
    if (!token) return;
    setBusy(true);
    try {
      const res = await adminApi.sendSettlementWhatsApp(token, s.id);
      if (res.deepLink) window.open(res.deepLink, "_blank");
      setMessage(
        res.ok
          ? res.mode === "wa_me"
            ? "WhatsApp link opened."
            : "WhatsApp message sent."
          : res.error ?? "WhatsApp send failed",
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "WhatsApp failed");
    } finally {
      setBusy(false);
    }
  }

  function printVendorReceipt(s: Settlement) {
    const qr = encodeURIComponent(
      s.receiptQrPayload ??
        JSON.stringify({
          type: "sabu_settlement",
          settlementNumber: s.settlementNumber,
          settlementId: s.id,
        }),
    );
    const itemsHtml = s.items
      .map(
        (it) => `
      <div class="item">
        <p class="item-title">${escapeHtml(it.orderNumber)} · ${escapeHtml(it.productSummary ?? "Merchandise")}</p>
        <p class="muted">Sale ${it.grossAmount.toFixed(2)} ETB · Sabu fee ${it.ratePct}% = ${it.commissionAmount.toFixed(2)} ETB</p>
        <p class="net">Vendor net ${it.netPayable.toFixed(2)} ETB</p>
      </div>`,
      )
      .join("");
    const adj =
      s.adjustmentsTotal && s.adjustmentsTotal !== 0
        ? `<div class="row"><span>Adjustments</span><span>${s.adjustmentsTotal.toFixed(2)} ETB</span></div>`
        : "";
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Sabu Online Shopping</title>
<style>
@page{margin:16mm}body{margin:0;font-family:Georgia,serif;color:#111}
.sheet{position:relative;max-width:720px;margin:0 auto;padding:28px 8px;overflow:hidden}
.watermark{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;transform:rotate(-28deg)}
.watermark .line1{font-family:Segoe UI,Helvetica,sans-serif;font-size:42px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(15,61,40,.10)}
.watermark .line2{margin-top:10px;font-size:22px;font-style:italic;color:rgba(15,61,40,.12)}
.content{position:relative;z-index:1}.brand{font-family:Segoe UI,sans-serif;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#666}
h1{margin:8px 0 0;font-size:28px;font-family:Segoe UI,sans-serif}.meta{margin-top:6px;color:#555;font-size:14px}
.period{margin-top:4px;color:#777;font-size:12px}.item{border-top:1px solid #ddd;padding:14px 0}
.item-title{margin:0;font-weight:600;font-size:15px}.muted{margin:4px 0 0;color:#666;font-size:12px}.net{margin:4px 0 0;font-weight:600}
.totals{margin-top:18px;font-size:14px}.row{display:flex;justify-content:space-between;gap:16px;margin:4px 0}
.row.strong{margin-top:10px;font-size:16px;font-weight:700}.note{margin-top:14px;color:#777;font-size:12px}
.qr{margin-top:18px;display:flex;gap:16px;align-items:center}.qr img{width:96px;height:96px}
</style></head><body>
<div class="sheet">
<div class="watermark" aria-hidden="true"><div class="line1">Vendor Receipt</div><div class="line2">Sabu Online Shopping</div></div>
<div class="content">
<p class="brand">Sabu Online Shopping</p>
<h1>Settlement ${escapeHtml(s.settlementNumber)}</h1>
<p class="meta">Vendor: ${escapeHtml(s.vendorName)} · Status: ${escapeHtml(formatLabel(s.status))}</p>
<p class="period">Period ${escapeHtml(s.periodStart)} → ${escapeHtml(s.periodEnd)}${s.paidAt ? ` · Paid ${new Date(s.paidAt).toLocaleDateString()}` : ""}${s.payoutReference ? ` · Ref ${escapeHtml(s.payoutReference)}` : ""}</p>
${itemsHtml}
<div class="totals">
<div class="row"><span>Gross sales</span><span>${s.grossSales.toFixed(2)} ETB</span></div>
<div class="row"><span>Sabu commission</span><span>${s.commissionTotal.toFixed(2)} ETB</span></div>
${adj}
<div class="row strong"><span>Paid to vendor</span><span>${s.netPayable.toFixed(2)} ETB</span></div>
<p class="note">Delivery fees stay with Sabu and are not included. Rates shown are snapshotted at sale time.</p>
<div class="qr">
<img alt="QR" src="https://api.qrserver.com/v1/create-qr-code/?size=96x96&data=${qr}"/>
<div><p class="muted">Scan to verify receipt</p><p class="muted">${escapeHtml(s.settlementNumber)}</p></div>
</div>
</div></div></div>
<script>window.onload=function(){document.title="Sabu Online Shopping";setTimeout(function(){window.focus();window.print()},150)}</script>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) {
      setError("Allow pop-ups to print the vendor receipt.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  async function saveGlobalRate() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.patchCommissionRule(token, {
        ratePct: Number(globalRateDraft),
        confirmLargeChange: true,
      });
      setMessage("Global default rate updated (historical entries unchanged).");
      await refresh(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function createRule(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.createCommissionRule(token, {
        name: ruleForm.name,
        scope: ruleForm.scope,
        kind: ruleForm.kind,
        ratePct: Number(ruleForm.ratePct),
        vendorId: ruleForm.scope === "vendor" ? ruleForm.vendorId : undefined,
        categoryId:
          ruleForm.scope === "category" ? ruleForm.categoryId : undefined,
        validFrom: ruleForm.validFrom
          ? new Date(ruleForm.validFrom).toISOString()
          : undefined,
        validTo: ruleForm.validTo
          ? new Date(ruleForm.validTo).toISOString()
          : null,
        confirmLargeChange: ruleForm.confirmLargeChange,
      });
      setMessage("Commission rule created.");
      setRuleForm({
        name: "",
        scope: "global",
        kind: "standard",
        ratePct: "2",
        vendorId: "",
        categoryId: "",
        validFrom: "",
        validTo: "",
        confirmLargeChange: false,
      });
      await refresh(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Create rule failed");
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    if (!token) return;
    try {
      const p = await adminApi.previewCommissionRule(token, {
        ratePct: Number(ruleForm.ratePct),
      });
      setPreviewImpact(p);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Preview failed");
    }
  }

  async function createAdj(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.createAdjustment(token, {
        vendorId: adjForm.vendorId,
        adjustmentType: adjForm.adjustmentType,
        adjustmentAmount: Number(adjForm.adjustmentAmount),
        reason: adjForm.reason,
        confirmLargeChange: adjForm.confirmLargeChange,
      });
      setMessage("Adjustment submitted (pending approval).");
      setAdjForm({
        vendorId: "",
        adjustmentType: "settlement_correction",
        adjustmentAmount: "",
        reason: "",
        confirmLargeChange: false,
      });
      await refresh(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Adjustment failed");
    } finally {
      setBusy(false);
    }
  }

  async function exportType(
    type: "sales" | "settlements" | "adjustments" | "rules",
  ) {
    if (!token) return;
    setBusy(true);
    try {
      const res = await adminApi.exportCommissionsReport(token, {
        type,
        format: "csv",
        vendorId: filters.vendorId || undefined,
        dateFrom: filters.dateFrom
          ? new Date(`${filters.dateFrom}T00:00:00`).toISOString()
          : undefined,
        dateTo: filters.dateTo
          ? new Date(`${filters.dateTo}T23:59:59`).toISOString()
          : undefined,
      });
      if (res.csv) {
        const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = res.filename ?? `sabu-${type}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        setMessage(`${type} CSV downloaded.`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  const confirmSettlement = settlements.find(
    (s) => s.id === confirmSettlementId,
  );
  const receiptSettlement = settlements.find((s) => s.id === vendorReceiptId);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 text-[#e8ebe9]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[#8a9]">
            Marketplace finance
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Vendor commissions &amp; payouts
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[#9aa]">
            Rules, sales, settlements, and adjustments. Accrued rates stay
            frozen on each sale.
          </p>
        </div>
        <Link href="/vendors" className="text-sm text-[#9dcdb4] underline">
          Manage vendors
        </Link>
      </div>

      {message ? (
        <p className="border border-[#2f6b4f]/50 bg-[#2f6b4f]/15 px-3 py-2 text-sm text-[#9dcdb4]">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="border border-[#8a3a3a]/50 bg-[#8a3a3a]/15 px-3 py-2 text-sm text-[#f0a0a0]">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1 border-b border-[#2a332e] pb-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm ${
              tab === t.id
                ? "border-b-2 border-[#3d8f6a] text-[#e8ebe9]"
                : "text-[#8a9] hover:text-[#cfc]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Shared filter strip for sales/overview/analytics */}
      {(tab === "overview" ||
        tab === "sales" ||
        tab === "analytics" ||
        tab === "settlements") && (
        <section className="space-y-3 border border-[#2a332e] bg-[#121816] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">Filters</h2>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={applyFilters}
                className="border border-[#3d8f6a] bg-[#1a2e24] px-3 py-1.5 text-xs"
              >
                Apply
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={clearFilters}
                className="border border-[#3a443e] px-3 py-1.5 text-xs text-[#9aa]"
              >
                Clear filters
              </button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="relative block text-xs text-[#9aa]">
              Vendor
              <input
                className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm text-[#e8ebe9]"
                value={filters.vendorQ}
                placeholder="Search vendor…"
                onChange={(e) => onVendorSearch(e.target.value)}
              />
              {vendorSuggestions.length > 0 ? (
                <ul className="absolute z-10 mt-1 max-h-40 w-full overflow-auto border border-[#2a332e] bg-[#0d110f]">
                  {vendorSuggestions.map((v) => (
                    <li key={v.id}>
                      <button
                        type="button"
                        className="block w-full px-2 py-1.5 text-left text-sm hover:bg-[#1a2e24]"
                        onClick={() => {
                          setFilters((f) => ({
                            ...f,
                            vendorId: v.id,
                            vendorQ: v.displayName,
                          }));
                          setVendorSuggestions([]);
                        }}
                      >
                        {v.displayName}{" "}
                        <span className="text-[#666]">{v.vendorCode}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </label>
            <label className="block text-xs text-[#9aa]">
              From
              <input
                type="date"
                className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                value={filters.dateFrom}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, dateFrom: e.target.value }))
                }
              />
            </label>
            <label className="block text-xs text-[#9aa]">
              To
              <input
                type="date"
                className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                value={filters.dateTo}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, dateTo: e.target.value }))
                }
              />
            </label>
            <label className="block text-xs text-[#9aa]">
              Payout state
              <select
                className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                value={filters.payoutState}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, payoutState: e.target.value }))
                }
              >
                <option value="">All</option>
                <option value="unpaid">Unpaid</option>
                <option value="settlement_pending">Awaiting remittance</option>
                <option value="paid">Paid</option>
              </select>
            </label>
            <label className="block text-xs text-[#9aa]">
              Order #
              <input
                className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                value={filters.orderNumber}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, orderNumber: e.target.value }))
                }
              />
            </label>
            <label className="block text-xs text-[#9aa]">
              Settlement #
              <input
                className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                value={filters.settlementNumber}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    settlementNumber: e.target.value,
                  }))
                }
              />
            </label>
            <label className="block text-xs text-[#9aa]">
              Channel
              <select
                className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                value={filters.channel}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, channel: e.target.value }))
                }
              >
                <option value="">All</option>
                <option value="web">Web</option>
                <option value="admin">Admin</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="phone">Phone</option>
              </select>
            </label>
            <label className="block text-xs text-[#9aa]">
              Sort
              <select
                className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                value={filters.sort}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, sort: e.target.value }))
                }
              >
                <option value="date_desc">Newest</option>
                <option value="date_asc">Oldest</option>
                <option value="gross_desc">Gross ↓</option>
                <option value="commission_desc">Commission ↓</option>
                <option value="vendor">Vendor</option>
              </select>
            </label>
          </div>
        </section>
      )}

      {tab === "overview" && summary ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Gross sales", summary.grossSales, "ETB"],
            ["Accrued commission", summary.accruedCommission, "ETB"],
            ["Avg effective rate", summary.avgEffectiveRatePct, "%"],
            ["Outstanding liability", summary.outstandingLiability, "ETB"],
            ["Unpaid to vendors", summary.unpaidNet, "ETB"],
            ["Adjustments approved", summary.adjustmentsApproved, "ETB"],
          ].map(([label, value, unit]) => (
            <div
              key={String(label)}
              className="border border-[#2a332e] bg-[#121816] p-4"
            >
              <p className="text-xs uppercase tracking-wide text-[#8a9]">
                {label}
              </p>
              <p className="mt-2 text-2xl tabular-nums">
                {Number(value).toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}{" "}
                <span className="text-sm text-[#8a9]">{unit}</span>
              </p>
            </div>
          ))}
          {summary.priorPeriod ? (
            <div className="border border-[#2a332e] bg-[#121816] p-4 sm:col-span-2 lg:col-span-3">
              <p className="text-xs text-[#8a9]">vs prior period</p>
              <p className="mt-1 text-sm">
                Gross{" "}
                {summary.priorPeriod.deltaGrossPct != null
                  ? `${summary.priorPeriod.deltaGrossPct > 0 ? "+" : ""}${summary.priorPeriod.deltaGrossPct}%`
                  : "n/a"}
                {" · "}
                Commission{" "}
                {summary.priorPeriod.deltaCommissionPct != null
                  ? `${summary.priorPeriod.deltaCommissionPct > 0 ? "+" : ""}${summary.priorPeriod.deltaCommissionPct}%`
                  : "n/a"}
              </p>
            </div>
          ) : null}
          <div className="border border-[#2a332e] bg-[#121816] p-4 sm:col-span-2 lg:col-span-3">
            <p className="text-sm">
              Global default:{" "}
              <strong>{rule?.ratePct ?? "—"}%</strong> ({rule?.code})
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="border border-[#3a443e] px-3 py-1.5 text-xs"
                onClick={() => exportType("sales")}
              >
                Export sales CSV
              </button>
              <button
                type="button"
                className="border border-[#3a443e] px-3 py-1.5 text-xs"
                onClick={() => exportType("settlements")}
              >
                Export settlements CSV
              </button>
              <button
                type="button"
                className="border border-[#3a443e] px-3 py-1.5 text-xs"
                onClick={() => setTab("analytics")}
              >
                Open analytics
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {tab === "sales" ? (
        <section className="space-y-4">
          <div className="overflow-x-auto border border-[#2a332e]">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-[#121816] text-xs uppercase text-[#8a9]">
                <tr>
                  <th className="px-3 py-2">Order</th>
                  <th className="px-3 py-2">Vendor</th>
                  <th className="px-3 py-2">Products</th>
                  <th className="px-3 py-2 text-right">Gross</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-right">Fee</th>
                  <th className="px-3 py-2 text-right">Net</th>
                  <th className="px-3 py-2">Payout</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-[#2a332e]">
                    <td className="px-3 py-2">{r.orderNumber}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-[#9dcdb4] underline"
                        onClick={() => setDetailVendorId(r.vendorId)}
                      >
                        {r.vendorName}
                      </button>
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2 text-[#9aa]">
                      {r.productSummary ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.grossAmount.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.ratePct}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.commissionAmount.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.netPayable.toFixed(2)}
                    </td>
                    <td className="px-3 py-2">{payoutBadge(r.payoutState)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length ? (
              <p className="p-4 text-sm text-[#888]">No sales match filters.</p>
            ) : null}
          </div>

          {detailVendorId && vendorDetail ? (
            <div className="border border-[#3d8f6a]/40 bg-[#121816] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-medium">
                    {vendorDetail.vendor.displayName}
                  </h3>
                  <p className="text-xs text-[#8a9]">
                    {vendorDetail.vendor.vendorCode} ·{" "}
                    {vendorDetail.vendor.status}
                    {vendorDetail.vendor.phone
                      ? ` · ${vendorDetail.vendor.phone}`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-xs text-[#8a9]"
                  onClick={() => setDetailVendorId(null)}
                >
                  Close
                </button>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-4 text-sm">
                <div>
                  Gross{" "}
                  <strong>
                    {vendorDetail.summary.grossSales.toFixed(0)}
                  </strong>
                </div>
                <div>
                  Commission{" "}
                  <strong>
                    {vendorDetail.summary.accruedCommission.toFixed(0)}
                  </strong>
                </div>
                <div>
                  Outstanding{" "}
                  <strong>
                    {vendorDetail.summary.outstandingLiability.toFixed(0)}
                  </strong>
                </div>
                <div>
                  Avg rate{" "}
                  <strong>
                    {vendorDetail.summary.avgEffectiveRatePct}%
                  </strong>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "rules" ? (
        <section className="space-y-6">
          <div className="border border-[#2a332e] bg-[#121816] p-4">
            <h2 className="text-sm font-medium">Global default rate</h2>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="text-xs text-[#9aa]">
                Rate %
                <input
                  className="mt-1 block w-28 border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                  value={globalRateDraft}
                  onChange={(e) => setGlobalRateDraft(e.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={saveGlobalRate}
                className="border border-[#3d8f6a] bg-[#1a2e24] px-3 py-1.5 text-sm"
              >
                Save default
              </button>
              <p className="text-xs text-[#8a9]">
                Does not rewrite past commission entries.
              </p>
            </div>
          </div>

          <form
            onSubmit={createRule}
            className="space-y-3 border border-[#2a332e] bg-[#121816] p-4"
          >
            <h2 className="text-sm font-medium">New rule</h2>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p.code}
                  type="button"
                  className="border border-[#3a443e] px-2 py-1 text-xs"
                  onClick={() =>
                    setRuleForm((f) => ({
                      ...f,
                      name: p.name,
                      kind: p.kind as "event",
                      scope: "global",
                    }))
                  }
                >
                  {p.name}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs text-[#9aa]">
                Name
                <input
                  required
                  className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                  value={ruleForm.name}
                  onChange={(e) =>
                    setRuleForm((f) => ({ ...f, name: e.target.value }))
                  }
                />
              </label>
              <label className="text-xs text-[#9aa]">
                Scope
                <select
                  className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                  value={ruleForm.scope}
                  onChange={(e) =>
                    setRuleForm((f) => ({
                      ...f,
                      scope: e.target.value as typeof f.scope,
                    }))
                  }
                >
                  <option value="global">Global</option>
                  <option value="vendor">Vendor</option>
                  <option value="category">Category</option>
                </select>
              </label>
              <label className="text-xs text-[#9aa]">
                Kind
                <select
                  className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                  value={ruleForm.kind}
                  onChange={(e) =>
                    setRuleForm((f) => ({
                      ...f,
                      kind: e.target.value as typeof f.kind,
                    }))
                  }
                >
                  <option value="standard">Standard</option>
                  <option value="promo">Promo</option>
                  <option value="event">Event</option>
                </select>
              </label>
              <label className="text-xs text-[#9aa]">
                Rate %
                <input
                  required
                  className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                  value={ruleForm.ratePct}
                  onChange={(e) =>
                    setRuleForm((f) => ({ ...f, ratePct: e.target.value }))
                  }
                />
              </label>
              {ruleForm.scope === "vendor" ? (
                <label className="text-xs text-[#9aa]">
                  Vendor
                  <select
                    required
                    className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                    value={ruleForm.vendorId}
                    onChange={(e) =>
                      setRuleForm((f) => ({ ...f, vendorId: e.target.value }))
                    }
                  >
                    <option value="">Select…</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {ruleForm.scope === "category" ? (
                <label className="text-xs text-[#9aa]">
                  Category
                  <select
                    required
                    className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                    value={ruleForm.categoryId}
                    onChange={(e) =>
                      setRuleForm((f) => ({
                        ...f,
                        categoryId: e.target.value,
                      }))
                    }
                  >
                    <option value="">Select…</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="text-xs text-[#9aa]">
                Valid from (Ethiopia local)
                <input
                  type="datetime-local"
                  className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                  value={ruleForm.validFrom}
                  onChange={(e) =>
                    setRuleForm((f) => ({ ...f, validFrom: e.target.value }))
                  }
                />
              </label>
              <label className="text-xs text-[#9aa]">
                Valid to
                <input
                  type="datetime-local"
                  className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                  value={ruleForm.validTo}
                  onChange={(e) =>
                    setRuleForm((f) => ({ ...f, validTo: e.target.value }))
                  }
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-xs text-[#9aa]">
              <input
                type="checkbox"
                checked={ruleForm.confirmLargeChange}
                onChange={(e) =>
                  setRuleForm((f) => ({
                    ...f,
                    confirmLargeChange: e.target.checked,
                  }))
                }
              />
              Confirm large rate change (≥1pp)
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={runPreview}
                className="border border-[#3a443e] px-3 py-1.5 text-sm"
              >
                Preview impact
              </button>
              <button
                type="submit"
                disabled={busy}
                className="border border-[#3d8f6a] bg-[#1a2e24] px-3 py-1.5 text-sm"
              >
                Create rule
              </button>
            </div>
            {previewImpact ? (
              <p className="text-xs text-[#9aa]">
                Est. commission at {ruleForm.ratePct}%:{" "}
                {previewImpact.estimatedCommissionAtRate.toFixed(2)} ETB (Δ{" "}
                {previewImpact.delta.toFixed(2)}). {previewImpact.note}
              </p>
            ) : null}
          </form>

          <div className="overflow-x-auto border border-[#2a332e]">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="bg-[#121816] text-xs uppercase text-[#8a9]">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Scope</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Priority</th>
                  <th className="px-3 py-2">Rate</th>
                  <th className="px-3 py-2">Window</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-t border-[#2a332e]">
                    <td className="px-3 py-2">
                      {r.name}
                      <div className="text-[11px] text-[#666]">{r.code}</div>
                    </td>
                    <td className="px-3 py-2">
                      {r.scope}
                      {r.vendorName ? ` · ${r.vendorName}` : ""}
                      {r.categoryName ? ` · ${r.categoryName}` : ""}
                    </td>
                    <td className="px-3 py-2">{r.kind}</td>
                    <td className="px-3 py-2">{r.priority}</td>
                    <td className="px-3 py-2">{r.ratePct}%</td>
                    <td className="px-3 py-2 text-xs text-[#9aa]">
                      {new Date(r.validFrom).toLocaleDateString()}
                      {r.validTo
                        ? ` → ${new Date(r.validTo).toLocaleDateString()}`
                        : " → ∞"}
                    </td>
                    <td className="px-3 py-2">
                      {r.archivedAt
                        ? "Archived"
                        : r.isEnabled
                          ? "Active"
                          : "Disabled"}
                    </td>
                    <td className="px-3 py-2">
                      {!r.archivedAt ? (
                        <button
                          type="button"
                          className="text-xs text-[#f0a0a0]"
                          disabled={busy}
                          onClick={async () => {
                            if (!token) return;
                            await adminApi.archiveCommissionRule(token, r.id);
                            await refresh(token);
                          }}
                        >
                          Archive
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === "settlements" ? (
        <section className="space-y-6">
          <div className="border border-[#2a332e] bg-[#121816] p-4">
            <h2 className="text-sm font-medium">Create settlement</h2>
            <div className="mt-3 flex flex-wrap gap-3">
              <select
                className="border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                value={settleVendorId}
                onChange={(e) => setSettleVendorId(e.target.value)}
              >
                <option value="">Select vendor with unpaid sales…</option>
                {[
                  ...new Map(
                    unpaidRows.map((r) => [r.vendorId, r.vendorName]),
                  ).entries(),
                ].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !previewItems.length}
                onClick={settleVendor}
                className="border border-[#3d8f6a] bg-[#1a2e24] px-3 py-1.5 text-sm disabled:opacity-40"
              >
                Create settlement ({previewItems.length} lines ·{" "}
                {previewTotals.net.toFixed(2)} ETB)
              </button>
            </div>
            {settleVendorId ? (
              <div className="mt-3 max-h-48 overflow-auto text-xs">
                {unpaidRows
                  .filter((r) => r.vendorId === settleVendorId)
                  .map((r) => (
                    <label
                      key={r.id}
                      className="flex items-center gap-2 border-t border-[#2a332e] py-1"
                    >
                      <input
                        type="checkbox"
                        checked={selectedEntryIds.includes(r.id)}
                        onChange={() =>
                          setSelectedEntryIds((prev) =>
                            prev.includes(r.id)
                              ? prev.filter((x) => x !== r.id)
                              : [...prev, r.id],
                          )
                        }
                      />
                      {r.orderNumber} · {r.netPayable.toFixed(2)} ETB
                    </label>
                  ))}
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            {settlements.map((s) => (
              <div
                key={s.id}
                className="border border-[#2a332e] bg-[#121816] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{s.settlementNumber}</p>
                    <p className="text-sm text-[#9aa]">
                      {s.vendorName} · {s.periodStart} → {s.periodEnd} ·{" "}
                      {formatLabel(s.status)}
                    </p>
                    <p className="mt-1 text-sm tabular-nums">
                      Net {s.netPayable.toFixed(2)} ETB
                      {s.amountPaid != null
                        ? ` · Paid ${s.amountPaid.toFixed(2)} · Due ${(s.balanceDue ?? 0).toFixed(2)}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!["paid", "cancelled"].includes(s.status) ? (
                      <>
                        <button
                          type="button"
                          className="border border-[#3d8f6a] px-2 py-1 text-xs"
                          onClick={() => openConfirm(s.id)}
                        >
                          Record payment
                        </button>
                        <button
                          type="button"
                          className="border border-[#8a3a3a] px-2 py-1 text-xs text-[#f0a0a0]"
                          disabled={busy}
                          onClick={async () => {
                            if (!token) return;
                            await adminApi.cancelSettlement(token, s.id);
                            await refresh(token);
                            setMessage("Settlement cancelled.");
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="border border-[#3a443e] px-2 py-1 text-xs"
                      onClick={() => setVendorReceiptId(s.id)}
                    >
                      Receipt
                    </button>
                    <button
                      type="button"
                      className="border border-[#3a443e] px-2 py-1 text-xs"
                      onClick={() => copyVendorReceipt(s)}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      className="border border-[#3a443e] px-2 py-1 text-xs"
                      onClick={() => printVendorReceipt(s)}
                    >
                      Print / PDF
                    </button>
                    <button
                      type="button"
                      className="border border-[#3a443e] px-2 py-1 text-xs"
                      disabled={busy}
                      onClick={() => sendWhatsApp(s)}
                    >
                      WhatsApp
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {confirmSettlementId && confirmSettlement ? (
            <form
              onSubmit={confirmPaid}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            >
              <div className="w-full max-w-md space-y-3 border border-[#2a332e] bg-[#121816] p-5">
                <h3 className="text-lg font-medium">
                  Payment · {confirmSettlement.settlementNumber}
                </h3>
                <label className="block text-xs text-[#9aa]">
                  Amount (ETB)
                  <input
                    required
                    className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                    value={partialAmount}
                    onChange={(e) => setPartialAmount(e.target.value)}
                  />
                </label>
                <label className="block text-xs text-[#9aa]">
                  Paid date
                  <input
                    type="date"
                    required
                    className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                    value={paidAt}
                    onChange={(e) => setPaidAt(e.target.value)}
                  />
                </label>
                <label className="block text-xs text-[#9aa]">
                  Reference
                  <input
                    className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                    value={payoutReference}
                    onChange={(e) => setPayoutReference(e.target.value)}
                  />
                </label>
                <label className="block text-xs text-[#9aa]">
                  Receipt image
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="mt-1 block w-full text-sm"
                    onChange={(e) =>
                      onReceiptSelected(e.target.files?.[0] ?? null)
                    }
                  />
                  {receiptName ? (
                    <span className="text-[#9dcdb4]">{receiptName}</span>
                  ) : null}
                </label>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    className="px-3 py-1.5 text-sm text-[#8a9]"
                    onClick={() => setConfirmSettlementId(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="border border-[#3d8f6a] bg-[#1a2e24] px-3 py-1.5 text-sm"
                  >
                    Save payment
                  </button>
                </div>
              </div>
            </form>
          ) : null}

          {receiptSettlement ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="max-h-[90vh] w-full max-w-lg overflow-auto border border-[#2a332e] bg-[#121816] p-5">
                <div className="flex justify-between">
                  <h3 className="font-medium">Vendor receipt</h3>
                  <button
                    type="button"
                    className="text-xs text-[#8a9]"
                    onClick={() => setVendorReceiptId(null)}
                  >
                    Close
                  </button>
                </div>
                <pre className="mt-3 whitespace-pre-wrap text-xs text-[#cfc]">
                  {formatVendorReceipt(receiptSettlement)}
                </pre>
                {receiptSettlement.payoutReceiptUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt="Payout proof"
                    className="mt-3 max-h-48 border border-[#2a332e]"
                    src={`${API_URL}${receiptSettlement.payoutReceiptUrl}`}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "adjustments" ? (
        <section className="space-y-6">
          <form
            onSubmit={createAdj}
            className="space-y-3 border border-[#2a332e] bg-[#121816] p-4"
          >
            <h2 className="text-sm font-medium">New adjustment</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-[#9aa]">
                Vendor
                <select
                  required
                  className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                  value={adjForm.vendorId}
                  onChange={(e) =>
                    setAdjForm((f) => ({ ...f, vendorId: e.target.value }))
                  }
                >
                  <option value="">Select…</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-[#9aa]">
                Type
                <select
                  className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                  value={adjForm.adjustmentType}
                  onChange={(e) =>
                    setAdjForm((f) => ({
                      ...f,
                      adjustmentType: e.target.value,
                    }))
                  }
                >
                  <option value="settlement_correction">
                    Settlement correction
                  </option>
                  <option value="commission_discount">
                    Commission discount
                  </option>
                  <option value="commission_credit">Commission credit</option>
                  <option value="vendor_bonus">Vendor bonus</option>
                  <option value="vendor_deduction">Vendor deduction</option>
                  <option value="refund_related">Refund related</option>
                  <option value="accounting_correction">
                    Accounting correction
                  </option>
                </select>
              </label>
              <label className="text-xs text-[#9aa]">
                Amount (ETB, signed)
                <input
                  required
                  className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                  value={adjForm.adjustmentAmount}
                  onChange={(e) =>
                    setAdjForm((f) => ({
                      ...f,
                      adjustmentAmount: e.target.value,
                    }))
                  }
                />
              </label>
              <label className="text-xs text-[#9aa] sm:col-span-2">
                Reason
                <input
                  required
                  className="mt-1 w-full border border-[#2a332e] bg-[#0d110f] px-2 py-1.5 text-sm"
                  value={adjForm.reason}
                  onChange={(e) =>
                    setAdjForm((f) => ({ ...f, reason: e.target.value }))
                  }
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-xs text-[#9aa]">
              <input
                type="checkbox"
                checked={adjForm.confirmLargeChange}
                onChange={(e) =>
                  setAdjForm((f) => ({
                    ...f,
                    confirmLargeChange: e.target.checked,
                  }))
                }
              />
              Confirm large adjustment (≥5000 ETB)
            </label>
            <button
              type="submit"
              disabled={busy}
              className="border border-[#3d8f6a] bg-[#1a2e24] px-3 py-1.5 text-sm"
            >
              Submit adjustment
            </button>
          </form>

          <div className="overflow-x-auto border border-[#2a332e]">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-[#121816] text-xs uppercase text-[#8a9]">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Vendor</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {adjustments.map((a) => (
                  <tr key={a.id} className="border-t border-[#2a332e]">
                    <td className="px-3 py-2">{a.adjustmentNumber}</td>
                    <td className="px-3 py-2">{a.vendorName}</td>
                    <td className="px-3 py-2">{formatLabel(a.adjustmentType)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {a.adjustmentAmount.toFixed(2)}
                    </td>
                    <td className="px-3 py-2">{formatLabel(a.status)}</td>
                    <td className="space-x-2 px-3 py-2">
                      {a.status === "pending" ? (
                        <>
                          <button
                            type="button"
                            className="text-xs text-[#9dcdb4]"
                            disabled={busy}
                            onClick={async () => {
                              if (!token) return;
                              await adminApi.approveAdjustment(token, a.id);
                              await refresh(token);
                            }}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="text-xs text-[#f0a0a0]"
                            disabled={busy}
                            onClick={async () => {
                              if (!token) return;
                              await adminApi.voidAdjustment(token, a.id);
                              await refresh(token);
                            }}
                          >
                            Void
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === "analytics" ? (
        <section className="space-y-6">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="border border-[#3a443e] px-3 py-1.5 text-xs"
              onClick={() => exportType("sales")}
            >
              CSV sales
            </button>
            <button
              type="button"
              className="border border-[#3a443e] px-3 py-1.5 text-xs"
              onClick={() => exportType("settlements")}
            >
              CSV settlements
            </button>
            <button
              type="button"
              className="border border-[#3a443e] px-3 py-1.5 text-xs"
              onClick={() => exportType("adjustments")}
            >
              CSV adjustments
            </button>
            <button
              type="button"
              className="border border-[#3a443e] px-3 py-1.5 text-xs"
              onClick={() => exportType("rules")}
            >
              CSV rules
            </button>
          </div>
          {!analytics ? (
            <p className="text-sm text-[#888]">Loading analytics…</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="border border-[#2a332e] bg-[#121816] p-4">
                <h3 className="mb-3 text-sm font-medium">Commission trend</h3>
                <SimpleBarChart
                  data={analytics.commissionTrend}
                  labelKey="month"
                  valueKey="commission"
                />
              </div>
              <div className="border border-[#2a332e] bg-[#121816] p-4">
                <h3 className="mb-3 text-sm font-medium">Vendor sales compare</h3>
                <SimpleBarChart
                  data={analytics.vendorCompare}
                  labelKey="vendorName"
                  valueKey="grossSales"
                  color="#6a9ccc"
                />
              </div>
              <div className="border border-[#2a332e] bg-[#121816] p-4">
                <h3 className="mb-3 text-sm font-medium">Rate distribution</h3>
                <SimpleBarChart
                  data={analytics.rateDistribution}
                  labelKey="rate"
                  valueKey="count"
                  color="#c9a86a"
                />
              </div>
              <div className="border border-[#2a332e] bg-[#121816] p-4">
                <h3 className="mb-3 text-sm font-medium">
                  Settlement performance
                </h3>
                <ul className="space-y-1 text-sm">
                  <li>Total: {analytics.settlementPerformance.total}</li>
                  <li>Paid: {analytics.settlementPerformance.paid}</li>
                  <li>Partial: {analytics.settlementPerformance.partial}</li>
                  <li>Pending: {analytics.settlementPerformance.pending}</li>
                  <li>
                    Avg days to pay:{" "}
                    {analytics.settlementPerformance.avgDaysToPay ?? "—"}
                  </li>
                </ul>
                <h4 className="mb-2 mt-4 text-xs uppercase text-[#8a9]">
                  Top vendors by commission
                </h4>
                <SimpleBarChart
                  data={analytics.topVendors}
                  labelKey="vendorName"
                  valueKey="commission"
                />
              </div>
            </div>
          )}
        </section>
      ) : null}

      {tab === "audit" ? (
        <section className="overflow-x-auto border border-[#2a332e]">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="bg-[#121816] text-xs uppercase text-[#8a9]">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Entity</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Actor</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} className="border-t border-[#2a332e]">
                  <td className="px-3 py-2 text-xs text-[#9aa]">
                    {new Date(a.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    {a.entityType}
                    <div className="text-[11px] text-[#666]">{a.entityId}</div>
                  </td>
                  <td className="px-3 py-2">{a.action}</td>
                  <td className="px-3 py-2 text-xs">{a.actorId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!audit.length ? (
            <p className="p-4 text-sm text-[#888]">No audit events yet.</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
