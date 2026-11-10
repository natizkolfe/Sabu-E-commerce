import { Injectable } from '@nestjs/common';

/** Owns PostgreSQL schema crm. Cross-module side effects via core.outbox_events. */
@Injectable()
export class CrmService {
  readonly schema = 'crm' as const;
}
