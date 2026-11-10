import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AnalyticsService, DashboardFilters } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Public()
  @Get('health')
  health() {
    return {
      module: 'analytics',
      schema: this.analytics.schema,
      status: 'ok',
    };
  }

  @Get('admin/overview')
  @RequirePermissions('analytics.read')
  overview(@Query('days') days?: string) {
    return this.analytics.overview(days ? Number(days) : 30);
  }

  @Get('admin/dashboard')
  @RequirePermissions('analytics.read')
  dashboard(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('approvalStatus') approvalStatus?: string,
    @Query('qaStatus') qaStatus?: string,
    @Query('deliveryStatus') deliveryStatus?: string,
    @Query('contactStatus') contactStatus?: string,
    @Query('orderStatus') orderStatus?: string,
    @Query('orderType') orderType?: string,
    @Query('fulfillmentType') fulfillmentType?: string,
    @Query('categoryId') categoryId?: string,
    @Query('driverId') driverId?: string,
    @Query('amountMin') amountMin?: string,
    @Query('amountMax') amountMax?: string,
    @Query('q') q?: string,
    @Query('attention') attention?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sort') sort?: string,
    @Query('sortDir') sortDir?: 'asc' | 'desc',
  ) {
    const filters: DashboardFilters = {
      dateFrom,
      dateTo,
      paymentStatus,
      approvalStatus,
      qaStatus,
      deliveryStatus,
      contactStatus,
      orderStatus,
      orderType,
      fulfillmentType,
      categoryId,
      driverId,
      amountMin: amountMin != null ? Number(amountMin) : undefined,
      amountMax: amountMax != null ? Number(amountMax) : undefined,
      q,
      attention,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 25,
      sort,
      sortDir,
    };
    return this.analytics.dashboard(filters);
  }
}
