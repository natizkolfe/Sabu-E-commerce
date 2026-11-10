import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { AuthUser } from '../iam/auth.types';

@Injectable()
export class StudioService {
  readonly schema = 'studio' as const;

  constructor(private readonly db: DatabaseService) {}

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

  async listPendingReviews() {
    const { rows } = await this.db.query<{
      id: string;
      storage_key: string;
      product_name: string;
      product_slug: string;
      review_status: string;
      created_at: Date;
      job_id: string;
    }>(
      `SELECT gi.id, gi.storage_key, p.name AS product_name, p.slug AS product_slug,
              gi.review_status, gi.created_at, gi.job_id
       FROM studio.generated_images gi
       JOIN catalog.products p ON p.id = gi.product_id
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
      previewUrl: `/studio/images/${r.id}/preview`,
      isAiPreview: true,
    }));
  }

  async enqueueGenerate(input: {
    productId: string;
    variantId?: string;
    modelId: string;
    sourceImageKey?: string;
    user: AuthUser;
  }) {
    const { rows: products } = await this.db.query<{ id: string }>(
      `SELECT id FROM catalog.products WHERE id = $1 AND deleted_at IS NULL`,
      [input.productId],
    );
    if (!products[0]) throw new NotFoundException('Product not found');

    const { rows: models } = await this.db.query<{ id: string }>(
      `SELECT id FROM studio.virtual_models WHERE id = $1 AND is_active`,
      [input.modelId],
    );
    if (!models[0]) throw new NotFoundException('Model not found');

    const sourceKey =
      input.sourceImageKey ??
      (await this.defaultProductImage(input.productId, input.variantId));

    const { rows: jobs } = await this.db.query<{ id: string }>(
      `INSERT INTO studio.generation_jobs (
         product_id, variant_id, model_id, source_image_key, provider, status, requested_by
       ) VALUES ($1,$2,$3,$4,'mock','queued',$5)
       RETURNING id`,
      [
        input.productId,
        input.variantId ?? null,
        input.modelId,
        sourceKey,
        input.user.id,
      ],
    );

    // Mock generator runs inline (swap for BullMQ worker later)
    await this.runMockGenerator(jobs[0].id);
    return { jobId: jobs[0].id, status: 'succeeded' };
  }

  async reviewImage(
    user: AuthUser,
    imageId: string,
    action: 'approve' | 'reject',
    publish = true,
  ) {
    const { rows } = await this.db.query<{ id: string; review_status: string }>(
      `SELECT id, review_status FROM studio.generated_images WHERE id = $1`,
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
    return { ok: true, reviewStatus: status };
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

  /**
   * Serves a visible AI preview card for mock (and future real) generations.
   * Pending + approved images are viewable so admin can review; storefront
   * only requests published ones via product payload.
   */
  async renderPreviewSvg(imageId: string) {
    const { rows } = await this.db.query<{
      id: string;
      review_status: string;
      published: boolean;
      product_name: string;
      model_name: string | null;
    }>(
      `SELECT gi.id, gi.review_status, gi.published, p.name AS product_name,
              vm.display_name AS model_name
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
    const model = escapeXml((img.model_name ?? 'Virtual model').slice(0, 36));
    const badge =
      img.review_status === 'pending' ? 'AI PREVIEW · PENDING' : 'AI PREVIEW';

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
      model_id: string;
    }>(
      `SELECT product_id, variant_id, source_image_key, model_id
       FROM studio.generation_jobs WHERE id = $1`,
      [jobId],
    );
    const job = rows[0];
    if (!job) return;

    const outKey = `studio/generated/${jobId}/preview.webp`;
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
