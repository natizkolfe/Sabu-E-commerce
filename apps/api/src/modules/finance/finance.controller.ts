import { Controller, Get } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Public()
  @Get('health')
  health() {
    return { module: 'finance', schema: this.financeService.schema, status: 'ok' };
  }
}
