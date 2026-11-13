import { Body, Controller, Get, Param, Post, Put, Headers } from '@nestjs/common';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
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

class NotesDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

class ClarificationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  notes!: string;
}

class TelebirrSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  merchantAccount?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  instructions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  helpText?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  txnFormatRegex?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
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
  @Get('telebirr/settings')
  telebirrSettings() {
    return this.paymentsService.getTelebirrSettings();
  }

  @Get('admin/telebirr/settings')
  @RequirePermissions('payments.verify')
  adminTelebirrSettings() {
    return this.paymentsService.getTelebirrSettings();
  }

  @Put('admin/telebirr/settings')
  @RequirePermissions('payments.verify')
  updateTelebirr(
    @CurrentUser() user: AuthUser,
    @Body() dto: TelebirrSettingsDto,
  ) {
    return this.paymentsService.updateTelebirrSettings(user, dto);
  }

  @Public()
  @Get('bank-accounts')
  bankAccounts() {
    return this.paymentsService.listBankAccounts();
  }

  @Get('admin/bank-accounts')
  @RequirePermissions('payments.verify')
  adminBankAccounts() {
    return this.paymentsService.listBankAccounts({ includeInactive: true });
  }

  @Post('admin/bank-accounts')
  @RequirePermissions('payments.verify')
  createBankAccount(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      bankName: string;
      accountName: string;
      accountNumber: string;
      branchName?: string | null;
      instructions?: string | null;
      code?: string | null;
      isFeatured?: boolean;
      isActive?: boolean;
      sortOrder?: number;
    },
  ) {
    return this.paymentsService.upsertBankAccount(user, body);
  }

  @Put('admin/bank-accounts/:id')
  @RequirePermissions('payments.verify')
  updateBankAccount(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      bankName: string;
      accountName: string;
      accountNumber: string;
      branchName?: string | null;
      instructions?: string | null;
      code?: string | null;
      isFeatured?: boolean;
      isActive?: boolean;
      sortOrder?: number;
    },
  ) {
    return this.paymentsService.upsertBankAccount(user, { ...body, id });
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

  @Post('transactions/:id/clarification')
  @RequirePermissions('payments.verify')
  clarification(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ClarificationDto,
  ) {
    return this.paymentsService.requestClarification(user, id, dto.notes);
  }

  @Post('transactions/:id/flag-duplicate')
  @RequirePermissions('payments.verify')
  flagDuplicate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: NotesDto,
  ) {
    return this.paymentsService.flagDuplicate(user, id, dto.notes);
  }

  @Get('transactions/:id/verification-logs')
  @RequirePermissions('payments.verify')
  verificationLogs(@Param('id') id: string) {
    return this.paymentsService.listVerificationLogs(id);
  }
}
