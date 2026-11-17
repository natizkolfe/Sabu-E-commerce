/** Default priority ladder (higher wins; no stacking). */
export function defaultRulePriority(
  scope: 'global' | 'vendor' | 'category',
  kind: 'standard' | 'promo' | 'event',
): number {
  if (scope === 'vendor' && kind === 'promo') return 100;
  if (scope === 'vendor') return 80;
  if (scope === 'category' && kind === 'promo') return 60;
  if (scope === 'category') return 40;
  if (scope === 'global' && (kind === 'promo' || kind === 'event')) return 20;
  return 10;
}

export function money2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function commissionFromGross(gross: number, ratePct: number): number {
  return money2((gross * ratePct) / 100);
}

/**
 * Single source of truth for payout badges + summary math.
 * Vendor net still owed unless the settlement is fully paid.
 */
export function resolvePayoutState(opts: {
  entryStatus: string;
  settlementId: string | null;
  settlementStatus: string | null;
}): 'unpaid' | 'settlement_pending' | 'paid' {
  const stl = opts.settlementStatus;
  if (stl === 'paid') return 'paid';
  if (stl === 'cancelled' || !opts.settlementId) {
    // Orphan paid_out (cancelled settlement, or bad backfill) still counts as unpaid
    return 'unpaid';
  }
  // draft | approved | pending_payment | partially_paid | adjustment_required
  return 'settlement_pending';
}

export type ResolvedCommissionRate = {
  ruleId: string | null;
  code: string;
  ratePct: number;
  scope: string;
  kind: string;
  priority: number;
  source: 'rule' | 'vendor_override' | 'fallback';
};

export const ETHIOPIA_TZ = 'Africa/Addis_Ababa';

export const RULE_PRESETS = [
  { code: 'ENKUTATASH', name: 'Enkutatash (Ethiopian New Year)', kind: 'event' as const },
  { code: 'GENNA', name: 'Genna (Ethiopian Christmas)', kind: 'event' as const },
  { code: 'TIMKET', name: 'Timket', kind: 'event' as const },
  { code: 'FASIKA', name: 'Fasika (Ethiopian Easter)', kind: 'event' as const },
  { code: 'DEMAND-SURGE', name: 'Peak demand event', kind: 'event' as const },
];
