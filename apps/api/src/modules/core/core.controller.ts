import { Body, Controller, Get, Put } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../iam/auth.types';
import { CoreService, type AboutSiteContent } from './core.service';

@Controller('core')
export class CoreController {
  constructor(private readonly coreService: CoreService) {}

  @Public()
  @Get('health')
  health() {
    return { module: 'core', schema: this.coreService.schema, status: 'ok' };
  }

  /** Public About Sabu + contact + FAQ content for the storefront. */
  @Public()
  @Get('site-content/about')
  about() {
    return this.coreService.getAboutContent();
  }

  @Put('admin/site-content/about')
  @RequirePermissions('core.site_content.write')
  updateAbout(
    @CurrentUser() user: AuthUser,
    @Body() body: Partial<AboutSiteContent>,
  ) {
    return this.coreService.updateAboutContent(user, body);
  }
}
