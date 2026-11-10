import { Controller, Get } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Public()
  @Get('health')
  health() {
    return { module: 'payments', schema: this.paymentsService.schema, status: 'ok' };
  }
}
