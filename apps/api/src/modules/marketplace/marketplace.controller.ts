import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthUser } from '../iam/auth.types';
import { MarketplaceService } from './marketplace.service';

@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

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
      displayName?: string;
      commissionRatePct?: number | null;
      notes?: string;
    },
  ) {
    return this.marketplace.updateVendor(id, body);
  }

  @Get('admin/commissions')
  @RequirePermissions('marketplace.commissions.read')
  listCommissions(
    @Query('vendorId') vendorId?: string,
    @Query('status') status?: string,
  ) {
    return this.marketplace.listCommissions({ vendorId, status });
  }

  @Get('admin/commission-rule')
  @RequirePermissions('marketplace.commissions.read')
  commissionRule() {
    return this.marketplace.getGlobalCommissionRule();
  }

  @Post('admin/orders/:orderId/accrue-commissions')
  @RequirePermissions('marketplace.commissions.write')
  accrue(@Param('orderId') orderId: string) {
    return this.marketplace.accrueOrderCommissions(orderId);
  }

  @Get('admin/settlements')
  @RequirePermissions('marketplace.settlements.write')
  listSettlements(@Query('vendorId') vendorId?: string) {
    return this.marketplace.listSettlements({ vendorId });
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
    },
  ) {
    return this.marketplace.createSettlement(user, body);
  }

  @Post('admin/settlements/:id/mark-paid')
  @RequirePermissions('marketplace.settlements.write')
  markPaid(
    @Param('id') id: string,
    @Body() body: { payoutReference?: string },
  ) {
    return this.marketplace.markSettlementPaid(id, body ?? {});
  }
}
