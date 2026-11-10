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
    }));
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
