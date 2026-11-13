import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import type { AuthUser } from '../iam/auth.types';

@Injectable()
export class MarketplaceService {
  readonly schema = 'marketplace' as const;

  constructor(private readonly db: DatabaseService) {}

  async listVendors(opts?: { status?: string; q?: string }) {
    const params: unknown[] = [];
    const where = ['TRUE'];
    if (opts?.status) {
      params.push(opts.status);
      where.push(`v.status = $${params.length}`);
    }
    if (opts?.q) {
      params.push(`%${opts.q}%`);
      where.push(
        `(v.business_name ILIKE $${params.length} OR v.display_name ILIKE $${params.length} OR v.vendor_code ILIKE $${params.length})`,
      );
    }
    const { rows } = await this.db.query<{
      id: string;
      vendor_code: string;
      business_name: string;
      display_name: string;
      phone_e164: string | null;
      email: string | null;
      status: string;
      commission_rate_pct: string | null;
      product_count: string;
      created_at: Date;
    }>(
      `SELECT v.id, v.vendor_code, v.business_name, v.display_name,
              v.phone_e164, v.email, v.status, v.commission_rate_pct::text,
              (SELECT count(*)::text FROM catalog.products p
               WHERE p.vendor_id = v.id AND p.deleted_at IS NULL) AS product_count,
              v.created_at
       FROM marketplace.vendors v
       WHERE ${where.join(' AND ')}
       ORDER BY v.created_at DESC
       LIMIT 200`,
      params,
    );
    return rows.map((v) => ({
      id: v.id,
      vendorCode: v.vendor_code,
      businessName: v.business_name,
      displayName: v.display_name,
      phone: v.phone_e164,
      email: v.email,
      status: v.status,
      commissionRatePct:
        v.commission_rate_pct != null ? Number(v.commission_rate_pct) : null,
      productCount: Number(v.product_count),
      createdAt: v.created_at,
    }));
  }

  async createVendor(
    _user: AuthUser,
    body: {
      businessName: string;
      displayName?: string;
      phone?: string;
      email?: string;
      commissionRatePct?: number;
    },
  ) {
    if (!body.businessName?.trim()) {
      throw new BadRequestException('businessName is required');
    }
    const client = await this.db.getPool().connect();
    try {
      const code = await this.nextDocNumber(client, 'VND');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO marketplace.vendors (
           vendor_code, business_name, display_name, phone_e164, email,
           status, commission_rate_pct
         ) VALUES ($1,$2,$3,$4,$5,'pending',$6)
         RETURNING id`,
        [
          code,
          body.businessName.trim(),
          (body.displayName ?? body.businessName).trim(),
          body.phone ?? null,
          body.email ?? null,
          body.commissionRatePct ?? null,
        ],
      );
      return this.getVendor(rows[0].id);
    } finally {
      client.release();
    }
  }

  async getVendor(id: string) {
    const { rows } = await this.db.query<{
      id: string;
      vendor_code: string;
      business_name: string;
      display_name: string;
      phone_e164: string | null;
      email: string | null;
      status: string;
      commission_rate_pct: string | null;
      bank_details: Record<string, unknown>;
      notes: string | null;
      created_at: Date;
    }>(
      `SELECT id, vendor_code, business_name, display_name, phone_e164, email,
              status, commission_rate_pct::text, bank_details, notes, created_at
       FROM marketplace.vendors WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Vendor not found');
    const v = rows[0];
    return {
      id: v.id,
      vendorCode: v.vendor_code,
      businessName: v.business_name,
      displayName: v.display_name,
      phone: v.phone_e164,
      email: v.email,
      status: v.status,
      commissionRatePct:
        v.commission_rate_pct != null ? Number(v.commission_rate_pct) : null,
      bankDetails: v.bank_details,
      notes: v.notes,
      createdAt: v.created_at,
    };
  }

  async updateVendor(
    id: string,
    body: {
      status?: string;
      displayName?: string;
      commissionRatePct?: number | null;
      notes?: string;
    },
  ) {
    const allowed = ['pending', 'active', 'suspended', 'rejected'];
    if (body.status && !allowed.includes(body.status)) {
      throw new BadRequestException('Invalid status');
    }
    const { rowCount } = await this.db.query(
      `UPDATE marketplace.vendors SET
         status = COALESCE($2, status),
         display_name = COALESCE($3, display_name),
         commission_rate_pct = CASE
           WHEN $4::text = '__CLEAR__' THEN NULL
           WHEN $5::numeric IS NOT NULL THEN $5::numeric
           ELSE commission_rate_pct
         END,
         notes = COALESCE($6, notes),
         updated_at = now()
       WHERE id = $1`,
      [
        id,
        body.status ?? null,
        body.displayName ?? null,
        body.commissionRatePct === null ? '__CLEAR__' : null,
        body.commissionRatePct ?? null,
        body.notes ?? null,
      ],
    );
    if (!rowCount) throw new NotFoundException('Vendor not found');
    return this.getVendor(id);
  }

  async listCommissions(opts?: { vendorId?: string; status?: string }) {
    const params: unknown[] = [];
    const where = ['TRUE'];
    if (opts?.vendorId) {
      params.push(opts.vendorId);
      where.push(`c.vendor_id = $${params.length}`);
    }
    if (opts?.status) {
      params.push(opts.status);
      where.push(`c.status = $${params.length}`);
    }
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
      created_at: Date;
    }>(
      `SELECT c.id, c.order_id, o.order_number, c.vendor_id, v.display_name AS vendor_name,
              c.gross_amount::text, c.rate_pct::text, c.commission_amount::text,
              c.status, c.entry_type, c.settlement_id, s.settlement_number,
              s.status AS settlement_status, s.paid_at, c.created_at,
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
       ORDER BY c.created_at DESC
       LIMIT 200`,
      params,
    );
    return rows.map((r) => {
      const gross = Number(r.gross_amount);
      const commission = Number(r.commission_amount);
      const payoutState =
        r.settlement_status === 'paid'
          ? 'paid'
          : r.settlement_id
            ? 'settlement_pending'
            : r.status === 'paid_out'
              ? 'paid'
              : 'unpaid';
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
        /** Product sales minus Sabu commission — what admin remits to the vendor. */
        netPayable: Math.round((gross - commission) * 100) / 100,
        status: r.status,
        payoutState,
        settlementId: r.settlement_id,
        settlementNumber: r.settlement_number,
        settlementStatus: r.settlement_status,
        paidAt: r.paid_at,
        entryType: r.entry_type,
        createdAt: r.created_at,
      };
    });
  }

  async listSettlements(opts?: { vendorId?: string }) {
    const params: unknown[] = [];
    const where = ['TRUE'];
    if (opts?.vendorId) {
      params.push(opts.vendorId);
      where.push(`s.vendor_id = $${params.length}`);
    }
    const { rows } = await this.db.query<{
      id: string;
      settlement_number: string;
      vendor_id: string;
      vendor_name: string;
      period_start: string;
      period_end: string;
      gross_sales: string;
      commission_total: string;
      net_payable: string;
      status: string;
      payout_reference: string | null;
      payout_receipt_key: string | null;
      paid_at: Date | null;
      created_at: Date;
    }>(
      `SELECT s.id, s.settlement_number, s.vendor_id, v.display_name AS vendor_name,
              s.period_start::text, s.period_end::text,
              s.gross_sales::text, s.commission_total::text, s.net_payable::text,
              s.status, s.payout_reference, s.payout_receipt_key, s.paid_at, s.created_at
       FROM marketplace.settlements s
       JOIN marketplace.vendors v ON v.id = s.vendor_id
       WHERE ${where.join(' AND ')}
       ORDER BY s.created_at DESC
       LIMIT 100`,
      params,
    );

    const ids = rows.map((r) => r.id);
    const itemsBySettlement = new Map<
      string,
      Array<{
        entryId: string;
        orderNumber: string;
        productSummary: string | null;
        grossAmount: number;
        commissionAmount: number;
        netPayable: number;
      }>
    >();
    if (ids.length) {
      const { rows: items } = await this.db.query<{
        settlement_id: string;
        entry_id: string;
        order_number: string;
        product_summary: string | null;
        gross_amount: string;
        commission_amount: string;
      }>(
        `SELECT si.settlement_id, c.id AS entry_id, o.order_number,
                c.gross_amount::text, c.commission_amount::text,
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
        const list = itemsBySettlement.get(it.settlement_id) ?? [];
        list.push({
          entryId: it.entry_id,
          orderNumber: it.order_number,
          productSummary: it.product_summary,
          grossAmount: gross,
          commissionAmount: fee,
          netPayable: Math.round((gross - fee) * 100) / 100,
        });
        itemsBySettlement.set(it.settlement_id, list);
      }
    }

    return rows.map((r) => ({
      id: r.id,
      settlementNumber: r.settlement_number,
      vendorId: r.vendor_id,
      vendorName: r.vendor_name,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      grossSales: Number(r.gross_sales),
      commissionTotal: Number(r.commission_total),
      netPayable: Number(r.net_payable),
      status: r.status,
      payoutReference: r.payout_reference,
      payoutReceiptKey: r.payout_receipt_key,
      payoutReceiptUrl: r.payout_receipt_key
        ? `/media/file?key=${encodeURIComponent(r.payout_receipt_key)}`
        : null,
      paidAt: r.paid_at,
      createdAt: r.created_at,
      items: itemsBySettlement.get(r.id) ?? [],
    }));
  }

  /**
   * Bundle unpaid commission entries for a vendor into a settlement.
   * Delivery fees stay with Sabu — only merchandise line totals are settled.
   */
  async createSettlement(
    user: AuthUser,
    body: {
      vendorId: string;
      periodStart?: string;
      periodEnd?: string;
      entryIds?: string[];
    },
  ) {
    if (!body.vendorId) throw new BadRequestException('vendorId is required');
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
        throw new BadRequestException(
          'No unpaid vendor sales available to settle',
        );
      }
      const gross = entries.reduce((s, e) => s + Number(e.gross_amount), 0);
      const commission = entries.reduce(
        (s, e) => s + Number(e.commission_amount),
        0,
      );
      const net = Math.round((gross - commission) * 100) / 100;
      const periodStart =
        body.periodStart ??
        entries[0].created_at.toISOString().slice(0, 10);
      const periodEnd =
        body.periodEnd ??
        entries[entries.length - 1].created_at.toISOString().slice(0, 10);
      const settlementNumber = await this.nextDocNumber(client, 'STL');
      const { rows: stl } = await client.query<{ id: string }>(
        `INSERT INTO marketplace.settlements (
           settlement_number, vendor_id, period_start, period_end,
           gross_sales, commission_total, net_payable, status, created_by
         ) VALUES ($1,$2,$3::date,$4::date,$5,$6,$7,'approved',$8)
         RETURNING id`,
        [
          settlementNumber,
          body.vendorId,
          periodStart,
          periodEnd,
          Math.round(gross * 100) / 100,
          Math.round(commission * 100) / 100,
          net,
          user.id,
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
          `UPDATE marketplace.commission_entries
           SET settlement_id = $2
           WHERE id = $1`,
          [e.id, settlementId],
        );
      }
      await client.query('COMMIT');
      const all = await this.listSettlements({ vendorId: body.vendorId });
      return all.find((s) => s.id === settlementId) ?? { id: settlementId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async markSettlementPaid(
    id: string,
    body: {
      payoutReference?: string;
      payoutReceiptKey?: string;
      paidAt?: string;
    },
  ) {
    const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime())) {
      throw new BadRequestException('Invalid payment confirmation date');
    }
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const { rowCount } = await client.query(
        `UPDATE marketplace.settlements SET
           status = 'paid',
           payout_reference = COALESCE($2, payout_reference),
           payout_receipt_key = COALESCE($3, payout_receipt_key),
           paid_at = $4,
           updated_at = now()
         WHERE id = $1 AND status IN ('draft','approved')`,
        [
          id,
          body.payoutReference ?? null,
          body.payoutReceiptKey ?? null,
          paidAt.toISOString(),
        ],
      );
      if (!rowCount) {
        throw new NotFoundException('Settlement not found or already paid');
      }
      await client.query(
        `UPDATE marketplace.commission_entries
         SET status = 'paid_out'
         WHERE settlement_id = $1 AND status IN ('accrued','finalized')`,
        [id],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    const list = await this.listSettlements();
    return list.find((s) => s.id === id) ?? null;
  }

  async getGlobalCommissionRule() {
    const { rows } = await this.db.query<{
      id: string;
      code: string;
      rate_pct: string;
      applies_to: string;
      is_active: boolean;
    }>(
      `SELECT id, code, rate_pct::text, applies_to, is_active
       FROM marketplace.commission_rules
       WHERE scope = 'global' AND is_active
       ORDER BY valid_from DESC LIMIT 1`,
    );
    if (!rows[0]) return { ratePct: 2, code: 'GLOBAL-2PCT', appliesTo: 'merchandise' };
    return {
      id: rows[0].id,
      code: rows[0].code,
      ratePct: Number(rows[0].rate_pct),
      appliesTo: rows[0].applies_to,
      isActive: rows[0].is_active,
    };
  }

  /**
   * Accrue commission for vendor slices of an order (idempotent).
   * Call after payment verified / delivery completed.
   */
  async accrueOrderCommissions(orderId: string) {
    const { rows: lines } = await this.db.query<{
      vendor_id: string;
      gross: string;
    }>(
      `SELECT oi.vendor_id, sum(oi.line_total)::text AS gross
       FROM sales.order_items oi
       WHERE oi.order_id = $1 AND oi.vendor_id IS NOT NULL
       GROUP BY oi.vendor_id`,
      [orderId],
    );
    if (!lines.length) return { created: 0 };

    const rule = await this.getGlobalCommissionRule();
    let created = 0;
    for (const line of lines) {
      const { rows: vendors } = await this.db.query<{
        commission_rate_pct: string | null;
      }>(
        `SELECT commission_rate_pct::text FROM marketplace.vendors WHERE id = $1`,
        [line.vendor_id],
      );
      const rate =
        vendors[0]?.commission_rate_pct != null
          ? Number(vendors[0].commission_rate_pct)
          : rule.ratePct;
      const gross = Number(line.gross);
      const commission = Math.round((gross * rate) / 100 * 100) / 100;
      const key = `sale:${orderId}:${line.vendor_id}`;
      const { rowCount } = await this.db.query(
        `INSERT INTO marketplace.commission_entries (
           order_id, vendor_id, rule_id, gross_amount, rate_pct, commission_amount,
           status, entry_type, idempotency_key, finalized_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,'finalized','sale',$7, now()
         )
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          orderId,
          line.vendor_id,
          (rule as { id?: string }).id ?? null,
          gross,
          rate,
          commission,
          key,
        ],
      );
      if (rowCount) created += 1;
    }
    return { created };
  }

  private async nextDocNumber(client: PoolClient, docType: string) {
    const period = String(new Date().getUTCFullYear());
    await client.query(
      `INSERT INTO core.document_sequences (doc_type, period, next_value)
       VALUES ($1, $2, 1) ON CONFLICT (doc_type, period) DO NOTHING`,
      [docType, period],
    );
    const { rows } = await client.query<{ next_value: string }>(
      `UPDATE core.document_sequences SET next_value = next_value + 1
       WHERE doc_type = $1 AND period = $2
       RETURNING (next_value - 1)::text AS next_value`,
      [docType, period],
    );
    return `${docType}-${period}-${String(Number(rows[0].next_value)).padStart(6, '0')}`;
  }
}

export function sha256hex(input: string) {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function randomToken() {
  return randomBytes(24).toString('base64url');
}
