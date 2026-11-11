import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  EnhanceInput,
  EnhanceResult,
  ImageEnhanceProvider,
} from './enhance.types';

/**
 * Photoroom Image Editing API — background removal + solid white background.
 * Docs: https://www.photoroom.com/api/docs/reference/edit-image-basic
 */
@Injectable()
export class PhotoroomEnhanceProvider implements ImageEnhanceProvider {
  readonly name = 'photoroom';
  private readonly logger = new Logger(PhotoroomEnhanceProvider.name);

  constructor(private readonly config: ConfigService) {}

  async enhanceToWhiteBackground(input: EnhanceInput): Promise<EnhanceResult> {
    // White canvas only — skip paid cutout unless toggle is on
    if (!input.removeBackground) {
      return {
        buffer: input.buffer,
        mime: input.mime,
        width: 0,
        height: 0,
        provider: 'white_canvas_only',
        meta: { removeBackground: false, skippedPhotoroom: true },
      };
    }

    const apiKey = this.config.get<string>('PHOTOROOM_API_KEY')?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'PHOTOROOM_API_KEY is not configured',
      );
    }

    const form = new FormData();
    const blob = new Blob([new Uint8Array(input.buffer)], {
      type: input.mime || 'image/jpeg',
    });
    form.append('imageFile', blob, 'product.jpg');
    form.append('background.color', 'FFFFFF');
    form.append('outputSize', '1200x1500');
    form.append('padding', '0.08');
    form.append('export.format', 'png');

    const endpoint =
      this.config.get<string>('PHOTOROOM_EDIT_URL')?.trim() ||
      'https://image-api.photoroom.com/v2/edit';

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          Accept: 'image/png, application/json',
        },
        body: form,
      });
    } catch (err) {
      this.logger.error('Photoroom request failed', err as Error);
      throw new ServiceUnavailableException('Photoroom request failed');
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`Photoroom error ${res.status}: ${text.slice(0, 400)}`);
      throw new BadRequestException(
        `Photoroom enhance failed (${res.status})`,
      );
    }

    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    if (!buffer.length) {
      throw new BadRequestException('Photoroom returned an empty image');
    }

    return {
      buffer,
      mime: 'image/png',
      width: 1200,
      height: 1500,
      provider: this.name,
      providerJobId: res.headers.get('x-request-id') ?? undefined,
      meta: { endpoint },
    };
  }
}
