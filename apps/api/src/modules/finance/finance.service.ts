import { Injectable } from '@nestjs/common';

/** Owns PostgreSQL schema finance. Cross-module side effects via core.outbox_events. */
@Injectable()
export class FinanceService {
  readonly schema = 'finance' as const;
}
