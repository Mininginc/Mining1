import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../../platform/auth/decorators.js';
import { ZodPipe } from '../../common/zod-pipe.js';
import { actorFrom, type AuthedRequest } from '../../common/request-context.js';
import { CAR_FIELDS, CarSheetImportService, type CarField } from './car-sheet-import.service.js';
import { IntakeService } from './intake.service.js';

const MAX_FILE_CHARS = 10_000_000;

const importBody = z.object({
  fileName: z.string().max(255).optional(),
  content: z.string().min(1).max(MAX_FILE_CHARS),
  mapping: z.partialRecord(z.enum(Object.keys(CAR_FIELDS) as [CarField, ...CarField[]]), z.string().max(200)).optional(),
});

const listQuery = z.object({
  search: z.string().max(64).optional(),
  titleInHand: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

@Controller()
export class IntakeController {
  constructor(
    private readonly intake: IntakeService,
    private readonly carSheet: CarSheetImportService,
  ) {}

  @Get('vehicles')
  list(@Req() req: AuthedRequest, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.intake.list(req.user!.companyId, q);
  }

  @Post('intake/imports/car-sheet')
  @Roles('manager')
  importCarSheet(@Req() req: AuthedRequest, @Body(new ZodPipe(importBody)) body: z.infer<typeof importBody>) {
    return this.carSheet.import(actorFrom(req), body.fileName ?? null, body.content, body.mapping);
  }
}
