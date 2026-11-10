import { Injectable } from '@nestjs/common';

/** Owns PostgreSQL schema delivery. Cross-module side effects via core.outbox_events. */
@Injectable()
export class DeliveryService {
  readonly schema = 'delivery' as const;
}
