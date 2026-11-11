import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../iam/auth.types';
import { StudioService } from './studio.service';

class GenerateDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsOptional()
  @IsUUID()
  modelId?: string;

  @IsOptional()
  @IsString()
  sourceImageKey?: string;

  @IsOptional()
  @IsIn(['try_on', 'product_transform'])
  jobType?: 'try_on' | 'product_transform';

  @IsOptional()
  @IsIn([
    'studio_packshot',
    'ghost_mannequin',
    'background_cleanup',
    'white_background_ecommerce',
  ])
  transformPreset?:
    | 'studio_packshot'
    | 'ghost_mannequin'
    | 'background_cleanup'
    | 'white_background_ecommerce';

  /** Optional AI/local cutout. Default false = white canvas only (keeps photo). */
  @IsOptional()
  @IsBoolean()
  removeBackground?: boolean;
}

class ReviewDto {
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

class AttachDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsBoolean()
  setPrimary?: boolean;

  @IsOptional()
  @IsBoolean()
  includeOriginal?: boolean;
}

@Controller('studio')
export class StudioController {
  constructor(private readonly studio: StudioService) {}

  @Public()
  @Get('health')
  health() {
    return { module: 'studio', schema: this.studio.schema, status: 'ok' };
  }

  @Get('models')
  @RequirePermissions('studio.generate')
  models() {
    return this.studio.listModels();
  }

  @Get('transform-presets')
  @RequirePermissions('studio.generate')
  transformPresets() {
    return this.studio.listTransformPresets();
  }

  @Public()
  @Get('products/:productId/previews')
  previews(@Param('productId') productId: string) {
    return this.studio.listPublishedForProduct(productId);
  }

  @Public()
  @Get('images/:id/preview')
  @Header('Cache-Control', 'public, max-age=120')
  async imagePreview(@Param('id') id: string, @Res() res: Response) {
    const svg = await this.studio.renderPreviewSvg(id);
    res.type('image/svg+xml').send(svg);
  }

  @Post('generate')
  @RequirePermissions('studio.generate')
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateDto) {
    return this.studio.enqueueGenerate({ ...dto, user });
  }

  @Get('reviews/pending')
  @RequirePermissions('studio.publish')
  pending(
    @Query('productId') productId?: string,
    @Query('stagedOnly') stagedOnly?: string,
    @Query('jobType') jobType?: 'try_on' | 'product_transform',
  ) {
    return this.studio.listPendingReviews({
      productId: productId || undefined,
      stagedOnly: stagedOnly === '1' || stagedOnly === 'true',
      jobType: jobType || undefined,
    });
  }

  @Get('library')
  @RequirePermissions('studio.publish')
  library() {
    return this.studio.listEnhanceLibrary();
  }

  @Post('images/:id/attach')
  @RequirePermissions('studio.publish')
  attach(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AttachDto,
  ) {
    return this.studio.attachToProduct(user, id, dto.productId, {
      setPrimary: dto.setPrimary,
      includeOriginal: dto.includeOriginal,
    });
  }

  @Post('images/:id/save')
  @RequirePermissions('studio.publish')
  save(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.studio.saveToLibrary(user, id);
  }

  @Post('images/:id/approve')
  @RequirePermissions('studio.publish')
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReviewDto,
  ) {
    return this.studio.reviewImage(user, id, 'approve', dto.publish ?? true);
  }

  @Post('images/:id/reject')
  @RequirePermissions('studio.publish')
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.studio.reviewImage(user, id, 'reject', false);
  }
}
