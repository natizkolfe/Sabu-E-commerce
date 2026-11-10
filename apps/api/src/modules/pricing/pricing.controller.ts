import { Controller, Get } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Public()
  @Get('health')
  health() {
    return { module: 'pricing', schema: this.pricingService.schema, status: 'ok' };
  }
}
