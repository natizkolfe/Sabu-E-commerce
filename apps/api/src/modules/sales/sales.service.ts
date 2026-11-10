import { Injectable } from '@nestjs/common';

/** Owns PostgreSQL schema sales. Cross-module side effects via core.outbox_events. */
@Injectable()
export class SalesService {
  readonly schema = 'sales' as const;
}
