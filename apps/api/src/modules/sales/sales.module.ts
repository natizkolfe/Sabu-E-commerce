import { Module } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module';
import { NotifyModule } from '../notify/notify.module';
import { PricingModule } from '../pricing/pricing.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [PricingModule, DeliveryModule, NotifyModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
