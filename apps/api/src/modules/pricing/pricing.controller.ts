import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../iam/auth.types';
import { PricingService } from './pricing.service';

class SetTierDto {
  @IsIn(['RETAIL-ETB', 'WHOLESALE-ETB'])
  listCode!: 'RETAIL-ETB' | 'WHOLESALE-ETB';

  @IsUUID()
  variantId!: string;

  @IsInt()
  @Min(1)
  minQty!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  compareAtPrice?: number;
}

@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Public()
  @Get('health')
  health() {
    return { module: 'pricing', schema: this.pricing.schema, status: 'ok' };
  }

  @Get('admin/tiers')
  @RequirePermissions('catalog.write')
  listTiers(@Query('variantId') variantId: string) {
    return this.pricing.listActiveTiers(variantId);
  }

  @Post('admin/tiers')
  @RequirePermissions('catalog.write')
  setTier(@CurrentUser() user: AuthUser, @Body() dto: SetTierDto) {
    return this.pricing.setTierPrice({ ...dto, actorId: user.id });
  }
}
