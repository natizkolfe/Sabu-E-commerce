import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class CatalogService {
  readonly schema = 'catalog' as const;

  constructor(private readonly db: DatabaseService) {}

  async listCategories() {
    const { rows } = await this.db.query<{
      id: string;
      parent_id: string | null;
      slug: string;
      name: string;
      name_am: string | null;
      path: string;
      sort_order: number;
    }>(
      `SELECT id, parent_id, slug, name, name_am, path, sort_order
       FROM catalog.categories
       WHERE is_active = true
       ORDER BY sort_order, name`,
    );
    return rows.map((r) => ({
      id: r.id,
      parentId: r.parent_id,
      slug: r.slug,
      name: r.name,
      nameAm: r.name_am,
      path: r.path,
      sortOrder: r.sort_order,
    }));
  }

  async listProducts(opts: {
    category?: string;
    q?: string;
    limit?: number;
    bulkOnly?: boolean;
  }) {
    const limit = Math.min(Math.max(opts.limit ?? 48, 1), 100);
    const params: unknown[] = [];
    const where = [`p.status = 'active'`, `p.deleted_at IS NULL`];

    if (opts.category) {
      params.push(opts.category);
      where.push(
        `(c.slug = $${params.length} OR c.path LIKE $${params.length} || '/%' OR c.path LIKE '%/' || $${params.length} || '/%')`,
      );
    }
    if (opts.q) {
      params.push(`%${opts.q}%`);
      where.push(
        `(p.name ILIKE $${params.length} OR p.name_am ILIKE $${params.length} OR p.description ILIKE $${params.length})`,
      );
    }
    if (opts.bulkOnly) {
      where.push(`p.bulk_purchasing_enabled = true`);
    }

    params.push(limit);
    const { rows } = await this.db.query<{
      id: string;
      slug: string;
      name: string;
      name_am: string | null;
      description: string | null;
      category_slug: string;
      category_name: string;
      brand_name: string | null;
      bulk_purchasing_enabled: boolean;
      from_price: string | null;
      compare_at_price: string | null;
      wholesale_from: string | null;
      currency: string | null;
      image_key: string | null;
      variant_count: string;
    }>(
      `SELECT
         p.id, p.slug, p.name, p.name_am, p.description,
         p.bulk_purchasing_enabled,
         c.slug AS category_slug, c.name AS category_name,
         b.name AS brand_name,
         min(pli.unit_price)::text AS from_price,
         min(pli.compare_at_price)::text AS compare_at_price,
         (
           SELECT min(wpli.unit_price)::text
           FROM catalog.product_variants wpv
           JOIN pricing.price_list_items wpli ON wpli.variant_id = wpv.id
             AND wpli.valid_during @> now()
           JOIN pricing.price_lists wpl ON wpl.id = wpli.price_list_id
             AND wpl.code = 'WHOLESALE-ETB' AND wpl.is_active
           WHERE wpv.product_id = p.id AND wpv.deleted_at IS NULL AND wpv.is_active
             AND wpli.min_qty >= 10
         ) AS wholesale_from,
         pl.currency,
         (
           SELECT pi.storage_key FROM catalog.product_images pi
           WHERE pi.product_id = p.id
           ORDER BY pi.is_primary DESC, pi.sort_order
           LIMIT 1
         ) AS image_key,
         count(DISTINCT pv.id)::text AS variant_count
       FROM catalog.products p
       JOIN catalog.categories c ON c.id = p.category_id
       LEFT JOIN catalog.brands b ON b.id = p.brand_id
       LEFT JOIN catalog.product_variants pv
         ON pv.product_id = p.id AND pv.deleted_at IS NULL AND pv.is_active
       LEFT JOIN pricing.price_list_items pli
         ON pli.variant_id = pv.id
        AND pli.min_qty = 1
        AND pli.valid_during @> now()
       LEFT JOIN pricing.price_lists pl
         ON pl.id = pli.price_list_id
        AND pl.code = 'RETAIL-ETB'
        AND pl.is_active
       WHERE ${where.join(' AND ')}
       GROUP BY p.id, c.slug, c.name, b.name, pl.currency
       ORDER BY p.name
       LIMIT $${params.length}`,
      params,
    );

    return {
      items: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        nameAm: r.name_am,
        description: r.description,
        category: { slug: r.category_slug, name: r.category_name },
        brand: r.brand_name,
        bulkPurchasingEnabled: r.bulk_purchasing_enabled,
        fromPrice: r.from_price ? Number(r.from_price) : null,
        compareAtPrice: r.compare_at_price ? Number(r.compare_at_price) : null,
        wholesaleFromPrice: r.wholesale_from ? Number(r.wholesale_from) : null,
        currency: r.currency ?? 'ETB',
        imageKey: r.image_key,
        variantCount: Number(r.variant_count),
      })),
    };
  }

  async getProductBySlug(slug: string) {
    const { rows } = await this.db.query<{
      id: string;
      slug: string;
      name: string;
      name_am: string | null;
      description: string | null;
      specifications: Record<string, unknown>;
      category_slug: string;
      category_name: string;
      brand_name: string | null;
      bulk_purchasing_enabled: boolean;
    }>(
      `SELECT p.id, p.slug, p.name, p.name_am, p.description, p.specifications,
              p.bulk_purchasing_enabled,
              c.slug AS category_slug, c.name AS category_name, b.name AS brand_name
       FROM catalog.products p
       JOIN catalog.categories c ON c.id = p.category_id
       LEFT JOIN catalog.brands b ON b.id = p.brand_id
       WHERE p.slug = $1 AND p.status = 'active' AND p.deleted_at IS NULL`,
      [slug],
    );
    const product = rows[0];
    if (!product) throw new NotFoundException('Product not found');

    const { rows: variants } = await this.db.query<{
      id: string;
      sku: string;
      variant_name: string | null;
      options: Record<string, unknown>;
      unit_price: string | null;
      compare_at_price: string | null;
      currency: string | null;
      min_order_qty_wholesale: number;
    }>(
      `SELECT pv.id, pv.sku, pv.variant_name, pv.options,
              pv.min_order_qty_wholesale,
              pli.unit_price::text, pli.compare_at_price::text, pl.currency
       FROM catalog.product_variants pv
       LEFT JOIN pricing.price_list_items pli
         ON pli.variant_id = pv.id AND pli.min_qty = 1 AND pli.valid_during @> now()
       LEFT JOIN pricing.price_lists pl
         ON pl.id = pli.price_list_id AND pl.code = 'RETAIL-ETB'
       WHERE pv.product_id = $1 AND pv.deleted_at IS NULL AND pv.is_active
       ORDER BY pv.variant_name`,
      [product.id],
    );

    const { rows: tiers } = await this.db.query<{
      variant_id: string;
      list_code: string;
      min_qty: number;
      unit_price: string;
    }>(
      `SELECT pli.variant_id, pl.code AS list_code, pli.min_qty, pli.unit_price::text
       FROM pricing.price_list_items pli
       JOIN pricing.price_lists pl ON pl.id = pli.price_list_id
       WHERE pli.variant_id = ANY($1::uuid[])
         AND pl.code IN ('RETAIL-ETB', 'WHOLESALE-ETB')
         AND pl.is_active
         AND pli.valid_during @> now()
       ORDER BY pl.code, pli.min_qty`,
      [variants.map((v) => v.id)],
    );

    const tiersByVariant = new Map<
      string,
      Array<{ listCode: string; minQty: number; unitPrice: number }>
    >();
    for (const t of tiers) {
      const list = tiersByVariant.get(t.variant_id) ?? [];
      list.push({
        listCode: t.list_code,
        minQty: t.min_qty,
        unitPrice: Number(t.unit_price),
      });
      tiersByVariant.set(t.variant_id, list);
    }

    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      nameAm: product.name_am,
      description: product.description,
      specifications: product.specifications,
      category: { slug: product.category_slug, name: product.category_name },
      brand: product.brand_name,
      bulkPurchasingEnabled: product.bulk_purchasing_enabled,
      variants: variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        name: v.variant_name,
        options: v.options,
        price: v.unit_price ? Number(v.unit_price) : null,
        compareAtPrice: v.compare_at_price ? Number(v.compare_at_price) : null,
        currency: v.currency ?? 'ETB',
        minOrderQtyWholesale: v.min_order_qty_wholesale,
        priceTiers: tiersByVariant.get(v.id) ?? [],
      })),
    };
  }

  async adminListProducts(opts: {
    limit?: number;
    q?: string;
    status?: string;
    bulkOnly?: boolean;
  } = {}) {
    const limit = Math.min(opts.limit ?? 100, 200);
    const params: unknown[] = [];
    const where = [`p.deleted_at IS NULL`];

    if (opts.q) {
      params.push(`%${opts.q}%`);
      where.push(
        `(p.name ILIKE $${params.length} OR p.slug ILIKE $${params.length} OR p.name_am ILIKE $${params.length})`,
      );
    }
    if (opts.status) {
      params.push(opts.status);
      where.push(`p.status = $${params.length}`);
    }
    if (opts.bulkOnly) {
      where.push(`p.bulk_purchasing_enabled = true`);
    }

    params.push(limit);
    const { rows } = await this.db.query<{
      id: string;
      slug: string;
      name: string;
      status: string;
      bulk_purchasing_enabled: boolean;
      category_name: string;
      variant_count: string;
    }>(
      `SELECT p.id, p.slug, p.name, p.status, p.bulk_purchasing_enabled,
              c.name AS category_name,
              count(pv.id)::text AS variant_count
       FROM catalog.products p
       JOIN catalog.categories c ON c.id = p.category_id
       LEFT JOIN catalog.product_variants pv
         ON pv.product_id = p.id AND pv.deleted_at IS NULL
       WHERE ${where.join(' AND ')}
       GROUP BY p.id, c.name
       ORDER BY p.updated_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      status: r.status,
      bulkPurchasingEnabled: r.bulk_purchasing_enabled,
      categoryName: r.category_name,
      variantCount: Number(r.variant_count),
    }));
  }

  async adminGetProduct(productId: string) {
    const { rows } = await this.db.query<{
      id: string;
      slug: string;
      name: string;
      name_am: string | null;
      description: string | null;
      status: string;
      category_id: string;
      category_name: string;
      bulk_purchasing_enabled: boolean;
    }>(
      `SELECT p.id, p.slug, p.name, p.name_am, p.description, p.status,
              p.category_id, c.name AS category_name, p.bulk_purchasing_enabled
       FROM catalog.products p
       JOIN catalog.categories c ON c.id = p.category_id
       WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [productId],
    );
    if (!rows[0]) throw new NotFoundException('Product not found');
    const p = rows[0];

    const { rows: variants } = await this.db.query<{
      id: string;
      sku: string;
      variant_name: string | null;
      options: Record<string, unknown>;
      is_active: boolean;
      min_order_qty_wholesale: number;
    }>(
      `SELECT pv.id, pv.sku, pv.variant_name, pv.options, pv.is_active,
              pv.min_order_qty_wholesale
       FROM catalog.product_variants pv
       WHERE pv.product_id = $1 AND pv.deleted_at IS NULL
       ORDER BY pv.sku`,
      [productId],
    );

    const variantIds = variants.map((v) => v.id);
    const { rows: tiers } = await this.db.query<{
      variant_id: string;
      list_code: string;
      min_qty: number;
      unit_price: string;
      compare_at_price: string | null;
    }>(
      variantIds.length
        ? `SELECT pli.variant_id, pl.code AS list_code, pli.min_qty,
                  pli.unit_price::text, pli.compare_at_price::text
           FROM pricing.price_list_items pli
           JOIN pricing.price_lists pl ON pl.id = pli.price_list_id
           WHERE pli.variant_id = ANY($1::uuid[])
             AND pl.code IN ('RETAIL-ETB','WHOLESALE-ETB')
             AND pl.is_active
             AND pli.valid_during @> now()
           ORDER BY pl.code, pli.min_qty`
        : `SELECT NULL::uuid AS variant_id, NULL::text AS list_code,
                  0 AS min_qty, NULL::text AS unit_price, NULL::text AS compare_at_price
           WHERE false`,
      variantIds.length ? [variantIds] : [],
    );

    const tiersByVariant = new Map<
      string,
      Array<{
        listCode: string;
        minQty: number;
        unitPrice: number;
        compareAtPrice: number | null;
      }>
    >();
    for (const t of tiers) {
      if (!t.variant_id) continue;
      const list = tiersByVariant.get(t.variant_id) ?? [];
      list.push({
        listCode: t.list_code,
        minQty: t.min_qty,
        unitPrice: Number(t.unit_price),
        compareAtPrice: t.compare_at_price ? Number(t.compare_at_price) : null,
      });
      tiersByVariant.set(t.variant_id, list);
    }

    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      nameAm: p.name_am,
      description: p.description,
      status: p.status,
      categoryId: p.category_id,
      categoryName: p.category_name,
      bulkPurchasingEnabled: p.bulk_purchasing_enabled,
      variants: variants.map((v) => {
        const priceTiers = tiersByVariant.get(v.id) ?? [];
        const retail = priceTiers.find(
          (t) => t.listCode === 'RETAIL-ETB' && t.minQty === 1,
        );
        const wholesale10 = priceTiers.find(
          (t) => t.listCode === 'WHOLESALE-ETB' && t.minQty === 10,
        );
        return {
          id: v.id,
          sku: v.sku,
          name: v.variant_name,
          options: v.options,
          isActive: v.is_active,
          minOrderQtyWholesale: v.min_order_qty_wholesale,
          retailPrice: retail?.unitPrice ?? null,
          wholesaleQty10: wholesale10?.unitPrice ?? null,
          priceTiers,
        };
      }),
    };
  }

  async createProduct(input: {
    categoryId: string;
    slug: string;
    name: string;
    nameAm?: string;
    description?: string;
    status?: string;
    bulkPurchasingEnabled?: boolean;
    actorId?: string;
  }) {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO catalog.products (
         category_id, slug, name, name_am, description, status,
         bulk_purchasing_enabled, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        input.categoryId,
        input.slug,
        input.name,
        input.nameAm ?? null,
        input.description ?? null,
        input.status ?? 'draft',
        input.bulkPurchasingEnabled ?? false,
        input.actorId ?? null,
      ],
    );
    return { id: rows[0].id };
  }

  async updateProduct(
    productId: string,
    input: {
      name?: string;
      nameAm?: string | null;
      description?: string | null;
      status?: string;
      bulkPurchasingEnabled?: boolean;
    },
  ) {
    const { rowCount } = await this.db.query(
      `UPDATE catalog.products SET
         name = COALESCE($2, name),
         name_am = COALESCE($3, name_am),
         description = COALESCE($4, description),
         status = COALESCE($5, status),
         bulk_purchasing_enabled = COALESCE($6, bulk_purchasing_enabled),
         updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL`,
      [
        productId,
        input.name ?? null,
        input.nameAm ?? null,
        input.description ?? null,
        input.status ?? null,
        input.bulkPurchasingEnabled ?? null,
      ],
    );
    if (!rowCount) throw new NotFoundException('Product not found');
    return this.adminGetProduct(productId);
  }

  async createVariant(input: {
    productId: string;
    sku: string;
    variantName?: string;
    options?: Record<string, unknown>;
  }) {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO catalog.product_variants (
         product_id, sku, variant_name, options
       ) VALUES ($1,$2,$3,$4::jsonb)
       RETURNING id`,
      [
        input.productId,
        input.sku,
        input.variantName ?? null,
        JSON.stringify(input.options ?? {}),
      ],
    );
    return { id: rows[0].id };
  }

  async updateVariant(
    variantId: string,
    input: {
      variantName?: string;
      options?: Record<string, unknown>;
      isActive?: boolean;
    },
  ) {
    const { rowCount } = await this.db.query(
      `UPDATE catalog.product_variants SET
         variant_name = COALESCE($2, variant_name),
         options = COALESCE($3::jsonb, options),
         is_active = COALESCE($4, is_active)
       WHERE id = $1 AND deleted_at IS NULL`,
      [
        variantId,
        input.variantName ?? null,
        input.options ? JSON.stringify(input.options) : null,
        input.isActive ?? null,
      ],
    );
    if (!rowCount) throw new NotFoundException('Variant not found');
    return { ok: true };
  }

  async listAttributes() {
    const { rows } = await this.db.query<{
      id: string;
      code: string;
      name: string;
      name_am: string | null;
      value_id: string | null;
      value_code: string | null;
      value_label: string | null;
    }>(
      `SELECT a.id, a.code, a.name, a.name_am,
              v.id AS value_id, v.code AS value_code, v.label AS value_label
       FROM catalog.attributes a
       LEFT JOIN catalog.attribute_values v ON v.attribute_id = a.id
       ORDER BY a.sort_order, v.sort_order`,
    );
    const map = new Map<
      string,
      {
        id: string;
        code: string;
        name: string;
        nameAm: string | null;
        values: Array<{ id: string; code: string; label: string }>;
      }
    >();
    for (const r of rows) {
      if (!map.has(r.id)) {
        map.set(r.id, {
          id: r.id,
          code: r.code,
          name: r.name,
          nameAm: r.name_am,
          values: [],
        });
      }
      if (r.value_id && r.value_code && r.value_label) {
        map.get(r.id)!.values.push({
          id: r.value_id,
          code: r.value_code,
          label: r.value_label,
        });
      }
    }
    return [...map.values()];
  }

  async setVariantAttributes(variantId: string, attributeValueIds: string[]) {
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM catalog.variant_attribute_values WHERE variant_id = $1`,
        [variantId],
      );
      for (const valueId of attributeValueIds) {
        await client.query(
          `INSERT INTO catalog.variant_attribute_values (variant_id, attribute_value_id)
           VALUES ($1,$2)`,
          [variantId, valueId],
        );
      }
      // Denormalize into options JSONB
      const { rows } = await client.query<{
        attr: string;
        label: string;
      }>(
        `SELECT a.code AS attr, v.label
         FROM catalog.variant_attribute_values x
         JOIN catalog.attribute_values v ON v.id = x.attribute_value_id
         JOIN catalog.attributes a ON a.id = v.attribute_id
         WHERE x.variant_id = $1`,
        [variantId],
      );
      const options: Record<string, string> = {};
      for (const r of rows) options[r.attr] = r.label;
      await client.query(
        `UPDATE catalog.product_variants SET options = $2::jsonb WHERE id = $1`,
        [variantId, JSON.stringify(options)],
      );
      await client.query('COMMIT');
      return { ok: true, options };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
