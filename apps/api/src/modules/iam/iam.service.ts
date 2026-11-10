import { Injectable } from '@nestjs/common';

/** Owns PostgreSQL schema iam. Cross-module side effects via core.outbox_events. */
@Injectable()
export class IamService {
  readonly schema = 'iam' as const;
}
