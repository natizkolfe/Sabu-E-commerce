import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

@Injectable()
export class MediaService {
  readonly schema = 'media' as const;
  private readonly root: string;

  constructor(private readonly config: ConfigService) {
    this.root =
      this.config.get<string>('MEDIA_ROOT') ??
      path.join(process.cwd(), 'uploads');
  }

  async ensureRoot() {
    await fs.mkdir(this.root, { recursive: true });
  }

  /**
   * Accepts a data URL or raw base64 + mime, writes under uploads/, returns storage key.
   */
  async saveDataUrl(
    dataUrlOrBase64: string,
    opts: { folder: string; mimeHint?: string; originalName?: string },
  ) {
    await this.ensureRoot();
    let mime = opts.mimeHint ?? 'image/jpeg';
    let b64 = dataUrlOrBase64.trim();

    const dataUrlMatch = /^data:([^;]+);base64,(.+)$/s.exec(b64);
    if (dataUrlMatch) {
      mime = dataUrlMatch[1].toLowerCase();
      b64 = dataUrlMatch[2];
    }

    const ext = ALLOWED_MIME[mime];
    if (!ext) {
      throw new BadRequestException(
        `Unsupported image type ${mime}. Use jpeg, png, webp, gif, or svg.`,
      );
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(b64, 'base64');
    } catch {
      throw new BadRequestException('Invalid base64 image payload');
    }
    if (!buffer.length) throw new BadRequestException('Empty image payload');
    if (buffer.length > 8 * 1024 * 1024) {
      throw new BadRequestException('Image too large (max 8MB)');
    }

    const folder = opts.folder.replace(/[^a-zA-Z0-9/_-]/g, '').replace(/^\/+|\/+$/g, '');
    const hash = createHash('sha1').update(buffer).digest('hex').slice(0, 10);
    const id = randomUUID().slice(0, 8);
    const storageKey = `${folder}/${id}-${hash}.${ext}`;
    const abs = path.join(this.root, ...storageKey.split('/'));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buffer);

    return {
      storageKey,
      mime,
      size: buffer.length,
      url: `/media/${storageKey}`,
    };
  }

  async resolve(storageKey: string) {
    const safe = storageKey.replace(/\\/g, '/').replace(/\.\./g, '');
    const abs = path.join(this.root, ...safe.split('/'));
    try {
      await fs.access(abs);
    } catch {
      throw new NotFoundException('Media not found');
    }
    const ext = path.extname(abs).toLowerCase().replace('.', '');
    const mime =
      Object.entries(ALLOWED_MIME).find(([, e]) => e === ext)?.[0] ??
      'application/octet-stream';
    return { abs, mime, storageKey: safe };
  }
}
