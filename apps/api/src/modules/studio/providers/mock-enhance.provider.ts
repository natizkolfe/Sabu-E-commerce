import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import type {
  EnhanceInput,
  EnhanceResult,
  ImageEnhanceProvider,
} from './enhance.types';
import { edgeFloodCutout } from './edge-flood-cutout';

/**
 * Local enhance when PHOTOROOM_API_KEY is unset.
 * Default: keep the photo (light soften only) — white canvas is applied later.
 * Optional removeBackground: edge flood-fill cutout for busy warehouse shots.
 */
@Injectable()
export class MockEnhanceProvider implements ImageEnhanceProvider {
  readonly name = 'local_white_canvas';
  private readonly logger = new Logger(MockEnhanceProvider.name);

  async enhanceToWhiteBackground(input: EnhanceInput): Promise<EnhanceResult> {
    const removeBg = Boolean(input.removeBackground);

    try {
      let prepared: Buffer;
      let method = 'white_canvas_only';

      if (removeBg) {
        try {
          prepared = await edgeFloodCutout(input.buffer);
          method = 'edge_flood';
        } catch (err) {
          this.logger.warn(
            `optional remove-bg failed, keeping photo: ${(err as Error).message}`,
          );
          prepared = await this.softenNearWhite(input.buffer);
          method = 'soften_fallback';
        }
      } else {
        prepared = await this.softenNearWhite(input.buffer);
      }

      const meta = await sharp(prepared, { failOn: 'none' }).metadata();
      return {
        buffer: prepared,
        mime: 'image/png',
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        provider: this.name,
        meta: {
          removeBackground: removeBg,
          method,
          note: removeBg
            ? 'Local cutout — Photoroom recommended for production'
            : 'White canvas only — background kept',
        },
      };
    } catch (err) {
      this.logger.warn(
        `local enhance failed, using original: ${(err as Error).message}`,
      );
      const meta = await sharp(input.buffer, { failOn: 'none' }).metadata();
      return {
        buffer: input.buffer,
        mime: input.mime,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        provider: this.name,
        meta: { mock: true, fallback: true, removeBackground: removeBg },
      };
    }
  }

  /** Soften pale phone backdrops without destroying product pixels. */
  private async softenNearWhite(buffer: Buffer): Promise<Buffer> {
    const { data, info } = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    if (channels < 3) return buffer;

    for (let i = 0; i < data.length; i += channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const chroma = max - min;
      // Only very pale / near-white pixels
      if (min >= 225 && chroma <= 22) {
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        if (channels === 4) data[i + 3] = 255;
      }
    }

    return sharp(data, {
      raw: {
        width: info.width,
        height: info.height,
        channels: channels as 3 | 4,
      },
    })
      .png()
      .toBuffer();
  }
}
