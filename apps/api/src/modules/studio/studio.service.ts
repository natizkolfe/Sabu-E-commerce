import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { AuthUser } from '../iam/auth.types';
import { MediaService } from '../media/media.service';
import { CatalogService } from '../catalog/catalog.service';
import { EnhanceProviderFactory } from './providers/enhance-provider.factory';
import { standardizeToWhiteCanvas } from './providers/standardize-image';

const TRANSFORM_PRESETS = [
  'studio_packshot',
  'ghost_mannequin',
  'background_cleanup',
  'white_background_ecommerce',
] as const;

type TransformPreset = (typeof TRANSFORM_PRESETS)[number];

@Injectable()
export class StudioService {
  readonly schema = 'studio' as const;
  private readonly logger = new Logger(StudioService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly media: MediaService,
    private readonly catalog: CatalogService,
    private readonly enhanceFactory: EnhanceProviderFactory,
  ) {}

  async listModels() {
    const { rows } = await this.db.query<{
      id: string;
      code: string;
      display_name: string;
      gender_label: string | null;
      age_group: string;
      license_note: string;
    }>(
      `SELECT m.id, m.code, m.display_name, m.gender_label, g.label AS age_group, m.license_note
       FROM studio.virtual_models m
       JOIN studio.model_age_groups g ON g.id = m.age_group_id
       WHERE m.is_active
       ORDER BY g.sort_order, m.display_name`,
    );
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      displayName: r.display_name,
      genderLabel: r.gender_label,
      ageGroup: r.age_group,
      licenseNote: r.license_note,
    }));
  }

  listTransformPresets() {
    return [
      {
        code: 'white_background_ecommerce',
        label: 'White background (ecommerce)',
        description:
          'Remove background, pure white studio backdrop, center & web-optimize',
      },
      {
        code: 'studio_packshot',
        label: 'Studio packshot',
        description: 'Clean studio lighting and neutral background',
      },
      {
        code: 'ghost_mannequin',
        label: 'Ghost mannequin',
        description: 'Invisible mannequin shape for apparel',
      },
      {
        code: 'background_cleanup',
        label: 'Background cleanup',
        description: 'Remove cluttered background, keep garment',
      },
    ];
  }

  async listPendingReviews(opts?: {
    productId?: string;
    stagedOnly?: boolean;
    jobType?: 'try_on' | 'product_transform';
  }) {
    const params: unknown[] = [];
    let where = `gi.review_status = 'pending'`;
    if (opts?.productId) {
      params.push(opts.productId);
      where += ` AND gi.product_id = $${params.length}`;
    } else if (opts?.stagedOnly) {
      where += ` AND gi.product_id IS NULL`;
    }
    if (opts?.jobType) {
      params.push(opts.jobType);
      where += ` AND COALESCE(j.job_type, 'try_on') = $${params.length}`;
    }
    const { rows } = await this.db.query<{
      id: string;
      storage_key: string;
      product_id: string | null;
      product_name: string | null;
      product_slug: string | null;
      review_status: string;
      created_at: Date;
      job_id: string;
      job_type: string;
      transform_preset: string | null;
      source_image_key: string;
      model_name: string | null;
      provider: string;
      provider_meta: Record<string, unknown> | null;
    }>(
      `SELECT gi.id, gi.storage_key, gi.product_id, p.name AS product_name, p.slug AS product_slug,
              gi.review_status, gi.created_at, gi.job_id,
              COALESCE(j.job_type, 'try_on') AS job_type,
              j.transform_preset, j.source_image_key,
              vm.display_name AS model_name,
              COALESCE(j.provider, 'mock') AS provider,
              j.provider_meta
       FROM studio.generated_images gi
       LEFT JOIN catalog.products p ON p.id = gi.product_id
       LEFT JOIN studio.generation_jobs j ON j.id = gi.job_id
       LEFT JOIN studio.virtual_models vm ON vm.id = j.model_id
       WHERE ${where}
       ORDER BY gi.created_at DESC`,
      params,
    );
    return rows.map((r) => this.mapPendingRow(r));
  }

  /**
   * Saved white-background / transform results not yet assigned to a product.
   * Used when creating products from previously enhanced phone photos.
   */
  async listEnhanceLibrary() {
    const { rows } = await this.db.query<{
      id: string;
      storage_key: string;
      product_id: string | null;
      product_name: string | null;
      product_slug: string | null;
      review_status: string;
      created_at: Date;
      job_id: string;
      job_type: string;
      transform_preset: string | null;
      source_image_key: string;
      model_name: string | null;
      provider: string;
      provider_meta: Record<string, unknown> | null;
    }>(
      `SELECT gi.id, gi.storage_key, gi.product_id, p.name AS product_name, p.slug AS product_slug,
              gi.review_status, gi.created_at, gi.job_id,
              COALESCE(j.job_type, 'product_transform') AS job_type,
              j.transform_preset, j.source_image_key,
              vm.display_name AS model_name,
              COALESCE(j.provider, 'mock') AS provider,
              j.provider_meta
       FROM studio.generated_images gi
       LEFT JOIN catalog.products p ON p.id = gi.product_id
       LEFT JOIN studio.generation_jobs j ON j.id = gi.job_id
       LEFT JOIN studio.virtual_models vm ON vm.id = j.model_id
       WHERE gi.product_id IS NULL
         AND gi.review_status = 'approved'
         AND COALESCE(j.job_type, 'product_transform') = 'product_transform'
       ORDER BY gi.reviewed_at DESC NULLS LAST, gi.created_at DESC`,
    );
    return rows.map((r) => this.mapPendingRow(r));
  }

  async saveToLibrary(user: AuthUser, imageId: string) {
    const result = await this.reviewImage(user, imageId, 'approve', false);
    if (!result.needsProductAssign && result.catalogImageId) {
      return result;
    }
    return {
      ...result,
      savedToLibrary: true,
    };
  }

  private mapPendingRow(r: {
    id: string;
    storage_key: string;
    product_id?: string | null;
    product_name: string | null;
    product_slug: string | null;
    review_status: string;
    created_at: Date;
    job_id: string;
    job_type: string;
    transform_preset: string | null;
    source_image_key: string;
    model_name: string | null;
    provider?: string;
    provider_meta?: Record<string, unknown> | null;
  }) {
    const resultIsMediaFile =
      r.storage_key &&
      !r.storage_key.endsWith('.webp') &&
      (r.storage_key.includes('/enhanced/') ||
        r.storage_key.includes('/studio/') ||
        r.storage_key.includes('/demo/') ||
        r.transform_preset === 'white_background_ecommerce');
    const metaLabel =
      typeof r.provider_meta?.label === 'string'
        ? r.provider_meta.label
        : null;
    const demoSeed = Boolean(r.provider_meta?.demoSeed);
    return {
      id: r.id,
      storageKey: r.storage_key,
      productId: r.product_id,
      productName:
        r.product_name ?? metaLabel ?? 'Unassigned (enhance first)',
      productSlug: r.product_slug,
      staged: !r.product_id,
      reviewStatus: r.review_status,
      createdAt: r.created_at,
      jobId: r.job_id,
      jobType: r.job_type,
      transformPreset: r.transform_preset,
      sourceImageKey: r.source_image_key,
      sourceUrl: r.source_image_key
        ? `/media/file?key=${encodeURIComponent(r.source_image_key)}`
        : null,
      modelName: r.model_name,
      provider: r.provider ?? 'mock',
      demoSeed,
      label: metaLabel,
      previewUrl: resultIsMediaFile
        ? `/media/file?key=${encodeURIComponent(r.storage_key)}`
        : `/studio/images/${r.id}/preview`,
      resultUrl: resultIsMediaFile
        ? `/media/file?key=${encodeURIComponent(r.storage_key)}`
        : `/studio/images/${r.id}/preview`,
      isAiPreview: true,
    };
  }

  async enqueueGenerate(input: {
    productId?: string;
    variantId?: string;
    modelId?: string;
    sourceImageKey?: string;
    jobType?: 'try_on' | 'product_transform';
    transformPreset?: TransformPreset;
    removeBackground?: boolean;
    user: AuthUser;
  }) {
    const jobType = input.jobType ?? 'try_on';
    let productName = 'Product';
    let productId: string | null = input.productId ?? null;

    if (productId) {
      const { rows: products } = await this.db.query<{
        id: string;
        name: string;
      }>(
        `SELECT id, name FROM catalog.products WHERE id = $1 AND deleted_at IS NULL`,
        [productId],
      );
      if (!products[0]) throw new NotFoundException('Product not found');
      productName = products[0].name;
    }

    if (jobType === 'try_on') {
      if (!productId) {
        throw new BadRequestException(
          'productId is required for try-on jobs',
        );
      }
      if (!input.modelId) {
        throw new BadRequestException('modelId is required for try-on jobs');
      }
      const { rows: models } = await this.db.query<{ id: string }>(
        `SELECT id FROM studio.virtual_models WHERE id = $1 AND is_active`,
        [input.modelId],
      );
      if (!models[0]) throw new NotFoundException('Model not found');
    } else {
      if (
        !input.transformPreset ||
        !TRANSFORM_PRESETS.includes(input.transformPreset)
      ) {
        throw new BadRequestException(
          'transformPreset is required for product transforms',
        );
      }
      if (!input.sourceImageKey && !productId) {
        throw new BadRequestException(
          'Upload a phone photo first (sourceImageKey required when no product is selected)',
        );
      }
    }

    const sourceKey =
      input.sourceImageKey ??
      (productId
        ? await this.defaultProductImage(productId, input.variantId)
        : null);
    if (!sourceKey) {
      throw new BadRequestException('sourceImageKey is required');
    }

    const removeBackground = Boolean(input.removeBackground);
    const provider =
      jobType === 'product_transform' &&
      input.transformPreset === 'white_background_ecommerce'
        ? removeBackground
          ? this.enhanceFactory.resolve().name
          : 'white_canvas_only'
        : 'mock';

    const { rows: jobs } = await this.db.query<{ id: string }>(
      `INSERT INTO studio.generation_jobs (
         product_id, variant_id, model_id, source_image_key, provider, status,
         requested_by, job_type, transform_preset, provider_meta
       ) VALUES ($1,$2,$3,$4,$5,'queued',$6,$7,$8,$9::jsonb)
       RETURNING id`,
      [
        productId,
        input.variantId ?? null,
        jobType === 'try_on' ? input.modelId! : null,
        sourceKey,
        provider,
        input.user.id,
        jobType,
        jobType === 'product_transform' ? input.transformPreset! : null,
        JSON.stringify({ removeBackground }),
      ],
    );

    if (
      jobType === 'product_transform' &&
      input.transformPreset === 'white_background_ecommerce'
    ) {
      await this.runWhiteBackgroundEnhance(jobs[0].id, productName, {
        removeBackground,
      });
    } else {
      await this.runMockGenerator(jobs[0].id);
    }

    return {
      jobId: jobs[0].id,
      status: 'succeeded',
      jobType,
      provider,
      removeBackground,
      staged: !productId,
    };
  }

  /**
   * Assign a staged (or pending) enhance result to a product gallery.
   * Approves the image and adds it as primary catalog image; original upload key is also linked when present.
   */
  async attachToProduct(
    user: AuthUser,
    imageId: string,
    productId: string,
    opts?: { setPrimary?: boolean; includeOriginal?: boolean },
  ) {
    const { rows: products } = await this.db.query<{ id: string }>(
      `SELECT id FROM catalog.products WHERE id = $1 AND deleted_at IS NULL`,
      [productId],
    );
    if (!products[0]) throw new NotFoundException('Product not found');

    const { rows } = await this.db.query<{
      id: string;
      job_id: string;
      storage_key: string;
      product_id: string | null;
      review_status: string;
      transform_preset: string | null;
      source_image_key: string | null;
      job_type: string;
    }>(
      `SELECT gi.id, gi.job_id, gi.storage_key, gi.product_id, gi.review_status,
              j.transform_preset, j.source_image_key,
              COALESCE(j.job_type, 'try_on') AS job_type
       FROM studio.generated_images gi
       LEFT JOIN studio.generation_jobs j ON j.id = gi.job_id
       WHERE gi.id = $1`,
      [imageId],
    );
    const img = rows[0];
    if (!img) throw new NotFoundException('Generated image not found');
    if (img.review_status === 'rejected') {
      throw new BadRequestException('Cannot attach a rejected image');
    }

    await this.db.query(
      `UPDATE studio.generation_jobs SET product_id = $2 WHERE id = $1`,
      [img.job_id, productId],
    );
    await this.db.query(
      `UPDATE studio.generated_images
       SET product_id = $2,
           review_status = 'approved',
           published = true,
           reviewed_by = $3,
           reviewed_at = COALESCE(reviewed_at, now())
       WHERE id = $1`,
      [imageId, productId, user.id],
    );

    const source =
      img.transform_preset === 'white_background_ecommerce'
        ? 'ai_enhance'
        : 'studio_transform';
    const added = await this.catalog.addProductImage({
      productId,
      storageKey: img.storage_key,
      isPrimary: opts?.setPrimary !== false,
      source,
      altText: img.transform_preset
        ? `AI ${img.transform_preset.replace(/_/g, ' ')}`
        : 'AI enhanced',
    });

    let originalImageId: string | null = null;
    if (
      opts?.includeOriginal !== false &&
      img.source_image_key &&
      img.source_image_key !== img.storage_key
    ) {
      try {
        const orig = await this.catalog.addProductImage({
          productId,
          storageKey: img.source_image_key,
          isPrimary: false,
          source: 'upload',
          altText: 'Original phone photo',
        });
        originalImageId = orig.id;
      } catch {
        // original may already be attached
      }
    }

    return {
      ok: true,
      productId,
      catalogImageId: added.id,
      originalImageId,
    };
  }

  async reviewImage(
    user: AuthUser,
    imageId: string,
    action: 'approve' | 'reject',
    publish = true,
  ) {
    const { rows } = await this.db.query<{
      id: string;
      review_status: string;
      product_id: string | null;
      variant_id: string | null;
      storage_key: string;
      job_type: string;
      transform_preset: string | null;
    }>(
      `SELECT gi.id, gi.review_status, gi.product_id, gi.variant_id, gi.storage_key,
              COALESCE(j.job_type, 'try_on') AS job_type,
              j.transform_preset
       FROM studio.generated_images gi
       LEFT JOIN studio.generation_jobs j ON j.id = gi.job_id
       WHERE gi.id = $1`,
      [imageId],
    );
    if (!rows[0]) throw new NotFoundException('Generated image not found');
    if (rows[0].review_status !== 'pending') {
      throw new BadRequestException('Image already reviewed');
    }
    const status = action === 'approve' ? 'approved' : 'rejected';
    await this.db.query(
      `UPDATE studio.generated_images
       SET review_status = $2,
           published = $3,
           reviewed_by = $4,
           reviewed_at = now()
       WHERE id = $1`,
      [imageId, status, action === 'approve' && publish, user.id],
    );

    let catalogImageId: string | null = null;
    // Staged enhances (no product yet) stay approved in studio until attachToProduct
    if (
      action === 'approve' &&
      rows[0].job_type === 'product_transform' &&
      rows[0].product_id
    ) {
      let storageKey = rows[0].storage_key;
      const source: string =
        rows[0].transform_preset === 'white_background_ecommerce'
          ? 'ai_enhance'
          : 'studio_transform';

      // Legacy SVG preview jobs: materialize into media storage
      const looksLikeRealFile =
        storageKey.includes('/enhanced/') ||
        storageKey.match(/\.(jpe?g|png|webp|svg)$/i);
      if (!looksLikeRealFile) {
        const svg = await this.renderPreviewSvg(imageId);
        const saved = await this.media.saveDataUrl(
          `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
          {
            folder: `products/${rows[0].product_id}/studio`,
            mimeHint: 'image/svg+xml',
          },
        );
        storageKey = saved.storageKey;
      }

      const added = await this.catalog.addProductImage({
        productId: rows[0].product_id,
        storageKey,
        variantId: rows[0].variant_id,
        isPrimary: true,
        source,
        altText: rows[0].transform_preset
          ? `AI ${rows[0].transform_preset.replace(/_/g, ' ')}`
          : 'AI studio transform',
      });
      catalogImageId = added.id;
    }

    return {
      ok: true,
      reviewStatus: status,
      catalogImageId,
      needsProductAssign: action === 'approve' && !rows[0].product_id,
    };
  }

  async listPublishedForProduct(productId: string) {
    const { rows } = await this.db.query<{
      id: string;
      storage_key: string;
      variant_id: string | null;
    }>(
      `SELECT id, storage_key, variant_id
       FROM studio.generated_images
       WHERE product_id = $1 AND published AND review_status = 'approved'
       ORDER BY created_at DESC`,
      [productId],
    );
    return rows.map((r) => ({
      id: r.id,
      storageKey: r.storage_key,
      variantId: r.variant_id,
      isAiPreview: true,
      previewUrl: r.storage_key.includes('/enhanced/')
        ? `/media/file?key=${encodeURIComponent(r.storage_key)}`
        : `/studio/images/${r.id}/preview`,
    }));
  }

  async renderPreviewSvg(imageId: string) {
    const { rows } = await this.db.query<{
      id: string;
      review_status: string;
      published: boolean;
      product_name: string;
      model_name: string | null;
      job_type: string;
      transform_preset: string | null;
      storage_key: string;
    }>(
      `SELECT gi.id, gi.review_status, gi.published,
              COALESCE(p.name, 'Staged photo') AS product_name,
              vm.display_name AS model_name,
              COALESCE(j.job_type, 'try_on') AS job_type,
              j.transform_preset, gi.storage_key
       FROM studio.generated_images gi
       LEFT JOIN catalog.products p ON p.id = gi.product_id
       LEFT JOIN studio.generation_jobs j ON j.id = gi.job_id
       LEFT JOIN studio.virtual_models vm ON vm.id = j.model_id
       WHERE gi.id = $1`,
      [imageId],
    );
    const img = rows[0];
    if (!img) throw new NotFoundException('Generated image not found');
    if (img.review_status === 'rejected') {
      throw new NotFoundException('Generated image not available');
    }

    const title = escapeXml((img.product_name ?? 'Staged photo').slice(0, 42));
    const badge =
      img.review_status === 'pending' ? 'AI PREVIEW · PENDING' : 'AI PREVIEW';

    if (img.job_type === 'product_transform') {
      const preset = escapeXml(
        (img.transform_preset ?? 'studio_packshot').replace(/_/g, ' '),
      );
      const isWhite =
        img.transform_preset === 'white_background_ecommerce';
      return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1200" viewBox="0 0 960 1200">
  <rect width="960" height="1200" fill="${isWhite ? '#ffffff' : '#f4f6f5'}"/>
  <rect x="120" y="160" width="720" height="720" rx="16" fill="${isWhite ? '#f7f7f7' : '#e4ebe7'}" stroke="#d7e0db"/>
  <ellipse cx="480" cy="820" rx="200" ry="28" fill="#e2e8e4"/>
  <path d="M340 280 L480 230 L620 280 L600 720 L480 780 L360 720 Z" fill="#c9d4ce" stroke="#9aaba2" stroke-width="3"/>
  <text x="48" y="64" fill="#2f6b4f" font-family="Georgia, serif" font-size="22" letter-spacing="3">${badge}</text>
  <text x="48" y="110" fill="#1a2922" font-family="Georgia, serif" font-size="36">${title}</text>
  <text x="48" y="150" fill="#5a6f64" font-family="Arial, sans-serif" font-size="20">Target · ${preset}</text>
  <text x="48" y="1140" fill="#6d8076" font-family="Arial, sans-serif" font-size="16">Authentic product enhance · Sabu Admin</text>
</svg>`;
    }

    const model = escapeXml((img.model_name ?? 'Virtual model').slice(0, 36));
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a4d3a"/>
      <stop offset="55%" stop-color="#0f2a20"/>
      <stop offset="100%" stop-color="#0b1f17"/>
    </linearGradient>
  </defs>
  <rect width="960" height="720" fill="url(#bg)"/>
  <rect x="48" y="48" width="864" height="624" fill="none" stroke="#9dcdb4" stroke-opacity="0.35" stroke-width="2"/>
  <text x="72" y="110" fill="#9dcdb4" font-family="Georgia, serif" font-size="22" letter-spacing="4">${badge}</text>
  <text x="72" y="320" fill="#eef2ef" font-family="Georgia, serif" font-size="48">${title}</text>
  <text x="72" y="380" fill="#b7c7be" font-family="Arial, sans-serif" font-size="24">Model: ${model}</text>
  <text x="72" y="620" fill="#8aa897" font-family="Arial, sans-serif" font-size="18">Sabu Online Shopping · synthetic / licensed preview</text>
</svg>`;
  }

  private async defaultProductImage(productId: string, variantId?: string) {
    const { rows } = await this.db.query<{ storage_key: string }>(
      `SELECT storage_key FROM catalog.product_images
       WHERE product_id = $1
         AND ($2::uuid IS NULL OR variant_id IS NULL OR variant_id = $2)
       ORDER BY is_primary DESC, sort_order
       LIMIT 1`,
      [productId, variantId ?? null],
    );
    return rows[0]?.storage_key ?? `products/${productId}/placeholder.jpg`;
  }

  private async runWhiteBackgroundEnhance(
    jobId: string,
    productName: string,
    opts?: { removeBackground?: boolean },
  ) {
    await this.db.query(
      `UPDATE studio.generation_jobs SET status = 'running' WHERE id = $1`,
      [jobId],
    );
    const { rows } = await this.db.query<{
      product_id: string | null;
      variant_id: string | null;
      source_image_key: string;
      provider_meta: Record<string, unknown> | null;
    }>(
      `SELECT product_id, variant_id, source_image_key, provider_meta
       FROM studio.generation_jobs WHERE id = $1`,
      [jobId],
    );
    const job = rows[0];
    if (!job) return;

    const removeBackground =
      opts?.removeBackground ?? Boolean(job.provider_meta?.removeBackground);

    try {
      let inputBuffer: Buffer;
      let inputMime = 'image/jpeg';
      try {
        const file = await this.media.readBuffer(job.source_image_key);
        inputBuffer = file.buffer;
        inputMime = file.mime;
      } catch {
        // No local file (seed key) — mock provider can still produce a canvas
        inputBuffer = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#ddd"/><text x="40" y="80" font-size="28">Source missing</text></svg>`,
        );
        inputMime = 'image/svg+xml';
      }

      // Cutout only when toggle is on; otherwise keep the photo and white-canvas it
      const provider = removeBackground
        ? this.enhanceFactory.resolve()
        : this.enhanceFactory.resolveLocal();
      const enhanced = await provider.enhanceToWhiteBackground({
        buffer: inputBuffer,
        mime: inputMime,
        productName,
        removeBackground,
      });

      let finalBuffer = enhanced.buffer;
      let finalMime = enhanced.mime;
      try {
        const standardized = await standardizeToWhiteCanvas(enhanced.buffer);
        finalBuffer = standardized.buffer;
        finalMime = standardized.mime;
      } catch (err) {
        this.logger.warn(
          `standardize skipped: ${(err as Error).message}`,
        );
      }

      const folder = job.product_id
        ? `products/${job.product_id}/enhanced`
        : `studio/staged/${jobId}/enhanced`;
      const saved = await this.media.saveBuffer(finalBuffer, {
        folder,
        mime: finalMime,
      });

      await this.db.query(
        `INSERT INTO studio.generated_images (
           job_id, product_id, variant_id, storage_key, is_ai_preview, review_status, published
         ) VALUES ($1,$2,$3,$4,true,'pending',false)`,
        [jobId, job.product_id, job.variant_id, saved.storageKey],
      );
      await this.db.query(
        `UPDATE studio.generation_jobs
         SET status = 'succeeded',
             completed_at = now(),
             provider = $2,
             provider_job_id = $3,
             provider_meta = $4::jsonb
         WHERE id = $1`,
        [
          jobId,
          enhanced.provider,
          enhanced.providerJobId ?? null,
          JSON.stringify({
            ...(enhanced.meta ?? {}),
            removeBackground,
          }),
        ],
      );
    } catch (err) {
      this.logger.error(`Enhance job ${jobId} failed`, err as Error);
      await this.db.query(
        `UPDATE studio.generation_jobs
         SET status = 'failed',
             error_message = $2,
             completed_at = now()
         WHERE id = $1`,
        [jobId, (err as Error).message?.slice(0, 500) ?? 'enhance failed'],
      );
      throw err;
    }
  }

  private async runMockGenerator(jobId: string) {
    await this.db.query(
      `UPDATE studio.generation_jobs SET status = 'running' WHERE id = $1`,
      [jobId],
    );
    const { rows } = await this.db.query<{
      product_id: string | null;
      variant_id: string | null;
      source_image_key: string;
      job_type: string;
    }>(
      `SELECT product_id, variant_id, source_image_key,
              COALESCE(job_type, 'try_on') AS job_type
       FROM studio.generation_jobs WHERE id = $1`,
      [jobId],
    );
    const job = rows[0];
    if (!job) return;

    const outKey =
      job.job_type === 'product_transform'
        ? `studio/generated/${jobId}/packshot.svg`
        : `studio/generated/${jobId}/preview.webp`;
    await this.db.query(
      `INSERT INTO studio.generated_images (
         job_id, product_id, variant_id, storage_key, is_ai_preview, review_status, published
       ) VALUES ($1,$2,$3,$4,true,'pending',false)`,
      [jobId, job.product_id, job.variant_id, outKey],
    );
    await this.db.query(
      `UPDATE studio.generation_jobs
       SET status = 'succeeded', completed_at = now()
       WHERE id = $1`,
      [jobId],
    );
  }
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
