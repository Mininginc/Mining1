import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../../platform/auth/decorators.js';
import { ZodPipe } from '../../common/zod-pipe.js';
import { actorFrom, type AuthedRequest } from '../../common/request-context.js';
import { EbayCsvImportService } from './ebay-csv-import.service.js';
import { PartsService } from './parts.service.js';

const importBody = z.object({ fileName: z.string().max(255).optional(), content: z.string().min(1).max(10_000_000) });
const listQuery = z.object({
  vehicleId: z.uuid().optional(),
  status: z.enum(['pulled', 'listed', 'reserved', 'sold', 'returned', 'liquidated']).optional(),
  search: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

@Controller()
export class InventoryController {
  constructor(
    private readonly parts: PartsService,
    private readonly ebayCsv: EbayCsvImportService,
  ) {}

  @Get('parts')
  list(@Req() req: AuthedRequest, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.parts.list(req.user!.companyId, q);
  }

  @Post('inventory/imports/ebay-csv')
  @Roles('manager')
  importEbayCsv(@Req() req: AuthedRequest, @Body(new ZodPipe(importBody)) body: z.infer<typeof importBody>) {
    return this.ebayCsv.import(actorFrom(req), body.fileName ?? null, body.content);
  }
}
