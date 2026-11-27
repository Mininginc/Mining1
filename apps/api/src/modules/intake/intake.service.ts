import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import { DB } from '../../db/db.js';
import { withCompany } from '../../db/tenant.js';
import type { Database } from '../../db/types.js';

export interface VehicleRef {
  id: string;
  stockNumber: string;
  make: string | null;
}

/** M2 public service. Other modules use this, never the intake schema directly. */
@Injectable()
export class IntakeService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  /** stock number -> vehicle */
  async byStockNumbers(trx: Transaction<Database>, stockNumbers: string[]): Promise<Map<string, VehicleRef>> {
    if (!stockNumbers.length) return new Map();
    const rows = await trx.selectFrom('intake.vehicles').select(['id', 'stock_number', 'make']).where('stock_number', 'in', stockNumbers).execute();
    return new Map(rows.map((r) => [r.stock_number, { id: r.id, stockNumber: r.stock_number, make: r.make }]));
  }

  list(companyId: string, q: { search?: string; titleInHand?: boolean; limit: number; offset: number }) {
    return withCompany(this.db, companyId, (trx) => {
      let query = trx.selectFrom('intake.vehicles').selectAll().orderBy('stock_number', 'desc').limit(q.limit).offset(q.offset);
      if (q.search) {
        const s = `%${q.search}%`;
        query = query.where((eb) => eb.or([eb('stock_number', 'ilike', s), eb('vin', 'ilike', s), eb('model', 'ilike', s), eb('make', 'ilike', s)]));
      }
      if (q.titleInHand !== undefined) query = query.where('title_in_hand', '=', q.titleInHand);
      return query.execute();
    });
  }
}
