import { Controller, Get } from '@nestjs/common';
import { AuditService } from './audit.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Public()
  @Get('health')
  health() {
    return { module: 'audit', schema: this.auditService.schema, status: 'ok' };
  }
}
