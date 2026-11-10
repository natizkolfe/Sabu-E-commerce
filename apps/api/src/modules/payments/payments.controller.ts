import { Body, Controller, Get, Param, Post, Headers } from '@nestjs/common';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../iam/auth.types';
import { PaymentsService } from './payments.service';

class InitializeChapaDto {
  @IsUUID()
  paymentIntentId!: string;

  @IsString()
  @MinLength(8)
  returnUrl!: string;

  @IsOptional()
  @IsString()
  customerEmail?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;
}

class BankTransferSubmitDto {
  @IsUUID()
  paymentIntentId!: string;

  @IsUUID()
  companyBankAccountId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  customerReference?: string;

  /** Storage key or data-URL placeholder until object storage is wired */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  receiptStorageKey!: string;
}

class RejectDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

class MockCompleteDto {
  @IsString()
  @MinLength(3)
  txRef!: string;
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Public()
  @Get('health')
  health() {
    return {
      module: 'payments',
      schema: this.paymentsService.schema,
      status: 'ok',
    };
  }

  @Public()
  @Get('methods')
  methods() {
    return this.paymentsService.listActiveMethods();
  }

  @Public()
  @Get('bank-accounts')
  bankAccounts() {
    return this.paymentsService.listBankAccounts();
  }

  @Public()
  @Post('intents/:id/chapa/initialize')
  initializeChapa(
    @Param('id') id: string,
    @Body() dto: Omit<InitializeChapaDto, 'paymentIntentId'> & {
      paymentIntentId?: string;
    },
  ) {
    return this.paymentsService.initializeChapa({
      paymentIntentId: id,
      returnUrl: dto.returnUrl,
      customerEmail: dto.customerEmail,
      customerName: dto.customerName,
      customerPhone: dto.customerPhone,
    });
  }

  @Public()
  @Post('webhooks/chapa')
  chapaWebhook(
    @Body() body: unknown,
    @Headers('x-chapa-signature') signature?: string,
  ) {
    return this.paymentsService.handleChapaWebhook(body, signature);
  }

  @Public()
  @Post('chapa/mock-complete')
  mockComplete(@Body() dto: MockCompleteDto) {
    return this.paymentsService.completeMockChapa(dto.txRef);
  }

  @Public()
  @Post('bank-transfer/submit')
  submitBank(@Body() dto: BankTransferSubmitDto) {
    return this.paymentsService.submitBankTransfer(dto);
  }

  @Get('verifications/pending')
  @RequirePermissions('payments.verify')
  pending() {
    return this.paymentsService.listPendingVerifications();
  }

  @Post('transactions/:id/approve')
  @RequirePermissions('payments.verify')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.paymentsService.approveBankTransfer(user, id);
  }

  @Post('transactions/:id/reject')
  @RequirePermissions('payments.verify')
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RejectDto,
  ) {
    return this.paymentsService.rejectBankTransfer(user, id, dto.reason);
  }
}
