import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { IamService } from './iam.service';

@Controller('iam')
export class IamController {
  constructor(private readonly iamService: IamService) {}

  @Public()
  @Get('health')
  health() {
    return { module: 'iam', schema: this.iamService.schema, status: 'ok' };
  }
}
