import { Controller, Get } from '@nestjs/common';
import { CrmService } from './crm.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('crm')
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  @Public()
  @Get('health')
  health() {
    return { module: 'crm', schema: this.crmService.schema, status: 'ok' };
  }
}
