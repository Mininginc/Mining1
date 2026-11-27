import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DB } from '../../db/db.js';
import type { Database } from '../../db/types.js';
import { Public } from '../auth/decorators.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  @Public()
  @Get()
  async check() {
    try {
      await sql`select 1`.execute(this.db);
      return { status: 'ok', database: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'degraded', database: 'unreachable' });
    }
  }
}
