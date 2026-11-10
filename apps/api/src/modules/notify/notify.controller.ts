import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { NotifyService } from './notify.service';
import { WhatsAppService } from './whatsapp.service';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

class TestWhatsAppDto {
  @Matches(/^\+[1-9][0-9]{7,14}$/)
  phone!: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  message?: string;
}

@Controller('notify')
export class NotifyController {
  constructor(
    private readonly notifyService: NotifyService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  @Public()
  @Get('health')
  health() {
    return {
      module: 'notify',
      schema: this.notifyService.schema,
      status: 'ok',
      whatsappCloudConfigured: this.whatsapp.isCloudConfigured(),
      whatsappMode:
        process.env.WHATSAPP_MODE?.trim() ||
        (this.whatsapp.isCloudConfigured() ? 'cloud' : 'wa_me'),
    };
  }

  /** Admin/dev: send or prepare a WhatsApp confirmation to a phone. */
  @Post('admin/test-whatsapp')
  @RequirePermissions('orders.write')
  testWhatsApp(@Body() dto: TestWhatsAppDto) {
    return this.notifyService.sendTestWhatsApp(dto.phone, dto.message);
  }

  @Post('admin/drain')
  @RequirePermissions('orders.write')
  drain() {
    return this.notifyService.drainOutbox(50);
  }
}
