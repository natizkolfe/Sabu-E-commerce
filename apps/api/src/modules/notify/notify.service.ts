import { Injectable } from '@nestjs/common';

/** Owns PostgreSQL schema notify. Cross-module side effects via core.outbox_events. */
@Injectable()
export class NotifyService {
  readonly schema = 'notify' as const;
}
