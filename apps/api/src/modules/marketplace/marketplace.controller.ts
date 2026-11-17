import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthUser } from '../iam/auth.types';
import { MarketplaceService } from './marketplace.service';
import { CommissionsFinanceService } from './commissions-finance.service';

@Controller('marketplace')
export class MarketplaceController {
  constructor(
    private readonly marketplace: MarketplaceService,
    private readonly finance: CommissionsFinanceService,
  ) {}

  @Public()
  @Get('health')
  health() {
    return {
      module: 'marketplace',
      schema: this.marketplace.schema,
      status: 'ok',
    };
  }

  @Get('admin/vendors')
  @RequirePermissions('marketplace.vendors.read')
  listVendors(
    @Query('status') status?: string,
    @Query('q') q?: string,
  ) {
    return this.marketplace.listVendors({ status, q });
  }

  @Post('admin/vendors')
  @RequirePermissions('marketplace.vendors.write')
  createVendor(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      businessName: string;
      displayName?: string;
      phone?: string;
      email?: string;
      commissionRatePct?: number;
    },
  ) {
    return this.marketplace.createVendor(user, body);
  }

  @Get('admin/vendors/:id')
  @RequirePermissions('marketplace.vendors.read')
  getVendor(@Param('id') id: string) {
    return this.marketplace.getVendor(id);
  }

  @Patch('admin/vendors/:id')
  @RequirePermissions('marketplace.vendors.write')
  updateVendor(
    @Param('id') id: string,
    @Body()
    body: {
      status?: string;
      businessName?: string;
      displayName?: string;
      phone?: string | null;
      email?: string | null;
      commissionRatePct?: number | null;
      notes?: string;
    },
  ) {
    return this.marketplace.updateVendor(id, body);
  }

  @Get('admin/vendors-autocomplete')
  @RequirePermissions('marketplace.commissions.read')
  vendorAutocomplete(@Query('q') q = '') {
    return this.finance.vendorAutocomplete(q.trim() || '');
  }

  @Get('admin/vendors/:id/commission-detail')
  @RequirePermissions('marketplace.commissions.read')
  vendorCommissionDetail(@Param('id') id: string) {
    return this.finance.vendorDetail(id);
  }

  @Get('admin/commissions')
  @RequirePermissions('marketplace.commissions.read')
  listCommissions(
    @Query('vendorId') vendorId?: string,
    @Query('status') status?: string,
    @Query('payoutState') payoutState?: string,
    @Query('categoryId') categoryId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('rateMin') rateMin?: string,
    @Query('rateMax') rateMax?: string,
    @Query('amountMin') amountMin?: string,
    @Query('amountMax') amountMax?: string,
    @Query('orderNumber') orderNumber?: string,
    @Query('settlementNumber') settlementNumber?: string,
    @Query('channel') channel?: string,
    @Query('sort') sort?: string,
    @Query('limit') limit?: string,
  ) {
    const hasFilters =
      categoryId ||
      dateFrom ||
      dateTo ||
      rateMin ||
      rateMax ||
      amountMin ||
      amountMax ||
      orderNumber ||
      settlementNumber ||
      channel ||
      payoutState ||
      sort;
    if (hasFilters) {
      return this.finance.listFilteredCommissions({
        vendorId,
        status,
        payoutState,
        categoryId,
        dateFrom,
        dateTo,
        rateMin: rateMin != null ? Number(rateMin) : undefined,
        rateMax: rateMax != null ? Number(rateMax) : undefined,
        amountMin: amountMin != null ? Number(amountMin) : undefined,
        amountMax: amountMax != null ? Number(amountMax) : undefined,
        orderNumber,
        settlementNumber,
        channel,
        sort,
        limit: limit != null ? Number(limit) : undefined,
      });
    }
    return this.marketplace.listCommissions({ vendorId, status });
  }

  @Get('admin/commissions/summary')
  @RequirePermissions('marketplace.commissions.read')
  commissionsSummary(
    @Query('vendorId') vendorId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.finance.commissionsSummary({
      vendorId,
      dateFrom,
      dateTo,
      categoryId,
    });
  }

  @Get('admin/commissions/analytics')
  @RequirePermissions('marketplace.commissions.read')
  analytics(
    @Query('vendorId') vendorId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.finance.analyticsOverview({ vendorId, dateFrom, dateTo });
  }

  @Get('admin/commissions/export')
  @RequirePermissions('marketplace.commissions.read')
  exportReport(
    @Query('type') type: 'sales' | 'settlements' | 'adjustments' | 'rules' = 'sales',
    @Query('format') format: 'csv' | 'json' = 'csv',
    @Query('vendorId') vendorId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.finance.exportReport(
      type,
      { vendorId, dateFrom, dateTo },
      format,
    );
  }

  @Get('admin/commission-rule')
  @RequirePermissions('marketplace.commissions.read')
  commissionRule() {
    return this.marketplace.getGlobalCommissionRule();
  }

  @Patch('admin/commission-rule')
  @RequirePermissions('marketplace.commissions.write')
  patchGlobalRule(
    @CurrentUser() user: AuthUser,
    @Body() body: { ratePct: number; confirmLargeChange?: boolean },
  ) {
    return this.finance.patchGlobalDefault(user, body);
  }

  @Get('admin/commission-rules')
  @RequirePermissions('marketplace.commissions.read')
  listRules(
    @Query('includeArchived') includeArchived?: string,
    @Query('scope') scope?: string,
  ) {
    return this.finance.listCommissionRules({
      includeArchived: includeArchived === '1' || includeArchived === 'true',
      scope,
    });
  }

  @Get('admin/commission-rules/presets')
  @RequirePermissions('marketplace.commissions.read')
  rulePresets() {
    return this.finance.rulePresets();
  }

  @Post('admin/commission-rules/preview')
  @RequirePermissions('marketplace.commissions.read')
  previewRule(
    @Body() body: { ruleId?: string; ratePct?: number },
  ) {
    return this.finance.previewRuleImpact(body.ruleId, body.ratePct);
  }

  @Post('admin/commission-rules/conflicts')
  @RequirePermissions('marketplace.commissions.read')
  ruleConflicts(
    @Body()
    body: {
      scope: string;
      vendorId?: string | null;
      categoryId?: string | null;
      priority: number;
      validFrom: string;
      validTo?: string | null;
      excludeId?: string;
    },
  ) {
    return this.finance.getRuleConflicts(body);
  }

  @Post('admin/commission-rules')
  @RequirePermissions('marketplace.commissions.write')
  createRule(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      code?: string;
      name: string;
      scope: 'global' | 'vendor' | 'category';
      kind?: 'standard' | 'promo' | 'event';
      priority?: number;
      vendorId?: string;
      categoryId?: string;
      ratePct: number;
      appliesTo?: string;
      timezone?: string;
      validFrom?: string;
      validTo?: string | null;
      notes?: string;
      confirmLargeChange?: boolean;
    },
  ) {
    return this.finance.createCommissionRule(user, body);
  }

  @Patch('admin/commission-rules/:id')
  @RequirePermissions('marketplace.commissions.write')
  updateRule(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      kind?: 'standard' | 'promo' | 'event';
      priority?: number;
      ratePct?: number;
      appliesTo?: string;
      timezone?: string;
      validFrom?: string;
      validTo?: string | null;
      isEnabled?: boolean;
      notes?: string;
      confirmLargeChange?: boolean;
    },
  ) {
    return this.finance.updateCommissionRule(user, id, body);
  }

  @Post('admin/commission-rules/:id/archive')
  @RequirePermissions('marketplace.commissions.write')
  archiveRule(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.finance.archiveCommissionRule(user, id);
  }

  @Post('admin/orders/:orderId/accrue-commissions')
  @RequirePermissions('marketplace.commissions.write')
  accrue(@Param('orderId') orderId: string) {
    return this.marketplace.accrueOrderCommissions(orderId);
  }

  @Get('admin/settlements')
  @RequirePermissions('marketplace.settlements.write')
  listSettlements(
    @Query('vendorId') vendorId?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('settlementNumber') settlementNumber?: string,
  ) {
    return this.finance.listFilteredSettlements({
      vendorId,
      status,
      dateFrom,
      dateTo,
      settlementNumber,
    });
  }

  @Post('admin/settlements/preview')
  @RequirePermissions('marketplace.settlements.write')
  previewSettlement(
    @Body() body: { vendorId: string; entryIds?: string[] },
  ) {
    return this.finance.previewSettlement(body);
  }

  @Post('admin/settlements')
  @RequirePermissions('marketplace.settlements.write')
  createSettlement(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      vendorId: string;
      periodStart?: string;
      periodEnd?: string;
      entryIds?: string[];
      status?: 'draft' | 'pending_payment' | 'approved';
      notes?: string;
    },
  ) {
    if (body.status === 'draft' || body.notes) {
      return this.finance.createSettlementDraft(user, body);
    }
    // Prefer finance draft path with pending_payment for richer status set
    return this.finance.createSettlementDraft(user, {
      ...body,
      status: body.status ?? 'pending_payment',
    });
  }

  @Post('admin/settlements/:id/mark-paid')
  @RequirePermissions('marketplace.settlements.write')
  markPaid(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      payoutReference?: string;
      payoutReceiptKey?: string;
      paidAt?: string;
      amount?: number;
      paymentMethod?: string;
      idempotencyKey?: string;
      markFullyPaid?: boolean;
    },
  ) {
    if (body.amount != null && body.amount > 0) {
      return this.finance.recordSettlementPayment(user, id, {
        amount: body.amount,
        payoutReference: body.payoutReference,
        payoutReceiptKey: body.payoutReceiptKey,
        paidAt: body.paidAt,
        paymentMethod: body.paymentMethod,
        idempotencyKey: body.idempotencyKey,
        markFullyPaid: body.markFullyPaid ?? true,
      });
    }
    return this.marketplace.markSettlementPaid(id, body ?? {});
  }

  @Post('admin/settlements/:id/payments')
  @RequirePermissions('marketplace.settlements.write')
  addPayment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      amount: number;
      payoutReference?: string;
      payoutReceiptKey?: string;
      paidAt?: string;
      paymentMethod?: string;
      idempotencyKey?: string;
      markFullyPaid?: boolean;
    },
  ) {
    return this.finance.recordSettlementPayment(user, id, body);
  }

  @Post('admin/settlements/:id/cancel')
  @RequirePermissions('marketplace.settlements.write')
  cancelSettlement(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.finance.cancelSettlement(user, id);
  }

  @Post('admin/settlements/:id/whatsapp')
  @RequirePermissions('marketplace.settlements.write')
  sendWhatsApp(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body?: { phone?: string; message?: string },
  ) {
    return this.finance.sendSettlementWhatsApp(user, id, body);
  }

  @Post('admin/settlements/:id/log-copy')
  @RequirePermissions('marketplace.settlements.write')
  logCopy(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.finance.logReceiptCopy(user, id);
  }

  @Get('admin/adjustments')
  @RequirePermissions('marketplace.commissions.read')
  listAdjustments(
    @Query('vendorId') vendorId?: string,
    @Query('status') status?: string,
  ) {
    return this.finance.listAdjustments({ vendorId, status });
  }

  @Post('admin/adjustments')
  @RequirePermissions('marketplace.commissions.write')
  createAdjustment(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      vendorId: string;
      adjustmentType: string;
      adjustmentAmount: number;
      reason: string;
      settlementId?: string;
      commissionEntryId?: string;
      originalAmount?: number;
      confirmLargeChange?: boolean;
    },
  ) {
    return this.finance.createAdjustment(user, body);
  }

  @Post('admin/adjustments/:id/approve')
  @RequirePermissions('marketplace.commissions.write')
  approveAdjustment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.finance.approveAdjustment(user, id);
  }

  @Post('admin/adjustments/:id/void')
  @RequirePermissions('marketplace.commissions.write')
  voidAdjustment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.finance.voidAdjustment(user, id);
  }

  @Get('admin/commission-audit')
  @RequirePermissions('marketplace.commissions.read')
  auditLog(
    @Query('entityType') entityType?: string,
    @Query('limit') limit?: string,
  ) {
    return this.finance.listAuditLog({
      entityType,
      limit: limit != null ? Number(limit) : undefined,
    });
  }
}
