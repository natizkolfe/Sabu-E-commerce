import { Injectable } from '@nestjs/common';

/** Owns PostgreSQL schema payments. Cross-module side effects via core.outbox_events. */
@Injectable()
export class PaymentsService {
  readonly schema = 'payments' as const;
}
