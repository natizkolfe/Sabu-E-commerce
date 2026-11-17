import { Module } from '@nestjs/common';
import { NotifyModule } from '../notify/notify.module';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { CommissionsFinanceService } from './commissions-finance.service';

@Module({
  imports: [NotifyModule],
  controllers: [MarketplaceController],
  providers: [CommissionsFinanceService, MarketplaceService],
  exports: [MarketplaceService, CommissionsFinanceService],
})
export class MarketplaceModule {}
