import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthUser } from '../iam/auth.types';
import { ProcurementService } from './procurement.service';

@Controller('procurement')
export class ProcurementController {
  constructor(private readonly procurementService: ProcurementService) {}

  @Public()
  @Get('health')
  health() {
    return {
      module: 'procurement',
      schema: this.procurementService.schema,
      status: 'ok',
    };
  }

  @Public()
  @Post('special-orders')
  createSpecialOrder(
    @Body()
    body: {
      firstName: string;
      lastName: string;
      phone: string;
      sourcingRegionCode: 'US' | 'CN' | 'AE-DXB';
      productName: string;
      description: string;
      quantity?: number;
      preferredContactChannel?: string;
      imageStorageKeys: string[];
      imageMimeTypes?: string[];
    },
  ) {
    return this.procurementService.createSpecialOrder(body);
  }

  @Get('admin/special-orders')
  @RequirePermissions('special_orders.read')
  listSpecialOrders(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.procurementService.listSpecialOrders({
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('admin/partners')
  @RequirePermissions('partners.read')
  listPartners() {
    return this.procurementService.listPartners();
  }

  @Post('admin/special-orders/:id/assign')
  @RequirePermissions('special_orders.write')
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { supplierId: string },
  ) {
    return this.procurementService.assignPartner(user, id, body.supplierId);
  }
}
