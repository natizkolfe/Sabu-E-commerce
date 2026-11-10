import { Controller, Get } from '@nestjs/common';
import { SalesService } from './sales.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Public()
  @Get('health')
  health() {
    return { module: 'sales', schema: this.salesService.schema, status: 'ok' };
  }
}
