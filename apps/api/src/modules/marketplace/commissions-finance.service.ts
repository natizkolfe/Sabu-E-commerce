import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import type { AuthUser } from '../iam/auth.types';
import { WhatsAppService } from '../notify/whatsapp.service';
import {
  commissionFromGross,
  defaultRulePriority,
  ETHIOPIA_TZ,
  money2,
  resolvePayoutState,
  RULE_PRESETS,
  type ResolvedCommissionRate,
} from './commission-engine';

export type CommissionSalesFilter = {
  vendorId?: string;
  categoryId?: string;
  status?: string;
  payoutState?: string;
  dateFrom?: string;
  dateTo?: string;
  rateMin?: number;
  rateMax?: number;
  amountMin?: number;
  amountMax?: number;
  orderNumber?: string;
  settlementNumber?: string;
  channel?: string;
  sort?: string;
  limit?: number;
};

@Injectable()
export class CommissionsFinanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  // ——— Audit ———
  private auditSql = `INSERT INTO marketplace.commission_audit_log
         (entity_type, entity_id, action, actor_id, before_json, after_json, note)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`;

  private auditParams(opts: {
    entityType: string;
    entityId: string;
    action: string;
    actorId?: string | null;
    before?: unknown;
    after?: unknown;
    note?: string;
  }) {
    return [
      opts.entityType,
      opts.entityId,
      opts.action,
      opts.actorId ?? null,
      opts.before != null ? JSON.stringify(opts.before) : null,
      opts.after != null ? JSON.stringify(opts.after) : null,
      opts.note ?? null,
    ];
  }

  async writeAudit(
    opts: {
      entityType: string;
      entityId: string;
      action: string;
      actorId?: string | null;
      before?: unknown;
      after?: unknown;
      note?: string;
    },
    client?: PoolClient,
  ) {
    if (client) {
      await client.query(this.auditSql, this.auditParams(opts));
    } else {
      await this.db.query(this.auditSql, this.auditParams(opts));
    }
  }

  // ——— Rule resolution ———
  async resolveCommissionRate(opts: {
    vendorId: string;
    categoryId?: string | null;
    at?: Date;
  }): Promise<ResolvedCommissionRate> {
    const at = opts.at ?? new Date();
    const params: unknown[] = [at.toISOString(), opts.vendorId];
    let categoryClause = 'FALSE';
    if (opts.categoryId) {
      params.push(opts.categoryId);
      categoryClause = `scope = 'category' AND category_id = $${params.length}`;
    }

    const { rows } = await this.db.query<{
      id: string;
      code: string;
      rate_pct: string;
      scope: string;
      kind: string;
      priority: number;
    }>(
      `SELECT id, code, rate_pct::text, scope, kind, priority
       FROM marketplace.commission_rules
       WHERE COALESCE(is_enabled, is_active) = true
         AND archived_at IS NULL
         AND valid_from <= $1::timestamptz
         AND (valid_to IS NULL OR valid_to >= $1::timestamptz)
         AND (
           (scope = 'vendor' AND vendor_id = $2)
           OR (${categoryClause})
           OR scope = 'global'
         )
       ORDER BY priority DESC, valid_from DESC
       LIMIT 1`,
      params,
    );

    if (rows[0]) {
      return {
        ruleId: rows[0].id,
        code: rows[0].code,
        ratePct: Number(rows[0].rate_pct),
        scope: rows[0].scope,
        kind: rows[0].kind,
        priority: rows[0].priority,
        source: 'rule',
      };
    }

    const { rows: vendors } = await this.db.query<{
      commission_rate_pct: string | null;
    }>(
      `SELECT commission_rate_pct::text FROM marketplace.vendors WHERE id = $1`,
      [opts.vendorId],
    );
    if (vendors[0]?.commission_rate_pct != null) {
      return {
        ruleId: null,
        code: 'VENDOR-OVERRIDE',
        ratePct: Number(vendors[0].commission_rate_pct),
        scope: 'vendor',
        kind: 'standard',
        priority: 80,
        source: 'vendor_override',
      };
    }

    return {
      ruleId: null,
      code: 'FALLBACK-2PCT',
      ratePct: 2,
      scope: 'global',
      kind: 'standard',
      priority: 0,
      source: 'fallback',
    };
  }

  mapRule(r: Record<string, unknown>) {
    return {
      id: r.id as string,
      code: r.code as string,
      name: (r.name as string) ?? (r.code as string),
      scope: r.scope as string,
      kind: (r.kind as string) ?? 'standard',
      priority: Number(r.priority ?? 10),
      vendorId: (r.vendor_id as string) ?? null,
      vendorName: (r.vendor_name as string) ?? null,
      categoryId: (r.category_id as string) ?? null,
      categoryName: (r.category_name as string) ?? null,
      ratePct: Number(r.rate_pct),
      appliesTo: (r.applies_to as string) ?? 'merchandise',
      timezone: (r.timezone as string) ?? ETHIOPIA_TZ,
      isActive: Boolean(r.is_active),
      isEnabled: r.is_enabled != null ? Boolean(r.is_enabled) : Boolean(r.is_active),
      archivedAt: (r.archived_at as Date) ?? null,
      validFrom: r.valid_from as Date,
      validTo: (r.valid_to as Date) ?? null,
      notes: (r.notes as string) ?? null,
      createdAt: r.created_at as Date,
    };
  }

  async listCommissionRules(opts?: {
    includeArchived?: boolean;
    scope?: string;
  }) {
    const where = ['TRUE'];
    const params: unknown[] = [];
    if (!opts?.includeArchived) {
      where.push('r.archived_at IS NULL');
    }
    if (opts?.scope) {
      params.push(opts.scope);
      where.push(`r.scope = $${params.length}`);
    }
    const { rows } = await this.db.query(
      `SELECT r.id, r.code, r.name, r.scope, r.kind, r.priority, r.vendor_id,
              v.display_name AS vendor_name, r.category_id, c.name AS category_name,
              r.rate_pct::text, r.applies_to, r.timezone, r.is_active, r.is_enabled,
              r.archived_at, r.valid_from, r.valid_to, r.notes, r.created_at
       FROM marketplace.commission_rules r
       LEFT JOIN marketplace.vendors v ON v.id = r.vendor_id
       LEFT JOIN catalog.categories c ON c.id = r.category_id
       WHERE ${where.join(' AND ')}
       ORDER BY r.priority DESC, r.valid_from DESC`,
      params,
    );
    return rows.map((r) => this.mapRule(r as Record<string, unknown>));
  }

  async getRuleConflicts(body: {
    scope: string;
    vendorId?: string | null;
    categoryId?: string | null;
    priority: number;
    validFrom: string;
    validTo?: string | null;
    excludeId?: string;
  }) {
    const params: unknown[] = [
      body.scope,
      body.priority,
      body.validFrom,
      body.validTo ?? null,
    ];
    let scopeMatch = `scope = $1`;
    if (body.scope === 'vendor') {
      params.push(body.vendorId);
      scopeMatch += ` AND vendor_id = $${params.length}`;
    } else if (body.scope === 'category') {
      params.push(body.categoryId);
      scopeMatch += ` AND category_id = $${params.length}`;
    } else {
      scopeMatch += ` AND vendor_id IS NULL AND category_id IS NULL`;
    }
    let exclude = '';
    if (body.excludeId) {
      params.push(body.excludeId);
      exclude = ` AND id <> $${params.length}`;
    }
    const { rows } = await this.db.query(
      `SELECT id, code, name, priority, valid_from, valid_to, rate_pct::text
       FROM marketplace.commission_rules
       WHERE archived_at IS NULL
         AND COALESCE(is_enabled, is_active) = true
         AND ${scopeMatch}
         AND priority = $2
         AND valid_from <= COALESCE($4::timestamptz, 'infinity'::timestamptz)
         AND COALESCE(valid_to, 'infinity'::timestamptz) >= $3::timestamptz
         ${exclude}`,
      params,
    );
    return rows.map((r) => ({
      id: r.id as string,
      code: r.code as string,
      name: (r.name as string) ?? r.code,
      priority: Number(r.priority),
      ratePct: Number(r.rate_pct),
      validFrom: r.valid_from,
      validTo: r.valid_to,
    }));
  }

  async createCommissionRule(
    user: AuthUser,
    body: {
      code?: string;
      name: string;
      scope: 'global' | 'vendor' | 'category';
      kind?: 'standard' | 'promo' | 'event';
      priority?: number;
      vendorId?: string;
      categoryId?: string;
      ratePct: number;
      appliesTo?: string;
      timezone?: string;
      validFrom?: string;
      validTo?: string | null;
      notes?: string;
      confirmLargeChange?: boolean;
    },
  ) {
    if (!body.name?.trim()) throw new BadRequestException('name is required');
    if (body.ratePct == null || body.ratePct < 0 || body.ratePct > 100) {
      throw new BadRequestException('ratePct must be 0–100');
    }
    const kind = body.kind ?? 'standard';
    const scope = body.scope;
    if (scope === 'vendor' && !body.vendorId) {
      throw new BadRequestException('vendorId required for vendor scope');
    }
    if (scope === 'category' && !body.categoryId) {
      throw new BadRequestException('categoryId required for category scope');
    }
    if (scope === 'global' && (body.vendorId || body.categoryId)) {
      throw new BadRequestException('global rules cannot have vendor/category');
    }
    const priority =
      body.priority ?? defaultRulePriority(scope, kind);
    const validFrom = body.validFrom ?? new Date().toISOString();
    const validTo = body.validTo ?? null;

    const conflicts = await this.getRuleConflicts({
      scope,
      vendorId: body.vendorId,
      categoryId: body.categoryId,
      priority,
      validFrom,
      validTo,
    });
    if (conflicts.length) {
      throw new BadRequestException({
        message: 'Overlapping same-priority rule exists for this scope',
        conflicts,
      });
    }

    if (
      Math.abs(body.ratePct - 2) >= 1 &&
      !body.confirmLargeChange &&
      scope === 'global'
    ) {
      throw new BadRequestException({
        message: 'Rate change ≥ 1pp from default requires confirmLargeChange',
        requiresConfirm: true,
        deltaPct: Math.abs(body.ratePct - 2),
      });
    }

    const code =
      body.code?.trim() ||
      `${scope.toUpperCase()}-${kind.toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;

    const { rows } = await this.db.query(
      `INSERT INTO marketplace.commission_rules (
         code, name, scope, kind, priority, vendor_id, category_id,
         rate_pct, applies_to, timezone, is_active, is_enabled,
         valid_from, valid_to, notes
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,true,$11::timestamptz,$12::timestamptz,$13
       )
       RETURNING id`,
      [
        code,
        body.name.trim(),
        scope,
        kind,
        priority,
        body.vendorId ?? null,
        body.categoryId ?? null,
        body.ratePct,
        body.appliesTo ?? 'merchandise',
        body.timezone ?? ETHIOPIA_TZ,
        validFrom,
        validTo,
        body.notes ?? null,
      ],
    );
    const id = rows[0].id as string;
    await this.writeAudit( {
      entityType: 'commission_rule',
      entityId: id,
      action: 'create',
      actorId: user.id,
      after: body,
    });
    const list = await this.listCommissionRules({ includeArchived: true });
    return list.find((r) => r.id === id)!;
  }

  async updateCommissionRule(
    user: AuthUser,
    id: string,
    body: {
      name?: string;
      kind?: 'standard' | 'promo' | 'event';
      priority?: number;
      ratePct?: number;
      appliesTo?: string;
      timezone?: string;
      validFrom?: string;
      validTo?: string | null;
      isEnabled?: boolean;
      notes?: string;
      confirmLargeChange?: boolean;
    },
  ) {
    const existing = (await this.listCommissionRules({ includeArchived: true })).find(
      (r) => r.id === id,
    );
    if (!existing) throw new NotFoundException('Rule not found');

    if (
      body.ratePct != null &&
      Math.abs(body.ratePct - existing.ratePct) >= 1 &&
      !body.confirmLargeChange
    ) {
      throw new BadRequestException({
        message: 'Rate change ≥ 1pp requires confirmLargeChange',
        requiresConfirm: true,
        deltaPct: Math.abs(body.ratePct - existing.ratePct),
      });
    }

    const nextPriority = body.priority ?? existing.priority;
    const nextFrom = body.validFrom ?? existing.validFrom.toISOString();
    const nextTo =
      body.validTo !== undefined
        ? body.validTo
        : existing.validTo
          ? existing.validTo.toISOString()
          : null;

    const conflicts = await this.getRuleConflicts({
      scope: existing.scope,
      vendorId: existing.vendorId,
      categoryId: existing.categoryId,
      priority: nextPriority,
      validFrom: nextFrom,
      validTo: nextTo,
      excludeId: id,
    });
    if (conflicts.length) {
      throw new BadRequestException({
        message: 'Overlapping same-priority rule exists for this scope',
        conflicts,
      });
    }

    const { rowCount } = await this.db.query(
      `UPDATE marketplace.commission_rules SET
         name = COALESCE($2, name),
         kind = COALESCE($3, kind),
         priority = COALESCE($4, priority),
         rate_pct = COALESCE($5, rate_pct),
         applies_to = COALESCE($6, applies_to),
         timezone = COALESCE($7, timezone),
         valid_from = COALESCE($8::timestamptz, valid_from),
         valid_to = CASE WHEN $9::text = '__UNSET__' THEN valid_to
                         WHEN $9 IS NULL THEN NULL
                         ELSE $9::timestamptz END,
         is_enabled = COALESCE($10, is_enabled),
         is_active = COALESCE($10, is_active),
         notes = COALESCE($11, notes),
         updated_at = now()
       WHERE id = $1`,
      [
        id,
        body.name ?? null,
        body.kind ?? null,
        body.priority ?? null,
        body.ratePct ?? null,
        body.appliesTo ?? null,
        body.timezone ?? null,
        body.validFrom ?? null,
        body.validTo === undefined ? '__UNSET__' : body.validTo,
        body.isEnabled ?? null,
        body.notes ?? null,
      ],
    );
    if (!rowCount) throw new NotFoundException('Rule not found');
    await this.writeAudit( {
      entityType: 'commission_rule',
      entityId: id,
      action: 'update',
      actorId: user.id,
      before: existing,
      after: body,
    });
    const list = await this.listCommissionRules({ includeArchived: true });
    return list.find((r) => r.id === id)!;
  }

  async archiveCommissionRule(user: AuthUser, id: string) {
    const { rowCount } = await this.db.query(
      `UPDATE marketplace.commission_rules
       SET archived_at = now(), is_enabled = false, is_active = false, updated_at = now()
       WHERE id = $1 AND archived_at IS NULL`,
      [id],
    );
    if (!rowCount) throw new NotFoundException('Rule not found or already archived');
    await this.writeAudit( {
      entityType: 'commission_rule',
      entityId: id,
      action: 'archive',
      actorId: user.id,
    });
    return { ok: true };
  }

  async patchGlobalDefault(
    user: AuthUser,
    body: { ratePct: number; confirmLargeChange?: boolean },
  ) {
    const current = await this.db.query<{ id: string; rate_pct: string }>(
      `SELECT id, rate_pct::text FROM marketplace.commission_rules
       WHERE scope = 'global' AND archived_at IS NULL
         AND COALESCE(is_enabled, is_active) = true
         AND kind = 'standard'
       ORDER BY priority ASC, valid_from DESC LIMIT 1`,
    );
    const row = current.rows[0];
    if (!row) {
      return this.createCommissionRule(user, {
        code: 'GLOBAL-2PCT',
        name: 'Global default',
        scope: 'global',
        kind: 'standard',
        priority: 10,
        ratePct: body.ratePct,
        confirmLargeChange: body.confirmLargeChange,
      });
    }
    return this.updateCommissionRule(user, row.id, {
      ratePct: body.ratePct,
      confirmLargeChange: body.confirmLargeChange,
    });
  }

  async previewRuleImpact(ruleId?: string, ratePct?: number) {
    const rate =
      ratePct ??
      (
        await this.db.query<{ rate_pct: string }>(
          `SELECT rate_pct::text FROM marketplace.commission_rules WHERE id = $1`,
          [ruleId],
        )
      ).rows[0];
    const pct = typeof rate === 'number' ? rate : Number(rate?.rate_pct ?? 2);
    const { rows } = await this.db.query<{
      entry_count: string;
      gross: string;
      current_commission: string;
    }>(
      `SELECT count(*)::text AS entry_count,
              COALESCE(sum(gross_amount),0)::text AS gross,
              COALESCE(sum(commission_amount),0)::text AS current_commission
       FROM marketplace.commission_entries
       WHERE settlement_id IS NULL AND status IN ('accrued','finalized')`,
    );
    const gross = Number(rows[0]?.gross ?? 0);
    const current = Number(rows[0]?.current_commission ?? 0);
    const estimated = commissionFromGross(gross, pct);
    return {
      unpaidEntryCount: Number(rows[0]?.entry_count ?? 0),
      unpaidGross: money2(gross),
      currentAccruedCommission: money2(current),
      estimatedCommissionAtRate: estimated,
      delta: money2(estimated - current),
      ratePct: pct,
      note: 'Estimate only — historical entries are never rewritten.',
    };
  }

  rulePresets() {
    return RULE_PRESETS;
  }

  // ——— Filtered sales / summary ———
  async listFilteredCommissions(opts: CommissionSalesFilter = {}) {
    const params: unknown[] = [];
    const where = ['TRUE'];
    if (opts.vendorId) {
      params.push(opts.vendorId);
      where.push(`c.vendor_id = $${params.length}`);
    }
    if (opts.status) {
      params.push(opts.status);
      where.push(`c.status = $${params.length}`);
    }
    if (opts.dateFrom) {
      params.push(opts.dateFrom);
      where.push(`c.created_at >= $${params.length}::timestamptz`);
    }
    if (opts.dateTo) {
      params.push(opts.dateTo);
      where.push(`c.created_at <= $${params.length}::timestamptz`);
    }
    if (opts.rateMin != null) {
      params.push(opts.rateMin);
      where.push(`c.rate_pct >= $${params.length}`);
    }
    if (opts.rateMax != null) {
      params.push(opts.rateMax);
      where.push(`c.rate_pct <= $${params.length}`);
    }
    if (opts.amountMin != null) {
      params.push(opts.amountMin);
      where.push(`c.gross_amount >= $${params.length}`);
    }
    if (opts.amountMax != null) {
      params.push(opts.amountMax);
      where.push(`c.gross_amount <= $${params.length}`);
    }
    if (opts.orderNumber) {
      params.push(`%${opts.orderNumber}%`);
      where.push(`o.order_number ILIKE $${params.length}`);
    }
    if (opts.settlementNumber) {
      params.push(`%${opts.settlementNumber}%`);
      where.push(`s.settlement_number ILIKE $${params.length}`);
    }
    if (opts.categoryId) {
      params.push(opts.categoryId);
      where.push(`EXISTS (
        SELECT 1 FROM sales.order_items oi
        JOIN catalog.product_categories pc ON pc.product_id = oi.product_id
        WHERE oi.order_id = c.order_id AND oi.vendor_id = c.vendor_id
          AND pc.category_id = $${params.length}
      )`);
    }
    if (opts.channel) {
      params.push(opts.channel);
      where.push(`o.sales_channel::text = $${params.length}`);
    }

    const sortMap: Record<string, string> = {
      date_desc: 'c.created_at DESC',
      date_asc: 'c.created_at ASC',
      gross_desc: 'c.gross_amount DESC',
      gross_asc: 'c.gross_amount ASC',
      commission_desc: 'c.commission_amount DESC',
      rate_desc: 'c.rate_pct DESC',
      vendor: 'v.display_name ASC, c.created_at DESC',
    };
    const orderBy = sortMap[opts.sort ?? 'date_desc'] ?? sortMap.date_desc;
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);

    const { rows } = await this.db.query<{
      id: string;
      order_id: string;
      order_number: string;
      vendor_id: string;
      vendor_name: string;
      gross_amount: string;
      rate_pct: string;
      commission_amount: string;
      status: string;
      entry_type: string;
      settlement_id: string | null;
      settlement_number: string | null;
      settlement_status: string | null;
      paid_at: Date | null;
      product_summary: string | null;
      channel: string | null;
      created_at: Date;
    }>(
      `SELECT c.id, c.order_id, o.order_number, c.vendor_id, v.display_name AS vendor_name,
              c.gross_amount::text, c.rate_pct::text, c.commission_amount::text,
              c.status, c.entry_type, c.settlement_id, s.settlement_number,
              s.status AS settlement_status, s.paid_at, c.created_at,
              o.sales_channel::text AS channel,
              (
                SELECT string_agg(oi.name_snapshot || ' ×' || oi.quantity::text, ', ' ORDER BY oi.line_no)
                FROM sales.order_items oi
                WHERE oi.order_id = c.order_id AND oi.vendor_id = c.vendor_id
              ) AS product_summary
       FROM marketplace.commission_entries c
       JOIN marketplace.vendors v ON v.id = c.vendor_id
       JOIN sales.orders o ON o.id = c.order_id
       LEFT JOIN marketplace.settlements s ON s.id = c.settlement_id
       WHERE ${where.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT ${limit}`,
      params,
    );

    let mapped = rows.map((r) => {
      const gross = Number(r.gross_amount);
      const commission = Number(r.commission_amount);
      const payoutState = resolvePayoutState({
        entryStatus: r.status,
        settlementId: r.settlement_id,
        settlementStatus: r.settlement_status,
      });
      return {
        id: r.id,
        orderId: r.order_id,
        orderNumber: r.order_number,
        vendorId: r.vendor_id,
        vendorName: r.vendor_name,
        productSummary: r.product_summary,
        grossAmount: gross,
        ratePct: Number(r.rate_pct),
        commissionAmount: commission,
        netPayable: money2(gross - commission),
        status: r.status,
        payoutState,
        settlementId: r.settlement_id,
        settlementNumber: r.settlement_number,
        settlementStatus: r.settlement_status,
        paidAt: r.paid_at,
        entryType: r.entry_type,
        channel: r.channel,
        createdAt: r.created_at,
      };
    });

    if (opts.payoutState) {
      mapped = mapped.filter((r) => r.payoutState === opts.payoutState);
    }
    return mapped;
  }

  async commissionsSummary(opts: CommissionSalesFilter = {}) {
    const rows = await this.listFilteredCommissions({
      ...opts,
      payoutState: undefined,
      limit: 1000,
    });
    const unpaid = rows.filter((r) => r.payoutState === 'unpaid');
    const pending = rows.filter((r) => r.payoutState === 'settlement_pending');
    const paid = rows.filter((r) => r.payoutState === 'paid');
    const gross = rows.reduce((s, r) => s + r.grossAmount, 0);
    const commission = rows.reduce((s, r) => s + r.commissionAmount, 0);
    const vendorNet = money2(gross - commission);
    const unpaidNet = money2(unpaid.reduce((s, r) => s + r.netPayable, 0));
    const pendingNet = money2(pending.reduce((s, r) => s + r.netPayable, 0));
    const paidNet = money2(paid.reduce((s, r) => s + r.netPayable, 0));
    const avgRate =
      gross > 0 ? money2((commission / gross) * 100) : 0;

    let prior: {
      grossSales: number;
      commission: number;
      deltaGrossPct: number | null;
      deltaCommissionPct: number | null;
    } | null = null;

    if (opts.dateFrom && opts.dateTo) {
      const from = new Date(opts.dateFrom).getTime();
      const to = new Date(opts.dateTo).getTime();
      const span = to - from;
      if (span > 0) {
        const priorTo = new Date(from - 1).toISOString();
        const priorFrom = new Date(from - span).toISOString();
        const priorRows = await this.listFilteredCommissions({
          ...opts,
          payoutState: undefined,
          dateFrom: priorFrom,
          dateTo: priorTo,
          limit: 1000,
        });
        const pGross = priorRows.reduce((s, r) => s + r.grossAmount, 0);
        const pComm = priorRows.reduce((s, r) => s + r.commissionAmount, 0);
        prior = {
          grossSales: money2(pGross),
          commission: money2(pComm),
          deltaGrossPct:
            pGross > 0 ? money2(((gross - pGross) / pGross) * 100) : null,
          deltaCommissionPct:
            pComm > 0 ? money2(((commission - pComm) / pComm) * 100) : null,
        };
      }
    }

    let adjustmentsApproved = 0;
    try {
      const { rows: adj } = await this.db.query<{
        approved_sum: string;
      }>(
        `SELECT COALESCE(sum(adjustment_amount),0)::text AS approved_sum
         FROM marketplace.financial_adjustments
         WHERE status = 'approved'
           ${opts.vendorId ? 'AND vendor_id = $1' : ''}`,
        opts.vendorId ? [opts.vendorId] : [],
      );
      adjustmentsApproved = money2(Number(adj[0]?.approved_sum ?? 0));
    } catch {
      adjustmentsApproved = 0;
    }

    return {
      entryCount: rows.length,
      grossSales: money2(gross),
      accruedCommission: money2(commission),
      /** Gross − Sabu fee — total remittable to vendors across all payout states. */
      vendorNet,
      avgEffectiveRatePct: avgRate,
      /** Still owed: not yet remitted (unpaid + awaiting remittance). */
      outstandingLiability: money2(unpaidNet + pendingNet),
      unpaidNet,
      pendingNet,
      paidNet,
      adjustmentsApproved,
      /** Identity check: vendorNet ≈ unpaid + pending + paid */
      vendorNetCheck: money2(unpaidNet + pendingNet + paidNet),
      priorPeriod: prior,
    };
  }

  async vendorAutocomplete(q: string) {
    const { rows } = await this.db.query<{
      id: string;
      vendor_code: string;
      display_name: string;
      business_name: string;
      status: string;
    }>(
      `SELECT id, vendor_code, display_name, business_name, status
       FROM marketplace.vendors
       WHERE display_name ILIKE $1 OR business_name ILIKE $1 OR vendor_code ILIKE $1
       ORDER BY display_name
       LIMIT 20`,
      [`%${q}%`],
    );
    return rows.map((r) => ({
      id: r.id,
      vendorCode: r.vendor_code,
      displayName: r.display_name,
      businessName: r.business_name,
      status: r.status,
    }));
  }

  async vendorDetail(vendorId: string) {
    const { rows: v } = await this.db.query(
      `SELECT id, vendor_code, business_name, display_name, phone_e164, email, status,
              commission_rate_pct::text, created_at
       FROM marketplace.vendors WHERE id = $1`,
      [vendorId],
    );
    if (!v[0]) throw new NotFoundException('Vendor not found');
    const summary = await this.commissionsSummary({ vendorId });
    const recent = await this.listFilteredCommissions({
      vendorId,
      limit: 50,
    });
    const rules = (await this.listCommissionRules()).filter(
      (r) => r.scope === 'vendor' && r.vendorId === vendorId,
    );
    return {
      vendor: {
        id: v[0].id,
        vendorCode: v[0].vendor_code,
        businessName: v[0].business_name,
        displayName: v[0].display_name,
        phone: v[0].phone_e164,
        email: v[0].email,
        status: v[0].status,
        commissionRatePct:
          v[0].commission_rate_pct != null
            ? Number(v[0].commission_rate_pct)
            : null,
        createdAt: v[0].created_at,
      },
      summary,
      recentSales: recent,
      activeRules: rules,
    };
  }

  // ——— Adjustments ———
  private async nextAdjNumber(client: PoolClient) {
    const period = String(new Date().getUTCFullYear());
    await client.query(
      `INSERT INTO core.document_sequences (doc_type, period, next_value)
       VALUES ('ADJ', $1, 1) ON CONFLICT (doc_type, period) DO NOTHING`,
      [period],
    );
    const { rows } = await client.query<{ next_value: string }>(
      `UPDATE core.document_sequences SET next_value = next_value + 1
       WHERE doc_type = 'ADJ' AND period = $1
       RETURNING (next_value - 1)::text AS next_value`,
      [period],
    );
    return `ADJ-${period}-${String(Number(rows[0].next_value)).padStart(6, '0')}`;
  }

  async listAdjustments(opts?: { vendorId?: string; status?: string }) {
    const params: unknown[] = [];
    const where = ['TRUE'];
    if (opts?.vendorId) {
      params.push(opts.vendorId);
      where.push(`a.vendor_id = $${params.length}`);
    }
    if (opts?.status) {
      params.push(opts.status);
      where.push(`a.status = $${params.length}`);
    }
    const { rows } = await this.db.query(
      `SELECT a.id, a.adjustment_number, a.vendor_id, v.display_name AS vendor_name,
              a.settlement_id, a.commission_entry_id, a.adjustment_type,
              a.original_amount::text, a.adjustment_amount::text, a.reason,
              a.status, a.created_at, a.approved_at
       FROM marketplace.financial_adjustments a
       JOIN marketplace.vendors v ON v.id = a.vendor_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.created_at DESC
       LIMIT 200`,
      params,
    );
    return rows.map((r) => ({
      id: r.id as string,
      adjustmentNumber: r.adjustment_number as string,
      vendorId: r.vendor_id as string,
      vendorName: r.vendor_name as string,
      settlementId: (r.settlement_id as string) ?? null,
      commissionEntryId: (r.commission_entry_id as string) ?? null,
      adjustmentType: r.adjustment_type as string,
      originalAmount:
        r.original_amount != null ? Number(r.original_amount) : null,
      adjustmentAmount: Number(r.adjustment_amount),
      reason: r.reason as string,
      status: r.status as string,
      createdAt: r.created_at as Date,
      approvedAt: (r.approved_at as Date) ?? null,
    }));
  }

  async createAdjustment(
    user: AuthUser,
    body: {
      vendorId: string;
      adjustmentType: string;
      adjustmentAmount: number;
      reason: string;
      settlementId?: string;
      commissionEntryId?: string;
      originalAmount?: number;
      confirmLargeChange?: boolean;
    },
  ) {
    if (!body.vendorId || !body.reason?.trim()) {
      throw new BadRequestException('vendorId and reason are required');
    }
    if (body.adjustmentAmount == null) {
      throw new BadRequestException('adjustmentAmount is required');
    }
    if (Math.abs(body.adjustmentAmount) >= 5000 && !body.confirmLargeChange) {
      throw new BadRequestException({
        message: 'Large adjustment (≥ 5000 ETB) requires confirmLargeChange',
        requiresConfirm: true,
      });
    }
    if (body.settlementId) {
      const { rows } = await this.db.query<{ status: string }>(
        `SELECT status FROM marketplace.settlements WHERE id = $1`,
        [body.settlementId],
      );
      if (!rows[0]) throw new NotFoundException('Settlement not found');
      if (rows[0].status === 'paid') {
        throw new BadRequestException(
          'Cannot attach adjustment to a paid settlement — create a new correction settlement instead',
        );
      }
    }

    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const num = await this.nextAdjNumber(client);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO marketplace.financial_adjustments (
           adjustment_number, vendor_id, settlement_id, commission_entry_id,
           adjustment_type, original_amount, adjustment_amount, reason, status, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)
         RETURNING id`,
        [
          num,
          body.vendorId,
          body.settlementId ?? null,
          body.commissionEntryId ?? null,
          body.adjustmentType,
          body.originalAmount ?? null,
          money2(body.adjustmentAmount),
          body.reason.trim(),
          user.id,
        ],
      );
      await this.writeAudit(
        {
          entityType: 'financial_adjustment',
          entityId: rows[0].id,
          action: 'create',
          actorId: user.id,
          after: body,
        },
        client,
      );
      await client.query('COMMIT');
      const list = await this.listAdjustments({ vendorId: body.vendorId });
      return list.find((a) => a.id === rows[0].id)!;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async approveAdjustment(user: AuthUser, id: string) {
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{
        id: string;
        status: string;
        settlement_id: string | null;
        adjustment_amount: string;
      }>(
        `UPDATE marketplace.financial_adjustments SET
           status = 'approved', approved_by = $2, approved_at = now(), updated_at = now()
         WHERE id = $1 AND status = 'pending'
         RETURNING id, status, settlement_id, adjustment_amount::text`,
        [id, user.id],
      );
      if (!rows[0]) {
        throw new NotFoundException('Adjustment not found or not pending');
      }
      if (rows[0].settlement_id) {
        await client.query(
          `UPDATE marketplace.settlements SET
             net_payable = net_payable + $2,
             status = CASE
               WHEN status = 'paid' THEN status
               ELSE 'adjustment_required'
             END,
             updated_at = now()
           WHERE id = $1 AND status <> 'paid'`,
          [rows[0].settlement_id, Number(rows[0].adjustment_amount)],
        );
      }
      await this.writeAudit(
        {
          entityType: 'financial_adjustment',
          entityId: id,
          action: 'approve',
          actorId: user.id,
        },
        client,
      );
      await client.query('COMMIT');
      return (await this.listAdjustments()).find((a) => a.id === id)!;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async voidAdjustment(user: AuthUser, id: string) {
    const { rowCount } = await this.db.query(
      `UPDATE marketplace.financial_adjustments
       SET status = 'void', updated_at = now()
       WHERE id = $1 AND status IN ('pending','approved')
         AND (settlement_id IS NULL OR settlement_id NOT IN (
           SELECT id FROM marketplace.settlements WHERE status = 'paid'
         ))`,
      [id],
    );
    if (!rowCount) {
      throw new BadRequestException(
        'Cannot void adjustment (missing, or tied to paid settlement)',
      );
    }
    await this.writeAudit( {
      entityType: 'financial_adjustment',
      entityId: id,
      action: 'void',
      actorId: user.id,
    });
    return { ok: true };
  }

  // ——— Settlements extended ———
  async listFilteredSettlements(opts?: {
    vendorId?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    settlementNumber?: string;
  }) {
    const params: unknown[] = [];
    const where = ['TRUE'];
    if (opts?.vendorId) {
      params.push(opts.vendorId);
      where.push(`s.vendor_id = $${params.length}`);
    }
    if (opts?.status) {
      params.push(opts.status);
      where.push(`s.status = $${params.length}`);
    }
    if (opts?.dateFrom) {
      params.push(opts.dateFrom);
      where.push(`s.created_at >= $${params.length}::timestamptz`);
    }
    if (opts?.dateTo) {
      params.push(opts.dateTo);
      where.push(`s.created_at <= $${params.length}::timestamptz`);
    }
    if (opts?.settlementNumber) {
      params.push(`%${opts.settlementNumber}%`);
      where.push(`s.settlement_number ILIKE $${params.length}`);
    }
    const { rows } = await this.db.query(
      `SELECT s.id, s.settlement_number, s.vendor_id, v.display_name AS vendor_name,
              v.phone_e164 AS vendor_phone,
              s.period_start::text, s.period_end::text,
              s.gross_sales::text, s.commission_total::text, s.net_payable::text,
              COALESCE(s.amount_paid,0)::text AS amount_paid,
              s.status, s.payout_reference, s.payout_receipt_key, s.paid_at, s.created_at
       FROM marketplace.settlements s
       JOIN marketplace.vendors v ON v.id = s.vendor_id
       WHERE ${where.join(' AND ')}
       ORDER BY s.created_at DESC
       LIMIT 200`,
      params,
    );

    const ids = rows.map((r) => r.id as string);
    const itemsBySettlement = new Map<string, Array<Record<string, unknown>>>();
    const paymentsBySettlement = new Map<string, Array<Record<string, unknown>>>();

    if (ids.length) {
      const { rows: items } = await this.db.query(
        `SELECT si.settlement_id, c.id AS entry_id, o.order_number,
                c.gross_amount::text, c.rate_pct::text, c.commission_amount::text,
                (
                  SELECT string_agg(oi.name_snapshot || ' ×' || oi.quantity::text, ', ' ORDER BY oi.line_no)
                  FROM sales.order_items oi
                  WHERE oi.order_id = c.order_id AND oi.vendor_id = c.vendor_id
                ) AS product_summary
         FROM marketplace.settlement_items si
         JOIN marketplace.commission_entries c ON c.id = si.commission_entry_id
         JOIN sales.orders o ON o.id = c.order_id
         WHERE si.settlement_id = ANY($1::uuid[])
         ORDER BY o.order_number`,
        [ids],
      );
      for (const it of items) {
        const gross = Number(it.gross_amount);
        const fee = Number(it.commission_amount);
        const list = itemsBySettlement.get(it.settlement_id as string) ?? [];
        list.push({
          entryId: it.entry_id,
          orderNumber: it.order_number,
          productSummary: it.product_summary,
          grossAmount: gross,
          ratePct: Number(it.rate_pct),
          commissionAmount: fee,
          netPayable: money2(gross - fee),
        });
        itemsBySettlement.set(it.settlement_id as string, list);
      }

      const { rows: pays } = await this.db.query(
        `SELECT id, settlement_id, amount::text, paid_at, payment_method,
                payout_reference, payout_receipt_key, idempotency_key
         FROM marketplace.settlement_payments
         WHERE settlement_id = ANY($1::uuid[])
         ORDER BY paid_at`,
        [ids],
      );
      for (const p of pays) {
        const list = paymentsBySettlement.get(p.settlement_id as string) ?? [];
        list.push({
          id: p.id,
          amount: Number(p.amount),
          paidAt: p.paid_at,
          paymentMethod: p.payment_method,
          payoutReference: p.payout_reference,
          payoutReceiptKey: p.payout_receipt_key,
          payoutReceiptUrl: p.payout_receipt_key
            ? `/media/file?key=${encodeURIComponent(p.payout_receipt_key as string)}`
            : null,
        });
        paymentsBySettlement.set(p.settlement_id as string, list);
      }
    }

    const { rows: adjRows } = ids.length
      ? await this.db.query(
          `SELECT settlement_id, COALESCE(sum(adjustment_amount),0)::text AS adj
           FROM marketplace.financial_adjustments
           WHERE status = 'approved' AND settlement_id = ANY($1::uuid[])
           GROUP BY settlement_id`,
          [ids],
        )
      : { rows: [] as Array<{ settlement_id: string; adj: string }> };

    const adjMap = new Map(
      adjRows.map((a) => [a.settlement_id as string, Number(a.adj)]),
    );

    return rows.map((r) => {
      const id = r.id as string;
      const net = Number(r.net_payable);
      const paid = Number(r.amount_paid);
      return {
        id,
        settlementNumber: r.settlement_number as string,
        vendorId: r.vendor_id as string,
        vendorName: r.vendor_name as string,
        vendorPhone: (r.vendor_phone as string) ?? null,
        periodStart: r.period_start as string,
        periodEnd: r.period_end as string,
        grossSales: Number(r.gross_sales),
        commissionTotal: Number(r.commission_total),
        adjustmentsTotal: money2(adjMap.get(id) ?? 0),
        netPayable: net,
        amountPaid: paid,
        balanceDue: money2(Math.max(0, net - paid)),
        status: r.status as string,
        payoutReference: (r.payout_reference as string) ?? null,
        payoutReceiptKey: (r.payout_receipt_key as string) ?? null,
        payoutReceiptUrl: r.payout_receipt_key
          ? `/media/file?key=${encodeURIComponent(r.payout_receipt_key as string)}`
          : null,
        paidAt: (r.paid_at as Date) ?? null,
        createdAt: r.created_at as Date,
        items: itemsBySettlement.get(id) ?? [],
        payments: paymentsBySettlement.get(id) ?? [],
        receiptQrPayload: JSON.stringify({
          type: 'sabu_settlement',
          settlementId: id,
          settlementNumber: r.settlement_number,
        }),
      };
    });
  }

  async createSettlementDraft(
    user: AuthUser,
    body: {
      vendorId: string;
      periodStart?: string;
      periodEnd?: string;
      entryIds?: string[];
      status?: 'draft' | 'pending_payment' | 'approved';
      notes?: string;
    },
  ) {
    if (!body.vendorId) throw new BadRequestException('vendorId is required');
    const status = body.status ?? 'pending_payment';
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const params: unknown[] = [body.vendorId];
      let filter = `vendor_id = $1 AND settlement_id IS NULL AND status IN ('accrued','finalized')`;
      if (body.entryIds?.length) {
        params.push(body.entryIds);
        filter += ` AND id = ANY($${params.length}::uuid[])`;
      }
      const { rows: entries } = await client.query<{
        id: string;
        gross_amount: string;
        commission_amount: string;
        created_at: Date;
      }>(
        `SELECT id, gross_amount::text, commission_amount::text, created_at
         FROM marketplace.commission_entries
         WHERE ${filter}
         ORDER BY created_at
         FOR UPDATE`,
        params,
      );
      if (!entries.length) {
        throw new BadRequestException('No unpaid vendor sales available to settle');
      }
      const gross = entries.reduce((s, e) => s + Number(e.gross_amount), 0);
      const commission = entries.reduce(
        (s, e) => s + Number(e.commission_amount),
        0,
      );
      const net = money2(gross - commission);
      const periodStart =
        body.periodStart ?? entries[0].created_at.toISOString().slice(0, 10);
      const periodEnd =
        body.periodEnd ??
        entries[entries.length - 1].created_at.toISOString().slice(0, 10);

      const period = String(new Date().getUTCFullYear());
      await client.query(
        `INSERT INTO core.document_sequences (doc_type, period, next_value)
         VALUES ('STL', $1, 1) ON CONFLICT (doc_type, period) DO NOTHING`,
        [period],
      );
      const { rows: seq } = await client.query<{ next_value: string }>(
        `UPDATE core.document_sequences SET next_value = next_value + 1
         WHERE doc_type = 'STL' AND period = $1
         RETURNING (next_value - 1)::text AS next_value`,
        [period],
      );
      const settlementNumber = `STL-${period}-${String(Number(seq[0].next_value)).padStart(6, '0')}`;

      const { rows: stl } = await client.query<{ id: string }>(
        `INSERT INTO marketplace.settlements (
           settlement_number, vendor_id, period_start, period_end,
           gross_sales, commission_total, net_payable, status, created_by, notes
         ) VALUES ($1,$2,$3::date,$4::date,$5,$6,$7,$8,$9,$10)
         RETURNING id`,
        [
          settlementNumber,
          body.vendorId,
          periodStart,
          periodEnd,
          money2(gross),
          money2(commission),
          net,
          status === 'approved' ? 'pending_payment' : status,
          user.id,
          body.notes ?? null,
        ],
      );
      const settlementId = stl[0].id;
      for (const e of entries) {
        await client.query(
          `INSERT INTO marketplace.settlement_items (settlement_id, commission_entry_id)
           VALUES ($1,$2)`,
          [settlementId, e.id],
        );
        await client.query(
          `UPDATE marketplace.commission_entries SET settlement_id = $2 WHERE id = $1`,
          [e.id, settlementId],
        );
      }
      await this.writeAudit(
        {
          entityType: 'settlement',
          entityId: settlementId,
          action: 'create',
          actorId: user.id,
          after: { settlementNumber, entryCount: entries.length, net },
        },
        client,
      );
      await client.query('COMMIT');
      const all = await this.listFilteredSettlements({ vendorId: body.vendorId });
      return all.find((s) => s.id === settlementId)!;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async previewSettlement(body: { vendorId: string; entryIds?: string[] }) {
    const params: unknown[] = [body.vendorId];
    let filter = `vendor_id = $1 AND settlement_id IS NULL AND status IN ('accrued','finalized')`;
    if (body.entryIds?.length) {
      params.push(body.entryIds);
      filter += ` AND id = ANY($${params.length}::uuid[])`;
    }
    const { rows } = await this.db.query<{
      id: string;
      gross_amount: string;
      commission_amount: string;
      rate_pct: string;
      order_number: string;
    }>(
      `SELECT c.id, c.gross_amount::text, c.commission_amount::text, c.rate_pct::text,
              o.order_number
       FROM marketplace.commission_entries c
       JOIN sales.orders o ON o.id = c.order_id
       WHERE ${filter}
       ORDER BY c.created_at`,
      params,
    );
    const { rows: adj } = await this.db.query<{ sum: string }>(
      `SELECT COALESCE(sum(adjustment_amount),0)::text AS sum
       FROM marketplace.financial_adjustments
       WHERE vendor_id = $1 AND status = 'approved' AND settlement_id IS NULL`,
      [body.vendorId],
    );
    const gross = rows.reduce((s, r) => s + Number(r.gross_amount), 0);
    const commission = rows.reduce((s, r) => s + Number(r.commission_amount), 0);
    const adjustments = Number(adj[0]?.sum ?? 0);
    return {
      entryCount: rows.length,
      grossSales: money2(gross),
      commissionTotal: money2(commission),
      adjustmentsTotal: money2(adjustments),
      netPayable: money2(gross - commission + adjustments),
      items: rows.map((r) => ({
        entryId: r.id,
        orderNumber: r.order_number,
        grossAmount: Number(r.gross_amount),
        ratePct: Number(r.rate_pct),
        commissionAmount: Number(r.commission_amount),
        netPayable: money2(Number(r.gross_amount) - Number(r.commission_amount)),
      })),
    };
  }

  async recordSettlementPayment(
    user: AuthUser,
    settlementId: string,
    body: {
      amount: number;
      payoutReference?: string;
      payoutReceiptKey?: string;
      paidAt?: string;
      paymentMethod?: string;
      idempotencyKey?: string;
      markFullyPaid?: boolean;
    },
  ) {
    if (!body.amount || body.amount <= 0) {
      throw new BadRequestException('amount must be positive');
    }
    const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime())) {
      throw new BadRequestException('Invalid paidAt');
    }
    const idem =
      body.idempotencyKey?.trim() ||
      `pay:${settlementId}:${body.amount}:${paidAt.toISOString().slice(0, 10)}:${createHash('sha256').update(String(body.payoutReference ?? '')).digest('hex').slice(0, 8)}`;

    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows: stl } = await client.query<{
        id: string;
        status: string;
        net_payable: string;
        amount_paid: string;
      }>(
        `SELECT id, status, net_payable::text, COALESCE(amount_paid,0)::text AS amount_paid
         FROM marketplace.settlements WHERE id = $1 FOR UPDATE`,
        [settlementId],
      );
      if (!stl[0]) throw new NotFoundException('Settlement not found');
      if (['paid', 'cancelled'].includes(stl[0].status)) {
        throw new BadRequestException(`Settlement is ${stl[0].status}`);
      }

      const existing = await client.query(
        `SELECT id FROM marketplace.settlement_payments WHERE idempotency_key = $1`,
        [idem],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        const list = await this.listFilteredSettlements();
        return list.find((s) => s.id === settlementId)!;
      }

      await client.query(
        `INSERT INTO marketplace.settlement_payments (
           settlement_id, amount, paid_at, payment_method, payout_reference,
           payout_receipt_key, idempotency_key, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          settlementId,
          money2(body.amount),
          paidAt.toISOString(),
          body.paymentMethod ?? null,
          body.payoutReference ?? null,
          body.payoutReceiptKey ?? null,
          idem,
          user.id,
        ],
      );

      const newPaid = money2(Number(stl[0].amount_paid) + body.amount);
      const net = Number(stl[0].net_payable);
      const fully =
        body.markFullyPaid || newPaid >= net - 0.009;
      const status = fully ? 'paid' : 'partially_paid';

      await client.query(
        `UPDATE marketplace.settlements SET
           amount_paid = $2,
           status = $3,
           payout_reference = COALESCE($4, payout_reference),
           payout_receipt_key = COALESCE($5, payout_receipt_key),
           paid_at = CASE WHEN $3 = 'paid' THEN $6::timestamptz ELSE paid_at END,
           payment_method = COALESCE($7, payment_method),
           updated_at = now()
         WHERE id = $1`,
        [
          settlementId,
          newPaid,
          status,
          body.payoutReference ?? null,
          body.payoutReceiptKey ?? null,
          paidAt.toISOString(),
          body.paymentMethod ?? null,
        ],
      );

      if (fully) {
        await client.query(
          `UPDATE marketplace.commission_entries
           SET status = 'paid_out'
           WHERE settlement_id = $1 AND status IN ('accrued','finalized')`,
          [settlementId],
        );
      }

      await this.writeAudit(
        {
          entityType: 'settlement',
          entityId: settlementId,
          action: fully ? 'mark_paid' : 'partial_payment',
          actorId: user.id,
          after: { amount: body.amount, newPaid, status },
        },
        client,
      );
      await client.query('COMMIT');
      const list = await this.listFilteredSettlements();
      return list.find((s) => s.id === settlementId)!;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async cancelSettlement(user: AuthUser, id: string) {
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ status: string; amount_paid: string }>(
        `SELECT status, COALESCE(amount_paid,0)::text AS amount_paid
         FROM marketplace.settlements WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!rows[0]) throw new NotFoundException('Settlement not found');
      if (rows[0].status === 'paid') {
        throw new BadRequestException('Cannot cancel a paid settlement');
      }
      if (Number(rows[0].amount_paid) > 0) {
        throw new BadRequestException(
          'Cannot cancel settlement with recorded payments — void payments first or mark adjustment_required',
        );
      }
      await client.query(
        `UPDATE marketplace.commission_entries
         SET settlement_id = NULL,
             status = CASE WHEN status = 'paid_out' THEN 'finalized' ELSE status END
         WHERE settlement_id = $1`,
        [id],
      );
      await client.query(
        `DELETE FROM marketplace.settlement_items WHERE settlement_id = $1`,
        [id],
      );
      await client.query(
        `UPDATE marketplace.settlements SET status = 'cancelled', updated_at = now()
         WHERE id = $1`,
        [id],
      );
      await this.writeAudit(
        {
          entityType: 'settlement',
          entityId: id,
          action: 'cancel',
          actorId: user.id,
        },
        client,
      );
      await client.query('COMMIT');
      return { ok: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ——— Analytics ———
  async analyticsOverview(opts: CommissionSalesFilter = {}) {
    const rows = await this.listFilteredCommissions({ ...opts, limit: 1000 });
    const byMonth = new Map<string, { gross: number; commission: number }>();
    const byVendor = new Map<
      string,
      { name: string; gross: number; commission: number }
    >();
    const rateBuckets = new Map<string, number>();

    for (const r of rows) {
      const month = new Date(r.createdAt).toISOString().slice(0, 7);
      const m = byMonth.get(month) ?? { gross: 0, commission: 0 };
      m.gross += r.grossAmount;
      m.commission += r.commissionAmount;
      byMonth.set(month, m);

      const v = byVendor.get(r.vendorId) ?? {
        name: r.vendorName,
        gross: 0,
        commission: 0,
      };
      v.gross += r.grossAmount;
      v.commission += r.commissionAmount;
      byVendor.set(r.vendorId, v);

      const bucket = `${Math.floor(r.ratePct)}%`;
      rateBuckets.set(bucket, (rateBuckets.get(bucket) ?? 0) + 1);
    }

    const settlements = await this.listFilteredSettlements({
      vendorId: opts.vendorId,
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
    });
    const settlementPerf = {
      total: settlements.length,
      paid: settlements.filter((s) => s.status === 'paid').length,
      partial: settlements.filter((s) => s.status === 'partially_paid').length,
      pending: settlements.filter((s) =>
        ['draft', 'approved', 'pending_payment', 'adjustment_required'].includes(
          s.status,
        ),
      ).length,
      cancelled: settlements.filter((s) => s.status === 'cancelled').length,
      avgDaysToPay: (() => {
        const paid = settlements.filter((s) => s.paidAt);
        if (!paid.length) return null;
        const days = paid.map(
          (s) =>
            (new Date(s.paidAt!).getTime() - new Date(s.createdAt).getTime()) /
            86400000,
        );
        return money2(days.reduce((a, b) => a + b, 0) / days.length);
      })(),
    };

    return {
      commissionTrend: [...byMonth.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, v]) => ({
          month,
          grossSales: money2(v.gross),
          commission: money2(v.commission),
        })),
      vendorCompare: [...byVendor.entries()]
        .map(([id, v]) => ({
          vendorId: id,
          vendorName: v.name,
          grossSales: money2(v.gross),
          commission: money2(v.commission),
        }))
        .sort((a, b) => b.grossSales - a.grossSales)
        .slice(0, 12),
      rateDistribution: [...rateBuckets.entries()]
        .map(([rate, count]) => ({ rate, count }))
        .sort((a, b) => a.rate.localeCompare(b.rate)),
      settlementPerformance: settlementPerf,
      topVendors: [...byVendor.entries()]
        .map(([id, v]) => ({
          vendorId: id,
          vendorName: v.name,
          commission: money2(v.commission),
          grossSales: money2(v.gross),
        }))
        .sort((a, b) => b.commission - a.commission)
        .slice(0, 10),
      summary: await this.commissionsSummary(opts),
    };
  }

  // ——— Exports ———
  async exportReport(
    type: 'sales' | 'settlements' | 'adjustments' | 'rules',
    opts: CommissionSalesFilter = {},
    format: 'csv' | 'json' = 'csv',
  ) {
    let headers: string[] = [];
    let lines: string[][] = [];

    if (type === 'sales') {
      const rows = await this.listFilteredCommissions({ ...opts, limit: 1000 });
      headers = [
        'Order',
        'Vendor',
        'Products',
        'Gross',
        'Rate%',
        'Commission',
        'Net',
        'Payout',
        'Settlement',
        'Date',
      ];
      lines = rows.map((r) => [
        r.orderNumber,
        r.vendorName,
        r.productSummary ?? '',
        r.grossAmount.toFixed(2),
        String(r.ratePct),
        r.commissionAmount.toFixed(2),
        r.netPayable.toFixed(2),
        r.payoutState,
        r.settlementNumber ?? '',
        new Date(r.createdAt).toISOString(),
      ]);
    } else if (type === 'settlements') {
      const rows = await this.listFilteredSettlements({
        vendorId: opts.vendorId,
        dateFrom: opts.dateFrom,
        dateTo: opts.dateTo,
      });
      headers = [
        'Settlement',
        'Vendor',
        'Period',
        'Gross',
        'Commission',
        'Adjustments',
        'Net',
        'Paid',
        'Balance',
        'Status',
      ];
      lines = rows.map((r) => [
        r.settlementNumber,
        r.vendorName,
        `${r.periodStart}..${r.periodEnd}`,
        r.grossSales.toFixed(2),
        r.commissionTotal.toFixed(2),
        r.adjustmentsTotal.toFixed(2),
        r.netPayable.toFixed(2),
        r.amountPaid.toFixed(2),
        r.balanceDue.toFixed(2),
        r.status,
      ]);
    } else if (type === 'adjustments') {
      const rows = await this.listAdjustments({ vendorId: opts.vendorId });
      headers = [
        'Number',
        'Vendor',
        'Type',
        'Amount',
        'Reason',
        'Status',
        'Created',
      ];
      lines = rows.map((r) => [
        r.adjustmentNumber,
        r.vendorName,
        r.adjustmentType,
        r.adjustmentAmount.toFixed(2),
        r.reason,
        r.status,
        new Date(r.createdAt).toISOString(),
      ]);
    } else {
      const rows = await this.listCommissionRules({ includeArchived: true });
      headers = [
        'Code',
        'Name',
        'Scope',
        'Kind',
        'Priority',
        'Rate%',
        'Enabled',
        'ValidFrom',
        'ValidTo',
      ];
      lines = rows.map((r) => [
        r.code,
        r.name,
        r.scope,
        r.kind,
        String(r.priority),
        String(r.ratePct),
        String(r.isEnabled),
        new Date(r.validFrom).toISOString(),
        r.validTo ? new Date(r.validTo).toISOString() : '',
      ]);
    }

    if (format === 'json') {
      return {
        format: 'json',
        type,
        headers,
        rows: lines.map((cols) =>
          Object.fromEntries(headers.map((h, i) => [h, cols[i]])),
        ),
      };
    }

    const escape = (c: string) =>
      /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c;
    const csv = [headers, ...lines]
      .map((row) => row.map((c) => escape(String(c))).join(','))
      .join('\n');
    return { format: 'csv', type, filename: `sabu-${type}-${Date.now()}.csv`, csv };
  }

  // ——— Audit list ———
  async listAuditLog(opts?: { entityType?: string; limit?: number }) {
    const params: unknown[] = [];
    const where = ['TRUE'];
    if (opts?.entityType) {
      params.push(opts.entityType);
      where.push(`entity_type = $${params.length}`);
    }
    const limit = Math.min(opts?.limit ?? 100, 500);
    const { rows } = await this.db.query(
      `SELECT id, entity_type, entity_id, action, actor_id, before_json, after_json, note, created_at
       FROM marketplace.commission_audit_log
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      action: r.action,
      actorId: r.actor_id,
      before: r.before_json,
      after: r.after_json,
      note: r.note,
      createdAt: r.created_at,
    }));
  }

  // ——— WhatsApp receipt ———
  async sendSettlementWhatsApp(
    user: AuthUser,
    settlementId: string,
    body?: { phone?: string; message?: string },
  ) {
    const list = await this.listFilteredSettlements();
    const s = list.find((x) => x.id === settlementId);
    if (!s) throw new NotFoundException('Settlement not found');
    const phone = body?.phone || s.vendorPhone;
    if (!phone) {
      throw new BadRequestException('Vendor has no phone; provide phone');
    }
    const text =
      body?.message ||
      [
        `Sabu settlement ${s.settlementNumber}`,
        `Vendor: ${s.vendorName}`,
        `Net payable: ${s.netPayable.toFixed(2)} ETB`,
        `Status: ${s.status}`,
        `Period: ${s.periodStart} → ${s.periodEnd}`,
        `Receipt ref: ${s.settlementNumber}`,
      ].join('\n');

    const result = await this.whatsapp.sendText(phone, text);
    await this.db.query(
      `INSERT INTO marketplace.settlement_receipt_sends
         (settlement_id, channel, destination, status, provider_ref, created_by)
       VALUES ($1,'whatsapp',$2,$3,$4,$5)`,
      [
        settlementId,
        phone,
        result.ok ? 'sent' : 'failed',
        result.providerMessageId ?? result.deepLink ?? null,
        user.id,
      ],
    );
    await this.writeAudit( {
      entityType: 'settlement',
      entityId: settlementId,
      action: 'whatsapp_send',
      actorId: user.id,
      after: { phone, ok: result.ok, mode: result.mode },
    });
    return {
      ok: result.ok,
      mode: result.mode,
      deepLink: result.deepLink ?? null,
      error: result.error ?? null,
    };
  }

  async logReceiptCopy(user: AuthUser, settlementId: string) {
    await this.db.query(
      `INSERT INTO marketplace.settlement_receipt_sends
         (settlement_id, channel, status, created_by)
       VALUES ($1,'copy','sent',$2)`,
      [settlementId, user.id],
    );
    return { ok: true };
  }
}
