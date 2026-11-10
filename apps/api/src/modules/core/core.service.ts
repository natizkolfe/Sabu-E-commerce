import { Injectable } from '@nestjs/common';

/** Owns PostgreSQL schema core. Cross-module side effects via core.outbox_events. */
@Injectable()
export class CoreService {
  readonly schema = 'core' as const;
}
