import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { AuthUser } from '../iam/auth.types';
import { MediaService } from '../media/media.service';
import { CatalogService } from '../catalog/catalog.service';

const TRANSFORM_PRESETS = [
  'studio_packshot',
  'ghost_mannequin',
  'background_cleanup',
] as const;

type TransformPreset = (typeof TRANSFORM_PRESETS)[number];

@Injectable()
export class StudioService {
  readonly schema = 'studio' as const;

  constructor(
    private readonly db: DatabaseService,
    private readonly media: MediaService,
    private readonly catalog: CatalogService,
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

  async listPendingReviews() {
    const { rows } = await this.db.query<{
      id: string;
      storage_key: string;
      product_name: string;
      product_slug: string;
      review_status: string;
      created_at: Date;
      job_id: string;
      job_type: string;
      transform_preset: string | null;
      source_image_key: string;
      model_name: string | null;
    }>(
      `SELECT gi.id, gi.storage_key, p.name AS product_name, p.slug AS product_slug,
              gi.review_status, gi.created_at, gi.job_id,
              COALESCE(j.job_type, 'try_on') AS job_type,
              j.transform_preset, j.source_image_key,
              vm.display_name AS model_name
       FROM studio.generated_images gi
       JOIN catalog.products p ON p.id = gi.product_id
       LEFT JOIN studio.generation_jobs j ON j.id = gi.job_id
       LEFT JOIN studio.virtual_models vm ON vm.id = j.model_id
       WHERE gi.review_status = 'pending'
       ORDER BY gi.created_at`,
    );
    return rows.map((r) => ({
      id: r.id,
      storageKey: r.storage_key,
      productName: r.product_name,
      productSlug: r.product_slug,
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
      previewUrl: `/studio/images/${r.id}/preview`,
      isAiPreview: true,
    }));
  }

  async enqueueGenerate(input: {
    productId: string;
    variantId?: string;
    modelId?: string;
    sourceImageKey?: string;
    jobType?: 'try_on' | 'product_transform';
    transformPreset?: TransformPreset;
    user: AuthUser;
  }) {
    const jobType = input.jobType ?? 'try_on';
    const { rows: products } = await this.db.query<{ id: string }>(
      `SELECT id FROM catalog.products WHERE id = $1 AND deleted_at IS NULL`,
      [input.productId],
    );
    if (!products[0]) throw new NotFoundException('Product not found');

    if (jobType === 'try_on') {
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
    }

    const sourceKey =
      input.sourceImageKey ??
      (await this.defaultProductImage(input.productId, input.variantId));

    const { rows: jobs } = await this.db.query<{ id: string }>(
      `INSERT INTO studio.generation_jobs (
         product_id, variant_id, model_id, source_image_key, provider, status,
         requested_by, job_type, transform_preset
       ) VALUES ($1,$2,$3,$4,'mock','queued',$5,$6,$7)
       RETURNING id`,
      [
        input.productId,
        input.variantId ?? null,
        jobType === 'try_on' ? input.modelId! : null,
        sourceKey,
        input.user.id,
        jobType,
        jobType === 'product_transform' ? input.transformPreset! : null,
      ],
    );

    await this.runMockGenerator(jobs[0].id);
    return { jobId: jobs[0].id, status: 'succeeded', jobType };
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
      product_id: string;
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
    if (action === 'approve' && rows[0].job_type === 'product_transform') {
      const svg = await this.renderPreviewSvg(imageId);
      const saved = await this.media.saveDataUrl(
        `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
        {
          folder: `products/${rows[0].product_id}/studio`,
          mimeHint: 'image/svg+xml',
        },
      );
      const added = await this.catalog.addProductImage({
        productId: rows[0].product_id,
        storageKey: saved.storageKey,
        variantId: rows[0].variant_id,
        isPrimary: true,
        source: 'studio_transform',
        altText: rows[0].transform_preset
          ? `AI ${rows[0].transform_preset.replace(/_/g, ' ')}`
          : 'AI studio transform',
      });
      catalogImageId = added.id;
    }

    return { ok: true, reviewStatus: status, catalogImageId };
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
      previewUrl: `/studio/images/${r.id}/preview`,
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
    }>(
      `SELECT gi.id, gi.review_status, gi.published, p.name AS product_name,
              vm.display_name AS model_name,
              COALESCE(j.job_type, 'try_on') AS job_type,
              j.transform_preset
       FROM studio.generated_images gi
       JOIN catalog.products p ON p.id = gi.product_id
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

    const title = escapeXml(img.product_name.slice(0, 42));
    const badge =
      img.review_status === 'pending' ? 'AI PREVIEW · PENDING' : 'AI PREVIEW';

    if (img.job_type === 'product_transform') {
      const preset = escapeXml(
        (img.transform_preset ?? 'studio_packshot').replace(/_/g, ' '),
      );
      return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1200" viewBox="0 0 960 1200">
  <defs>
    <linearGradient id="studio" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f4f6f5"/>
      <stop offset="55%" stop-color="#e4ebe7"/>
      <stop offset="100%" stop-color="#cfd9d3"/>
    </linearGradient>
  </defs>
  <rect width="960" height="1200" fill="url(#studio)"/>
  <ellipse cx="480" cy="980" rx="220" ry="28" fill="#9aaba2" opacity="0.35"/>
  <path d="M330 260 L480 210 L630 260 L610 780 L480 840 L350 780 Z" fill="#c4a574" stroke="#8a734d" stroke-width="3"/>
  <path d="M360 300 L480 270 L600 300 L585 430 L480 450 L375 430 Z" fill="#d2b58a"/>
  <text x="48" y="64" fill="#2f6b4f" font-family="Georgia, serif" font-size="22" letter-spacing="3">${badge}</text>
  <text x="48" y="110" fill="#1a2922" font-family="Georgia, serif" font-size="36">${title}</text>
  <text x="48" y="150" fill="#5a6f64" font-family="Arial, sans-serif" font-size="20">Target · ${preset}</text>
  <text x="48" y="1140" fill="#6d8076" font-family="Arial, sans-serif" font-size="16">Illustrative AI studio transform · Sabu Admin</text>
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
    <radialGradient id="glow" cx="30%" cy="25%" r="55%">
      <stop offset="0%" stop-color="#e8f5ee" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#e8f5ee" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="960" height="720" fill="url(#bg)"/>
  <rect width="960" height="720" fill="url(#glow)"/>
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

  private async runMockGenerator(jobId: string) {
    await this.db.query(
      `UPDATE studio.generation_jobs SET status = 'running' WHERE id = $1`,
      [jobId],
    );
    const { rows } = await this.db.query<{
      product_id: string;
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
