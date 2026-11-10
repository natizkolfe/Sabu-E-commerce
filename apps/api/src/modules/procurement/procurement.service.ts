import { Injectable } from '@nestjs/common';

/** Owns PostgreSQL schema procurement. Cross-module side effects via core.outbox_events. */
@Injectable()
export class ProcurementService {
  readonly schema = 'procurement' as const;
}
