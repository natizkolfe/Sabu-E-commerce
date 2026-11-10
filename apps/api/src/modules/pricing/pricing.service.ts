import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export type ResolvedPrice = {
  unitPrice: number;
  compareAtPrice: number | null;
  currency: string;
  priceListItemId: string;
  priceListCode: string;
  minQty: number;
};

@Injectable()
export class PricingService {
  readonly schema = 'pricing' as const;

  constructor(private readonly db: DatabaseService) {}

  /**
   * Highest min_qty tier that is still <= quantity on the given list
   * (RETAIL-ETB or WHOLESALE-ETB). Falls back to retail if wholesale miss.
   */
  async resolveUnitPrice(
    variantId: string,
    quantity: number,
    listCode: 'RETAIL-ETB' | 'WHOLESALE-ETB' = 'RETAIL-ETB',
  ): Promise<ResolvedPrice> {
    const qty = Math.max(1, quantity);
    const primary = await this.lookupTier(variantId, qty, listCode);
    if (primary) return primary;
    if (listCode !== 'RETAIL-ETB') {
      const retail = await this.lookupTier(variantId, qty, 'RETAIL-ETB');
      if (retail) return retail;
    }
    throw new NotFoundException(`No price for variant ${variantId}`);
  }

  private async lookupTier(
    variantId: string,
    qty: number,
    listCode: string,
  ): Promise<ResolvedPrice | null> {
    const { rows } = await this.db.query<{
      id: string;
      unit_price: string;
      compare_at_price: string | null;
      currency: string;
      code: string;
      min_qty: number;
    }>(
      `SELECT pli.id, pli.unit_price::text, pli.compare_at_price::text,
              pl.currency, pl.code, pli.min_qty
       FROM pricing.price_list_items pli
       JOIN pricing.price_lists pl ON pl.id = pli.price_list_id
       WHERE pli.variant_id = $1
         AND pl.code = $2
         AND pl.is_active
         AND pli.min_qty <= $3
         AND pli.valid_during @> now()
       ORDER BY pli.min_qty DESC
       LIMIT 1`,
      [variantId, listCode, qty],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      unitPrice: Number(r.unit_price),
      compareAtPrice: r.compare_at_price ? Number(r.compare_at_price) : null,
      currency: r.currency,
      priceListItemId: r.id,
      priceListCode: r.code,
      minQty: r.min_qty,
    };
  }

  async listActiveTiers(variantId: string) {
    const { rows } = await this.db.query<{
      id: string;
      list_code: string;
      min_qty: number;
      unit_price: string;
      compare_at_price: string | null;
    }>(
      `SELECT pli.id, pl.code AS list_code, pli.min_qty,
              pli.unit_price::text, pli.compare_at_price::text
       FROM pricing.price_list_items pli
       JOIN pricing.price_lists pl ON pl.id = pli.price_list_id
       WHERE pli.variant_id = $1
         AND pl.is_active
         AND pli.valid_during @> now()
       ORDER BY pl.code, pli.min_qty`,
      [variantId],
    );
    return rows.map((r) => ({
      id: r.id,
      listCode: r.list_code,
      minQty: r.min_qty,
      unitPrice: Number(r.unit_price),
      compareAtPrice: r.compare_at_price ? Number(r.compare_at_price) : null,
    }));
  }

  async setTierPrice(input: {
    listCode: string;
    variantId: string;
    minQty: number;
    unitPrice: number;
    compareAtPrice?: number | null;
    actorId?: string;
  }) {
    const { rows: lists } = await this.db.query<{ id: string }>(
      `SELECT id FROM pricing.price_lists WHERE code = $1`,
      [input.listCode],
    );
    if (!lists[0]) throw new NotFoundException('Price list not found');

    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE pricing.price_list_items
         SET valid_during = tstzrange(lower(valid_during), now(), '[)')
         WHERE price_list_id = $1 AND variant_id = $2 AND min_qty = $3
           AND upper_inf(valid_during)`,
        [lists[0].id, input.variantId, input.minQty],
      );
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO pricing.price_list_items (
           price_list_id, variant_id, min_qty, unit_price, compare_at_price, created_by, valid_during
         ) VALUES ($1,$2,$3,$4,$5,$6, tstzrange(now(), NULL))
         RETURNING id`,
        [
          lists[0].id,
          input.variantId,
          input.minQty,
          input.unitPrice,
          input.compareAtPrice ?? null,
          input.actorId ?? null,
        ],
      );
      await client.query('COMMIT');
      return { id: rows[0].id };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
