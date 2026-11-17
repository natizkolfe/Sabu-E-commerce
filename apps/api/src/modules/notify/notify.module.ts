import { Module } from '@nestjs/common';
import { NotifyController } from './notify.controller';
import { NotifyService } from './notify.service';
import { WhatsAppService } from './whatsapp.service';
import { TwilioService } from './twilio.service';
import { OtpDeliveryService } from './otp-delivery.service';

@Module({
  controllers: [NotifyController],
  providers: [
    NotifyService,
    WhatsAppService,
    TwilioService,
    OtpDeliveryService,
  ],
  exports: [
    NotifyService,
    WhatsAppService,
    TwilioService,
    OtpDeliveryService,
  ],
})
export class NotifyModule {}
