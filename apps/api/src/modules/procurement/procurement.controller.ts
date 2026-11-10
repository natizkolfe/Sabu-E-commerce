import { Controller, Get } from '@nestjs/common';
import { ProcurementService } from './procurement.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('procurement')
export class ProcurementController {
  constructor(private readonly procurementService: ProcurementService) {}

  @Public()
  @Get('health')
  health() {
    return { module: 'procurement', schema: this.procurementService.schema, status: 'ok' };
  }
}
