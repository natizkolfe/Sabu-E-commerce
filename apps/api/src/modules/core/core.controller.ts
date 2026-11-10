import { Controller, Get } from '@nestjs/common';
import { CoreService } from './core.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('core')
export class CoreController {
  constructor(private readonly coreService: CoreService) {}

  @Public()
  @Get('health')
  health() {
    return { module: 'core', schema: this.coreService.schema, status: 'ok' };
  }
}
