import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ImageEnhanceProvider } from './enhance.types';
import { MockEnhanceProvider } from './mock-enhance.provider';
import { PhotoroomEnhanceProvider } from './photoroom-enhance.provider';

@Injectable()
export class EnhanceProviderFactory {
  constructor(
    private readonly config: ConfigService,
    private readonly mock: MockEnhanceProvider,
    private readonly photoroom: PhotoroomEnhanceProvider,
  ) {}

  resolve(): ImageEnhanceProvider {
    const forced = (
      this.config.get<string>('STUDIO_ENHANCE_PROVIDER') ?? ''
    )
      .trim()
      .toLowerCase();
    const hasKey = Boolean(this.config.get<string>('PHOTOROOM_API_KEY')?.trim());

    if (forced === 'mock') return this.mock;
    if (forced === 'photoroom') return this.photoroom;
    return hasKey ? this.photoroom : this.mock;
  }

  /** Always the local white-canvas path (no Photoroom cutout). */
  resolveLocal(): ImageEnhanceProvider {
    return this.mock;
  }
}
