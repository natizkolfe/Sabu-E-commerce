import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class CatalogService {
  readonly schema = 'catalog' as const;

  constructor(private readonly db: DatabaseService) {}

  async listCategories(opts?: { tree?: boolean; includeInactive?: boolean }) {
    const { rows } = await this.db.query<{
      id: string;
      parent_id: string | null;
      slug: string;
      name: string;
      name_am: string | null;
      path: string;
      sort_order: number;
      is_active: boolean;
      is_featured: boolean;
      featured_sort: number;
      description: string | null;
      image_storage_key: string | null;
      icon_storage_key: string | null;
      meta_title: string | null;
      meta_description: string | null;
      ai_studio_enabled: boolean;
    }>(
      `SELECT id, parent_id, slug, name, name_am, path, sort_order,
              is_active, is_featured, featured_sort, description,
              image_storage_key, icon_storage_key, meta_title, meta_description,
              ai_studio_enabled
       FROM catalog.categories
       WHERE (${opts?.includeInactive ? 'true' : 'is_active = true'})
       ORDER BY sort_order, name`,
    );
    const items = rows.map((r) => ({
      id: r.id,
      parentId: r.parent_id,
      slug: r.slug,
      name: r.name,
      nameAm: r.name_am,
      path: r.path,
      sortOrder: r.sort_order,
      isActive: r.is_active,
      isFeatured: r.is_featured,
      featuredSort: r.featured_sort,
      description: r.description,
      imageKey: r.image_storage_key,
      iconKey: r.icon_storage_key,
      metaTitle: r.meta_title,
      metaDescription: r.meta_description,
      aiStudioEnabled: r.ai_studio_enabled,
    }));
    if (!opts?.tree) return items;

    type Node = (typeof items)[number] & { children: Node[] };
    const map = new Map<string, Node>();
    for (const item of items) map.set(item.id, { ...item, children: [] });
    const roots: Node[] = [];
    for (const node of map.values()) {
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    const sortNodes = (nodes: Node[]) => {
      nodes.sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      );
      for (const n of nodes) sortNodes(n.children);
    };
    sortNodes(roots);
    return roots;
  }

  async listProducts(opts: {
    category?: string;
    q?: string;
    limit?: number;
    bulkOnly?: boolean;
    minPrice?: number;
    maxPrice?: number;
    brand?: string;
    attribute?: string;
    inStock?: boolean;
    onSale?: boolean;
    newArrivals?: boolean;
    retailOnly?: boolean;
    wholesaleOnly?: boolean;
    sort?: string;
  }) {
    const limit = Math.min(Math.max(opts.limit ?? 48, 1), 100);
    const params: unknown[] = [];
    const where = [`p.status = 'active'`, `p.deleted_at IS NULL`];
    const having: string[] = [];

    if (opts.category) {
      params.push(opts.category);
      // Match primary or secondary category assignment within the slug subtree
      where.push(`EXISTS (
        SELECT 1
        FROM catalog.categories root
        JOIN catalog.categories leaf ON (
          leaf.id = root.id
          OR leaf.path = root.path
          OR leaf.path LIKE root.path || '/%'
        )
        WHERE root.slug = $${params.length}
          AND (
            p.category_id = leaf.id
            OR EXISTS (
              SELECT 1 FROM catalog.product_categories pc
              WHERE pc.product_id = p.id AND pc.category_id = leaf.id
            )
          )
      )`);
    }
    if (opts.q) {
      params.push(`%${opts.q}%`);
      where.push(
        `(p.name ILIKE $${params.length} OR p.name_am ILIKE $${params.length} OR p.description ILIKE $${params.length} OR b.name ILIKE $${params.length})`,
      );
    }
    if (opts.bulkOnly || opts.wholesaleOnly) {
      where.push(`p.bulk_purchasing_enabled = true`);
    }
    if (opts.retailOnly) {
      where.push(`p.bulk_purchasing_enabled = false`);
    }
    if (opts.brand) {
      params.push(opts.brand.toLowerCase());
      where.push(`lower(b.name) = $${params.length}`);
    }
    if (opts.attribute) {
      // attribute=size:M or color:blue (code:value)
      const [attrCode, attrValue] = opts.attribute.split(':');
      if (attrCode && attrValue) {
        params.push(attrCode.toLowerCase(), attrValue.toLowerCase());
        const aIdx = params.length - 1;
        const vIdx = params.length;
        where.push(`EXISTS (
          SELECT 1 FROM catalog.product_variants pv2
          JOIN catalog.variant_attribute_values vav ON vav.variant_id = pv2.id
          JOIN catalog.attribute_values av ON av.id = vav.attribute_value_id
          JOIN catalog.attributes a ON a.id = av.attribute_id
          WHERE pv2.product_id = p.id AND pv2.deleted_at IS NULL AND pv2.is_active
            AND lower(a.code) = $${aIdx} AND lower(av.code) = $${vIdx}
        )`);
      }
    }
    if (opts.inStock) {
      where.push(`EXISTS (
        SELECT 1 FROM catalog.product_variants pv3
        JOIN inventory.stock_balances sb ON sb.variant_id = pv3.id
        JOIN inventory.warehouses w ON w.id = sb.warehouse_id AND w.code = 'ADD-MAIN'
        WHERE pv3.product_id = p.id AND pv3.deleted_at IS NULL AND pv3.is_active
          AND sb.qty_on_hand - sb.qty_reserved > 0
      )`);
    }
    if (opts.onSale) {
      having.push(
        `min(pli.compare_at_price) IS NOT NULL AND min(pli.compare_at_price) > min(pli.unit_price)`,
      );
    }
    if (opts.newArrivals) {
      where.push(`p.created_at >= now() - interval '60 days'`);
    }
    if (opts.minPrice != null && !Number.isNaN(opts.minPrice)) {
      params.push(opts.minPrice);
      having.push(`min(pli.unit_price) >= $${params.length}`);
    }
    if (opts.maxPrice != null && !Number.isNaN(opts.maxPrice)) {
      params.push(opts.maxPrice);
      having.push(`min(pli.unit_price) <= $${params.length}`);
    }

    const sort = opts.sort ?? 'newest';
    let orderBy = 'p.created_at DESC NULLS LAST, p.name';
    if (sort === 'price_asc') orderBy = 'min(pli.unit_price) ASC NULLS LAST, p.name';
    else if (sort === 'price_desc')
      orderBy = 'min(pli.unit_price) DESC NULLS LAST, p.name';
    else if (sort === 'newest') orderBy = 'p.created_at DESC NULLS LAST, p.name';
    else if (sort === 'popular' || sort === 'bestselling')
      orderBy = `COALESCE((
        SELECT sum(oi.quantity) FROM sales.order_items oi
        JOIN catalog.product_variants pv4 ON pv4.id = oi.variant_id
        WHERE pv4.product_id = p.id
      ), 0) DESC, p.name`;
    else if (sort === 'rating') orderBy = 'p.name';

    params.push(limit);
    const havingSql = having.length ? `HAVING ${having.join(' AND ')}` : '';
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
      in_stock: boolean;
      created_at: Date;
    }>(
      `SELECT
         p.id, p.slug, p.name, p.name_am, p.description,
         p.bulk_purchasing_enabled, p.created_at,
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
         count(DISTINCT pv.id)::text AS variant_count,
         EXISTS (
           SELECT 1 FROM catalog.product_variants pv3
           JOIN inventory.stock_balances sb ON sb.variant_id = pv3.id
           JOIN inventory.warehouses w ON w.id = sb.warehouse_id AND w.code = 'ADD-MAIN'
           WHERE pv3.product_id = p.id AND pv3.deleted_at IS NULL AND pv3.is_active
             AND sb.qty_on_hand - sb.qty_reserved > 0
         ) AS in_stock
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
       ${havingSql}
       ORDER BY ${orderBy}
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
        imageUrl: r.image_key
          ? `/media/file?key=${encodeURIComponent(r.image_key)}`
          : null,
        variantCount: Number(r.variant_count),
        inStock: r.in_stock,
        createdAt: r.created_at,
      })),
      sort,
    };
  }

  async listFacets(opts?: { category?: string }) {
    const params: unknown[] = [];
    let productScope = `p.status = 'active' AND p.deleted_at IS NULL`;
    if (opts?.category) {
      params.push(opts.category);
      productScope += ` AND EXISTS (
        SELECT 1
        FROM catalog.categories root
        JOIN catalog.categories leaf ON (
          leaf.id = root.id
          OR leaf.path = root.path
          OR leaf.path LIKE root.path || '/%'
        )
        WHERE root.slug = $${params.length}
          AND (
            p.category_id = leaf.id
            OR EXISTS (
              SELECT 1 FROM catalog.product_categories pc
              WHERE pc.product_id = p.id AND pc.category_id = leaf.id
            )
          )
      )`;
    }

    const { rows: brands } = await this.db.query<{
      name: string;
      count: string;
    }>(
      `SELECT b.name, count(p.id)::text AS count
       FROM catalog.brands b
       JOIN catalog.products p ON p.brand_id = b.id
       WHERE ${productScope}
       GROUP BY b.name
       ORDER BY b.name`,
      params,
    );

    // Prefer attributes assigned to the category tree; fall back to all filterable attrs
    let attrScope = `a.is_filterable = true`;
    if (opts?.category) {
      attrScope += ` AND (
        EXISTS (
          SELECT 1
          FROM catalog.categories root
          JOIN catalog.categories leaf ON (
            leaf.id = root.id OR leaf.path = root.path OR leaf.path LIKE root.path || '/%'
          )
          JOIN catalog.category_attribute_sets cas ON cas.category_id = leaf.id
          WHERE root.slug = $1 AND cas.attribute_id = a.id
        )
        OR NOT EXISTS (
          SELECT 1
          FROM catalog.categories root
          JOIN catalog.categories leaf ON (
            leaf.id = root.id OR leaf.path = root.path OR leaf.path LIKE root.path || '/%'
          )
          JOIN catalog.category_attribute_sets cas ON cas.category_id = leaf.id
          WHERE root.slug = $1
        )
      )`;
    }

    const { rows: attrs } = await this.db.query<{
      attr_code: string;
      attr_name: string;
      data_type: string;
      value_code: string;
      value_label: string;
      count: string;
    }>(
      `SELECT a.code AS attr_code, a.name AS attr_name, a.data_type,
              av.code AS value_code, av.label AS value_label,
              count(DISTINCT pv.product_id)::text AS count
       FROM catalog.attributes a
       JOIN catalog.attribute_values av ON av.attribute_id = a.id
       JOIN catalog.variant_attribute_values vav ON vav.attribute_value_id = av.id
       JOIN catalog.product_variants pv ON pv.id = vav.variant_id
         AND pv.deleted_at IS NULL AND pv.is_active
       JOIN catalog.products p ON p.id = pv.product_id
       WHERE ${productScope}
         AND ${attrScope}
       GROUP BY a.code, a.name, a.data_type, av.code, av.label, a.sort_order, av.sort_order
       ORDER BY a.sort_order, av.sort_order`,
      params,
    );
    const byAttr = new Map<
      string,
      {
        code: string;
        name: string;
        dataType: string;
        values: Array<{ code: string; label: string; count: number }>;
      }
    >();
    for (const r of attrs) {
      let entry = byAttr.get(r.attr_code);
      if (!entry) {
        entry = {
          code: r.attr_code,
          name: r.attr_name,
          dataType: r.data_type,
          values: [],
        };
        byAttr.set(r.attr_code, entry);
      }
      entry.values.push({
        code: r.value_code,
        label: r.value_label,
        count: Number(r.count),
      });
    }
    return {
      brands: brands.map((b) => ({ name: b.name, count: Number(b.count) })),
      attributes: [...byAttr.values()],
      category: opts?.category ?? null,
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
      returns_allowed: boolean;
      return_window_days: number | null;
      return_conditions: string | null;
      return_instructions: string | null;
      return_policy_description: string | null;
    }>(
      `SELECT p.id, p.slug, p.name, p.name_am, p.description, p.specifications,
              p.bulk_purchasing_enabled,
              p.returns_allowed, p.return_window_days, p.return_conditions,
              p.return_instructions, p.return_policy_description,
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

    const { rows: aiPreviews } = await this.db.query<{
      id: string;
      storage_key: string;
      variant_id: string | null;
    }>(
      `SELECT id, storage_key, variant_id
       FROM studio.generated_images
       WHERE product_id = $1
         AND published = true
         AND review_status = 'approved'
       ORDER BY created_at DESC`,
      [product.id],
    );

    const images = await this.listProductImages(product.id);
    const primaryImage = images.find((i) => i.isPrimary) ?? images[0] ?? null;

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
      returnsAllowed: product.returns_allowed !== false,
      returnWindowDays: product.return_window_days ?? 7,
      returnConditions: product.return_conditions,
      returnInstructions: product.return_instructions,
      returnPolicyDescription: product.return_policy_description,
      returnPolicyLabel:
        product.returns_allowed === false
          ? 'No Returns Available for This Item.'
          : `Returns within ${product.return_window_days ?? 7} day(s)`,
      imageKey: primaryImage?.storageKey ?? null,
      imageUrl: primaryImage?.url ?? null,
      images,
      aiPreviews: aiPreviews.map((img) => ({
        id: img.id,
        storageKey: img.storage_key,
        variantId: img.variant_id,
        isAiPreview: true as const,
        previewUrl: img.storage_key.includes('/enhanced/')
          ? `/media/file?key=${encodeURIComponent(img.storage_key)}`
          : `/studio/images/${img.id}/preview`,
      })),
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
        `(p.name ILIKE $${params.length} OR p.slug ILIKE $${params.length} OR p.name_am ILIKE $${params.length} OR p.retail_number ILIKE $${params.length})`,
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
      retail_number: string | null;
      bulk_purchasing_enabled: boolean;
      category_name: string;
      variant_count: string;
    }>(
      `SELECT p.id, p.slug, p.name, p.status, p.retail_number,
              p.bulk_purchasing_enabled,
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
      retailNumber: r.retail_number,
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
      retail_number: string | null;
      category_id: string;
      category_name: string;
      brand_id: string | null;
      brand_name: string | null;
      bulk_purchasing_enabled: boolean;
      returns_allowed: boolean;
      return_window_days: number | null;
      return_conditions: string | null;
      return_instructions: string | null;
      return_policy_description: string | null;
      return_policy_effective_at: Date | null;
    }>(
      `SELECT p.id, p.slug, p.name, p.name_am, p.description, p.status,
              p.retail_number, p.category_id, c.name AS category_name,
              p.brand_id, b.name AS brand_name,
              p.bulk_purchasing_enabled,
              p.returns_allowed, p.return_window_days, p.return_conditions,
              p.return_instructions, p.return_policy_description,
              p.return_policy_effective_at
       FROM catalog.products p
       JOIN catalog.categories c ON c.id = p.category_id
       LEFT JOIN catalog.brands b ON b.id = p.brand_id
       WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [productId],
    );
    if (!rows[0]) throw new NotFoundException('Product not found');
    const p = rows[0];

    const { rows: categoryLinks } = await this.db.query<{
      category_id: string;
      is_primary: boolean;
      name: string;
    }>(
      `SELECT pc.category_id, pc.is_primary, c.name
       FROM catalog.product_categories pc
       JOIN catalog.categories c ON c.id = pc.category_id
       WHERE pc.product_id = $1
       ORDER BY pc.is_primary DESC, c.name`,
      [productId],
    );

    const images = await this.listProductImages(productId);

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
      retailNumber: p.retail_number,
      categoryId: p.category_id,
      categoryName: p.category_name,
      brandId: p.brand_id,
      brandName: p.brand_name,
      categoryIds: categoryLinks.length
        ? categoryLinks.map((c) => c.category_id)
        : [p.category_id],
      categories: categoryLinks.length
        ? categoryLinks.map((c) => ({
            id: c.category_id,
            name: c.name,
            isPrimary: c.is_primary,
          }))
        : [{ id: p.category_id, name: p.category_name, isPrimary: true }],
      images,
      bulkPurchasingEnabled: p.bulk_purchasing_enabled,
      returnsAllowed: p.returns_allowed ?? true,
      returnWindowDays: p.return_window_days ?? 7,
      returnConditions: p.return_conditions,
      returnInstructions: p.return_instructions,
      returnPolicyDescription: p.return_policy_description,
      returnPolicyEffectiveAt: p.return_policy_effective_at,
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
    categoryIds?: string[];
    brandId?: string | null;
    slug: string;
    name: string;
    nameAm?: string;
    description?: string;
    status?: string;
    bulkPurchasingEnabled?: boolean;
    actorId?: string;
  }) {
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const retailNumber = await this.nextRetailNumber(client);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO catalog.products (
           category_id, brand_id, slug, name, name_am, description, status,
           bulk_purchasing_enabled, created_by, retail_number
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id`,
        [
          input.categoryId,
          input.brandId ?? null,
          input.slug,
          input.name,
          input.nameAm ?? null,
          input.description ?? null,
          input.status ?? 'draft',
          input.bulkPurchasingEnabled ?? false,
          input.actorId ?? null,
          retailNumber,
        ],
      );
      await client.query('COMMIT');
      const productId = rows[0].id;
      const categoryIds = input.categoryIds?.length
        ? input.categoryIds
        : [input.categoryId];
      await this.setProductCategories(productId, categoryIds, input.categoryId);
      return { id: productId, retailNumber };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async updateProduct(
    productId: string,
    input: {
      name?: string;
      nameAm?: string | null;
      description?: string | null;
      status?: string;
      categoryId?: string;
      categoryIds?: string[];
      brandId?: string | null;
      bulkPurchasingEnabled?: boolean;
      returnsAllowed?: boolean;
      returnWindowDays?: number | null;
      returnConditions?: string | null;
      returnInstructions?: string | null;
      returnPolicyDescription?: string | null;
      returnPolicyEffectiveAt?: string | null;
    },
  ) {
    if (input.categoryIds?.length || input.categoryId) {
      const ids =
        input.categoryIds?.length
          ? input.categoryIds
          : [input.categoryId!];
      await this.setProductCategories(
        productId,
        ids,
        input.categoryId ?? ids[0],
      );
    }
    const { rowCount } = await this.db.query(
      `UPDATE catalog.products SET
         name = COALESCE($2, name),
         name_am = COALESCE($3, name_am),
         description = COALESCE($4, description),
         status = COALESCE($5, status),
         brand_id = CASE WHEN $6::boolean THEN $7::uuid ELSE brand_id END,
         bulk_purchasing_enabled = COALESCE($8, bulk_purchasing_enabled),
         returns_allowed = COALESCE($9, returns_allowed),
         return_window_days = CASE WHEN $10::boolean THEN $11 ELSE return_window_days END,
         return_conditions = CASE WHEN $12::boolean THEN $13 ELSE return_conditions END,
         return_instructions = CASE WHEN $14::boolean THEN $15 ELSE return_instructions END,
         return_policy_description = CASE WHEN $16::boolean THEN $17 ELSE return_policy_description END,
         return_policy_effective_at = CASE
           WHEN $18::boolean THEN COALESCE($19::timestamptz, now())
           ELSE return_policy_effective_at
         END,
         updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL`,
      [
        productId,
        input.name ?? null,
        input.nameAm ?? null,
        input.description ?? null,
        input.status ?? null,
        input.brandId !== undefined,
        input.brandId ?? null,
        input.bulkPurchasingEnabled ?? null,
        input.returnsAllowed ?? null,
        input.returnWindowDays !== undefined,
        input.returnWindowDays ?? null,
        input.returnConditions !== undefined,
        input.returnConditions ?? null,
        input.returnInstructions !== undefined,
        input.returnInstructions ?? null,
        input.returnPolicyDescription !== undefined,
        input.returnPolicyDescription ?? null,
        input.returnsAllowed !== undefined ||
          input.returnWindowDays !== undefined ||
          input.returnPolicyDescription !== undefined,
        input.returnPolicyEffectiveAt ?? null,
      ],
    );
    if (!rowCount) throw new NotFoundException('Product not found');
    return this.adminGetProduct(productId);
  }

  async createVariant(input: {
    productId: string;
    sku?: string;
    variantName?: string;
    options?: Record<string, unknown>;
  }) {
    const { rows: products } = await this.db.query<{
      id: string;
      retail_number: string | null;
    }>(
      `SELECT id, retail_number FROM catalog.products
       WHERE id = $1 AND deleted_at IS NULL`,
      [input.productId],
    );
    if (!products[0]) throw new NotFoundException('Product not found');

    let retailNumber = products[0].retail_number;
    if (!retailNumber) {
      const client = await this.db.getPool().connect();
      try {
        await client.query('BEGIN');
        retailNumber = await this.nextRetailNumber(client);
        await client.query(
          `UPDATE catalog.products SET retail_number = $2, updated_at = now()
           WHERE id = $1`,
          [input.productId, retailNumber],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    const options = input.options ?? {};
    const sku =
      input.sku?.trim().toUpperCase() ||
      (await this.buildVariantSku(
        input.productId,
        retailNumber,
        input.variantName,
        options,
      ));

    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO catalog.product_variants (
         product_id, sku, variant_name, options
       ) VALUES ($1,$2,$3,$4::jsonb)
       RETURNING id`,
      [
        input.productId,
        sku,
        input.variantName ?? null,
        JSON.stringify(options),
      ],
    );
    return { id: rows[0].id, sku, retailNumber };
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
      data_type: string;
      unit: string | null;
      is_filterable: boolean;
      value_id: string | null;
      value_code: string | null;
      value_label: string | null;
    }>(
      `SELECT a.id, a.code, a.name, a.name_am, a.data_type, a.unit, a.is_filterable,
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
        dataType: string;
        unit: string | null;
        isFilterable: boolean;
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
          dataType: r.data_type,
          unit: r.unit,
          isFilterable: r.is_filterable,
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

  async adminListCategories() {
    return this.listCategories({ tree: true, includeInactive: true });
  }

  private async computeCategoryPath(
    slug: string,
    parentId: string | null,
  ): Promise<string> {
    if (!parentId) return slug;
    const { rows } = await this.db.query<{ path: string }>(
      `SELECT path FROM catalog.categories WHERE id = $1`,
      [parentId],
    );
    if (!rows[0]) throw new NotFoundException('Parent category not found');
    return `${rows[0].path.replace(/^\/+/, '')}/${slug}`;
  }

  async createCategory(input: {
    parentId?: string | null;
    slug: string;
    name: string;
    nameAm?: string | null;
    description?: string | null;
    sortOrder?: number;
    isActive?: boolean;
    isFeatured?: boolean;
    featuredSort?: number;
    imageStorageKey?: string | null;
    iconStorageKey?: string | null;
    metaTitle?: string | null;
    metaDescription?: string | null;
    aiStudioEnabled?: boolean;
  }) {
    const path = await this.computeCategoryPath(
      input.slug,
      input.parentId ?? null,
    );
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO catalog.categories (
         parent_id, slug, name, name_am, path, sort_order, is_active,
         description, is_featured, featured_sort, image_storage_key,
         icon_storage_key, meta_title, meta_description, ai_studio_enabled
       ) VALUES (
         $1,$2,$3,$4,$5,$6,COALESCE($7,true),
         $8,COALESCE($9,false),COALESCE($10,0),$11,$12,$13,$14,COALESCE($15,false)
       ) RETURNING id`,
      [
        input.parentId ?? null,
        input.slug,
        input.name,
        input.nameAm ?? null,
        path,
        input.sortOrder ?? 0,
        input.isActive ?? true,
        input.description ?? null,
        input.isFeatured ?? false,
        input.featuredSort ?? 0,
        input.imageStorageKey ?? null,
        input.iconStorageKey ?? null,
        input.metaTitle ?? null,
        input.metaDescription ?? null,
        input.aiStudioEnabled ?? false,
      ],
    );
    return { id: rows[0].id, path };
  }

  async updateCategory(
    id: string,
    input: {
      parentId?: string | null;
      slug?: string;
      name?: string;
      nameAm?: string | null;
      description?: string | null;
      sortOrder?: number;
      isActive?: boolean;
      isFeatured?: boolean;
      featuredSort?: number;
      imageStorageKey?: string | null;
      iconStorageKey?: string | null;
      metaTitle?: string | null;
      metaDescription?: string | null;
      aiStudioEnabled?: boolean;
    },
  ) {
    const { rows: current } = await this.db.query<{
      id: string;
      parent_id: string | null;
      slug: string;
      path: string;
    }>(`SELECT id, parent_id, slug, path FROM catalog.categories WHERE id = $1`, [
      id,
    ]);
    if (!current[0]) throw new NotFoundException('Category not found');

    const nextParent =
      input.parentId !== undefined ? input.parentId : current[0].parent_id;
    const nextSlug = input.slug ?? current[0].slug;
    const nextPath = await this.computeCategoryPath(nextSlug, nextParent);
    const oldPath = current[0].path.replace(/^\/+/, '');

    await this.db.query(
      `UPDATE catalog.categories SET
         parent_id = $2,
         slug = $3,
         name = COALESCE($4, name),
         name_am = COALESCE($5, name_am),
         description = COALESCE($6, description),
         path = $7,
         sort_order = COALESCE($8, sort_order),
         is_active = COALESCE($9, is_active),
         is_featured = COALESCE($10, is_featured),
         featured_sort = COALESCE($11, featured_sort),
         image_storage_key = COALESCE($12, image_storage_key),
         icon_storage_key = COALESCE($13, icon_storage_key),
         meta_title = COALESCE($14, meta_title),
         meta_description = COALESCE($15, meta_description),
         ai_studio_enabled = COALESCE($16, ai_studio_enabled),
         updated_at = now()
       WHERE id = $1`,
      [
        id,
        nextParent,
        nextSlug,
        input.name ?? null,
        input.nameAm ?? null,
        input.description ?? null,
        nextPath,
        input.sortOrder ?? null,
        input.isActive ?? null,
        input.isFeatured ?? null,
        input.featuredSort ?? null,
        input.imageStorageKey ?? null,
        input.iconStorageKey ?? null,
        input.metaTitle ?? null,
        input.metaDescription ?? null,
        input.aiStudioEnabled ?? null,
      ],
    );

    // Re-path descendants when this node moves/renames
    if (oldPath !== nextPath) {
      await this.db.query(
        `UPDATE catalog.categories
         SET path = $2 || substr(path, length($1) + 1),
             updated_at = now()
         WHERE path = $1 OR path LIKE $1 || '/%'`,
        [oldPath, nextPath],
      );
    }
    return { ok: true, path: nextPath };
  }

  async setCategoryAttributeSets(
    categoryId: string,
    sets: Array<{ attributeId: string; isRequired?: boolean; sortOrder?: number }>,
  ) {
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM catalog.categories WHERE id = $1`,
      [categoryId],
    );
    if (!rows[0]) throw new NotFoundException('Category not found');
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM catalog.category_attribute_sets WHERE category_id = $1`,
        [categoryId],
      );
      for (const [idx, s] of sets.entries()) {
        await client.query(
          `INSERT INTO catalog.category_attribute_sets
             (category_id, attribute_id, is_required, sort_order)
           VALUES ($1,$2,$3,$4)`,
          [
            categoryId,
            s.attributeId,
            s.isRequired ?? false,
            s.sortOrder ?? idx * 10,
          ],
        );
      }
      await client.query('COMMIT');
      return { ok: true, count: sets.length };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getCategoryAttributeSets(categoryId: string) {
    const { rows } = await this.db.query<{
      attribute_id: string;
      code: string;
      name: string;
      data_type: string;
      is_required: boolean;
      sort_order: number;
    }>(
      `SELECT cas.attribute_id, a.code, a.name, a.data_type,
              cas.is_required, cas.sort_order
       FROM catalog.category_attribute_sets cas
       JOIN catalog.attributes a ON a.id = cas.attribute_id
       WHERE cas.category_id = $1
       ORDER BY cas.sort_order, a.name`,
      [categoryId],
    );
    return rows.map((r) => ({
      attributeId: r.attribute_id,
      code: r.code,
      name: r.name,
      dataType: r.data_type,
      isRequired: r.is_required,
      sortOrder: r.sort_order,
    }));
  }

  private async nextRetailNumber(client: PoolClient) {
    const period = String(new Date().getUTCFullYear());
    await client.query(
      `INSERT INTO core.document_sequences (doc_type, period, next_value)
       VALUES ('RTL', $1, 1) ON CONFLICT (doc_type, period) DO NOTHING`,
      [period],
    );
    const { rows } = await client.query<{ next_value: string }>(
      `UPDATE core.document_sequences SET next_value = next_value + 1
       WHERE doc_type = 'RTL' AND period = $1
       RETURNING (next_value - 1)::text AS next_value`,
      [period],
    );
    return `SABU-${period}-${String(Number(rows[0].next_value)).padStart(6, '0')}`;
  }

  private slugCode(value: string, max = 6) {
    return (
      value
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '')
        // Drop O/I/L to reduce human misreads against 0/1.
        .replace(new RegExp('[OIL]', 'g'), '')
        .slice(0, max) || 'X'
    );
  }

  private async buildVariantSku(
    productId: string,
    retailNumber: string,
    variantName?: string,
    options?: Record<string, unknown>,
  ) {
    const parts: string[] = [retailNumber];
    const color =
      (typeof options?.color === 'string' && options.color) ||
      (typeof options?.Colour === 'string' && options.Colour) ||
      null;
    const size =
      (typeof options?.size === 'string' && options.size) ||
      (typeof options?.Size === 'string' && options.Size) ||
      null;

    if (color) parts.push(this.slugCode(color, 4));
    if (size) parts.push(this.slugCode(String(size), 4));

    if (!color && !size && variantName) {
      // e.g. "28 / Navy" → NAVY + 28
      const chunks = variantName
        .split(/[\/|,·\-]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const chunk of chunks.slice(0, 2)) {
        parts.push(this.slugCode(chunk, 4));
      }
    }

    let base = parts.join('-');
    if (parts.length === 1) {
      const { rows: countRows } = await this.db.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM catalog.product_variants
         WHERE product_id = $1 AND deleted_at IS NULL`,
        [productId],
      );
      base = `${retailNumber}-V${Number(countRows[0]?.c ?? 0) + 1}`;
    }

    // Ensure uniqueness if collision
    let candidate = base;
    let n = 2;
    for (;;) {
      const { rows } = await this.db.query<{ id: string }>(
        `SELECT id FROM catalog.product_variants
         WHERE sku = $1 AND deleted_at IS NULL LIMIT 1`,
        [candidate],
      );
      if (!rows[0]) return candidate;
      candidate = `${base}-${n}`;
      n += 1;
      if (n > 50) {
        throw new BadRequestException('Could not allocate unique variant SKU');
      }
    }
  }

  async setProductCategories(
    productId: string,
    categoryIds: string[],
    primaryCategoryId?: string,
  ) {
    if (!categoryIds.length) {
      throw new BadRequestException('At least one category is required');
    }
    const primary = primaryCategoryId ?? categoryIds[0];
    if (!categoryIds.includes(primary)) {
      categoryIds = [primary, ...categoryIds];
    }
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM catalog.products WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [productId],
      );
      if (!rows[0]) throw new NotFoundException('Product not found');
      await client.query(
        `DELETE FROM catalog.product_categories WHERE product_id = $1`,
        [productId],
      );
      for (const [idx, categoryId] of categoryIds.entries()) {
        await client.query(
          `INSERT INTO catalog.product_categories
             (product_id, category_id, is_primary, sort_order)
           VALUES ($1,$2,$3,$4)`,
          [productId, categoryId, categoryId === primary, idx],
        );
      }
      await client.query(
        `UPDATE catalog.products
         SET category_id = $2, updated_at = now()
         WHERE id = $1`,
        [productId, primary],
      );
      await client.query('COMMIT');
      return { ok: true, primaryCategoryId: primary, categoryIds };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async listBrands() {
    const { rows } = await this.db.query<{
      id: string;
      slug: string;
      name: string;
      is_active: boolean;
    }>(
      `SELECT id, slug, name, is_active
       FROM catalog.brands
       ORDER BY name`,
    );
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      isActive: r.is_active,
    }));
  }

  async createBrand(input: { slug: string; name: string }) {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO catalog.brands (slug, name)
       VALUES ($1,$2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
       RETURNING id`,
      [input.slug, input.name],
    );
    return { id: rows[0].id };
  }

  async createAttribute(input: {
    code: string;
    name: string;
    nameAm?: string | null;
    dataType?: string;
    unit?: string | null;
    isFilterable?: boolean;
    sortOrder?: number;
  }) {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO catalog.attributes (
         code, name, name_am, data_type, unit, is_filterable, sort_order
       ) VALUES ($1,$2,$3,COALESCE($4,'dropdown'),$5,COALESCE($6,true),COALESCE($7,0))
       RETURNING id`,
      [
        input.code,
        input.name,
        input.nameAm ?? null,
        input.dataType ?? 'dropdown',
        input.unit ?? null,
        input.isFilterable ?? true,
        input.sortOrder ?? 0,
      ],
    );
    return { id: rows[0].id };
  }

  async updateAttribute(
    id: string,
    input: {
      name?: string;
      nameAm?: string | null;
      dataType?: string;
      unit?: string | null;
      isFilterable?: boolean;
      sortOrder?: number;
    },
  ) {
    const { rowCount } = await this.db.query(
      `UPDATE catalog.attributes SET
         name = COALESCE($2, name),
         name_am = COALESCE($3, name_am),
         data_type = COALESCE($4, data_type),
         unit = CASE WHEN $5::boolean THEN $6 ELSE unit END,
         is_filterable = COALESCE($7, is_filterable),
         sort_order = COALESCE($8, sort_order)
       WHERE id = $1`,
      [
        id,
        input.name ?? null,
        input.nameAm ?? null,
        input.dataType ?? null,
        input.unit !== undefined,
        input.unit ?? null,
        input.isFilterable ?? null,
        input.sortOrder ?? null,
      ],
    );
    if (!rowCount) throw new NotFoundException('Attribute not found');
    return { ok: true };
  }

  async addAttributeValue(input: {
    attributeId: string;
    code: string;
    label: string;
    labelAm?: string | null;
    sortOrder?: number;
  }) {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO catalog.attribute_values (
         attribute_id, code, label, label_am, sort_order
       ) VALUES ($1,$2,$3,$4,COALESCE($5,0))
       ON CONFLICT (attribute_id, code) DO UPDATE
         SET label = EXCLUDED.label,
             label_am = EXCLUDED.label_am,
             sort_order = EXCLUDED.sort_order
       RETURNING id`,
      [
        input.attributeId,
        input.code,
        input.label,
        input.labelAm ?? null,
        input.sortOrder ?? 0,
      ],
    );
    return { id: rows[0].id };
  }

  async listProductImages(productId: string) {
    const { rows } = await this.db.query<{
      id: string;
      storage_key: string;
      alt_text: string | null;
      sort_order: number;
      is_primary: boolean;
      variant_id: string | null;
      source: string;
    }>(
      `SELECT id, storage_key, alt_text, sort_order, is_primary, variant_id,
              COALESCE(source, 'upload') AS source
       FROM catalog.product_images
       WHERE product_id = $1
       ORDER BY is_primary DESC, sort_order, created_at`,
      [productId],
    );
    return rows.map((r) => ({
      id: r.id,
      storageKey: r.storage_key,
      altText: r.alt_text,
      sortOrder: r.sort_order,
      isPrimary: r.is_primary,
      variantId: r.variant_id,
      source: r.source,
      url: `/media/file?key=${encodeURIComponent(r.storage_key)}`,
    }));
  }

  async addProductImage(input: {
    productId: string;
    storageKey: string;
    altText?: string | null;
    variantId?: string | null;
    isPrimary?: boolean;
    source?: string;
  }) {
    const { rows: products } = await this.db.query<{ id: string }>(
      `SELECT id FROM catalog.products WHERE id = $1 AND deleted_at IS NULL`,
      [input.productId],
    );
    if (!products[0]) throw new NotFoundException('Product not found');

    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      if (input.isPrimary) {
        await client.query(
          `UPDATE catalog.product_images SET is_primary = false WHERE product_id = $1`,
          [input.productId],
        );
      }
      const { rows: countRows } = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM catalog.product_images WHERE product_id = $1`,
        [input.productId],
      );
      const makePrimary =
        input.isPrimary === true || Number(countRows[0]?.c ?? 0) === 0;
      if (makePrimary) {
        await client.query(
          `UPDATE catalog.product_images SET is_primary = false WHERE product_id = $1`,
          [input.productId],
        );
      }
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO catalog.product_images (
           product_id, variant_id, storage_key, alt_text, sort_order, is_primary, source
         ) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'upload'))
         RETURNING id`,
        [
          input.productId,
          input.variantId ?? null,
          input.storageKey,
          input.altText ?? null,
          Number(countRows[0]?.c ?? 0) * 10,
          makePrimary,
          input.source ?? 'upload',
        ],
      );
      await client.query('COMMIT');
      return { id: rows[0].id, isPrimary: makePrimary };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async setPrimaryProductImage(productId: string, imageId: string) {
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM catalog.product_images
         WHERE id = $1 AND product_id = $2`,
        [imageId, productId],
      );
      if (!rows[0]) throw new NotFoundException('Image not found');
      await client.query(
        `UPDATE catalog.product_images SET is_primary = false WHERE product_id = $1`,
        [productId],
      );
      await client.query(
        `UPDATE catalog.product_images SET is_primary = true WHERE id = $1`,
        [imageId],
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

  async deleteProductImage(productId: string, imageId: string) {
    const { rows } = await this.db.query<{ id: string; is_primary: boolean }>(
      `DELETE FROM catalog.product_images
       WHERE id = $1 AND product_id = $2
       RETURNING id, is_primary`,
      [imageId, productId],
    );
    if (!rows[0]) throw new NotFoundException('Image not found');
    if (rows[0].is_primary) {
      await this.db.query(
        `UPDATE catalog.product_images
         SET is_primary = true
         WHERE id = (
           SELECT id FROM catalog.product_images
           WHERE product_id = $1
           ORDER BY sort_order, created_at
           LIMIT 1
         )`,
        [productId],
      );
    }
    return { ok: true };
  }
}
