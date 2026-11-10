import { Injectable } from '@nestjs/common';

/** Owns PostgreSQL schema inventory. Cross-module side effects via core.outbox_events. */
@Injectable()
export class InventoryService {
  readonly schema = 'inventory' as const;
}
