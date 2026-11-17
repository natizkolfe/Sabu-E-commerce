import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Public()
  @Get()
  async check() {
    const ok = await this.db.ping();
    const { error } = this.db.getStatus();
    const isProduction = process.env.NODE_ENV === 'production';
    return {
      status: ok ? 'ok' : 'degraded',
      service: 'sabu-api',
      database: ok ? 'up' : 'down',
      // Never leak DB connection/error strings to anonymous scanners in prod.
      ...(isProduction
        ? {}
        : {
            databaseError: error,
            hint: ok
              ? undefined
              : 'Use Docker PostGIS on localhost:5433 (npm run db:up && npm run db:migrate). Local PostgreSQL 14 on 5432 is a different instance.',
          }),
      timestamp: new Date().toISOString(),
    };
  }
}
