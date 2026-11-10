import { Injectable } from '@nestjs/common';

/** Owns PostgreSQL schema logistics. Cross-module side effects via core.outbox_events. */
@Injectable()
export class LogisticsService {
  readonly schema = 'logistics' as const;
}
