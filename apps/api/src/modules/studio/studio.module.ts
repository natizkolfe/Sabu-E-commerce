import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { MediaModule } from '../media/media.module';
import { EnhanceProviderFactory } from './providers/enhance-provider.factory';
import { MockEnhanceProvider } from './providers/mock-enhance.provider';
import { PhotoroomEnhanceProvider } from './providers/photoroom-enhance.provider';
import { StudioController } from './studio.controller';
import { StudioService } from './studio.service';

@Module({
  imports: [MediaModule, CatalogModule],
  controllers: [StudioController],
  providers: [
    StudioService,
    MockEnhanceProvider,
    PhotoroomEnhanceProvider,
    EnhanceProviderFactory,
  ],
  exports: [StudioService],
})
export class StudioModule {}
