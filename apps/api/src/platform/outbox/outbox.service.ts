import { Injectable } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../db/types.js';

/**
 * Modules publish domain events by calling `publish` inside the same transaction as the change.
 * A dispatcher that delivers events to subscribers arrives with the first consumer in Phase 1.
 */
@Injectable()
export class OutboxService {
  async publish(trx: Transaction<Database> | Kysely<Database>, topic: string, payload: unknown): Promise<void> {
    await trx.insertInto('platform.outbox').values({ topic, payload: JSON.stringify(payload), published_at: null }).execute();
  }
}
