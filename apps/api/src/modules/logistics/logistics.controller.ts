import { Controller, Get } from '@nestjs/common';
import { LogisticsService } from './logistics.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('logistics')
export class LogisticsController {
  constructor(private readonly logisticsService: LogisticsService) {}

  @Public()
  @Get('health')
  health() {
    return { module: 'logistics', schema: this.logisticsService.schema, status: 'ok' };
  }
}
