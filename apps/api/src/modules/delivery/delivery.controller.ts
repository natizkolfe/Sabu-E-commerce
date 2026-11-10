import { Controller, Get } from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('delivery')
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @Public()
  @Get('health')
  health() {
    return { module: 'delivery', schema: this.deliveryService.schema, status: 'ok' };
  }
}
