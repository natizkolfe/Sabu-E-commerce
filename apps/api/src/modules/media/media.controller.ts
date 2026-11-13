import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import type { Response } from 'express';
import { createReadStream } from 'fs';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { MediaService } from './media.service';

class UploadDto {
  @IsString()
  @MinLength(32)
  data!: string;

  @IsOptional()
  @IsString()
  folder?: string;

  @IsOptional()
  @IsString()
  mimeType?: string;
}

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Public()
  @Get('health')
  health() {
    return { module: 'media', status: 'ok' };
  }

  @Post('upload')
  @RequirePermissions('catalog.write')
  async upload(@Body() dto: UploadDto) {
    const saved = await this.media.saveDataUrl(dto.data, {
      folder: dto.folder ?? 'uploads',
      mimeHint: dto.mimeType,
    });
    return {
      ...saved,
      url: `/media/file?key=${encodeURIComponent(saved.storageKey)}`,
    };
  }

  /** Guest special-order reference image (max 1 MB, JPG/PNG only). */
  @Public()
  @Post('upload/special-order')
  async uploadSpecialOrder(@Body() dto: UploadDto) {
    const saved = await this.media.saveDataUrl(dto.data, {
      folder: 'special-orders',
      mimeHint: dto.mimeType,
      maxBytes: 1024 * 1024,
      allowedMimes: ['image/jpeg', 'image/png'],
    });
    return {
      ...saved,
      url: `/media/file?key=${encodeURIComponent(saved.storageKey)}`,
    };
  }

  @Public()
  @Get('file')
  async serve(@Query('key') key: string, @Res() res: Response) {
    if (!key) {
      res.status(400).send('Missing key');
      return;
    }
    const resolved = await this.media.resolve(key);
    res.type(resolved.mime);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    createReadStream(resolved.abs).pipe(res);
  }
}
