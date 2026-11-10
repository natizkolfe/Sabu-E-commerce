import { Module } from '@nestjs/common';
import { NotifyController } from './notify.controller';
import { NotifyService } from './notify.service';
import { WhatsAppService } from './whatsapp.service';

@Module({
  controllers: [NotifyController],
  providers: [NotifyService, WhatsAppService],
  exports: [NotifyService, WhatsAppService],
})
export class NotifyModule {}
