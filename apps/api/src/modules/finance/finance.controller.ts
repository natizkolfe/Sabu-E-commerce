import { Controller, Get, Param, Post } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Public()
  @Get('health')
  health() {
    return {
      module: 'finance',
      schema: this.financeService.schema,
      status: 'ok',
    };
  }

  @Get('admin/receipts')
  @RequirePermissions('receipts.read')
  listReceipts() {
    return this.financeService.listCustomerReceipts();
  }

  @Get('admin/receipts/:idOrNumber')
  @RequirePermissions('receipts.read')
  getReceipt(@Param('idOrNumber') idOrNumber: string) {
    return this.financeService.getCustomerReceipt(idOrNumber);
  }

  @Post('admin/orders/:orderId/receipt')
  @RequirePermissions('receipts.write')
  ensureReceipt(@Param('orderId') orderId: string) {
    return this.financeService.ensureReceiptForOrder(orderId);
  }

  /** Public lookup by receipt number (for customer share / QR). */
  @Public()
  @Get('receipts/:receiptNumber')
  publicReceipt(@Param('receiptNumber') receiptNumber: string) {
    return this.financeService.getCustomerReceipt(receiptNumber);
  }
}
