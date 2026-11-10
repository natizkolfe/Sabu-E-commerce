import { Injectable } from '@nestjs/common';

/** Owns PostgreSQL schema pricing. Cross-module side effects via core.outbox_events. */
@Injectable()
export class PricingService {
  readonly schema = 'pricing' as const;
}
