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

  async listProducts(opts: { category?: string; q?: string; limit?: number }) {
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
      from_price: string | null;
      compare_at_price: string | null;
      currency: string | null;
      image_key: string | null;
      variant_count: string;
    }>(
      `SELECT
         p.id, p.slug, p.name, p.name_am, p.description,
         c.slug AS category_slug, c.name AS category_name,
         b.name AS brand_name,
         min(pli.unit_price)::text AS from_price,
         min(pli.compare_at_price)::text AS compare_at_price,
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
        fromPrice: r.from_price ? Number(r.from_price) : null,
        compareAtPrice: r.compare_at_price ? Number(r.compare_at_price) : null,
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
    }>(
      `SELECT p.id, p.slug, p.name, p.name_am, p.description, p.specifications,
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
    }>(
      `SELECT pv.id, pv.sku, pv.variant_name, pv.options,
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

    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      nameAm: product.name_am,
      description: product.description,
      specifications: product.specifications,
      category: { slug: product.category_slug, name: product.category_name },
      brand: product.brand_name,
      variants: variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        name: v.variant_name,
        options: v.options,
        price: v.unit_price ? Number(v.unit_price) : null,
        compareAtPrice: v.compare_at_price ? Number(v.compare_at_price) : null,
        currency: v.currency ?? 'ETB',
      })),
    };
  }
}
