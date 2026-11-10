import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { MediaModule } from '../media/media.module';
import { StudioController } from './studio.controller';
import { StudioService } from './studio.service';

@Module({
  imports: [MediaModule, CatalogModule],
  controllers: [StudioController],
  providers: [StudioService],
  exports: [StudioService],
})
export class StudioModule {}
