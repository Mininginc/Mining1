import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { DB } from '../../db/db.js';
import { withCompany } from '../../db/tenant.js';
import type { Database } from '../../db/types.js';

@Injectable()
export class PartsService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  list(companyId: string, q: { vehicleId?: string; status?: string; search?: string; limit: number; offset: number }) {
    return withCompany(this.db, companyId, (trx) => {
      let query = trx.selectFrom('inventory.parts').selectAll().orderBy('created_at', 'desc').limit(q.limit).offset(q.offset);
      if (q.vehicleId) query = query.where('vehicle_id', '=', q.vehicleId);
      if (q.status) query = query.where('status', '=', q.status as never);
      if (q.search) query = query.where((eb) => eb.or([eb('sku', 'ilike', `%${q.search}%`), eb('title', 'ilike', `%${q.search}%`)]));
      return query.execute();
    });
  }
}
