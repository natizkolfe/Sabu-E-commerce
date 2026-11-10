import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../iam/auth.types';
import { StudioService } from './studio.service';

class GenerateDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsUUID()
  modelId!: string;

  @IsOptional()
  sourceImageKey?: string;
}

class ReviewDto {
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
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
  pending() {
    return this.studio.listPendingReviews();
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
