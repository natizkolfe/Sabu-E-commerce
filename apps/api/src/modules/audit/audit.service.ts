import { Injectable } from '@nestjs/common';

/** Owns PostgreSQL schema audit. Cross-module side effects via core.outbox_events. */
@Injectable()
export class AuditService {
  readonly schema = 'audit' as const;
}
