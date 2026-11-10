import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class RootController {
  @Public()
  @Get()
  index() {
    return {
      name: 'Sabu API',
      version: '0.1.0',
      prefix: '/v1',
      docs: 'OpenAPI coming next',
      endpoints: {
        health: '/v1/health',
        auth: {
          requestOtp: 'POST /v1/auth/otp/request',
          verifyOtp: 'POST /v1/auth/otp/verify',
          refresh: 'POST /v1/auth/refresh',
          logout: 'POST /v1/auth/logout',
          me: 'GET /v1/auth/me',
        },
        modules: [
          '/v1/core/health',
          '/v1/iam/health',
          '/v1/crm/health',
          '/v1/catalog/health',
          '/v1/pricing/health',
          '/v1/inventory/health',
          '/v1/sales/health',
          '/v1/procurement/health',
          '/v1/logistics/health',
          '/v1/payments/health',
          '/v1/delivery/health',
          '/v1/notify/health',
          '/v1/finance/health',
          '/v1/audit/health',
        ],
      },
    };
  }
}
