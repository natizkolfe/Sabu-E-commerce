import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuditModule } from './modules/audit/audit.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CoreModule } from './modules/core/core.module';
import { CrmModule } from './modules/crm/crm.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { FinanceModule } from './modules/finance/finance.module';
import { IamModule } from './modules/iam/iam.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { LogisticsModule } from './modules/logistics/logistics.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { NotifyModule } from './modules/notify/notify.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { SalesModule } from './modules/sales/sales.module';
import { StudioModule } from './modules/studio/studio.module';
import { RootController } from './root.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    DatabaseModule,
    HealthModule,
    CoreModule,
    IamModule,
    CrmModule,
    CatalogModule,
    PricingModule,
    InventoryModule,
    SalesModule,
    ProcurementModule,
    LogisticsModule,
    PaymentsModule,
    DeliveryModule,
    NotifyModule,
    FinanceModule,
    AuditModule,
    StudioModule,
    MarketplaceModule,
    AnalyticsModule,
  ],
  controllers: [RootController],
})
export class AppModule {}