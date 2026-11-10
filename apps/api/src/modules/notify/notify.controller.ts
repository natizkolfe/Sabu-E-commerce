import { Controller, Get } from '@nestjs/common';
import { NotifyService } from './notify.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('notify')
export class NotifyController {
  constructor(private readonly notifyService: NotifyService) {}

  @Public()
  @Get('health')
  health() {
    return { module: 'notify', schema: this.notifyService.schema, status: 'ok' };
  }
}
